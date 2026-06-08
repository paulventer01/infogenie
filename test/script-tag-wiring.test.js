'use strict';
// test/script-tag-wiring.test.js — Extracted-module wiring contract (Task 130).
//
// app.js is being split file-by-file into public/js/ig_*.js modules, each wired
// into index.html as a plain <script src="/public/js/...">. A file that exists
// on disk but was never added to index.html (orphan), or a <script> tag that
// points at a renamed/removed file (dangling), silently breaks a whole feature
// view at runtime with NO build/lint failure. This test (and the matching
// scripts/check-script-tags.js lint that runs in `npm run lint`) asserts a 1:1
// mapping so the break surfaces in CI instead of in the browser.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');

const {
  check,
  checkLoadOrder,
  scriptLoadOrder,
  discoverLoadOrderConstraints,
  getLoadOrderConstraints,
  analyzeModuleSource,
} = require('../scripts/check-script-tags.js');

test('every public/js module is wired into index.html (no orphans on disk)', () => {
  const { orphans } = check();
  assert.deepEqual(
    orphans,
    [],
    `These public/js modules exist on disk but have no <script> tag in index.html: ${orphans.join(', ')}`,
  );
});

test('every <script> tag resolves to a real file (no dangling references)', () => {
  const { dangling } = check();
  assert.deepEqual(
    dangling,
    [],
    `index.html references /public/js files that do not exist: ${dangling.join(', ')}`,
  );
});

test('no public/js module is wired more than once (no duplicate tags)', () => {
  const { duplicates } = check();
  assert.deepEqual(
    duplicates,
    [],
    `These public/js modules are wired more than once in index.html: ${duplicates.join(', ')}`,
  );
});

test('the check actually sees modules and tags (guards against a no-op pass)', () => {
  const { diskFiles, referenced } = check();
  assert.ok(diskFiles.length > 0, 'expected at least one public/js module on disk');
  assert.ok(referenced.length > 0, 'expected at least one /public/js <script> tag in index.html');
});

// ── Load-order constraints (Task 131) ─────────────────────────────────────
// A module that reads/wraps another script's window.* export at load time must
// load AFTER its predecessor in index.html, or the wrap silently no-ops.

test('every declared load-order constraint holds in index.html', () => {
  const { violations } = checkLoadOrder();
  assert.deepEqual(
    violations,
    [],
    'Load-order violation(s):\n' +
      violations.map((v) => `  - ${v.detail} (${v.dependent} reads ${v.symbol})`).join('\n'),
  );
});

test('the load-order check actually sees the real script order (no no-op pass)', () => {
  const order = scriptLoadOrder();
  assert.ok(order.includes('app.js'), 'expected app.js in the index.html script order');
  assert.ok(order.includes('ig_settings.js'), 'expected ig_settings.js in the index.html script order');
  assert.ok(getLoadOrderConstraints().length > 0, 'expected at least one load-order constraint to be discovered');
});

// ── Auto-discovery of load-time wraps (Task 133) ──────────────────────────
// The constraints are no longer hand-maintained: a static AST scan discovers
// every public/js/ig_*.js module that reads + reassigns a sibling's window.*
// export at load time, and resolves which module/app.js defines that symbol.

test('the scanner discovers the cross-file load-time wraps and resolves their definers', () => {
  const { constraints } = discoverLoadOrderConstraints({ force: true });
  const find = (dependent, symbol) =>
    constraints.find((c) => c.dependent === dependent && c.symbol === symbol);

  const wp = find('ig_content_pro.js', 'window.buildSettings');
  assert.ok(wp, 'expected ig_content_pro.js → window.buildSettings to be discovered');
  assert.equal(wp.predecessor, 'ig_settings.js', 'buildSettings is defined in ig_settings.js');

  const cc = find('ig_creative_suite.js', 'window._ccGo');
  assert.ok(cc, 'expected ig_creative_suite.js → window._ccGo to be discovered');
  assert.equal(cc.predecessor, 'app.js', '_ccGo is defined in app.js');

  for (const c of constraints) {
    assert.equal(c.source, 'discovered', `constraint for ${c.dependent} should be auto-discovered`);
  }
});

