// Competitor news · trends · Reddit signals routes.
// Extracted verbatim from server.js (pure structural move — no behavior change).
// Shared module-scope helpers are injected via `ctx`.
// __dirname and relative require() are rebased to the app root so the moved code
// (originally at server.js, project root) resolves paths exactly as before.
const __path__ = require('path');
const __APP_ROOT__ = __path__.join(__dirname, '..', '..');
const __root_require__ = (p) =>
  (typeof p === 'string' && (p.startsWith('./') || p.startsWith('../')))
    ? require(__path__.resolve(__APP_ROOT__, p))
    : require(p);

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { _chargeBudget, anthropic, callDataForSEO, callRapidAPI, https, openai, openaiChatWithRetry } = ctx;

app.post('/api/competitor-news', async (req, res) => {
  try {
    const { competitors = [], industry = 'marketing', country = 'US' } = req.body;
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return res.json({ articles: [], source: 'no_key' });

    // Build search queries for each competitor
    const queries = competitors.slice(0, 4).map(name => ({
      name,
      q: encodeURIComponent(`"${name}" marketing OR advertising OR campaign`)
    }));

    // Also add an industry trend query
    const INDUSTRY_TOPICS = {
      ecommerce: 'ecommerce retail online shopping marketing',
      fintech:   'fintech banking payments marketing',
      saas:      'saas software B2B marketing',
      crypto:    'crypto blockchain web3 marketing',
      travel:    'travel hospitality marketing campaigns',
      education: 'edtech e-learning marketing',
      marketing: 'digital marketing advertising trends'
    };
    const industryQ = encodeURIComponent(INDUSTRY_TOPICS[industry] || INDUSTRY_TOPICS.marketing);

    const articles = [];
    let notSubscribed = false; // detect 403 from RapidAPI ("not subscribed to this API")

    // Detect a "not subscribed" / auth-failure response shape from RapidAPI
    const looksLikeNotSubscribed = (r) => {
      if (!r || typeof r !== 'object') return false;
      const msg = String(r.message || r._raw || '').toLowerCase();
      return msg.includes('not subscribed') || msg.includes('does not exist') || msg.includes('invalid api key') || msg.includes('exceeded the rate');
    };

    // Fetch industry trend news
    try {
      const newsRes = await callRapidAPI(
        'real-time-news-data.p.rapidapi.com',
        `/search?query=${industryQ}&limit=6&country=${country}&lang=en`,
        'GET'
      );
      if (looksLikeNotSubscribed(newsRes)) {
        notSubscribed = true;
      } else if (newsRes.status === 'OK' && Array.isArray(newsRes.data)) {
        for (const a of newsRes.data.slice(0, 3)) {
          articles.push({
            type: 'trend',
            competitor: null,
            title: a.title,
            snippet: a.snippet || a.description || '',
            url: a.link || a.url || '#',
            source: a.source_name || a.publisher || 'News',
            publishedAt: a.published_datetime_utc || a.date || '',
            signal: 'industry_trend'
          });
        }
      }
    } catch(e) { console.warn('news trend fetch failed:', e.message); }

    // Fetch competitor-specific news (skip if we already know we're not subscribed)
    if (!notSubscribed) {
      for (const { name, q } of queries) {
        try {
          const newsRes = await callRapidAPI(
            'real-time-news-data.p.rapidapi.com',
            `/search?query=${q}&limit=3&country=${country}&lang=en`,
            'GET'
          );
          if (looksLikeNotSubscribed(newsRes)) { notSubscribed = true; break; }
          if (newsRes.status === 'OK' && Array.isArray(newsRes.data)) {
            const top = newsRes.data[0];
            if (top) {
              const title = (top.title || '').toLowerCase();
              const signalType = title.includes('launch') || title.includes('new') ? 'new_campaign'
                : title.includes('fund') || title.includes('raise') || title.includes('invest') ? 'budget_surge'
                : title.includes('price') || title.includes('fee') || title.includes('cost') ? 'price_change'
                : 'competitor_signal';
              articles.push({
                type: 'competitor',
                competitor: name,
                title: top.title,
                snippet: top.snippet || top.description || '',
                url: top.link || top.url || '#',
                source: top.source_name || top.publisher || 'News',
                publishedAt: top.published_datetime_utc || top.date || '',
                signal: signalType
              });
            }
          }
        } catch(e) { console.warn(`news fetch failed for ${name}:`, e.message); }
      }
    }

    if (notSubscribed && articles.length === 0) {
      return res.json({
        articles: [],
        source: 'not_subscribed',
        message: 'Subscribe to "Real-Time News Data" on RapidAPI (free tier available) to enable live competitor signal feeds.'
      });
    }

    res.json({ articles, source: 'live', timestamp: new Date().toISOString() });

  } catch(err) {
    console.error('/api/competitor-news error:', err.message);
    res.json({ articles: [], source: 'error', error: err.message });
  }
});

// ── GET /api/trends ───────────────────────────────────────────────────────────
// Powers trending keywords — uses Google Trends API on RapidAPI
// Subscribe free at: https://rapidapi.com/exploreapi/api/google-trends-api

app.post('/api/trends', async (req, res) => {
  try {
    const { keywords = [], geo = 'US' } = req.body;
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return res.json({ trends: [], source: 'no_key' });

    const query = keywords.slice(0, 3).join(',') || 'digital marketing';
    const results = [];

    // Try Google Trends API (exploreAPI version)
    try {
      const r = await callRapidAPI(
        'google-trends8.p.rapidapi.com',
        `/trending?geo=${geo}`,
        'GET'
      );
      if (Array.isArray(r) && r.length > 0) {
        for (const item of r.slice(0, 8)) {
          results.push({
            keyword: item.title || item.query || item,
            traffic: item.traffic || item.formattedTraffic || '+1,000%',
            articles: item.articles ? item.articles.slice(0, 1) : []
          });
        }
        return res.json({ trends: results, source: 'live_trends', timestamp: new Date().toISOString() });
      }
    } catch(e) { console.warn('google-trends8 failed:', e.message); }

    // Fallback: use interest over time endpoint
    try {
      const encoded = encodeURIComponent(query);
      const r = await callRapidAPI(
        'google-trends-api4.p.rapidapi.com',
        `/interestovertime?keyword=${encoded}&geo=${geo}&startTime=now+7-d`,
        'GET'
      );
      if (r && r.default) {
        results.push({ keyword: query, trend: 'rising', source: 'interest_over_time' });
        return res.json({ trends: results, source: 'live_interest', timestamp: new Date().toISOString() });
      }
    } catch(e) { console.warn('google-trends-api4 failed:', e.message); }

    res.json({ trends: [], source: 'not_subscribed' });

  } catch(err) {
    console.error('/api/trends error:', err.message);
    res.json({ trends: [], source: 'error', error: err.message });
  }
});

// ── Hacker News / community signal helper (Algolia, no key needed) ────────────
function callHNSearch(query, limit = 8) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(query);
    const options = {
      hostname: 'hn.algolia.com',
      path: `/api/v1/search?query=${encoded}&tags=story&hitsPerPage=${limit}&numericFilters=points%3E1`,
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'InfoGenie/1.0' }
    };
    const req = https.request(options, (apiRes) => {
      let raw = '';
      apiRes.on('data', chunk => { raw += chunk; });
      apiRes.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('HN parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('HN timeout')); });
    req.end();
  });
}

// ── POST /api/reddit-signals ──────────────────────────────────────────────────
// Powered by Hacker News community (free, no key required)

app.post('/api/reddit-signals', async (req, res) => {
  try {
    const { industry = 'marketing', competitors = [] } = req.body;

    // Industry-specific search queries for HN
    const INDUSTRY_QUERIES = {
      ecommerce:  ['ecommerce growth strategy', 'shopify conversion', 'online store marketing'],
      fintech:    ['fintech startup', 'payments technology', 'banking disruption'],
      saas:       ['SaaS growth', 'B2B software pricing', 'startup acquisition'],
      crypto:     ['cryptocurrency regulation', 'DeFi protocol', 'web3 startup'],
      travel:     ['travel tech startup', 'hospitality innovation', 'booking platform'],
      education:  ['edtech startup', 'online learning platform', 'skills gap'],
      marketing:  ['growth marketing', 'SEO strategy', 'content marketing ROI']
    };

    const queries = INDUSTRY_QUERIES[industry] || INDUSTRY_QUERIES.marketing;

    // Add competitor-specific query if competitors provided
    if (competitors.length > 0) {
      queries.unshift(competitors.slice(0, 2).join(' '));
    }

    // Fetch from 2 queries in parallel
    const [r1, r2] = await Promise.all(
      queries.slice(0, 2).map(q => callHNSearch(q, 5).catch(() => null))
    );

    const seen  = new Set();
    const posts = [];

    for (const result of [r1, r2]) {
      if (!result || !Array.isArray(result.hits)) continue;
      for (const h of result.hits) {
        if (!h.title || seen.has(h.objectID)) continue;
        seen.add(h.objectID);
        const pts = h.points || 0;
        posts.push({
          title:     h.title,
          url:       h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          subreddit: 'Hacker News',
          score:     pts,
          comments:  h.num_comments || 0,
          created:   h.created_at_i || null,
          sentiment: pts > 200 ? 'positive' : pts > 50 ? 'neutral' : 'neutral',
          author:    h.author || ''
        });
      }
    }

    posts.sort((a, b) => b.score - a.score);
    const top = posts.slice(0, 8);

    if (top.length > 0) {
      return res.json({ posts: top, subreddit: 'Hacker News', source: 'live', timestamp: new Date().toISOString() });
    }

    res.json({ posts: [], source: 'no_data' });

  } catch(err) {
    console.error('/api/reddit-signals error:', err.message);
    res.json({ posts: [], source: 'error', error: err.message });
  }
});

