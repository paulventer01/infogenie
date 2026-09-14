'use strict';

const { RELATIVE_PERIODS, validateCustomRange } = require('./period');
const snapshot = require('./snapshot');

const BODY_MAX = 4000;
const BODY_MIN = 1;
const THREAD_KINDS = new Set(['comment', 'change_request']);
const FEEDBACK_QUERY_KEYS = new Set([
  'profile_version', 'reporting_period', 'timezone', 'start_date', 'end_date',
]);

function fail(status, code) { return Object.assign(new Error(code), { status }); }

function parseProfileVersion(value) {
  if (value === undefined || value === null || value === '') return null;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw fail(400, 'invalid_feedback');
  return version;
}

function parseReportingPeriod(value) {
  if (typeof value !== 'string' || !value) throw fail(400, 'invalid_feedback');
  if (value === 'custom' || RELATIVE_PERIODS.has(value)) return value;
  throw fail(400, 'invalid_feedback');
}

function parseTimezone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) throw fail(400, 'invalid_feedback');
  return value;
}

function pinnedDatesFromInput(input) {
  const hasStart = Object.hasOwn(input, 'start_date');
  const hasEnd = Object.hasOwn(input, 'end_date');
  if (hasStart !== hasEnd) throw fail(400, 'invalid_feedback');
  if (!hasStart) return null;
  if (typeof input.start_date !== 'string' || typeof input.end_date !== 'string') throw fail(400, 'invalid_feedback');
  return { startDate: input.start_date, endDate: input.end_date };
}

function resolvePinnedDateRange(reportingPeriod, timezone, pinnedDates) {
  if (reportingPeriod === 'all_time') {
    if (pinnedDates) throw fail(400, 'invalid_feedback');
    return {
      periodKey: 'all_time', timezone, startDate: null, endDate: null, exclusiveEnd: null,
      startUtc: null, endUtc: null,
    };
  }
  if (!pinnedDates) throw fail(400, 'invalid_feedback');
  return validateCustomRange(pinnedDates.startDate, pinnedDates.endDate, timezone);
}

function parseReportContext(input, { query = false } = {}) {
  if (!input || typeof input !== 'object') throw fail(400, 'invalid_feedback');
  if (query && Object.keys(input).some((key) => !FEEDBACK_QUERY_KEYS.has(key))) throw fail(400, 'invalid_feedback');
  const profileVersion = parseProfileVersion(input.profile_version);
  if (profileVersion === null) throw fail(400, 'invalid_feedback');
  const reportingPeriod = parseReportingPeriod(input.reporting_period);
  const timezone = parseTimezone(input.timezone);
  const pinnedDates = pinnedDatesFromInput(input);
  const dateRange = resolvePinnedDateRange(reportingPeriod, timezone, pinnedDates);
  return { profileVersion, reportingPeriod, timezone, dateRange };
}

function periodBounds(dateRange) {
  return {
    periodStart: dateRange.startDate || null,
    periodEnd: dateRange.endDate || null,
  };
}

function contextWhere(context, start = 1) {
  const { periodStart, periodEnd } = periodBounds(context.dateRange);
  const params = [context.profileVersion, context.reportingPeriod, context.timezone, periodStart, periodEnd];
  const clause = `profile_version=$${start} AND reporting_period=$${start + 1} AND reporting_timezone=$${start + 2}
    AND period_start IS NOT DISTINCT FROM $${start + 3}::date AND period_end IS NOT DISTINCT FROM $${start + 4}::date`;
  return { clause, params };
}

