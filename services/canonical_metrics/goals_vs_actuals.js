'use strict';

/**
 * PR10G.7 — Live goals vs actuals from an already-computed canonical snapshot.
 * Reuses snapshot metrics (no recursive compute). Preserves saved targets and
 * manual / channel-scoped measurements.
 */

const { AVAILABILITY } = require('./availability');
const {
  canonicalMetricMeta,
  safeAvailabilityReason,
} = require('./consumer');

function readMetricDetail(snapshot, metricKey) {
  // Lazy require avoids circular dependency with compute.js.
  return require('./compute').readMetricDetail(snapshot, metricKey);
}

/** OKR auto metrics resolvable from tenant-wide canonical snapshot (no channel). */
const CANONICAL_OKR_AUTO = new Set([
  'spend',
  'impressions',
  'clicks',
  'conversions',
  'leads',
  'roas',
  'true_roas',
  'blended_roas',
]);

const OKR_METRIC_TO_CANONICAL = {
  spend: 'spend',
  impressions: 'impressions',
  clicks: 'clicks',
  conversions: 'conversions',
  leads: 'conversions',
  roas: 'blended_roas',
  true_roas: 'true_roas',
  blended_roas: 'blended_roas',
};

/** Growth Ops goals that read from canonical snapshot (ads.* family). */
const GROWTH_CANONICAL_METRICS = {
  'ads.totalSpend': { key: 'spend', direction: 'lte', unit: '$' },
  'ads.cac': { key: 'cac', direction: 'lte', unit: '$' },
  'ads.blendedRoas': { key: 'blended_roas', direction: 'gte', unit: 'x' },
  'ads.trueRoas': { key: 'true_roas', direction: 'gte', unit: 'x' },
  'ads.revenue': { key: 'total_revenue', direction: 'gte', unit: '$' },
};

function isCanonicalAutoOkrKr(metricType, linkedChannel) {
  if (!metricType || metricType === 'manual') return false;
  if (linkedChannel) return false;
  return CANONICAL_OKR_AUTO.has(metricType);
}

function isUnverifiedCanonical(availability, recognized) {
  if (!recognized) return false;
  return !availability || availability === AVAILABILITY.UNAVAILABLE;
}

function _roundPct(current, target) {
  if (target == null || target <= 0 || current == null) return null;
  return Math.min(200, Math.round((current / target) * 100));
}

function _statusFromPctGte(pct) {
  if (pct == null) return 'unknown';
  if (pct >= 100) return 'on-track';
  if (pct >= 70) return 'at-risk';
  return 'off-track';
}

function _statusFromPctLte(current, target) {
  if (current == null || target == null) return 'unknown';
  if (current <= target) return 'on-track';
  if (current <= target * 1.2) return 'at-risk';
  return 'off-track';
}

function _pctLte(current, target) {
  if (current == null || target == null || target <= 0) return null;
  if (current <= 0) return 100;
  return Math.min(100, Math.round((target / current) * 100));
}

/**
 * Resolve live actual + availability from snapshot for a canonical key.
 */
function resolveLiveActual(snapshot, canonicalKey) {
  const detail = readMetricDetail(snapshot, canonicalKey);
  return {
    actual: detail.value,
    ...canonicalMetricMeta({ ...detail, from_canonical: true }),
    from_canonical: true,
  };
}

function buildOkrRow(row, snapshot) {
  const target = Number(row.target_value) || 0;
  const storedActual = row.current_value != null ? Number(row.current_value) : null;
  const linkedChannel = (row.linked_channel || '').trim();
  const recognized = isCanonicalAutoOkrKr(row.metric_type, linkedChannel);
  const unit = row.unit || '';

  let actual = storedActual;
  let metric_availability = null;
  let metric_availability_reason = null;
  let metric_is_proxy = false;
  let from_canonical = false;

  if (recognized) {
    const canonicalKey = OKR_METRIC_TO_CANONICAL[row.metric_type];
    const live = resolveLiveActual(snapshot, canonicalKey);
    actual = live.actual;
    metric_availability = live.metric_availability;
    metric_availability_reason = live.metric_availability_reason;
    metric_is_proxy = live.metric_is_proxy;
    from_canonical = true;
  } else if (row.metric_type !== 'manual' && linkedChannel) {
    // Channel-scoped auto KRs: preserve stored measurement; scope unsupported for canonical.
    actual = storedActual;
    from_canonical = false;
  }

  const meta = {
    metric_availability,
    metric_availability_reason,
    metric_is_proxy,
  };

  let pct = null;
  let status = 'unknown';

  if (recognized && isUnverifiedCanonical(metric_availability, true)) {
    actual = null;
    pct = null;
    status = 'unverified';
  } else if (recognized && metric_availability === AVAILABILITY.PARTIAL) {
    pct = _roundPct(actual, target);
    status = 'unverified';
  } else if (row.metric_type !== 'manual' && linkedChannel) {
    pct = _roundPct(actual, target);
    status = 'unverified';
  } else if (actual != null) {
    pct = _roundPct(actual, target);
    status = _statusFromPctGte(pct);
  }

  return {
    source: 'okr',
    label: `${row.objective} · ${row.kr_title}`,
    metric: row.metric_type,
    linked_channel: linkedChannel || null,
    target,
    actual,
    unit,
    pct,
    status,
    ...meta,
    from_canonical,
    stored_actual: storedActual,
  };
}

