'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const https = require('node:https');
const fs = require('node:fs');
const db = require('../db');
const tenant = require('../services/tenants/context');
const gate = require('../services/ai_governance/route_gate');
const orchestrator = require('../services/ai_governance/orchestrator');
const { defaultPolicy } = require('../services/ai_governance/policy');
const { normalizePressRelease } = require('../services/ai_governance/content_schemas');
const prohibited = 'guaranteed 100% returns with zero risk';

async function harness(t, options = {}) {
  const state = { images: 0, chats: 0, files: 0, rows: [], queries: [], release: {
    headline: 'Product launch', body: 'Our new product is available today.',
    quote: { text: 'We are pleased to announce our launch.', attribution: 'Jane, CEO' },
    contact: { name: 'Press Office', email: 'press@example.com' },
  } };
  const oldKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = options.template ? '_DUMMY_test' : 'test-only-key';
  t.after(() => {
    if (oldKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = oldKey;
  });
  t.mock.method(tenant, 'resolveTenantId', async req => req.tenant?.id || null);
  t.mock.method(orchestrator, 'loadPolicy', async tid => ({
    ...defaultPolicy(tid), content_safety_mode: options.warningOnly ? 'warning_only' : 'enforce',
    content_safety_explicit: true,
  }));
  t.mock.method(db, 'hasDb', () => true);
  t.mock.method(db, 'getPool', () => ({ query: async (sql, params = []) => {
    state.queries.push({ sql, params });
    if (sql.includes('INSERT INTO ad_creatives')) {
      assert.match(sql, /content_safety_warnings/);
      const row = { id: state.rows.length + 1, tenant_id: params[0], headline: params[4],
        image_url: params[9], content_safety_warnings: JSON.parse(params[13]) };
      state.rows.push(row);
      return { rows: [row] };
    }
    if (sql.includes('FROM ad_creatives')) {
      const detail = sql.includes('WHERE id=$1 AND tenant_id=$2');
      if (!detail) assert.match(sql, /WHERE tenant_id=\$1/);
      return { rows: state.rows.filter(r => r.tenant_id === (detail ? params[1] : params[0]) &&
        (!detail || r.id === params[0])) };
    }
    return { rows: [] };
  } }));
  t.mock.method(fs, 'createWriteStream', () => { state.files++; throw Error('unexpected image download'); });
  t.mock.method(https, 'request', (opts, cb) => {
    const isImage = opts.path === '/v1/images/generations';
    if (isImage) state.images++; else state.chats++;
    const response = { statusCode: isImage ? 503 : 200, on(event, fn) {
      if (event === 'data') fn(JSON.stringify(isImage ? {} : {
        choices: [{ message: { content: JSON.stringify(state.release) } }],
      }));
      if (event === 'end') fn();
      return this;
    } };
    return { on() { return this; }, setTimeout() {}, write() {}, destroy() {}, end() { cb(response); } };
  });
  if (options.throwGate) t.mock.method(gate, 'gateRouteText', async () => { throw Error('scanner down'); });
  if (options.unavailable) t.mock.method(require('../services/ai_governance/output_gate'), 'scanOutput', () => { throw Error('scanner down'); });
  const pressPath = require.resolve('../services/press_release/api');
  const adPath = require.resolve('../services/ad_creative/api');
  delete require.cache[pressPath]; delete require.cache[adPath];
  t.after(() => { delete require.cache[pressPath]; delete require.cache[adPath]; });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = Number(req.headers['x-test-tenant'] || 7);
    req.tenant = id ? { id } : null;
    req.user = { id: 5 };
    next();
  });
  app.use('/press', require(pressPath));
  app.use('/ad', require(adPath));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path, body, tid = 7) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-test-tenant': String(tid) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  }
  return { state, request };
}

const pressInput = { brand: 'Acme', context: 'Launch announcement' };
function noContent(result, status) {
  assert.equal(result.status, status);
  assert.equal(result.body.ok, false);
  for (const key of ['release', 'image_url', 'prompt', 'headline']) assert.equal(result.body[key], undefined);
  assert.ok(result.body.userMessage);
}

