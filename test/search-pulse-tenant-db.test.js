// test/search-pulse-tenant-db.test.js — Task #61 real-DB schema isolation guard
//
// The fake-pool tests in search-pulse-tenant-isolation.test.js prove the
// APPLICATION code passes/filters tenant_id correctly, but they replace
// Postgres with an in-memory map — so they cannot catch a SCHEMA regression.
// The isolation of Search Pulse history and the OpenAI-vision logo/brand cache
// ultimately rests on two DDL facts in services/search_intel/schema.js:
//
//   • search_intel_images carries a per-tenant UNIQUE (tenant_id, source_url),
//     and the legacy global UNIQUE (source_url) was DROPPED. If that drop ever
//     regressed, two workspaces could no longer cache the same image URL
//     independently — the second tenant's INSERT would hit the global unique
//     and either error or clobber the first tenant's cached analysis.
//   • search_intel_pulse_runs reads filter by tenant_id at the SQL level, so a
//     workspace only ever sees its own keyword-pulse history.
//
// This test exercises the ACTUAL Postgres schema (idempotently (re)created via
// ensureSearchIntelSchema) to assert both invariants hold end-to-end. It is
// gated on DATABASE_URL like the other real-DB tests; with no database there is
// no schema to inspect and it is skipped.

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureSearchIntelSchema } = require('../services/search_intel/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const pulse = require('../services/search_intel/search_pulse');

const HAS_DB = db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — search-intel DB isolation test skipped';

// Unique markers so this test never collides with — or clobbers — real data.
const SUFFIX = `t61-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SOURCE_URL = `https://example.com/${SUFFIX}/logo.png`;
const SEED = `seed-${SUFFIX}`;

let tenantA = null;
let tenantB = null;

// INSERT that mirrors analyzeImage()'s real upsert exactly.
async function upsertImage(p, tenantId, brand, objects = []) {
  await p.query(
    `INSERT INTO search_intel_images (source_url, brands, objects, raw, tenant_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, source_url)
       DO UPDATE SET brands=EXCLUDED.brands, objects=EXCLUDED.objects, raw=EXCLUDED.raw, ran_at=now()`,
    [SOURCE_URL, JSON.stringify([{ name: brand, confidence: 0.9 }]),
      JSON.stringify(objects), 'raw', tenantId]
  );
}

before(async () => {
  if (!HAS_DB) return;
  // Both are idempotent on every boot; safe to (re)run here so the test is
  // self-contained even if the app hasn't booted in this environment.
  await ensureTenantSchema();
  await ensureSearchIntelSchema();

  const p = db.getPool();
  const mk = async (label, slug) => (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [label, slug]
  )).rows[0].id;
  tenantA = await mk(`T61 A ${SUFFIX}`, `t61-a-${SUFFIX}`);
  tenantB = await mk(`T61 B ${SUFFIX}`, `t61-b-${SUFFIX}`);
});

after(async () => {
  if (!HAS_DB) return;
  const p = db.getPool();
  // tenant_id REFERENCES tenants(id) ON DELETE CASCADE, so deleting the test
  // tenants removes every search_intel row we created — full cleanup.
  const ids = [tenantA, tenantB].filter(Boolean);
  if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
});

// ── Schema: the per-tenant UNIQUE exists and the legacy global UNIQUE is gone ──
test('search_intel_images has UNIQUE (tenant_id, source_url) and no global UNIQUE (source_url)', { skip }, async () => {
  const p = db.getPool();
  const cons = (await p.query(
    `SELECT tc.constraint_type,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema   = kcu.table_schema
      WHERE tc.table_schema='public'
        AND tc.table_name='search_intel_images'
        AND tc.constraint_type IN ('UNIQUE','PRIMARY KEY')
      GROUP BY tc.constraint_name, tc.constraint_type`
  )).rows.map(r => ({ type: r.constraint_type, cols: r.cols }));

  assert.ok(
    cons.some(c => c.type === 'UNIQUE' && c.cols === 'tenant_id,source_url'),
    `missing composite UNIQUE (tenant_id, source_url) — found: ${JSON.stringify(cons)}`
  );
  assert.ok(
    !cons.some(c => c.type === 'UNIQUE' && c.cols === 'source_url'),
    `legacy global UNIQUE (source_url) still present — logo cache leaks across tenants: ${JSON.stringify(cons)}`
  );
});