test('intra-file wraps and unused sentinel reads do NOT produce constraints', () => {
  const { constraints } = discoverLoadOrderConstraints({ force: true });
  const dependents = new Set(constraints.map((c) => `${c.dependent}|${c.symbol}`));
  // Define-and-wrap in the same file — the predecessor is itself, not a sibling.
  assert.ok(
    !dependents.has('ig_intel_pack_a.js|window.buildRedditPulse'),
    'intra-file wrap of buildRedditPulse must be ignored',
  );
  assert.ok(
    !dependents.has('ig_mentions_gaps.js|window.renderOptimizerDashboard'),
    'intra-file wrap of renderOptimizerDashboard must be ignored',
  );
  // A load-time read that is never reassigned is a sentinel, not a wrap.
  assert.ok(
    !dependents.has('ig_attribution_scorer.js|window.buildAmplitudeAgents'),
    'unused sentinel read of buildAmplitudeAgents must not be a false positive',
  );
});

test('analyzeModuleSource classifies wrap vs. define vs. sentinel vs. handler', () => {
  // Cross-file wrap: read + reassign, no own definition.
  const wrap = analyzeModuleSource(
    `(function(){ const _o = window.foo; window.foo = function(){ return _o(); }; })();`,
    'wrap.js',
  );
  assert.ok(wrap.wraps.has('foo') && !wrap.defines.has('foo'), 'wrap with no own def → cross-file wrap');

  // Intra-file: define then wrap in the same file → counts as a definition.
  const intra = analyzeModuleSource(
    `window.bar = function(){ return 1; };\n(function(){ const _o = window.bar; window.bar = function(){ return _o(); }; })();`,
    'intra.js',
  );
  assert.ok(intra.wraps.has('bar') && intra.defines.has('bar'), 'define+wrap in one file → also defines');

  // Sentinel: read but never reassigned → not a wrap.
  const sentinel = analyzeModuleSource(`(function(){ const _s = window.baz; })();`, 'sentinel.js');
  assert.ok(!sentinel.wraps.has('baz'), 'sentinel read is not a wrap');

  // Inside a handler/builder (deferred), not load time → ignored.
  const handler = analyzeModuleSource(
    `document.addEventListener('click', function(){ const _o = window.qux; window.qux = function(){ return _o(); }; });`,
    'handler.js',
  );
  assert.ok(!handler.wraps.has('qux'), 'a reassign inside an event handler is not a load-time wrap');
});

test('an out-of-order index.html is detected (negative control)', () => {
  // Synthesize HTML where ig_content_pro.js loads BEFORE ig_settings.js.
  const html = [
    '<script src="/app.js"></script>',
    '<script src="/public/js/ig_creative_suite.js"></script>',
    '<script src="/public/js/ig_content_pro.js?v=1"></script>',
    '<script src="/public/js/ig_settings.js?v=1"></script>',
  ].join('\n');
  const { violations } = checkLoadOrder(html);
  assert.ok(
    violations.some((v) => v.dependent === 'ig_content_pro.js' && v.kind === 'out-of-order'),
    'expected an out-of-order violation for ig_content_pro.js loading before ig_settings.js',
  );
});

test('a missing predecessor is detected (negative control)', () => {
  // ig_content_pro.js is wired but ig_settings.js is absent entirely.
  const html = [
    '<script src="/app.js"></script>',
    '<script src="/public/js/ig_creative_suite.js"></script>',
    '<script src="/public/js/ig_content_pro.js?v=1"></script>',
  ].join('\n');
  const { violations } = checkLoadOrder(html);
  assert.ok(
    violations.some((v) => v.dependent === 'ig_content_pro.js' && v.kind === 'missing'),
    'expected a missing-predecessor violation when ig_settings.js is absent',
  );
});