for (const field of ['headline', 'subhead', 'dateline', 'body', 'quote.text', 'quote.attribution', 'boilerplate', 'contact.name', 'contact.email']) {
  test(`press release blocks prohibited text in ${field}`, async t => {
    const h = await harness(t);
    const parts = field.split('.');
    if (parts.length === 2) h.state.release[parts[0]][parts[1]] = prohibited;
    else h.state.release[field] = prohibited;
    noContent(await h.request('/press/generate', pressInput), 403);
    assert.equal(h.state.rows.length, 0);
  });
}

test('press release normalizes and strips unexpected fields before response', async t => {
  const h = await harness(t);
  h.state.release.extra = { secret: prohibited };
  h.state.release.quote.extra = prohibited;
  const r = await h.request('/press/generate', pressInput);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.release, normalizePressRelease(h.state.release));
  assert.equal(r.body.release.extra, undefined);
  assert.equal(r.body.release.quote.extra, undefined);
  assert.equal(r.body.source, 'openai');
});

test('press release rejects malformed empty output', async t => {
  const h = await harness(t); h.state.release = { extra: 'no release' };
  assert.equal((await h.request('/press/generate', pressInput)).status, 502);
});

test('press release template is gated and warning-only output retains warnings', async t => {
  const h = await harness(t, { template: true, warningOnly: true });
  const r = await h.request('/press/generate', { ...pressInput, context: prohibited });
  assert.equal(r.status, 200); assert.equal(r.body.source, 'template');
  assert.ok(r.body.content_safety_warnings.length);
  assert.equal(h.state.chats, 0);
});

test('press release template cannot bypass enforcement', async t => {
  const h = await harness(t, { template: true });
  noContent(await h.request('/press/generate', { ...pressInput, context: prohibited }), 403);
  assert.equal(h.state.chats, 0);
});

for (const field of ['headline', 'body_copy', 'brand_name', 'brand_colors', 'cta_text', 'extra_context']) {
  test(`ad creative gates ${field} before image provider, file and persistence`, async t => {
    const h = await harness(t);
    noContent(await h.request('/ad/generate', { headline: 'Launch', [field]: prohibited }), 403);
    assert.equal(h.state.images, 0); assert.equal(h.state.files, 0); assert.equal(h.state.rows.length, 0);
  });
}

for (const options of [{ unavailable: true }, { throwGate: true }]) {
  test(`both surfaces fail closed on ${options.unavailable ? 'scanner' : 'gate'} exceptions`, async t => {
    const h = await harness(t, options);
    noContent(await h.request('/press/generate', pressInput), 503);
    noContent(await h.request('/ad/generate', { headline: 'Launch' }), 503);
    assert.equal(h.state.images, 0); assert.equal(h.state.files, 0); assert.equal(h.state.rows.length, 0);
  });
}

test('passing ad calls provider and persists empty warnings with tenant identity', async t => {
  const h = await harness(t);
  const r = await h.request('/ad/generate', { headline: 'New product' });
  assert.equal(r.status, 200); assert.equal(h.state.images, 1);
  assert.equal(r.body.source, 'placeholder');
  assert.deepEqual(h.state.rows[0].content_safety_warnings, []);
  assert.equal(h.state.rows[0].tenant_id, 7);
});

test('ad warning-only mode persists and retrieves warnings without cross-tenant leakage', async t => {
  const h = await harness(t, { warningOnly: true });
  const r = await h.request('/ad/generate', { headline: prohibited });
  assert.equal(r.status, 200); assert.ok(r.body.content_safety_warnings.length);
  for (const path of ['/ad/history', '/ad/1']) {
    const saved = await h.request(path);
    const item = saved.body.item || saved.body.items[0];
    assert.deepEqual(item.content_safety_warnings, r.body.content_safety_warnings);
  }
  assert.deepEqual((await h.request('/ad/history', undefined, 8)).body.items, []);
  assert.equal((await h.request('/ad/1', undefined, 8)).status, 404);
});

test('both generation routes reject missing tenant before provider work', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/press/generate', pressInput, 0)).status, 400);
  assert.equal((await h.request('/ad/generate', { headline: 'Launch' }, 0)).status, 400);
  assert.equal(h.state.chats, 0); assert.equal(h.state.images, 0);
});
