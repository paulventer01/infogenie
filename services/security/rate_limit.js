// services/security/rate_limit.js — Fixed-window limiter.
//
// Implemented with `express-rate-limit` rather than a hand-rolled window. That
// package is the one CodeQL's `js/missing-rate-limiting` models, so building the
// factory on it turns a protected route into a true negative instead of a
// high-severity alert an operator has to dismiss by hand. It is a single policy
// engine, not a second limiter sitting beside a custom one.
//
// The public contract is unchanged for callers: `createRateLimiter({ name,
// windowMs, max, keyFn, ... })` returns an Express middleware that answers
// `429 { ok:false, error:'rate_limited', retryAfterSec }` with a `Retry-After`
// header in integer seconds.
'use strict';

const rateLimit = require('express-rate-limit');
const { MemoryStore } = require('express-rate-limit');
const { redisIncr, isRedisConfigured } = require('../infra/redis');

// Key returned when `keyFn` cannot identify the caller. Under `failClosed` the
// limit for this key is 0, so the request is denied rather than being bucketed
// together with every other unidentifiable caller.
const NO_KEY = '__no_key__';

/**
 * Redis-first store with a process-local fallback.
 *
 * Redis `INCR` is atomic and shared across instances, so it is the correct
 * counter for a multi-instance deployment. When `REDIS_URL` is unset — or set
 * but unreachable — the store degrades to `MemoryStore`, which keeps the limit
 * working per process. That degradation is deliberate: making a Redis outage
 * deny would take `/api/auth/login` down with it.
 */
class RedisOrMemoryStore {
  constructor() {
    this.memory = new MemoryStore();
    this.windowMs = 60_000;
    this.ttlSec = 60;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.ttlSec = Math.max(1, Math.ceil(options.windowMs / 1000));
    this.memory.init(options);
  }

  async increment(key) {
    if (isRedisConfigured()) {
      try {
        const hits = await redisIncr(`rl:${key}`, this.ttlSec);
        if (typeof hits === 'number' && hits > 0) {
          return { totalHits: hits, resetTime: new Date(Date.now() + this.windowMs) };
        }
      } catch {
        // fall through to the process-local counter
      }
    }
    // MemoryStore.increment bumps the counter with no await in between, so
    // concurrent requests get distinct totals and cannot both see spare
    // capacity. This is what removed the need for the old admission lock.
    return this.memory.increment(key);
  }

  async decrement(key) { return this.memory.decrement(key); }

  async resetKey(key) { return this.memory.resetKey(key); }

  // Clears the process-local counters only; Redis keys expire on their own TTL.
  async resetAll() { return this.memory.resetAll(); }
}

/**
 * @param {{ windowMs?: number, max?: number, keyFn?: Function, name?: string,
 *          failClosed?: boolean, serialize?: boolean }} opts
 * @returns {import('express').RequestHandler}
 *
 * `failClosed` is opt-in and defaults to false, so `authAbuseLimiter` keeps its
 * behaviour exactly.
 *
 * `serialize` is accepted and **does nothing**. It used to install a per-key
 * admission lock around a check-then-act window that no longer exists: the store
 * increments before the middleware compares (see `RedisOrMemoryStore.increment`),
 * so concurrent requests already get distinct totals. It is still accepted so a
 * caller carrying the old option does not silently break.
 *
 * The returned value is the `express-rate-limit` middleware itself, not a
 * wrapper. Callers may mount the same instance more than once on one chain; it
 * counts a request at most once (see `alreadyCounted`).
 */
function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 20;
  const name = opts.name || 'default';
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

  const retryAfterSec = Math.max(1, Math.ceil(windowMs / 1000));
  const store = new RedisOrMemoryStore();

  // One instance can appear twice on a chain — the playbooks router mounts the
  // shared limiter with `use()` and again as an explicit argument on each route
  // so the limiter is visible beside the handler it protects. `skip` runs before
  // the store is touched, so the second pass spends no token and the tenant
  // ceiling is unchanged. Unique per instance: a different limiter on the same
  // request still counts.
  const alreadyCounted = Symbol(`rate-limit:${name}`);
  // Set by keyGenerator when the caller could not be identified; read by the
  // `limit` function below, which express-rate-limit evaluates after the key.
  const unidentified = Symbol(`rate-limit-no-key:${name}`);

  const limiter = rateLimit({
    windowMs,
    limit: failClosed ? (req) => (req[unidentified] ? 0 : max) : max,
    store,
    keyGenerator: (req, res) => {
      const raw = keyFn(req, res);
      if (raw === null || raw === undefined || raw === '') {
        req[unidentified] = true;
        return NO_KEY;
      }
      return String(raw);
    },
    skip: (req) => {
      if (req[alreadyCounted]) return true;
      req[alreadyCounted] = true;
      return false;
    },
    // Responses stay byte-identical to the hand-rolled limiter: no RateLimit-*
    // or X-RateLimit-* headers advertising the policy, and Retry-After set only
    // on the 429 below.
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req, res) => {
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        retryAfterSec,
      });
    },
    validate: {
      // keyFn is deliberately custom, so the package cannot reason about proxy
      // configuration or IP handling on our behalf.
      xForwardedForHeader: false,
      trustProxy: false,
      ip: false,
      // `limit: 0` is the intended failClosed denial, not the v6→v7 migration
      // footgun this check warns about.
      limit: false,
    },
  });

  // Test seam. Clears the process-local counters; Redis keys age out on TTL.
  limiter.reset = () => { store.resetAll(); };
  return limiter;
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
