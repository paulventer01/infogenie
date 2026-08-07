// Lead Intelligence API — unified leads, classification, review queue, search terms, transparency.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { parseAttribution } = require('./attribution');
const { classifyLead } = require('./classifier');
const { syncSearchTerms, suggestNegativeKeywords } = require('./search_terms');
const { ingestLead } = require('./ingest');

const router = express.Router();

function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[lead-intelligence]', e.message || e);
      res.json({ ok: false, error: e.message || 'lead_intelligence_error' });
    }
  };
}

async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

async function _enqueueReview(pool, tenantId, { item_type, item_id, title, summary, priority, meta }) {
  await pool.query(`
    INSERT INTO lead_intel_review_queue (tenant_id, item_type, item_id, title, summary, priority, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [tenantId, item_type, item_id || null, title, summary || null, priority || 'normal', meta ? JSON.stringify(meta) : null]);
}

// ── Overview stats ───────────────────────────────────────────────────────────
router.get('/stats', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'lead-intel:stats');
  const pool = _db.getPool();
  const [leads, review, terms, negatives] = await Promise.all([
    pool.query(`SELECT tier, COUNT(*)::int n FROM lead_intel_leads WHERE tenant_id=$1 AND created_at > now() - interval '30 days' GROUP BY tier`, [tid]),
    pool.query(`SELECT COUNT(*)::int n FROM lead_intel_review_queue WHERE tenant_id=$1 AND status='open'`, [tid]),
    pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(cost),0)::float spend FROM lead_intel_search_terms WHERE tenant_id=$1`, [tid]),
    pool.query(`SELECT COUNT(*)::int n FROM lead_intel_negative_suggestions WHERE tenant_id=$1 AND status='suggested'`, [tid]),
  ]);
  const byTier = {};
  for (const r of leads.rows) byTier[r.tier || 'unknown'] = r.n;
  res.json({
    ok: true,
    leads30d: byTier,
    openReviews: review.rows[0]?.n || 0,
    searchTerms: terms.rows[0]?.n || 0,
    searchSpend: terms.rows[0]?.spend || 0,
    negativeSuggestions: negatives.rows[0]?.n || 0,
  });
}));

// ── Leads list ───────────────────────────────────────────────────────────────
router.get('/leads', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, leads: [] });
  const tid = await _tid(req, 'lead-intel:leads:list');
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const tier = req.query.tier ? String(req.query.tier) : null;
  const params = [tid, limit];
  let where = 'WHERE tenant_id=$1';
  if (tier) { params.splice(1, 0, tier); where += ` AND tier=$2`; params[params.length - 1] = limit; }
  const r = await _db.getPool().query(`
    SELECT id, channel, contact_name, contact_email, contact_phone, message, platform,
           utm_campaign, utm_term, tier, score, reasoning, review_status, created_at, classified_at
    FROM lead_intel_leads ${where}
    ORDER BY created_at DESC LIMIT $${params.length}
  `, tier ? [tid, tier, limit] : [tid, limit]);
  res.json({ ok: true, leads: r.rows });
}));

// ── Ingest + auto-classify ───────────────────────────────────────────────────
router.post('/ingest', express.json(), _route(async (req, res) => {
  const tid = await _tid(req, 'lead-intel:ingest');
  const result = await ingestLead(tid, req.body || {});
  res.json(result);
}));

