// Social drafts — tenant-scoped planning layer on top of Zernio Social Publisher.
// Drafts live in Postgres (or an in-memory fallback when DATABASE_URL is absent)
// and publish via /api/social-publisher/post.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const _publishApproval = require('./publish_approval');
const {
  gateRouteText,
  contentSafetyHttpBody,
  attachContentSafetyWarnings,
} = require('../ai_governance/route_gate');
const {
  socialDraftGateText,
  socialDraftScanSizeError,
} = require('../ai_governance/content_schemas');
const { MAX_OUTPUT_SCAN_CHARS } = require('../ai_governance/output_gate');
const { createRateLimiter } = require('../security/rate_limit');

function _testOnlyMax(envName, fallback) {
  if (process.env.NODE_ENV !== 'test') return fallback;
  const n = Number.parseInt(String(process.env[envName] || ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

const SOCIAL_DRAFT_WRITE_MAX = _testOnlyMax('SOCIAL_DRAFT_WRITE_RATE_LIMIT_MAX', 60);

const socialDraftWriteLimiter = createRateLimiter({
  name: 'social-drafts-write',
  windowMs: 60_000,
  max: SOCIAL_DRAFT_WRITE_MAX,
  failClosed: true,
  keyFn: (req) => {
    const tid = req.tenant?.id;
    const uid = req.user?.id;
    if (tid != null && uid != null) return `social-drafts|${tid}|${uid}`;
    return null;
  },
});

const STATUSES = ['draft', 'pending_approval', 'approved', 'scheduled', 'published', 'failed', 'delivery_unknown'];
const PLATFORMS = [
  'twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube',
  'pinterest', 'reddit', 'bluesky', 'threads', 'googlebusiness',
  'telegram', 'snapchat', 'whatsapp', 'discord',
];

const _mem = new Map(); // tenantId -> drafts[]
let _memSeq = 1;
const PUBLISH_CLAIM_STALE_MS = 5 * 60 * 1000;
const _publishLockChains = new Map();

async function _withDraftPublishLock(tid, draftId, fn) {
  const key = `${tid}:${draftId}`;
  const prev = _publishLockChains.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prev.then(() => gate);
  _publishLockChains.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (_publishLockChains.get(key) === tail) _publishLockChains.delete(key);
  }
}

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

function _parseWarnings(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

function _oversizedDraftResponse(draft) {
  const oversized = socialDraftScanSizeError(draft, MAX_OUTPUT_SCAN_CHARS);
  if (!oversized) return null;
  return oversized;
}

async function _gateSocialDraft(req, tid, draft, label) {
  const oversized = _oversizedDraftResponse(draft);
  if (oversized) return oversized;
  try {
    return await gateRouteText({
      tenantId: tid,
      userId: req.user?.id || null,
      surface: 'social_drafts',
      action: 'generate_content',
      text: socialDraftGateText(draft),
      label,
    });
  } catch (_) {
    return {
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable. Save was stopped to protect your brand.',
      warnings: [],
    };
  }
}

function _safetyBlockResponse(res, gated) {
  const status = gated.error === 'content_safety_unavailable' ? 503 : 403;
  return res.status(status).json(contentSafetyHttpBody(gated));
}

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  // No-DB / demo fallback so calendar drafts still work in preview environments
  if (!_db.hasDb()) return 1;
  return null;
}

function _normalizePlatforms(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((p) => String(p).toLowerCase().trim()).filter((p) => PLATFORMS.includes(p)))];
}

function _normalizeMedia(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 4);
}

