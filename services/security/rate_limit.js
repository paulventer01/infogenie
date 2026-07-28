// services/security/rate_limit.js — Shared in-memory sliding-window rate limiter.
//
// Scaffold for auth abuse controls and public POST surfaces. Process-local by
// design (matches existing Studio Pack limiter); swap the store for Redis when
// multi-instance deploys need shared counters.
'use strict';

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

  function middleware(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retryAfterSec = Math.ceil(windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        retryAfterSec,
      });
    }
    arr.push(now);
    buckets.set(key, arr);
    return next();
  }

  middleware._buckets = buckets; // test seam
  middleware.reset = () => buckets.clear();
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
