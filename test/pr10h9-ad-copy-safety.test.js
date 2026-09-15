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
const { normalizeAdScore, normalizeUgcScript, normalizeAdPackages } = require('../services/ai_governance/content_schemas');
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
    if (sql.includes('FROM landing_pages')) {
      assert.match(sql, /WHERE id=\$1 AND tenant_id=\$2/);
      assert.deepEqual(params.slice(0, 1), [11]);
      return { rows: params[1] === 7 ? [{ id: 11, brand: 'Acme', title: 'Launch', content: state.pageContent || {} }] : [] };
    }
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
        choices: [{ message: { content: state.raw ?? JSON.stringify(state.release) } }],
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

const cases = [
  { route: '/score', input: { headline: 'New product' }, normalizer: normalizeAdScore,
    output: { overall: 70, verdict: 'Useful creative', scores: { hook_strength: 7 },
      ctr_range: { low: '0.5%', high: '1.0%' }, grade: 'B', tips: [{ dimension: 'hook', tip: 'Use clear copy' }] },
    fields: ['verdict', 'ctr_range.low', 'ctr_range.high', 'tips.0.dimension', 'tips.0.tip'] },
  { route: '/ugc-script', input: { product: 'Acme' }, normalizer: normalizeUgcScript,
    output: { scenes: [{ timestamp: '0-3s', type: 'hook', script: 'Try this product', direction: 'Face camera', text_overlay: 'Available today' }],
      caption: 'Introducing Acme', hashtags: ['acme'], creator_tips: ['Use daylight'] },
    fields: ['scenes.0.timestamp', 'scenes.0.type', 'scenes.0.script', 'scenes.0.direction', 'scenes.0.text_overlay', 'caption', 'hashtags.0', 'creator_tips.0'] },
  { route: '/from-landing-page', input: { page_id: 11 }, normalizer: normalizeAdPackages,
    output: { packages: [{ platform: 'Meta', formats: ['square'], headline: 'Launch', primary_text: 'Available today', description: 'Try Acme',
      cta_button: 'Learn more', notes: 'Use an illustration', hook: 'Ready for Acme?', script_summary: 'Introduce the product', hashtags: ['acme'] }] },
    fields: ['packages.0.platform', 'packages.0.formats.0', 'packages.0.headline', 'packages.0.primary_text', 'packages.0.description',
      'packages.0.cta_button', 'packages.0.notes', 'packages.0.hook', 'packages.0.script_summary', 'packages.0.hashtags.0'] },
];
function setField(object, field, value) {
  const keys = field.split('.'); const last = keys.pop();
  keys.reduce((o, k) => o[k], object)[last] = value;
}
function assertBlocked(r, status) {
  assert.equal(r.status, status); assert.equal(r.body.ok, false); assert.ok(r.body.userMessage);
  for (const field of ['scores', 'overall', 'verdict', 'tips', 'scenes', 'caption', 'packages']) assert.equal(r.body[field], undefined);
}
for (const c of cases) {
  for (const field of c.fields) {
    test(`${c.route} blocks prohibited ${field}`, async t => {
      const h = await harness(t); h.state.release = structuredClone(c.output);
      setField(h.state.release, field, prohibited);
      assertBlocked(await h.request('/ad' + c.route, c.input), 403);
      assert.equal(h.state.rows.length, 0); assert.equal(h.state.images, 0);
    });
  }
  test(`${c.route} strips unexpected fields and ignores spoofed response authority`, async t => {
    const h = await harness(t); h.state.release = { ...structuredClone(c.output), extra: prohibited,
      ok: false, source: 'spoof', content_safety_warnings: ['spoof'] };
    const r = await h.request('/ad' + c.route, c.input);
    assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.source, 'openai');
    assert.equal(r.body.extra, undefined); assert.ok(!r.body.content_safety_warnings?.includes('spoof'));
    for (const [key, value] of Object.entries(c.normalizer(h.state.release))) assert.deepEqual(r.body[key], value);
  });
  test(`${c.route} warning-only returns flagged content with warnings`, async t => {
    const h = await harness(t, { warningOnly: true }); h.state.release = structuredClone(c.output);
    setField(h.state.release, c.fields[0], prohibited);
    const r = await h.request('/ad' + c.route, c.input);
    assert.equal(r.status, 200); assert.ok(r.body.content_safety_warnings.length);
  });
  for (const options of [{ unavailable: true }, { throwGate: true }]) {
    test(`${c.route} fails closed for ${options.unavailable ? 'scanner' : 'gate'} failure without template escape`, async t => {
      const h = await harness(t, options); h.state.release = c.output;
      assertBlocked(await h.request('/ad' + c.route, c.input), 503);
      assert.equal(h.state.rows.length, 0);
    });
  }
  test(`${c.route} rejects empty and malformed model output`, async t => {
    const h = await harness(t); h.state.release = {};
    assert.equal((await h.request('/ad' + c.route, c.input)).status, 502);
    h.state.raw = 'not json';
    assert.equal((await h.request('/ad' + c.route, c.input)).status, 502);
  });
  test(`${c.route} template is also gated`, async t => {
    const h = await harness(t, { template: true, throwGate: true });
    assertBlocked(await h.request('/ad' + c.route, c.input), 503);
    assert.equal(h.state.chats, 0);
  });
  test(`${c.route} requires a tenant before calling the provider`, async t => {
    const h = await harness(t);
    assert.equal((await h.request('/ad' + c.route, c.input, 0)).status, 400);
    assert.equal(h.state.chats, 0);
  });
}

