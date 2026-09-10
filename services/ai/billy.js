'use strict';

/**
 * Billy — InfoGenie marketing assistant (xAI Grok orchestration).
 *
 * Depends on the Integrations client at services/xai/client.js:
 *   defaultModel, resolveXaiKey, isUsableXaiKey, createResponse, streamResponse
 *
 * This module is lazy: no top-level network. Missing/dummy xAI keys degrade
 * to a status/error payload (source: 'fallback'), never a fake Grok reply.
 * Successful chat is user-requested creative copy — do not tag _fabricated.
 *
 * @see AGENTS.md
 * @see .cursor/rules/04-ai-services.mdc
 */

const crypto = require('crypto');

const BILLY_INSTRUCTIONS = [
  'You are Billy, a warm, concise marketing assistant for InfoGenie.',
  'Write in South African English (en-ZA): friendly, professional, and to the point.',
  'Help with campaigns, content, research, and performance.',
  'Creative marketing copy is welcome (headlines, scripts, briefs, angles).',
  'Do not invent live spend, traffic, rankings, emails, or credentials and present them as facts.',
  'If the user asks for live numbers you do not have, say so honestly and say what would need to be connected or measured.',
].join(' ');

const NOT_CONFIGURED_MESSAGE =
  'Billy is not connected to xAI yet. An operator needs to add an xAI API key before chat can run.';

const threadById = new Map();

function resolveProduct(context) {
  const product = context && context.product;
  return typeof product === 'string' && product.trim() ? product.trim() : 'InfoGenie';
}

function resolveLocale(context) {
  const locale = context && context.locale;
  return typeof locale === 'string' && locale.trim() ? locale.trim() : 'en-ZA';
}

function buildInstructions(context) {
  const product = resolveProduct(context);
  const locale = resolveLocale(context);
  return [
    BILLY_INSTRUCTIONS,
    `The product in focus is ${product}.`,
    `Use locale ${locale}.`,
    'Stay in the domains of campaigns, content, research, and performance.',
  ].join(' ');
}

function buildInput(message, context) {
  const product = resolveProduct(context);
  const locale = resolveLocale(context);
  const text = typeof message === 'string' ? message : '';
  return `Product: ${product}. Locale: ${locale}.\n\n${text}`;
}

