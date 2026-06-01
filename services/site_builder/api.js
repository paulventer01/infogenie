// Site Builder — block-based no-code landing pages.
// Pages are stored as a JSON spec (array of typed blocks) in kv_store and
// rendered to HTML by the public /lp/:slug endpoint. Block types are kept
// intentionally small + AI-friendly so GPT-4o can generate full pages from a
// brief.

const express = require('express');
const OpenAI  = require('openai');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const _kvScope = require('../tenants/kv_scope');

async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

// Pages are keyed by public slug (`lp:<slug>`) so the slug namespace stays
// global — but each page blob carries `tenant_id` so management views only
// surface a workspace's own pages and one workspace can't overwrite another's
// slug. Legacy pages missing tenant_id are backfilled to the default tenant.
async function _migrateLpTenants() {
  if (!_db.hasDb()) return;
  try {
    // Runs at module-load (require time), when the tenants/users schema may not
    // exist yet and getDefaultTenantId() returns null. Poll for the boot window
    // (kv_scope-style retry) so legacy lp:* rows are reliably backfilled rather
    // than skipped on a fast first call.
    const tid = await _kvScope.resolveDefaultTenantWithRetry();
    if (!tid) return;
    await _db.getPool().query(
      `UPDATE kv_store SET value = jsonb_set(value, '{tenant_id}', to_jsonb($1::int))
         WHERE key LIKE 'lp:%' AND (value->>'tenant_id') IS NULL`,
      [tid]
    );
  } catch (e) { console.warn('[site-builder] lp tenant backfill:', e.message); }
}
_migrateLpTenants();

