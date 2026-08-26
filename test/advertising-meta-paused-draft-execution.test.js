'use strict';
// PR 6F-1 — bounded Meta paused-draft execution using the PR 6F-0 capability fence.

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.INFOGENIE_API_KEY = process.env.INFOGENIE_API_KEY || '<set-via-environment>';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const dnsPromises = require('node:dns').promises;

const db = require('../db');
const vault = require('../services/credentials/vault');
const D = require('../services/agent_orchestrator/campaign_delivery_contracts');
const draftExecution = require('../services/agent_orchestrator/campaign_provider_draft_execution');
const { insertStartedAttempt } = require('../services/agent_orchestrator/campaign_delivery_attempts');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { CONFIRM_PHRASE: PUBLISH_PHRASE } = require('../services/agent_orchestrator/campaign_publish_requests');
const { sha256Hex } = require('../services/agent_orchestrator/hash');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');
const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');

const HAS_DB = hasDb();
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const HEX = () => crypto.randomBytes(32).toString('hex');
const FORBIDDEN = /access_token|refresh_token|vault_payload|phrase_digest|phrase_salt|claim_token|account_fingerprint|ad_account_id/i;

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
installCampaignDraftDnsStub();
after(() => { dnsPromises.lookup = _origDnsLookup; });

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

function assertNoSecrets(text, label) {
  assert.doesNotMatch(String(text || ''), FORBIDDEN, label || 'leaked secret surface');
}

function successInject() {
  let seq = 0;
  const kinds = ['campaign', 'adset', 'creative', 'ad'];
  return {
    create: async (kind) => {
      seq += 1;
      assert.equal(kind, kinds[seq - 1]);
      return { status: 200, body: { id: `meta_${kind}_${seq}` } };
    },
  };
}

function partialInject() {
  let calls = 0;
  return {
    create: async (kind) => {
      calls += 1;
      if (calls === 3) return { status: 400, body: { error: { code: 100 } } };
      return { status: 200, body: { id: `${kind}_${calls}` } };
    },
  };
}

function transportThrowAfterPartialInject() {
  let calls = 0;
  return {
    create: async (kind) => {
      calls += 1;
      if (calls === 3) throw new Error('ECONNRESET transport');
      return { status: 200, body: { id: `${kind}_${calls}` } };
    },
  };
}

function forgedCapability() {
  const cap = Object.create(null);
  Object.defineProperty(cap, Symbol.for('infogenie.advertising_provider_capability'), {
    value: true, enumerable: false, writable: false, configurable: false,
  });
  cap.platform = 'meta';
  cap.operation = 'create_provider_draft';
  return cap;
}

