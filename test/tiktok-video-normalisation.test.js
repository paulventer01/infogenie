'use strict';
// Guard test for the _tiktok normalisation layer in services/trends/api.js
//
// _tiktok handles multiple API response shape variants defensively:
//   • top-level array key:  j.data | j.result
//   • per-item title field: item.title | item.desc | item.text
//   • per-item author:      item.author?.nickname | item.authorMeta?.name
//   • per-item plays:       item.playCount | item.stats?.playCount
//   • per-item video URL:   item.webVideoUrl | item.video?.webVideoUrl
//                           (fallback: constructed tiktok.com/@author/video/id URL)
//
// This test feeds canned payloads through the function (https.request is stubbed)
// to ensure every known variant produces well-formed topic objects with
// type === 'video', a non-empty title, and at least one source URL.

const { test, after } = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { EventEmitter } = require('events');

// ── Stub https.request before requiring the module ──────────────────────────
// _tiktok captures `require('https')` as `_https` at module load time.
// Because require() returns the same cached object, patching `.request` here
// affects _https.request inside the module too.

const _origRequest = https.request;
let _stubbedBody = null;

https.request = function (url, optsOrCb, maybeCb) {
  const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.destroy = () => {};
  req.end = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    cb(res);
    res.emit('data', JSON.stringify(_stubbedBody));
    res.emit('end');
  };
  return req;
};

// Set a non-dummy key so the early-bail guard doesn't skip the call
const _origKey = process.env.TIKTOK_RAPIDAPI_KEY;
process.env.TIKTOK_RAPIDAPI_KEY = 'test-rapidapi-key';

const router = require('../services/trends/api');
const _tiktok = router._tiktok;

after(() => {
  https.request = _origRequest;
  if (_origKey === undefined) {
    delete process.env.TIKTOK_RAPIDAPI_KEY;
  } else {
    process.env.TIKTOK_RAPIDAPI_KEY = _origKey;
  }
});

// ── Helper ───────────────────────────────────────────────────────────────────
function setBody(body) { _stubbedBody = body; }

function assertValidVideoTopic(t, label) {
  assert.strictEqual(t.type, 'video', `${label}: type should be 'video'`);
  assert.ok(typeof t.title === 'string' && t.title.length > 0, `${label}: title should be a non-empty string`);
  assert.ok(Array.isArray(t.sources) && t.sources.length > 0, `${label}: sources should be a non-empty array`);
  assert.ok(
    t.sources[0].includes('tiktok.com'),
    `${label}: sources[0] should be a TikTok URL (got: ${t.sources[0]})`
  );
  assert.ok(typeof t.why === 'string' && t.why.length > 0, `${label}: why should be a non-empty string`);
}

// ── Top-level array shape variants ──────────────────────────────────────────

test('_tiktok: j.data array shape returns valid topics', async () => {
  setBody({ data: [{ title: 'My Video', playCount: 1000000, webVideoUrl: 'https://www.tiktok.com/@user/video/123' }] });
  const topics = await _tiktok({ category: 'fitness' });
  assert.ok(Array.isArray(topics) && topics.length === 1, 'should return one topic');
  assertValidVideoTopic(topics[0], 'j.data');
  assert.strictEqual(topics[0].title, 'My Video');
});

test('_tiktok: j.result array shape returns valid topics', async () => {
  setBody({ result: [{ title: 'Another Video', playCount: 500000, webVideoUrl: 'https://www.tiktok.com/@user/video/456' }] });
  const topics = await _tiktok({ category: 'travel' });
  assert.ok(Array.isArray(topics) && topics.length === 1, 'should return one topic');
  assertValidVideoTopic(topics[0], 'j.result');
  assert.strictEqual(topics[0].title, 'Another Video');
});

// ── Per-item title field name variants ────────────────────────────────────────

test('_tiktok: item.title field variant', async () => {
  setBody({ data: [{ title: 'Title Field Video', webVideoUrl: 'https://www.tiktok.com/@u/video/1' }] });
  const topics = await _tiktok({ category: 'food' });
  assert.ok(topics && topics.length === 1);
  assertValidVideoTopic(topics[0], 'title');
  assert.strictEqual(topics[0].title, 'Title Field Video');
});

