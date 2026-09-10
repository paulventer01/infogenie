'use strict';

const crypto = require('node:crypto');
const _snapshot = require('./snapshot');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'infogenie.crp';

function fail(status, code) { return Object.assign(new Error(code), { status }); }

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function sanitizeToken(raw) {
  const token = String(raw || '').replace(/[^a-f0-9]/gi, '');
  return token.length === 64 ? token : null;
}

function mintToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  return { httpOnly: true, sameSite: 'lax', secure, path: '/api/client-reporting/portal', maxAge: SESSION_TTL_MS };
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/api/client-reporting/portal' });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function readSessionToken(req) {
  const cookies = req.cookies || parseCookies(req.headers?.cookie);
  const raw = cookies[COOKIE_NAME];
  return typeof raw === 'string' ? sanitizeToken(raw) : null;
}

async function portalStatus(db, tenantId, clientId) {
  const access = await db.query(`SELECT enabled, revoked_at, created_at, updated_at FROM client_reporting_portal_access
    WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
  const row = access.rows[0];
  const active = !!row && row.enabled && !row.revoked_at;
  const pending = await db.query(`SELECT COUNT(*)::int AS count FROM client_reporting_portal_invitations
    WHERE tenant_id=$1 AND client_id=$2 AND revoked_at IS NULL AND redeemed_at IS NULL AND expires_at > now()`, [tenantId, clientId]);
  const sessions = await db.query(`SELECT COUNT(*)::int AS count FROM client_reporting_portal_sessions
    WHERE tenant_id=$1 AND client_id=$2 AND revoked_at IS NULL AND expires_at > now()`, [tenantId, clientId]);
  return {
    enabled: active,
    revoked_at: row?.revoked_at || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    pending_invitations: pending.rows[0]?.count || 0,
    active_sessions: sessions.rows[0]?.count || 0,
  };
}

async function createInvitation(db, tenantId, clientId, userId) {
  const token = mintToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    await _snapshot.activeClient(connection, tenantId, clientId, true);
    await connection.query(`INSERT INTO client_reporting_portal_access
      (tenant_id, client_id, enabled, revoked_at, created_by_user_id)
      VALUES ($1,$2,true,NULL,$3)
      ON CONFLICT (tenant_id, client_id) DO UPDATE SET enabled=true, revoked_at=NULL,
        updated_by_user_id=EXCLUDED.created_by_user_id, updated_at=now()`, [tenantId, clientId, userId]);
    const result = await connection.query(`INSERT INTO client_reporting_portal_invitations
      (tenant_id, client_id, token_hash, expires_at, created_by_user_id)
      VALUES ($1,$2,$3,$4,$5) RETURNING id, expires_at, created_at`, [tenantId, clientId, tokenHash, expiresAt, userId]);
    if (owned) await connection.query('COMMIT');
    return { token, invitation: result.rows[0] };
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

async function revokeAccess(db, tenantId, clientId) {
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    if (owned) await connection.query('BEGIN');
    await _snapshot.activeClient(connection, tenantId, clientId, true);
    const now = new Date();
    await connection.query(`UPDATE client_reporting_portal_access SET enabled=false, revoked_at=$3, updated_at=$3
      WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId, now]);
    await connection.query(`UPDATE client_reporting_portal_invitations SET revoked_at=$3
      WHERE tenant_id=$1 AND client_id=$2 AND revoked_at IS NULL AND redeemed_at IS NULL`,
      [tenantId, clientId, now]);
    await connection.query(`UPDATE client_reporting_portal_sessions SET revoked_at=$3
      WHERE tenant_id=$1 AND client_id=$2 AND revoked_at IS NULL`, [tenantId, clientId, now]);
    if (owned) await connection.query('COMMIT');
    return true;
  } catch (error) {
    if (owned) await connection.query('ROLLBACK');
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

async function redeemInvitation(db, rawToken) {
  const token = sanitizeToken(rawToken);
  if (!token) throw fail(400, 'invalid_token');
  const tokenHash = hashToken(token);
  const connection = await db.connect();
  try {
    await connection.query('BEGIN');
    const invite = await connection.query(`SELECT id, tenant_id, client_id, expires_at, revoked_at, redeemed_at
      FROM client_reporting_portal_invitations WHERE token_hash=$1 FOR UPDATE`, [tokenHash]);
    const row = invite.rows[0];
    if (!row) throw fail(404, 'invitation_not_found');
    if (row.revoked_at) throw fail(403, 'invitation_revoked');
    if (row.redeemed_at) throw fail(403, 'invitation_redeemed');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw fail(403, 'invitation_expired');
    const access = await connection.query(`SELECT enabled, revoked_at FROM client_reporting_portal_access
      WHERE tenant_id=$1 AND client_id=$2`, [row.tenant_id, row.client_id]);
    if (!access.rows[0]?.enabled || access.rows[0].revoked_at) throw fail(403, 'portal_revoked');
    await _snapshot.activeClient(connection, row.tenant_id, row.client_id);
    const sessionToken = mintToken();
    const sessionHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = await connection.query(`INSERT INTO client_reporting_portal_sessions
      (tenant_id, client_id, token_hash, invitation_id, expires_at, last_access_at)
      VALUES ($1,$2,$3,$4,$5,now()) RETURNING id, tenant_id, client_id, expires_at`, [
      row.tenant_id, row.client_id, sessionHash, row.id, expiresAt,
    ]);
    await connection.query(`UPDATE client_reporting_portal_invitations SET redeemed_at=now(), redeemed_session_id=$2
      WHERE id=$1`, [row.id, session.rows[0].id]);
    await connection.query('COMMIT');
    return { sessionToken, session: session.rows[0], invitationId: row.id };
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

async function resolveSession(db, rawToken) {
  const token = sanitizeToken(rawToken);
  if (!token) throw fail(401, 'portal_auth_required');
  const tokenHash = hashToken(token);
  const result = await db.query(`SELECT s.id, s.tenant_id, s.client_id, s.expires_at, s.revoked_at,
      a.enabled AS access_enabled, a.revoked_at AS access_revoked_at
    FROM client_reporting_portal_sessions s
    JOIN client_reporting_portal_access a ON a.tenant_id=s.tenant_id AND a.client_id=s.client_id
    WHERE s.token_hash=$1`, [tokenHash]);
  const row = result.rows[0];
  if (!row) throw fail(401, 'portal_auth_required');
  if (row.revoked_at || row.access_revoked_at || !row.access_enabled) throw fail(403, 'portal_revoked');
  if (new Date(row.expires_at).getTime() <= Date.now()) throw fail(403, 'portal_session_expired');
  await _snapshot.activeClient(db, row.tenant_id, row.client_id);
  await db.query('UPDATE client_reporting_portal_sessions SET last_access_at=now() WHERE id=$1', [row.id]);
  return { sessionId: row.id, tenantId: row.tenant_id, clientId: row.client_id };
}

async function buildPortalReport(db, tenantId, clientId) {
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = connection !== db;
  try {
    const { snapshot } = await _snapshot.buildReportSnapshot(connection, tenantId, clientId);
    return snapshot;
  } finally {
    if (owned) connection.release();
  }
}

async function portalDeliveryHistory(db, tenantId, clientId, cursor = 0, limit = 20) {
  const { rows } = await db.query(`SELECT id, window_key, status, attempted_at, recipient_email, profile_version, format, error_code
    FROM client_reporting_delivery_history WHERE tenant_id=$1 AND client_id=$2 AND ($3=0 OR id < $3)
    ORDER BY id DESC LIMIT $4`, [tenantId, clientId, cursor, limit + 1]);
  const deliveries = rows.slice(0, limit);
  return { deliveries, has_more: rows.length > limit, next_cursor: rows.length > limit ? deliveries.at(-1).id : null };
}

module.exports = {
  COOKIE_NAME, INVITE_TTL_MS, SESSION_TTL_MS, hashToken, sanitizeToken, mintToken,
  setSessionCookie, clearSessionCookie, readSessionToken, portalStatus, createInvitation,
  revokeAccess, redeemInvitation, resolveSession, buildPortalReport, portalDeliveryHistory,
};
