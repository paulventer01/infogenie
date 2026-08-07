// Blended ROAS · marketing officer suite routes.
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
// below on whether this is the live server process (off when required for tests).
const _runtimeFlags = require('../runtime_flags');

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { _db, _fetchAmplitudeConversions, _fetchGoogleAdsSpend, _fetchMetaSpend, _fetchTikTokSpend, _sendChatWebhook, _sendEmailViaResend, _tkvCtx, fs, multer, openai, openaiChatWithRetry, path } = ctx;

async function _revenueByPlatform(days = 30, tenantId = null) {
  if (!_db.hasDb()) return {};
  try {
    const r = await _db.getPool().query(`
      SELECT c.platform,
        COALESCE(SUM(p.revenue),0)::float8     AS revenue,
        COALESCE(SUM(p.conversions),0)::float8 AS conv
      FROM ad_performance_hourly p
      JOIN ad_campaigns c ON c.id = p.campaign_id
      WHERE p.bucket_hour >= now() - ($1 || ' days')::interval
        AND c.tenant_id = $2
      GROUP BY 1
    `, [String(days), tenantId]);
    const out = {};
    for (const row of r.rows) {
      const k = (row.platform || '').toLowerCase().replace('facebook', 'meta');
      out[k] = { revenue: Number(row.revenue || 0), conversions: Number(row.conv || 0) };
    }
    return out;
  } catch (e) { return {}; }
}

