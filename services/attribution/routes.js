// Attribution cohorts/forecast · lookalike routes.
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
  const { _amplitudeFetch, _amplitudeFmtDate, _emptyDailySeries, _fetchGoogleAdsSpendDaily, _fetchMetaSpendDaily, _fetchTikTokSpendDaily, _isoDate, _isoWeekKey, _isoWeekStart, _mergeDailyInto, openaiChatWithRetry } = ctx;

async function _fetchAmplitudeConversionsDaily(days = 90) {
  const apiKey    = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey) return { ok:false, channel:'amplitude', error:'not-configured', daily:[] };
  const auth = 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  try {
    const eventsList = await _amplitudeFetch('/api/2/events/list', auth);
    const all = (eventsList?.data || []).map(e => e.value).filter(Boolean);
    const convPatterns = /signup|sign_up|register|subscribe|subscription|purchase|checkout|conversion|order_completed|paid|new_customer|trial_start|account_created/i;
    const matches = all.filter(e => convPatterns.test(e));
    const start = new Date(); start.setDate(start.getDate() - days);
    const end   = new Date();
    const fmt = _amplitudeFmtDate;
    // Aggregate daily series across up to 5 conversion events
    const byDate = new Map();
    for (const ev of matches.slice(0, 5)) {
      try {
        const e = encodeURIComponent(JSON.stringify({ event_type: ev }));
        const j = await _amplitudeFetch(
          `/api/2/events/segmentation?e=${e}&start=${fmt(start)}&end=${fmt(end)}&m=totals&i=1`,
          auth
        );
        const labels = j?.data?.xValues || [];
        const series = j?.data?.series?.[0] || [];
        labels.forEach((label, i) => {
          // Amplitude returns labels like "20240115" — normalise to YYYY-MM-DD
          const date = label.length === 8 ? `${label.slice(0,4)}-${label.slice(4,6)}-${label.slice(6,8)}` : label;
          const cur = byDate.get(date) || 0;
          byDate.set(date, cur + (Number(series[i]) || 0));
        });
      } catch (_) { /* skip */ }
    }
    const daily = Array.from(byDate.entries())
      .map(([date, conversions]) => ({ date, conversions }))
      .sort((a,b) => a.date.localeCompare(b.date));
    return { ok:true, channel:'amplitude', daily, conversionEvents: matches.slice(0, 5) };
  } catch (e) { return { ok:false, channel:'amplitude', error: e.message, daily:[] }; }
}

