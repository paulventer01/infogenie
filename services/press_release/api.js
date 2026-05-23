const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const VALID_KINDS = ['crisis_response','product_launch','milestone','counter_competitor','partnership','custom'];

async function _aiPress({ kind, brand, headline_hint, context, spokesperson, quote_hint }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a senior PR writer drafting a press release for ${brand}. Output strict JSON with this exact shape:
{"headline":"max 100 chars, AP-style title case","subhead":"1 sentence supporting the headline (max 160 chars)","dateline":"CITY, ST — Month DD, YYYY","body":"3-5 short paragraphs in formal AP-style PR voice","quote":{"text":"a quotable 1-2 sentence statement","attribution":"Name, Title, ${brand}"},"boilerplate":"3-4 sentence about-${brand} closing paragraph","contact":{"name":"Press Contact name","email":"press@example.com"}}
Rules:
- Type of release: ${kind}.
- For crisis_response: acknowledge concern factually, state actions taken, do NOT admit liability.
- For product_launch / milestone / partnership / counter_competitor: lead with the news + a customer or market benefit, not internal vanity.
- Be specific to the context provided; do not invent product names or numbers.
- Boilerplate is generic — fine to be evergreen.`;
  const user = `Brand: ${brand}
Type: ${kind}
Spokesperson hint: ${spokesperson || 'CEO'}
Quote hint: ${quote_hint || 'none'}
Headline hint: ${headline_hint || 'none'}

Context to base the release on:
${context}

Draft the release now.`;
  const body = JSON.stringify({
    model:'gpt-4o-mini',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    response_format: { type:'json_object' },
    temperature: 0.5, max_tokens: 1600,
  });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try {
        if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d);
        resolve(JSON.parse(j.choices[0].message.content));
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(45000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _templatePress({ kind, brand, context, spokesperson }) {
  const today = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
  const headlines = {
    crisis_response: `${brand} Statement on Recent Coverage`,
    product_launch: `${brand} Announces New Initiative`,
    milestone: `${brand} Marks Major Milestone`,
    counter_competitor: `${brand} Reaffirms Market Leadership`,
    partnership: `${brand} Announces Strategic Partnership`,
    custom: `${brand} Issues Statement`,
  };
  return {
    headline: headlines[kind] || headlines.custom,
    subhead: `Company addresses recent developments and outlines path forward.`,
    dateline: `NEW YORK, NY — ${today}`,
    body: `${brand} today issued the following statement in response to recent developments.\n\n${context.slice(0, 600)}\n\nThe company remains committed to its long-term strategy and to delivering value for customers, partners, and stakeholders.\n\nFurther updates will be provided as appropriate.`,
    quote: { text: `We hear our community and we are taking constructive action to move forward together.`, attribution: `${spokesperson || 'CEO'}, ${brand}` },
    boilerplate: `About ${brand}\n${brand} is a leading company in its category. For more information, visit the company website.`,
    contact: { name: 'Press Office', email: 'press@example.com' },
  };
}

router.post('/generate', async (req, res) => {
  const kind = VALID_KINDS.includes(req.body?.kind) ? req.body.kind : 'custom';
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const context = String(req.body?.context || '').slice(0, 4000);
  const spokesperson = String(req.body?.spokesperson || '').slice(0, 120);
  const quote_hint = String(req.body?.quote_hint || '').slice(0, 400);
  const headline_hint = String(req.body?.headline_hint || '').slice(0, 200);
  if (!brand) return _err(res, 400, 'brand required');
  if (!context) return _err(res, 400, 'context required');

  // Optional: hydrate from a crisis_incident or battle_card — tenant-scoped lookup
  let hydratedContext = context;
  if (_db.hasDb() && (req.body?.from_incident_id || req.body?.from_battle_card_id)) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label:'press_release:hydrate', allowFallback:true });
      if (req.body?.from_incident_id) {
        const r = await _db.getPool().query('SELECT headline, detail FROM crisis_incidents WHERE id=$1 AND tenant_id=$2', [Number(req.body.from_incident_id), tid]);
        if (r.rows[0]) hydratedContext = `Crisis incident: ${r.rows[0].headline}\n${r.rows[0].detail}\n\nAdditional context: ${context}`;
      } else if (req.body?.from_battle_card_id) {
        const r = await _db.getPool().query('SELECT competitor, summary FROM battle_cards WHERE id=$1 AND tenant_id=$2', [Number(req.body.from_battle_card_id), tid]);
        if (r.rows[0]) hydratedContext = `Competitor: ${r.rows[0].competitor}\n${r.rows[0].summary}\n\nAdditional context: ${context}`;
      }
    } catch {}
  }

  let release = await _aiPress({ kind, brand, headline_hint, context: hydratedContext, spokesperson, quote_hint });
  let source = 'openai';
  if (!release) { release = _templatePress({ kind, brand, context: hydratedContext, spokesperson }); source = 'template'; }
  res.json({ ok:true, source, kind, brand, release });
});

module.exports = router;
