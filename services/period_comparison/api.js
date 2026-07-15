const express    = require('express');
const _https     = require('https');
const _db        = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

// ── HubSpot helper — count contacts created in a date range ──────────────
async function _hsContacts(start, end) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return null;
  return new Promise(resolve => {
    const body = JSON.stringify({
      filterGroups: [{
        filters: [
          { propertyName: 'createdate', operator: 'GTE', value: String(new Date(start).getTime()) },
          { propertyName: 'createdate', operator: 'LTE', value: String(new Date(end + 'T23:59:59Z').getTime()) },
        ],
      }],
      properties: ['createdate'],
      limit: 1,
    });
    const req = _https.request({
      hostname: 'api.hubapi.com', path: '/crm/v3/objects/contacts/search', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve(JSON.parse(d).total ?? 0); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// ── DataForSEO SERP helper — get organic keyword positions for a domain ──
function _dfsPost(path, body) {
  return new Promise(resolve => {
    const u = process.env.DATAFORSEO_LOGIN;
    const p = process.env.DATAFORSEO_PASSWORD;
    if (!u || !p) return resolve({ ok: false });
    const auth    = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
    const payload = JSON.stringify(body);
    const req = _https.request({
      hostname: 'api.dataforseo.com', path, method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve({ ok: json.status_code === 20000, tasks: json.tasks || [] });
        } catch { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ ok: false }); });
    req.write(payload); req.end();
  });
}

// ── Query ad performance for a period ─────────────────────────────────────
async function _adPerf(pool, tid, start, end) {
  // Sum across all campaigns for this tenant in the period
  const r = await pool.query(`
    SELECT
      date_trunc('day', p.bucket_hour AT TIME ZONE 'UTC')::date AS day,
      SUM(p.spend)::float       AS spend,
      SUM(p.impressions)::float AS impressions,
      SUM(p.clicks)::float      AS clicks,
      SUM(p.conversions)::float AS conversions
    FROM ad_performance_hourly p
    JOIN ad_campaigns c ON c.id = p.campaign_id
    WHERE c.tenant_id = $1
      AND p.bucket_hour >= $2::date
      AND p.bucket_hour <  ($3::date + INTERVAL '1 day')
    GROUP BY day ORDER BY day
  `, [tid, start, end]).catch(() => ({ rows: [] }));
  return r.rows;
}

// ── Query leads for a period ───────────────────────────────────────────────
async function _leads(pool, tid, start, end) {
  const r = await pool.query(`
    SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
           count(*)::int AS count
    FROM (
      SELECT created_at FROM landing_page_leads WHERE tenant_id=$1
        AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')
      UNION ALL
      SELECT created_at FROM seo_widget_leads WHERE tenant_id=$1
        AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')
    ) combined
    GROUP BY day ORDER BY day
  `, [tid, start, end]).catch(() => ({ rows: [] }));
  return r.rows;
}

// ── Build a date-indexed map ───────────────────────────────────────────────
function _toMap(rows, keyCol, valCol) {
  const m = {};
  for (const r of rows) m[String(r[keyCol]).slice(0, 10)] = Number(r[valCol] || 0);
  return m;
}

// ── Generate all dates in a range ─────────────────────────────────────────
function _dateRange(start, end) {
  const dates = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── Aggregate metrics ──────────────────────────────────────────────────────
function _sum(map, dates, key) {
  return dates.reduce((s, d) => s + (map[d]?.[key] || 0), 0);
}

// ── POST /fetch ────────────────────────────────────────────────────────────
router.post('/fetch', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'period-comparison:fetch' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const { period_a, period_b, domain } = req.body || {};
  if (!period_a?.start || !period_a?.end || !period_b?.start || !period_b?.end) {
    return _err(res, 400, 'period_a and period_b with start/end required');
  }

  const pool = _db.getPool();

  // Run all DB queries + HubSpot in parallel
  const [
    adA, adB, leadsA, leadsB,
    hsA, hsB,
  ] = await Promise.all([
    _adPerf(pool, tid, period_a.start, period_a.end),
    _adPerf(pool, tid, period_b.start, period_b.end),
    _leads(pool, tid, period_a.start, period_a.end),
    _leads(pool, tid, period_b.start, period_b.end),
    _hsContacts(period_a.start, period_a.end),
    _hsContacts(period_b.start, period_b.end),
  ]);

  // Build day maps
  const datesA = _dateRange(period_a.start, period_a.end);
  const datesB = _dateRange(period_b.start, period_b.end);

  // Merge ad + leads into per-day arrays (aligned to period length)
  const adMapA  = {};
  const adMapB  = {};
  const lMapA   = {};
  const lMapB   = {};

  for (const r of adA)    adMapA[String(r.day).slice(0, 10)] = r;
  for (const r of adB)    adMapB[String(r.day).slice(0, 10)] = r;
  for (const r of leadsA) lMapA[String(r.day).slice(0, 10)] = r.count;
  for (const r of leadsB) lMapB[String(r.day).slice(0, 10)] = r.count;

  function _buildDaily(dates, adMap, lMap) {
    return dates.map(d => ({
      date:        d,
      spend:       Number(adMap[d]?.spend       || 0),
      impressions: Number(adMap[d]?.impressions || 0),
      clicks:      Number(adMap[d]?.clicks      || 0),
      conversions: Number(adMap[d]?.conversions || 0),
      leads:       Number(lMap[d] || 0),
    }));
  }

  function _totals(daily) {
    return {
      spend:       daily.reduce((s, r) => s + r.spend, 0),
      impressions: daily.reduce((s, r) => s + r.impressions, 0),
      clicks:      daily.reduce((s, r) => s + r.clicks, 0),
      conversions: daily.reduce((s, r) => s + r.conversions, 0),
      leads:       daily.reduce((s, r) => s + r.leads, 0),
    };
  }

  const dailyA = _buildDaily(datesA, adMapA, lMapA);
  const dailyB = _buildDaily(datesB, adMapB, lMapB);
  const totA   = _totals(dailyA);
  const totB   = _totals(dailyB);

  // DataForSEO organic overview (current only — not time-series)
  let organic = null;
  if (domain) {
    const r = await _dfsPost('/v3/dataforseo_labs/google/bulk_traffic_estimation/live', [
      { target: domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''), location_code: 2840, language_code: 'en' },
    ]);
    const item = r?.tasks?.[0]?.result?.[0]?.items?.[0];
    if (item) organic = { etv: item.etv, organic_count: item.organic_count };
  }

  res.json({
    ok: true,
    period_a: {
      label: `${period_a.start} – ${period_a.end}`,
      start: period_a.start, end: period_a.end,
      totals: { ...totA, hs_contacts: hsA },
      daily: dailyA,
    },
    period_b: {
      label: `${period_b.start} – ${period_b.end}`,
      start: period_b.start, end: period_b.end,
      totals: { ...totB, hs_contacts: hsB },
      daily: dailyB,
    },
    organic,
  });
});

module.exports = router;
