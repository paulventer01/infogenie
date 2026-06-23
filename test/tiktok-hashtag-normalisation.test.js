'use strict';
// Guard test for the _tiktokHashtags normalisation layer in services/trends/api.js
//
// _tiktokHashtags handles multiple API response shape variants defensively:
//   • top-level array key: j.data | j.result | j.hashtags
//   • per-item tag field:  item.hashtagName | item.name | item.title | item.tag
//
// This test feeds canned payloads through the function (https.request is stubbed)
// to ensure every known variant produces well-formed topic objects. A shape change
// from the RapidAPI endpoint that silently returns zero hashtags will break here
// rather than going undetected in production.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { EventEmitter } = require('events');

// ── Stub https.request before requiring the module ──────────────────────────
// _tiktokHashtags captures `require('https')` as `_https` at module load time.
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
const _tiktokHashtags = router._tiktokHashtags;

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

function assertValidHashtagTopic(t, label) {
  assert.strictEqual(t.type, 'hashtag', `${label}: type should be 'hashtag'`);
  assert.ok(typeof t.title === 'string' && t.title.length > 0, `${label}: title should be a non-empty string`);
  assert.ok(t.title.startsWith('#'), `${label}: title should start with '#' (got: ${t.title})`);
  assert.ok(Array.isArray(t.sources) && t.sources.length > 0, `${label}: sources should be a non-empty array`);
  assert.ok(
    t.sources[0].includes('tiktok.com/tag/'),
    `${label}: sources[0] should be a TikTok tag URL (got: ${t.sources[0]})`
  );
  assert.ok(typeof t.why === 'string' && t.why.length > 0, `${label}: why should be a non-empty string`);
  assert.ok(typeof t.viewCount === 'number', `${label}: viewCount should be a number`);
}

// ── Top-level array shape variants ──────────────────────────────────────────

