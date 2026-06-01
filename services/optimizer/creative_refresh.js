// Phase 8 — 72-hour Creative Auto-Refresh.
//
// For every campaign with optimizer_enabled AND creative_refresh_enabled,
// we periodically:
//   1. Pull the live ads under the campaign + their last-72h performance
//   2. Detect "stale" ads (CTR below floor OR ROAS < 0.5× target, AND >72h old)
//   3. Generate fresh copy via GPT-4o + a fresh image via gpt-image-1
//   4. Upload the new creative to Meta as a PAUSED ad in the same ad set
//      (kept paused regardless of LIVE/dry-run — humans approve before activation)
//   5. Pause the old underperforming ad (only in LIVE mode)
//   6. Log everything to creative_refreshes
//
// Meta is the only writeable platform this phase. Google/TikTok creative
// upload is significantly more involved and intentionally deferred.

const https = require('https');
const _db = require('../../db');
const { makeSettingsCache } = require('./schema');
const { resolveMetaAdsCredentials } = require('../credentials/vault');

const STALE_AGE_HOURS = 72;
const CTR_FLOOR       = 0.005;   // 0.5% — below this an ad with spend > floor is stale
const SPEND_FLOOR     = 25;      // need at least this much spend in last 72h to judge
const MAX_PER_RUN     = 20;      // hard cap on refreshes per run — prevents runaway OpenAI/Meta cost

let OpenAI = null;
try { OpenAI = require('openai'); } catch { /* openai package optional */ }
const _openai = (OpenAI && process.env.AI_INTEGRATIONS_OPENAI_API_KEY)
  ? new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
    })
  : null;

// ── Tiny HTTPS helper (mirrors platforms.js) ───────────────────────────────
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

// ── Fetch active ads under a Meta campaign + their 72h performance ─────────
async function fetchActiveAdsMeta(metaCampId, userId = null) {
  const _r = await resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok: false, error: _r.error };
  const token = _r.creds.accessToken;
  // Step 1: list ads under the campaign with their creative + adset
  const adsParams = new URLSearchParams({
    fields: 'id,name,adset_id,status,created_time,creative{id,object_story_spec,image_url,thumbnail_url,body,title}',
    limit: '50',
    access_token: token,
  });
  const adsR = await _httpsJson('graph.facebook.com', `/v19.0/${encodeURIComponent(metaCampId)}/ads?${adsParams}`, 'GET');
  if (adsR.body.error) return { ok: false, error: adsR.body.error.message };
  const ads = (adsR.body.data || []).filter(a => a.status === 'ACTIVE');
  if (ads.length === 0) return { ok: true, ads: [] };
  // Step 2: pull 72h insights for each ad in parallel
  const since = new Date(Date.now() - STALE_AGE_HOURS * 3600 * 1000).toISOString().slice(0,10);
  const until = new Date().toISOString().slice(0,10);
  const enriched = await Promise.all(ads.map(async (ad) => {
    const ip = new URLSearchParams({
      fields: 'spend,impressions,clicks,actions,action_values',
      time_range: JSON.stringify({ since, until }),
      access_token: token,
    });
    const ir = await _httpsJson('graph.facebook.com', `/v19.0/${ad.id}/insights?${ip}`, 'GET').catch(() => ({ body: {} }));
    const row = (ir.body && ir.body.data && ir.body.data[0]) || {};
    const spend = parseFloat(row.spend || 0);
    const imp   = parseInt(row.impressions || 0, 10);
    const clk   = parseInt(row.clicks || 0, 10);
    const ctr   = imp > 0 ? clk / imp : 0;
    const conv  = (row.actions || []).filter(a => /purchase|lead|complete_registration/.test(a.action_type)).reduce((s,a) => s + parseFloat(a.value || 0), 0);
    const rev   = (row.action_values || []).filter(a => /purchase|revenue/.test(a.action_type)).reduce((s,a) => s + parseFloat(a.value || 0), 0);
    const roas  = spend > 0 ? rev / spend : 0;
    const ageH  = ad.created_time ? (Date.now() - new Date(ad.created_time).getTime()) / 3600000 : 0;
    return { ...ad, perf72h: { spend, impressions: imp, clicks: clk, ctr, conversions: conv, revenue: rev, roas }, ageHours: ageH };
  }));
  return { ok: true, ads: enriched };
}

