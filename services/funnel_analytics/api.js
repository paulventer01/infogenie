const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const STEP_TYPES = [
  { id: 'page',     label: 'Page View' },
  { id: 'optin',    label: 'Opt-In / Lead' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'sale',     label: 'Sale / Order' },
  { id: 'upsell',   label: 'Upsell' },
  { id: 'thankyou', label: 'Thank You' },
];

const RANGES = { '7': 7, '30': 30, '90': 90, '365': 365 };

function ipHash(req) {
  const ip = req.socket?.remoteAddress || '';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

router.get('/config', (req, res) => {
  res.json({ ok: true, step_types: STEP_TYPES });
});

// ── Funnels CRUD ──────────────────────────────────────────────────────────────

router.get('/funnels', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:list' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT f.*,
       (SELECT COUNT(*) FROM funnel_steps WHERE funnel_id=f.id) AS step_count,
       (SELECT COUNT(*) FROM funnel_events WHERE funnel_id=f.id AND event_type='pageview' AND created_at > NOW()-INTERVAL '30 days') AS views_30d,
       (SELECT COUNT(*) FROM funnel_events WHERE funnel_id=f.id AND event_type='optin'    AND created_at > NOW()-INTERVAL '30 days') AS optins_30d,
       (SELECT COUNT(*) FROM funnel_events WHERE funnel_id=f.id AND event_type='sale'     AND created_at > NOW()-INTERVAL '30 days') AS sales_30d,
       (SELECT COALESCE(SUM(revenue),0) FROM funnel_events WHERE funnel_id=f.id AND event_type='sale' AND created_at > NOW()-INTERVAL '30 days') AS revenue_30d
     FROM funnels f WHERE f.tenant_id=$1 ORDER BY f.created_at DESC`,
    [tid]
  );
  res.json({ ok: true, funnels: r.rows });
});

router.post('/funnels', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:create' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, description, currency = 'USD', steps = [] } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const p = await _db.getPool();
  const fRow = await p.query(
    `INSERT INTO funnels(tenant_id,name,description,currency) VALUES($1,$2,$3,$4) RETURNING *`,
    [tid, name, description || null, currency]
  );
  const funnel = fRow.rows[0];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await p.query(
      `INSERT INTO funnel_steps(funnel_id,tenant_id,name,step_type,url_pattern,position) VALUES($1,$2,$3,$4,$5,$6)`,
      [funnel.id, tid, s.name, s.step_type || 'page', s.url_pattern || null, i]
    );
  }
  const fullSteps = await p.query(`SELECT * FROM funnel_steps WHERE funnel_id=$1 ORDER BY position`, [funnel.id]);
  res.json({ ok: true, funnel: { ...funnel, steps: fullSteps.rows } });
});

router.get('/funnels/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:get' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(`SELECT * FROM funnels WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const steps = await p.query(`SELECT * FROM funnel_steps WHERE funnel_id=$1 ORDER BY position`, [req.params.id]);
  res.json({ ok: true, funnel: { ...r.rows[0], steps: steps.rows } });
});

router.put('/funnels/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:update' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, description, status, currency } = req.body;
  const p = await _db.getPool();
  await p.query(
    `UPDATE funnels SET name=COALESCE($1,name), description=COALESCE($2,description), status=COALESCE($3,status), currency=COALESCE($4,currency), updated_at=NOW() WHERE id=$5 AND tenant_id=$6`,
    [name, description, status, currency, req.params.id, tid]
  );
  res.json({ ok: true });
});

