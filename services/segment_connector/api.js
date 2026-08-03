const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[segment]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'segment_error' });
    }
  };
}

function _writeKey() {
  const k = process.env.SEGMENT_WRITE_KEY;
  return k && !/^_DUMMY/i.test(k) ? k : null;
}

router.get('/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'segment:status' });
  let queued = 0;
  let sent = 0;
  if (tid && _db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT
           COUNT(*) FILTER (WHERE status='queued')::int AS queued,
           COUNT(*) FILTER (WHERE status='sent')::int AS sent
         FROM segment_event_log WHERE tenant_id=$1 AND created_at > now() - interval '30 days'`,
        [tid],
      );
      queued = r.rows[0]?.queued || 0;
      sent = r.rows[0]?.sent || 0;
    } catch { /* schema not ready */ }
  }
  res.json({
    ok: true,
    configured: !!_writeKey(),
    queued30d: queued,
    sent30d: sent,
    hint: _writeKey()
      ? 'POST /api/segment/track to forward identify/track events'
      : 'Set SEGMENT_WRITE_KEY to enable live CDP forwarding',
  });
}));

router.post('/track', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'segment:track' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const event = String(req.body?.event || req.body?.event_name || '').trim();
  if (!event) return _err(res, 400, 'event required');
  const userId = req.body?.userId || req.body?.user_id || null;
  const anonymousId = req.body?.anonymousId || req.body?.anonymous_id || `anon_${tid}`;
  const properties = req.body?.properties || {};

  const id = 'seg_' + crypto.randomBytes(6).toString('hex');
  const key = _writeKey();
  let status = 'queued';
  let response = null;

  if (key) {
    try {
      const body = {
        userId: userId || undefined,
        anonymousId,
        event,
        properties: { ...properties, tenant_id: tid, source: 'infogenie' },
        timestamp: new Date().toISOString(),
        writeKey: key,
      };
      const r = await fetch('https://api.segment.io/v1/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
        },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      status = r.ok ? 'sent' : 'failed';
      response = { status: r.status, body: text.slice(0, 500) };
    } catch (e) {
      status = 'failed';
      response = { error: e.message };
    }
  }

  if (_db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO segment_event_log (id, tenant_id, event_name, user_id, anonymous_id, properties, status, response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, tid, event, userId, anonymousId, JSON.stringify(properties), status, JSON.stringify(response || {})],
      );
    } catch (e) {
      console.warn('[segment] log failed:', e.message);
    }
  }

  res.json({
    ok: status !== 'failed',
    id,
    status,
    dryRun: !key,
    response,
  });
}));

router.get('/history', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'segment:history' });
  if (!tid || !_db.hasDb()) return res.json({ ok: true, events: [] });
  const r = await _db.getPool().query(
    `SELECT id, event_name, user_id, status, created_at
     FROM segment_event_log WHERE tenant_id=$1
     ORDER BY created_at DESC LIMIT 50`,
    [tid],
  ).catch(() => ({ rows: [] }));
  res.json({ ok: true, events: r.rows });
}));

module.exports = router;
