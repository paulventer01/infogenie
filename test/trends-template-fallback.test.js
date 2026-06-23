// test/trends-template-fallback.test.js
//
// Verifies that POST /api/trends/detect with no platform and no PERPLEXITY_API_KEY
// falls through to the template fallback (source='template') and that every topic
// in the response has a non-empty title and why field.
//
// No network or database required. https.request is patched before the trends
// module loads; db.hasDb() returns false so no Postgres insert or tenant lookup
// happens.

require('./helpers/env');

const { test, before, after, beforeEach } = require('node:test');
const assert  = require('node:assert');
const http    = require('http');
const https   = require('https');
const express = require('express');
const { EventEmitter } = require('events');

// ── https stub ────────────────────────────────────────────────────────────────
// Intercept every outbound https.request call so no real network traffic flows.

function makeFakeReq(urlOrOpts, optsOrCb, maybeCb) {
  let cb;
  if (typeof maybeCb === 'function') {
    cb = maybeCb;
  } else if (typeof optsOrCb === 'function') {
    cb = optsOrCb;
  } else {
    const noop = new EventEmitter();
    noop.setTimeout = () => noop;
    noop.write = () => {};
    noop.destroy = () => {};
    noop.end = () => {};
    return noop;
  }
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.write      = () => {};
  req.destroy    = () => {};
  req.end        = () => {
    const res = new EventEmitter();
    res.statusCode = 503;
    cb(res);
    res.emit('data', '{}');
    res.emit('end');
  };
  return req;
}

https.request = makeFakeReq;

// ── DB stub ───────────────────────────────────────────────────────────────────
const db = require('../db');
db.hasDb  = () => false;

// ── Trends router (loaded AFTER stubs are in place) ───────────────────────────
const trendsRouter = require('../services/trends/api');

// ── Minimal Express app ────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/api/trends', trendsRouter);

// ── Test harness helpers ───────────────────────────────────────────────────────
let _server;
let _baseUrl;

before(async () => {
  _server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  _baseUrl = `http://127.0.0.1:${_server.address().port}`;
});

after(async () => {
  await new Promise(r => _server.close(r));
});

beforeEach(() => {
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.TIKTOK_RAPIDAPI_KEY;
  delete process.env.YOUTUBE_DATA_API_KEY;
  delete process.env.GOOGLE_SEARCH_API_KEY;
});

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url  = new URL(path, _baseUrl);
    const req  = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('no platform + no PERPLEXITY_API_KEY => source=template', async () => {
  const { status, body } = await post('/api/trends/detect', {
    category: 'technology',
  });

  assert.strictEqual(status, 200, 'should return HTTP 200');
  assert.strictEqual(body.ok, true, 'ok should be true');
  assert.strictEqual(body.source, 'template', 'should use template fallback when Perplexity is unavailable');
});

test('template fallback topics array is non-empty', async () => {
  const { body } = await post('/api/trends/detect', {
    category: 'fashion',
  });

  assert.ok(Array.isArray(body.topics), 'topics should be an array');
  assert.ok(body.topics.length > 0, 'topics should be non-empty');
});

test('every template topic has a non-empty title and why field', async () => {
  const { body } = await post('/api/trends/detect', {
    category: 'marketing',
  });

  assert.ok(Array.isArray(body.topics) && body.topics.length > 0, 'topics must be present');
  for (const topic of body.topics) {
    assert.ok(typeof topic.title === 'string' && topic.title.trim().length > 0,
      `topic.title must be a non-empty string, got: ${JSON.stringify(topic.title)}`);
    assert.ok(typeof topic.why === 'string' && topic.why.trim().length > 0,
      `topic.why must be a non-empty string, got: ${JSON.stringify(topic.why)}`);
  }
});

test('template fallback triggers for any category, not just a fixed one', async () => {
  const categories = ['sports', 'finance', 'health'];
  for (const category of categories) {
    const { status, body } = await post('/api/trends/detect', { category });
    assert.strictEqual(status, 200, `HTTP 200 for category=${category}`);
    assert.strictEqual(body.source, 'template', `source=template for category=${category}`);
    assert.ok(Array.isArray(body.topics) && body.topics.length > 0,
      `non-empty topics for category=${category}`);
  }
});
