'use strict';
// test/agent-system.test.js — structural lock for the Cursor agent system.
//
// Ensures specialist files, routing rules, and the simplified workflow stay
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
  'development-workflow.mdc',
  '08-agent-routing.mdc',
  '09-agent-handoff.mdc',
  '10-agent-pr-workflow.mdc',
  '11-model-routing.mdc',
];

const OPTIONAL_COMPLETION_FIELDS = [
  'STATUS',
  'TASK',
  'FILES CHANGED',
  'TESTS',
  'REVIEW',
  'REASON',
  'RISKS',
  'MODEL',
  'MODEL SOURCE',
  'ESCALATION REASON',
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
  }
});

test('routing, handoff, and PR workflow rules exist and do not override 01–07', () => {
  for (const file of RULE_FILES) {
    const rel = path.join('.cursor', 'rules', file);
    const src = read(rel);
    assert.match(src, /alwaysApply:\s*true/, `${rel} should be always-on routing`);
    if (file !== 'development-workflow.mdc') {
      assert.match(src, /01/, `${rel} must defer to existing rules 01–07`);
    }
  }

  const workflow = read('.cursor/rules/development-workflow.mdc');
  assert.match(workflow.replace(/\s+/g, ' '), /Security\/QA review/i);
  assert.match(workflow, /required hosted CI/i);
  assert.match(workflow, /Never merge or deploy without explicit user authorization/);

  const routing = read('.cursor/rules/08-agent-routing.mdc');
  assert.match(routing, /PERMISSION_ENFORCEMENT/);
  assert.match(routing, /development-workflow\.mdc/);
  assert.doesNotMatch(
    routing,
    /PERMISSION_ENFORCEMENT\s*=\s*off/,
    'routing must not instruct turning PERMISSION_ENFORCEMENT off',
  );

  const pr = read('.cursor/rules/10-agent-pr-workflow.mdc');
  assert.match(pr, /main/);
  assert.match(pr, /Security\/QA review/i);
  assert.match(pr, /do not merge|Agents do not merge|Do not merge the PR/i);
  assert.match(pr, /auto-merge/);
  assert.match(pr, /feature branch/i);
});

test('optional completion format fields are defined in rule 09', () => {
  const handoff = read('.cursor/rules/09-agent-handoff.mdc');
  assert.match(handoff, /Mandatory multi-agent handoffs.*removed/i);
  for (const field of OPTIONAL_COMPLETION_FIELDS) {
    assert.match(
      handoff,
      new RegExp(`^${field}: `, 'm'),
      `09-agent-handoff.mdc missing ${field}: line`,
    );
  }
});

test('Security/QA review is required for sensitive areas; enforcement is not weakened', () => {
  const workflow = read('.cursor/rules/development-workflow.mdc');
  const routing = read('.cursor/rules/08-agent-routing.mdc');
  const security = read('.cursor/agents/security.md');

  assert.match(workflow.replace(/\s+/g, ' '), /Security\/QA review/i);
  assert.match(routing, /auth, permissions, tenant isolation, credentials, OAuth, or encryption/i);
  assert.match(security, /must not weaken|Do not weaken|Never weaken/i);
  assert.match(security, /PERMISSION_ENFORCEMENT/);
  for (const domain of [
    'Auth',
    'Permissions',
    'Tenant isolation',
    'Credentials',
    'OAuth security',
    'Encryption reviews',
  ]) {
    assert.match(security, new RegExp(domain, 'i'), `security.md must own ${domain}`);
  }
  assert.doesNotMatch(security, /set PERMISSION_ENFORCEMENT to off/i);
});

test('Frontend path guidance still refuses database ownership', () => {
  const frontend = read('.cursor/agents/frontend.md');
  assert.match(frontend, /Do not touch `db\.js` or `schema\.js`/);
  assert.match(frontend, /correct specialist is database/);
  assert.match(frontend, /db\.js/);
  assert.match(frontend, /Prohibited/);

  const routing = read('.cursor/rules/08-agent-routing.mdc');
  assert.match(routing, /Database.*db\.js/);
});

test('PR workflow is You → Coding agent → Security/QA review → PR → You approve → main', () => {
  const pr = read('.cursor/rules/10-agent-pr-workflow.mdc');
  const workflow = read('.cursor/rules/development-workflow.mdc');
  assert.match(
    pr,
    /You → Coding agent → Security\/QA review → PR → You approve → main/,
  );
  assert.match(workflow, /human approval/i);
});

test('AGENTS.md points at the agent system without dropping 01–07', () => {
  const agentsMd = read('AGENTS.md');
  assert.match(agentsMd, /\.cursor\/agents/);
  assert.match(agentsMd, /08/);
  assert.match(agentsMd, /PERMISSION_ENFORCEMENT/);
  assert.match(agentsMd, /New UI goes in React/);
});