async function loadProfile(db, tenantId, clientId) {
  const { rows } = await db.query(`SELECT report_source, selected_metrics, reporting_period, reporting_timezone, version
    FROM client_reporting_profiles WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
  if (!rows[0]) throw fail(409, 'profile_required');
  return rows[0];
}

async function assertCurrentReportContext(db, tenantId, clientId, context) {
  const profile = await loadProfile(db, tenantId, clientId);
  if (profile.version !== context.profileVersion) throw fail(409, 'report_context_stale');
  if (profile.reporting_period !== context.reportingPeriod) throw fail(409, 'report_context_stale');
  if (profile.reporting_timezone !== context.timezone) throw fail(409, 'report_context_stale');
  const currentRange = snapshot.resolveDateRange(profile, null);
  const { periodStart, periodEnd } = periodBounds(context.dateRange);
  const currentStart = currentRange.startDate || null;
  const currentEnd = currentRange.endDate || null;
  if (periodStart !== currentStart || periodEnd !== currentEnd) throw fail(409, 'report_context_stale');
  return profile;
}

function sanitizeBody(value) {
  if (typeof value !== 'string') throw fail(400, 'invalid_feedback');
  const body = value.replace(/\r\n/g, '\n').trim();
  if (body.length < BODY_MIN || body.length > BODY_MAX) throw fail(400, 'invalid_feedback');
  return body;
}

function serializeMessage(row) {
  return {
    id: row.id,
    author_type: row.author_type,
    author_user_id: row.author_user_id || null,
    body: row.body,
    created_at: row.created_at,
  };
}

function serializeThread(row, messages) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    profile_version: row.profile_version,
    reporting_period: row.reporting_period,
    reporting_timezone: row.reporting_timezone,
    period_start: row.period_start,
    period_end: row.period_end,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolved_by_user_id: row.resolved_by_user_id || null,
    messages,
  };
}

function threadKey(id) {
  const key = Number(id);
  if (!Number.isInteger(key) || key < 1) throw fail(400, 'invalid_feedback');
  return key;
}

async function fetchThreadMessages(db, threadIds) {
  if (!threadIds.length) return new Map();
  const ids = threadIds.map(threadKey);
  const { rows } = await db.query(`SELECT id, thread_id, author_type, author_user_id, body, created_at
    FROM client_reporting_portal_feedback_messages WHERE thread_id = ANY($1::bigint[])
    ORDER BY created_at ASC, id ASC`, [ids]);
  const grouped = new Map();
  for (const row of rows) {
    const key = threadKey(row.thread_id);
    const list = grouped.get(key) || [];
    list.push(serializeMessage(row));
    grouped.set(key, list);
  }
  return grouped;
}

async function listThreads(db, tenantId, clientId, context) {
  const { clause, params } = contextWhere(context, 3);
  const { rows } = await db.query(`SELECT id, kind, status, profile_version, reporting_period, reporting_timezone,
      period_start, period_end, created_at, resolved_at, resolved_by_user_id
    FROM client_reporting_portal_feedback_threads
    WHERE tenant_id=$1 AND client_id=$2 AND ${clause}
    ORDER BY created_at ASC, id ASC`, [tenantId, clientId, ...params]);
  const messages = await fetchThreadMessages(db, rows.map((row) => threadKey(row.id)));
  return rows.map((row) => serializeThread(row, messages.get(threadKey(row.id)) || []));
}

async function listThreadsForClient(db, tenantId, clientId, context = null) {
  if (context) return listThreads(db, tenantId, clientId, context);
  const { rows } = await db.query(`SELECT id, kind, status, profile_version, reporting_period, reporting_timezone,
      period_start, period_end, created_at, resolved_at, resolved_by_user_id
    FROM client_reporting_portal_feedback_threads
    WHERE tenant_id=$1 AND client_id=$2
    ORDER BY created_at DESC, id DESC LIMIT 200`, [tenantId, clientId]);
  const messages = await fetchThreadMessages(db, rows.map((row) => threadKey(row.id)));
  return rows.map((row) => serializeThread(row, messages.get(threadKey(row.id)) || []));
}

async function getThread(db, tenantId, clientId, threadId, lock = false) {
  const { rows } = await db.query(`SELECT id, kind, status, profile_version, reporting_period, reporting_timezone,
      period_start, period_end, created_at, resolved_at, resolved_by_user_id
    FROM client_reporting_portal_feedback_threads
    WHERE tenant_id=$1 AND client_id=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`, [tenantId, clientId, threadId]);
  if (!rows[0]) throw fail(404, 'thread_not_found');
  return rows[0];
}

async function createThread(db, tenantId, clientId, { kind, body, context }) {
  if (!THREAD_KINDS.has(kind)) throw fail(400, 'invalid_feedback');
  const text = sanitizeBody(body);
  await assertCurrentReportContext(db, tenantId, clientId, context);
  const { periodStart, periodEnd } = periodBounds(context.dateRange);
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    const thread = await connection.query(`INSERT INTO client_reporting_portal_feedback_threads
      (tenant_id, client_id, kind, status, profile_version, reporting_period, reporting_timezone, period_start, period_end)
      VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8)
      RETURNING id, kind, status, profile_version, reporting_period, reporting_timezone, period_start, period_end,
        created_at, resolved_at, resolved_by_user_id`, [
      tenantId, clientId, kind, context.profileVersion, context.reportingPeriod, context.timezone, periodStart, periodEnd,
    ]);
    const message = await connection.query(`INSERT INTO client_reporting_portal_feedback_messages
      (thread_id, tenant_id, client_id, author_type, author_user_id, body)
      VALUES ($1,$2,$3,'client',NULL,$4)
      RETURNING id, author_type, author_user_id, body, created_at`, [thread.rows[0].id, tenantId, clientId, text]);
    if (owned) await connection.query('COMMIT');
    return serializeThread(thread.rows[0], [serializeMessage(message.rows[0])]);
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

async function addReply(db, tenantId, clientId, threadId, authorType, userId, body) {
  if (authorType !== 'client' && authorType !== 'agency') throw fail(400, 'invalid_feedback');
  const text = sanitizeBody(body);
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    const thread = await getThread(connection, tenantId, clientId, threadId, true);
    if (thread.status === 'resolved' && authorType === 'client') throw fail(409, 'thread_resolved');
    const message = await connection.query(`INSERT INTO client_reporting_portal_feedback_messages
      (thread_id, tenant_id, client_id, author_type, author_user_id, body)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, author_type, author_user_id, body, created_at`, [
      threadId, tenantId, clientId, authorType, authorType === 'agency' ? userId : null, text,
    ]);
    if (owned) await connection.query('COMMIT');
    const key = threadKey(threadId);
    const messages = await fetchThreadMessages(db, [key]);
    return serializeThread(thread, messages.get(key) || [serializeMessage(message.rows[0])]);
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

async function resolveThread(db, tenantId, clientId, threadId, userId) {
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    const thread = await getThread(connection, tenantId, clientId, threadId, true);
    if (thread.kind !== 'change_request') throw fail(400, 'invalid_feedback');
    if (thread.status === 'resolved') throw fail(409, 'thread_resolved');
    const updated = await connection.query(`UPDATE client_reporting_portal_feedback_threads
      SET status='resolved', resolved_at=now(), resolved_by_user_id=$4, updated_at=now()
      WHERE tenant_id=$1 AND client_id=$2 AND id=$3
      RETURNING id, kind, status, profile_version, reporting_period, reporting_timezone, period_start, period_end,
        created_at, resolved_at, resolved_by_user_id`, [tenantId, clientId, threadId, userId]);
    if (owned) await connection.query('COMMIT');
    const key = threadKey(threadId);
    const messages = await fetchThreadMessages(db, [key]);
    return serializeThread(updated.rows[0], messages.get(key) || []);
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

module.exports = {
  BODY_MAX, BODY_MIN, THREAD_KINDS, parseReportContext, sanitizeBody, listThreads, listThreadsForClient,
  createThread, addReply, resolveThread, assertCurrentReportContext,
};
