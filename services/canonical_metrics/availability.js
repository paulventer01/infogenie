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
 * Zero denominator → null, unavailable, zero_denominator.
 */
function ratio(numerator, denominator, { numAvail = true, denomAvail = true, label = 'ratio' } = {}) {
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
  return {
    value: Math.round((num / Number(denominator)) * 100) / 100,
    availability: AVAILABILITY.AVAILABLE,
    availability_reason: null,
  };
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
  sourceFailedReason,
};
