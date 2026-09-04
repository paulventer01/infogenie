/**
 * Agent Orchestrator — generalizes the Calendar Assistant suggest/resolve/apply
 * pattern across modules (calendar, spine, content, audiences).
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const metaActivationCapabilitiesApi = require('./meta_activation_capabilities_api');
const googleAdsProviderDraftCapabilitiesApi = require('./google_ads_provider_draft_capabilities_api');
const metaPostActivationMonitoringApi = require('./meta_post_activation_monitoring_api');
const deliveryDiscrepanciesApi = require('./delivery_discrepancies_api');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const MODULES = [
  {
    id: 'calendar',
    label: 'Calendar Assistant',
    desc: 'Schedule, resolve conflicts, apply brand-calendar moves',
    view: 'calendar-assistant',
    endpoints: {
      context: '/api/calendar-assistant/agenda',
      suggest: '/api/calendar-assistant/suggest',
      resolve: '/api/calendar-assistant/resolve',
      apply: '/api/calendar-assistant/apply',
    },
  },
  {
    id: 'spine',
    label: 'Marketing Spine',
    desc: 'Audience + attribution health → close-loop actions',
    view: 'ecosystem-spine',
    endpoints: {
      context: '/api/marketing-spine/context',
      suggest: '/api/marketing-spine/suggest',
      resolve: '/api/marketing-spine/resolve',
      apply: '/api/marketing-spine/apply/:id',
    },
  },
  {
    id: 'decision',
    label: 'Decision Engine',
    desc: 'Strategic recommendations with act / dismiss',
    view: 'action-queue',
    endpoints: {
      context: '/api/decision-engine/recommendations',
      suggest: '/api/decision-engine/analyse',
      resolve: null,
      apply: '/api/decision-engine/act/:id',
    },
  },
  {
    id: 'optimizer',
    label: 'AI Optimizer',
    desc: 'Budget / creative / dayparting proposals',
    view: 'optimizer',
    endpoints: {
      context: '/api/optimizer/status',
      suggest: '/api/optimizer/run-now',
      resolve: null,
      apply: null,
    },
  },
  {
    id: 'remarketing',
    label: 'Remarketing Suite',
    desc: 'Pixel + audience health checklist',
    view: 'remarketing-suite',
    endpoints: {
      context: '/api/remarketing/status',
      suggest: null,
      resolve: null,
      apply: null,
    },
  },
];

router.use('/meta-activation-capabilities', metaActivationCapabilitiesApi);
router.use('/google-ads-provider-draft-capabilities', googleAdsProviderDraftCapabilitiesApi);
router.use('/meta-delivery-monitoring', metaPostActivationMonitoringApi);
router.use('/delivery-discrepancies', deliveryDiscrepanciesApi);

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[agent-orchestrator]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'agent_orchestrator_error' });
    }
  };
}

async function _persist(tid, module, kind, input, result) {
  if (!_db.hasDb() || tid == null) return null;
  const id = 'ao_' + crypto.randomBytes(6).toString('hex');
  try {
    await _db.getPool().query(
      `INSERT INTO agent_orchestrator_runs (id, tenant_id, module, kind, input, result)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tid, module, kind, JSON.stringify(input || {}), JSON.stringify(result || {})],
    );
  } catch (e) {
    console.warn('[agent-orchestrator] persist failed:', e.message);
  }
  return id;
}

function _module(id) {
  return MODULES.find((m) => m.id === id) || null;
}

router.get('/status', _route(async (_req, res) => {
  res.json({
    ok: true,
    modules: MODULES.map((m) => ({
      id: m.id,
      label: m.label,
      desc: m.desc,
      view: m.view,
      capabilities: {
        context: !!m.endpoints.context,
        suggest: !!m.endpoints.suggest,
        resolve: !!m.endpoints.resolve,
        apply: !!m.endpoints.apply,
      },
    })),
  });
}));

router.get('/modules', _route(async (_req, res) => {
  res.json({ ok: true, modules: MODULES });
}));

/**
 * Suggest across one or more modules — returns a unified proposal list.
 * For spine/calendar we invoke their engines directly when possible.
 */
