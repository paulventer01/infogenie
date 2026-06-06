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

const { check, checkLoadOrder, scriptLoadOrder, LOAD_ORDER_CONSTRAINTS } = require('../scripts/check-script-tags.js');

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
  assert.ok(LOAD_ORDER_CONSTRAINTS.length > 0, 'expected at least one declared load-order constraint');
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
