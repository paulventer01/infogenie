'use strict';

/**
 * Nango OAuth connector foundation.
 * Provides connection listing, session create, and reconnect status for
 * Meta / Google / HubSpot / Shopify — without replacing existing hand-rolled
 * OAuth until NANGO_SECRET_KEY is configured.
 */

const https = require('https');
const { URL } = require('url');
const { present } = require('./env');

const SUPPORTED_INTEGRATIONS = [
  { id: 'meta', provider: 'facebook', product: 'Meta Ads / Facebook', surfaces: ['analyse', 'reach', 'grow'] },
  { id: 'google-ads', provider: 'google-ads', product: 'Google Ads', surfaces: ['analyse', 'reach', 'grow'] },
  { id: 'hubspot', provider: 'hubspot', product: 'HubSpot CRM', surfaces: ['analyse', 'grow'] },
  { id: 'shopify', provider: 'shopify', product: 'Shopify', surfaces: ['analyse', 'grow'] },
];

function nangoHost() {
  return (process.env.NANGO_HOST || 'https://api.nango.dev').replace(/\/$/, '');
}

function nangoConfigured() {
  return present('NANGO_SECRET_KEY');
}

function _request(path, { method = 'GET', body = null, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!nangoConfigured()) {
      return resolve({ ok: false, status: 0, error: 'nango_not_configured', json: null });
    }
    const url = new URL(nangoHost() + path);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Bearer ${process.env.NANGO_SECRET_KEY}`,
      Accept: 'application/json',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* ignore */ }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            error: res.statusCode >= 300 ? `nango_http_${res.statusCode}` : null,
            json,
            body: text.slice(0, 2000),
          });
        });
      },
    );
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message, json: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout', json: null });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function listConnections(connectionId = null) {
  const q = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
  const res = await _request(`/connection${q}`);
  const connections = Array.isArray(res.json)
    ? res.json
    : res.json?.connections || res.json?.data || [];
  return {
    configured: nangoConfigured(),
    ok: res.ok || !nangoConfigured(),
    error: nangoConfigured() ? res.error : null,
    connections: (connections || []).slice(0, 100).map((c) => ({
      id: c.id || c.connection_id,
      connection_id: c.connection_id || c.id,
      provider: c.provider_config_key || c.provider || c.provider_config,
      created_at: c.created_at || c.createdAt,
      end_user: c.end_user || c.metadata?.end_user || null,
      errors: c.errors || c.last_fetched_at === null ? [] : (c.errors || []),
      healthy: !(c.errors && c.errors.length),
    })),
  };
}

async function createConnectSession({ endUserId, endUserEmail, allowedIntegrations = null } = {}) {
  if (!nangoConfigured()) {
    return { ok: false, error: 'nango_not_configured', session: null };
  }
  const integrations = allowedIntegrations || SUPPORTED_INTEGRATIONS.map((i) => i.provider);
  const res = await _request('/connect/sessions', {
    method: 'POST',
    body: {
      end_user: {
        id: String(endUserId || 'anonymous'),
        email: endUserEmail || undefined,
      },
      allowed_integrations: integrations,
    },
  });
  return {
    ok: res.ok,
    error: res.error,
    session: res.json || null,
    connect_link: res.json?.data?.connect_link || res.json?.connect_link || null,
    token: res.json?.data?.token || res.json?.token || null,
  };
}

async function connectionStatusForTenant(tenantKey) {
  const listed = await listConnections(tenantKey || undefined);
  const byProvider = {};
  for (const integ of SUPPORTED_INTEGRATIONS) {
    const matches = (listed.connections || []).filter(
      (c) => String(c.provider || '').toLowerCase().includes(integ.provider.split('-')[0]),
    );
    const unhealthy = matches.filter((m) => m.healthy === false);
    byProvider[integ.id] = {
      product: integ.product,
      surfaces: integ.surfaces,
      nango_provider: integ.provider,
      connections: matches.length,
      healthy: matches.length > 0 && unhealthy.length === 0,
      needs_reconnect: unhealthy.length > 0,
    };
  }

  // Fallback awareness: legacy env tokens still count as "connected" for status UX
  const legacy = {
    meta: present('META_ACCESS_TOKEN'),
    'google-ads': present('GOOGLE_ADS_REFRESH_TOKEN'),
    hubspot: present('HUBSPOT_PRIVATE_APP_TOKEN'),
    shopify: present('SHOPIFY_ADMIN_TOKEN') && present('SHOPIFY_SHOP'),
  };

  return {
    configured: nangoConfigured(),
    host: nangoHost(),
    supported: SUPPORTED_INTEGRATIONS,
    by_provider: byProvider,
    legacy_env_tokens: legacy,
    ok: !listed.error,
    error: listed.error,
    note: nangoConfigured()
      ? 'Nango manages OAuth refresh/reconnect for configured providers.'
      : 'Set NANGO_SECRET_KEY to enable cleaner Meta/Google/HubSpot/Shopify OAuth + reconnect UX.',
  };
}

module.exports = {
  SUPPORTED_INTEGRATIONS,
  nangoConfigured,
  nangoHost,
  listConnections,
  createConnectSession,
  connectionStatusForTenant,
};
