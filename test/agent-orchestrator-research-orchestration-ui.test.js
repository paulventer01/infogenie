'use strict';
// Source-audit lock for Agent Orchestrator cross-platform research UI (PR3C).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
  'utf8',
);

function orchResearchBlock() {
  const start = SRC.indexOf('>Cross-platform research</h5>');
  assert.ok(start >= 0, 'Cross-platform research card heading exists');
  const end = SRC.indexOf('Approval history', start);
  assert.ok(end > start, 'Cross-platform card precedes approval history');
  return SRC.slice(start, end);
}

test('AgentOrchestrator orchestration saves plan via PUT /api/agent-orchestrator/research/plans', () => {
  const fn = SRC.slice(SRC.indexOf('async function saveResearchPlan'));
  assert.match(fn, /\/api\/agent-orchestrator\/research\/plans/, 'save uses research plans PUT path');
  assert.match(fn, /orchMutate[\s\S]*"PUT"/, 'save uses orchMutate PUT');
});

test('AgentOrchestrator orchestration POST /runs includes plan_hash and user_integrations refs', () => {
  const fn = SRC.slice(SRC.indexOf('async function startOrchestratedResearch'));
  assert.match(fn, /plan_hash:\s*planHash/, 'start run includes plan_hash');
  const refsFn = SRC.slice(SRC.indexOf('function orchCredentialRefs'));
  assert.match(refsFn, /meta_research:\s*"user_integrations"/, 'meta_research ref');
  assert.match(refsFn, /google_research:\s*"user_integrations"/, 'google_research ref');
  assert.match(refsFn, /tiktok_research:\s*"user_integrations"/, 'tiktok_research ref');
});

test('AgentOrchestrator orchestration start gated by research_execution', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.workflows\.approve\.research_execution"\)/,
    'orchestrated start gated by research_execution',
  );
  const block = orchResearchBlock();
  assert.match(block, /canStartResearch/, 'start button wrapped in canStartResearch');
});

test('AgentOrchestrator orchestration cancel and continue paths', () => {
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs\/\$\{orchRun\.id\}\/cancel/,
    'cancel path uses orchRun id',
  );
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs\/\$\{orchRun\.id\}\/continue/,
    'continue path uses orchRun id',
  );
  assert.match(SRC, /can\("orchestrator\.workflows\.cancel"\)/, 'cancel gated by workflows.cancel');
});

test('AgentOrchestrator orchestration poll inspects r.ok before setOrchRun', () => {
  const pollIdx = SRC.indexOf('setOrchRun(r.run)');
  assert.ok(pollIdx >= 0, 'orchestration poll updates run state');
  const pollStart = SRC.lastIndexOf('const poll = async () => {', pollIdx);
  const pollEnd = SRC.indexOf('const iv = setInterval(poll', pollStart);
  const pollSrc = SRC.slice(pollStart, pollEnd);
  assert.match(pollSrc, /\br\.ok\b/, 'poll inspects r.ok');
  const okIdx = pollSrc.search(/\br\.ok\b/);
  const setIdx = pollSrc.indexOf('setOrchRun');
  assert.ok(okIdx < setIdx, 'r.ok checked before setOrchRun');
});

test('AgentOrchestrator orchestration honesty copy for fixture vs live', () => {
  assert.match(SRC, /Fixture \/ not live vendor data/, 'fixture orchestration honesty label');
  assert.match(SRC, /Live vendor research/, 'live orchestration honesty label');
});

test('AgentOrchestrator orchestration card has no password token or URL inputs', () => {
  const block = orchResearchBlock();
  assert.doesNotMatch(
    block,
    /access_token|client_secret|type="password"|type="url"/i,
    'orchestration card must not expose token secret password or URL inputs',
  );
});

test('AgentOrchestrator orchestration shows partially_completed and platform progress wording', () => {
  assert.match(SRC, /partially_completed/, 'partially_completed outcome referenced');
  assert.match(SRC, /platformProgressLine/, 'platform progress summary helper');
  assert.match(SRC, /platform_progress/, 'platform_progress field used');
});
