// services/meta_ads_oauth/api.js
//
// Meta Ads "Connect" OAuth flow — mirror of services/google_ads_oauth.
// AUTHORIZATION flow that lets a logged-in InfoGenie user grant InfoGenie
// permission to call the Meta Marketing API (Facebook + Instagram) on their
// behalf. NOT an authentication flow — InfoGenie login still lives in
// services/auth (Facebook social-login uses a different OAuth client with
// only email + profile scopes).
//
// Endpoints (all require a session; non-owner users are allow-listed past
// the owner-only data gate in server.js):
//
//   GET  /api/integrations/meta-ads/oauth/start    — generate state, redirect to FB
//   GET  /api/integrations/meta-ads/oauth/callback — exchange code, branch to picker or auto-bind
//   GET  /api/integrations/meta-ads/pick-list      — return pending picker payload
//   POST /api/integrations/meta-ads/bind-account   — finalise multi-account selection
//   POST /api/integrations/meta-ads/disconnect     — wipe vault row for this user
//   GET  /api/integrations/meta-ads/summary        — connected-state card data
//
// Operator-level prerequisites (set ONCE per deployment by the platform owner):
//   - META_OAUTH_CLIENT_ID     (Facebook App ID; or legacy META_APP_ID fallback)
//   - META_OAUTH_CLIENT_SECRET (Facebook App Secret; or legacy META_APP_SECRET fallback)
//   - The redirect URI registered in the Facebook App's Login product MUST
//     match `${PUBLIC_URL}/api/integrations/meta-ads/oauth/callback`.
//   - The Facebook App needs the Marketing API product enabled, and the
//     ads_management + ads_read + read_insights permissions in the
//     App Review section (or use a Development-mode app with test users).

const express = require('express');
const crypto  = require('crypto');
const _https  = require('https');
const vault   = require('../credentials/vault');

const router = express.Router();

// ads_management is required to launch/edit campaigns. ads_read covers
// insights endpoints. business_management lets us discover ad accounts under
// Business Manager. email is for display only.
const META_SCOPE      = 'ads_management,ads_read,read_insights,business_management,email,public_profile';
const CALLBACK_PATH   = '/api/integrations/meta-ads/oauth/callback';
const SETTINGS_RETURN = '/?settings=integrations';
const GRAPH_VERSION   = 'v19.0';

