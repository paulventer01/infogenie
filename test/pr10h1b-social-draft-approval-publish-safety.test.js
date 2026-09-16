// test/pr10h1b-social-draft-approval-publish-safety.test.js — PR-1b (CR-058–CR-061)
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { contentHash } = require('../services/social_drafts/publish_approval');
const {
  PROHIBITED,
  SAFE_TEXT,
  captionWithProhibitedSuffix,
  altWithProhibitedSuffix,
  mountApp,
  listen,
  jsonFetch,
} = require('./helpers/social-draft-safety-app');

async function createDraft(server, tid, body = {}) {
  const r = await jsonFetch(server, 'POST', '/api/social-drafts', {
    tid,
    body: {
      profileId: 'p1',
      text: SAFE_TEXT,
      platforms: ['instagram'],
      ...body,
    },
  });
  assert.equal(r.status, 200);
  return r.body.draft;
}

function seedDraft(draftsRouter, tid, fields = {}) {
  return draftsRouter._createForTenant(tid, {
    profile_id: 'p1',
    status: 'draft',
    text: SAFE_TEXT,
    platforms: ['instagram'],
    media_urls: [],
    meta: {},
    ...fields,
  });
}

describe('PR-1b scope — social draft approval/publish gates (CR-058–CR-061)', () => {
  it('documents gated routes in social_drafts api', () => {
    const src = fs.readFileSync(require.resolve('../services/social_drafts/api'), 'utf8');
    const doc = fs.readFileSync(require.resolve('../docs/step6-content-safety-coverage.md'), 'utf8');
    for (const pattern of [
      /social-drafts:self-heal/,
      /social-drafts:submit-approval/,
      /social-drafts:approve/,
      /social-drafts:publish/,
      /_releasePublishingClaim/,
      /contentSafetyHttpBody/,
    ]) assert.match(src, pattern);
    assert.match(doc, /Status:\*\* Partial/);
    assert.match(doc, /CR-058.*covered/);
    assert.match(doc, /CR-062.*gap/);
  });
});