test('_tiktok: item.desc field variant', async () => {
  setBody({ data: [{ desc: 'Desc Field Video', webVideoUrl: 'https://www.tiktok.com/@u/video/2' }] });
  const topics = await _tiktok({ category: 'food' });
  assert.ok(topics && topics.length === 1);
  assertValidVideoTopic(topics[0], 'desc');
  assert.strictEqual(topics[0].title, 'Desc Field Video');
});

test('_tiktok: item.text field variant', async () => {
  setBody({ data: [{ text: 'Text Field Video', webVideoUrl: 'https://www.tiktok.com/@u/video/3' }] });
  const topics = await _tiktok({ category: 'food' });
  assert.ok(topics && topics.length === 1);
  assertValidVideoTopic(topics[0], 'text');
  assert.strictEqual(topics[0].title, 'Text Field Video');
});

test('_tiktok: falls back to "Untitled" when no title field exists', async () => {
  setBody({ data: [{ playCount: 100, webVideoUrl: 'https://www.tiktok.com/@u/video/4' }] });
  const topics = await _tiktok({ category: 'food' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].title, 'Untitled');
});

// ── Per-item author field name variants ───────────────────────────────────────

test('_tiktok: item.author.nickname author variant', async () => {
  setBody({ data: [{ title: 'Video', author: { nickname: 'coolcreator' }, playCount: 200, webVideoUrl: 'https://www.tiktok.com/@coolcreator/video/5' }] });
  const topics = await _tiktok({ category: 'sports' });
  assert.ok(topics && topics.length === 1);
  assert.ok(topics[0].why.includes('@coolcreator'), 'why should include author nickname');
});

test('_tiktok: item.authorMeta.name author variant', async () => {
  setBody({ data: [{ title: 'Video', authorMeta: { name: 'metacreator' }, playCount: 300, webVideoUrl: 'https://www.tiktok.com/@metacreator/video/6' }] });
  const topics = await _tiktok({ category: 'sports' });
  assert.ok(topics && topics.length === 1);
  assert.ok(topics[0].why.includes('@metacreator'), 'why should include authorMeta name');
});

// ── Per-item play count field name variants ───────────────────────────────────

test('_tiktok: item.playCount field variant', async () => {
  setBody({ data: [{ title: 'Play Count Video', playCount: 9999999, webVideoUrl: 'https://www.tiktok.com/@u/video/7' }] });
  const topics = await _tiktok({ category: 'music' });
  assert.ok(topics && topics.length === 1);
  assert.ok(topics[0].why.includes('9,999,999'), 'why should include formatted play count');
});

test('_tiktok: item.stats.playCount field variant', async () => {
  setBody({ data: [{ title: 'Stats Play Count', stats: { playCount: 4000000 }, webVideoUrl: 'https://www.tiktok.com/@u/video/8' }] });
  const topics = await _tiktok({ category: 'music' });
  assert.ok(topics && topics.length === 1);
  assert.ok(topics[0].why.includes('4,000,000'), 'why should include formatted stats.playCount');
});

// ── Per-item video URL field name variants ────────────────────────────────────

test('_tiktok: item.webVideoUrl field variant', async () => {
  setBody({ data: [{ title: 'WebUrl Video', webVideoUrl: 'https://www.tiktok.com/@u/video/10' }] });
  const topics = await _tiktok({ category: 'gaming' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].sources[0], 'https://www.tiktok.com/@u/video/10');
});

test('_tiktok: item.video.webVideoUrl nested field variant', async () => {
  setBody({ data: [{ title: 'Nested Url Video', video: { webVideoUrl: 'https://www.tiktok.com/@u/video/11' } }] });
  const topics = await _tiktok({ category: 'gaming' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].sources[0], 'https://www.tiktok.com/@u/video/11');
});

test('_tiktok: constructs tiktok.com URL from id and author when no webVideoUrl', async () => {
  setBody({ data: [{ title: 'Fallback URL Video', id: '999', author: { nickname: 'testuser' } }] });
  const topics = await _tiktok({ category: 'gaming' });
  assert.ok(topics && topics.length === 1);
  assertValidVideoTopic(topics[0], 'constructed-url');
  assert.ok(topics[0].sources[0].includes('tiktok.com/@testuser/video/999'), `expected constructed URL, got: ${topics[0].sources[0]}`);
});