app.get('/api/blended-roas', async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const tid = await _tkvCtx.resolveTenantId(req, { label: 'blended-roas' });
  if (tid == null) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const [meta, google, tiktok, amp, revByPlatform] = await Promise.all([
    _fetchMetaSpend(days),
    _fetchGoogleAdsSpend(days),
    _fetchTikTokSpend(days),
    _fetchAmplitudeConversions(days),
    _revenueByPlatform(days, tid),
  ]);
  // Stitch revenue back onto each channel object.
  const _enrich = (ch, key) => {
    const r = revByPlatform[key];
    if (!r) return ch;
    const revenue = Number(r.revenue || 0);
    const spend   = Number(ch.spend  || 0);
    const impressions = Number(ch.impressions || 0);
    return {
      ...ch,
      revenue,
      roas: spend > 0 && revenue > 0 ? +(revenue / spend).toFixed(2) : null,
      cpm:  impressions > 0 && spend > 0 ? +((spend / impressions) * 1000).toFixed(2) : null,
      revenueSource: revenue > 0 ? 'optimizer-ingest' : 'none',
    };
  };
  const metaE   = _enrich(meta,   'meta');
  const googleE = _enrich(google, 'google');
  const tiktokE = _enrich(tiktok, 'tiktok');
  const adChannels = [metaE, googleE, tiktokE];
  // Architect-flagged correctness fix: spend AND revenue must come from the
  // same channel set, otherwise MER/ROAS/Net Sales become apples-to-oranges
  // when one channel's live API is down but historical revenue is still in
  // ad_performance_hourly. We sum BOTH across all 3 channels (revenue from DB
  // is independent of API liveness; spend defaults to 0 when not connected).
  const totalSpend       = adChannels.reduce((s, c) => s + (Number(c.spend)       || 0), 0);
  const totalImpressions = adChannels.reduce((s, c) => s + (Number(c.impressions) || 0), 0);
  const totalClicks      = adChannels.reduce((s, c) => s + (Number(c.clicks)      || 0), 0);
  const adReportedConv   = adChannels.reduce((s, c) => s + (Number(c.conversions) || 0), 0);
  const totalRevenue     = adChannels.reduce((s, c) => s + (Number(c.revenue)     || 0), 0);
  // Prefer Amplitude as ground truth; fall back to ad-platform-reported conversions.
  const customers      = (amp.ok && amp.conversions > 0) ? amp.conversions : adReportedConv;
  const customerSource = (amp.ok && amp.conversions > 0) ? 'amplitude' : 'ad-platform';
  const cac = customers > 0 ? +(totalSpend / customers).toFixed(2) : null;
  // T34 — Marketing Efficiency Ratio = revenue / spend. Holistic, not per-platform.
  // Net Sales is revenue minus spend (the dashboard surfaces it as the "what's
  // left after ad cost" number). LTV/CAC uses a configurable LTV multiplier
  // (default 2.0× CAC) until the user wires real LTV from their CRM/Stripe.
  const mer       = totalSpend > 0 && totalRevenue > 0 ? +((totalRevenue / totalSpend) * 100).toFixed(1) : null;
  const netSales  = totalRevenue > 0 ? +(totalRevenue - totalSpend).toFixed(2) : null;
  const ltvAssumed = cac != null ? +(cac * 2).toFixed(2) : null;
  const ltvCac    = (ltvAssumed && cac && cac > 0) ? +(ltvAssumed / cac).toFixed(2) : null;
  res.json({
    ok: true, days,
    totalSpend:      +totalSpend.toFixed(2),
    totalRevenue:    +totalRevenue.toFixed(2),
    totalImpressions, totalClicks,
    customers, customerSource,
    cac,
    mer,           // T34 — % (e.g. 396 means $3.96 revenue per $1 spend)
    netSales,      // T34 — revenue minus ad spend (in currency)
    ltvCac,        // T34 — based on assumed 2× CAC LTV until real LTV is wired
    ltvAssumed,    // surfaced for transparency
    roas: totalSpend > 0 && totalRevenue > 0 ? +(totalRevenue / totalSpend).toFixed(2) : null,
    roasNote: totalRevenue > 0
      ? 'ROAS computed from Optimizer-ingested revenue (ad_performance_hourly).'
      : 'No revenue ingested yet. Wire a campaign into the Optimizer to populate revenue, or send order data to /api/orders for true blended ROAS.',
    channels: { meta: metaE, google: googleE, tiktok: tiktokE },
    amplitude: amp,
    generatedAt: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GOALS — file-backed metric goals with autonomous status checks + GPT-4o
// root-cause for off-track goals. Mirrors the drip-store pattern (mutex +
// atomic tmp+rename writes).
// ─────────────────────────────────────────────────────────────────────────────
const fsp = require('fs/promises');
// ─────────────────────────────────────────────────────────────────────────────
// AI TEAM — Officer brief endpoint. Takes a role (finance | ops) plus a packet
// of real facts the frontend already collected from existing endpoints, and
// returns an executive narrative + structured highlights/risks/actions.
// Falls back to a deterministic template if OpenAI is unavailable so the UI
// never shows an empty state.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/officer/brief', async (req, res) => {
  try {
    const role  = String(req.body?.role  || '').trim().toLowerCase();
    const facts = req.body?.facts && typeof req.body.facts === 'object' ? req.body.facts : {};
    if (!['finance','ops','technical'].includes(role)) {
      return res.status(400).json({ ok:false, error:'role must be "finance", "ops", or "technical"' });
    }
    const roleSpec = role === 'finance'
      ? {
          title: 'AI Chief Financial Officer',
          focus: 'marketing P&L, CAC, LTV/CAC ratio, ROAS, MER, runway, and cash-flow risk from ad spend.',
          highlightHint: 'spend efficiency wins, healthy unit economics, cohorts pulling weight',
          riskHint:      'over-spend, deteriorating CAC, LTV/CAC < 3, channels burning cash',
          actionHint:    'budget reallocations, channel pauses, LTV improvement levers, payment-terms moves',
        }
      : role === 'technical'
      ? {
          title: 'AI Technical Manager',
          focus: 'end-to-end InfoGenie platform integrity per CTM mandate: every page/subpage/feature working in real time, APIs/readiness, LLMs/AI gateway + guardrails, auth/sessions, credential vault, tenant isolation, connector freshness, security threats, update safety, and live status for daily management meetings.',
          highlightHint: 'healthy pages/features, secured tokens, providers online, clean readiness probes, surfaces green',
          riskHint:      'blank/broken pages, down APIs, dummy/missing tokens, vault disabled, LLM outages, isolation gaps, unsafe updates',
          actionHint:    'immediate remediation steps with approval gates before installs or risky changes',
        }
      : {
          title: 'AI Chief Operations Officer',
          focus: 'campaign QA hygiene, asset library completeness, lead-routing health, goals on/off track, and weekly ops digest.',
          highlightHint: 'campaigns running clean, assets up to date, leads being qualified fast',
          riskHint:      'stale campaigns, missing brand assets, unqualified leads piling up, goals slipping',
          actionHint:    'specific clean-up tasks with owners and deadlines',
        };

    const prompt = `You are the ${roleSpec.title} for a marketing operation. Focus areas: ${roleSpec.focus}

Below is the latest factual snapshot from the user's actual platform data. Do NOT invent numbers — use only what's provided. If a value is null/missing, say so honestly ("not yet connected") rather than guessing.

FACTS (JSON):
${JSON.stringify(facts, null, 2)}

Return ONLY valid JSON in this exact shape:
{
  "summary": "<2-3 sentence executive narrative in plain English (no jargon, no markdown)>",
  "highlights": ["<concrete win, ${roleSpec.highlightHint}>", "..."],
  "risks":      ["<concrete risk with the actual number from the facts, ${roleSpec.riskHint}>", "..."],
  "actions":    [{ "title":"<short action verb-led title>", "detail":"<one sentence on what & why>", "priority":"high|med|low" }]
}

Rules:
- 3-5 items in each of highlights / risks / actions.
- Reference real numbers from the facts (e.g. "CAC of $${facts.cac || 'X'}", not "high CAC").
- If facts are mostly empty (no ad accounts connected, no data ingested), the summary should say so and the actions should focus on what to connect first.
- Every action MUST be something the user can do inside InfoGenie or in their connected accounts — no generic advice.
- Plain English. No emojis in the JSON output.`;

    let aiResult = null;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-5-mini',
        messages: [
          { role:'system', content: `You are the ${roleSpec.title}. Output strict JSON only — no prose, no markdown. Be specific and quantitative.` },
          { role:'user',   content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: 'json_object' },
      });
      aiResult = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    } catch (aiErr) {
      console.warn(`[officer/brief:${role}] AI failed, using template:`, aiErr.message);
    }

    // Deterministic fallback if AI fails or returns garbage.
    if (!aiResult || typeof aiResult !== 'object' || !aiResult.summary) {
      const isEmpty = role === 'finance'
        ? (!facts.totalSpend && !facts.totalRevenue && !facts.customers)
        : role === 'technical'
        ? (!facts.overall && !facts.counts)
        : (!facts.campaigns?.total && !facts.leads?.unqualified && !facts.assets?.missing);
      aiResult = isEmpty
        ? {
            summary: `Your ${roleSpec.title} is online but doesn't have enough data yet to brief you. Connect your ad accounts and CRM to unlock real insights.`,
            highlights: [],
            risks: [{ title:'No data flowing yet', priority:'high' }],
            actions: role === 'finance'
              ? [
                  { title:'Connect Meta / Google / TikTok ad accounts', detail:'So I can compute live spend, CAC and ROAS.', priority:'high' },
                  { title:'Wire HubSpot or send orders to /api/orders',  detail:'So I can compute true blended ROAS and LTV.',  priority:'high' },
                ]
              : role === 'technical'
              ? [
                  { title:'Run Technical Manager scan', detail:'Open the Technical Manager desk for live API/LLM/auth status.', priority:'high' },
                  { title:'Enable credential vault encryption', detail:'Set CREDENTIAL_ENCRYPTION_KEY so tokens are stored safely.', priority:'high' },
                ]
              : [
                  { title:'Launch a campaign',           detail:'So I can start running QA on it.',                   priority:'high' },
                  { title:'Upload your brand assets',    detail:'Logos, colours, voice — so creatives stay on-brand.', priority:'high' },
                ],
          }
        : {
            summary: role === 'finance'
              ? `30-day spend ${facts.totalSpend != null ? '$'+facts.totalSpend : 'pending'}, revenue ${facts.totalRevenue != null ? '$'+facts.totalRevenue : 'pending'}. Review the dashboard for the full breakdown.`
              : role === 'technical'
              ? `Platform status ${facts.overall || 'unknown'}: ${facts.counts?.critical || 0} critical / ${facts.counts?.high || 0} high events. ${facts.counts?.integrations_configured || 0} integrations configured. Plan of action ready for management approval where required.`
              : `Tracking ${facts.campaigns?.total||0} campaigns, ${facts.leads?.qualified||0} qualified leads, ${facts.assets?.uploaded||0} brand assets. See the checklist for cleanup tasks.`,
            highlights: role === 'technical' && Array.isArray(facts.integrations?.configured)
              ? facts.integrations.configured.slice(0, 3).map((n) => `${n} connected`)
              : [],
            risks: role === 'technical' && Array.isArray(facts.events)
              ? facts.events.filter((e) => e.severity === 'critical' || e.severity === 'high').slice(0, 4).map((e) => e.message)
              : [],
            actions: role === 'technical' && Array.isArray(facts.plan_of_action)
              ? facts.plan_of_action.slice(0, 4).map((p) => ({
                  title: p.action,
                  detail: p.problem,
                  priority: p.severity === 'critical' ? 'high' : 'med',
                }))
              : [],
          };
    }

    res.json({ ok:true, role, brief: aiResult, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[officer/brief] error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── AI-suggested job responsibilities per officer role ─────────────────────
// Returns 12-15 concrete, role-appropriate tasks the user can pick from to
// "hire" their AI employee. Falls back to a built-in template per role.
app.post('/api/officer/tasks', async (req, res) => {
  try {
    const role  = String(req.body?.role  || '').trim();
    const title = String(req.body?.title || role || 'Officer').trim();
    if (!role) return res.status(400).json({ ok:false, error:'role required' });
    const FALLBACK = {
      marketing: ['Plan and launch monthly campaigns','Write ad copy and creative briefs','Monitor competitor campaigns weekly','Reallocate budget to top-performing channels','Run weekly performance retrospective','Brief content team on campaign themes','Manage email + SMS drip sequences','Refresh ad creative on fatigue','Review brand voice + tone consistency','Coordinate cross-channel launches','Set quarterly OKRs','Approve every paid creative before launch'],
      sales:     ['Build weekly outbound prospect lists','Qualify inbound leads within 1 hour','Follow up on stalled deals every 3 days','Run weekly pipeline review','Re-engage cold leads monthly','Update CRM after every touch','Forecast monthly revenue','Negotiate pricing within guardrails','Hand off won deals to onboarding','Track conversion rate by source','Coach SDRs weekly','Maintain ICP definition'],
      analyst:   ['Build weekly cross-channel performance report','Track attribution model accuracy','Flag KPI anomalies daily','Run cohort analysis monthly','Maintain dashboard data freshness','Validate tracking pixels weekly','A/B test methodology review','Surface "why did X change" answers','Audit data sources monthly','Maintain a single source of truth metric glossary','Forecast next-quarter pipeline','Calculate true blended ROAS'],
      content:   ['Plan monthly content calendar','Score every piece before publishing','Brief writers + designers','Schedule social posts across platforms','Repurpose top content into 5 formats','Audit existing content quarterly for refresh','Track content engagement weekly','Maintain brand voice guide','Source UGC + customer stories','Run monthly content gap analysis vs competitors','Optimise headlines + thumbnails','Distribute content via newsletter'],
      seo:       ['Run weekly on-page audit','Track keyword rankings daily','Build internal link plan monthly','Audit competitor backlinks','Submit fresh sitemaps','Monitor Core Web Vitals','Optimise meta titles + descriptions','Identify content gaps vs SERPs','Run GEO audit for AI search visibility','Schema markup review','Local SEO citations','Disavow toxic backlinks'],
      cro:       ['Run weekly A/B tests on top pages','Analyse heatmaps + session recordings','Document every winning experiment','Build conversion playbook','Implement urgency + social proof boosters','Test pricing page variants','Optimise checkout flow','Reduce form-field friction','Run mobile-first usability audits','Personalise CTAs by traffic source','Test exit-intent overlays','Maintain experiment backlog'],
      finance:   ['Track marketing P&L weekly','Compute CAC by channel monthly','Calculate LTV/CAC ratio','Flag overspending campaigns','Forecast 90-day cash flow','Approve budget reallocations','Audit invoices vs platform spend','Tax-prep marketing line items','Negotiate annual platform contracts','Report MER monthly','Set channel budget caps','Variance analysis vs plan'],
      ops:       ['Run weekly campaign QA scan','Audit brand asset library completeness','Check lead routing health daily','Maintain SOPs for every workflow','Onboard new tools + integrations','Quarterly access review','Vendor relationship management','Backup critical data weekly','Track team capacity vs workload','Run incident postmortems','Maintain compliance + privacy register','Schedule team standups'],
      // Aligned to Chief Technical Manager JD: availability, observability of every
      // client-visible surface, multi-tenant isolation, AI safety, security/vault,
      // incident command. Deprioritised: hiring/1:1s, product roadmap ownership,
      // generic "research tooling" busywork (folded into approval-gated gap reports).
      technical: [
        'Monitor every page subpage and feature live',
        'Probe every API and readiness endpoint',
        'Watch LLM gateway cost and guardrails',
        'Enforce credential vault and token hygiene',
        'Scan security posture and permission gaps',
        'Guard autonomous AI with emergency stop',
        'Track tenant isolation and leakage risk',
        'Monitor connector freshness and silent failures',
        'Validate update safety before any install',
        'Draft incident plans for management approval',
        'Report live status in daily management meetings',
        'Close monitoring gaps with approval-gated asks',
        'Keep alerts actionable and runbook-linked',
        'Publish availability and error-budget posture',
      ]
    };
    const key = role.toLowerCase();
    let tasks = null;
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      try {
        const completion = await Promise.race([
          openai.chat.completions.create({
            model: 'gpt-5-mini',
            response_format: { type: 'json_object' },
            max_tokens: 700,
            temperature: 0.4,
            messages: [
              { role:'system', content:'You output strict JSON only — no markdown.' },
              { role:'user', content: key === 'technical'
                ? `Suggest 12-15 concrete day-to-day responsibilities for an AI Technical Manager (Chief Technical Manager scope) on a multi-tenant AI marketing platform. MUST prioritise: real-time monitoring that every page/subpage/feature works, API/readiness probes, LLM/AI gateway health, credential vault, security, tenant isolation, connector freshness, autonomous-AI guardrails, incident plans with approval gates, and live status for daily management meetings. Do NOT include hiring, 1:1s, product roadmap ownership, or vague "research tools" tasks. Keep each task to 4-12 words, action-verb led. Return ONLY: {"tasks":["...","..."]}`
                : `Suggest 12-15 concrete, day-to-day job responsibilities for an AI ${title} working inside a SaaS marketing platform. Keep each task to 4-10 words, action-verb led, specific (not generic). Mix daily, weekly, monthly cadences. Return ONLY: {"tasks":["...","..."]}` }
            ]
          }),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error('openai_timeout_12s')),12000))
        ]);
        const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        if (Array.isArray(parsed.tasks) && parsed.tasks.length >= 6) tasks = parsed.tasks.slice(0,15);
      } catch (e) { console.warn('[officer/tasks] AI failed:', e.message); }
    }
    if (!tasks) tasks = FALLBACK[key] || FALLBACK.marketing;
    res.json({ ok:true, role, title, tasks, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[officer/tasks] error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── Officer tasks server-side mirror (so the autonomous scheduler can
// generate reports without the user's browser being open). The frontend
// localStorage remains the source of truth for the modal UI; this kv mirror
// is updated whenever the user clicks Save in the tasks modal.
const _TASKS_KEY = 'officer_tasks_v1';
// All Officer kv stores are per-workspace (`<base>:t<tid>`). _TASKS_KEY is also
// written by services/playbook_7day (keep the base aligned). resolveTenantId is
// used per request; the auto-report / auto-meeting schedulers iterate tenants.
const _officerScope = require('./services/tenants/kv_scope');
const _officerCtx   = require('./services/tenants/context');
const _officerKey = (base, tid) => _officerScope.tkey(base, tid);
const _OFFICER_ROLES = ['marketing','sales','analyst','content','seo','cro','finance','ops','technical'];
const _OFFICER_TITLES = {
  marketing:'Marketing Officer', sales:'Sales Officer', analyst:'Analyst Officer',
  content:'Content Officer', seo:'SEO Officer', cro:'CRO Officer',
  finance:'Finance Officer', ops:'Operations Officer', technical:'Technical Manager'
};
app.get('/api/officer/tasks-store', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.json({ tasks: {} });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:tasks-store:get' });
    if (tid == null) return res.json({ tasks: {} });
    const v = (await _db.kvGet(_officerKey(_TASKS_KEY, tid), {})) || {};
    res.json({ tasks: (v && typeof v==='object' && !Array.isArray(v)) ? v : {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/officer/tasks-store', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:tasks-store:post' });
    if (tid == null) return res.status(400).json({ error: 'no_tenant' });
    const { role, tasks } = req.body || {};
    const safeRole = String(role||'').toLowerCase();
    if (!_OFFICER_ROLES.includes(safeRole)) return res.status(400).json({ error: 'unknown role' });
    const safeTasks = Array.isArray(tasks) ? tasks.filter(t => typeof t==='string').slice(0,40).map(t=>String(t).slice(0,200)) : [];
    const key = _officerKey(_TASKS_KEY, tid);
    const cur = (await _db.kvGet(key, {})) || {};
    const safeCur = (cur && typeof cur==='object' && !Array.isArray(cur)) ? cur : {};
    safeCur[safeRole] = safeTasks;
    await _db.kvSet(key, safeCur);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Officer avatar image upload (multer) ──────────────────────────────────
// SVG is intentionally rejected (active-content / stored-XSS risk on a
// same-origin /uploads/* path). MIME type is derived server-side from the
// browser-reported MIME (cross-checked against extension) and the on-disk
// filename uses our own ext so we never trust client-supplied filenames.
const _OFFICER_AVATAR_DIR = path.join(__dirname, 'uploads', 'officer-avatars');
try { if (!fs.existsSync(_OFFICER_AVATAR_DIR)) fs.mkdirSync(_OFFICER_AVATAR_DIR, { recursive: true }); } catch(_){}
const _OFFICER_ROLES_WL = ['marketing','sales','analyst','content','seo','cro','finance','ops','technical'];
const _AVATAR_MIME_EXT = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/gif':'.gif', 'image/webp':'.webp' };
const _officerAvatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, _OFFICER_AVATAR_DIR),
    filename:    (req, file, cb) => {
      const ext  = _AVATAR_MIME_EXT[file.mimetype] || '.bin';
      const role = String(req.body?.role || 'unknown').toLowerCase().replace(/[^a-z]/g, '').slice(0,20);
      cb(null, `${role}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // Pre-write role gate so invalid-role requests never write to disk.
    const role = String(req.body?.role || '').toLowerCase();
    if (!_OFFICER_ROLES_WL.includes(role)) return cb(new Error('unknown role'));
    if (!_AVATAR_MIME_EXT[file.mimetype]) return cb(new Error('Image must be JPG, PNG, GIF or WebP'));
    if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(path.extname(file.originalname || ''))) return cb(new Error('Image must be JPG, PNG, GIF or WebP'));
    cb(null, true);
  }
});
app.post('/api/officer/avatar-upload', (req, res, next) => {
  _officerAvatarUpload.single('image')(req, res, (err) => {
    if (err) {
      // Best-effort: if a file landed despite a later validation error, remove it.
      try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch(_){}
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const cleanup = () => { try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch(_){} };
  try {
    const _db = require('./db');
    if (!_db.hasDb()) { cleanup(); return res.status(503).json({ error: 'database not configured' }); }
    const role = String(req.body?.role || '').toLowerCase();
    if (!_OFFICER_ROLES_WL.includes(role)) { cleanup(); return res.status(400).json({ error: 'unknown role' }); }
    if (!req.file) return res.status(400).json({ error: 'no image uploaded' });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:avatar-upload' });
    if (tid == null) { cleanup(); return res.status(400).json({ error: 'no_tenant' }); }
    const url = `/uploads/officer-avatars/${req.file.filename}`;
    const key = _officerKey(_AVATAR_KEY, tid);
    const cur = (await _db.kvGet(key, {})) || {};
    const safeCur = (cur && typeof cur==='object' && !Array.isArray(cur)) ? cur : {};
    safeCur[role] = url;
    await _db.kvSet(key, safeCur);
    res.json({ ok: true, role, url, avatars: safeCur });
  } catch (e) { cleanup(); res.status(500).json({ error: e.message }); }
});

// ── Officer avatars (kv_store) ────────────────────────────────────────────
const _AVATAR_KEY = 'officer_avatars_v1';
app.get('/api/officer/avatars', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.json({ avatars: {} });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:avatars:get' });
    if (tid == null) return res.json({ avatars: {} });
    const v = await _db.kvGet(_officerKey(_AVATAR_KEY, tid), {});
    res.json({ avatars: (v && typeof v==='object' && !Array.isArray(v)) ? v : {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/officer/avatars', async (req, res) => {
  try {
    const _db = require('./db');
    const { role, avatar } = req.body || {};
    if (!role || !avatar) return res.status(400).json({ error: 'role+avatar required' });
    if (!_db.hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:avatars:post' });
    if (tid == null) return res.status(400).json({ error: 'no_tenant' });
    const ALLOWED_ROLES = ['marketing','sales','analyst','content','seo','cro','finance','ops','technical'];
    const safeRole = String(role).toLowerCase();
    if (!ALLOWED_ROLES.includes(safeRole)) return res.status(400).json({ error: 'unknown role' });
    const key = _officerKey(_AVATAR_KEY, tid);
    const cur = (await _db.kvGet(key, {})) || {};
    const safeCur = (cur && typeof cur==='object' && !Array.isArray(cur)) ? cur : {};
    // Accept short emoji glyphs OR portrait/upload URLs. The old slice(0,8) truncated
    // paths like /avatars/ai-team/ops.webp to "/avatars" and broke portrait picks.
    const raw = String(avatar).trim();
    const isImg =
      raw.startsWith('/avatars/') ||
      raw.startsWith('/uploads/') ||
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('data:image/');
    const isEmoji = !raw.startsWith('/') && !raw.startsWith('http') && !raw.startsWith('data:') && raw.length > 0 && raw.length <= 16;
    if (!isImg && !isEmoji) return res.status(400).json({ error: 'invalid avatar' });
    safeCur[safeRole] = isImg ? raw.slice(0, 500) : raw;
    await _db.kvSet(key, safeCur);
    res.json({ ok: true, avatars: safeCur });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Daily report per officer ──────────────────────────────────────────────
// Cross-references the officer's saved tasks against REAL platform data so
// the report tells the truth instead of pretending. Each task gets one of:
// done | in_progress | blocked | not_started, with evidence from the snapshot.
app.post('/api/officer/daily-report', async (req, res) => {
  try {
    const role  = String(req.body?.role  || '').trim().toLowerCase();
    const title = String(req.body?.title || 'Officer').trim();
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks.filter(t => typeof t==='string').slice(0,40) : [];
    if (!role) return res.status(400).json({ ok:false, error: 'role required' });

    // Snapshot is scoped to the caller's workspace so one workspace's report is
    // never grounded in another's counts. tid null → tenant_id=$1 matches
    // nothing (safe). ad_insights/budget_spend are legacy dead tables (no
    // tenant_id, always null) — left unscoped.
    const snap = {};
    try {
      const _db = require('./db');
      if (_db.hasDb()) {
        const pool = _db.getPool();
        const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:daily-report' });
        const safe = async (sql, params=[]) => { try { const r = await pool.query(sql, params); return r.rows?.[0]?.c == null ? null : +r.rows[0].c; } catch(_) { return null; } };
        snap.adCampaigns_total    = await safe(`SELECT COUNT(*)::int c FROM ad_campaigns WHERE tenant_id=$1`, [tid]);
        snap.adInsights_last24h   = await safe(`SELECT COUNT(*)::int c FROM ad_insights WHERE inserted_at > now() - interval '24 hours'`);
        snap.brandCalendar_next7d = await safe(`SELECT COUNT(*)::int c FROM brand_calendar_items WHERE event_date BETWEEN current_date AND current_date + 7 AND tenant_id=$1`, [tid]);
        snap.landingPages_total   = await safe(`SELECT COUNT(*)::int c FROM landing_pages WHERE tenant_id=$1`, [tid]);
        snap.budgetSpend_last7d   = await safe(`SELECT COUNT(*)::int c FROM budget_spend WHERE spend_date > current_date - 7`);
        snap.leadsLinksell_last7d = await safe(`SELECT COUNT(*)::int c FROM linksell_leads WHERE created_at > now() - interval '7 days' AND tenant_id=$1`, [tid]);
        snap.bookings_last7d      = await safe(`SELECT COUNT(*)::int c FROM bookings WHERE created_at > now() - interval '7 days' AND tenant_id=$1`, [tid]);
        snap.waCampaigns_total    = await safe(`SELECT COUNT(*)::int c FROM wa_campaigns WHERE tenant_id=$1`, [tid]);
        snap.activeProjects       = await safe(`SELECT COUNT(*)::int c FROM marketing_projects WHERE status='active' AND tenant_id=$1`, [tid]);
      }
    } catch(_) {}

    const FALLBACK = {
      summary: tasks.length === 0
        ? `${title}: no responsibilities assigned yet. Use the 📋 Tasks button to assign duties so I can start reporting.`
        : `${title}: AI write-up unavailable right now. ${tasks.length} responsibilities on file. See snapshot below for raw activity.`,
      tasksReviewed: tasks.map(t => ({ task:t, status:'not_started', evidence:'AI report offline — no automated check ran today.' })),
      successes: [],
      issues: tasks.length === 0 ? ['No tasks assigned'] : [],
      actionPlan: tasks.length === 0 ? [{ step:'Open the 📋 Tasks button and assign your first responsibilities', priority:'high' }] : []
    };

    let report = null;
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY && tasks.length) {
      const tasksList = tasks.map((t,i)=>`${i+1}. ${t}`).join('\n');
      const prompt = `You are the AI ${title} writing an HONEST end-of-day report to the CEO.

ASSIGNED RESPONSIBILITIES:
${tasksList}

PLATFORM DATA SNAPSHOT (real counts — null means table not present):
${JSON.stringify(snap, null, 2)}

For each responsibility, decide HONESTLY based on the snapshot:
- "done"        → clear evidence of activity in the snapshot today
- "in_progress" → some activity but not complete
- "blocked"     → blocked by missing data, missing integration, or external dep
- "not_started" → no evidence of activity yet

Do NOT fake completions. If the snapshot shows 0 or null, mark not_started or blocked and explain why.

Return ONLY this JSON:
{
  "summary": "<2-3 sentence honest plain-English summary>",
  "tasksReviewed": [{"task":"<exact task text>","status":"done|in_progress|blocked|not_started","evidence":"<what in the snapshot supports this — be specific or say no data>"}],
  "successes": ["<concrete win today with a number>", "..."],
  "issues":    ["<concrete blocker or risk with detail>", "..."],
  "actionPlan":[{"step":"<verb-led step the user can take in InfoGenie>", "priority":"high|med|low"}]
}`;
      try {
        const completion = await Promise.race([
          openai.chat.completions.create({
            model: 'gpt-5-mini',
            response_format: { type: 'json_object' },
            max_tokens: 1800, temperature: 0.3,
            messages: [
              { role:'system', content:`You are the AI ${title}. Output strict JSON only. Be honest about what was and was not done.` },
              { role:'user', content: prompt }
            ]
          }),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error('openai_timeout_18s')), 18000))
        ]);
        const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        if (parsed && parsed.summary && Array.isArray(parsed.tasksReviewed)) report = parsed;
      } catch(e) { console.warn('[daily-report] AI failed:', e.message); }
    }
    if (!report) report = FALLBACK;
    res.json({ ok:true, role, title, generatedAt: new Date().toISOString(), snapshot: snap, report });
  } catch (err) {
    console.error('[daily-report] error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── Officer meetings ──────────────────────────────────────────────────────
const _MEETINGS_KEY = 'officer_meetings_v1';
app.get('/api/officer/meetings', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.json({ meetings: [] });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:meetings:get' });
    if (tid == null) return res.json({ meetings: [] });
    const v = (await _db.kvGet(_officerKey(_MEETINGS_KEY, tid), [])) || [];
    res.json({ meetings: Array.isArray(v) ? v : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/officer/meetings', async (req, res) => {
  try {
    const attendees = Array.isArray(req.body?.attendees)
      ? req.body.attendees.filter(s => typeof s==='string').slice(0,12)
      : [];
    const topic = String(req.body?.topic || '').trim().slice(0,300);
    const tasksByRole = (req.body?.tasksByRole && typeof req.body.tasksByRole==='object' && !Array.isArray(req.body.tasksByRole))
      ? req.body.tasksByRole : {};
    if (attendees.length < 2 || !topic) return res.status(400).json({ ok:false, error: 'attendees (≥2) + topic required' });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:meetings:post' });
    if (tid == null) return res.status(400).json({ ok:false, error: 'no_tenant' });

    const FALLBACK = {
      discussion: [`${attendees.join(', ')} convened to discuss "${topic}".`, 'AI minute-taker is offline — please add notes manually or retry when AI is available.'],
      decisions: [],
      actionItems: attendees.map(a => ({ owner:a, action:`Follow up on "${topic}"`, dueIn:'7d' }))
    };

    let parsed = null;
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      const prompt = `You are the meeting secretary. Draft minutes for an internal cross-functional meeting between these AI officers:

ATTENDEES: ${attendees.join(', ')}
TOPIC: ${topic}

ASSIGNED RESPONSIBILITIES BY OFFICER:
${JSON.stringify(tasksByRole, null, 2)}

Generate realistic minutes that:
- Reference each attendee by their role
- Surface real cross-functional friction (e.g. Marketing needs Content for assets, Sales needs Analyst for attribution data)
- Include 3-5 concrete decisions
- Include action items with a clear owner role and due date

Return ONLY this JSON:
{
  "discussion": ["<paragraph 1>", "<paragraph 2>", "..."],
  "decisions":  ["<decision 1>", "..."],
  "actionItems":[{"owner":"<attendee role>", "action":"<verb-led action>", "dueIn":"24h|3d|7d|14d"}]
}`;
      try {
        const completion = await Promise.race([
          openai.chat.completions.create({
            model: 'gpt-5-mini',
            response_format: { type: 'json_object' },
            max_tokens: 1600, temperature: 0.6,
            messages: [
              { role:'system', content:'You are a precise meeting secretary. Output strict JSON only.' },
              { role:'user', content: prompt }
            ]
          }),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error('openai_timeout_18s')), 18000))
        ]);
        const j = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        if (Array.isArray(j.discussion) && j.discussion.length) parsed = j;
      } catch(e) { console.warn('[meeting] AI failed:', e.message); }
    }
    const _db = require('./db');
    if (!_db.hasDb()) return res.status(503).json({ ok:false, error: 'database not configured — meetings cannot be persisted' });

    const minutes = parsed || FALLBACK;
    const id = 'mtg_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    const record = { id, scheduledAt: new Date().toISOString(), attendees, topic, ...minutes };

    const key = _officerKey(_MEETINGS_KEY, tid);
    const cur = (await _db.kvGet(key, [])) || [];
    const safeCur = Array.isArray(cur) ? cur : [];
    safeCur.unshift(record);
    await _db.kvSet(key, safeCur.slice(0, 200));

    res.json({ ok:true, meeting: record });
  } catch (err) {
    console.error('[meeting] error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});
// ── Autonomous Daily Report Scheduler ─────────────────────────────────────
// Settings stored in kv_store under `officer_autoreport_settings_v1`:
// { enabled, hour, minute, timezone, email, lastRunDate }
// A 60-second tick checks the current time in the user's timezone and fires
// once per day when HH:MM matches and lastRunDate != today (in that tz).
const _AUTOREPORT_KEY = 'officer_autoreport_settings_v1';
const _AUTOREPORT_DEFAULTS = { enabled:false, hour:8, minute:0, timezone:'UTC', email:'', lastRunDate:'', lastScheduledRunDate:'', lastRunAt:null, lastRunStatus:null };
const _AUTOREPORT_HISTORY_KEY = 'officer_autoreport_history_v1';

app.get('/api/officer/autoreport', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.json({ settings: _AUTOREPORT_DEFAULTS, history: [] });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:autoreport:get' });
    if (tid == null) return res.json({ settings: _AUTOREPORT_DEFAULTS, history: [] });
    const s = (await _db.kvGet(_officerKey(_AUTOREPORT_KEY, tid), _AUTOREPORT_DEFAULTS)) || _AUTOREPORT_DEFAULTS;
    const h = (await _db.kvGet(_officerKey(_AUTOREPORT_HISTORY_KEY, tid), [])) || [];
    res.json({ settings: { ..._AUTOREPORT_DEFAULTS, ...s }, history: Array.isArray(h) ? h.slice(0,30) : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/officer/autoreport', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:autoreport:post' });
    if (tid == null) return res.status(400).json({ error: 'no_tenant' });
    const { enabled, hour, minute, timezone, email } = req.body || {};
    const h = Math.max(0, Math.min(23, parseInt(hour, 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(minute, 10) || 0));
    let tz = String(timezone || 'UTC').slice(0, 64);
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); }
    catch { return res.status(400).json({ error: 'invalid timezone — use e.g. America/New_York' }); }
    const em = String(email || '').trim().slice(0, 200);
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: 'invalid email' });
    const key = _officerKey(_AUTOREPORT_KEY, tid);
    const cur = (await _db.kvGet(key, _AUTOREPORT_DEFAULTS)) || _AUTOREPORT_DEFAULTS;
    const next = { ...cur, enabled: !!enabled, hour: h, minute: m, timezone: tz, email: em };
    await _db.kvSet(key, next);
    res.json({ ok: true, settings: next });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/officer/autoreport/run-now', async (req, res) => {
  try {
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:autoreport:run-now' });
    if (tid == null) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const skipDelivery = req.query.skipDelivery === '1' || req.body?.skipDelivery === true;
    const result = await _runAutonomousDailyReports({ manualTrigger: true, skipDelivery, tenantId: tid });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Internal: generate a single officer's daily report by reusing the same
// snapshot + AI logic as the on-demand endpoint. Returns the same shape.
async function _generateOfficerReportInternal(role, title, tasks, tid = null) {
  const snap = {};
  try {
    const _db = require('./db');
    if (_db.hasDb()) {
      const pool = _db.getPool();
      // Scoped to the report's workspace. tid null → tenant_id=$1 matches
      // nothing. ad_insights/budget_spend are legacy dead tables (left global).
      const safe = async (sql, params=[]) => { try { const r = await pool.query(sql, params); return r.rows?.[0]?.c == null ? null : +r.rows[0].c; } catch(_) { return null; } };
      snap.adCampaigns_total    = await safe(`SELECT COUNT(*)::int c FROM ad_campaigns WHERE tenant_id=$1`, [tid]);
      snap.adInsights_last24h   = await safe(`SELECT COUNT(*)::int c FROM ad_insights WHERE inserted_at > now() - interval '24 hours'`);
      snap.brandCalendar_next7d = await safe(`SELECT COUNT(*)::int c FROM brand_calendar_items WHERE event_date BETWEEN current_date AND current_date + 7 AND tenant_id=$1`, [tid]);
      snap.landingPages_total   = await safe(`SELECT COUNT(*)::int c FROM landing_pages WHERE tenant_id=$1`, [tid]);
      snap.budgetSpend_last7d   = await safe(`SELECT COUNT(*)::int c FROM budget_spend WHERE spend_date > current_date - 7`);
      snap.leadsLinksell_last7d = await safe(`SELECT COUNT(*)::int c FROM linksell_leads WHERE created_at > now() - interval '7 days' AND tenant_id=$1`, [tid]);
      snap.bookings_last7d      = await safe(`SELECT COUNT(*)::int c FROM bookings WHERE created_at > now() - interval '7 days' AND tenant_id=$1`, [tid]);
      snap.waCampaigns_total    = await safe(`SELECT COUNT(*)::int c FROM wa_campaigns WHERE tenant_id=$1`, [tid]);
      snap.activeProjects       = await safe(`SELECT COUNT(*)::int c FROM marketing_projects WHERE status='active' AND tenant_id=$1`, [tid]);
    }
  } catch(_) {}
  const FALLBACK = {
    summary: tasks.length === 0
      ? `${title}: no responsibilities assigned yet. Open the AI Team page → 📋 Tasks to assign duties.`
      : `${title}: AI write-up unavailable. ${tasks.length} responsibilities on file. See snapshot below for raw activity.`,
    tasksReviewed: tasks.map(t => ({ task:t, status:'not_started', evidence:'AI report offline.' })),
    successes: [], issues: [], actionPlan: []
  };
  let report = null;
  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY && tasks.length) {
    const tasksList = tasks.map((t,i)=>`${i+1}. ${t}`).join('\n');
    const prompt = `You are the AI ${title} writing an HONEST end-of-day report to the CEO.\n\nASSIGNED RESPONSIBILITIES:\n${tasksList}\n\nPLATFORM DATA SNAPSHOT (real counts — null means table not present):\n${JSON.stringify(snap, null, 2)}\n\nFor each responsibility, decide HONESTLY based on the snapshot:\n- "done"        → clear evidence of activity in the snapshot today\n- "in_progress" → some activity but not complete\n- "blocked"     → blocked by missing data, missing integration, or external dep\n- "not_started" → no evidence of activity yet\n\nDo NOT fake completions. If the snapshot shows 0 or null, mark not_started or blocked.\n\nReturn ONLY this JSON: {"summary":"<2-3 sentence honest summary>","tasksReviewed":[{"task":"<exact text>","status":"done|in_progress|blocked|not_started","evidence":"<specific or no data>"}],"successes":["<concrete win with number>"],"issues":["<concrete blocker>"],"actionPlan":[{"step":"<verb-led step>","priority":"high|med|low"}]}`;
    try {
      const completion = await Promise.race([
        openai.chat.completions.create({
          model: 'gpt-5-mini', response_format: { type: 'json_object' },
          max_tokens: 1800, temperature: 0.3,
          messages: [
            { role:'system', content:`You are the AI ${title}. Output strict JSON only. Be honest about what was and was not done.` },
            { role:'user', content: prompt }
          ]
        }),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('openai_timeout_18s')), 18000))
      ]);
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
      if (parsed && parsed.summary && Array.isArray(parsed.tasksReviewed)) report = parsed;
    } catch(e) { console.warn('[autoreport] AI failed for', role, e.message); }
  }
  if (!report) report = FALLBACK;
  return { role, title, generatedAt: new Date().toISOString(), snapshot: snap, report };
}

async function _runAutonomousDailyReports({ manualTrigger = false, skipDelivery = false, tenantId = null } = {}) {
  const _db = require('./db');
  if (!_db.hasDb()) return { ok:false, reason:'no-db' };
  // Per-workspace: settings/tasks/history are keyed by tenant; null tid is a
  // no-op (matches nothing) so a missing workspace never reads global data.
  if (tenantId == null) return { ok:false, reason:'no-tenant' };
  const tid = tenantId;
  const settings = (await _db.kvGet(_officerKey(_AUTOREPORT_KEY, tid), _AUTOREPORT_DEFAULTS)) || _AUTOREPORT_DEFAULTS;
  // Defensive: validate stored timezone, fall back to UTC if corrupt.
  let _tz = settings.timezone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: _tz }).format(new Date()); }
  catch { console.warn('[autoreport] stored timezone invalid, falling back to UTC:', _tz); _tz = 'UTC'; settings.timezone = 'UTC'; }
  const tasksStore = (await _db.kvGet(_officerKey(_TASKS_KEY, tid), {})) || {};

  // Generate all officer reports in parallel (includes Technical Manager)
  const reports = await Promise.all(_OFFICER_ROLES.map(role => {
    const tasks = Array.isArray(tasksStore[role]) ? tasksStore[role] : [];
    return _generateOfficerReportInternal(role, _OFFICER_TITLES[role], tasks, tid)
      .catch(e => ({ role, title:_OFFICER_TITLES[role], error: e.message, report:{ summary:`Error generating report: ${e.message}`, tasksReviewed:[], successes:[], issues:[], actionPlan:[] }, snapshot:{} }));
  }));

  const fmtDate = new Intl.DateTimeFormat('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone: settings.timezone || 'UTC' }).format(new Date());

  // Build Slack text digest
  const slackLines = [`*🤖 InfoGenie AI Team — Daily Stand-up*`, `_${fmtDate}_`, ''];
  reports.forEach(r => {
    const rep = r.report || {};
    const tr = rep.tasksReviewed || [];
    const done = tr.filter(t=>t.status==='done').length;
    const ip   = tr.filter(t=>t.status==='in_progress').length;
    const blk  = tr.filter(t=>t.status==='blocked').length;
    const ns   = tr.filter(t=>t.status==='not_started').length;
    slackLines.push(`*${r.title}*`);
    slackLines.push(`${rep.summary || '(no summary)'}`);
    slackLines.push(`✓ ${done} done · ◐ ${ip} in progress · ⚠ ${blk} blocked · ○ ${ns} not started`);
    if ((rep.actionPlan||[]).length) slackLines.push(`Top action: ${rep.actionPlan[0].step || rep.actionPlan[0].action || ''}`);
    slackLines.push('');
  });
  const slackText = slackLines.join('\n').slice(0, 38000);

  // Build email HTML digest
  const _esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emailRows = reports.map(r => {
    const rep = r.report || {};
    const tr  = rep.tasksReviewed || [];
    const stat = (s,l,c)=>`<span style="background:${c};color:#fff;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;margin-right:4px">${s} ${l}</span>`;
    const done=tr.filter(t=>t.status==='done').length, ip=tr.filter(t=>t.status==='in_progress').length, blk=tr.filter(t=>t.status==='blocked').length, ns=tr.filter(t=>t.status==='not_started').length;
    return `<tr><td style="padding:18px;border-top:1px solid #E2E8F0;vertical-align:top">
      <div style="font-weight:800;font-size:16px;color:#0F172A;margin-bottom:6px">${_esc(r.title)}</div>
      <div style="font-size:14px;color:#334155;line-height:1.5;margin-bottom:10px">${_esc(rep.summary||'')}</div>
      <div style="margin-bottom:10px">${stat(done,'done','#15803D')}${stat(ip,'in progress','#A16207')}${stat(blk,'blocked','#B91C1C')}${stat(ns,'not started','#64748B')}</div>
      ${(rep.successes||[]).length?`<div style="font-size:12px;color:#15803D;font-weight:700;margin-bottom:2px">Wins:</div><ul style="margin:0 0 8px 18px;padding:0;font-size:13px;color:#0F172A">${rep.successes.map(s=>`<li>${_esc(s)}</li>`).join('')}</ul>`:''}
      ${(rep.issues||[]).length?`<div style="font-size:12px;color:#B91C1C;font-weight:700;margin-bottom:2px">Issues:</div><ul style="margin:0 0 8px 18px;padding:0;font-size:13px;color:#0F172A">${rep.issues.map(s=>`<li>${_esc(s)}</li>`).join('')}</ul>`:''}
      ${(rep.actionPlan||[]).length?`<div style="font-size:12px;color:#0F172A;font-weight:700;margin-bottom:2px">Action plan:</div><ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#0F172A">${rep.actionPlan.map(a=>`<li><strong>[${_esc(a.priority||'med')}]</strong> ${_esc(a.step||a.action||'')}</li>`).join('')}</ul>`:''}
    </td></tr>`;
  }).join('');
  const emailHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F1F5F9;padding:24px"><table style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border-collapse:collapse;width:100%"><tr><td style="background:linear-gradient(135deg,#0F172A,#312E81);color:#fff;padding:24px"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;font-weight:700">InfoGenie · AI Team Stand-up</div><div style="font-size:22px;font-weight:800;margin-top:6px">Daily Report — ${_esc(fmtDate)}</div><div style="font-size:13px;opacity:.85;margin-top:4px">${reports.length} officers reporting · ${manualTrigger?'manual run':'scheduled'}</div></td></tr>${emailRows}<tr><td style="padding:16px 18px;background:#F8FAFC;font-size:11px;color:#64748B;text-align:center">Generated by InfoGenie. Reports cross-reference real platform data — figures are honest, not aspirational.</td></tr></table></div>`;

  const result = { sentAt: new Date().toISOString(), slackOk:false, emailOk:false, slackError:null, emailError:null, recipientEmail: settings.email || null };

  // Slack + Email (skipped when caller asked for view-only mode)
  if (skipDelivery) {
    result.slackError = 'skipped — view-only run';
    result.emailError = 'skipped — view-only run';
  } else {
    if (process.env.SLACK_WEBHOOK_URL) {
      try { await _sendChatWebhook(slackText, { username:'InfoGenie AI Team', icon:':robot_face:' }); result.slackOk = true; }
      catch (e) { result.slackError = e.message; console.warn('[autoreport] slack failed:', e.message); }
    } else { result.slackError = 'SLACK_WEBHOOK_URL not configured'; }

    if (settings.email && process.env.RESEND_API_KEY) {
      try {
        await _sendEmailViaResend({ to: settings.email, subject:`🤖 AI Team Daily Stand-up — ${fmtDate}`, html: emailHtml, text: slackText });
        result.emailOk = true;
      } catch (e) { result.emailError = e.message; console.warn('[autoreport] email failed:', e.message); }
    } else if (!settings.email) { result.emailError = 'no recipient email configured'; }
      else { result.emailError = 'RESEND_API_KEY not configured'; }
  }
  // Always include the rendered content for the UI's View/Download buttons
  result.html = emailHtml;
  result.text = slackText;
  result.reports = reports;
  result.fmtDate = fmtDate;

  // Update lastRun + history. Manual triggers update lastRunAt/Status but
  // do NOT update lastScheduledRunDate, so the same day's scheduled run
  // still fires on time. Only scheduled runs advance lastScheduledRunDate.
  try {
    const todayInTz = new Intl.DateTimeFormat('en-CA', { year:'numeric', month:'2-digit', day:'2-digit', timeZone: _tz }).format(new Date());
    const settingsKey = _officerKey(_AUTOREPORT_KEY, tid);
    const cur = (await _db.kvGet(settingsKey, _AUTOREPORT_DEFAULTS)) || _AUTOREPORT_DEFAULTS;
    const update = { ...cur, lastRunDate: todayInTz, lastRunAt: result.sentAt, lastRunStatus: result };
    if (!manualTrigger) update.lastScheduledRunDate = todayInTz;
    await _db.kvSet(settingsKey, update);
    const histKey = _officerKey(_AUTOREPORT_HISTORY_KEY, tid);
    const hist = (await _db.kvGet(histKey, [])) || [];
    const safeHist = Array.isArray(hist) ? hist : [];
    safeHist.unshift({ at: result.sentAt, manualTrigger, slackOk: result.slackOk, emailOk: result.emailOk, recipientEmail: result.recipientEmail, officerCount: reports.length });
    await _db.kvSet(histKey, safeHist.slice(0, 60));
  } catch(_) {}

  return { ...result, officerCount: reports.length };
}

// Tick every 60s. Fires once per day when:
//   (a) the user's local time has reached HH:MM (now-minutes >= scheduled-minutes), AND
//   (b) we haven't already fired a scheduled run today (in user's tz).
// Using a "now >= scheduled" check (not exact equality) means a server
// that was down at HH:MM will catch up on the next tick after restart,
// instead of skipping the whole day.
async function _autoReportTickOnce() {
  const _db = require('./db');
  if (!_db.hasDb()) return;
  // Each workspace has its own schedule; fire per-tenant independently.
  let tenantIds = [];
  try { tenantIds = await _officerCtx.listActiveTenantIds(); } catch(_) { tenantIds = []; }
  for (const tid of tenantIds) {
    try {
      const s = (await _db.kvGet(_officerKey(_AUTOREPORT_KEY, tid), _AUTOREPORT_DEFAULTS)) || _AUTOREPORT_DEFAULTS;
      if (!s.enabled) continue;
      let tz = s.timezone || 'UTC';
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); } catch { tz = 'UTC'; }
      const parts = new Intl.DateTimeFormat('en-CA', { hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', timeZone: tz }).formatToParts(new Date());
      const get = (t) => parts.find(p=>p.type===t)?.value;
      const hour = parseInt(get('hour'), 10);
      const minute = parseInt(get('minute'), 10);
      const today = `${get('year')}-${get('month')}-${get('day')}`;
      const scheduledMinsOfDay = (s.hour|0) * 60 + (s.minute|0);
      const nowMinsOfDay = hour * 60 + minute;
      if (nowMinsOfDay >= scheduledMinsOfDay && s.lastScheduledRunDate !== today) {
        console.log('[autoreport] firing scheduled run', { tenantId: tid, tz, nowTime: `${hour}:${minute}`, scheduled: `${s.hour}:${s.minute}`, today, catchup: nowMinsOfDay > scheduledMinsOfDay });
        await _runAutonomousDailyReports({ manualTrigger:false, tenantId: tid });
      }
    } catch (e) { console.warn('[autoreport tick] tenant', tid, e.message); }
  }
}
let _autoReportTickInFlight = false;
async function _autoReportTickGuarded() {
  if (_autoReportTickInFlight) return;
  _autoReportTickInFlight = true;
  try { await _autoReportTickOnce(); }
  catch (e) { console.warn('[autoreport tick]', e.message); }
  finally { _autoReportTickInFlight = false; }
}
global._serverStartedAt = global._serverStartedAt || new Date().toISOString();
const _autoReportTickGuardedInstrumented = async () => { global._lastAutoTickAt = Date.now(); return _autoReportTickGuarded(); };
// Only the live server runs these crons; required as a module for tests
// (buildApp) they are skipped so importing the app starts no timers.
if (_runtimeFlags.backgroundEnabled()) {
  setInterval(_autoReportTickGuardedInstrumented, 60 * 1000);
  // Also run once shortly after boot so a server that was down across the
  // scheduled window catches up immediately on restart instead of waiting
  // up to a minute.
  setTimeout(_autoReportTickGuardedInstrumented, 8000);
}

// ── Autonomous Officer Meetings ───────────────────────────────────────────
// The AI Team self-schedules cross-functional meetings on a recurring cadence
// (daily or weekly on a chosen weekday). Topics rotate through a curated set
// so meetings stay relevant. All AI officers attend by default. Minutes use
// the same AI minute-taker as manual meetings, then are saved into the
// existing officer_meetings_v1 store so they appear in both the AI Team
// meetings panel and the new Manage → Team Meetings calendar.
const _AUTOMTG_KEY = 'officer_automtg_settings_v1';
const _AUTOMTG_DEFAULTS = { enabled:false, frequency:'weekly', dayOfWeek:1, hour:9, minute:30, timezone:'UTC', topics:[
  'Weekly cross-functional sync — what shipped, what slipped, what is blocked',
  'Pipeline + funnel health review across acquisition, activation, retention',
  'Brand + content calendar alignment for the next 14 days',
  'Budget pacing + reallocation across paid channels',
  'Customer feedback loop — wins, complaints, churn signals',
  'Competitive intel briefing — moves observed in the last 7 days',
  'Quarterly OKR check-in and risk register',
  'Technical Manager system status — APIs, LLMs, auth, tokens, security, update safety'
], lastScheduledRunDate:'' };

// One-time boot migration: move legacy GLOBAL officer singletons into the
// default (original owner) tenant's namespaced keys. Idempotent — no-op once
// the tenant keys exist. officer_tasks_v1 is shared with playbook_7day; both
// callers migrate the same base, second is a no-op (destination already set).
// Deferred 9s so the tenants/users schema is ready and getDefaultTenantId()
// resolves (otherwise it returns null this early and every migration skips).
// Live server only; skipped when required as a module for tests (buildApp).
if (_runtimeFlags.backgroundEnabled()) {
  setTimeout(async () => {
    try {
      for (const base of [_TASKS_KEY, _AVATAR_KEY, _MEETINGS_KEY, _AUTOREPORT_KEY, _AUTOREPORT_HISTORY_KEY, _AUTOMTG_KEY]) {
        await _officerScope.migrateGlobalSingleton(base, base);
      }
    } catch (e) { console.warn('[officer] boot migration', e.message); }
  }, 9000);
}

app.get('/api/officer/auto-meetings', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.json({ settings: _AUTOMTG_DEFAULTS });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:auto-meetings:get' });
    if (tid == null) return res.json({ settings: _AUTOMTG_DEFAULTS });
    const s = (await _db.kvGet(_officerKey(_AUTOMTG_KEY, tid), _AUTOMTG_DEFAULTS)) || _AUTOMTG_DEFAULTS;
    res.json({ settings: { ..._AUTOMTG_DEFAULTS, ...s } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/officer/auto-meetings', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:auto-meetings:post' });
    if (tid == null) return res.status(400).json({ error: 'no_tenant' });
    const { enabled, frequency, dayOfWeek, hour, minute, timezone } = req.body || {};
    const freq = ['daily','weekly'].includes(frequency) ? frequency : 'weekly';
    const dow = Math.max(0, Math.min(6, parseInt(dayOfWeek, 10) || 0));
    const h = Math.max(0, Math.min(23, parseInt(hour, 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(minute, 10) || 0));
    let tz = String(timezone || 'UTC').slice(0, 64);
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); }
    catch { return res.status(400).json({ error: 'invalid timezone' }); }
    const key = _officerKey(_AUTOMTG_KEY, tid);
    const cur = (await _db.kvGet(key, _AUTOMTG_DEFAULTS)) || _AUTOMTG_DEFAULTS;
    const next = { ...cur, enabled: !!enabled, frequency: freq, dayOfWeek: dow, hour: h, minute: m, timezone: tz };
    await _db.kvSet(key, next);
    res.json({ ok: true, settings: next });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ── AI Employees system health/status ─────────────────────────────────────
// Single endpoint that tells the UI whether every part of the AI Team
// system is wired up and live: database, AI provider, both schedulers,
// and the most recent activity timestamps.
app.get('/api/officer/system-status', async (req, res) => {
  try {
    const _db = require('./db');
    const dbOk = !!_db.hasDb();
    const aiOk = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    let autoreport = { enabled:false, frequency:'daily', hour:null, minute:null, timezone:'UTC', lastScheduledRunDate:'' };
    let automtg    = { enabled:false, frequency:'weekly', dayOfWeek:1, hour:null, minute:null, timezone:'UTC', lastScheduledRunDate:'' };
    let lastMeetingAt = null, totalMeetings = 0, lastReportAt = null, totalReports = 0;
    if (dbOk) {
      const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:system-status' });
      if (tid != null) {
        try { autoreport = { ...autoreport, ...((await _db.kvGet(_officerKey(_AUTOREPORT_KEY, tid), _AUTOREPORT_DEFAULTS)) || {}) }; } catch(_){}
        try { automtg    = { ...automtg,    ...((await _db.kvGet(_officerKey(_AUTOMTG_KEY, tid), _AUTOMTG_DEFAULTS)) || {}) }; } catch(_){}
        try {
          const meetings = (await _db.kvGet(_officerKey(_MEETINGS_KEY, tid), [])) || [];
          if (Array.isArray(meetings)) { totalMeetings = meetings.length; if (meetings[0]?.scheduledAt) lastMeetingAt = meetings[0].scheduledAt; }
        } catch(_){}
        try {
          const hist = (await _db.kvGet(_officerKey(_AUTOREPORT_HISTORY_KEY, tid), [])) || [];
          if (Array.isArray(hist)) { totalReports = hist.length; if (hist[0]?.runAt) lastReportAt = hist[0].runAt; }
        } catch(_){}
      }
    }
    const tickAlive = (Date.now() - (global._lastAutoTickAt || 0)) < 90 * 1000;
    res.json({
      ok: dbOk && aiOk,
      checks: {
        server:        { ok: true,  label: 'Server reachable' },
        database:      { ok: dbOk,  label: dbOk ? 'Postgres connected' : 'Postgres NOT configured' },
        aiProvider:    { ok: aiOk,  label: aiOk ? 'OpenAI key configured' : 'OPENAI_API_KEY missing — minutes/reports will use fallback' },
        scheduler:     { ok: tickAlive, label: tickAlive ? 'Background scheduler ticking' : 'Scheduler tick not seen in last 90s' },
        autoReport:    { ok: !!autoreport.enabled, label: autoreport.enabled ? `Daily reports ON · ${String(autoreport.hour).padStart(2,'0')}:${String(autoreport.minute).padStart(2,'0')} ${autoreport.timezone}` : 'Daily reports OFF' },
        autoMeetings:  { ok: !!automtg.enabled,    label: automtg.enabled    ? `Auto-meetings ON · ${automtg.frequency==='weekly'?['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][automtg.dayOfWeek|0]+' ':''}${String(automtg.hour).padStart(2,'0')}:${String(automtg.minute).padStart(2,'0')} ${automtg.timezone}` : 'Auto-meetings OFF' }
      },
      activity: {
        lastReportAt, totalReports,
        lastMeetingAt, totalMeetings,
        lastTickAt: global._lastAutoTickAt || null,
        serverStartedAt: global._serverStartedAt || null,
        uptimeSec: Math.round(process.uptime())
      },
      schedules: { autoReport: autoreport, autoMeetings: automtg }
    });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.post('/api/officer/auto-meetings/run-now', async (req, res) => {
  try {
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:auto-meetings:run-now' });
    if (tid == null) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const meeting = await _runAutonomousMeeting({ manualTrigger: true, tenantId: tid });
    res.json({ ok: true, meeting });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// require() is rebased to app root inside register() — use the services path.
const { normalizeFullTeamMinutes: _normalizeFullTeamMinutes } = require('./services/officer/meeting_minutes');

async function _runAutonomousMeeting({ manualTrigger = false, tenantId = null } = {}) {
  const _db = require('./db');
  if (!_db.hasDb()) throw new Error('database not configured');
  if (tenantId == null) throw new Error('no_tenant');
  const tid = tenantId;
  const settings = (await _db.kvGet(_officerKey(_AUTOMTG_KEY, tid), _AUTOMTG_DEFAULTS)) || _AUTOMTG_DEFAULTS;
  const tasksStore = (await _db.kvGet(_officerKey(_TASKS_KEY, tid), {})) || {};
  // Entire AI executive roster is mandatory when auto-meetings are used.
  const attendees = _OFFICER_ROLES.map(r => _OFFICER_TITLES[r]);
  const tasksByRole = {};
  attendees.forEach((t, i) => { tasksByRole[t] = Array.isArray(tasksStore[_OFFICER_ROLES[i]]) ? tasksStore[_OFFICER_ROLES[i]].slice(0,8) : []; });
  // Rotate topic by week-of-year so consecutive meetings differ
  const topics = Array.isArray(settings.topics) && settings.topics.length ? settings.topics : _AUTOMTG_DEFAULTS.topics;
  const wk = Math.floor(Date.now() / (7 * 86400000));
  const topic = topics[wk % topics.length];

  let parsed = null;
  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    const prompt = `You are the meeting secretary for InfoGenie's AI executive team.

This is a MANDATORY full-team meeting. EVERY attendee listed MUST appear in departmentUpdates — no absences. Include the Technical Manager with a live platform-status update (APIs, LLMs, auth, security, pages/features).

ATTENDEES (all required): ${attendees.join(', ')}
TOPIC: ${topic}

ASSIGNED RESPONSIBILITIES BY OFFICER:
${JSON.stringify(tasksByRole, null, 2)}

For EACH officer produce a department update with exactly these fields:
- whatWorks: what is working in their department
- whatDoesNotWork: what is not working
- why: why it is not working (or "n/a" if nothing broken)
- remedialAction: the concrete fix they propose

Then:
- decisions: agreed remedies the team accepts
- actionItems: verb-led tasks owned by a role, status starts as "agreed", with dueIn

Return ONLY this JSON:
{
  "discussion": ["<paragraph>", "..."],
  "departmentUpdates": [{"officer":"<exact attendee title>","whatWorks":"...","whatDoesNotWork":"...","why":"...","remedialAction":"..."}],
  "decisions": ["<agreed decision>", "..."],
  "actionItems":[{"owner":"<attendee title>","action":"<verb-led>","dueIn":"24h|3d|7d|14d","status":"agreed"}]
}`;
    try {
      const completion = await Promise.race([
        openai.chat.completions.create({
          model: 'gpt-5-mini', response_format: { type: 'json_object' },
          max_tokens: 3200, temperature: 0.5,
          messages: [
            { role:'system', content:'You are a precise meeting secretary. Output strict JSON only. Every listed attendee must have a department update.' },
            { role:'user', content: prompt }
          ]
        }),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('openai_timeout_25s')), 25000))
      ]);
      const j = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
      if (j && typeof j === 'object') parsed = j;
    } catch (e) { console.warn('[auto-meeting] AI failed:', e.message); }
  }
  const minutes = _normalizeFullTeamMinutes(parsed, attendees, topic);
  const id = 'mtg_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const record = { id, scheduledAt: new Date().toISOString(), attendees, topic, autonomous: true, manualTrigger, ...minutes };

  const meetingsKey = _officerKey(_MEETINGS_KEY, tid);
  const cur = (await _db.kvGet(meetingsKey, [])) || [];
  const safeCur = Array.isArray(cur) ? cur : [];
  safeCur.unshift(record);
  await _db.kvSet(meetingsKey, safeCur.slice(0, 200));

  // Mark scheduled day as fired (manual triggers do not advance this)
  if (!manualTrigger) {
    let tz = settings.timezone || 'UTC';
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); } catch { tz = 'UTC'; }
    const today = new Intl.DateTimeFormat('en-CA', { year:'numeric', month:'2-digit', day:'2-digit', timeZone: tz }).format(new Date());
    await _db.kvSet(_officerKey(_AUTOMTG_KEY, tid), { ...settings, lastScheduledRunDate: today });
  }
  return record;
}

async function _autoMeetingTickOnce() {
  const _db = require('./db');
  if (!_db.hasDb()) return;
  // Each workspace self-schedules independently.
  let tenantIds = [];
  try { tenantIds = await _officerCtx.listActiveTenantIds(); } catch(_) { tenantIds = []; }
  for (const tid of tenantIds) {
    try {
      const s = (await _db.kvGet(_officerKey(_AUTOMTG_KEY, tid), _AUTOMTG_DEFAULTS)) || _AUTOMTG_DEFAULTS;
      if (!s.enabled) continue;
      let tz = s.timezone || 'UTC';
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); } catch { tz = 'UTC'; }
      const parts = new Intl.DateTimeFormat('en-CA', { hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short', timeZone: tz }).formatToParts(new Date());
      const get = (t) => parts.find(p=>p.type===t)?.value;
      const hour = parseInt(get('hour'), 10);
      const minute = parseInt(get('minute'), 10);
      const today = `${get('year')}-${get('month')}-${get('day')}`;
      const wkMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
      const dow = wkMap[get('weekday')] ?? 0;
      if (s.frequency === 'weekly' && dow !== (s.dayOfWeek|0)) continue;
      const scheduledMins = (s.hour|0)*60 + (s.minute|0);
      const nowMins = hour*60 + minute;
      if (nowMins >= scheduledMins && s.lastScheduledRunDate !== today) {
        console.log('[auto-meeting] firing', { tenantId: tid, tz, today, scheduled:`${s.hour}:${s.minute}`, freq: s.frequency });
        try { await _runAutonomousMeeting({ manualTrigger:false, tenantId: tid }); }
        catch (e) { console.warn('[auto-meeting] run failed:', e.message); }
      }
    } catch (e) { console.warn('[auto-meeting tick] tenant', tid, e.message); }
  }
}
let _autoMeetingTickInFlight = false;
async function _autoMeetingTickGuarded() {
  if (_autoMeetingTickInFlight) return;
  _autoMeetingTickInFlight = true;
  try { await _autoMeetingTickOnce(); }
  catch (e) { console.warn('[auto-meeting tick]', e.message); }
  finally { _autoMeetingTickInFlight = false; }
}
// Live server only; skipped when required as a module for tests (buildApp).
if (_runtimeFlags.backgroundEnabled()) {
  setInterval(_autoMeetingTickGuarded, 60 * 1000);
  setTimeout(_autoMeetingTickGuarded, 12000);
}

// Mark an agreed meeting action as in_progress / implemented after the team agrees.
app.post('/api/officer/meetings/:id/action-status', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'database not configured' });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:meetings:action-status' });
    if (tid == null) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const meetingId = String(req.params.id || '').trim();
    const actionId = String(req.body?.actionId || '').trim();
    const status = String(req.body?.status || '').trim();
    if (!meetingId || !actionId) return res.status(400).json({ ok: false, error: 'meeting id + actionId required' });
    if (!['agreed', 'in_progress', 'implemented'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'status must be agreed|in_progress|implemented' });
    }
    const key = _officerKey(_MEETINGS_KEY, tid);
    const cur = (await _db.kvGet(key, [])) || [];
    const list = Array.isArray(cur) ? cur : [];
    const idx = list.findIndex((m) => m && m.id === meetingId);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'meeting not found' });
    const meeting = { ...list[idx] };
    const actions = Array.isArray(meeting.actionItems) ? meeting.actionItems.map((a, i) => ({
      ...a,
      id: a.id || `act_${i + 1}`,
    })) : [];
    let target = actions.findIndex((a) => a.id === actionId);
    // Support clients that pass idx_N for older minutes without action ids.
    if (target < 0 && /^idx_\d+$/.test(actionId)) {
      const n = parseInt(actionId.slice(4), 10);
      if (Number.isFinite(n) && n >= 0 && n < actions.length) target = n;
    }
    if (target < 0) return res.status(404).json({ ok: false, error: 'action not found' });
    actions[target] = {
      ...actions[target],
      status,
      implementedAt: status === 'implemented' ? new Date().toISOString() : null,
    };
    meeting.actionItems = actions;
    list[idx] = meeting;
    await _db.kvSet(key, list);
    res.json({ ok: true, meeting });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/officer/meetings/:id', async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.json({ ok:true });
    const tid = await _officerCtx.resolveTenantId(req, { label: 'officer:meetings:delete' });
    if (tid == null) return res.status(400).json({ error: 'no_tenant' });
    const key = _officerKey(_MEETINGS_KEY, tid);
    const cur = (await _db.kvGet(key, [])) || [];
    const next = (Array.isArray(cur) ? cur : []).filter(m => m && m.id !== req.params.id);
    await _db.kvSet(key, next);
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ops Officer scan — aggregates campaign QA, asset library, and lead-routing
// health from existing in-memory/DB state. Returns a structured snapshot the
// frontend feeds into /api/officer/brief for the AI narrative.
app.post('/api/ops-officer/scan', async (req, res) => {
  try {
    const out = { campaigns:{ total:0, stale:0, missingCreative:0, recent:0 }, assets:{ uploaded:0, missing:[] }, leads:{ qualified:0, unqualified:0 }, goals:{ total:0, offTrack:0 } };
    const _pg = (typeof _db !== 'undefined' && _db.getPool) ? _db.getPool() : null;
    // Campaigns (from optimizer kv_store)
    try {
      if (!_pg) throw new Error('no db');
      const r = await _pg.query(`SELECT value FROM kv_store WHERE key='optimizer:campaigns' LIMIT 1`);
      const camps = r.rows?.[0]?.value?.campaigns || r.rows?.[0]?.value || [];
      const list = Array.isArray(camps) ? camps : [];
      const now = Date.now();
      out.campaigns.total = list.length;
      list.forEach(c => {
        const updated = c.lastUpdated || c.createdAt || c.created_at || 0;
        const ageDays = updated ? (now - new Date(updated).getTime())/86400000 : 999;
        if (ageDays > 14) out.campaigns.stale++;
        if (ageDays <= 7) out.campaigns.recent++;
        if (!c.creatives && !c.adCopy && !c.creative) out.campaigns.missingCreative++;
      });
    } catch(e) {}
    // Brand assets
    try {
      const r = await _pg.query(`SELECT value FROM kv_store WHERE key='brand:assets' LIMIT 1`);
      const a = r.rows?.[0]?.value || {};
      const have = (k) => !!(a[k] && (Array.isArray(a[k]) ? a[k].length : true));
      out.assets.uploaded = ['logo','logos','colors','colours','voice','tagline','fonts'].filter(have).length;
      ['logo','colors','voice','tagline'].forEach(k => { if (!have(k) && !have(k+'s')) out.assets.missing.push(k); });
    } catch(e) {}
    // Leads
    try {
      const r = await _pg.query(`SELECT value FROM kv_store WHERE key LIKE 'leads:%'`);
      (r.rows||[]).forEach(row => {
        const arr = Array.isArray(row.value) ? row.value : (row.value?.leads || []);
        arr.forEach(l => { if (l.qualified || l.score >= 70) out.leads.qualified++; else out.leads.unqualified++; });
      });
    } catch(e) {}
    // Goals
    try {
      const r = await _pg.query(`SELECT value FROM kv_store WHERE key='goals:list' LIMIT 1`);
      const goals = r.rows?.[0]?.value?.goals || r.rows?.[0]?.value || [];
      const list = Array.isArray(goals) ? goals : [];
      out.goals.total = list.length;
      out.goals.offTrack = list.filter(g => g.status === 'off-track' || g.status === 'at-risk').length;
    } catch(e) {}
    res.json({ ok:true, snapshot: out, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok:false, error: err.message });
  }
});
};