function _parseDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function _rowOut(r) {
  if (!r) return r;
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    profile_id: r.profile_id,
    status: r.status,
    text: r.text || '',
    media_urls: Array.isArray(r.media_urls) ? r.media_urls : (typeof r.media_urls === 'string' ? JSON.parse(r.media_urls || '[]') : []),
    platforms: Array.isArray(r.platforms) ? r.platforms : (typeof r.platforms === 'string' ? JSON.parse(r.platforms || '[]') : []),
    scheduled_for: r.scheduled_for || null,
    zernio_post_id: r.zernio_post_id || null,
    meta: r.meta && typeof r.meta === 'object' ? r.meta : (typeof r.meta === 'string' ? JSON.parse(r.meta || '{}') : {}),
    content_safety_warnings: _parseWarnings(r.content_safety_warnings),
    created_by: r.created_by || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function _memList(tid) {
  if (!_mem.has(tid)) _mem.set(tid, []);
  return _mem.get(tid);
}

async function _listDrafts(tid, { profileId, from, to, status } = {}) {
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const params = [tid];
    const clauses = ['tenant_id=$1'];
    if (profileId) {
      params.push(profileId);
      clauses.push(`profile_id=$${params.length}`);
    }
    if (from) {
      params.push(from);
      clauses.push(`(scheduled_for IS NULL OR scheduled_for >= $${params.length})`);
    }
    if (to) {
      params.push(to);
      clauses.push(`(scheduled_for IS NULL OR scheduled_for <= $${params.length})`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status=$${params.length}`);
    }
    const r = await p.query(
      `SELECT * FROM social_post_drafts WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(scheduled_for, created_at) ASC`,
      params,
    );
    return r.rows.map(_rowOut);
  }
  let rows = _memList(tid).map((r) => ({ ...r }));
  if (profileId) rows = rows.filter((r) => r.profile_id === profileId);
  if (status) rows = rows.filter((r) => r.status === status);
  if (from) {
    const f = new Date(from).getTime();
    rows = rows.filter((r) => !r.scheduled_for || new Date(r.scheduled_for).getTime() >= f);
  }
  if (to) {
    const t = new Date(to).getTime();
    rows = rows.filter((r) => !r.scheduled_for || new Date(r.scheduled_for).getTime() <= t);
  }
  rows.sort((a, b) => new Date(a.scheduled_for || a.created_at || 0) - new Date(b.scheduled_for || b.created_at || 0));
  return rows.map(_rowOut);
}

async function _getDraft(tid, id) {
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(`SELECT * FROM social_post_drafts WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    return r.rows[0] ? _rowOut(r.rows[0]) : null;
  }
  return _memList(tid).find((r) => String(r.id) === String(id)) || null;
}

async function _insertDraft(tid, fields) {
  const now = new Date().toISOString();
  const warnings = _parseWarnings(fields.content_safety_warnings);
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(
      `INSERT INTO social_post_drafts
        (tenant_id, profile_id, status, text, media_urls, platforms, scheduled_for, zernio_post_id, meta, created_by, content_safety_warnings)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb)
       RETURNING *`,
      [
        tid,
        fields.profile_id,
        fields.status || 'draft',
        fields.text || '',
        JSON.stringify(fields.media_urls || []),
        JSON.stringify(fields.platforms || []),
        fields.scheduled_for || null,
        fields.zernio_post_id || null,
        JSON.stringify(fields.meta || {}),
        fields.created_by || null,
        JSON.stringify(warnings),
      ],
    );
    return _rowOut(r.rows[0]);
  }
  const row = {
    id: _memSeq++,
    tenant_id: tid,
    profile_id: fields.profile_id,
    status: fields.status || 'draft',
    text: fields.text || '',
    media_urls: fields.media_urls || [],
    platforms: fields.platforms || [],
    scheduled_for: fields.scheduled_for || null,
    zernio_post_id: fields.zernio_post_id || null,
    meta: fields.meta || {},
    content_safety_warnings: warnings,
    created_by: fields.created_by || null,
    created_at: now,
    updated_at: now,
  };
  _memList(tid).push(row);
  return _rowOut(row);
}

async function _insertDraftWithClient(client, tid, fields) {
  const warnings = _parseWarnings(fields.content_safety_warnings);
  const r = await client.query(
    `INSERT INTO social_post_drafts
      (tenant_id, profile_id, status, text, media_urls, platforms, scheduled_for, zernio_post_id, meta, created_by, content_safety_warnings)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb)
     RETURNING *`,
    [
      tid,
      fields.profile_id,
      fields.status || 'draft',
      fields.text || '',
      JSON.stringify(fields.media_urls || []),
      JSON.stringify(fields.platforms || []),
      fields.scheduled_for || null,
      fields.zernio_post_id || null,
      JSON.stringify(fields.meta || {}),
      fields.created_by || null,
      JSON.stringify(warnings),
    ],
  );
  return _rowOut(r.rows[0]);
}

async function _insertDraftsBulk(tid, items, opts = {}) {
  if (!items.length) return [];
  if (!_db.hasDb()) {
    const listBefore = _memList(tid).length;
    const created = [];
    try {
      for (let i = 0; i < items.length; i++) {
        if (opts.failAfterIndex != null && i >= opts.failAfterIndex) {
          throw new Error('bulk_insert_test_failure');
        }
        created.push(await _insertDraft(tid, items[i]));
      }
      return created;
    } catch (e) {
      _mem.set(tid, _memList(tid).slice(0, listBefore));
      throw e;
    }
  }
  const client = await _db.getPool().connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (let i = 0; i < items.length; i++) {
      if (opts.failAfterIndex != null && i >= opts.failAfterIndex) {
        throw new Error('bulk_insert_test_failure');
      }
      created.push(await _insertDraftWithClient(client, tid, items[i]));
    }
    await client.query('COMMIT');
    return created;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function _updateDraft(tid, id, patch) {
  const existing = await _getDraft(tid, id);
  if (!existing) return null;
  const next = _applyDraftPatch(existing, patch);
  const warnings = patch.content_safety_warnings !== undefined
    ? _parseWarnings(patch.content_safety_warnings)
    : existing.content_safety_warnings || [];
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(
      `UPDATE social_post_drafts SET
         profile_id=$1, status=$2, text=$3,
         media_urls=$4::jsonb, platforms=$5::jsonb,
         scheduled_for=$6, zernio_post_id=$7, meta=$8::jsonb,
         content_safety_warnings=$9::jsonb,
         updated_at=NOW()
       WHERE id=$10 AND tenant_id=$11 RETURNING *`,
      [
        next.profile_id,
        next.status,
        next.text || '',
        JSON.stringify(next.media_urls || []),
        JSON.stringify(next.platforms || []),
        next.scheduled_for || null,
        next.zernio_post_id || null,
        JSON.stringify(next.meta || {}),
        JSON.stringify(warnings),
        id,
        tid,
      ],
    );
    return r.rows[0] ? _rowOut(r.rows[0]) : null;
  }
  const list = _memList(tid);
  const idx = list.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return null;
  list[idx] = { ...next, content_safety_warnings: warnings };
  return _rowOut(list[idx]);
}

async function _deleteDraft(tid, id) {
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(`DELETE FROM social_post_drafts WHERE id=$1 AND tenant_id=$2 RETURNING id`, [id, tid]);
    return r.rowCount > 0;
  }
  const list = _memList(tid);
  const before = list.length;
  const next = list.filter((r) => String(r.id) !== String(id));
  _mem.set(tid, next);
  return next.length < before;
}

function _isStalePublishingClaim(meta) {
  if (!meta?.publishing_claim_at) return true;
  const at = new Date(meta.publishing_claim_at).getTime();
  return Number.isNaN(at) || (Date.now() - at) > PUBLISH_CLAIM_STALE_MS;
}

function _stripPublishingClaim(meta) {
  return {
    ...(meta || {}),
    publishing_claim: null,
    publishing_claim_at: null,
  };
}

function _updatedAtMs(draft) {
  const at = draft?.updated_at ? new Date(draft.updated_at).getTime() : NaN;
  return Number.isNaN(at) ? null : at;
}

function _userPatchBlockedReason(draft) {
  if (!draft) return 'not found';
  if (draft.status === 'published' || draft.status === 'scheduled' || draft.zernio_post_id || draft.meta?.published_at) {
    return 'already_published';
  }
  if (draft.status === 'delivery_unknown' || draft.meta?.delivery_outcome === 'unknown') return 'delivery_unknown';
  if (draft.meta?.publishing_claim) return 'publish_in_progress';
  return null;
}

function _userPatchStaleReason(expected, current) {
  if (!expected || !current) return null;
  const blocked = _userPatchBlockedReason(current);
  if (blocked) return blocked;
  if (String(expected.id) !== String(current.id)) return 'conflict';
  const expectedAt = _updatedAtMs(expected);
  const currentAt = _updatedAtMs(current);
  if (expectedAt == null || currentAt == null || expectedAt !== currentAt) return 'conflict';
  return null;
}

