'use strict';
// test/migrated-builders-coverage.test.js — whole-fleet version of the
// "Analyse Now" crash guard in migrated-builders-safety.test.js.
//
// That sibling suite proves the FOUR highest-risk migrated builders (dashboard,
// competitors, audience, creative) early-return instead of crashing when the
// Next.js front door strips their `#view-<id>` panel out of the replayed legacy
// shell. But lib/migratedViews.ts lists ~180 migrated views, each backed by a
// legacy view-builder in public/js/*.js or inline in app.js. ANY of them can
// reintroduce the same page-blanking crash if a future edit drops its
// root-element early-return guard — and nothing tested the other ~175.
//
// This suite closes that gap. It:
//   1. reads every migrated view id from lib/migratedViews.ts,
//   2. resolves each id to its builder function by parsing the navigateTo()
//      dispatch in app.js (the same dispatch the running app uses),
//   3. loads the REAL builder source (whole-file jsdom eval for public/js, plus
//      single-function extraction for inline app.js builders), and
//   4. calls each builder against an empty (DOM-stripped) jsdom and asserts it
//      does NOT throw / reject — i.e. its early-return guard is intact.
//
// A throw here means a migrated panel would blank the dashboard the moment its
// root element is missing. Builders are loaded from the shipped source so the
// test tracks the real code (no copy/paste drift), mirroring the approach in
// migrated-builders-safety.test.js.
//
// Run: node --test (or: npm run test:core — this file is in that gate).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// Legacy modules schedule fire-and-forget async work (status polls, /api fetches)
// the moment a builder runs. With a stubbed never-resolving fetch those stay
// pending, but an async builder that crashes BEFORE its guard would surface as a
// rejected promise. We assert on that rejection explicitly per-builder (await
// below); this top-level handler only swallows the stray fire-and-forget noise
// from builders that legitimately ran to completion, keeping the run
// deterministic.
process.on('unhandledRejection', () => {});

// ── Brace-match a `[async] function NAME(...) {…}` or `window.NAME = [async]
// function (...) {…}` out of a large source file. The migrated builders contain
// only balanced braces (template-literal `${…}` included), so a depth counter
// recovers the whole body. ─────────────────────────────────────────────────
function braceEnd(src, open) {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function extractBuilder(src, name) {
  // form A: [async] function NAME(
  let re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  let m = re.exec(src);
  if (m) {
    const open = src.indexOf('{', m.index);
    const end = braceEnd(src, open);
    if (end !== -1) return src.slice(m.index, end + 1);
  }
  // form B: window.NAME = [async] function (
  re = new RegExp('window\\.' + name + '\\s*=\\s*(?:async\\s+)?function\\s*\\(');
  m = re.exec(src);
  if (m) {
    const open = src.indexOf('{', m.index);
    const end = braceEnd(src, open);
    if (end !== -1) return src.slice(m.index, end + 1) + ';';
  }
  return null;
}

// ── 1. Migrated view ids (the single source of truth the React shell uses). ──
function migratedViewIds() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/migratedViews.ts'), 'utf8');
  const ids = [];
  const re = /\{\s*view:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) ids.push(m[1]);
  return [...new Set(ids)];
}

// ── 2. view id → builder function, parsed from the navigateTo() dispatch. ────
// The dispatch is a run of `if (viewId === 'x') { … buildX() … }` blocks. For
// each block we pick the builder it invokes, in priority order:
//   _lazyBuild('x', BUILDER)  >  window.BUILDER && …  >  first build/init/render
// 'dashboard' is special-cased: its panel is rendered by buildDashboard from the
// background pre-build queue, while its only dispatch reference is a secondary
// widget — so map it to the real builder the safety suite also covers.
function dispatchBuilderMap() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const navStart = src.indexOf('function navigateTo(');
  const navEnd = src.indexOf('// Show/hide navbar for home vs app', navStart);
  assert.ok(navStart !== -1 && navEnd !== -1, 'could not locate navigateTo dispatch in app.js');
  const region = src.slice(navStart, navEnd);

  const hits = [];
  const idRe = /viewId === '([^']+)'/g;
  let m;
  while ((m = idRe.exec(region))) hits.push({ view: m[1], idx: m.index });

  const map = {};
  for (let i = 0; i < hits.length; i++) {
    const seg = region.slice(hits[i].idx, i + 1 < hits.length ? hits[i + 1].idx : region.length);
    let fn = null;
    let mm;
    if ((mm = /_lazyBuild\('[^']+',\s*(\w+)\)/.exec(seg))) fn = mm[1];
    else if ((mm = /window\.(\w+)\s*&&/.exec(seg))) fn = mm[1];
    else if ((mm = /\b((?:build|init|render)\w+)\s*\(/.exec(seg))) fn = mm[1];
    if (fn && !map[hits[i].view]) map[hits[i].view] = fn;
  }
  map.dashboard = 'buildDashboard';
  return map;
}

// ── 3. Build the harness window: stub the few host APIs the legacy IIFEs touch
// at load time, eval every public/js file whole, then eval each inline app.js
// builder we still need. Builders resolve their shared globals at CALL time, so
// a builder that early-returns never dereferences an undefined global. ────────
function makeHarness() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
  });
  const win = dom.window;
  win.navigator.clipboard = { writeText: () => Promise.resolve() };
  // Never-resolving fetch: a guarded builder returns before calling it; an
  // unguarded async builder would crash synchronously inside its body (rejected
  // promise) BEFORE awaiting, which we still catch.
  win.fetch = () => new Promise(() => {});
  // Neutralise schedulers so load-time init code can't fire deferred work that
  // would destabilise the run.
  win.setTimeout = () => 0;
  win.setInterval = () => 0;
  win.clearTimeout = () => {};
  win.clearInterval = () => {};
  win.requestAnimationFrame = () => 0;
  win.requestIdleCallback = () => 0;
  win.queueMicrotask = () => {};
  win.matchMedia =
    win.matchMedia ||
    (() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
  win.scrollTo = () => {};

  const loadErrors = [];
  const dir = path.join(ROOT, 'public/js');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    try {
      win.eval(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      loadErrors.push(`${f}: ${e && e.message}`);
    }
  }
  return { win, loadErrors };
}

