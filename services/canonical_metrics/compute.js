'use strict';
/**
 * Canonical metrics engine — single source of truth for spend, revenue,
 * blended ROAS, true ROAS, CAC, and pacing inputs. Consumers (OKR, Growth Ops
 * goals, Budget Board, Weekly Report, Anomaly Detector) should read from here
 * instead of re-deriving conflicting numbers.
 *
 * Availability (defs 2026.09.1): successful zero ≠ unavailable. Failed sources
 * and zero denominators return null with availability_reason — never fake zeros.
 */

const _db = require('../../db');
const { DEFINITION_VERSION, labelledValue, listDefinitions, resolveDefinition } = require('./definitions');
const {
  AVAILABILITY,
  REASON,
  ratio,
  sourceFailedReason,
} = require('./availability');

function _round(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** d;
  return Math.round(Number(n) * f) / f;
}

function _provenance(source, field, note) {
  return { source, field, note: note || null, at: new Date().toISOString() };
}

function _unavailableLabel(key, reason) {
  return labelledValue(key, null, {
    availability: AVAILABILITY.UNAVAILABLE,
    availability_reason: reason,
    evidence: 'unavailable',
  });
}

function _snapshotField(snapshot, metricKey) {
  const def = resolveDefinition(metricKey);
  const key = def?.key || metricKey;
  const map = {
    spend: snapshot.spend,
    online_revenue: snapshot.online_revenue,
    offline_revenue: snapshot.offline_revenue,
    total_revenue: snapshot.total_revenue,
    reported_roas: snapshot.reported_roas,
    blended_roas: snapshot.blended_roas,
    true_roas: snapshot.true_roas,
    cpa: snapshot.cpa,
    cac: snapshot.cac,
    blended_cac: snapshot.blended_cac,
    ltv: snapshot.ltv,
    mer: snapshot.mer,
    conversions: snapshot.conversions,
    impressions: snapshot.impressions,
    clicks: snapshot.clicks,
    waste: snapshot.waste_cents != null ? _round((snapshot.waste_cents || 0) / 100) : null,
  };
  return { key, value: map[key] ?? null };
}

/**
 * Apply derived economics + availability map onto the working snapshot.
 */
