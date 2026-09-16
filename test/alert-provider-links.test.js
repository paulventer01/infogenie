'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enrichAlert, getProvider, clientMap } = require('../services/assistant_ops/provider_links');

test('enrichAlert adds DataForSEO billing link for credit_low', () => {
  const a = enrichAlert({
    id: 'x', type: 'credit_low', severity: 'high',
    title: 'Low balance', body: 'Top up',
  }, 'DATAFORSEO_LOGIN');
  assert.match(a.actionUrl, /dataforseo\.com\/billing/i);
  assert.match(a.actionLabel, /Top up DataForSEO/i);
});

test('enrichAlert adds signup link for service_missing', () => {
  const a = enrichAlert({
    id: 'x', type: 'service_missing', severity: 'high',
    title: 'Missing OpenAI', body: 'Add key',
  }, 'OPENAI_API_KEY');
  assert.match(a.actionUrl, /platform\.openai\.com/i);
  assert.match(a.settingsUrl, /platform-keys/);
});

test('clientMap exposes provider names without secrets', () => {
  const map = clientMap();
  assert.ok(map.DATAFORSEO_LOGIN.name);
  assert.ok(map.DATAFORSEO_LOGIN.billingUrl);
});

test('getProvider resolves aliases', () => {
  assert.equal(getProvider('AI_INTEGRATIONS_OPENAI_API_KEY').name, 'OpenAI');
});
