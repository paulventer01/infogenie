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

// ── F07: Statistical A/B Confidence Display ─────────────────────────────
// Given raw control and variant counts, computes statistical confidence,
// p-value (two-proportion z-test), and sample size recommendation.
// Also patches the experiment record with computed confidence if id provided.
router.post('/confidence', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'experiments:confidence' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { experiment_id, control_n, control_conversions, variant_n, variant_conversions } = req.body;
  for (const [k, v] of [['control_n',control_n],['control_conversions',control_conversions],['variant_n',variant_n],['variant_conversions',variant_conversions]]) {
    if (typeof v !== 'number' || v < 0) return res.status(400).json({ ok:false, error:`${k} must be a non-negative number` });
  }
  if (control_n < 1 || variant_n < 1) return res.status(400).json({ ok:false, error:'sample sizes must be >= 1' });

  // Conversion rates
  const p_c = control_conversions / control_n;
  const p_v = variant_conversions / variant_n;
  const lift_pct = p_c > 0 ? parseFloat(((p_v - p_c) / p_c * 100).toFixed(2)) : null;

  // Two-proportion z-test
  const p_pool = (control_conversions + variant_conversions) / (control_n + variant_n);
  const se = Math.sqrt(p_pool * (1 - p_pool) * (1/control_n + 1/variant_n));
  const z = se > 0 ? (p_v - p_c) / se : 0;

  // Two-tailed p-value approximation (Zelen & Severo, Abramowitz & Stegun)
  function _cdf(z) {
    const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
    const sign = z < 0 ? -1 : 1;
    const t = 1 / (1 + p * Math.abs(z) / Math.SQRT2);
    const poly = ((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t;
    return 0.5 * (1 + sign * (1 - poly * Math.exp(-z*z/2)));
  }
  const p_value = parseFloat((2 * Math.min(_cdf(z), 1 - _cdf(z))).toFixed(4));
  const confidence_pct = parseFloat(((1 - p_value) * 100).toFixed(1));
  const is_significant = confidence_pct >= 95 && p_value < 0.05;
  const verdict = is_significant ? 'significant' : confidence_pct >= 80 ? 'trending' : 'not_significant';

  // Minimum detectable effect & recommended sample size (for 80% power, 95% conf)
  // n = 16 * p(1-p) / delta^2 (rule of thumb)
  const mde_pct = 5; // assume 5% MDE as default
  const delta = p_c * mde_pct / 100;
  const recommended_n = delta > 0
    ? Math.ceil(16 * p_c * (1 - p_c) / (delta * delta))
    : null;

  // Interpret
  const interpretation = is_significant
    ? `✅ Statistically significant at ${confidence_pct}% confidence. Variant ${lift_pct >= 0 ? 'outperforms' : 'underperforms'} control by ${Math.abs(lift_pct||0)}%.`
    : confidence_pct >= 80
    ? `⚠️ Trending (${confidence_pct}% confidence) but not yet significant. Collect more data.`
    : `❌ Not significant (${confidence_pct}% confidence, p=${p_value}). No reliable difference detected.`;

  const result = {
    ok: true,
    control_rate: parseFloat((p_c * 100).toFixed(2)),
    variant_rate: parseFloat((p_v * 100).toFixed(2)),
    lift_pct,
    z_score: parseFloat(z.toFixed(4)),
    p_value,
    confidence_pct,
    is_significant,
    verdict,
    interpretation,
    sample_adequacy: {
      control_n, variant_n,
      recommended_n_per_arm: recommended_n,
      is_adequate: recommended_n ? (control_n >= recommended_n && variant_n >= recommended_n) : null
    }
  };

  // Patch the experiment record if id provided
  if (experiment_id) {
    const p = await _db.getPool();
    try {
      await p.query(
        `UPDATE experiments SET confidence_pct=$1, p_value=$2, lift_pct=$3, updated_at=NOW()
         WHERE id=$4 AND tenant_id=$5`,
        [confidence_pct, p_value, lift_pct, experiment_id, tid]
      );
    } catch(e2) {}
  }

  res.json(result);
});

module.exports = router;
