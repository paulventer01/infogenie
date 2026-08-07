// OpenClaw / AutoClaw Gateway webhook client.
// Dispatches tasks to a running AutoClaw/OpenClaw gateway via POST /hooks/agent.
// https://docs.openclaw.ai/gateway/configuration-reference

async function dispatchAgentTask({ gatewayUrl, hooksToken, message, opts = {} }) {
  if (!gatewayUrl || !hooksToken) {
    return { ok: false, error: 'gateway_not_configured', hint: 'Set AutoClaw Gateway URL and hooks token in Manage → AutoClaw.' };
  }
  const base = String(gatewayUrl).replace(/\/+$/, '');
  const path = (opts.path || '/hooks/agent').startsWith('/') ? opts.path || '/hooks/agent' : '/' + (opts.path || 'hooks/agent');
  const url = base + path;

  const body = {
    message: String(message || '').slice(0, 12000),
    name: opts.name || 'InfoGenie',
    deliver: opts.deliver === true,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.thinking ? { thinking: opts.thinking } : {}),
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + hooksToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min((opts.timeoutSeconds || 60) * 1000, 120000)),
    });
    const ct = resp.headers.get('content-type') || '';
    let json = {};
    if (ct.includes('application/json')) json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return {
        ok: false,
        error: json.error || `gateway_http_${resp.status}`,
        status: resp.status,
        body: json,
      };
    }
    return { ok: true, status: resp.status, ...json };
  } catch (e) {
    return { ok: false, error: e.message || 'gateway_unreachable' };
  }
}

async function wakeGateway({ gatewayUrl, hooksToken, text, mode = 'now' }) {
  if (!gatewayUrl || !hooksToken) return { ok: false, error: 'gateway_not_configured' };
  const base = String(gatewayUrl).replace(/\/+$/, '');
  try {
    const resp = await fetch(base + '/hooks/wake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + hooksToken,
      },
      body: JSON.stringify({ text: String(text || '').slice(0, 2000), mode }),
      signal: AbortSignal.timeout(15000),
    });
    const json = resp.headers.get('content-type')?.includes('json') ? await resp.json().catch(() => ({})) : {};
    return { ok: resp.ok, status: resp.status, ...json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { dispatchAgentTask, wakeGateway };