app.get('/api/attribution/cohorts', async (req, res) => {
  try {
    const days = Math.min(120, Math.max(14, parseInt(req.query.days, 10) || 84));
    const aov  = Math.max(0, parseFloat(req.query.aov) || 0);
    const [meta, google, tiktok, amp] = await Promise.all([
      _fetchMetaSpendDaily(days),
      _fetchGoogleAdsSpendDaily(days),
      _fetchTikTokSpendDaily(days),
      _fetchAmplitudeConversionsDaily(days),
    ]);
    // Build a unified daily series per channel, with the same date grid
    const grid = _emptyDailySeries(days);
    const series = {
      meta:   _emptyDailySeries(days),
      google: _emptyDailySeries(days),
      tiktok: _emptyDailySeries(days),
    };
    if (meta.ok)   _mergeDailyInto(series.meta,   meta.daily);
    if (google.ok) _mergeDailyInto(series.google, google.daily);
    if (tiktok.ok) _mergeDailyInto(series.tiktok, tiktok.daily);
    // Amplitude → use as ground-truth conversions if available
    const ampDaily = amp.ok ? new Map(amp.daily.map(r => [r.date, r.conversions])) : null;

    // Bucket into ISO weeks
    const weekMap = new Map();
    grid.forEach(g => {
      const wk = _isoWeekKey(g.date);
      if (!weekMap.has(wk)) weekMap.set(wk, {
        week: wk, weekStart: _isoWeekStart(g.date),
        spend:0, conversions:0, revenue:0, clicks:0, impressions:0,
        channels: {
          meta:   { spend:0, conversions:0, revenue:0, clicks:0 },
          google: { spend:0, conversions:0, revenue:0, clicks:0 },
          tiktok: { spend:0, conversions:0, revenue:0, clicks:0 },
        },
        ampConversions: 0, ampDays: 0,
      });
      const w = weekMap.get(wk);
      ['meta','google','tiktok'].forEach(ch => {
        const dayRow = series[ch].find(d => d.date === g.date);
        if (!dayRow) return;
        w.channels[ch].spend       += dayRow.spend;
        w.channels[ch].conversions += dayRow.conversions;
        w.channels[ch].revenue     += dayRow.revenue;
        w.channels[ch].clicks      += dayRow.clicks;
        w.spend       += dayRow.spend;
        w.conversions += dayRow.conversions;
        w.revenue     += dayRow.revenue;
        w.clicks      += dayRow.clicks;
        w.impressions += dayRow.impressions;
      });
      if (ampDaily && ampDaily.has(g.date)) {
        w.ampConversions += ampDaily.get(g.date) || 0;
        w.ampDays += 1;
      }
    });

    const usingAmp = !!ampDaily && Array.from(weekMap.values()).some(w => w.ampConversions > 0);
    const weeks = Array.from(weekMap.values())
      .sort((a,b) => a.weekStart.localeCompare(b.weekStart))
      .map(w => {
        const conv = usingAmp ? w.ampConversions : w.conversions;
        const rev  = w.revenue || (aov > 0 ? conv * aov : 0);
        return {
          week: w.week,
          weekStart: w.weekStart,
          spend:       +w.spend.toFixed(2),
          conversions: +conv.toFixed(2),
          revenue:     +rev.toFixed(2),
          clicks:      w.clicks,
          impressions: w.impressions,
          roas: w.spend > 0 ? +(rev / w.spend).toFixed(2) : null,
          cac:  conv > 0 ? +(w.spend / conv).toFixed(2) : null,
          channels: w.channels,
        };
      })
      // Drop the trailing week if it's the partial current week with zero data
      .filter(w => w.spend > 0 || w.conversions > 0);

    // Compute trend deltas (latest vs previous full week) for the headline
    let trend = null;
    if (weeks.length >= 2) {
      const last = weeks[weeks.length - 1];
      const prev = weeks[weeks.length - 2];
      trend = {
        spendDelta:       prev.spend ? +(((last.spend - prev.spend) / prev.spend) * 100).toFixed(1) : null,
        conversionsDelta: prev.conversions ? +(((last.conversions - prev.conversions) / prev.conversions) * 100).toFixed(1) : null,
        roasDelta:        (last.roas != null && prev.roas) ? +((last.roas - prev.roas)).toFixed(2) : null,
        cacDelta:         (last.cac  != null && prev.cac ) ? +((last.cac  - prev.cac )).toFixed(2) : null,
      };
    }

    res.json({
      ok:true, days, aov,
      conversionSource: usingAmp ? 'amplitude' : 'ad-platform',
      weeks, trend,
      channelStatus: { meta: meta.ok, google: google.ok, tiktok: tiktok.ok, amplitude: amp.ok },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get('/api/attribution/forecast', async (req, res) => {
  try {
    const days    = Math.min(90, Math.max(14, parseInt(req.query.days,    10) || 30));
    const horizon = Math.min(60, Math.max(7,  parseInt(req.query.horizon, 10) || 30));
    const aov     = Math.max(0, parseFloat(req.query.aov) || 0);
    const [meta, google, tiktok, amp] = await Promise.all([
      _fetchMetaSpendDaily(days),
      _fetchGoogleAdsSpendDaily(days),
      _fetchTikTokSpendDaily(days),
      _fetchAmplitudeConversionsDaily(days),
    ]);
    const grid = _emptyDailySeries(days);
    if (meta.ok)   _mergeDailyInto(grid, meta.daily);
    if (google.ok) _mergeDailyInto(grid, google.daily);
    if (tiktok.ok) _mergeDailyInto(grid, tiktok.daily);
    const ampDaily = amp.ok ? new Map(amp.daily.map(r => [r.date, r.conversions])) : null;
    if (ampDaily) {
      grid.forEach(g => { if (ampDaily.has(g.date)) g.conversions = ampDaily.get(g.date) || 0; });
    }
    grid.forEach(g => { if (g.revenue === 0 && aov > 0) g.revenue = g.conversions * aov; });
    // Drop today if it's the partial day with zero data — avoids dragging
    // the trend line down with a half-hour of incomplete reporting.
    const today = _isoDate(Date.now());
    const series = grid[grid.length - 1].date === today && grid[grid.length - 1].spend === 0
      ? grid.slice(0, -1)
      : grid;
    if (series.length < 7) {
      return res.json({ ok:true, days, horizon, aov, actual:series, forecast:[], summary:null,
        warning:'Need at least 7 days of historical data for a meaningful forecast.',
        channelStatus:{ meta:meta.ok, google:google.ok, tiktok:tiktok.ok, amplitude:amp.ok }, generatedAt:new Date().toISOString() });
    }
    // Linear least-squares per metric, with an EMA-smoothed baseline so a
    // single anomalous day doesn't dominate the projection.
    function trendForecast(values) {
      const n = values.length;
      const xs = values.map((_,i) => i);
      const meanX = xs.reduce((a,b)=>a+b,0) / n;
      const meanY = values.reduce((a,b)=>a+b,0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i]-meanX)*(values[i]-meanY); den += (xs[i]-meanX)**2; }
      const slope = den === 0 ? 0 : num / den;
      const intercept = meanY - slope * meanX;
      // EMA baseline (alpha=0.3) to anchor the projection to recent reality
      let ema = values[0];
      for (let i = 1; i < n; i++) ema = 0.3 * values[i] + 0.7 * ema;
      // Std dev of residuals → confidence band
      const residuals = values.map((v,i) => v - (intercept + slope*i));
      const variance = residuals.reduce((a,b) => a + b*b, 0) / n;
      const sd = Math.sqrt(variance);
      const project = (i) => {
        const trendVal = intercept + slope * (n + i);
        const blended  = 0.6 * trendVal + 0.4 * ema;  // anchor toward EMA
        return Math.max(0, blended);
      };
      return { project, slope, sd, ema, mean: meanY };
    }
    const spendF = trendForecast(series.map(d => d.spend));
    const convF  = trendForecast(series.map(d => d.conversions));
    const revF   = trendForecast(series.map(d => d.revenue));
    const forecast = [];
    const lastDate = new Date(series[series.length-1].date + 'T00:00:00Z');
    for (let i = 1; i <= horizon; i++) {
      const d = new Date(lastDate); d.setUTCDate(lastDate.getUTCDate() + i);
      const sp = spendF.project(i);
      const cv = convF.project(i);
      const rv = revF.project(i);
      forecast.push({
        date: _isoDate(d),
        spend:        +sp.toFixed(2),
        spendLow:     +Math.max(0, sp - spendF.sd).toFixed(2),
        spendHigh:    +(sp + spendF.sd).toFixed(2),
        conversions:  +cv.toFixed(2),
        convLow:      +Math.max(0, cv - convF.sd).toFixed(2),
        convHigh:     +(cv + convF.sd).toFixed(2),
        revenue:      +rv.toFixed(2),
      });
    }
    const projSpend = forecast.reduce((s,f) => s + f.spend, 0);
    const projConv  = forecast.reduce((s,f) => s + f.conversions, 0);
    const projRev   = forecast.reduce((s,f) => s + f.revenue, 0);
    const trailingSpend = series.reduce((s,f) => s + f.spend, 0);
    const trailingConv  = series.reduce((s,f) => s + f.conversions, 0);
    const summary = {
      avgDailySpend:        +(trailingSpend / series.length).toFixed(2),
      avgDailyConversions:  +(trailingConv  / series.length).toFixed(2),
      projSpend:        +projSpend.toFixed(2),
      projConversions:  +projConv.toFixed(2),
      projRevenue:      +projRev.toFixed(2),
      projROAS: projSpend > 0 ? +(projRev / projSpend).toFixed(2) : null,
      projCAC:  projConv  > 0 ? +(projSpend / projConv).toFixed(2) : null,
      trendDirection: spendF.slope > 0.5 ? 'up' : (spendF.slope < -0.5 ? 'down' : 'flat'),
      conversionsTrend: convF.slope > 0.05 ? 'up' : (convF.slope < -0.05 ? 'down' : 'flat'),
    };
    res.json({
      ok:true, days, horizon, aov,
      conversionSource: ampDaily ? 'amplitude' : 'ad-platform',
      actual: series,
      forecast,
      summary,
      channelStatus: { meta: meta.ok, google: google.ok, tiktok: tiktok.ok, amplitude: amp.ok },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOOKALIKE AUDIENCE BUILDER
// Generates platform-ready lookalike audience specs (Meta LLA / Google Customer
// Match / TikTok LLA) from a seed (competitor domain, audience description, or
// existing customer profile). Uses DataForSEO competitor signals when seedType
// is 'competitor', then OpenAI to compose structured audience specs.
// ─────────────────────────────────────────────────────────────────────────────
async function _seedSignalsFromCompetitor(domain) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { ok:false, error:'DataForSEO not configured' };
  const auth = 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
  try {
    const r = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
      method:'POST',
      headers:{ 'Authorization': auth, 'Content-Type':'application/json' },
      body: JSON.stringify([{ target: domain, location_code: 2840, language_code: 'en', limit: 30 }]),
    });
    const j = await r.json();
    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    const keywords = items.map(it => ({
      keyword: it.keyword_data?.keyword,
      volume:  it.keyword_data?.keyword_info?.search_volume,
      intent:  it.keyword_data?.search_intent_info?.main_intent,
    })).filter(k => k.keyword).slice(0, 25);
    return { ok:true, domain, topKeywords: keywords };
  } catch (e) { return { ok:false, error: e.message }; }
}

app.post('/api/lookalike/generate', async (req, res) => {
  try {
    const {
      seedType = 'description',           // 'competitor' | 'description' | 'customer-profile'
      seedValue = '',                     // domain | text | profile JSON
      platforms = ['meta','google','tiktok'],
      country = 'US',
      lookalikeSize = '1%',               // Meta LLA size (1%-10%)
      excludeExistingCustomers = true,
      additionalContext = '',
    } = req.body || {};
    if (!seedValue || typeof seedValue !== 'string') {
      return res.status(400).json({ ok:false, error:'seedValue is required' });
    }
    let signals = null;
    if (seedType === 'competitor') {
      const domain = seedValue.replace(/^https?:\/\//,'').replace(/\/.*$/,'').trim();
      signals = await _seedSignalsFromCompetitor(domain);
    }
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ ok:false, error:'OpenAI is not configured. Add the OpenAI integration in Settings → Integrations to enable AI-generated audiences.' });
    }
    const sys = `You are a senior paid-media strategist who builds lookalike audience specifications for Meta, Google, and TikTok ad platforms. Output must be valid JSON only — no prose.`;
    const userPrompt = [
      `Build lookalike audience specifications for these platforms: ${platforms.join(', ')}.`,
      `Country: ${country}`,
      `Lookalike size: ${lookalikeSize} (Meta LLA size scale)`,
      `Exclude existing customers: ${excludeExistingCustomers}`,
      `Seed type: ${seedType}`,
      `Seed value: ${seedValue}`,
      signals ? `Competitor SERP signals (top organic keywords, volume, intent):\n${JSON.stringify(signals.topKeywords?.slice(0,15) || [], null, 2)}` : '',
      additionalContext ? `Additional context: ${additionalContext}` : '',
      ``,
      `Respond with this exact JSON shape:`,
      `{`,
      `  "summary": "1-2 sentence persona summary of the lookalike target",`,
      `  "demographics": { "ageRange": "25-44", "genders": ["..."], "incomeBand": "...", "education": "...", "languages": ["..."] },`,
      `  "geo": { "primaryCountry": "${country}", "topCities": ["..."], "exclusions": ["..."] },`,
      `  "interests":   ["12-18 specific interests/topics scraped to Meta-sized strings"],`,
      `  "behaviors":   ["8-12 buyer behaviors / life-events / purchase signals"],`,
      `  "jobTitles":   ["8-12 likely job titles or roles, if applicable"],`,
      `  "industries":  ["6-10 industries"],`,
      `  "intentKeywords": ["10-15 high-intent search/browsing keywords"],`,
      `  "platforms": {`,
      `    "meta":   { "audienceName":"...", "sourceAudienceSuggestion":"Pixel: Purchasers (180d)", "lookalikeSize":"${lookalikeSize}", "detailedTargeting": { "interests":[...], "behaviors":[...], "demographics":[...] }, "exclusions":[...], "estReachM": 4.2, "uploadInstructions":"step-by-step" },`,
      `    "google": { "audienceName":"...", "matchType":"Customer Match", "uploadFormat":"CSV (email_sha256, phone_sha256, first_name, last_name, country, postal_code)", "sampleHeaders":["email_sha256","phone_sha256","first_name","last_name","country","zip"], "similarAudienceTopics":[...], "inMarketSegments":[...], "uploadInstructions":"step-by-step" },`,
      `    "tiktok": { "audienceName":"...", "lookalikeMode":"Balanced", "seedAudienceSuggestion":"Past-180-day purchasers", "interestCategories":[...], "behaviors":[...], "creators":[...], "uploadInstructions":"step-by-step" }`,
      `  },`,
      `  "seedExamples": [ { "persona":"...", "demographics":"...", "channels":["..."], "buyingTrigger":"..." }, ... 5 entries ],`,
      `  "estimatedSize": { "low": 800000, "mid": 1500000, "high": 2400000 },`,
      `  "warnings":  ["any compliance/quality risks like PII handling, small seed risk, etc"]`,
      `}`,
      `Be specific and concrete. Use real platform-recognised category names where possible (e.g. Meta detailed targeting names like "Engaged shoppers", "Online shopping").`,
    ].filter(Boolean).join('\n');
    const r = await openaiChatWithRetry({
      model: 'gpt-4o',
      messages: [
        { role:'system', content: sys },
        { role:'user',   content: userPrompt },
      ],
      response_format: { type:'json_object' },
      max_tokens: 2400,
      temperature: 0.6,
    });
    let spec = {};
    try { spec = JSON.parse(r.choices[0].message.content); }
    catch (e) { return res.status(500).json({ ok:false, error:'Model returned invalid JSON', raw: r.choices[0].message.content?.slice(0,500) }); }
    res.json({ ok:true, spec, signals: signals?.ok ? signals : null, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Export a lookalike spec to a CSV-like text payload for the requested platform.
app.post('/api/lookalike/export', async (req, res) => {
  try {
    const { spec = {}, platform = 'meta' } = req.body || {};
    if (!spec || typeof spec !== 'object') return res.status(400).json({ ok:false, error:'spec required' });
    const lines = [];
    if (platform === 'google') {
      const gp = spec.platforms?.google || {};
      lines.push('# Google Customer Match upload template');
      lines.push('# Hash email + phone with SHA-256 before uploading. Lowercase emails, E.164 phones.');
      lines.push((gp.sampleHeaders || ['email_sha256','phone_sha256','first_name','last_name','country','zip']).join(','));
      const examples = spec.seedExamples || [];
      examples.forEach((p,i) => lines.push(`<sha256(email_${i+1})>,<sha256(phone_${i+1})>,First${i+1},Last${i+1},${(spec.geo?.primaryCountry || 'US')},`));
    } else if (platform === 'tiktok') {
      const tp = spec.platforms?.tiktok || {};
      lines.push(`# TikTok LLA seed audience: ${tp.audienceName || ''}`);
      lines.push(`# Mode: ${tp.lookalikeMode || 'Balanced'}`);
      lines.push('email,phone,IDFA,GAID,country');
      const examples = spec.seedExamples || [];
      examples.forEach((p,i) => lines.push(`seed${i+1}@example.com,+15555550${100+i},,,${(spec.geo?.primaryCountry || 'US')}`));
    } else {
      const mp = spec.platforms?.meta || {};
      lines.push(`# Meta Lookalike Audience: ${mp.audienceName || ''}`);
      lines.push(`# Source: ${mp.sourceAudienceSuggestion || 'Pixel: Purchasers (180d)'}`);
      lines.push(`# LLA size: ${mp.lookalikeSize || '1%'}`);
      lines.push('email,phone,fn,ln,country,zip,city,state,dob');
      const examples = spec.seedExamples || [];
      examples.forEach((p,i) => lines.push(`seed${i+1}@example.com,+15555550${100+i},First${i+1},Last${i+1},${(spec.geo?.primaryCountry || 'US')},,,,`));
    }
    res.json({ ok:true, platform, csv: lines.join('\n'), filename: `lookalike-${platform}-${Date.now()}.csv` });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});
};
