// Content scorer analyze routes.
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
  const { CONTENT_COUNTRY_CODES, _extractContentSignals, _fetchSerpTopForKeyword, _scrapePageForScoring, openaiChatWithRetry } = ctx;

function _scoreContent({ target, competitors, lsiTerms, keyword }) {
  const live = competitors.filter(c => c.ok);
  const breakdown = {};
  // ── 1) Word count vs SERP median (20 pts) ──────────────────────────────
  const wcs = live.map(c => c.wordCount).sort((a,b) => a-b);
  const median = wcs.length ? wcs[Math.floor(wcs.length / 2)] : 0;
  const mean   = wcs.length ? wcs.reduce((a,b)=>a+b,0) / wcs.length : 0;
  let wcScore = 0;
  if (median > 0) {
    const ratio = target.wordCount / median;
    // Continuous piecewise: 0 at ratio=0, 10 at ratio=0.5, 20 at ratio>=1.
    if (ratio >= 1)        wcScore = 20;
    else if (ratio >= 0.5) wcScore = Math.round(10 + 20 * (ratio - 0.5));
    else                   wcScore = Math.round(20 * ratio);
  } else if (target.wordCount > 800) wcScore = 20; // fallback when SERP scrape fails
  breakdown.wordCount = { score: wcScore, max: 20, target: target.wordCount, median, mean: Math.round(mean) };
  // ── 2) Heading structure (15 pts) ──────────────────────────────────────
  let headScore = 0;
  if (target.h1s.length >= 1) headScore += 5;
  if (target.h2s.length >= 3) headScore += 5;
  else if (target.h2s.length >= 1) headScore += Math.floor((target.h2s.length / 3) * 5);
  if (target.h3s.length >= 2) headScore += 5;
  else if (target.h3s.length >= 1) headScore += 2;
  const avgH2 = live.length ? Math.round(live.reduce((a,c)=>a+c.h2s.length,0) / live.length) : 0;
  breakdown.headings = { score: headScore, max: 15, h1: target.h1s.length, h2: target.h2s.length, h3: target.h3s.length, avgH2InSerp: avgH2 };
  // ── 3) LSI / topic coverage (35 pts) ───────────────────────────────────
  const tgtTextLower = (target.title + ' ' + target.metaDesc + ' ' + target.h1s.join(' ') + ' ' + target.h2s.join(' ') + ' ' + target.h3s.join(' ') + ' ' + target.text).toLowerCase();
  const covered = lsiTerms.filter(t => tgtTextLower.includes(String(t).toLowerCase()));
  const missing = lsiTerms.filter(t => !tgtTextLower.includes(String(t).toLowerCase()));
  const lsiScore = lsiTerms.length ? Math.round((covered.length / lsiTerms.length) * 35) : 0;
  breakdown.lsiCoverage = { score: lsiScore, max: 35, covered: covered.length, total: lsiTerms.length, coveredTerms: covered.slice(0, 12), missingTerms: missing.slice(0, 12) };
  // ── 4) FAQ section (10 pts) ────────────────────────────────────────────
  let faqScore = 0;
  if (target.hasFAQSchema) faqScore = 10;
  else if (target.hasFAQ)  faqScore = 7;
  else if (target.faqStyleHeadings >= 1) faqScore = 3;
  const faqInSerp = live.filter(c => c.hasFAQ).length;
  breakdown.faq = { score: faqScore, max: 10, hasSchema: target.hasFAQSchema, hasHeuristic: target.hasFAQ, competitorsWithFAQ: faqInSerp, totalCompetitors: live.length };
  // ── 5) Schema markup (10 pts) ──────────────────────────────────────────
  let schemaScore = 0;
  const richTypes = ['Article','BlogPosting','HowTo','Product','Recipe','Review','VideoObject','Course'];
  if (target.schemaTypes.length >= 1) schemaScore += 5;
  if (target.schemaTypes.some(t => richTypes.includes(t))) schemaScore += 5;
  const schemaInSerp = live.filter(c => c.schemaTypes.length > 0).length;
  breakdown.schema = { score: schemaScore, max: 10, types: target.schemaTypes, competitorsWithSchema: schemaInSerp, totalCompetitors: live.length };
  // ── 6) Title & meta (10 pts) ───────────────────────────────────────────
  let metaScore = 0;
  const kwLower = String(keyword).toLowerCase();
  if (target.title) {
    const len = target.title.length;
    if (len >= 30 && len <= 65 && target.title.toLowerCase().includes(kwLower)) metaScore += 5;
    else if (len >= 20 && target.title.toLowerCase().includes(kwLower)) metaScore += 3;
    else if (target.title.toLowerCase().includes(kwLower)) metaScore += 2;
    else if (len >= 30 && len <= 65) metaScore += 2;
  }
  if (target.metaDesc) {
    const len = target.metaDesc.length;
    if (len >= 120 && len <= 165 && target.metaDesc.toLowerCase().includes(kwLower)) metaScore += 5;
    else if (len >= 70 && target.metaDesc.toLowerCase().includes(kwLower)) metaScore += 3;
    else if (target.metaDesc.toLowerCase().includes(kwLower)) metaScore += 2;
    else if (len >= 120 && len <= 165) metaScore += 2;
  }
  breakdown.titleMeta = { score: metaScore, max: 10, titleLen: target.title.length, metaDescLen: target.metaDesc.length, keywordInTitle: target.title.toLowerCase().includes(kwLower), keywordInMeta: target.metaDesc.toLowerCase().includes(kwLower) };
  const total = Object.values(breakdown).reduce((s,b) => s + b.score, 0);
  return { score: total, max: 100, breakdown };
}

