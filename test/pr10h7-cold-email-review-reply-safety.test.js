// test/pr10h7-cold-email-review-reply-safety.test.js — PR10H.7 acceptance
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
  normalizeColdEmailSequence,
  coldEmailGateText,
  normalizeReviewReply,
} = require('../services/ai_governance/content_schemas');

describe('PR10H.7 scope — cold email and review reply gates (Step 6 partial)', () => {
  it('documents gated paths in cold_email and review_monitor reply_api', () => {
    const cold = fs.readFileSync(require.resolve('../services/cold_email/api'), 'utf8');
    const review = fs.readFileSync(require.resolve('../services/review_monitor/reply_api'), 'utf8');
    assert.match(cold, /gateRouteText/);
    assert.match(cold, /normalizeColdEmailSequence/);
    assert.match(cold, /content_safety_warnings/);
    assert.match(review, /gateRouteText/);
    assert.match(review, /normalizeReviewReply/);
    assert.match(review, /content_safety_warnings/);
  });

  it('does not claim whole-Step-6 completion', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    assert.doesNotMatch(src, /Step 6:\s*Done/i);
  });
});

describe('PR10H.7 content schema normalization', () => {
  it('strips unexpected nested keys from cold email items', () => {
    const norm = normalizeColdEmailSequence({
      emails: [{
        step: 1,
        subject: 'hello',
        body: 'Hi there',
        cta: 'Interested?',
        nested: { evil: true },
        extra: 'drop me',
      }],
    }, 'openai');
    assert.equal(norm.emails.length, 1);
    assert.equal(norm.emails[0].nested, undefined);
    assert.equal(norm.emails[0].extra, undefined);
    assert.equal(norm.emails[0].subject, 'hello');
  });

  it('scans all retained cold email text fields', () => {
    const text = coldEmailGateText([{
      step: 1,
      days_after_prev: 0,
      subject: 'Subject line',
      preview: 'Preview line',
      body: 'Body copy',
      cta: 'guaranteed 100% returns with zero risk',
      why_this_works: 'Rationale',
    }]);
    assert.match(text, /guaranteed 100% returns/);
    assert.match(text, /Subject line/);
    assert.match(text, /Rationale/);
  });

  it('normalizes review reply to allowed fields only', () => {
    const norm = normalizeReviewReply({
      reply: 'Thanks for your review!',
      tone: 'warm',
      meta: { hidden: true },
    }, 'openai');
    assert.equal(norm.reply, 'Thanks for your review!');
    assert.equal(norm.tone, undefined);
    assert.equal(norm.meta, undefined);
    assert.equal(norm.source, 'openai');
  });
});

