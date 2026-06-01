// test/tenant-read-audit.test.js — read-side (code-level) tenant isolation guard
//
// Sibling to test/tenant-write-audit.test.js. The write audit catches INSERTs
// into a tenant-scoped table whose column list forgets tenant_id. This one
// guards the OTHER half of the same bug class: a
//
//     SELECT ... FROM <scoped table>     (incl. JOIN <scoped table>)
//     UPDATE <scoped table> ...
//     DELETE FROM <scoped table> ...
//
// whose WHERE clause forgets `tenant_id`. With MULTITENANT_ENFORCEMENT='on'
// every feature table is tenant-scoped, so an unscoped read returns (or an
// unscoped UPDATE/DELETE mutates) rows belonging to OTHER workspaces. Unlike a
// missing-tenant_id INSERT — which throws on the NOT NULL column and is at least
// loud — a missing-tenant_id read/update is SILENT: it just leaks or clobbers
// the wrong tenant's data. A static guard catches it before it ships.
//
// Like the write audit, this is a pure static scan of the source — no
// DATABASE_URL, runs anywhere. The tenant-scoped table set is derived from
// PLAIN_TABLES + REWRITE_UNIQUE in services/tenants/phase2_migrate.js, so adding
// a table to the migration automatically brings its reads under audit. All three
// source roots are walked (services/, scripts/, and the repo-root .js files such
// as server.js).
//
// ── How a statement is judged ───────────────────────────────────────────────
// A SQL statement (a single string/template literal) is an OFFENDER when it
// references a tenant-scoped table via FROM/JOIN/UPDATE/DELETE and:
//   1. the statement text itself contains no `tenant_id`, AND
//   2. its ENCLOSING FUNCTION never mentions any tenant context
//      (tenant_id / resolveTenantId / getCronTenantId / getDefaultTenantId /
//       *ForTenant / _tid).
//
// Rule (2) is what keeps the signal high. The dominant SAFE pattern in this
// codebase (documented in .agents/memory/tenant-scoping-reads.md) is a route
// handler that first resolves the tenant and verifies a parent row's ownership,
// then queries a child by the parent's id. The child query has no literal
// tenant_id but is provably scoped by the handler. Treating each such function
// as tenant-aware suppresses those false positives; a function that is wholly
// tenant-BLIND is the actual bug signal.
//
// ── Known limitation (intentional) ──────────────────────────────────────────
// Function-level context is deliberately lenient: if a function references the
// tenant anywhere, ALL its statements are trusted — so a single forgotten
// tenant_id on one query inside an otherwise tenant-aware function will NOT be
// flagged here. That residual gap is covered by the runtime per-feature
// isolation tests (test/*-isolation*.test.js). This guard's job is to catch the
// high-severity case: an authenticated handler that forgets tenancy entirely.
//
// ── Allowlist ───────────────────────────────────────────────────────────────
// Genuinely cross-tenant reads that have no request tenant to scope by go in
// ALLOWLIST with a documented reason: background crons/boot-resume that sweep
// all tenants, workers operating on a job whose parent was scoped at creation,
// public embed loaders, and provider webhooks that resolve their row by a
// globally-unique external id. The key is "relative/path.js :: <normalized
// statement>" so it pins ONE specific statement — it cannot mask a new unscoped
// statement elsewhere in the same file/table.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PLAIN_TABLES, REWRITE_UNIQUE } = require('../services/tenants/phase2_migrate');

const REPO_ROOT = path.join(__dirname, '..');
const SERVICES_DIR = path.join(REPO_ROOT, 'services');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

const SCOPED_TABLES = new Set([
  ...PLAIN_TABLES,
  ...REWRITE_UNIQUE.map(r => r.table),
]);

