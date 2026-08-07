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
//   • social-listening estimate    (POST /api/social-listening/sentiment-trend, LLM-invented)
// Note: infographics no-AI path is a layout scaffold (source:'layout-scaffold'),
// not a fabrication marker — covered by a pass-through test below, not withheld.
//   • cold-email template          (POST /api/cold-email/generate, no AI key)
//   • content-calendar template    (POST /api/content-calendar/generate, no AI key)
//   • ab-designer template         (POST /api/ab-designer/generate, no AI key)
//   • carousel template            (POST /api/carousel/generate, no AI key)
//   • landing-page template        (POST /api/landing-pages/generate, no AI key)
//   • press-release template       (POST /api/press-release/generate, no AI key)
//   • voc template                 (POST /api/voc/mine, no AI key)
//   • tech-stack placeholder       (POST /api/tech-stack/detect + /compare, no BuiltWith key)
//
// NOTE: INDUSTRY_DB competitor metrics were previously tagged source:'demo'.
// They are now tagged source:'industry-benchmark' (real published ranges from
// WordStream/SpyFu/Meta Industry Reports) so they are NOT withheld in strict
// mode and are excluded from this fabrication suite.
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
// '_DUMMY*' reads as "present but disabled" to tech_stack's _builtwithFree()
// (returns null immediately, no network) → /detect + /compare placeholder.
process.env.BUILTWITH_API_KEY = '_DUMMY_test_key';

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

