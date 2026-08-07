// test/loop-must-haves.test.js — self-heal, inbox triage board, evergreen from winners
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

const { _heuristicScan, selfHealDraft } = require('../services/social_drafts/self_heal');
const drafts = require('../services/social_drafts/api');
const evergreen = require('../services/social_evergreen/api');
const inbox = require('../services/social_inbox/api');

function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'rev@test.local' }; next(); });
  app.use('/api/social-drafts', drafts);
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
  if (evergreen._resetMem) evergreen._resetMem();
  if (inbox._resetMem) inbox._resetMem();
});

test('heuristicScan flags guaranteed results as critical fail', () => {
  const scan = _heuristicScan('Guaranteed results and risk-free ROI this quarter!');
  assert.equal(scan.overall_verdict, 'fail');
  assert.ok(scan.flags.some((f) => f.severity === 'critical'));
});

test('heuristicScan passes clean caption', () => {
  const scan = _heuristicScan('Three hooks that lifted our LinkedIn saves last month — framework inside.');
  assert.equal(scan.overall_verdict, 'pass');
});

test('selfHealDraft returns pass on clean text without AI', async () => {
  const r = await selfHealDraft(1, 'A clear tip on content cadence for B2B teams.');
  assert.equal(r.passed, true);
  assert.equal(r.final_verdict, 'pass');
  assert.ok(r.attempts.length >= 1);
});

test('submit-approval blocks critical self-heal fail unless force', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-drafts', {
      body: {
        profileId: 'p1',
        text: 'Guaranteed results — get rich quick with passive income overnight!',
        platforms: ['instagram'],
      },
    });
    const id = created.body.draft.id;

    const blocked = await req(server, 'POST', `/api/social-drafts/${id}/submit-approval`, {});
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.error, 'self_heal_failed');
    assert.ok(blocked.body.self_heal);

    const forced = await req(server, 'POST', `/api/social-drafts/${id}/submit-approval`, {
      body: { force: true },
    });
    assert.equal(forced.body.ok, true);
    assert.equal(forced.body.draft.status, 'pending_approval');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('POST /self-heal stores meta on draft', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/social-drafts', {
      body: { profileId: 'p1', text: 'Solid hook for Tuesday: show the before/after.', platforms: ['linkedin'] },
    });
    const id = created.body.draft.id;
    const heal = await req(server, 'POST', `/api/social-drafts/${id}/self-heal`, {});
    assert.equal(heal.body.ok, true);
    assert.equal(heal.body.self_heal.passed, true);
    assert.ok(heal.body.draft.meta?.self_heal);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('inbox board columns + priority triage', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const threads = await req(server, 'GET', '/api/social-inbox/threads');
    assert.equal(threads.body.ok, true);
    assert.ok(threads.body.threads.length >= 3);
    const upset = threads.body.threads.find((t) => /refund|scam/i.test(t.preview || ''));
    assert.ok(upset);
    assert.equal(upset.priority, 'p0');

    const board = await req(server, 'GET', '/api/social-inbox/board');
    assert.equal(board.body.ok, true);
    assert.ok(board.body.columns.open);
    assert.ok(Array.isArray(board.body.columns.closed));

    const patch = await req(server, 'PATCH', `/api/social-inbox/threads/${upset.id}`, {
      body: { triage_status: 'in_progress', assignee: 'ops@test', priority: 'p0' },
    });
    assert.equal(patch.body.ok, true);
    assert.equal(patch.body.thread.triage_status, 'in_progress');
    assert.equal(patch.body.thread.assignee, 'ops@test');

    const auto = await req(server, 'POST', '/api/social-inbox/triage/auto', {});
    assert.equal(auto.body.ok, true);
    assert.ok(auto.body.updated >= 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('suggest-winners + from-winners creates evergreen rules', async () => {
  server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const sug = await req(server, 'GET', '/api/social-evergreen/suggest-winners?profileId=p1');
    assert.equal(sug.body.ok, true);
    assert.ok(Array.isArray(sug.body.winners));
    assert.ok(sug.body.winners.length >= 1);

    const created = await req(server, 'POST', '/api/social-evergreen/from-winners', {
      body: {
        profileId: 'p1',
        interval_days: 14,
        winners: sug.body.winners.slice(0, 2),
      },
    });
    assert.equal(created.body.ok, true);
    assert.ok(created.body.created >= 1);
    assert.ok(created.body.rules.length >= 1);
    assert.ok(created.body.rules[0].from_winner);

    const list = await req(server, 'GET', '/api/social-evergreen/list');
    assert.ok(list.body.rules.length >= 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
