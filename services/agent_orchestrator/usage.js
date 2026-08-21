'use strict';

// Append-only usage records. estimated vs final. Never persist a client-supplied
// cost as final unless it was computed server-side from provider units.

const { toSql } = require('./money');

async function appendUsage(client, {
  tenantId,
  reservationId = null,
  workflowId = null,
  stepId = null,
  provider = '',
  model = '',
  unitType = 'request',
  inputUnits = 0n,
  outputUnits = 0n,
  estimatedMicros = 0n,
  actualMicros = null,
  costStatus = 'estimated',
  pricingVersion = null,
  usageSource = 'estimated',
}) {
  const source = usageSource === 'provider' || usageSource === 'manual' ? usageSource : 'estimated';
  const status = costStatus === 'final' ? 'final' : 'estimated';
  const r = await client.query(
    `INSERT INTO orchestrator_usage_records
       (tenant_id, reservation_id, workflow_id, step_id, provider, model_or_service,
        unit_type, input_units, output_units, estimated_cost_micros, actual_cost_micros,
        cost_status, pricing_version, usage_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      tenantId,
      reservationId,
      workflowId,
      stepId,
      String(provider || ''),
      String(model || ''),
      String(unitType || 'request'),
      toSql(inputUnits),
      toSql(outputUnits),
      toSql(estimatedMicros),
      actualMicros == null ? null : toSql(actualMicros),
      status,
      pricingVersion == null ? null : Number(pricingVersion),
      source,
    ]
  );
  return r.rows[0];
}

async function sumUsage(client, {
  tenantId, workflowId, provider, model, since,
}) {
  const conds = ['tenant_id=$1', "cost_status='final'"];
  const vals = [tenantId];
  let i = 2;
  if (workflowId) {
    conds.push(`workflow_id=$${i++}`);
    vals.push(workflowId);
  }
  if (provider) {
    conds.push(`provider=$${i++}`);
    vals.push(provider);
  }
  if (model) {
    conds.push(`model_or_service=$${i++}`);
    vals.push(model);
  }
  if (since) {
    conds.push(`created_at >= $${i++}`);
    vals.push(since);
  }
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0) AS total
       FROM orchestrator_usage_records
      WHERE ${conds.join(' AND ')}`,
    vals
  );
  return r.rows[0].total;
}

module.exports = {
  appendUsage,
  sumUsage,
};