// ── Two tenants caching the SAME source_url keep independent rows ─────────────
test('two tenants caching the SAME source_url coexist as independent rows', { skip }, async () => {
  const p = db.getPool();
  await upsertImage(p, tenantA, 'Acme', ['box']);
  // With the legacy global UNIQUE (source_url) this second insert would raise a
  // unique violation (ON CONFLICT targets the composite, not the global key).
  await upsertImage(p, tenantB, 'Globex', ['can']);

  const rows = (await p.query(
    `SELECT tenant_id, brands FROM search_intel_images
      WHERE source_url=$1 AND tenant_id = ANY($2) ORDER BY tenant_id`,
    [SOURCE_URL, [tenantA, tenantB]]
  )).rows;

  assert.strictEqual(rows.length, 2, 'both tenants store the same URL independently');
  const byTenant = new Map(rows.map(r => [r.tenant_id, r.brands]));
  assert.strictEqual(byTenant.get(tenantA)[0].name, 'Acme');
  assert.strictEqual(byTenant.get(tenantB)[0].name, 'Globex');
});

// ── A same-tenant re-analysis upserts in place rather than duplicating ────────
test('a same-tenant re-analysis upserts in place (same row id, updated brands)', { skip }, async () => {
  const p = db.getPool();
  const idOf = async (tid) => (await p.query(
    `SELECT id FROM search_intel_images WHERE source_url=$1 AND tenant_id=$2`,
    [SOURCE_URL, tid]
  )).rows[0].id;

  const firstId = await idOf(tenantA);          // from the previous test's insert
  await upsertImage(p, tenantA, 'AcmeRefreshed', ['logo']);

  const rows = (await p.query(
    `SELECT id, brands FROM search_intel_images WHERE source_url=$1 AND tenant_id=$2`,
    [SOURCE_URL, tenantA]
  )).rows;

  assert.strictEqual(rows.length, 1, 'no duplicate row for the same (tenant, url)');
  assert.strictEqual(rows[0].id, firstId, 'same row updated in place');
  assert.strictEqual(rows[0].brands[0].name, 'AcmeRefreshed', 'brands replaced by the re-analysis');
});

// ── Pulse-run history reads are tenant-filtered at the SQL level ──────────────
test('getPulseHistory only returns the requesting tenant\'s runs', { skip }, async () => {
  const p = db.getPool();
  const insPulse = (tid, n) => p.query(
    `INSERT INTO search_intel_pulse_runs (seed, locale, suggestions, total_volume, tenant_id)
     VALUES ($1,'en-US',$2,$3,$4)`,
    [SEED, JSON.stringify(Array.from({ length: n }, (_, i) => ({ keyword: 'k' + i }))), 100, tid]
  );
  await insPulse(tenantA, 2);
  await insPulse(tenantA, 2);   // tenant A ran the same seed twice
  await insPulse(tenantB, 3);   // tenant B ran it once

  // getPulseHistory hits the real DB (DATABASE_URL is set) with WHERE tenant_id=$2.
  const hA = await pulse.getPulseHistory(SEED, 12, tenantA);
  const hB = await pulse.getPulseHistory(SEED, 12, tenantB);

  assert.strictEqual(hA.length, 2, 'tenant A sees only its two runs');
  assert.strictEqual(hB.length, 1, 'tenant B sees only its single run');
  assert.ok(hA.every(r => Number(r.suggestion_count) === 2), 'tenant A never sees tenant B rows');
  assert.ok(hB.every(r => Number(r.suggestion_count) === 3), 'tenant B never sees tenant A rows');

  // And a tenant with no runs for this seed gets an empty history.
  const hNone = await pulse.getPulseHistory(SEED, 12, -1);
  assert.deepStrictEqual(hNone, [], 'a tenant with no runs sees nothing');
});
