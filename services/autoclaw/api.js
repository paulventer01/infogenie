// AutoClaw integration API — Z.ai endpoint detection + OpenClaw gateway dispatch.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { ENDPOINTS, zaiApiKey, detectZaiEndpoint, configuredEndpointMode } = require('./zai_client');
const { dispatchAgentTask, wakeGateway } = require('./gateway');
const { chatForCategory } = require('../ai/chat_router');

const router = express.Router();

function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[autoclaw]', e.message || e);
      res.json({ ok: false, error: e.message || 'autoclaw_error' });
    }
  };
}

async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

async function _getSettings(tid) {
  if (!_db.hasDb()) return null;
  const r = await _db.getPool().query(`SELECT * FROM autoclaw_settings WHERE tenant_id=$1`, [tid]);
  return r.rows[0] || null;
}

router.get('/status', _route(async (req, res) => {
  const tid = await _tid(req, 'autoclaw:status');
  const key = zaiApiKey();
  const settings = tid != null ? await _getSettings(tid) : null;
  let zai = null;
  if (key) {
    const mode = settings?.endpoint_mode || configuredEndpointMode();
    zai = await detectZaiEndpoint(key, mode === 'auto' ? 'auto' : mode);
  }
  res.json({
    ok: true,
    zai: {
      configured: !!key,
      endpoint: zai,
      productUrl: 'https://autoclaw.z.ai/',
      docsUrl: 'https://docs.openclaw.ai/providers/zai',
    },
    gateway: {
      configured: !!(settings?.gateway_url && settings?.hooks_token),
      enabled: !!settings?.enabled,
      url: settings?.gateway_url ? settings.gateway_url.replace(/\/+$/, '') : null,
    },
    models: ['glm-5.2', 'glm-5-turbo', 'glm-5v-turbo', 'glm-5.1', 'glm-4.7'],
  });
}));

router.get('/endpoints', _route(async (_req, res) => {
  res.json({
    ok: true,
    endpoints: Object.entries(ENDPOINTS).map(([id, e]) => ({ id, ...e })),
    defaultMode: configuredEndpointMode(),
  });
}));

router.post('/detect-endpoint', _route(async (req, res) => {
  const key = zaiApiKey();
  if (!key) return res.json({ ok: false, error: 'ZAI_API_KEY not configured' });
  const mode = req.body?.mode || configuredEndpointMode();
  const detected = await detectZaiEndpoint(key, mode === 'auto' ? 'auto' : mode);
  res.json({ ok: true, detected });
}));

router.get('/config', _route(async (req, res) => {
  const tid = await _tid(req, 'autoclaw:config:get');
  const s = await _getSettings(tid);
  res.json({
    ok: true,
    config: s ? {
      gateway_url: s.gateway_url,
      hooks_token_set: !!s.hooks_token,
      endpoint_mode: s.endpoint_mode || 'auto',
      preferred_model: s.preferred_model || 'glm-5.2',
      enabled: !!s.enabled,
    } : { endpoint_mode: 'auto', preferred_model: 'glm-5.2', enabled: false },
  });
}));

router.put('/config', express.json(), _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'autoclaw:config:put');
  const { gateway_url, hooks_token, endpoint_mode, preferred_model, enabled } = req.body || {};
  const pool = _db.getPool();
  const cur = await _getSettings(tid);
  const url = gateway_url !== undefined ? String(gateway_url || '').trim().slice(0, 500) || null : (cur?.gateway_url || null);
  const token = hooks_token && String(hooks_token).trim() ? String(hooks_token).trim().slice(0, 500) : (cur?.hooks_token || null);
  const mode = endpoint_mode ? String(endpoint_mode).slice(0, 40) : (cur?.endpoint_mode || 'auto');
  const model = preferred_model ? String(preferred_model).slice(0, 64) : (cur?.preferred_model || 'glm-5.2');
  const en = enabled !== undefined ? !!enabled : !!(cur?.enabled);

  await pool.query(`
    INSERT INTO autoclaw_settings (tenant_id, gateway_url, hooks_token, endpoint_mode, preferred_model, enabled, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      gateway_url=EXCLUDED.gateway_url,
      hooks_token=COALESCE(NULLIF(EXCLUDED.hooks_token,''), autoclaw_settings.hooks_token),
      endpoint_mode=EXCLUDED.endpoint_mode,
      preferred_model=EXCLUDED.preferred_model,
      enabled=EXCLUDED.enabled,
      updated_at=now()
  `, [tid, url, token || '', mode, model, en]);

  res.json({ ok: true });
}));

router.post('/chat', express.json(), _route(async (req, res) => {
  const tid = await _tid(req, 'autoclaw:chat');
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: 'messages required' });
  const result = await chatForCategory('analysis', messages, {
    tenantId: tid,
    max_tokens: req.body?.max_tokens || 1200,
    temperature: req.body?.temperature ?? 0.4,
    useAutoclaw: true,
    model: req.body?.model,
  });
  if (!result) return res.json({ ok: false, error: 'no_ai_provider' });
  res.json({ ok: true, ...result });
}));

router.post('/dispatch', express.json(), _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: false, error: 'database not configured' });
  const tid = await _tid(req, 'autoclaw:dispatch');
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });

  const settings = await _getSettings(tid);
  if (!settings?.enabled) return res.json({ ok: false, error: 'autoclaw_disabled', hint: 'Enable AutoClaw in Manage → AutoClaw.' });
  if (!settings.gateway_url || !settings.hooks_token) {
    return res.json({ ok: false, error: 'gateway_not_configured' });
  }

  const model = req.body?.model || settings.preferred_model || 'zai/glm-5.2';
  const result = await dispatchAgentTask({
    gatewayUrl: settings.gateway_url,
    hooksToken: settings.hooks_token,
    message,
    name: req.body?.name || 'InfoGenie',
    model,
    deliver: !!req.body?.deliver,
    timeoutSeconds: req.body?.timeoutSeconds || 90,
  });

  const pool = _db.getPool();
  await pool.query(`
    INSERT INTO autoclaw_tasks (tenant_id, source, task_type, message, status, gateway_url, response, error)
    VALUES ($1,'infogenie',$2,$3,$4,$5,$6,$7)
  `, [
    tid,
    req.body?.task_type || 'agent',
    message.slice(0, 8000),
    result.ok ? 'dispatched' : 'failed',
    settings.gateway_url,
    result.ok ? JSON.stringify(result) : null,
    result.ok ? null : (result.error || 'unknown'),
  ]);

  res.json({ ok: result.ok, dispatch: result });
}));

router.post('/wake', express.json(), _route(async (req, res) => {
  const tid = await _tid(req, 'autoclaw:wake');
  const settings = await _getSettings(tid);
  if (!settings?.gateway_url || !settings.hooks_token) {
    return res.json({ ok: false, error: 'gateway_not_configured' });
  }
  const result = await wakeGateway({
    gatewayUrl: settings.gateway_url,
    hooksToken: settings.hooks_token,
    text: req.body?.text || 'InfoGenie wake ping',
    mode: req.body?.mode || 'now',
  });
  res.json({ ok: result.ok, wake: result });
}));

router.get('/tasks', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, tasks: [] });
  const tid = await _tid(req, 'autoclaw:tasks');
  const r = await _db.getPool().query(`
    SELECT id, task_type, message, status, error, created_at
    FROM autoclaw_tasks WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50
  `, [tid]);
  res.json({ ok: true, tasks: r.rows });
}));

module.exports = router;