// Keep the test side-effect-free and DB-independent: routes only persist when
// hasDb() is true. Forcing it false skips every INSERT (the response payload is
// unchanged) — and avoids carousel's persist error, which isn't wrapped in the
// per-route try/catch the other modules use, surfacing as a 500.
const db = require('../db');
db.hasDb = () => false;

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
  app.use('/api/cold-email', require('../services/cold_email/api'));
  app.use('/api/content-calendar', require('../services/content_calendar/api'));
  app.use('/api/ab-designer', require('../services/ab_designer/api'));
  app.use('/api/carousel', require('../services/carousel/api'));
  app.use('/api/landing-pages', require('../services/landing_pages/api'));
  app.use('/api/press-release', require('../services/press_release/api'));
  app.use('/api/voc', require('../services/voc/api'));
  app.use('/api/tech-stack', require('../services/tech_stack/api'));

  // voc's /mine fetches mentions from the same server over HTTP before it can
  // cluster (and fall back to its template). Serve a small canned set so the
  // route reaches its source:'template' branch (not source:'empty').
  app.post('/api/mentions', (_req, res) => res.json({ ok: true, mentions: [
    { sentiment: 'positive', title: 'Love the product', snippet: 'Works great for our team.' },
    { sentiment: 'negative', title: 'Support was slow', snippet: 'Waited two days for a reply.' },
    { sentiment: 'neutral', title: 'Pricing question', snippet: 'Is there an annual plan?' },
  ] }));

  // Verify INDUSTRY_DB competitor metrics are tagged as real industry benchmarks
  // (not as fabricated demo data) — they should pass through enforcement in strict mode.
  const INDUSTRY_DB = loadIndustryDb();
  const sampleCompetitor = INDUSTRY_DB.ecommerce.competitors[0];
  assert.equal(sampleCompetitor.source, 'industry-benchmark',
    'INDUSTRY_DB competitor must be tagged source:industry-benchmark (real published ranges, not fabricated)');
  assert.equal(sampleCompetitor._estimated, false,
    'INDUSTRY_DB competitor must be tagged _estimated:false (published benchmark, not an AI guess)');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  PORT = server.address().port;
  // voc's _fetchMentions calls 127.0.0.1:${process.env.PORT||5000}/api/mentions —
  // point it at THIS test server so it hits the canned mentions route above.
  process.env.PORT = String(PORT);
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
  { name: 'social-listening sentiment-trend (LLM estimate)', method: 'POST', route: '/api/social-listening/sentiment-trend', body: { brand: 'Acme', period: '7d' },
    demoMarker: (b) => b._estimated === true, leaked: (b) => b.trend !== undefined },
  // INDUSTRY_DB competitor case removed: metrics are now source:'industry-benchmark'
  // (real published ranges) — they are no longer fabricated and pass enforcement freely.
  { name: 'cold-email template (no AI key)', method: 'POST', route: '/api/cold-email/generate', body: { sender_offer: 'B2B CRM software' },
    demoSource: 'template', leaked: (b) => Array.isArray(b.emails) },
  { name: 'content-calendar template (no AI key)', method: 'POST', route: '/api/content-calendar/generate', body: { brand: 'Acme', channels: ['instagram'], days: 3 },
    demoSource: 'template', leaked: (b) => Array.isArray(b.posts) },
  { name: 'ab-designer template (no AI key)', method: 'POST', route: '/api/ab-designer/generate', body: { original: 'Buy now and save 20%', element_kind: 'email_subject', count: 2 },
    demoSource: 'template', leaked: (b) => Array.isArray(b.variants) },
  { name: 'carousel template (no AI key)', method: 'POST', route: '/api/carousel/generate', body: { topic: 'Email marketing tips', structure: 'pure-info' },
    demoSource: 'template', leaked: (b) => Array.isArray(b.slides) },
  { name: 'landing-page template (no AI key)', method: 'POST', route: '/api/landing-pages/generate', body: { title: 'Launch your store', brand: 'Acme' },
    demoSource: 'template', leaked: (b) => b.content !== undefined || b.html !== undefined },
  { name: 'press-release template (no AI key)', method: 'POST', route: '/api/press-release/generate', body: { brand: 'Acme', context: 'We launched a new product line today.' },
    demoSource: 'template', leaked: (b) => b.release !== undefined },
  { name: 'voc template (no AI key)', method: 'POST', route: '/api/voc/mine', body: { brand: 'Acme', days: 7 },
    demoSource: 'template', leaked: (b) => Array.isArray(b.themes) },
  { name: 'tech-stack detect placeholder (no BuiltWith key)', method: 'POST', route: '/api/tech-stack/detect', body: { domain: 'example.com' },
    demoSource: 'placeholder', leaked: (b) => b.note !== undefined && b.source === 'placeholder' },
  { name: 'tech-stack compare placeholder (no BuiltWith key)', method: 'POST', route: '/api/tech-stack/compare', body: { domains: ['example.com'] },
    demoMarker: (b) => Array.isArray(b.results) && b.results.some((r) => r.source === 'placeholder'), leaked: (b) => Array.isArray(b.results) && b.results.length > 0 },
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

// Creative layout scaffolds are not fabricated metrics — they must remain
// available in strict mode when no AI key is configured.
test('strict mode allows infographic layout-scaffold (no AI key)', async () => {
  EFFECTIVE_MODE = 'strict';
  const { status, body } = await request('POST', '/api/infographics/generate', {
    topic: 'Customer journey', layout: 'funnel', itemCount: 5,
  });
  assert.equal(status, 200, `expected 200, got ${status} (body: ${JSON.stringify(body)})`);
  assert.notEqual(body.data_unavailable, true, `layout scaffold withheld: ${JSON.stringify(body)}`);
  assert.ok(body.infographic, 'expected infographic payload');
  assert.equal(body.infographic.source, 'layout-scaffold');
  assert.ok(Array.isArray(body.infographic.items) && body.infographic.items.length >= 3);
});

// Lint guard: a new _template*/_fallback* helper that forgets its honesty
// marker would silently bypass strict mode — fail the suite if one appears.
test('fabrication-marker lint: no untagged template/fallback helpers', () => {
  const { check } = require('../scripts/check-fabrication-markers');
  const { flagged } = check();
  assert.equal(flagged.length, 0,
    'untagged synthetic fallback(s) found:\n' + flagged.map((f) => `  - ${f.file}: ${f.reason}`).join('\n'));
});
