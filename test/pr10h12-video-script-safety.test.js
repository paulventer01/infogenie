// test/pr10h12-video-script-safety.test.js — PR10H.12 acceptance
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
  normalizeVideoScriptResult,
  normalizeVideoScriptItem,
  videoScriptGateText,
} = require('../services/ai_governance/content_schemas');

const PROHIBITED = 'guaranteed 100% returns with zero risk';

const SAFE_SCRIPT = {
  hook: 'Stop scrolling — this dashboard trick saves hours',
  body: [
    { line: 'Most teams miss these filters', onscreen_text: 'HIDDEN FILTERS', cue: 'screen capture' },
  ],
  cta: 'Try the demo today',
  estimated_duration_sec: 30,
  viral_pattern: 'curiosity_gap',
  hashtags: ['#analytics', '#productivity'],
};

function mockAiScript(overrides = {}) {
  return {
    scripts: [{
      ...SAFE_SCRIPT,
      ...overrides,
      body: overrides.body || SAFE_SCRIPT.body,
    }],
  };
}

describe('PR10H.12 scope — video script generate gate (Step 6 partial)', () => {
  it('documents gated generate path in video_script api', () => {
    const api = fs.readFileSync(require.resolve('../services/video_script/api'), 'utf8');
    assert.match(api, /video-script:generate/);
    assert.match(api, /gateRouteText/);
    assert.match(api, /normalizeVideoScriptResult/);
    assert.match(api, /videoScriptGateText/);
    assert.match(api, /content_safety_warnings/);
    assert.match(api, /videoScriptGenerateLimiter/);
    assert.match(api, /codeql\[js\/missing-rate-limiting\]/);
    assert.match(api, /resolveTenantId/);
  });

  it('does not claim whole-Step-6 completion', () => {
    const step6 = fs.readFileSync(require.resolve('./pr10h5-step6-content-gates.test.js'), 'utf8');
    assert.doesNotMatch(step6, /Step 6:\s*Done/i);
  });
});