// ── Generate replacement copy via GPT-4o ───────────────────────────────────
async function _generateCopy({ campaignName, oldHeadline, oldBody, brandHint }) {
  if (!_openai) return { ok: false, error: 'OpenAI not configured' };
  try {
    const sys = 'You are a senior direct-response copywriter. Output ONLY valid JSON: {"headline":"...","body":"...","cta":"SHOP_NOW|LEARN_MORE|SIGN_UP|GET_OFFER"}. Headline ≤40 chars. Body ≤125 chars. Use a clearly different angle from the old creative.';
    const user = `Campaign: ${campaignName}\nBrand context: ${brandHint || '(none)'}\nOld headline that fatigued: ${oldHeadline || '(none)'}\nOld body that fatigued: ${oldBody || '(none)'}\n\nWrite a fresh angle that re-hooks the audience.`;
    const r = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role:'system', content: sys }, { role:'user', content: user }],
      response_format: { type: 'json_object' },
      max_tokens: 250,
    });
    const j = JSON.parse(r.choices[0].message.content || '{}');
    if (!j.headline || !j.body) return { ok: false, error: 'malformed copy' };
    return { ok: true, headline: String(j.headline).slice(0,40), body: String(j.body).slice(0,125), cta: j.cta || 'LEARN_MORE' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Generate replacement image via gpt-image-1 (returns base64) ────────────
async function _generateImage({ headline, body }) {
  if (!_openai) return { ok: false, error: 'OpenAI not configured' };
  try {
    const prompt = `Modern, eye-catching social ad creative, square format, vibrant but professional. Concept: "${headline}". Mood: ${body}. Clean composition, strong focal point, no embedded text. High-resolution, photorealistic.`;
    const r = await _openai.images.generate({
      model: 'gpt-image-1',
      prompt: prompt.slice(0, 1000),
      size: '1024x1024',
      n: 1,
    });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) return { ok: false, error: 'no image returned' };
    return { ok: true, b64, prompt };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Upload base64 image to Meta /adimages, return image_hash ───────────────
async function _uploadImageToMeta(adAccountId, b64, userId = null) {
  const _r = await resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok: false, error: _r.error };
  const token = _r.creds.accessToken;
  const acct  = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const params = new URLSearchParams({ access_token: token, bytes: b64 });
  const r = await _httpsJson('graph.facebook.com', `/v19.0/${acct}/adimages`, 'POST',
    params.toString(), { 'Content-Type':'application/x-www-form-urlencoded' }, 60000);
  if (r.body.error) return { ok: false, error: r.body.error.message };
  // Meta returns { images: { <filename>: { hash, url } } }
  const imgs = r.body.images || {};
  const first = Object.values(imgs)[0];
  if (!first || !first.hash) return { ok: false, error: 'no image hash returned' };
  return { ok: true, image_hash: first.hash, image_url: first.url };
}

// ── Create ad creative on Meta, return creative_id ─────────────────────────
async function _createMetaCreative(adAccountId, pageId, { headline, body, cta, link_url, image_hash }, userId = null) {
  const _r = await resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok: false, error: _r.error };
  const token = _r.creds.accessToken;
  const acct  = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const story = {
    page_id: pageId,
    link_data: {
      message: body,
      name: headline,
      link: link_url || 'https://www.facebook.com',
      image_hash,
      call_to_action: { type: cta, value: { link: link_url || 'https://www.facebook.com' } },
    },
  };
  const params = new URLSearchParams({
    access_token: token,
    name: `Auto-refresh ${headline.slice(0,30)} — ${new Date().toISOString().slice(0,10)}`,
    object_story_spec: JSON.stringify(story),
  });
  const r = await _httpsJson('graph.facebook.com', `/v19.0/${acct}/adcreatives`, 'POST',
    params.toString(), { 'Content-Type':'application/x-www-form-urlencoded' }, 30000);
  if (r.body.error) return { ok: false, error: r.body.error.message };
  if (!r.body.id)  return { ok: false, error: 'no creative id returned' };
  return { ok: true, creative_id: r.body.id };
}

