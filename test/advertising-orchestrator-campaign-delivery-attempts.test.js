'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');
const attempts = require('../services/agent_orchestrator/campaign_delivery_attempts');
const D = require('../services/agent_orchestrator/campaign_delivery_contracts');

const HAS_DB = db.hasDb();
const HEX = 'a'.repeat(64);
const SUFFIX = `ao6d-att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };

async function withTx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}

async function seedHost(p, tenantId) {
  const wfId = nid('wf');
  await p.query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`, [wfId, tenantId, wfId]);
  const approvalId = (await p.query(
    `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'campaign_publishing',$3,'approved',1,'["meta"]'::jsonb) RETURNING id`, [tenantId, wfId, HEX]
  )).rows[0].id;
  return { wfId, approvalId };
}

async function insertDraft(p, tenantId, host, opts = {}) {
  const id = opts.id || nid('draft');
  await p.query(
    `INSERT INTO orchestrator_campaign_drafts
       (id, tenant_id, workflow_id, contract_hash, idempotency_key, status, current_revision)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, tenantId, host.wfId, opts.contractHash || HEX, opts.idempotencyKey || nid('didemp'), opts.status || 'draft', opts.revision || 1]
  );
  return id;
}

async function insertPublishApproval(p, tenantId, host, draftId, opts = {}) {
  const id = opts.id || nid('pub');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_approvals
       (id, tenant_id, draft_id, revision, contract_hash, snapshot_json, workflow_approval_id,
        actor_user_id, idempotency_key, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,now()+'1 hour'::interval)`,
    [
      id, tenantId, draftId, opts.revision || 1, opts.contractHash || HEX,
      opts.snapshotJson || '{"ok":true}', opts.workflowApprovalId || host.approvalId,
      opts.actorUserId, opts.idempotencyKey || nid('pidemp'),
    ]
  );
  return id;
}

async function insertRequest(p, tenantId, host, draftId, publishApprovalId, opts = {}) {
  const id = opts.id || nid('req');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_requests
       (id, tenant_id, draft_id, publish_approval_id, workflow_approval_id, revision,
        contract_hash, snapshot_hash, requested_by, status, confirmation_version,
        idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id, tenantId, draftId, publishApprovalId, opts.workflowApprovalId || host.approvalId,
      opts.revision == null ? 1 : opts.revision, opts.contractHash || HEX,
      opts.snapshotHash || nextHex(), opts.requestedBy, opts.status || 'requested',
      opts.confirmationVersion == null ? 1 : opts.confirmationVersion,
      opts.idempotencyKey || nid('ridemp'), opts.requestHash || nextHex(),
    ]
  );
  return id;
}

async function insertOutbox(q, tenantId, host, outboxId, opts = {}) {
  await q.query(
    `INSERT INTO orchestrator_outbox
       (id, tenant_id, workflow_id, destination, operation, payload, state, idempotency_key)
     VALUES ($1,$2,$3,'internal','create_provider_draft','{}'::jsonb,'pending',$4)`,
    [outboxId, tenantId, host.wfId, opts.outboxIdempotencyKey || nid('oidemp')]
  );
  return outboxId;
}

