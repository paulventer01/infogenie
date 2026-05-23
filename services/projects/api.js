const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

router.get('/', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ projects: [] });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'projects:list' });
    const r = await pool.query(
      `SELECT * FROM marketing_projects WHERE tenant_id = $1 ORDER BY updated_at DESC`,
      [tid]);
    res.json({ projects: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'projects:save' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { id, name, goal = '', monthly_budget = 0, channels = [], owner_email, brand_color = '#0066FF', start_date, end_date, status = 'active' } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const pid = id || ('proj_' + crypto.randomBytes(5).toString('hex'));
    // ON CONFLICT (id) is safe — id is the PK and project ids are random hex,
    // so cross-tenant id collisions are negligible. We still guard the UPDATE
    // path with `WHERE tenant_id = EXCLUDED.tenant_id` so a tenant cannot
    // overwrite another tenant's row even if id collided.
    await pool.query(
      `INSERT INTO marketing_projects (id,tenant_id,name,goal,monthly_budget,channels,owner_email,brand_color,start_date,end_date,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, goal=EXCLUDED.goal, monthly_budget=EXCLUDED.monthly_budget,
         channels=EXCLUDED.channels, owner_email=EXCLUDED.owner_email, brand_color=EXCLUDED.brand_color,
         start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, status=EXCLUDED.status,
         updated_at=now()
       WHERE marketing_projects.tenant_id = EXCLUDED.tenant_id`,
      [pid, tid, name, goal, +monthly_budget||0, JSON.stringify(channels), owner_email || null, brand_color, start_date || null, end_date || null, status]
    );
    res.json({ ok: true, id: pid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'projects:delete' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const r = await pool.query(
      `DELETE FROM marketing_projects WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
