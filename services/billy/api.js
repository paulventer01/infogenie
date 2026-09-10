'use strict';

/**
 * Billy chat HTTP routes — POST /chat and POST /chat/stream.
 * Mounted at /api/billy (session + INFOGENIE_API_KEY) and /v1/billy (token stub).
 */

const express = require('express');
const billy = require('../ai/billy');
const { validate, zod } = require('../security/validate');

const router = express.Router();
const { z } = zod();

const chatBodySchema = z.object({
  message: z.string().trim().min(1),
  threadId: z.string().nullable().optional(),
  previousResponseId: z.string().nullable().optional(),
  userId: z.string().optional(),
  context: z.object({
    product: z.string().optional(),
    locale: z.string().optional(),
  }).optional(),
});

function sendLiveness(_req, res) {
  res.json({ ok: true, status: 'alive', ts: new Date().toISOString() });
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function normalizeUsage(usage) {
  const raw = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = Number(raw.inputTokens ?? raw.input_tokens ?? 0) || 0;
  const outputTokens = Number(raw.outputTokens ?? raw.output_tokens ?? 0) || 0;
  const totalTokens = Number(raw.totalTokens ?? raw.total_tokens ?? (inputTokens + outputTokens)) || 0;
  return { inputTokens, outputTokens, totalTokens };
}

function resolveThreadId(body) {
  const raw = body && body.threadId;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return billy.newThreadId();
}

function resolvePreviousResponseId(body, threadId) {
  const raw = body && body.previousResponseId;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return billy.lastResponseIdFor(threadId) || undefined;
}

function looksLikeSecret(msg) {
  return /api[_-]?key|authorization|bearer\s+\S+|sk-|xai-[A-Za-z0-9]/i.test(String(msg || ''));
}

function warnSafe(err) {
  const msg = err && err.message ? String(err.message) : 'error';
  if (looksLikeSecret(msg)) console.warn('[billy] handler failed');
  else console.warn('[billy]', msg);
}

function _err(res, code, payload) {
  return res.status(code).json({ ok: false, ...payload });
}

function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    warnSafe(e);
    if (res.headersSent) {
      try {
        writeSse(res, 'error', { error: 'internal_error' });
        res.end();
      } catch { /* ignore */ }
      return;
    }
    _err(res, 500, { error: 'internal_error' });
  });
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function deltaPayload(chunk) {
  if (typeof chunk === 'string') return { text: chunk };
  if (chunk && typeof chunk === 'object') {
    if (typeof chunk.text === 'string') return { text: chunk.text };
    if (typeof chunk.delta === 'string') return { text: chunk.delta };
  }
  return { text: chunk == null ? '' : String(chunk) };
}

function notConfiguredPayload(result) {
  return {
    error: 'xai_not_configured',
    message: typeof result.message === 'string'
      ? result.message
      : 'Billy is not connected to xAI yet.',
  };
}

function isNotConfigured(result) {
  if (!result) return false;
  return result.configured === false || result.error === 'xai_not_configured';
}

function chatArgs(req, threadId) {
  const body = req.body || {};
  return {
    message: body.message,
    previousResponseId: resolvePreviousResponseId(body, threadId),
    userId: body.userId,
    context: body.context,
  };
}

router.post('/chat', validate(chatBodySchema), _safe(async (req, res) => {
  const threadId = resolveThreadId(req.body);
  const result = await billy.chatBilly(chatArgs(req, threadId));

  if (isNotConfigured(result)) {
    return _err(res, 503, notConfiguredPayload(result));
  }

  if (result && result.error) {
    const status = result.error === 'invalid_message' ? 400 : 502;
    return _err(res, status, { error: result.error });
  }

  const responseId = result && result.responseId ? result.responseId : null;
  if (responseId) billy.rememberThread(threadId, responseId);

  const message = result && result.message && typeof result.message === 'object'
    ? result.message
    : { role: 'assistant', content: '' };

  return res.json({
    ok: true,
    threadId,
    responseId,
    message,
    usage: normalizeUsage(result && result.usage) || emptyUsage(),
  });
}));

router.post('/chat/stream', validate(chatBodySchema), _safe(async (req, res) => {
  const threadId = resolveThreadId(req.body);
  const ac = new AbortController();
  const onAbort = () => {
    try { ac.abort(); } catch { /* ignore */ }
  };
  req.on('close', onAbort);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    req.off('close', onAbort);
    if (!res.writableEnded) res.end();
  };

  await billy.streamBilly(chatArgs(req, threadId), {
    signal: ac.signal,
    onDelta(chunk) {
      if (finished || res.writableEnded) return;
      writeSse(res, 'delta', deltaPayload(chunk));
    },
    onDone(payload) {
      if (finished || res.writableEnded) return;
      const responseId = payload && (payload.responseId || payload.response_id) || null;
      if (responseId) billy.rememberThread(threadId, responseId);
      writeSse(res, 'done', {
        responseId,
        threadId,
        usage: normalizeUsage(payload && payload.usage),
      });
      finish();
    },
    onError(err) {
      if (finished || res.writableEnded) return;
      if (isNotConfigured(err) || (err && err.message === 'xai_not_configured')) {
        writeSse(res, 'error', notConfiguredPayload(err || {}));
      } else {
        const code = err && err.error ? err.error : 'xai_provider_error';
        writeSse(res, 'error', { error: code });
      }
      finish();
    },
  });

  if (!finished) finish();
}));

module.exports = router;
module.exports.sendLiveness = sendLiveness;
