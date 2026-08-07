'use strict';

/**
 * Contribution system of record — platform claims beside causal estimates.
 *
 * Build order for pain #1:
 *  1. Platform-reported figures from canonical metrics (measured)
 *  2. Holdout / iROAS tests when present (modelled, preferred)
 *  3. Live MMM-lite response curves fitted to spend→revenue history
 *  4. Budget recommendations ranked by incremental impact, not claimed ROAS
 */

const _db = require('../../db');
const { computeCanonicalMetrics } = require('./compute');
const { DEFINITION_VERSION, labelledValue } = require('./definitions');

function _round(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** d;
  return Math.round(Number(n) * f) / f;
}

function _calcIroas(test) {
  const {
    test_reach, control_reach, test_conversions, control_conversions,
    test_spend, reported_revenue, avg_order_value,
  } = test;
  const tr = Number(test_reach) || 0;
  const cr = Number(control_reach) || 0;
  const tc = Number(test_conversions) || 0;
  const cc = Number(control_conversions) || 0;
  const spend = Number(test_spend) || 0;
  const reported = Number(reported_revenue) || 0;
  if (!tr || !cr || !spend) return null;
  const testCvr = tc / tr;
  const ctrlCvr = cc / cr;
  const liftPct = ctrlCvr > 0 ? ((testCvr - ctrlCvr) / ctrlCvr) * 100 : null;
  const incrementalConversions = (testCvr - ctrlCvr) * tr;
  const aov = Number(avg_order_value) || (tc > 0 ? reported / tc : 0);
  const incrementalRevenue = Math.max(0, incrementalConversions * aov);
  const iroas = spend > 0 ? incrementalRevenue / spend : null;
  const reportedRoas = spend > 0 && reported > 0 ? reported / spend : null;
  return {
    test_cvr: _round(testCvr, 4),
    control_cvr: _round(ctrlCvr, 4),
    lift_pct: liftPct != null ? _round(liftPct, 1) : null,
    incremental_conversions: _round(incrementalConversions, 1),
    incremental_revenue: _round(incrementalRevenue),
    iroas: iroas != null ? _round(iroas) : null,
    reported_roas: reportedRoas != null ? _round(reportedRoas) : null,
    iroas_vs_reported: (iroas != null && reportedRoas)
      ? _round(((iroas - reportedRoas) / reportedRoas) * 100, 1)
      : null,
  };
}

/**
 * Fit a simple diminishing-returns curve per channel:
 *   revenue ≈ a * spend^b   (0 < b ≤ 1)
 * using log-log OLS on daily points. Fail-open to linear when under-sampled.
 */
