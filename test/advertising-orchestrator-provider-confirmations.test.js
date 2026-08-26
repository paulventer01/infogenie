'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.INFOGENIE_API_KEY = process.env.INFOGENIE_API_KEY || '<set-via-environment>';

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
const { CONFIRM_PHRASE: PUBLISH_PHRASE } = require('../services/agent_orchestrator/campaign_publish_requests');
const { sha256Hex } = require('../services/agent_orchestrator/hash');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');
const { requiredPermissionForRequest } = require('../services/tenants/permission_matrix');
const D = require('../services/agent_orchestrator/campaign_delivery_contracts');
const confirmations = require('../services/agent_orchestrator/campaign_provider_confirmations');
const { insertStartedAttempt } = require('../services/agent_orchestrator/campaign_delivery_attempts');
const dnsPromises = require('node:dns').promises;

const HAS_DB = hasDb();
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const HEX = () => crypto.randomBytes(32).toString('hex');
const ROOT = path.join(__dirname, '..');
const SRC_API = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_api.js'), 'utf8');
const SRC_CONTRACTS = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_delivery_contracts.js'), 'utf8');
const SRC_CONF = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_provider_confirmations.js'), 'utf8');
const SRC_MATRIX = fs.readFileSync(path.join(ROOT, 'services/tenants/permission_matrix.js'), 'utf8');
const FORBIDDEN_SURFACE = /credential|vault_payload|access_token|refresh_token|confirmation_phrase|snapshot_json|provider_data|external_campaign|phrase_salt|phrase_digest|claim_token|account_fingerprint|ad_account|page_id|pixel_id/i;
const RESPONSE_FORBIDDEN = /credential|vault_payload|access_token|refresh_token|confirmation_phrase|snapshot_json|provider_data|external_campaign|contract_hash|snapshot_hash|intent_hash|claim_token|phrase_salt|phrase_digest|account_fingerprint|"payload"/i;

const PUBLIC_CHALLENGE_KEYS = Object.freeze([
  'attempt_id', 'contract_version', 'created_at', 'draft_id', 'expires_at', 'id',
  'intent_id', 'object_kind', 'operation', 'publishing_request_id', 'requested_by',
  'status', 'tenant_id',
]);
const PUBLIC_CONFIRM_KEYS = Object.freeze([
  'attempt_id', 'challenge_id', 'contract_version', 'created_at', 'draft_id',
  'expires_at', 'id', 'intent_id', 'object_kind', 'operation', 'publishing_request_id',
  'requested_by', 'status', 'tenant_id',
]);
const PUBLIC_CONFIRM_RESPONSE_KEYS = Object.freeze([
  'confirmation', 'external_action_taken', 'ok', 'published', 'replay',
]);

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

function challengeBody(extra = {}) {
  return {
    contract_version: 'campaign_delivery_v1',
    operation: 'create_provider_draft',
    platform: extra.platform || 'meta',
    idempotency_key: extra.idempotency_key || ik('ch'),
    ...extra.body,
  };
}

function confirmBody(challengeId, extra = {}) {
  return {
    contract_version: 'campaign_delivery_v1',
    operation: 'create_provider_draft',
    platform: extra.platform || 'meta',
    idempotency_key: extra.idempotency_key || ik('cf'),
    confirmation_challenge_id: extra.confirmation_challenge_id || challengeId,
    confirmation_phrase: extra.confirmation_phrase || D.CONFIRM_PHRASE,
    ...extra.body,
  };
}

function assertNoSecrets(text) {
  assert.doesNotMatch(text, /CONFIRM CREATE PROVIDER DRAFT/);
  assert.doesNotMatch(text, /CONFIRM INTERNAL PUBLISHING REQUEST/);
  assert.doesNotMatch(text, FORBIDDEN_SURFACE);
  assert.doesNotMatch(text, RESPONSE_FORBIDDEN);
}

function assertPublicChallenge(json, label) {
  assert.equal(json.ok, true, label);
  assert.ok(json.challenge, label);
  assert.equal(json.challenge.object_kind, D.OBJECT_KIND_CHALLENGE, label);
  assert.equal(json.challenge.status, 'open', label);
  assert.equal(json.challenge.operation, 'create_provider_draft', label);
  assert.deepStrictEqual(Object.keys(json.challenge).sort(), [...PUBLIC_CHALLENGE_KEYS]);
  assert.doesNotMatch(JSON.stringify(json), RESPONSE_FORBIDDEN);
}

