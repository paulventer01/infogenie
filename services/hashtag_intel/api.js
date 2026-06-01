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
      model: 'sonar', temperature: 0.2, max_tokens: 4000,
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
        try {
          const j = JSON.parse(d);
          resolve(j?.choices?.[0]?.message?.content || '');
        } catch { resolve(''); }
      });
    });
    req.on('error', e => resolve(''));
    req.setTimeout(50000, () => { req.destroy(); resolve(''); });
    req.write(body); req.end();
  });
}

function _openAICall(messages) {
  return new Promise(resolve => {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const body = JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 2500,
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
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '{}';
          resolve(JSON.parse(txt));
        } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(30000, () => { req.destroy(); resolve({}); });
    req.write(body); req.end();
  });
}

function _templateHashtags(keyword, platform) {
  const kw = keyword.toLowerCase().replace(/\s+/g, '');
  const kwSpace = keyword.toLowerCase().replace(/\s+/g, '_');
  const pfx = platform === 'tiktok' ? ['fyp','foryoupage','viral','trending'] : ['instagood','instadaily','photooftheday','explorepage'];
  return [
    `#${kw}`, `#${kwSpace}marketing`, `#${kw}tips`, `#${kw}community`, `#${kw}life`,
    `#${kw}content`, `#${kw}brand`, `#${kw}growth`, `#${kw}strategy`, `#${kw}expert`,
    ...pfx.map(t => `#${t}`),
    `#smallbusiness`, `#entrepreneur`, `#businesstips`, `#socialmediatips`, `#contentcreator`
  ];
}

function _templateClusters(keyword) {
  return [
    { name: 'Core Topic', description: `Primary hashtags directly about ${keyword}`, hashtags: [`#${keyword.replace(/\s+/g,'')}`, `#${keyword.replace(/\s+/g,'')}tips`, `#${keyword.replace(/\s+/g,'')}content`], reach: 'High', strategy: 'Use in every post to build topic authority' },
    { name: 'Community', description: 'Engagement-focused community tags', hashtags: ['#community', '#smallbusiness', '#entrepreneur'], reach: 'Medium', strategy: 'Builds loyal follower base over time' },
    { name: 'Discovery', description: 'Platform algorithm and explore page tags', hashtags: ['#viral', '#trending', '#fyp'], reach: 'Very High', strategy: 'Maximise reach — use sparingly (1-2 per post)' }
  ];
}

async function _researchHashtags(keyword, platform) {
  if (!_hasPerplexity()) {
    return { hashtags: _templateHashtags(keyword, platform), clusters: _templateClusters(keyword), source: 'template' };
  }

  const platLabel = platform === 'tiktok' ? 'TikTok' : 'Instagram';
  const prompt = `Research the top-performing ${platLabel} hashtags for the topic "${keyword}" in 2024-2025.

Return ONLY a JSON object — no markdown, no explanation:
{
  "hashtags": [
    {"tag":"#example","estimated_posts":"1.2M","engagement":"high|medium|low","niche_score":85,"audience":"who uses this tag"},
    ... (30-50 total hashtags, mix of mega/large/medium/niche sizes)
  ]
}

Requirements:
- Include mega tags (>10M posts), large (1M-10M), medium (100K-1M), niche (<100K)
- All must be directly relevant to "${keyword}" on ${platLabel}
- niche_score: 1-100 (higher = more targeted / less saturated)
- Real hashtags only — never invent
`;

  const raw = await _perplexityCall(prompt);
  let hashtagList = [];
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      hashtagList = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
    }
  } catch (_) {}

  if (!hashtagList.length) {
    return { hashtags: _templateHashtags(keyword, platform).map(t => ({ tag: t, estimated_posts: '—', engagement: 'medium', niche_score: 50, audience: 'General' })), clusters: _templateClusters(keyword), source: 'template' };
  }

  let clusters = [];
  if (_hasOpenAI() && hashtagList.length) {
    const tagList = hashtagList.slice(0, 40).map(h => `${h.tag} (posts: ${h.estimated_posts}, niche_score: ${h.niche_score})`).join('\n');
    const clusterResult = await _openAICall([
      { role: 'system', content: `You are a social media strategist. Group hashtags into strategic clusters for ${platLabel} content planning. Return strict JSON only.` },
      { role: 'user', content: `Cluster these ${platLabel} hashtags for "${keyword}" into 4-6 strategic groups.

Hashtags:
${tagList}

Return strict JSON:
{
  "clusters": [
    {
      "name": "Cluster name (e.g. Core Topic, Community, Discovery, Niche Expert, Trending, Brand-Adjacent)",
      "description": "1-sentence strategy note",
      "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
      "reach": "Mega|High|Medium|Niche",
      "strategy": "When and how to use this cluster (1 sentence)",
      "post_frequency": "e.g. Every post | 3x per week | Trend-dependent"
    }
  ]
}` }
    ]);
    clusters = Array.isArray(clusterResult.clusters) ? clusterResult.clusters : _templateClusters(keyword);
  } else {
    clusters = _templateClusters(keyword);
  }

  return { hashtags: hashtagList, clusters, source: 'perplexity' };
}

router.get('/test', (req, res) => res.json({ ok: true, perplexity: _hasPerplexity(), openai: _hasOpenAI(), db: _db.hasDb && _db.hasDb() }));

router.post('/research', _safeAsync(async (req, res) => {
  const keyword  = String(req.body?.keyword || '').trim().slice(0, 200);
  const platform = ['instagram', 'tiktok'].includes(req.body?.platform) ? req.body.platform : 'instagram';
  if (!keyword) return _err(res, 400, 'keyword required');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required to research live hashtags');

  const { hashtags, clusters, source } = await _researchHashtags(keyword, platform);

  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_intel:research' });
      await _db.getPool().query(
        `INSERT INTO hashtag_intel_runs (tenant_id, platform, seed_keyword, hashtags, clusters, total_count) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, platform, keyword, JSON.stringify(hashtags), JSON.stringify(clusters), hashtags.length]
      );
    } catch (_) {}
  }

  res.json({ ok: true, keyword, platform, hashtags, clusters, total: hashtags.length, source });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_intel:runs' });
  const platform = req.query.platform;
  const where = platform ? 'WHERE tenant_id=$1 AND platform=$2' : 'WHERE tenant_id=$1';
  const params = platform ? [tid, platform] : [tid];
  const r = await _db.getPool().query(
    `SELECT id, platform, seed_keyword, clusters, total_count, created_at FROM hashtag_intel_runs ${where} ORDER BY created_at DESC LIMIT 30`,
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
