const express  = require('express');
const _https   = require('https');
const _http    = require('http');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({
    model: opts.model || 'gpt-5-mini',
    messages,
    response_format: opts.json ? { type: 'json_object' } : undefined,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens || 2000,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d); resolve(j.choices[0].message.content);
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

async function _aiPage({ brand, title, goal, audience, brief, adHeadline, adOffer, angle, tenantId }) {
  let brandCtx = '';
  try { const bf = require('../brand_foundation/api'); if (bf.getBrandContextBlock) brandCtx = await bf.getBrandContextBlock(tenantId); } catch {}
  const angleNote = angle ? `\n- ANGLE: write this variant using a "${angle}" persuasion angle — let it shape headline, features, testimonials and FAQ tone.` : '';
  const sys = `${brandCtx ? brandCtx + '\n\n' : ''}You are a senior conversion copywriter. Return strict JSON ONLY:
{"headline":"<H1, 6-10 words, benefit-led>","subhead":"<1 sentence>","hero_cta":"<2-4 word CTA>","social_proof":"<1 line with name/number/outcome>","features":[{"title":"<3-5 words>","body":"<1-2 sentences>","icon":"<emoji>"}],"how_it_works":[{"step":"<1-3 words>","body":"<1 sentence>"}],"testimonials":[{"quote":"<quote with metric>","name":"<name>","role":"<role, co>"}],"faqs":[{"q":"<question>","a":"<answer>"}],"final_cta_headline":"<1 sentence>"}
Rules: 4-6 features, 3-4 steps, 2-3 testimonials, 4-6 FAQs. No buzzwords.${angleNote}
MESSAGE MATCH: if adHeadline/adOffer provided, H1 and CTA must echo them.`;
  const user = `Brand: ${brand||'n/a'}\nTitle: ${title}\nGoal: ${goal||'drive signups'}\nAudience: ${audience||'general'}\nAd headline: ${adHeadline||'(none)'}\nAd offer: ${adOffer||'(none)'}\nBrief: ${brief||'(none)'}\nGenerate now.`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:2500 });
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
      { icon:'📈', title:'Built to scale', body:'From 10 to 10 million users without re-platforming.' },
      { icon:'🤝', title:'World-class support', body:'Real humans answering in under 1 hour.' },
    ],
    how_it_works: [
      { step:'Sign up', body:'Create your account in 30 seconds.' },
      { step:'Connect', body:'Plug in with one click.' },
      { step:'Launch', body:'Go live and start seeing results today.' },
    ],
    testimonials: [
      { quote:'Game-changer. We saw results within the first week.', name:'Sarah Chen', role:'Head of Growth, Acme' },
      { quote:'The fastest tool we\'ve ever onboarded.', name:'Marcus Liu', role:'CTO, NorthStar' },
    ],
    faqs: [
      { q:'How long does setup take?', a:'Most teams are live in under 10 minutes.' },
      { q:'Is there a free trial?', a:'Yes — 14 days, no credit card required.' },
      { q:'Can I cancel anytime?', a:'Absolutely. No contracts, cancel with one click.' },
      { q:'Do you offer support?', a:'24/7 chat and email support on every plan.' },
    ],
    final_cta_headline: `Ready to ${goal||'get started'}?`,
  };
}

