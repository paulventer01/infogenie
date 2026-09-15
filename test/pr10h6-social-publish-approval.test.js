// test/pr10h6-social-publish-approval.test.js — PR10H.6 social publishing approval enforcement
'use strict';

require('./helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const db = require('../db');
const origHasDb = db.hasDb;
const tenantCtx = require('../services/tenants/context');
const origResolveTenant = tenantCtx.resolveTenantId;

const {
  contentHash,
  evaluatePublishAuthorization,
  hasValidApproval,
  patchInvalidatesApproval,
  invalidateApprovalPatch,
} = require('../services/social_drafts/publish_approval');

function memHarness() {
  db.hasDb = () => false;
  tenantCtx.resolveTenantId = async (req) => {
    const h = req?.headers?.['x-test-tid'];
    return h ? parseInt(h, 10) : 1;
  };
  const drafts = require('../services/social_drafts/api');
  const publisher = require('../services/social_publisher/api');
  const workflows = require('../services/social_workflows/api');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'h6@test.local' }; next(); });
  app.use('/api/social-drafts', drafts);
  app.use('/api/social-publisher', publisher);
  app.use('/api/social-workflows', workflows);
  return { drafts, publisher, workflows, app };
}

function httpReq(server, method, path, { tid = 1, body } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-tid': String(tid) },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let j = {};
        try { j = d ? JSON.parse(d) : {}; } catch { j = { raw: d }; }
        resolve({ status: res.statusCode, body: j });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

describe('PR10H.6 publish_approval helpers', () => {
  it('content hash changes when material fields change', () => {
    const base = {
      profile_id: 'p1',
      text: 'Hello',
      platforms: ['linkedin'],
      media_urls: [],
      scheduled_for: null,
    };
    const h1 = contentHash(base);
    assert.equal(h1, contentHash({ ...base }));
    assert.notEqual(h1, contentHash({ ...base, text: 'Changed' }));
    assert.notEqual(h1, contentHash({ ...base, platforms: ['twitter'] }));
  });

  it('pending approval never authorizes direct publishing', () => {
    const draft = {
      status: 'pending_approval',
      profile_id: 'p1',
      text: 'Pending',
      platforms: ['linkedin'],
      media_urls: [],
      meta: { approved_at: new Date().toISOString(), approval_content_hash: contentHash({
        profile_id: 'p1', text: 'Pending', platforms: ['linkedin'], media_urls: [],
      }) },
    };
    assert.equal(hasValidApproval(draft), false);
    const blockedDirect = evaluatePublishAuthorization({ requireApproval: true, draft, mode: 'direct' });
    assert.equal(blockedDirect.ok, false);
    assert.equal(blockedDirect.error, 'pending_approval');
    const allowedApprove = evaluatePublishAuthorization({ requireApproval: true, draft, mode: 'approval' });
    assert.equal(allowedApprove.ok, true);
  });

  it('patchInvalidatesApproval detects material edits', () => {
    const existing = {
      status: 'approved',
      text: 'A',
      platforms: ['linkedin'],
      media_urls: [],
      profile_id: 'p1',
      scheduled_for: null,
      meta: {},
    };
    assert.equal(patchInvalidatesApproval(existing, { text: 'B' }), true);
    assert.equal(patchInvalidatesApproval(existing, { meta: { note: 'x' } }), false);
    const inv = invalidateApprovalPatch(existing);
    assert.equal(inv.status, 'draft');
    assert.ok(inv.meta.approval_invalidated_at);
  });
});

describe('PR10H.6 social drafts enforcement (memory)', () => {
  let drafts;
  let server;
  let prevKey;

  beforeEach(() => {
    const h = memHarness();
    drafts = h.drafts;
    drafts._resetMem();
    server = http.createServer(h.app);
    prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
  });

  afterEach(async () => {
    if (server?.listening) await new Promise((r) => server.close(r));
    db.hasDb = origHasDb;
    tenantCtx.resolveTenantId = origResolveTenant;
    if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
    else process.env.ZERNIO_API_KEY = prevKey;
  });

  async function enableApproval(tid) {
    await drafts._setSettings(tid, { require_approval: true });
  }

  it('approval required + unapproved draft → zero provider calls', async () => {
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-blocked' } };
    };
    try {
      await enableApproval(21);
      const draft = await drafts._createForTenant(21, {
        profile_id: 'p1',
        status: 'draft',
        text: 'Needs approval',
        platforms: ['linkedin'],
      });
      const result = await drafts._executePublishDraft(21, draft.id, { mode: 'direct' });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'approval_required');
      assert.equal(publishCalls, 0);
    } finally {
      drafts._publishViaZernio = origPublish;
    }
  });

  it('valid approval → one provider call', async () => {
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-approved' } };
    };
    try {
      await enableApproval(22);
      const draft = await drafts._createForTenant(22, {
        profile_id: 'p1',
        status: 'pending_approval',
        text: 'Approved post',
        platforms: ['linkedin'],
      });
      const approved = await drafts._approveAndPublish(22, draft.id, {});
      assert.equal(approved.ok, true);
      assert.equal(approved.published, true);
      assert.equal(publishCalls, 1);
      assert.ok(approved.draft.meta.approval_content_hash);
    } finally {
      drafts._publishViaZernio = origPublish;
    }
  });

  it('edited content after approval → blocked', async () => {
    await enableApproval(23);
    const draft = await drafts._createForTenant(23, {
      profile_id: 'p1',
      status: 'approved',
      text: 'Original',
      platforms: ['linkedin'],
      meta: {
        approved_at: new Date().toISOString(),
        approval_content_hash: contentHash({
          profile_id: 'p1',
          text: 'Original',
          platforms: ['linkedin'],
          media_urls: [],
          scheduled_for: null,
        }),
      },
    });
    await drafts._updateDraft(23, draft.id, { text: 'Edited after approval' });
    const blocked = await drafts._executePublishDraft(23, draft.id, { mode: 'direct' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'approval_stale');
  });

  it('PATCH invalidates prior approval on material edit', async () => {
    await new Promise((r) => server.listen(0, r));
    const created = await httpReq(server, 'POST', '/api/social-drafts', {
      tid: 24,
      body: { profileId: 'p1', text: 'Edit me', platforms: ['linkedin'] },
    });
    const id = created.body.draft.id;
    await drafts._updateDraft(24, id, {
      status: 'approved',
      meta: {
        approved_at: new Date().toISOString(),
        approval_content_hash: contentHash(created.body.draft),
      },
    });
    const patched = await httpReq(server, 'PATCH', `/api/social-drafts/${id}`, {
      tid: 24,
      body: { text: 'Changed copy' },
    });
    assert.equal(patched.body.draft.status, 'draft');
    assert.ok(patched.body.draft.meta.approval_invalidated_at);
    assert.equal(patched.body.draft.meta.approval_content_hash, undefined);
  });

  it('memory PATCH write fails if a claim appears after the initial read', async () => {
    const draft = await drafts._createForTenant(37, {
      profile_id: 'p1',
      status: 'approved',
      text: 'Race patch',
      platforms: ['linkedin'],
    });
    const existing = await drafts._getDraft(37, draft.id);
    await drafts._updateDraft(37, draft.id, {
      meta: { publishing_claim: 'pub_mem_race', publishing_claim_at: new Date().toISOString() },
    });
    const result = await drafts._updateUserDraft(37, draft.id, existing, { text: 'Should not write' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'publish_in_progress');
    const after = await drafts._getDraft(37, draft.id);
    assert.equal(after.text, 'Race patch');
    assert.equal(after.meta.publishing_claim, 'pub_mem_race');
  });

  it('cross-tenant approval rejected', async () => {
    await enableApproval(25);
    const draft = await drafts._createForTenant(25, {
      profile_id: 'p1',
      status: 'approved',
      text: 'Tenant A only',
      platforms: ['linkedin'],
      meta: {
        approved_at: new Date().toISOString(),
        approval_content_hash: contentHash({
          profile_id: 'p1',
          text: 'Tenant A only',
          platforms: ['linkedin'],
          media_urls: [],
        }),
      },
    });
    const otherTenant = await drafts._executePublishDraft(99, draft.id, { mode: 'direct' });
    assert.equal(otherTenant.ok, false);
    assert.equal(otherTenant.error, 'not found');
  });

  it('require_approval=false preserves direct publish behavior', async () => {
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-direct' } };
    };
    try {
      await drafts._setSettings(26, { require_approval: false });
      const draft = await drafts._createForTenant(26, {
        profile_id: 'p1',
        status: 'draft',
        text: 'Direct ok',
        platforms: ['linkedin'],
      });
      const result = await drafts._executePublishDraft(26, draft.id, { mode: 'direct' });
      assert.equal(result.ok, true);
      assert.equal(result.published, true);
      assert.equal(publishCalls, 1);
    } finally {
      drafts._publishViaZernio = origPublish;
    }
  });

  it('concurrent publish retains single provider call with approval required', async () => {
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      await new Promise((res) => setTimeout(res, 40));
      return { ok: true, post: { id: 'z-concurrent' } };
    };
    try {
      await enableApproval(27);
      const draft = await drafts._createForTenant(27, {
        profile_id: 'p1',
        status: 'pending_approval',
        text: 'Concurrent approved',
        platforms: ['linkedin'],
      });
      const results = await Promise.all([
        drafts._approveAndPublish(27, draft.id, {}),
        drafts._approveAndPublish(27, draft.id, {}),
      ]);
      assert.equal(publishCalls, 1);
      const successes = results.filter((r) => r.ok && r.published);
      assert.equal(successes.length, 1);
    } finally {
      drafts._publishViaZernio = origPublish;
    }
  });
});

