const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

function _oa() { return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY }); }

function _calcIroas(test) {
  const { test_reach, control_reach, test_conversions, control_conversions, test_spend, reported_revenue, avg_order_value } = test;
  if (!test_reach || !control_reach || !test_spend) return null;
  const testCvr = test_conversions / test_reach;
  const ctrlCvr = control_conversions / control_reach;
  const liftPct = ctrlCvr > 0 ? ((testCvr - ctrlCvr) / ctrlCvr) * 100 : null;
  const incrementalConversions = (testCvr - ctrlCvr) * test_reach;
  const aov = avg_order_value || (reported_revenue / Math.max(test_conversions, 1));
  const incrementalRevenue = Math.max(0, incrementalConversions * aov);
  const iroas = test_spend > 0 ? incrementalRevenue / test_spend : null;
  const reportedRoas = test_spend > 0 && reported_revenue > 0 ? reported_revenue / test_spend : null;
  return {
    test_cvr: +testCvr.toFixed(4),
    control_cvr: +ctrlCvr.toFixed(4),
    lift_pct: liftPct !== null ? +liftPct.toFixed(1) : null,
    incremental_conversions: +incrementalConversions.toFixed(1),
    incremental_revenue: +incrementalRevenue.toFixed(2),
    iroas: iroas !== null ? +iroas.toFixed(2) : null,
    reported_roas: reportedRoas !== null ? +reportedRoas.toFixed(2) : null,
    iroas_vs_reported: (iroas !== null && reportedRoas !== null) ? +(((iroas - reportedRoas) / reportedRoas) * 100).toFixed(1) : null
  };
}

