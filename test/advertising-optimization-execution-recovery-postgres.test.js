'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../db');
const fixture = require('./advertising-meta-delivery-discrepancy-postgres.test');
const recommendations = require('../services/agent_orchestrator/optimization_recommendations');
const requests = require('../services/agent_orchestrator/optimization_execution');

const permission = () => true;
const uniqueTag = prefix => `${prefix}-${crypto.randomBytes(5).toString('hex')}`;
const actor = (f, user = f.user, extra = {}) => ({
  tenantId: f.tenant,
  actorUserId: user,
  actorType: 'human',
  principalType: 'human',
  sessionId: `pr9b-${crypto.createHash('sha256').update(String(f.tag)).digest('hex').slice(0, 24)}-${user}`,
  hasExplicitTenantPermission: permission,
  pool: db.getPool(),
  ...extra,
});

function freshRunner() {
  const path = require.resolve('../services/agent_orchestrator/optimization_execution_run');
  delete require.cache[path];
  return require(path);
}

async function approved(tag) {
  const f = await fixture.seedMonitoring('discrepancy_detected', tag);
  let set = await recommendations.createOrGet(actor(f, f.user, {
    monitoringRunId: f.run,
    invocationId: 'recommend',
  }));
  set = await recommendations.transition(actor(f, f.user, {
    setId: set.recommendation_set_id,
    action: 'submit',
    expectedVersion: 1,
    decisionId: 'submit-recommendation',
  }));
  set = await recommendations.transition(actor(f, f.user, {
    setId: set.recommendation_set_id,
    action: 'approve',
    expectedVersion: 2,
    decisionId: 'approve-recommendation',
  }));
  const approver = (await db.getPool().query(
    `INSERT INTO users(email,password_hash,name)
     VALUES($1,'x','PR9B approver') RETURNING id`,
    [`${tag}-${crypto.randomUUID()}@test.invalid`],
  )).rows[0].id;
  const recommendation = (await db.getPool().query(
    `SELECT id FROM orchestrator_campaign_optimization_recommendations
     WHERE tenant_id=$1 AND set_id=$2 AND category='review_delivery_configuration'`,
    [f.tenant, set.recommendation_set_id],
  )).rows[0].id;
  let request = await requests.createOrGet(actor(f, f.user, {
    recommendationSetId: set.recommendation_set_id,
    recommendationId: recommendation,
    invocationId: 'request',
  }));
  request = await requests.transition(actor(f, f.user, {
    requestId: request.request_id,
    action: 'submit',
    expectedVersion: 1,
    decisionId: 'submit-request',
  }));
  request = await requests.transition(actor(f, approver, {
    requestId: request.request_id,
    action: 'approve',
    expectedVersion: 2,
    decisionId: 'approve-request',
  }));
  return { ...f, approver, request };
}

const options = (f, invocationId, extra = {}) => actor(f, f.approver, {
  requestId: f.request.request_id,
  invocationId,
  ...extra,
});

const adapter = counter => ({
  execute(input) {
    counter.calls += 1;
    return require('../services/agent_orchestrator/optimization_execution_adapter').execute(input);
  },
});

async function events(f, executionId) {
  return (await db.getPool().query(
    `SELECT execution_version,previous_state,new_state,audit_ref
     FROM orchestrator_optimization_execution_run_events
     WHERE tenant_id=$1 AND execution_id=$2 ORDER BY execution_version`,
    [f.tenant, executionId],
  )).rows;
}

async function setTenantSwitch(tenantId, active) {
  await db.getPool().query(
    `UPDATE orchestrator_advertising_tenant_kill_switches
     SET active=$2,version=version+1,updated_at=clock_timestamp()
     WHERE tenant_id=$1 AND switch_key='optimization_execution'`,
    [tenantId, active],
  );
}

function faultPool(armed, pattern, failures) {
  const pool = db.getPool();
  return {
    async connect() {
      const client = await pool.connect();
      return {
        release: () => client.release(),
        query(sql, args) {
          if (armed.value && pattern.test(sql) && failures.value-- > 0) {
            return Promise.reject(new Error('PR9B injected settlement crash'));
          }
          return client.query(sql, args);
        },
      };
    },
  };
}

