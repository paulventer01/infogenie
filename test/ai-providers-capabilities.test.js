// test/ai-providers-capabilities.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compatibleCategories, isCompatible } = require('../services/ai_providers/capabilities');

describe('AI provider category compatibility', () => {
  it('puts Kimi K3 on writing, analysis, and vision', () => {
    const cats = compatibleCategories({
      name: 'Kimi K3 (Moonshot)',
      model: 'kimi-k3',
      base_url: 'https://api.moonshot.ai/v1',
    });
    assert.deepEqual(cats.sort(), ['analysis', 'vision', 'writing']);
    assert.equal(isCompatible({ model: 'kimi-k3', base_url: 'https://api.moonshot.ai/v1' }, 'audio'), false);
  });

  it('puts generic chat LLMs on writing + analysis only', () => {
    const cats = compatibleCategories({
      name: 'DeepSeek Chat',
      model: 'deepseek-chat',
      base_url: 'https://api.deepseek.com',
    });
    assert.ok(cats.includes('writing'));
    assert.ok(cats.includes('analysis'));
    assert.equal(cats.includes('vision'), false);
    assert.equal(cats.includes('audio'), false);
  });

  it('routes TTS endpoints to audio only', () => {
    const cats = compatibleCategories({
      name: 'OpenAI TTS',
      model: 'tts-1',
      base_url: 'https://api.openai.com/v1',
    });
    assert.deepEqual(cats, ['audio']);
  });
});
