const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error:msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _openai(messages, opts={}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model:'gpt-4o', messages, response_format:{ type:'json_object' }, temperature:0.1, max_tokens: opts.max_tokens||2000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if(r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _template(inputs) {
  const { current_monthly_spend=10000, budget_change=5000, current_leads=200, conversion_rate=3, aov=500, cac=250, ltv=1500 } = inputs;
  const newSpend = current_monthly_spend + budget_change;
  const spendRatio = newSpend / current_monthly_spend;
  const baseLeads = current_leads * spendRatio;
  const baseRevenue = baseLeads * (conversion_rate/100) * aov;
  return {
    best_case:     { leads: Math.round(baseLeads * 1.2), customers: Math.round(baseLeads*1.2*(conversion_rate/100)), revenue: Math.round(baseRevenue * 1.3), cac: Math.round(cac * 0.85), roas: parseFloat((baseRevenue*1.3/newSpend).toFixed(2)) },
    expected_case: { leads: Math.round(baseLeads), customers: Math.round(baseLeads*(conversion_rate/100)), revenue: Math.round(baseRevenue), cac: Math.round(cac), roas: parseFloat((baseRevenue/newSpend).toFixed(2)) },
    worst_case:    { leads: Math.round(baseLeads * 0.7), customers: Math.round(baseLeads*0.7*(conversion_rate/100)), revenue: Math.round(baseRevenue * 0.6), cac: Math.round(cac * 1.3), roas: parseFloat((baseRevenue*0.6/newSpend).toFixed(2)) },
    payback_months: Math.round(cac / (ltv/12)),
    recommendation: 'Template estimate — connect AI providers for personalised modelling.',
    key_assumptions: ['Spend scales linearly with leads','Conversion rate held constant','AOV unchanged']
  };
}

router.post('/simulate', async (req, res) => {
  const tid = await _tid(req, 'rf:simulate'); if (!tid) return _err(res,400,'no_tenant');
  const {
    scenario_name = 'Budget Increase Scenario',
    current_monthly_spend = 10000,
    budget_change = 5000,
    current_leads = 200,
    conversion_rate = 3,
    aov = 500,
    cac = 250,
    ltv = 1500,
    currency = 'USD',
    channels = []
  } = req.body || {};

  const inputs = { current_monthly_spend, budget_change, current_leads, conversion_rate, aov, cac, ltv, currency, channels };

  const sys = `You are a marketing finance modeller. Given these business inputs, produce a 90-day revenue forecast with 3 scenarios.
Return strict JSON:
{
  "best_case":     { "leads":0, "customers":0, "revenue":0, "cac":0, "roas":0, "notes":"" },
  "expected_case": { "leads":0, "customers":0, "revenue":0, "cac":0, "roas":0, "notes":"" },
  "worst_case":    { "leads":0, "customers":0, "revenue":0, "cac":0, "roas":0, "notes":"" },
  "payback_months": 0,
  "ltv_cac_ratio": 0,
  "recommendation": "Plain English paragraph on whether to proceed with this budget change",
  "key_assumptions": ["assumption 1","assumption 2","assumption 3"],
  "risk_factors": ["risk 1","risk 2"],
  "monthly_breakdown": [
    { "month":"Month 1", "leads":0, "revenue_best":0, "revenue_expected":0, "revenue_worst":0 },
    { "month":"Month 2", "leads":0, "revenue_best":0, "revenue_expected":0, "revenue_worst":0 },
    { "month":"Month 3", "leads":0, "revenue_best":0, "revenue_expected":0, "revenue_worst":0 }
  ]
}
All monetary values in ${currency}. Be realistic — use industry benchmarks where data is thin.`;

  const userMsg = `Current monthly ad spend: ${currency} ${current_monthly_spend}
Budget change: ${budget_change >= 0 ? '+' : ''}${currency} ${budget_change}
Current monthly leads: ${current_leads}
Conversion rate: ${conversion_rate}%
Average order value: ${currency} ${aov}
Current CAC: ${currency} ${cac}
Customer LTV: ${currency} ${ltv}
Channels: ${channels.length ? channels.join(', ') : 'mixed (Google + Meta)'}`;

  const raw = await _openai([{role:'system',content:sys},{role:'user',content:userMsg}]);
  let results = _template(inputs);
  if (raw) { try { results = JSON.parse(raw); } catch {} }

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO revenue_forecasts(tenant_id,scenario_name,inputs,results) VALUES($1,$2,$3,$4) RETURNING id,created_at`,
    [tid, scenario_name, JSON.stringify(inputs), JSON.stringify(results)]
  );
  res.json({ ok:true, id:ins.rows[0].id, scenario_name, inputs, results, created_at:ins.rows[0].created_at });
});

router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'rf:history'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT id,scenario_name,inputs,results,created_at FROM revenue_forecasts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
  res.json({ ok:true, forecasts: rows.rows });
});

module.exports = router;