// ── Documented exceptions ───────────────────────────────────────────────────
// Each key is "relative/path.js :: <normalized statement>" (whitespace
// collapsed, ${...} interpolations flattened to ${}, capped at 160 chars). The
// value explains WHY this statement is legitimately cross-tenant. A stale entry
// (statement edited/removed, or now scoped) fails the "no stale entries" test
// below, so the list cannot rot into a blanket bypass.
const ALLOWLIST = new Map([
  // backlink_monitor — cron tick selects every monitor that is due, across all
  // tenants; each monitor row is then processed under its own tenant_id.
  ["services/backlink_monitor/api.js :: ` SELECT * FROM backlink_monitors WHERE (last_run_at IS NULL) OR (frequency='daily' AND last_run_at < now() - interval '23 hours') OR (frequency='weekly' AND la",
    "Background cron sweeps all due monitors across tenants; each is processed per-tenant downstream."],

  // bulk_reporting — background worker (_processRun) and boot-time resume claim
  // and process items by run_id; the run was tenant-scoped when the authenticated
  // /run route created it, so the items inherit that scope.
  ["services/bulk_reporting/api.js :: `SELECT id, settings FROM bulk_audit_runs WHERE status='running'`",
    "Boot-time resume of in-flight runs across all tenants; each run was tenant-scoped at creation."],
  ["services/bulk_reporting/api.js :: `UPDATE bulk_audit_items SET status='done', score=$2, grade=$3, passed=$4, warned=$5, failed=$6, report_json=$7, processed_at=now() WHERE id=$1`",
    "Worker updates a claimed item by its own id; the parent run was tenant-scoped at creation."],
  ["services/bulk_reporting/api.js :: `UPDATE bulk_audit_items SET status='failed', error=$2, processed_at=now() WHERE id=$1`",
    "Worker marks a claimed item failed by its own id; parent run scoped at creation."],
  ["services/bulk_reporting/api.js :: `UPDATE bulk_audit_items SET status='pending' WHERE status='processing' AND run_id IN (SELECT id FROM bulk_audit_runs WHERE status='running')`",
    "Boot resume re-queues orphaned in-flight items across tenants; bounded to running runs."],
  ["services/bulk_reporting/api.js :: `UPDATE bulk_audit_items SET status='processing', processed_at=now() WHERE id IN ( SELECT id FROM bulk_audit_items WHERE run_id=$1 AND status='pending' ORDER BY",
    "Worker claims the next pending items of a specific (scoped-at-creation) run by run_id."],
  ["services/bulk_reporting/api.js :: `UPDATE bulk_audit_runs SET completed = (SELECT COUNT(*) FROM bulk_audit_items WHERE run_id=$1 AND status='done'), failed = (SELECT COUNT(*) FROM bulk_audit_ite",
    "Worker recomputes progress counters for a specific run by run_id."],
  ["services/bulk_reporting/api.js :: `UPDATE bulk_audit_runs SET status='failed', finished_at=now() WHERE id=$1`",
    "Worker marks a specific run failed by its own id."],

  // conversion_boosters — public embed loader serves a widget's config by its
  // public id to anonymous external pages; there is no request tenant.
  ["services/conversion_boosters/api.js :: `SELECT id, type, settings FROM cb_widgets WHERE id=$1`",
    "Public embed script loader: anonymous external page fetches a widget by public id, no session tenant."],

  // crisis_radar — detector cron evaluates every enabled watch across tenants.
  ["services/crisis_radar/detector.js :: `SELECT * FROM crisis_watchlist WHERE enabled=true ORDER BY id ASC`",
    "Background detector cron evaluates all enabled watches across tenants."],

  // digest — cron picks the distinct brands needing a daily digest across tenants.
  ["services/digest/api.js :: 'SELECT DISTINCT brand FROM crisis_watchlist LIMIT 5'",
    "Digest cron enumerates brands needing a digest across all tenants."],

  // journey_builder — runner tick claims due runs (cross-tenant) and advances
  // each by run/journey id; runs are enrolled by tenant-scoped routes/signals.
  ["services/journey_builder/runner.js :: `SELECT id,nodes,edges FROM journeys WHERE id=$1`",
    "Runner loads the journey definition for a claimed run; run was tenant-scoped at enrolment."],
  ["services/journey_builder/runner.js :: `UPDATE journey_runs SET current_node=$1, next_run_at=$2, log=$3::jsonb WHERE id=$4`",
    "Runner advances a claimed run by its own id."],
  ["services/journey_builder/runner.js :: `UPDATE journey_runs SET status='completed', completed_at=now() WHERE id=$1`",
    "Runner completes a claimed run by its own id."],
  ["services/journey_builder/runner.js :: `UPDATE journey_runs SET status='completed', completed_at=now(), log=$1::jsonb WHERE id=$2`",
    "Runner completes a claimed run (with log) by its own id."],
  ["services/journey_builder/runner.js :: `UPDATE journey_runs SET status='failed', completed_at=now() WHERE id=$1`",
    "Runner fails a claimed run by its own id."],
  ["services/journey_builder/runner.js :: `UPDATE journeys SET stats = jsonb_set(stats,'{completed}', ((COALESCE(stats->>'completed','0')::int)+1)::text::jsonb) WHERE id=$1`",
    "Runner bumps a journey's completed counter for a claimed run's journey id."],
  ["services/journey_builder/runner.js :: `UPDATE journeys SET stats = jsonb_set(stats,'{failed}', ((COALESCE(stats->>'failed','0')::int)+1)::text::jsonb) WHERE id=$1`",
    "Runner bumps a journey's failed counter for a claimed run's journey id."],
  ["services/journey_builder/runner.js :: `WITH claimed AS ( SELECT id FROM journey_runs WHERE status='running' AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY next_run_at NULLS FIRST FOR UPD",
    "Runner tick claims all due runs across tenants (SKIP LOCKED); each advanced under its own scope."],

  // linksell — Stripe webhook flips an order to paid by the globally-unique
  // stripe_session_id; the webhook has no session tenant.
  ["services/linksell/api.js :: `UPDATE linksell_orders SET status='paid', paid_at=now() WHERE stripe_session_id=$1`",
    "Stripe webhook resolves the order by globally-unique stripe_session_id; no request tenant exists."],

  // optimizer — 6h/cron analysis helpers aggregate ad_performance_hourly for a
  // single campaign_id passed in by the per-tenant optimizer loop.
  ["services/optimizer/dayparting.js :: ` SELECT EXTRACT(HOUR FROM bucket_hour AT TIME ZONE 'UTC')::int AS hour, COALESCE(SUM(spend),0) AS spend, COALESCE(SUM(impressions),0) AS impressions, COALESCE(",
    "Optimizer cron helper aggregates hourly perf for one campaign_id supplied by the per-tenant loop."],
  ["services/optimizer/fatigue_forecast.js :: ` SELECT date_trunc('day', bucket_hour AT TIME ZONE 'UTC')::date AS d, COALESCE(SUM(impressions),0)::bigint AS impressions, COALESCE(SUM(clicks),0)::bigint AS c",
    "Optimizer cron helper aggregates daily perf for one campaign/creative supplied by the per-tenant loop."],
  ["services/optimizer/rules.js :: ` SELECT COALESCE(SUM(spend),0) AS spend, COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(conversions),0) AS conv, ",
    "Optimizer cron helper aggregates window perf for one campaign_id supplied by the per-tenant loop."],

  // search_intel — cron runs every enabled tracked query across tenants.
  ["services/search_intel/ai_visibility.js :: `SELECT * FROM search_intel_queries WHERE enabled=true ORDER BY id ASC LIMIT 100`",
    "Background cron runs all enabled AI-visibility queries across tenants."],

  // seo_crawler — background crawl worker marks its run failed by run id; the
  // run was tenant-scoped when the authenticated /run route created it.
  ["services/seo_crawler/api.js :: `UPDATE seo_crawl_runs SET status='failed', error=$2, completed_at=now() WHERE id=$1`",
    "Crawl worker marks its own run failed by run id; run was tenant-scoped at creation."],

  // seo_widget — public embed loader serves a site widget's config by id to
  // anonymous external pages; no request tenant.
  ["services/seo_widget/api.js :: `SELECT id, name, accent, cta_text FROM seo_widget_sites WHERE id=$1`",
    "Public embed script loader: anonymous external page fetches a widget by id, no session tenant."],
]);

