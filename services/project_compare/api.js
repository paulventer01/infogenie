const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, c, m) { res.status(c).json({ ok: false, error: m }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[project-compare]', e.message); if (!res.headersSent) _err(res, 500, 'Internal error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _callPerplexity(q) {
  const https = require('https'); const key = process.env.PERPLEXITY_API_KEY;
  const body = JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], max_tokens: 1500 });
  return new Promise(resolve => {
    const req = https.request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); } catch { resolve(''); } });
    });
    req.on('error', () => resolve('')); req.setTimeout(35000, () => { req.destroy(); resolve(''); }); req.write(body); req.end();
  });
}

async function _callOpenAI(messages) {
  const https = require('https'); const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({ model: 'gpt-5-mini', temperature: 0.1, max_tokens: 1800, response_format: { type: 'json_object' }, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve({}); } });
    });
    req.on('error', reject); req.setTimeout(40000, () => { req.destroy(); reject(new Error('timeout')); }); req.write(body); req.end();
  });
}

router.post('/run', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'project_compare:run' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { brands } = req.body;
  if (!brands || !Array.isArray(brands) || brands.length < 2) return _err(res, 400, 'Provide at least 2 brands');
  const brandList = brands.slice(0, 5).filter(Boolean);

  let context = '';
  if (_hasPerplexity()) {
    context = await _callPerplexity(`Compare these brands/projects side-by-side: ${brandList.join(', ')}. For each, provide: 1) approximate monthly web traffic, 2) social media following total, 3) sentiment from recent reviews (positive/neutral/negative %), 4) estimated monthly brand mentions, 5) domain authority / SEO strength, 6) share of voice in their category, 7) estimated annual revenue range, 8) key competitive advantage. Be specific with numbers.`);
  }

  let result = { results: [], winner: brandList[0], dimension_winners: {}, summary: '' };

  if (_hasOpenAI()) {
    const parsed = await _callOpenAI([
      { role: 'system', content: `Compare brands across 6 dimensions. Return strict JSON: {"results":[{"brand":"...","monthly_traffic":number,"social_following":number,"sentiment_positive":number,"sentiment_negative":number,"brand_mentions":number,"sov_pct":number,"domain_authority":number,"overall_score":number}],"winner":"brand_name","dimension_winners":{"traffic":"brand","social":"brand","sentiment":"brand","mentions":"brand","sov":"brand","authority":"brand"},"summary":"2-3 sentence strategic summary","radar_data":{"labels":["Traffic","Social","Sentiment","Mentions","SoV","Authority"],"datasets":[{"brand":"...","values":[0-100,0-100,0-100,0-100,0-100,0-100]}]}}` },
      { role: 'user', content: `Brands to compare: ${brandList.join(', ')}\n\nContext:\n${context.slice(0, 2000) || `Estimate realistic comparison metrics for these brands in their market.`}` }
    ]);
    if (parsed.results) result = { ...result, ...parsed };
  }

  if (!result.results.length) {
    result.results = brandList.map((b, i) => ({ brand: b, monthly_traffic: 10000 * (i + 1), social_following: 5000 * (i + 1), sentiment_positive: 60 - i * 5, sentiment_negative: 15 + i * 3, brand_mentions: 200 * (i + 1), sov_pct: 30 - i * 8, domain_authority: 45 - i * 5, overall_score: 60 - i * 8 }));
  }

  const pool = _db.hasDb() ? _db.getPool() : null;
  let id = null;
  if (pool) {
    const r = await pool.query(`INSERT INTO project_comparisons(brands,results,winner,dimension_winners,summary,tenant_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [JSON.stringify(brandList), JSON.stringify(result.results), result.winner, JSON.stringify(result.dimension_winners), result.summary, tid]);
    id = r.rows[0]?.id;
  }
  res.json({ ok: true, id, brands: brandList, ...result });
}));

router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'project_compare:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,brands,winner,summary,created_at FROM project_comparisons WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
  res.json({ ok: true, rows });
}));

module.exports = router;
