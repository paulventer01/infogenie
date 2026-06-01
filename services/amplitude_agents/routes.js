// Amplitude agents · content fact-check routes.
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
  const { _amplitudeAuthOrError, _amplitudeFetch, _amplitudeFmtDate, openai, openaiChatWithRetry } = ctx;

function _amp403Hint() {
  return 'Your Amplitude plan returned 403 on the Dashboard REST API. The events/list & event-segmentation endpoints require a Growth or Enterprise plan (Starter / Plus accounts only get the basic sessions API). Either upgrade your Amplitude plan, or pass an explicit events list when calling the agents.';
}
// Tiny per-IP cooldown to prevent abuse of the GPT-backed agent endpoints.
// Each agent call costs ~1 OpenAI request + 1-12 Amplitude calls, so this
// caps any one client to ~1 invocation per 8 seconds per agent (and ~30/min).
const _ampRateBuckets = new Map(); // ip -> { count, windowStart, lastAt }
function _ampRateLimit(req, res) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = _ampRateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > 60000) bucket = { count:0, windowStart:now, lastAt:0 };
  if (now - bucket.lastAt < 8000) {
    res.status(429).json({ ok:false, error:'rate-limited', message:'Please wait a few seconds before re-running an Amplitude agent.' });
    return false;
  }
  if (bucket.count >= 30) {
    res.status(429).json({ ok:false, error:'rate-limited', message:'Per-minute limit for Amplitude agents reached (30/min). Try again shortly.' });
    return false;
  }
  bucket.count++; bucket.lastAt = now;
  _ampRateBuckets.set(ip, bucket);
  if (_ampRateBuckets.size > 5000) {
    // simple GC: drop expired buckets
    for (const [k,v] of _ampRateBuckets) if (now - v.windowStart > 120000) _ampRateBuckets.delete(k);
  }
  return true;
}
// Cheap connection-status probe — just verifies credentials are present and
// pings ONE Amplitude endpoint without any GPT call. Used by the UI badge.
app.get('/api/amplitude/status', async (req, res) => {
  const apiKey = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return res.json({ ok:true, connected:false, missing: !apiKey ? 'AMPLITUDE_API_KEY' : 'AMPLITUDE_SECRET_KEY' });
  }
  const auth = 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  try {
    // Lightest authenticated call — events list with no expansion. We only
    // care about the HTTP status, not the body.
    const r = await fetch('https://amplitude.com/api/2/events/list', { headers:{ Authorization:auth } });
    if (r.ok) return res.json({ ok:true, connected:true, dashboardApiAccess:true });
    if (r.status === 403) return res.json({ ok:true, connected:true, dashboardApiAccess:false, status:403, planLimited:true, planNote:_amp403Hint() });
    if (r.status === 401) return res.json({ ok:true, connected:false, status:401, message:'Amplitude rejected the API key + secret pair (401 Unauthorized).' });
    return res.json({ ok:true, connected:true, dashboardApiAccess:false, status:r.status, message:'Amplitude returned ' + r.status });
  } catch (e) {
    return res.json({ ok:true, connected:'unknown', error: e.message, message:'Network error reaching Amplitude.' });
  }
});
// Sessions-only fallback used when the Dashboard REST API events endpoints
// return 403 (Starter/Plus plans). The sessions API is available on every plan.
async function _amplitudeDashboardSessionsFallback(auth, res) {
  try {
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 13);
    const fmt = _amplitudeFmtDate;
    const e = encodeURIComponent(JSON.stringify({ event_type: '_active' }));
    const j = await _amplitudeFetch(`/api/2/sessions/average?start=${fmt(start)}&end=${fmt(end)}&e=${e}`, auth);
    const series = (j?.data?.series?.[0] || []).map(n => Number(n) || 0);
    const total = series.reduce((a,b)=>a+b,0);
    const last7 = series.slice(-7).reduce((a,b)=>a+b,0);
    const prev7 = series.slice(0,7).reduce((a,b)=>a+b,0);
    const wowPct = prev7 ? +(((last7-prev7)/prev7)*100).toFixed(1) : (last7 ? 100 : 0);
    const events = [{ event:'Active sessions (avg length)', total, last7, prev7, wowPct, series }];
    const totals = { events:1, total, last7, prev7, wowPct };

    let insights = null;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role:'system', content:'You are a senior product analyst. Given Amplitude session-length data over the last 14 days (last7 vs prev7), surface the most important trends and hypotheses. Respond ONLY with JSON: { "summary": string, "trends": [{ "event": string, "direction": "up"|"down"|"flat", "wowPct": number, "note": string }], "anomalies": [{ "event": string, "severity": "low"|"medium"|"high", "note": string }], "hypotheses": [{ "title": string, "reasoning": string, "test": string }] }.' },
          { role:'user', content: JSON.stringify({ window:'last 14d, last7 vs prev7', planLimited:true, events }) }
        ],
        temperature: 0.3, max_tokens: 900,
      });
      insights = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      insights = { summary:'AI analysis unavailable: ' + e.message, trends:[], anomalies:[], hypotheses:[] };
    }
    return res.json({ ok:true, connected:true, planLimited:true, planNote:_amp403Hint(), events, totals, insights, generatedAt: new Date().toISOString() });
  } catch (e) {
    return res.json({ ok:true, connected:true, error:'sessions-fallback-failed', message: e.message, planNote:_amp403Hint() });
  }
}

