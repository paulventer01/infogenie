'use strict';

/**
 * Checkly / Better Stack integration.
 * - Local + external synthetic check definitions
 * - Optional live pull from Checkly API or Better Stack uptime API
 * - Fail-open when credentials are missing
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { present } = require('./env');
const { CHECK_DEFS, publicBaseUrl } = require('./check_defs');

function _request(url, { method = 'GET', headers = {}, timeoutMs = 8000, body = null } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return resolve({ ok: false, status: 0, error: e.message, ms: 0, body: '' });
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const started = Date.now();
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8').slice(0, 4000);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            ms: Date.now() - started,
            body: text,
            error: null,
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, ms: Date.now() - started, body: '', error: 'timeout' });
    });
    req.on('error', (e) => {
      resolve({ ok: false, status: 0, ms: Date.now() - started, body: '', error: e.message });
    });
    if (body) req.write(body);
    req.end();
  });
}

async function runLocalProbes(baseOverride = null) {
  const port = process.env.EXPRESS_PORT || process.env.PORT || '8000';
  const nextPort = process.env.NEXT_PORT || '5000';
  const apiBase = `http://127.0.0.1:${port}`;
  const webBase = baseOverride || publicBaseUrl() || `http://127.0.0.1:${nextPort}`;

  const results = [];
  for (const def of CHECK_DEFS) {
    const isApi = def.path.startsWith('/api/');
    const base = isApi ? apiBase : webBase;
    const url = base.replace(/\/$/, '') + def.path;
    const res = await _request(url, { method: def.method, timeoutMs: 6000 });
    const statusOk = def.expectStatus.includes(res.status) || (res.ok && def.expectStatus.includes(200));
    let bodyOk = true;
    if (statusOk && Array.isArray(def.expectBodyIncludes) && def.expectBodyIncludes.length) {
      const lower = String(res.body || '').toLowerCase();
      bodyOk = def.expectBodyIncludes.every((s) => lower.includes(String(s).toLowerCase()));
    }
    results.push({
      id: def.id,
      name: def.name,
      path: def.path,
      url,
      ok: !!(statusOk && bodyOk && !res.error),
      status: res.status,
      ms: res.ms,
      error: res.error || (!statusOk ? `unexpected_status_${res.status}` : !bodyOk ? 'body_mismatch' : null),
      critical: !!def.critical,
      source: 'local_probe',
    });
  }
  return results;
}

async function fetchChecklyRemote() {
  const key = process.env.CHECKLY_API_KEY;
  const accountId = process.env.CHECKLY_ACCOUNT_ID;
  if (!key) return { configured: false, checks: [], error: null };

  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  if (accountId) headers['X-Checkly-Account'] = accountId;

  const res = await _request('https://api.checklyhq.com/v1/checks', { headers, timeoutMs: 10000 });
  if (!res.ok) {
    return { configured: true, checks: [], error: res.error || `checkly_http_${res.status}` };
  }
  let parsed = [];
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return { configured: true, checks: [], error: 'checkly_parse_error' };
  }
  const list = Array.isArray(parsed) ? parsed : parsed.data || [];
  return {
    configured: true,
    checks: list.slice(0, 50).map((c) => ({
      id: String(c.id || c.name),
      name: c.name || c.id,
      ok: c.activated !== false,
      status: c.activated === false ? 0 : 200,
      ms: null,
      error: c.activated === false ? 'deactivated' : null,
      critical: true,
      source: 'checkly_api',
    })),
    error: null,
  };
}

async function fetchBetterStackRemote() {
  const key = process.env.BETTERSTACK_API_KEY || process.env.BETTER_UPTIME_API_TOKEN;
  if (!key) return { configured: false, monitors: [], error: null };
  const res = await _request('https://uptime.betterstack.com/api/v2/monitors', {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    timeoutMs: 10000,
  });
  if (!res.ok) {
    return { configured: true, monitors: [], error: res.error || `betterstack_http_${res.status}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return { configured: true, monitors: [], error: 'betterstack_parse_error' };
  }
  const data = parsed.data || [];
  return {
    configured: true,
    monitors: data.slice(0, 50).map((m) => {
      const attrs = m.attributes || m;
      const status = String(attrs.status || attrs.pronounceable_name || '').toLowerCase();
      const up = status.includes('up') || attrs.status === 'valid' || attrs.paused === false;
      return {
        id: String(m.id || attrs.pronounceable_name),
        name: attrs.pronounceable_name || attrs.url || m.id,
        ok: up,
        status: up ? 200 : 503,
        ms: null,
        error: up ? null : status || 'down',
        critical: true,
        source: 'betterstack_api',
      };
    }),
    error: null,
  };
}

async function collectSyntheticsStatus() {
  const provider = present('CHECKLY_API_KEY')
    ? 'checkly'
    : present('BETTERSTACK_API_KEY') || present('BETTER_UPTIME_API_TOKEN')
      ? 'betterstack'
      : 'local';

  const local = await runLocalProbes();
  let remote = { configured: false, checks: [], error: null };
  if (provider === 'checkly') {
    const r = await fetchChecklyRemote();
    remote = { configured: r.configured, checks: r.checks, error: r.error };
  } else if (provider === 'betterstack') {
    const r = await fetchBetterStackRemote();
    remote = { configured: r.configured, checks: r.monitors, error: r.error };
  }

  const merged = [...local];
  for (const c of remote.checks || []) {
    if (!merged.some((m) => m.id === c.id || m.name === c.name)) merged.push(c);
  }

  const failed = merged.filter((c) => !c.ok);
  const criticalFailed = failed.filter((c) => c.critical);
  const externalConfigured = !!(present('CHECKLY_API_KEY') || present('BETTERSTACK_API_KEY') || present('BETTER_UPTIME_API_TOKEN'));

  return {
    provider,
    external_configured: externalConfigured,
    public_base_url: publicBaseUrl(),
    definitions: CHECK_DEFS.map((d) => ({ id: d.id, name: d.name, path: d.path, critical: d.critical })),
    checks: merged,
    ok: criticalFailed.length === 0,
    counts: {
      total: merged.length,
      failed: failed.length,
      critical_failed: criticalFailed.length,
    },
    remote_error: remote.error || null,
    note: externalConfigured
      ? `External ${provider} credentials present; local journey probes also run each scan.`
      : 'Local journey probes active. Set CHECKLY_API_KEY (or BETTERSTACK_API_KEY) for multi-region external synthetics.',
  };
}

module.exports = {
  CHECK_DEFS,
  runLocalProbes,
  fetchChecklyRemote,
  fetchBetterStackRemote,
  collectSyntheticsStatus,
};
