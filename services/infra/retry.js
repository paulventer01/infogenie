// services/infra/retry.js — Shared retry with exponential backoff + jitter.
'use strict';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || 0;
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = String(err.message || err);
  return /timeout|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|429|502|503|504|rate.?limit|overloaded|no body/i.test(msg);
}

/**
 * @param {() => Promise<T>} fn
 * @param {{ retries?: number, minDelayMs?: number, maxDelayMs?: number, factor?: number, shouldRetry?: (e:any)=>boolean, onRetry?: (e:any, attempt:number)=>void, label?: string }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 2;
  const minDelayMs = opts.minDelayMs ?? 200;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const factor = opts.factor ?? 2;
  const shouldRetry = opts.shouldRetry || isTransientError;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= retries || !shouldRetry(e)) throw e;
      const base = Math.min(maxDelayMs, minDelayMs * Math.pow(factor, attempt));
      const jitter = Math.floor(Math.random() * Math.min(250, base * 0.25));
      if (typeof opts.onRetry === 'function') opts.onRetry(e, attempt + 1);
      await sleep(base + jitter);
    }
  }
  throw lastErr;
}

module.exports = { withRetry, isTransientError, sleep };
