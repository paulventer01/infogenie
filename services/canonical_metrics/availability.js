'use strict';

/**
 * Availability semantics for canonical metrics (PR10G.1).
 *
 * available   — required source(s) queried successfully; value may legitimately be 0
 * unavailable — source failed, DB missing, required input missing, or zero denominator
 */

const AVAILABILITY = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  PARTIAL: 'partial',
};

const REASON = {
  DATABASE_UNAVAILABLE: 'database_unavailable',
  SOURCE_QUERY_FAILED: 'source_query_failed',
  INPUT_UNAVAILABLE: 'input_unavailable',
  INPUT_PARTIAL: 'input_partial',
  ZERO_DENOMINATOR: 'zero_denominator',
  OFFLINE_UNAVAILABLE: 'offline_conversions_unavailable',
};

function availabilityRecord(status, reason = null) {
  return { status, reason };
}

function available(reason = null) {
  return availabilityRecord(AVAILABILITY.AVAILABLE, reason);
}

function unavailable(reason) {
  return availabilityRecord(AVAILABILITY.UNAVAILABLE, reason);
}

function partial(reason) {
  return availabilityRecord(AVAILABILITY.PARTIAL, reason);
}

/**
 * Safe ratio: returns { value, availability, availability_reason }.
 * Valid zero numerator with positive denominator → value 0, available.
 * Zero denominator → null, unavailable (takes precedence over partial).
 * Partial inputs → numeric value with partial status when denominator > 0.
 */
function ratio(numerator, denominator, {
  numAvail = true,
  denomAvail = true,
  numPartial = false,
  denomPartial = false,
  partialReason = null,
} = {}) {
  if (!numAvail || !denomAvail) {
    const missing = !numAvail ? 'numerator' : 'denominator';
    return {
      value: null,
      availability: AVAILABILITY.UNAVAILABLE,
      availability_reason: `${REASON.INPUT_UNAVAILABLE}:${missing}`,
    };
  }
  if (denominator == null || !Number.isFinite(Number(denominator)) || Number(denominator) === 0) {
    return {
      value: null,
      availability: AVAILABILITY.UNAVAILABLE,
      availability_reason: REASON.ZERO_DENOMINATOR,
    };
  }
  const num = Number(numerator || 0);
  const value = Math.round((num / Number(denominator)) * 100) / 100;
  if (numPartial || denomPartial) {
    return {
      value,
      availability: AVAILABILITY.PARTIAL,
      availability_reason: partialReason || REASON.INPUT_PARTIAL,
    };
  }
  return {
    value,
    availability: AVAILABILITY.AVAILABLE,
    availability_reason: null,
  };
}

/** Resolve spend availability when the primary ad source may have failed. */
function resolveSpendAvailability(sources, supplementalDollars) {
  if (sources.ad_performance_hourly?.ok) {
    return { status: AVAILABILITY.AVAILABLE, reason: null };
  }
  const adFail = sourceFailedReason('ad_performance_hourly');
  if (!sources.spend_events?.ok) {
    return { status: AVAILABILITY.UNAVAILABLE, reason: adFail };
  }
  if (Number(supplementalDollars) > 0) {
    return { status: AVAILABILITY.PARTIAL, reason: adFail };
  }
  return { status: AVAILABILITY.UNAVAILABLE, reason: adFail };
}

function sourceFailedReason(source) {
  return `${REASON.SOURCE_QUERY_FAILED}:${source}`;
}

module.exports = {
  AVAILABILITY,
  REASON,
  availabilityRecord,
  available,
  unavailable,
  partial,
  ratio,
  resolveSpendAvailability,
  sourceFailedReason,
};