describe('PR10H.12 content schema normalization', () => {
  it('strips unexpected nested keys from script body lines', () => {
    const norm = normalizeVideoScriptResult({
      scripts: [{
        hook: 'Hello',
        body: [{ line: 'spoken', onscreen_text: 'SCREEN', cue: 'zoom', nested: { evil: true } }],
        cta: 'Follow for more',
        extra: 'drop me',
      }],
    });
    assert.equal(norm.scripts.length, 1);
    assert.equal(norm.scripts[0].extra, undefined);
    assert.equal(norm.scripts[0].body[0].nested, undefined);
    assert.equal(norm.scripts[0].body[0].line, 'spoken');
  });

  it('scans all retained script text fields including hashtags and cues', () => {
    const text = videoScriptGateText([{
      hook: 'Hook line',
      body: [{ line: 'Body spoken', onscreen_text: 'ON SCREEN', cue: 'B-roll pan' }],
      cta: PROHIBITED,
      viral_pattern: 'listicle',
      hashtags: ['#safe'],
    }]);
    assert.match(text, /Hook line/);
    assert.match(text, /Body spoken/);
    assert.match(text, /ON SCREEN/);
    assert.match(text, /B-roll pan/);
    assert.match(text, /guaranteed 100% returns/);
    assert.match(text, /#safe/);
  });

  it('joins nested body fields with tab separators for scanning', () => {
    const text = videoScriptGateText([{
      hook: 'x',
      body: [{ line: 'line-a', onscreen_text: 'screen-b', cue: 'cue-c' }],
      cta: 'y',
    }]);
    assert.match(text, /line-a\tscreen-b\tcue-c/);
  });
});

describe('PR10H.12 video_script generate gate', () => {
  let server;
  let baseUrl;
  let gatePath;
  let gateCached;
  let realGate;

  before(async () => {
    gatePath = require.resolve('../services/ai_governance/route_gate');
    gateCached = require.cache[gatePath];
    realGate = gateCached.exports.gateRouteText;

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
                  content: JSON.stringify(mockAiScript({
                    body: [{
                      line: 'We help teams ship faster',
                      onscreen_text: 'SHIP FASTER',
                      cue: 'talking head',
                    }],
                    cta: PROHIBITED,
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
      : 31);

    const apiPath = require.resolve('../services/video_script/api');
    delete require.cache[apiPath];
    const router = require('../services/video_script/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: Number(req.headers['x-test-tenant'] || 31) };
      next();
    });
    app.use('/api/video-script', router);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    global.__pr10h12RestoreHttps = () => { https.request = origRequest; };
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (gateCached && realGate) gateCached.exports.gateRouteText = realGate;
    if (global.__pr10h12RestoreHttps) global.__pr10h12RestoreHttps();
    delete require.cache[require.resolve('../services/video_script/api')];
  });

  async function generate(tenant = 31) {
    return fetch(`${baseUrl}/api/video-script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': String(tenant) },
      body: JSON.stringify({ topic: 'Analytics tips', platform: 'tiktok', tone: 'energetic', duration: 30, count: 1 }),
    });
  }

  it('blocks prohibited cta text before returning scripts', async () => {
    const res = await generate();
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.ok(body.error === 'content_safety_blocked' || body.error === 'content_safety_block');
    assert.ok(body.userMessage);
    assert.equal(body.scripts, undefined);
  });

  it('returns 503 without scripts when gate scanner throws', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
    });
    delete require.cache[require.resolve('../services/video_script/api')];
    const router = require('../services/video_script/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 31 };
      next();
    });
    app.use('/api/video-script', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/video-script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '31' },
      body: JSON.stringify({ topic: 'Analytics tips', platform: 'tiktok' }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.scripts, undefined);

    await new Promise((r) => tmpServer.close(r));
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/video_script/api')];
  });

  it('returns normalized scripts with content_safety_warnings on warning-only pass', async () => {
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
                  content: JSON.stringify(mockAiScript({
                    cta: 'Follow for more tips',
                    body: [{ line: 'Clean body copy', onscreen_text: 'CLEAN', cue: 'cutaway' }],
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

    delete require.cache[require.resolve('../services/video_script/api')];
    const router = require('../services/video_script/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 31 };
      next();
    });
    app.use('/api/video-script', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/video-script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '31' },
      body: JSON.stringify({ topic: 'Analytics tips', platform: 'tiktok', count: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.scripts));
    assert.equal(body.scripts.length, 1);
    assert.equal(body.scripts[0].body[0].nested, undefined);
    assert.deepEqual(body.content_safety_warnings, ['Warning-only mode retained this caution.']);

    https.request = origRequest;
    gateCached.exports.gateRouteText = realGate;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/video_script/api')];
  });

  it('blocks when prohibited content is only in onscreen_text with actual newline separators', async () => {
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
                  content: JSON.stringify(mockAiScript({
                    hook: 'Watch this',
                    cta: 'Save this post',
                    body: [{
                      line: 'Clean spoken line',
                      onscreen_text: 'guaranteed\nreturns',
                      cue: 'text overlay',
                    }],
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

    delete require.cache[require.resolve('../services/video_script/api')];
    const router = require('../services/video_script/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 31 };
      next();
    });
    app.use('/api/video-script', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/video-script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '31' },
      body: JSON.stringify({ topic: 'Analytics tips', platform: 'tiktok', count: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.scripts, undefined);

    https.request = origRequest;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/video_script/api')];
  });

  it('requires tenant context before generation', async () => {
    const tenantCtx = require('../services/tenants/context');
    const origResolve = tenantCtx.resolveTenantId;
    tenantCtx.resolveTenantId = async () => null;
    delete require.cache[require.resolve('../services/video_script/api')];
    const router = require('../services/video_script/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9 };
      req.tenant = { id: 55, name: 'Test', slug: 'test', status: 'active' };
      next();
    });
    app.use('/api/video-script', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/video-script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '55' },
      body: JSON.stringify({ topic: 'Analytics tips', platform: 'tiktok' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'no_tenant');

    tenantCtx.resolveTenantId = origResolve;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/video_script/api')];
  });

  it('rate limits repeated generate calls per tenant and user', async () => {
    const prevMax = process.env.VIDEO_SCRIPT_GENERATE_RATE_LIMIT_MAX;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.VIDEO_SCRIPT_GENERATE_RATE_LIMIT_MAX = '1';
    delete require.cache[require.resolve('../services/video_script/api')];
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
                  content: JSON.stringify(mockAiScript({ cta: 'Follow for more' })),
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

    const router = require('../services/video_script/api');
    router.stack.find((layer) => layer.route?.path === '/generate')
      ?.route.stack[0].handle.reset?.();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 77 };
      req.tenant = { id: 88 };
      next();
    });
    app.use('/api/video-script', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;
    const payload = { topic: 'Analytics tips', platform: 'tiktok', count: 1 };

    const first = await fetch(`${tmpUrl}/api/video-script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '88' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${tmpUrl}/api/video-script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '88' },
      body: JSON.stringify(payload),
    });
    const body = await second.json();
    assert.equal(second.status, 429);
    assert.equal(body.error, 'rate_limited');

    https.request = origRequest;
    gateCached.exports.gateRouteText = realGate;
    if (prevMax === undefined) delete process.env.VIDEO_SCRIPT_GENERATE_RATE_LIMIT_MAX;
    else process.env.VIDEO_SCRIPT_GENERATE_RATE_LIMIT_MAX = prevMax;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/video_script/api')];
    delete require.cache[require.resolve('../services/security/rate_limit')];
  });
});

describe('PR10H.12 blocked responses omit usable scripts', () => {
  it('contentSafetyHttpBody never includes scripts', () => {
    const body = contentSafetyHttpBody({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['warn'],
    });
    assert.equal(body.scripts, undefined);
    assert.equal(body.ok, false);
    assert.ok(body.userMessage);
  });
});
