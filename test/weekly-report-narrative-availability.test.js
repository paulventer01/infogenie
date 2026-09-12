'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const computePath = require.resolve('../services/canonical_metrics/compute');
const weeklyPath = require.resolve('../services/weekly_report/api');

describe('weekly report client narrative availability', () => {
  let origCompute;

  beforeEach(() => {
    delete require.cache[weeklyPath];
    origCompute = require(computePath).computeCanonicalMetrics;
  });

  afterEach(() => {
    require(computePath).computeCanonicalMetrics = origCompute;
    delete require.cache[weeklyPath];
  });

  it('labels partial true ROAS in the narrative via _metricDisplay', async () => {
    require(computePath).computeCanonicalMetrics = async () => ({
      days: 7,
      spend: 100,
      blended_roas: 2,
      true_roas: 2,
      total_revenue: 200,
      cac: null,
      waste_cents: 0,
      waste_channels: [],
      goals_vs_actuals: [],
      pacing: null,
      deltas: {},
      labelled: {
        spend: { availability: 'available', availability_reason: null },
        reported_roas: { availability: 'available', availability_reason: null },
        true_roas: {
          availability: 'partial',
          availability_reason: 'offline_conversions_unavailable',
        },
        cac: { availability: 'unavailable', availability_reason: 'input_unavailable:numerator' },
      },
    });

    const { _buildClientNarrative } = require(weeklyPath);
    const narrative = await _buildClientNarrative('Acme Co', 1, []);

    const joined = [
      narrative.executive_summary,
      ...(narrative.client_paragraphs || []),
    ].join(' ');

    assert.match(joined, /true ROAS 2x · partial \(offline conversions unavailable\)/);
    assert.match(joined, /Spend \$100 over 7 days/);
    assert.doesNotMatch(joined, /true ROAS 2x(?!\s·\spartial)/);
  });
});
