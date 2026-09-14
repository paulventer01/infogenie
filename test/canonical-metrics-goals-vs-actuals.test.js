'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { AVAILABILITY, REASON } = require('../services/canonical_metrics/availability');
const {
  buildGoalsVsActuals,
  buildOkrRow,
  isVerifiedGoalRow,
  formatGoalActualDisplay,
} = require('../services/canonical_metrics/goals_vs_actuals');

const db = require('../db');
const origHasDb = db.hasDb;
const origGetPool = db.getPool;
const origKvGet = db.kvGet;

let queryHandler = async () => ({ rows: [] });
let kvStore = {};

function installMockDb(handler) {
  queryHandler = handler;
  db.hasDb = () => true;
  db.getPool = () => ({ query: (sql, params) => queryHandler(sql, params) });
  db.kvGet = async (key, fallback) => (key in kvStore ? kvStore[key] : fallback);
}

function restoreDb() {
  db.hasDb = origHasDb;
  db.getPool = origGetPool;
  db.kvGet = origKvGet;
  kvStore = {};
}

function mockSnapshot(overrides = {}) {
  return {
    days: 30,
    spend: 1000,
    blended_roas: 2.5,
    true_roas: 3,
    total_revenue: 2500,
    conversions: 50,
    impressions: 10000,
    clicks: 500,
    cac: 20,
    availability: {
      spend: { status: AVAILABILITY.AVAILABLE, reason: null },
      blended_roas: { status: AVAILABILITY.AVAILABLE, reason: null },
      true_roas: { status: AVAILABILITY.AVAILABLE, reason: null },
      total_revenue: { status: AVAILABILITY.AVAILABLE, reason: null },
      conversions: { status: AVAILABILITY.AVAILABLE, reason: null },
      impressions: { status: AVAILABILITY.AVAILABLE, reason: null },
      clicks: { status: AVAILABILITY.AVAILABLE, reason: null },
      cac: { status: AVAILABILITY.AVAILABLE, reason: null },
    },
    labelled: {
      cac: { availability: AVAILABILITY.AVAILABLE, is_proxy: true },
      blended_roas: { availability: AVAILABILITY.AVAILABLE },
    },
    ...overrides,
  };
}

function adPerfRow(overrides = {}) {
  return {
    channel: 'meta',
    spend: 1000,
    revenue: 2500,
    impressions: 10000,
    clicks: 500,
    conversions: 50,
    ...overrides,
  };
}

async function compute(tid = 1, days = 30) {
  delete require.cache[require.resolve('../services/canonical_metrics/compute')];
  const { computeCanonicalMetrics } = require('../services/canonical_metrics/compute');
  return computeCanonicalMetrics(tid, { days });
}

