// test/social-drafts-publish-claim.test.js — atomic publish claim + delivery outcome guards
'use strict';

require('./helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const db = require('../db');
const origHasDb = db.hasDb;

const tenantCtx = require('../services/tenants/context');
const origResolveTenant = tenantCtx.resolveTenantId;

function memHarness() {
  db.hasDb = () => false;
  tenantCtx.resolveTenantId = async (req) => {
    const h = req?.headers?.['x-test-tid'];
    return h ? parseInt(h, 10) : 1;
  };
  const drafts = require('../services/social_drafts/api');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const tid = req.headers['x-test-tid'] ? parseInt(req.headers['x-test-tid'], 10) : 1;
    req.user = { id: 1, email: 'pub@test.local' };
    req.tenant = { id: tid, name: 'Test', slug: 'test', status: 'active' };
    next();
  });
  app.use('/api/social-drafts', drafts);
  return { drafts, app };
}

function httpReq(server, method, path, { tid = 1, body } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-tid': String(tid) },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let j = {};
        try { j = d ? JSON.parse(d) : {}; } catch { j = { raw: d }; }
        resolve({ status: res.statusCode, body: j });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

describe('social drafts publish claim (memory)', () => {
  let drafts;
  let server;

  beforeEach(() => {
    const h = memHarness();
    drafts = h.drafts;
    drafts._resetMem();
    server = http.createServer(h.app);
  });

  afterEach(async () => {
    if (server?.listening) await new Promise((r) => server.close(r));
    db.hasDb = origHasDb;
    tenantCtx.resolveTenantId = origResolveTenant;
  });

  it('concurrent direct publish and approve only call provider once', async () => {
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      await new Promise((res) => setTimeout(res, 40));
      return { ok: true, post: { id: 'z1' } };
    };
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
    try {
      const draft = await drafts._createForTenant(11, {
        profile_id: 'p1',
        status: 'approved',
        text: 'Concurrent',
        platforms: ['linkedin'],
      });
      await new Promise((r) => server.listen(0, r));
      const [directFn, approveFn, directHttp] = await Promise.all([
        drafts._executePublishDraft(11, draft.id, { mode: 'direct' }),
        drafts._executePublishDraft(11, draft.id, { mode: 'approval' }),
        httpReq(server, 'POST', `/api/social-drafts/${draft.id}/publish`, { tid: 11 }),
      ]);
      assert.equal(publishCalls, 1);
      const isSuccess = (r) => (
        r.body
          ? r.body.ok === true && ['published', 'scheduled'].includes(r.body.draft?.status)
          : r.ok === true && r.published === true
      );
      const successes = [directFn, approveFn, directHttp].filter(isSuccess);
      assert.equal(successes.length, 1);
    } finally {
      drafts._publishViaZernio = origPublish;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });

  it('rejects re-publishing published and scheduled drafts', async () => {
    await new Promise((r) => server.listen(0, r));
    for (const status of ['published', 'scheduled']) {
      const draft = await drafts._createForTenant(12, {
        profile_id: 'p1',
        status,
        text: 'Live',
        platforms: ['linkedin'],
        meta: { published_at: new Date().toISOString() },
      });
      const direct = await httpReq(server, 'POST', `/api/social-drafts/${draft.id}/publish`, { tid: 12 });
      assert.equal(direct.body.ok, false);
      assert.equal(direct.body.error, 'already_published');
      const approve = await drafts._approveAndPublish(12, draft.id, {});
      assert.equal(approve.ok, false);
      assert.equal(approve.error, 'already_published');
    }
  });

  it('provider acceptance followed by timeout blocks retry as delivery_unknown', async () => {
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => ({
      ok: false,
      error: 'zernio timeout (30s)',
      uncertain: true,
    });
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
    try {
      const draft = await drafts._createForTenant(13, {
        profile_id: 'p1',
        status: 'draft',
        text: 'Timeout case',
        platforms: ['linkedin'],
      });
      const first = await drafts._executePublishDraft(13, draft.id, { mode: 'direct' });
      assert.equal(first.ok, false);
      assert.equal(first.error, 'delivery_unknown');
      assert.equal(first.draft.status, 'delivery_unknown');
      const retry = await drafts._executePublishDraft(13, draft.id, { mode: 'direct' });
      assert.equal(retry.ok, false);
      assert.equal(retry.error, 'delivery_unknown');
    } finally {
      drafts._publishViaZernio = origPublish;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });

  it('definitive provider rejection allows retry after failed status', async () => {
    let calls = 0;
    const origPublish = drafts._publishViaZernio;
    drafts._publishViaZernio = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, error: 'zernio 400', httpStatus: 400 };
      return { ok: true, post: { id: 'z-retry' } };
    };
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
    try {
      const draft = await drafts._createForTenant(14, {
        profile_id: 'p1',
        status: 'draft',
        text: 'Retry after reject',
        platforms: ['linkedin'],
      });
      const first = await drafts._executePublishDraft(14, draft.id, { mode: 'direct' });
      assert.equal(first.ok, false);
      assert.equal(first.draft.status, 'failed');
      const retry = await drafts._executePublishDraft(14, draft.id, { mode: 'direct' });
      assert.equal(retry.ok, true);
      assert.equal(retry.published, true);
      assert.equal(calls, 2);
    } finally {
      drafts._publishViaZernio = origPublish;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });

  it('provider acceptance with persist failure blocks expired-claim retry without second provider call', async () => {
    let publishCalls = 0;
    const origPublish = drafts._publishViaZernio;
    const origUpdate = drafts._updateDraft;
    drafts._publishViaZernio = async () => {
      publishCalls += 1;
      return { ok: true, post: { id: 'z-accepted' }, httpStatus: 200 };
    };
    drafts._updateDraft = async (tid, id, patch) => {
      if (patch.status === 'published' || patch.status === 'scheduled') {
        throw new Error('persist_failed');
      }
      return origUpdate(tid, id, patch);
    };
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test-key-live';
    try {
      const draft = await drafts._createForTenant(17, {
        profile_id: 'p1',
        status: 'draft',
        text: 'Persist failure after accept',
        platforms: ['linkedin'],
      });
      const first = await drafts._executePublishDraft(17, draft.id, { mode: 'direct' });
      assert.equal(first.ok, false);
      assert.equal(first.error, 'delivery_unknown');
      assert.equal(publishCalls, 1);
      assert.ok(first.draft?.meta?.publishing_claim);

      const staleAt = new Date(Date.now() - (6 * 60 * 1000)).toISOString();
      await origUpdate(17, draft.id, {
        meta: {
          ...(first.draft.meta || {}),
          publishing_claim_at: staleAt,
        },
      });

      const retry = await drafts._executePublishDraft(17, draft.id, { mode: 'direct' });
      assert.equal(retry.ok, false);
      assert.equal(retry.error, 'delivery_unknown');
      assert.equal(publishCalls, 1);
    } finally {
      drafts._publishViaZernio = origPublish;
      drafts._updateDraft = origUpdate;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });

  it('expired unresolved claim on delivery_unknown still blocks publish', async () => {
    const staleAt = new Date(Date.now() - (6 * 60 * 1000)).toISOString();
    const draft = await drafts._createForTenant(15, {
      profile_id: 'p1',
      status: 'delivery_unknown',
      text: 'Unresolved',
      platforms: ['linkedin'],
      meta: {
        delivery_outcome: 'unknown',
        publishing_claim: 'pub_stale',
        publishing_claim_at: staleAt,
        last_publish_error: 'zernio timeout (30s)',
      },
    });
    const claim = await drafts._claimPublishing(15, draft.id, { mode: 'direct' });
    assert.equal(claim.ok, false);
    assert.equal(claim.error, 'delivery_unknown');
    const publish = await drafts._executePublishDraft(15, draft.id, { mode: 'direct' });
    assert.equal(publish.ok, false);
    assert.equal(publish.error, 'delivery_unknown');
  });

  it('publish lock map cleans up after sequential operations', async () => {
    const draft = await drafts._createForTenant(16, {
      profile_id: 'p1',
      status: 'draft',
      text: 'Lock cleanup',
      platforms: ['linkedin'],
    });
    await drafts._withDraftPublishLock(16, draft.id, async () => 'a');
    await drafts._withDraftPublishLock(16, draft.id, async () => 'b');
    assert.equal(drafts._publishLockChainSize(), 0);
  });
});

const HAS_DB = typeof origHasDb === 'function' && origHasDb();

describe('social drafts publish claim (postgres)', () => {
  it('atomic claim allows only one concurrent publisher', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { ensureTenantSchema } = require('../services/tenants/schema');
    const { ensureSocialDraftsSchema } = require('../services/social_drafts/schema');
    await ensureTenantSchema();
    await ensureSocialDraftsSchema();

    db.hasDb = origHasDb;
    tenantCtx.resolveTenantId = origResolveTenant;
    const drafts = require('../services/social_drafts/api');

    const p = db.getPool();
    const suffix = `sdpub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`Social Pub ${suffix}`, `sdpub-${suffix}`],
    )).rows[0].id;

    const inserted = await p.query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'pending_approval',$3,'[]'::jsonb,$4::jsonb,'{}'::jsonb)
       RETURNING id`,
      [tenant, 'prof_pg', 'Postgres atomic claim', JSON.stringify(['linkedin'])],
    );
    const draftId = inserted.rows[0].id;

    const [a, b] = await Promise.all([
      drafts._claimPublishing(tenant, draftId, { mode: 'approval' }),
      drafts._claimPublishing(tenant, draftId, { mode: 'approval' }),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    const blocked = [a, b].filter((r) => !r.ok);
    assert.equal(winners.length, 1);
    assert.equal(blocked.length, 1);
    assert.ok(['publish_in_progress', 'cannot_claim'].includes(blocked[0].error));

    await p.query(`DELETE FROM social_post_drafts WHERE tenant_id=$1`, [tenant]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
  });

  it('does not reclaim expired publishing claims with unresolved delivery', { skip: HAS_DB ? false : 'no DATABASE_URL' }, async () => {
    const { ensureTenantSchema } = require('../services/tenants/schema');
    const { ensureSocialDraftsSchema } = require('../services/social_drafts/schema');
    await ensureTenantSchema();
    await ensureSocialDraftsSchema();

    db.hasDb = origHasDb;
    const drafts = require('../services/social_drafts/api');
    const p = db.getPool();
    const suffix = `sdpub-stale-${Date.now()}`;
    const tenant = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`Social Pub stale ${suffix}`, `sdpub-stale-${suffix}`],
    )).rows[0].id;

    const inserted = await p.query(
      `INSERT INTO social_post_drafts
         (tenant_id, profile_id, status, text, media_urls, platforms, meta)
       VALUES ($1,$2,'approved',$3,'[]'::jsonb,$4::jsonb,$5::jsonb)
       RETURNING id`,
      [
        tenant,
        'prof_pg',
        'Stale claim',
        JSON.stringify(['linkedin']),
        JSON.stringify({
          publishing_claim: 'pub_stale_pg',
          publishing_claim_at: new Date(Date.now() - (6 * 60 * 1000)).toISOString(),
        }),
      ],
    );
    const draftId = inserted.rows[0].id;

    const claim = await drafts._claimPublishing(tenant, draftId, { mode: 'direct' });
    assert.equal(claim.ok, false);
    assert.equal(claim.error, 'delivery_unknown');

    await p.query(`DELETE FROM social_post_drafts WHERE tenant_id=$1`, [tenant]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
  });
});
