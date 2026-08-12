// test/semrush-apps-smoke.test.js — mounts + basic handlers for Semrush-style hubs
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('semrush-apps routers', () => {
  it('exports express routers', () => {
    for (const mod of [
      '../services/daily_trends/api',
      '../services/serp_gap/api',
      '../services/llm_gap/api',
      '../services/ad_intel/api',
      '../services/influencer_analytics/api',
      '../services/brand_monitor/api',
    ]) {
      const r = require(mod);
      assert.equal(typeof r, 'function');
      assert.ok(Array.isArray(r.stack) || typeof r.use === 'function');
    }
  });

  it('schemas export ensure* functions', () => {
    assert.equal(typeof require('../services/daily_trends/schema').ensureDailyTrendsSchema, 'function');
    assert.equal(typeof require('../services/serp_gap/schema').ensureSerpGapSchema, 'function');
    assert.equal(typeof require('../services/llm_gap/schema').ensureLlmGapSchema, 'function');
    assert.equal(typeof require('../services/influencer_analytics/schema').ensureInfluencerAnalyticsSchema, 'function');
  });

  it('daily trends normalizes domains', () => {
    const { _normDomain } = require('../services/daily_trends/api');
    assert.equal(_normDomain('https://www.Example.com/path'), 'example.com');
  });
});
