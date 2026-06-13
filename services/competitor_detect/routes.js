// DB status · smart-detect · sector competitors routes.
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

// Firecrawl fallback for bot-protected sites (Cloudflare, WAF, etc.).
// Called only when direct fetch returns empty — costs one API credit per call.
async function _firecrawlFetch(url, timeoutMs = 14000) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['html', 'markdown'], onlyMainContent: false }),
    });
    clearTimeout(t);
    if (!r.ok) return '';
    const j = await r.json();
    const content = (j.data || j);
    return String(content.html || content.markdown || '').slice(0, 120000);
  } catch (e) { return ''; }
}

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { INFO_SITE_PATTERN, _db, callDataForSEO, openai, openaiChatWithRetry, startMsg } = ctx;

app.get('/api/db/status', async (_req, res) => {
  try {
    if (!_db.hasDb()) return res.json({ ok:true, mode:'file', configured:false });
    await _db.ensureSchema(); // guard against race with boot initializer
    const r = await _db.getPool().query('SELECT count(*)::int AS n FROM kv_store');
    res.json({ ok:true, mode:'postgres', configured:true, kvRows: r.rows[0].n });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// Express preview listen. Defaults to 5000 (Replit webview) for production
// `node server.js`. In dev, scripts/dev.js sets EXPRESS_PORT=8000 so Next.js
// can own 5000 as the front door and proxy /api/* + the SPA back to Express.
const __EXPRESS_PORT = Number(process.env.EXPRESS_PORT) || 5000;
app.listen(__EXPRESS_PORT, '0.0.0.0', () => {
  console.log(`InfoGenie listening on port ${__EXPRESS_PORT} (preview pane)`);
  startMsg();
});

// ── POST /api/smart-detect ────────────────────────────────────────────────────
// Scrapes the user's website and uses AI to detect industry + real competitors.
app.post('/api/smart-detect', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string' || url.trim().length < 3) {
      return res.status(400).json({ error: 'Valid url required' });
    }
    const cleanInput = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
    const fetchUrl = 'https://' + cleanInput;

    // ── 1) Deep-scrape: homepage + likely "about/products/services" pages ────
    const fetchPage = async (u, ms = 7000) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        const r = await fetch(u, {
          signal: ctrl.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InfoGenieBot/1.0; +https://infogenie.ai/bot)',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });
        clearTimeout(t);
        if (!r.ok) return '';
        return (await r.text()).slice(0, 120000);
      } catch (e) { return ''; }
    };

    let html = await fetchPage(fetchUrl, 8000);
    // If direct fetch was blocked (Cloudflare / WAF), try Firecrawl for the homepage.
    if (!html) html = await _firecrawlFetch(fetchUrl, 14000);
    const subPaths = ['/about', '/about-us', '/products', '/services', '/solutions', '/what-we-do', '/company'];
    const subHtmls = await Promise.all(subPaths.map(p => fetchPage(fetchUrl + p, 5000)));
    const allHtml = [html, ...subHtmls].join('\n');

    // ── 2) Extract signals from combined HTML ────────────────────────────────
    const pick = (re, src = html) => { const m = src.match(re); return m ? m[1].trim() : ''; };
    const title       = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc    = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const ogTitle     = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogDesc      = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const ogSiteName  = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    const keywords    = pick(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
    const h1s = (allHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [])
      .slice(0, 6).map(s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const h2s = (allHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [])
      .slice(0, 12).map(s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const bodyText = allHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().slice(0, 6000);

    // ── 2b) Real organic competitors via DataForSEO (keyword-overlap based) ──
    let dfsCompetitors = [];
    if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
      try {
        const compRaw = await callDataForSEO(
          '/v3/dataforseo_labs/google/competitors_domain/live',
          [{ target: cleanInput, language_name: 'English', limit: 15 }],
          12000
        );
        if (compRaw.status_code === 20000) {
          const items = compRaw.tasks?.[0]?.result?.[0]?.items || [];
          const SKIP = ['google.com','youtube.com','facebook.com','wikipedia.org','twitter.com','x.com','instagram.com','linkedin.com','reddit.com','amazon.com','pinterest.com','tiktok.com','quora.com','medium.com','forbes.com','bloomberg.com'];
          dfsCompetitors = items
            .map(i => i.domain)
            .filter(d => d && !SKIP.some(s => d.includes(s)) && d.replace(/^www\./,'') !== cleanInput)
            .slice(0, 15);
          console.log(`[smart-detect] DataForSEO real competitors for ${cleanInput}:`, dfsCompetitors);
        }
      } catch (e) { console.warn('[smart-detect] DataForSEO competitors_domain failed:', e.message); }
    }

    const signals = {
      domain: cleanInput,
      title, metaDesc, ogTitle, ogDesc, ogSiteName, keywords,
      h1: h1s, h2: h2s,
      sample: bodyText,
      dfsCompetitors,
    };

    // ── 3) Ask OpenAI to classify + suggest real competitors ─────────────────
    const allowedKeys = ['ecommerce','fintech','saas','crypto','travel','education','marketing'];
    const dfsList = dfsCompetitors.length
      ? `\nREAL ORGANIC COMPETITORS (from live SERP keyword-overlap data — these domains rank for the SAME search terms as the target, so they are highly likely true competitors):\n${dfsCompetitors.map((d,i)=>`${i+1}. ${d}`).join('\n')}\n`
      : '';
    const prompt = `You are a senior market-research analyst. Below is rich metadata scraped from a real website (homepage + about/products/services pages combined), plus a list of real domains that compete on the same search keywords. Identify exactly what the business does and return the most accurate competitor list possible.

DOMAIN: ${cleanInput}
TITLE: ${title || '(none)'}
META DESCRIPTION: ${metaDesc || '(none)'}
OG TITLE: ${ogTitle || '(none)'}
OG DESCRIPTION: ${ogDesc || '(none)'}
OG SITE NAME: ${ogSiteName || '(none)'}
KEYWORDS META: ${keywords || '(none)'}
H1 HEADINGS: ${h1s.join(' | ') || '(none)'}
H2 HEADINGS: ${h2s.join(' | ') || '(none)'}
BODY EXCERPT (combined from homepage + about/products/services pages):
${bodyText || '(could not fetch)'}
${dfsList}
TASK — return ONLY valid JSON, no markdown, no commentary:
{
  "industryName": "<specific human-readable industry/sub-niche, e.g. 'Online CFD Trading Broker' or 'Pet Insurance' or 'B2B SaaS — Project Management'>",
  "industryKey": "<one of: ${allowedKeys.join(', ')} — pick the closest fit>",
  "businessSummary": "<one sentence describing what this company actually does>",
  "subNiche": "<2-4 word sub-niche, e.g. 'CFD trading platform'>",
  "country": "<inferred primary market country code if obvious, else null>",
  "competitors": [
    { "name": "<real company name>", "url": "<real domain like example.com>", "why": "<1 sentence why they directly compete>" }
  ]
}

CRITICAL RULES for "competitors" — accuracy matters more than completeness:
- Return EXACTLY 8 competitors (never fewer than 6, never more than 10).
- Every competitor MUST operate in the SAME EXACT sub-niche as the analysed business — not just the same broad industry. If you are tempted to say "same broad industry but different niche", REJECT it.
- Sub-niche test: ask "would a typical customer of the analysed business actively compare it to this candidate before buying?" If the answer is "no" or "maybe", REJECT the candidate.
- STRONGLY PREFER domains from the "REAL ORGANIC COMPETITORS" list above when they genuinely match the sub-niche — they are verified to compete on the same search terms. Filter out any from that list that are clearly different niches (news sites, marketplaces, generic aggregators, parent-company portals, irrelevant verticals, info/review/comparison sites).
- You may add 1-3 well-known direct competitors not in that list if they are obvious sub-niche leaders the SERP data missed.
- Use real, currently-operating company domains (the company's primary domain only, no paths or subdomains). No invented names. No defunct businesses. No dead/parked domains.
- Do NOT include the analysed domain (${cleanInput}) itself.
- EXCLUDE: news outlets, comparison/review aggregators (NerdWallet, Investopedia, BrokerChooser, BestBrokers, ForexBrokers, etc.), Wikipedia, marketplaces (Amazon, eBay), generic SaaS the brand merely uses (HubSpot, Zendesk), and any domain whose primary purpose is content/info rather than selling the same product.
- Prioritise competitors active in the same geographic market when possible.
- If the site looks like a CFD/forex broker, list other CFD/forex brokers (eToro, IG, Plus500, XM, CMC Markets, AvaTrade, Pepperstone, OANDA, Saxo, FXCM, FxPro, ThinkMarkets, etc.) — NOT generic fintechs or stock-trading apps.
- If it's a pet insurance site, list pet insurance brands. Apply the same sub-niche specificity to every industry.
- Order results by market relevance / overlap (most direct competitor first).
- In the "why" field, name the SPECIFIC overlapping product or service — not generic phrases like "operates in the same industry".`;

    let aiResult = null;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a precise market-research analyst. Output strict JSON only — no markdown fences, no prose. Always identify the specific sub-niche, not just the broad industry. When in doubt about a candidate competitor, EXCLUDE it — accuracy beats completeness.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices?.[0]?.message?.content || '{}';
      aiResult = JSON.parse(raw);
    } catch (aiErr) {
      console.error('smart-detect OpenAI error (after retry+fallback):', aiErr.message);
      // Deterministic fallback: if we have ANY DataForSEO competitor data,
      // return that with a generic industry label rather than a hard failure.
      // The client can still proceed with real same-niche domains.
      if (dfsCompetitors.length >= 3) {
        return res.json({
          ok: true,
          domain: cleanInput,
          industryName: 'Detected via SERP (AI temporarily unavailable)',
          industryKey: 'marketing',
          businessSummary: '',
          subNiche: '',
          country: null,
          competitors: dfsCompetitors.slice(0, 8).map(d => ({
            name: d.replace(/\.[a-z.]+$/i, '').replace(/^[a-z]/, c=>c.toUpperCase()),
            url:  d,
            why:  'Ranks for the same organic keywords as your domain (DataForSEO competitors_domain).',
          })),
          signals: { title, metaDesc, ogSiteName },
          htmlFetched: html.length > 0,
          _fallback: 'serp-only',
        });
      }
      return res.status(502).json({ error: 'AI detection failed', detail: aiErr.message, signals });
    }

    // ── 4) Sanitise + return ─────────────────────────────────────────────────
    const safeKey = allowedKeys.includes(aiResult.industryKey) ? aiResult.industryKey : 'marketing';
    const competitors = Array.isArray(aiResult.competitors) ? aiResult.competitors
      .filter(c => c && c.name && c.url)
      .map(c => ({
        name: String(c.name).trim().slice(0, 60),
        url:  String(c.url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase(),
        why:  String(c.why || '').trim().slice(0, 200),
      }))
      .filter(c => c.url && c.url !== cleanInput)
      // Belt-and-braces: strip any aggregator/news/info/review domain the AI
      // may slip in despite the prompt rules. INFO_SITE_PATTERN is shared
      // with sector-competitors.
      .filter(c => !INFO_SITE_PATTERN.test(c.url))
      .slice(0, 10) : [];

    res.json({
      ok: true,
      domain: cleanInput,
      industryName: String(aiResult.industryName || '').trim().slice(0, 80) || 'Unknown industry',
      industryKey: safeKey,
      businessSummary: String(aiResult.businessSummary || '').trim().slice(0, 280),
      subNiche: String(aiResult.subNiche || '').trim().slice(0, 60),
      country: aiResult.country || null,
      competitors,
      signals: { title, metaDesc, ogSiteName },
      htmlFetched: html.length > 0,
    });
  } catch (err) {
    console.error('/api/smart-detect error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ── POST /api/sector-competitors ──────────────────────────────────────────────
// Given a free-form industry/sub-niche string (e.g. "Online CFD broker",
// "Pet insurance", "Vegan meal delivery"), returns 6-10 REAL, currently-operating
// direct competitors in that exact niche, optionally biased to a country market.
// Used when the user analyses by sector alone OR when they type an industry to
// refine the URL-based detection.
app.post('/api/sector-competitors', async (req, res) => {
  try {
    const { industry, country, urlHint } = req.body || {};
    if (!industry || typeof industry !== 'string' || industry.trim().length < 2) {
      return res.status(400).json({ error: 'industry string required' });
    }
    const industryClean = industry.trim().slice(0, 120);
    const countryClean  = (country && typeof country === 'string') ? country.trim().slice(0, 40) : '';
    const urlClean      = urlHint ? String(urlHint).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase() : '';

    // ── Pull real SERP results for the niche via DataForSEO so the AI can
    //    rank actual ranking domains rather than relying purely on memory.
    let serpDomains = [];
    if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
      try {
        const queries = [
          `best ${industryClean} companies`,
          `top ${industryClean} brands`,
          `${industryClean} alternatives`,
        ];
        const SKIP = ['google.com','youtube.com','facebook.com','wikipedia.org','twitter.com','x.com','instagram.com','linkedin.com','reddit.com','amazon.com','pinterest.com','tiktok.com','quora.com','medium.com','forbes.com','bloomberg.com','techcrunch.com','g2.com','capterra.com','trustpilot.com','yelp.com'];
        const tasks = queries.map(q => {
          const t = { keyword: q, language_name: 'English', depth: 20 };
          if (countryClean) t.location_name = countryClean;
          return t;
        });
        const serpRaw = await callDataForSEO('/v3/serp/google/organic/live/advanced', tasks, 14000);
        if (serpRaw.status_code === 20000) {
          const counts = {};
          (serpRaw.tasks || []).forEach(task => {
            const items = task?.result?.[0]?.items || [];
            items.forEach(it => {
              if (it.type !== 'organic' || !it.domain) return;
              const d = it.domain.replace(/^www\./, '').toLowerCase();
              if (SKIP.some(s => d.includes(s))) return;
              if (urlClean && d === urlClean) return;
              counts[d] = (counts[d] || 0) + 1;
            });
          });
          serpDomains = Object.entries(counts)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 20)
            .map(([d]) => d);
          console.log(`[sector-competitors] SERP candidate domains for "${industryClean}":`, serpDomains);
        }
      } catch (e) { console.warn('[sector-competitors] SERP lookup failed:', e.message); }
    }

    const serpList = serpDomains.length
      ? `\nLIVE SERP RANKING DOMAINS (these domains currently rank in Google for "best ${industryClean} companies", "top ${industryClean} brands", and "${industryClean} alternatives" — they are real candidate competitors):\n${serpDomains.map((d,i)=>`${i+1}. ${d}`).join('\n')}\n`
      : '';

    const prompt = `You are a senior market-research analyst with deep knowledge of every B2B and B2C sub-vertical. The user wants to analyse competitors in the following niche.

INDUSTRY / SUB-NICHE: "${industryClean}"
TARGET MARKET: ${countryClean || '(global / not specified)'}
${urlClean ? `USER'S OWN DOMAIN (exclude from results): ${urlClean}` : ''}
${serpList}

TASK — return ONLY valid JSON, no markdown, no commentary:
{
  "industryName": "<canonical, specific industry label, e.g. 'Online CFD & Forex Trading Brokers' or 'Direct-to-Consumer Pet Insurance'>",
  "subNiche": "<2-5 word sub-niche label>",
  "competitors": [
    { "name": "<real, currently-operating company>", "url": "<their primary domain, e.g. example.com>", "why": "<one sentence: why they directly compete in this exact niche>", "marketShare": "<rough qualitative descriptor: 'market leader' / 'top-5' / 'challenger' / 'niche player'>" }
  ]
}

CRITICAL RULES — accuracy beats completeness:
- Return EXACTLY 8 competitors (or as close as possible — never fewer than 6, never more than 10).
- STRONGLY PREFER domains from the "LIVE SERP RANKING DOMAINS" list above when they genuinely match the sub-niche — they are verified to currently rank for this niche on Google. Filter out any from that list that are clearly different niches (review sites, news, marketplaces, parent-company portals, irrelevant verticals, info/comparison sites).
- You may add 1-3 well-known direct competitors not in that list if they are obvious sub-niche leaders the SERP missed.
- Every competitor MUST operate in the SAME EXACT sub-niche as the input — not just the same broad industry. If the input is "online CFD broker", do NOT list generic fintechs or stock-trading apps; list real CFD brokers (eToro, IG, Plus500, XM, CMC Markets, AvaTrade, Pepperstone, OANDA, Saxo, FXCM, FxPro, ThinkMarkets, etc.).
- Sub-niche test: ask "would a typical customer of "${industryClean}" actively compare it to this candidate before buying?" If the answer is "no" or "maybe", REJECT the candidate.
- EXCLUDE: news outlets (Bloomberg, Reuters, Forbes, CNBC), comparison/review aggregators (NerdWallet, Investopedia, BrokerChooser, BestBrokers, ForexBrokers.com, G2, Capterra), Wikipedia, marketplaces (Amazon, eBay) unless they ARE the niche, generic SaaS the brand merely uses, and any domain whose primary purpose is content/info rather than selling the same product. When in doubt, EXCLUDE.
- Use real, currently-operating, well-known company domains. No invented names. No defunct businesses. No dead/parked domains.
- Prioritise competitors that are active and visible in the target market (${countryClean || 'global'}). Mix in 1-2 global leaders for benchmark context if the niche is mostly local.
- Domains must be the company's actual primary domain (e.g. "etoro.com", not "etoro.com/uk" or "etoro").
- Do NOT include the user's own domain (${urlClean || 'n/a'}) in the results.
- Order results by market relevance (most relevant first).
- Be very specific — for "vegan meal delivery", list other vegan-only meal delivery brands; for "B2B SaaS project management", list Asana/Monday/ClickUp/Wrike/etc.; for "pet insurance", list Trupanion/Lemonade Pet/Healthy Paws/Embrace/etc.
- In the "why" field, name the SPECIFIC product or service overlap — not generic phrases like "operates in the same industry".`;

    // Deterministic same-niche fallback we'll use if AI fails. Filter the SERP
    // candidates to drop info/review/aggregator sites and keep only domains
    // that are most likely to be actual competitors in the niche.
    // (INFO_SITE_PATTERN is defined at module scope and shared with smart-detect.)
    const serpCompetitorFallback = serpDomains
      .filter(d => !INFO_SITE_PATTERN.test(d))
      .slice(0, 8)
      .map(d => ({
        name: d.replace(/\.[a-z.]+$/i, '').replace(/[-_]/g,' ').replace(/^[a-z]/, c=>c.toUpperCase()),
        url:  d,
        why:  `Currently ranks in Google for "${industryClean}"-related search terms (live SERP data).`,
        marketShare: 'top-ranked',
      }));

    let aiResult = null;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a precise market-research analyst with encyclopedic knowledge of real-world companies in every sub-niche. Output strict JSON only — no markdown, no prose. Always pick competitors operating in the user\'s EXACT sub-niche, never just the broad industry. When in doubt about a candidate, EXCLUDE it — accuracy beats completeness.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1400,
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices?.[0]?.message?.content || '{}';
      aiResult = JSON.parse(raw);
    } catch (aiErr) {
      console.error('sector-competitors OpenAI error (after retry+fallback):', aiErr.message);
      // Deterministic SERP-only response — better than failing the whole flow.
      if (serpCompetitorFallback.length >= 3) {
        return res.json({
          ok: true,
          industryName: industryClean,
          subNiche: '',
          country: countryClean || null,
          competitors: serpCompetitorFallback,
          count: serpCompetitorFallback.length,
          _fallback: 'serp-only',
        });
      }
      return res.status(502).json({ error: 'AI lookup failed', detail: aiErr.message });
    }

    const competitors = Array.isArray(aiResult.competitors) ? aiResult.competitors
      .filter(c => c && c.name && c.url)
      .map(c => ({
        name: String(c.name).trim().slice(0, 60),
        url:  String(c.url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase(),
        why:  String(c.why || '').trim().slice(0, 200),
        marketShare: String(c.marketShare || '').trim().slice(0, 30),
      }))
      .filter(c => c.url && c.url !== urlClean)
      // de-duplicate by domain
      .filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i)
      // Belt-and-braces: strip any aggregator/news/info domain the AI may
      // still slip in despite the prompt rules. INFO_SITE_PATTERN now covers
      // the news + review + comparison aggregator brands too (defined at
      // module scope above).
      .filter(c => !INFO_SITE_PATTERN.test(c.url))
      .filter(c => !/^(en\.)?wikipedia\.org$/i.test(c.url))
      .slice(0, 10) : [];

    res.json({
      ok: true,
      industryName: String(aiResult.industryName || industryClean).trim().slice(0, 80),
      subNiche: String(aiResult.subNiche || '').trim().slice(0, 60),
      country: countryClean || null,
      competitors,
      count: competitors.length,
    });
  } catch (err) {
    console.error('/api/sector-competitors error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ── POST /api/competitor-deep-analysis ────────────────────────────────────────
// Scrapes ONE specific competitor's homepage and uses GPT-4o to produce a
// targeted, side-by-side analysis vs the user's own site + industry context.
app.post('/api/competitor-deep-analysis', async (req, res) => {
  try {
    const { competitorName, competitorUrl, yourDomain, industryName, country } = req.body || {};
    if (!competitorUrl) return res.status(400).json({ error: 'competitorUrl required' });

    const cleanComp = String(competitorUrl).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    const cleanYou  = String(yourDomain || '').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();

    // Scrape competitor homepage; fall back to Firecrawl if Cloudflare/WAF blocks
    let html = '';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch('https://' + cleanComp, {
        signal: ctrl.signal, redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfoGenieBot/1.0)', 'Accept': 'text/html' },
      });
      clearTimeout(t);
      if (r.ok) html = (await r.text()).slice(0, 70000);
    } catch (fe) { console.warn('comp-deep fetch failed:', fe.message); }
    if (!html) html = (await _firecrawlFetch('https://' + cleanComp, 14000)).slice(0, 70000);

    const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
    const title    = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const ogDesc   = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const h1s = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)||[]).slice(0,3).map(s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);
    const h2s = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)||[]).slice(0,8).map(s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);
    const ctas = (html.match(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)||[])
      .map(s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim())
      .filter(s => s && s.length > 2 && s.length < 40 && /sign\s?up|start|try|get|buy|book|free|trial|join|register|download|demo|quote/i.test(s))
      .slice(0, 8);
    const body = html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 2200);

    const prompt = `You are a senior competitive-intelligence analyst. A marketing operator wants TARGETED intel on ONE competitor so they can outflank them.

THE OPERATOR'S SITE: ${cleanYou || '(not specified — sector overview mode)'}
INDUSTRY: ${industryName || 'unknown'}
TARGET MARKET: ${country || 'global'}

THE COMPETITOR YOU MUST ANALYSE: ${competitorName} (${cleanComp})

SCRAPED FROM THEIR HOMEPAGE:
- TITLE: ${title || '(none)'}
- META DESCRIPTION: ${metaDesc || ogDesc || '(none)'}
- H1: ${h1s.join(' | ') || '(none)'}
- H2: ${h2s.join(' | ') || '(none)'}
- CTAs DETECTED: ${ctas.join(', ') || '(none)'}
- BODY EXCERPT: ${body || '(could not fetch — use what you know about this company)'}

Return ONLY strict JSON, no markdown:
{
  "positioning": "<one sentence — exactly how this competitor positions themselves in 2026, based on the scraped copy>",
  "primaryOffer": "<their main product/offer/hook in plain language>",
  "valueProps": ["<3-5 specific value props they lead with — quote/paraphrase from the scrape, do NOT invent>"],
  "ctaStrategy": "<one sentence on what action they push visitors toward and how aggressive their funnel is>",
  "pricingSignal": "<freemium / paid trial / quote-based / hidden / transparent — and any price points visible>",
  "targetCustomer": "<one sentence describing their actual ICP, inferred from the copy>",
  "strengths": [
    "<4 SPECIFIC strengths grounded in the scraped evidence — reference real wording where possible. Avoid generic 'strong brand'>"
  ],
  "weaknesses": [
    "<4 SPECIFIC weaknesses or gaps — be concrete, e.g. 'No mention of mobile app despite competitors leading with it', 'Pricing is hidden which loses self-serve buyers'>"
  ],
  "keywordAngles": [
    "<4 keyword/SEO angles where ${cleanYou || 'a challenger'} can outrank them — be specific to ${industryName || 'this niche'}>"
  ],
  "adChannelGaps": [
    "<3 ad channels where this competitor under-invests — give a concrete play for each>"
  ],
  "counterPlays": [
    "<5 concrete, executable plays the operator can run THIS WEEK to take share from ${competitorName}. Each should be 1-2 sentences, mention a real channel, and include a measurable angle (CPC range, headline, audience, etc.). Reference ${competitorName} by name in at least 3 plays.>"
  ],
  "messagingHooks": [
    "<3 ad headline ideas the operator can run that directly counter ${competitorName}'s positioning. Wrap each in quotes.>"
  ],
  "threatLevel": "<low | medium | high | critical>",
  "threatRationale": "<one sentence explaining the threat rating>"
}

CRITICAL: Be SPECIFIC. Quote real words from the scrape. Name ${competitorName} explicitly in plays. Do NOT output generic SaaS advice.`;

    let aiResult = null;
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a precise competitive-intelligence analyst. Output strict JSON. Always be specific to the named competitor and the operator\'s industry — never generic.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
      });
      aiResult = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    } catch (aiErr) {
      console.error('comp-deep OpenAI error:', aiErr.message);
      return res.status(502).json({ error: 'AI analysis failed', detail: aiErr.message });
    }

    res.json({
      ok: true,
      competitor: { name: competitorName, url: cleanComp },
      yourDomain: cleanYou,
      industryName,
      htmlFetched: html.length > 0,
      ...aiResult,
    });
  } catch (err) {
    console.error('/api/competitor-deep-analysis error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});
};
