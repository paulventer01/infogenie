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
const { parseContract } = require('../services/agent_orchestrator/campaign_validate');
const { assertPublishAuthorized } = require('../services/agent_orchestrator/campaign_drafts');
const { CONFIRM_PHRASE, requestHashOf } = require('../services/agent_orchestrator/campaign_publish_requests');
const { sha256Hex } = require('../services/agent_orchestrator/hash');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');
const dnsPromises = require('node:dns').promises;

const HAS_DB = hasDb();
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const HEX = () => crypto.randomBytes(32).toString('hex');
const ROOT = path.join(__dirname, '..');
const SRC_DRAFTS = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_drafts.js'), 'utf8');
const SRC_API = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_api.js'), 'utf8');
const SRC_REQ = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_publish_requests.js'), 'utf8');
const SRC_VALIDATE = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_validate.js'), 'utf8');
const SRC_VAULT = fs.readFileSync(path.join(ROOT, 'services/credentials/vault.js'), 'utf8');
const { hasCredentials } = require('../services/credentials/vault');
const TABLE = 'orchestrator_campaign_publish_requests';
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
  assert.equal(json.published, false, label);
  assert.equal(json.external_action_taken, false, label);
  assert.notEqual(json.published, true, label);
  assert.ok(json.request, label);
  assert.equal(json.request.status, 'requested', label);
  assert.equal(Number(json.request.confirmation_version), 1, label);
  assert.equal(json.request.object_kind, 'campaign_publish_request', label);
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

