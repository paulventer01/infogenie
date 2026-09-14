'use strict';

/**
 * PR10G.7 — Live goals vs actuals from an already-computed canonical snapshot.
 * Reuses snapshot metrics (no recursive compute). Preserves saved targets,
 * manual / channel-scoped measurements, explicit completion, and period scope.
 */

const { AVAILABILITY, REASON } = require('./availability');
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

const DEFAULT_GROWTH_PERIOD_DAYS = 30;
const MS_PER_DAY = 86400000;

function quarterBounds(quarter) {
  const m = String(quarter || '').match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const q = parseInt(m[2], 10);
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { start, end, quarter };
}

function okrMeasurementPeriod(quarter) {
  const bounds = quarterBounds(quarter);
  if (!bounds) return null;
  const startMs = Date.UTC(
    parseInt(bounds.start.slice(0, 4), 10),
    parseInt(bounds.start.slice(5, 7), 10) - 1,
    parseInt(bounds.start.slice(8, 10), 10),
  );
  const endMs = Date.UTC(
    parseInt(bounds.end.slice(0, 4), 10),
    parseInt(bounds.end.slice(5, 7), 10) - 1,
    parseInt(bounds.end.slice(8, 10), 10),
  );
  const days = Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
  return { kind: 'quarter', quarter: bounds.quarter, days, start: bounds.start, end: bounds.end };
}

function growthMeasurementPeriod(goal) {
  const raw = goal?.periodDays ?? goal?.period_days ?? goal?.days;
  const days = Math.min(90, Math.max(1, parseInt(raw, 10) || DEFAULT_GROWTH_PERIOD_DAYS));
  return { kind: 'rolling_days', days };
}

/** Rolling snapshots cannot prove calendar-quarter coverage until compute stamps authoritative bounds. */
function hasAuthoritativeQuarterSnapshot(snapshot, goalPeriod) {
  return Boolean(
    snapshot
    && goalPeriod
    && snapshot.period_authoritative === true
    && snapshot.period_kind === 'quarter'
    && snapshot.period_quarter === goalPeriod.quarter
    && snapshot.period_start === goalPeriod.start
    && snapshot.period_end === goalPeriod.end,
  );
}

function snapshotMatchesGoalPeriod(snapshot, goalPeriod) {
  if (!snapshot || !goalPeriod) return false;
  if (goalPeriod.kind === 'rolling_days') {
    return Number(snapshot.days) === goalPeriod.days;
  }
  if (goalPeriod.kind === 'quarter') {
    return hasAuthoritativeQuarterSnapshot(snapshot, goalPeriod);
  }
  return false;
}

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

function _unverifiedRow(base, reason, extra = {}) {
  return {
    ...base,
    status: 'unverified',
    period_mismatch: reason === 'period_mismatch',
    unverified_reason: reason,
    ...extra,
  };
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
  const unit = row.unit || '';
  const objectiveStatus = row.objective_status || null;
  const goalPeriod = okrMeasurementPeriod(row.quarter);
  const periodMatches = snapshotMatchesGoalPeriod(snapshot, goalPeriod);

  const base = {
    source: 'okr',
    label: `${row.objective} · ${row.kr_title}`,
    metric: row.metric_type,
    linked_channel: linkedChannel || null,
    target,
    unit,
    objective_status: objectiveStatus,
    measurement_period: goalPeriod,
    snapshot_days: snapshot?.days ?? null,
    stored_actual: storedActual,
  };

  if (objectiveStatus === 'complete') {
    const pct = _roundPct(storedActual, target);
    return {
      ...base,
      actual: storedActual,
      pct,
      status: 'complete',
      measurement_source: row.metric_type === 'manual' ? 'manual' : 'stored',
      from_canonical: false,
      metric_availability: null,
      metric_availability_reason: null,
      metric_is_proxy: false,
    };
  }

  if (row.metric_type === 'manual') {
    const pct = _roundPct(storedActual, target);
    return {
      ...base,
      actual: storedActual,
      pct,
      status: pct == null ? 'unknown' : _statusFromPctGte(pct),
      measurement_source: 'manual',
      from_canonical: false,
      metric_availability: null,
      metric_availability_reason: null,
      metric_is_proxy: false,
    };
  }

  if (linkedChannel) {
    const pct = _roundPct(storedActual, target);
    return _unverifiedRow({
      ...base,
      actual: storedActual,
      pct,
      measurement_source: 'stored',
      from_canonical: false,
      metric_availability: null,
      metric_availability_reason: 'channel_stored',
      metric_is_proxy: false,
    }, 'unsupported_scope');
  }

  const recognized = isCanonicalAutoOkrKr(row.metric_type, linkedChannel);
  if (!recognized || !periodMatches) {
    return _unverifiedRow({
      ...base,
      actual: null,
      pct: null,
      measurement_source: recognized ? 'canonical' : 'stored',
      from_canonical: recognized,
      metric_availability: recognized ? AVAILABILITY.UNAVAILABLE : null,
      metric_availability_reason: recognized ? 'period_mismatch' : null,
      metric_is_proxy: false,
    }, 'period_mismatch');
  }

  const canonicalKey = OKR_METRIC_TO_CANONICAL[row.metric_type];
  const live = resolveLiveActual(snapshot, canonicalKey);
  let actual = live.actual;
  const metric_availability = live.metric_availability;
  const metric_availability_reason = live.metric_availability_reason;
  const metric_is_proxy = live.metric_is_proxy;

  if (isUnverifiedCanonical(metric_availability, true)) {
    return _unverifiedRow({
      ...base,
      actual: null,
      pct: null,
      measurement_source: 'canonical',
      from_canonical: true,
      metric_availability,
      metric_availability_reason,
      metric_is_proxy,
    }, 'canonical_unavailable');
  }

  if (metric_availability === AVAILABILITY.PARTIAL) {
    const pct = _roundPct(actual, target);
    return _unverifiedRow({
      ...base,
      actual,
      pct,
      measurement_source: 'canonical',
      from_canonical: true,
      metric_availability,
      metric_availability_reason,
      metric_is_proxy,
    }, 'canonical_partial');
  }

  const pct = _roundPct(actual, target);
  return {
    ...base,
    actual,
    pct,
    status: _statusFromPctGte(pct),
    measurement_source: 'canonical',
    from_canonical: true,
    metric_availability,
    metric_availability_reason,
    metric_is_proxy,
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
    measurement_source: 'stored',
  };
}

