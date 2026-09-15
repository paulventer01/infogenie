// test/pr10h13-carousel-safety.test.js — PR10H.13 acceptance
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');

const {
  gateRouteText,
  contentSafetyHttpBody,
} = require('../services/ai_governance/route_gate');
const {
  normalizeCarouselSlides,
  normalizeCarouselSlideItem,
  carouselGateText,
} = require('../services/ai_governance/content_schemas');

const PROHIBITED = 'guaranteed 100% returns with zero risk';

const SAFE_SLIDE = {
  n: 1,
  role: 'Hook',
  headline: 'Stop scrolling — this carousel trick saves hours',
  body: 'Most teams miss these filters when planning content.',
  visualHint: 'Bold heading on bright background',
};

function mockAiSlides(overrides = {}) {
  const slides = [];
  for (let i = 0; i < 10; i += 1) {
    slides.push({
      n: i + 1,
      role: i === 0 ? 'Hook' : i === 9 ? 'CTA' : 'Value',
      headline: i === 0 ? SAFE_SLIDE.headline : `Slide ${i + 1} headline`,
      body: i === 0 ? SAFE_SLIDE.body : `Body copy for slide ${i + 1}`,
      visualHint: i === 0 ? SAFE_SLIDE.visualHint : 'Simple icon layout',
      ...(i === 0 ? overrides : {}),
    });
  }
  return { slides };
}

describe('PR10H.13 scope — carousel generate gate (Step 6 partial)', () => {
  it('documents gated generate path in carousel api', () => {
    const api = fs.readFileSync(require.resolve('../services/carousel/api'), 'utf8');
    assert.match(api, /carousel:generate/);
    assert.match(api, /gateRouteText/);
    assert.match(api, /normalizeCarouselSlides/);
    assert.match(api, /carouselGateText/);
    assert.match(api, /content_safety_warnings/);
    assert.match(api, /carouselGenerateLimiter/);
    assert.match(api, /codeql\[js\/missing-rate-limiting\]/);
    assert.match(api, /resolveTenantId/);
  });

  it('does not claim whole-Step-6 completion', () => {
    const step6 = fs.readFileSync(require.resolve('./pr10h5-step6-content-gates.test.js'), 'utf8');
    assert.doesNotMatch(step6, /Step 6:\s*Done/i);
  });
});

describe('PR10H.13 content schema normalization', () => {
  it('strips unexpected nested keys from slide objects', () => {
    const norm = normalizeCarouselSlides([{
      n: 1,
      role: 'Hook',
      headline: 'Hello',
      body: 'World',
      visualHint: 'Icon',
      nested: { evil: true },
    }]);
    assert.equal(norm.length, 1);
    assert.equal(norm[0].nested, undefined);
    assert.equal(norm[0].headline, 'Hello');
  });

  it('scans all retained slide text fields including visual hints', () => {
    const text = carouselGateText([{
      n: 1,
      role: 'Hook',
      headline: 'Hook line',
      body: 'Body copy',
      visualHint: PROHIBITED,
    }]);
    assert.match(text, /Hook line/);
    assert.match(text, /Body copy/);
    assert.match(text, /guaranteed 100% returns/);
  });

  it('joins slide fields with tab separators while preserving internal newlines', () => {
    const text = carouselGateText([{
      n: 1,
      role: 'Hook',
      headline: 'line-a',
      body: 'body\nwith\ttabs',
      visualHint: 'cue-c',
    }]);
    assert.match(text, /line-a\tbody\nwith\ttabs\tcue-c/);
  });
});

