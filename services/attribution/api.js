// T117 Multi-touch Attribution Dashboard
// Models: first-touch, last-touch, linear, position-based (40/20/40), time-decay
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[attribution]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

// ── Attribution math ──────────────────────────────────────────────────────────

function firstTouch(touchpoints, totalRevenue) {
  const result = touchpoints.map((t, i) => ({ ...t, credit: i === 0 ? totalRevenue : 0 }));
  return result;
}

function lastTouch(touchpoints, totalRevenue) {
  const last = touchpoints.length - 1;
  return touchpoints.map((t, i) => ({ ...t, credit: i === last ? totalRevenue : 0 }));
}

function linear(touchpoints, totalRevenue) {
  const share = totalRevenue / (touchpoints.length || 1);
  return touchpoints.map(t => ({ ...t, credit: share }));
}

function positionBased(touchpoints, totalRevenue) {
  const n = touchpoints.length;
  if (n === 0) return touchpoints;
  if (n === 1) return touchpoints.map(t => ({ ...t, credit: totalRevenue }));
  if (n === 2) return touchpoints.map((t, i) => ({ ...t, credit: totalRevenue * 0.5 }));
  const midShare = (totalRevenue * 0.2) / Math.max(n - 2, 1);
  return touchpoints.map((t, i) => {
    let credit = i === 0 ? totalRevenue * 0.4 : i === n - 1 ? totalRevenue * 0.4 : midShare;
    return { ...t, credit };
  });
}

function timeDecay(touchpoints, totalRevenue) {
  const n = touchpoints.length;
  if (n === 0) return touchpoints;
  // More recent = higher weight. Weights: 1, 2, 4, 8, ... (geometric)
  const weights = touchpoints.map((_, i) => Math.pow(2, i));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return touchpoints.map((t, i) => ({ ...t, credit: (weights[i] / totalWeight) * totalRevenue }));
}

function buildModels(touchpoints, totalRevenue) {
  return {
    first_touch:    firstTouch([...touchpoints], totalRevenue),
    last_touch:     lastTouch([...touchpoints], totalRevenue),
    linear:         linear([...touchpoints], totalRevenue),
    position_based: positionBased([...touchpoints], totalRevenue),
    time_decay:     timeDecay([...touchpoints], totalRevenue),
  };
}

function generateInsights(touchpoints, models) {
  const insights = [];
  if (!touchpoints.length) return insights;

  // Highest spend channel
  const topSpend = [...touchpoints].sort((a, b) => b.spend - a.spend)[0];
  if (topSpend) insights.push({ type: 'spend', text: `${topSpend.channel} has the highest spend at $${(+topSpend.spend).toLocaleString()}.` });

  // Best ROAS channel (first-touch model as reference)
  const byRoas = touchpoints
    .map(t => ({ channel: t.channel, roas: t.spend > 0 ? (+t.revenue / +t.spend) : 0 }))
    .sort((a, b) => b.roas - a.roas);
  if (byRoas[0] && byRoas[0].roas > 0)
    insights.push({ type: 'roas', text: `${byRoas[0].channel} delivers the best ROAS at ${byRoas[0].roas.toFixed(2)}x.` });

  // First-touch vs last-touch divergence
  const ft = models.first_touch;
  const lt = models.last_touch;
  if (ft && lt) {
    const firstWinner = ft.reduce((a, b) => a.credit > b.credit ? a : b);
    const lastWinner  = lt.reduce((a, b) => a.credit > b.credit ? a : b);
    if (firstWinner.channel !== lastWinner.channel) {
      insights.push({ type: 'divergence', text: `First-touch credits ${firstWinner.channel} while last-touch credits ${lastWinner.channel} — consider multi-touch models to share credit fairly.` });
    }
  }

  // CPA by channel
  const cpas = touchpoints.filter(t => t.customers > 0)
    .map(t => ({ channel: t.channel, cpa: +t.spend / +t.customers }))
    .sort((a, b) => a.cpa - b.cpa);
  if (cpas[0]) insights.push({ type: 'cpa', text: `${cpas[0].channel} has the lowest CPA at $${cpas[0].cpa.toFixed(2)} per customer.` });

  return insights;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/model', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'attribution:model' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const { name = 'Attribution Run', date_range = '', touchpoints = [] } = req.body;
  if (!Array.isArray(touchpoints) || touchpoints.length < 1)
    return _err(res, 400, 'At least 1 touchpoint required');

  const cleaned = touchpoints.map((t, i) => ({
    channel:     String(t.channel || `Channel ${i + 1}`).slice(0, 100),
    spend:       Math.max(0, Number(t.spend) || 0),
    impressions: Math.max(0, Math.round(Number(t.impressions) || 0)),
    clicks:      Math.max(0, Math.round(Number(t.clicks) || 0)),
    leads:       Math.max(0, Math.round(Number(t.leads) || 0)),
    customers:   Math.max(0, Math.round(Number(t.customers) || 0)),
    revenue:     Math.max(0, Number(t.revenue) || 0),
    position:    i,
  }));

  const totalRevenue = cleaned.reduce((s, t) => s + t.revenue, 0);
  const totalSpend   = cleaned.reduce((s, t) => s + t.spend,   0);
  const totalLeads   = cleaned.reduce((s, t) => s + t.leads,   0);
  const totalCustomers = cleaned.reduce((s, t) => s + t.customers, 0);

  const models   = buildModels(cleaned, totalRevenue);
  const insights = generateInsights(cleaned, models);

  const db = _db.getPool();
  const runResult = await db.query(
    `INSERT INTO attribution_runs (tenant_id, name, date_range, total_spend, total_revenue, total_leads, total_customers, models, insights)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [tid, name.slice(0, 200), date_range, totalSpend, totalRevenue, totalLeads, totalCustomers,
     JSON.stringify(models), JSON.stringify(insights)]
  );
  const runId = runResult.rows[0].id;

  for (const t of cleaned) {
    await db.query(
      `INSERT INTO attribution_touchpoints (tenant_id, run_id, channel, spend, impressions, clicks, leads, customers, revenue, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, runId, t.channel, t.spend, t.impressions, t.clicks, t.leads, t.customers, t.revenue, t.position]
    );
  }

  res.json({ ok: true, run_id: runId, models, insights, totals: { spend: totalSpend, revenue: totalRevenue, leads: totalLeads, customers: totalCustomers } });
}));

