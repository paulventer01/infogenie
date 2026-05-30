// test/data-mode-strict.test.js — Honesty / data-mode regression guard (Task 14)
//
// Verifies that fabricated/synthetic responses stay HIDDEN when the effective
// data mode is strict, and are still BADGED (not withheld) when it is demo.
//
// It mounts the REAL route modules behind the REAL enforcement middleware
// (services/admin/enforcement.js), forces the effective mode, and hits each
// known fabrication producer over HTTP:
//   • backlinks placeholder        (POST /api/backlinks/summary, no DataForSEO creds)
//   • ad-insights placeholder      (GET  /api/google-ads-insights/account-summary, no creds)
//   • infographics template        (POST /api/infographics/generate, no AI key)
//   • social-listening estimate    (POST /api/social-listening/sentiment-trend, LLM-invented)
//   • INDUSTRY_DB demo competitor  (data.js competitor metrics surfaced via a route)
//
// strict  → standardized { data_unavailable:true, source:'data_unavailable' }
// demo    → original payload, annotated { _dataMode:'demo', _demo:true }
//
// Run: node --test   (or: npm test)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ── Deterministic environment ───────────────────────────────────────────────
// '_DUMMY*' keys read as "present but disabled" by infographics' _hasOpenAI()
// (so it takes the template fallback) yet "present" to social_listening's
// callOpenAI() (so it proceeds to fetch, which we stub below). This lets one
// process exercise both the "no AI key" and "AI returned estimate" branches.
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = '_DUMMY_test_key';
process.env.OPENAI_API_KEY = '_DUMMY_test_key';
delete process.env.DATAFORSEO_LOGIN;      // force backlinks placeholder
delete process.env.DATAFORSEO_PASSWORD;

// Stub fetch so social_listening's AI call returns a canned estimate (no
// network). Test HTTP calls below use the http module, so they are unaffected.
const _realFetch = global.fetch;
global.fetch = async () => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({
      trend: [{ day: 'Mon', positive: 50, neutral: 30, negative: 20 }],
      overall_sentiment: 'stable', key_driver: 'test', risk_level: 'low',
    }) } }],
  }),
});

// ── Force the effective data mode (the resolver itself is unit-covered by its
// own logic; here we drive the enforcement layer that consumes it). ──────────
const dataMode = require('../services/admin/data_mode');
let EFFECTIVE_MODE = 'strict';
dataMode.resolveDataMode = async () => ({ mode: EFFECTIVE_MODE, source: 'test' });

// Keep the test side-effect-free: don't write rows to the issues table.
const issues = require('../services/admin/issues');
issues.raiseIssue = async () => ({ ok: true });

const { dataModeEnforcement } = require('../services/admin/enforcement');

// ── Load INDUSTRY_DB out of the browser-only data.js (no module.exports). ────
function loadIndustryDb() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.__INDUSTRY_DB = INDUSTRY_DB;', sandbox);
  return sandbox.__INDUSTRY_DB;
}

let server, PORT;

before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  // A logged-in but non-owner user with no connected creds → ad-insights and
  // any vault-backed route deterministically yield their placeholder branch.
  app.use((req, _res, next) => { req.user = { id: 999999999 }; next(); });
  app.use(dataModeEnforcement);

  app.use('/api/backlinks', require('../services/backlinks/api'));
  app.use('/api/google-ads-insights', require('../services/google_ads_insights/api'));
  app.use('/api/infographics', require('../services/infographics/api'));
  app.use('/api/social-listening', require('../services/social_listening/api'));

  // INDUSTRY_DB competitor metrics are tagged demo/_estimated in data.js and
  // are normally consumed by the SPA; surface a representative competitor
  // object through a route so the server-side enforcement path is exercised.
  const INDUSTRY_DB = loadIndustryDb();
  const sampleCompetitor = INDUSTRY_DB.ecommerce.competitors[0];
  assert.equal(sampleCompetitor.source, 'demo', 'INDUSTRY_DB competitor must be tagged source:demo');
  assert.equal(sampleCompetitor._estimated, true, 'INDUSTRY_DB competitor must be tagged _estimated:true');
  app.post('/api/competitor-profile', (_req, res) =>
    res.json({ ok: true, competitors: [sampleCompetitor] }));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  PORT = server.address().port;
});

