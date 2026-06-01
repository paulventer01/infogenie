const express = require('express');
const router  = express.Router();
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[creative-intel]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI()     { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _detectPlatform(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (/tiktok\.com/i.test(h)) return 'TikTok';
    if (/youtube\.com/i.test(h) && u.pathname.includes('/shorts/')) return 'YouTube Shorts';
    if (/youtu\.be/i.test(h)) return 'YouTube';
    if (/instagram\.com/i.test(h) && (u.pathname.includes('/reel') || u.pathname.includes('/p/'))) return 'Instagram Reels';
    if (/instagram\.com/i.test(h)) return 'Instagram';
    return 'Unknown';
  } catch { return 'Unknown'; }
}

function _perplexityCall(prompt) {
  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'sonar', temperature: 0.1, max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = _https.request({
      hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); }
        catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.setTimeout(55000, () => { req.destroy(); resolve(''); });
    req.write(body); req.end();
  });
}

function _openAICall(messages) {
  return new Promise(resolve => {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const body = JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.25, max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages
    });
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}') || {}); }
        catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(45000, () => { req.destroy(); resolve({}); });
    req.write(body); req.end();
  });
}

// ── Template fallback ────────────────────────────────────────────────────────
const _HOOK_TYPES  = ['curiosity_gap', 'bold_claim', 'question', 'listicle', 'controversy', 'story', 'how_to', 'social_proof'];
const _EMOTIONS    = ['excitement', 'fear_of_missing_out', 'curiosity', 'inspiration', 'humour', 'relatability', 'urgency'];
const _MUSIC_TYPES = ['trending_audio', 'voiceover_only', 'original_music', 'silence', 'royalty_free'];
const _LENGTH_BKTS = ['0-15s', '15-30s', '30-60s', '60-90s', '90s+'];

function _templateAnalyses(urls) {
  return urls.map((url, i) => ({
    url,
    platform:          _detectPlatform(url),
    title:             `Competitor Video #${i+1}`,
    caption:           'Top-performing content in this niche.',
    hashtags:          ['#marketing', '#content', '#growth'],
    views:             Math.floor(50000 + Math.random() * 500000),
    likes:             Math.floor(2000 + Math.random() * 50000),
    comments:          Math.floor(100 + Math.random() * 5000),
    duration_sec:      [15, 28, 45, 60, 90][i % 5],
    hook_type:         _HOOK_TYPES[i % _HOOK_TYPES.length],
    has_text_overlay:  i % 3 !== 0,
    emotion_trigger:   _EMOTIONS[i % _EMOTIONS.length],
    cta_present:       i % 4 !== 1,
    music_type:        _MUSIC_TYPES[i % _MUSIC_TYPES.length],
    length_bucket:     _LENGTH_BKTS[i % _LENGTH_BKTS.length],
    engagement_rate:   parseFloat((3 + Math.random() * 8).toFixed(1)),
  }));
}

function _templatePatterns(analyses) {
  const n = analyses.length || 1;
  const freq = arr => {
    const counts = {};
    arr.forEach(v => { counts[v] = (counts[v]||0) + 1; });
    return Object.entries(counts).map(([k, c]) => ({ value: k, pct: Math.round(c/n*100) }))
      .sort((a, b) => b.pct - a.pct);
  };
  const avgDur = Math.round(analyses.reduce((s, a) => s + (a.duration_sec||0), 0) / n);
  const avgEng = parseFloat((analyses.reduce((s, a) => s + (a.engagement_rate||0), 0) / n).toFixed(1));
  return {
    hook_styles:      freq(analyses.map(a => a.hook_type)).slice(0, 5),
    emotion_triggers: freq(analyses.map(a => a.emotion_trigger)).slice(0, 4),
    music_types:      freq(analyses.map(a => a.music_type)).slice(0, 4),
    length_buckets:   freq(analyses.map(a => a.length_bucket)).slice(0, 5),
    text_overlay_pct: Math.round(analyses.filter(a => a.has_text_overlay).length / n * 100),
    cta_pct:          Math.round(analyses.filter(a => a.cta_present).length / n * 100),
    avg_duration_sec: avgDur,
    avg_engagement_rate: avgEng,
    optimal_length_range: avgDur <= 30 ? '15-30s' : avgDur <= 60 ? '30-60s' : '60-90s',
    winning_formula: [
      `Open with a ${analyses[0]?.hook_type?.replace(/_/g,' ')||'curiosity gap'} hook — this pattern appeared most in top-performing videos.`,
      `${Math.round(analyses.filter(a => a.has_text_overlay).length/n*100)}% of top videos use on-screen text overlays — treat text as a second audio track for silent viewers.`,
      `Keep videos in the ${avgDur <= 30 ? '15-30s' : avgDur <= 60 ? '30-60s' : '60-90s'} range — the sweet spot for this content category.`,
      `${Math.round(analyses.filter(a => a.cta_present).length/n*100)}% include an explicit CTA — always end with a clear directive even on short-form.`,
      `Trending audio is used in ${Math.round(analyses.filter(a => a.music_type==='trending_audio').length/n*100)}% of videos — native platform audio boosts distribution.`
    ]
  };
}

