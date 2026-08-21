// services/security/rate_limit.js — Sliding-window limiter; Redis when available.
'use strict';

const { redisIncr, isRedisConfigured } = require('../infra/redis');

/**
 * @param {{ windowMs?: number, max?: number, keyFn?: Function, name?: string,
 *          serialize?: boolean, failClosed?: boolean }} opts
 * @returns {import('express').RequestHandler}
 *
 * `serialize` and `failClosed` are opt-in and default to false so existing
 * callers (notably `authAbuseLimiter`) keep their current behaviour exactly.
 * See the notes on `_decide` and on the `failClosed` branch below.
 */
function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 20;
  const name = opts.name || 'default';
  const serialize = opts.serialize === true;
  const failClosed = opts.failClosed === true;
  const keyFn =
    opts.keyFn ||
    ((req) => {
      const ip =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        'unknown';
      return `${name}|${ip}|${req.path}`;
    });

  const buckets = new Map();
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));

  // Periodic prune so idle keys don't grow forever in long-lived processes.
  const pruneEvery = Math.max(windowMs, 60_000);
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of buckets) {
      const kept = arr.filter((t) => now - t < windowMs);
      if (kept.length) buckets.set(k, kept);
      else buckets.delete(k);
    }
  }, pruneEvery);
  if (typeof timer.unref === 'function') timer.unref();

  async function _redisAllow(key) {
    if (!isRedisConfigured()) return null;
    const n = await redisIncr(`rl:${key}`, ttlSec);
    if (n == null) return null;
    return n <= max;
  }

  function _localAllow(key) {
    const now = Date.now();
    const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    buckets.set(key, arr);
    return true;
  }

  // Redis shared counter when configured (atomic INCR, correct across
  // instances); process-local sliding window when Redis is absent or its call
  // fails. The fallback is intentional: a Redis outage degrades the limit to
  // per-process rather than removing it.
  async function _verdict(key) {
    let redisVerdict = null;
    try {
      redisVerdict = await _redisAllow(key);
    } catch {
      redisVerdict = null;
    }
    if (redisVerdict === true || redisVerdict === false) return redisVerdict;
    return _localAllow(key);
  }

  // The process-local branch is check-then-act across an await, so two
  // concurrent requests on one key can both observe `arr.length < max` and both
  // be admitted. `serialize: true` funnels verdicts for a key through a promise
  // chain, making admissions atomic within this process. Redis remains the
  // multi-instance counter. Opt-in because it costs a per-key queue and the
  // IP-keyed auth limiter neither needs it nor may change.
  const _locks = new Map();
  function _decide(key) {
    if (!serialize) return _verdict(key);
    const run = () => _verdict(key);
    const prev = _locks.get(key) || Promise.resolve();
    const chained = prev.then(run, run);
    // The lock must never reject, or the next waiter would inherit a rejection.
    const lock = chained.then(() => {}, () => {});
    _locks.set(key, lock);
    lock.then(() => { if (_locks.get(key) === lock) _locks.delete(key); });
    return chained;
  }

  function middleware(req, res, next) {
    const rawKey = keyFn(req);

    const finish = (allowed) => {
      if (!allowed) {
        const retryAfterSec = Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          ok: false,
          error: 'rate_limited',
          retryAfterSec,
        });
      }
      return next();
    };

    // A keyFn that cannot identify the caller must not collapse every caller
    // into one shared `null` bucket. Callers that derive the key from
    // authenticated context opt into denying instead.
    if (failClosed && (rawKey == null || rawKey === '')) return finish(false);
    const key = String(rawKey);

    _decide(key)
      .then((allowed) => { finish(allowed); }, () => { finish(!failClosed); })
      // `finish` itself can only throw once the response is already unusable
      // (e.g. headers sent). Swallow it rather than raise an unhandled
      // rejection; the previous shape re-entered and could call next() twice.
      .catch(() => {});
  }

  middleware._buckets = buckets; // test seam
  middleware.reset = () => { buckets.clear(); _locks.clear(); };
  return middleware;
}

/** Stricter limiter for /api/auth/login|signup|request-reset. */
function authAbuseLimiter() {
  return createRateLimiter({
    name: 'auth',
    windowMs: 15 * 60_000,
    max: 30, // 30 attempts / 15 min / IP+path
    keyFn: (req) => {
      const ip =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        'unknown';
      return `auth|${ip}|${req.path}`;
    },
  });
}

module.exports = { createRateLimiter, authAbuseLimiter };