// Tenant-context tokens that mark an enclosing function as tenant-aware.
const TENANT_CTX = /tenant_id|resolveTenantId|getCronTenantId|getDefaultTenantId|ForTenant|\b_tid\b/;
// SQL keywords that introduce a table reference inside a string literal.
const TABLE_REF = /\b(UPDATE|DELETE\s+FROM|FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi;
const CTRL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'do']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function collectFiles() {
  const files = [...walk(SERVICES_DIR), ...walk(SCRIPTS_DIR)];
  for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(REPO_ROOT, entry.name));
    }
  }
  return files;
}

// Mark every index that lies inside a string/comment, and collect the spans of
// every string literal (so we only look for SQL inside actual strings, and so
// braces/parens inside strings never confuse the function-boundary scan).
function classifySource(src) {
  const n = src.length;
  const inStr = new Uint8Array(n);
  const spans = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i); const e = nl === -1 ? n : nl;
      for (let k = i; k < e; k++) inStr[k] = 1; i = e; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const ee = src.indexOf('*/', i); const e = ee === -1 ? n : ee + 2;
      for (let k = i; k < e; k++) inStr[k] = 1; i = e; continue;
    }
    if (c === '`' || c === "'" || c === '"') {
      const q = c; const start = i; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 1; i += 2;
          while (i < n && d > 0) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
          continue;
        }
        if (src[i] === q) { i++; break; }
        if (q !== '`' && src[i] === '\n') break; // unterminated single/double
        i++;
      }
      for (let k = start; k < i && k < n; k++) inStr[k] = 1;
      spans.push([start, i]);
      continue;
    }
    i++;
  }
  return { inStr, spans };
}

