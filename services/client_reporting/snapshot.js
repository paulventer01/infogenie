'use strict';

const sources = require('./sources');
const reports = require('./report');
const metrics = require('./metrics');
const period = require('./period');

const CLIENT_COLUMNS = 'id, name, slug, website, status';
const PROFILE_COLUMNS = 'client_id, report_source, default_format, report_title, branding_mode, branding_overrides, selected_metrics, reporting_period, reporting_timezone, version, created_at, updated_at';

function fail(status, code) { return Object.assign(new Error(code), { status }); }

async function activeClient(db, tenantId, id, lock = false) {
  const { rows } = await db.query(`SELECT ${CLIENT_COLUMNS} FROM clients
    WHERE tenant_id=$1 AND id=$2 AND status='active'${lock ? ' FOR UPDATE' : ''}`, [tenantId, id]);
  if (!rows[0]) throw fail(404, 'client_not_found');
  return rows[0];
}

function resolveDateRange(profile, customRange) {
  const timezone = profile.reporting_timezone || 'UTC';
  if (customRange) return period.validateCustomRange(customRange.startDate, customRange.endDate, timezone);
  return period.resolveRelative(profile.reporting_period || 'all_time', timezone);
}

async function buildReportSnapshot(db, tenantId, clientId, expectedVersion, customRange) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const client = await activeClient(db, tenantId, clientId);
    const { rows } = await db.query(`SELECT ${PROFILE_COLUMNS} FROM client_reporting_profiles
      WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
    const profile = rows[0];
    if (!profile) throw fail(409, 'profile_required');
    if (expectedVersion !== undefined && profile.version !== expectedVersion) throw fail(409, 'version_conflict');
    if (!['pdf', 'pptx', 'xlsx'].includes(profile.default_format)) throw fail(409, 'invalid_profile');
    const dateRange = resolveDateRange(profile, customRange);
    const selectedMetrics = metrics.resolveSelection(profile.report_source, profile.selected_metrics);
    const spec = sources.source(profile.report_source);
    const data = await sources.data(db, profile.report_source, spec, tenantId, clientId, 0, 100, dateRange);
    const workspace = profile.branding_mode === 'workspace' ? await db.query(
      'SELECT value FROM kv_store WHERE key=$1', [`white_label.brand_profile:t${tenantId}`]) : { rows: [] };
    const snapshot = reports.buildReport(client, profile, data, workspace.rows[0]?.value, selectedMetrics, dateRange);
    if (expectedVersion !== undefined && !snapshot.can_generate) throw fail(409, 'no_mapped_records');
    await db.query('COMMIT');
    return { snapshot, profile, client, dateRange, selectedMetrics };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

module.exports = { activeClient, buildReportSnapshot, resolveDateRange, CLIENT_COLUMNS, PROFILE_COLUMNS };
