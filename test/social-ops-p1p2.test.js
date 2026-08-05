// test/social-ops-p1p2.test.js — approvals, workflows, evergreen, inbox
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const db = require('../db');
db.hasDb = () => false;

const tenantCtx = require('../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req && req.headers && req.headers['x-test-tid'];
  return h ? parseInt(h, 10) : 1;
};

const drafts = require('../services/social_drafts/api');
const workflows = require('../services/social_workflows/api');
const evergreen = require('../services/social_evergreen/api');
const inbox = require('../services/social_inbox/api');

function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'rev@test.local' }; next(); });
  app.use('/api/social-drafts', drafts);
  app.use('/api/social-workflows', workflows);
  app.use('/api/social-evergreen', evergreen);
  app.use('/api/social-inbox', inbox);
  return http.createServer(app);
}

function req(server, method, path, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-tid': String(tid || 1) },
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

let server;
beforeEach(() => {
  if (drafts._resetMem) drafts._resetMem();
  if (workflows._resetMem) workflows._resetMem();
  if (evergreen._resetMem) evergreen._resetMem();
  if (inbox._resetMem) inbox._resetMem();
});

test('submit-approval → queue → approve (skip zernio)', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: 'Needs review', platforms: ['instagram'] },
    });
    const id = created.body.draft.id;
    const sub = await req(server, 'POST', `/api/social-drafts/${id}/submit-approval`, {});
    assert.equal(sub.body.ok, true);
    assert.equal(sub.body.draft.status, 'pending_approval');

    const queue = await req(server, 'GET', '/api/social-drafts/approvals/queue');
    assert.equal(queue.body.drafts.length, 1);

    // Cannot publish while pending
    const pub = await req(server, 'POST', `/api/social-drafts/${id}/publish`, {});
    assert.equal(pub.body.ok, false);

    const appr = await req(server, 'POST', `/api/social-drafts/${id}/approve`, {
      body: { skip_publish: true, notes: 'LGTM' },
    });
    assert.equal(appr.body.ok, true);
    assert.equal(appr.body.draft.status, 'approved');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('reject returns draft to editable', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: 'No', platforms: ['linkedin'] },
    });
    const id = created.body.draft.id;
    await req(server, 'POST', `/api/social-drafts/${id}/submit-approval`, {});
    const rej = await req(server, 'POST', `/api/social-drafts/${id}/reject`, { body: { notes: 'Rewrite' } });
    assert.equal(rej.body.ok, true);
    assert.equal(rej.body.draft.status, 'draft');
    assert.equal(rej.body.draft.meta.reviewer_notes, 'Rewrite');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('cross-post workflow creates child draft on publish event', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    await req(server, 'POST', '/api/social-workflows/presets/ig_to_tiktok/toggle', {
      body: { enabled: true },
    });
    const source = await drafts._insertDraft(1, {
      profile_id: 'p1',
      status: 'published',
      text: 'IG post with lots of hashtags #a #b #c #d #e',
      platforms: ['instagram'],
      media_urls: [],
      meta: {},
    });
    const kids = await workflows._onSocialPublished(1, source);
    assert.ok(kids.length >= 1);
    assert.deepEqual(kids[0].platforms, ['tiktok']);
    assert.ok(kids[0].meta.workflow_preset === 'ig_to_tiktok');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('evergreen create + run-due', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-evergreen', {
      body: {
        profileId: 'p1',
        text: 'Evergreen gem',
        platforms: ['instagram'],
        interval_days: 7,
        next_run_at: new Date(Date.now() - 1000).toISOString(),
      },
    });
    assert.equal(created.body.ok, true);
    const run = await req(server, 'POST', '/api/social-evergreen/run-due', {});
    assert.equal(run.body.ok, true);
    assert.ok(run.body.processed >= 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('social inbox demo threads + reply', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const list = await req(server, 'GET', '/api/social-inbox/threads');
    assert.equal(list.body.ok, true);
    assert.ok(list.body.threads.length >= 1);
    const id = list.body.threads[0].id;
    const msgs = await req(server, 'GET', `/api/social-inbox/threads/${id}/messages`);
    assert.ok(msgs.body.messages.length >= 1);
    const reply = await req(server, 'POST', `/api/social-inbox/threads/${id}/reply`, {
      body: { body: 'Thanks for reaching out!' },
    });
    assert.equal(reply.body.ok, true);
    assert.equal(reply.body.message.direction, 'outbound');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('settings require_approval toggle', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const put = await req(server, 'PUT', '/api/social-drafts/settings', {
      body: { require_approval: true },
    });
    assert.equal(put.body.settings.require_approval, true);
    const get = await req(server, 'GET', '/api/social-drafts/settings');
    assert.equal(get.body.settings.require_approval, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
