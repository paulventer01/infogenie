// Unified AI chat router — BYO provider → Z.ai GLM 5.2 → OpenAI fallback.
// Used by Lead Intelligence classification and other analysis tasks.

const { chatViaProvider } = require('../ai_providers/api');
const { resolvePlatformKey } = require('../credentials/platform_keys');

const ZAI_BASE = (process.env.ZAI_API_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '');
const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-5.2';

function _zaiKey() {
  return resolvePlatformKey('ZAI_API_KEY') || process.env.ZAI_API_KEY || null;
}

function _openaiKey() {
  return resolvePlatformKey('AI_INTEGRATIONS_OPENAI_API_KEY') || process.env.OPENAI_API_KEY || null;
}

async function _callOpenAICompat({ baseUrl, apiKey, model, messages, opts = {} }) {
  const resp = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Accept-Language': 'en-US,en',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.max_tokens || 900,
      temperature: opts.temperature ?? 0.3,
      ...(opts.response_format ? { response_format: opts.response_format } : {}),
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`AI HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const j = await resp.json();
  const content = j?.choices?.[0]?.message?.content || '';
  return { provider: model, model, content };
}

/**
 * @param {'writing'|'analysis'|'vision'|'audio'} category
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ tenantId?: number, max_tokens?: number, temperature?: number, response_format?: object }} opts
 */
async function chatForCategory(category, messages, opts = {}) {
  // 1) Tenant BYO provider (Manage → AI Providers)
  if (opts.tenantId != null) {
    const via = await chatViaProvider(category, messages, opts);
    if (via && via.content) return via;
  }

  // 2) Z.ai GLM 5.2 (platform key from chat.z.ai)
  const zaiKey = _zaiKey();
  if (zaiKey) {
    try {
      return await _callOpenAICompat({
        baseUrl: ZAI_BASE,
        apiKey: zaiKey,
        model: ZAI_MODEL,
        messages,
        opts,
      });
    } catch (e) {
      console.warn('[chat_router] Z.ai failed:', e.message);
    }
  }

  // 3) OpenAI fallback
  const oaiKey = _openaiKey();
  if (oaiKey) {
    const base = (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return await _callOpenAICompat({
      baseUrl: base,
      apiKey: oaiKey,
      model: opts.model || 'gpt-4o-mini',
      messages,
      opts,
    });
  }

  return null;
}

module.exports = { chatForCategory, ZAI_BASE, ZAI_MODEL };
