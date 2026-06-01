// Google Ads — 72h Responsive Search Ad (RSA) Auto-Refresh.
//
// Mirrors services/optimizer/creative_refresh.js (Meta) for Google search.
// Differences from Meta:
//   - Google search ads have NO image — only headlines (≤30 chars, up to 15)
//     and descriptions (≤90 chars, up to 4). We generate 5 headlines + 2
//     descriptions per refresh.
//   - Each ad lives in an AD GROUP (Google's per-arm container). New PAUSED
//     RSA is created in the SAME ad group; old RSA is paused.
//   - No image upload step → much simpler than Meta's pipeline (no gpt-image-1).

const https = require('https');
const _db = require('../../db');
const { makeSettingsCache } = require('./schema');
const { resolveGoogleAdsCredentials } = require('../credentials/vault');

const STALE_AGE_HOURS = 72;
const CTR_FLOOR       = 0.005;
const SPEND_FLOOR     = 25;
const MAX_PER_RUN     = 20;

let OpenAI = null;
try { OpenAI = require('openai'); } catch { /* optional */ }
const _openai = (OpenAI && process.env.AI_INTEGRATIONS_OPENAI_API_KEY)
  ? new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
    })
  : null;

// ── HTTPS helper ────────────────────────────────────────────────────────────
function _httpsJson(host, path, method, body, headers = {}, timeoutMs = 30000) {
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

// ── OAuth refresh ───────────────────────────────────────────────────────────
async function _refreshAccessToken(userId = null) {
  const c = await resolveGoogleAdsCredentials(userId);
  if (!c.ok) return { ok: false, error: c.error };
  const creds = c.creds;
  const r = await _httpsJson('oauth2.googleapis.com', '/token', 'POST',
    `client_id=${encodeURIComponent(creds.clientId)}&client_secret=${encodeURIComponent(creds.clientSecret)}&refresh_token=${encodeURIComponent(creds.refreshToken)}&grant_type=refresh_token`,
    { 'Content-Type':'application/x-www-form-urlencoded' });
  const access = r.body.access_token;
  if (!access) return { ok: false, error: 'OAuth refresh failed: ' + (r.body.error_description || r.body.error || 'unknown') };
  return {
    ok: true,
    accessToken: access,
    customerId: String(creds.customerId).replace(/-/g,''),
    devToken: creds.devToken,
    loginCustomerId: creds.loginCustomerId ? String(creds.loginCustomerId).replace(/-/g,'') : '',
  };
}

function _googleAdsHeaders(auth) {
  return {
    'Content-Type':'application/json',
    'Authorization':`Bearer ${auth.accessToken}`,
    'developer-token': auth.devToken,
    ...(auth.loginCustomerId ? { 'login-customer-id': auth.loginCustomerId } : {}),
  };
}

async function _gaqlSearch(auth, gaql) {
  const r = await _httpsJson('googleads.googleapis.com', `/v16/customers/${auth.customerId}/googleAds:search`, 'POST',
    JSON.stringify({ query: gaql }), _googleAdsHeaders(auth));
  if (r.body.error) return { ok: false, error: r.body.error.message || JSON.stringify(r.body.error) };
  return { ok: true, results: r.body.results || [] };
}

// ── Fetch active RSAs under a Google campaign + 72h perf ────────────────────
async function fetchActiveRSAsGoogle(platformCampId) {
  const auth = await _refreshAccessToken();
  if (!auth.ok) return { ok: false, error: auth.error };
  const safeCampId = parseInt(String(platformCampId).replace(/[^0-9]/g,''), 10);
  if (!Number.isFinite(safeCampId) || safeCampId <= 0) return { ok: false, error: 'Invalid Google Ads campaign id' };

  // 1. Ad metadata + bidding strategy of the campaign (we still want metadata
  //    but NOT the segments — Google forbids combining segments with assets).
  const adsR = await _gaqlSearch(auth,
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id FROM ad_group_ad WHERE campaign.id = ${safeCampId} AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD' AND ad_group_ad.status = 'ENABLED'`);
  if (!adsR.ok) return { ok: false, error: adsR.error };
  const ads = adsR.results.map(r => ({
    id: String(r.adGroupAd.ad.id),
    name: r.adGroupAd.ad.name || `RSA ${r.adGroupAd.ad.id}`,
    adgroup_id: String(r.adGroup.id),
    headlines: (r.adGroupAd.ad.responsiveSearchAd?.headlines || []).map(h => h.text),
    descriptions: (r.adGroupAd.ad.responsiveSearchAd?.descriptions || []).map(d => d.text),
    final_urls: r.adGroupAd.ad.finalUrls || [],
  }));
  if (ads.length === 0) return { ok: true, ads: [] };

  // 2. 72h aggregated metrics per ad
  const since = new Date(Date.now() - STALE_AGE_HOURS * 3600 * 1000).toISOString().slice(0,10);
  const until = new Date().toISOString().slice(0,10);
  const perfR = await _gaqlSearch(auth,
    `SELECT ad_group_ad.ad.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE campaign.id = ${safeCampId} AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD' AND segments.date BETWEEN '${since}' AND '${until}'`);
  if (!perfR.ok) return { ok: false, error: perfR.error };
  const perfMap = new Map();
  for (const row of perfR.results) {
    const id = String(row.adGroupAd.ad.id);
    const e = perfMap.get(id) || { spend:0, impressions:0, clicks:0, conversions:0, revenue:0 };
    e.spend       += parseInt(row.metrics.costMicros || 0, 10) / 1e6;
    e.impressions += parseInt(row.metrics.impressions || 0, 10);
    e.clicks      += parseInt(row.metrics.clicks || 0, 10);
    e.conversions += parseFloat(row.metrics.conversions || 0);
    e.revenue     += parseFloat(row.metrics.conversionsValue || 0);
    perfMap.set(id, e);
  }

  // 3. Ad creation_time — needed for ageHours. Available in change_event/
  //    change_status; simplest portable source is ad_group_ad.ad.added_to_ad_group_at? That field doesn't exist.
  //    The ad object itself has no creation_time field exposed in v16. As a
  //    reasonable proxy, we look at change_status's last_change_date_time,
  //    falling back to "old enough" (ageHours = STALE_AGE_HOURS) if absent so
  //    the staleness gate still depends on perf, not age alone.
  const ageMap = new Map();
  try {
    const csR = await _gaqlSearch(auth,
      `SELECT change_status.ad_group_ad, change_status.last_change_date_time FROM change_status WHERE change_status.resource_type = 'AD_GROUP_AD' AND change_status.last_change_date_time DURING LAST_30_DAYS`);
    if (csR.ok) {
      for (const row of csR.results) {
        const rn = row.changeStatus?.adGroupAd || '';   // customers/X/adGroupAds/AGID~ADID
        const adId = (rn.split('~').pop() || '').trim();
        const t = row.changeStatus?.lastChangeDateTime;
        if (adId && t) ageMap.set(adId, t);
      }
    }
  } catch { /* age proxy is best-effort */ }

  const enriched = ads.map(a => {
    const perf = perfMap.get(a.id) || { spend:0, impressions:0, clicks:0, conversions:0, revenue:0 };
    const ctr  = perf.impressions > 0 ? perf.clicks / perf.impressions : 0;
    const roas = perf.spend > 0 ? perf.revenue / perf.spend : 0;
    const ts   = ageMap.get(a.id);
    const ageH = ts ? (Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 3600000 : STALE_AGE_HOURS;
    return { ...a, perf72h: { ...perf, ctr, roas }, ageHours: ageH };
  });
  return { ok: true, ads: enriched };
}

// ── Generate fresh RSA copy via GPT-4o-mini ─────────────────────────────────
async function _generateRSACopy({ campaignName, oldHeadlines, oldDescriptions, brandHint }) {
  if (!_openai) return { ok: false, error: 'OpenAI not configured' };
  try {
    const sys = 'You are a senior Google Ads RSA copywriter. Output ONLY valid JSON: {"headlines":[5 strings, each ≤30 chars],"descriptions":[2 strings, each ≤90 chars]}. Each headline must be a different angle. Use a clearly different overall tone from the old copy.';
    const user = `Campaign: ${campaignName}\nBrand context: ${brandHint || '(none)'}\nOld headlines that fatigued: ${(oldHeadlines||[]).slice(0,5).join(' | ') || '(none)'}\nOld descriptions that fatigued: ${(oldDescriptions||[]).slice(0,2).join(' | ') || '(none)'}\n\nWrite fresh copy that re-hooks the audience.`;
    const r = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role:'system', content: sys }, { role:'user', content: user }],
      response_format: { type: 'json_object' },
      max_tokens: 400,
    });
    const j = JSON.parse(r.choices[0].message.content || '{}');
    const headlines    = Array.isArray(j.headlines) ? j.headlines.map(h => String(h).slice(0,30)).filter(Boolean).slice(0,5) : [];
    const descriptions = Array.isArray(j.descriptions) ? j.descriptions.map(d => String(d).slice(0,90)).filter(Boolean).slice(0,2) : [];
    if (headlines.length < 3 || descriptions.length < 2) return { ok: false, error: 'malformed copy (need ≥3 headlines + 2 descriptions)' };
    return { ok: true, headlines, descriptions };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Mutate: create new PAUSED RSA in the same ad group ──────────────────────
async function _createRSA(auth, adGroupId, { headlines, descriptions, finalUrl }) {
  const body = {
    operations: [{
      create: {
        adGroup: `customers/${auth.customerId}/adGroups/${adGroupId}`,
        status: 'PAUSED',
        ad: {
          finalUrls: [finalUrl],
          responsiveSearchAd: {
            headlines: headlines.map(t => ({ text: t })),
            descriptions: descriptions.map(t => ({ text: t })),
          },
        },
      },
    }],
  };
  const r = await _httpsJson('googleads.googleapis.com', `/v16/customers/${auth.customerId}/adGroupAds:mutate`, 'POST',
    JSON.stringify(body), _googleAdsHeaders(auth), 30000);
  if (r.body.error) return { ok: false, error: r.body.error.message || JSON.stringify(r.body.error) };
  // Result name: customers/X/adGroupAds/AG~AD
  const rn = r.body.results?.[0]?.resourceName || '';
  const adId = (rn.split('~').pop() || '').trim();
  if (!adId) return { ok: false, error: 'no ad id returned' };
  return { ok: true, ad_id: adId };
}

// ── Mutate: pause the old RSA ───────────────────────────────────────────────
async function _pauseRSA(auth, adGroupId, adId) {
  const body = {
    operations: [{
      update: {
        resourceName: `customers/${auth.customerId}/adGroupAds/${adGroupId}~${adId}`,
        status: 'PAUSED',
      },
      updateMask: 'status',
    }],
  };
  const r = await _httpsJson('googleads.googleapis.com', `/v16/customers/${auth.customerId}/adGroupAds:mutate`, 'POST',
    JSON.stringify(body), _googleAdsHeaders(auth), 15000);
  if (r.body.error) return { ok: false, error: r.body.error.message || JSON.stringify(r.body.error) };
  return { ok: true };
}

// ── Log refresh decision ────────────────────────────────────────────────────
async function _logRefresh({ camp, oldAd, newCopy, newAdId, applied, error, runId }) {
  try {
    // tenant_id inherited from the parent campaign row.
    await _db.getPool().query(`
      INSERT INTO creative_refreshes
        (tenant_id, campaign_id, old_ad_id, old_headline, old_body,
         new_ad_id, new_headline, new_body, new_image_url,
         reason, perf_snapshot, applied, apply_error, run_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [
      camp.tenant_id, camp.id,
      oldAd?.id || null,
      (oldAd?.headlines || []).slice(0,3).join(' | ') || null,
      (oldAd?.descriptions || []).slice(0,2).join(' | ') || null,
      newAdId || null,
      (newCopy?.headlines || []).slice(0,3).join(' | ') || null,
      (newCopy?.descriptions || []).slice(0,2).join(' | ') || null,
      null,    // no image for RSA
      newCopy?.reason || null,
      JSON.stringify(oldAd?.perf72h || {}),
      !!applied,
      error || null,
      runId,
    ]);
  } catch (e) { console.error('[google-creative-refresh] log err:', e.message); }
}

// ── Staleness gate (mirrors Meta) ───────────────────────────────────────────
function _isStale(ad, targetRoas) {
  if (!ad.ageHours || ad.ageHours < STALE_AGE_HOURS) return null;
  const p = ad.perf72h || {};
  if ((p.spend || 0) < SPEND_FLOOR) return null;
  if (p.ctr < CTR_FLOOR) return `CTR ${(p.ctr*100).toFixed(2)}% < ${(CTR_FLOOR*100).toFixed(2)}% over $${p.spend.toFixed(2)} spent in 72h`;
  if (targetRoas && p.roas < 0.5 * targetRoas) return `ROAS ${p.roas.toFixed(2)}× < 50% of target ${targetRoas}× over $${p.spend.toFixed(2)} spent in 72h`;
  return null;
}

// ── Refresh one stale ad ────────────────────────────────────────────────────
async function _refreshOneAd({ camp, ad, reason, dryRun, runId, auth }) {
  const copy = await _generateRSACopy({
    campaignName: camp.name,
    oldHeadlines: ad.headlines,
    oldDescriptions: ad.descriptions,
    brandHint: camp.owner_email,
  });
  if (!copy.ok) {
    await _logRefresh({ camp, oldAd: ad, newCopy: { reason }, newAdId: null, applied: false, error: 'copy: ' + copy.error, runId });
    return { ok: false, step: 'copy', error: copy.error };
  }
  if (dryRun) {
    await _logRefresh({ camp, oldAd: ad, newCopy: { ...copy, reason: reason + ' [DRY-RUN — copy generated, not uploaded]' }, newAdId: null, applied: false, error: null, runId });
    return { ok: true, dryRun: true };
  }
  const finalUrl = ad.final_urls?.[0];
  if (!finalUrl) {
    await _logRefresh({ camp, oldAd: ad, newCopy: { ...copy, reason }, newAdId: null, applied: false, error: 'no final_url on source ad — cannot rebuild', runId });
    return { ok: false, step: 'config', error: 'final_url missing' };
  }
  const created = await _createRSA(auth, ad.adgroup_id, { headlines: copy.headlines, descriptions: copy.descriptions, finalUrl });
  if (!created.ok) {
    await _logRefresh({ camp, oldAd: ad, newCopy: { ...copy, reason }, newAdId: null, applied: false, error: 'create: ' + created.error, runId });
    return { ok: false, step: 'create', error: created.error };
  }
  const pauseR = await _pauseRSA(auth, ad.adgroup_id, ad.id).catch(e => ({ ok: false, error: e.message }));
  // Register new ad in our DB
  try {
    await _db.getPool().query(`
      INSERT INTO ad_creatives (tenant_id, campaign_id, platform_ad_id, adset_id, headlines, descriptions, final_url, status, generation, parent_ad_id)
      VALUES ($8,$1,$2,$3,$4,$5,$6,'paused_pending_review',COALESCE((SELECT MAX(generation)+1 FROM ad_creatives WHERE campaign_id=$1),2),$7)
      ON CONFLICT (campaign_id, platform_ad_id) DO NOTHING
    `, [camp.id, created.ad_id, ad.adgroup_id, JSON.stringify(copy.headlines), JSON.stringify(copy.descriptions), finalUrl, ad.id, camp.tenant_id]);
  } catch (e) { console.error('[google-creative-refresh] register err:', e.message); }
  await _logRefresh({
    camp, oldAd: ad,
    newCopy: { ...copy, reason: reason + (pauseR.ok ? ' — old RSA paused' : ' — WARN: old RSA pause failed: ' + pauseR.error) },
    newAdId: created.ad_id, applied: true, error: null, runId,
  });
  return { ok: true, newAdId: created.ad_id };
}

// ── Mutex-guarded entry point ───────────────────────────────────────────────
let _running = false;

async function _runUnsafe(opts = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const runId = 'gcr-' + Date.now();
  const camps = await _db.getPool().query(
    `SELECT * FROM ad_campaigns WHERE optimizer_enabled = true AND platform = 'google'`
  );
  // Re-acquire one access token per run to avoid the per-ad refresh chatter
  const auth = camps.rows.length ? await _refreshAccessToken() : { ok: true };
  if (!auth.ok) return { ok: false, error: auth.error };
  // creative_refresh_enabled / _dry_run are per-tenant — gate each campaign by
  // its own tenant's settings (cached per run) instead of a single global toggle.
  const readSetting = makeSettingsCache();
  let refreshed = 0, scanned = 0, skipped = 0, errors = 0;
  // Declared at function scope so the summary return below can reference it even
  // when there are no campaigns to iterate (otherwise: "dryRun is not defined").
  let dryRun = opts.dryRun !== undefined ? !!opts.dryRun : true;
  outer: for (const camp of camps.rows) {
    if (!opts.force) {
      const enabled = await readSetting(camp.tenant_id, 'creative_refresh_enabled', { v: true });
      if (!enabled.v) continue; // this tenant has creative refresh turned off
    }
    dryRun = opts.dryRun !== undefined ? !!opts.dryRun
      : !!(await readSetting(camp.tenant_id, 'creative_refresh_dry_run', { v: true })).v;
    const adsR = await fetchActiveRSAsGoogle(camp.platform_camp_id);
    if (!adsR.ok) { errors++; continue; }
    for (const ad of adsR.ads) {
      scanned++;
      const reason = _isStale(ad, parseFloat(camp.target_roas));
      if (!reason) { skipped++; continue; }
      if (refreshed + errors >= MAX_PER_RUN) {
        console.log(`[google-creative-refresh] hit MAX_PER_RUN=${MAX_PER_RUN} cap`);
        break outer;
      }
      const r = await _refreshOneAd({ camp, ad, reason, dryRun, runId, auth });
      if (r.ok) refreshed++; else errors++;
    }
  }
  return { ok: true, runId, dryRun, platform: 'google', scanned, refreshed, skipped, errors,
           cap: MAX_PER_RUN, capped: (refreshed + errors) >= MAX_PER_RUN,
           ranAt: new Date().toISOString() };
}

async function runGoogleCreativeRefreshOnce(opts = {}) {
  if (_running) return { ok: false, error: 'a Google creative-refresh run is already in flight — try again shortly' };
  _running = true;
  try { return await _runUnsafe(opts); }
  finally { _running = false; }
}

module.exports = { runGoogleCreativeRefreshOnce, fetchActiveRSAsGoogle };
