// Drip enrollment · stats · webhooks routes.
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
  const { _dripLoad, _dripLock, _dripSave, _dripUnsubscribe, _enrollDripCore, _tkvCtx, anthropic, openaiChatWithRetry, path } = ctx;

app.post('/api/drips/enroll', async (req, res) => {
  try {
    const { contacts, sequence, brand, dryRun, appOrigin } = req.body || {};
    if (!Array.isArray(contacts) || !contacts.length) {
      return res.status(400).json({ ok: false, error: 'contacts array required' });
    }
    if (!Array.isArray(sequence) || !sequence.length) {
      return res.status(400).json({ ok: false, error: 'sequence array required' });
    }
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'drips:enroll' });
    if (tid == null) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const result = await _enrollDripCore(tid, { contacts, sequence, brand, dryRun, appOrigin });
    res.json({ ok: true, enrolled: result.created.length, skipped: result.skipped, created: result.created });
  } catch (err) {
    console.error('/api/drips/enroll error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/drips ─ list all enrollments (most recent first), optionally filtered
app.get('/api/drips', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'drips:list' });
  if (tid == null) return res.json({ ok: true, count: 0, enrollments: [] });
  const list = (await _dripLoad(tid)).sort((a,b) => (b.startedAt||0) - (a.startedAt||0));
  const status = (req.query.status || '').toString();
  const filtered = status ? list.filter(e => e.status === status) : list;
  res.json({ ok: true, count: filtered.length, enrollments: filtered.slice(0, 200) });
});

// ── GET /api/drips/stats ─ aggregate counters for the live UI panel
// Includes deliverability metrics: sent, delivered, bounced, complained,
// bounce rate (%) and complaint rate (%). Only email-channel sends are
// counted toward deliverability — non-email channels (SMS, ads, etc.) are
// excluded so the rates reflect actual email performance.
app.get('/api/drips/stats', async (req, res) => {
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'drips:stats' });
  const list = tid == null ? [] : await _dripLoad(tid);
  const stats = {
    total: list.length, active: 0, paused: 0, completed: 0, cancelled: 0, unsubscribed: 0,
    sentTotal: 0, failedTotal: 0,
    emailAttempts: 0, emailDelivered: 0, emailBounced: 0, emailComplained: 0,
    bounceRate: 0, complaintRate: 0,
  };
  for (const e of list) {
    stats[e.status] = (stats[e.status] || 0) + 1;
    for (const h of (e.history || [])) {
      if (h.ok) stats.sentTotal++; else stats.failedTotal++;
      // Deliverability is only meaningful for email-channel attempts that
      // weren't dry-run. Skip everything else.
      if (!/email/i.test(h.channel || '')) continue;
      if (h.note && /dry-run/i.test(h.note))    continue;
      stats.emailAttempts++;
      if (h.bounced || h.failureType === 'bounce') stats.emailBounced++;
      else if (h.failureType === 'complaint')      stats.emailComplained++;
      else if (h.delivered === true)               stats.emailDelivered++;
      else if (h.ok && !h.bounced)                 stats.emailDelivered++; // optimistic until webhook says otherwise
    }
  }
  if (stats.emailAttempts > 0) {
    stats.bounceRate    = Math.round((stats.emailBounced    / stats.emailAttempts) * 1000) / 10;
    stats.complaintRate = Math.round((stats.emailComplained / stats.emailAttempts) * 1000) / 10;
  }
  res.json({ ok: true, stats });
});

// ── POST /api/drips/:id/(pause|resume|cancel)
// Validate action FIRST so this dynamic route doesn't shadow sibling static
// routes like /api/drips/webhook/resend.
app.post('/api/drips/:id/:action', async (req, res, next) => {
  const { id, action } = req.params;
  if (!['pause','resume','cancel'].includes(action)) return next();
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'drips:action' });
  if (tid == null) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const result = await _dripLock(async () => {
    const list = await _dripLoad(tid);
    const enr = list.find(e => e.id === id);
    if (!enr) return { notFound: true };
    if (action === 'pause')       enr.status = 'paused';
    else if (action === 'resume') enr.status = 'active';
    else if (action === 'cancel') enr.status = 'cancelled';
    await _dripSave(tid, list);
    return { enr };
  });
  if (result.notFound) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, enrollment: result.enr });
});

