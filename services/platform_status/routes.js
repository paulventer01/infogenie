// Ad-platform & credential status routes.
// Extracted verbatim from server.js (pure structural move — no behavior change).
// Shared module-scope helpers are injected via `ctx`.
// __dirname and relative require() are rebased to the app root so the moved code
// (originally at server.js, project root) resolves paths exactly as before.
const __path__ = require('path');
const __APP_ROOT__ = __path__.join(__dirname, '..', '..');
const __root_require__ = (p) =>
  (typeof p === 'string' && (p.startsWith('./') || p.startsWith('../')))
    ? require(__path__.resolve(__APP_ROOT__, p))
    : require(p);

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { _credentialsVault, callHttpsGeneric } = ctx;

app.get('/api/ad-platforms/status', async (req, res) => {
  const uid = req.user && req.user.id ? req.user.id : null;
  const isOwner = !!(req.user && req.user.isOwner);
  const envGoogle = !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_REFRESH_TOKEN &&
                       process.env.GOOGLE_ADS_CUSTOMER_ID && process.env.GOOGLE_ADS_CLIENT_ID &&
                       process.env.GOOGLE_ADS_CLIENT_SECRET);
  const envMeta = !!(process.env.META_AD_ACCOUNT_ID && process.env.META_ACCESS_TOKEN);
  let vaultGoogle = false;        // exists + active (status='connected')
  let vaultGoogleStatus = null;   // 'connected' | 'error' | 'disconnected' | null
  let vaultMeta = false;
  let vaultMetaStatus = null;
  try {
    if (uid) {
      const s = await _credentialsVault.getStatus(uid, 'google_ads');
      vaultGoogleStatus = s.status || null;
      vaultGoogle = s.status === 'connected';
      const sm = await _credentialsVault.getStatus(uid, 'meta_ads');
      vaultMetaStatus = sm.status || null;
      vaultMeta = sm.status === 'connected';
    }
  } catch (_e) {}
  res.json({
    googleAds: vaultGoogle || (isOwner && envGoogle),
    googleAdsSource: vaultGoogle ? 'vault' : (isOwner && envGoogle ? 'env' : 'none'),
    googleAdsStatus: vaultGoogleStatus || (isOwner && envGoogle ? 'connected' : 'disconnected'),
    merchantCenter: !!process.env.GOOGLE_MERCHANT_CENTER_ID,
    meta:       vaultMeta || (isOwner && envMeta),
    metaSource: vaultMeta ? 'vault' : (isOwner && envMeta ? 'env' : 'none'),
    metaStatus: vaultMetaStatus || (isOwner && envMeta ? 'connected' : 'disconnected'),
    // Other platforms still env-only until their vault adapters land.
    tiktok:    !!(process.env.TIKTOK_ADVERTISER_ID && process.env.TIKTOK_ACCESS_TOKEN),
    microsoft: !!(process.env.MICROSOFT_ADS_DEVELOPER_TOKEN && process.env.MICROSOFT_ADS_CLIENT_ID &&
                  process.env.MICROSOFT_ADS_CLIENT_SECRET   && process.env.MICROSOFT_ADS_REFRESH_TOKEN &&
                  process.env.MICROSOFT_ADS_CUSTOMER_ID     && process.env.MICROSOFT_ADS_ACCOUNT_ID)
  });
});