test('UGC template blocks prohibited product text; landing-page template blocks prohibited stored text', async t => {
  const h = await harness(t, { template: true });
  assertBlocked(await h.request('/ad/ugc-script', { product: prohibited }), 403);
  h.state.pageContent = { subhead: prohibited };
  assertBlocked(await h.request('/ad/from-landing-page', { page_id: 11 }), 403);
  assert.equal(h.state.chats, 0);
});

test('landing-page packages cannot read another tenant page or call AI for it', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/ad/from-landing-page', { page_id: 11 }, 8)).status, 404);
  assert.equal(h.state.chats, 0);
});

test('score normalization distinguishes zero from missing and rejects invalid numeric metadata', () => {
  const score = normalizeAdScore({ overall: 0, scores: { hook_strength: 0, urgency: false, relevance: 'invalid' }, grade: 'invalid' });
  assert.equal(score.overall, 0); assert.equal(score.scores.hook_strength, 0);
  assert.equal(score.scores.urgency, null); assert.equal(score.scores.relevance, null);
  assert.equal(score.scores.cta_clarity, null); assert.equal(score.grade, null);
  for (const overall of [null, false, [], {}, '   ']) assert.equal(normalizeAdScore({ overall }).overall, null);
});

test('normalization bounds lists and strips nested surplus keys', () => {
  const ugc = normalizeUgcScript({ scenes: Array(20).fill({ script: 'hello', extra: prohibited }), hashtags: Array(40).fill('tag') });
  assert.equal(ugc.scenes.length, 12); assert.equal(ugc.hashtags.length, 30); assert.equal(ugc.scenes[0].extra, undefined);
  const ads = normalizeAdPackages({ packages: Array(5).fill({ headline: 'hello', extra: prohibited }) });
  assert.equal(ads.packages.length, 3); assert.equal(ads.packages[0].extra, undefined);
});

for (const c of cases) {
  test(`${c.route} scans decoded newlines and tabs, not JSON escape sequences`, async t => {
    const h = await harness(t);
    for (const text of ['guaranteed\nreturns', 'guaranteed\treturns']) {
      h.state.release = structuredClone(c.output);
      setField(h.state.release, c.fields[0], text);
      assertBlocked(await h.request('/ad' + c.route, c.input), 403);
    }
  });
}
