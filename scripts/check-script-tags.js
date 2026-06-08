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
const acorn = require('acorn');

const repoRoot = path.join(__dirname, '..');
const PUBLIC_JS_DIR = path.join(repoRoot, 'public', 'js');
const INDEX_HTML = path.join(repoRoot, 'index.html');
const APP_JS = path.join(repoRoot, 'app.js');

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

// ── LOAD-ORDER CONSTRAINTS (auto-discovered by static scan) ───────────────
// Some extracted modules read another script's window.* export AT LOAD TIME
// (module top level or an IIFE body — NOT inside an event handler / view
// builder) and then reassign it, i.e. the monkeypatch/wrap pattern:
//
//     const _orig = window.buildSettings;            // capture at load time
//     window.buildSettings = function (...args) {     // reassign (wrap)
//       const r = _orig.apply(this, args); ...; return r;
//     };
//
// These wraps are defensive: if the predecessor that DEFINES buildSettings
// hasn't loaded yet, the captured value is undefined and the wrap SILENTLY does
// nothing — no console error, the feature just never wires up. A future reorder
// of the <script> tags in index.html would break the feature with zero signal.
//
// Rather than rely on a developer remembering to hand-register every such wrap,
// we DISCOVER them with a static AST scan of every public/js/ig_*.js module
// (`discoverLoadOrderConstraints`): for each load-time read-then-reassign of
// `window.<fn>` that the module does NOT itself define, we resolve which module
// (or app.js) DEFINES <fn> and pin that definer to load first. The result is
// asserted against the real index.html order in `npm run lint` + node --test.
//
// MANUAL_LOAD_ORDER_OVERRIDES is an escape hatch for the rare case the scanner
// cannot infer a constraint (e.g. a symbol defined somewhere the scan can't
// reach). It is merged with the discovered set; normally it stays empty.
const MANUAL_LOAD_ORDER_OVERRIDES = [];

// ── Static-scan helpers (acorn AST) ───────────────────────────────────────
// True for a non-computed `window.<id>` member expression.
function _isWindowMember(n) {
  return (
    n && n.type === 'MemberExpression' && !n.computed &&
    n.object && n.object.type === 'Identifier' && n.object.name === 'window' &&
    n.property && n.property.type === 'Identifier'
  );
}
function _isFunctionNode(n) {
  return (
    n &&
    (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration')
  );
}
// True if any identifier named in `names` appears anywhere in `node`'s subtree.
function _subtreeReferences(node, names) {
  let found = false;
  (function w(n) {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && names.has(n.name)) { found = true; return; }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range') continue;
      const c = n[k];
      if (Array.isArray(c)) { for (const x of c) if (x && typeof x.type === 'string') w(x); }
      else if (c && typeof c.type === 'string') w(c);
    }
  })(node);
  return found;
}

// Parse a module's source and classify each `window.<fn>` symbol it touches:
//   - wraps:   read `window.<fn>` at LOAD TIME and reassign it using that capture
//   - defines: assign `window.<fn>` without referencing a captured original
// "Load time" = module top level or the body of an immediately-invoked function
// expression (IIFE). We deliberately do NOT descend into ordinary function
// definitions (event handlers, view-builders, setTimeout/observer callbacks),
// because those run later — a read of `window.<fn>` there is not load-order
// sensitive. This is what lets intra-file wraps and unused sentinel reads be
// distinguished from genuine cross-file load-time wraps.
function analyzeModuleSource(code, fileName) {
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
  } catch (e) {
    throw new Error(`check-script-tags: failed to parse ${fileName} for load-order scan: ${e.message}`);
  }

  const captures = []; // { varName, symbol } — `const x = window.symbol` at load time
  const writes = [];   // { symbol, rhs, loadTime } — `window.symbol = rhs`

  (function walk(node, loadTime) {
    if (!node || typeof node.type !== 'string') return;

    if (node.type === 'VariableDeclarator' && node.init && _isWindowMember(node.init) && node.id.type === 'Identifier') {
      if (loadTime) captures.push({ varName: node.id.name, symbol: node.init.property.name });
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=' && _isWindowMember(node.left)) {
      writes.push({ symbol: node.left.property.name, rhs: node.right, loadTime });
    }

    // IIFE — `(function(){...})()` / `(()=>{...})()` — body + args run at load time.
    if (node.type === 'CallExpression' && _isFunctionNode(node.callee)) {
      walk(node.callee.body, loadTime);
      for (const a of node.arguments) walk(a, loadTime);
      return;
    }
    // Any other function literal/declaration: its body is deferred (not load time).
    if (_isFunctionNode(node)) { walk(node.body, false); return; }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range') continue;
      const c = node[k];
      if (Array.isArray(c)) { for (const x of c) if (x && typeof x.type === 'string') walk(x, loadTime); }
      else if (c && typeof c.type === 'string') walk(c, loadTime);
    }
  })(ast, true);

  const symbols = new Set([...captures.map((c) => c.symbol), ...writes.map((w) => w.symbol)]);
  const wraps = new Set();
  const defines = new Set();
  for (const s of symbols) {
    const capVars = new Set(captures.filter((c) => c.symbol === s).map((c) => c.varName));
    const writesOfS = writes.filter((w) => w.symbol === s);
    // A WRAP reassigns window.<s> at load time using the captured original.
    const hasWrap = capVars.size > 0 && writesOfS.some((w) => w.loadTime && _subtreeReferences(w.rhs, capVars));
    // A DEFINITION assigns window.<s> WITHOUT referencing the captured original.
    const hasDef = writesOfS.some((w) => !(capVars.size > 0 && _subtreeReferences(w.rhs, capVars)));
    if (hasWrap) wraps.add(s);
    if (hasDef) defines.add(s);
  }
  return { wraps, defines };
}

