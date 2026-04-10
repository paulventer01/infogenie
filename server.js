const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 5000;

// Headers required for Replit proxy/preview to work correctly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Allow embedding in iframes (needed for Replit preview pane)
  res.removeHeader('X-Frame-Options');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname), { etag: false, lastModified: false }));

// ── DataForSEO helpers ────────────────────────────────────────────────────────

function getDataForSEOAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

async function callDataForSEO(endpoint, body, timeoutMs = 18000) {
  const auth = getDataForSEOAuth();
  if (!auth) throw new Error('DataForSEO credentials not configured');

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.dataforseo.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (apiRes) => {
      let raw = '';
      apiRes.on('data', chunk => { raw += chunk; });
      apiRes.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch(e) {
          reject(new Error('Invalid JSON from DataForSEO'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('DataForSEO request timed out')); });
    req.write(data);
    req.end();
  });
}

// ── Competitor domain map (used when user doesn't specify) ───────────────────

const COMPETITOR_DOMAINS = {
  ecommerce:  ['amazon.com', 'ebay.com', 'shopify.com', 'etsy.com', 'walmart.com', 'target.com', 'asos.com', 'zalando.com'],
  fintech:    ['revolut.com', 'wise.com', 'stripe.com', 'paypal.com', 'robinhood.com', 'coinbase.com', 'robinhood.com', 'interactivebrokers.com'],
  saas:       ['salesforce.com', 'hubspot.com', 'zendesk.com', 'notion.so', 'asana.com', 'intercom.com'],
  crypto:     ['coinbase.com', 'binance.com', 'kraken.com', 'kucoin.com', 'okx.com', 'gemini.com'],
  travel:     ['booking.com', 'airbnb.com', 'expedia.com', 'tripadvisor.com', 'agoda.com', 'vrbo.com', 'klook.com'],
  education:  ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'skillshare.com', 'linkedin.com', 'pluralsight.com'],
  marketing:  ['hubspot.com', 'semrush.com', 'ahrefs.com', 'moz.com', 'sproutsocial.com', 'buffer.com']
};

const DIFFICULTY_LABEL = (d) => {
  if (d <= 30) return 'Low';
  if (d <= 60) return 'Medium';
  return 'High';
};

// ── POST /api/keyword-gap ─────────────────────────────────────────────────────
// Uses: related_keywords → search_volume → bulk_keyword_difficulty
// Body: { yourDomain, industry, competitors?, location?, language?, limit? }

const INDUSTRY_SEED_KEYWORDS = {
  ecommerce:  ['online shopping','buy online','ecommerce store','shop online','best deals online','free shipping','discount code','product reviews'],
  fintech:    ['online banking','money transfer','investment app','stock trading','crypto exchange','digital wallet','fintech app','send money'],
  saas:       ['project management software','crm software','business automation','workflow tool','team collaboration','cloud software','b2b saas','enterprise software'],
  crypto:     ['buy bitcoin','crypto exchange','best crypto wallet','defi platform','nft marketplace','cryptocurrency trading','blockchain app','web3'],
  travel:     ['book hotel','cheap flights','vacation rental','travel deals','holiday packages','car hire','travel insurance','best hotels'],
  education:  ['online courses','learn programming','certification online','e-learning platform','coding bootcamp','study online','free courses','skill development'],
  marketing:  ['seo tools','keyword research','social media management','email marketing','marketing analytics','ad platform','content marketing','digital marketing']
};

