const express = require('express');
const router  = express.Router();
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[hashtag-intel]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI()     { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _perplexityCall(prompt) {
  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'sonar', temperature: 0.2, max_tokens: 4500,
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
      model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 2800,
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
        try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); }
        catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(30000, () => { req.destroy(); resolve({}); });
    req.write(body); req.end();
  });
}

// _DUMMY-key gate (source='template') ─ honesty-tagged for fabrication lint ──
function _templateHashtags(seedKeyword, platform) {
  const kw  = seedKeyword.toLowerCase().replace(/\s+/g, '');
  const kwU = seedKeyword.toLowerCase().replace(/\s+/g, '_');
  const pfx = platform === 'tiktok'
    ? ['fyp', 'foryoupage', 'viral', 'trending', 'tiktokmarketing', 'tiktok', 'tiktokcreator']
    : ['instagood', 'instadaily', 'explorepage', 'instagrammarketing', 'contentcreator', 'instagramreels', 'reels'];
  return [
    // topic-specific tags (12)
    { tag: `#${kw}`,            volume: 'high',     competition: 'high',     trend: 'stable',   whyItWorks: `Core topic tag — high discovery but very competitive. Use sparingly.` },
    { tag: `#${kw}tips`,        volume: 'medium',   competition: 'medium',   trend: 'growing',  whyItWorks: `Educational variant — attracts users looking for advice on ${seedKeyword}.` },
    { tag: `#${kwU}_community`, volume: 'low',      competition: 'low',      trend: 'stable',   whyItWorks: `Niche community tag — high engagement rate, low saturation.` },
    { tag: `#${kw}content`,     volume: 'medium',   competition: 'medium',   trend: 'stable',   whyItWorks: `Creator-focused variant — targets creators and audience builders.` },
    { tag: `#${kw}life`,        volume: 'medium',   competition: 'medium',   trend: 'stable',   whyItWorks: `Lifestyle angle — broader reach beyond strict topic searchers.` },
    { tag: `#${kw}strategy`,    volume: 'low',      competition: 'low',      trend: 'growing',  whyItWorks: `Strategic/B2B angle — lower competition, higher intent audience.` },
    { tag: `#${kw}expert`,      volume: 'low',      competition: 'low',      trend: 'stable',   whyItWorks: `Authority positioning — attracts clients seeking expertise.` },
    { tag: `#${kw}growth`,      volume: 'medium',   competition: 'medium',   trend: 'growing',  whyItWorks: `Growth-mindset audience — strong engagement signals.` },
    { tag: `#${kw}101`,         volume: 'low',      competition: 'low',      trend: 'stable',   whyItWorks: `Beginner-friendly tag — reaches newcomers actively learning about ${seedKeyword}.` },
    { tag: `#${kw}hacks`,       volume: 'medium',   competition: 'medium',   trend: 'growing',  whyItWorks: `High-shareability format — audiences love quick wins and shortcuts.` },
    { tag: `#${kw}motivation`,  volume: 'medium',   competition: 'medium',   trend: 'stable',   whyItWorks: `Emotional appeal — drives saves and shares from aspirational users.` },
    { tag: `#${kwU}_inspo`,     volume: 'low',      competition: 'low',      trend: 'growing',  whyItWorks: `Inspiration niche — lower competition with high bookmark rates.` },
    // platform-wide discovery (7)
    ...pfx.map(t => ({ tag: `#${t}`, volume: 'very_high', competition: 'very_high', trend: 'stable', whyItWorks: `Platform-wide discovery tag — maximises reach but very saturated.` })),
    // universal business / creator tags (6)
    { tag: '#smallbusiness',    volume: 'high',     competition: 'high',     trend: 'stable',   whyItWorks: `Universal SMB tag — consistent audience of buyers and founders.` },
    { tag: '#entrepreneur',     volume: 'high',     competition: 'high',     trend: 'stable',   whyItWorks: `High-intent audience of business owners.` },
    { tag: '#marketingtips',    volume: 'high',     competition: 'high',     trend: 'growing',  whyItWorks: `Broad marketing audience — good for top-of-funnel awareness.` },
    { tag: '#contentcreation',  volume: 'high',     competition: 'high',     trend: 'growing',  whyItWorks: `Creator economy tag — reaches fellow creators and brand decision-makers.` },
    { tag: '#digitalmarketing', volume: 'very_high',competition: 'very_high',trend: 'stable',   whyItWorks: `Broad B2B discovery — best used occasionally to avoid dilution.` },
    { tag: '#onlinebusiness',   volume: 'high',     competition: 'high',     trend: 'growing',  whyItWorks: `SMB/e-commerce buyer audience with commercial intent.` },
  ];
}

function _templateClusters(seedKeyword) {
  return [
    { name: 'Core Topic', type: 'broad', hashtags: [`#${seedKeyword.replace(/\s+/g,'')}`, `#${seedKeyword.replace(/\s+/g,'')}tips`, `#${seedKeyword.replace(/\s+/g,'')}content`], copySet: [`#${seedKeyword.replace(/\s+/g,'')}`, `#${seedKeyword.replace(/\s+/g,'')}tips`, `#${seedKeyword.replace(/\s+/g,'')}content`], strategy: 'Use in every post to establish topic authority.' },
    { name: 'Niche Community', type: 'niche', hashtags: [`#${seedKeyword.replace(/\s+/g,'_')}_community`, `#${seedKeyword.replace(/\s+/g,'')}expert`, `#${seedKeyword.replace(/\s+/g,'')}strategy`], copySet: [`#${seedKeyword.replace(/\s+/g,'_')}_community`, `#${seedKeyword.replace(/\s+/g,'')}expert`, `#${seedKeyword.replace(/\s+/g,'')}strategy`], strategy: 'Lower competition — higher engagement rate. Rotate 3-4 of these per post.' },
    { name: 'Discovery', type: 'trending', hashtags: ['#fyp', '#viral', '#trending', '#explorepage'], copySet: ['#fyp', '#viral', '#trending', '#explorepage'], strategy: 'Maximise algorithmic reach — use 2-3 max per post to avoid spam signals.' },
    { name: 'Broad Reach', type: 'broad', hashtags: ['#entrepreneur', '#smallbusiness', '#marketingtips', '#contentcreator'], copySet: ['#entrepreneur', '#smallbusiness', '#marketingtips', '#contentcreator'], strategy: 'Top-of-funnel awareness. Mix with niche tags for balance.' },
  ];
}

