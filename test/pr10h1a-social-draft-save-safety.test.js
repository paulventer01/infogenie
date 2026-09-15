// test/pr10h1a-social-draft-save-safety.test.js — PR-1a social draft save safety (CR-055–CR-057)
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { gateRouteText, contentSafetyHttpBody } = require('../services/ai_governance/route_gate');
const { socialDraftGateText } = require('../services/ai_governance/content_schemas');
const {
  PROHIBITED,
  SAFE_TEXT,
  captionWithProhibitedSuffix,
  altWithProhibitedSuffix,
  mountApp,
  listen,
  jsonFetch,
} = require('./helpers/social-draft-safety-app');

describe('PR-1a social draft save gates (CR-055–CR-057)', () => {
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

  beforeEach(() => {
    if (typeof draftsRouter._resetMem === 'function') draftsRouter._resetMem();
  });

  it('documents scope, gate text, and blocked response shape', () => {
    const src = fs.readFileSync(require.resolve('../services/social_drafts/api'), 'utf8');
    const doc = fs.readFileSync(require.resolve('../docs/step6-content-safety-coverage.md'), 'utf8');
    for (const pattern of [
      /social-drafts:create/, /social-drafts:patch/, /social-drafts:bulk/,
      /gateRouteText/, /socialDraftGateText/, /socialDraftScanSizeError/,
      /_insertDraftsBulk/, /BEGIN/, /ROLLBACK/, /content_safety_warnings/,
    ]) assert.match(src, pattern);
    assert.match(doc, /Status:\*\* Partial/);
    const gated = socialDraftGateText({
      text: 'Line one\nLine two\twith tab',
      meta: { alt_text: 'Alt\nline', media_alt: 'Secondary alt' },
    });
    assert.match(gated, /Line one\nLine two\twith tab/);
    const body = contentSafetyHttpBody({ error: 'content_safety_blocked', userMessage: 'blocked', warnings: ['x'] });
    assert.equal(body.draft, undefined);
    assert.equal(body.ok, false);
  });

  it('creates, blocks, and warns on POST create', async () => {
    const ok = await jsonFetch(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'] },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.draft.text, SAFE_TEXT);
    draftsRouter._resetMem();

    const blocked = await jsonFetch(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: PROHIBITED, platforms: ['instagram'] },
    });
    assert.equal(blocked.status, 403);
    assert.ok(blocked.body.error === 'content_safety_blocked' || blocked.body.error === 'content_safety_block');
    assert.equal((await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1')).body.drafts.length, 0);

    for (const body of [
      { profileId: 'p1', text: captionWithProhibitedSuffix(), platforms: ['instagram'] },
      { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'], meta: { alt_text: altWithProhibitedSuffix() } },
    ]) {
      const r = await jsonFetch(server, 'POST', '/api/social-drafts', { body });
      assert.equal(r.status, 403);
    }
    assert.equal((await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1')).body.drafts.length, 0);

    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({ ...defaultPolicy(tid), content_safety_mode: 'warning_only', content_safety_explicit: true });
    try {
      const created = await jsonFetch(server, 'POST', '/api/social-drafts', {
        body: { profileId: 'p1', text: PROHIBITED, platforms: ['linkedin'] },
      });
      assert.equal(created.status, 200);
      assert.ok((created.body.content_safety_warnings || created.body.draft?.content_safety_warnings || []).length >= 1);
      const out = await gateRouteText({ tenantId: 1, text: socialDraftGateText({ text: PROHIBITED }), surface: 'social_drafts' });
      assert.equal(out.ok, true);
      assert.ok((out.warnings || out.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });

  it('returns 503 when gate is unavailable', async () => {
    const gatePath = require.resolve('../services/ai_governance/route_gate');
    const gateCached = require.cache[gatePath];
    const realGate = gateCached.exports.gateRouteText;
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
    });
    delete require.cache[require.resolve('../services/social_drafts/api')];
    const { app, draftsRouter: router } = mountApp();
    const tmp = await listen(app);
    try {
      const r = await jsonFetch(tmp, 'POST', '/api/social-drafts', {
        body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['twitter'] },
      });
      assert.equal(r.status, 503);
      assert.equal(router._listForTenant(11).length, 0);
    } finally {
      await new Promise((r) => tmp.close(r));
      gateCached.exports.gateRouteText = realGate;
      delete require.cache[require.resolve('../services/social_drafts/api')];
    }
  });

  it('gates merged PATCH and rejects cross-tenant edits', async () => {
    const created = await jsonFetch(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'] },
    });
    const id = created.body.draft.id;
    assert.equal((await jsonFetch(server, 'PATCH', `/api/social-drafts/${id}`, { body: { text: PROHIBITED } })).status, 403);
    for (const body of [{ text: captionWithProhibitedSuffix() }, { meta: { alt_text: altWithProhibitedSuffix() } }]) {
      assert.equal((await jsonFetch(server, 'PATCH', `/api/social-drafts/${id}`, { body })).status, 403);
    }
    const got = await jsonFetch(server, 'GET', `/api/social-drafts/${id}`);
    assert.equal(got.body.draft.text, SAFE_TEXT);
    assert.equal((await jsonFetch(server, 'PATCH', `/api/social-drafts/${id}`, { tid: 99, body: { text: 'Tenant B takeover' } })).status, 404);
  });

  it('validates bulk atomically and rolls back memory inserts on failure', async () => {
    const ok = await jsonFetch(server, 'POST', '/api/social-drafts/bulk', {
      body: { profileId: 'p1', items: [{ caption: 'One', platforms: ['instagram'] }, { caption: 'Two', platform: 'linkedin' }] },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.created, 2);
    draftsRouter._resetMem();

    assert.equal((await jsonFetch(server, 'POST', '/api/social-drafts/bulk', {
      body: { profileId: 'p1', items: [{ caption: SAFE_TEXT, platforms: ['instagram'] }, { caption: PROHIBITED, platforms: ['linkedin'] }] },
    })).status, 403);
    assert.equal((await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1')).body.drafts.length, 0);

    for (const items of [
      [{ caption: SAFE_TEXT, platforms: ['instagram'] }, { caption: captionWithProhibitedSuffix(), platforms: ['linkedin'] }],
      [{ caption: SAFE_TEXT, platforms: ['instagram'] }, { caption: 'Alt gated item', alt_text: altWithProhibitedSuffix(), platforms: ['linkedin'] }],
    ]) {
      assert.equal((await jsonFetch(server, 'POST', '/api/social-drafts/bulk', { body: { profileId: 'p1', items } })).status, 403);
    }
    assert.equal((await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1')).body.drafts.length, 0);

    await assert.rejects(
      () => draftsRouter._insertDraftsBulk(11, [
        { profile_id: 'p1', text: SAFE_TEXT, platforms: ['instagram'], media_urls: [], meta: {} },
        { profile_id: 'p1', text: 'Second item', platforms: ['linkedin'], media_urls: [], meta: {} },
      ], { failAfterIndex: 1 }),
      (err) => err && err.message === 'bulk_insert_test_failure',
    );
    assert.equal(draftsRouter._listForTenant(11).length, 0);
  });
});

describe('PR-1a social draft write rate limit', () => {
  const apiPath = require.resolve('../services/social_drafts/api');
  const prevEnv = process.env.SOCIAL_DRAFT_WRITE_RATE_LIMIT_MAX;
  let server;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SOCIAL_DRAFT_WRITE_RATE_LIMIT_MAX = '2';
    delete require.cache[apiPath];
    server = await listen(mountApp().app);
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[apiPath];
    if (prevEnv === undefined) delete process.env.SOCIAL_DRAFT_WRITE_RATE_LIMIT_MAX;
    else process.env.SOCIAL_DRAFT_WRITE_RATE_LIMIT_MAX = prevEnv;
  });

  it('returns 429 after tenant bucket is exhausted', async () => {
    const body = { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'] };
    assert.equal((await jsonFetch(server, 'POST', '/api/social-drafts', { body })).status, 200);
    assert.equal((await jsonFetch(server, 'POST', '/api/social-drafts', { body })).status, 200);
    const limited = await jsonFetch(server, 'POST', '/api/social-drafts', { body });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
  });
});

const PG_URL = process.env.DATABASE_URL || '';
const PG_REQUIRED = process.env.PR10H1_REQUIRE_INTEGRATION === '1';
const pgSkip = !PG_URL ? (PG_REQUIRED ? false : 'no DATABASE_URL') : false;

describe('PR-1a social draft bulk postgres', { skip: pgSkip }, () => {
  let db;
  let server;
  let tenantId;
  let realGate;
  const fixtureTag = `pr10h1a-bulk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const profileId = `bulk-${fixtureTag}`;

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
      [`PR10H1A bulk ${fixtureTag}`, fixtureTag],
    )).rows[0].id;
    const routeGate = require('../services/ai_governance/route_gate');
    realGate = routeGate.gateRouteText;
    routeGate.gateRouteText = async () => ({ ok: true, warnings: [] });
    require('../services/tenants/context').resolveTenantId = async (req) => Number(req.headers['x-test-tid'] || tenantId);
    server = await listen(mountApp().app);
  });

  after(async () => {
    if (realGate) require('../services/ai_governance/route_gate').gateRouteText = realGate;
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[require.resolve('../services/social_drafts/api')];
    if (!PG_URL || !tenantId) return;
    const p = db.getPool();
    await p.query('DELETE FROM social_post_drafts WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await p.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
  });

  it('rolls back all bulk inserts when a later row fails', async () => {
    const p = db.getPool();
    const before = (await p.query(
      `SELECT count(*)::int AS c FROM social_post_drafts WHERE tenant_id = $1 AND profile_id = $2`,
      [tenantId, profileId],
    )).rows[0].c;
    const r = await jsonFetch(server, 'POST', '/api/social-drafts/bulk', {
      tid: tenantId,
      headers: { 'x-test-bulk-fail-after-index': '1' },
      body: { profileId, items: [{ caption: SAFE_TEXT, platforms: ['instagram'] }, { caption: 'Second bulk row', platforms: ['linkedin'] }] },
    });
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'bulk_insert_failed');
    const after = (await p.query(
      `SELECT count(*)::int AS c FROM social_post_drafts WHERE tenant_id = $1 AND profile_id = $2`,
      [tenantId, profileId],
    )).rows[0].c;
    assert.equal(after, before);
  });
});
