const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');
const { createRateLimiter } = require('../security/rate_limit');
const { approvalText } = require('./approval_text');
const { generationText } = require('./generation_text');
const approveLimiter = createRateLimiter({
  name: 'safe-agent-approve', windowMs: 60_000, max: 20, failClosed: true,
  keyFn: req => req.tenant?.id != null && req.user?.id != null
    ? `safe-agent-approve|${req.tenant.id}|${req.user.id}` : null,
});


// Propose a new action (phase 1: AI drafts + simulates)
router.post('/propose', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'safe-agent:propose' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { objective, context = {}, budget_guardrail } = req.body;
  if (typeof objective !== 'string' || !objective.trim()) return res.status(400).json({ ok:false, error:'objective required', userMessage:'Enter a text objective.' });

  let proposal = {}, simulation = {};
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are an autonomous marketing agent with a safety-first mandate.
Objective: "${objective}"
Business context: ${JSON.stringify(context)}
Budget guardrail: ${budget_guardrail ? '$'+budget_guardrail : 'not set'}

Phase 1 — PROPOSE: Draft a precise action plan.
Phase 2 — SIMULATE: Model the expected outcome before execution.

Return strict JSON:
{
  "title": "...",
  "proposal": {
    "actions": [
      {"step":1,"action":"...","channel":"...","detail":"...","estimated_cost":0,"reversible":true}
    ],
    "total_estimated_cost": 0,
    "timeline": "...",
    "success_metrics": ["..."],
    "rollback_plan": "..."
  },
  "simulation": {
    "expected_outcome": "...",
    "confidence": 0,
    "best_case": "...",
    "worst_case": "...",
    "risk_factors": ["..."],
    "estimated_revenue_impact": 0,
    "estimated_roas_change": 0
  },
  "safety_checks": [
    {"check":"...","status":"pass|warn|fail","note":"..."}
  ],
  "recommendation": "approve|review|reject",
  "recommendation_reason": "..."
}`;
    const r = await openai.chat.completions.create({ model:'gpt-5', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}], max_tokens:2000 });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (parsed.proposal?.actions?.[0]?._DUMMY) throw new Error('dummy');
    proposal = parsed.proposal || {};
    simulation = parsed.simulation || {};
    proposal._title = parsed.title;
    proposal._safety_checks = parsed.safety_checks || [];
    proposal._recommendation = parsed.recommendation;
    proposal._recommendation_reason = parsed.recommendation_reason;
  } catch(e) {
    proposal = {
      _title: objective.slice(0,100),
      actions: [{ step:1, action:'Analyse current performance', channel:'all', detail:'Pull last 30 days of campaign data to identify top performers and underperformers.', estimated_cost:0, reversible:true },
                { step:2, action:'Draft optimisation changes', channel:'paid', detail:'Prepare bid/budget adjustments for approval.', estimated_cost:0, reversible:true }],
      total_estimated_cost: 0,
      timeline:'3-5 business days',
      success_metrics:['Improved ROAS','Lower CAC','Higher conversion rate'],
      rollback_plan:'Revert all bid changes to previous values within 1 click.',
      _safety_checks:[{ check:'Budget within guardrail', status:'pass', note:'No spend proposed yet.' }],
      _recommendation:'review',
      _recommendation_reason:'AI analysis unavailable — human review recommended before execution.'
    };
    simulation = { expected_outcome:'Incremental improvement in campaign efficiency', confidence:55, best_case:'15% ROAS lift', worst_case:'No significant change', risk_factors:['Market conditions may vary'], estimated_revenue_impact:0, estimated_roas_change:0 };
  }

  const title = proposal._title || objective.slice(0,100);
  let proposalText;
  try { proposalText = generationText({title,proposal,simulation}); } catch (_) {
    return res.status(403).json({ok:false,error:'content_safety_blocked',userMessage:'This proposal is too large or complex to check safely. Shorten the objective or context and try again.'});
  }
  let contentSafetyWarnings = [];
  try {
    const { gateRouteText } = require('../ai_governance/route_gate');
    const gated = await gateRouteText({
      tenantId: tid,
      userId: req.user?.id || null,
      surface: 'safe_agent',
      action: 'generate_content',
      text: proposalText,
    });
    if (!gated.ok) {
      const status = gated.error === 'content_safety_unavailable' ? 503 : 403;
      return res.status(status).json({
        ok: false,
        error: gated.error || 'content_safety_blocked',
        userMessage: gated.userMessage,
      });
    }
    contentSafetyWarnings = gated.content_safety_warnings || gated.warnings || [];
  } catch (_) {
    return res.status(503).json({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable. Generation was stopped to protect your brand.',
    });
  }

  const p = await _db.getPool();
  const row = await p.query(
    `INSERT INTO safe_agent_proposals(tenant_id,title,proposal,simulation,budget_guardrail,content_safety_warnings,status)
     VALUES($1,$2,$3,$4,$5,$6,'pending_approval') RETURNING id`,
    [tid, title, JSON.stringify(proposal), JSON.stringify(simulation), budget_guardrail||null, JSON.stringify(contentSafetyWarnings)]
  );
  const id = row.rows[0].id;
  await p.query(
    `INSERT INTO safe_agent_audit_log(tenant_id,proposal_id,event,actor_id,detail) VALUES($1,$2,'proposed',$3,$4)`,
    [tid, id, req.user?.id||null, JSON.stringify({ objective, budget_guardrail })]
  );
  res.json({ ok:true, id, title, proposal, simulation, content_safety_warnings: contentSafetyWarnings });
});

// Approve and execute
router.post('/approve/:id', approveLimiter, async (req, res) => {
  let client;
  try {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'safe-agent:approve' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const row = await p.query(`SELECT * FROM safe_agent_proposals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!row.rows.length) return res.status(404).json({ ok:false, error:'not found' });
  const prop = row.rows[0];
  if (prop.status !== 'pending_approval') return res.status(409).json({ ok:false, error:'not_pending_approval' });
  let text;
  try { text = approvalText(prop); } catch (_) {
    return res.status(400).json({ ok:false, error:'invalid_proposal_content', userMessage:'This proposal is too large or invalid for safety review. Create a new proposal.' });
  }
  const { gateRouteText, contentSafetyHttpBody, contentSafetyUnavailableBody } = require('../ai_governance/route_gate');
  let gated;
  try {
    gated = await gateRouteText({ tenantId:tid, userId:req.user.id, surface:'safe_agent', action:'generate_content', text });
  } catch (_) { return res.status(503).json(contentSafetyUnavailableBody()); }
  if (!gated.ok) return res.status(gated.error === 'content_safety_unavailable' ? 503 : 403).json(contentSafetyHttpBody(gated));
  const warnings = gated.content_safety_warnings || gated.warnings || [];
  client = await p.connect();
  await client.query('BEGIN');
  // Bind approval to the exact stored values scanned above. PostgreSQL rechecks
  // this predicate after waiting for a concurrent writer's row lock.
  const claimed = await client.query(
    `UPDATE safe_agent_proposals SET status='executing', approved_by=$1, approved_at=NOW(), content_safety_warnings=$4
     WHERE id=$2 AND tenant_id=$3 AND status='pending_approval'
       AND title=$5 AND proposal=$6::jsonb AND simulation=$7::jsonb
       AND budget_guardrail IS NOT DISTINCT FROM $8::numeric RETURNING id`,
    [req.user.id, prop.id, tid, JSON.stringify(warnings), prop.title, JSON.stringify(prop.proposal), JSON.stringify(prop.simulation), prop.budget_guardrail]
  );
  if (!claimed.rows.length) {
    await client.query('ROLLBACK');
    return res.status(409).json({ ok:false, error:'proposal_changed', userMessage:'This proposal changed or was already handled. Reload and review it again.' });
  }
  await client.query(
    `INSERT INTO safe_agent_audit_log(tenant_id,proposal_id,event,actor_id,detail) VALUES($1,$2,'approved',$3,$4)`,
    [tid, prop.id, req.user?.id||null, JSON.stringify({ approved_at: new Date().toISOString() })]
  );
  // Simulate execution (in production this would call real ad platform APIs)
  const outcome = { executed_actions: prop.proposal?.actions?.length||0, note:'Execution logged. Connect ad platform credentials to enable live execution.', executed_at: new Date().toISOString() };
  await client.query(
    `UPDATE safe_agent_proposals SET status='executed', executed_at=NOW(), outcome=$1 WHERE id=$2 AND tenant_id=$3`,
    [JSON.stringify(outcome), prop.id, tid]
  );
  await client.query(
    `INSERT INTO safe_agent_audit_log(tenant_id,proposal_id,event,actor_id,detail) VALUES($1,$2,'executed',$3,$4)`,
    [tid, prop.id, req.user?.id||null, JSON.stringify(outcome)]
  );
  await client.query('COMMIT');
  client.release();
  client = null;
  // Merge into AI Governance audit stream (no new approval step — already human-approved).
  try {
    const { governSafe } = require('../ai_governance/hooks');
    await governSafe({
      tenantId: tid,
      userId: req.user?.id || null,
      surface: 'safe_agent',
      action: 'launch_campaign',
      payload: {
        title: prop.title,
        preview: `Safe Agent executed proposal ${prop.id}`,
        proposalId: prop.id,
        hasContext: true,
      },
    });
  } catch (e) {
    console.warn('[safe-agent] governance audit merge failed open:', e.message);
  }
  res.json({ ok:true, status:'executed', outcome, content_safety_warnings:warnings });
  } catch (_) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(503).json({ ok:false, error:'approval_unavailable', userMessage:'Approval is temporarily unavailable. Reload the proposal before retrying.' });
  } finally { if (client) client.release(); }
});

