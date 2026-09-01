// services/google_ads_oauth/api.js
//
// Google Ads "Connect" OAuth flow. This is an AUTHORIZATION flow — it lets a
// logged-in InfoGenie user grant InfoGenie permission to call the Google Ads
// API on their behalf. It is NOT an authentication flow (logging in to
// InfoGenie itself); that lives in services/auth and uses entirely separate
// OAuth client credentials with the email + profile scopes only.
//
// Endpoints (all require a session; non-owner users are allow-listed past the
// owner-only data gate in server.js):
//
//   GET  /api/integrations/google-ads/oauth/start    — generate state, redirect to Google
//   GET  /api/integrations/google-ads/oauth/callback — exchange code, branch to picker or auto-bind
//   GET  /api/integrations/google-ads/pick-list      — return pending picker payload (after callback)
//   POST /api/integrations/google-ads/bind-customer  — finalise multi-account selection
//   POST /api/integrations/google-ads/disconnect     — wipe vault row for this user
//
// Operator-level prerequisites (set ONCE per deployment by the platform owner):
//   - GOOGLE_ADS_OAUTH_CLIENT_ID     (or legacy GOOGLE_ADS_CLIENT_ID)
//   - GOOGLE_ADS_OAUTH_CLIENT_SECRET (or legacy GOOGLE_ADS_CLIENT_SECRET)
//   - GOOGLE_ADS_DEVELOPER_TOKEN     (per-application, NOT per-user)
//   - The redirect URI registered in Google Cloud Console MUST match
//     `${PUBLIC_URL}/api/integrations/google-ads/oauth/callback`.

const express = require('express');
const crypto  = require('crypto');
const _https  = require('https');
const vault   = require('../credentials/vault');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

// Request adwords (the API permission we need) PLUS openid + email so the
// userinfo lookup deterministically returns the connected Google email for
// display on the Settings card.
const GOOGLE_ADS_SCOPE   = 'https://www.googleapis.com/auth/adwords openid email';
const CALLBACK_PATH      = '/api/integrations/google-ads/oauth/callback';
const SETTINGS_RETURN    = '/?settings=integrations';

function _clientCreds() {
  const clientId =
    process.env.GOOGLE_ADS_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || '';
  const clientSecret =
    process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '';
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  return { clientId, clientSecret, devToken };
}

function _publicOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host  = req.get('host');
  return `${proto}://${host}`;
}

function _redirectUri(req) { return `${_publicOrigin(req)}${CALLBACK_PATH}`; }

function _backToSettings(res, q) {
  const params = new URLSearchParams(q || {});
  const url = SETTINGS_RETURN + (params.toString() ? '&' + params.toString() : '');
  return res.redirect(url);
}

