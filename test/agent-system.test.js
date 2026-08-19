'use strict';
// test/agent-system.test.js — structural lock for the Cursor multi-agent system.
//
// Ensures specialist files, routing rules, and the required handoff fields stay
// present. Does not encode product behavior (tenant, permission matrix, honesty);
// those remain in .cursor/rules/01–07.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const AGENT_FILES = [
  'infogenie-lead.md',
  'frontend.md',
  'backend.md',
  'database.md',
  'integrations.md',
  'ai-llm.md',
  'security.md',
  'qa.md',
  'reviewer.md',
];

const RULE_FILES = [
  '08-agent-routing.mdc',
  '09-agent-handoff.mdc',
  '10-agent-pr-workflow.mdc',
];

const HANDOFF_FIELDS = [
  'STATUS',
  'TASK',
  'FILES CHANGED',
  'TESTS',
  'HANDOFF REQUIRED',
  'TARGET AGENT',
  'REASON',
  'RISKS',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('Cursor specialist agent files exist with ownership and bounce rules', () => {
  for (const file of AGENT_FILES) {
    const rel = path.join('.cursor', 'agents', file);
    const src = read(rel);
    assert.ok(src.length > 200, `${rel} is too short`);
    assert.match(src, /^---\n(?:.|\n)*?name:\s+\S+/m, `${rel} needs YAML name`);
    assert.match(src, /## (?:Responsibilities|Owns)/, `${rel} needs responsibilities/owns`);
    assert.match(src, /## Prohibited/, `${rel} needs prohibited areas`);
    assert.match(src, /infogenie-lead/, `${rel} must mention bounce/Lead`);
    if (file !== 'infogenie-lead.md') {
      assert.match(src, /HANDOFF REQUIRED/, `${rel} must include the handoff block`);
    }
  }
});

test('routing, handoff, and PR workflow rules exist and do not override 01–07', () => {
  for (const file of RULE_FILES) {
    const rel = path.join('.cursor', 'rules', file);
    const src = read(rel);
    assert.match(src, /alwaysApply:\s*true/, `${rel} should be always-on routing`);
    assert.match(src, /01/, `${rel} must defer to existing rules 01–07`);
  }

  const routing = read('.cursor/rules/08-agent-routing.mdc');
  assert.match(routing, /PERMISSION_ENFORCEMENT/);
  assert.match(routing, /infogenie-lead/);
  assert.doesNotMatch(
    routing,
    /PERMISSION_ENFORCEMENT\s*=\s*off/,
    'routing must not instruct turning PERMISSION_ENFORCEMENT off',
  );

  const pr = read('.cursor/rules/10-agent-pr-workflow.mdc');
  assert.match(pr, /main/);
  assert.match(pr, /QA/i);
  assert.match(pr, /reviewer/i);
});

test('standard handoff format fields are defined once and used by specialists', () => {
  const handoff = read('.cursor/rules/09-agent-handoff.mdc');
  for (const field of HANDOFF_FIELDS) {
    assert.ok(handoff.includes(field), `09-agent-handoff.mdc missing ${field}`);
  }

  const specialists = AGENT_FILES.filter((f) => f !== 'infogenie-lead.md');
  for (const file of specialists) {
    const src = read(path.join('.cursor', 'agents', file));
    for (const field of HANDOFF_FIELDS) {
      assert.ok(src.includes(field), `${file} missing handoff field ${field}`);
    }
  }
});

test('Lead decomposes; QA is independent; Reviewer is pre-merge; Security does not weaken enforcement', () => {
  const lead = read('.cursor/agents/infogenie-lead.md');
  assert.match(lead, /decompos/i);
  assert.match(lead, /does not implement|Do not implement/i);

  const qa = read('.cursor/agents/qa.md');
  assert.match(qa, /independent/i);
  assert.match(qa, /not.*implementing agent|Do not implement/i);

  const reviewer = read('.cursor/agents/reviewer.md');
  assert.match(reviewer, /readonly:\s*true/);
  assert.match(reviewer, /before merge/i);

  const security = read('.cursor/agents/security.md');
  assert.match(security, /must not weaken|Do not weaken|Never weaken/i);
  assert.match(security, /PERMISSION_ENFORCEMENT/);
  assert.doesNotMatch(security, /set PERMISSION_ENFORCEMENT to off/i);
});

test('AGENTS.md points at the agent system without dropping 01–07', () => {
  const agentsMd = read('AGENTS.md');
  assert.match(agentsMd, /\.cursor\/agents/);
  assert.match(agentsMd, /08/);
  assert.match(agentsMd, /PERMISSION_ENFORCEMENT/);
  assert.match(agentsMd, /New UI goes in React/);
});
