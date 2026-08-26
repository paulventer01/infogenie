'use strict';
// Zero-network regression: Meta paused-draft payload fidelity and fail-closed gates.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.INFOGENIE_API_KEY = process.env.INFOGENIE_API_KEY || '<set-via-environment>';

require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_GRAPH_VERSION, metaGraphVersion } = require('../services/agent_orchestrator/connectors/meta_graph_version');
const {
  validateApprovedSnapshotForMetaDraft,
  buildMetaPausedDraftRequests,
  selectPrimaryCreative,
} = require('../services/agent_orchestrator/connectors/meta_paused_draft_snapshot');
const metaPausedDraft = require('../services/agent_orchestrator/connectors/meta_paused_draft');
const caps = require('../services/security/advertising_provider_capabilities');

const META_PAGE_ID = '9876543210123';

const CREDS = Object.freeze({
  accessToken: 'test-token',
  adAccountId: 'act_123456789',
  pageId: META_PAGE_ID,
});

function approvedSnapshot(over = {}) {
  return {
    contract_version: 'campaign_draft_v1',
    objective: 'traffic',
    platforms: ['meta'],
    accounts: [{ platform: 'meta', credential_ref: 'user_integrations' }],
    destination: { landing_page_url: 'https://example.com/p' },
    budget: { amount_micros: 2500000, currency: 'USD' },
    schedule: { start_at: new Date(Date.now() + 864e5).toISOString() },
    geo: { countries: ['US', 'CA'] },
    audience: { name: 'SMB buyers' },
    creatives: [
      { kind: 'creative_brief', asset_id: 'art_b', version: 2, content_hash: 'b'.repeat(64) },
      { kind: 'creative_brief', asset_id: 'art_a', version: 1, content_hash: 'a'.repeat(64) },
    ],
    tracking: { utm_source: 'ig', utm_medium: 'cpc', utm_campaign: 'spring' },
    provenance: { workflow_id: 'wf_test' },
    ...over,
  };
}

function paramsObject(step) {
  return { ...step.params };
}

test('Meta graph version defaults to authoritative v26.0', () => {
  delete process.env.META_GRAPH_API_VERSION;
  assert.equal(DEFAULT_GRAPH_VERSION, 'v26.0');
  assert.equal(metaGraphVersion(), 'v26.0');
  assert.equal(metaPausedDraft.metaGraphVersion(), 'v26.0');
});

test('primary creative selection is deterministic first-by asset_id then version', () => {
  const primary = selectPrimaryCreative(approvedSnapshot());
  assert.equal(primary.asset_id, 'art_a');
  assert.equal(primary.version, 1);
});

test('buildMetaPausedDraftRequests maps approved snapshot fields exactly', () => {
  const snapshot = approvedSnapshot();
  const steps = buildMetaPausedDraftRequests(snapshot, CREDS);
  assert.equal(steps.length, 4);

  const campaign = paramsObject(steps[0]);
  assert.match(steps[0].path, /^\/act_123456789\/campaigns$/);
  assert.equal(campaign.name, 'SMB buyers');
  assert.equal(campaign.objective, 'OUTCOME_TRAFFIC');
  assert.equal(campaign.status, 'PAUSED');
  assert.equal(campaign.is_adset_budget_sharing_enabled, 'false');

  const adset = paramsObject(steps[1]);
  assert.equal(adset.status, 'PAUSED');
  assert.equal(adset.optimization_goal, 'LINK_CLICKS');
  assert.equal(adset.daily_budget, '250');
  assert.equal(adset.bid_strategy, 'LOWEST_COST_WITHOUT_CAP');
  assert.doesNotMatch(Object.keys(adset).join(' '), /start_time|end_time|lifetime_budget/);
  const targeting = JSON.parse(adset.targeting);
  assert.deepEqual(targeting.geo_locations.countries, ['US', 'CA']);
  assert.equal(targeting.targeting_automation.advantage_audience, 0);

  const creative = paramsObject(steps[2]);
  const story = JSON.parse(creative.object_story_spec);
  assert.equal(story.page_id, META_PAGE_ID);
  assert.match(story.link_data.link, /^https:\/\/example\.com\/p\?/);
  assert.match(story.link_data.link, /utm_source=ig/);
  assert.match(story.link_data.link, /utm_medium=cpc/);
  assert.match(story.link_data.link, /utm_campaign=spring/);
  assert.equal(story.link_data.message, 'SMB buyers');
  assert.equal(story.link_data.name, 'SMB buyers');

  const ad = paramsObject(steps[3]);
  assert.equal(ad.status, 'PAUSED');
});

test('validateApprovedSnapshotForMetaDraft fails closed for unsupported objective', () => {
  assert.throws(
    () => validateApprovedSnapshotForMetaDraft(approvedSnapshot({ objective: 'sales' }), CREDS),
    (err) => err && err.code === 'validation_failed'
  );
});

