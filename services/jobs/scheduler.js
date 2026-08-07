// services/jobs/scheduler.js — Interval schedules + worker loop with advisory locks.
'use strict';

const _db = require('../../db');
const { ensureJobsSchema } = require('./schema');
const { enqueue, claimJobs, completeJob, failJob } = require('./queue');
const { logger } = require('../infra/logger');
const { isShuttingDown } = require('../infra/shutdown');

/** @type {Map<string, { intervalMs: number, handler: Function, maxAttempts?: number }>} */
const _handlers = new Map();
let _scheduleTimer = null;
let _workerTimer = null;
let _started = false;

function registerHandler(name, handler, opts = {}) {
  _handlers.set(name, {
    intervalMs: opts.intervalMs || null,
    handler,
    maxAttempts: opts.maxAttempts ?? 3,
  });
}

/**
 * Register a recurring job. Uses Postgres advisory lock so only one instance
 * enqueues per interval window when multiple processes share the DB.
 */
async function registerSchedule(name, intervalMs, handler, opts = {}) {
  registerHandler(name, handler, { intervalMs, maxAttempts: opts.maxAttempts });
  if (!_db.hasDb()) return;
  await ensureJobsSchema();
  await _db.getPool().query(`
    INSERT INTO job_schedules (name, interval_ms, enabled, updated_at)
    VALUES ($1, $2, true, now())
    ON CONFLICT (name) DO UPDATE SET interval_ms=EXCLUDED.interval_ms, enabled=true, updated_at=now()
  `, [name, intervalMs]);
}

function _lockKey(name) {
  // Stable int4 lock id from name
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return h || 1;
}

async function _enqueueDueSchedules() {
  if (!_db.hasDb() || isShuttingDown()) return;
  const p = _db.getPool();
  const schedules = await p.query(`SELECT * FROM job_schedules WHERE enabled=true`);
  for (const s of schedules.rows) {
    const meta = _handlers.get(s.name);
    if (!meta) continue;
    const due = !s.last_enqueued_at
      || (Date.now() - new Date(s.last_enqueued_at).getTime() >= Number(s.interval_ms));
    if (!due) continue;

    const client = await p.connect();
    try {
      const locked = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [_lockKey(s.name)]);
      if (!locked.rows[0]?.ok) continue;

      // Re-check after lock
      const fresh = await client.query(`SELECT last_enqueued_at, interval_ms FROM job_schedules WHERE name=$1`, [s.name]);
      const row = fresh.rows[0];
      const stillDue = !row.last_enqueued_at
        || (Date.now() - new Date(row.last_enqueued_at).getTime() >= Number(row.interval_ms));
      if (stillDue) {
        // Avoid duplicate pending jobs for same schedule
        const pending = await client.query(
          `SELECT 1 FROM job_queue WHERE name=$1 AND status IN ('pending','running') LIMIT 1`,
          [s.name]
        );
        if (!pending.rows.length) {
          await enqueue(s.name, {}, { maxAttempts: meta.maxAttempts });
        }
        await client.query(`UPDATE job_schedules SET last_enqueued_at=now(), updated_at=now() WHERE name=$1`, [s.name]);
      }
      await client.query(`SELECT pg_advisory_unlock($1)`, [_lockKey(s.name)]);
    } catch (e) {
      logger.warn('schedule_enqueue_failed', { name: s.name, error: e.message });
      try { await client.query(`SELECT pg_advisory_unlock($1)`, [_lockKey(s.name)]); } catch { /* ignore */ }
    } finally {
      client.release();
    }
  }
}

async function _processOnce() {
  if (!_db.hasDb() || isShuttingDown()) return;
  const jobs = await claimJobs(3);
  for (const job of jobs) {
    const meta = _handlers.get(job.name);
    if (!meta) {
      await failJob(job.id, new Error(`no_handler:${job.name}`), {
        attempts: job.max_attempts,
        maxAttempts: job.max_attempts,
      });
      continue;
    }
    try {
      await meta.handler(job.payload || {}, job);
      await completeJob(job.id);
      await _db.getPool().query(
        `UPDATE job_schedules SET last_success_at=now(), last_error=NULL WHERE name=$1`,
        [job.name]
      ).catch(() => {});
    } catch (e) {
      await failJob(job.id, e, { attempts: job.attempts, maxAttempts: job.max_attempts });
      await _db.getPool().query(
        `UPDATE job_schedules SET last_error=$2 WHERE name=$1`,
        [job.name, String(e.message || e).slice(0, 500)]
      ).catch(() => {});
      logger.warn('job_failed', { name: job.name, id: job.id, error: e.message, attempt: job.attempts });
    }
  }
}

/**
 * In-process interval runner used when DB is unavailable — still mutexed in-memory.
 */
function registerIntervalFallback(name, intervalMs, handler) {
  registerHandler(name, handler, { intervalMs });
  const state = { timer: null, running: false };
  const tick = async () => {
    if (state.running || isShuttingDown()) return;
    state.running = true;
    try { await handler({}, { name }); }
    catch (e) { logger.warn('interval_fallback_failed', { name, error: e.message }); }
    finally { state.running = false; }
  };
  state.timer = setInterval(tick, intervalMs);
  if (typeof state.timer.unref === 'function') state.timer.unref();
  return () => { if (state.timer) clearInterval(state.timer); };
}

async function startJobs({ scheduleEveryMs = 15_000, workerEveryMs = 5_000 } = {}) {
  if (_started) return;
  _started = true;
  if (_db.hasDb()) {
    await ensureJobsSchema();
    _scheduleTimer = setInterval(() => {
      _enqueueDueSchedules().catch((e) => logger.warn('schedule_tick_failed', { error: e.message }));
    }, scheduleEveryMs);
    _workerTimer = setInterval(() => {
      _processOnce().catch((e) => logger.warn('worker_tick_failed', { error: e.message }));
    }, workerEveryMs);
    if (typeof _scheduleTimer.unref === 'function') _scheduleTimer.unref();
    if (typeof _workerTimer.unref === 'function') _workerTimer.unref();
    // Kick once shortly after boot
    setTimeout(() => {
      _enqueueDueSchedules().catch(() => {});
      _processOnce().catch(() => {});
    }, 3000).unref?.();
    logger.info('jobs_started', { mode: 'postgres' });
  } else {
    logger.info('jobs_started', { mode: 'fallback_no_db' });
  }
}

function stopJobs() {
  if (_scheduleTimer) clearInterval(_scheduleTimer);
  if (_workerTimer) clearInterval(_workerTimer);
  _scheduleTimer = null;
  _workerTimer = null;
  _started = false;
}

module.exports = {
  registerHandler,
  registerSchedule,
  registerIntervalFallback,
  startJobs,
  stopJobs,
};