// ── POST /api/reddit-monitor ──────────────────────────────────────────────────
app.post('/api/reddit-monitor', async (req, res) => {
  try {
    const { keywords = [], brand = '', competitors = [], industry = 'marketing' } = req.body;

    const queries = [...new Set([
      brand,
      ...keywords.slice(0, 3),
      ...competitors.slice(0, 2)
    ].filter(Boolean))].slice(0, 5);

    if (queries.length === 0) return res.json({ posts: [] });


    // ── Live: Hacker News Algolia (reliably accessible from cloud) ────────────
    const fetchHN = async (query) => {
      try {
        const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8`;
        const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return [];
        const data = await r.json();
        return (data.hits || []).filter(h => h.title).map(h => {
          const now = Date.now() / 1000;
          const ageHrs = Math.max(0.1, (now - (h.created_at_i || now)) / 3600);
          return {
            title: h.title,
            subreddit: 'Hacker News',
            score: h.points || 0,
            comments: h.num_comments || 0,
            ageHours: Math.round(ageHrs),
            velocity: parseFloat(((h.points || 0) / ageHrs).toFixed(1)),
            url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
            preview: '',
            source: 'hn'
          };
        });
      } catch { return []; }
    };

    // ── AI Community Intelligence: GPT-4o generates realistic Reddit signals ──
    // Reddit blocks all cloud server IPs, so we use GPT-4o trained on Reddit
    // data to surface real patterns and community discussions.
    const fetchAISignals = async () => {
      const brandCtx   = brand ? `brand "${brand}"` : 'this company';
      const kwCtx      = keywords.slice(0,5).join(', ') || industry;
      const compCtx    = competitors.slice(0,3).join(', ') || 'competitors';
      const prompt = `You are a Reddit community intelligence analyst. Generate exactly 8 realistic, highly specific Reddit thread simulations representing what real users are currently discussing about ${brandCtx} and topics like: ${kwCtx}. Competitors mentioned: ${compCtx}. Industry: ${industry}.

These should reflect REAL patterns seen on Reddit: complaints, comparisons, how-to questions, success stories, controversies, recommendations.

Use these real relevant subreddits: r/Forex, r/investing, r/personalfinance, r/stocks, r/financialindependence, r/algotrading, r/CFD, r/UKPersonalFinance, r/options, r/wallstreetbets, r/TradingView — adapt subreddits to the actual industry.

Return JSON: { "posts": [ ...exactly 8 items... ] }
Each item must have:
{
  "title": "realistic reddit post title (question, complaint, comparison, or discussion)",
  "subreddit": "r/subredditname",
  "score": number between 10 and 4200,
  "comments": number between 5 and 380,
  "ageHours": number between 1 and 168,
  "url": "https://reddit.com/r/subredditname/comments/abc123/slug",
  "relevance": 0-100,
  "sentiment": "positive"|"neutral"|"negative",
  "urgency": "critical"|"high"|"medium"|"low",
  "serpLikely": true or false,
  "opportunity": "one concrete sentence about how ${brand || 'the brand'} should engage with this thread"
}
Make titles highly specific and realistic — they should mention real concerns, competitor names, or industry terms. No generic filler.`;

      const callAI = async () => {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1200,
          response_format: { type: 'json_object' }
        });
        const raw = completion.choices[0]?.message?.content || '{}';
        const obj = JSON.parse(raw);
        let arr = obj.posts || obj.threads || (Array.isArray(obj) ? obj : null);
        if (!Array.isArray(arr)) {
          const firstArr = Object.values(obj).find(v => Array.isArray(v));
          arr = firstArr || [];
        }
        return arr.map(p => ({
          title:     p.title     || '',
          subreddit: p.subreddit || 'r/investing',
          score:     p.score     || 100,
          comments:  p.comments  || 20,
          ageHours:  p.ageHours  || 24,
          velocity:  parseFloat(((p.score || 100) / Math.max(1, p.ageHours || 24)).toFixed(1)),
          url:       p.url       || `https://reddit.com/r/${(p.subreddit||'investing').replace('r/','')}/`,
          preview:   '',
          relevance:  p.relevance  || 60,
          sentiment:  p.sentiment  || 'neutral',
          urgency:    p.urgency    || 'medium',
          serpLikely: p.serpLikely || false,
          opportunity:p.opportunity|| 'Monitor and engage with this thread.',
          source: 'ai'
        })).filter(p => p.title);
      };

      // 1 retry on transient OpenAI / parse failures.
      try {
        const out = await callAI();
        if (out.length > 0) return { posts: out, error: null };
        throw new Error('AI returned 0 valid posts');
      } catch(e1) {
        console.warn('[reddit-monitor] AI attempt 1 failed:', e1.message);
        try {
          const out = await callAI();
          if (out.length > 0) return { posts: out, error: null };
          return { posts: [], error: 'AI returned no usable posts after 2 attempts' };
        } catch(e2) {
          console.error('[reddit-monitor] AI attempt 2 failed:', e2.message);
          return { posts: [], error: `AI signal generation failed: ${e2.message}` };
        }
      }
    };

    // Run HN + AI signals in parallel
    const [hnPosts, aiResult] = await Promise.all([
      fetchHN(queries[0]),
      fetchAISignals()
    ]);
    const aiPosts = aiResult.posts || [];
    const aiError = aiResult.error || null;

    // Score HN posts with GPT-4o
    let scoredHN = hnPosts;
    if (hnPosts.length > 0) {
      try {
        const scorePrompt = `You are a community intelligence analyst for "${brand || 'our brand'}" in the "${industry}" industry.
Score each Hacker News post for engagement opportunity:
${hnPosts.map((p, i) => `${i}: "${p.title}" [${p.score} pts, ${p.comments} comments]`).join('\n')}
Return JSON: { "scores": [...${hnPosts.length} items...] }
Each item: { "relevance": 0-100, "sentiment": "positive"|"neutral"|"negative", "urgency": "critical"|"high"|"medium"|"low", "serpLikely": false, "opportunity": "one concrete engagement tip" }`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o', messages: [{ role: 'user', content: scorePrompt }],
          max_tokens: 900, response_format: { type: 'json_object' }
        });
        const raw = completion.choices[0]?.message?.content || '{}';
        const obj = JSON.parse(raw);
        const arr = Array.isArray(obj) ? obj : (obj.scores || Object.values(obj)[0] || []);
        scoredHN = hnPosts.map((p, i) => ({ ...p, ...(arr[i] || {}), relevance: arr[i]?.relevance ?? 50 }));
      } catch { /* keep defaults */ }
    }

    // Merge: real HN first, then AI signals
    const all = [...scoredHN, ...aiPosts];
    all.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));

    // If everything came back empty, surface a real error so the client can show it.
    let topError = null;
    if (all.length === 0) {
      if (aiError) topError = aiError;
      else if (scoredHN.length === 0 && aiPosts.length === 0) topError = 'No live HN matches and AI returned no posts. Try broader keywords or different competitors.';
    }

    res.json({
      posts: all,
      sources: { hn: scoredHN.length, ai: aiPosts.length },
      error: topError
    });
  } catch(err) {
    console.error('/api/reddit-monitor error:', err.message);
    res.json({ posts: [], error: `Server error: ${err.message}` });
  }
});

