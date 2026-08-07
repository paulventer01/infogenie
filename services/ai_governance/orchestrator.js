/**
 * AI Governance orchestrator — fail-open, shadow-first.
 * In shadow mode (default) govern() never delays or denies execution.
 */

const _db = require('../../db');
const {
  FAIL_OPEN,
  defaultPolicy,
  _normalizeTiers,
  resolveTier,
} = require('./policy');
const outputGate = require('./output_gate');
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
    return {
      ...base,
      id: row.id,
      tenant_id: row.tenant_id,
      default_mode: row.default_mode === 'enforce' ? 'enforce' : 'shadow',
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

/**
 * @param {object} opts
 * @param {number|null} opts.tenantId
 * @param {number|null} [opts.userId]
 * @param {string} opts.surface
 * @param {string} opts.action
 * @param {object} [opts.payload]
 * @param {object} [opts.outputChecks] — optional precomputed gate result
 * @returns {Promise<{allowed:boolean,proceeded:boolean,warnings:string[],executionTier:string,status:string,auditId:string,mode:string,degraded?:boolean,softCue?:boolean,contextPack:null,outputChecks:object}>}
 */
async function govern(opts = {}) {
  const tenantId = opts.tenantId ?? null;
  const userId = opts.userId ?? null;
  const surface = String(opts.surface || 'unknown');
  const action = String(opts.action || 'generate');
  const payload = opts.payload || {};
  const auditId = newId('age');

  try {
    const policy = await loadPolicy(tenantId);
    const mode = policy.default_mode === 'enforce' ? 'enforce' : 'shadow';
    const { key: tierKey, tier } = resolveTier(policy, surface, action);
    const gate = opts.outputChecks || outputGate.scanOutput(payload);
    const warnings = [...(gate.warnings || [])];

    // H5: thin context → enrich/warn, never refuse under defaults
    if (policy.require_context && !payload?.contextPack && !payload?.hasContext) {
      warnings.push('Context thin — proceeding with available inputs (ungrounded)');
    }

    let status = 'allowed';
    let allowed = true;
    let proceeded = true;
    let blockReason = null;
    let softCue = false;

    // H9: suggest under shadow = soft cue; action still proceeds
    if (tier === 'suggest') {
      softCue = true;
      warnings.push('Worth a glance — launch/budget (or suggest-tier) action logged');
      if (mode === 'enforce') {
        status = 'pending_review';
        allowed = false;
        proceeded = false;
        blockReason = 'suggest_tier_requires_approval';
      }
    }

    // H7: block tier rare — only stops in enforce
    if (tier === 'block') {
      if (mode === 'enforce') {
        status = 'blocked';
        allowed = false;
        proceeded = false;
        blockReason = 'action_tier_block';
      } else {
        warnings.push('Would block under enforce (shadow — proceeding)');
        status = 'allowed';
      }
    }

    // Output gate: H3 caution ≠ block; block verdict only stops in enforce
    if (gate.verdict === 'caution') {
      warnings.push('Output caution logged');
      if (mode === 'enforce' && policy.block_on_caution) {
        status = 'blocked';
        allowed = false;
        proceeded = false;
        blockReason = 'block_on_caution';
      }
    }
    if (gate.verdict === 'block') {
      if (mode === 'enforce') {
        status = 'blocked';
        allowed = false;
        proceeded = false;
        blockReason = blockReason || 'output_gate_block';
      } else {
        // H1/H8: shadow never stops
        warnings.push('Would-have-blocked (shadow) — proceeding');
        status = 'allowed';
        allowed = true;
        proceeded = true;
      }
    }

    // Shadow hard override — never delay/deny (H1, H8, H9)
    if (mode === 'shadow') {
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
        mode,
        risk_appetite: policy.risk_appetite,
        gateVerdict: gate.verdict,
        softCue,
      },
    });
    await _persistChecks(tenantId, auditId, gate.checks || []);

    return {
      allowed,
      proceeded,
      warnings,
      executionTier: tier,
      tierKey,
      status,
      auditId,
      mode,
      softCue,
      contextPack: payload?.contextPack || null,
      outputChecks: gate,
      blockReason,
    };
  } catch (e) {
    // H6: fail open
    console.warn('[ai-governance] govern degraded:', e.message || e);
    const degradedId = auditId;
    try {
      await _persistEvent({
        id: degradedId,
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

    return {
      allowed: true,
      proceeded: true,
      warnings: ['governance_degraded'],
      executionTier: 'auto',
      tierKey: 'generate_content',
      status: 'governance_degraded',
      auditId: degradedId,
      mode: 'shadow',
      softCue: false,
      degraded: true,
      contextPack: null,
      outputChecks: { verdict: 'pass', warnings: [], checks: [] },
      blockReason: null,
    };
  }
}

module.exports = { govern, loadPolicy };
