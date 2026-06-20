// Goals · Lead Qualifier · Re-engagement routes.
// Extracted verbatim from server.js (pure structural move — no behavior change).
// Shared module-scope helpers are injected via `ctx`. NOTE: `_amplitudeAuthHeader`
// is intentionally NOT destructured here — in server.js it was an undeclared
// reference guarded by a try/catch, and leaving it undeclared preserves the exact
// original behavior (its read throws and the catch yields "Amplitude lookup skipped.").
module.exports = function register(app, ctx) {
  const {
    _amplitudeFetch, _amplitudeFmtDate, _dripLoad, _dripLock, _dripSave, _enrollDripCore, _fetchAmplitudeConversions, _fetchGoogleAdsSpend, _fetchMetaSpend, _fetchTikTokSpend, _tkvCtx, _tkvRead, _tkvWrite, openaiChatWithRetry,
  } = ctx;

// Per-workspace: goals live at kv `goals:t<tid>` (array). null tid → empty.
const GOALS_BASE = 'goals';
let _goalsLockTail = Promise.resolve();
function _goalsLock(fn) {
  const next = _goalsLockTail.then(() => fn());
  _goalsLockTail = next.catch(() => {});
  return next;
}
async function _readGoals(tid) {
  const list = await _tkvRead(GOALS_BASE, tid, () => []);
  return Array.isArray(list) ? list : [];
}
async function _writeGoals(tid, goals) {
  return await _tkvWrite(GOALS_BASE, tid, Array.isArray(goals) ? goals : []);
}
const GOAL_METRICS = {
  'drip.bounceRate':   { label:'Drip Bounce Rate',         direction:'lte', unit:'%' },
  'drip.totalSends':   { label:'Drip Email Sends',          direction:'gte', unit:''  },
  'drip.deliveryRate': { label:'Drip Delivery Rate',        direction:'gte', unit:'%' },
  'amp.sessions':      { label:'Amplitude Sessions (30d)',  direction:'gte', unit:''  },
  'ads.totalSpend':    { label:'Total Ad Spend (30d)',      direction:'lte', unit:'$' },
  'ads.cac':           { label:'Blended CAC',               direction:'lte', unit:'$' },
};
async function _measureGoal(metric, tid) {
  if (metric.startsWith('drip.')) {
    // Reuse drip-store logic inline (cheaper than HTTP self-call)
    const list = tid == null ? [] : await _dripLoad(tid);
    let attempts = 0, bounced = 0, sentTotal = 0, delivered = 0;
    for (const e of list) {
      for (const h of (e.history || [])) {
        if (h.ok) sentTotal++;
        if (!/email/i.test(h.channel || '')) continue;
        if (h.note && /dry-run/i.test(h.note)) continue;
        attempts++;
        if (h.bounced || h.failureType === 'bounce') bounced++;
        else if (h.delivered === true) delivered++;
        else if (h.ok && !h.bounced) delivered++;
      }
    }
    const bounceRate    = attempts > 0 ? +((bounced   / attempts) * 100).toFixed(1) : 0;
    const deliveryRate  = attempts > 0 ? +((delivered / attempts) * 100).toFixed(1) : 0;
    if (metric === 'drip.bounceRate')   return bounceRate;
    if (metric === 'drip.totalSends')   return sentTotal;
    if (metric === 'drip.deliveryRate') return deliveryRate;
  }
  if (metric === 'amp.sessions') {
    const apiKey = process.env.AMPLITUDE_API_KEY;
    const secretKey = process.env.AMPLITUDE_SECRET_KEY;
    if (!apiKey || !secretKey) return null;
    const auth = 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30);
    const fmt = _amplitudeFmtDate;
    const e = encodeURIComponent(JSON.stringify({ event_type:'_active' }));
    const j = await _amplitudeFetch(`/api/2/sessions/average?start=${fmt(start)}&end=${fmt(end)}&e=${e}`, auth);
    const series = j?.data?.series?.[0] || [];
    return series.reduce((a, b) => a + (Number(b) || 0), 0);
  }
  if (metric === 'ads.totalSpend' || metric === 'ads.cac') {
    const [meta, google, tiktok] = await Promise.all([
      _fetchMetaSpend(30), _fetchGoogleAdsSpend(30), _fetchTikTokSpend(30),
    ]);
    const totalSpend = [meta, google, tiktok].filter(c => c.ok).reduce((s, c) => s + (c.spend || 0), 0);
    if (metric === 'ads.totalSpend') return +totalSpend.toFixed(2);
    const amp = await _fetchAmplitudeConversions(30);
    const customers = amp.ok && amp.conversions
      ? amp.conversions
      : [meta, google, tiktok].filter(c => c.ok).reduce((s, c) => s + (c.conversions || 0), 0);
    return customers > 0 ? +(totalSpend / customers).toFixed(2) : null;
  }
  return null;
}
function _goalStatus(g, current) {
  if (current == null) return { status:'unknown', pct:null, current:null };
  const meta = GOAL_METRICS[g.metric];
  const dir  = meta?.direction || 'gte';
  let pct, status;
  if (dir === 'gte') {
    pct = g.target > 0 ? Math.min(100, Math.round((current / g.target) * 100)) : 0;
    status = current >= g.target ? 'on-track' : (pct >= 80 ? 'at-risk' : 'off-track');
  } else {
    // For "lower-is-better" metrics (CAC, bounce rate, spend cap):
    //  - <= target = on-track
    //  - within 20% over target = at-risk
    //  - more than 20% over = off-track
    pct = current > 0 ? Math.min(100, Math.round((g.target / current) * 100)) : 100;
    status = current <= g.target ? 'on-track' : (current <= g.target * 1.2 ? 'at-risk' : 'off-track');
  }
  return { status, pct, current };
}
app.get('/api/goals', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'goals:list' });
    if (tid == null) return res.json({ ok:true, goals: [], metrics: GOAL_METRICS });
    const goals = await _goalsLock(() => _readGoals(tid));
    res.json({ ok:true, goals, metrics: GOAL_METRICS });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ── AI-suggest helper for the Add Goal modal ─────────────────────────────────
