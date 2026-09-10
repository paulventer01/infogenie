// services/xai/client.js — xAI Responses API client (Billy / Grok)
//
// Server-side only. Resolve XAI_API_KEY via the platform key plane (DB hydrate
// then env). Never log the Bearer token or the raw key.
// Spec: POST https://api.x.ai/v1/responses  (not chat/completions)

const { resolvePlatformKey } = require('../credentials/platform_keys');

const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_TIMEOUT_MS = 90_000;
const ERROR_BODY_SLICE = 240;

function defaultModel() {
  return process.env.XAI_MODEL || 'grok-4.6';
}

function resolveXaiKey() {
  const fromPlatform = resolvePlatformKey('XAI_API_KEY');
  if (fromPlatform) return fromPlatform;
  const fromEnv = process.env.XAI_API_KEY;
  return fromEnv == null || fromEnv === '' ? null : fromEnv;
}

function isUsableXaiKey(key) {
  if (key == null) return false;
  const s = String(key).trim();
  if (!s) return false;
  if (/^_DUMMY/i.test(s)) return false;
  return true;
}

function _notConfigured() {
  const err = new Error('xai_not_configured');
  err.code = 503;
  err.status = 503;
  return err;
}

function _userFrom(opts) {
  if (!opts || typeof opts !== 'object') return undefined;
  const raw = opts.user != null ? opts.user : opts.userId;
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s || undefined;
}

function buildResponseBody(opts = {}) {
  const body = {
    model: opts.model || defaultModel(),
    instructions: opts.instructions == null ? '' : String(opts.instructions),
    input: opts.input == null ? '' : opts.input,
    store: opts.store === false ? false : true,
  };
  const prev = opts.previousResponseId == null ? '' : String(opts.previousResponseId).trim();
  if (prev) body.previous_response_id = prev;
  const user = _userFrom(opts);
  if (user) body.user = user;
  if (opts.stream === true) body.stream = true;
  return body;
}

function _mapUsage(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = Number(u.input_tokens ?? u.inputTokens ?? 0) || 0;
  const outputTokens = Number(u.output_tokens ?? u.outputTokens ?? 0) || 0;
  const totalTokens = Number(u.total_tokens ?? u.totalTokens ?? 0) || 0;
  return { inputTokens, outputTokens, totalTokens };
}

function extractOutputText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item) continue;
    if (typeof item.text === 'string') parts.push(item.text);
    const content = item.content;
    if (typeof content === 'string') {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (typeof c === 'string') parts.push(c);
      else if (c && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('');
}

function _httpError(status, bodyText) {
  const slice = String(bodyText || '').slice(0, ERROR_BODY_SLICE);
  const err = new Error(slice ? `xAI HTTP ${status}: ${slice}` : `xAI HTTP ${status}`);
  err.status = status;
  err.code = status;
  return err;
}

function _authHeaders(key) {
  return {
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  };
}

function _withTimeout(external, ms = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup() {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    },
  };
}

const TEXT_DELTA_TYPE = /output_text\.delta|^response\.delta$|^delta$/i;

function extractDeltaText(evt, eventName) {
  if (!evt || typeof evt !== 'object') return '';
  const type = String(evt.type || eventName || '');
  const fromDelta = typeof evt.delta === 'string'
    ? evt.delta
    : (evt.delta && typeof evt.delta.text === 'string' ? evt.delta.text : '');
  const fromText = typeof evt.text === 'string' ? evt.text : '';
  if (TEXT_DELTA_TYPE.test(type)) return fromDelta || fromText;
  // data-only payloads sometimes omit `type` and only send `{ delta: "…" }`
  if (!type && fromDelta) return fromDelta;
  return '';
}

function _donePayload(evt) {
  const resp = (evt && typeof evt === 'object' && evt.response) || evt || {};
  return {
    responseId: resp.id || (evt && evt.id) || null,
    usage: _mapUsage(resp.usage || (evt && evt.usage)),
  };
}

