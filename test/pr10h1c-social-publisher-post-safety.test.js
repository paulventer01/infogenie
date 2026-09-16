// test/pr10h1c-social-publisher-post-safety.test.js — PR-1c (CR-062)
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const {
  PROHIBITED,
  SAFE_TEXT,
  captionWithProhibitedSuffix,
  altWithProhibitedSuffix,
  listen,
  jsonFetch,
  withWarningOnlyPolicy,
  GATE_UNAVAILABLE,
  mountPublisherApp,
  assertNoUsableCopy,
} = require('./helpers/social-draft-safety-app');
const { socialPublisherGateText } = require('../services/ai_governance/content_schemas');
const { contentSafetyHttpBody } = require('../services/ai_governance/route_gate');

const POST_BODY = { text: SAFE_TEXT, platforms: ['linkedin'], profileId: 'p1' };

function postBody(overrides = {}) {
  return { ...POST_BODY, ...overrides };
}

describe('PR-1c social publisher post gate (CR-062)', () => {
  const mem = {};

  before(async () => {
    mem.prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
    mem.mounted = mountPublisherApp();
    mem.server = await listen(mem.mounted.app);
  });

  after(async () => {
    if (mem.mounted) mem.mounted.restore();
    if (mem.prevKey === undefined) delete process.env.ZERNIO_API_KEY;
    else process.env.ZERNIO_API_KEY = mem.prevKey;
    if (mem.server) await new Promise((r) => mem.server.close(r));
    delete require.cache[require.resolve('../services/social_publisher/api')];
  });

  beforeEach(() => {
    mem.mounted.zernioCalls.length = 0;
    mem.mounted.ingestCalls.length = 0;
    if (typeof mem.mounted.draftsRouter._resetMem === 'function') mem.mounted.draftsRouter._resetMem();
    process.env.ZERNIO_API_KEY = 'test-key-live';
  });

  it('documents gate before provider and scans captions plus alt text', () => {
    const src = fs.readFileSync(require.resolve('../services/social_publisher/api'), 'utf8');
    [/gateRouteText/, /socialPublisherGateText/, /socialPublisherScanSizeError/, /_providerCall/, /contentSafetyHttpBody/]
      .forEach((pattern) => assert.match(src, pattern));
    const gated = socialPublisherGateText({
      text: 'Primary caption\nwith newline',
      caption: 'Secondary caption',
      copy: 'Copy field',
      captions: { twitter: 'TW caption' },
      alt_text: 'Alt\nline',
      media_alt: 'Secondary alt',
    });
    assert.match(gated, /Primary caption\nwith newline/);
    assert.match(gated, /Secondary caption/);
    assert.match(gated, /TW caption/);
    assert.match(gated, /Alt\nline/);
    const body = contentSafetyHttpBody({ error: 'content_safety_blocked', userMessage: 'blocked', warnings: ['x'] });
    assertNoUsableCopy(body);
  });

  it('blocks prohibited copy with 403, no usable copy, and zero provider/persist calls', async () => {
    const r = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', {
      body: postBody({ text: PROHIBITED }),
    });
    assert.equal(r.status, 403);
    assert.ok(r.body.error === 'content_safety_blocked' || r.body.error === 'content_safety_block');
    assert.ok(r.body.userMessage);
    assertNoUsableCopy(r.body);
    assert.equal(JSON.stringify(r.body).includes(PROHIBITED), false);
    assert.equal(mem.mounted.zernioCalls.length, 0);
    assert.equal(mem.mounted.ingestCalls.length, 0);
  });

  it('returns 503 when the scanner is unavailable with zero side effects', async () => {
    const origGate = mem.mounted.publisher._gateRouteText;
    mem.mounted.publisher._gateRouteText = async () => GATE_UNAVAILABLE;
    try {
      const r = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', { body: postBody() });
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'content_safety_unavailable');
      assert.ok(r.body.userMessage);
      assertNoUsableCopy(r.body);
      assert.equal(mem.mounted.zernioCalls.length, 0);
      assert.equal(mem.mounted.ingestCalls.length, 0);
    } finally {
      mem.mounted.publisher._gateRouteText = origGate;
    }
  });

  it('warning-only allows publish and returns content_safety_warnings', async () => {
    await withWarningOnlyPolicy(async () => {
      const r = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', {
        tid: 41,
        body: postBody({ text: PROHIBITED }),
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.ok((r.body.content_safety_warnings || []).length >= 1);
      assert.equal(mem.mounted.zernioCalls.length, 1);
      assert.equal(mem.mounted.zernioCalls[0].body.text, PROHIBITED);
      assert.equal(mem.mounted.ingestCalls.length, 1);
    });
  });

  it('safe success posts once to the provider', async () => {
    const r = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', { body: postBody() });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(mem.mounted.zernioCalls.length, 1);
    assert.equal(mem.mounted.zernioCalls[0].path, '/posts');
    assert.equal(mem.mounted.ingestCalls.length, 1);
  });

  it('scans secondary captions, alt text, and full oversized suffixes', async () => {
    for (const body of [
      postBody({ text: SAFE_TEXT, caption: PROHIBITED }),
      postBody({ text: SAFE_TEXT, captions: { instagram: PROHIBITED } }),
      postBody({ text: SAFE_TEXT, alt_text: PROHIBITED }),
      postBody({ text: SAFE_TEXT, meta: { media_alt: PROHIBITED } }),
      postBody({ text: captionWithProhibitedSuffix() }),
      postBody({ text: SAFE_TEXT, alt_text: altWithProhibitedSuffix() }),
    ]) {
      mem.mounted.zernioCalls.length = 0;
      const r = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', { body });
      assert.equal(r.status, 403);
      assertNoUsableCopy(r.body);
      assert.equal(mem.mounted.zernioCalls.length, 0);
    }
    const oversized = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', {
      body: postBody({ text: `${'x'.repeat(100_001)} benign tail` }),
    });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.body.error, 'content_too_long');
    assert.ok(oversized.body.userMessage);
    assertNoUsableCopy(oversized.body);
    assert.equal(mem.mounted.zernioCalls.length, 0);
  });

  it('keeps approval, tenant, and permission rejection with zero provider calls', async () => {
    await mem.mounted.draftsRouter._setSettings(51, { require_approval: true });
    await mem.mounted.draftsRouter._setSettings(52, { require_approval: false });
    const blocked = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', {
      tid: 51,
      body: postBody({ text: 'Bypass attempt' }),
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, 'approval_required');
    assert.equal(mem.mounted.zernioCalls.length, 0);

    const other = await jsonFetch(mem.server, 'POST', '/api/social-publisher/post', {
      tid: 52,
      body: postBody(),
    });
    assert.equal(other.status, 200);
    assert.equal(mem.mounted.zernioCalls.length, 1);

    const prev = process.env.PERMISSION_ENFORCEMENT;
    process.env.PERMISSION_ENFORCEMENT = 'on';
    delete require.cache[require.resolve('../services/tenants/permission_enforce')];
    const enforce = require('../services/tenants/permission_enforce');
    process.env.PERMISSION_ENFORCEMENT = prev;
    let hits = 0;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9, email: 'viewer@test.local', isOwner: false };
      req.permissions = new Set(['creator.view']);
      req.can = (k) => req.permissions.has(k);
      next();
    });
    app.use(enforce.enforceMatrix);
    app.post('/api/social-publisher/post', (_req, res) => {
      hits += 1;
      res.json({ ok: true, leaked: true });
    });
    const server = await listen(app);
    try {
      const denied = await jsonFetch(server, 'POST', '/api/social-publisher/post', { body: postBody() });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, 'forbidden');
      assert.equal(denied.body.required, 'creator.publish');
      assert.equal(hits, 0);
    } finally {
      await new Promise((r) => server.close(r));
      delete require.cache[require.resolve('../services/tenants/permission_enforce')];
    }
  });
});

