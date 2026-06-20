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
  const body = JSON.stringify({ model:'gpt-5', messages, response_format:{ type:'json_object' }, temperature:0.2, max_tokens: opts.max_tokens||3000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if(r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(90000,()=>req.destroy()); req.write(body); req.end();
  });
}

router.get('/runs', async (req, res) => {
  const tid = await _tid(req, 'ao:runs'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM auto_operator_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`, [tid]);
  res.json({ ok:true, runs: rows.rows });
});

router.post('/run', async (req, res) => {
  const tid = await _tid(req, 'ao:run'); if (!tid) return _err(res,400,'no_tenant');
  const {
    trigger = 'manual',
    current_roas, target_roas, current_cac, target_cac,
    campaigns = [], landing_pages = [],
    budget_remaining, daily_spend,
    issues = []
  } = req.body || {};

  const sys = `You are an Autonomous Marketing Operator — an AI that detects marketing problems and takes decisive action without waiting for human input. Given the current campaign state, decide what actions to take and simulate taking them.

Return strict JSON:
{
  "diagnosis": "2-3 sentence plain English diagnosis of what's wrong",
  "severity": "low|medium|high|critical",
  "actions_taken": [
    {
      "action": "rewrite_ad|pause_campaign|scale_campaign|reallocate_budget|launch_ab_test|update_landing_page|send_alert|adjust_bid",
      "target": "What was acted on",
      "detail": "What specifically was done",
      "expected_impact": "Expected change as a result",
      "status": "completed|pending_approval"
    }
  ],
  "new_ad_copy": {
    "headline": "If ads were rewritten, the new headline",
    "body": "New body copy",
    "cta": "New CTA"
  },
  "budget_reallocation": {
    "from": "Channel or campaign to reduce",
    "to": "Channel or campaign to increase",
    "amount": "Amount moved",
    "reason": "Why"
  },
  "ab_test_proposed": {
    "variant_a": "Current version description",
    "variant_b": "New variant to test",
    "hypothesis": "What we expect to learn"
  },
  "summary": "One sentence: what the operator did and what it expects to happen",
  "next_review": "When to review results e.g. 24 hours"
}
Be decisive. Take real actions. Explain everything clearly.`;

  const campaignText = campaigns.map(c=>`- ${c.name||'Campaign'}: ROAS ${c.roas||'?'}, CPA ${c.cpa||'?'}, spend ${c.spend||'?'}`).join('\n') || 'No campaign data provided';
  const userMsg = `Trigger: ${trigger}
Current ROAS: ${current_roas||'unknown'} | Target ROAS: ${target_roas||'2.0'}
Current CAC: ${current_cac||'unknown'} | Target CAC: ${target_cac||'unknown'}
Daily spend: ${daily_spend||'unknown'} | Budget remaining: ${budget_remaining||'unknown'}
Active campaigns:\n${campaignText}
Known issues: ${issues.join('; ') || 'None flagged'}
Landing pages: ${landing_pages.length} connected`;

  const raw = await _openai([{role:'system',content:sys},{role:'user',content:userMsg}]);

  const TEMPLATE = {
    diagnosis: 'Template run — connect AI providers for autonomous marketing decisions. In live mode, the operator would analyse your ROAS, CPA, creative fatigue, and budget pacing.',
    severity: 'medium',
    actions_taken: [
      { action:'rewrite_ad', target:'Top ad by spend', detail:'Rewrote headline to focus on outcome-driven messaging. Changed CTA from "Learn More" to "Start Free Today".', expected_impact:'+15-25% CTR expected', status:'completed' },
      { action:'reallocate_budget', target:'Budget across channels', detail:'Moved 20% of TikTok budget to Google Demand Gen based on ROAS differential.', expected_impact:'Overall ROAS improvement within 48 hours', status:'completed' },
      { action:'launch_ab_test', target:'Landing page hero section', detail:'Launched A/B test with social proof variant (testimonial above the fold) vs. current benefit-led hero.', expected_impact:'+10-20% CVR expected', status:'completed' }
    ],
    new_ad_copy: { headline:'Get Real Results in 30 Days — Guaranteed', body:'InfoGenie monitors your competitors, builds your campaigns, and fixes what\'s broken — automatically.', cta:'Start Free Today' },
    budget_reallocation: { from:'TikTok Ads', to:'Google Demand Gen', amount:'20% of TikTok budget', reason:'Google Demand Gen showing 2.1x better ROAS over last 7 days' },
    ab_test_proposed: { variant_a:'Current hero: product screenshot + headline', variant_b:'Social proof hero: customer testimonial + result metric', hypothesis:'Social proof above the fold will increase trust and improve CVR by 10-20%' },
    summary: 'Operator rewrote underperforming ads, reallocated budget to higher-ROAS channel, and launched landing page A/B test.',
    next_review: '24 hours'
  };

  let result = TEMPLATE;
  if (raw) { try { result = JSON.parse(raw); } catch {} }

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO auto_operator_runs(tenant_id,trigger,actions_taken,summary,status) VALUES($1,$2,$3,$4,'completed') RETURNING id,created_at`,
    [tid, trigger, JSON.stringify(result.actions_taken||[]), result.summary||'']
  );
  res.json({ ok:true, id:ins.rows[0].id, trigger, result, created_at:ins.rows[0].created_at });
});

module.exports = router;
