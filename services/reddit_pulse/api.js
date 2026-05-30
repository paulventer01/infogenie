const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[reddit-pulse]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _redditSearch(subreddit, query, limit) {
  return new Promise(resolve => {
    const sub = String(subreddit || 'all').replace(/[^a-z0-9_]/gi,'').slice(0,50) || 'all';
    const restrict = (sub.toLowerCase() === 'all') ? '' : '&restrict_sr=1';
    const path = `/r/${sub}/search.json?q=${encodeURIComponent(query)}${restrict}&sort=new&limit=${limit}&t=week`;
    const req = _https.request({ hostname:'www.reddit.com', path, method:'GET', headers:{ 'User-Agent':'InfoGenie/1.0 (Marketing intelligence; +https://infogenie.app)' } }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const posts = (j?.data?.children || []).map(c => ({
            id: c.data?.id, title: String(c.data?.title || '').slice(0, 300),
            author: c.data?.author, subreddit: c.data?.subreddit,
            url: c.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : null,
            upvotes: c.data?.ups || 0, comments: c.data?.num_comments || 0,
            created: c.data?.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : null,
            selftext: String(c.data?.selftext || '').slice(0, 400)
          }));
          resolve(posts);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

async function _classifySentiment(posts) {
  if (!_hasOpenAI() || !posts.length) return posts.map(p => ({ ...p, sentiment: 'neutral' }));
  const sample = posts.slice(0, 30).map((p, i) => `${i}. ${p.title}${p.selftext ? ' — ' + p.selftext.slice(0, 120) : ''}`).join('\n');
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-4o-mini', temperature:0.1, max_tokens:1000,
      response_format: { type:'json_object' },
      messages:[
        { role:'system', content:'Classify each Reddit post sentiment about the target brand as "positive", "neutral", or "negative". Reply strict JSON only: {"sentiments":["positive","neutral",...]} — array length must equal input count.' },
        { role:'user', content:`Posts:\n${sample}` }
      ]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content;
          const parsed = JSON.parse(txt);
          const arr = parsed.sentiments || [];
          resolve(posts.map((p, i) => ({ ...p, sentiment: arr[i] || 'neutral' })));
        } catch { resolve(posts.map(p => ({ ...p, sentiment: 'neutral' }))); }
      });
    });
    req.on('error', () => resolve(posts.map(p => ({ ...p, sentiment: 'neutral' }))));
    req.setTimeout(20000, () => { req.destroy(); resolve(posts.map(p => ({ ...p, sentiment: 'neutral' }))); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI(), db: _db.hasDb && _db.hasDb() }));

router.post('/scan', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const subreddits = Array.isArray(req.body?.subreddits) ? req.body.subreddits.slice(0, 10) : ['all'];
  const keywords = Array.isArray(req.body?.keywords) && req.body.keywords.length ? req.body.keywords.slice(0, 5) : [brand];
  if (!brand) return _err(res, 400, 'brand required');
  const perSub = Math.max(5, Math.min(25, parseInt(req.body?.limit || 15, 10)));

  const all = [];
  for (const sub of subreddits) {
    for (const kw of keywords) {
      const posts = await _redditSearch(sub, kw, perSub);
      for (const p of posts) if (!all.find(x => x.id === p.id)) all.push(p);
    }
  }
  const classified = await _classifySentiment(all);
  const counts = { pos: classified.filter(p => p.sentiment === 'positive').length, neu: classified.filter(p => p.sentiment === 'neutral').length, neg: classified.filter(p => p.sentiment === 'negative').length };

  if (_db.hasDb && _db.hasDb()) {
    try { await _db.getPool().query('INSERT INTO reddit_pulse_runs (brand, subreddits, keywords, total_posts, pos_count, neu_count, neg_count, posts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [brand, JSON.stringify(subreddits), JSON.stringify(keywords), classified.length, counts.pos, counts.neu, counts.neg, JSON.stringify(classified.slice(0, 100))]); } catch(_) {}
  }
  res.json({ ok:true, brand, total: classified.length, counts, posts: classified });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'reddit_pulse:runs' });
  const r = await _db.getPool().query('SELECT id, brand, subreddits, keywords, total_posts, pos_count, neu_count, neg_count, created_at FROM reddit_pulse_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

// ── Discover Questions Customers Are Asking ─────────────────────────────────
// Pairs with T38 Carousel Generator: "I sell X — what are people asking
// about X on Reddit right now?" Pure Reddit search, no LLM dependency.
router.post('/discover-questions', _safeAsync(async (req, res) => {
  const businessType = String(req.body?.businessType || '').trim().slice(0, 120);
  if (!businessType) return _err(res, 400, 'businessType is required');
  const subs = (Array.isArray(req.body?.subreddits) && req.body.subreddits.length)
    ? req.body.subreddits.map(s => String(s).slice(0, 50)).slice(0, 6)
    : ['all'];

  const queryVariants = [`${businessType}?`, `how to ${businessType}`, `best ${businessType}`, `${businessType} help`];
  const collected = new Map();
  for (const sub of subs) {
    for (const q of queryVariants) {
      const posts = await _redditSearch(sub, q, 25);
      for (const p of posts) {
        const t = (p.title || '').trim();
        if (!t || t.length < 8) continue;
        // keep only posts that look like a question
        const isQuestion = /\?$/.test(t) || /^(how|why|what|when|where|which|who|is|are|do|does|should|can|could|would|will|anyone|has anyone)\b/i.test(t);
        if (!isQuestion) continue;
        if (!collected.has(p.id)) collected.set(p.id, p);
      }
    }
  }
  let all = Array.from(collected.values());

  // Fallback: Reddit blocks many cloud IPs. If direct search returns nothing,
  // ask Perplexity (sonar) for the same questions — it can read Reddit.
  let source = 'reddit-direct';
  if (all.length === 0 && process.env.PERPLEXITY_API_KEY && !/^_DUMMY/i.test(process.env.PERPLEXITY_API_KEY)) {
    try {
      const fromPplx = await _pplxQuestions(businessType);
      if (fromPplx.length) { all = fromPplx; source = 'perplexity'; }
    } catch (e) { console.warn('[reddit-pulse] perplexity fallback failed:', e.message); }
  }

  // Score by upvotes + comments to surface signal
  all.sort((a, b) => ((b.upvotes||0) + (b.comments||0)*2) - ((a.upvotes||0) + (a.comments||0)*2));
  const top = all.slice(0, 30).map(p => ({
    title: p.title, subreddit: p.subreddit, url: p.url,
    upvotes: p.upvotes, comments: p.comments, created: p.created,
  }));
  res.json({ ok: true, businessType, total: all.length, source, questions: top });
}));

function _pplxQuestions(businessType) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'You search Reddit and return real question-style posts. Reply ONLY with valid JSON in shape {"questions":[{"title":"...","subreddit":"...","url":"https://reddit.com/...","upvotes":0,"comments":0}]}. Find 15-25 real Reddit posts where users are asking questions about the topic. Use real urls.' },
        { role: 'user', content: `Find Reddit questions people are asking about: ${businessType}` },
      ],
      response_format: { type: 'json_schema', json_schema: { schema: { type:'object', properties:{ questions:{ type:'array', items:{ type:'object', properties:{ title:{type:'string'}, subreddit:{type:'string'}, url:{type:'string'}, upvotes:{type:'number'}, comments:{type:'number'} }, required:['title'] } } }, required:['questions'] } } },
      temperature: 0.2,
    });
    const req = _https.request({
      hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.PERPLEXITY_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          const parsed = JSON.parse(txt);
          const out = (parsed.questions || []).map((q, i) => ({
            id: 'pplx_' + i,
            title: String(q.title || '').slice(0, 300),
            subreddit: String(q.subreddit || '').replace(/^r\//, '').slice(0, 50),
            url: typeof q.url === 'string' && /^https:\/\/(www\.|old\.)?reddit\.com\//.test(q.url) ? q.url : null,
            upvotes: Number(q.upvotes) || 0,
            comments: Number(q.comments) || 0,
            created: null,
          })).filter(q => q.title);
          resolve(out);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('perplexity timeout')); });
    req.write(body); req.end();
  });
}

