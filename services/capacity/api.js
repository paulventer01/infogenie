'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { requirePermission } = require('../tenants/permission_enforce');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[capacity]', e.message);
    if (!res.headersSent) _err(res, e.statusCode || 500, e.statusCode ? e.message : 'internal error');
  });
}
function _id(prefix) { return prefix + crypto.randomBytes(5).toString('hex'); }
function _fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function _text(value, label, max = 200, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) _fail(`${label} must be ${empty ? '0' : '1'}..${max} characters`);
  return value.trim();
}
function _hours(value, label, max = 9999.99, min = 0) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) _fail(`${label} must be ${min}..${max}, at most 2 decimal places`);
  return Number(value);
}
function _date(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) _fail('due_date must be YYYY-MM-DD or null');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) _fail('due_date must be a real calendar date');
  return value;
}
function _status(value) {
  if (!['open', 'done', 'cancelled'].includes(value)) _fail('status must be open, done or cancelled');
  return value;
}
async function _withMember(tid, id, operation) {
  if (id === undefined) return operation(_db.getPool());
  id = _text(id, 'member_id');
  const client = await _db.getPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const r = await client.query('SELECT * FROM team_capacity WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, tid]);
    if (!r.rows.length) _fail('member_not_found', 404);
    const result = await operation(client, r.rows[0]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function _assertNoOpenWork(client, tid, id) {
  const r = await client.query("SELECT id FROM capacity_assignments WHERE member_id=$1 AND tenant_id=$2 AND status='open' LIMIT 1", [id, tid]);
  if (r.rows.length) _fail('Complete or cancel open assignments before deactivating this member', 409);
}

async function _loadAgentWorkload(tid, { strict = true } = {}) {
  if (!_db.hasDb()) return [];
  try {
    const r = await _db.getPool().query(
      `SELECT t.id, t.title, t.status, t.priority, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.action_type,
              g.title AS goal_title
         FROM agent_tasks t
         JOIN agent_goals g ON g.id = t.goal_id
        WHERE g.tenant_id = $1
          AND t.tenant_id = $1
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
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

async function _buildSummary(tid) {
  if (!_db.hasDb()) _fail('database not configured', 503);
  const pool = _db.getPool();
  const membersR = await pool.query(
    `SELECT * FROM team_capacity WHERE tenant_id=$1 AND active=true ORDER BY member_name`,
    [tid],
  );
  const assignR = await pool.query(
    `SELECT *, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM capacity_assignments
      WHERE tenant_id=$1 AND status='open'
      ORDER BY due_date ASC NULLS LAST`,
    [tid],
  );
  const agentWork = await _loadAgentWorkload(tid, { strict: true });
  const openAgentTasksR = await pool.query(
    `SELECT COUNT(*)::int AS open_agent_tasks
       FROM agent_tasks t
       JOIN agent_goals g ON g.id = t.goal_id
      WHERE g.tenant_id = $1
        AND t.tenant_id = $1
        AND t.status NOT IN ('done','cancelled','skipped')`,
    [tid],
  );
  // The workload list is intentionally capped for recommendations, but the
  // dashboard total must represent the tenant's complete open-task backlog.
  const openAgentTasks = openAgentTasksR.rows.length
    ? Number(openAgentTasksR.rows[0].open_agent_tasks || 0)
    : agentWork.length;
  const loggedR = await pool.query(
    `SELECT member_id, COALESCE(SUM(hours), 0) AS logged_hours
       FROM agency_time_entries
      WHERE tenant_id=$1
        AND work_date >= date_trunc('week', CURRENT_DATE)::date
        AND work_date < (date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')::date
      GROUP BY member_id`,
    [tid],
  );
  const loggedByMember = new Map(
    loggedR.rows.map((row) => [String(row.member_id), Number(row.logged_hours || 0)]),
  );

  const members = membersR.rows.map((m) => {
    const assigned = assignR.rows.filter((a) => a.member_id === m.id);
    const assignedHours = assigned.reduce((s, a) => s + Number(a.hours || 0), 0);
    const weekly = Number(m.weekly_hours ?? 40);
    const allocated = Number(m.allocated_hours || 0) + assignedHours;
    const loggedHours = loggedByMember.get(String(m.id)) || 0;
    const util = weekly > 0 ? Math.round((allocated / weekly) * 100) : 0;
    const loggedUtil = weekly > 0 ? Math.round((loggedHours / weekly) * 100) : 0;
    let load = 'available';
    if (util >= 110 || (weekly === 0 && (allocated > 0 || loggedHours > 0 || assigned.length))) load = 'overloaded';
    else if (util >= 85) load = 'at_capacity';
    else if (util >= 50) load = 'busy';
    return {
      ...m,
      weekly_hours: weekly,
      zero_capacity_with_work: weekly === 0 && (allocated > 0 || loggedHours > 0 || assigned.length > 0),
      allocated_hours: allocated,
      utilization_pct: util,
      logged_hours: loggedHours,
      logged_utilization_pct: loggedUtil,
      load,
      open_assignments: assigned.length,
      assignments: assigned,
    };
  });

  const totalHours = members.reduce((s, m) => s + m.weekly_hours, 0);
  const usedHours = members.reduce((s, m) => s + m.allocated_hours, 0);
  const unassignedHours = agentWork.reduce((s, w) => s + w.estimated_hours, 0);
  const remainingHours = Math.max(0, totalHours - usedHours);
  const loggedHours = members.reduce((sum, member) => sum + member.logged_hours, 0);

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
        ? candidate.weekly_hours === 0 ? `${candidate.member_name} has no weekly availability` : `${candidate.member_name} has ${Math.max(0, candidate.weekly_hours - candidate.allocated_hours)}h free (${candidate.utilization_pct}% util)`
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
      open_agent_tasks: openAgentTasks,
      logged_hours: loggedHours,
      logged_utilization_pct: totalHours > 0 ? Math.round((loggedHours / totalHours) * 100) : 0,
    },
  };
}

router.get('/summary', requirePermission('manage.projects.view'), _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:summary' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  // GET /summary is universally side-effect-free: dashboard and legacy
  // consumers read the existing tenant roster without bootstrapping a member.
  res.json(await _buildSummary(tid));
}));

router.get('/members', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:members' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
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
  const name = _text(member_name, 'member_name'), memberRole = _text(role, 'role');
  const weekly = _hours(weekly_hours, 'weekly_hours', 168), allocated = _hours(allocated_hours, 'allocated_hours');
  if (notes !== null) _text(notes, 'notes', 2000, true);
  const memberNotes = notes;
  if (typeof active !== 'boolean') _fail('active must be boolean');
  if (skills !== null && (!Array.isArray(skills) || skills.length > 30)) _fail('skills must be null or a list of at most 30 strings');
  const memberSkills = skills === null ? null : skills.map((skill) => { _text(skill, 'skill', 100); return skill; });
  const mid = id === undefined ? _id('cap_') : _text(id, 'id');
  await _withMember(tid, id, async (pool) => {
    if (!active && id !== undefined) await _assertNoOpenWork(pool, tid, mid);
    const result = await pool.query(
      `INSERT INTO team_capacity
       (id, tenant_id, member_name, role, weekly_hours, allocated_hours, skills, notes, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (id) DO UPDATE SET
       member_name=EXCLUDED.member_name, role=EXCLUDED.role,
       weekly_hours=EXCLUDED.weekly_hours, allocated_hours=EXCLUDED.allocated_hours,
       skills=EXCLUDED.skills, notes=EXCLUDED.notes, active=EXCLUDED.active,
       updated_at=NOW()
     WHERE team_capacity.tenant_id = EXCLUDED.tenant_id RETURNING id`,
      [mid, tid, name, memberRole, weekly, allocated, memberSkills === null ? null : JSON.stringify(memberSkills), memberNotes, active],
    );
    if (!result.rows.length) _fail('member_not_found', 404);
  });
  res.json({ ok: true, id: mid });
}));

router.delete('/members/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:member-del' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  await _withMember(tid, req.params.id, async (pool) => {
    await _assertNoOpenWork(pool, tid, req.params.id);
    const result = await pool.query(
      `UPDATE team_capacity SET active=false, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [req.params.id, tid],
    );
    if (!result.rows.length) _fail('member_not_found', 404);
  });
  res.json({ ok: true });
}));

async function _saveAssignment(tid, body, existingId = null) {
  const {
    member_id, work_item, hours = 2, due_date = null,
    source = 'manual', source_ref = null, status = 'open',
  } = body || {};
  const memberId = _text(member_id, 'member_id'), title = _text(work_item, 'work_item');
  const amount = _hours(hours, 'hours', 9999.99, 0.01), due = _date(due_date);
  _status(status);
  if (source !== 'manual' && source !== 'agent_tasks') _fail('source must be manual or agent_tasks');
  if (source === 'manual' && source_ref !== null) _fail('manual source requires null source_ref');
  if (source === 'agent_tasks' && (typeof source_ref !== 'string' || !/^agent_task:[1-9]\d{0,9}$/.test(source_ref) || Number(source_ref.slice(11)) > 2147483647)) _fail('source_ref must be agent_task:<id>');
  const aid = existingId || _id('asg_');
  await _withMember(tid, memberId, async (pool, member) => {
    if (!member.active) _fail('member_inactive', 409);
    if (source === 'agent_tasks') {
      // Lock the owned task and goal before checking duplicates on a fresh statement snapshot.
      const task = await pool.query(`SELECT t.id FROM agent_tasks t JOIN agent_goals g ON g.id=t.goal_id
      WHERE t.id=$1 AND t.tenant_id=$2 AND g.tenant_id=$2 AND g.status='active'
        AND t.status IN ('pending','open','in_progress') FOR UPDATE OF t, g`, [source_ref.slice(11), tid]);
      if (!task.rows.length) _fail('open_agent_task_not_found', 404);
      const duplicate = await pool.query("SELECT id FROM capacity_assignments WHERE tenant_id=$1 AND source_ref=$2 AND status='open' AND id<>$3 LIMIT 1", [tid, source_ref, aid]);
      if (status === 'open' && duplicate.rows.length) _fail('agent_task_already_assigned', 409);
    }
    if (existingId) {
      const r = await pool.query('UPDATE capacity_assignments SET status=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id', [status, aid, tid]);
      if (!r.rows.length) _fail('assignment_not_found', 404);
      return;
    }
    await pool.query(
      `INSERT INTO capacity_assignments
       (id, tenant_id, member_id, work_item, source, source_ref, hours, due_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [aid, tid, memberId, title, source, source_ref, amount, due, status],
    );
  });
  return aid;
}

router.post('/assignments', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:assign' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const aid = await _saveAssignment(tid, req.body);
  res.json({ ok: true, id: aid });
}));

router.patch('/assignments/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:assign-patch' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const status = _status(req.body?.status);
  if (status === 'open') {
    const r = await _db.getPool().query("SELECT *, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM capacity_assignments WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!r.rows.length) _fail('assignment_not_found', 404);
    await _saveAssignment(tid, { ...r.rows[0], status }, req.params.id);
    return res.json({ ok: true });
  }
  const result = await _db.getPool().query(
    `UPDATE capacity_assignments SET status=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id`,
    [status, req.params.id, tid],
  );
  if (!result.rows.length) _fail('assignment_not_found', 404);
  res.json({ ok: true });
}));

// Auto-assign an agent task (or arbitrary work) to the least-loaded member
router.post('/assign-best', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'capacity:assign-best' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'database not configured');
  const taskId = req.body?.task_id;
  if (taskId !== undefined && (!['number', 'string'].includes(typeof taskId) || !/^[1-9]\d{0,9}$/.test(String(taskId)) || Number(taskId) > 2147483647)) _fail('task_id must be a positive integer');
  const workItem = req.body?.work_item === undefined ? '' : _text(req.body.work_item, 'work_item');
  const hours = req.body?.hours === undefined ? null : _hours(req.body.hours, 'hours', 9999.99, 0.01);
  const dueDate = _date(req.body?.due_date === undefined ? null : req.body.due_date);
  const source = taskId !== undefined ? 'agent_tasks' : 'manual', sourceRef = taskId !== undefined ? `agent_task:${taskId}` : null;
  if ((req.body?.source !== undefined && req.body.source !== source) || (req.body?.source_ref !== undefined && req.body.source_ref !== sourceRef)) _fail('source/source_ref must match task_id');
  _status(req.body?.status === undefined ? 'open' : req.body.status);
  const summary = await _buildSummary(tid);

  let rec = null;
  if (taskId != null) {
    rec = (summary.recommendations || []).find((r) => String(r.task_id) === String(taskId));
    if (!rec) return _err(res, 404, 'unassigned_open_agent_task_not_found');
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

  const title = rec.task_title || workItem;
  const est = hours || rec.estimated_hours || 2;
  const aid = await _saveAssignment(tid, { ...req.body,
    member_id: rec.suggested_member_id, work_item: title, hours: est,
    due_date: req.body?.due_date === undefined ? rec.due_date ?? null : dueDate, source, source_ref: sourceRef,
  });
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
  );
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
  );

  if (!users.rows.length) {
    return res.json({
      ok: true,
      seeded: 0,
      added: [],
      limit: 40, skipped: 0,
      note: 'No workspace users found to seed. Invite teammates, then try again.',
    });
  }

  let seeded = 0;
  const added = [];
  let skipped = 0;
  for (const u of users.rows) {
    const name = (u.name || u.email || `User ${u.id}`).trim();
    const keyName = name.toLowerCase();
    const keyEmail = String(u.email || '').trim().toLowerCase();
    const keyUser = `user:${u.id}`;
    if (taken.has(keyName) || taken.has(keyUser) || (keyEmail && taken.has(keyEmail))) continue;
    try { _text(name, 'member_name'); _text(u.role_name || u.role_key || 'marketer', 'role'); }
    catch (_) { skipped += 1; continue; }

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
    limit: 40, skipped,
    note: `Checks at most 40 workspace users. ${skipped ? `${skipped} invalid users skipped. ` : ''}${seeded ? '' : 'No new members added.'}`,
  });
}));

module.exports = router;
module.exports.buildSummary = _buildSummary;
