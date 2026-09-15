// test/pr10h1a-social-draft-save-safety.test.js — PR-1a social draft save safety (CR-055–CR-057)
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');

const {
  gateRouteText,
  contentSafetyHttpBody,
} = require('../services/ai_governance/route_gate');
const { socialDraftGateText } = require('../services/ai_governance/content_schemas');

const PROHIBITED = 'guaranteed 100% returns with zero risk';
const SAFE_TEXT = 'Schedule a demo to learn how our platform helps marketing teams.';
const LEGACY_CAPTION_LIMIT = 10_000;
const LEGACY_ALT_LIMIT = 2_000;

function captionWithProhibitedSuffix() {
  return `${'x'.repeat(LEGACY_CAPTION_LIMIT + 1)}${PROHIBITED}`;
}

function altWithProhibitedSuffix() {
  return `${'a'.repeat(LEGACY_ALT_LIMIT + 1)}${PROHIBITED}`;
}

const db = require('../db');
db.hasDb = () => false;

const tenantCtx = require('../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req && req.headers && (req.headers['x-test-tid'] || req.headers['x-test-tenant']);
  return h ? parseInt(h, 10) : 11;
};

function mountApp() {
  delete require.cache[require.resolve('../services/social_drafts/api')];
  const draftsRouter = require('../services/social_drafts/api');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const tid = Number(req.headers['x-test-tid'] || req.headers['x-test-tenant'] || 11);
    req.user = { id: 3, email: 'safety@test.local' };
    req.tenant = { id: tid, name: 'Test', slug: 'test', status: 'active' };
    next();
  });
  app.use('/api/social-drafts', draftsRouter);
  return { app, draftsRouter };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function jsonFetch(server, method, path, { tid = 11, body, headers = {} } = {}) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-test-tid': String(tid),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  return { status: res.status, body: j };
}

describe('PR-1a scope — social draft save gate (Step 6 partial)', () => {
  it('documents gated create/patch/bulk paths in social_drafts api', () => {
    const src = fs.readFileSync(require.resolve('../services/social_drafts/api'), 'utf8');
    assert.match(src, /social-drafts:create/);
    assert.match(src, /social-drafts:patch/);
    assert.match(src, /social-drafts:bulk/);
    assert.match(src, /gateRouteText/);
    assert.match(src, /socialDraftGateText/);
    assert.match(src, /content_safety_warnings/);
    assert.match(src, /createRateLimiter/);
    assert.match(src, /socialDraftWriteLimiter/);
    assert.match(src, /socialDraftScanSizeError/);
    assert.match(src, /_insertDraftsBulk/);
    assert.match(src, /BEGIN/);
    assert.match(src, /ROLLBACK/);
  });

  it('does not claim whole-Step-6 completion', () => {
    const doc = fs.readFileSync(require.resolve('../docs/step6-content-safety-coverage.md'), 'utf8');
    assert.match(doc, /Status:\*\* Partial/);
  });
});

describe('PR-1a socialDraftGateText', () => {
  it('scans caption text and media alt fields with preserved newlines/tabs', () => {
    const text = socialDraftGateText({
      text: 'Line one\nLine two\twith tab',
      meta: { alt_text: 'Alt\nline', media_alt: 'Secondary alt' },
    });
    assert.match(text, /Line one\nLine two\twith tab/);
    assert.match(text, /Alt\nline/);
    assert.match(text, /Secondary alt/);
  });
});

