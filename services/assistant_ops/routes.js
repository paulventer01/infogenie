// Assistant · mentions · alerts · stakeholders · webhooks · launches routes.
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
// Module-scope (real node require) so it resolves correctly even though `require`
// is rebased to __root_require__ inside register(). Gates the register-time crons
// and one-time boot migration below on whether this is the live server process
// (off when required for tests).
const _runtimeFlags = require('../runtime_flags');

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { _DIAG_CAP_PREFIX, _DIAG_LATEST_KEY, _fetchGoogleAdsSpend, _fetchMetaSpend, _fetchMicrosoftSpend, _fetchTikTokSpend, _isUrlSafeToFetch, _sendEmailViaResend, _tkvCtx, _tkvMutate, _tkvRead, _tkvScope, callDataForSEO, fs, openaiChatWithRetry, path } = ctx;

const _ASSISTANT_TOOLS = [
  { type:'function', function: {
    name: 'enroll_drip_campaign',
    description: 'Enroll one or more email addresses into the default drip-campaign sequence.',
    parameters: {
      type:'object',
      properties: {
        emails:     { type:'array', items:{ type:'string' }, description:'Email addresses to enroll.' },
        sequenceId: { type:'string', description:'Optional sequence ID. Defaults to "default".' },
      },
      required: ['emails'],
    },
  }},
  { type:'function', function: {
    name: 'run_amplitude_dashboard_agent',
    description: 'Run the Amplitude Dashboard Agent — surfaces trends and anomalies from product-analytics events over the last 14 days.',
    parameters: { type:'object', properties:{} },
  }},
  { type:'function', function: {
    name: 'run_amplitude_replay_agent',
    description: 'Run the Session Replay Agent to find the steepest drop-off in a funnel.',
    parameters: {
      type:'object',
      properties: {
        events: { type:'array', items:{ type:'string' }, description:'Optional ordered funnel-step event names. Empty = auto-pick from top events.' },
      },
    },
  }},
  { type:'function', function: {
    name: 'run_amplitude_feedback_agent',
    description: 'Run the Customer Feedback Agent to summarise recent NPS/feedback/support events.',
    parameters: { type:'object', properties:{} },
  }},
  { type:'function', function: {
    name: 'get_blended_performance',
    description: 'Get blended ad spend, customer count, and CAC across Meta + Google + TikTok over the last N days.',
    parameters: {
      type:'object',
      properties: { days: { type:'integer', description:'Look-back window in days (default 30, max 90).' } },
    },
  }},
  { type:'function', function: {
    name: 'list_goals',
    description: 'List all configured marketing-performance goals with their current values and status.',
    parameters: { type:'object', properties:{} },
  }},
  { type:'function', function: {
    name: 'create_goal',
    description: 'Create a new metric goal. Available metrics: drip.bounceRate, drip.totalSends, drip.deliveryRate, amp.sessions, ads.totalSpend, ads.cac.',
    parameters: {
      type:'object',
      properties: {
        metric: { type:'string', enum:['drip.bounceRate','drip.totalSends','drip.deliveryRate','amp.sessions','ads.totalSpend','ads.cac'] },
        target: { type:'number' },
        label:  { type:'string' },
      },
      required: ['metric', 'target'],
    },
  }},
  { type:'function', function: {
    name: 'get_drip_stats',
    description: 'Get current drip-campaign deliverability stats (sends, bounces, delivery rate).',
    parameters: { type:'object', properties:{} },
  }},
  { type:'function', function: {
    name: 'qualify_lead',
    description: 'Qualify an inbound lead with BANT + fit + intent scoring. Returns score, tier (hot/warm/cold), reasoning, BANT breakdown and 1-3 suggested next actions. Persists the qualification.',
    parameters: {
      type: 'object',
      properties: {
        name:      { type:'string' },
        email:     { type:'string' },
        company:   { type:'string' },
        source:    { type:'string', description:'How the lead reached us — webform, demo, content download, referral, etc.' },
        notes:     { type:'string', description:'Free-text notes from sales/marketing about this lead.' },
        behaviour: { type:'string', description:'Recent product / site behaviour summary if known.' },
      },
      required: ['email'],
    },
  }},
  { type:'function', function: {
    name: 'find_dormant_audience',
    description: 'List subscribers who have not been touched in N days (default 30) or whose recent sends all failed. Returns count + the dormant list.',
    parameters: {
      type: 'object',
      properties: { days: { type:'number', description:'Inactivity window in days (default 30, max 365).' } },
    },
  }},
  { type:'function', function: {
    name: 'launch_reengagement',
    description: 'Generate adaptive re-engagement copy for a segment + tone, then enroll the supplied emails (or the dormant cohort if no emails provided) into a single-touch re-engagement campaign. DESTRUCTIVE — actually sends email when dryRun is false.',
    parameters: {
      type: 'object',
      properties: {
        segment:    { type:'string', description:'Segment description (e.g. "dormant 30+ days, no opens").' },
        tone:       { type:'string', description:'Tone for the copy (e.g. warm-and-curious, urgent, soft-breakup).' },
        emails:     { type:'array',  items: { type:'string' }, description:'Optional explicit recipient list. If omitted, uses the current dormant cohort.' },
        dormantDays:{ type:'number', description:'Inactivity window when emails are not supplied (default 30).' },
        variantIndex:{type:'number', description:'Which generated variant to use (0, 1 or 2). Defaults to 0.' },
        dryRun:     { type:'boolean', description:'If true, records the campaign and goes through enrollment but no real sends happen.' },
      },
    },
  }},
];
const _DESTRUCTIVE_TOOLS = new Set(['enroll_drip_campaign', 'create_goal', 'launch_reengagement']);