function buildAgentGoalRow(row) {
  const pct = row.progress_pct != null ? Number(row.progress_pct) : null;
  return {
    source: 'agent_goals',
    label: row.title,
    metric: 'progress_pct',
    target: 100,
    actual: pct,
    unit: '%',
    pct,
    status: pct == null ? 'unknown' : pct >= 80 ? 'on-track' : pct >= 50 ? 'at-risk' : 'off-track',
    deadline: row.deadline || null,
    from_canonical: false,
  };
}

function buildGrowthGoalRow(goal, snapshot) {
  const spec = GROWTH_CANONICAL_METRICS[goal.metric];
  if (!spec) return null;

  const target = Number(goal.target) || 0;
  const live = resolveLiveActual(snapshot, spec.key);
  const actual = live.actual;
  const metric_availability = live.metric_availability;
  const metric_availability_reason = live.metric_availability_reason;
  const metric_is_proxy = live.metric_is_proxy;

  let pct = null;
  let status = 'unknown';

  if (isUnverifiedCanonical(metric_availability, true)) {
    pct = null;
    status = 'unverified';
  } else if (metric_availability === AVAILABILITY.PARTIAL) {
    if (spec.direction === 'gte') {
      pct = _roundPct(actual, target);
    } else {
      pct = _pctLte(actual, target);
    }
    status = 'unverified';
  } else if (actual != null) {
    if (spec.direction === 'gte') {
      pct = _roundPct(actual, target);
      status = _statusFromPctGte(pct);
    } else {
      pct = _pctLte(actual, target);
      status = _statusFromPctLte(actual, target);
    }
  }

  return {
    source: 'growth_goals',
    label: goal.label || spec.key,
    metric: goal.metric,
    target,
    actual: isUnverifiedCanonical(metric_availability, true) ? null : actual,
    unit: spec.unit,
    pct,
    status,
    metric_availability,
    metric_availability_reason,
    metric_is_proxy,
    from_canonical: true,
  };
}

/**
 * Build goals_vs_actuals rows from DB/KV inputs and a finished canonical snapshot.
 */
function buildGoalsVsActuals(snapshot, { okrRows = [], agentGoalRows = [], growthGoals = [] } = {}) {
  const items = [];
  for (const row of okrRows) {
    items.push(buildOkrRow(row, snapshot));
  }
  for (const row of agentGoalRows) {
    items.push(buildAgentGoalRow(row));
  }
  for (const goal of growthGoals) {
    const built = buildGrowthGoalRow(goal, snapshot);
    if (built) items.push(built);
  }
  return items;
}

/** Whether a row counts as verified for on/off-track summaries (PR10G.3). */
function isVerifiedGoalRow(row) {
  if (!row) return false;
  if (row.status === 'unverified' || row.status === 'unknown') return false;
  if (row.metric_availability === AVAILABILITY.UNAVAILABLE) return false;
  if (row.metric_availability === AVAILABILITY.PARTIAL) return false;
  if (row.from_canonical && !row.metric_availability) return false;
  return true;
}

function formatGoalActualDisplay(row) {
  const unit = row.unit || '';
  const proxy = row.metric_is_proxy ? ' (proxy)' : '';
  const reason = safeAvailabilityReason(row.metric_availability_reason);

  if (row.status === 'unverified' || row.metric_availability === AVAILABILITY.UNAVAILABLE) {
    if (row.actual == null) return `unavailable (${reason})`;
  }
  if (row.metric_availability === AVAILABILITY.PARTIAL) {
    if (row.actual == null) return `partial (${reason})`;
  }

  if (row.actual == null) return '—';

  let base;
  const v = row.actual;
  if (unit === '$') base = `$${v}`;
  else if (unit === 'x') base = `${v}x`;
  else if (unit === '%') base = `${v}%`;
  else base = String(v);

  if (row.metric_availability === AVAILABILITY.PARTIAL) {
    return `${base}${proxy} · partial (${reason})`;
  }
  return base + proxy;
}

function formatGoalStatusDisplay(row) {
  if (row.status === 'unverified') {
    const suffix = row.pct != null ? ` (${row.pct}% partial)` : '';
    return `unverified${suffix}`;
  }
  const pct = row.pct != null ? ` (${row.pct}%)` : '';
  return `${row.status || 'unknown'}${pct}`;
}

module.exports = {
  buildGoalsVsActuals,
  buildOkrRow,
  buildAgentGoalRow,
  buildGrowthGoalRow,
  isCanonicalAutoOkrKr,
  isVerifiedGoalRow,
  formatGoalActualDisplay,
  formatGoalStatusDisplay,
  CANONICAL_OKR_AUTO,
  GROWTH_CANONICAL_METRICS,
};