describe('PR-1b social draft self-heal gate (CR-058)', () => {
  let server;
  let draftsRouter;
  let selfHealPath;
  let realSelfHeal;

  before(async () => {
    ({ app: server, draftsRouter } = mountApp());
    server = await listen(server);
    selfHealPath = require.resolve('../services/social_drafts/self_heal');
    realSelfHeal = require(selfHealPath).selfHealDraft;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (realSelfHeal) require(selfHealPath).selfHealDraft = realSelfHeal;
    delete require.cache[require.resolve('../services/social_drafts/api')];
  });

  beforeEach(() => {
    draftsRouter._resetMem();
    require(selfHealPath).selfHealDraft = realSelfHeal;
  });

  it('blocks prohibited healed copy without persisting changes', async () => {
    require(selfHealPath).selfHealDraft = async () => ({
      ok: false,
      passed: false,
      text: PROHIBITED,
      final_verdict: 'fail',
      attempts: [{ attempt: 1, verdict: 'fail' }],
    });
    const draft = await createDraft(server, 11, { text: 'guaranteed results with risk' });
    const before = await jsonFetch(server, 'GET', `/api/social-drafts/${draft.id}`);
    const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/self-heal`, {});
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    const after = await jsonFetch(server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(after.body.draft.text, before.body.draft.text);
  });

  it('returns 503 when gate is unavailable and does not save healed text', async () => {
    require(selfHealPath).selfHealDraft = async () => ({
      ok: true,
      passed: true,
      text: 'Healed benign caption.',
      final_verdict: 'pass',
      attempts: [],
    });
    const gatePath = require.resolve('../services/ai_governance/route_gate');
    const gateCached = require.cache[gatePath];
    const realGate = gateCached.exports.gateRouteText;
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
    });
    delete require.cache[require.resolve('../services/social_drafts/api')];
    const { app: tmpApp, draftsRouter: tmpRouter } = mountApp();
    const tmpServer = await listen(tmpApp);
    try {
      const draft = await seedDraft(tmpRouter, 11);
      const r = await jsonFetch(tmpServer, 'POST', `/api/social-drafts/${draft.id}/self-heal`, {});
      assert.equal(r.status, 503);
      assert.equal(r.body.draft, undefined);
      const got = await jsonFetch(tmpServer, 'GET', `/api/social-drafts/${draft.id}`);
      assert.equal(got.body.draft.text, SAFE_TEXT);
    } finally {
      await new Promise((res) => tmpServer.close(res));
      gateCached.exports.gateRouteText = realGate;
      delete require.cache[require.resolve('../services/social_drafts/api')];
    }
  });

  it('persists warning-only healed copy', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({ ...defaultPolicy(tid), content_safety_mode: 'warning_only', content_safety_explicit: true });
    require(selfHealPath).selfHealDraft = async () => ({
      ok: true,
      passed: true,
      text: PROHIBITED,
      final_verdict: 'pass',
      attempts: [],
    });
    try {
      const draft = await createDraft(server, 11);
      const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/self-heal`, {});
      assert.equal(r.status, 200);
      assert.ok((r.body.content_safety_warnings || r.body.draft?.content_safety_warnings || []).length >= 1);
      const got = await jsonFetch(server, 'GET', `/api/social-drafts/${draft.id}`);
      assert.ok((got.body.draft.content_safety_warnings || []).length >= 1);
      assert.equal(got.body.draft.text, PROHIBITED);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});

describe('PR-1b social draft submit-approval gate (CR-059)', () => {
  let server;
  let draftsRouter;

  before(async () => {
    ({ app: server, draftsRouter } = mountApp());
    server = await listen(server);
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[require.resolve('../services/social_drafts/api')];
  });

  beforeEach(() => draftsRouter._resetMem());

  it('blocks submit without status change or approval row', async () => {
    const draft = await seedDraft(draftsRouter, 11, { text: PROHIBITED });
    const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
      body: { skip_self_heal: true },
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    const got = await jsonFetch(server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(got.body.draft.status, 'draft');
  });

  it('self_heal_failed returns sanitized payload without draft copy', async () => {
    const selfHealPath = require.resolve('../services/social_drafts/self_heal');
    const realSelfHeal = require(selfHealPath).selfHealDraft;
    require(selfHealPath).selfHealDraft = async () => ({
      ok: false,
      passed: false,
      text: PROHIBITED,
      final_verdict: 'fail',
      attempts: [{ attempt: 1, verdict: 'fail', text_preview: PROHIBITED }],
    });
    const draft = await seedDraft(draftsRouter, 11, { text: 'guaranteed results' });
    const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {});
    require(selfHealPath).selfHealDraft = realSelfHeal;
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    assert.equal(r.body.self_heal?.text, undefined);
    const got = await jsonFetch(server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(got.body.draft.status, 'draft');
  });

  it('gates healed copy before pending_approval', async () => {
    const selfHealPath = require.resolve('../services/social_drafts/self_heal');
    const realSelfHeal = require(selfHealPath).selfHealDraft;
    require(selfHealPath).selfHealDraft = async () => ({
      ok: true,
      passed: true,
      text: PROHIBITED,
      final_verdict: 'pass',
      attempts: [],
    });
    const draft = await createDraft(server, 11, { text: 'needs heal' });
    const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {});
    require(selfHealPath).selfHealDraft = realSelfHeal;
    assert.equal(r.status, 403);
    const got = await jsonFetch(server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(got.body.draft.status, 'draft');
    assert.notEqual(got.body.draft.text, PROHIBITED);
  });

  it('submits with warnings persisted on success', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({ ...defaultPolicy(tid), content_safety_mode: 'warning_only', content_safety_explicit: true });
    try {
      const draft = await seedDraft(draftsRouter, 11, { text: PROHIBITED });
      const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
        body: { skip_self_heal: true },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.draft.status, 'pending_approval');
      assert.ok((r.body.draft.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});

describe('PR-1b social draft approve/publish gates (CR-060–CR-061)', () => {
  let server;
  let draftsRouter;
  let prevKey;

  before(async () => {
    ({ app: server, draftsRouter } = mountApp());
    server = await listen(server);
    prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
    else process.env.ZERNIO_API_KEY = prevKey;
    delete require.cache[require.resolve('../services/social_drafts/api')];
  });

  beforeEach(() => {
    draftsRouter._resetMem();
    process.env.ZERNIO_API_KEY = 'test-key-live';
  });

  async function pendingDraft(tid, text = SAFE_TEXT) {
    const draft = await createDraft(server, tid, { text });
    const sub = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
      tid,
      body: { skip_self_heal: true },
    });
    assert.equal(sub.status, 200);
    return sub.body.draft;
  }

  it('approve blocks prohibited copy with zero provider calls', async () => {
    let publishCalls = 0;
    const origPublish = draftsRouter._publishViaZernio;
    draftsRouter._publishViaZernio = async () => { publishCalls += 1; return { ok: true, post: { id: 'z' } }; };
    const draft = await pendingDraft(21);
    await draftsRouter._updateDraft(21, draft.id, { text: PROHIBITED });
    const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 21 });
    draftsRouter._publishViaZernio = origPublish;
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    assert.equal(publishCalls, 0);
    const got = await draftsRouter._getDraft(21, draft.id);
    assert.equal(got.status, 'pending_approval');
    assert.equal(got.meta?.publishing_claim, undefined);
  });

  it('publish blocks without provider call and releases claim', async () => {
    let publishCalls = 0;
    const origPublish = draftsRouter._publishViaZernio;
    draftsRouter._publishViaZernio = async () => { publishCalls += 1; return { ok: true, post: { id: 'z' } }; };
    const draft = await seedDraft(draftsRouter, 22, { text: PROHIBITED });
    const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/publish`, { tid: 22 });
    draftsRouter._publishViaZernio = origPublish;
    assert.equal(r.status, 403);
    assert.equal(publishCalls, 0);
    const got = await draftsRouter._getDraft(22, draft.id);
    assert.equal(got.status, 'draft');
    assert.equal(got.meta?.publishing_claim, undefined);
  });

  it('approve publishes safe copy once with warnings persisted', async () => {
    let publishCalls = 0;
    const origPublish = draftsRouter._publishViaZernio;
    draftsRouter._publishViaZernio = async () => { publishCalls += 1; return { ok: true, post: { id: 'z-safe' } }; };
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({ ...defaultPolicy(tid), content_safety_mode: 'warning_only', content_safety_explicit: true });
    try {
      const draft = await pendingDraft(23, PROHIBITED);
      const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 23 });
      assert.equal(r.status, 200);
      assert.equal(publishCalls, 1);
      assert.ok((r.body.draft?.content_safety_warnings || r.body.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
      draftsRouter._publishViaZernio = origPublish;
    }
  });

  it('rejects cross-tenant approve and publish', async () => {
    const draft = await pendingDraft(24);
    const approveOther = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 99 });
    assert.equal(approveOther.status, 400);
    const publishOther = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/publish`, { tid: 99 });
    assert.equal(publishOther.status, 404);
  });

  it('blocks publish when concurrent edit invalidates approval hash', async () => {
    let publishCalls = 0;
    const origPublish = draftsRouter._publishViaZernio;
    draftsRouter._publishViaZernio = async () => {
      publishCalls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, post: { id: 'z-race' } };
    };
    const draft = await pendingDraft(25);
    const origUpdate = draftsRouter._updateDraft;
    draftsRouter._updateDraft = async (tid, id, patch) => {
      if (patch?.meta?.publishing_claim) {
        return origUpdate(tid, id, { text: 'Tampered during claim' });
      }
      return origUpdate(tid, id, patch);
    };
    try {
      const r = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 25 });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'approval_stale');
      assert.equal(publishCalls, 0);
    } finally {
      draftsRouter._updateDraft = origUpdate;
      draftsRouter._publishViaZernio = origPublish;
    }
  });

  it('scans secondary alt fields and oversized captions', async () => {
    const oversized = await seedDraft(draftsRouter, 26, { text: `${'x'.repeat(100_001)} benign tail` });
    const oversizedRes = await jsonFetch(server, 'POST', `/api/social-drafts/${oversized.id}/publish`, { tid: 26 });
    assert.equal(oversizedRes.status, 400);
    assert.equal(oversizedRes.body.error, 'content_too_long');

    const altBlocked = await seedDraft(draftsRouter, 26, { text: SAFE_TEXT, meta: { alt_text: PROHIBITED } });
    const altRes = await jsonFetch(server, 'POST', `/api/social-drafts/${altBlocked.id}/publish`, { tid: 26 });
    assert.equal(altRes.status, 403);

    const mediaAlt = await seedDraft(draftsRouter, 26, { text: SAFE_TEXT, meta: { media_alt: altWithProhibitedSuffix() } });
    const mediaAltRes = await jsonFetch(server, 'POST', `/api/social-drafts/${mediaAlt.id}/publish`, { tid: 26 });
    assert.ok([400, 403].includes(mediaAltRes.status));
  });

  it('parallel submit retains one pending_approval write under version locking', async () => {
    const draft = await seedDraft(draftsRouter, 28, { text: SAFE_TEXT });
    const results = await Promise.all([
      jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
        tid: 28,
        body: { skip_self_heal: true },
      }),
      jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
        tid: 28,
        body: { skip_self_heal: true },
      }),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    const loser = results.find((r) => r.status !== 200);
    assert.ok(loser);
    assert.ok([400, 409].includes(loser.status));
    const got = await draftsRouter._getDraft(28, draft.id);
    assert.equal(got.status, 'pending_approval');
    assert.equal(got.text, SAFE_TEXT);
  });

  it('self-heal write rejects stale snapshot after concurrent edit', async () => {
    const selfHealPath = require.resolve('../services/social_drafts/self_heal');
    const realSelfHeal = require(selfHealPath).selfHealDraft;
    require(selfHealPath).selfHealDraft = async () => ({
      ok: true,
      passed: true,
      text: 'Healed caption text.',
      final_verdict: 'pass',
      attempts: [],
    });
    const draft = await seedDraft(draftsRouter, 29, { text: SAFE_TEXT });
    const snapshot = await draftsRouter._getDraft(29, draft.id);
    await draftsRouter._updateDraft(29, draft.id, { text: 'Edited before heal write' });
    const write = await draftsRouter._updateDraftAtVersion(29, draft.id, snapshot, {
      text: 'Healed caption text.',
      content_safety_warnings: [],
    }, { requireStatuses: ['draft', 'approved'] });
    require(selfHealPath).selfHealDraft = realSelfHeal;
    assert.equal(write.ok, false);
    assert.equal(write.error, 'conflict');
    const got = await draftsRouter._getDraft(29, draft.id);
    assert.equal(got.text, 'Edited before heal write');
  });

  it('duplicate concurrent publish retains single provider call', async () => {
    let publishCalls = 0;
    const origPublish = draftsRouter._publishViaZernio;
    draftsRouter._publishViaZernio = async () => {
      publishCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, post: { id: 'z-dup' } };
    };
    const draft = await pendingDraft(27);
    const results = await Promise.all([
      jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 27 }),
      jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 27 }),
    ]);
    draftsRouter._publishViaZernio = origPublish;
    assert.equal(publishCalls, 1);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });
});

