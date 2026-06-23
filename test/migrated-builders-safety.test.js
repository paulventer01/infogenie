'use strict';
// test/migrated-builders-safety.test.js — guards against the "Analyse Now" crash
// regressions fixed in the migrated-dashboard work.
//
// Two failure classes once crashed the dashboard after a migration:
//
//   1. DOM-stripped builders. Under the Next.js front door, a migrated
//      `#view-<id>` panel (and every element inside it) is removed from the
//      replayed legacy shell. A legacy view-builder that ran anyway would
//      dereference a missing root element and throw, blanking the whole page.
//      The fix: every migrated builder early-returns the moment its root
//      element is absent. This suite asserts that guard stays in place by
//      loading the REAL builder source and calling it against an empty DOM —
//      a throw means a guard was removed.
//
//   2. Placeholder ROAS/CTR arithmetic. A competitor with no metrics carries
//      the placeholder '—' (or null) for ctr/roas. The "vs" cards do
//      arithmetic on those values; '—' + number stringifies and then crashes
//      on `.toFixed`. The fix coerces with parseFloat + Number.isFinite and
//      renders a graceful '—'. This suite drives both copies of that logic
//      (the legacy public/js/ig_core_views.js builder and the ported React
//      components/features/create/Creative.tsx builder) with placeholder input
//      and asserts they emit '—' instead of throwing.
//
// HOW IT LOADS SOURCE: we read the shipped implementations so the test tracks
// the real code (no copy/paste drift). The legacy public/js files are IIFE-
// wrapped and resolve their many shared globals (analysisData, showToast, …)
// only at CALL time — so evaluating the whole file in jsdom succeeds, and a
// builder that early-returns never touches an undefined global. The TSX builder
// is transpiled with the real TypeScript compiler (as in
// migrated-views-lockstep.test.js) and executed in isolation.
//
// Run: node --test (or: npm run test:core — this file is in that gate).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

// ── Extract a top-level `function NAME(...) { … }` by brace-matching. The
// migrated builders contain only balanced braces (template-literal `${…}`
// included), so a simple depth counter recovers the whole body without pulling
// in the rest of the (huge) file. ──────────────────────────────────────────
function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  assert.ok(m, `function ${name} not found in source`);
  const open = src.indexOf('{', m.index);
  assert.notEqual(open, -1, `no opening brace for ${name}`);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, j + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — migrated builders early-return on a stripped DOM (no throw)
