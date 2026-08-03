// services/health/api.js — Liveness (/health) and readiness (/ready).
'use strict';

const express = require('express');
const _db = require('../../db');
const { redisHealth } = require('../infra/redis');
const { objectStorageHealth } = require('../infra/object_storage');
const { allSnapshots } = require('../infra/circuit_breaker');
const { queueStats } = require('../jobs/queue');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'alive', ts: new Date().toISOString() });
});

router.get('/ready', async (_req, res) => {
  const checks = {};
  let ready = true;

  // Postgres
  try {
    if (!_db.hasDb()) {
      checks.postgres = { ok: false, error: 'DATABASE_URL unset' };
      ready = false;
    } else {
      const r = await _db.getPool().query('SELECT 1 AS ok');
      checks.postgres = { ok: r.rows[0]?.ok === 1 };
      if (!checks.postgres.ok) ready = false;
    }
  } catch (e) {
    checks.postgres = { ok: false, error: e.message };
    ready = false;
  }

  checks.redis = await redisHealth();
  // Redis is optional — only fail ready if configured but down
  if (checks.redis.configured && !checks.redis.ok) ready = false;

  checks.objectStorage = await objectStorageHealth();
  if (checks.objectStorage.configured && !checks.objectStorage.ok) {
    // Degraded but still ready for core API
    checks.objectStorage.degraded = true;
  }

  try { checks.jobQueue = await queueStats(); }
  catch (e) { checks.jobQueue = { ok: false, error: e.message }; }

  checks.circuits = allSnapshots();

  res.status(ready ? 200 : 503).json({
    ok: ready,
    status: ready ? 'ready' : 'not_ready',
    ts: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