router.delete('/funnels/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:delete' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM funnels WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

// ── Steps CRUD ────────────────────────────────────────────────────────────────

router.post('/funnels/:id/steps', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:add-step' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, step_type = 'page', url_pattern } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const p = await _db.getPool();
  const pos = await p.query(`SELECT COALESCE(MAX(position),0)+1 AS next FROM funnel_steps WHERE funnel_id=$1`, [req.params.id]);
  const r = await p.query(
    `INSERT INTO funnel_steps(funnel_id,tenant_id,name,step_type,url_pattern,position) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, tid, name, step_type, url_pattern || null, pos.rows[0].next]
  );
  res.json({ ok: true, step: r.rows[0] });
});

router.put('/steps/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:update-step' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, step_type, url_pattern, position } = req.body;
  const p = await _db.getPool();
  await p.query(
    `UPDATE funnel_steps SET name=COALESCE($1,name), step_type=COALESCE($2,step_type), url_pattern=COALESCE($3,url_pattern), position=COALESCE($4,position) WHERE id=$5 AND tenant_id=$6`,
    [name, step_type, url_pattern, position, req.params.id, tid]
  );
  res.json({ ok: true });
});

router.delete('/steps/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:delete-step' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM funnel_steps WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

// ── Pixel tracking endpoint (no auth — fires from embed JS) ──────────────────

router.post('/track', async (req, res) => {
  const { pixel_id, step_id, event_type, session_id, revenue = 0, currency = 'USD', utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer, meta = {} } = req.body;
  if (!pixel_id || !event_type) return res.status(400).json({ ok: false, error: 'pixel_id and event_type required' });
  if (!['pageview','optin','checkout','sale','upsell'].includes(event_type)) return res.status(400).json({ ok: false, error: 'invalid event_type' });
  try {
    const p = await _db.getPool();
    const fRow = await p.query(`SELECT id, tenant_id FROM funnels WHERE pixel_id=$1 AND status='active'`, [pixel_id]);
    if (!fRow.rows.length) return res.status(404).json({ ok: false, error: 'funnel not found' });
    const { id: funnel_id, tenant_id: tid } = fRow.rows[0];
    const ua = req.headers['user-agent']?.slice(0, 300) || null;
    await p.query(
      `INSERT INTO funnel_events(funnel_id,step_id,tenant_id,session_id,event_type,revenue,currency,utm_source,utm_medium,utm_campaign,utm_term,utm_content,referrer,ip_hash,user_agent,meta)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [funnel_id, step_id || null, tid, session_id || null, event_type, +revenue || 0, currency,
       utm_source || null, utm_medium || null, utm_campaign || null, utm_term || null, utm_content || null,
       referrer?.slice(0, 500) || null, ipHash(req), ua, JSON.stringify(meta)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'tracking_error' });
  }
});

// ── Analytics aggregation ─────────────────────────────────────────────────────