// Statically discover the load-order constraints implied by load-time wraps in
// the public/js/ig_*.js modules. Returns { constraints, unresolved, igFiles }.
// Memoized (the scan parses app.js, ~300ms) — pass { force:true } to refresh.
let _discoveryCache = null;
function discoverLoadOrderConstraints({ force = false } = {}) {
  if (_discoveryCache && !force) return _discoveryCache;

  const igFiles = fs
    .readdirSync(PUBLIC_JS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /^ig_.*\.js$/.test(e.name) && !NON_MODULE_FILES.has(e.name))
    .map((e) => e.name)
    .sort();

  const analyses = new Map(); // file -> { wraps, defines }
  const igDefiners = new Map(); // symbol -> [file, ...]
  for (const f of igFiles) {
    const a = analyzeModuleSource(fs.readFileSync(path.join(PUBLIC_JS_DIR, f), 'utf8'), f);
    analyses.set(f, a);
    for (const s of a.defines) {
      if (!igDefiners.has(s)) igDefiners.set(s, []);
      igDefiners.get(s).push(f);
    }
  }

  // A CROSS-FILE wrap: module F wraps window.<s> but does NOT itself define <s>.
  // (Intra-file wraps — define + wrap in the same file — are skipped here.)
  const crossWraps = [];
  for (const f of igFiles) {
    const a = analyses.get(f);
    for (const s of a.wraps) if (!a.defines.has(s)) crossWraps.push({ file: f, symbol: s });
  }

  // Only parse the (large) app.js monolith if a wrapped symbol isn't defined by
  // any ig_*.js module — app.js is the remaining place it could be defined.
  const needAppJs = crossWraps.some(({ symbol }) => !(igDefiners.get(symbol) || []).length);
  let appJsDefines = new Set();
  if (needAppJs && fs.existsSync(APP_JS)) {
    appJsDefines = analyzeModuleSource(fs.readFileSync(APP_JS, 'utf8'), 'app.js').defines;
  }

  const constraints = [];
  const unresolved = [];
  for (const { file, symbol } of crossWraps) {
    const igDefs = (igDefiners.get(symbol) || []).filter((g) => g !== file);
    let predecessors = [];
    if (igDefs.length) predecessors = igDefs;
    else if (appJsDefines.has(symbol)) predecessors = ['app.js'];

    if (!predecessors.length) {
      // No definer found anywhere we can scan (e.g. a native window.* API or a
      // symbol defined out of reach). There is no load-order constraint to
      // assert, so we record it for observability but do not fail.
      unresolved.push({ dependent: file, symbol });
      continue;
    }
    for (const predecessor of predecessors) {
      constraints.push({
        dependent: file,
        predecessor,
        symbol: `window.${symbol}`,
        source: 'discovered',
        reason:
          `${file} reads window.${symbol} at load time and reassigns it (monkeypatch/wrap), ` +
          `but does not define ${symbol} itself. ${predecessor} defines it and MUST load first, ` +
          `or the wrap silently no-ops.`,
      });
    }
  }

  _discoveryCache = { constraints, unresolved, igFiles };
  return _discoveryCache;
}

// The effective constraint set: auto-discovered wraps + any manual overrides
// (deduped by dependent|predecessor|symbol).
function getLoadOrderConstraints() {
  const discovered = discoverLoadOrderConstraints().constraints;
  const seen = new Set(discovered.map((c) => `${c.dependent}|${c.predecessor}|${c.symbol}`));
  const merged = discovered.slice();
  for (const c of MANUAL_LOAD_ORDER_OVERRIDES) {
    const key = `${c.dependent}|${c.predecessor}|${c.symbol}`;
    if (!seen.has(key)) { merged.push({ source: 'manual', ...c }); seen.add(key); }
  }
  return merged;
}

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

// Verifies every load-order constraint holds against index.html.
// Constraints default to the auto-discovered + manual-override set, but an
// explicit list may be passed (used by tests for negative controls).
// A violation is either:
//   - 'missing': the dependent or predecessor has no <script> tag at all, or
//   - 'out-of-order': the predecessor loads AFTER (or at the same index as) the
//     dependent.
function checkLoadOrder(html, constraints) {
  const order = scriptLoadOrder(html);
  const idx = (name) => order.indexOf(name);
  const list = constraints || getLoadOrderConstraints();
  const violations = [];
  for (const c of list) {
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
  return { order, violations, constraints: list };
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
  analyzeModuleSource,
  discoverLoadOrderConstraints,
  getLoadOrderConstraints,
  SCRIPT_SRC_RE,
  NON_MODULE_FILES,
  MANUAL_LOAD_ORDER_OVERRIDES,
};

if (require.main === module) {
  const { diskFiles, referenced, orphans, dangling, duplicates } = check();
  const constraints = getLoadOrderConstraints();
  const { unresolved } = discoverLoadOrderConstraints();
  const { violations: orderViolations } = checkLoadOrder();
  console.log(
    `[script-tag-lint] ${diskFiles.length} module(s) on disk, ${referenced.length} <script> tag(s) in index.html, ` +
      `${constraints.length} load-order constraint(s) (auto-discovered from load-time window.* wraps).`,
  );
  if (unresolved.length) {
    console.warn(
      `[script-tag-lint] note: ${unresolved.length} load-time window.* wrap(s) could not be resolved to a definer ` +
        `(no constraint asserted): ` +
        unresolved.map((u) => `${u.dependent}→window.${u.symbol}`).join(', '),
    );
  }

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