describe('PR10H.13 carousel generate gate', () => {
  let server;
  let baseUrl;
  let gatePath;
  let gateCached;
  let realGate;
  let insertCalls;

  before(async () => {
    gatePath = require.resolve('../services/ai_governance/route_gate');
    gateCached = require.cache[gatePath];
    realGate = gateCached.exports.gateRouteText;
    insertCalls = [];

    const https = require('node:https');
    const origRequest = https.request;
    https.request = function mockRequest(opts, cb) {
      const mockRes = {
        statusCode: 200,
        on(ev, fn) {
          if (ev === 'data') {
            fn(JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify(mockAiSlides({
                    body: PROHIBITED,
                  })),
                },
              }],
            }));
          }
          if (ev === 'end') fn();
          return this;
        },
      };
      const req = {
        on() { return this; },
        setTimeout() {},
        write() {},
        end() { cb(mockRes); },
        destroy() {},
      };
      return req;
    };

    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-key-not-dummy';

    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async (req) => (req.headers['x-test-tenant']
      ? Number(req.headers['x-test-tenant'])
      : 41);

    const _db = require('../db');
    _db.hasDb = () => true;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO carousels')) {
          insertCalls.push({ sql, params });
          return { rows: [{ id: 901 }] };
        }
        if (sql.includes('ORDER BY created_at DESC')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const apiPath = require.resolve('../services/carousel/api');
    delete require.cache[apiPath];
    const router = require('../services/carousel/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: Number(req.headers['x-test-tenant'] || 41) };
      next();
    });
    app.use('/api/carousel', router);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    global.__pr10h13RestoreHttps = () => { https.request = origRequest; };
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (gateCached && realGate) gateCached.exports.gateRouteText = realGate;
    if (global.__pr10h13RestoreHttps) global.__pr10h13RestoreHttps();
    delete require.cache[require.resolve('../services/carousel/api')];
  });

  async function generate(tenant = 41, topic = 'Analytics tips') {
    return fetch(`${baseUrl}/api/carousel/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': String(tenant) },
      body: JSON.stringify({ topic, structure: 'pure-info' }),
    });
  }

  it('blocks prohibited slide body before returning slides', async () => {
    insertCalls.length = 0;
    const res = await generate();
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.ok(body.error === 'content_safety_blocked' || body.error === 'content_safety_block');
    assert.ok(body.userMessage);
    assert.equal(body.slides, undefined);
    assert.equal(insertCalls.length, 0);
  });

  it('returns 503 without slides when gate scanner throws', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
    });
    insertCalls.length = 0;
    delete require.cache[require.resolve('../services/carousel/api')];
    const router = require('../services/carousel/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 41 };
      next();
    });
    app.use('/api/carousel', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/carousel/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '41' },
      body: JSON.stringify({ topic: 'Analytics tips', structure: 'pure-info' }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.slides, undefined);
    assert.equal(insertCalls.length, 0);

    await new Promise((r) => tmpServer.close(r));
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/carousel/api')];
  });

  it('returns normalized slides with content_safety_warnings on warning-only pass', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: ['Warning-only mode retained this caution.'],
      content_safety_warnings: ['Warning-only mode retained this caution.'],
    });

    const https = require('node:https');
    const origRequest = https.request;
    https.request = function mockRequest(opts, cb) {
      const mockRes = {
        statusCode: 200,
        on(ev, fn) {
          if (ev === 'data') {
            fn(JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify(mockAiSlides({
                    body: 'Clean body copy for the hook slide',
                  })),
                },
              }],
            }));
          }
          if (ev === 'end') fn();
          return this;
        },
      };
      return { on() { return this; }, setTimeout() {}, write() {}, end() { cb(mockRes); }, destroy() {} };
    };

    insertCalls.length = 0;
    delete require.cache[require.resolve('../services/carousel/api')];
    const router = require('../services/carousel/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 41 };
      next();
    });
    app.use('/api/carousel', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/carousel/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '41' },
      body: JSON.stringify({ topic: 'Analytics tips', structure: 'pure-info' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.slides));
    assert.equal(body.slides[0].nested, undefined);
    assert.deepEqual(body.content_safety_warnings, ['Warning-only mode retained this caution.']);
    assert.equal(insertCalls.length, 1);
    const meta = JSON.parse(insertCalls[0].params[6]);
    assert.deepEqual(meta.content_safety_warnings, ['Warning-only mode retained this caution.']);

    https.request = origRequest;
    gateCached.exports.gateRouteText = realGate;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/carousel/api')];
  });

  it('gates template fallback when OpenAI is unavailable', async () => {
    const prevKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    insertCalls.length = 0;

    delete require.cache[require.resolve('../services/carousel/api')];
    const router = require('../services/carousel/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 41 };
      next();
    });
    app.use('/api/carousel', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/carousel/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '41' },
      body: JSON.stringify({ topic: PROHIBITED, structure: 'pure-info' }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.slides, undefined);
    assert.equal(insertCalls.length, 0);

    if (prevKey) process.env.AI_INTEGRATIONS_OPENAI_API_KEY = prevKey;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/carousel/api')];
  });

  it('requires tenant context before generation', async () => {
    const tenantCtx = require('../services/tenants/context');
    const origResolve = tenantCtx.resolveTenantId;
    tenantCtx.resolveTenantId = async () => null;
    delete require.cache[require.resolve('../services/carousel/api')];
    const router = require('../services/carousel/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 55, name: 'Test', slug: 'test', status: 'active' };
      next();
    });
    app.use('/api/carousel', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/carousel/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '55' },
      body: JSON.stringify({ topic: 'Analytics tips', structure: 'pure-info' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'no_tenant');

    tenantCtx.resolveTenantId = origResolve;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/carousel/api')];
  });

  it('rate limits repeated generate calls per tenant and user', async () => {
    const prevMax = process.env.CAROUSEL_GENERATE_RATE_LIMIT_MAX;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.CAROUSEL_GENERATE_RATE_LIMIT_MAX = '1';
    delete require.cache[require.resolve('../services/carousel/api')];
    delete require.cache[require.resolve('../services/security/rate_limit')];

    gateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: [],
      content_safety_warnings: [],
    });

    const https = require('node:https');
    const origRequest = https.request;
    https.request = function mockRequest(opts, cb) {
      const mockRes = {
        statusCode: 200,
        on(ev, fn) {
          if (ev === 'data') {
            fn(JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify(mockAiSlides({ body: 'Clean hook body' })),
                },
              }],
            }));
          }
          if (ev === 'end') fn();
          return this;
        },
      };
      return { on() { return this; }, setTimeout() {}, write() {}, end() { cb(mockRes); }, destroy() {} };
    };

    const router = require('../services/carousel/api');
    router.stack.find((layer) => layer.route?.path === '/generate')
      ?.route.stack[0].handle.reset?.();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 77 };
      req.tenant = { id: 88 };
      next();
    });
    app.use('/api/carousel', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;
    const payload = { topic: 'Analytics tips', structure: 'pure-info' };

    const first = await fetch(`${tmpUrl}/api/carousel/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '88' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${tmpUrl}/api/carousel/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '88' },
      body: JSON.stringify(payload),
    });
    const body = await second.json();
    assert.equal(second.status, 429);
    assert.equal(body.error, 'rate_limited');

    https.request = origRequest;
    gateCached.exports.gateRouteText = realGate;
    if (prevMax === undefined) delete process.env.CAROUSEL_GENERATE_RATE_LIMIT_MAX;
    else process.env.CAROUSEL_GENERATE_RATE_LIMIT_MAX = prevMax;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/carousel/api')];
    delete require.cache[require.resolve('../services/security/rate_limit')];
  });

  it('restores content_safety_warnings when loading a saved carousel', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: ['Persisted carousel warning.'],
      content_safety_warnings: ['Persisted carousel warning.'],
    });

    const _db = require('../db');
    _db.hasDb = () => true;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO carousels')) {
          return { rows: [{ id: 77 }] };
        }
        if (sql.includes('SELECT * FROM carousels WHERE id')) {
          const id = params[0];
          const tid = params[1];
          if (id === 77 && tid === 41) {
            return {
              rows: [{
                id: 77,
                tenant_id: 41,
                topic: 'Saved topic',
                structure: 'pure-info',
                slides: [SAFE_SLIDE],
                meta: {
                  source: 'template',
                  structureLabel: 'Pure Info',
                  content_safety_warnings: ['Persisted carousel warning.'],
                },
              }],
            };
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    delete require.cache[require.resolve('../services/carousel/api')];
    const router = require('../services/carousel/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 41 };
      next();
    });
    app.use('/api/carousel', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/carousel/77`, {
      headers: { 'x-test-tenant': '41' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.content_safety_warnings, ['Persisted carousel warning.']);

    gateCached.exports.gateRouteText = realGate;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/carousel/api')];
  });

  it('enforces tenant isolation on carousel load', async () => {
    const _db = require('../db');
    _db.hasDb = () => true;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('SELECT * FROM carousels WHERE id')) {
          const tid = params[1];
          if (tid === 41) {
            return {
              rows: [{
                id: 77,
                tenant_id: 41,
                topic: 'Tenant A carousel',
                structure: 'pure-info',
                slides: [SAFE_SLIDE],
                meta: { source: 'template', content_safety_warnings: [] },
              }],
            };
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    delete require.cache[require.resolve('../services/carousel/api')];
    const router = require('../services/carousel/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: Number(req.headers['x-test-tenant'] || 41) };
      next();
    });
    app.use('/api/carousel', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const own = await fetch(`${tmpUrl}/api/carousel/77`, {
      headers: { 'x-test-tenant': '41' },
    });
    assert.equal(own.status, 200);

    const other = await fetch(`${tmpUrl}/api/carousel/77`, {
      headers: { 'x-test-tenant': '99' },
    });
    assert.equal(other.status, 404);

    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/carousel/api')];
  });
});

describe('PR10H.13 blocked responses omit usable slides', () => {
  it('contentSafetyHttpBody never includes slides', () => {
    const body = contentSafetyHttpBody({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['warn'],
    });
    assert.equal(body.slides, undefined);
    assert.equal(body.ok, false);
    assert.ok(body.userMessage);
  });

  it('normalizeCarouselSlideItem clamps slide number', () => {
    const item = normalizeCarouselSlideItem({ n: 99, role: 'Hook', headline: 'x' }, 3, 'Hook');
    assert.equal(item.n, 10);
  });
});
