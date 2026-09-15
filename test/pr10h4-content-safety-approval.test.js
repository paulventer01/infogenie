// test/pr10h4-content-safety-approval.test.js — PR10H.4 acceptance
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const express = require('express');
const {
  gateRouteText,
  isContentSafetyError,
  contentSafetyHttpBody,
  contentSafetyUnavailableBody,
} = require('../services/ai_governance/route_gate');
const { scanOutput } = require('../services/ai_governance/output_gate');
const { govern } = require('../services/ai_governance/orchestrator');
const { defaultPolicy } = require('../services/ai_governance/policy');
const clientApprovals = require('../services/client_reporting/approvals');
const { assertApprovalFresh } = require('../services/agent_orchestrator/approvals');

describe('PR10H.4 route_gate helper', () => {
  it('blocks prohibited generated text', async () => {
    const out = await gateRouteText({
      tenantId: null,
      text: 'guaranteed 100% returns with zero risk',
      surface: 'ai_content',
    });
    assert.equal(out.ok, false);
    assert.ok(out.userMessage);
  });

  it('returns passing content', async () => {
    const out = await gateRouteText({
      tenantId: null,
      text: 'Schedule a product walkthrough with our team.',
      surface: 'ai_content',
    });
    assert.equal(out.ok, true);
    assert.equal(out.content, 'Schedule a product walkthrough with our team.');
  });

  it('isContentSafetyError recognises gate failures', () => {
    assert.equal(isContentSafetyError({ code: 'content_safety_blocked' }), true);
    assert.equal(isContentSafetyError({ code: 'other' }), false);
  });

  it('contentSafetyHttpBody omits usable content', () => {
    const body = contentSafetyHttpBody({
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['x'],
    });
    assert.equal(body.ok, false);
    assert.equal(body.content, undefined);
    assert.equal(body.plan, undefined);
  });
});

