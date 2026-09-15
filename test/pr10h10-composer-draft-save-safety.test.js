// test/pr10h10-composer-draft-save-safety.test.js — PR10H.10 acceptance
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');

const {
  gateRouteText,
  contentSafetyHttpBody,
} = require('../services/ai_governance/route_gate');
const { composerDraftGateText } = require('../services/ai_governance/content_schemas');

const PROHIBITED = 'guaranteed 100% returns with zero risk';

const BASE_DRAFT = {
  campaign_name: 'Onboarding nurture',
  audience_description: 'Recent signups',
  audience_rules: { match: 'all', conditions: [] },
  channel: 'email',
  subject: 'Your onboarding guide',
  body: 'Here is a helpful walkthrough of our product.',
  recommended_send_time: 'Tuesday 10am',
  rationale: 'Target engaged signups',
  source: 'openai',
};

describe('PR10H.10 scope — composer draft save gate (Step 6 partial)', () => {
  it('documents gated update path in campaign_composer api', () => {
    const composer = fs.readFileSync(require.resolve('../services/campaign_composer/api'), 'utf8');
    assert.match(composer, /campaign-composer:update/);
    assert.match(composer, /gateRouteText/);
    assert.match(composer, /content_safety_warnings = \$2/);
    assert.match(composer, /createRateLimiter/);
    assert.match(composer, /codeql\[js\/missing-rate-limiting\]/);
    assert.match(composer, /composerDraftUpdateLimiter/);
  });

  it('does not claim whole-Step-6 completion', () => {
    const step6 = fs.readFileSync(require.resolve('./pr10h5-step6-content-gates.test.js'), 'utf8');
    assert.doesNotMatch(step6, /Step 6:\s*Done/i);
  });
});

