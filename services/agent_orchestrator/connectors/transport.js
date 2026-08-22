'use strict';

// Injectable HTTPS transport for research connectors.
// Callers must pass a transport in tests. The default sink uses safe_url
// (SSRF + DNS pin + no automatic redirects). Tokens never enter logs.

const https = require('https');
const { URL } = require('url');
const { assertSafeHttpsUrl, assertSafeRedirect, assertPinnedAddresses } = require('../../security/safe_url');
const { connectorErrorPage } = require('../research_errors');

const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 2;
const HOST_ALLOW = Object.freeze({
  meta_research: Object.freeze(['graph.facebook.com']),
  google_research: Object.freeze(['adstransparency.google.com']),
  tiktok_research: Object.freeze(['business-api.tiktok.com']),
});

function hostAllowed(connectorId, hostname) {
  const allow = HOST_ALLOW[connectorId] || [];
  return allow.includes(String(hostname || '').toLowerCase());
}

function parseRetryAfter(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, 30_000);
  const when = Date.parse(s);
  if (Number.isNaN(when)) return null;
  return Math.min(Math.max(0, when - Date.now()), 30_000);
}

function header(headers, name) {
  if (!headers) return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}

function rateLimitFrom(headers) {
  const limit = Number(header(headers, 'x-ratelimit-limit'));
  const remaining = Number(header(headers, 'x-ratelimit-remaining'));
  const reset = header(headers, 'x-ratelimit-reset');
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || reset == null) return null;
  const resetAt = /^\d+$/.test(String(reset))
    ? new Date(Number(reset) * 1000).toISOString()
    : new Date(reset).toISOString();
  if (Number.isNaN(Date.parse(resetAt))) return null;
  return { limit: Math.max(0, Math.floor(limit)), remaining: Math.max(0, Math.floor(remaining)), reset_at: resetAt };
}

function requestOnce({ url, method, headers, body, signal, timeoutMs, addresses }) {
  const u = new URL(url);
  const ip = addresses[0];
  const host = u.hostname.includes(':') ? `[${ip}]` : ip;
  return new Promise((resolve, reject) => {
    const req = https.request({
      host,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method: method || 'GET',
      headers: { ...(headers || {}), Host: u.hostname },
      servername: u.hostname,
      timeout: timeoutMs || REQUEST_TIMEOUT_MS,
      setHost: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => {
        if (chunks.length < 32) chunks.push(c);
      });
      res.on('end', () => {
        let json = null;
        const raw = Buffer.concat(chunks).toString('utf8');
        try { json = raw ? JSON.parse(raw) : null; } catch (_) { json = null; }
        resolve({
          status: res.statusCode || 0,
          headers: res.headers || {},
          json,
          location: res.headers && res.headers.location,
        });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (signal) {
      if (signal.aborted) {
        req.destroy();
        reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
        return;
      }
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
      }, { once: true });
    }
    if (body) req.write(body);
    req.end();
  });
}

async function defaultTransport(opts) {
  const connectorId = opts.connectorId;
  let current = String(opts.url || '');
  let hops = 0;
  while (hops <= MAX_REDIRECTS) {
    const check = hops === 0
      ? await assertSafeHttpsUrl(current)
      : await assertSafeRedirect(current);
    if (!check.ok) {
      return { ok: false, errorPage: connectorErrorPage('policy_rejection', 'unsafe_url') };
    }
    if (!hostAllowed(connectorId, check.hostname)) {
      return { ok: false, errorPage: connectorErrorPage('policy_rejection', 'host_not_allowlisted') };
    }
    const pin = await assertPinnedAddresses(check.hostname, check.addresses);
    if (!pin.ok) {
      return { ok: false, errorPage: connectorErrorPage('policy_rejection', 'unsafe_url') };
    }
    let res;
    try {
      res = await requestOnce({
        url: check.url || current,
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        addresses: pin.addresses,
      });
    } catch (err) {
      if (err && err.code === 'cancelled') {
        return { ok: false, errorPage: connectorErrorPage('terminal', 'cancelled') };
      }
      return { ok: false, errorPage: connectorErrorPage('transient', 'provider_unavailable') };
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      hops += 1;
      if (hops > MAX_REDIRECTS) {
        return { ok: false, errorPage: connectorErrorPage('policy_rejection', 'too_many_redirects') };
      }
      current = res.location;
      continue;
    }
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      json: res.json,
      retryAfterMs: parseRetryAfter(header(res.headers, 'retry-after')),
      rate_limit: rateLimitFrom(res.headers),
    };
  }
  return { ok: false, errorPage: connectorErrorPage('policy_rejection', 'too_many_redirects') };
}

function createFixtureTransport(handler) {
  return async (opts) => handler(opts);
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  MAX_REDIRECTS,
  HOST_ALLOW,
  hostAllowed,
  parseRetryAfter,
  rateLimitFrom,
  defaultTransport,
  createFixtureTransport,
};
