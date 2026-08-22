'use strict';

// Tenant-scoped research evidence INSERT helper. Validates, then writes
// `content_fingerprint`. Concurrent volume limits are enforced by the DB
// FOR UPDATE quota trigger — this module does not pre-count rows.
// No HTTP, no fetch, no live connectors.

const { fail } = require('./errors');
const { assertEvidenceItem, assertCompetitor } = require('./research_validate');

const QUOTA_EXCEPTION = 'orchestrator_research_evidence_limit_exceeded';

function isQuotaError(err) {
  const msg = String((err && err.message) || '');
  return msg.includes(QUOTA_EXCEPTION);
}

function failQuota(loadedLimits) {
  if (loadedLimits && typeof loadedLimits === 'object'
      && loadedLimits.max_records != null && loadedLimits.max_bytes != null) {
    fail('research_evidence_limit_exceeded', {
      max_records: loadedLimits.max_records,
      max_bytes: loadedLimits.max_bytes,
    });
  }
  fail('research_evidence_limit_exceeded');
}

async function ensureResearchLimits(poolOrClient, tenantId, opts = {}) {
  await poolOrClient.query(
    `INSERT INTO orchestrator_tenant_limits
       (tenant_id, max_research_evidence_records, max_research_evidence_payload_bytes)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id) DO UPDATE SET
       max_research_evidence_records = EXCLUDED.max_research_evidence_records,
       max_research_evidence_payload_bytes = EXCLUDED.max_research_evidence_payload_bytes`,
    [
      tenantId,
      opts.records != null ? opts.records : 10000,
      opts.bytes != null ? opts.bytes : 104857600,
    ]
  );
}

async function insertCompetitor(poolOrClient, item, opts) {
  const tenantId = opts && opts.tenantId;
  const row = assertCompetitor(item, { tenantId });
  await poolOrClient.query(
    `INSERT INTO orchestrator_research_competitors
       (id, tenant_id, research_run_id, platform, provider_advertiser_id, normalized_name,
        canonical_url, country, market, discovery_source, captured_at, dedup_key,
        contract_version, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$13, COALESCE($14::timestamptz, now()))`,
    [
      row.id,
      row.tenant_id,
      row.research_run_id,
      row.platform,
      row.provider_advertiser_id,
      row.normalized_name,
      row.canonical_url,
      row.country,
      row.market,
      row.discovery_source,
      row.captured_at,
      row.dedup_key,
      row.contract_version,
      row.created_at,
    ]
  );
  return row;
}

async function insertEvidenceItem(poolOrClient, item, opts) {
  const tenantId = opts && opts.tenantId;
  const row = assertEvidenceItem(item, { tenantId });
  try {
    await poolOrClient.query(
      `INSERT INTO orchestrator_research_evidence
         (id, tenant_id, research_run_id, competitor_id, platform, source_type,
          provider_external_id, canonical_source_url, advertiser_name, creative_format,
          headline, body_text, excerpt, provider_started_on, provider_ended_on,
          captured_at, market, language, placement, provider_metrics, metrics_kind,
          provenance_method, connector_id, connector_version, contract_version,
          content_fingerprint, dedup_key, expires_at, retention_class, supersedes_id,
          created_at)
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17,$18,$19,
         $20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28::timestamptz,$29,$30,
         COALESCE($31::timestamptz, now())
       )`,
      [
        row.id,
        row.tenant_id,
        row.research_run_id,
        row.competitor_id,
        row.platform,
        row.source_type,
        row.provider_external_id,
        row.canonical_source_url,
        row.advertiser_name,
        row.creative_format,
        row.headline,
        row.body_text,
        row.excerpt,
        row.provider_started_on,
        row.provider_ended_on,
        row.captured_at,
        row.market,
        row.language,
        row.placement,
        JSON.stringify(row.provider_metrics || {}),
        row.metrics_kind,
        row.provenance_method,
        row.connector_id,
        row.connector_version,
        row.contract_version,
        row.content_fingerprint,
        row.dedup_key,
        row.expires_at,
        row.retention_class,
        row.supersedes_id,
        row.created_at,
      ]
    );
  } catch (err) {
    if (isQuotaError(err)) failQuota(opts && opts.loadedLimits);
    throw err;
  }
  return row;
}

module.exports = {
  insertEvidenceItem,
  insertCompetitor,
  ensureResearchLimits,
};
