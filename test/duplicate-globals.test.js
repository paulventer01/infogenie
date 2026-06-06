'use strict';
// test/duplicate-globals.test.js — Duplicate-global contract (Task 132).
//
// app.js is being split feature-by-feature into public/js/ig_*.js modules that
// all share one global scope. When a view-builder is copied into a module but
// the original is left behind in app.js (or two modules define the same
// top-level helper), the last <script> to load silently wins and a feature can
// quietly run stale code with NO build/lint failure. This test (and the matching
// scripts/check-duplicate-globals.js lint that runs in `npm run lint`) fails CI
// when a global *function* is defined in app.js AND a module, or in two modules,
// outside the documented allowlist.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');

const {
  check,
  extractGlobals,
  isIIFE,
  stripStrings,
  isIgnoredGlobal,
  ALLOWLIST,
} = require('../scripts/check-duplicate-globals.js');

test('no global function is defined in two files at once (outside the allowlist)', () => {
  const { collisions } = check();
  assert.deepEqual(
    collisions,
    [],
    'Duplicate global function(s) detected:\n' +
      collisions
        .map((c) => `  - ${c.name} (${c.kind}) in ${c.locations.join(', ')}`)
        .join('\n'),
  );
});

test('the check actually sees app.js and module globals (guards a no-op pass)', () => {
  const { appGlobals, moduleFiles, byName } = check();
  assert.ok(appGlobals.size > 0, 'expected at least one global function in app.js');
  assert.ok(moduleFiles.length > 0, 'expected at least one public/js module on disk');
  assert.ok(byName.size > 0, 'expected at least one module global to be discovered');
});

test('every allowlisted name is actually a current duplicate (no stale allowlist)', () => {
  // An allowlist entry that no longer corresponds to a real duplicate is dead
  // weight that masks a future re-introduction of the same name. Re-run the
  // detection WITHOUT the allowlist and assert every allowlisted name shows up.
  const { appGlobals, moduleFiles } = check();
  // Rebuild byName the same way check() does but keep everything.
  const fs = require('fs');
  const path = require('path');
  const PUBLIC_JS_DIR = path.join(__dirname, '..', 'public', 'js');
  const counts = new Map(); // name -> {inApp, moduleCount}
  for (const file of moduleFiles) {
    const src = fs.readFileSync(path.join(PUBLIC_JS_DIR, file), 'utf8');
    const globals = extractGlobals(src, { treatTopLevelAsGlobal: !isIIFE(src) });
    for (const name of globals) {
      const cur = counts.get(name) || { inApp: appGlobals.has(name), moduleCount: 0 };
      cur.moduleCount++;
      counts.set(name, cur);
    }
  }
  for (const name of ALLOWLIST.keys()) {
    const c = counts.get(name);
    const isDup = !!c && (c.inApp || c.moduleCount > 1);
    assert.ok(
      isDup,
      `ALLOWLIST entry "${name}" is no longer a real duplicate — remove it from scripts/check-duplicate-globals.js`,
    );
  }
});

// ── Unit coverage for the detection primitives (negative controls) ─────────

test('extractGlobals: non-IIFE file leaks top-level functions and window fn exports', () => {
  const src = "'use strict';\nfunction buildFoo(){}\nwindow.buildBar = function(){};\nwindow.state = [];\n";
  const g = extractGlobals(src, { treatTopLevelAsGlobal: true });
  assert.ok(g.has('buildFoo'), 'top-level function should leak in a non-IIFE file');
  assert.ok(g.has('buildBar'), 'window.X = function should be an export');
  assert.ok(!g.has('state'), 'window.X = <non-function value> is shared state, not code');
});

test('extractGlobals: IIFE file scopes top-level functions, keeps window exports', () => {
  const src = "'use strict';\n(function(){\nfunction _helper(){}\nwindow.buildFoo = function(){};\n})();\n";
  const g = extractGlobals(src, { treatTopLevelAsGlobal: false });
  assert.ok(!g.has('_helper'), 'IIFE-scoped function must NOT count as a global');
  assert.ok(g.has('buildFoo'), 'window.X export still counts inside an IIFE');
});

test('isIIFE: recognizes IIFE wrappers past directives/comments, rejects open files', () => {
  assert.equal(isIIFE("'use strict';\n/* c */\n(function(){})();"), true);
  assert.equal(isIIFE('(() => {})();'), true);
  assert.equal(isIIFE("'use strict';\nfunction buildFoo(){}\n"), false);
  assert.equal(isIIFE('window.buildFoo = function(){};'), false);
});

test('stripStrings: window.X inside a string literal is not counted as a definition', () => {
  const src = 'const html = "<script>window.onload=()=>print()</scr"+"ipt>";\nwindow.buildReal = function(){};\n';
  const g = extractGlobals(src, { treatTopLevelAsGlobal: true });
  assert.ok(!g.has('onload'), 'window.onload inside a string must be ignored');
  assert.ok(g.has('buildReal'), 'a real window export outside strings is still seen');
});

test('isIgnoredGlobal: window.onX DOM handlers are ignored, builders are not', () => {
  assert.equal(isIgnoredGlobal('onload'), true);
  assert.equal(isIgnoredGlobal('onresize'), true);
  assert.equal(isIgnoredGlobal('buildSettings'), false);
  assert.equal(isIgnoredGlobal('_csEsc'), false);
});
