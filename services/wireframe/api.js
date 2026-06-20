const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

const PAGE_TYPES = ['landing','pricing','about','product','checkout','dashboard','blog','contact','login','portfolio'];

// ── AI wireframe generator ────────────────────────────────────────────────
async function _generateWireframe(params) {
  const { page_type, description, brand, sections, mobile } = params;
  const key = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
           || process.env.AI_INTEGRATIONS_OPENAI_API_KEY   || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;

  const isAnthropic = !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);

  const system = `You are an expert UX/UI designer. Generate a complete, realistic HTML wireframe page that looks like a real design mockup.

Rules:
- Use only inline styles + a <style> tag — NO external CSS frameworks.
- Wireframe style: clean gray placeholder boxes for images, realistic placeholder text for content areas.
- Wireframe color palette: #F8FAFC background, #E2E8F0 placeholder boxes, #1E293B text, #6366F1 accent/CTA buttons, #475569 secondary text.
- Include realistic section labels (small gray uppercase text showing what the section is).
- Every button should be styled: background #6366F1, color white, border-radius 8px, padding 12px 24px.
- Images/photos: replace with a gray box showing dimensions + label.
- Typography: font-family: Inter, system-ui, sans-serif.
- Include a sticky header/nav bar.
- Make it look like a real professional wireframe a designer would hand to a developer.
- Output COMPLETE HTML including <!DOCTYPE html>, <head>, <body>.
- Max 500 lines of HTML. Prioritize readability and structure over perfection.`;

  const user = `Create a ${mobile ? 'mobile (375px max-width)' : 'desktop (1280px max-width)'} wireframe for a ${page_type} page.
Brand: ${brand || '(unnamed brand)'}
Description: ${description || '(standard ' + page_type + ' page)'}
Sections to include: ${sections || 'auto-determine the right sections for this page type'}

Return ONLY the complete HTML — no markdown code fences, no explanation.`;

  // Use Anthropic if available (better HTML generation), else OpenAI
  if (isAnthropic) {
    const anthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    const body = JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 6000,
      messages: [{ role: 'user', content: system + '\n\n' + user }],
    });
    return new Promise(resolve => {
      const req = _https.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        },
      }, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => {
          try {
            if (r.statusCode !== 200) { console.warn('[wireframe] Anthropic error', r.statusCode); return resolve(null); }
            const j = JSON.parse(d);
            const html = j.content?.[0]?.text || null;
            resolve(html && html.includes('<html') ? html : null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(60000, () => req.destroy());
      req.write(body); req.end();
    });
  }

  // OpenAI fallback
  const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({
    model: 'gpt-5',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.4,
    max_tokens: 5000,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) { console.warn('[wireframe] OpenAI error', r.statusCode); return resolve(null); }
          const html = JSON.parse(d).choices[0].message.content || '';
          // Strip markdown fences if present
          const clean = html.replace(/^```html?\n?/i,'').replace(/```$/,'').trim();
          resolve(clean.includes('<html') ? clean : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Template HTML fallback ────────────────────────────────────────────────
function _templateWireframe(page_type, brand, description) {
  const sections = {
    landing: ['Hero', 'Social Proof / Logos', 'Features (3-col grid)', 'How It Works', 'Testimonials', 'Pricing', 'FAQ', 'CTA Section', 'Footer'],
    pricing: ['Header/Nav', 'Pricing Headline', 'Pricing Cards (3 tiers)', 'Feature Comparison Table', 'FAQ', 'CTA', 'Footer'],
    about:   ['Header/Nav', 'Hero / Mission', 'Our Story', 'Team Grid', 'Values', 'CTA', 'Footer'],
  };
  const secs = (sections[page_type] || sections.landing);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${brand || 'Brand'} — ${page_type} wireframe</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, sans-serif; background: #F8FAFC; color: #1E293B; }
    .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94A3B8; letter-spacing: 0.08em; margin-bottom: 8px; }
    .placeholder { background: #E2E8F0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #94A3B8; font-size: 12px; }
    .btn { background: #6366F1; color: white; border: none; border-radius: 8px; padding: 12px 24px; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-block; }
    .btn-outline { background: white; color: #6366F1; border: 2px solid #6366F1; border-radius: 8px; padding: 11px 23px; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-block; }
    nav { background: white; border-bottom: 1px solid #E2E8F0; padding: 16px 48px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
    .logo { font-weight: 800; font-size: 18px; color: #6366F1; }
    .nav-links { display: flex; gap: 24px; }
    .nav-links span { font-size: 14px; color: #64748B; }
    section { padding: 80px 48px; max-width: 1280px; margin: 0 auto; }
    .section-label { display: inline-block; background: #EEF2FF; color: #6366F1; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 16px; }
    h1 { font-size: 52px; font-weight: 800; line-height: 1.15; margin-bottom: 16px; }
    h2 { font-size: 36px; font-weight: 700; margin-bottom: 12px; }
    p.sub { font-size: 18px; color: #475569; margin-bottom: 32px; max-width: 560px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 24px; }
    .card { background: white; border-radius: 16px; border: 1.5px solid #E2E8F0; padding: 24px; }
  </style>
</head>
<body>
  <nav>
    <div class="logo">${brand || 'Brand'}</div>
    <div class="nav-links">
      <span>Features</span><span>Pricing</span><span>About</span><span>Blog</span>
    </div>
    <div style="display:flex;gap:12px">
      <span class="btn-outline">Log in</span>
      <span class="btn">Get started →</span>
    </div>
  </nav>
  ${secs.map(sec => `
  <section>
    <div class="label">${sec}</div>
    <div class="placeholder" style="height:${sec.toLowerCase().includes('hero') ? '420px' : '240px'};width:100%">[${sec} content area]</div>
  </section>`).join('')}
  <footer style="background:#1E293B;color:#94A3B8;padding:40px 48px;text-align:center;font-size:13px">
    © ${new Date().getFullYear()} ${brand || 'Brand'} · All rights reserved
  </footer>
</body>
</html>`;
}

// ── Routes ────────────────────────────────────────────────────────────────

// POST /generate
router.post('/generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wireframe:generate' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const page_type   = PAGE_TYPES.includes(req.body?.page_type) ? req.body.page_type : 'landing';
  const description = String(req.body?.description || '').slice(0, 500);
  const brand       = String(req.body?.brand       || '').slice(0, 80);
  const sections    = String(req.body?.sections    || '').slice(0, 400);
  const mobile      = !!req.body?.mobile;

  let html = await _generateWireframe({ page_type, description, brand, sections, mobile });
  let source = 'ai';
  if (!html) {
    html = _templateWireframe(page_type, brand, description);
    source = 'template';
  }

  let id = null;
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `INSERT INTO wireframe_runs (tenant_id, page_type, description, html, source) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tid, page_type, description, html, source]);
      id = r.rows[0].id;
    } catch (e) { console.warn('[wireframe] persist failed:', e.message); }
  }

  res.json({ ok: true, id, page_type, brand, html, source });
});

// GET /history
router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wireframe:history' });
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  try {
    const r = await _db.getPool().query(
      `SELECT id, page_type, description, source, created_at FROM wireframe_runs
       WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
    res.json({ ok: true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wireframe:get' });
  if (!_db.hasDb() || !id) return _err(res, 404, 'not found');
  try {
    const r = await _db.getPool().query(
      `SELECT * FROM wireframe_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok: true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
