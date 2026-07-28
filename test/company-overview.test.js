'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCompanyOverview } = require('../lib/companyOverview');

test('buildCompanyOverview builds domain snapshot from analysis data', () => {
  const overview = buildCompanyOverview('cmtrading.com', 'Forex broker', {
    url: 'https://www.cmtrading.com',
    companyProfile: {
      siteTitle: 'CM Trading',
      subNiche: 'Forex broker',
      businessSummary: 'Online trading platform.',
    },
    websiteKPIs: { trafficMo: 450000, roas: 2.8 },
    competitors: [{ domain: 'a.com' }, { domain: 'b.com' }],
    _yourRealData: { organicTraffic: 120000 },
  });

  assert.equal(overview.domain, 'cmtrading.com');
  assert.equal(overview.industry, 'Forex broker');
  assert.ok(overview.snapshot.length >= 6);
  assert.ok(overview.modules.some((m) => m.key === 'seo'));
  assert.ok(overview.journey.some((s) => s.view === 'dashboard' && s.done));
  assert.equal(overview.profile.siteTitle, 'CM Trading');
  const trafficKpi = overview.snapshot.find((k) => k.key === 'traffic');
  assert.ok(trafficKpi);
  assert.equal(trafficKpi.live, true);
});

test('buildCompanyOverview is deterministic per domain', () => {
  const a = buildCompanyOverview('fxpro.com', 'Forex', { competitors: [] });
  const b = buildCompanyOverview('fxpro.com', 'Forex', { competitors: [] });
  const c = buildCompanyOverview('etoro.com', 'Forex', { competitors: [] });
  assert.equal(a.snapshot[0].value, b.snapshot[0].value);
  assert.notEqual(a.snapshot[0].value, c.snapshot[0].value);
});
