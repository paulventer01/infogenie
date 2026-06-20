const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const STAGES = ['awareness','interest','intent','consideration','decision','customer','churned'];
const SIGNAL_TYPES = ['page_visit','content_download','pricing_page','demo_request','email_open','ad_click','job_posting_viewed','social_engage','offline_meeting','competitor_research'];

router.get('/config', async (req, res) => {
  res.json({ ok:true, stages: STAGES, signal_types: SIGNAL_TYPES });
});

router.get('/accounts', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'revenue-intel:accounts' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { stage } = req.query;
  const p = await _db.getPool();
  const q = stage
    ? `SELECT * FROM revenue_accounts WHERE tenant_id=$1 AND pipeline_stage=$2 ORDER BY intent_score DESC LIMIT 100`
    : `SELECT * FROM revenue_accounts WHERE tenant_id=$1 ORDER BY intent_score DESC LIMIT 100`;
  const args = stage ? [tid, stage] : [tid];
  const rows = await p.query(q, args);
  res.json({ ok:true, accounts: rows.rows });
});

router.post('/accounts/add', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'revenue-intel:add-account' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { company_name, domain, industry, company_size, pipeline_stage, pipeline_value, owner_name, buying_committee, tags } = req.body;
  if (!company_name) return res.status(400).json({ ok:false, error:'company_name required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO revenue_accounts(tenant_id,company_name,domain,industry,company_size,pipeline_stage,pipeline_value,owner_name,buying_committee,tags,last_activity_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
    [tid, company_name, domain||null, industry||null, company_size||null, pipeline_stage||'awareness', pipeline_value||0, owner_name||null, buying_committee||null, tags||null]
  );
  res.json({ ok:true, account: r.rows[0] });
});

router.post('/signal', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'revenue-intel:signal' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { account_id, signal_type, source, description } = req.body;
  if (!account_id || !signal_type) return res.status(400).json({ ok:false, error:'account_id and signal_type required' });
  const p = await _db.getPool();

  const SCORE_MAP = { page_visit:2, content_download:5, pricing_page:15, demo_request:25, email_open:3, ad_click:4, job_posting_viewed:6, social_engage:3, offline_meeting:20, competitor_research:8 };
  const delta = SCORE_MAP[signal_type] || 2;

  await p.query(
    `INSERT INTO revenue_signals(account_id,tenant_id,signal_type,source,description,score_delta) VALUES($1,$2,$3,$4,$5,$6)`,
    [account_id, tid, signal_type, source||null, description||null, delta]
  );
  await p.query(
    `UPDATE revenue_accounts SET intent_score=LEAST(100,intent_score+$1), last_activity_at=NOW(), updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
    [delta, account_id, tid]
  );
  res.json({ ok:true, score_delta: delta });
});

router.post('/score-account', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'revenue-intel:score' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { account_id } = req.body;
  if (!account_id) return res.status(400).json({ ok:false, error:'account_id required' });
  const p = await _db.getPool();
  const acc = await p.query(`SELECT * FROM revenue_accounts WHERE id=$1 AND tenant_id=$2`, [account_id, tid]);
  if (!acc.rows.length) return res.status(404).json({ ok:false, error:'not found' });
  const signals = await p.query(`SELECT * FROM revenue_signals WHERE account_id=$1 ORDER BY occurred_at DESC LIMIT 20`, [account_id]);

  let scoring = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are an AI revenue intelligence model. Score this B2B account.
Account: ${JSON.stringify(acc.rows[0])}
Recent signals: ${JSON.stringify(signals.rows)}
Return strict JSON: {"intent_score":0,"engagement_score":0,"pipeline_stage":"...","recommended_play":"...","outreach_angle":"...","buying_committee_size":0,"urgency":"high|medium|low","deal_probability_pct":0,"recommended_actions":["..."]}`;
    const r = await openai.chat.completions.create({ model:'gpt-5-mini', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) scoring = parsed;
  } catch(e) {}

  if (!scoring) {
    const a = acc.rows[0];
    scoring = {
      intent_score: Math.min(100, (a.intent_score||0) + 5),
      engagement_score: Math.min(100, signals.rows.length * 8),
      pipeline_stage: a.pipeline_stage,
      recommended_play: 'Send personalised case study aligned to their industry.',
      outreach_angle: `Highlight ROI for ${a.industry||'their sector'} — use 3rd party proof.`,
      buying_committee_size: 3,
      urgency: a.intent_score > 60 ? 'high' : 'medium',
      deal_probability_pct: Math.min(90, (a.intent_score||0)),
      recommended_actions: ['Schedule discovery call','Send pricing deck','Connect on LinkedIn']
    };
  }

  await p.query(
    `UPDATE revenue_accounts SET intent_score=$1, engagement_score=$2, pipeline_stage=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5`,
    [scoring.intent_score, scoring.engagement_score, scoring.pipeline_stage, account_id, tid]
  );
  res.json({ ok:true, scoring, account: acc.rows[0] });
});

router.get('/triggers', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'revenue-intel:triggers' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const hotAccounts = await p.query(
    `SELECT a.*, s.signal_type, s.description as signal_desc, s.occurred_at as signal_at
     FROM revenue_accounts a
     JOIN revenue_signals s ON s.account_id=a.id AND s.tenant_id=a.tenant_id
     WHERE a.tenant_id=$1 AND a.intent_score >= 50
       AND s.occurred_at > NOW() - INTERVAL '7 days'
     ORDER BY a.intent_score DESC, s.occurred_at DESC LIMIT 20`, [tid]
  );
  res.json({ ok:true, triggers: hotAccounts.rows });
});

router.get('/pipeline', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'revenue-intel:pipeline' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const [byStage, topAccounts, totalValue] = await Promise.all([
    p.query(`SELECT pipeline_stage, COUNT(*) as accounts, SUM(pipeline_value) as value, AVG(intent_score) as avg_intent FROM revenue_accounts WHERE tenant_id=$1 GROUP BY pipeline_stage ORDER BY ARRAY_POSITION($2::text[], pipeline_stage)`, [tid, STAGES]),
    p.query(`SELECT * FROM revenue_accounts WHERE tenant_id=$1 ORDER BY intent_score DESC LIMIT 10`, [tid]),
    p.query(`SELECT SUM(pipeline_value) as total, COUNT(*) as total_accounts FROM revenue_accounts WHERE tenant_id=$1`, [tid]),
  ]);
  res.json({ ok:true, by_stage: byStage.rows, top_accounts: topAccounts.rows, total: totalValue.rows[0], stages: STAGES });
});

module.exports = router;