describe('PR10H.10 composer draft save gate', () => {
  let server;
  let baseUrl;
  let gatePath;
  let gateCached;
  let realGate;
  let storedRow;
  let updateCalls;

  before(async () => {
    gatePath = require.resolve('../services/ai_governance/route_gate');
    gateCached = require.cache[gatePath];
    realGate = gateCached.exports.gateRouteText;

    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async (req) => req.headers['x-test-tenant']
      ? Number(req.headers['x-test-tenant'])
      : 11;

    storedRow = {
      id: 42,
      tenant_id: 11,
      prompt: 'Nurture recent signups',
      draft: { ...BASE_DRAFT },
      content_safety_warnings: ['Existing warning should remain on block'],
      status: 'draft',
      segment_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    updateCalls = [];

    const _db = require('../db');
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('SELECT * FROM campaign_composer_drafts')) {
          const id = params[0];
          const tid = params[1];
          if (storedRow.id === id && storedRow.tenant_id === tid && storedRow.status === 'draft') {
            return { rows: [{ ...storedRow, draft: { ...storedRow.draft } }] };
          }
          return { rows: [] };
        }
        if (sql.includes('UPDATE campaign_composer_drafts')) {
          updateCalls.push({ sql, params });
          const id = params[2];
          const tid = params[3];
          if (storedRow.id === id && storedRow.tenant_id === tid) {
            storedRow = {
              ...storedRow,
              draft: JSON.parse(params[0]),
              content_safety_warnings: JSON.parse(params[1]),
              updated_at: new Date().toISOString(),
            };
            return { rows: [{ ...storedRow }] };
          }
          return { rows: [] };
        }
        if (sql.includes('ORDER BY created_at DESC')) {
          return { rows: storedRow.tenant_id === params[0] ? [{ ...storedRow }] : [] };
        }
        return { rows: [] };
      },
    });

    delete require.cache[require.resolve('../services/campaign_composer/api')];
    const router = require('../services/campaign_composer/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const tid = Number(req.headers['x-test-tenant'] || 11);
      req.user = { id: 3 };
      req.tenant = tid ? { id: tid, name: 'Test', slug: 'test', status: 'active' } : null;
      next();
    });
    app.use('/api/campaign-composer', router);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (gateCached && realGate) gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/campaign_composer/api')];
  });

  async function saveDraft(draft, tenant = 11) {
    return fetch(`${baseUrl}/api/campaign-composer/drafts/42`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-test-tenant': String(tenant),
      },
      body: JSON.stringify({ draft }),
    });
  }

  it('blocks prohibited body text before persistence', async () => {
    updateCalls.length = 0;
    const res = await saveDraft({ ...BASE_DRAFT, body: PROHIBITED });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.draft, undefined);
    assert.equal(updateCalls.length, 0);
    assert.equal(storedRow.draft.body, BASE_DRAFT.body);
  });

  it('blocks prohibited content in audience_rules condition value', async () => {
    updateCalls.length = 0;
    const res = await saveDraft({
      ...BASE_DRAFT,
      audience_rules: {
        match: 'all',
        conditions: [{ type: 'trait', field: 'status', op: 'equals', value: PROHIBITED }],
      },
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.draft, undefined);
    assert.equal(updateCalls.length, 0);
  });

  it('scans all retained editable fields via composerDraftGateText', () => {
    const text = composerDraftGateText({
      ...BASE_DRAFT,
      campaign_name: 'Name',
      audience_description: 'Audience',
      subject: 'Subject',
      body: 'Body',
      recommended_send_time: 'Monday',
      rationale: 'Why',
      audience_rules: {
        match: 'all',
        conditions: [{ type: 'trait', field: 'tier', op: 'equals', value: 'vip' }],
      },
    });
    assert.match(text, /Name/);
    assert.match(text, /Audience/);
    assert.match(text, /Subject/);
    assert.match(text, /Body/);
    assert.match(text, /Monday/);
    assert.match(text, /Why/);
    assert.match(text, /vip/);
  });

  it('returns 503 without updating when gate scanner throws', async () => {
    gateCached.exports.gateRouteText = async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
    });
    delete require.cache[require.resolve('../services/campaign_composer/api')];
    const router = require('../services/campaign_composer/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const tid = Number(req.headers['x-test-tenant'] || 11);
      req.user = { id: 3 };
      req.tenant = tid ? { id: tid, name: 'Test', slug: 'test', status: 'active' } : null;
      next();
    });
    app.use('/api/campaign-composer', router);
    const tmpServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const tmpUrl = `http://127.0.0.1:${tmpServer.address().port}`;

    updateCalls.length = 0;
    const res = await fetch(`${tmpUrl}/api/campaign-composer/drafts/42`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '11' },
      body: JSON.stringify({ draft: BASE_DRAFT }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.draft, undefined);
    assert.equal(updateCalls.length, 0);

    await new Promise((r) => tmpServer.close(r));
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/campaign_composer/api')];
  });

  it('persists normalized draft on successful save', async () => {
    updateCalls.length = 0;
    const res = await saveDraft({
      ...BASE_DRAFT,
      campaign_name: 'Updated campaign name',
      extra: 'strip me',
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.draft.draft.campaign_name, 'Updated campaign name');
    assert.equal(body.draft.draft.extra, undefined);
    assert.equal(updateCalls.length, 1);
  });

  it('persists warning-only results with visible warnings', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({
      ...defaultPolicy(tid),
      content_safety_mode: 'warning_only',
      content_safety_explicit: true,
    });
    try {
      updateCalls.length = 0;
      const res = await saveDraft({ ...BASE_DRAFT, body: PROHIBITED });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.ok((body.content_safety_warnings || body.draft?.content_safety_warnings || []).length >= 1);
      assert.equal(body.draft.draft.body, PROHIBITED);
      assert.equal(updateCalls.length, 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
      storedRow.draft = { ...BASE_DRAFT };
      storedRow.content_safety_warnings = ['Existing warning should remain on block'];
    }
  });

  it('rejects cross-tenant draft updates without mutating stored row', async () => {
    updateCalls.length = 0;
    const before = JSON.stringify(storedRow.draft);
    const res = await saveDraft({ ...BASE_DRAFT, campaign_name: 'Tenant B takeover' }, 99);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.ok, false);
    assert.equal(updateCalls.length, 0);
    assert.equal(JSON.stringify(storedRow.draft), before);
  });
});

