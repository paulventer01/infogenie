const express = require('express');
const router = express.Router();
const _https = require('https');
const _tenantCtx = require('../tenants/context');
const { createRateLimiter } = require('../security/rate_limit');
const {
  gateRouteText,
  contentSafetyHttpBody,
  attachContentSafetyWarnings,
} = require('../ai_governance/route_gate');
const {
  normalizeVideoScriptResult,
  videoScriptGateText,
} = require('../ai_governance/content_schemas');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[video-script]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _testOnlyMax(envName, fallback) {
  if (process.env.NODE_ENV !== 'test') return fallback;
  const n = Number.parseInt(String(process.env[envName] || ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

const VIDEO_SCRIPT_GENERATE_MAX = _testOnlyMax('VIDEO_SCRIPT_GENERATE_RATE_LIMIT_MAX', 20);

const videoScriptGenerateLimiter = createRateLimiter({
  name: 'video-script-generate',
  windowMs: 60_000,
  max: VIDEO_SCRIPT_GENERATE_MAX,
  failClosed: true,
  keyFn: (req) => {
    const tid = req.tenant?.id;
    const uid = req.user?.id;
    if (tid != null && uid != null) return `video-script-generate|${tid}|${uid}`;
    return null;
  },
});

async function _tid(req, label) {
  return _tenantCtx.resolveTenantId(req, { label });
}

async function _gateScripts(req, tid, scripts, label) {
  try {
    return await gateRouteText({
      tenantId: tid,
      userId: req.user?.id || null,
      surface: 'video_script',
      action: 'generate_content',
      text: videoScriptGateText(scripts),
      label,
    });
  } catch (_) {
    return {
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable. Generation was stopped to protect your brand.',
      warnings: [],
    };
  }
}

const PLATFORMS = ['tiktok','reels','shorts','linkedin'];
const TONES = ['energetic','educational','funny','dramatic','authoritative','conversational'];

async function _generate({ topic, platform, tone, duration, count }) {
  if (!_hasOpenAI()) return null;
  let brandCtx = '';
  try { const bf = require('../brand_foundation/api'); if (bf.getBrandContextBlock) brandCtx = await bf.getBrandContextBlock(); } catch {}
  const sys = `${brandCtx ? brandCtx + '\n\n' : ''}You are a top-tier short-form video scriptwriter. Generate scripts optimized for the platform. Stay strictly on-brand (respect the brand voice + banned words above). Strict JSON only.`;
  const user = `Topic: ${topic}
Platform: ${platform} (${platform === 'shorts' ? 'YouTube Shorts' : platform === 'reels' ? 'Instagram Reels' : platform === 'tiktok' ? 'TikTok' : 'LinkedIn video'})
Tone: ${tone}
Target duration: ${duration} seconds

Generate ${count} script variants. Reply strict JSON:
{
  "scripts": [
    {
      "hook": "first 3-second attention-grabber line spoken on camera",
      "body": [
        {"line":"...","onscreen_text":"...","cue":"camera angle / b-roll cue"}
      ],
      "cta": "closing call-to-action line",
      "estimated_duration_sec": <int>,
      "viral_pattern": "curiosity_gap|problem_solution|listicle|transformation|controversy|story",
      "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5"]
    }
  ]
}

Body should be 4-8 short lines, each <12 words. Each line needs spoken text + bold on-screen text + production cue.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-5-mini', temperature:0.7, max_tokens:2200,
      response_format:{ type:'json_object' },
      messages:[{ role:'system', content: sys }, { role:'user', content: user }]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI(), platforms: PLATFORMS, tones: TONES }));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.post('/generate', videoScriptGenerateLimiter, _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'video-script:generate');
  if (!tid) return _err(res, 400, 'no_tenant');
  const topic = String(req.body?.topic || '').trim().slice(0, 500);
  const platform = String(req.body?.platform || 'tiktok').toLowerCase();
  const tone = String(req.body?.tone || 'energetic').toLowerCase();
  const duration = Math.max(15, Math.min(180, parseInt(req.body?.duration || 30, 10)));
  const count = Math.max(1, Math.min(5, parseInt(req.body?.count || 3, 10)));
  if (!topic) return _err(res, 400, 'topic required');
  if (!PLATFORMS.includes(platform)) return _err(res, 400, 'platform must be one of: ' + PLATFORMS.join(', '));
  if (!TONES.includes(tone)) return _err(res, 400, 'tone must be one of: ' + TONES.join(', '));
  if (!_hasOpenAI()) return _err(res, 400, 'OPENAI_API_KEY required');
  const r = await _generate({ topic, platform, tone, duration, count });
  const normalized = normalizeVideoScriptResult(r, count);
  if (!normalized.scripts.length) return _err(res, 502, 'AI generation failed');
  const gated = await _gateScripts(req, tid, normalized.scripts, 'video-script:generate');
  if (!gated.ok) {
    const status = gated.error === 'content_safety_unavailable' ? 503 : 403;
    return res.status(status).json(contentSafetyHttpBody(gated));
  }
  res.json(attachContentSafetyWarnings({
    ok: true,
    topic,
    platform,
    tone,
    duration,
    scripts: normalized.scripts,
  }, gated.warnings || gated.content_safety_warnings || []));
}));

module.exports = router;