// ── Re-classify existing lead ────────────────────────────────────────────────
router.post('/classify/:id', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'lead-intel:classify');
  const id = parseInt(req.params.id, 10);
  const pool = _db.getPool();
  const r = await pool.query(`SELECT * FROM lead_intel_leads WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const cls = await classifyLead(r.rows[0], tid);
  await pool.query(`
    UPDATE lead_intel_leads SET score=$2, tier=$3, classification=$3, reasoning=$4,
      signals=$5, suggested_actions=$6, classifier_model=$7, classified_at=now(), updated_at=now()
    WHERE id=$1
  `, [id, cls.score, cls.tier, cls.reasoning, JSON.stringify(cls.signals), JSON.stringify(cls.suggestedActions), cls.model]);
  res.json({ ok: true, classification: cls });
}));

// ── Specialist review queue ──────────────────────────────────────────────────
router.get('/review-queue', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tid(req, 'lead-intel:review:list');
  const status = req.query.status ? String(req.query.status) : 'open';
  const r = await _db.getPool().query(`
    SELECT * FROM lead_intel_review_queue
    WHERE tenant_id=$1 AND status=$2
    ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 100
  `, [tid, status]);
  res.json({ ok: true, items: r.rows });
}));

router.patch('/review-queue/:id', express.json(), _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'lead-intel:review:patch');
  const id = parseInt(req.params.id, 10);
  const { status, resolution, assignee } = req.body || {};
  const r = await _db.getPool().query(`
    UPDATE lead_intel_review_queue SET
      status=COALESCE($3, status),
      resolution=COALESCE($4, resolution),
      assignee=COALESCE($5, assignee),
      resolved_at=CASE WHEN COALESCE($3, status) IN ('resolved','dismissed') THEN now() ELSE resolved_at END
    WHERE id=$1 AND tenant_id=$2 RETURNING *
  `, [id, tid, status || null, resolution || null, assignee || null]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, item: r.rows[0] });
}));

// ── Search terms + negatives ─────────────────────────────────────────────────
router.get('/search-terms', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, terms: [] });
  const tid = await _tid(req, 'lead-intel:search-terms');
  const r = await _db.getPool().query(`
    SELECT * FROM lead_intel_search_terms WHERE tenant_id=$1 ORDER BY cost DESC LIMIT 100
  `, [tid]);
  res.json({ ok: true, terms: r.rows });
}));

router.post('/search-terms/sync', _route(async (req, res) => {
  const tid = await _tid(req, 'lead-intel:search-sync');
  const uid = req.user?.id || null;
  const days = parseInt(req.body?.windowDays || '30', 10);
  const result = await syncSearchTerms(tid, uid, days);
  res.json(result);
}));

router.get('/negative-keywords', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tid(req, 'lead-intel:negatives');
  const r = await _db.getPool().query(`
    SELECT * FROM lead_intel_negative_suggestions WHERE tenant_id=$1 ORDER BY estimated_waste DESC NULLS LAST LIMIT 100
  `, [tid]);
  res.json({ ok: true, items: r.rows });
}));

router.post('/negative-keywords/suggest', _route(async (req, res) => {
  const tid = await _tid(req, 'lead-intel:neg-suggest');
  const uid = req.user?.id || null;
  const result = await suggestNegativeKeywords(tid, uid);
  res.json(result);
}));

router.patch('/negative-keywords/:id', express.json(), _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'lead-intel:neg-patch');
  const id = parseInt(req.params.id, 10);
  const status = String(req.body?.status || 'approved').slice(0, 32);
  const r = await _db.getPool().query(`
    UPDATE lead_intel_negative_suggestions SET status=$3 WHERE id=$1 AND tenant_id=$2 RETURNING *
  `, [id, tid, status]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, item: r.rows[0] });
}));

// ── Client transparency report ───────────────────────────────────────────────
router.get('/transparency-report', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'lead-intel:transparency');
  const pool = _db.getPool();
  const days = Math.min(parseInt(req.query.days || '7', 10), 90);

  const [leads, byCampaign, optimizerActions, negatives, reviews] = await Promise.all([
    pool.query(`
      SELECT tier, COUNT(*)::int n FROM lead_intel_leads
      WHERE tenant_id=$1 AND created_at > now() - ($2 || ' days')::interval
      GROUP BY tier
    `, [tid, days]),
    pool.query(`
      SELECT utm_campaign, platform, tier, COUNT(*)::int n
      FROM lead_intel_leads
      WHERE tenant_id=$1 AND created_at > now() - ($2 || ' days')::interval AND utm_campaign IS NOT NULL
      GROUP BY utm_campaign, platform, tier ORDER BY n DESC LIMIT 30
    `, [tid, days]),
    pool.query(`
      SELECT a.action_type, a.reason, a.applied, a.created_at, c.name AS campaign_name, c.platform
      FROM optimizer_actions a
      LEFT JOIN ad_campaigns c ON c.id = a.campaign_id
      WHERE a.tenant_id=$1 AND a.created_at > now() - ($2 || ' days')::interval
      ORDER BY a.created_at DESC LIMIT 50
    `, [tid, days]),
    pool.query(`
      SELECT keyword, reason, estimated_waste, status FROM lead_intel_negative_suggestions
      WHERE tenant_id=$1 AND status IN ('suggested','approved') ORDER BY estimated_waste DESC LIMIT 20
    `, [tid]),
    pool.query(`
      SELECT COUNT(*)::int resolved FROM lead_intel_review_queue
      WHERE tenant_id=$1 AND status='resolved' AND resolved_at > now() - ($2 || ' days')::interval
    `, [tid, days]),
  ]);

  const leadSummary = {};
  let totalLeads = 0;
  for (const r of leads.rows) {
    leadSummary[r.tier] = r.n;
    totalLeads += r.n;
  }

  res.json({
    ok: true,
    periodDays: days,
    generatedAt: new Date().toISOString(),
    leadQuality: { total: totalLeads, byTier: leadSummary },
    leadsByCampaign: byCampaign.rows,
    optimizerChanges: optimizerActions.rows,
    negativeKeywordSuggestions: negatives.rows,
    specialistReviewsResolved: reviews.rows[0]?.resolved || 0,
    narrative: totalLeads > 0
      ? `Last ${days} days: ${totalLeads} inbound leads classified. ${leadSummary.sales_opportunity || 0} sales opportunities, ${leadSummary.junk || 0} junk filtered. ${optimizerActions.rows.length} optimizer decisions logged.`
      : `Last ${days} days: no inbound leads yet. Connect forms, WhatsApp, or voice to start classifying.`,
  });
}));

// ── Sync optimizer weekly review item ────────────────────────────────────────
router.post('/sync-optimizer-review', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'lead-intel:opt-review');
  const pool = _db.getPool();
  const r = await pool.query(`
    SELECT COUNT(*)::int n FROM optimizer_actions
    WHERE tenant_id=$1 AND created_at > now() - interval '7 days'
  `, [tid]);
  const n = r.rows[0]?.n || 0;
  if (n > 0) {
    await _enqueueReview(pool, tid, {
      item_type: 'optimizer_weekly',
      title: `Weekly optimizer review — ${n} decision(s)`,
      summary: 'Review AI campaign changes (pauses, budget shifts) before sharing with client.',
      priority: 'normal',
      meta: { actionCount: n },
    });
  }
  res.json({ ok: true, queued: n > 0, actionCount: n });
}));

module.exports = router;