function _renderHtml(c, opts = {}) {
  const accent = opts.accent || '#14B8A6';
  const dark   = opts.dark   || '#0A1628';
  const pageId = opts.pageId;
  const variant = opts.variant || 'a';
  const cta    = _esc(c.hero_cta || 'Get Started');
  const ctaBtn = `<a href="#lead-form" class="btn">${cta}</a>`;
  const trackView = pageId ? `<script>fetch('/api/landing-pages/${pageId}/ab-view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variant:'${variant}'})}).catch(()=>{});</script>` : '';
  const leadForm = pageId ? `
<section id="lead-form" style="background:${dark};color:#fff;padding:48px 0">
<div class="wrap" style="max-width:480px;text-align:center">
  <h2 style="color:#fff;font-size:1.5rem;margin-bottom:8px">${_esc(c.final_cta_headline||'Ready to get started?')}</h2>
  <p style="color:rgba(255,255,255,0.7);margin-bottom:24px;font-size:0.95rem">Enter your details and we'll be in touch.</p>
  <form id="igLeadForm" style="display:flex;flex-direction:column;gap:12px" onsubmit="igSubmitLead(event,'${pageId}','${variant}')">
    <input name="name" placeholder="Your name" required style="padding:12px 16px;border-radius:8px;border:none;font-size:0.95rem;background:rgba(255,255,255,0.12);color:#fff;outline:1px solid rgba(255,255,255,0.2)">
    <input name="email" type="email" placeholder="Email address" required style="padding:12px 16px;border-radius:8px;border:none;font-size:0.95rem;background:rgba(255,255,255,0.12);color:#fff;outline:1px solid rgba(255,255,255,0.2)">
    <textarea name="message" placeholder="Anything else? (optional)" rows="2" style="padding:12px 16px;border-radius:8px;border:none;font-size:0.95rem;background:rgba(255,255,255,0.12);color:#fff;resize:none;font-family:inherit;outline:1px solid rgba(255,255,255,0.2)"></textarea>
    <button type="submit" style="padding:14px;background:${accent};border:none;border-radius:8px;font-size:1rem;font-weight:700;color:#fff;cursor:pointer">
      ${cta}
    </button>
    <div id="igLeadMsg" style="font-size:0.85rem;min-height:20px"></div>
  </form>
</div>
</section>
<script>
function igSubmitLead(e,pid,v){
  e.preventDefault();
  const f=e.target,btn=f.querySelector('button[type=submit]'),msg=document.getElementById('igLeadMsg');
  btn.disabled=true;btn.textContent='Sending…';
  const data={name:f.name.value,email:f.email.value,message:f.message.value,variant:v};
  fetch('/api/landing-pages/'+pid+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
    .then(r=>r.json()).then(r=>{
      msg.style.color='#86efac';
      msg.textContent=r.ok?'✓ Thanks! We\'ll be in touch soon.':'⚠ '+( r.error||'submission failed');
      if(r.ok){f.reset();}
    }).catch(()=>{msg.style.color='#fca5a5';msg.textContent='⚠ Network error — please try again.';})
    .finally(()=>{btn.disabled=false;btn.textContent='${cta}';});
}
</script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(c.headline)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${dark};line-height:1.55;font-size:16px}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px}
.hero{padding:40px 0 32px;text-align:center;background:linear-gradient(135deg,${accent}15 0%,${accent}05 100%)}
.hero h1{font-size:1.85rem;font-weight:800;letter-spacing:-.02em;margin-bottom:12px;line-height:1.2}
.hero p{font-size:1rem;color:#475569;margin:0 auto 20px;max-width:640px}
.btn{display:inline-block;width:100%;max-width:340px;background:${accent};color:#fff;padding:16px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:1.05rem;border:none;cursor:pointer;text-align:center}
.btn:hover{filter:brightness(1.1)}
.proof{margin-top:14px;font-size:0.85rem;color:#64748b;padding:0 8px}
.cta-band{text-align:center;padding:24px 0;background:#F8FAFC;border-top:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0}
section{padding:36px 0}
h2{font-size:1.4rem;font-weight:800;text-align:center;margin-bottom:24px;letter-spacing:-.01em}
.grid,.steps,.testimonials{display:grid;grid-template-columns:1fr;gap:16px}
.card{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:20px}
.card .ico{font-size:1.75rem;margin-bottom:10px}
.card h3{font-size:1.05rem;font-weight:700;margin-bottom:6px}
.card p{color:#475569;font-size:0.95rem}
.step{position:relative;padding:20px;background:#F8FAFC;border-radius:12px;counter-increment:step}
.steps{counter-reset:step}
.step::before{content:counter(step);position:absolute;top:-14px;left:20px;width:30px;height:30px;background:${accent};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.95rem}
.step h3{font-size:1.05rem;margin:8px 0 6px}
.step p{color:#475569;font-size:0.95rem}
.t{background:#fff;border:1px solid #E2E8F0;border-left:4px solid ${accent};border-radius:12px;padding:20px}
.t blockquote{font-size:1rem;color:${dark};margin-bottom:12px;font-style:italic}
.t .author{font-size:0.85rem;color:#64748b}
.t .author strong{color:${dark}}
.faqs details{background:#F8FAFC;border-radius:8px;padding:14px 16px;margin-bottom:10px;cursor:pointer}
.faqs summary{font-weight:700;font-size:0.98rem}
.faqs details[open]{background:#fff;border:1px solid #E2E8F0}
.faqs p{margin-top:8px;color:#475569;font-size:0.95rem}
.final{background:${dark};color:#fff;text-align:center;padding:48px 20px;border-radius:16px;margin:24px 0}
.final h2{color:#fff;margin-bottom:18px;font-size:1.35rem}
footer{text-align:center;padding:24px;color:#94a3b8;font-size:0.8rem}
@media (min-width:640px){
  .wrap{padding:0 24px}.hero{padding:64px 0 48px}.hero h1{font-size:2.4rem}.hero p{font-size:1.1rem}
  .btn{width:auto;padding:14px 32px}section{padding:56px 0}h2{font-size:1.75rem;margin-bottom:32px}
  .grid,.steps,.testimonials{grid-template-columns:repeat(2,1fr);gap:20px}.final{padding:64px 24px}
}
@media (min-width:960px){
  .hero{padding:80px 0 60px}.hero h1{font-size:3rem}h2{font-size:2rem;margin-bottom:40px}
  .grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}
  .steps{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}
  .testimonials{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
  .final{padding:80px 24px}.final h2{font-size:1.6rem}
}
input::placeholder,textarea::placeholder{color:rgba(255,255,255,0.5)}
</style></head><body>
${trackView}
<header class="hero"><div class="wrap"><h1>${_esc(c.headline)}</h1><p>${_esc(c.subhead)}</p>${ctaBtn}<div class="proof">${_esc(c.social_proof||'')}</div></div></header>
<section><div class="wrap"><h2>Why teams choose us</h2><div class="grid">${(c.features||[]).map(f=>`<div class="card"><div class="ico">${_esc(f.icon||'⭐')}</div><h3>${_esc(f.title)}</h3><p>${_esc(f.body)}</p></div>`).join('')}</div></div></section>
<div class="cta-band"><div class="wrap">${ctaBtn}</div></div>
<section style="background:#F8FAFC"><div class="wrap"><h2>How it works</h2><div class="steps">${(c.how_it_works||[]).map(s=>`<div class="step"><h3>${_esc(s.step)}</h3><p>${_esc(s.body)}</p></div>`).join('')}</div></div></section>
<div class="cta-band"><div class="wrap">${ctaBtn}</div></div>
<section><div class="wrap"><h2>What customers say</h2><div class="testimonials">${(c.testimonials||[]).map(t=>`<div class="t"><blockquote>"${_esc(t.quote)}"</blockquote><div class="author"><strong>${_esc(t.name)}</strong> · ${_esc(t.role)}</div></div>`).join('')}</div></div></section>
<div class="cta-band"><div class="wrap">${ctaBtn}</div></div>
<section><div class="wrap"><h2>Questions</h2><div class="faqs">${(c.faqs||[]).map(f=>`<details><summary>${_esc(f.q)}</summary><p>${_esc(f.a)}</p></details>`).join('')}</div></div></section>
${leadForm || `<section id="cta"><div class="wrap"><div class="final"><h2>${_esc(c.final_cta_headline)}</h2>${ctaBtn}</div></div></section>`}
<footer>© ${new Date().getFullYear()} · Built with InfoGenie</footer>
</body></html>`;
}