async function _executeAssistantTool(name, args, req) {
  const port = process.env.PORT || 5000;
  const baseUrl = `http://localhost:${port}`;
  // Forward the caller's auth (session cookie or api-key headers) so loopback
  // calls resolve the SAME tenant as the originating request — without this,
  // tenant-scoped routes (drips/enroll, goals, leads, reengage) would 400 no_tenant.
  const _authHeaders = () => {
    const h = {};
    if (req?.headers?.cookie) h['cookie'] = req.headers.cookie;
    if (req?.headers?.authorization) h['authorization'] = req.headers.authorization;
    if (req?.headers?.['x-infogenie-key']) h['x-infogenie-key'] = req.headers['x-infogenie-key'];
    return h;
  };
  const POST = (p, body) => fetch(`${baseUrl}${p}`, { method:'POST', headers:{ 'Content-Type':'application/json', ..._authHeaders() }, body: JSON.stringify(body || {}) }).then(r => r.json());
  const GET  = (p)       => fetch(`${baseUrl}${p}`, { headers: _authHeaders() }).then(r => r.json());
  switch (name) {
    case 'enroll_drip_campaign': {
      const emails = (args.emails || []).filter(e => typeof e === 'string' && e.trim());
      if (!emails.length) return { error: 'No emails provided.' };
      const contacts = emails.map(e => ({ email: String(e).trim() }));
      // Minimal default 3-touch welcome sequence (used when caller doesn't pass one).
      // Real sequences come from the Re-Engage UI; this keeps NL command-bar enrollments working.
      const defaultSequence = [
        { day: 0, channel: 'email', label: 'Welcome',  subject: 'Welcome to InfoGenie',         msg: 'Hi {{name}}, thanks for trying InfoGenie. Reply to this email if you have any questions.' },
        { day: 2, channel: 'email', label: 'Value',    subject: 'Quick win to get you started', msg: 'Here\'s one thing most marketing teams miss in their first week: blended CAC across paid channels.' },
        { day: 5, channel: 'email', label: 'Check-in', subject: 'How is it going?',             msg: 'Just checking in — anything we can help with? Reply and a real human will respond.' },
      ];
      const sequence = Array.isArray(args.sequence) && args.sequence.length ? args.sequence : defaultSequence;
      const result = await POST('/api/drips/enroll', { contacts, sequence, brand: args.brand || 'InfoGenie' });
      return { result };
    }
    case 'run_amplitude_dashboard_agent': return await POST('/api/amplitude/dashboard-agent', {});
    case 'run_amplitude_replay_agent':    return await POST('/api/amplitude/replay-agent', { events: args.events || [] });
    case 'run_amplitude_feedback_agent':  return await POST('/api/amplitude/feedback-agent', {});
    case 'get_blended_performance':       return await GET (`/api/blended-roas?days=${Math.min(90, Math.max(1, args.days || 30))}`);
    case 'list_goals':                    return await GET ('/api/goals/check');
    case 'create_goal':                   return await POST('/api/goals', args);
    case 'get_drip_stats':                return await GET ('/api/drips/stats');
    case 'qualify_lead':                  return await POST('/api/leads/qualify', args);
    case 'find_dormant_audience':         return await GET (`/api/reengage/dormant?days=${Math.min(365, Math.max(1, Number(args.days) || 30))}`);
    case 'launch_reengagement': {
      // Three-step orchestration: (1) find dormant if no emails, (2) generate
      // variants, (3) pick chosen index and launch.
      let emails = Array.isArray(args.emails) ? args.emails.filter(e => typeof e === 'string' && e.trim()) : [];
      if (emails.length === 0) {
        const days = Math.min(365, Math.max(1, Number(args.dormantDays) || 30));
        const dormantResp = await GET(`/api/reengage/dormant?days=${days}`);
        emails = (dormantResp.dormant || []).map(d => d.email).filter(Boolean);
        if (emails.length === 0) return { error: 'No dormant subscribers found and no explicit emails supplied.' };
      }
      const segment = args.segment || `dormant subscribers (${args.dormantDays || 30}+ days inactive)`;
      const tone    = args.tone    || 'warm-and-curious';
      const gen = await POST('/api/reengage/generate', { segment, tone });
      if (!gen.ok || !gen.variants || !gen.variants.length) return { error: 'Variant generation failed', details: gen };
      const idx = Math.min(gen.variants.length - 1, Math.max(0, Number(args.variantIndex) || 0));
      const variant = gen.variants[idx];
      const launch = await POST('/api/reengage/launch', { variant, emails, segment, tone, dryRun: !!args.dryRun });
      return { generated: gen.variants, chosenIndex: idx, launch };
    }
    default:                              return { error: `Unknown tool ${name}` };
  }
}
function _describeToolCall(name, args) {
  if (name === 'enroll_drip_campaign') return `Enroll ${(args.emails || []).length} email address(es) into the "${args.sequenceId || 'default'}" drip sequence: ${(args.emails || []).join(', ')}`;
  if (name === 'create_goal')          return `Create a new goal — metric: ${args.metric}, target: ${args.target}${args.label ? `, label: "${args.label}"` : ''}.`;
  if (name === 'launch_reengagement') {
    const who = Array.isArray(args.emails) && args.emails.length
      ? `${args.emails.length} explicit recipient(s)`
      : `the dormant cohort (≥${args.dormantDays || 30} days inactive)`;
    const mode = args.dryRun ? ' (DRY-RUN — no real sends)' : ' — REAL SENDS will be issued';
    return `Generate adaptive copy and launch a re-engagement campaign to ${who}${mode}.`;
  }
  return `Run ${name}.`;
}
const _assistantRateBuckets = new Map();
function _assistantRateLimit(req, res) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let b = _assistantRateBuckets.get(ip);
  if (!b || now - b.windowStart > 60000) b = { count:0, windowStart:now, lastAt:0 };
  if (now - b.lastAt < 3000) { res.status(429).json({ ok:false, error:'rate-limited', message:'Please wait a few seconds between commands.' }); return false; }
  if (b.count >= 30)         { res.status(429).json({ ok:false, error:'rate-limited', message:'Per-minute command limit reached (30/min).' }); return false; }
  b.count++; b.lastAt = now;
  _assistantRateBuckets.set(ip, b);
  if (_assistantRateBuckets.size > 5000) {
    for (const [k, v] of _assistantRateBuckets) if (now - v.windowStart > 120000) _assistantRateBuckets.delete(k);
  }
  return true;
}
app.post('/api/assistant/command', async (req, res) => {
  if (!_assistantRateLimit(req, res)) return;
  const { command, confirm } = req.body || {};
  if (!command || typeof command !== 'string') return res.status(400).json({ ok:false, error:'missing-command' });
  const sysPrompt = `You are InfoGenie's Command Assistant. The user types a natural-language command and you execute it by calling exactly one of the registered tools. Rules:
- Pick the single best tool. If genuinely ambiguous, reply with a brief clarifying question instead of calling a tool.
- For DESTRUCTIVE tools (enroll_drip_campaign, create_goal): you may call the tool — the server will gate it with a confirmation step automatically.
- If no tool fits, briefly explain what you CAN do (1-2 sentences).
Available capability areas: drip campaigns, Amplitude product-analytics agents, blended ad performance/CAC, goals CRUD.`;
  try {
    const first = await openaiChatWithRetry({
      model: 'gpt-4o',
      messages: [
        { role:'system', content: sysPrompt },
        { role:'user',   content: command + (confirm ? '\n\n[User has explicitly confirmed any destructive action.]' : '') },
      ],
      tools: _ASSISTANT_TOOLS,
      tool_choice: 'auto',
      max_tokens: 600,
    });
    const msg = first.choices[0].message;
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return res.json({ ok:true, type:'text', text: msg.content || '(no response)' });
    }
    const tc       = msg.tool_calls[0];
    const toolName = tc.function.name;
    let toolArgs;
    try { toolArgs = JSON.parse(tc.function.arguments || '{}'); }
    catch { return res.json({ ok:false, error:'invalid-tool-arguments', raw: tc.function.arguments }); }

    if (_DESTRUCTIVE_TOOLS.has(toolName) && !confirm) {
      return res.json({
        ok: true, type: 'needs-confirmation',
        toolName, toolArgs,
        preview: _describeToolCall(toolName, toolArgs),
      });
    }
    const toolResult = await _executeAssistantTool(toolName, toolArgs, req);
    let summary = '';
    try {
      const second = await openaiChatWithRetry({
        model: 'gpt-5-mini',
        messages: [
          { role:'system', content:'Summarise the tool result for the user in 1-3 sentences. Speak directly to them. If the result contains an error, explain what went wrong and suggest a next step.' },
          { role:'user',   content:`User said: "${command}"\n\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs)}\nResult: ${JSON.stringify(toolResult).slice(0, 4000)}` },
        ],
        max_tokens: 400,
      });
      summary = second.choices[0].message.content || '';
    } catch (e) { summary = `Tool ${toolName} ran but the summary step failed: ${e.message}`; }
    res.json({ ok:true, type:'tool-executed', toolName, toolArgs, toolResult, summary });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// MENTION TRACKING + SENTIMENT (Feature 1)
// POST /api/mentions  — body: { brand, competitors:[], country, days }
// ────────────────────────────────────────────────────────────────────────────
const _COUNTRY_TO_DFS_LOC = {
  US:2840, GB:2826, CA:2124, AU:2036, DE:2276, FR:2250, ES:2724, IT:2380,
  NL:2528, BE:2056, SE:2752, NO:2578, DK:2208, FI:2246, PL:2616, PT:2620,
  IE:2372, AT:2040, CH:2756, JP:2392, KR:2410, IN:2356, SG:2702, MY:2458,
  TH:2764, ID:2360, PH:2608, VN:2704, BR:2076, MX:2484, AR:2032, CL:2152,
  CO:2170, ZA:2710, AE:2784, SA:2682, IL:2376, TR:2792, EG:2818, NG:2566,
  KE:2404, NZ:2554, RU:2643, UA:2804, CZ:2203, RO:2642, GR:2300, HU:2348
};

app.post('/api/mentions', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const brand = String(body.brand || '').trim().slice(0, 80);
    if (!brand) return res.status(400).json({ ok:false, error:'brand-required' });

    const competitors = (Array.isArray(body.competitors) ? body.competitors : [])
      .map(c => String(c || '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 10);

    const country = String(body.country || 'US').toUpperCase();
    // GLOBAL = no location filter → DataForSEO returns worldwide Google News
    // results. We omit location_code from the request payload entirely in
    // that case (instead of passing 0) since DFS treats missing location as
    // worldwide while 0 is rejected as invalid.
    const isGlobal = country === 'GLOBAL' || country === 'WORLDWIDE' || country === 'ALL';
    const locCode = isGlobal ? null : (_COUNTRY_TO_DFS_LOC[country] || 2840);
    const days    = Math.max(1, Math.min(90, parseInt(body.days, 10) || 30));
    const allBrands = [brand, ...competitors];

    if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
      return res.status(503).json({ ok:false, error:'dataforseo-not-configured' });
    }

    // When a brand name looks like a domain (e.g. "fxpro.com", "oanda.com"),
    // Google News almost never contains the literal ".com" string in headlines.
    // Strip the TLD and build a broader OR query so both forms are searched.
    const _newsKeyword = (name) => {
      const domainMatch = name.match(/^([a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)\.(?:com|net|io|co|org|app|ai|gg|tv|uk|us|de|fr|au|za|biz|info|finance|trade|markets?|exchange|group|capital|pro|digital|media|online|agency|studio|tech|solutions|systems|software|services?|platform|global|world|international|inc|ltd|llc)(?:\.[a-z]{2})?$/i);
      if (domainMatch) {
        const base = domainMatch[1];
        return `"${base}" OR "${name}"`;
      }
      return `"${name}"`;
    };

    const fetchBrandNews = async (name) => {
      try {
        const dfsParams = { keyword: _newsKeyword(name), language_code:'en', depth:20 };
        if (locCode != null) dfsParams.location_code = locCode;
        const raw = await callDataForSEO(
          '/v3/serp/google/news/live/advanced',
          [dfsParams],
          8000
        );
        const items = raw?.tasks?.[0]?.result?.[0]?.items;
        if (!Array.isArray(items)) return [];
        return items.slice(0, 12).map(it => {
          let host = '';
          try { host = it.url ? new URL(it.url).hostname.replace(/^www\./,'') : ''; } catch {}
          return {
            brand: name,
            title: String(it.title || '').slice(0, 220),
            url:   String(it.url || it.source_url || ''),
            source: String(it.source || it.domain || host || '').slice(0, 80),
            snippet: String(it.snippet || it.description || '').slice(0, 400),
            date: it.timestamp || it.date_publish || it.date || null,
            thumb: it.thumbnail_url || it.image_url || null
          };
        }).filter(m => m.title && m.url);
      } catch (e) {
        console.warn(`mentions fetch failed for ${name}:`, e.message);
        return [];
      }
    };

    const newsPerBrand = await Promise.all(allBrands.map(fetchBrandNews));
    let allMentions = [].concat(...newsPerBrand);

    const cutoffMs = Date.now() - (days * 86400 * 1000);
    allMentions = allMentions.filter(m => {
      if (!m.date) return true;
      const t = Date.parse(m.date);
      return isNaN(t) ? true : t >= cutoffMs;
    });

    if (!allMentions.length) {
      return res.json({
        ok:true, brand, competitors, country, days, mentions:[], byBrand:{},
        byBrandSent:{}, sentiment:{positive:0,neutral:0,negative:0}, sov:[], topSources:[],
        total:0, dataOrigin:'DataForSEO Google News (no results)', dataSource:'DataForSEO',
        confidence:'low'
      });
    }

    const sentInput = allMentions.map((m, i) => ({
      i, brand:m.brand, title:m.title, snippet:m.snippet.slice(0, 200), source:m.source
    }));
    let sentMap = {};
    try {
      const completion = await openaiChatWithRetry({
        model:'gpt-5-mini',
        messages:[
          { role:'system', content:'You are a media sentiment analyst. For each news mention, classify sentiment toward the named brand as exactly one of: "positive", "neutral", "negative". Be conservative — pure factual reporting is neutral; only mark positive/negative when the article frames the brand favourably/unfavourably. Output strict JSON: { "results": [{ "i": 0, "sentiment": "positive", "score": 0.85, "reason": "one short line" }] }. Score is your confidence 0-1.' },
          { role:'user', content: JSON.stringify(sentInput).slice(0, 12000) }
        ],
        response_format:{ type:'json_object' },
        temperature:0.2,
        max_tokens:3000
      }, { fallbackModel:'gpt-3.5-turbo', retries:2 });
      const parsed = JSON.parse(completion.choices[0].message.content);
      const arr = Array.isArray(parsed && parsed.results) ? parsed.results : [];
      for (const r of arr) {
        if (typeof r.i !== 'number') continue;
        const s = String(r.sentiment || '').toLowerCase();
        sentMap[r.i] = {
          sentiment: ['positive','negative','neutral'].includes(s) ? s : 'neutral',
          score: typeof r.score === 'number' ? Math.max(0, Math.min(1, r.score)) : 0.5,
          reason: String(r.reason || '').slice(0, 200)
        };
      }
    } catch (e) {
      console.warn('sentiment classification failed:', e.message);
    }

    const enriched = allMentions.map((m, idx) => ({
      ...m,
      sentiment:       sentMap[idx]?.sentiment       || 'neutral',
      sentimentScore:  sentMap[idx]?.score           || 0.5,
      sentimentReason: sentMap[idx]?.reason          || ''
    }));
    enriched.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : 0;
      const tb = b.date ? Date.parse(b.date) : 0;
      return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
    });

    const byBrand = {};
    const byBrandSent = {};
    const sentTotals = { positive:0, neutral:0, negative:0 };
    for (const m of enriched) {
      byBrand[m.brand] = (byBrand[m.brand] || 0) + 1;
      if (!byBrandSent[m.brand]) byBrandSent[m.brand] = { positive:0, neutral:0, negative:0 };
      byBrandSent[m.brand][m.sentiment]++;
      sentTotals[m.sentiment]++;
    }

    const today = new Date(); today.setUTCHours(0,0,0,0);
    const sov = [];
    for (let d = days - 1; d >= 0; d--) {
      const dt = new Date(today.getTime() - d * 86400000);
      const bucket = { date: dt.toISOString().slice(0, 10), byBrand: {} };
      for (const b of allBrands) bucket.byBrand[b] = 0;
      sov.push(bucket);
    }
    for (const m of enriched) {
      if (!m.date) continue;
      const t = Date.parse(m.date);
      if (isNaN(t)) continue;
      const dt = new Date(t); dt.setUTCHours(0,0,0,0);
      const key = dt.toISOString().slice(0, 10);
      const bucket = sov.find(b => b.date === key);
      if (bucket) bucket.byBrand[m.brand] = (bucket.byBrand[m.brand] || 0) + 1;
    }

    const bySource = {};
    for (const m of enriched) if (m.source) bySource[m.source] = (bySource[m.source] || 0) + 1;
    const topSources = Object.entries(bySource)
      .map(([source, count]) => ({ source, count }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 12);

    res.json({
      ok:true, brand, competitors, country, days,
      mentions: enriched, byBrand, byBrandSent, sentiment: sentTotals,
      sov, topSources, total: enriched.length,
      dataOrigin: `DataForSEO Google News (${enriched.length} mentions, ${allBrands.length} brands) + AI sentiment classification`,
      dataSource: 'DataForSEO + AI-verified',
      confidence: enriched.length >= 10 ? 'high' : enriched.length >= 3 ? 'medium' : 'low'
    });
  } catch (err) {
    console.error('/api/mentions error:', err.message);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// REAL-TIME ALERTS (Feature 2)
// ────────────────────────────────────────────────────────────────────────────
// Per-workspace alert + snapshot stores in kv: `alerts:t<tid>` /
// `alerts_snapshot:t<tid>`. _tkvMutate serialises read-modify-write per
// (base,tid). Mutators may return `false` to signal "no change" (skip write);
// that is translated to `undefined` so _tkvMutate never persists the sentinel.
const _ALERTS_BASE = 'alerts';
const _SNAP_BASE   = 'alerts_snapshot';
function _readAlerts(tid) { return _tkvRead(_ALERTS_BASE, tid, () => ({ alerts: [] })); }
function _readSnap(tid)   { return _tkvRead(_SNAP_BASE, tid, () => ({})); }
function _alertsMutate(tid, mutator) {
  if (tid == null) return Promise.resolve();
  return _tkvMutate(_ALERTS_BASE, tid, () => ({ alerts: [] }), async (cur) => {
    const next = await mutator(cur);
    return next === false ? undefined : next;
  });
}
function _snapMutate(tid, mutator) {
  if (tid == null) return Promise.resolve();
  return _tkvMutate(_SNAP_BASE, tid, () => ({}), async (cur) => {
    const next = await mutator(cur);
    return next === false ? undefined : next;
  });
}

const _ALERTS_META = {
  dataOrigin: 'kv_store alerts:t<tid> (per-workspace persistence)',
  dataSource: 'InfoGenie Alerts Engine',
  confidence: 'high'
};

app.get('/api/alerts/list', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'alerts:list' });
  const data = await _readAlerts(tid);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
  res.json({
    ok:true,
    alerts: data.alerts.slice(0, limit),
    unread: data.alerts.filter(a => !a.read).length,
    total: data.alerts.length,
    ..._ALERTS_META
  });
});

app.post('/api/alerts/ack', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'alerts:ack' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const id = String((req.body && req.body.id) || '');
  await _alertsMutate(tid, async (data) => {
    if (id === 'all') data.alerts.forEach(a => a.read = true);
    else if (id) { const a = data.alerts.find(x => x.id === id); if (a) a.read = true; }
    return data;
  });
  res.json({ ok:true, ..._ALERTS_META });
});

