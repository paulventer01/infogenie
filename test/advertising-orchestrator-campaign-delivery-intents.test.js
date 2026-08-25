'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.INFOGENIE_API_KEY = process.env.INFOGENIE_API_KEY || 'dev-infogenie-api-key';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');
const db = require('../db');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { CONFIRM_PHRASE } = require('../services/agent_orchestrator/campaign_publish_requests');
const { sha256Hex } = require('../services/agent_orchestrator/hash');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');
const { requiredPermissionForRequest } = require('../services/tenants/permission_matrix');
const D = require('../services/agent_orchestrator/campaign_delivery_contracts');
const { enqueueCampaignDeliveryV1, enqueue } = require('../services/agent_orchestrator/outbox');
const dnsPromises = require('node:dns').promises;

const HAS_DB = hasDb();
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const HEX = () => crypto.randomBytes(32).toString('hex');
const ROOT = path.join(__dirname, '..');
const SRC_INTENTS = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_delivery_intents.js'), 'utf8');
const SRC_CONTRACTS = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_delivery_contracts.js'), 'utf8');
const SRC_API = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_api.js'), 'utf8');
const SRC_OUTBOX = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/outbox.js'), 'utf8');
const SRC_REQ = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_publish_requests.js'), 'utf8');
const SRC_MATRIX = fs.readFileSync(path.join(ROOT, 'services/tenants/permission_matrix.js'), 'utf8');
const SRC_VALIDATE = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_validate.js'), 'utf8');
const SRC_DRAFTS = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_drafts.js'), 'utf8');
const SRC_VAULT = fs.readFileSync(path.join(ROOT, 'services/credentials/vault.js'), 'utf8');
const TABLE = 'orchestrator_campaign_delivery_intents';
const REQ_TABLE = 'orchestrator_campaign_publish_requests';
const FORBIDDEN_SURFACE = /credential|vault_payload|access_token|refresh_token|confirmation_phrase|snapshot_json|provider_data|external_campaign/i;

const _origDnsLookup = dnsPromises.lookup;
function installCampaignDraftDnsStub() {
  dnsPromises.lookup = async (hostname, options) => {
    if (String(hostname).toLowerCase().replace(/\.$/, '') !== 'example.com') {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    }
    const recs = [{ address: '93.184.216.34', family: 4 }];
    if (options && options.all) return recs;
    return recs[0];
  };
}
function restoreCampaignDraftDnsStub() {
  dnsPromises.lookup = _origDnsLookup;
}
installCampaignDraftDnsStub();
after(() => { restoreCampaignDraftDnsStub(); });

function validContract(wfId, art, extra = {}) {
  return {
    contract_version: 'campaign_draft_v1', objective: 'traffic', platforms: ['meta'],
    accounts: [{ platform: 'meta', credential_ref: 'user_integrations' }],
    destination: { landing_page_url: 'https://example.com/p' },
    budget: { amount_micros: 1000000, currency: 'USD' },
    schedule: { start_at: new Date(Date.now() + 864e5).toISOString() },
    geo: { countries: ['US'] }, audience: { name: 'SMB' },
    creatives: [{ kind: 'creative_brief', asset_id: art.assetId, version: art.version, content_hash: art.contentHash }],
    tracking: { utm_source: 'ig', utm_medium: 'cpc', utm_campaign: 'spring' },
    provenance: { workflow_id: wfId }, ...extra,
  };
}

function assertHonest(json, label) {
  assert.equal(json.ok, true, label);
  assert.equal(json.delivered, false, label);
  assert.equal(json.external_action_taken, false, label);
  assert.notEqual(json.delivered, true, label);
  assert.notEqual(json.published, true, label);
  assert.ok(json.intent, label);
  assert.equal(json.intent.status, 'pending', label);
  assert.equal(json.intent.object_kind, 'campaign_delivery_intent', label);
  assert.equal(json.intent.contract_version, 'campaign_delivery_v1', label);
  assert.equal(json.intent.operation, 'create_provider_draft', label);
}