// ── Create the new (PAUSED) ad on Meta ─────────────────────────────────────
async function _createMetaAd(adAccountId, adsetId, creativeId, name, userId = null) {
  const _r = await resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok: false, error: _r.error };
  const token = _r.creds.accessToken;
  const acct  = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const params = new URLSearchParams({
    access_token: token,
    name,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'PAUSED',  // ALWAYS paused — human approves before activation
  });
  const r = await _httpsJson('graph.facebook.com', `/v19.0/${acct}/ads`, 'POST',
    params.toString(), { 'Content-Type':'application/x-www-form-urlencoded' }, 30000);
  if (r.body.error) return { ok: false, error: r.body.error.message };
  return { ok: true, ad_id: r.body.id };
}

// ── Pause the old underperforming Meta ad ──────────────────────────────────
async function _pauseMetaAd(adId, userId = null) {
  const _r = await resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok: false, error: _r.error };
  const token = _r.creds.accessToken;
  const params = new URLSearchParams({ access_token: token, status: 'PAUSED' });
  const r = await _httpsJson('graph.facebook.com', `/v19.0/${adId}`, 'POST',
    params.toString(), { 'Content-Type':'application/x-www-form-urlencoded' }, 15000);
  if (r.body.error) return { ok: false, error: r.body.error.message };
  return { ok: true };
}

// ── Log a refresh decision to DB ───────────────────────────────────────────
async function _logRefresh({ camp, oldAd, newCreative, newAdId, applied, error, runId }) {
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
      oldAd?.creative?.title || oldAd?.creative?.name || null,
      oldAd?.creative?.body || null,
      newAdId || null,
      newCreative?.headline || null,
      newCreative?.body || null,
      newCreative?.image_url || null,
      newCreative?.reason || null,
      JSON.stringify(oldAd?.perf72h || {}),
      !!applied,
      error || null,
      runId,
    ]);
  } catch (e) { console.error('[creative-refresh] log err:', e.message); }
}

// ── Decide whether an ad is stale and needs refreshing ─────────────────────
function _isStale(ad, targetRoas) {
  if (!ad.ageHours || ad.ageHours < STALE_AGE_HOURS) return null;
  const p = ad.perf72h || {};
  if ((p.spend || 0) < SPEND_FLOOR) return null;  // not enough data to judge
  if (p.ctr < CTR_FLOOR) return `CTR ${(p.ctr*100).toFixed(2)}% < ${(CTR_FLOOR*100).toFixed(2)}% over $${p.spend.toFixed(2)} spent in 72h`;
  if (targetRoas && p.roas < 0.5 * targetRoas) return `ROAS ${p.roas.toFixed(2)}× < 50% of target ${targetRoas}× over $${p.spend.toFixed(2)} spent in 72h`;
  return null;
}

