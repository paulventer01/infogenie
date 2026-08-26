'use strict';

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { requirePermission, hasPermission } = require('../tenants/permission_enforce');
const { fail, sendError, sendOrchError } = require('./errors');
const { PERMS, GATE_PERMISSION } = require('./states');
const { actorId } = require('./runner');
const { extractIdempotencyKey, requestHashFrom, endpointOf, runIdempotent } = require('./idempotency');
const { capPayload } = require('./payload_cap');
const drafts = require('./campaign_drafts');
const publishRequests = require('./campaign_publish_requests');
const deliveryIntents = require('./campaign_delivery_intents');
const confirmations = require('./campaign_provider_confirmations');
const D = require('./campaign_delivery_contracts');
require('./campaign_delivery_worker');

function guardPerm(req, res, key) {
  let allowed = false;
  requirePermission(key)(req, res, () => { allowed = true; });
  return allowed;
}

function wrap(permission, handler, opts) {
  return async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
      if (opts && opts.rejectApiKey && (req.viaApiKey === true || (req.user && req.user.viaApiKey === true))) {
        return sendError(res, 403, 'permission_denied');
      }
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'orch-campaign-drafts' });
      if (!tid) return sendError(res, 400, 'validation_failed');
      if (!guardPerm(req, res, permission)) return;
      if (!_db.hasDb()) return sendError(res, 503, 'validation_failed');
      const userId = actorId(req);
      if (!userId) return sendError(res, 400, 'validation_failed');
      const result = await handler(req, tid, userId, _db.getPool());
      return res.status(result.status || 200).json(result.body);
    } catch (err) {
      return sendOrchError(res, err);
    }
  };
}

function bodyOf(req) { return req.body && typeof req.body === 'object' ? req.body : {}; }
function tenantMismatch(body, tid) {
  if (body.tenant_id != null && Number(body.tenant_id) !== Number(tid)) fail('validation_failed');
}

router.post('/', capPayload, wrap(PERMS.edit, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
  if (!key) fail('validation_failed', { field: 'idempotency_key' });
  const run = await runIdempotent(pool, {
    tenantId: tid, key, endpoint: endpointOf(req), action: 'campaign_draft_create',
    requestHash: requestHashFrom(req), actorUserId: userId,
    workflowId: String(body.workflow_id || '').trim(), requestId: req.requestId,
    fn: async () => {
      const { draft, replay } = await drafts.createDraft(pool, {
        tenantId: tid, userId, workflowId: String(body.workflow_id || '').trim(),
        idempotencyKey: key, body, bodyTenantId: body.tenant_id,
      });
      return { status: replay ? 200 : 201, body: { ok: true, replay: !!replay, draft } };
    },
  });
  if (run.replay) {
    const bodyOut = run.body && typeof run.body === 'object' ? { ...run.body, replay: true } : run.body;
    const status = run.status >= 200 && run.status < 300 ? 200 : run.status;
    return { status, body: bodyOut };
  }
  return { status: run.status, body: run.body };
}));

router.get('/', wrap(PERMS.view, async (req, tid, _userId, pool) => {
  const wf = String(req.query.workflow_id || '').trim();
  const list = await drafts.listDrafts(pool, tid, wf || null);
  return { status: 200, body: { ok: true, drafts: list } };
}));

router.get('/:id/snapshot', wrap(PERMS.view, async (req, tid, _userId, pool) => {
  const snap = await drafts.snapshotDraft(pool, tid, String(req.params.id || ''));
  return { status: 200, body: { ok: true, ...snap } };
}));

router.get('/:id/history', wrap(PERMS.view, async (req, tid, _userId, pool) => {
  const includeAudit = hasPermission(req, PERMS.auditView);
  const hist = await drafts.historyDraft(pool, tid, String(req.params.id || ''), { includeAudit });
  return { status: 200, body: { ok: true, ...hist } };
}));

router.post('/:id/validate', capPayload, wrap(PERMS.edit, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const draft = await drafts.validateDraft(pool, {
    tenantId: tid, userId, draftId: String(req.params.id || ''), bodyTenantId: body.tenant_id, body,
  });
  return { status: 200, body: { ok: true, draft } };
}));

router.post('/:id/approve', capPayload, wrap(GATE_PERMISSION.campaign_publishing, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
  if (!key) fail('validation_failed', { field: 'idempotency_key' });
  const draftId = String(req.params.id || '');
  const run = await runIdempotent(pool, {
    tenantId: tid, key, endpoint: endpointOf(req), action: 'campaign_draft_approve',
    requestHash: requestHashFrom(req), actorUserId: userId,
    workflowId: undefined, requestId: req.requestId,
    fn: async () => {
      const { draft, approval, replay } = await drafts.approveDraft(pool, {
        tenantId: tid, userId, draftId,
        idempotencyKey: key, body, bodyTenantId: body.tenant_id,
      });
      return {
        status: 200,
        body: {
          ok: true, replay: !!replay, draft,
          approval: {
            id: approval.id, revision: approval.revision, contract_hash: approval.contract_hash,
            expires_at: approval.expires_at, snapshot: approval.snapshot_json, revoked_at: approval.revoked_at || null,
          },
        },
      };
    },
  });
  if (run.replay) {
    const cached = run.body && run.body.approval;
    const authorized = await drafts.assertApproveReplay(pool, tid, draftId, cached);
    const draft = await drafts.getDraft(pool, tid, draftId);
    return {
      status: 200,
      body: {
        ok: true,
        replay: true,
        draft,
        approval: {
          id: authorized.approval.id,
          revision: authorized.approval.revision,
          contract_hash: authorized.approval.contract_hash,
          expires_at: authorized.approval.expires_at,
          snapshot: authorized.approval.snapshot_json,
          revoked_at: authorized.approval.revoked_at || null,
        },
      },
    };
  }
  return { status: run.status, body: run.body };
}, { rejectApiKey: true }));