// Front-end calls this when the user clicks "✨ AI suggest" next to the
// Target value or Label inputs. Body: { metric, field: 'target'|'label',
// currentLabel? }. Returns { ok, value, reason } or { ok, label, reason }.
// We measure the live current value of the metric so the suggested target is
// grounded in reality (e.g. "current CAC is $42 → suggest $34, a realistic
// 20% improvement"). Falls back to a sensible deterministic suggestion if
// OpenAI is unavailable so the button never feels broken.
app.post('/api/goals/suggest', async (req, res) => {
  try {
    const { metric, field } = req.body || {};
    if (!metric || !GOAL_METRICS[metric]) return res.status(400).json({ ok:false, error:'invalid-metric' });
    if (field !== 'target' && field !== 'label') return res.status(400).json({ ok:false, error:'invalid-field' });
    const meta = GOAL_METRICS[metric];
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'goals:suggest' });
    let current = null;
    try { current = await _measureGoal(metric, tid); } catch (_) { current = null; }

    // Deterministic fallback so the button always returns something useful
    // even if the LLM is degraded or no API key is set.
    const _fallbackTarget = () => {
      if (current == null) {
        if (meta.unit === '%' && meta.direction === 'lte') return 2.0;
        if (meta.unit === '%' && meta.direction === 'gte') return 95.0;
        if (meta.unit === '$' && meta.direction === 'lte') return 1000;
        return 100;
      }
      const c = Number(current);
      if (meta.direction === 'gte') return +(c * 1.20).toFixed(2);   // +20%
      return +(c * 0.80).toFixed(2);                                  // -20%
    };
    const _fallbackLabel = () => {
      const q = `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
      const yr = String(new Date().getFullYear()).slice(2);
      return `${q}/${yr} ${meta.label} target`;
    };

    // Try OpenAI first — strict-JSON prompt, short max_tokens for speed.
    try {
      const sys = `You set realistic marketing KPI targets for a small-to-mid business owner. Always return strict JSON.`;
      const userMsg = field === 'target'
        ? `Suggest a realistic but ambitious TARGET VALUE for this metric. Return JSON: { "value": <number>, "reason": "<one short sentence>" }.\nMetric: ${meta.label}\nUnit: ${meta.unit || '(count)'}\nDirection: ${meta.direction === 'gte' ? 'higher is better' : 'lower is better'}\nCurrent value: ${current == null ? 'unknown' : current}\nGuidance: aim for a meaningful but achievable improvement over current (typically 15-30%); if current is unknown, propose a sensible industry benchmark.`
        : `Suggest a short, human-friendly LABEL (max 6 words) for a goal tracking this metric. Return JSON: { "label": "<text>", "reason": "<one short sentence>" }.\nMetric: ${meta.label}\nUnit: ${meta.unit || '(count)'}\nCurrent value: ${current == null ? 'unknown' : current}\nGuidance: include the time horizon (e.g. Q-prefix or "next 90 days") and the business intent ("acquisition", "retention", "efficiency").`;
      const completion = await openaiChatWithRetry({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 160,
      });
      const parsed = JSON.parse(completion.choices[0].message.content || '{}');
      if (field === 'target') {
        const v = Number(parsed.value);
        if (!Number.isFinite(v) || v < 0) throw new Error('bad-value');
        return res.json({ ok:true, value: +v.toFixed(2), reason: String(parsed.reason || '').slice(0, 200), current });
      }
      const lbl = String(parsed.label || '').trim().slice(0, 80);
      if (!lbl) throw new Error('bad-label');
      return res.json({ ok:true, label: lbl, reason: String(parsed.reason || '').slice(0, 200), current });
    } catch (_llmErr) {
      if (field === 'target') {
        const v = _fallbackTarget();
        return res.json({ ok:true, value: v, reason: 'Suggested ~20% improvement on your current value.', current, fallback: true });
      }
      return res.json({ ok:true, label: _fallbackLabel(), reason: 'Default time-stamped goal label.', current, fallback: true });
    }
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});
app.post('/api/goals', async (req, res) => {
  const { metric, target, label } = req.body || {};
  if (!metric || !GOAL_METRICS[metric]) return res.status(400).json({ ok:false, error:'invalid-metric' });
  const t = Number(target);
  if (!Number.isFinite(t) || t < 0) return res.status(400).json({ ok:false, error:'invalid-target' });
  const goal = {
    id: `g_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    metric, target: t,
    label: label || GOAL_METRICS[metric].label,
    createdAt: new Date().toISOString(),
  };
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'goals:create' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    await _goalsLock(async () => {
      const goals = await _readGoals(tid);
      goals.push(goal);
      await _writeGoals(tid, goals);
    });
    res.json({ ok:true, goal });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});
