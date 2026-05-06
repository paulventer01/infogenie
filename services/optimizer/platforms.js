// Per-platform fetchers for the optimizer. Each returns a normalized stats
// object: { ok, error, rows: [{ bucket_hour, spend, impressions, clicks,
// conversions, revenue, raw }] } so the ingest cron stays platform-agnostic.
//
// Live calls are made ONLY when the relevant credentials are present in env.
// All HTTP calls have timeouts and never throw out of the function.

const https = require('https');

function _httpsJson(host, path, method, body, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: host, path, method, headers: { 'User-Agent': 'InfoGenie-Optimizer/1.0', ...headers } };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch { resolve({ status: res.statusCode, body: { _raw: data } }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Meta Marketing API ───────────────────────────────────────────────────────
async function fetchMeta(platformCampId, hours = 168) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN not set' };
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString().slice(0,10);
  const until = new Date().toISOString().slice(0,10);
  const params = new URLSearchParams({
    fields: 'spend,impressions,clicks,actions,action_values,date_start,date_stop',
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    access_token: token,
  });
  const path = `/v19.0/${encodeURIComponent(platformCampId)}/insights?${params}`;
  try {
    const r = await _httpsJson('graph.facebook.com', path, 'GET');
    if (r.body.error) return { ok: false, error: r.body.error.message || 'Meta API error' };
    const data = (r.body.data || []).map(row => {
      const conv = (row.actions || []).filter(a =>
        /purchase|lead|complete_registration|subscribe/.test(a.action_type)
      ).reduce((s,a) => s + parseFloat(a.value || 0), 0);
      const rev  = (row.action_values || []).filter(a => /purchase|revenue/.test(a.action_type))
                   .reduce((s,a) => s + parseFloat(a.value || 0), 0);
      return {
        bucket_hour: new Date(row.date_start + 'T00:00:00Z').toISOString(),
        spend: parseFloat(row.spend || 0),
        impressions: parseInt(row.impressions || 0, 10),
        clicks: parseInt(row.clicks || 0, 10),
        conversions: conv,
        revenue: rev,
        raw: row,
      };
    });
    return { ok: true, rows: data };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Meta: apply update (pause / set daily budget) ────────────────────────────
async function applyMeta(platformCampId, change) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN not set' };
  const params = new URLSearchParams({ access_token: token });
  if (change.action === 'pause')   params.set('status', 'PAUSED');
  if (change.action === 'resume')  params.set('status', 'ACTIVE');
  if (change.action === 'budget')  params.set('daily_budget', String(Math.round(change.dailyBudget * 100)));
  try {
    const r = await _httpsJson('graph.facebook.com', `/v19.0/${platformCampId}`, 'POST',
                               params.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (r.body.error) return { ok: false, error: r.body.error.message };
    return { ok: true, response: r.body };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Google Ads (stub-but-real shape) ─────────────────────────────────────────
async function fetchGoogleAds(platformCampId, hours = 168) {
  const need = ['GOOGLE_ADS_DEVELOPER_TOKEN','GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN','GOOGLE_ADS_CUSTOMER_ID'];
  const missing = need.filter(k => !process.env[k]);
  if (missing.length) return { ok: false, error: 'Google Ads not connected: ' + missing.join(', ') };
  // Token refresh
  try {
    const tok = await _httpsJson('oauth2.googleapis.com', '/token', 'POST',
      `client_id=${encodeURIComponent(process.env.GOOGLE_ADS_CLIENT_ID)}&client_secret=${encodeURIComponent(process.env.GOOGLE_ADS_CLIENT_SECRET)}&refresh_token=${encodeURIComponent(process.env.GOOGLE_ADS_REFRESH_TOKEN)}&grant_type=refresh_token`,
      { 'Content-Type':'application/x-www-form-urlencoded' });
    const access = tok.body.access_token;
    if (!access) return { ok: false, error: 'OAuth refresh failed' };
    const cust = String(process.env.GOOGLE_ADS_CUSTOMER_ID).replace(/-/g,'');
    const days = Math.ceil(hours / 24);
    // Sanitize: campaign IDs are numeric in Google Ads. Hard-cast to int to
    // prevent any GAQL injection through a tampered platform_camp_id.
    const safeCampId = parseInt(String(platformCampId).replace(/[^0-9]/g,''), 10);
    if (!Number.isFinite(safeCampId) || safeCampId <= 0) return { ok: false, error: 'Invalid Google Ads campaign id' };
    const gaql = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.id = ${safeCampId} AND segments.date DURING LAST_${days <= 7 ? '7' : days <= 14 ? '14' : '30'}_DAYS`;
    const r = await _httpsJson('googleads.googleapis.com', `/v16/customers/${cust}/googleAds:search`, 'POST',
      JSON.stringify({ query: gaql }),
      { 'Content-Type':'application/json', 'Authorization':`Bearer ${access}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN });
    if (r.body.error) return { ok: false, error: r.body.error.message };
    const rows = (r.body.results || []).map(x => ({
      bucket_hour: new Date(x.segments.date + 'T00:00:00Z').toISOString(),
      spend: (parseInt(x.metrics.costMicros || 0, 10)) / 1e6,
      impressions: parseInt(x.metrics.impressions || 0, 10),
      clicks: parseInt(x.metrics.clicks || 0, 10),
      conversions: parseFloat(x.metrics.conversions || 0),
      revenue: parseFloat(x.metrics.conversionsValue || 0),
      raw: x,
    }));
    return { ok: true, rows };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function applyGoogleAds(platformCampId, change) {
  // Placeholder until full mutate wired — log only.
  return { ok: false, error: 'Google Ads apply not yet implemented (read-only this phase)' };
}

// ── TikTok ───────────────────────────────────────────────────────────────────
async function fetchTikTok(platformCampId, hours = 168) {
  const token = process.env.TIKTOK_ACCESS_TOKEN, adv = process.env.TIKTOK_ADVERTISER_ID;
  if (!token || !adv) return { ok: false, error: 'TikTok not connected' };
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString().slice(0,10);
  const until = new Date().toISOString().slice(0,10);
  const qs = new URLSearchParams({
    advertiser_id: String(adv).replace(/[^0-9]/g,''),
    report_type: 'BASIC',
    data_level: 'AUC_CAMPAIGN',
    dimensions: JSON.stringify(['campaign_id','stat_time_day']),
    metrics: JSON.stringify(['spend','impressions','clicks','conversion','total_complete_payment_rate']),
    start_date: since, end_date: until,
    filtering: JSON.stringify([{ field_name:'campaign_ids', filter_type:'IN', filter_value: JSON.stringify([String(platformCampId)]) }]),
  });
  try {
    const r = await _httpsJson('business-api.tiktok.com', `/open_api/v1.3/report/integrated/get/?${qs}`,
                               'GET', null, { 'Access-Token': token });
    if (r.body.code !== 0) return { ok: false, error: r.body.message };
    const rows = (r.body.data?.list || []).map(row => ({
      bucket_hour: new Date(row.dimensions.stat_time_day + 'T00:00:00Z').toISOString(),
      spend: parseFloat(row.metrics.spend || 0),
      impressions: parseInt(row.metrics.impressions || 0, 10),
      clicks: parseInt(row.metrics.clicks || 0, 10),
      conversions: parseFloat(row.metrics.conversion || 0),
      revenue: 0,
      raw: row,
    }));
    return { ok: true, rows };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function applyTikTok(_platformCampId, _change) {
  return { ok: false, error: 'TikTok apply not yet implemented (read-only this phase)' };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────
async function fetchPerf(platform, platformCampId, hours = 168) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('meta') || p.includes('facebook')) return fetchMeta(platformCampId, hours);
  if (p.includes('google'))                          return fetchGoogleAds(platformCampId, hours);
  if (p.includes('tiktok'))                          return fetchTikTok(platformCampId, hours);
  return { ok: false, error: 'Unsupported platform: ' + platform };
}

async function applyChange(platform, platformCampId, change) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('meta') || p.includes('facebook')) return applyMeta(platformCampId, change);
  if (p.includes('google'))                          return applyGoogleAds(platformCampId, change);
  if (p.includes('tiktok'))                          return applyTikTok(platformCampId, change);
  return { ok: false, error: 'Unsupported platform: ' + platform };
}

function platformConnected(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('meta') || p.includes('facebook')) return !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
  if (p.includes('google'))                          return !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_REFRESH_TOKEN);
  if (p.includes('tiktok'))                          return !!(process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_ID);
  return false;
}

module.exports = { fetchPerf, applyChange, platformConnected };
