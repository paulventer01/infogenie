'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { ensureAutomationBridgeSchema } = require('./schema');
const { fireEvent, runInboundAction, listCatalog, logDelivery, _safeUrl } = require('./dispatch');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[automation-bridge]', e.message);
    if (!res.headersSent) _err(res, e.status || 500, e.message || 'Internal server error');
  });
}

ensureAutomationBridgeSchema().catch((e) => console.warn('[automation-bridge] schema:', e.message));

router.get('/catalog', _safe(async (_req, res) => {
  res.json({ ok: true, ...listCatalog() });
}));

router.get('/targets', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:targets' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  await ensureAutomationBridgeSchema();
  const r = await _db.getPool().query(
    `SELECT id, provider, name, target_url, triggers, enabled, created_at, updated_at
     FROM automation_bridge_targets WHERE tenant_id=$1 ORDER BY id DESC`,
    [tid],
  );
  res.json({ ok: true, items: r.rows });
}));

router.post('/targets', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:add_target' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  await ensureAutomationBridgeSchema();

  const provider = String(req.body?.provider || 'zapier').toLowerCase().slice(0, 40);
  const name = String(req.body?.name || `${provider} webhook`).slice(0, 120);
  const target_url = _safeUrl(req.body?.target_url || req.body?.url);
  if (!target_url) return _err(res, 400, 'valid https target_url required');
  const secret = req.body?.secret ? String(req.body.secret).slice(0, 200) : null;
  let triggers = req.body?.triggers;
  if (!Array.isArray(triggers)) triggers = ['*'];
  triggers = triggers.map((t) => String(t).slice(0, 80)).slice(0, 40);

  const r = await _db.getPool().query(
    `INSERT INTO automation_bridge_targets
       (tenant_id, provider, name, target_url, secret, triggers, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id, provider, name, target_url, triggers, enabled`,
    [tid, provider, name, target_url, secret, JSON.stringify(triggers)],
  );
  res.json({ ok: true, item: r.rows[0] });
}));

router.patch('/targets/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:patch_target' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const fields = [];
  const params = [id, tid];
  if (typeof req.body?.enabled === 'boolean') {
    params.push(req.body.enabled);
    fields.push(`enabled=$${params.length}`);
  }
  if (req.body?.name) {
    params.push(String(req.body.name).slice(0, 120));
    fields.push(`name=$${params.length}`);
  }
  if (req.body?.target_url || req.body?.url) {
    const u = _safeUrl(req.body.target_url || req.body.url);
    if (!u) return _err(res, 400, 'invalid url');
    params.push(u);
    fields.push(`target_url=$${params.length}`);
  }
  if (Array.isArray(req.body?.triggers)) {
    params.push(JSON.stringify(req.body.triggers.map((t) => String(t).slice(0, 80)).slice(0, 40)));
    fields.push(`triggers=$${params.length}`);
  }
  if (!fields.length) return _err(res, 400, 'nothing to update');
  fields.push('updated_at=NOW()');
  await _db.getPool().query(
    `UPDATE automation_bridge_targets SET ${fields.join(', ')} WHERE id=$1 AND tenant_id=$2`,
    params,
  );
  res.json({ ok: true });
}));

router.delete('/targets/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:del_target' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = parseInt(req.params.id, 10);
  await _db.getPool().query(
    `DELETE FROM automation_bridge_targets WHERE id=$1 AND tenant_id=$2`,
    [id, tid],
  );
  res.json({ ok: true });
}));

router.get('/inbound', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:inbound' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  await ensureAutomationBridgeSchema();
  let r = await _db.getPool().query(
    `SELECT id, token, name, enabled, created_at FROM automation_bridge_inbound WHERE tenant_id=$1 ORDER BY id DESC`,
    [tid],
  );
  if (!r.rows.length) {
    const token = crypto.randomBytes(24).toString('hex');
    await _db.getPool().query(
      `INSERT INTO automation_bridge_inbound (tenant_id, token, name) VALUES ($1,$2,'Default inbound')`,
      [tid, token],
    );
    r = await _db.getPool().query(
      `SELECT id, token, name, enabled, created_at FROM automation_bridge_inbound WHERE tenant_id=$1 ORDER BY id DESC`,
      [tid],
    );
  }
  const base = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || '').replace(/\/$/, '') || '';
  const items = r.rows.map((row) => ({
    ...row,
    webhook_path: `/api/automation-bridge/hooks/${row.token}`,
    webhook_url: base ? `${base}/api/automation-bridge/hooks/${row.token}` : null,
  }));
  res.json({ ok: true, items });
}));

router.post('/inbound/rotate', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:rotate' });
  if (!tid) return _err(res, 400, 'no_tenant');
  await ensureAutomationBridgeSchema();
  const token = crypto.randomBytes(24).toString('hex');
  await _db.getPool().query(`DELETE FROM automation_bridge_inbound WHERE tenant_id=$1`, [tid]);
  const r = await _db.getPool().query(
    `INSERT INTO automation_bridge_inbound (tenant_id, token, name) VALUES ($1,$2,'Default inbound') RETURNING id, token, name, enabled`,
    [tid, token],
  );
  res.json({ ok: true, item: r.rows[0] });
}));

router.post('/test-fire', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:test' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const event = String(req.body?.event || 'alert.raised');
  const payload = req.body?.data && typeof req.body.data === 'object'
    ? req.body.data
    : { message: 'InfoGenie automation bridge test event', severity: 'info' };
  const result = await fireEvent(tid, event, payload);
  res.json({ ok: true, event, ...result });
}));

router.get('/deliveries', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'automation_bridge:deliveries' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  const r = await _db.getPool().query(
    `SELECT id, direction, provider, event_type, status, created_at
     FROM automation_bridge_deliveries
     WHERE tenant_id=$1
     ORDER BY created_at DESC LIMIT 40`,
    [tid],
  );
  res.json({ ok: true, items: r.rows });
}));

/** Public inbound webhook for Zapier / n8n / Make — authenticated by token. */
router.post('/hooks/:token', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  await ensureAutomationBridgeSchema();
  const token = String(req.params.token || '');
  const row = await _db.getPool().query(
    `SELECT id, tenant_id, enabled FROM automation_bridge_inbound WHERE token=$1`,
    [token],
  );
  if (!row.rows.length || !row.rows[0].enabled) return _err(res, 404, 'unknown_webhook');
  const tid = row.rows[0].tenant_id;

  const action = String(req.body?.action || req.query?.action || 'webhook.echo');
  const params = (req.body?.params && typeof req.body.params === 'object')
    ? req.body.params
    : (req.body || {});

  try {
    const result = await runInboundAction(tid, action, params);
    await logDelivery(tid, {
      direction: 'inbound',
      provider: 'webhook',
      event_type: action,
      status: 'ok',
      payload: { action, params },
      response_text: JSON.stringify(result).slice(0, 500),
    });
    res.json({ ok: true, action, result });
  } catch (e) {
    await logDelivery(tid, {
      direction: 'inbound',
      provider: 'webhook',
      event_type: action,
      status: 'error',
      payload: { action, params },
      response_text: e.message,
    });
    throw e;
  }
}));

module.exports = { router, fireEvent };
