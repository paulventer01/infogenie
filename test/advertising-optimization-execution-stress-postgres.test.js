'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../db');
const fixture = require('./advertising-meta-delivery-discrepancy-postgres.test');
const recommendations = require('../services/agent_orchestrator/optimization_recommendations');
const requests = require('../services/agent_orchestrator/optimization_execution');
const runner = require('../services/agent_orchestrator/optimization_execution_run');
const defaultAdapter = require('../services/agent_orchestrator/optimization_execution_adapter');

const permit = () => true;
const unique = prefix => `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
const actor = (f, user = f.user, extra = {}) => ({
  tenantId: f.tenant,
  actorUserId: user,
  actorType: 'human',
  principalType: 'human',
  sessionId: `pr9c-${crypto.createHash('sha256').update(f.tag).digest('hex').slice(0, 20)}-${user}`,
  hasExplicitTenantPermission: permit,
  pool: db.getPool(),
  ...extra,
});

async function approved(tag, requestCount = 1) {
  const f = await fixture.seedMonitoring('discrepancy_detected', tag);
  let set = await recommendations.createOrGet(actor(f, f.user, {
    monitoringRunId: f.run, invocationId: 'recommend',
  }));
  set = await recommendations.transition(actor(f, f.user, {
    setId: set.recommendation_set_id, action: 'submit', expectedVersion: 1, decisionId: 'submit-rec',
  }));
  set = await recommendations.transition(actor(f, f.user, {
    setId: set.recommendation_set_id, action: 'approve', expectedVersion: 2, decisionId: 'approve-rec',
  }));
  const approver = (await db.getPool().query(
    `INSERT INTO users(email,password_hash,name) VALUES($1,'x','PR9C approver') RETURNING id`,
    [`${tag}-${crypto.randomUUID()}@test.invalid`],
  )).rows[0].id;
  const rec = (await db.getPool().query(
    `SELECT id FROM orchestrator_campaign_optimization_recommendations
     WHERE tenant_id=$1 AND set_id=$2 ORDER BY id LIMIT 1`,
    [f.tenant, set.recommendation_set_id],
  )).rows[0];
  assert.ok(rec);
  const approvedRequests = [];
  for (let index = 0; index < requestCount; index += 1) {
    let request = await requests.createOrGet(actor(f, f.user, {
      recommendationSetId: set.recommendation_set_id,
      recommendationId: rec.id,
      invocationId: `request-${index}`,
    }));
    request = await requests.transition(actor(f, f.user, {
      requestId: request.request_id, action: 'submit', expectedVersion: 1,
      decisionId: `submit-request-${index}`,
    }));
    request = await requests.transition(actor(f, approver, {
      requestId: request.request_id, action: 'approve', expectedVersion: 2,
      decisionId: `approve-request-${index}`,
    }));
    approvedRequests.push(request);
  }
  return { ...f, tag, approver, requests: approvedRequests, request: approvedRequests[0] };
}

const options = (f, invocationId, extra = {}, request = f.request) => actor(f, f.approver, {
  requestId: request.request_id, invocationId, ...extra,
});
const execute = (f, invocationId, extra, request) => runner.execute(options(f, invocationId, extra, request));
const countingAdapter = counter => ({
  execute(input) {
    counter.calls += 1;
    return defaultAdapter.execute(input);
  },
});
const executionRows = (f, request = f.request) => db.getPool().query(
  `SELECT * FROM orchestrator_optimization_executions WHERE tenant_id=$1 AND request_id=$2`,
  [f.tenant, request.request_id],
);
async function assertSafe(result) {
  assert.equal(result.provider_contacted, false);
  assert.equal(result.provider_mutation_performed, false);
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['secret', 'credential', 'provider_id', 'provider_url', 'raw_payload', 'token']) {
    assert.equal(serialized.includes(forbidden), false);
  }
}
async function assertLineage(f, result) {
  const events = (await db.getPool().query(
    `SELECT tenant_id,execution_version,audit_ref FROM orchestrator_optimization_execution_run_events
     WHERE tenant_id=$1 AND execution_id=$2 ORDER BY execution_version`,
    [f.tenant, result.execution_id],
  )).rows;
  assert.deepEqual(events.map(row => Number(row.execution_version)), [1, 2, 3]);
  assert.equal(new Set(events.map(row => row.audit_ref)).size, 3);
  assert.ok(events.every(row => Number(row.tenant_id) === f.tenant));
  assert.equal((await db.getPool().query(
    `SELECT count(*)::int count FROM orchestrator_audit_events
     WHERE tenant_id<>$1 AND detail->>'execution_id'=$2`, [f.tenant, result.execution_id],
  )).rows[0].count, 0);
}
async function raceBeforeAdmission(f, invocationId, mutate, expectedCode = 'source_ineligible') {
  const pool = db.getPool();
  const blocker = await pool.connect();
  const key = `${f.tenant}:${f.request.request_id}`;
  const calls = { calls: 0 };
  let attempt;
  try {
    await blocker.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    attempt = execute(f, invocationId, { adapter: countingAdapter(calls) });
    let waiting = false;
    for (let spin = 0; spin < 10000 && !waiting; spin += 1) {
      waiting = (await pool.query(
        `SELECT EXISTS(SELECT 1 FROM pg_locks
         WHERE locktype='advisory' AND granted=false
           AND objid=(hashtext($1)::bigint & 4294967295)) waiting`, [key],
      )).rows[0].waiting;
      if (!waiting) await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(waiting, true, 'execution reached the pre-admission advisory-lock barrier');
    await mutate();
  } finally {
    await blocker.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
    blocker.release();
  }
  await assert.rejects(attempt, { code: expectedCode });
  assert.equal(calls.calls, 0);
  assert.equal((await executionRows(f)).rowCount, 0);
}

if (!db.hasDb()) {
  test('PR9C stress certification requires PostgreSQL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  before(() => fixture.bootstrapSchemasOnce());

  test('20 duplicate calls serialize, invoke once, and replay one safe terminal result', {
    timeout: 15_000,
  }, async () => {
    const f = await approved(unique('pr9c-same'));
    const calls = { calls: 0 };
    const adapter = countingAdapter(calls);
    const results = await Promise.all(Array.from({ length: 20 }, () => execute(f, 'same', { adapter })));
    assert.equal(calls.calls, 1);
    assert.ok(results.every(result => JSON.stringify(result) === JSON.stringify(results[0])));
    assert.equal(results[0].state, 'succeeded');
    assert.equal((await executionRows(f)).rowCount, 1);
    await assertSafe(results[0]);
    await assertLineage(f, results[0]);
  });

  test('20 competing invocation IDs produce one execution and never more than one adapter call', async () => {
    const f = await approved(unique('pr9c-competing'));
    const calls = { calls: 0 };
    const settled = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
      execute(f, `competitor-${index}`, { adapter: countingAdapter(calls) })));
    assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
    assert.ok(settled.filter(item => item.status === 'rejected').every(item => item.reason.code === 'already_executed'));
    assert.equal(calls.calls, 1);
    assert.equal((await executionRows(f)).rowCount, 1);
  });

  test('three independent same-tenant requests and six tenants execute concurrently without linkage reuse', async () => {
    const sameTenant = await approved(unique('pr9c-one-tenant'), 3);
    const tenants = await Promise.all(Array.from({ length: 6 }, (_, index) => approved(unique(`pr9c-tenant-${index}`))));
    const calls = { calls: 0 };
    const sameResults = await Promise.all(sameTenant.requests.map((request, index) =>
      execute(sameTenant, `same-tenant-${index}`, { adapter: countingAdapter(calls) }, request)));
    const tenantResults = await Promise.all(tenants.map((tenant, index) =>
      execute(tenant, `parallel-${index}`, { adapter: countingAdapter(calls) })));
    assert.equal(calls.calls, 9);
    assert.equal(new Set([...sameResults, ...tenantResults].map(result => result.execution_id)).size, 9);
    for (const [index, result] of sameResults.entries()) {
      assert.equal(result.request_id, sameTenant.requests[index].request_id);
      await assertSafe(result);
      await assertLineage(sameTenant, result);
    }
    for (const [index, result] of tenantResults.entries()) {
      assert.equal(result.request_id, tenants[index].request.request_id);
      await assertLineage(tenants[index], result);
    }
  });

  test('ordered switch and suspension races fail closed before reservation', async () => {
    const cases = ['tenant-switch', 'suspension'];
    for (const name of cases) {
      const f = await approved(unique(`pr9c-${name}`));
      const blocker = await db.getPool().connect();
      const calls = { calls: 0 };
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT id FROM tenants WHERE id=$1 FOR UPDATE`, [f.tenant]);
        const attempt = execute(f, name, { adapter: countingAdapter(calls) });
        await blocker.query(name === 'suspension'
          ? `UPDATE tenants SET status='suspended' WHERE id=$1`
          : `UPDATE orchestrator_advertising_tenant_kill_switches SET active=true,version=version+1,
             updated_at=clock_timestamp() WHERE tenant_id=$1 AND switch_key='optimization_execution'`, [f.tenant]);
        await blocker.query('COMMIT');
        await assert.rejects(attempt, { code: 'execution_disabled' });
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
      assert.equal(calls.calls, 0);
      assert.equal((await executionRows(f)).rowCount, 0);
    }
  });

  test('global kill-switch activation racing admission is exclusive and fail-closed', async () => {
    const f = await approved(unique('pr9c-global-switch'));
    const blocker = await db.getPool().connect();
    const calls = { calls: 0 };
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT switch_key FROM orchestrator_advertising_global_kill_switches
         WHERE switch_key='optimization_execution' FOR UPDATE`);
      const attempt = execute(f, 'global-switch', { adapter: countingAdapter(calls) });
      await blocker.query(
        `UPDATE orchestrator_advertising_global_kill_switches SET active=true,version=version+1,
         updated_at=clock_timestamp() WHERE switch_key='optimization_execution'`);
      await blocker.query('COMMIT');
      await assert.rejects(attempt, { code: 'execution_disabled' });
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await db.getPool().query(
        `UPDATE orchestrator_advertising_global_kill_switches SET active=false,version=version+1,
         updated_at=clock_timestamp() WHERE switch_key='optimization_execution' AND active=true`);
    }
    assert.equal(calls.calls, 0);
    assert.equal((await executionRows(f)).rowCount, 0);
  });

  test('credential, lineage, and approval invalidation races fail closed before admission', async () => {
    for (const kind of ['credential-version', 'credential-revoked', 'lineage', 'approval']) {
      const f = await approved(unique(`pr9c-${kind}`));
      let mutate;
      if (kind === 'credential-version') {
        mutate = async () => {
          const client = await db.getPool().connect();
          try {
            await client.query('SET session_replication_role=replica');
            await client.query(
              `UPDATE orchestrator_tenant_meta_credential_refs SET version=version+1,updated_at=clock_timestamp()
               WHERE tenant_id=$1 AND id=$2 AND status='active'`, [f.tenant, f.credential]);
          } finally {
            await client.query('SET session_replication_role=origin');
            client.release();
          }
        };
      } else if (kind === 'credential-revoked') {
        mutate = () => db.getPool().query(
          `UPDATE orchestrator_tenant_meta_credential_refs
           SET status='revoked',revoked_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2`,
          [f.tenant, f.credential]);
      } else if (kind === 'lineage') {
        let successor = await recommendations.createOrGet(actor(f, f.user, {
          monitoringRunId: f.run, invocationId: 'successor',
        }));
        successor = await recommendations.transition(actor(f, f.user, {
          setId: successor.recommendation_set_id, action: 'submit', expectedVersion: 1, decisionId: 'submit-successor',
        }));
        mutate = () => recommendations.transition(actor(f, f.user, {
          setId: successor.recommendation_set_id, action: 'approve', expectedVersion: 2, decisionId: 'approve-successor',
        }));
      } else {
        const approvalId = (await db.getPool().query(
          `SELECT publish_approval_id FROM orchestrator_optimization_execution_requests
           WHERE tenant_id=$1 AND id=$2`, [f.tenant, f.request.request_id],
        )).rows[0].publish_approval_id;
        mutate = () => db.getPool().query(
          `UPDATE orchestrator_campaign_publish_approvals
           SET revoked_at=clock_timestamp(),revoke_reason='PR9C admission race'
           WHERE tenant_id=$1 AND id=$2`, [f.tenant, approvalId]);
      }
      await raceBeforeAdmission(f, kind, mutate);
    }
  });

  test('human identity and explicit permission remain mandatory under concurrent denial load', async () => {
    const f = await approved(unique('pr9c-auth'));
    const calls = { calls: 0 };
    const attempts = Array.from({ length: 12 }, (_, index) => execute(f, `denied-${index}`, {
      adapter: countingAdapter(calls),
      ...(index % 2 ? { hasExplicitTenantPermission: () => false } : { actorType: 'agent' }),
    }));
    const settled = await Promise.allSettled(attempts);
    assert.ok(settled.every(item => item.status === 'rejected'));
    assert.ok(settled.every(item => ['permission_denied', 'human_session_required'].includes(item.reason.code)));
    assert.equal(calls.calls, 0);
    assert.equal((await executionRows(f)).rowCount, 0);
  });

  test('concurrent reserved and running recovery remains inert and terminal', async () => {
    const reservedFixture = await approved(unique('pr9c-reserved'));
    const runningFixture = await approved(unique('pr9c-running'));
    const reserved = await runner._test.reserve(options(reservedFixture, 'recover-reserved'));
    const running = await runner._test.reserve(options(runningFixture, 'recover-running'));
    await runner._test.move(options(runningFixture, 'recover-running'), running.row.id, running.token,
      'reserved', 'running', null, runningFixture.approver);
    const calls = { calls: 0 };
    const [reservedResults, runningResults] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => execute(reservedFixture, 'recover-reserved', { adapter: countingAdapter(calls) }))),
      Promise.all(Array.from({ length: 10 }, () => execute(runningFixture, 'recover-running', { adapter: countingAdapter(calls) }))),
    ]);
    assert.ok(reservedResults.every(result => result.state === 'reserved'));
    assert.ok(runningResults.every(result => result.state === 'indeterminate'));
    assert.ok(runningResults.every(result => JSON.stringify(result) === JSON.stringify(runningResults[0])));
    assert.equal(calls.calls, 0);
    await assertSafe(runningResults[0]);
  });

  test('injected reservation failure rolls back atomically and leaves the pool transaction-clean', async () => {
    const f = await approved(unique('pr9c-rollback'));
    const pool = db.getPool();
    const observer = await pool.connect();
    let faultedBackendPid;
    const faultPool = {
      async connect() {
        const client = await pool.connect();
        faultedBackendPid = client.processID;
        return {
          release: (...args) => client.release(...args),
          query(sql, args) {
            if (/INSERT INTO orchestrator_optimization_execution_run_events/.test(sql)) {
              return Promise.reject(new Error('PR9C injected event failure'));
            }
            return client.query(sql, args);
          },
        };
      },
    };
    try {
      await assert.rejects(execute(f, 'rollback', { pool: faultPool }), /PR9C injected event failure/);
      assert.ok(Number.isInteger(faultedBackendPid), 'captured the faulted PostgreSQL backend PID');
      assert.equal((await executionRows(f)).rowCount, 0);
      const activity = (await observer.query(
        `SELECT state,xact_start FROM pg_stat_activity WHERE pid=$1`, [faultedBackendPid],
      )).rows;
      assert.ok(activity.length <= 1);
      if (activity.length === 1) {
        assert.notEqual(activity[0].state, 'idle in transaction',
          'faulted backend must not return to the pool idle in transaction');
        assert.equal(activity[0].xact_start, null,
          'faulted backend must not retain an open transaction');
      }
    } finally {
      observer.release();
    }
  });
}
