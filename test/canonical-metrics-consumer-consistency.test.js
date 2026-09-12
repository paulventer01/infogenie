'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { AVAILABILITY, REASON } = require('../services/canonical_metrics/availability');
const {
  resolveConsumerMetric,
  formatMetricDisplay,
  isUsableForRecommendations,
  safeAvailabilityReason,
  labelledAvailability,
} = require('../services/canonical_metrics/consumer');

function mockSnap(overrides = {}) {
  return {
    spend: 100,
    blended_roas: 2,
    true_roas: 2,
    cac: 40,
    availability: {
      spend: { status: AVAILABILITY.AVAILABLE, reason: null },
      reported_roas: { status: AVAILABILITY.AVAILABLE, reason: null },
      cac: { status: AVAILABILITY.AVAILABLE, reason: null },
      waste: { status: AVAILABILITY.AVAILABLE, reason: null },
    },
    labelled: {
      spend: { availability: AVAILABILITY.AVAILABLE },
      reported_roas: { availability: AVAILABILITY.AVAILABLE },
      cac: { availability: AVAILABILITY.AVAILABLE, is_proxy: true },
      waste: { availability: AVAILABILITY.AVAILABLE },
    },
    waste_channels: [{ channel: 'meta', spend: 50, revenue: 10, roas: 0.2, waste_cents: 4000 }],
    ...overrides,
  };
}

describe('canonical metrics consumer helpers (PR10G.2)', () => {
  it('formatMetricDisplay shows valid zero, unavailable, partial, and proxy', () => {
    assert.equal(formatMetricDisplay(0, 'x', { availability: AVAILABILITY.AVAILABLE }), '0x');
    assert.match(
      formatMetricDisplay(null, '$', {
        availability: AVAILABILITY.UNAVAILABLE,
        availability_reason: REASON.ZERO_DENOMINATOR,
      }),
      /unavailable \(zero_denominator\)/i,
    );
    assert.match(
      formatMetricDisplay(1.5, 'x', {
        availability: AVAILABILITY.PARTIAL,
        availability_reason: REASON.INPUT_PARTIAL,
      }),
      /1\.5x · partial/,
    );
    assert.match(
      formatMetricDisplay(42, '$', { availability: AVAILABILITY.AVAILABLE, is_proxy: true }),
      /\$42 \(proxy\)/,
    );
  });

  it('safeAvailabilityReason hides raw database errors', () => {
    assert.equal(
      safeAvailabilityReason('relation "ad_performance_hourly" does not exist'),
      REASON.SOURCE_QUERY_FAILED,
    );
    assert.equal(
      safeAvailabilityReason(`${REASON.INPUT_UNAVAILABLE}:numerator`),
      `${REASON.INPUT_UNAVAILABLE}:numerator`,
    );
  });

  it('resolveConsumerMetric preserves available zero and unavailable null', () => {
    const availableZero = mockSnap({
      spend: 0,
      availability: { spend: { status: AVAILABILITY.AVAILABLE, reason: null } },
      labelled: { spend: { availability: AVAILABILITY.AVAILABLE } },
    });
    assert.equal(resolveConsumerMetric(availableZero, 'spend').value, 0);

    const unavailable = mockSnap({
      spend: null,
      availability: { spend: { status: AVAILABILITY.UNAVAILABLE, reason: REASON.SOURCE_QUERY_FAILED } },
      labelled: {
        spend: {
          availability: AVAILABILITY.UNAVAILABLE,
          availability_reason: `${REASON.SOURCE_QUERY_FAILED}:ad_performance_hourly`,
        },
      },
    });
    const detail = resolveConsumerMetric(unavailable, 'spend');
    assert.equal(detail.value, null);
    assert.equal(detail.availability, AVAILABILITY.UNAVAILABLE);
  });

  it('isUsableForRecommendations accepts only fully available inputs', () => {
    assert.equal(isUsableForRecommendations(AVAILABILITY.AVAILABLE), true);
    assert.equal(isUsableForRecommendations(AVAILABILITY.PARTIAL), false);
    assert.equal(isUsableForRecommendations(AVAILABILITY.UNAVAILABLE), false);
  });
});

function growthOpsTestCtx(overrides = {}) {
  return {
    _amplitudeFetch: async () => ({}),
    _amplitudeFmtDate: () => '20260101',
    _dripLoad: async () => [],
    _dripLock: (fn) => fn(),
    _dripSave: async () => {},
    _enrollDripCore: async () => ({ created: [], skipped: 0 }),
    _fetchAmplitudeConversions: async () => ({ ok: true, conversions: 99 }),
    _fetchGoogleAdsSpend: async () => { throw new Error('legacy should not run'); },
    _fetchMetaSpend: async () => { throw new Error('legacy should not run'); },
    _fetchTikTokSpend: async () => { throw new Error('legacy should not run'); },
    _tkvCtx: { resolveTenantId: async () => 1 },
    _tkvRead: async () => [],
    _tkvWrite: async () => {},
    openaiChatWithRetry: async () => {
      throw new Error('LLM should not run');
    },
    ...overrides,
  };
}

