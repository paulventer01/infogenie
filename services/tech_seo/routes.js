// Outreach sequence · traffic projection · tech SEO routes.
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
  const { openai } = ctx;

app.post('/api/generate-outreach-sequence', async (req, res) => {
  try {
    const { site, url, type, angle, domain, industry, senderName = 'The Team' } = req.body;
    const prompt = `You are an expert link-building outreach specialist. Write a 3-email outreach sequence for acquiring a backlink.

Target site: ${site} (${url})
Link type: ${type}
Outreach angle: ${angle}
Our domain: ${domain}
Our industry: ${industry}
Sender name: ${senderName}

Write 3 emails:
1. Initial outreach (friendly, specific, value-first, under 150 words)
2. Follow-up after 5 days (reference first email, add new value, under 100 words)
3. Final follow-up after 10 days (last try, make it easy to say yes, under 80 words)

For each email provide:
- subject: email subject line
- body: email body (plain text, no HTML)
- delay_days: when to send (0, 5, 10)

Return a JSON object with an "emails" array of 3 objects with fields: subject, body, delay_days.
Return ONLY valid JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1400,
      temperature: 0.6,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    res.json({ emails: parsed.emails || [] });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Traffic Projection ─────────────────────────────────────────────────────────
app.post('/api/traffic-projection', async (req, res) => {
  try {
    const { domain, industry, articlesPublished = 0, backlinksSecured = 0, keywords = [] } = req.body;
    const topKws = keywords.slice(0, 5).map(k => k.keyword || k).join(', ') || industry;
    const prompt = `You are an SEO traffic analyst. Generate a realistic 90-day organic traffic projection for ${domain} in the ${industry} industry.

Context:
- Articles published/planned: ${articlesPublished}
- Backlinks secured/in progress: ${backlinksSecured}
- Target keywords: ${topKws}

Provide:
1. baseline_monthly: estimated current monthly organic visits (realistic for the domain stage)
2. projected_monthly_30d: projected at 30 days
3. projected_monthly_60d: projected at 60 days  
4. projected_monthly_90d: projected at 90 days
5. growth_pct_90d: total % growth over 90 days
6. keyword_rankings: array of 5 objects each with { keyword, current_position, projected_position_90d, monthly_volume }
7. top_opportunities: array of 3 strings describing the biggest traffic opportunities
8. da_improvement: estimated domain authority improvement (number, e.g. +4)
9. monthly_breakdown: array of 3 objects each with { month, articles_impact_pct, backlinks_impact_pct, total_traffic }

Return a JSON object. Return ONLY valid JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.4,
      response_format: { type: 'json_object' }
    });
    const data = JSON.parse(completion.choices[0]?.message?.content || '{}');
    res.json(data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TECHNICAL SUITE ──────────────────────────────────────────────────────────
// Three real audits that fetch the live site and analyse its HTML/headers.
// All three use native fetch + regex (no extra deps) for fast, reliable checks.

function _normUrl(u) {
  let s = String(u || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).toString(); } catch(_) { return null; }
}

async function _fetchSite(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect:'follow', signal:ctl.signal, headers:{ 'User-Agent':'Mozilla/5.0 (compatible; InfoGenieBot/1.0)' } });
    const html = await r.text();
    return { ok:true, status:r.status, finalUrl:r.url, html, headers:Object.fromEntries(r.headers.entries()), bytes:html.length, ms:Date.now()-t0 };
  } catch(e) {
    return { ok:false, error:e.message, ms:Date.now()-t0 };
  } finally { clearTimeout(timer); }
}

