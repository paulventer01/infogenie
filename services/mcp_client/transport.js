/**
 * MCP client transports: builtin · REST (InfoGenie-shaped) · JSON-RPC over HTTP.
 */

const { listBuiltinTools, callBuiltin } = require('./builtins');

function _headers(server) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (server.auth_header) {
    const [k, ...rest] = String(server.auth_header).split(':');
    if (rest.length) h[k.trim()] = rest.join(':').trim();
    else h.Authorization = String(server.auth_header).trim();
  } else if (server.api_key) {
    h.Authorization = `Bearer ${server.api_key}`;
  }
  return h;
}

function _resolveUrl(server, pathSuffix, { origin } = {}) {
  let base = String(server.base_url || '').replace(/\/+$/, '');
  if (server.loopback || base.startsWith('/')) {
    const o = origin || process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:' + (process.env.PORT || 8000);
    base = o.replace(/\/+$/, '') + (base.startsWith('/') ? base : '/' + base);
  }
  if (!pathSuffix) return base;
  if (base.endsWith('/tools') && pathSuffix === '/tools') return base;
  if (base.endsWith('/call') && pathSuffix === '/call') return base;
  // If base already ends with /mcp, append path
  return base + pathSuffix;
}

async function listTools(server, ctx = {}) {
  if (server.transport === 'builtin') {
    return { ok: true, tools: await listBuiltinTools(server.builtin), transport: 'builtin' };
  }

  if (server.transport === 'jsonrpc') {
    const url = _resolveUrl(server, '', ctx);
    const resp = await fetch(url, {
      method: 'POST',
      headers: _headers(server),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await resp.json().catch(() => ({}));
    if (j.error) return { ok: false, error: j.error.message || JSON.stringify(j.error), tools: [] };
    const tools = j.result?.tools || j.tools || [];
    return { ok: true, tools, transport: 'jsonrpc', raw_status: resp.status };
  }

  // REST default
  const url = _resolveUrl(server, '/tools', ctx);
  const resp = await fetch(url, {
    method: 'GET',
    headers: _headers(server),
    signal: AbortSignal.timeout(20000),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, error: j.error?.message || j.error || `HTTP ${resp.status}`, tools: [] };
  return {
    ok: true,
    tools: j.tools || [],
    protocol: j.protocol,
    version: j.version,
    name: j.name,
    transport: 'rest',
  };
}

async function callTool(server, name, args = {}, ctx = {}) {
  if (server.transport === 'builtin') {
    const data = await callBuiltin(server.builtin, name, args, { tenantId: ctx.tenantId });
    return {
      ok: true,
      content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
      isError: false,
      transport: 'builtin',
    };
  }

  if (server.transport === 'jsonrpc') {
    const url = _resolveUrl(server, '', ctx);
    const resp = await fetch(url, {
      method: 'POST',
      headers: _headers(server),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await resp.json().catch(() => ({}));
    if (j.error) {
      return { ok: false, isError: true, error: j.error.message || JSON.stringify(j.error), content: [] };
    }
    const result = j.result || j;
    return {
      ok: true,
      content: result.content || [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !!result.isError,
      transport: 'jsonrpc',
    };
  }

  const url = _resolveUrl(server, '/call', ctx);
  const resp = await fetch(url, {
    method: 'POST',
    headers: _headers(server),
    body: JSON.stringify({ name, arguments: args }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await resp.json().catch(() => ({}));
  if (j.error && !j.content) {
    const msg = typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error);
    return { ok: false, isError: true, error: msg, content: [] };
  }
  return {
    ok: !j.isError,
    content: j.content || [{ type: 'text', text: JSON.stringify(j, null, 2) }],
    isError: !!j.isError,
    transport: 'rest',
  };
}

module.exports = { listTools, callTool, _resolveUrl };
