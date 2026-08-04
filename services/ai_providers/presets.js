/**
 * Shared AI provider preset catalog — shown under every category tile and
 * used to seed/activate providers across Writing · Analysis · Vision · Audio.
 */

const PRESET_CATALOG = [
  {
    id: 'kimi-k3',
    name: 'Kimi K3 (Moonshot)',
    base_url: 'https://api.moonshot.ai/v1',
    model: 'kimi-k3',
    envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'groq-llama-70b',
    name: 'Groq Llama 3.1 70B',
    base_url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-70b-versatile',
    envKeys: ['GROQ_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'zai-glm-coding',
    name: 'Z.ai GLM 5.2 (AutoClaw Coding)',
    base_url: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-5.2',
    envKeys: ['ZAI_API_KEY', 'GLM_API_KEY', 'Z_AI_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'zai-glm',
    name: 'Z.ai GLM 5.2',
    base_url: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.2',
    envKeys: ['ZAI_API_KEY', 'GLM_API_KEY', 'Z_AI_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    envKeys: ['DEEPSEEK_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    base_url: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    envKeys: ['MISTRAL_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.1-70b-instruct',
    envKeys: ['OPENROUTER_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'together',
    name: 'Together AI',
    base_url: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3-70b-chat-hf',
    envKeys: ['TOGETHER_API_KEY'],
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'ollama-local',
    name: 'Ollama (local)',
    base_url: 'http://localhost:11434/v1',
    model: 'llama3.1',
    envKeys: [],
    allowEmptyKey: true,
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    base_url: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    model: 'gpt-4o',
    envKeys: ['AZURE_OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    requiresCustomUrl: true,
    tiles: ['writing', 'analysis', 'vision', 'audio'],
  },
];

function resolvePresetKey(preset) {
  if (preset.allowEmptyKey) return 'ollama-local';
  for (const k of preset.envKeys || []) {
    const v = process.env[k];
    if (v && !/^_DUMMY/i.test(v) && String(v).trim()) return String(v).trim();
  }
  try {
    const { resolvePlatformKey } = require('../credentials/platform_keys');
    for (const k of preset.envKeys || []) {
      const v = resolvePlatformKey(k);
      if (v && !/^_DUMMY/i.test(v)) return String(v).trim();
    }
  } catch (_) { /* platform keys optional */ }
  return null;
}

function matchConfigured(preset, providers) {
  return (providers || []).find((p) => {
    const sameModel = String(p.model || '').toLowerCase() === String(preset.model).toLowerCase();
    const sameUrl = String(p.base_url || '').replace(/\/+$/, '') === String(preset.base_url).replace(/\/+$/, '');
    const sameName = String(p.name || '').toLowerCase() === String(preset.name).toLowerCase();
    return (sameModel && sameUrl) || sameName;
  }) || null;
}

module.exports = {
  PRESET_CATALOG,
  resolvePresetKey,
  matchConfigured,
};
