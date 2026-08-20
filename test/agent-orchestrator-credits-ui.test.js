'use strict';
// Source-audit lock for Agent Orchestrator shared-credits UI.
// Reads the TSX as text — no React Testing Library.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
  'utf8',
);

function loadCreditsCallbackSource() {
  const start = SRC.indexOf('const loadCredits = useCallback');
  assert.ok(start >= 0, 'loadCredits callback is present');
  const end = SRC.indexOf('const loadSelected', start);
  assert.ok(end > start, 'loadCredits callback precedes loadSelected');
  return SRC.slice(start, end);
}

test('AgentOrchestrator credits load inspects r.ok before setCreditsData', () => {
  const loadSrc = loadCreditsCallbackSource();
  assert.match(loadSrc, /\br\.ok\b/, 'loadCredits inspects r.ok');
  const okIdx = loadSrc.search(/\br\.ok\b/);
  const setDataIdx = loadSrc.indexOf('setCreditsData(snap');
  assert.ok(setDataIdx >= 0, 'successful load still assigns credits snapshot');
  assert.ok(okIdx < setDataIdx, 'r.ok is inspected before treating credits payload as present');
});

test('AgentOrchestrator credits section has Retry on load error', () => {
  const creditsBlockStart = SRC.indexOf('Shared credits &amp; cost controls');
  assert.ok(creditsBlockStart >= 0, 'credits section heading exists');
  const creditsBlock = SRC.slice(creditsBlockStart, creditsBlockStart + 4500);
  assert.match(creditsBlock, /creditsStatus === "error"/, 'credits error state exists');
  assert.match(creditsBlock, />\s*Retry\s*</, 'credits Retry control exists');
});

test('AgentOrchestrator gates grant, adjust, and limits.edit with can()', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.credits\.grant"\)/,
    'grant form gated by orchestrator.credits.grant',
  );
  assert.match(
    SRC,
    /can\("orchestrator\.credits\.adjust"\)/,
    'adjust form gated by orchestrator.credits.adjust',
  );
  assert.match(
    SRC,
    /can\("orchestrator\.credits\.limits\.edit"\)/,
    'limits editor gated by orchestrator.credits.limits.edit',
  );
});

test('AgentOrchestrator states ceiling 0 is not unlimited', () => {
  assert.match(
    SRC,
    /no credit spending is authorised/i,
    'tenant ceiling zero copy exists',
  );
  assert.doesNotMatch(
    SRC,
    /credit ceiling.*unlimited/i,
    'must not describe ceiling 0 as unlimited',
  );
  assert.match(
    SRC,
    /Credit ceiling is 0 — chargeable autonomous work is not authorised\./,
    'approve warning when workflow ceiling is zero',
  );
});

test('AgentOrchestrator approve payload sends credit_ceiling_micros from workflow', () => {
  assert.match(
    SRC,
    /credit_ceiling_micros:\s*Number\(wf\.credit_ceiling_micros/,
    'approve payload uses workflow credit_ceiling_micros',
  );
  assert.doesNotMatch(
    SRC,
    /credit_ceiling:\s*0/,
    'must not hardcode credit_ceiling: 0 as unlimited sentinel',
  );
});

test('AgentOrchestrator credits empty reservations copy', () => {
  assert.match(
    SRC,
    /No credit activity yet\./,
    'empty credit reservations copy exists',
  );
});

test('AgentOrchestrator honesty banner does not claim live AI spend charging', () => {
  assert.doesNotMatch(
    SRC,
    /credit accounting is active for tenant-authorised AI spend/i,
    'must not claim shared credit accounting is active for tenant AI spend',
  );
  assert.match(
    SRC,
    /Automatic AI spend charging is not enabled in production yet/i,
    'banner states automatic AI spend charging is not live in production',
  );
});

test('AgentOrchestrator reservation status filter matches schema', () => {
  assert.match(
    SRC,
    /const RESERVATION_STATUSES = new Set\(\["reserved", "committed", "released", "expired"\]\);/,
    'RESERVATION_STATUSES includes reserved, committed, released, expired',
  );
  const setBlock = SRC.match(
    /const RESERVATION_STATUSES = new Set\(\[[^\]]+\]\);/,
  );
  assert.ok(setBlock, 'RESERVATION_STATUSES Set declaration exists');
  assert.doesNotMatch(
    setBlock[0],
    /"failed"/,
    'RESERVATION_STATUSES must not include failed',
  );
});
