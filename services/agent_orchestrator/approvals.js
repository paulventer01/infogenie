'use strict';

const { fail } = require('./errors');
const { sha256Hex } = require('./hash');
const { GATES, GATE_FOR_WAIT } = require('./states');

const ALLOWED_PLATFORMS = Object.freeze(['meta', 'google', 'tiktok']);
// Anything an approver is deciding ON. Editing one of these after a gate was
// approved invalidates that approval — `currency` and the targeting lists are in
// here because "1000 USD to US SMBs" and "1000 JPY to a different market" are
// not the same authorisation, and `edit` is a weaker grant than `approve.*`.
const MATERIAL_FIELDS = Object.freeze([
  'selected_platforms',
  'advertising_budget',
  'currency',
  'target_markets',
  'target_audiences',
  'landing_page_url',
  'offer',
  'objective',
  'product_or_service',
]);
const SET_FIELDS = Object.freeze(['selected_platforms', 'target_markets', 'target_audiences']);

function asNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asPlatforms(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').toLowerCase().trim()).filter(Boolean);
}

// Order-insensitive list of strings for hashing/comparison. Case is preserved —
// 'US' and 'us' are not asserted to be the same market.
function asStrList(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x == null ? '' : x).trim()).filter(Boolean).sort();
}

function isSubset(inner, outer) {
  const o = new Set(outer);
  return inner.every((x) => o.has(x));
}

function platformsAllowlisted(platforms) {
  return platforms.length > 0 && platforms.every((p) => ALLOWED_PLATFORMS.includes(p));
}

function approvalSnapshot(workflow, gate) {
  return {
    gate: String(gate || ''),
    object_type: 'workflow',
    object_id: String(workflow.id),
    object_version: Number(workflow.version) || 1,
    selected_platforms: asPlatforms(workflow.selected_platforms).slice().sort(),
    advertising_budget: asNumber(workflow.advertising_budget),
    currency: String(workflow.currency || 'USD').toUpperCase(),
    target_markets: asStrList(workflow.target_markets),
    target_audiences: asStrList(workflow.target_audiences),
    landing_page_url: String(workflow.landing_page_url || ''),
    offer: String(workflow.offer || ''),
    objective: String(workflow.objective || ''),
    product_or_service: String(workflow.product_or_service || ''),
  };
}

function contentHash(workflow, gate) {
  return sha256Hex(approvalSnapshot(workflow, gate));
}

function validateApproveScope(workflow, { platforms, advertising_budget, credit_ceiling, gate }) {
  if (!GATES.includes(gate)) fail('validation_failed');
  const selected = asPlatforms(workflow.selected_platforms);
  const approved = asPlatforms(platforms);
  if (!platformsAllowlisted(approved)) fail('approval_scope_mismatch');
  if (!isSubset(approved, selected)) fail('approval_scope_mismatch');

  const wfBudget = asNumber(workflow.advertising_budget);
  const approvedBudget = asNumber(advertising_budget);
  if (approvedBudget == null || approvedBudget < 0) fail('approval_scope_mismatch');
  if (wfBudget != null && approvedBudget > wfBudget) fail('approval_scope_mismatch');

  const ceiling = credit_ceiling == null ? null : asNumber(credit_ceiling);
  if (credit_ceiling != null && (ceiling == null || ceiling < 0)) fail('validation_failed');

  return { approved, approvedBudget, ceiling };
}

function assertApprovalFresh(workflow, approval, gate) {
  if (!approval) fail('approval_required');
  if (String(approval.gate) !== String(gate)) fail('approval_scope_mismatch');
  if (Number(approval.object_version) !== Number(workflow.version)) fail('approval_stale');
  const expected = contentHash(workflow, gate);
  if (String(approval.content_hash) !== expected) fail('approval_stale');
  return approval;
}

function materialChanged(before, after) {
  for (const f of MATERIAL_FIELDS) {
    if (f === 'selected_platforms') {
      const a = asPlatforms(before[f]).slice().sort().join(',');
      const b = asPlatforms(after[f]).slice().sort().join(',');
      if (a !== b) return true;
      continue;
    }
    if (SET_FIELDS.includes(f)) {
      if (asStrList(before[f]).join('\u0000') !== asStrList(after[f]).join('\u0000')) return true;
      continue;
    }
    if (f === 'advertising_budget') {
      if (asNumber(before[f]) !== asNumber(after[f])) return true;
      continue;
    }
    if (String(before[f] || '') !== String(after[f] || '')) return true;
  }
  return false;
}

function invalidateTargetState(workflow) {
  if (workflow.current_state === 'draft' && !workflow._hadApprovals) {
    return { state: 'draft', gate: 'research_execution', phase: 'research' };
  }
  return {
    state: GATE_FOR_WAIT.research_execution ? 'research_approval_required' : 'research_approval_required',
    gate: 'research_execution',
    phase: 'research',
  };
}

module.exports = {
  ALLOWED_PLATFORMS,
  MATERIAL_FIELDS,
  asNumber,
  asPlatforms,
  asStrList,
  isSubset,
  platformsAllowlisted,
  approvalSnapshot,
  contentHash,
  validateApproveScope,
  assertApprovalFresh,
  materialChanged,
  invalidateTargetState,
};
