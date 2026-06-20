'use strict';
// Guard test for the GPT-5 param-compat shim (services/ai_compat.js).
//
// GPT-5 reasoning models reject `max_tokens` and non-default `temperature`/`top_p`
// and starve their output unless `reasoning_effort:'minimal'` is set. The shim
// normalizes those params. This test fails if:
//   1. normalizeChatParams() stops rewriting gpt-5* params (or starts touching others), or
//   2. the global HTTP interception stops normalizing raw chat/completions bodies
//      sent via `fetch` OR `https/http.request` (the many non-SDK call sites).
//
// We capture the EXACT bytes each transport sends to a chat/completions URL by
// pointing the request at a local http server, proving normalization happens on
// the wire regardless of how a caller builds the request.

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { normalizeChatParams, isGpt5, patchHttp } = require('../services/ai_compat');

patchHttp(); // install global fetch + http(s).request interception (idempotent)

// ── Unit: normalizeChatParams ───────────────────────────────────────────────
test('normalizeChatParams rewrites gpt-5* params', () => {
  const out = normalizeChatParams({
    model: 'gpt-5-mini', temperature: 0.3, top_p: 0.5,
    frequency_penalty: 0.2, presence_penalty: 0.2,
    max_tokens: 600, response_format: { type: 'json_object' },
  });
  assert.strictEqual(out.max_tokens, undefined, 'max_tokens dropped');
  assert.strictEqual(out.max_completion_tokens, 600, 'budget preserved as max_completion_tokens');
  assert.strictEqual(out.temperature, undefined, 'non-default temperature dropped');
  assert.strictEqual(out.top_p, undefined, 'non-default top_p dropped');
  assert.strictEqual(out.frequency_penalty, undefined, 'frequency_penalty dropped');
  assert.strictEqual(out.presence_penalty, undefined, 'presence_penalty dropped');
  assert.strictEqual(out.reasoning_effort, 'minimal', 'reasoning_effort defaulted to minimal');
  assert.deepStrictEqual(out.response_format, { type: 'json_object' }, 'response_format preserved');
});

test('normalizeChatParams leaves non-gpt-5 models untouched', () => {
  const input = { model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 600 };
  assert.deepStrictEqual(normalizeChatParams({ ...input }), input);
  assert.strictEqual(isGpt5('gpt-5-mini'), true);
  assert.strictEqual(isGpt5('gpt-4o-mini'), false);
});

// ── Helper: spin up a local server that echoes the received POST body ────────
function withCaptureServer(run) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        server._captured = { body, contentLength: req.headers['content-length'] };
      });
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        await run(port, () => server._captured);
        resolve();
      } catch (e) { reject(e); }
      finally { server.close(); }
    });
    server.on('error', reject);
  });
}

const RAW_BODY = JSON.stringify({
  model: 'gpt-5-mini',
  messages: [{ role: 'user', content: 'hi json' }],
  temperature: 0.7,
  max_tokens: 500,
});

function assertNormalized(captured) {
  const sent = JSON.parse(captured.body);
  assert.strictEqual(sent.max_tokens, undefined, 'wire body must not contain max_tokens');
  assert.strictEqual(sent.max_completion_tokens, 500, 'wire body must use max_completion_tokens');
  assert.strictEqual(sent.temperature, undefined, 'wire body must drop non-default temperature');
  assert.strictEqual(sent.reasoning_effort, 'minimal', 'wire body must set reasoning_effort');
  assert.strictEqual(
    Number(captured.contentLength), Buffer.byteLength(captured.body),
    'Content-Length must match the rewritten body',
  );
}

// ── fetch interception ───────────────────────────────────────────────────────
test('global fetch normalizes raw gpt-5 chat/completions body', async () => {
  await withCaptureServer(async (port, captured) => {
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: RAW_BODY,
    });
    assertNormalized(captured());
  });
});

test('global fetch leaves non-chat URLs untouched', async () => {
  await withCaptureServer(async (port, captured) => {
    await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: RAW_BODY,
    });
    const sent = JSON.parse(captured().body);
    assert.strictEqual(sent.max_tokens, 500, 'non-chat URL body passes through untouched');
  });
});

// ── http.request interception (write + end) ──────────────────────────────────
test('http.request normalizes raw gpt-5 body written via req.write/end', async () => {
  await withCaptureServer(async (port, captured) => {
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(RAW_BODY) },
      }, res => { res.on('data', () => {}); res.on('end', resolve); });
      req.on('error', reject);
      req.write(RAW_BODY);
      req.end();
    });
    assertNormalized(captured());
  });
});

test('http.request normalizes raw gpt-5 body passed to req.end', async () => {
  await withCaptureServer(async (port, captured) => {
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(RAW_BODY) },
      }, res => { res.on('data', () => {}); res.on('end', resolve); });
      req.on('error', reject);
      req.end(RAW_BODY);
    });
    assertNormalized(captured());
  });
});
