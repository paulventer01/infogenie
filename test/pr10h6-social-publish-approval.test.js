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
});
