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
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');

const HAS_DB = hasDb();
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const HEX = () => crypto.randomBytes(32).toString('hex');
const SRC_DRAFTS = fs.readFileSync(path.join(__dirname, '../services/agent_orchestrator/campaign_drafts.js'), 'utf8');
const SRC_API = fs.readFileSync(path.join(__dirname, '../services/agent_orchestrator/campaign_api.js'), 'utf8');

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

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('source: no connectors, outbox, or live platform fetch', () => {
  assert.doesNotMatch(SRC_DRAFTS, /connectors\//);
  assert.doesNotMatch(SRC_API, /connectors\//);
  assert.doesNotMatch(SRC_DRAFTS, /outbox\.(enqueue|insert)/);
  assert.doesNotMatch(SRC_API, /outbox\.(enqueue|insert)/);
  assert.doesNotMatch(SRC_DRAFTS, /fetch\s*\(/);
  assert.doesNotMatch(SRC_API, /fetch\s*\(/);
  assert.match(SRC_DRAFTS, /FOR UPDATE/);
});

test('PR6A UI campaign drafts (no publish claim)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../components/features/manage/AgentOrchestrator.tsx'), 'utf8');
  assert.match(SRC, /\/api\/agent-orchestrator\/campaign-drafts/);
  assert.match(SRC, /Campaign draft/);
  assert.match(SRC, /nothing has been published/i);
  assert.doesNotMatch(SRC, /mode:\s*"live"/);
  assert.match(SRC, /const trimmedReason = draftRevokeReason\.trim\(\)/);
  assert.match(SRC, /\/revoke`, "POST", \{ reason: trimmedReason \}/);
  assert.match(SRC, /draftRevokeReason[^]*maxLength=\{500\}/);
  assert.doesNotMatch(SRC, /reason:\s*["'`](?:revoked|manual|no reason)/i, 'UI must not supply a default revoke reason');
});

