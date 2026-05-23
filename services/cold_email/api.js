const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label, allowFallback: true });
}
const TONES = new Set(['direct','warm','consultative','witty','executive','curious']);

async function _aiGenerate(payload) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a senior B2B SDR who writes cold emails that get replies. Draft a ${payload.steps}-step cold email sequence in strict JSON ONLY:
{"emails":[{"step":1,"days_after_prev":0,"subject":"<2-7 words, no clickbait, no exclamation marks>","preview":"<the inbox-preview line, ≤90 chars>","body":"<plain-text body, 60-130 words, conversational, addressed to first name as {{firstName}}>","cta":"<one-sentence single-question CTA>","why_this_works":"<one short line of rationale>"}]}
Hard rules:
- Subjects: lowercase-first, plain English, no spam triggers (FREE!, GUARANTEED, !!!).
- Bodies: NO buzzwords (synergy, leverage, revolutionary). Reference the target's specific pain. Mention ONE proof point (number, customer name, time-to-value).
- Step 1 is the cold opener; subsequent steps escalate value or ask differently — never repeat the same hook.
- Final step must be a polite, one-sentence breakup ("If now isn't right…").
- days_after_prev: 0 for step 1, then 3-5 days between each.`;
  const user = `Sender brand: ${payload.sender_brand||'(unspecified)'}\nSender name: ${payload.sender_name||'a rep'}\nWhat we sell / offer: ${payload.sender_offer||'(unspecified)'}\nTarget company: ${payload.target_company||'(any)'}\nTarget role: ${payload.target_role||'decision maker'}\nTarget pain / trigger: ${payload.target_pain||'(unspecified)'}\nTone: ${payload.tone}\nSteps: ${payload.steps}\nDraft now.`;
  const body = JSON.stringify({
    model:'gpt-4o-mini',
    messages:[{role:'system',content:sys},{role:'user',content:user}],
    response_format:{type:'json_object'}, temperature:0.7, max_tokens:2200,
  });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d); resolve(JSON.parse(j.choices[0].message.content));
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _templateSequence(p) {
  const company = p.target_company || 'your team';
  const role = p.target_role || 'leader';
  const pain = p.target_pain || 'the typical bottleneck';
  const offer = p.sender_offer || 'our solution';
  const sender = p.sender_name || 'me';
  const brand = p.sender_brand || 'our team';
  const steps = Math.max(1, Math.min(5, p.steps || 3));
  const arr = [];
  arr.push({ step:1, days_after_prev:0, subject:`quick question on ${role.toLowerCase()} priorities`, preview:`Saw ${company} is growing — wanted to share one idea on ${pain}.`, body:`Hi {{firstName}},\n\nNoticed ${company} is scaling fast. Most ${role.toLowerCase()}s I talk to at this stage are wrestling with ${pain}.\n\nAt ${brand} we built ${offer} for exactly this — one customer cut their cycle time by 40% in the first month.\n\nWorth a 15-minute look this week?\n\n— ${sender}`, cta:`Open to a 15-min call Thursday?`, why_this_works:`Specific pain + single proof point + low-friction ask.` });
  if (steps >= 2) arr.push({ step:2, days_after_prev:4, subject:`re: ${role.toLowerCase()} priorities`, preview:`A 90-second loom on how this could work for ${company}.`, body:`Hi {{firstName}},\n\nFollowing up — I put together a 90-second walkthrough showing exactly how ${offer} would map to ${company}'s setup.\n\nHappy to send the link if useful, or skip it if not the right time.\n\n— ${sender}`, cta:`Want me to send the loom?`, why_this_works:`Soft re-engage with a value-add (loom), not just "checking in".` });
  if (steps >= 3) arr.push({ step:3, days_after_prev:5, subject:`one more thought`, preview:`Two ${company}-style customers + the result they got.`, body:`Hi {{firstName}},\n\nLast note — two customers similar to ${company} both saw ${offer} pay back in under 60 days. Happy to share the case studies if helpful.\n\nIf this isn't a priority right now, totally get it — just let me know and I'll stop reaching out.\n\n— ${sender}`, cta:`Worth a quick look?`, why_this_works:`Social proof + permission-to-stop signals respect.` });
  if (steps >= 4) arr.push({ step:4, days_after_prev:5, subject:`should I close the loop?`, preview:`Just a quick yes / no / not now.`, body:`Hi {{firstName}},\n\nQuick one — should I close the loop on my end?\n\nA simple "not now" or "try me in Q3" is the most helpful answer you can give me.\n\n— ${sender}`, cta:`Yes / no / try me later?`, why_this_works:`Easy out increases reply rate dramatically.` });
  if (steps >= 5) arr.push({ step:5, days_after_prev:5, subject:`closing your file`, preview:`No reply needed.`, body:`Hi {{firstName}},\n\nNo response needed — closing your file on my end. If ${pain} ever becomes urgent, you know where to find me.\n\nBest of luck with everything at ${company}.\n\n— ${sender}`, cta:`(no reply needed)`, why_this_works:`The breakup email — historically one of the highest reply rates in a sequence.` });
  return { emails: arr };
}

router.post('/generate', async (req, res) => {
  const tone = TONES.has((req.body?.tone||'').toLowerCase()) ? req.body.tone.toLowerCase() : 'direct';
  const steps = Math.max(1, Math.min(5, parseInt(req.body?.steps, 10) || 3));
  const payload = {
    sender_brand: String(req.body?.sender_brand || '').trim().slice(0, 80),
    sender_name:  String(req.body?.sender_name || '').trim().slice(0, 80),
    sender_offer: String(req.body?.sender_offer || '').trim().slice(0, 400),
    target_company: String(req.body?.target_company || '').trim().slice(0, 80),
    target_role: String(req.body?.target_role || '').trim().slice(0, 80),
    target_pain: String(req.body?.target_pain || '').trim().slice(0, 400),
    tone, steps,
  };
  if (!payload.sender_offer) return _err(res, 400, 'sender_offer required (what you sell)');
  let result = await _aiGenerate(payload);
  let source = 'openai';
  if (!result || !Array.isArray(result.emails) || !result.emails.length) {
    result = _templateSequence(payload); source = 'template';
  }
  if (_db.hasDb()) {
    try {
      const tid = await _tid(req, 'cold-email:generate');
      await _db.getPool().query(
        `INSERT INTO cold_email_runs (tenant_id, sender_brand, sender_name, sender_offer, target_company, target_role, target_pain, tone, sequence_steps, emails, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tid, payload.sender_brand, payload.sender_name, payload.sender_offer, payload.target_company, payload.target_role, payload.target_pain, tone, steps, JSON.stringify(result.emails), source]);
    } catch (e) { console.warn('[cold-email] persist failed:', e.message); }
  }
  res.json({ ok:true, source, ...payload, emails: result.emails });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'cold-email:history');
    const r = await _db.getPool().query(
      `SELECT id, sender_brand, target_company, target_role, tone, sequence_steps, generated_by, created_at FROM cold_email_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
      [tid]
    );
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const tid = await _tid(req, 'cold-email:get');
    const r = await _db.getPool().query(
      `SELECT * FROM cold_email_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]
    );
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
