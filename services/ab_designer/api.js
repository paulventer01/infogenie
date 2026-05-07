const express = require('express');
const _https = require('https');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const VALID_KINDS = ['email_subject','ad_headline','ad_body','cta_button','landing_hero','push_notification','sms','social_caption'];

async function _aiVariants({ brand, element_kind, original, goal, audience, count }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a senior conversion copywriter and growth experimenter. Design ${count} A/B test variants for the given marketing element.
Return strict JSON in this exact shape:
{"hypothesis":"<the core hypothesis being tested across the variant set, 1 sentence>","primary_metric":"<click-through rate|open rate|conversion rate|reply rate|CTR|CVR|signup rate|etc>","variants":[{"label":"A|B|C|...","copy":"<the variant text>","angle":"<emotional|rational|FOMO|social_proof|curiosity|benefit_led|loss_aversion|urgency|authority|novelty>","predicted_lift":"<best estimate vs control, e.g. '+12% CTR'>","why":"<1 sentence on why this variant should win or differ>"}],"recommended_split":"<e.g. '50/50' or '70/30 weighted to A while ramping'>","sample_size_note":"<plain-language guidance on the rough min sample for significance>"}
Rules:
- Always include the original copy verbatim as variant A (control).
- Every variant after A must use a meaningfully different angle.
- Variants must fit the element's typical length (email subjects ≤55 chars; SMS ≤160; CTA buttons 1-4 words; ad headlines ≤40 chars).
- No emoji unless the original used one.
- predicted_lift should be a specific number range, not vague.`;
  const user = `Brand: ${brand || 'n/a'}
Element: ${element_kind}
Goal: ${goal || 'maximize conversion'}
Audience: ${audience || 'general'}
Original (control):
"""
${original}
"""
Design ${count} variants now (including original as A).`;
  const body = JSON.stringify({
    model:'gpt-4o-mini',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    response_format: { type:'json_object' },
    temperature: 0.75, max_tokens: 2000,
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
    req.setTimeout(45000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _templateVariants({ original, count }) {
  const angles = ['benefit_led','urgency','social_proof','curiosity','FOMO','authority','novelty'];
  const variants = [{ label:'A', copy: original, angle:'control', predicted_lift:'baseline', why:'Original copy as control.' }];
  for (let i=1; i<count; i++) {
    const a = angles[(i-1) % angles.length];
    variants.push({ label: String.fromCharCode(65+i), copy: `[${a}] ${original}`, angle:a, predicted_lift:`+${5 + i*3}% (estimated)`, why:`Tests the ${a} angle against control.` });
  }
  return { hypothesis:'Variant copy with a different angle will outperform control on the primary conversion metric.', primary_metric:'click-through rate', variants, recommended_split:'even split across all variants', sample_size_note:'Aim for at least 1,000 impressions per variant before declaring a winner.' };
}

router.post('/generate', async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const element_kind = VALID_KINDS.includes(req.body?.element_kind) ? req.body.element_kind : 'email_subject';
  const original = String(req.body?.original || '').slice(0, 2000);
  const goal = String(req.body?.goal || '').slice(0, 200);
  const audience = String(req.body?.audience || '').slice(0, 200);
  const count = Math.min(6, Math.max(2, parseInt(req.body?.count, 10) || 3));
  if (!original.trim()) return _err(res, 400, 'original copy required');

  let result = await _aiVariants({ brand, element_kind, original, goal, audience, count });
  let source = 'openai';
  if (!result || !Array.isArray(result.variants)) { result = _templateVariants({ original, count }); source = 'template'; }
  if (_db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO ab_designer_runs (brand, element_kind, original, goal, audience, variants, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [brand, element_kind, original, goal, audience, JSON.stringify(result.variants), source]);
    } catch (e) { console.warn('[ab-designer] persist failed:', e.message); }
  }
  res.json({ ok:true, source, element_kind, ...result });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, element_kind, original, goal, generated_by, created_at, jsonb_array_length(variants) AS variant_count
       FROM ab_designer_runs ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
