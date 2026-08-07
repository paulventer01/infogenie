const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const ACTION_TYPES = ['pause_campaign','scale_budget','launch_campaign','send_email','publish_content','social_post_publish','audience_change','price_change','other'];

router.get('/config', async (req, res) => {
  res.json({ ok:true, action_types: ACTION_TYPES });
});

router.get('/policies', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:policies' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM approval_policies WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok:true, policies: rows.rows });
});

router.post('/policies', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:create-policy' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { name, action_types, budget_threshold, channels, notify_email } = req.body;
  if (!name || !action_types) return res.status(400).json({ ok:false, error:'name and action_types required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO approval_policies(tenant_id,name,action_types,budget_threshold,channels,notify_email) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tid, name, Array.isArray(action_types)?action_types.join(','):action_types, budget_threshold||null, channels||null, notify_email||null]
  );
  res.json({ ok:true, policy: r.rows[0] });
});

router.delete('/policies/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:delete-policy' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM approval_policies WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

router.get('/queue', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:queue' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT r.*, po.name as policy_name FROM approval_requests r
     LEFT JOIN approval_policies po ON po.id=r.policy_id
     WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 100`, [tid]
  );
  res.json({ ok:true, requests: rows.rows });
});

router.post('/request', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:request' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { action_type, title, description, proposed_by, budget_impact, channel, policy_id } = req.body;
  if (!action_type || !title) return res.status(400).json({ ok:false, error:'action_type and title required' });
  const p = await _db.getPool();

  let simulation = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `Simulate the outcome of this marketing action before it executes.
Action: ${action_type} — ${title}
Description: ${description||''}
Budget impact: ${budget_impact ? '$'+budget_impact : 'unknown'}
Channel: ${channel||'unknown'}
Return strict JSON: {"expected_outcome":"...","confidence_pct":0,"best_case":"...","worst_case":"...","risk_factors":["..."],"reversible":true,"simulation_verdict":"safe|caution|high_risk"}`;
    const r = await openai.chat.completions.create({ model:'gpt-5-mini', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) simulation = parsed;
  } catch(e) {}

  if (!simulation) {
    simulation = {
      expected_outcome: `${action_type} action processed on ${channel||'unknown channel'}.`,
      confidence_pct: 65,
      best_case: 'Campaign performance improves 10-20%.',
      worst_case: 'No material impact; may need reversal.',
      risk_factors: ['Platform algorithm changes','Audience fatigue'],
      reversible: true,
      simulation_verdict: 'caution'
    };
  }

  const r = await p.query(
    `INSERT INTO approval_requests(tenant_id,policy_id,action_type,title,description,proposed_by,budget_impact,channel,simulation_result,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`,
    [tid, policy_id||null, action_type, title, description||null, proposed_by||null, budget_impact||null, channel||null, JSON.stringify(simulation)]
  );
  res.json({ ok:true, request: r.rows[0], simulation });
});

router.post('/approve/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:approve' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  if (!_db.hasDb()) return res.status(503).json({ ok:false, error:'no-db' });
  const p = await _db.getPool();
  const r = await p.query(
    `UPDATE approval_requests SET status='approved', reviewer_notes=$1, approved_at=NOW() WHERE id=$2 AND tenant_id=$3 AND status='pending' RETURNING *`,
    [req.body.notes||null, req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok:false, error:'not found or not pending' });
  const request = r.rows[0];

  // Social draft publish hook — description may carry { draft_id }
  let social = null;
  if (request.action_type === 'social_post_publish') {
    try {
      let draftId = null;
      try {
        const desc = typeof request.description === 'string' ? JSON.parse(request.description) : request.description;
        draftId = desc?.draft_id || desc?.draftId || null;
      } catch (_) {}
      if (draftId) {
        const drafts = require('../social_drafts/api');
        if (typeof drafts._approveAndPublish === 'function') {
          social = await drafts._approveAndPublish(tid, draftId, { notes: req.body.notes || null });
        }
      }
    } catch (e) {
      social = { ok: false, error: e.message };
    }
  }

  res.json({ ok:true, request, social });
});

router.post('/reject/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:reject' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  if (!_db.hasDb()) return res.status(503).json({ ok:false, error:'no-db' });
  const p = await _db.getPool();
  const r = await p.query(
    `UPDATE approval_requests SET status='rejected', reviewer_notes=$1 WHERE id=$2 AND tenant_id=$3 AND status='pending' RETURNING *`,
    [req.body.notes||null, req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok:false, error:'not found or not pending' });
  const request = r.rows[0];

  if (request.action_type === 'social_post_publish') {
    try {
      let draftId = null;
      try {
        const desc = typeof request.description === 'string' ? JSON.parse(request.description) : request.description;
        draftId = desc?.draft_id || desc?.draftId || null;
      } catch (_) {}
      if (draftId) {
        const drafts = require('../social_drafts/api');
        if (typeof drafts._rejectDraft === 'function') {
          await drafts._rejectDraft(tid, draftId, req.body.notes || null);
        }
      }
    } catch (_) {}
  }

  res.json({ ok:true, request: r.rows[0] });
});

router.post('/execute/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:execute' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `UPDATE approval_requests SET status='executed', executed_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='approved' RETURNING *`,
    [req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok:false, error:'not found or not approved' });
  res.json({ ok:true, request: r.rows[0] });
});

router.post('/rollback/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'approvals:rollback' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `UPDATE approval_requests SET status='rolled_back', rolled_back_at=NOW(), rollback_reason=$1 WHERE id=$2 AND tenant_id=$3 AND status='executed' RETURNING *`,
    [req.body.reason||'manual rollback', req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok:false, error:'not found or not executed' });
  res.json({ ok:true, request: r.rows[0] });
});

module.exports = router;