// ── Google Ads credential smoke test ──────────────────────────────────────────
// Resolves credentials from vault (or env-fallback for owners) and tries an
// OAuth refresh + a trivial GAQL call. Returns connection status without
// leaking any secret material.
app.get('/api/credentials/google-ads/test', async (req, res) => {
  const uid = req.user && req.user.id ? req.user.id : null;
  const t0 = Date.now();
  const resolved = await _credentialsVault.resolveGoogleAdsCredentials(uid);
  if (!resolved.ok) return res.json({ ok: false, source: 'none', error: resolved.error, latencyMs: Date.now() - t0 });
  const { devToken, clientId, clientSecret, refreshToken, customerId, loginCustomerId } = resolved.creds;
  try {
    const tokenBody = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`;
    const tokenRaw  = await callHttpsGeneric('oauth2.googleapis.com', '/token', 'POST', tokenBody, { 'Content-Type': 'application/x-www-form-urlencoded' });
    const tokenData = JSON.parse(tokenRaw);
    if (!tokenData.access_token) {
      const msg = tokenData.error_description || tokenData.error || 'oauth_refresh_failed';
      if (uid) await _credentialsVault.setStatus(uid, 'google_ads', 'error').catch(()=>{});
      return res.json({ ok: false, source: resolved.source, step: 'oauth', error: msg, latencyMs: Date.now() - t0 });
    }
    const cleanId = String(customerId).replace(/-/g, '');
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenData.access_token}`, 'developer-token': devToken };
    if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId).replace(/-/g, '');
    const probe = await callHttpsGeneric('googleads.googleapis.com', `/v16/customers/${cleanId}/googleAds:search`, 'POST',
      JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1' }), headers);
    let body; try { body = JSON.parse(probe); } catch { body = {}; }
    if (body.error) {
      if (uid) await _credentialsVault.setStatus(uid, 'google_ads', 'error').catch(()=>{});
      return res.json({ ok: false, source: resolved.source, step: 'gaql', error: body.error.message || 'gaql_failed', latencyMs: Date.now() - t0 });
    }
    const row = (body.results || [])[0] || {};
    if (uid) await _credentialsVault.setStatus(uid, 'google_ads', 'connected').catch(()=>{});
    return res.json({
      ok: true, source: resolved.source,
      customerId: cleanId,
      descriptiveName: row.customer && row.customer.descriptiveName || null,
      latencyMs: Date.now() - t0,
    });
  } catch (e) {
    if (uid) await _credentialsVault.setStatus(uid, 'google_ads', 'error').catch(()=>{});
    return res.json({ ok: false, source: resolved.source, step: 'exception', error: e.message, latencyMs: Date.now() - t0 });
  }
});

// ── Meta Ads — credential smoke test (mirrors Google Ads `/test`) ─────────
app.get('/api/credentials/meta-ads/test', async (req, res) => {
  const uid = req.user && req.user.id ? req.user.id : null;
  const t0 = Date.now();
  const resolved = await _credentialsVault.resolveMetaAdsCredentials(uid);
  if (!resolved.ok) return res.json({ ok: false, source: 'none', error: resolved.error, latencyMs: Date.now() - t0 });
  const { accessToken, adAccountId } = resolved.creds;
  try {
    const acctRaw = String(adAccountId).trim();
    const acct = acctRaw.startsWith('act_') ? acctRaw : `act_${acctRaw.replace(/\D+/g,'')}`;
    const probe = await callHttpsGeneric('graph.facebook.com',
      `/v19.0/${acct}?fields=name,currency,account_status&access_token=${encodeURIComponent(accessToken)}`,
      'GET', null, {});
    let body; try { body = JSON.parse(probe); } catch { body = {}; }
    if (body.error) {
      if (uid) await _credentialsVault.setStatus(uid, 'meta_ads', 'error').catch(()=>{});
      return res.json({ ok: false, source: resolved.source, step: 'graph', error: body.error.message || 'graph_failed', latencyMs: Date.now() - t0 });
    }
    if (uid) await _credentialsVault.setStatus(uid, 'meta_ads', 'connected').catch(()=>{});
    return res.json({
      ok: true, source: resolved.source,
      adAccountId: acct,
      name: body.name || null,
      currency: body.currency || null,
      status: body.account_status,
      latencyMs: Date.now() - t0,
    });
  } catch (e) {
    if (uid) await _credentialsVault.setStatus(uid, 'meta_ads', 'error').catch(()=>{});
    return res.json({ ok: false, source: resolved.source, step: 'exception', error: e.message, latencyMs: Date.now() - t0 });
  }
});
};
