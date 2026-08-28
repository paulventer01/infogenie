'use strict';

// PR7A only issues and revokes authority. Reservation/consumption remain an
// internal contract for a future, separately reviewed activation sink.
const express = require('express');
const db = require('../../db');
const tenantCtx = require('../tenants/context');
const capability = require('../security/meta_activation_capabilities');
const activation = require('./meta_campaign_activation');

const router = express.Router();

function isHumanSessionRequest(req) {
  return !!(req && req.user && Number.isSafeInteger(req.user.id) && req.user.id > 0
    && req.viaApiKey !== true && req.user.viaApiKey !== true
    && !['api_key', 'worker', 'service', 'autonomous', 'agent']
      .includes(String(req.user.principalType || req.user.principal_type || '').toLowerCase())
    && req.session && Number(req.session.userId) === req.user.id
    && typeof req.sessionID === 'string' && req.sessionID.length > 0);
}

function hasExplicitTenantGrant(req) {
  return !!(req && req.tenantRole && Array.isArray(req.tenantRole.permissions)
    && req.tenantRole.permissions.includes(capability.PERMISSION));
}

async function transaction(fn) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function common(req, tenantId) {
  return {
    tenantId,
    actorUserId: req.user.id,
    actorType: 'human',
    principalType: 'user',
    sessionId: req.sessionID,
    hasExplicitTenantPermission: (permission) => permission === capability.PERMISSION
      && hasExplicitTenantGrant(req),
  };
}

function issueInput(req, tenantId) {
  const body = req.body || {};
  return {
    ...common(req, tenantId),
    draftId: body.campaign_draft_id,
    draftRevision: body.campaign_draft_revision,
    snapshotHash: body.approved_snapshot_hash,
    publishApprovalId: body.publish_approval_id,
    publishingRequestId: body.publishing_request_id,
    intentId: body.delivery_intent_id,
    executionId: body.provider_draft_execution_id,
    reconciliationRunId: body.reconciliation_run_id,
    advertisingAccountId: body.advertising_account_id,
    credentialRefId: body.credential_reference_id,
    credentialRefVersion: body.credential_reference_version,
    accountFingerprint: body.account_fingerprint,
    ledgerRootHash: body.provider_ledger_root,
    finalConfirmationId: body.final_confirmation_id,
    finalConfirmation: body.final_confirmation,
    confirmedAt: body.confirmed_at,
    ttlMs: body.ttl_ms,
  };
}

function httpStatus(code) {
  if (code === 'human_session_required') return 401;
  if (code === 'permission_denied') return 403;
  if (code === 'capability_rejected' || code === 'reconciliation_not_verified') return 404;
  if (code === 'capability_expired') return 410;
  if (code === 'authoritative_binding_mismatch' || code === 'post_review_reconciliation_required') return 409;
  return 400;
}

function route(label, operation) {
  return async (req, res) => {
    try {
      if (!isHumanSessionRequest(req)) {
        return res.status(401).json({ error: 'human_session_required' });
      }
      if (!hasExplicitTenantGrant(req)) return res.status(403).json({ error: 'permission_denied' });
      const tenantId = await tenantCtx.resolveTenantId(req, { label: `meta-activation-capability:${label}` });
      const result = await operation(req, tenantId);
      return res.status(result.status === 'issued' ? 201 : 200).json(result);
    } catch (error) {
      return res.status(httpStatus(error.code)).json({ error: error.code || 'capability_request_failed' });
    }
  };
}

router.post('/', express.json(), route('issue', async (req, tenantId) => {
  const result = await transaction((client) => capability.issue(client, issueInput(req, tenantId)));
  return { capability_id: result.capability_id, status: 'issued', expires_at: result.expires_at };
}));

router.post('/:capabilityId/revoke', express.json(), route('revoke', async (req, tenantId) => {
  const result = await transaction((client) => capability.revoke(client, {
    ...common(req, tenantId), capabilityId: req.params.capabilityId,
  }));
  // Expiry is a committed lifecycle transition, not a failed transaction.
  // Convert its post-commit sentinel into the public error response here.
  if (result.expired === true) throw capability._deny('capability_expired');
  return { capability_id: result.capability_id, status: 'revoked' };
}));

router.post('/:capabilityId/activate', express.json({limit:'2kb'}), route('activate', async (req, tenantId) => {
  const body=req.body||{};
  if(Object.keys(body).length!==1 || !Object.prototype.hasOwnProperty.call(body,'invocation_id')) {
    throw capability._deny('capability_rejected');
  }
  return activation.activate({
    ...common(req,tenantId), capabilityId:req.params.capabilityId, invocationId:body.invocation_id,
  });
}));

module.exports = router;
module.exports._isHumanSessionRequest = isHumanSessionRequest;
module.exports._hasExplicitTenantGrant = hasExplicitTenantGrant;
module.exports._issueInput = issueInput;
module.exports._transaction = transaction;
module.exports._route = route;
