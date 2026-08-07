'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMarketingIntel } = require('../lib/marketingIntelSeed');

test('buildMarketingIntel returns 7-section framework data', () => {
  const intel = buildMarketingIntel('cmtrading.com', 'Online CFD Trading');
  assert.equal(intel.domain, 'cmtrading.com');
  assert.ok(intel.engagementByChannel.length >= 4);
  assert.ok(intel.lowCtrQueries.length > 0);
  assert.ok(intel.scrollDepth.length === 10);
  assert.ok(intel.audienceSplit.newUsers + intel.audienceSplit.returningUsers === 100);
  assert.ok(intel.siteSearches.length > 0);
  assert.ok(intel.seoNotes.length > 0);
});

test('buildMarketingIntel is deterministic per domain', () => {
  const a = buildMarketingIntel('fxpro.com', 'Forex');
  const b = buildMarketingIntel('fxpro.com', 'Forex');
  const c = buildMarketingIntel('etoro.com', 'Forex');
  assert.deepEqual(a.engagementByChannel[0].sessions, b.engagementByChannel[0].sessions);
  assert.notEqual(a.engagementByChannel[0].sessions, c.engagementByChannel[0].sessions);
});