// ── Floor constant: minimum number of migrated view-builder pairs the harness
// must resolve and test. Raise this whenever new screens are added so the guard
// stays tight. The staleness check below will fail if this value drifts more
// than MAX_BUILDER_FLOOR_DRIFT below the live resolved count, printing the exact
// value you need to set it to. ────────────────────────────────────────────────
const MIN_COVERED_BUILDERS = 185;

// Maximum allowed gap between MIN_COVERED_BUILDERS and the live resolved count
// before the staleness check fires. Keeps the floor within ~5 builders of
// reality as new screens land. ────────────────────────────────────────────────
const MAX_BUILDER_FLOOR_DRIFT = 5;

// ── Wire it all together at module load so tests register synchronously. ─────
const VIEW_IDS = migratedViewIds();
const BUILDER_MAP = dispatchBuilderMap();
const { win, loadErrors } = makeHarness();
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const resolved = [];
const unresolved = [];
for (const view of VIEW_IDS) {
  const fn = BUILDER_MAP[view];
  if (!fn) continue; // migrated view with no dedicated dispatch builder (e.g. React-only)
  if (typeof win[fn] === 'function') {
    resolved.push({ view, fn, src: 'public/js' });
    continue;
  }
  // inline app.js builder — extract just that function and eval it onto window.
  const extracted = extractBuilder(appSrc, fn);
  if (extracted) {
    try {
      win.eval(extracted);
      if (typeof win[fn] === 'function') {
        resolved.push({ view, fn, src: 'app.js' });
        continue;
      }
    } catch (e) {
      unresolved.push({ view, fn, reason: 'eval: ' + (e && e.message) });
      continue;
    }
  }
  unresolved.push({ view, fn, reason: 'not found in source' });
}

// ── Meta-assertions: the harness itself must be healthy, else every per-builder
// test below is meaningless. ─────────────────────────────────────────────────
test('harness: all public/js modules load cleanly into jsdom', () => {
  assert.deepEqual(loadErrors, [], 'public/js files failed to evaluate:\n' + loadErrors.join('\n'));
});

test('harness: every dispatch-mapped migrated builder resolves to a function', () => {
  assert.deepEqual(
    unresolved,
    [],
    'builders named in the dispatch but not loadable:\n' +
      unresolved.map((u) => `${u.view} -> ${u.fn} (${u.reason})`).join('\n'),
  );
});

test('harness: covers a substantial share of the migrated fleet', () => {
  // Guards against a silently-broken parser resolving nothing. There are ~180+
  // migrated views; the bulk have a dedicated dispatch builder.
  assert.ok(
    resolved.length >= MIN_COVERED_BUILDERS,
    `expected >=${MIN_COVERED_BUILDERS} migrated builders under test, got ${resolved.length}`,
  );
});

test('harness: MIN_COVERED_BUILDERS floor is not stale', () => {
  // Fails when new screens have been added and resolved by the harness but
  // MIN_COVERED_BUILDERS has not been raised to match. Keeps the floor within
  // MAX_BUILDER_FLOOR_DRIFT builders of the live resolved count so the guard
  // stays meaningful as the feature surface grows.
  //
  // If this test fails, update MIN_COVERED_BUILDERS in this file to the value
  // printed below (it must stay <= resolved.length so the fleet check passes).
  const drift = resolved.length - MIN_COVERED_BUILDERS;
  assert.ok(
    drift <= MAX_BUILDER_FLOOR_DRIFT,
    `MIN_COVERED_BUILDERS (${MIN_COVERED_BUILDERS}) is ${drift} below the live ` +
      `resolved count (${resolved.length}), which exceeds the allowed drift of ` +
      `${MAX_BUILDER_FLOOR_DRIFT}. Update MIN_COVERED_BUILDERS to ${resolved.length}.`,
  );
});

// ── 4. The fleet-wide crash guard: each migrated builder must early-return
// (not throw / reject) against an empty DOM. ─────────────────────────────────
for (const { view, fn, src } of resolved) {
  test(`${fn} (view "${view}", ${src}) does not crash on a stripped DOM`, async () => {
    win.document.body.innerHTML = ''; // root element genuinely absent
    let result;
    await assert.doesNotReject(async () => {
      // Synchronous throws and async rejections both surface here.
      result = await win[fn]();
    }, `${fn} crashed on a stripped DOM — view "${view}" would blank the dashboard. Add a first-line guard: if (!document.getElementById('<root>')) return;`);
    // No return-value assertion: a defensively-coded builder may run to
    // completion (returning an object) on an empty DOM without crashing, which
    // is equally safe. We only require "does not crash".
    void result;
  });
}
