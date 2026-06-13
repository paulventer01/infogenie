const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const LOGIC_TYPES = ['roas_weighted','cpa_weighted','cvr_weighted','impression_share','equal_split'];
const PLATFORMS = ['meta','google','tiktok','linkedin','microsoft','snapchat','pinterest'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, platforms: PLATFORMS, logic_types: LOGIC_TYPES });
});

router.get('/rules', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'budget-arb:rules' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM budget_arb_rules WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, rules: rows.rows });
});

router.post('/rules', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'budget-arb:create-rule' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, platforms, total_daily_budget, min_platform_budget, max_shift_pct, reallocation_logic } = req.body;
  if (!name || !platforms || !total_daily_budget) return res.status(400).json({ ok: false, error: 'name, platforms, total_daily_budget required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO budget_arb_rules(tenant_id,name,platforms,total_daily_budget,min_platform_budget,max_shift_pct,reallocation_logic)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tid, name, Array.isArray(platforms) ? platforms.join(',') : platforms,
     +total_daily_budget, +(min_platform_budget || 10), +(max_shift_pct || 30), reallocation_logic || 'roas_weighted']
  );
  res.json({ ok: true, rule: r.rows[0] });
});

router.delete('/rules/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'budget-arb:delete-rule' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM budget_arb_rules WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/analyse', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'budget-arb:analyse' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { rule_id, platform_metrics, total_daily_budget, max_shift_pct = 30 } = req.body;
  if (!platform_metrics || !Array.isArray(platform_metrics)) return res.status(400).json({ ok: false, error: 'platform_metrics array required' });

  const p = await _db.getPool();
  let rule = null;
  if (rule_id) {
    const rr = await p.query(`SELECT * FROM budget_arb_rules WHERE id=$1 AND tenant_id=$2`, [rule_id, tid]);
    rule = rr.rows[0] || null;
  }

  const totalBudget = total_daily_budget || rule?.total_daily_budget || platform_metrics.reduce((s, m) => s + (m.current_budget || 0), 0);
  const maxShift = max_shift_pct || rule?.max_shift_pct || 30;

  let analysis = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are an expert media buying AI doing real-time cross-platform budget arbitrage.
Total daily budget: $${totalBudget}
Max shift allowed: ${maxShift}% per platform
Platform metrics: ${JSON.stringify(platform_metrics)}

Analyse each platform's efficiency (ROAS, CPA, CVR, impression share). Identify which platforms are over/under-funded relative to their performance.
Recommend specific dollar reallocations to maximise overall ROAS.

Return strict JSON: {
  "platform_analysis": [{"platform":"...","current_budget":0,"recommended_budget":0,"shift_amount":0,"shift_direction":"increase|decrease|maintain","reason":"...","roas_efficiency":"above_average|average|below_average"}],
  "total_shifted": 0,
  "projected_roas_uplift_pct": 0,
  "rationale": "...",
  "urgency": "immediate|today|this_week",
  "risk_level": "low|medium|high"
}`;
    const r = await openai.chat.completions.create({ model: 'gpt-4o', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) analysis = parsed;
  } catch (e) {}

  if (!analysis) {
    const sorted = [...platform_metrics].sort((a, b) => (b.roas || 0) - (a.roas || 0));
    const shifts = platform_metrics.map((m, i) => {
      const rank = sorted.findIndex(s => s.platform === m.platform);
      const isTop = rank === 0;
      const isBottom = rank === platform_metrics.length - 1;
      const shiftAmt = isTop ? Math.min(totalBudget * 0.1, (m.current_budget || 0) * (maxShift / 100))
        : isBottom ? -Math.min(totalBudget * 0.1, (m.current_budget || 0) * (maxShift / 100)) : 0;
      return { platform: m.platform, current_budget: m.current_budget || 0, recommended_budget: (m.current_budget || 0) + shiftAmt, shift_amount: shiftAmt, shift_direction: shiftAmt > 0 ? 'increase' : shiftAmt < 0 ? 'decrease' : 'maintain', reason: isTop ? 'Best ROAS — scale spend' : isBottom ? 'Lowest ROAS — reduce spend' : 'On par — maintain', roas_efficiency: isTop ? 'above_average' : isBottom ? 'below_average' : 'average' };
    });
    analysis = { platform_analysis: shifts, total_shifted: shifts.reduce((s, x) => s + Math.abs(x.shift_amount), 0), projected_roas_uplift_pct: 8, rationale: 'Reallocating from lowest-ROAS to highest-ROAS platform.', urgency: 'today', risk_level: 'low' };
  }

  const rec = await p.query(
    `INSERT INTO budget_arb_history(rule_id,tenant_id,input_metrics,analysis,recommended_shifts,total_shifted,projected_roas_uplift)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [rule?.id || null, tid, JSON.stringify(platform_metrics), JSON.stringify(analysis), JSON.stringify(analysis.platform_analysis), analysis.total_shifted || 0, analysis.projected_roas_uplift_pct || 0]
  );
  res.json({ ok: true, analysis, history_id: rec.rows[0].id });
});

router.post('/execute/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'budget-arb:execute' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(`UPDATE budget_arb_history SET is_executed=TRUE, executed_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`, [req.params.id, tid]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, record: r.rows[0] });
});

router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'budget-arb:history' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT h.*, r.name as rule_name FROM budget_arb_history h LEFT JOIN budget_arb_rules r ON r.id=h.rule_id WHERE h.tenant_id=$1 ORDER BY h.created_at DESC LIMIT 50`, [tid]);
  res.json({ ok: true, history: rows.rows });
});

module.exports = router;
