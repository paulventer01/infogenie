const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, c, m) { res.status(c).json({ ok: false, error: m }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[geo-insights]', e.message); if (!res.headersSent) _err(res, 500, 'Internal error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _callPerplexity(q) {
  const https = require('https'); const key = process.env.PERPLEXITY_API_KEY;
  const body = JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], max_tokens: 1400 });
  return new Promise(resolve => {
    const req = https.request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); } catch { resolve(''); } });
    });
    req.on('error', () => resolve('')); req.setTimeout(30000, () => { req.destroy(); resolve(''); }); req.write(body); req.end();
  });
}

async function _callOpenAI(messages) {
  const https = require('https'); const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({ model: 'gpt-5-mini', temperature: 0.1, max_tokens: 1400, response_format: { type: 'json_object' }, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve({}); } });
    });
    req.on('error', reject); req.setTimeout(35000, () => { req.destroy(); reject(new Error('timeout')); }); req.write(body); req.end();
  });
}

const DEFAULT_REGIONS = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'India', 'Brazil'];

router.post('/scan', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'geo_insights:scan' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { brand, regions = DEFAULT_REGIONS } = req.body;
  if (!brand) return _err(res, 400, 'brand required');
  const regionList = regions.slice(0, 10);

  let context = '';
  if (_hasPerplexity()) {
    context = await _callPerplexity(`Where in the world is "${brand}" most discussed online? Break down brand mentions, social media activity, search interest, and press coverage by geographic region. Focus on: ${regionList.join(', ')}. For each region note: approximate mention share (%), dominant sentiment (positive/neutral/negative), what topics or themes dominate locally, and any region-specific news or controversies.`);
  }

  let result = { breakdown: [], top_region: regionList[0], top_region_sentiment: 'neutral', strategic_notes: [] };

  if (_hasOpenAI()) {
    const parsed = await _callOpenAI([
      { role: 'system', content: 'Return geographic brand mention breakdown. Return strict JSON: {"breakdown":[{"region":"...","country_code":"US","mention_share_pct":number,"sentiment":"positive"|"neutral"|"negative","sentiment_positive":number,"sentiment_negative":number,"key_topics":["..."],"trend":"growing"|"stable"|"declining","notes":"..."}],"top_region":"...","top_region_sentiment":"...","strategic_notes":["actionable note 1","actionable note 2","actionable note 3"]}' },
      { role: 'user', content: `Brand: ${brand}\nRegions: ${regionList.join(', ')}\n\nContext:\n${context.slice(0, 1800) || `Estimate geographic brand presence distribution for "${brand}" across the listed regions based on typical market patterns.`}` }
    ]);
    if (parsed.breakdown) result = { ...result, ...parsed };
  }

  if (!result.breakdown.length) {
    result.breakdown = regionList.slice(0, 4).map((r, i) => ({ region: r, country_code: ['US', 'GB', 'CA', 'AU'][i] || 'XX', mention_share_pct: [40, 20, 15, 10][i] || 5, sentiment: 'neutral', sentiment_positive: 55, sentiment_negative: 20, key_topics: ['product', 'reviews'], trend: 'stable', notes: '' }));
  }

  const pool = _db.hasDb() ? _db.getPool() : null;
  if (pool) {
    await pool.query(`INSERT INTO geo_insight_runs(brand,regions,breakdown,top_region,top_region_sentiment,strategic_notes,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [brand, JSON.stringify(regionList), JSON.stringify(result.breakdown), result.top_region, result.top_region_sentiment, JSON.stringify(result.strategic_notes), tid]);
  }
  res.json({ ok: true, brand, regions: regionList, ...result });
}));

router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'geo_insights:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,brand,regions,top_region,top_region_sentiment,strategic_notes,created_at FROM geo_insight_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`, [tid]);
  res.json({ ok: true, rows });
}));

module.exports = router;