function _applyDerivedMetrics(out, sources) {
  const adOk = sources.ad_performance_hourly.ok;
  const spendEventsOk = sources.spend_events.ok;
  const offlineOk = sources.offline_conversions.ok;

  const spendAvail = adOk || spendEventsOk;
  const onlineAvail = adOk;
  const offlineAvail = offlineOk;
  const convAvail = adOk;

  out.spend = spendAvail ? _round(out._raw.spend) ?? 0 : null;
  out.online_revenue = onlineAvail ? _round(out._raw.online_revenue) ?? 0 : null;
  out.offline_revenue = offlineAvail ? _round(out._raw.offline_revenue) ?? 0 : null;
  out.impressions = convAvail ? out._raw.impressions : null;
  out.clicks = convAvail ? out._raw.clicks : null;
  out.conversions = convAvail ? out._raw.conversions : null;
  out.offline_buyers = offlineAvail ? out._raw.offline_buyers : null;
  out.waste_cents = adOk ? out._raw.waste_cents : 0;
  out.waste_channels = adOk ? out._raw.waste_channels : [];

  if (onlineAvail && offlineAvail) {
    out.total_revenue = _round((out.online_revenue || 0) + (out.offline_revenue || 0));
  } else if (onlineAvail && !offlineAvail) {
    out.total_revenue = out.online_revenue;
  } else {
    out.total_revenue = null;
  }

  out.spend_cents = out.spend != null ? Math.round(out.spend * 100) : null;
  out.customers = convAvail ? out._raw.conversions : null;
  out.customer_source = convAvail && out._raw.conversions > 0 ? 'ad_performance' : 'none';

  const roasRatio = ratio(out.online_revenue, out.spend, {
    numAvail: onlineAvail,
    denomAvail: spendAvail,
  });
  out.reported_roas = roasRatio.value;
  out.blended_roas = roasRatio.value;

  let trueRoasAvail = spendAvail && onlineAvail;
  let trueRoasPartial = false;
  let trueRoasReason = roasRatio.availability_reason;
  if (spendAvail && onlineAvail && !offlineAvail) {
    trueRoasPartial = true;
    trueRoasReason = REASON.OFFLINE_UNAVAILABLE;
  }
  if (!offlineAvail && !onlineAvail) trueRoasAvail = false;

  const trueNum = out.total_revenue;
  const trueRatio = ratio(trueNum, out.spend, {
    numAvail: onlineAvail && (offlineAvail || trueRoasPartial),
    denomAvail: spendAvail,
  });
  out.true_roas = trueRatio.value;

  const cpaRatio = ratio(out.spend, out.conversions, {
    numAvail: spendAvail,
    denomAvail: convAvail,
  });
  out.cpa = cpaRatio.value;

  const cacRatio = ratio(out.spend, out.customers, {
    numAvail: spendAvail,
    denomAvail: convAvail,
  });
  out.cac = cacRatio.value;

  const denomBuyers = convAvail && offlineAvail
    ? Math.max(out._raw.conversions, out._raw.offline_buyers || 0)
    : (convAvail ? out._raw.conversions : null);
  const blendedCacRatio = ratio(out.spend, denomBuyers, {
    numAvail: spendAvail,
    denomAvail: convAvail || offlineAvail,
  });
  out.blended_cac = blendedCacRatio.value ?? out.cac;

  let ltvValue = null;
  let ltvProxy = false;
  let ltvAvail = AVAILABILITY.UNAVAILABLE;
  let ltvReason = REASON.ZERO_DENOMINATOR;
  if (offlineAvail && out._raw.offline_buyers > 0 && out._raw.offline_revenue > 0) {
    ltvValue = _round(out._raw.offline_revenue / out._raw.offline_buyers);
    ltvProxy = false;
    ltvAvail = AVAILABILITY.AVAILABLE;
    ltvReason = null;
  } else if (convAvail && onlineAvail) {
    const ltvRatio = ratio(out.online_revenue, out.conversions, {
      numAvail: true,
      denomAvail: true,
    });
    ltvValue = ltvRatio.value;
    ltvProxy = true;
    ltvAvail = ltvRatio.availability;
    ltvReason = ltvRatio.availability_reason;
  }
  out.ltv = ltvValue;
  out._ltvMeta = { availability: ltvAvail, availability_reason: ltvReason, is_proxy: ltvProxy };

  const merBase = ratio(out.total_revenue, out.spend, {
    numAvail: out.total_revenue != null,
    denomAvail: spendAvail,
  });
  out.mer = merBase.value != null ? _round(merBase.value * 100, 1) : null;
  const merRatio = {
    availability: merBase.availability,
    availability_reason: merBase.availability_reason,
  };

  if (out.total_revenue != null && out.spend != null) {
    out.net_sales = _round(out.total_revenue - out.spend);
  } else {
    out.net_sales = null;
  }

  out.availability = {
    spend: spendAvail ? { status: AVAILABILITY.AVAILABLE, reason: null } : {
      status: AVAILABILITY.UNAVAILABLE,
      reason: !adOk && !spendEventsOk ? sourceFailedReason('spend') : REASON.INPUT_UNAVAILABLE,
    },
    online_revenue: onlineAvail ? { status: AVAILABILITY.AVAILABLE, reason: null } : {
      status: AVAILABILITY.UNAVAILABLE,
      reason: adOk ? null : sourceFailedReason('ad_performance_hourly'),
    },
    offline_revenue: offlineAvail ? { status: AVAILABILITY.AVAILABLE, reason: null } : {
      status: AVAILABILITY.UNAVAILABLE,
      reason: sourceFailedReason('offline_conversions'),
    },
    total_revenue: out.total_revenue != null ? {
      status: offlineAvail ? AVAILABILITY.AVAILABLE : AVAILABILITY.PARTIAL,
      reason: offlineAvail ? null : REASON.OFFLINE_UNAVAILABLE,
    } : { status: AVAILABILITY.UNAVAILABLE, reason: REASON.INPUT_UNAVAILABLE },
    reported_roas: {
      status: roasRatio.availability,
      reason: roasRatio.availability_reason,
    },
    blended_roas: {
      status: roasRatio.availability,
      reason: roasRatio.availability_reason,
    },
    true_roas: {
      status: trueRoasPartial ? AVAILABILITY.PARTIAL : trueRatio.availability,
      reason: trueRoasPartial ? trueRoasReason : trueRatio.availability_reason,
    },
    cpa: { status: cpaRatio.availability, reason: cpaRatio.availability_reason },
    cac: { status: cacRatio.availability, reason: cacRatio.availability_reason },
    blended_cac: { status: blendedCacRatio.availability, reason: blendedCacRatio.availability_reason },
    ltv: { status: ltvAvail, reason: ltvReason },
    mer: { status: merRatio.availability, reason: merRatio.availability_reason },
    conversions: convAvail ? { status: AVAILABILITY.AVAILABLE, reason: null } : {
      status: AVAILABILITY.UNAVAILABLE,
      reason: sourceFailedReason('ad_performance_hourly'),
    },
  };

  for (const k of Object.keys(out._raw.spend_by_channel)) {
    out.spend_by_channel[k] = spendAvail ? _round(out._raw.spend_by_channel[k]) ?? 0 : null;
  }
}

