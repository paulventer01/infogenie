// Unified AI chat router — BYO → AutoClaw/Z.ai GLM → OpenAI fallback.

const { chatViaProvider } = require('../ai_providers/api');
const { resolvePlatformKey } = require('../credentials/platform_keys');
const { zaiApiKey, detectZaiEndpoint, configuredEndpointMode } = require('../autoclaw/zai_client');

const ZAI_MODEL_DEFAULT = process.env.ZAI_MODEL || 'glm-5.2';

function _openaiKey() {
  return resolvePlatformKey('AI_INTEGRATIONS_OPENAI_API_KEY') || process.env.OPENAI_API_KEY || null;
}

async function _callOpenAICompat({ baseUrl, apiKey, model, messages, opts = {} }) {
  const payload = {
    model,
    messages,
    max_tokens: opts.max_tokens || 900,
    temperature: opts.temperature ?? 0.3,
    ...(opts.response_format ? { response_format: opts.response_format } : {}),
  };
  // GLM 5.2 reasoning (AutoClaw / Z.ai coding endpoint)
  if (opts.reasoning_effort) payload.reasoning_effort = opts.reasoning_effort;
  if (opts.thinking) payload.thinking = opts.thinking;

  const resp = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Accept-Language': 'en-US,en',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeoutMs || 90000),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`AI HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  const j = await resp.json();
  const msg = j?.choices?.[0]?.message || {};
  const content = msg.content || msg.reasoning_content || '';
  return { provider: 'zai', model, content, endpoint: baseUrl };
}

async function _callZai(messages, opts = {}) {
  const key = zaiApiKey();
  if (!key) return null;
  const mode = opts.endpointMode || configuredEndpointMode();
  const detected = await detectZaiEndpoint(key, mode === 'auto' ? 'auto' : mode);
  if (!detected) return null;
  const model = opts.model || detected.model || ZAI_MODEL_DEFAULT;

  const attempts = [
    { model, reasoning_effort: opts.reasoning_effort },
    { model: 'glm-5.2', reasoning_effort: undefined },
    { model: 'glm-4.7', reasoning_effort: undefined },
  ];

  for (const a of attempts) {
    try {
      return await _callOpenAICompat({
        baseUrl: detected.baseUrl,
        apiKey: key,
        model: a.model,
        messages,
        opts: { ...opts, reasoning_effort: a.reasoning_effort },
      });
    } catch (e) {
      const retryable = e.status === 429 || e.status === 503 || /1302|1305|rate|overload/i.test(e.message);
      if (!retryable && a.model !== attempts[attempts.length - 1].model) continue;
      if (a === attempts[attempts.length - 1]) console.warn('[chat_router] Z.ai/AutoClaw failed:', e.message);
    }
  }
  return null;
}

/**
 * @param {'writing'|'analysis'|'vision'|'audio'} category
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ tenantId?: number, max_tokens?: number, temperature?: number, response_format?: object, useAutoclaw?: boolean, model?: string, useContextPack?: boolean, surface?: string, requireContext?: boolean }} opts
 */
async function chatForCategory(category, messages, opts = {}) {
  let msgs = Array.isArray(messages) ? messages : [];
  let contextPack = null;

  // M1: inject Marketing Memory + brand foundation when tenant is known
  if (opts.tenantId != null && opts.useContextPack !== false) {
    try {
      const { buildContextPack, injectContextIntoMessages } = require('../ai_governance/context_pack');
      contextPack = await buildContextPack({
        tenantId: opts.tenantId,
        question: opts.question,
        surface: opts.surface || category,
        messages: msgs,
        requireContext: !!opts.requireContext,
        limit: opts.contextLimit || 6,
      });
      const inj = injectContextIntoMessages(msgs, contextPack);
      msgs = inj.messages;
      opts._contextPack = contextPack;
      opts._contextPackInjected = inj.injected;
    } catch (e) {
      console.warn('[chat_router] context_pack failed (fail-open):', e.message);
    }
  }

  if (opts.tenantId != null) {
    const via = await chatViaProvider(category, msgs, opts);
    if (via && via.content) {
      if (contextPack) via.context_pack_id = contextPack.id;
      return via;
    }
  }

  // AutoClaw / Z.ai coding endpoint (preferred for analysis & agentic tasks)
  const preferCoding = opts.useAutoclaw !== false && (category === 'analysis' || opts.useAutoclaw);
  const zai = await _callZai(msgs, {
    ...opts,
    endpointMode: preferCoding ? (process.env.ZAI_ENDPOINT_MODE || 'auto') : 'zai-global',
    reasoning_effort: opts.reasoning_effort || (preferCoding ? 'high' : undefined),
  });
  if (zai?.content) {
    if (contextPack) zai.context_pack_id = contextPack.id;
    return zai;
  }

  const oaiKey = _openaiKey();
  if (oaiKey) {
    const base = (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const out = await _callOpenAICompat({
      baseUrl: base,
      apiKey: oaiKey,
      model: opts.model || 'gpt-4o-mini',
      messages: msgs,
      opts,
    });
    if (contextPack) out.context_pack_id = contextPack.id;
    return out;
  }

  return null;
}

module.exports = { chatForCategory, ZAI_MODEL_DEFAULT };