// ── POST /api/reddit-pulse/generate-reply ────────────────────────────────────
// body: { postTitle, postText, brand, tone:'engaging'|'direct'|'balanced', brandContext? }
// Returns a brand-aware reply in the chosen tone.
router.post('/generate-reply', _safeAsync(async (req, res) => {
  const { postTitle, postText, brand, tone, brandContext } = req.body || {};
  if (!postTitle) return _err(res, 400, 'postTitle is required');
  if (!brand)     return _err(res, 400, 'brand is required');
  if (!_hasOpenAI()) return _err(res, 503, 'OpenAI not configured');

  const safePost  = String(postTitle).trim().slice(0, 300);
  const safeBody  = String(postText  || '').trim().slice(0, 500);
  const safeBrand = String(brand).trim().slice(0, 80);
  const safeTone  = ['engaging', 'direct', 'balanced'].includes(tone) ? tone : 'balanced';
  const safeCtx   = String(brandContext || '').trim().slice(0, 400);

  const toneGuide = {
    engaging:  'Conversational and warm — use questions to invite dialogue, show genuine curiosity, humanise the brand, add one relatable anecdote or insight. Do NOT be salesy.',
    direct:    'Brief, confident, and to the point — answer the core question in the first sentence, use short paragraphs, no fluff. Mention the brand only if directly relevant.',
    balanced:  'Helpful and professional — give real value first, acknowledge the original poster\'s situation, then naturally weave in the brand\'s perspective once at most.',
  };

  const systemPrompt = `You are a community manager for the brand "${safeBrand}". Write Reddit replies that feel authentic, helpful, and human — never like advertising. Obey the tone instruction strictly. Return ONLY valid JSON: {"reply":"..."}`;
  const userPrompt = [
    `Reddit post title: "${safePost}"`,
    safeBody ? `Post content: "${safeBody}"` : '',
    safeTone ? `Tone: ${safeTone} — ${toneGuide[safeTone]}` : '',
    safeCtx  ? `Brand context: ${safeCtx}` : '',
    '',
    'Write a Reddit reply (3-6 sentences) that is genuinely helpful to the poster. Mention the brand at most once, only if natural.',
  ].filter(Boolean).join('\n');

  const bodyStr = JSON.stringify({
    model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
  });

  await new Promise(resolve => {
    const apiReq = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content;
          const parsed = JSON.parse(txt);
          res.json({ ok: true, reply: parsed.reply || '', tone: safeTone });
        } catch { _err(res, 500, 'Failed to parse AI response'); }
        resolve();
      });
    });
    apiReq.on('error', e => { _err(res, 500, e.message); resolve(); });
    apiReq.setTimeout(30000, () => { apiReq.destroy(); _err(res, 504, 'OpenAI timeout'); resolve(); });
    apiReq.write(bodyStr); apiReq.end();
  });
}));

module.exports = router;