app.delete('/api/goals/:id', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'goals:delete' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    let removed = false;
    await _goalsLock(async () => {
      const goals = await _readGoals(tid);
      const idx = goals.findIndex(g => g.id === req.params.id);
      if (idx === -1) return;
      goals.splice(idx, 1);
      await _writeGoals(tid, goals);
      removed = true;
    });
    if (!removed) return res.status(404).json({ ok:false, error:'not-found' });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});
app.get('/api/goals/check', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'goals:check' });
    if (tid == null) return res.json({ ok:true, goals: [], rootCause: null, generatedAt: new Date().toISOString() });
    const goals = await _goalsLock(() => _readGoals(tid));
    const evaluated = await Promise.all(goals.map(async g => {
      try {
        const current = await _measureGoal(g.metric, tid);
        const st = _goalStatus(g, current);
        return { ...g, ...st, meta: GOAL_METRICS[g.metric] };
      } catch (e) {
        return { ...g, status:'error', error: e.message, current:null, pct:null, meta: GOAL_METRICS[g.metric] };
      }
    }));
    const offTrack = evaluated.filter(g => g.status === 'off-track' || g.status === 'at-risk');
    let rootCause = null;
    if (offTrack.length > 0) {
      try {
        const completion = await openaiChatWithRetry({
          model: 'gpt-5',
          messages: [
            { role:'system', content:'You are a marketing performance analyst. For each off-track or at-risk goal below, give one root-cause hypothesis (1 sentence) and one specific corrective action a marketer can take in InfoGenie (1 sentence). Return JSON: { "byGoalId": { "<id>": { "hypothesis": string, "action": string } } }' },
            { role:'user', content: `Goals:\n${JSON.stringify(offTrack.map(g => ({
              id: g.id, label: g.label, metric: g.metric,
              target: g.target, current: g.current,
              direction: g.meta?.direction, unit: g.meta?.unit,
              status: g.status,
            })), null, 2)}` },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 900,
        });
        rootCause = JSON.parse(completion.choices[0].message.content || '{}').byGoalId || {};
      } catch (e) { rootCause = { _error: e.message }; }
    }
    res.json({ ok:true, goals: evaluated, rootCause, generatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEAD QUALIFIER — GPT-4o classifies an inbound lead (BANT + intent + fit) and
// persists the qualification. File-backed store mirroring the goals pattern
// (mutex + atomic tmp+rename writes).
// ─────────────────────────────────────────────────────────────────────────────
// Per-workspace: qualified leads live at kv `qualified_leads:t<tid>` (array).
const LEADS_BASE = 'qualified_leads';
let _leadsLockTail = Promise.resolve();
function _leadsLock(fn) {
  const next = _leadsLockTail.then(() => fn());
  _leadsLockTail = next.catch(() => {});
  return next;
}
async function _readLeads(tid) {
  const list = await _tkvRead(LEADS_BASE, tid, () => []);
  return Array.isArray(list) ? list : [];
}
async function _writeLeads(tid, leads) {
  return await _tkvWrite(LEADS_BASE, tid, Array.isArray(leads) ? leads : []);
}

app.get('/api/leads/qualified', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'leads:list' });
    if (tid == null) return res.json({ ok:true, leads: [] });
    const leads = await _leadsLock(() => _readLeads(tid));
    leads.sort((a, b) => (b.qualifiedAt || 0) - (a.qualifiedAt || 0));
    res.json({ ok:true, leads });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.post('/api/leads/qualify', async (req, res) => {
  try {
    const { name, email, company, source, notes, behaviour } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ ok:false, error: 'email is required' });
    }
    const sysPrompt = `You are a B2B SaaS sales-development qualifier for InfoGenie (an AI marketing intelligence platform that helps marketing teams analyse competitors, run drip campaigns, monitor KPIs, and act on Amplitude data).

Score the lead 0–100 on overall fit + intent. Tier them: hot (75+), warm (45–74), cold (<45).

Apply BANT individually: each of budget, authority, need, timeline gets a string verdict ("strong" / "weak" / "unknown") and a one-line rationale.

Then list 1–3 concrete suggestedActions a salesperson can take next (e.g. "Send blended-CAC case study", "Enrol in 3-touch nurture", "Book discovery call this week").

Return ONLY valid JSON in this exact shape:
{ "score": number, "tier": "hot"|"warm"|"cold", "reasoning": string, "bant": { "budget": {"verdict": string, "why": string}, "authority": {...}, "need": {...}, "timeline": {...} }, "suggestedActions": [string, ...] }`;
    const userPrompt = `Lead context:
- name: ${name || '(not provided)'}
- email: ${email}
- company: ${company || '(not provided)'}
- source: ${source || '(not provided)'}
- notes: ${notes || '(none)'}
- recent behaviour: ${behaviour || '(none)'}`;
    let qualification;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-5',
        messages: [
          { role:'system', content: sysPrompt },
          { role:'user',   content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 700,
      });
      qualification = JSON.parse(completion.choices[0].message.content || '{}');
    } catch (e) {
      return res.status(502).json({ ok:false, error: 'GPT qualification failed: ' + e.message });
    }
    if (typeof qualification.score !== 'number') qualification.score = 0;
    if (!qualification.tier) qualification.tier = qualification.score >= 75 ? 'hot' : qualification.score >= 45 ? 'warm' : 'cold';
    const record = {
      id: 'lead_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      name: name || '',
      email: String(email).trim(),
      company: company || '',
      source: source || '',
      notes: notes || '',
      behaviour: behaviour || '',
      qualification,
      qualifiedAt: Date.now(),
    };
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'leads:qualify' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    await _leadsLock(async () => {
      const list = await _readLeads(tid);
      list.push(record);
      await _writeLeads(tid, list);
    });
    res.json({ ok:true, lead: record });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.delete('/api/leads/qualified/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'leads:delete' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    let removed = null;
    await _leadsLock(async () => {
      const list = await _readLeads(tid);
      const idx = list.findIndex(l => l.id === id);
      if (idx === -1) return;
      removed = list.splice(idx, 1)[0];
      await _writeLeads(tid, list);
    });
    if (!removed) return res.status(404).json({ ok:false, error: 'lead not found' });
    res.json({ ok:true, removed });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// RE-ENGAGEMENT — find dormant subscribers (drip-store + Amplitude inactivity),
// generate adaptive copy variants via GPT-4o, optionally launch a re-engagement
// campaign via the existing drip enrollment endpoint. File-backed campaign
// store mirrors the leads/goals pattern.
// ─────────────────────────────────────────────────────────────────────────────
// Per-workspace: re-engagement campaigns live at kv `reengage_campaigns:t<tid>` (array).
const REENGAGE_BASE = 'reengage_campaigns';
let _reengageLockTail = Promise.resolve();
function _reengageLock(fn) {
  const next = _reengageLockTail.then(() => fn());
  _reengageLockTail = next.catch(() => {});
  return next;
}
async function _readReengage(tid) {
  const list = await _tkvRead(REENGAGE_BASE, tid, () => []);
  return Array.isArray(list) ? list : [];
}
async function _writeReengage(tid, list) {
  return await _tkvWrite(REENGAGE_BASE, tid, Array.isArray(list) ? list : []);
}

// Find dormant subscribers — drip enrollees whose last touch (sentAt) is older
// than `days` ago, OR whose most recent send hard-failed. Always returns a list
// even when there's no data, so the UI never hangs.
app.get('/api/reengage/dormant', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const cutoff = Date.now() - days * 86400000;
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'reengage:dormant' });
    const enrollments = tid == null ? [] : await _dripLoad(tid);
    const dormant = [];
    for (const e of enrollments) {
      const history = e.history || [];
      const lastSend = history.length ? history[history.length - 1] : null;
      const lastSentAt = lastSend?.sentAt || e.startedAt || 0;
      const allFailed = history.length > 0 && history.every(h => !h.ok);
      const isDormant = lastSentAt < cutoff || allFailed;
      if (!isDormant) continue;
      dormant.push({
        email: e.email,
        name: e.name || '',
        brand: e.brand || '',
        lastSentAt,
        daysSinceLastSend: Math.round((Date.now() - lastSentAt) / 86400000),
        totalSends: history.filter(h => h.ok).length,
        allFailed,
        status: e.status || 'unknown',
      });
    }
    let amplitudeNote = null;
    try {
      const auth = _amplitudeAuthHeader && _amplitudeAuthHeader();
      if (auth) amplitudeNote = `Amplitude is connected — cross-channel inactivity check would refine this list further.`;
      else amplitudeNote = 'Amplitude not configured — using drip-store inactivity only.';
    } catch (_) { amplitudeNote = 'Amplitude lookup skipped.'; }
    res.json({ ok:true, days, cutoff, count: dormant.length, dormant, amplitudeNote });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// Upload a CSV of contacts (name,email,phone) and seed them into the drip
// store with a backdated startedAt so they immediately appear in the dormant
// audience list for the active days-window. The phone column is preserved on
// the record but currently UNUSED for outreach (no SMS channel yet) — the UI
// makes this clear so users don't expect SMS sends.
app.post('/api/reengage/upload-csv', async (req, res) => {
  try {
    const csv = String((req.body && req.body.csv) || '').trim();
    const backdateDays = Math.min(365, Math.max(1, parseInt(req.body && req.body.backdateDays, 10) || 60));
    if (!csv) return res.status(400).json({ ok:false, error:'csv body required' });
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ ok:false, error:'CSV must have a header row + at least one data row' });
    // Tiny-but-correct CSV parser: handles quoted fields with embedded commas
    // and escaped double quotes (""). Sufficient for hand-edited audience lists.
    const parseRow = (line) => {
      const out = []; let cur = ''; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { inQ = false; }
          else { cur += ch; }
        } else {
          if (ch === ',') { out.push(cur); cur = ''; }
          else if (ch === '"' && cur === '') { inQ = true; }
          else { cur += ch; }
        }
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    const header = parseRow(lines[0]).map(h => h.toLowerCase());
    const idxEmail = header.findIndex(h => /^e-?mail$/i.test(h));
    const idxName  = header.findIndex(h => /^(name|full.?name|first.?name)$/i.test(h));
    const idxPhone = header.findIndex(h => /^(phone|mobile|cell|tel(ephone)?)$/i.test(h));
    if (idxEmail < 0) return res.status(400).json({ ok:false, error:'CSV must include an "email" column header' });
    const startedAt = Date.now() - (backdateDays * 86400000);
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'reengage:upload-csv' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    let imported = 0; let skipped = 0; const errors = [];
    await _dripLock(async () => {
      const list = await _dripLoad(tid);
      const existingEmails = new Set(list.map(e => String(e.email || '').toLowerCase()));
      for (let li = 1; li < lines.length; li++) {
        const cols = parseRow(lines[li]);
        const email = (cols[idxEmail] || '').toLowerCase().trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { skipped++; continue; }
        if (existingEmails.has(email)) { skipped++; continue; }
        existingEmails.add(email);
        const name  = idxName  >= 0 ? (cols[idxName]  || '').trim() : '';
        const phone = idxPhone >= 0 ? (cols[idxPhone] || '').trim() : '';
        list.push({
          id: 'enr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
          email,
          name,
          phone, // recorded but not used for outreach yet (no SMS channel)
          brand: 'CSV import',
          source: 'csv-upload',
          startedAt,
          status: 'imported',
          history: [], // empty history → counted as dormant by /api/reengage/dormant
          sequence: [],
          stepIdx: 0,
        });
        imported++;
      }
      await _dripSave(tid, list);
    });
    res.json({ ok:true, imported, skipped, total: lines.length - 1, backdateDays });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.post('/api/reengage/generate', async (req, res) => {
  try {
    const segment = (req.body && req.body.segment) || 'dormant subscribers (no email opens in 30+ days)';
    const tone    = (req.body && req.body.tone)    || 'warm-and-curious';
    const brand   = (req.body && req.body.brand)   || 'InfoGenie';
    const sysPrompt = `You write re-engagement email copy for the brand "${brand}". The audience is: ${segment}. Tone: ${tone}.

Produce 3 distinct adaptive variants. Each variant should test a different psychological angle (e.g. curiosity, value-reminder, low-friction CTA, soft-breakup, social-proof).

Return ONLY valid JSON in this exact shape:
{ "variants": [ { "angle": string, "subject": string, "preheader": string, "body": string, "cta": string }, ... ] }

Body should be plain text under 100 words, second-person, no emojis unless they fit the tone, and use {{name}} as a merge token where natural.`;
    let parsed;
    try {
      const completion = await openaiChatWithRetry({
        model: 'gpt-5',
        messages: [
          { role:'system', content: sysPrompt },
          { role:'user',   content: 'Generate the 3 variants now.' },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1100,
      });
      parsed = JSON.parse(completion.choices[0].message.content || '{}');
    } catch (e) {
      return res.status(502).json({ ok:false, error: 'GPT generation failed: ' + e.message });
    }
    const variants = Array.isArray(parsed.variants) ? parsed.variants.slice(0, 5) : [];
    if (!variants.length) return res.status(502).json({ ok:false, error: 'No variants generated' });
    res.json({ ok:true, segment, tone, brand, variants, generatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// Launch a re-engagement campaign. Records the campaign and (when emails are
// supplied) enrolls them via the existing drip endpoint with a single-touch
// sequence built from the chosen variant. Set dryRun:true to record without
// actually sending.
app.post('/api/reengage/launch', async (req, res) => {
  try {
    const { variant, emails, segment, tone, brand, dryRun } = req.body || {};
    if (!variant || !variant.subject || !variant.body) {
      return res.status(400).json({ ok:false, error: 'variant.subject and variant.body required' });
    }
    const cleanEmails = Array.isArray(emails)
      ? emails.map(e => String(e || '').trim()).filter(e => /\S+@\S+\.\S+/.test(e))
      : [];
    const campaign = {
      id: 'rec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      segment: segment || 'dormant',
      tone:    tone    || 'warm-and-curious',
      brand:   brand   || 'InfoGenie',
      variant: { angle: variant.angle || '', subject: variant.subject, preheader: variant.preheader || '', body: variant.body, cta: variant.cta || '' },
      emailCount: cleanEmails.length,
      dryRun: !!dryRun,
      createdAt: Date.now(),
      enrollment: null,
      enrollmentError: null,
    };
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'reengage:launch' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    let enrollmentOk = true;   // true when no enrollment was attempted, OR
                                // when the in-process enrollment succeeded
    if (cleanEmails.length > 0) {
      enrollmentOk = false;     // assume failure until proven otherwise
      const sequence = [{
        day: 0,
        channel: 'email',
        label: 'Re-engagement: ' + (variant.angle || 'adaptive'),
        subject: variant.subject,
        msg: variant.body,
      }];
      const contacts = cleanEmails.map(e => ({ email: e }));
      try {
        const result = await _enrollDripCore(tid, { contacts, sequence, brand: campaign.brand, dryRun: !!dryRun });
        campaign.enrollment = { ok: true, enrolled: result.created.length, skipped: result.skipped, created: result.created };
        enrollmentOk = true;
      } catch (e) { campaign.enrollmentError = e.message; }
    }
    // Persist the campaign record either way — useful for audit even on failure
    await _reengageLock(async () => {
      const list = await _readReengage(tid);
      list.push(campaign);
      await _writeReengage(tid, list);
    });
    // Top-level ok reflects whether the launch actually succeeded end-to-end.
    // When enrollment was attempted and failed, ok:false so callers (UI + assistant)
    // do not show a misleading success state.
    if (!enrollmentOk) {
      return res.status(502).json({
        ok: false,
        error: 'enrollment-failed',
        details: campaign.enrollmentError || 'unknown',
        campaign,
      });
    }
    res.json({ ok:true, campaign });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.get('/api/reengage/campaigns', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'reengage:campaigns' });
    if (tid == null) return res.json({ ok:true, campaigns: [] });
    const list = await _reengageLock(() => _readReengage(tid));
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ ok:true, campaigns: list });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});
};