describe('goals_vs_actuals live canonical resolution (PR10G.7)', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../services/canonical_metrics/compute')];
    kvStore = {};
  });

  afterEach(() => {
    restoreDb();
    delete require.cache[require.resolve('../services/canonical_metrics/compute')];
  });

  it('live canonical value wins over stale stored OKR actual', async () => {
    installMockDb(async (sql) => {
      if (/ad_performance_hourly/i.test(sql) && /GROUP BY 1/i.test(sql)) {
        return { rows: [adPerfRow({ spend: 500, revenue: 1500 })] };
      }
      if (/spend_events/i.test(sql)) return { rows: [] };
      if (/offline_conversions/i.test(sql)) return { rows: [{ cents: '0', n: 0 }] };
      if (/okr_key_results/i.test(sql)) {
        return {
          rows: [{
            objective: 'Grow revenue',
            kr_title: 'Blended ROAS',
            metric_type: 'blended_roas',
            linked_channel: '',
            target_value: 3,
            current_value: 0.5,
            unit: 'x',
          }],
        };
      }
      if (/agent_goals/i.test(sql)) return { rows: [] };
      if (/budgets/i.test(sql) || /prior/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const snap = await compute(1, 30);
    const gva = snap.goals_vs_actuals.find((g) => g.metric === 'blended_roas');
    assert.ok(gva, 'okr row present');
    assert.equal(gva.actual, 3);
    assert.notEqual(gva.actual, 0.5);
    assert.equal(gva.target, 3);
    assert.equal(gva.status, 'on-track');
    assert.equal(gva.from_canonical, true);
  });

  it('verified zero remains 0 for canonical auto KR', () => {
    const snap = mockSnapshot({
      blended_roas: 0,
      spend: 100,
      online_revenue: 0,
      availability: {
        blended_roas: { status: AVAILABILITY.AVAILABLE, reason: null },
        spend: { status: AVAILABILITY.AVAILABLE, reason: null },
      },
      labelled: {
        blended_roas: { availability: AVAILABILITY.AVAILABLE },
      },
    });
    const row = buildOkrRow({
      objective: 'Efficiency',
      kr_title: 'ROAS',
      metric_type: 'blended_roas',
      linked_channel: '',
      target_value: 2,
      current_value: 99,
      unit: 'x',
    }, snap);
    assert.equal(row.actual, 0);
    assert.equal(row.status, 'off-track');
    assert.equal(row.metric_availability, AVAILABILITY.AVAILABLE);
  });

  it('unavailable canonical withholds actual and marks unverified', () => {
    const snap = mockSnapshot({
      blended_roas: null,
      availability: {
        blended_roas: { status: AVAILABILITY.UNAVAILABLE, reason: REASON.SOURCE_QUERY_FAILED },
      },
      labelled: {
        blended_roas: {
          availability: AVAILABILITY.UNAVAILABLE,
          availability_reason: REASON.SOURCE_QUERY_FAILED,
        },
      },
    });
    const row = buildOkrRow({
      objective: 'O',
      kr_title: 'KR',
      metric_type: 'blended_roas',
      linked_channel: '',
      target_value: 2,
      current_value: 5,
      unit: 'x',
    }, snap);
    assert.equal(row.actual, null);
    assert.equal(row.status, 'unverified');
    assert.equal(row.metric_availability, AVAILABILITY.UNAVAILABLE);
    assert.equal(isVerifiedGoalRow(row), false);
  });

  it('partial canonical retains value with unverified status', () => {
    const snap = mockSnapshot({
      blended_roas: 1.8,
      availability: {
        blended_roas: { status: AVAILABILITY.PARTIAL, reason: REASON.OFFLINE_UNAVAILABLE },
      },
      labelled: {
        blended_roas: {
          availability: AVAILABILITY.PARTIAL,
          availability_reason: REASON.OFFLINE_UNAVAILABLE,
        },
      },
    });
    const row = buildOkrRow({
      objective: 'O',
      kr_title: 'KR',
      metric_type: 'blended_roas',
      linked_channel: '',
      target_value: 2,
      current_value: 0,
      unit: 'x',
    }, snap);
    assert.equal(row.actual, 1.8);
    assert.equal(row.status, 'unverified');
    assert.equal(row.metric_availability, AVAILABILITY.PARTIAL);
    assert.equal(isVerifiedGoalRow(row), false);
  });

  it('proxy estimates are labelled on growth goals', () => {
    const snap = mockSnapshot({
      cac: 42,
      labelled: {
        cac: { availability: AVAILABILITY.AVAILABLE, is_proxy: true },
      },
    });
    const items = buildGoalsVsActuals(snap, {
      growthGoals: [{
        id: 'g1',
        metric: 'ads.cac',
        target: 50,
        label: 'CAC cap',
      }],
    });
    assert.equal(items[0].actual, 42);
    assert.equal(items[0].metric_is_proxy, true);
    assert.match(formatGoalActualDisplay(items[0]), /proxy/);
  });

  it('manual OKR preserves stored measurement and target', () => {
    const snap = mockSnapshot();
    const row = buildOkrRow({
      objective: 'Manual',
      kr_title: 'Survey NPS',
      metric_type: 'manual',
      linked_channel: '',
      target_value: 80,
      current_value: 72,
      unit: '',
    }, snap);
    assert.equal(row.actual, 72);
    assert.equal(row.target, 80);
    assert.equal(row.status, 'at-risk');
    assert.equal(row.from_canonical, false);
  });

  it('channel-scoped auto KR stays unverified and keeps stored actual', () => {
    const snap = mockSnapshot({ blended_roas: 9 });
    const row = buildOkrRow({
      objective: 'Channel',
      kr_title: 'Meta ROAS',
      metric_type: 'roas',
      linked_channel: 'Meta',
      target_value: 2,
      current_value: 1.5,
      unit: 'x',
    }, snap);
    assert.equal(row.actual, 1.5);
    assert.notEqual(row.actual, 9);
    assert.equal(row.status, 'unverified');
    assert.equal(row.from_canonical, false);
  });

  it('includes growth goals from kv with live canonical actuals', async () => {
    kvStore['goals:t1'] = [{
      id: 'g1',
      metric: 'ads.totalSpend',
      target: 2000,
      label: 'Spend cap',
    }];
    installMockDb(async (sql) => {
      if (/ad_performance_hourly/i.test(sql) && /GROUP BY 1/i.test(sql)) {
        return { rows: [adPerfRow({ spend: 800 })] };
      }
      if (/spend_events/i.test(sql)) return { rows: [] };
      if (/offline_conversions/i.test(sql)) return { rows: [{ cents: '0', n: 0 }] };
      if (/okr_key_results/i.test(sql) || /agent_goals/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const snap = await compute(1, 30);
    const g = snap.goals_vs_actuals.find((x) => x.source === 'growth_goals');
    assert.ok(g);
    assert.equal(g.actual, 800);
    assert.equal(g.target, 2000);
    assert.equal(g.status, 'on-track');
  });

  it('resolves multiple canonical goals from one snapshot without extra compute', () => {
    const snap = mockSnapshot({ spend: 500, blended_roas: 2.5 });
    const items = buildGoalsVsActuals(snap, {
      okrRows: [
        {
          objective: 'A',
          kr_title: 'ROAS',
          metric_type: 'blended_roas',
          linked_channel: '',
          target_value: 2,
          current_value: 0.1,
          unit: 'x',
        },
        {
          objective: 'B',
          kr_title: 'Spend',
          metric_type: 'spend',
          linked_channel: '',
          target_value: 400,
          current_value: 10,
          unit: '$',
        },
      ],
      growthGoals: [{
        id: 'g1',
        metric: 'ads.blendedRoas',
        target: 2,
        label: 'Blended ROAS goal',
      }],
    });
    assert.equal(items.length, 3);
    assert.equal(items[0].actual, 2.5);
    assert.equal(items[1].actual, 500);
    assert.equal(items[2].actual, 2.5);
    assert.notEqual(items[0].actual, 0.1);
    assert.notEqual(items[1].actual, 10);
  });
});