function _nextUpdatedAt(existing) {
  const now = Date.now();
  const prev = _updatedAtMs(existing) || 0;
  return new Date(Math.max(now, prev + 1)).toISOString();
}

function _applyDraftPatch(existing, patch) {
  let nextMeta = existing.meta;
  if (patch.meta !== undefined) {
    nextMeta = { ...existing.meta, ...patch.meta };
    for (const [k, v] of Object.entries(patch.meta)) {
      if (v === null) delete nextMeta[k];
    }
  }
  return {
    ...existing,
    ...patch,
    media_urls: patch.media_urls !== undefined ? patch.media_urls : existing.media_urls,
    platforms: patch.platforms !== undefined ? patch.platforms : existing.platforms,
    meta: nextMeta,
    updated_at: _nextUpdatedAt(existing),
  };
}

async function _updateUserDraft(tid, id, expected, patch) {
  const existing = await _getDraft(tid, id);
  if (!existing) return { ok: false, error: 'not found' };
  const blocked = _userPatchBlockedReason(existing);
  if (blocked) return { ok: false, error: blocked, draft: existing };
  if (expected) {
    const stale = _userPatchStaleReason(expected, existing);
    if (stale) return { ok: false, error: stale, draft: existing };
  }

  if (_publishApproval.patchInvalidatesApproval(existing, patch)) {
    Object.assign(patch, _publishApproval.invalidateApprovalPatch(existing));
  }
  const next = _applyDraftPatch(existing, patch);
  const warnings = patch.content_safety_warnings !== undefined
    ? _parseWarnings(patch.content_safety_warnings)
    : existing.content_safety_warnings || [];
  if (_db.hasDb()) {
    const expectedAt = existing.updated_at;
    const p = await _db.getPool();
    const r = await p.query(
      `UPDATE social_post_drafts SET
         profile_id=$1, status=$2, text=$3,
         media_urls=$4::jsonb, platforms=$5::jsonb,
         scheduled_for=$6, meta=$7::jsonb,
         content_safety_warnings=$8::jsonb,
         updated_at=NOW()
       WHERE id=$9 AND tenant_id=$10
         AND status NOT IN ('published', 'scheduled', 'delivery_unknown')
         AND zernio_post_id IS NULL
         AND COALESCE(meta->>'published_at', '') = ''
         AND COALESCE(meta->>'delivery_outcome', '') <> 'unknown'
         AND COALESCE(meta->>'publishing_claim', '') = ''
         AND FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000) = $11::bigint
       RETURNING *`,
      [
        next.profile_id,
        next.status,
        next.text || '',
        JSON.stringify(next.media_urls || []),
        JSON.stringify(next.platforms || []),
        next.scheduled_for || null,
        JSON.stringify(next.meta || {}),
        JSON.stringify(warnings),
        id,
        tid,
        _updatedAtMs({ updated_at: expectedAt }),
      ],
    );
    if (r.rows[0]) return { ok: true, draft: _rowOut(r.rows[0]) };
    const current = await _getDraft(tid, id);
    if (!current) return { ok: false, error: 'not found' };
    return { ok: false, error: _userPatchStaleReason(expected || existing, current) || _userPatchBlockedReason(current) || 'conflict', draft: current };
  }

  const list = _memList(tid);
  const idx = list.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return { ok: false, error: 'not found' };
  const current = list[idx];
  const stale = _userPatchStaleReason(expected || existing, current);
  if (stale) return { ok: false, error: stale, draft: _rowOut(current) };
  const currentBlocked = _userPatchBlockedReason(current);
  if (currentBlocked) return { ok: false, error: currentBlocked, draft: _rowOut(current) };
  const written = {
    ..._applyDraftPatch(current, patch),
    content_safety_warnings: warnings,
  };
  list[idx] = written;
  return { ok: true, draft: _rowOut(written) };
}

function _draftShapeForGate(fields) {
  return {
    text: fields.text || '',
    media_urls: fields.media_urls || [],
    platforms: fields.platforms || [],
    meta: fields.meta || {},
  };
}

function _fieldsFromCreateBody(body) {
  const profile_id = String(body.profile_id || body.profileId || '').trim();
  const platforms = _normalizePlatforms(body.platforms);
  const text = String(body.text || '');
  const media_urls = _normalizeMedia(body.media_urls || body.mediaUrls || []);
  const scheduled_for = _parseDate(body.scheduled_for || body.scheduledFor);
  const status = _publishApproval.sanitizeUserStatus(body.status, 'draft');
  const meta = _publishApproval.sanitizeUserMeta(body.meta);
  return {
    profile_id,
    platforms,
    text,
    media_urls,
    scheduled_for,
    status,
    meta,
  };
}

function _fieldsFromBulkItem(it, profile_id) {
  const platforms = _normalizePlatforms(it.platforms || (it.platform ? [it.platform] : []));
  const text = String(it.text || it.caption || it.copy || '');
  const media_urls = _normalizeMedia(it.media_urls || it.mediaUrls || []);
  let scheduled_for = _parseDate(it.scheduled_for || it.scheduledFor);
  if (!scheduled_for && it.scheduledDate) {
    const t = it.scheduledTime || '09:00';
    scheduled_for = _parseDate(`${it.scheduledDate}T${t}`);
  }
  const meta = _publishApproval.sanitizeUserMeta({
    imported: true,
    funnel_stage: it.funnelStage || it.funnel_stage || null,
    archetype_id: it.archetypeId || it.archetype_id || null,
    alt_text: it.alt_text || it.altText || null,
    media_alt: it.media_alt || it.mediaAlt || null,
    ...(it.meta || {}),
  });
  return {
    profile_id,
    status: 'draft',
    text,
    media_urls,
    platforms,
    scheduled_for,
    meta,
  };
}

