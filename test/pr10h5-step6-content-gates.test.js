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

describe('Step 6 scope — three modules only (partial completion)', () => {
  it('documents gated paths in launch_compliance, campaign_composer, market_signals', () => {
    const composer = fs.readFileSync(require.resolve('../services/campaign_composer/api'), 'utf8');
    const compliance = fs.readFileSync(require.resolve('../services/launch_compliance/api'), 'utf8');
    const signals = fs.readFileSync(require.resolve('../services/market_signals/routes'), 'utf8');
    assert.match(composer, /content_safety_warnings/);
    assert.match(compliance, /content_safety_warnings/);
    assert.match(signals, /normalizeRedditReply/);
  });

  it('does not claim whole-Step-6 completion in test file', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    assert.doesNotMatch(src, /Step 6:\s*Done/i);
  });
});

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
    let storedRows = [];
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO campaign_composer_drafts')) {
          inserted = params;
          const row = {
            id: 99,
            tenant_id: params[0],
            prompt: params[1],
            draft: JSON.parse(params[2]),
            content_safety_warnings: JSON.parse(params[3]),
            status: 'draft',
            segment_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          storedRows = [row];
          return { rows: [row] };
        }
        if (sql.includes('SELECT * FROM campaign_composer_drafts')) {
          return { rows: storedRows };
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

  it('persists content_safety_warnings and returns them on GET /drafts reload', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: ['Uncited metric or percentage detected — verify before external publish'],
      content_safety_warnings: ['Uncited metric or percentage detected — verify before external publish'],
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

    const gen = await fetch(`${tmpUrl}/api/campaign-composer/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Newsletter with 15% off' }),
    });
    const genBody = await gen.json();
    assert.equal(gen.ok, true);
    assert.ok(genBody.content_safety_warnings?.length >= 1);

    const list = await fetch(`${tmpUrl}/api/campaign-composer/drafts`);
    const listBody = await list.json();
    assert.equal(listBody.drafts[0].content_safety_warnings?.length, genBody.content_safety_warnings.length);

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
    let updatedWarnings = null;
    let storedChecklist = {
      id: 5,
      ad_copy: 'Buy now for guaranteed 100% returns with zero risk.',
      ai_feedback: null,
      content_safety_warnings: [],
    };
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('SELECT * FROM campaign_compliance_checklists') && sql.includes('WHERE id=$1')) {
          return { rows: [storedChecklist] };
        }
        if (sql.includes('UPDATE campaign_compliance_checklists') && sql.includes('ai_feedback')) {
          updatedFeedback = params[0];
          updatedWarnings = params[1];
          storedChecklist = {
            ...storedChecklist,
            ai_feedback: JSON.parse(params[0]),
            content_safety_warnings: JSON.parse(params[1]),
          };
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

  it('persists content_safety_warnings and returns them on checklist GET reload', async () => {
    const gatePath = require.resolve('../services/ai_governance/route_gate');
    const gateCached = require.cache[gatePath];
    const realGate = gateCached.exports.gateRouteText;
    gateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: ['Content caution logged'],
      content_safety_warnings: ['Content caution logged'],
    });

    const prevOpenai = global._openaiClient;
    global._openaiClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  overall_score: 7,
                  issues: [],
                  improved_copy: 'Schedule a product walkthrough with our team.',
                  summary: 'Minor clarity tweaks suggested.',
                }),
              },
            }],
          }),
        },
      },
    };

    delete require.cache[require.resolve('../services/launch_compliance/api')];
    const router = require('../services/launch_compliance/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 2 }; next(); });
    app.use('/api/launch-compliance', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    try {
      const proof = await fetch(`${tmpUrl}/api/launch-compliance/checklists/5/proofread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const proofBody = await proof.json();
      assert.equal(proof.ok, true);
      assert.deepEqual(proofBody.content_safety_warnings, ['Content caution logged']);

      const get = await fetch(`${tmpUrl}/api/launch-compliance/checklists/5`);
      const getBody = await get.json();
      assert.deepEqual(getBody.checklist.content_safety_warnings, ['Content caution logged']);
    } finally {
      await new Promise((r) => tmpServer.close(r));
      gateCached.exports.gateRouteText = realGate;
      global._openaiClient = prevOpenai;
      delete require.cache[require.resolve('../services/launch_compliance/api')];
    }
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

  it('blocks when prohibited content is only in tone_note secondary field', async () => {
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
                    reply: 'Happy to share our onboarding guide if helpful.',
                    tone_note: 'guaranteed 100% returns with zero risk',
                  }),
                },
              }],
            }),
          },
        },
      },
      openaiChatWithRetry: async () => { throw new Error('unused'); },
    });
    const srv = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const url = `http://127.0.0.1:${srv.address().port}`;
    const res = await fetch(`${url}/api/reddit-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postTitle: 'Broker tips?', brand: 'Acme', industry: 'finance' }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.reply, undefined);
    assert.equal(body.tone_note, undefined);
    await new Promise((r) => srv.close(r));
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

  it('returns only allowed reddit-reply schema fields', async () => {
    const res = await fetch(`${baseUrl}/api/reddit-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postTitle: 'Tips?', brand: 'Acme', industry: 'saas' }),
    });
    if (res.status !== 200) return;
    const body = await res.json();
    assert.equal(Object.keys(body).sort().join(','), 'content_safety_warnings,reply,tone_note');
  });
});

describe('Step 6 UI — visible content safety warnings', () => {
  it('CampaignComposer and LaunchCompliance render ContentSafetyWarnings banner', () => {
    const composer = fs.readFileSync(require.resolve('../components/features/reach/CampaignComposer.tsx'), 'utf8');
    const compliance = fs.readFileSync(require.resolve('../components/features/grow/LaunchCompliance.tsx'), 'utf8');
    const banner = fs.readFileSync(require.resolve('../components/layout/ContentSafetyWarnings.tsx'), 'utf8');
    assert.match(composer, /ContentSafetyWarnings/);
    assert.match(composer, /content_safety_warnings/);
    assert.match(compliance, /ContentSafetyWarnings/);
    assert.match(compliance, /content_safety_warnings/);
    assert.match(banner, /CONTENT SAFETY WARNINGS/);
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
