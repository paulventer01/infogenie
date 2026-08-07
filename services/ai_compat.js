'use strict';
// Compatibility shim for GPT-5 family models on the OpenAI Chat Completions API
// and Moonshot Kimi K3 (OpenAI-compatible with fixed sampling + reasoning_effort).
//
// GPT-5 reasoning models differ from GPT-4o in three ways that break call sites
// originally written for gpt-4o-mini:
//   1. `max_tokens` is rejected — they require `max_completion_tokens`.
//   2. `temperature` / `top_p` only accept the default value of 1 (anything else 400s).
//   3. They spend "reasoning" tokens out of the completion budget, so a small
//      max_completion_tokens can be fully consumed by reasoning and return EMPTY
//      content. Defaulting `reasoning_effort` to 'minimal' yields ~0 reasoning
//      tokens, making them behave like a fast non-reasoning model (gpt-4o-mini-like).
//
// Kimi K3 (platform.kimi.ai / api.moonshot.ai) always thinks and fixes:
//   temperature=1.0, top_p=0.95, n=1, presence_penalty=0, frequency_penalty=0
//   — those fields must be omitted. Prefer max_completion_tokens; support
//   reasoning_effort low|high|max (API default max; we default high for speed/cost).
//
// normalizeChatParams() returns a shallow-copied, rewritten params object so the
// many existing call sites keep working unchanged after the model swap.

function isGpt5(model) {
  return typeof model === 'string' && /^gpt-5/i.test(model.trim());
}

function isKimi(model) {
  if (typeof model !== 'string') return false;
  const m = model.trim().toLowerCase();
  return m === 'kimi-k3' || m.startsWith('kimi-') || m.includes('moonshot');
}

