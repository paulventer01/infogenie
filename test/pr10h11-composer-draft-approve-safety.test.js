// test/pr10h11-composer-draft-approve-safety.test.js — PR10H.11 acceptance
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const crypto = require('node:crypto');

require('./helpers/env');


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

function makeTxPool(state) {
  const tx = {
    active: false,
    locked: false,
  };

  const client = {
    query: async (sql, params) => {
      if (sql === 'BEGIN') {
        tx.active = true;
        return { rows: [] };
      }
      if (sql === 'ROLLBACK' || sql === 'COMMIT') {
        tx.active = false;
        tx.locked = false;
        return { rows: [] };
      }
      if (sql.includes('FOR UPDATE')) {
        const id = params[0];
        const tid = params[1];
        if (
          state.row.id === id
          && state.row.tenant_id === tid
          && state.row.status === 'draft'
          && !tx.locked
        ) {
          tx.locked = true;
          return { rows: [{ ...state.row, draft: { ...state.row.draft } }] };
        }
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO audience_segments')) {
        state.segmentInserts.push({ sql, params });
        const segmentId = ++state.nextSegmentId;
        return { rows: [{ id: segmentId }] };
      }
      if (sql.includes('SELECT * FROM campaign_composer_drafts') && !sql.includes('FOR UPDATE')) {
        const id = params[0];
        const tid = params[1];
        if (state.row.id === id && state.row.tenant_id === tid) {
          return { rows: [{ ...state.row, draft: { ...state.row.draft } }] };
        }
        return { rows: [] };
      }
      if (sql.includes("UPDATE campaign_composer_drafts SET status = 'approved'")) {
        state.approveUpdates.push({ sql, params });
        const id = params[2];
        const tid = params[3];
        if (state.row.id === id && state.row.tenant_id === tid && state.row.status === 'draft') {
          state.row = {
            ...state.row,
            status: 'approved',
            segment_id: params[0],
            content_safety_warnings: JSON.parse(params[1]),
            updated_at: new Date().toISOString(),
          };
          return { rows: [{ ...state.row }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  };

  return {
    query: async (sql, params) => {
      if (sql.includes('SELECT * FROM campaign_composer_drafts') && !sql.includes('FOR UPDATE')) {
        const id = params[0];
        const tid = params[1];
        if (state.row.id === id && state.row.tenant_id === tid) {
          return { rows: [{ ...state.row, draft: { ...state.row.draft } }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
    connect: async () => client,
    tx,
  };
}

describe('PR10H.11 scope — composer draft approve gate (Step 6 partial)', () => {
  it('documents gated approve path in campaign_composer api', () => {
    const composer = fs.readFileSync(require.resolve('../services/campaign_composer/api'), 'utf8');
    assert.match(composer, /campaign-composer:approve/);
    assert.match(composer, /FOR UPDATE/);
    assert.match(composer, /INSERT INTO audience_segments/);
    assert.match(composer, /composerDraftApproveLimiter/);
    assert.match(composer, /codeql\[js\/missing-rate-limiting\]/);
  });

  it('does not claim whole-Step-6 completion', () => {
    const step6 = fs.readFileSync(require.resolve('./pr10h5-step6-content-gates.test.js'), 'utf8');
    assert.doesNotMatch(step6, /Step 6:\s*Done/i);
  });
});

describe('PR10H.11 composer draft approve gate', () => {
  let server;
  let baseUrl;
  let gatePath;
  let gateCached;
  let realGate;
  let state;

  before(async () => {
    gatePath = require.resolve('../services/ai_governance/route_gate');
    require(gatePath);
    gateCached = require.cache[gatePath];
    realGate = gateCached.exports.gateRouteText;

    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async (req) => req.headers['x-test-tenant']
      ? Number(req.headers['x-test-tenant'])
      : 11;

    state = {
      row: {
        id: 42,
        tenant_id: 11,
        prompt: 'Nurture recent signups',
        draft: { ...BASE_DRAFT },
        content_safety_warnings: ['Existing warning should remain on block'],
        status: 'draft',
        segment_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      segmentInserts: [],
      approveUpdates: [],
      nextSegmentId: 500,
    };

    const _db = require('../db');
    _db.getPool = () => makeTxPool(state);

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

  async function postApprove(tenant = 11, draftId = 42) {
    return fetch(`${baseUrl}/api/campaign-composer/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-tenant': String(tenant),
      },
      body: JSON.stringify({}),
    });
  }

  it('blocks prohibited saved draft body before segment creation', async () => {
    state.row = {
      ...state.row,
      status: 'draft',
      segment_id: null,
      draft: { ...BASE_DRAFT, body: PROHIBITED },
    };
    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;

    const res = await postApprove();
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.draft, undefined);
    assert.equal(state.segmentInserts.length, 0);
    assert.equal(state.approveUpdates.length, 0);
    assert.equal(state.row.status, 'draft');
    assert.equal(state.row.segment_id, null);
  });

  it('returns 503 without segment or draft mutation when gate scanner throws', async () => {
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

    state.row = {
      ...state.row,
      status: 'draft',
      segment_id: null,
      draft: { ...BASE_DRAFT },
    };
    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;

    const res = await fetch(`${tmpUrl}/api/campaign-composer/drafts/42/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '11' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'content_safety_unavailable');
    assert.equal(body.draft, undefined);
    assert.equal(state.segmentInserts.length, 0);
    assert.equal(state.approveUpdates.length, 0);

    await new Promise((r) => tmpServer.close(r));
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[require.resolve('../services/campaign_composer/api')];
  });

  it('approves draft and creates segment atomically on success', async () => {
    state.row = {
      ...state.row,
      status: 'draft',
      segment_id: null,
      draft: { ...BASE_DRAFT, campaign_name: 'Approved campaign' },
    };
    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;

    const res = await postApprove();
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.draft.status, 'approved');
    assert.ok(body.segment_id);
    assert.equal(state.segmentInserts.length, 1);
    assert.equal(state.approveUpdates.length, 1);
    assert.equal(state.row.status, 'approved');
    assert.equal(state.row.segment_id, body.segment_id);
  });

  it('persists warning-only approve results with visible warnings', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    const { defaultPolicy } = require('../services/ai_governance/policy');
    orch.loadPolicy = async (tid) => ({
      ...defaultPolicy(tid),
      content_safety_mode: 'warning_only',
      content_safety_explicit: true,
    });
    try {
      state.row = {
        ...state.row,
        status: 'draft',
        segment_id: null,
        draft: { ...BASE_DRAFT, body: PROHIBITED },
      };
      state.segmentInserts.length = 0;
      state.approveUpdates.length = 0;

      const res = await postApprove();
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.ok((body.content_safety_warnings || body.draft?.content_safety_warnings || []).length >= 1);
      assert.equal(body.draft.status, 'approved');
      assert.equal(state.segmentInserts.length, 1);
      assert.equal(state.approveUpdates.length, 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
      state.row = {
        ...state.row,
        status: 'draft',
        segment_id: null,
        draft: { ...BASE_DRAFT },
        content_safety_warnings: ['Existing warning should remain on block'],
      };
    }
  });

  it('rejects cross-tenant approve without creating a segment', async () => {
    state.row = {
      ...state.row,
      status: 'draft',
      segment_id: null,
      draft: { ...BASE_DRAFT },
    };
    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;
    const beforeStatus = state.row.status;

    const res = await postApprove(99);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.ok, false);
    assert.equal(state.segmentInserts.length, 0);
    assert.equal(state.approveUpdates.length, 0);
    assert.equal(state.row.status, beforeStatus);
  });

  it('returns already_approved for duplicate concurrent approve attempts', async () => {
    state.row = {
      ...state.row,
      status: 'draft',
      segment_id: null,
      draft: { ...BASE_DRAFT },
    };
    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;

    const first = await postApprove();
    assert.equal(first.status, 200);

    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;
    const second = await postApprove();
    const body = await second.json();
    assert.equal(second.status, 409);
    assert.equal(body.error, 'already_approved');
    assert.equal(body.draft.status, 'approved');
    assert.equal(state.segmentInserts.length, 0);
    assert.equal(state.approveUpdates.length, 0);
  });

  it('returns 500 when pool connection acquisition fails without releasing an unacquired client', async () => {
    state.segmentInserts.length = 0;
    const _db = require('../db');
    _db.getPool = () => ({ connect: async () => { throw new Error('pool exhausted'); } });
    delete require.cache[require.resolve('../services/campaign_composer/api')];
    const router = require('../services/campaign_composer/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 3 };
      req.tenant = { id: 11, name: 'Test', slug: 'test', status: 'active' };
      next();
    });
    app.use('/api/campaign-composer', router);
    const tmp = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const res = await fetch(`http://127.0.0.1:${tmp.address().port}/api/campaign-composer/drafts/42/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': '11' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.match(body.error, /pool exhausted/);
    assert.equal(state.segmentInserts.length, 0);
    await new Promise((r) => tmp.close(r));
    delete require.cache[require.resolve('../services/campaign_composer/api')];
  });
});

describe('PR10H.11 composer draft approve rate limit', () => {
  const apiPath = require.resolve('../services/campaign_composer/api');
  const prevEnv = process.env.CAMPAIGN_COMPOSER_DRAFT_APPROVE_RATE_LIMIT_MAX;
  let server;
  let baseUrl;
  let state;

  function mountRouter() {
    delete require.cache[apiPath];
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async (req) => Number(req.headers['x-test-tenant'] || 11);

    state = {
      row: {
        id: 42,
        tenant_id: 11,
        prompt: 'Nurture recent signups',
        draft: { ...BASE_DRAFT },
        content_safety_warnings: [],
        status: 'draft',
        segment_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      segmentInserts: [],
      approveUpdates: [],
      nextSegmentId: 700,
    };

    const _db = require('../db');
    _db.getPool = () => makeTxPool(state);

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

  async function postApprove(tenant = 11) {
    return fetch(`${baseUrl}/api/campaign-composer/drafts/42/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-tenant': String(tenant),
      },
      body: JSON.stringify({}),
    });
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.CAMPAIGN_COMPOSER_DRAFT_APPROVE_RATE_LIMIT_MAX = '2';
    const app = mountRouter();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[apiPath];
    if (prevEnv === undefined) delete process.env.CAMPAIGN_COMPOSER_DRAFT_APPROVE_RATE_LIMIT_MAX;
    else process.env.CAMPAIGN_COMPOSER_DRAFT_APPROVE_RATE_LIMIT_MAX = prevEnv;
  });

  it('returns 429 without approving after the tenant bucket is exhausted', async () => {
    state.row.status = 'draft';
    state.row.segment_id = null;
    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;

    assert.equal((await postApprove()).status, 200);
    state.row.status = 'draft';
    state.row.segment_id = null;
    assert.equal((await postApprove()).status, 200);
    state.row.status = 'draft';
    state.row.segment_id = null;
    const limited = await postApprove();
    const body = await limited.json();
    assert.equal(limited.status, 429);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'rate_limited');
    assert.equal(state.approveUpdates.length, 2);
  });

  it('keeps separate tenant buckets so tenant B is not 429 when tenant A is exhausted', async () => {
    state.row = {
      ...state.row,
      tenant_id: 12,
      status: 'draft',
      segment_id: null,
      draft: { ...BASE_DRAFT, campaign_name: 'Tenant twelve draft' },
    };
    state.segmentInserts.length = 0;
    state.approveUpdates.length = 0;

    assert.equal((await postApprove(11)).status, 429);
    assert.equal((await postApprove(11)).status, 429);
    const tenantB = await postApprove(12);
    const body = await tenantB.json();
    assert.equal(tenantB.status, 200);
    assert.equal(body.ok, true);
    assert.equal(state.approveUpdates.length, 1);
    assert.equal(state.row.tenant_id, 12);
  });
});

const PG_URL = process.env.DATABASE_URL || '';
const PG_REQUIRED = process.env.PR10H1_REQUIRE_INTEGRATION === '1';
const pgSkip = !PG_URL ? (PG_REQUIRED ? false : 'no DATABASE_URL') : false;

describe('PR10H.11 composer draft approve postgres', { skip: pgSkip }, () => {
  let db;
  let ensureTenantSchema;
  let ensureAudiencesSchema;
  let ensureCampaignComposerSchema;
  let server;
  let baseUrl;
  let tenantId;
  let realGate;
  const fixtureTag = `pr10h11-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  before(async () => {
    assert.ok(PG_URL, 'DATABASE_URL is required when PR10H1_REQUIRE_INTEGRATION=1');
    for (const mod of [
      '../db',
      '../services/tenants/schema',
      '../services/audiences/schema',
      '../services/campaign_composer/schema',
    ]) {
      delete require.cache[require.resolve(mod)];
    }
    db = require('../db');
    ({ ensureTenantSchema } = require('../services/tenants/schema'));
    ({ ensureAudiencesSchema } = require('../services/audiences/schema'));
    ({ ensureCampaignComposerSchema } = require('../services/campaign_composer/schema'));
    await ensureTenantSchema();
    await ensureAudiencesSchema();
    await ensureCampaignComposerSchema();
    const p = db.getPool();
    tenantId = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
      [`PR10H11 ${fixtureTag}`, fixtureTag],
    )).rows[0].id;
    const routeGate = require('../services/ai_governance/route_gate');
    realGate = routeGate.gateRouteText;
    routeGate.gateRouteText = async () => ({ ok: true, warnings: [] });
    const tenantCtx = require('../services/tenants/context');
    tenantCtx.resolveTenantId = async (req) => Number(req.headers['x-test-tenant'] || tenantId);
    delete require.cache[require.resolve('../services/campaign_composer/api')];
    const router = require('../services/campaign_composer/api');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 3 };
      req.tenant = { id: tenantId, name: 'Test', slug: fixtureTag, status: 'active' };
      next();
    });
    app.use('/api/campaign-composer', router);
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (realGate) require('../services/ai_governance/route_gate').gateRouteText = realGate;
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[require.resolve('../services/campaign_composer/api')];
    if (!PG_URL || !tenantId) return;
    const p = db.getPool();
    await p.query('DELETE FROM campaign_composer_drafts WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await p.query('DELETE FROM audience_segments WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await p.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
  });

  async function postApprove(id, opts = {}) {
    return fetch(`${baseUrl}/api/campaign-composer/drafts/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-tenant': String(tenantId),
        ...(opts.failAfterSegment ? { 'x-test-fail-after-segment': '1' } : {}),
      },
      body: JSON.stringify({}),
    });
  }

  it('creates exactly one segment when two approvals run simultaneously', async () => {
    const p = db.getPool();
    const segName = `Concurrent ${fixtureTag}`;
    const localDraftId = (await p.query(
      `INSERT INTO campaign_composer_drafts (tenant_id, prompt, draft, status, content_safety_warnings)
       VALUES ($1, 'Concurrent approve', $2, 'draft', '[]'::jsonb) RETURNING id`,
      [tenantId, JSON.stringify({ ...BASE_DRAFT, campaign_name: segName })],
    )).rows[0].id;
    const before = (await p.query(
      `SELECT count(*)::int AS c FROM audience_segments WHERE tenant_id = $1 AND name = $2`,
      [tenantId, segName],
    )).rows[0].c;
    const [first, second] = await Promise.all([postApprove(localDraftId), postApprove(localDraftId)]);
    assert.equal([first, second].filter((r) => r.status === 200).length, 1);
    assert.equal([first, second].filter((r) => r.status === 409).length, 1);
    const after = (await p.query(
      `SELECT count(*)::int AS c FROM audience_segments WHERE tenant_id = $1 AND name = $2`,
      [tenantId, segName],
    )).rows[0].c;
    assert.equal(after - before, 1);
    const draft = await p.query(
      `SELECT status, segment_id FROM campaign_composer_drafts WHERE id = $1`,
      [localDraftId],
    );
    assert.equal(draft.rows[0].status, 'approved');
    assert.ok(draft.rows[0].segment_id);
  });

  it('rolls back segment insert and draft approval via HTTP when forced after segment insert', async () => {
    const p = db.getPool();
    const segName = `Rollback ${fixtureTag}`;
    const rollbackDraftId = (await p.query(
      `INSERT INTO campaign_composer_drafts (tenant_id, prompt, draft, status, content_safety_warnings)
       VALUES ($1, 'Rollback approve', $2, 'draft', '[]'::jsonb) RETURNING id`,
      [tenantId, JSON.stringify({ ...BASE_DRAFT, campaign_name: segName })],
    )).rows[0].id;
    const segmentsBefore = (await p.query(
      `SELECT count(*)::int AS c FROM audience_segments WHERE tenant_id = $1 AND name = $2`,
      [tenantId, segName],
    )).rows[0].c;

    const res = await postApprove(rollbackDraftId, { failAfterSegment: true });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.match(body.error, /test_forced_rollback_after_segment/);

    const draft = await p.query(`SELECT status, segment_id FROM campaign_composer_drafts WHERE id = $1`, [rollbackDraftId]);
    assert.equal(draft.rows[0].status, 'draft');
    assert.equal(draft.rows[0].segment_id, null);
    const segmentsAfter = (await p.query(
      `SELECT count(*)::int AS c FROM audience_segments WHERE tenant_id = $1 AND name = $2`,
      [tenantId, segName],
    )).rows[0].c;
    assert.equal(segmentsAfter, segmentsBefore);
  });
});
