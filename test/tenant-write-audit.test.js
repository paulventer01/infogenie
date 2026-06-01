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
//
// Scan coverage is not limited to services/: tenant-scoped INSERTs also live in
// top-level source (notably server.js, which wires many routes) and in scripts/.
// All three roots are walked so an omission anywhere fails the build, not just
// the ones inside per-tier service modules.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PLAIN_TABLES, REWRITE_UNIQUE } = require('../services/tenants/phase2_migrate');

const REPO_ROOT = path.join(__dirname, '..');
const SERVICES_DIR = path.join(REPO_ROOT, 'services');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

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
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Every .js source file we audit: the per-tier service modules, the build/util
// scripts, and the top-level files in the repo root (server.js wires many
// routes; db.js, app.js, etc.). Directories other than services/ and scripts/
// are NOT recursed (node_modules, data, uploads, …); only the root's own .js
// files are picked up.
function collectFiles() {
  const files = [...walk(SERVICES_DIR), ...walk(SCRIPTS_DIR)];
  for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(REPO_ROOT, entry.name));
    }
  }
  return files;
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
  const files = collectFiles();
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

// ════════════════════════════════════════════════════════════════════════════
// VALUE-SIDE AUDIT (Task #73)
// ════════════════════════════════════════════════════════════════════════════
// The name-side audit above proves every INSERT into a tenant-scoped table
// *names* tenant_id in its column list. That is necessary but not sufficient: an
// INSERT can name tenant_id and still feed it an obviously-broken value, e.g.
//
//     INSERT INTO foo (tenant_id, name) VALUES (NULL, $1)      -- literal NULL
//     INSERT INTO foo (tenant_id, name) VALUES (0, $1)         -- literal 0
//     INSERT INTO foo (tenant_id, name) VALUES (undefined, $1) -- JS undefined
//     INSERT INTO foo (tenant_id, name) VALUES ($1)            -- value missing
//
// With MULTITENANT_ENFORCEMENT='on' the NOT NULL column makes a literal NULL /
// missing value throw (swallowed by the surrounding try/catch → row silently
// dropped); a literal 0 inserts a row owned by a tenant that does not exist,
// cross-contaminating no one but orphaning the data. Either way the user's save
// silently fails or lands in the wrong place. This static scan flags the
// obvious cases before they ship.
//
// It can only judge VALUES that are statically inspectable — literal tuples like
// `VALUES (NULL, $1, ...)`. It deliberately skips anything it cannot map with
// confidence (INSERT ... SELECT, JS `${...}` interpolation, multi-string
// concatenation) to avoid false positives; the worst it does there is stay
// silent, never cry wolf. Placeholder values (`$N`) are accepted — verifying the
// JS params array binds a real tenant id is beyond a static text scan and is the
// job of the runtime schema/read audits.

// Split a comma-separated SQL fragment at the TOP level only — commas inside
// parens/brackets/braces (subqueries, ARRAY[...], jsonb_build_object(...)) and
// inside quoted string literals do not split. Used for both column lists and
// VALUES tuples so column N lines up with value N.
function splitTopLevel(s) {
  const parts = [];
  let depth = 0, buf = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      buf += c;
      if (c === q && s[i - 1] !== '\\') q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; buf += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '' || parts.length) parts.push(buf.trim());
  return parts;
}

// Like readColumnList but also returns the index immediately AFTER the closing
// ')' of the column list, so the caller can locate the VALUES clause.
function readColumnListAndEnd(src, fromIdx) {
  let i = fromIdx;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '(') return { cols: null, endIdx: i };
  let depth = 0, buf = '';
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { cols: buf.slice(1), endIdx: j + 1 };
    }
    buf += c;
  }
  return { cols: null, endIdx: src.length };
}

// Starting at the index right after a column list's ')', parse the VALUES
// clause into an array of tuples (each an array of top-level value tokens).
// Returns null when there is no literal VALUES tuple to inspect — INSERT ...
// SELECT, DEFAULT VALUES, or a VALUES list built by interpolation rather than
// a literal '(' — so the caller skips (cannot statically map).
function readValueTuples(src, afterColsIdx) {
  const rest = src.slice(afterColsIdx);
  const kw = /^\s*([a-z_]+)/i.exec(rest);
  if (!kw || !/^values$/i.test(kw[1])) return null; // SELECT / DEFAULT / etc.
  let i = afterColsIdx + kw[0].length;
  const tuples = [];
  while (true) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '(') break;
    let depth = 0, buf = '', q = null, j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { buf += c; if (c === q && src[j - 1] !== '\\') q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; buf += c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { buf += c; j++; break; } }
      buf += c;
    }
    tuples.push(splitTopLevel(buf.slice(1, -1))); // strip outer parens
    i = j;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === ',') { i++; continue; } // another row tuple follows
    break;
  }
  return tuples.length ? tuples : null;
}

