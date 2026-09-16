// test/pr10h1b-social-draft-approval-publish-safety.test.js — PR-1b (CR-058–CR-061)
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {
  PROHIBITED,
  SAFE_TEXT,
  altWithProhibitedSuffix,
  mountApp,
  listen,
  jsonFetch,
  createDraft,
  seedDraft,
  pendingDraft,
  setSelfHeal,
  failSelfHeal,
  passSelfHeal,
  withWarningOnlyPolicy,
  withGateMock,
  withStubPublish,
  GATE_UNAVAILABLE,
  GATE_BLOCKED,
  assertApproveSafetyHold,
  setupPr10h1bPostgres,
  pgDraftRow,
  assertParallelSubmitWinner,
  mountMemServer,
  realSelfHeal,
  restoreSelfHeal,
} = require('./helpers/social-draft-safety-app');

const memCtx = {};
before(async () => {
  memCtx.mem = await mountMemServer();
  memCtx.realHeal = realSelfHeal();
  memCtx.prevKey = process.env.ZERNIO_API_KEY;
  process.env.ZERNIO_API_KEY = 'test-key-live';
});
after(async () => {
  restoreSelfHeal(memCtx.realHeal);
  if (memCtx.prevKey === undefined) delete process.env.ZERNIO_API_KEY;
  else process.env.ZERNIO_API_KEY = memCtx.prevKey;
  await memCtx.mem.close();
  delete require.cache[require.resolve('../services/social_drafts/api')];
});
beforeEach(() => {
  memCtx.mem.draftsRouter._resetMem();
  restoreSelfHeal(memCtx.realHeal);
  process.env.ZERNIO_API_KEY = 'test-key-live';
});

describe('PR-1b scope — social draft approval/publish gates (CR-058–CR-061)', () => {
  it('documents gated routes and Step 6 partial coverage (CR-062 deferred)', () => {
    const src = fs.readFileSync(require.resolve('../services/social_drafts/api'), 'utf8');
    const doc = fs.readFileSync(require.resolve('../docs/step6-content-safety-coverage.md'), 'utf8');
    [/social-drafts:self-heal/, /social-drafts:submit-approval/, /social-drafts:approve/, /social-drafts:publish/, /_releasePublishingClaim/, /contentSafetyHttpBody/]
      .forEach((pattern) => assert.match(src, pattern));
    assert.match(doc, /Status:\*\* Partial/);
    assert.match(doc, /CR-058.*covered/);
    assert.match(doc, /CR-062.*gap/);
  });
});
describe('PR-1b social draft self-heal gate (CR-058)', () => {
  it('blocks prohibited healed copy without persisting changes', async () => {
    setSelfHeal(async () => failSelfHeal());
    const draft = await createDraft(memCtx.mem.server, 11, { text: 'guaranteed results with risk' });
    const before = await jsonFetch(memCtx.mem.server, 'GET', `/api/social-drafts/${draft.id}`);
    const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/self-heal`, {});
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    const after = await jsonFetch(memCtx.mem.server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(after.body.draft.text, before.body.draft.text);
  });

  it('returns 503 when gate is unavailable and does not save healed text', async () => {
    setSelfHeal(async () => passSelfHeal('Healed benign caption.'));
    await withGateMock(async () => GATE_UNAVAILABLE, async () => {
      const { app, draftsRouter } = mountApp();
      const tmpServer = await listen(app);
      try {
        const draft = await seedDraft(draftsRouter, 11);
        const r = await jsonFetch(tmpServer, 'POST', `/api/social-drafts/${draft.id}/self-heal`, {});
        assert.equal(r.status, 503);
        assert.equal(r.body.draft, undefined);
        const got = await jsonFetch(tmpServer, 'GET', `/api/social-drafts/${draft.id}`);
        assert.equal(got.body.draft.text, SAFE_TEXT);
      } finally {
        await new Promise((res) => tmpServer.close(res));
      }
    });
  });

  it('persists warning-only healed copy', async () => {
    setSelfHeal(async () => passSelfHeal(PROHIBITED));
    await withWarningOnlyPolicy(async () => {
      const draft = await createDraft(memCtx.mem.server, 11);
      const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/self-heal`, {});
      assert.equal(r.status, 200);
      assert.ok((r.body.content_safety_warnings || r.body.draft?.content_safety_warnings || []).length >= 1);
      const got = await jsonFetch(memCtx.mem.server, 'GET', `/api/social-drafts/${draft.id}`);
      assert.ok((got.body.draft.content_safety_warnings || []).length >= 1);
      assert.equal(got.body.draft.text, PROHIBITED);
    });
  });
});

