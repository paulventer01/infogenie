// Optimizer HTTP routes — mounted under /api/optimizer.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { ingestOnce } = require('./ingest');
const { runOptimizerOnce } = require('./rules');
const { getSetting, setSetting } = require('./schema');
const { platformConnected } = require('./platforms');
const { runCreativeRefreshOnce } = require('./creative_refresh');
const { runBanditOnce } = require('./bandit');
const { runGoogleCreativeRefreshOnce } = require('./google_creative_refresh');
const { runGoogleBanditOnce } = require('./google_bandit');
const { runDaypartingOnce } = require('./dayparting');
const { runFatigueForecastOnce } = require('./fatigue_forecast');

const router = express.Router();

router.get('/status', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const pool = _db.getPool();
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:status' });
  const camps   = await pool.query(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE optimizer_enabled)::int enabled FROM ad_campaigns WHERE tenant_id = $1`, [tid]);
  const actions = await pool.query(`SELECT COUNT(*)::int n FROM optimizer_actions WHERE tenant_id = $1 AND created_at > now() - interval '24 hours'`, [tid]);
  const lastRun = await pool.query(`SELECT MAX(created_at) AS t FROM optimizer_actions WHERE tenant_id = $1`, [tid]);
  const dryRun  = await getSetting('dry_run', { v: true });
  res.json({
    ok: true,
    db: true,
    campaigns: camps.rows[0],
    actionsLast24h: actions.rows[0].n,
    lastRunAt: lastRun.rows[0].t,
    dryRun: !!dryRun.v,
    platforms: {
      meta:   await platformConnected('meta'),
      google: await platformConnected('google', req.user && req.user.id ? req.user.id : null),
      tiktok: await platformConnected('tiktok'),
    },
  });
});

router.get('/campaigns', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured', campaigns: [] });
  const pool = _db.getPool();
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:campaigns:list' });
  const r = await pool.query(`
    SELECT c.*,
      (SELECT json_build_object(
        'spend', COALESCE(SUM(spend),0),
        'revenue', COALESCE(SUM(revenue),0),
        'conversions', COALESCE(SUM(conversions),0),
        'clicks', COALESCE(SUM(clicks),0),
        'impressions', COALESCE(SUM(impressions),0))
       FROM ad_performance_hourly WHERE campaign_id = c.id AND bucket_hour > now() - interval '7 days'
      ) AS perf7d
    FROM ad_campaigns c
    WHERE c.tenant_id = $1
    ORDER BY c.created_at DESC LIMIT 200
  `, [tid]);
  res.json({ ok: true, campaigns: r.rows });
});

router.get('/actions', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, actions: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:actions:list' });
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const r = await _db.getPool().query(`
    SELECT a.*, c.name AS campaign_name, c.platform
    FROM optimizer_actions a LEFT JOIN ad_campaigns c ON c.id = a.campaign_id
    WHERE a.tenant_id = $2
    ORDER BY a.created_at DESC LIMIT $1
  `, [limit, tid]);
  res.json({ ok: true, actions: r.rows });
});

// Validation helpers: every numeric field gets coerced + range-checked so
// junk values can't poison the rules engine math or DB types.
const _ALLOWED_PLATFORMS = new Set(['meta','facebook','google','tiktok']);
function _num(v, { min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}
function _str(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.length > max) return undefined;
  return s;
}

router.post('/campaigns/upsert', express.json(), async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:campaigns:upsert' });
  const platform        = _str(req.body?.platform, 32);
  const platform_camp_id= _str(req.body?.platform_camp_id, 80);
  const name            = _str(req.body?.name, 200);
  const daily_budget    = _num(req.body?.daily_budget, { min: 0, max: 1e6 });
  const owner_email     = _str(req.body?.owner_email, 200);
  const target_roas     = _num(req.body?.target_roas, { min: 0, max: 100 });
  if (!platform || !platform_camp_id || !name) return res.status(400).json({ ok: false, error: 'platform, platform_camp_id, name are required' });
  if (!_ALLOWED_PLATFORMS.has(platform.toLowerCase())) return res.status(400).json({ ok: false, error: 'platform must be meta|google|tiktok' });
  if (daily_budget === undefined || target_roas === undefined) return res.status(400).json({ ok: false, error: 'daily_budget / target_roas out of range' });
  // optimizer_enabled defaults TRUE on first insert so every newly-launched
  // campaign is automatically monitored daily — underperformers get paused
  // and budget reallocated to winners without the user having to flip a
  // toggle. Existing rows keep whatever the user already set (we deliberately
  // do NOT touch optimizer_enabled in the ON CONFLICT branch).
  const r = await _db.getPool().query(`
    INSERT INTO ad_campaigns (tenant_id, platform, platform_camp_id, name, daily_budget, owner_email, target_roas, optimizer_enabled)
    VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,2.00), TRUE)
    ON CONFLICT (tenant_id, platform, platform_camp_id)
    DO UPDATE SET name=EXCLUDED.name, daily_budget=COALESCE(EXCLUDED.daily_budget, ad_campaigns.daily_budget),
                  owner_email=COALESCE(EXCLUDED.owner_email, ad_campaigns.owner_email),
                  updated_at=now()
    RETURNING *
  `, [tid, platform.toLowerCase(), platform_camp_id, name, daily_budget, owner_email, target_roas]);
  res.json({ ok: true, campaign: r.rows[0] });
});

router.post('/enable', express.json(), async (req, res) => {
  const id = parseInt(req.body?.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'valid id required' });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:enable' });
  const enabled = !!req.body?.enabled;
  await _db.getPool().query(`UPDATE ad_campaigns SET optimizer_enabled=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [enabled, id, tid]);
  res.json({ ok: true });
});

