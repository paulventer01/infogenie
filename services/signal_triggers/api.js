const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

const SIGNAL_TYPES = [
  { id: 'mention_spike',    label: 'Mention volume spike',     desc: 'Brand mentions surge above normal' },
  { id: 'sentiment_drop',   label: 'Sentiment drops negative', desc: 'Average sentiment turns sour' },
  { id: 'competitor_price', label: 'Competitor price change',  desc: 'A tracked competitor changes pricing' },
  { id: 'trending_keyword', label: 'New trending keyword',     desc: 'A keyword in your space starts trending' },
  { id: 'review_negative',  label: 'New negative review',      desc: '1-2 star review posted on a tracked source' },
  { id: 'crisis_alert',     label: 'Crisis radar alert',       desc: 'Crisis Radar flags a potential PR issue' },
  { id: 'manual',           label: 'Manual trigger',           desc: 'You fire it from the UI' },
  // Closed-loop SaaS lifecycle events → journeys
  { id: 'stripe_checkout_completed', label: 'Stripe checkout completed', desc: 'Customer completes a Stripe Checkout payment' },
  { id: 'stripe_payment_failed',     label: 'Stripe payment failed',     desc: 'Subscription invoice payment fails (dunning)' },
  { id: 'user_signup',               label: 'User signup',               desc: 'New account created in auth' },
  { id: 'product_purchased',         label: 'Product purchased',         desc: 'A product / Linksell order is paid' },
  { id: 'email_replied',             label: 'Email reply received',      desc: 'Prospect replies to an outreach email' },
];

router.get('/types', (_req, res) => res.json({ types: SIGNAL_TYPES }));

router.get('/', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ triggers: [] });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'signal_triggers:list' });
    const r = await pool.query(`SELECT * FROM signal_triggers WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
    res.json({ triggers: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'signal_triggers:save' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { id, name, signal_type, condition = {}, journey_id, enabled = true } = req.body || {};
    if (!name || !signal_type) return res.status(400).json({ error: 'name + signal_type required' });
    const sid = id || ('sig_' + crypto.randomBytes(5).toString('hex'));
    await pool.query(
      `INSERT INTO signal_triggers (id,tenant_id,name,signal_type,condition,journey_id,enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, signal_type=EXCLUDED.signal_type,
         condition=EXCLUDED.condition, journey_id=EXCLUDED.journey_id, enabled=EXCLUDED.enabled
       WHERE signal_triggers.tenant_id = EXCLUDED.tenant_id`,
      [sid, tid, name, signal_type, JSON.stringify(condition), journey_id || null, !!enabled]
    );
    res.json({ ok: true, id: sid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'signal_triggers:delete' });
    await pool.query(`DELETE FROM signal_triggers WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// fireSignal — called both from HTTP and from other services without req context.
// We fan out across ALL tenants: each matching trigger row carries its own tenant_id,
// and journey_runs are stamped with the trigger's tenant_id so the run stays in-tenant.
// signal_events row is stamped with the OPTIONAL payload.tenant_id (or null).
async function fireSignal(signal_type, payload = {}) {
  if (!hasDb()) return { matched: 0 };
  const evtTid = payload.tenant_id ? Number(payload.tenant_id) : null;
  await pool.query(
    `INSERT INTO signal_events (tenant_id, signal_type, payload) VALUES ($1,$2,$3)`,
    [evtTid, signal_type, JSON.stringify(payload)]);
  const t = await pool.query(`SELECT * FROM signal_triggers WHERE signal_type=$1 AND enabled=true`, [signal_type]);
  let matched = 0;
  for (const tr of t.rows) {
    if (!tr.journey_id) continue;
    // If event carries a tenant_id, only fire triggers in that tenant
    if (evtTid != null && tr.tenant_id != null && Number(tr.tenant_id) !== evtTid) continue;
    const cond = tr.condition || {};
    if (cond.minValue != null && Number(payload.value || 0) < Number(cond.minValue)) continue;
    if (cond.keyword && !String(JSON.stringify(payload)).toLowerCase().includes(String(cond.keyword).toLowerCase())) continue;
    try {
      const jr = await pool.query(
        `SELECT nodes,status,tenant_id FROM journeys WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL OR $2 IS NULL)`,
        [tr.journey_id, tr.tenant_id]);
      if (!jr.rows.length || jr.rows[0].status === 'paused') continue;
      const trigger = (jr.rows[0].nodes || []).find(n => n.type === 'trigger');
      if (!trigger) continue;
      const runTid = tr.tenant_id || jr.rows[0].tenant_id || null;
      await pool.query(
        `INSERT INTO journey_runs (tenant_id, journey_id, contact_email, contact_phone, contact_meta, current_node, next_run_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())`,
        [runTid, tr.journey_id, payload.email || null, payload.phone || null,
         JSON.stringify({ ...payload, signal_type }), trigger.id]
      );
      await pool.query(`UPDATE signal_triggers SET last_fired_at=now(), fire_count=fire_count+1 WHERE id=$1`, [tr.id]);
      await pool.query(`UPDATE journeys SET stats = jsonb_set(stats,'{started}', ((COALESCE(stats->>'started','0')::int)+1)::text::jsonb) WHERE id=$1`, [tr.journey_id]);
      matched++;
    } catch (e) {
      console.warn('[signal-triggers] fire failed:', e.message);
    }
  }
  return { matched };
}

router.post('/fire', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'signal_triggers:fire' });
    const { signal_type, payload = {} } = req.body || {};
    if (!signal_type) return res.status(400).json({ error: 'signal_type required' });
    // Stamp tenant_id on payload so fanout stays in-tenant
    const out = await fireSignal(signal_type, { ...payload, tenant_id: tid });
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/events/recent', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ events: [] });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'signal_triggers:events' });
    // Strict tenant scoping — global/null events are hidden from tenant views.
    const r = await pool.query(
      `SELECT * FROM signal_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`, [tid]);
    res.json({ events: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.fireSignal = fireSignal;
