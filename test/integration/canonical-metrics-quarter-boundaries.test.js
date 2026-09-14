'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL || process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10G8_REQUIRE_DATABASE === '1';

test('Canonical metrics calendar-quarter UTC boundaries (PR10G.8)', {
  skip: !dedicatedUrl && !required ? 'no PR10F1_TEST_DATABASE_URL' : false,
  timeout: 180_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10F1_TEST_DATABASE_URL is required');

  const environment = {
    DATABASE_URL: dedicatedUrl,
    NODE_ENV: 'test',
    PERMISSION_ENFORCEMENT: 'on',
    MULTITENANT_ENFORCEMENT: 'on',
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  require('../helpers/env');

  let app;
  let db;
  let fx;
  t.after(async () => {
    try {
      if (app) await app.close();
      if (fx) await fx.cleanup();
    } finally {
      if (db) await db.getPool().end();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  db = require('../../db');
  fx = require('../helpers/fixtures').makeFixtures();
  await db.ensureSchema();
  await fx.ensureSchemas();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  await require('../../services/budget_board/schema').ensureBudgetSchema();
  await require('../../services/true_roas/schema').ensureTrueRoasSchema();
  await require('../../services/okr/schema').ensureOkrSchema();

  const { computeCanonicalMetrics } = require('../../services/canonical_metrics/compute');
  const { quarterBounds, measurementCutoff } = require('../../services/canonical_metrics/period');
  const pool = db.getPool();

  const tenant = await fx.seedTenant('Quarter Boundaries');
  const tid = tenant.id;

  const campaignId = (await pool.query(
    `INSERT INTO ad_campaigns (tenant_id, name, platform_camp_id, platform, currency)
     VALUES ($1, 'Q-boundary', 'qb', 'meta', 'USD') RETURNING id`,
    [tid],
  )).rows[0].id;

  const rows = [
    ['2024-02-29T12:00:00.000Z', 100, 250, 10, 5, 2],
    ['2024-03-01T00:00:00.000Z', 50, 120, 5, 2, 1],
    ['2024-03-31T23:00:00.000Z', 75, 180, 8, 4, 2],
    ['2024-04-01T00:00:00.000Z', 999, 999, 99, 99, 99],
    ['2023-06-30T12:00:00.000Z', 40, 90, 4, 2, 1],
    ['2023-07-01T00:00:00.000Z', 60, 140, 6, 3, 2],
    ['2023-09-30T23:00:00.000Z', 30, 70, 3, 1, 1],
    ['2023-10-01T00:00:00.000Z', 888, 888, 88, 88, 88],
  ];

  for (const [bucket_hour, spend, revenue, impressions, clicks, conversions] of rows) {
    await pool.query(
      `INSERT INTO ad_performance_hourly
         (tenant_id, campaign_id, bucket_hour, spend, impressions, clicks, conversions, revenue, raw)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, '{}')`,
      [tid, campaignId, bucket_hour, spend, impressions, clicks, conversions, revenue],
    );
  }

  await pool.query(
    `INSERT INTO spend_events (tenant_id, channel, amount_cents, occurred_at, source)
     VALUES ($1, 'other', 5000, '2024-03-15', 'test'),
            ($1, 'other', 900000, '2024-04-01', 'test')`,
    [tid],
  );

  await pool.query(
    `INSERT INTO offline_conversions (tenant_id, revenue_cents, closed_at, source, source_deal_id)
     VALUES ($1, 12000, '2024-03-20T12:00:00.000Z', 'test', $2),
            ($1, 990000, '2024-04-01T00:00:00.000Z', 'test', $3)`,
    [tid, 'deal-in-q1', 'deal-after-q1'],
  );

  assert.equal(quarterBounds('2024-Q1').days, 91);
  assert.equal(quarterBounds('2023-Q3').days, 92);

  const q1 = await computeCanonicalMetrics(tid, { quarter: '2024-Q1' });
  assert.equal(q1.period_authoritative, true);
  assert.equal(q1.period_quarter, '2024-Q1');
  assert.equal(q1.period_start, '2024-01-01');
  assert.equal(q1.period_end, '2024-03-31');
  assert.equal(q1.period_cutoff, 'full_quarter');
  assert.equal(q1.spend, 275);
  assert.equal(q1.online_revenue, 550);
  assert.equal(q1.offline_revenue, 120);
  assert.equal(q1.conversions, 5);

  const q3 = await computeCanonicalMetrics(tid, { quarter: '2023-Q3' });
  assert.equal(q3.spend, 90);
  assert.equal(q3.conversions, 3);

  const future = await computeCanonicalMetrics(tid, {
    quarter: '2030-Q1',
    asOf: '2026-06-15T12:00:00.000Z',
  });
  assert.equal(future.period_cutoff, 'not_started');
  assert.equal(future.spend, null);
  assert.match(future.availability?.spend?.reason, /not_started/);

  const current = await computeCanonicalMetrics(tid, {
    quarter: '2024-Q1',
    asOf: '2024-03-15T12:00:00.000Z',
  });
  assert.equal(current.period_cutoff, 'quarter_to_date');
  assert.match(current.period_cutoff_label, /quarter-to-date/i);
  assert.equal(current.spend, 200);
  assert.equal(current.conversions, 3);

  const objId = 'okr_' + randomUUID().replace(/-/g, '').slice(0, 12);
  await pool.query(
    `INSERT INTO okr_objectives (id, tenant_id, title, quarter, status)
     VALUES ($1, $2, 'Q1 ROAS', '2024-Q1', 'on_track')`,
    [objId, tid],
  );
  await pool.query(
    `INSERT INTO okr_key_results
       (id, tenant_id, objective_id, title, metric_type, target_value, current_value, unit)
     VALUES ($1, $2, $3, 'Blended ROAS', 'roas', 2, 0.5, 'x'),
            ($4, $2, $3, 'Spend cap', 'spend', 500, 0, '$')`,
    ['kr_' + randomUUID().replace(/-/g, '').slice(0, 12), tid, objId,
      'kr_' + randomUUID().replace(/-/g, '').slice(0, 12)],
  );

  const rolling = await computeCanonicalMetrics(tid, { days: 30, asOf: '2024-04-10T12:00:00.000Z' });
  const roasRows = (rolling.goals_vs_actuals || []).filter((g) => g.metric === 'roas');
  const spendRows = (rolling.goals_vs_actuals || []).filter((g) => g.metric === 'spend');
  assert.equal(roasRows.length, 1);
  assert.equal(spendRows.length, 1);
  assert.equal(roasRows[0].actual, q1.blended_roas);
  assert.equal(spendRows[0].actual, q1.spend);
  assert.match(roasRows[0].measurement_period_label || '', /2024-Q1/);
  assert.doesNotMatch(roasRows[0].measurement_period_label || '', /rolling/i);
});