function registerGrowthOpsRoute(path, ctx) {
  const growthPath = require.resolve('../services/growth_ops/routes');
  delete require.cache[growthPath];
  const handlers = [];
  const routes = {
    get: (p, h) => { if (p === path) handlers.push(h); },
    post: (p, h) => { if (p === path) handlers.push(h); },
    delete: () => {},
  };
  require(growthPath)(routes, ctx);
  return handlers[0];
}

describe('growth ops goals consumer', () => {
  const computePath = require.resolve('../services/canonical_metrics/compute');
  const growthPath = require.resolve('../services/growth_ops/routes');
  let origCompute;

  beforeEach(() => {
    delete require.cache[growthPath];
    origCompute = require(computePath).computeCanonicalMetrics;
  });

  afterEach(() => {
    require(computePath).computeCanonicalMetrics = origCompute;
    delete require.cache[growthPath];
  });

  it('does not fall back to legacy spend when canonical spend is unavailable', async () => {
    require(computePath).computeCanonicalMetrics = async () => mockSnap({
      spend: null,
      availability: {
        spend: { status: AVAILABILITY.UNAVAILABLE, reason: REASON.SOURCE_QUERY_FAILED },
        reported_roas: { status: AVAILABILITY.UNAVAILABLE, reason: REASON.SOURCE_QUERY_FAILED },
      },
      labelled: {
        spend: {
          availability: AVAILABILITY.UNAVAILABLE,
          availability_reason: `${REASON.SOURCE_QUERY_FAILED}:ad_performance_hourly`,
        },
      },
    });

    const handler = registerGrowthOpsRoute('/api/goals/check', growthOpsTestCtx({
      _tkvRead: async () => [{
        id: 'g1',
        metric: 'ads.totalSpend',
        target: 100,
        label: 'Spend cap',
      }],
    }));
    assert.ok(handler, 'goals/check route registered');
    const res = {
      statusCode: 200,
      body: null,
      json(payload) { this.body = payload; return payload; },
      status(code) { this.statusCode = code; return this; },
    };
    await handler({ body: {} }, res);
    assert.equal(res.body.goals.length, 1);
    assert.equal(res.body.goals[0].current, null);
    assert.equal(res.body.goals[0].status, 'unknown');
    assert.equal(res.body.goals[0].metric_availability, AVAILABILITY.UNAVAILABLE);
  });

  it('returns unavailable on canonical exceptions without legacy fetch', async () => {
    require(computePath).computeCanonicalMetrics = async () => {
      throw new Error('database connection lost');
    };

    const handler = registerGrowthOpsRoute('/api/goals/check', growthOpsTestCtx({
      _tkvRead: async () => [{
        id: 'g1',
        metric: 'ads.blendedRoas',
        target: 2,
        label: 'ROAS target',
      }],
    }));

    const res = {
      body: null,
      json(payload) { this.body = payload; return payload; },
      status() { return this; },
    };
    await handler({ body: {} }, res);
    assert.equal(res.body.goals[0].current, null);
    assert.equal(res.body.goals[0].metric_availability, AVAILABILITY.UNAVAILABLE);
    assert.equal(res.body.goals[0].metric_availability_reason, REASON.SOURCE_QUERY_FAILED);
  });

  it('withholds target suggestions for partial canonical inputs', async () => {
    require(computePath).computeCanonicalMetrics = async () => mockSnap({
      spend: 100,
      availability: {
        spend: { status: AVAILABILITY.PARTIAL, reason: REASON.SOURCE_QUERY_FAILED },
      },
      labelled: {
        spend: {
          availability: AVAILABILITY.PARTIAL,
          availability_reason: REASON.SOURCE_QUERY_FAILED,
        },
      },
    });

    const handler = registerGrowthOpsRoute('/api/goals/suggest', growthOpsTestCtx());
    const res = {
      body: null,
      json(payload) { this.body = payload; return payload; },
      status() { return this; },
    };
    await handler({ body: { metric: 'ads.totalSpend', field: 'target' } }, res);
    assert.equal(res.body.insufficient_data, true);
    assert.equal(res.body.value, null);
    assert.equal(res.body.metric_availability, AVAILABILITY.PARTIAL);
    assert.match(res.body.reason, /Insufficient data/i);
  });

  it('allows target suggestions for available canonical zero', async () => {
    require(computePath).computeCanonicalMetrics = async () => mockSnap({
      spend: 0,
      availability: {
        spend: { status: AVAILABILITY.AVAILABLE, reason: null },
      },
      labelled: {
        spend: { availability: AVAILABILITY.AVAILABLE },
      },
    });

    let llmCalled = false;
    const handler = registerGrowthOpsRoute('/api/goals/suggest', growthOpsTestCtx({
      openaiChatWithRetry: async () => {
        llmCalled = true;
        throw new Error('force fallback');
      },
    }));
    const res = {
      body: null,
      json(payload) { this.body = payload; return payload; },
      status() { return this; },
    };
    await handler({ body: { metric: 'ads.totalSpend', field: 'target' } }, res);
    assert.equal(res.body.insufficient_data, undefined);
    assert.equal(res.body.current, 0);
    assert.equal(res.body.value, 0);
    assert.equal(res.body.metric_availability, AVAILABILITY.AVAILABLE);
    assert.equal(llmCalled, true);
  });
});

