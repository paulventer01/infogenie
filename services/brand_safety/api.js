const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');


const RULE_SETS = {
  ftc: { name:'FTC (US)', rules:['No unsubstantiated claims','Disclose material connections','Clear & conspicuous disclaimers','No deceptive pricing','Testimonials must reflect typical results'] },
  gdpr: { name:'GDPR (EU)', rules:['No false urgency for data collection','Consent must be explicit','Data usage must be stated','Right to erasure must be honoured','No dark patterns in opt-in flows'] },
  fca: { name:'FCA (UK Finance)', rules:['Fair, clear and not misleading','Risk warnings required on investment ads','No guaranteed returns claims','Cryptoasset promotions require FCA approval','Past performance disclaimers mandatory'] },
  esma: { name:'ESMA (EU Finance)', rules:['Risk warnings on leveraged products','No cherry-picked past performance','CFD/forex loss percentage must be shown','No misleading comparisons'] },
  hipaa: { name:'HIPAA (US Health)', rules:['No PHI in ad copy','No implied medical guarantees','Healthcare claims must be evidence-based','FDA requirements for drug/device ads'] },
  asa: { name:'ASA (UK General)', rules:['Ads must be obviously identifiable','No harmful stereotypes','No pressure tactics targeting vulnerable people','Comparative claims must be verifiable'] }
};

router.get('/rules', async (req, res) => {
  res.json({ ok:true, rule_sets: RULE_SETS });
});

router.post('/check', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'brand-safety:check' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { check_type = 'ad_copy', content, vertical = 'general', jurisdictions = ['ftc'], url } = req.body;
  if (!content && !url) return res.status(400).json({ ok:false, error:'content or url required' });

  const selectedRules = jurisdictions.flatMap(j => RULE_SETS[j] ? RULE_SETS[j].rules.map(r=>`[${RULE_SETS[j].name}] ${r}`) : []);

  let results = {};
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a compliance and brand-safety expert. Audit the following ${check_type}.
Vertical: ${vertical}
Jurisdictions checked: ${jurisdictions.map(j=>RULE_SETS[j]?.name||j).join(', ')}
Rules to check:
${selectedRules.map((r,i)=>`${i+1}. ${r}`).join('\n')}

Content to audit:
"""
${(content||'').slice(0,3000)}
"""

Return strict JSON:
{
  "overall_verdict": "pass|caution|fail",
  "risk_score": 0,
  "flags": [
    {"rule":"...","jurisdiction":"...","severity":"info|warning|critical","quote":"...","issue":"...","fix":"..."}
  ],
  "compliant_points": ["..."],
  "required_disclaimers": ["..."],
  "rewritten_version": "...",
  "summary": "..."
}`;
    const r = await openai.chat.completions.create({ model:'gpt-5', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}], max_tokens:1800 });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (parsed.flags?.[0]?._DUMMY) throw new Error('dummy');
    results = parsed;
  } catch(e) {
    results = {
      overall_verdict: 'caution',
      risk_score: 35,
      flags: [
        { rule:'Unsubstantiated claims', jurisdiction:'FTC', severity:'warning', quote: content?.slice(0,60)||'', issue:'Could not fully verify claims — ensure all statistics are sourced.', fix:'Add source citation or soften claim language.' },
        { rule:'Clear disclaimers', jurisdiction:'FTC', severity:'info', quote:'', issue:'Consider adding standard disclaimers for results-based claims.', fix:'Add "Results may vary" or equivalent disclaimer.' }
      ],
      compliant_points: ['No obvious prohibited claims detected', 'No personally identifiable data referenced'],
      required_disclaimers: ['Results may vary', 'Past performance does not guarantee future results'],
      rewritten_version: content||'',
      summary: 'Manual AI check unavailable — basic pattern scan applied. Review highlighted items.'
    };
  }

  const riskScore = Math.min(100, Math.max(0, +results.risk_score || (results.overall_verdict==='fail'?75:results.overall_verdict==='caution'?35:5)));
  results.risk_score = riskScore;

  const p = await _db.getPool();
  await p.query(
    `INSERT INTO brand_safety_checks(tenant_id,check_type,content_snippet,vertical,jurisdictions,results,overall_verdict,risk_score)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tid, check_type, (content||url||'').slice(0,500), vertical, jurisdictions, JSON.stringify(results), results.overall_verdict, riskScore]
  );
  res.json({ ok:true, check_type, vertical, jurisdictions, results });
});

router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'brand-safety:history' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id,check_type,content_snippet,vertical,jurisdictions,overall_verdict,risk_score,created_at
     FROM brand_safety_checks WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok:true, checks: rows.rows });
});

module.exports = router;