// ── Refresh one stale ad end-to-end ────────────────────────────────────────
async function _refreshOneAd({ camp, ad, reason, dryRun, runId }) {
  // 1. Generate copy
  const copy = await _generateCopy({
    campaignName: camp.name,
    oldHeadline: ad.creative?.title || ad.creative?.name,
    oldBody: ad.creative?.body,
    brandHint: camp.owner_email,
  });
  if (!copy.ok) {
    await _logRefresh({ camp, oldAd: ad, newCreative: { reason }, newAdId: null, applied: false, error: 'copy: ' + copy.error, runId });
    return { ok: false, step: 'copy', error: copy.error };
  }
  // 2. Generate image
  const img = await _generateImage({ headline: copy.headline, body: copy.body });
  if (!img.ok) {
    await _logRefresh({ camp, oldAd: ad, newCreative: { ...copy, reason }, newAdId: null, applied: false, error: 'image: ' + img.error, runId });
    return { ok: false, step: 'image', error: img.error };
  }
  // 3. In dry-run: stop here. Log the generated creative for review — but
  //    NEVER persist the raw base64 image (would balloon the DB row size).
  if (dryRun) {
    await _logRefresh({
      camp, oldAd: ad,
      newCreative: { ...copy, image_url: null, reason: reason + ' [DRY-RUN — copy + image generated, not uploaded]' },
      newAdId: null, applied: false, error: null, runId,
    });
    return { ok: true, dryRun: true };
  }
  // 4. LIVE: upload image → creative → ad (paused) → pause old ad
  const _metaResolved = await resolveMetaAdsCredentials(null);
  const adAccountId = _metaResolved.ok ? _metaResolved.creds.adAccountId : null;
  if (!adAccountId) {
    await _logRefresh({ camp, oldAd: ad, newCreative: { ...copy, reason }, newAdId: null, applied: false, error: 'Meta Ads not connected — link an account in Settings', runId });
    return { ok: false, step: 'config', error: 'Meta Ads not connected' };
  }
  const pageId = ad.creative?.object_story_spec?.page_id;
  if (!pageId) {
    await _logRefresh({ camp, oldAd: ad, newCreative: { ...copy, reason }, newAdId: null, applied: false, error: 'page_id missing on source creative — cannot rebuild', runId });
    return { ok: false, step: 'config', error: 'page_id missing' };
  }
  const linkUrl = ad.creative?.object_story_spec?.link_data?.link;
  const imgUp = await _uploadImageToMeta(adAccountId, img.b64);
  if (!imgUp.ok) {
    await _logRefresh({ camp, oldAd: ad, newCreative: { ...copy, reason }, newAdId: null, applied: false, error: 'upload: ' + imgUp.error, runId });
    return { ok: false, step: 'upload', error: imgUp.error };
  }
  const cre = await _createMetaCreative(adAccountId, pageId, { headline: copy.headline, body: copy.body, cta: copy.cta, link_url: linkUrl, image_hash: imgUp.image_hash });
  if (!cre.ok) {
    await _logRefresh({ camp, oldAd: ad, newCreative: { ...copy, image_url: imgUp.image_url, reason }, newAdId: null, applied: false, error: 'creative: ' + cre.error, runId });
    return { ok: false, step: 'creative', error: cre.error };
  }
  const newAd = await _createMetaAd(adAccountId, ad.adset_id, cre.creative_id, `Auto-refresh ${copy.headline.slice(0,30)}`);
  if (!newAd.ok) {
    await _logRefresh({ camp, oldAd: ad, newCreative: { ...copy, image_url: imgUp.image_url, reason }, newAdId: null, applied: false, error: 'ad: ' + newAd.error, runId });
    return { ok: false, step: 'ad', error: newAd.error };
  }
  // 5. Pause the old ad (best-effort)
  const pauseR = await _pauseMetaAd(ad.id).catch(e => ({ ok: false, error: e.message }));
  // 6. Log full success + register the new ad in our DB
  try {
    const camprow = await _db.getPool().query(`SELECT id FROM ad_campaigns WHERE id=$1`, [camp.id]);
    if (camprow.rows.length) {
      await _db.getPool().query(`
        INSERT INTO ad_creatives (tenant_id, campaign_id, platform_ad_id, adset_id, headline, body, image_hash, image_url, cta, link_url, status, generation, parent_ad_id)
        VALUES ($11,$1,$2,$3,$4,$5,$6,$7,$8,$9,'paused_pending_review',COALESCE((SELECT MAX(generation)+1 FROM ad_creatives WHERE campaign_id=$1),2),$10)
        ON CONFLICT (campaign_id, platform_ad_id) DO NOTHING
      `, [camp.id, newAd.ad_id, ad.adset_id, copy.headline, copy.body, imgUp.image_hash, imgUp.image_url, copy.cta, linkUrl, ad.id, camp.tenant_id]);
    }
  } catch (e) { console.error('[creative-refresh] register err:', e.message); }
  await _logRefresh({
    camp, oldAd: ad,
    newCreative: { ...copy, image_url: imgUp.image_url, reason: reason + (pauseR.ok ? ' — old ad paused' : ' — WARN: old ad pause failed: ' + pauseR.error) },
    newAdId: newAd.ad_id, applied: true, error: null, runId,
  });
  return { ok: true, newAdId: newAd.ad_id };
}

