#!/usr/bin/env node
// scripts/tenant-schema-preflight.js — read-only tenant-schema closeout preflight
//
// Operator command (exact; also printed on stdout):
//
//   DATABASE_URL=postgres://… node scripts/tenant-schema-preflight.js
//
// Equivalent npm script:
//
//   npm run tenant:preflight
//
// Makes NO database changes (SELECT only; BEGIN READ ONLY + ROLLBACK).
// Never maps rows onto tenant 1 / the default tenant.
// Never strips job_queue payloads or auto-assigns vertical_playbooks.tenant_id.
//
// Exit codes:
//   0  clean — no operator mapping required
//   1  unresolved rows (or a connection/query error)
//   2  DATABASE_URL is unset — refuse to skip so deploy cannot silently pass

'use strict';

const _db = require('../db');
const {
  preflightTenantSchemaCloseout,
  formatPreflightReport,
} = require('../services/tenants/preflight');

async function main() {
  if (!process.env.DATABASE_URL) {
    const report = { ok: false, reason: 'no_db', tables: [] };
    console.error(formatPreflightReport(report));
    return 2;
  }

  let report;
  try {
    report = await preflightTenantSchemaCloseout();
  } catch (e) {
    console.error('tenant-schema preflight failed:', e.message);
    return 1;
  }

  const out = formatPreflightReport(report);
  if (report.ok) console.log(out);
  else console.error(out);

  return report.ok ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('tenant-schema preflight failed:', e.message);
    return 1;
  })
  .then(async (code) => {
    try {
      const pool = _db.getPool && _db.getPool();
      if (pool && typeof pool.end === 'function') await pool.end();
    } catch (_) { /* ignore */ }
    process.exit(code);
  });
