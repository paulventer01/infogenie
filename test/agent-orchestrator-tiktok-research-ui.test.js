'use strict';
// Source-audit lock for Agent Orchestrator TikTok research UI (PR3B-4).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
  'utf8',
);

function tiktokResearchBlock() {
  const start = SRC.indexOf('>TikTok research</h5>');
  assert.ok(start >= 0, 'TikTok research card heading exists');
  const end = SRC.indexOf('Approval history', start);
  assert.ok(end > start, 'TikTok research card precedes approval history');
  return SRC.slice(start, end);
}

test('AgentOrchestrator TikTok research uses POST /api/agent-orchestrator/research/runs', () => {
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs/,
    'research runs API path is referenced',
  );
  const startFn = SRC.slice(SRC.indexOf('async function startTikTokResearch'));
  assert.match(startFn, /orchMutate[\s\S]*\/api\/agent-orchestrator\/research\/runs/, 'start uses orchMutate POST to research runs');
});

test('AgentOrchestrator TikTok research uses user_integrations credential ref', () => {
  assert.match(
    SRC,
    /tiktok_research:\s*"user_integrations"/,
    'tiktok_research credential ref is user_integrations',
  );
  const block = tiktokResearchBlock();
  assert.doesNotMatch(
    block,
    /access_token|client_secret|Authorization|type="password"|type="url"/i,
    'TikTok research card must not expose token, secret, or URL inputs',
  );
});

test('AgentOrchestrator TikTok research requests tiktok platform', () => {
  const startFn = SRC.slice(SRC.indexOf('async function startTikTokResearch'));
  assert.match(startFn, /requested_platforms:\s*\["tiktok"\]/, 'requested_platforms includes tiktok');
});

test('AgentOrchestrator TikTok research honesty copy for live vs fixture', () => {
  assert.match(
    SRC,
    /Fixture \/ not live TikTok data/,
    'fixture honesty label exists',
  );
  assert.match(
    SRC,
    /Live TikTok Commercial Content Library response/,
    'live honesty label exists',
  );
});

test('AgentOrchestrator TikTok research start is permission-gated', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.workflows\.approve\.research_execution"\)/,
    'start TikTok research gated by research_execution approval permission',
  );
  const block = tiktokResearchBlock();
  assert.match(block, /canStartResearch/, 'start button wrapped in permission flag');
});

test('AgentOrchestrator TikTok research cancel uses orchestrator.workflows.cancel when running', () => {
  assert.match(
    SRC,
    /can\("orchestrator\.workflows\.cancel"\)/,
    'research cancel gated by orchestrator.workflows.cancel',
  );
  assert.match(
    SRC,
    /\/api\/agent-orchestrator\/research\/runs\/\$\{tiktokResearchRun\.id\}\/cancel/,
    'cancel POST path includes run id',
  );
});

test('AgentOrchestrator TikTok research poll inspects r.ok before setTiktokResearchRun', () => {
  const pollMarker = 'setTiktokResearchRun(r.run)';
  const pollIdx = SRC.indexOf(pollMarker);
  assert.ok(pollIdx >= 0, 'tiktok research poll updates run state');
  const pollStart = SRC.lastIndexOf('const poll = async () => {', pollIdx);
  const pollEnd = SRC.indexOf('const iv = setInterval(poll', pollStart);
  const pollSrc = SRC.slice(pollStart, pollEnd);
  assert.match(pollSrc, /\br\.ok\b/, 'poll inspects r.ok');
  const okIdx = pollSrc.search(/\br\.ok\b/);
  const setIdx = pollSrc.indexOf('setTiktokResearchRun');
  assert.ok(setIdx >= 0, 'poll updates tiktok research run state');
  assert.ok(okIdx < setIdx, 'r.ok checked before setTiktokResearchRun');
});

test('AgentOrchestrator TikTok research copy disclaims token and library URL entry', () => {
  const block = tiktokResearchBlock();
  assert.match(
    block,
    /Commercial Content Library client token/i,
    'copy references server Commercial Content client token',
  );
  assert.match(
    block,
    /actor gate/i,
    'copy describes TikTok Ads credentials as actor gate',
  );
  assert.match(
    block,
    /does not accept tokens/i,
    'copy states form does not accept tokens',
  );
  assert.match(
    block,
    /library URLs/i,
    'copy states form does not accept library URLs',
  );
  assert.doesNotMatch(
    block,
    /type="password"|TIKTOK_RESEARCH_CLIENT_TOKEN|enter.*token/i,
    'TikTok card must not prompt users to enter a client token',
  );
});

test('AgentOrchestrator TikTok research error labels for unavailable permission and rate limit', () => {
  assert.match(
    SRC,
    /Unavailable — TikTok research is not configured or not authorised/,
    'unavailable label exists',
  );
  assert.match(
    SRC,
    /Permission denied/,
    'permission denied label exists',
  );
  assert.match(
    SRC,
    /Rate limited — try again later/,
    'rate limited label exists',
  );
});

test('AgentOrchestrator rollout banner notes Meta Google and TikTok live research', () => {
  assert.match(
    SRC,
    /Meta, Google, and TikTok competitor-ad research/,
    'banner mentions Meta Google and TikTok live research',
  );
  assert.match(
    SRC,
    /Commercial Content Library client token/i,
    'banner references TikTok server Commercial Content client token',
  );
  assert.match(
    SRC,
    /no tokens entered in this form[\s\S]*actor gate/i,
    'banner states TikTok uses server token plus actor gate without form token entry',
  );
  assert.doesNotMatch(
    SRC,
    /TikTok research[\s\S]*fixture-only/i,
    'banner no longer says TikTok is fixture-only',
  );
});

test('AgentOrchestrator TikTok card does not describe fixture as live', () => {
  const block = tiktokResearchBlock();
  assert.doesNotMatch(
    block,
    /Fixture \(safe\)[\s\S]*Live TikTok data/i,
    'fixture mode radio must not claim live TikTok data',
  );
});
