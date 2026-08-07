// test/social-drafts.test.js — CRUD + tenant isolation for social drafts (memory mode)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const db = require('../db');
db.hasDb = () => false;

const tenantCtx = require('../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req && req.headers && req.headers['x-test-tid'];
  return h ? parseInt(h, 10) : 1;
};

const draftsRouter = require('../services/social_drafts/api');

function startServer() {
  const app = require('express')();
  app.use(require('express').json());
  app.use((req, _res, next) => { req.user = { email: 't@test.local' }; next(); });
  app.use('/api/social-drafts', draftsRouter);
  return http.createServer(app);
}

function req(server, method, path, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, 'http://127.0.0.1');
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: u.pathname + u.search,
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
  if (typeof draftsRouter._resetMem === 'function') draftsRouter._resetMem();
});

test('POST / creates a draft and GET /list returns it', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-drafts', {
      tid: 2,
      body: {
        profileId: 'prof_1',
        text: 'Hello calendar',
        platforms: ['instagram', 'linkedin'],
        scheduled_for: '2026-08-10T10:00:00.000Z',
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.draft.text, 'Hello calendar');
    assert.deepEqual(created.body.draft.platforms, ['instagram', 'linkedin']);
    assert.equal(created.body.draft.status, 'draft');

    const listed = await req(server, 'GET', '/api/social-drafts/list?profileId=prof_1', { tid: 2 });
    assert.equal(listed.body.ok, true);
    assert.equal(listed.body.drafts.length, 1);
    assert.equal(listed.body.drafts[0].id, created.body.draft.id);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('tenants cannot see each other\'s drafts', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    await req(server, 'POST', '/api/social-drafts', {
      tid: 2,
      body: { profileId: 'p', text: 'tenant 2 only', platforms: ['twitter'] },
    });
    await req(server, 'POST', '/api/social-drafts', {
      tid: 3,
      body: { profileId: 'p', text: 'tenant 3 only', platforms: ['twitter'] },
    });
    const a = await req(server, 'GET', '/api/social-drafts/list?profileId=p', { tid: 2 });
    const b = await req(server, 'GET', '/api/social-drafts/list?profileId=p', { tid: 3 });
    assert.equal(a.body.drafts.length, 1);
    assert.equal(a.body.drafts[0].text, 'tenant 2 only');
    assert.equal(b.body.drafts.length, 1);
    assert.equal(b.body.drafts[0].text, 'tenant 3 only');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('PATCH reschedules a draft', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-drafts', {
      tid: 1,
      body: { profileId: 'p', text: 'move me', platforms: ['facebook'], scheduled_for: '2026-08-01T09:00:00.000Z' },
    });
    const id = created.body.draft.id;
    const patched = await req(server, 'PATCH', `/api/social-drafts/${id}`, {
      tid: 1,
      body: { scheduled_for: '2026-08-15T14:30:00.000Z' },
    });
    assert.equal(patched.body.ok, true);
    assert.ok(String(patched.body.draft.scheduled_for).includes('2026-08-15'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('bulk import creates multiple drafts', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await req(server, 'POST', '/api/social-drafts/bulk', {
      tid: 1,
      body: {
        profileId: 'p',
        items: [
          { caption: 'One', platforms: ['instagram'], scheduledDate: '2026-08-20', scheduledTime: '10:00' },
          { caption: 'Two', platform: 'linkedin', scheduledDate: '2026-08-21' },
        ],
      },
    });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.created, 2);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('DELETE removes a draft', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-drafts', {
      tid: 1,
      body: { profileId: 'p', text: 'bye2', platforms: ['twitter'] },
    });
    const id = created.body.draft.id;
    const del = await req(server, 'DELETE', `/api/social-drafts/${id}`, { tid: 1 });
    assert.equal(del.body.ok, true);
    const listed = await req(server, 'GET', '/api/social-drafts/list?profileId=p', { tid: 1 });
    assert.ok(!listed.body.drafts.find((d) => d.id === id));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