// ── POST /api/reddit-reply ────────────────────────────────────────────────────
app.post('/api/reddit-reply', async (req, res) => {
  try {
    const { postTitle = '', postPreview = '', brand = 'our brand', tone = 'Helpful', persona = '', industry = 'marketing' } = req.body;

    const prompt = `You are managing Reddit presence for the brand "${brand}" in the "${industry}" industry.
Tone: ${tone}. Persona: ${persona || 'knowledgeable industry expert who adds genuine value'}.

Reddit post: "${postTitle}"
Post context: "${postPreview || 'No preview available'}"

Write a genuine, helpful Reddit reply that:
1. Directly addresses the post topic with real insight
2. Subtly mentions ${brand} only if it fits naturally (no spam)
3. Matches the tone (${tone}) and sounds like a real human
4. Is 3-5 sentences — concise but valuable
5. Does NOT open with "Great post!" or any flattery

Return JSON only: { "reply": "...", "tone_note": "brief note on how this matches brand voice" }`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', messages: [{ role: 'user', content: prompt }],
      max_tokens: 400, response_format: { type: 'json_object' }
    });
    const raw = completion.choices[0]?.message?.content || '{}';
    let result;
    try { result = JSON.parse(raw); } catch { result = { reply: raw.replace(/[{}'"]/g, ''), tone_note: '' }; }
    res.json(result);
  } catch(err) {
    console.error('/api/reddit-reply error:', err.message);
    res.json({ reply: '', error: err.message });
  }
});

// ── POST /api/reddit-autofill ─────────────────────────────────────────────────
// Auto-suggests keywords and competitors for a given domain using GPT-4o
app.post('/api/reddit-autofill', async (req, res) => {
  try {
    const { domain = '' } = req.body;
    if (!domain) return res.json({ keywords: '', competitors: '' });


    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `You are a marketing intelligence expert. Given the domain "${domain}", identify:
1. The 6 most relevant keywords/topics that people discuss on Reddit related to this brand's industry and use case
2. The 5 main competitors or alternative brands that users compare with this domain on Reddit

Return ONLY valid JSON (no markdown):
{
  "keywords": "keyword1, keyword2, keyword3, keyword4, keyword5, keyword6",
  "competitors": "Competitor1, Competitor2, Competitor3, Competitor4, Competitor5"
}

Rules:
- Keywords should be topics/phrases Reddit users actually discuss (e.g. "forex trading", "CFD broker review", "online trading platform")
- Competitors should be real brand/domain names that compete with ${domain}
- Be specific to this exact domain and its industry — no generic answers`
      }],
      max_tokens: 200,
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let result;
    try { result = JSON.parse(raw); } catch { result = {}; }
    res.json({ keywords: result.keywords || '', competitors: result.competitors || '' });
  } catch(err) {
    res.json({ keywords: '', competitors: '', error: err.message });
  }
});

// ── POST /api/reddit-studio-suggest — AI persona + title suggestions ────────
app.post('/api/reddit-studio-suggest', async (req, res) => {
  try {
    const { domain = '', tone = 'Helpful', keywords = '', competitors = '' } = req.body || {};
    if (!domain) return res.json({ persona: '', titles: [], error: 'Missing domain' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `You are a Reddit marketing strategist. The brand is "${domain}".
Tone preference: "${tone}".
Keywords this brand targets: ${keywords || '(none provided)'}
Competitors mentioned: ${competitors || '(none provided)'}

Return ONLY valid JSON (no markdown):
{
  "persona": "1–2 sentence brand-voice description that a community manager would use when replying on Reddit. Should reflect the chosen tone, mention the brand's specialty, and include one explicit guardrail (e.g. never sound salesy, never name competitors, always cite sources). Max 220 characters.",
  "titles": ["3 realistic Reddit post titles that this brand's audience would actually post — written from a USER perspective asking for help, comparing options, or sharing experience. No clickbait. Each 6–14 words. Should be answerable by ${domain}."]
}

Rules:
- "persona" must read like a real internal style guide line, not marketing copy.
- "titles" must sound like genuine Reddit posts (questions, comparisons, experience reports). NOT promotional.
- Be specific to ${domain}'s actual industry and use cases.`
      }],
      max_tokens: 400,
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let result;
    try { result = JSON.parse(raw); } catch { result = {}; }
    const titles = Array.isArray(result.titles) ? result.titles.filter(t => typeof t === 'string' && t.trim()).slice(0, 3) : [];
    res.json({ persona: (result.persona || '').toString().trim(), titles });
  } catch(err) {
    console.error('/api/reddit-studio-suggest error:', err.message);
    res.json({ persona: '', titles: [], error: err.message });
  }
});

// ── POST /api/seed-topic-suggest — AI seed topics for the cluster builder ──
app.post('/api/seed-topic-suggest', async (req, res) => {
  try {
    const { domain = '', industry = '', competitors = '' } = req.body || {};
    if (!domain && !industry) return res.json({ topics: [], error: 'Missing domain/industry' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `You are a topical-SEO strategist. Brand: "${domain || '(unspecified)'}". Industry: "${industry || '(unspecified)'}". Competitors: ${competitors || '(none provided)'}.

Suggest 5 strong SEED TOPICS for a topical-cluster page hub. Each seed should:
- Be a 2-4 word evergreen pillar topic (NOT a long-tail question, NOT a single keyword)
- Have meaningful search demand in this brand's space
- Be wide enough to support 6-12 subtopic pages underneath
- Be defensible against the listed competitors

Return ONLY valid JSON (no markdown):
{
  "topics": ["topic 1", "topic 2", "topic 3", "topic 4", "topic 5"]
}

Examples for an email marketing SaaS: ["email marketing automation", "transactional email deliverability", "newsletter growth strategy", "lifecycle email sequences", "B2B email personalization"]`
      }],
      max_tokens: 250,
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let result;
    try { result = JSON.parse(raw); } catch { result = {}; }
    const topics = Array.isArray(result.topics)
      ? result.topics.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()).slice(0, 5)
      : [];
    res.json({ topics });
  } catch(err) {
    console.error('/api/seed-topic-suggest error:', err.message);
    res.json({ topics: [], error: err.message });
  }
});

// ── POST /api/template-images — Fetch industry-relevant images per template ─
// Uses SerpAPI Google Images (live web search) with in-memory cache to keep
// quota usage low. Returns one image URL per requested item, aligned by index.
// LRU-ish bounded cache (oldest entries evicted when size exceeded).
// Map preserves insertion order, so deleting + re-setting on hit moves entries to the tail.
const _templateImageCache = new Map(); // key -> { url, ts }
const TEMPLATE_IMG_TTL_MS    = 1000 * 60 * 60 * 24 * 7; // 7 days
const TEMPLATE_IMG_CACHE_MAX = 2000;
function _cacheGet(key) {
  const v = _templateImageCache.get(key);
  if (!v) return null;
  if ((Date.now() - v.ts) >= TEMPLATE_IMG_TTL_MS) { _templateImageCache.delete(key); return null; }
  // Refresh recency (move to tail)
  _templateImageCache.delete(key);
  _templateImageCache.set(key, v);
  return v.url;
}
function _cacheSet(key, url) {
  if (_templateImageCache.has(key)) _templateImageCache.delete(key);
  _templateImageCache.set(key, { url, ts: Date.now() });
  // Evict oldest until under cap
  while (_templateImageCache.size > TEMPLATE_IMG_CACHE_MAX) {
    const oldest = _templateImageCache.keys().next().value;
    if (oldest === undefined) break;
    _templateImageCache.delete(oldest);
  }
}

function _pickImageFromList(list) {
  if (!Array.isArray(list)) return null;
  // Skip svg, data:, tiny gifs; prefer https
  const ok = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && !/\.svg($|\?)/i.test(u);
  for (const item of list) {
    if (!item) continue;
    const candidates = [item.original, item.image_url, item.source_url, item.url, item.thumbnail];
    for (const c of candidates) if (ok(c)) return c;
  }
  return null;
}

// Resolve a Google Cloud API key suitable for Custom Search / PageSpeed.
// GOOGLE_SEARCH_API_KEY is shared with a RapidAPI integration, so we only
// trust it if it looks like a Google Cloud key (starts with "AIza"); otherwise
// we fall back to GOOGLE_PAGESPEED_API_KEY (which must also be Google-shaped).
// Returns '' when no valid Google key is available — callers should treat that
// as "integration not configured" and never send a non-Google key to googleapis.com.
function _resolveGoogleCloudKey() {
  const candidates = [
    (process.env.GOOGLE_SEARCH_API_KEY || '').trim(),
    (process.env.GOOGLE_PAGESPEED_API_KEY || '').trim(),
  ];
  for (const k of candidates) {
    if (k && k.startsWith('AIza')) return k;
  }
  return '';
}

async function _imageViaDataForSEO(query) {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) return null;
  try {
    // DataForSEO image SERP routinely takes 10-14s end-to-end (measured: 13.2s
    // for a typical query). The previous 5000ms cap silently aborted nearly
    // every call, leaving template tiles permanently on their SVG placeholders.
    // 20s gives the lookup room to finish; the 8-way worker pool keeps the
    // overall /api/template-images request under ~25s even at full batch size.
    const raw = await callDataForSEO(
      '/v3/serp/google/images/live/advanced',
      [{ language_code: 'en', location_code: 2840, keyword: query, depth: 10 }],
      20000
    );
    const items = raw?.tasks?.[0]?.result?.[0]?.items;
    if (!Array.isArray(items)) return null;
    // DataForSEO returns mixed SERP elements: carousel (with nested items), images_search,
    // related_searches, etc. Flatten one level deep so we capture carousel_elements too.
    const flat = [];
    for (const it of items) {
      if (!it) continue;
      if (Array.isArray(it.items)) {
        for (const sub of it.items) if (sub) flat.push(sub);
      } else {
        flat.push(it);
      }
    }
    return _pickImageFromList(flat.map(it => ({
      original: it.image_url || it.source_url,
      image_url: it.image_url,
      source_url: it.source_url,
      thumbnail: it.image_url
    })));
  } catch (e) {
    console.warn('dataforseo image lookup failed:', query, '-', e.message);
    return null;
  }
}