function isMoonshotBaseUrl(url) {
  if (typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('moonshot.ai') || u.includes('platform.kimi.ai') || u.includes('api.kimi.ai');
}

function normalizeChatParams(params, opts = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const forceKimi = !!opts.forceKimi || isMoonshotBaseUrl(opts.baseUrl);
  const kimi = forceKimi || isKimi(params.model);
  const gpt5 = isGpt5(params.model);
  if (!kimi && !gpt5) return params;

  const p = { ...params };

  if (gpt5) {
    // max_tokens -> max_completion_tokens (preserve the requested budget).
    if (p.max_tokens != null) {
      if (p.max_completion_tokens == null) p.max_completion_tokens = p.max_tokens;
      delete p.max_tokens;
    }
    // Only the default temperature/top_p (1) are supported — drop anything else.
    if (p.temperature != null && p.temperature !== 1) delete p.temperature;
    if (p.top_p != null && p.top_p !== 1) delete p.top_p;
    // Penalties are unsupported on reasoning models — drop non-zero values.
    if (p.frequency_penalty) delete p.frequency_penalty;
    if (p.presence_penalty) delete p.presence_penalty;
    // Behave like a fast, non-reasoning model unless the caller explicitly opts in,
    // so existing small token budgets aren't consumed entirely by reasoning tokens.
    if (p.reasoning_effort == null) p.reasoning_effort = 'minimal';
    return p;
  }

  // ── Kimi K3 ──────────────────────────────────────────────────────────────
  if (p.max_tokens != null) {
    if (p.max_completion_tokens == null) p.max_completion_tokens = p.max_tokens;
    delete p.max_tokens;
  }
  // Fixed by API — omit rather than send non-defaults
  delete p.temperature;
  delete p.top_p;
  delete p.n;
  delete p.presence_penalty;
  delete p.frequency_penalty;
  const effort = p.reasoning_effort;
  if (effort == null) {
    p.reasoning_effort = process.env.KIMI_REASONING_EFFORT || 'high';
  } else if (!['low', 'high', 'max'].includes(String(effort))) {
    p.reasoning_effort = 'high';
  }
  return p;
}

// Monkey-patch the shared OpenAI SDK so EVERY chat.completions.create call across
// the codebase gets GPT-5 params normalized. Each service constructs its own
// `new OpenAI()`, but they all share the same class via Node's module cache, so a
// single prototype patch covers them all. Idempotent.
function patchOpenAI(OpenAICtor) {
  try {
    const mod = OpenAICtor || require('openai');
    const Ctor = (typeof mod === 'function') ? mod : (mod.OpenAI || mod.default);
    if (typeof Ctor !== 'function') return false;
    const probe = new Ctor({ apiKey: 'patch-probe' });
    const proto = Object.getPrototypeOf(probe.chat.completions);
    if (!proto || typeof proto.create !== 'function' || proto.__gpt5Patched) return false;
    const orig = proto.create;
    proto.create = function patchedCreate(params, options) {
      return orig.call(this, normalizeChatParams(params), options);
    };
    proto.__gpt5Patched = true;
    return true;
  } catch (e) {
    console.warn('[ai_compat] OpenAI SDK patch failed:', e && e.message);
    return false;
  }
}

// ── Global raw-HTTP interception ────────────────────────────────────────────
// Dozens of service modules bypass the OpenAI SDK and POST a hand-built JSON body
// straight to `/v1/chat/completions` (via global `fetch` or `https.request`). The
// SDK prototype patch above does NOT cover those. patchHttp() wraps both transports
// so ANY gpt-5* chat-completions body — current or future, SDK or raw — is
// normalized before it leaves the process. It is strictly scoped: only requests
// whose URL/path contains `chat/completions` AND whose JSON body names a gpt-5*
// model are rewritten; every other request (embeddings, images, Anthropic, Gemini,
// DataForSEO, …) passes through byte-for-byte untouched. Idempotent.

function _isChatCompletionsTarget(s) {
  return typeof s === 'string' && s.includes('chat/completions');
}

// Normalize a raw JSON request body string. Returns the (possibly rewritten)
// string, or the original if it isn't a gpt-5 / kimi chat-completions payload.
function _normalizeRawBody(bodyStr, targetUrl) {
  if (typeof bodyStr !== 'string' || !bodyStr) return bodyStr;
  let parsed;
  try { parsed = JSON.parse(bodyStr); } catch { return bodyStr; }
  if (!parsed || typeof parsed !== 'object') return bodyStr;
  if (!isGpt5(parsed.model) && !isKimi(parsed.model) && !isMoonshotBaseUrl(targetUrl)) {
    return bodyStr;
  }
  return JSON.stringify(normalizeChatParams(parsed, { baseUrl: targetUrl }));
}

function patchHttp() {
  let patched = false;

  // 1) global fetch (Node 18+ / undici) — used by many helpers and the OpenAI SDK.
  if (typeof globalThis.fetch === 'function' && !globalThis.fetch.__gpt5Patched) {
    const origFetch = globalThis.fetch;
    const wrapped = function patchedFetch(input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (init && typeof init.body === 'string' && _isChatCompletionsTarget(url)) {
          const next = _normalizeRawBody(init.body, url);
          if (next !== init.body) init = { ...init, body: next };
        }
      } catch { /* fall through to original */ }
      return origFetch.call(this, input, init);
    };
    wrapped.__gpt5Patched = true;
    globalThis.fetch = wrapped;
    patched = true;
  }

  // 2) http(s).request / .get — body is written via req.write()/req.end(), so we
  //    buffer the chunks, normalize on flush, and fix Content-Length before send.
  for (const modName of ['https', 'http']) {
    let mod;
    try { mod = require(modName); } catch { continue; }
    if (mod.request && !mod.request.__gpt5Patched) {
      const origRequest = mod.request;
      const wrappedRequest = function patchedRequest(...args) {
        const target = _targetString(args);
        const req = origRequest.apply(this, args);
        if (_isChatCompletionsTarget(target)) _wrapClientRequestBody(req, target);
        return req;
      };
      wrappedRequest.__gpt5Patched = true;
      mod.request = wrappedRequest;
      // .get delegates to .request internally in Node, but re-point it to be safe.
      if (mod.get && !mod.get.__gpt5Patched) {
        const wrappedGet = function patchedGet(...args) {
          const req = mod.request(...args);
          req.end();
          return req;
        };
        wrappedGet.__gpt5Patched = true;
        mod.get = wrappedGet;
      }
      patched = true;
    }
  }

  return patched;
}

