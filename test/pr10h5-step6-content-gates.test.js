// test/pr10h5-step6-content-gates.test.js — Step 6 content-generation gates
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');

const {
  gateRouteText,
  contentSafetyHttpBody,
} = require('../services/ai_governance/route_gate');
const { governSafe } = require('../services/ai_governance/hooks');

describe('Step 6 inventory — surface classification', () => {
  it('launch_compliance proofread and campaign_composer generate are content paths', () => {
    const src = fs.readFileSync(require.resolve('../services/launch_compliance/api'), 'utf8');
    assert.match(src, /gateRouteText/);
    assert.match(src, /compliance:proofread/);
    const composer = fs.readFileSync(require.resolve('../services/campaign_composer/api'), 'utf8');
    assert.match(composer, /gateRouteText/);
    assert.match(composer, /campaign-composer:generate/);
  });

  it('market_signals publishable paths use gateRouteText', () => {
    const src = fs.readFileSync(require.resolve('../services/market_signals/routes'), 'utf8');
    assert.match(src, /reddit-reply:generate/);
    assert.match(src, /ai-channel-ad:generate/);
    assert.match(src, /reddit-studio-suggest:generate/);
    assert.match(src, /ai-content-clusters:generate/);
    assert.match(src, /reddit-monitor:ai-signals/);
  });

  it('brand-check uses governSafe audit-only (not gateRouteText block)', () => {
    const src = fs.readFileSync(require.resolve('../services/launch_compliance/api'), 'utf8');
    assert.match(src, /brand-check[\s\S]*governSafe/);
    assert.doesNotMatch(src, /brand-check[\s\S]*gateRouteText/);
  });
});

describe('Step 6 campaign_composer generate gate', () => {
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
                  content: JSON.stringify({
                    campaign_name: 'Risk-free ROI blast',
                    audience_description: 'Everyone',
                    audience_rules: { match: 'all', conditions: [] },
                    channel: 'email',
                    subject: 'Guaranteed 100% returns with zero risk',
                    body: 'Act now for guaranteed profit.',
                    recommended_send_time: 'Tuesday 10am',
                    rationale: 'High urgency',
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
    tenantCtx.resolveTenantId = async () => 11;

    const _db = require('../db');
    let inserted = null;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO campaign_composer_drafts')) {
          inserted = params;
          return { rows: [{ id: 99, tenant_id: params[0], prompt: params[1], draft: JSON.parse(params[2]) }] };
        }
        return { rows: [] };
      },
    });

    const router = require('../services/campaign_composer/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 3 }; next(); });
    app.use('/api/campaign-composer', router);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    global.__step6Inserted = () => inserted;
    global.__step6RestoreHttps = () => { https.request = origRequest; };
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (gateCached && realGate) gateCached.exports.gateRouteText = realGate;
    if (global.__step6RestoreHttps) global.__step6RestoreHttps();
    delete require.cache[require.resolve('../services/campaign_composer/api')];
  });

  it('blocks prohibited draft before persistence', async () => {
    const res = await fetch(`${baseUrl}/api/campaign-composer/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Promote crypto with guaranteed returns' }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.ok(body.error === 'content_safety_blocked' || body.error === 'content_safety_block');
    assert.equal(body.draft, undefined);
    assert.equal(global.__step6Inserted(), null);
  });

  it('returns 503 without template draft when gate scanner throws', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'unavailable',
    });
    delete require.cache[require.resolve('../services/campaign_composer/api')];
    const router = require('../services/campaign_composer/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 3 }; next(); });
    app.use('/api/campaign-composer', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;
    const res = await fetch(`${tmpUrl}/api/campaign-composer/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Weekly newsletter' }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.draft, undefined);
    await new Promise((r) => tmpServer.close(r));
    gateCached.exports.gateRouteText = realGate;
  });
});

