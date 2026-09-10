'use strict';

const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { hasPermission } = require('../tenants/permission_enforce');
const { createRateLimiter } = require('../security/rate_limit');
const { randomUUID } = require('node:crypto');
const sources = require('./sources');
const reports = require('./report');
const delivery = require('./delivery');
const _audit = require('../admin/audit');
const router = express.Router();
const PERMISSION = 'tenant.settings.manage';
const CLIENT_COLUMNS = 'id, name, slug, website, status';
const PROFILE_COLUMNS = 'client_id, report_source, default_format, report_title, branding_mode, branding_overrides, version, created_at, updated_at';
const PROFILE_KEYS = ['report_source', 'default_format', 'report_title', 'branding_mode', 'branding_overrides', 'expected_version'];
const BRAND_LIMITS = { agencyName: 80, footerText: 200, primaryColor: 7, accentColor: 7, textColor: 7 };

function fail(status, code) { return Object.assign(new Error(code), { status }); }
function positiveId(value) {
  if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) return null;
  return Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    const status = error.status || 500;
    if (!res.headersSent) res.status(status).json({ ok: false, error: status >= 500 ? 'internal_error' : error.message });
  });
}

// Memberships are populated only from active tenant_users + active tenants by
// loadTenantContext. Platform-admin permission bypass does not bypass this guard.
router.use(safe(async (req, res, next) => {
  if (!positiveId(req.user?.id)) throw fail(401, 'auth_required');
  const tenantId = positiveId(req.tenant?.id);
  if (!tenantId || req.tenant.status !== 'active') throw fail(400, 'no_tenant');
  if (!Array.isArray(req.tenantMemberships) || !req.tenantMemberships.some((m) => positiveId(m.tenantId) === tenantId)) {
    throw fail(403, 'forbidden');
  }
  if (!hasPermission(req, PERMISSION)) return res.status(403).json({ ok: false, error: 'forbidden', required: PERMISSION });
  if (positiveId(await _tenantCtx.resolveTenantId(req, { label: 'client-reporting' })) !== tenantId) throw fail(403, 'forbidden');
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'database_unavailable' });
  req.clientReportingTenantId = tenantId;
  res.setHeader('Cache-Control', 'no-store');
  return next();
}));

const writeLimiter = createRateLimiter({
  name: 'client-reporting', windowMs: 60_000, max: 60, failClosed: true,
  keyFn: (req) => req.clientReportingTenantId ? `client-reporting|${req.clientReportingTenantId}` : null,
});
const readLimiter = createRateLimiter({
  name: 'client-reporting-read', windowMs: 60_000, max: 300, failClosed: true,
  keyFn: (req) => req.clientReportingTenantId ? `client-reporting-read|${req.clientReportingTenantId}` : null,
});