describe('PR-1b social draft submit-approval gate (CR-059)', () => {
  it('blocks submit without status change or approval row', async () => {
    const draft = await seedDraft(memCtx.mem.draftsRouter, 11, { text: PROHIBITED });
    const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
      body: { skip_self_heal: true },
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    const got = await jsonFetch(memCtx.mem.server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(got.body.draft.status, 'draft');
  });

  it('self_heal_failed returns sanitized payload without draft copy', async () => {
    setSelfHeal(async () => failSelfHeal());
    const draft = await seedDraft(memCtx.mem.draftsRouter, 11, { text: 'guaranteed results' });
    const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {});
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    assert.equal(r.body.self_heal?.text, undefined);
    const got = await jsonFetch(memCtx.mem.server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(got.body.draft.status, 'draft');
  });

  it('gates healed copy before pending_approval', async () => {
    setSelfHeal(async () => passSelfHeal(PROHIBITED));
    const draft = await createDraft(memCtx.mem.server, 11, { text: 'needs heal' });
    const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {});
    assert.equal(r.status, 403);
    const got = await jsonFetch(memCtx.mem.server, 'GET', `/api/social-drafts/${draft.id}`);
    assert.equal(got.body.draft.status, 'draft');
    assert.notEqual(got.body.draft.text, PROHIBITED);
  });

  it('submits with warnings persisted on success', async () => {
    await withWarningOnlyPolicy(async () => {
      const draft = await seedDraft(memCtx.mem.draftsRouter, 11, { text: PROHIBITED });
      const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
        body: { skip_self_heal: true },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.draft.status, 'pending_approval');
      assert.ok((r.body.draft.content_safety_warnings || []).length >= 1);
    });
  });
});