describe('PR10H.6 legacy publisher + workflow paths', () => {
  let drafts;
  let workflows;
  let server;
  let prevKey;

  beforeEach(() => {
    const h = memHarness();
    drafts = h.drafts;
    workflows = h.workflows;
    drafts._resetMem();
    workflows._resetMem();
    server = http.createServer(h.app);
    prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
  });

  afterEach(async () => {
    if (server?.listening) await new Promise((r) => server.close(r));
    db.hasDb = origHasDb;
    tenantCtx.resolveTenantId = origResolveTenant;
    if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
    else process.env.ZERNIO_API_KEY = prevKey;
  });

  it('social_publisher /post blocked when require_approval=true', async () => {
    await new Promise((r) => server.listen(0, r));
    await drafts._setSettings(31, { require_approval: true });
    const res = await httpReq(server, 'POST', '/api/social-publisher/post', {
      tid: 31,
      body: {
        text: 'Bypass attempt',
        platforms: ['linkedin'],
        profileId: 'p1',
      },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'approval_required');
    assert.ok(res.body.supported_flow);
  });

  it('social_publisher /schedule-calendar blocked when require_approval=true', async () => {
    await new Promise((r) => server.listen(0, r));
    await drafts._setSettings(32, { require_approval: true });
    const res = await httpReq(server, 'POST', '/api/social-publisher/schedule-calendar', {
      tid: 32,
      body: {
        profileId: 'p1',
        items: [{ date: '2026-10-01T10:00:00.000Z', channel: 'linkedin', copy: 'Bulk bypass' }],
      },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'approval_required');
  });

  it('create/bulk/PATCH cannot manufacture approval metadata', async () => {
    await new Promise((r) => server.listen(0, r));
    const forged = await httpReq(server, 'POST', '/api/social-drafts', {
      tid: 34,
      body: {
        profileId: 'p1',
        text: 'Forged create',
        platforms: ['linkedin'],
        status: 'approved',
        meta: {
          approved_at: new Date().toISOString(),
          approval_content_hash: contentHash({
            profile_id: 'p1',
            text: 'Forged create',
            platforms: ['linkedin'],
            media_urls: [],
          }),
          publishing_claim: 'pub_forged',
        },
      },
    });
    assert.equal(forged.body.draft.status, 'draft');
    assert.equal(forged.body.draft.meta.approved_at, undefined);
    assert.equal(forged.body.draft.meta.approval_content_hash, undefined);
    assert.equal(forged.body.draft.meta.publishing_claim, undefined);

    const bulk = await httpReq(server, 'POST', '/api/social-drafts/bulk', {
      tid: 34,
      body: {
        profileId: 'p1',
        items: [{
          text: 'Forged bulk',
          platforms: ['linkedin'],
          meta: { approved_at: new Date().toISOString(), approval_content_hash: 'a'.repeat(64) },
        }],
      },
    });
    assert.equal(bulk.body.drafts[0].status, 'draft');
    assert.equal(bulk.body.drafts[0].meta.approved_at, undefined);

    const created = await httpReq(server, 'POST', '/api/social-drafts', {
      tid: 34,
      body: { profileId: 'p1', text: 'Patch forge', platforms: ['linkedin'] },
    });
    const patched = await httpReq(server, 'PATCH', `/api/social-drafts/${created.body.draft.id}`, {
      tid: 34,
      body: {
        status: 'approved',
        meta: { approved_at: new Date().toISOString(), approval_content_hash: 'b'.repeat(64) },
      },
    });
    assert.equal(patched.status, 400);
    assert.match(patched.body.error, /status is server-controlled/);
  });

  it('settings lookup failure fails closed with zero provider calls', async () => {
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    const origResolve = drafts._resolveSettings;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-failclosed' } };
    };
    drafts._resolveSettings = async () => ({ ok: false, error: 'settings_unavailable' });
    try {
      const draft = await drafts._createForTenant(35, {
        profile_id: 'p1',
        status: 'draft',
        text: 'Fail closed',
        platforms: ['linkedin'],
      });
      const result = await drafts._executePublishDraft(35, draft.id, { mode: 'direct' });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'settings_unavailable');
      assert.equal(publishCalls, 0);
    } finally {
      drafts._publishViaZernio = origPublish;
      drafts._resolveSettings = origResolve;
    }
  });

  it('workflow auto-publish cannot bypass required approval', async () => {
    await new Promise((r) => server.listen(0, r));
    await drafts._setSettings(33, { require_approval: true });
    await httpReq(server, 'POST', '/api/social-workflows/presets/ig_to_tiktok/toggle', {
      tid: 33,
      body: { enabled: true, auto_publish: true },
    });
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-wf' } };
    };
    try {
      const source = await drafts._insertDraft(33, {
        profile_id: 'p1',
        status: 'published',
        text: 'Source IG post',
        platforms: ['instagram'],
        meta: { published_at: new Date().toISOString() },
      });
      const children = await workflows._onSocialPublished(33, source);
      assert.equal(children.length, 1);
      assert.equal(publishCalls, 0);
      const child = children[0];
      assert.equal(child.status, 'draft');
      const runs = await httpReq(server, 'GET', '/api/social-workflows/runs', { tid: 33 });
      assert.equal(runs.body.runs[0].status, 'approval_blocked');
      const blocked = await drafts._executePublishDraft(33, child.id, { mode: 'direct' });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.error, 'approval_required');
    } finally {
      drafts._publishViaZernio = origPublish;
    }
  });

  it('workflow require_approval=false still only schedules the child draft', async () => {
    await new Promise((r) => server.listen(0, r));
    await drafts._setSettings(36, { require_approval: false });
    await httpReq(server, 'POST', '/api/social-workflows/presets/ig_to_tiktok/toggle', {
      tid: 36,
      body: { enabled: true, auto_publish: true },
    });
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-wf-off' } };
    };
    try {
      const source = await drafts._insertDraft(36, {
        profile_id: 'p1',
        status: 'published',
        text: 'Source IG post off',
        platforms: ['instagram'],
        meta: { published_at: new Date().toISOString() },
      });
      const children = await workflows._onSocialPublished(36, source);
      assert.equal(children.length, 1);
      assert.equal(publishCalls, 0);
      const refreshed = await drafts._getDraft(36, children[0].id);
      assert.equal(refreshed.status, 'scheduled');
      assert.equal(refreshed.meta.auto_scheduled, true);
    } finally {
      drafts._publishViaZernio = origPublish;
    }
  });
});

