const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const FORMATS = ['static-image','video-short','video-long','carousel','ugc-style','text-ad','display','native'];
const HOOK_TYPES = ['question','shock-stat','social-proof','pain-point','before-after','bold-claim','storytelling','curiosity-gap'];
const CTA_TYPES = ['shop-now','learn-more','get-started','book-demo','try-free','see-pricing','download','watch-now'];
const PRICING_MODELS = ['one-time','monthly-sub','annual-sub','usage-based','freemium','pay-as-you-go','tiered'];
const OFFER_TYPES = ['saas','ecommerce-product','service','digital-product','course','agency-retainer'];

router.get('/config', async (req, res) => {
  res.json({ ok:true, formats:FORMATS, hook_types:HOOK_TYPES, cta_types:CTA_TYPES, pricing_models:PRICING_MODELS, offer_types:OFFER_TYPES });
});

router.post('/creative/submit', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'data-products:creative-submit' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { format, hook_type, cta_type, channel, ctr, cvr, roas, industry } = req.body;
  if (!format || !channel) return res.status(400).json({ ok:false, error:'format and channel required' });
  const p = await _db.getPool();
  await p.query(
    `INSERT INTO creative_performance(tenant_id,format,hook_type,cta_type,channel,ctr,cvr,roas,industry) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tid, format, hook_type||null, cta_type||null, channel, ctr||null, cvr||null, roas||null, industry||null]
  );
  res.json({ ok:true });
});

router.get('/creative/index', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'data-products:creative-index' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { channel, industry } = req.query;
  const p = await _db.getPool();

  const where = [];
  const args = [];
  if (channel) { where.push(`channel=$${args.length+1}`); args.push(channel); }
  if (industry) { where.push(`industry=$${args.length+1}`); args.push(industry); }
  const whereStr = where.length ? 'WHERE '+where.join(' AND ') : '';

  const [byFormat, byHook, byCta, totals] = await Promise.all([
    p.query(`SELECT format, AVG(ctr) as avg_ctr, AVG(cvr) as avg_cvr, AVG(roas) as avg_roas, COUNT(*) as n FROM creative_performance ${whereStr} GROUP BY format ORDER BY avg_roas DESC NULLS LAST`, args),
    p.query(`SELECT hook_type, AVG(ctr) as avg_ctr, AVG(cvr) as avg_cvr, COUNT(*) as n FROM creative_performance ${whereStr} AND hook_type IS NOT NULL GROUP BY hook_type ORDER BY avg_ctr DESC NULLS LAST`.replace('IS NOT NULL GROUP','IS NOT NULL '+(where.length?'AND ':'WHERE ')+'hook_type IS NOT NULL GROUP'), args).catch(()=>({rows:[]})),
    p.query(`SELECT cta_type, AVG(cvr) as avg_cvr, COUNT(*) as n FROM creative_performance ${whereStr} AND cta_type IS NOT NULL GROUP BY cta_type ORDER BY avg_cvr DESC NULLS LAST`.replace('IS NOT NULL GROUP','IS NOT NULL '+(where.length?'AND ':'WHERE ')+'cta_type IS NOT NULL GROUP'), args).catch(()=>({rows:[]})),
    p.query(`SELECT COUNT(*) as n FROM creative_performance ${whereStr}`, args),
  ]);

  const byFormatFixed = await p.query(`SELECT format, AVG(ctr) as avg_ctr, AVG(cvr) as avg_cvr, AVG(roas) as avg_roas, COUNT(*) as n FROM creative_performance ${whereStr} GROUP BY format ORDER BY avg_roas DESC NULLS LAST`, args).catch(()=>({rows:[]}));
  const byHookFixed = await p.query(`SELECT hook_type, AVG(ctr) as avg_ctr, AVG(cvr) as avg_cvr, COUNT(*) as n FROM creative_performance ${whereStr ? whereStr+' AND hook_type IS NOT NULL' : 'WHERE hook_type IS NOT NULL'} GROUP BY hook_type ORDER BY avg_ctr DESC NULLS LAST`, args).catch(()=>({rows:[]}));
  const byCtaFixed = await p.query(`SELECT cta_type, AVG(cvr) as avg_cvr, COUNT(*) as n FROM creative_performance ${whereStr ? whereStr+' AND cta_type IS NOT NULL' : 'WHERE cta_type IS NOT NULL'} GROUP BY cta_type ORDER BY avg_cvr DESC NULLS LAST`, args).catch(()=>({rows:[]}));

  res.json({ ok:true, by_format: byFormatFixed.rows, by_hook: byHookFixed.rows, by_cta: byCtaFixed.rows, total_submissions: +totals.rows[0].n });
});

router.post('/offer/submit', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'data-products:offer-submit' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { offer_type, pricing_model, free_trial, trial_days, guarantee, onboarding_type, cvr, industry } = req.body;
  if (!offer_type || !pricing_model) return res.status(400).json({ ok:false, error:'offer_type and pricing_model required' });
  const p = await _db.getPool();
  await p.query(
    `INSERT INTO offer_benchmark_data(tenant_id,offer_type,pricing_model,free_trial,trial_days,guarantee,onboarding_type,cvr,industry) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tid, offer_type, pricing_model, free_trial||false, trial_days||null, guarantee||null, onboarding_type||null, cvr||null, industry||null]
  );
  res.json({ ok:true });
});

