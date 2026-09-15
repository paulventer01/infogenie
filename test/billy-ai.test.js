'use strict';

/**
 * Billy persona + dummy-key gate. No live xAI (api.x.ai) calls.
 * If services/xai/client.js is missing, the module still proves persona/gate.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const KEY_ENVS = ['XAI_API_KEY', 'XAI_KEY'];
const savedKeys = {};
for (const k of KEY_ENVS) savedKeys[k] = process.env[k];

function restoreKeys() {
  for (const k of KEY_ENVS) {
    if (savedKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeys[k];
  }
}

function setDummyKey() {
  process.env.XAI_API_KEY = '_DUMMY';
  delete process.env.XAI_KEY;
}

function unsetXaiKeys() {
  for (const k of KEY_ENVS) delete process.env[k];
}

let networkHits = 0;
const blockedHosts = [];

function requestHost(urlOrOpts) {
  try {
    if (typeof urlOrOpts === 'string') return new URL(urlOrOpts).hostname;
    if (urlOrOpts && typeof urlOrOpts === 'object') {
      if (urlOrOpts.href) return new URL(urlOrOpts.href).hostname;
      return String(urlOrOpts.hostname || urlOrOpts.host || '');
    }
  } catch { /* ignore */ }
  return '';
}

function isXaiHost(host) {
  return /(^|\.)api\.x\.ai$/i.test(String(host).split(':')[0]);
}

function makeBlockedReq(urlOrOpts) {
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.write = () => {};
  req.destroy = () => {};
  req.end = () => {
    networkHits += 1;
    blockedHosts.push(requestHost(urlOrOpts));
    req.emit('error', new Error('network must not be called — do not hit api.x.ai'));
  };
  return req;
}

const origHttpsRequest = https.request;
const origHttpRequest = http.request;
const origFetch = global.fetch;

https.request = function blockedHttps(urlOrOpts) {
  if (isXaiHost(requestHost(urlOrOpts))) return makeBlockedReq(urlOrOpts);
  return origHttpsRequest.apply(this, arguments);
};
http.request = function guardedHttp(urlOrOpts) {
  if (isXaiHost(requestHost(urlOrOpts))) return makeBlockedReq(urlOrOpts);
  return origHttpRequest.apply(this, arguments);
};
global.fetch = async function blockedFetch(url, opts) {
  const href = typeof url === 'string' ? url : (url && (url.href || url.url)) || '';
  if (/api\.x\.ai/i.test(String(href)) || isXaiHost(requestHost(url))) {
    networkHits += 1;
    blockedHosts.push(requestHost(url) || href);
    throw new Error('network must not be called — do not hit api.x.ai');
  }
  if (typeof origFetch === 'function') return origFetch.call(this, url, opts);
  throw new Error('fetch not available');
};

const clientAbs = path.resolve(__dirname, '../services/xai/client.js');
const hasRealClient = fs.existsSync(clientAbs);

before(() => {
  setDummyKey();
});

after(() => {
  https.request = origHttpsRequest;
  http.request = origHttpRequest;
  global.fetch = origFetch;
  restoreKeys();
});

beforeEach(() => {
  setDummyKey();
  networkHits = 0;
  blockedHosts.length = 0;
});

const {
  BILLY_INSTRUCTIONS,
  buildInstructions,
  buildInput,
  chatBilly,
  streamBilly,
  rememberThread,
  lastResponseIdFor,
  newThreadId,
} = require('../services/ai/billy');

test('buildInstructions includes Billy, InfoGenie, en-ZA, and domains', () => {
  const text = buildInstructions();
  assert.match(text, /Billy/);
  assert.match(text, /InfoGenie/);
  assert.match(text, /en-ZA/);
  assert.match(text, /campaigns/i);
  assert.match(text, /content/i);
  assert.match(text, /research/i);
  assert.match(text, /performance/i);
  assert.match(BILLY_INSTRUCTIONS, /Billy/);
  assert.match(BILLY_INSTRUCTIONS, /InfoGenie/);
});

test('buildInstructions mentions context product and locale', () => {
  const text = buildInstructions({ product: 'Acme CRM', locale: 'en-GB' });
  assert.match(text, /Acme CRM/);
  assert.match(text, /en-GB/);
  assert.match(text, /Billy/);
});

test('buildInput keeps the user message as the primary input', () => {
  const input = buildInput('Draft a launch email subject line.', { product: 'InfoGenie', locale: 'en-ZA' });
  assert.match(input, /Draft a launch email subject line\./);
  assert.match(input, /InfoGenie/);
  assert.match(input, /en-ZA/);
});

test('newThreadId starts with thr_', () => {
  const id = newThreadId();
  assert.ok(id.startsWith('thr_'), id);
  assert.notEqual(id, newThreadId());
});

