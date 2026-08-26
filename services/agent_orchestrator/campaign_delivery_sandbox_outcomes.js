'use strict';

const { newId } = require('./runner');
const D = require('./campaign_delivery_contracts');

const OBJECT_KIND = 'campaign_delivery_sandbox_outcome';

function one(c, sql, p) { return c.query(sql, p).then((r) => r.rows[0] || null); }

function publicSandboxOutcome(row) {
  if (!row) return null;
  return {
    object_kind: OBJECT_KIND,
    id: row.id,
    tenant_id: row.tenant_id,
    outbox_id: row.outbox_id,
    intent_id: row.intent_id,
    scenario: row.scenario,
    source: row.source || D.OUTCOME_SOURCE_SANDBOX,
    simulated: row.simulated === true,
    published: row.published === true,
    external_action_taken: row.external_action_taken === true,
    created_at: row.created_at,
    consumed_at: row.consumed_at || null,
    consumed_attempt_id: row.consumed_attempt_id || null,
  };
}

function assertValidScenario(scenario) {
  return D.assertKnownScenario(scenario);
}

async function seedSandboxOutcome(client, o) {
  const scenario = assertValidScenario(o.scenario);
  const id = o.id || newId('cdso');
  const row = (await client.query(
    `INSERT INTO orchestrator_campaign_delivery_sandbox_outcomes
       (id, tenant_id, outbox_id, intent_id, scenario, source,
        simulated, published, external_action_taken, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, TRUE, FALSE, FALSE, COALESCE($7::timestamptz, now()))
     RETURNING *`,
    [
      id, o.tenantId, o.outboxId, o.intentId, scenario, D.OUTCOME_SOURCE_SANDBOX,
      o.createdAt || null,
    ]
  )).rows[0];
  return row;
}

async function lockUnconsumedOutcome(client, { tenantId, outboxId }) {
  return one(client,
    `SELECT * FROM orchestrator_campaign_delivery_sandbox_outcomes
      WHERE tenant_id=$1 AND outbox_id=$2 AND consumed_at IS NULL
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1`,
    [tenantId, outboxId]);
}

async function consumeOutcome(client, o) {
  const consumedAt = o.consumedAt || new Date();
  return one(client,
    `UPDATE orchestrator_campaign_delivery_sandbox_outcomes AS o
        SET consumed_at=$3, consumed_attempt_id=$4
      WHERE o.tenant_id=$1 AND o.id=$2 AND o.consumed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM orchestrator_campaign_delivery_attempts a
           WHERE a.tenant_id = o.tenant_id
             AND a.id = $4
             AND a.outbox_id = o.outbox_id
             AND a.intent_id = o.intent_id
        )
      RETURNING *`,
    [o.tenantId, o.outcomeId, consumedAt, o.attemptId]);
}

module.exports = {
  OBJECT_KIND,
  publicSandboxOutcome,
  seedSandboxOutcome,
  lockUnconsumedOutcome,
  consumeOutcome,
};
