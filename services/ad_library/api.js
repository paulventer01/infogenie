const express = require('express');
const router = express.Router();
const _https = require('https');
const _vault = require('../credentials/vault');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[ad-library]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
async function _resolveMetaToken(req) {
  const uid = req && req.user && req.user.id ? req.user.id : null;
  const r = await _vault.resolveMetaAdsCredentials(uid);
  return r.ok ? r.creds.accessToken : null;
}
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

// Wide country set used when the user picks "ALL". Meta's Ad Library requires
// at least one country in ad_reached_countries — we send a broad set covering
// the world's largest ad markets.
const _ALL_COUNTRIES = ['US','GB','CA','AU','NZ','IE','ZA','NG','KE','EG','MA','DE','FR','ES','IT','NL','BE','PT','CH','AT','SE','NO','DK','FI','PL','CZ','GR','RO','HU','TR','RU','UA','IL','AE','SA','IN','PK','BD','CN','HK','TW','JP','KR','SG','MY','TH','VN','ID','PH','MX','BR','AR','CL','CO','PE'];

function _metaAdsArchive(searchTerm, country, limit, accessToken) {
  const countries = country === 'ALL' ? _ALL_COUNTRIES : [country];
  const reachedJson = JSON.stringify(countries);
  return new Promise(resolve => {
    const params = new URLSearchParams({
      access_token: accessToken,
      search_terms: searchTerm,
      ad_reached_countries: reachedJson,
      ad_active_status: 'ACTIVE',
      limit: String(limit),
      fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_snapshot_url,page_name,publisher_platforms,impressions,spend,currency'
    });
    const req = _https.request({ hostname:'graph.facebook.com', path:`/v19.0/ads_archive?${params.toString()}`, method:'GET' }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) return resolve({ error: j.error.message || 'Meta API error', code: j.error.code });
          resolve({ ads: (j.data || []).map(a => ({
            id: a.id,
            page_name: a.page_name,
            created: a.ad_creation_time,
            body: (a.ad_creative_bodies && a.ad_creative_bodies[0]) || '',
            title: (a.ad_creative_link_titles && a.ad_creative_link_titles[0]) || '',
            description: (a.ad_creative_link_descriptions && a.ad_creative_link_descriptions[0]) || '',
            snapshot_url: a.ad_snapshot_url,
            platforms: a.publisher_platforms || [],
            impressions: a.impressions || null,
            spend: a.spend || null,
            currency: a.currency
          })) });
        } catch { resolve({ error: 'Meta response parse failed' }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ error: 'Meta request timeout' }); });
    req.end();
  });
}

// Generic Perplexity-powered scrape for any public ad library that lacks an official API.
async function _adLibViaPerplexity({ brand, country, libraryName, libraryUrl, exampleUrlPath }) {
  if (!_hasPerplexity()) return { error: `PERPLEXITY_API_KEY required for ${libraryName} scans` };
  const prompt = `Search the public ${libraryName} (${libraryUrl}) for currently-running or recently-active ads from advertiser "${brand}" in country "${country}". Return strict JSON: {"ads":[{"advertiser":"...","ad_text":"...","first_seen":"YYYY-MM-DD","industry":"...","url":"${exampleUrlPath}..."}]}. Limit 8. Only include real ads you can verify in the public archive — never invent. If you can't find anything, return {"ads":[],"note":"No public ads found in ${libraryName}."}`;
  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar', temperature:0.1, max_tokens:1500, messages:[{ role:'user', content: prompt }] });
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) return resolve({ ads: [] });
          const parsed = JSON.parse(m[0]);
          resolve({ ads: parsed.ads || [], note: parsed.note });
        } catch { resolve({ ads: [] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(35000, () => { req.destroy(); resolve({ error: `${libraryName} scan timeout` }); });
    req.write(body); req.end();
  });
}