router.post('/suggest', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent-orch:suggest' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const moduleIds = Array.isArray(req.body?.modules) && req.body.modules.length
    ? req.body.modules.map(String)
    : ['spine', 'calendar'];

  const proposals = [];

  if (moduleIds.includes('spine')) {
    const { suggestFromSources } = require('../marketing_spine/actions');
    const spine = await suggestFromSources(tid, {});
    for (const a of spine.inserted) {
      proposals.push({
        module: 'spine',
        actionId: a.id,
        title: a.title,
        action_type: a.action_type,
        priority: a.priority,
        canApply: true,
        applyPath: `/api/marketing-spine/apply/${a.id}`,
      });
    }
  }

  if (moduleIds.includes('calendar')) {
    // Surface conflicts as proposals to resolve
    try {
      const { buildAgenda, detectConflicts } = require('../calendar_assistant/agenda');
      const p = _db.getPool();
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 14 * 864e5).toISOString();
      const [brand, content] = await Promise.all([
        p.query(`SELECT * FROM brand_calendar_items WHERE tenant_id=$1 AND scheduled_at >= $2 AND scheduled_at <= $3 ORDER BY scheduled_at ASC LIMIT 200`, [tid, from, to]).catch(() => ({ rows: [] })),
        p.query(`SELECT id, brand, channels, posts, created_at FROM content_calendar_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]).catch(() => ({ rows: [] })),
      ]);
      const events = buildAgenda({ brandItems: brand.rows, contentRuns: content.rows, from, to });
      const report = detectConflicts(events);
      if (report.overlapCount > 0) {
        proposals.push({
          module: 'calendar',
          actionId: null,
          title: `Resolve ${report.overlapCount} calendar overlap(s)`,
          action_type: 'resolve_conflicts',
          priority: 'high',
          canApply: false,
          applyPath: null,
          hint: 'Open Calendar Assistant → Resolve conflicts',
          view: 'calendar-assistant',
        });
      }
    } catch (e) {
      console.warn('[agent-orchestrator] calendar suggest:', e.message);
    }
  }

  await _persist(tid, moduleIds.join('+'), 'suggest', { modules: moduleIds }, { count: proposals.length });
  res.json({ ok: true, proposals, count: proposals.length });
}));

router.post('/resolve', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent-orch:resolve' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const moduleId = String(req.body?.module || 'spine');
  const mod = _module(moduleId);
  if (!mod) return _err(res, 400, 'unknown_module');

  if (moduleId === 'spine') {
    const { resolvePlan } = require('../marketing_spine/actions');
    const plan = await resolvePlan(tid);
    await _persist(tid, moduleId, 'resolve', {}, plan);
    return res.json({ ok: true, module: moduleId, ...plan });
  }

  res.json({
    ok: true,
    module: moduleId,
    plan: [],
    summary: `${mod.label} resolve is handled in its native panel (${mod.view}).`,
    view: mod.view,
  });
}));

router.post('/apply', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent-orch:apply' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const moduleId = String(req.body?.module || 'spine');
  const actionId = String(req.body?.action_id || '').trim();

  if (moduleId === 'spine') {
    if (!actionId) return _err(res, 400, 'action_id required');
    const { applyAction } = require('../marketing_spine/actions');
    const out = await applyAction(tid, actionId);
    await _persist(tid, moduleId, 'apply', { actionId }, out);
    return res.json({ ok: true, module: moduleId, ...out });
  }

  if (moduleId === 'calendar') {
    // Proxy minimal create/move
    const newStart = String(req.body?.new_start || '').trim();
    const title = String(req.body?.title || '').trim();
    const eventId = String(req.body?.event_id || '').trim();
    if (!newStart) return _err(res, 400, 'new_start required');
    if (!_db.hasDb()) return _err(res, 503, 'database not configured');

    if (!eventId && title) {
      const id = 'bcal_' + crypto.randomBytes(5).toString('hex');
      await _db.getPool().query(
        `INSERT INTO brand_calendar_items (id,tenant_id,category,title,scheduled_at,notes,status)
         VALUES ($1,$2,$3,$4,$5,$6,'planned')`,
        [id, tid, req.body?.category || 'mine', title, newStart, 'Scheduled via Agent Orchestrator'],
      );
      await _persist(tid, 'calendar', 'apply', { title, newStart }, { id, action: 'created' });
      return res.json({ ok: true, module: 'calendar', action: 'created', id });
    }
    if (eventId) {
      const r = await _db.getPool().query(
        `UPDATE brand_calendar_items SET scheduled_at=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id, title, scheduled_at`,
        [newStart, eventId, tid],
      );
      if (!r.rows.length) return _err(res, 404, 'brand calendar item not found');
      await _persist(tid, 'calendar', 'apply', { eventId, newStart }, { action: 'moved', item: r.rows[0] });
      return res.json({ ok: true, module: 'calendar', action: 'moved', item: r.rows[0] });
    }
    return _err(res, 400, 'title+new_start or event_id+new_start required');
  }

  return _err(res, 400, `apply not supported for module ${moduleId} via orchestrator — use native panel`);
}));

router.get('/history', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent-orch:history' });
  if (!tid || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const r = await _db.getPool().query(
    `SELECT id, module, kind, input, result, created_at
     FROM agent_orchestrator_runs WHERE tenant_id=$1
     ORDER BY created_at DESC LIMIT 40`,
    [tid],
  );
  res.json({ ok: true, runs: r.rows });
}));

const workflowsApi = require('./workflows_api');
router.use('/workflows', workflowsApi);

const creditsApi = require('./credits_api');
router.use('/credits', creditsApi);

const researchApi = require('./research_api');
router.use('/research', researchApi);

const proposalApi = require('./proposal_api');
router.use('/proposals', proposalApi);

const generationApi = require('./generation_api');
router.use('/static-images', generationApi);

const videoApi = require('./video_api');
router.use('/video-jobs', videoApi);

const campaignApi = require('./campaign_api');
router.use('/campaign-drafts', campaignApi);

const reconciliationReviewApi = require('./reconciliation_review_api');
router.use('/reconciliation-reviews', reconciliationReviewApi);
const googleAdsReconciliationReviewApi = require('./google_ads_reconciliation_review_api');
router.use('/google-ads-reconciliation-reviews', googleAdsReconciliationReviewApi);

const optimizationRecommendationsApi = require('./optimization_recommendations_api');
router.use('/optimization-recommendations', optimizationRecommendationsApi);

module.exports = router;
