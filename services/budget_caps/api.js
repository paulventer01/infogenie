const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

const PLATFORMS = ['google', 'meta', 'tiktok', 'microsoft', 'linkedin'];

// List platform caps.
// Mounted at /api/budget/caps → GET /api/budget/caps
// Legacy mount at /api/budget-caps → GET /api/budget-caps/caps
async function listCaps(req, res) {
  const tid = await _tid(req, 'budget-caps:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows: caps } = await p.query(
      'SELECT * FROM platform_budget_caps WHERE tenant_id=$1 ORDER BY platform', [tid]
    );
    const { rows: campaigns } = await p.query(
      `SELECT platform,
              SUM(daily_budget) AS total_daily_budget,
              SUM(COALESCE(lifetime_budget,0)) AS total_lifetime_budget,
              SUM(COALESCE(total_spend,0)) AS total_spend,
              COUNT(*) AS campaign_count
       FROM ad_campaigns WHERE tenant_id=$1 GROUP BY platform`, [tid]
    );
    const spendByPlatform = {};
    for (const r of campaigns) {
      spendByPlatform[r.platform] = {
        daily_budget: parseFloat(r.total_daily_budget) || 0,
        lifetime_budget: parseFloat(r.total_lifetime_budget) || 0,
        total_spend: parseFloat(r.total_spend) || 0,
        campaign_count: parseInt(r.campaign_count) || 0,
      };
    }
    res.json({ ok: true, caps, spend_by_platform: spendByPlatform });
  } catch (e) { _err(res, 500, e.message); }
}
router.get('/', listCaps);
router.get('/caps', listCaps);

// Upsert a platform cap.
// Family: PUT /api/budget/caps/:platform  · Legacy: PUT /api/budget-caps/caps/:platform
async function setCap(req, res) {
  const tid = await _tid(req, 'budget-caps:set');
  if (!tid) return _err(res, 400, 'no_tenant');
  const platform = req.params.platform.toLowerCase();
  if (!PLATFORMS.includes(platform)) return _err(res, 400, 'invalid platform');
  const { daily_cap, lifetime_cap, alert_threshold_pct, paused_at_limit } = req.body || {};
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `INSERT INTO platform_budget_caps (tenant_id,platform,daily_cap,lifetime_cap,alert_threshold_pct,paused_at_limit,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (tenant_id,platform) DO UPDATE SET
         daily_cap=EXCLUDED.daily_cap, lifetime_cap=EXCLUDED.lifetime_cap,
         alert_threshold_pct=COALESCE(EXCLUDED.alert_threshold_pct,platform_budget_caps.alert_threshold_pct),
         paused_at_limit=COALESCE(EXCLUDED.paused_at_limit,platform_budget_caps.paused_at_limit),
         updated_at=NOW()
       RETURNING *`,
      [tid, platform, daily_cap||null, lifetime_cap||null, alert_threshold_pct||80, paused_at_limit||false]
    );
    res.json({ ok: true, cap: rows[0] });
  } catch (e) { _err(res, 500, e.message); }
}
// Register /caps/:platform before /:platform so legacy paths stay unambiguous.
router.put('/caps/:platform', setCap);
router.put('/:platform', setCap);

// GET /api/budget-caps/campaigns
router.get('/campaigns', async (req, res) => {
  const tid = await _tid(req, 'budget-caps:campaigns');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `SELECT id,name,platform,daily_budget,lifetime_budget,total_spend,optimizer_enabled,status
       FROM ad_campaigns WHERE tenant_id=$1 ORDER BY platform,name`,
      [tid]
    );
    res.json({ ok: true, campaigns: rows });
  } catch (e) { _err(res, 500, e.message); }
});

// PUT /api/budget-caps/campaigns/:id
router.put('/campaigns/:id', async (req, res) => {
  const tid = await _tid(req, 'budget-caps:campaign-update');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { daily_budget, lifetime_budget } = req.body || {};
  try {
    const p = _db.getPool();
    await p.query(
      `UPDATE ad_campaigns SET
         daily_budget=COALESCE($1, daily_budget),
         lifetime_budget=COALESCE($2, lifetime_budget)
       WHERE id=$3 AND tenant_id=$4`,
      [daily_budget||null, lifetime_budget||null, req.params.id, tid]
    );
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
