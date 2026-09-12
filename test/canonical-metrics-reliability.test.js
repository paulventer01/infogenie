'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DEFINITION_VERSION, labelledValue } = require('../services/canonical_metrics/definitions');
const { REASON } = require('../services/canonical_metrics/availability');

const db = require('../db');
const origHasDb = db.hasDb;
const origGetPool = db.getPool;

let queryHandler = async () => ({ rows: [] });

function installMockDb(handler) {
  queryHandler = handler;
  db.hasDb = () => true;
  db.getPool = () => ({ query: (sql, params) => queryHandler(sql, params) });
}

function restoreDb() {
  db.hasDb = origHasDb;
  db.getPool = origGetPool;
}

function adPerfRow(overrides = {}) {
  return {
    channel: 'meta',
    spend: 0,
    revenue: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    ...overrides,
  };
}

async function compute(tid = 1, days = 30) {
  const { computeCanonicalMetrics, readMetric, readMetricDetail } = require('../services/canonical_metrics/compute');
  const snap = await computeCanonicalMetrics(tid, { days });
  return { snap, readMetric, readMetricDetail };
}

describe('Canonical metrics data reliability (PR10G.1)', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../services/canonical_metrics/compute')];
  });

  afterEach(() => {
    restoreDb();
    delete require.cache[require.resolve('../services/canonical_metrics/compute')];
  });

  it('bumps definition version and documents availability on labelled values', () => {
    assert.equal(DEFINITION_VERSION, '2026.09.1');
    const v = labelledValue('cac', 42, {
      availability: 'available',
      is_proxy: true,
      confidence: 0.45,
    });
    assert.equal(v.availability, 'available');
    assert.equal(v.is_proxy, true);
    assert.equal(v.confidence, 0.45);
    const missing = labelledValue('reported_roas', null, {
      availability: 'unavailable',
      availability_reason: REASON.ZERO_DENOMINATOR,
      confidence: 0.9,
    });
    assert.equal(missing.confidence, null);
  });

  it('returns unavailable snapshot when database is missing', async () => {
    db.hasDb = () => false;
    const { snap, readMetric } = await compute(null);
    assert.equal(snap.spend, null);
    assert.equal(snap.reported_roas, null);
    assert.equal(snap.availability.spend.reason, REASON.DATABASE_UNAVAILABLE);
    assert.equal(readMetric(snap, 'spend'), null);
    assert.equal(snap.labelled.spend.availability, 'unavailable');
  });

  it('treats successful zero spend/revenue as available (not unavailable)', async () => {
    installMockDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM ad_performance_hourly/i.test(s) && /GROUP BY 1/i.test(s)) {
        return { rows: [] };
      }
      if (/FROM spend_events/i.test(s) && /GROUP BY 1/i.test(s) && /CURRENT_DATE/i.test(s)) {
        return { rows: [] };
      }
      if (/FROM offline_conversions/i.test(s) && /closed_at >= now/i.test(s) && !/closed_at <  now/i.test(s)) {
        return { rows: [{ cents: '0', n: 0 }] };
      }
      if (/FROM okr_key_results/i.test(s)) return { rows: [] };
      if (/FROM agent_goals/i.test(s)) return { rows: [] };
      if (/FROM budgets/i.test(s)) return { rows: [] };
      return { rows: [] };
    });

    const { snap } = await compute(1);
    assert.equal(snap.spend, 0);
    assert.equal(snap.online_revenue, 0);
    assert.equal(snap.availability.spend.status, 'available');
    assert.equal(snap.availability.online_revenue.status, 'available');
    assert.equal(snap.reported_roas, null);
    assert.equal(snap.availability.reported_roas.reason, REASON.ZERO_DENOMINATOR);
  });

  it('reports ROAS zero when verified revenue is zero and spend is positive', async () => {
    installMockDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM ad_performance_hourly/i.test(s) && /GROUP BY 1/i.test(s)) {
        return { rows: [adPerfRow({ spend: 250, revenue: 0, conversions: 5 })] };
      }
      if (/FROM spend_events/i.test(s) && /GROUP BY 1/i.test(s) && /CURRENT_DATE/i.test(s)) {
        return { rows: [] };
      }
      if (/FROM offline_conversions/i.test(s) && /closed_at >= now/i.test(s) && !/closed_at <  now/i.test(s)) {
        return { rows: [{ cents: '0', n: 0 }] };
      }
      if (/FROM okr_key_results/i.test(s)) return { rows: [] };
      if (/FROM agent_goals/i.test(s)) return { rows: [] };
      if (/FROM budgets/i.test(s)) return { rows: [] };
      if (/prior/i.test(s) || /bucket_hour <  now/i.test(s)) {
        return { rows: [{ spend: 0, revenue: 0, conversions: 0 }] };
      }
      return { rows: [] };
    });

    const { snap, readMetric } = await compute(1);
    assert.equal(snap.spend, 250);
    assert.equal(snap.online_revenue, 0);
    assert.equal(snap.reported_roas, 0);
    assert.equal(snap.availability.reported_roas.status, 'available');
    assert.equal(readMetric(snap, 'ads.blendedRoas'), 0);
  });

  it('marks metrics unavailable when ad_performance query fails', async () => {
    installMockDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM ad_performance_hourly/i.test(s)) {
        throw new Error('relation missing');
      }
      if (/FROM spend_events/i.test(s) && /GROUP BY 1/i.test(s) && /CURRENT_DATE/i.test(s)) {
        return { rows: [] };
      }
      if (/FROM offline_conversions/i.test(s)) {
        return { rows: [{ cents: '0', n: 0 }] };
      }
      if (/FROM okr_key_results/i.test(s)) return { rows: [] };
      if (/FROM agent_goals/i.test(s)) return { rows: [] };
      if (/FROM budgets/i.test(s)) return { rows: [] };
      return { rows: [] };
    });

    const { snap, readMetricDetail } = await compute(1);
    assert.equal(snap.spend, 0);
    assert.equal(snap.online_revenue, null);
    assert.equal(snap.availability.online_revenue.status, 'unavailable');
    assert.equal(snap.reported_roas, null);
    assert.match(snap.availability.reported_roas.reason, /input_unavailable|source_query_failed/);
    const roas = readMetricDetail(snap, 'reported_roas');
    assert.equal(roas.value, null);
    assert.equal(roas.availability, 'unavailable');
    assert.equal(snap.kpis.find((k) => k.key === 'reported_roas')?.confidence, null);
  });

  it('supports partial availability when offline conversions fail', async () => {
    installMockDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM ad_performance_hourly/i.test(s) && /GROUP BY 1/i.test(s)) {
        return { rows: [adPerfRow({ spend: 100, revenue: 200, conversions: 4 })] };
      }
      if (/FROM spend_events/i.test(s) && /GROUP BY 1/i.test(s) && /CURRENT_DATE/i.test(s)) {
        return { rows: [] };
      }
      if (/FROM offline_conversions/i.test(s)) {
        throw new Error('offline table missing');
      }
      if (/FROM okr_key_results/i.test(s)) return { rows: [] };
      if (/FROM agent_goals/i.test(s)) return { rows: [] };
      if (/FROM budgets/i.test(s)) return { rows: [] };
      if (/prior/i.test(s) || /bucket_hour <  now/i.test(s)) {
        return { rows: [{ spend: 50, revenue: 80, conversions: 2 }] };
      }
      return { rows: [] };
    });

    const { snap } = await compute(1);
    assert.equal(snap.total_revenue, 200);
    assert.equal(snap.availability.total_revenue.status, 'partial');
    assert.equal(snap.availability.true_roas.status, 'partial');
    assert.equal(snap.true_roas, 2);
  });

  it('labels conversion-based CAC and AOV LTV as proxies', async () => {
    installMockDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM ad_performance_hourly/i.test(s) && /GROUP BY 1/i.test(s)) {
        return { rows: [adPerfRow({ spend: 400, revenue: 800, conversions: 10 })] };
      }
      if (/FROM spend_events/i.test(s) && /GROUP BY 1/i.test(s) && /CURRENT_DATE/i.test(s)) {
        return { rows: [] };
      }
      if (/FROM offline_conversions/i.test(s) && !/closed_at <  now/i.test(s)) {
        return { rows: [{ cents: '0', n: 0 }] };
      }
      if (/FROM okr_key_results/i.test(s)) return { rows: [] };
      if (/FROM agent_goals/i.test(s)) return { rows: [] };
      if (/FROM budgets/i.test(s)) return { rows: [] };
      if (/prior/i.test(s) || /bucket_hour <  now/i.test(s)) {
        return { rows: [{ spend: 0, revenue: 0, conversions: 0 }] };
      }
      return { rows: [] };
    });

    const { snap } = await compute(1);
    assert.equal(snap.cac, 40);
    assert.equal(snap.labelled.cac.is_proxy, true);
    assert.equal(snap.ltv, 80);
    assert.equal(snap.labelled.ltv.is_proxy, true);
    assert.equal(snap.kpis.find((k) => k.key === 'cac')?.is_proxy, true);
  });

  it('propagates availability through readMetric and readMetricDetail', async () => {
    installMockDb(async (sql) => {
      if (/ad_performance_hourly/i.test(sql)) throw new Error('down');
      if (/offline_conversions/i.test(sql)) return { rows: [{ cents: '0', n: 0 }] };
      if (/spend_events/i.test(sql) && /CURRENT_DATE/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const { snap, readMetric, readMetricDetail } = await compute(1);
    assert.equal(readMetric(snap, 'cpa'), null);
    const cpa = readMetricDetail(snap, 'cpa');
    assert.equal(cpa.value, null);
    assert.equal(cpa.availability, 'unavailable');
    assert.ok(cpa.availability_reason);
  });
});
