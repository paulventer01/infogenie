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
