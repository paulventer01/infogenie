// services/jobs/handlers.js — Wire core background jobs into the scheduler.
'use strict';

const { registerSchedule, registerIntervalFallback } = require('./scheduler');
const { logger } = require('../infra/logger');
const _db = require('../../db');

async function registerCoreJobs(deps = {}) {
  const useDb = _db.hasDb();

  // ── Drip engine (60s) ───────────────────────────────────────────────────
  if (typeof deps.dripTick === 'function') {
    const run = async () => { await deps.dripTick(); };
    if (useDb) await registerSchedule('drip.tick', 60_000, run, { maxAttempts: 2 });
    else registerIntervalFallback('drip.tick', 60_000, run);
  }

  // ── Crisis radar (6h) ───────────────────────────────────────────────────
  if (deps.crisisDetector && typeof deps.crisisDetector.runAll === 'function') {
    const run = async () => { await deps.crisisDetector.runAll(); };
    if (useDb) await registerSchedule('crisis.radar', 6 * 3600_000, run);
    else registerIntervalFallback('crisis.radar', 6 * 3600_000, run);
  }

  // ── Digest (24h) ────────────────────────────────────────────────────────
  if (typeof deps.digestTick === 'function') {
    const run = async () => { await deps.digestTick(); };
    if (useDb) await registerSchedule('digest.daily', 24 * 3600_000, run);
    else registerIntervalFallback('digest.daily', 24 * 3600_000, run);
  } else if (deps.digestRouter && typeof deps.digestRouter.runDigestTick === 'function') {
    const run = async () => { await deps.digestRouter.runDigestTick(); };
    if (useDb) await registerSchedule('digest.daily', 24 * 3600_000, run);
    else registerIntervalFallback('digest.daily', 24 * 3600_000, run);
  }

  // ── Optimizer ingest (60m) ──────────────────────────────────────────────
  if (deps.optimizerIngest && typeof deps.optimizerIngest.ingestOnce === 'function') {
    const run = async () => { await deps.optimizerIngest.ingestOnce(); };
    if (useDb) await registerSchedule('optimizer.ingest', 60 * 60_000, run);
    else registerIntervalFallback('optimizer.ingest', 60 * 60_000, run);
  }

  // ── Optimizer rules (6h) ────────────────────────────────────────────────
  if (deps.optimizerRules && typeof deps.optimizerRules.runOnce === 'function') {
    const run = async () => { await deps.optimizerRules.runOnce(); };
    if (useDb) await registerSchedule('optimizer.rules', 6 * 3600_000, run);
    else registerIntervalFallback('optimizer.rules', 6 * 3600_000, run);
  } else if (deps.optimizerRules && typeof deps.optimizerRules.runOptimizerOnce === 'function') {
    const run = async () => { await deps.optimizerRules.runOptimizerOnce(); };
    if (useDb) await registerSchedule('optimizer.rules', 6 * 3600_000, run);
    else registerIntervalFallback('optimizer.rules', 6 * 3600_000, run);
  }

  logger.info('core_jobs_registered', { db: useDb });
}

module.exports = { registerCoreJobs };
