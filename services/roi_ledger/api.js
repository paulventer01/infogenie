const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { logAction } = require('./logger');

const MODULE_META = {
  optimizer:        { icon: '🤖', label: 'AI Campaign Optimizer', colour: '#6366f1' },
  budget_arbitrage: { icon: '⚖️', label: 'Budget Arbitrage',      colour: '#0ea5e9' },
  self_healing:     { icon: '🩹', label: 'Self-Healing Ads',      colour: '#f59e0b' },
  agent_swarm:      { icon: '🐝', label: 'Agent Swarm',           colour: '#8b5cf6' },
  autoseo:          { icon: '🚀', label: 'AutoSEO Pro',           colour: '#10b981' },
  journey:          { icon: '🗺️', label: 'Journey Builder',       colour: '#ec4899' },
  workflow:         { icon: '🔧', label: 'Workflow Automation',    colour: '#64748b' },
  other:            { icon: '⚡', label: 'Other AI Action',       colour: '#94a3b8' },
};

// ── Dashboard summary ────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roi-ledger:dashboard' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);

  const [totals, byModule, byDay, recent] = await Promise.all([
    p.query(`
      SELECT
        COUNT(*) AS action_count,
        COALESCE(SUM(estimated_value),0) AS estimated_total,
        COALESCE(SUM(actual_value),0)    AS actual_total,
        COUNT(DISTINCT module)           AS modules_active
      FROM roi_actions
      WHERE tenant_id=$1 AND created_at >= NOW() - ($2 || ' days')::INTERVAL
    `, [tid, days]),

    p.query(`
      SELECT module, COUNT(*) AS n, COALESCE(SUM(estimated_value),0) AS value_sum
      FROM roi_actions
      WHERE tenant_id=$1 AND created_at >= NOW() - ($2 || ' days')::INTERVAL
      GROUP BY module ORDER BY value_sum DESC
    `, [tid, days]),

    p.query(`
      SELECT DATE_TRUNC('day', created_at)::DATE AS day,
             COUNT(*) AS n,
             COALESCE(SUM(estimated_value),0) AS value_sum
      FROM roi_actions
      WHERE tenant_id=$1 AND created_at >= NOW() - ($2 || ' days')::INTERVAL
      GROUP BY 1 ORDER BY 1
    `, [tid, days]),

    p.query(`
      SELECT * FROM roi_actions
      WHERE tenant_id=$1
      ORDER BY created_at DESC LIMIT 50
    `, [tid]),
  ]);

  res.json({
    ok: true,
    totals: totals.rows[0],
    by_module: byModule.rows.map(r => ({ ...r, meta: MODULE_META[r.module] || MODULE_META.other })),
    by_day: byDay.rows,
    recent: recent.rows,
    module_meta: MODULE_META,
    days,
  });
});

// ── Action feed (paginated) ──────────────────────────────────────────────────
router.get('/actions', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roi-ledger:actions' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const days   = Math.min(parseInt(req.query.days) || 30, 365);
  const module = req.query.module || null;
  const rows = await p.query(
    `SELECT * FROM roi_actions
     WHERE tenant_id=$1
       AND created_at >= NOW() - ($2 || ' days')::INTERVAL
       ${module ? `AND module=$3` : ''}
     ORDER BY created_at DESC LIMIT 200`,
    module ? [tid, days, module] : [tid, days]
  );
  res.json({ ok: true, actions: rows.rows });
});

// ── Manual log (internal or from other modules) ──────────────────────────────
router.post('/log', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roi-ledger:log' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { action_type, module, title, description, estimated_value, currency, metadata } = req.body;
  if (!action_type || !module || !title) return res.status(400).json({ ok: false, error: 'action_type, module, title required' });
  await logAction(tid, { action_type, module, title, description, estimated_value, currency, metadata });
  res.json({ ok: true });
});

