'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[capacity]', e.message);
    if (!res.headersSent) _err(res, 500, e.message || 'internal error');
  });
}
function _id(prefix) { return prefix + crypto.randomBytes(5).toString('hex'); }

async function _loadAgentWorkload(tid) {
  if (!_db.hasDb()) return [];
  try {
    const r = await _db.getPool().query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.action_type,
              g.title AS goal_title
         FROM agent_tasks t
         JOIN agent_goals g ON g.id = t.goal_id
        WHERE g.tenant_id = $1
          AND t.status NOT IN ('done','cancelled','skipped')
        ORDER BY t.priority ASC NULLS LAST, t.due_date ASC NULLS LAST
        LIMIT 100`,
      [tid],
    );
    return r.rows.map((row) => {
      // agent_tasks.priority is INT (1=high … 3=low) in schema
      const p = Number(row.priority);
      const estimated_hours = p === 1 ? 4 : p === 2 ? 2 : 1;
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        priority: p === 1 ? 'high' : p === 2 ? 'medium' : 'low',
        due_date: row.due_date,
        action_type: row.action_type,
        goal_title: row.goal_title,
        estimated_hours,
        source: 'agent_tasks',
      };
    });
  } catch {
    return [];
  }
}

async function _buildSummary(tid) {
  const pool = _db.getPool();
  const membersR = await pool.query(
    `SELECT * FROM team_capacity WHERE tenant_id=$1 AND active=true ORDER BY member_name`,
    [tid],
  ).catch(() => ({ rows: [] }));
  const assignR = await pool.query(
    `SELECT * FROM capacity_assignments
      WHERE tenant_id=$1 AND status='open'
      ORDER BY due_date ASC NULLS LAST`,
    [tid],
  ).catch(() => ({ rows: [] }));
  const agentWork = await _loadAgentWorkload(tid);

  const members = membersR.rows.map((m) => {
    const assigned = assignR.rows.filter((a) => a.member_id === m.id);
    const assignedHours = assigned.reduce((s, a) => s + Number(a.hours || 0), 0);
    const weekly = Number(m.weekly_hours || 40);
    const allocated = Number(m.allocated_hours || 0) + assignedHours;
    const util = weekly > 0 ? Math.round((allocated / weekly) * 100) : 0;
    let load = 'available';
    if (util >= 110) load = 'overloaded';
    else if (util >= 85) load = 'at_capacity';
    else if (util >= 50) load = 'busy';
    return {
      ...m,
      weekly_hours: weekly,
      allocated_hours: allocated,
      utilization_pct: util,
      load,
      open_assignments: assigned.length,
      assignments: assigned,
    };
  });

  const totalHours = members.reduce((s, m) => s + m.weekly_hours, 0);
  const usedHours = members.reduce((s, m) => s + m.allocated_hours, 0);
  const unassignedHours = agentWork.reduce((s, w) => s + w.estimated_hours, 0);

  return {
    ok: true,
    members,
    agent_workload: agentWork,
    totals: {
      members: members.length,
      weekly_hours: totalHours,
      allocated_hours: usedHours,
      utilization_pct: totalHours > 0 ? Math.round((usedHours / totalHours) * 100) : 0,
      overloaded: members.filter((m) => m.load === 'overloaded').length,
      at_capacity: members.filter((m) => m.load === 'at_capacity').length,
      available: members.filter((m) => m.load === 'available' || m.load === 'busy').length,
      unassigned_task_hours: unassignedHours,
      open_agent_tasks: agentWork.length,
    },
  };
}

router.get('/summary', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:summary' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) {
    return res.json({
      ok: true,
      members: [],
      agent_workload: [],
      totals: {
        members: 0, weekly_hours: 0, allocated_hours: 0, utilization_pct: 0,
        overloaded: 0, at_capacity: 0, available: 0, unassigned_task_hours: 0, open_agent_tasks: 0,
      },
    });
  }
  res.json(await _buildSummary(tid));
}));

router.get('/members', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:members' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, members: [] });
  const r = await _db.getPool().query(
    `SELECT * FROM team_capacity WHERE tenant_id=$1 ORDER BY active DESC, member_name`,
    [tid],
  );
  res.json({ ok: true, members: r.rows });
}));

router.post('/members', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:member-save' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const {
    id, member_name, role = 'marketer', weekly_hours = 40,
    allocated_hours = 0, skills = [], notes = '', active = true,
  } = req.body || {};
  if (!member_name || !String(member_name).trim()) return _err(res, 400, 'member_name required');
  const mid = id || _id('cap_');
  await _db.getPool().query(
    `INSERT INTO team_capacity
       (id, tenant_id, member_name, role, weekly_hours, allocated_hours, skills, notes, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (id) DO UPDATE SET
       member_name=EXCLUDED.member_name, role=EXCLUDED.role,
       weekly_hours=EXCLUDED.weekly_hours, allocated_hours=EXCLUDED.allocated_hours,
       skills=EXCLUDED.skills, notes=EXCLUDED.notes, active=EXCLUDED.active,
       updated_at=NOW()
     WHERE team_capacity.tenant_id = EXCLUDED.tenant_id`,
    [
      mid, tid, String(member_name).trim(), String(role || 'marketer'),
      Number(weekly_hours) || 40, Number(allocated_hours) || 0,
      JSON.stringify(Array.isArray(skills) ? skills : []),
      String(notes || ''), !!active,
    ],
  );
  res.json({ ok: true, id: mid });
}));

router.delete('/members/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:member-del' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  await _db.getPool().query(
    `UPDATE team_capacity SET active=false, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid],
  );
  res.json({ ok: true });
}));

router.post('/assignments', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:assign' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const {
    member_id, work_item, hours = 2, due_date = null,
    source = 'manual', source_ref = null, status = 'open',
  } = req.body || {};
  if (!member_id || !work_item) return _err(res, 400, 'member_id + work_item required');
  const aid = _id('asg_');
  await _db.getPool().query(
    `INSERT INTO capacity_assignments
       (id, tenant_id, member_id, work_item, source, source_ref, hours, due_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      aid, tid, member_id, String(work_item).trim(), source, source_ref,
      Number(hours) || 0, due_date || null, status,
    ],
  );
  res.json({ ok: true, id: aid });
}));

router.patch('/assignments/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:assign-patch' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const status = String(req.body?.status || 'done');
  await _db.getPool().query(
    `UPDATE capacity_assignments SET status=$1 WHERE id=$2 AND tenant_id=$3`,
    [status, req.params.id, tid],
  );
  res.json({ ok: true });
}));

module.exports = router;
module.exports.buildSummary = _buildSummary;
