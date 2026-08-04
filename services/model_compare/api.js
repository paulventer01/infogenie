const express = require('express');
const _https  = require('https');
const _http   = require('http');
const { normalizeChatParams } = require('../ai_compat');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
let _platformKeys = null;
try { _platformKeys = require('../credentials/platform_keys'); } catch { /* optional */ }

const router  = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const MODELS = {
  'gpt-4o':        { provider:'openai',    label:'GPT-4o',              color:'#10A37F', keys:['AI_INTEGRATIONS_OPENAI_API_KEY','OPENAI_API_KEY'] },
  'gpt-5-mini':   { provider:'openai',    label:'GPT-5 mini',          color:'#10A37F', keys:['AI_INTEGRATIONS_OPENAI_API_KEY','OPENAI_API_KEY'] },
  'claude-3-5-sonnet-20241022': { provider:'anthropic', label:'Claude 3.5 Sonnet', color:'#D97706', keys:['AI_INTEGRATIONS_ANTHROPIC_API_KEY','ANTHROPIC_API_KEY'] },
  'claude-3-haiku-20240307':    { provider:'anthropic', label:'Claude 3 Haiku',    color:'#D97706', keys:['AI_INTEGRATIONS_ANTHROPIC_API_KEY','ANTHROPIC_API_KEY'] },
  'gemini-1.5-flash':           { provider:'google',    label:'Gemini 1.5 Flash',  color:'#4285F4', keys:['GEMINI_API_KEY'] },
  'gemini-1.5-pro':             { provider:'google',    label:'Gemini 1.5 Pro',    color:'#4285F4', keys:['GEMINI_API_KEY'] },
  'llama-3.1-8b-instruct':      { provider:'cloudflare',label:'Llama 3.1 8B',      color:'#6366F1', keys:['CLOUDFLARE_AI_TOKEN'] },
  'glm-5.2':                    { provider:'zai',       label:'GLM 5.2 (Z.ai)',      color:'#2563EB', keys:['ZAI_API_KEY','GLM_API_KEY'] },
  'kimi-k3':                    { provider:'moonshot',  label:'Kimi K3 (Moonshot)',  color:'#0F766E', keys:['MOONSHOT_API_KEY','KIMI_API_KEY'] },
  'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo': { provider:'rapidapi_llama', label:'Llama 3.2 Vision 11B', color:'#0064E0', keys:['RAPIDAPI_KEY'] },
};

function _resolveKey(...names) {
  for (const n of names) {
    let v = null;
    try { v = _platformKeys && _platformKeys.resolvePlatformKey(n); } catch { /* ignore */ }
    if (v == null || v === '') v = process.env[n];
    if (v && !/^_DUMMY/i.test(v) && !/^PENDING_/i.test(v)) return String(v);
  }
  return null;
}

function _providerAvailable(meta) {
  if (!meta) return false;
  if (meta.provider === 'byo') return true;
  const keys = meta.keys || [];
  return !!_resolveKey(...keys);
}

const _LLAMA_HOST = 'meta-llama-3-2-vision.p.rapidapi.com';

function _httpsJson(opts, body, timeoutMs) {
  const start = Date.now();
  const lib = opts.protocol === 'http:' ? _http : _https;
  return new Promise((resolve) => {
    const req = lib.request(opts, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve({
            text: j.choices?.[0]?.message?.content || '',
            latency_ms: Date.now() - start,
            tokens: j.usage?.completion_tokens || 0,
            raw: j,
          });
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs || 60000, () => req.destroy());
    if (body) req.write(body);
    req.end();
  });
}

function _callOpenAICompat(baseUrl, apiKey, model, messages, max_tokens, extra) {
  const key = apiKey;
  if (!key) return Promise.resolve(null);
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return Promise.resolve(null);
  const payload = Object.assign(
    { model, messages, max_tokens: max_tokens || 800 },
    extra || {},
  );
  // Only normalize when talking to OpenAI-shaped hosts that need it.
  const bodyObj = /openai\.com|moonshot/i.test(base)
    ? normalizeChatParams(Object.assign({ temperature: 0.7 }, payload))
    : Object.assign({ temperature: 0.7 }, payload);
  const body = JSON.stringify(bodyObj);
  let u;
  try { u = new URL(base + '/chat/completions'); } catch { return Promise.resolve(null); }
  return _httpsJson({
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || undefined,
    path: u.pathname + (u.search || ''),
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Accept: 'application/json',
    },
  }, body, 90000);
}

