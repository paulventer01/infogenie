'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STEPS, emptyPlan, stepComplete, summarize, FLOW } = require('../services/marketing_plan/steps');
const { _normalizeSteps } = require('../services/marketing_plan/api');
const { applyJourneyStatus } = require('../lib/journeyStatus');

test('catalog has 10 sequential revenue steps', () => {
  assert.equal(STEPS.length, 10);
  assert.equal(STEPS[0].key, 'goal');
  assert.equal(STEPS[9].key, 'optimization');
  assert.deepEqual(STEPS.map((s) => s.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('stepComplete requires listed fields', () => {
  const goal = STEPS.find((s) => s.id === 1);
  assert.equal(stepComplete(goal, {}), false);
  assert.equal(stepComplete(goal, { revenue_target: '$100k', customers: '1000', aov: '$100' }), true);
});

test('summarize counts completed steps', () => {
  const plan = emptyPlan();
  plan.steps['1'] = { completed: true, fields: { revenue_target: '1', customers: '2', aov: '3' } };
  const s = summarize(plan);
  assert.equal(s.total, 10);
  assert.equal(s.completed, 1);
  assert.equal(s.pct, 10);
});

test('normalizeSteps accepts chip arrays and strings', () => {
  const steps = _normalizeSteps({
    7: { fields: { channels: ['SEO', 'Email', 'LinkedIn'] }, completed: false },
  });
  assert.deepEqual(steps['7'].fields.channels, ['SEO', 'Email', 'LinkedIn']);
  assert.equal(steps['7'].completed, true);
});

test('journey rail treats marketing-plan as marketingPlan', () => {
  const merged = applyJourneyStatus(
    [{ view: 'marketing-plan', done: false }],
    { marketingPlan: true },
  );
  assert.equal(merged[0].done, true);
});

test('steps module FLOW has 10 labels', () => {
  assert.equal(FLOW.length, 10);
});
