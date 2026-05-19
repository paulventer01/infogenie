// Google Ads — Multi-Armed Bandit (Thompson sampling) at the AD GROUP level.
//
// Mirrors services/optimizer/bandit.js (Meta) but adapted for Google Ads:
//   - Google has CAMPAIGN-level shared budget (no per-ad-set budget), so the
//     reallocation handle here is the AD GROUP CPC BID (cpc_bid_micros).
//   - Smart-bidding campaigns (MAXIMIZE_*, TARGET_CPA, TARGET_ROAS, etc.) have
//     no manual CPC bids — those are skipped with a clear log message,
//     analogous to Meta's CBO skip.
//
// Every 12h we:
//   1. Pull active ad groups + 7-day perf via Google Ads Search (GAQL)
//   2. Thompson-sample Beta(conv+1, clicks-conv+1) × AOV per ad group
//   3. Compute new CPC bids by scaling current bid: new = old × (share / equalShare)
//      with floors (MIN_EXPLORE_SHARE, MIN_BID) and ceilings (MAX_ARM_SHARE, MAX_BID_MULT)
//   4. Mutate ad groups via Google Ads API (LIVE) or just log (dry-run).
//   5. Log every decision to bandit_allocations.

const https = require('https');
const _db = require('../../db');
const { getSetting } = require('./schema');
const { _betaSample } = require('./bandit');  // reuse Marsaglia-Tsang sampler
const { resolveGoogleAdsCredentials } = require('../credentials/vault');

const MIN_EXPLORE_SHARE = 0.10;
const MAX_ARM_SHARE     = 0.60;
const MIN_BID_USD       = 0.10;   // 10¢ floor — Google's hard min varies by mkt; safe default
const MAX_BID_MULT      = 5.0;    // never raise a bid >5× its current value in one tick
const MAX_PER_RUN       = 50;

const MANUAL_BIDDING_STRATEGIES = new Set([
  'MANUAL_CPC', 'ENHANCED_CPC',  // both expose cpc_bid_micros at the ad-group level
]);