function _buildPatchFromBody(body) {
  const patch = {};
  if (body.profile_id != null || body.profileId != null) {
    patch.profile_id = String(body.profile_id || body.profileId).trim();
  }
  if (body.text != null) patch.text = String(body.text);
  if (body.media_urls != null || body.mediaUrls != null) {
    patch.media_urls = _normalizeMedia(body.media_urls || body.mediaUrls);
  }
  if (body.platforms != null) patch.platforms = _normalizePlatforms(body.platforms);
  if (body.scheduled_for !== undefined || body.scheduledFor !== undefined) {
    patch.scheduled_for = _parseDate(body.scheduled_for !== undefined ? body.scheduled_for : body.scheduledFor);
  }
  if (body.status != null) patch.status = body.status;
  if (body.meta != null && typeof body.meta === 'object') {
    patch.meta = _publishApproval.sanitizeUserMeta(body.meta);
  }
  return patch;
}

async function _releasePublishingClaim(tid, id, token) {
  if (!token) return null;
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(
      `UPDATE social_post_drafts SET
         meta = (COALESCE(meta, '{}'::jsonb)
           || jsonb_build_object('publishing_claim', null, 'publishing_claim_at', null)),
         updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
         AND meta->>'publishing_claim' = $3
         AND status <> 'delivery_unknown'
         AND COALESCE(meta->>'delivery_outcome', '') <> 'unknown'
       RETURNING *`,
      [id, tid, token],
    );
    if (r.rows[0]) return _rowOut(r.rows[0]);
    return await _getDraft(tid, id);
  }
  const existing = await _getDraft(tid, id);
  if (!existing) return null;
  if (existing.meta?.publishing_claim !== token) return existing;
  if (_isDeliveryUnknown(existing)) return existing;
  return await _updateDraft(tid, id, {
    meta: {
      publishing_claim: null,
      publishing_claim_at: null,
    },
  });
}

function _hasUnresolvedPublishingClaim(meta) {
  return !!(meta?.publishing_claim);
}

function _isDeliveryUnknown(draft) {
  if (!draft) return false;
  if (draft.status === 'delivery_unknown' || draft.meta?.delivery_outcome === 'unknown') return true;
  return false;
}

function _claimBlockError(meta) {
  if (!_hasUnresolvedPublishingClaim(meta)) return null;
  if (_isStalePublishingClaim(meta)) return 'delivery_unknown';
  return 'publish_in_progress';
}

function _claimableStatuses(mode) {
  return mode === 'direct'
    ? ['draft', 'approved', 'failed']
    : ['pending_approval', 'approved', 'failed'];
}

function _classifyPublishResult(result) {
  if (result?.ok) return { outcome: 'success', result };
  const err = String(result?.error || 'publish_failed');
  const httpStatus = Number(result?.httpStatus) || 0;
  if (result?.uncertain === true || _uncertainPublishError(err, httpStatus)) {
    return { outcome: 'uncertain', error: err, result };
  }
  return { outcome: 'rejected', error: err, result };
}

function _uncertainPublishError(err, httpStatus) {
  const msg = String(err || '');
  if (/timeout|ECONNRESET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|socket hang up|network|parse failed/i.test(msg)) {
    return true;
  }
  if (httpStatus >= 500) return true;
  return false;
}

async function _claimPublishing(tid, draftId, opts = {}) {
  const mode = opts.mode || 'approval';
  const allowedStatuses = _claimableStatuses(mode);

  if (_db.hasDb()) {
    const p = await _db.getPool();
    const token = `pub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const r = await p.query(
      `UPDATE social_post_drafts SET
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
           'publishing_claim', $4::text,
           'publishing_claim_at', to_jsonb(NOW()::text)
         ),
         updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
         AND status = ANY($3::text[])
         AND status NOT IN ('published', 'scheduled', 'delivery_unknown')
         AND zernio_post_id IS NULL
         AND COALESCE(meta->>'published_at', '') = ''
         AND COALESCE(meta->>'delivery_outcome', '') <> 'unknown'
         AND COALESCE(meta->>'publishing_claim', '') = ''
       RETURNING *`,
      [draftId, tid, allowedStatuses, token],
    );
    if (r.rows.length) return { ok: true, token, draft: _rowOut(r.rows[0]) };
    const existing = await _getDraft(tid, draftId);
    if (!existing) return { ok: false, error: 'not found' };
    if (_isDeliveryUnknown(existing)) {
      return { ok: false, error: 'delivery_unknown', draft: existing };
    }
    if (existing.status === 'published' || existing.status === 'scheduled' || existing.meta?.published_at || existing.zernio_post_id) {
      return { ok: false, error: 'already_published', draft: existing };
    }
    const claimErr = _claimBlockError(existing.meta);
    if (claimErr) return { ok: false, error: claimErr, draft: existing };
    if (!allowedStatuses.includes(existing.status)) {
      const err = mode === 'direct'
        ? `cannot publish status "${existing.status}"`
        : `cannot approve status "${existing.status}"`;
      return { ok: false, error: err, draft: existing };
    }
    return { ok: false, error: 'cannot_claim', draft: existing };
  }

  const list = _memList(tid);
  const idx = list.findIndex((r) => String(r.id) === String(draftId));
  if (idx < 0) return { ok: false, error: 'not found' };
  const row = list[idx];
  if (_isDeliveryUnknown(row)) {
    return { ok: false, error: 'delivery_unknown', draft: _rowOut(row) };
  }
  if (row.status === 'published' || row.status === 'scheduled' || row.meta?.published_at || row.zernio_post_id) {
    return { ok: false, error: 'already_published', draft: _rowOut(row) };
  }
  if (!allowedStatuses.includes(row.status)) {
    const err = mode === 'direct'
      ? `cannot publish status "${row.status}"`
      : `cannot approve status "${row.status}"`;
    return { ok: false, error: err, draft: _rowOut(row) };
  }
  const claimErr = _claimBlockError(row.meta);
  if (claimErr) return { ok: false, error: claimErr, draft: _rowOut(row) };
  const token = `pub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const next = {
    ...row,
    meta: {
      ...(row.meta || {}),
      publishing_claim: token,
      publishing_claim_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
  list[idx] = next;
  return { ok: true, token, draft: _rowOut(next) };
}

async function _publishViaZernio(_req, draft) {
  const https = require('https');
  const key = process.env.ZERNIO_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) {
    return { ok: false, error: 'ZERNIO_API_KEY required — add it as a Replit Secret.' };
  }
  const payload = {
    text: draft.text || '',
    platforms: draft.platforms || [],
    profileId: draft.profile_id,
  };
  if (draft.media_urls?.length) payload.mediaUrls = draft.media_urls;
  if (draft.scheduled_for) payload.scheduledFor = draft.scheduled_for;

  return await new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const r = https.request({
      hostname: 'zernio.com',
      path: '/api/v1/posts',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (resp) => {
      let d = '';
      resp.on('data', (c) => { d += c; });
      resp.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            resolve({ ok: true, post: j.post || j.data || j, httpStatus: resp.statusCode });
          } else {
            const err = j.error?.message || j.error || j.message || `zernio ${resp.statusCode}`;
            resolve({
              ok: false,
              error: err,
              httpStatus: resp.statusCode,
              uncertain: resp.statusCode >= 500,
            });
          }
        } catch (e) {
          resolve({ ok: false, error: `parse failed: ${d.slice(0, 200)}`, uncertain: true });
        }
      });
    });
    r.on('error', (e) => resolve({ ok: false, error: e.message, uncertain: true }));
    r.setTimeout(30000, () => { r.destroy(); resolve({ ok: false, error: 'zernio timeout (30s)', uncertain: true }); });
    r.write(data);
    r.end();
  });
}

