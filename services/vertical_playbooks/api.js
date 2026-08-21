const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');


const SYSTEM_PLAYBOOKS = [
  {
    vertical:'e-commerce', title:'E-Commerce Growth Playbook',
    description:'Proven 90-day framework for online stores: product feed optimisation, cart recovery, seasonal campaigns, and LTV maximisation.',
    icon:'🛒', tags:['google-shopping','meta-dpa','email','sms','retargeting'],
    channels:['Google Shopping','Meta DPA','Email Flows','SMS Retargeting'],
    compliance:['FTC disclosures','Price comparison guidelines'],
    benchmarks:{ roas_target:3.5, cac_target:45, email_open_rate:22, cvr:2.8 },
    phases:[
      { week:'1-2', title:'Audit & Fix', tasks:['Audit product feed quality','Fix top 10 landing page issues','Set up cart abandonment flow','Install conversion tracking'] },
      { week:'3-6', title:'Launch & Test', tasks:['Launch Google Shopping campaigns','A/B test 3 ad angles on Meta','Send 3-email welcome sequence','Test SMS for cart recovery'] },
      { week:'7-12', title:'Scale & Optimise', tasks:['Scale winning ad sets by 20%/week','Launch seasonal promotion calendar','Build post-purchase LTV sequence','Launch loyalty/referral program'] }
    ]
  },
  {
    vertical:'saas', title:'SaaS Growth Playbook',
    description:'B2B SaaS demand gen: intent-based targeting, product-led growth loops, free trial optimisation, and expansion revenue.',
    icon:'💻', tags:['google-search','linkedin','content','product-led','email'],
    channels:['Google Search','LinkedIn Ads','Content/SEO','In-app onboarding'],
    compliance:['GDPR for EU prospects','CAN-SPAM','Cookie consent'],
    benchmarks:{ roas_target:4.2, cac_target:380, trial_to_paid:0.18, ndr:1.10 },
    phases:[
      { week:'1-2', title:'Foundation', tasks:['Define ICP and jobs-to-be-done','Set up intent-based Google Search campaigns','Publish 3 high-intent SEO articles','Map the free trial onboarding flow'] },
      { week:'3-6', title:'Demand Gen', tasks:['Launch LinkedIn retargeting for trial users','Create comparison landing pages (vs competitors)','Launch product-led referral loop','A/B test pricing page'] },
      { week:'7-12', title:'Expansion', tasks:['Build expansion email sequence for free users','Launch G2/Capterra review campaign','Scale LinkedIn to new ICP segments','Implement usage-based upgrade nudges'] }
    ]
  },
  {
    vertical:'local-business', title:'Local Business Growth Playbook',
    description:'For brick-and-mortar and service businesses: Google Maps visibility, local SEO, review generation, and community building.',
    icon:'📍', tags:['google-maps','local-seo','reviews','facebook','email'],
    channels:['Google Maps / Local SEO','Facebook/Instagram','Review platforms','Email & SMS'],
    compliance:['FTC review solicitation guidelines','Local advertising standards'],
    benchmarks:{ google_rating_target:4.5, review_count_target:50, local_pack_rank:3, cost_per_lead:35 },
    phases:[
      { week:'1-2', title:'Visibility Audit', tasks:['Claim and optimise all Google Business listings','Audit NAP consistency across directories','Set up review request automation','Fix on-page local SEO signals'] },
      { week:'3-6', title:'Community Growth', tasks:['Launch Facebook local awareness ads','Create neighbourhood content series','Run "refer a neighbour" campaign','Build email list via in-store offers'] },
      { week:'7-12', title:'Dominate Local', tasks:['Build local backlinks from community sites','Launch seasonal promotions calendar','Partner with complementary local businesses','Run Google Maps ad campaign'] }
    ]
  },
  {
    vertical:'finance', title:'Financial Services Playbook',
    description:'Compliant growth for financial brands: regulated ad copy, trust-building content, and compliant lead generation.',
    icon:'🏦', tags:['google-search','compliance','content','email','fca','ftc'],
    channels:['Google Search (compliant)','Content/Thought leadership','Email nurture','Webinars'],
    compliance:['FCA (UK)','ESMA (EU)','FTC (US)','Risk warnings on all investment content','Past performance disclaimers'],
    benchmarks:{ cost_per_qualified_lead:180, email_open_rate:28, content_conversion_rate:3.5 },
    phases:[
      { week:'1-2', title:'Compliance Audit', tasks:['Audit all existing ad copy for regulatory issues','Add required disclaimers to landing pages','Set up compliance approval workflow','Brief team on FCA/FTC requirements'] },
      { week:'3-6', title:'Trust Building', tasks:['Publish 4 educational content pieces','Launch thought leadership LinkedIn campaign','Set up webinar funnel','Build compliance-checked email sequences'] },
      { week:'7-12', title:'Scale Safely', tasks:['Launch compliant Google Search campaigns','Build partner/referral program','Create quarterly market commentary series','Implement trust signals across site'] }
    ]
  },
  {
    vertical:'health', title:'Health & Wellness Playbook',
    description:'Evidence-based marketing for health brands: claim substantiation, HIPAA considerations, and trust-first content strategy.',
    icon:'💊', tags:['content','email','facebook','google','hipaa','ftc'],
    channels:['Content/SEO','Email','Facebook/Instagram','Google (non-pharma)'],
    compliance:['FTC health claim guidelines','HIPAA for data','FDA for drug/device ads','No guaranteed outcome claims'],
    benchmarks:{ cost_per_lead:55, email_open_rate:30, content_organic_traffic_growth:40 },
    phases:[
      { week:'1-2', title:'Claim Review', tasks:['Audit all marketing claims for substantiation','Add evidence citations to key content','Review testimonials for FTC compliance','Document compliance procedures'] },
      { week:'3-6', title:'Content Foundation', tasks:['Launch evidence-based blog series','Build email welcome sequence with trust signals','Create social proof strategy (case studies)','Set up retargeting with compliant copy'] },
      { week:'7-12', title:'Community & Growth', tasks:['Launch patient/customer community','Scale compliant paid social campaigns','Build influencer partnership framework','Implement outcome tracking (privacy-safe)'] }
    ]
  },
  {
    vertical:'agency', title:'Marketing Agency Growth Playbook',
    description:'Win and retain clients: case study engine, white-label services, referral systems, and retainer upsell frameworks.',
    icon:'🏢', tags:['linkedin','referrals','content','outreach','case-studies'],
    channels:['LinkedIn outreach','Content/Thought leadership','Client referral program','Partnerships'],
    compliance:['Client data handling (GDPR)','Transparent reporting','White-label disclosure policies'],
    benchmarks:{ client_ltv:28000, churn_rate:0.08, referral_rate:0.35, retainer_conversion:0.45 },
    phases:[
      { week:'1-2', title:'Credibility Stack', tasks:['Document 5 client case studies with ROI data','Create positioning statement and ICP profile','Set up LinkedIn thought leadership content calendar','Build referral ask framework'] },
      { week:'3-6', title:'New Business Engine', tasks:['Launch outbound outreach sequence','Publish weekly LinkedIn insights','Create "free audit" lead magnet','Run LinkedIn events/webinar'] },
      { week:'7-12', title:'Retain & Expand', tasks:['Launch quarterly business reviews for all clients','Build upsell playbook (retainer tiers)','Create client referral incentive program','Build partner agency network'] }
    ]
  }
];

