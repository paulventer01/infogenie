'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { requirePermission } = require('../tenants/permission_enforce');
const { createRateLimiter } = require('../security/rate_limit');

const AGENCY_OPS_WINDOW_MS = 60_000;
const AGENCY_OPS_MAX = 60;

function _agencyOpsTenantId(req) {
  const raw = req && req.tenant ? req.tenant.id : undefined;
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function _agencyOpsTenantGuard(req, res, next) {
  if (_agencyOpsTenantId(req) == null) {
    return res.status(400).json({ ok: false, error: 'no_tenant' });
  }
  return next();
}

function _agencyOpsRateLimitKey(req) {
  const tid = _agencyOpsTenantId(req);
  return tid == null ? null : `agency-ops|${tid}`;
}

const agencyOpsSharedLimiter = createRateLimiter({
  name: 'agency-ops',
  windowMs: AGENCY_OPS_WINDOW_MS,
  max: AGENCY_OPS_MAX,
  keyFn: _agencyOpsRateLimitKey,
  failClosed: true,
});

function _err(res, code, msg, extra = {}) {
  return res.status(code).json({ ok: false, error: msg, ...extra });
}

function _bad(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}

function _safe(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((e) => {
    const code = Number(e.statusCode) || 500;
    if (code >= 500) console.warn('[agency-ops]', e.message);
    if (!res.headersSent) {
      const message = code >= 500 ? 'internal error' : (e.publicCode || e.message);
      const extra = e.currencies ? { currencies: e.currencies } : {};
      _err(res, code, message, extra);
    }
  });
}

function _id(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function _text(value, label, { required = false, max = 200 } = {}) {
  const text = value == null ? '' : String(value).trim();
  if (required && !text) throw _bad(label + ' required');
  if (text.length > max) throw _bad(label + ' too long');
  return text || null;
}

function _date(value, label, { required = true } = {}) {
  const text = value == null ? '' : String(value).trim();
  if (!text && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw _bad(label + ' must be YYYY-MM-DD');
  const parsed = new Date(text + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw _bad(label + ' must be a real calendar date');
  }
  return text;
}

function _range(req) {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + '01';
  const from = _date(req.query?.from || firstOfMonth, 'from');
  const to = _date(req.query?.to || today, 'to');
  if (from > to) throw _bad('from must be on or before to');
  return { from, to };
}

function _number(value, label, { min = 0, max = 1000000000, fallback } = {}) {
  const raw = value == null || value === '' ? fallback : value;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw _bad(label + ' must be between ' + min + ' and ' + max);
  }
  return n;
}

function _bool(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw _bad('boolean value expected');
}

function _round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function _dateValue(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
}

function _currency(value) {
  const text = value == null ? '' : String(value).trim().toUpperCase();
  return text || null;
}

function _rate(row) {
  return {
    id: row.id,
    member_id: row.member_id || null,
    role: row.role || null,
    cost_rate: Number(row.cost_rate || 0),
    bill_rate: Number(row.bill_rate || 0),
    currency: _currency(row.currency),
    effective_from: _dateValue(row.effective_from),
    effective_to: row.effective_to ? _dateValue(row.effective_to) : null,
    active: row.active !== false,
  };
}

function _entry(row) {
  const hours = Number(row.hours || 0);
  const costRate = Number(row.cost_rate || 0);
  const billRate = Number(row.bill_rate || 0);
  const priced = Boolean(row.rate_id);
  const billableValue = row.billable ? hours * billRate : 0;
  return {
    id: row.id,
    member_id: row.member_id,
    member_role: row.member_role || null,
    client_ref: row.client_ref,
    project_ref: row.project_ref || null,
    work_item: row.work_item,
    work_date: _dateValue(row.work_date),
    hours: _round(hours),
    billable: row.billable !== false,
    notes: row.notes || '',
    cost_rate: _round(costRate),
    bill_rate: _round(billRate),
    currency: _currency(row.currency),
    rate_status: priced ? 'priced' : 'missing',
    rate_source: row.rate_source || null,
    cost_value: _round(hours * costRate),
    billable_value: _round(billableValue),
  };
}

async function _tenantId(req, label) {
  return _tenantCtx.resolveTenantId(req, { label });
}

async function _assertMember(pool, tenantId, memberId) {
  const result = await pool.query(
    'SELECT id FROM team_capacity WHERE id=$1 AND tenant_id=$2 LIMIT 1',
    [memberId, tenantId],
  );
  if (!result.rows.length) throw _bad('member_id must belong to this tenant capacity roster');
}

async function _fetchEntries(pool, tenantId, range, filters = {}, { limit = null } = {}) {
  const params = [tenantId, range.from, range.to];
  const conditions = [
    'e.tenant_id=$1',
    'e.work_date >= $2::date',
    'e.work_date <= $3::date',
  ];
  if (filters.clientRef) {
    params.push(filters.clientRef);
    conditions.push('e.client_ref=$' + params.length);
  }
  if (filters.memberId) {
    params.push(filters.memberId);
    conditions.push('e.member_id=$' + params.length);
  }

  if (limit != null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw _bad('limit must be a positive integer');
  }
  const limitClause = limit == null ? '' : '\n LIMIT ' + limit;

  const sql = [
    'SELECT e.id, e.member_id, e.client_ref, e.project_ref, e.work_item,',
    '       e.work_date, e.hours, e.billable, e.notes,',
    '       m.role AS member_role,',
    '       r.id AS rate_id, r.cost_rate, r.bill_rate, r.currency, r.rate_source',
    '  FROM agency_time_entries e',
    '  LEFT JOIN team_capacity m',
    '    ON m.id=e.member_id AND m.tenant_id=e.tenant_id',
    '  LEFT JOIN LATERAL (',
    '    SELECT r.id, r.cost_rate, r.bill_rate, r.currency,',
    "           CASE WHEN r.member_id=e.member_id THEN 'member'",
    "                WHEN r.role IS NOT NULL THEN 'role'",
    "                ELSE 'default' END AS rate_source",
    '      FROM agency_rate_cards r',
    '     WHERE r.tenant_id=e.tenant_id',
    '       AND r.active=true',
    '       AND r.effective_from <= e.work_date',
    '       AND (r.effective_to IS NULL OR r.effective_to >= e.work_date)',
    '       AND (',
    '         r.member_id=e.member_id',
    "         OR (r.member_id IS NULL AND r.role IS NOT NULL AND r.role=m.role)",
    '         OR (r.member_id IS NULL AND r.role IS NULL)',
    '       )',
    '     ORDER BY COALESCE((r.member_id=e.member_id), false) DESC,',
    '              (r.role IS NOT NULL) DESC,',
    '              r.effective_from DESC, r.id DESC',
    '     LIMIT 1',
    '  ) r ON true',
    ' WHERE ' + conditions.join(' AND '),
    ' ORDER BY e.work_date DESC, e.created_at DESC' + limitClause,
  ].join('\n');
  const result = await pool.query(sql, params);
  return result.rows.map(_entry);
}

async function _fetchBaselines(pool, tenantId, range, clientRef = null) {
  const params = [tenantId, range.from, range.to];
  let where = [
    'tenant_id=$1',
    'active=true',
    'period_end >= $2::date',
    'period_start <= $3::date',
  ];
  if (clientRef) {
    params.push(clientRef);
    where.push('client_ref=$' + params.length);
  }
  const result = await pool.query(
    'SELECT id, client_ref, project_ref, name, period_start, period_end, ' +
    'contracted_hours, change_budget_hours, contracted_value, currency, active ' +
    'FROM agency_scope_baselines WHERE ' + where.join(' AND ') +
    ' ORDER BY period_start ASC, client_ref ASC',
    params,
  );
  return result.rows;
}

function _baselineRange(baselines) {
  if (!baselines.length) return null;
  return baselines.reduce((range, baseline) => {
    const start = _dateValue(baseline.period_start);
    const end = _dateValue(baseline.period_end);
    if (!range) return { from: start, to: end };
    return {
      from: start < range.from ? start : range.from,
      to: end > range.to ? end : range.to,
    };
  }, null);
}

function _summaryCurrency(entries, baselines) {
  const currencies = new Set();
  for (const row of entries) {
    const currency = _currency(row.currency);
    if (currency) currencies.add(currency);
  }
  for (const row of baselines) {
    const currency = _currency(row.currency);
    if (currency) currencies.add(currency);
  }
  const values = Array.from(currencies).sort();
  if (values.length > 1) {
    const error = _bad('mixed currencies are not supported in a single summary');
    error.statusCode = 409;
    error.publicCode = 'mixed_currencies';
    error.currencies = values;
    throw error;
  }
  return values[0] || null;
}

function _scopeSignals(baselines, entries) {
  return baselines.map((baseline) => {
    const start = _dateValue(baseline.period_start);
    const end = _dateValue(baseline.period_end);
    const relevant = entries.filter((entry) =>
      entry.client_ref === baseline.client_ref &&
      (!baseline.project_ref || entry.project_ref === baseline.project_ref) &&
      entry.work_date >= start && entry.work_date <= end);
    const actualHours = relevant.reduce((sum, entry) => sum + entry.hours, 0);
    const contractedHours = Number(baseline.contracted_hours || 0);
    const changeBudgetHours = Number(baseline.change_budget_hours || 0);
    const allowedHours = contractedHours + changeBudgetHours;
    const overageHours = Math.max(0, actualHours - allowedHours);
    const status = overageHours > 0
      ? 'over_scope'
      : actualHours > contractedHours
        ? 'change_budget_used'
        : 'within_scope';
    return {
      id: baseline.id,
      client_ref: baseline.client_ref,
      project_ref: baseline.project_ref || null,
      name: baseline.name,
      period_start: start,
      period_end: end,
      contracted_hours: _round(contractedHours),
      change_budget_hours: _round(changeBudgetHours),
      allowed_hours: _round(allowedHours),
      actual_hours: _round(actualHours),
      overage_hours: _round(overageHours),
      utilization_pct: contractedHours > 0 ? _round((actualHours / contractedHours) * 100) : null,
      status,
      signal: status !== 'within_scope',
      severity: overageHours > 0 ? 'high' : status === 'change_budget_used' ? 'medium' : null,
    };
  });
}

function _emptySummary(range, filters) {
  return {
    ok: true,
    period: range,
    filters,
    totals: {
      time_entries: 0,
      hours: 0,
      billable_hours: 0,
      non_billable_hours: 0,
      cost_value: 0,
      billable_value: 0,
      margin_value: 0,
      margin_pct: null,
      unpriced_hours: 0,
      contracted_value: 0,
      scope_overage_hours: 0,
      currency: null,
    },
    clients: [],
    scope_signals: [],
  };
}

function _buildSummary(range, filters, entries, baselines) {
  const currency = _summaryCurrency(entries, baselines);
  const signals = _scopeSignals(baselines, entries);
  const clientMap = new Map();
  const totals = {
    time_entries: entries.length,
    hours: 0,
    billable_hours: 0,
    non_billable_hours: 0,
    cost_value: 0,
    billable_value: 0,
    margin_value: 0,
    margin_pct: null,
    unpriced_hours: 0,
    contracted_value: 0,
    scope_overage_hours: signals.reduce((sum, signal) => sum + signal.overage_hours, 0),
    currency,
  };

  for (const entry of entries) {
    const key = entry.client_ref;
    const current = clientMap.get(key) || {
      client_ref: key,
      time_entries: 0,
      hours: 0,
      billable_hours: 0,
      non_billable_hours: 0,
      cost_value: 0,
      billable_value: 0,
      margin_value: 0,
      margin_pct: null,
      unpriced_hours: 0,
      contracted_value: 0,
      scope_overage_hours: 0,
      currency,
    };
    current.time_entries += 1;
    current.hours += entry.hours;
    if (entry.billable) current.billable_hours += entry.hours;
    else current.non_billable_hours += entry.hours;
    current.cost_value += entry.cost_value;
    current.billable_value += entry.billable_value;
    if (entry.rate_status === 'missing') current.unpriced_hours += entry.hours;
    clientMap.set(key, current);
  }

  for (const baseline of baselines) {
    const current = clientMap.get(baseline.client_ref) || {
      client_ref: baseline.client_ref,
      time_entries: 0,
      hours: 0,
      billable_hours: 0,
      non_billable_hours: 0,
      cost_value: 0,
      billable_value: 0,
      margin_value: 0,
      margin_pct: null,
      unpriced_hours: 0,
      contracted_value: 0,
      scope_overage_hours: 0,
      currency,
    };
    current.contracted_value += Number(baseline.contracted_value || 0);
    clientMap.set(baseline.client_ref, current);
  }

  for (const client of clientMap.values()) {
    client.cost_value = _round(client.cost_value);
    client.billable_value = _round(client.billable_value);
    client.margin_value = _round(client.billable_value - client.cost_value);
    client.margin_pct = client.billable_value > 0
      ? _round((client.margin_value / client.billable_value) * 100)
      : null;
    client.hours = _round(client.hours);
    client.billable_hours = _round(client.billable_hours);
    client.non_billable_hours = _round(client.non_billable_hours);
    client.unpriced_hours = _round(client.unpriced_hours);
    client.contracted_value = _round(client.contracted_value);
    const clientSignals = signals.filter((signal) => signal.client_ref === client.client_ref);
    client.scope_overage_hours = _round(clientSignals.reduce((sum, signal) => sum + signal.overage_hours, 0));

    totals.hours += client.hours;
    totals.billable_hours += client.billable_hours;
    totals.non_billable_hours += client.non_billable_hours;
    totals.cost_value += client.cost_value;
    totals.billable_value += client.billable_value;
    totals.unpriced_hours += client.unpriced_hours;
    totals.contracted_value += client.contracted_value;
  }

  totals.hours = _round(totals.hours);
  totals.billable_hours = _round(totals.billable_hours);
  totals.non_billable_hours = _round(totals.non_billable_hours);
  totals.cost_value = _round(totals.cost_value);
  totals.billable_value = _round(totals.billable_value);
  totals.margin_value = _round(totals.billable_value - totals.cost_value);
  totals.margin_pct = totals.billable_value > 0
    ? _round((totals.margin_value / totals.billable_value) * 100)
    : null;
  totals.unpriced_hours = _round(totals.unpriced_hours);
  totals.contracted_value = _round(totals.contracted_value);

  return {
    ok: true,
    period: range,
    filters,
    totals,
    clients: Array.from(clientMap.values()).sort((a, b) => a.client_ref.localeCompare(b.client_ref)),
    scope_signals: signals,
  };
}

router.use(_agencyOpsTenantGuard);
router.use(agencyOpsSharedLimiter);

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.get('/time-entries', agencyOpsSharedLimiter, requirePermission('tenant.billing.manage'), _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:time-entries:list');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, entries: [] });
  const range = _range(req);
  const clientRef = _text(req.query?.client_ref, 'client_ref');
  const memberId = _text(req.query?.member_id, 'member_id');
  const entries = await _fetchEntries(_db.getPool(), tenantId, range, { clientRef, memberId }, { limit: 500 });
  res.json({ ok: true, period: range, entries });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.post('/time-entries', agencyOpsSharedLimiter, _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:time-entries:create');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const body = req.body || {};
  const memberId = _text(body.member_id, 'member_id', { required: true });
  const clientRef = _text(body.client_ref, 'client_ref', { required: true });
  const projectRef = _text(body.project_ref, 'project_ref');
  const workItem = _text(body.work_item, 'work_item', { required: true });
  const workDate = _date(body.work_date, 'work_date');
  const hours = _number(body.hours, 'hours', { min: 0.01, max: 24 });
  const billable = _bool(body.billable, true);
  const notes = _text(body.notes, 'notes', { max: 2000 }) || '';
  const pool = _db.getPool();
  await _assertMember(pool, tenantId, memberId);
  const id = _id('time_');
  const result = await pool.query(
    'INSERT INTO agency_time_entries ' +
    '(id, tenant_id, member_id, client_ref, project_ref, work_item, work_date, hours, billable, notes, updated_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *',
    [id, tenantId, memberId, clientRef, projectRef, workItem, workDate, hours, billable, notes],
  );
  res.status(201).json({ ok: true, entry: _entry(result.rows[0]) });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.patch('/time-entries/:id', agencyOpsSharedLimiter, _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:time-entries:update');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const body = req.body || {};
  const updates = [];
  const values = [req.params.id, tenantId];
  const add = (column, value) => {
    values.push(value);
    updates.push(column + '=$' + values.length);
  };
  if (Object.hasOwn(body, 'member_id')) {
    const memberId = _text(body.member_id, 'member_id', { required: true });
    await _assertMember(_db.getPool(), tenantId, memberId);
    add('member_id', memberId);
  }
  if (Object.hasOwn(body, 'client_ref')) add('client_ref', _text(body.client_ref, 'client_ref', { required: true }));
  if (Object.hasOwn(body, 'project_ref')) add('project_ref', _text(body.project_ref, 'project_ref'));
  if (Object.hasOwn(body, 'work_item')) add('work_item', _text(body.work_item, 'work_item', { required: true }));
  if (Object.hasOwn(body, 'work_date')) add('work_date', _date(body.work_date, 'work_date'));
  if (Object.hasOwn(body, 'hours')) add('hours', _number(body.hours, 'hours', { min: 0.01, max: 24 }));
  if (Object.hasOwn(body, 'billable')) add('billable', _bool(body.billable, true));
  if (Object.hasOwn(body, 'notes')) add('notes', _text(body.notes, 'notes', { max: 2000 }) || '');
  if (!updates.length) throw _bad('at least one editable field is required');
  updates.push('updated_at=NOW()');
  const result = await _db.getPool().query(
    'UPDATE agency_time_entries SET ' + updates.join(', ') +
    ' WHERE id=$1 AND tenant_id=$2 RETURNING *',
    values,
  );
  if (!result.rows.length) return _err(res, 404, 'time entry not found');
  res.json({ ok: true, entry: _entry(result.rows[0]) });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.get('/rates', agencyOpsSharedLimiter, requirePermission('tenant.billing.manage'), _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:rates:list');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rates: [] });
  const params = [tenantId];
  const where = ['tenant_id=$1'];
  const memberId = _text(req.query?.member_id, 'member_id');
  const role = _text(req.query?.role, 'role');
  if (memberId) {
    params.push(memberId);
    where.push('member_id=$' + params.length);
  }
  if (role) {
    params.push(role);
    where.push('role=$' + params.length);
  }
  if (req.query?.active !== undefined) {
    params.push(_bool(req.query.active, true));
    where.push('active=$' + params.length);
  }
  const result = await _db.getPool().query(
    'SELECT id, member_id, role, cost_rate, bill_rate, currency, effective_from, effective_to, active ' +
    'FROM agency_rate_cards WHERE ' + where.join(' AND ') +
    ' ORDER BY effective_from DESC, id DESC LIMIT 500',
    params,
  );
  res.json({ ok: true, rates: result.rows.map(_rate) });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.post('/rates', agencyOpsSharedLimiter, requirePermission('tenant.billing.manage'), _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:rates:create');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const body = req.body || {};
  const memberId = _text(body.member_id, 'member_id');
  const role = _text(body.role, 'role');
  if (!memberId && !role) throw _bad('member_id or role required');
  if (memberId) await _assertMember(_db.getPool(), tenantId, memberId);
  const costRate = _number(body.cost_rate, 'cost_rate', { min: 0, max: 1000000, fallback: 0 });
  const billRate = _number(body.bill_rate, 'bill_rate', { min: 0, max: 1000000, fallback: 0 });
  const currency = (_text(body.currency || 'USD', 'currency', { required: true, max: 10 }) || 'USD').toUpperCase();
  const effectiveFrom = _date(body.effective_from || new Date().toISOString().slice(0, 10), 'effective_from');
  const effectiveTo = _date(body.effective_to, 'effective_to', { required: false });
  if (effectiveTo && effectiveTo < effectiveFrom) throw _bad('effective_to must be on or after effective_from');
  const active = _bool(body.active, true);
  const id = _id('rate_');
  const result = await _db.getPool().query(
    'INSERT INTO agency_rate_cards ' +
    '(id, tenant_id, member_id, role, cost_rate, bill_rate, currency, effective_from, effective_to, active, updated_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *',
    [id, tenantId, memberId, role, costRate, billRate, currency, effectiveFrom, effectiveTo, active],
  );
  res.status(201).json({ ok: true, rate: _rate(result.rows[0]) });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.get('/scope-baselines', agencyOpsSharedLimiter, requirePermission('tenant.billing.manage'), _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:scope-baselines:list');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, baselines: [] });
  const range = _range(req);
  const clientRef = _text(req.query?.client_ref, 'client_ref');
  const baselines = await _fetchBaselines(_db.getPool(), tenantId, range, clientRef);
  res.json({ ok: true, period: range, baselines });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.post('/scope-baselines', agencyOpsSharedLimiter, requirePermission('tenant.billing.manage'), _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:scope-baselines:create');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const body = req.body || {};
  const clientRef = _text(body.client_ref, 'client_ref', { required: true });
  const projectRef = _text(body.project_ref, 'project_ref');
  const name = _text(body.name, 'name', { required: true });
  const periodStart = _date(body.period_start, 'period_start');
  const periodEnd = _date(body.period_end, 'period_end');
  if (periodEnd < periodStart) throw _bad('period_end must be on or after period_start');
  const contractedHours = _number(body.contracted_hours, 'contracted_hours', { min: 0, max: 1000000, fallback: 0 });
  const changeBudgetHours = _number(body.change_budget_hours, 'change_budget_hours', { min: 0, max: 1000000, fallback: 0 });
  const contractedValue = _number(body.contracted_value, 'contracted_value', { min: 0, max: 1000000000, fallback: 0 });
  const currency = (_text(body.currency || 'USD', 'currency', { required: true, max: 10 }) || 'USD').toUpperCase();
  const active = _bool(body.active, true);
  const id = _id('scope_');
  const result = await _db.getPool().query(
    'INSERT INTO agency_scope_baselines ' +
    '(id, tenant_id, client_ref, project_ref, name, period_start, period_end, contracted_hours, change_budget_hours, contracted_value, currency, active, updated_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *',
    [id, tenantId, clientRef, projectRef, name, periodStart, periodEnd, contractedHours, changeBudgetHours, contractedValue, currency, active],
  );
  res.status(201).json({ ok: true, baseline: result.rows[0] });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.get('/scope-signals', agencyOpsSharedLimiter, _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:scope-signals');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, period: _range(req), signals: [] });
  const range = _range(req);
  const clientRef = _text(req.query?.client_ref, 'client_ref');
  const pool = _db.getPool();
  const baselines = await _fetchBaselines(pool, tenantId, range, clientRef);
  const entryRange = _baselineRange(baselines);
  const entries = entryRange
    ? await _fetchEntries(pool, tenantId, entryRange, { clientRef })
    : [];
  res.json({ ok: true, period: range, signals: _scopeSignals(baselines, entries) });
}));

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.get('/summary', agencyOpsSharedLimiter, requirePermission('tenant.billing.manage'), _safe(async (req, res) => {
  const tenantId = await _tenantId(req, 'agency-ops:summary');
  if (!tenantId) return _err(res, 400, 'no_tenant');
  const range = _range(req);
  const filters = { client_ref: _text(req.query?.client_ref, 'client_ref') };
  if (!_db.hasDb()) return res.json(_emptySummary(range, filters));
  const pool = _db.getPool();
  const [entries, baselines] = await Promise.all([
    _fetchEntries(pool, tenantId, range, { clientRef: filters.client_ref }),
    _fetchBaselines(pool, tenantId, range, filters.client_ref),
  ]);
  res.json(_buildSummary(range, filters, entries, baselines));
}));

module.exports = router;
module.exports._buildSummary = _buildSummary;
module.exports._scopeSignals = _scopeSignals;
module.exports._fetchEntries = _fetchEntries;
module.exports._baselineRange = _baselineRange;

module.exports._agencyOpsTenantGuard = _agencyOpsTenantGuard;
module.exports._agencyOpsTenantId = _agencyOpsTenantId;
module.exports._agencyOpsRateLimiter = agencyOpsSharedLimiter;
module.exports.agencyOpsLimits = Object.freeze({
  windowMs: AGENCY_OPS_WINDOW_MS,
  max: AGENCY_OPS_MAX,
});
