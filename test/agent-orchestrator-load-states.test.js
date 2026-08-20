'use strict';
// Source-audit lock for Agent Orchestrator dashboard load/empty/retry UX.
// Reads the TSX as text — no React Testing Library.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
  'utf8',
);

function loadCallbackSource() {
  const start = SRC.indexOf('const load = useCallback');
  assert.ok(start >= 0, 'load callback is present');
  const end = SRC.indexOf('useEffect', start);
  assert.ok(end > start, 'load callback precedes useEffect');
  return SRC.slice(start, end);
}

test('AgentOrchestrator load inspects r.ok before setModules', () => {
  const loadSrc = loadCallbackSource();
  assert.match(loadSrc, /\br\.ok\b/, 'load inspects r.ok');
  const okIdx = loadSrc.search(/\br\.ok\b/);
  const setModulesIdx = loadSrc.indexOf('setModules(r.modules');
  assert.ok(setModulesIdx >= 0, 'successful load still assigns r.modules');
  assert.ok(okIdx < setModulesIdx, 'r.ok is inspected before treating modules as present');
});

test('AgentOrchestrator has Retry copy and empty-modules copy', () => {
  assert.match(SRC, />\s*Retry\s*</, 'Retry control exists');
  assert.match(
    SRC,
    /No orchestrator modules are available right now\./,
    'empty-modules copy exists',
  );
});

function loadWorkflowsCallbackSource() {
  const start = SRC.indexOf('const loadWorkflows = useCallback');
  assert.ok(start >= 0, 'loadWorkflows callback is present');
  const end = SRC.indexOf('const loadSelected', start);
  assert.ok(end > start, 'loadWorkflows callback precedes loadSelected');
  return SRC.slice(start, end);
}

test('AgentOrchestrator workflow list load inspects r.ok before setWorkflows', () => {
  const loadSrc = loadWorkflowsCallbackSource();
  assert.match(loadSrc, /\br\.ok\b/, 'loadWorkflows inspects r.ok');
  const okIdx = loadSrc.search(/\br\.ok\b/);
  const setWfIdx = loadSrc.indexOf('setWorkflows(r.workflows');
  assert.ok(setWfIdx >= 0, 'successful load still assigns r.workflows');
  assert.ok(okIdx < setWfIdx, 'r.ok is inspected before treating workflows as present');
});

test('AgentOrchestrator advertising workflow empty copy and future-features banner', () => {
  assert.match(
    SRC,
    /No advertising workflows yet\./,
    'empty advertising-workflows copy exists',
  );
  assert.match(
    SRC,
    /not yet implemented/i,
    'future-features not-yet-implemented copy exists',
  );
});

test('AgentOrchestrator does not hard-code fake performance metrics as live results', () => {
  const fakeMetricPatterns = [
    /\bROAS\s*[:=]\s*[\d.]+/i,
    /\bCTR\s*[:=]\s*[\d.]+%/i,
    /\bimpressions\s*[:=]\s*[\d,]+/i,
  ];
  for (const pat of fakeMetricPatterns) {
    assert.doesNotMatch(SRC, pat, `must not present fabricated metric: ${pat}`);
  }
});
