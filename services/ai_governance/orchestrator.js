/**
 * AI Governance orchestrator — PR10H.1 content safety enforces by default;
 * action-tier shadow-first behaviour preserved for publish/send/launch paths.
 */

const _db = require('../../db');
const {
  FAIL_OPEN,
  defaultPolicy,
  _normalizeTiers,
  _normalizeContentSafetyMode,
  resolveTier,
} = require('./policy');
const outputGate = require('./output_gate');
const { isContentGeneration } = require('./brand_rules');
const { newId } = require('./schema');

async function loadPolicy(tenantId) {
  const base = defaultPolicy(tenantId);
  if (!_db.hasDb() || tenantId == null) return base;
  try {
    const r = await _db.getPool().query(
      `SELECT * FROM ai_governance_policies WHERE tenant_id=$1 LIMIT 1`,
      [tenantId],
    );
    if (!r.rows[0]) return base;
    const row = r.rows[0];
    const tiers = typeof row.action_tiers === 'string'
      ? JSON.parse(row.action_tiers)
      : (row.action_tiers || {});
    const contentSafetyMode = _normalizeContentSafetyMode(
      row.content_safety_mode,
      !!row.content_safety_explicit,
      row.default_mode,
    );
    return {
      ...base,
      id: row.id,
      tenant_id: row.tenant_id,
      default_mode: row.default_mode === 'enforce' ? 'enforce' : 'shadow',
      content_safety_mode: contentSafetyMode,
      content_safety_explicit: !!row.content_safety_explicit,
      risk_appetite: row.risk_appetite || base.risk_appetite,
      action_tiers: _normalizeTiers(tiers),
      block_on_caution: !!row.block_on_caution,
      require_context: !!row.require_context,
      policy_document: row.policy_document || '',
      policy_version: row.policy_version || 1,
      ethics_contact: row.ethics_contact || null,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    };
  } catch (e) {
    console.warn('[ai-governance] loadPolicy failed:', e.message);
    return base;
  }
}

async function _persistEvent(row) {
  if (!_db.hasDb() || row.tenant_id == null) return row.id;
  try {
    await _db.getPool().query(
      `INSERT INTO ai_governance_events
        (id, tenant_id, user_id, surface, action, execution_tier, status,
         context_pack_id, input_hash, output_preview, block_reason, warnings, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.id,
        row.tenant_id,
        row.user_id || null,
        row.surface,
        row.action,
        row.execution_tier,
        row.status,
        row.context_pack_id || null,
        row.input_hash || null,
        row.output_preview || null,
        row.block_reason || null,
        JSON.stringify(row.warnings || []),
        JSON.stringify(row.meta || {}),
      ],
    );
  } catch (e) {
    console.warn('[ai-governance] persist event failed:', e.message);
  }
  return row.id;
}

async function _persistChecks(tenantId, eventId, checks) {
  if (!_db.hasDb() || tenantId == null || !checks?.length) return;
  const p = _db.getPool();
  for (const c of checks) {
    try {
      await p.query(
        `INSERT INTO ai_governance_output_checks
          (id, tenant_id, governance_event_id, check_type, verdict, risk_score, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          newId('agc'),
          tenantId,
          eventId,
          c.check_type,
          c.verdict,
          c.risk_score ?? null,
          JSON.stringify(c.detail || {}),
        ],
      );
    } catch (e) {
      console.warn('[ai-governance] persist check failed:', e.message);
    }
  }
}

function _failClosedResponse(opts, auditId, gate, reason) {
  const userMessage = gate?.userMessage
    || outputGate.USER_MESSAGES.unavailable;
  return {
    allowed: false,
    proceeded: false,
    warnings: gate?.warnings?.length ? gate.warnings : [userMessage],
    executionTier: 'auto',
    tierKey: 'generate_content',
    status: 'blocked',
    auditId,
    mode: 'enforce',
    contentSafetyMode: 'enforce',
    softCue: false,
    degraded: true,
    failClosed: true,
    contextPack: null,
    outputChecks: gate || { verdict: 'unavailable', warnings: [userMessage], checks: [] },
    blockReason: reason || 'content_safety_unavailable',
    userMessage,
  };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.failClosed] — content generation: block on orchestrator/gate errors
 */
