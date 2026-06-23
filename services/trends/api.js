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

async function _youtube({ country }) {
  const key = process.env.YOUTUBE_DATA_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const regionCode = (country && country !== 'ALL') ? country.slice(0, 2).toUpperCase() : 'US';
  const url = 'https://www.googleapis.com/youtube/v3/videos?part=snippet%2Cstatistics&chart=mostPopular&maxResults=10&regionCode=' +
    encodeURIComponent(regionCode) + '&key=' + encodeURIComponent(key);
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
          resolve(topics.length ? topics : null);
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

    if (platform === 'youtube') {
      topics = await _youtube({ country });
      if (topics && topics.length) {
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
    res.json({ ok:true, source, category, country, topics });
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