// Per-country pipeline: SERP → scrape → LSI → score. Reused by single + multi.
async function _runScoreForCountry({ keyword, target, country, countryCode }) {
  const serp = await _fetchSerpTopForKeyword(keyword.trim(), countryCode, 10);
  if (!serp.ok) return { ok:false, country, error:'SERP fetch failed: ' + (serp.error || 'unknown') };
  if (!serp.results.length) return { ok:true, country, keyword, score:0, warning:'No SERP results returned for that keyword in this country.', serp };
  const competitors = await Promise.all(serp.results.map(r => _scrapePageForScoring(r.url)));
  let lsiTerms = [];
  let recommendations = [];
  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    const competitorBrief = competitors.filter(c => c.ok).slice(0, 8).map((c) => ({
      rank: serp.results[competitors.indexOf(c)]?.rank || 0,
      domain: serp.results[competitors.indexOf(c)]?.domain || '',
      title: c.title, h1: c.h1s[0] || '',
      h2s: c.h2s.slice(0, 8), h3s: c.h3s.slice(0, 6),
      snippet: c.text.slice(0, 600),
    }));
    const sys = `You are an SEO content strategist. Analyse the SERP-winning pages for a target keyword and extract (a) the 15 most important semantic / LSI terms competitors cover, and (b) 6-8 concrete content recommendations. Output valid JSON only.`;
    const userPrompt = [
      `Target keyword: "${keyword}"`,
      `Country: ${country}`,
      `Target page word count: ${target.wordCount}, H2 count: ${target.h2s.length}, H3 count: ${target.h3s.length}, has FAQ: ${target.hasFAQ}`,
      `Target page title: "${(target.title || '').slice(0, 120)}"`,
      `Target page H2s: ${JSON.stringify(target.h2s.slice(0, 12))}`,
      ``,
      `Competitor SERP-winning pages:`,
      JSON.stringify(competitorBrief, null, 2),
      ``,
      `Respond with this exact JSON shape:`,
      `{`,
      `  "lsiTerms": ["15 specific multi-word semantic terms competitors use that the target should also cover — concrete entities/phrases, not generic words"],`,
      `  "recommendations": [`,
      `    { "category": "Word count|Headings|Topic coverage|FAQ|Schema|Title/Meta|Structure", "priority": "high|medium|low", "action": "concrete action statement", "why": "one-sentence rationale tied to what SERP winners do" }`,
      `  ]`,
      `}`,
      `Recommendations should be specific and actionable, never generic SEO advice.`,
    ].join('\n');
    try {
      const r = await openaiChatWithRetry({
        model:'gpt-4o',
        response_format:{ type:'json_object' },
        messages:[{ role:'system', content: sys }, { role:'user', content: userPrompt }],
        temperature: 0.3,
      });
      const parsed = JSON.parse(r.choices[0].message.content);
      lsiTerms = Array.isArray(parsed.lsiTerms) ? parsed.lsiTerms.slice(0, 20) : [];
      recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 10) : [];
    } catch (_) {
      const allHeadings = competitors.filter(c => c.ok).flatMap(c => [...c.h2s, ...c.h3s]).join(' ');
      const tokens = (allHeadings.toLowerCase().match(/\b[a-z][a-z\-]{4,}\b/g) || []);
      const freq = {};
      tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
      lsiTerms = Object.entries(freq).filter(([t,n]) => n >= 2 && !/^(the|and|for|with|that|this|your|from|will|have|what|when|where|which|their|other|about|more|some|than|into|also|been|like|just|over|very|most|such|many|only|even|need|want)$/.test(t)).sort((a,b) => b[1]-a[1]).slice(0, 15).map(([t]) => t);
    }
  } else {
    const allHeadings = competitors.filter(c => c.ok).flatMap(c => [...c.h2s, ...c.h3s]).join(' ');
    const tokens = (allHeadings.toLowerCase().match(/\b[a-z][a-z\-]{4,}\b/g) || []);
    const freq = {};
    tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    lsiTerms = Object.entries(freq).filter(([t,n]) => n >= 2).sort((a,b) => b[1]-a[1]).slice(0, 15).map(([t]) => t);
  }
  const scored = _scoreContent({ target, competitors, lsiTerms, keyword });
  const competitorSummary = serp.results.map((r, i) => {
    const c = competitors[i] || {};
    return {
      rank: r.rank, url: r.url, domain: r.domain, title: r.title,
      ok: !!c.ok, wordCount: c.wordCount || 0,
      h1: c.h1s?.length || 0, h2: c.h2s?.length || 0, h3: c.h3s?.length || 0,
      hasFAQ: !!c.hasFAQ, hasSchema: (c.schemaTypes?.length || 0) > 0,
      error: c.error || null,
    };
  });
  return {
    ok:true, country, keyword,
    score: scored.score, max: scored.max, breakdown: scored.breakdown,
    lsiTerms, recommendations, competitorSummary,
  };
}

