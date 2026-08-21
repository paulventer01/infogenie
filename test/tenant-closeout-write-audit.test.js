// test/tenant-closeout-write-audit.test.js — isolation guard for the fail-closed
// tenant_id closeout tables.
//
// test/tenant-write-audit.test.js and test/tenant-read-audit.test.js both derive
// their tenant-scoped table set from PLAIN_TABLES + REWRITE_UNIQUE in
// services/tenants/phase2_migrate.js. The closeout tables — the children and
// previously-nullable tables migrated with enforceTenantIdNotNull() from their
// own services/<name>/schema.js — are in NEITHER list, so their INSERTs are
// invisible to both audits. That blind spot is exactly how an
//
//     INSERT INTO compliance_checklist_items (checklist_id, ...)   -- no tenant_id
//
// reaches production: the column is NOT NULL, so the write throws 23502 and the
// surrounding try/catch turns it into a silent 500 rather than a leak. This file
// audits that set, deriving it from the enforceTenantIdNotNull() call sites so a
// new fail-closed table is covered with no extra wiring.
//
// Three properties, none of them covered elsewhere:
//
//   1. CLOSEOUT — every INSERT into a fail-closed table names tenant_id.
//   2. MIXED    — in a table that legitimately holds global system rows
//                 (vertical_playbooks, the `roles` pattern), an INSERT may omit
//                 tenant_id ONLY when the row it writes is a system row
//                 (is_system TRUE). A custom row without tenant_id lands in the
//                 shared system key space, where another tenant can address it.
//   3. ON CONFLICT — on a table whose natural-key UNIQUE was rewritten to lead
//                 with tenant_id, an explicit conflict target must include
//                 tenant_id. A target that omits it either raises 42P10 or, on an
//                 install where the legacy global unique survived, matches THAT
//                 constraint and the DO UPDATE arm overwrites another
//                 workspace's row.
//
// Pure static scan of the source — no DATABASE_URL, runs anywhere. Every scan is
// bounded to the enclosing SQL string literal so it cannot read a keyword out of
// the surrounding JavaScript or the next statement. This file adds assertions; it
// does not modify or relax the existing tenant audits.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PLAIN_TABLES, REWRITE_UNIQUE } = require('../services/tenants/phase2_migrate');

const REPO_ROOT = path.join(__dirname, '..');
const SERVICES_DIR = path.join(REPO_ROOT, 'services');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

// Tables the two existing audits already cover. Excluded here so a failure in
// this file always points at the blind spot rather than duplicating them.
const ALREADY_AUDITED = new Set([...PLAIN_TABLES, ...REWRITE_UNIQUE.map(r => r.table)]);

// ── MIXED tables (the `roles` pattern) ──────────────────────────────────────
// tenant_id is intentionally NULLABLE: system rows are global, custom rows are
// tenant-owned. Mirrors NULLABLE_OK in test/tenant-schema-audit.test.js and
// PHASE2E_NULLABLE_OK in phase2_migrate.js. `column` is the flag that makes an
// un-stamped INSERT legitimate — the row is catalog content, not workspace data.
// Anything else must carry tenant_id.
const MIXED_TABLES = new Map([
  ['vertical_playbooks', {
    column: 'is_system',
    // Partial unique indexes: (vertical) WHERE tenant_id IS NULL for the shared
    // catalog, (tenant_id, title) WHERE tenant_id IS NOT NULL for custom rows.
    // A custom row with a NULL tenant occupies the catalog's key space.
    why: 'system catalog rows keep tenant_id IS NULL with is_system=TRUE; custom ' +
         '(is_system=FALSE) playbooks are tenant-owned and must stamp tenant_id',
  }],
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

// services/, scripts/ and the repo root's own .js files (server.js wires routes
// directly). Same three roots as the sibling audits.
function collectFiles() {
  const files = [...walk(SERVICES_DIR), ...walk(SCRIPTS_DIR)];
  for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(REPO_ROOT, entry.name));
  }
  return files;
}