app.post('/api/alerts/check', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const brand  = String(body.brand || '').trim().slice(0, 80);
    const domain = String(body.domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
    const country = String(body.country || 'US').toUpperCase();
    const locCode = _COUNTRY_TO_DFS_LOC[country] || 2840;

    if (!brand && !domain) return res.status(400).json({ ok:false, error:'brand-or-domain-required' });
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'alerts:check' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
      return res.status(503).json({ ok:false, error:'dataforseo-not-configured' });
    }

    const now = Date.now();
    // Phase 1: do all network IO outside the mutex (slow), collect raw signals only
    let brandLast24h = null, baseKey = null;
    if (brand) {
      try {
        const raw = await callDataForSEO(
          '/v3/serp/google/news/live/advanced',
          [{ keyword:`"${brand}"`, language_code:'en', location_code:locCode, depth:20 }],
          7000
        );
        const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
        brandLast24h = items.filter(it => {
          const t = it.timestamp ? Date.parse(it.timestamp) : 0;
          return !isNaN(t) && t > (now - 86400000);
        }).length;
        baseKey = `mention_baseline_${brand.toLowerCase()}`;
      } catch (e) { console.warn('alerts mention check failed:', e.message); }
    }
    let currentRanks = null, rankKey = null;
    if (domain) {
      try {
        const raw = await callDataForSEO(
          '/v3/dataforseo_labs/google/ranked_keywords/live',
          [{ target:domain, language_code:'en', location_code:locCode, limit:25,
             order_by:['ranked_serp_element.serp_item.rank_absolute,asc'] }],
          9000
        );
        const ranked = raw?.tasks?.[0]?.result?.[0]?.items || [];
        currentRanks = {};
        for (const r of ranked) {
          const kw  = r?.keyword_data?.keyword;
          const pos = r?.ranked_serp_element?.serp_item?.rank_absolute;
          if (kw && typeof pos === 'number' && pos > 0 && pos <= 100) currentRanks[kw] = pos;
        }
        rankKey = `ranks_${domain.toLowerCase()}`;
      } catch (e) { console.warn('alerts rank check failed:', e.message); }
    }

    // Phase 2: compare against snapshot + write next snapshot atomically inside mutex
    const newAlerts = [];
    await _snapMutate(tid, async (snap) => {
      if (baseKey !== null && brandLast24h !== null) {
        const lastBase = typeof snap[baseKey] === 'number' ? snap[baseKey] : 0;
        if (brandLast24h >= 3 && lastBase > 0 && brandLast24h >= lastBase * 2) {
          newAlerts.push({
            id: `mention-surge-${brand.toLowerCase().replace(/\W/g,'_')}-${now}`,
            type:'mention_surge', severity:'medium',
            title:`Mention surge: ${brand}`,
            body:`${brandLast24h} new mentions in the last 24h vs typical ${lastBase.toFixed(1)}. Worth checking what's driving the chatter.`,
            timestamp: now, read:false
          });
        }
        snap[baseKey] = lastBase === 0 ? brandLast24h : (lastBase * 0.7 + brandLast24h * 0.3);
      }
      if (rankKey !== null && currentRanks !== null) {
        const lastRanks = (snap[rankKey] && typeof snap[rankKey] === 'object') ? snap[rankKey] : {};
        for (const kw of Object.keys(currentRanks)) {
          const oldPos = lastRanks[kw];
          const newPos = currentRanks[kw];
          if (typeof oldPos === 'number' && newPos > oldPos + 5 && oldPos <= 10) {
            newAlerts.push({
              id: `rank-drop-${domain}-${kw.slice(0,30).replace(/\W/g,'_')}-${now}`,
              type:'rank_drop',
              severity: newPos > 20 ? 'high' : 'medium',
              title:`Rank drop on "${kw}"`,
              body:`${domain} fell from position ${oldPos} → ${newPos}. Check the SERP for a new competitor or content refresh.`,
              timestamp: now, read:false
            });
          }
        }
        snap[rankKey] = currentRanks;
      }
      snap.lastChecked = now;
      return snap;
    });

    if (newAlerts.length) {
      await _alertsMutate(tid, async (data) => {
        const existing = new Set(data.alerts.map(a => a.id));
        for (const a of newAlerts) if (!existing.has(a.id)) data.alerts.unshift(a);
        data.alerts = data.alerts.slice(0, 100);
        return data;
      });
    }

    // Stakeholder digest (high/critical only, throttled to one send per 30 min).
    // TRULY fire-and-forget: outbound email latency must NOT block this response.
    // Errors are logged internally; status surfaces on the next /list response.
    let stakeholderEmail = { sent:false, reason:'queued-async' };
    if (newAlerts.length && typeof _dispatchStakeholderDigest === 'function') {
      Promise.resolve()
        .then(() => _dispatchStakeholderDigest(tid, newAlerts, { accountLabel: brand || domain }))
        .then(r => { if (r && r.sent) console.log(`[stakeholder-email] dispatched ${r.sentCount} digest(s) from /alerts/check`); })
        .catch(e => console.warn('[stakeholder-email] /alerts/check dispatch failed:', e.message));
    } else if (!newAlerts.length) {
      stakeholderEmail = { sent:false, reason:'no-alerts' };
    }
    // Parallel real-time delivery to chat webhooks (Slack/Teams/Telegram/generic)
    if (newAlerts.length && typeof _dispatchWebhookDigest === 'function') {
      Promise.resolve()
        .then(() => _dispatchWebhookDigest(tid, newAlerts, { accountLabel: brand || domain }))
        .then(r => { if (r && r.sent) console.log(`[webhook] dispatched ${r.sentCount}/${r.sentCount + r.failCount} channels from /alerts/check`); })
        .catch(e => console.warn('[webhook] /alerts/check dispatch failed:', e.message));
    }

    res.json({
      ok:true, newAlerts, newCount: newAlerts.length, lastChecked: now,
      stakeholderEmail,
      dataOrigin:'DataForSEO live SERP + Google News diff vs last snapshot',
      dataSource:'DataForSEO',
      confidence:'high'
    });
  } catch (err) {
    console.error('/api/alerts/check error:', err.message);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CREDIT / BILLING / SUBSCRIPTION MONITOR
// ────────────────────────────────────────────────────────────────────────────
// Pushes "low balance", "missing key", and "subscription required" alerts into
// the same alerts.json store so the bell badge surfaces them automatically.
// Idempotent: each kind+resource emits at most one unread alert at a time.

async function _emitCreditAlert(tid, alert) {
  await _alertsMutate(tid, async (data) => {
    // De-dup: drop any prior unread alert with the same id-stem so the bell
    // never shows duplicates of the same warning.
    const stem = alert.id.replace(/-\d+$/, '');
    data.alerts = data.alerts.filter(a => !(a.id.startsWith(stem) && !a.read));
    data.alerts.unshift({ ...alert, timestamp: Date.now(), read: false });
    data.alerts = data.alerts.slice(0, 100);
    return data;
  });
}

// Probe DataForSEO `/v3/appendix/user_data` → balance + currency + daily limits.
async function _dfsBalance() {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    return { ok: false, error: 'no_creds' };
  }
  try {
    const auth = 'Basic ' + Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
    const r = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      headers: { Authorization: auth }, signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    const t = j?.tasks?.[0]?.result?.[0];
    if (!t || !t.money) return { ok: false, error: 'no_data' };
    return {
      ok: true,
      balance: Number(t.money.balance || 0),
      total: Number(t.money.total || 0),
      currency: t.money.currency || 'USD',
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Runs the full credit-check sweep. Returns { emitted: [...] }.
async function _runCreditCheck(tid) {
  const emitted = [];
  if (tid == null) return { emitted, dfs: { ok:false, error:'no_tenant' } };

  // ── 1. DataForSEO balance ────────────────────────────────────────────────
  const dfs = await _dfsBalance();
  if (dfs.ok) {
    let severity = null, title = '', body = '';
    if (dfs.balance < 5) {
      severity = 'high';
      title = `⚠️ DataForSEO balance critical — $${dfs.balance.toFixed(2)} left`;
      body = `Your DataForSEO account has less than $5 remaining. SERP, backlinks, AI-optimization and rank tracking will stop working soon. Top up at app.dataforseo.com → Billing.`;
    } else if (dfs.balance < 20) {
      severity = 'medium';
      title = `💳 DataForSEO balance low — $${dfs.balance.toFixed(2)} left`;
      body = `Your DataForSEO balance is below $20 (of $${dfs.total.toFixed(0)} total). Consider topping up before SERP/backlinks/AI Optimization throttle.`;
    }
    if (severity) {
      const a = { id:`credit-dfs-balance-${Date.now()}`, type:'credit_low', severity, title, body };
      await _emitCreditAlert(tid, a); emitted.push(a);
    }
  } else if (dfs.error !== 'no_creds') {
    const a = { id:`credit-dfs-error-${Date.now()}`, type:'credit_error', severity:'medium',
      title:'⚠️ DataForSEO balance check failed',
      body:`Could not read DataForSEO balance (${dfs.error}). The login/password may be wrong, or the account may be suspended for non-payment.` };
    await _emitCreditAlert(tid, a); emitted.push(a);
  }

  // ── 2. Missing / unconfigured paid services that the app expects ─────────
  const PAID_SERVICES = [
    { key:'OPENAI_API_KEY',         name:'OpenAI',          why:'AI Attack Plan, AI Visibility audit, content scoring, and most LLM features depend on this.' },
    { key:'ANTHROPIC_API_KEY',      name:'Claude (Anthropic)', why:'Used as the second-opinion LLM in Dual-AI Attack Plan and several creator-studio tools.' },
    { key:'PERPLEXITY_API_KEY',     name:'Perplexity',      why:'Powers real-time web-grounded answers in AI Visibility tracking.' },
    { key:'GEMINI_API_KEY',         name:'Gemini',          why:'Powers Google AI surfaces tracking and several vision tools.' },
    { key:'DATAFORSEO_LOGIN',       name:'DataForSEO',      why:'Powers SERP, backlinks, rank tracking, AI Optimization API, and Question Mining.' },
    { key:'FIRECRAWL_API_KEY',      name:'Firecrawl',       why:'Required for competitor site scraping and content extraction.' },
    { key:'RESEND_API_KEY',         name:'Resend',          why:'Required to send booking, drip, and stakeholder alert emails.' },
    { key:'HUBSPOT_PRIVATE_APP_TOKEN', name:'HubSpot',      why:'Required for CRM sync, contact upsert, and Dynamic Audiences HubSpot mirror.' },
  ];
  // Only warn for OpenAI/DFS at boot — the rest are opt-in. Users can still
  // manually trigger a full sweep with ?all=1.
  const CRITICAL = ['OPENAI_API_KEY','DATAFORSEO_LOGIN'];
  for (const svc of PAID_SERVICES) {
    if (process.env[svc.key]) continue;
    if (!CRITICAL.includes(svc.key)) continue;
    const a = {
      id: `credit-missing-${svc.key.toLowerCase()}-${Date.now()}`,
      type: 'service_missing', severity: 'high',
      title: `🔑 ${svc.name} not connected — subscription / API key required`,
      body: `${svc.why} Add ${svc.key} in Replit Secrets to enable.`,
    };
    await _emitCreditAlert(tid, a); emitted.push(a);
  }

  // ── 3. Detect placeholder/dummy keys (silent failures otherwise) ────────
  for (const svc of PAID_SERVICES) {
    const v = process.env[svc.key];
    if (v && /^_DUMMY/i.test(v)) {
      const a = {
        id: `credit-dummy-${svc.key.toLowerCase()}-${Date.now()}`,
        type: 'key_placeholder', severity: 'high',
        title: `🚧 ${svc.name} key is a placeholder`,
        body: `${svc.key} starts with "_DUMMY". ${svc.name} calls are skipped and template fallbacks are used. Replace with a real key in Replit Secrets to unlock live ${svc.name} responses.`,
      };
      await _emitCreditAlert(tid, a); emitted.push(a);
    }
  }

  return { emitted, dfs };
}

// GET /api/alerts/check-credits  — manual + cron entrypoint
app.get('/api/alerts/check-credits', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'alerts:check-credits' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    const r = await _runCreditCheck(tid);
    res.json({ ok:true, emitted: r.emitted, dfs: r.dfs, lastChecked: Date.now() });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Auto-run on boot (after 8 s grace) + every 6 h thereafter. Credit/key issues
// are platform-wide (shared env keys), so the cron surfaces them in the default
// (owner) workspace via getCronTenantId().
async function _runCreditCheckCron() {
  try {
    const tid = await _tkvCtx.getCronTenantId();
    if (tid == null) return;
    await _runCreditCheck(tid);
  } catch (e) { console.warn('credit check failed:', e.message); }
}
// Live server only; skipped when required as a module for tests (buildApp).
if (_runtimeFlags.backgroundEnabled()) {
  setTimeout(() => { _runCreditCheckCron(); }, 8000);
  setInterval(() => { _runCreditCheckCron(); }, 6 * 60 * 60 * 1000);
}

// ────────────────────────────────────────────────────────────────────────────
// STAKEHOLDER DISTRIBUTION (Feature 5 — auto-emails on critical alerts)
// ────────────────────────────────────────────────────────────────────────────
// Per-workspace stakeholder store in kv: `stakeholders:t<tid>`.
const _STAKE_BASE = 'stakeholders';
const _STAKE_META = {
  dataOrigin: 'kv_store stakeholders:t<tid> (per-workspace persistence)',
  dataSource: 'InfoGenie Stakeholder Engine',
  confidence: 'high'
};
function _readStake(tid) {
  return _tkvRead(_STAKE_BASE, tid, () => ({ stakeholders: [], lastEmailSentAt: 0 }));
}
function _stakeMutate(tid, mutator) {
  if (tid == null) return Promise.resolve();
  return _tkvMutate(_STAKE_BASE, tid, () => ({ stakeholders: [], lastEmailSentAt: 0 }), async (cur) => {
    const next = await mutator(cur);
    return next === false ? undefined : next;
  });
}

const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.get('/api/stakeholders/list', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'stakeholders:list' });
  const d = await _readStake(tid);
  res.json({
    ok:true,
    stakeholders: d.stakeholders,
    lastEmailSentAt: d.lastEmailSentAt || 0,
    emailConfigured: !!process.env.RESEND_API_KEY,
    ..._STAKE_META
  });
});

app.post('/api/stakeholders/add', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'stakeholders:add' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const name  = String(body.name  || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 120).toLowerCase();
  if (!name)  return res.status(400).json({ ok:false, error:'name required' });
  if (!_EMAIL_RE.test(email)) return res.status(400).json({ ok:false, error:'valid email required' });
  let added = null, dup = false;
  await _stakeMutate(tid, async (data) => {
    if (data.stakeholders.some(s => s.email === email)) { dup = true; return false; }
    added = {
      id: 'stk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name, email, addedAt: Date.now()
    };
    data.stakeholders.unshift(added);
    return data;
  });
  if (dup) return res.status(409).json({ ok:false, error:'email already in list' });
  res.json({ ok:true, stakeholder: added, ..._STAKE_META });
});