describe('anomaly detector spend-scan consumer', () => {
  const computePath = require.resolve('../services/canonical_metrics/compute');
  const anomalyPath = require.resolve('../services/anomaly_detector/api');
  let origCompute;

  beforeEach(() => {
    delete require.cache[anomalyPath];
    origCompute = require(computePath).computeCanonicalMetrics;
  });

  afterEach(() => {
    require(computePath).computeCanonicalMetrics = origCompute;
    delete require.cache[anomalyPath];
  });

  it('skips waste and ROAS anomalies when canonical inputs are partial', async () => {
    require(computePath).computeCanonicalMetrics = async () => mockSnap({
      spend: 120,
      blended_roas: 0.4,
      availability: {
        spend: { status: AVAILABILITY.PARTIAL, reason: REASON.SOURCE_QUERY_FAILED },
        reported_roas: { status: AVAILABILITY.PARTIAL, reason: REASON.SOURCE_QUERY_FAILED },
        waste: { status: AVAILABILITY.UNAVAILABLE, reason: REASON.SOURCE_QUERY_FAILED },
      },
      labelled: {
        spend: { availability: AVAILABILITY.PARTIAL, availability_reason: REASON.SOURCE_QUERY_FAILED },
        reported_roas: { availability: AVAILABILITY.PARTIAL, availability_reason: REASON.SOURCE_QUERY_FAILED },
        waste: { availability: AVAILABILITY.UNAVAILABLE, availability_reason: REASON.SOURCE_QUERY_FAILED },
      },
    });

    const router = require(anomalyPath);
    const layer = router.stack.find((l) => l.route?.path === '/spend-scan' && l.route.methods.post);
    assert.ok(layer, 'spend-scan route exists');
    const handler = layer.route.stack[0].handle;

    const _tenantCtx = require('../services/tenants/context');
    const origResolve = _tenantCtx.resolveTenantId;
    _tenantCtx.resolveTenantId = async () => 1;

    const res = {
      headersSent: false,
      body: null,
      status() { return this; },
      json(payload) { this.body = payload; return payload; },
    };
    await handler({ body: { days: 30 }, params: {} }, res);
    _tenantCtx.resolveTenantId = origResolve;

    assert.equal(res.body.anomaly_count, 0);
    assert.ok(res.body.skipped_checks?.length >= 1);
    assert.equal(res.body.metrics.spend_availability, AVAILABILITY.PARTIAL);
  });
});

describe('contribution budget recommendations consumer', () => {
  const computePath = require.resolve('../services/canonical_metrics/compute');
  const contribPath = require.resolve('../services/canonical_metrics/contribution');
  let origCompute;

  beforeEach(() => {
    delete require.cache[contribPath];
    origCompute = require(computePath).computeCanonicalMetrics;
  });

  afterEach(() => {
    require(computePath).computeCanonicalMetrics = origCompute;
    delete require.cache[contribPath];
  });

  it('omits budget_recommendations when canonical spend is unavailable', async () => {
    require(computePath).computeCanonicalMetrics = async () => mockSnap({
      spend: null,
      reported_roas: null,
      blended_roas: null,
      online_revenue: null,
      spend_by_channel: {},
      availability: {
        spend: { status: AVAILABILITY.UNAVAILABLE, reason: REASON.DATABASE_UNAVAILABLE },
        reported_roas: { status: AVAILABILITY.UNAVAILABLE, reason: REASON.DATABASE_UNAVAILABLE },
      },
      labelled: {
        spend: { availability: AVAILABILITY.UNAVAILABLE, availability_reason: REASON.DATABASE_UNAVAILABLE },
        reported_roas: { availability: AVAILABILITY.UNAVAILABLE, availability_reason: REASON.DATABASE_UNAVAILABLE },
      },
    });

    const { computeContribution } = require(contribPath);
    const record = await computeContribution(1, { days: 30 });
    assert.equal(record.budget_recommendations.length, 0);
    assert.equal(record.summary.input_availability.usable_for_recommendations, false);
  });
});

