'use strict';
// Source-audit lock for dashboard boot restore of last analysis.
// Reads TSX as text — no React Testing Library (same pattern as
// test/agent-orchestrator-load-states.test.js).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP_SHELL = fs.readFileSync(
  path.join(__dirname, '..', 'components/layout/AppShell.tsx'),
  'utf8',
);
const BRIEF = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/manage/MarketingBrief.tsx'),
  'utf8',
);
const CONTEXT_BAR = fs.readFileSync(
  path.join(__dirname, '..', 'components/layout/CompanyContextBar.tsx'),
  'utf8',
);

function restoreEffectSource() {
  const marker = '/api/diag-capture/latest';
  const callIdx = APP_SHELL.indexOf(marker);
  assert.ok(callIdx >= 0, 'restore calls /api/diag-capture/latest');
  const start = APP_SHELL.lastIndexOf('useEffect', callIdx);
  assert.ok(start >= 0 && start < callIdx, 'restore lives in useEffect, not the render path');
  const after = APP_SHELL.indexOf('\n  useEffect(', callIdx);
  const end = after > start ? after : start + 3500;
  return APP_SHELL.slice(start, end);
}

function onReadySource() {
  const start = APP_SHELL.indexOf('const onReady');
  assert.ok(start >= 0, 'AppShell has an onReady listener for ig:analysis-ready');
  const addIdx = APP_SHELL.indexOf('document.addEventListener', start);
  const end = addIdx > start ? addIdx : start + 1800;
  return APP_SHELL.slice(start, end);
}

