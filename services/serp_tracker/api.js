const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _normDomain(d) {
  return String(d || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

// Approximate organic CTR curve used for keyword visibility / SoV.
const CTR_BY_POS = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.061,
  6: 0.049, 7: 0.04, 8: 0.033, 9: 0.027, 10: 0.022,
  11: 0.018, 12: 0.015, 13: 0.013, 14: 0.011, 15: 0.01,
  16: 0.009, 17: 0.008, 18: 0.007, 19: 0.006, 20: 0.005,
};
function _ctr(pos) {
  if (pos == null || pos < 1) return 0;
  if (pos <= 20) return CTR_BY_POS[pos] || 0.004;
  return 0.002;
}

const ALLOWED_COUNTRIES = new Set([
  'us', 'gb', 'au', 'ca', 'za', 'de', 'fr', 'es', 'it', 'nl', 'br', 'mx', 'in', 'sg', 'ae', 'jp', 'mu', 'global',
]);
const COUNTRY_TO_LOC = {
  us: 2840, gb: 2826, ca: 2124, au: 2036, in: 2356, de: 2276, fr: 2250, jp: 2392,
  br: 2076, mx: 2484, za: 2710, nl: 2528, es: 2724, it: 2380, sg: 2702, ae: 2784,
  mu: 2480,
  global: 2840,
};

function _normCountry(raw) {
  let c = String(raw || 'us').toLowerCase().trim().slice(0, 16);
  if (c === 'globa') c = 'global';
  if (!ALLOWED_COUNTRIES.has(c)) c = 'us';
  return c;
}

function _normCompetitors(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[,;\s]+/) : []);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const d = _normDomain(item);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= 10) break;
  }
  return out;
}

function _domainMatch(a, b) {
  const x = _normDomain(a);
  const y = _normDomain(b);
  if (!x || !y) return false;
  return x === y || x.endsWith('.' + y) || y.endsWith('.' + x);
}

async function _serpSearch(q, country) {
  const login = process.env.DATAFORSEO_LOGIN, pw = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pw || /^_DUMMY/i.test(login) || /^_DUMMY/i.test(pw)) return null;
  const auth = 'Basic ' + Buffer.from(login + ':' + pw).toString('base64');
  // Prefer advanced endpoint so we can capture SERP features (snippets, PAA, local pack…).
  const body = JSON.stringify([{
    language_code: 'en',
    location_code: COUNTRY_TO_LOC[country] || 2840,
    keyword: q,
    depth: 20,
  }]);
  const tryPath = (path) => new Promise((resolve) => {
    const req = _https.request({
      hostname: 'api.dataforseo.com', path, method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) {
            console.warn('[serp-tracker]', path, r.statusCode, d.slice(0, 200));
            return resolve(null);
          }
          resolve(JSON.parse(d));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(45000, () => req.destroy());
    req.write(body);
    req.end();
  });

  let raw = await tryPath('/v3/serp/google/organic/live/advanced');
  if (!raw) raw = await tryPath('/v3/serp/google/organic/live/regular');
  return raw;
}

function _extractOrganic(items) {
  return (items || [])
    .filter((it) => it && it.type === 'organic' && (it.rank_absolute || it.rank_group))
    .map((it) => ({
      position: Number(it.rank_absolute || it.rank_group),
      title: it.title || '',
      link: it.url || it.link || '',
      displayLink: it.domain || '',
      snippet: it.description || it.snippet || '',
    }))
    .filter((it) => it.position >= 1)
    .sort((a, b) => a.position - b.position)
    .slice(0, 20);
}