if (!HAS_DB) {
  test('advertising meta paused draft execution skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, marketerA, cookieA, cookieB, cookieMarketer;
  let artA, wfA, wfB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const api = (method, path, opts) => request(app.baseUrl, method, `/api/agent-orchestrator/campaign-drafts${path}`, opts);

  async function seedWf(tenantId) {
    const wfId = nid('wf');
    await p().query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,'PR6F1')`, [wfId, tenantId]);
    return wfId;
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
  async function createOk(cookie, wfId, art, extra = {}) {
    const res = await api('POST', '', {
      cookie,
      body: {
        workflow_id: wfId, idempotency_key: extra.idempotency_key || ik('c'),
        contract: validContract(wfId, art, extra.contract), ...extra.body,
      },
    });
    assert.equal(res.status, 201, res.text);
    return res.json.draft;
  }
  async function validateOk(cookie, id) {
    const res = await api('POST', `/${id}/validate`, { cookie, body: {} });
    assert.equal(res.status, 200, res.text);
    return res.json.draft;
  }
  async function approveOk(cookie, draft) {
    const c = draft.contract;
    const res = await api('POST', `/${draft.id}/approve`, {
      cookie,
      body: {
        revision: draft.current_revision, contract_hash: draft.contract_hash, platforms: c.platforms,
        accounts: c.accounts.map((a) => a.credential_ref),
        creatives: c.creatives.map((x) => ({ asset_id: x.asset_id, version: x.version })),
        budget: { amount_micros: c.budget.amount_micros, currency: c.budget.currency },
        schedule: c.schedule, targeting: { geo: c.geo }, landing_page_url: c.destination.landing_page_url,
        idempotency_key: ik('ap'),
      },
    });
    assert.equal(res.status, 200, res.text);
    return { draft: res.json.draft, approval: res.json.approval };
  }
  async function readyApproved(cookie, wfId, art) {
    const created = await createOk(cookie, wfId, art);
    const ready = await validateOk(cookie, created.id);
    return approveOk(cookie, ready);
  }
  async function seedMetaCred(tenantId, userId, fingerprint) {
    const id = nid('mcr');
    await p().query(
      `INSERT INTO orchestrator_tenant_meta_credential_refs
         (id, tenant_id, platform, environment, status, account_fingerprint, version, owner_user_id)
       VALUES ($1,$2,'meta','sandbox','active',$3,1,$4)`,
      [id, tenantId, fingerprint, userId]
    );
    return id;
  }
  async function seedAttempt(live) {
    const row = (await p().query(
      `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, live.intent.id]
    )).rows[0];
    const client = await p().connect();
    try {
      await client.query('BEGIN');
      const attempt = await insertStartedAttempt(client, {
        tenantId: row.tenant_id,
        intentId: row.id,
        outboxId: row.outbox_id,
        draftId: row.draft_id,
        publishingRequestId: row.publishing_request_id,
        attemptNumber: 1,
        generation: 1,
        leaseHolder: 'exec-test',
        leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        platform: 'meta',
        intentHash: row.intent_hash,
      });
      await client.query('COMMIT');
      return attempt;
    } finally {
      client.release();
    }
  }
  async function readyConfirmed(cookie, wfId, art) {
    const live = await readyApproved(cookie, wfId, art);
    const pub = await api('POST', `/${live.draft.id}/publishing-requests`, {
      cookie,
      body: {
        confirmation: PUBLISH_PHRASE,
        approval_id: live.approval.id,
        revision: live.draft.current_revision,
        contract_hash: live.draft.contract_hash,
        snapshot_hash: sha256Hex(live.approval.snapshot),
        idempotency_key: ik('pr'),
      },
    });
    assert.equal(pub.status, 200, pub.text);
    const intent = await api('POST', `/${live.draft.id}/publishing-requests/${pub.json.request.id}/delivery-intents`, {
      cookie,
      body: {
        contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
        platform: 'meta', idempotency_key: ik('di'),
      },
    });
    assert.equal(intent.status, 200, intent.text);
    const bundle = {
      draft: live.draft,
      approval: live.approval,
      request: pub.json.request,
      intent: intent.json.intent,
    };
    const attempt = await seedAttempt(bundle);
    const chal = await api('POST',
      `/provider-draft-confirmation-challenge/${bundle.draft.id}/publishing-requests/${bundle.request.id}/delivery-intents/${bundle.intent.id}`,
      { cookie, body: { contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: ik('ch') } }
    );
    assert.equal(chal.status, 200, chal.text);
    const confirm = await api('POST',
      `/confirm-provider-draft/${bundle.draft.id}/publishing-requests/${bundle.request.id}/delivery-intents/${bundle.intent.id}`,
      {
        cookie,
        body: {
          contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
          idempotency_key: ik('cf'), confirmation_challenge_id: chal.json.challenge.id,
          confirmation_phrase: D.CONFIRM_PHRASE,
        },
      }
    );
    assert.equal(confirm.status, 202, confirm.text);
    return { ...bundle, attempt, confirmation: confirm.json.confirmation };
  }
  function execPath(live) {
    return `/execute-provider-draft/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents/${live.intent.id}`;
  }
  async function executeModule(live, key, inject) {
    return draftExecution.executeProviderDraft(p(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      draftId: live.draft.id,
      publishingRequestId: live.request.id,
      intentId: live.intent.id,
      idempotencyKey: key,
      body: {
        contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
        idempotency_key: key, confirmation_id: live.confirmation.id,
      },
      inject,
    });
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR6F1 A');
    tenantB = await fx.seedTenant('PR6F1 B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    marketerA = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'marketer' });
    await vault.saveCredentials(ownerA.id, 'meta_ads', {
      accessToken: `test-token-${ownerA.id}`,
      adAccountId: 'act_123456789',
    });
    wfA = await seedWf(tenantA.id);
    wfB = await seedWf(tenantB.id);
    artA = await seedBrief(tenantA.id, ownerA.id, wfA);
    await seedMetaCred(tenantA.id, ownerA.id, vault.accountFingerprintOfMetaAdAccount('act_123456789'));
    app = await bootApp();
    cookieA = (await login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
    cookieB = (await login(app.baseUrl, ownerB.email, ownerB.password)).cookie;
    cookieMarketer = (await login(app.baseUrl, marketerA.email, marketerA.password)).cookie;
  });

  after(async () => {
    if (app && app.close) await app.close();
    const ids = [tenantA && tenantA.id, tenantB && tenantB.id].filter(Boolean);
    if (ids.length) await p().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    await fx.cleanup();
  });

  test('success: four PAUSED objects, honest outcome, zero activation/delivery', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    const res = await executeModule(live, ik('ok'), successInject());
    assert.equal(res.replay, false);
    assert.equal(res.row.status, 'complete');
    assert.equal(res.row.published, false);
    assert.equal(res.row.external_action_taken, true);
    assert.equal(res.objects.length, 4);
    for (const obj of res.objects) assert.equal(obj.provider_status, 'PAUSED');
    const attempt = (await p().query(
      `SELECT status, connector, simulated, published, external_action_taken
         FROM orchestrator_campaign_delivery_attempts WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, live.attempt.id]
    )).rows[0];
    assert.equal(attempt.status, 'provider_draft_complete');
    assert.equal(attempt.connector, 'meta');
    assert.equal(attempt.simulated, false);
    assert.equal(attempt.published, false);
    assertNoSecrets(JSON.stringify(draftExecution.publicExecution(res.row, res.objects)));
  });

  test('HTTP execute route idempotent replay with sanitized body', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    const key = ik('http');
    const first = await executeModule(live, key, successInject());
    const http = await api('POST', execPath(live), {
      cookie: cookieA,
      body: {
        contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
        idempotency_key: key, confirmation_id: live.confirmation.id,
      },
    });
    assert.equal(http.status, 200, http.text);
    assert.equal(http.json.replay, true);
    assert.equal(http.json.published, false);
    assert.equal(http.json.complete, true);
    assert.equal(http.json.execution.id, first.row.id);
    assertNoSecrets(http.text);
  });

  test('tenant isolation and permission gate', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    const body = {
      contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
      idempotency_key: ik('iso'), confirmation_id: live.confirmation.id,
    };
    const cross = await api('POST', execPath(live), { cookie: cookieB, body });
    assert.ok([403, 404, 409].includes(cross.status), cross.text);
    const marketer = await api('POST', execPath(live), { cookie: cookieMarketer, body });
    assert.ok([403, 409].includes(marketer.status), marketer.text);
  });

  test('double-spend refused after first execution', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    await executeModule(live, ik('once'), successInject());
    await assert.rejects(
      () => executeModule(live, ik('twice'), successInject()),
      (err) => err && err.code === 'idempotency_conflict'
    );
  });

  test('partial provider failure settles partial without claiming complete', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    const res = await executeModule(live, ik('partial'), partialInject());
    assert.equal(res.row.status, 'partial');
    assert.equal(res.row.outcome, 'partial');
    assert.equal(res.row.published, false);
    assert.notEqual(res.row.status, 'complete');
  });

  test('transport failure after partial Meta success keeps durable spend and terminal outcome', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    const key = ik('transport-partial');
    const res = await executeModule(live, key, transportThrowAfterPartialInject());
    assert.equal(res.replay, false);
    assert.equal(res.row.status, 'partial');
    assert.equal(res.row.outcome, 'partial');
    assert.equal(res.row.external_action_taken, true);
    assert.equal(res.objects.length, 2);

    const confirmation = (await p().query(
      `SELECT status, spent_at FROM orchestrator_campaign_provider_confirmations
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, live.confirmation.id]
    )).rows[0];
    assert.equal(confirmation.status, 'spent');
    assert.ok(confirmation.spent_at);

    const auditCount = (await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND event=$2 AND detail->>'execution_id'=$3`,
      [tenantA.id, D.AUDIT_EVENT_EXECUTION, res.row.id]
    )).rows[0].n;
    assert.equal(auditCount, 1);

    await assert.rejects(
      () => executeModule(live, ik('second-graph'), successInject()),
      (err) => err && (err.code === 'idempotency_conflict' || err.code === 'invalid_transition')
    );
  });

  test('idempotency replay rejects wrong route graph for same tenant owner', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    const key = ik('route-replay');
    await executeModule(live, key, successInject());

    await assert.rejects(
      () => draftExecution.executeProviderDraft(p(), {
        tenantId: tenantA.id,
        userId: ownerA.id,
        draftId: 'cd_wrong_route',
        publishingRequestId: live.request.id,
        intentId: live.intent.id,
        idempotencyKey: key,
        body: {
          contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
          idempotency_key: key, confirmation_id: live.confirmation.id,
        },
        inject: successInject(),
      }),
      (err) => err && err.code === 'not_found'
    );
  });

  test('forged Symbol.for capability performs zero provider writes at the sink', async () => {
    const metaPausedDraft = require('../services/agent_orchestrator/connectors/meta_paused_draft');
    const guard = require('../services/security/advertising_provider_mutations');
    let writes = 0;
    const inject = {
      create: async () => {
        writes += 1;
        return { status: 200, body: { id: 'forged_should_never_run' } };
      },
    };
    await assert.rejects(
      () => metaPausedDraft.createPausedDraftGraph({
        capability: forgedCapability(),
        credentials: { accessToken: 'tok', adAccountId: 'act_123456789' },
        snapshot: { objective: 'traffic', label: 'Forged' },
        inject,
      }),
      (err) => err && err.code === guard.CODE && err.blocked === true
    );
    assert.equal(writes, 0);
    assert.equal(guard.isAdvertisingProviderMutationAllowed(), false);
  });

  test('already-spent confirmation fails closed on replay with new idempotency key', async () => {
    const live = await readyConfirmed(cookieA, wfA, artA);
    await executeModule(live, ik('spent-a'), successInject());
    await assert.rejects(
      () => executeModule(live, ik('spent-b'), successInject()),
      (err) => err && (err.code === 'idempotency_conflict' || err.code === 'invalid_transition')
    );
  });

  test('PR #99 default-deny remains for generic provider mutation', async () => {
    const guard = require('../services/security/advertising_provider_mutations');
    assert.equal(guard.isAdvertisingProviderMutationAllowed(), false);
  });
}
