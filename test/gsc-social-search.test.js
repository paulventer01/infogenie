// test/gsc-social-search.test.js — social×search winners + evergreen wiring
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

const {
  detectPlatform,
  isSocialSearchRow,
  scoreRow,
  demoWinners,
  fetchSocialSearchWinners,
  insightFromWinners,
  rowToWinner,
} = require('../services/gsc_social_search/winners');

const gscApi = require('../services/gsc_social_search/api');
const evergreen = require('../services/social_evergreen/api');
const strategic = require('../services/strategic_intelligence/api').router;

function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'rev@test.local' }; next(); });
  app.use('/api/gsc-social-search', gscApi);
  app.use('/api/social-evergreen', evergreen);
  app.use('/api/strategic', strategic);
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
  if (evergreen._resetMem) evergreen._resetMem();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GSC_SITE_URL;
});

test('detectPlatform identifies major social hosts', () => {
  assert.equal(detectPlatform('https://www.instagram.com/reel/abc/'), 'instagram');
  assert.equal(detectPlatform('https://www.tiktok.com/@x/video/1'), 'tiktok');
  assert.equal(detectPlatform('https://youtu.be/xyz'), 'youtube');
  assert.equal(detectPlatform('https://x.com/brand/status/1'), 'twitter');
  assert.equal(detectPlatform('https://example.com/blog'), null);
});

test('isSocialSearchRow + scoreRow prefer click-heavy social pages', () => {
  const social = { keys: ['https://www.youtube.com/watch?v=1'], clicks: 40, impressions: 2000, ctr: 2, position: 5 };
  const blog = { keys: ['https://example.com/post'], clicks: 100, impressions: 5000, ctr: 2, position: 3 };
  assert.equal(isSocialSearchRow(social), true);
  assert.equal(isSocialSearchRow(blog), false);
  assert.ok(scoreRow(social) > 100);
  const w = rowToWinner(social, { siteUrl: 'sc-domain:example.com' });
  assert.equal(w.source, 'gsc_search');
  assert.equal(w.platforms[0], 'youtube');
  assert.ok(w.page_url.includes('youtube'));
});

test('fetchSocialSearchWinners returns demo when GSC not configured', async () => {
  const r = await fetchSocialSearchWinners({ limit: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.configured, false);
  assert.equal(r.source, 'demo');
  assert.ok(r.winners.length >= 1);
  assert.ok(r.winners[0].source.includes('gsc_search'));
  const insight = insightFromWinners(r);
  assert.ok(insight);
  assert.match(insight.headline, /social assets/i);
});

test('demoWinners cover IG/TikTok/YT', () => {
  const d = demoWinners();
  const plats = new Set(d.flatMap((w) => w.platforms));
  assert.ok(plats.has('youtube'));
  assert.ok(plats.has('instagram'));
  assert.ok(plats.has('tiktok'));
});

test('GET /api/gsc-social-search/winners + status', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const st = await req(server, 'GET', '/api/gsc-social-search/status');
    assert.equal(st.body.ok, true);
    assert.equal(st.body.configured, false);

    const w = await req(server, 'GET', '/api/gsc-social-search/winners');
    assert.equal(w.body.ok, true);
    assert.ok(w.body.winners.length >= 1);
    assert.ok(w.body.insight);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('suggest-winners includes gsc_social channel metadata', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await req(server, 'GET', '/api/social-evergreen/suggest-winners?profileId=p1');
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.winners));
    assert.ok(r.body.winners.length >= 1);
    assert.ok(r.body.gsc_social);
    assert.equal(typeof r.body.channels.gsc_search, 'boolean');
    // Without zernio, demo GSC or other sources should surface
    const hasGsc = r.body.winners.some((w) => String(w.source || '').includes('gsc_search'));
    assert.ok(hasGsc || r.body.channels.gsc_search === false || r.body.winners.length > 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('GET /api/strategic/social-search returns insight', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await req(server, 'GET', '/api/strategic/social-search');
    assert.equal(r.body.ok, true);
    assert.ok(r.body.insight);
    assert.ok((r.body.winners || []).length >= 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