const PG_URL = process.env.DATABASE_URL || '';
const PG_REQUIRED = process.env.PR10H1_REQUIRE_INTEGRATION === '1';
const pgSkip = !PG_URL ? (PG_REQUIRED ? false : 'no DATABASE_URL') : false;

describe('PR-1c social publisher post safety postgres', { skip: pgSkip }, () => {
  it('approval and safety blocks make zero provider calls', async () => {
    assert.ok(PG_URL, 'DATABASE_URL is required when PR10H1_REQUIRE_INTEGRATION=1');
    for (const mod of [
      '../db', '../services/tenants/schema', '../services/social_drafts/schema',
      '../services/social_drafts/api', '../services/social_publisher/api', '../services/tenants/context',
    ]) delete require.cache[require.resolve(mod)];
    const db = require('../db');
    await require('../services/tenants/schema').ensureTenantSchema();
    await require('../services/social_drafts/schema').ensureSocialDraftsSchema();
    const tag = `pr10h1c-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const tenantA = (await db.getPool().query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`PR10H1C A ${tag}`, `${tag}-a`],
    )).rows[0].id;
    const tenantB = (await db.getPool().query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`PR10H1C B ${tag}`, `${tag}-b`],
    )).rows[0].id;
    require('../services/tenants/context').resolveTenantId = async (req) => Number(req.headers['x-test-tid'] || tenantB);
    const mounted = mountPublisherApp({ useDb: true });
    const server = await listen(mounted.app);
    try {
      await mounted.draftsRouter._setSettings(tenantA, { require_approval: true });
      await mounted.draftsRouter._setSettings(tenantB, { require_approval: false });
      const approval = await jsonFetch(server, 'POST', '/api/social-publisher/post', {
        tid: tenantA,
        body: postBody({ text: 'Needs approval' }),
      });
      assert.equal(approval.status, 403);
      assert.equal(approval.body.error, 'approval_required');
      assert.equal(mounted.zernioCalls.length, 0);
      const blocked = await jsonFetch(server, 'POST', '/api/social-publisher/post', {
        tid: tenantB,
        body: postBody({ text: PROHIBITED }),
      });
      assert.equal(blocked.status, 403);
      assertNoUsableCopy(blocked.body);
      assert.equal(mounted.zernioCalls.length, 0);
      const ok = await jsonFetch(server, 'POST', '/api/social-publisher/post', {
        tid: tenantB,
        body: postBody(),
      });
      assert.equal(ok.status, 200);
      assert.equal(mounted.zernioCalls.length, 1);
    } finally {
      mounted.restore();
      await new Promise((r) => server.close(r));
      const p = db.getPool();
      await p.query('DELETE FROM social_publisher_settings WHERE tenant_id = ANY($1::int[])', [[tenantA, tenantB]]).catch(() => {});
      await p.query('DELETE FROM social_post_drafts WHERE tenant_id = ANY($1::int[])', [[tenantA, tenantB]]).catch(() => {});
      await p.query('DELETE FROM tenants WHERE id = ANY($1::int[])', [[tenantA, tenantB]]).catch(() => {});
      delete require.cache[require.resolve('../services/social_publisher/api')];
      delete require.cache[require.resolve('../services/social_drafts/api')];
    }
  });
});
