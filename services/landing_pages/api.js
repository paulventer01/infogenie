const express = require('express');
const _https = require('https');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function _aiPage({ brand, title, goal, audience, brief, palette }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a senior conversion copywriter and landing-page designer. Draft a complete landing page in strict JSON ONLY:
{"headline":"<H1, 6-10 words, benefit-led>","subhead":"<1 sentence, who it's for + outcome>","hero_cta":"<2-4 word CTA button>","social_proof":"<1 line social proof or stat>","features":[{"title":"<3-5 word title>","body":"<1-2 sentence benefit>","icon":"<single emoji>"}],"how_it_works":[{"step":"<1-3 word step name>","body":"<1 sentence>"}],"testimonials":[{"quote":"<short customer quote>","name":"<first last>","role":"<role, company>"}],"faqs":[{"q":"<question>","a":"<plain-language answer>"}],"final_cta_headline":"<1 sentence>","final_cta_button":"<2-4 word CTA>"}
Rules:
- 4-6 features, 3-4 steps, 2-3 testimonials, 4-6 FAQs.
- Specific, benefit-led copy. No buzzwords, no "leverage", no "synergy".`;
  const user = `Brand: ${brand||'n/a'}\nPage title: ${title}\nGoal: ${goal||'drive signups'}\nAudience: ${audience||'general'}\nBrief: ${brief||'(none)'}\nDraft now.`;
  const body = JSON.stringify({
    model:'gpt-4o-mini',
    messages:[{role:'system',content:sys},{role:'user',content:user}],
    response_format:{type:'json_object'}, temperature:0.7, max_tokens:2500,
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

function _templatePage({ brand, title, goal }) {
  return {
    headline: `${title} — built for ${brand||'modern teams'}`,
    subhead: `The fastest way to ${goal||'achieve your goal'}.`,
    hero_cta: 'Get Started',
    social_proof: 'Trusted by 500+ growing teams.',
    features: [
      { icon:'⚡', title:'Lightning fast', body:'Set up in under 5 minutes — no engineering required.' },
      { icon:'🔒', title:'Secure by default', body:'Bank-grade encryption and audited infrastructure.' },
      { icon:'📈', title:'Built to scale', body:'Handle from 10 to 10 million users without re-platforming.' },
      { icon:'🤝', title:'World-class support', body:'Real humans answering in under 1 hour.' },
    ],
    how_it_works: [
      { step:'Sign up', body:'Create your account in 30 seconds.' },
      { step:'Connect', body:'Plug into your existing stack with one click.' },
      { step:'Launch', body:'Go live and start seeing results today.' },
    ],
    testimonials: [
      { quote:'Game-changer for our team. We saw results within the first week.', name:'Sarah Chen', role:'Head of Growth, Acme' },
      { quote:'The fastest tool we\'ve ever onboarded. Truly.', name:'Marcus Liu', role:'CTO, NorthStar' },
    ],
    faqs: [
      { q:'How long does setup take?', a:'Most teams are live in under 10 minutes.' },
      { q:'Is there a free trial?', a:'Yes — 14 days, no credit card required.' },
      { q:'Can I cancel anytime?', a:'Absolutely. No contracts, cancel with one click.' },
      { q:'Do you offer support?', a:'24/7 chat and email support on every plan.' },
    ],
    final_cta_headline: `Ready to ${goal||'get started'}?`,
    final_cta_button: 'Start Free Trial',
  };
}

function _renderHtml(c, opts={}) {
  const accent = opts.accent || '#14B8A6';
  const dark = opts.dark || '#0A1628';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(c.headline)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${dark};line-height:1.6}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
.hero{padding:80px 0 60px;text-align:center;background:linear-gradient(135deg,${accent}15 0%,${accent}05 100%)}
.hero h1{font-size:3rem;font-weight:800;letter-spacing:-.02em;margin-bottom:16px;line-height:1.15}
.hero p{font-size:1.15rem;color:#475569;max-width:640px;margin:0 auto 28px}
.btn{display:inline-block;background:${accent};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;border:none;cursor:pointer}
.btn:hover{filter:brightness(1.1)}
.proof{margin-top:18px;font-size:0.85rem;color:#64748b}
section{padding:64px 0}
h2{font-size:2rem;font-weight:800;text-align:center;margin-bottom:40px;letter-spacing:-.01em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}
.card{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:24px}
.card .ico{font-size:2rem;margin-bottom:12px}
.card h3{font-size:1.15rem;font-weight:700;margin-bottom:8px}
.card p{color:#475569;font-size:0.95rem}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;counter-reset:step}
.step{position:relative;padding:24px;background:#F8FAFC;border-radius:12px;counter-increment:step}
.step::before{content:counter(step);position:absolute;top:-16px;left:24px;width:32px;height:32px;background:${accent};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800}
.step h3{font-size:1.1rem;margin-bottom:8px;margin-top:8px}
.step p{color:#475569;font-size:0.95rem}
.testimonials{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
.t{background:#fff;border:1px solid #E2E8F0;border-left:4px solid ${accent};border-radius:12px;padding:24px}
.t blockquote{font-size:1rem;color:${dark};margin-bottom:14px;font-style:italic}
.t .author{font-size:0.85rem;color:#64748b}
.t .author strong{color:${dark}}
.faqs details{background:#F8FAFC;border-radius:8px;padding:16px 20px;margin-bottom:10px;cursor:pointer}
.faqs summary{font-weight:700;font-size:1rem}
.faqs details[open]{background:#fff;border:1px solid #E2E8F0}
.faqs p{margin-top:10px;color:#475569}
.final{background:${dark};color:#fff;text-align:center;padding:80px 24px;border-radius:16px;margin:40px auto}
.final h2{color:#fff;margin-bottom:24px}
footer{text-align:center;padding:32px;color:#94a3b8;font-size:0.85rem}
@media (max-width:640px){.hero h1{font-size:2rem}h2{font-size:1.5rem}}
</style></head><body>
<header class="hero"><div class="wrap"><h1>${_esc(c.headline)}</h1><p>${_esc(c.subhead)}</p><a href="#cta" class="btn">${_esc(c.hero_cta)}</a><div class="proof">${_esc(c.social_proof||'')}</div></div></header>
<section><div class="wrap"><h2>Why teams choose us</h2><div class="grid">${(c.features||[]).map(f=>`<div class="card"><div class="ico">${_esc(f.icon||'⭐')}</div><h3>${_esc(f.title)}</h3><p>${_esc(f.body)}</p></div>`).join('')}</div></div></section>
<section style="background:#F8FAFC"><div class="wrap"><h2>How it works</h2><div class="steps">${(c.how_it_works||[]).map(s=>`<div class="step"><h3>${_esc(s.step)}</h3><p>${_esc(s.body)}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><h2>What customers say</h2><div class="testimonials">${(c.testimonials||[]).map(t=>`<div class="t"><blockquote>"${_esc(t.quote)}"</blockquote><div class="author"><strong>${_esc(t.name)}</strong> · ${_esc(t.role)}</div></div>`).join('')}</div></div></section>
<section><div class="wrap"><h2>Questions</h2><div class="faqs">${(c.faqs||[]).map(f=>`<details><summary>${_esc(f.q)}</summary><p>${_esc(f.a)}</p></details>`).join('')}</div></div></section>
<section id="cta"><div class="wrap"><div class="final"><h2>${_esc(c.final_cta_headline)}</h2><a href="#" class="btn">${_esc(c.final_cta_button)}</a></div></div></section>
<footer>© ${new Date().getFullYear()} · Built with InfoGenie</footer>
</body></html>`;
}

router.post('/generate', async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const title = String(req.body?.title || '').trim().slice(0, 140);
  const goal = String(req.body?.goal || '').trim().slice(0, 200);
  const audience = String(req.body?.audience || '').trim().slice(0, 200);
  const brief = String(req.body?.brief || '').slice(0, 2000);
  const accent = /^#[0-9a-f]{6}$/i.test(req.body?.accent || '') ? req.body.accent : '#14B8A6';
  if (!title) return _err(res, 400, 'title required');
  let content = await _aiPage({ brand, title, goal, audience, brief });
  let source = 'openai';
  if (!content) { content = _templatePage({ brand, title, goal }); source = 'template'; }
  const html = _renderHtml(content, { accent });
  if (_db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO landing_pages (brand, title, goal, audience, brief, content, html, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [brand, title, goal, audience, brief, JSON.stringify(content), html, source]);
    } catch (e) { console.warn('[landing-pages] persist failed:', e.message); }
  }
  res.json({ ok:true, source, content, html });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, title, goal, generated_by, created_at FROM landing_pages ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const r = await _db.getPool().query(`SELECT * FROM landing_pages WHERE id=$1`, [id]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, page: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