// ── POST helper: application/x-www-form-urlencoded ────────────────────────
function _postForm(hostname, path, formObj, headers = {}) {
  const body = Object.entries(formObj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return new Promise(resolve => {
    const req = _https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                 'Content-Length': Buffer.byteLength(body), ...headers }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: d ? JSON.parse(d) : {} }); }
        catch { resolve({ status: r.statusCode, body: {} }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.setTimeout(15000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _getJson(hostname, path, headers = {}) {
  return new Promise(resolve => {
    const req = _https.request({ hostname, path, method: 'GET', headers }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: d ? JSON.parse(d) : {} }); }
        catch { resolve({ status: r.statusCode, body: {} }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.setTimeout(15000, () => req.destroy());
    req.end();
  });
}

// ── 1. Start: redirect to Google's consent screen ─────────────────────────
router.get('/oauth/start', (req, res) => {
  if (!req.user || !req.user.id) {
    return _backToSettings(res, { ga_error: 'not_signed_in' });
  }
  const { clientId, devToken } = _clientCreds();
  if (!clientId)  return _backToSettings(res, { ga_error: 'operator_oauth_client_missing' });
  if (!devToken)  return _backToSettings(res, { ga_error: 'operator_developer_token_missing' });

  const state = crypto.randomBytes(24).toString('hex');
  req.session.gaOauthState = state;
  req.session.gaOauthUserId = req.user.id;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: _redirectUri(req),
    response_type: 'code',
    scope: GOOGLE_ADS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',          // force refresh_token issuance every time
    include_granted_scopes: 'true',
    state,
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// ── 2. Callback: exchange code → tokens, list accessible customers ────────
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return _backToSettings(res, { ga_error: String(error) });
  }
  if (!req.user || !req.user.id) {
    return _backToSettings(res, { ga_error: 'not_signed_in' });
  }
  if (!code || !state || state !== req.session.gaOauthState ||
      req.session.gaOauthUserId !== req.user.id) {
    return _backToSettings(res, { ga_error: 'state_mismatch' });
  }
  // Consume state immediately
  delete req.session.gaOauthState;
  delete req.session.gaOauthUserId;

  const { clientId, clientSecret, devToken } = _clientCreds();
  if (!clientId || !clientSecret) return _backToSettings(res, { ga_error: 'operator_oauth_client_missing' });
  if (!devToken)                  return _backToSettings(res, { ga_error: 'operator_developer_token_missing' });

  // 2a. Exchange auth code for tokens
  const tok = await _postForm('oauth2.googleapis.com', '/token', {
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: _redirectUri(req), grant_type: 'authorization_code',
  });
  if (tok.status < 200 || tok.status >= 300 || !tok.body.access_token) {
    return _backToSettings(res, { ga_error: 'token_exchange_failed' });
  }
  const accessToken  = tok.body.access_token;
  const refreshToken = tok.body.refresh_token;
  if (!refreshToken) {
    // Google only issues a refresh_token on first consent or with prompt=consent.
    // We forced prompt=consent above, so this should be rare.
    return _backToSettings(res, { ga_error: 'no_refresh_token' });
  }

  // 2b. Fetch the user's email (for display in the settings card)
  let email = null;
  try {
    const ui = await _getJson('openidconnect.googleapis.com', '/v1/userinfo',
      { Authorization: `Bearer ${accessToken}` });
    if (ui.body && ui.body.email) email = ui.body.email;
  } catch (_) {}
  // Fallback: try the legacy oauth2 endpoint
  if (!email) {
    try {
      const ui = await _getJson('www.googleapis.com', '/oauth2/v2/userinfo',
        { Authorization: `Bearer ${accessToken}` });
      if (ui.body && ui.body.email) email = ui.body.email;
    } catch (_) {}
  }

  // 2c. listAccessibleCustomers — needs developer-token header
  const lac = await _getJson('googleads.googleapis.com',
    '/v17/customers:listAccessibleCustomers',
    { Authorization: `Bearer ${accessToken}`, 'developer-token': devToken });
  if (lac.status < 200 || lac.status >= 300) {
    const msg = (lac.body && (lac.body.error?.message || lac.body.error)) || 'list_customers_failed';
    return _backToSettings(res, { ga_error: 'list_customers_failed', ga_detail: String(msg).slice(0, 180) });
  }
  const resourceNames = (lac.body && lac.body.resourceNames) || [];
  const customerIds = resourceNames
    .map(rn => String(rn).replace(/^customers\//, ''))
    .filter(id => /^\d+$/.test(id));
  if (!customerIds.length) {
    return _backToSettings(res, { ga_error: 'no_accessible_customers' });
  }

  // 2d. Auto-bind if exactly one customer; otherwise stash and prompt user
  if (customerIds.length === 1) {
    const customerId = customerIds[0];
    const tenantId = await _tenantCtx.resolveTenantId(req, { label: 'google-ads-oauth:callback' });
    if (!tenantId) return _backToSettings(res, { ga_error: 'no_tenant' });
    await vault.saveCredentials(req.user.id, 'google_ads', {
      devToken, clientId, clientSecret, refreshToken,
      customerId, loginCustomerId: '', email,
    }, { tenantId });
    return _backToSettings(res, { ga_connected: '1' });
  }

  // Multiple — store pending payload in session, redirect to picker UI
  req.session.gaPending = {
    refreshToken, email, customerIds,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min picker window
  };
  return _backToSettings(res, { ga_pick: '1' });
});

// ── 3. Picker — return the pending list for the UI ────────────────────────
router.get('/pick-list', (req, res) => {
  const p = req.session && req.session.gaPending;
  if (!p || !p.customerIds || Date.now() > p.expiresAt) {
    return res.status(404).json({ ok: false, error: 'no_pending_oauth' });
  }
  res.json({ ok: true, email: p.email || null, customerIds: p.customerIds });
});

// ── 4. Bind — user picked one of multiple accessible customers ────────────
router.post('/bind-customer', express.json(), async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const p = req.session && req.session.gaPending;
  if (!p || !p.customerIds || Date.now() > p.expiresAt) {
    return res.status(400).json({ ok: false, error: 'no_pending_oauth' });
  }
  const picked = String(req.body && req.body.customerId || '').replace(/[^0-9]/g, '');
  if (!picked || !p.customerIds.includes(picked)) {
    return res.status(400).json({ ok: false, error: 'invalid_customer_id' });
  }
  const { clientId, clientSecret, devToken } = _clientCreds();
  const tenantId = await _tenantCtx.resolveTenantId(req, { label: 'google-ads-oauth:bind-customer' });
  if (!tenantId) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const saved = await vault.saveCredentials(req.user.id, 'google_ads', {
    devToken, clientId, clientSecret,
    refreshToken: p.refreshToken,
    customerId: picked, loginCustomerId: '',
    email: p.email || null,
  }, { tenantId });
  delete req.session.gaPending;
  res.json({ ok: true, credentialReference: {
    id: saved.referenceId, version: saved.version,
  } });
});

// ── 5. Disconnect — wipe vault row for this user ──────────────────────────
router.post('/disconnect', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const tenantId = await _tenantCtx.resolveTenantId(req, { label: 'google-ads-oauth:disconnect' });
  if (!tenantId) return res.status(400).json({ ok: false, error: 'no_tenant' });
  await vault.deleteCredentials(req.user.id, 'google_ads', { tenantId });
  res.json({ ok: true });
});

// ── 6. Connection summary — for the connected-state card ──────────────────
// Returns the non-secret email plus the metadata-only credential handle and
// operator-readiness flag (does the deployment have OAuth client + dev token?)
router.get('/summary', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const { clientId, clientSecret, devToken } = _clientCreds();
  const operatorReady = !!(clientId && clientSecret && devToken);
  let connected = false, email = null, status = 'disconnected', credentialReference = null;
  try {
    const blob = await vault.getCredentials(req.user.id, 'google_ads');
    if (blob) {
      connected  = true;
      email      = blob.email || null;
    }
    const s = await vault.getStatus(req.user.id, 'google_ads');
    status = s.status || 'disconnected';
    if (connected) {
      const tenantId = await _tenantCtx.resolveTenantId(req, { label: 'google-ads-oauth:summary' });
      const ref = tenantId && await vault.getGoogleAdsCredentialReference(req.user.id, tenantId);
      if (ref) credentialReference = { id: ref.referenceId, version: ref.version };
    }
  } catch (_) {}
  // Customer/account identifiers and all credential contents stay private; the
  // opaque metadata handle is the only authority input returned here.
  res.json({ ok: true, operatorReady, connected, email, status, credentialReference });
});

module.exports = router;
