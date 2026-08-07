'use strict';
/**
 * Canonical metrics engine — single source of truth for spend, revenue,
 * blended ROAS, true ROAS, CAC, and pacing inputs. Consumers (OKR, Growth Ops
 * goals, Budget Board, Weekly Report, Anomaly Detector) should read from here
 * instead of re-deriving conflicting numbers.
 */

const _db = require('../../db');
const { DEFINITION_VERSION, labelledValue, listDefinitions } = require('./definitions');

function _round(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** d;
  return Math.round(Number(n) * f) / f;
}

function _provenance(source, field, note) {
  return { source, field, note: note || null, at: new Date().toISOString() };
}

/**
 * Compute canonical metrics for a tenant over `days` lookback.
 * Pure DB aggregation — no live ad-network calls required.
 *
 * @param {number} tid
 * @param {{ days?: number }} [opts]
 */
async function computeCanonicalMetrics(tid, opts = {}) {
  const days = Math.min(90, Math.max(1, parseInt(opts.days, 10) || 30));
  const provenance = [];
  const out = {
    ok: true,
    days,
    tenant_id: tid,
    spend: 0,
    spend_cents: 0,
    spend_by_channel: {},
    online_revenue: 0,
    offline_revenue: 0,
    total_revenue: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    blended_roas: null,
    true_roas: null,
    reported_roas: null,
    cpa: null,
    cac: null,
    blended_cac: null,
    ltv: null,
    mer: null,
    net_sales: null,
    customers: 0,
    customer_source: 'none',
    offline_buyers: 0,
    waste_cents: 0,
    waste_channels: [],
    goals_vs_actuals: [],
    definition_version: DEFINITION_VERSION,
    provenance,
    generated_at: new Date().toISOString(),
  };

  if (!_db.hasDb() || !Number.isFinite(tid)) {
    provenance.push(_provenance('none', '*', 'database unavailable or no tenant'));
    out.kpis = [
      labelledValue('spend', 0, { confidence: 0, evidence: 'unavailable' }),
      labelledValue('reported_roas', null, { confidence: 0, evidence: 'unavailable' }),
      labelledValue('true_roas', null, { confidence: 0, evidence: 'unavailable' }),
      labelledValue('cpa', null, { confidence: 0, evidence: 'unavailable' }),
      labelledValue('cac', null, { confidence: 0, evidence: 'unavailable' }),
    ].map((k) => ({ ...k, delta_pct: null }));
    out.labelled = {
      spend: labelledValue('spend', 0, { confidence: 0, evidence: 'unavailable' }),
      reported_roas: labelledValue('reported_roas', null),
      true_roas: labelledValue('true_roas', null),
      cpa: labelledValue('cpa', null),
      cac: labelledValue('cac', null),
      blended_cac: labelledValue('blended_cac', null),
      ltv: labelledValue('ltv', null),
      mer: labelledValue('mer', null),
    };
    out.definitions = listDefinitions();
    out.deltas = {};
    return out;
  }

  const pool = _db.getPool();
  const interval = `${days} days`;

  // 1) Optimizer-ingested ad performance (spend + online revenue)
  try {
    const r = await pool.query(
      `SELECT lower(replace(c.platform, 'facebook', 'meta')) AS channel,
              COALESCE(SUM(p.spend),0)::float8 AS spend,
              COALESCE(SUM(p.revenue),0)::float8 AS revenue,
              COALESCE(SUM(p.impressions),0)::float8 AS impressions,
              COALESCE(SUM(p.clicks),0)::float8 AS clicks,
              COALESCE(SUM(p.conversions),0)::float8 AS conversions
         FROM ad_performance_hourly p
         JOIN ad_campaigns c ON c.id = p.campaign_id
        WHERE c.tenant_id = $1
          AND p.bucket_hour >= now() - ($2)::interval
        GROUP BY 1`,
      [tid, interval],
    );
    for (const row of r.rows) {
      const ch = row.channel || 'unknown';
      const spend = Number(row.spend || 0);
      const rev = Number(row.revenue || 0);
      out.spend += spend;
      out.online_revenue += rev;
      out.impressions += Number(row.impressions || 0);
      out.clicks += Number(row.clicks || 0);
      out.conversions += Number(row.conversions || 0);
      out.spend_by_channel[ch] = (out.spend_by_channel[ch] || 0) + spend;
      if (spend > 0 && rev / spend < 1) {
        const waste = Math.round((spend - rev) * 100);
        if (waste > 0) {
          out.waste_cents += waste;
          out.waste_channels.push({
            channel: ch,
            spend,
            revenue: rev,
            waste_cents: waste,
            roas: _round(rev / spend),
          });
        }
      }
    }
    provenance.push(_provenance('ad_performance_hourly', 'spend,online_revenue,impressions,clicks,conversions'));
  } catch (e) {
    provenance.push(_provenance('ad_performance_hourly', '*', `unavailable: ${e.message}`));
  }

  // 2) Manual / imported spend_events (Budget Board) — add channels not already covered
  try {
    const r = await pool.query(
      `SELECT lower(channel) AS channel,
              COALESCE(SUM(amount_cents),0)::bigint AS cents
         FROM spend_events
        WHERE tenant_id = $1
          AND occurred_at >= CURRENT_DATE - ($2::int)
        GROUP BY 1`,
      [tid, days],
    );
    let added = 0;
    for (const row of r.rows) {
      const ch = row.channel || 'other';
      const dollars = Number(row.cents || 0) / 100;
      // Prefer optimizer spend when both exist for the same channel; still
      // surface budget-board channels that have no ad_performance rows.
      if (!out.spend_by_channel[ch] || out.spend_by_channel[ch] === 0) {
        out.spend_by_channel[ch] = dollars;
        out.spend += dollars;
        added += dollars;
      }
    }
    if (added > 0) {
      provenance.push(_provenance('spend_events', 'spend_by_channel', `added $${_round(added)} for channels missing optimizer data`));
    } else {
      provenance.push(_provenance('spend_events', 'spend_by_channel', 'no additive spend (optimizer preferred)'));
    }
  } catch (e) {
    provenance.push(_provenance('spend_events', 'spend', `unavailable: ${e.message}`));
  }

  // 3) Offline conversions → true ROAS uplift
  try {
    const r = await pool.query(
      `SELECT COALESCE(SUM(revenue_cents),0)::bigint AS cents,
              COUNT(*)::int AS n
         FROM offline_conversions
        WHERE tenant_id = $1
          AND closed_at >= now() - ($2)::interval`,
      [tid, interval],
    );
    out.offline_revenue = Number(r.rows[0]?.cents || 0) / 100;
    out.offline_buyers = Number(r.rows[0]?.n || 0);
    provenance.push(_provenance('offline_conversions', 'offline_revenue', `${r.rows[0]?.n || 0} deals`));
  } catch (e) {
    provenance.push(_provenance('offline_conversions', 'offline_revenue', `unavailable: ${e.message}`));
  }

  out.spend_cents = Math.round(out.spend * 100);
  out.total_revenue = out.online_revenue + out.offline_revenue;
  out.customers = out.conversions;
  out.customer_source = out.conversions > 0 ? 'ad_performance' : 'none';

  out.reported_roas = out.spend > 0 && out.online_revenue > 0
    ? _round(out.online_revenue / out.spend) : null;
  out.true_roas = out.spend > 0 && out.total_revenue > 0
    ? _round(out.total_revenue / out.spend) : null;
  out.blended_roas = out.reported_roas;
  out.cpa = out.conversions > 0 ? _round(out.spend / out.conversions) : null;
  out.cac = out.customers > 0 ? _round(out.spend / out.customers) : null;
  const denomBuyers = Math.max(out.conversions, out.offline_buyers || 0);
  out.blended_cac = denomBuyers > 0 ? _round(out.spend / denomBuyers) : out.cac;
  if (out.offline_buyers > 0 && out.offline_revenue > 0) {
    out.ltv = _round(out.offline_revenue / out.offline_buyers);
  } else if (out.conversions > 0 && out.online_revenue > 0) {
    out.ltv = _round(out.online_revenue / out.conversions);
  } else {
    out.ltv = null;
  }
  out.mer = out.spend > 0 && out.total_revenue > 0
    ? _round((out.total_revenue / out.spend) * 100, 1) : null;
  out.net_sales = out.total_revenue > 0
    ? _round(out.total_revenue - out.spend) : null;

  provenance.push(_provenance('canonical_metrics', 'blended_roas,true_roas,cpa,cac,blended_cac,ltv,mer,net_sales', `defs ${DEFINITION_VERSION}`));

  // 4) Goals vs actuals — OKR key results + agent_goals progress
  try {
    const okr = await pool.query(
      `SELECT o.title AS objective, kr.title AS kr_title, kr.metric_type,
              kr.target_value, kr.current_value, kr.unit
         FROM okr_key_results kr
         JOIN okr_objectives o ON o.id = kr.objective_id
        WHERE o.tenant_id = $1
        ORDER BY o.created_at DESC
        LIMIT 20`,
      [tid],
    );
    for (const row of okr.rows) {
      const target = Number(row.target_value) || 0;
      const current = Number(row.current_value) || 0;
      const pct = target > 0 ? Math.min(200, Math.round((current / target) * 100)) : null;
      out.goals_vs_actuals.push({
        source: 'okr',
        label: `${row.objective} · ${row.kr_title}`,
        metric: row.metric_type,
        target,
        actual: current,
        unit: row.unit || '',
        pct,
        status: pct == null ? 'unknown' : pct >= 100 ? 'on-track' : pct >= 70 ? 'at-risk' : 'off-track',
      });
    }
    if (okr.rows.length) provenance.push(_provenance('okr_key_results', 'goals_vs_actuals'));
  } catch (e) {
    provenance.push(_provenance('okr_key_results', 'goals_vs_actuals', `unavailable: ${e.message}`));
  }

  try {
    const ag = await pool.query(
      `SELECT title, progress_pct, status, deadline
         FROM agent_goals
        WHERE tenant_id = $1 AND status NOT IN ('done','cancelled','archived')
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 15`,
      [tid],
    );
    for (const row of ag.rows) {
      const pct = row.progress_pct != null ? Number(row.progress_pct) : null;
      out.goals_vs_actuals.push({
        source: 'agent_goals',
        label: row.title,
        metric: 'progress_pct',
        target: 100,
        actual: pct,
        unit: '%',
        pct,
        status: pct == null ? 'unknown' : pct >= 80 ? 'on-track' : pct >= 50 ? 'at-risk' : 'off-track',
        deadline: row.deadline || null,
      });
    }
    if (ag.rows.length) provenance.push(_provenance('agent_goals', 'goals_vs_actuals'));
  } catch (e) {
    provenance.push(_provenance('agent_goals', 'goals_vs_actuals', `unavailable: ${e.message}`));
  }

  // 5) Prior-period comparison (same length window immediately before)
  out.prior = null;
  out.deltas = {};
  try {
    const priorStart = days * 2;
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(p.spend),0)::float8 AS spend,
         COALESCE(SUM(p.revenue),0)::float8 AS revenue,
         COALESCE(SUM(p.conversions),0)::float8 AS conversions
       FROM ad_performance_hourly p
       JOIN ad_campaigns c ON c.id = p.campaign_id
       WHERE c.tenant_id = $1
         AND p.bucket_hour >= now() - ($2 || ' days')::interval
         AND p.bucket_hour <  now() - ($3 || ' days')::interval`,
      [tid, String(priorStart), String(days)],
    );
    const priorSpend = Number(r.rows[0]?.spend || 0);
    const priorRev = Number(r.rows[0]?.revenue || 0);
    const priorConv = Number(r.rows[0]?.conversions || 0);
    let priorOffline = 0;
    try {
      const o = await pool.query(
        `SELECT COALESCE(SUM(revenue_cents),0)::bigint AS cents
           FROM offline_conversions
          WHERE tenant_id=$1
            AND closed_at >= now() - ($2 || ' days')::interval
            AND closed_at <  now() - ($3 || ' days')::interval`,
        [tid, String(priorStart), String(days)],
      );
      priorOffline = Number(o.rows[0]?.cents || 0) / 100;
    } catch (_) { /* optional */ }
    const priorTotalRev = priorRev + priorOffline;
    out.prior = {
      days,
      spend: _round(priorSpend) || 0,
      online_revenue: _round(priorRev) || 0,
      offline_revenue: _round(priorOffline) || 0,
      total_revenue: _round(priorTotalRev) || 0,
      conversions: priorConv,
      blended_roas: priorSpend > 0 && priorRev > 0 ? _round(priorRev / priorSpend) : null,
      true_roas: priorSpend > 0 && priorTotalRev > 0 ? _round(priorTotalRev / priorSpend) : null,
      cac: priorConv > 0 ? _round(priorSpend / priorConv) : null,
    };
    const deltaPct = (cur, prev) => {
      if (prev == null || prev === 0 || cur == null) return null;
      return _round(((cur - prev) / Math.abs(prev)) * 100, 1);
    };
    out.deltas = {
      spend_pct: deltaPct(out.spend, out.prior.spend),
      revenue_pct: deltaPct(out.total_revenue, out.prior.total_revenue),
      blended_roas_pct: deltaPct(out.blended_roas, out.prior.blended_roas),
      true_roas_pct: deltaPct(out.true_roas, out.prior.true_roas),
      cac_pct: deltaPct(out.cac, out.prior.cac),
      conversions_pct: deltaPct(out.conversions, out.prior.conversions),
    };
    provenance.push(_provenance('ad_performance_hourly', 'prior,deltas', `prior ${days}d window`));
  } catch (e) {
    provenance.push(_provenance('prior_period', '*', `unavailable: ${e.message}`));
  }

  // 6) Daily series for charts / pacing burn
  out.daily = [];
  try {
    const r = await pool.query(
      `SELECT to_char(p.bucket_hour,'YYYY-MM-DD') AS day,
              COALESCE(SUM(p.spend),0)::float8 AS spend,
              COALESCE(SUM(p.revenue),0)::float8 AS revenue
         FROM ad_performance_hourly p
         JOIN ad_campaigns c ON c.id = p.campaign_id
        WHERE c.tenant_id = $1
          AND p.bucket_hour >= now() - ($2)::interval
        GROUP BY 1 ORDER BY 1`,
      [tid, interval],
    );
    out.daily = r.rows.map((row) => ({
      day: row.day,
      spend: _round(row.spend) || 0,
      revenue: _round(row.revenue) || 0,
    }));
    if (out.daily.length) provenance.push(_provenance('ad_performance_hourly', 'daily'));
  } catch (_) { /* optional */ }

  // 7) Budget pacing (current calendar month) from spend_events + budgets
  out.pacing = null;
  try {
    const { computePacing, _ymNow } = require('./pacing');
    const period = _ymNow();
    const bRow = await pool.query(
      `SELECT target_cents, by_channel FROM budgets
        WHERE tenant_id=$1 AND period_month=$2
        ORDER BY created_at DESC LIMIT 1`,
      [tid, period],
    );
    const sRow = await pool.query(
      `SELECT channel, COALESCE(SUM(amount_cents),0)::bigint AS spent
         FROM spend_events
        WHERE tenant_id=$1 AND to_char(occurred_at,'YYYY-MM')=$2
        GROUP BY channel`,
      [tid, period],
    );
    const allocByCh = bRow.rows[0]?.by_channel || {};
    const spentByCh = {};
    let spent = 0;
    for (const row of sRow.rows) {
      spentByCh[row.channel] = Number(row.spent);
      spent += Number(row.spent);
    }
    // If budget-board spend is empty, fall back to optimizer spend this month
    if (spent === 0 && out.spend_cents > 0) {
      spent = Math.round((out.spend / Math.max(days, 1)) * new Date().getUTCDate() * 100);
    }
    const by_channel = Object.keys({ ...allocByCh, ...spentByCh }).map((ch) => ({
      channel: ch,
      allocated_cents: Number(allocByCh[ch] || 0),
      spent_cents: Number(spentByCh[ch] || 0),
      utilization: allocByCh[ch]
        ? Math.round((Number(spentByCh[ch] || 0) / Number(allocByCh[ch])) * 100)
        : null,
    }));
    out.pacing = computePacing({
      period_month: period,
      target_cents: Number(bRow.rows[0]?.target_cents || 0),
      spent_cents: spent,
      by_channel,
    });
    // Merge ROAS waste into pacing actions
    for (const w of (out.waste_channels || []).slice(0, 3)) {
      out.pacing.actions.push({
        priority: 'high',
        action: `Cut underwater ${w.channel}`,
        detail: `ROAS ${w.roas ?? 'n/a'} — ~$${(w.waste_cents / 100).toFixed(0)} waste in the last ${days}d.`,
      });
    }
    provenance.push(_provenance('budgets+spend_events', 'pacing'));
  } catch (e) {
    provenance.push(_provenance('pacing', '*', `unavailable: ${e.message}`));
  }

  // KPI dictionary for UI / report consumers — every value labelled measured|modelled|projected
  const _kpi = (key, value, delta_pct, extra = {}) => {
    const base = labelledValue(key, value, extra);
    return { ...base, delta_pct: delta_pct == null ? null : delta_pct };
  };
  out.kpis = [
    _kpi('spend', out.spend, out.deltas.spend_pct, { confidence: 0.95, evidence: 'ad_performance_hourly' }),
    _kpi('total_revenue', out.total_revenue, out.deltas.revenue_pct, {
      confidence: out.offline_revenue > 0 ? 0.7 : 0.85,
      evidence: 'online+offline',
    }),
    _kpi('reported_roas', out.reported_roas, out.deltas.blended_roas_pct, {
      confidence: 0.9,
      evidence: 'platform_attribution',
    }),
    _kpi('blended_roas', out.blended_roas, out.deltas.blended_roas_pct, {
      confidence: 0.9,
      evidence: 'platform_attribution',
    }),
    _kpi('true_roas', out.true_roas, out.deltas.true_roas_pct, {
      confidence: out.offline_revenue > 0 ? 0.7 : 0.5,
      evidence: 'online+offline',
    }),
    _kpi('cpa', out.cpa, null, { confidence: 0.85, evidence: 'ad_performance_hourly' }),
    _kpi('cac', out.cac, out.deltas.cac_pct, { confidence: 0.6, evidence: 'conversions_proxy' }),
    _kpi('blended_cac', out.blended_cac, null, {
      confidence: out.offline_buyers > 0 ? 0.65 : 0.55,
      evidence: out.offline_buyers > 0 ? 'offline_buyers' : 'conversions_proxy',
    }),
    _kpi('ltv', out.ltv, null, {
      confidence: out.offline_buyers > 0 ? 0.55 : 0.35,
      evidence: out.offline_buyers > 0 ? 'offline_aov' : 'online_aov_proxy',
    }),
    _kpi('conversions', out.conversions, out.deltas.conversions_pct, {
      confidence: 0.9,
      evidence: 'ad_performance_hourly',
    }),
    _kpi('mer', out.mer, null, { confidence: 0.65, evidence: 'total_revenue/spend' }),
    _kpi('waste', _round((out.waste_cents || 0) / 100), null, {
      confidence: 0.5,
      evidence: 'roas_lt_1_heuristic',
    }),
  ];
  out.labelled = {
    spend: labelledValue('spend', out.spend, { confidence: 0.95, evidence: 'canonical' }),
    reported_roas: labelledValue('reported_roas', out.reported_roas, { confidence: 0.9 }),
    true_roas: labelledValue('true_roas', out.true_roas, { confidence: out.offline_revenue > 0 ? 0.7 : 0.5 }),
    cpa: labelledValue('cpa', out.cpa),
    cac: labelledValue('cac', out.cac),
    blended_cac: labelledValue('blended_cac', out.blended_cac),
    ltv: labelledValue('ltv', out.ltv),
    mer: labelledValue('mer', out.mer),
  };
  out.definitions = listDefinitions();

  // Round money fields
  out.spend = _round(out.spend) || 0;
  out.online_revenue = _round(out.online_revenue) || 0;
  out.offline_revenue = _round(out.offline_revenue) || 0;
  out.total_revenue = _round(out.total_revenue) || 0;
  for (const k of Object.keys(out.spend_by_channel)) {
    out.spend_by_channel[k] = _round(out.spend_by_channel[k]) || 0;
  }

  return out;
}

/**
 * Map a named metric key onto the canonical snapshot (for Growth Ops / OKR).
 */
function readMetric(snapshot, metricKey) {
  if (!snapshot) return null;
  switch (metricKey) {
    case 'ads.totalSpend':
    case 'spend':
      return snapshot.spend;
    case 'ads.cac':
    case 'cac':
      return snapshot.cac;
    case 'ads.blendedCac':
    case 'blended_cac':
      return snapshot.blended_cac;
    case 'ads.cpa':
    case 'cpa':
      return snapshot.cpa;
    case 'ads.ltv':
    case 'ltv':
      return snapshot.ltv;
    case 'ads.blendedRoas':
    case 'blended_roas':
    case 'roas':
      return snapshot.blended_roas;
    case 'ads.trueRoas':
    case 'true_roas':
      return snapshot.true_roas;
    case 'reported_roas':
    case 'platform_roas':
      return snapshot.reported_roas;
    case 'ads.revenue':
    case 'revenue':
      return snapshot.total_revenue;
    case 'ads.mer':
    case 'mer':
      return snapshot.mer;
    case 'ads.conversions':
    case 'conversions':
      return snapshot.conversions;
    case 'ads.impressions':
    case 'impressions':
      return snapshot.impressions;
    case 'ads.clicks':
    case 'clicks':
      return snapshot.clicks;
    default:
      return null;
  }
}

module.exports = {
  computeCanonicalMetrics,
  readMetric,
  DEFINITION_VERSION,
};