router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'attribution:history' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = _db.getPool();
  const { rows } = await db.query(
    `SELECT id, name, date_range, total_spend, total_revenue, total_leads, total_customers, models, insights, created_at
     FROM attribution_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [tid]
  );
  res.json({ ok: true, runs: rows });
}));

router.get('/run/:id/touchpoints', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'attribution:touchpoints' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = _db.getPool();
  const { rows } = await db.query(
    `SELECT t.* FROM attribution_touchpoints t
     JOIN attribution_runs r ON r.id = t.run_id
     WHERE t.run_id=$1 AND r.tenant_id=$2
     ORDER BY t.position`,
    [req.params.id, tid]
  );
  res.json({ ok: true, touchpoints: rows });
}));

router.delete('/run/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'attribution:delete' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = _db.getPool();
  await db.query(
    `DELETE FROM attribution_runs WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  res.json({ ok: true });
}));

/** Record a revenue event attributed to a channel/campaign (Stripe, email, etc.). */
async function recordRevenueEvent({
  tenant_id, email, amount = 0, channel = 'email', campaign = null,
  source = 'manual', utm_source = null, utm_medium = null, utm_campaign = null, meta = {},
}) {
  if (!_db.hasDb()) return null;
  // Ensure table exists (idempotent) for older boots.
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS attribution_revenue_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT,
      email TEXT,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'email',
      campaign TEXT,
      source TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch(() => {});
  const r = await _db.getPool().query(
    `INSERT INTO attribution_revenue_events
      (tenant_id, email, amount, channel, campaign, source, utm_source, utm_medium, utm_campaign, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
    [
      tenant_id || null, email || null, Number(amount) || 0, channel, campaign, source,
      utm_source, utm_medium, utm_campaign || campaign, JSON.stringify(meta || {}),
    ]
  );
  return r.rows[0];
}

router.post('/revenue-event', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'attribution:revenue' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const row = await recordRevenueEvent({ ...req.body, tenant_id: tid });
  res.json({ ok: true, event: row });
}));

router.get('/revenue-events', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'attribution:revenue-list' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { rows } = await _db.getPool().query(
    `SELECT * FROM attribution_revenue_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [tid]
  ).catch(() => ({ rows: [] }));
  res.json({ ok: true, events: rows });
}));

/** Aggregate revenue by channel for auto-UTM / email proof. */
router.get('/revenue-by-channel', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'attribution:revenue-by-channel' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const { rows } = await _db.getPool().query(
    `SELECT COALESCE(channel,'unknown') AS channel,
            COALESCE(utm_campaign, campaign, 'unknown') AS campaign,
            COUNT(*)::int AS events,
            SUM(amount)::float AS revenue
     FROM attribution_revenue_events
     WHERE tenant_id=$1 AND created_at > now() - ($2 || ' days')::interval
     GROUP BY 1, 2
     ORDER BY revenue DESC NULLS LAST
     LIMIT 50`,
    [tid, String(days)]
  ).catch(() => ({ rows: [] }));
  res.json({ ok: true, days, rows });
}));

module.exports = router;
module.exports.recordRevenueEvent = recordRevenueEvent;
module.exports.buildModels = buildModels;
