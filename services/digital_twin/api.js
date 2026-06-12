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
  const body = JSON.stringify({ model:'gpt-4o', messages, response_format:{ type:'json_object' }, temperature:0.3, max_tokens: opts.max_tokens||2500 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if(r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

const SCENARIOS = [
  { id:'increase_spend',   label:'Increase ad spend by 50%', icon:'📈' },
  { id:'launch_uk',        label:'Launch in the UK market',  icon:'🇬🇧' },
  { id:'cut_meta',         label:'Cut Meta spend to zero',   icon:'✂️'  },
  { id:'add_seo',          label:'Double down on SEO instead of paid', icon:'🔍' },
  { id:'raise_prices',     label:'Raise prices by 20%',      icon:'💰' },
  { id:'launch_product',   label:'Launch a new product line', icon:'🚀' },
  { id:'custom',           label:'Custom scenario',           icon:'✏️'  },
];

router.get('/scenarios', (req, res) => res.json({ ok:true, scenarios: SCENARIOS }));

router.post('/simulate', async (req, res) => {
  const tid = await _tid(req, 'dt:simulate'); if (!tid) return _err(res,400,'no_tenant');
  const { scenario, question, business_context={} } = req.body || {};
  if (!scenario && !question) return _err(res,400,'scenario or question required');

  const q = question || SCENARIOS.find(s=>s.id===scenario)?.label || scenario;
  const ctx = Object.entries(business_context).map(([k,v])=>`${k}: ${v}`).join('\n') || 'No business context provided.';

  const sys = `You are a business simulation engine for a digital marketing company. The user has described their business and is asking a "what if" scenario question. Simulate the most likely outcome using marketing and business fundamentals.

Return strict JSON:
{
  "scenario_title": "Brief title",
  "verdict": "positive|neutral|negative|mixed",
  "confidence": <integer 0-100>,
  "executive_summary": "2-3 sentence plain English summary of what would happen",
  "timeline": [
    { "period":"Days 1-30",  "what_happens":"...", "metric_impact":"..." },
    { "period":"Days 31-60", "what_happens":"...", "metric_impact":"..." },
    { "period":"Days 61-90", "what_happens":"...", "metric_impact":"..." }
  ],
  "upsides": ["upside 1","upside 2","upside 3"],
  "risks": ["risk 1","risk 2","risk 3"],
  "key_metrics_affected": [
    { "metric":"CAC", "direction":"up|down|neutral", "estimated_change":"e.g. +15%" },
    { "metric":"Revenue", "direction":"up|down|neutral", "estimated_change":"e.g. +8%" }
  ],
  "recommended_action": "The one thing the user should do right now to prepare for or exploit this scenario",
  "alternative_scenarios": ["What if X instead","What if Y also"]
}
Be specific and grounded in real marketing outcomes. Clearly flag uncertainty where data is thin.`;

  const raw = await _openai([{role:'system',content:sys},{role:'user',content:`Business context:\n${ctx}\n\nScenario question: ${q}`}]);

  const TEMPLATE_RESULT = {
    scenario_title: q,
    verdict: 'mixed',
    confidence: 65,
    executive_summary: 'Template simulation — connect AI providers for a personalised business simulation. Based on typical patterns, this scenario would have mixed results depending on execution speed and market conditions.',
    timeline: [
      { period:'Days 1-30',  what_happens:'Initial setup and transition period.', metric_impact:'Costs increase temporarily.' },
      { period:'Days 31-60', what_happens:'First results begin to show.', metric_impact:'Performance stabilises.' },
      { period:'Days 61-90', what_happens:'Full impact becomes measurable.', metric_impact:'ROI becomes clearer.' }
    ],
    upsides: ['Potential efficiency gain','New audience reach','Competitive differentiation'],
    risks: ['Execution risk','Market timing','Resource constraints'],
    key_metrics_affected: [
      { metric:'CAC', direction:'up', estimated_change:'+10-20%' },
      { metric:'Revenue', direction:'up', estimated_change:'+5-15% over 90 days' }
    ],
    recommended_action: 'Run a small pilot before committing full resources.',
    alternative_scenarios: ['What if you combined this with SEO?','What if you phased the change over 6 months?']
  };

  let results = TEMPLATE_RESULT;
  if (raw) { try { results = JSON.parse(raw); } catch {} }

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO digital_twin_scenarios(tenant_id,scenario,question,results) VALUES($1,$2,$3,$4) RETURNING id,created_at`,
    [tid, scenario||'custom', q, JSON.stringify(results)]
  );
  res.json({ ok:true, id:ins.rows[0].id, scenario:scenario||'custom', question:q, results, created_at:ins.rows[0].created_at });
});

router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'dt:history'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT id,scenario,question,results,created_at FROM digital_twin_scenarios WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
  res.json({ ok:true, simulations: rows.rows });
});

module.exports = router;
