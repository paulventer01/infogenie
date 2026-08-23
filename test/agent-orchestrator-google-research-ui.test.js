'use strict';
// Source-audit lock for Agent Orchestrator Google research UI (PR3B-3).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
  'utf8',
);

function googleResearchBlock() {
  const start = SRC.indexOf('>Google research</h5>');
  assert.ok(start >= 0, 'Google research card heading exists');
  const end = SRC.indexOf('Approval history', start);
  assert.ok(end > start, 'Google research card precedes approval history');
  return SRC.slice(start, end);
}

test('AgentOrchestrator Google research uses POST /api/agent-orchestrator/research/runs', () => {
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs/,
    'research runs API path is referenced',
  );
  const startFn = SRC.slice(SRC.indexOf('async function startGoogleResearch'));
  assert.match(startFn, /orchMutate[\s\S]*\/api\/agent-orchestrator\/research\/runs/, 'start uses orchMutate POST to research runs');
});

test('AgentOrchestrator Google research uses user_integrations credential ref', () => {
  assert.match(
    SRC,
    /google_research:\s*"user_integrations"/,
    'google_research credential ref is user_integrations',
  );
  const block = googleResearchBlock();
  assert.doesNotMatch(
    block,
    /access_token|client_secret|Authorization|type="password"|type="url"/i,
    'Google research card must not expose token, secret, or URL inputs',
  );
});

test('AgentOrchestrator Google research requests google platform', () => {
  const startFn = SRC.slice(SRC.indexOf('async function startGoogleResearch'));
  assert.match(startFn, /requested_platforms:\s*\["google"\]/, 'requested_platforms includes google');
});

test('AgentOrchestrator Google research honesty copy for live vs fixture', () => {
  assert.match(
    SRC,
    /Fixture \/ not live Google data/,
    'fixture honesty label exists',
  );
  assert.match(
    SRC,
    /Live Google Ads Transparency \(DataForSEO\) response/,
    'live honesty label exists',
  );
});

test('AgentOrchestrator Google research start is permission-gated', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.workflows\.approve\.research_execution"\)/,
    'start Google research gated by research_execution approval permission',
  );
  const block = googleResearchBlock();
  assert.match(block, /canStartResearch/, 'start button wrapped in permission flag');
});

test('AgentOrchestrator Google research cancel uses orchestrator.workflows.cancel when running', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.workflows\.cancel"\)/,
    'research cancel gated by orchestrator.workflows.cancel',
  );
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs\/\$\{googleResearchRun\.id\}\/cancel/,
    'cancel POST path includes run id',
  );
});

test('AgentOrchestrator Google research poll inspects r.ok before setGoogleResearchRun', () => {
  const pollMarker = 'setGoogleResearchRun(r.run)';
  const pollIdx = SRC.indexOf(pollMarker);
  assert.ok(pollIdx >= 0, 'google research poll updates run state');
  const pollStart = SRC.lastIndexOf('const poll = async () => {', pollIdx);
  const pollEnd = SRC.indexOf('const iv = setInterval(poll', pollStart);
  const pollSrc = SRC.slice(pollStart, pollEnd);
  assert.match(pollSrc, /\br\.ok\b/, 'poll inspects r.ok');
  const okIdx = pollSrc.search(/\br\.ok\b/);
  const setIdx = pollSrc.indexOf('setGoogleResearchRun');
  assert.ok(setIdx >= 0, 'poll updates google research run state');
  assert.ok(okIdx < setIdx, 'r.ok checked before setGoogleResearchRun');
});

test('AgentOrchestrator Google research copy disclaims token and ATC URL entry', () => {
  const block = googleResearchBlock();
  assert.match(
    block,
    /does not accept tokens/i,
    'copy states form does not accept tokens',
  );
  assert.match(
    block,
    /DataForSEO/,
    'copy references DataForSEO platform credentials',
  );
});

test('AgentOrchestrator rollout banner notes Meta and Google live, TikTok fixture-only', () => {
  assert.match(
    SRC,
    /DataForSEO/,
    'banner mentions DataForSEO for live Google research',
  );
  assert.match(
    SRC,
    /TikTok research[\s\S]*fixture-only/i,
    'banner notes TikTok remains fixture-only',
  );
});
