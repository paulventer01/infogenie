// test/youtube-trending-fallback.test.js
//
// Verifies that POST /api/trends/detect with platform=youtube:
//   1. Falls back to Perplexity (source='perplexity') when YOUTUBE_DATA_API_KEY
//      and GOOGLE_SEARCH_API_KEY are both absent.
//   2. Reports source='youtube' when a key is present and the API returns video data.
//   3. Falls back to Perplexity when YouTube returns a non-200 status.
//   4. Falls back to the template when both YouTube and Perplexity are unavailable.
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
    hostname = typeof urlOrOpts === 'string'
      ? new URL(urlOrOpts).hostname
      : (urlOrOpts.hostname || urlOrOpts.host || '');
    cb = maybeCb;
  } else if (typeof optsOrCb === 'function') {
    hostname = typeof urlOrOpts === 'string'
      ? new URL(urlOrOpts).hostname
      : (urlOrOpts.hostname || urlOrOpts.host || '');
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
  delete process.env.YOUTUBE_DATA_API_KEY;
  delete process.env.GOOGLE_SEARCH_API_KEY;
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

// ── YouTube canned response ───────────────────────────────────────────────────
const YOUTUBE_HOST = 'www.googleapis.com';
const YOUTUBE_DATA = {
  items: [
    {
      id: 'abc123',
      snippet: {
        title: 'Top AI trends in 2026',
        channelTitle: 'TechChannel',
        thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg' } },
      },
      statistics: { viewCount: '2500000' },
    },
    {
      id: 'def456',
      snippet: {
        title: 'Machine learning explained',
        channelTitle: 'LearnAI',
        thumbnails: { medium: { url: 'https://i.ytimg.com/vi/def456/mqdefault.jpg' } },
      },
      statistics: { viewCount: '1200000' },
    },
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

test('platform=youtube with no API key falls back to Perplexity (source=perplexity)', async () => {
  // Neither YOUTUBE_DATA_API_KEY nor GOOGLE_SEARCH_API_KEY set.
  process.env.PERPLEXITY_API_KEY = 'pplx-test-key';
  _responses[PERPLEXITY_HOST] = { status: 200, body: PERPLEXITY_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'technology',
    platform: 'youtube',
  });

  assert.strictEqual(status, 200, 'should return HTTP 200');
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.source, 'perplexity', 'should fall back to perplexity');
  assert.ok(Array.isArray(body.topics) && body.topics.length > 0, 'should have topics');
  assert.strictEqual(body.topics[0].title, 'AI regulation 2026');
});

test('platform=youtube with YOUTUBE_DATA_API_KEY set to _DUMMY falls back to Perplexity', async () => {
  process.env.YOUTUBE_DATA_API_KEY = '_DUMMY_KEY';
  process.env.PERPLEXITY_API_KEY   = 'pplx-test-key';
  _responses[PERPLEXITY_HOST] = { status: 200, body: PERPLEXITY_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'music',
    platform: 'youtube',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'perplexity', '_DUMMY key must be treated as absent');
});

test('platform=youtube with GOOGLE_SEARCH_API_KEY set to _DUMMY falls back to Perplexity', async () => {
  process.env.GOOGLE_SEARCH_API_KEY = '_DUMMY_GOOGLE';
  process.env.PERPLEXITY_API_KEY    = 'pplx-test-key';
  _responses[PERPLEXITY_HOST] = { status: 200, body: PERPLEXITY_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'gaming',
    platform: 'youtube',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'perplexity', 'GOOGLE_SEARCH_API_KEY _DUMMY must be treated as absent');
});

test('platform=youtube with valid key and YouTube returns data => source=youtube', async () => {
  process.env.YOUTUBE_DATA_API_KEY = 'yt-live-api-key';
  _responses[YOUTUBE_HOST] = { status: 200, body: YOUTUBE_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'technology',
    platform: 'youtube',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.source, 'youtube', 'should report youtube as source');
  assert.ok(Array.isArray(body.topics) && body.topics.length >= 2);
  assert.ok(body.topics[0].title.includes('Top AI trends in 2026'));
  assert.ok(Array.isArray(body.topics[0].sources) && body.topics[0].sources[0].includes('abc123'));
  assert.ok(body.topics[0].thumbnail, 'thumbnail should be present');
});

test('platform=youtube uses GOOGLE_SEARCH_API_KEY fallback when YOUTUBE_DATA_API_KEY absent', async () => {
  // Only GOOGLE_SEARCH_API_KEY is set (no YOUTUBE_DATA_API_KEY)
  process.env.GOOGLE_SEARCH_API_KEY = 'google-search-key';
  _responses[YOUTUBE_HOST] = { status: 200, body: YOUTUBE_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'sports',
    platform: 'youtube',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'youtube', 'GOOGLE_SEARCH_API_KEY should serve as YouTube key fallback');
  assert.ok(Array.isArray(body.topics) && body.topics.length >= 2);
});

test('platform=youtube with valid key but YouTube returns non-200 falls back to Perplexity', async () => {
  process.env.YOUTUBE_DATA_API_KEY = 'yt-live-api-key';
  process.env.PERPLEXITY_API_KEY   = 'pplx-test-key';
  _responses[YOUTUBE_HOST]      = { status: 403, body: { error: { message: 'API key not valid.' } } };
  _responses[PERPLEXITY_HOST]   = { status: 200, body: PERPLEXITY_DATA };

  const { status, body } = await post('/api/trends/detect', {
    category: 'entertainment',
    platform: 'youtube',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'perplexity', 'non-200 YouTube response should fall back to perplexity');
  assert.strictEqual(body.topics[0].title, 'AI regulation 2026');
});

test('platform=youtube with no key and no Perplexity key => template fallback', async () => {
  // Neither key set — should land on template.

  const { status, body } = await post('/api/trends/detect', {
    category: 'fashion',
    platform: 'youtube',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.source, 'template', 'should use template when both sources unavailable');
  assert.ok(Array.isArray(body.topics) && body.topics.length > 0);
});