describe('PR10H.7 cold_email generate gate', () => {
  let server;
  let baseUrl;
  let gatePath;
  let gateCached;
  let realGate;
  let inserted;

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
                  content: JSON.stringify({
                    emails: [{
                      step: 1,
                      days_after_prev: 0,
                      subject: 'quick roi question',
                      preview: 'One idea for your team',
                      body: 'Hi — we offer guaranteed 100% returns with zero risk on every deal.',
                      cta: 'Worth a call?',
                      why_this_works: 'Direct value prop',
                      nested: { drop: true },
                    }],
                  }),
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
    tenantCtx.resolveTenantId = async () => 21;

    const _db = require('../db');
    inserted = null;
    _db.hasDb = () => true;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO cold_email_runs')) {
          inserted = params;
          return { rows: [{ id: 7 }] };
        }
        return { rows: [] };
      },
    });

    const router = require('../services/cold_email/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 4 }; next(); });
    app.use('/api/cold-email', router);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    global.__pr10h7RestoreHttps = () => { https.request = origRequest; };
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (gateCached && realGate) gateCached.exports.gateRouteText = realGate;
    if (global.__pr10h7RestoreHttps) global.__pr10h7RestoreHttps();
    delete require.cache[require.resolve('../services/cold_email/api')];
  });

  it('blocks prohibited primary body text before persistence', async () => {
    const res = await fetch(`${baseUrl}/api/cold-email/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_offer: 'SaaS platform', steps: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.ok(body.error === 'content_safety_blocked' || body.error === 'content_safety_block');
    assert.equal(body.emails, undefined);
    assert.equal(inserted, null);
  });

  it('blocks when prohibited content is only in secondary cta field', async () => {
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
                  content: JSON.stringify({
                    emails: [{
                      step: 1,
                      days_after_prev: 0,
                      subject: 'follow up',
                      preview: 'Checking in',
                      body: 'Hi — wanted to share a quick product update for your team.',
                      cta: 'guaranteed 100% returns with zero risk if you join this week',
                      why_this_works: 'Low friction ask',
                    }],
                  }),
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

    delete require.cache[require.resolve('../services/cold_email/api')];
    const router = require('../services/cold_email/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 4 }; next(); });
    app.use('/api/cold-email', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/cold-email/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_offer: 'SaaS platform', steps: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.emails, undefined);
    assert.equal(inserted, null);

    await new Promise((r) => tmpServer.close(r));
    https.request = origRequest;
    delete require.cache[require.resolve('../services/cold_email/api')];
  });

  it('returns 503 without template fallback when gate scanner fails', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'unavailable',
    });
    delete require.cache[require.resolve('../services/cold_email/api')];
    const router = require('../services/cold_email/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 4 }; next(); });
    app.use('/api/cold-email', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/cold-email/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_offer: 'SaaS platform', steps: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.emails, undefined);
    assert.equal(inserted, null);

    await new Promise((r) => tmpServer.close(r));
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/cold_email/api')];
  });

  it('persists content_safety_warnings and returns them on generate', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: ['Uncited metric or percentage detected — verify before external publish'],
      content_safety_warnings: ['Uncited metric or percentage detected — verify before external publish'],
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
                  content: JSON.stringify({
                    emails: [{
                      step: 1,
                      days_after_prev: 0,
                      subject: 'quick idea',
                      preview: 'Saw your team grew 15% last quarter',
                      body: 'Hi — sharing one idea that helped similar teams improve pipeline velocity.',
                      cta: 'Open to a short call?',
                      why_this_works: 'Specific trigger',
                    }],
                  }),
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

    delete require.cache[require.resolve('../services/cold_email/api')];
    const router = require('../services/cold_email/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 4 }; next(); });
    app.use('/api/cold-email', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/cold-email/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_offer: 'SaaS platform', steps: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.content_safety_warnings?.length >= 1);
    assert.ok(Array.isArray(body.emails));
    assert.equal(body.emails[0].nested, undefined);
    assert.ok(inserted);
    assert.equal(inserted[0], 21);
    const storedWarnings = JSON.parse(inserted[11]);
    assert.equal(storedWarnings.length, body.content_safety_warnings.length);

    await new Promise((r) => tmpServer.close(r));
    https.request = origRequest;
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/cold_email/api')];
  });
});

describe('PR10H.7 review reply generate gate', () => {
  let server;
  let baseUrl;
  let gatePath;
  let gateCached;
  let realGate;
  let inserted;
  let storedRows;

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
                message: { content: JSON.stringify({ reply: 'We guarantee 100% returns with zero risk — thanks for your review!' }) },
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
    tenantCtx.resolveTenantId = async () => 31;

    const _db = require('../db');
    inserted = null;
    storedRows = [];
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO review_reply_drafts')) {
          inserted = params;
          const row = {
            id: 55,
            tenant_id: params[0],
            platform: params[1],
            reviewer_name: params[2],
            rating: params[3],
            review_text: params[4],
            ai_draft_reply: params[5],
            source_review_id: params[6],
            content_safety_warnings: JSON.parse(params[7]),
            status: 'pending',
            created_at: new Date().toISOString(),
          };
          storedRows = [row];
          return { rows: [row] };
        }
        if (sql.includes('SELECT * FROM review_reply_drafts')) {
          return { rows: storedRows };
        }
        return { rows: [] };
      },
    });

    const router = require('../services/review_monitor/reply_api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 5 }; next(); });
    app.use('/api/review-monitor', router);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    global.__pr10h7ReviewRestoreHttps = () => { https.request = origRequest; };
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (gateCached && realGate) gateCached.exports.gateRouteText = realGate;
    if (global.__pr10h7ReviewRestoreHttps) global.__pr10h7ReviewRestoreHttps();
    delete require.cache[require.resolve('../services/review_monitor/reply_api')];
  });

  it('blocks prohibited reply before persistence', async () => {
    const res = await fetch(`${baseUrl}/api/review-monitor/replies/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_text: 'Great product', rating: 5 }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.draft, undefined);
    assert.equal(inserted, null);
  });

  it('returns unavailable without usable template fallback when gate fails', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'unavailable',
    });
    delete require.cache[require.resolve('../services/review_monitor/reply_api')];
    const router = require('../services/review_monitor/reply_api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 5 }; next(); });
    app.use('/api/review-monitor', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/review-monitor/replies/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_text: 'Okay service', rating: 3 }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.draft, undefined);
    assert.equal(inserted, null);

    await new Promise((r) => tmpServer.close(r));
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/review_monitor/reply_api')];
  });

  it('persists warnings and returns them on GET /replies reload', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: ['Uncited metric or percentage detected — verify before external publish'],
      content_safety_warnings: ['Uncited metric or percentage detected — verify before external publish'],
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
                message: { content: JSON.stringify({ reply: 'Thank you! We improved response times by 15% this quarter.' }) },
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

    delete require.cache[require.resolve('../services/review_monitor/reply_api')];
    const router = require('../services/review_monitor/reply_api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 5 }; next(); });
    app.use('/api/review-monitor', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const gen = await fetch(`${tmpUrl}/api/review-monitor/replies/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_text: 'Loved it', rating: 5 }),
    });
    const genBody = await gen.json();
    assert.equal(gen.ok, true);
    assert.ok(genBody.content_safety_warnings?.length >= 1);

    const list = await fetch(`${tmpUrl}/api/review-monitor/replies?status=pending`);
    const listBody = await list.json();
    assert.equal(listBody.drafts[0].content_safety_warnings?.length, genBody.content_safety_warnings.length);

    await new Promise((r) => tmpServer.close(r));
    https.request = origRequest;
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/review_monitor/reply_api')];
  });
});

describe('PR10H.7 tenant isolation for persisted records', () => {
  it('cold_email GET /:id scopes by tenant_id', async () => {
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async () => 99;

    const _db = require('../db');
    _db.hasDb = () => true;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('WHERE id=$1 AND tenant_id=$2')) {
          assert.equal(params[1], 99);
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const router = require('../services/cold_email/api');
    const app = express();
    app.use(express.json());
    app.use('/api/cold-email', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    const res = await fetch(`${tmpUrl}/api/cold-email/42`);
    assert.equal(res.status, 404);

    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/cold_email/api')];
  });

  it('review reply approve requires matching tenant_id', async () => {
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async () => 88;

    const _db = require('../db');
    let updateParams = null;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes("UPDATE review_reply_drafts SET status = 'approved'")) {
          updateParams = params;
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const router = require('../services/review_monitor/reply_api');
    const app = express();
    app.use(express.json());
    app.use('/api/review-monitor', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    await fetch(`${tmpUrl}/api/review-monitor/replies/12/approve`, { method: 'POST' });
    assert.deepEqual(updateParams, ['12', 88]);

    await new Promise((r) => tmpServer.close(r));
    delete require.cache[require.resolve('../services/review_monitor/reply_api')];
  });
});

describe('PR10H.7 UI — visible content safety warnings', () => {
  it('ColdEmail and ReviewAutomation render ContentSafetyWarnings banner', () => {
    const cold = fs.readFileSync(require.resolve('../components/features/create/ColdEmail.tsx'), 'utf8');
    const review = fs.readFileSync(require.resolve('../components/features/compete/ReviewAutomation.tsx'), 'utf8');
    const banner = fs.readFileSync(require.resolve('../components/layout/ContentSafetyWarnings.tsx'), 'utf8');
    assert.match(cold, /ContentSafetyWarnings/);
    assert.match(cold, /content_safety_warnings/);
    assert.match(review, /ContentSafetyWarnings/);
    assert.match(review, /content_safety_warnings/);
    assert.match(banner, /CONTENT SAFETY WARNINGS/);
  });
});

describe('PR10H.7 blocked responses omit usable content', () => {
  it('contentSafetyHttpBody never includes cold email or review draft fields', () => {
    const body = contentSafetyHttpBody({
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['x'],
    });
    assert.equal(body.emails, undefined);
    assert.equal(body.draft, undefined);
    assert.equal(body.ok, false);
  });
});

describe('PR10H.7 warning-only mode preserves warnings', () => {
  it('gateRouteText returns warnings for prohibited text in warning_only mode', async () => {
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
        text: coldEmailGateText([{
          step: 1,
          days_after_prev: 0,
          subject: 'hello',
          body: 'guaranteed 100% returns with zero risk',
        }]),
        surface: 'cold_email',
      });
      assert.equal(out.ok, true);
      assert.ok((out.warnings || out.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});
