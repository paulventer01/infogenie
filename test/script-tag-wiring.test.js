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

const { check } = require('../scripts/check-script-tags.js');

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