after(async () => {
  global.fetch = _realFetch;
  if (server) await new Promise((r) => server.close(r));
  try { const db = require('../db'); const p = db.getPool && db.getPool(); if (p) await p.end(); } catch { /* ignore */ }
});

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: route, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Each case: how to hit the route + which field proves synthetic data leaked.
const CASES = [
  { name: 'backlinks placeholder (no DataForSEO creds)', method: 'POST', route: '/api/backlinks/summary', body: { target: 'example.com' },
    demoSource: 'placeholder', leaked: (b) => b.summary !== undefined },
  { name: 'ad-insights placeholder (no Google Ads creds)', method: 'GET', route: '/api/google-ads-insights/account-summary',
    demoSource: 'placeholder', leaked: (b) => b.note !== undefined && b.source === 'placeholder' },
  { name: 'infographics template (no AI key)', method: 'POST', route: '/api/infographics/generate', body: { topic: 'Customer journey', layout: 'funnel' },
    demoMarker: (b) => b.infographic && b.infographic.source === 'template', leaked: (b) => b.infographic !== undefined },
  { name: 'social-listening sentiment-trend (LLM estimate)', method: 'POST', route: '/api/social-listening/sentiment-trend', body: { brand: 'Acme', period: '7d' },
    demoMarker: (b) => b._estimated === true, leaked: (b) => b.trend !== undefined },
  { name: 'INDUSTRY_DB demo competitor', method: 'POST', route: '/api/competitor-profile', body: {},
    demoMarker: (b) => Array.isArray(b.competitors) && b.competitors[0] && b.competitors[0].source === 'demo', leaked: (b) => Array.isArray(b.competitors) && b.competitors.length > 0 },
];

for (const c of CASES) {
  test(`strict mode withholds: ${c.name}`, async () => {
    EFFECTIVE_MODE = 'strict';
    const { status, body } = await request(c.method, c.route, c.body);
    assert.equal(status, 200, `expected 200, got ${status} (body: ${JSON.stringify(body)})`);
    assert.equal(body.data_unavailable, true, `expected data_unavailable=true, got: ${JSON.stringify(body)}`);
    assert.equal(body._dataMode, 'strict', 'expected _dataMode=strict');
    assert.equal(body.source, 'data_unavailable', 'expected standardized data_unavailable source');
    assert.ok(!c.leaked(body), `synthetic data leaked through strict mode: ${JSON.stringify(body)}`);
  });
}

for (const c of CASES) {
  test(`demo mode badges (marker present): ${c.name}`, async () => {
    EFFECTIVE_MODE = 'demo';
    const { status, body } = await request(c.method, c.route, c.body);
    assert.equal(status, 200, `expected 200, got ${status}`);
    assert.equal(body._dataMode, 'demo', `expected _dataMode=demo, got: ${JSON.stringify(body)}`);
    assert.equal(body._demo, true, 'expected _demo=true');
    if (c.demoSource) assert.equal(body.source, c.demoSource, `expected original source=${c.demoSource}`);
    if (c.demoMarker) assert.ok(c.demoMarker(body), `original fabrication marker missing in demo mode: ${JSON.stringify(body)}`);
  });
}

// Lint guard: a new _template*/_fallback* helper that forgets its honesty
// marker would silently bypass strict mode — fail the suite if one appears.
test('fabrication-marker lint: no untagged template/fallback helpers', () => {
  const { check } = require('../scripts/check-fabrication-markers');
  const { flagged } = check();
  assert.equal(flagged.length, 0,
    'untagged synthetic fallback(s) found:\n' + flagged.map((f) => `  - ${f.file}: ${f.reason}`).join('\n'));
});
