'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
// Deliberately never use the application's DATABASE_URL or boot its schemas.
const TEST_URL = process.env.PR10E7_TEST_DATABASE_URL;
const skip = !TEST_URL && process.env.PR10E7_REQUIRE_DATABASE !== '1'
  ? 'no PR10E7_TEST_DATABASE_URL — capacity PostgreSQL eligibility tests skipped' : false;
const ALLOWED = ['pending', 'open', 'in_progress'];
const DISALLOWED = ['done', 'cancelled', 'skipped', 'failed', 'blocked', 'queued', 'running', 'unknown_future', 'OPEN', ''];
const NONACTIVE = ['archived', 'paused', 'completed', 'cancelled', 'failed', 'draft', 'unknown_future', 'ACTIVE', ''];

// Same isolated module seam as capacity-controls-permissions.test.js; no cache
// or global environment changes. Service SQL executes unchanged.
function load(relative, overrides) {
  const filename = path.join(ROOT, relative), module = { exports: {} };
  const localRequire = createRequire(filename);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name), module, module.exports,
  );
  return module.exports;
}

function capacity(query) {
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const db = { hasDb: () => true, getPool: () => pool };
  return load('services/capacity/api.js', {
    '../../db': db,
    '../tenants/context': load('services/tenants/context.js', {
      '../../db': db, '../security/prod_defaults': { multitenantMode: () => 'on' },
    }),
    '../tenants/permission_enforce': load('services/tenants/permission_enforce.js', {
      '../security/prod_defaults': { permissionMode: () => 'on' },
    }),
    '../security/rate_limit': load('services/security/rate_limit.js', {
      '../infra/redis': { isRedisConfigured: () => false },
    }),
  });
}

