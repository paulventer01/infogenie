const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const _crypto = require('crypto');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error:msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _openai(messages, opts={}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model:'gpt-4o', messages, response_format:{ type:'json_object' }, temperature:0.2, max_tokens: opts.max_tokens||3000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if(r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

router.post('/generate', async (req, res) => {
  const tid = await _tid(req, 'im:generate'); if (!tid) return _err(res,400,'no_tenant');
  const {
    company_name, stage='seed', mrr=0, arr=0, growth_rate=0, cac=0, ltv=0,
    burn_rate=0, runway_months=12, total_users=0, paying_customers=0,
    currency='USD', report_type='monthly', highlights=[], challenges=[]
  } = req.body || {};
  if (!company_name) return _err(res,400,'company_name required');

  const sys = `You are an experienced CFO preparing an investor report for a startup. Generate a comprehensive investor update.
Return strict JSON:
{
  "executive_summary": "3-4 sentence overview of the business state",
  "headline_metrics": [
    { "label":"MRR", "value":"", "change":"", "trend":"up|down|flat" },
    { "label":"ARR", "value":"", "change":"", "trend":"up|down|flat" },
    { "label":"Growth Rate", "value":"", "change":"", "trend":"up|down|flat" },
    { "label":"CAC", "value":"", "change":"", "trend":"up|down|flat" },
    { "label":"LTV", "value":"", "change":"", "trend":"up|down|flat" },
    { "label":"LTV/CAC", "value":"", "change":"", "trend":"up|down|flat" },
    { "label":"Runway", "value":"", "change":"", "trend":"up|down|flat" },
    { "label":"Paying Customers", "value":"", "change":"", "trend":"up|down|flat" }
  ],
  "revenue_forecast": {
    "month_1": 0, "month_2": 0, "month_3": 0, "month_6": 0, "month_12": 0,
    "methodology": "How this was calculated"
  },
  "highlights": ["highlight 1","highlight 2","highlight 3"],
  "challenges": ["challenge 1","challenge 2"],
  "ask": "What the company needs from investors right now (if any)",
  "investor_narrative": "A 2-paragraph story about where the company is going",
  "next_milestones": [
    { "milestone":"...", "target_date":"...", "status":"on_track|at_risk|completed" }
  ]
}`;

  const userMsg = `Company: ${company_name} | Stage: ${stage} | Currency: ${currency}
MRR: ${currency} ${mrr} | ARR: ${currency} ${arr} | Growth rate: ${growth_rate}% MoM
CAC: ${currency} ${cac} | LTV: ${currency} ${ltv}
Burn rate: ${currency} ${burn_rate}/month | Runway: ${runway_months} months
Total users: ${total_users} | Paying customers: ${paying_customers}
Highlights: ${highlights.join('; ') || 'None provided'}
Challenges: ${challenges.join('; ') || 'None provided'}`;

  const raw = await _openai([{role:'system',content:sys},{role:'user',content:userMsg}]);

  const TEMPLATE = {
    executive_summary: `${company_name} is a ${stage}-stage company generating ${currency} ${mrr} MRR with ${paying_customers} paying customers. Template report — connect AI providers for a personalised investor narrative.`,
    headline_metrics: [
      { label:'MRR', value:`${currency} ${mrr.toLocaleString()}`, change:'', trend:'flat' },
      { label:'ARR', value:`${currency} ${arr.toLocaleString()}`, change:'', trend:'flat' },
      { label:'Growth Rate', value:`${growth_rate}% MoM`, change:'', trend:'flat' },
      { label:'CAC', value:`${currency} ${cac}`, change:'', trend:'flat' },
      { label:'LTV', value:`${currency} ${ltv}`, change:'', trend:'flat' },
      { label:'LTV/CAC', value: cac>0 ? (ltv/cac).toFixed(1)+'x':'N/A', change:'', trend:'flat' },
      { label:'Runway', value:`${runway_months} months`, change:'', trend:'flat' },
      { label:'Paying Customers', value:`${paying_customers}`, change:'', trend:'flat' }
    ],
    revenue_forecast: { month_1: mrr, month_2: Math.round(mrr*(1+growth_rate/100)), month_3: Math.round(mrr*Math.pow(1+growth_rate/100,2)), month_6: Math.round(mrr*Math.pow(1+growth_rate/100,5)), month_12: Math.round(mrr*Math.pow(1+growth_rate/100,11)), methodology:'Linear extrapolation at current growth rate' },
    highlights: highlights.length ? highlights : ['Metrics entered — add highlights for full report'],
    challenges: challenges.length ? challenges : ['Add challenges to complete the report'],
    ask: '',
    investor_narrative: `${company_name} is building in the ${stage} stage. Add more context to generate a compelling investor narrative.`,
    next_milestones: [{ milestone:'Reach next MRR milestone', target_date:'90 days', status:'on_track' }]
  };

  let content = TEMPLATE;
  if (raw) { try { content = JSON.parse(raw); } catch {} }

  const token = _crypto.randomBytes(16).toString('hex');
  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO investor_reports(tenant_id,report_type,content,portal_token) VALUES($1,$2,$3,$4) RETURNING id,created_at`,
    [tid, report_type, JSON.stringify({ company_name, stage, currency, inputs: req.body, ...content }), token]
  );
  res.json({ ok:true, id:ins.rows[0].id, portal_token:token, company_name, report: content, created_at:ins.rows[0].created_at });
});

router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'im:history'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT id,report_type,content,portal_token,created_at FROM investor_reports WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
  res.json({ ok:true, reports: rows.rows });
});

// Public read-only investor portal
router.get('/portal/:token', async (req, res) => {
  const p = await _db.getPool();
  const row = await p.query(`SELECT content,created_at FROM investor_reports WHERE portal_token=$1`, [req.params.token]);
  if (!row.rows.length) return _err(res,404,'not found');
  res.json({ ok:true, report: row.rows[0].content, created_at: row.rows[0].created_at });
});

module.exports = router;