const PG_URL = process.env.DATABASE_URL || '';
const PG_REQUIRED = process.env.PR10H1_REQUIRE_INTEGRATION === '1';
const pgSkip = !PG_URL ? (PG_REQUIRED ? false : 'no DATABASE_URL') : false;

describe('PR-1b social draft publish safety postgres', { skip: pgSkip }, () => {
  let db;
  let server;
  let tenantId;
  let realGate;
  let gateCached;
  let draftId;
  const fixtureTag = `pr10h1b-pub-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  before(async () => {
    assert.ok(PG_URL, 'DATABASE_URL is required when PR10H1_REQUIRE_INTEGRATION=1');
    for (const mod of ['../db', '../services/tenants/schema', '../services/social_drafts/schema', '../services/social_drafts/api', '../services/tenants/context']) {
      delete require.cache[require.resolve(mod)];
    }
    db = require('../db');
    await require('../services/tenants/schema').ensureTenantSchema();
    await require('../services/social_drafts/schema').ensureSocialDraftsSchema();
    tenantId = (await db.getPool().query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
      [`PR10H1B ${fixtureTag}`, fixtureTag],
    )).rows[0].id;
    require('../services/tenants/context').resolveTenantId = async (req) => Number(req.headers['x-test-tid'] || tenantId);
    process.env.ZERNIO_API_KEY = 'test-key-live';
    server = await listen(mountApp({ useDb: true }).app);

    const created = await jsonFetch(server, 'POST', '/api/social-drafts', {
      tid: tenantId,
      body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['linkedin'] },
    });
    assert.equal(created.status, 200);
    assert.ok(created.body.draft?.id);
    draftId = created.body.draft.id;
    const submitted = await jsonFetch(server, 'POST', `/api/social-drafts/${draftId}/submit-approval`, {
      tid: tenantId,
      body: { skip_self_heal: true },
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.draft.status, 'pending_approval');

    const gatePath = require.resolve('../services/ai_governance/route_gate');
    gateCached = require.cache[gatePath];
    realGate = gateCached.exports.gateRouteText;
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'blocked',
    });
    delete require.cache[require.resolve('../services/social_drafts/api')];
    server = await listen(mountApp({ useDb: true }).app);
  });

  after(async () => {
    if (gateCached && realGate) gateCached.exports.gateRouteText = realGate;
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[require.resolve('../services/social_drafts/api')];
    if (!PG_URL || !tenantId) return;
    const p = db.getPool();
    await p.query('DELETE FROM approval_requests WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await p.query('DELETE FROM social_post_drafts WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await p.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
  });

  it('leaves no publishing claim after safety-blocked approve', async () => {
    const draftsRouter = require('../services/social_drafts/api');
    let publishCalls = 0;
    const origPublish = draftsRouter._publishViaZernio;
    draftsRouter._publishViaZernio = async () => { publishCalls += 1; return { ok: true, post: { id: 'z-pg' } }; };
    const blocked = await jsonFetch(server, 'POST', `/api/social-drafts/${draftId}/approve`, { tid: tenantId });
    draftsRouter._publishViaZernio = origPublish;
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.draft, undefined);
    assert.equal(publishCalls, 0);
    const row = (await db.getPool().query(
      `SELECT status, meta FROM social_post_drafts WHERE id=$1 AND tenant_id=$2`,
      [draftId, tenantId],
    )).rows[0];
    assert.equal(row.status, 'pending_approval');
    assert.equal(row.meta?.publishing_claim || null, null);
  });

  it('parallel submit-approval retains a single pending row under postgres locking', async () => {
    const row = (await db.getPool().query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'draft',$3,'[]'::jsonb,$4::jsonb,'{}'::jsonb)
       RETURNING id`,
      [tenantId, 'p1', SAFE_TEXT, JSON.stringify(['linkedin'])],
    )).rows[0];
    gateCached.exports.gateRouteText = async () => ({ ok: true, warnings: [] });
    delete require.cache[require.resolve('../services/social_drafts/api')];
    const openServer = await listen(mountApp({ useDb: true }).app);
    try {
      const results = await Promise.all([
        jsonFetch(openServer, 'POST', `/api/social-drafts/${row.id}/submit-approval`, {
          tid: tenantId,
          body: { skip_self_heal: true },
        }),
        jsonFetch(openServer, 'POST', `/api/social-drafts/${row.id}/submit-approval`, {
          tid: tenantId,
          body: { skip_self_heal: true },
        }),
      ]);
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      const loser = results.find((r) => r.status !== 200);
      assert.ok(loser);
      assert.ok([400, 409].includes(loser.status));
      const finalRow = (await db.getPool().query(
        `SELECT status, text FROM social_post_drafts WHERE id=$1 AND tenant_id=$2`,
        [row.id, tenantId],
      )).rows[0];
      assert.equal(finalRow.status, 'pending_approval');
      assert.equal(finalRow.text, SAFE_TEXT);
    } finally {
      gateCached.exports.gateRouteText = async () => ({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'blocked',
      });
      delete require.cache[require.resolve('../services/social_drafts/api')];
      await new Promise((r) => openServer.close(r));
    }
  });

  it('leaves no claim and zero provider calls when approve gate is unavailable', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
    });
    delete require.cache[require.resolve('../services/social_drafts/api')];
    const tmpServer = await listen(mountApp({ useDb: true }).app);
    const draftsRouter = require('../services/social_drafts/api');
    let publishCalls = 0;
    const origPublish = draftsRouter._publishViaZernio;
    draftsRouter._publishViaZernio = async () => { publishCalls += 1; return { ok: true, post: { id: 'z-unavail' } }; };
    try {
      const unavailable = await jsonFetch(tmpServer, 'POST', `/api/social-drafts/${draftId}/approve`, { tid: tenantId });
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.body.draft, undefined);
      assert.equal(publishCalls, 0);
      const row = (await db.getPool().query(
        `SELECT status, meta FROM social_post_drafts WHERE id=$1 AND tenant_id=$2`,
        [draftId, tenantId],
      )).rows[0];
      assert.equal(row.status, 'pending_approval');
      assert.equal(row.meta?.publishing_claim || null, null);
    } finally {
      draftsRouter._publishViaZernio = origPublish;
      await new Promise((r) => tmpServer.close(r));
      gateCached.exports.gateRouteText = async () => ({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'blocked',
      });
      delete require.cache[require.resolve('../services/social_drafts/api')];
    }
  });
});