// ─────────────────────────────────────────────────────────────────────────────
// Each entry: the builder + the root element id whose absence must short-circuit
// it. These mirror the guards in the shipped code; the migrated-view ids they
// back are in lib/migratedViews.ts (dashboard / competitors / audience / creative).
const BUILDER_GUARDS = [
  { file: 'public/js/ig_core_views.js', fn: 'buildDashboard', rootId: 'dashTitle' },
  { file: 'public/js/ig_compete.js', fn: 'buildCompetitors', rootId: 'compFilterSel' },
  { file: 'public/js/ig_core_views.js', fn: 'buildAudience', rootId: 'audienceWrap' },
  { file: 'public/js/ig_core_views.js', fn: 'buildCreative', rootId: 'creativeWrap' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Part 0 — staleness guard: the four named builders must still exist in both
// their source files and the navigateTo() dispatch in app.js.
// If a builder is renamed or replaced, this test fails and names the missing
// entry so BUILDER_GUARDS can be updated to match.
// ─────────────────────────────────────────────────────────────────────────────

// Returns the set of all builder function names referenced in the navigateTo()
// dispatch region of app.js. buildDashboard is added unconditionally because
// the coverage test's dispatchBuilderMap() hard-codes it as a special case
// (it is pre-built in a background queue rather than called directly).
function liveDispatchBuilders() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const navStart = src.indexOf('function navigateTo(');
  const navEnd = src.indexOf('// Show/hide navbar for home vs app', navStart);
  if (navStart === -1 || navEnd === -1) return null; // unparseable — skip dispatch half
  const region = src.slice(navStart, navEnd);
  const names = new Set();
  for (const m of region.matchAll(/_lazyBuild\('[^']+',\s*(\w+)\)/g)) names.add(m[1]);
  for (const m of region.matchAll(/window\.(\w+)\s*&&/g)) names.add(m[1]);
  for (const m of region.matchAll(/\b((?:build|init|render)\w+)\s*\(/g)) names.add(m[1]);
  names.add('buildDashboard'); // special-cased in the coverage suite's dispatchBuilderMap
  return names;
}

test('BUILDER_GUARDS: all named builders still exist in their source file and the dispatch map', () => {
  const dispatch = liveDispatchBuilders();
  for (const { file, fn } of BUILDER_GUARDS) {
    // 1. The source file must still define the function.
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const re = new RegExp('function\\s+' + fn + '\\s*\\(');
    assert.ok(
      re.test(src),
      `BUILDER_GUARDS is stale: function ${fn} no longer found in ${file}. ` +
        `Update BUILDER_GUARDS to match the current builder name in that file.`,
    );
    // 2. The builder must still be referenced in the navigateTo() dispatch
    //    (or be the special-cased buildDashboard). Skip if app.js is unparseable.
    if (dispatch !== null) {
      assert.ok(
        dispatch.has(fn),
        `BUILDER_GUARDS is stale: ${fn} is no longer referenced in the app.js ` +
          `navigateTo() dispatch. Update BUILDER_GUARDS to match the current builder name.`,
      );
    }
  }
});

let win;

before(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
  });
  win = dom.window;
  // clipboard is touched at load time by a helper definition in ig_core_views.js
  // (copyCreative); stub it so the IIFE evaluates without a DOM clipboard.
  win.navigator.clipboard = { writeText: () => Promise.resolve() };
  for (const file of ['public/js/ig_core_views.js', 'public/js/ig_compete.js']) {
    win.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
});

for (const { file, fn, rootId } of BUILDER_GUARDS) {
  test(`${fn} early-returns (no throw) when #${rootId} is absent`, () => {
    // Confirm the function we mean to test actually loaded onto window.
    assert.equal(
      typeof win[fn],
      'function',
      `expected window.${fn} to load from ${file}`,
    );
    // The jsdom body is empty, so the root element is genuinely missing.
    assert.equal(
      win.document.getElementById(rootId),
      null,
      `precondition: #${rootId} must NOT exist for this guard test`,
    );
    let returned;
    assert.doesNotThrow(() => {
      returned = win[fn]();
    }, `${fn} threw on a stripped DOM — its #${rootId} early-return guard is gone`);
    assert.equal(
      returned,
      undefined,
      `${fn} should early-return (undefined) when #${rootId} is absent`,
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — placeholder ROAS/CTR coercion renders '—' instead of crashing
// ─────────────────────────────────────────────────────────────────────────────
// A competitor with no metrics whose first campaign carries the placeholder.
function placeholderCompetitor(ctr, roas) {
  return {
    name: 'NoMetrics Co',
    logo: 'N',
    suggestions: ['generic'],
    audiences: [],
    campaigns: [
      {
        name: 'Camp',
        channel: 'Google',
        ctr,
        roas,
        budget: '$1,000',
        status: 'Active',
      },
    ],
  };
}
const INDUSTRY = { name: 'SaaS' };

// Legacy builder — public/js/ig_core_views.js :: buildCompetitorVsCards
test("legacy buildCompetitorVsCards: placeholder '—'/null ctr/roas render '—' (no crash)", () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/ig_core_views.js'), 'utf8');
  const build = new Function(
    extractFunction(src, 'buildCompetitorVsCards') +
      '\nreturn buildCompetitorVsCards;',
  )();

  for (const [ctr, roas] of [['—', '—'], [null, null]]) {
    let html;
    assert.doesNotThrow(() => {
      html = build(INDUSTRY, [placeholderCompetitor(ctr, roas)], 'me.com');
    }, `buildCompetitorVsCards threw on ctr=${ctr} roas=${roas}`);
    // The two teal-coloured stat values are Est. CTR + Est. ROAS; both must be
    // the graceful em-dash, never a stringified NaN/crash.
    const tealDashes = (html.match(/--teal\)">—</g) || []).length;
    assert.equal(
      tealDashes,
      2,
      `expected Est. CTR + Est. ROAS to render '—' for placeholder input (ctr=${ctr})`,
    );
    assert.doesNotMatch(html, /NaN/, 'must not leak NaN into the rendered card');
  }

  // Sanity: finite metrics still compute real numbers (the guard does not
  // swallow valid data).
  const ok = build(INDUSTRY, [placeholderCompetitor('2.5', '3.0')], 'me.com');
  assert.equal((ok.match(/--teal\)">—</g) || []).length, 0, 'finite metrics must not render —');
  assert.match(ok, /3\.9%/, 'finite CTR (2.5 + 1.4) must compute to 3.9%');
});

// Ported React builder — components/features/create/Creative.tsx :: buildVsCards
// (Task #223 referred to this as `generateVsCards`; the shipped function is
// named `buildVsCards`.)
test("React buildVsCards: placeholder '—'/null ctr/roas yield ourCTR/ourROAS '—' (no crash)", () => {
  const tsxSrc = fs.readFileSync(
    path.join(ROOT, 'components/features/create/Creative.tsx'),
    'utf8',
  );
  const { outputText } = ts.transpileModule(
    extractFunction(tsxSrc, 'buildVsCards') + '\nmodule.exports = buildVsCards;',
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
      },
    },
  );
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', outputText)(mod.exports, mod);
  const buildVsCards = mod.exports;

  for (const [ctr, roas] of [['—', '—'], [null, null]]) {
    let cards;
    assert.doesNotThrow(() => {
      cards = buildVsCards(INDUSTRY, [placeholderCompetitor(ctr, roas)]);
    }, `buildVsCards threw on ctr=${ctr} roas=${roas}`);
    assert.equal(cards.length, 1, 'one card expected');
    assert.equal(cards[0].ourCTR, '—', `ourCTR must be '—' for placeholder ctr=${ctr}`);
    assert.equal(cards[0].ourROAS, '—', `ourROAS must be '—' for placeholder roas=${roas}`);
  }

  // Sanity: finite metrics still compute real numbers.
  const ok = buildVsCards(INDUSTRY, [placeholderCompetitor('2.5', 3.0)]);
  assert.equal(ok[0].ourCTR, '3.9%', 'finite CTR (2.5 + 1.4) must compute to 3.9%');
  assert.equal(ok[0].ourROAS, '4.2×', 'finite ROAS (3.0 + 1.2) must compute to 4.2×');
});