app.post('/api/stakeholders/remove', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'stakeholders:remove' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const id = String((req.body && req.body.id) || '');
  if (!id) return res.status(400).json({ ok:false, error:'id required' });
  let removed = false;
  await _stakeMutate(tid, async (data) => {
    const before = data.stakeholders.length;
    data.stakeholders = data.stakeholders.filter(s => s.id !== id);
    removed = data.stakeholders.length < before;
    return data;
  });
  res.json({ ok:true, removed, ..._STAKE_META });
});

// Build a stakeholder digest email body for a batch of new alerts
function _buildStakeholderDigest(newAlerts, accountLabel) {
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...newAlerts].sort((a,b) => (sevOrder[a.severity]||9) - (sevOrder[b.severity]||9));
  const sevColor = (s) => s === 'critical' ? '#DC2626' : s === 'high' ? '#EA580C' : s === 'medium' ? '#D97706' : '#0EA5E9';
  const escHtml = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = sorted.map(a => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;vertical-align:top">
        <div style="display:inline-block;background:${sevColor(a.severity)};color:white;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-bottom:6px">${escHtml(String(a.severity||'info').toUpperCase())}</div>
        <div style="font-weight:700;color:#111827;font-size:14px;margin-bottom:2px">${escHtml(a.title || a.type || 'Alert')}</div>
        <div style="color:#4B5563;font-size:13px;line-height:1.4">${escHtml(a.body || '')}</div>
      </td>
    </tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;margin-top:20px">
      <div style="background:linear-gradient(135deg,#1E293B,#7C3AED);padding:20px 24px;color:white">
        <div style="font-size:13px;opacity:.85;letter-spacing:.06em;font-weight:700">INFOGENIE · STAKEHOLDER DIGEST</div>
        <div style="font-size:20px;font-weight:800;margin-top:4px">${escHtml(newAlerts.length)} new alert${newAlerts.length===1?'':'s'}${accountLabel ? ` · ${escHtml(accountLabel)}` : ''}</div>
      </div>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${rows}</table>
      <div style="padding:18px 24px;background:#F9FAFB;color:#6B7280;font-size:12px;border-top:1px solid #E5E7EB">
        Open InfoGenie to acknowledge these alerts and dive into the data.
      </div>
    </div></body></html>`;
  const text = sorted.map(a => `[${(a.severity||'info').toUpperCase()}] ${a.title}\n${a.body || ''}`).join('\n\n');
  return { subject: `[InfoGenie] ${newAlerts.length} new alert${newAlerts.length===1?'':'s'}${accountLabel ? ` — ${accountLabel}` : ''}`, html, text };
}

// Public helper: dispatch a stakeholder digest email for a batch of new alerts.
// Throttles to one send per 30 minutes via lastEmailSentAt to avoid noise.
// Filters to high/critical severity only by default (override via opts.minSeverity).
// THROTTLE IS ATOMIC: lastEmailSentAt is reserved inside _stakeMutate BEFORE the
// network sends, so two concurrent triggers cannot both pass the throttle.
async function _dispatchStakeholderDigest(tid, newAlerts, opts = {}) {
  if (tid == null) return { sent:false, reason:'no-tenant' };
  if (!process.env.RESEND_API_KEY) return { sent:false, reason:'resend-not-configured' };
  if (!Array.isArray(newAlerts) || !newAlerts.length) return { sent:false, reason:'no-alerts' };
  const minSev = opts.minSeverity || 'high';
  const sevRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const minRank = sevRank[minSev] != null ? sevRank[minSev] : 2;
  const eligible = newAlerts.filter(a => (sevRank[a.severity] != null ? sevRank[a.severity] : 0) >= minRank);
  if (!eligible.length) return { sent:false, reason:'no-eligible-severity' };
  const THROTTLE_MS = 30 * 60 * 1000;
  // Atomic check-and-reserve: serialised through the mutex chain. Two concurrent
  // callers cannot both observe lastEmailSentAt < (now-THROTTLE) and proceed.
  let recipients = null;
  let reservedAt = 0;
  await _stakeMutate(tid, async (d) => {
    if (!d.stakeholders.length) return false;
    const now = Date.now();
    if ((now - (d.lastEmailSentAt || 0)) < THROTTLE_MS) return false;
    d.lastEmailSentAt = now;
    recipients = d.stakeholders.slice();
    reservedAt = now;
    return d;
  });
  if (!recipients) {
    // Either no stakeholders or throttled — figure out which for the response
    const cur = await _readStake(tid);
    return { sent:false, reason: cur.stakeholders.length ? 'throttled' : 'no-stakeholders' };
  }
  const { subject, html, text } = _buildStakeholderDigest(eligible, opts.accountLabel || '');
  let okCount = 0, failCount = 0;
  for (const s of recipients) {
    try {
      await _sendEmailViaResend({ to: s.email, subject, html, text });
      okCount++;
    } catch (e) {
      failCount++;
      console.warn(`[stakeholder-email] failed to ${s.email}: ${e.message}`);
    }
  }
  // If every send failed, release the throttle so the next legitimate alert can try
  if (okCount === 0) {
    await _stakeMutate(tid, async (d) => {
      if (d.lastEmailSentAt === reservedAt) { d.lastEmailSentAt = 0; return d; }
      return false;
    });
  }
  return { sent: okCount > 0, sentCount: okCount, failCount, totalAlerts: eligible.length };
}

app.post('/api/stakeholders/test-email', async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ ok:false, error:'RESEND_API_KEY missing — cannot send test email' });
  }
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'stakeholders:test-email' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const stake = await _readStake(tid);
  if (!stake.stakeholders.length) {
    return res.status(400).json({ ok:false, error:'no stakeholders to send to — add at least one first' });
  }
  // Build a sample alert and bypass throttle by using the helper directly
  const sample = [{
    type:'rank_drop', severity:'high',
    title:'TEST · Sample rank drop alert',
    body:'This is a test message from InfoGenie. Real alerts will look like this when stakeholders need to act.',
    timestamp: Date.now()
  }];
  const { subject, html, text } = _buildStakeholderDigest(sample, 'TEST');
  let okCount = 0, failures = [];
  for (const s of stake.stakeholders) {
    try { await _sendEmailViaResend({ to: s.email, subject, html, text }); okCount++; }
    catch (e) { failures.push({ email: s.email, error: e.message }); }
  }
  res.json({ ok: okCount > 0, sentCount: okCount, failures, totalStakeholders: stake.stakeholders.length, ..._STAKE_META });
});

// ────────────────────────────────────────────────────────────────────────────
// WEBHOOK CHANNELS (Feature 5b — Slack / Teams / Telegram / Generic)
// ────────────────────────────────────────────────────────────────────────────
// Stakeholders get email digests; webhooks deliver the same alerts in real-time
// to chat channels. User pastes their own webhook URL — no API keys needed.
// Per-workspace webhook store in kv: `webhooks:t<tid>`.
const _WEBHOOKS_BASE = 'webhooks';
const _WEBHOOK_TYPES = ['slack', 'teams', 'telegram', 'generic'];
const _WEBHOOKS_META = {
  dataOrigin: 'kv_store webhooks:t<tid> (per-workspace persistence)',
  dataSource: 'InfoGenie Webhook Engine',
  confidence: 'high'
};
function _readWebhooks(tid) {
  return _tkvRead(_WEBHOOKS_BASE, tid, () => ({ webhooks: [], lastDispatchAt: 0 }));
}
function _webhookMutate(tid, mutator) {
  if (tid == null) return Promise.resolve();
  return _tkvMutate(_WEBHOOKS_BASE, tid, () => ({ webhooks: [], lastDispatchAt: 0 }), async (cur) => {
    const next = await mutator(cur);
    return next === false ? undefined : next;
  });
}

// SSRF-safe URL validation. Public HTTPS only; per-platform host allowlist for
// the chat platforms; generic accepts any public HTTPS host.
function _validateWebhookUrl(type, url) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    return { ok:false, error:'webhook URL must start with https://' };
  }
  let host;
  try { host = new URL(url).hostname.toLowerCase(); }
  catch { return { ok:false, error:'invalid URL' }; }
  if (!host || host === 'localhost' || /^(\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\])$/i.test(host) ||
      host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok:false, error:'private/local URLs not allowed' };
  }
  if (type === 'slack') {
    if (!/(^|\.)slack\.com$/.test(host)) return { ok:false, error:'Slack webhook URL must be on slack.com (e.g. hooks.slack.com)' };
  } else if (type === 'teams') {
    if (!/(^|\.)office\.com$|(^|\.)outlook\.com$|(^|\.)microsoft\.com$|(^|\.)webhook\.office\.com$/.test(host)) {
      return { ok:false, error:'Teams webhook URL must be on office.com / outlook.com / microsoft.com' };
    }
  } else if (type === 'telegram') {
    if (host !== 'api.telegram.org') return { ok:false, error:'Telegram URL must be https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>' };
    if (!/\/bot[\w:-]+\/sendMessage/.test(url)) return { ok:false, error:'Telegram URL must include /bot<TOKEN>/sendMessage' };
    try {
      const u = new URL(url);
      if (!u.searchParams.get('chat_id')) return { ok:false, error:'Telegram URL must include ?chat_id=<ID>' };
    } catch { return { ok:false, error:'invalid Telegram URL' }; }
  }
  return { ok:true };
}

// Format alerts as a payload for each webhook platform.
function _formatWebhookPayload(type, newAlerts, accountLabel) {
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...newAlerts].sort((a,b) => (sevOrder[a.severity]||9) - (sevOrder[b.severity]||9));
  const sevEmoji = (s) => s === 'critical' ? '🔴' : s === 'high' ? '🟠' : s === 'medium' ? '🟡' : '🔵';

  if (type === 'slack') {
    const blocks = [{ type:'header', text:{ type:'plain_text', text:`InfoGenie · ${newAlerts.length} new alert${newAlerts.length===1?'':'s'}${accountLabel ? ` — ${accountLabel}` : ''}` } }];
    for (const a of sorted) {
      blocks.push({
        type:'section',
        text:{ type:'mrkdwn',
          text: `${sevEmoji(a.severity)} *${(a.severity||'info').toUpperCase()} — ${a.title || a.type || 'Alert'}*\n${a.body || ''}` }
      });
    }
    blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:'Open InfoGenie to acknowledge these alerts.' }] });
    return {
      text: `InfoGenie · ${newAlerts.length} new alert${newAlerts.length===1?'':'s'}\n` +
            sorted.map(a => `${sevEmoji(a.severity)} ${a.title || a.type}`).join('\n'),
      blocks
    };
  }
  if (type === 'teams') {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: `InfoGenie · ${newAlerts.length} new alert${newAlerts.length===1?'':'s'}`,
      themeColor: sorted[0]?.severity === 'critical' ? 'DC2626' : sorted[0]?.severity === 'high' ? 'EA580C' : 'D97706',
      title: `InfoGenie · ${newAlerts.length} new alert${newAlerts.length===1?'':'s'}${accountLabel ? ` — ${accountLabel}` : ''}`,
      sections: sorted.map(a => ({
        activityTitle: `${sevEmoji(a.severity)} **${(a.severity||'info').toUpperCase()}** — ${a.title || a.type || 'Alert'}`,
        text: a.body || ''
      }))
    };
  }
  if (type === 'telegram') {
    const escTg = (s) => String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const lines = [`<b>InfoGenie · ${escTg(newAlerts.length)} new alert${newAlerts.length===1?'':'s'}</b>${accountLabel ? ` — <i>${escTg(accountLabel)}</i>` : ''}`, ''];
    for (const a of sorted) {
      lines.push(`${sevEmoji(a.severity)} <b>${escTg((a.severity||'info').toUpperCase())} — ${escTg(a.title || a.type || 'Alert')}</b>`);
      if (a.body) lines.push(escTg(a.body));
      lines.push('');
    }
    return { text: lines.join('\n').slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true };
  }
  // generic — for n8n / Zapier / Make / Pipedream / IFTTT / custom HTTP catch-alls
  return {
    source: 'infogenie',
    accountLabel: accountLabel || null,
    timestamp: Date.now(),
    alerts: sorted.map(a => ({
      id: a.id, type: a.type, severity: a.severity, title: a.title, body: a.body, timestamp: a.timestamp
    }))
  };
}

async function _sendOneWebhook(wh, newAlerts, accountLabel) {
  // Re-validate URL each call (defends against stored data drift) AND resolve
  // the hostname to confirm it doesn't point to a private IP. _isUrlSafeToFetch
  // does DNS lookup + _isPrivateIp on every record (covers IPv4 short forms,
  // IPv6 collapsed addresses, RFC1918, link-local, loopback, metadata IPs).
  const safety = await _isUrlSafeToFetch(wh.url);
  if (!safety.ok) throw new Error('URL safety check failed: ' + safety.error);
  const v = _validateWebhookUrl(wh.type, wh.url);
  if (!v.ok) throw new Error('URL validation failed: ' + v.error);

  const payload = _formatWebhookPayload(wh.type, newAlerts, accountLabel);
  let body;
  if (wh.type === 'telegram') {
    const u = new URL(wh.url);
    const chatId = u.searchParams.get('chat_id');
    body = JSON.stringify({ chat_id: chatId, ...payload });
  } else {
    body = JSON.stringify(payload);
  }
  // redirect:'manual' prevents redirect-follow SSRF (a malicious endpoint
  // could otherwise return a 302 to an internal/metadata host). Chat-platform
  // webhooks return 200/204 directly; any 3xx is treated as a hard failure.
  const r = await fetch(wh.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  });
  if (r.status >= 300 && r.status < 400) {
    throw new Error(`HTTP ${r.status} — webhook URL returned a redirect (not allowed; chat platforms post directly)`);
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}${txt ? ' — ' + txt.slice(0, 200) : ''}`);
  }
  return true;
}