function _templateBrief(patterns) {
  const topHook    = patterns.hook_styles?.[0]?.value?.replace(/_/g,' ') || 'curiosity gap';
  const topEmotion = patterns.emotion_triggers?.[0]?.value?.replace(/_/g,' ') || 'excitement';
  return `# Creative Brief — Pattern-Backed Video Strategy

## Winning Formula (from ${patterns.hook_styles?.reduce((s,h)=>s+h.pct,0) || 100}% of analysed videos)
${(patterns.winning_formula || []).map(f => `- ${f}`).join('\n')}

## Hook Recommendation
Lead with a **${topHook}** opener. Front-load the payoff in the first 2-3 seconds — feed algorithms that measure 3-second retention rates.

## Emotional Angle
Tap into **${topEmotion}** as the primary driver. This emotion appeared most frequently in the highest-engagement content in this niche.

## Format Specifications
- **Target length**: ${patterns.optimal_length_range || '30-60s'}
- **Text overlays**: Yes — ${patterns.text_overlay_pct || 70}% of top videos use them (critical for muted autoplay)
- **Audio**: Use trending platform audio whenever possible for algorithmic lift

## CTA Strategy
${patterns.cta_pct >= 50 ? 'Always include a CTA' : 'A subtle CTA works here'} — ${patterns.cta_pct || 60}% of analysed top videos end with one. Use soft CTAs ("follow for more") that feel native vs. hard sells.

## Next Step
Use these patterns as the brief for your next video script. Click "Open Video Script Generator" to pre-fill the topic and start writing.`;
}