// ── Webhook forward ────────────────────────────────────────────────────────
async function _sendWebhook(url, payload) {
  if (!url) return;
  try {
    const body = JSON.stringify(payload);
    const proto = url.startsWith('https') ? _https : _http;
    await new Promise((resolve) => {
      const u = new URL(url);
      const req = proto.request({ hostname:u.hostname, path:u.pathname+u.search, port:u.port||undefined, method:'POST',
        headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body), 'User-Agent':'InfoGenie/1.0' },
      }, r => { r.resume(); r.on('end', resolve); });
      req.on('error', resolve);
      req.setTimeout(8000, () => req.destroy());
      req.write(body); req.end();
    });
  } catch {}
}

// ── T67 Audience Research Agent ─────────────────────────────────────────────
router.post('/research-audience', async (req, res) => {
  const product  = String(req.body?.product  || '').trim().slice(0, 400);
  const market   = String(req.body?.market   || '').trim().slice(0, 200);
  const goal     = String(req.body?.goal     || '').trim().slice(0, 200);
  if (!product)  return _err(res, 400, 'product required');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:research' });
  const sys = `You are an expert audience strategist. Given a product, return a JSON research brief:
{"segments":[{"name":"<2-4 word persona name>","demographics":"<age, role, situation>","trigger":"<what makes them search for this solution>"}],"pain_points":["<specific, emotional pain — NOT generic>"],"objections":[{"objection":"<real sceptical objection>","rebuttal":"<1-sentence rebuttal>"}],"power_words":["<word that resonates with this audience>"],"hooks":["<5-8 word opening hook or headline angle>"]}
Rules: 3-4 segments, 5-7 pain points, 4-5 objections, 8-12 power words, 5 hooks. Be specific and concrete — no buzzwords.`;
  const user = `Product/service: ${product}\nTarget market: ${market||'general'}\nGoal: ${goal||'drive conversions'}`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:1800 });
  if (!raw) {
    return res.json({ ok:true, source:'template', research:{
      segments:[{name:'Early adopter',demographics:'25-40, tech-savvy professional',trigger:'Searching for a faster solution to save time'},{name:'Budget buyer',demographics:'SMB owner, budget-conscious',trigger:'Looking to cut costs without sacrificing quality'}],
      pain_points:['Wasting hours on manual processes','Current tools are too expensive or complex','Fear of making the wrong investment decision'],
      objections:[{objection:"It's too expensive for my budget",rebuttal:"Our ROI calculator shows most teams save 3x the cost in the first month."},{objection:"I don't have time to switch",rebuttal:"Most teams are up and running in under 10 minutes — no migration needed."}],
      power_words:['instant','proven','effortless','guaranteed','trusted','transform'],
      hooks:['Stop wasting hours on this every week','What if this took 5 minutes instead of 5 hours?','Join 10,000 teams who already made the switch'],
    }});
  }
  try {
    const research = JSON.parse(raw);
    res.json({ ok:true, source:'openai', research });
  } catch { _err(res, 500, 'parse error'); }
});

