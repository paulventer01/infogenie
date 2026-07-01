const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const VALID_CHANNELS = ['instagram','tiktok','linkedin','x','facebook','youtube','blog','email'];

async function _aiCalendar({ brand, goal, channels, days, audience, tone, language, tenantId }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  let brandCtx = '';
  try { const bf = require('../brand_foundation/api'); if (bf.getBrandContextBlock) brandCtx = await bf.getBrandContextBlock(tenantId); } catch {}
  const langNote = language && language.toLowerCase() !== 'english' ? ` Write ALL copy in ${language}.` : '';
  const sys = `${brandCtx ? brandCtx + '\n\n' : ''}You are a senior content strategist drafting a ${days}-day social content calendar for ${brand}. Stay on-brand: respect the brand voice, banned words, and ICP above.${langNote} Return strict JSON:
{"posts":[{"day":1,"date":"YYYY-MM-DD","channel":"instagram|tiktok|linkedin|x|facebook|youtube|blog|email","format":"reel|carousel|short|post|thread|article|video|email","hook":"<8-word scroll-stopper>","copy":"<the full caption / body>","hashtags":["#tag1","#tag2"],"cta":"<single call to action>","best_time":"HH:MM"}]}
Rules:
- Cover exactly ${days} days, dates starting today.
- Distribute across the requested channels (${channels.join(', ')}) — vary the format.
- Tone: ${tone || 'authentic + on-brand'}.
- Each post must be specific and immediately usable — no placeholders, no "[insert here]".
- Hashtags: 3-6, mix of niche + branded + trending.
- Hooks must earn the click — no generic "Excited to share…".`;
  const user = `Brand: ${brand}
Goal: ${goal || 'awareness + engagement'}
Audience: ${audience || 'general consumers'}
Channels: ${channels.join(', ')}
Days: ${days}
Today's date: ${new Date().toISOString().slice(0,10)}

Draft the calendar now.`;
  const body = JSON.stringify({
    model:'gpt-5-mini',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    response_format: { type:'json_object' },
    temperature: 0.7, max_tokens: 3500,
  });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d); resolve(JSON.parse(j.choices[0].message.content));
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _templateCalendar({ brand, channels, days }) {
  const today = new Date();
  const formats = { instagram:'carousel', tiktok:'short', linkedin:'post', x:'thread', facebook:'post', youtube:'video', blog:'article', email:'email' };
  const posts = [];
  for (let d = 1; d <= days; d++) {
    const date = new Date(today.getTime() + (d-1)*864e5).toISOString().slice(0,10);
    const ch = channels[(d-1) % channels.length];
    posts.push({
      day:d, date, channel:ch, format: formats[ch] || 'post',
      hook: `${brand} day ${d} — what changed this week`,
      copy: `Day ${d} update for ${brand}. Share a behind-the-scenes win, customer story, or product insight. Keep it human.`,
      hashtags: [`#${brand.replace(/\s+/g,'')}`, '#brand', '#marketing'],
      cta: 'Comment below with your take.',
      best_time: ch === 'linkedin' ? '08:30' : ch === 'tiktok' ? '19:00' : '12:00',
    });
  }
  return { posts };
}

router.post('/generate', async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const goal = String(req.body?.goal || '').slice(0, 300);
  const audience = String(req.body?.audience || '').slice(0, 300);
  const tone = String(req.body?.tone || '').slice(0, 100);
  const days = Math.min(30, Math.max(1, parseInt(req.body?.days, 10) || 7));
  const language = String(req.body?.language || 'English').trim().slice(0, 50);
  const channels = (Array.isArray(req.body?.channels) ? req.body.channels : ['instagram','linkedin','x'])
    .filter(c => VALID_CHANNELS.includes(c)).slice(0, 6);
  if (!brand) return _err(res, 400, 'brand required');
  if (!channels.length) return _err(res, 400, 'at least one valid channel required');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'content_calendar:generate' });
  let result = await _aiCalendar({ brand, goal, channels, days, audience, tone, language, tenantId: tid });
  let source = 'openai';
  if (!result || !Array.isArray(result.posts)) { result = _templateCalendar({ brand, channels, days }); source = 'template'; }
  if (_db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO content_calendar_runs (tenant_id, brand, goal, channels, days, posts, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, brand, goal, JSON.stringify(channels), days, JSON.stringify(result.posts), source]);
    } catch (e) { console.warn('[content-calendar] persist failed:', e.message); }
  }
  // Fire-and-forget: record content calendar generation in Marketing Memory
  if (tid) {
    try {
      const { ingestMemoryNode } = require('../knowledge_graph/api');
      ingestMemoryNode({
        tenant_id: tid,
        node_type: 'content_performance',
        summary: `Content calendar generated for "${brand}": ${result.posts?.length || days} posts across ${channels.join(', ')} for ${days} days.`,
        detail: { brand, goal, channels, days, post_count: result.posts?.length || 0, generated_by: source },
        source_ref: `content_calendar:${brand}:${new Date().toISOString().slice(0, 10)}`,
        importance: 0.5,
      }).catch(() => {});
    } catch (_) {}
  }
  res.json({ ok:true, source, brand, days, channels, posts: result.posts });
});

// POST /add — append a single ready-made post (used by Win/Loss "Add to
// Calendar" button to schedule a generated counter-message). Persists as a
// 1-day "ad-hoc" run so it shows up in /history and /:id alongside
// AI-generated calendars.
router.post('/add', async (req, res) => {
  const brand    = String(req.body?.brand    || 'Counter-Message').trim().slice(0, 80);
  const channel  = String(req.body?.channel  || 'facebook').toLowerCase();
  const headline = String(req.body?.headline || '').slice(0, 200);
  const copy     = String(req.body?.copy     || req.body?.body || '').slice(0, 2000);
  const cta      = String(req.body?.cta      || 'Learn More').slice(0, 60);
  const date     = String(req.body?.date     || new Date(Date.now()+864e5).toISOString().slice(0,10)).slice(0,10);
  const note     = String(req.body?.note     || '').slice(0, 500);
  const channelClean = VALID_CHANNELS.includes(channel) ? channel : 'facebook';
  if (!copy && !headline) return _err(res, 400, 'headline or copy required');
  const post = {
    day: 1, date, channel: channelClean,
    format: channelClean === 'tiktok' ? 'short' : channelClean === 'instagram' ? 'reel' : 'post',
    hook: headline || copy.slice(0, 60),
    copy: copy || headline,
    hashtags: [`#${brand.replace(/\s+/g,'')}`, '#counter', '#campaign'],
    cta,
    best_time: channelClean === 'linkedin' ? '08:30' : channelClean === 'tiktok' ? '19:00' : '12:00',
    note,
  };
  if (_db.hasDb()) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label:'content_calendar:add' });
      const r = await _db.getPool().query(
        `INSERT INTO content_calendar_runs (tenant_id, brand, goal, channels, days, posts, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tid, brand, note || 'Counter-message scheduled from Win/Loss', JSON.stringify([channelClean]), 1, JSON.stringify([post]), 'wl-counter']);
      return res.json({ ok:true, id: r.rows[0].id, post });
    } catch (e) { return _err(res, 500, 'persist failed: ' + e.message); }
  }
  res.json({ ok:true, id: null, post, note: 'no-db — post returned but not persisted' });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'content_calendar:history' });
    const r = await _db.getPool().query(
      `SELECT id, brand, goal, channels, days, generated_by, created_at FROM content_calendar_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [tid, limit]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'content_calendar:get' });
    const r = await _db.getPool().query(`SELECT * FROM content_calendar_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