router.get('/test', _safeAsync(async (req, res) => {
  res.json({
    ok: true,
    name: 'Social Drafts',
    statuses: STATUSES,
    platforms: PLATFORMS,
    db: !!(_db.hasDb && _db.hasDb()),
  });
}));

router.get('/list', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  const profileId = String(req.query.profileId || '').trim() || null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const drafts = await _listDrafts(tid, { profileId, from, to, status });
  res.json({ ok: true, drafts, source: _db.hasDb() ? 'db' : 'memory' });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.post('/', socialDraftWriteLimiter, _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const body = req.body || {};
  const fields = _fieldsFromCreateBody(body);
  if (!fields.profile_id) return _err(res, 400, 'profile_id required');
  if (!fields.text.trim() && !fields.media_urls.length) return _err(res, 400, 'text or media_urls required');

  const gated = await _gateSocialDraft(req, tid, _draftShapeForGate(fields), 'social-drafts:create');
  if (!gated.ok) {
    if (gated.error === 'content_too_long') {
      return res.status(400).json({ ok: false, error: gated.error, userMessage: gated.userMessage });
    }
    return _safetyBlockResponse(res, gated);
  }

  const warnings = gated.warnings || gated.content_safety_warnings || [];
  const draft = await _insertDraft(tid, {
    ...fields,
    content_safety_warnings: warnings,
    created_by: req.user?.email || req.user?.id || null,
  });
  res.json(attachContentSafetyWarnings({ ok: true, draft }, warnings));
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.post('/bulk', socialDraftWriteLimiter, _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:bulk');
  if (!tid) return _err(res, 400, 'no_tenant');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const profile_id = String(req.body?.profile_id || req.body?.profileId || '').trim();
  if (!profile_id) return _err(res, 400, 'profile_id required');
  if (!items.length) return _err(res, 400, 'items required');

  const prepared = [];
  for (const it of items.slice(0, 100)) {
    const fields = _fieldsFromBulkItem(it, profile_id);
    if (!fields.text.trim() && !fields.media_urls.length) continue;
    const gated = await _gateSocialDraft(req, tid, _draftShapeForGate(fields), 'social-drafts:bulk');
    if (!gated.ok) {
      if (gated.error === 'content_too_long') {
        return res.status(400).json({
          ok: false,
          error: gated.error,
          userMessage: gated.userMessage,
        });
      }
      return _safetyBlockResponse(res, gated);
    }
    prepared.push({
      ...fields,
      content_safety_warnings: gated.warnings || gated.content_safety_warnings || [],
      created_by: req.user?.email || req.user?.id || null,
    });
  }

  const failAfterIndex = (
    process.env.NODE_ENV === 'test'
    && req.headers['x-test-bulk-fail-after-index'] != null
  )
    ? Number.parseInt(String(req.headers['x-test-bulk-fail-after-index']), 10)
    : null;

  try {
    const created = await _insertDraftsBulk(tid, prepared, {
      failAfterIndex: Number.isFinite(failAfterIndex) ? failAfterIndex : null,
    });
    res.json({ ok: true, created: created.length, drafts: created });
  } catch (e) {
    if (e.message === 'bulk_insert_test_failure') {
      return _err(res, 500, 'bulk_insert_failed');
    }
    throw e;
  }
}));

router.get('/settings', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:settings');
  if (!tid) return _err(res, 400, 'no_tenant');
  const resolved = await _resolveSettings(tid);
  if (!resolved.ok) return _err(res, 503, resolved.error);
  res.json({ ok: true, settings: resolved.settings });
}));

router.put('/settings', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:settings-put');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const settings = await _setSettings(tid, {
      require_approval: !!req.body?.require_approval,
    });
    res.json({ ok: true, settings });
  } catch (e) {
    if (e.code === 'settings_unavailable') return _err(res, 503, 'settings_unavailable');
    throw e;
  }
}));

router.get('/approvals/queue', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:approvals-queue');
  if (!tid) return _err(res, 400, 'no_tenant');
  const drafts = await _listDrafts(tid, { status: 'pending_approval' });
  res.json({ ok: true, drafts });
}));