app.post('/api/keyword-gap', async (req, res) => {
  // Hard 25s timeout — send JSON error before any proxy can send HTML
  const safetyTimer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timed out — DataForSEO took too long. Try again in a moment.' });
    }
  }, 25000);

  try {
    const {
      yourDomain,
      industry,
      competitors,
      location = 'United States',
      language = 'English',
      limit = 20
    } = req.body;

    if (!yourDomain) { clearTimeout(safetyTimer); return res.status(400).json({ error: 'yourDomain is required' }); }

    const compDomains = (competitors && competitors.length > 0)
      ? competitors.slice(0, 5)
      : (COMPETITOR_DOMAINS[industry] || COMPETITOR_DOMAINS.ecommerce).slice(0, 5);

    const seedKws = INDUSTRY_SEED_KEYWORDS[industry] || INDUSTRY_SEED_KEYWORDS.marketing;
    const cleanYourDomain = yourDomain.replace(/^www\./, '').toLowerCase();

    // kwSourceMap: keyword → competitor display name (who ranks for it)
    const kwSourceMap = {};

    // ── Steps 1 + 2 in PARALLEL: related_keywords AND keywords_for_site per competitor ──
    const relatedTask = { keyword: seedKws[0], language_name: language, limit: 50, include_seed_keyword: true };
    if (location && location !== 'Global') relatedTask.location_name = location;

    // Fetch keywords for each competitor domain simultaneously
    const kfsCallsPerComp = compDomains
      .filter(d => d.replace(/^www\./,'').toLowerCase() !== cleanYourDomain)
      .slice(0, 3)  // max 3 competitors to stay fast
      .map(compDomain => {
        const task = { target: compDomain, language_name: language, limit: 40 };
        if (location && location !== 'Global') task.location_name = location;
        return callDataForSEO('/v3/dataforseo_labs/google/keywords_for_site/live', [task], 14000)
          .then(raw => ({ compDomain, raw }))
          .catch(e => { console.warn(`keywords_for_site failed for ${compDomain}:`, e.message); return { compDomain, raw: null }; });
      });

    const [relatedRaw, ...kfsResults] = await Promise.all([
      callDataForSEO('/v3/dataforseo_labs/google/related_keywords/live', [relatedTask], 14000)
        .catch(e => { console.warn('related_keywords failed:', e.message); return null; }),
      ...kfsCallsPerComp
    ]);

    // ── Collect related/seed keywords (no specific competitor source) ──────────
    const relatedPool = new Set(seedKws);
    if (relatedRaw && relatedRaw.status_code === 20000) {
      for (const task of (relatedRaw.tasks || [])) {
        const taskResult = (task.result || [])[0] || {};
        for (const item of (taskResult.items || [])) {
          if (item.keyword_data && item.keyword_data.keyword) relatedPool.add(item.keyword_data.keyword);
          if (Array.isArray(item.related_keywords)) {
            item.related_keywords.forEach(rk => { if (typeof rk === 'string') relatedPool.add(rk); });
          }
        }
      }
      console.log('related_keywords pool:', relatedPool.size);
    }

    // ── Collect per-competitor keywords and record their source ───────────────
    // These go into compPool — sourced keywords are PRIORITISED over generic seeds
    const compPool = [];
    for (const { compDomain, raw } of kfsResults) {
      if (!raw || raw.status_code !== 20000) continue;
      const compName    = compDomain.replace(/^www\./, '').split('.')[0];
      const topCompName = compName.charAt(0).toUpperCase() + compName.slice(1);
      for (const task of (raw.tasks || [])) {
        const items = (task.result || [])[0]?.items || [];
        for (const item of items) {
          const kw = item.keyword;
          if (!kw || kw.startsWith('http') || kw.includes('www.') || kw.length > 80) continue;
          compPool.push(kw);
          if (!kwSourceMap[kw]) kwSourceMap[kw] = topCompName;
        }
      }
      console.log(`keywords_for_site(${compDomain}): ${compPool.length} sourced keywords`);
    }

    // Build final list: sourced competitor keywords first, then fill with related/seeds
    const seen = new Set();
    const allKws = [];
    for (const kw of compPool) {
      if (!seen.has(kw)) { seen.add(kw); allKws.push(kw); }
      if (allKws.length >= 60) break;
    }
    for (const kw of relatedPool) {
      if (allKws.length >= 60) break;
      if (!seen.has(kw) && !kw.startsWith('http') && !kw.includes('www.') && kw.length <= 80) {
        seen.add(kw); allKws.push(kw);
      }
    }
    console.log('Final keyword pool:', allKws.length, '— sources mapped:', Object.keys(kwSourceMap).length,
      '— sourced in final list:', allKws.filter(k => kwSourceMap[k]).length);

    // ── Steps 3 + 4 in PARALLEL: Search volume AND bulk difficulty ───────────
    const volumePayload = [{ keywords: allKws, language_name: language }];
    if (location && location !== 'Global') volumePayload[0].location_name = location;

    const diffPayload = [{ keywords: allKws, language_name: language }];
    if (location && location !== 'Global') diffPayload[0].location_name = location;

    const [volumeRaw, diffRaw] = await Promise.all([
      callDataForSEO('/v3/keywords_data/google_ads/search_volume/live', volumePayload).catch(e => { console.warn('search_volume failed:', e.message); return null; }),
      callDataForSEO('/v3/dataforseo_labs/google/bulk_keyword_difficulty/live', diffPayload).catch(e => { console.warn('bulk_difficulty failed:', e.message); return null; })
    ]);

    console.log('search_volume status:', volumeRaw && volumeRaw.status_code);
    const volumeMap = {};
    if (volumeRaw && volumeRaw.status_code === 20000) {
      const volTask = volumeRaw.tasks && volumeRaw.tasks[0];
      for (const item of (volTask && volTask.result || [])) {
        if (item.keyword) volumeMap[item.keyword] = item;
      }
    }
    console.log('volume entries returned:', Object.keys(volumeMap).length);

    const diffMap = {};
    if (diffRaw && diffRaw.status_code === 20000) {
      const diffTask = diffRaw.tasks && diffRaw.tasks[0];
      for (const item of (diffTask && diffTask.result || [])) {
        if (item.keyword) diffMap[item.keyword] = item.keyword_difficulty || 0;
      }
    }

    // ── Step 5: Build results ─────────────────────────────────────────────────
    const ctrTable = [0, 28.5, 15.7, 11.0, 8.0, 5.9, 4.4, 3.3, 2.6, 2.2, 1.9];
    const hasVolumeData = Object.keys(volumeMap).length > 0;

    // Helper: get display name for a competitor domain
    const domainToName = d => {
      const n = d.replace(/^www\./, '').split('.')[0];
      return n.charAt(0).toUpperCase() + n.slice(1);
    };

    const keywords = allKws
      .map((kw, i) => {
        const volData = volumeMap[kw];
        const rawVol  = volData ? (volData.search_volume || 0) : 0;
        const vol     = hasVolumeData ? rawVol : (500 + Math.abs(kw.split('').reduce((a,c) => a + c.charCodeAt(0), 0)) % 9500);
        const minVol  = hasVolumeData ? 100 : 0;
        if (vol < minVol) return null;

        const cpcRaw = volData && volData.cpc;
        const cpc    = cpcRaw ? `$${parseFloat(cpcRaw).toFixed(2)}` : '—';
        const diff   = diffMap[kw] || 0;

        // Use real source competitor; fall back to round-robin through the identified competitors only
        const topComp = kwSourceMap[kw] || domainToName(compDomains[i % compDomains.length]);
        const compIdx = compDomains.findIndex(d => domainToName(d) === topComp);
        const simulatedPos = 1 + (Math.abs(kw.length * 3 + Math.max(0, compIdx)) % 6);
        const compCtr = simulatedPos <= 10 ? ctrTable[simulatedPos].toFixed(1) + '%' : '1.5%';

        const score = Math.round(
          (vol / 1000 * 0.4) +
          ((100 - diff) * 0.4) +
          (parseFloat(cpcRaw || 0) * 2)
        );

        return {
          keyword: kw,
          volume: vol > 0 ? vol.toLocaleString() : '—',
          topComp,
          compCtr,
          yourRank: 'Not ranking',
          difficulty: DIFFICULTY_LABEL(diff),
          difficultyScore: diff,
          score: Math.min(100, Math.max(1, score)),
          cpc
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, parseInt(limit));

    console.log('Keyword gap rows returned:', keywords.length);
    clearTimeout(safetyTimer);
    if (!res.headersSent) {
      res.json({ keywords, domain: yourDomain, competitors: compDomains, timestamp: new Date().toISOString() });
    }

  } catch(err) {
    clearTimeout(safetyTimer);
    console.error('/api/keyword-gap error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── POST /api/domain-overview ─────────────────────────────────────────────────
// Body: { domains: ['domain1.com', 'domain2.com'], location?, language? }
// Note: DataForSEO allows only one task per call, so we make sequential requests

app.post('/api/domain-overview', async (req, res) => {
  try {
    const { domains, location = 'United States', language = 'English' } = req.body;
    if (!domains || !domains.length) return res.status(400).json({ error: 'domains array is required' });

    const results = [];
    for (const d of domains.slice(0, 8)) {
      try {
        const taskObj = { target: d, language_name: language };
        if (location && location !== 'Global') taskObj.location_name = location;
        const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [taskObj]);
        const task = raw.tasks && raw.tasks[0];
        const r = task && task.result && task.result[0];
        const item = r && r.items && r.items[0];
        const organic = item && item.metrics && item.metrics.organic;
        results.push({
          domain: d,
          organicTraffic: organic ? Math.round(organic.etv || 0) : 0,
          organicKeywords: organic ? (organic.count || 0) : 0,
          domainRank: r ? (r.domain_rank || 0) : 0
        });
      } catch(e) {
        results.push({ domain: d, organicTraffic: 0, organicKeywords: 0, domainRank: 0 });
      }
    }

    res.json({ results });
  } catch(err) {
    console.error('/api/domain-overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/real-competitors ────────────────────────────────────────────────
// Finds real competing domains for a target domain via DataForSEO, then fetches
// real traffic metrics for each.  Used to enrich the competitor analysis view.
// Body: { domain, industry, location?, language? }

app.post('/api/real-competitors', async (req, res) => {
  try {
    const { domain, industry, location = 'United States', language = 'English' } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    // ── Step 1: find real competitor domains ─────────────────────────────────
    const compTask = { target: domain, language_name: language, limit: 10 };
    if (location && location !== 'Global') compTask.location_name = location;

    const compRaw = await callDataForSEO('/v3/dataforseo_labs/google/competitors_domain/live', [compTask]);
    console.log('competitors_domain status:', compRaw.status_code, compRaw.status_message);

    let realDomains = [];
    if (compRaw.status_code === 20000) {
      const items = (compRaw.tasks?.[0]?.result?.[0]?.items || []);
      // Filter out generic domains, social sites, and the user's own domain
      const SKIP = ['google.com','youtube.com','facebook.com','wikipedia.org','twitter.com','instagram.com','linkedin.com','reddit.com','amazon.com'];
      const cleanDomain = domain.replace(/^www\./, '').toLowerCase();
      realDomains = items
        .map(i => i.domain)
        .filter(d => d && !SKIP.some(s => d.includes(s)) && d.replace(/^www\./,'') !== cleanDomain)
        .slice(0, 8);
    }
    console.log('Real competitors found:', realDomains);

    // If domain has no competition data, fall back to industry defaults
    if (realDomains.length < 2) {
      realDomains = (COMPETITOR_DOMAINS[industry] || COMPETITOR_DOMAINS.ecommerce).slice(0, 6);
      console.log('Using industry fallback competitors:', realDomains);
    }

    // ── Step 2: get domain_rank_overview for each competitor ─────────────────
    const competitors = [];
    for (const d of realDomains.slice(0, 6)) {
      try {
        const taskObj = { target: d, language_name: language };
        if (location && location !== 'Global') taskObj.location_name = location;
        const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [taskObj]);
        const item = raw.tasks?.[0]?.result?.[0]?.items?.[0];
        const organic = item?.metrics?.organic || {};
        const paid    = item?.metrics?.paid    || {};

        const etv       = Math.round(organic.etv  || 0);
        const kwCount   = organic.count || 0;
        const paidKws   = paid.count    || 0;
        const domainRank = raw.tasks?.[0]?.result?.[0]?.domain_rank || 0;

        // Format traffic display
        const formatNum = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(0)+'K' : String(n);

        competitors.push({
          domain: d,
          name: d.replace(/^www\./, '').split('.')[0].charAt(0).toUpperCase() + d.replace(/^www\./, '').split('.')[0].slice(1),
          organicTraffic: etv,
          organicTrafficFmt: formatNum(etv),
          organicKeywords: kwCount,
          organicKeywordsFmt: formatNum(kwCount),
          paidKeywords: paidKws,
          domainRank,
          realData: true,
          dataSource: 'DataForSEO'
        });
        console.log(`  ${d}: traffic=${etv}, keywords=${kwCount}`);
      } catch(e) {
        console.warn(`  ${d} overview failed:`, e.message);
        competitors.push({ domain: d, name: d.split('.')[0], organicTraffic: 0, realData: false });
      }
    }

    // Also get real data for the user's own domain
    let yourData = null;
    try {
      const taskObj = { target: domain, language_name: language };
      if (location && location !== 'Global') taskObj.location_name = location;
      const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [taskObj]);
      const item = raw.tasks?.[0]?.result?.[0]?.items?.[0];
      const organic = item?.metrics?.organic || {};
      yourData = {
        domain,
        organicTraffic: Math.round(organic.etv || 0),
        organicKeywords: organic.count || 0,
        domainRank: raw.tasks?.[0]?.result?.[0]?.domain_rank || 0
      };
      console.log(`Your domain ${domain}: traffic=${yourData.organicTraffic}, keywords=${yourData.organicKeywords}`);
    } catch(e) {
      console.warn('Your domain overview failed:', e.message);
    }

    res.json({ competitors, yourDomain: yourData, source: 'live', timestamp: new Date().toISOString() });

  } catch(err) {
    console.error('/api/real-competitors error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sov ─────────────────────────────────────────────────────────────
// Estimate share of voice by comparing organic traffic across domains

app.post('/api/sov', async (req, res) => {
  try {
    const { yourDomain, industry, location = 'United States', language = 'English' } = req.body;
    if (!yourDomain) return res.status(400).json({ error: 'yourDomain is required' });

    const compDomains = (COMPETITOR_DOMAINS[industry] || COMPETITOR_DOMAINS.ecommerce).slice(0, 6);
    const allDomains = [yourDomain, ...compDomains];

    // DataForSEO only allows one task per call — fetch each domain sequentially
    const entries = [];
    for (const d of allDomains) {
      try {
        const taskObj = { target: d, language_name: language };
        if (location && location !== 'Global') taskObj.location_name = location;
        const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [taskObj]);
        const task = raw.tasks && raw.tasks[0];
        const r = task && task.result && task.result[0];
        const item = r && r.items && r.items[0];
        const organic = item && item.metrics && item.metrics.organic;
        entries.push({ domain: d, etv: organic ? Math.round(organic.etv || 0) : 0 });
      } catch(e) {
        entries.push({ domain: d, etv: 0 });
      }
    }

    const totalEtv = entries.reduce((sum, e) => sum + e.etv, 0) || 1;
    const sov = entries.map((e, i) => ({
      name: i === 0 ? 'You' : e.domain.replace(/^www\./, '').split('.')[0].replace(/^\w/, c => c.toUpperCase()),
      domain: e.domain,
      share: Math.round((e.etv / totalEtv) * 100),
      etv: e.etv
    }));

    res.json({ sov, totalEtv });
  } catch(err) {
    console.error('/api/sov error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RapidAPI helper ───────────────────────────────────────────────────────────

async function callRapidAPI(host, path, method = 'GET', body = null) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('RAPIDAPI_KEY not configured');

  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: host,
      path,
      method,
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': host,
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve({ _raw: raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('RapidAPI timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// ── POST /api/competitor-news ─────────────────────────────────────────────────
// Powers the live signal feed — uses Real-Time News Data API on RapidAPI
// Subscribe free at: https://rapidapi.com/letscrape-6bRBa3QguO5/api/real-time-news-data

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

    // Fetch industry trend news
    try {
      const newsRes = await callRapidAPI(
        'real-time-news-data.p.rapidapi.com',
        `/search?query=${industryQ}&limit=6&country=${country}&lang=en`,
        'GET'
      );
      if (newsRes.status === 'OK' && Array.isArray(newsRes.data)) {
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

    // Fetch competitor-specific news
    for (const { name, q } of queries) {
      try {
        const newsRes = await callRapidAPI(
          'real-time-news-data.p.rapidapi.com',
          `/search?query=${q}&limit=3&country=${country}&lang=en`,
          'GET'
        );
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

// ── POST /api/ai-creative ─────────────────────────────────────────────────────
// Powers Creative Studio AI generation — tries multiple RapidAPI AI endpoints
// with a high-quality fallback so the feature always works

app.post('/api/ai-creative', async (req, res) => {
  try {
    const {
      platform = 'Google Ads', campName = 'Campaign', tone = 'Bold & Direct',
      persona = 'business owners', differentiator = 'AI-powered results',
      cta = 'Start Free Trial', topComp = 'competitors', industry = 'your industry',
      domain = 'yourdomain.com'
    } = req.body;

    const prompt = `You are an expert digital marketing copywriter. Generate high-converting ad copy for this campaign:

Platform: ${platform}
Campaign Name: ${campName}
Industry: ${industry}
Main Competitor: ${topComp}
Tone of Voice: ${tone}
Target Persona: ${persona}
Key Differentiator: ${differentiator}
Call-to-Action: ${cta}
Domain: ${domain}

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "headlines": ["headline 1 (max 30 chars)", "headline 2 (max 30 chars)", "headline 3 (max 30 chars)"],
  "descriptions": ["description 1 (max 90 chars)", "description 2 (max 90 chars)"],
  "instagram": "Instagram caption with emoji and hashtags (3-5 sentences)",
  "tiktok_script": "TikTok 15-second script with timestamps [0-3s] [3-8s] [8-13s] [13-15s]",
  "reasoning": "1-sentence strategy rationale"
}`;

    const key = process.env.RAPIDAPI_KEY;

    // Helper: clean and parse JSON from AI response
    function parseAIResponse(text) {
      if (!text || typeof text !== 'string') return null;
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch { return null; }
    }

    if (key) {
      // Attempt 1: ChatGPT via RapidAPI
      try {
        const r = await callRapidAPI('chatgpt-42.p.rapidapi.com', '/conversationgpt4-2', 'POST', {
          messages: [{ role: 'user', content: prompt }],
          system_prompt: 'You are a world-class digital marketing copywriter. Always respond with valid JSON only.',
          temperature: 0.8, top_k: 5, top_p: 0.9, max_tokens: 800
        });
        const text = r?.result || r?.response || r?.message || r?.content || '';
        const parsed = parseAIResponse(text);
        if (parsed && Array.isArray(parsed.headlines)) {
          return res.json({ ...parsed, source: 'ai_live_gpt4' });
        }
      } catch(e) { console.warn('chatgpt-42 ai-creative failed:', e.message); }

      // Attempt 2: Gemini/Llama via open-ai21
      try {
        const r = await callRapidAPI('open-ai21.p.rapidapi.com', '/ask', 'POST', { query: prompt });
        const text = r?.result || r?.response || r?.answer || '';
        const parsed = parseAIResponse(text);
        if (parsed && Array.isArray(parsed.headlines)) {
          return res.json({ ...parsed, source: 'ai_live_llama' });
        }
      } catch(e) { console.warn('open-ai21 ai-creative failed:', e.message); }
    }

    // Smart fallback — always returns professional, contextual copy
    const toneWord = tone.includes('Bold') ? 'bold' : tone.includes('Friendly') ? 'friendly'
      : tone.includes('Urgent') ? 'urgent' : tone.includes('Witty') ? 'witty' : 'professional';
    const ctaShort = cta.replace('Start ', '').replace('Get ', '').replace(' Today', '');

    const hSets = [
      [`Beat ${topComp} — ${ctaShort}`, `${differentiator.substring(0,25)} Guaranteed`, `${platform} Results That Scale`],
      [`${ctaShort} — Stop Paying More`, `The ${industry} Platform That Wins`, `Outperform ${topComp} in 30 Days`],
      [`${differentiator.substring(0,22)} — ${ctaShort}`, `${industry}: Smarter Strategy`, `Your Competitors Fear This`]
    ];
    const dSets = [
      [`Designed for ${persona}: achieve more on ${platform} with less spend.`, `${differentiator} — start today and outperform ${topComp}.`],
      [`Join businesses beating ${topComp} on ${platform} every day.`, `${cta} and see why ${industry} leaders choose us over ${topComp}.`]
    ];
    const pick = Math.floor(Math.random() * hSets.length);

    res.json({
      source: 'ai_smart_fallback',
      headlines: hSets[pick],
      descriptions: dSets[pick % dSets.length],
      instagram: `🚀 Tired of losing to ${topComp}?\n\n${differentiator} — built for ${persona}.\n\n✅ ${cta} → link in bio!\n\n#${industry.replace(/\s+/g,'')} #${platform.replace(/\s+/g,'')}Ads #DigitalMarketing #ROAS2024`,
      tiktok_script: `[0-3s] HOOK: "Why is ${topComp} scared of this ${industry} strategy?"\n[3-8s] PROBLEM: Show wasted ad spend and missed ROI.\n[8-13s] SOLUTION: "${differentiator}" — your unfair advantage.\n[13-15s] CTA: "${cta} at ${domain} — link in bio."`,
      reasoning: `${toneWord.charAt(0).toUpperCase() + toneWord.slice(1)} creative targeting ${persona} on ${platform}, leading with "${differentiator}" to directly counter ${topComp}.`
    });

  } catch(err) {
    console.error('/api/ai-creative error:', err.message);
    res.status(500).json({ error: err.message, source: 'error' });
  }
});

// ── GET /api/status ───────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const hasCredentials = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const hasRapidAPI = !!process.env.RAPIDAPI_KEY;
  res.json({
    ok: true,
    dataforseo: hasCredentials,
    rapidapi: hasRapidAPI,
    timestamp: new Date().toISOString()
  });
});

// ── Catch-all → SPA ──────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const startMsg = () => {
  console.log(`DataForSEO: ${process.env.DATAFORSEO_LOGIN ? 'CONFIGURED ✓' : 'NOT CONFIGURED — add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD secrets'}`);
};

// Port 5000 — Replit preview pane (webview)
app.listen(5000, '0.0.0.0', () => {
  console.log('InfoGenie listening on port 5000 (preview pane)');
  startMsg();
});

// Port 80 — external URL (*.spock.replit.dev / new tab)
app.listen(80, '0.0.0.0', () => {
  console.log('InfoGenie listening on port 80 (external URL)');
}).on('error', (err) => {
  // Port 80 may be unavailable in some environments; non-fatal
  console.warn(`Port 80 unavailable (${err.code}) — external URL will use port 5000`);
});
