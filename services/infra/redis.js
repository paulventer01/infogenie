// services/infra/redis.js — Optional Redis client (ioredis). Falls back to null.
'use strict';

const { logger } = require('./logger');

let _client = null;
let _initTried = false;
let _available = false;

function redisUrl() {
  return process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || null;
}

function isRedisConfigured() {
  return !!redisUrl();
}

async function getRedis() {
  if (_initTried) return _available ? _client : null;
  _initTried = true;
  const url = redisUrl();
  if (!url) return null;
  try {
    const Redis = require('ioredis');
    _client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    _client.on('error', (e) => logger.warn('redis_error', { error: e.message }));
    if (typeof _client.connect === 'function') {
      await _client.connect();
    }
    await _client.ping();
    _available = true;
    logger.info('redis_connected', { url: url.replace(/:[^:@/]+@/, ':***@') });
    return _client;
  } catch (e) {
    logger.warn('redis_unavailable', { error: e.message });
    _available = false;
    try { if (_client) _client.disconnect(); } catch { /* ignore */ }
    _client = null;
    return null;
  }
}

async function redisGet(key) {
  const c = await getRedis();
  if (!c) return null;
  try { return await c.get(key); } catch { return null; }
}

async function redisSet(key, value, ttlSec) {
  const c = await getRedis();
  if (!c) return false;
  try {
    if (ttlSec) await c.set(key, value, 'EX', ttlSec);
    else await c.set(key, value);
    return true;
  } catch { return false; }
}

async function redisIncr(key, ttlSec) {
  const c = await getRedis();
  if (!c) return null;
  try {
    const n = await c.incr(key);
    if (n === 1 && ttlSec) await c.expire(key, ttlSec);
    return n;
  } catch { return null; }
}

async function redisHealth() {
  if (!isRedisConfigured()) return { configured: false, ok: true, skipped: true };
  try {
    const c = await getRedis();
    if (!c) return { configured: true, ok: false, error: 'connect_failed' };
    const pong = await c.ping();
    return { configured: true, ok: pong === 'PONG', pong };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

async function closeRedis() {
  if (_client) {
    try { await _client.quit(); } catch { try { _client.disconnect(); } catch { /* ignore */ } }
  }
  _client = null;
  _available = false;
  _initTried = false;
}

module.exports = {
  getRedis,
  redisGet,
  redisSet,
  redisIncr,
  redisHealth,
  closeRedis,
  isRedisConfigured,
};