// Meta-specific Perplexity prompt — tuned for the dashboard "Est. Ad Spend"
// column. Goal: get an honest estimate of how many Meta ads the brand is
// currently running so the heuristic ($200-$1000 / ad / mo) can produce a
// spend band. The generic _adLibViaPerplexity prompt is too strict (it
// requires verifiable ad IDs which Perplexity refuses without exact archive
// matches) and returns 0 even for huge advertisers like Nike. This prompt
// asks for an evidence-backed estimate + a few sample ad themes — accurate
// enough for the band calculation, honest about uncertainty.
async function _metaAdsLibraryViaPerplexity(brand, country) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required for Meta Ad Library fallback' };
  // Sanitize brand before interpolating into the LLM prompt — strip control
  // chars/quotes/newlines and cap length to limit prompt-injection / model-skew
  // risk. Same hygiene applied to country.
  const safeBrand = String(brand || '').replace(/[\x00-\x1F"'`\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const safeCountry = String(country || '').replace(/[\x00-\x1F"'`\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  brand = safeBrand; country = safeCountry;
  const prompt = `You are checking the public Meta Ad Library (https://www.facebook.com/ads/library/) for advertiser "${brand}" in ${country}. Goal: give a best-effort estimate of how many distinct ads they're currently running on Facebook + Instagram, plus a few representative ad themes.

Return STRICT JSON only (no commentary outside the JSON):
{
  "estimated_active_ads": <integer best guess; use 0 only if you have evidence they don't advertise on Meta>,
  "confidence": "low" | "medium" | "high",
  "ads": [
    { "advertiser": "${brand}", "ad_text": "<short summary of one example ad theme>", "platforms": ["Facebook","Instagram"], "url": "https://www.facebook.com/ads/library/?active_status=active&q=${encodeURIComponent(brand)}" }
  ],
  "note": "<one-line summary of what you found>"
}

Rules:
- "ads" should list 3-8 sample ad themes/categories you've seen or can reasonably infer from public sources (the brand's website, marketing news, ad-tracking blogs, social media). It's fine to summarize themes — do NOT need exact ad IDs.
- "estimated_active_ads" is your honest best guess of how many distinct ad creatives are currently running. A large brand running national campaigns is typically 50-500+; a small/regional brand 5-30; an inactive brand 0.
- Only return 0 ads if you have positive evidence they don't run Meta ads.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar', temperature:0.1, max_tokens:1500, messages:[{ role:'user', content: prompt }] });
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) return resolve({ ads: [] });
          const parsed = JSON.parse(m[0]);
          let ads = Array.isArray(parsed.ads) ? parsed.ads : [];
          // If the model estimates more ads than it returned samples for, pad
          // the array so the dashboard's count * cost-band heuristic reflects
          // the estimate rather than the (small) sample size. Padding entries
          // are clearly marked so any consumer of `ads` can filter if needed.
          // Clamped to MAX_PADDED so a runaway LLM estimate can't blow up the
          // response payload — 300 covers any realistic Meta advertiser and
          // caps the heuristic at ~$300k/mo (300 × $1000), beyond which the
          // dashboard's per-ad band isn't meaningful anyway.
          const MAX_PADDED = 300;
          let est = parseInt(parsed.estimated_active_ads, 10);
          if (isFinite(est) && est > MAX_PADDED) est = MAX_PADDED;
          if (isFinite(est) && est > ads.length) {
            const pad = est - ads.length;
            for (let i = 0; i < pad; i++) {
              ads.push({ advertiser: brand, ad_text: '(estimated active ad — sample not retrieved)', _estimated: true });
            }
          }
          resolve({ ads, note: parsed.note, confidence: parsed.confidence, estimated_active_ads: isFinite(est) ? est : null });
        } catch { resolve({ ads: [] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(35000, () => { req.destroy(); resolve({ error: 'Meta Ad Library scan timeout' }); });
    req.write(body); req.end();
  });
}

async function _tiktokAdsLibraryViaPerplexity(brand, country) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required for TikTok Ad Library scans' };
  const prompt = `Search the public TikTok Ads Library (https://library.tiktok.com/ads) for currently-running ads from advertiser "${brand}" in country "${country}". Return strict JSON: {"ads":[{"advertiser":"...","ad_text":"...","first_seen":"YYYY-MM-DD","industry":"...","url":"https://library.tiktok.com/..."}]}. Limit 8. If you can't find anything, return {"ads":[],"note":"No public ads found in TikTok Ad Library."}`;
  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar', temperature:0.1, max_tokens:1500, messages:[{ role:'user', content: prompt }] });
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) return resolve({ ads: [] });
          const parsed = JSON.parse(m[0]);
          resolve({ ads: parsed.ads || [], note: parsed.note });
        } catch { resolve({ ads: [] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(35000, () => { req.destroy(); resolve({ error: 'TikTok scan timeout' }); });
    req.write(body); req.end();
  });
}

router.get('/test', _safeAsync(async (req, res) => {
  const t = await _resolveMetaToken(req);
  res.json({ ok:true, meta: !!t, perplexity: _hasPerplexity() });
}));

function _normCountry(raw) {
  const c = String(raw || 'US').toUpperCase().trim();
  if (c === 'ALL' || c === 'WORLDWIDE' || c === 'GLOBAL') return 'ALL';
  return c.slice(0, 2);
}

router.post('/meta', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const country = _normCountry(req.body?.country);
  const limit = Math.max(5, Math.min(50, parseInt(req.body?.limit || 20, 10)));
  if (!brand) return _err(res, 400, 'brand required');

  // Try the official Meta Ad Library API first (richest data — real ad creatives,
  // spend, impressions). Falls back to a Perplexity-powered public-archive scan
  // when the token is missing, lacks ads_read scope, or the API errors. This
  // keeps the dashboard's "Est. Ad Spend / Mo" column populated even when the
  // env-var Meta token has reduced scope (the common case for non-Meta-Business
  // tokens). Same fallback pattern used by /google, /linkedin, /x.
  const token = await _resolveMetaToken(req);
  if (token) {
    const r = await _metaAdsArchive(brand, country, limit, token);
    if (!r.error) {
      return res.json({ ok:true, brand, country, total: r.ads.length, ads: r.ads, source: 'meta_api' });
    }
    // Permission/scope errors → silently fall through to Perplexity. Rate-limit
    // errors → return immediately so caller can retry the official API later.
    if (/rate|throttl|limit/i.test(r.error)) {
      return _err(res, 400, 'Meta API rate limit hit. Try again in a few minutes.');
    }
    // else: scope/auth/transient → try Perplexity fallback below
  }

  const fb = await _metaAdsLibraryViaPerplexity(brand, country === 'ALL' ? 'worldwide' : country);
  if (fb.error) {
    return _err(res, 400, token
      ? `Meta token missing ads_read scope and Perplexity fallback failed: ${fb.error}`
      : `Meta Ads not connected and Perplexity fallback failed: ${fb.error}. Link Meta Ads in Settings → Integrations or set PERPLEXITY_API_KEY.`);
  }
  res.json({ ok:true, brand, country, total: fb.ads.length, ads: fb.ads, note: fb.note, source: 'perplexity' });
}));

