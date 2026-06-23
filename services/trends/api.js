// Trending Topics — surfaces what's spiking in a category right now.
// Uses Perplexity (live web) when configured, falls back to OpenAI + template.
const express = require('express');
const _db = require('../../db');
const _https = require('https');
const _tenantCtx = require('../tenants/context');
const _tenantMig = require('../tenants/migration');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

async function _ensureSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS trend_runs (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      keywords JSONB NOT NULL DEFAULT '[]',
      country TEXT NOT NULL DEFAULT 'US',
      topics JSONB NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'perplexity',
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_trend_runs_cat ON trend_runs(category, ran_at DESC);
  `);
  await _tenantMig.addTenantIdColumn('trend_runs');
}
_ensureSchema().catch(()=>{});

// YouTube video category ID map.
// Authoritative source: https://developers.google.com/youtube/v3/docs/videoCategories/list
// Retrieve the live list: GET https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=YOUR_KEY
//
// IMPORTANT — region restrictions:
//   • IDs 1–10 are the core global set but their exact assignment can vary by region
//     (e.g. "Music" is 10 globally but may map differently in some locales).
//   • IDs 30–44 are film/show sub-categories that YouTube only returns for certain
//     regions (primarily the US). Pass a specific regionCode when using them.
//   • IDs 3–9, 11–14, 16, 21 are either retired or never publicly assignable;
//     they are intentionally omitted.
//
// To keep this map accurate: query the videoCategories API with the target
// regionCode and reconcile any new or removed entries.
const _YT_CATEGORY_MAP = {
  // ── Core global categories ────────────────────────────────────────────────
  'film':              1,  'films':           1,  'movies':            1,
  'animation':         1,  'film & animation':1,  'animated':          1,

  'autos':             2,  'vehicles':        2,  'cars':              2,
  'automobile':        2,  'automotive':      2,  'autos & vehicles':  2,
  'driving':           2,  'motorcycles':     2,

  'music':            10,  'songs':          10,  'k-pop':            10,
  'kpop':             10,  'pop':            10,  'hip hop':          10,
  'rap':              10,  'rock':           10,  'indie':            10,
  'classical':        10,  'jazz':           10,  'edm':              10,
  'country music':    10,  'r&b':            10,  'covers':           10,

  'pets':             15,  'animals':        15,  'pets & animals':   15,
  'dogs':             15,  'cats':           15,  'wildlife':         15,
  'nature':           15,

  'sports':           17,  'fitness':        17,  'workout':          17,
  'exercise':         17,  'gym':            17,  'football':         17,
  'soccer':           17,  'basketball':     17,  'baseball':         17,
  'tennis':           17,  'golf':           17,  'esports':          17,
  'athletics':        17,

  'travel':           19,  'events':         19,  'travel & events':  19,
  'tourism':          19,  'adventure':      19,  'vlogs':            19,
  'destinations':     19,

  'gaming':           20,  'games':          20,  'video games':      20,
  'game':             20,  'playthrough':    20,  'let\'s play':      20,
  'minecraft':        20,  'fortnite':       20,  'roblox':           20,

  'people':           22,  'bloggers':       22,  'vlogging':         22,
  'people & blogs':   22,  'lifestyle':      22,  'daily vlog':       22,
  'personal':         22,  'family':         22,

  'comedy':           23,  'humor':          23,  'funny':            23,
  'sketches':         23,  'stand-up':       23,  'parody':           23,
  'memes':            23,

  'entertainment':    24,  'variety':        24,  'celebrity':        24,
  'reality tv':       24,  'talk show':      24,

  'news':             25,  'politics':       25,  'news & politics':  25,
  'current events':   25,  'world news':     25,  'political':        25,

  'howto':            26,  'style':          26,  'how to':           26,
  'diy':              26,  'howto & style':  26,  'tutorials':        26,
  'fashion':          26,  'beauty':         26,  'makeup':           26,
  'cooking':          26,  'recipes':        26,  'crafts':           26,
  'home improvement': 26,

  'education':        27,  'learning':       27,  'educational':      27,
  'school':           27,  'academic':       27,  'explainer':        27,
  'documentary':      27,

  'science':          28,  'technology':     28,  'tech':             28,
  'science & technology': 28, 'stem':        28,  'engineering':      28,
  'programming':      28,  'coding':         28,  'ai':               28,
  'space':            28,  'physics':        28,  'biology':          28,

  'nonprofits':       29,  'activism':       29,  'nonprofits & activism': 29,
  'charity':          29,  'social causes':  29,  'volunteering':     29,

  // ── Film/show sub-categories (region-restricted — primarily US) ──────────
  // Use regionCode=US when querying with these IDs.
  'short movies':     30,  'short films':    30,
  'anime':            31,  'manga':          31,
  'action':           32,  'action & adventure': 32,
  'classics':         33,  'classic films':  33,
  'comedy films':     34,
  'documentaries':    35,
  'drama':            36,  'drama films':    36,
  'family films':     37,
  'foreign':          38,  'foreign films':  38,  'subtitled':        38,
  'horror':           39,  'scary':          39,
  'sci-fi':           40,  'science fiction':40,  'fantasy':          40,
  'thriller':         41,  'suspense':       41,
  'shorts':           42,
  'shows':            43,  'tv shows':       43,  'series':           43,
  'trailers':         44,  'movie trailers': 44,
};

const _YT_CATEGORY_LABELS = {
   1: 'Film & Animation',
   2: 'Autos & Vehicles',
  10: 'Music',
  15: 'Pets & Animals',
  17: 'Sports',
  19: 'Travel & Events',
  20: 'Gaming',
  22: 'People & Blogs',
  23: 'Comedy',
  24: 'Entertainment',
  25: 'News & Politics',
  26: 'How-to & Style',
  27: 'Education',
  28: 'Science & Technology',
  29: 'Nonprofits & Activism',
};

async function _youtube({ country, category }) {
  const key = process.env.YOUTUBE_DATA_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const regionCode = (country && country !== 'ALL') ? country.slice(0, 2).toUpperCase() : 'US';
  const catKey = (category || '').toLowerCase().trim();
  const videoCategoryId = _YT_CATEGORY_MAP[catKey];
  let url = 'https://www.googleapis.com/youtube/v3/videos?part=snippet%2Cstatistics&chart=mostPopular&maxResults=10&regionCode=' +
    encodeURIComponent(regionCode) + '&key=' + encodeURIComponent(key);
  if (videoCategoryId) url += '&videoCategoryId=' + videoCategoryId;
  return await new Promise(resolve => {
    const req = _https.request(url, { method: 'GET' }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          const items = j.items;
          if (!Array.isArray(items) || !items.length) return resolve(null);
          const topics = items.map(item => {
            const snippet = item.snippet || {};
            const stats = item.statistics || {};
            const title = snippet.title || 'Untitled';
            const channel = snippet.channelTitle || '';
            const views = stats.viewCount ? Number(stats.viewCount).toLocaleString() : null;
            const why = [
              channel ? `By ${channel}` : '',
              views ? `${views} views` : '',
            ].filter(Boolean).join(' · ') || 'Trending on YouTube';
            const videoId = item.id;
            const sources = videoId ? [`https://www.youtube.com/watch?v=${videoId}`] : [];
            return { title, why, sources };
          });
          if (!topics.length) return resolve(null);
          const categoryLabel = videoCategoryId ? (_YT_CATEGORY_LABELS[videoCategoryId] || null) : null;
          resolve({ topics, categoryLabel });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function _perplexity({ category, keywords, country }) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const prompt = `What are the 6-10 hottest trending topics, news stories, or conversations RIGHT NOW (last 7 days) in the "${category}" category${keywords?.length?` related to: ${keywords.join(', ')}`:''}${country?`, focused on ${country}`:''}? For each, give: a short topic title, a 1-line why-it-matters, and 1-3 source URLs. Output strict JSON only: {"topics":[{"title":"...","why":"...","sources":["url1","url2"]}]}`;
  const body = JSON.stringify({
    model: 'sonar', messages: [{ role:'user', content: prompt }],
    temperature: 0.3, max_tokens: 1400,
  });
  return await new Promise(resolve => {
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
      try {
        if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d);
        const txt = (j.choices?.[0]?.message?.content || '').trim().replace(/^```json|```$/g,'').trim();
        const m = txt.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(m ? m[0] : txt);
        if (Array.isArray(parsed.topics)) resolve(parsed.topics);
        else resolve(null);
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(35000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

router.post('/detect', async (req, res) => {
  const category = String(req.body?.category || '').trim().slice(0, 120);
  if (!category) return _err(res, 400, 'category required');
  const keywords = (Array.isArray(req.body?.keywords) ? req.body.keywords : []).map(s => String(s).slice(0, 60)).filter(Boolean).slice(0, 8);
  const country = req.body?.country ? String(req.body.country).slice(0, 16) : 'US';
  const platform = req.body?.platform ? String(req.body.platform).trim().toLowerCase() : '';
  try {
    let topics = null;
    let source = 'perplexity';
    let categoryLabel = null;

    if (platform === 'youtube') {
      const ytResult = await _youtube({ country, category });
      if (ytResult && ytResult.topics && ytResult.topics.length) {
        topics = ytResult.topics;
        categoryLabel = ytResult.categoryLabel || null;
        source = 'youtube';
      } else {
        topics = await _perplexity({ category, keywords, country });
      }
    } else {
      topics = await _perplexity({ category, keywords, country });
    }

    if (!topics || !topics.length) {
      source = 'template';
      topics = [
        { title:'Connect Perplexity API key for live trending topics', why:'Perplexity provides real-time web search; without a key we can only show this placeholder.', sources:[] },
        { title:`Generic trend: AI in ${category}`, why:'AI integrations and copilots are top-of-mind across most categories in 2025-2026.', sources:[] },
      ];
    }
    if (_db.hasDb()) {
      try {
        const tid = await _tenantCtx.resolveTenantId(req, { label:'trends:detect' });
        await _db.getPool().query(`INSERT INTO trend_runs (tenant_id, category, keywords, country, topics, source) VALUES ($1,$2,$3,$4,$5,$6)`,
          [tid, category, JSON.stringify(keywords), country, JSON.stringify(topics), source]);
      } catch {}
    }
    res.json({ ok:true, source, category, country, topics, ...(categoryLabel ? { categoryLabel } : {}) });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, runs: [] });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'trends:history' });
    const r = await _db.getPool().query(`SELECT id, category, keywords, country, topics, source, ran_at FROM trend_runs WHERE tenant_id=$1 ORDER BY ran_at DESC LIMIT 50`, [tid]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
