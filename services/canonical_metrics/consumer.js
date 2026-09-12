'use strict';

/**
 * PR10G.2 — helpers for canonical-metric consumers.
 * Preserve availability, reasons, and proxy labels from PR10G.1 snapshots.
 */

const { AVAILABILITY, REASON } = require('./availability');
const { readMetricDetail } = require('./compute');

const CANONICAL_AD_METRICS = new Set([
  'ads.totalSpend',
  'ads.cac',
  'ads.blendedRoas',
  'ads.trueRoas',
  'ads.revenue',
  'spend',
  'cac',
  'blended_roas',
  'true_roas',
  'roas',
  'reported_roas',
  'online_revenue',
  'total_revenue',
]);

const SAFE_REASON_VALUES = new Set(Object.values(REASON));
const SAFE_REASON_PREFIXES = [
  `${REASON.INPUT_UNAVAILABLE}:`,
  `${REASON.SOURCE_QUERY_FAILED}:`,
];

function safeAvailabilityReason(reason) {
  if (!reason) return 'unavailable';
  if (SAFE_REASON_VALUES.has(reason)) return reason;
  for (const prefix of SAFE_REASON_PREFIXES) {
    if (String(reason).startsWith(prefix)) return reason;
  }
  if (/error|exception|ECONN|relation|syntax|password|pg_/i.test(String(reason))) {
    return REASON.SOURCE_QUERY_FAILED;
  }
  return String(reason).replace(/_/g, ' ').slice(0, 80);
}

function labelledAvailability(snapshot, canonicalKey) {
  if (!snapshot) {
    return { status: AVAILABILITY.UNAVAILABLE, reason: REASON.DATABASE_UNAVAILABLE };
  }
  const labelled = snapshot.labelled?.[canonicalKey];
  const avail = snapshot.availability?.[canonicalKey];
  return {
    status: labelled?.availability || avail?.status || AVAILABILITY.UNAVAILABLE,
    reason: labelled?.availability_reason || avail?.reason || null,
    is_proxy: labelled?.is_proxy ?? false,
  };
}

function isUsableForRecommendations(availability) {
  return availability === AVAILABILITY.AVAILABLE;
}

function isCanonicalAdMetric(metricKey) {
  return CANONICAL_AD_METRICS.has(metricKey);
}

/**
 * Resolve a consumer-facing metric from a canonical snapshot.
 * Returns null value with availability when unavailable; preserves valid zero.
 */
function resolveConsumerMetric(snapshot, metricKey) {
  const detail = readMetricDetail(snapshot, metricKey);
  return {
    value: detail.value,
    availability: detail.availability,
    availability_reason: safeAvailabilityReason(detail.availability_reason),
    is_proxy: detail.is_proxy,
    kind: detail.kind,
    from_canonical: true,
  };
}

/** Controlled unavailable result when canonical compute/read throws. */
function unavailableConsumerMetric(reason = REASON.SOURCE_QUERY_FAILED) {
  return {
    value: null,
    availability: AVAILABILITY.UNAVAILABLE,
    availability_reason: safeAvailabilityReason(reason),
    is_proxy: false,
    kind: null,
    from_canonical: true,
  };
}

function canonicalMetricMeta(detail = {}) {
  if (!detail.from_canonical) return {};
  return {
    metric_availability: detail.availability || null,
    metric_availability_reason: detail.availability_reason || null,
    metric_is_proxy: detail.is_proxy ?? false,
  };
}

function isCanonicalDataUsableForTarget(detail = {}) {
  if (!detail.from_canonical) return true;
  return detail.availability === AVAILABILITY.AVAILABLE;
}

function formatMetricDisplay(value, unit, detail = {}) {
  const availability = detail.availability;
  const reason = safeAvailabilityReason(detail.availability_reason || detail.availability);
  const suffix = () => {
    if (!availability || availability === AVAILABILITY.AVAILABLE) return '';
    return availability === AVAILABILITY.PARTIAL
      ? ` · partial (${reason})`
      : ` · unavailable (${reason})`;
  };

  if (value == null || !Number.isFinite(Number(value))) {
    if (availability === AVAILABILITY.UNAVAILABLE || availability === AVAILABILITY.PARTIAL) {
      return availability === AVAILABILITY.PARTIAL
        ? `partial (${reason})`
        : `unavailable (${reason})`;
    }
    return '—';
  }

  let base;
  if (unit === '$') base = `$${value}`;
  else if (unit === 'x') base = `${value}x`;
  else if (unit === '%') base = `${value}%`;
  else base = String(value);

  const proxy = detail.is_proxy ? ' (proxy)' : '';
  return base + proxy + suffix();
}

function metricAnnotation(detail = {}) {
  const parts = [];
  if (detail.is_proxy) parts.push('proxy');
  if (detail.availability === AVAILABILITY.PARTIAL) {
    parts.push(`partial (${safeAvailabilityReason(detail.availability_reason)})`);
  } else if (detail.availability === AVAILABILITY.UNAVAILABLE) {
    parts.push(`unavailable (${safeAvailabilityReason(detail.availability_reason)})`);
  }
  return parts.length ? parts.join(' · ') : null;
}

module.exports = {
  AVAILABILITY,
  CANONICAL_AD_METRICS,
  safeAvailabilityReason,
  labelledAvailability,
  isUsableForRecommendations,
  isCanonicalAdMetric,
  resolveConsumerMetric,
  unavailableConsumerMetric,
  canonicalMetricMeta,
  isCanonicalDataUsableForTarget,
  formatMetricDisplay,
  metricAnnotation,
};
