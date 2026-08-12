/**
 * MCP Client API — InfoGenie as an MCP *client* connecting to external/builtin servers.
 */
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const store = require('./store');
const { listTools, callTool } = require('./transport');
const { PRESET_CATALOG } = require('./presets');
// PRESET_CATALOG also used by _withFreshAuth for rotating platform keys.

const _safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  if (!_db.hasDb()) return 1;
  return null;
}

function _origin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8000}`;
}

router.get('/status', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:status');
  const servers = tid ? await store.listServers(tid) : [];
  res.json({
    ok: true,
    ready: true,
    role: 'mcp_client',
    note: 'Connect to official/community/builtin MCP-style servers; list tools and call them.',
    servers_count: servers.length,
    presets: PRESET_CATALOG.length,
  });
}));

router.get('/presets', _safe(async (_req, res) => {
  res.json({ ok: true, presets: PRESET_CATALOG });
}));

router.get('/servers', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:servers');
  if (!tid) return _err(res, 400, 'no_tenant');
  if (req.query.seed === '1') await store.seedDefaults(tid);
  const servers = await store.listServers(tid);
  res.json({ ok: true, servers });
}));

router.post('/servers', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:add');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const server = await store.addServer(tid, req.body || {});
    res.json({ ok: true, server });
  } catch (e) {
    if (e && e.code === 'auth_missing') return _err(res, 400, e.message);
    throw e;
  }
}));

router.post('/servers/seed', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:seed');
  if (!tid) return _err(res, 400, 'no_tenant');
  const servers = await store.seedDefaults(tid);
  res.json({ ok: true, servers });
}));

router.patch('/servers/:id', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:patch');
  if (!tid) return _err(res, 400, 'no_tenant');
  const server = await store.updateServer(tid, req.params.id, req.body || {});
  if (!server) return _err(res, 404, 'not found');
  res.json({ ok: true, server });
}));

router.delete('/servers/:id', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  const ok = await store.deleteServer(tid, req.params.id);
  if (!ok) return _err(res, 404, 'not found');
  res.json({ ok: true });
}));

router.get('/servers/:id/tools', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:tools');
  if (!tid) return _err(res, 400, 'no_tenant');
  const server = await store.getServer(tid, req.params.id);
  if (!server) return _err(res, 404, 'not found');
  let raw = await store.getServerRaw(tid, req.params.id);
  // Refresh header auth from platform env when the row was stored without a token
  // or the platform key was rotated after connect.
  raw = _withFreshAuth(raw);
  const result = await listTools(raw, { origin: _origin(req), tenantId: tid });
  res.json({ ok: result.ok !== false, ...result, server_id: server.id, server_name: server.name });
}));

router.post('/servers/:id/call', _safe(async (req, res) => {
  const tid = await _tid(req, 'mcp-client:call');
  if (!tid) return _err(res, 400, 'no_tenant');
  let raw = await store.getServerRaw(tid, req.params.id);
  if (!raw) return _err(res, 404, 'not found');
  if (raw.enabled === false) return _err(res, 400, 'server disabled');
  raw = _withFreshAuth(raw);
  const name = req.body?.name || req.body?.tool;
  if (!name) return _err(res, 400, 'name required');
  const args = req.body?.arguments || req.body?.args || {};
  try {
    const result = await callTool(raw, name, args, { origin: _origin(req), tenantId: tid });
    res.json({ ok: result.ok !== false, ...result, server_id: raw.id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, isError: true });
  }
}));

function _withFreshAuth(raw) {
  if (!raw) return raw;
  const presetId = raw.meta?.preset_id;
  const preset = presetId ? PRESET_CATALOG.find((p) => p.id === presetId) : null;
  if (!preset?.authEnv) return raw;
  let token = '';
  try {
    const pk = require('../credentials/platform_keys');
    token = pk.resolvePlatformKey(preset.authEnv) || process.env[preset.authEnv] || '';
  } catch {
    token = process.env[preset.authEnv] || '';
  }
  if (!token) return raw;
  const headerName = preset.authHeaderName || 'Authorization';
  const auth_header = headerName.toLowerCase() === 'authorization'
    ? `Bearer ${token}`
    : `${headerName}:${token}`;
  return { ...raw, auth_header };
}

router._resetMem = store._resetMem;
module.exports = router;