// The tables closed out through the fail-closed helper, derived from the
// migration source rather than a hand-maintained list, so a new fail-closed table
// is audited with no extra wiring here.
//
// Scope is every services/**/schema.js that uses enforceTenantIdNotNull; within
// those files, every table declared `tenant_id … NOT NULL` plus any table named
// as a literal argument to the helper. The DDL half matters because some call
// sites pass a loop variable (services/youtube_monitor/schema.js iterates
// ['yt_channels', 'yt_snapshots']), so scanning only the literal arguments would
// silently drop those tables. Restricting to fail-closed schema files keeps this
// a closeout guard rather than a second repo-wide audit.
function deriveCloseoutTables() {
  const tables = new Set();
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  const literalRe = /enforceTenantIdNotNull\(\s*'([a-z_][a-z0-9_]*)'/g;
  for (const full of walk(SERVICES_DIR)) {
    if (path.basename(full) !== 'schema.js') continue;
    const src = fs.readFileSync(full, 'utf8');
    if (!src.includes('enforceTenantIdNotNull')) continue;
    let m;
    createRe.lastIndex = 0;
    while ((m = createRe.exec(src))) {
      const { inner } = readGroup(src, createRe.lastIndex - 1);
      if (inner != null && /tenant_id[^,]*NOT\s+NULL/i.test(inner)) tables.add(m[1]);
    }
    literalRe.lastIndex = 0;
    while ((m = literalRe.exec(src))) tables.add(m[1]);
  }
  for (const t of ALREADY_AUDITED) tables.delete(t);
  return tables;
}

const CLOSEOUT_TABLES = deriveCloseoutTables();

// The SQL string literal containing `idx`. Scans back to the opening quote and
// forward to its unescaped partner, so a keyword in the surrounding JavaScript
// (or in the next query in the same function) can never be read as part of this
// statement. Returns null when the INSERT is not inside a single literal.
function enclosingLiteral(src, idx) {
  for (let i = idx; i >= 0; i--) {
    const c = src[i];
    if (c !== '`' && c !== "'" && c !== '"') continue;
    if (i > 0 && src[i - 1] === '\\') continue;
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === c) {
        return j > idx ? { text: src.slice(i + 1, j), offset: i + 1 } : null;
      }
      // A newline ends an unterminated single/double-quoted literal.
      if (c !== '`' && src[j] === '\n') return null;
    }
    return null;
  }
  return null;
}

// Split a comma-separated SQL fragment at the top level only, so commas inside
// parens, brackets, braces or quoted literals do not split. Lets column N line up
// with value N.
function splitTopLevel(s) {
  const parts = [];
  let depth = 0, buf = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { buf += c; if (c === q && s[i - 1] !== '\\') q = null; continue; }
    if (c === "'" || c === '"') { q = c; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; buf += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '' || parts.length) parts.push(buf.trim());
  return parts;
}

// Read the parenthesised group starting at/after `fromIdx`. Returns its inner
// text and the index just past the closing ')'.
function readGroup(text, fromIdx) {
  let i = fromIdx;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '(') return { inner: null, endIdx: i };
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { inner: text.slice(i + 1, j), endIdx: j + 1 };
    }
  }
  return { inner: null, endIdx: text.length };
}

// A column list assembled by JS interpolation cannot be judged by a text scan.
// `INSERT INTO brand_foundation (${cols.join(', ')})` is correct — `cols` is built
// as ['tenant_id', ...keys] — but nothing in the literal says so. Skip these
// rather than cry wolf, the same convention the sibling write audit uses; the
// runtime per-feature isolation tests cover them.
function isInterpolated(cols) {
  return cols != null && cols.includes('${');
}

// Locate every `INSERT INTO <table>` in the file, resolved to the SQL literal it
// sits in, with the column list already parsed. `stmt` is the statement text
// AFTER the column list — bounded to this literal.
function findInserts(src) {
  const out = [];
  const re = /INSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(src))) {
    // Surrounding JavaScript (// comments) is not a live statement. The file
    // header bounds this scan to SQL string literals; a documented-retired
    // seed such as `INSERT INTO brand_foundation (id) VALUES (1)` in a comment
    // must not be treated as a writer. Live query strings still match.
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const beforeOnLine = src.slice(lineStart, m.index);
    if (/(?:^|\s)\/\//.test(beforeOnLine)) continue;
    const lit = enclosingLiteral(src, m.index);
    const line = src.slice(0, m.index).split('\n').length;
    if (!lit) { out.push({ table: m[1], line, cols: null, stmt: '' }); continue; }
    const localEnd = re.lastIndex - lit.offset;
    const { inner, endIdx } = readGroup(lit.text, localEnd);
    out.push({ table: m[1], line, cols: inner, stmt: lit.text.slice(endIdx) });
  }
  return out;
}