async function govern(opts = {}) {
  const tenantId = opts.tenantId ?? null;
  const userId = opts.userId ?? null;
  const surface = String(opts.surface || 'unknown');
  const action = String(opts.action || 'generate');
  const payload = opts.payload || {};
  const auditId = newId('age');
  const contentAction = isContentGeneration(surface, action);
  const failClosed = !!opts.failClosed || contentAction;

  try {
    const policy = await module.exports.loadPolicy(tenantId);
    const actionMode = policy.default_mode === 'enforce' ? 'enforce' : 'shadow';
    const contentMode = policy.content_safety_mode === 'warning_only'
      ? 'warning_only'
      : 'enforce';
    const { key: tierKey, tier } = resolveTier(policy, surface, action);
    const gate = opts.outputChecks || outputGate.scanOutput(payload);
    const warnings = [...(gate.warnings || [])];

    if (policy.require_context && !payload?.contextPack && !payload?.hasContext) {
      warnings.push('Context thin — proceeding with available inputs (ungrounded)');
    }

    let status = 'allowed';
    let allowed = true;
    let proceeded = true;
    let blockReason = null;
    let softCue = false;
    let contentBlocked = false;

    // Gate unavailable → fail closed for content generation
    if (contentAction && gate.verdict === 'unavailable' && contentMode === 'enforce') {
      status = 'blocked';
      allowed = false;
      proceeded = false;
      blockReason = 'content_safety_unavailable';
      contentBlocked = true;
    }

    // Content safety enforcement (independent of action-tier shadow mode)
    if (contentAction && gate.verdict === 'block' && contentMode === 'enforce') {
      status = 'blocked';
      allowed = false;
      proceeded = false;
      blockReason = blockReason || 'content_safety_block';
      contentBlocked = true;
    } else if (contentAction && gate.verdict === 'block' && contentMode === 'warning_only') {
      warnings.push('Content safety issue logged — warning-only mode (output returned with warnings)');
      status = 'allowed';
    } else if (contentAction && gate.verdict === 'caution' && contentMode === 'warning_only') {
      warnings.push('Content caution — warning-only mode');
    }

    // Action-tier governance (publish/send/launch) — unchanged
    if (tier === 'suggest') {
      softCue = true;
      warnings.push('Worth a glance — launch/budget (or suggest-tier) action logged');
      if (actionMode === 'enforce' && !contentBlocked) {
        status = 'pending_review';
        allowed = false;
        proceeded = false;
        blockReason = 'suggest_tier_requires_approval';
      }
    }

    if (tier === 'block' && !contentBlocked) {
      if (actionMode === 'enforce') {
        status = 'blocked';
        allowed = false;
        proceeded = false;
        blockReason = 'action_tier_block';
      } else {
        warnings.push('Would block under enforce (shadow — proceeding)');
        status = 'allowed';
      }
    }

    if (gate.verdict === 'caution' && !contentBlocked) {
      if (actionMode === 'enforce' && policy.block_on_caution) {
        status = 'blocked';
        allowed = false;
        proceeded = false;
        blockReason = 'block_on_caution';
      }
    }

    // Legacy output gate block for non-content actions under action enforce mode
    if (!contentAction && gate.verdict === 'block') {
      if (actionMode === 'enforce') {
        status = 'blocked';
        allowed = false;
        proceeded = false;
        blockReason = blockReason || 'output_gate_block';
      } else {
        warnings.push('Would-have-blocked (shadow) — proceeding');
      }
    }

    // Shadow override for action tiers only — never undo content safety blocks
    if (actionMode === 'shadow' && !contentBlocked) {
      allowed = true;
      proceeded = true;
      if (status === 'pending_review' || status === 'blocked') status = 'allowed';
      blockReason = null;
    }

    const preview = String(
      payload?.preview || payload?.title || payload?.draft || payload?.text || '',
    ).slice(0, 280);

    await _persistEvent({
      id: auditId,
      tenant_id: tenantId,
      user_id: userId,
      surface,
      action,
      execution_tier: tier,
      status,
      output_preview: preview || null,
      block_reason: blockReason,
      warnings,
      meta: {
        tierKey,
        actionMode,
        contentSafetyMode: contentMode,
        risk_appetite: policy.risk_appetite,
        gateVerdict: gate.verdict,
        softCue,
        contentAction,
      },
    });
    await _persistChecks(tenantId, auditId, gate.checks || []);

    const result = {
      allowed,
      proceeded,
      warnings,
      executionTier: tier,
      tierKey,
      status,
      auditId,
      mode: actionMode,
      contentSafetyMode: contentMode,
      softCue,
      contextPack: payload?.contextPack || null,
      outputChecks: gate,
      blockReason,
      userMessage: !proceeded ? (gate.userMessage || outputGate.USER_MESSAGES.blocked) : null,
    };

    if (contentBlocked && contentMode === 'warning_only') {
      result.content_safety_warnings = warnings;
    }

    return result;
  } catch (e) {
    console.warn('[ai-governance] govern degraded:', e.message || e);
    const gate = { verdict: 'unavailable', warnings: [outputGate.USER_MESSAGES.unavailable], checks: [] };

    if (failClosed) {
      try {
        await _persistEvent({
          id: auditId,
          tenant_id: tenantId,
          user_id: userId,
          surface,
          action,
          execution_tier: 'auto',
          status: 'blocked',
          block_reason: 'content_safety_unavailable',
          warnings: [outputGate.USER_MESSAGES.unavailable],
          meta: { error: String(e.message || e), fail_closed: true },
        });
      } catch (_) { /* ignore */ }
      return _failClosedResponse(opts, auditId, gate, 'content_safety_unavailable');
    }

    try {
      await _persistEvent({
        id: auditId,
        tenant_id: tenantId,
        user_id: userId,
        surface,
        action,
        execution_tier: 'auto',
        status: 'governance_degraded',
        block_reason: null,
        warnings: ['governance_degraded'],
        meta: { error: String(e.message || e), fail_open: FAIL_OPEN },
      });
    } catch (_) { /* ignore */ }

    const degradedId = auditId;
    return {
      allowed: true,
      proceeded: true,
      warnings: ['governance_degraded'],
      executionTier: 'auto',
      tierKey: 'generate_content',
      status: 'governance_degraded',
      auditId: degradedId,
      mode: 'shadow',
      contentSafetyMode: 'enforce',
      softCue: false,
      degraded: true,
      contextPack: null,
      outputChecks: { verdict: 'pass', warnings: [], checks: [] },
      blockReason: null,
    };
  }
}

module.exports = { govern, loadPolicy, isContentGeneration };
