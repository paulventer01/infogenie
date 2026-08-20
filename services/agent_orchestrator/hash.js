'use strict';

const crypto = require('crypto');

function canonicalize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (t === 'boolean' || t === 'string') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (Array.isArray(value)) {
    return value.map((v) => {
      const c = canonicalize(v);
      return c === undefined ? null : c;
    });
  }
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const c = canonicalize(value[k]);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return String(value);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

module.exports = { canonicalize, canonicalJson, sha256Hex };