async function _researchHashtags(seedKeyword, platform) {
  // _DUMMY key gate — return template when no real Perplexity key
  if (!_hasPerplexity()) {
    return { hashtags: _templateHashtags(seedKeyword, platform), clusters: _templateClusters(seedKeyword), source: 'template' };
  }

  const platLabel = platform === 'tiktok' ? 'TikTok' : 'Instagram';
  const prompt = `Research the top-performing ${platLabel} hashtags for the topic "${seedKeyword}" as of 2024-2025.

Return ONLY a JSON object — no markdown, no preamble:
{
  "hashtags": [
    {
      "tag": "#example",
      "volume": "low|medium|high|very_high",
      "competition": "low|medium|high|very_high",
      "trend": "declining|stable|growing|viral",
      "whyItWorks": "1-sentence explanation of why this tag drives discovery for ${seedKeyword}"
    }
  ]
}

Rules:
- 25-40 hashtags total
- Mix of mega (>10M posts/volume=very_high), large (1M-10M/high), medium (100K-1M/medium), niche (<100K/low)
- All must be genuinely relevant to "${seedKeyword}" on ${platLabel}
- Real hashtags only — never invent
- whyItWorks must be specific to the tag, not generic
`;

  const raw = await _perplexityCall(prompt);
  let hashtagList = [];
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      hashtagList = Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 50) : [];
    }
  } catch (_) {}

  // If Perplexity returned nothing useful, fall back to template
  if (!hashtagList.length) {
    return { hashtags: _templateHashtags(seedKeyword, platform), clusters: _templateClusters(seedKeyword), source: 'template' };
  }

  let clusters = [];
  if (_hasOpenAI() && hashtagList.length) {
    const tagSummary = hashtagList.slice(0, 35).map(h => `${h.tag} (volume:${h.volume}, competition:${h.competition}, trend:${h.trend})`).join('\n');
    const clusterResult = await _openAICall([
      { role: 'system', content: `You are a social media strategist. Group hashtags into strategic clusters for ${platLabel}. Return strict JSON only.` },
      { role: 'user', content: `Cluster these ${platLabel} hashtags for "${seedKeyword}" into 4-6 strategic groups.

Hashtags:
${tagSummary}

Return strict JSON:
{
  "clusters": [
    {
      "name": "Cluster name (e.g. Niche, Broad, Trending, Branded, Community, Educational)",
      "type": "niche|broad|trending|branded",
      "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
      "copySet": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
      "strategy": "When and how to use this cluster in a ${platLabel} post caption (1 concise sentence)"
    }
  ]
}` }
    ]);
    clusters = Array.isArray(clusterResult.clusters) ? clusterResult.clusters : _templateClusters(seedKeyword);
  } else {
    clusters = _templateClusters(seedKeyword);
  }

  return { hashtags: hashtagList, clusters, source: 'perplexity' };
}

router.get('/test', (req, res) => res.json({ ok: true, perplexity: _hasPerplexity(), openai: _hasOpenAI(), db: _db.hasDb && _db.hasDb() }));

router.post('/research', _safeAsync(async (req, res) => {
  const seedKeyword = String(req.body?.seedKeyword || '').trim().slice(0, 200);
  const platform    = ['instagram', 'tiktok'].includes(req.body?.platform) ? req.body.platform : 'instagram';
  if (!seedKeyword) return _err(res, 400, 'seedKeyword required');

  const { hashtags, clusters, source } = await _researchHashtags(seedKeyword, platform);

  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_intel:research' });
      await _db.getPool().query(
        `INSERT INTO hashtag_intel_runs (tenant_id, platform, seed_keyword, hashtags, clusters, total_count)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, platform, seedKeyword, JSON.stringify(hashtags), JSON.stringify(clusters), hashtags.length]
      );
    } catch (_) {}
  }

  res.json({ ok: true, seedKeyword, platform, hashtags, clusters, total: hashtags.length, source });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_intel:runs' });
  const platform = req.query.platform;
  const where  = platform ? 'WHERE tenant_id=$1 AND platform=$2' : 'WHERE tenant_id=$1';
  const params = platform ? [tid, platform] : [tid];
  const r = await _db.getPool().query(
    `SELECT id, platform, seed_keyword, clusters, total_count, created_at
     FROM hashtag_intel_runs ${where} ORDER BY created_at DESC LIMIT 20`,
    params
  );
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 404, 'not found');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_intel:run' });
  const r = await _db.getPool().query(
    'SELECT * FROM hashtag_intel_runs WHERE id=$1 AND tenant_id=$2',
    [parseInt(req.params.id, 10), tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok: true, run: r.rows[0] });
}));

router.delete('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 404, 'not found');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_intel:delete' });
  const r = await _db.getPool().query(
    'DELETE FROM hashtag_intel_runs WHERE id=$1 AND tenant_id=$2 RETURNING id',
    [parseInt(req.params.id, 10), tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok: true, deleted: r.rows[0].id });
}));

module.exports = router;
