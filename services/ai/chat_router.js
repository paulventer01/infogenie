// Unified AI chat router — BYO → AutoClaw/Z.ai GLM → OpenAI fallback.
// Efficient cascade: fast tier by default for high-volume surfaces; escalate to strong when needed.

const { chatViaProvider } = require('../ai_providers/api');
const { resolvePlatformKey } = require('../credentials/platform_keys');
const { zaiApiKey, detectZaiEndpoint, configuredEndpointMode } = require('../autoclaw/zai_client');
const {
  resolveCascadePlan,
  applyPlanToOpts,
  shouldEscalate,
  cascadeStatus,
} = require('./efficient_cascade');

const ZAI_MODEL_DEFAULT = process.env.ZAI_MODEL || 'glm-5.2';

function _openaiKey() {
  return resolvePlatformKey('AI_INTEGRATIONS_OPENAI_API_KEY') || process.env.OPENAI_API_KEY || null;
}

async function _callOpenAICompat({ baseUrl, apiKey, model, messages, opts = {}, providerTag = 'openai' }) {
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

  const t0 = Date.now();
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
    err.latency_ms = Date.now() - t0;
    throw err;
  }
  const j = await resp.json();
  const msg = j?.choices?.[0]?.message || {};
  const content = msg.content || msg.reasoning_content || '';
  const usage = j?.usage || {};
  return {
    provider: providerTag,
    model,
    content,
    endpoint: baseUrl,
    latency_ms: Date.now() - t0,
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? null,
  };
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
        providerTag: 'zai',
      });
    } catch (e) {
      const retryable = e.status === 429 || e.status === 503 || /1302|1305|rate|overload/i.test(e.message);
      if (!retryable && a.model !== attempts[attempts.length - 1].model) continue;
      if (a === attempts[attempts.length - 1]) console.warn('[chat_router] Z.ai/AutoClaw failed:', e.message);
    }
  }
  return null;
}

async function _callGeminiFlash(messages, opts = {}) {
  const key = resolvePlatformKey('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  try {
    const model = opts.gemini_model || process.env.AI_FAST_GEMINI_MODEL || 'gemini-1.5-flash';
    const parts = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }],
    })).filter((m) => m.parts[0].text);
    // Gemini needs alternating roles — flatten system into first user
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const contents = [];
    if (system) contents.push({ role: 'user', parts: [{ text: system }] });
    for (const m of messages) {
      if (m.role === 'system') continue;
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }],
      });
    }
    void parts;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: opts.max_tokens || 500,
          temperature: opts.temperature ?? 0.3,
        },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs || 25000),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const content = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
    if (!content) return null;
    return { provider: 'gemini', model, content };
  } catch (_) {
    return null;
  }
}

async function _injectContext(msgs, opts, category) {
  let contextPack = null;
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
  return { msgs, contextPack };
}

async function _dispatch(category, msgs, opts, contextPack) {
  if (opts.tenantId != null) {
    const via = await chatViaProvider(category, msgs, opts);
    if (via && via.content) {
      if (contextPack) via.context_pack_id = contextPack.id;
      via.cascade_tier = opts._cascade?.tier || null;
      return via;
    }
  }

  const plan = opts._cascade;
  const preferCoding = opts.useAutoclaw !== false && (category === 'analysis' || opts.useAutoclaw);

  // Fast tier: prefer cheap OpenAI/Gemini before AutoClaw high-reasoning
  if (plan?.tier === 'fast') {
    const oaiKey = _openaiKey();
    if (oaiKey) {
      try {
        const base = (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const out = await _callOpenAICompat({
          baseUrl: base,
          apiKey: oaiKey,
          model: opts.model || 'gpt-4o-mini',
          messages: msgs,
          opts,
          providerTag: 'openai',
        });
        if (out?.content) {
          if (contextPack) out.context_pack_id = contextPack.id;
          out.cascade_tier = 'fast';
          return out;
        }
      } catch (e) {
        console.warn('[chat_router] fast OpenAI failed:', e.message);
      }
    }
    const gem = await _callGeminiFlash(msgs, opts);
    if (gem?.content) {
      if (contextPack) gem.context_pack_id = contextPack.id;
      gem.cascade_tier = 'fast';
      return gem;
    }
    // Soft Z.ai without high reasoning as last fast fallback
    const zaiFast = await _callZai(msgs, {
      ...opts,
      endpointMode: 'zai-global',
      reasoning_effort: undefined,
      model: opts.model || ZAI_MODEL_DEFAULT,
    });
    if (zaiFast?.content) {
      if (contextPack) zaiFast.context_pack_id = contextPack.id;
      zaiFast.cascade_tier = 'fast';
      return zaiFast;
    }
    return null;
  }

  // Strong / default: AutoClaw coding endpoint first for analysis
  const zai = await _callZai(msgs, {
    ...opts,
    endpointMode: preferCoding ? (process.env.ZAI_ENDPOINT_MODE || 'auto') : 'zai-global',
    reasoning_effort: opts.reasoning_effort || (preferCoding ? 'high' : undefined),
  });
  if (zai?.content) {
    if (contextPack) zai.context_pack_id = contextPack.id;
    zai.cascade_tier = plan?.tier || 'strong';
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
      providerTag: 'openai',
    });
    if (contextPack) out.context_pack_id = contextPack.id;
    out.cascade_tier = plan?.tier || null;
    return out;
  }

  return null;
}

