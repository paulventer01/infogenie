/**
 * Minimal Google Search Console client (service-account).
 * Fail-open: callers treat null/empty as “use demo / skip live”.
 */

let _tokenCache = null;
let _tokenExp = 0;

function hasGscCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return !!(raw && String(raw).trim() && !/^_DUMMY/i.test(raw));
}

async function getGoogleSAToken(scopes) {
  const now = Date.now();
  if (_tokenCache && _tokenCache._scopes === scopes && now < _tokenExp) {
    return _tokenCache.token;
  }
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  if (!String(raw).trim().startsWith('{')) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (_) {}
  }
  const sa = JSON.parse(raw);
  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: scopes,
    aud: 'https://oauth2.googleapis.com/token',
    exp: iat + 3600,
    iat,
  })).toString('base64url');
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key, 'base64url');
  const jwt = `${signingInput}.${sig}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('SA token exchange failed: ' + (j.error_description || JSON.stringify(j)));
  _tokenCache = { token: j.access_token, _scopes: scopes };
  _tokenExp = Date.now() + ((j.expires_in || 3600) - 120) * 1000;
  return j.access_token;
}

async function listSites() {
  if (!hasGscCredentials()) return { ok: false, configured: false, sites: [] };
  try {
    const token = await getGoogleSAToken('https://www.googleapis.com/auth/webmasters.readonly');
    const r = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j.error) return { ok: false, configured: true, error: j.error.message, sites: [] };
    return {
      ok: true,
      configured: true,
      sites: (j.siteEntry || []).map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel })),
    };
  } catch (e) {
    return { ok: false, configured: true, error: e.message, sites: [] };
  }
}

/**
 * Query searchAnalytics for a site.
 * @param {{ siteUrl: string, days?: number, dimensions?: string[], rowLimit?: number, dimensionFilterGroups?: object[] }} opts
 */
async function querySearchAnalytics(opts = {}) {
  const siteUrl = String(opts.siteUrl || '').trim();
  if (!siteUrl) return { ok: false, error: 'siteUrl required', rows: [] };
  if (!hasGscCredentials()) return { ok: false, configured: false, error: 'not_configured', rows: [] };

  try {
    const token = await getGoogleSAToken('https://www.googleapis.com/auth/webmasters.readonly');
    const days = Math.max(1, Math.min(90, Number(opts.days) || 28));
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const body = {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: opts.dimensions || ['page'],
      rowLimit: Math.min(25000, Math.max(1, Number(opts.rowLimit) || 250)),
    };
    if (Array.isArray(opts.dimensionFilterGroups) && opts.dimensionFilterGroups.length) {
      body.dimensionFilterGroups = opts.dimensionFilterGroups;
    }
    const r = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    const j = await r.json();
    if (j.error) return { ok: false, configured: true, error: j.error.message, rows: [] };
    return {
      ok: true,
      configured: true,
      siteUrl,
      days,
      rows: (j.rows || []).map((row) => ({
        keys: row.keys || [],
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr != null ? +(row.ctr * 100).toFixed(2) : 0,
        position: row.position != null ? +Number(row.position).toFixed(1) : null,
      })),
    };
  } catch (e) {
    return { ok: false, configured: true, error: e.message, rows: [] };
  }
}

function _resetTokenForTests() {
  _tokenCache = null;
  _tokenExp = 0;
}

module.exports = {
  hasGscCredentials,
  getGoogleSAToken,
  listSites,
  querySearchAnalytics,
  _resetTokenForTests,
};
