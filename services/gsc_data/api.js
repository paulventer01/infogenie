const express    = require('express');
const _https     = require('https');
const router     = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

// ── DataForSEO POST helper ────────────────────────────────────────────────
function _dfsPost(path, body) {
  return new Promise(resolve => {
    const u = process.env.DATAFORSEO_LOGIN;
    const p = process.env.DATAFORSEO_PASSWORD;
    if (!u || !p) return resolve({ ok: false, error: 'no_creds' });
    const auth    = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
    const payload = JSON.stringify(body);
    const req = _https.request({
      hostname: 'api.dataforseo.com', path, method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve({ ok: j.status_code === 20000, tasks: j.tasks || [], raw: j });
        } catch { resolve({ ok: false, error: 'parse' }); }
      });
    });
    req.on('error', () => resolve({ ok: false, error: 'network' }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

// ── Normalise domain ──────────────────────────────────────────────────────
function _normDomain(raw) {
  return (raw || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim().toLowerCase();
}

// ── POST /fetch ───────────────────────────────────────────────────────────
// Body: { domain: "acme.com", location_code: 2840, language_code: "en" }
router.post('/fetch', async (req, res) => {
  const raw = _normDomain(req.body?.domain);
  if (!raw) return _err(res, 400, 'domain required');

  const loc  = req.body?.location_code  || 2840;
  const lang = req.body?.language_code  || 'en';

  // Parallel: overview + keywords + history
  const [overviewRes, kwRes, histRes] = await Promise.all([
    _dfsPost('/v3/dataforseo_labs/google/domain_rank_overview/live', [{
      target: raw, location_code: loc, language_code: lang,
    }]),
    _dfsPost('/v3/dataforseo_labs/google/ranked_keywords/live', [{
      target: raw, location_code: loc, language_code: lang,
      limit: 100, order_by: ['keyword_data.keyword_info.search_volume,desc'],
    }]),
    _dfsPost('/v3/dataforseo_labs/google/historical_rank_overview/live', [{
      target: raw, location_code: loc, language_code: lang,
    }]),
  ]);

  // ── Overview ─────────────────────────────────────────────────────────
  const ovItem = overviewRes?.tasks?.[0]?.result?.[0]?.metrics?.organic;
  const overview = ovItem ? {
    etv:           Math.round(ovItem.etv        || 0),
    keywords_count: ovItem.count               || 0,
    pos_1:          ovItem.pos_1               || 0,
    pos_2_3:        ovItem.pos_2_3             || 0,
    pos_4_10:       ovItem.pos_4_10            || 0,
    pos_11_20:      ovItem.pos_11_20           || 0,
    pos_21_30:      ovItem.pos_21_30           || 0,
    avg_position:   Number((ovItem.avg_position || 0).toFixed(1)),
  } : null;

  // ── Keywords ──────────────────────────────────────────────────────────
  const rawKws = kwRes?.tasks?.[0]?.result?.[0]?.items || [];
  const keywords = rawKws.slice(0, 100).map(k => {
    const kd = k.keyword_data || {};
    const ki = kd.keyword_info || {};
    const rd = k.ranked_serp_element?.serp_item || {};
    const vol = ki.search_volume || 0;
    const pos = rd.rank_absolute || rd.rank_group || 0;
    // Estimated CTR by position bucket
    const ctr = pos === 1 ? 0.28 : pos <= 3 ? 0.15 : pos <= 10 ? 0.06 : 0.02;
    const clicks = Math.round(vol * ctr);
    return {
      keyword:    kd.keyword || '',
      position:   pos,
      volume:     vol,
      clicks,
      ctr:        Math.round(ctr * 1000) / 10,
      url:        rd.url || '',
      competition: ki.competition_level || '',
      trend:      ki.monthly_searches?.slice(-6).map(m => m.search_volume) || [],
    };
  }).filter(k => k.keyword);

  // ── Pages (aggregate by URL) ──────────────────────────────────────────
  const pageMap = {};
  for (const k of keywords) {
    const url = k.url || '(not set)';
    if (!pageMap[url]) pageMap[url] = { url, clicks: 0, impressions: 0, keywords: 0, avg_pos_sum: 0 };
    pageMap[url].clicks      += k.clicks;
    pageMap[url].impressions += k.volume;
    pageMap[url].keywords    += 1;
    pageMap[url].avg_pos_sum += k.position;
  }
  const pages = Object.values(pageMap)
    .map(p => ({
      url:        p.url,
      clicks:     p.clicks,
      impressions: p.impressions,
      ctr:        p.impressions > 0 ? Math.round(p.clicks / p.impressions * 1000) / 10 : 0,
      avg_pos:    p.keywords > 0 ? Math.round(p.avg_pos_sum / p.keywords * 10) / 10 : 0,
      keywords:   p.keywords,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 50);

  // ── History (monthly trend) ───────────────────────────────────────────
  const histItems = histRes?.tasks?.[0]?.result?.[0]?.history || [];
  const history = histItems.map(h => ({
    date:     h.date || '',
    etv:      Math.round(h.metrics?.organic?.etv        || 0),
    keywords: h.metrics?.organic?.count                  || 0,
    avg_pos:  Number((h.metrics?.organic?.avg_position  || 0).toFixed(1)),
  })).sort((a, b) => a.date.localeCompare(b.date));

  // ── Position distribution ─────────────────────────────────────────────
  const positionDist = [
    { label: 'Top 3',   count: (overview?.pos_1 || 0) + (overview?.pos_2_3 || 0) },
    { label: '4–10',    count: overview?.pos_4_10  || 0 },
    { label: '11–20',   count: overview?.pos_11_20 || 0 },
    { label: '21–30',   count: overview?.pos_21_30 || 0 },
  ];

  res.json({ ok: true, domain: raw, overview, keywords, pages, history, positionDist });
});

module.exports = router;
