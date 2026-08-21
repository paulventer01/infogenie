// test/tenant-closeout-drop-isolation.test.js — residual isolation after e2c15fa
//
// The e2c15fa hook-order fix (single t.after, restore while holding the closeout
// advisory lock, unlock last, addLockedCleanup) is internally correct. The
// remaining deadlock is test-isolation only: DROP TABLE IF EXISTS
// brand_foundation CASCADE on the live QA DATABASE_URL vs unlocked
// DELETE FROM tenants in parallel node --test workers.
//
// Isolation chosen: closeout and preflight point destructive DDL at a per-file
// scratch database (same pattern as tenant-preflight-isolation). Unlocked
// DELETE FROM tenants on live cannot lock the same brand_foundation a closer
// DROPs. This file:
//   1. Pins that source contract so DROPs cannot silently return to live.
//   2. Runs concurrent DROP (scratch) vs DELETE tenants (live) with no sleeps.
//      Any 40P01 fails the test.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const {
  scratchName,
  swapDatabase,
  clientOptions,
  createScratchDatabase,
  dropScratchDatabase,
  isDeadlockError,
} = require('./helpers/scratch_db');

const ADMIN_URL = process.env.DATABASE_URL || '';
const skip = ADMIN_URL ? false : 'no DATABASE_URL — closeout drop isolation skipped';

const CLOSEOUT_SRC = path.join(__dirname, 'tenant-schema-closeout.test.js');
const PREFLIGHT_SRC = path.join(__dirname, 'tenant-schema-preflight.test.js');
const ISO_SRC = path.join(__dirname, 'tenant-closeout-isolation.test.js');
const K_SRC = path.join(__dirname, 'benchmark-k-anonymity.test.js');
const CONTRIB_SRC = path.join(__dirname, 'benchmark-contributor-anonymity.test.js');

const ITERATIONS = 40;
const LIVE_SLUG_PREFIX = `dropiso-${process.pid}-`;

let scratchDb = null;
let scratchUrl = null;

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function assertSwapsToScratchBeforeDb(src, label) {
  const assign = src.indexOf('process.env.DATABASE_URL = SCRATCH_URL');
  const dbRequire = src.indexOf("require('../db')");
  assert.ok(assign >= 0, `${label} must assign DATABASE_URL to SCRATCH_URL`);
  assert.ok(dbRequire >= 0, `${label} must require db.js`);
  assert.ok(assign < dbRequire,
    `${label} must swap DATABASE_URL to the scratch database before requiring db.js`);
  assert.match(src, /createScratchDatabase/, `${label} must CREATE DATABASE a scratch name`);
  assert.match(src, /dropScratchDatabase/, `${label} must DROP DATABASE the scratch name`);
  assert.match(src, /DROP TABLE IF EXISTS brand_foundation CASCADE/);
}

test('closeout and preflight point DROP brand_foundation at a scratch database, not live DATABASE_URL', () => {
  assertSwapsToScratchBeforeDb(read(CLOSEOUT_SRC), 'tenant-schema-closeout.test.js');
  assertSwapsToScratchBeforeDb(read(PREFLIGHT_SRC), 'tenant-schema-preflight.test.js');
});