test('_tiktokHashtags: j.data array shape returns valid topics', async () => {
  setBody({ data: [{ hashtagName: 'fitness', viewCount: 5000000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(Array.isArray(topics) && topics.length === 1, 'should return one topic');
  assertValidHashtagTopic(topics[0], 'j.data');
  assert.strictEqual(topics[0].title, '#fitness');
  assert.strictEqual(topics[0].viewCount, 5000000);
});

test('_tiktokHashtags: j.result array shape returns valid topics', async () => {
  setBody({ result: [{ hashtagName: 'travel', viewCount: 3000000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(Array.isArray(topics) && topics.length === 1, 'should return one topic');
  assertValidHashtagTopic(topics[0], 'j.result');
  assert.strictEqual(topics[0].title, '#travel');
});

test('_tiktokHashtags: j.hashtags array shape returns valid topics', async () => {
  setBody({ hashtags: [{ hashtagName: 'food', viewCount: 2000000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(Array.isArray(topics) && topics.length === 1, 'should return one topic');
  assertValidHashtagTopic(topics[0], 'j.hashtags');
  assert.strictEqual(topics[0].title, '#food');
});

// ── Per-item tag field name variants ─────────────────────────────────────────

test('_tiktokHashtags: item.hashtagName field variant', async () => {
  setBody({ data: [{ hashtagName: 'workout', viewCount: 1000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assertValidHashtagTopic(topics[0], 'hashtagName');
  assert.strictEqual(topics[0].title, '#workout');
});

test('_tiktokHashtags: item.name field variant', async () => {
  setBody({ data: [{ name: 'cooking', viewCount: 2000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assertValidHashtagTopic(topics[0], 'name');
  assert.strictEqual(topics[0].title, '#cooking');
});

test('_tiktokHashtags: item.title field variant', async () => {
  setBody({ data: [{ title: 'gaming', viewCount: 3000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assertValidHashtagTopic(topics[0], 'title');
  assert.strictEqual(topics[0].title, '#gaming');
});

test('_tiktokHashtags: item.tag field variant', async () => {
  setBody({ data: [{ tag: 'beauty', viewCount: 4000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assertValidHashtagTopic(topics[0], 'tag');
  assert.strictEqual(topics[0].title, '#beauty');
});

// ── Tag already has a leading # ───────────────────────────────────────────────
test('_tiktokHashtags: strips leading # before re-adding it', async () => {
  setBody({ data: [{ hashtagName: '#dance', viewCount: 500 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].title, '#dance', 'should not double-prefix the #');
  assert.ok(
    topics[0].sources[0].includes('tiktok.com/tag/dance'),
    'TikTok URL should not contain double-#'
  );
});

// ── view count field name variants ───────────────────────────────────────────
test('_tiktokHashtags: view_count field variant', async () => {
  setBody({ data: [{ hashtagName: 'diy', view_count: 7500 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].viewCount, 7500, 'view_count should be read');
  assert.ok(topics[0].why.includes('7,500'), 'why should mention formatted view count');
});

test('_tiktokHashtags: videoCount field variant', async () => {
  setBody({ data: [{ hashtagName: 'pets', videoCount: 12000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].viewCount, 12000);
});

test('_tiktokHashtags: video_count field variant', async () => {
  setBody({ data: [{ hashtagName: 'music', video_count: 99000 }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].viewCount, 99000);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('_tiktokHashtags: items with no tag field are filtered out', async () => {
  setBody({ data: [
    { hashtagName: 'sport', viewCount: 100 },
    { viewCount: 200 }, // no tag field at all — should be dropped
    { hashtagName: '', viewCount: 300 }, // empty string — should be dropped
  ]});
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(Array.isArray(topics) && topics.length === 1, 'only the valid item survives');
  assert.strictEqual(topics[0].title, '#sport');
});

test('_tiktokHashtags: returns null when all arrays are absent', async () => {
  setBody({ something: [] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.strictEqual(topics, null, 'unrecognised shape → null');
});

test('_tiktokHashtags: returns null when recognised array is empty', async () => {
  setBody({ data: [] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.strictEqual(topics, null, 'empty array → null');
});

test('_tiktokHashtags: returns null when no valid tags survive filtering', async () => {
  setBody({ data: [{ viewCount: 100 }, { hashtagName: '' }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.strictEqual(topics, null, 'all items filtered → null');
});

test('_tiktokHashtags: caps results at 15 items', async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ hashtagName: `tag${i}`, viewCount: i * 100 }));
  setBody({ data: items });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(Array.isArray(topics) && topics.length === 15, 'result capped at 15');
});

test('_tiktokHashtags: returns null when TIKTOK_RAPIDAPI_KEY is absent', async () => {
  const saved = process.env.TIKTOK_RAPIDAPI_KEY;
  delete process.env.TIKTOK_RAPIDAPI_KEY;
  setBody({ data: [{ hashtagName: 'test' }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.strictEqual(topics, null, 'missing key → null (no live call)');
  process.env.TIKTOK_RAPIDAPI_KEY = saved;
});

test('_tiktokHashtags: returns null when TIKTOK_RAPIDAPI_KEY is a dummy value', async () => {
  const saved = process.env.TIKTOK_RAPIDAPI_KEY;
  process.env.TIKTOK_RAPIDAPI_KEY = '_DUMMY_KEY';
  setBody({ data: [{ hashtagName: 'test' }] });
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.strictEqual(topics, null, 'dummy key → null (no live call)');
  process.env.TIKTOK_RAPIDAPI_KEY = saved;
});

test('_tiktokHashtags: why falls back to "Trending hashtag on TikTok" when viewCount is 0', async () => {
  setBody({ data: [{ hashtagName: 'art' }] }); // no viewCount field
  const topics = await _tiktokHashtags({ country: 'US' });
  assert.ok(topics && topics.length === 1);
  assert.strictEqual(topics[0].why, 'Trending hashtag on TikTok');
  assert.strictEqual(topics[0].viewCount, 0);
});
