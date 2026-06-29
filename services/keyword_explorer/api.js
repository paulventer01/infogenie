const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

// ── RapidAPI: keyword-research-for-seo.p.rapidapi.com ────────────────────────
const _KW_HOST = 'keyword-research-for-seo.p.rapidapi.com';

function _hasRapidAPIKeywords() {
  const k = process.env.RAPIDAPI_KEY;
  return !!(k && !/^_DUMMY/i.test(k));
}

function _rapidAPIGet(path, params) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const qs = new URLSearchParams(params).toString();
  const fullPath = qs ? `${path}?${qs}` : path;
  return new Promise(resolve => {
    const req = _https.request({
      hostname: _KW_HOST,
      path: fullPath,
      method: 'GET',
      headers: {
        'x-rapidapi-key': key,
        'x-rapidapi-host': _KW_HOST,
        'Accept': 'application/json',
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) {
            console.warn('[keyword-explorer] RapidAPI', r.statusCode, d.slice(0, 200));
            return resolve(null);
          }
          resolve(JSON.parse(d));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Normalise competition string/number to 0-1 float + level label
function _parseCompetition(raw) {
  if (raw == null) return { competition: 0, competition_level: null };
  if (typeof raw === 'number') {
    const level = raw > 0.66 ? 'HIGH' : raw > 0.33 ? 'MEDIUM' : 'LOW';
    return { competition: raw, competition_level: level };
  }
  const s = String(raw).toUpperCase();
  const map = { HIGH: 0.85, MEDIUM: 0.5, LOW: 0.2, 'VERY_LOW': 0.1 };
  return { competition: map[s] ?? 0, competition_level: s };
}

function _mapRapidAPIItem(item) {
  if (!item || !item.keyword) return null;
  const vol = parseInt(item.search_volume ?? item.monthly_searches ?? 0, 10) || 0;
  const cpc = parseFloat(item.cpc ?? item.cpc_range?.min ?? 0) || 0;
  const { competition, competition_level } = _parseCompetition(item.competition ?? item.competition_level);
  return {
    keyword: item.keyword,
    search_volume: vol,
    cpc,
    competition,
    competition_level,
    keyword_difficulty: item.keyword_difficulty ?? null,
    low_top_of_page_bid: parseFloat(item.low_bid ?? 0) || 0,
    high_top_of_page_bid: parseFloat(item.high_bid ?? 0) || 0,
    intent: item.search_intent ?? item.intent ?? null,
  };
}

const COUNTRY_TO_LOC = {
  us:2840, gb:2826, ca:2124, au:2036, in:2356, de:2276, fr:2250, jp:2392, br:2076, mx:2484,
  za:2710, nl:2528, es:2724, it:2380, sg:2702, ae:2784, ch:2756, se:2752, no:2578, dk:2208,
  fi:2246, pl:2616, ru:2643, tr:2792, ar:2032, co:2170, cl:2152, nz:2554, ph:2608, id:2360,
  my:2458, th:2764, kr:2410, cn:2156, hk:2344, tw:2158, eg:2818, ng:2566, ke:2404, gh:2288,
  pk:2586, bd:2050, il:2376, sa:2682, at:2040, be:2056, pt:2620, cz:2203, ro:2642, hu:2348,
  ie:2372, gr:2300
};

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
  const country = String(req.body?.country || 'us').toLowerCase().slice(0, 6);
  const limit = Math.min(50, Math.max(5, parseInt(req.body?.limit, 10) || 25));
  if (!seed) return _err(res, 400, 'seed required');
  const isGlobal = country === 'global' || country === '';
  const locCode = isGlobal ? null : (COUNTRY_TO_LOC[country] || 2840);

  // ── RapidAPI fallback when DataForSEO is not configured ──────────────────
  if (!_hasCreds()) {
    if (_hasRapidAPIKeywords()) {
      try {
        const cc = isGlobal ? 'us' : country;
        const lang = 'en';
        // keyword_suggestions is the single valid endpoint on this API —
        // it returns the seed keyword as the first item plus related suggestions
        const sugRes = await _rapidAPIGet('/keyword_suggestions', { keyword: seed, country: cc, lang });
        // Normalise: API may return array, { keywords: [] }, or { data: [] }
        const rawAll = Array.isArray(sugRes)
          ? sugRes
          : (Array.isArray(sugRes?.keywords) ? sugRes.keywords
            : Array.isArray(sugRes?.data) ? sugRes.data : []);

        // First item whose keyword matches seed (or first item) = seed metrics
        const seedIdx = rawAll.findIndex(it => it?.keyword === seed);
        const seedRaw = rawAll[seedIdx >= 0 ? seedIdx : 0];
        const seed_metrics = _mapRapidAPIItem(seedRaw ? { ...seedRaw, keyword: seed } : { keyword: seed }) || {
          keyword: seed, search_volume: 0, cpc: 0, competition: 0, keyword_difficulty: null,
        };
        // Remaining items = ideas, excluding the seed itself
        const ideas = rawAll
          .filter((it, i) => i !== (seedIdx >= 0 ? seedIdx : 0))
          .map(it => _mapRapidAPIItem(it))
          .filter(Boolean)
          .filter(it => it.keyword !== seed)
          .slice(0, limit);

        if (_db.hasDb()) {
          try {
            const tid = await _tid(req, 'kw-explorer:explore');
            await _db.getPool().query(
              `INSERT INTO keyword_explorer_runs (tenant_id, seed, country, seed_metrics, ideas) VALUES ($1,$2,$3,$4,$5)`,
              [tid, seed, country, JSON.stringify(seed_metrics), JSON.stringify(ideas)]);
          } catch (e) { console.warn('[keyword-explorer] persist:', e.message); }
        }

        return res.json({ ok: true, source: 'rapidapi_keyword_research', seed_metrics, ideas, total_ideas: ideas.length });
      } catch (e) {
        console.warn('[keyword-explorer] RapidAPI error:', e.message);
      }
    }
    return res.json({ ok:true, source:'placeholder', note:'Configure DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD or RAPIDAPI_KEY for live keyword data.' });
  }

  // Build request bodies — omit location_code for global queries
  const _overviewBody = isGlobal
    ? [{ keywords:[seed], language_code:'en', include_serp_info:false }]
    : [{ keywords:[seed], language_code:'en', location_code: locCode, include_serp_info:false }];
  const _ideasBody = isGlobal
    ? [{ keywords:[seed], language_code:'en', limit, order_by:['keyword_info.search_volume,desc'] }]
    : [{ keywords:[seed], language_code:'en', location_code: locCode, limit, order_by:['keyword_info.search_volume,desc'] }];

  const [overview, ideas] = await Promise.all([
    _dfsPost('/v3/dataforseo_labs/google/keyword_overview/live', _overviewBody),
    _dfsPost('/v3/dataforseo_labs/google/keyword_ideas/live', _ideasBody),
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
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return _err(res, 400, 'invalid id');
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'kw-explorer:get');
    const r = await _db.getPool().query(
      `SELECT * FROM keyword_explorer_runs WHERE id=$1 AND tenant_id=$2`,
      [id, tid]);
    if (!r.rows.length) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
