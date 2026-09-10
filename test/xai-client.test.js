'use strict';
// Dummy-key / no-network tests for services/xai/client.js.
// Never hits api.x.ai — fetch is stubbed whenever a request would otherwise fire.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const KEY_VARS = ['XAI_API_KEY', 'XAI_KEY', 'XAI_MODEL'];
const saved = {};
const realFetch = global.fetch;

before(() => {
  for (const k of KEY_VARS) saved[k] = process.env[k];
});

after(() => {
  global.fetch = realFetch;
  for (const k of KEY_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(() => {
  for (const k of KEY_VARS) delete process.env[k];
  global.fetch = async () => {
    throw new Error('xai-client test: unexpected fetch — live xAI must not be called');
  };
});

const xai = require('../services/xai/client.js');

test('isUsableXaiKey is false for empty, null, and _DUMMY_XAI', () => {
  assert.equal(xai.isUsableXaiKey(''), false);
  assert.equal(xai.isUsableXaiKey(null), false);
  assert.equal(xai.isUsableXaiKey(undefined), false);
  assert.equal(xai.isUsableXaiKey('_DUMMY_XAI'), false);
  assert.equal(xai.isUsableXaiKey('_dummy_key'), false);
});

test('isUsableXaiKey is true for a non-dummy string', () => {
  assert.equal(xai.isUsableXaiKey('xai-real-looking-key'), true);
});

test('defaultModel is grok-4.6 unless XAI_MODEL is set', () => {
  assert.equal(xai.defaultModel(), 'grok-4.6');
  process.env.XAI_MODEL = 'grok-4';
  assert.equal(xai.defaultModel(), 'grok-4');
});

test('XAI_RESPONSES_URL is the Responses API', () => {
  assert.equal(xai.XAI_RESPONSES_URL, 'https://api.x.ai/v1/responses');
});

test('buildResponseBody includes model, instructions, input, store:true', () => {
  const body = xai.buildResponseBody({
    instructions: 'You are a test harness',
    input: 'hello',
    model: 'grok-4.6',
  });
  assert.equal(body.model, 'grok-4.6');
  assert.equal(body.instructions, 'You are a test harness');
  assert.equal(body.input, 'hello');
  assert.equal(body.store, true);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'previous_response_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'stream'), false);
});

test('buildResponseBody omits previous_response_id when null/empty and includes it when set', () => {
  const omitted = xai.buildResponseBody({ input: 'hi', previousResponseId: null });
  assert.equal(omitted.previous_response_id, undefined);
  const empty = xai.buildResponseBody({ input: 'hi', previousResponseId: '' });
  assert.equal(empty.previous_response_id, undefined);
  const set = xai.buildResponseBody({ input: 'hi', previousResponseId: 'resp_abc' });
  assert.equal(set.previous_response_id, 'resp_abc');
});

test('buildResponseBody stream flag is true only when requested', () => {
  const streamed = xai.buildResponseBody({ input: 'hi', stream: true });
  assert.equal(streamed.stream, true);
  const off = xai.buildResponseBody({ input: 'hi', stream: false });
  assert.equal(off.stream, undefined);
  const user = xai.buildResponseBody({ input: 'hi', user: 'user-9' });
  assert.equal(user.user, 'user-9');
});

test('createResponse with _DUMMY key does not call fetch and throws xai_not_configured', async () => {
  process.env.XAI_API_KEY = '_DUMMY_XAI';
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('fetch must not run for dummy key');
  };
  await assert.rejects(
    () => xai.createResponse({ instructions: 'sys', input: 'hi' }),
    (err) => {
      assert.match(String(err.message), /xai_not_configured/);
      assert.equal(err.status, 503);
      assert.equal(err.code, 503);
      return true;
    },
  );
  assert.equal(called, false, 'fetch must not be invoked for a dummy key');
});

test('createResponse with unset key does not call fetch and throws xai_not_configured', async () => {
  delete process.env.XAI_API_KEY;
  delete process.env.XAI_KEY;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('fetch must not run when key is unset');
  };
  await assert.rejects(
    () => xai.createResponse({ input: 'hi' }),
    (err) => {
      assert.match(String(err.message), /xai_not_configured/);
      assert.equal(err.status, 503);
      return true;
    },
  );
  assert.equal(called, false, 'fetch must not be invoked when key is unset');
});

test('streamResponse with dummy key calls onError and does not fetch', async () => {
  process.env.XAI_API_KEY = '_DUMMY_XAI';
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('fetch must not run for dummy stream');
  };
  let err = null;
  await xai.streamResponse({ input: 'hi' }, {
    onError(e) { err = e; },
    onDone() { throw new Error('onDone should not run'); },
  });
  assert.equal(called, false);
  assert.ok(err);
  assert.match(String(err.message), /xai_not_configured/);
  assert.equal(err.status, 503);
});