// ── GET /api/drips/unsubscribe?email=... ─ public unsubscribe (no auth)
// Returns a small HTML page so the link in the email works in any browser.
app.get('/api/drips/unsubscribe', async (req, res) => {
  // Single-tenant, bounded unsubscribe (see services/drips/unsubscribe.js).
  // Never fans out across workspaces — modern links carry `t`, legacy links
  // fall back to the default/owner tenant only.
  const r = await _dripUnsubscribe.unsubscribeEmail({
    email: req.query.email,
    tParam: req.query.t,
    store: global._dripStore,
    ctx: _tkvCtx,
  });
  if (!r.ok) return res.status(400).send('Missing email parameter');
  const email = r.email;
  const touched = r.touched;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html><head><title>Unsubscribed</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="font-family:-apple-system,sans-serif;background:#F3F4F6;margin:0;padding:60px 20px;text-align:center">
      <div style="max-width:420px;margin:0 auto;background:white;border-radius:14px;padding:36px 28px;box-shadow:0 2px 16px rgba(0,0,0,.06)">
        <div style="font-size:2.2rem;margin-bottom:10px">✓</div>
        <h1 style="font-size:1.2rem;color:#0A1628;margin:0 0 10px">You're unsubscribed</h1>
        <p style="color:#6B7280;font-size:.92rem;margin:0">${email} will no longer receive drip-campaign emails from InfoGenie. ${touched} active sequence${touched===1?'':'s'} stopped.</p>
      </div></body></html>`);
});

// ── POST /api/drips/webhook/resend ──────────────────────────────────────────
// Receives async deliverability events from Resend. Configure this URL in
// the Resend dashboard (Webhooks → Add endpoint). Supported event types:
//   email.delivered  → marks the matching history entry delivered:true
//   email.bounced    → marks bounced:true (counts toward bounce rate)
//   email.complained → marks complaint:true (counts toward complaint rate)
// Matching is by Resend's message id (entry.providerId). If no match, the
// event is ignored quietly so retries don't pile up.
//
// Security: when RESEND_WEBHOOK_SECRET is set we verify the Svix-style
// signature header (Resend uses Svix under the hood) over the RAW request
// body. Without verification an attacker who knows a message id could mark
// real sends as bounced/complained and poison deliverability metrics — so
// in production this secret MUST be configured.
const _crypto = require('crypto');
function _verifyResendWebhook(req) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'RESEND_WEBHOOK_SECRET not configured' };
  const id        = req.get('svix-id') || req.get('webhook-id');
  const timestamp = req.get('svix-timestamp') || req.get('webhook-timestamp');
  const sigHeader = req.get('svix-signature') || req.get('webhook-signature');
  if (!id || !timestamp || !sigHeader) return { ok: false, reason: 'missing signature headers' };
  // Reject events older than 5 minutes (replay protection)
  const tsNum = parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now()/1000 - tsNum) > 300) return { ok: false, reason: 'stale timestamp' };
  const raw = req.rawBody || JSON.stringify(req.body || {});
  const signedPayload = `${id}.${timestamp}.${raw}`;
  // Resend secret looks like "whsec_..." — strip prefix, base64-decode
  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret);
  const expected = _crypto.createHmac('sha256', key).update(signedPayload).digest('base64');
  // Header is space-separated list of "v1,<sig>" pairs — any matching one wins
  const sigs = sigHeader.split(' ').map(s => s.split(',')[1]).filter(Boolean);
  const match = sigs.some(s => {
    try { return _crypto.timingSafeEqual(Buffer.from(s, 'base64'), Buffer.from(expected, 'base64')); }
    catch { return false; }
  });
  return match ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

app.post('/api/drips/webhook/resend', async (req, res) => {
  try {
    // Only enforce signature verification when a secret is configured.
    // Returning 401 (vs 200) when the secret is set prevents Resend from
    // silently treating spoofed events as accepted.
    if (process.env.RESEND_WEBHOOK_SECRET) {
      const v = _verifyResendWebhook(req);
      if (!v.ok) {
        console.warn('[drip] webhook rejected:', v.reason);
        return res.status(401).json({ ok: false, error: v.reason });
      }
    }
    const evt = req.body || {};
    const type = String(evt.type || evt.event || '').toLowerCase();
    const data = evt.data || evt;
    const msgId = data.email_id || data.id || data.message_id;
    if (!msgId) return res.json({ ok: true, ignored: 'no message id' });
    // Resend's event only carries the message id, not the tenant — walk every
    // active workspace and update wherever the providerId matches.
    let tids = [];
    try { tids = await _tkvCtx.listActiveTenantIds(); } catch (_) { tids = []; }
    const matched = await _dripLock(async () => {
      let n = 0;
      for (const tid of tids) {
        const list = await _dripLoad(tid);
        let changed = false;
        for (const enr of list) {
          for (const h of (enr.history || [])) {
            if (h.providerId !== msgId) continue;
            n++; changed = true;
            if (type.includes('delivered'))      { h.delivered = true; h.deliveredAt = Date.now(); }
            else if (type.includes('bounced'))   { h.bounced   = true; h.bouncedAt   = Date.now(); h.failureType = 'bounce';    h.bounceReason = (data.bounce && data.bounce.message) || ''; }
            else if (type.includes('complain'))  { h.complaint = true; h.complaintAt = Date.now(); h.failureType = 'complaint'; }
            else if (type.includes('opened'))    { h.opened    = true; h.openedAt    = Date.now(); }
            else if (type.includes('clicked'))   { h.clicked   = true; h.clickedAt   = Date.now(); }
          }
        }
        if (changed) await _dripSave(tid, list);
      }
      return n;
    });
    res.json({ ok: true, matched });
  } catch (err) {
    console.error('/api/drips/webhook/resend error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/ai-validate-metrics ────────────────────────────────────────────
// Takes a list of competitors (each with whatever metrics we already have from
// DataForSEO + AI detection) and asks GPT-4o-mini to validate / refine the
// numbers based on its training-data knowledge of the brands.
//
// For well-known public brands (Stripe, Shopify, eToro, Plus500, XM, etc.) the
// model returns realistic numbers from public sources (Similarweb estimates,
// earnings reports, news). For lesser-known SMBs it returns conservative
// industry-benchmark estimates with `confidence: "low"` instead of guessing.
//
// Body:  { competitors: [{name, domain, currentTraffic, currentAdSpend,
//          currentROAS, currentCTR, dataSource}], industry: "Forex Trading" }
// Returns: { results: [{ name, traffic, adSpend, roas, ctr, confidence,
//            source, notes }] }
app.post('/api/ai-validate-metrics', async (req, res) => {
  try {
    const { competitors, industry } = req.body || {};
    if (!Array.isArray(competitors) || !competitors.length) {
      return res.status(400).json({ error: 'competitors array required' });
    }
    // Use the SAME env var the OpenAI client was initialised from at boot,
    // otherwise the gate passes but the client calls OpenAI with 'dummy'.
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OpenAI not configured', results: [] });
    }

    const list = competitors.slice(0, 12).map((c, i) =>
      `${i+1}. ${c.name || c.domain} (${c.domain || 'no domain'})\n` +
      `   Currently shown: traffic=${c.currentTraffic || 'unknown'}, ` +
      `adSpend=${c.currentAdSpend || 'unknown'}, ` +
      `ROAS=${c.currentROAS || 'unknown'}, CTR=${c.currentCTR || 'unknown'}` +
      (c.dataSource ? `  [source: ${c.dataSource}]` : '')
    ).join('\n');

    // ── Shared analyst prompt — used for BOTH OpenAI GPT-4o and Anthropic
    //    Claude Sonnet 4.6 so the two models can be compared head-to-head.
    //    The same schema lets us merge their answers into a consensus value.
    const buildPrompt = (modelName) => `You are a senior digital-marketing analyst with deep, brand-specific knowledge of public web traffic, monthly paid-media spend, and ROAS/CTR performance for major brands. You are grading a list of competitors in the "${industry || 'unknown'}" industry.

For EACH of the ${Math.min(competitors.length, 12)} competitors below, return REALISTIC monthly metrics grounded ONLY in what you actually know about that specific brand from public sources (Similarweb, SemRush, Ahrefs, company earnings reports, ad-tech trade press, AdSpyder, MediaRadar, Pathmatics).

Competitors:
${list}

Return JSON in EXACTLY this shape:
{
  "results": [
    {
      "name": "<exact name from list>",
      "traffic":  "1.2M" | "350K" | "45K" | null,         // monthly visits
      "adSpend":  "$45K/mo" | "$2.1M/mo" | null,           // monthly ad budget estimate (Google + Meta + TikTok + LinkedIn + display + native, combined)
      "roas":     3.2 | null,                              // number 1.0–8.0
      "ctr":      "2.8%" | null,                           // typical paid-ad CTR
      "topChannel": "Google Search" | "Meta Ads" | "TikTok Ads" | "LinkedIn Ads" | "YouTube" | "Display / Programmatic" | "SEO / Organic" | null,
      "confidence": "high" | "medium" | "low",
      "source":   "Brief 1-line citation — use a SOURCE CATEGORY only, NEVER a specific date or quarter. Examples: 'Similarweb estimate', 'Public earnings report', 'Industry benchmark', 'SemRush data', 'Trade-press estimate'. Do NOT write 'Q4 2023' or any year/quarter — the user sees the citation as a freshness signal and stale dates damage trust.",
      "notes":    "Any caveat (max 80 chars), or empty"
    }
  ]
}

CRITICAL ACCURACY RULES — your output is being cross-checked against another LLM and the user sees the discrepancy:
- If you DO NOT recognise the brand specifically, return null for traffic + adSpend + topChannel and set confidence to "low". DO NOT make up a number from "industry benchmark" — the user is paying for accuracy, not averages.
- The "Currently shown" numbers come from a DataForSEO scrape that **systematically OVER-estimates ad-spend** because it sums potential CPC × CTR across ALL ranking keywords as if the brand paid for every position. For high-SEO domains this is often 10–30× the real ad-budget. So if you see e.g. "adSpend=$60M/mo" for eToro (real ~$3-4M/mo), RETURN THE REALISTIC FIGURE — do NOT echo back the inflated DataForSEO number.
- Traffic numbers from DataForSEO are usually within 2-5× of reality. Trust your training-data Similarweb knowledge over the input.
- Realistic monthly ad-spend ranges (sanity check):
    Mid-cap fintech / broker (Plus500, FXTM, XM, AvaTrade, Pepperstone): $0.5M–3M/mo
    Large-cap fintech (eToro, IG, CMC, Interactive Brokers, Stripe): $1M–8M/mo
    Mega-cap (PayPal, Coinbase, Robinhood): $5M–25M/mo
    Mid-market SaaS (Notion, Asana, Calendly, Monday): $50K–500K/mo
    Indie / small SaaS or regional broker: $5K–50K/mo
    DTC mid-tier (Allbirds, Glossier, Warby Parker): $0.5M–5M/mo
- "topChannel" must be the channel where this brand actually invests the MOST budget — based on your knowledge of their media mix, not a guess. If you don't know, return null.
- Traffic format: "1.2M" or "350K" or "45K". AdSpend format: "$45K/mo" or "$1.2M/mo".
- ROAS: a single number 1.0-8.0. CTR: "2.8%" (typically 1.5%-6% for paid).
- "high" confidence ONLY if you have specific knowledge of this brand from your training data.
- "medium" if extrapolating from direct category peers you DO know.
- "low" for industry-benchmark estimates (and please prefer null over a benchmark guess).
- Output array MUST be in the SAME order and SAME names as the input list.

Model identity: you are ${modelName}. Output strict JSON only.`;

    // ── Run GPT-4o and Claude Sonnet 4.6 in PARALLEL ──────────────────────
    // Each model returns its own opinion; we merge them into a consensus
    // afterward. This dual-LLM approach catches single-model hallucinations
    // and gives us a confidence boost when both agree on a number.
    const gptPromise = openaiChatWithRetry({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: buildPrompt('GPT-4o') }],
      response_format: { type: 'json_object' },
      temperature: 0.15,
      max_tokens: 2400
    }, { fallbackModel: 'gpt-4o-mini', retries: 1 })
      .then(c => JSON.parse(c.choices?.[0]?.message?.content || '{}'))
      .catch(e => { console.log('[ai-validate-metrics] GPT-4o failed:', e.status || '', e.message); return null; });

    const claudePromise = (async () => {
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2400,
          temperature: 0.15,
          system: 'You are a precise market-intelligence analyst. Output strict JSON matching the user-specified schema. Never include markdown code fences.',
          messages: [{ role: 'user', content: buildPrompt('Claude Sonnet') }]
        });
        const raw = msg.content?.[0]?.text || '{}';
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        // Extract first {...} block in case the model added prose
        const m = cleaned.match(/\{[\s\S]*\}/);
        return JSON.parse(m ? m[0] : cleaned);
      } catch (e) {
        console.log('[ai-validate-metrics] Claude failed:', e.status || '', e.message, '| body:', JSON.stringify(e.error || e.response?.data || '').slice(0, 300));
        return null;
      }
    })();

    const [gptResult, claudeResult] = await Promise.all([gptPromise, claudePromise]);

    // Lightweight visibility: how many rows did each model return?
    console.log('[ai-validate-metrics] gpt:',
                Array.isArray(gptResult?.results) ? `${gptResult.results.length} rows` : 'failed',
                '| claude:',
                Array.isArray(claudeResult?.results) ? `${claudeResult.results.length} rows` : 'failed');

    // Build name-keyed lookup from each LLM's output.
    // Claude sometimes echoes the prompt format "Plus500 (plus500.com)" as
    // the name while GPT-4o returns just "Plus500". Normalise by stripping
    // any trailing "(...)" parenthetical and lower-casing.
    const norm = s => String(s || '')
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/, '')   // drop trailing "(domain)"
      .replace(/[^a-z0-9]+/g, '')         // drop punctuation/spaces for fuzzy match
      .trim();
    const gptByName = {};
    (Array.isArray(gptResult?.results) ? gptResult.results : []).forEach(r => {
      if (r && r.name) gptByName[norm(r.name)] = r;
    });
    const claudeByName = {};
    (Array.isArray(claudeResult?.results) ? claudeResult.results : []).forEach(r => {
      if (r && r.name) claudeByName[norm(r.name)] = r;
    });

    // ── Helpers for merging the two LLM opinions ──────────────────────────
    // Note: keep M/K/B suffixes intact — strip ONLY currency, commas, spaces,
    // and the trailing "/mo" or "/month" tokens. Earlier version stripped M/m
    // along with the slash + "mo" which silently lost the millions multiplier.
    const parseSpend = (s) => {
      if (s === null || s === undefined) return null;
      const txt = String(s)
        .replace(/\/\s*(mo|month|m)\b/gi, '')   // strip "/mo", "/month", "/m"
        .replace(/[$,\s]/g, '')                  // strip $ , whitespace
        .toUpperCase();
      const n = parseFloat(txt);
      if (!isFinite(n) || n <= 0) return null;
      if (txt.includes('B')) return n * 1e9;
      if (txt.includes('M')) return n * 1e6;
      if (txt.includes('K')) return n * 1e3;
      return n;
    };
    const fmtSpend = (n) => {
      if (!n || n <= 0) return null;
      if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M/mo';
      if (n >= 1e3) return '$' + (n/1e3).toFixed(0) + 'K/mo';
      return '$' + Math.round(n) + '/mo';
    };
    const parseTraffic = (s) => {
      if (!s) return null;
      const txt = String(s).replace(/[\s,]/g,'').toUpperCase();
      const n = parseFloat(txt);
      if (!isFinite(n) || n <= 0) return null;
      if (txt.includes('B')) return n * 1e9;
      if (txt.includes('M')) return n * 1e6;
      if (txt.includes('K')) return n * 1e3;
      return n;
    };
    const fmtTraffic = (n) => {
      if (!n || n <= 0) return null;
      if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n/1e3).toFixed(0) + 'K';
      return String(Math.round(n));
    };
    const confRank = c => ({ high:3, medium:2, low:1 }[String(c||'low').toLowerCase()] || 1);

    // ── Merge: for every input competitor, build a consensus row ──────────
    const consensus = competitors.slice(0, 12).map(c => {
      const key = norm(c.name || c.domain);
      const g = gptByName[key] || null;
      const cl = claudeByName[key] || null;

      // ad-spend consensus: prefer agreement (within ±35%), else take the
      // LOWER of the two (more conservative — no over-claim) and downgrade
      // confidence. If only one model has a number, use it but cap confidence
      // at "medium".
      const gSpend = parseSpend(g?.adSpend);
      const clSpend = parseSpend(cl?.adSpend);
      let spendNum = null;
      let spendConf = 'low';
      let spendNotes = '';
      if (gSpend && clSpend) {
        const ratio = Math.max(gSpend, clSpend) / Math.min(gSpend, clSpend);
        if (ratio <= 1.35) {
          // Strong agreement → average + bump confidence
          spendNum = (gSpend + clSpend) / 2;
          spendConf = 'high';
          spendNotes = `Consensus: GPT-4o ${fmtSpend(gSpend)} · Claude ${fmtSpend(clSpend)}`;
        } else if (ratio <= 2.5) {
          // Moderate disagreement → take lower (conservative), medium conf
          spendNum = Math.min(gSpend, clSpend);
          spendConf = 'medium';
          spendNotes = `Models disagreed (${ratio.toFixed(1)}×) — using conservative figure`;
        } else {
          // Big disagreement → at least one is hallucinating; take lower, low conf
          spendNum = Math.min(gSpend, clSpend);
          spendConf = 'low';
          spendNotes = `Models diverged sharply (${ratio.toFixed(1)}×) — figure is approximate`;
        }
      } else if (gSpend) {
        spendNum = gSpend;
        spendConf = confRank(g?.confidence) >= 3 ? 'medium' : 'low';
        spendNotes = 'Single-model estimate (GPT-4o only)';
      } else if (clSpend) {
        spendNum = clSpend;
        spendConf = confRank(cl?.confidence) >= 3 ? 'medium' : 'low';
        spendNotes = 'Single-model estimate (Claude only)';
      }

      // Traffic consensus — same logic, but agreement window is wider (±50%)
      // because monthly visit estimates inherently vary more between sources.
      const gTraffic = parseTraffic(g?.traffic);
      const clTraffic = parseTraffic(cl?.traffic);
      let trafficNum = null;
      if (gTraffic && clTraffic) {
        const ratio = Math.max(gTraffic, clTraffic) / Math.min(gTraffic, clTraffic);
        trafficNum = ratio <= 1.5 ? (gTraffic + clTraffic) / 2 : Math.min(gTraffic, clTraffic);
      } else {
        trafficNum = gTraffic || clTraffic;
      }

      // ROAS / CTR — average when both present, else use whichever exists
      const gRoas = (typeof g?.roas === 'number' && g.roas > 0) ? g.roas : null;
      const clRoas = (typeof cl?.roas === 'number' && cl.roas > 0) ? cl.roas : null;
      const roas = (gRoas && clRoas) ? parseFloat(((gRoas + clRoas)/2).toFixed(1))
                 : (gRoas || clRoas || null);

      const gCtr = parseFloat(String(g?.ctr || '').replace('%',''));
      const clCtr = parseFloat(String(cl?.ctr || '').replace('%',''));
      const ctrAvg = (isFinite(gCtr) && gCtr > 0 && isFinite(clCtr) && clCtr > 0)
        ? ((gCtr + clCtr)/2)
        : (isFinite(gCtr) && gCtr > 0 ? gCtr : (isFinite(clCtr) && clCtr > 0 ? clCtr : null));
      const ctr = ctrAvg ? ctrAvg.toFixed(1) + '%' : null;

      // topChannel: agreement → use it, disagreement → prefer GPT-4o's
      // (more comprehensive media-mix knowledge in our testing)
      const gCh = (g?.topChannel || '').trim();
      const clCh = (cl?.topChannel || '').trim();
      const topChannel = (gCh && clCh && gCh.toLowerCase() === clCh.toLowerCase()) ? gCh
                       : (gCh || clCh || null);

      // Source citation — combine both
      const sources = [];
      if (g?.source) sources.push('GPT-4o: ' + String(g.source).replace(/\b(?:Q[1-4]\s*)?(?:19|20)\d{2}\b/gi,'').trim());
      if (cl?.source) sources.push('Claude: ' + String(cl.source).replace(/\b(?:Q[1-4]\s*)?(?:19|20)\d{2}\b/gi,'').trim());
      const source = sources.length ? sources.join(' · ') : 'Dual-LLM estimate';

      // Final confidence
      let confidence = spendConf;
      if (!spendNum) {
        // No spend data → confidence reflects whether we got ANY data
        confidence = (trafficNum || roas || ctr) ? 'low' : 'low';
      }

      return {
        name: c.name || c.domain,
        traffic: fmtTraffic(trafficNum),
        adSpend: fmtSpend(spendNum),
        roas,
        ctr,
        topChannel,
        confidence,
        source,
        notes: spendNotes || (g?.notes || cl?.notes || '').toString().slice(0, 80)
      };
    });

    res.json({
      ok: true,
      results: consensus,
      count: consensus.length,
      models: {
        gpt: gptResult ? 'gpt-4o' : 'failed',
        claude: claudeResult ? 'claude-sonnet-4-6' : 'failed'
      }
    });
  } catch (err) {
    console.error('/api/ai-validate-metrics error (after retry+fallback):', err.message);
    res.status(500).json({ error: err.message, results: [] });
  }
});

// (Legacy /api/auth/send-verification + /api/auth/verify-code REMOVED.)
// The real auth surface now lives in services/auth/api.js, mounted at the
// top of this file as /api/auth/{signup,login,logout,verify-email/:token,
// resend-verification,request-reset,reset-password/:token,oauth/:provider/{start,callback},me,providers}.

// ── Catch-all → SPA ──────────────────────────────────────────────────────────
// Critical: skip /api/* so unmatched API routes return a proper JSON 404
// instead of being silently swallowed by the SPA fallback. Endpoints
// registered AFTER this catch-all (like the blended-roas / goals / assistant
// command bar added in the Apr 2026 update) need this exemption to be reached.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  // Studio Pack public renderers must reach their handlers (mounted later in this file)
  if (/^\/(book|lp|bio)\/[^\/]+$/.test(req.path)) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});
};