router.post('/tiktok', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const country = _normCountry(req.body?.country);
  if (!brand) return _err(res, 400, 'brand required');
  const r = await _tiktokAdsLibraryViaPerplexity(brand, country === 'ALL' ? 'worldwide (all countries)' : country);
  if (r.error) return _err(res, 400, r.error);
  res.json({ ok:true, brand, country, total: r.ads.length, ads: r.ads, note: r.note });
}));

// Google Ads Transparency Center — covers Google Search, Display, YouTube, and Shopping ads.
router.post('/google', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const country = _normCountry(req.body?.country);
  if (!brand) return _err(res, 400, 'brand required');
  const r = await _adLibViaPerplexity({
    brand, country: country === 'ALL' ? 'worldwide (all countries)' : country,
    libraryName: 'Google Ads Transparency Center',
    libraryUrl: 'https://adstransparency.google.com',
    exampleUrlPath: 'https://adstransparency.google.com/advertiser/',
  });
  if (r.error) return _err(res, 400, r.error);
  res.json({ ok:true, brand, country, total: r.ads.length, ads: r.ads, note: r.note });
}));

// LinkedIn Ad Library — public archive of all LinkedIn ads (essential for B2B).
router.post('/linkedin', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const country = _normCountry(req.body?.country);
  if (!brand) return _err(res, 400, 'brand required');
  const r = await _adLibViaPerplexity({
    brand, country: country === 'ALL' ? 'worldwide (all countries)' : country,
    libraryName: 'LinkedIn Ad Library',
    libraryUrl: 'https://www.linkedin.com/ad-library/home',
    exampleUrlPath: 'https://www.linkedin.com/ad-library/',
  });
  if (r.error) return _err(res, 400, r.error);
  res.json({ ok:true, brand, country, total: r.ads.length, ads: r.ads, note: r.note });
}));

// X (Twitter) Ads Transparency — public archive of promoted posts.
router.post('/x', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const country = _normCountry(req.body?.country);
  if (!brand) return _err(res, 400, 'brand required');
  const r = await _adLibViaPerplexity({
    brand, country: country === 'ALL' ? 'worldwide (all countries)' : country,
    libraryName: 'X (Twitter) Ads Transparency',
    libraryUrl: 'https://ads.x.com/transparency',
    exampleUrlPath: 'https://ads.x.com/transparency/',
  });
  if (r.error) return _err(res, 400, r.error);
  res.json({ ok:true, brand, country, total: r.ads.length, ads: r.ads, note: r.note });
}));

