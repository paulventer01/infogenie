#!/usr/bin/env node
// scripts/check-script-tags.js — Extracted-module wiring lint (Task 130)
//
// The codebase is being split file-by-file out of app.js into
// public/js/ig_*.js modules, each wired into index.html as a plain
// <script src="/public/js/...">. Nothing else catches the two ways this
// silently breaks a whole feature view at runtime with no build/lint failure:
//
//   1. ORPHAN ON DISK — a new public/js/ig_*.js file exists but was never
//      added to index.html, so its view-builder never loads.
//   2. DANGLING TAG — index.html points a <script> at /public/js/<file>
//      that doesn't exist on disk (renamed/removed file), so the browser
//      404s and the feature is dead.
//
// This lint asserts a 1:1 mapping between ig_*.js files on disk and the
// /public/js/ <script> tags in index.html. Any mismatch fails CI.
//
// Run: node scripts/check-script-tags.js   (or: npm run lint)

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const PUBLIC_JS_DIR = path.join(repoRoot, 'public', 'js');
const INDEX_HTML = path.join(repoRoot, 'index.html');

// Matches the src of any <script> tag that points into /public/js/, capturing
// the bare filename and ignoring any cache-busting ?v=... query string.
const SCRIPT_SRC_RE = /<script[^>]*\bsrc=["']\/public\/js\/([^"'?]+)(?:\?[^"']*)?["'][^>]*>/gi;

// Matches ANY local <script src="...js"> tag (not just /public/js/), capturing
// the full path so we can compute the exact load order including app.js itself.
// External (http/https) and inline scripts are ignored.
const ANY_LOCAL_SCRIPT_SRC_RE = /<script[^>]*\bsrc=["'](\/[^"']+?\.js)(?:\?[^"']*)?["'][^>]*>/gi;

// Files in public/js/ that are NOT runtime modules and so are not expected to
// have a <script> tag (docs, etc.).
const NON_MODULE_FILES = new Set(['README.md']);

// ── LOAD-ORDER CONSTRAINTS ────────────────────────────────────────────────
// Some extracted modules read another script's window.* export AT LOAD TIME
// (top-level, not inside an event handler / builder) to monkeypatch or wrap it.
// These wraps are defensive: if the predecessor hasn't loaded yet the captured
// value is undefined and the wrap SILENTLY does nothing — no console error, the
// feature just never wires up. A future reorder of the <script> tags in
// index.html would break the feature with zero signal. Each entry below pins a
// `dependent` module to load strictly AFTER its `predecessor`, and this is
// asserted against the real index.html order in `npm run lint` + node --test.
//
// `predecessor` may be a /public/js/ module OR `app.js` (the monolith), since
// some wraps target functions still defined in app.js.
const LOAD_ORDER_CONSTRAINTS = [
  {
    dependent: 'ig_content_pro.js',
    predecessor: 'ig_settings.js',
    symbol: 'window.buildSettings',
    reason:
      'ig_content_pro.js wraps window.buildSettings at load time to inject the ' +
      'WordPress settings card; ig_settings.js must define buildSettings first.',
  },
  {
    dependent: 'ig_creative_suite.js',
    predecessor: 'app.js',
    symbol: 'window._ccGo',
    reason:
      'ig_creative_suite.js wraps window._ccGo at load time to pass the selected ' +
      'language; app.js must define _ccGo first.',
  },
];

// Returns the ordered list of local script basenames as they appear in
// index.html (e.g. ['data.js', 'app.js', 'ig_settings.js', ...]).
function scriptLoadOrder(html) {
  html = html == null ? fs.readFileSync(INDEX_HTML, 'utf8') : html;
  const order = [];
  const re = new RegExp(ANY_LOCAL_SCRIPT_SRC_RE.source, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) order.push(path.basename(m[1]));
  return order;
}

// Verifies every LOAD_ORDER_CONSTRAINTS entry holds against index.html.
// A violation is either:
//   - 'missing': the dependent or predecessor has no <script> tag at all, or
//   - 'out-of-order': the predecessor loads AFTER (or at the same index as) the
//     dependent.
function checkLoadOrder(html) {
  const order = scriptLoadOrder(html);
  const idx = (name) => order.indexOf(name);
  const violations = [];
  for (const c of LOAD_ORDER_CONSTRAINTS) {
    const di = idx(c.dependent);
    const pi = idx(c.predecessor);
    if (di === -1) {
      violations.push({ ...c, kind: 'missing', detail: `${c.dependent} is not wired into index.html` });
      continue;
    }
    if (pi === -1) {
      violations.push({ ...c, kind: 'missing', detail: `${c.predecessor} is not wired into index.html` });
      continue;
    }
    if (pi >= di) {
      violations.push({
        ...c,
        kind: 'out-of-order',
        detail: `${c.predecessor} (position ${pi}) must load BEFORE ${c.dependent} (position ${di})`,
      });
    }
  }
  return { order, violations, constraints: LOAD_ORDER_CONSTRAINTS };
}

function check() {
  // 1. Every ig_*.js (and any other .js) module that lives on disk.
  const diskFiles = fs
    .readdirSync(PUBLIC_JS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js') && !NON_MODULE_FILES.has(e.name))
    .map((e) => e.name);

  // 2. Every /public/js/ file referenced by a <script> tag in index.html.
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const referenced = [];
  let m;
  while ((m = SCRIPT_SRC_RE.exec(html)) !== null) referenced.push(m[1]);

  const diskSet = new Set(diskFiles);
  const refSet = new Set(referenced);

  // ORPHAN: on disk but never wired into index.html.
  const orphans = diskFiles.filter((f) => !refSet.has(f)).sort();

  // DANGLING: referenced by a <script> tag but missing on disk.
  const dangling = [...refSet].filter((f) => !diskSet.has(f)).sort();

  // DUPLICATE: same file wired more than once (load-order / double-eval hazard).
  const seen = new Map();
  for (const f of referenced) seen.set(f, (seen.get(f) || 0) + 1);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([f]) => f).sort();

  return { diskFiles, referenced, orphans, dangling, duplicates };
}

module.exports = {
  check,
  checkLoadOrder,
  scriptLoadOrder,
  SCRIPT_SRC_RE,
  NON_MODULE_FILES,
  LOAD_ORDER_CONSTRAINTS,
};

if (require.main === module) {
  const { diskFiles, referenced, orphans, dangling, duplicates } = check();
  const { violations: orderViolations } = checkLoadOrder();
  console.log(
    `[script-tag-lint] ${diskFiles.length} module(s) on disk, ${referenced.length} <script> tag(s) in index.html, ${LOAD_ORDER_CONSTRAINTS.length} load-order constraint(s).`,
  );

  const problems = [];
  if (orphans.length) {
    problems.push(
      `${orphans.length} ORPHAN file(s) on disk with no <script> tag in index.html:\n` +
        orphans.map((f) => `      ✗ public/js/${f} — add a <script src="/public/js/${f}"> tag`).join('\n'),
    );
  }
  if (dangling.length) {
    problems.push(
      `${dangling.length} DANGLING <script> tag(s) pointing at a missing file:\n` +
        dangling.map((f) => `      ✗ /public/js/${f} — referenced in index.html but not on disk`).join('\n'),
    );
  }
  if (duplicates.length) {
    problems.push(
      `${duplicates.length} DUPLICATE <script> tag(s) (same file wired more than once):\n` +
        duplicates.map((f) => `      ✗ /public/js/${f}`).join('\n'),
    );
  }
  if (orderViolations.length) {
    problems.push(
      `${orderViolations.length} LOAD-ORDER violation(s) (a module that wraps another's window.* at load time loads too early):\n` +
        orderViolations
          .map(
            (v) =>
              `      ✗ ${v.detail}\n` +
              `        ↳ ${v.dependent} reads ${v.symbol} at load time. ${v.reason}`,
          )
          .join('\n'),
    );
  }

  if (problems.length) {
    console.error('\n[script-tag-lint] FAILED — extracted module wiring is out of sync:');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('[script-tag-lint] OK — every public/js module is wired into index.html exactly once and every tag resolves.');
}