// ── 1. Closeout tables: every INSERT names tenant_id ────────────────────────
test('every INSERT into a fail-closed closeout table names tenant_id', () => {
  const offenders = [];
  for (const full of collectFiles()) {
    const src = fs.readFileSync(full, 'utf8');
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    for (const ins of findInserts(src)) {
      if (!CLOSEOUT_TABLES.has(ins.table)) continue;
      if (isInterpolated(ins.cols)) continue;
      if (ins.cols != null && /\btenant_id\b/.test(ins.cols)) continue;
      offenders.push(`${rel}:${ins.line} → INSERT INTO ${ins.table} (` +
        (ins.cols == null ? 'no explicit column list' : 'column list omits tenant_id') + ')');
    }
  }
  assert.deepStrictEqual(offenders, [],
    `These INSERTs write a fail-closed tenant table without naming tenant_id. The ` +
    `column is NOT NULL, so the write raises 23502 and the surrounding try/catch ` +
    `turns it into a silent failure. Stamp the tenant from the resolved request ` +
    `(resolveTenantId(req, {label})) or, for a child row, from the parent row that ` +
    `was already loaded under a tenant predicate — never from req.body.tenant_id:\n  ` +
    offenders.join('\n  '));
});

// ── 2. MIXED tables: only a system row may skip the tenant stamp ────────────
test('in a MIXED table, only a system row may omit tenant_id', () => {
  const offenders = [];
  for (const full of collectFiles()) {
    const src = fs.readFileSync(full, 'utf8');
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    for (const ins of findInserts(src)) {
      const spec = MIXED_TABLES.get(ins.table);
      if (!spec) continue;
      if (isInterpolated(ins.cols)) continue;
      if (ins.cols != null && /\btenant_id\b/.test(ins.cols)) continue; // correctly stamped
      // Un-stamped. Legitimate only when this INSERT positionally binds the
      // system flag to a literal TRUE.
      let isSystemRow = false;
      if (ins.cols != null) {
        const colTokens = splitTopLevel(ins.cols);
        const flagIdx = colTokens.findIndex(c => c.trim().toLowerCase() === spec.column);
        if (flagIdx >= 0 && /^\s*VALUES\b/i.test(ins.stmt)) {
          const { inner } = readGroup(ins.stmt, ins.stmt.search(/VALUES/i) + 'VALUES'.length);
          const values = inner == null ? [] : splitTopLevel(inner);
          isSystemRow = values.length === colTokens.length &&
            /^true$/i.test((values[flagIdx] || '').trim());
        }
      }
      if (isSystemRow) continue;
      offenders.push(`${rel}:${ins.line} → INSERT INTO ${ins.table} omits tenant_id ` +
        `and does not bind ${spec.column} to TRUE`);
    }
  }
  const why = [...MIXED_TABLES.values()].map(s => s.why).join('; ');
  assert.deepStrictEqual(offenders, [],
    `These INSERTs put a non-system row into a MIXED table without a tenant. ` +
    `${why}. A custom row left with tenant_id IS NULL sits in the shared system ` +
    `key space: it collides with the catalog's partial unique index, and any ` +
    `workspace can address it by id. Stamp the resolved tenant_id on the ` +
    `custom-row INSERT:\n  ` + offenders.join('\n  '));
});

