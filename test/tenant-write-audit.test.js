// test/tenant-write-audit.test.js — Task #63 write-side (code-level) isolation guard
//
// Sibling to test/tenant-schema-audit.test.js. That test proves every
// tenant-scoped TABLE is correctly *shaped* (has tenant_id, NOT NULL, composite
// UNIQUE). It says nothing about the application code that WRITES to those
// tables. The bug class this guards against: an
//
//     INSERT INTO <tenant-scoped table> (col_a, col_b, ...) VALUES (...)
//
// whose column list forgets `tenant_id`. With MULTITENANT_ENFORCEMENT='on' the
// tenant_id column is NOT NULL, so such an INSERT throws a not-null-violation at
// runtime — which is almost always swallowed by the surrounding try/catch (every
// tier wraps its persistence in `try { ... } catch (e) { console.warn(...) }`).
// The user sees nothing; the row is silently dropped. A static guard catches it
// before it ships instead.
//
// Unlike the schema audit (which introspects the live Postgres), this is a pure
// static scan of the source — it needs no DATABASE_URL and runs anywhere.
//
// The tenant-scoped table set is derived from PLAIN_TABLES + REWRITE_UNIQUE in
// services/tenants/phase2_migrate.js, so it stays in sync automatically: add a
// table to the migration and its INSERTs are audited here with no extra wiring.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PLAIN_TABLES, REWRITE_UNIQUE } = require('../services/tenants/phase2_migrate');

const SERVICES_DIR = path.join(__dirname, '..', 'services');
const REPO_ROOT = path.join(__dirname, '..');

// Every tenant-scoped table, derived straight from the migration source lists.
const SCOPED_TABLES = new Set([
  ...PLAIN_TABLES,
  ...REWRITE_UNIQUE.map(r => r.table),
]);

// ── Known-safe exceptions ───────────────────────────────────────────────────
// INSERTs into a tenant-scoped table whose column list legitimately omits
// tenant_id — e.g. the value is supplied by a trigger, a DEFAULT, or inherited
// from a parent row in the same statement. Key: "relative/path.js:table". Each
// entry MUST document WHY omitting tenant_id is correct, or this guard is
// pointless. The set is currently empty — every tenant-scoped INSERT in the
// codebase names tenant_id explicitly. A new exception should be a conscious,
// reviewed decision, never a silent omission.
const ALLOWLIST = new Map([
  // Example shape (keep for documentation; remove the leading '//' to use):
  // ['services/foo/api.js:bar_items',
  //   'tenant_id is set by a BEFORE INSERT trigger that copies it from the parent bar row.'],
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Given the source and the index immediately AFTER an `INSERT INTO <table>`
// match, return the parenthesized column-list text (without the outer parens),
// or null if no column list follows (positional `... VALUES`, `... SELECT`,
// `... DEFAULT VALUES`). A null column list is itself suspicious — a positional
// INSERT into a NOT-NULL-tenant_id table cannot have supplied tenant_id unless
// the table's column order happens to lead with it, which we treat as unsafe.
function readColumnList(src, fromIdx) {
  let i = fromIdx;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '(') return null;
  let depth = 0;
  let buf = '';
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return buf.slice(1); // drop the leading '('
    }
    buf += c;
  }
  return null; // unterminated — treat as no list
}

// Scan one file, returning a list of offending INSERTs into tenant-scoped tables.
function scanFile(full) {
  const src = fs.readFileSync(full, 'utf8');
  const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
  const offenders = [];
  const re = /INSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1];
    if (!SCOPED_TABLES.has(table)) continue;            // not tenant-scoped
    if (ALLOWLIST.has(`${rel}:${table}`)) continue;     // documented exception
    const cols = readColumnList(src, re.lastIndex);
    const hasTid = cols != null && /\btenant_id\b/.test(cols);
    if (hasTid) continue;                               // correctly scoped
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push({
      rel, table, line,
      why: cols == null
        ? 'INSERT has no explicit column list — cannot confirm tenant_id is set'
        : 'column list omits tenant_id',
    });
  }
  return offenders;
}

test('every INSERT into a tenant-scoped table names tenant_id in its column list', () => {
  const files = walk(SERVICES_DIR);
  const offenders = files.flatMap(scanFile);
  assert.deepStrictEqual(
    offenders, [],
    `These INSERT statements write to a tenant-scoped table without naming ` +
    `tenant_id — with MULTITENANT_ENFORCEMENT='on' the NOT NULL column makes ` +
    `them throw and the surrounding try/catch swallows the error, so the row is ` +
    `silently dropped. Add tenant_id (resolveTenantId(req, {label})) to the ` +
    `column list and values, or, if it is genuinely supplied elsewhere ` +
    `(trigger/DEFAULT/parent inherit), add the key to ALLOWLIST in this test ` +
    `with a documented reason:\n  ` +
    offenders.map(o => `${o.rel}:${o.line} → INSERT INTO ${o.table} (${o.why})`).join('\n  ')
  );
});

// Guard the guard: if the scoped-table set is empty the migration lists were
// renamed/moved and the audit above would pass vacuously. Fail loudly instead.
test('the tenant-scoped table set is non-empty (migration lists resolved)', () => {
  assert.ok(
    SCOPED_TABLES.size > 0,
    'SCOPED_TABLES is empty — PLAIN_TABLES / REWRITE_UNIQUE could not be read ' +
    'from services/tenants/phase2_migrate.js. This audit would pass vacuously.'
  );
});

// Keep ALLOWLIST honest: a stale entry (file deleted, INSERT now names tenant_id,
// or table no longer scoped) would hide a real omission elsewhere. Every entry
// must still correspond to a real, currently-offending INSERT.
test('no stale ALLOWLIST entries', () => {
  const stale = [];
  for (const key of ALLOWLIST.keys()) {
    const sep = key.lastIndexOf(':');
    const rel = key.slice(0, sep);
    const table = key.slice(sep + 1);
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) { stale.push(`${key} (file missing)`); continue; }
    if (!SCOPED_TABLES.has(table)) { stale.push(`${key} (table no longer tenant-scoped)`); continue; }
    const src = fs.readFileSync(full, 'utf8');
    const re = new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, 'i');
    const m = re.exec(src);
    if (!m) { stale.push(`${key} (no INSERT INTO ${table} in file)`); continue; }
    const cols = readColumnList(src, m.index + m[0].length);
    if (cols != null && /\btenant_id\b/.test(cols)) {
      stale.push(`${key} (INSERT now names tenant_id — drop the exception)`);
    }
  }
  assert.deepStrictEqual(stale, [],
    `Stale ALLOWLIST entries in tenant-write-audit — remove them so a real ` +
    `omission cannot hide behind a dead exception:\n  ` + stale.join('\n  '));
});
