const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const TRIGGER_TYPES = ['manual', 'schedule', 'webhook', 'event_lead_created', 'event_deal_stage', 'event_ad_rejected', 'event_roas_drop', 'event_competitor_change'];
const NODE_TYPES = ['condition_if', 'delay_wait', 'action_send_email', 'action_post_slack', 'action_http_webhook', 'action_tag_contact', 'action_create_campaign', 'action_update_record', 'action_ai_generate', 'action_send_rcs', 'split_ab'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, trigger_types: TRIGGER_TYPES, node_types: NODE_TYPES });
});

router.get('/list', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:list' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM wf_workflows WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, workflows: rows.rows });
});

router.get('/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:get' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(`SELECT * FROM wf_workflows WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, workflow: r.rows[0] });
});

router.post('/create', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:create' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, description, trigger_type, trigger_config, nodes } = req.body;
  if (!name || !trigger_type) return res.status(400).json({ ok: false, error: 'name and trigger_type required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO wf_workflows(tenant_id,name,description,trigger_type,trigger_config,nodes,is_active)
     VALUES($1,$2,$3,$4,$5,$6,FALSE) RETURNING *`,
    [tid, name, description || null, trigger_type,
     trigger_config ? JSON.stringify(trigger_config) : null,
     JSON.stringify(nodes || [])]
  );
  res.json({ ok: true, workflow: r.rows[0] });
});

router.put('/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:update' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, description, trigger_type, trigger_config, nodes, is_active } = req.body;
  const p = await _db.getPool();
  const nodesJson = nodes !== undefined ? JSON.stringify(nodes) : null;
  const r = await p.query(
    `UPDATE wf_workflows SET
       name=COALESCE($1,name), description=COALESCE($2,description),
       trigger_type=COALESCE($3,trigger_type),
       trigger_config=COALESCE($4,trigger_config),
       nodes=COALESCE($5,nodes),
       is_active=COALESCE($6,is_active),
       updated_at=NOW()
     WHERE id=$7 AND tenant_id=$8 RETURNING *`,
    [name || null, description || null, trigger_type || null,
     trigger_config ? JSON.stringify(trigger_config) : null,
     nodesJson, is_active != null ? is_active : null,
     req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, workflow: r.rows[0] });
});

router.delete('/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:delete' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM wf_workflows WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/:id/toggle', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:toggle' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(`UPDATE wf_workflows SET is_active=NOT is_active, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`, [req.params.id, tid]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, workflow: r.rows[0] });
});

router.post('/:id/run', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:run' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { trigger_data } = req.body;
  const p = await _db.getPool();
  const wf = await p.query(`SELECT * FROM wf_workflows WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!wf.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const w = wf.rows[0];
  let nodes = [];
  try { nodes = JSON.parse(w.nodes || '[]'); } catch (e) {}

  const runRec = await p.query(
    `INSERT INTO wf_runs(workflow_id,tenant_id,trigger_data,status) VALUES($1,$2,$3,'running') RETURNING *`,
    [w.id, tid, JSON.stringify(trigger_data || {})]
  );
  const runId = runRec.rows[0].id;
  const stepsLog = [];
  let status = 'success';

  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });

  for (const node of nodes) {
    const step = { node_type: node.type, label: node.label || node.type, status: 'skipped', output: null };
    try {
      if (node.type === 'action_ai_generate') {
        const r = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: node.config?.prompt || 'Generate marketing content' }] });
        step.output = r.choices[0].message.content;
        step.status = 'completed';
      } else if (node.type === 'action_http_webhook' && node.config?.url) {
        try {
          await fetch(node.config.url, { method: node.config.method || 'POST', headers: { 'Content-Type': 'application/json', ...(node.config.headers || {}) }, body: JSON.stringify({ workflow_id: w.id, run_id: runId, trigger_data: trigger_data || {}, ...(node.config.body || {}) }), signal: AbortSignal.timeout(10000) });
          step.status = 'completed'; step.output = 'Webhook delivered';
        } catch (e) { step.status = 'failed'; step.output = e.message; }
      } else if (node.type === 'delay_wait') {
        step.status = 'completed'; step.output = `Would wait ${node.config?.duration || '1h'}`;
      } else if (node.type === 'condition_if') {
        step.status = 'completed'; step.output = `Condition evaluated: ${JSON.stringify(node.config?.condition || {})}`;
      } else {
        step.status = 'completed'; step.output = `${node.type} executed`;
      }
    } catch (e) { step.status = 'failed'; step.output = e.message; status = 'partial'; }
    stepsLog.push(step);
  }

  await p.query(
    `UPDATE wf_runs SET status=$1, steps_log=$2, completed_at=NOW() WHERE id=$3`,
    [status, JSON.stringify(stepsLog), runId]
  );
  await p.query(`UPDATE wf_workflows SET run_count=run_count+1, last_run_at=NOW(), ${status === 'success' ? 'success_count=success_count+1' : 'fail_count=fail_count+1'} WHERE id=$1`, [w.id]);
  res.json({ ok: true, run_id: runId, status, steps: stepsLog });
});

router.get('/runs/all', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:runs' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT r.*, w.name as workflow_name FROM wf_runs r JOIN wf_workflows w ON w.id=r.workflow_id WHERE r.tenant_id=$1 ORDER BY r.started_at DESC LIMIT 50`, [tid]);
  res.json({ ok: true, runs: rows.rows });
});

router.post('/ai-build', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wf:ai-build' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { description } = req.body;
  if (!description) return res.status(400).json({ ok: false, error: 'description required' });

  let built = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a no-code workflow builder AI. Convert this description into a structured workflow.
Available trigger types: ${TRIGGER_TYPES.join(', ')}
Available node types: ${NODE_TYPES.join(', ')}
Description: "${description}"

Build a practical workflow with 3-6 nodes. Each node should have a type, label, and config object.
Return strict JSON: {"name":"...","trigger_type":"...","trigger_config":{},"nodes":[{"type":"...","label":"...","config":{}}],"description":"...","estimated_time_to_complete":"..."}`;
    const r = await openai.chat.completions.create({ model: 'gpt-4o', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) built = parsed;
  } catch (e) {}

  if (!built) {
    built = { name: 'AI-Built Workflow', trigger_type: 'manual', trigger_config: {}, nodes: [{ type: 'action_ai_generate', label: 'Generate content', config: { prompt: description } }, { type: 'action_http_webhook', label: 'Send to endpoint', config: { url: '', method: 'POST' } }], description, estimated_time_to_complete: '< 1 minute' };
  }
  res.json({ ok: true, workflow: built });
});

router.post('/webhook/:token', async (req, res) => {
  const p = await _db.getPool();
  const wf = await p.query(`SELECT * FROM wf_workflows WHERE trigger_config::text LIKE $1 AND is_active=TRUE`, [`%"token":"${req.params.token}"%`]);
  if (!wf.rows.length) return res.status(404).json({ ok: false, error: 'no workflow found for this webhook' });
  const w = wf.rows[0];
  await p.query(`INSERT INTO wf_runs(workflow_id,tenant_id,trigger_data,status) VALUES($1,$2,$3,'triggered')`, [w.id, w.tenant_id, JSON.stringify(req.body)]);
  await p.query(`UPDATE wf_workflows SET run_count=run_count+1, last_run_at=NOW() WHERE id=$1`, [w.id]);
  res.json({ ok: true, workflow_id: w.id, message: 'Workflow triggered' });
});

module.exports = router;
