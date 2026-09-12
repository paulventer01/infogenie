'use strict';

function validTimezone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); return true; }
  catch { return false; }
}

const MAX_LOOKBACK_DAYS = 366;
const RELATIVE_PERIODS = new Set(['all_time', 'last_7_days', 'last_30_days', 'previous_calendar_month']);

function fail(status, code) { return Object.assign(new Error(code), { status }); }

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(pick('year')), month: Number(pick('month')), day: Number(pick('day')),
    hour: Number(pick('hour')), minute: Number(pick('minute')),
  };
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(year, month, day, delta) {
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + delta);
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

function daysBetween(start, end) {
  const a = Date.UTC(start.year, start.month - 1, start.day);
  const b = Date.UTC(end.year, end.month - 1, end.day);
  return Math.floor((b - a) / 86400000);
}

function periodLabel(periodKey, startDate, endDate, timezone) {
  if (periodKey === 'all_time') return 'All-time recorded data';
  if (periodKey === 'custom') return `${startDate} to ${endDate} (${timezone})`;
  const labels = {
    last_7_days: 'Last 7 completed days',
    last_30_days: 'Last 30 completed days',
    previous_calendar_month: 'Previous calendar month',
  };
  return `${labels[periodKey] || periodKey}: ${startDate} to ${endDate} (${timezone})`;
}

function resolveRelative(periodKey, timezone, asOf = new Date()) {
  if (!RELATIVE_PERIODS.has(periodKey)) throw fail(400, 'invalid_profile');
  if (!validTimezone(timezone)) throw fail(400, 'invalid_profile');
  if (periodKey === 'all_time') {
    return { periodKey, timezone, startDate: null, endDate: null, exclusiveEnd: null,
      label: periodLabel('all_time', null, null, timezone) };
  }
  const today = zonedParts(asOf, timezone);
  const yesterday = addDays(today.year, today.month, today.day, -1);
  let start = yesterday;
  let end = yesterday;
  if (periodKey === 'last_7_days') start = addDays(yesterday.year, yesterday.month, yesterday.day, -6);
  else if (periodKey === 'last_30_days') start = addDays(yesterday.year, yesterday.month, yesterday.day, -29);
  else if (periodKey === 'previous_calendar_month') {
    const prevMonth = today.month === 1 ? { year: today.year - 1, month: 12 } : { year: today.year, month: today.month - 1 };
    start = { year: prevMonth.year, month: prevMonth.month, day: 1 };
    const lastDay = new Date(Date.UTC(prevMonth.year, prevMonth.month, 0)).getUTCDate();
    end = { year: prevMonth.year, month: prevMonth.month, day: lastDay };
  }
  const startDate = isoDate(start.year, start.month, start.day);
  const endDate = isoDate(end.year, end.month, end.day);
  const exclusive = addDays(end.year, end.month, end.day, 1);
  return {
    periodKey, timezone, startDate, endDate,
    exclusiveEnd: isoDate(exclusive.year, exclusive.month, exclusive.day),
    label: periodLabel(periodKey, startDate, endDate, timezone),
  };
}

function validateCustomRange(startDate, endDate, timezone, asOf = new Date()) {
  if (!validTimezone(timezone)) throw fail(400, 'invalid_report');
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) throw fail(400, 'invalid_report');
  if (daysBetween(start, end) < 0) throw fail(400, 'invalid_report');
  const span = daysBetween(start, end) + 1;
  if (span > MAX_LOOKBACK_DAYS) throw fail(400, 'invalid_report');
  const today = zonedParts(asOf, timezone);
  const todayIso = isoDate(today.year, today.month, today.day);
  if (endDate > todayIso) throw fail(400, 'invalid_report');
  const earliest = addDays(today.year, today.month, today.day, -(MAX_LOOKBACK_DAYS - 1));
  const earliestIso = isoDate(earliest.year, earliest.month, earliest.day);
  if (startDate < earliestIso) throw fail(400, 'invalid_report');
  const exclusive = addDays(end.year, end.month, end.day, 1);
  return {
    periodKey: 'custom', timezone, startDate, endDate,
    exclusiveEnd: isoDate(exclusive.year, exclusive.month, exclusive.day),
    label: periodLabel('custom', startDate, endDate, timezone),
  };
}

function sqlBounds(range) {
  if (!range || !range.startDate) return { start: null, end: null };
  return { start: `${range.startDate}T00:00:00.000Z`, end: `${range.exclusiveEnd}T00:00:00.000Z` };
}

module.exports = {
  MAX_LOOKBACK_DAYS, RELATIVE_PERIODS, resolveRelative, validateCustomRange, periodLabel, sqlBounds, parseIsoDate,
};