// ── Per-IP rate limit for PSI + webhook-test endpoints ─────────────────────
// Both endpoints trigger expensive outbound HTTP work (PSI runs on Google's
// servers but counts against our quota; webhook-test pings a third party).
// Same shape as _ampRateLimit / _assistantRateLimit elsewhere in this file.
const _psiWhBuckets = new Map(); // ip -> { lastAt, count, windowStart }
function _psiWhRateLimit(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
  const now = Date.now();
  let b = _psiWhBuckets.get(ip);
  if (!b || now - b.windowStart > 60_000) { b = { lastAt: 0, count: 0, windowStart: now }; _psiWhBuckets.set(ip, b); }
  if (now - b.lastAt < 2_000)  { res.status(429).json({ ok:false, error:'rate-limited', message:'Please wait a couple of seconds between runs.' }); return false; }
  if (b.count >= 20)           { res.status(429).json({ ok:false, error:'rate-limited', message:'Per-minute limit reached (20/min). Try again shortly.' }); return false; }
  b.lastAt = now; b.count++;
  // Opportunistic GC — keep the map bounded
  if (_psiWhBuckets.size > 1000) {
    for (const [k, v] of _psiWhBuckets) if (now - v.windowStart > 120_000) _psiWhBuckets.delete(k);
  }
  return true;
}

// Dispatch alerts to all active webhook channels in parallel. Filters by
// minSeverity (default high). Errors per webhook are isolated. Fire-and-forget.
async function _dispatchWebhookDigest(tid, newAlerts, opts = {}) {
  if (tid == null) return { sent:false, reason:'no-tenant' };
  if (!Array.isArray(newAlerts) || !newAlerts.length) return { sent:false, reason:'no-alerts' };
  const minSev = opts.minSeverity || 'high';
  const sevRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const minRank = sevRank[minSev] != null ? sevRank[minSev] : 2;
  const eligible = newAlerts.filter(a => (sevRank[a.severity] != null ? sevRank[a.severity] : 0) >= minRank);
  if (!eligible.length) return { sent:false, reason:'no-eligible-severity' };
  const data = await _readWebhooks(tid);
  const active = (data.webhooks || []).filter(w => w.active !== false);
  if (!active.length) return { sent:false, reason:'no-webhooks' };
  const results = await Promise.allSettled(active.map(wh =>
    _sendOneWebhook(wh, eligible, opts.accountLabel || '')
  ));
  let okCount = 0, failCount = 0, failures = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') okCount++;
    else { failCount++; failures.push({ id: active[i].id, label: active[i].label, error: (r.reason && r.reason.message) || String(r.reason) }); }
  });
  await _webhookMutate(tid, async (d) => {
    d.lastDispatchAt = Date.now();
    for (const wh of d.webhooks) {
      const idx = active.findIndex(a => a.id === wh.id);
      if (idx < 0) continue;
      const r = results[idx];
      if (r.status === 'fulfilled') { wh.lastOkAt = Date.now(); wh.lastError = null; }
      else { wh.lastErrorAt = Date.now(); wh.lastError = ((r.reason && r.reason.message) || String(r.reason)).slice(0, 200); }
    }
    return d;
  });
  return { sent: okCount > 0, sentCount: okCount, failCount, failures, totalAlerts: eligible.length };
}