test('createResponse parses output_text and usage from a stubbed Responses payload', async () => {
  process.env.XAI_API_KEY = 'test-xai-key-not-dummy';
  let fetchUrl = null;
  let fetchInit = null;
  global.fetch = async (url, init) => {
    fetchUrl = url;
    fetchInit = init;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: 'resp_1',
          output_text: 'Hello from stub',
          usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
        });
      },
    };
  };
  const out = await xai.createResponse({ instructions: 'sys', input: 'ping', user: 'u1' });
  assert.equal(fetchUrl, xai.XAI_RESPONSES_URL);
  assert.equal(fetchInit.method, 'POST');
  assert.match(fetchInit.headers.Authorization, /^Bearer test-xai-key-not-dummy$/);
  const sent = JSON.parse(fetchInit.body);
  assert.equal(sent.model, 'grok-4.6');
  assert.equal(sent.instructions, 'sys');
  assert.equal(sent.input, 'ping');
  assert.equal(sent.store, true);
  assert.equal(sent.user, 'u1');
  assert.equal(sent.stream, undefined);
  assert.equal(out.id, 'resp_1');
  assert.equal(out.outputText, 'Hello from stub');
  assert.deepEqual(out.usage, { inputTokens: 4, outputTokens: 6, totalTokens: 10 });
});

test('createResponse falls back to output[].content[].text when output_text is absent', async () => {
  process.env.XAI_API_KEY = 'test-xai-key-not-dummy';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        id: 'resp_2',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'From content array' }],
        }],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      });
    },
  });
  const out = await xai.createResponse({ input: 'ping' });
  assert.equal(out.outputText, 'From content array');
  assert.deepEqual(out.usage, { inputTokens: 1, outputTokens: 2, totalTokens: 3 });
});

test('createResponse maps missing usage to zeros and throws on HTTP error without logging the key', async () => {
  process.env.XAI_API_KEY = 'test-xai-key-not-dummy';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ id: 'resp_3', output_text: 'ok' }); },
  });
  const ok = await xai.createResponse({ input: 'ping' });
  assert.deepEqual(ok.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });

  global.fetch = async () => ({
    ok: false,
    status: 401,
    async text() { return '{"error":"invalid_api_key"}'; },
  });
  await assert.rejects(
    () => xai.createResponse({ input: 'ping' }),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(String(err.message), /401/);
      assert.doesNotMatch(String(err.message), /test-xai-key-not-dummy/);
      return true;
    },
  );
});

function sseBody(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

test('streamResponse reads SSE data: lines and event/data pairs then calls onDone', async () => {
  process.env.XAI_API_KEY = 'test-xai-key-not-dummy';
  const sse = [
    'data: {"type":"response.output_text.delta","delta":"Hel"}',
    '',
    'event: response.output_text.delta',
    'data: {"text":"lo"}',
    '',
    'data: {"type":"response.delta","delta":"!"}',
    '',
    'data: {"type":"response.completed","response":{"id":"resp_stream","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  let sentBody = null;
  global.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, body: sseBody(sse) };
  };

  const chunks = [];
  let done = null;
  await xai.streamResponse({ instructions: 'sys', input: 'hi', previousResponseId: 'resp_prev' }, {
    onDelta(t) { chunks.push(t); },
    onDone(info) { done = info; },
    onError(e) { throw e; },
  });
  assert.equal(sentBody.stream, true);
  assert.equal(sentBody.previous_response_id, 'resp_prev');
  assert.deepEqual(chunks, ['Hel', 'lo', '!']);
  assert.equal(done.responseId, 'resp_stream');
  assert.deepEqual(done.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
});
