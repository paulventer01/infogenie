'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const availability = require('../services/client_reporting/availability');

test('client report availability formatters cover zero, partial, proxy and unavailable labels', () => {
  assert.equal(availability.formatDisplayValue(availability.availableMeta(0)), '0');
  assert.match(
    availability.formatDisplayValue(availability.partialMeta(12, 'input_partial', { is_proxy: true })),
    /12 · Proxy · Partial \(input partial\)/,
  );
  assert.match(
    availability.formatDisplayValue(availability.unavailableMeta('source_query_failed')),
    /Unavailable \(source query failed\)/,
  );
  assert.match(
    availability.formatDisplayValue(availability.unavailableMeta('source_query_failed:relation "secret" does not exist')),
    /Unavailable \(source query failed\)/,
  );
});

test('report preview and portal components render availability badges', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../components/features/manage/ClientReportingReport.tsx'), 'utf8');
  const portal = fs.readFileSync(path.join(__dirname, '../app/client-report/view/page.tsx'), 'utf8');
  const badges = fs.readFileSync(path.join(__dirname, '../components/features/shared/ClientReportAvailabilityBadges.tsx'), 'utf8');
  for (const source of [admin, portal]) {
    assert.match(source, /ClientReportAvailabilityBadges/);
    assert.match(source, /clientReportCellDisplay/);
  }
  assert.match(badges, /Partial/);
  assert.match(badges, /Proxy/);
  assert.match(badges, /Unavailable/);
});

test('report email builder includes formatted metric lines', () => {
  const { buildReport } = require('../services/client_reporting/report');
  const client = { id: 11, name: 'Client A' };
  const profile = { version: 1, report_title: 'T', default_format: 'pdf' };
  const snapshot = buildReport(client, profile, {
    source: 'search-intel',
    records: [],
    summary: { mapped_records: 1, runs: 0, successful_runs: 0, brand_mentions: 0 },
    metric_meta: availability.availableMetricMetaFromSummary('search-intel', { mapped_records: 1, runs: 0, successful_runs: 0, brand_mentions: 0 }),
    recent: { llm_runs: [] },
    summary_scope: 'all_mapped_records',
  }, null, ['runs'], null);
  snapshot.profile_version = 2;
  snapshot.format = 'pdf';
  const { text, html } = availability.buildReportEmailBody(snapshot);
  assert.match(text, /Runs: 0/);
  assert.match(html, /Runs: 0/);
});