router.post('/target', express.json(), async (req, res) => {
  const id = parseInt(req.body?.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'valid id required' });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:target' });
  const target_roas      = _num(req.body?.target_roas,      { min: 0,  max: 100 });
  const min_spend_floor  = _num(req.body?.min_spend_floor,  { min: 0,  max: 1e6 });
  const max_daily_budget = _num(req.body?.max_daily_budget, { min: 0,  max: 1e6 });
  if (target_roas === undefined || min_spend_floor === undefined || max_daily_budget === undefined)
    return res.status(400).json({ ok: false, error: 'numeric value out of range' });
  await _db.getPool().query(`
    UPDATE ad_campaigns
       SET target_roas       = COALESCE($1, target_roas),
           min_spend_floor   = COALESCE($2, min_spend_floor),
           max_daily_budget  = COALESCE($3, max_daily_budget),
           updated_at        = now()
     WHERE id = $4 AND tenant_id = $5
  `, [target_roas, min_spend_floor, max_daily_budget, id, tid]);
  res.json({ ok: true });
});

router.post('/dry-run', express.json(), async (req, res) => {
  const v = !!(req.body && req.body.dryRun);
  await setSetting('dry_run', { v });
  res.json({ ok: true, dryRun: v });
});

router.post('/run-now', async (_req, res) => {
  const ing = await ingestOnce();
  const opt = await runOptimizerOnce();
  res.json({ ok: true, ingest: ing, optimizer: opt });
});

// ── Phase 8: Creative Auto-Refresh ─────────────────────────────────────────
router.get('/creative-refreshes', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, refreshes: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:creative-refreshes' });
  const n = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isFinite(n) && n > 0 ? n : 30, 200);
  const r = await _db.getPool().query(`
    SELECT cr.*, c.name AS campaign_name, c.platform
    FROM creative_refreshes cr LEFT JOIN ad_campaigns c ON c.id = cr.campaign_id
    WHERE cr.tenant_id = $2
    ORDER BY cr.created_at DESC LIMIT $1
  `, [limit, tid]);
  res.json({ ok: true, refreshes: r.rows });
});