router.get('/funnels/:id/stats', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:stats' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const days = RANGES[req.query.range] || 30;
  const p = await _db.getPool();
  const fRow = await p.query(`SELECT * FROM funnels WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!fRow.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const funnel = fRow.rows[0];

  const steps = await p.query(`SELECT * FROM funnel_steps WHERE funnel_id=$1 ORDER BY position`, [req.params.id]);

  // Per-step stats
  const stepStats = await Promise.all(steps.rows.map(async (s) => {
    const r = await p.query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type='pageview') AS views_all,
         COUNT(DISTINCT session_id) FILTER (WHERE event_type='pageview') AS views_unique,
         COUNT(*) FILTER (WHERE event_type='optin') AS optins_all,
         COUNT(DISTINCT session_id) FILTER (WHERE event_type='optin') AS optins_unique,
         COUNT(*) FILTER (WHERE event_type IN ('sale','checkout')) AS sales_orders,
         COUNT(DISTINCT session_id) FILTER (WHERE event_type IN ('sale','checkout')) AS sales_unique,
         COALESCE(SUM(revenue) FILTER (WHERE event_type='sale'),0) AS revenue_gross
       FROM funnel_events
       WHERE step_id=$1 AND tenant_id=$2 AND created_at > NOW()-($3::int * INTERVAL '1 day')`,
      [s.id, tid, days]
    );
    return { ...s, ...r.rows[0] };
  }));

  // Funnel-level totals
  const totals = await p.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_type='pageview') AS total_views,
       COUNT(DISTINCT session_id) FILTER (WHERE event_type='pageview') AS total_unique_views,
       COUNT(*) FILTER (WHERE event_type='optin') AS total_optins,
       COUNT(*) FILTER (WHERE event_type='sale') AS total_sales,
       COALESCE(SUM(revenue) FILTER (WHERE event_type='sale'),0) AS total_revenue,
       COUNT(DISTINCT utm_source) FILTER (WHERE utm_source IS NOT NULL) AS utm_source_count
     FROM funnel_events
     WHERE funnel_id=$1 AND tenant_id=$2 AND created_at > NOW()-($3::int * INTERVAL '1 day')`,
    [req.params.id, tid, days]
  );
  const t = totals.rows[0];
  const totalViews   = +t.total_views   || 0;
  const totalOptins  = +t.total_optins  || 0;
  const totalSales   = +t.total_sales   || 0;
  const totalRevenue = +t.total_revenue || 0;

  // EPC = revenue / unique pageview clicks (sessions)
  const totalUniqueViews = +t.total_unique_views || 0;
  const epc  = totalUniqueViews > 0 ? +(totalRevenue / totalUniqueViews).toFixed(4) : 0;
  const eppv = totalViews > 0 ? +(totalRevenue / totalViews).toFixed(4) : 0;
  const acv  = totalSales > 0 ? +(totalRevenue / totalSales).toFixed(2) : 0;

  // UTM breakdown
  const utms = await p.query(
    `SELECT utm_source, utm_medium, utm_campaign,
       COUNT(*) FILTER (WHERE event_type='pageview') AS views,
       COUNT(*) FILTER (WHERE event_type='optin') AS optins,
       COUNT(*) FILTER (WHERE event_type='sale') AS sales,
       COALESCE(SUM(revenue) FILTER (WHERE event_type='sale'),0) AS revenue
     FROM funnel_events
     WHERE funnel_id=$1 AND tenant_id=$2 AND created_at > NOW()-($3::int * INTERVAL '1 day')
       AND utm_source IS NOT NULL
     GROUP BY utm_source, utm_medium, utm_campaign ORDER BY views DESC LIMIT 20`,
    [req.params.id, tid, days]
  );

  // Daily trend (views + sales last N days)
  const trend = await p.query(
    `SELECT DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') AS day,
       COUNT(*) FILTER (WHERE event_type='pageview') AS views,
       COUNT(*) FILTER (WHERE event_type='optin') AS optins,
       COUNT(*) FILTER (WHERE event_type='sale') AS sales,
       COALESCE(SUM(revenue) FILTER (WHERE event_type='sale'),0) AS revenue
     FROM funnel_events
     WHERE funnel_id=$1 AND tenant_id=$2 AND created_at > NOW()-($3::int * INTERVAL '1 day')
     GROUP BY 1 ORDER BY 1`,
    [req.params.id, tid, days]
  );

  res.json({
    ok: true,
    funnel,
    summary: {
      total_views: totalViews,
      total_unique_views: totalUniqueViews,
      total_optins: totalOptins,
      total_sales: totalSales,
      total_revenue: totalRevenue,
      optin_rate: totalViews > 0 ? +((totalOptins / totalViews) * 100).toFixed(2) : 0,
      sale_rate: totalOptins > 0 ? +((totalSales / totalOptins) * 100).toFixed(2) : 0,
      overall_conversion: totalViews > 0 ? +((totalSales / totalViews) * 100).toFixed(2) : 0,
      earnings_per_click: epc,
      earnings_per_page_view: eppv,
      average_cart_value: acv,
    },
    steps: stepStats,
    utms: utms.rows,
    trend: trend.rows,
    days,
  });
});

// ── Embed snippet ─────────────────────────────────────────────────────────────

router.get('/funnels/:id/snippet', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'funnel-analytics:snippet' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(`SELECT pixel_id, name FROM funnels WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const { pixel_id, name } = r.rows[0];
  const steps = await p.query(`SELECT id, name, step_type, url_pattern FROM funnel_steps WHERE funnel_id=$1 ORDER BY position`, [req.params.id]);
  const baseUrl = process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG}.replit.app`;
  const snippet = `<!-- InfoGenie Funnel Pixel — ${name} -->
<script>
(function(){
  var IG_PIXEL_ID="${pixel_id}";
  var IG_ENDPOINT="${baseUrl}/api/funnel-analytics/track";
  var _sid=localStorage.getItem('ig_sid')||(function(){var s=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('ig_sid',s);return s;})();
  var _up=new URLSearchParams(location.search);
  var _base={pixel_id:IG_PIXEL_ID,session_id:_sid,referrer:document.referrer,utm_source:_up.get('utm_source'),utm_medium:_up.get('utm_medium'),utm_campaign:_up.get('utm_campaign'),utm_term:_up.get('utm_term'),utm_content:_up.get('utm_content')};
  window.igTrack=function(event_type,opts){
    fetch(IG_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({},_base,{event_type:event_type},opts||{})),keepalive:true}).catch(function(){});
  };
  // Auto-track pageview
  igTrack('pageview');
})();
</script>
<!-- End InfoGenie Pixel -->

<!-- Usage examples:
  igTrack('optin');                        // on form submit
  igTrack('sale', { revenue: 97.00 });     // on successful checkout
  igTrack('upsell', { revenue: 47.00 });   // on upsell accept
-->

<!-- Step IDs for this funnel:
${steps.rows.map(s => `  Step "${s.name}" (${s.step_type}): step_id=${s.id}`).join('\n')}
-->`;
  res.json({ ok: true, pixel_id, snippet });
});

module.exports = router;