// ── T69/T70/T71: must come before /:id ─────────────────────────────────────

// ── T70 A/B Variant Generator ────────────────────────────────────────────────
router.post('/ab-variant', async (req, res) => {
  const pageId = Number(req.body?.page_id);
  const angle  = String(req.body?.angle || 'social-proof-heavy').slice(0, 80);
  if (!Number.isFinite(pageId)) return _err(res, 400, 'page_id required');
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:ab_variant' });
  const r = await _db.getPool().query(`SELECT * FROM landing_pages WHERE id=$1 AND tenant_id=$2`, [pageId, tid]);
  const page = r.rows[0];
  if (!page) return _err(res, 404, 'page not found');
  let content = await _aiPage({ brand:page.brand, title:page.title, goal:page.goal, audience:page.audience, brief:page.brief, angle, tenantId:tid });
  let source = 'openai';
  if (!content) { content = _templatePage({ brand:page.brand, title:page.title, goal:page.goal }); source = 'template'; }
  const accent = '#14B8A6';
  const html = _renderHtml(content, { accent, pageId, variant:'b' });
  let variantId = null;
  try {
    const vr = await _db.getPool().query(
      `INSERT INTO landing_page_ab_variants (tenant_id, page_id, variant_name, angle, html, content) VALUES ($1,$2,'B',$3,$4,$5) RETURNING id`,
      [tid, pageId, angle, JSON.stringify(content), JSON.stringify(content)]);
    variantId = vr.rows[0].id;
  } catch (e) { console.warn('[landing-pages] ab_variant persist failed:', e.message); }
  res.json({ ok:true, variant_id:variantId, angle, source, html, content });
});