function _clientCreds() {
  const clientId =
    process.env.META_OAUTH_CLIENT_ID || process.env.META_APP_ID || '';
  const clientSecret =
    process.env.META_OAUTH_CLIENT_SECRET || process.env.META_APP_SECRET || '';
  return { clientId, clientSecret };
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

// ── 1. Start: redirect to Facebook's consent screen ───────────────────────
router.get('/oauth/start', (req, res) => {
  if (!req.user || !req.user.id) {
    return _backToSettings(res, { ma_error: 'not_signed_in' });
  }
  const { clientId } = _clientCreds();
  if (!clientId) return _backToSettings(res, { ma_error: 'operator_oauth_client_missing' });

  const state = crypto.randomBytes(24).toString('hex');
  req.session.maOauthState  = state;
  req.session.maOauthUserId = req.user.id;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: _redirectUri(req),
    response_type: 'code',
    scope: META_SCOPE,
    state,
    auth_type: 'rerequest',  // re-prompt for any previously-declined permissions
  });
  return res.redirect(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`);
});

// ── 2. Callback: exchange code → long-lived token, list ad accounts ───────
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return _backToSettings(res, { ma_error: String(error), ma_detail: String(error_description || '').slice(0, 180) });
  }
  if (!req.user || !req.user.id) {
    return _backToSettings(res, { ma_error: 'not_signed_in' });
  }
  if (!code || !state || state !== req.session.maOauthState ||
      req.session.maOauthUserId !== req.user.id) {
    return _backToSettings(res, { ma_error: 'state_mismatch' });
  }
  delete req.session.maOauthState;
  delete req.session.maOauthUserId;

  const { clientId, clientSecret } = _clientCreds();
  if (!clientId || !clientSecret) return _backToSettings(res, { ma_error: 'operator_oauth_client_missing' });

  // 2a. Exchange auth code → short-lived access token (FB uses GET).
  const tokParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: _redirectUri(req),
    code: String(code),
  });
  const tok = await _getJson('graph.facebook.com',
    `/${GRAPH_VERSION}/oauth/access_token?${tokParams.toString()}`);
  if (tok.status < 200 || tok.status >= 300 || !tok.body.access_token) {
    const msg = (tok.body && (tok.body.error?.message || tok.body.error)) || 'token_exchange_failed';
    return _backToSettings(res, { ma_error: 'token_exchange_failed', ma_detail: String(msg).slice(0, 180) });
  }
  const shortToken = tok.body.access_token;

  // 2b. Exchange short-lived → long-lived (~60 day) token.
  const llParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortToken,
  });
  const ll = await _getJson('graph.facebook.com',
    `/${GRAPH_VERSION}/oauth/access_token?${llParams.toString()}`);
  // Fall back to short token if the long-lived exchange fails — better
  // 60-minute access than no access at all.
  const accessToken = (ll.body && ll.body.access_token) || shortToken;
  const expiresIn   = (ll.body && ll.body.expires_in) || (tok.body && tok.body.expires_in) || null;
  const expiresAt   = expiresIn ? Date.now() + (Number(expiresIn) * 1000) : null;

  // 2c. Fetch the user's name + email (display only)
  let email = null, name = null;
  try {
    const mp = new URLSearchParams({ fields: 'id,name,email', access_token: accessToken });
    const me = await _getJson('graph.facebook.com', `/${GRAPH_VERSION}/me?${mp.toString()}`);
    if (me.body) { email = me.body.email || null; name = me.body.name || null; }
  } catch (_) {}

  // 2d. List ad accounts the user has access to
  const acctParams = new URLSearchParams({
    fields: 'id,account_id,name,account_status,currency,business_name',
    limit: '100',
    access_token: accessToken,
  });
  const acct = await _getJson('graph.facebook.com',
    `/${GRAPH_VERSION}/me/adaccounts?${acctParams.toString()}`);
  if (acct.status < 200 || acct.status >= 300) {
    const msg = (acct.body && (acct.body.error?.message || acct.body.error)) || 'list_accounts_failed';
    return _backToSettings(res, { ma_error: 'list_accounts_failed', ma_detail: String(msg).slice(0, 180) });
  }
  const accounts = ((acct.body && acct.body.data) || []).map(a => ({
    id:       a.id,                                  // e.g. "act_1234567890"
    account_id: a.account_id || String(a.id).replace(/^act_/, ''),
    name:     a.name || null,
    status:   a.account_status,
    currency: a.currency || null,
    business: a.business_name || null,
  })).filter(a => a.id && /^act_\d+$/.test(a.id));

  if (!accounts.length) {
    return _backToSettings(res, { ma_error: 'no_accessible_accounts' });
  }

  // 2e. Auto-bind if exactly one; otherwise stash for picker UI
  if (accounts.length === 1) {
    const picked = accounts[0];
    await vault.saveCredentials(req.user.id, 'meta_ads', {
      accessToken,
      adAccountId: picked.id,
      accountName: picked.name,
      businessName: picked.business,
      currency: picked.currency,
      email, name,
      expiresAt,
    });
    return _backToSettings(res, { ma_connected: '1' });
  }

  req.session.maPending = {
    accessToken, email, name, expiresAt, accounts,
    expiresAtSession: Date.now() + 10 * 60 * 1000,  // 10 min picker window
  };
  return _backToSettings(res, { ma_pick: '1' });
});

// ── 3. Picker — return the pending account list for the UI ────────────────
router.get('/pick-list', (req, res) => {
  const p = req.session && req.session.maPending;
  if (!p || !p.accounts || Date.now() > p.expiresAtSession) {
    return res.status(404).json({ ok: false, error: 'no_pending_oauth' });
  }
  // Never leak the access token through this list — only the metadata.
  res.json({ ok: true, email: p.email || null, name: p.name || null, accounts: p.accounts });
});

// ── 4. Bind — user picked one of multiple accessible ad accounts ──────────
router.post('/bind-account', express.json(), async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const p = req.session && req.session.maPending;
  if (!p || !p.accounts || Date.now() > p.expiresAtSession) {
    return res.status(400).json({ ok: false, error: 'no_pending_oauth' });
  }
  const pickedRaw = String((req.body && req.body.adAccountId) || '').trim();
  const picked = p.accounts.find(a => a.id === pickedRaw);
  if (!picked) return res.status(400).json({ ok: false, error: 'invalid_account_id' });

  await vault.saveCredentials(req.user.id, 'meta_ads', {
    accessToken: p.accessToken,
    adAccountId: picked.id,
    accountName: picked.name,
    businessName: picked.business,
    currency: picked.currency,
    email: p.email || null,
    name:  p.name  || null,
    expiresAt: p.expiresAt || null,
  });
  delete req.session.maPending;
  res.json({ ok: true });
});

// ── 5. Disconnect — wipe vault row for this user ──────────────────────────
router.post('/disconnect', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  await vault.deleteCredentials(req.user.id, 'meta_ads');
  res.json({ ok: true });
});

// ── 6. Connection summary — for the connected-state card ──────────────────
router.get('/summary', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const { clientId, clientSecret } = _clientCreds();
  const operatorReady = !!(clientId && clientSecret);
  let connected = false, email = null, name = null, adAccountId = null,
      accountName = null, businessName = null, currency = null,
      expiresAt = null, status = 'disconnected';
  try {
    const blob = await vault.getCredentials(req.user.id, 'meta_ads');
    if (blob) {
      connected    = true;
      email        = blob.email || null;
      name         = blob.name || null;
      adAccountId  = blob.adAccountId || null;
      accountName  = blob.accountName || null;
      businessName = blob.businessName || null;
      currency     = blob.currency || null;
      expiresAt    = blob.expiresAt || null;
    }
    const s = await vault.getStatus(req.user.id, 'meta_ads');
    status = s.status || 'disconnected';
  } catch (_) {}
  res.json({
    ok: true, operatorReady, connected,
    email, name, adAccountId, accountName, businessName, currency,
    expiresAt, status,
  });
});

module.exports = router;