router.get('/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:get');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');
  res.json({ ok: true, draft });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.patch('/:id', socialDraftWriteLimiter, _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:patch');
  if (!tid) return _err(res, 400, 'no_tenant');
  const existing = await _getDraft(tid, req.params.id);
  if (!existing) return _err(res, 404, 'not found');
  if (existing.status === 'pending_approval') {
    return _err(res, 400, 'Draft is pending approval — withdraw approval first or wait for a decision.');
  }
  if (_publishApproval.hasActivePublishingClaim(existing) || existing.status === 'delivery_unknown') {
    return _err(res, 409, existing.status === 'delivery_unknown' ? 'delivery_unknown' : 'publish_in_progress');
  }
  const body = req.body || {};
  const patch = _buildPatchFromBody(body);
  if (body.status != null) {
    if (!_publishApproval.USER_WRITABLE_STATUSES.includes(body.status)) {
      return _err(res, 400, 'status is server-controlled');
    }
    patch.status = body.status;
  }
  if (_publishApproval.patchInvalidatesApproval(existing, patch)) {
    Object.assign(patch, _publishApproval.invalidateApprovalPatch(existing));
  }

  const mergedForGate = _applyDraftPatch(existing, patch);
  const gated = await _gateSocialDraft(req, tid, _draftShapeForGate(mergedForGate), 'social-drafts:patch');
  if (!gated.ok) {
    if (gated.error === 'content_too_long') {
      return res.status(400).json({ ok: false, error: gated.error, userMessage: gated.userMessage });
    }
    return _safetyBlockResponse(res, gated);
  }

  patch.content_safety_warnings = gated.warnings || gated.content_safety_warnings || [];
  const updated = await _updateUserDraft(tid, req.params.id, existing, patch);
  if (!updated.ok) {
    const code = updated.error === 'not found' ? 404 : 409;
    return res.status(code).json({ ok: false, error: updated.error, draft: updated.draft || undefined });
  }
  const warnings = updated.draft?.content_safety_warnings || patch.content_safety_warnings || [];
  res.json(attachContentSafetyWarnings({ ok: true, draft: updated.draft }, warnings));
}));

router.post('/:id/publish', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:publish');
  if (!tid) return _err(res, 400, 'no_tenant');
  const result = await _executePublishDraft(tid, req.params.id, { mode: 'direct', req });
  if (!result.ok) {
    if (result.error === 'not found') return _err(res, 404, result.error);
    const code = result.error === 'delivery_unknown' ? 409 : 400;
    return res.status(code).json({ ok: false, error: result.error, draft: result.draft || undefined });
  }
  res.json({
    ok: true,
    draft: result.draft,
    post: result.post,
    scheduled: !!result.draft?.scheduled_for,
  });
}));

// ── Approval settings + queue (works with or without approval_workflows DB) ──
const _settings = new Map(); // tid -> { require_approval: bool }
const DEFAULT_SETTINGS = Object.freeze({ require_approval: false });

async function _resolveSettings(tid) {
  if (!tid) return { ok: false, error: 'settings_unavailable' };
  if (_db.hasDb()) {
    try {
      const p = await _db.getPool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS social_publisher_settings (
          tenant_id INT PRIMARY KEY,
          require_approval BOOLEAN DEFAULT FALSE,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      const r = await p.query(`SELECT * FROM social_publisher_settings WHERE tenant_id=$1`, [tid]);
      if (r.rows[0]) {
        return { ok: true, settings: { require_approval: !!r.rows[0].require_approval }, source: 'db' };
      }
      return { ok: true, settings: { ...DEFAULT_SETTINGS }, source: 'default' };
    } catch (e) {
      return { ok: false, error: 'settings_unavailable', cause: e.message };
    }
  }
  return { ok: true, settings: _settings.get(tid) || { ...DEFAULT_SETTINGS }, source: 'memory' };
}

async function _getSettings(tid) {
  const resolved = await _resolveSettings(tid);
  if (!resolved.ok) {
    const err = new Error(resolved.error || 'settings_unavailable');
    err.code = 'settings_unavailable';
    throw err;
  }
  return resolved.settings;
}

async function _setSettings(tid, patch) {
  const resolved = await _resolveSettings(tid);
  if (!resolved.ok) {
    const err = new Error(resolved.error || 'settings_unavailable');
    err.code = 'settings_unavailable';
    throw err;
  }
  const next = { ...resolved.settings, ...patch, require_approval: !!(patch.require_approval ?? resolved.settings.require_approval) };
  _settings.set(tid, next);
  if (_db.hasDb()) {
    const p = await _db.getPool();
    await p.query(`
      INSERT INTO social_publisher_settings(tenant_id, require_approval, updated_at)
      VALUES ($1,$2,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET require_approval=$2, updated_at=NOW()`,
      [tid, !!next.require_approval]);
  }
  return next;
}

router.post('/:id/submit-approval', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:submit-approval');
  if (!tid) return _err(res, 400, 'no_tenant');
  let draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');
  if (!['draft', 'approved'].includes(draft.status)) {
    return _err(res, 400, `Cannot submit approval from status "${draft.status}"`);
  }
  if (!draft.platforms?.length) return _err(res, 400, 'select at least one platform');

  // Loop must-have: self-heal before human review (verify → fix → re-verify)
  let self_heal = null;
  const skipHeal = req.body?.skip_self_heal === true;
  if (!skipHeal && draft.text) {
    try {
      const { selfHealDraft } = require('./self_heal');
      self_heal = await selfHealDraft(tid, draft.text, { maxAttempts: 3 });
      if (self_heal.text && self_heal.text !== draft.text) {
        draft = await _updateDraft(tid, draft.id, {
          text: self_heal.text,
          meta: {
            ...(draft.meta || {}),
            self_heal: {
              healed: true,
              passed: self_heal.passed,
              final_verdict: self_heal.final_verdict,
              attempts: self_heal.attempts?.length || 0,
              at: new Date().toISOString(),
            },
            original_text: draft.text,
          },
        });
      } else {
        draft = await _updateDraft(tid, draft.id, {
          meta: {
            ...(draft.meta || {}),
            self_heal: {
              healed: false,
              passed: self_heal.passed,
              final_verdict: self_heal.final_verdict,
              attempts: self_heal.attempts?.length || 0,
              at: new Date().toISOString(),
            },
          },
        });
      }
      // Block submission if still failing critically unless force=true
      if (!self_heal.passed && self_heal.final_verdict === 'fail' && req.body?.force !== true) {
        return res.status(400).json({
          ok: false,
          error: 'self_heal_failed',
          hint: 'Draft still fails safety checks after auto-rewrite. Edit manually or pass force=true.',
          self_heal,
          draft,
        });
      }
    } catch (e) {
      self_heal = { ok: false, error: e.message };
    }
  }

  const updated = await _updateDraft(tid, draft.id, {
    status: 'pending_approval',
    meta: {
      ...(draft.meta || {}),
      submitted_for_approval_at: new Date().toISOString(),
      submitted_by: req.user?.email || req.user?.id || null,
    },
  });

  let approval_request = null;
  if (_db.hasDb()) {
    try {
      const p = await _db.getPool();
      const desc = JSON.stringify({
        draft_id: draft.id,
        text: (updated.text || draft.text || '').slice(0, 500),
        platforms: draft.platforms,
        scheduled_for: draft.scheduled_for,
        media_urls: draft.media_urls,
        self_heal: self_heal ? { passed: self_heal.passed, verdict: self_heal.final_verdict } : null,
      });
      const r = await p.query(
        `INSERT INTO approval_requests(tenant_id,action_type,title,description,proposed_by,channel,simulation_result,status)
         VALUES ($1,'social_post_publish',$2,$3,$4,$5,$6,'pending') RETURNING *`,
        [
          tid,
          `Social post: ${(updated.text || draft.text || '').slice(0, 80)}`,
          desc,
          req.user?.email || null,
          (draft.platforms || []).join(','),
          JSON.stringify({
            simulation_verdict: self_heal?.passed ? 'safe' : 'caution',
            expected_outcome: 'Publish social post after review',
            self_heal_passed: !!self_heal?.passed,
          }),
        ],
      );
      approval_request = r.rows[0];
      await _updateDraft(tid, draft.id, {
        meta: { ...(updated.meta || {}), approval_request_id: approval_request.id },
      });
    } catch (_) { /* table may not exist yet */ }
  }

  res.json({ ok: true, draft: updated, approval_request, self_heal });
}));