function buildGrowthGoalRow(goal, snapshot) {
  const spec = GROWTH_CANONICAL_METRICS[goal.metric];
  if (!spec) return null;

  const target = Number(goal.target) || 0;
  const goalPeriod = growthMeasurementPeriod(goal);
  const periodMatches = snapshotMatchesGoalPeriod(snapshot, goalPeriod);

  const base = {
    source: 'growth_goals',
    label: goal.label || spec.key,
    metric: goal.metric,
    target,
    unit: spec.unit,
    measurement_period: goalPeriod,
    snapshot_days: snapshot?.days ?? null,
  };

  if (!periodMatches) {
    return _unverifiedRow({
      ...base,
      actual: null,
      pct: null,
      measurement_source: 'canonical',
      from_canonical: true,
      metric_availability: AVAILABILITY.UNAVAILABLE,
      metric_availability_reason: 'period_mismatch',
      metric_is_proxy: false,
    }, 'period_mismatch');
  }

  const live = resolveLiveActual(snapshot, spec.key);
  const actual = live.actual;
  const metric_availability = live.metric_availability;
  const metric_availability_reason = live.metric_availability_reason;
  const metric_is_proxy = live.metric_is_proxy;

  if (isUnverifiedCanonical(metric_availability, true)) {
    return _unverifiedRow({
      ...base,
      actual: null,
      pct: null,
      measurement_source: 'canonical',
      from_canonical: true,
      metric_availability,
      metric_availability_reason,
      metric_is_proxy,
    }, 'canonical_unavailable');
  }

  if (metric_availability === AVAILABILITY.PARTIAL) {
    const pct = spec.direction === 'gte' ? _roundPct(actual, target) : _pctLte(actual, target);
    return _unverifiedRow({
      ...base,
      actual,
      pct,
      measurement_source: 'canonical',
      from_canonical: true,
      metric_availability,
      metric_availability_reason,
      metric_is_proxy,
    }, 'canonical_partial');
  }

  let pct = null;
  let status = 'unknown';
  if (actual != null) {
    if (spec.direction === 'gte') {
      pct = _roundPct(actual, target);
      status = _statusFromPctGte(pct);
    } else {
      pct = _pctLte(actual, target);
      status = _statusFromPctLte(actual, target);
    }
  }

  return {
    ...base,
    actual,
    pct,
    status,
    measurement_source: 'canonical',
    from_canonical: true,
    metric_availability,
    metric_availability_reason,
    metric_is_proxy,
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
  if (row.status === 'complete') return false;
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

  if (row.measurement_source === 'stored' && row.actual != null) {
    let base;
    const v = row.actual;
    if (unit === '$') base = `$${v}`;
    else if (unit === 'x') base = `${v}x`;
    else if (unit === '%') base = `${v}%`;
    else base = String(v);
    return `${base} (stored)`;
  }

  if (row.status === 'complete' && row.actual != null) {
    let base;
    const v = row.actual;
    if (unit === '$') base = `$${v}`;
    else if (unit === 'x') base = `${v}x`;
    else if (unit === '%') base = `${v}%`;
    else base = String(v);
    return base;
  }

  if (row.metric_availability === AVAILABILITY.UNAVAILABLE && row.actual == null) {
    if (row.unverified_reason === 'period_mismatch') return 'unverified (period mismatch)';
    return `unavailable (${reason})`;
  }

  if (row.metric_availability === AVAILABILITY.PARTIAL && row.actual == null) {
    return `partial (${reason})`;
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
  if (row.status === 'complete') return 'complete';
  if (row.status === 'unverified') {
    if (row.unverified_reason === 'period_mismatch') return 'unverified (period mismatch)';
    if (row.measurement_source === 'stored') {
      const pct = row.pct != null ? ` (${row.pct}%)` : '';
      return `unverified (stored)${pct}`;
    }
    if (row.metric_availability === AVAILABILITY.PARTIAL && row.pct != null) {
      return `unverified (${row.pct}% partial)`;
    }
    return 'unverified';
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
  snapshotMatchesGoalPeriod,
  hasAuthoritativeQuarterSnapshot,
  okrMeasurementPeriod,
  growthMeasurementPeriod,
  quarterBounds,
  CANONICAL_OKR_AUTO,
  GROWTH_CANONICAL_METRICS,
  DEFAULT_GROWTH_PERIOD_DAYS,
};