function _extractFeatures(items) {
  const features = {
    featured_snippet: false,
    people_also_ask: false,
    local_pack: false,
    images: false,
    video: false,
    sitelinks: false,
    knowledge_graph: false,
    ai_overview: false,
    shopping: false,
    types: [],
  };
  const typeMap = {
    featured_snippet: 'featured_snippet',
    answer_box: 'featured_snippet',
    people_also_ask: 'people_also_ask',
    local_pack: 'local_pack',
    maps: 'local_pack',
    images: 'images',
    video: 'video',
    videos: 'video',
    sitelinks: 'sitelinks',
    knowledge_graph: 'knowledge_graph',
    ai_overview: 'ai_overview',
    shopping: 'shopping',
    product_considerations: 'shopping',
  };
  for (const it of items || []) {
    const t = String(it?.type || '').toLowerCase();
    if (!t) continue;
    if (!features.types.includes(t)) features.types.push(t);
    const key = typeMap[t];
    if (key) features[key] = true;
    // Organic rows can still carry sitelinks.
    if (t === 'organic' && (it.links || it.sitelinks)) features.sitelinks = true;
  }
  return features;
}

function _findTarget(items, target) {
  const tn = _normDomain(target);
  for (const it of items) {
    if (_domainMatch(it.displayLink || '', tn) || _domainMatch(it.link || '', tn)) {
      return { position: it.position, url: it.link };
    }
  }
  return { position: null, url: null };
}

function _competitorPositions(items, competitors) {
  const out = {};
  for (const c of competitors || []) {
    const hit = _findTarget(items, c);
    out[c] = { position: hit.position, url: hit.url };
  }
  return out;
}

function _bucket(pos) {
  if (pos == null) return 'unranked';
  if (pos <= 3) return '1-3';
  if (pos <= 10) return '4-10';
  if (pos <= 20) return '11-20';
  return '21+';
}