test('malformed budget, unsafe URL, unknown extension rejected', async () => {
  const art = { assetId: 'a1', version: 1, contentHash: 'a'.repeat(64) };
  const base = validContract('wf1', art);
  await assert.rejects(() => parseContract({ ...base, budget: { amount_micros: -1, currency: 'USD' } }), (e) => e.code === 'validation_failed');
  await assert.rejects(() => parseContract({ ...base, budget: { amount_micros: 1.5, currency: 'USD' } }), (e) => e.code === 'validation_failed');
  await assert.rejects(() => parseContract({ ...base, budget: { amount_micros: Infinity, currency: 'USD' } }), (e) => e.code === 'validation_failed');
  await assert.rejects(() => parseContract({ ...base, destination: { landing_page_url: 'http://127.0.0.1' } }), (e) => e.code === 'unsafe_url');
  await assert.rejects(() => parseContract({ ...base, platform_extensions: { meta: { foo: 'x' } } }), (e) => e.code === 'validation_failed');
  await assert.rejects(() => parseContract({ ...base, accounts: [{ platform: 'meta' }] }), (e) => e.code === 'missing_credentials');
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign drafts skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, cookieA, cookieB, artA, wfA, wfB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const api = (method, path, opts) => request(app.baseUrl, method, `/api/agent-orchestrator/campaign-drafts${path}`, opts);

  async function seedWf(tenantId) {
    const wfId = nid('wf');
    await p().query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,'PR6A')`, [wfId, tenantId]);
    return wfId;
  }
  async function seedCreds(userId) {
    const z = Buffer.from([0]);
    await p().query(
      `INSERT INTO user_integrations (user_id, platform, ciphertext, iv, tag, status)
       VALUES ($1,'meta',$2,$3,$4,'connected') ON CONFLICT (user_id, platform) DO NOTHING`,
      [userId, z, z, z]
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
  async function revokeOk(cookie, id, reason) {
    const res = await api('POST', `/${id}/revoke`, { cookie, body: { reason } });
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

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR6A A');
    tenantB = await fx.seedTenant('PR6A B');
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

  test('1 create + revision on material edit', async () => {
    const d = await createOk(cookieA, wfA, artA);
    assert.equal(d.object_kind, 'campaign_draft');
    assert.equal(d.status, 'draft');
    assert.equal(d.current_revision, 1);
    const patched = await api('PATCH', `/${d.id}`, {
      cookie: cookieA,
      body: { contract: validContract(wfA, artA, { objective: 'leads' }) },
    });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.json.draft.current_revision, 2);
    assert.notEqual(patched.json.draft.contract_hash, d.contract_hash);
  });

  test('2 tenant isolation 404', async () => {
    const d = await createOk(cookieA, wfA, artA);
    for (const [method, path] of [['GET', `/${d.id}`], ['PATCH', `/${d.id}`], ['POST', `/${d.id}/approve`], ['POST', `/${d.id}/revoke`]]) {
      const body = method === 'GET' ? undefined
        : (path.endsWith('/revoke') ? { reason: 'Cross-tenant revocation must stay hidden' } : approveBody(d));
      const r = await api(method, path, { cookie: cookieB, body });
      assert.equal(r.status, 404, `${method} ${path} ${r.text}`);
      assert.equal(r.json.error, 'not_found');
    }
  });

  test('3-4 non-owner and viaApiKey cannot approve or revoke', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const d = await validateOk(cookieA, d0.id);
    assert.equal(d.status, 'ready_for_approval');
    const marketer = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'marketer' });
    const cookieM = (await login(app.baseUrl, marketer.email, marketer.password)).cookie;
    const r1 = await api('POST', `/${d.id}/approve`, { cookie: cookieM, body: approveBody(d) });
    assert.equal(r1.status, 403, r1.text);
    assert.ok(r1.json.error === 'owner_only' || r1.json.error === 'permission_denied' || r1.json.error === 'forbidden');
    const r2 = await api('POST', `/${d.id}/approve`, { apiKey: true, body: approveBody(d) });
    assert.equal(r2.status, 403, r2.text);
    assert.equal(r2.json.error, 'permission_denied');
    const approved = await api('POST', `/${d.id}/approve`, { cookie: cookieA, body: approveBody(d) });
    assert.equal(approved.status, 200, approved.text);
    const revokeBody = { reason: 'Only an owner session may revoke' };
    const r3 = await api('POST', `/${d.id}/revoke`, { cookie: cookieM, body: revokeBody });
    assert.equal(r3.status, 403, r3.text);
    assert.ok(r3.json.error === 'owner_only' || r3.json.error === 'permission_denied' || r3.json.error === 'forbidden');
    const r4 = await api('POST', `/${d.id}/revoke`, { apiKey: true, body: revokeBody });
    assert.equal(r4.status, 403, r4.text);
    assert.equal(r4.json.error, 'permission_denied');
  });

  test('revoke reason rejects missing, malformed, padded, and overlong values; valid reason persists', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const approved = await api('POST', `/${ready.id}/approve`, { cookie: cookieA, body: approveBody(ready) });
    assert.equal(approved.status, 200, approved.text);
    const invalid = [
      ['missing', {}],
      ['non-string', { reason: 42 }],
      ['empty', { reason: '' }],
      ['whitespace', { reason: '   \t' }],
      ['padded', { reason: ' padded reason ' }],
      ['overlong', { reason: 'x'.repeat(501) }],
    ];
    for (const [label, body] of invalid) {
      const res = await api('POST', `/${ready.id}/revoke`, { cookie: cookieA, body });
      assert.ok(res.status >= 400 && res.status < 500, `${label}: ${res.status} ${res.text}`);
      assert.equal(res.json.error, 'validation_failed', label);
    }
    const reason = 'Campaign owner withdrew publishing consent';
    const revoked = await revokeOk(cookieA, ready.id, reason);
    assert.equal(revoked.status, 'ready_for_approval');
    const row = (await p().query(
      `SELECT revoked_at, revoke_reason
         FROM orchestrator_campaign_publish_approvals
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, approved.json.approval.id]
    )).rows[0];
    assert.ok(row.revoked_at);
    assert.equal(row.revoke_reason, reason);
  });

  test('5-7 snapshot, material invalidate, label does not', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const ap = await api('POST', `/${ready.id}/approve`, { cookie: cookieA, body: approveBody(ready) });
    assert.equal(ap.status, 200, ap.text);
    assert.equal(ap.json.draft.status, 'approved_for_publish');
    const snap = await api('GET', `/${ready.id}/snapshot`, { cookie: cookieA });
    assert.equal(snap.status, 200, snap.text);
    assert.equal(snap.json.object_kind, 'campaign_draft');
    assert.equal(snap.json.status, 'approved_for_publish');
    assert.equal(snap.json.published, false);
    assert.ok(snap.json.snapshot && snap.json.snapshot.contract_hash === ready.contract_hash);
    const label = await api('PATCH', `/${ready.id}`, { cookie: cookieA, body: { label: 'Renamed', notes: 'n' } });
    assert.equal(label.status, 200, label.text);
    assert.equal(label.json.draft.status, 'approved_for_publish');
    assert.ok(label.json.draft.approval_id);
    assert.equal(label.json.draft.label, 'Renamed');
    const mat = await api('PATCH', `/${ready.id}`, {
      cookie: cookieA, body: { contract: validContract(wfA, artA, { objective: 'sales' }) },
    });
    assert.equal(mat.status, 200, mat.text);
    assert.equal(mat.json.draft.status, 'ready_for_approval');
    assert.equal(mat.json.draft.approval_id, null);
    assert.equal(mat.json.draft.current_revision, ready.current_revision + 1);
  });

  test('8-9 expired and revoked cannot authorize', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const ap = await api('POST', `/${ready.id}/approve`, { cookie: cookieA, body: approveBody(ready) });
    assert.equal(ap.status, 200, ap.text);
    await p().query(`ALTER TABLE orchestrator_campaign_drafts DISABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    await p().query(`UPDATE orchestrator_campaign_drafts SET approval_expires_at=now() - interval '1 hour' WHERE tenant_id=$1 AND id=$2`, [tenantA.id, ready.id]);
    await p().query(`ALTER TABLE orchestrator_campaign_drafts ENABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    const got = await api('GET', `/${ready.id}`, { cookie: cookieA });
    assert.equal(got.json.draft.status, 'approval_expired');
    await assert.rejects(() => assertPublishAuthorized(p(), tenantA.id, ready.id), (e) => e.code === 'approval_expired');

    const d1 = await createOk(cookieA, wfA, artA);
    const ready2 = await validateOk(cookieA, d1.id);
    const ap2 = await api('POST', `/${ready2.id}/approve`, { cookie: cookieA, body: approveBody(ready2) });
    assert.equal(ap2.status, 200, ap2.text);
    const rev = await api('POST', `/${ready2.id}/revoke`, {
      cookie: cookieA, body: { reason: 'Approval is no longer valid' },
    });
    assert.equal(rev.status, 200, rev.text);
    assert.equal(rev.json.draft.status, 'ready_for_approval');
    await assert.rejects(
      () => assertPublishAuthorized(p(), tenantA.id, ready2.id),
      (e) => e.code === 'approval_required' || e.code === 'approval_revoked'
    );
  });

  test('10 stale revision/hash; active idempotency replay is preserved', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const staleRev = await api('POST', `/${ready.id}/approve`, { cookie: cookieA, body: approveBody(ready, { revision: ready.current_revision + 9 }) });
    assert.equal(staleRev.status, 409, staleRev.text);
    assert.equal(staleRev.json.error, 'approval_stale');
    const staleHash = await api('POST', `/${ready.id}/approve`, { cookie: cookieA, body: approveBody(ready, { contract_hash: 'b'.repeat(64) }) });
    assert.equal(staleHash.status, 409, staleHash.text);
    assert.equal(staleHash.json.error, 'approval_stale');
    const key = ik('replay');
    const first = await api('POST', `/${ready.id}/approve`, { cookie: cookieA, body: approveBody(ready, { idempotency_key: key }) });
    assert.equal(first.status, 200, first.text);
    const second = await api('POST', `/${ready.id}/approve`, { cookie: cookieA, body: approveBody(ready, { idempotency_key: key }) });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.replay, true);
    assert.equal(second.json.approval.id, first.json.approval.id);
  });

  test('revoked idempotency key conflicts and a new key creates the sole active approval', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const oldKey = ik('old');
    const first = await api('POST', `/${ready.id}/approve`, {
      cookie: cookieA, body: approveBody(ready, { idempotency_key: oldKey }),
    });
    assert.equal(first.status, 200, first.text);
    const activeReplay = await api('POST', `/${ready.id}/approve`, {
      cookie: cookieA, body: approveBody(ready, { idempotency_key: oldKey }),
    });
    assert.equal(activeReplay.status, 200, activeReplay.text);
    assert.equal(activeReplay.json.replay, true);
    assert.equal(activeReplay.json.approval.id, first.json.approval.id);

    await revokeOk(cookieA, ready.id, 'Replace this approval with a fresh decision');
    const revokedReplay = await api('POST', `/${ready.id}/approve`, {
      cookie: cookieA, body: approveBody(ready, { idempotency_key: oldKey }),
    });
    assert.equal(revokedReplay.status, 409, revokedReplay.text);
    assert.equal(revokedReplay.json.error, 'idempotency_conflict');

    const newKey = ik('new');
    const second = await api('POST', `/${ready.id}/approve`, {
      cookie: cookieA, body: approveBody(ready, { idempotency_key: newKey }),
    });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.replay, false);
    assert.notEqual(second.json.approval.id, first.json.approval.id);
    const rows = (await p().query(
      `SELECT id, revoked_at
         FROM orchestrator_campaign_publish_approvals
        WHERE tenant_id=$1 AND draft_id=$2`,
      [tenantA.id, ready.id]
    )).rows;
    assert.equal(rows.length, 2);
    assert.deepStrictEqual(rows.filter((row) => row.revoked_at == null).map((row) => row.id), [second.json.approval.id]);
  });

  test('reapproval retains full reason in history, sanitizes audit detail, and authorizes the new snapshot', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const auditBaseline = Number((await p().query(
      `SELECT COALESCE(MAX(id), 0) AS id
         FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND workflow_id=$2`,
      [tenantA.id, wfA]
    )).rows[0].id);
    const first = await api('POST', `/${ready.id}/approve`, {
      cookie: cookieA, body: approveBody(ready, { idempotency_key: ik('first') }),
    });
    assert.equal(first.status, 200, first.text);
    const fullReason = `Owner review: ${'x'.repeat(140)}`;
    const revoked = await revokeOk(cookieA, ready.id, fullReason);
    assert.equal(revoked.current_revision, ready.current_revision);
    assert.equal(revoked.contract_hash, ready.contract_hash);
    assert.equal(revoked.validation_status, 'passed');

    const second = await api('POST', `/${ready.id}/approve`, {
      cookie: cookieA, body: approveBody(revoked, { idempotency_key: ik('second') }),
    });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.replay, false);
    assert.notEqual(second.json.approval.id, first.json.approval.id);
    assert.equal(second.json.draft.status, 'approved_for_publish');
    assert.equal(second.json.draft.current_revision, ready.current_revision);
    assert.equal(second.json.draft.contract_hash, ready.contract_hash);

    const authorized = await assertPublishAuthorized(p(), tenantA.id, ready.id);
    assert.equal(authorized.ok, true);
    assert.equal(authorized.approval.id, second.json.approval.id);
    const snapshot = await api('GET', `/${ready.id}/snapshot`, { cookie: cookieA });
    assert.equal(snapshot.status, 200, snapshot.text);
    assert.equal(snapshot.json.status, 'approved_for_publish');
    assert.equal(snapshot.json.snapshot.expires_at, second.json.approval.expires_at);
    assert.equal(snapshot.json.draft.approval_id, authorized.approval.workflow_approval_id);

    const history = await api('GET', `/${ready.id}/history`, { cookie: cookieA });
    assert.equal(history.status, 200, history.text);
    assert.equal(history.json.approvals.length, 2);
    assert.equal(history.json.approvals[0].id, first.json.approval.id);
    assert.ok(history.json.approvals[0].revoked_at);
    assert.equal(history.json.approvals[0].revoke_reason, fullReason);
    assert.equal(history.json.approvals[1].id, second.json.approval.id);
    assert.equal(history.json.approvals[1].revoked_at, null);
    const rejected = history.json.audit.filter(
      (row) => Number(row.id) > auditBaseline && row.event === 'approval_rejected'
        && row.detail && row.detail.gate === 'campaign_publishing'
    );
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].detail.revoke_reason, fullReason.slice(0, 120));
    const granted = history.json.audit.filter(
      (row) => Number(row.id) > auditBaseline && row.event === 'approval_granted'
        && row.detail && row.detail.gate === 'campaign_publishing'
    );
    assert.equal(granted.length, 2, 'reapproval must emit a second approval_granted audit event');
  });

  test('13-14 missing creative + credential', async () => {
    const missing = await createOk(cookieA, wfA, { assetId: 'missing-art', version: 1, contentHash: 'c'.repeat(64) });
    const v = await api('POST', `/${missing.id}/validate`, { cookie: cookieA, body: {} });
    assert.equal(v.status, 200, v.text);
    assert.equal(v.json.draft.status, 'validation_failed');
    assert.ok((v.json.draft.validation.errors || []).some((e) => e.code === 'missing_creative'));
    const bad = await api('POST', '', {
      cookie: cookieA,
      body: { workflow_id: wfA, idempotency_key: ik('mc'), contract: validContract(wfA, artA, { accounts: [{ platform: 'meta' }] }) },
    });
    assert.ok(bad.status >= 400, bad.text);
    assert.equal(bad.json.error, 'missing_credentials');
  });

  test('approve fails closed when a previously validated creative or credential becomes unusable', async () => {
    const credentialDraft = await createOk(cookieA, wfA, artA);
    const credentialReady = await validateOk(cookieA, credentialDraft.id);
    await p().query(`UPDATE user_integrations SET status='disconnected' WHERE user_id=$1 AND platform='meta'`, [ownerA.id]);
    try {
      const disconnected = await api('POST', `/${credentialReady.id}/approve`, {
        cookie: cookieA, body: approveBody(credentialReady, { idempotency_key: ik('disconnected') }),
      });
      assert.ok(disconnected.status >= 400 && disconnected.status < 500, disconnected.text);
      assert.equal(disconnected.json.error, 'validation_failed');
      assert.ok((disconnected.json.errors || []).some((e) => e.code === 'missing_credentials'));
    } finally {
      await p().query(`UPDATE user_integrations SET status='connected' WHERE user_id=$1 AND platform='meta'`, [ownerA.id]);
    }

    const disposableArt = await seedBrief(tenantA.id, ownerA.id, wfA);
    const creativeDraft = await createOk(cookieA, wfA, disposableArt);
    const creativeReady = await validateOk(cookieA, creativeDraft.id);
    await p().query(
      `UPDATE orchestrator_creative_artifacts SET status='invalidated' WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, disposableArt.rowId]
    );
    const creativeGone = await api('POST', `/${creativeReady.id}/approve`, {
      cookie: cookieA, body: approveBody(creativeReady, { idempotency_key: ik('creative-gone') }),
    });
    assert.ok(creativeGone.status >= 400 && creativeGone.status < 500, creativeGone.text);
    assert.equal(creativeGone.json.error, 'validation_failed');
    assert.ok((creativeGone.json.errors || []).some((e) => e.code === 'missing_creative'));
  });

  test('concurrent material edit makes an approval of the old revision stale', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const [edit, approve] = await Promise.all([
      api('PATCH', `/${ready.id}`, {
        cookie: cookieA,
        body: { contract: validContract(wfA, artA, { objective: 'sales' }) },
      }),
      api('POST', `/${ready.id}/approve`, {
        cookie: cookieA,
        body: approveBody(ready, { idempotency_key: ik('concurrent-stale') }),
      }),
    ]);
    assert.equal(edit.status, 200, edit.text);
    assert.ok([200, 409].includes(approve.status), approve.text);
    if (approve.status === 409) {
      assert.ok(['approval_stale', 'approval_required'].includes(approve.json.error), approve.text);
    }
    const current = await api('GET', `/${ready.id}`, { cookie: cookieA });
    assert.equal(current.status, 200, current.text);
    assert.equal(current.json.draft.current_revision, ready.current_revision + 1);
    assert.notEqual(current.json.draft.contract_hash, ready.contract_hash);
    assert.notEqual(current.json.draft.status, 'approved_for_publish');
    await assert.rejects(
      () => assertPublishAuthorized(p(), tenantA.id, ready.id),
      (e) => e.code === 'approval_required'
    );
  });

  test('parallel approvals have bounded outcomes and create exactly one active row', async () => {
    const d0 = await createOk(cookieA, wfA, artA);
    const ready = await validateOk(cookieA, d0.id);
    const responses = await Promise.all([
      api('POST', `/${ready.id}/approve`, {
        cookie: cookieA, body: approveBody(ready, { idempotency_key: ik('parallel-a') }),
      }),
      api('POST', `/${ready.id}/approve`, {
        cookie: cookieA, body: approveBody(ready, { idempotency_key: ik('parallel-b') }),
      }),
    ]);
    assert.ok(responses.every((res) => [200, 409].includes(res.status)), responses.map((res) => res.text).join('\n'));
    const accepted = responses.filter((res) => res.status === 200);
    assert.ok(accepted.length >= 1 && accepted.length <= 2);
    assert.equal(new Set(accepted.map((res) => res.json.approval.id)).size, 1);
    for (const res of responses.filter((item) => item.status === 409)) {
      assert.ok(['approval_required', 'idempotency_conflict'].includes(res.json.error), res.text);
    }
    const rows = (await p().query(
      `SELECT id, revoked_at
         FROM orchestrator_campaign_publish_approvals
        WHERE tenant_id=$1 AND draft_id=$2`,
      [tenantA.id, ready.id]
    )).rows;
    assert.equal(rows.length, 1, 'parallel requests must not create duplicate approval rows');
    assert.equal(rows.filter((row) => row.revoked_at == null).length, 1);
    assert.equal(rows[0].id, accepted[0].json.approval.id);
  });
}
