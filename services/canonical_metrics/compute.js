'use strict';
/**
 * Canonical metrics engine — single source of truth for spend, revenue,
 * blended ROAS, true ROAS, CAC, and pacing inputs. Consumers (OKR, Growth Ops
 * goals, Budget Board, Weekly Report, Anomaly Detector) should read from here
 * instead of re-deriving conflicting numbers.
 */

const _db = require('../../db');

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
    cac: null,
    mer: null,
    net_sales: null,
    customers: 0,
    customer_source: 'none',
    waste_cents: 0,
    waste_channels: [],
    goals_vs_actuals: [],
    provenance,
    generated_at: new Date().toISOString(),
  };

  if (!_db.hasDb() || !Number.isFinite(tid)) {
    provenance.push(_provenance('none', '*', 'database unavailable or no tenant'));
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
  out.cac = out.customers > 0 ? _round(out.spend / out.customers) : null;
  out.mer = out.spend > 0 && out.total_revenue > 0
    ? _round((out.total_revenue / out.spend) * 100, 1) : null;
  out.net_sales = out.total_revenue > 0
    ? _round(out.total_revenue - out.spend) : null;

  provenance.push(_provenance('canonical_metrics', 'blended_roas,true_roas,cac,mer,net_sales'));

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
    case 'ads.blendedRoas':
    case 'blended_roas':
    case 'roas':
      return snapshot.blended_roas;
    case 'ads.trueRoas':
    case 'true_roas':
      return snapshot.true_roas;
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
};