describe('OKR canonical ROAS consumer', () => {
  const computePath = require.resolve('../services/canonical_metrics/compute');
  const okrPath = require.resolve('../services/okr/api');
  let origCompute;
  let origHasDb;

  beforeEach(() => {
    delete require.cache[okrPath];
    origCompute = require(computePath).computeCanonicalMetrics;
    origHasDb = require('../db').hasDb;
    require('../db').hasDb = () => true;
  });

  afterEach(() => {
    require(computePath).computeCanonicalMetrics = origCompute;
    require('../db').hasDb = origHasDb;
    delete require.cache[okrPath];
  });

  it('returns partial metadata without legacy fallback for blended_roas', async () => {
    require(computePath).computeCanonicalMetrics = async () => mockSnap({
      blended_roas: 1.8,
      reported_roas: 1.8,
      availability: {
        blended_roas: { status: AVAILABILITY.PARTIAL, reason: REASON.OFFLINE_UNAVAILABLE },
        reported_roas: { status: AVAILABILITY.PARTIAL, reason: REASON.OFFLINE_UNAVAILABLE },
      },
      labelled: {
        blended_roas: {
          availability: AVAILABILITY.PARTIAL,
          availability_reason: REASON.OFFLINE_UNAVAILABLE,
        },
      },
    });

    const okr = require(okrPath);
    const layer = okr.stack.find((l) => l.route?.path === '/objectives/:id/refresh' && l.route.methods.post);
    assert.ok(layer, 'refresh route exists');

    const _tenantCtx = require('../services/tenants/context');
    const origResolve = _tenantCtx.resolveTenantId;
    _tenantCtx.resolveTenantId = async () => 1;

    const db = require('../db');
    const origPool = db.getPool;
    db.getPool = () => ({
      query: async (sql) => {
        if (/okr_objectives/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'o1', quarter: '2026-Q1' }] };
        }
        if (/okr_key_results/i.test(sql) && /SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'kr1',
              metric_type: 'blended_roas',
              linked_channel: '',
              target_value: 2,
              current_value: 0,
            }],
          };
        }
        return { rows: [] };
      },
    });

    const res = {
      headersSent: false,
      body: null,
      status() { return this; },
      json(payload) { this.body = payload; return payload; },
    };
    await layer.route.stack[0].handle({ params: { id: 'o1' } }, res);

    db.getPool = origPool;
    _tenantCtx.resolveTenantId = origResolve;

    const kr = res.body.key_results[0];
    assert.equal(kr.current_value, 1.8);
    assert.equal(kr.metric_availability, AVAILABILITY.PARTIAL);
    assert.match(kr.metric_availability_reason, /offline/i);
  });

  it('returns unavailable on canonical exceptions without legacy ROAS recompute', async () => {
    require(computePath).computeCanonicalMetrics = async () => {
      throw new Error('relation ad_performance_hourly does not exist');
    };

    const okr = require(okrPath);
    const layer = okr.stack.find((l) => l.route?.path === '/objectives/:id/refresh' && l.route.methods.post);
    const _tenantCtx = require('../services/tenants/context');
    const origResolve = _tenantCtx.resolveTenantId;
    _tenantCtx.resolveTenantId = async () => 1;

    const db = require('../db');
    const origPool = db.getPool;
    let legacyQueried = false;
    db.getPool = () => ({
      query: async (sql) => {
        if (/ad_performance_hourly/i.test(sql)) {
          legacyQueried = true;
          throw new Error('legacy should not run');
        }
        if (/okr_objectives/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'o1', quarter: '2026-Q1' }] };
        }
        if (/okr_key_results/i.test(sql) && /SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'kr1',
              metric_type: 'blended_roas',
              linked_channel: '',
              target_value: 2,
              current_value: 0,
            }],
          };
        }
        return { rows: [] };
      },
    });

    const res = {
      headersSent: false,
      body: null,
      status() { return this; },
      json(payload) { this.body = payload; return payload; },
    };
    await layer.route.stack[0].handle({ params: { id: 'o1' } }, res);

    db.getPool = origPool;
    _tenantCtx.resolveTenantId = origResolve;

    assert.equal(legacyQueried, false);
    const kr = res.body.key_results[0];
    assert.equal(kr.current_value, null);
    assert.equal(kr.metric_availability, AVAILABILITY.UNAVAILABLE);
    assert.equal(kr.metric_availability_reason, REASON.SOURCE_QUERY_FAILED);
  });
});
