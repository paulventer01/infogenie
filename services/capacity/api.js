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
  const remainingHours = Math.max(0, totalHours - usedHours);

  // Recommendations: pair top unassigned tasks with least-loaded members
  const sortedMembers = [...members].sort((a, b) => a.utilization_pct - b.utilization_pct);
  const recommendations = [];
  const alreadyAssignedRefs = new Set(
    assignR.rows.filter((a) => a.source_ref).map((a) => String(a.source_ref)),
  );
  const openTasks = agentWork.filter((t) => !alreadyAssignedRefs.has(`agent_task:${t.id}`));
  for (const task of openTasks.slice(0, 12)) {
    const candidate = sortedMembers.find((m) => {
      const room = m.weekly_hours - m.allocated_hours;
      return room >= (task.estimated_hours || 1) && m.load !== 'overloaded';
    }) || sortedMembers[0] || null;
    recommendations.push({
      task_id: task.id,
      task_title: task.title,
      goal_title: task.goal_title,
      estimated_hours: task.estimated_hours,
      priority: task.priority,
      due_date: task.due_date,
      suggested_member_id: candidate?.id || null,
      suggested_member_name: candidate?.member_name || null,
      reason: candidate
        ? `${candidate.member_name} has ${Math.max(0, candidate.weekly_hours - candidate.allocated_hours)}h free (${candidate.utilization_pct}% util)`
        : 'No teammates configured — add capacity members first',
    });
  }

  const alerts = [];
  if (members.some((m) => m.load === 'overloaded')) {
    alerts.push({
      severity: 'high',
      message: `${members.filter((m) => m.load === 'overloaded').length} teammate(s) overloaded — rebalance before accepting more work.`,
    });
  }
  if (openTasks.length && remainingHours < unassignedHours) {
    alerts.push({
      severity: 'medium',
      message: `Queue needs ~${unassignedHours}h but only ${remainingHours}h free this week.`,
    });
  }
  if (!members.length) {
    alerts.push({
      severity: 'medium',
      message: 'No capacity roster yet — seed from workspace users or add members.',
    });
  }

  return {
    ok: true,
    members,
    agent_workload: agentWork,
    recommendations,
    alerts,
    totals: {
      members: members.length,
      weekly_hours: totalHours,
      allocated_hours: usedHours,
      remaining_hours: remainingHours,
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
  // Ensure senior Technical Manager always appears on the human roster
  try {
    const { ensureCapacityMember } = require('../technical_manager/api');
    await ensureCapacityMember(tid);
  } catch (_) { /* optional */ }
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

// Auto-assign an agent task (or arbitrary work) to the least-loaded member
router.post('/assign-best', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:assign-best' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const summary = await _buildSummary(tid);
  const taskId = req.body?.task_id;
  const workItem = String(req.body?.work_item || '').trim();
  const hours = Number(req.body?.hours) || null;
  const dueDate = req.body?.due_date || null;

  let rec = null;
  if (taskId != null) {
    rec = (summary.recommendations || []).find((r) => String(r.task_id) === String(taskId));
  }
  if (!rec && workItem) {
    const candidate = [...summary.members].sort((a, b) => a.utilization_pct - b.utilization_pct)
      .find((m) => m.load !== 'overloaded');
    rec = {
      task_title: workItem,
      estimated_hours: hours || 2,
      suggested_member_id: candidate?.id,
      suggested_member_name: candidate?.member_name,
      due_date: dueDate,
    };
  }
  if (!rec?.suggested_member_id) {
    return _err(res, 400, 'no_available_member');
  }

  const aid = _id('asg_');
  const title = rec.task_title || workItem;
  const est = hours || rec.estimated_hours || 2;
  const sourceRef = taskId != null ? `agent_task:${taskId}` : null;
  await _db.getPool().query(
    `INSERT INTO capacity_assignments
       (id, tenant_id, member_id, work_item, source, source_ref, hours, due_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
    [aid, tid, rec.suggested_member_id, title, taskId != null ? 'agent_tasks' : 'manual', sourceRef, est, rec.due_date || dueDate],
  );
  res.json({
    ok: true,
    id: aid,
    member_id: rec.suggested_member_id,
    member_name: rec.suggested_member_name,
    hours: est,
    work_item: title,
  });
}));

// Seed roster from tenant_users — merges any workspace users not already listed
router.post('/seed-from-users', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:seed' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const pool = _db.getPool();

  const existing = await pool.query(
    `SELECT id, member_name, notes FROM team_capacity WHERE tenant_id=$1 AND active=true`,
    [tid],
  ).catch(() => ({ rows: [] }));
  const taken = new Set();
  for (const m of existing.rows || []) {
    const nm = String(m.member_name || '').trim().toLowerCase();
    if (nm) taken.add(nm);
    const noteMatch = String(m.notes || '').match(/seeded from user (\d+)/i);
    if (noteMatch) taken.add(`user:${noteMatch[1]}`);
  }

  const users = await pool.query(
    `SELECT u.id, u.name, u.email, r.key AS role_key, r.name AS role_name
       FROM tenant_users tu
       JOIN users u ON u.id = tu.user_id
       LEFT JOIN roles r ON r.id = tu.role_id
      WHERE tu.tenant_id=$1 AND tu.status IN ('active','invited')
      ORDER BY u.name NULLS LAST, u.email
      LIMIT 40`,
    [tid],
  ).catch(() => ({ rows: [] }));

  if (!users.rows.length) {
    return res.json({
      ok: true,
      seeded: 0,
      added: [],
      note: 'No workspace users found to seed. Invite teammates, then try again.',
    });
  }

  let seeded = 0;
  const added = [];
  for (const u of users.rows) {
    const name = (u.name || u.email || `User ${u.id}`).trim();
    const keyName = name.toLowerCase();
    const keyEmail = String(u.email || '').trim().toLowerCase();
    const keyUser = `user:${u.id}`;
    if (taken.has(keyName) || taken.has(keyUser) || (keyEmail && taken.has(keyEmail))) continue;

    const mid = _id('cap_');
    await pool.query(
      `INSERT INTO team_capacity
         (id, tenant_id, member_name, role, weekly_hours, allocated_hours, skills, notes, active, updated_at)
       VALUES ($1,$2,$3,$4,40,0,'[]',$5,true,NOW())`,
      [mid, tid, name, u.role_name || u.role_key || 'marketer', `seeded from user ${u.id}`],
    );
    seeded += 1;
    added.push(name);
    taken.add(keyName);
    taken.add(keyUser);
    if (keyEmail) taken.add(keyEmail);
  }

  res.json({
    ok: true,
    seeded,
    added,
    note: seeded
      ? undefined
      : 'All workspace users are already on the roster',
  });
}));

module.exports = router;
module.exports.buildSummary = _buildSummary;
