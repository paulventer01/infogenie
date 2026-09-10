'use strict';

const express = require('express');
const _db = require('../../db');
const { createRateLimiter } = require('../security/rate_limit');
const _audit = require('../admin/audit');
const portal = require('./portal');
const router = express.Router();

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
