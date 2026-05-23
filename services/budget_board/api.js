const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

function _ymNow() { const d = new Date(); return d.toISOString().slice(0,7); }

// ── Budgets CRUD ──
router.get('/budgets', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ budgets: [] });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'budgets:list', allowFallback:true });
    const r = await pool.query(`SELECT * FROM budgets WHERE tenant_id=$1 ORDER BY period_month DESC`, [tid]);
    res.json({ budgets: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/budgets', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'budgets:save', allowFallback:true });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { id, period_month, target_cents = 0, by_channel = {}, project_id } = req.body || {};
    if (!period_month) return res.status(400).json({ error: 'period_month required (YYYY-MM)' });
    // Upsert keyed on (tenant_id, period_month, project_id)
    const existing = await pool.query(
      `SELECT id FROM budgets WHERE tenant_id=$1 AND period_month=$2 AND COALESCE(project_id,'')=COALESCE($3,'') LIMIT 1`,
      [tid, period_month, project_id || null]
    );
    const bid = id || existing.rows[0]?.id || ('bud_' + crypto.randomBytes(5).toString('hex'));
    await pool.query(
      `INSERT INTO budgets (id,tenant_id,period_month,target_cents,by_channel,project_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         period_month=EXCLUDED.period_month, target_cents=EXCLUDED.target_cents,
         by_channel=EXCLUDED.by_channel, project_id=EXCLUDED.project_id
       WHERE budgets.tenant_id = EXCLUDED.tenant_id`,
      [bid, tid, period_month, +target_cents||0, JSON.stringify(by_channel), project_id || null]
    );
    res.json({ ok: true, id: bid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spend logging ──
router.post('/spend', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'spend:log', allowFallback:true });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { channel, amount_cents, occurred_at, source = 'manual', project_id, notes = '' } = req.body || {};
    if (!channel || amount_cents == null) return res.status(400).json({ error: 'channel + amount_cents required' });
    await pool.query(
      `INSERT INTO spend_events (tenant_id,channel,amount_cents,occurred_at,source,project_id,notes)
       VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6,$7)`,
      [tid, channel, +amount_cents, occurred_at || null, source, project_id || null, notes]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/spend/recent', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ events: [] });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'spend:recent', allowFallback:true });
    const r = await pool.query(`SELECT * FROM spend_events WHERE tenant_id=$1 ORDER BY occurred_at DESC, id DESC LIMIT 100`, [tid]);
    res.json({ events: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Summary: budget vs actual for current month + per-channel breakdown ──
router.get('/summary', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ period_month: _ymNow(), target_cents: 0, spent_cents: 0, by_channel: [] });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'budgets:summary', allowFallback:true });
    const period = req.query.month || _ymNow();
    const bRow = await pool.query(
      `SELECT target_cents, by_channel FROM budgets WHERE tenant_id=$1 AND period_month=$2 ORDER BY created_at DESC LIMIT 1`,
      [tid, period]);
    const target_cents = bRow.rows[0]?.target_cents || 0;
    const allocByCh = bRow.rows[0]?.by_channel || {};
    const sRow = await pool.query(
      `SELECT channel, SUM(amount_cents)::bigint AS spent
         FROM spend_events
         WHERE tenant_id=$1 AND to_char(occurred_at,'YYYY-MM') = $2
         GROUP BY channel`,
      [tid, period]
    );
    const spentByCh = {};
    let total_spent = 0;
    sRow.rows.forEach(r => { spentByCh[r.channel] = Number(r.spent); total_spent += Number(r.spent); });
    const channels = new Set([...Object.keys(allocByCh), ...Object.keys(spentByCh)]);
    const by_channel = Array.from(channels).map(ch => ({
      channel: ch,
      allocated_cents: Number(allocByCh[ch] || 0),
      spent_cents: spentByCh[ch] || 0,
      utilization: allocByCh[ch] ? Math.round((spentByCh[ch] || 0) / Number(allocByCh[ch]) * 100) : null
    })).sort((a,b) => b.spent_cents - a.spent_cents);
    // 30-day daily trend
    const tRow = await pool.query(
      `SELECT to_char(occurred_at,'YYYY-MM-DD') AS day, SUM(amount_cents)::bigint AS spent
         FROM spend_events
         WHERE tenant_id=$1 AND occurred_at >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY day ORDER BY day`,
      [tid]
    );
    res.json({
      period_month: period,
      target_cents,
      spent_cents: total_spent,
      remaining_cents: target_cents - total_spent,
      utilization_pct: target_cents ? Math.round(total_spent / target_cents * 100) : null,
      by_channel,
      daily_30d: tRow.rows.map(r => ({ day: r.day, spent_cents: Number(r.spent) }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