test('e2c15fa hook-order (restore while holding lock, unlock last, addLockedCleanup) is still present', () => {
  const closeout = read(CLOSEOUT_SRC);
  assert.match(closeout, /t\.after\(async \(\) => \{/);
  assert.match(closeout, /await restoreCanonicalSchema\(\)/);
  assert.match(closeout, /await releaseCloseoutLock\(lockClient\)/);
  const restoreAt = closeout.indexOf('await restoreCanonicalSchema()');
  const unlockAt = closeout.indexOf('await releaseCloseoutLock(lockClient)');
  assert.ok(restoreAt >= 0 && unlockAt > restoreAt, 'closeout must restore before unlock');

  const preflight = read(PREFLIGHT_SRC);
  assert.match(preflight, /addLockedCleanup/);
  assert.match(preflight, /await restorePreflightFixtures\(lockedCleanups\)/);
  const preRestore = preflight.indexOf('await restorePreflightFixtures(lockedCleanups)');
  const preUnlock = preflight.indexOf('await releaseLock(lockClient)');
  assert.ok(preRestore >= 0 && preUnlock > preRestore, 'preflight must restore before unlock');
});

test('restorePreflightFixtures and isolation/k-anonymity tenant cleanup rethrow 40P01', () => {
  const preflight = read(PREFLIGHT_SRC);
  assert.match(preflight, /isDeadlockError\(err\)\) throw err/);
  assert.match(preflight, /40P01/);

  for (const [label, src] of [
    ['tenant-closeout-isolation.test.js', read(ISO_SRC)],
    ['benchmark-k-anonymity.test.js', read(K_SRC)],
    ['benchmark-contributor-anonymity.test.js', read(CONTRIB_SRC)],
  ]) {
    assert.match(src, /rethrowDeadlock/, `${label} must rethrow deadlock-class errors`);
    assert.doesNotMatch(src, /DELETE FROM tenants[\s\S]{0,80}\.catch\(\(\) => \{\}\)/,
      `${label} must not swallow DELETE FROM tenants failures with .catch(() => {})`);
    // helpers/index.js requires server.js, which fires every ensure*Schema at
    // load and 23505-races CREATE INDEX on the live QA database.
    assert.doesNotMatch(src, /require\('\.\/helpers'\)/,
      `${label} must not require test/helpers/index.js (loads server.js)`);
  }
});

before(async () => {
  if (skip) return;
  await ensureAuthSchema();
  await ensureTenantSchema();
  scratchDb = scratchName('dropiso');
  scratchUrl = swapDatabase(ADMIN_URL, scratchDb);
  await createScratchDatabase(ADMIN_URL, scratchDb);

  const scratch = new Client(clientOptions(scratchUrl));
  await scratch.connect();
  try {
    await scratch.query(`
      CREATE TABLE tenants (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL
      )
    `);
    await scratch.query(`
      CREATE TABLE brand_foundation (
        id INTEGER PRIMARY KEY DEFAULT 1,
        tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
        purpose_why TEXT DEFAULT ''
      )
    `);
    await scratch.query(
      `INSERT INTO tenants (name, slug, status) VALUES ('dropiso','dropiso','active')`);
    await scratch.query(
      `INSERT INTO brand_foundation (id, tenant_id) VALUES (1, 1)`);
  } finally {
    await scratch.end();
  }
});

after(async () => {
  if (!ADMIN_URL) return;
  try { if (scratchDb) await dropScratchDatabase(ADMIN_URL, scratchDb); } catch { /* ignore */ }
  try {
    const pool = require('../db').getPool();
    if (pool) await pool.end();
  } catch { /* pool unused when skipped */ }
});

test('concurrent DROP brand_foundation on scratch vs DELETE tenants on live must not 40P01', { skip }, async () => {
  const scratch = new Client(clientOptions(scratchUrl));
  const live = new Client(clientOptions(ADMIN_URL));
  await scratch.connect();
  await live.connect();

  const deadlocks = [];

  async function dropLoop() {
    for (let i = 0; i < ITERATIONS; i++) {
      try {
        await scratch.query('DROP TABLE IF EXISTS brand_foundation CASCADE');
        await scratch.query(`
          CREATE TABLE brand_foundation (
            id INTEGER PRIMARY KEY DEFAULT 1,
            tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
            purpose_why TEXT DEFAULT ''
          )
        `);
        await scratch.query(
          `INSERT INTO brand_foundation (id, tenant_id) VALUES (1, 1)
           ON CONFLICT (id) DO NOTHING`);
      } catch (err) {
        if (isDeadlockError(err)) deadlocks.push({ side: 'drop', code: err.code, message: err.message });
        else throw err;
      }
    }
  }

  async function deleteLoop() {
    for (let i = 0; i < ITERATIONS; i++) {
      const slug = `${LIVE_SLUG_PREFIX}${i}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const row = await live.query(
          `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
          [`dropiso ${i}`, slug]);
        await live.query(`DELETE FROM tenants WHERE id=$1`, [row.rows[0].id]);
      } catch (err) {
        if (isDeadlockError(err)) {
          deadlocks.push({ side: 'delete', code: err.code, message: err.message });
          continue;
        }
        throw err;
      }
    }
  }

  try {
    await Promise.all([dropLoop(), deleteLoop()]);
  } finally {
    try {
      await live.query(`DELETE FROM tenants WHERE slug LIKE $1`, [`${LIVE_SLUG_PREFIX}%`]);
    } catch (err) {
      if (isDeadlockError(err)) deadlocks.push({ side: 'cleanup', code: err.code, message: err.message });
      else throw err;
    }
    await scratch.end();
    await live.end();
  }

  assert.deepStrictEqual(deadlocks, [],
    `40P01/40001 under scratch isolation — DROP and DELETE must not share brand_foundation:\n${
      deadlocks.map((d) => `${d.side} ${d.code}: ${d.message}`).join('\n')}`);
});
