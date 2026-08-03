// Z.ai / AutoClaw endpoint resolution — mirrors OpenClaw zai provider probing.
// https://docs.openclaw.ai/providers/zai · https://autoclaw.z.ai/

const { resolvePlatformKey } = require('../credentials/platform_keys');

const ENDPOINTS = {
  'zai-global':        { baseUrl: 'https://api.z.ai/api/paas/v4',              label: 'Z.ai General (Global)', defaultModel: 'glm-5.2' },
  'zai-cn':            { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',       label: 'Z.ai General (CN)', defaultModel: 'glm-5.2' },
  'zai-coding-global': { baseUrl: 'https://api.z.ai/api/coding/paas/v4',        label: 'AutoClaw / Coding Plan (Global)', defaultModel: 'glm-5.2' },
  'zai-coding-cn':     { baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', label: 'AutoClaw / Coding Plan (CN)', defaultModel: 'glm-5.2' },
};

const PROBE_ORDER = ['zai-global', 'zai-cn', 'zai-coding-global', 'zai-coding-cn'];
const PROBE_MODELS = ['glm-5.2', 'glm-5.1', 'glm-4.7'];

let _detectCache = { key: null, endpointId: null, model: null, at: 0 };
const CACHE_TTL_MS = 10 * 60 * 1000;

function zaiApiKey() {
  return resolvePlatformKey('ZAI_API_KEY') || process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY || null;
}

function configuredEndpointMode() {
  const m = (process.env.ZAI_ENDPOINT_MODE || 'auto').toLowerCase();
  if (ENDPOINTS[m]) return m;
  if (m === 'coding') return 'zai-coding-global';
  if (m === 'general') return 'zai-global';
  return 'auto';
}

function getEndpoint(id) {
  return ENDPOINTS[id] || ENDPOINTS['zai-coding-global'];
}

async function _probeEndpoint(apiKey, endpointId, model) {
  const ep = ENDPOINTS[endpointId];
  if (!ep) return false;
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 5,
  });
  try {
    const resp = await fetch(ep.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Accept-Language': 'en-US,en',
      },
      body,
      signal: AbortSignal.timeout(12000),
    });
    if (resp.ok) return true;
    const code = resp.status;
    // 400/422 often means auth ok but bad payload — treat as reachable
    if (code === 400 || code === 422) return true;
    return false;
  } catch {
    return false;
  }
}

async function detectZaiEndpoint(apiKey, forcedMode) {
  if (!apiKey) return null;
  const mode = forcedMode || configuredEndpointMode();
  if (mode !== 'auto') {
    const ep = getEndpoint(mode);
    return { endpointId: mode, baseUrl: ep.baseUrl, model: process.env.ZAI_MODEL || ep.defaultModel, label: ep.label };
  }

  const now = Date.now();
  if (_detectCache.key === apiKey && _detectCache.endpointId && (now - _detectCache.at) < CACHE_TTL_MS) {
    const ep = getEndpoint(_detectCache.endpointId);
    return { endpointId: _detectCache.endpointId, baseUrl: ep.baseUrl, model: _detectCache.model, label: ep.label };
  }

  for (const endpointId of PROBE_ORDER) {
    for (const model of PROBE_MODELS) {
      const ok = await _probeEndpoint(apiKey, endpointId, model);
      if (ok) {
        const ep = getEndpoint(endpointId);
        _detectCache = { key: apiKey, endpointId, model, at: now };
        return { endpointId, baseUrl: ep.baseUrl, model, label: ep.label };
      }
    }
  }

  // Fallback: AutoClaw coding global (documented default for GLM 5.2)
  const fallback = getEndpoint('zai-coding-global');
  return {
    endpointId: 'zai-coding-global',
    baseUrl: fallback.baseUrl,
    model: process.env.ZAI_MODEL || fallback.defaultModel,
    label: fallback.label,
    fallback: true,
  };
}

function clearDetectCache() {
  _detectCache = { key: null, endpointId: null, model: null, at: 0 };
}

module.exports = {
  ENDPOINTS,
  PROBE_ORDER,
  zaiApiKey,
  configuredEndpointMode,
  getEndpoint,
  detectZaiEndpoint,
  clearDetectCache,
};