test('validateApprovedSnapshotForMetaDraft fails closed for missing page id before writes', () => {
  assert.throws(
    () => validateApprovedSnapshotForMetaDraft(approvedSnapshot(), { ...CREDS, pageId: '' }),
    (err) => err && err.code === 'validation_failed' && err.extra && err.extra.field === 'page_id'
  );
});

test('createPausedDraftGraph performs zero provider writes when page id is missing', async () => {
  let writes = 0;
  const capability = await mintConsumedCapability();
  await assert.rejects(
    () => metaPausedDraft.createPausedDraftGraph({
      capability,
      credentials: { accessToken: 'tok', adAccountId: 'act_123456789' },
      snapshot: approvedSnapshot(),
      inject: {
        create: async () => {
          writes += 1;
          return { status: 200, body: { id: 'x' } };
        },
      },
    }),
    (err) => err && err.code === 'validation_failed' && err.extra && err.extra.field === 'page_id'
  );
  assert.equal(writes, 0);
});

test('createPausedDraftGraph uses current graph version prefix on outbound paths', async () => {
  const paths = [];
  const result = await metaPausedDraft.createPausedDraftGraph({
    capability: await mintConsumedCapability(),
    credentials: CREDS,
    snapshot: approvedSnapshot(),
    inject: {
      create: async (_kind, spec) => {
        paths.push(spec.path);
        return { status: 200, body: { id: `obj_${paths.length}` } };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(paths.length, 4);
  for (const path of paths) assert.match(path, /^\/act_123456789\//);
  assert.equal(metaGraphVersion(), 'v26.0');
});

test('compensateCreated uses inject.delete in reverse order without live network', async () => {
  const https = require('node:https');
  const { compensateCreated } = require('../services/agent_orchestrator/connectors/meta_paused_draft');
  let networkDeletes = 0;
  const origRequest = https.request;
  https.request = function (...args) {
    networkDeletes += 1;
    throw new Error('NETWORK_FORBIDDEN');
  };
  const deletes = [];
  const created = [
    { object_kind: 'campaign', provider_object_id: 'c1', sequence_number: 1, compensated: false },
    { object_kind: 'adset', provider_object_id: 'a1', sequence_number: 2, compensated: false },
  ];
  try {
    const count = await compensateCreated(created, 'secret-token', {
      delete: async (kind, objectId) => {
        deletes.push({ kind, objectId });
        return true;
      },
    });
    assert.equal(count, 2);
    assert.equal(networkDeletes, 0);
    assert.deepEqual(deletes, [
      { kind: 'adset', objectId: 'a1' },
      { kind: 'campaign', objectId: 'c1' },
    ]);
    assert.equal(created[0].compensated, true);
    assert.equal(created[1].compensated, true);
  } finally {
    https.request = origRequest;
  }
});

test('partial create outcome marks objects compensated consistently', async () => {
  let calls = 0;
  const deletes = [];
  const result = await metaPausedDraft.createPausedDraftGraph({
    capability: await mintConsumedCapability(),
    credentials: CREDS,
    snapshot: approvedSnapshot(),
    inject: {
      create: async (kind) => {
        calls += 1;
        if (calls === 3) return { status: 400, body: { error: { code: 100 } } };
        return { status: 200, body: { id: `${kind}_${calls}` } };
      },
      delete: async (kind, objectId) => {
        deletes.push({ kind, objectId });
        return true;
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.objects_created, 2);
  assert.equal(result.objects_compensated, 2);
  assert.equal(deletes.length, 2);
  assert.deepEqual(deletes.map((d) => d.kind), ['adset', 'campaign']);
  for (const obj of result.objects) {
    assert.equal(obj.provider_status, 'PAUSED');
    assert.equal(obj.compensated, true);
  }
});

async function mintConsumedCapability() {
  const now = Date.now();
  const binding = {
    tenant_id: 7, revision: 1, workflow_approval_id: 2, generation: 1,
    credential_ref_version: 1, requested_by: 3,
    draft_id: 'cd_1', publish_approval_id: 'cpa_1', publishing_request_id: 'cpr_1',
    intent_id: 'cdi_1', outbox_id: 'ob_1', attempt_id: 'cda_1',
    challenge_id: 'cpc_1', confirmation_id: 'cpcf_1', credential_ref_id: 'tmcr_1',
    claim_token_hash: 'a'.repeat(64), intent_hash: 'b'.repeat(64),
    snapshot_hash: 'c'.repeat(64), contract_hash: 'd'.repeat(64),
    request_hash: 'e'.repeat(64), phrase_digest: 'f'.repeat(64),
    account_fingerprint: '1'.repeat(64),
    issued_at_ms: now, expires_at_ms: now + 30_000,
  };
  const client = {
    async query(sql) {
      if (/pg_current_xact_id\(\)/i.test(String(sql))) {
        return { rows: [{ transaction_id: 'tx-payload-test' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return caps.withAdvertisingProviderExecutionTransaction(client, async (tx) => {
    const capability = await caps.mintMetaCreateProviderDraftCapability(tx, binding);
    await caps.assertMetaCreateProviderDraftCapability(capability, binding, { now });
    return capability;
  });
}