// ── Webhook CRUD endpoints ─────────────────────────────────────────────────
app.get('/api/webhooks/list', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'webhooks:list' });
  const d = await _readWebhooks(tid);
  // Mask URLs for safety on display (show only host + last 10 chars)
  const masked = (d.webhooks || []).map(w => {
    let urlMasked;
    try {
      const u = new URL(w.url);
      const tail = w.url.slice(-10);
      urlMasked = `${u.protocol}//${u.hostname}/…${tail}`;
    } catch { urlMasked = '…' + (w.url || '').slice(-10); }
    return { id: w.id, type: w.type, label: w.label, active: w.active !== false,
      addedAt: w.addedAt, lastOkAt: w.lastOkAt || 0, lastErrorAt: w.lastErrorAt || 0,
      lastError: w.lastError || null, urlMasked };
  });
  res.json({
    ok:true,
    webhooks: masked,
    types: _WEBHOOK_TYPES,
    lastDispatchAt: d.lastDispatchAt || 0,
    ..._WEBHOOKS_META
  });
});

app.post('/api/webhooks/add', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'webhooks:add' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const type = String(body.type || '').toLowerCase();
  const label = String(body.label || '').trim().slice(0, 80);
  const url = String(body.url || '').trim().slice(0, 500);
  if (!_WEBHOOK_TYPES.includes(type)) return res.status(400).json({ ok:false, error:`type must be one of: ${_WEBHOOK_TYPES.join(', ')}` });
  if (!label) return res.status(400).json({ ok:false, error:'label required' });
  const v = _validateWebhookUrl(type, url);
  if (!v.ok) return res.status(400).json({ ok:false, error: v.error });
  let added = null, dup = false;
  await _webhookMutate(tid, async (d) => {
    if (d.webhooks.some(w => w.url === url)) { dup = true; return false; }
    added = {
      id: 'whk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      type, label, url, active: true, addedAt: Date.now(),
      lastOkAt: 0, lastErrorAt: 0, lastError: null,
    };
    d.webhooks.unshift(added);
    return d;
  });
  if (dup) return res.status(409).json({ ok:false, error:'this URL is already configured' });
  // Don't echo the raw URL back — masked field only
  const safe = { ...added, urlMasked: '…' + url.slice(-10) };
  delete safe.url;
  res.json({ ok:true, webhook: safe, ..._WEBHOOKS_META });
});

app.post('/api/webhooks/remove', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'webhooks:remove' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const id = String((req.body && req.body.id) || '');
  if (!id) return res.status(400).json({ ok:false, error:'id required' });
  let removed = false;
  await _webhookMutate(tid, async (d) => {
    const before = d.webhooks.length;
    d.webhooks = d.webhooks.filter(w => w.id !== id);
    removed = d.webhooks.length < before;
    return d;
  });
  res.json({ ok:true, removed, ..._WEBHOOKS_META });
});

app.post('/api/webhooks/toggle', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'webhooks:toggle' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const id = String((req.body && req.body.id) || '');
  if (!id) return res.status(400).json({ ok:false, error:'id required' });
  let updated = null;
  await _webhookMutate(tid, async (d) => {
    const w = d.webhooks.find(x => x.id === id);
    if (w) { w.active = !w.active; updated = { id: w.id, active: w.active }; return d; }
    return false;
  });
  if (!updated) return res.status(404).json({ ok:false, error:'webhook not found' });
  res.json({ ok:true, ...updated, ..._WEBHOOKS_META });
});

app.post('/api/webhooks/test', async (req, res) => {
  if (!_psiWhRateLimit(req, res)) return;
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'webhooks:test' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const id = String((req.body && req.body.id) || '');
  if (!id) return res.status(400).json({ ok:false, error:'id required' });
  const data = await _readWebhooks(tid);
  const wh = data.webhooks.find(w => w.id === id);
  if (!wh) return res.status(404).json({ ok:false, error:'webhook not found' });
  const sample = [{
    id:'test-' + Date.now(), type:'rank_drop', severity:'high',
    title:'TEST · Sample alert from InfoGenie',
    body:'This is a test message — your alert webhook is wired up and reachable.',
    timestamp: Date.now()
  }];
  try {
    await _sendOneWebhook(wh, sample, 'TEST');
    await _webhookMutate(tid, async (d) => {
      const w = d.webhooks.find(x => x.id === id);
      if (w) { w.lastOkAt = Date.now(); w.lastError = null; return d; }
      return false;
    });
    res.json({ ok:true, sent:true, ..._WEBHOOKS_META });
  } catch (e) {
    await _webhookMutate(tid, async (d) => {
      const w = d.webhooks.find(x => x.id === id);
      if (w) { w.lastErrorAt = Date.now(); w.lastError = e.message.slice(0, 200); return d; }
      return false;
    });
    res.status(502).json({ ok:false, sent:false, error: e.message, ..._WEBHOOKS_META });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PAGESPEED INSIGHTS (Real Core Web Vitals via Google PSI v5 — no key required)
// ────────────────────────────────────────────────────────────────────────────
// Free Google API. Works without a key (rate-limited per IP).
// If GOOGLE_PAGESPEED_API_KEY is set we'll attach it for higher quotas.
async function _runPageSpeed(url, strategy = 'mobile', timeoutMs = 60000) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok:false, error:'valid URL required' };
  }
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (process.env.GOOGLE_PAGESPEED_API_KEY) params.set('key', process.env.GOOGLE_PAGESPEED_API_KEY);
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  try {
    const r = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    if (!r.ok || j.error) {
      return { ok:false, error: (j.error && j.error.message) || `HTTP ${r.status}` };
    }
    const lh = j.lighthouseResult || {};
    const audits = lh.audits || {};
    const cats = lh.categories || {};
    const perfScore = Math.round(((cats.performance && cats.performance.score) || 0) * 100);
    const num = (id) => audits[id] && audits[id].numericValue;
    const display = (id) => (audits[id] && audits[id].displayValue) || null;
    return {
      ok: true,
      strategy,
      finalUrl: lh.finalUrl || url,
      fetchedAt: Date.now(),
      score: perfScore,
      metrics: {
        lcp: { ms: num('largest-contentful-paint'),  display: display('largest-contentful-paint') },
        fcp: { ms: num('first-contentful-paint'),    display: display('first-contentful-paint') },
        cls: { value: num('cumulative-layout-shift'),display: display('cumulative-layout-shift') },
        tbt: { ms: num('total-blocking-time'),       display: display('total-blocking-time') },
        si:  { ms: num('speed-index'),               display: display('speed-index') },
        tti: { ms: num('interactive'),               display: display('interactive') },
      },
      opportunities: Object.values(audits)
        .filter(a => a && a.details && a.details.type === 'opportunity' && (a.numericValue || 0) > 0)
        .sort((a,b) => (b.numericValue || 0) - (a.numericValue || 0))
        .slice(0, 5)
        .map(a => ({ id: a.id, title: a.title, savingsMs: a.numericValue, display: a.displayValue || '' })),
    };
  } catch (e) {
    return { ok:false, error: e.message };
  }
}

app.post('/api/pagespeed/run', async (req, res) => {
  if (!_psiWhRateLimit(req, res)) return;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const rawUrl = String(body.url || '').trim();
  const strategy = (String(body.strategy || 'mobile').toLowerCase() === 'desktop') ? 'desktop' : 'mobile';
  if (!rawUrl) return res.status(400).json({ ok:false, error:'url required' });
  const fullUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : ('https://' + rawUrl);
  // SSRF guard — _isUrlSafeToFetch resolves DNS + checks _isPrivateIp on every
  // returned record, so it correctly blocks alternate IPv4 forms (decimal/hex/
  // octal), collapsed IPv6, and DNS-rebinding-style hostnames.
  const safety = await _isUrlSafeToFetch(fullUrl);
  if (!safety.ok) return res.status(400).json({ ok:false, error: safety.error });
  const result = await _runPageSpeed(fullUrl, strategy);
  if (!result.ok) {
    return res.status(502).json({
      ok:false, error: result.error,
      dataOrigin: 'google_pagespeed_insights_v5',
      dataSource: 'Google PageSpeed Insights API',
      confidence: 'high',
      transparency: 'PSI returned an error or could not fetch the URL — common causes: site returns 4xx/5xx to Google, very slow page, or PSI rate limit hit.',
    });
  }
  res.json({
    ok:true, ...result,
    dataOrigin: 'google_pagespeed_insights_v5',
    dataSource: process.env.GOOGLE_PAGESPEED_API_KEY ? 'Google PSI (with API key)' : 'Google PSI (no key — public quota)',
    confidence: 'high',
    transparency: `PSI score is Lighthouse-based, run by Google's servers. Strategy: ${strategy}.${process.env.GOOGLE_PAGESPEED_API_KEY ? '' : ' Set GOOGLE_PAGESPEED_API_KEY for higher rate limits.'}`,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// LAUNCH CALENDAR (Feature 6 — campaign launch tracker + 24h/1h reminders)
// ────────────────────────────────────────────────────────────────────────────
// Per-workspace launch store in kv: `launches:t<tid>`.
const _LAUNCH_BASE = 'launches';
const _LAUNCH_META = {
  dataOrigin: 'kv_store launches:t<tid> (per-workspace persistence) + setInterval 60s sweeper',
  dataSource: 'InfoGenie Launch Engine',
  confidence: 'high'
};
const _LAUNCH_CHANNELS = ['Email','Social','Paid Ad','PR','Mixed','Other'];
function _readLaunches(tid) {
  return _tkvRead(_LAUNCH_BASE, tid, () => ({ launches: [] }));
}
function _launchMutate(tid, mutator) {
  if (tid == null) return Promise.resolve();
  return _tkvMutate(_LAUNCH_BASE, tid, () => ({ launches: [] }), async (cur) => {
    const next = await mutator(cur);
    return next === false ? undefined : next;
  });
}

app.get('/api/launches/list', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'launches:list' });
  const d = await _readLaunches(tid);
  // Sort soonest first
  const launches = [...d.launches].sort((a,b) => (a.datetimeISO < b.datetimeISO ? -1 : 1));
  res.json({ ok:true, launches, channels: _LAUNCH_CHANNELS, now: Date.now(), ..._LAUNCH_META });
});

app.post('/api/launches/add', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'launches:add' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const name = String(body.name || '').trim().slice(0, 120);
  const datetimeISO = String(body.datetimeISO || '').trim();
  const channel = String(body.channel || 'Other').trim();
  const notes = String(body.notes || '').trim().slice(0, 400);
  if (!name) return res.status(400).json({ ok:false, error:'name required' });
  const ts = Date.parse(datetimeISO);
  if (!Number.isFinite(ts)) return res.status(400).json({ ok:false, error:'valid datetimeISO required' });
  if (ts < Date.now() - 60000) return res.status(400).json({ ok:false, error:'datetime must be in the future' });
  if (!_LAUNCH_CHANNELS.includes(channel)) return res.status(400).json({ ok:false, error:`channel must be one of: ${_LAUNCH_CHANNELS.join(', ')}` });
  const launch = {
    id: 'lnch_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8),
    name, channel, notes,
    datetimeISO: new Date(ts).toISOString(),
    status: 'scheduled',
    createdAt: Date.now(),
    reminders: { h24: false, h1: false, live: false }
  };
  await _launchMutate(tid, async (d) => { d.launches.push(launch); return d; });
  res.json({ ok:true, launch, ..._LAUNCH_META });
});

app.post('/api/launches/remove', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'launches:remove' });
  if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
  const id = String((req.body && req.body.id) || '');
  if (!id) return res.status(400).json({ ok:false, error:'id required' });
  let removed = false;
  await _launchMutate(tid, async (d) => {
    const before = d.launches.length;
    d.launches = d.launches.filter(l => l.id !== id);
    removed = d.launches.length < before;
    return d;
  });
  res.json({ ok:true, removed, ..._LAUNCH_META });
});