function _isCompleted(evt, eventName, raw) {
  if (raw === '[DONE]') return true;
  const type = String((evt && evt.type) || eventName || '');
  return type === 'response.completed' || type === 'completed';
}

async function consumeSse(body, onEvent) {
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('xAI stream body is not readable');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let eventName = '';

  const handleLine = (line) => {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      onEvent(line.slice(5).trim(), eventName);
      eventName = '';
      return;
    }
    if (line === '') eventName = '';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  }
  const tail = buf.trim();
  if (tail.startsWith('data:')) onEvent(tail.slice(5).trim(), eventName);
}

async function createResponse(opts = {}) {
  const key = resolveXaiKey();
  if (!isUsableXaiKey(key)) throw _notConfigured();

  const body = buildResponseBody({ ...opts, stream: false });
  delete body.stream;

  const gate = _withTimeout(opts.signal, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(XAI_RESPONSES_URL, {
      method: 'POST',
      headers: _authHeaders(key),
      body: JSON.stringify(body),
      signal: gate.signal,
    });
  } finally {
    gate.cleanup();
  }

  const text = await r.text();
  if (!r.ok) throw _httpError(r.status, text);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw _httpError(r.status, text);
  }

  return {
    id: data && data.id ? data.id : null,
    outputText: extractOutputText(data),
    usage: _mapUsage(data && data.usage),
    raw: data,
  };
}

async function streamResponse(opts = {}, handlers = {}) {
  const { onDelta, onDone, onError, signal } = handlers || {};
  const key = resolveXaiKey();
  if (!isUsableXaiKey(key)) {
    const err = _notConfigured();
    if (typeof onError === 'function') onError(err);
    else throw err;
    return;
  }

  const body = buildResponseBody({ ...opts, stream: true });
  const gate = _withTimeout(signal || opts.signal, opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  let finished = false;
  let lastDone = { responseId: null, usage: _mapUsage(null) };

  const finish = (payload) => {
    if (finished) return;
    finished = true;
    if (typeof onDone === 'function') onDone(payload || lastDone);
  };

  const fail = (err) => {
    if (finished) return;
    finished = true;
    if (typeof onError === 'function') onError(err);
    else throw err;
  };

  try {
    let r;
    try {
      r = await fetch(XAI_RESPONSES_URL, {
        method: 'POST',
        headers: _authHeaders(key),
        body: JSON.stringify(body),
        signal: gate.signal,
      });
    } catch (e) {
      fail(e);
      return;
    }

    if (!r.ok) {
      let slice = '';
      try { slice = await r.text(); } catch { /* ignore */ }
      fail(_httpError(r.status, slice));
      return;
    }

    await consumeSse(r.body, (raw, eventName) => {
      if (raw === '[DONE]') {
        finish(lastDone);
        return;
      }
      let evt = null;
      try { evt = JSON.parse(raw); } catch { return; }
      if (evt && evt.id && !lastDone.responseId) {
        lastDone = { responseId: evt.id, usage: lastDone.usage };
      }
      const chunk = extractDeltaText(evt, eventName);
      if (chunk && typeof onDelta === 'function') onDelta(chunk);
      if (_isCompleted(evt, eventName, raw)) {
        lastDone = _donePayload(evt);
        finish(lastDone);
      } else if (evt && evt.response && evt.response.id) {
        lastDone = {
          responseId: evt.response.id,
          usage: evt.response.usage ? _mapUsage(evt.response.usage) : lastDone.usage,
        };
      }
    });

    if (!finished) finish(lastDone);
  } catch (e) {
    fail(e);
  } finally {
    gate.cleanup();
  }
}

module.exports = {
  XAI_RESPONSES_URL,
  defaultModel,
  resolveXaiKey,
  isUsableXaiKey,
  buildResponseBody,
  createResponse,
  streamResponse,
};
