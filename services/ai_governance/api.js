/**
 * REST API for AI Governance Hub — Phase A (Policy + Status + Audit).
 */
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const {
  DEFAULT_ACTION_TIERS,
  ACTION_TIER_KEYS,
  PRESETS,
  defaultPolicy,
  applyPreset,
  _normalizeTiers,
} = require('./policy');
const { loadPolicy, govern } = require('./orchestrator');
const { newId } = require('./schema');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[ai-governance]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'ai_governance_error' });
    }
  };
}

router.get('/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ai-gov:status' });
  const policy = await loadPolicy(tid);
  let counts = { total: 0, allowed: 0, cautionish: 0, would_block: 0, degraded: 0, pending_review: 0 };

  if (_db.hasDb() && tid != null) {
    try {
      const r = await _db.getPool().query(
        `SELECT status,
                COALESCE(meta->>'gateVerdict','') AS gate,
                warnings
         FROM ai_governance_events
         WHERE tenant_id=$1 AND created_at > now() - interval '24 hours'`,
        [tid],
      );
      counts.total = r.rows.length;
      for (const row of r.rows) {
        if (row.status === 'allowed' || row.status === 'applied') counts.allowed += 1;
        if (row.status === 'governance_degraded') counts.degraded += 1;
        if (row.status === 'pending_review') counts.pending_review += 1;
        if (row.status === 'blocked') counts.would_block += 1;
        const warns = typeof row.warnings === 'string' ? JSON.parse(row.warnings) : (row.warnings || []);
        if (row.gate === 'caution' || (Array.isArray(warns) && warns.length)) counts.cautionish += 1;
        if (Array.isArray(warns) && warns.some((w) => String(w).includes('Would-have-blocked'))) {
          counts.would_block += 1;
        }
      }
    } catch (e) {
      console.warn('[ai-governance] status counts failed:', e.message);
    }
  }

  res.json({
    ok: true,
    mode: policy.default_mode,
    risk_appetite: policy.risk_appetite,
    nonRestrictive: {
      shadowDefault: true,
      failOpen: true,
      generateAuto: true,
      applyCalendarAuto: policy.action_tiers.apply_calendar === 'auto',
      blockOnCaution: !!policy.block_on_caution,
      requireContext: !!policy.require_context,
    },
    layers: {
      policy: { ready: true, mode: policy.default_mode, appetite: policy.risk_appetite },
      data: { ready: false, note: 'Phase B' },
      context: { ready: true, note: 'Phase C — buildContextPack on chatForCategory + Ask InfoGenie' },
      efficiency: (() => {
        try {
          return require('../ai/efficient_cascade').cascadeStatus();
        } catch (_) {
          return { ready: false, note: 'cascade module unavailable' };
        }
      })(),
      vector: (() => {
        try {
          return { ready: true, note: 'pgvector when available; JSONB cosine fallback — see /api/knowledge-graph/health' };
        } catch (_) {
          return { ready: false };
        }
      })(),
      observability: { ready: true, note: 'AI call traces at /api/ai-traces — latency, tier, est. cost' },
      feedback: { ready: true, note: 'AI output ratings at /api/ai-feedback — dislike → memory + escalate candidates' },
      output: { ready: true, note: 'Phase A light scan; full gate in Phase D' },
    },
    last24h: counts,
    presets: Object.values(PRESETS).map((p) => ({ id: p.id, label: p.label })),
    banner: policy.default_mode === 'shadow'
      ? 'Shadow mode — nothing is blocked. Actions proceed; we log warnings for audit.'
      : 'Enforce mode (tenant opt-in) — suggest/block tiers can delay or stop actions.',
  });
}));

router.get('/policy', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ai-gov:policy' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const policy = await loadPolicy(tid);
  res.json({
    ok: true,
    policy,
    defaults: defaultPolicy(tid),
    actionTier: ACTION_TIER_KEYS,
    presets: PRESETS,
  });
}));