router.post('/:id/publishing-requests', capPayload, wrap(GATE_PERMISSION.campaign_publishing, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
  if (!key) fail('validation_failed', { field: 'idempotency_key' });
  const { row, replay } = await publishRequests.createPublishRequest(pool, {
    tenantId: tid, userId, draftId: String(req.params.id || ''),
    idempotencyKey: key, body, bodyTenantId: body.tenant_id,
  });
  return {
    status: 200,
    body: {
      ok: true,
      replay: !!replay,
      published: false,
      external_action_taken: false,
      request: publishRequests.publicRequest(row),
    },
  };
}, { rejectApiKey: true }));

router.post('/:id/publishing-requests/:publishingRequestId/delivery-intents', capPayload, wrap(GATE_PERMISSION.campaign_publishing, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
  if (!key) fail('validation_failed', { field: 'idempotency_key' });
  const { row, outbox, replay } = await deliveryIntents.createDeliveryIntent(pool, {
    tenantId: tid, userId,
    draftId: String(req.params.id || ''),
    publishingRequestId: String(req.params.publishingRequestId || ''),
    idempotencyKey: key, body, bodyTenantId: body.tenant_id,
  });
  return {
    status: 200,
    body: {
      ok: true,
      replay: !!replay,
      published: false,
      external_action_taken: false,
      intent: deliveryIntents.publicIntent(row),
      outbox: deliveryIntents.publicOutbox(outbox),
    },
  };
}, { rejectApiKey: true }));

router.post(
  '/provider-draft-confirmation-challenge/:draftId/publishing-requests/:publishingRequestId/delivery-intents/:intentId',
  capPayload,
  wrap(D.PERMISSION_PROVIDER_DRAFTS_CREATE, async (req, tid, userId, pool) => {
    const body = bodyOf(req);
    tenantMismatch(body, tid);
    const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
    if (!key) fail('validation_failed', { field: 'idempotency_key' });
    const { row, replay } = await confirmations.createChallenge(pool, {
      tenantId: tid, userId,
      draftId: String(req.params.draftId || ''),
      publishingRequestId: String(req.params.publishingRequestId || ''),
      intentId: String(req.params.intentId || ''),
      idempotencyKey: key, body, bodyTenantId: body.tenant_id,
    });
    return {
      status: 200,
      body: {
        ok: true,
        replay: !!replay,
        challenge: confirmations.publicChallenge(row),
      },
    };
  }, { rejectApiKey: true })
);

router.post(
  '/confirm-provider-draft/:draftId/publishing-requests/:publishingRequestId/delivery-intents/:intentId',
  capPayload,
  wrap(D.PERMISSION_PROVIDER_DRAFTS_CREATE, async (req, tid, userId, pool) => {
    const body = bodyOf(req);
    tenantMismatch(body, tid);
    const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
    if (!key) fail('validation_failed', { field: 'idempotency_key' });
    const { row, replay } = await confirmations.confirmProviderDraft(pool, {
      tenantId: tid, userId,
      draftId: String(req.params.draftId || ''),
      publishingRequestId: String(req.params.publishingRequestId || ''),
      intentId: String(req.params.intentId || ''),
      idempotencyKey: key, body, bodyTenantId: body.tenant_id,
    });
    return {
      status: 202,
      body: {
        ok: true,
        replay: !!replay,
        published: false,
        external_action_taken: false,
        confirmation: confirmations.publicConfirmation(row),
      },
    };
  }, { rejectApiKey: true })
);

router.post('/:id/revoke', capPayload, wrap(GATE_PERMISSION.campaign_publishing, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const draft = await drafts.revokeDraft(pool, {
    tenantId: tid, userId, draftId: String(req.params.id || ''),
    bodyTenantId: body.tenant_id, reason: body.reason,
  });
  return { status: 200, body: { ok: true, draft } };
}, { rejectApiKey: true }));

router.post('/:id/cancel', capPayload, wrap(PERMS.edit, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const draft = await drafts.cancelDraft(pool, { tenantId: tid, userId, draftId: String(req.params.id || '') });
  return { status: 200, body: { ok: true, draft } };
}));

router.get('/:id', wrap(PERMS.view, async (req, tid, _userId, pool) => {
  const draft = await drafts.getDraft(pool, tid, String(req.params.id || ''));
  return { status: 200, body: { ok: true, draft } };
}));

router.patch('/:id', capPayload, wrap(PERMS.edit, async (req, tid, userId, pool) => {
  const body = bodyOf(req);
  tenantMismatch(body, tid);
  const draft = await drafts.editDraft(pool, {
    tenantId: tid, userId, draftId: String(req.params.id || ''), body, bodyTenantId: body.tenant_id,
  });
  return { status: 200, body: { ok: true, draft } };
}));

module.exports = router;
