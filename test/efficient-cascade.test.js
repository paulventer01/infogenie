// test/efficient-cascade.test.js — fast/strong plan + escalate gates
const { test } = require('node:test');
const assert = require('node:assert');

const {
  resolveCascadePlan,
  applyPlanToOpts,
  shouldEscalate,
  cascadeStatus,
  FAST_SURFACES,
  STRONG_SURFACES,
} = require('../services/ai/efficient_cascade');

test('social_self_heal resolves to fast tier', () => {
  const p = resolveCascadePlan({ category: 'writing', surface: 'social_self_heal' });
  assert.equal(p.tier, 'fast');
  assert.equal(p.useAutoclaw, false);
  assert.ok(p.contextLimit <= 4);
  assert.ok(p.max_tokens <= 600);
  assert.equal(p.escalate_default, true);
});

test('analysis / autoclaw surfaces resolve to strong', () => {
  const a = resolveCascadePlan({ category: 'analysis', surface: 'autoclaw' });
  assert.equal(a.tier, 'strong');
  assert.equal(a.useAutoclaw, true);
  assert.ok(a.contextLimit >= 6);

  const s = resolveCascadePlan({ category: 'writing', surface: 'strategic_intelligence', tier: 'auto' });
  assert.equal(s.tier, 'strong');
});

test('explicit tier overrides surface default', () => {
  const p = resolveCascadePlan({ category: 'analysis', surface: 'autoclaw', tier: 'fast' });
  assert.equal(p.tier, 'fast');
});

test('applyPlanToOpts does not clobber explicit opts', () => {
  const plan = resolveCascadePlan({ surface: 'social_self_heal' });
  const out = applyPlanToOpts({ model: 'custom-mini', max_tokens: 99, useAutoclaw: true }, plan);
  assert.equal(out.model, 'custom-mini');
  assert.equal(out.max_tokens, 99);
  assert.equal(out.useAutoclaw, true);
  assert.equal(out._cascade.tier, 'fast');
});

test('shouldEscalate on empty / short / refusal', () => {
  assert.equal(shouldEscalate(null), true);
  assert.equal(shouldEscalate({ content: '' }), true);
  assert.equal(shouldEscalate({ content: 'ok' }, { minChars: 8 }), true);
  assert.equal(shouldEscalate({ content: "I'm sorry, I cannot help with that." }), true);
  assert.equal(shouldEscalate({ content: 'Here is a solid rewritten caption for LinkedIn.' }), false);
});

test('shouldEscalate respects predicate and force', () => {
  assert.equal(shouldEscalate({ content: 'long enough text here' }, { force: true }), true);
  assert.equal(
    shouldEscalate({ content: 'long enough text here' }, { predicate: () => false }),
    false,
  );
  assert.equal(
    shouldEscalate({ content: 'rewritten caption ready' }, { predicate: (r) => /caption/i.test(r.content) }),
    true,
  );
});

test('cascadeStatus reports ready with surface lists', () => {
  const s = cascadeStatus();
  assert.equal(s.ready, true);
  assert.ok(s.fast_model);
  assert.ok(s.strong_model);
  assert.ok(s.fast_surfaces.includes('social_self_heal'));
  assert.ok(s.strong_surfaces.includes('autoclaw'));
  assert.ok(FAST_SURFACES.has('social_inbox_triage'));
  assert.ok(STRONG_SURFACES.has('analysis'));
});

test('chatWithCascade exported from chat_router', () => {
  const router = require('../services/ai/chat_router');
  assert.equal(typeof router.chatForCategory, 'function');
  assert.equal(typeof router.chatWithCascade, 'function');
  assert.equal(typeof router.cascadeStatus, 'function');
});