/**
 * @param {'writing'|'analysis'|'vision'|'audio'} category
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ tenantId?: number, max_tokens?: number, temperature?: number, response_format?: object, useAutoclaw?: boolean, model?: string, useContextPack?: boolean, surface?: string, requireContext?: boolean, tier?: 'fast'|'strong'|'auto', escalate?: boolean|object }} opts
 */
async function _feedbackForcesStrong(tenantId, surface) {
  if (tenantId == null || !surface) return false;
  try {
    const { feedbackStats } = require('../ai_feedback/store');
    const stats = await feedbackStats({ tenantId, hours: 24 * 14 });
    return (stats.escalate_candidates || []).some((c) => c.surface === surface);
  } catch {
    return false;
  }
}

async function _recordCallTrace(payload) {
  try {
    const { recordTrace } = require('../ai_traces/store');
    return await recordTrace(payload);
  } catch (_) {
    return null;
  }
}

async function chatForCategory(category, messages, opts = {}) {
  const surface = opts.surface || category;
  let tierOverride = opts.tier;
  // Continuous learning: surfaces with high dislike rates start on strong
  if ((!tierOverride || tierOverride === 'auto' || tierOverride === 'fast')
      && opts.tenantId != null
      && await _feedbackForcesStrong(opts.tenantId, surface)) {
    tierOverride = 'strong';
  }

  const plan = resolveCascadePlan({
    category,
    surface,
    tier: tierOverride,
  });
  const callOpts = applyPlanToOpts(opts, plan);
  let msgs = Array.isArray(messages) ? messages : [];
  const { msgs: withCtx, contextPack } = await _injectContext(msgs, callOpts, category);
  msgs = withCtx;

  const t0 = Date.now();
  let result = null;
  let errorMsg = null;
  try {
    result = await _dispatch(category, msgs, callOpts, contextPack);

    // Optional one-shot escalate: fast → strong when weak / caller gate
    const esc = opts.escalate;
    const wantEscalate = esc === true
      || (esc && typeof esc === 'object')
      || (esc == null && plan.tier === 'fast' && plan.escalate_default && opts.autoEscalate === true);

    if (wantEscalate && plan.tier === 'fast' && shouldEscalate(result, typeof esc === 'object' ? esc : {})) {
      const strongPlan = resolveCascadePlan({
        category,
        surface,
        tier: 'strong',
      });
      const strongOpts = applyPlanToOpts({ ...opts, escalate: false, autoEscalate: false, tier: 'strong' }, strongPlan);
      // Reuse same context pack; don't rebuild
      strongOpts._contextPack = contextPack;
      const escalated = await _dispatch(category, msgs, strongOpts, contextPack);
      if (escalated?.content) {
        escalated.escalated_from = 'fast';
        escalated.cascade_tier = 'strong';
        if (contextPack) escalated.context_pack_id = contextPack.id;
        result = escalated;
      }
    }

    if (result && contextPack && !result.context_pack_id) result.context_pack_id = contextPack.id;
  } catch (e) {
    errorMsg = e.message;
    throw e;
  } finally {
    const trace = await _recordCallTrace({
      tenant_id: opts.tenantId,
      surface,
      category,
      provider: result?.provider || null,
      model: result?.model || callOpts.model || null,
      cascade_tier: result?.cascade_tier || plan.tier,
      escalated_from: result?.escalated_from || null,
      context_pack_id: result?.context_pack_id || contextPack?.id || null,
      latency_ms: result?.latency_ms != null ? result.latency_ms : (Date.now() - t0),
      prompt_tokens: result?.prompt_tokens ?? null,
      completion_tokens: result?.completion_tokens ?? null,
      status: errorMsg ? 'error' : (result?.content ? 'ok' : 'empty'),
      error: errorMsg,
      meta: { feedback_forced_strong: tierOverride === 'strong' && opts.tier !== 'strong' },
    });
    if (result && trace?.id) result.call_trace_id = trace.id;
  }

  return result;
}

/**
 * Explicit cascade helper: always try fast first, escalate when gate says so.
 */
async function chatWithCascade(category, messages, opts = {}) {
  return chatForCategory(category, messages, {
    ...opts,
    tier: opts.tier || 'fast',
    autoEscalate: opts.autoEscalate !== false,
    escalate: opts.escalate != null ? opts.escalate : true,
  });
}

module.exports = {
  chatForCategory,
  chatWithCascade,
  cascadeStatus,
  ZAI_MODEL_DEFAULT,
};