router.put('/policy', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ai-gov:policy-put' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database_unavailable');

  const body = req.body || {};
  let patch = {};

  if (body.preset && PRESETS[body.preset]) {
    patch = { ...applyPreset(body.preset) };
  }

  if (body.risk_appetite === 'aggressive' || body.risk_appetite === 'balanced' || body.risk_appetite === 'conservative') {
    patch.risk_appetite = body.risk_appetite;
  }
  if (body.default_mode === 'shadow' || body.default_mode === 'enforce') {
    patch.default_mode = body.default_mode;
  }
  if (typeof body.block_on_caution === 'boolean') patch.block_on_caution = body.block_on_caution;
  if (typeof body.require_context === 'boolean') patch.require_context = body.require_context;
  if (typeof body.policy_document === 'string') patch.policy_document = body.policy_document.slice(0, 50000);
  if (typeof body.ethics_contact === 'string') patch.ethics_contact = body.ethics_contact.slice(0, 200);
  if (body.action_tiers && typeof body.action_tiers === 'object') {
    patch.action_tiers = _normalizeTiers({
      ...DEFAULT_ACTION_TIERS,
      ...(patch.action_tiers || {}),
      ...body.action_tiers,
    });
  }

  // Never silently leave generate_* / apply_calendar as block unless explicitly set —
  // still allow tenant choice, but log when they tighten.
  const current = await loadPolicy(tid);
  const next = {
    default_mode: patch.default_mode || current.default_mode || 'shadow',
    risk_appetite: patch.risk_appetite || current.risk_appetite || 'aggressive',
    action_tiers: patch.action_tiers || current.action_tiers,
    block_on_caution: typeof patch.block_on_caution === 'boolean' ? patch.block_on_caution : !!current.block_on_caution,
    require_context: typeof patch.require_context === 'boolean' ? patch.require_context : !!current.require_context,
    policy_document: patch.policy_document !== undefined ? patch.policy_document : (current.policy_document || ''),
    ethics_contact: patch.ethics_contact !== undefined ? patch.ethics_contact : current.ethics_contact,
  };

  const id = current.id || newId('agp');
  const version = (current.policy_version || 1) + (current.id ? 1 : 0);
  const p = _db.getPool();

  await p.query(
    `INSERT INTO ai_governance_policies
      (id, tenant_id, default_mode, risk_appetite, action_tiers, block_on_caution,
       require_context, policy_document, policy_version, ethics_contact, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       default_mode = EXCLUDED.default_mode,
       risk_appetite = EXCLUDED.risk_appetite,
       action_tiers = EXCLUDED.action_tiers,
       block_on_caution = EXCLUDED.block_on_caution,
       require_context = EXCLUDED.require_context,
       policy_document = EXCLUDED.policy_document,
       policy_version = ai_governance_policies.policy_version + 1,
       ethics_contact = EXCLUDED.ethics_contact,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      id,
      tid,
      next.default_mode,
      next.risk_appetite,
      JSON.stringify(next.action_tiers),
      next.block_on_caution,
      next.require_context,
      next.policy_document,
      version,
      next.ethics_contact,
      req.user?.id || null,
    ],
  );

  const saved = await loadPolicy(tid);
  res.json({ ok: true, policy: saved, enforceEnabled: saved.default_mode === 'enforce' });
}));

router.get('/audit', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ai-gov:audit' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, events: [], total: 0 });

  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const status = req.query.status ? String(req.query.status) : null;
  const params = [tid];
  let where = 'tenant_id=$1';
  if (status) {
    params.push(status);
    where += ` AND status=$${params.length}`;
  }
  params.push(limit);
  const r = await _db.getPool().query(
    `SELECT id, surface, action, execution_tier, status, output_preview, block_reason,
            warnings, meta, created_at, resolved_at, resolved_by, user_id
     FROM ai_governance_events
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json({ ok: true, events: r.rows, total: r.rows.length });
}));

router.post('/review/:eventId', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ai-gov:review' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database_unavailable');

  const decision = String(req.body?.decision || '').toLowerCase();
  if (decision !== 'approve' && decision !== 'reject') return _err(res, 400, 'bad_decision');

  const eventId = String(req.params.eventId);
  const p = _db.getPool();
  const cur = await p.query(
    `SELECT * FROM ai_governance_events WHERE id=$1 AND tenant_id=$2`,
    [eventId, tid],
  );
  if (!cur.rows[0]) return _err(res, 404, 'event_not_found');
  if (cur.rows[0].status !== 'pending_review') {
    return _err(res, 400, 'not_pending_review');
  }

  const newStatus = decision === 'approve' ? 'allowed' : 'blocked';
  await p.query(
    `UPDATE ai_governance_events
     SET status=$1, resolved_at=now(), resolved_by=$2,
         meta = COALESCE(meta,'{}'::jsonb) || $3::jsonb
     WHERE id=$4 AND tenant_id=$5`,
    [
      newStatus,
      req.user?.id || null,
      JSON.stringify({ review: decision, note: req.body?.note || null }),
      eventId,
      tid,
    ],
  );
  res.json({ ok: true, status: newStatus, proceeded: decision === 'approve' });
}));

/** Dev/demo: run a govern() dry call so the audit log isn't empty */
router.post('/demo-event', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ai-gov:demo' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const result = await govern({
    tenantId: tid,
    userId: req.user?.id || null,
    surface: req.body?.surface || 'marketing_spine',
    action: req.body?.action || 'apply',
    payload: {
      title: req.body?.title || 'Demo spine apply',
      preview: 'Demo governance event (shadow — always proceeds)',
      __force_brand_safety_block: !!req.body?.forceBlock,
    },
  });
  res.json({ ok: true, result });
}));

/** Preview a context pack for the current tenant (M1 debugging / Hub Context tab) */
router.post('/context-pack', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ai-gov:context-pack' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { buildContextPack } = require('./context_pack');
  const pack = await buildContextPack({
    tenantId: tid,
    userId: req.user?.id || null,
    question: String(req.body?.question || '').slice(0, 2000),
    surface: String(req.body?.surface || 'preview'),
    requireContext: !!req.body?.require_context,
    limit: Number(req.body?.limit) || 6,
  });
  res.json({ ok: true, pack });
}));

module.exports = router;
