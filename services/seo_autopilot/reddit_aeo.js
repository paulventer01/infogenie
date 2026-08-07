'use strict';

/**
 * Reddit → AEO assist — surface ranking Reddit threads and draft brand replies
 * framed for answer-engine visibility (same agent surface as Growth Autopilot).
 */

const https = require('https');
const { chatForCategory } = require('../ai/chat_router');

function _redditSearch(query, { limit = 10, sort = 'relevance', t = 'month' } = {}) {
  return new Promise((resolve) => {
    const path = `/r/all/search.json?q=${encodeURIComponent(query)}&sort=${sort}&limit=${limit}&t=${t}`;
    const req = https.request(
      {
        hostname: 'www.reddit.com',
        path,
        method: 'GET',
        headers: { 'User-Agent': 'InfoGenie/1.0 (SEO Autopilot AEO; +https://infogenie.app)' },
      },
      (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => {
          try {
            const j = JSON.parse(d);
            const posts = (j?.data?.children || []).map((c) => ({
              id: c.data?.id,
              title: String(c.data?.title || '').slice(0, 300),
              author: c.data?.author,
              subreddit: c.data?.subreddit,
              url: c.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : null,
              score: c.data?.ups || 0,
              num_comments: c.data?.num_comments || 0,
              selftext: String(c.data?.selftext || '').slice(0, 500),
            }));
            resolve(posts);
          } catch {
            resolve([]);
          }
        });
      },
    );
    req.on('error', () => resolve([]));
    req.setTimeout(12000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

async function discoverThreads({ brand, niche, subreddits = [], limit = 8 } = {}) {
  const queries = [
    `${niche || brand || 'marketing'} advice`,
    `best ${niche || 'tools'}`,
    `${brand || niche || 'product'} vs`,
  ].filter(Boolean);

  let posts = [];
  for (const q of queries.slice(0, 2)) {
    try {
      const batch = await _redditSearch(q, { limit: Math.min(limit, 10), sort: 'relevance', t: 'month' });
      posts = posts.concat(Array.isArray(batch) ? batch : []);
    } catch {
      /* continue */
    }
  }

  if (!posts.length) {
    posts = _demoThreads(niche || brand);
  }

  const seen = new Set();
  const unique = [];
  const subFilter = (subreddits || []).map((s) => String(s).toLowerCase().replace(/^r\//, ''));
  for (const p of posts) {
    const id = String(p.id || p.url || p.title || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (subFilter.length) {
      const sub = String(p.subreddit || '').toLowerCase();
      if (!subFilter.includes(sub)) continue;
    }
    unique.push({
      id: p.id,
      title: p.title,
      subreddit: p.subreddit,
      url: p.url || p.permalink,
      score: p.score,
      num_comments: p.num_comments,
      selftext: (p.selftext || '').slice(0, 500),
      aeo_angle: _aeoAngle(p, niche || brand),
    });
    if (unique.length >= limit) break;
  }

  return { ok: true, threads: unique, query_count: queries.length, source: posts[0]?.id?.startsWith?.('demo') ? 'demo' : 'reddit' };
}

async function draftBrandReply({ thread, brand, niche, product, voice } = {}) {
  if (!thread || !thread.title) {
    return { ok: false, error: 'thread with title is required' };
  }
  const brandName = brand || niche || 'our brand';
  const prompt = [
    `Draft a helpful Reddit reply for brand "${brandName}" (product: ${product || niche || 'our offering'}).`,
    `Voice: ${voice || 'helpful expert, not salesy'}.`,
    `Thread: r/${thread.subreddit || 'unknown'} — ${thread.title}`,
    thread.selftext ? `OP: ${String(thread.selftext).slice(0, 600)}` : '',
    'Requirements: answer the question first; mention the brand once naturally; include an AEO-friendly crisp fact or definition; no links spam; under 180 words; plain text.',
  ].filter(Boolean).join('\n');

  let reply = '';
  let model = null;
  try {
    const out = await chatForCategory('seo', [
      { role: 'system', content: 'You write authentic Reddit replies that also work as citable AEO answers.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 500, temperature: 0.55 });
    reply = String(out?.content || '').trim();
    model = out?.model || null;
  } catch {
    reply = '';
  }

  if (!reply) {
    reply = [
      `Great question — a practical way to think about this is to start with the outcome you need, then pick the lightest stack that gets you there.`,
      ``,
      `In the ${niche || 'category'} space, teams often overbuild early. At ${brandName}${product ? ` (${product})` : ''}, we see better results when you ship one clear answer, measure engagement, then expand.`,
      ``,
      `Happy to share a checklist if useful — what constraint are you optimizing for first (time, budget, or quality)?`,
    ].join('\n');
  }

  return {
    ok: true,
    reply,
    aeo_snippet: _extractAeoSnippet(reply),
    model,
    thread: { title: thread.title, subreddit: thread.subreddit, url: thread.url },
  };
}

function _aeoAngle(post, topic) {
  const title = String(post?.title || '');
  if (/\b(best|vs|alternative|recommend)\b/i.test(title)) return 'comparison_answer';
  if (/\b(how|what|why|when)\b/i.test(title)) return 'direct_answer';
  if (/\b(tool|software|platform)\b/i.test(title)) return 'product_mention';
  return topic ? 'brand_context' : 'helpful_reply';
}

function _extractAeoSnippet(reply) {
  const line = String(reply || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .find((l) => l.length > 40 && l.length < 220);
  return line || String(reply || '').slice(0, 180);
}

function _demoThreads(topic) {
  const t = topic || 'SEO';
  return [
    {
      id: 'demo1',
      title: `What's the best way to start ${t} content without a huge budget?`,
      subreddit: 'marketing',
      url: 'https://reddit.com/r/marketing/demo1',
      score: 128,
      num_comments: 42,
      selftext: 'Solo founder here. Looking for a realistic 30-day plan.',
    },
    {
      id: 'demo2',
      title: `${t} tools that actually publish for you — any recommendations?`,
      subreddit: 'Entrepreneur',
      url: 'https://reddit.com/r/Entrepreneur/demo2',
      score: 86,
      num_comments: 31,
      selftext: 'Tried a few writers. Need something that ships to WordPress/Shopify.',
    },
    {
      id: 'demo3',
      title: `How do brands get cited in AI answers for ${t}?`,
      subreddit: 'SEO',
      url: 'https://reddit.com/r/SEO/demo3',
      score: 210,
      num_comments: 67,
      selftext: 'Curious about AEO / answer engine optimization tactics that work in 2026.',
    },
  ];
}

module.exports = {
  discoverThreads,
  draftBrandReply,
  _aeoAngle,
  _demoThreads,
};