// List keywords for this tenant, with last-run summary.
router.get('/keywords', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:keywords-list');
    await _db.getPool().query(
      `UPDATE serp_tracker_keywords SET country='global' WHERE tenant_id=$1 AND country='globa'`,
      [tid]
    ).catch(() => {});
    const r = await _db.getPool().query(`
      SELECT k.*, lr.target_position AS last_position, lr.target_url AS last_url,
             lr.ran_at AS last_run_at, lr.serp_features AS last_features,
             lr.competitor_positions AS last_competitor_positions
      FROM serp_tracker_keywords k
      LEFT JOIN LATERAL (
        SELECT target_position, target_url, ran_at, serp_features, competitor_positions
        FROM serp_tracker_runs WHERE keyword_id=k.id AND tenant_id=$1
        ORDER BY ran_at DESC LIMIT 1
      ) lr ON true
      WHERE k.tenant_id=$1
      ORDER BY k.created_at DESC`, [tid]);
    res.json({ ok: true, keywords: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/keywords', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const keyword = String(req.body?.keyword || '').trim().slice(0, 200);
  const target_domain = _normDomain(req.body?.target_domain || '');
  const country = _normCountry(req.body?.country);
  const competitors = _normCompetitors(req.body?.competitors);
  if (!keyword || !target_domain) return _err(res, 400, 'keyword + target_domain required');
  try {
    const tid = await _tid(req, 'serp:keywords-add');
    const r = await _db.getPool().query(
      `INSERT INTO serp_tracker_keywords (tenant_id, keyword, target_domain, country, competitors)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (tenant_id, keyword, target_domain, country)
       DO UPDATE SET enabled=true,
         competitors = CASE
           WHEN jsonb_array_length(EXCLUDED.competitors) > 0 THEN EXCLUDED.competitors
           ELSE serp_tracker_keywords.competitors
         END
       RETURNING *`,
      [tid, keyword, target_domain, country, JSON.stringify(competitors)]);
    res.json({ ok: true, keyword: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// PATCH competitors on an existing keyword (and optionally sync to all keywords for same domain).
router.patch('/keywords/:id/competitors', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:competitors');
    const id = Number(req.params.id);
    const competitors = _normCompetitors(req.body?.competitors);
    const applyAll = !!req.body?.apply_all;
    const own = await _db.getPool().query(
      `SELECT * FROM serp_tracker_keywords WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!own.rows.length) return _err(res, 404, 'keyword not found');
    if (applyAll) {
      await _db.getPool().query(
        `UPDATE serp_tracker_keywords SET competitors=$1::jsonb
         WHERE tenant_id=$2 AND target_domain=$3`,
        [JSON.stringify(competitors), tid, own.rows[0].target_domain]);
    } else {
      await _db.getPool().query(
        `UPDATE serp_tracker_keywords SET competitors=$1::jsonb WHERE id=$2 AND tenant_id=$3`,
        [JSON.stringify(competitors), id, tid]);
    }
    res.json({ ok: true, competitors });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/keywords/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:keywords-del');
    await _db.getPool().query(
      `DELETE FROM serp_tracker_keywords WHERE id=$1 AND tenant_id=$2`,
      [Number(req.params.id), tid]
    );
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

async function _scanOne(id, tenantId) {
  const k = (await _db.getPool().query(
    `SELECT * FROM serp_tracker_keywords WHERE id=$1 AND tenant_id=$2`,
    [id, tenantId]
  )).rows[0];
  if (!k) return { ok: false, error: 'keyword not found' };
  const raw = await _serpSearch(k.keyword, k.country);
  if (!raw) {
    return {
      ok: true,
      source: 'placeholder',
      note: 'DATAFORSEO credentials missing or call failed — set DATAFORSEO_LOGIN/PASSWORD for live SERP tracking.',
    };
  }
  const result = raw.tasks?.[0]?.result?.[0];
  const allItems = result?.items || [];
  const organic = _extractOrganic(allItems);
  const features = _extractFeatures(allItems);
  const competitors = Array.isArray(k.competitors) ? k.competitors : [];
  const target = _findTarget(organic, k.target_domain);
  const compPos = _competitorPositions(organic, competitors);
  const totalResults = result?.se_results_count ? String(result.se_results_count) : '';
  const ins = await _db.getPool().query(
    `INSERT INTO serp_tracker_runs
       (tenant_id, keyword_id, target_position, target_url, total_results, results, serp_features, competitor_positions)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING *`,
    [
      k.tenant_id, id, target.position, target.url, totalResults,
      JSON.stringify(organic), JSON.stringify(features), JSON.stringify(compPos),
    ]);
  return { ok: true, source: 'dataforseo', run: ins.rows[0], target, features, competitor_positions: compPos };
}

router.post('/scan/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:scan-one');
    const r = await _scanOne(Number(req.params.id), tid);
    if (!r.ok) return _err(res, 404, r.error);
    res.json(r);
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/scan-all', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:scan-all');
    const ks = (await _db.getPool().query(
      `SELECT id FROM serp_tracker_keywords WHERE enabled=true AND tenant_id=$1`, [tid]
    )).rows;
    let scanned = 0, failed = 0;
    for (const k of ks) {
      try {
        const r = await _scanOne(k.id, tid);
        if (r.ok && r.source === 'dataforseo') scanned++;
        else failed++;
      } catch { failed++; }
    }
    res.json({ ok: true, scanned, failed, total: ks.length });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/history/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:history');
    const own = await _db.getPool().query(
      `SELECT 1 FROM serp_tracker_keywords WHERE id=$1 AND tenant_id=$2`,
      [Number(req.params.id), tid]
    );
    if (!own.rows.length) return _err(res, 404, 'keyword not found');
    const r = await _db.getPool().query(
      `SELECT id, target_position, target_url, total_results, serp_features, competitor_positions, ran_at
       FROM serp_tracker_runs WHERE keyword_id=$1 AND tenant_id=$2
       ORDER BY ran_at DESC LIMIT 60`,
      [Number(req.params.id), tid]);
    res.json({ ok: true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// Latest SERP snapshot for one keyword (organic + features + competitors).
router.get('/run-latest/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:run-latest');
    const r = await _db.getPool().query(
      `SELECT r.*, k.keyword, k.target_domain, k.competitors, k.country
       FROM serp_tracker_runs r
       JOIN serp_tracker_keywords k ON k.id=r.keyword_id
       WHERE r.keyword_id=$1 AND r.tenant_id=$2 AND k.tenant_id=$2
       ORDER BY r.ran_at DESC LIMIT 1`,
      [Number(req.params.id), tid]);
    if (!r.rows.length) return res.json({ ok: true, run: null });
    res.json({ ok: true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

async function _latestRuns(tid) {
  const r = await _db.getPool().query(`
    SELECT k.id AS keyword_id, k.keyword, k.target_domain, k.country, k.competitors,
           lr.target_position, lr.target_url, lr.results, lr.serp_features,
           lr.competitor_positions, lr.ran_at, lr.total_results
    FROM serp_tracker_keywords k
    LEFT JOIN LATERAL (
      SELECT * FROM serp_tracker_runs
      WHERE keyword_id=k.id AND tenant_id=$1
      ORDER BY ran_at DESC LIMIT 1
    ) lr ON true
    WHERE k.tenant_id=$1 AND k.enabled=true
    ORDER BY k.keyword ASC`, [tid]);
  return r.rows;
}

// Landscape / overview: visibility, SoV, distribution, avg position.
router.get('/landscape', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'serp:landscape');
    const rows = await _latestRuns(tid);
    const featureFilter = String(req.query.feature || '').trim().toLowerCase();

    let filtered = rows;
    if (featureFilter) {
      filtered = rows.filter((r) => {
        const f = r.serp_features || {};
        if (featureFilter === 'any') return Object.keys(f).some((k) => k !== 'types' && f[k] === true);
        return !!f[featureFilter];
      });
    }

    const buckets = { '1-3': 0, '4-10': 0, '11-20': 0, '21+': 0, unranked: 0 };
    let posSum = 0, posN = 0, visibilityPts = 0;
    const sovMap = new Map(); // domain → visibility points
    const pages = new Map(); // url → {url, keywords:[], bestPosition}
    const cannibal = [];
    const competitorsDiscovered = new Map();

    for (const row of filtered) {
      const b = _bucket(row.target_position);
      buckets[b] = (buckets[b] || 0) + 1;
      if (row.target_position != null) {
        posSum += row.target_position;
        posN += 1;
        visibilityPts += _ctr(row.target_position);
      }

      const targetDom = _normDomain(row.target_domain);
      const addSov = (dom, pos) => {
        if (!dom) return;
        const cur = sovMap.get(dom) || 0;
        sovMap.set(dom, cur + _ctr(pos));
      };
      addSov(targetDom, row.target_position);

      const comps = row.competitor_positions || {};
      for (const [dom, info] of Object.entries(comps)) {
        addSov(_normDomain(dom), info?.position);
      }

      // Pages + cannibalization from organic results for target domain.
      const organic = Array.isArray(row.results) ? row.results : [];
      const targetUrls = [];
      for (const it of organic) {
        const dom = _normDomain(it.displayLink || it.link || '');
        if (!dom) continue;
        if (!_domainMatch(dom, targetDom)) {
          // Competitors Discovery — domains ranking for tracked keywords.
          const cur = competitorsDiscovered.get(dom) || { domain: dom, keywords: 0, best_position: null, sample_url: it.link };
          cur.keywords += 1;
          if (cur.best_position == null || (it.position != null && it.position < cur.best_position)) {
            cur.best_position = it.position;
            cur.sample_url = it.link;
          }
          competitorsDiscovered.set(dom, cur);
          continue;
        }
        const url = String(it.link || '').split('?')[0];
        if (!url) continue;
        targetUrls.push({ url, position: it.position });
        const p = pages.get(url) || { url, keywords: [], best_position: null };
        p.keywords.push({ keyword: row.keyword, position: it.position });
        if (p.best_position == null || it.position < p.best_position) p.best_position = it.position;
        pages.set(url, p);
      }
      if (targetUrls.length > 1) {
        cannibal.push({
          keyword: row.keyword,
          country: row.country,
          urls: targetUrls,
        });
      }

      if (row.target_url) {
        const url = String(row.target_url).split('?')[0];
        const p = pages.get(url) || { url, keywords: [], best_position: null };
        if (!p.keywords.some((k) => k.keyword === row.keyword)) {
          p.keywords.push({ keyword: row.keyword, position: row.target_position });
        }
        if (row.target_position != null && (p.best_position == null || row.target_position < p.best_position)) {
          p.best_position = row.target_position;
        }
        pages.set(url, p);
      }
    }

    const totalKw = filtered.length || 1;
    const maxPossible = filtered.length * _ctr(1);
    const visibilityPct = maxPossible > 0 ? Math.round((visibilityPts / maxPossible) * 1000) / 10 : 0;
    const avgPosition = posN ? Math.round((posSum / posN) * 10) / 10 : null;

    // Estimated traffic = sum(ctr) * assumed volume placeholder (1k/mo per kw) when volume unknown.
    const assumedVolume = 1000;
    const estimatedTraffic = Math.round(visibilityPts * assumedVolume);

    const sovTotal = [...sovMap.values()].reduce((a, b) => a + b, 0) || 1;
    const shareOfVoice = [...sovMap.entries()]
      .map(([domain, pts]) => ({
        domain,
        points: Math.round(pts * 1000) / 1000,
        share_pct: Math.round((pts / sovTotal) * 1000) / 10,
        is_target: filtered.some((r) => _domainMatch(r.target_domain, domain)),
      }))
      .sort((a, b) => b.share_pct - a.share_pct)
      .slice(0, 15);

    // Aggregate competitor list from keyword settings.
    const trackedCompetitors = new Set();
    for (const row of rows) {
      for (const c of (row.competitors || [])) trackedCompetitors.add(_normDomain(c));
    }

    res.json({
      ok: true,
      summary: {
        keywords: filtered.length,
        visibility_pct: visibilityPct,
        estimated_traffic: estimatedTraffic,
        average_position: avgPosition,
        distribution: buckets,
      },
      share_of_voice: shareOfVoice,
      pages: [...pages.values()]
        .map((p) => ({ ...p, keyword_count: p.keywords.length }))
        .sort((a, b) => (a.best_position || 999) - (b.best_position || 999)),
      cannibalization: cannibal,
      competitors_tracked: [...trackedCompetitors],
      competitors_discovered: [...competitorsDiscovered.values()]
        .filter((c) => ![...trackedCompetitors].some((t) => _domainMatch(t, c.domain)))
        .filter((c) => !filtered.some((r) => _domainMatch(r.target_domain, c.domain)))
        .sort((a, b) => b.keywords - a.keywords || (a.best_position || 999) - (b.best_position || 999))
        .slice(0, 25),
      features_present: _aggregateFeatures(filtered),
      keywords: filtered.map((r) => ({
        id: r.keyword_id,
        keyword: r.keyword,
        target_domain: r.target_domain,
        country: r.country,
        position: r.target_position,
        url: r.target_url,
        competitors: r.competitors || [],
        competitor_positions: r.competitor_positions || {},
        serp_features: r.serp_features || {},
        ran_at: r.ran_at,
      })),
    });
  } catch (e) { _err(res, 500, e.message); }
});

function _aggregateFeatures(rows) {
  const counts = {
    featured_snippet: 0,
    people_also_ask: 0,
    local_pack: 0,
    images: 0,
    video: 0,
    sitelinks: 0,
    knowledge_graph: 0,
    ai_overview: 0,
    shopping: 0,
  };
  for (const r of rows) {
    const f = r.serp_features || {};
    for (const k of Object.keys(counts)) {
      if (f[k]) counts[k] += 1;
    }
  }
  return counts;
}

module.exports = router;
module.exports._normCountry = _normCountry;
module.exports._normCompetitors = _normCompetitors;
module.exports._ctr = _ctr;
module.exports._bucket = _bucket;
module.exports.ALLOWED_COUNTRIES = ALLOWED_COUNTRIES;