// Background sweeper — runs every 60s in-process. Iterates every active
// workspace (tenant); for each scheduled launch, fires a 24h-before reminder,
// a 1h-before reminder, and a "now live" alert. Pushes alerts into that
// workspace's alerts store and emails its stakeholders. Idempotent: each
// reminder fires at most once per launch via the reminders.{h24,h1,live} flags.
async function _sweepLaunches() {
  try {
    const tids = await _tkvCtx.listActiveTenantIds();
    for (const tid of tids) {
      await _sweepLaunchesForTenant(tid);
    }
  } catch (e) {
    console.warn('[launch-sweep] error:', e.message);
  }
}
async function _sweepLaunchesForTenant(tid) {
  try {
    const data = await _readLaunches(tid);
    if (!data.launches.length) return;
    const now = Date.now();
    const due = []; // alerts to push
    let mutated = false;
    await _launchMutate(tid, async (d) => {
      for (const l of d.launches) {
        const ts = Date.parse(l.datetimeISO);
        if (!Number.isFinite(ts)) continue;
        const msUntil = ts - now;
        // 24h reminder window: 23h–24h before launch
        if (!l.reminders.h24 && msUntil <= 24*60*60*1000 && msUntil > 23*60*60*1000) {
          l.reminders.h24 = true; mutated = true;
          due.push({
            id: `launch-24h-${l.id}-${now}`,
            type:'launch_reminder_24h', severity:'medium',
            title:`Launch in 24h: ${l.name}`,
            body:`"${l.name}" (${l.channel}) launches at ${new Date(ts).toUTCString()}. Final QA window opens now.`,
            launchId: l.id, timestamp: now, read:false
          });
        }
        // 1h reminder window: 55m–60m before launch
        if (!l.reminders.h1 && msUntil <= 60*60*1000 && msUntil > 55*60*1000) {
          l.reminders.h1 = true; mutated = true;
          due.push({
            id: `launch-1h-${l.id}-${now}`,
            type:'launch_reminder_1h', severity:'high',
            title:`Launch in 1h: ${l.name}`,
            body:`"${l.name}" (${l.channel}) goes live at ${new Date(ts).toUTCString()}. Confirm assets are queued and stakeholders are watching.`,
            launchId: l.id, timestamp: now, read:false
          });
        }
        // Live transition: 0–60s past launch
        if (!l.reminders.live && msUntil <= 0 && msUntil > -60*1000) {
          l.reminders.live = true; l.status = 'launched'; mutated = true;
          due.push({
            id: `launch-live-${l.id}-${now}`,
            type:'launch_live', severity:'high',
            title:`🚀 LIVE: ${l.name}`,
            body:`"${l.name}" (${l.channel}) is now live. Watch the first 24h closely — early signal beats late panic.`,
            launchId: l.id, timestamp: now, read:false
          });
        }
        // Late transition (server was down at the moment) — flip to launched silently
        if (!l.reminders.live && msUntil <= -60*1000 && l.status !== 'launched') {
          l.status = 'launched'; mutated = true;
        }
      }
      return mutated ? d : false;
    });
    if (due.length) {
      await _alertsMutate(tid, async (a) => {
        const seen = new Set(a.alerts.map(x => x.id));
        for (const x of due) if (!seen.has(x.id)) a.alerts.unshift(x);
        a.alerts = a.alerts.slice(0, 100);
        return a;
      });
      // Fire stakeholder emails async (helper applies its own atomic 30-min throttle)
      Promise.resolve()
        .then(() => _dispatchStakeholderDigest(tid, due, { minSeverity: 'medium', accountLabel: 'Launch reminder' }))
        .then(r => { if (r && r.sent) console.log(`[launch-sweep] dispatched ${r.sentCount} reminder digest(s)`); })
        .catch(e => console.warn('[launch-sweep] stakeholder dispatch failed:', e.message));
      // Parallel chat-webhook delivery for launch reminders
      if (typeof _dispatchWebhookDigest === 'function') {
        Promise.resolve()
          .then(() => _dispatchWebhookDigest(tid, due, { minSeverity: 'medium', accountLabel: 'Launch reminder' }))
          .then(r => { if (r && r.sent) console.log(`[launch-sweep] webhook dispatched to ${r.sentCount}/${r.sentCount + r.failCount} channels`); })
          .catch(e => console.warn('[launch-sweep] webhook dispatch failed:', e.message));
      }
    }
  } catch (e) {
    console.warn('[launch-sweep] error:', e.message);
  }
}
// Kick off the sweeper. 60s cadence is plenty given the 5-minute reminder windows above.
// Live server only; skipped when required as a module for tests (buildApp).
if (_runtimeFlags.backgroundEnabled()) {
  setInterval(_sweepLaunches, 60 * 1000);
  // Run once on boot to catch reminders that became due while the server was down
  setTimeout(_sweepLaunches, 5 * 1000);
}

// One-time boot migration (deferred 9s so the tenants/users schema is ready and
// getDefaultTenantId() resolves — otherwise it returns null this early and every
// step skips). Live server only; skipped when required as a module for tests.
if (_runtimeFlags.backgroundEnabled()) {
setTimeout(async () => {
  // Diag captures live on disk as data/diag-captures/<slug>.json — a directory,
  // never copied into kv by the (now-removed) legacy flat-file boot migration.
  // Move each capture (and the _latest pointer) into the default tenant's per-workspace
  // keys so the per-tenant diag-capture routes can still read prior captures.
  // Idempotent: skip entirely once any capture exists for the default tenant.
  try {
    const _db = require('./db');
    const _diagDir = path.join(__dirname, 'data', 'diag-captures');
    const diagTid = await _tkvCtx.getDefaultTenantId();
    if (diagTid && _db.hasDb() && fs.existsSync(_diagDir)) {
      const existing = await _tkvScope.listTenantPrefix(_DIAG_CAP_PREFIX, diagTid, 1);
      if (!existing.length) {
        let n = 0;
        for (const f of fs.readdirSync(_diagDir)) {
          if (!f.endsWith('.json') || f === '_latest.json') continue;
          try {
            const payload = JSON.parse(fs.readFileSync(path.join(_diagDir, f), 'utf8'));
            await _db.kvSet(`${_DIAG_CAP_PREFIX}t${diagTid}:${f.slice(0, -5)}`, payload);
            n++;
          } catch (e) { console.warn('[kv_scope] diag capture migrate', f, e.message); }
        }
        try {
          const latestPath = path.join(_diagDir, '_latest.json');
          if (fs.existsSync(latestPath)) {
            const ptr = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
            if (ptr && ptr.domain) await _db.kvSet(`${_DIAG_LATEST_KEY}:t${diagTid}`, { domain: ptr.domain, at: ptr.at || null });
          }
        } catch (e) { console.warn('[kv_scope] diag latest migrate', e.message); }
        if (n) console.log(`[kv_scope] migrated ${n} diag captures -> tenant ${diagTid}`);
      }
    }
  } catch (e) { console.warn('[kv_scope] diag-captures boot migration', e.message); }
}, 9000);
}

// ────────────────────────────────────────────────────────────────────────────
// AI CONTENT-GAP IDEATION (Feature 3)
// ────────────────────────────────────────────────────────────────────────────
// SSRF-safe fetch that re-validates every redirect hop
async function _safeFetchWithRedirects(url, { timeoutMs = 6000, maxHops = 3 } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    const safety = await _isUrlSafeToFetch(current);
    if (!safety.ok) return { ok:false, error: safety.error };
    let r;
    try {
      r = await fetch(current, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect:'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; InfoGenieBot/1.0; +https://infogenie.app)',
          'Accept': 'text/xml,application/xml,text/html,*/*;q=0.8',
        },
      });
    } catch (e) {
      return { ok:false, error: e.message };
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return { ok:false, error:'Redirect without location' };
      try { current = new URL(loc, current).toString(); } catch { return { ok:false, error:'Invalid redirect URL' }; }
      continue;
    }
    return { ok:true, response:r, finalUrl: current };
  }
  return { ok:false, error:'Too many redirects' };
}

async function _fetchSitemapSlugs(host) {
  // Build candidate list: bare host + www. variant + common sitemap paths,
  // plus any "Sitemap:" lines we can extract from robots.txt up-front so a
  // CDN-redirect or non-standard path doesn't blank the page.
  const hosts = host.startsWith('www.') ? [host, host.slice(4)] : [host, 'www.' + host];
  const tryUrls = [];
  const robotsSitemaps = [];
  for (const h of hosts) {
    try {
      const robotsRes = await _safeFetchWithRedirects(`https://${h}/robots.txt`, { timeoutMs: 5000 });
      if (robotsRes.ok && robotsRes.response.ok) {
        const txt = await robotsRes.response.text();
        for (const m of txt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
          const u = m[1].trim();
          if (/^https?:\/\//i.test(u)) robotsSitemaps.push(u);
        }
        if (robotsSitemaps.length) break; // first host that gave us robots.txt is enough
      }
    } catch { /* try next */ }
  }
  for (const u of robotsSitemaps.slice(0, 4)) tryUrls.push(u);
  for (const h of hosts) {
    tryUrls.push(
      `https://${h}/sitemap.xml`,
      `https://${h}/sitemap_index.xml`,
      `https://${h}/sitemap-index.xml`,
      `https://${h}/wp-sitemap.xml`,
      `https://${h}/sitemap1.xml`,
    );
  }
  for (const url of tryUrls) {
    try {
      const result = await _safeFetchWithRedirects(url, { timeoutMs: 6000 });
      if (!result.ok || !result.response.ok) continue;
      const text = await result.response.text();
      const locs = Array.from(text.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi))
        .map(m => m[1].trim())
        .slice(0, 80);
      if (!locs.length) continue;
      if (locs[0].toLowerCase().endsWith('.xml')) {
        try {
          const r2 = await _safeFetchWithRedirects(locs[0], { timeoutMs: 6000 });
          if (r2.ok && r2.response.ok) {
            const t2 = await r2.response.text();
            const nested = Array.from(t2.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi))
              .map(m => m[1].trim())
              .slice(0, 100);
            if (nested.length) return nested;
          }
        } catch {}
      }
      return locs;
    } catch (e) { /* try next URL pattern */ }
  }
  return [];
}

function _slugSummaries(urls) {
  const out = [];
  for (const u of urls) {
    try {
      const p = new URL(u).pathname.toLowerCase();
      const slug = p.split('/').filter(Boolean).join(' ').replace(/[-_.]/g, ' ').slice(0, 100);
      if (slug && slug.length > 2) out.push(slug);
    } catch {}
  }
  return [...new Set(out)].slice(0, 80);
}

// Fallback when a competitor's sitemap is blocked (Cloudflare, no /sitemap.xml,
// etc.) — pull their top organic-ranking URLs from DataForSEO and treat those
// as a proxy "page list". This guarantees every competitor contributes
// something to the AI gap analysis instead of being silently dropped.
async function _fetchRankedPageUrls(domain) {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) return [];
  try {
    const raw = await callDataForSEO('/v3/dataforseo_labs/google/ranked_keywords/live',
      [{ target: domain, language_code:'en', location_code:2840, limit: 100,
         filters:[['ranked_serp_element.serp_item.rank_group','<=', 30]] }],
      12000);
    if (!raw || raw.status_code !== 20000) return [];
    const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
    const urls = items
      .map(it => it?.ranked_serp_element?.serp_item?.url)
      .filter(Boolean);
    return [...new Set(urls)].slice(0, 80);
  } catch (e) {
    console.warn(`[content-gaps] DFS fallback failed for ${domain}:`, e.message);
    return [];
  }
}