describe('PR10H.10 composer draft save rate limit', () => {
  const apiPath = require.resolve('../services/campaign_composer/api');
  const prevEnv = process.env.CAMPAIGN_COMPOSER_DRAFT_UPDATE_RATE_LIMIT_MAX;
  let server;
  let baseUrl;
  let updateCalls;
  let storedRow;

  function mountRouter() {
    delete require.cache[apiPath];
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async (req) => Number(req.headers['x-test-tenant'] || 11);

    storedRow = {
      id: 42,
      tenant_id: 11,
      prompt: 'Nurture recent signups',
      draft: { ...BASE_DRAFT },
      content_safety_warnings: [],
      status: 'draft',
      segment_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    updateCalls = [];

    const _db = require('../db');
    _db.getPool = () => ({
      query: async (sql, params) => {
        if (sql.includes('SELECT * FROM campaign_composer_drafts')) {
          const id = params[0];
          const tid = params[1];
          if (storedRow.id === id && storedRow.tenant_id === tid && storedRow.status === 'draft') {
            return { rows: [{ ...storedRow, draft: { ...storedRow.draft } }] };
          }
          return { rows: [] };
        }
        if (sql.includes('UPDATE campaign_composer_drafts')) {
          updateCalls.push({ sql, params });
          const id = params[2];
          const tid = params[3];
          if (storedRow.id === id && storedRow.tenant_id === tid) {
            storedRow = {
              ...storedRow,
              draft: JSON.parse(params[0]),
              content_safety_warnings: JSON.parse(params[1]),
              updated_at: new Date().toISOString(),
            };
            return { rows: [{ ...storedRow }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const router = require(apiPath);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const tid = Number(req.headers['x-test-tenant'] || 11);
      req.user = { id: 3 };
      req.tenant = tid ? { id: tid, name: 'Test', slug: 'test', status: 'active' } : null;
      next();
    });
    app.use('/api/campaign-composer', router);
    return app;
  }

  async function putDraft(tenant = 11, body = BASE_DRAFT) {
    return fetch(`${baseUrl}/api/campaign-composer/drafts/42`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-test-tenant': String(tenant),
      },
      body: JSON.stringify({ draft: body }),
    });
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.CAMPAIGN_COMPOSER_DRAFT_UPDATE_RATE_LIMIT_MAX = '2';
    const app = mountRouter();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[apiPath];
    if (prevEnv === undefined) delete process.env.CAMPAIGN_COMPOSER_DRAFT_UPDATE_RATE_LIMIT_MAX;
    else process.env.CAMPAIGN_COMPOSER_DRAFT_UPDATE_RATE_LIMIT_MAX = prevEnv;
  });

  it('returns 429 without updating the draft after the tenant bucket is exhausted', async () => {
    updateCalls.length = 0;
    assert.equal((await putDraft()).status, 200);
    assert.equal((await putDraft()).status, 200);
    const limited = await putDraft();
    const body = await limited.json();
    assert.equal(limited.status, 429);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'rate_limited');
    assert.equal(updateCalls.length, 2);
  });

  it('keeps separate tenant buckets so tenant B is not 429 when tenant A is exhausted', async () => {
    storedRow = {
      ...storedRow,
      tenant_id: 12,
      draft: { ...BASE_DRAFT, campaign_name: 'Tenant twelve draft' },
    };
    updateCalls.length = 0;

    assert.equal((await putDraft(11)).status, 429);
    assert.equal((await putDraft(11)).status, 429);
    const tenantB = await putDraft(12, { ...BASE_DRAFT, campaign_name: 'Tenant twelve draft' });
    const body = await tenantB.json();
    assert.equal(tenantB.status, 200);
    assert.equal(body.ok, true);
    assert.equal(updateCalls.length, 1);
    assert.equal(storedRow.tenant_id, 12);
  });
});

describe('PR10H.10 blocked responses omit usable content', () => {
  it('contentSafetyHttpBody never includes composer draft fields', () => {
    const body = contentSafetyHttpBody({
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['x'],
    });
    assert.equal(body.draft, undefined);
    assert.equal(body.ok, false);
  });
});

describe('PR10H.10 UI coverage notes', () => {
  it('CampaignComposer save safety UI is covered by pr10h10-composer-draft-save-safety-ui.test.js', () => {
    const rendered = fs.readFileSync(
      require.resolve('./pr10h10-composer-draft-save-safety-ui.test.js'),
      'utf8',
    );
    assert.match(rendered, /role="alert"/);
    assert.match(rendered, /content_safety_blocked/);
    assert.match(rendered, /content_safety_unavailable/);
    assert.match(rendered, /Save Changes/);
    assert.match(rendered, /switching drafts clears the prior draft save alert/);
    assert.match(rendered, /preserves edits made while a save is in flight/);
  });
});

describe('PR10H.10 warning-only mode preserves warnings', () => {
  it('gateRouteText returns warnings for prohibited composer draft text in warning_only mode', async () => {
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
        text: composerDraftGateText({ ...BASE_DRAFT, body: PROHIBITED }),
        surface: 'campaign_composer',
      });
      assert.equal(out.ok, true);
      assert.ok((out.warnings || out.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});
