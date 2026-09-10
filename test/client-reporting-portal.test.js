'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const portal = require('../services/client_reporting/portal');

test('portal token helpers hash and sanitize 64-hex tokens only', () => {
  const token = portal.mintToken();
  assert.equal(token.length, 64);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(portal.sanitizeToken(token), token);
  assert.equal(portal.sanitizeToken('deadbeef'), null);
  assert.equal(portal.hashToken(token), portal.hashToken(token));
  assert.notEqual(portal.hashToken(token), portal.hashToken(portal.mintToken()));
});

test('portal cookie name is stable', () => {
  assert.equal(portal.COOKIE_NAME, 'infogenie.crp');
});