function assertPublicConfirm(json, label) {
  assert.equal(json.ok, true, label);
  assert.equal(json.published, false, label);
  assert.equal(json.external_action_taken, false, label);
  assert.ok(json.confirmation, label);
  assert.equal(json.confirmation.object_kind, D.OBJECT_KIND_CONFIRMATION, label);
  assert.equal(json.confirmation.status, 'confirmed', label);
  assert.deepStrictEqual(Object.keys(json).sort(), [...PUBLIC_CONFIRM_RESPONSE_KEYS]);
  assert.deepStrictEqual(Object.keys(json.confirmation).sort(), [...PUBLIC_CONFIRM_KEYS]);
  assert.doesNotMatch(JSON.stringify(json), RESPONSE_FORBIDDEN);
}

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('source: session-human routes, exact permission, no provider/network/vault/worker', () => {
  assert.match(SRC_API, /\/provider-draft-confirmation-challenge\/:draftId\/publishing-requests\/:publishingRequestId\/delivery-intents\/:intentId/);
  assert.match(SRC_API, /\/confirm-provider-draft\/:draftId\/publishing-requests\/:publishingRequestId\/delivery-intents\/:intentId/);
  assert.doesNotMatch(SRC_API, /provider-challenges/);
  assert.doesNotMatch(SRC_API, /:attemptId|:outboxId|:challengeId/);
  assert.doesNotMatch(SRC_API, /req\.params\.attemptId|req\.params\.outboxId/);
  assert.match(SRC_API, /PERMISSION_PROVIDER_DRAFTS_CREATE/);
  assert.match(SRC_API, /rejectApiKey:\s*true/);
  assert.match(SRC_API, /published:\s*false/);
  assert.match(SRC_API, /external_action_taken:\s*false/);
  assert.match(SRC_API, /status:\s*202/);
  assert.doesNotMatch(SRC_API, /fetch\s*\(/);
  assert.doesNotMatch(SRC_API, /connectors\//);
  assert.doesNotMatch(SRC_API, /require\('\.\.\/credentials\/vault'\)/);
  const challengeWrap = SRC_API.slice(
    SRC_API.indexOf("'/provider-draft-confirmation-challenge"),
    SRC_API.indexOf("'/confirm-provider-draft")
  );
  assert.match(challengeWrap, /wrap\(D\.PERMISSION_PROVIDER_DRAFTS_CREATE/);
  assert.doesNotMatch(challengeWrap, /wrap\(PERMS\.view/);

  assert.match(SRC_CONF, /assertActiveMember/);
  assert.match(SRC_CONF, /latestAttemptForOutbox/);
  assert.match(SRC_CONF, /SELECT now\(\) AS now/);
  assert.match(SRC_CONF, /lease_expires_at/);
  assert.match(SRC_CONF, /lease_conflict/);
  assert.match(SRC_CONF, /lockPublishRequest/);
  assert.match(SRC_CONF, /assertPublishAuthorizedOnClient/);
  assert.match(SRC_CONF, /resolveTenantMetaCredentialRefForProviderDraft/);
  assert.match(SRC_CONF, /phrase_digest/);
  assert.match(SRC_CONF, /interval '5 minutes'/);
  assert.match(SRC_CONF, /interval '2 minutes'/);
  assert.match(SRC_CONF, /D\.sanitizeConfirmAuditDetail/);
  assert.doesNotMatch(SRC_CONF, /fetch\s*\(/);
  assert.doesNotMatch(SRC_CONF, /connectors\//);
  assert.doesNotMatch(SRC_CONF, /lockAttempt|lockCredentialRef|CRED_TABLE/);
  assert.doesNotMatch(SRC_CONF, /orchestrator_tenant_meta_credential_refs/);
  assert.doesNotMatch(SRC_CONF, /o\.attemptId|params\.attemptId|:attemptId/);
  assert.doesNotMatch(SRC_CONF, /decrypt|getCredentials|withTenantMetaCredential/);
  assert.doesNotMatch(SRC_CONF, /campaign_delivery_worker/);
  assert.doesNotMatch(SRC_CONF, /setInterval|cron/);
  assert.doesNotMatch(SRC_CONF, /provider_campaign_id|ad_account_id|access_token/);
  assert.doesNotMatch(SRC_CONF, /allowFallback:\s*true/);

  assert.deepStrictEqual([...D.OUTBOX_PAYLOAD_KEYS].sort(), [
    'contract_version', 'credential_ref', 'draft_id', 'intent_id',
    'operation', 'platform', 'publishing_request_id', 'workflow_id',
  ]);
  assert.deepStrictEqual([...D.KEYS], [
    'contract_version', 'operation', 'platform', 'idempotency_key',
  ]);
  assert.deepStrictEqual([...D.CONFIRM_KEYS], [
    'contract_version', 'operation', 'platform', 'idempotency_key',
    'confirmation_challenge_id', 'confirmation_phrase',
  ]);
  assert.equal(D.PERMISSION_PROVIDER_DRAFTS_CREATE, 'advertising.provider_drafts.create');
  assert.equal(D.CHALLENGE_TTL_MS, 5 * 60 * 1000);
  assert.equal(D.CONFIRMATION_TTL_MS, 2 * 60 * 1000);
  assert.equal(D.CONFIRM_PHRASE, 'CONFIRM CREATE PROVIDER DRAFT');
  assert.match(SRC_CONTRACTS, /CONFIRM CREATE PROVIDER DRAFT/);
  assert.doesNotMatch(SRC_CONTRACTS, /OUTBOX_PAYLOAD_KEYS\s*=\s*\[/);
  assert.match(SRC_CONTRACTS, /const OUTBOX_PAYLOAD_KEYS = Object.freeze/);
  assert.doesNotMatch(SRC_CONF, /provider_object_ledger/);
  assert.doesNotMatch(SRC_CONTRACTS, /fetch\s*\(/);

  assert.match(SRC_MATRIX, /\/api\/agent-orchestrator\/campaign-drafts\/provider-draft-confirmation-challenge/);
  assert.match(SRC_MATRIX, /\/api\/agent-orchestrator\/campaign-drafts\/confirm-provider-draft/);
  assert.doesNotMatch(SRC_MATRIX, /\/api\/agent-orchestrator\/campaign-drafts\/provider-challenges/);
  const challengeGroup = requiredPermissionForRequest(
    '/api/agent-orchestrator/campaign-drafts/provider-draft-confirmation-challenge/cd_1/publishing-requests/cpr_1/delivery-intents/cdi_1',
    'POST'
  );
  assert.equal(challengeGroup.matched, true);
  assert.equal(challengeGroup.group.prefix, '/api/agent-orchestrator/campaign-drafts/provider-draft-confirmation-challenge');
  assert.equal(challengeGroup.permission, 'advertising.provider_drafts.create');
  const confirmGroup = requiredPermissionForRequest(
    '/api/agent-orchestrator/campaign-drafts/confirm-provider-draft/cd_1/publishing-requests/cpr_1/delivery-intents/cdi_1',
    'POST'
  );
  assert.equal(confirmGroup.matched, true);
  assert.equal(confirmGroup.group.prefix, '/api/agent-orchestrator/campaign-drafts/confirm-provider-draft');
  assert.equal(confirmGroup.permission, 'advertising.provider_drafts.create');
  const parent = requiredPermissionForRequest(
    '/api/agent-orchestrator/campaign-drafts/cd_1/publishing-requests/cpr_1/delivery-intents',
    'POST'
  );
  assert.equal(parent.group.prefix, '/api/agent-orchestrator/campaign-drafts');
});

test('strict own-key allowlist and recursive dangerous-key rejection', () => {
  const okChallenge = D.parseChallengeBody({
    contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
    platform: 'meta', idempotency_key: 'k1',
  });
  assert.equal(okChallenge.platform, 'meta');
  const okConfirm = D.parseConfirmBody({
    contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
    platform: 'meta', idempotency_key: 'k2',
    confirmation_challenge_id: 'cpc_1', confirmation_phrase: D.CONFIRM_PHRASE,
  });
  assert.equal(okConfirm.confirmation_challenge_id, 'cpc_1');
  assert.equal(okConfirm.confirmation_phrase, D.CONFIRM_PHRASE);

  const bad = [
    [{ contract_version: 'campaign_delivery_v2', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k' }, 'challenge'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'activate', platform: 'meta', idempotency_key: 'k' }, 'challenge'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'google', idempotency_key: 'k' }, 'challenge'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', access_token: 'x' }, 'challenge'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', nested: { access_token: 'x' } }, 'challenge'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', credential_ref: 'user_integrations' }, 'challenge'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', provider_campaign_id: '1' }, 'challenge'],
    [{ contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta', idempotency_key: 'k', confirmation_phrase: D.CONFIRM_PHRASE }, 'challenge'],
    [{
      contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
      idempotency_key: 'k', confirmation_challenge_id: 'cpc_1', confirmation_phrase: D.CONFIRM_PHRASE,
      access_token: 'tok',
    }, 'confirm'],
    [{
      contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
      idempotency_key: 'k', confirmation_challenge_id: 'cpc_1', confirmation_phrase: D.CONFIRM_PHRASE,
      confirmation: { access_token: 'x' },
    }, 'confirm'],
    [{
      contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
      idempotency_key: 'k', confirmation_challenge_id: 'cpc_1',
      confirmation_phrase: { access_token: 'nested' },
    }, 'confirm'],
    [{
      contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
      idempotency_key: 'k', confirmation_challenge_id: 'cpc_1', confirmation_phrase: 'nope',
    }, 'confirm'],
    [{
      contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft', platform: 'meta',
      idempotency_key: 'k', confirmation_challenge_id: 'cpc_1', confirmation_phrase: PUBLISH_PHRASE,
    }, 'confirm'],
    [{
      contract_version: { access_token: 'x' }, operation: 'create_provider_draft', platform: 'meta',
      idempotency_key: 'k', confirmation_challenge_id: 'cpc_1', confirmation_phrase: D.CONFIRM_PHRASE,
    }, 'confirm'],
  ];
  for (const [body, kind] of bad) {
    assert.throws(
      () => (kind === 'confirm' ? D.parseConfirmBody(body) : D.parseChallengeBody(body)),
      (e) => e && e.code === 'validation_failed',
      JSON.stringify(body)
    );
  }
});

test('salted digest is 64-hex and never equals the phrase or salt', () => {
  const salt = D.newPhraseSalt();
  assert.match(salt, /^[0-9a-f]{64}$/);
  const digest = D.phraseDigestOf(salt, D.CONFIRM_PHRASE);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.notEqual(digest, salt);
  assert.notEqual(digest, D.CONFIRM_PHRASE);
  assert.notEqual(digest, sha256Hex(D.CONFIRM_PHRASE));
  const other = D.phraseDigestOf(D.newPhraseSalt(), D.CONFIRM_PHRASE);
  assert.notEqual(digest, other);
  const claim = D.claimTokenHashOf('claimtok-example');
  assert.match(claim, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(D.sanitizeConfirmAuditDetail({
    action: 'confirm', confirmation_phrase: D.CONFIRM_PHRASE, phrase_digest: digest,
    contract_hash: 'a'.repeat(64), access_token: 'tok', payload: { a: 1 },
    challenge_id: 'cpc_1', confirmation_id: 'cpcf_1',
  })), /CONFIRM CREATE PROVIDER DRAFT|phrase_digest|contract_hash|access_token|"payload"/);
});

if (!HAS_DB) {
  test('advertising-orchestrator provider confirmations skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, cookieA, cookieB, artA, wfA, wfB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const api = (method, path, opts) => request(app.baseUrl, method, `/api/agent-orchestrator/campaign-drafts${path}`, opts);

  async function seedWf(tenantId) {
    const wfId = nid('wf');
    await p().query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,'PR6F0')`, [wfId, tenantId]);
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
      confirmation: PUBLISH_PHRASE,
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
  async function readyIntent(cookie, wfId, art) {
    const live = await readyApproved(cookie, wfId, art);
    const pub = await requestPublishing(cookie, live.draft, live.approval);
    assert.equal(pub.status, 200, pub.text);
    const intent = await api('POST', `/${live.draft.id}/publishing-requests/${pub.json.request.id}/delivery-intents`, {
      cookie,
      body: {
        contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
        platform: 'meta', idempotency_key: ik('di'),
      },
    });
    assert.equal(intent.status, 200, intent.text);
    return { ...live, request: pub.json.request, intent: intent.json.intent };
  }
  async function seedMetaCred(tenantId, userId) {
    const id = nid('mcr');
    await p().query(
      `INSERT INTO orchestrator_tenant_meta_credential_refs
         (id, tenant_id, platform, environment, status, account_fingerprint, version, owner_user_id)
       VALUES ($1,$2,'meta','sandbox','active',$3,1,$4)`,
      [id, tenantId, HEX(), userId]
    );
    return id;
  }
  async function seedAttempt(live, extra = {}) {
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
        attemptNumber: extra.attemptNumber || 1,
        generation: extra.generation || extra.attemptNumber || 1,
        leaseHolder: extra.leaseHolder || 'test-lease',
        leaseExpiresAt: extra.leaseExpiresAt || new Date(Date.now() + 5 * 60 * 1000),
        platform: 'meta',
        intentHash: row.intent_hash,
      });
      await client.query('COMMIT');
      return attempt;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }
  function challengePath(live) {
    return `/provider-draft-confirmation-challenge/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents/${live.intent.id}`;
  }
  function confirmPath(live) {
    return `/confirm-provider-draft/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents/${live.intent.id}`;
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR6F0 A');
    tenantB = await fx.seedTenant('PR6F0 B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    await seedCreds(ownerA.id);
    await seedCreds(ownerB.id);
    wfA = await seedWf(tenantA.id);
    wfB = await seedWf(tenantB.id);
    artA = await seedBrief(tenantA.id, ownerA.id, wfA);
    await seedMetaCred(tenantA.id, ownerA.id);
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

  test('challenge mints a short-lived open challenge without authorizing mutation', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const attempt = await seedAttempt(live);
    const res = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.replay, false);
    assertPublicChallenge(res.json);
    assert.equal(res.json.challenge.attempt_id, attempt.id);
    assert.equal(res.json.challenge.draft_id, live.draft.id);
    assertNoSecrets(res.text);
    const stored = (await p().query(
      `SELECT phrase_salt, status, credential_ref_id FROM orchestrator_campaign_provider_challenges
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, res.json.challenge.id]
    )).rows[0];
    assert.equal(stored.status, 'open');
    assert.match(stored.phrase_salt, /^[0-9a-f]{64}$/);
    assert.ok(stored.credential_ref_id);
    const expires = new Date(res.json.challenge.expires_at).getTime();
    const created = new Date(res.json.challenge.created_at).getTime();
    assert.ok(expires - created <= D.CHALLENGE_TTL_MS + 1000);
    assert.ok(expires - created > 0);
  });

  test('final confirm is 202, single-use, salted digest only, and audit-safe', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const attempt = await seedAttempt(live);
    const chal = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    assert.equal(chal.status, 200, chal.text);
    const key = ik('cf-ok');
    const res = await api('POST', confirmPath(live), {
      cookie: cookieA, body: confirmBody(chal.json.challenge.id, { idempotency_key: key }),
    });
    assert.equal(res.status, 202, res.text);
    assert.equal(res.json.replay, false);
    assertPublicConfirm(res.json);
    assert.equal(res.json.confirmation.challenge_id, chal.json.challenge.id);
    assertNoSecrets(res.text);

    const stored = (await p().query(
      `SELECT phrase_digest, phrase_salt, status FROM orchestrator_campaign_provider_confirmations
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, res.json.confirmation.id]
    )).rows[0];
    assert.equal(stored.status, 'confirmed');
    assert.match(stored.phrase_digest, /^[0-9a-f]{64}$/);
    assert.notEqual(stored.phrase_digest, D.CONFIRM_PHRASE);
    const chalRow = (await p().query(
      `SELECT status, consumed_confirmation_id FROM orchestrator_campaign_provider_challenges
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, chal.json.challenge.id]
    )).rows[0];
    assert.equal(chalRow.status, 'consumed');
    assert.equal(chalRow.consumed_confirmation_id, res.json.confirmation.id);

    const audit = (await p().query(
      `SELECT event, detail FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND event=$2 ORDER BY id DESC LIMIT 1`,
      [tenantA.id, D.AUDIT_EVENT_CONFIRMATION]
    )).rows[0];
    assert.ok(audit);
    assert.equal(audit.detail.confirmation_id, res.json.confirmation.id);
    assert.equal(audit.detail.challenge_id, chal.json.challenge.id);
    assert.strictEqual(audit.detail.phrase_digest, undefined);
    assert.strictEqual(audit.detail.contract_hash, undefined);
    assertNoSecrets(JSON.stringify(audit.detail));

    const replay = await api('POST', confirmPath(live), {
      cookie: cookieA, body: confirmBody(chal.json.challenge.id, { idempotency_key: key }),
    });
    assert.equal(replay.status, 202, replay.text);
    assert.equal(replay.json.replay, true);
    assertPublicConfirm(replay.json);
    assert.equal(replay.json.confirmation.id, res.json.confirmation.id);
    assertNoSecrets(replay.text);

    const second = await api('POST', confirmPath(live), {
      cookie: cookieA, body: confirmBody(chal.json.challenge.id, { idempotency_key: ik('other') }),
    });
    assert.equal(second.status, 409, second.text);
    assert.ok(['invalid_transition', 'idempotency_conflict'].includes(second.json.error), second.text);
    assert.notEqual(second.json.ok, true);
  });

  test('human session, API key, and permission gate reject confirm', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const attempt = await seedAttempt(live);
    assert.ok(attempt && attempt.id);
    const chal = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    const body = confirmBody(chal.json.challenge.id);
    const unauth = await api('POST', confirmPath(live), { body });
    assert.equal(unauth.status, 401, unauth.text);
    const keyed = await api('POST', confirmPath(live), { apiKey: true, body });
    assert.equal(keyed.status, 403, keyed.text);
    assert.ok(['permission_denied', 'forbidden'].includes(keyed.json.error), keyed.text);
    const keyedChallenge = await api('POST', challengePath(live), { apiKey: true, body: challengeBody() });
    assert.equal(keyedChallenge.status, 403, keyedChallenge.text);

    const marketer = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'marketer' });
    const cookieM = (await login(app.baseUrl, marketer.email, marketer.password)).cookie;
    const denied = await api('POST', confirmPath(live), { cookie: cookieM, body });
    assert.equal(denied.status, 403, denied.text);
    assert.ok(['forbidden', 'permission_denied', 'owner_only'].includes(denied.json.error), denied.text);
    if (denied.json.required) {
      assert.equal(denied.json.required, 'advertising.provider_drafts.create');
    }
    const deniedChallenge = await api('POST', challengePath(live), { cookie: cookieM, body: challengeBody() });
    assert.equal(deniedChallenge.status, 403, deniedChallenge.text);
    assert.ok(['forbidden', 'permission_denied', 'owner_only'].includes(deniedChallenge.json.error), deniedChallenge.text);
    if (deniedChallenge.json.required) {
      assert.equal(deniedChallenge.json.required, 'advertising.provider_drafts.create');
    }
  });

  test('allowlist and dangerous keys are rejected on both routes', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const attempt = await seedAttempt(live);
    const chalCases = [
      { body: { access_token: 'tok' } },
      { body: { credential_ref: 'user_integrations' } },
      { body: { provider_campaign_id: 'act_1' } },
      { body: { confirmation_phrase: D.CONFIRM_PHRASE } },
      { platform: 'google' },
    ];
    for (const extra of chalCases) {
      const res = await api('POST', challengePath(live), {
        cookie: cookieA, body: challengeBody(extra),
      });
      assert.equal(res.status, 400, res.text);
      assert.equal(res.json.error, 'validation_failed');
    }
    const chal = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    assert.equal(chal.status, 200, chal.text);
    const confCases = [
      confirmBody(chal.json.challenge.id, { body: { access_token: 'tok' } }),
      confirmBody(chal.json.challenge.id, { body: { nested: { refresh_token: 'x' } } }),
      confirmBody(chal.json.challenge.id, { confirmation_phrase: 'please confirm' }),
      confirmBody(chal.json.challenge.id, { body: { ad_account_id: 'act_1' } }),
    ];
    for (const body of confCases) {
      const res = await api('POST', confirmPath(live), { cookie: cookieA, body });
      assert.equal(res.status, 400, res.text);
      assert.equal(res.json.error, 'validation_failed');
      assert.doesNotMatch(res.text, /please confirm/);
      assert.doesNotMatch(res.text, /"tok"/);
    }
  });

  test('idempotent confirm replay is 202; payload mismatch is 409', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const attempt = await seedAttempt(live);
    const chal = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    const key = ik('conflict');
    const first = await api('POST', confirmPath(live), {
      cookie: cookieA, body: confirmBody(chal.json.challenge.id, { idempotency_key: key }),
    });
    assert.equal(first.status, 202, first.text);
    const mismatch = await api('POST', confirmPath(live), {
      cookie: cookieA, body: confirmBody('cpc_other', { idempotency_key: key }),
    });
    assert.equal(mismatch.status, 409, mismatch.text);
    assert.equal(mismatch.json.error, 'idempotency_conflict');
    assert.notEqual(mismatch.json.replay, true);

    const other = await readyIntent(cookieA, wfA, artA);
    const otherAttempt = await seedAttempt(other);
    const otherChal = await api('POST', challengePath(other), {
      cookie: cookieA, body: challengeBody(),
    });
    const cross = await api('POST', confirmPath(other), {
      cookie: cookieA, body: confirmBody(otherChal.json.challenge.id, { idempotency_key: key }),
    });
    assert.equal(cross.status, 409, cross.text);
    assert.equal(cross.json.error, 'idempotency_conflict');
  });

  test('expired challenge cannot be confirmed (TTL <= 5m / <= 2m)', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const attempt = await seedAttempt(live);
    const chal = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    assert.equal(chal.status, 200, chal.text);
    await p().query(`ALTER TABLE orchestrator_campaign_provider_challenges DISABLE TRIGGER orchestrator_cpc_guard`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_provider_challenges
            SET created_at=now() - interval '10 minutes',
                expires_at=now() - interval '5 minutes'
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, chal.json.challenge.id]
      );
    } finally {
      await p().query(`ALTER TABLE orchestrator_campaign_provider_challenges ENABLE TRIGGER orchestrator_cpc_guard`);
    }
    const res = await api('POST', confirmPath(live), {
      cookie: cookieA, body: confirmBody(chal.json.challenge.id),
    });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.json.error, 'approval_expired');
    assert.notEqual(res.json.ok, true);
  });

  test('tenant isolation hides foreign draft/attempt as not_found', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    await seedAttempt(live);
    const res = await api('POST', challengePath(live), {
      cookie: cookieB, body: challengeBody(),
    });
    assert.equal(res.status, 404, res.text);
    assert.equal(res.json.error, 'not_found');
  });

  test('expired lease on the current started attempt is lease_conflict', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    await seedAttempt(live, { leaseExpiresAt: new Date(Date.now() - 60 * 1000) });
    const res = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.json.error, 'lease_conflict');
    assert.notEqual(res.json.ok, true);
  });

  test('current started attempt is derived server-side; stale attempts cannot be selected', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const stale = await seedAttempt(live, {
      attemptNumber: 1,
      leaseExpiresAt: new Date(Date.now() - 60 * 1000),
    });
    const liveAttempt = await seedAttempt(live, {
      attemptNumber: 2,
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    const res = await api('POST', challengePath(live), {
      cookie: cookieA, body: challengeBody(),
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.challenge.attempt_id, liveAttempt.id);
    assert.notEqual(res.json.challenge.attempt_id, stale.id);
    const legacy = await api('POST',
      `/provider-challenges/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents/${live.intent.id}/attempts/${stale.id}`,
      { cookie: cookieA, body: challengeBody() });
    assert.notEqual(legacy.status, 200, legacy.text);
    assert.notEqual(legacy.json && legacy.json.ok, true);
  });

  test('helpers export confirmation persistence without provider side effects', () => {
    assert.equal(typeof confirmations.createChallenge, 'function');
    assert.equal(typeof confirmations.confirmProviderDraft, 'function');
    assert.doesNotMatch(SRC_CONF, /https?:\/\//);
    const confirmRoute = SRC_API.slice(
      SRC_API.indexOf("'/confirm-provider-draft"),
      SRC_API.indexOf("router.post('/:id/revoke'")
    );
    assert.match(confirmRoute, /published:\s*false/);
    assert.match(confirmRoute, /external_action_taken:\s*false/);
    assert.doesNotMatch(confirmRoute, /published:\s*true|delivered:\s*true/);
  });
}