async function insertIntent(q, tenantId, host, draftId, publishApprovalId, publishingRequestId, opts = {}) {
  const id = opts.id || nid('intent');
  const outboxId = opts.outboxId || nid('obx');
  await q.query(
    `INSERT INTO orchestrator_campaign_delivery_intents
       (id, tenant_id, publishing_request_id, draft_id, publish_approval_id, workflow_approval_id,
        outbox_id, revision, contract_hash, snapshot_hash, intent_hash, contract_version,
        operation, status, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id, tenantId, publishingRequestId, draftId, publishApprovalId,
      opts.workflowApprovalId || host.approvalId, outboxId,
      opts.revision == null ? 1 : opts.revision, opts.contractHash || HEX,
      opts.snapshotHash || nextHex(), opts.intentHash || nextHex(),
      opts.contractVersion || 'campaign_delivery_v1',
      opts.operation || 'create_provider_draft',
      opts.status || 'pending',
      opts.idempotencyKey || nid('iidemp'),
      opts.requestedBy,
    ]
  );
  return { id, outboxId };
}

async function seedBoundGraph(p, tenantId, host, userId, opts = {}) {
  const draftId = opts.draftId || await insertDraft(p, tenantId, host, opts);
  const pubId = opts.pubId || await insertPublishApproval(p, tenantId, host, draftId, {
    actorUserId: userId, ...opts,
  });
  const reqId = opts.reqId || await insertRequest(p, tenantId, host, draftId, pubId, {
    requestedBy: userId, ...opts,
  });
  const outboxId = opts.outboxId || nid('obx');
  await insertOutbox(p, tenantId, host, outboxId, opts);
  const intent = await insertIntent(p, tenantId, host, draftId, pubId, reqId, { ...opts, outboxId });
  const intentRow = (await p.query(
    `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND id=$2`,
    [tenantId, intent.id]
  )).rows[0];
  return {
    draftId, pubId, reqId, intentId: intent.id, outboxId: intent.outboxId, intent: intentRow,
  };
}

async function startAttempt(c, tenantId, graph, n, extra = {}) {
  return attempts.insertStartedAttempt(c, {
    tenantId,
    intentId: graph.intentId,
    outboxId: graph.outboxId,
    draftId: graph.draftId,
    publishingRequestId: graph.reqId,
    attemptNumber: n,
    generation: n,
    leaseHolder: extra.leaseHolder || 'worker-fake-1',
    leaseExpiresAt: extra.leaseExpiresAt || new Date(Date.now() + D.LEASE_MS),
    platform: extra.platform || 'meta',
    intentHash: graph.intent.intent_hash,
    claimToken: extra.claimToken,
    id: extra.id,
  });
}

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('publicAttempt strips claim_token and credential_ref', () => {
  const pub = attempts.publicAttempt({
    id: 'cda_1', tenant_id: 1, intent_id: 'cdi_1', outbox_id: 'obx_1',
    draft_id: 'cd_1', publishing_request_id: 'cpr_1',
    attempt_number: 1, generation: 1,
    claim_token: 'secret-claim-token-value',
    lease_holder: 'w1', lease_expires_at: new Date(),
    platform: 'meta', intent_hash: HEX, contract_version: D.CONTRACT_VERSION,
    operation: D.OPERATION, connector: 'fake', status: 'started',
    scenario: null, error_code: null, retryable: null,
    simulated: true, published: false, external_action_taken: false,
    started_at: new Date(), settled_at: null,
    credential_ref: 'user_integrations',
  });
  assert.equal(pub.object_kind, 'campaign_delivery_attempt');
  assert.strictEqual(pub.claim_token, undefined);
  assert.strictEqual(pub.credential_ref, undefined);
  assert.strictEqual(pub.intent_hash, undefined);
  assert.equal(pub.simulated, true);
  assert.equal(pub.published, false);
  assert.equal(pub.external_action_taken, false);
  assert.doesNotMatch(JSON.stringify(pub), /secret-claim-token/);
  assert.doesNotMatch(JSON.stringify(pub), /credential_ref/);
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign-delivery-attempts skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null; let tenantB = null; let hostA = null; let hostB = null; let userId = null;

  before(async () => {
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`, [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AO6D ATT A ${SUFFIX}`, `ao6d-att-a-${SUFFIX}`);
    tenantB = await mk(`AO6D ATT B ${SUFFIX}`, `ao6d-att-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6d-att') RETURNING id`,
      [`pr6d-att-${SUFFIX}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  test('nextAttemptNumber is 1 then 2 under an outbox lock', async () => {
    const p = db.getPool();
    const graph = await seedBoundGraph(p, tenantA, hostA, userId);
    await withTx(p, async (c) => {
      await c.query(`SELECT id FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantA, graph.outboxId]);
      const n1 = await attempts.nextAttemptNumber(c, { tenantId: tenantA, outboxId: graph.outboxId });
      assert.equal(n1, 1);
      const first = await startAttempt(c, tenantA, graph, n1);
      assert.equal(first.status, 'started');
      assert.equal(first.attempt_number, 1);
      assert.equal(first.generation, 1);
      assert.equal(first.connector, 'fake');
      assert.match(first.claim_token, /^[0-9a-f]{64}$/);
      assert.ok(first.claim_token.length >= 8 && first.claim_token.length <= 128);
      const n2 = await attempts.nextAttemptNumber(c, { tenantId: tenantA, outboxId: graph.outboxId });
      assert.equal(n2, 2);
      const second = await startAttempt(c, tenantA, graph, n2);
      assert.equal(second.attempt_number, 2);
      assert.equal(second.generation, 2);
      assert.notEqual(first.id, second.id);
      assert.notEqual(first.claim_token, second.claim_token);
    });
  });

  test('reclaim allocates a new id and token; abandoned_lease history is retained', async () => {
    const p = db.getPool();
    const graph = await seedBoundGraph(p, tenantA, hostA, userId);
    const { first, second } = await withTx(p, async (c) => {
      await c.query(`SELECT id FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantA, graph.outboxId]);
      const first = await startAttempt(c, tenantA, graph, 1);
      const abandoned = await attempts.abandonExpiredLease(c, {
        tenantId: tenantA, attemptId: first.id, settledAt: new Date(),
      });
      assert.equal(abandoned.status, 'abandoned_lease');
      assert.equal(abandoned.error_code, 'simulated_lease_expired');
      assert.equal(abandoned.retryable, true);
      assert.ok(abandoned.settled_at);
      assert.equal(abandoned.claim_token, first.claim_token);
      const n2 = await attempts.nextAttemptNumber(c, { tenantId: tenantA, outboxId: graph.outboxId });
      assert.equal(n2, 2);
      const second = await startAttempt(c, tenantA, graph, n2);
      return { first, second };
    });
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.claim_token, first.claim_token);
    const listed = await attempts.listAttemptsForOutbox(p, { tenantId: tenantA, outboxId: graph.outboxId });
    assert.equal(listed.length, 2);
    assert.equal(listed[0].status, 'abandoned_lease');
    assert.equal(listed[1].status, 'started');
    assert.equal(listed[0].id, first.id);
    assert.equal(listed[1].id, second.id);
    for (const row of listed) {
      assert.strictEqual(row.claim_token, undefined);
      assert.strictEqual(row.credential_ref, undefined);
    }
    const stored = (await p.query(
      `SELECT id, claim_token, status FROM orchestrator_campaign_delivery_attempts
        WHERE tenant_id=$1 AND outbox_id=$2 ORDER BY attempt_number`,
      [tenantA, graph.outboxId]
    )).rows;
    assert.equal(stored.length, 2);
    assert.notEqual(stored[0].claim_token, stored[1].claim_token);
  });

  test('claim tokens are unique per tenant', async () => {
    const p = db.getPool();
    const g1 = await seedBoundGraph(p, tenantA, hostA, userId);
    const g2 = await seedBoundGraph(p, tenantA, hostA, userId);
    const shared = `tok-${crypto.randomBytes(16).toString('hex')}`;
    await withTx(p, async (c) => {
      await startAttempt(c, tenantA, g1, 1, { claimToken: shared });
      await assert.rejects(
        () => startAttempt(c, tenantA, g2, 1, { claimToken: shared }),
        /unique|duplicate/i
      );
    });
  });

  test('cross-tenant cannot bind intent, list, or next number', async () => {
    const p = db.getPool();
    const graphA = await seedBoundGraph(p, tenantA, hostA, userId);
    const graphB = await seedBoundGraph(p, tenantB, hostB, userId);
    await withTx(p, async (c) => {
      await assert.rejects(
        () => attempts.insertStartedAttempt(c, {
          tenantId: tenantA,
          intentId: graphB.intentId,
          outboxId: graphA.outboxId,
          draftId: graphA.draftId,
          publishingRequestId: graphA.reqId,
          attemptNumber: 1,
          generation: 1,
          leaseHolder: 'w-x',
          leaseExpiresAt: new Date(Date.now() + D.LEASE_MS),
          platform: 'meta',
          intentHash: graphA.intent.intent_hash,
        }),
        /foreign key|violates/i
      );
      const nB = await attempts.nextAttemptNumber(c, { tenantId: tenantB, outboxId: graphA.outboxId });
      assert.equal(nB, 1);
    });
    await withTx(p, async (c) => {
      await startAttempt(c, tenantA, graphA, 1);
    });
    const listedB = await attempts.listAttemptsForOutbox(p, { tenantId: tenantB, outboxId: graphA.outboxId });
    assert.deepStrictEqual(listedB, []);
    const listedA = await attempts.listAttemptsForOutbox(p, { tenantId: tenantA, outboxId: graphA.outboxId });
    assert.equal(listedA.length, 1);
    const listedWrongOutbox = await attempts.listAttemptsForOutbox(p, { tenantId: tenantA, outboxId: graphB.outboxId });
    assert.deepStrictEqual(listedWrongOutbox, []);
  });
}