async function _imageViaSerpApi(query) {
  const key = process.env.SERP_API_KEY;
  if (!key) return null;
  try {
    const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&num=10&safe=active&api_key=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.error) return null;
    return _pickImageFromList(data.images_results);
  } catch (e) {
    console.warn('serpapi image lookup failed:', query, '-', e.message);
    return null;
  }
}

async function _lookupTemplateImage(query) {
  const cacheKey = query.toLowerCase().trim();
  const hit = _cacheGet(cacheKey);
  if (hit) return hit;

  // Prefer DataForSEO (configured), fall back to SerpAPI if available
  const url = (await _imageViaDataForSEO(query)) || (await _imageViaSerpApi(query));
  if (url) _cacheSet(cacheKey, url);
  return url;
}

app.post('/api/template-images', async (req, res) => {
  try {
    const { industry = '', sector = '', items = [] } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.json({ images: [] });
    const ctx = (industry || sector || 'business').toString().trim();

    // Cap items processed in one request to keep latency + quota in check.
    // 26 templates is the typical full set; we fetch real images for the first 18
    // and let the rest stay as branded SVG placeholders to keep page-load fast.
    const work = items.slice(0, 18);

    // Process with parallelism 8 — DataForSEO image SERP calls are ~2-4s each;
    // 8-way parallel fetches the typical 18-item batch in ~6-9s instead of ~25s.
    const out = new Array(work.length).fill(null);
    let cursor = 0;
    async function worker() {
      while (cursor < work.length) {
        const i = cursor++;
        try {
          const it = work[i] || {};
          const title = (it.title || '').toString().slice(0, 80);
          const kw = (it.kw || '').toString().slice(0, 60);
          // Build a query that biases toward visual stock-style results in the user's industry
          const q = `${title} ${ctx} ${kw}`.replace(/[→•\-]+/g, ' ').replace(/\s+/g,' ').trim();
          out[i] = await _lookupTemplateImage(q);
        } catch (itemErr) {
          // One failed lookup must NOT zero out the rest of the batch
          console.warn('template-image item failed (idx', i + '):', itemErr.message);
          out[i] = null;
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker(), worker(), worker()]);

    const sourceLabel = (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
      ? 'dataforseo+serpapi-fallback'
      : (process.env.SERP_API_KEY ? 'serpapi' : 'unavailable');
    res.json({ images: out, source: sourceLabel });
  } catch (err) {
    console.error('/api/template-images error:', err.message);
    res.json({ images: [], error: err.message });
  }
});

// ── POST /api/templates/recommend — AI-rank templates against user's context ─
// Body: { domain, sector, keyword, brand, templates: [{id, title, type, tagline}] }
// Response: { ok, recommendations: [{id, score 0-100, rationale}], dataOrigin, dataSource, confidence }
// Falls back to deterministic keyword-overlap scoring if OpenAI fails or is missing.
app.post('/api/templates/recommend', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const domain   = String(body.domain || '').trim().slice(0, 120);
    const sector   = String(body.sector || '').trim().slice(0, 80);
    const keyword  = String(body.keyword || '').trim().slice(0, 80);
    const brand    = String(body.brand || '').trim().slice(0, 80);
    const rawTpls  = Array.isArray(body.templates) ? body.templates : [];
    if (!rawTpls.length) {
      return res.status(400).json({ ok:false, error:'templates array required' });
    }
    // Cap at 30 to control token cost and latency
    const templates = rawTpls.slice(0, 30).map((t, idx) => ({
      id: String(t.id != null ? t.id : idx),
      title: String(t.title || '').slice(0, 120),
      type: String(t.type || '').slice(0, 30),
      tagline: String(t.tagline || '').slice(0, 200)
    })).filter(t => t.title);

    // Deterministic scoring fallback — keyword/sector token overlap on title+tagline
    const _deterministicScore = (tpl) => {
      const haystack = `${tpl.title} ${tpl.tagline}`.toLowerCase();
      const tokens = `${keyword} ${sector} ${brand}`.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
      if (!tokens.length) return 50;
      let hits = 0;
      for (const tok of tokens) if (haystack.includes(tok)) hits++;
      return Math.min(100, 30 + Math.round((hits / tokens.length) * 70));
    };

    let recommendations = null;
    let dataSource = 'deterministic_overlap';
    let dataOrigin = 'deterministic keyword/sector overlap (OpenAI unavailable)';
    let confidence = 'medium';

    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY && templates.length) {
      try {
        const promptCtx = `Domain: ${domain || 'unknown'}\nBrand: ${brand || 'unknown'}\nSector: ${sector || 'unknown'}\nTarget keyword: ${keyword || 'unknown'}`;
        const tplList = templates.map(t => `${t.id}. [${t.type}] ${t.title} — ${t.tagline}`).join('\n');
        const completion = await openaiChatWithRetry({
          model: 'gpt-5-mini',
          messages: [
            { role:'system', content:'You are a senior marketing strategist. Score each template 0-100 for fit to the user\'s domain, sector and target keyword. Reply with ONLY a JSON array of objects {"id": string, "score": number 0-100, "rationale": string ≤120 chars}. No prose.' },
            { role:'user', content:`${promptCtx}\n\nTemplates:\n${tplList}\n\nReturn JSON array now.` }
          ],
          temperature: 0.4,
          max_tokens: 1200
        });
        const raw = (completion.choices?.[0]?.message?.content || '').trim();
        // Strip code fences if present
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          const byId = new Map(templates.map(t => [t.id, t]));
          recommendations = parsed
            .filter(r => r && byId.has(String(r.id)))
            .map(r => ({
              id: String(r.id),
              score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
              rationale: String(r.rationale || '').slice(0, 200)
            }));
          // Backfill any templates the model omitted with deterministic scores
          const seen = new Set(recommendations.map(r => r.id));
          for (const t of templates) {
            if (!seen.has(t.id)) {
              recommendations.push({ id: t.id, score: _deterministicScore(t), rationale: 'Deterministic fallback score (model omitted this template).' });
            }
          }
          dataSource = 'openai_gpt-5-mini';
          dataOrigin = `OpenAI gpt-5-mini ranked ${recommendations.length} templates against domain "${domain}" / sector "${sector}" / keyword "${keyword}"`;
          confidence = 'high';
        }
      } catch (e) {
        console.warn('[templates/recommend] OpenAI failed, using deterministic fallback:', e.message);
      }
    }

    if (!recommendations) {
      recommendations = templates.map(t => ({
        id: t.id,
        score: _deterministicScore(t),
        rationale: `Keyword/sector token overlap with "${keyword || sector || 'context'}".`
      }));
    }

    // Sort by score desc, stable
    recommendations.sort((a, b) => b.score - a.score);
    res.json({ ok:true, recommendations, dataOrigin, dataSource, confidence, generatedAt: Date.now() });
  } catch (err) {
    console.error('/api/templates/recommend error:', err.message);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/intent-map — Classify keywords by search intent + page-fit ────
app.post('/api/intent-map', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const { brand='your brand', url='', industry='your industry', keywords=[], competitors=[] } = body;

    if (typeof brand !== 'string' || typeof url !== 'string' || typeof industry !== 'string') {
      return res.status(400).json({ error: 'brand, url and industry must be strings' });
    }
    if (!Array.isArray(keywords) || !Array.isArray(competitors)) {
      return res.status(400).json({ error: 'keywords and competitors must be arrays' });
    }

    const cleanKeywords = keywords
      .map(k => typeof k === 'string' ? k.trim() : '')
      .filter(Boolean)
      .slice(0, 40);

    if (cleanKeywords.length === 0) {
      return res.status(400).json({ error: 'At least one keyword is required' });
    }

    const compNames = competitors
      .slice(0, 6)
      .map(c => typeof c === 'string' ? c : (c && typeof c === 'object' ? (c.name || '') : ''))
      .filter(Boolean)
      .join(', ') || 'category competitors';

    const systemPrompt = `You are a senior SEO and search-intent strategist. Classify keywords by user intent with high precision and recommend page types. Return JSON only — no commentary.`;

    const userPrompt = `Brand: ${brand}
Brand URL: ${url || 'unknown'}
Industry: ${industry}
Direct competitors: ${compNames}

Keywords to classify (${cleanKeywords.length}):
${cleanKeywords.map((k,i) => `${i+1}. ${k}`).join('\n')}

For each keyword, classify the search intent and recommend the right page type. Use these intent classes:
- "informational" — user wants to learn (blog post, guide, FAQ, how-to)
- "commercial" — user is comparing options (comparison, review, listicle, category page)
- "transactional" — user is ready to buy/sign-up (product page, pricing page, signup landing)
- "navigational" — user is searching for a specific brand or competitor (brand page, comparison vs competitor)

Return JSON exactly in this shape:
{
  "keywords": [
    {
      "keyword": "exact keyword from list",
      "intent": "informational|commercial|transactional|navigational",
      "confidence": 0-100,
      "recommendedPageType": "Blog Post|How-To Guide|Comparison Page|Review|Category Page|Product Page|Pricing Page|Signup Landing|Brand Page|Competitor Comparison|FAQ",
      "intentMatchScore": 0-100,
      "matchReason": "one short sentence on whether ${url || 'the brand site'} likely already serves this intent well",
      "competitorGap": true or false,
      "gapReason": "one short sentence: which competitor likely owns this and why ${brand} should target it",
      "opportunity": "one concrete action sentence — what to publish or build",
      "estimatedCPC": "low|medium|high",
      "priority": "must-do|nice-to-have|skip"
    }
  ]
}

Be ruthless and specific. Score intentMatchScore HIGH (80-100) only if the brand's likely current site clearly serves the intent; LOW (0-40) if there's a clear mismatch. Mark competitorGap=true when this is a keyword the brand is likely NOT ranking for but a competitor is. Keep all sentences under 18 words.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 3500,
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    let obj;
    try { obj = JSON.parse(raw); } catch(parseErr) {
      console.error('/api/intent-map JSON parse failed:', parseErr.message);
      return res.status(502).json({ error: 'AI returned invalid JSON. Try again.' });
    }

    let arr = Array.isArray(obj.keywords) ? obj.keywords : (Array.isArray(obj) ? obj : []);
    if (!Array.isArray(arr)) {
      const firstArr = Object.values(obj).find(v => Array.isArray(v));
      arr = firstArr || [];
    }

    const validIntents = new Set(['informational','commercial','transactional','navigational']);
    const items = arr
      .filter(k => k && typeof k === 'object' && k.keyword)
      .map(k => ({
        keyword:             String(k.keyword).slice(0, 120),
        intent:              validIntents.has(k.intent) ? k.intent : 'informational',
        confidence:          Math.max(0, Math.min(100, parseInt(k.confidence) || 60)),
        recommendedPageType: String(k.recommendedPageType || 'Blog Post').slice(0, 60),
        intentMatchScore:    Math.max(0, Math.min(100, parseInt(k.intentMatchScore) || 50)),
        matchReason:         String(k.matchReason || '').slice(0, 200),
        competitorGap:       k.competitorGap === true,
        gapReason:           String(k.gapReason || '').slice(0, 200),
        opportunity:         String(k.opportunity || 'Create dedicated content for this keyword.').slice(0, 240),
        estimatedCPC:        ['low','medium','high'].includes(k.estimatedCPC) ? k.estimatedCPC : 'medium',
        priority:            ['must-do','nice-to-have','skip'].includes(k.priority) ? k.priority : 'nice-to-have'
      }));

    if (items.length === 0) {
      return res.status(502).json({ error: 'AI returned no usable keywords. Try again with broader keywords.' });
    }

    // Build summary buckets
    const byIntent = { informational:0, commercial:0, transactional:0, navigational:0 };
    let gaps = 0;
    let scoreSum = 0;
    items.forEach(it => {
      byIntent[it.intent]++;
      if (it.competitorGap) gaps++;
      scoreSum += it.intentMatchScore;
    });
    const avgScore = Math.round(scoreSum / items.length);

    res.json({
      keywords: items,
      summary: {
        total: items.length,
        byIntent,
        gaps,
        avgIntentMatch: avgScore,
        mustDoCount: items.filter(i => i.priority === 'must-do').length
      }
    });
  } catch(err) {
    console.error('/api/intent-map error:', err.message);
    res.status(500).json({ error: `Intent classification failed: ${err.message}` });
  }
});

// ── POST /api/keyword-page-map — Map keywords to URLs + detect cannibalisation ─
app.post('/api/keyword-page-map', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const { brand='', industry='', pages=[], keywords=[] } = body;
    if (typeof brand !== 'string' || typeof industry !== 'string') {
      return res.status(400).json({ error: 'brand and industry must be strings' });
    }
    if (!Array.isArray(pages) || !pages.length) {
      return res.status(400).json({ error: 'pages must be a non-empty array' });
    }
    if (!Array.isArray(keywords) || !keywords.length) {
      return res.status(400).json({ error: 'keywords must be a non-empty array' });
    }
    const cleanPages = pages.slice(0, 30).map(p => {
      if (typeof p === 'string') return { url: p.trim(), title: '', description: '' };
      if (p && typeof p === 'object') {
        return {
          url: String(p.url || '').trim(),
          title: String(p.title || '').trim().slice(0, 200),
          description: String(p.description || '').trim().slice(0, 300)
        };
      }
      return null;
    }).filter(p => p && p.url);
    if (!cleanPages.length) return res.status(400).json({ error: 'No valid page URLs supplied' });

    const cleanKws = Array.from(new Set(keywords.slice(0, 80).map(k => String(k || '').toLowerCase().trim()).filter(Boolean)));
    if (!cleanKws.length) return res.status(400).json({ error: 'No valid keywords supplied' });

    const systemPrompt = `You are a senior SEO strategist specialising in keyword–page mapping. For each page, choose ONE primary keyword (the single best target) and 2-5 supporting/semantic keywords from the supplied pool. Return JSON only.`;
    const userPrompt = `Brand: ${brand || 'unknown'}
Industry: ${industry || 'unknown'}

PAGES (${cleanPages.length}):
${cleanPages.map((p,i) => `${i+1}. ${p.url}${p.title ? ' | title: '+p.title : ''}${p.description ? ' | desc: '+p.description : ''}`).join('\n')}

KEYWORD POOL (${cleanKws.length}):
${cleanKws.join(', ')}

Return a JSON array (one object per page) with this exact shape:
[
  {
    "url": "<page url verbatim>",
    "primaryKeyword": "<one keyword from the pool that best fits this page>",
    "primaryConfidence": 0-100,
    "supportingKeywords": ["kw","kw","kw"],
    "rationale": "<one short sentence on why this primary fits>",
    "pageStrengthScore": 0-100,
    "recommendation": "<one concrete next-step action — e.g. expand H2 sections, add FAQ, target long-tail variant, etc>"
  }
]
Rules:
- Use ONLY keywords from the pool — never invent.
- Each supporting keyword must be semantically related to the primary.
- It is OK if the same primary keyword is chosen for two different pages — we will detect that as cannibalisation downstream.
- pageStrengthScore reflects how well the existing page (URL/title/desc) already serves the chosen primary.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 3500
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch(parseErr) {
      console.error('/api/keyword-page-map JSON parse failed:', parseErr.message);
      return res.status(502).json({ error: 'AI returned invalid JSON — please retry' });
    }
    if (!Array.isArray(parsed) || !parsed.length) {
      return res.status(502).json({ error: 'AI returned no usable page mappings' });
    }

    const kwSet = new Set(cleanKws);
    // Normalise + strict pool enforcement (off-pool primaries / supporting keywords are dropped)
    const aiItems = parsed.map(p => {
      const primary = String(p.primaryKeyword || '').toLowerCase().trim();
      // Only accept primary if it's in the supplied pool
      const validPrimary = kwSet.has(primary) ? primary : '';
      const rawSupp = Array.isArray(p.supportingKeywords) ? p.supportingKeywords : [];
      const cleanedSupp = Array.from(new Set(
        rawSupp.map(k => String(k || '').toLowerCase().trim())
               .filter(k => k && kwSet.has(k) && k !== validPrimary)
      ));
      return {
        url: String(p.url || '').trim(),
        primaryKeyword: validPrimary,
        primaryConfidence: Math.max(0, Math.min(100, Number(p.primaryConfidence) || 0)),
        supportingKeywords: cleanedSupp.slice(0, 5),
        rationale: String(p.rationale || '').slice(0, 280),
        pageStrengthScore: Math.max(0, Math.min(100, Number(p.pageStrengthScore) || 0)),
        recommendation: String(p.recommendation || '').slice(0, 280)
      };
    });

    // Reconcile AI output against input pages — guarantee one mapping per requested URL
    const aiByUrl = {};
    aiItems.forEach(it => { if (it.url) aiByUrl[it.url] = it; });
    const FALLBACK_RATIONALE = 'Auto-fallback assignment — AI did not return a usable in-pool mapping for this page; review manually.';
    const FALLBACK_RECOMMENDATION = 'Review this page manually and pick a primary keyword that matches its actual content.';
    const items = cleanPages.map(req => {
      const fromAi = aiByUrl[req.url];
      const aiPrimaryValid = !!(fromAi && fromAi.primaryKeyword); // already validated against pool above
      if (aiPrimaryValid) {
        return {
          url: req.url,
          primaryKeyword: fromAi.primaryKeyword,
          primaryConfidence: fromAi.primaryConfidence,
          supportingKeywords: fromAi.supportingKeywords,
          rationale: fromAi.rationale,
          pageStrengthScore: fromAi.pageStrengthScore,
          recommendation: fromAi.recommendation
        };
      }
      // Deterministic fallback (covers BOTH missing-AI-page AND off-pool-primary cases)
      const fallbackPrimary = cleanKws[0];
      const fallbackSupp = cleanKws.filter(k => k !== fallbackPrimary).slice(0, 3);
      return {
        url: req.url,
        primaryKeyword: fallbackPrimary,
        primaryConfidence: 30,
        supportingKeywords: fallbackSupp,
        rationale: FALLBACK_RATIONALE,
        pageStrengthScore: 0,
        recommendation: FALLBACK_RECOMMENDATION
      };
    });

    // Final normalisation pass: enforce pool membership, dedupe, exclude primary, top up to ≥2
    items.forEach(it => {
      const seen = new Set();
      it.supportingKeywords = it.supportingKeywords
        .filter(k => k && kwSet.has(k) && k !== it.primaryKeyword)
        .filter(k => { if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, 5);
      if (it.supportingKeywords.length < 2) {
        const used = new Set([it.primaryKeyword, ...it.supportingKeywords]);
        const need = 2 - it.supportingKeywords.length;
        const topUp = cleanKws.filter(k => !used.has(k)).slice(0, need);
        it.supportingKeywords = it.supportingKeywords.concat(topUp);
      }
    });

    // Cannibalisation detection — any primary keyword used by >1 URL
    const primaryCount = {};
    items.forEach(it => { primaryCount[it.primaryKeyword] = (primaryCount[it.primaryKeyword] || 0) + 1; });
    const cannibalised = items.map(it => ({
      ...it,
      cannibalised: primaryCount[it.primaryKeyword] > 1,
      cannibalisedWith: primaryCount[it.primaryKeyword] > 1
        ? items.filter(o => o.primaryKeyword === it.primaryKeyword && o.url !== it.url).map(o => o.url)
        : []
    }));

    const cannibalGroups = Object.entries(primaryCount)
      .filter(([_, n]) => n > 1)
      .map(([kw, n]) => ({
        keyword: kw,
        count: n,
        urls: items.filter(it => it.primaryKeyword === kw).map(it => it.url)
      }));

    const avgStrength = items.length
      ? Math.round(items.reduce((s,i) => s + i.pageStrengthScore, 0) / items.length)
      : 0;

    res.json({
      pages: cannibalised,
      summary: {
        totalPages: cannibalised.length,
        uniquePrimaries: Object.keys(primaryCount).length,
        cannibalisedKeywords: cannibalGroups.length,
        cannibalisedPages: cannibalised.filter(p => p.cannibalised).length,
        avgPageStrength: avgStrength,
        totalSupportingKeywords: cannibalised.reduce((s,p) => s + p.supportingKeywords.length, 0)
      },
      cannibalGroups
    });
  } catch(err) {
    console.error('/api/keyword-page-map error:', err.message);
    res.status(500).json({ error: `Keyword-page mapping failed: ${err.message}` });
  }
});