function findSpan(spans, idx) {
  for (const s of spans) if (idx >= s[0] && idx < s[1]) return s;
  return null;
}

// Index of the previous non-whitespace CODE char before p (skips strings/comments).
function prevCodeIdx(src, inStr, p) {
  let i = p - 1;
  while (i >= 0) {
    if (inStr[i] || /\s/.test(src[i])) { i--; continue; }
    return i;
  }
  return -1;
}

// Given the index of a ')', return the index of its matching '(' (code-only).
function matchOpenParen(src, inStr, closeIdx) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (inStr[i]) continue;
    if (src[i] === ')') depth++;
    else if (src[i] === '(') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// The identifier word ending at/just before idx (code-only).
function wordBefore(src, inStr, idx) {
  let i = idx; let end = -1;
  while (i >= 0) { if (inStr[i] || /\s/.test(src[i])) { i--; continue; } end = i; break; }
  if (end < 0) return '';
  let s = end;
  while (s >= 0 && !inStr[s] && /[A-Za-z0-9_$]/.test(src[s])) s--;
  return src.slice(s + 1, end + 1);
}

// All function-body brace spans [open, closeExclusive]. A '{' opens a function
// body when it follows '=>' or a ')' whose matching '(' is NOT preceded by a
// control keyword (if/for/while/switch/catch/with/do). Object/block braces are
// ignored so the innermost ENCLOSING FUNCTION can be found precisely.
function functionSpans(src, inStr) {
  const stack = [];
  const fns = [];
  const n = src.length;
  for (let i = 0; i < n; i++) {
    if (inStr[i]) continue;
    const c = src[i];
    if (c === '{') {
      let isFunc = false;
      const pc = prevCodeIdx(src, inStr, i);
      if (pc >= 0) {
        if (src[pc] === '>' && pc - 1 >= 0 && src[pc - 1] === '=') isFunc = true;
        else if (src[pc] === ')') {
          const op = matchOpenParen(src, inStr, pc);
          if (op >= 0 && !CTRL_KEYWORDS.has(wordBefore(src, inStr, op - 1))) isFunc = true;
        }
      }
      stack.push({ pos: i, isFunc });
    } else if (c === '}') {
      const top = stack.pop();
      if (top && top.isFunc) fns.push([top.pos, i + 1]);
    }
  }
  return fns;
}

function enclosingFunction(fns, idx) {
  let best = null;
  for (const f of fns) if (idx >= f[0] && idx < f[1] && (!best || f[0] > best[0])) best = f;
  return best;
}