// ── HTTPS helper ────────────────────────────────────────────────────────────
function _httpsJson(host, path, method, body, headers = {}, timeoutMs = 20000) {
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

// ── GAQL search helper ──────────────────────────────────────────────────────
async function _gaqlSearch(auth, gaql) {
  const r = await _httpsJson('googleads.googleapis.com', `/v16/customers/${auth.customerId}/googleAds:search`, 'POST',
    JSON.stringify({ query: gaql }),
    {
      'Content-Type':'application/json',
      'Authorization':`Bearer ${auth.accessToken}`,
      'developer-token': auth.devToken,
      ...(auth.loginCustomerId ? { 'login-customer-id': auth.loginCustomerId } : {}),
    });
  if (r.body.error) return { ok: false, error: r.body.error.message || JSON.stringify(r.body.error) };
  return { ok: true, results: r.body.results || [] };
}

// ── Fetch ad groups + 7d performance + bidding strategy ─────────────────────
async function fetchAdGroupsGoogle(platformCampId, days = 7) {
  const auth = await _refreshAccessToken();
  if (!auth.ok) return { ok: false, error: auth.error };
  const safeCampId = parseInt(String(platformCampId).replace(/[^0-9]/g,''), 10);
  if (!Number.isFinite(safeCampId) || safeCampId <= 0) return { ok: false, error: 'Invalid Google Ads campaign id' };

  // 1. Bidding strategy on the campaign
  const stratR = await _gaqlSearch(auth,
    `SELECT campaign.id, campaign.bidding_strategy_type FROM campaign WHERE campaign.id = ${safeCampId}`);
  if (!stratR.ok) return { ok: false, error: stratR.error };
  const stratRow = stratR.results[0];
  const strategy = stratRow?.campaign?.biddingStrategyType || 'UNKNOWN';
  if (!MANUAL_BIDDING_STRATEGIES.has(strategy)) {
    return { ok: true, adgroups: [], skipped: `Smart Bidding strategy "${strategy}" — bandit only operates on MANUAL_CPC / ENHANCED_CPC` };
  }

  // 2. Ad groups + their bids (no date segment)
  const agsR = await _gaqlSearch(auth,
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE campaign.id = ${safeCampId} AND ad_group.status = 'ENABLED'`);
  if (!agsR.ok) return { ok: false, error: agsR.error };
  const ags = agsR.results.map(r => ({
    platform_adset_id: String(r.adGroup.id),
    name: r.adGroup.name,
    daily_budget: parseInt(r.adGroup.cpcBidMicros || 0, 10) / 1e6,  // CPC bid in $ stored in daily_budget col
  }));
  if (ags.length === 0) return { ok: true, adgroups: [] };

  // 3. Aggregated metrics over the window per ad group
  const days7 = days <= 7 ? '7' : days <= 14 ? '14' : '30';
  const perfR = await _gaqlSearch(auth,
    `SELECT ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM ad_group WHERE campaign.id = ${safeCampId} AND segments.date DURING LAST_${days7}_DAYS`);
  if (!perfR.ok) return { ok: false, error: perfR.error };
  const perfMap = new Map();
  for (const row of perfR.results) {
    const id = String(row.adGroup.id);
    const existing = perfMap.get(id) || { spend:0, impressions:0, clicks:0, conversions:0, revenue:0 };
    existing.spend       += parseInt(row.metrics.costMicros || 0, 10) / 1e6;
    existing.impressions += parseInt(row.metrics.impressions || 0, 10);
    existing.clicks      += parseInt(row.metrics.clicks || 0, 10);
    existing.conversions += parseFloat(row.metrics.conversions || 0);
    existing.revenue     += parseFloat(row.metrics.conversionsValue || 0);
    perfMap.set(id, existing);
  }
  const enriched = ags.map(a => ({
    ...a,
    perf: perfMap.get(a.platform_adset_id) || { spend:0, impressions:0, clicks:0, conversions:0, revenue:0 },
  }));
  return { ok: true, adgroups: enriched };
}

// ── Apply CPC bid change to an ad group ─────────────────────────────────────
async function _applyAdGroupBid(auth, adGroupId, newBidUsd) {
  const micros = Math.max(Math.round(newBidUsd * 1e6), Math.round(MIN_BID_USD * 1e6));
  const body = {
    operations: [{
      update: {
        resourceName: `customers/${auth.customerId}/adGroups/${adGroupId}`,
        cpcBidMicros: String(micros),
      },
      updateMask: 'cpcBidMicros',
    }],
  };
  const r = await _httpsJson('googleads.googleapis.com', `/v16/customers/${auth.customerId}/adGroups:mutate`, 'POST',
    JSON.stringify(body),
    {
      'Content-Type':'application/json',
      'Authorization':`Bearer ${auth.accessToken}`,
      'developer-token': auth.devToken,
      ...(auth.loginCustomerId ? { 'login-customer-id': auth.loginCustomerId } : {}),
    }, 8000);
  if (r.body.error) return { ok: false, error: r.body.error.message || JSON.stringify(r.body.error) };
  return { ok: true };
}

// ── Upsert ad-group rows so allocations FK to a real id ─────────────────────
async function _upsertAdGroup(campaignId, a) {
  const r = await _db.getPool().query(`
    INSERT INTO ad_sets (campaign_id, platform_adset_id, name, daily_budget)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (campaign_id, platform_adset_id)
    DO UPDATE SET name=EXCLUDED.name,
                  daily_budget=COALESCE(EXCLUDED.daily_budget, ad_sets.daily_budget),
                  updated_at=now()
    RETURNING id
  `, [campaignId, a.platform_adset_id, a.name || null, a.daily_budget || null]);
  return r.rows[0].id;
}

// ── Compute new CPC bids from Thompson scores ───────────────────────────────
// Strategy: equalShare = 1/N. Each arm's multiplier = clamp(share / equalShare,
// 1/MAX_BID_MULT, MAX_BID_MULT). new_bid = clamp(old_bid × multiplier, MIN_BID, ∞).
// We do NOT enforce budget conservation here — Google handles that via the
// shared campaign daily budget. We only redirect bid pressure within the cap.
function _computeBidAllocation(adgroups) {
  const N = adgroups.length;
  const equalShare = 1 / N;
  const scored = adgroups.map(a => {
    const conv  = Math.max(a.perf.conversions || 0, 0);
    const clk   = Math.max(a.perf.clicks || 0, 0);
    const alpha = conv + 1;
    const beta  = Math.max(clk - conv, 0) + 1;
    const sample= _betaSample(alpha, beta);
    const aov   = conv > 0 ? (a.perf.revenue || 0) / conv : 1;
    const score = Math.max(sample * Math.max(aov, 0.01), 1e-6);
    return { ...a, prior:{ alpha, beta }, sample, aov, score };
  });
  const totalScore = scored.reduce((s,x) => s + x.score, 0) || 1;
  // Apply share floors/ceilings same as Meta bandit
  const minShare = Math.min(MIN_EXPLORE_SHARE, equalShare);
  const maxShare = Math.max(MAX_ARM_SHARE, minShare);
  scored.forEach(x => { x.share = x.score / totalScore; });
  const locked = new Array(N).fill(false);
  for (let iter = 0; iter < N + 1; iter++) {
    const lockedSum = scored.reduce((s,x,i) => s + (locked[i] ? x.share : 0), 0);
    const free = Math.max(1 - lockedSum, 0);
    const freeScore = scored.reduce((s,x,i) => s + (locked[i] ? 0 : x.score), 0) || 1;
    scored.forEach((x,i) => { if (!locked[i]) x.share = free * x.score / freeScore; });
    let worstIdx = -1, worstViol = 0, atMax = false;
    scored.forEach((x,i) => {
      if (locked[i]) return;
      if (x.share > maxShare) {
        const v = x.share - maxShare;
        if (v > worstViol) { worstViol = v; worstIdx = i; atMax = true; }
      } else if (x.share < minShare) {
        const v = minShare - x.share;
        if (v > worstViol) { worstViol = v; worstIdx = i; atMax = false; }
      }
    });
    if (worstIdx < 0) break;
    scored[worstIdx].share = atMax ? maxShare : minShare;
    locked[worstIdx] = true;
  }
  // Now translate share → multiplicative bid adjustment
  scored.forEach(x => {
    const rawMult = x.share / equalShare;
    const mult = Math.max(1 / MAX_BID_MULT, Math.min(MAX_BID_MULT, rawMult));
    const newBid = Math.max(MIN_BID_USD, (x.daily_budget || MIN_BID_USD) * mult);
    x.newBid = Math.round(newBid * 100) / 100;
    x.multiplier = mult;
  });
  return scored;
}

// ── Log allocation decision ─────────────────────────────────────────────────
async function _logAlloc({ campaignId, adSetId, runId, arm, oldBid, newBid, applied, error, reason }) {
  try {
    await _db.getPool().query(`
      INSERT INTO bandit_allocations
        (campaign_id, ad_set_id, run_id, prior_alpha, prior_beta,
         sampled_score, avg_value, old_budget, new_budget, share,
         applied, apply_error, reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      campaignId, adSetId, runId,
      arm.prior.alpha, arm.prior.beta,
      arm.sample, arm.aov,
      oldBid, newBid, arm.share,
      !!applied, error || null, reason || null,
    ]);
  } catch (e) { console.error('[google-bandit] log err:', e.message); }
}