function runningTransitionFaultPool() {
  const pool = db.getPool();
  let runningUpdateSeen = false;
  return {
    async connect() {
      const client = await pool.connect();
      return {
        release: () => client.release(),
        async query(sql, args) {
          const result = await client.query(sql, args);
          if (/UPDATE orchestrator_optimization_executions SET state=\$3/.test(sql) && args?.[2] === 'running') {
            runningUpdateSeen = true;
          } else if (runningUpdateSeen && /INSERT INTO orchestrator_optimization_execution_run_events/.test(sql)) {
            throw new Error('PR9B crash before running event settlement');
          }
          return result;
        },
      };
    },
  };
}

if (!db.hasDb()) {
  test('PR9B recovery certification requires PostgreSQL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  before(() => fixture.bootstrapSchemasOnce());

  test('restart after reservation never invokes and duplicate replay is deterministic', async () => {
    const f = await approved(`pr9b-reserved-${Date.now()}`);
    const firstRunner = freshRunner();
    const reservation = await firstRunner._test.reserve(options(f, 'reserved-crash'));
    assert.equal(reservation.row.state, 'reserved');

    const calls = { calls: 0 };
    const restarted = freshRunner();
    const replay = await restarted.execute(options(f, 'reserved-crash', { adapter: adapter(calls) }));
    const repeated = await freshRunner().execute(options(f, 'reserved-crash', { adapter: adapter(calls) }));
    assert.deepEqual(repeated, replay);
    assert.equal(replay.state, 'reserved');
    assert.equal(replay.version, 1);
    assert.equal(calls.calls, 0);
    assert.deepEqual((await events(f, replay.execution_id)).map(e => e.new_state), ['reserved']);
    await assert.rejects(
      restarted.execute(options(f, 'reserved-crash', { actorUserId: f.user })),
      { code: 'invocation_id_conflict' },
    );
    await assert.rejects(
      restarted.execute(options(f, 'competing-after-reservation', { adapter: adapter(calls) })),
      { code: 'already_executed' },
    );
    assert.equal(calls.calls, 0);
  });

  test('restart after running converts ambiguity to indeterminate without adapter reinvocation', async () => {
    const f = await approved(`pr9b-running-${Date.now()}`);
    const firstRunner = freshRunner();
    const reservation = await firstRunner._test.reserve(options(f, 'running-crash'));
    const running = await firstRunner._test.move(
      options(f, 'running-crash'), reservation.row.id, reservation.token,
      'reserved', 'running', null, f.approver,
    );
    assert.equal(running.state, 'running');

    const calls = { calls: 0 };
    const recovered = await freshRunner().execute(options(f, 'running-crash', { adapter: adapter(calls) }));
    const replay = await freshRunner().execute(options(f, 'running-crash', { adapter: adapter(calls) }));
    assert.equal(recovered.state, 'indeterminate');
    assert.deepEqual(replay, recovered);
    assert.equal(calls.calls, 0);
    assert.deepEqual((await events(f, recovered.execution_id)).map(e => e.new_state), [
      'reserved', 'running', 'indeterminate',
    ]);
    await assert.rejects(
      db.getPool().query(
        `UPDATE orchestrator_optimization_executions SET state='running',version=version+1
         WHERE tenant_id=$1 AND id=$2`,
        [f.tenant, recovered.execution_id],
      ),
      /terminal_immutable/,
    );
  });

  test('running transition settlement crash rolls back before adapter invocation', async () => {
    const f = await approved(`pr9b-pre-adapter-${Date.now()}`);
    const calls = { calls: 0 };
    await assert.rejects(freshRunner().execute(options(f, 'pre-adapter-crash', {
      pool: runningTransitionFaultPool(), adapter: adapter(calls),
    })), /PR9B crash before running event settlement/);
    const row = (await db.getPool().query(
      `SELECT id,state,version FROM orchestrator_optimization_executions
       WHERE tenant_id=$1 AND request_id=$2`, [f.tenant, f.request.request_id],
    )).rows[0];
    assert.equal(row.state, 'reserved');
    assert.equal(Number(row.version), 1);
    assert.equal(calls.calls, 0);
    assert.deepEqual((await events(f, row.id)).map(event => event.new_state), ['reserved']);
  });

  test('post-adapter event and audit crashes settle indeterminate exactly once across restart', async () => {
    for (const pattern of [
      /INSERT INTO orchestrator_optimization_execution_run_events/,
      /INSERT INTO orchestrator_audit_events/,
    ]) {
      const f = await approved(uniqueTag('pr9b-settlement'));
      const armed = { value: false };
      const failures = { value: 2 };
      const calls = { calls: 0 };
      const wrappedAdapter = adapter(calls);
      await assert.rejects(
        freshRunner().execute(options(f, 'settlement-crash', {
          pool: faultPool(armed, pattern, failures),
          adapter: {
            execute(input) {
              const result = wrappedAdapter.execute(input);
              armed.value = true;
              return result;
            },
          },
        })),
        { code: 'settlement_indeterminate' },
      );
      const recovered = await freshRunner().execute(options(f, 'settlement-crash', {
        adapter: adapter(calls),
      }));
      assert.equal(recovered.state, 'indeterminate');
      assert.equal(calls.calls, 1);
      assert.equal((await events(f, recovered.execution_id)).at(-1).new_state, 'indeterminate');
    }
  });

  test('all terminal outcomes remain closed and exactly-once after module restart', async () => {
    const cases = [
      ['succeeded', null],
      ['failed', true],
      ['indeterminate', false],
    ];
    for (const [expected, definitive] of cases) {
      const f = await approved(uniqueTag(`pr9b-terminal-${expected}`));
      const calls = { calls: 0 };
      const terminalAdapter = definitive === null ? adapter(calls) : {
        execute() {
          calls.calls += 1;
          throw Object.assign(new Error('bounded adapter outcome'), { definitive });
        },
      };
      const first = await freshRunner().execute(options(f, `terminal-${expected}`, { adapter: terminalAdapter }));
      const replay = await freshRunner().execute(options(f, `terminal-${expected}`, { adapter: terminalAdapter }));
      assert.equal(first.state, expected);
      assert.deepEqual(replay, first);
      assert.equal(calls.calls, 1);
      await assert.rejects(freshRunner().execute(options(f, `competitor-${expected}`)), {
        code: 'already_executed',
      });
    }

    const f = await approved(uniqueTag('pr9b-terminal-cancelled'));
    const runner = freshRunner();
    const reservation = await runner._test.reserve(options(f, 'cancelled'));
    const cancelled = await runner.cancel(actor(f, f.approver, {
      executionId: reservation.row.id,
      expectedVersion: 1,
    }));
    const calls = { calls: 0 };
    assert.deepEqual(
      await freshRunner().execute(options(f, 'cancelled', { adapter: adapter(calls) })),
      cancelled,
    );
    assert.equal(calls.calls, 0);
  });

  test('recovery remains fail-closed under switches, suspension, permission denial and tenant concurrency', async () => {
    const blocked = await approved(`pr9b-blocked-${Date.now()}`);
    const reservation = await freshRunner()._test.reserve(options(blocked, 'blocked-running'));
    await freshRunner()._test.move(
      options(blocked, 'blocked-running'), reservation.row.id, reservation.token,
      'reserved', 'running', null, blocked.approver,
    );
    const healthy = await approved(`pr9b-healthy-${Date.now()}`);
    await setTenantSwitch(blocked.tenant, true);
    const calls = { calls: 0 };
    const outcomes = await Promise.allSettled([
      freshRunner().execute(options(blocked, 'blocked-running', { adapter: adapter(calls) })),
      freshRunner().execute(options(healthy, 'healthy', { adapter: adapter(calls) })),
    ]);
    assert.equal(outcomes[0].status, 'rejected');
    assert.equal(outcomes[0].reason.code, 'execution_disabled');
    assert.equal(outcomes[1].status, 'fulfilled');
    assert.equal(outcomes[1].value.state, 'succeeded');
    assert.equal(calls.calls, 1);
    assert.equal((await db.getPool().query(
      `SELECT state FROM orchestrator_optimization_executions WHERE tenant_id=$1 AND id=$2`,
      [blocked.tenant, reservation.row.id],
    )).rows[0].state, 'running');
    await setTenantSwitch(blocked.tenant, false);
    await assert.rejects(freshRunner().execute(options(blocked, 'blocked-running', {
      hasExplicitTenantPermission: () => false,
      adapter: adapter(calls),
    })), { code: 'permission_denied' });
    await db.getPool().query(`UPDATE tenants SET status='suspended' WHERE id=$1`, [blocked.tenant]);
    await assert.rejects(freshRunner().execute(options(blocked, 'blocked-running', {
      adapter: adapter(calls),
    })), { code: 'execution_disabled' });
    assert.equal(calls.calls, 1);
  });

  test('global kill switch blocks recovery of an existing running execution', async () => {
    const f = await approved(`pr9b-global-${Date.now()}`);
    const runner = freshRunner();
    const reservation = await runner._test.reserve(options(f, 'global-running'));
    await runner._test.move(options(f, 'global-running'), reservation.row.id, reservation.token,
      'reserved', 'running', null, f.approver);
    await db.getPool().query(
      `UPDATE orchestrator_advertising_global_kill_switches
       SET active=true,version=version+1,updated_at=clock_timestamp()
       WHERE switch_key='optimization_execution'`,
    );
    const calls = { calls: 0 };
    try {
      await assert.rejects(freshRunner().execute(options(f, 'global-running', {
        adapter: adapter(calls),
      })), { code: 'execution_disabled' });
      assert.equal(calls.calls, 0);
      assert.equal((await db.getPool().query(
        `SELECT state FROM orchestrator_optimization_executions WHERE tenant_id=$1 AND id=$2`,
        [f.tenant, reservation.row.id],
      )).rows[0].state, 'running');
    } finally {
      await db.getPool().query(
        `UPDATE orchestrator_advertising_global_kill_switches
         SET active=false,version=version+1,updated_at=clock_timestamp()
         WHERE switch_key='optimization_execution'`,
      );
    }
  });

  test('stale credential and source lineage fail admission without an execution row', async () => {
    for (const mutation of ['credential', 'lineage']) {
      const f = await approved(uniqueTag(`pr9b-ineligible-${mutation}`));
      if (mutation === 'credential') {
        await db.getPool().query(
          `UPDATE orchestrator_tenant_meta_credential_refs
           SET status='revoked',revoked_at=clock_timestamp()
           WHERE tenant_id=$1 AND id=$2`,
          [f.tenant, f.credential],
        );
      } else {
        let successor = await recommendations.createOrGet(actor(f, f.user, {
          monitoringRunId: f.run, invocationId: 'lineage-successor',
        }));
        successor = await recommendations.transition(actor(f, f.user, {
          setId: successor.recommendation_set_id, action: 'submit', expectedVersion: 1,
          decisionId: 'submit-successor',
        }));
        await recommendations.transition(actor(f, f.user, {
          setId: successor.recommendation_set_id, action: 'approve', expectedVersion: 2,
          decisionId: 'approve-successor',
        }));
      }
      let calls = 0;
      await assert.rejects(freshRunner().execute(options(f, `ineligible-${mutation}`, {
        adapter: { execute: () => { calls += 1; } },
      })), { code: 'source_ineligible' });
      assert.equal(calls, 0);
      assert.equal((await db.getPool().query(
        `SELECT count(*)::int AS count FROM orchestrator_optimization_executions
         WHERE tenant_id=$1 AND request_id=$2`,
        [f.tenant, f.request.request_id],
      )).rows[0].count, 0);
    }
  });

  test('stranded recovery stays inert after credential version drift or lineage supersession', async () => {
    for (const mutation of ['credential_version', 'lineage_successor']) {
      for (const strandedState of ['reserved', 'running']) {
        const mutationTag = mutation === 'credential_version' ? 'cv' : 'ls';
        const f = await approved(uniqueTag(`pr9b-strand-${mutationTag}-${strandedState}`));
        const invocationId = `${mutation}-${strandedState}`;
        const runner = freshRunner();
        const reservation = await runner._test.reserve(options(f, invocationId));
        if (strandedState === 'running') {
          await runner._test.move(
            options(f, invocationId), reservation.row.id, reservation.token,
            'reserved', 'running', null, f.approver,
          );
        }

        if (mutation === 'credential_version') {
          const pool = db.getPool();
          await pool.query('SET session_replication_role=replica');
          try {
            await pool.query(
              `UPDATE orchestrator_tenant_meta_credential_refs
               SET version=version+1,updated_at=clock_timestamp()
               WHERE tenant_id=$1 AND id=$2 AND status='active'`,
              [f.tenant, f.credential],
            );
          } finally {
            await pool.query('SET session_replication_role=origin');
          }
          const credential = (await pool.query(
            `SELECT status,version FROM orchestrator_tenant_meta_credential_refs
             WHERE tenant_id=$1 AND id=$2`,
            [f.tenant, f.credential],
          )).rows[0];
          assert.equal(credential.status, 'active');
          assert.equal(Number(credential.version), 2);
        } else {
          let successor = await recommendations.createOrGet(actor(f, f.user, {
            monitoringRunId: f.run,
            invocationId: `successor-${strandedState}`,
          }));
          successor = await recommendations.transition(actor(f, f.user, {
            setId: successor.recommendation_set_id,
            action: 'submit',
            expectedVersion: 1,
            decisionId: `submit-successor-${strandedState}`,
          }));
          await recommendations.transition(actor(f, f.user, {
            setId: successor.recommendation_set_id,
            action: 'approve',
            expectedVersion: 2,
            decisionId: `approve-successor-${strandedState}`,
          }));
        }

        const calls = { calls: 0 };
        const recovered = await freshRunner().execute(options(f, invocationId, {
          adapter: adapter(calls),
        }));
        const replay = await freshRunner().execute(options(f, invocationId, {
          adapter: adapter(calls),
        }));
        assert.deepEqual(replay, recovered);
        assert.equal(recovered.state, strandedState === 'running' ? 'indeterminate' : 'reserved');
        assert.equal(recovered.provider_contacted, false);
        assert.equal(recovered.provider_mutation_performed, false);
        assert.equal(calls.calls, 0);
        assert.equal((await db.getPool().query(
          `SELECT count(*)::int AS count FROM orchestrator_optimization_executions
           WHERE tenant_id=$1 AND request_id=$2`,
          [f.tenant, f.request.request_id],
        )).rows[0].count, 1);
        assert.deepEqual((await events(f, recovered.execution_id)).map(event => event.new_state),
          strandedState === 'running'
            ? ['reserved', 'running', 'indeterminate']
            : ['reserved']);
        await assert.rejects(
          freshRunner().execute(options(f, `competitor-${invocationId}`, {
            adapter: adapter(calls),
          })),
          { code: 'source_ineligible' },
        );
        assert.equal(calls.calls, 0);
      }
    }
  });

  test('recovered public projections stay provider-inert, allowlisted and free of private payloads', async () => {
    const f = await approved(`pr9b-projection-${Date.now()}`);
    const first = freshRunner();
    const reservation = await first._test.reserve(options(f, 'safe-projection'));
    await first._test.move(
      options(f, 'safe-projection'), reservation.row.id, reservation.token,
      'reserved', 'running', null, f.approver,
    );
    const projection = await freshRunner().execute(options(f, 'safe-projection'));
    assert.equal(projection.provider_contacted, false);
    assert.equal(projection.provider_mutation_performed, false);
    assert.deepEqual(Object.keys(projection).sort(), [
      'approved_internal_action', 'completed_at', 'execution_id', 'execution_mode',
      'failed_at', 'invoking_human_user_id', 'provider_contacted',
      'provider_mutation_performed', 'request_id', 'reserved_at', 'result_code',
      'started_at', 'state', 'version',
    ].sort());
    const serialized = JSON.stringify(projection);
    for (const forbidden of ['credential', 'secret', 'token', 'provider_id', 'provider_url', 'raw_payload']) {
      assert.equal(serialized.toLowerCase().includes(forbidden), false);
    }
    const lineage = await events(f, projection.execution_id);
    assert.deepEqual(lineage.map(e => Number(e.execution_version)), [1, 2, 3]);
    assert.equal(new Set(lineage.map(e => e.audit_ref)).size, lineage.length);
  });
}