// Rollback
router.post('/rollback/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'safe-agent:rollback' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { reason } = req.body;
  const p = await _db.getPool();
  const row = await p.query(`SELECT * FROM safe_agent_proposals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!row.rows.length) return res.status(404).json({ ok:false, error:'not found' });
  await p.query(
    `UPDATE safe_agent_proposals SET status='rolled_back', rolled_back_at=NOW(), rollback_reason=$1 WHERE id=$2`,
    [reason||'Manual rollback', req.params.id]
  );
  await p.query(
    `INSERT INTO safe_agent_audit_log(tenant_id,proposal_id,event,actor_id,detail) VALUES($1,$2,'rolled_back',$3,$4)`,
    [tid, req.params.id, req.user?.id||null, JSON.stringify({ reason: reason||'Manual rollback' })]
  );
  res.json({ ok:true, status:'rolled_back' });
});

// Reject a proposal
router.post('/reject/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'safe-agent:reject' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { reason } = req.body;
  const p = await _db.getPool();
  await p.query(`UPDATE safe_agent_proposals SET status='rejected', rollback_reason=$1 WHERE id=$2 AND tenant_id=$3`, [reason||'Rejected', req.params.id, tid]);
  await p.query(`INSERT INTO safe_agent_audit_log(tenant_id,proposal_id,event,actor_id,detail) VALUES($1,$2,'rejected',$3,$4)`, [tid, req.params.id, req.user?.id||null, JSON.stringify({ reason })]);
  res.json({ ok:true, status:'rejected' });
});

router.get('/proposals', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'safe-agent:proposals' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id,title,status,budget_guardrail,proposal,simulation,content_safety_warnings,approved_at,executed_at,rolled_back_at,created_at
     FROM safe_agent_proposals WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok:true, proposals: rows.rows });
});

router.get('/audit-log/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'safe-agent:audit-log' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT event, actor_id, detail, created_at FROM safe_agent_audit_log
     WHERE tenant_id=$1 AND proposal_id=$2 ORDER BY created_at ASC`,
    [tid, req.params.id]
  );
  res.json({ ok:true, log: rows.rows });
});

module.exports = router;