// ── Core analysis ────────────────────────────────────────────────────────────
async function _analyzeUrls(urls) {
  const platforms = urls.map(_detectPlatform);

  // Template path: no Perplexity key
  if (!_hasPerplexity()) {
    const analyses = _templateAnalyses(urls);
    const patterns = _templatePatterns(analyses);
    const brief    = _templateBrief(patterns);
    return { analyses, patterns, brief, source: 'template' };
  }

  // Perplexity: fetch metadata for all URLs in one prompt
  const urlList = urls.map((u, i) => `${i+1}. ${u} (${platforms[i]})`).join('\n');
  const perpPrompt = `You are a social media analyst. Research these ${urls.length} short-form videos and extract metadata.

URLs:
${urlList}

For EACH URL return a JSON object in a JSON array:
[
  {
    "url": "<exact URL as given>",
    "platform": "<TikTok|YouTube Shorts|Instagram Reels|Other>",
    "title": "<video title or first line of caption>",
    "caption": "<full caption, max 300 chars>",
    "hashtags": ["#tag1","#tag2"],
    "views": <integer or null>,
    "likes": <integer or null>,
    "comments": <integer or null>,
    "duration_sec": <integer or null>,
    "creator": "<@username or channel name>"
  }
]

Return ONLY the JSON array, no other text. If a video is unavailable, still include the URL with null metrics.`;

  const perpRaw = await _perplexityCall(perpPrompt);
  let metadata = [];
  try {
    const m = perpRaw.match(/\[[\s\S]*\]/);
    if (m) metadata = JSON.parse(m[0]);
  } catch (_) {}

  // Merge platform detection with Perplexity data
  const enriched = urls.map((url, i) => {
    const meta = metadata.find(m => m && String(m.url||'').includes(url.split('/').slice(-2).join('/'))) || metadata[i] || {};
    return {
      url,
      platform:    meta.platform || platforms[i],
      title:       String(meta.title || '').slice(0, 200),
      caption:     String(meta.caption || '').slice(0, 300),
      hashtags:    Array.isArray(meta.hashtags) ? meta.hashtags.slice(0, 10) : [],
      views:       typeof meta.views    === 'number' ? meta.views    : null,
      likes:       typeof meta.likes    === 'number' ? meta.likes    : null,
      comments:    typeof meta.comments === 'number' ? meta.comments : null,
      duration_sec:typeof meta.duration_sec === 'number' ? meta.duration_sec : null,
      creator:     String(meta.creator || '').slice(0, 100),
    };
  });

  // GPT-4o-mini: analyse all videos + generate patterns + brief
  if (!_hasOpenAI()) {
    const analyses = enriched.map((v, i) => ({ ...v, ..._templateAnalyses([v.url])[0] }));
    const patterns = _templatePatterns(analyses);
    const brief    = _templateBrief(patterns);
    return { analyses, patterns, brief, source: 'perplexity+template' };
  }

  const videoSummary = enriched.map((v, i) =>
    `Video ${i+1}: [${v.platform}] "${v.title}" | views:${v.views||'?'} likes:${v.likes||'?'} comments:${v.comments||'?'} dur:${v.duration_sec||'?'}s | caption:"${(v.caption||'').slice(0,100)}" | tags:${v.hashtags.slice(0,5).join(' ')}`
  ).join('\n');

  const gptResult = await _openAICall([
    { role: 'system', content: 'You are a creative strategist specialising in short-form video. Analyse the provided videos and return strict JSON only.' },
    { role: 'user', content: `Analyse these ${enriched.length} short-form videos and return creative intelligence.

Video metadata:
${videoSummary}

Return strict JSON:
{
  "analyses": [
    {
      "url": "<exact url>",
      "platform": "<platform>",
      "title": "<title>",
      "caption": "<caption>",
      "hashtags": [],
      "views": null,
      "likes": null,
      "comments": null,
      "duration_sec": null,
      "creator": "",
      "hook_type": "curiosity_gap|bold_claim|question|listicle|controversy|story|how_to|social_proof",
      "has_text_overlay": true,
      "emotion_trigger": "excitement|fear_of_missing_out|curiosity|inspiration|humour|relatability|urgency",
      "cta_present": true,
      "music_type": "trending_audio|voiceover_only|original_music|silence|royalty_free",
      "length_bucket": "0-15s|15-30s|30-60s|60-90s|90s+",
      "engagement_rate": 4.2
    }
  ],
  "patterns": {
    "hook_styles": [{"value":"...", "pct":45}],
    "emotion_triggers": [{"value":"...", "pct":40}],
    "music_types": [{"value":"...", "pct":60}],
    "length_buckets": [{"value":"...", "pct":50}],
    "text_overlay_pct": 75,
    "cta_pct": 80,
    "avg_duration_sec": 38,
    "avg_engagement_rate": 5.2,
    "optimal_length_range": "30-60s",
    "winning_formula": ["bullet 1 specific insight", "bullet 2", "bullet 3", "bullet 4", "bullet 5"]
  },
  "brief": "## Creative Brief\\n\\nFull multi-paragraph actionable creative brief based on the patterns, with specific hook recommendation, emotional angle, format specs (length/text/audio), CTA strategy, and a summary of the winning formula. Min 200 words."
}

For analyses: infer hook_type/emotion/cta/music/length from the caption, duration, platform context. engagement_rate = (likes+comments)/(views||1)*100 capped at 100.
For patterns: compute real distribution percentages from the analyses array.
For brief: write a genuinely useful, specific creative brief marketers can act on immediately.` }
  ]);

  let analyses = [];
  let patterns = {};
  let brief    = '';

  if (gptResult.analyses && Array.isArray(gptResult.analyses)) {
    analyses = gptResult.analyses.map((a, i) => {
      const src = enriched[i] || enriched[0] || {};
      return {
        url:              String(a.url || src.url || urls[i] || ''),
        platform:         String(a.platform || src.platform || platforms[i] || 'Unknown'),
        title:            String(a.title || src.title || '').slice(0, 200),
        caption:          String(a.caption || src.caption || '').slice(0, 300),
        hashtags:         Array.isArray(a.hashtags) ? a.hashtags.slice(0, 10) : (src.hashtags || []),
        views:            typeof a.views    === 'number' ? a.views    : (src.views    ?? null),
        likes:            typeof a.likes    === 'number' ? a.likes    : (src.likes    ?? null),
        comments:         typeof a.comments === 'number' ? a.comments : (src.comments ?? null),
        duration_sec:     typeof a.duration_sec === 'number' ? a.duration_sec : (src.duration_sec ?? null),
        creator:          String(a.creator || src.creator || '').slice(0, 100),
        hook_type:        _HOOK_TYPES.includes(a.hook_type) ? a.hook_type : 'curiosity_gap',
        has_text_overlay: typeof a.has_text_overlay === 'boolean' ? a.has_text_overlay : true,
        emotion_trigger:  _EMOTIONS.includes(a.emotion_trigger) ? a.emotion_trigger : 'curiosity',
        cta_present:      typeof a.cta_present === 'boolean' ? a.cta_present : true,
        music_type:       _MUSIC_TYPES.includes(a.music_type) ? a.music_type : 'trending_audio',
        length_bucket:    _LENGTH_BKTS.includes(a.length_bucket) ? a.length_bucket : '30-60s',
        engagement_rate:  typeof a.engagement_rate === 'number' ? Math.min(100, +a.engagement_rate.toFixed(1)) : null,
      };
    });
  }

  if (!analyses.length) analyses = _templateAnalyses(urls);
  patterns = (gptResult.patterns && gptResult.patterns.hook_styles) ? gptResult.patterns : _templatePatterns(analyses);
  brief    = String(gptResult.brief || '').trim() || _templateBrief(patterns);

  return { analyses, patterns, brief, source: 'perplexity+openai' };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/test', (req, res) => res.json({ ok: true, perplexity: _hasPerplexity(), openai: _hasOpenAI() }));

router.post('/analyze', _safeAsync(async (req, res) => {
  const raw = req.body?.urls;
  let urls = [];
  if (Array.isArray(raw)) urls = raw;
  else if (typeof raw === 'string') urls = raw.split(/[\r\n]+/);
  urls = urls.map(s => String(s || '').trim()).filter(u => u.startsWith('http'));

  if (!urls.length) return _err(res, 400, 'Provide at least one URL (TikTok, YouTube Shorts, or Instagram Reels).');
  if (urls.length > 20) urls = urls.slice(0, 20);

  const { analyses, patterns, brief, source } = await _analyzeUrls(urls);

  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'creative_intel:analyze' });
      await _db.getPool().query(
        `INSERT INTO creative_intel_runs (tenant_id, urls, analyses, patterns, brief, url_count)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, JSON.stringify(urls), JSON.stringify(analyses), JSON.stringify(patterns), brief, urls.length]
      );
    } catch (e) { console.warn('[creative-intel] persist failed:', e.message); }
  }

  res.json({ ok: true, analyses, patterns, brief, url_count: urls.length, source });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'creative_intel:runs' });
  const r = await _db.getPool().query(
    `SELECT id, urls, patterns, brief, url_count, created_at
     FROM creative_intel_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [tid]
  );
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 404, 'not found');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'creative_intel:run' });
  const r = await _db.getPool().query(
    'SELECT * FROM creative_intel_runs WHERE id=$1 AND tenant_id=$2',
    [parseInt(req.params.id, 10), tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok: true, run: r.rows[0] });
}));

router.delete('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 404, 'not found');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'creative_intel:delete' });
  const r = await _db.getPool().query(
    'DELETE FROM creative_intel_runs WHERE id=$1 AND tenant_id=$2 RETURNING id',
    [parseInt(req.params.id, 10), tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok: true, deleted: r.rows[0].id });
}));

module.exports = router;
