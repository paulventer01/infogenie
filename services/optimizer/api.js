// Optimizer HTTP routes — mounted under /api/optimizer.
const express = require('express');
const _db = require('../../db');
const { ingestOnce } = require('./ingest');
const { runOptimizerOnce } = require('./rules');
const { getSetting, setSetting } = require('./schema');
const { platformConnected } = require('./platforms');

const router = express.Router();

router.get('/status', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const pool = _db.getPool();
  const camps   = await pool.query(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE optimizer_enabled)::int enabled FROM ad_campaigns`);
  const actions = await pool.query(`SELECT COUNT(*)::int n FROM optimizer_actions WHERE created_at > now() - interval '24 hours'`);
  const lastRun = await pool.query(`SELECT MAX(created_at) AS t FROM optimizer_actions`);
  const dryRun  = await getSetting('dry_run', { v: true });
  res.json({
    ok: true,
    db: true,
    campaigns: camps.rows[0],
    actionsLast24h: actions.rows[0].n,
    lastRunAt: lastRun.rows[0].t,
    dryRun: !!dryRun.v,
    platforms: {
      meta:   platformConnected('meta'),
      google: platformConnected('google'),
      tiktok: platformConnected('tiktok'),
    },
  });
});

router.get('/campaigns', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured', campaigns: [] });
  const pool = _db.getPool();
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
    ORDER BY c.created_at DESC LIMIT 200
  `);
  res.json({ ok: true, campaigns: r.rows });
});

router.get('/actions', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, actions: [] });
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const r = await _db.getPool().query(`
    SELECT a.*, c.name AS campaign_name, c.platform
    FROM optimizer_actions a LEFT JOIN ad_campaigns c ON c.id = a.campaign_id
    ORDER BY a.created_at DESC LIMIT $1
  `, [limit]);
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
  const platform        = _str(req.body?.platform, 32);
  const platform_camp_id= _str(req.body?.platform_camp_id, 80);
  const name            = _str(req.body?.name, 200);
  const daily_budget    = _num(req.body?.daily_budget, { min: 0, max: 1e6 });
  const owner_email     = _str(req.body?.owner_email, 200);
  const target_roas     = _num(req.body?.target_roas, { min: 0, max: 100 });
  if (!platform || !platform_camp_id || !name) return res.status(400).json({ ok: false, error: 'platform, platform_camp_id, name are required' });
  if (!_ALLOWED_PLATFORMS.has(platform.toLowerCase())) return res.status(400).json({ ok: false, error: 'platform must be meta|google|tiktok' });
  if (daily_budget === undefined || target_roas === undefined) return res.status(400).json({ ok: false, error: 'daily_budget / target_roas out of range' });
  const r = await _db.getPool().query(`
    INSERT INTO ad_campaigns (platform, platform_camp_id, name, daily_budget, owner_email, target_roas)
    VALUES ($1,$2,$3,$4,$5,COALESCE($6,2.00))
    ON CONFLICT (platform, platform_camp_id)
    DO UPDATE SET name=EXCLUDED.name, daily_budget=COALESCE(EXCLUDED.daily_budget, ad_campaigns.daily_budget),
                  owner_email=COALESCE(EXCLUDED.owner_email, ad_campaigns.owner_email),
                  updated_at=now()
    RETURNING *
  `, [platform.toLowerCase(), platform_camp_id, name, daily_budget, owner_email, target_roas]);
  res.json({ ok: true, campaign: r.rows[0] });
});

router.post('/enable', express.json(), async (req, res) => {
  const id = parseInt(req.body?.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'valid id required' });
  const enabled = !!req.body?.enabled;
  await _db.getPool().query(`UPDATE ad_campaigns SET optimizer_enabled=$1, updated_at=now() WHERE id=$2`, [enabled, id]);
  res.json({ ok: true });
});

router.post('/target', express.json(), async (req, res) => {
  const id = parseInt(req.body?.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'valid id required' });
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
     WHERE id = $4
  `, [target_roas, min_spend_floor, max_daily_budget, id]);
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

router.delete('/campaigns/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'bad id' });
  await _db.getPool().query(`DELETE FROM ad_campaigns WHERE id=$1`, [id]);
  res.json({ ok: true });
});

module.exports = router;