router.get('/creative-refresh/status', async (_req, res) => {
  const enabled = await getSetting('creative_refresh_enabled', { v: true });
  const dryRun  = await getSetting('creative_refresh_dry_run', { v: true });
  res.json({ ok: true, enabled: !!enabled.v, dryRun: !!dryRun.v });
});

router.post('/creative-refresh/toggle', express.json(), async (req, res) => {
  const v = !!(req.body && req.body.enabled);
  await setSetting('creative_refresh_enabled', { v });
  res.json({ ok: true, enabled: v });
});

router.post('/creative-refresh/dry-run', express.json(), async (req, res) => {
  const v = !!(req.body && req.body.dryRun);
  await setSetting('creative_refresh_dry_run', { v });
  res.json({ ok: true, dryRun: v });
});

router.post('/creative-refresh/run-now', express.json(), async (_req, res) => {
  // force=true so it runs even if the user-facing "enabled" toggle is off,
  // but it still respects the current dry-run setting unless overridden.
  // Runs BOTH Meta and Google modules in parallel — each no-ops cleanly when
  // its platform creds are missing, so this is safe regardless of connection state.
  const [meta, google] = await Promise.all([
    runCreativeRefreshOnce({ force: true }),
    runGoogleCreativeRefreshOnce({ force: true }),
  ]);
  res.json({ ok: true, run: { meta, google } });
});

// ── Phase 7: Multi-Armed Bandit (ad-set budget allocation) ─────────────────
router.get('/bandit/status', async (req, res) => {
  const enabled = await getSetting('bandit_enabled', { v: false });
  const dryRun  = await getSetting('bandit_dry_run', { v: true });
  let lastRun = null, total = 0;
  if (_db.hasDb()) {
    // Aggregate counts/timestamps are scoped per-tenant so one tenant's
    // bandit cadence isn't visible to another.
    const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:bandit:status' });
    const lr = await _db.getPool().query(`SELECT MAX(created_at) AS t, COUNT(*)::int n FROM bandit_allocations WHERE tenant_id = $1`, [tid]);
    lastRun = lr.rows[0]?.t || null;
    total   = lr.rows[0]?.n || 0;
  }
  res.json({ ok: true, enabled: !!enabled.v, dryRun: !!dryRun.v, lastRunAt: lastRun, totalAllocations: total });
});

router.get('/bandit/allocations', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, allocations: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:bandit:allocations' });
  const n = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isFinite(n) && n > 0 ? n : 50, 300);
  const r = await _db.getPool().query(`
    SELECT b.*, c.name AS campaign_name, s.name AS adset_name, s.platform_adset_id
    FROM bandit_allocations b
      LEFT JOIN ad_campaigns c ON c.id = b.campaign_id
      LEFT JOIN ad_sets s      ON s.id = b.ad_set_id
    WHERE b.tenant_id = $2
    ORDER BY b.created_at DESC LIMIT $1
  `, [limit, tid]);
  res.json({ ok: true, allocations: r.rows });
});

router.post('/bandit/toggle', express.json(), async (req, res) => {
  const raw = req.body && req.body.enabled;
  if (raw !== true && raw !== false) return res.status(400).json({ ok: false, error: 'enabled must be boolean true or false' });
  await setSetting('bandit_enabled', { v: raw });
  res.json({ ok: true, enabled: raw });
});

router.post('/bandit/dry-run', express.json(), async (req, res) => {
  const raw = req.body && req.body.dryRun;
  if (raw !== true && raw !== false) return res.status(400).json({ ok: false, error: 'dryRun must be boolean true or false' });
  await setSetting('bandit_dry_run', { v: raw });
  res.json({ ok: true, dryRun: raw });
});

router.post('/bandit/run-now', express.json(), async (_req, res) => {
  const [meta, google] = await Promise.all([
    runBanditOnce({ force: true }),
    runGoogleBanditOnce({ force: true }),
  ]);
  res.json({ ok: true, run: { meta, google } });
});