describe('PR-1b social draft approve/publish gates (CR-060–CR-061)', () => {
  it('approve blocks prohibited copy with zero provider calls', async () => {
    await withStubPublish(memCtx.mem.draftsRouter, async () => ({ ok: true, post: { id: 'z' } }), async (publish) => {
      const draft = await pendingDraft(memCtx.mem.server, 21);
      await memCtx.mem.draftsRouter._updateDraft(21, draft.id, { text: PROHIBITED });
      const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 21 });
      assert.equal(r.status, 403);
      assert.equal(r.body.draft, undefined);
      assert.equal(publish.calls, 0);
      const got = await memCtx.mem.draftsRouter._getDraft(21, draft.id);
      assert.equal(got.status, 'pending_approval');
      assert.equal(got.meta?.publishing_claim, undefined);
    });
  });

  it('publish blocks without provider call and releases claim', async () => {
    await withStubPublish(memCtx.mem.draftsRouter, async () => ({ ok: true, post: { id: 'z' } }), async (publish) => {
      const draft = await seedDraft(memCtx.mem.draftsRouter, 22, { text: PROHIBITED });
      const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/publish`, { tid: 22 });
      assert.equal(r.status, 403);
      assert.equal(publish.calls, 0);
      const got = await memCtx.mem.draftsRouter._getDraft(22, draft.id);
      assert.equal(got.status, 'draft');
      assert.equal(got.meta?.publishing_claim, undefined);
    });
  });

  it('approve publishes safe copy once with warnings persisted', async () => {
    await withStubPublish(memCtx.mem.draftsRouter, async () => ({ ok: true, post: { id: 'z-safe' } }), async (publish) => {
      await withWarningOnlyPolicy(async () => {
        const draft = await pendingDraft(memCtx.mem.server, 23, PROHIBITED);
        const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 23 });
        assert.equal(r.status, 200);
        assert.equal(publish.calls, 1);
        assert.ok((r.body.draft?.content_safety_warnings || r.body.content_safety_warnings || []).length >= 1);
      });
    });
  });

  it('rejects cross-tenant approve and publish', async () => {
    const draft = await pendingDraft(memCtx.mem.server, 24);
    assert.equal((await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 99 })).status, 400);
    assert.equal((await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/publish`, { tid: 99 })).status, 404);
  });

  it('blocks publish when concurrent edit invalidates approval hash', async () => {
    await withStubPublish(memCtx.mem.draftsRouter, async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, post: { id: 'z-race' } };
    }, async (publish) => {
      const draft = await pendingDraft(memCtx.mem.server, 25);
      const origUpdate = memCtx.mem.draftsRouter._updateDraft;
      memCtx.mem.draftsRouter._updateDraft = async (tid, id, patch) => {
        if (patch?.meta?.publishing_claim) return origUpdate(tid, id, { text: 'Tampered during claim' });
        return origUpdate(tid, id, patch);
      };
      try {
        const r = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 25 });
        assert.equal(r.status, 400);
        assert.equal(r.body.error, 'approval_stale');
        assert.equal(publish.calls, 0);
      } finally {
        memCtx.mem.draftsRouter._updateDraft = origUpdate;
      }
    });
  });

  it('scans secondary alt fields and oversized captions', async () => {
    const oversized = await seedDraft(memCtx.mem.draftsRouter, 26, { text: `${'x'.repeat(100_001)} benign tail` });
    const oversizedRes = await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${oversized.id}/publish`, { tid: 26 });
    assert.equal(oversizedRes.status, 400);
    assert.equal(oversizedRes.body.error, 'content_too_long');

    const altBlocked = await seedDraft(memCtx.mem.draftsRouter, 26, { text: SAFE_TEXT, meta: { alt_text: PROHIBITED } });
    assert.equal((await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${altBlocked.id}/publish`, { tid: 26 })).status, 403);

    const mediaAlt = await seedDraft(memCtx.mem.draftsRouter, 26, { text: SAFE_TEXT, meta: { media_alt: altWithProhibitedSuffix() } });
    assert.ok([400, 403].includes((await jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${mediaAlt.id}/publish`, { tid: 26 })).status));
  });

  it('parallel submit retains one pending_approval write under version locking', async () => {
    const draft = await seedDraft(memCtx.mem.draftsRouter, 28, { text: SAFE_TEXT });
    const results = await Promise.all([
      jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, { tid: 28, body: { skip_self_heal: true } }),
      jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, { tid: 28, body: { skip_self_heal: true } }),
    ]);
    assertParallelSubmitWinner(results);
    const got = await memCtx.mem.draftsRouter._getDraft(28, draft.id);
    assert.equal(got.status, 'pending_approval');
    assert.equal(got.text, SAFE_TEXT);
  });

  it('self-heal write rejects stale snapshot after concurrent edit', async () => {
    setSelfHeal(async () => passSelfHeal('Healed caption text.'));
    const draft = await seedDraft(memCtx.mem.draftsRouter, 29, { text: SAFE_TEXT });
    const snapshot = await memCtx.mem.draftsRouter._getDraft(29, draft.id);
    await memCtx.mem.draftsRouter._updateDraft(29, draft.id, { text: 'Edited before heal write' });
    const write = await memCtx.mem.draftsRouter._updateDraftAtVersion(29, draft.id, snapshot, {
      text: 'Healed caption text.',
      content_safety_warnings: [],
    }, { requireStatuses: ['draft', 'approved'] });
    assert.equal(write.ok, false);
    assert.equal(write.error, 'conflict');
    assert.equal((await memCtx.mem.draftsRouter._getDraft(29, draft.id)).text, 'Edited before heal write');
  });

  it('duplicate concurrent publish retains single provider call', async () => {
    await withStubPublish(memCtx.mem.draftsRouter, async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, post: { id: 'z-dup' } };
    }, async (publish) => {
      const draft = await pendingDraft(memCtx.mem.server, 27);
      const results = await Promise.all([
        jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 27 }),
        jsonFetch(memCtx.mem.server, 'POST', `/api/social-drafts/${draft.id}/approve`, { tid: 27 }),
      ]);
      assert.equal(publish.calls, 1);
      assert.equal(results.filter((r) => r.status === 200).length, 1);
    });
  });
});

const PG_URL = process.env.DATABASE_URL || '';
const PG_REQUIRED = process.env.PR10H1_REQUIRE_INTEGRATION === '1';
const pgSkip = !PG_URL ? (PG_REQUIRED ? false : 'no DATABASE_URL') : false;

describe('PR-1b social draft publish safety postgres', { skip: pgSkip }, () => {
  let fx;

  before(async () => {
    fx = await setupPr10h1bPostgres(`pr10h1b-pub-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  });

  after(async () => {
    if (fx) await fx.cleanup();
  });

  it('leaves no publishing claim after safety-blocked approve', async () => {
    await assertApproveSafetyHold(fx, { status: 403, server: fx.server });
  });

  it('postgres versioned submit write rejects stale updated_at', async () => {
    const row = (await fx.db.getPool().query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'draft',$3,'[]'::jsonb,$4::jsonb,'{}'::jsonb)
       RETURNING *`,
      [fx.tenantId, 'p1', SAFE_TEXT, JSON.stringify(['linkedin'])],
    )).rows[0];
    fx.setGate(async () => ({ ok: true, warnings: [] }));
    const draftsRouter = require('../services/social_drafts/api');
    const snapshot = await draftsRouter._getDraft(fx.tenantId, row.id);
    await fx.db.getPool().query(
      `UPDATE social_post_drafts SET text=$3, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [row.id, fx.tenantId, 'Concurrent postgres edit'],
    );
    const write = await draftsRouter._updateDraftAtVersion(fx.tenantId, row.id, snapshot, {
      status: 'pending_approval',
      text: SAFE_TEXT,
    }, { requireStatuses: ['draft', 'approved'] });
    assert.equal(write.ok, false);
    assert.equal(write.error, 'conflict');
    const finalRow = await pgDraftRow(fx, row.id, 'status, text');
    assert.equal(finalRow.status, 'draft');
    assert.equal(finalRow.text, 'Concurrent postgres edit');
    fx.setGate(async () => GATE_BLOCKED);
  });

  it('leaves no claim and zero provider calls when approve gate is unavailable', async () => {
    fx.setGate(async () => GATE_UNAVAILABLE);
    const tmpServer = await listen(mountApp({ useDb: true }).app);
    try {
      await assertApproveSafetyHold(fx, { status: 503, server: tmpServer });
    } finally {
      await new Promise((r) => tmpServer.close(r));
      fx.setGate(async () => GATE_BLOCKED);
    }
  });
});