// ── POST /api/icp-draft — Auto-draft Ideal Customer Profile from brand intel ─
app.post('/api/icp-draft', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const { domain='yourdomain.com', industry='your industry', country='Global', competitors=[] } = body;
    // Validate types — return 400 on bad payload, 500 reserved for upstream/runtime faults
    if (typeof domain !== 'string' || typeof industry !== 'string' || typeof country !== 'string') {
      return res.status(400).json({ error: 'domain, industry and country must be strings' });
    }
    if (!Array.isArray(competitors)) {
      return res.status(400).json({ error: 'competitors must be an array' });
    }
    const compNames = competitors.slice(0, 6).map(c => typeof c === 'string' ? c : (c && typeof c === 'object' ? (c.name || '') : '')).filter(Boolean).join(', ') || 'category competitors';
    const systemPrompt = `You are a senior B2C/B2B customer-research strategist. Build a tight, opinionated, data-grounded Ideal Customer Profile. Return JSON only — no commentary.`;
    const userPrompt = `Brand: ${domain}
Industry: ${industry}
Geography: ${country}
Direct competitors: ${compNames}

Build the most likely Ideal Customer Profile (ICP) for this brand. Be specific — no generic personas. Reflect what real people in ${industry} actually look like, what they Google, and what makes them buy or hesitate.

Return JSON exactly in this shape:
{
  "ageRange": "e.g. 28–45",
  "role": "primary role / job title / life stage in 4–8 words",
  "intent": "stage of intent in 3–5 words (e.g. Actively comparing alternatives)",
  "painPoints": ["pain 1 in 6–12 words","pain 2 in 6–12 words","pain 3 in 6–12 words"],
  "desires": ["desire 1 in 6–12 words","desire 2 in 6–12 words","desire 3 in 6–12 words"],
  "budget": "budget band as a short phrase (e.g. £500–£2,000/mo)"
}`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role:'system', content: systemPrompt }, { role:'user', content: userPrompt }],
      max_tokens: 600,
      temperature: 0.6,
      response_format: { type:'json_object' }
    });
    const icp = JSON.parse(completion.choices[0]?.message?.content || '{}');
    res.json({ icp });
  } catch (err) {
    console.error('/api/icp-draft error:', err.message);
    res.status(500).json({ error: err.message || 'ICP draft failed' });
  }
});

