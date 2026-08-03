// Meta ad library · notify · GA4 · GSC routes.
// Extracted verbatim from server.js (pure structural move — no behavior change).
// Shared module-scope helpers are injected via `ctx`.
// __dirname and relative require() are rebased to the app root so the moved code
// (originally at server.js, project root) resolves paths exactly as before.
// NOTE: _normForMatch, acceptablePageNames intentionally NOT destructured — undeclared
// reference(s) in server.js guarded by try/catch; left bare to preserve behavior.
const __path__ = require('path');
const __APP_ROOT__ = __path__.join(__dirname, '..', '..');
const __root_require__ = (p) =>
  (typeof p === 'string' && (p.startsWith('./') || p.startsWith('../')))
    ? require(__path__.resolve(__APP_ROOT__, p))
    : require(p);

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { _chargeBudget, _credentialsVault, _missingCreds, _send429IfBudget } = ctx;
  const _tenantCtx = require('./services/tenants/context');
  const { recordJourneyEvent } = require('./services/company_overview/journey');

  function _domainFromSiteUrl(siteUrl) {
    const s = String(siteUrl || '');
    if (s.startsWith('sc-domain:')) return s.slice('sc-domain:'.length).replace(/^www\./, '');
    try {
      return new URL(s).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  }

  async function _markAnalyticsJourney(req, siteUrl, source) {
    const dom = _domainFromSiteUrl(siteUrl);
    if (!dom) return;
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'analytics:journey' });
      await recordJourneyEvent(tid, dom, 'analytics', { source });
    } catch (_) { /* non-fatal */ }
  }