// ── T70 A/B Results ──────────────────────────────────────────────────────────
router.get('/ab-results/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  if (!Number.isFinite(pageId)) return _err(res, 400, 'bad page_id');
  if (!_db.hasDb()) return res.json({ ok:true, a:{views:0,conversions:0,cvr:0}, b:{views:0,conversions:0,cvr:0} });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:ab_results' });
  try {
    const [pg, vr] = await Promise.all([
      _db.getPool().query(`SELECT views, conversions FROM landing_pages WHERE id=$1 AND tenant_id=$2`, [pageId, tid]),
      _db.getPool().query(`SELECT views, conversions FROM landing_page_ab_variants WHERE page_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 1`, [pageId, tid]),
    ]);
    const a = pg.rows[0] || { views:0, conversions:0 };
    const b = vr.rows[0] || { views:0, conversions:0 };
    const cvr = (x) => x.views > 0 ? (x.conversions / x.views * 100).toFixed(1) : 0;
    res.json({ ok:true, a:{ views:a.views, conversions:a.conversions, cvr:cvr(a) }, b:{ views:b.views, conversions:b.conversions, cvr:cvr(b) } });
  } catch (e) { _err(res, 500, e.message); }
});

// ── T70 Track view ───────────────────────────────────────────────────────────
router.post('/ab-view/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const variant = (req.body?.variant === 'b') ? 'b' : 'a';
  if (!_db.hasDb()) return res.json({ ok:true });
  try {
    if (variant === 'a') {
      await _db.getPool().query(`UPDATE landing_pages SET views = views + 1 WHERE id=$1`, [pageId]);
    } else {
      await _db.getPool().query(`UPDATE landing_page_ab_variants SET views = views + 1 WHERE id=(SELECT id FROM landing_page_ab_variants WHERE page_id=$1 ORDER BY created_at DESC LIMIT 1)`, [pageId]);
    }
  } catch {}
  res.json({ ok:true });
});

// ── T70 Track conversion ─────────────────────────────────────────────────────
router.post('/ab-convert/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const variant = (req.body?.variant === 'b') ? 'b' : 'a';
  if (!_db.hasDb()) return res.json({ ok:true });
  try {
    if (variant === 'a') {
      await _db.getPool().query(`UPDATE landing_pages SET conversions = conversions + 1 WHERE id=$1`, [pageId]);
    } else {
      await _db.getPool().query(`UPDATE landing_page_ab_variants SET conversions = conversions + 1 WHERE id=(SELECT id FROM landing_page_ab_variants WHERE page_id=$1 ORDER BY created_at DESC LIMIT 1)`, [pageId]);
    }
  } catch {}
  res.json({ ok:true });
});