test('_tiktok: constructs tiktok.com URL using item.video.id when item.id absent', async () => {
  setBody({ data: [{ title: 'Video Id Nested', video: { id: '777' }, author: { nickname: 'creator2' } }] });
  const topics = await _tiktok({ category: 'tech' });
  assert.ok(topics && topics.length === 1);
  assert.ok(topics[0].sources[0].includes('tiktok.com/@creator2/video/777'), `expected constructed URL, got: ${topics[0].sources[0]}`);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('_tiktok: returns null when all arrays are absent', async () => {
  setBody({ something: [] });
  const topics = await _tiktok({ category: 'fitness' });
  assert.strictEqual(topics, null, 'unrecognised shape → null');
});

test('_tiktok: returns null when recognised array is empty', async () => {
  setBody({ data: [] });
  const topics = await _tiktok({ category: 'fitness' });
  assert.strictEqual(topics, null, 'empty array → null');
});

test('_tiktok: caps results at 10 items', async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    title: `Video ${i}`,
    webVideoUrl: `https://www.tiktok.com/@u/video/${i}`,
  }));
  setBody({ data: items });
  const topics = await _tiktok({ category: 'fitness' });
  assert.ok(Array.isArray(topics) && topics.length === 10, 'result capped at 10');
});

test('_tiktok: truncates title to 120 characters', async () => {
  const longTitle = 'A'.repeat(200);
  setBody({ data: [{ title: longTitle, webVideoUrl: 'https://www.tiktok.com/@u/video/99' }] });
  const topics = await _tiktok({ category: 'art' });
  assert.ok(topics && topics.length === 1);
  assert.ok(topics[0].title.length <= 120, `title should be capped at 120 chars, got ${topics[0].title.length}`);
});

test('_tiktok: why falls back to "Trending on TikTok" when no author, plays, or likes', async () => {
  setBody({ data: [{ title: 'Minimal Video', webVideoUrl: 'https://www.tiktok.com/@u/video/100' }] });
  const topics = await _tiktok({ category: 'art' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].why, 'Trending on TikTok');
});

test('_tiktok: returns null when TIKTOK_RAPIDAPI_KEY is absent', async () => {
  const saved = process.env.TIKTOK_RAPIDAPI_KEY;
  delete process.env.TIKTOK_RAPIDAPI_KEY;
  setBody({ data: [{ title: 'test', webVideoUrl: 'https://www.tiktok.com/@u/video/0' }] });
  const topics = await _tiktok({ category: 'test' });
  assert.strictEqual(topics, null, 'missing key → null (no live call)');
  process.env.TIKTOK_RAPIDAPI_KEY = saved;
});

test('_tiktok: returns null when TIKTOK_RAPIDAPI_KEY is a dummy value', async () => {
  const saved = process.env.TIKTOK_RAPIDAPI_KEY;
  process.env.TIKTOK_RAPIDAPI_KEY = '_DUMMY_KEY';
  setBody({ data: [{ title: 'test', webVideoUrl: 'https://www.tiktok.com/@u/video/0' }] });
  const topics = await _tiktok({ category: 'test' });
  assert.strictEqual(topics, null, 'dummy key → null (no live call)');
  process.env.TIKTOK_RAPIDAPI_KEY = saved;
});

test('_tiktok: every result has type === "video"', async () => {
  const items = [
    { title: 'Alpha', webVideoUrl: 'https://www.tiktok.com/@u/video/1' },
    { desc: 'Beta', webVideoUrl: 'https://www.tiktok.com/@u/video/2' },
    { text: 'Gamma', webVideoUrl: 'https://www.tiktok.com/@u/video/3' },
  ];
  setBody({ data: items });
  const topics = await _tiktok({ category: 'mix' });
  assert.ok(Array.isArray(topics) && topics.length === 3);
  for (const t of topics) {
    assert.strictEqual(t.type, 'video', `each item should have type 'video', got: ${t.type}`);
  }
});