test('source: client-scoped authorize helper, no nested pool tx, no publish side effects', () => {
  assert.match(SRC_DRAFTS, /async function assertPublishAuthorizedOnClient\(/);
  assert.match(SRC_DRAFTS, /async function assertPublishAuthorized\(pool/);
  assert.match(SRC_DRAFTS, /return withTx\(pool, \(c\) => assertPublishAuthorizedOnClient\(c, tenantId, draftId\)\)/);
  assert.match(SRC_DRAFTS, /async function assertPublishAuthorized[\s\S]*assertAuthoritativeSnapshot\(/);

  assert.match(SRC_REQ, /assertPublishAuthorizedOnClient\(/);
  assert.doesNotMatch(SRC_REQ, /assertPublishAuthorized\(\s*pool/);
  assert.match(SRC_REQ, /withTx\(pool, async \(c\) => \{[\s\S]*assertPublishAuthorizedOnClient\(c,/);
  assert.match(SRC_REQ, /withTx\(pool, async \(c\) => \{[\s\S]*insertOrReplay\(c, ctx\)/);
  assert.match(SRC_REQ, /INSERT INTO orchestrator_campaign_publish_requests/);
  assert.match(SRC_REQ, /SAVEPOINT /);
  assert.match(SRC_REQ, /checkCredentials\(/);
  assert.match(SRC_REQ, /function approvalIdMatches\([\s\S]*String\(echoed\) === String\(pub\.id\)/);
  assert.doesNotMatch(SRC_REQ, /n === Number\(pub\.workflow_approval_id\)/);
  assert.doesNotMatch(SRC_REQ, /hasCredentials\s*\(/);
  assert.match(SRC_VALIDATE, /vault\.hasCredentials\(ownerId, vaultKey, client/);
  assert.match(SRC_VALIDATE, /client, tenantId/);
  assert.match(SRC_VAULT, /async function hasCredentials\(userId, platform, opts\)/);
  assert.match(SRC_VAULT, /FOR UPDATE OF ui|LIMIT 1 FOR UPDATE/);
  assert.match(SRC_VAULT, /const q = client \|\| _db\.getPool\(\)/);
  const vaultHasFn = SRC_VAULT.slice(
    SRC_VAULT.indexOf('async function hasCredentials'),
    SRC_VAULT.indexOf('function assertBootRequirements')
  );
  assert.doesNotMatch(vaultHasFn, /\bBEGIN\b|\bCOMMIT\b|SAVEPOINT/);
  assert.doesNotMatch(vaultHasFn, /ciphertext|_decrypt|decryptString|JSON\.parse/);
  assert.doesNotMatch(SRC_REQ, /getCredentials\s*\(/);
  assert.doesNotMatch(SRC_REQ, /require\('\.\.\/credentials\/vault'\)/);
  assert.doesNotMatch(SRC_REQ, /runIdempotent/);
  assert.doesNotMatch(SRC_REQ, /connectors\//);
  assert.doesNotMatch(SRC_REQ, /outbox\.(enqueue|insert)/);
  assert.doesNotMatch(SRC_REQ, /fetch\s*\(/);
  assert.doesNotMatch(SRC_REQ, /setInterval|setTimeout|cron|worker/);
  assert.doesNotMatch(SRC_REQ, /UPDATE orchestrator_campaign_drafts/);
  assert.doesNotMatch(SRC_REQ, /status='publishing'|status=\"publishing\"/);
  assert.match(SRC_REQ, /CONFIRM INTERNAL PUBLISHING REQUEST/);
  assert.match(SRC_REQ, /campaign_publishing_requested/);
  assert.equal(CONFIRM_PHRASE, 'CONFIRM INTERNAL PUBLISHING REQUEST');

  assert.match(SRC_API, /\/:id\/publishing-requests/);
  assert.match(SRC_API, /rejectApiKey:\s*true/);
  assert.match(SRC_API, /GATE_PERMISSION\.campaign_publishing/);
  assert.match(SRC_API, /published:\s*false/);
  assert.match(SRC_API, /external_action_taken:\s*false/);
  const pubRouteStart = SRC_API.indexOf("router.post('/:id/publishing-requests'");
  const pubRouteEnd = SRC_API.indexOf("router.post('/:id/revoke'");
  assert.ok(pubRouteStart >= 0 && pubRouteEnd > pubRouteStart);
  assert.doesNotMatch(SRC_API.slice(pubRouteStart, pubRouteEnd), /runIdempotent/);
  assert.doesNotMatch(SRC_API, /connectors\//);
  assert.doesNotMatch(SRC_API, /outbox\.(enqueue|insert)/);
  assert.doesNotMatch(SRC_API, /fetch\s*\(/);
});

test('request_hash is lowercase 64-char over the allowlisted envelope', () => {
  const hash = requestHashOf({
    tenant_id: 1, draft_id: 'cd_1', approval_id: 'cpa_1', revision: 1,
    contract_hash: 'a'.repeat(64), snapshot_hash: 'b'.repeat(64), confirmation_version: 1,
    confirmation: CONFIRM_PHRASE, extra: 'ignored',
  });
  assert.match(hash, /^[0-9a-f]{64}$/);
  const same = requestHashOf({
    snapshot_hash: 'b'.repeat(64), extra: 'still-ignored', confirmation: 'NO',
    tenant_id: 1, draft_id: 'cd_1', approval_id: 'cpa_1', revision: 1,
    contract_hash: 'a'.repeat(64), confirmation_version: 1,
  });
  assert.equal(hash, same);
  const different = requestHashOf({
    tenant_id: 1, draft_id: 'cd_1', approval_id: 'cpa_1', revision: 2,
    contract_hash: 'a'.repeat(64), snapshot_hash: 'b'.repeat(64), confirmation_version: 1,
  });
  assert.notEqual(hash, different);
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign publishing requests skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, cookieA, cookieB, artA, wfA, wfB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const api = (method, path, opts) => request(app.baseUrl, method, `/api/agent-orchestrator/campaign-drafts${path}`, opts);

  async function seedWf(tenantId) {
    const wfId = nid('wf');
    await p().query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,'PR6B')`, [wfId, tenantId]);
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

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR6B A');
    tenantB = await fx.seedTenant('PR6B B');
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

  test('valid publishing request binds the approved snapshot and stays internal', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const authorized = await assertPublishAuthorized(p(), tenantA.id, live.draft.id);
    assert.equal(authorized.ok, true);
    assert.equal(authorized.draft.status, 'approved_for_publish');

    const res = await requestPublishing(cookieA, live.draft, live.approval);
    assert.equal(res.status, 200, res.text);
    assertHonest(res.json);
    assert.equal(res.json.replay, false);
    assert.equal(res.json.request.draft_id, live.draft.id);
    assert.equal(res.json.request.publish_approval_id, live.approval.id);
    assert.equal(Number(res.json.request.workflow_approval_id), Number(live.draft.approval_id));
    assert.equal(res.json.request.revision, live.draft.current_revision);
    assert.equal(res.json.request.contract_hash, live.draft.contract_hash);
    assert.equal(res.json.request.snapshot_hash, sha256Hex(live.approval.snapshot));
    assert.equal(Number(res.json.request.requested_by), Number(ownerA.id));
    assert.doesNotMatch(res.text, FORBIDDEN_SURFACE);
    assert.doesNotMatch(JSON.stringify(res.json), /CONFIRM INTERNAL PUBLISHING REQUEST/);

    const row = (await p().query(
      `SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, res.json.request.id]
    )).rows[0];
    assert.equal(row.status, 'requested');
    assert.match(row.request_hash, /^[0-9a-f]{64}$/);
    assert.equal(row.request_hash, row.request_hash.toLowerCase());

    const draft = await api('GET', `/${live.draft.id}`, { cookie: cookieA });
    assert.equal(draft.status, 200, draft.text);
    assert.equal(draft.json.draft.status, 'approved_for_publish');
    assert.equal(draft.json.draft.published, false);

    const outbox = (await p().query(
      `SELECT 1 FROM orchestrator_outbox WHERE tenant_id=$1 AND workflow_id=$2`,
      [tenantA.id, wfA]
    )).rowCount;
    assert.equal(outbox, 0);

    const audit = (await p().query(
      `SELECT event, actor_user_id, detail FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND workflow_id=$2 AND event='campaign_publishing_requested'
        ORDER BY id DESC LIMIT 1`,
      [tenantA.id, wfA]
    )).rows[0];
    assert.ok(audit);
    assert.equal(Number(audit.actor_user_id), Number(ownerA.id));
    assert.equal(audit.detail.from, 'none');
    assert.equal(audit.detail.to, 'requested');
    assert.equal(audit.detail.state, 'requested');
    assert.equal(audit.detail.gate, 'campaign_publishing');
    assert.equal(Number(audit.detail.confirmation_version), 1);
    assert.equal(audit.detail.contract_hash, live.draft.contract_hash);
    assert.equal(audit.detail.snapshot_hash, sha256Hex(live.approval.snapshot));
    assert.equal(audit.detail.request_id, res.json.request.id);
    assert.doesNotMatch(JSON.stringify(audit.detail), /CONFIRM INTERNAL PUBLISHING REQUEST/);
    assert.doesNotMatch(JSON.stringify(audit.detail), FORBIDDEN_SURFACE);
  });

  test('exact echoed approval/revision/contract/snapshot hashes are required', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const cases = [
      ['wrong approval_id', { approval_id: 'cpa_missing' }],
      ['wrong revision', { revision: live.draft.current_revision + 9 }],
      ['wrong contract_hash', { contract_hash: 'c'.repeat(64) }],
      ['wrong snapshot_hash', { snapshot_hash: 'd'.repeat(64) }],
    ];
    for (const [label, extra] of cases) {
      const res = await requestPublishing(cookieA, live.draft, live.approval, extra);
      assert.equal(res.status, 409, `${label}: ${res.text}`);
      assert.equal(res.json.error, 'approval_stale', label);
      assert.notEqual(res.json.ok, true, label);
      assert.notEqual(res.json.replay, true, label);
    }
    const missing = await api('POST', `/${live.draft.id}/publishing-requests`, {
      cookie: cookieA,
      body: { confirmation: CONFIRM_PHRASE, idempotency_key: ik('missing') },
    });
    assert.equal(missing.status, 400, missing.text);
    assert.equal(missing.json.error, 'validation_failed');
  });

  test('approval_id accepts only the exact publishing-approval id', async () => {
    const liveA = await readyApproved(cookieA, wfA, artA);
    const liveB = await readyApproved(cookieB, wfB, await seedBrief(tenantB.id, ownerB.id, wfB));
    const beforeReq = (await p().query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND draft_id=$2`,
      [tenantA.id, liveA.draft.id]
    )).rows[0].n;
    const beforeAudit = (await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND workflow_id=$2 AND event='campaign_publishing_requested'`,
      [tenantA.id, wfA]
    )).rows[0].n;
    const aliases = [
      ['workflow approval id', { approval_id: liveA.draft.approval_id }],
      ['numeric workflow approval id', { approval_id: Number(liveA.approval.workflow_approval_id || liveA.draft.approval_id) }],
      ['stale other draft approval', { approval_id: liveB.approval.id }],
    ];
    for (const [label, extra] of aliases) {
      const res = await requestPublishing(cookieA, liveA.draft, liveA.approval, extra);
      assert.equal(res.status, 409, `${label}: ${res.text}`);
      assert.equal(res.json.error, 'approval_stale', label);
      assert.notEqual(res.json.ok, true, label);
      assert.notEqual(res.json.replay, true, label);
    }
    const afterReq = (await p().query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND draft_id=$2`,
      [tenantA.id, liveA.draft.id]
    )).rows[0].n;
    const afterAudit = (await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND workflow_id=$2 AND event='campaign_publishing_requested'`,
      [tenantA.id, wfA]
    )).rows[0].n;
    assert.equal(afterReq, beforeReq);
    assert.equal(afterAudit, beforeAudit);
  });

  test('strict confirmation phrase is exact and never stored', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const invalid = [
      ['missing', { confirmation: undefined }],
      ['empty', { confirmation: '' }],
      ['lowercase', { confirmation: 'confirm internal publishing request' }],
      ['padded', { confirmation: ` ${CONFIRM_PHRASE}` }],
      ['trailing', { confirmation: `${CONFIRM_PHRASE} ` }],
      ['extra', { confirmation: `${CONFIRM_PHRASE}!` }],
      ['number', { confirmation: 1 }],
    ];
    for (const [label, extra] of invalid) {
      const body = publishingBody(live.draft, live.approval, extra);
      if (extra.confirmation === undefined) delete body.confirmation;
      const res = await api('POST', `/${live.draft.id}/publishing-requests`, { cookie: cookieA, body });
      assert.equal(res.status, 400, `${label}: ${res.text}`);
      assert.equal(res.json.error, 'validation_failed', label);
    }
    const ok = await requestPublishing(cookieA, live.draft, live.approval);
    assert.equal(ok.status, 200, ok.text);
    const stored = (await p().query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA.id, ok.json.request.id])).rows[0];
    assert.doesNotMatch(JSON.stringify(stored), /CONFIRM INTERNAL PUBLISHING REQUEST/);
  });

  test('human session required; API key and unauthenticated callers are rejected', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const body = publishingBody(live.draft, live.approval);
    const unauth = await api('POST', `/${live.draft.id}/publishing-requests`, { body });
    assert.equal(unauth.status, 401, unauth.text);
    assert.ok(unauth.json.error === 'auth_required' || unauth.json.error === 'unauthorized');
    const keyed = await api('POST', `/${live.draft.id}/publishing-requests`, { apiKey: true, body });
    assert.equal(keyed.status, 403, keyed.text);
    assert.equal(keyed.json.error, 'permission_denied');
  });

  test('permission gate rejects a marketer without campaign_publishing', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const marketer = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'marketer' });
    const cookieM = (await login(app.baseUrl, marketer.email, marketer.password)).cookie;
    const res = await requestPublishing(cookieM, live.draft, live.approval);
    assert.equal(res.status, 403, res.text);
    assert.ok(['forbidden', 'permission_denied', 'owner_only'].includes(res.json.error), res.text);
  });

  test('tenant isolation hides the draft as not_found', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const res = await requestPublishing(cookieB, live.draft, live.approval);
    assert.equal(res.status, 404, res.text);
    assert.equal(res.json.error, 'not_found');
    const count = (await p().query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND draft_id=$2`,
      [tenantB.id, live.draft.id]
    )).rows[0].n;
    assert.equal(count, 0);
  });

  test('actor must match the bound approval snapshot actor', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const other = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    await seedCreds(other.id);
    const cookieO = (await login(app.baseUrl, other.email, other.password)).cookie;
    const res = await requestPublishing(cookieO, live.draft, live.approval);
    assert.equal(res.status, 403, res.text);
    assert.ok(['permission_denied', 'forbidden'].includes(res.json.error), res.text);
  });

  test('missing, revoked, expired, and stale approvals fail closed', async () => {
    const created = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, created.id);
    const notApproved = await api('POST', `/${ready.id}/publishing-requests`, {
      cookie: cookieA,
      body: {
        confirmation: CONFIRM_PHRASE, approval_id: 'cpa_none', revision: ready.current_revision,
        contract_hash: ready.contract_hash, snapshot_hash: 'e'.repeat(64), idempotency_key: ik('na'),
      },
    });
    assert.equal(notApproved.status, 409, notApproved.text);
    assert.ok(['approval_required', 'approval_stale'].includes(notApproved.json.error), notApproved.text);

    const live = await approveOk(cookieA, ready);
    await api('POST', `/${live.draft.id}/revoke`, {
      cookie: cookieA, body: { reason: 'Withdraw publishing consent before request' },
    });
    const revoked = await requestPublishing(cookieA, live.draft, live.approval);
    assert.equal(revoked.status, 409, revoked.text);
    assert.ok(['approval_required', 'approval_revoked'].includes(revoked.json.error), revoked.text);

    const exp = await readyApproved(cookieA, wfA, artA);
    await p().query(`ALTER TABLE orchestrator_campaign_drafts DISABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_drafts SET approval_expires_at=now() - interval '1 hour' WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, exp.draft.id]
      );
    } finally {
      await p().query(`ALTER TABLE orchestrator_campaign_drafts ENABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    }
    const expired = await requestPublishing(cookieA, exp.draft, exp.approval);
    assert.equal(expired.status, 409, expired.text);
    assert.equal(expired.json.error, 'approval_expired');

    const stale = await readyApproved(cookieA, wfA, artA);
    const edited = await api('PATCH', `/${stale.draft.id}`, {
      cookie: cookieA, body: { contract: validContract(wfA, artA, { objective: 'sales' }) },
    });
    assert.equal(edited.status, 200, edited.text);
    const afterEdit = await requestPublishing(cookieA, stale.draft, stale.approval);
    assert.equal(afterEdit.status, 409, afterEdit.text);
    assert.ok(['approval_required', 'approval_stale'].includes(afterEdit.json.error), afterEdit.text);
  });

  test('tampered authoritative snapshot cannot be requested', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
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
      const res = await requestPublishing(cookieA, live.draft, live.approval);
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

  test('credential ownership is re-checked; removal fails closed', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    await p().query(`UPDATE user_integrations SET status='disconnected' WHERE user_id=$1 AND platform='meta_ads'`, [ownerA.id]);
    try {
      const res = await requestPublishing(cookieA, live.draft, live.approval);
      assert.ok(res.status >= 400 && res.status < 500, res.text);
      assert.equal(res.json.error, 'validation_failed');
      assert.ok((res.json.errors || []).some((e) => e.code === 'missing_credentials'), res.text);
    } finally {
      await p().query(`UPDATE user_integrations SET status='connected' WHERE user_id=$1 AND platform='meta_ads'`, [ownerA.id]);
    }
    const ok = await requestPublishing(cookieA, live.draft, live.approval);
    assert.equal(ok.status, 200, ok.text);
    await clearCreds(ownerA.id);
    try {
      const replay = await requestPublishing(cookieA, live.draft, live.approval, {
        idempotency_key: ok.json.request ? undefined : ik('gone'),
      });
      const keyed = await requestPublishing(cookieA, live.draft, live.approval, {
        idempotency_key: ik('after-clear'),
      });
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
    const live = await readyApproved(cookieA, wfA, artA);
    const first = await requestPublishing(cookieA, live.draft, live.approval);
    assert.equal(first.status, 200, first.text);
    await p().query(
      `UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2`,
      [tenantA.id, ownerA.id]
    );
    try {
      const replay = await requestPublishing(cookieA, live.draft, live.approval, {
        idempotency_key: (await p().query(
          `SELECT idempotency_key FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
          [tenantA.id, first.json.request.id]
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
    const live = await readyApproved(cookieA, wfA, artA);
    const key = ik('same');
    const first = await requestPublishing(cookieA, live.draft, live.approval, { idempotency_key: key });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.replay, false);
    const replay = await requestPublishing(cookieA, live.draft, live.approval, { idempotency_key: key });
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.json.replay, true);
    assert.equal(replay.json.request.id, first.json.request.id);
    assertHonest(replay.json);

    const conflict = await requestPublishing(cookieA, live.draft, live.approval, {
      idempotency_key: key, snapshot_hash: 'f'.repeat(64),
    });
    assert.equal(conflict.status, 409, conflict.text);
    assert.equal(conflict.json.error, 'idempotency_conflict');

    const other = await readyApproved(cookieA, wfA, artA);
    const crossDraft = await requestPublishing(cookieA, other.draft, other.approval, { idempotency_key: key });
    assert.equal(crossDraft.status, 409, crossDraft.text);
    assert.equal(crossDraft.json.error, 'idempotency_conflict');
  });

  test('same approved snapshot with different keys converges or bounded-conflicts to one row', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const a = await requestPublishing(cookieA, live.draft, live.approval, { idempotency_key: ik('snap-a') });
    const b = await requestPublishing(cookieA, live.draft, live.approval, { idempotency_key: ik('snap-b') });
    assert.ok([200, 409].includes(a.status), a.text);
    assert.ok([200, 409].includes(b.status), b.text);
    const accepted = [a, b].filter((res) => res.status === 200);
    assert.ok(accepted.length >= 1);
    if (accepted.length === 2) {
      assert.equal(accepted[0].json.request.id, accepted[1].json.request.id);
      assert.ok(accepted.some((res) => res.json.replay === true));
    } else {
      assert.equal([a, b].find((res) => res.status === 409).json.error, 'idempotency_conflict');
    }
    const rows = (await p().query(
      `SELECT id FROM ${TABLE} WHERE tenant_id=$1 AND draft_id=$2 AND snapshot_hash=$3`,
      [tenantA.id, live.draft.id, sha256Hex(live.approval.snapshot)]
    )).rows;
    assert.equal(rows.length, 1);
  });

  test('replay after revocation, expiry, edit, credential removal, or snapshot invalidation fails closed', async () => {
    async function setup() {
      const live = await readyApproved(cookieA, wfA, artA);
      const key = ik('inv');
      const first = await requestPublishing(cookieA, live.draft, live.approval, { idempotency_key: key });
      assert.equal(first.status, 200, first.text);
      return { live, key, first };
    }

    const revoked = await setup();
    await api('POST', `/${revoked.live.draft.id}/revoke`, {
      cookie: cookieA, body: { reason: 'Revoke after the internal request exists' },
    });
    const afterRevoke = await requestPublishing(cookieA, revoked.live.draft, revoked.live.approval, {
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
    const afterExp = await requestPublishing(cookieA, exp.live.draft, exp.live.approval, { idempotency_key: exp.key });
    assert.equal(afterExp.status, 409, afterExp.text);
    assert.equal(afterExp.json.error, 'approval_expired');
    assert.notEqual(afterExp.json.replay, true);

    const edited = await setup();
    const patch = await api('PATCH', `/${edited.live.draft.id}`, {
      cookie: cookieA, body: { contract: validContract(wfA, artA, { objective: 'leads' }) },
    });
    assert.equal(patch.status, 200, patch.text);
    const afterEdit = await requestPublishing(cookieA, edited.live.draft, edited.live.approval, {
      idempotency_key: edited.key,
    });
    assert.ok(afterEdit.status >= 400, afterEdit.text);
    assert.notEqual(afterEdit.json.replay, true);

    const creds = await setup();
    await clearCreds(ownerA.id);
    try {
      const afterCreds = await requestPublishing(cookieA, creds.live.draft, creds.live.approval, {
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
      const afterTamper = await requestPublishing(cookieA, tamper.live.draft, tamper.live.approval, {
        idempotency_key: tamper.key,
      });
      assert.ok(afterTamper.status >= 400, afterTamper.text);
      assert.notEqual(afterTamper.json.replay, true);
    } finally {
      await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals ENABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    }
  });

  test('same-snapshot concurrency creates one request and never publishes', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const responses = await Promise.all([
      requestPublishing(cookieA, live.draft, live.approval, { idempotency_key: ik('par-a') }),
      requestPublishing(cookieA, live.draft, live.approval, { idempotency_key: ik('par-b') }),
    ]);
    assert.ok(responses.every((res) => [200, 409].includes(res.status)), responses.map((r) => r.text).join('\n'));
    const accepted = responses.filter((res) => res.status === 200);
    assert.ok(accepted.length >= 1 && accepted.length <= 2);
    assert.equal(new Set(accepted.map((res) => res.json.request.id)).size, 1);
    for (const res of accepted) assertHonest(res.json);
    for (const res of responses.filter((item) => item.status === 409)) {
      assert.equal(res.json.error, 'idempotency_conflict');
    }
    const rows = (await p().query(
      `SELECT id, status FROM ${TABLE} WHERE tenant_id=$1 AND draft_id=$2`,
      [tenantA.id, live.draft.id]
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'requested');
    const draft = await api('GET', `/${live.draft.id}`, { cookie: cookieA });
    assert.equal(draft.json.draft.status, 'approved_for_publish');
  });

  test('concurrent revoke, edit, and credential removal stay fail-closed', async () => {
    const liveRevoke = await readyApproved(cookieA, wfA, artA);
    const [reqRevoke, revoke] = await Promise.all([
      requestPublishing(cookieA, liveRevoke.draft, liveRevoke.approval, { idempotency_key: ik('c-rev') }),
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

    const liveEdit = await readyApproved(cookieA, wfA, artA);
    const [reqEdit, edit] = await Promise.all([
      requestPublishing(cookieA, liveEdit.draft, liveEdit.approval, { idempotency_key: ik('c-edit') }),
      api('PATCH', `/${liveEdit.draft.id}`, {
        cookie: cookieA, body: { contract: validContract(wfA, artA, { objective: 'sales' }) },
      }),
    ]);
    assert.equal(edit.status, 200, edit.text);
    assert.ok([200, 409].includes(reqEdit.status), reqEdit.text);
    if (reqEdit.status === 200) assertHonest(reqEdit.json);
    const afterEdit = await api('GET', `/${liveEdit.draft.id}`, { cookie: cookieA });
    assert.notEqual(afterEdit.json.draft.status, 'publishing');

    const liveCred = await readyApproved(cookieA, wfA, artA);
    const [reqCred, creds] = await Promise.all([
      requestPublishing(cookieA, liveCred.draft, liveCred.approval, { idempotency_key: ik('c-cred') }),
      p().query(`DELETE FROM user_integrations WHERE user_id=$1`, [ownerA.id]),
    ]);
    const remaining = (await p().query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND draft_id=$2`,
      [tenantA.id, liveCred.draft.id]
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

  test('client-scoped hasCredentials locks the credential row through commit', async () => {
    await seedCreds(ownerA.id);
    const poolPresent = await hasCredentials(ownerA.id, 'meta_ads');
    assert.equal(poolPresent, true);
    const holder = await p().connect();
    try {
      await holder.query('BEGIN');
      const locked = await hasCredentials(ownerA.id, 'meta_ads', {
        client: holder, tenantId: tenantA.id,
      });
      assert.equal(locked, true);
      const deleter = await p().connect();
      try {
        await deleter.query('BEGIN');
        await deleter.query(`SET LOCAL lock_timeout = '400ms'`);
        await assert.rejects(
          () => deleter.query(
            `DELETE FROM user_integrations WHERE user_id=$1 AND platform=$2`,
            [ownerA.id, 'meta_ads']
          ),
          /lock timeout|canceling statement/i
        );
        await deleter.query('ROLLBACK');
      } finally {
        deleter.release();
      }
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }
    const after = await p().query(
      `DELETE FROM user_integrations WHERE user_id=$1 AND platform=$2 RETURNING user_id, platform, status`,
      [ownerA.id, 'meta_ads']
    );
    assert.equal(after.rowCount, 1);
    assert.deepStrictEqual(Object.keys(after.rows[0]).sort(), ['platform', 'status', 'user_id']);
    await seedCreds(ownerA.id);
  });

  test('inserted request is immutable and does not advance the draft', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const res = await requestPublishing(cookieA, live.draft, live.approval);
    assert.equal(res.status, 200, res.text);
    const id = res.json.request.id;
    await assert.rejects(
      () => p().query(`UPDATE ${TABLE} SET status='requested' WHERE tenant_id=$1 AND id=$2`, [tenantA.id, id]),
      /orchestrator_campaign_publish_requests_immutable/
    );
    await assert.rejects(
      () => p().query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA.id, id]),
      /orchestrator_campaign_publish_requests_immutable/
    );
    const still = (await p().query(`SELECT status FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA.id, id])).rows[0];
    assert.equal(still.status, 'requested');
    const draft = await api('GET', `/${live.draft.id}`, { cookie: cookieA });
    assert.equal(draft.json.draft.status, 'approved_for_publish');
    assert.equal(draft.json.draft.published, false);
  });

  test('secret material is never disclosed in responses or audit', async () => {
    const marker = `sekrit-token-${crypto.randomBytes(8).toString('hex')}`;
    try {
      await p().query(
        `UPDATE user_integrations SET ciphertext=$3, iv=$3, tag=$3 WHERE user_id=$1 AND platform=$2`,
        [ownerA.id, 'meta_ads', Buffer.from(marker)]
      );
      const live = await readyApproved(cookieA, wfA, artA);
      const res = await requestPublishing(cookieA, live.draft, live.approval, {
        confirmation: CONFIRM_PHRASE,
        extra_client_field: 'arbitrary-client-content',
        access_token: marker,
      });
      assert.equal(res.status, 200, res.text);
      assertNoSecrets(res.text, marker);
      assert.doesNotMatch(res.text, /arbitrary-client-content/);
      const audit = (await p().query(
        `SELECT detail::text AS detail FROM orchestrator_audit_events WHERE tenant_id=$1 AND workflow_id=$2`,
        [tenantA.id, wfA]
      )).rows.map((r) => r.detail).join('\n');
      assertNoSecrets(audit, marker);
      const stored = (await p().query(
        `SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, res.json.request.id]
      )).rows[0];
      assertNoSecrets(JSON.stringify(stored), marker);
    } finally {
      await clearCreds(ownerA.id);
      await seedCreds(ownerA.id);
    }
  });

  test('pool-based assertPublishAuthorized remains usable after the client-scoped extract', async () => {
    const live = await readyApproved(cookieA, wfA, artA);
    const authorized = await assertPublishAuthorized(p(), tenantA.id, live.draft.id);
    assert.equal(authorized.ok, true);
    assert.equal(authorized.draft.status, 'approved_for_publish');
    assert.equal(authorized.approval.id, live.approval.id);
    await assert.rejects(
      () => assertPublishAuthorized(p(), tenantB.id, live.draft.id),
      (e) => e.code === 'not_found'
    );
  });

  test('parseContract still rejects fabricated credential material in the draft path', async () => {
    const art = { assetId: 'a1', version: 1, contentHash: 'a'.repeat(64) };
    await assert.rejects(
      () => parseContract(validContract('wf1', art, { accounts: [{ platform: 'meta' }] })),
      (e) => e.code === 'missing_credentials'
    );
  });
}
