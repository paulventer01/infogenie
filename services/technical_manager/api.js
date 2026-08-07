'use strict';

const express = require('express');
const router = express.Router();
const _tenantCtx = require('../tenants/context');
const { runTechnicalScan } = require('./scan');
const _db = require('../../db');
const crypto = require('crypto');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[technical-manager]', e.message);
    if (!res.headersSent) _err(res, 500, e.message || 'internal error');
  });
}

async function _ensureCapacityMember(tid) {
  if (!_db.hasDb() || tid == null) return null;
  const pool = _db.getPool();
  const existing = await pool.query(
    `SELECT id FROM team_capacity
      WHERE tenant_id=$1 AND active=true
        AND (lower(role) LIKE '%technical%manager%' OR lower(member_name) = 'technical manager')
      LIMIT 1`,
    [tid],
  ).catch(() => ({ rows: [] }));
  if (existing.rows[0]) return existing.rows[0].id;
  const id = 'cap_' + crypto.randomBytes(5).toString('hex');
  await pool.query(
    `INSERT INTO team_capacity
       (id, tenant_id, member_name, role, weekly_hours, allocated_hours, skills, notes, active, updated_at)
     VALUES ($1,$2,$3,$4,40,8,$5,$6,true,NOW())`,
    [
      id, tid, 'Technical Manager', 'Technical Manager',
      JSON.stringify(['platform ops', 'page/feature monitoring', 'security', 'API monitoring', 'LLM ops', 'tenant isolation', 'change control']),
      'Senior AI Team officer — monitors every InfoGenie page, subpage and feature in real time plus APIs, LLMs, auth, tokens, security, updates, and daily management status.',
    ],
  ).catch(() => {});
  return id;
}

async function _scanResponse(req, res) {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'technical-manager:scan' });
  if (!tid) return _err(res, 400, 'no_tenant');
  await _ensureCapacityMember(tid);
  const snapshot = await runTechnicalScan(tid);
  res.json({ ok: true, snapshot, generatedAt: snapshot.generated_at });
}

// GET /api/technical-manager/scan — live poll used by the Technical Manager desk
router.get('/scan', _safe(_scanResponse));

// POST /api/technical-manager/scan — force refresh (same payload)
router.post('/scan', _safe(_scanResponse));

// GET /api/technical-manager/status — lighter live poll
router.get('/status', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'technical-manager:status' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const snapshot = await runTechnicalScan(tid);
  res.json({
    ok: true,
    overall: snapshot.overall,
    counts: snapshot.counts,
    events: snapshot.events.slice(0, 12),
    plan_of_action: snapshot.plan_of_action.slice(0, 6),
    generated_at: snapshot.generated_at,
    runtime: snapshot.runtime,
  });
}));

// POST /api/technical-manager/ensure-roster — add Technical Manager to Capacity
router.post('/ensure-roster', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'technical-manager:ensure-roster' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const id = await _ensureCapacityMember(tid);
  res.json({ ok: true, id, member_name: 'Technical Manager', role: 'Technical Manager' });
}));

// POST /api/technical-manager/report — approval package for management
router.post('/report', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'technical-manager:report' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const snapshot = await runTechnicalScan(tid);
  const report = {
    title: 'Technical Manager — System Status Report',
    overall: snapshot.overall,
    generated_at: snapshot.generated_at,
    executive_summary:
      snapshot.overall === 'healthy'
        ? 'InfoGenie platform checks are healthy. No critical API, auth, or LLM failures detected. Continue live monitoring and daily management updates.'
        : `InfoGenie status is ${snapshot.overall.toUpperCase()}: ${snapshot.counts.critical} critical and ${snapshot.counts.high} high events require attention. Plan of action prepared for management approval.`,
    events: snapshot.events,
    plan_of_action: snapshot.plan_of_action,
    tooling_gaps: snapshot.tooling_gaps,
    integrations: snapshot.integrations.configured,
    meeting_update: snapshot.meeting_note,
  };
  res.json({ ok: true, report });
}));

module.exports = router;
module.exports.runTechnicalScan = runTechnicalScan;
module.exports.ensureCapacityMember = _ensureCapacityMember;