/* ── list tests ── */
router.get('/tests', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'iroas:list' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT * FROM iroas_tests WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
    const enriched = rows.map(r => ({ ...r, computed: _calcIroas(r) }));
    res.json({ tests: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── create test ── */
router.post('/tests', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'iroas:create' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { name, campaign_name, channel, holdout_pct, start_date, end_date, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await _db.getPool().query(
      `INSERT INTO iroas_tests (tenant_id,name,campaign_name,channel,holdout_pct,start_date,end_date,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid, name, campaign_name||'', channel||'meta', holdout_pct||10, start_date||null, end_date||null, notes||'']
    );
    res.json({ test: { ...rows[0], computed: _calcIroas(rows[0]) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── update test results ── */
router.put('/tests/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'iroas:update' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { test_reach, control_reach, test_conversions, control_conversions, test_spend, reported_revenue, avg_order_value, status, notes, name, campaign_name, channel, holdout_pct, start_date, end_date } = req.body;
    const { rows } = await _db.getPool().query(
      `UPDATE iroas_tests SET
        name=COALESCE($3,name), campaign_name=COALESCE($4,campaign_name), channel=COALESCE($5,channel),
        holdout_pct=COALESCE($6,holdout_pct), start_date=COALESCE($7,start_date), end_date=COALESCE($8,end_date),
        test_reach=COALESCE($9,test_reach), control_reach=COALESCE($10,control_reach),
        test_conversions=COALESCE($11,test_conversions), control_conversions=COALESCE($12,control_conversions),
        test_spend=COALESCE($13,test_spend), reported_revenue=COALESCE($14,reported_revenue),
        avg_order_value=COALESCE($15,avg_order_value), status=COALESCE($16,status), notes=COALESCE($17,notes),
        updated_at=now()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, tid, name, campaign_name, channel, holdout_pct, start_date, end_date,
       test_reach, control_reach, test_conversions, control_conversions, test_spend, reported_revenue, avg_order_value, status, notes]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ test: { ...rows[0], computed: _calcIroas(rows[0]) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── delete test ── */
router.delete('/tests/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'iroas:delete' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    await _db.getPool().query(`DELETE FROM iroas_tests WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── AI budget saturation analysis ── */
router.post('/saturation', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'iroas:saturation' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { channels, monthly_budget, industry } = req.body;

    const completion = await _oa().chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `You are a media mix modeling expert. Analyze budget saturation curves for these ad channels: ${(channels||['meta','google','tiktok']).join(', ')}.
Total monthly budget: $${monthly_budget || 10000}. Industry: ${industry || 'e-commerce'}.
For each channel, generate 8 realistic spend/iROAS data points showing diminishing returns (typical S-curve pattern).
Return JSON: {"curves":[{"channel":"meta","saturation_point":5000,"data":[{"spend":500,"iroas":4.2},...],"insight":"..."},...], "recommendation":"..."}
Use realistic numbers for the industry. iROAS typically starts high and tapers after the saturation point.`
      }],
      response_format: { type: 'json_object' }, max_tokens: 1500
    });

    let result = {};
    try { result = JSON.parse(completion.choices[0].message.content); } catch (_) {}
    if (result._DUMMY || !result.curves) {
      result = {
        curves: [
          { channel: 'meta', saturation_point: 5000, data: [500,1000,2000,3500,5000,7000,9000,12000].map((s,i) => ({ spend: s, iroas: [5.2,4.8,4.1,3.3,2.8,2.1,1.6,1.1][i] })), insight: 'Meta saturates around $5K/mo for most e-commerce brands.' },
          { channel: 'google', saturation_point: 8000, data: [500,1500,3000,5000,8000,11000,14000,18000].map((s,i) => ({ spend: s, iroas: [6.1,5.7,5.2,4.5,3.9,3.0,2.2,1.5][i] })), insight: 'Google Search has deeper pockets — saturation is higher.' },
          { channel: 'tiktok', saturation_point: 3000, data: [200,500,1000,2000,3000,5000,7000,10000].map((s,i) => ({ spend: s, iroas: [4.0,3.5,3.0,2.3,1.8,1.2,0.9,0.6][i] })), insight: 'TikTok saturates quickly — best kept under $3K/mo unless creative is refreshed weekly.' }
        ],
        recommendation: 'Allocate the bulk of budget to Google Search up to $8K, then Meta up to $5K, before increasing TikTok spend.',
        source: 'template'
      };
    }
    res.json({ ...result, source: result.source || 'gpt-4o' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── AI interpretation of a test ── */
router.post('/tests/:id/interpret', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'iroas:interpret' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT * FROM iroas_tests WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const t = rows[0];
    const c = _calcIroas(t);
    if (!c) return res.status(400).json({ error: 'insufficient_data' });

    const completion = await _oa().chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `Interpret this iROAS holdout test result for a marketer:
Campaign: ${t.campaign_name || t.name} | Channel: ${t.channel} | Holdout: ${t.holdout_pct}%
Test group CVR: ${(c.test_cvr*100).toFixed(2)}% | Control CVR: ${(c.control_cvr*100).toFixed(2)}%
Lift: ${c.lift_pct}% | Incremental conversions: ${c.incremental_conversions}
Ad spend: $${t.test_spend} | Reported ROAS: ${c.reported_roas}x | True iROAS: ${c.iroas}x
Incremental revenue: $${c.incremental_revenue}
Give a plain-English interpretation: is this campaign truly profitable? What should they do next?
Return JSON: {"verdict":"positive|neutral|negative","headline":"...","analysis":"...","actions":["...","...","..."]}`
      }],
      response_format: { type: 'json_object' }, max_tokens: 600
    });

    let result = {};
    try { result = JSON.parse(completion.choices[0].message.content); } catch (_) {}
    if (result._DUMMY || !result.headline) {
      result = { verdict: c.iroas >= 1 ? 'positive' : 'negative', headline: c.iroas >= 1 ? 'Campaign is generating true incremental lift' : 'Campaign is not driving incremental revenue', analysis: `Your reported ROAS of ${c.reported_roas}x overstates true performance. Actual incremental ROAS is ${c.iroas}x.`, actions: ['Review creative quality', 'Narrow audience targeting', 'Run a follow-on test with fresh creative'] };
    }
    res.json({ interpretation: result, computed: c, source: 'gpt-4o' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
