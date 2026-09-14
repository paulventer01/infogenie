'use strict';

const express = require('express');
const _db = require('../../db');
const { createRateLimiter } = require('../security/rate_limit');
const _audit = require('../admin/audit');
const portal = require('./portal');
const drilldown = require('./drilldown');
const feedback = require('./feedback');
const { portalCsrfGuard } = require('./portal_csrf');
const router = express.Router();

router.use(portalCsrfGuard);

function fail(status, code) { return Object.assign(new Error(code), { status }); }
function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    const status = error.status || 500;
    if (!res.headersSent) res.status(status).json({ ok: false, error: status >= 500 ? 'internal_error' : error.message });
  });
}

const redeemLimiter = createRateLimiter({
  name: 'client-reporting-portal-redeem', windowMs: 60_000, max: 20, failClosed: true,
  keyFn: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
});
const readLimiter = createRateLimiter({
  name: 'client-reporting-portal-read', windowMs: 60_000, max: 120, failClosed: true,
  keyFn: (req) => req.portalContext ? `portal|${req.portalContext.tenantId}|${req.portalContext.clientId}` : null,
});
const writeLimiter = createRateLimiter({
  name: 'client-reporting-portal-write', windowMs: 60_000, max: 30, failClosed: true,
  keyFn: (req) => req.portalContext ? `portal-write|${req.portalContext.tenantId}|${req.portalContext.clientId}` : null,
});

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

async function requirePortalSession(req, res, next) {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'database_unavailable' });
  const token = portal.readSessionToken(req);
  if (!token) return res.status(401).json({ ok: false, error: 'portal_auth_required' });
  try {
    req.portalContext = await portal.resolveSession(_db.getPool(), token);
    res.setHeader('Cache-Control', 'no-store');
    return next();
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: status >= 500 ? 'internal_error' : error.message });
  }
}

router.post('/redeem/:token', redeemLimiter, safe(async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'database_unavailable' });
  const redeemed = await portal.redeemInvitation(_db.getPool(), req.params.token);
  portal.setSessionCookie(res, redeemed.sessionToken);
  await _audit.recordAudit({
    action: 'client_reporting.portal_redeem', tenantId: redeemed.session.tenant_id,
    detail: `Client ${redeemed.session.client_id} portal invitation redeemed`,
    context: { client_id: redeemed.session.client_id, invitation_id: redeemed.invitationId, session_id: redeemed.session.id },
  });
  return res.json({ ok: true, client_id: redeemed.session.client_id, expires_at: redeemed.session.expires_at });
}));

router.get('/metric-drilldown/:metricKey', requirePortalSession, readLimiter, safe(async (req, res) => {
  const { tenantId, clientId, sessionId } = req.portalContext;
  const { cursor, limit, currency, profileVersion, dateRange } = drilldown.parseDrilldownQuery(req.query);
  const connection = await _db.getPool().connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await drilldown.fetchDrilldown(connection, tenantId, clientId, req.params.metricKey,
      { cursor, limit, currency, profileVersion, dateRange });
    await connection.query('COMMIT');
    await _audit.recordAudit({
      action: 'client_reporting.portal_drilldown', tenantId,
      detail: `Client ${clientId} portal metric drilldown ${req.params.metricKey}`,
      context: { client_id: clientId, session_id: sessionId, metric: req.params.metricKey, currency },
    });
    return res.json(result);
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}));

router.get('/report', requirePortalSession, readLimiter, safe(async (req, res) => {
  const { tenantId, clientId, sessionId } = req.portalContext;
  const snapshot = await portal.buildPortalReport(_db.getPool(), tenantId, clientId);
  await _audit.recordAudit({
    action: 'client_reporting.portal_view', tenantId,
    detail: `Client ${clientId} portal report viewed`,
    context: { client_id: clientId, session_id: sessionId, profile_version: snapshot.profile_version },
  });
  return res.json(snapshot);
}));

router.get('/feedback/threads', requirePortalSession, readLimiter, safe(async (req, res) => {
  const { tenantId, clientId, sessionId } = req.portalContext;
  const context = feedback.parseReportContext(req.query, { query: true });
  const threads = await feedback.listThreads(_db.getPool(), tenantId, clientId, context);
  await _audit.recordAudit({
    action: 'client_reporting.portal_feedback_view', tenantId,
    detail: `Client ${clientId} portal feedback viewed`,
    context: { client_id: clientId, session_id: sessionId, profile_version: context.profileVersion, count: threads.length },
  });
  return res.json({ ok: true, client_id: clientId, threads });
}));

router.post('/feedback/threads', requirePortalSession, writeLimiter, safe(async (req, res) => {
  const body = req.body;
  const raw = req.rawBody == null ? JSON.stringify(body ?? null) : req.rawBody;
  if (Buffer.byteLength(raw, 'utf8') > 8192 || Object.keys(req.query).length || !object(body)) throw fail(400, 'invalid_feedback');
  const allowed = new Set(['kind', 'body', 'profile_version', 'reporting_period', 'timezone', 'start_date', 'end_date']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw fail(400, 'invalid_feedback');
  const context = feedback.parseReportContext(body);
  const { tenantId, clientId, sessionId } = req.portalContext;
  const thread = await feedback.createThread(_db.getPool(), tenantId, clientId, {
    kind: body.kind, body: body.body, context,
  });
  await _audit.recordAudit({
    action: 'client_reporting.portal_feedback_create', tenantId,
    detail: `Client ${clientId} portal ${body.kind} created`,
    context: { client_id: clientId, session_id: sessionId, thread_id: thread.id, kind: body.kind,
      profile_version: context.profileVersion },
  });
  return res.status(201).json({ ok: true, client_id: clientId, thread });
}));

router.post('/feedback/threads/:threadId/replies', requirePortalSession, writeLimiter, safe(async (req, res) => {
  const body = req.body;
  const raw = req.rawBody == null ? JSON.stringify(body ?? null) : req.rawBody;
  if (Buffer.byteLength(raw, 'utf8') > 8192 || Object.keys(req.query).length || !object(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'body')) {
    throw fail(400, 'invalid_feedback');
  }
  const threadId = Number(req.params.threadId);
  if (!Number.isInteger(threadId) || threadId < 1) throw fail(400, 'invalid_feedback');
  const { tenantId, clientId, sessionId } = req.portalContext;
  const thread = await feedback.addReply(_db.getPool(), tenantId, clientId, threadId, 'client', null, body.body);
  await _audit.recordAudit({
    action: 'client_reporting.portal_feedback_reply', tenantId,
    detail: `Client ${clientId} portal feedback reply`,
    context: { client_id: clientId, session_id: sessionId, thread_id: threadId, author_type: 'client' },
  });
  return res.json({ ok: true, client_id: clientId, thread });
}));

router.get('/delivery-history', requirePortalSession, readLimiter, safe(async (req, res) => {
  const cursor = req.query.cursor === undefined ? 0 : Number(req.query.cursor);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      Object.keys(req.query).some((key) => !['cursor', 'limit'].includes(key))) throw fail(400, 'invalid_pagination');
  const { tenantId, clientId, sessionId } = req.portalContext;
  const history = await portal.portalDeliveryHistory(_db.getPool(), tenantId, clientId, cursor, limit);
  await _audit.recordAudit({
    action: 'client_reporting.portal_history_view', tenantId,
    detail: `Client ${clientId} portal delivery history viewed`,
    context: { client_id: clientId, session_id: sessionId, count: history.deliveries.length },
  });
  return res.json({ ok: true, client_id: clientId, ...history });
}));

module.exports = router;
