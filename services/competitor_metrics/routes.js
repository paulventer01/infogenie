// Keyword gap · domain · competitor metrics · SOV routes.
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
  const { callDataForSEO, openaiChatWithRetry } = ctx;

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
// REAL keyword gap analysis: pulls keywords each competitor ACTUALLY ranks for
// (via DataForSEO ranked_keywords), then filters out keywords yourDomain
// already ranks for. Returns ONLY live data — no industry-generic seed fallback.
// Body: { yourDomain, industry, competitors?, location?, language?, limit? }

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
      competitors,
      location = 'United States',
      language = 'English',
      limit = 20
    } = req.body;

    if (!yourDomain) { clearTimeout(safetyTimer); return res.status(400).json({ error: 'yourDomain is required' }); }
    if (!competitors || !competitors.length) {
      clearTimeout(safetyTimer);
      return res.status(400).json({ error: 'No competitors provided — run an analysis first.' });
    }

    const compDomains    = competitors.slice(0, 5);
    const cleanYourDomain = yourDomain.replace(/^www\./, '').replace(/^https?:\/\//,'').toLowerCase();
    const cleanComps     = compDomains
      .map(d => d.replace(/^https?:\/\//,'').replace(/^www\./,'').toLowerCase())
      .filter(d => d !== cleanYourDomain);

    const domainToName = d => {
      const n = d.replace(/^www\./, '').split('.')[0];
      return n.charAt(0).toUpperCase() + n.slice(1);
    };

    // ── Step 1: Pull REAL ranked keywords for each competitor + your domain ──
    // ranked_keywords returns the actual organic keywords a domain ranks for
    // in Google, with live search volume, CPC, and the competitor's exact rank.
    const buildRankedTask = (target, limit = 200) => {
      const t = {
        target,
        language_name: language,
        limit,
        load_rank_absolute: true,
        ignore_synonyms: true
      };
      if (location && location !== 'Global') t.location_name = location;
      return t;
    };

    const rankedCalls = [
      // Your domain — use a larger limit so we capture deeper rankings (e.g. #30-100)
      // that are outside the competitor keyword window but still relevant to gap analysis.
      callDataForSEO('/v3/dataforseo_labs/google/ranked_keywords/live',
        [buildRankedTask(cleanYourDomain, 500)], 20000)
        .then(raw => ({ domain: cleanYourDomain, raw, isYou: true }))
        .catch(e => { console.warn(`ranked_keywords failed for ${cleanYourDomain}:`, e.message); return { domain: cleanYourDomain, raw: null, isYou: true }; }),
      // Each competitor in parallel — all identified competitors (cap 10 for safety)
      ...cleanComps.slice(0, 10).map(compDomain =>
        callDataForSEO('/v3/dataforseo_labs/google/ranked_keywords/live',
          [buildRankedTask(compDomain)], 14000)
          .then(raw => ({ domain: compDomain, raw, isYou: false }))
          .catch(e => { console.warn(`ranked_keywords failed for ${compDomain}:`, e.message); return { domain: compDomain, raw: null, isYou: false }; })
      )
    ];

    const rankedResults = await Promise.all(rankedCalls);

    // Parse: for each domain, build a map of keyword → { volume, cpc, position }
    const yourRankings    = {};   // keyword → position (so we can subtract / mark)
    const compKeywordData = {};   // keyword → { topComp, position, volume, cpc, comps:[{name,pos}] }

    let paymentRequired = false;
    for (const { domain, raw, isYou } of rankedResults) {
      if (!raw) { console.warn(`ranked_keywords(${domain}): no response`); continue; }
      if (raw.status_code !== 20000) { console.warn(`ranked_keywords(${domain}): status_code=${raw.status_code} status_message=${raw.status_message}`); continue; }
      const task0 = (raw.tasks || [])[0];
      if (task0 && task0.status_code === 40200) paymentRequired = true;
      if (task0 && task0.status_code !== 20000) console.warn(`ranked_keywords(${domain}): task status=${task0.status_code} ${task0.status_message}`);
      const items = (task0?.result || [])[0]?.items || [];
      const compName = domainToName(domain);
      for (const it of items) {
        const kd  = it.keyword_data || {};
        const kw  = (kd.keyword || '').trim();
        if (!kw || kw.length > 80 || kw.startsWith('http') || kw.includes('www.')) continue;
        // Skip brand-name searches (the competitor's own brand)
        const compRoot = domain.split('.')[0];
        if (kw.toLowerCase().includes(compRoot.toLowerCase()) && kw.toLowerCase().split(' ').length <= 2) continue;

        const pos = it.ranked_serp_element?.serp_item?.rank_group || it.ranked_serp_element?.serp_item?.rank_absolute || 0;
        const vol = kd.keyword_info?.search_volume || 0;
        const cpc = kd.keyword_info?.cpc || 0;
        const diff= kd.keyword_properties?.keyword_difficulty || 0;

        if (isYou) {
          yourRankings[kw.toLowerCase()] = pos;
          continue;
        }
        // For competitor keywords: only keep meaningful volume + low position
        if (vol < 30) continue;
        if (pos > 20) continue;

        const key = kw.toLowerCase();
        if (!compKeywordData[key]) {
          compKeywordData[key] = { keyword: kw, volume: vol, cpc, diff, comps: [] };
        }
        compKeywordData[key].comps.push({ name: compName, pos });
        // Keep best (lowest) position as the "topComp"
        if (!compKeywordData[key].topComp || pos < compKeywordData[key].topPos) {
          compKeywordData[key].topComp = compName;
          compKeywordData[key].topPos  = pos;
        }
      }
      console.log(`ranked_keywords(${domain}): ${items.length} raw keywords parsed`);
    }

    // ── Step 2: Build the gap list — competitor keywords WHERE you don't rank well ──
    const ctrTable = [0, 28.5, 15.7, 11.0, 8.0, 5.9, 4.4, 3.3, 2.6, 2.2, 1.9];
    const allCandidates = Object.values(compKeywordData);

    const allScored = allCandidates
      .map(c => {
        const yourPos = yourRankings[c.keyword.toLowerCase()] || 0;
        // Gap: you don't rank in top 10
        if (yourPos > 0 && yourPos <= 10) return null;
        const compCtr = c.topPos <= 10 ? ctrTable[c.topPos].toFixed(1) + '%' : '< 2.0%';
        const yourRank = yourPos > 0 ? `#${yourPos}` : 'Not ranking';
        // Opportunity score: volume × CPC value × inverse-difficulty
        const compCount = c.comps.length;
        // Rescale: each input contributes a bounded share so total stays in 0-100
        //   volume   (log scale, max ~30 at 100k+ vol)
        //   diff     (max 25 if very low difficulty)
        //   cpc      (log scale, max ~20 at $50+)
        //   posBonus (max 15 if competitor #1, scales down)
        //   multiBonus (max 10 if 4+ competitors all rank for it)
        const volPart  = Math.min(30, Math.log10(c.volume + 1) * 6);
        const diffPart = Math.min(25, (100 - (c.diff || 50)) * 0.25);
        const cpcPart  = Math.min(20, Math.log10((c.cpc || 0) + 1) * 12);
        const posPart  = Math.max(0, 15 - (c.topPos - 1) * 1.5);
        const multiPart= Math.min(10, (compCount - 1) * 3.5);
        const score = Math.round(volPart + diffPart + cpcPart + posPart + multiPart);
        const compsSorted = [...c.comps].sort((a, b) => a.pos - b.pos);
        const compsLabel = compsSorted.map(x => `${x.name} #${x.pos}`).join(', ');
        return {
          keyword:        c.keyword,
          volume:         c.volume.toLocaleString(),
          volumeRaw:      c.volume,
          topComp:        c.topComp,
          comps:          compsSorted,
          compsLabel,
          compCount:      compsSorted.length,
          compCtr,
          compPos:        c.topPos,
          yourRank,
          difficulty:     DIFFICULTY_LABEL(c.diff || 0),
          difficultyScore:c.diff || 0,
          score:          Math.min(100, Math.max(1, score)),
          cpc:            c.cpc ? `$${parseFloat(c.cpc).toFixed(2)}` : '—',
          source:         'DataForSEO ranked_keywords'
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    // Round-robin across competitors so the final list shows ALL of them, not just the strongest.
    const targetLimit = parseInt(limit) || 15;
    const byComp = {};
    for (const r of allScored) {
      (byComp[r.topComp] = byComp[r.topComp] || []).push(r);
    }
    const compNames = Object.keys(byComp);
    const gapRows = [];
    let idx = 0;
    while (gapRows.length < targetLimit && compNames.some(n => byComp[n].length)) {
      const name = compNames[idx % compNames.length];
      if (byComp[name].length) gapRows.push(byComp[name].shift());
      idx++;
    }
    gapRows.sort((a, b) => b.score - a.score);

    console.log(`Keyword gap: ${allCandidates.length} candidates → ${gapRows.length} real gaps for ${cleanYourDomain}`);

    if (!gapRows.length) {
      clearTimeout(safetyTimer);
      if (!res.headersSent) {
        return res.status(200).json({
          keywords: [],
          domain: yourDomain,
          competitors: compDomains,
          paymentRequired,
          warning: paymentRequired
            ? `⚠️ DataForSEO account is overdrawn or out of credit (Payment Required). Top up at dataforseo.com/dashboard to enable live keyword data.`
            : `No live keyword gaps found — competitors (${compDomains.join(', ')}) returned no organic ranking data from DataForSEO for the ${location} market.`,
          timestamp: new Date().toISOString()
        });
      }
      return;
    }

    clearTimeout(safetyTimer);
    if (!res.headersSent) {
      res.json({
        keywords: gapRows,
        domain: yourDomain,
        competitors: compDomains,
        location,
        source: 'DataForSEO ranked_keywords (live organic SERP data)',
        timestamp: new Date().toISOString()
      });
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

// ── POST /api/competitor-metrics ──────────────────────────────────────────────
// Body: { domains: ['x.com', 'y.com'], industryKey?, location?, language? }
// Returns real per-domain metrics: traffic, adSpend, CTR, ROAS — all derived
// from DataForSEO domain_rank_overview + keywords_for_site (parallelised).
app.post('/api/competitor-metrics', async (req, res) => {
  try {
    const { domains, industryKey = 'default', location = 'United States', language = 'English' } = req.body || {};
    if (!Array.isArray(domains) || !domains.length) {
      return res.status(400).json({ error: 'domains array required' });
    }
    if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
      return res.status(503).json({ error: 'DataForSEO credentials not configured', results: [] });
    }

    // CTR by SERP position (industry standard table)
    const ctrTable = [0, 28.5, 15.7, 11.0, 8.0, 5.9, 4.4, 3.3, 2.6, 2.2, 1.9];
    // Industry conversion rates (%) and AOV ($) for ROAS modeling
    const industryConvRates = {
      finance:3.1, fintech:3.4, ecommerce:2.4, retail:1.8, saas:4.2, software:3.8,
      health:2.8, healthcare:2.8, travel:2.1, education:3.6, realestate:2.3, default:3.0
    };
    const industryAOVs = {
      finance:480, fintech:420, ecommerce:75, retail:65, saas:200, software:180,
      health:120, healthcare:140, travel:350, education:280, realestate:900, default:150
    };
    const convRate = industryConvRates[industryKey] || industryConvRates.default;
    const aov      = industryAOVs[industryKey]      || industryAOVs.default;

    const formatNum = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M'
                       : n >= 1e3 ? (n/1e3).toFixed(0)+'K' : String(n);
    const formatMoney = n => n >= 1e6 ? '$'+(n/1e6).toFixed(1)+'M/mo'
                          : n >= 1e3 ? '$'+(n/1e3).toFixed(0)+'K/mo'
                          : '$'+n+'/mo';

    // Normalise: strip protocol/www/path AND append `.com` when the user typed
    // a bare brand name (e.g. "fxpro" → "fxpro.com"). DataForSEO rejects
    // anything without a TLD with "Invalid Field 'target'".
    const cleanDomain = d => {
      let s = (d || '').toString().trim().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase();
      if (!s) return '';
      // Looks like a bare brand (letters/numbers/dashes only, no dot) → append .com
      if (!s.includes('.') && /^[a-z0-9-]+$/.test(s)) s = s + '.com';
      return s;
    };

    // Process domains in PARALLEL — DataForSEO bills per-task, not concurrent calls
    const tasks = domains.slice(0, 10).map(async (raw) => {
      const d = cleanDomain(raw);
      if (!d || !d.includes('.')) {
        return { domain: raw, realData: false, error: 'invalid domain' };
      }
      try {
        const drTask = { target: d, language_name: language };
        if (location && location !== 'Global') drTask.location_name = location;
        const kwTask = { target: d, language_name: language, limit: 50,
                         order_by: ['keyword_data.keyword_info.search_volume,desc'] };
        if (location && location !== 'Global') kwTask.location_name = location;

        // Fire both calls in parallel for this domain
        const [drRaw, kwRaw] = await Promise.all([
          callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [drTask], 12000)
            .catch(e => { console.warn(`  metrics ${d} dr failed:`, e.message); return null; }),
          callDataForSEO('/v3/dataforseo_labs/google/keywords_for_site/live', [kwTask], 12000)
            .catch(e => { console.warn(`  metrics ${d} kw failed:`, e.message); return null; })
        ]);

        const drResult = drRaw?.tasks?.[0]?.result?.[0];
        const item     = drResult?.items?.[0];
        const organic  = item?.metrics?.organic || {};
        const paid     = item?.metrics?.paid    || {};
        const orgEtv   = Math.round(organic.etv || 0);
        const paidEtv  = Math.round(paid.etv    || 0);
        const orgCount = organic.count || 0;
        const paidCount= paid.count    || 0;
        const domainRank = drResult?.domain_rank || 0;

        // Avg position + CPC from real keyword data
        const kwItems = kwRaw?.tasks?.[0]?.result?.[0]?.items || [];
        const cpcs      = kwItems.map(i => i.keyword_data?.keyword_info?.cpc || 0).filter(c => c > 0);
        const positions = kwItems.map(i => i.ranked_serp_element?.serp_item?.rank_absolute || 0)
                                 .filter(p => p > 0 && p <= 100);
        const avgCPC      = cpcs.length ? cpcs.reduce((a,b)=>a+b,0)/cpcs.length : 0;
        const avgPosition = positions.length ? positions.reduce((a,b)=>a+b,0)/positions.length : 8;

        // CTR derived from real SERP position (capped to position table)
        const posInt = Math.min(10, Math.max(1, Math.round(avgPosition)));
        const liveCTR = parseFloat((ctrTable[posInt] || 1.8).toFixed(2));

        // Total estimated monthly traffic = organic + paid
        const totalTraffic = orgEtv + paidEtv;

        // Ad spend: prefer paid.etv (DataForSEO's own paid traffic value)
        // Fallback: paidKeywords × avgCPC × 30 days × ~5% click rate
        const adSpend = paidEtv > 0 ? paidEtv
                      : (paidCount > 0 && avgCPC > 0)
                          ? Math.round(paidCount * avgCPC * 0.05 * 30)
                          : 0;

        // ROAS = (paid_clicks × convRate × AOV) / adSpend
        // Estimated paid clicks per month = adSpend / avgCPC
        let liveROAS = 0;
        if (adSpend > 0 && avgCPC > 0) {
          const paidClicks = adSpend / avgCPC;
          const revenue    = paidClicks * (convRate/100) * aov;
          liveROAS = parseFloat((revenue / adSpend).toFixed(1));
          if (liveROAS > 8) liveROAS = parseFloat((Math.log(liveROAS)*2).toFixed(1)); // dampen outliers
        }

        return {
          domain: d,
          realData: !!drResult,
          dataSource: 'DataForSEO',
          domainRank,
          organicTraffic: orgEtv,
          paidTraffic: paidEtv,
          totalTraffic,
          trafficFmt: formatNum(totalTraffic),
          organicKeywords: orgCount,
          paidKeywords: paidCount,
          avgPosition: parseFloat(avgPosition.toFixed(1)),
          avgCPC: parseFloat(avgCPC.toFixed(2)),
          ctr: liveCTR,
          ctrFmt: liveCTR.toFixed(1) + '%',
          adSpendNum: adSpend,
          adSpend: adSpend > 0 ? formatMoney(adSpend) : '—',
          roas: liveROAS,
          roasFmt: liveROAS > 0 ? liveROAS.toFixed(1) + '×' : '—'
        };
      } catch(e) {
        console.warn(`  metrics ${d} failed:`, e.message);
        return { domain: d, realData: false, error: e.message };
      }
    });

    const results = await Promise.all(tasks);
    res.json({ ok: true, results, count: results.length });
  } catch(err) {
    console.error('/api/competitor-metrics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/live-kpis ───────────────────────────────────────────────────────
// Returns live CTR, CPA, ROAS and Conv. Rate derived from real DataForSEO
// keyword data for the target domain. Used to upgrade KPI cards from "AI EST."
// Body: { domain, industryKey, location?, language? }
app.post('/api/live-kpis', async (req, res) => {
  try {
    const { domain, industryKey = 'default', location = 'United States', language = 'English' } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    let cleanDomain = (domain || '').toString().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    if (cleanDomain && !cleanDomain.includes('.') && /^[a-z0-9-]+$/.test(cleanDomain)) cleanDomain = cleanDomain + '.com';

    // CTR position table (same as keyword gap logic)
    const ctrTable = [0, 28.5, 15.7, 11.0, 8.0, 5.9, 4.4, 3.3, 2.6, 2.2, 1.9];

    // Industry-specific conversion rates (%) from industry benchmarks
    const industryConvRates = {
      finance: 3.1, fintech: 3.4, ecommerce: 2.4, retail: 1.8,
      saas: 4.2, software: 3.8, health: 2.8, healthcare: 2.8,
      travel: 2.1, education: 3.6, realestate: 2.3, default: 3.0
    };
    // Industry AOV (average order value $)
    const industryAOVs = {
      finance: 480, fintech: 420, ecommerce: 75, retail: 65,
      saas: 200, software: 180, health: 120, healthcare: 140,
      travel: 350, education: 280, realestate: 900, default: 150
    };

    const convRate = industryConvRates[industryKey] || industryConvRates.default;
    const aov      = industryAOVs[industryKey] || industryAOVs.default;

    // ── Step 1: Domain rank overview (traffic + paid data) ──
    let organicTraffic = 0, paidTraffic = 0, domainRank = 0, paidKeywords = 0;
    try {
      const drTask = { target: cleanDomain, language_name: language };
      if (location && location !== 'Global') drTask.location_name = location;
      const drRaw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [drTask], 10000);
      const drResult = drRaw?.tasks?.[0]?.result?.[0];
      const drItem   = drResult?.items?.[0];
      const organic  = drItem?.metrics?.organic;
      const paid     = drItem?.metrics?.paid;
      organicTraffic = organic ? Math.round(organic.etv || 0) : 0;
      paidTraffic    = paid    ? Math.round(paid.etv    || 0) : 0;
      paidKeywords   = paid    ? (paid.count || 0) : 0;
      domainRank     = drResult?.domain_rank || 0;
    } catch(e) { console.warn('live-kpis domain_rank_overview failed:', e.message); }

    // ── Step 2: Keywords for site (CPC + position data) ──
    let avgCPC = 0, avgPosition = 8, keywordsWithCPC = 0;
    try {
      const kwTask = { target: cleanDomain, language_name: language, limit: 100,
                       order_by: ['keyword_data.keyword_info.search_volume,desc'] };
      if (location && location !== 'Global') kwTask.location_name = location;
      const kwRaw   = await callDataForSEO('/v3/dataforseo_labs/google/keywords_for_site/live', [kwTask], 14000);
      const kwItems = kwRaw?.tasks?.[0]?.result?.[0]?.items || [];

      const cpcs      = kwItems.map(it => it.keyword_data?.keyword_info?.cpc || 0).filter(c => c > 0);
      const positions = kwItems.map(it => it.ranked_serp_element?.serp_item?.rank_absolute || 0).filter(p => p > 0 && p <= 100);

      if (cpcs.length)      { avgCPC = cpcs.reduce((a,b)=>a+b,0) / cpcs.length; keywordsWithCPC = cpcs.length; }
      if (positions.length) { avgPosition = positions.reduce((a,b)=>a+b,0) / positions.length; }
    } catch(e) { console.warn('live-kpis keywords_for_site failed:', e.message); }

    // ── Derive live KPIs ──────────────────────────────────────────────────────
    // CTR from real avg organic position
    const posInt   = Math.min(10, Math.max(1, Math.round(avgPosition)));
    const liveCTR  = parseFloat((ctrTable[posInt] || 1.8).toFixed(2));

    // CPA from real avg CPC + industry conv rate
    let liveCPA;
    if (avgCPC > 0) {
      liveCPA = (avgCPC / (convRate / 100)).toFixed(1);
    } else {
      liveCPA = null; // no real CPC data — keep AI estimate
    }

    // ROAS: revenue_estimate / ad_spend_estimate using real traffic + CPC
    let liveROAS = null;
    if (avgCPC > 0 && organicTraffic > 0) {
      const monthlyConversions = (organicTraffic + paidTraffic) * (convRate / 100);
      const revenue    = monthlyConversions * aov;
      const adSpend    = Math.max(300, paidKeywords * avgCPC * 30 * 0.05); // est. monthly paid spend
      const rawROAS    = revenue / adSpend;
      liveROAS = Math.max(1.2, Math.min(9.9, rawROAS)).toFixed(1);
    }

    // Conv. Rate: industry base + adjustment for domain authority (rank)
    let liveConvRate;
    if (domainRank > 0) {
      const rankBonus = domainRank < 1000 ? 1.4 : domainRank < 5000 ? 0.9
                      : domainRank < 20000 ? 0.4 : domainRank < 100000 ? 0 : -0.3;
      liveConvRate = Math.max(0.5, convRate + rankBonus).toFixed(2);
    } else {
      liveConvRate = null;
    }

    res.json({
      ctr:        liveCTR,
      cpa:        liveCPA,
      roas:       liveROAS,
      convRate:   liveConvRate,
      meta: {
        avgCPC:       avgCPC > 0 ? avgCPC.toFixed(2) : null,
        avgPosition:  avgPosition.toFixed(1),
        domainRank,
        organicTraffic,
        paidTraffic,
        keywordsWithCPC,
        source: 'DataForSEO'
      }
    });

  } catch(err) {
    console.error('/api/live-kpis error:', err.message);
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

        // Estimate monthly ad spend from paid.etv (estimated traffic value)
        // If etv is 0 but domain has paid keywords, use a fallback formula:
        // paidKeywords × avg_cpc ($2.50) × click_through_rate (5%) × 30 days
        const paidEtv   = Math.round(paid.etv || 0);
        const paidCount = paid.count || paidKws || 0;
        const adSpendEst = paidEtv > 0
          ? paidEtv
          : paidCount > 0
            ? Math.round(paidCount * 2.5 * 0.05 * 30)
            : 0;

        competitors.push({
          domain: d,
          name: d.replace(/^www\./, '').split('.')[0].charAt(0).toUpperCase() + d.replace(/^www\./, '').split('.')[0].slice(1),
          organicTraffic: etv,
          organicTrafficFmt: formatNum(etv),
          organicKeywords: kwCount,
          organicKeywordsFmt: formatNum(kwCount),
          paidKeywords: paidKws,
          adSpendEst,
          adSpend: '$' + (adSpendEst >= 1000 ? (adSpendEst/1000).toFixed(1)+'K' : adSpendEst) + '/mo',
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

// ── POST /api/competitor-enrich ──────────────────────────────────────────────
// Fetches REAL top organic keywords for each competitor (DataForSEO ranked_keywords/live)
// then uses GPT-4o-mini to derive the audience segments they are winning.
// Body: { competitors: string[], industry: string, yourDomain?: string, location?: string }
app.post('/api/competitor-enrich', async (req, res) => {
  const safetyTimer = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ ok: false, error: 'timeout' });
  }, 35000);
  try {
    const { competitors = [], industry = '', location = 'United States' } = req.body || {};
    if (!Array.isArray(competitors) || !competitors.length) {
      clearTimeout(safetyTimer);
      return res.status(400).json({ ok: false, error: 'competitors[] required' });
    }

    const cleanDomains = competitors.slice(0, 6)
      .map(d => String(d).replace(/^https?:\/\//,'').replace(/^www\./,'').toLowerCase().split('/')[0])
      .filter(Boolean);

    // ── Step 1: Fetch top organic keywords for each competitor in parallel ─────
    const kwResults = await Promise.all(cleanDomains.map(async (domain) => {
      try {
        const task = { target: domain, language_name: 'English', limit: 20, load_rank_absolute: true, ignore_synonyms: true };
        if (location && location !== 'Global') task.location_name = location;
        const raw = await callDataForSEO('/v3/dataforseo_labs/google/ranked_keywords/live', [task], 15000);
        const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
        const brandRoot = domain.split('.')[0].toLowerCase();
        const keywords = items
          .map(it => ({
            kw:  (it.keyword_data?.keyword || '').trim(),
            vol: it.keyword_data?.keyword_info?.search_volume || 0,
            pos: it.ranked_serp_element?.serp_item?.rank_group || 99,
          }))
          .filter(k => k.kw && k.vol >= 50 && k.pos <= 20)
          .filter(k => !(k.kw.toLowerCase().includes(brandRoot) && k.kw.split(' ').length <= 2))
          .sort((a, b) => b.vol - a.vol)
          .slice(0, 8)
          .map(k => k.kw);
        console.log(`[competitor-enrich] ${domain}: ${keywords.length} keywords from ${items.length} raw`);
        return { domain, keywords };
      } catch (e) {
        console.warn(`[competitor-enrich] ranked_keywords failed for ${domain}:`, e.message);
        return { domain, keywords: [] };
      }
    }));

    // ── Step 2: One GPT-4o-mini call to derive audience segments ──────────────
    const kwMap = {};
    kwResults.forEach(({ domain, keywords }) => { if (keywords.length) kwMap[domain] = keywords; });

    let audienceMap = {};
    if (Object.keys(kwMap).length > 0 && openaiChatWithRetry) {
      try {
        const compLines = Object.entries(kwMap)
          .map(([d, kws]) => `${d}: [${kws.slice(0, 8).map(k => `"${k}"`).join(', ')}]`)
          .join('\n');
        const prompt = `You are a senior digital marketing strategist.

Industry: ${industry || 'General'}

Below are real competitors and the top organic keywords they actually rank for on Google.
Based on these keywords, identify exactly 3 "winning audience segments" that each competitor is targeting.
Segments must be SPECIFIC to this industry — NOT generic labels like "General Users" or "All Customers".

${compLines}

Return ONLY valid JSON (no markdown, no comments):
{
  "audiences": {
    "<domain>": [
      { "label": "<2-4 word audience name>", "pct": <integer> },
      { "label": "<2-4 word audience name>", "pct": <integer> },
      { "label": "<2-4 word audience name>", "pct": <integer> }
    ]
  }
}

Rules:
- Exactly 3 segments per competitor
- Percentages must sum to 100
- Infer from what the keywords reveal about who is searching for this competitor
- Use industry-specific language (e.g. "Active Day Traders", "SMB Finance Teams", "First-Time Home Buyers")
- Weight the largest audience group highest`;

        const completion = await openaiChatWithRetry({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a precise marketing analyst. Output strict JSON only, no markdown, no code fences.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 900,
          response_format: { type: 'json_object' },
        });
        const raw = completion.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        audienceMap = parsed.audiences || {};
      } catch (e) {
        console.warn('[competitor-enrich] AI audience derivation failed:', e.message);
      }
    }

    // ── Step 3: Build and return enriched data ─────────────────────────────────
    const enriched = {};
    cleanDomains.forEach(domain => {
      const entry = kwResults.find(r => r.domain === domain) || { keywords: [] };
      const rawAuds = audienceMap[domain] || [];
      const audiences = rawAuds.slice(0, 3).map(a => ({
        label: String(a.label || '').trim().slice(0, 50),
        pct:   Math.min(100, Math.max(1, parseInt(a.pct, 10) || 33)),
      }));
      enriched[domain] = { topKeywords: entry.keywords, audiences };
    });

    clearTimeout(safetyTimer);
    res.json({ ok: true, enriched, source: 'dataforseo+ai' });
  } catch (err) {
    clearTimeout(safetyTimer);
    console.error('/api/competitor-enrich error:', err.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
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
};
