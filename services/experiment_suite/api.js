const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const EXP_TYPES = ['a_b','geo_lift','holdout','creative_incrementality','audience_saturation'];

router.get('/list', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'experiments:list' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT * FROM experiments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [tid]
  );
  res.json({ ok:true, experiments: rows.rows, types: EXP_TYPES });
});

router.post('/create', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'experiments:create' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { name, type, hypothesis, control_group, variant_group, channels, budget_split, start_date, end_date } = req.body;
  if (!name || !type) return res.status(400).json({ ok:false, error:'name and type required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO experiments(tenant_id,name,type,hypothesis,control_group,variant_group,channels,budget_split,start_date,end_date,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING *`,
    [tid, name, type, hypothesis||null, control_group||null, variant_group||null, channels||null, budget_split||null, start_date||null, end_date||null]
  );
  res.json({ ok:true, experiment: r.rows[0] });
});

router.put('/:id/update', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'experiments:update' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { status, outcome, lift_pct, confidence_pct, p_value, institutional_learning } = req.body;
  const p = await _db.getPool();
  const r = await p.query(
    `UPDATE experiments SET status=COALESCE($1,status), outcome=COALESCE($2,outcome), lift_pct=COALESCE($3,lift_pct),
     confidence_pct=COALESCE($4,confidence_pct), p_value=COALESCE($5,p_value),
     institutional_learning=COALESCE($6,institutional_learning), updated_at=NOW()
     WHERE id=$7 AND tenant_id=$8 RETURNING *`,
    [status||null, outcome||null, lift_pct!=null?+lift_pct:null, confidence_pct!=null?+confidence_pct:null,
     p_value!=null?+p_value:null, institutional_learning||null, req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok:false, error:'not found' });
  res.json({ ok:true, experiment: r.rows[0] });
});

router.post('/:id/analyse', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'experiments:analyse' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const exp = await p.query(`SELECT * FROM experiments WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!exp.rows.length) return res.status(404).json({ ok:false, error:'not found' });
  const e = exp.rows[0];

  let analysis = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are an expert marketing scientist analysing an experiment.
Experiment: ${JSON.stringify({ name:e.name, type:e.type, hypothesis:e.hypothesis, control:e.control_group, variant:e.variant_group, channels:e.channels, lift_pct:e.lift_pct, confidence_pct:e.confidence_pct, p_value:e.p_value, outcome:e.outcome })}
Provide: statistical interpretation, whether result is significant (p<0.05), practical significance vs statistical significance, recommended next action, and institutional learning to carry forward.
Return strict JSON: {"verdict":"significant|not_significant|inconclusive","interpretation":"...","practical_significance":"...","next_action":"...","institutional_learning":"...","confidence_level":"high|medium|low","repeat_recommended":true}`;
    const r = await openai.chat.completions.create({ model:'gpt-5-mini', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) analysis = parsed;
  } catch(e2) {}

  if (!analysis) {
    const sig = e.confidence_pct >= 95 && e.p_value && e.p_value < 0.05;
    analysis = {
      verdict: sig ? 'significant' : (e.confidence_pct >= 80 ? 'inconclusive' : 'not_significant'),
      interpretation: `Experiment "${e.name}" shows ${e.lift_pct||0}% lift with ${e.confidence_pct||0}% confidence.`,
      practical_significance: 'Evaluate whether the lift justifies rollout cost.',
      next_action: sig ? 'Roll out the winning variant to 100% of traffic.' : 'Extend the experiment to gather more data.',
      institutional_learning: e.institutional_learning || 'Log outcome in experiment registry for future reference.',
      confidence_level: (e.confidence_pct||0) >= 90 ? 'high' : 'medium',
      repeat_recommended: !sig
    };
  }

  await p.query(`UPDATE experiments SET ai_analysis=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
    [JSON.stringify(analysis), req.params.id, tid]);
  res.json({ ok:true, analysis });
});

module.exports = router;
