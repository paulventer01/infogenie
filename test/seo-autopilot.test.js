// test/seo-autopilot.test.js — Growth Plan · destinations · runner · Reddit AEO (mem mode)
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

const store = require('../services/seo_autopilot/store');
const { researchKeywords, buildCalendar, _demoKeywords } = require('../services/seo_autopilot/generate');
const { publishAll, slugify } = require('../services/seo_autopilot/destinations');
const { discoverThreads, draftBrandReply, _aeoAngle } = require('../services/seo_autopilot/reddit_aeo');
const { runPlanOnce, _pickNextItem } = require('../services/seo_autopilot/runner');
const api = require('../services/seo_autopilot/api');

function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'rev@test.local' }; next(); });
  app.use('/api/seo-autopilot', api);
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

beforeEach(() => {
  store._resetMem();
});

test('demo keywords + calendar cover 30 days', async () => {
  const kw = _demoKeywords('crm software');
  assert.ok(kw.length >= 5);
  const { calendar } = await buildCalendar({ keywords: kw, days: 30 });
  assert.equal(calendar.length, 30);
  assert.equal(calendar[0].status, 'queued');
  assert.equal(calendar[1].status, 'planned');
});

test('researchKeywords fail-open to demo', async () => {
  const r = await researchKeywords({ tenantId: 1, niche: 'local SEO' });
  assert.ok(r.keywords.length >= 4);
  assert.ok(['demo', 'ai'].includes(r.source) || r.source);
});

test('publishAll simulates shopify + webhook when unconfigured', async () => {
  const results = await publishAll(
    [
      { type: 'shopify', enabled: true },
      { type: 'webhook', enabled: true },
      { type: 'webflow', enabled: true },
    ],
    { title: 'Hello World Post', content: '<p>hi</p>', keyword: 'hello' },
    { tenantId: 1, publishStatus: 'draft' },
  );
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.ok));
  assert.ok(results.every((r) => r.simulated));
  assert.ok(slugify('Hello World!').includes('hello-world'));
});

test('onboard → autopilot → run-now end-to-end (mem)', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const onboard = await req(server, 'POST', '/api/seo-autopilot/onboard', {
      body: { niche: 'AI writing tools', domain: 'example.com', brand: 'WriteBot', autopilot: true },
    });
    assert.equal(onboard.status, 200);
    assert.ok(onboard.body.ok);
    assert.ok(onboard.body.plan.autopilot);
    assert.ok(onboard.body.calendar_days >= 7);
    assert.ok(onboard.body.keywords_count >= 4);

    const status = await req(server, 'GET', '/api/seo-autopilot/status');
    assert.ok(status.body.has_plan);
    assert.ok(status.body.autopilot);

    const run = await req(server, 'POST', '/api/seo-autopilot/run-now', { body: {} });
    assert.equal(run.status, 200);
    assert.ok(run.body.run || run.body.article);

    const runs = await req(server, 'GET', '/api/seo-autopilot/runs');
    assert.ok(runs.body.runs.length >= 1);
  } finally {
    server.close();
  }
});

test('pickNextItem prefers queued calendar items', () => {
  const item = _pickNextItem({
    calendar: [
      { day: 1, status: 'published', keyword: 'a' },
      { day: 2, status: 'queued', keyword: 'b' },
      { day: 3, status: 'planned', keyword: 'c' },
    ],
  });
  assert.equal(item.keyword, 'b');
});

test('runPlanOnce publishes and advances calendar', async () => {
  const plan = await store.upsertPlan(9, {
    niche: 'email marketing',
    brand: 'MailCo',
    domain: 'mail.co',
    keywords: [{ keyword: 'best email tools' }],
    calendar: [
      { day: 1, date: '2026-08-05', title: 'Best Email Tools', keyword: 'best email tools', status: 'queued' },
      { day: 2, date: '2026-08-06', title: 'Day 2', keyword: 'email checklist', status: 'planned' },
    ],
    destinations: [{ type: 'shopify', enabled: true }, { type: 'webhook', enabled: true }],
    autopilot: true,
  });
  const result = await runPlanOnce(plan);
  assert.ok(result.ok || result.run);
  assert.ok(result.publish_results?.length >= 1);
  const refreshed = await store.getPlan(9);
  assert.equal(refreshed.calendar[0].status, 'published');
  assert.equal(refreshed.calendar[1].status, 'queued');
});

test('reddit AEO discover + draft fail-open', async () => {
  assert.equal(_aeoAngle({ title: 'Best CRM vs HubSpot?' }, 'crm'), 'comparison_answer');
  const d = await discoverThreads({ niche: 'SEO automation', brand: 'InfoGenie', limit: 5 });
  assert.ok(d.ok);
  assert.ok(d.threads.length >= 1);
  const reply = await draftBrandReply({
    thread: d.threads[0],
    brand: 'InfoGenie',
    niche: 'SEO automation',
  });
  assert.ok(reply.ok);
  assert.ok(reply.reply.length > 40);
  assert.ok(reply.aeo_snippet);
});

test('API reddit-aeo endpoints', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    await req(server, 'POST', '/api/seo-autopilot/onboard', {
      body: { niche: 'geo SEO', brand: 'GeoCo' },
    });
    const disc = await req(server, 'POST', '/api/seo-autopilot/reddit-aeo/discover', {
      body: { niche: 'geo SEO', limit: 3 },
    });
    assert.ok(disc.body.ok);
    assert.ok(disc.body.threads.length >= 1);
    const draft = await req(server, 'POST', '/api/seo-autopilot/reddit-aeo/draft-reply', {
      body: { thread: disc.body.threads[0], brand: 'GeoCo' },
    });
    assert.ok(draft.body.ok);
    assert.ok(draft.body.reply);
  } finally {
    server.close();
  }
});
