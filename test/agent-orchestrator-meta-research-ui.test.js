'use strict';
// Source-audit lock for Agent Orchestrator Meta research UI (PR3B-2).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
  'utf8',
);

function metaResearchBlock() {
  const start = SRC.indexOf('Meta research');
  assert.ok(start >= 0, 'Meta research card heading exists');
  const end = SRC.indexOf('Approval history', start);
  assert.ok(end > start, 'Meta research card precedes approval history');
  return SRC.slice(start, end);
}

test('AgentOrchestrator Meta research uses POST /api/agent-orchestrator/research/runs', () => {
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs/,
    'research runs API path is referenced',
  );
  const startFn = SRC.slice(SRC.indexOf('async function startMetaResearch'));
  assert.match(startFn, /orchMutate[\s\S]*\/api\/agent-orchestrator\/research\/runs/, 'start uses orchMutate POST to research runs');
});

test('AgentOrchestrator Meta research uses user_integrations credential ref', () => {
  assert.match(
    SRC,
    /meta_research:\s*"user_integrations"/,
    'meta_research credential ref is user_integrations',
  );
  assert.doesNotMatch(
    metaResearchBlock(),
    /access_token|client_secret|Authorization/i,
    'Meta research card must not expose token or secret inputs',
  );
});

test('AgentOrchestrator Meta research honesty copy for live vs fixture', () => {
  assert.match(
    SRC,
    /Fixture \/ not live Meta data/,
    'fixture honesty label exists',
  );
  assert.match(
    SRC,
    /Live Meta Ad Library response/,
    'live honesty label exists',
  );
});

test('AgentOrchestrator Meta research start is permission-gated', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.workflows\.approve\.research_execution"\)/,
    'start Meta research gated by research_execution approval permission',
  );
  const block = metaResearchBlock();
  assert.match(block, /canStartResearch/, 'start button wrapped in permission flag');
});

test('AgentOrchestrator Meta research cancel uses orchestrator.workflows.cancel when running', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.workflows\.cancel"\)/,
    'research cancel gated by orchestrator.workflows.cancel',
  );
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs\/\$\{metaResearchRun\.id\}\/cancel/,
    'cancel POST path includes run id',
  );
});

test('AgentOrchestrator Meta research poll inspects r.ok before setMetaResearchRun', () => {
  const pollStart = SRC.indexOf('const poll = async () => {');
  assert.ok(pollStart >= 0, 'research poll callback exists');
  const pollEnd = SRC.indexOf('const iv = setInterval(poll', pollStart);
  const pollSrc = SRC.slice(pollStart, pollEnd);
  assert.match(pollSrc, /\br\.ok\b/, 'poll inspects r.ok');
  const okIdx = pollSrc.search(/\br\.ok\b/);
  const setIdx = pollSrc.indexOf('setMetaResearchRun');
  assert.ok(setIdx >= 0, 'poll updates meta research run state');
  assert.ok(okIdx < setIdx, 'r.ok checked before setMetaResearchRun');
});