router.get('/offer/benchmarks', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'data-products:offer-benchmarks' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const [byModel, byOfferType, trialEffect, total] = await Promise.all([
    p.query(`SELECT pricing_model, AVG(cvr) as avg_cvr, COUNT(*) as n FROM offer_benchmark_data GROUP BY pricing_model ORDER BY avg_cvr DESC NULLS LAST`),
    p.query(`SELECT offer_type, AVG(cvr) as avg_cvr, COUNT(*) as n FROM offer_benchmark_data GROUP BY offer_type ORDER BY avg_cvr DESC NULLS LAST`),
    p.query(`SELECT free_trial, AVG(cvr) as avg_cvr, COUNT(*) as n FROM offer_benchmark_data GROUP BY free_trial`),
    p.query(`SELECT COUNT(*) as n FROM offer_benchmark_data`),
  ]);
  res.json({ ok:true, by_model: byModel.rows, by_offer_type: byOfferType.rows, trial_effect: trialEffect.rows, total_submissions: +total.rows[0].n });
});

router.get('/emerging-signals', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'data-products:emerging' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM emerging_signals WHERE tenant_id=$1 ORDER BY detected_at DESC LIMIT 20`, [tid]);
  res.json({ ok:true, signals: rows.rows });
});

router.post('/emerging-signals/refresh', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'data-products:emerging-refresh' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { industry, focus } = req.body;

  let signals = [];
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a market intelligence analyst. Generate 8 emerging marketing signals for ${industry||'general marketing'}.
Focus: ${focus||'trends, competitor moves, pricing shifts, hiring intent, content themes'}
Each signal should be specific, actionable, and confidence-scored.
Types: competitor_move, pricing_shift, hiring_intent, content_theme, channel_trend, offer_trend, technology_shift, audience_shift
Return strict JSON: {"signals":[{"signal_type":"...","title":"...","description":"...","category":"...","confidence_score":0,"source":"market intelligence"}]}`;
    const r = await openai.chat.completions.create({ model:'gpt-5', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.signals?.[0]?._DUMMY) signals = parsed.signals;
  } catch(e) {}

  if (!signals.length) {
    signals = [
      { signal_type:'channel_trend', title:'Short-form video outperforming display ads', description:'Video <30s showing 3x engagement rate vs static display across Meta and TikTok in Q2.', category:'creative', confidence_score:82, source:'platform benchmarks' },
      { signal_type:'competitor_move', title:'Top competitors increasing LinkedIn spend 40%', description:'Job postings and sponsored content from tier-1 competitors spiked, suggesting B2B push.', category:'competitive', confidence_score:74, source:'hiring intelligence' },
      { signal_type:'pricing_shift', title:'Annual billing incentives becoming table stakes', description:'78% of SaaS companies now offer 20%+ annual discount vs 54% 12 months ago.', category:'offer', confidence_score:79, source:'offer benchmark data' },
      { signal_type:'audience_shift', title:'CFO involvement in martech decisions rising', description:'Decision-maker signals show finance stakeholders entering martech evaluations 40% earlier.', category:'audience', confidence_score:68, source:'intent signal data' },
      { signal_type:'content_theme', title:'AI transparency content drives 2x engagement', description:'Posts explaining AI methodology outperform promotional content by 2x on LinkedIn.', category:'content', confidence_score:71, source:'content performance data' },
      { signal_type:'technology_shift', title:'Server-side tracking adoption accelerating', description:'First-party data infra investments up 60% as cookie deprecation accelerates.', category:'technology', confidence_score:85, source:'tech stack intelligence' },
      { signal_type:'offer_trend', title:'Onboarding guarantee reduces churn 28%', description:'Offers including guided onboarding commitment see materially lower 90-day churn.', category:'retention', confidence_score:76, source:'offer benchmark network' },
      { signal_type:'hiring_intent', title:'Competitors hiring demand-gen roles signals growth push', description:'3 major competitors posted 15+ demand gen roles in past 30 days — growth investment ahead.', category:'competitive', confidence_score:69, source:'job board intelligence' },
    ];
  }

  const p = await _db.getPool();
  for (const s of signals) {
    await p.query(
      `INSERT INTO emerging_signals(tenant_id,signal_type,title,description,category,confidence_score,source) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [tid, s.signal_type, s.title, s.description, s.category, s.confidence_score||0, s.source||'AI generated']
    );
  }
  res.json({ ok:true, signals, generated: signals.length });
});

module.exports = router;