function loadXaiClient() {
  // Contract (Integrations): defaultModel, resolveXaiKey, isUsableXaiKey,
  // createResponse, streamResponse. Lazy require so a missing client cannot
  // crash boot; dummy-key tests still exercise the persona and gate.
  try {
    return require('../xai/client');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

function notConfigured() {
  return {
    configured: false,
    error: 'xai_not_configured',
    message: NOT_CONFIGURED_MESSAGE,
    source: 'fallback',
  };
}

function invalidMessage() {
  return {
    configured: false,
    error: 'invalid_message',
    message: 'Please type a message for Billy.',
  };
}

function isUsableClient(xai) {
  if (!xai || typeof xai.isUsableXaiKey !== 'function' || typeof xai.resolveXaiKey !== 'function') {
    return false;
  }
  try {
    return !!xai.isUsableXaiKey(xai.resolveXaiKey());
  } catch {
    return false;
  }
}

function friendlyProviderError(err) {
  const msg = err && err.message ? String(err.message) : '';
  if (!msg || /api[_-]?key|authorization|bearer\s+\S+|sk-|xai-[A-Za-z0-9]/i.test(msg)) {
    return 'Billy could not reach xAI right now. Please try again shortly.';
  }
  return msg.slice(0, 300);
}

function providerError(err) {
  return {
    configured: true,
    error: 'xai_provider_error',
    message: friendlyProviderError(err),
    source: 'fallback',
  };
}

function normalizeUsage(usage) {
  const raw = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = Number(raw.inputTokens ?? raw.input_tokens ?? 0) || 0;
  const outputTokens = Number(raw.outputTokens ?? raw.output_tokens ?? 0) || 0;
  const totalTokens = Number(raw.totalTokens ?? raw.total_tokens ?? (inputTokens + outputTokens)) || 0;
  return { inputTokens, outputTokens, totalTokens };
}

function extractOutputText(raw) {
  if (!raw || typeof raw !== 'object') return '';
  if (typeof raw.outputText === 'string') return raw.outputText;
  if (typeof raw.output_text === 'string') return raw.output_text;
  if (raw.message && typeof raw.message.content === 'string') return raw.message.content;
  return '';
}

function extractResponseId(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return raw.responseId || raw.response_id || raw.id || null;
}

function mapSuccess(raw, model) {
  return {
    configured: true,
    responseId: extractResponseId(raw),
    message: { role: 'assistant', content: extractOutputText(raw) },
    usage: normalizeUsage(raw && raw.usage),
    model,
  };
}

function validateMessage(message) {
  if (typeof message !== 'string' || !message.trim()) return invalidMessage();
  return null;
}

/**
 * Non-streaming Billy turn. Dummy/missing key → status/error, not a fake reply.
 * Provider failure is surfaced; we do not invent a marketing answer.
 */
async function chatBilly({ message, previousResponseId, userId, context } = {}) {
  const invalid = validateMessage(message);
  if (invalid) return invalid;

  const xai = loadXaiClient();
  if (!isUsableClient(xai)) return notConfigured();

  const model = typeof xai.defaultModel === 'function' ? xai.defaultModel() : undefined;
  try {
    const raw = await xai.createResponse({
      instructions: buildInstructions(context),
      input: buildInput(message, context),
      previousResponseId,
      user: userId,
      store: true,
      stream: false,
      model,
    });
    if (raw && raw.configured === false) return raw;
    if (raw && raw.error && !extractResponseId(raw) && !extractOutputText(raw)) {
      return {
        configured: true,
        error: raw.error,
        message: typeof raw.message === 'string' ? raw.message : 'Billy could not complete that request.',
        source: 'fallback',
      };
    }
    return mapSuccess(raw, model);
  } catch (err) {
    if (err && err.message === 'xai_not_configured') return notConfigured();
    return providerError(err);
  }
}

/**
 * Streaming Billy turn. Forwards client deltas/done/error. Dummy key → onError
 * only; no assistant deltas.
 */
async function streamBilly(
  { message, previousResponseId, userId, context } = {},
  { onDelta, onDone, onError, signal } = {},
) {
  const invalid = validateMessage(message);
  if (invalid) {
    if (typeof onError === 'function') onError(invalid);
    return invalid;
  }

  const xai = loadXaiClient();
  if (!isUsableClient(xai) || typeof xai.streamResponse !== 'function') {
    const err = notConfigured();
    if (typeof onError === 'function') onError(err);
    return err;
  }

  const model = typeof xai.defaultModel === 'function' ? xai.defaultModel() : undefined;
  const payload = {
    instructions: buildInstructions(context),
    input: buildInput(message, context),
    previousResponseId,
    user: userId,
    store: true,
    stream: true,
    model,
    signal,
  };
  try {
    return await xai.streamResponse(payload, { onDelta, onDone, onError, signal });
  } catch (err) {
    const surfaced = (err && err.message === 'xai_not_configured')
      ? notConfigured()
      : providerError(err);
    if (typeof onError === 'function') onError(surfaced);
    return surfaced;
  }
}

function rememberThread(threadId, responseId) {
  if (threadId == null || responseId == null || threadId === '' || responseId === '') return;
  threadById.set(String(threadId), String(responseId));
}

function lastResponseIdFor(threadId) {
  if (threadId == null || threadId === '') return null;
  return threadById.get(String(threadId)) || null;
}

function newThreadId() {
  return 'thr_' + crypto.randomBytes(16).toString('base64url');
}

module.exports = {
  BILLY_INSTRUCTIONS,
  buildInstructions,
  buildInput,
  chatBilly,
  streamBilly,
  rememberThread,
  lastResponseIdFor,
  newThreadId,
};