router.post('/:id/self-heal', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:self-heal');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');
  if (draft.status === 'pending_approval') {
    return _err(res, 400, 'Withdraw approval before self-heal, or heal before submit.');
  }
  const { selfHealDraft } = require('./self_heal');
  const result = await selfHealDraft(tid, draft.text || '', { maxAttempts: Number(req.body?.max_attempts) || 3 });
  const updated = await _updateDraft(tid, draft.id, {
    text: result.text,
    meta: {
      ...(draft.meta || {}),
      self_heal: {
        healed: result.text !== draft.text,
        passed: result.passed,
        final_verdict: result.final_verdict,
        attempts: result.attempts,
        at: new Date().toISOString(),
      },
      original_text: draft.meta?.original_text || draft.text,
    },
  });
  res.json({ ok: true, draft: updated, self_heal: result });
}));

router.post('/:id/withdraw-approval', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:withdraw');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');
  if (draft.status !== 'pending_approval') return _err(res, 400, 'not pending approval');
  const updated = await _updateDraft(tid, draft.id, {
    status: 'draft',
    meta: { ...(draft.meta || {}), withdrawn_at: new Date().toISOString() },
  });
  res.json({ ok: true, draft: updated });
}));

router.post('/:id/approve', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:approve');
  if (!tid) return _err(res, 400, 'no_tenant');
  const result = await _approveAndPublish(tid, req.params.id, { notes: req.body?.notes || null, skipZernio: !!req.body?.skip_publish });
  if (!result.ok) {
    const code = result.error === 'delivery_unknown' ? 409 : 400;
    return res.status(code).json({ ok: false, error: result.error, draft: result.draft || undefined });
  }
  res.json(result);
}));

router.post('/:id/reject', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:reject');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _rejectDraft(tid, req.params.id, req.body?.notes || null);
  if (!draft) return _err(res, 404, 'not found');
  res.json({ ok: true, draft });
}));

