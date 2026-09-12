/**
 * MCP client transports: builtin · REST · JSON-RPC · Streamable HTTP.
 */

const { listBuiltinTools, callBuiltin } = require('./builtins');

function _headers(server, extra = {}) {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...extra,
  };
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
  return base + pathSuffix;
}

function _parseJsonRpcBody(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  // Streamable HTTP may return SSE: event: message\ndata: {...}\n\n
  if (raw.startsWith('event:') || raw.includes('\ndata:')) {
    const dataLines = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try { return JSON.parse(dataLines[i]); } catch { /* continue */ }
    }
  }
  try { return JSON.parse(raw); } catch { return { raw }; }
}

async function _rpc(server, method, params, ctx = {}, { notification = false } = {}) {
  const url = _resolveUrl(server, '', ctx);
  const headers = _headers(server, ctx.sessionId ? { 'mcp-session-id': ctx.sessionId } : {});
  const body = notification
    ? { jsonrpc: '2.0', method, params: params || {} }
    : { jsonrpc: '2.0', id: ctx.rpcId || Date.now() % 1e9, method, params: params || {} };
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ctx.timeoutMs || 60000),
  });
  const sessionId = resp.headers.get('mcp-session-id') || ctx.sessionId || null;
  const text = await resp.text();
  const j = _parseJsonRpcBody(text);
  return { resp, j, sessionId, text };
}

async function _ensureStreamableSession(server, ctx = {}) {
  const init = await _rpc(server, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'InfoGenie', version: '1.0.0' },
  }, { ...ctx, timeoutMs: 20000, rpcId: 1 });
  if (init.j.error) {
    return { ok: false, error: init.j.error.message || JSON.stringify(init.j.error), sessionId: null };
  }
  const sessionId = init.sessionId;
  // Best-effort notification (some servers return 202 with empty body).
  try {
    await _rpc(server, 'notifications/initialized', {}, { ...ctx, sessionId, timeoutMs: 10000 }, { notification: true });
  } catch { /* ignore */ }
  return { ok: true, sessionId, serverInfo: init.j.result?.serverInfo || null };
}

async function listTools(server, ctx = {}) {
  if (server.transport === 'builtin') {
    return { ok: true, tools: await listBuiltinTools(server.builtin), transport: 'builtin' };
  }

  if (server.transport === 'streamable' || server.transport === 'jsonrpc') {
    let sessionId = null;
    if (server.transport === 'streamable') {
      const sess = await _ensureStreamableSession(server, ctx);
      if (!sess.ok) return { ok: false, error: sess.error, tools: [], transport: 'streamable' };
      sessionId = sess.sessionId;
    }
    const { resp, j } = await _rpc(server, 'tools/list', {}, { ...ctx, sessionId, timeoutMs: 30000, rpcId: 2 });
    if (j.error) return { ok: false, error: j.error.message || JSON.stringify(j.error), tools: [], transport: server.transport };
    const tools = j.result?.tools || j.tools || [];
    return {
      ok: true,
      tools,
      transport: server.transport,
      raw_status: resp.status,
      serverInfo: j.result?.serverInfo || undefined,
    };
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

  if (server.transport === 'streamable' || server.transport === 'jsonrpc') {
    let sessionId = null;
    if (server.transport === 'streamable') {
      const sess = await _ensureStreamableSession(server, ctx);
      if (!sess.ok) return { ok: false, isError: true, error: sess.error, content: [] };
      sessionId = sess.sessionId;
    }
    const { j } = await _rpc(server, 'tools/call', { name, arguments: args }, {
      ...ctx, sessionId, timeoutMs: 60000, rpcId: 3,
    });
    if (j.error) {
      return { ok: false, isError: true, error: j.error.message || JSON.stringify(j.error), content: [] };
    }
    const result = j.result || j;
    return {
      ok: true,
      content: result.content || [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !!result.isError,
      transport: server.transport,
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
