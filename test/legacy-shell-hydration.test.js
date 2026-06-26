'use strict';
// test/legacy-shell-hydration.test.js — regression guard for the LegacyBody
// hydration mismatch fix in lib/legacyShell.ts.
//
// Background: getLegacyShell() is called independently by DashboardLayout
// (for `scripts`) and LegacyBody (for `bodyHtml`). In Next.js 15's App Router
// the SSR stream and the RSC Flight payload are generated in separate passes.
// If those two parse() calls produce even one differing byte — e.g. due to an
// in-flight HMR write between calls, or inconsistent whitespace — the Flight
// bodyHtml won't match the SSR DOM and React fires a deterministic hydration
// mismatch on every hard refresh.
//
// Two fixes guard against this:
//   1. React cache() — wraps parse() so all Server Component calls within the
//      same request share one parse() invocation (no second call, no divergence).
//   2. Whitespace normalisation — collapses runs of 3+ consecutive \n to \n\n
//      so the nav-strip's surrounding newlines don't produce 4→3 collapse mismatches.
//
// This test verifies both fixes stay in place and that getLegacyShell() itself
// produces consistent, well-formed output.
//
// Runtime strategy: lib/legacyShell.ts is TypeScript (ESM). We transpile it to
// CommonJS at test time via typescript.transpileModule() (TypeScript is already
// a project dep via Next.js) and run it in a vm.Script context with mocked
// module dependencies. This means we test the ACTUAL getLegacyShell() logic, not
// a re-implementation.
//
// Run: node --test (or: npm run test:core — this file is in that gate).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHELL_SRC = path.join(__dirname, '..', 'lib', 'legacyShell.ts');

// ── Build a callable getLegacyShell() from the TypeScript source ──────────────
//
// Steps:
//   1. Transpile lib/legacyShell.ts → CJS JavaScript via TypeScript's
//      transpileModule() API (strips types, rewrites import→require, no type-check).
//   2. Run in a vm.Script context whose `require` provides:
//        • react           → { cache: fn => fn }   (identity — no memoization,
//                             so each call exercises parse() independently; a
//                             stricter test than the production path which caches)
//        • node:fs         → real readFileSync
//        • node:path       → real join
//        • @/lib/migratedViews → { MIGRATED_VIEWS: [] }
//                             (empty — we're testing the HTML pipeline, not view
//                              suppression; using [] is safe and keeps the dep-free)
//   3. Extract getLegacyShell from the resulting exports object.

function buildGetLegacyShell() {
  const ts = require('typescript');
  const rawTs = fs.readFileSync(SHELL_SRC, 'utf8');

  const { outputText } = ts.transpileModule(rawTs, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });

  const moduleExports = {};
  const moduleObj = { exports: moduleExports };

  const mockRequire = (id) => {
    if (id === 'react') {
      // cache() normally deduplicates within a React request context.
      // Here we use the identity so each getLegacyShell() call runs parse()
      // independently — this is a STRICTER test of determinism.
      return { cache: (fn) => fn };
    }
    if (id === 'node:fs' || id === 'fs') {
      return { readFileSync: fs.readFileSync.bind(fs) };
    }
    if (id === 'node:path' || id === 'path') {
      return { join: path.join.bind(path) };
    }
    if (id === '@/lib/migratedViews') {
      return { MIGRATED_VIEWS: [] };
    }
    throw new Error(`[legacy-shell-hydration test] unexpected require: ${id}`);
  };

  const script = new vm.Script(outputText, { filename: SHELL_SRC });
  const context = vm.createContext({
    require: mockRequire,
    module: moduleObj,
    exports: moduleExports,
    __filename: SHELL_SRC,
    __dirname: path.dirname(SHELL_SRC),
    process,
  });
  script.runInContext(context);

  const { getLegacyShell } = moduleObj.exports;
  assert.strictEqual(
    typeof getLegacyShell,
    'function',
    'getLegacyShell must be exported as a function from lib/legacyShell.ts',
  );
  return getLegacyShell;
}

const getLegacyShell = buildGetLegacyShell();

// ── Source guard: verify both fixes are present in lib/legacyShell.ts ────────
// These fail fast if a source edit removes the fix, before any runtime call.

