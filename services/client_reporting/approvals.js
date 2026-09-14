'use strict';

const crypto = require('node:crypto');
const snapshot = require('./snapshot');

const STATUSES = new Set(['pending', 'approved', 'changes_requested', 'withdrawn']);
const COMMENT_MAX = 4000;
const COMMENT_MIN = 1;
const PREVIEW_TTL_HOURS = 24;
const HASH_RE = /^[0-9a-f]{64}$/;

function fail(status, code) { return Object.assign(new Error(code), { status }); }

function hashSnapshot(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function validContentHash(value) {
  return typeof value === 'string' && HASH_RE.test(value);
}

function validSnapshotId(value) {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value);
  return Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

function snapshotIdValue(value) {
  if (!validSnapshotId(value)) return null;
  return typeof value === 'string' ? Number(value) : value;
}

function sanitizeComment(value) {
  if (typeof value !== 'string') throw fail(400, 'invalid_approval');
  const body = value.replace(/\r\n/g, '\n').trim();
  if (body.length < COMMENT_MIN || body.length > COMMENT_MAX) throw fail(400, 'invalid_approval');
  return body;
}

function periodBounds(dateRange) {
  return {
    periodStart: dateRange?.startDate || null,
    periodEnd: dateRange?.endDate || null,
  };
}

function reportingPeriodKey(profile, dateRange) {
  return dateRange?.periodKey === 'custom' ? 'custom' : (profile.reporting_period || 'all_time');
}

function assertApprovalBinding(request, binding) {
  const snapshotId = snapshotIdValue(binding?.snapshot_id);
  if (!binding || snapshotId === null || !validContentHash(binding.content_hash)) {
    throw fail(400, 'invalid_approval');
  }
  if (Number(request.snapshot.id) !== snapshotId || request.snapshot.content_hash !== binding.content_hash) {
    throw fail(409, 'approval_stale');
  }
}

function serializeSnapshot(row) {
  return {
    id: Number(row.snapshot_id || row.id),
    submission_number: row.submission_number,
    profile_version: row.profile_version,
    reporting_period: row.reporting_period,
    reporting_timezone: row.reporting_timezone,
    period_start: row.period_start,
    period_end: row.period_end,
    selected_metrics: row.selected_metrics,
    content_hash: row.content_hash,
    created_at: row.created_at,
    created_by_user_id: row.created_by_user_id || null,
  };
}

function serializeRequest(row, includeSnapshot = false) {
  const request = {
    id: Number(row.request_id || row.id),
    status: row.status,
    submitted_at: row.submitted_at,
    submitted_by_user_id: row.submitted_by_user_id || null,
    decided_at: row.decided_at || null,
    decision_actor_type: row.decision_actor_type || null,
    decision_comment: row.decision_comment || null,
    withdrawn_at: row.withdrawn_at || null,
    withdrawn_by_user_id: row.withdrawn_by_user_id || null,
    snapshot: serializeSnapshot(row),
  };
  if (includeSnapshot) request.snapshot_payload = row.snapshot_json;
  return request;
}

function approvalBinding(request) {
  if (!request || request.status !== 'pending') return null;
  return {
    request_id: Number(request.id),
    snapshot_id: Number(request.snapshot.id),
    content_hash: request.snapshot.content_hash,
    status: request.status,
  };
}

const REQUEST_COLUMNS = `r.id AS request_id, r.status, r.submitted_at, r.submitted_by_user_id,
  r.decided_at, r.decision_actor_type, r.decision_comment, r.withdrawn_at, r.withdrawn_by_user_id,
  s.id AS snapshot_id, s.submission_number, s.profile_version, s.reporting_period, s.reporting_timezone,
  s.period_start, s.period_end, s.selected_metrics, s.content_hash, s.created_at, s.created_by_user_id`;

async function nextSubmissionNumber(db, tenantId, clientId) {
  const { rows } = await db.query(`SELECT COALESCE(MAX(submission_number), 0) + 1 AS next
    FROM client_reporting_approval_snapshots WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
  return rows[0].next;
}

async function registerPreview(db, tenantId, clientId, userId, built) {
  const contentHash = hashSnapshot(built.snapshot);
  const { periodStart, periodEnd } = periodBounds(built.dateRange);
  const reportingPeriod = reportingPeriodKey(built.profile, built.dateRange);
  await db.query(`INSERT INTO client_reporting_approval_previews
    (tenant_id, client_id, user_id, profile_version, reporting_period, reporting_timezone,
     period_start, period_end, selected_metrics, snapshot_json, content_hash, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11, now() + ($12 || ' hours')::interval)
    ON CONFLICT (tenant_id, client_id, user_id) DO UPDATE SET
      profile_version=EXCLUDED.profile_version, reporting_period=EXCLUDED.reporting_period,
      reporting_timezone=EXCLUDED.reporting_timezone, period_start=EXCLUDED.period_start,
      period_end=EXCLUDED.period_end, selected_metrics=EXCLUDED.selected_metrics,
      snapshot_json=EXCLUDED.snapshot_json, content_hash=EXCLUDED.content_hash,
      created_at=now(), expires_at=EXCLUDED.expires_at`,
    [tenantId, clientId, userId, built.profile.version, reportingPeriod, built.profile.reporting_timezone,
      periodStart, periodEnd, JSON.stringify(built.selectedMetrics), JSON.stringify(built.snapshot),
      contentHash, String(PREVIEW_TTL_HOURS)]);
  return contentHash;
}

async function loadPreview(db, tenantId, clientId, userId, contentHash) {
  if (!validContentHash(contentHash)) throw fail(400, 'invalid_approval');
  const { rows } = await db.query(`SELECT profile_version, reporting_period, reporting_timezone,
      period_start, period_end, selected_metrics, snapshot_json, content_hash
    FROM client_reporting_approval_previews
    WHERE tenant_id=$1 AND client_id=$2 AND user_id=$3 AND content_hash=$4 AND expires_at > now()`,
    [tenantId, clientId, userId, contentHash]);
  if (!rows[0]) throw fail(409, 'preview_stale');
  const { rows: profileRows } = await db.query(`SELECT version FROM client_reporting_profiles
    WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
  if (!profileRows[0] || profileRows[0].version !== rows[0].profile_version) throw fail(409, 'preview_stale');
  return rows[0];
}

async function getPendingRequest(db, tenantId, clientId, lock = false) {
  const { rows } = await db.query(`SELECT ${REQUEST_COLUMNS}, s.snapshot_json
    FROM client_reporting_approval_requests r
    JOIN client_reporting_approval_snapshots s ON s.id = r.snapshot_id
    WHERE r.tenant_id=$1 AND r.client_id=$2 AND r.status='pending'${lock ? ' FOR UPDATE OF r' : ''}`,
    [tenantId, clientId]);
  return rows[0] ? serializeRequest(rows[0], true) : null;
}

async function getRequestById(db, tenantId, clientId, requestId, lock = false, includePayload = false) {
  const { rows } = await db.query(`SELECT ${REQUEST_COLUMNS}${includePayload ? ', s.snapshot_json' : ''}
    FROM client_reporting_approval_requests r
    JOIN client_reporting_approval_snapshots s ON s.id = r.snapshot_id
    WHERE r.tenant_id=$1 AND r.client_id=$2 AND r.id=$3${lock ? ' FOR UPDATE OF r' : ''}`,
    [tenantId, clientId, requestId]);
  if (!rows[0]) throw fail(404, 'approval_not_found');
  return serializeRequest(rows[0], includePayload);
}

async function listRequests(db, tenantId, clientId, limit = 50) {
  const { rows } = await db.query(`SELECT ${REQUEST_COLUMNS}
    FROM client_reporting_approval_requests r
    JOIN client_reporting_approval_snapshots s ON s.id = r.snapshot_id
    WHERE r.tenant_id=$1 AND r.client_id=$2
    ORDER BY r.submitted_at DESC, r.id DESC LIMIT $3`, [tenantId, clientId, limit]);
  return rows.map((row) => serializeRequest(row));
}

async function createSubmission(db, tenantId, clientId, userId, contentHash) {
  const preview = await loadPreview(db, tenantId, clientId, userId, contentHash);
  const snapshotPayload = preview.snapshot_json;
  if (!snapshotPayload?.can_generate) throw fail(409, 'no_mapped_records');
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    const pending = await getPendingRequest(connection, tenantId, clientId, true);
    if (pending) throw fail(409, 'approval_pending');
    const submissionNumber = await nextSubmissionNumber(connection, tenantId, clientId);
    const snap = await connection.query(`INSERT INTO client_reporting_approval_snapshots
      (tenant_id, client_id, submission_number, profile_version, reporting_period, reporting_timezone,
       period_start, period_end, selected_metrics, snapshot_json, content_hash, created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
      RETURNING id, submission_number, profile_version, reporting_period, reporting_timezone,
        period_start, period_end, selected_metrics, content_hash, created_at, created_by_user_id`,
      [tenantId, clientId, submissionNumber, preview.profile_version, preview.reporting_period,
        preview.reporting_timezone, preview.period_start, preview.period_end,
        JSON.stringify(preview.selected_metrics), JSON.stringify(snapshotPayload), preview.content_hash, userId]);
    const request = await connection.query(`INSERT INTO client_reporting_approval_requests
      (tenant_id, client_id, snapshot_id, status, submitted_by_user_id)
      VALUES ($1,$2,$3,'pending',$4)
      RETURNING id, status, submitted_at, submitted_by_user_id, decided_at, decision_actor_type,
        decision_comment, withdrawn_at, withdrawn_by_user_id`,
      [tenantId, clientId, snap.rows[0].id, userId]);
    if (owned) await connection.query('COMMIT');
    const row = {
      request_id: request.rows[0].id,
      status: request.rows[0].status,
      submitted_at: request.rows[0].submitted_at,
      submitted_by_user_id: request.rows[0].submitted_by_user_id,
      decided_at: request.rows[0].decided_at,
      decision_actor_type: request.rows[0].decision_actor_type,
      decision_comment: request.rows[0].decision_comment,
      withdrawn_at: request.rows[0].withdrawn_at,
      withdrawn_by_user_id: request.rows[0].withdrawn_by_user_id,
      snapshot_id: snap.rows[0].id,
      submission_number: snap.rows[0].submission_number,
      profile_version: snap.rows[0].profile_version,
      reporting_period: snap.rows[0].reporting_period,
      reporting_timezone: snap.rows[0].reporting_timezone,
      period_start: snap.rows[0].period_start,
      period_end: snap.rows[0].period_end,
      selected_metrics: snap.rows[0].selected_metrics,
      content_hash: snap.rows[0].content_hash,
      created_at: snap.rows[0].created_at,
      created_by_user_id: snap.rows[0].created_by_user_id,
      snapshot_json: snapshotPayload,
    };
    return serializeRequest(row, true);
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

async function withdrawRequest(db, tenantId, clientId, requestId, userId) {
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    const request = await getRequestById(connection, tenantId, clientId, requestId, true);
    if (request.status !== 'pending') throw fail(409, 'approval_not_pending');
    const updated = await connection.query(`UPDATE client_reporting_approval_requests
      SET status='withdrawn', withdrawn_at=now(), withdrawn_by_user_id=$4
      WHERE tenant_id=$1 AND client_id=$2 AND id=$3 AND status='pending'
      RETURNING id, status, submitted_at, submitted_by_user_id, decided_at, decision_actor_type,
        decision_comment, withdrawn_at, withdrawn_by_user_id`,
      [tenantId, clientId, requestId, userId]);
    if (!updated.rows[0]) throw fail(409, 'approval_not_pending');
    if (owned) await connection.query('COMMIT');
    return getRequestById(db, tenantId, clientId, requestId);
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

async function approveRequest(db, tenantId, clientId, requestId, binding) {
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    const request = await getRequestById(connection, tenantId, clientId, requestId, true);
    if (request.status !== 'pending') throw fail(409, 'approval_not_pending');
    assertApprovalBinding(request, binding);
    const updated = await connection.query(`UPDATE client_reporting_approval_requests
      SET status='approved', decided_at=now(), decision_actor_type='portal_client', decision_comment=NULL
      WHERE tenant_id=$1 AND client_id=$2 AND id=$3 AND status='pending'
      RETURNING id`, [tenantId, clientId, requestId]);
    if (!updated.rows[0]) throw fail(409, 'approval_not_pending');
    if (owned) await connection.query('COMMIT');
    return getRequestById(db, tenantId, clientId, requestId);
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

async function requestChanges(db, tenantId, clientId, requestId, comment, binding) {
  const text = sanitizeComment(comment);
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    const request = await getRequestById(connection, tenantId, clientId, requestId, true);
    if (request.status !== 'pending') throw fail(409, 'approval_not_pending');
    assertApprovalBinding(request, binding);
    const updated = await connection.query(`UPDATE client_reporting_approval_requests
      SET status='changes_requested', decided_at=now(), decision_actor_type='portal_client', decision_comment=$4
      WHERE tenant_id=$1 AND client_id=$2 AND id=$3 AND status='pending'
      RETURNING id`, [tenantId, clientId, requestId, text]);
    if (!updated.rows[0]) throw fail(409, 'approval_not_pending');
    if (owned) await connection.query('COMMIT');
    return getRequestById(db, tenantId, clientId, requestId);
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

module.exports = {
  STATUSES, COMMENT_MAX, COMMENT_MIN, PREVIEW_TTL_HOURS, validContentHash, validSnapshotId, snapshotIdValue,
  registerPreview, loadPreview, createSubmission, withdrawRequest, approveRequest, requestChanges,
  getPendingRequest, getRequestById, listRequests, approvalBinding, hashSnapshot,
};
