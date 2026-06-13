const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const TRIGGER_EVENTS = ['competitor_change','ad_rejected','roas_drop','budget_pacing','keyword_spike','content_published','lead_scored','manual'];
const AGENT_TYPES = ['competitor_spy','media_buyer','copywriter','seo_analyst','email_composer','audience_builder','approval_gate','slack_notify','webhook'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, trigger_events: TRIGGER_EVENTS, agent_types: AGENT_TYPES });
});

router.get('/configs', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'swarm:configs' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM swarm_configs WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, configs: rows.rows });
});

router.post('/configs', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'swarm:create-config' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, description, trigger_event, trigger_conditions, agent_chain, notification_email } = req.body;
  if (!name || !trigger_event || !agent_chain) return res.status(400).json({ ok: false, error: 'name, trigger_event, agent_chain required' });
  const p = await _db.getPool();
  const chain = Array.isArray(agent_chain) ? JSON.stringify(agent_chain) : agent_chain;
  const r = await p.query(
    `INSERT INTO swarm_configs(tenant_id,name,description,trigger_event,trigger_conditions,agent_chain,notification_email)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tid, name, description || null, trigger_event, trigger_conditions || null, chain, notification_email || null]
  );
  res.json({ ok: true, config: r.rows[0] });
});

router.put('/configs/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'swarm:update-config' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, description, trigger_conditions, agent_chain, notification_email, is_active } = req.body;
  const p = await _db.getPool();
  const chain = agent_chain ? (Array.isArray(agent_chain) ? JSON.stringify(agent_chain) : agent_chain) : null;
  const r = await p.query(
    `UPDATE swarm_configs SET
       name=COALESCE($1,name), description=COALESCE($2,description),
       trigger_conditions=COALESCE($3,trigger_conditions),
       agent_chain=COALESCE($4,agent_chain),
       notification_email=COALESCE($5,notification_email),
       is_active=COALESCE($6,is_active), updated_at=NOW()
     WHERE id=$7 AND tenant_id=$8 RETURNING *`,
    [name || null, description || null, trigger_conditions || null, chain, notification_email || null,
     is_active != null ? is_active : null, req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, config: r.rows[0] });
});

router.delete('/configs/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'swarm:delete-config' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM swarm_configs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/trigger', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'swarm:trigger' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { event_type, event_data, config_id } = req.body;
  if (!event_type) return res.status(400).json({ ok: false, error: 'event_type required' });
  const p = await _db.getPool();

  let config = null;
  if (config_id) {
    const cr = await p.query(`SELECT * FROM swarm_configs WHERE id=$1 AND tenant_id=$2 AND is_active=TRUE`, [config_id, tid]);
    config = cr.rows[0] || null;
  } else {
    const cr = await p.query(`SELECT * FROM swarm_configs WHERE tenant_id=$1 AND trigger_event=$2 AND is_active=TRUE LIMIT 1`, [tid, event_type]);
    config = cr.rows[0] || null;
  }

  let chain = [];
  if (config) {
    try { chain = JSON.parse(config.agent_chain || '[]'); } catch (e) { chain = []; }
  } else {
    chain = [
      { agent_type: 'competitor_spy', step_name: 'Gather competitive intelligence' },
      { agent_type: 'copywriter', step_name: 'Draft counter-messaging' },
      { agent_type: 'approval_gate', step_name: 'Push to approval queue' }
    ];
  }

  const run = await p.query(
    `INSERT INTO swarm_runs(tenant_id,config_id,config_name,trigger_event,trigger_data,status,steps_total)
     VALUES($1,$2,$3,$4,$5,'running',$6) RETURNING *`,
    [tid, config?.id || null, config?.name || 'Ad-hoc run', event_type, JSON.stringify(event_data || {}), chain.length]
  );
  const runId = run.rows[0].id;

  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
  const stepResults = [];

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    let output = '';
    try {
      const prompt = `You are the ${step.agent_type} agent in a multi-agent marketing swarm.
Trigger event: ${event_type}
Event data: ${JSON.stringify(event_data || {})}
Previous steps: ${JSON.stringify(stepResults)}
Your task: ${step.step_name}
Execute your role and return a concrete output. Be specific and actionable.
Return strict JSON: {"output":"...","action_taken":"...","next_recommendation":"...","confidence_pct":80}`;
      const r = await openai.chat.completions.create({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
      const parsed = JSON.parse(r.choices[0].message.content);
      output = parsed.output || '';
      stepResults.push({ step: step.step_name, agent: step.agent_type, result: parsed });
    } catch (e) {
      output = `${step.agent_type} executed: ${step.step_name}`;
      stepResults.push({ step: step.step_name, agent: step.agent_type, result: { output, action_taken: 'completed' } });
    }
    await p.query(
      `INSERT INTO swarm_steps(run_id,tenant_id,step_order,step_name,agent_type,input_summary,output_summary,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'completed')`,
      [runId, tid, i + 1, step.step_name, step.agent_type, JSON.stringify(event_data || {}).slice(0, 300), output.slice(0, 500)]
    );
  }

  let summary = `Swarm completed ${chain.length} agent steps for ${event_type} event.`;
  try {
    const sr = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: `Summarise in 1 sentence what this agent swarm accomplished: ${JSON.stringify(stepResults)}` }] });
    summary = sr.choices[0].message.content || summary;
  } catch (e) {}

  await p.query(
    `UPDATE swarm_runs SET status='completed', steps_completed=$1, summary=$2, completed_at=NOW() WHERE id=$3`,
    [chain.length, summary, runId]
  );
  if (config) await p.query(`UPDATE swarm_configs SET run_count=run_count+1, last_run_at=NOW() WHERE id=$1`, [config.id]);

  res.json({ ok: true, run_id: runId, steps: stepResults, summary });
});

router.get('/runs', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'swarm:runs' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM swarm_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 50`, [tid]);
  res.json({ ok: true, runs: rows.rows });
});

router.get('/runs/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'swarm:run-detail' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const [run, steps] = await Promise.all([
    p.query(`SELECT * FROM swarm_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]),
    p.query(`SELECT * FROM swarm_steps WHERE run_id=$1 ORDER BY step_order`, [req.params.id])
  ]);
  if (!run.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, run: run.rows[0], steps: steps.rows });
});

module.exports = router;
