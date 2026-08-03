// services/infra/circuit_breaker.js — Lightweight circuit breaker (no deps).
'use strict';

const { logger } = require('./logger');

const DEFAULTS = {
  failureThreshold: 5,
  successThreshold: 2,
  openMs: 30_000,
};

/**
 * @param {string} name
 * @param {Partial<typeof DEFAULTS>} [opts]
 */
function createCircuitBreaker(name, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let state = 'closed'; // closed | open | half_open
  let failures = 0;
  let successes = 0;
  let openedAt = 0;

  function _trip(reason) {
    state = 'open';
    openedAt = Date.now();
    successes = 0;
    logger.warn('circuit_open', { circuit: name, reason, failures });
  }

  function _close() {
    state = 'closed';
    failures = 0;
    successes = 0;
    logger.info('circuit_closed', { circuit: name });
  }

  function allow() {
    if (state === 'closed') return true;
    if (state === 'open') {
      if (Date.now() - openedAt >= cfg.openMs) {
        state = 'half_open';
        successes = 0;
        return true;
      }
      return false;
    }
    // half_open — allow probe traffic
    return true;
  }

  function recordSuccess() {
    if (state === 'half_open') {
      successes += 1;
      if (successes >= cfg.successThreshold) _close();
    } else {
      failures = 0;
    }
  }

  function recordFailure(err) {
    failures += 1;
    if (state === 'half_open') {
      _trip((err && err.message) || 'half_open_fail');
      return;
    }
    if (failures >= cfg.failureThreshold) {
      _trip((err && err.message) || 'threshold');
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function exec(fn) {
    if (!allow()) {
      const e = new Error(`circuit_open:${name}`);
      e.code = 'CIRCUIT_OPEN';
      e.status = 503;
      throw e;
    }
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      recordFailure(err);
      throw err;
    }
  }

  function snapshot() {
    return { name, state, failures, successes, openedAt: openedAt || null, cfg };
  }

  return { name, allow, exec, recordSuccess, recordFailure, snapshot };
}

const _breakers = new Map();

function getBreaker(name, opts) {
  if (!_breakers.has(name)) _breakers.set(name, createCircuitBreaker(name, opts));
  return _breakers.get(name);
}

function allSnapshots() {
  return [..._breakers.values()].map((b) => b.snapshot());
}

module.exports = { createCircuitBreaker, getBreaker, allSnapshots };