router.delete('/campaigns/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'bad id' });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:campaigns:delete' });
  await _db.getPool().query(`DELETE FROM ad_campaigns WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  res.json({ ok: true });
});

// ── T34: Decision log (richer than /actions — joins campaign + structured) ─
// Returns recent optimizer_actions enriched with campaign name, platform,
// before/after JSON, and a stable category (pause/scale/hold/refresh/bandit).
// The frontend's "Why did the AI do this?" panel renders this directly.
router.get('/decisions', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, decisions: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:decisions' });
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const platform = req.query.platform ? String(req.query.platform).slice(0, 32) : null;
  const params = [limit, tid];
  let where = `WHERE a.tenant_id = $2`;
  if (platform) { params.push(platform); where += ` AND c.platform = $3`; }
  const r = await _db.getPool().query(`
    SELECT a.id, a.action_type, a.reason, a.before_value, a.after_value,
           a.applied, a.apply_error, a.run_id, a.created_at,
           c.id AS campaign_id, c.name AS campaign_name, c.platform,
           c.target_roas, c.daily_budget
    FROM optimizer_actions a
    LEFT JOIN ad_campaigns c ON c.id = a.campaign_id
    ${where}
    ORDER BY a.created_at DESC LIMIT $1
  `, params);
  res.json({ ok: true, decisions: r.rows });
});

// ── T34: Day-part / hour-of-day budget shifting ───────────────────────────
router.get('/dayparting', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, items: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:dayparting:list' });
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  // Latest dayparting analysis per campaign (one row each).
  const r = await _db.getPool().query(`
    SELECT DISTINCT ON (dp.campaign_id)
      dp.id, dp.campaign_id, dp.window_days, dp.total_spend, dp.total_conv,
      dp.hours_json, dp.best_hours, dp.worst_hours, dp.recommendation,
      dp.run_id, dp.created_at,
      c.name AS campaign_name, c.platform, c.optimizer_enabled
    FROM optimizer_dayparting dp
    LEFT JOIN ad_campaigns c ON c.id = dp.campaign_id
    WHERE dp.tenant_id = $2
    ORDER BY dp.campaign_id, dp.created_at DESC
    LIMIT $1
  `, [limit, tid]);
  res.json({ ok: true, items: r.rows });
});

router.post('/dayparting/run-now', express.json(), async (_req, res) => {
  const r = await runDaypartingOnce({ force: true });
  res.json({ ok: true, run: r });
});

// ── T34: Predictive creative fatigue ──────────────────────────────────────
router.get('/fatigue-forecast', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, items: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'optimizer:fatigue-forecast' });
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const onlyFlagged = String(req.query.flagged || '') === '1';
  // Outer WHERE filters the wrapped subquery alias `latest`, NOT `ff`.
  const where = onlyFlagged ? 'WHERE latest.predicted_fatigue = true' : '';
  // Latest forecast per creative.
  const r = await _db.getPool().query(`
    SELECT * FROM (
      SELECT DISTINCT ON (ff.creative_id)
        ff.id, ff.campaign_id, ff.creative_id, ff.platform_ad_id,
        ff.window_days, ff.samples, ff.current_ctr, ff.slope_per_day,
        ff.projected_ctr_3d, ff.days_until_floor, ff.ctr_floor,
        ff.predicted_fatigue, ff.reason, ff.run_id, ff.created_at,
        c.name AS campaign_name, c.platform,
        cr.headline, cr.body, cr.image_url
      FROM creative_fatigue_forecasts ff
      LEFT JOIN ad_campaigns  c  ON c.id  = ff.campaign_id
      LEFT JOIN ad_creatives  cr ON cr.id = ff.creative_id
      WHERE ff.tenant_id = $2
      ORDER BY ff.creative_id, ff.created_at DESC
    ) latest
    ${where}
    ORDER BY predicted_fatigue DESC, created_at DESC
    LIMIT $1
  `, [limit, tid]);
  res.json({ ok: true, items: r.rows });
});

router.post('/fatigue-forecast/run-now', express.json(), async (_req, res) => {
  const r = await runFatigueForecastOnce({ force: true });
  res.json({ ok: true, run: r });
});

module.exports = router;