// Stable signature for a statement string: flatten ${...}, collapse whitespace,
// cap length so the allowlist stays readable while still pinning one statement.
function signature(stmt) {
  return stmt.replace(/\$\{[^}]*\}/g, '${}').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function scanFile(full) {
  const src = fs.readFileSync(full, 'utf8');
  const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
  const { inStr, spans } = classifySource(src);
  const fns = functionSpans(src, inStr);
  const offenders = [];
  const seenSpan = new Set();
  let m;
  TABLE_REF.lastIndex = 0;
  while ((m = TABLE_REF.exec(src))) {
    const table = m[2];
    if (!SCOPED_TABLES.has(table)) continue;
    if (inStr[m.index] === 0) continue;            // keyword must be inside a SQL string
    const span = findSpan(spans, m.index);
    if (!span) continue;
    const stmt = src.slice(span[0], span[1]);
    if (/\btenant_id\b/i.test(stmt)) continue;     // statement itself is scoped
    const fn = enclosingFunction(fns, span[0]);
    if (fn && TENANT_CTX.test(src.slice(fn[0], fn[1]))) continue; // tenant-aware function
    const key = `${rel} :: ${signature(stmt)}`;
    if (ALLOWLIST.has(key)) continue;              // documented cross-tenant read
    const dedupe = `${span[0]}`;
    if (seenSpan.has(dedupe)) continue;            // one report per statement
    seenSpan.add(dedupe);
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push({ rel, table, line, key });
  }
  return offenders;
}

test('every read/update/delete on a tenant-scoped table is tenant-scoped or allowlisted', () => {
  const offenders = collectFiles().flatMap(scanFile);
  assert.deepStrictEqual(
    offenders, [],
    `These statements touch a tenant-scoped table without a tenant_id filter, ` +
    `and their enclosing function never resolves a tenant — with ` +
    `MULTITENANT_ENFORCEMENT='on' they silently read or mutate OTHER workspaces' ` +
    `rows. Add a tenant_id filter (resolveTenantId(req, {label})), or, if the ` +
    `read is genuinely cross-tenant (cron / scoped-at-creation worker / public ` +
    `embed / provider webhook), add its key to ALLOWLIST in this test with a ` +
    `documented reason:\n  ` +
    offenders.map(o => `${o.rel}:${o.line} → ${o.table}\n     key: ${JSON.stringify(o.key)}`).join('\n  ')
  );
});

// Guard the guard: an empty scoped-table set means the migration lists were
// renamed/moved and the audit above would pass vacuously. Fail loudly instead.
test('the tenant-scoped table set is non-empty (migration lists resolved)', () => {
  assert.ok(
    SCOPED_TABLES.size > 0,
    'SCOPED_TABLES is empty — PLAIN_TABLES / REWRITE_UNIQUE could not be read ' +
    'from services/tenants/phase2_migrate.js. This audit would pass vacuously.'
  );
});

// Keep ALLOWLIST honest: every entry must still correspond to a real, currently
// tenant-blind, unscoped statement. A stale entry (statement edited/removed, now
// scoped, or table no longer scoped) would otherwise sit there ready to hide a
// future leak. Recompute the live offender keys WITHOUT the allowlist filter and
// require each allowlist key to match at least one of them.
test('no stale ALLOWLIST entries', () => {
  const liveKeys = new Set();
  for (const full of collectFiles()) {
    const src = fs.readFileSync(full, 'utf8');
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    const { inStr, spans } = classifySource(src);
    const fns = functionSpans(src, inStr);
    let m;
    TABLE_REF.lastIndex = 0;
    while ((m = TABLE_REF.exec(src))) {
      const table = m[2];
      if (!SCOPED_TABLES.has(table)) continue;
      if (inStr[m.index] === 0) continue;
      const span = findSpan(spans, m.index);
      if (!span) continue;
      const stmt = src.slice(span[0], span[1]);
      if (/\btenant_id\b/i.test(stmt)) continue;
      const fn = enclosingFunction(fns, span[0]);
      if (fn && TENANT_CTX.test(src.slice(fn[0], fn[1]))) continue;
      liveKeys.add(`${rel} :: ${signature(stmt)}`);
    }
  }
  const stale = [...ALLOWLIST.keys()].filter(k => !liveKeys.has(k));
  assert.deepStrictEqual(stale, [],
    `Stale ALLOWLIST entries in tenant-read-audit — the statement was edited, ` +
    `removed, or is now tenant-scoped. Remove these so a real leak cannot hide ` +
    `behind a dead exception:\n  ` + stale.map(s => JSON.stringify(s)).join('\n  '));
});