const HAS_DB = typeof origHasDb === 'function' && origHasDb();

describe('PR10H.6 social drafts enforcement (postgres)', () => {
  async function seedPg() {
    const { ensureTenantSchema } = require('../services/tenants/schema');
    const { ensureSocialDraftsSchema } = require('../services/social_drafts/schema');
    await ensureTenantSchema();
    await ensureSocialDraftsSchema();
    db.hasDb = origHasDb;
    const drafts = require('../services/social_drafts/api');
    const p = db.getPool();
    const suffix = `h6-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`PR10H6 ${suffix}`, `pr10h6-${suffix}`],
    )).rows[0].id;
    return { drafts, p, tenant };
  }

  async function cleanup(p, tenant) {
    await p.query(`DELETE FROM social_post_drafts WHERE tenant_id=$1`, [tenant]);
    await p.query(`DELETE FROM social_publisher_settings WHERE tenant_id=$1`, [tenant]).catch(() => {});
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
  }

  it('forged approval metadata cannot authorize publish', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { drafts, p, tenant } = await seedPg();
    await drafts._setSettings(tenant, { require_approval: true });
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-pg-forged' } };
    };
    try {
      const inserted = await p.query(
        `INSERT INTO social_post_drafts
           (tenant_id, profile_id, status, text, media_urls, platforms, meta)
         VALUES ($1,$2,'approved',$3,'[]'::jsonb,$4::jsonb,$5::jsonb)
         RETURNING id`,
        [
          tenant,
          'p1',
          'Forged approval',
          JSON.stringify(['linkedin']),
          JSON.stringify({
            approved_at: new Date().toISOString(),
            approval_content_hash: 'c'.repeat(64),
          }),
        ],
      );
      const result = await drafts._executePublishDraft(tenant, inserted.rows[0].id, { mode: 'direct' });
      assert.equal(result.ok, false);
      assert.ok(['approval_required', 'approval_stale'].includes(result.error));
      assert.equal(publishCalls, 0);
    } finally {
      drafts._publishViaZernio = origPublish;
      await cleanup(p, tenant);
    }
  });

  it('settings lookup failure fails closed with zero provider calls', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { drafts, p, tenant } = await seedPg();
    const inserted = await p.query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'draft',$3,'[]'::jsonb,$4::jsonb,'{}'::jsonb)
       RETURNING id`,
      [tenant, 'p1', 'Settings fail', JSON.stringify(['linkedin'])],
    );
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    const origResolve = drafts._resolveSettings;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-pg-settings' } };
    };
    drafts._resolveSettings = async () => ({ ok: false, error: 'settings_unavailable' });
    try {
      const result = await drafts._executePublishDraft(tenant, inserted.rows[0].id, { mode: 'direct' });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'settings_unavailable');
      assert.equal(publishCalls, 0);
    } finally {
      drafts._publishViaZernio = origPublish;
      drafts._resolveSettings = origResolve;
      await cleanup(p, tenant);
    }
  });

  it('concurrent edit during publish is rejected before provider call', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { drafts, p, tenant } = await seedPg();
    await drafts._setSettings(tenant, { require_approval: true });
    const inserted = await p.query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'pending_approval',$3,'[]'::jsonb,$4::jsonb,'{}'::jsonb)
       RETURNING id`,
      [tenant, 'p1', 'Concurrent edit', JSON.stringify(['linkedin'])],
    );
    const draftId = inserted.rows[0].id;
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    const origUpdate = drafts._updateDraft;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-pg-race' } };
    };
    drafts._updateDraft = async (tid, id, patch) => {
      const next = await origUpdate(tid, id, patch);
      if (patch.meta?.publishing_claim && patch.status === 'approved') {
        return origUpdate(tid, id, { text: 'Edited during claim' });
      }
      return next;
    };
    try {
      const result = await drafts._approveAndPublish(tenant, draftId, {});
      assert.equal(result.ok, false);
      assert.equal(result.error, 'approval_stale');
      assert.equal(publishCalls, 0);
    } finally {
      drafts._publishViaZernio = origPublish;
      drafts._updateDraft = origUpdate;
      await cleanup(p, tenant);
    }
  });

  it('PATCH write fails after a claim appears between read and update', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { drafts, p, tenant } = await seedPg();
    const inserted = await p.query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'approved',$3,'[]'::jsonb,$4::jsonb,'{}'::jsonb)
       RETURNING *`,
      [tenant, 'p1', 'Patch after claim', JSON.stringify(['linkedin'])],
    );
    const draftId = inserted.rows[0].id;
    const existing = await drafts._getDraft(tenant, draftId);
    assert.equal(existing.meta.publishing_claim, undefined);
    const claim = await drafts._claimPublishing(tenant, draftId, { mode: 'direct' });
    assert.equal(claim.ok, true);
    const result = await drafts._updateUserDraft(tenant, draftId, existing, { text: 'Should not persist' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'publish_in_progress');
    const after = await drafts._getDraft(tenant, draftId);
    assert.equal(after.text, 'Patch after claim');
    assert.equal(after.meta.publishing_claim, claim.token);
    await cleanup(p, tenant);
  });

  it('post-claim authorization rejection releases only this claim and stays recoverable', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { drafts, p, tenant } = await seedPg();
    await drafts._setSettings(tenant, { require_approval: true });
    const hash = contentHash({
      profile_id: 'p1',
      text: 'Stale approved',
      platforms: ['linkedin'],
      media_urls: [],
      scheduled_for: null,
    });
    const inserted = await p.query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'approved',$3,'[]'::jsonb,$4::jsonb,$5::jsonb)
       RETURNING id`,
      [
        tenant,
        'p1',
        'Changed after hash',
        JSON.stringify(['linkedin']),
        JSON.stringify({
          approved_at: new Date().toISOString(),
          approval_content_hash: hash,
        }),
      ],
    );
    const draftId = inserted.rows[0].id;
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-pg-release' } };
    };
    try {
      const result = await drafts._executePublishDraft(tenant, draftId, { mode: 'direct' });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'approval_stale');
      assert.equal(publishCalls, 0);
      const after = await drafts._getDraft(tenant, draftId);
      assert.ok(!after.meta.publishing_claim);
      assert.notEqual(after.status, 'delivery_unknown');
      const recovered = await drafts._updateUserDraft(tenant, draftId, after, { text: 'Reapproval copy' });
      assert.equal(recovered.ok, true);
      assert.equal(recovered.draft.status, 'draft');
      assert.ok(recovered.draft.meta.approval_invalidated_at);
    } finally {
      drafts._publishViaZernio = origPublish;
      await cleanup(p, tenant);
    }
  });

  it('uncertain-delivery claims remain retained', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { drafts, p, tenant } = await seedPg();
    const inserted = await p.query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'draft',$3,'[]'::jsonb,$4::jsonb,'{}'::jsonb)
       RETURNING id`,
      [tenant, 'p1', 'Uncertain retain', JSON.stringify(['linkedin'])],
    );
    const draftId = inserted.rows[0].id;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => ({
      ok: false,
      error: 'zernio timeout (30s)',
      uncertain: true,
    });
    try {
      const first = await drafts._executePublishDraft(tenant, draftId, { mode: 'direct' });
      assert.equal(first.ok, false);
      assert.equal(first.error, 'delivery_unknown');
      assert.ok(first.draft.meta.publishing_claim);
      const token = first.draft.meta.publishing_claim;
      const released = await drafts._releasePublishingClaim(tenant, draftId, token);
      assert.equal(released.meta.publishing_claim, token);
      assert.equal(released.status, 'delivery_unknown');
      const retry = await drafts._executePublishDraft(tenant, draftId, { mode: 'direct' });
      assert.equal(retry.ok, false);
      assert.equal(retry.error, 'delivery_unknown');
      const after = await drafts._getDraft(tenant, draftId);
      assert.equal(after.meta.publishing_claim, token);
    } finally {
      drafts._publishViaZernio = origPublish;
      await cleanup(p, tenant);
    }
  });
});