// ── 3. ON CONFLICT targets must include tenant_id on rewritten keys ─────────
test('every ON CONFLICT target on a rewritten-unique table includes tenant_id', () => {
  const rewritten = new Map(REWRITE_UNIQUE.map(r => [r.table, r.uniqueExtras]));
  const offenders = [];
  for (const full of collectFiles()) {
    const src = fs.readFileSync(full, 'utf8');
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    for (const ins of findInserts(src)) {
      const extras = rewritten.get(ins.table);
      if (!extras) continue;
      // Only an explicit column-list target is judged. A bare `ON CONFLICT DO
      // NOTHING` has no target, matches any constraint, and cannot clobber.
      const oc = /ON\s+CONFLICT\s*\(([^)]*)\)/i.exec(ins.stmt);
      if (!oc || /\btenant_id\b/.test(oc[1])) continue;
      offenders.push(`${rel}:${ins.line} → INSERT INTO ${ins.table} ... ` +
        `ON CONFLICT (${oc[1].trim()}) — expected ON CONFLICT (tenant_id, ${extras.join(', ')})`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `These upserts name a conflict target that omits tenant_id on a table whose ` +
    `UNIQUE was rewritten to lead with tenant_id. Add tenant_id to the target. Do ` +
    `NOT restore a global unique on the natural key to make the statement parse — ` +
    `that is the cross-tenant clobber the rewrite removed:\n  ` +
    offenders.join('\n  '));
});

// ── 4. MIXED tables: a by-id lookup must constrain ownership ────────────────
// Rule 2 keeps custom rows out of the shared key space on the way IN. This is
// the read side: in a MIXED table the caller-supplied primary key spans both
// key spaces, so `WHERE id=$1` alone resolves the shared catalog AND every other
// workspace's custom rows. That was a live cross-tenant disclosure in
// playbooks:activate. A correct lookup names tenant_id — either
// `tenant_id IS NULL` for a catalog-only read, or an ownership arm such as
// `(is_system=TRUE AND tenant_id IS NULL) OR tenant_id=$2`.
//
// test/tenant-closeout-isolation.test.js proves the 404 against live Postgres,
// but it is gated on DATABASE_URL and therefore skipped by the no-DB gate this
// file runs in. This keeps the predicate covered there too.
test('a by-id read of a MIXED table constrains tenant ownership', () => {
  const idParam = /\bid\s*=\s*\$\d/i;
  const offenders = [];
  for (const full of collectFiles()) {
    const src = fs.readFileSync(full, 'utf8');
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    for (const table of MIXED_TABLES.keys()) {
      const re = new RegExp(`\\b(?:FROM|JOIN|UPDATE)\\s+${table}\\b`, 'gi');
      let m;
      while ((m = re.exec(src))) {
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        if (/(?:^|\s)\/\//.test(src.slice(lineStart, m.index))) continue;
        const lit = enclosingLiteral(src, m.index);
        if (!lit) continue;
        // Only statements that resolve a row by caller-supplied id are judged;
        // a catalog listing has no id predicate and cannot be pivoted.
        if (!idParam.test(lit.text)) continue;
        if (/\btenant_id\b/.test(lit.text)) continue;
        offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length} → ` +
          `${table} resolved by id with no tenant_id predicate`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [],
    `These statements address a MIXED table by a caller-supplied id without ` +
    `naming tenant_id. Because tenant_id is nullable there, the id space is ` +
    `shared between the global catalog and every workspace's custom rows, so the ` +
    `lookup reaches another tenant's row. Constrain it to ` +
    `(is_system=TRUE AND tenant_id IS NULL) OR tenant_id=$n, and return 404 — not ` +
    `403 — so the response does not confirm the row exists:\n  ` +
    offenders.join('\n  '));
});

// ── Guard the guards ───────────────────────────────────────────────────────
// Both derived sets must be non-empty, or the audits above pass vacuously — the
// exact failure mode that let these tables ship unaudited in the first place.
test('the closeout and MIXED table sets are non-empty (derivation resolved)', () => {
  assert.ok(CLOSEOUT_TABLES.size > 0,
    'No closeout tables derived from enforceTenantIdNotNull() call sites in ' +
    'services/**/schema.js. The helper was renamed or the call sites moved, and ' +
    'the INSERT audit above would pass vacuously.');
  assert.ok(MIXED_TABLES.size > 0, 'MIXED_TABLES is empty — the MIXED audit would pass vacuously.');
  // The known child tables must be in the derived set; if a rename drops one,
  // fail here rather than quietly stopping the audit of its INSERTs.
  for (const t of ['compliance_checklist_items', 'post_launch_checks', 'hashtag_scans', 'yt_snapshots']) {
    assert.ok(CLOSEOUT_TABLES.has(t),
      `${t} is no longer derived as a closeout table — its INSERTs are unaudited.`);
  }
});

// Every MIXED table must still be declared nullable-by-design in the schema
// audit. If one is flipped to NOT NULL, rule 2's system-row exemption is wrong
// and must be removed rather than left granting a blanket pass.
test('MIXED tables are still the documented nullable-by-design set', () => {
  const auditSrc = fs.readFileSync(path.join(__dirname, 'tenant-schema-audit.test.js'), 'utf8');
  const block = /const NULLABLE_OK = new Set\(\[([\s\S]*?)\]\)/.exec(auditSrc);
  assert.ok(block, 'could not read NULLABLE_OK from test/tenant-schema-audit.test.js');
  for (const table of MIXED_TABLES.keys()) {
    assert.ok(block[1].includes(`'${table}'`),
      `${table} is treated as MIXED here but is not in NULLABLE_OK in ` +
      `tenant-schema-audit. Either it is now strictly tenant-owned (drop it from ` +
      `MIXED_TABLES so its INSERTs lose the system-row exemption) or the schema ` +
      `audit regressed.`);
  }
});
