const express = require('express');
const _https  = require('https');
const router  = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const PACKS = [
  { id:'pricing-intel',    icon:'💰', label:'Competitor Pricing Intel',      description:'Structured comparison of pricing tiers, feature gates, billing models, and hidden fees across competitors.',        fields:['competitor','tier','price_monthly','price_annual','seats','storage','key_features','free_trial','notable_limits'] },
  { id:'job-market',       icon:'📋', label:'Job Market Signals',            description:'Hiring velocity, open roles by department, emerging skill requirements, and team expansion signals.',               fields:['company','role','department','location','type','signals','growth_indicator'] },
  { id:'social-proof',     icon:'⭐', label:'Social Proof Aggregator',       description:'Review scores, sentiment breakdown, top praise themes, and common complaints across review platforms.',            fields:['competitor','platform','score','reviews','top_praise','common_complaints','sentiment'] },
  { id:'benchmark-report', icon:'📊', label:'Industry Benchmark Report',     description:'KPI benchmarks, average conversion rates, CAC, LTV, NPS, and growth rates for your industry.',                   fields:['metric','industry_avg','top_quartile','bottom_quartile','your_target','source'] },
  { id:'tech-stack',       icon:'🧱', label:'Competitor Tech Stack Map',     description:'Marketing stack, analytics tools, CRM, ad platforms, and third-party integrations competitors use.',              fields:['competitor','category','tool','detected_via','maturity','cost_tier'] },
  { id:'content-gaps',     icon:'🧩', label:'Content Gap Analysis',          description:'Topics your competitors rank for that you don\'t, with search volume, difficulty, and content angle.',            fields:['keyword','competitor_ranking','your_ranking','monthly_searches','difficulty','content_angle','priority'] },
  { id:'ad-intelligence',  icon:'🎯', label:'Ad Creative Intelligence',      description:'Messaging themes, offers, hooks, and creative patterns from competitor ad campaigns.',                             fields:['competitor','platform','message_theme','offer_type','hook','cta','estimated_spend_tier'] },
  { id:'market-sizing',    icon:'🌍', label:'Market Sizing & TAM',           description:'Total Addressable Market, growth rate, segments, and regional breakdown for your industry.',                      fields:['segment','tam_usd','growth_rate_pct','key_driver','region','data_year'] },
];

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model: opts.model || 'gpt-5', messages, response_format: opts.json ? { type:'json_object' } : undefined, temperature: 0.4, max_tokens: opts.max_tokens || 3000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(90000,()=>req.destroy()); req.write(body); req.end();
  });
}

router.get('/packs', (req, res) => {
  res.json({ ok:true, packs: PACKS.map(p=>({ id:p.id, icon:p.icon, label:p.label, description:p.description, fields:p.fields })) });
});

router.post('/generate', async (req, res) => {
  const { pack_id, industry='SaaS', region='Global', competitors=[] } = req.body || {};
  const pack = PACKS.find(p=>p.id===pack_id);
  if (!pack) return _err(res,400,'unknown_pack');
  const compStr = competitors.length ? `Key competitors: ${competitors.slice(0,5).join(', ')}` : 'Use well-known competitors in this industry.';
  const sys = `You are a market research analyst generating a structured competitive intelligence dataset. Return strict JSON:
{"title":"<dataset title>","subtitle":"<1-line description>","generated_at":"${new Date().toISOString()}","industry":"${industry}","region":"${region}","columns":${JSON.stringify(pack.fields)},"rows":[<objects with keys matching columns — at least 8 rows>],"key_takeaways":["<insight 1>","<insight 2>","<insight 3>"],"disclaimer":"This data is AI-generated for research purposes. Verify key figures before business decisions."}
Be specific with real company names, real numbers, and accurate market data. Use current knowledge.`;
  const user = `Generate a "${pack.label}" dataset for the ${industry} industry in ${region}. ${compStr}\n\nColumns needed: ${pack.fields.join(', ')}\n\nReturn at least 8 data rows, 3 key takeaways.`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, model:'gpt-5', max_tokens:3000 });
  if (!raw) {
    return res.json({ ok:true, source:'template', title:`${pack.label} — ${industry}`, subtitle:pack.description, columns:pack.fields, rows:[{ [pack.fields[0]]:'Sample data — AI unavailable. Configure OpenAI API key to generate real datasets.' }], key_takeaways:['AI provider unavailable','Configure OPENAI_API_KEY to generate datasets'], disclaimer:'Sample placeholder data.' });
  }
  try {
    const data = JSON.parse(raw);
    res.json({ ok:true, source:'openai', pack_id, ...data });
  } catch { res.json({ ok:false, error:'Could not parse dataset' }); }
});

module.exports = router;
