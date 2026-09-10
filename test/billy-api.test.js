'use strict';

/**
 * Billy Express routes. Stubs chatBilly/streamBilly — never hits api.x.ai.
 */

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const billy = require('../services/ai/billy');
const tokenGate = require('../services/security/billy_token');
const router = require('../services/billy/api');

function sendLiveness(_req, res) {
  res.json({ ok: true, status: 'alive', ts: new Date().toISOString() });
}

const origBilly = {
  chatBilly: billy.chatBilly,
  streamBilly: billy.streamBilly,
  newThreadId: billy.newThreadId,
  rememberThread: billy.rememberThread,
  lastResponseIdFor: billy.lastResponseIdFor,
};

const savedEnv = {
  INFOGENIE_API_TOKEN: process.env.INFOGENIE_API_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
};

const origFetch = global.fetch;
let networkHits = 0;

function blockLiveXai() {
  global.fetch = async (url, opts) => {
    const href = typeof url === 'string' ? url : (url && (url.href || url.url)) || '';
    if (/api\.x\.ai/i.test(String(href))) {
      networkHits += 1;
      throw new Error('network must not be called — do not hit api.x.ai');
    }
    if (typeof origFetch === 'function') return origFetch.call(global, url, opts);
    throw new Error('fetch not available');
  };
}

function restoreEnv() {
  if (savedEnv.INFOGENIE_API_TOKEN === undefined) delete process.env.INFOGENIE_API_TOKEN;
  else process.env.INFOGENIE_API_TOKEN = savedEnv.INFOGENIE_API_TOKEN;
  if (savedEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv.NODE_ENV;
}

function restoreBilly() {
  billy.chatBilly = origBilly.chatBilly;
  billy.streamBilly = origBilly.streamBilly;
  billy.newThreadId = origBilly.newThreadId;
  billy.rememberThread = origBilly.rememberThread;
  billy.lastResponseIdFor = origBilly.lastResponseIdFor;
}

let server;
let port;

function successChat() {
  return {
    configured: true,
    responseId: 'resp_test_1',
    message: { role: 'assistant', content: 'Here are three angles.' },
    usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    model: 'grok-test',
  };
}

before(async () => {
  delete process.env.INFOGENIE_API_TOKEN;
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';
  blockLiveXai();

  const app = express();
  app.use(express.json());
  app.get('/health', sendLiveness);
  app.use('/v1/billy', tokenGate, router);
  app.use('/api/billy', router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  restoreBilly();
  restoreEnv();
  global.fetch = origFetch;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  networkHits = 0;
  delete process.env.INFOGENIE_API_TOKEN;
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';
  if (typeof tokenGate._resetDevOpenWarned === 'function') tokenGate._resetDevOpenWarned();
  restoreBilly();
  billy.chatBilly = async () => successChat();
  billy.streamBilly = async (_args, handlers = {}) => {
    if (typeof handlers.onDelta === 'function') handlers.onDelta('Hello');
    if (typeof handlers.onDone === 'function') {
      handlers.onDone({
        responseId: 'resp_stream_1',
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      });
    }
    return { configured: true, responseId: 'resp_stream_1' };
  };
});

afterEach(() => {
  restoreBilly();
  restoreEnv();
  assert.equal(networkHits, 0, 'must not hit api.x.ai');
});

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        ...(payload ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          raw,
          body: json,
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('POST /v1/billy/chat without message returns 400 validation_failed', async () => {
  const res = await request('POST', '/v1/billy/chat', { body: {} });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'validation_failed');
  assert.ok(Array.isArray(res.body.issues));
});

test('POST /v1/billy/chat with message returns 200 thread/response/message/usage/ok', async () => {
  const remembered = [];
  billy.rememberThread = (threadId, responseId) => {
    remembered.push([threadId, responseId]);
  };
  billy.lastResponseIdFor = () => null;

  const res = await request('POST', '/v1/billy/chat', {
    body: { message: 'Suggest three content angles.' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(String(res.body.threadId), /^thr_/);
  assert.equal(res.body.responseId, 'resp_test_1');
  assert.deepEqual(res.body.message, { role: 'assistant', content: 'Here are three angles.' });
  assert.deepEqual(res.body.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
  assert.deepEqual(remembered, [[res.body.threadId, 'resp_test_1']]);
});

test('POST /v1/billy/chat returns 503 when stub is xai_not_configured', async () => {
  billy.chatBilly = async () => ({
    configured: false,
    error: 'xai_not_configured',
    message: 'Billy is not connected to xAI yet.',
    source: 'fallback',
  });
  const res = await request('POST', '/v1/billy/chat', {
    body: { message: 'Help me plan a campaign.' },
  });
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'xai_not_configured');
  assert.equal(typeof res.body.message, 'string');
  assert.equal(res.body.message.role, undefined);
});

test('INFOGENIE_API_TOKEN set: missing Bearer is 401; correct Bearer reaches handler', async () => {
  process.env.INFOGENIE_API_TOKEN = 'test-billy-token';
  const denied = await request('POST', '/v1/billy/chat', {
    body: { message: 'Hello Billy' },
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.ok, false);

  const wrong = await request('POST', '/v1/billy/chat', {
    body: { message: 'Hello Billy' },
    headers: { authorization: 'Bearer wrong-token-value' },
  });
  assert.equal(wrong.status, 401);

  const ok = await request('POST', '/v1/billy/chat', {
    body: { message: 'Hello Billy' },
    headers: { authorization: 'Bearer test-billy-token' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.responseId, 'resp_test_1');
});

test('INFOGENIE_API_TOKEN unset: request allowed in non-production', async () => {
  delete process.env.INFOGENIE_API_TOKEN;
  process.env.NODE_ENV = 'test';
  const res = await request('POST', '/v1/billy/chat', {
    body: { message: 'Write a short product hook.' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('POST /v1/billy/chat/stream is text/event-stream and emits done with threadId', async () => {
  const res = await request('POST', '/v1/billy/chat/stream', {
    body: { message: 'Outline a launch plan.' },
  });
  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type'] || ''), /text\/event-stream/);
  assert.match(res.raw, /event:\s*delta/);
  assert.match(res.raw, /event:\s*done/);
  assert.match(res.raw, /"threadId":"thr_/);
  assert.match(res.raw, /"responseId":"resp_stream_1"/);
});

test('GET /health alias returns ok/alive', async () => {
  const res = await request('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'alive');
  assert.equal(typeof res.body.ts, 'string');
});

test('provider error from chatBilly is 502 without a fake assistant reply', async () => {
  billy.chatBilly = async () => ({
    configured: true,
    error: 'xai_provider_error',
    message: 'Billy could not reach xAI right now.',
    source: 'fallback',
  });
  const res = await request('POST', '/v1/billy/chat', {
    body: { message: 'Anything' },
  });
  assert.equal(res.status, 502);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'xai_provider_error');
});