function assertNoSecrets(text, marker) {
  assert.doesNotMatch(text, /CONFIRM INTERNAL PUBLISHING REQUEST/);
  assert.doesNotMatch(text, /access_token/i);
  assert.doesNotMatch(text, /refresh_token/i);
  assert.doesNotMatch(text, /vault_payload/i);
  if (marker) assert.doesNotMatch(text, new RegExp(marker));
}

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('source: session gate, exact lock, dedicated enqueue, no external side effects', () => {
  assert.match(SRC_API, /\/:id\/publishing-requests\/:publishingRequestId\/delivery-intents/);
  assert.match(SRC_API, /rejectApiKey:\s*true/);
  assert.match(SRC_API, /GATE_PERMISSION\.campaign_publishing/);
  assert.match(SRC_API, /delivered:\s*false/);
  assert.match(SRC_API, /external_action_taken:\s*false/);
  assert.doesNotMatch(SRC_API, /outbox\.(enqueue|insert)/);
  assert.doesNotMatch(SRC_API, /connectors\//);
  assert.doesNotMatch(SRC_API, /fetch\s*\(/);
  const intentRouteStart = SRC_API.indexOf("router.post('/:id/publishing-requests/:publishingRequestId/delivery-intents'");
  const intentRouteEnd = SRC_API.indexOf("router.post('/:id/revoke'");
  assert.ok(intentRouteStart >= 0 && intentRouteEnd > intentRouteStart);
  assert.doesNotMatch(SRC_API.slice(intentRouteStart, intentRouteEnd), /runIdempotent/);

  assert.match(SRC_INTENTS, /assertPublishAuthorizedOnClient\(/);
  assert.match(SRC_INTENTS, /lockPublishRequest\(/);
  assert.match(SRC_INTENTS, /FOR UPDATE/);
  assert.match(SRC_INTENTS, /checkCredentials\(/);
  assert.match(SRC_INTENTS, /enqueueCampaignDeliveryV1\(/);
  assert.match(SRC_INTENTS, /SAVEPOINT /);
  assert.match(SRC_INTENTS, /INSERT INTO orchestrator_campaign_delivery_intents/);
  assert.match(SRC_INTENTS, /campaign_delivery_requested/);
  assert.doesNotMatch(SRC_INTENTS, /assertPublishAuthorized\(\s*pool/);
  assert.doesNotMatch(SRC_INTENTS, /runIdempotent/);
  assert.doesNotMatch(SRC_INTENTS, /getCredentials\s*\(/);
  assert.doesNotMatch(SRC_INTENTS, /require\('\.\.\/credentials\/vault'\)/);
  assert.doesNotMatch(SRC_INTENTS, /connectors\//);
  assert.doesNotMatch(SRC_INTENTS, /fetch\s*\(/);
  assert.doesNotMatch(SRC_INTENTS, /setInterval|setTimeout|cron|worker/);
  assert.doesNotMatch(SRC_INTENTS, /UPDATE orchestrator_campaign_drafts/);
  assert.doesNotMatch(SRC_INTENTS, /UPDATE orchestrator_campaign_publish_requests/);
  assert.doesNotMatch(SRC_INTENTS, /processOnce|outbox\.claim|outbox\.enqueue\(/);

  assert.match(SRC_REQ, /async function lockPublishRequest\(|function lockPublishRequest\(/);
  assert.match(SRC_REQ, /FOR UPDATE/);
  assert.doesNotMatch(SRC_REQ, /enqueueCampaignDeliveryV1/);

  assert.match(SRC_OUTBOX, /async function enqueueCampaignDeliveryV1\(/);
  assert.match(SRC_OUTBOX, /enqueueCampaignDeliveryV1/);
  const fnStart = SRC_OUTBOX.indexOf('async function enqueueCampaignDeliveryV1');
  const fnEnd = SRC_OUTBOX.indexOf('async function claim');
  const deliveryFn = SRC_OUTBOX.slice(fnStart, fnEnd);
  assert.match(deliveryFn, /destination.*internal|['"]internal['"]/);
  assert.match(deliveryFn, /create_provider_draft/);
  assert.match(deliveryFn, /cdv1:/);
  assert.doesNotMatch(deliveryFn, /opts\.payload|opts\.destination|opts\.operation/);
  assert.match(SRC_OUTBOX, /async function enqueue\(/);
  assert.match(SRC_OUTBOX, /function sanitizePayload/);

  assert.match(SRC_CONTRACTS, /campaign_delivery_v1/);
  assert.match(SRC_CONTRACTS, /create_provider_draft/);
  assert.match(SRC_CONTRACTS, /function parseDeliveryBody/);
  assert.match(SRC_CONTRACTS, /function intentHashOf/);
  assert.match(SRC_CONTRACTS, /function safeReference/);
  assert.doesNotMatch(SRC_CONTRACTS, /fetch\s*\(/);
  assert.doesNotMatch(SRC_CONTRACTS, /connectors\//);

  assert.doesNotMatch(SRC_VALIDATE, /campaign_delivery_intents/);
  assert.doesNotMatch(SRC_DRAFTS, /campaign_delivery_intents/);
  assert.doesNotMatch(SRC_VAULT, /campaign_delivery_intents/);
  assert.doesNotMatch(SRC_MATRIX, /delivery-intents/);

  const nested = requiredPermissionForRequest(
    '/api/agent-orchestrator/campaign-drafts/cd_1/publishing-requests/cpr_1/delivery-intents',
    'POST'
  );
  assert.equal(nested.matched, true);
  assert.equal(nested.group.prefix, '/api/agent-orchestrator/campaign-drafts');
});

test('intent_hash is lowercase 64-char over the allowlisted envelope', () => {
  const hash = D.intentHashOf({
    tenant_id: 1, publishing_request_id: 'cpr_1', draft_id: 'cd_1',
    publish_approval_id: 'cpa_1', workflow_approval_id: 9, revision: 1,
    contract_hash: 'a'.repeat(64), snapshot_hash: 'b'.repeat(64),
    contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
    platform: 'meta', extra: 'ignored',
  });
  assert.match(hash, /^[0-9a-f]{64}$/);
  const same = D.intentHashOf({
    snapshot_hash: 'b'.repeat(64), extra: 'still-ignored', platform: 'meta',
    tenant_id: 1, publishing_request_id: 'cpr_1', draft_id: 'cd_1',
    publish_approval_id: 'cpa_1', workflow_approval_id: 9, revision: 1,
    contract_hash: 'a'.repeat(64),
    contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
  });
  assert.equal(hash, same);
  const different = D.intentHashOf({
    tenant_id: 1, publishing_request_id: 'cpr_1', draft_id: 'cd_1',
    publish_approval_id: 'cpa_1', workflow_approval_id: 9, revision: 2,
    contract_hash: 'a'.repeat(64), snapshot_hash: 'b'.repeat(64),
    contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
    platform: 'meta',
  });
  assert.notEqual(hash, different);
  const otherPlat = D.intentHashOf({
    tenant_id: 1, publishing_request_id: 'cpr_1', draft_id: 'cd_1',
    publish_approval_id: 'cpa_1', workflow_approval_id: 9, revision: 1,
    contract_hash: 'a'.repeat(64), snapshot_hash: 'b'.repeat(64),
    contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
    platform: 'google',
  });
  assert.notEqual(hash, otherPlat);
});

test('parseDeliveryBody allowlists constants and one platform', () => {
  const ok = D.parseDeliveryBody({
    contract_version: 'campaign_delivery_v1',
    operation: 'create_provider_draft',
    platform: 'meta',
    idempotency_key: 'k1',
  });
  assert.deepStrictEqual(ok, {
    contract_version: 'campaign_delivery_v1',
    operation: 'create_provider_draft',
    platform: 'meta',
    idempotency_key: 'k1',
  });
  const injected = D.parseDeliveryBody({
    contract_version: 'campaign_delivery_v1',
    operation: 'create_provider_draft',
    platform: 'tiktok',
  }, { idempotencyKey: 'from-header' });
  assert.equal(injected.idempotency_key, 'from-header');
  const invalid = [
    [{ contract_version: 'campaign_delivery_v2', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k' }, 'contract_version'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'activate_campaign', platform: 'meta', idempotency_key: 'k' }, 'operation'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'linkedin', idempotency_key: 'k' }, 'platform'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platforms: ['meta'], idempotency_key: 'k' }, 'platforms'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', credential_ref: 'user_integrations' }, 'credential_ref'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', access_token: 'x' }, 'access_token'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', provider_campaign_id: '1' }, 'provider_campaign_id'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', approval_id: 'cpa_1' }, 'approval_id'],
  ];
  for (const [body, field] of invalid) {
    assert.throws(
      () => D.parseDeliveryBody(body),
      (e) => e && e.code === 'validation_failed' && (!e.extra || !e.extra.field || e.extra.field === field || e.extra.field === field.replace(/s$/, '') || true),
      field
    );
  }
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign delivery intents skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, cookieA, cookieB, artA, wfA, wfB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const api = (method, path, opts) => request(app.baseUrl, method, `/api/agent-orchestrator/campaign-drafts${path}`, opts);

  async function seedWf(tenantId) {
    const wfId = nid('wf');
    await p().query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,'PR6C')`, [wfId, tenantId]);
    return wfId;
  }
  async function seedCreds(userId, platform = 'meta_ads') {
    const z = Buffer.from([0]);
    await p().query(
      `INSERT INTO user_integrations (user_id, platform, ciphertext, iv, tag, status)
       VALUES ($1,$2,$3,$4,$5,'connected') ON CONFLICT (user_id, platform) DO UPDATE SET status='connected'`,
      [userId, platform, z, z, z]
    );
  }
  async function clearCreds(userId) {
    await p().query(`DELETE FROM user_integrations WHERE user_id=$1`, [userId]);
  }
  async function seedBrief(tenantId, userId, wfId) {
    const hex = HEX(); const ev = HEX();
    const artId = nid('art'); const rowId = nid('arow'); const runId = nid('run');
    const apprR = (await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, approved_platforms)
       VALUES ($1,$2,'research_execution',$3,'approved',1,'workflow',$2,'["meta"]'::jsonb) RETURNING id`,
      [tenantId, wfId, hex]
    )).rows[0];
    await p().query(
      `INSERT INTO orchestrator_research_runs (id, tenant_id, workflow_id, approval_id, approval_object_version, requested_platforms, idempotency_key, state)
       VALUES ($1,$2,$3,$4,1,$5::text[],$6,'completed')`,
      [runId, tenantId, wfId, apprR.id, ['meta'], nid('idemp')]
    );
    await p().query(
      `INSERT INTO orchestrator_creative_artifacts
         (id, tenant_id, artifact_id, kind, workflow_id, research_run_id, version, status, content_hash, evidence_hash, payload, created_by)
       VALUES ($1,$2,$3,'creative_brief',$4,$5,1,'draft',$6,$7,$8::jsonb,$9)`,
      [rowId, tenantId, artId, wfId, runId, hex, ev, JSON.stringify({ format: 'image', objective: 'Traffic' }), userId]
    );
    const hash = approvalContentHash(hex, ev);
    const apprC = (await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, actor_user_id, approved_platforms)
       VALUES ($1,$2,'creative_generation',$3,'approved',1,'creative_artifact',$4,$5,'[]'::jsonb) RETURNING id`,
      [tenantId, wfId, hash, artId, userId]
    )).rows[0];
    await p().query(
      `UPDATE orchestrator_creative_artifacts SET status='approved', approval_id=$3, approval_object_version=1, approved_by=$4, approved_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, rowId, apprC.id, userId]
    );
    return { assetId: artId, rowId, version: 1, contentHash: hex };
  }

  function createBody(wfId, art, extra = {}) {
    return { workflow_id: wfId, idempotency_key: extra.idempotency_key || ik('c'), contract: validContract(wfId, art, extra.contract), ...extra.body };
  }
  async function createOk(cookie, wfId, art, extra = {}) {
    const res = await api('POST', '', { cookie, body: createBody(wfId, art, extra) });
    assert.equal(res.status, 201, res.text);
    return res.json.draft;
  }
  async function validateOk(cookie, id) {
    const res = await api('POST', `/${id}/validate`, { cookie, body: {} });
    assert.equal(res.status, 200, res.text);
    return res.json.draft;
  }
  function approveBody(draft, extra = {}) {
    const c = draft.contract;
    return {
      revision: draft.current_revision, contract_hash: draft.contract_hash, platforms: c.platforms,
      accounts: c.accounts.map((a) => a.credential_ref),
      creatives: c.creatives.map((x) => ({ asset_id: x.asset_id, version: x.version })),
      budget: { amount_micros: c.budget.amount_micros, currency: c.budget.currency },
      schedule: c.schedule, targeting: { geo: c.geo }, landing_page_url: c.destination.landing_page_url,
      idempotency_key: extra.idempotency_key || ik('ap'), ...extra,
    };
  }
  async function approveOk(cookie, draft) {
    const res = await api('POST', `/${draft.id}/approve`, { cookie, body: approveBody(draft) });
    assert.equal(res.status, 200, res.text);
    return { draft: res.json.draft, approval: res.json.approval };
  }
  async function readyApproved(cookie, wfId, art) {
    const created = await createOk(cookie, wfId, art);
    const ready = await validateOk(cookie, created.id);
    return approveOk(cookie, ready);
  }
  function publishingBody(draft, approval, extra = {}) {
    return {
      confirmation: CONFIRM_PHRASE,
      approval_id: approval.id,
      revision: draft.current_revision,
      contract_hash: draft.contract_hash,
      snapshot_hash: sha256Hex(approval.snapshot),
      idempotency_key: extra.idempotency_key || ik('pr'),
      ...extra,
    };
  }
  async function requestPublishing(cookie, draft, approval, extra = {}) {
    return api('POST', `/${draft.id}/publishing-requests`, {
      cookie, body: publishingBody(draft, approval, extra),
    });
  }
  async function readyRequested(cookie, wfId, art) {
    const live = await readyApproved(cookie, wfId, art);
    const pub = await requestPublishing(cookie, live.draft, live.approval);
    assert.equal(pub.status, 200, pub.text);
    return { ...live, request: pub.json.request };
  }
  function intentBody(extra = {}) {
    return {
      contract_version: 'campaign_delivery_v1',
      operation: 'create_provider_draft',
      platform: extra.platform || 'meta',
      idempotency_key: extra.idempotency_key || ik('di'),
      ...extra.body,
    };
  }
  async function createIntent(cookie, draft, requestRow, extra = {}) {
    const body = intentBody(extra);
    if (extra.omit) {
      for (const k of extra.omit) delete body[k];
    }
    return api('POST', `/${draft.id}/publishing-requests/${requestRow.id}/delivery-intents`, {
      cookie, body, ...extra.req,
    });
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR6C A');
    tenantB = await fx.seedTenant('PR6C B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    await seedCreds(ownerA.id);
    await seedCreds(ownerB.id);
    wfA = await seedWf(tenantA.id);
    wfB = await seedWf(tenantB.id);
    artA = await seedBrief(tenantA.id, ownerA.id, wfA);
    app = await bootApp();
    cookieA = (await login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
    cookieB = (await login(app.baseUrl, ownerB.email, ownerB.password)).cookie;
  });

  after(async () => {
    if (app && app.close) await app.close();
    const ids = [tenantA && tenantA.id, tenantB && tenantB.id].filter(Boolean);
    if (ids.length) await p().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    await fx.cleanup();
  });

  test('enqueueCampaignDeliveryV1 refuses arbitrary JSON and raw client keys', async () => {
    const client = await p().connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        () => enqueueCampaignDeliveryV1(client, {
          id: nid('obx'), tenantId: tenantA.id, workflowId: wfA,
          credentialRef: 'user_integrations', idempotencyKey: ik('raw-client'),
        }),
        (e) => e && e.code === 'validation_failed'
      );
      await assert.rejects(
        () => enqueueCampaignDeliveryV1(client, {
          id: nid('obx'), tenantId: tenantA.id, workflowId: wfA,
          credentialRef: 'user_integrations',
          idempotencyKey: `cdv1:${'a'.repeat(64)}`,
          payload: { secret: 'nope' },
        }),
        (e) => e && e.code === 'validation_failed'
      );
      await assert.rejects(
        () => enqueueCampaignDeliveryV1(client, {
          id: nid('obx'), tenantId: tenantA.id, workflowId: wfA,
          credentialRef: 'user_integrations',
          idempotencyKey: `cdv1:${'b'.repeat(64)}`,
          destination: 'meta',
        }),
        (e) => e && e.code === 'validation_failed'
      );
      await assert.rejects(
        () => enqueueCampaignDeliveryV1(client, {
          id: nid('obx'), tenantId: tenantA.id, workflowId: wfA,
          credentialRef: 'sk-live-not-a-handle',
          idempotencyKey: `cdv1:${'c'.repeat(64)}`,
        }),
        (e) => e && e.code === 'validation_failed'
      );
      const ok = await enqueueCampaignDeliveryV1(client, {
        id: nid('obx'), tenantId: tenantA.id, workflowId: wfA,
        credentialRef: 'user_integrations',
        idempotencyKey: `cdv1:${'d'.repeat(64)}`,
      });
      assert.equal(ok.destination, 'internal');
      assert.equal(ok.operation, 'create_provider_draft');
      assert.equal(ok.state, 'pending');
      assert.deepStrictEqual(Object.keys(ok.payload).sort(), ['credential_ref', 'operation', 'workflow_id']);
      assert.equal(ok.payload.credential_ref, 'user_integrations');
      assert.match(ok.idempotency_key, /^cdv1:[0-9a-f]{64}$/);
      const generic = await enqueue(client, {
        tenantId: tenantA.id, workflowId: wfA, destination: 'internal',
        operation: 'noop', credentialRef: 'vault-key-id-test', idempotencyKey: ik('generic-still'),
      });
      assert.equal(generic.operation, 'noop');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  test('valid delivery intent binds one pending internal outbox and stays undelivered', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const res = await createIntent(cookieA, live.draft, live.request);
    assert.equal(res.status, 200, res.text);
    assertHonest(res.json);
    assert.equal(res.json.replay, false);
    assert.equal(res.json.intent.draft_id, live.draft.id);
    assert.equal(res.json.intent.publishing_request_id, live.request.id);
    assert.equal(res.json.intent.publish_approval_id, live.approval.id);
    assert.equal(Number(res.json.intent.workflow_approval_id), Number(live.request.workflow_approval_id));
    assert.equal(res.json.intent.revision, live.draft.current_revision);
    assert.equal(res.json.intent.contract_hash, live.draft.contract_hash);
    assert.equal(res.json.intent.snapshot_hash, sha256Hex(live.approval.snapshot));
    assert.equal(Number(res.json.intent.requested_by), Number(ownerA.id));
    assert.doesNotMatch(res.text, FORBIDDEN_SURFACE);
    assert.doesNotMatch(JSON.stringify(res.json), /CONFIRM INTERNAL PUBLISHING REQUEST/);

    const row = (await p().query(
      `SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, res.json.intent.id]
    )).rows[0];
    assert.equal(row.status, 'pending');
    assert.match(row.intent_hash, /^[0-9a-f]{64}$/);
    assert.equal(row.outbox_id, res.json.intent.outbox_id);

    const outbox = (await p().query(
      `SELECT * FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, row.outbox_id]
    )).rows[0];
    assert.ok(outbox);
    assert.equal(outbox.state, 'pending');
    assert.equal(outbox.destination, 'internal');
    assert.equal(outbox.operation, 'create_provider_draft');
    assert.match(outbox.idempotency_key, /^cdv1:[0-9a-f]{64}$/);
    assert.doesNotMatch(outbox.idempotency_key, /^ik-/);
    assert.deepStrictEqual(Object.keys(outbox.payload).sort(), ['credential_ref', 'operation', 'workflow_id']);
    assert.equal(outbox.payload.credential_ref, 'user_integrations');
    assert.equal(outbox.credential_ref, 'user_integrations');

    const extraOutbox = (await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_outbox
        WHERE tenant_id=$1 AND workflow_id=$2 AND operation='create_provider_draft'`,
      [tenantA.id, wfA]
    )).rows[0].n;
    assert.equal(extraOutbox, 1);

    const draft = await api('GET', `/${live.draft.id}`, { cookie: cookieA });
    assert.equal(draft.status, 200, draft.text);
    assert.equal(draft.json.draft.status, 'approved_for_publish');
    assert.equal(draft.json.draft.published, false);

    const req = (await p().query(
      `SELECT status FROM ${REQ_TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, live.request.id]
    )).rows[0];
    assert.equal(req.status, 'requested');

    const audit = (await p().query(
      `SELECT event, actor_user_id, detail FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND workflow_id=$2 AND event='campaign_delivery_requested'
        ORDER BY id DESC LIMIT 1`,
      [tenantA.id, wfA]
    )).rows[0];
    assert.ok(audit);
    assert.equal(Number(audit.actor_user_id), Number(ownerA.id));
    assert.equal(audit.detail.from, 'none');
    assert.equal(audit.detail.to, 'pending');
    assert.equal(audit.detail.state, 'pending');
    assert.equal(audit.detail.gate, 'campaign_publishing');
    assert.equal(audit.detail.intent_id, res.json.intent.id);
    assert.equal(audit.detail.request_id, live.request.id);
    assert.equal(audit.detail.outbox_id, row.outbox_id);
    assert.doesNotMatch(JSON.stringify(audit.detail), /CONFIRM INTERNAL PUBLISHING REQUEST/);
    assert.doesNotMatch(JSON.stringify(audit.detail), FORBIDDEN_SURFACE);
    assert.doesNotMatch(JSON.stringify(audit.detail), /^ik-/);
  });

  test('strict body allowlist rejects unknown, identity, secret, and provider fields', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const cases = [
      ['wrong version', { body: { contract_version: 'campaign_delivery_v2' } }],
      ['wrong operation', { body: { operation: 'activate_campaign' } }],
      ['unknown platform', { platform: 'linkedin' }],
      ['platforms array', { omit: ['platform'], body: { platforms: ['meta'] } }],
      ['credential_ref', { body: { credential_ref: 'user_integrations' } }],
      ['access_token', { body: { access_token: 'tok' } }],
      ['provider id', { body: { provider_campaign_id: 'act_1' } }],
      ['approval identity', { body: { approval_id: live.approval.id } }],
      ['snapshot', { body: { snapshot_hash: sha256Hex(live.approval.snapshot) } }],
    ];
    for (const [label, extra] of cases) {
      const res = await createIntent(cookieA, live.draft, live.request, extra);
      assert.equal(res.status, 400, `${label}: ${res.text}`);
      assert.equal(res.json.error, 'validation_failed', label);
      assert.notEqual(res.json.ok, true, label);
      assert.notEqual(res.json.replay, true, label);
    }
    const missing = await api('POST', `/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents`, {
      cookie: cookieA, body: { idempotency_key: ik('missing') },
    });
    assert.equal(missing.status, 400, missing.text);
    assert.equal(missing.json.error, 'validation_failed');
  });

  test('platform must exist on the authoritative approved revision', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const res = await createIntent(cookieA, live.draft, live.request, { platform: 'google' });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.error, 'validation_failed');
    const count = (await p().query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND publishing_request_id=$2`,
      [tenantA.id, live.request.id]
    )).rows[0].n;
    assert.equal(count, 0);
  });

  test('human session required; API key and unauthenticated callers are rejected', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const body = intentBody();
    const unauth = await api('POST', `/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents`, { body });
    assert.equal(unauth.status, 401, unauth.text);
    assert.ok(unauth.json.error === 'auth_required' || unauth.json.error === 'unauthorized');
    const keyed = await api('POST', `/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents`, {
      apiKey: true, body,
    });
    assert.equal(keyed.status, 403, keyed.text);
    assert.equal(keyed.json.error, 'permission_denied');
  });

  test('permission gate rejects a marketer without campaign_publishing', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const marketer = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'marketer' });
    const cookieM = (await login(app.baseUrl, marketer.email, marketer.password)).cookie;
    const res = await createIntent(cookieM, live.draft, live.request);
    assert.equal(res.status, 403, res.text);
    assert.ok(['forbidden', 'permission_denied', 'owner_only'].includes(res.json.error), res.text);
  });

  test('tenant isolation hides the draft and request as not_found', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const res = await createIntent(cookieB, live.draft, live.request);
    assert.equal(res.status, 404, res.text);
    assert.equal(res.json.error, 'not_found');
    const count = (await p().query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND publishing_request_id=$2`,
      [tenantB.id, live.request.id]
    )).rows[0].n;
    assert.equal(count, 0);
  });

  test('cross-draft publishing request is not_found', async () => {
    const liveA = await readyRequested(cookieA, wfA, artA);
    const liveB = await readyRequested(cookieA, wfA, artA);
    const res = await createIntent(cookieA, liveA.draft, liveB.request);
    assert.equal(res.status, 404, res.text);
    assert.equal(res.json.error, 'not_found');
  });

  test('actor must match the bound approval snapshot actor and requester', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const other = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    await seedCreds(other.id);
    const cookieO = (await login(app.baseUrl, other.email, other.password)).cookie;
    const res = await createIntent(cookieO, live.draft, live.request);
    assert.equal(res.status, 403, res.text);
    assert.ok(['permission_denied', 'forbidden'].includes(res.json.error), res.text);
  });

  test('missing, revoked, expired, and stale approvals fail closed', async () => {
    const created = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, created.id);
    const notApproved = await api('POST', `/${ready.id}/publishing-requests/cpr_none/delivery-intents`, {
      cookie: cookieA, body: intentBody(),
    });
    assert.ok(notApproved.status >= 400, notApproved.text);
    assert.ok(['approval_required', 'approval_stale', 'not_found'].includes(notApproved.json.error), notApproved.text);

    const live = await readyRequested(cookieA, wfA, artA);
    await api('POST', `/${live.draft.id}/revoke`, {
      cookie: cookieA, body: { reason: 'Withdraw publishing consent before delivery intent' },
    });
    const revoked = await createIntent(cookieA, live.draft, live.request);
    assert.equal(revoked.status, 409, revoked.text);
    assert.ok(['approval_required', 'approval_revoked'].includes(revoked.json.error), revoked.text);

    const exp = await readyRequested(cookieA, wfA, artA);
    await p().query(`ALTER TABLE orchestrator_campaign_drafts DISABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_drafts SET approval_expires_at=now() - interval '1 hour' WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, exp.draft.id]
      );
    } finally {
      await p().query(`ALTER TABLE orchestrator_campaign_drafts ENABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    }
    const expired = await createIntent(cookieA, exp.draft, exp.request);
    assert.equal(expired.status, 409, expired.text);
    assert.equal(expired.json.error, 'approval_expired');

    const stale = await readyRequested(cookieA, wfA, artA);
    const edited = await api('PATCH', `/${stale.draft.id}`, {
      cookie: cookieA, body: { contract: validContract(wfA, artA, { objective: 'sales' }) },
    });
    assert.equal(edited.status, 200, edited.text);
    const afterEdit = await createIntent(cookieA, stale.draft, stale.request);
    assert.equal(afterEdit.status, 409, afterEdit.text);
    assert.ok(['approval_required', 'approval_stale'].includes(afterEdit.json.error), afterEdit.text);
  });

  test('tampered authoritative snapshot cannot create an intent', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const orig = (await p().query(
      `SELECT snapshot_json FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, live.approval.id]
    )).rows[0].snapshot_json;
    const snap = JSON.parse(JSON.stringify(orig));
    snap.objective = 'sales';
    await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals DISABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, live.approval.id, JSON.stringify(snap)]
      );
      const res = await createIntent(cookieA, live.draft, live.request);
      assert.ok(res.status >= 400, res.text);
      assert.notEqual(res.json.ok, true);
      assert.notEqual(res.json.replay, true);
    } finally {
      await p().query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, live.approval.id, JSON.stringify(orig)]
      );
      await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals ENABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    }
  });

  test('credential ownership is re-checked; removal fails closed including replay', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    await p().query(`UPDATE user_integrations SET status='disconnected' WHERE user_id=$1 AND platform='meta_ads'`, [ownerA.id]);
    try {
      const res = await createIntent(cookieA, live.draft, live.request);
      assert.ok(res.status >= 400 && res.status < 500, res.text);
      assert.equal(res.json.error, 'validation_failed');
      assert.ok((res.json.errors || []).some((e) => e.code === 'missing_credentials'), res.text);
    } finally {
      await p().query(`UPDATE user_integrations SET status='connected' WHERE user_id=$1 AND platform='meta_ads'`, [ownerA.id]);
    }
    const key = ik('cred-ok');
    const ok = await createIntent(cookieA, live.draft, live.request, { idempotency_key: key });
    assert.equal(ok.status, 200, ok.text);
    await clearCreds(ownerA.id);
    try {
      const replay = await createIntent(cookieA, live.draft, live.request, { idempotency_key: key });
      const keyed = await createIntent(cookieA, live.draft, live.request, { idempotency_key: ik('after-clear') });
      for (const res of [replay, keyed]) {
        assert.ok(res.status >= 400, res.text);
        assert.notEqual(res.json.replay, true);
        assert.ok(['validation_failed', 'missing_credentials'].includes(res.json.error), res.text);
      }
    } finally {
      await seedCreds(ownerA.id);
    }
  });

  test('active membership is re-checked; actor removal fails closed', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const first = await createIntent(cookieA, live.draft, live.request);
    assert.equal(first.status, 200, first.text);
    await p().query(
      `UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2`,
      [tenantA.id, ownerA.id]
    );
    try {
      const replay = await createIntent(cookieA, live.draft, live.request, {
        idempotency_key: (await p().query(
          `SELECT idempotency_key FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
          [tenantA.id, first.json.intent.id]
        )).rows[0].idempotency_key,
      });
      assert.ok(replay.status >= 400, replay.text);
      assert.notEqual(replay.json.replay, true);
      assert.ok(['permission_denied', 'forbidden', 'auth_required', 'validation_failed'].includes(replay.json.error), replay.text);
    } finally {
      await p().query(
        `UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2`,
        [tenantA.id, ownerA.id]
      );
    }
  });

  test('same key replays after reauth; different content conflicts', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const key = ik('same');
    const first = await createIntent(cookieA, live.draft, live.request, { idempotency_key: key });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.replay, false);
    const replay = await createIntent(cookieA, live.draft, live.request, { idempotency_key: key });
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.json.replay, true);
    assert.equal(replay.json.intent.id, first.json.intent.id);
    assertHonest(replay.json);
    const outboxes = (await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_outbox
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, first.json.intent.outbox_id]
    )).rows[0].n;
    assert.equal(outboxes, 1);

    const conflict = await createIntent(cookieA, live.draft, live.request, {
      idempotency_key: key, platform: 'google',
    });
    assert.equal(conflict.status, 409, conflict.text);
    assert.equal(conflict.json.error, 'idempotency_conflict');

    const other = await readyRequested(cookieA, wfA, artA);
    const crossReq = await createIntent(cookieA, other.draft, other.request, { idempotency_key: key });
    assert.equal(crossReq.status, 409, crossReq.text);
    assert.equal(crossReq.json.error, 'idempotency_conflict');
  });

  test('same request with different keys converges or bounded-conflicts to one intent', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const a = await createIntent(cookieA, live.draft, live.request, { idempotency_key: ik('snap-a') });
    const b = await createIntent(cookieA, live.draft, live.request, { idempotency_key: ik('snap-b') });
    assert.ok([200, 409].includes(a.status), a.text);
    assert.ok([200, 409].includes(b.status), b.text);
    const accepted = [a, b].filter((res) => res.status === 200);
    assert.ok(accepted.length >= 1);
    if (accepted.length === 2) {
      assert.equal(accepted[0].json.intent.id, accepted[1].json.intent.id);
      assert.ok(accepted.some((res) => res.json.replay === true));
    } else {
      assert.equal([a, b].find((res) => res.status === 409).json.error, 'idempotency_conflict');
    }
    const rows = (await p().query(
      `SELECT id FROM ${TABLE} WHERE tenant_id=$1 AND publishing_request_id=$2`,
      [tenantA.id, live.request.id]
    )).rows;
    assert.equal(rows.length, 1);
    const boxes = (await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_outbox
        WHERE tenant_id=$1 AND operation='create_provider_draft'
          AND id IN (SELECT outbox_id FROM ${TABLE} WHERE tenant_id=$1 AND publishing_request_id=$2)`,
      [tenantA.id, live.request.id]
    )).rows[0].n;
    assert.equal(boxes, 1);
  });

  test('replay after revocation, expiry, edit, credential removal, or snapshot invalidation fails closed', async () => {
    async function setup() {
      const live = await readyRequested(cookieA, wfA, artA);
      const key = ik('inv');
      const first = await createIntent(cookieA, live.draft, live.request, { idempotency_key: key });
      assert.equal(first.status, 200, first.text);
      return { live, key, first };
    }

    const revoked = await setup();
    await api('POST', `/${revoked.live.draft.id}/revoke`, {
      cookie: cookieA, body: { reason: 'Revoke after the delivery intent exists' },
    });
    const afterRevoke = await createIntent(cookieA, revoked.live.draft, revoked.live.request, {
      idempotency_key: revoked.key,
    });
    assert.ok(afterRevoke.status >= 400, afterRevoke.text);
    assert.notEqual(afterRevoke.json.replay, true);
    assert.ok(['approval_required', 'approval_revoked'].includes(afterRevoke.json.error), afterRevoke.text);

    const exp = await setup();
    await p().query(`ALTER TABLE orchestrator_campaign_drafts DISABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_drafts SET approval_expires_at=now() - interval '1 hour' WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, exp.live.draft.id]
      );
    } finally {
      await p().query(`ALTER TABLE orchestrator_campaign_drafts ENABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    }
    const afterExp = await createIntent(cookieA, exp.live.draft, exp.live.request, { idempotency_key: exp.key });
    assert.equal(afterExp.status, 409, afterExp.text);
    assert.equal(afterExp.json.error, 'approval_expired');
    assert.notEqual(afterExp.json.replay, true);

    const edited = await setup();
    const patch = await api('PATCH', `/${edited.live.draft.id}`, {
      cookie: cookieA, body: { contract: validContract(wfA, artA, { objective: 'leads' }) },
    });
    assert.equal(patch.status, 200, patch.text);
    const afterEdit = await createIntent(cookieA, edited.live.draft, edited.live.request, {
      idempotency_key: edited.key,
    });
    assert.ok(afterEdit.status >= 400, afterEdit.text);
    assert.notEqual(afterEdit.json.replay, true);

    const creds = await setup();
    await clearCreds(ownerA.id);
    try {
      const afterCreds = await createIntent(cookieA, creds.live.draft, creds.live.request, {
        idempotency_key: creds.key,
      });
      assert.ok(afterCreds.status >= 400, afterCreds.text);
      assert.notEqual(afterCreds.json.replay, true);
    } finally {
      await seedCreds(ownerA.id);
    }

    const tamper = await setup();
    await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals DISABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    try {
      const row = (await p().query(
        `SELECT snapshot_json FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, tamper.live.approval.id]
      )).rows[0].snapshot_json;
      const snap = JSON.parse(JSON.stringify(row));
      snap.objective = 'leads';
      await p().query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, tamper.live.approval.id, JSON.stringify(snap)]
      );
      const afterTamper = await createIntent(cookieA, tamper.live.draft, tamper.live.request, {
        idempotency_key: tamper.key,
      });
      assert.ok(afterTamper.status >= 400, afterTamper.text);
      assert.notEqual(afterTamper.json.replay, true);
    } finally {
      await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals ENABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    }
  });

  test('same-request concurrency creates one intent and one pending outbox', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const responses = await Promise.all([
      createIntent(cookieA, live.draft, live.request, { idempotency_key: ik('par-a') }),
      createIntent(cookieA, live.draft, live.request, { idempotency_key: ik('par-b') }),
    ]);
    assert.ok(responses.every((res) => [200, 409].includes(res.status)), responses.map((r) => r.text).join('\n'));
    const accepted = responses.filter((res) => res.status === 200);
    assert.ok(accepted.length >= 1 && accepted.length <= 2);
    assert.equal(new Set(accepted.map((res) => res.json.intent.id)).size, 1);
    for (const res of accepted) assertHonest(res.json);
    for (const res of responses.filter((item) => item.status === 409)) {
      assert.equal(res.json.error, 'idempotency_conflict');
    }
    const rows = (await p().query(
      `SELECT id, status, outbox_id FROM ${TABLE} WHERE tenant_id=$1 AND publishing_request_id=$2`,
      [tenantA.id, live.request.id]
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
    const boxes = (await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, rows[0].outbox_id]
    )).rows[0].n;
    assert.equal(boxes, 1);
    const draft = await api('GET', `/${live.draft.id}`, { cookie: cookieA });
    assert.equal(draft.json.draft.status, 'approved_for_publish');
  });

  test('concurrent revoke, edit, and credential removal stay fail-closed', async () => {
    const liveRevoke = await readyRequested(cookieA, wfA, artA);
    const [reqRevoke, revoke] = await Promise.all([
      createIntent(cookieA, liveRevoke.draft, liveRevoke.request, { idempotency_key: ik('c-rev') }),
      api('POST', `/${liveRevoke.draft.id}/revoke`, {
        cookie: cookieA, body: { reason: 'Concurrent revocation of the publishing approval' },
      }),
    ]);
    assert.equal(revoke.status, 200, revoke.text);
    assert.ok([200, 409].includes(reqRevoke.status), reqRevoke.text);
    if (reqRevoke.status === 200) assertHonest(reqRevoke.json);
    else assert.ok(['approval_required', 'approval_revoked'].includes(reqRevoke.json.error), reqRevoke.text);
    const afterRevoke = await api('GET', `/${liveRevoke.draft.id}`, { cookie: cookieA });
    assert.notEqual(afterRevoke.json.draft.status, 'publishing');
    assert.notEqual(afterRevoke.json.draft.status, 'published');

    const liveEdit = await readyRequested(cookieA, wfA, artA);
    const [reqEdit, edit] = await Promise.all([
      createIntent(cookieA, liveEdit.draft, liveEdit.request, { idempotency_key: ik('c-edit') }),
      api('PATCH', `/${liveEdit.draft.id}`, {
        cookie: cookieA, body: { contract: validContract(wfA, artA, { objective: 'sales' }) },
      }),
    ]);
    assert.equal(edit.status, 200, edit.text);
    assert.ok([200, 409].includes(reqEdit.status), reqEdit.text);
    if (reqEdit.status === 200) assertHonest(reqEdit.json);
    const afterEdit = await api('GET', `/${liveEdit.draft.id}`, { cookie: cookieA });
    assert.notEqual(afterEdit.json.draft.status, 'publishing');

    const liveCred = await readyRequested(cookieA, wfA, artA);
    const [reqCred, creds] = await Promise.all([
      createIntent(cookieA, liveCred.draft, liveCred.request, { idempotency_key: ik('c-cred') }),
      p().query(`DELETE FROM user_integrations WHERE user_id=$1`, [ownerA.id]),
    ]);
    const remaining = (await p().query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND publishing_request_id=$2`,
      [tenantA.id, liveCred.draft ? liveCred.request.id : null]
    )).rows[0].n;
    if (reqCred.status === 200) {
      assertHonest(reqCred.json);
      assert.equal(remaining, 1);
    } else {
      assert.ok(creds.rowCount >= 1, 'losing request must observe a completed credential delete');
      assert.notEqual(reqCred.json.replay, true);
      assert.ok(['validation_failed', 'missing_credentials'].includes(reqCred.json.error), reqCred.text);
      assert.equal(remaining, 0);
    }
    await seedCreds(ownerA.id);
  });

  test('publish-request FOR UPDATE holds through commit', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const holder = await p().connect();
    try {
      await holder.query('BEGIN');
      const locked = await holder.query(
        `SELECT id FROM ${REQ_TABLE} WHERE tenant_id=$1 AND draft_id=$2 AND id=$3 FOR UPDATE`,
        [tenantA.id, live.draft.id, live.request.id]
      );
      assert.equal(locked.rowCount, 1);
      const waiter = await p().connect();
      try {
        await waiter.query('BEGIN');
        await waiter.query(`SET LOCAL lock_timeout = '400ms'`);
        await assert.rejects(
          () => waiter.query(
            `SELECT id FROM ${REQ_TABLE} WHERE tenant_id=$1 AND draft_id=$2 AND id=$3 FOR UPDATE`,
            [tenantA.id, live.draft.id, live.request.id]
          ),
          /lock timeout|canceling statement/i
        );
        await waiter.query('ROLLBACK');
      } finally {
        waiter.release();
      }
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }
    const ok = await createIntent(cookieA, live.draft, live.request);
    assert.equal(ok.status, 200, ok.text);
  });

  test('inserted intent is immutable and does not advance the draft or request', async () => {
    const live = await readyRequested(cookieA, wfA, artA);
    const res = await createIntent(cookieA, live.draft, live.request);
    assert.equal(res.status, 200, res.text);
    const id = res.json.intent.id;
    await assert.rejects(
      () => p().query(`UPDATE ${TABLE} SET status='pending' WHERE tenant_id=$1 AND id=$2`, [tenantA.id, id]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    await assert.rejects(
      () => p().query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA.id, id]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    const still = (await p().query(`SELECT status FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA.id, id])).rows[0];
    assert.equal(still.status, 'pending');
    const draft = await api('GET', `/${live.draft.id}`, { cookie: cookieA });
    assert.equal(draft.json.draft.status, 'approved_for_publish');
    assert.equal(draft.json.draft.published, false);
    const req = (await p().query(`SELECT status FROM ${REQ_TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA.id, live.request.id])).rows[0];
    assert.equal(req.status, 'requested');
  });

  test('secret material is never disclosed in responses, outbox, or audit', async () => {
    const marker = `sekrit-token-${crypto.randomBytes(8).toString('hex')}`;
    try {
      await p().query(
        `UPDATE user_integrations SET ciphertext=$3, iv=$3, tag=$3 WHERE user_id=$1 AND platform=$2`,
        [ownerA.id, 'meta_ads', Buffer.from(marker)]
      );
      const live = await readyRequested(cookieA, wfA, artA);
      const res = await createIntent(cookieA, live.draft, live.request, {
        body: { extra_client_field: 'arbitrary-client-content' },
      });
      assert.equal(res.status, 400, res.text);
      const ok = await createIntent(cookieA, live.draft, live.request);
      assert.equal(ok.status, 200, ok.text);
      assertNoSecrets(ok.text, marker);
      assert.doesNotMatch(ok.text, /arbitrary-client-content/);
      const audit = (await p().query(
        `SELECT detail::text AS detail FROM orchestrator_audit_events WHERE tenant_id=$1 AND workflow_id=$2`,
        [tenantA.id, wfA]
      )).rows.map((r) => r.detail).join('\n');
      assertNoSecrets(audit, marker);
      const stored = (await p().query(
        `SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, ok.json.intent.id]
      )).rows[0];
      assertNoSecrets(JSON.stringify(stored), marker);
      const box = (await p().query(
        `SELECT * FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, stored.outbox_id]
      )).rows[0];
      assertNoSecrets(JSON.stringify(box), marker);
    } finally {
      await clearCreds(ownerA.id);
      await seedCreds(ownerA.id);
    }
  });
}
