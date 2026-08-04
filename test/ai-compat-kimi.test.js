// test/ai-compat-kimi.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeChatParams,
  isKimi,
  isMoonshotBaseUrl,
  isGpt5,
} = require('../services/ai_compat');

describe('Kimi / Moonshot chat param normalization', () => {
  it('detects kimi-k3 and moonshot URLs', () => {
    assert.equal(isKimi('kimi-k3'), true);
    assert.equal(isKimi('gpt-4o'), false);
    assert.equal(isMoonshotBaseUrl('https://api.moonshot.ai/v1'), true);
    assert.equal(isMoonshotBaseUrl('https://api.openai.com/v1'), false);
  });

  it('omits fixed sampling params and maps max_tokens', () => {
    const out = normalizeChatParams({
      model: 'kimi-k3',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 400,
      temperature: 0.7,
      top_p: 0.9,
      presence_penalty: 0.5,
      frequency_penalty: 0.2,
    });
    assert.equal(out.max_completion_tokens, 400);
    assert.equal(out.max_tokens, undefined);
    assert.equal(out.temperature, undefined);
    assert.equal(out.top_p, undefined);
    assert.equal(out.presence_penalty, undefined);
    assert.equal(out.frequency_penalty, undefined);
    assert.equal(out.reasoning_effort, 'high');
  });

  it('respects explicit reasoning_effort', () => {
    const out = normalizeChatParams({
      model: 'kimi-k3',
      messages: [],
      reasoning_effort: 'low',
    });
    assert.equal(out.reasoning_effort, 'low');
  });

  it('forces kimi rules when baseUrl is moonshot even if model string is custom', () => {
    const out = normalizeChatParams(
      { model: 'custom-deploy', max_tokens: 100, temperature: 0.2 },
      { baseUrl: 'https://api.moonshot.ai/v1' },
    );
    assert.equal(out.max_completion_tokens, 100);
    assert.equal(out.temperature, undefined);
    assert.ok(out.reasoning_effort);
  });

  it('still normalizes gpt-5 separately', () => {
    assert.equal(isGpt5('gpt-5-mini'), true);
    const out = normalizeChatParams({
      model: 'gpt-5-mini',
      max_tokens: 200,
      temperature: 0.3,
    });
    assert.equal(out.max_completion_tokens, 200);
    assert.equal(out.reasoning_effort, 'minimal');
    assert.equal(out.temperature, undefined);
  });
});
