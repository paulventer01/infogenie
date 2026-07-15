'use strict';
// test/legacy-dispatch-guard.test.js — Guard against dead legacy dispatch blocks
// and unreferenced app.js globals accumulating silently.
//
// Background: the legacy-code-removal sweep (2026) deleted ~12k lines of dead
// code from app.js: navigateTo() dispatch blocks pointing at `#view-*` divs that
// had already been stripped from index.html when their panels were ported to
// React, plus top-level globals that nothing called. Nothing failed when this
// drift existed — this suite makes the next occurrence detectable immediately.
//
// Two guards:
//
//  1. DISPATCH-DIV PAIRING: every `viewId === 'X'` entry inside the navigateTo()
//     dispatch region of app.js must have a matching `id="view-X"` div in
//     index.html. If a React migration strips a div and forgets to remove the
//     dispatch block, this guard catches it.
//
//  2. DEAD-GLOBAL SCAN: every `window.NAME = [async ]function` definition in
//     app.js must be referenced (as the bare name \bNAME\b) somewhere in at
//     least one of the reference roots: app.js itself, index.html, or any
//     public/js module. Globals with zero references outside their own
//     definition line are dead code.
//
// Run: node --test (or: npm run test:core — this file is in that gate).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip single-line and block comments from JS source (conservative). */
function stripComments(src) {
  // Replace block comments with spaces (preserve line count for error messages).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

/** Strip string/template literals from JS source (conservative).
 *  Replaces the CONTENT of strings with spaces so that code patterns inside
 *  string literals (e.g. onclick="buildFoo()") don't count as references.
 *  We intentionally leave the surrounding quotes so that quote-counting stays
 *  balanced and subsequent passes don't mis-classify code. */
function stripStringContents(src) {
  // Template literals (no nesting support — sufficient for our static scan)
  src = src.replace(/`[^`]*`/g, (m) => '`' + ' '.repeat(m.length - 2) + '`');
  // Double-quoted strings
  src = src.replace(/"(?:[^"\\]|\\.)*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"');
  // Single-quoted strings
  src = src.replace(/'(?:[^'\\]|\\.)*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");
  return src;
}

// ── 1. Dispatch-div pairing ───────────────────────────────────────────────────
//
// Parse the navigateTo() dispatch region from app.js and assert every dispatched
// view id has a matching `id="view-<id>"` in index.html.
//
// The dispatch region runs from `function navigateTo(` to the sentinel comment
// `// Show/hide navbar for home vs app` that immediately follows the last
// dispatch block. This boundary is also used by migrated-builders-coverage.test.js
// so it is load-bearing — do not move the sentinel comment.

test('every viewId dispatch entry in navigateTo() has a matching #view-<id> in index.html', () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // Locate the dispatch region.
  const navStart = appSrc.indexOf('function navigateTo(');
  const navEnd = appSrc.indexOf('// Show/hide navbar for home vs app', navStart);
  assert.ok(
    navStart !== -1 && navEnd !== -1,
    'Could not locate the navigateTo() dispatch region in app.js. ' +
      'The sentinel comment "// Show/hide navbar for home vs app" must remain ' +
      'immediately after the last dispatch block.',
  );

  const dispatchRegion = appSrc.slice(navStart, navEnd);

  // Extract every `viewId === 'X'` literal in the dispatch region.
  const viewIdRe = /viewId\s*===\s*'([^']+)'/g;
  const dispatched = [];
  let m;
  while ((m = viewIdRe.exec(dispatchRegion))) {
    dispatched.push(m[1]);
  }

  // Deduplicate (a viewId could appear in a chained condition like `=== 'x' || viewId === 'x'`).
  const unique = [...new Set(dispatched)];

  // Build the set of view div ids present in index.html.
  const viewDivRe = /\bid="view-([^"]+)"/g;
  const indexViewIds = new Set();
  while ((m = viewDivRe.exec(indexHtml))) indexViewIds.add(m[1]);

  // Assert each dispatched view id has a live div.
  const orphaned = unique.filter((id) => !indexViewIds.has(id));

  assert.deepEqual(
    orphaned,
    [],
    'The following viewId dispatch entries in navigateTo() have no matching ' +
      '#view-<id> div in index.html — they are dead dispatch blocks:\n' +
      orphaned
        .map(
          (id) =>
            `  - viewId === '${id}':  remove the "if (viewId === '${id}') { … }" block ` +
            'from the navigateTo() dispatch in app.js, or re-add the ' +
            `<div id="view-${id}"> panel to index.html.`,
        )
        .join('\n'),
  );
});

test('navigateTo() dispatch region is locatable and contains the known sentinel comment', () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.ok(
    appSrc.includes('function navigateTo('),
    'app.js must contain `function navigateTo(` — do not rename or remove it.',
  );
  const navStart = appSrc.indexOf('function navigateTo(');
  assert.ok(
    appSrc.indexOf('// Show/hide navbar for home vs app', navStart) !== -1,
    'The sentinel comment "// Show/hide navbar for home vs app" must remain ' +
      'immediately after the last dispatch block in navigateTo() in app.js — ' +
      'the dispatch-div pairing guard uses this boundary to delimit the dispatch region.',
  );
});

