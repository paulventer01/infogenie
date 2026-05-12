const express = require('express');
const router = express.Router();
const _https = require('https');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[ad-library]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasMeta() { const k = process.env.META_ACCESS_TOKEN; return k && !/^_DUMMY/i.test(k); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

// Wide country set used when the user picks "ALL". Meta's Ad Library requires
// at least one country in ad_reached_countries — we send a broad set covering
// the world's largest ad markets.
const _ALL_COUNTRIES = ['US','GB','CA','AU','NZ','IE','ZA','NG','KE','EG','MA','DE','FR','ES','IT','NL','BE','PT','CH','AT','SE','NO','DK','FI','PL','CZ','GR','RO','HU','TR','RU','UA','IL','AE','SA','IN','PK','BD','CN','HK','TW','JP','KR','SG','MY','TH','VN','ID','PH','MX','BR','AR','CL','CO','PE'];

function _metaAdsArchive(searchTerm, country, limit) {
  const countries = country === 'ALL' ? _ALL_COUNTRIES : [country];
  const reachedJson = JSON.stringify(countries);
  return new Promise(resolve => {
    const params = new URLSearchParams({
      access_token: process.env.META_ACCESS_TOKEN,
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

router.get('/test', (req, res) => res.json({ ok:true, meta: _hasMeta(), perplexity: _hasPerplexity() }));

function _normCountry(raw) {
  const c = String(raw || 'US').toUpperCase().trim();
  if (c === 'ALL' || c === 'WORLDWIDE' || c === 'GLOBAL') return 'ALL';
  return c.slice(0, 2);
}

router.post('/meta', _safeAsync(async (req, res) => {
  if (!_hasMeta()) return _err(res, 400, 'META_ACCESS_TOKEN required (token needs ads_read scope for Meta Ad Library access)');
  const brand = String(req.body?.brand || '').trim();
  const country = _normCountry(req.body?.country);
  const limit = Math.max(5, Math.min(50, parseInt(req.body?.limit || 20, 10)));
  if (!brand) return _err(res, 400, 'brand required');
  const r = await _metaAdsArchive(brand, country, limit);
  if (r.error) {
    let hint = r.error;
    if (r.code === 100 || /scope|permission|ads_read/i.test(r.error)) hint = 'Meta token missing ads_read scope. Re-authenticate at developers.facebook.com with Ad Library API permission.';
    if (/rate|throttl|limit/i.test(r.error)) hint = 'Meta API rate limit hit. Try again in a few minutes.';
    return _err(res, 400, hint);
  }
  res.json({ ok:true, brand, country, total: r.ads.length, ads: r.ads });
}));

router.post('/tiktok', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const country = _normCountry(req.body?.country);
  if (!brand) return _err(res, 400, 'brand required');
  const r = await _tiktokAdsLibraryViaPerplexity(brand, country === 'ALL' ? 'worldwide (all countries)' : country);
  if (r.error) return _err(res, 400, r.error);
  res.json({ ok:true, brand, country, total: r.ads.length, ads: r.ads, note: r.note });
}));

module.exports = router;
