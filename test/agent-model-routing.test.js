'use strict';
// test/agent-model-routing.test.js — lock v1 model pins and simplified workflow routing.
//
// Structural only: reads `.cursor/rules/*.mdc` and optional `.cursor/agents/*.md`.
// Does not call model providers or log secrets.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const OPTIONAL_SPECIALIST_PINS = {
  'infogenie-lead.md': { model: 'inherit' },
  'frontend.md': { model: 'composer-2.5' },
  'backend.md': { model: 'composer-2.5' },
  'database.md': { model: 'composer-2.5' },
  'integrations.md': { model: 'composer-2.5' },
  'ai-llm.md': { model: 'cursor-grok-4.6-high-fast' },
  'security.md': { model: 'claude-opus-5-thinking-high' },
  'qa.md': { model: 'gpt-5.6-sol-high' },
  'reviewer.md': { model: 'claude-opus-5-thinking-high' },
};

const ESCALATION_TRIGGERS = [
  'complex architecture or refactoring',
  'difficult debugging',
  'high-risk financial/business logic',
  'complex database migrations or data integrity',
  'concurrency or performance-sensitive backend work',
  'complex third-party API/OAuth behavior',
  'unusually large cross-domain implementation',
];

const STRONGER_LADDER = [
  'cursor-grok-4.6-high-fast',
  'claude-sonnet-5-thinking-high',
  'gpt-5.6-sol-high',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, 'missing YAML frontmatter');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].trim();
    out[kv[1]] = raw === 'true' ? true : raw === 'false' ? false : raw;
  }
  return out;
}

function assertPinRow(rule11, rolePattern, model, absolute) {
  const abs = absolute ? 'yes' : 'no';
  assert.match(
    rule11,
    new RegExp(`\\|\\s*${rolePattern}\\s*\\|\\s*${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*${abs}\\s*\\|`),
  );
}

test('v1 frontmatter pins remain available on optional specialist definitions', () => {
  for (const [file, spec] of Object.entries(OPTIONAL_SPECIALIST_PINS)) {
    const fm = parseFrontmatter(read(path.join('.cursor', 'agents', file)));
    assert.strictEqual(fm.model, spec.model, `${file} model pin`);
    if (file === 'reviewer.md') {
      assert.strictEqual(fm.readonly, true, 'reviewer stays readonly');
    }
  }
});

test('rule 11 publishes simplified default pins and marks Composer as not absolute', () => {
  const rule11 = read('.cursor/rules/11-model-routing.mdc');
  assert.match(rule11, /alwaysApply:\s*true/);
  assert.match(rule11, /must not be an absolute assignment/);
  assert.match(rule11, /Complexity\/risk escalation/);
  assertPinRow(rule11, 'coding agent \\(default\\)', 'composer-2.5', false);
  assertPinRow(rule11, 'ai-llm work', 'cursor-grok-4.6-high-fast', true);
  assertPinRow(rule11, 'security review', 'claude-opus-5-thinking-high', true);
  assertPinRow(rule11, 'Security/QA review \\(default\\)', 'gpt-5.6-sol-high', true);
});

test('Composer 2.5 is the normal coding model but escalation remains available', () => {
  const rule11 = read('.cursor/rules/11-model-routing.mdc');
  const workflow = read('.cursor/rules/development-workflow.mdc');

  assert.match(rule11, /composer-2\.5/);
  assert.match(workflow, /one coding agent/i);

  for (const trigger of ESCALATION_TRIGGERS) {
    assert.ok(rule11.includes(trigger), `rule 11 missing escalation trigger: ${trigger}`);
  }

  for (const slug of STRONGER_LADDER) {
    assert.ok(rule11.includes(slug), `rule 11 missing stronger-model ladder slug ${slug}`);
  }
  assert.match(rule11, /ESCALATION REASON/);
});

test('Security/QA review stays independent from implementers when a separate reviewer is available', () => {
  const rule11 = read('.cursor/rules/11-model-routing.mdc');
  const workflow = read('.cursor/rules/development-workflow.mdc');

  assert.match(rule11, /different provider family from the implementer/);
  assert.match(rule11, /gemini-3\.7-flash-high/);
  assert.match(rule11, /gpt-5\.6-luna-high/);
  assert.match(rule11, /claude-opus-5-thinking-high/);
  assert.match(workflow.replace(/\s+/g, ' '), /Security\/QA review/i);
  assert.match(
    read('.cursor/rules/08-agent-routing.mdc'),
    /disclose that it was not independent/,
  );
  assert.match(rule11, /Complex OAuth still requires a \*\*Security\*\* review pass/i);
  assert.match(read('.cursor/rules/08-agent-routing.mdc'), /auth, permissions, tenant isolation, credentials, OAuth, or encryption/);
});

test('handoff and PR workflow record the model used and forbid auto-merge', () => {
  const handoff = read('.cursor/rules/09-agent-handoff.mdc');
  const pr = read('.cursor/rules/10-agent-pr-workflow.mdc');
  const rule11 = read('.cursor/rules/11-model-routing.mdc');

  assert.match(handoff, /^MODEL:/m);
  assert.match(handoff, /^MODEL SOURCE:/m);
  assert.match(handoff, /^ESCALATION REASON:/m);
  assert.match(pr, /MODEL \/ MODEL SOURCE \/ ESCALATION REASON/);
  assert.match(pr, /Do not merge the PR or enable auto-merge/);
  assert.match(rule11, /Merging PRs or enabling auto-merge/);
  assert.doesNotMatch(rule11, /model:\s+auto\b/);
  assert.doesNotMatch(rule11, /gpt-5.*codex/i);
  assert.match(rule11, /Never log or commit API keys/);
});

test('ownership boundaries and enforcement controls remain unchanged by model routing', () => {
  const routing = read('.cursor/rules/08-agent-routing.mdc');
  const security = read('.cursor/agents/security.md');
  const frontend = read('.cursor/agents/frontend.md');

  assert.match(routing, /PERMISSION_ENFORCEMENT/);
  assert.match(routing, /Security review coverage is \*\*mandatory\*\*/);
  assert.match(frontend, /Do not touch `db\.js` or `schema\.js`/);
  assert.match(security, /Never weaken/);
  assert.match(security, /PERMISSION_ENFORCEMENT/);
  assert.doesNotMatch(routing, /PERMISSION_ENFORCEMENT\s*=\s*off/);
});