describe('Step 6 launch_compliance proofread gate', () => {
  let server;
  let baseUrl;

  before(async () => {
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async () => 12;

    const _db = require('../db');
    let updatedFeedback = null;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('SELECT * FROM campaign_compliance_checklists')) {
          return { rows: [{ id: 5, ad_copy: 'Buy now for guaranteed 100% returns with zero risk.' }] };
        }
        if (sql.includes('UPDATE campaign_compliance_checklists SET ai_feedback')) {
          updatedFeedback = params[0];
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    global._openaiClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  overall_score: 3,
                  issues: [{ severity: 'error', text: 'Prohibited claim' }],
                  improved_copy: 'Guaranteed 100% returns with zero risk — act now!',
                  summary: 'Contains prohibited claims',
                }),
              },
            }],
          }),
        },
      },
    };

    const router = require('../services/launch_compliance/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 2 }; next(); });
    app.use('/api/launch-compliance', router);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    global.__step6UpdatedFeedback = () => updatedFeedback;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete global._openaiClient;
    delete require.cache[require.resolve('../services/launch_compliance/api')];
  });

  it('blocks proofread feedback before DB persist', async () => {
    const res = await fetch(`${baseUrl}/api/launch-compliance/checklists/5/proofread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.feedback, undefined);
    assert.equal(global.__step6UpdatedFeedback(), null);
  });
});

describe('Step 6 market_signals reddit-reply gate', () => {
  let server;
  let baseUrl;

  before(async () => {
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async () => 13;

    const register = require('../services/market_signals/routes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 4 }; next(); });
    register(app, {
      _chargeBudget: () => {},
      anthropic: { messages: { create: async () => { throw new Error('unused'); } } },
      callDataForSEO: async () => { throw new Error('unused'); },
      callRapidAPI: async () => { throw new Error('unused'); },
      https: require('node:https'),
      openai: {
        chat: {
          completions: {
            create: async () => ({
              choices: [{
                message: {
                  content: JSON.stringify({
                    reply: 'Contact us for guaranteed 100% returns with zero risk.',
                    tone_note: 'test',
                  }),
                },
              }],
            }),
          },
        },
      },
      openaiChatWithRetry: async () => { throw new Error('unused'); },
    });

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[require.resolve('../services/market_signals/routes')];
  });

  it('blocks reddit reply before return', async () => {
    const res = await fetch(`${baseUrl}/api/reddit-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postTitle: 'Best broker?', brand: 'Acme', industry: 'finance' }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.reply, undefined);
    assert.ok(body.error === 'content_safety_blocked' || body.error === 'content_safety_block');
  });
});

describe('Step 6 governSafe remains audit-only on approve paths', () => {
  it('governSafe fails open when orchestrator throws (campaign_composer approve audit)', async () => {
    const orchPath = require.resolve('../services/ai_governance/orchestrator');
    const orchCached = require.cache[orchPath];
    const origGovern = orchCached.exports.govern;
    orchCached.exports.govern = async () => { throw new Error('audit_down'); };
    try {
      const result = await governSafe({
        tenantId: 1,
        surface: 'campaign_composer',
        action: 'launch_campaign',
        payload: { title: 'Approve draft', preview: 'segment create' },
      });
      assert.equal(result.proceeded, true);
      assert.equal(result.degraded, true);
    } finally {
      orchCached.exports.govern = origGovern;
    }
  });
});

describe('Step 6 gateRouteText warning-only preserves warnings', () => {
  it('returns warnings without blocking in warning_only tenant mode', async () => {
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
        text: 'guaranteed 100% returns with zero risk',
        surface: 'campaign_composer',
      });
      assert.equal(out.ok, true);
      assert.ok((out.warnings || out.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});

describe('Step 6 blocked responses omit usable content', () => {
  it('contentSafetyHttpBody never includes generated fields', () => {
    const body = contentSafetyHttpBody({
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['x'],
    });
    assert.equal(body.ad, undefined);
    assert.equal(body.reply, undefined);
    assert.equal(body.feedback, undefined);
    assert.equal(body.cluster, undefined);
  });
});