describe('PR-1a social draft create gate (CR-055)', () => {
  let server;
  let draftsRouter;

  before(async () => {
    const { app, draftsRouter: router } = mountApp();
    draftsRouter = router;
    server = await listen(app);
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[require.resolve('../services/social_drafts/api')];
  });

  beforeEach(() => {
    if (typeof draftsRouter._resetMem === 'function') draftsRouter._resetMem();
  });

  it('creates a draft with benign copy', async () => {
    const r = await jsonFetch(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.draft.text, SAFE_TEXT);
  });

  it('blocks prohibited copy with 403 and no draft row', async () => {
    const r = await jsonFetch(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: PROHIBITED, platforms: ['instagram'] },
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.ok, false);
    assert.ok(r.body.error === 'content_safety_blocked' || r.body.error === 'content_safety_block');
    assert.equal(r.body.draft, undefined);
    const listed = await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1');
    assert.equal(listed.body.drafts.length, 0);
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
      assert.equal(r.body.error, 'content_safety_unavailable');
      assert.equal(r.body.draft, undefined);
      assert.equal(router._listForTenant(11).length, 0);
    } finally {
      await new Promise((r) => tmp.close(r));
      gateCached.exports.gateRouteText = realGate;
      delete require.cache[require.resolve('../services/social_drafts/api')];
    }
  });

  it('blocks create when prohibited copy sits beyond legacy caption or alt truncation', async () => {
    for (const body of [
      { profileId: 'p1', text: captionWithProhibitedSuffix(), platforms: ['instagram'] },
      {
        profileId: 'p1',
        text: SAFE_TEXT,
        platforms: ['instagram'],
        meta: { alt_text: altWithProhibitedSuffix() },
      },
    ]) {
      const r = await jsonFetch(server, 'POST', '/api/social-drafts', { body });
      assert.equal(r.status, 403);
      assert.ok(r.body.error === 'content_safety_blocked' || r.body.error === 'content_safety_block');
    }
    const listed = await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1');
    assert.equal(listed.body.drafts.length, 0);
  });

  it('persists warning-only results and reloads on GET', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({
      ...defaultPolicy(tid),
      content_safety_mode: 'warning_only',
      content_safety_explicit: true,
    });
    try {
      const created = await jsonFetch(server, 'POST', '/api/social-drafts', {
        body: { profileId: 'p1', text: PROHIBITED, platforms: ['linkedin'] },
      });
      assert.equal(created.status, 200);
      assert.ok((created.body.content_safety_warnings || created.body.draft?.content_safety_warnings || []).length >= 1);
      const got = await jsonFetch(server, 'GET', `/api/social-drafts/${created.body.draft.id}`);
      assert.ok((got.body.draft.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});

describe('PR-1a social draft PATCH gate (CR-057)', () => {
  let server;
  let draftsRouter;

  before(async () => {
    const { app, draftsRouter: router } = mountApp();
    draftsRouter = router;
    server = await listen(app);
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    if (typeof draftsRouter._resetMem === 'function') draftsRouter._resetMem();
  });

  it('gates merged draft after partial text patch', async () => {
    const created = await jsonFetch(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'] },
    });
    const id = created.body.draft.id;
    const patched = await jsonFetch(server, 'PATCH', `/api/social-drafts/${id}`, {
      body: { text: PROHIBITED },
    });
    assert.equal(patched.status, 403);
    assert.equal(patched.body.draft, undefined);
    const got = await jsonFetch(server, 'GET', `/api/social-drafts/${id}`);
    assert.equal(got.body.draft.text, SAFE_TEXT);
  });

  it('blocks merged PATCH when prohibited suffix sits beyond legacy caption or alt truncation', async () => {
    const created = await jsonFetch(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'] },
    });
    const id = created.body.draft.id;
    for (const body of [
      { text: captionWithProhibitedSuffix() },
      { meta: { alt_text: altWithProhibitedSuffix() } },
    ]) {
      const patched = await jsonFetch(server, 'PATCH', `/api/social-drafts/${id}`, { body });
      assert.equal(patched.status, 403);
    }
    const got = await jsonFetch(server, 'GET', `/api/social-drafts/${id}`);
    assert.equal(got.body.draft.text, SAFE_TEXT);
    assert.equal(got.body.draft.meta?.alt_text, undefined);
  });

  it('rejects cross-tenant PATCH without mutation', async () => {
    const created = await jsonFetch(server, 'POST', '/api/social-drafts', {
      tid: 11,
      body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'] },
    });
    const id = created.body.draft.id;
    const forged = await jsonFetch(server, 'PATCH', `/api/social-drafts/${id}`, {
      tid: 99,
      body: { text: 'Tenant B takeover' },
    });
    assert.equal(forged.status, 404);
    const got = await jsonFetch(server, 'GET', `/api/social-drafts/${id}`, { tid: 11 });
    assert.equal(got.body.draft.text, SAFE_TEXT);
  });
});

