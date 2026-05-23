// T36 — True ROAS
//
// Brings offline / delayed revenue (closed deals from HubSpot, CSV uploads,
// or direct API push) back onto the campaign view so InfoGenie can compute:
//   • True ROAS = (online revenue + offline revenue) ÷ paid spend
//   • Revenue lag = how long it actually takes leads to close & convert
//   • Profit-aware budget recommendations in the Optimizer
//
// Per-platform attribution is derived from the deal/contact's stored
// click ID (fbclid / gclid / ttclid) when available, otherwise the platform
// recorded on the original lead. Falls back to "unknown" so revenue still
// counts toward total True ROAS even when attribution is missing.

const express = require('express');
const multer = require('multer');
const _https = require('https');
const _crypto = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}
const _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const SETTINGS_KEY = 'true_roas.settings';

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

// ── Settings (kv_store-backed) ──────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  hubspotSyncEnabled: false,
  hubspotPipelineStages: ['closedwon'],
  hubspotLookbackDays: 90,
  minTrueRoasThreshold: 1.5,    // recommend cut below this
  scaleTrueRoasThreshold: 4.0,  // recommend scale above this
  budgetCapEnabled: false,      // safety: recommend-only off by default
  defaultCurrency: 'USD',
};

async function _getSettings() {
  if (!_db.hasDb()) return { ...DEFAULT_SETTINGS };
  try {
    const r = await _db.getPool().query(`SELECT value FROM kv_store WHERE key=$1`, [SETTINGS_KEY]);
    if (!r.rows.length) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(r.rows[0].value || {}) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

async function _saveSettings(patch) {
  const cur = await _getSettings();
  const next = { ...cur, ...(patch || {}) };
  // Normalise types
  next.hubspotSyncEnabled = !!next.hubspotSyncEnabled;
  next.budgetCapEnabled = !!next.budgetCapEnabled;
  next.minTrueRoasThreshold = Math.max(0, Number(next.minTrueRoasThreshold) || 1.5);
  next.scaleTrueRoasThreshold = Math.max(next.minTrueRoasThreshold, Number(next.scaleTrueRoasThreshold) || 4.0);
  next.hubspotLookbackDays = Math.min(365, Math.max(1, parseInt(next.hubspotLookbackDays, 10) || 90));
  if (!Array.isArray(next.hubspotPipelineStages) || !next.hubspotPipelineStages.length) {
    next.hubspotPipelineStages = ['closedwon'];
  }
  if (_db.hasDb()) {
    await _db.getPool().query(
      `INSERT INTO kv_store (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SETTINGS_KEY, JSON.stringify(next)],
    );
  }
  return next;
}

// ── Attribution helpers ─────────────────────────────────────────────────────
function _classifyClickId(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  if (/^fb\.\d+\.\d+\./i.test(v) || /^IwAR/i.test(v) || /fbclid/i.test(v)) return 'meta';
  if (/^[A-Za-z0-9_-]{20,}$/.test(v) && /gclid/i.test(v)) return 'google';
  // Heuristics: if the field name was tiktok-related, caller passes 'tiktok' explicitly.
  return null;
}

function _resolvePlatform({ platform, click_id, fbclid, gclid, ttclid }) {
  const direct = String(platform || '').toLowerCase().trim();
  if (['meta','facebook','instagram'].includes(direct)) return 'meta';
  if (['google','google_ads','googleads','adwords'].includes(direct)) return 'google';
  if (['tiktok','tt'].includes(direct)) return 'tiktok';
  if (['linkedin','li'].includes(direct)) return 'linkedin';
  if (fbclid) return 'meta';
  if (gclid)  return 'google';
  if (ttclid) return 'tiktok';
  return _classifyClickId(click_id) || 'unknown';
}

function _toCents(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  // We always store in minor units. Currency conversion is intentionally NOT
  // done — True ROAS is reported in the user's chosen reporting currency
  // (default USD); mixing currencies is flagged in the UI.
  return Math.round(n * 100);
}

function _fromCents(cents) { return Math.round(Number(cents || 0)) / 100; }

// ── CSV parser (lenient) ────────────────────────────────────────────────────
function _splitCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function _parseConversionsCsv(buf) {
  const text = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/^\ufeff/, '');
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 1) return [];
  const headers = _splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const idx = name => headers.findIndex(h => h === name);
  const colDealId    = idx('deal_id') >= 0 ? idx('deal_id') : idx('id');
  const colEmail     = idx('email');
  const colRevenue   = idx('revenue') >= 0 ? idx('revenue') : (idx('amount') >= 0 ? idx('amount') : idx('value'));
  const colCurrency  = idx('currency');
  const colClickId   = idx('click_id');
  const colFbclid    = idx('fbclid');
  const colGclid     = idx('gclid');
  const colTtclid    = idx('ttclid');
  const colPlatform  = idx('platform') >= 0 ? idx('platform') : idx('channel');
  const colClosedAt  = idx('closed_at') >= 0 ? idx('closed_at') : idx('closedate');
  const colLeadAt    = idx('lead_created_at') >= 0 ? idx('lead_created_at') : idx('createdate');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = _splitCsvLine(lines[i]);
    const get = ix => ix >= 0 ? (c[ix] || '') : '';
    const revenue = parseFloat(get(colRevenue));
    if (!Number.isFinite(revenue) || revenue <= 0) continue;
    const currency = (get(colCurrency) || 'USD').toUpperCase().slice(0, 3);
    const closedAtRaw = get(colClosedAt);
    const closedAt = closedAtRaw ? new Date(closedAtRaw) : new Date();
    const leadAtRaw = get(colLeadAt);
    const leadAt = leadAtRaw ? new Date(leadAtRaw) : null;
    out.push({
      // Stable external IDs (deal_id from CSV) are preferred for idempotency.
      // When absent we mint a UUID — collision-resistant across concurrent
      // uploads happening in the same millisecond.
      source_deal_id: get(colDealId) || `csv-${_crypto.randomUUID()}`,
      email: get(colEmail).toLowerCase() || null,
      click_id: get(colClickId) || null,
      platform: _resolvePlatform({
        platform: get(colPlatform),
        click_id: get(colClickId),
        fbclid: get(colFbclid),
        gclid:  get(colGclid),
        ttclid: get(colTtclid),
      }),
      revenue_cents: _toCents(revenue, currency),
      currency,
      lead_created_at: (leadAt && !isNaN(leadAt)) ? leadAt.toISOString() : null,
      closed_at: (closedAt && !isNaN(closedAt)) ? closedAt.toISOString() : new Date().toISOString(),
      raw: { row: i, headers },
    });
  }
  return out;
}

async function _insertConversions(source, items, tid) {
  if (!_db.hasDb() || !items.length) return { inserted: 0, skipped: 0 };
  if (!Number.isFinite(tid)) throw new Error('tenant_id required for offline conversion insert');
  const pool = _db.getPool();
  let inserted = 0, skipped = 0;
  for (const it of items) {
    try {
      // ON CONFLICT target matches the tenant-scoped UNIQUE index so two
      // tenants importing the same HubSpot deal id are kept separate.
      const r = await pool.query(
        `INSERT INTO offline_conversions
           (tenant_id, source, source_deal_id, email, click_id, platform, revenue_cents, currency,
            lead_created_at, closed_at, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, source, source_deal_id) DO UPDATE
           SET revenue_cents = EXCLUDED.revenue_cents,
               platform      = EXCLUDED.platform,
               closed_at     = EXCLUDED.closed_at,
               raw           = EXCLUDED.raw
         RETURNING (xmax = 0) AS was_insert`,
        [tid, source, it.source_deal_id, it.email, it.click_id, it.platform,
         it.revenue_cents, it.currency, it.lead_created_at, it.closed_at,
         JSON.stringify(it.raw || {})],
      );
      if (r.rows[0]?.was_insert) inserted++; else skipped++;
    } catch (e) { skipped++; }
  }
  return { inserted, skipped };
}

// ── HubSpot sync ────────────────────────────────────────────────────────────
function _hsRequest(path, method, body) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return Promise.reject(new Error('HUBSPOT_PRIVATE_APP_TOKEN not configured'));
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = _https.request({ hostname: 'api.hubapi.com', path, method, headers }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (r.statusCode >= 400) return reject(new Error(`HubSpot ${r.statusCode}: ${j.message || d.slice(0,200)}`));
          resolve(j);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('hubspot timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}
function _hsFetch(path) { return _hsRequest(path, 'GET', null); }

async function _syncHubspot(tid) {
  if (!Number.isFinite(tid)) throw new Error('tenant_id required for hubspot sync');
  const settings = await _getSettings();
  const lookback = settings.hubspotLookbackDays;
  const stages = settings.hubspotPipelineStages.map(s => String(s));
  const props = ['dealname','amount','deal_currency_code','dealstage','closedate','createdate',
                 'hubspot_owner_id','fbclid','gclid','ttclid','hs_analytics_source',
                 'hs_analytics_source_data_1','hs_analytics_first_url'];
  const sinceIso = new Date(Date.now() - lookback * 86400e3).toISOString();
  // Architect-flagged: Use the Search API with server-side closedate + stage
  // filters and explicit sort so we don't miss closed deals when the portal
  // has more than 1000 records. Sort ascending by closedate so cursor pagination
  // is deterministic across the lookback window.
  const items = [];
  let after = undefined;
  let pages = 0;
  while (pages < 10) {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: 'closedate', operator: 'GTE', value: sinceIso },
          ...(stages.length ? [{ propertyName: 'dealstage', operator: 'IN', values: stages }] : []),
        ],
      }],
      sorts: [{ propertyName: 'closedate', direction: 'ASCENDING' }],
      properties: props,
      limit: 100,
      ...(after ? { after } : {}),
    };
    const j = await _hsRequest('/crm/v3/objects/deals/search', 'POST', body);
    const results = j.results || [];
    for (const d of results) {
      const p = d.properties || {};
      const closedRaw = p.closedate;
      const closed = closedRaw ? new Date(closedRaw) : null;
      if (!closed || isNaN(closed)) continue;
      const amount = parseFloat(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const currency = String(p.deal_currency_code || 'USD').toUpperCase().slice(0, 3);
      const platform = _resolvePlatform({
        click_id: p.hs_analytics_source_data_1,
        fbclid: p.fbclid, gclid: p.gclid, ttclid: p.ttclid,
        platform: p.hs_analytics_source,
      });
      items.push({
        source_deal_id: String(d.id),
        email: null,
        click_id: p.fbclid || p.gclid || p.ttclid || null,
        platform,
        revenue_cents: _toCents(amount, currency),
        currency,
        lead_created_at: p.createdate || null,
        closed_at: closed.toISOString(),
        raw: { dealname: p.dealname, dealstage: p.dealstage, source: p.hs_analytics_source },
      });
    }
    after = j.paging?.next?.after;
    pages++;
    if (!after) break;
  }
  const out = await _insertConversions('hubspot', items, tid);
  await _saveSettings({ hubspotSyncEnabled: true });
  await _stamp(`true_roas.hubspot_last_sync.t${tid}`, { at: new Date().toISOString(), ...out, scanned: items.length, tenant_id: tid });
  return { ...out, scanned: items.length };
}

async function _stamp(key, value) {
  if (!_db.hasDb()) return;
  try {
    await _db.getPool().query(
      `INSERT INTO kv_store (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  } catch {}
}

// ── True ROAS computation ───────────────────────────────────────────────────
async function computeTrueRoas(days = 30, tid) {
  const out = {
    days,
    online: { revenue: 0, byPlatform: {} },
    offline: { revenue: 0, byPlatform: {}, conversions: 0 },
    spend: 0,
    spendByPlatform: {},
    trueRoas: null,
    reportedRoas: null,
    perPlatform: {},
  };
  if (!_db.hasDb()) return out;
  if (!Number.isFinite(tid)) throw new Error('tenant_id required for computeTrueRoas');
  const pool = _db.getPool();

  // Online revenue + spend per platform from optimizer's ingested data.
  // Join filter on c.tenant_id keeps cross-tenant campaigns out of the math.
  try {
    const r = await pool.query(`
      SELECT lower(replace(c.platform, 'facebook', 'meta')) AS platform,
             COALESCE(SUM(p.revenue),0)::float8 AS revenue,
             COALESCE(SUM(p.spend),0)::float8   AS spend
        FROM ad_performance_hourly p
        JOIN ad_campaigns c ON c.id = p.campaign_id
       WHERE p.bucket_hour >= now() - ($1 || ' days')::interval
         AND c.tenant_id = $2
       GROUP BY 1
    `, [String(days), tid]);
    for (const row of r.rows) {
      const k = row.platform || 'unknown';
      out.online.byPlatform[k] = Number(row.revenue || 0);
      out.online.revenue += Number(row.revenue || 0);
      out.spendByPlatform[k] = Number(row.spend || 0);
      out.spend += Number(row.spend || 0);
    }
  } catch {}

  // Offline revenue per platform from offline_conversions.
  // We surface a multi-currency warning instead of silently summing across
  // currencies (no FX conversion is performed; values are reported in their
  // native currency unit). UI can flag this so users know the trueRoas
  // figure mixes currencies if more than one is present.
  try {
    const r = await pool.query(`
      SELECT COALESCE(platform, 'unknown') AS platform,
             COALESCE(SUM(revenue_cents),0)::bigint AS cents,
             COUNT(*)::int AS n
        FROM offline_conversions
       WHERE closed_at >= now() - ($1 || ' days')::interval
         AND tenant_id = $2
       GROUP BY 1
    `, [String(days), tid]);
    for (const row of r.rows) {
      const k = (row.platform || 'unknown').toLowerCase();
      const rev = _fromCents(row.cents);
      out.offline.byPlatform[k] = rev;
      out.offline.revenue += rev;
      out.offline.conversions += Number(row.n || 0);
    }
    const cur = await pool.query(`
      SELECT currency, COUNT(*)::int AS n
        FROM offline_conversions
       WHERE closed_at >= now() - ($1 || ' days')::interval
         AND tenant_id = $2
       GROUP BY 1
    `, [String(days), tid]);
    out.offline.currencies = cur.rows.map(r => ({ currency: r.currency, count: Number(r.n) }));
    out.offline.mixedCurrency = cur.rows.length > 1;
  } catch {}

  out.reportedRoas = out.spend > 0 && out.online.revenue > 0
    ? +(out.online.revenue / out.spend).toFixed(2) : null;
  const totalRev = out.online.revenue + out.offline.revenue;
  out.trueRoas = out.spend > 0 && totalRev > 0
    ? +(totalRev / out.spend).toFixed(2) : null;

  // Per-platform breakdown
  const allKeys = new Set([
    ...Object.keys(out.online.byPlatform),
    ...Object.keys(out.offline.byPlatform),
    ...Object.keys(out.spendByPlatform),
  ]);
  for (const k of allKeys) {
    const online = out.online.byPlatform[k] || 0;
    const offline = out.offline.byPlatform[k] || 0;
    const spend = out.spendByPlatform[k] || 0;
    const total = online + offline;
    out.perPlatform[k] = {
      online, offline, total, spend,
      reportedRoas: spend > 0 && online > 0 ? +(online/spend).toFixed(2) : null,
      trueRoas: spend > 0 && total > 0 ? +(total/spend).toFixed(2) : null,
      uplift: spend > 0 && online > 0 && offline > 0 ? +((total/online - 1) * 100).toFixed(1) : null,
    };
  }
  return out;
}

// ── Revenue lag ─────────────────────────────────────────────────────────────
async function computeRevenueLag(days = 90, tid) {
  if (!_db.hasDb()) return { ok: true, days, buckets: [], avgDaysToClose: null, totalDeals: 0, totalRevenue: 0 };
  if (!Number.isFinite(tid)) throw new Error('tenant_id required for computeRevenueLag');
  const pool = _db.getPool();
  // Group leads by week-of-creation; what % closed and what revenue did they generate?
  const r = await pool.query(`
    SELECT date_trunc('week', lead_created_at) AS wk,
           COUNT(*)::int AS deals,
           COALESCE(SUM(revenue_cents),0)::bigint AS cents,
           COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - lead_created_at))/86400.0),0)::float8 AS avg_days
      FROM offline_conversions
     WHERE lead_created_at IS NOT NULL
       AND lead_created_at >= now() - ($1 || ' days')::interval
       AND tenant_id = $2
     GROUP BY 1
     ORDER BY 1
  `, [String(days), tid]);
  const buckets = r.rows.map(row => ({
    week: row.wk,
    deals: Number(row.deals || 0),
    revenue: _fromCents(row.cents),
    avgDaysToClose: +(Number(row.avg_days || 0)).toFixed(1),
  }));
  const totals = await pool.query(`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(revenue_cents),0)::bigint AS cents,
           COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - lead_created_at))/86400.0),0)::float8 AS avg_days
      FROM offline_conversions
     WHERE lead_created_at IS NOT NULL
       AND closed_at >= now() - ($1 || ' days')::interval
       AND tenant_id = $2
  `, [String(days), tid]);
  const t = totals.rows[0] || {};
  return {
    ok: true, days, buckets,
    totalDeals: Number(t.n || 0),
    totalRevenue: _fromCents(t.cents),
    avgDaysToClose: +(Number(t.avg_days || 0)).toFixed(1),
  };
}

// ── Profit-aware budget cap recommendations ─────────────────────────────────
async function generateBudgetRecommendations(tid) {
  const settings = await _getSettings();
  if (!_db.hasDb() || !settings.budgetCapEnabled) return { ok: true, generated: 0, skipped: 'disabled' };
  if (!Number.isFinite(tid)) throw new Error('tenant_id required for generateBudgetRecommendations');
  const pool = _db.getPool();
  // Compute per-campaign True ROAS over last 7 days; recommend cut/scale.
  const days = 7;
  const r = await pool.query(`
    SELECT c.id AS campaign_id, c.name, c.platform, c.platform_camp_id,
           COALESCE(SUM(p.spend),0)::float8   AS spend,
           COALESCE(SUM(p.revenue),0)::float8 AS online_revenue
      FROM ad_campaigns c
      LEFT JOIN ad_performance_hourly p
        ON p.campaign_id = c.id AND p.bucket_hour >= now() - ($1 || ' days')::interval
     WHERE c.tenant_id = $2
     GROUP BY c.id
    HAVING COALESCE(SUM(p.spend),0) > 0
  `, [String(days), tid]);
  let generated = 0;
  for (const row of r.rows) {
    // Pull offline revenue for this platform (campaign-level offline attribution
    // is ambitious without a unified click ID — we apportion by online revenue
    // share: campaign's slice of online-revenue × platform offline total).
    const platform = String(row.platform || '').toLowerCase().replace('facebook','meta');
    const platTotal = await pool.query(`
      SELECT COALESCE(SUM(p.revenue),0)::float8 AS total
        FROM ad_performance_hourly p JOIN ad_campaigns c ON c.id = p.campaign_id
       WHERE lower(replace(c.platform,'facebook','meta'))=$1
         AND p.bucket_hour >= now() - ($2 || ' days')::interval
         AND c.tenant_id = $3
    `, [platform, String(days), tid]);
    const offlineRow = await pool.query(`
      SELECT COALESCE(SUM(revenue_cents),0)::bigint AS cents
        FROM offline_conversions
       WHERE lower(platform)=$1 AND closed_at >= now() - ($2 || ' days')::interval
         AND tenant_id = $3
    `, [platform, String(days), tid]);
    const platOnline  = Number(platTotal.rows[0]?.total || 0);
    const platOffline = _fromCents(offlineRow.rows[0]?.cents || 0);
    const share = platOnline > 0 ? (Number(row.online_revenue) / platOnline) : 0;
    const apportionedOffline = +(platOffline * share).toFixed(2);
    const totalRevenue = Number(row.online_revenue) + apportionedOffline;
    const trueRoas = row.spend > 0 ? +(totalRevenue / row.spend).toFixed(2) : null;
    if (trueRoas == null) continue;
    let action = null, change = null;
    if (trueRoas < settings.minTrueRoasThreshold) { action = 'budget_cap_cut'; change = -25; }
    else if (trueRoas >= settings.scaleTrueRoasThreshold) { action = 'budget_cap_scale'; change = +20; }
    if (!action) continue;
    // Avoid churning: skip if same action recommended for this campaign in last 24h.
    const dup = await pool.query(`
      SELECT 1 FROM optimizer_actions
       WHERE campaign_id=$1 AND action=$2 AND tenant_id=$3
         AND created_at > now() - interval '24 hours'
       LIMIT 1
    `, [row.campaign_id, action, tid]);
    if (dup.rows.length) continue;
    await pool.query(`
      INSERT INTO optimizer_actions (tenant_id, campaign_id, action, reason, before_state, after_state, mode, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'recommend', 'pending')
    `, [
      tid, row.campaign_id, action,
      `True ROAS = ${trueRoas} (online ${row.online_revenue.toFixed(2)} + offline ${apportionedOffline} / spend ${row.spend.toFixed(2)}) — recommend ${change > 0 ? '+' : ''}${change}% budget`,
      JSON.stringify({ trueRoas, online: +row.online_revenue.toFixed(2), offline: apportionedOffline, spend: +row.spend.toFixed(2) }),
      JSON.stringify({ recommendedBudgetChangePct: change, threshold: action === 'budget_cap_cut' ? settings.minTrueRoasThreshold : settings.scaleTrueRoasThreshold }),
    ]);
    generated++;
  }
  await _stamp(`true_roas.budget_cap_last_run.t${tid}`, { at: new Date().toISOString(), generated, tenant_id: tid });
  return { ok: true, generated };
}

// ── Cron: HubSpot sync (6h) + budget recs (6h, offset by 3h) ────────────────
let _cronTimer = null;
async function _allTenantIds() {
  if (!_db.hasDb()) return [];
  try {
    const r = await _db.getPool().query(`SELECT id FROM tenants ORDER BY id`);
    return r.rows.map(x => Number(x.id)).filter(Number.isFinite);
  } catch { return []; }
}
async function _cronTick() {
  try {
    const settings = await _getSettings();
    const tids = await _allTenantIds();
    for (const tid of tids) {
      if (settings.hubspotSyncEnabled && process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
        try { await _syncHubspot(tid); } catch (e) { console.warn(`[true-roas] hubspot sync t${tid}:`, e.message); }
      }
      if (settings.budgetCapEnabled) {
        try { await generateBudgetRecommendations(tid); } catch (e) { console.warn(`[true-roas] budget recs t${tid}:`, e.message); }
      }
    }
  } catch (e) { console.warn('[true-roas] cron error:', e.message); }
}
function startCron() {
  if (_cronTimer) return;
  _cronTimer = setInterval(_cronTick, 6 * 60 * 60 * 1000);
  setTimeout(_cronTick, 120 * 1000);
  console.log('[true-roas] cron started (6h sync + budget recs)');
}

// ── Routes ──────────────────────────────────────────────────────────────────
router.get('/settings', async (_req, res) => {
  res.json({ ok: true, settings: await _getSettings(), hubspotConfigured: !!process.env.HUBSPOT_PRIVATE_APP_TOKEN });
});

router.post('/settings', async (req, res) => {
  try { res.json({ ok: true, settings: await _saveSettings(req.body || {}) }); }
  catch (e) { _err(res, 500, e.message); }
});

router.post('/upload', _upload.single('file'), async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  if (!req.file?.buffer) return _err(res, 400, 'CSV file required');
  let items;
  try { items = _parseConversionsCsv(req.file.buffer); }
  catch (e) { return _err(res, 400, 'CSV parse failed: ' + e.message); }
  if (!items.length) return _err(res, 400, 'No valid rows found (need columns: revenue + deal_id or email)');
  const tid = await _tid(req, 'true-roas:upload');
  const out = await _insertConversions('csv', items, tid);
  res.json({ ok: true, parsed: items.length, ...out });
});

router.post('/sync-hubspot', async (req, res) => {
  if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) return _err(res, 400, 'HUBSPOT_PRIVATE_APP_TOKEN not configured');
  try {
    const tid = await _tid(req, 'true-roas:sync-hubspot');
    res.json({ ok: true, ...(await _syncHubspot(tid)) });
  }
  catch (e) { _err(res, 500, e.message); }
});

router.get('/conversions', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, conversions: [] });
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const platform = String(req.query.platform || '').toLowerCase();
  const tid = await _tid(req, 'true-roas:conversions-list');
  const params = [tid]; const where = ['tenant_id = $1'];
  if (platform) { params.push(platform); where.push(`platform = $${params.length}`); }
  const sql = `SELECT id, source, source_deal_id, email, click_id, platform, revenue_cents, currency,
                      lead_created_at, closed_at, created_at
                 FROM offline_conversions
                 WHERE ${where.join(' AND ')}
                 ORDER BY closed_at DESC LIMIT ${limit}`;
  const r = await _db.getPool().query(sql, params);
  res.json({ ok: true, conversions: r.rows.map(x => ({ ...x, revenue: _fromCents(x.revenue_cents) })) });
});

router.delete('/conversions/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  const tid = await _tid(req, 'true-roas:conversions-del');
  await _db.getPool().query(`DELETE FROM offline_conversions WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  res.json({ ok: true });
});

router.get('/summary', async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const tid = await _tid(req, 'true-roas:summary');
  res.json({ ok: true, ...(await computeTrueRoas(days, tid)) });
});

router.get('/revenue-lag', async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 90));
  const tid = await _tid(req, 'true-roas:revenue-lag');
  res.json(await computeRevenueLag(days, tid));
});

router.post('/budget-recommendations/run', async (req, res) => {
  try {
    const tid = await _tid(req, 'true-roas:budget-recs');
    res.json(await generateBudgetRecommendations(tid));
  }
  catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
module.exports.startCron = startCron;
module.exports.computeTrueRoas = computeTrueRoas;