test('getLegacyShell is exported as cache(parse), not as a bare parse call', () => {
  const src = fs.readFileSync(SHELL_SRC, 'utf8');

  // Two independent checks — both must pass:
  //   (a) getLegacyShell is exported as a const
  //   (b) the assignment RHS is cache(parse)
  // Checked separately so the TS type annotation (`: () => LegacyShell`, which
  // contains `=>`) doesn't trip a single-pass regex matching `[^=]*`.
  assert.ok(
    /export\s+const\s+getLegacyShell/.test(src),
    'lib/legacyShell.ts: getLegacyShell must be exported as a const.',
  );
  assert.ok(
    /=\s*cache\s*\(\s*parse\s*\)\s*;/.test(src),
    'lib/legacyShell.ts: getLegacyShell must be assigned as cache(parse) — ' +
      'removing cache() causes a deterministic hydration mismatch on every hard refresh.',
  );
});

test('parse() is not exported directly from lib/legacyShell.ts', () => {
  const src = fs.readFileSync(SHELL_SRC, 'utf8');

  const directExport = /export\s+(?:function\s+parse|(?:\{[^}]*\bparse\b[^}]*\}))/;
  assert.ok(
    !directExport.test(src),
    'lib/legacyShell.ts: parse() must NOT be exported — only the cache()-wrapped ' +
      'getLegacyShell should be exported so callers cannot bypass the dedup guard.',
  );
});

test('lib/legacyShell.ts contains the whitespace normalisation step', () => {
  const src = fs.readFileSync(SHELL_SRC, 'utf8');
  assert.ok(
    src.includes('\\n[ \\t]*\\n([ \\t]*\\n)+'),
    'lib/legacyShell.ts: the whitespace normalisation regex is missing — ' +
      'removing it re-introduces hydration mismatches from multi-newline runs ' +
      'left by the navbar strip.',
  );
});

// ── Runtime contract tests: call the real getLegacyShell() ───────────────────
//
// We use `cache: fn => fn` (identity) so each call to getLegacyShell() runs
// parse() independently — this is stricter than production (which deduplicates)
// and directly tests that the parsing logic itself is deterministic.

test('getLegacyShell().bodyHtml is byte-identical across two consecutive calls', () => {
  const first = getLegacyShell().bodyHtml;
  const second = getLegacyShell().bodyHtml;

  assert.strictEqual(
    typeof first,
    'string',
    'getLegacyShell().bodyHtml must be a string',
  );
  assert.strictEqual(
    first,
    second,
    'getLegacyShell() returned different bodyHtml strings on two calls — ' +
      'parse() must be deterministic so the SSR and RSC Flight passes match. ' +
      'If cache() is bypassed, both passes must still produce identical HTML.',
  );
});

test('getLegacyShell().bodyHtml contains no runs of 3 or more consecutive newlines', () => {
  const { bodyHtml } = getLegacyShell();

  const tripleNewline = /\n[ \t]*\n[ \t]*\n/;
  assert.ok(
    !tripleNewline.test(bodyHtml),
    'getLegacyShell().bodyHtml contains 3+ consecutive newlines — the whitespace ' +
      'normalisation step must collapse those runs to \\n\\n, otherwise the ' +
      "browser's HTML serialiser collapses them differently (e.g. 4→3) and " +
      'React reports a hydration mismatch.',
  );
});

// ── Structural landmark tests ─────────────────────────────────────────────────
//
// These guard against two failure modes:
//   A. A future edit to index.html removes or renames a structural landmark →
//      the assertion for that landmark fails.
//   B. The strip regex in parse() is accidentally widened (e.g. the navbar
//      pattern matches more than just the nav) → landmarks inside the over-
//      matched region disappear and their assertions fail.
//
// All tests read index.html through the REAL parse() pipeline so they exercise
// the same code path as the production Next.js shell.

test('getLegacyShell().bodyHtml does not contain the legacy navbar (id="navbar")', () => {
  const { bodyHtml } = getLegacyShell();

  assert.ok(
    !bodyHtml.includes('id="navbar"'),
    'getLegacyShell().bodyHtml still contains id="navbar" — the navbar strip ' +
      'in parse() must remove <nav id="navbar">…</nav> so the React <Navbar/> ' +
      'can render in its place without a duplicate.',
  );
});

test('getLegacyShell().bodyHtml contains no real <script> elements (all stripped)', () => {
  const { bodyHtml } = getLegacyShell();

  // HTML comments are intentionally preserved by parse() (they are not scripts),
  // so a bare /<script\b/ check would false-positive on comments that mention
  // "<script>" as text (e.g. the "Plain <script>, load AFTER app.js" comment in
  // index.html). Strip comments first, then assert no real script element remains.
  const withoutComments = bodyHtml.replace(/<!--[\s\S]*?-->/g, '');

  assert.ok(
    !/<script\b/i.test(withoutComments),
    'getLegacyShell().bodyHtml contains a real <script> element outside of an ' +
      'HTML comment — parse() must strip every <script> element so <LegacyScripts/> ' +
      'can replay them in order without double-execution.',
  );
});