describe('PR-1a social draft bulk gate (CR-056)', () => {
  let server;
  let draftsRouter;

  before(async () => {
    const { app, draftsRouter: router } = mountApp();
    draftsRouter = router;
    server = await listen(app);
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    if (typeof draftsRouter._resetMem === 'function') draftsRouter._resetMem();
  });

  it('creates all items when every caption passes', async () => {
    const r = await jsonFetch(server, 'POST', '/api/social-drafts/bulk', {
      body: {
        profileId: 'p1',
        items: [
          { caption: 'One', platforms: ['instagram'] },
          { caption: 'Two', platform: 'linkedin' },
        ],
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.created, 2);
  });

  it('blocks bulk when any item fails without partial inserts', async () => {
    const r = await jsonFetch(server, 'POST', '/api/social-drafts/bulk', {
      body: {
        profileId: 'p1',
        items: [
          { caption: SAFE_TEXT, platforms: ['instagram'] },
          { caption: PROHIBITED, platforms: ['linkedin'] },
        ],
      },
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.draft, undefined);
    const listed = await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1');
    assert.equal(listed.body.drafts.length, 0);
  });

  it('blocks bulk when prohibited suffix sits beyond legacy caption or alt truncation', async () => {
    for (const items of [
      [
        { caption: SAFE_TEXT, platforms: ['instagram'] },
        { caption: captionWithProhibitedSuffix(), platforms: ['linkedin'] },
      ],
      [
        { caption: SAFE_TEXT, platforms: ['instagram'] },
        { caption: 'Alt gated item', alt_text: altWithProhibitedSuffix(), platforms: ['linkedin'] },
      ],
    ]) {
      const r = await jsonFetch(server, 'POST', '/api/social-drafts/bulk', {
        body: { profileId: 'p1', items },
      });
      assert.equal(r.status, 403);
    }
    const listed = await jsonFetch(server, 'GET', '/api/social-drafts/list?profileId=p1');
    assert.equal(listed.body.drafts.length, 0);
  });

  it('rolls back memory bulk inserts when a later item fails to persist', async () => {
    const items = [
      {
        profile_id: 'p1',
        text: SAFE_TEXT,
        platforms: ['instagram'],
        media_urls: [],
        meta: {},
      },
      {
        profile_id: 'p1',
        text: 'Second item',
        platforms: ['linkedin'],
        media_urls: [],
        meta: {},
      },
    ];
    await assert.rejects(
      () => draftsRouter._insertDraftsBulk(11, items, { failAfterIndex: 1 }),
      (err) => err && err.message === 'bulk_insert_test_failure',
    );
    assert.equal(draftsRouter._listForTenant(11).length, 0);
  });
});

describe('PR-1a blocked responses omit usable copy', () => {
  it('contentSafetyHttpBody never includes draft fields', () => {
    const body = contentSafetyHttpBody({
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['x'],
    });
    assert.equal(body.draft, undefined);
    assert.equal(body.ok, false);
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
    const { app } = mountApp();
    server = await listen(app);
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

describe('PR-1a UI coverage notes', () => {
  it('SocialPublisher save safety UI is covered by pr10h1a-social-draft-save-safety-ui.test.js', () => {
    const rendered = fs.readFileSync(
      require.resolve('./pr10h1a-social-draft-save-safety-ui.test.js'),
      'utf8',
    );
    assert.match(rendered, /role="alert"/);
    assert.match(rendered, /content_safety_blocked/);
    assert.match(rendered, /content_safety_unavailable/);
    assert.match(rendered, /Save draft/);
    assert.match(rendered, /switching drafts clears the prior save alert/);
    assert.match(rendered, /preserves edits made while a save is in flight/);
    assert.match(rendered, /ignores a late blocked save response/);
  });
});

const PG_URL = process.env.DATABASE_URL || '';
const PG_REQUIRED = process.env.PR10H1_REQUIRE_INTEGRATION === '1';
const pgSkip = !PG_URL ? (PG_REQUIRED ? false : 'no DATABASE_URL') : false;

describe('PR-1a social draft bulk postgres', { skip: pgSkip }, () => {
  let db;
  let ensureTenantSchema;
  let ensureSocialDraftsSchema;
  let server;
  let tenantId;
  let realGate;
  const fixtureTag = `pr10h1a-bulk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const profileId = `bulk-${fixtureTag}`;

  before(async () => {
    assert.ok(PG_URL, 'DATABASE_URL is required when PR10H1_REQUIRE_INTEGRATION=1');
    for (const mod of [
      '../db',
      '../services/tenants/schema',
      '../services/social_drafts/schema',
      '../services/social_drafts/api',
      '../services/tenants/context',
    ]) {
      delete require.cache[require.resolve(mod)];
    }
    db = require('../db');
    ({ ensureTenantSchema } = require('../services/tenants/schema'));
    ({ ensureSocialDraftsSchema } = require('../services/social_drafts/schema'));
    await ensureTenantSchema();
    await ensureSocialDraftsSchema();
    const p = db.getPool();
    tenantId = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
      [`PR10H1A bulk ${fixtureTag}`, fixtureTag],
    )).rows[0].id;
    const routeGate = require('../services/ai_governance/route_gate');
    realGate = routeGate.gateRouteText;
    routeGate.gateRouteText = async () => ({ ok: true, warnings: [] });
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async (req) => Number(req.headers['x-test-tid'] || tenantId);
    const { app } = mountApp();
    server = await listen(app);
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
      body: {
        profileId,
        items: [
          { caption: SAFE_TEXT, platforms: ['instagram'] },
          { caption: 'Second bulk row', platforms: ['linkedin'] },
        ],
      },
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

describe('PR-1a warning-only gateRouteText', () => {
  it('returns warnings for prohibited social draft text in warning_only mode', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({
      ...defaultPolicy(tid),
      content_safety_mode: 'warning_only',
      content_safety_explicit: true,
    });
    try {
      const out = await gateRouteText({
        tenantId: 1,
        text: socialDraftGateText({ text: PROHIBITED }),
        surface: 'social_drafts',
      });
      assert.equal(out.ok, true);
      assert.ok((out.warnings || out.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});