function _callLlama(model, messages, max_tokens) {
  const key = _resolveKey('RAPIDAPI_KEY');
  if (!key) return Promise.resolve(null);
  const body = JSON.stringify({ model, messages, max_tokens: max_tokens || 800, temperature: 0.7 });
  return _httpsJson({
    hostname: _LLAMA_HOST, path: '/chat/completions', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-rapidapi-key': key,
      'x-rapidapi-host': _LLAMA_HOST,
    },
  }, body, 60000);
}

function _callZai(model, messages, max_tokens) {
  const key = _resolveKey('ZAI_API_KEY', 'GLM_API_KEY', 'Z_AI_API_KEY');
  if (!key) return Promise.resolve(null);
  const base = (process.env.ZAI_API_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/$/, '');
  return _callOpenAICompat(base, key, model, messages, max_tokens);
}

function _callMoonshot(model, messages, max_tokens) {
  const key = _resolveKey('MOONSHOT_API_KEY', 'KIMI_API_KEY');
  if (!key) return Promise.resolve(null);
  const base = (process.env.MOONSHOT_API_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
  return _callOpenAICompat(base, key, model, messages, max_tokens, {
    reasoning_effort: process.env.KIMI_REASONING_EFFORT || 'high',
  });
}

function _callOpenAI(model, messages, max_tokens) {
  const key = _resolveKey('AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY');
  if (!key) return Promise.resolve(null);
  return _callOpenAICompat('https://api.openai.com/v1', key, model, messages, max_tokens);
}

function _callAnthropic(model, messages, max_tokens) {
  const key = _resolveKey('AI_INTEGRATIONS_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
  if (!key) return Promise.resolve(null);
  const sys = messages.find((m) => m.role === 'system')?.content || '';
  const userMsgs = messages.filter((m) => m.role !== 'system');
  const body = JSON.stringify({ model, system: sys, messages: userMsgs, max_tokens: max_tokens || 800 });
  const start = Date.now();
  return new Promise((resolve) => {
    const req = _https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve({ text: j.content?.[0]?.text || '', latency_ms: Date.now() - start, tokens: j.usage?.output_tokens || 0 });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _callGemini(model, messages, max_tokens) {
  const key = _resolveKey('GEMINI_API_KEY');
  if (!key) return Promise.resolve(null);
  const parts = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = JSON.stringify({ contents: parts, generationConfig: { temperature: 0.7, maxOutputTokens: max_tokens || 800 } });
  const modelPath = model.replace(/\./g, '-');
  const start = Date.now();
  return new Promise((resolve) => {
    const req = _https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${modelPath}:generateContent?key=${key}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve({
            text: j.candidates?.[0]?.content?.parts?.[0]?.text || '',
            latency_ms: Date.now() - start,
            tokens: j.usageMetadata?.candidatesTokenCount || 0,
          });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

async function _loadByo(tid) {
  if (!_db.hasDb() || !tid) return [];
  try {
    const r = await _db.getPool().query(
      `SELECT id, name, base_url, model, api_key, enabled
         FROM ai_providers
        WHERE tenant_id=$1 AND enabled=true
        ORDER BY name ASC, id ASC`,
      [tid],
    );
    return (r.rows || []).filter((row) => {
      const k = row.api_key || '';
      return k && !/^_DUMMY/i.test(k) && !/^PENDING_/i.test(k);
    });
  } catch {
    return [];
  }
}

function _byoAsModel(row) {
  return {
    id: 'byo:' + row.id,
    label: row.name || ('Provider #' + row.id),
    color: '#0F766E',
    provider: 'byo',
    available: true,
    source: 'ai-providers',
    model: row.model || '',
    hint: row.model || row.base_url || '',
  };
}

async function _judge(prompt, task_type, results) {
  const resultsText = results
    .filter((r) => r.output)
    .map((r, i) => `[Model ${i + 1}: ${r.label}]\n${r.output.slice(0, 400)}`)
    .join('\n\n---\n\n');
  if (!resultsText.trim()) return null;
  const sys = `You are an AI output quality judge. Compare the model outputs for a given task and return JSON:
{"winner":"<model label that won>","scores":[{"model":"<label>","quality":8,"creativity":7,"accuracy":9,"conciseness":8,"overall":8}],"rationale":"<2-3 sentence explanation of the winner and why>"}
Score each dimension 1-10. Be objective and specific.`;
  const user = `Task type: ${task_type}\nOriginal prompt: ${prompt.slice(0, 300)}\n\nModel outputs:\n${resultsText}`;
  const key = _resolveKey('AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY');
  if (!key) return null;
  const body = JSON.stringify(normalizeChatParams({
    model: 'gpt-5-mini',
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 600,
  }));
  const out = await _httpsJson({
    hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body, 30000);
  if (!out?.raw) return null;
  try { return JSON.parse(out.raw.choices[0].message.content); } catch { return null; }
}

async function _runOne(modelId, messages, max_tokens, byoMap) {
  if (String(modelId).startsWith('byo:')) {
    const row = byoMap.get(String(modelId));
    if (!row) return { model_id: modelId, label: modelId, error: 'unknown_model', output: null };
    const result = await _callOpenAICompat(row.base_url, row.api_key, row.model, messages, max_tokens);
    if (!result) {
      return {
        model_id: modelId, label: row.name, color: '#0F766E', provider: 'byo',
        output: null, error: 'unavailable_or_not_configured', latency_ms: 0, tokens: 0,
      };
    }
    return {
      model_id: modelId, label: row.name, color: '#0F766E', provider: 'byo',
      output: result.text, latency_ms: result.latency_ms, tokens: result.tokens, error: null,
    };
  }

  const meta = MODELS[modelId];
  if (!meta) return { model_id: modelId, label: modelId, error: 'unknown_model', output: null };
  let result = null;
  if (meta.provider === 'openai') result = await _callOpenAI(modelId, messages, max_tokens);
  else if (meta.provider === 'anthropic') result = await _callAnthropic(modelId, messages, max_tokens);
  else if (meta.provider === 'google') result = await _callGemini(modelId, messages, max_tokens);
  else if (meta.provider === 'rapidapi_llama') result = await _callLlama(modelId, messages, max_tokens);
  else if (meta.provider === 'zai') result = await _callZai(modelId, messages, max_tokens);
  else if (meta.provider === 'moonshot') result = await _callMoonshot(modelId, messages, max_tokens);
  if (!result) {
    return {
      model_id: modelId, label: meta.label, color: meta.color, provider: meta.provider,
      output: null, error: 'unavailable_or_not_configured', latency_ms: 0, tokens: 0,
    };
  }
  return {
    model_id: modelId, label: meta.label, color: meta.color, provider: meta.provider,
    output: result.text, latency_ms: result.latency_ms, tokens: result.tokens, error: null,
  };
}

router.get('/models', async (req, res) => {
  try {
    let tid = null;
    try { tid = await _tenantCtx.resolveTenantId(req, { label: 'model-compare:models' }); } catch { /* guest */ }
    const byo = await _loadByo(tid);
    // Dedupe identical name+model BYO rows (e.g. double-added Ollama).
    const seenByo = new Set();
    const byoUnique = [];
    for (const row of byo) {
      const key = `${String(row.name || '').toLowerCase()}|${String(row.model || '').toLowerCase()}|${String(row.base_url || '').toLowerCase()}`;
      if (seenByo.has(key)) continue;
      seenByo.add(key);
      byoUnique.push(row);
    }
    const builtIn = Object.entries(MODELS).map(([id, m]) => ({
      id,
      label: m.label,
      color: m.color,
      provider: m.provider,
      available: _providerAvailable(m),
      source: 'platform',
      hint: _providerAvailable(m) ? 'Ready' : 'Add API key in Settings or AI Providers',
    }));
    // Prefer unique BYO rows; keep built-ins even if a BYO mirrors the same model.
    const models = [...byoUnique.map(_byoAsModel), ...builtIn];
    const available_count = models.filter((m) => m.available).length;
    res.json({
      ok: true,
      models,
      available_count,
      configure_path: '/manage/ai-providers',
    });
  } catch (e) {
    _err(res, 500, e.message);
  }
});

router.post('/run', async (req, res) => {
  try {
    const {
      prompt,
      task_type = 'general',
      models: selectedModels = [],
      max_tokens = 600,
      system_prompt = '',
    } = req.body || {};
    if (!prompt || prompt.trim().length < 5) return _err(res, 400, 'prompt_required');
    if (!Array.isArray(selectedModels) || !selectedModels.length) {
      return _err(res, 400, 'select_at_least_one_model');
    }

    let tid = null;
    try { tid = await _tenantCtx.resolveTenantId(req, { label: 'model-compare:run' }); } catch { /* guest */ }
    const byoRows = await _loadByo(tid);
    const byoMap = new Map(byoRows.map((r) => ['byo:' + r.id, r]));

    const messages = system_prompt
      ? [{ role: 'system', content: system_prompt }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const results = await Promise.all(
      selectedModels.slice(0, 5).map((id) => _runOne(id, messages, max_tokens, byoMap)),
    );
    const judgment = await _judge(prompt, task_type, results);
    res.json({ ok: true, prompt, task_type, results, judgment });
  } catch (e) {
    _err(res, 500, e.message);
  }
});

module.exports = router;
module.exports._providerAvailable = _providerAvailable;
module.exports._resolveKey = _resolveKey;