// ── Run one campaign ────────────────────────────────────────────────────────
async function _runOneCampaign({ camp, dryRun, runId, perRunLeft }) {
  const adsR = await fetchAdGroupsGoogle(camp.platform_camp_id);
  if (!adsR.ok) return { ok: false, error: adsR.error, applied: 0, scanned: 0 };
  if (adsR.skipped) return { ok: true, error: adsR.skipped, applied: 0, scanned: 0 };
  if (adsR.adgroups.length < 2) {
    return { ok: true, error: 'fewer than 2 ad groups — bandit needs at least 2 arms', applied: 0, scanned: adsR.adgroups.length };
  }
  const allocation = _computeBidAllocation(adsR.adgroups);
  const auth = await _refreshAccessToken();  // re-acquire (was used in fetch)
  if (!auth.ok) return { ok: false, error: auth.error, applied: 0, scanned: 0 };
  let applied = 0, errors = 0;
  for (const arm of allocation) {
    if (perRunLeft.n <= 0) break;
    perRunLeft.n--;
    const adSetId = await _upsertAdGroup(camp.id, arm);
    const oldBid = arm.daily_budget || 0;
    const newBid = arm.newBid;
    const reason = `Thompson sample ${arm.sample.toFixed(4)} × AOV $${arm.aov.toFixed(2)} → ${(arm.share*100).toFixed(1)}% share → bid mult ×${arm.multiplier.toFixed(2)}`;
    if (dryRun) {
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBid, newBid, applied: false, error: null, reason: reason + ' [DRY-RUN]' });
      continue;
    }
    const diff = Math.abs(newBid - oldBid);
    if (diff < 0.01 || (oldBid > 0 && diff / oldBid < 0.10)) {
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBid, newBid: oldBid, applied: false, error: null, reason: reason + ' (no change — within ±$0.01 / 10%)' });
      continue;
    }
    const r = await _applyAdGroupBid(auth, arm.platform_adset_id, newBid);
    if (r.ok) {
      applied++;
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBid, newBid, applied: true, error: null, reason });
    } else {
      errors++;
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBid, newBid, applied: false, error: r.error, reason });
    }
  }
  return { ok: true, applied, errors, scanned: allocation.length };
}