// ── POST /api/icp-voc — Voice-of-Customer mining (triggers, objections, drivers)
app.post('/api/icp-voc', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const { icp={}, redditPosts=[], competitors=[], industry='your industry', domain='yourdomain.com' } = body;
    // Validate types — return 400 on bad payload
    if (icp && typeof icp !== 'object') return res.status(400).json({ error: 'icp must be an object' });
    if (!Array.isArray(redditPosts)) return res.status(400).json({ error: 'redditPosts must be an array' });
    if (!Array.isArray(competitors)) return res.status(400).json({ error: 'competitors must be an array' });
    if (typeof industry !== 'string' || typeof domain !== 'string') {
      return res.status(400).json({ error: 'industry and domain must be strings' });
    }
    const safeIcp = icp || {};
    // Compact Reddit signal so the prompt stays small
    const redditSnippet = redditPosts.slice(0, 12).map((p,i) => {
      const post = (p && typeof p === 'object') ? p : {};
      return `[${i+1}] r/${String(post.subreddit||'').replace(/^r\//,'')} · ${post.title||''} · score ${post.score||0}/comments ${post.comments||0}/sentiment ${post.sentiment||'neutral'}`;
    }).join('\n') || '(no live Reddit signal — infer from category)';
    const compList = competitors.slice(0,6).map(c => typeof c==='string' ? c : (c && typeof c==='object' ? (c.name||'') : '')).filter(Boolean).join(', ') || 'category competitors';
    const pains   = Array.isArray(safeIcp.painPoints) ? safeIcp.painPoints : [];
    const desires = Array.isArray(safeIcp.desires)    ? safeIcp.desires    : [];
    const icpLine = `${safeIcp.ageRange||'?'} ${safeIcp.role||''} · ${safeIcp.intent||''} · pains: ${pains.join(' / ')} · desires: ${desires.join(' / ')} · budget: ${safeIcp.budget||'?'}`;

    const systemPrompt = `You are a voice-of-customer research analyst. You read raw community signal and extract crisp buying psychology. Return JSON only.`;
    const userPrompt = `Brand: ${domain}
Industry: ${industry}
ICP: ${icpLine}
Competitors: ${compList}

Reddit / community signal (real recent threads):
${redditSnippet}

From this signal — combined with your knowledge of the ${industry} space — extract the real buying psychology of this ICP.

Return JSON exactly in this shape:
{
  "triggers":         [ {"text":"they buy when X happens", "evidence":"1-line evidence from signal or category"} , ... 5 items ],
  "objections":       [ {"text":"they don't buy because X", "evidence":"1-line evidence from signal or category"} , ... 5 items ],
  "emotionalDrivers": [ {"text":"they really want to feel X", "evidence":"1-line evidence from signal or category"} , ... 5 items ]
}

Rules:
- Each "text" must be a single tight sentence under 14 words.
- "evidence" must reference real signal patterns or category truths — not generic platitudes.
- No duplicates across the three lists.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role:'system', content: systemPrompt }, { role:'user', content: userPrompt }],
      max_tokens: 1200,
      temperature: 0.5,
      response_format: { type:'json_object' }
    });
    const voc = JSON.parse(completion.choices[0]?.message?.content || '{}');
    // Defensive normalisation
    const norm = arr => (Array.isArray(arr) ? arr : []).slice(0,5).map(x => typeof x==='string' ? {text:x, evidence:''} : { text: x.text||'', evidence: x.evidence||'' }).filter(x=>x.text);
    res.json({
      triggers:         norm(voc.triggers),
      objections:       norm(voc.objections),
      emotionalDrivers: norm(voc.emotionalDrivers || voc.drivers)
    });
  } catch (err) {
    console.error('/api/icp-voc error:', err.message);
    res.status(500).json({ error: err.message || 'VoC mining failed' });
  }
});

// ── POST /api/ai-channel-ad ───────────────────────────────────────────────────
app.post('/api/ai-channel-ad', async (req, res) => {
  try {
    const { platform='Meta', format='Image Ad', goal='Lead Generation', audience='business owners', domain='yourdomain.com', industry='your industry', budget='100' } = req.body;
    const systemPrompt = `You are an expert performance marketing copywriter. Write concise, high-converting ad copy for ${platform} ${format} ads. Never mention competitor brand names. Return JSON only.`;
    const userPrompt = `Write a ${platform} ${format} ad for ${domain} in the ${industry} industry.
Goal: ${goal}. Target audience: ${audience}. Daily budget: $${budget}.
Return JSON: { "headline": "...", "body": "...", "cta": "...", "hashtags": "..." }
Headline: 5-10 words. Body: 1-3 sentences. CTA: 3-5 words. Hashtags: 3-5 relevant (for social platforms).`;
    const completion = await openai.chat.completions.create({ model:'gpt-4o', messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}], max_tokens:300, response_format:{type:'json_object'} });
    const ad = JSON.parse(completion.choices[0]?.message?.content||'{}');
    res.json({ ad });
  } catch(err) {
    res.json({ ad: { headline:`Grow with ${req.body?.domain||'us'}`, body:`The smart way to drive leads in ${req.body?.industry||'your industry'}. Start your campaign today.`, cta:'Get Started Free', hashtags:'#marketing #growth #leads' }, error: err.message });
  }
});

// ── POST /api/ai-content-clusters ─────────────────────────────────────────────
app.post('/api/ai-content-clusters', async (req, res) => {
  try {
    const { seed, domain='yourdomain.com', industry='your industry' } = req.body;

    const systemPrompt = `You are an expert SEO strategist and content architect specialising in topical authority and LLM visibility. Return JSON only.`;
    const gptPrompt = `Build a comprehensive topical cluster for the seed topic: "${seed}"
Context: domain=${domain}, industry=${industry}

Return JSON: {
  "pillar": "pillar page title",
  "topics": ["7-10 subtopic page titles"],
  "questions": ["6-8 real user questions people ask ChatGPT/Google about this topic"],
  "aiNote": "1-2 sentence tip for maximising LLM citation chances for this cluster"
}`;

    const claudePrompt = `You are a content strategy expert specialising in AI-answer engine optimisation. For the topic "${seed}" in the "${industry}" industry on the domain "${domain}":

Generate 4 ADDITIONAL user questions — different from standard SEO questions — that people commonly ask AI assistants (ChatGPT, Perplexity, Gemini) about this topic.
Also provide 1 unique LLM citation tip that complements standard SEO advice.

Return ONLY raw JSON: {
  "extraQuestions": ["4 questions"],
  "llmTip": "one additional LLM citation tip sentence"
}`;

    const [gptResult, claudeResult] = await Promise.allSettled([
      openai.chat.completions.create({ model:'gpt-4o', messages:[{role:'system',content:systemPrompt},{role:'user',content:gptPrompt}], max_tokens:700, response_format:{type:'json_object'} }),
      anthropic.messages.create({ model:'claude-sonnet-4-6', max_tokens:350, messages:[{role:'user', content:claudePrompt}] })
    ]);

    let cluster = {};
    if (gptResult.status === 'fulfilled') {
      try { cluster = JSON.parse(gptResult.value.choices[0]?.message?.content || '{}'); } catch {}
    }
    if (!cluster.pillar) cluster.pillar = seed;

    if (claudeResult.status === 'fulfilled') {
      try {
        const raw = claudeResult.value.content?.[0]?.text || '{}';
        const claudeData = JSON.parse(raw.replace(/```json|```/g,'').trim());
        if (claudeData.extraQuestions?.length) {
          const existing = new Set((cluster.questions||[]).map(q => q.toLowerCase().slice(0,35)));
          const newQs = claudeData.extraQuestions.filter(q => !existing.has(q.toLowerCase().slice(0,35)));
          cluster.questions = [...(cluster.questions||[]), ...newQs];
        }
        if (claudeData.llmTip && cluster.aiNote) {
          cluster.aiNote = cluster.aiNote + ' ' + claudeData.llmTip;
        }
        cluster._dualAI = true;
      } catch {}
    }

    res.json({ cluster });
  } catch(err) {
    res.json({ cluster: null, error: err.message });
  }
});

// ── POST /api/ai-visibility-multi ─────────────────────────────────────────────
// Queries every supported AI engine in parallel for real brand-visibility data.
// Returns: { models: [{ key, name, live, score, mentioned, snippet, error? }, ...], live: {...} }
//
// LIVE-integrated models (use real APIs):
//   • ChatGPT  — OpenAI GPT-4o
//   • Claude   — Anthropic Claude Sonnet
//   • Google   — Google Custom Search JSON API (GOOGLE_SEARCH_API_KEY)
//   • Google AI — same Google Search API but ranks AI Overview / SGE-style picks
//   • Bing     — DataForSEO Bing organic SERP
// READY-but-needs-key (returns live:false with a status message):
//   • Gemini, Perplexity, Llama, DeepSeek
app.post('/api/ai-visibility-multi', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry' } = req.body || {};
    const cleanDomain = String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
    const brandStem = cleanDomain.split('.')[0];

    const queryQ = `Best ${industry} companies — is ${brandStem} (${cleanDomain}) one of the leading options? Give a 2-sentence answer and explicitly say YES_CITED or NOT_CITED at the end.`;

    // ── Helper: detect mention of brand in any text response ────────────────
    const detectMention = (text) => {
      if (!text) return false;
      const t = String(text).toLowerCase();
      return t.includes(cleanDomain) || t.includes(brandStem) || /yes_cited/i.test(text);
    };
    const scoreFor = (mentioned, hasResult) => !hasResult ? 0 : (mentioned ? Math.floor(60 + Math.random() * 35) : Math.floor(15 + Math.random() * 30));

    // ── ChatGPT (OpenAI) ────────────────────────────────────────────────────
    const chatgptP = (async () => {
      try {
        const c = await openai.chat.completions.create({
          model: 'gpt-4o', max_tokens: 180,
          messages: [{ role: 'user', content: queryQ }],
        });
        const text = c.choices?.[0]?.message?.content?.trim() || '';
        const mentioned = detectMention(text);
        return { key:'chatgpt', name:'ChatGPT', live:true, mentioned, score:scoreFor(mentioned,true), snippet:text.slice(0,240) };
      } catch (e) { return { key:'chatgpt', name:'ChatGPT', live:true, mentioned:false, score:0, error:e.message }; }
    })();

    // ── Claude (Anthropic) ──────────────────────────────────────────────────
    const claudeP = (async () => {
      try {
        const c = await anthropic.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 200,
          messages: [{ role:'user', content: queryQ }],
        });
        const text = c.content?.[0]?.text?.trim() || '';
        const mentioned = detectMention(text);
        return { key:'claude', name:'Claude', live:true, mentioned, score:scoreFor(mentioned,true), snippet:text.slice(0,240) };
      } catch (e) { return { key:'claude', name:'Claude', live:true, mentioned:false, score:0, error:e.message }; }
    })();

    // ── Google Search (Custom Search JSON API) ──────────────────────────────
    const googleP = (async () => {
      const key = _resolveGoogleCloudKey();
      const cx  = (process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_SEARCH_ENGINE_ID || '').trim();
      if (!key || !cx) return { key:'google', name:'Google', live:false, mentioned:false, score:0, snippet:'GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX needed' };
      try {
        const q = encodeURIComponent(`best ${industry} companies`);
        const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10`);
        if (!r.ok) throw new Error('HTTP '+r.status);
        const data = await r.json();
        const items = data.items || [];
        const mentioned = items.some(it => (it.link||'').toLowerCase().includes(cleanDomain) || (it.snippet||'').toLowerCase().includes(brandStem));
        const rank = items.findIndex(it => (it.link||'').toLowerCase().includes(cleanDomain));
        return { key:'google', name:'Google', live:true, mentioned, score: mentioned ? Math.max(50, 100 - rank * 8) : 25, snippet: mentioned ? `Ranked #${rank+1} of ${items.length} results` : `Not in top ${items.length} results` };
      } catch (e) { return { key:'google', name:'Google', live:false, mentioned:false, score:0, error:e.message }; }
    })();

    // ── Google AI (re-uses Google Search but checks for top-3 SGE-style position) ─
    const googleAiP = (async () => {
      const key = _resolveGoogleCloudKey();
      const cx  = (process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_SEARCH_ENGINE_ID || '').trim();
      if (!key || !cx) return { key:'googleAi', name:'Google AI', live:false, mentioned:false, score:0, snippet:'Connect Google Custom Search to enable' };
      try {
        const q = encodeURIComponent(`${brandStem} ${industry} review`);
        const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=5`);
        if (!r.ok) throw new Error('HTTP '+r.status);
        const data = await r.json();
        const items = data.items || [];
        const inTop3 = items.slice(0,3).some(it => (it.link||'').toLowerCase().includes(cleanDomain) || (it.snippet||'').toLowerCase().includes(brandStem));
        return { key:'googleAi', name:'Google AI', live:true, mentioned:inTop3, score: inTop3 ? 78 : 32, snippet: inTop3 ? 'Likely surfaced in AI Overviews / SGE' : 'Below AI Overview cut-off — needs authority signals' };
      } catch (e) { return { key:'googleAi', name:'Google AI', live:false, mentioned:false, score:0, error:e.message }; }
    })();

    // ── Bing (via DataForSEO Bing organic SERP) ─────────────────────────────
    const bingP = (async () => {
      if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
        return { key:'bing', name:'Bing', live:false, mentioned:false, score:0, snippet:'DATAFORSEO_LOGIN/PASSWORD needed for live Bing tracking' };
      }
      try {
        const raw = await callDataForSEO('/v3/serp/bing/organic/live/advanced', [{ keyword:`best ${industry} companies`, language_name:'English', depth: 20 }], 12000);
        if (raw.status_code !== 20000) throw new Error(raw.status_message);
        const items = raw.tasks?.[0]?.result?.[0]?.items || [];
        const orgItems = items.filter(i => i.type === 'organic');
        const rank = orgItems.findIndex(it => (it.domain||'').replace(/^www\./,'').toLowerCase() === cleanDomain || (it.url||'').toLowerCase().includes(cleanDomain));
        const mentioned = rank >= 0;
        return { key:'bing', name:'Bing', live:true, mentioned, score: mentioned ? Math.max(45, 100 - rank * 6) : 22, snippet: mentioned ? `Ranked #${rank+1} on Bing` : `Not in top ${orgItems.length} Bing results` };
      } catch (e) { return { key:'bing', name:'Bing', live:false, mentioned:false, score:0, error:e.message }; }
    })();

    // ── Models pending API key ──────────────────────────────────────────────
    const pending = (key, name, secretName) => Promise.resolve({
      key, name, live:false, mentioned:false, score:0,
      snippet: `Add ${secretName} secret to enable live ${name} tracking`,
    });

    const [chatgpt, claude, google, googleAi, bing, gemini, perplexity, llama, deepseek] = await Promise.all([
      chatgptP, claudeP, googleP, googleAiP, bingP,
      process.env.GEMINI_API_KEY     ? (async () => { try { _chargeBudget('gemini', req.ip); const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{ parts:[{ text: queryQ }] }] }) }); const d = await r.json(); const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || ''; const m = detectMention(text); return { key:'gemini', name:'Gemini', live:true, mentioned:m, score:scoreFor(m,true), snippet:text.slice(0,240) }; } catch(e){ return { key:'gemini', name:'Gemini', live:false, mentioned:false, score:0, error:e.message }; } })() : pending('gemini','Gemini','GEMINI_API_KEY'),
      process.env.PERPLEXITY_API_KEY ? (async () => { try { _chargeBudget('perplexity', req.ip); const r = await fetch('https://api.perplexity.ai/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`}, body: JSON.stringify({ model:'sonar', messages:[{role:'user',content:queryQ}] }) }); const d = await r.json(); const text = d?.choices?.[0]?.message?.content || ''; const m = detectMention(text); return { key:'perplexity', name:'Perplexity', live:true, mentioned:m, score:scoreFor(m,true), snippet:text.slice(0,240) }; } catch(e){ return { key:'perplexity', name:'Perplexity', live:false, mentioned:false, score:0, error:e.message }; } })() : pending('perplexity','Perplexity','PERPLEXITY_API_KEY'),
      (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN)
        ? (async () => { try {
            const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
              { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`},
                body: JSON.stringify({ messages:[{role:'user',content:queryQ}] }) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const d = await r.json();
            const text = d?.result?.response || '';
            // Only charge budget after a successful upstream response so failed
            // calls (auth/5xx/rate-limit) don't burn the daily quota.
            try { _chargeBudget('cloudflare', req.ip); } catch (_) {}
            const m = detectMention(text);
            return { key:'llama', name:'Llama 3.1 (Cloudflare)', live:true, mentioned:m, score:scoreFor(m,true), snippet:text.slice(0,240) };
          } catch(e){ return { key:'llama', name:'Llama 3.1 (Cloudflare)', live:false, mentioned:false, score:0, error:e.message }; } })()
        : pending('llama','Llama','CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN'),
      process.env.DEEPSEEK_API_KEY   ? (async () => { try { const r = await fetch('https://api.deepseek.com/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`}, body: JSON.stringify({ model:'deepseek-chat', messages:[{role:'user',content:queryQ}] }) }); const d = await r.json(); const text = d?.choices?.[0]?.message?.content || ''; const m = detectMention(text); return { key:'deepseek', name:'DeepSeek', live:true, mentioned:m, score:scoreFor(m,true), snippet:text.slice(0,240) }; } catch(e){ return { key:'deepseek', name:'DeepSeek', live:false, mentioned:false, score:0, error:e.message }; } })() : pending('deepseek','DeepSeek','DEEPSEEK_API_KEY'),
    ]);

    const models = [chatgpt, gemini, perplexity, googleAi, claude, llama, deepseek, google, bing];
    const live = {};
    models.forEach(m => { live[m.key] = !!m.live; });
    const liveCount = models.filter(m => m.live).length;
    const citedCount = models.filter(m => m.live && m.mentioned).length;

    res.json({ ok:true, domain:cleanDomain, industry, models, live, summary:{ liveCount, citedCount, totalTracked: models.length } });
  } catch (err) {
    console.error('/api/ai-visibility-multi error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/dfs-ai-optimization ─────────────────────────────────────────────
// DataForSEO AI Optimization API — fires a single user prompt across ChatGPT,
// Claude, Gemini, Perplexity in parallel via DataForSEO (one billing, one
// trial). Returns each model's answer + token counts + per-call cost + brand
// citation analysis. Use this when DataForSEO AI Optimization add-on is active
// (14-day trial available at app.dataforseo.com).
app.post('/api/dfs-ai-optimization', async (req, res) => {
  try {
    const { prompt, domain = '', brand = '', engines: reqEngines = ['chat_gpt','claude','gemini','perplexity'], webSearch = false } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ ok:false, error:'prompt required' });
    const ALLOWED_ENGINES = ['chat_gpt','claude','gemini','perplexity'];
    const engines = (Array.isArray(reqEngines) ? reqEngines : []).filter(e => ALLOWED_ENGINES.includes(e));
    if (!engines.length) return res.status(400).json({ ok:false, error:`engines must include one of: ${ALLOWED_ENGINES.join(', ')}` });
    if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
      return res.status(400).json({ ok:false, error:'DataForSEO credentials not configured' });
    }
    const DEFAULT_MODELS = {
      chat_gpt:   'gpt-4o-mini',
      claude:     'claude-sonnet-4-5',
      gemini:     'gemini-2.5-flash',
      perplexity: 'sonar',
    };
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].toLowerCase();
    const brandStem = (brand || cleanDomain.split('.')[0] || '').toLowerCase();
    const auth = 'Basic ' + Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');

    async function callEngine(engine) {
      const model = DEFAULT_MODELS[engine] || DEFAULT_MODELS.chat_gpt;
      try {
        const r = await fetch(`https://api.dataforseo.com/v3/ai_optimization/${engine}/llm_responses/live`, {
          method: 'POST',
          headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
          body: JSON.stringify([Object.assign(
            { user_prompt: prompt, model_name: model },
            (webSearch && engine !== 'perplexity') ? { web_search: true } : {}
          )]),
        });
        const j = await r.json();
        const task = j?.tasks?.[0] || {};
        if (task.status_code !== 20000) {
          return { engine, model, ok:false, error: task.status_message || `status ${task.status_code}` };
        }
        const result = task.result?.[0] || {};
        const sections = (result.items || []).flatMap(it => Array.isArray(it.sections) ? it.sections : []);
        const text = sections.filter(s => s.type === 'text' || s.text).map(s => s.text || '').join('\n\n').trim();
        const mentioned = brandStem ? (text.toLowerCase().includes(brandStem) || (cleanDomain && text.toLowerCase().includes(cleanDomain))) : false;
        return {
          engine, model: result.model_name || model, ok:true,
          answer: text,
          mentioned,
          input_tokens: result.input_tokens || 0,
          output_tokens: result.output_tokens || 0,
          cost_usd: result.money_spent || task.cost || 0,
          web_search: !!result.web_search,
          duration_sec: parseFloat(task.time) || 0,
        };
      } catch (e) {
        return { engine, model, ok:false, error: e.message };
      }
    }

    const results = await Promise.all(engines.map(callEngine));
    const totalCost = results.reduce((s, r) => s + (r.cost_usd || 0), 0);
    const liveCount = results.filter(r => r.ok).length;
    const citedCount = results.filter(r => r.ok && r.mentioned).length;
    res.json({ ok:true, prompt, brand: brandStem, domain: cleanDomain, webSearch: !!webSearch, results,
      summary: { engines: engines.length, live: liveCount, cited: citedCount, totalCostUsd: totalCost } });
  } catch (err) {
    console.error('/api/dfs-ai-optimization error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});
};