// Build a best-effort URL/path string from http.request(...) arguments so we can
// decide whether this request targets chat/completions.
function _targetString(args) {
  let s = '';
  for (const a of args) {
    if (typeof a === 'string') { s += ' ' + a; }
    else if (a && typeof a === 'object' && !(typeof a === 'function')) {
      if (typeof a.href === 'string') s += ' ' + a.href;       // URL object
      if (typeof a.path === 'string') s += ' ' + a.path;       // options.path
      if (typeof a.pathname === 'string') s += ' ' + a.pathname;
      if (typeof a.hostname === 'string') s += ' ' + a.hostname;
    }
  }
  return s;
}

// Override write/end on a ClientRequest to buffer the body, normalize it, and
// correct Content-Length before the bytes are flushed.
function _wrapClientRequestBody(req, targetUrl) {
  if (!req || req.__gpt5BodyWrapped) return;
  req.__gpt5BodyWrapped = true;
  const chunks = [];
  const origWrite = req.write.bind(req);
  const origEnd = req.end.bind(req);
  const collect = (chunk, encoding) => {
    if (chunk == null) return;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
  };
  req.write = function patchedWrite(chunk, encoding, cb) {
    collect(chunk, encoding);
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  };
  req.end = function patchedEnd(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    collect(chunk, encoding);
    let body = Buffer.concat(chunks).toString('utf8');
    try {
      const next = _normalizeRawBody(body, targetUrl);
      if (next !== body) {
        body = next;
        if (!req.headersSent) {
          try { req.setHeader('Content-Length', Buffer.byteLength(body)); } catch { /* ignore */ }
        }
      }
    } catch { /* send original body */ }
    if (body) origWrite(body);
    return origEnd(cb);
  };
}

// ── Meta Llama 3.2 Vision via RapidAPI ──────────────────────────────────────
// Shared helper so any service can drop Llama into its AI cascade without
// duplicating the RapidAPI call pattern. Returns { text, latency_ms, tokens }
// or null on any failure / unconfigured key. Uses Node https.request (not
// fetch) so it works in the same environments as every other _callXxx helper.
const _LLAMA_HOST = 'meta-llama-3-2-vision.p.rapidapi.com';
const _LLAMA_MODEL = 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo';

function hasLlama() {
  const k = process.env.RAPIDAPI_KEY;
  return !!(k && !/^_DUMMY/i.test(k));
}

function callLlama(messages, opts = {}) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const model = opts.model || _LLAMA_MODEL;
  const body = JSON.stringify({
    model,
    messages,
    max_tokens: opts.max_tokens || 800,
    temperature: opts.temperature != null ? opts.temperature : 0.7,
  });
  const start = Date.now();
  return new Promise(resolve => {
    const _https = require('https');
    const req = _https.request({
      hostname: _LLAMA_HOST,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-rapidapi-key': key,
        'x-rapidapi-host': _LLAMA_HOST,
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          const text = j?.choices?.[0]?.message?.content || '';
          resolve({ text, latency_ms: Date.now() - start, tokens: j?.usage?.completion_tokens || 0, model });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(opts.timeout_ms || 60000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

module.exports = {
  normalizeChatParams,
  patchOpenAI,
  patchHttp,
  isGpt5,
  isKimi,
  isMoonshotBaseUrl,
  callLlama,
  hasLlama,
  LLAMA_MODEL: _LLAMA_MODEL,
  LLAMA_HOST: _LLAMA_HOST,
};