// ── 2. Dead-global scan ───────────────────────────────────────────────────────
//
// Find every `window.NAME = [async ]function` callable global defined in app.js
// and verify it is referenced at least once in the reference roots:
//   • app.js itself (raw text — catches onclick="NAME()" template strings)
//   • index.html (inline event handlers)
//   • public/js/*.js (legacy feature modules)
//   • app/**/*.{ts,tsx} and components/**/*.{ts,tsx} (React sources — catches
//     window.NAME access patterns from ported panels that still bridge into the
//     legacy runtime)
//
// Strategy:
//   a. Strip comments + string contents from app.js before scanning for
//      definitions so that names mentioned only inside template literals (e.g.
//      error messages) are not counted as live code definitions. The definition
//      pattern itself lies outside strings.
//   b. For reference counting, scan the RAW (un-stripped) text of every root
//      file for \bNAME\b — if a name appears in an onclick="" attribute, a
//      string template, or prose comment that counts as a reference too (the
//      intent is to flag globals that are truly invisible everywhere, not to do
//      precise liveness analysis).
//   c. Count total occurrences across all roots, then subtract the occurrences
//      that come from the definition line itself (window.NAME = ...) — any
//      remainder > 0 means the global is referenced.
//
// Allowlist: globals exported by app.js but intentionally consumed only via
// dynamic window[] access or generated code that static text search cannot see.
// Keep this list minimal; add entries only with a comment explaining why.

const DEAD_GLOBAL_ALLOWLIST = new Set([
  // None currently. Add entries here if the scan flags a false positive, with a
  // short comment explaining where the dynamic reference lives.
]);

/** Recursively collect file paths under dir that match the extension filter. */
function collectFiles(dir, exts) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

test('every window.NAME=function global in app.js is referenced from at least one root', () => {
  const appRaw = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const appStripped = stripStringContents(stripComments(appRaw));

  // Collect definition names: `window.NAME = [async ]function`
  const defRe = /window\.(\w+)\s*=\s*(?:async\s+)?function\b/g;
  const defined = new Map(); // name → definition occurrence count in stripped src
  let m;
  while ((m = defRe.exec(appStripped))) {
    defined.set(m[1], (defined.get(m[1]) || 0) + 1);
  }

  // Build reference roots:
  //   1. app.js (raw — includes onclick="NAME()" template strings)
  //   2. index.html (inline event handlers)
  //   3. public/js/*.js (legacy feature modules)
  //   4. React sources: app/**/*.{ts,tsx} + components/**/*.{ts,tsx}
  //      (window.NAME bridge calls from ported panels)
  const rootSources = [appRaw];
  rootSources.push(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));

  const pubJsDir = path.join(ROOT, 'public', 'js');
  for (const f of fs.readdirSync(pubJsDir)) {
    if (f.endsWith('.js')) {
      rootSources.push(fs.readFileSync(path.join(pubJsDir, f), 'utf8'));
    }
  }

  // React sources — window.NAME patterns used by ported panels bridging into
  // the legacy runtime (e.g. window.buildFoo && window.buildFoo()).
  const reactExts = ['.ts', '.tsx'];
  const reactDirs = [path.join(ROOT, 'app'), path.join(ROOT, 'components')];
  for (const dir of reactDirs) {
    for (const file of collectFiles(dir, reactExts)) {
      rootSources.push(fs.readFileSync(file, 'utf8'));
    }
  }

  const combinedRoots = rootSources.join('\n');

  // For each defined global, count total occurrences of \bNAME\b in all roots.
  // A global is "live" if its occurrence count exceeds the definition count —
  // i.e. it appears somewhere OTHER than just `window.NAME = function`.
  const dead = [];
  for (const [name, defCount] of defined) {
    if (DEAD_GLOBAL_ALLOWLIST.has(name)) continue;

    const wordRe = new RegExp('\\b' + name + '\\b', 'g');
    const totalOccurrences = (combinedRoots.match(wordRe) || []).length;

    // Each definition `window.NAME = function` contributes 1 occurrence of NAME
    // in app.js (the combined roots include appRaw). If the total is exactly
    // defCount, the name only appears at its definition(s) — zero references.
    if (totalOccurrences <= defCount) {
      dead.push(name);
    }
  }

  dead.sort();

  assert.deepEqual(
    dead,
    [],
    'The following window.NAME=function globals in app.js have zero references ' +
      'in app.js, index.html, or public/js/* — they are dead code:\n' +
      dead
        .map(
          (n) =>
            `  - window.${n}: remove the definition from app.js, or add it to ` +
            'DEAD_GLOBAL_ALLOWLIST in test/legacy-dispatch-guard.test.js ' +
            'with a comment explaining where the dynamic reference lives.',
        )
        .join('\n'),
  );
});

test('dead-global scan actually inspects app.js (sanity: at least one window.NAME=function found)', () => {
  const appRaw = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const appStripped = stripStringContents(stripComments(appRaw));
  const defRe = /window\.(\w+)\s*=\s*(?:async\s+)?function\b/g;
  const names = [];
  let m;
  while ((m = defRe.exec(appStripped))) names.push(m[1]);
  assert.ok(
    names.length >= 10,
    `Expected at least 10 window.NAME=function globals in app.js, found ${names.length}. ` +
      'If app.js no longer uses this pattern the dead-global scan should be updated.',
  );
});