describe('PR10H.4 warning-only mode retains visible warnings', () => {
  it('returns content with warnings when tenant opts into warning_only', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    orch.loadPolicy = async (tid) => ({
      ...defaultPolicy(tid),
      content_safety_mode: 'warning_only',
      content_safety_explicit: true,
    });
    try {
      const out = await gateRouteText({
        tenantId: 1,
        text: 'guaranteed 100% returns with zero risk',
        surface: 'ai_content',
      });
      assert.equal(out.ok, true);
      assert.ok((out.warnings || out.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});

describe('PR10H.4 gate failure fails closed', () => {
  it('route_gate scanner throw returns content_safety_unavailable without content', async () => {
    const gatePath = require.resolve('../services/ai_governance/output_gate');
    const gateCached = require.cache[gatePath];
    const realScan = gateCached.exports.scanOutput;
    gateCached.exports.scanOutput = () => { throw new Error('gate_down'); };
    try {
      const out = await gateRouteText({
        tenantId: 1,
        text: 'hello world',
        surface: 'ai_content',
      });
      assert.equal(out.ok, false);
      assert.equal(out.error, 'content_safety_unavailable');
      assert.equal(out.content, undefined);
      const body = contentSafetyUnavailableBody();
      assert.equal(body.error, 'content_safety_unavailable');
      assert.equal(body.content, undefined);
    } finally {
      gateCached.exports.scanOutput = realScan;
    }
  });

  it('orchestrator errors fail closed for content paths', async () => {
    const gatePath = require.resolve('../services/ai_governance/output_gate');
    const gateCached = require.cache[gatePath];
    const realScan = gateCached.exports.scanOutput;
    gateCached.exports.scanOutput = () => { throw new Error('gate_down'); };
    try {
      const result = await govern({
        tenantId: 1,
        surface: 'ai_content',
        action: 'generate_content',
        payload: { text: 'hello' },
        failClosed: true,
      });
      assert.equal(result.proceeded, false);
      assert.match(result.userMessage, /unavailable/i);
    } finally {
      gateCached.exports.scanOutput = realScan;
    }
  });
});

describe('PR10H.4 skipContentGate bypass removed', () => {
  it('chat_router no longer accepts caller-controlled skipContentGate', () => {
    const src = fs.readFileSync(require.resolve('../services/ai/chat_router'), 'utf8');
    assert.equal(src.includes('skipContentGate'), false);
  });
});

describe('PR10H.4 re-engage route gate unavailable', () => {
  let server;
  let baseUrl;
  let gatePath;
  let gateCached;
  let realScan;

  before(async () => {
    gatePath = require.resolve('../services/ai_governance/output_gate');
    gateCached = require.cache[gatePath];
    realScan = gateCached.exports.scanOutput;

    const register = require('../services/ai_content/routes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.tenant = { id: 1 };
      req.user = { id: 1 };
      next();
    });
    register(app, {
      _tkvCtx: { resolveTenantId: async () => 1 },
      _tkvRead: async () => [],
      _tkvWrite: async () => true,
      anthropic: { messages: { create: async () => { throw new Error('unused'); } } },
      callDataForSEO: async () => { throw new Error('unused'); },
      callRapidAPI: async () => { throw new Error('unused'); },
      getDataForSEOAuth: () => '',
      getRapidApiKey: () => '',
      https: require('node:https'),
      loadAivisHistory: async () => ({}),
      openai: {
        chat: {
          completions: {
            create: async () => ({
              choices: [{
                message: {
                  content: JSON.stringify({
                    email: { subject: 'We miss you', body: 'Hi there' },
                    ad: { headline: 'Come back', body: 'See what is new', cta: 'Return' },
                    social: 'Hi — we would love to reconnect.',
                  }),
                },
              }],
            }),
          },
        },
      },
      path: require('node:path'),
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (gateCached && realScan) gateCached.exports.scanOutput = realScan;
  });

  it('POST /api/reengage-copy returns 503 with no fallback copy when scanner throws', async () => {
    gateCached.exports.scanOutput = () => { throw new Error('scanner_down'); };
    const res = await fetch(`${baseUrl}/api/reengage-copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alex', company: 'Acme', channel: 'Email' }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.email, undefined);
    assert.equal(body.ad, undefined);
    assert.equal(body.social, undefined);
    assert.equal(body.counter, undefined);
  });
});

describe('PR10H.4 social publish duplicate guard', () => {
  it('rejects publish when draft is already published', async () => {
    const drafts = require('../services/social_drafts/api');
    drafts._resetMem();
    const tid = 42;
    const draft = await drafts._createForTenant(tid, {
      profile_id: 1,
      status: 'published',
      text: 'Already live',
      platforms: ['linkedin'],
      meta: { published_at: new Date().toISOString() },
    });
    const result = await drafts._approveAndPublish(tid, draft.id, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'already_published');
  });

  it('concurrent approve publishes externally only once', async () => {
    const drafts = require('../services/social_drafts/api');
    drafts._resetMem();
    const origPublish = drafts._publishViaZernio;
    let publishCalls = 0;
    drafts._publishViaZernio = async (req, draft) => {
      publishCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, post: { id: 'zernio_test_1' } };
    };
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
    try {
      const draft = await drafts._createForTenant(7, {
        profile_id: 'prof_concurrent',
        status: 'pending_approval',
        text: 'Concurrent publish test',
        platforms: ['linkedin'],
      });
      const results = await Promise.all([
        drafts._approveAndPublish(7, draft.id, {}),
        drafts._approveAndPublish(7, draft.id, {}),
        drafts._approveAndPublish(7, draft.id, {}),
      ]);
      assert.equal(publishCalls, 1);
      const published = results.filter((r) => r.ok && r.published);
      assert.equal(published.length, 1);
      const blocked = results.filter((r) => !r.ok && (r.error === 'publish_in_progress' || r.error === 'already_published'));
      assert.ok(blocked.length >= 2);
    } finally {
      drafts._publishViaZernio = origPublish;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });
});

describe('PR10H.4 safe-agent warning-only warnings persist', () => {
  it('propose stores and returns content_safety_warnings from gate', async () => {
    const _db = require('../db');
    const origGetPool = _db.getPool;
    let insertedWarnings = null;
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO safe_agent_proposals')) {
          insertedWarnings = params[5];
          return { rows: [{ id: 501 }] };
        }
        if (sql.includes('INSERT INTO safe_agent_audit_log')) return { rows: [] };
        return { rows: [] };
      },
    });

    const routeGatePath = require.resolve('../services/ai_governance/route_gate');
    const routeGateCached = require.cache[routeGatePath];
    const origGate = routeGateCached.exports.gateRouteText;
    routeGateCached.exports.gateRouteText = async () => ({
      ok: true,
      warnings: ['Prohibited claim pattern detected'],
      content_safety_warnings: ['Prohibited claim pattern detected'],
    });

    const openaiPath = require.resolve('openai');
    const origOpenAI = require.cache[openaiPath]?.exports;
    require.cache[openaiPath] = {
      id: openaiPath,
      filename: openaiPath,
      loaded: true,
      exports: class MockOpenAI {
        constructor() {
          this.chat = {
            completions: {
              create: async () => ({
                choices: [{ message: { content: JSON.stringify({
                  title: 'Test proposal',
                  proposal: { actions: [{ step: 1, action: 'Test', channel: 'email', detail: 'x', estimated_cost: 0, reversible: true }], total_estimated_cost: 0, timeline: '1d', success_metrics: [], rollback_plan: 'undo' },
                  simulation: { expected_outcome: 'ok', confidence: 80, best_case: 'a', worst_case: 'b', risk_factors: [], estimated_revenue_impact: 0, estimated_roas_change: 0 },
                  safety_checks: [],
                  recommendation: 'review',
                  recommendation_reason: 'test',
                }) } }],
              }),
            },
          };
        }
      },
    };

    const tenantCtx = require('../services/tenants/context');
    const origResolve = tenantCtx.resolveTenantId;
    tenantCtx.resolveTenantId = async () => 9;

    const safeAgentPath = require.resolve('../services/safe_agent/api');
    delete require.cache[safeAgentPath];
    const safeAgentRouter = require('../services/safe_agent/api');

    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    expressApp.use('/api/safe-agent', safeAgentRouter);

    const server = await new Promise((resolve) => {
      const s = expressApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/safe-agent/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: 'Improve ROAS', budget_guardrail: 1000 }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(body.content_safety_warnings, ['Prohibited claim pattern detected']);
      assert.deepEqual(JSON.parse(insertedWarnings), ['Prohibited claim pattern detected']);
    } finally {
      await new Promise((r) => server.close(r));
      _db.getPool = origGetPool;
      routeGateCached.exports.gateRouteText = origGate;
      if (origOpenAI !== undefined) require.cache[openaiPath].exports = origOpenAI;
      else delete require.cache[openaiPath];
      delete require.cache[safeAgentPath];
      tenantCtx.resolveTenantId = origResolve;
    }
  });
});

describe('PR10H.4 client report approval scope', () => {
  it('content hash mismatch is rejected for portal approval binding', () => {
    assert.equal(clientApprovals.validContentHash('b'.repeat(64)), true);
    const good = clientApprovals.hashSnapshot({ headline: 'Q1 report' });
    const bad = clientApprovals.hashSnapshot({ headline: 'Q2 report' });
    assert.notEqual(good, bad);
  });

  it('orchestrator approval gate rejects scope mismatch (report approval cannot authorise campaigns)', () => {
    const wf = {
      id: 'wf_test',
      version: 2,
      selected_platforms: ['meta'],
      advertising_budget: 1000,
      credit_ceiling_micros: '1000000000',
      currency: 'USD',
      target_markets: [],
      target_audiences: [],
      landing_page_url: '',
      offer: '',
      objective: '',
      product_or_service: '',
      research_plan: {},
    };
    const approval = {
      gate: 'research_execution',
      object_version: 2,
      content_hash: 'deadbeef',
      decision: 'approved',
    };
    assert.throws(
      () => assertApprovalFresh(wf, approval, 'campaign_publishing'),
      (err) => /approval_scope_mismatch/.test(err.message),
    );
  });
});

describe('PR10H.4 blocked output does not escape via fallback paths', () => {
  it('route_gate blocked result never includes usable content field', async () => {
    const out = await gateRouteText({
      tenantId: null,
      text: 'Contact us at 123-45-6789 for guaranteed risk-free returns',
    });
    assert.equal(out.ok, false);
    assert.equal(out.content, undefined);
    const body = contentSafetyHttpBody(out);
    assert.equal(body.content, undefined);
    assert.equal(body.plan, undefined);
  });
});

describe('PR10H.4 governSafe remains audit-only (not execution gate)', () => {
  it('governSafe on spine still fails open for audit', async () => {
    const { governSafe } = require('../services/ai_governance/hooks');
    const orchPath = require.resolve('../services/ai_governance/orchestrator');
    const orchCached = require.cache[orchPath];
    const origGovern = orchCached.exports.govern;
    orchCached.exports.govern = async () => { throw new Error('audit_down'); };
    try {
      const result = await governSafe({
        tenantId: 1,
        surface: 'marketing_spine',
        action: 'apply_calendar',
        payload: { title: 'calendar apply' },
      });
      assert.equal(result.proceeded, true);
      assert.equal(result.degraded, true);
    } finally {
      orchCached.exports.govern = origGovern;
    }
  });
});
