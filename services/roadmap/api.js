// T37 — Get-Started Roadmap API
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { PLAN, SOCIAL_CADENCE, PRINCIPLES } = require('./catalog');

const router = express.Router();

router.get('/catalog', (_req, res) => {
  res.json({ ok: true, plan: PLAN, socialCadence: SOCIAL_CADENCE, principles: PRINCIPLES });
});

router.get('/progress', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, completed: {} });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roadmap:progress' });
  const r = await _db.getPool().query(`SELECT task_id, completed_at FROM roadmap_progress WHERE tenant_id = $1`, [tid]);
  const completed = {};
  for (const row of r.rows) completed[row.task_id] = row.completed_at;
  res.json({ ok: true, completed, completedCount: r.rows.length, totalCount: PLAN.length });
});

router.post('/progress/:taskId', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'no-db' });
  const taskId = String(req.params.taskId).slice(0, 64);
  if (!PLAN.find(p => p.id === taskId)) return res.status(404).json({ ok: false, error: 'unknown task' });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roadmap:set-progress' });
  await _db.getPool().query(
    `INSERT INTO roadmap_progress (tenant_id, task_id) VALUES ($1,$2)
     ON CONFLICT (task_id) DO UPDATE SET completed_at = now()`,
    [tid, taskId],
  );
  res.json({ ok: true });
});

router.delete('/progress/:taskId', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'no-db' });
  const taskId = String(req.params.taskId).slice(0, 64);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roadmap:delete-progress' });
  await _db.getPool().query(`DELETE FROM roadmap_progress WHERE task_id = $1 AND tenant_id = $2`, [taskId, tid]);
  res.json({ ok: true });
});

router.post('/reset', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'no-db' });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roadmap:reset' });
  await _db.getPool().query(`DELETE FROM roadmap_progress WHERE tenant_id = $1`, [tid]);
  res.json({ ok: true });
});

module.exports = router;
