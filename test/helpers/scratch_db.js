// test/helpers/scratch_db.js — per-file Postgres for destructive schema tests.
//
// Closeout/preflight DROP TABLE of shared app relations (brand_foundation,
// backlink_*) must not run against the live QA DATABASE_URL. node --test runs
// files in parallel; unlocked DELETE FROM tenants on the shared database takes
// RowExclusiveLock on cascaded children and deadlocks with AccessExclusiveLock
// from DROP TABLE. Isolation is a scratch database (CREATE/DROP DATABASE),
// matching test/tenant-preflight-isolation.test.js.
//
// Connections use ssl: { rejectUnauthorized: false } — same as db.js. Do not
// disable SSL. Do not point this helper at production.

'use strict';

const crypto = require('node:crypto');
const { Client } = require('pg');

const SSL = { rejectUnauthorized: false };

function swapDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function scratchName(prefix) {
  const raw = `infogenie_${prefix}_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  if (!/^[a-z][a-z0-9_]*$/.test(raw)) {
    throw new Error(`unsafe scratch database name: ${raw}`);
  }
  return raw;
}

function clientOptions(connectionString) {
  return { connectionString, ssl: SSL };
}

async function adminQuery(adminUrl, sql) {
  const c = new Client(clientOptions(swapDatabase(adminUrl, 'postgres')));
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

async function createScratchDatabase(adminUrl, name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe scratch database name: ${name}`);
  }
  await adminQuery(adminUrl, `CREATE DATABASE ${name}`);
}

async function dropScratchDatabase(adminUrl, name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe scratch database name: ${name}`);
  }
  await adminQuery(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}

/** Postgres deadlock (40P01) and serialization failure (40001). Always rethrow. */
function isDeadlockError(err) {
  return !!(err && (err.code === '40P01' || err.code === '40001'));
}

function rethrowDeadlock(err) {
  if (isDeadlockError(err)) throw err;
}

module.exports = {
  SSL,
  swapDatabase,
  scratchName,
  clientOptions,
  adminQuery,
  createScratchDatabase,
  dropScratchDatabase,
  isDeadlockError,
  rethrowDeadlock,
};
