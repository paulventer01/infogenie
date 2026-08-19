'use strict';
// test/agent-model-routing.test.js — lock v1 specialist model pins and Lead escalation.
//
// Structural only: reads `.cursor/agents/*.md` frontmatter and rules 09–11.
// Does not call model providers or log secrets.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const V1_PINS = {
  'infogenie-lead.md': { model: 'inherit', absolute: true },
  'frontend.md': { model: 'composer-2.5', absolute: false },
  'backend.md': { model: 'composer-2.5', absolute: false },
  'database.md': { model: 'composer-2.5', absolute: false },
  'integrations.md': { model: 'composer-2.5', absolute: false },
  'ai-llm.md': { model: 'cursor-grok-4.6-high-fast', absolute: true },
  'security.md': { model: 'claude-opus-5-thinking-high', absolute: true },
  'qa.md': { model: 'gpt-5.6-sol-high', absolute: true },
  'reviewer.md': { model: 'claude-opus-5-thinking-high', absolute: true },
};

const COMPOSER_IMPLEMENTERS = ['frontend.md', 'backend.md', 'database.md', 'integrations.md'];

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

function pinRow(rule11, specialist, model, absolute) {
  const abs = absolute ? (specialist === 'infogenie-lead' ? 'inherit-only' : 'yes') : 'no';
  const re = new RegExp(
    `\\|\\s*${specialist}\\s*\\|\\s*${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*${abs}\\s*\\|`,
  );
  assert.match(rule11, re, `rule 11 missing v1 pin row for ${specialist} → ${model} (${abs})`);
}

test('v1 frontmatter pins match the approved model-routing matrix', () => {
  for (const [file, spec] of Object.entries(V1_PINS)) {
    const fm = parseFrontmatter(read(path.join('.cursor', 'agents', file)));
    assert.strictEqual(fm.model, spec.model, `${file} model pin`);
    if (file === 'reviewer.md') {
      assert.strictEqual(fm.readonly, true, 'reviewer stays readonly');
    }
  }
});

test('rule 11 publishes the same v1 default pins and marks Composer as not absolute', () => {
  const rule11 = read('.cursor/rules/11-model-routing.mdc');
  assert.match(rule11, /alwaysApply:\s*true/);
  assert.match(rule11, /must not be an absolute assignment/);
  assert.match(rule11, /Lead-controlled complexity\/risk escalation/);
  pinRow(rule11, 'infogenie-lead', 'inherit', true);
  pinRow(rule11, 'frontend', 'composer-2.5', false);
  pinRow(rule11, 'backend', 'composer-2.5', false);
  pinRow(rule11, 'database', 'composer-2.5', false);
  pinRow(rule11, 'integrations', 'composer-2.5', false);
  pinRow(rule11, 'ai-llm', 'cursor-grok-4.6-high-fast', true);
  pinRow(rule11, 'security', 'claude-opus-5-thinking-high', true);
  pinRow(rule11, 'qa', 'gpt-5.6-sol-high', true);
  pinRow(rule11, 'reviewer', 'claude-opus-5-thinking-high', true);
});

test('Composer 2.5 is the normal implementer model but Lead may escalate', () => {
  const rule11 = read('.cursor/rules/11-model-routing.mdc');
  const lead = read('.cursor/agents/infogenie-lead.md');

  for (const file of COMPOSER_IMPLEMENTERS) {
    const src = read(path.join('.cursor', 'agents', file));
    assert.match(src, /not an absolute assignment/);
    assert.match(src, /composer-2\.5/);
    assert.match(src, /11-model-routing|rule 11/);
  }

  assert.match(lead, /must not be an absolute assignment/);
  assert.match(lead, /model: inherit/);

  for (const trigger of ESCALATION_TRIGGERS) {
    assert.ok(rule11.includes(trigger), `rule 11 missing escalation trigger: ${trigger}`);
    assert.ok(lead.includes(trigger), `Lead missing escalation trigger: ${trigger}`);
  }

  for (const slug of STRONGER_LADDER) {
    assert.ok(rule11.includes(slug), `rule 11 missing stronger-model ladder slug ${slug}`);
  }
  assert.match(rule11, /ESCALATION REASON/);
  assert.match(rule11, /lead-override/);
});

test('QA and Reviewer stay independent of implementers; Reviewer splits from Security Opus', () => {
  const rule11 = read('.cursor/rules/11-model-routing.mdc');
  const lead = read('.cursor/agents/infogenie-lead.md');
  const qa = read('.cursor/agents/qa.md');
  const reviewer = read('.cursor/agents/reviewer.md');

  assert.notStrictEqual(V1_PINS['qa.md'].model, V1_PINS['frontend.md'].model);
  assert.notStrictEqual(V1_PINS['qa.md'].model, V1_PINS['ai-llm.md'].model);
  assert.notStrictEqual(V1_PINS['reviewer.md'].model, V1_PINS['qa.md'].model);
  assert.notStrictEqual(V1_PINS['reviewer.md'].model, V1_PINS['frontend.md'].model);

  assert.match(qa, /different provider family from the implementer/);
  assert.match(rule11, /gemini-3\.7-flash-high/);
  assert.match(rule11, /gpt-5\.6-luna-high/);
  assert.match(lead, /gpt-5\.6-sol-high/);
  assert.match(reviewer, /gpt-5\.6-sol-xhigh/);
  assert.match(rule11, /Reviewer switches to `gpt-5\.6-sol-xhigh`/);
  assert.match(lead, /If Security already used Opus on the same change/);
  assert.match(rule11, /Complex OAuth still requires a separate \*\*Security\*\* review/);
});

test('handoff and PR workflow record the model used at every stage and forbid auto-merge', () => {
  const handoff = read('.cursor/rules/09-agent-handoff.mdc');
  const pr = read('.cursor/rules/10-agent-pr-workflow.mdc');
  const rule11 = read('.cursor/rules/11-model-routing.mdc');

  assert.match(handoff, /^MODEL:/m);
  assert.match(handoff, /^MODEL SOURCE:/m);
  assert.match(handoff, /^ESCALATION REASON:/m);
  assert.match(handoff, /frontmatter \| lead-override \| inherit \| cursor-fallback/);
  assert.match(pr, /MODEL \/ MODEL SOURCE \/ ESCALATION REASON/);
  assert.match(pr, /Do not merge the PR or enable auto-merge/);
  assert.match(rule11, /Merging PRs or enabling auto-merge/);
  assert.doesNotMatch(rule11, /model:\s+auto\b/);
  assert.doesNotMatch(rule11, /gpt-5.*codex/i);
  assert.match(rule11, /Never log or commit API keys/);
});

test('ownership boundaries are unchanged by model routing', () => {
  const routing = read('.cursor/rules/08-agent-routing.mdc');
  const lead = read('.cursor/agents/infogenie-lead.md');
  const frontend = read('.cursor/agents/frontend.md');
  const security = read('.cursor/agents/security.md');

  assert.match(routing, /never fold into Backend/);
  assert.match(lead, /separate agent from day one/);
  assert.match(frontend, /correct specialist is database/);
  assert.match(security, /Never weaken/);
  assert.match(security, /PERMISSION_ENFORCEMENT/);
  assert.doesNotMatch(lead, /PERMISSION_ENFORCEMENT\s*=\s*off/);
});
