'use strict';

// Integer micros accounting. 1 USD = 1_000_000 micros. Never use float for
// ledger math. JSON responses cap at a safe integer (9e15 micros).

const { fail } = require('./errors');

const MICROS_PER_USD = 1_000_000n;
const MICROS_PER_CENT = 10_000n;
const JSON_MICROS_MAX = 9_000_000_000_000_000n; // 9e15

function isDigits(s) {
  return typeof s === 'string' && /^-?\d+$/.test(s.trim());
}

function toBigInt(v) {
  if (v == null || v === '') return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || !Number.isInteger(v)) fail('validation_failed');
    return BigInt(v);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!isDigits(s)) fail('validation_failed');
    return BigInt(s);
  }
  fail('validation_failed');
}

function requirePositiveMicros(v) {
  const n = toBigInt(v);
  if (n <= 0n) fail('validation_failed');
  return n;
}

function requireNonNegativeMicros(v) {
  const n = toBigInt(v);
  if (n < 0n) fail('validation_failed');
  return n;
}

// Dollar → micros via integer cents: Math.round(Number(n)*100)*10000n
function dollarsToMicros(n) {
  if (n == null || n === '') fail('validation_failed');
  const cents = Math.round(Number(n) * 100);
  if (!Number.isFinite(cents) || cents < 0) fail('validation_failed');
  return BigInt(cents) * MICROS_PER_CENT;
}

function microsToDollarNumber(v) {
  const n = toBigInt(v);
  const cents = n / MICROS_PER_CENT;
  return Number(cents) / 100;
}

function microsToJson(v) {
  const n = toBigInt(v);
  if (n > JSON_MICROS_MAX) return Number(JSON_MICROS_MAX);
  if (n < -JSON_MICROS_MAX) return -Number(JSON_MICROS_MAX);
  return Number(n);
}

function toSql(v) {
  return toBigInt(v).toString();
}

function fromPg(v) {
  if (v == null || v === '') return 0n;
  return toBigInt(typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' ? v : String(v));
}

function parseMicrosField(body, microsKey, dollarsKey) {
  if (!body || typeof body !== 'object') fail('validation_failed');
  if (body[microsKey] != null && body[microsKey] !== '') {
    return requireNonNegativeMicros(body[microsKey]);
  }
  if (dollarsKey && body[dollarsKey] != null && body[dollarsKey] !== '') {
    return dollarsToMicros(body[dollarsKey]);
  }
  return null;
}

module.exports = {
  MICROS_PER_USD,
  MICROS_PER_CENT,
  JSON_MICROS_MAX,
  toBigInt,
  requirePositiveMicros,
  requireNonNegativeMicros,
  dollarsToMicros,
  microsToDollarNumber,
  microsToJson,
  toSql,
  fromPg,
  parseMicrosField,
};
