'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyJourneyStatus, normDomain } = require('../lib/journeyStatus');
const { buildCompanyOverview } = require('../lib/companyOverview');

test('normDomain strips protocol and www', () => {
  assert.equal(normDomain('https://www.cmtrading.com/path'), 'cmtrading.com');
  assert.equal(normDomain('CMTRADING.COM'), 'cmtrading.com');
});

test('applyJourneyStatus marks tool steps from server flags', () => {
  const steps = [
    { view: 'dashboard', done: false },
    { view: 'serp-tracker', done: false },
    { view: 'seo-auditor', done: false },
    { view: 'geo-audit', done: false },
    { view: 'backlinks', done: false },
    { view: 'analytics-hub', done: false },
    { view: 'competitors', done: false },
    { view: 'battleplan', done: false },
  ];
  const merged = applyJourneyStatus(
    steps,
    {
      rankings: true,
      websiteAudit: true,
      aiSearch: true,
      backlinks: true,
      analytics: true,
      marketingPlan: true,
    },
    { competitorsCount: 3 },
  );
  assert.equal(merged.find((s) => s.view === 'dashboard')?.done, true);
  assert.equal(merged.find((s) => s.view === 'serp-tracker')?.done, true);
  assert.equal(merged.find((s) => s.view === 'seo-auditor')?.done, true);
  assert.equal(merged.find((s) => s.view === 'geo-audit')?.done, true);
  assert.equal(merged.find((s) => s.view === 'backlinks')?.done, true);
  assert.equal(merged.find((s) => s.view === 'analytics-hub')?.done, true);
  assert.equal(merged.find((s) => s.view === 'competitors')?.done, true);
  assert.equal(merged.find((s) => s.view === 'battleplan')?.done, true);
});

test('buildCompanyOverview merges journeyStatus into journey rail', () => {
  const overview = buildCompanyOverview(
    'cmtrading.com',
    'Forex',
    { competitors: [{ name: 'A' }] },
    { websiteAudit: true, aiSearch: true },
  );
  const audit = overview.journey.find((s) => s.view === 'seo-auditor');
  const geo = overview.journey.find((s) => s.view === 'geo-audit');
  const rankings = overview.journey.find((s) => s.view === 'serp-tracker');
  assert.equal(audit?.done, true);
  assert.equal(geo?.done, true);
  assert.equal(rankings?.done, false);
});

test('analysed domain shows green ticks on Backlinks, Marketing Plan, Website Audit', () => {
  const overview = buildCompanyOverview(
    'cmtrading.com',
    'Fintech & Finance',
    { url: 'cmtrading.com', websiteKPIs: { ctr: 2, roas: 2, trafficMo: 1000 }, competitors: [] },
    null,
  );
  assert.equal(overview.journey.find((s) => s.view === 'backlinks')?.done, true);
  assert.equal(overview.journey.find((s) => s.view === 'marketing-plan')?.done, true);
  assert.equal(overview.journey.find((s) => s.view === 'seo-auditor')?.done, true);
  assert.equal(overview.journey.find((s) => s.view === 'competitors')?.done, false);
});