const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || 'dummy' });
const HAS_OPENAI = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _esc(s) { return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function _safeUrl(u) { return /^https?:\/\//i.test(u) ? u : '#'; }

const BLOCK_TYPES = ['hero','features','stats','testimonial','cta','faq','image','richText','search'];
const _scrollTracker = require('../scroll_tracker/api');
const _siteSearch    = require('../site_search/api');

function _renderBlock(b, theme) {
  const c = theme.primary;
  switch (b.type) {
    case 'hero': return `
      <section style="padding:96px 24px;text-align:center;background:linear-gradient(135deg, ${c}10, ${theme.accent || c}05)">
        <div style="max-width:880px;margin:0 auto">
          ${b.eyebrow ? `<div style="text-transform:uppercase;font-size:13px;letter-spacing:.12em;color:${c};font-weight:700;margin-bottom:16px">${_esc(b.eyebrow)}</div>` : ''}
          <h1 style="font-size:56px;line-height:1.1;font-weight:800;margin:0 0 20px;color:${theme.text}">${_esc(b.heading || '')}</h1>
          ${b.subheading ? `<p style="font-size:20px;line-height:1.5;color:${theme.muted};margin:0 0 32px">${_esc(b.subheading)}</p>` : ''}
          ${b.ctaLabel ? `<a href="${_safeUrl(b.ctaUrl || '#')}" style="display:inline-block;background:${c};color:white;padding:14px 36px;border-radius:10px;font-size:17px;font-weight:700;text-decoration:none">${_esc(b.ctaLabel)}</a>` : ''}
        </div>
      </section>`;
    case 'features': return `
      <section style="padding:80px 24px"><div style="max-width:1100px;margin:0 auto">
        ${b.heading ? `<h2 style="text-align:center;font-size:36px;font-weight:800;margin:0 0 12px;color:${theme.text}">${_esc(b.heading)}</h2>` : ''}
        ${b.subheading ? `<p style="text-align:center;color:${theme.muted};margin:0 0 48px">${_esc(b.subheading)}</p>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px">
          ${(b.items || []).map(i => `
            <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:28px">
              ${i.icon ? `<div style="font-size:32px;margin-bottom:12px">${_esc(i.icon)}</div>` : ''}
              <h3 style="font-size:18px;font-weight:700;margin:0 0 8px;color:${theme.text}">${_esc(i.title || '')}</h3>
              <p style="margin:0;color:${theme.muted};line-height:1.5">${_esc(i.body || '')}</p>
            </div>`).join('')}
        </div>
      </div></section>`;
    case 'stats': return `
      <section style="padding:64px 24px;background:${c}"><div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:32px;text-align:center">
        ${(b.items || []).map(i => `
          <div><div style="font-size:48px;font-weight:800;color:white;line-height:1">${_esc(i.value || '')}</div>
          <div style="color:rgba(255,255,255,.85);margin-top:8px">${_esc(i.label || '')}</div></div>`).join('')}
      </div></section>`;
    case 'testimonial': return `
      <section style="padding:80px 24px;background:${theme.surface}"><div style="max-width:760px;margin:0 auto;text-align:center">
        <div style="font-size:48px;color:${c};line-height:1">"</div>
        <p style="font-size:22px;line-height:1.55;color:${theme.text};font-style:italic;margin:0 0 24px">${_esc(b.quote || '')}</p>
        <div style="font-weight:700;color:${theme.text}">${_esc(b.name || '')}</div>
        <div style="color:${theme.muted};font-size:14px">${_esc(b.role || '')}</div>
      </div></section>`;
    case 'cta': return `
      <section style="padding:80px 24px;text-align:center"><div style="max-width:680px;margin:0 auto">
        <h2 style="font-size:36px;font-weight:800;margin:0 0 16px;color:${theme.text}">${_esc(b.heading || '')}</h2>
        ${b.subheading ? `<p style="color:${theme.muted};margin:0 0 28px">${_esc(b.subheading)}</p>` : ''}
        ${b.ctaLabel ? `<a href="${_safeUrl(b.ctaUrl)}" style="display:inline-block;background:${c};color:white;padding:14px 36px;border-radius:10px;font-size:17px;font-weight:700;text-decoration:none">${_esc(b.ctaLabel)}</a>` : ''}
      </div></section>`;
    case 'faq': return `
      <section style="padding:80px 24px"><div style="max-width:760px;margin:0 auto">
        ${b.heading ? `<h2 style="font-size:32px;font-weight:800;margin:0 0 32px;text-align:center;color:${theme.text}">${_esc(b.heading)}</h2>` : ''}
        ${(b.items || []).map(q => `
          <details style="border-bottom:1px solid #E5E7EB;padding:18px 0">
            <summary style="font-weight:700;color:${theme.text};cursor:pointer;font-size:16px">${_esc(q.q || '')}</summary>
            <p style="color:${theme.muted};margin:12px 0 0;line-height:1.55">${_esc(q.a || '')}</p>
          </details>`).join('')}
      </div></section>`;
    case 'image': return `
      <section style="padding:48px 24px;text-align:center"><img src="${_safeUrl(b.url)}" alt="${_esc(b.alt||'')}" style="max-width:100%;height:auto;border-radius:14px"></section>`;
    case 'richText': return `
      <section style="padding:48px 24px"><div style="max-width:760px;margin:0 auto;color:${theme.text};line-height:1.7;font-size:16px">${_esc(b.html || '').replace(/\n/g,'<br>')}</div></section>`;
    case 'search': {
      const items = Array.isArray(b.items) ? b.items : [];
      const cards = items.map(it => {
        const text = `${it.title || ''} ${it.body || ''} ${(it.tags || []).join(' ')}`.trim();
        return `<a href="${_safeUrl(it.url || '#')}" data-search-text="${_esc(text.toLowerCase())}" style="display:block;background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px;text-decoration:none;color:${theme.text}"><div style="font-weight:700;margin-bottom:6px">${_esc(it.title || '')}</div><div style="color:${theme.muted};font-size:14px;line-height:1.5">${_esc(it.body || '')}</div></a>`;
      }).join('');
      return `
      <section style="padding:64px 24px"><div style="max-width:880px;margin:0 auto">
        ${b.heading ? `<h2 style="font-size:32px;font-weight:800;margin:0 0 8px;text-align:center;color:${theme.text}">${_esc(b.heading)}</h2>` : ''}
        ${b.subheading ? `<p style="text-align:center;color:${theme.muted};margin:0 0 24px">${_esc(b.subheading)}</p>` : ''}
        <input id="site-search-input" type="search" placeholder="${_esc(b.placeholder || 'Search…')}" style="width:100%;padding:14px 18px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:16px;margin-bottom:18px;box-sizing:border-box">
        <div id="site-search-results" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${cards}</div>
        <div id="site-search-empty" style="display:none;text-align:center;color:${theme.muted};padding:32px;font-size:15px">No results — try different keywords.</div>
      </div></section>`;
    }
    default: return '';
  }
}

function _renderPage(page) {
  const theme = { primary:'#0066FF', accent:'#00C9C8', text:'#0F172A', muted:'#64748B', surface:'#F8FAFC', ...(page.theme || {}) };
  const blocks = (page.blocks || []).map(b => _renderBlock(b, theme)).join('\n');
  const hasSearch = (page.blocks || []).some(b => b.type === 'search');
  const tracking = `${_scrollTracker.snippet('lp', page.slug || '')}${hasSearch ? _siteSearch.snippet(page.slug || '') : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(page.title || 'Landing Page')}</title>
<meta name="description" content="${_esc(page.description || '')}">
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:white;color:${theme.text}}</style>
</head><body>${blocks}${tracking}</body></html>`;
}

router.get('/pages', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, pages: [] });
  const tid = await _tid(req, 'site-builder:pages');
  if (tid == null) return res.json({ ok:true, pages: [] });
  const r = await _db.getPool().query(
    `SELECT key, value FROM kv_store WHERE key LIKE 'lp:%' AND (value->>'tenant_id')::int = $1 ORDER BY key DESC LIMIT 100`,
    [tid]
  );
  res.json({ ok:true, pages: r.rows.map(row => ({ slug: row.key.replace('lp:',''), title: row.value?.title, blockCount: row.value?.blocks?.length || 0, updatedAt: row.value?.updatedAt })) });
});

router.get('/page/:slug', async (req, res) => {
  const tid = await _tid(req, 'site-builder:page-get');
  const page = await _db.kvGet(`lp:${req.params.slug}`, null);
  if (!page) return _err(res, 404, 'Not found');
  if (tid == null || page.tenant_id !== tid) return _err(res, 404, 'Not found');
  res.json({ ok:true, page });
});

router.post('/page/:slug', async (req, res) => {
  const tid = await _tid(req, 'site-builder:page-save');
  if (tid == null) return _err(res, 400, 'no_tenant');
  // Reject overwriting a slug owned by another workspace (slug squatting).
  const existing = await _db.kvGet(`lp:${req.params.slug}`, null);
  if (existing && existing.tenant_id != null && existing.tenant_id !== tid) {
    return _err(res, 409, 'slug already in use');
  }
  const page = { ...(req.body || {}), slug: req.params.slug, tenant_id: tid, updatedAt: new Date().toISOString() };
  await _db.kvSet(`lp:${req.params.slug}`, page);
  res.json({ ok:true, page });
});

// AI: generate a complete page from a brief
router.post('/ai-generate', async (req, res) => {
  const { brand, valueProp, audience = '', primaryColor = '#0066FF', slug } = req.body || {};
  if (!brand || !valueProp) return _err(res, 400, 'brand and valueProp required');
  const tid = await _tid(req, 'site-builder:ai-generate');
  if (tid == null) return _err(res, 400, 'no_tenant');
  // Reject overwriting a slug owned by another workspace before doing any work
  // (slug squatting guard, mirrors POST /page/:slug). Only relevant when the
  // caller supplies a slug — the auto-generated fallback is collision-free.
  if (slug) {
    const existing = await _db.kvGet(`lp:${slug}`, null);
    if (existing && existing.tenant_id != null && existing.tenant_id !== tid) {
      return _err(res, 409, 'slug already in use');
    }
  }
  if (!HAS_OPENAI) return _err(res, 500, 'OpenAI key not configured');
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini', response_format:{ type:'json_object' }, max_tokens: 2000,
      messages: [
        { role:'system', content:`You build conversion-optimised landing pages. Return strict JSON matching this schema:
{
  "title": "...", "description": "SEO meta description",
  "theme": { "primary": "#hex" },
  "blocks": [
    { "type": "hero", "eyebrow":"...", "heading":"...", "subheading":"...", "ctaLabel":"...", "ctaUrl":"#" },
    { "type": "features", "heading":"...", "subheading":"...", "items":[{"icon":"⚡","title":"...","body":"..."}] },
    { "type": "stats", "items":[{"value":"10x","label":"..."}] },
    { "type": "testimonial", "quote":"...", "name":"...", "role":"..." },
    { "type": "faq", "heading":"...", "items":[{"q":"...","a":"..."}] },
    { "type": "cta", "heading":"...", "subheading":"...", "ctaLabel":"...", "ctaUrl":"#" }
  ]
}
Order: hero → features (3-4 items) → stats (3-4) → testimonial → faq (4-5) → cta.` },
        { role:'user', content:`Brand: ${brand}\nValue prop: ${valueProp}\nAudience: ${audience || 'general'}\nPrimary color: ${primaryColor}` }
      ]
    });
    const page = JSON.parse(r.choices[0].message.content);
    page.theme = { ...(page.theme || {}), primary: primaryColor };
    page.slug = slug || ('lp_' + Date.now().toString(36));
    page.tenant_id = tid;
    page.updatedAt = new Date().toISOString();
    await _db.kvSet(`lp:${page.slug}`, page);
    res.json({ ok:true, slug: page.slug, page });
  } catch (e) { _err(res, 500, e.message); }
});

// Public renderer
router.get('/render/:slug', async (req, res) => {
  const page = await _db.kvGet(`lp:${req.params.slug}`, null);
  if (!page) return res.status(404).send('<h1>Page not found</h1>');
  res.set('Content-Type', 'text/html; charset=utf-8').send(_renderPage(page));
});

module.exports = router;
module.exports._migrateLpTenants = _migrateLpTenants;