// Seed system playbooks once
async function seedPlaybooks(p) {
  const existing = await p.query(`SELECT COUNT(*) FROM vertical_playbooks WHERE is_system=TRUE AND tenant_id IS NULL`);
  if (+existing.rows[0].count >= SYSTEM_PLAYBOOKS.length) return;
  for (const pb of SYSTEM_PLAYBOOKS) {
    // Catalog seed: tenant_id stays NULL and is_system=TRUE on purpose (MIXED
    // roles pattern). Custom rows must never take this path.
    await p.query(
      `INSERT INTO vertical_playbooks(vertical,title,description,content,is_system)
       VALUES($1,$2,$3,$4,TRUE)
       ON CONFLICT (vertical) WHERE tenant_id IS NULL DO NOTHING`,
      [pb.vertical, pb.title, pb.description, JSON.stringify(pb)]
    );
  }
}

router.get('/list', async (req, res) => {
  const p = await _db.getPool();
  await seedPlaybooks(p);
  const rows = await p.query(`SELECT id,vertical,title,description,content FROM vertical_playbooks WHERE is_system=TRUE AND tenant_id IS NULL ORDER BY vertical`);
  res.json({ ok:true, playbooks: rows.rows.map(r=>({ ...r, content: typeof r.content==='string'?JSON.parse(r.content):r.content })) });
});

