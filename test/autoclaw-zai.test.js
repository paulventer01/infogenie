// test/autoclaw-zai.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ENDPOINTS, getEndpoint, configuredEndpointMode } = require('../services/autoclaw/zai_client');

describe('AutoClaw Z.ai client', () => {
  it('exposes coding global endpoint for AutoClaw', () => {
    const ep = getEndpoint('zai-coding-global');
    assert.equal(ep.baseUrl, 'https://api.z.ai/api/coding/paas/v4');
    assert.equal(ep.defaultModel, 'glm-5.2');
  });

  it('maps coding alias endpoint mode', () => {
    const prev = process.env.ZAI_ENDPOINT_MODE;
    process.env.ZAI_ENDPOINT_MODE = 'coding';
    assert.equal(configuredEndpointMode(), 'zai-coding-global');
    process.env.ZAI_ENDPOINT_MODE = prev;
  });

  it('lists all four Z.ai endpoint surfaces', () => {
    assert.equal(Object.keys(ENDPOINTS).length, 4);
  });
});
