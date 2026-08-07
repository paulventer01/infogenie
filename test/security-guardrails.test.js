'use strict';
// test/security-guardrails.test.js — unit coverage for services/security scaffolding.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCsp,
  safeEqualString,
  validatePassword,
  MIN_LENGTH,
  createRateLimiter,
  originAllowed,
} = require('../services/security');

test('buildCsp includes frame-ancestors self and no object-src', () => {
  const csp = buildCsp();
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /default-src 'self'/);
});

test('safeEqualString is true for equal secrets and false otherwise', () => {
  assert.equal(safeEqualString('abc', 'abc'), true);
  assert.equal(safeEqualString('abc', 'abd'), false);
  assert.equal(safeEqualString('', 'abc'), false);
  assert.equal(safeEqualString('abc', ''), false);
  assert.equal(safeEqualString(null, 'abc'), false);
});

test('validatePassword enforces length and complexity', () => {
  assert.equal(validatePassword('short').ok, false);
  assert.equal(validatePassword('allletters').ok, false);
  assert.equal(validatePassword('1234567890').ok, false);
  const ok = validatePassword('preview123');
  assert.equal(ok.ok, true);
  assert.ok(MIN_LENGTH >= 10);
});

test('createRateLimiter returns 429 after max', () => {
  const lim = createRateLimiter({ name: 't', windowMs: 60_000, max: 2, keyFn: () => 'k' });
  const calls = [];
  const makeRes = () => {
    const headers = {};
    return {
      setHeader: (k, v) => { headers[k] = v; },
      status(code) {
        return {
          json(body) {
            calls.push({ code, body, headers: { ...headers } });
          },
        };
      },
    };
  };
  let nextCount = 0;
  const next = () => { nextCount += 1; };
  lim({ path: '/x' }, makeRes(), next);
  lim({ path: '/x' }, makeRes(), next);
  lim({ path: '/x' }, makeRes(), next);
  assert.equal(nextCount, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, 429);
  assert.equal(calls[0].body.error, 'rate_limited');
  lim.reset();
});

test('originAllowed accepts matching host and localhost in non-prod', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const req = { get: () => 'example.test' };
  assert.equal(originAllowed(req, 'https://example.test'), true);
  assert.equal(originAllowed(req, 'http://127.0.0.1:5000'), true);
  assert.equal(originAllowed(req, 'https://evil.example'), false);
  process.env.NODE_ENV = prev;
});