// ── DASHBOARD AGENT ──────────────────────────────────────────────────────────
// 1. List events; 2. Pull last 14d series for top N events; 3. Compute WoW delta;
// 4. Send compact summary to GPT-4o for trends + anomalies + hypotheses.
app.post('/api/amplitude/dashboard-agent', async (req, res) => {
  if (!_ampRateLimit(req, res)) return;
  try {
    const auth = _amplitudeAuthOrError(res); if (!auth) return;
    const topN = Math.min(8, Math.max(3, parseInt(req.body?.topN) || 6));
    const explicitEvents = Array.isArray(req.body?.events) ? req.body.events.filter(Boolean).slice(0, 8) : null;

    // Step 1: get events list (caller-supplied → fast path; otherwise list API)
    let eventsList = [];
    if (explicitEvents && explicitEvents.length) {
      eventsList = explicitEvents.map(name => ({ value:name, name }));
    } else {
      try {
        const evJ = await _amplitudeFetch('/api/2/events/list', auth);
        eventsList = (evJ?.data || []).filter(e => !e.hidden && !e.deleted).slice(0, topN);
      } catch (e) {
        // Fall back to the only event guaranteed available on every Amplitude
        // plan: the synthetic `_active` event used by the sessions API.
        if (e.status === 403) {
          return _amplitudeDashboardSessionsFallback(auth, res);
        }
        return res.json({ ok:true, connected:true, error:'events-list-failed',
          message:'Amplitude responded but the events list endpoint failed: ' + e.message,
          events:[] });
      }
    }
    if (!eventsList.length) {
      return res.json({ ok:true, connected:true, events:[], totals:{},
        insights:{ summary:'No tracked events found in this Amplitude project yet. Once your app starts emitting events they will appear here.', trends:[], anomalies:[], hypotheses:[] } });
    }

    // Step 2: 14-day daily counts per event (event segmentation API)
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 13);
    const fmt = _amplitudeFmtDate;
    const events = await Promise.all(eventsList.map(async ev => {
      try {
        const e = encodeURIComponent(JSON.stringify({ event_type: ev.value || ev.name }));
        const j = await _amplitudeFetch(`/api/2/events/segmentation?e=${e}&start=${fmt(start)}&end=${fmt(end)}&m=totals&i=1`, auth);
        const series = (j?.data?.series?.[0] || []).map(n => Number(n) || 0);
        const days = j?.data?.xValues || [];
        const total = series.reduce((a,b)=>a+b,0);
        const last7 = series.slice(-7).reduce((a,b)=>a+b,0);
        const prev7 = series.slice(0,7).reduce((a,b)=>a+b,0);
        const wowPct = prev7 ? +(((last7-prev7)/prev7)*100).toFixed(1) : (last7 ? 100 : 0);
        return { event: ev.value || ev.name, total, last7, prev7, wowPct, series, days };
      } catch (e) {
        return { event: ev.value || ev.name, error: e.message };
      }
    }));
    const valid = events.filter(e => !e.error);
    const totals = {
      events: valid.length,
      total: valid.reduce((s,e)=>s+(e.total||0), 0),
      last7: valid.reduce((s,e)=>s+(e.last7||0), 0),
      prev7: valid.reduce((s,e)=>s+(e.prev7||0), 0),
    };
    totals.wowPct = totals.prev7 ? +(((totals.last7-totals.prev7)/totals.prev7)*100).toFixed(1) : 0;

    // Step 3: GPT-4o trend / anomaly / hypothesis analysis
    let insights = null;
    try {
      const compact = valid.map(e => ({ event:e.event, total:e.total, last7:e.last7, prev7:e.prev7, wowPct:e.wowPct }));
      const completion = await openaiChatWithRetry({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role:'system', content:'You are a senior product analyst. Given Amplitude event volume data (last 14 days, comparing the most recent 7d vs prior 7d), surface the most important trends, anomalies, and root-cause hypotheses. Respond ONLY with JSON: { "summary": string, "trends": [{ "event": string, "direction": "up"|"down"|"flat", "wowPct": number, "note": string }], "anomalies": [{ "event": string, "severity": "low"|"medium"|"high", "note": string }], "hypotheses": [{ "title": string, "reasoning": string, "test": string }] }. Keep prose tight and actionable.' },
          { role:'user', content: JSON.stringify({ window:'last 14 days, last7 vs prev7', events: compact }) }
        ],
        temperature: 0.3, max_tokens: 1200,
      });
      insights = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      insights = { summary:'AI analysis unavailable: ' + e.message, trends:[], anomalies:[], hypotheses:[] };
    }
    res.json({ ok:true, connected:true, events:valid, totals, insights, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('/api/amplitude/dashboard-agent error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── SESSION REPLAY AGENT ─────────────────────────────────────────────────────
// Builds a funnel from the top 4 most-fired events, finds the steepest drop-off,
// then asks GPT-4o to hypothesise WHY users abandon at that step.
app.post('/api/amplitude/replay-agent', async (req, res) => {
  if (!_ampRateLimit(req, res)) return;
  try {
    const auth = _amplitudeAuthOrError(res); if (!auth) return;

    // Use caller-supplied funnel events, or auto-pick top 4 by volume
    let funnelEvents = Array.isArray(req.body?.events) && req.body.events.length >= 2 ? req.body.events.slice(0,6) : null;
    if (!funnelEvents) {
      try {
        const evJ = await _amplitudeFetch('/api/2/events/list', auth);
        const list = (evJ?.data || []).filter(e => !e.hidden && !e.deleted).slice(0, 12).map(e => e.value || e.name);
        if (list.length < 2) {
          return res.json({ ok:true, connected:true, error:'not-enough-events',
            message:'Need at least 2 tracked events to build a funnel. Currently have ' + list.length + '.' });
        }
        funnelEvents = list.slice(0, 4);
      } catch (e) {
        if (e.status === 403) {
          return res.json({ ok:true, connected:true, error:'plan-limited', planLimited:true,
            message:'The Session Replay Agent needs the Dashboard REST API events list to auto-build a funnel. ' + _amp403Hint() + ' Tip: POST { "events": ["sign_up","onboarding_complete","first_value","upgrade"] } to specify the funnel manually.' });
        }
        return res.json({ ok:true, connected:true, error:'events-list-failed', message: e.message });
      }
    }

    // Funnels API — last 30 days
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30);
    const fmt = _amplitudeFmtDate;
    const eParam = funnelEvents.map(ev => 'e=' + encodeURIComponent(JSON.stringify({ event_type: ev }))).join('&');
    let funnelJ;
    try {
      funnelJ = await _amplitudeFetch(`/api/2/funnels?${eParam}&start=${fmt(start)}&end=${fmt(end)}&mode=unordered`, auth);
    } catch (e) {
      return res.json({ ok:true, connected:true, error:'funnel-fetch-failed', message: e.message });
    }
    const series = funnelJ?.data?.[0]?.cumulative || funnelJ?.data?.[0]?.stepCounts || funnelJ?.data?.[0]?.dataSeries || [];
    const counts = Array.isArray(series) ? series.map(Number) : [];
    const steps = funnelEvents.map((ev, i) => {
      const count = counts[i] || 0;
      const prev = counts[i-1] || count;
      const dropPct = prev ? +(((prev-count)/prev)*100).toFixed(1) : 0;
      return { stepIndex: i, event: ev, users: count, dropPct };
    });
    const worst = steps.slice(1).reduce((w,s) => (!w || s.dropPct > w.dropPct ? s : w), null);
    const overallConversion = counts[0] ? +((counts[counts.length-1]/counts[0])*100).toFixed(1) : 0;

    let insights = null;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role:'system', content:'You are a UX researcher analysing a product funnel built from Amplitude event data. Identify where users struggle, hypothesise WHY, and recommend session-replay queries to validate. Respond ONLY with JSON: { "summary": string, "biggestDropOff": { "step": string, "dropPct": number, "interpretation": string }, "frictionHypotheses": [{ "hypothesis": string, "evidence": string, "replayQuery": string }], "playlistIdeas": [{ "name": string, "filter": string, "whyItMatters": string }] }. Replay queries should be human-readable filter descriptions like "Users who triggered checkout_started but did not trigger purchase_completed within 5 minutes".' },
          { role:'user', content: JSON.stringify({ funnel: steps, overallConversionPct: overallConversion, windowDays: 30 }) }
        ],
        temperature: 0.4, max_tokens: 1200,
      });
      insights = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      insights = { summary:'AI analysis unavailable: ' + e.message, biggestDropOff:null, frictionHypotheses:[], playlistIdeas:[] };
    }
    res.json({ ok:true, connected:true, steps, worst, overallConversion, windowDays:30, insights, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('/api/amplitude/replay-agent error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── CUSTOMER FEEDBACK AGENT ──────────────────────────────────────────────────
// Scans the project's events for feedback-shaped names (NPS, feedback,
// support_ticket, complaint, review, survey…), counts volume per matched event,
// and asks GPT-4o to surface top requests / bugs / praises with priorities.
app.post('/api/amplitude/feedback-agent', async (req, res) => {
  if (!_ampRateLimit(req, res)) return;
  try {
    const auth = _amplitudeAuthOrError(res); if (!auth) return;
    const feedbackPatterns = /(feedback|nps|csat|survey|review|rating|complaint|support[_ ]?ticket|bug[_ ]?report|feature[_ ]?request|praise|testimonial)/i;

    let allEvents = [];
    try {
      const evJ = await _amplitudeFetch('/api/2/events/list', auth);
      allEvents = (evJ?.data || []).filter(e => !e.hidden && !e.deleted);
    } catch (e) {
      if (e.status === 403) {
        return res.json({ ok:true, connected:true, error:'plan-limited', planLimited:true,
          message:'The Customer Feedback Agent scans your Amplitude event list for feedback-shaped events (NPS, feedback_submitted, support_ticket, etc.) — but the events list endpoint is plan-restricted. ' + _amp403Hint() });
      }
      return res.json({ ok:true, connected:true, error:'events-list-failed', message: e.message });
    }
    const matched = allEvents.filter(e => feedbackPatterns.test(e.value || e.name || ''));
    if (!matched.length) {
      return res.json({ ok:true, connected:true, matchedEvents:[], totalVolume:0,
        insights:{ summary:'No feedback-shaped events detected in this Amplitude project. Track events like "feedback_submitted", "nps_score", or "support_ticket_created" to populate this agent.', requests:[], bugs:[], praises:[], recommendations:[] } });
    }

    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30);
    const fmt = _amplitudeFmtDate;
    const matchedEvents = await Promise.all(matched.slice(0, 10).map(async ev => {
      try {
        const e = encodeURIComponent(JSON.stringify({ event_type: ev.value || ev.name }));
        const j = await _amplitudeFetch(`/api/2/events/segmentation?e=${e}&start=${fmt(start)}&end=${fmt(end)}&m=totals&i=1`, auth);
        const series = (j?.data?.series?.[0] || []).map(n => Number(n) || 0);
        return { event: ev.value || ev.name, volume30d: series.reduce((a,b)=>a+b,0) };
      } catch (e) {
        return { event: ev.value || ev.name, volume30d: 0, error: e.message };
      }
    }));
    const totalVolume = matchedEvents.reduce((s,e)=>s+(e.volume30d||0),0);

    let insights = null;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role:'system', content:'You are a product manager triaging customer feedback signals. Given a list of feedback-shaped Amplitude events and their 30-day volumes, infer what customers are saying and recommend product changes. Respond ONLY with JSON: { "summary": string, "requests": [{ "title": string, "volume": "low"|"medium"|"high", "rationale": string }], "bugs": [{ "title": string, "severity": "low"|"medium"|"high", "rationale": string }], "praises": [{ "title": string, "rationale": string }], "recommendations": [{ "title": string, "impact": "low"|"medium"|"high", "effort": "low"|"medium"|"high", "next_step": string }] }. Use the event names as evidence — they describe what users did. Be concrete, not generic.' },
          { role:'user', content: JSON.stringify({ windowDays: 30, totalVolume, events: matchedEvents }) }
        ],
        temperature: 0.4, max_tokens: 1400,
      });
      insights = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      insights = { summary:'AI analysis unavailable: ' + e.message, requests:[], bugs:[], praises:[], recommendations:[] };
    }
    res.json({ ok:true, connected:true, matchedEvents, totalVolume, windowDays:30, insights, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('/api/amplitude/feedback-agent error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── Brand-source-of-truth scraper (shared by accuracy + content fact-check) ──
async function scrapeBrandSource(cleanDomain) {
  const fetchPage = async (u, ms=6000) => {
    try {
      const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), ms);
      const r = await fetch(u, { signal:ctrl.signal, redirect:'follow', headers:{ 'User-Agent':'Mozilla/5.0 (compatible; InfoGenieBot/1.0)' } });
      clearTimeout(t); if (!r.ok) return ''; return (await r.text()).slice(0,120000);
    } catch(e){ return ''; }
  };
  const base = 'https://' + cleanDomain;
  const [home, about, prod, services, pricing] = await Promise.all([
    fetchPage(base, 8000),
    fetchPage(base + '/about', 5000),
    fetchPage(base + '/products', 5000),
    fetchPage(base + '/services', 5000),
    fetchPage(base + '/pricing', 5000),
  ]);
  const sourceText = [home, about, prod, services, pricing].join('\n')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim().slice(0, 8000);
  return { sourceText, fetched: !!home };
}

// ── POST /api/content-fact-check ──────────────────────────────────────────────
// FACT ALIGNMENT — accepts any AI-generated content + a brand domain, scrapes
// the brand's live source-of-truth, then GPT-4o grades every factual claim in
// the content for alignment with the brand site. Returns aligned/contradicting/
// unverifiable claims and a 0-100 alignment score so users never ship AI
// hallucinations into production content.
app.post('/api/content-fact-check', async (req, res) => {
  try {
    const { content = '', domain = 'yourdomain.com' } = req.body || {};
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    const plainContent = String(content).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 8000);
    if (!plainContent) return res.status(400).json({ ok:false, error:'No content provided' });

    const { sourceText, fetched } = await scrapeBrandSource(cleanDomain);
    if (!fetched) return res.json({ ok:true, sourceFetched:false, alignmentScore:null, aligned:[], contradicting:[], unverifiable:[],
      note:`Could not scrape ${cleanDomain} — fact-checking unavailable. Make sure the site is publicly reachable.` });

    const prompt = `You are a strict fact-checker. Below is (1) AI-generated content about brand "${cleanDomain}" and (2) the authoritative source text scraped from ${cleanDomain}'s live website. Extract every factual claim from the content and grade each one against the source.

Return ONLY strict JSON:
{
 "alignmentScore": 0-100,
 "aligned":       [{"claim":"...","evidence":"short quote from source"}],
 "contradicting": [{"claim":"...","correction":"what the source actually says"}],
 "unverifiable":  [{"claim":"...","reason":"not mentioned in source"}],
 "summary":       "one-sentence verdict on whether this content is safe to publish"
}

CONTENT TO FACT-CHECK:
"""${plainContent}"""

AUTHORITATIVE SOURCE (${cleanDomain}):
"""${sourceText}"""`;

    const c = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 1400,
      messages: [{ role:'user', content: prompt }],
      response_format: { type:'json_object' },
    });
    const j = JSON.parse(c.choices?.[0]?.message?.content || '{}');
    res.json({
      ok: true, sourceFetched: true, sourceLength: sourceText.length,
      alignmentScore: typeof j.alignmentScore === 'number' ? j.alignmentScore : null,
      aligned: Array.isArray(j.aligned) ? j.aligned : [],
      contradicting: Array.isArray(j.contradicting) ? j.contradicting : [],
      unverifiable: Array.isArray(j.unverifiable) ? j.unverifiable : [],
      summary: j.summary || '',
      contentWordCount: plainContent.split(/\s+/).length,
    });
  } catch (err) {
    console.error('/api/content-fact-check error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/content-fact-check/auto-correct ─────────────────────────────────
// Takes the article HTML + the contradictions list returned by the prior
// fact-check and rewrites just the contradicting passages so they match the
// authoritative brand source. Returns the corrected HTML + a list of edits.
app.post('/api/content-fact-check/auto-correct', async (req, res) => {
  try {
    const { content = '', contradictions = [], unverifiable = [], domain = 'yourdomain.com' } = req.body || {};
    const html = String(content);
    if (!html.trim()) return res.status(400).json({ ok:false, error:'No content provided' });
    const fixList = [...(Array.isArray(contradictions)?contradictions:[]), ...(Array.isArray(unverifiable)?unverifiable:[])];
    if (!fixList.length) return res.json({ ok:true, correctedHtml: html, edits: [], note:'No contradictions to fix' });
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();

    const prompt = `You are a careful technical editor. Rewrite the HTML article below so every contradicting or unverifiable claim is replaced with wording that matches the authoritative source for brand "${cleanDomain}".

Rules:
- Keep ALL existing HTML tags, links, headings, lists, and paragraph structure intact.
- Only edit the sentences that contain a flagged claim. Do not rewrite the whole article.
- For each contradiction, use the supplied "correction" as the truth.
- For each unverifiable claim, soften the language (e.g. "may include", "typically", "according to industry sources") or remove the unsupported specific.
- Never invent new facts. If you cannot verify a claim from the corrections, generalise it.

Return ONLY strict JSON:
{
 "correctedHtml": "<full corrected HTML>",
 "edits": [{"before":"original sentence","after":"corrected sentence","reason":"why it was changed"}]
}

CONTRADICTIONS TO FIX:
${JSON.stringify(contradictions, null, 2)}

UNVERIFIABLE CLAIMS TO SOFTEN:
${JSON.stringify(unverifiable, null, 2)}

ORIGINAL ARTICLE HTML:
"""${html}"""`;

    const c = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 4000,
      messages: [{ role:'user', content: prompt }],
      response_format: { type:'json_object' },
    });
    const j = JSON.parse(c.choices?.[0]?.message?.content || '{}');
    res.json({
      ok: true,
      correctedHtml: typeof j.correctedHtml === 'string' && j.correctedHtml.trim() ? j.correctedHtml : html,
      edits: Array.isArray(j.edits) ? j.edits : [],
    });
  } catch (err) {
    console.error('/api/content-fact-check/auto-correct error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});
};