function _buildKpisAndLabelled(out) {
  const avail = (key) => out.availability?.[key] || { status: AVAILABILITY.AVAILABLE, reason: null };
  const _kpi = (key, value, delta_pct, extra = {}) => {
    const a = avail(key);
    const base = labelledValue(key, value, {
      ...extra,
      availability: a.status,
      availability_reason: a.reason,
    });
    return { ...base, delta_pct: delta_pct == null ? null : delta_pct };
  };

  const spendA = avail('spend');
  const roasA = avail('reported_roas');
  const trueA = avail('true_roas');
  const cacA = avail('cac');
  const ltvMeta = out._ltvMeta || {};

  out.kpis = [
    _kpi('spend', out.spend, out.deltas?.spend_pct, {
      confidence: spendA.status === AVAILABILITY.AVAILABLE ? 0.95 : null,
      evidence: 'ad_performance_hourly+spend_events',
    }),
    _kpi('total_revenue', out.total_revenue, out.deltas?.revenue_pct, {
      confidence: avail('total_revenue').status === AVAILABILITY.PARTIAL ? 0.65 : (
        out.total_revenue != null ? (out.offline_revenue > 0 ? 0.7 : 0.85) : null
      ),
      evidence: avail('total_revenue').status === AVAILABILITY.PARTIAL ? 'online_only' : 'online+offline',
    }),
    _kpi('reported_roas', out.reported_roas, out.deltas?.blended_roas_pct, {
      confidence: roasA.status === AVAILABILITY.AVAILABLE ? 0.9 : null,
      evidence: 'platform_attribution',
    }),
    _kpi('blended_roas', out.blended_roas, out.deltas?.blended_roas_pct, {
      confidence: roasA.status === AVAILABILITY.AVAILABLE ? 0.9 : null,
      evidence: 'platform_attribution',
    }),
    _kpi('true_roas', out.true_roas, out.deltas?.true_roas_pct, {
      confidence: trueA.status === AVAILABILITY.AVAILABLE ? 0.7 : (
        trueA.status === AVAILABILITY.PARTIAL ? 0.55 : null
      ),
      evidence: trueA.status === AVAILABILITY.PARTIAL ? 'online_only' : 'online+offline',
    }),
    _kpi('cpa', out.cpa, null, {
      confidence: avail('cpa').status === AVAILABILITY.AVAILABLE ? 0.85 : null,
      evidence: 'ad_performance_hourly',
    }),
    _kpi('cac', out.cac, out.deltas?.cac_pct, {
      confidence: cacA.status === AVAILABILITY.AVAILABLE ? 0.45 : null,
      evidence: 'conversions_proxy',
      is_proxy: true,
    }),
    _kpi('blended_cac', out.blended_cac, null, {
      confidence: avail('blended_cac').status === AVAILABILITY.AVAILABLE ? 0.5 : null,
      evidence: out.offline_buyers > 0 ? 'offline_buyers' : 'conversions_proxy',
      is_proxy: !(out.offline_buyers > 0),
    }),
    _kpi('ltv', out.ltv, null, {
      confidence: ltvMeta.availability === AVAILABILITY.AVAILABLE
        ? (ltvMeta.is_proxy ? 0.35 : 0.55) : null,
      evidence: ltvMeta.is_proxy ? 'online_aov_proxy' : 'offline_aov',
      is_proxy: ltvMeta.is_proxy,
      availability: ltvMeta.availability,
      availability_reason: ltvMeta.availability_reason,
    }),
    _kpi('conversions', out.conversions, out.deltas?.conversions_pct, {
      confidence: avail('conversions').status === AVAILABILITY.AVAILABLE ? 0.9 : null,
      evidence: 'ad_performance_hourly',
    }),
    _kpi('mer', out.mer, null, {
      confidence: avail('mer').status === AVAILABILITY.AVAILABLE ? 0.65 : null,
      evidence: 'total_revenue/spend',
    }),
    _kpi('waste', out.waste_cents != null ? _round(out.waste_cents / 100) : null, null, {
      confidence: avail('spend').status === AVAILABILITY.AVAILABLE ? 0.5 : null,
      evidence: 'roas_lt_1_heuristic',
    }),
  ];

  out.labelled = {
    spend: labelledValue('spend', out.spend, {
      confidence: spendA.status === AVAILABILITY.AVAILABLE ? 0.95 : null,
      availability: spendA.status,
      availability_reason: spendA.reason,
    }),
    reported_roas: labelledValue('reported_roas', out.reported_roas, {
      confidence: roasA.status === AVAILABILITY.AVAILABLE ? 0.9 : null,
      availability: roasA.status,
      availability_reason: roasA.reason,
    }),
    true_roas: labelledValue('true_roas', out.true_roas, {
      confidence: trueA.status === AVAILABILITY.AVAILABLE ? 0.7 : (
        trueA.status === AVAILABILITY.PARTIAL ? 0.55 : null
      ),
      availability: trueA.status,
      availability_reason: trueA.reason,
    }),
    cpa: labelledValue('cpa', out.cpa, {
      availability: avail('cpa').status,
      availability_reason: avail('cpa').reason,
    }),
    cac: labelledValue('cac', out.cac, {
      availability: cacA.status,
      availability_reason: cacA.reason,
      is_proxy: true,
    }),
    blended_cac: labelledValue('blended_cac', out.blended_cac, {
      availability: avail('blended_cac').status,
      availability_reason: avail('blended_cac').reason,
      is_proxy: !(out.offline_buyers > 0),
    }),
    ltv: labelledValue('ltv', out.ltv, {
      availability: ltvMeta.availability,
      availability_reason: ltvMeta.availability_reason,
      is_proxy: ltvMeta.is_proxy,
    }),
    mer: labelledValue('mer', out.mer, {
      availability: avail('mer').status,
      availability_reason: avail('mer').reason,
    }),
  };
}

