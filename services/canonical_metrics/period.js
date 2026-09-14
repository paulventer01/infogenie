'use strict';

/**
 * PR10G.8 — UTC calendar-quarter bounds and measurement cutoff for canonical metrics.
 * Quarters are YYYY-Q1..Q4 with start inclusive and next-quarter start exclusive.
 */

const MS_PER_DAY = 86400000;

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

function parseQuarter(quarter) {
  const m = String(quarter || '').match(QUARTER_RE);
  if (!m) return null;
  return { year: parseInt(m[1], 10), q: parseInt(m[2], 10), quarter: `${m[1]}-Q${m[2]}` };
}

function isoDateUtc(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/**
 * @returns {{ quarter: string, start: string, end: string, startUtc: string, endExclusiveUtc: string, days: number } | null}
 */
function quarterBounds(quarter) {
  const parsed = parseQuarter(quarter);
  if (!parsed) return null;
  const { year, q } = parsed;
  const startMonthIndex = (q - 1) * 3;
  const start = isoDateUtc(year, startMonthIndex, 1);
  const end = isoDateUtc(year, startMonthIndex + 3, 0);
  const startUtc = `${start}T00:00:00.000Z`;
  const endExclusiveUtc = isoDateUtc(year, startMonthIndex + 3, 1) + 'T00:00:00.000Z';
  const startMs = Date.parse(startUtc);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  const days = Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
  return {
    quarter: parsed.quarter,
    start,
    end,
    startUtc,
    endExclusiveUtc,
    days,
  };
}

/**
 * @returns {'full_quarter'|'quarter_to_date'|'not_started'|null}
 */
function measurementCutoff(quarter, asOf = new Date()) {
  const bounds = quarterBounds(quarter);
  if (!bounds) return null;
  const nowMs = asOf.getTime();
  const startMs = Date.parse(bounds.startUtc);
  const endExclusiveMs = Date.parse(bounds.endExclusiveUtc);
  if (nowMs < startMs) return 'not_started';
  if (nowMs >= endExclusiveMs) return 'full_quarter';
  return 'quarter_to_date';
}

function queryEndExclusiveUtc(bounds, cutoff, asOf = new Date()) {
  if (!bounds) return null;
  if (cutoff === 'not_started') return bounds.startUtc;
  if (cutoff === 'full_quarter') return bounds.endExclusiveUtc;
  const nowIso = asOf.toISOString();
  return nowIso < bounds.endExclusiveUtc ? nowIso : bounds.endExclusiveUtc;
}

/**
 * Resolve compute window from opts.
 * @returns {{ kind: 'rolling', days: number } | { kind: 'quarter', quarter: string, start: string, end: string, startUtc: string, endExclusiveUtc: string, queryEndExclusiveUtc: string, days: number, cutoff: string, cutoff_label: string } | null}
 */
function resolveComputeWindow(opts = {}) {
  if (opts.quarter) {
    const bounds = quarterBounds(opts.quarter);
    if (!bounds) return null;
    const asOf = opts.asOf instanceof Date ? opts.asOf : new Date(opts.asOf || Date.now());
    const cutoff = measurementCutoff(bounds.quarter, asOf);
    const queryEnd = queryEndExclusiveUtc(bounds, cutoff, asOf);
    return {
      kind: 'quarter',
      quarter: bounds.quarter,
      start: bounds.start,
      end: bounds.end,
      startUtc: bounds.startUtc,
      endExclusiveUtc: bounds.endExclusiveUtc,
      queryEndExclusiveUtc: queryEnd,
      days: bounds.days,
      cutoff,
      cutoff_label: formatQuarterCutoffLabel(bounds.quarter, cutoff, asOf),
    };
  }
  const days = Math.min(90, Math.max(1, parseInt(opts.days, 10) || 30));
  return { kind: 'rolling', days };
}

function formatQuarterCutoffLabel(quarter, cutoff, asOf = new Date()) {
  if (!quarter) return '';
  if (cutoff === 'not_started') return `${quarter} (not started)`;
  if (cutoff === 'quarter_to_date') {
    const through = asOf.toISOString().slice(0, 10);
    return `${quarter} (quarter-to-date through ${through})`;
  }
  return quarter;
}

function formatMeasurementPeriodLabel(period, snapshot) {
  if (!period) return '';
  if (period.kind === 'quarter') {
    if (snapshot?.period_cutoff_label) return snapshot.period_cutoff_label;
    return formatQuarterCutoffLabel(period.quarter, snapshot?.period_cutoff || 'full_quarter');
  }
  if (period.kind === 'rolling_days') {
    return `Last ${period.days} days (rolling)`;
  }
  return '';
}

function stampQuarterPeriodMetadata(out, window) {
  if (!window || window.kind !== 'quarter') return out;
  out.period_authoritative = true;
  out.period_kind = 'quarter';
  out.period_quarter = window.quarter;
  out.period_start = window.start;
  out.period_end = window.end;
  out.period_end_exclusive = window.endExclusiveUtc.slice(0, 10);
  out.period_cutoff = window.cutoff;
  out.period_cutoff_label = window.cutoff_label;
  out.days = window.days;
  return out;
}

function okrMeasurementPeriod(quarter) {
  const bounds = quarterBounds(quarter);
  if (!bounds) return null;
  return {
    kind: 'quarter',
    quarter: bounds.quarter,
    days: bounds.days,
    start: bounds.start,
    end: bounds.end,
  };
}

module.exports = {
  parseQuarter,
  quarterBounds,
  measurementCutoff,
  queryEndExclusiveUtc,
  resolveComputeWindow,
  formatQuarterCutoffLabel,
  formatMeasurementPeriodLabel,
  stampQuarterPeriodMetadata,
  okrMeasurementPeriod,
  MS_PER_DAY,
};