function fitResponseCurve(points) {
  const usable = (points || []).filter((p) => p.spend > 0 && p.revenue >= 0);
  if (usable.length < 4) {
    const spend = usable.reduce((s, p) => s + p.spend, 0);
    const rev = usable.reduce((s, p) => s + p.revenue, 0);
    const roas = spend > 0 ? rev / spend : 0;
    return {
      model: 'linear_fallback',
      a: roas,
      b: 1,
      r2: null,
      n: usable.length,
      predict(s) { return Math.max(0, roas * Math.max(0, s)); },
      marginal(s) { return roas; },
    };
  }

  let sumX = 0; let sumY = 0; let sumXX = 0; let sumXY = 0;
  const n = usable.length;
  for (const p of usable) {
    const x = Math.log(p.spend);
    const y = Math.log(Math.max(p.revenue, 1e-6));
    sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  let b = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 1;
  b = Math.min(1, Math.max(0.15, b));
  const meanX = sumX / n;
  const meanY = sumY / n;
  const logA = meanY - b * meanX;
  const a = Math.exp(logA);

  // R² in log space
  let ssTot = 0; let ssRes = 0;
  for (const p of usable) {
    const y = Math.log(Math.max(p.revenue, 1e-6));
    const yHat = logA + b * Math.log(p.spend);
    ssTot += (y - meanY) ** 2;
    ssRes += (y - yHat) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;

  return {
    model: 'power_curve',
    a: _round(a, 6),
    b: _round(b, 4),
    r2: r2 != null ? _round(r2, 3) : null,
    n,
    predict(s) {
      const x = Math.max(0, Number(s) || 0);
      if (x <= 0) return 0;
      return Math.max(0, a * (x ** b));
    },
    marginal(s) {
      const x = Math.max(1, Number(s) || 0);
      // d/ds (a s^b) = a * b * s^(b-1)
      return Math.max(0, a * b * (x ** (b - 1)));
    },
  };
}

async function _channelDailySeries(tid, days) {
  if (!_db.hasDb() || !Number.isFinite(tid)) return {};
  try {
    const pool = _db.getPool();
    const r = await pool.query(
      `SELECT lower(replace(c.platform, 'facebook', 'meta')) AS channel,
              to_char(p.bucket_hour,'YYYY-MM-DD') AS day,
              COALESCE(SUM(p.spend),0)::float8 AS spend,
              COALESCE(SUM(p.revenue),0)::float8 AS revenue
         FROM ad_performance_hourly p
         JOIN ad_campaigns c ON c.id = p.campaign_id
        WHERE c.tenant_id = $1
          AND p.bucket_hour >= now() - ($2)::interval
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [tid, `${days} days`],
    );
    const by = {};
    for (const row of r.rows) {
      const ch = row.channel || 'unknown';
      if (!by[ch]) by[ch] = [];
      by[ch].push({
        day: row.day,
        spend: Number(row.spend || 0),
        revenue: Number(row.revenue || 0),
      });
    }
    return by;
  } catch {
    return {};
  }
}

async function _loadHoldoutTests(tid) {
  if (!_db.hasDb() || !Number.isFinite(tid)) return [];
  try {
    const { rows } = await _db.getPool().query(
      `SELECT * FROM iroas_tests
        WHERE tenant_id=$1
          AND status IN ('active','completed','complete','done')
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 50`,
      [tid],
    );
    return rows.map((r) => ({ ...r, computed: _calcIroas(r) }));
  } catch {
    return [];
  }
}

function _holdoutByChannel(tests) {
  const map = {};
  for (const t of tests) {
    const ch = String(t.channel || 'unknown').toLowerCase().replace('facebook', 'meta');
    const c = t.computed;
    if (!c || c.iroas == null) continue;
    // Prefer most recent completed-like; first occurrence wins (already sorted desc)
    if (!map[ch]) {
      map[ch] = {
        test_id: t.id,
        name: t.name,
        campaign_name: t.campaign_name,
        holdout_pct: t.holdout_pct,
        iroas: c.iroas,
        reported_roas: c.reported_roas,
        lift_pct: c.lift_pct,
        incremental_revenue: c.incremental_revenue,
        incremental_conversions: c.incremental_conversions,
        test_spend: Number(t.test_spend) || 0,
        confidence: c.lift_pct != null && Math.abs(c.lift_pct) >= 5 ? 0.75 : 0.55,
        source: 'holdout',
      };
    }
  }
  return map;
}

/**
 * Build contribution record for a tenant.
 */
async function computeContribution(tid, opts = {}) {
  const days = Math.min(90, Math.max(7, parseInt(opts.days, 10) || 30));
  const snap = await computeCanonicalMetrics(tid, { days });
  const series = await _channelDailySeries(tid, days);
  const tests = await _loadHoldoutTests(tid);
  const holdouts = _holdoutByChannel(tests);

  const channels = new Set([
    ...Object.keys(snap.spend_by_channel || {}),
    ...Object.keys(series),
    ...Object.keys(holdouts),
  ]);

  const channel_rows = [];
  let platformRevenue = 0;
  let incrementalRevenue = 0;
  let modelledSpend = 0;

  for (const ch of [...channels].sort()) {
    const spend = Number(snap.spend_by_channel?.[ch] || 0);
    const daily = series[ch] || [];
    const platformRev = daily.reduce((s, p) => s + p.revenue, 0);
    // If daily empty, apportion online revenue by spend share
    let reportedRev = platformRev;
    if (!reportedRev && snap.spend > 0 && spend > 0) {
      reportedRev = (snap.online_revenue || 0) * (spend / snap.spend);
    }
    platformRevenue += reportedRev;
    const platformRoas = spend > 0 ? reportedRev / spend : null;

    const curve = fitResponseCurve(daily.length ? daily : (
      spend > 0 ? [{ spend, revenue: reportedRev }] : []
    ));
    const mmmRev = curve.predict(spend);
    const marginal = curve.marginal(spend);
    const mmmIroas = spend > 0 ? mmmRev / spend : null;

    const holdout = holdouts[ch] || null;
    // Prefer holdout iROAS for causal estimate; else MMM curve
    let causalIroas = null;
    let causalRev = null;
    let causalSource = 'none';
    let confidence = 0.35;

    if (holdout && holdout.iroas != null) {
      causalIroas = holdout.iroas;
      causalRev = spend > 0 ? causalIroas * spend : holdout.incremental_revenue;
      causalSource = 'holdout';
      confidence = holdout.confidence;
    } else if (mmmIroas != null && curve.n >= 4) {
      // Shrink platform ROAS toward curve — treat curve revenue as incremental proxy
      // Discount claimed revenue by curve fit quality and typical overstatement
      const shrink = Math.min(0.95, Math.max(0.35, (curve.r2 == null ? 0.5 : curve.r2)));
      causalRev = mmmRev * shrink;
      causalIroas = spend > 0 ? causalRev / spend : null;
      causalSource = 'mmm_lite';
      confidence = curve.r2 != null ? Math.min(0.7, Math.max(0.4, curve.r2)) : 0.45;
    } else if (platformRoas != null) {
      // No causal evidence — apply conservative 0.4× haircut on platform claim
      causalRev = reportedRev * 0.4;
      causalIroas = spend > 0 ? causalRev / spend : null;
      causalSource = 'platform_haircut';
      confidence = 0.25;
    }

    incrementalRevenue += Number(causalRev) || 0;
    modelledSpend += spend;

    const overstatement = (platformRoas != null && causalIroas != null && causalIroas > 0)
      ? _round(platformRoas / causalIroas, 2)
      : null;

    channel_rows.push({
      channel: ch,
      spend: _round(spend) || 0,
      platform: {
        revenue: labelledValue('online_revenue', _round(reportedRev) || 0, {
          confidence: 0.9,
          evidence: 'ad_performance_hourly',
          overrideKind: 'measured',
        }),
        roas: labelledValue('reported_roas', platformRoas != null ? _round(platformRoas) : null, {
          confidence: 0.9,
          evidence: 'platform_attribution',
        }),
      },
      causal: {
        revenue: labelledValue('incremental_revenue', causalRev != null ? _round(causalRev) : null, {
          confidence,
          evidence: causalSource,
        }),
        iroas: labelledValue('iroas', causalIroas != null ? _round(causalIroas) : null, {
          confidence,
          evidence: causalSource,
        }),
        source: causalSource,
        confidence,
      },
      mmm: {
        model: curve.model,
        a: curve.a,
        b: curve.b,
        r2: curve.r2,
        n: curve.n,
        predicted_revenue: _round(mmmRev),
        marginal_roas: _round(marginal, 3),
        kind: 'modelled',
      },
      holdout: holdout ? {
        test_id: holdout.test_id,
        name: holdout.name,
        lift_pct: holdout.lift_pct,
        iroas: holdout.iroas,
        reported_roas: holdout.reported_roas,
        kind: 'modelled',
      } : null,
      overstatement_factor: overstatement,
      recommendation_score: causalIroas != null ? causalIroas : (marginal || 0),
    });
  }

  // Rank budget moves by marginal / causal iROAS
  const ranked = [...channel_rows]
    .filter((r) => r.spend > 0 || r.causal.iroas?.value != null)
    .sort((a, b) => (b.recommendation_score || 0) - (a.recommendation_score || 0));

  const budget_recommendations = [];
  if (ranked.length >= 2) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (
      best.recommendation_score != null
      && worst.recommendation_score != null
      && best.recommendation_score > worst.recommendation_score
      && worst.spend > 0
    ) {
      const shift = _round(Math.min(worst.spend * 0.15, Math.max(50, worst.spend * 0.1))) || 0;
      if (shift > 0) {
        const expectedLift = _round(
          shift * ((best.recommendation_score || 0) - (worst.recommendation_score || 0)),
        );
        budget_recommendations.push({
          from: worst.channel,
          to: best.channel,
          amount: shift,
          why: `Ranked by causal iROAS/marginal return (${best.causal.source}), not platform ROAS.`,
          expected_incremental_revenue: expectedLift,
          kind: 'projected',
          confidence: Math.min(best.causal.confidence || 0.4, worst.causal.confidence || 0.4),
          evidence: {
            best_iroas: best.causal.iroas?.value,
            worst_iroas: worst.causal.iroas?.value,
            best_platform_roas: best.platform.roas?.value,
            worst_platform_roas: worst.platform.roas?.value,
          },
        });
      }
    }
  }

  // Underwater by causal estimate
  for (const row of channel_rows) {
    if (row.spend > 0 && row.causal.iroas?.value != null && row.causal.iroas.value < 1) {
      budget_recommendations.push({
        from: row.channel,
        to: null,
        amount: _round(row.spend * 0.2) || 0,
        why: `Causal iROAS ${row.causal.iroas.value}x < 1× — cut or redesign before trusting platform ${row.platform.roas?.value ?? 'n/a'}x.`,
        expected_incremental_revenue: 0,
        kind: 'projected',
        confidence: row.causal.confidence,
        action: 'reduce',
      });
    }
  }

  const platformRoas = snap.spend > 0 && platformRevenue > 0
    ? _round(platformRevenue / snap.spend) : snap.reported_roas;
  const causalIroas = modelledSpend > 0 && incrementalRevenue > 0
    ? _round(incrementalRevenue / modelledSpend) : null;

  const summary = {
    days,
    definition_version: DEFINITION_VERSION,
    system_of_record: 'causal',
    note: 'Budget defence uses incremental/MMM estimates. Platform ROAS is shown beside — never above — causal figures.',
    platform: {
      spend: labelledValue('spend', snap.spend, { confidence: 0.95, evidence: 'canonical' }),
      revenue: labelledValue('online_revenue', _round(platformRevenue) || snap.online_revenue, {
        confidence: 0.9,
        evidence: 'platform_attribution',
      }),
      roas: labelledValue('reported_roas', platformRoas, { confidence: 0.9, evidence: 'platform_attribution' }),
      true_roas: labelledValue('true_roas', snap.true_roas, {
        confidence: snap.offline_revenue > 0 ? 0.7 : 0.5,
        evidence: 'online+offline',
      }),
    },
    causal: {
      incremental_revenue: labelledValue('incremental_revenue', _round(incrementalRevenue), {
        confidence: tests.length ? 0.7 : 0.45,
        evidence: Object.values(holdouts).length ? 'holdout+mmm_lite' : 'mmm_lite',
      }),
      iroas: labelledValue('iroas', causalIroas, {
        confidence: tests.length ? 0.7 : 0.45,
        evidence: Object.values(holdouts).length ? 'holdout+mmm_lite' : 'mmm_lite',
      }),
    },
    overstatement_factor: (platformRoas && causalIroas)
      ? _round(platformRoas / Math.max(causalIroas, 0.01), 2)
      : null,
    holdout_tests_used: Object.keys(holdouts).length,
    holdout_tests_total: tests.length,
    channels_modelled: channel_rows.length,
  };

  return {
    ok: true,
    tenant_id: tid,
    generated_at: new Date().toISOString(),
    definition_version: DEFINITION_VERSION,
    summary,
    channels: channel_rows.sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    budget_recommendations: budget_recommendations.slice(0, 8),
    canonical: {
      spend: snap.spend,
      online_revenue: snap.online_revenue,
      offline_revenue: snap.offline_revenue,
      true_roas: snap.true_roas,
      blended_roas: snap.blended_roas,
      cac: snap.cac,
      cpa: snap.cpa,
      ltv: snap.ltv,
      mer: snap.mer,
      kpis: snap.kpis,
      provenance: snap.provenance,
    },
    method: {
      holdout: 'geo/audience holdout tests from iroas_tests when status active/completed',
      mmm_lite: 'per-channel power-curve OLS on daily spend→revenue (revenue ≈ a·spend^b)',
      ranking: 'recommendations sorted by causal iROAS / marginal return, not platform ROAS',
      labelling: 'every figure carries kind=measured|modelled|projected + confidence + evidence',
    },
  };
}

module.exports = {
  computeContribution,
  fitResponseCurve,
  _calcIroas,
};
