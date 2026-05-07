const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[chatbot]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

const TONES = ['friendly','professional','playful','concise','enthusiastic'];

async function _generate({ brand, description, tone, audience }) {
  if (!_hasOpenAI()) return null;
  const sys = 'You design website chatbots. Generate concise, helpful FAQ content. Strict JSON only.';
  const user = `Brand: ${brand}
Description: ${description || '(not provided)'}
Audience: ${audience || 'general website visitors'}
Tone: ${tone}

Generate a website chatbot config. Reply strict JSON:
{
  "greeting": "first message the bot sends (1-2 short sentences, ${tone} tone, mentions brand)",
  "faq": [
    {"q":"common visitor question","a":"clear concise answer (1-3 sentences)","kind":"pricing|product|support|company|onboarding|integration|general"}
  ],
  "fallback": "message when no FAQ matches (offers human handoff or lead capture)",
  "lead_fields": [
    {"key":"name","label":"Your name","required":true},
    {"key":"email","label":"Email","required":true},
    {"key":"company","label":"Company","required":false}
  ],
  "suggested_quick_replies": ["Pricing","Book demo","Talk to human"]
}

Generate 8-15 FAQ entries based on the description. Cover pricing, product, support, onboarding at minimum. Never invent specific numbers, plan names or features that contradict the description.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-4o-mini', temperature:0.4, max_tokens:2500,
      response_format:{ type:'json_object' },
      messages:[{ role:'system', content: sys }, { role:'user', content: user }]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI(), db: _db.hasDb && _db.hasDb(), tones: TONES }));

router.post('/generate', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 200);
  const description = String(req.body?.description || '').trim().slice(0, 1500);
  const audience = String(req.body?.audience || '').trim().slice(0, 300);
  const tone = String(req.body?.tone || 'friendly').toLowerCase();
  const accent = (function(c) { c = String(c || '#6366F1').trim(); return /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#6366F1'; })(req.body?.accent);
  if (!brand) return _err(res, 400, 'brand required');
  if (!TONES.includes(tone)) return _err(res, 400, 'tone must be one of: ' + TONES.join(', '));
  if (!_hasOpenAI()) return _err(res, 400, 'OPENAI_API_KEY required');
  const r = await _generate({ brand, description, tone, audience });
  if (!r || !Array.isArray(r.faq)) return _err(res, 502, 'AI generation failed');

  const greeting = String(r.greeting || `Hi! I'm the ${brand} assistant. How can I help?`).slice(0, 500);
  const faq = r.faq.slice(0, 20).map(f => ({
    q: String(f?.q || '').slice(0, 240),
    a: String(f?.a || '').slice(0, 800),
    kind: String(f?.kind || 'general').slice(0, 30)
  })).filter(f => f.q && f.a);
  const fallback = String(r.fallback || 'I don\'t have an answer for that — would you like to leave your details so the team can get back to you?').slice(0, 500);
  const leadFields = (Array.isArray(r.lead_fields) ? r.lead_fields : [{key:'name',label:'Your name',required:true},{key:'email',label:'Email',required:true}])
    .slice(0, 6).map(lf => ({
      key: String(lf?.key || '').slice(0, 30).replace(/[^a-z0-9_]/gi, ''),
      label: String(lf?.label || '').slice(0, 60),
      required: !!lf?.required
    })).filter(lf => lf.key && lf.label);
  const quickReplies = (Array.isArray(r.suggested_quick_replies) ? r.suggested_quick_replies : []).slice(0, 6).map(s => String(s).slice(0, 40));

  let id = null;
  if (_db.hasDb && _db.hasDb()) {
    try {
      const ins = await _db.getPool().query(
        `INSERT INTO chatbot_configs (brand, greeting, tone, faq, fallback, lead_fields, accent) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [brand, greeting, tone, JSON.stringify(faq), fallback, JSON.stringify(leadFields), accent]
      );
      id = ins.rows[0].id;
    } catch(_) {}
  }
  res.json({ ok:true, id, brand, tone, accent, greeting, faq, fallback, lead_fields: leadFields, quick_replies: quickReplies });
}));

router.get('/configs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, configs:[] });
  const r = await _db.getPool().query('SELECT id, brand, tone, greeting, accent, created_at FROM chatbot_configs ORDER BY created_at DESC LIMIT 30');
  res.json({ ok:true, configs: r.rows });
}));

router.get('/configs/:id', _safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'invalid id');
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 404, 'not found');
  const r = await _db.getPool().query('SELECT * FROM chatbot_configs WHERE id=$1', [id]);
  if (!r.rows.length) return _err(res, 404, 'not found');
  res.json({ ok:true, config: r.rows[0] });
}));

module.exports = router;
