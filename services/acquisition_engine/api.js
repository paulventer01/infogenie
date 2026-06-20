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
  const body = JSON.stringify({ model:'gpt-5', messages, response_format:{ type:'json_object' }, temperature:0.2, max_tokens: opts.max_tokens||2000 });
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
  const body = JSON.stringify({ model:'sonar', messages:[{role:'user',content:prompt}], temperature:0.1, max_tokens:1500 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); resolve(j.choices?.[0]?.message?.content||null); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(45000,()=>req.destroy()); req.write(body); req.end();
  });
}

// GET campaigns
router.get('/campaigns', async (req, res) => {
  const tid = await _tid(req, 'ae:list'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const camps = await p.query(`SELECT * FROM acquisition_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  const ids = camps.rows.map(c=>c.id);
  let prospects = [];
  if (ids.length) {
    const pr = await p.query(`SELECT * FROM acquisition_prospects WHERE campaign_id=ANY($1) ORDER BY score DESC`, [ids]);
    prospects = pr.rows;
  }
  res.json({ ok:true, campaigns: camps.rows, prospects });
});

// POST /launch — find prospects + generate emails + create campaign
router.post('/launch', async (req, res) => {
  const tid = await _tid(req, 'ae:launch'); if (!tid) return _err(res,400,'no_tenant');
  const { name='Acquisition Campaign', target_industry, target_role, target_size, value_prop, count=10 } = req.body || {};
  if (!target_industry) return _err(res,400,'target_industry required');

  const p = await _db.getPool();
  const camp = await p.query(
    `INSERT INTO acquisition_campaigns(tenant_id,name,status,config) VALUES($1,$2,'running',$3) RETURNING id`,
    [tid, name, JSON.stringify({ target_industry, target_role, target_size, value_prop, count })]
  );
  const campId = camp.rows[0].id;

  // Step 1: Find prospects via Perplexity
  const prospectPrompt = `Find ${Math.min(count,20)} real companies in the "${target_industry}" industry${target_size?' with '+target_size+' employees':''} that would benefit from marketing automation software. For each company return JSON array:
[{"name":"Contact Name","company":"Company","email":"work@company.com or null","role":"${target_role||'Marketing Director'}","reason":"Why they need this"}]
Return only the JSON array, no explanation.`;

  const [prospectRaw, emailTemplateRaw] = await Promise.all([
    _perplexity(prospectPrompt),
    _openai([
      { role:'system', content:'You are a B2B cold email expert. Generate a 3-step cold email sequence. Return strict JSON: {"emails":[{"step":1,"subject":"...","body":"..."},{"step":2,"subject":"...","body":"..."},{"step":3,"subject":"...","body":"..."}]}' },
      { role:'user', content:`Product: AI marketing intelligence platform\nValue prop: ${value_prop||'helps companies spy on competitors and automate campaigns'}\nTarget: ${target_role||'Marketing Director'} at ${target_industry} companies\nWrite 3 personalised cold emails. Use [NAME] and [COMPANY] tokens.` }
    ])
  ]);

  let prospects = [];
  if (prospectRaw) {
    const m = prospectRaw.match(/\[[\s\S]*\]/);
    if (m) { try { prospects = JSON.parse(m[0]).slice(0, count); } catch {} }
  }
  if (!prospects.length) {
    prospects = Array.from({length:5},(_,i)=>({ name:`Prospect ${i+1}`, company:`Company ${i+1}`, email:null, role:target_role||'Marketing Director', reason:'Template prospect — connect Perplexity for live discovery.' }));
  }

  let emailSequence = { emails:[] };
  if (emailTemplateRaw) { try { emailSequence = JSON.parse(emailTemplateRaw); } catch {} }

  // Score and insert prospects
  const insertedProspects = [];
  for (const pr of prospects) {
    const score = (pr.email ? 40 : 0) + (pr.company ? 20 : 0) + (pr.role ? 20 : 0) + 20;
    const ins = await p.query(
      `INSERT INTO acquisition_prospects(tenant_id,campaign_id,name,company,email,role,score,status) VALUES($1,$2,$3,$4,$5,$6,$7,'found') RETURNING *`,
      [tid, campId, pr.name||null, pr.company||null, pr.email||null, pr.role||null, score]
    );
    insertedProspects.push(ins.rows[0]);
  }

  await p.query(
    `UPDATE acquisition_campaigns SET status='active', stats=$1, updated_at=NOW() WHERE id=$2`,
    [JSON.stringify({ total_found: insertedProspects.length, emails_sent:0, replies:0, meetings_booked:0 }), campId]
  );

  res.json({ ok:true, campaign_id:campId, prospects:insertedProspects, email_sequence:emailSequence, stats:{ total_found:insertedProspects.length, emails_sent:0, replies:0, meetings_booked:0 } });
});

// POST /prospects/:id/mark-sent
router.post('/prospects/:id/mark-sent', async (req, res) => {
  const tid = await _tid(req, 'ae:mark'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  await p.query(`UPDATE acquisition_prospects SET status='emailed', email_sent_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

// POST /prospects/:id/mark-meeting
router.post('/prospects/:id/mark-meeting', async (req, res) => {
  const tid = await _tid(req, 'ae:meeting'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  await p.query(`UPDATE acquisition_prospects SET meeting_booked=TRUE, status='meeting_booked' WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

module.exports = router;