function _unavailableSnapshot(out, reason) {
  const keys = ['spend', 'reported_roas', 'true_roas', 'cpa', 'cac', 'blended_cac', 'ltv', 'mer'];
  out.availability = {};
  for (const k of keys) {
    out.availability[k] = { status: AVAILABILITY.UNAVAILABLE, reason };
  }
  out.kpis = keys.slice(0, 5).map((k) => ({
    ..._unavailableLabel(k, reason),
    delta_pct: null,
  }));
  out.labelled = {
    spend: _unavailableLabel('spend', reason),
    reported_roas: _unavailableLabel('reported_roas', reason),
    true_roas: _unavailableLabel('true_roas', reason),
    cpa: _unavailableLabel('cpa', reason),
    cac: _unavailableLabel('cac', reason),
    blended_cac: _unavailableLabel('blended_cac', reason),
    ltv: _unavailableLabel('ltv', reason),
    mer: _unavailableLabel('mer', reason),
  };
  out.definitions = listDefinitions();
  out.deltas = {};
  out.spend = null;
  out.spend_cents = null;
  out.online_revenue = null;
  out.offline_revenue = null;
  out.total_revenue = null;
  out.conversions = null;
  out.impressions = null;
  out.clicks = null;
  delete out._raw;
  delete out._ltvMeta;
  return out;
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
  const sources = {
    ad_performance_hourly: { ok: false },
    spend_events: { ok: false },
    offline_conversions: { ok: false },
  };

  const out = {
    ok: true,
    days,
    tenant_id: tid,
    spend: null,
    spend_cents: null,
    spend_by_channel: {},
    online_revenue: null,
    offline_revenue: null,
    total_revenue: null,
    impressions: null,
    clicks: null,
    conversions: null,
    blended_roas: null,
    true_roas: null,
    reported_roas: null,
    cpa: null,
    cac: null,
    blended_cac: null,
    ltv: null,
    mer: null,
    net_sales: null,
    customers: null,
    customer_source: 'none',
    offline_buyers: null,
    waste_cents: 0,
    waste_channels: [],
    goals_vs_actuals: [],
    definition_version: DEFINITION_VERSION,
    provenance,
    generated_at: new Date().toISOString(),
    _raw: {
      spend: 0,
      online_revenue: 0,
      offline_revenue: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      offline_buyers: 0,
      waste_cents: 0,
      waste_channels: [],
      spend_by_channel: {},
    },
  };

  if (!_db.hasDb() || !Number.isFinite(tid)) {
    provenance.push(_provenance('none', '*', 'database unavailable or no tenant'));
    return _unavailableSnapshot(out, REASON.DATABASE_UNAVAILABLE);
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
    sources.ad_performance_hourly.ok = true;
    for (const row of r.rows) {
      const ch = row.channel || 'unknown';
      const spend = Number(row.spend || 0);
      const rev = Number(row.revenue || 0);
      out._raw.spend += spend;
      out._raw.online_revenue += rev;
      out._raw.impressions += Number(row.impressions || 0);
      out._raw.clicks += Number(row.clicks || 0);
      out._raw.conversions += Number(row.conversions || 0);
      out._raw.spend_by_channel[ch] = (out._raw.spend_by_channel[ch] || 0) + spend;
      if (spend > 0 && rev / spend < 1) {
        const waste = Math.round((spend - rev) * 100);
        if (waste > 0) {
          out._raw.waste_cents += waste;
          out._raw.waste_channels.push({
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

  // 2) Manual / imported spend_events (Budget Board)
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
    sources.spend_events.ok = true;
    let added = 0;
    for (const row of r.rows) {
      const ch = row.channel || 'other';
      const dollars = Number(row.cents || 0) / 100;
      if (!out._raw.spend_by_channel[ch] || out._raw.spend_by_channel[ch] === 0) {
        out._raw.spend_by_channel[ch] = dollars;
        out._raw.spend += dollars;
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

  // 3) Offline conversions
  try {
    const r = await pool.query(
      `SELECT COALESCE(SUM(revenue_cents),0)::bigint AS cents,
              COUNT(*)::int AS n
         FROM offline_conversions
        WHERE tenant_id = $1
          AND closed_at >= now() - ($2)::interval`,
      [tid, interval],
    );
    sources.offline_conversions.ok = true;
    out._raw.offline_revenue = Number(r.rows[0]?.cents || 0) / 100;
    out._raw.offline_buyers = Number(r.rows[0]?.n || 0);
    provenance.push(_provenance('offline_conversions', 'offline_revenue', `${r.rows[0]?.n || 0} deals`));
  } catch (e) {
    provenance.push(_provenance('offline_conversions', 'offline_revenue', `unavailable: ${e.message}`));
  }

  out.spend_by_channel = { ...out._raw.spend_by_channel };
  _applyDerivedMetrics(out, sources);
  provenance.push(_provenance('canonical_metrics', 'availability+derived', `defs ${DEFINITION_VERSION}`));

  // 4) Goals vs actuals
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

  // 5) Prior-period comparison
  out.prior = null;
  out.deltas = {};
  if (sources.ad_performance_hourly.ok) {
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
      if (sources.offline_conversions.ok) {
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
      }
      const priorTotalRev = priorRev + priorOffline;
      const priorRoas = priorSpend > 0 ? _round(priorRev / priorSpend) : null;
      out.prior = {
        days,
        spend: _round(priorSpend) ?? 0,
        online_revenue: _round(priorRev) ?? 0,
        offline_revenue: _round(priorOffline) ?? 0,
        total_revenue: _round(priorTotalRev) ?? 0,
        conversions: priorConv,
        blended_roas: priorRoas,
        true_roas: priorSpend > 0 ? _round(priorTotalRev / priorSpend) : null,
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
  }

  // 6) Daily series
  out.daily = [];
  if (sources.ad_performance_hourly.ok) {
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
  }

  // 7) Budget pacing
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
    if (spent === 0 && out.spend_cents != null && out.spend_cents > 0) {
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

  _buildKpisAndLabelled(out);
  out.definitions = listDefinitions();
  out.sources = sources;
  delete out._raw;
  delete out._ltvMeta;

  return out;
}

/**
 * Map a named metric key onto the canonical snapshot value (null when unavailable).
 */
function readMetric(snapshot, metricKey) {
  if (!snapshot) return null;
  const { value } = _snapshotField(snapshot, metricKey);
  const def = resolveDefinition(metricKey);
  const key = def?.key;
  if (key && snapshot.availability?.[key]?.status === AVAILABILITY.UNAVAILABLE) {
    return null;
  }
  return value;
}

/**
 * Read metric with availability metadata for API consumers.
 */
function readMetricDetail(snapshot, metricKey) {
  if (!snapshot) {
    return {
      value: null,
      availability: AVAILABILITY.UNAVAILABLE,
      availability_reason: REASON.DATABASE_UNAVAILABLE,
      is_proxy: false,
    };
  }
  const { key, value } = _snapshotField(snapshot, metricKey);
  const labelled = snapshot.labelled?.[key];
  const avail = snapshot.availability?.[key];
  return {
    value,
    availability: labelled?.availability || avail?.status || (value != null ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE),
    availability_reason: labelled?.availability_reason || avail?.reason || null,
    is_proxy: labelled?.is_proxy ?? false,
    kind: resolveDefinition(metricKey)?.kind || null,
  };
}

module.exports = {
  computeCanonicalMetrics,
  readMetric,
  readMetricDetail,
  DEFINITION_VERSION,
};
