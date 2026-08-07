'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFINITION_VERSION,
  METRIC_DEFINITIONS,
  listDefinitions,
  resolveDefinition,
  labelledValue,
} = require('../services/canonical_metrics/definitions');
const { computeCanonicalMetrics, readMetric } = require('../services/canonical_metrics/compute');
const { fitResponseCurve, _calcIroas, computeContribution } = require('../services/canonical_metrics/contribution');

describe('Canonical metric definitions', () => {
  it('publishes a versioned dictionary covering ROAS/CPA/CAC/LTV/MER', () => {
    const { version, metrics } = listDefinitions();
    assert.equal(version, DEFINITION_VERSION);
    const keys = metrics.map((m) => m.key);
    for (const need of ['spend', 'reported_roas', 'true_roas', 'cpa', 'cac', 'blended_cac', 'ltv', 'mer', 'iroas', 'incremental_revenue']) {
      assert.ok(keys.includes(need), `missing ${need}`);
    }
    assert.equal(METRIC_DEFINITIONS.reported_roas.kind, 'measured');
    assert.equal(METRIC_DEFINITIONS.iroas.kind, 'modelled');
  });

  it('resolves aliases to the same definition', () => {
    assert.equal(resolveDefinition('ads.trueRoas')?.key, 'true_roas');
    assert.equal(resolveDefinition('ads.blendedCac')?.key, 'blended_cac');
  });

  it('labels values with kind + definition version', () => {
    const v = labelledValue('reported_roas', 4.8, { confidence: 0.9, evidence: 'platform' });
    assert.equal(v.kind, 'measured');
    assert.equal(v.definition_version, DEFINITION_VERSION);
    assert.equal(v.value, 4.8);
  });
});

describe('Canonical metrics compute', () => {
  it('returns labelled KPIs and new economics fields', async () => {
    const snap = await computeCanonicalMetrics(null, { days: 30 });
    assert.equal(snap.ok, true);
    assert.equal(snap.definition_version, DEFINITION_VERSION);
    assert.ok(Array.isArray(snap.kpis));
    assert.ok(snap.kpis.every((k) => k.kind === 'measured' || k.kind === 'modelled' || k.kind === 'projected'));
    assert.ok('cpa' in snap);
    assert.ok('blended_cac' in snap);
    assert.ok('ltv' in snap);
    assert.ok(snap.labelled?.spend);
    assert.equal(readMetric(snap, 'ads.cpa'), snap.cpa);
  });
});

describe('Contribution / incrementality engine', () => {
  it('fits a power curve with diminishing returns', () => {
    const points = [500, 1000, 2000, 4000, 8000].map((spend, i) => ({
      spend,
      revenue: spend * (3.5 - i * 0.35),
    }));
    const curve = fitResponseCurve(points);
    assert.equal(curve.model, 'power_curve');
    assert.ok(curve.b > 0 && curve.b <= 1);
    assert.ok(curve.predict(2000) > 0);
    assert.ok(curve.marginal(8000) < curve.marginal(500));
  });

  it('falls back linearly with sparse points', () => {
    const curve = fitResponseCurve([{ spend: 100, revenue: 250 }]);
    assert.equal(curve.model, 'linear_fallback');
    assert.equal(curve.predict(100), 250);
  });

  it('computes holdout iROAS vs reported ROAS', () => {
    const c = _calcIroas({
      test_reach: 10000,
      control_reach: 10000,
      test_conversions: 200,
      control_conversions: 100,
      test_spend: 1000,
      reported_revenue: 10000, // platform claims all conversions
      avg_order_value: 50,
    });
    assert.ok(c);
    assert.ok(c.iroas > 0);
    assert.ok(c.reported_roas > c.iroas); // platform overstates vs incremental
    assert.ok(c.lift_pct > 0);
  });

  it('builds a contribution record with platform beside causal', async () => {
    const rec = await computeContribution(null, { days: 30 });
    assert.equal(rec.ok, true);
    assert.equal(rec.summary.system_of_record, 'causal');
    assert.equal(rec.summary.platform.roas.kind, 'measured');
    assert.equal(rec.summary.causal.iroas.kind, 'modelled');
    assert.ok(Array.isArray(rec.channels));
    assert.ok(Array.isArray(rec.budget_recommendations));
    assert.match(rec.method.ranking, /causal/i);
  });
});