app.post('/api/content-gaps', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const domain = String(body.domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
    if (!domain) return res.status(400).json({ ok:false, error:'domain-required' });

    const competitors = (Array.isArray(body.competitors) ? body.competitors : [])
      .map(c => String(c || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0])
      .filter(Boolean)
      .slice(0, 8);

    if (!competitors.length) return res.status(400).json({ ok:false, error:'competitors-required' });

    const [yourPages, ...compPages] = await Promise.all([
      _fetchSitemapSlugs(domain),
      ...competitors.map(_fetchSitemapSlugs)
    ]);

    let youSummary = _slugSummaries(yourPages);
    const compSummary = competitors.map((c, i) => {
      const slugs = _slugSummaries(compPages[i]);
      return { domain: c, slugs, source: slugs.length ? 'sitemap' : null };
    });

    // Fallback path: for any competitor whose sitemap returned nothing
    // (Cloudflare-protected, no /sitemap.xml, etc.), pull their top organic
    // ranking URLs from DataForSEO and treat those as a proxy page list. Run
    // all fallbacks in parallel so we don't add serial latency.
    const needFallback = compSummary.filter(c => !c.slugs.length);
    // Also apply the same fallback to your own domain if its sitemap is blocked.
    const needYourFallback = !youSummary.length;
    const fallbackPromises = [
      ...(needYourFallback ? [_fetchRankedPageUrls(domain)] : [Promise.resolve([])]),
      ...needFallback.map(c => _fetchRankedPageUrls(c.domain))
    ];
    if (needYourFallback || needFallback.length) {
      const domainsBlocked = [...(needYourFallback ? [domain] : []), ...needFallback.map(c=>c.domain)];
      console.log(`[content-gaps] sitemap blocked for ${domainsBlocked.length} domain(s) — trying DataForSEO fallback:`, domainsBlocked.join(', '));
      const fbResults = await Promise.all(fallbackPromises);
      if (needYourFallback) {
        const slugs = _slugSummaries(fbResults[0]);
        if (slugs.length) {
          youSummary = slugs;
          console.log(`[content-gaps] DFS fallback recovered ${slugs.length} pages for your domain ${domain}`);
        }
      }
      needFallback.forEach((c, i) => {
        const slugs = _slugSummaries(fbResults[needYourFallback ? i + 1 : i]);
        if (slugs.length) {
          c.slugs = slugs;
          c.source = 'dataforseo-ranked';
          console.log(`[content-gaps] DFS fallback recovered ${slugs.length} pages for ${c.domain}`);
        }
      });
    }

    const haveAnyComp = compSummary.some(c => c.slugs.length);

    if (!youSummary.length || !haveAnyComp) {
      const blocked = [];
      if (!youSummary.length) blocked.push(domain);
      for (const c of compSummary) if (!c.slugs.length) blocked.push(c.domain);
      const yourBlocked = !youSummary.length;
      return res.status(404).json({
        ok:false, error:'sitemap-unavailable',
        detail: yourBlocked
          ? `We couldn't read the sitemap or ranked pages for "${domain}" — the site may be too new, bot-protected, or not indexed. Try the www. variant or enter your domain manually.`
          : `We couldn't read sitemaps for: ${blocked.join(', ')}. These sites are bot-protected or don't publish a sitemap. Remove them from the list and try again.`,
        blockedDomains: blocked,
        yourPages: youSummary.length,
        competitorsWithSitemap: compSummary.filter(c => c.slugs.length).map(c => c.domain)
      });
    }

    const completion = await openaiChatWithRetry({
      model:'gpt-5-mini',
      messages:[
        { role:'system', content:`You are an SEO content strategist. You receive page-slug lists from a target domain and competitors. Identify the top 8 topic clusters competitors cover that the target does NOT cover (or covers thinly). Output strict JSON: { "gaps": [{ "topic": "...", "rationale": "what evidence in competitor slugs supports this", "suggested_angle": "one specific content angle the target should take", "competitors_covering": ["competitor1.com"], "priority": 1-10 }] }. Be specific — name the actual topic, never generic categories like "blog posts" or "guides". Skip topics already in the target's slugs. Priority 10 = highest opportunity.` },
        { role:'user', content: JSON.stringify({ target:{ domain, slugs:youSummary }, competitors:compSummary }).slice(0, 14000) }
      ],
      response_format:{ type:'json_object' },
      temperature:0.3,
      max_tokens:2000
    }, { fallbackModel:'gpt-3.5-turbo', retries:2 });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const gaps = (Array.isArray(parsed && parsed.gaps) ? parsed.gaps : [])
      .filter(g => g && g.topic)
      .map(g => ({
        topic: String(g.topic).slice(0, 120),
        rationale: String(g.rationale || '').slice(0, 400),
        suggested_angle: String(g.suggested_angle || '').slice(0, 280),
        competitors_covering: Array.isArray(g.competitors_covering) ? g.competitors_covering.slice(0, 4).map(String) : [],
        priority: typeof g.priority === 'number' ? Math.max(1, Math.min(10, g.priority)) : 5
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 12);

    const sitemapCount = compSummary.filter(c => c.source === 'sitemap').length;
    const fallbackCount = compSummary.filter(c => c.source === 'dataforseo-ranked').length;
    const analyzedCount = sitemapCount + fallbackCount;
    const originParts = [];
    if (sitemapCount)  originParts.push(`Sitemap analysis (${sitemapCount} competitor${sitemapCount===1?'':'s'})`);
    if (fallbackCount) originParts.push(`DataForSEO ranking pages (${fallbackCount} competitor${fallbackCount===1?'':'s'})`);
    res.json({
      ok:true, domain, competitors, gaps,
      yourPagesAnalyzed: youSummary.length,
      competitorPagesAnalyzed: compSummary.reduce((s, c) => s + c.slugs.length, 0),
      competitorsAnalyzed: analyzedCount,
      competitorsWithSitemap: compSummary.filter(c => c.source === 'sitemap').map(c => c.domain),
      competitorsViaFallback: compSummary.filter(c => c.source === 'dataforseo-ranked').map(c => c.domain),
      competitorsBlocked: compSummary.filter(c => !c.slugs.length).map(c => c.domain),
      dataOrigin: `${originParts.join(' + ')} + AI gap classification`,
      dataSource:'AI-verified',
      confidence: gaps.length >= 5 ? 'high' : gaps.length >= 2 ? 'medium' : 'low'
    });
  } catch (err) {
    console.error('/api/content-gaps error:', err.message);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CROSS-CHANNEL REPORTING (Feature 4)
// GET /api/cross-channel-report?days=30&domain=&brand=
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/cross-channel-report', async (req, res) => {
  try {
    const days   = Math.max(7, Math.min(90, parseInt(req.query.days, 10) || 30));
    const domain = String(req.query.domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
    const brand  = String(req.query.brand || '').trim().slice(0, 80);

    const [meta, google, tiktok, microsoft] = await Promise.all([
      _fetchMetaSpend(days),
      _fetchGoogleAdsSpend(days),
      _fetchTikTokSpend(days),
      _fetchMicrosoftSpend(days),
    ]);
    const paidChannels = [
      { name:'Meta Ads',       icon:'📘', ...meta      },
      { name:'Google Ads',     icon:'🟢', ...google    },
      { name:'TikTok Ads',     icon:'⬛', ...tiktok    },
      { name:'Microsoft Ads',  icon:'🅱️', ...microsoft },
    ];
    const totalSpend       = paidChannels.filter(c => c.ok).reduce((s, c) => s + (c.spend       || 0), 0);
    const totalImpressions = paidChannels.filter(c => c.ok).reduce((s, c) => s + (c.impressions || 0), 0);
    const totalClicks      = paidChannels.filter(c => c.ok).reduce((s, c) => s + (c.clicks      || 0), 0);
    const totalConv        = paidChannels.filter(c => c.ok).reduce((s, c) => s + (c.conversions || 0), 0);
    const blendedCPC       = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const blendedCPA       = totalConv   > 0 ? totalSpend / totalConv   : 0;

    let organic = { ok:false };
    if (domain && process.env.DATAFORSEO_LOGIN) {
      try {
        const raw = await callDataForSEO(
          '/v3/dataforseo_labs/google/domain_rank_overview/live',
          [{ target:domain, language_name:'English', location_name:'United States' }],
          9000
        );
        const item = raw?.tasks?.[0]?.result?.[0]?.items?.[0];
        if (item) {
          organic = {
            ok:true,
            organicTraffic: Math.round(item?.metrics?.organic?.etv || 0),
            organicKeywords: item?.metrics?.organic?.count || 0,
            paidTraffic: Math.round(item?.metrics?.paid?.etv || 0),
            paidKeywords: item?.metrics?.paid?.count || 0
          };
        }
      } catch (e) { organic = { ok:false, error:e.message }; }
    }

    let earned = { ok:false };
    if (brand && process.env.DATAFORSEO_LOGIN) {
      try {
        const raw = await callDataForSEO(
          '/v3/serp/google/news/live/advanced',
          [{ keyword:`"${brand}"`, language_code:'en', location_code:2840, depth:20 }],
          7000
        );
        const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
        const cutoff = Date.now() - days * 86400 * 1000;
        const recent = items.filter(it => {
          const t = it.timestamp ? Date.parse(it.timestamp) : 0;
          return isNaN(t) ? true : t >= cutoff;
        });
        earned = { ok:true, mentions: recent.length, total: items.length };
      } catch (e) { earned = { ok:false, error:e.message }; }
    }

    let summary = '';
    const livePaid = paidChannels.filter(c => c.ok);
    try {
      const completion = await openaiChatWithRetry({
        model:'gpt-5-mini',
        messages:[
          { role:'system', content:'You are a CMO advisor writing a 3-4 sentence executive summary of cross-channel performance. Identify the strongest channel, the weakest, and one concrete next-step recommendation. Be direct, no fluff. Cite which channels are reporting; reference organic visibility or earned media if present.' },
          { role:'user', content: JSON.stringify({
            days,
            paid: livePaid.map(c => ({ channel:c.name, spend:c.spend, clicks:c.clicks, conversions:c.conversions, cpa: c.conversions>0?c.spend/c.conversions:null })),
            paid_totals: { spend:totalSpend, clicks:totalClicks, conversions:totalConv, cpa: blendedCPA },
            organic, earned,
            disconnected: paidChannels.filter(c => !c.ok).map(c => c.name)
          }).slice(0, 8000) }
        ],
        temperature:0.4,
        max_tokens:400
      }, { fallbackModel:'gpt-3.5-turbo', retries:2 });
      summary = completion.choices[0].message.content || '';
    } catch (e) {
      summary = livePaid.length
        ? `(AI summary unavailable: ${e.message})`
        : 'No paid channels are reporting yet. Connect Meta, Google Ads, or TikTok credentials in your environment to see a unified report.';
    }

    res.json({
      ok:true, days,
      paid: { channels: paidChannels, totals: { spend:+totalSpend.toFixed(2), impressions:totalImpressions, clicks:totalClicks, conversions:totalConv, cpc:+blendedCPC.toFixed(2), cpa:+blendedCPA.toFixed(2) } },
      organic, earned, summary,
      dataOrigin: livePaid.length
        ? `Live data from ${livePaid.map(c => c.name).join(', ')}${organic.ok ? ' + DataForSEO organic' : ''}${earned.ok ? ' + Google News earned media' : ''} + AI summary`
        : 'No paid channels connected',
      dataSource: livePaid.length ? 'Live API' : 'partial',
      confidence: livePaid.length >= 2 ? 'high' : livePaid.length === 1 ? 'medium' : 'low'
    });
  } catch (err) {
    console.error('/api/cross-channel-report error:', err.message);
    res.status(500).json({ ok:false, error: err.message });
  }
});
};