async function _executePublishDraft(tid, draftId, opts = {}) {
  const updateDraft = module.exports._updateDraft || _updateDraft;
  const mode = opts.mode || 'approval';
  const draft = await _getDraft(tid, draftId);
  if (!draft) return { ok: false, error: 'not found' };

  const resolveSettings = module.exports._resolveSettings || _resolveSettings;
  const resolved = await resolveSettings(tid);
  if (!resolved.ok) {
    return { ok: false, error: 'settings_unavailable', draft };
  }
  const requireApproval = !!resolved.settings.require_approval;
  const authz = _publishApproval.evaluatePublishAuthorization({
    requireApproval,
    draft,
    mode,
  });
  if (!authz.ok) {
    return {
      ok: false,
      error: authz.error,
      hint: authz.hint,
      draft,
    };
  }

  if (_isDeliveryUnknown(draft)) {
    return { ok: false, error: 'delivery_unknown', draft };
  }
  if (draft.status === 'published' || draft.status === 'scheduled') {
    return { ok: false, error: 'already_published', draft };
  }
  if (draft.meta?.published_at || draft.zernio_post_id) {
    return { ok: false, error: 'already_published', draft };
  }

  if (mode === 'direct') {
    if (draft.status === 'pending_approval') {
      return { ok: false, error: 'pending_approval', draft };
    }
    if (!_claimableStatuses('direct').includes(draft.status)) {
      return { ok: false, error: `cannot publish status "${draft.status}"`, draft };
    }
  } else if (!_claimableStatuses('approval').includes(draft.status)) {
    return { ok: false, error: `cannot approve status "${draft.status}"`, draft };
  }

  if (!draft.platforms?.length) return { ok: false, error: 'no platforms', draft };
  if (!draft.text && !(draft.media_urls || []).length) {
    return { ok: false, error: 'draft has no text or media', draft };
  }

  if (opts.skipZernio || opts.skip_publish) {
    if (mode === 'approval') {
      await updateDraft(tid, draftId, {
        status: 'approved',
        meta: {
          ...(draft.meta || {}),
          ..._publishApproval.recordApprovalMeta(draft, opts.notes || null),
        },
      });
    }
    return { ok: true, draft: await _getDraft(tid, draftId), published: false };
  }

  return await _withDraftPublishLock(tid, draftId, async () => {
    const claim = await _claimPublishing(tid, draftId, { mode });
    if (!claim.ok) {
      if (claim.error === 'publish_in_progress') {
        const after = await _getDraft(tid, draftId);
        if (after?.meta?.published_at || after?.zernio_post_id || after?.status === 'published' || after?.status === 'scheduled') {
          return { ok: true, draft: after, published: true, already_published: true };
        }
        return { ok: false, error: 'publish_in_progress', draft: claim.draft };
      }
      return claim;
    }

    const token = claim.token;
    const claimedAuthz = _publishApproval.evaluateClaimedAuthorization({
      requireApproval,
      claimed: claim.draft,
      mode,
    });
    if (!claimedAuthz.ok) {
      const released = await _releasePublishingClaim(tid, draftId, token);
      return { ok: false, error: claimedAuthz.error, hint: claimedAuthz.hint, draft: released || claim.draft };
    }

    const approvedMeta = {
      ...(claim.draft.meta || {}),
      publishing_claim: token,
      publishing_claim_at: claim.draft.meta?.publishing_claim_at || new Date().toISOString(),
    };
    if (mode === 'approval') {
      Object.assign(approvedMeta, _publishApproval.recordApprovalMeta(claim.draft, opts.notes || null));
    }
    let fresh = await updateDraft(tid, draftId, {
      status: mode === 'approval' ? 'approved' : claim.draft.status,
      meta: approvedMeta,
    });

    if (_publishApproval.materialFieldsChanged(claim.draft, fresh)) {
      const released = await _releasePublishingClaim(tid, draftId, token);
      return { ok: false, error: 'approval_stale', draft: released || fresh };
    }
    const freshAuthz = _publishApproval.evaluateClaimedAuthorization({
      requireApproval,
      claimed: fresh,
      mode,
    });
    if (!freshAuthz.ok) {
      const released = await _releasePublishingClaim(tid, draftId, token);
      return { ok: false, error: freshAuthz.error, hint: freshAuthz.hint, draft: released || fresh };
    }

    const publishFn = module.exports._publishViaZernio || _publishViaZernio;
    const result = await publishFn(opts.req || {}, fresh);
    const classified = _classifyPublishResult(result);

    if (classified.outcome === 'success') {
      const zid = result.post?._id || result.post?.id || null;
      const nextStatus = fresh.scheduled_for ? 'scheduled' : 'published';
      try {
        const updated = await updateDraft(tid, draftId, {
          status: nextStatus,
          zernio_post_id: zid ? String(zid) : null,
          meta: {
            ..._stripPublishingClaim(fresh.meta || {}),
            published_at: new Date().toISOString(),
            published_via: mode === 'approval' ? 'approval' : 'direct',
          },
        });
        try {
          const wf = require('../social_workflows/api');
          if (typeof wf._onSocialPublished === 'function') wf._onSocialPublished(tid, updated).catch(() => {});
        } catch (_) {}
        return { ok: true, draft: updated, post: result.post, published: true };
      } catch (persistErr) {
        const uncertain = await updateDraft(tid, draftId, {
          status: 'delivery_unknown',
          meta: {
            ...(fresh.meta || {}),
            delivery_outcome: 'unknown',
            delivery_uncertain_at: new Date().toISOString(),
            provider_accepted_at: new Date().toISOString(),
            provider_post_id: zid ? String(zid) : null,
            last_publish_error: `persist_failed: ${persistErr.message}`,
            last_publish_attempt_at: new Date().toISOString(),
          },
        });
        return {
          ok: false,
          error: 'delivery_unknown',
          uncertain: true,
          draft: uncertain || fresh,
        };
      }
    }

    if (classified.outcome === 'uncertain') {
      const uncertain = await updateDraft(tid, draftId, {
        status: 'delivery_unknown',
        meta: {
          ...(fresh.meta || {}),
          delivery_outcome: 'unknown',
          delivery_uncertain_at: new Date().toISOString(),
          last_publish_error: classified.error,
          last_publish_attempt_at: new Date().toISOString(),
        },
      });
      return { ok: false, error: 'delivery_unknown', uncertain: true, draft: uncertain };
    }

    const failed = await updateDraft(tid, draftId, {
      status: 'failed',
      meta: _stripPublishingClaim({
        ...(fresh.meta || {}),
        last_error: classified.error,
        last_publish_attempt_at: new Date().toISOString(),
      }),
    });
    return { ok: false, error: classified.error, draft: failed };
  });
}

async function _approveAndPublish(tid, draftId, opts = {}) {
  return await _executePublishDraft(tid, draftId, { ...opts, mode: 'approval' });
}

async function _rejectDraft(tid, draftId, notes) {
  const draft = await _getDraft(tid, draftId);
  if (!draft) return null;
  return await _updateDraft(tid, draftId, {
    status: 'draft',
    meta: {
      ...(draft.meta || {}),
      rejected_at: new Date().toISOString(),
      reviewer_notes: notes || null,
    },
  });
}

router.delete('/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');

  // Best-effort cancel on Zernio if we have a scheduled post id
  if (draft.zernio_post_id && process.env.ZERNIO_API_KEY && !/^_DUMMY/i.test(process.env.ZERNIO_API_KEY)) {
    try {
      const https = require('https');
      await new Promise((resolve) => {
        const r = https.request({
          hostname: 'zernio.com',
          path: `/api/v1/posts/${encodeURIComponent(draft.zernio_post_id)}`,
          method: 'DELETE',
          headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` },
        }, (resp) => { resp.resume(); resp.on('end', resolve); });
        r.on('error', () => resolve());
        r.setTimeout(10000, () => { r.destroy(); resolve(); });
        r.end();
      });
    } catch (_) { /* non-fatal */ }
  }

  const ok = await _deleteDraft(tid, req.params.id);
  res.json({ ok });
}));

// Test helpers + cross-module hooks
router._mem = _mem;
router._resetMem = () => { _mem.clear(); _memSeq = 1; _settings.clear(); _publishLockChains.clear(); };
router._listForTenant = (tid) => _memList(tid).map((r) => ({ ...r }));
router._createForTenant = async (tid, fields) => _insertDraft(tid, fields);
router._approveAndPublish = _approveAndPublish;
router._executePublishDraft = _executePublishDraft;
router._publishViaZernio = _publishViaZernio;
router._claimPublishing = _claimPublishing;
router._classifyPublishResult = _classifyPublishResult;
router._withDraftPublishLock = _withDraftPublishLock;
router._publishLockChainSize = () => _publishLockChains.size;
router._rejectDraft = _rejectDraft;
router._getDraft = _getDraft;
router._insertDraft = _insertDraft;
router._insertDraftsBulk = _insertDraftsBulk;
router._updateDraft = _updateDraft;
router._updateUserDraft = _updateUserDraft;
router._releasePublishingClaim = _releasePublishingClaim;
router._getSettings = _getSettings;
router._setSettings = _setSettings;
router._resolveSettings = _resolveSettings;

module.exports = router;