// Hard cap on simultaneous countries per request — frontend trims to 6 by priority,
// but we accept up to 8 here as a safety margin in case a custom client submits more.
const CONTENT_SCORER_MAX_COUNTRIES = 8;

app.post('/api/content-scorer/analyze', async (req, res) => {
  try {
    const { keyword, targetUrl, targetText, country, countries } = req.body || {};
    if (!keyword || typeof keyword !== 'string' || keyword.trim().length < 2) {
      return res.status(400).json({ ok:false, error:'keyword is required' });
    }
    if (!targetUrl && !targetText) {
      return res.status(400).json({ ok:false, error:'Provide either targetUrl or targetText' });
    }
    // Normalise country list — accept string `country` (back-compat) or array `countries`
    let countryList = [];
    if (Array.isArray(countries) && countries.length) countryList = countries;
    else if (typeof country === 'string' && country)  countryList = [country];
    else countryList = ['US'];
    countryList = countryList.map(c => String(c).toUpperCase().trim()).filter((c, i, a) => c && a.indexOf(c) === i);
    if (countryList.length > CONTENT_SCORER_MAX_COUNTRIES) {
      return res.status(400).json({ ok:false, error:`Maximum ${CONTENT_SCORER_MAX_COUNTRIES} countries per run (received ${countryList.length}). Pick a smaller subset.` });
    }
    const unknown = countryList.filter(c => !CONTENT_COUNTRY_CODES[c]);
    if (unknown.length) return res.status(400).json({ ok:false, error:`Unknown country code(s): ${unknown.join(', ')}` });

    // Scrape the user's target page ONCE — same target for every country.
    const targetPromise = targetUrl
      ? _scrapePageForScoring(String(targetUrl).startsWith('http') ? targetUrl : 'https://' + targetUrl)
      : Promise.resolve({ ok:true, url:'(pasted draft)', ..._extractContentSignals(`<html><body>${targetText}</body></html>`, '') });
    const target = await targetPromise;
    if (!target.ok) return res.status(502).json({ ok:false, error: 'Could not scrape target: ' + (target.error || 'unknown') });

    const targetSummary = {
      url: target.url, wordCount: target.wordCount, title: target.title, metaDesc: target.metaDesc,
      h1: target.h1s.length, h2: target.h2s.length, h3: target.h3s.length,
      hasFAQ: target.hasFAQ, hasFAQSchema: target.hasFAQSchema,
      schemaTypes: target.schemaTypes,
      internalLinks: target.internalLinks, externalLinks: target.externalLinks,
    };

    // Run per-country pipelines in parallel.
    const perCountry = await Promise.all(countryList.map(c =>
      _runScoreForCountry({ keyword: keyword.trim(), target, country: c, countryCode: CONTENT_COUNTRY_CODES[c] })
    ));

    res.json({
      ok:true, keyword, multi: countryList.length > 1,
      countries: countryList,
      target: targetSummary,
      results: perCountry,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});
};
