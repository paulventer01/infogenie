const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label, allowFallback: true });
}

const COUNTRY_TO_LOC = { us:2840, gb:2826, ca:2124, au:2036, in:2356, de:2276, fr:2250, jp:2392, br:2076, mx:2484, za:2710, nl:2528, es:2724, it:2380, sg:2702 };

function _hasCreds() {
  const u = process.env.DATAFORSEO_LOGIN, p = process.env.DATAFORSEO_PASSWORD;
  return u && p && !/^_DUMMY/i.test(u) && !/^_DUMMY/i.test(p);
}

async function _dfsPost(path, body) {
  if (!_hasCreds()) return null;
  const auth = 'Basic ' + Buffer.from(process.env.DATAFORSEO_LOGIN + ':' + process.env.DATAFORSEO_PASSWORD).toString('base64');
  const payload = JSON.stringify(body);
  return await new Promise((resolve) => {
    const req = _https.request({ hostname:'api.dataforseo.com', path, method:'POST',
      headers:{ 'Authorization':auth, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) } }, r => {
      let d=''; r.on('data', c => d += c); r.on('end', () => {
        try { if (r.statusCode !== 200) { console.warn('[keyword-explorer]', path, r.statusCode, d.slice(0,200)); return resolve(null); } resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => req.destroy());
    req.write(payload); req.end();
  });
}

function _mapMetrics(m) {
  if (!m) return null;
  return {
    search_volume: m.search_volume || 0,
    cpc: m.cpc || 0,
    competition: m.competition || 0,
    competition_level: m.competition_level || null,
    keyword_difficulty: m.keyword_properties?.keyword_difficulty || null,
    low_top_of_page_bid: m.low_top_of_page_bid || 0,
    high_top_of_page_bid: m.high_top_of_page_bid || 0,
    intent: m.search_intent_info?.main_intent || null,
  };
}

router.post('/explore', async (req, res) => {
  const seed = String(req.body?.seed || '').trim().slice(0, 80);
  const country = String(req.body?.country || 'us').toLowerCase().slice(0, 5);
  const limit = Math.min(50, Math.max(5, parseInt(req.body?.limit, 10) || 25));
  if (!seed) return _err(res, 400, 'seed required');
  const locCode = COUNTRY_TO_LOC[country] || 2840;

  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', note:'Set DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD for live keyword data.' });

  const [overview, ideas] = await Promise.all([
    _dfsPost('/v3/dataforseo_labs/google/keyword_overview/live', [{ keywords:[seed], language_code:'en', location_code: locCode, include_serp_info:false }]),
    _dfsPost('/v3/dataforseo_labs/google/keyword_ideas/live', [{ keywords:[seed], language_code:'en', location_code: locCode, limit, order_by:['keyword_info.search_volume,desc'] }]),
  ]);

  const seedItem = overview?.tasks?.[0]?.result?.[0]?.items?.[0];
  const seed_metrics = seedItem ? {
    keyword: seedItem.keyword,
    ..._mapMetrics(seedItem.keyword_info),
    keyword_difficulty: seedItem.keyword_properties?.keyword_difficulty || null,
    intent: seedItem.search_intent_info?.main_intent || null,
  } : { keyword: seed, search_volume:0, cpc:0, competition:0, keyword_difficulty:null };

  const ideasArr = (ideas?.tasks?.[0]?.result?.[0]?.items || [])
    .filter(it => it.keyword && it.keyword !== seed)
    .map(it => ({
      keyword: it.keyword,
      ..._mapMetrics(it.keyword_info),
      keyword_difficulty: it.keyword_properties?.keyword_difficulty || null,
      intent: it.search_intent_info?.main_intent || null,
    }))
    .slice(0, limit);

  if (_db.hasDb()) {
    try {
      const tid = await _tid(req, 'kw-explorer:explore');
      await _db.getPool().query(
        `INSERT INTO keyword_explorer_runs (tenant_id, seed, country, seed_metrics, ideas) VALUES ($1,$2,$3,$4,$5)`,
        [tid, seed, country, JSON.stringify(seed_metrics), JSON.stringify(ideasArr)]);
    } catch (e) { console.warn('[keyword-explorer] persist:', e.message); }
  }

  res.json({ ok:true, source:'dataforseo_labs', seed_metrics, ideas: ideasArr, total_ideas: ideasArr.length });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, runs:[] });
  try {
    const tid = await _tid(req, 'kw-explorer:history');
    const r = await _db.getPool().query(
      `SELECT id, seed, country, ran_at, jsonb_array_length(ideas) AS idea_count FROM keyword_explorer_runs WHERE tenant_id=$1 ORDER BY ran_at DESC LIMIT 30`,
      [tid]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'kw-explorer:get');
    const r = await _db.getPool().query(
      `SELECT * FROM keyword_explorer_runs WHERE id=$1 AND tenant_id=$2`,
      [Number(req.params.id), tid]);
    if (!r.rows.length) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