router.get('/:vertical', async (req, res) => {
  const p = await _db.getPool();
  await seedPlaybooks(p);
  const row = await p.query(`SELECT * FROM vertical_playbooks WHERE vertical=$1 AND is_system=TRUE AND tenant_id IS NULL LIMIT 1`, [req.params.vertical]);
  if (!row.rows.length) return res.status(404).json({ ok:false, error:'Playbook not found' });
  const pb = row.rows[0];
  const content = typeof pb.content==='string'?JSON.parse(pb.content):pb.content;
  res.json({ ok:true, playbook: { ...pb, content } });
});

router.post('/activate/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'playbooks:activate' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const pb = await p.query(
    `SELECT id FROM vertical_playbooks
      WHERE id=$1 AND ((is_system=TRUE AND tenant_id IS NULL) OR tenant_id=$2)`,
    [req.params.id, tid]
  );
  if (!pb.rows.length) return res.status(404).json({ ok:false, error:'Playbook not found' });
  await p.query(
    `INSERT INTO active_playbooks(tenant_id,playbook_id,progress) VALUES($1,$2,'{}')
     ON CONFLICT(tenant_id,playbook_id) DO UPDATE SET activated_at=NOW(), progress='{}'`,
    [tid, req.params.id]
  );
  res.json({ ok:true, activated: true });
});

router.get('/active/list', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'playbooks:active' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT ap.id, ap.progress, ap.activated_at, vp.vertical, vp.title, vp.description, vp.content
     FROM active_playbooks ap JOIN vertical_playbooks vp ON vp.id=ap.playbook_id
     WHERE ap.tenant_id=$1
       AND ((vp.is_system = TRUE AND vp.tenant_id IS NULL) OR vp.tenant_id = $1)
     ORDER BY ap.activated_at DESC`,
    [tid]
  );
  res.json({ ok:true, active: rows.rows.map(r=>({ ...r, content: typeof r.content==='string'?JSON.parse(r.content):r.content })) });
});

router.post('/generate-custom', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'playbooks:generate-custom' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { industry, business_description, goals, challenges, budget } = req.body || {};
  if (!industry) return res.status(400).json({ ok:false, error:'industry required' });
  let content = {};
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a senior marketing strategist. Create a bespoke 90-day marketing playbook.
Industry: ${industry}
Business: ${business_description||''}
Goals: ${JSON.stringify(goals||{})}
Challenges: ${JSON.stringify(challenges||[])}
Monthly budget: ${budget ? '$'+budget : 'unspecified'}
Return strict JSON matching this structure:
{
  "vertical":"${industry}","title":"...","description":"...","icon":"emoji","tags":["..."],
  "channels":["..."],"compliance":["..."],
  "benchmarks":{"key_metric_1":0},
  "phases":[{"week":"1-2","title":"...","tasks":["..."]}]
}`;
    const r = await openai.chat.completions.create({ model:'gpt-5', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}], max_tokens:1500 });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (parsed.phases?.[0]?.tasks?.[0]?._DUMMY) throw new Error('dummy');
    content = parsed;
  } catch(e) {
    content = { vertical:industry, title:`${industry} Growth Playbook (AI-Generated)`, description:`Custom 90-day playbook for ${industry}.`, icon:'📋', tags:[industry.toLowerCase()], channels:['Google','Meta','Email'], compliance:['FTC guidelines'], benchmarks:{}, phases:[{ week:'1-4', title:'Foundation', tasks:['Audit current performance','Set KPIs','Launch initial campaigns','Implement tracking'] }] };
  }
  const p = await _db.getPool();
  const row = await p.query(
    `INSERT INTO vertical_playbooks(tenant_id,vertical,title,description,content,is_system) VALUES($1,$2,$3,$4,$5,FALSE) RETURNING id`,
    [tid, industry, content.title, content.description, JSON.stringify(content)]
  );
  await p.query(`INSERT INTO active_playbooks(tenant_id,playbook_id,progress) VALUES($1,$2,'{}')`, [tid, row.rows[0].id]);
  res.json({ ok:true, playbook: { id: row.rows[0].id, ...content } });
});

module.exports = router;
