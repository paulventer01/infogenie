// test/tiktok-trending-fallback.test.js
//
// Verifies that POST /api/trends/detect with platform=tiktok:
//   1. Falls back to Perplexity (source='perplexity') when TIKTOK_RAPIDAPI_KEY is absent.
//   2. Reports source='tiktok' when the key is present and TikTok returns data.
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

// ── https stub ───────────────────────────────────────────────────────────────
// Intercept every outbound https.request call. Tests control responses via
// the _responses map keyed on hostname.

const _responses = {};

function makeFakeReq(urlOrOpts, optsOrCb, maybeCb) {
  // https.request supports two call signatures:
  //   request(options[, callback])     — 2-arg
  //   request(url, options[, callback]) — 3-arg (url string + options object + callback)
  let hostname, cb;
  if (typeof maybeCb === 'function') {
    // 3-arg form: request(url, options, callback)
    hostname = typeof urlOrOpts === 'string'
      ? new URL(urlOrOpts).hostname
      : (urlOrOpts.hostname || urlOrOpts.host || '');
    cb = maybeCb;
  } else if (typeof optsOrCb === 'function') {
    // 2-arg form: request(options, callback)
    hostname = typeof urlOrOpts === 'string'
      ? new URL(urlOrOpts).hostname
      : (urlOrOpts.hostname || urlOrOpts.host || '');
    cb = optsOrCb;
  } else {
    // No callback — return a stub req that does nothing.
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
    const entry = _responses[hostname];
    const statusCode = entry ? entry.status : 404;
    const body       = entry ? entry.body   : {};
    const res = new EventEmitter();
    res.statusCode = statusCode;
    cb(res);
    res.emit('data', JSON.stringify(body));
    res.emit('end');
  };
  return req;
}

https.request = makeFakeReq;

// ── DB stub ──────────────────────────────────────────────────────────────────
const db = require('../db');
db.hasDb  = () => false;

// ── Trends router (loaded AFTER stubs are in place) ──────────────────────────
const trendsRouter = require('../services/trends/api');

// ── Minimal Express app ───────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/api/trends', trendsRouter);

// ── Test harness helpers ──────────────────────────────────────────────────────
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
  // Reset env keys and canned responses before each test.
  delete process.env.TIKTOK_RAPIDAPI_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  for (const k of Object.keys(_responses)) delete _responses[k];
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

// ── TikTok canned response ────────────────────────────────────────────────────
const TIKTOK_HOST = 'tiktok-scraper7.p.rapidapi.com';
const TIKTOK_DATA = {
  data: [
    { title: 'Viral dance challenge', author: { nickname: 'dancer99' }, playCount: 1000000, diggCount: 50000,
      webVideoUrl: 'https://www.tiktok.com/@dancer99/video/123' },
    { title: 'Cooking hack #fyp',    author: { nickname: 'chef_tk'  }, playCount:  500000, diggCount: 20000,
      webVideoUrl: 'https://www.tiktok.com/@chef_tk/video/456' },
  ],
};

// ── Perplexity canned response ────────────────────────────────────────────────
const PERPLEXITY_HOST = 'api.perplexity.ai';
const PERPLEXITY_DATA = {
  choices: [{
    message: {
      content: JSON.stringify({
        topics: [
          { title: 'AI regulation 2026', why: 'Major legislation passed this week.', sources: ['https://example.com/ai'] },
          { title: 'Climate summit',     why: 'World leaders convene.',              sources: ['https://example.com/climate'] },
        ],
      }),
    },
  }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('platform=tiktok with no API key falls back to Perplexity (source=perplexity)', async () => {
  // No TIKTOK_RAPIDAPI_KEY set.
  process.env.PERPLEXITY_API_KEY = 'pplx-test-key';
  _responses[PERPLEXITY_HOST] = { status: 200, body: PERPLEXITY_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'technology',
    platform: 'tiktok',
  });

  assert.strictEqual(status, 200, 'should return HTTP 200');
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.source, 'perplexity', 'should fall back to perplexity');
  assert.ok(Array.isArray(body.topics) && body.topics.length > 0, 'should have topics');
  assert.strictEqual(body.topics[0].title, 'AI regulation 2026');
});

test('platform=tiktok with key set to _DUMMY falls back to Perplexity', async () => {
  process.env.TIKTOK_RAPIDAPI_KEY  = '_DUMMY_KEY';
  process.env.PERPLEXITY_API_KEY   = 'pplx-test-key';
  _responses[PERPLEXITY_HOST] = { status: 200, body: PERPLEXITY_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'food',
    platform: 'tiktok',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'perplexity', '_DUMMY key must be treated as absent');
});

test('platform=tiktok with valid key and TikTok data => source=tiktok', async () => {
  process.env.TIKTOK_RAPIDAPI_KEY = 'rapidapi-live-key';
  _responses[TIKTOK_HOST] = { status: 200, body: TIKTOK_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'entertainment',
    platform: 'tiktok',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.source, 'tiktok', 'should report tiktok as source');
  assert.ok(Array.isArray(body.topics) && body.topics.length >= 2);
  assert.ok(body.topics[0].title.includes('Viral dance challenge'));
});

test('platform=tiktok with valid key but TikTok returns non-200 falls back to Perplexity', async () => {
  process.env.TIKTOK_RAPIDAPI_KEY = 'rapidapi-live-key';
  process.env.PERPLEXITY_API_KEY  = 'pplx-test-key';
  _responses[TIKTOK_HOST]      = { status: 403, body: { message: 'Forbidden' } };
  _responses[PERPLEXITY_HOST]  = { status: 200, body: PERPLEXITY_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'sports',
    platform: 'tiktok',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'perplexity', 'bad TikTok response should fall back to perplexity');
});

test('platform=tiktok with no key and no Perplexity key => template fallback', async () => {
  // Neither key set — should land on template.

  const { status, body } = await post('/api/trends/detect', {
    category: 'fashion',
    platform: 'tiktok',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'template', 'should use template when both sources unavailable');
  assert.ok(Array.isArray(body.topics) && body.topics.length > 0);
});
