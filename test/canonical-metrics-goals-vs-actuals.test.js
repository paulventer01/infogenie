'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { AVAILABILITY, REASON } = require('../services/canonical_metrics/availability');
const {
  buildGoalsVsActuals,
  buildOkrRow,
  isVerifiedGoalRow,
  formatGoalActualDisplay,
  formatGoalStatusDisplay,
  okrMeasurementPeriod,
  quarterBounds,
  snapshotMatchesGoalPeriod,
} = require('../services/canonical_metrics/goals_vs_actuals');

const db = require('../db');
const origHasDb = db.hasDb;
const origGetPool = db.getPool;
const origKvGet = db.kvGet;

let queryHandler = async () => ({ rows: [] });
let kvStore = {};

function currentQuarter() {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

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
  const period = okrMeasurementPeriod(currentQuarter());
  return {
    days: period?.days ?? 30,
    generated_at: new Date().toISOString(),
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

function okrRow(overrides = {}) {
  return {
    objective: 'Objective',
    kr_title: 'KR',
    metric_type: 'roas',
    linked_channel: '',
    quarter: currentQuarter(),
    objective_status: 'on_track',
    target_value: 2,
    current_value: 1.2,
    unit: 'x',
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

  it('rejects rolling snapshots for calendar-quarter OKRs until compute supplies authoritative bounds', async () => {
    const quarter = currentQuarter();
    const goalPeriod = okrMeasurementPeriod(quarter);
    const rolling = mockSnapshot({ days: 90, blended_roas: 9 });
    assert.equal(snapshotMatchesGoalPeriod(rolling, goalPeriod), false);

    installMockDb(async (sql) => {
      if (/ad_performance_hourly/i.test(sql) && /GROUP BY 1/i.test(sql)) {
        return { rows: [adPerfRow({ spend: 500, revenue: 1500 })] };
      }
      if (/spend_events/i.test(sql)) return { rows: [] };
      if (/offline_conversions/i.test(sql)) return { rows: [{ cents: '0', n: 0 }] };
      if (/okr_key_results/i.test(sql)) {
        return { rows: [okrRow({ quarter, target_value: 3, current_value: 0.5 })] };
      }
      if (/agent_goals/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const snap = await compute(1, goalPeriod.days);
    const gva = snap.goals_vs_actuals.find((g) => g.metric === 'roas');
    assert.ok(gva);
    assert.equal(gva.actual, null);
    assert.equal(gva.unverified_reason, 'period_mismatch');
    assert.equal(isVerifiedGoalRow(gva), false);

    const historical = buildOkrRow(okrRow({ quarter: '2024-Q1' }), mockSnapshot({ days: 30 }));
    assert.equal(historical.unverified_reason, 'period_mismatch');
    assert.match(formatGoalActualDisplay(historical), /period mismatch/i);
  });

  it('90-day window ending June 30 noon is not Q2 even when UTC date endpoints align', () => {
    const q2 = okrMeasurementPeriod('2026-Q2');
    const snap = mockSnapshot({ days: 90, generated_at: '2026-06-30T12:00:00.000Z' });
    assert.equal(snapshotMatchesGoalPeriod(snap, q2), false);
    const row = buildOkrRow(okrRow({ quarter: '2026-Q2' }), snap);
    assert.equal(row.actual, null);
    assert.equal(row.unverified_reason, 'period_mismatch');
  });

  it('calendar quarters keep full UTC day counts without 90-day truncation', () => {
    assert.equal(okrMeasurementPeriod('2024-Q1').days, 91);
    assert.equal(okrMeasurementPeriod('2023-Q3').days, 92);
    assert.equal(quarterBounds('2023-Q3').start, '2023-07-01');
    assert.equal(quarterBounds('2023-Q3').end, '2023-09-30');
  });

  it('authoritative quarter snapshots may resolve live canonical OKR actuals', () => {
    const quarter = '2026-Q2';
    const period = okrMeasurementPeriod(quarter);
    const snap = mockSnapshot({
      days: period.days,
      blended_roas: 3,
      period_authoritative: true,
      period_kind: 'quarter',
      period_quarter: quarter,
      period_start: period.start,
      period_end: period.end,
    });
    const row = buildOkrRow(okrRow({ quarter, target_value: 3, current_value: 0.5 }), snap);
    assert.equal(row.actual, 3);
    assert.equal(row.status, 'on-track');
    assert.equal(row.from_canonical, true);
  });

  it('preserves completion, manual measurements, and channel-stored labels', () => {
    const complete = buildOkrRow(okrRow({
      quarter: '2024-Q1',
      objective_status: 'complete',
      current_value: 2.5,
    }), mockSnapshot({ blended_roas: 0.2 }));
    assert.equal(complete.status, 'complete');
    assert.equal(complete.actual, 2.5);

    const manual = buildOkrRow(okrRow({
      metric_type: 'manual',
      kr_title: 'Survey NPS',
      target_value: 80,
      current_value: 72,
      unit: '',
    }), mockSnapshot());
    assert.equal(manual.actual, 72);
    assert.equal(manual.status, 'at-risk');

    const channel = buildOkrRow(okrRow({
      kr_title: 'Meta ROAS',
      linked_channel: 'Meta',
      current_value: 1.5,
    }), mockSnapshot({ blended_roas: 9 }));
    assert.equal(channel.actual, 1.5);
    assert.equal(channel.measurement_source, 'stored');
    assert.match(formatGoalStatusDisplay(channel), /unverified \(stored\)/);
    assert.doesNotMatch(formatGoalStatusDisplay(channel), /partial/i);
  });

  it('rolling growth goals still match on shared periodDays', async () => {
    const snap = mockSnapshot({ days: 30, spend: 500, blended_roas: 2.5 });
    const items = buildGoalsVsActuals(snap, {
      growthGoals: [
        { id: 'g1', metric: 'ads.blendedRoas', target: 2, label: 'Blended ROAS goal', periodDays: 30 },
        { id: 'g2', metric: 'ads.cac', target: 50, label: 'CAC cap', periodDays: 30 },
        { id: 'g3', metric: 'ads.totalSpend', target: 2000, label: 'Spend cap', periodDays: 90 },
      ],
    });
    assert.equal(items[0].actual, 2.5);
    assert.equal(items[0].status, 'on-track');
    assert.equal(items[1].metric_is_proxy, true);
    assert.match(formatGoalActualDisplay(items[1]), /proxy/);
    assert.equal(items[2].unverified_reason, 'period_mismatch');

    kvStore['goals:t1'] = [{ id: 'g4', metric: 'ads.totalSpend', target: 2000, label: 'Spend cap', periodDays: 30 }];
    installMockDb(async (sql) => {
      if (/ad_performance_hourly/i.test(sql) && /GROUP BY 1/i.test(sql)) {
        return { rows: [adPerfRow({ spend: 800 })] };
      }
      if (/spend_events/i.test(sql)) return { rows: [] };
      if (/offline_conversions/i.test(sql)) return { rows: [{ cents: '0', n: 0 }] };
      if (/okr_key_results/i.test(sql) || /agent_goals/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const computed = await compute(1, 30);
    const growth = computed.goals_vs_actuals.find((x) => x.source === 'growth_goals');
    assert.equal(growth.actual, 800);
    assert.equal(growth.status, 'on-track');
  });

  it('formatters label complete and period mismatch rows for email consumers', () => {
    assert.equal(formatGoalStatusDisplay({ status: 'complete', actual: 2.5, unit: 'x', pct: 100 }), 'complete');
    const mismatch = {
      status: 'unverified',
      unverified_reason: 'period_mismatch',
      actual: null,
      unit: '$',
      metric_availability: AVAILABILITY.UNAVAILABLE,
      metric_availability_reason: 'period_mismatch',
    };
    assert.match(formatGoalActualDisplay(mismatch), /period mismatch/i);
    assert.equal(formatGoalStatusDisplay(mismatch), 'unverified (period mismatch)');
  });
});