function profileInput(req) {
  const body = req.body;
  const raw = req.rawBody == null ? JSON.stringify(body ?? null) : req.rawBody;
  if (Buffer.byteLength(raw, 'utf8') > 8192) throw fail(413, 'payload_too_large');
  if (!object(body) || Object.keys(body).some((key) => !PROFILE_KEYS.includes(key)) || PROFILE_KEYS.some((key) => !Object.hasOwn(body, key))) {
    throw fail(400, 'invalid_profile');
  }
  const { report_source, default_format, branding_mode, expected_version, branding_overrides } = body;
  if (!['search-intel', 'campaigns'].includes(report_source) || !['pdf', 'pptx', 'xlsx'].includes(default_format) ||
      !['workspace', 'custom'].includes(branding_mode) || !Number.isInteger(expected_version) || expected_version < 0 || expected_version >= 2147483647 ||
      typeof body.report_title !== 'string' || !body.report_title.trim() || body.report_title.trim().length > 160 || !object(branding_overrides)) {
    throw fail(400, 'invalid_profile');
  }
  const branding = {};
  for (const [key, value] of Object.entries(branding_overrides)) {
    if (!Object.hasOwn(BRAND_LIMITS, key) || typeof value !== 'string' || value.trim().length > BRAND_LIMITS[key] ||
        (key.endsWith('Color') && !/^#[0-9a-fA-F]{6}$/.test(value))) throw fail(400, 'invalid_profile');
    branding[key] = value.trim();
  }
  if (branding_mode === 'workspace' && Object.keys(branding).length) throw fail(400, 'invalid_profile');
  return { report_source, default_format, report_title: body.report_title.trim(), branding_mode, branding_overrides: branding, expected_version };
}

function clientId(req) {
  const id = positiveId(req.params.clientId);
  if (!id || id > 2147483647) throw fail(400, 'invalid_client_id');
  return id;
}
async function activeClient(pool, tenantId, id, lock = false) {
  const { rows } = await pool.query(`SELECT ${CLIENT_COLUMNS} FROM clients
    WHERE tenant_id=$1 AND id=$2 AND status='active'${lock ? ' FOR UPDATE' : ''}`, [tenantId, id]);
  if (!rows[0]) throw fail(404, 'client_not_found');
  return rows[0];
}

router.get('/clients', readLimiter, safe(async (req, res) => {
  const cursor = req.query.cursor === undefined ? 0 : positiveId(req.query.cursor);
  const limit = req.query.limit === undefined ? 50 : positiveId(req.query.limit);
  if (cursor === null || cursor > 2147483647 || !limit || limit > 100) throw fail(400, 'invalid_pagination');
  const { rows } = await _db.getPool().query(`SELECT ${CLIENT_COLUMNS} FROM clients
    WHERE tenant_id=$1 AND status='active' AND id>$2 ORDER BY id ASC LIMIT $3`, [req.clientReportingTenantId, cursor, limit + 1]);
  const clients = rows.slice(0, limit), hasMore = rows.length > limit;
  return res.json({ ok: true, clients, has_more: hasMore, next_cursor: hasMore ? clients.at(-1).id : null });
}));

router.get('/clients/:clientId', readLimiter, safe(async (req, res) => {
  const client = await activeClient(_db.getPool(), req.clientReportingTenantId, clientId(req));
  return res.json({ ok: true, client });
}));

router.get('/clients/:clientId/profile', readLimiter, safe(async (req, res) => {
  const pool = _db.getPool(), tenantId = req.clientReportingTenantId, id = clientId(req);
  const client = await activeClient(pool, tenantId, id);
  const { rows } = await pool.query(`SELECT ${PROFILE_COLUMNS} FROM client_reporting_profiles
    WHERE tenant_id=$1 AND client_id=$2`, [tenantId, id]);
  return res.json({ ok: true, client, configured: !!rows[0], profile: rows[0] || null });
}));

// Settings only: no report source, export generation or branding asset is fetched.
router.put('/clients/:clientId/profile', writeLimiter, safe(async (req, res) => {
  const tenantId = req.clientReportingTenantId, id = clientId(req), input = profileInput(req);
  const connection = await _db.getPool().connect();
  try {
    await connection.query('BEGIN');
    await activeClient(connection, tenantId, id, true);
    const values = [tenantId, id, input.report_source, input.default_format, input.report_title,
      input.branding_mode, JSON.stringify(input.branding_overrides), positiveId(req.user.id)];
    const result = input.expected_version === 0
      ? await connection.query(`INSERT INTO client_reporting_profiles
          (tenant_id,client_id,report_source,default_format,report_title,branding_mode,branding_overrides,updated_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
          ON CONFLICT (tenant_id,client_id) DO NOTHING RETURNING ${PROFILE_COLUMNS}`, values)
      : await connection.query(`UPDATE client_reporting_profiles SET report_source=$3,default_format=$4,
          report_title=$5,branding_mode=$6,branding_overrides=$7::jsonb,updated_by_user_id=$8,version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND client_id=$2 AND version=$9 RETURNING ${PROFILE_COLUMNS}`, [...values, input.expected_version]);
    if (!result.rows[0]) throw fail(409, 'version_conflict');
    await connection.query('COMMIT');
    return res.json({ ok: true, configured: true, profile: result.rows[0] });
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}));

function pagination(req) {
  const cursor = req.query.cursor === undefined ? 0 : positiveId(req.query.cursor);
  const limit = req.query.limit === undefined ? 50 : positiveId(req.query.limit);
  if (Object.keys(req.query).some((key) => !['cursor', 'limit'].includes(key)) ||
      cursor === null || cursor > 2147483647 || !limit || limit > 100) throw fail(400, 'invalid_pagination');
  return { cursor, limit };
}
function mappingInput(req) {
  const body = req.body, deleting = req.method === 'DELETE';
  const raw = req.rawBody == null ? JSON.stringify(body ?? null) : req.rawBody;
  if (Buffer.byteLength(raw, 'utf8') > 8192) throw fail(413, 'payload_too_large');
  if (Object.keys(req.query).length || !object(body) || (deleting
    ? Object.keys(body).length !== 1 || typeof body.mapping_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.mapping_id)
    : Object.keys(body).length !== 0)) throw fail(400, 'invalid_mapping');
  return body.mapping_id;
}
router.get('/sources/:source/records', readLimiter, safe(async (req, res) => {
  const spec = sources.source(req.params.source), { cursor, limit } = pagination(req);
  return res.json({ ok: true, source: req.params.source,
    ...await sources.candidates(_db.getPool(), spec, req.clientReportingTenantId, cursor, limit) });
}));

const mutateMapping = safe(async (req, res) => {
  const spec = sources.source(req.params.source), token = mappingInput(req);
  const tenantId = req.clientReportingTenantId, id = clientId(req), recordId = positiveId(req.params.recordId);
  if (!recordId || recordId > 2147483647) throw fail(400, 'invalid_record_id');
  const connection = await _db.getPool().connect();
  try {
    await connection.query('BEGIN');
    await activeClient(connection, tenantId, id, true);
    const root = await connection.query(`SELECT id FROM ${spec.table} WHERE tenant_id=$1 AND id=$2 FOR KEY SHARE`, [tenantId, recordId]);
    if (!root.rows[0]) throw fail(404, 'record_not_found');
    const result = req.method === 'POST'
      ? await connection.query(`INSERT INTO ${spec.mappings} (tenant_id,${spec.key},client_id,mapping_id,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,${spec.key}) DO NOTHING
        RETURNING ${spec.key} AS record_id,client_id,mapping_id`, [tenantId, recordId, id, randomUUID(), positiveId(req.user.id)])
      : await connection.query(`DELETE FROM ${spec.mappings} WHERE tenant_id=$1 AND ${spec.key}=$2 AND client_id=$3 AND mapping_id=$4
        RETURNING ${spec.key} AS record_id,client_id,mapping_id`, [tenantId, recordId, id, token]);
    if (!result.rows[0]) throw fail(409, 'mapping_conflict');
    await connection.query('COMMIT');
    return res.status(req.method === 'POST' ? 201 : 200).json({ ok: true, source: req.params.source,
      ...(req.method === 'POST' ? { mapping: result.rows[0] } : { deleted: true }) });
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
});
router.post('/clients/:clientId/mappings/:source/:recordId', writeLimiter, mutateMapping);
router.delete('/clients/:clientId/mappings/:source/:recordId', writeLimiter, mutateMapping);

router.get('/clients/:clientId/data/:source', readLimiter, safe(async (req, res) => {
  const spec = sources.source(req.params.source), { cursor, limit } = pagination(req);
  const tenantId = req.clientReportingTenantId, id = clientId(req), connection = await _db.getPool().connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const client = await activeClient(connection, tenantId, id);
    const data = await sources.data(connection, req.params.source, spec, tenantId, id, cursor, limit);
    await connection.query('COMMIT');
    return res.json({ ok: true, client, ...data });
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}));

async function reportSnapshot(req, expectedVersion) {
  const tenantId = req.clientReportingTenantId, id = clientId(req), connection = await _db.getPool().connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const client = await activeClient(connection, tenantId, id);
    const { rows } = await connection.query(`SELECT ${PROFILE_COLUMNS} FROM client_reporting_profiles
      WHERE tenant_id=$1 AND client_id=$2`, [tenantId, id]);
    const profile = rows[0];
    if (!profile) throw fail(409, 'profile_required');
    if (expectedVersion !== undefined && profile.version !== expectedVersion) throw fail(409, 'version_conflict');
    if (!['pdf', 'pptx', 'xlsx'].includes(profile.default_format)) throw fail(409, 'invalid_profile');
    const spec = sources.source(profile.report_source);
    const data = await sources.data(connection, profile.report_source, spec, tenantId, id, 0, 100);
    const workspace = profile.branding_mode === 'workspace' ? await connection.query(
      'SELECT value FROM kv_store WHERE key=$1', [`white_label.brand_profile:t${tenantId}`]) : { rows: [] };
    const snapshot = reports.buildReport(client, profile, data, workspace.rows[0]?.value);
    if (expectedVersion !== undefined && !snapshot.can_generate) throw fail(409, 'no_mapped_records');
    await connection.query('COMMIT');
    return snapshot;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}
router.get('/clients/:clientId/report-preview', readLimiter, safe(async (req, res) => {
  if (Object.keys(req.query).length) throw fail(400, 'invalid_report');
  return res.json(await reportSnapshot(req));
}));
router.post('/clients/:clientId/report', writeLimiter, safe(async (req, res) => {
  const body = req.body, raw = req.rawBody == null ? JSON.stringify(body ?? null) : req.rawBody;
  if (Buffer.byteLength(raw, 'utf8') > 8192) throw fail(413, 'payload_too_large');
  if (Object.keys(req.query).length || !object(body) || Object.keys(body).length !== 1 ||
      !Number.isInteger(body.expected_version) || body.expected_version < 1 || body.expected_version >= 2147483647) throw fail(400, 'invalid_report');
  return reports.streamReport(await reportSnapshot(req, body.expected_version), res);
}));

function deliveryInput(req) {
  const body = req.body, raw = req.rawBody == null ? JSON.stringify(body ?? null) : req.rawBody;
  if (Buffer.byteLength(raw, 'utf8') > 8192) throw fail(413, 'payload_too_large');
  if (Object.keys(req.query).length || !object(body) || Object.keys(body).length !== 2 ||
      !Number.isInteger(body.expected_version) || body.expected_version < 1 || body.expected_version >= 2147483647 ||
      body.confirm !== true) throw fail(400, 'invalid_delivery');
  return body.expected_version;
}

const RECIPIENT_COLUMNS = 'client_id, email, enabled, updated_at';

function validRecipientEmail(email) {
  if (!email || email.length > 240) return false;
  const at = email.indexOf('@');
  if (at <= 0 || email.lastIndexOf('@') !== at) return false;
  for (let i = 0; i < email.length; i++) {
    const code = email.charCodeAt(i);
    if (code <= 32 || code === 127) return false;
  }
  const domain = email.slice(at + 1);
  if (!domain || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

function recipientInput(req) {
  const body = req.body, raw = req.rawBody == null ? JSON.stringify(body ?? null) : req.rawBody;
  if (Buffer.byteLength(raw, 'utf8') > 8192) throw fail(413, 'payload_too_large');
  if (Object.keys(req.query).length || !object(body) || Object.keys(body).length !== 2 ||
      typeof body.enabled !== 'boolean') throw fail(400, 'invalid_recipient');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!validRecipientEmail(email)) throw fail(400, 'invalid_recipient');
  return { email, enabled: body.enabled };
}

async function deliveryContext(req, expectedVersion) {
  const tenantId = req.clientReportingTenantId, id = clientId(req), pool = _db.getPool();
  const snapshot = await reportSnapshot(req, expectedVersion);
  const recipient = await delivery.clientRecipient(pool, tenantId, id);
  if (!recipient) throw fail(409, 'no_recipient');
  return { snapshot, recipient };
}

router.get('/clients/:clientId/recipient', readLimiter, safe(async (req, res) => {
  if (Object.keys(req.query).length) throw fail(400, 'invalid_recipient');
  const tenantId = req.clientReportingTenantId, id = clientId(req), pool = _db.getPool();
  const client = await activeClient(pool, tenantId, id);
  const { rows } = await pool.query(`SELECT ${RECIPIENT_COLUMNS} FROM client_reporting_recipients
    WHERE tenant_id=$1 AND client_id=$2`, [tenantId, id]);
  return res.json({ ok: true, client, configured: !!rows[0], recipient: rows[0] || null });
}));

router.put('/clients/:clientId/recipient', writeLimiter, safe(async (req, res) => {
  const tenantId = req.clientReportingTenantId, id = clientId(req), input = recipientInput(req);
  const connection = await _db.getPool().connect();
  try {
    await connection.query('BEGIN');
    const client = await activeClient(connection, tenantId, id, true);
    const prior = await connection.query(`SELECT email, enabled FROM client_reporting_recipients
      WHERE tenant_id=$1 AND client_id=$2`, [tenantId, id]);
    const result = await connection.query(`INSERT INTO client_reporting_recipients
      (tenant_id, client_id, email, enabled, updated_by_user_id)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (tenant_id, client_id) DO UPDATE SET email=EXCLUDED.email, enabled=EXCLUDED.enabled,
        updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()
      RETURNING ${RECIPIENT_COLUMNS}`, [tenantId, id, input.email, input.enabled, positiveId(req.user.id)]);
    await connection.query('COMMIT');
    await _audit.recordAudit({
      action: 'client_reporting.recipient_update', actorUserId: req.user.id, actorEmail: req.user.email,
      tenantId, targetEmail: input.email, detail: `${client.name}: ${prior.rows[0]?.email || 'none'} -> ${input.email}`,
      context: { client_id: id, enabled: input.enabled },
    });
    return res.json({ ok: true, client, configured: true, recipient: result.rows[0] });
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}));

router.get('/clients/:clientId/report-recipient', readLimiter, safe(async (req, res) => {
  if (Object.keys(req.query).length) throw fail(400, 'invalid_delivery');
  const tenantId = req.clientReportingTenantId, id = clientId(req), pool = _db.getPool();
  const client = await activeClient(pool, tenantId, id);
  const { rows } = await pool.query(`SELECT default_format, version FROM client_reporting_profiles
    WHERE tenant_id=$1 AND client_id=$2`, [tenantId, id]);
  const profile = rows[0];
  if (!profile) throw fail(409, 'profile_required');
  const email = await delivery.clientRecipient(pool, tenantId, id);
  if (!email) throw fail(409, 'no_recipient');
  return res.json({ ok: true, client, profile_version: profile.version, format: profile.default_format,
    recipient: { email, source: 'client_reporting_recipient', enabled: true } });
}));

router.post('/clients/:clientId/report-email', writeLimiter, safe(async (req, res) => {
  const expectedVersion = deliveryInput(req);
  const { snapshot, recipient } = await deliveryContext(req, expectedVersion);
  const { buffer, filename, contentType } = await delivery.bufferReport(snapshot);
  const subject = `${snapshot.report.title} — ${snapshot.client.name}`;
  const text = `Attached is the ${snapshot.format.toUpperCase()} report "${snapshot.report.title}" for ${snapshot.client.name}.`;
  const html = `<div style="font-family:sans-serif;max-width:560px;line-height:1.6">
    <p>Attached is the <strong>${snapshot.format.toUpperCase()}</strong> report <strong>${snapshot.report.title}</strong> for ${snapshot.client.name}.</p>
    <p style="color:#64748B;font-size:13px">Generated from the saved client reporting profile (version ${snapshot.profile_version}).</p>
  </div>`;
  try {
    await delivery.sendReportEmail({ to: recipient, subject, html, text, filename, content: buffer, contentType });
  } catch (error) {
    if (error.code === 'mail_unconfigured') return res.status(503).json({ ok: false, error: 'mail_unconfigured' });
    if (error.code === 'mail_failed') return res.status(502).json({ ok: false, error: 'mail_failed' });
    throw error;
  }
  await _audit.recordAudit({
    action: 'client_reporting.report_email', actorUserId: req.user.id, actorEmail: req.user.email,
    tenantId: req.clientReportingTenantId, targetEmail: recipient,
    detail: `Client ${clientId(req)} ${snapshot.format} profile v${snapshot.profile_version}`,
    context: { client_id: clientId(req), profile_version: snapshot.profile_version, format: snapshot.format },
  });
  return res.json({ ok: true, sent: true, recipient, format: snapshot.format, profile_version: snapshot.profile_version });
}));

module.exports = router;
