const express = require('express');
const _https  = require('https');
const { normalizeChatParams } = require('../ai_compat');
const router  = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const SOURCES = ['perplexity','apollo','maps'];

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify(normalizeChatParams({ model: opts.model || 'gpt-5-mini', messages, response_format: opts.json ? { type:'json_object' } : undefined, temperature: 0.3, max_tokens: opts.max_tokens || 3000 }));
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(90000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _perplexityLeads(industry, location, role, company_size) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve([]);
  const sys = `You are a B2B lead researcher. Return STRICT JSON only:
{"leads":[{"name":"<full name>","title":"<job title>","company":"<company>","company_domain":"<domain.com>","location":"<city, country>","linkedin_url":"<https://linkedin.com/in/...>","email":"","source":"perplexity","score":75}]}
Only real verified people. Max 10. Never invent emails. Leave email blank.`;
  const user = `Find ${role||'decision-makers'} in the ${industry||'SaaS'} industry, located in ${location||'global'}, at companies with ${company_size||'any'} employees. Return JSON only.`;
  const body = JSON.stringify({ model:'sonar', messages:[{role:'system',content:sys},{role:'user',content:user}], temperature:0.2, max_tokens:2500 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); const txt=j.choices?.[0]?.message?.content||''; const m=txt.match(/\{[\s\S]*\}/); if (!m) return resolve([]); resolve(JSON.parse(m[0]).leads||[]); } catch { resolve([]); } });
    });
    req.on('error',()=>resolve([])); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _apolloLeads(role, industry, location) {
  const key = process.env.APOLLO_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve([]);
  const body = JSON.stringify({ api_key: key, q_person_title: role||'Marketing Manager', person_locations:[location||'United States'], organization_industry_tag_ids:[], page:1, per_page:10 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.apollo.io', path:'/v1/mixed_people/search', method:'POST', headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); resolve((j.people||[]).slice(0,10).map(p=>({ name:(p.first_name||'')+' '+(p.last_name||''), title:p.title||'', company:p.organization?.name||'', company_domain:p.organization?.website_url?.replace(/^https?:\/\//,'').split('/')[0]||'', location:p.city||'', linkedin_url:p.linkedin_url||'', email:p.email||'', source:'apollo', score:80 }))); } catch { resolve([]); } });
    });
    req.on('error',()=>resolve([])); req.setTimeout(30000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _dedup(leads) {
  const seen = new Set();
  return leads.filter(l => {
    const key = (l.email||'') || (l.linkedin_url||'') || ((l.name||'')+'@'+(l.company||''));
    if (!key || seen.has(key.toLowerCase())) return false;
    seen.add(key.toLowerCase()); return true;
  });
}

async function _scoreLead(lead, industry, role) {
  let score = lead.score || 60;
  if (lead.email && lead.email.includes('@')) score += 15;
  if (lead.linkedin_url) score += 10;
  if (lead.company_domain) score += 5;
  const titleMatch = role && lead.title && lead.title.toLowerCase().includes(role.toLowerCase().split(' ')[0]);
  if (titleMatch) score += 10;
  return { ...lead, score: Math.min(100, score) };
}

router.get('/sources', (req, res) => {
  res.json({ ok:true, sources: SOURCES.map(s=>({ id:s, label:{ perplexity:'AI Web Research', apollo:'Apollo.io Database', maps:'Local Business Maps' }[s], available: { perplexity: !!(process.env.PERPLEXITY_API_KEY && !/^_DUMMY/i.test(process.env.PERPLEXITY_API_KEY)), apollo: !!(process.env.APOLLO_API_KEY && !/^_DUMMY/i.test(process.env.APOLLO_API_KEY)), maps: true }[s] })) });
});

router.post('/sweep', async (req, res) => {
  const { industry, location, role, company_size, sources=SOURCES } = req.body || {};
  const activeSourcesSet = new Set(Array.isArray(sources) ? sources : SOURCES);
  const tasks = [];
  if (activeSourcesSet.has('perplexity')) tasks.push(_perplexityLeads(industry, location, role, company_size).then(ls=>ls.map(l=>({...l,source:'perplexity'}))));
  if (activeSourcesSet.has('apollo')) tasks.push(_apolloLeads(role, industry, location).then(ls=>ls.map(l=>({...l,source:'apollo'}))));
  const results = await Promise.allSettled(tasks);
  let allLeads = results.flatMap(r=>r.status==='fulfilled' ? r.value : []);
  allLeads = _dedup(allLeads);
  allLeads = await Promise.all(allLeads.map(l=>_scoreLead(l, industry, role)));
  allLeads.sort((a,b)=>b.score-a.score);
  const sourceCounts = {};
  allLeads.forEach(l=>{ sourceCounts[l.source]=(sourceCounts[l.source]||0)+1; });

  // Fire-and-forget: record lead scoring results in Marketing Memory
  if (allLeads.length > 0) {
    try {
      const _tenantCtx = require('../tenants/context');
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'lead_aggregator:sweep' }).catch(() => null);
      if (tid) {
        const hotLeads = allLeads.filter(l => l.score >= 80);
        const { ingestMemoryNode } = require('../knowledge_graph/api');
        ingestMemoryNode({
          tenant_id: tid,
          node_type: 'lead_scoring',
          summary: `Lead sweep found ${allLeads.length} prospects (${hotLeads.length} high-score ≥80) for "${industry || 'unknown'}" industry in "${location || 'any'}" location.`,
          detail: { total: allLeads.length, hot: hotLeads.length, industry, location, role, source_counts: sourceCounts },
          source_ref: `lead_sweep:${new Date().toISOString().slice(0, 10)}`,
          importance: hotLeads.length > 0 ? 0.7 : 0.45,
        }).catch(() => {});
      }
    } catch (_) {}
  }

  res.json({ ok:true, leads: allLeads, total: allLeads.length, with_email: allLeads.filter(l=>l.email).length, with_linkedin: allLeads.filter(l=>l.linkedin_url).length, source_counts: sourceCounts });
});

module.exports = router;
