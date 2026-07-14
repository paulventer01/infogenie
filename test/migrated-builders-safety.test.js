'use strict';
// test/migrated-builders-safety.test.js — guards against the "Analyse Now" crash
// regressions fixed in the migrated-dashboard work.
//
// Historical context: this suite once ALSO proved the four legacy builders
// (buildDashboard/buildCompetitors/buildAudience/buildCreative in
// public/js/ig_core_views.js + ig_compete.js) early-returned on a stripped DOM.
// Those legacy modules were deleted once every dashboard view moved to React —
// the surviving legacy modules are covered fleet-wide by
// test/migrated-builders-coverage.test.js. What remains here is the ported
// React logic guard:
//
//   Placeholder ROAS/CTR arithmetic. A competitor with no metrics carries
//   the placeholder '—' (or null) for ctr/roas. The "vs" cards do
//   arithmetic on those values; '—' + number stringifies and then crashes
//   on `.toFixed`. The fix coerces with parseFloat + Number.isFinite and
//   renders a graceful '—'. This suite drives the ported React builder
//   (components/features/create/Creative.tsx :: buildVsCards) with
//   placeholder input and asserts it emits '—' instead of throwing.
//
// HOW IT LOADS SOURCE: we read the shipped implementation so the test tracks
// the real code (no copy/paste drift). The TSX builder is transpiled with the
// real TypeScript compiler (as in migrated-views-lockstep.test.js) and
// executed in isolation.
//
// Run: node --test (or: npm run test:core — this file is in that gate).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

// ── Extract a top-level `function NAME(...) { … }` by brace-matching. The
// migrated builders contain only balanced braces (template-literal `${…}`
// included), so a simple depth counter recovers the whole body without pulling
// in the rest of the file. ──────────────────────────────────────────────────
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