async function fixture(t) {
  assert.ok(TEST_URL, 'PR10E7_TEST_DATABASE_URL is required when PR10E7_REQUIRE_DATABASE=1');
  const client = new Client({ connectionString: TEST_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  t.after(() => client.end());
  // Restrict name resolution before creating anything: even a missing fixture
  // table cannot fall through to an existing public/application table.
  await client.query('SET search_path TO pg_temp');
  // Relevant production column types/FKs, with connection-local fixture data.
  // A new connection per test isolates IDs, transactions and automatic cleanup.
  for (const ddl of [
    `CREATE TEMP TABLE agent_goals (
      id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active')`,
    `CREATE TEMP TABLE agent_tasks (
      id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
      goal_id INT NOT NULL REFERENCES agent_goals(id), title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', priority INT NOT NULL DEFAULT 2,
      due_date DATE, action_type TEXT NOT NULL DEFAULT 'manual')`,
    `CREATE TEMP TABLE team_capacity (
      id TEXT PRIMARY KEY, tenant_id INT NOT NULL, member_name TEXT NOT NULL,
      weekly_hours NUMERIC(6,2) NOT NULL DEFAULT 40,
      allocated_hours NUMERIC(6,2) NOT NULL DEFAULT 0, active BOOLEAN DEFAULT true)`,
    `CREATE TEMP TABLE capacity_assignments (
      id TEXT PRIMARY KEY, tenant_id INT NOT NULL,
      member_id TEXT NOT NULL REFERENCES team_capacity(id), work_item TEXT NOT NULL,
      source TEXT DEFAULT 'manual', source_ref TEXT, hours NUMERIC(6,2) NOT NULL DEFAULT 0,
      due_date DATE, status TEXT DEFAULT 'open')`,
    `CREATE TEMP TABLE agency_time_entries (
      id TEXT PRIMARY KEY, tenant_id INT NOT NULL, member_id TEXT NOT NULL,
      work_date DATE NOT NULL, hours NUMERIC(8,2) NOT NULL)`,
  ]) await client.query(ddl);
  const queries = [];
  const router = capacity((sql, params) => {
    queries.push({ sql, params });
    return client.query(sql, params);
  });
  return {
    client, router, queries,
    async goal(status = 'active', tid = 101) {
      const r = await client.query('INSERT INTO agent_goals (tenant_id,title,status) VALUES ($1,$2,$3) RETURNING id',
        [tid, `Goal ${tid} ${status}`, status]);
      return r.rows[0].id;
    },
    async task(goalId, status = 'pending', tid = 101, priority = 2, due = null) {
      const r = await client.query(`INSERT INTO agent_tasks (tenant_id,goal_id,title,status,priority,due_date)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [tid, goalId, `Task ${tid} ${status}`, status, priority, due]);
      return r.rows[0].id;
    },
    async summary(tid = 101) {
      queries.length = 0;
      const result = await router.buildSummary(tid);
      for (const { sql, params } of queries) {
        assert.match(sql.trim(), /^SELECT\b/, 'summary must remain read-only');
        assert.deepEqual(params, [tid]);
      }
      return result;
    },
  };
}

const workloadIds = (summary) => summary.agent_workload.map((row) => row.id);
const recommendationIds = (summary) => summary.recommendations.map((row) => row.task_id);

async function stateMatrix(f) {
  const activeGoal = await f.goal();
  const eligible = [], rejected = [];
  for (const state of ALLOWED) eligible.push(await f.task(activeGoal, state));
  for (const state of DISALLOWED) rejected.push(await f.task(activeGoal, state));
  for (const state of NONACTIVE) {
    const goal = await f.goal(state);
    for (const taskState of ALLOWED) rejected.push(await f.task(goal, taskState));
  }
  return { activeGoal, eligible, rejected };
}

test('PostgreSQL: workload, recommendations and total require active goals and exact eligible task states', { skip }, async (t) => {
  const f = await fixture(t);
  const { eligible } = await stateMatrix(f);
  const summary = await f.summary();
  assert.deepEqual(new Set(workloadIds(summary)), new Set(eligible));
  assert.deepEqual(new Set(recommendationIds(summary)), new Set(eligible));
  assert.deepEqual(new Set(summary.agent_workload.map((row) => row.status)), new Set(ALLOWED));
  assert.equal(summary.totals.unassigned_task_hours, 6);
  assert.equal(summary.totals.open_agent_tasks, 3);
  await f.client.query("UPDATE agent_goals SET status='archived' WHERE tenant_id=$1", [101]);
  const empty = await f.summary();
  assert.equal(empty.totals.open_agent_tasks, 0);
  assert.deepEqual(empty.agent_workload, []);
  assert.deepEqual(empty.recommendations, []);
  assert.equal(empty.totals.unassigned_task_hours, 0);
});

test('PostgreSQL: task and goal ownership independently bound workload, recommendations and total for both tenants', { skip }, async (t) => {
  const f = await fixture(t);
  const goalA = await f.goal('active', 101), goalB = await f.goal('active', 202);
  const expected = new Map([[101, []], [202, []]]);
  for (const status of ALLOWED) {
    expected.get(101).push(await f.task(goalA, status, 101));
    expected.get(202).push(await f.task(goalB, status, 202));
    // Deliberately inconsistent ownership permitted by the parent-id FK:
    // removing either tenant predicate must leak a different row.
    await f.task(goalA, status, 202);
    await f.task(goalB, status, 101);
  }
  for (const [tid, ids] of expected) {
    const summary = await f.summary(tid);
    assert.deepEqual(new Set(workloadIds(summary)), new Set(ids), `tenant ${tid} workload`);
    assert.deepEqual(new Set(recommendationIds(summary)), new Set(ids), `tenant ${tid} recommendations`);
    assert.equal(summary.totals.open_agent_tasks, 3, `tenant ${tid} total`);
  }
});

test('PostgreSQL: eligibility precedes the 100-row cap; priority/date sorting and the uncapped total survive', { skip }, async (t) => {
  const f = await fixture(t), goal = await f.goal();
  const archived = await f.goal('archived'), foreign = await f.goal('active', 202);
  for (const [parent, status, tid] of [[archived, 'pending', 101], [goal, 'failed', 101], [foreign, 'open', 202]]) {
    await f.task(parent, status, tid, 1, '2000-01-01');
  }
  const expected = [];
  for (let i = 136; i >= 0; i--) {
    const priority = Math.floor(i / 50) + 1;
    const due = i % 11 === 0 ? null : new Date(Date.UTC(2030, 0, i + 1)).toISOString().slice(0, 10);
    const id = await f.task(goal, ALLOWED[i % 3], 101, priority, due);
    expected.push({ id, priority, due });
  }
  expected.sort((a, b) => a.priority - b.priority || (a.due || '9999').localeCompare(b.due || '9999'));
  const summary = await f.summary(), listed = expected.slice(0, 100);
  assert.equal(summary.agent_workload.length, 100);
  assert.equal(summary.totals.open_agent_tasks, 137);
  // Equal-priority NULL dates may tie; compare order keys and membership rather
  // than inventing an ID tie-breaker that the product query does not promise.
  assert.deepEqual(new Set(workloadIds(summary)), new Set(listed.map((row) => row.id)));
  assert.deepEqual(summary.agent_workload.map((row) => [row.priority, row.due_date]),
    listed.map((row) => [['high', 'medium', 'low'][row.priority - 1], row.due]));
  assert.deepEqual(recommendationIds(summary), listed.slice(0, 12).map((row) => row.id));
  assert.equal(summary.totals.unassigned_task_hours,
    listed.reduce((sum, row) => sum + (row.priority === 1 ? 4 : row.priority === 2 ? 2 : 1), 0));
});

test('PostgreSQL: existing open assignments still consume capacity after their goal or task becomes ineligible', { skip }, async (t) => {
  const f = await fixture(t), goal = await f.goal(), archived = await f.goal('archived');
  const oldTask = await f.task(archived), doneTask = await f.task(goal, 'done');
  const assignedTask = await f.task(goal, 'in_progress'), freeTask = await f.task(goal, 'open');
  await f.client.query(`INSERT INTO team_capacity (id,tenant_id,member_name,allocated_hours)
    VALUES ('member-a',101,'Ada',7.25),('member-b',202,'Ben',0)`);
  const assignments = [
    ['archived-open', 101, 'member-a', oldTask, 3.5, 'open'],
    ['done-task-open', 101, 'member-a', doneTask, 2.25, 'open'],
    ['eligible-open', 101, 'member-a', assignedTask, 1.25, 'open'],
    ['manual-open', 101, 'member-a', null, 1, 'open'],
    ['closed', 101, 'member-a', freeTask, 20, 'done'],
    ['cancelled', 101, 'member-a', freeTask, 20, 'cancelled'],
    ['foreign-open', 202, 'member-b', null, 60, 'open'],
  ];
  for (const [id, tid, member, taskId, hours, status] of assignments) {
    await f.client.query(`INSERT INTO capacity_assignments
      (id,tenant_id,member_id,work_item,source,source_ref,hours,status) VALUES ($1,$2,$3,$1,$4,$5,$6,$7)`,
    [id, tid, member, taskId === null ? 'manual' : 'agent_tasks', taskId === null ? null : `agent_task:${taskId}`, hours, status]);
  }
  await f.client.query(`INSERT INTO agency_time_entries (id,tenant_id,member_id,work_date,hours)
    VALUES ('logged',101,'member-a',CURRENT_DATE,5),('foreign',202,'member-b',CURRENT_DATE,19)`);
  const before = (await f.client.query('SELECT * FROM capacity_assignments ORDER BY id')).rows;
  const summary = await f.summary(), member = summary.members[0];
  assert.deepEqual(new Set(workloadIds(summary)), new Set([assignedTask, freeTask]));
  assert.deepEqual(recommendationIds(summary), [freeTask], 'an already assigned eligible task is not recommended again');
  assert.equal(summary.totals.open_agent_tasks, 2, 'eligible assigned tasks still count in backlog');
  assert.equal(member.open_assignments, 4);
  assert.deepEqual(new Set(member.assignments.map((row) => row.id)),
    new Set(['archived-open', 'done-task-open', 'eligible-open', 'manual-open']));
  assert.equal(member.allocated_hours, 15.25);
  assert.equal(member.utilization_pct, 38);
  assert.equal(summary.totals.allocated_hours, 15.25);
  assert.equal(summary.totals.remaining_hours, 24.75);
  assert.equal(summary.totals.logged_hours, 5);
  assert.deepEqual((await f.client.query('SELECT * FROM capacity_assignments ORDER BY id')).rows, before);
});

// Invoke the shipped async handler only. Middleware/auth/limiter coverage stays
// in capacity-controls-permissions.test.js; these assertions exercise real SQL
// transactions and the assignment eligibility/duplicate restrictions.
async function handle(router, method, routePath, body, params = {}) {
  const route = router.stack.find((layer) => layer.route?.path === routePath && layer.route.methods[method]).route;
  const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
  await route.stack.at(-1).handle({ tenant: { id: 101 }, body, params }, response);
  return response;
}

test('PostgreSQL: assignment writes retain eligibility, ownership, duplicate and stale-recommendation restrictions', { skip }, async (t) => {
  const f = await fixture(t);
  const { activeGoal, eligible, rejected } = await stateMatrix(f);
  const foreignGoal = await f.goal('active', 202);
  rejected.push(await f.task(activeGoal, 'open', 202), await f.task(foreignGoal, 'open', 101),
    await f.task(foreignGoal, 'open', 202));
  await f.client.query("INSERT INTO team_capacity (id,tenant_id,member_name) VALUES ('member-a',101,'Ada')");
  const body = (id) => ({ member_id: 'member-a', work_item: 'Assign task', hours: 2,
    source: 'agent_tasks', source_ref: `agent_task:${id}` });
  const saved = [];
  for (const id of eligible) {
    const response = await handle(f.router, 'post', '/assignments', body(id));
    assert.equal(response.code, 200);
    assert.equal(response.body.ok, true);
    saved.push(response.body.id);
  }
  const duplicate = await handle(f.router, 'post', '/assignments', body(eligible[0]));
  assert.equal(duplicate.code, 409);
  assert.equal(duplicate.body.error, 'agent_task_already_assigned');
  for (const id of rejected) {
    const response = await handle(f.router, 'post', '/assignments', body(id));
    assert.equal(response.code, 404, `ineligible task ${id}`);
    assert.equal(response.body.error, 'open_agent_task_not_found');
  }
  await f.client.query("UPDATE agent_goals SET status='archived' WHERE id=$1", [activeGoal]);
  const completed = await handle(f.router, 'patch', '/assignments/:id', { status: 'done' }, { id: saved[0] });
  assert.equal(completed.code, 200, 'existing work can still be completed');
  const reopen = await handle(f.router, 'patch', '/assignments/:id', { status: 'open' }, { id: saved[0] });
  assert.equal(reopen.code, 404);
  assert.equal(reopen.body.error, 'open_agent_task_not_found');
  const rows = (await f.client.query('SELECT id,status FROM capacity_assignments')).rows;
  assert.equal(rows.length, 3, 'rejections must not insert assignments');
  assert.equal(rows.find((row) => row.id === saved[0]).status, 'done', 'failed reopen must roll back');

  const goal = await f.goal(), taskId = await f.task(goal);
  assert.deepEqual(recommendationIds(await f.summary()), [taskId]);
  await f.client.query("UPDATE agent_goals SET status='archived' WHERE id=$1", [goal]);
  const explicit = await handle(f.router, 'post', '/assignments', body(taskId));
  assert.equal(explicit.code, 404);
  assert.equal(explicit.body.error, 'open_agent_task_not_found');
  const best = await handle(f.router, 'post', '/assign-best', {
    task_id: taskId, work_item: 'Must not become manual work', hours: 2,
  });
  assert.equal(best.code, 404);
  assert.equal(best.body.error, 'unassigned_open_agent_task_not_found');
  assert.deepEqual((await f.client.query('SELECT id,status FROM capacity_assignments')).rows, rows,
    'stale recommendation must neither insert nor fall back to manual work');
});
