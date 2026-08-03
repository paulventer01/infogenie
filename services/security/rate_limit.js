// services/security/rate_limit.js — Sliding-window limiter; Redis when available.
'use strict';

const { redisIncr, isRedisConfigured } = require('../infra/redis');

/**
 * @param {{ windowMs?: number, max?: number, keyFn?: Function, name?: string }} opts
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 20;
  const name = opts.name || 'default';
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

  function middleware(req, res, next) {
    const key = keyFn(req);

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

    // Prefer Redis shared counter when configured.
    _redisAllow(key)
      .then((redisVerdict) => {
        if (redisVerdict === true) return finish(true);
        if (redisVerdict === false) return finish(false);
        // Fallback: process-local sliding window
        const now = Date.now();
        const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
        if (arr.length >= max) return finish(false);
        arr.push(now);
        buckets.set(key, arr);
        return finish(true);
      })
      .catch(() => {
        const now = Date.now();
        const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
        if (arr.length >= max) return finish(false);
        arr.push(now);
        buckets.set(key, arr);
        return finish(true);
      });
  }

  middleware._buckets = buckets;
  middleware.reset = () => buckets.clear();
  return middleware;
}

function authAbuseLimiter() {
  return createRateLimiter({
    name: 'auth',
    windowMs: 15 * 60_000,
    max: 30,
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