// ── POST /api/tech-site-health ────────────────────────────────────────────────
app.post('/api/tech-site-health', async (req, res) => {
  try {
    const url = _normUrl(req.body?.domain || req.body?.url);
    if (!url) return res.status(400).json({ ok:false, error:'Invalid URL' });
    const f = await _fetchSite(url);
    if (!f.ok) return res.json({ ok:true, url, reachable:false, error:f.error, score:0, checks:[] });
    const html = f.html;
    const headers = f.headers;
    const isHttps = f.finalUrl.startsWith('https://');
    const hasHsts = !!headers['strict-transport-security'];
    const hasCsp  = !!headers['content-security-policy'];
    const hasXfo  = !!headers['x-frame-options'];
    const hasXcto = !!headers['x-content-type-options'];
    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    const hasLang = /<html[^>]+lang=/i.test(html);
    const hasCharset = /<meta[^>]+charset=/i.test(html);
    const hasFavicon = /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html);
    const imgs = html.match(/<img[^>]+>/gi) || [];
    const imgsNoAlt = imgs.filter(t => !/\salt=/i.test(t)).length;
    const compressedHint = (headers['content-encoding']||'').match(/gzip|br|deflate/i);
    const sizeKB = Math.round(f.bytes/1024);
    const inlineScripts = (html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
    const externalScripts = (html.match(/<script[^>]+src=/gi) || []).length;
    const renderBlockingCss = (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || []).filter(t => !/media=["']print["']/i.test(t) && !/\bdefer\b|\basync\b/i.test(t)).length;

    const checks = [
      { id:'https',    label:'HTTPS enabled',                pass:isHttps,        sev:isHttps?'ok':'high',    fix:'Migrate to HTTPS — Google ranks HTTPS-only and most browsers warn users on HTTP.' },
      { id:'status',   label:`HTTP status ${f.status}`,      pass:f.status<400,   sev:f.status<400?'ok':'high',fix:`Server returned ${f.status}. Investigate server config or restore the page.` },
      { id:'speed',    label:`TTFB ~${f.ms}ms`,              pass:f.ms<1500,      sev:f.ms<1500?'ok':f.ms<3000?'med':'high', fix:'Aim for <1.5s. Add CDN, enable caching, optimise server response time.' },
      { id:'size',     label:`HTML size ${sizeKB} KB`,       pass:sizeKB<300,     sev:sizeKB<300?'ok':sizeKB<700?'med':'high', fix:'Large HTML hurts mobile performance. Strip unused markup, lazy-load below-the-fold content.' },
      { id:'gzip',     label:'Compression enabled',          pass:!!compressedHint,sev:compressedHint?'ok':'med', fix:'Enable Brotli or Gzip on your server to cut payload by ~70%.' },
      { id:'viewport', label:'Mobile viewport meta',         pass:hasViewport,    sev:hasViewport?'ok':'high', fix:'Add <meta name="viewport" content="width=device-width,initial-scale=1"> for mobile rendering.' },
      { id:'lang',     label:'<html lang> attribute',        pass:hasLang,        sev:hasLang?'ok':'med',     fix:'Add lang="en" (or your locale) to <html> for accessibility & SEO.' },
      { id:'charset',  label:'Charset declared',             pass:hasCharset,     sev:hasCharset?'ok':'low',  fix:'Add <meta charset="utf-8"> in the first 1024 bytes of <head>.' },
      { id:'favicon',  label:'Favicon link present',         pass:hasFavicon,     sev:hasFavicon?'ok':'low',  fix:'Add a <link rel="icon"> for browser tabs and brand recognition.' },
      { id:'alt',      label:`Images without alt: ${imgsNoAlt}/${imgs.length}`, pass:imgsNoAlt===0, sev:imgsNoAlt===0?'ok':imgsNoAlt<3?'med':'high', fix:'Add descriptive alt="" to every <img> for accessibility, SEO and AI indexing.' },
      { id:'render',   label:`Render-blocking CSS: ${renderBlockingCss}`, pass:renderBlockingCss<3, sev:renderBlockingCss<3?'ok':'med', fix:'Inline critical CSS, defer non-critical with media="print" + onload swap.' },
      { id:'scripts',  label:`Scripts: ${inlineScripts} inline / ${externalScripts} external`, pass:externalScripts<15, sev:externalScripts<15?'ok':externalScripts<25?'med':'high', fix:'Reduce JS budget. Remove unused tags, defer/async non-critical scripts, lazy-load 3rd parties.' },
      { id:'hsts',     label:'HSTS header',                  pass:hasHsts,        sev:hasHsts?'ok':'med',     fix:'Add Strict-Transport-Security header to enforce HTTPS at the browser level.' },
      { id:'csp',      label:'Content-Security-Policy',      pass:hasCsp,         sev:hasCsp?'ok':'low',      fix:'Add a CSP header to mitigate XSS — start with report-only mode.' },
      { id:'xfo',      label:'X-Frame-Options',              pass:hasXfo,         sev:hasXfo?'ok':'low',      fix:'Add X-Frame-Options: SAMEORIGIN to prevent clickjacking.' },
      { id:'xcto',     label:'X-Content-Type-Options',       pass:hasXcto,        sev:hasXcto?'ok':'low',     fix:'Add X-Content-Type-Options: nosniff to block MIME-type sniffing.' },
    ];
    const passed = checks.filter(c => c.pass).length;
    const score = Math.round(passed / checks.length * 100);
    const fixes = checks.filter(c => !c.pass).sort((a,b) => ({high:0,med:1,low:2}[a.sev]) - ({high:0,med:1,low:2}[b.sev]));
    res.json({ ok:true, url, reachable:true, status:f.status, ttfbMs:f.ms, sizeKB, score, passed, total:checks.length, checks, fixes });
  } catch(err) {
    console.error('/api/tech-site-health error:', err);
    res.status(500).json({ ok:false, error:err.message });
  }
});

// ── POST /api/tech-crawlability ───────────────────────────────────────────────
app.post('/api/tech-crawlability', async (req, res) => {
  try {
    const url = _normUrl(req.body?.domain || req.body?.url);
    if (!url) return res.status(400).json({ ok:false, error:'Invalid URL' });
    const origin = new URL(url).origin;
    const [home, robots, sitemap] = await Promise.all([
      _fetchSite(url),
      _fetchSite(origin + '/robots.txt'),
      _fetchSite(origin + '/sitemap.xml'),
    ]);

    const robotsTxt = robots.ok && robots.status<400 ? robots.html : '';
    const robotsExists = !!robotsTxt;
    const robotsAllowsBots = robotsExists ? !/User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(robotsTxt) : true;
    const sitemapInRobots = /sitemap:/i.test(robotsTxt);
    const sitemapExists = sitemap.ok && sitemap.status<400 && /<urlset|<sitemapindex/i.test(sitemap.html||'');
    const sitemapUrlCount = sitemapExists ? (sitemap.html.match(/<loc>/gi) || []).length : 0;

    const html = home.ok ? home.html : '';
    const robotsMeta = (html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)||[])[1] || '';
    const isNoindex = /noindex/i.test(robotsMeta);
    const isNofollow = /nofollow/i.test(robotsMeta);
    const xRobots = (home.headers && home.headers['x-robots-tag']) || '';
    const headerNoindex = /noindex/i.test(xRobots);
    const internalLinks = (html.match(/<a[^>]+href=["']([^"']+)["']/gi) || [])
      .map(t => (t.match(/href=["']([^"']+)["']/i)||[])[1])
      .filter(h => h && !/^(mailto:|tel:|javascript:|#)/i.test(h))
      .filter(h => h.startsWith('/') || h.includes(new URL(url).hostname));
    const externalLinks = (html.match(/<a[^>]+href=["']https?:\/\/[^"']+["']/gi) || [])
      .filter(t => !t.includes(new URL(url).hostname)).length;
    const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
    const canonicalHref = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)||[])[1] || '';
    const renderBlockingJs = (html.match(/<script[^>]+src=/gi) || []).filter(t => !/\bdefer\b|\basync\b/i.test(t)).length;

    const checks = [
      { id:'reachable',  label:home.ok?`Homepage reachable (${home.status})`:'Homepage NOT reachable', pass:home.ok && home.status<400, sev:home.ok?'ok':'high', fix:'Bots cannot crawl an unreachable page. Investigate hosting, DNS or firewall blocks.' },
      { id:'robots',     label:robotsExists?'robots.txt found':'robots.txt missing',   pass:robotsExists,        sev:robotsExists?'ok':'med', fix:'Add /robots.txt — even an empty one. It tells bots what they can crawl.' },
      { id:'robotsAllow',label:robotsAllowsBots?'robots.txt allows bots':'robots.txt blocks all bots', pass:robotsAllowsBots, sev:robotsAllowsBots?'ok':'high', fix:'Your robots.txt has "Disallow: /" — this hides your entire site from search engines.' },
      { id:'sitemap',    label:sitemapExists?`sitemap.xml found (${sitemapUrlCount} URLs)`:'sitemap.xml missing', pass:sitemapExists, sev:sitemapExists?'ok':'high', fix:'Generate /sitemap.xml listing every indexable URL. Submit it in Google Search Console.' },
      { id:'sitemapRef', label:sitemapInRobots?'Sitemap referenced in robots.txt':'Sitemap NOT in robots.txt', pass:sitemapInRobots, sev:sitemapInRobots?'ok':'med', fix:'Add "Sitemap: https://yourdomain.com/sitemap.xml" to robots.txt for bot discovery.' },
      { id:'noindex',    label:isNoindex?'⚠ Page has noindex meta':'No noindex meta', pass:!isNoindex,           sev:isNoindex?'high':'ok',   fix:'Remove <meta name="robots" content="noindex"> — this hides the page from search results.' },
      { id:'xrobots',    label:headerNoindex?'⚠ X-Robots-Tag: noindex':'X-Robots-Tag clean',           pass:!headerNoindex,         sev:headerNoindex?'high':'ok',fix:'Server is sending X-Robots-Tag: noindex. Remove it from your hosting/CDN config.' },
      { id:'nofollow',   label:isNofollow?'⚠ Page has nofollow meta':'No nofollow meta', pass:!isNofollow,         sev:isNofollow?'med':'ok',  fix:'Remove nofollow — it tells bots to ignore every link on the page.' },
      { id:'canonical',  label:hasCanonical?`Canonical → ${canonicalHref.slice(0,60)}`:'No canonical link',       pass:hasCanonical,         sev:hasCanonical?'ok':'med', fix:'Add <link rel="canonical" href="..."> to prevent duplicate-content dilution.' },
      { id:'internal',   label:`Internal links: ${internalLinks.length}`,   pass:internalLinks.length>=10,        sev:internalLinks.length>=10?'ok':internalLinks.length>=3?'med':'high', fix:'Bots discover pages through internal links. Add a clear nav, footer links, related-posts.' },
      { id:'external',   label:`External links: ${externalLinks}`,          pass:externalLinks<50,                 sev:externalLinks<50?'ok':'low', fix:'Excessive outbound links can leak link equity. Audit and add rel="nofollow" where appropriate.' },
      { id:'renderBlock',label:`Render-blocking JS: ${renderBlockingJs}`,   pass:renderBlockingJs<5,               sev:renderBlockingJs<5?'ok':'med', fix:'Add async/defer to non-critical <script> tags so bots can render the page faster.' },
    ];
    const passed = checks.filter(c => c.pass).length;
    const score = Math.round(passed / checks.length * 100);
    const fixes = checks.filter(c => !c.pass).sort((a,b) => ({high:0,med:1,low:2}[a.sev]) - ({high:0,med:1,low:2}[b.sev]));
    res.json({ ok:true, url, score, passed, total:checks.length, checks, fixes,
      robots:{ exists:robotsExists, allowsBots:robotsAllowsBots, hasSitemap:sitemapInRobots, sample:robotsTxt.slice(0,400) },
      sitemap:{ exists:sitemapExists, urlCount:sitemapUrlCount } });
  } catch(err) {
    console.error('/api/tech-crawlability error:', err);
    res.status(500).json({ ok:false, error:err.message });
  }
});

// ── POST /api/tech-index-signals ──────────────────────────────────────────────
app.post('/api/tech-index-signals', async (req, res) => {
  try {
    const url = _normUrl(req.body?.domain || req.body?.url);
    if (!url) return res.status(400).json({ ok:false, error:'Invalid URL' });
    const f = await _fetchSite(url);
    if (!f.ok) return res.json({ ok:true, url, reachable:false, error:f.error, score:0, checks:[] });
    const html = f.html;
    const title = (html.match(/<title>([^<]*)<\/title>/i)||[])[1]?.trim() || '';
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)||[])[1]?.trim() || '';
    const h1s = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || []).map(t => t.replace(/<[^>]+>/g,'').trim()).filter(Boolean);
    const h2s = (html.match(/<h2\b[^>]*>/gi) || []).length;
    const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)||[])[1] || '';
    const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
    const ogImage = /<meta[^>]+property=["']og:image["']/i.test(html);
    const ogDesc  = /<meta[^>]+property=["']og:description["']/i.test(html);
    const twitter = /<meta[^>]+name=["']twitter:card["']/i.test(html);
    const hreflang = (html.match(/<link[^>]+hreflang=/gi) || []).length;
    const ldJson = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    const schemaTypes = ldJson.map(b => {
      const json = b.replace(/<script[^>]*>|<\/script>/gi,'').trim();
      try { const o = JSON.parse(json); const t = o['@type'] || (Array.isArray(o)?o.map(x=>x['@type']).join(','):''); return Array.isArray(t)?t.join(','):t; } catch(_) { return ''; }
    }).filter(Boolean);
    const robotsMeta = (html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)||[])[1] || '';
    const isIndexable = !/noindex/i.test(robotsMeta) && !/noindex/i.test(f.headers['x-robots-tag']||'');
    const titleLen = title.length;
    const descLen  = metaDesc.length;
    const wordCount = (html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').match(/\b\w+\b/g) || []).length;

    const checks = [
      { id:'indexable', label:isIndexable?'Page is indexable':'⚠ Page blocks indexing',       pass:isIndexable,                sev:isIndexable?'ok':'high', fix:'Remove noindex from meta robots and X-Robots-Tag header so search engines & AI can index this page.' },
      { id:'title',     label:title?`Title (${titleLen} chars): ${title.slice(0,60)}`:'Missing <title>', pass:title && titleLen>=20 && titleLen<=70, sev:!title?'high':titleLen<20||titleLen>70?'med':'ok', fix:'Title should be 30-65 chars, keyword-rich, and unique per page.' },
      { id:'desc',      label:metaDesc?`Meta description (${descLen} chars)`:'Missing meta description', pass:metaDesc && descLen>=80 && descLen<=160, sev:!metaDesc?'high':descLen<80||descLen>160?'med':'ok', fix:'Meta description should be 120-155 chars, summarising the page and inviting clicks.' },
      { id:'h1',        label:h1s.length===1?`Single H1: ${h1s[0].slice(0,60)}`:`H1 count: ${h1s.length}`, pass:h1s.length===1, sev:h1s.length===1?'ok':h1s.length===0?'high':'med', fix:'Use exactly one <h1> per page — it signals the page topic to search & AI engines.' },
      { id:'h2',        label:`H2 count: ${h2s}`,                 pass:h2s>=2,                       sev:h2s>=2?'ok':h2s>=1?'med':'high', fix:'Add H2 subheadings to structure your content for both readers and AI crawlers.' },
      { id:'words',     label:`Word count: ${wordCount}`,        pass:wordCount>=300,               sev:wordCount>=300?'ok':wordCount>=150?'med':'high', fix:'Pages with <300 words are often classified as thin content. Add depth, examples, FAQs.' },
      { id:'canonical', label:canonical?'Canonical link present':'No canonical',                    pass:!!canonical,                  sev:canonical?'ok':'med', fix:'Add <link rel="canonical"> to prevent duplicate-content issues across URL variations.' },
      { id:'og',        label:`Open Graph: ${[ogTitle&&'title',ogDesc&&'desc',ogImage&&'image'].filter(Boolean).join(', ')||'none'}`, pass:ogTitle&&ogDesc&&ogImage, sev:(ogTitle&&ogDesc&&ogImage)?'ok':'med', fix:'Add og:title, og:description, og:image — used by social platforms and AI link previews.' },
      { id:'twitter',   label:twitter?'Twitter Card present':'No Twitter Card',                     pass:twitter,                      sev:twitter?'ok':'low', fix:'Add <meta name="twitter:card" content="summary_large_image"> for X/Twitter previews.' },
      { id:'schema',    label:schemaTypes.length?`Schema: ${schemaTypes.slice(0,3).join(', ')}`:'No JSON-LD schema', pass:schemaTypes.length>=1, sev:schemaTypes.length>=1?'ok':'high', fix:'Add JSON-LD schema (Organization, FAQ, Article) — boosts rich-result eligibility & AI citation rates.' },
      { id:'hreflang',  label:hreflang?`hreflang tags: ${hreflang}`:'No hreflang',                  pass:true,                         sev:'ok', fix:'Add hreflang only if you serve multiple languages/regions.' },
    ];
    const passed = checks.filter(c => c.pass).length;
    const score = Math.round(passed / checks.length * 100);
    const fixes = checks.filter(c => !c.pass).sort((a,b) => ({high:0,med:1,low:2}[a.sev]) - ({high:0,med:1,low:2}[b.sev]));
    res.json({ ok:true, url, reachable:true, score, passed, total:checks.length, checks, fixes,
      meta:{ title, titleLen, metaDesc, descLen, h1Count:h1s.length, h2Count:h2s, wordCount, schemaTypes, canonical, indexable:isIndexable } });
  } catch(err) {
    console.error('/api/tech-index-signals error:', err);
    res.status(500).json({ ok:false, error:err.message });
  }
});
};