// ── Main run: scan all enabled Meta campaigns, refresh their stale ads ─────
// _running mutex covers BOTH the cron and the public /run-now endpoint so
// they cannot race and double-bill the OpenAI / Meta APIs.
let _timer = null, _running = false;

async function _runUnsafe(opts = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const runId = 'cr-' + Date.now();
  // Only Meta campaigns supported this phase
  const camps = await _db.getPool().query(
    `SELECT * FROM ad_campaigns WHERE optimizer_enabled = true AND platform IN ('meta','facebook')`
  );
  // creative_refresh_enabled / _dry_run are per-tenant — gate each campaign by
  // its own tenant's settings (cached per run) instead of a single global toggle.
  const readSetting = makeSettingsCache();
  let refreshed = 0, scanned = 0, skipped = 0, errors = 0;
  outer: for (const camp of camps.rows) {
    if (!opts.force) {
      const enabled = await readSetting(camp.tenant_id, 'creative_refresh_enabled', { v: true });
      if (!enabled.v) continue; // this tenant has creative refresh turned off
    }
    const dryRun = opts.dryRun !== undefined ? !!opts.dryRun
      : !!(await readSetting(camp.tenant_id, 'creative_refresh_dry_run', { v: true })).v;
    const adsR = await fetchActiveAdsMeta(camp.platform_camp_id);
    if (!adsR.ok) { errors++; continue; }
    for (const ad of adsR.ads) {
      scanned++;
      const reason = _isStale(ad, parseFloat(camp.target_roas));
      if (!reason) { skipped++; continue; }
      // Hard cap on generations per run — prevents runaway cost if hundreds
      // of stale ads pile up across many campaigns.
      if (refreshed + errors >= MAX_PER_RUN) {
        console.log(`[creative-refresh] hit MAX_PER_RUN=${MAX_PER_RUN} cap — remaining ads will be picked up next run`);
        break outer;
      }
      const r = await _refreshOneAd({ camp, ad, reason, dryRun, runId });
      if (r.ok) refreshed++; else errors++;
    }
  }
  return { ok: true, runId, dryRun, scanned, refreshed, skipped, errors,
           cap: MAX_PER_RUN, capped: (refreshed + errors) >= MAX_PER_RUN,
           ranAt: new Date().toISOString() };
}

// Single mutex-guarded entry point used by BOTH the cron and the HTTP /run-now
// endpoint, so they cannot run concurrently and double-spend on OpenAI/Meta.
async function runCreativeRefreshOnce(opts = {}) {
  if (_running) return { ok: false, error: 'a creative-refresh run is already in flight — try again shortly' };
  _running = true;
  try { return await _runUnsafe(opts); }
  finally { _running = false; }
}

async function _safeRun() {
  try {
    const s = await runCreativeRefreshOnce();
    console.log('[creative-refresh] run:', JSON.stringify(s));
  } catch (e) { console.error('[creative-refresh] err:', e.message); }
}

function startCreativeRefreshCron(intervalHours = 24) {
  if (_timer) return false;
  // First run delayed 5 min after boot (gives perf data time to land)
  setTimeout(_safeRun, 5 * 60 * 1000);
  _timer = setInterval(_safeRun, intervalHours * 3600 * 1000);
  return true;
}

module.exports = { runCreativeRefreshOnce, startCreativeRefreshCron, fetchActiveAdsMeta };