// ── T71 Lead capture (public — no auth, tenant from page row) ────────────────
router.post('/lead/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const name    = String(req.body?.name    || '').slice(0, 200);
  const email   = String(req.body?.email   || '').slice(0, 200);
  const message = String(req.body?.message || '').slice(0, 1000);
  const variant = (req.body?.variant === 'b') ? 'b' : 'a';
  if (!Number.isFinite(pageId)) return _err(res, 400, 'bad page_id');
  if (!email) return _err(res, 400, 'email required');
  if (!_db.hasDb()) return res.json({ ok:true });
  try {
    const pr = await _db.getPool().query(`SELECT tenant_id, webhook_url FROM landing_pages WHERE id=$1`, [pageId]);
    if (!pr.rows[0]) return _err(res, 404, 'page not found');
    const { tenant_id, webhook_url } = pr.rows[0];
    await _db.getPool().query(
      `INSERT INTO landing_page_leads (tenant_id, page_id, name, email, message, variant) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenant_id, pageId, name, email, message, variant]);
    await _db.getPool().query(
      `UPDATE landing_pages SET conversions = conversions + 1 WHERE id=$1`, [pageId]);
    if (webhook_url) await _sendWebhook(webhook_url, { event:'lead_captured', page_id:pageId, name, email, message, variant, timestamp:new Date().toISOString() });
    res.json({ ok:true });
  } catch (e) { console.warn('[landing-pages] lead failed:', e.message); _err(res, 500, 'lead capture failed'); }
});

// ── T71 List leads ────────────────────────────────────────────────────────────
router.get('/leads/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  if (!Number.isFinite(pageId)) return _err(res, 400, 'bad page_id');
  if (!_db.hasDb()) return res.json({ ok:true, leads:[], total:0, today:0 });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:leads' });
  try {
    const r = await _db.getPool().query(
      `SELECT id, name, email, message, variant, created_at FROM landing_page_leads WHERE page_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 200`,
      [pageId, tid]);
    const today = r.rows.filter(l => {
      const d = new Date(l.created_at); const n = new Date();
      return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
    }).length;
    res.json({ ok:true, leads:r.rows, total:r.rowCount, today });
  } catch (e) { _err(res, 500, e.message); }
});

// ── T71 Set webhook ───────────────────────────────────────────────────────────
router.put('/webhook/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  if (!Number.isFinite(pageId)) return _err(res, 400, 'bad page_id');
  const webhookUrl = String(req.body?.webhook_url || '').trim().slice(0, 500);
  if (webhookUrl && !/^https?:\/\/.+/i.test(webhookUrl)) return _err(res, 400, 'webhook_url must be http/https');
  if (!_db.hasDb()) return res.json({ ok:true });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:webhook' });
  try {
    const r = await _db.getPool().query(
      `UPDATE landing_pages SET webhook_url=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id`,
      [webhookUrl || null, pageId, tid]);
    if (!r.rowCount) return _err(res, 404, 'not found');
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Existing routes ────────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const brand      = String(req.body?.brand      || '').trim().slice(0, 80);
  const title      = String(req.body?.title      || '').trim().slice(0, 140);
  const goal       = String(req.body?.goal       || '').trim().slice(0, 200);
  const audience   = String(req.body?.audience   || '').trim().slice(0, 200);
  const brief      = String(req.body?.brief      || '').slice(0, 2000);
  const adHeadline = String(req.body?.adHeadline || '').trim().slice(0, 200);
  const adOffer    = String(req.body?.adOffer    || '').trim().slice(0, 200);
  const accent     = /^#[0-9a-f]{6}$/i.test(req.body?.accent || '') ? req.body.accent : '#14B8A6';
  if (!title) return _err(res, 400, 'title required');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:generate' });
  let content = await _aiPage({ brand, title, goal, audience, brief, adHeadline, adOffer, tenantId:tid });
  let source = 'openai';
  if (!content) { content = _templatePage({ brand, title, goal }); source = 'template'; }
  let id = null;
  if (_db.hasDb()) {
    try {
      const ir = await _db.getPool().query(
        `INSERT INTO landing_pages (tenant_id, brand, title, goal, audience, brief, content, html, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tid, brand, title, goal, audience, brief, JSON.stringify(content), '', source]);
      id = ir.rows[0].id;
    } catch (e) { console.warn('[landing-pages] persist failed:', e.message); }
  }
  const html = _renderHtml(content, { accent, pageId:id, variant:'a' });
  if (id && _db.hasDb()) {
    try { await _db.getPool().query(`UPDATE landing_pages SET html=$1 WHERE id=$2`, [html, id]); } catch {}
  }
  res.json({ ok:true, id, source, content, html });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:history' });
    const r = await _db.getPool().query(
      `SELECT id, brand, title, goal, generated_by, views, conversions, webhook_url, created_at FROM landing_pages WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [tid, limit]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'landing_pages:get' });
    const r = await _db.getPool().query(`SELECT * FROM landing_pages WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    const vr = await _db.getPool().query(`SELECT id, variant_name, angle, views, conversions, created_at FROM landing_page_ab_variants WHERE page_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]);
    res.json({ ok:true, page: r.rows[0], ab_variant: vr.rows[0] || null });
  } catch (e) { _err(res, 500, e.message); }
});

router._renderHtml = _renderHtml;
router._esc = _esc;
module.exports = router;