// ── Mutex-guarded entry point ───────────────────────────────────────────────
let _running = false;
async function _runUnsafe(opts = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const enabled = await getSetting('bandit_enabled', { v: false });
  if (!enabled.v && !opts.force) return { ok: true, skipped: 'bandit disabled' };
  const dryRun = opts.dryRun !== undefined ? !!opts.dryRun : !!(await getSetting('bandit_dry_run', { v: true })).v;
  const runId  = 'gbd-' + Date.now();
  const camps  = await _db.getPool().query(
    `SELECT * FROM ad_campaigns WHERE optimizer_enabled = true AND platform = 'google'`
  );
  const perRunLeft = { n: MAX_PER_RUN };
  let totalApplied = 0, totalErrors = 0, totalScanned = 0;
  const perCampaign = [];
  for (const camp of camps.rows) {
    if (perRunLeft.n <= 0) break;
    const r = await _runOneCampaign({ camp, dryRun, runId, perRunLeft });
    totalApplied += (r.applied || 0);
    totalErrors  += (r.errors  || 0);
    totalScanned += (r.scanned || 0);
    perCampaign.push({ campaign: camp.name, scanned: r.scanned, applied: r.applied, errors: r.errors, error: r.error || null });
  }
  return {
    ok: true, runId, dryRun, platform: 'google',
    campaigns: camps.rows.length, scanned: totalScanned,
    applied: totalApplied, errors: totalErrors,
    cap: MAX_PER_RUN, capped: perRunLeft.n <= 0,
    perCampaign, ranAt: new Date().toISOString(),
  };
}

async function runGoogleBanditOnce(opts = {}) {
  if (_running) return { ok: false, error: 'a Google bandit run is already in flight — try again shortly' };
  _running = true;
  try { return await _runUnsafe(opts); }
  finally { _running = false; }
}

module.exports = { runGoogleBanditOnce, fetchAdGroupsGoogle, _computeBidAllocation };