// ── Creative / Vision Analysis (Gemini multimodal) ────────────────────────
router.post('/analyze-creative', _safeAsync(async (req, res) => {
  const _tenantCtx = require('../tenants/context');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ad-library:analyze-creative' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { image_url, ad_text, headline, brand_name } = req.body;
  if (!ad_text && !image_url) return _err(res, 400, 'ad_text or image_url required');
  const geminiKey = process.env.GEMINI_API_KEY;
  const _TMPL = {
    hook_score: 6, hook_type: 'curiosity gap', emotional_appeal: 'aspiration',
    persuasion_tactics: ['social proof', 'benefit-led headline'], cta_strength: 'medium',
    copy_clarity: 'clear', tone: 'professional',
    strengths: ['Concise copy', 'Clear value proposition'],
    weaknesses: ['Generic CTA', 'Could be more specific'],
    quality_score: 62,
    improvement_suggestions: ['Add a number or stat to the headline', 'Test a more urgent CTA', 'Lead with the outcome, not the product'],
    estimated_performance: 'medium', visual_notes: 'Connect GEMINI_API_KEY for visual analysis',
    source: 'template'
  };
  if (!geminiKey || /^_DUMMY/i.test(geminiKey)) return res.json({ ok: true, source: 'template', analysis: _TMPL });

  const safeBrand   = String(brand_name || 'unknown').replace(/[\x00-\x1F]/g, ' ').slice(0, 80);
  const safeHead    = String(headline   || '(none)').replace(/[\x00-\x1F]/g, ' ').slice(0, 200);
  const safeCopy    = String(ad_text    || '(none)').replace(/[\x00-\x1F]/g, ' ').slice(0, 600);
  const prompt = `You are an expert direct-response ad creative analyst. Analyse this ad creative and return strict JSON only (no markdown, no commentary).

Brand: ${safeBrand}
Headline: ${safeHead}
Ad copy: ${safeCopy}

Return this exact JSON shape:
{"hook_score":<1-10>,"hook_type":"<curiosity|fear|aspiration|social_proof|urgency|humor|pain_point>","emotional_appeal":"<primary emotion targeted>","persuasion_tactics":["<tactic1>","<tactic2>"],"cta_strength":"<weak|medium|strong>","copy_clarity":"<confusing|unclear|clear|crystal>","tone":"<professional|casual|urgent|playful|authoritative>","strengths":["<what works well>","<another strength>"],"weaknesses":["<what could improve>","<another weakness>"],"quality_score":<0-100>,"improvement_suggestions":["<specific actionable fix 1>","<fix 2>","<fix 3>"],"estimated_performance":"<low|medium|high>","visual_notes":"<note on visual elements if image was analysed, else text-only>"}`;

  // Try to download image for multimodal analysis
  let imgB64 = null; let imgMime = 'image/jpeg';
  if (image_url) {
    try {
      const u = new URL(image_url);
      if (u.protocol === 'https:' && !/localhost|127\.|^10\.|^192\.168\.|^169\.254\.|::1/.test(u.hostname)) {
        imgB64 = await new Promise(resolve => {
          const r = _https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfoGenie/1.0)' }
          }, resp => {
            const ct = resp.headers['content-type'] || '';
            if (!ct.startsWith('image/')) return resolve(null);
            imgMime = ct.split(';')[0]; const ch = []; let sz = 0;
            resp.on('data', c => { if (sz < 4_000_000) { ch.push(c); sz += c.length; } });
            resp.on('end', () => resolve(ch.length ? Buffer.concat(ch).toString('base64') : null));
          });
          r.on('error', () => resolve(null)); r.setTimeout(8000, () => { r.destroy(); resolve(null); }); r.end();
        });
      }
    } catch (_) {}
  }

  const parts = imgB64
    ? [{ inlineData: { mimeType: imgMime, data: imgB64 } }, { text: prompt }]
    : [{ text: prompt }];
  const gbody = JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.3, maxOutputTokens: 700 } });
  const raw = await new Promise(resolve => {
    const r = _https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(gbody) }
    }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    r.on('error', () => resolve(null)); r.setTimeout(20000, () => { r.destroy(); resolve(null); });
    r.write(gbody); r.end();
  });
  const txt = raw?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const analysis = JSON.parse(m[0]);
      if (!analysis._DUMMY) {
        analysis.source = imgB64 ? 'gemini-vision' : 'gemini';
        return res.json({ ok: true, source: analysis.source, analysis });
      }
    } catch (_) {}
  }
  res.json({ ok: true, source: 'template', analysis: _TMPL });
}));

module.exports = router;