// ── Resolve with actual outcome ──────────────────────────────────────────────
router.post('/resolve/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roi-ledger:resolve' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const { actual_value, status } = req.body;
  await p.query(
    `UPDATE roi_actions SET actual_value=$1, status=COALESCE($2,status), resolved_at=NOW()
     WHERE id=$3 AND tenant_id=$4`,
    [actual_value || 0, status || 'verified', req.params.id, tid]
  );
  res.json({ ok: true });
});

// ── Seed demo actions (for new accounts) ────────────────────────────────────
router.post('/seed', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'roi-ledger:seed' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const existing = await p.query(`SELECT COUNT(*) AS n FROM roi_actions WHERE tenant_id=$1`, [tid]);
  if (+existing.rows[0].n > 0) return res.json({ ok: true, seeded: 0, message: 'Already has data' });

  const now = new Date();
  const seeds = [
    { days_ago: 0,  module: 'optimizer',        action_type: 'budget_rebalanced',  title: 'Reallocated $840 from Meta to Google', description: 'Google ROAS 3.2× vs Meta 1.8× — shifted 35% of Meta daily budget to Google Shopping.', estimated_value: 312 },
    { days_ago: 0,  module: 'self_healing',      action_type: 'ad_healed',          title: 'Healed rejected Meta ad "Summer Sale Hero"', description: 'Removed superlative language ("best prices ever") — rewrote headline to policy-compliant copy. Ad ready to resubmit.', estimated_value: 180 },
    { days_ago: 1,  module: 'optimizer',        action_type: 'campaign_scaled',    title: 'Scaled Google Shopping budget +40%', description: 'CVR 6.2% at $18 CPA — 2.4× above campaign target. Increased daily cap from $500 to $700.', estimated_value: 540 },
    { days_ago: 1,  module: 'budget_arbitrage', action_type: 'budget_shifted',     title: 'Shifted $1,200 from TikTok to Meta', description: 'Meta ROAS 3.8× vs TikTok 1.1× over 72h. Projected +28% blended ROAS uplift.', estimated_value: 336 },
    { days_ago: 2,  module: 'autoseo',          action_type: 'content_published',  title: 'Published 3 AI-optimised blog posts', description: 'AutoSEO detected keyword gaps for "best CRM for agencies". Published pillar + 2 supporting articles. Est. 1,200 monthly impressions.', estimated_value: 90 },
    { days_ago: 2,  module: 'agent_swarm',      action_type: 'swarm_completed',    title: 'Competitor change detected → counter-brief drafted', description: 'Swarm: spy agent detected AcmeCo new pricing page → copywriter drafted counter-messaging → pushed to approval queue. 3 steps, 4 min.', estimated_value: 200 },
    { days_ago: 3,  module: 'journey',          action_type: 'sequence_fired',     title: 'Re-engagement sequence: 48 contacts', description: 'Lapsed >60 days. Journey Builder fired 3-step win-back email sequence. Open rate: 34%, 6 bookings recovered.', estimated_value: 720 },
    { days_ago: 3,  module: 'optimizer',        action_type: 'campaign_paused',    title: 'Paused 2 underperforming Google campaigns', description: 'ROAS below 0.8× floor for 48h. Saved from burning $320 in further spend on non-converting segments.', estimated_value: 320 },
    { days_ago: 4,  module: 'self_healing',      action_type: 'ad_healed',          title: 'Healed rejected TikTok video ad', description: 'Platform flagged misleading health claim. AI rewrote caption with evidence-based language. Confidence: 94%.', estimated_value: 150 },
    { days_ago: 5,  module: 'optimizer',        action_type: 'creative_refreshed', title: 'Generated 4 new ad creatives via MAB', description: 'Bandit algorithm identified creative fatigue on 2 Meta ad sets (CTR dropped 40%). Generated 4 new headline/body variants.', estimated_value: 280 },
    { days_ago: 5,  module: 'budget_arbitrage', action_type: 'budget_shifted',     title: 'Shifted $600 from display to search', description: 'Purchase intent signals up 18% on branded search. Reallocated display budget to capture high-intent queries.', estimated_value: 180 },
    { days_ago: 6,  module: 'workflow',         action_type: 'workflow_ran',       title: 'Lead scored → HubSpot deal created automatically', description: 'Identity Spine scored 12 new leads >80 pts. Workflow triggered: tagged contacts + created HubSpot deals + Slack alert to sales.', estimated_value: 120 },
    { days_ago: 7,  module: 'autoseo',          action_type: 'ranking_improved',   title: 'AutoSEO: 6 pages moved to page 1', description: 'Internal link updates + title tag refresh moved 6 product pages from positions 12–18 to positions 4–9.', estimated_value: 450 },
    { days_ago: 8,  module: 'agent_swarm',      action_type: 'swarm_completed',    title: 'ROAS drop alert → budget pause proposed', description: 'ROAS drop triggered swarm: media buyer agent identified weekend audience saturation. Pause proposal pushed to approval queue.', estimated_value: 390 },
    { days_ago: 9,  module: 'optimizer',        action_type: 'budget_rebalanced',  title: 'Weekend bid strategy switch: Target CPA → Maximise Conversions', description: 'Historical data shows CPA-bidding underperforms on Sat/Sun. Switched automatically. Est. +22% weekend conversion uplift.', estimated_value: 260 },
    { days_ago: 10, module: 'journey',          action_type: 'sequence_fired',     title: 'Cart abandonment sequence: 127 contacts', description: 'Journey Builder detected 127 abandoned carts >2h. Fired 2-email + 1 SMS sequence. 19 recovered (15% recovery rate).', estimated_value: 1140 },
    { days_ago: 12, module: 'self_healing',      action_type: 'ad_healed',          title: 'Healed Google Ads disapproved image', description: 'Image flagged for text overlay >20%. AI generated compliant copy restructure. Resubmitted within 8 min.', estimated_value: 95 },
    { days_ago: 14, module: 'optimizer',        action_type: 'campaign_scaled',    title: 'Scaled Meta Advantage+ campaign +60%', description: 'Signal-rich Advantage+ campaign sustaining 4.1× ROAS at scale. Increased budget from $800 to $1,280/day.', estimated_value: 890 },
    { days_ago: 18, module: 'budget_arbitrage', action_type: 'budget_shifted',     title: 'Shifted $2,100 to Meta during iOS signal recovery', description: 'Conversion API data showed Meta attribution recovering after iOS signal gap. Reallocated from Google Display.', estimated_value: 630 },
    { days_ago: 21, module: 'autoseo',          action_type: 'content_published',  title: 'Competitor content gap: 8 articles published', description: 'AutoSEO crawled top 3 competitors and found 8 ranking topics with no InfoGenie coverage. All 8 drafted + published.', estimated_value: 240 },
    { days_ago: 25, module: 'agent_swarm',      action_type: 'swarm_completed',    title: 'New competitor ad campaign detected → counter-brief', description: 'Swarm detected competitor new ad library entries. Spy + copywriter agents produced a counter-campaign brief in 6 min.', estimated_value: 300 },
    { days_ago: 28, module: 'journey',          action_type: 'sequence_fired',     title: 'Post-purchase upsell sequence: 89 customers', description: 'Journey triggered 72h post-purchase. 14 upsell conversions at avg $85 AOV = $1,190 recovered revenue.', estimated_value: 1190 },
  ];

  let seeded = 0;
  for (const s of seeds) {
    const ts = new Date(now.getTime() - s.days_ago * 86400000 - Math.random() * 28800000);
    await p.query(
      `INSERT INTO roi_actions(tenant_id, action_type, module, title, description, estimated_value, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [tid, s.action_type, s.module, s.title, s.description, s.estimated_value, ts]
    );
    seeded++;
  }
  res.json({ ok: true, seeded });
});

module.exports = router;
