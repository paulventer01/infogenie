'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDomain,
  isBlockedDomain,
  prefilter,
  parseVotes,
  parseDiscoveryResult,
  mergeDiscoveries,
  evidencePool,
  tally,
  verifyCompetitors,
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

test('parseDiscoveryResult reads fenced JSON and tags llm source', () => {
  const parsed = parseDiscoveryResult('```json\n{"industryName":"Online CFD broker","subNiche":"CFD trading","competitors":[{"name":"eToro","url":"https://www.etoro.com","why":"Retail CFD broker"}]}\n```');
  assert.equal(parsed.industryName, 'Online CFD broker');
  assert.equal(parsed.competitors[0].url, 'https://www.etoro.com');
  assert.equal(parsed.competitors[0].source, 'llm');
});

test('mergeDiscoveries unions domains from multiple models', () => {
  const merged = mergeDiscoveries([
    { model: 'claude', industryName: 'CFD broker', competitors: [{ name: 'eToro', url: 'etoro.com' }] },
    { model: 'perplexity', industryName: '', competitors: [{ name: 'Plus500', url: 'https://www.plus500.com' }, { name: 'eToro dup', url: 'etoro.com' }] },
  ]);
  assert.equal(merged.industryName, 'CFD broker');
  assert.deepEqual(merged.competitors.map((c) => c.url), ['etoro.com', 'plus500.com']);
  assert.equal(merged.modelsUsed.includes('claude'), true);
});

test('evidencePool keeps llm and serp rows, drops untagged', () => {
  const kept = evidencePool([
    { name: 'IG', url: 'ig.com', source: 'llm' },
    { name: 'XM', url: 'xm.com', source: 'serp' },
    { name: 'Invented', url: 'fake-rival.test' },
  ]);
  assert.deepEqual(kept.map((c) => c.url), ['ig.com', 'xm.com']);
});

test('verifyCompetitors keeps llm rows when no model can vote', async () => {
  const keys = [
    'AI_INTEGRATIONS_ANTHROPIC_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'AI_INTEGRATIONS_GEMINI_API_KEY',
    'PERPLEXITY_API_KEY',
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    const result = await verifyCompetitors({
      subject: { domain: 'cmtrading.com', industryName: 'CFD broker' },
      candidates: [
        { name: 'eToro', url: 'etoro.com', source: 'llm' },
        { name: 'Untagged', url: 'random-brand.com' },
      ],
      openaiChatWithRetry: null,
      anthropic: null,
      timeoutMs: 400,
    });
    assert.equal(result.unverified, true);
    assert.deepEqual(result.accepted.map((c) => c.url), ['etoro.com']);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

