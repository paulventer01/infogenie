'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSwot,
  buildChannelMix,
  buildPriorityActions,
  formatAdSpend,
  blendedMarketingMetrics,
} = require('../lib/analysisDashboard');

const sampleAd = {
  url: 'cmtrading.com',
  industry: { name: 'Online CFD & Forex Trading Brokers' },
  websiteKPIs: { ctr: 2.5, roas: 2.2, cpa: 85, convRate: 3.1, trafficMo: 450000 },
  competitors: [
    { name: 'eToro', threatLevel: 'critical', topChannel: 'Google Search', traffic: '5.8M', roas: 3.3, ctr: '2.8%', suggestions: ['Target long-tail keywords'] },
    { name: 'IG', threatLevel: 'high', topChannel: 'SEO / Organic', traffic: '3.3M', roas: 3.7, ctr: '3.2%' },
  ],
  companyProfile: { businessSummary: 'CFD trading platform for retail investors.' },
};

test('buildSwot returns four quadrants', () => {
  const swot = buildSwot(sampleAd, 'cmtrading.com');
  assert.ok(swot.strengths.length > 0);
  assert.ok(swot.weaknesses.length > 0);
  assert.ok(swot.opportunities.length > 0);
  assert.ok(swot.threats.length > 0);
});

test('buildChannelMix aggregates competitor channels', () => {
  const rows = buildChannelMix(sampleAd.competitors);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((s, r) => s + r.share, 0), 100);
});

test('formatAdSpend renders estimates from traffic', () => {
  const s = formatAdSpend({ traffic: '800K' });
  assert.match(s, /\$/);
});

test('blendedMarketingMetrics computes market share', () => {
  const m = blendedMarketingMetrics(sampleAd);
  assert.ok(m.monthlyTraffic > 0);
  assert.ok(m.competitorCount === 2);
});

test('buildPriorityActions returns actionable cards', () => {
  const actions = buildPriorityActions(sampleAd);
  assert.ok(actions.length >= 4);
  assert.ok(actions.some((a) => a.view === 'battleplan'));
});

test('dashboard helpers still render when no rivals were verified', () => {
  const empty = {
    url: 'xm.com',
    industry: { name: 'Online CFD & Forex Trading Brokers' },
    websiteKPIs: { ctr: 2.1, roas: 1.8, cpa: 90, convRate: 2.4, trafficMo: 120000 },
    competitors: [],
  };
  const swot = buildSwot(empty, 'xm.com');
  assert.ok(swot.strengths.length + swot.weaknesses.length > 0);
  assert.deepEqual(buildChannelMix([]), []);
  const metrics = blendedMarketingMetrics(empty);
  assert.equal(metrics.competitorCount, 0);
  assert.equal(metrics.monthlyTraffic, 120000);
  const actions = buildPriorityActions(empty);
  assert.ok(actions.length >= 3);
});
