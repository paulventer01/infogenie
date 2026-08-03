// services/jobs/queue.js — Postgres-backed job queue with retries + DLQ.
'use strict';

const os = require('os');
const crypto = require('crypto');
const _db = require('../../db');
const { logger } = require('../infra/logger');

const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

async function enqueue(name, payload = {}, opts = {}) {
  if (!_db.hasDb()) throw new Error('job_queue requires database');
  const maxAttempts = opts.maxAttempts ?? 3;
  const runAt = opts.runAt ? new Date(opts.runAt) : new Date();
  const r = await _db.getPool().query(`
    INSERT INTO job_queue (name, payload, max_attempts, run_at)
    VALUES ($1, $2::jsonb, $3, $4)
    RETURNING id
  `, [name, JSON.stringify(payload || {}), maxAttempts, runAt]);
  return r.rows[0].id;
}

/** Claim up to `limit` due jobs using FOR UPDATE SKIP LOCKED. */
async function claimJobs(limit = 5) {
  if (!_db.hasDb()) return [];
  const p = _db.getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`
      SELECT id FROM job_queue
      WHERE status IN ('pending','failed')
        AND run_at <= now()
        AND attempts < max_attempts
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    `, [limit]);
    if (!r.rows.length) {
      await client.query('COMMIT');
      return [];
    }
    const ids = r.rows.map((row) => row.id);
    const claimed = await client.query(`
      UPDATE job_queue
      SET status='running', locked_at=now(), locked_by=$2, attempts=attempts+1
      WHERE id = ANY($1::bigint[])
      RETURNING *
    `, [ids, WORKER_ID]);
    await client.query('COMMIT');
    return claimed.rows;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

async function completeJob(id) {
  await _db.getPool().query(`
    UPDATE job_queue
    SET status='completed', completed_at=now(), locked_at=NULL, last_error=NULL
    WHERE id=$1
  `, [id]);
}

async function failJob(id, err, { maxAttempts, attempts } = {}) {
  const msg = String((err && err.message) || err || 'error').slice(0, 2000);
  const dead = attempts != null && maxAttempts != null && attempts >= maxAttempts;
  await _db.getPool().query(`
    UPDATE job_queue
    SET status=$2,
        last_error=$3,
        locked_at=NULL,
        run_at = CASE WHEN $2='failed' THEN now() + interval '30 seconds' ELSE run_at END,
        completed_at = CASE WHEN $2='dead' THEN now() ELSE NULL END
    WHERE id=$1
  `, [id, dead ? 'dead' : 'failed', msg]);
  if (dead) logger.error('job_dead', { id, error: msg });
}

async function queueStats() {
  if (!_db.hasDb()) return { ok: true, configured: false };
  const r = await _db.getPool().query(`
    SELECT status, count(*)::int AS n FROM job_queue GROUP BY status
  `);
  const byStatus = Object.fromEntries(r.rows.map((row) => [row.status, row.n]));
  return { ok: true, configured: true, byStatus, workerId: WORKER_ID };
}

module.exports = {
  enqueue,
  claimJobs,
  completeJob,
  failJob,
  queueStats,
  WORKER_ID,
};
