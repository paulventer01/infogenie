'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vault = require('../services/credentials/vault');

const schemaSource = fs.readFileSync(
  require.resolve('../services/agent_orchestrator/schema'), 'utf8'
);

test('Google Ads authority schema is tenant-leading, bounded, and terminal', () => {
  assert.match(schemaSource,
    /CREATE TABLE IF NOT EXISTS orchestrator_tenant_google_ads_credential_refs\([\s\S]*?PRIMARY KEY\(tenant_id,id\)/);
  assert.match(schemaSource,
    /CREATE TABLE IF NOT EXISTS orchestrator_google_ads_provider_draft_capabilities\([\s\S]*?PRIMARY KEY\(tenant_id,id\)/);
  assert.match(schemaSource, /status IN \('issued','reserved','consumed','revoked','expired'\)/);
  assert.match(schemaSource, /OLD\.status IN \('consumed','revoked','expired'\)/);
  assert.match(schemaSource, /orchestrator_gapdc_audit_evidence/);
  assert.match(schemaSource, /expires_at<=issued_at\+INTERVAL '10 minutes'/);
  assert.match(schemaSource, /orchestrator_gapdc_one_live_authority/);
  assert.match(schemaSource, /orchestrator_gapdc_unique_reservation/);
  assert.match(schemaSource, /orchestrator_gapdc_unique_invocation/);
  assert.match(schemaSource, /orchestrator_gapdc_unique_confirmation/);
});

test('Google Ads authority schema stores metadata and hashes, not provider secrets or raw account ids', () => {
  const start = schemaSource.indexOf('// PR10A — metadata-only Google Ads credential reference');
  const end = schemaSource.indexOf('// PR 8C — consumes one approved', start);
  const authoritySchema = schemaSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(authoritySchema,
    /\b(?:access_token|refresh_token|client_secret|developer_token|authorization_code|authorization_header|customer_id|provider_response|provider_url)\b/i);
  assert.match(authoritySchema, /account_fingerprint TEXT NOT NULL/);
  assert.match(authoritySchema, /ON DELETE RESTRICT/);
});

test('Google Ads authority kill switches are seeded for existing and future tenants', () => {
  assert.match(schemaSource,
    /VALUES\('optimization_execution',false\),\('google_ads_provider_draft',false\)/);
  assert.match(schemaSource,
    /VALUES\(tenant_row\.id,'optimization_execution',false\),\(tenant_row\.id,'google_ads_provider_draft',false\)/);
  assert.match(schemaSource,
    /VALUES\(NEW\.id,'optimization_execution',false\),\(NEW\.id,'google_ads_provider_draft',false\)/);
});

test('Google Ads customer fingerprint is deterministic and never returns the account id', () => {
  const compact = vault.accountFingerprintOfGoogleAdsCustomerId('1234567890');
  const formatted = vault.accountFingerprintOfGoogleAdsCustomerId('123-456-7890');
  assert.match(compact, /^[0-9a-f]{64}$/);
  assert.equal(formatted, compact);
  assert.notEqual(compact, '1234567890');
  assert.equal(vault.accountFingerprintOfGoogleAdsCustomerId('not-an-account'), null);
});