test('Failed restore does not block AppShell rendering', () => {
  const restoreSrc = restoreEffectSource();

  // {children} is rendered unconditionally in the shell content slot — not
  // behind a restore-loading spinner that would replace the stage.
  assert.match(
    APP_SHELL,
    /id="ig-shell-content"[\s\S]{0,80}\{children\}/,
    'AppShell still renders {children} in the shell content slot',
  );
  const childrenIdx = APP_SHELL.indexOf('{children}');
  assert.ok(childrenIdx >= 0, '{children} is present');
  const aroundChildren = APP_SHELL.slice(Math.max(0, childrenIdx - 180), childrenIdx + 40);
  assert.doesNotMatch(
    aroundChildren,
    /restore(Loading|Ready|Error)|if\s*\(\s*!?\s*restor/i,
    '{children} is not gated behind restore-loading',
  );

  // Restore is a useEffect (first paint), not a blocking call in the function body.
  assert.match(restoreSrc, /^useEffect\s*\(/, 'restore lives in useEffect');
  const fnStart = APP_SHELL.indexOf('export default function AppShell');
  const firstEffect = APP_SHELL.indexOf('useEffect', fnStart);
  const restoreCall = APP_SHELL.indexOf('/api/diag-capture/latest');
  assert.ok(fnStart >= 0 && firstEffect >= 0);
  assert.ok(
    restoreCall > firstEffect,
    'diag-capture restore is not in the function-body render path before effects',
  );

  // Inspect r.ok (or result.ok) before assigning window.analysisData.
  const okIdx = restoreSrc.search(/\b(?:r|result)\.ok\b/);
  assert.ok(okIdx >= 0, 'restore inspects r.ok (or result.ok)');
  const assignIdx = restoreSrc.search(/\.analysisData\s*=/);
  assert.ok(assignIdx >= 0, 'successful restore still assigns analysisData');
  assert.ok(okIdx < assignIdx, 'r.ok is inspected before assigning window.analysisData');

  // try/catch so a throw cannot escape the effect.
  const tryIdx = restoreSrc.search(/try\s*\{/);
  const catchIdx = restoreSrc.search(/catch\s*(?:\([^)]*\))?\s*\{/);
  assert.ok(tryIdx >= 0, 'restore wraps work in try');
  assert.ok(catchIdx > tryIdx, 'restore has catch so a throw cannot escape the effect');

  // Restore fires the same events live Analyse Now fires so mounted panels refresh.
  assert.match(
    restoreSrc,
    /document\.dispatchEvent\([\s\S]*CustomEvent\(\s*['"]ig:analysis-ready['"]/,
    'restore dispatches ig:analysis-ready on document',
  );
  assert.match(
    restoreSrc,
    /restored:\s*true/,
    'restore-fired ready event includes restored: true so onReady can skip router.push',
  );
  const readyEventIdx = restoreSrc.search(/CustomEvent\(\s*['"]ig:analysis-ready['"]/);
  assert.ok(readyEventIdx >= 0, 'restore constructs ig:analysis-ready CustomEvent');
  const readySlice = restoreSrc.slice(readyEventIdx, readyEventIdx + 280);
  assert.match(
    readySlice,
    /restored:\s*true/,
    'restored: true is on the ig:analysis-ready detail (not a different event)',
  );

  // Must dispatch ig:analysis-updated (Brief listens on document; field enhancer on window).
  assert.match(
    restoreSrc,
    /ig:analysis-updated/,
    'restore does dispatch ig:analysis-updated',
  );
  assert.match(
    restoreSrc,
    /window\.dispatchEvent\([\s\S]*ig:analysis-updated/,
    'restore dispatches ig:analysis-updated on window',
  );
  assert.match(
    restoreSrc,
    /document\.dispatchEvent\([\s\S]*ig:analysis-updated/,
    'restore dispatches ig:analysis-updated on document',
  );
  assert.match(
    restoreSrc,
    /detail:\s*\{\s*brand,\s*competitors\s*\}/,
    'restore ig:analysis-updated carries brand + competitors like live Analyse Now',
  );
});

test('AppShell onReady skips Brief navigation for restored analysis-ready', () => {
  const readySrc = onReadySource();

  const restoredIdx = readySrc.search(/detail\?\.restored\s*===\s*true/);
  assert.ok(restoredIdx >= 0, 'onReady inspects event.detail?.restored === true');

  const returnIdx = readySrc.indexOf('return', restoredIdx);
  const pushIdx = readySrc.indexOf('router.push("/manage/marketing-brief")');
  assert.ok(pushIdx >= 0, 'live (non-restore) ig:analysis-ready still navigates to Brief');
  assert.ok(
    returnIdx >= 0 && returnIdx < pushIdx,
    'onReady returns before router.push when the event is a restore',
  );

  assert.match(
    readySrc,
    /setNavReady\(\s*true\s*\)/,
    'onReady still sets navReady for restore and live analysis',
  );
  assert.match(
    readySrc,
    /LS_ANALYSED/,
    'onReady still persists ig:analysed for restore and live analysis',
  );
});

test('MarketingBrief shows Industry benchmark copy for benchmark provenance', () => {
  const buildStart = BRIEF.indexOf('function buildCompetitiveTodos');
  assert.ok(buildStart >= 0, 'buildCompetitiveTodos is present');
  const buildEnd = BRIEF.indexOf('\nfunction mergeTodoActions', buildStart);
  const buildSrc = BRIEF.slice(buildStart, buildEnd > buildStart ? buildEnd : buildStart + 6000);

  assert.match(buildSrc, /source\s*===\s*['"]industry-benchmark['"]/, 'reads source on competitors / websiteKPIs');
  assert.match(buildSrc, /provenance/, 'tags TodoAction provenance for the card label');
  assert.match(
    BRIEF,
    /Industry benchmark/,
    'card header copy includes Industry benchmark',
  );
  assert.match(
    buildSrc,
    /published industry (average|benchmark)|industry-benchmark/i,
    'ROAS copy is labelled as industry benchmark rather than live ad-account truth',
  );
});

test('CompanyContextBar listens to ig:analysis-updated', () => {
  assert.match(
    CONTEXT_BAR,
    /addEventListener\(\s*['"]ig:analysis-updated['"]/,
    'CompanyContextBar listens for ig:analysis-updated so restore refreshes the domain bar',
  );
  assert.match(
    CONTEXT_BAR,
    /addEventListener\(\s*['"]ig:analysis-ready['"]/,
    'CompanyContextBar still listens for ig:analysis-ready',
  );
});