// Classify a single value token bound to the tenant_id column. Returns a human
// reason string when the value is an obvious non-value, else null. Placeholders
// ($N), column refs, function calls and sub-selects are all accepted here.
function badTenantValueReason(tok) {
  const t = tok.trim();
  if (/^null$/i.test(t)) return 'literal NULL';
  if (/^undefined$/.test(t)) return 'literal undefined';
  if (/^0$/.test(t)) return 'literal 0 (no tenant has id 0)';
  return null;
}

// Value-side exceptions: an INSERT whose statically-visible tenant_id value
// LOOKS bad but is provably correct in context. Same mechanism as ALLOWLIST —
// key "relative/path.js:table", value a documented reason. Empty today.
const VALUE_ALLOWLIST = new Map([
  // ['services/foo/api.js:bar_items',
  //   'tenant_id literal 0 is the sentinel global-template row, never a real tenant.'],
]);

function scanFileValues(full) {
  const src = fs.readFileSync(full, 'utf8');
  const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
  const offenders = [];
  const re = /INSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1];
    if (!SCOPED_TABLES.has(table)) continue;              // not tenant-scoped
    if (VALUE_ALLOWLIST.has(`${rel}:${table}`)) continue; // documented exception
    const { cols, endIdx } = readColumnListAndEnd(src, re.lastIndex);
    if (cols == null) continue;                 // no column list — name-side audit owns this
    if (cols.includes('${')) continue;          // interpolated column list — can't index reliably
    const colTokens = splitTopLevel(cols);
    const tidIdx = colTokens.findIndex(c => /^tenant_id$/i.test(c.trim()));
    if (tidIdx < 0) continue;                    // doesn't name tenant_id — name-side audit owns this
    const tuples = readValueTuples(src, endIdx);
    if (!tuples) continue;                       // INSERT ... SELECT / non-literal VALUES — unmappable
    const line = src.slice(0, m.index).split('\n').length;
    for (const tuple of tuples) {
      if (tuple.join(',').includes('${')) continue; // interpolated row tuple — can't map positions
      if (tuple.length !== colTokens.length) {
        offenders.push({
          rel, table, line,
          why: `VALUES has ${tuple.length} entries but the column list has ` +
               `${colTokens.length} — positional mapping is broken, tenant_id may be unset`,
        });
        continue;
      }
      const reason = badTenantValueReason(tuple[tidIdx]);
      if (reason) {
        offenders.push({
          rel, table, line,
          why: `tenant_id maps to ${reason} ("${tuple[tidIdx].trim()}")`,
        });
      }
    }
  }
  return offenders;
}

test('no INSERT feeds tenant_id an obvious non-value (literal NULL/undefined/0 or missing param)', () => {
  const files = collectFiles();
  const offenders = files.flatMap(scanFileValues);
  assert.deepStrictEqual(
    offenders, [],
    `These INSERT statements name tenant_id in their column list but supply an ` +
    `obviously-broken value for it. Under MULTITENANT_ENFORCEMENT='on' a literal ` +
    `NULL / undefined / missing value throws a not-null violation (swallowed by ` +
    `the surrounding try/catch, so the row is silently dropped) and a literal 0 ` +
    `orphans the row under a non-existent tenant. Pass the resolved tenant id ` +
    `(resolveTenantId(req, {label}) / getCronTenantId() / parent row's tenant_id) ` +
    `instead, or, if the value is provably correct in context, add the key to ` +
    `VALUE_ALLOWLIST in this test with a documented reason:\n  ` +
    offenders.map(o => `${o.rel}:${o.line} → INSERT INTO ${o.table} (${o.why})`).join('\n  ')
  );
});

// Keep VALUE_ALLOWLIST honest: every entry must still correspond to a real,
// currently-offending INSERT, or it could mask a new bad value.
test('no stale VALUE_ALLOWLIST entries', () => {
  const stale = [];
  for (const key of VALUE_ALLOWLIST.keys()) {
    const sep = key.lastIndexOf(':');
    const rel = key.slice(0, sep);
    const table = key.slice(sep + 1);
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) { stale.push(`${key} (file missing)`); continue; }
    if (!SCOPED_TABLES.has(table)) { stale.push(`${key} (table no longer tenant-scoped)`); continue; }
    // Re-run the value scan for just this file with the allowlist bypassed; the
    // entry is live only if the file still produces a value-side offender for
    // this table.
    const stillOffends = scanFileValues(full).some(o => o.table === table)
      // scanFileValues already skips allowlisted (rel,table) pairs, so temporarily
      // test against a fresh scan that ignores the allowlist:
      || (() => {
        const saved = VALUE_ALLOWLIST.get(key);
        VALUE_ALLOWLIST.delete(key);
        const hit = scanFileValues(full).some(o => o.table === table);
        VALUE_ALLOWLIST.set(key, saved);
        return hit;
      })();
    if (!stillOffends) {
      stale.push(`${key} (INSERT no longer feeds a bad tenant_id value — drop the exception)`);
    }
  }
  assert.deepStrictEqual(stale, [],
    `Stale VALUE_ALLOWLIST entries in tenant-write-audit — remove them so a real ` +
    `bad value cannot hide behind a dead exception:\n  ` + stale.join('\n  '));
});