app.post('/api/meta-ad-library/search', async (req, res) => {
  const { query = '', domain = '', country = 'US', limit = 25 } = req.body || {};
  const term = (query || domain || '').toString().trim();
  if (!term) return res.status(400).json({ ok:false, error:'query or domain required' });

  const _maRes = await _credentialsVault.resolveMetaAdsCredentials(req.user && req.user.id ? req.user.id : null);
  const token = _maRes.ok ? _maRes.creds.accessToken : null;
  let metaErr = null;

  // Attempt 1: official Meta Graph API
  if (token) {
    try {
      const fields = [
        'id','ad_creation_time','ad_creative_bodies','ad_creative_link_titles',
        'ad_creative_link_descriptions','page_name','publisher_platforms',
        'ad_snapshot_url','ad_delivery_start_time','ad_delivery_stop_time'
      ].join(',');
      const url = `https://graph.facebook.com/v19.0/ads_archive`
        + `?search_terms=${encodeURIComponent(term)}`
        + `&ad_reached_countries=['${country}']`
        + `&ad_active_status=ALL&fields=${fields}`
        + `&limit=${Math.min(limit, 50)}&access_token=${token}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!j.error) {
        const ads = (j.data || []).map(a => ({
          id: a.id, page: a.page_name, platforms: a.publisher_platforms || [],
          bodies: a.ad_creative_bodies || [], titles: a.ad_creative_link_titles || [],
          descs: a.ad_creative_link_descriptions || [],
          startedAt: a.ad_delivery_start_time, stoppedAt: a.ad_delivery_stop_time || null,
          isRunning: !a.ad_delivery_stop_time, snapshot: a.ad_snapshot_url,
        }));
        const running = ads.filter(a => a.isRunning).length;
        return res.json({
          ok:true, configured:true, term, country,
          count: ads.length, runningCount: running, ads,
          dataOrigin:'live_meta_ad_library',
          dataSource:'graph.facebook.com/v19.0/ads_archive',
          confidence: ads.length >= 5 ? 'high' : ads.length > 0 ? 'medium' : 'low',
        });
      }
      metaErr = j.error.message + (j.error.error_user_msg ? ` — ${j.error.error_user_msg}` : '');
      console.log(`[meta-ad-library] Graph API rejected (${j.error.code}/${j.error.error_subcode}): ${j.error.message} — falling back to Firecrawl scrape`);
    } catch (err) {
      metaErr = err.message;
      console.log(`[meta-ad-library] Graph API failed: ${err.message} — falling back to Firecrawl scrape`);
    }
  } else {
    metaErr = "Meta Ads not connected — link your account in Settings → Meta Ads Manager.";
  }

  // No Firecrawl fallback: Meta's Ad Library renders ad cards via JS that
  // static scraping can't reliably attribute to a specific advertiser. The
  // keyword search also returns unrelated Pages that share a substring.
  // Per the user's "100% accurate data only" requirement, we do NOT scrape
  // — instead we return the Meta API error so the frontend shows the
  // identity-confirmation guidance + a deeplink for manual lookup.
  const domainBase = String(domain || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split('.')[0];
  if (false && process.env.FIRECRAWL_API_KEY) {
    try {
      const searchTerm = (domainBase && domainBase.length >= 3 && domainBase.length > term.length) ? domainBase : term;
      const scrapeUrl = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(country)}&q=${encodeURIComponent(searchTerm)}&search_type=keyword_unordered`;
      const fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method:'POST',
        headers:{ 'Authorization':`Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ url: scrapeUrl, formats:['markdown','html'], waitFor: 4000, timeout: 25000 })
      });
      const fcJson = await fcResp.json();
      if (fcJson.success && (fcJson.data?.markdown || fcJson.data?.html)) {
        const md = String(fcJson.data.markdown || '');
        // Parse ad cards from markdown. Strategy: split the document at every
        // "Library ID:" marker — each chunk between two markers is one ad
        // card. This avoids cross-card bleed when extracting body text.
        const ads = [];
        const seen = new Set();
        const VALID_PLATFORMS = ['facebook','instagram','messenger','audience network','threads'];
        const idMatches = [...md.matchAll(/Library ID:\s*(\d{6,})/gi)];
        for (let i = 0; i < idMatches.length && ads.length < limit; i++) {
          const m = idMatches[i];
          const id = m[1];
          if (seen.has(id)) continue;
          seen.add(id);
          // Card = text between this Library ID marker and the next one.
          const next = idMatches[i + 1] ? idMatches[i + 1].index : Math.min(m.index + 1500, md.length);
          const card = md.slice(m.index, next);
          const startMatch = /Started running on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(card);
          // Date range pattern that often appears on cards in the form
          // "Mar 13, 2026 - Apr 26, 2026" — first date is start, second stop.
          const rangeMatch = /([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\s*[-–]\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/.exec(card);
          // Platforms: only keep tokens that match Meta's known surfaces.
          // Match known platform phrases directly so multi-word surfaces
          // like "audience network" aren't broken by whitespace tokenisation.
          const platforms = [];
          const platMatch = /(?:Platforms?|Ran on)[\s·:]+([^\n]{1,80})/i.exec(card);
          if (platMatch) {
            const haystack = platMatch[1].toLowerCase();
            for (const surface of VALID_PLATFORMS) {
              if (haystack.includes(surface) && !platforms.includes(surface)) platforms.push(surface);
            }
          }
          // Body: take lines that look like real ad copy — strip metadata,
          // image tags, links, date ranges, and short fragments.
          const isDateLine = s => /^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\s*[-–]\s*[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\s*$/.test(s);
          const lines = card.split('\n')
            .map(s => s.trim())
            .filter(s => s
              && s.length >= 30
              && !/^Library ID:/i.test(s)
              && !/^Started running on/i.test(s)
              && !/^Sponsored$/i.test(s)
              && !/^Platforms?[\s·:]/i.test(s)
              && !/^This ad (has|is)/i.test(s)
              && !/^\d+ ads? use this/i.test(s)
              && !/^!\[/.test(s)
              && !/^\[!\[/.test(s)
              && !/^\(https?:/.test(s)
              && !/^See ad details/i.test(s)
              && !isDateLine(s)
            );
          const body = lines.slice(0, 1).join(' ').replace(/\s+/g, ' ').slice(0, 400);
          // Page name: usually appears as a bold/heading near the top of the
          // card; fall back to the search term if we can't extract one.
          // Page name extraction. Meta's Ad Library markup places the
          // advertiser name in the image alt-text of the ad creative
          // thumbnail, e.g. `![Marriott Bonvoy](https://scontent...)`.
          // Try multiple patterns in priority order. NEVER fall back to
          // the search term — unknown attribution must remain unknown so
          // the strict filter drops it.
          let pageName = '';
          // Pattern 1: image alt right after the card metadata block
          const altMatch = /!\[([A-Za-z0-9][A-Za-z0-9 .,'&!?\-]{1,80})\]\(https?:\/\/[^\)]*(?:fbcdn|scontent)[^\)]*\)/.exec(card);
          if (altMatch) pageName = altMatch[1].trim();
          // Pattern 2: page link to facebook.com/<pageHandle>/ (display text)
          if (!pageName) {
            const linkMatch = /\[([A-Za-z0-9][A-Za-z0-9 .,'&!?\-]{1,80})\]\(https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._-]+\/?\)/.exec(card);
            if (linkMatch) pageName = linkMatch[1].trim();
          }
          // Pattern 3: markdown heading with the advertiser
          if (!pageName) {
            const pageHeading = /^#+\s+([A-Za-z0-9][A-Za-z0-9 .,'&!?\-]{2,60})$/m.exec(card);
            if (pageHeading) pageName = pageHeading[1].trim();
          }
          const startedAt = startMatch ? startMatch[1].trim() : (rangeMatch ? rangeMatch[1] : null);
          const stoppedAt = rangeMatch ? rangeMatch[2] : null;
          ads.push({
            id, page: pageName, platforms,
            bodies: body ? [body] : [], titles: [], descs: [],
            startedAt, stoppedAt,
            // If we have an explicit stop date in the past, this ad is no
            // longer running. Otherwise assume active (the search filter
            // includes both active + inactive so we can't be 100% sure).
            isRunning: !stoppedAt || (Date.parse(stoppedAt) > Date.now()),
            snapshot: `https://www.facebook.com/ads/library/?id=${id}`,
            note: body ? null : 'Ad copy is rendered inside Meta\'s iframe — click "View on Meta" to see the creative.',
          });
        }
        // Strict accuracy filter: only keep ads whose pageName matches the
        // competitor or domain. Drops random Pages like "Forex DeCock"
        // that share a substring with the keyword.
        // Strict matcher: pageNorm must CONTAIN one of the acceptable names.
        // Reverse direction (name contains pageNorm) is removed because it
        // admits partial pages (e.g. page "plus" matching competitor
        // "plus500"). Page name is required — ads with unknown attribution
        // are dropped, never assumed to belong to the competitor.
        const matchedAds = acceptablePageNames.length
          ? ads.filter(a => {
              const pageNorm = _normForMatch(a.page);
              if (!pageNorm) return false;
              return acceptablePageNames.some(name =>
                name.length >= 3 && pageNorm.includes(name)
              );
            })
          : ads;
        const droppedCount = ads.length - matchedAds.length;
        if (matchedAds.length) {
          const runningCount = matchedAds.filter(a => a.isRunning).length;
          return res.json({
            ok:true, configured:true, term, country,
            count: matchedAds.length, runningCount, ads: matchedAds,
            dataOrigin:'firecrawl_scrape_meta_ad_library',
            dataSource:'facebook.com/ads/library (scraped via Firecrawl — Meta API unavailable)',
            confidence: matchedAds.length >= 5 ? 'medium' : 'low',
            fallbackReason: metaErr || 'Meta Graph API not authorised',
            droppedUnrelated: droppedCount,
          });
        }
        // No matching ads — either the competitor doesn't advertise on Meta,
        // or the scrape only returned unrelated Pages. Return a clear
        // "no real data" response with a manual-search deeplink, NOT a
        // random page that happens to share a substring.
        const manualUrl = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(country)}&q=${encodeURIComponent(searchTerm)}&search_type=keyword_unordered`;
        return res.json({
          ok:true, configured:true, term, country, count:0, runningCount:0, ads:[],
          error: ads.length
            ? `Meta's Ad Library returned ${ads.length} ad${ads.length>1?'s':''}, but none belonged to ${term} (the keyword matched unrelated Pages). The competitor may not be running ads on Meta in ${country}.`
            : `Meta Graph API: ${metaErr}. Firecrawl scraped facebook.com/ads/library but found no ads for "${term}" in ${country}.`,
          dataOrigin:'firecrawl_scrape_meta_ad_library',
          droppedUnrelated: droppedCount,
          manualSearchUrl: manualUrl,
        });
      }
      var fcFailErr = fcJson.error || 'firecrawl returned no markdown';
      console.warn(`[meta-ad-library] Firecrawl scrape failed:`, fcFailErr);
    } catch (err) {
      var fcFailErr = err.message;
      console.warn(`[meta-ad-library] Firecrawl scrape exception:`, err.message);
    }
  }

  // Meta Graph API unavailable — return the error so the frontend shows
  // the identity-confirmation guidance + a deeplink for manual lookup.
  // We deliberately do NOT scrape because Meta's keyword search returns
  // unrelated advertisers and we promised the user 100% accurate data.
  const manualSearchTerm = (domainBase && domainBase.length >= 3 && domainBase.length > term.length) ? domainBase : term;
  return res.json({
    ok:true, configured:!!token, ads:[],
    error: metaErr || 'Meta Ad Library unavailable',
    // Use search_type=page so the user lands on a list of matching
    // Facebook Pages (not Meta's keyword search, which mixes in unrelated
    // advertisers). They click the real competitor Page → see only its ads.
    manualSearchUrl: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(country)}&q=${encodeURIComponent(manualSearchTerm)}&search_type=page`,
  });
});

// ─── Notify (Slack / Telegram / Teams webhooks) ──────────────────────────────
// POST /api/notify/send { channel, webhookUrl|botToken+chatId, text, title? }
//
// Defense-in-depth (added per architect review 2026-04-30):
//  1. Strict canonical-URL validation via new URL() + hostname allowlist —
//     never regex alone (prevents URL-parser-confusion SSRF).
//  2. Per-IP rate limit (sliding window, in-memory). 30 req / 60s.
//  3. Optional shared-secret gate via INFOGENIE_NOTIFY_SECRET — when set,
//     requests must include matching X-InfoGenie-Token header.
//  4. fetch with redirect:'error' + 8s timeout to stop chains/long polls.
//  5. Outgoing payloads are size-capped (already 3500 chars).
const _NOTIFY_RL = new Map(); // ip → number[] (timestamps within window)
const _NOTIFY_RL_WINDOW_MS = 60_000;
const _NOTIFY_RL_MAX = 30;
function _notifyRateLimitOk(ip) {
  const now = Date.now();
  const arr = (_NOTIFY_RL.get(ip) || []).filter(t => now - t < _NOTIFY_RL_WINDOW_MS);
  if (arr.length >= _NOTIFY_RL_MAX) { _NOTIFY_RL.set(ip, arr); return false; }
  arr.push(now);
  _NOTIFY_RL.set(ip, arr);
  // Janitor: keep map small
  if (_NOTIFY_RL.size > 500) {
    for (const [k, v] of _NOTIFY_RL) {
      if (!v.length || now - v[v.length-1] > _NOTIFY_RL_WINDOW_MS * 5) _NOTIFY_RL.delete(k);
    }
  }
  return true;
}
async function _safeOutboundFetch(url, opts, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, redirect: 'error', signal: ctrl.signal });
  } finally { clearTimeout(t); }
}
app.post('/api/notify/send', async (req, res) => {
  try {
    // 1. Optional shared-secret gate
    if (process.env.INFOGENIE_NOTIFY_SECRET) {
      const supplied = req.headers['x-infogenie-token'] || req.body?._token;
      if (supplied !== process.env.INFOGENIE_NOTIFY_SECRET) {
        return res.status(401).json({ ok:false, error:'unauthorized', dataOrigin:'auth_check' });
      }
    }
    // 2. Per-IP rate limit
    const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.ip || req.socket?.remoteAddress || 'unknown';
    if (!_notifyRateLimitOk(ip)) {
      return res.status(429).json({ ok:false, error:'rate_limit_exceeded', retryAfterSec:60 });
    }

    const { channel, webhookUrl, botToken, chatId, text, title } = req.body || {};
    if (!text) return res.status(400).json({ ok:false, error:'text required' });
    if (!['slack','teams','telegram'].includes(channel)) {
      return res.status(400).json({ ok:false, error:'channel must be slack|teams|telegram' });
    }
    const safeText = String(text).slice(0, 3500);
    const baseMeta = { dataOrigin:'live_webhook', confidence:'high' };

    // 3. Canonical-URL parse + hostname allowlist (Slack & Teams)
    let parsed = null;
    if (channel !== 'telegram') {
      if (!webhookUrl || typeof webhookUrl !== 'string') {
        return res.status(400).json({ ok:false, error:'webhookUrl required' });
      }
      try { parsed = new URL(webhookUrl); }
      catch { return res.status(400).json({ ok:false, error:'invalid webhookUrl' }); }
      if (parsed.protocol !== 'https:') return res.status(400).json({ ok:false, error:'webhookUrl must be https' });
    }

    if (channel === 'slack') {
      if (parsed.hostname !== 'hooks.slack.com') {
        return res.status(400).json({ ok:false, error:'Slack webhook host must be hooks.slack.com' });
      }
      const r = await _safeOutboundFetch(webhookUrl, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text: title ? `*${title}*\n${safeText}` : safeText })
      });
      if (!r.ok) return res.json({ ok:false, error:`Slack returned ${r.status}`, ...baseMeta, dataSource:'hooks.slack.com' });
      return res.json({ ok:true, channel:'slack', ...baseMeta, dataSource:'hooks.slack.com' });
    }
    if (channel === 'teams') {
      // Allow only Microsoft Teams Incoming Webhook hosts:
      // <tenant>.webhook.office.com  (legacy)  OR  outlook.office.com (some tenants)
      const okHost = /^[a-z0-9-]+\.webhook\.office\.com$/i.test(parsed.hostname)
                  || parsed.hostname === 'outlook.office.com'
                  || parsed.hostname === 'outlook.office365.com';
      if (!okHost) {
        return res.status(400).json({ ok:false, error:'Teams webhook host must be *.webhook.office.com' });
      }
      const r = await _safeOutboundFetch(webhookUrl, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          '@type':'MessageCard', '@context':'https://schema.org/extensions',
          themeColor:'0066FF', summary: title || 'InfoGenie alert',
          title: title || 'InfoGenie alert', text: safeText
        })
      });
      if (!r.ok) return res.json({ ok:false, error:`Teams returned ${r.status}`, ...baseMeta, dataSource: parsed.hostname });
      return res.json({ ok:true, channel:'teams', ...baseMeta, dataSource: parsed.hostname });
    }
    // Telegram — host is fixed; bot token must look right
    if (!botToken || !chatId) {
      return res.status(400).json({ ok:false, error:'botToken + chatId required for Telegram' });
    }
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(String(botToken))) {
      return res.status(400).json({ ok:false, error:'botToken format invalid' });
    }
    const tgUrl = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
    const r = await _safeOutboundFetch(tgUrl, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: title ? `${title}\n${safeText}` : safeText, parse_mode:'Markdown' })
    });
    const j = await r.json();
    if (!j.ok) return res.json({ ok:false, error: j.description || `Telegram returned ${r.status}`, ...baseMeta, dataSource:'api.telegram.org' });
    return res.json({ ok:true, channel:'telegram', ...baseMeta, dataSource:'api.telegram.org' });
  } catch (err) {
    if (err?.name === 'AbortError') return res.status(504).json({ ok:false, error:'webhook timeout' });
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ─── Google Service Account helper (for GA4 + GSC) ──────────────────────────
// Mints + caches an access token from a GOOGLE_SERVICE_ACCOUNT_JSON secret
// (raw JSON or base64). Cached for ~50min per scope.
let _googleSAToken = null;
let _googleSATokenExp = 0;
async function _getGoogleSAToken(scopes) {
  const now = Date.now();
  if (_googleSAToken && _googleSAToken._scopes === scopes && now < _googleSATokenExp) {
    return _googleSAToken.token;
  }
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  if (!raw.trim().startsWith('{')) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch(e){}
  }
  const sa = JSON.parse(raw);
  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({alg:'RS256', typ:'JWT'})).toString('base64url');
  const iat = Math.floor(Date.now()/1000);
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: scopes,
    aud: 'https://oauth2.googleapis.com/token',
    exp: iat + 3600, iat,
  })).toString('base64url');
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key, 'base64url');
  const jwt = `${signingInput}.${sig}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('SA token exchange failed: ' + (j.error_description || JSON.stringify(j)));
  _googleSAToken = { token: j.access_token, _scopes: scopes };
  _googleSATokenExp = Date.now() + (j.expires_in - 120) * 1000;
  return j.access_token;
}

// ─── GA4 Data API ────────────────────────────────────────────────────────────
app.post('/api/ga4/run-report', async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return _missingCreds(res, 'ga4', ['GOOGLE_SERVICE_ACCOUNT_JSON']);
  try {
    const { propertyId, days = 28,
      metrics = ['sessions','totalUsers','conversions','totalRevenue','engagementRate','bounceRate'],
      dimensions = ['date'] } = req.body || {};
    if (!propertyId) return res.status(400).json({ ok:false, error:'propertyId required (numeric, e.g. 12345678)' });
    const token = await _getGoogleSAToken('https://www.googleapis.com/auth/analytics.readonly');
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        metrics: metrics.map(m => ({ name:m })),
        dimensions: dimensions.map(d => ({ name:d })),
      })
    });
    const j = await r.json();
    if (j.error) return res.json({ ok:false, configured:true, error: j.error.message });
    res.json({
      ok:true, configured:true, propertyId, days,
      rows: (j.rows || []).map(row => ({
        dims: row.dimensionValues?.map(v => v.value) || [],
        metrics: Object.fromEntries((row.metricValues || []).map((v,i) => [metrics[i], +v.value || v.value]))
      })),
      dataOrigin:'live_ga4', dataSource:'analyticsdata.googleapis.com/v1beta runReport',
      confidence:'high'
    });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

app.get('/api/ga4/properties', async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return _missingCreds(res, 'ga4', ['GOOGLE_SERVICE_ACCOUNT_JSON']);
  try {
    const token = await _getGoogleSAToken('https://www.googleapis.com/auth/analytics.readonly');
    const r = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
      headers:{ 'Authorization':`Bearer ${token}` }
    });
    const j = await r.json();
    const flat = [];
    for (const acc of (j.accountSummaries || [])) {
      for (const prop of (acc.propertySummaries || [])) {
        flat.push({ account: acc.displayName, property: prop.displayName, propertyId: prop.property?.split('/').pop() });
      }
    }
    res.json({ ok:true, configured:true, properties: flat,
      dataOrigin:'live_ga4', dataSource:'analyticsadmin.googleapis.com/v1beta accountSummaries', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

// ─── Google Search Console API ───────────────────────────────────────────────
app.post('/api/gsc/query', async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return _missingCreds(res, 'gsc', ['GOOGLE_SERVICE_ACCOUNT_JSON']);
  try {
    const { siteUrl, days = 28, dimensions = ['query'], rowLimit = 100 } = req.body || {};
    if (!siteUrl) return res.status(400).json({ ok:false, error:'siteUrl required (e.g. https://yourdomain.com/ or sc-domain:yourdomain.com)' });
    const token = await _getGoogleSAToken('https://www.googleapis.com/auth/webmasters.readonly');
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - days);
    const fmt = d => d.toISOString().slice(0,10);
    const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions, rowLimit })
    });
    const j = await r.json();
    if (j.error) return res.json({ ok:false, configured:true, error: j.error.message });
    void _markAnalyticsJourney(req, siteUrl, 'gsc');
    res.json({
      ok:true, configured:true, siteUrl, days,
      rows: (j.rows || []).map(row => ({
        keys: row.keys || [],
        clicks: row.clicks, impressions: row.impressions,
        ctr: +(row.ctr * 100).toFixed(2), position: +row.position.toFixed(1)
      })),
      dataOrigin:'live_gsc', dataSource:'searchconsole.googleapis.com searchAnalytics.query',
      confidence:'high'
    });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

app.get('/api/gsc/sites', async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return _missingCreds(res, 'gsc', ['GOOGLE_SERVICE_ACCOUNT_JSON']);
  try {
    const token = await _getGoogleSAToken('https://www.googleapis.com/auth/webmasters.readonly');
    const r = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
      headers:{ 'Authorization':`Bearer ${token}` }
    });
    const j = await r.json();
    res.json({ ok:true, configured:true,
      sites: (j.siteEntry || []).map(s => ({ siteUrl: s.siteUrl, permission: s.permissionLevel })),
      dataOrigin:'live_gsc', dataSource:'searchconsole.googleapis.com/webmasters/v3 sites', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

// ─── Semrush API ─────────────────────────────────────────────────────────────
app.post('/api/semrush/keyword', async (req, res) => {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) return _missingCreds(res, 'semrush', ['SEMRUSH_API_KEY']);
  try {
    const { keyword, database = 'us' } = req.body || {};
    if (!keyword) return res.status(400).json({ ok:false, error:'keyword required' });
    const url = `https://api.semrush.com/?type=phrase_this&key=${key}&phrase=${encodeURIComponent(keyword)}&database=${database}&export_columns=Ph,Nq,Cp,Co,Nr,Td`;
    const r = await fetch(url);
    const txt = await r.text();
    if (txt.startsWith('ERROR')) return res.json({ ok:false, configured:true, error: txt });
    const lines = txt.trim().split('\n');
    if (lines.length < 2) return res.json({ ok:true, configured:true, keyword, data:null, note:'No data for this keyword in this database' });
    const headers = lines[0].split(';');
    const vals = lines[1].split(';');
    const obj = Object.fromEntries(headers.map((h,i) => [h, vals[i]]));
    res.json({ ok:true, configured:true, keyword,
      volume: +obj.Nq || 0, cpc: +obj.Cp || 0, competition: +obj.Co || 0,
      results: +obj.Nr || 0, trend: obj.Td,
      dataOrigin:'live_semrush', dataSource:'api.semrush.com phrase_this', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

app.post('/api/semrush/domain', async (req, res) => {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) return _missingCreds(res, 'semrush', ['SEMRUSH_API_KEY']);
  try {
    const { domain, database = 'us' } = req.body || {};
    if (!domain) return res.status(400).json({ ok:false, error:'domain required' });
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0];
    const url = `https://api.semrush.com/?type=domain_overview&key=${key}&domain=${encodeURIComponent(cleanDomain)}&database=${database}&export_columns=Dn,Rk,Or,Ot,Oc,Ad,At,Ac`;
    const r = await fetch(url);
    const txt = await r.text();
    if (txt.startsWith('ERROR')) return res.json({ ok:false, configured:true, error: txt });
    const lines = txt.trim().split('\n');
    if (lines.length < 2) return res.json({ ok:true, configured:true, domain:cleanDomain, data:null });
    const headers = lines[0].split(';');
    const vals = lines[1].split(';');
    const obj = Object.fromEntries(headers.map((h,i) => [h, vals[i]]));
    res.json({ ok:true, configured:true, domain:cleanDomain,
      rank: +obj.Rk || 0, organicKeywords: +obj.Or || 0,
      organicTraffic: +obj.Ot || 0, organicCost: +obj.Oc || 0,
      adwordsKeywords: +obj.Ad || 0, adwordsTraffic: +obj.At || 0, adwordsCost: +obj.Ac || 0,
      dataOrigin:'live_semrush', dataSource:'api.semrush.com domain_overview', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

// ─── HubSpot CRM ─────────────────────────────────────────────────────────────
app.get('/api/hubspot/status', async (req, res) => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return _missingCreds(res, 'hubspot', ['HUBSPOT_PRIVATE_APP_TOKEN']);
  try {
    const r = await fetch('https://api.hubapi.com/account-info/v3/details', {
      headers:{ 'Authorization':`Bearer ${token}` }
    });
    const j = await r.json();
    if (j.status === 'error') return res.json({ ok:false, configured:true, error: j.message });
    res.json({ ok:true, configured:true, portalId: j.portalId, currency: j.companyCurrency, timeZone: j.timeZone,
      dataOrigin:'live_hubspot', dataSource:'api.hubapi.com/account-info/v3', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

app.post('/api/hubspot/contacts/upsert', async (req, res) => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return _missingCreds(res, 'hubspot', ['HUBSPOT_PRIVATE_APP_TOKEN']);
  try {
    const { contacts = [] } = req.body || {};
    if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ ok:false, error:'contacts array required' });
    const results = [];
    for (const c of contacts.slice(0, 100)) {
      if (!c.email) continue;
      try {
        const r = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(c.email)}?idProperty=email`, {
          method:'PATCH',
          headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ properties: c })
        });
        if (r.status === 404) {
          const cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method:'POST',
            headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ properties: c })
          });
          const cj = await cr.json();
          results.push({ email: c.email, action: 'created', id: cj.id, ok: !cj.status });
        } else {
          const j = await r.json();
          results.push({ email: c.email, action: 'updated', id: j.id, ok: !j.status });
        }
      } catch (e) {
        results.push({ email: c.email, ok: false, error: e.message });
      }
    }
    res.json({ ok:true, configured:true, results,
      created: results.filter(r => r.action === 'created').length,
      updated: results.filter(r => r.action === 'updated').length,
      failed: results.filter(r => !r.ok).length,
      dataOrigin:'live_hubspot', dataSource:'api.hubapi.com crm/v3' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

app.get('/api/hubspot/deals', async (req, res) => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return _missingCreds(res, 'hubspot', ['HUBSPOT_PRIVATE_APP_TOKEN']);
  try {
    const r = await fetch('https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,closedate,pipeline,createdate', {
      headers:{ 'Authorization':`Bearer ${token}` }
    });
    const j = await r.json();
    if (j.status === 'error') return res.json({ ok:false, configured:true, error: j.message });
    const deals = (j.results || []).map(d => ({
      id: d.id, name: d.properties.dealname, amount: +d.properties.amount || 0,
      stage: d.properties.dealstage, closeDate: d.properties.closedate, createdAt: d.properties.createdate
    }));
    const totalValue = deals.reduce((a,d) => a + d.amount, 0);
    res.json({ ok:true, configured:true, deals, count: deals.length, totalValue,
      dataOrigin:'live_hubspot', dataSource:'api.hubapi.com crm/v3 deals', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

// ─── Firecrawl ──────────────────────────────────────────────────────────────
app.post('/api/firecrawl/scrape', async (req, res) => {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return _missingCreds(res, 'firecrawl', ['FIRECRAWL_API_KEY']);
  try {
    try { _chargeBudget('firecrawl', req.ip); }
    catch (e) { if (_send429IfBudget(res, e)) return; throw e; }
    const { url, formats = ['markdown','html'] } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:'url required' });
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ url, formats })
    });
    const j = await r.json();
    if (!j.success) return res.json({ ok:false, configured:true, error: j.error || 'scrape failed' });
    res.json({ ok:true, configured:true, url,
      markdown: j.data?.markdown, html: j.data?.html, metadata: j.data?.metadata,
      dataOrigin:'live_firecrawl', dataSource:'api.firecrawl.dev/v1/scrape', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});
};
