'use strict';

const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { hasPermission } = require('../tenants/permission_enforce');
const { createRateLimiter } = require('../security/rate_limit');
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

module.exports = router;
