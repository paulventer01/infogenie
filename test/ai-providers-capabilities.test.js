// test/ai-providers-capabilities.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compatibleCategories, isCompatible } = require('../services/ai_providers/capabilities');
const { PRESET_CATALOG } = require('../services/ai_providers/presets');

describe('AI provider category compatibility', () => {
  it('puts Kimi K3 on writing, analysis, vision, and audio', () => {
    const cats = compatibleCategories({
      name: 'Kimi K3 (Moonshot)',
      model: 'kimi-k3',
      base_url: 'https://api.moonshot.ai/v1',
    });
    assert.deepEqual(cats.sort(), ['analysis', 'audio', 'vision', 'writing']);
  });

  it('puts generic chat LLMs on all four tiles so they cascade together', () => {
    const cats = compatibleCategories({
      name: 'DeepSeek Chat',
      model: 'deepseek-chat',
      base_url: 'https://api.deepseek.com',
    });
    assert.deepEqual(cats.sort(), ['analysis', 'audio', 'vision', 'writing']);
  });

  it('places every catalog preset on writing, analysis, vision, and audio', () => {
    for (const preset of PRESET_CATALOG) {
      assert.deepEqual(
        [...preset.tiles].sort(),
        ['analysis', 'audio', 'vision', 'writing'],
        preset.id + ' tiles',
      );
      const cats = compatibleCategories({
        name: preset.name,
        model: preset.model,
        base_url: preset.base_url,
      });
      assert.deepEqual(cats.sort(), ['analysis', 'audio', 'vision', 'writing'], preset.id + ' compatible');
    }
  });

  it('routes TTS endpoints to audio only', () => {
    const cats = compatibleCategories({
      name: 'OpenAI TTS',
      model: 'tts-1',
      base_url: 'https://api.openai.com/v1',
    });
    assert.deepEqual(cats, ['audio']);
  });

  it('isCompatible accepts each tile for chat BYO', () => {
    const p = { name: 'Groq', model: 'llama-3.1-70b-versatile', base_url: 'https://api.groq.com/openai/v1' };
    for (const c of ['writing', 'analysis', 'vision', 'audio']) {
      assert.equal(isCompatible(p, c), true);
    }
  });
});
