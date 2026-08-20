'use strict';

// Versioned placeholder pricing catalog. Never use client-supplied cost.
// Conservative (ceil) estimates. Seed is idempotent per tenant at version 1.

const { fail } = require('./errors');
const { toBigInt, requireNonNegativeMicros, toSql } = require('./money');

// 1 cent per stub request. Catalog rows for `request` store unused per-million
// prices (0); callers must use this constant rather than multiplying zeros.
const DEFAULT_REQUEST_MICROS = 10_000n;
const MILLION = 1_000_000n;

const PLACEHOLDER_PROVIDER = 'placeholder';
const PLACEHOLDER_MODEL = 'stub-chargeable';

function ceilDiv(num, den) {
  if (den <= 0n) fail('validation_failed');
  if (num <= 0n) return 0n;
  return (num + den - 1n) / den;
}

async function seedCatalog(client, tenantId) {
  // Clearly labelled placeholders — not live billed.
  await client.query(
    `INSERT INTO orchestrator_pricing_catalog
       (tenant_id, provider, model_or_service, unit_type,
        input_price_micros_per_million, output_price_micros_per_million, pricing_version)
     VALUES
       ($1, 'placeholder', 'stub-chargeable', 'request', 0, 0, 1),
       ($1, 'openai', 'gpt-4o', 'token_input', 2500000, 0, 1),
       ($1, 'openai', 'gpt-4o', 'token_output', 0, 10000000, 1)
     ON CONFLICT (tenant_id, provider, model_or_service, unit_type, pricing_version)
     DO NOTHING`,
    [tenantId]
  );
}

async function latestPrice(client, {
  tenantId, provider, model, unitType,
}) {
  const r = await client.query(
    `SELECT * FROM orchestrator_pricing_catalog
      WHERE tenant_id=$1 AND provider=$2 AND model_or_service=$3 AND unit_type=$4
      ORDER BY pricing_version DESC, effective_from DESC
      LIMIT 1`,
    [tenantId, String(provider || ''), String(model || ''), String(unitType || 'request')]
  );
  return r.rows[0] || null;
}

async function listCatalog(client, tenantId) {
  await seedCatalog(client, tenantId);
  const r = await client.query(
    `SELECT provider, model_or_service, unit_type,
            input_price_micros_per_million, output_price_micros_per_million,
            currency, pricing_version, effective_from
       FROM orchestrator_pricing_catalog
      WHERE tenant_id=$1
      ORDER BY provider, model_or_service, unit_type, pricing_version DESC`,
    [tenantId]
  );
  return r.rows;
}

function estimateFromRow(row, { unitType, inputUnits, outputUnits }) {
  const ut = String(unitType || (row && row.unit_type) || 'request');
  if (ut === 'request') return DEFAULT_REQUEST_MICROS;
  const inUnits = requireNonNegativeMicros(inputUnits == null ? 0 : inputUnits);
  const outUnits = requireNonNegativeMicros(outputUnits == null ? 0 : outputUnits);
  const inPrice = toBigInt(row && row.input_price_micros_per_million);
  const outPrice = toBigInt(row && row.output_price_micros_per_million);
  return ceilDiv(inUnits * inPrice, MILLION) + ceilDiv(outUnits * outPrice, MILLION);
}

async function estimateMaxCost(client, {
  tenantId, provider, model, unitType, inputUnits, outputUnits,
}) {
  const ut = String(unitType || 'request');
  if (ut === 'request') return {
    estimatedMicros: DEFAULT_REQUEST_MICROS,
    pricingVersion: 1,
    provider: provider || PLACEHOLDER_PROVIDER,
    model: model || PLACEHOLDER_MODEL,
    unitType: ut,
  };
  await seedCatalog(client, tenantId);
  const row = await latestPrice(client, { tenantId, provider, model, unitType: ut });
  // Missing catalog row: fail closed to the conservative per-request floor
  // rather than treating unknown prices as free.
  const estimatedMicros = row
    ? estimateFromRow(row, { unitType: ut, inputUnits, outputUnits })
    : DEFAULT_REQUEST_MICROS;
  return {
    estimatedMicros,
    pricingVersion: row ? Number(row.pricing_version) : 1,
    provider: provider || PLACEHOLDER_PROVIDER,
    model: model || PLACEHOLDER_MODEL,
    unitType: ut,
  };
}

function estimateStubChargeable() {
  return DEFAULT_REQUEST_MICROS;
}

module.exports = {
  DEFAULT_REQUEST_MICROS,
  PLACEHOLDER_PROVIDER,
  PLACEHOLDER_MODEL,
  seedCatalog,
  latestPrice,
  listCatalog,
  estimateMaxCost,
  estimateStubChargeable,
  estimateFromRow,
  toSql,
};
