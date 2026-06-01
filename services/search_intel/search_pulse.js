// Search Pulse — "what is the world searching for around <topic>?"
// Wraps DataForSEO Labs keyword_ideas + an OpenAI-vision logo detector for
// image mentions. We cache pulse runs so the user can compare deltas.
const _db = require('../../db');
const _https = require('https');

function _httpJson(opts, body, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const req = _https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : {}, raw }); }
        catch { resolve({ status: res.statusCode, json: {}, raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function _localeToDfs(locale) {
  const map = { 'en-US':{ language_code:'en', location_code:2840 },
                'en-GB':{ language_code:'en', location_code:2826 },
                'en-ZA':{ language_code:'en', location_code:2710 },
                'en-AU':{ language_code:'en', location_code:2036 },
                'en-CA':{ language_code:'en', location_code:2124 } };
  return map[locale] || map['en-US'];
}

async function runPulse(seed, locale = 'en-US', tenantId = null) {
  const login = process.env.DATAFORSEO_LOGIN;
  const pass  = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) throw new Error('DataForSEO not configured');
  const auth = 'Basic ' + Buffer.from(`${login}:${pass}`).toString('base64');
  const loc = _localeToDfs(locale);
  const body = [{ keywords: [String(seed).slice(0, 80)], language_code: loc.language_code, location_code: loc.location_code, limit: 50, order_by: ['keyword_info.search_volume,desc'] }];
  const r = await _httpJson({
    hostname:'api.dataforseo.com', path:'/v3/dataforseo_labs/google/keyword_ideas/live', method:'POST',
    headers:{ 'Authorization': auth, 'Content-Type':'application/json' },
  }, body);
  if (r.status !== 200) throw new Error(`DataForSEO ${r.status}: ${r.json?.status_message || ''}`);
  const items = r.json?.tasks?.[0]?.result?.[0]?.items || [];
  const suggestions = items.slice(0, 50).map(it => ({
    keyword: it.keyword,
    search_volume: it.keyword_info?.search_volume || 0,
    cpc: it.keyword_info?.cpc || 0,
    competition: it.keyword_info?.competition_level || it.keyword_info?.competition || null,
    monthly_searches: (it.keyword_info?.monthly_searches || []).slice(-12),
    intent: it.search_intent_info?.main_intent || null,
  }));
  const totalVolume = suggestions.reduce((s, x) => s + (x.search_volume || 0), 0);
  if (_db.hasDb()) {
    try {
      await _db.getPool().query(`
        INSERT INTO search_intel_pulse_runs (seed, locale, suggestions, total_volume, tenant_id)
        VALUES ($1,$2,$3,$4,$5)
      `, [String(seed).slice(0, 200), locale, JSON.stringify(suggestions), totalVolume, tenantId]);
    } catch(e) { console.warn('[search-pulse] log fail:', e.message); }
  }
  return { ok:true, seed, locale, count: suggestions.length, totalVolume, suggestions };
}

async function getPulseHistory(seed, limit = 12, tenantId = null) {
  if (!_db.hasDb()) return [];
  const r = await _db.getPool().query(`
    SELECT id, seed, locale, total_volume, ran_at,
      jsonb_array_length(suggestions) AS suggestion_count
    FROM search_intel_pulse_runs WHERE seed=$1 AND tenant_id=$2 ORDER BY ran_at DESC LIMIT $3
  `, [String(seed).slice(0, 200), tenantId, Math.min(Math.max(Number(limit)||12, 1), 60)]);
  return r.rows;
}

// ── Image / logo recognition (Tier 1 #3) ───────────────────────────────────
// Calls OpenAI vision (gpt-4o-mini) to extract visible brands/logos/objects
// from an image URL and caches the result. The frontend wires this into the
// existing mention tracker so the user finds brand appearances even when
// nobody @-mentions them.
async function analyzeImage(sourceUrl, force = false, tenantId = null) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI key missing');
  const url = String(sourceUrl || '').trim();
  if (!/^https?:\/\//i.test(url) || url.length > 800) throw new Error('valid http(s) URL required');
  if (_db.hasDb() && !force) {
    const cached = await _db.getPool().query(`SELECT * FROM search_intel_images WHERE source_url=$1 AND tenant_id=$2`, [url, tenantId]);
    if (cached.rows[0]) return { ok:true, cached:true, ...cached.rows[0] };
  }
  const r = await _httpJson({
    hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
    headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json' },
  }, {
    model:'gpt-4o-mini',
    messages:[{
      role:'user',
      content:[
        { type:'text', text:'List every brand or logo you can identify in this image, plus the main objects/scene. Respond as strict JSON: {"brands":[{"name":"…","confidence":0-1,"location":"…"}],"objects":["…"]}.  No prose, no markdown fences.' },
        { type:'image_url', image_url:{ url } },
      ],
    }],
    temperature: 0.1, max_tokens: 400,
  });
  if (r.status !== 200) throw new Error(r.json?.error?.message || ('openai '+r.status));
  const raw = (r.json?.choices?.[0]?.message?.content || '').trim().replace(/^```json|```$/g, '').trim();
  let parsed = { brands:[], objects:[] };
  try { parsed = JSON.parse(raw); } catch {}
  parsed.brands  = Array.isArray(parsed.brands)  ? parsed.brands.slice(0, 20)  : [];
  parsed.objects = Array.isArray(parsed.objects) ? parsed.objects.slice(0, 30) : [];
  if (_db.hasDb()) {
    try {
      await _db.getPool().query(`
        INSERT INTO search_intel_images (source_url, brands, objects, raw, tenant_id)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id, source_url) DO UPDATE SET brands=EXCLUDED.brands, objects=EXCLUDED.objects, raw=EXCLUDED.raw, ran_at=now()
      `, [url, JSON.stringify(parsed.brands), JSON.stringify(parsed.objects), raw.slice(0, 4000), tenantId]);
    } catch(e) { console.warn('[search-pulse] image cache fail:', e.message); }
  }
  return { ok:true, cached:false, source_url:url, brands:parsed.brands, objects:parsed.objects };
}

module.exports = { runPulse, getPulseHistory, analyzeImage };
