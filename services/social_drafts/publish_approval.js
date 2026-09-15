'use strict';

const crypto = require('node:crypto');

const HASH_RE = /^[0-9a-f]{64}$/;
const APPROVAL_HINT = 'Tenant requires approval before external delivery. Create a social draft via /api/social-drafts, submit for approval, then publish via /api/social-drafts/:id/approve.';

const MATERIAL_FIELDS = ['text', 'media_urls', 'platforms', 'scheduled_for', 'profile_id'];
const SERVER_META_KEYS = Object.freeze([
  'approved_at',
  'approval_content_hash',
  'approval_request_id',
  'approval_invalidated_at',
  'reviewer_notes',
  'publishing_claim',
  'publishing_claim_at',
  'published_at',
  'published_via',
  'delivery_outcome',
  'delivery_uncertain_at',
  'provider_accepted_at',
  'provider_post_id',
  'last_publish_error',
  'last_publish_attempt_at',
  'last_error',
]);
const USER_WRITABLE_STATUSES = Object.freeze(['draft', 'pending_approval']);

function _sortedList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).sort();
}

function contentSnapshot(draft) {
  return {
    profile_id: String(draft?.profile_id || ''),
    text: String(draft?.text || ''),
    media_urls: _sortedList(draft?.media_urls),
    platforms: _sortedList(draft?.platforms),
    scheduled_for: draft?.scheduled_for || null,
  };
}

function contentHash(draft) {
  return crypto.createHash('sha256').update(JSON.stringify(contentSnapshot(draft)), 'utf8').digest('hex');
}

function validContentHash(value) {
  return typeof value === 'string' && HASH_RE.test(value);
}

function approvalMeta(draft) {
  const meta = draft?.meta || {};
  return {
    approved_at: meta.approved_at || null,
    approval_content_hash: meta.approval_content_hash || null,
    approval_request_id: meta.approval_request_id || null,
  };
}

function hasValidApproval(draft) {
  const { approved_at, approval_content_hash } = approvalMeta(draft);
  if (!approved_at || !validContentHash(approval_content_hash)) return false;
  if (draft?.status === 'pending_approval') return false;
  return approval_content_hash === contentHash(draft);
}

function patchInvalidatesApproval(existing, patch) {
  if (!existing || existing.status !== 'approved') return false;
  for (const field of MATERIAL_FIELDS) {
    if (patch[field] === undefined) continue;
    if (field === 'media_urls' || field === 'platforms') {
      const before = JSON.stringify(_sortedList(existing[field]));
      const after = JSON.stringify(_sortedList(patch[field]));
      if (before !== after) return true;
      continue;
    }
    const before = field === 'scheduled_for' ? (existing[field] || null) : String(existing[field] || '');
    const after = field === 'scheduled_for' ? (patch[field] || null) : String(patch[field] || '');
    if (before !== after) return true;
  }
  return false;
}

function invalidateApprovalPatch(existing) {
  return {
    status: 'draft',
    meta: {
      approved_at: null,
      approval_content_hash: null,
      reviewer_notes: null,
      approval_invalidated_at: new Date().toISOString(),
    },
  };
}

function recordApprovalMeta(draft, notes) {
  const hash = contentHash(draft);
  return {
    approved_at: new Date().toISOString(),
    approval_content_hash: hash,
    reviewer_notes: notes || null,
    approval_invalidated_at: null,
  };
}

function sanitizeUserMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SERVER_META_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function sanitizeUserStatus(status, fallback = 'draft') {
  return USER_WRITABLE_STATUSES.includes(status) ? status : fallback;
}

function hasActivePublishingClaim(draft) {
  return !!(draft?.meta?.publishing_claim);
}

function materialFieldsChanged(before, after) {
  return contentHash(before) !== contentHash(after);
}

function evaluateClaimedAuthorization({ requireApproval, claimed, mode }) {
  return evaluatePublishAuthorization({ requireApproval, draft: claimed, mode });
}

function evaluatePublishAuthorization({ requireApproval, draft, mode }) {
  if (!requireApproval) return { ok: true };

  if (!draft) return { ok: false, error: 'not found' };

  if (draft.status === 'pending_approval' && mode !== 'approval') {
    return {
      ok: false,
      error: 'pending_approval',
      hint: 'Draft is awaiting approval. Approve via /api/social-drafts/:id/approve or withdraw first.',
    };
  }

  if (mode === 'approval') {
    if (!['pending_approval', 'approved', 'failed'].includes(draft.status)) {
      return {
        ok: false,
        error: `cannot approve status "${draft.status}"`,
      };
    }
    return { ok: true };
  }

  if (!hasValidApproval(draft)) {
    const { approval_content_hash } = approvalMeta(draft);
    if (approval_content_hash && validContentHash(approval_content_hash) && approval_content_hash !== contentHash(draft)) {
      return {
        ok: false,
        error: 'approval_stale',
        hint: 'Content changed after approval. Submit for approval again via /api/social-drafts/:id/submit-approval.',
      };
    }
    return {
      ok: false,
      error: 'approval_required',
      hint: APPROVAL_HINT,
    };
  }

  if (draft.status !== 'approved' && draft.status !== 'failed') {
    return {
      ok: false,
      error: 'approval_required',
      hint: APPROVAL_HINT,
    };
  }

  return { ok: true };
}

function blockedPublisherBody(error = 'approval_required') {
  return {
    ok: false,
    error,
    hint: APPROVAL_HINT,
    supported_flow: {
      create: 'POST /api/social-drafts',
      submit: 'POST /api/social-drafts/:id/submit-approval',
      approve: 'POST /api/social-drafts/:id/approve',
    },
  };
}

module.exports = {
  APPROVAL_HINT,
  MATERIAL_FIELDS,
  SERVER_META_KEYS,
  USER_WRITABLE_STATUSES,
  contentSnapshot,
  contentHash,
  validContentHash,
  approvalMeta,
  hasValidApproval,
  patchInvalidatesApproval,
  invalidateApprovalPatch,
  recordApprovalMeta,
  sanitizeUserMeta,
  sanitizeUserStatus,
  hasActivePublishingClaim,
  materialFieldsChanged,
  evaluatePublishAuthorization,
  evaluateClaimedAuthorization,
  blockedPublisherBody,
};
