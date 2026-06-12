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
  const body = JSON.stringify({ model:'gpt-4o', messages, response_format:{ type:'json_object' }, temperature:0.2, max_tokens: opts.max_tokens||2500 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if(r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _perplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model:'sonar', messages:[{role:'user',content:prompt}], temperature:0.1, max_tokens:2000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); resolve(j.choices?.[0]?.message?.content||null); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(45000,()=>req.destroy()); req.write(body); req.end();
  });
}

const SCAN_TYPES = [
  { id:'struggling',    label:'Struggling competitors',    icon:'📉', description:'Companies with declining traffic, layoffs, or negative press' },
  { id:'for_sale',      label:'Businesses for sale',       icon:'🏷️', description:'Acquisition targets on marketplaces like Acquire.com or Empire Flippers' },
  { id:'growing',       label:'Fast-growing industries',   icon:'🚀', description:'Sectors with >20% YoY growth that represent expansion opportunities' },
  { id:'franchise',     label:'Franchise opportunities',   icon:'🤝', description:'Franchise systems seeking investors or operators' },
  { id:'all',           label:'Full scan (all types)',     icon:'🔍', description:'Comprehensive acquisition intelligence across all categories' },
];

router.get('/types', (req, res) => res.json({ ok:true, types: SCAN_TYPES }));

router.post('/scan', async (req, res) => {
  const tid = await _tid(req, 'bs:scan'); if (!tid) return _err(res,400,'no_tenant');
  const { industry='SaaS', region='United States', scan_type='all', budget_range='', strategic_fit='' } = req.body || {};

  const types = scan_type === 'all' ? SCAN_TYPES.slice(0,4).map(t=>t.id) : [scan_type];

  // Use Perplexity to find live opportunities
  const pxPrompt = `Research business acquisition opportunities in the "${industry}" industry in "${region}". Find:
1. Companies showing signs of distress (layoffs, traffic drop, negative news)
2. Any recent M&A activity or companies known to be for sale
3. The fastest-growing sub-sectors right now
4. Any notable franchise or licensing opportunities
Return a JSON object with keys: "struggling_companies", "for_sale", "growing_sectors", "franchises". Each should be an array of objects with "name", "reason", "estimated_value_or_growth", "source".`;

  const [pxRaw] = await Promise.all([_perplexity(pxPrompt)]);
  let liveData = {};
  if (pxRaw) {
    const m = pxRaw.match(/\{[\s\S]*\}/);
    if (m) { try { liveData = JSON.parse(m[0]); } catch {} }
  }

  const sys = `You are an M&A intelligence analyst for a private equity and agency audience. Given market research data, score and rank acquisition opportunities.
Return strict JSON:
{
  "market_summary": "2-3 sentence overview of the acquisition landscape in this industry/region",
  "opportunities": [
    {
      "name": "Company or opportunity name",
      "category": "struggling|for_sale|growing|franchise",
      "opportunity_score": <integer 1-100>,
      "estimated_value": "e.g. $500K-$2M or unknown",
      "why_interesting": "2-3 sentences on strategic fit and upside",
      "risk_level": "low|medium|high",
      "action": "Specific next step to explore this opportunity",
      "signals": ["signal 1","signal 2"]
    }
  ],
  "top_pick": "Name of the single highest-conviction opportunity and why",
  "sector_trends": ["trend 1","trend 2","trend 3"],
  "methodology_note": "Brief note on data sources and confidence level"
}
Score opportunities on: strategic value, price attractiveness, distress signals, growth trajectory. Include 5-10 opportunities.`;

  const userMsg = `Industry: ${industry} | Region: ${region} | Budget: ${budget_range||'flexible'} | Strategic fit focus: ${strategic_fit||'marketing technology'}
Scan types: ${types.join(', ')}
Live research data:\n${JSON.stringify(liveData, null, 2)}`;

  const raw = await _openai([{role:'system',content:sys},{role:'user',content:userMsg}]);

  const TEMPLATE = {
    market_summary: `Template scan of the ${industry} market in ${region}. Connect AI providers for live acquisition intelligence.`,
    opportunities: [
      { name:'Example SaaS Business', category:'for_sale', opportunity_score:72, estimated_value:'$500K–$2M', why_interesting:'Growing ARR, founder looking to exit after 5 years. Strong customer base with low churn.', risk_level:'medium', action:'Search Acquire.com and Flippa for current listings.', signals:['Founder posted on Twitter about burnout','Traffic holding steady'] },
      { name:'Struggling Competitor', category:'struggling', opportunity_score:68, estimated_value:'Unknown', why_interesting:'Reducing headcount and ad spend — potentially open to acquisition or partnership.', risk_level:'high', action:'Monitor their job board and Glassdoor for signals.', signals:['Laid off 20% of team','Ad spend down 40%'] },
    ],
    top_pick: 'Example SaaS Business',
    sector_trends: [`${industry} consolidation accelerating`, 'Buyers prefer revenue-generating businesses', 'AI-native competitors attracting premium valuations'],
    methodology_note: 'Template data. Enable Perplexity and OpenAI for live scanning.'
  };

  let results = TEMPLATE;
  if (raw) { try { results = JSON.parse(raw); } catch {} }

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO biz_scan_runs(tenant_id,industry,region,scan_type,results) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`,
    [tid, industry, region, scan_type, JSON.stringify(results)]
  );
  res.json({ ok:true, id:ins.rows[0].id, industry, region, scan_type, results, created_at:ins.rows[0].created_at });
});

router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'bs:history'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT id,industry,region,scan_type,results,created_at FROM biz_scan_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
  res.json({ ok:true, runs: rows.rows });
});

module.exports = router;
