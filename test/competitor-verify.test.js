'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDomain,
  isBlockedDomain,
  prefilter,
  parseVotes,
  tally,
} = require('../services/competitor_detect/verify');

const INFO = /^(?:investopedia|nerdwallet|forbes|g2|capterra|wikipedia)\.[a-z.]+$/i;

test('normalizeDomain strips protocol and www', () => {
  assert.equal(normalizeDomain('https://www.Plus500.com/en'), 'plus500.com');
});

test('isBlockedDomain rejects subject, platforms, and info sites', () => {
  assert.equal(isBlockedDomain('xm.com', 'xm.com', INFO), true);
  assert.equal(isBlockedDomain('google.com', 'xm.com', INFO), true);
  assert.equal(isBlockedDomain('nerdwallet.com', 'xm.com', INFO), true);
  assert.equal(isBlockedDomain('plus500.com', 'xm.com', INFO), false);
});

test('prefilter drops aggregators and duplicates', () => {
  const out = prefilter([
    { name: 'Plus500', url: 'https://www.plus500.com' },
    { name: 'Plus500 again', url: 'plus500.com' },
    { name: 'NerdWallet', url: 'nerdwallet.com' },
    { name: 'Self', url: 'xm.com' },
  ], 'xm.com', INFO);
  assert.deepEqual(out.map((c) => c.url), ['plus500.com']);
});

test('tally requires same industry AND same business majority', () => {
  const candidates = [{ name: 'IG', url: 'ig.com' }, { name: 'Stripe', url: 'stripe.com' }];
  const ballots = [
    {
      model: 'openai',
      votes: [
        { url: 'ig.com', accept: true, sameIndustry: true, sameBusiness: true },
        { url: 'stripe.com', accept: false, sameIndustry: true, sameBusiness: false },
      ],
    },
    {
      model: 'claude',
      votes: [
        { url: 'ig.com', accept: true, sameIndustry: true, sameBusiness: true },
        { url: 'stripe.com', accept: false, sameIndustry: false, sameBusiness: false },
      ],
    },
  ];
  const scored = tally(candidates, ballots);
  assert.equal(scored.find((c) => c.url === 'ig.com').verified, true);
  assert.equal(scored.find((c) => c.url === 'stripe.com').verified, false);
});

test('parseVotes reads JSON object or fence', () => {
  const votes = parseVotes('```json\n{"votes":[{"url":"ig.com","accept":true,"sameIndustry":true,"sameBusiness":true}]}\n```');
  assert.equal(votes[0].url, 'ig.com');
  assert.equal(votes[0].accept, true);
});
