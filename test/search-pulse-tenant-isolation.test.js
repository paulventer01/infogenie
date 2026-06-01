// test/search-pulse-tenant-isolation.test.js — Task #43 regression guard
//
// Search Pulse (DataForSEO keyword expansion) and the OpenAI-vision logo/brand
// cache are workspace-specific: pulse runs and image analyses carry a tenant_id,
// reads filter by it, and search_intel_images now has a per-tenant
// UNIQUE (tenant_id, source_url) (the legacy global UNIQUE (source_url) was
// dropped). These tests assert that isolation holds so a future edit that drops
// the tenant_id arg or the WHERE filter can't silently re-leak one workspace's
// keyword history / logo cache into another's:
//   • two tenants can store rows for the same seed / same source_url and each
//     only ever reads back its own;
//   • the per-tenant UNIQUE lets both tenants cache the SAME source_url
//     independently, while a same-tenant re-analysis upserts in place.
//
// Postgres is replaced with an in-memory fake pool that honours the composite
// conflict target, and the outbound DataForSEO / OpenAI calls are stubbed at the
// https layer, so no database or network is required.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const https = require('https');

// ── Stub the outbound HTTPS calls (DataForSEO + OpenAI vision) ───────────────
// search_pulse.js calls require('https').request(opts, cb); we replace request
// with a fake that returns canned bodies based on opts.hostname. The module
// reads the property at call time, so patching after require still takes effect.
const { EventEmitter } = require('events');

function fakeResponse(hostname) {
  if (hostname === 'api.dataforseo.com') {
    return {
      status: 200,
      body: {
        tasks: [{
          result: [{
            items: [
              { keyword: 'running shoes', keyword_info: { search_volume: 1000, cpc: 1.2, competition_level: 'HIGH', monthly_searches: [] }, search_intent_info: { main_intent: 'commercial' } },
              { keyword: 'trail shoes',   keyword_info: { search_volume: 500,  cpc: 0.8, competition_level: 'MEDIUM', monthly_searches: [] }, search_intent_info: { main_intent: 'informational' } },
            ],
          }],
        }],
      },
    };
  }
  if (hostname === 'api.openai.com') {
    // analyzeImage reads choices[0].message.content as a strict-JSON string.
    return {
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ brands: [{ name: 'Acme', confidence: 0.9, location: 'top-left' }], objects: ['box'] }) } }] },
    };
  }
  return { status: 404, body: {} };
}

let _openaiContent = null; // lets a test override the OpenAI brands payload

https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.write = () => {};
  req.destroy = () => {};
  req.end = () => {
    const { status, body } = fakeResponse(opts.hostname);
    let payload = body;
    if (opts.hostname === 'api.openai.com' && _openaiContent) {
      payload = { choices: [{ message: { content: _openaiContent } }] };
    }
    const res = new EventEmitter();
    res.statusCode = status;
    cb(res);
    res.emit('data', JSON.stringify(payload));
    res.emit('end');
  };
  return req;
};

// ── In-memory fake of the two tenant-scoped tables ───────────────────────────
const pulseRuns = [];        // search_intel_pulse_runs rows
let pulseSeq = 0;
const images = new Map();     // key `${tid}\u0000${url}` → row (mirrors UNIQUE)
let imageSeq = 0;
function imgKey(tid, url) { return `${tid}\u0000${url}`; }

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // ── search_intel_pulse_runs ──
  if (/^INSERT INTO search_intel_pulse_runs/.test(s)) {
    const [seed, locale, suggestionsJson, totalVolume, tenantId] = params;
    pulseRuns.push({
      id: ++pulseSeq, seed, locale,
      suggestions: JSON.parse(suggestionsJson),
      total_volume: totalVolume, tenant_id: tenantId,
      ran_at: new Date(Date.now() + pulseSeq), // monotonically increasing
    });
    return { rows: [] };
  }
  if (/^SELECT .* FROM search_intel_pulse_runs WHERE seed=\$1 AND tenant_id=\$2/.test(s)) {
    const [seed, tenantId, limit] = params;
    const rows = pulseRuns
      .filter(r => r.seed === seed && r.tenant_id === tenantId)
      .sort((a, b) => b.ran_at - a.ran_at)
      .slice(0, limit)
      .map(r => ({
        id: r.id, seed: r.seed, locale: r.locale,
        total_volume: r.total_volume, ran_at: r.ran_at,
        suggestion_count: r.suggestions.length,
      }));
    return { rows };
  }

  // ── search_intel_images ──
  if (/^SELECT \* FROM search_intel_images WHERE source_url=\$1 AND tenant_id=\$2/.test(s)) {
    const [url, tenantId] = params;
    const row = images.get(imgKey(tenantId, url));
    return { rows: row ? [row] : [] };
  }
  if (/^INSERT INTO search_intel_images/.test(s)) {
    const [url, brandsJson, objectsJson, raw, tenantId] = params;
    // ON CONFLICT (tenant_id, source_url) DO UPDATE — per-tenant upsert.
    const k = imgKey(tenantId, url);
    const existing = images.get(k);
    images.set(k, {
      id: existing ? existing.id : ++imageSeq,
      source_url: url, brands: JSON.parse(brandsJson), objects: JSON.parse(objectsJson),
      raw, tenant_id: tenantId, ran_at: new Date(),
    });
    return { rows: [] };
  }

  throw new Error('unexpected SQL in fake pool: ' + s);
}

