// test/ai-providers-ecosystem.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PRESET_CATALOG } = require('../services/ai_providers/presets');
const { compatibleCategories } = require('../services/ai_providers/capabilities');

describe('AI provider ecosystem cascade', () => {
  it('catalog lists every peer provider on all four tiles', () => {
    const ids = PRESET_CATALOG.map((p) => p.id);
    for (const need of [
      'kimi-k3',
      'groq-llama-70b',
      'zai-glm',
      'deepseek-chat',
      'mistral-large',
      'openrouter',
      'together',
      'ollama-local',
      'ollama-cloud',
      'azure-openai',
    ]) {
      assert.ok(ids.includes(need), need);
    }
    for (const p of PRESET_CATALOG) {
      assert.deepEqual(
        [...p.tiles].sort(),
        ['analysis', 'audio', 'vision', 'writing'],
        p.id,
      );
    }
  });

  it('api wires enable-ecosystem + syncEcosystemCascade', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services/ai_providers/api.js'),
      'utf8',
    );
    assert.ok(src.includes("router.post('/enable-ecosystem'"));
    assert.ok(src.includes('async function syncEcosystemCascade'));
    assert.ok(src.includes('_hasUsableKey'));
    assert.ok(/filter\(\(p\) => _hasUsableKey\(p\.api_key\)\)/.test(src));
  });

  it('chat-capable peers all share the same four-tile surface', () => {
    const peers = [
      { name: 'Kimi K3', model: 'kimi-k3', base_url: 'https://api.moonshot.ai/v1' },
      { name: 'Groq', model: 'llama-3.1-70b-versatile', base_url: 'https://api.groq.com/openai/v1' },
      { name: 'DeepSeek', model: 'deepseek-chat', base_url: 'https://api.deepseek.com' },
      { name: 'Mistral', model: 'mistral-large-latest', base_url: 'https://api.mistral.ai/v1' },
    ];
    for (const p of peers) {
      assert.deepEqual(
        compatibleCategories(p).sort(),
        ['analysis', 'audio', 'vision', 'writing'],
        p.name,
      );
    }
  });
});
