const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

async function _fetchMentions(brand, days) {
  const port = process.env.PORT || 5000;
  return await new Promise((resolve) => {
    const http = require('http');
    const req = http.request({
      hostname:'127.0.0.1', port, method:'GET',
      path:`/api/mentions?brand=${encodeURIComponent(brand)}&days=${encodeURIComponent(days)}`,
      headers: process.env.INFOGENIE_API_KEY ? { 'x-api-key': process.env.INFOGENIE_API_KEY } : {},
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { resolve(JSON.parse(d)); } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(45000, () => req.destroy());
    req.end();
  });
}

async function _aiCluster({ brand, mentions }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sample = mentions.slice(0, 80).map((m, i) => `[${i+1}] (${m.sentiment||'?'}) ${(m.title||'').slice(0, 90)} — ${(m.snippet||m.text||'').slice(0, 200)}`).join('\n');
  const sys = `You are a senior customer-insights analyst. Cluster the customer mentions about ${brand} into 4-8 distinct themes.
Return strict JSON in this exact shape:
{"summary":"<2-3 sentence executive read of what customers are saying>","themes":[{"label":"<short 2-5 word theme>","kind":"praise|complaint|question|feature_request|neutral","frequency":<int count of mentions in this theme>,"share":<float 0-1 of total>,"sentiment_score":<float -1..1>,"top_quotes":["<verbatim or near-verbatim 1-line quote>","..."],"recommended_action":"<1 concrete next step the brand should take>"}]}
Rules:
- Themes must be mutually exclusive and cover the most-discussed topics first.
- top_quotes: 2-3 short, real-feeling quotes drawn from the actual snippets.
- recommended_action must be specific (not "do better"); cite the kind of fix (product, comms, support, pricing).`;
  const user = `Brand: ${brand}\nMentions (${mentions.length}):\n${sample}\n\nCluster now.`;
  const body = JSON.stringify({
    model:'gpt-4o-mini',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    response_format: { type:'json_object' },
    temperature: 0.4, max_tokens: 2500,
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

function _templateCluster({ brand, mentions }) {
  const buckets = { praise:[], complaint:[], neutral:[] };
  for (const m of mentions) {
    const s = (m.sentiment||'').toLowerCase();
    const k = s === 'positive' ? 'praise' : s === 'negative' ? 'complaint' : 'neutral';
    buckets[k].push(m);
  }
  const total = mentions.length || 1;
  const themes = Object.entries(buckets).filter(([_,arr]) => arr.length).map(([kind, arr]) => ({
    label: kind === 'praise' ? 'Positive sentiment' : kind === 'complaint' ? 'Customer complaints' : 'Neutral mentions',
    kind, frequency: arr.length, share: arr.length/total,
    sentiment_score: kind==='praise'?0.7:kind==='complaint'?-0.7:0,
    top_quotes: arr.slice(0,3).map(m => (m.snippet||m.title||'').slice(0,140)),
    recommended_action: kind==='complaint' ? 'Triage top complaints with support team and post a public response within 24h.' : kind==='praise' ? 'Amplify the positive themes via social proof in current campaigns.' : 'Monitor for emerging signals.',
  }));
  return { summary: `Sampled ${mentions.length} mentions of ${brand}. ${buckets.complaint.length} negative, ${buckets.praise.length} positive, ${buckets.neutral.length} neutral.`, themes };
}

router.post('/mine', async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const days = Math.min(60, Math.max(1, parseInt(req.body?.days, 10) || 14));
  if (!brand) return _err(res, 400, 'brand required');
  const m = await _fetchMentions(brand, days);
  const mentions = (m && m.mentions) ? m.mentions : [];
  if (!mentions.length) return res.json({ ok:true, source:'empty', brand, mention_count:0, summary:'No mentions returned for this brand in the selected window.', themes: [] });
  let result = await _aiCluster({ brand, mentions });
  let source = 'openai';
  if (!result || !Array.isArray(result.themes)) { result = _templateCluster({ brand, mentions }); source = 'template'; }
  if (_db.hasDb()) {
    try {
      const tid = await _tid(req, 'voc:mine');
      await _db.getPool().query(
        `INSERT INTO voc_runs (tenant_id, brand, lookback_days, mention_count, themes, summary, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, brand, days, mentions.length, JSON.stringify(result.themes), result.summary || '', source]);
    } catch (e) { console.warn('[voc] persist failed:', e.message); }
  }
  res.json({ ok:true, source, brand, days, mention_count: mentions.length, summary: result.summary || '', themes: result.themes });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const tid = await _tid(req, 'voc:history');
    const r = await _db.getPool().query(
      `SELECT id, brand, lookback_days, mention_count, summary, generated_by, created_at FROM voc_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [tid, limit]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  try {
    const tid = await _tid(req, 'voc:get');
    const r = await _db.getPool().query(
      `SELECT * FROM voc_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