const db = require('../db');
db.hasDb = () => true;
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

// DataForSEO / OpenAI credentials the service guards on.
process.env.DATAFORSEO_LOGIN = 'test-login';
process.env.DATAFORSEO_PASSWORD = 'test-pass';
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'sk-test';

const pulse = require('../services/search_intel/search_pulse');

beforeEach(() => {
  pulseRuns.length = 0; pulseSeq = 0;
  images.clear(); imageSeq = 0;
  _openaiContent = null;
});

// ── Search Pulse keyword history ─────────────────────────────────────────────

const SEED = 'running shoes';

test('two tenants running the same seed each read back only their own history', async () => {
  await pulse.runPulse(SEED, 'en-US', 1);
  await pulse.runPulse(SEED, 'en-US', 1); // tenant 1 ran it twice
  await pulse.runPulse(SEED, 'en-US', 2); // tenant 2 once

  const h1 = await pulse.getPulseHistory(SEED, 12, 1);
  const h2 = await pulse.getPulseHistory(SEED, 12, 2);

  assert.strictEqual(h1.length, 2, 'tenant 1 sees its two runs only');
  assert.strictEqual(h2.length, 1, 'tenant 2 sees its single run only');
  assert.ok(h1.every(r => r.suggestion_count === 2));
  // No row from tenant 2 leaks into tenant 1's history (and vice-versa).
  assert.ok(pulseRuns.length === 3);
});

test('getPulseHistory(tenantA) never returns tenantB\'s runs', async () => {
  await pulse.runPulse(SEED, 'en-US', 2); // only tenant 2 ran anything

  const h1 = await pulse.getPulseHistory(SEED, 12, 1);
  assert.deepStrictEqual(h1, [], 'tenant 1 has no history of its own');
});

// ── Image / logo cache ───────────────────────────────────────────────────────

const SAME_URL = 'https://cdn.example.com/shared-image.png';

test('two tenants caching the SAME source_url keep independent rows', async () => {
  _openaiContent = JSON.stringify({ brands: [{ name: 'Acme', confidence: 0.9 }], objects: ['box'] });
  const a = await pulse.analyzeImage(SAME_URL, false, 1);
  _openaiContent = JSON.stringify({ brands: [{ name: 'Globex', confidence: 0.8 }], objects: ['can'] });
  const b = await pulse.analyzeImage(SAME_URL, false, 2);

  // Per-tenant UNIQUE (tenant_id, source_url) allows the same URL twice.
  assert.strictEqual(images.size, 2);
  assert.strictEqual(a.brands[0].name, 'Acme');
  assert.strictEqual(b.brands[0].name, 'Globex');
});

test('a cache hit is tenant-scoped — tenant A never serves tenant B\'s cached analysis', async () => {
  // Tenant 2 has cached an analysis for the URL; tenant 1 has not.
  _openaiContent = JSON.stringify({ brands: [{ name: 'Globex', confidence: 0.8 }], objects: [] });
  await pulse.analyzeImage(SAME_URL, false, 2);

  // Tenant 1 requests the same URL → must NOT hit tenant 2's row; it analyzes
  // fresh (cached:false) and stores its own.
  _openaiContent = JSON.stringify({ brands: [{ name: 'Acme', confidence: 0.9 }], objects: [] });
  const r1 = await pulse.analyzeImage(SAME_URL, false, 1);
  assert.strictEqual(r1.cached, false, 'tenant 1 must miss tenant 2\'s cache');
  assert.strictEqual(r1.brands[0].name, 'Acme');

  // Tenant 1 requesting again now hits ITS OWN cached row (not tenant 2's).
  const r1again = await pulse.analyzeImage(SAME_URL, false, 1);
  assert.strictEqual(r1again.cached, true);
  assert.strictEqual(r1again.brands[0].name, 'Acme');

  // Tenant 2's row is still its own.
  const r2 = await pulse.analyzeImage(SAME_URL, false, 2);
  assert.strictEqual(r2.cached, true);
  assert.strictEqual(r2.brands[0].name, 'Globex');
});

test('a same-tenant re-analysis upserts in place rather than duplicating', async () => {
  _openaiContent = JSON.stringify({ brands: [{ name: 'Acme', confidence: 0.5 }], objects: [] });
  await pulse.analyzeImage(SAME_URL, false, 1);
  assert.strictEqual(images.size, 1);
  const firstId = images.get(imgKey(1, SAME_URL)).id;

  // Force a re-analysis with updated brands; ON CONFLICT updates the same row.
  _openaiContent = JSON.stringify({ brands: [{ name: 'Acme', confidence: 0.95 }], objects: ['logo'] });
  const refreshed = await pulse.analyzeImage(SAME_URL, true, 1);

  assert.strictEqual(images.size, 1, 'no duplicate row created');
  assert.strictEqual(images.get(imgKey(1, SAME_URL)).id, firstId, 'same row updated in place');
  assert.strictEqual(refreshed.brands[0].confidence, 0.95);
});