test('rememberThread / lastResponseIdFor round-trip', () => {
  const tid = newThreadId();
  assert.equal(lastResponseIdFor(tid), null);
  rememberThread(tid, 'resp_abc123');
  assert.equal(lastResponseIdFor(tid), 'resp_abc123');
  rememberThread(tid, 'resp_updated');
  assert.equal(lastResponseIdFor(tid), 'resp_updated');
  assert.equal(lastResponseIdFor('thr_unknown'), null);
});

test('chatBilly with XAI_API_KEY=_DUMMY returns xai_not_configured and does not fetch', async () => {
  setDummyKey();
  let createCalled = false;
  let restoreCreate = null;
  if (hasRealClient) {
    const client = require('../services/xai/client');
    if (client && typeof client.createResponse === 'function') {
      const orig = client.createResponse;
      client.createResponse = async () => {
        createCalled = true;
        throw new Error('createResponse must not run on dummy key');
      };
      restoreCreate = () => { client.createResponse = orig; };
    }
  }
  try {
    const result = await chatBilly({ message: 'Help me plan a campaign.' });
    assert.equal(result.configured, false);
    assert.equal(result.error, 'xai_not_configured');
    assert.equal(result.source, 'fallback');
    assert.equal(typeof result.message, 'string');
    assert.ok(result.message.length > 0);
    assert.equal(result.message.role, undefined, 'fallback is a status, not an assistant chat turn');
    assert.equal(createCalled, false);
    assert.equal(networkHits, 0);
    assert.deepEqual(blockedHosts, []);
  } finally {
    if (restoreCreate) restoreCreate();
  }
});

test('chatBilly with unset XAI_API_KEY returns xai_not_configured', async () => {
  unsetXaiKeys();
  const result = await chatBilly({ message: 'Write a short product hook.' });
  assert.equal(result.configured, false);
  assert.equal(result.error, 'xai_not_configured');
  assert.equal(result.source, 'fallback');
  assert.equal(networkHits, 0);
});

test('chatBilly rejects an empty message without calling xAI', async () => {
  const result = await chatBilly({ message: '   ' });
  assert.equal(result.configured, false);
  assert.equal(result.error, 'invalid_message');
  assert.equal(networkHits, 0);
});

test('streamBilly dummy key invokes onError and emits no assistant deltas', async () => {
  setDummyKey();
  const deltas = [];
  let done = false;
  let err = null;
  const result = await streamBilly(
    { message: 'Suggest three content angles.' },
    {
      onDelta: (chunk) => { deltas.push(chunk); },
      onDone: () => { done = true; },
      onError: (e) => { err = e; },
    },
  );
  assert.ok(err);
  assert.equal(err.error, 'xai_not_configured');
  assert.equal(err.source, 'fallback');
  assert.equal(result.error, 'xai_not_configured');
  assert.equal(deltas.length, 0);
  assert.equal(done, false);
  assert.equal(networkHits, 0);
});

test('chatBilly maps a stubbed createResponse (no network, no fabrication tags)', async (t) => {
  // require() resolves on disk first — a cache-only stub is ignored when the
  // Integrations client is not in the tree yet. Persona/gate tests above cover
  // that parallel-work case. When the real client lands, this locks the shape.
  if (!hasRealClient) {
    t.skip('services/xai/client.js not present yet — gate tests already passed');
    return;
  }

  const client = require('../services/xai/client');
  const orig = {
    defaultModel: client.defaultModel,
    resolveXaiKey: client.resolveXaiKey,
    isUsableXaiKey: client.isUsableXaiKey,
    createResponse: client.createResponse,
    streamResponse: client.streamResponse,
  };
  client.defaultModel = () => 'grok-test';
  client.resolveXaiKey = () => 'stub-not-a-live-key';
  client.isUsableXaiKey = () => true;
  client.createResponse = async (args) => {
    assert.match(args.instructions, /Billy/);
    assert.match(args.input, /Hello Billy/);
    assert.equal(args.store, true);
    assert.equal(args.stream, false);
    assert.equal(args.model, 'grok-test');
    assert.equal(args.previousResponseId, 'resp_prev');
    assert.equal(args.user, 'user_1');
    return {
      id: 'resp_1',
      outputText: 'Howzit — here is a campaign angle.',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    };
  };
  client.streamResponse = async () => {
    throw new Error('streamResponse must not run in this test');
  };
  t.after(() => {
    Object.assign(client, orig);
  });

  const result = await chatBilly({
    message: 'Hello Billy',
    previousResponseId: 'resp_prev',
    userId: 'user_1',
    context: { product: 'InfoGenie', locale: 'en-ZA' },
  });
  assert.equal(result.configured, true);
  assert.equal(result.responseId, 'resp_1');
  assert.deepEqual(result.message, { role: 'assistant', content: 'Howzit — here is a campaign angle.' });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  assert.equal(result.model, 'grok-test');
  assert.equal(result._fabricated, undefined);
  assert.equal(result.source, undefined);
  assert.equal(networkHits, 0);
});