test('getLegacyShell().bodyHtml contains id="view-home" (homepage panel)', () => {
  const { bodyHtml } = getLegacyShell();

  assert.ok(
    bodyHtml.includes('id="view-home"'),
    'getLegacyShell().bodyHtml is missing id="view-home" — this landmark is the ' +
      'root panel of the SPA homepage and must survive the navbar/script strip. ' +
      'Either index.html no longer contains this div, or the strip regex has ' +
      'been accidentally widened.',
  );
});

test('getLegacyShell().bodyHtml contains id="view-dashboard" (dashboard panel)', () => {
  const { bodyHtml } = getLegacyShell();

  assert.ok(
    bodyHtml.includes('id="view-dashboard"'),
    'getLegacyShell().bodyHtml is missing id="view-dashboard" — the main ' +
      'intelligence-report panel must survive the strip so the SPA can render it.',
  );
});

test('getLegacyShell().bodyHtml contains id="loadingOverlay" (loading overlay)', () => {
  const { bodyHtml } = getLegacyShell();

  assert.ok(
    bodyHtml.includes('id="loadingOverlay"'),
    'getLegacyShell().bodyHtml is missing id="loadingOverlay" — the loading ' +
      'overlay element must survive the strip; removing it breaks the analysis ' +
      'progress indicator for all users.',
  );
});

test('getLegacyShell().bodyHtml contains multiple class="view" panels', () => {
  const { bodyHtml } = getLegacyShell();

  const matches = bodyHtml.match(/class="view(?:\s[^"]*)?"/g) || [];
  assert.ok(
    matches.length >= 10,
    `getLegacyShell().bodyHtml contains only ${matches.length} class="view" ` +
      'element(s) — expected at least 10. The SPA has dozens of view panels; ' +
      'if most are missing the strip regex has over-matched and removed them.',
  );
});

// ── Bulk-removal guard ────────────────────────────────────────────────────────
//
// index.html currently contains 223 elements with id="view-*". This test
// catches accidental bulk removal — e.g. a merge that replaces index.html with
// an older version, or a refactor that collapses many view panels — while
// allowing deliberate single-panel removals without needing to update the
// constant every time.
//
// Update MIN_VIEW_PANEL_COUNT after an intentional batch removal; keep the
// value at (new total − 20) so there is still a meaningful floor.

const MIN_VIEW_PANEL_COUNT = 212;

test(`getLegacyShell().bodyHtml contains at least ${MIN_VIEW_PANEL_COUNT} id="view-*" panels (bulk-removal guard)`, () => {
  const { bodyHtml } = getLegacyShell();

  const matches = bodyHtml.match(/\bid="view-[^"]+"/g) || [];
  assert.ok(
    matches.length >= MIN_VIEW_PANEL_COUNT,
    `getLegacyShell().bodyHtml contains only ${matches.length} id="view-*" panel(s) — ` +
      `expected at least ${MIN_VIEW_PANEL_COUNT}. ` +
      'This likely means index.html was replaced with an older copy, or a refactor ' +
      'accidentally removed a large block of view panels. If panels were intentionally ' +
      'removed in bulk, update MIN_VIEW_PANEL_COUNT in test/legacy-shell-hydration.test.js ' +
      'to (new total − 20).',
  );
});

// ── Floor-staleness guard ─────────────────────────────────────────────────────
//
// Whenever a developer adds panels in bulk to index.html the constant above
// can drift more than 20 below the live count, silently weakening the guard.
// This test catches that drift automatically: if the live count in index.html
// exceeds MIN_VIEW_PANEL_COUNT by more than 20, the test fails and tells the
// developer to bump the constant.
//
// How to fix: set MIN_VIEW_PANEL_COUNT to (liveCount − 20).

test('MIN_VIEW_PANEL_COUNT floor is within 20 of the live id="view-*" count in index.html', () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8',
  );
  const liveCount = (indexHtml.match(/\bid="view-[^"]+"/g) || []).length;
  const gap = liveCount - MIN_VIEW_PANEL_COUNT;
  assert.ok(
    gap <= 20,
    `MIN_VIEW_PANEL_COUNT (${MIN_VIEW_PANEL_COUNT}) is ${gap} below the current live count ` +
      `of ${liveCount} id="view-*" panels in index.html (limit: 20). ` +
      `Bump MIN_VIEW_PANEL_COUNT to ${liveCount - 20} in ` +
      'test/legacy-shell-hydration.test.js to keep the bulk-removal guard meaningful.',
  );
});
