// Link-in-bio + embedded checkout (Stripe).
// Each "bio page" is a slug (e.g. /bio/yourname) showing: avatar/headline +
// list of links + list of products. Products use Stripe Checkout Sessions for
// payment. Lead capture (email-only opt-in) is also supported and persists to
// the linksell_leads table for re-engagement via Drip.

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _scrollTracker = require('../scroll_tracker/api');
const { addTenantIdColumn } = require('../tenants/migration');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _esc(s) { return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function _safeUrl(u) { return /^https?:\/\//i.test(u) ? u : '#'; }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}
const HAS_STRIPE = !!(process.env.STRIPE_SECRET_KEY && !/^_DUMMY/i.test(process.env.STRIPE_SECRET_KEY));

async function ensureLinkSellSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS linksell_leads (
      id SERIAL PRIMARY KEY, page_slug TEXT, email TEXT, name TEXT,
      source TEXT DEFAULT 'optin', created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS linksell_orders (
      id SERIAL PRIMARY KEY, page_slug TEXT, product_id TEXT, customer_email TEXT,
      amount_cents INT, currency TEXT, stripe_session_id TEXT UNIQUE, status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now(), paid_at TIMESTAMPTZ
    );
  `);
  for (const t of ['linksell_leads', 'linksell_orders']) {
    try { await addTenantIdColumn(t); }
    catch (e) { console.error(`[linksell] addTenantIdColumn ${t}:`, e.message); }
  }
}
ensureLinkSellSchema().catch(e => console.error('[linksell] schema:', e.message));

const DEFAULT_PAGE = {
  slug: 'demo',
  title: 'Your Name',
  bio: 'One-line bio.',
  avatarUrl: '',
  primaryColor: '#0066FF',
  links: [],
  products: [],
  emailOptin: { enabled:true, headline:'Join the list', cta:'Get updates' },
};

// Bio kv is keyed publicly by slug, but the blob carries tenant_id so we can
// reject slug-squatting and stamp the right tenant onto leads/orders.
const _bioKey = slug => `bio:${slug}`;

router.get('/page/:slug', async (req, res) => {
  const page = await _db.kvGet(_bioKey(req.params.slug), null);
  // Authenticated dashboard reads must not leak another tenant's bio config.
  // Public /render/:slug stays open (it's the public-facing page). Blob carries
  // tenant_id; if caller resolves to a tenant and the blob is stamped to a
  // different one, return 404 (don't disclose existence).
  if (page && Number.isFinite(+page.tenant_id)) {
    const tid = await _tid(req, 'linksell:get-page');
    if (+page.tenant_id !== tid) return _err(res, 404, 'page not found');
  }
  res.json({ ok:true, page: page || { ...DEFAULT_PAGE, slug: req.params.slug } });
});

router.post('/page/:slug', async (req, res) => {
  const tid = await _tid(req, 'linksell:save-page');
  const existing = await _db.kvGet(_bioKey(req.params.slug), null);
  if (existing && Number.isFinite(+existing.tenant_id) && +existing.tenant_id !== tid) {
    return _err(res, 409, 'Slug already in use by another workspace — pick a different slug.');
  }
  const page = { ...DEFAULT_PAGE, ...(req.body || {}), slug: req.params.slug, tenant_id: tid, updatedAt: new Date().toISOString() };
  await _db.kvSet(_bioKey(req.params.slug), page);
  res.json({ ok:true, page });
});

router.get('/pages', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, pages: [] });
  const tid = await _tid(req, 'linksell:pages');
  // Filter by tenant_id stored inside the blob. Legacy un-stamped pages
  // belong to platform tenant 1.
  const r = await _db.getPool().query(`SELECT key, value FROM kv_store WHERE key LIKE 'bio:%' ORDER BY key DESC LIMIT 500`);
  const pages = r.rows
    .map(row => ({ slug: row.key.replace('bio:',''), val: row.value }))
    .filter(p => {
      const blobTid = Number.isFinite(+p.val?.tenant_id) ? +p.val.tenant_id : 1;
      return blobTid === tid;
    })
    .slice(0, 100)
    .map(p => ({ slug: p.slug, title: p.val?.title, productCount: (p.val?.products||[]).length, linkCount: (p.val?.links||[]).length }));
  res.json({ ok:true, pages });
});

// ── Email opt-in (public) ────────────────────────────────────────────────────
router.post('/optin/:slug', async (req, res) => {
  const { email, name = '' } = req.body || {};
  if (!email) return _err(res, 400, 'email required');
  if (!_db.hasDb()) return _err(res, 503, 'No DB');
  // Public endpoint — derive tenant from the page blob's stored tenant_id.
  const page = await _db.kvGet(_bioKey(req.params.slug), null);
  const ownerTid = Number.isFinite(+page?.tenant_id) ? +page.tenant_id : 1;
  await _db.getPool().query(
    `INSERT INTO linksell_leads (tenant_id, page_slug, email, name) VALUES ($1,$2,$3,$4)`,
    [ownerTid, req.params.slug, email, name]
  );
  res.json({ ok:true });
});

router.get('/leads/:slug', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, leads: [] });
  const tid = await _tid(req, 'linksell:leads');
  const r = await _db.getPool().query(
    `SELECT id, email, name, source, created_at FROM linksell_leads WHERE page_slug=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 500`,
    [req.params.slug, tid]
  );
  res.json({ ok:true, leads: r.rows });
});

// ── Stripe Checkout (public — caller is the buyer's browser) ────────────────
router.post('/checkout/:slug', async (req, res) => {
  if (!HAS_STRIPE) return _err(res, 400, 'Stripe not configured — add STRIPE_SECRET_KEY to enable checkout.');
  const { productId, customerEmail } = req.body || {};
  const page = await _db.kvGet(_bioKey(req.params.slug), null);
  if (!page) return _err(res, 404, 'Page not found');
  const product = (page.products || []).find(p => p.id === productId);
  if (!product) return _err(res, 404, 'Product not found');
  const ownerTid = Number.isFinite(+page.tenant_id) ? +page.tenant_id : 1;
  const baseUrl = process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG || 'app'}.replit.app`;
  try {
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', `${baseUrl}/bio/${req.params.slug}?paid=1&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url',  `${baseUrl}/bio/${req.params.slug}?cancelled=1`);
    if (customerEmail) params.append('customer_email', customerEmail);
    params.append('line_items[0][price_data][currency]', String(product.currency || 'usd').toLowerCase());
    params.append('line_items[0][price_data][unit_amount]', String(product.priceCents || 0));
    params.append('line_items[0][price_data][product_data][name]', product.name);
    if (product.description) params.append('line_items[0][price_data][product_data][description]', product.description);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[page_slug]', req.params.slug);
    params.append('metadata[product_id]', productId);
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type':'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error?.message || `Stripe ${r.status}`);
    if (_db.hasDb()) {
      await _db.getPool().query(
        `INSERT INTO linksell_orders (tenant_id, page_slug, product_id, customer_email, amount_cents, currency, stripe_session_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ownerTid, req.params.slug, productId, customerEmail || null, product.priceCents || 0, product.currency || 'usd', j.id]
      );
    }
    res.json({ ok:true, checkoutUrl: j.url, sessionId: j.id });
  } catch (e) { _err(res, 500, e.message); }
});

// Stripe webhook — verifies Stripe-Signature header per Stripe's spec.
const _crypto = require('crypto');
function _verifyStripeSig(rawBuf, header, secret) {
  if (!header || !secret) return false;
  const parts = String(header).split(',').reduce((acc, p) => { const [k,v] = p.split('='); if (k && v) (acc[k.trim()]=acc[k.trim()]||[]).push(v.trim()); return acc; }, {});
  const ts = (parts.t || [])[0]; const sigs = parts.v1 || [];
  if (!ts || !sigs.length) return false;
  if (Math.abs(Date.now()/1000 - Number(ts)) > 300) return false;
  const expected = _crypto.createHmac('sha256', secret).update(`${ts}.${rawBuf.toString('utf8')}`).digest('hex');
  return sigs.some(s => { try { return _crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)); } catch { return false; } });
}
// Webhook is unauthenticated (Stripe signs it). UPDATE by stripe_session_id
// alone is safe — that ID is globally unique and the row was created with a
// tenant_id already; we're only flipping its status.
router.post('/stripe-webhook', express.raw({ type:'*/*', limit:'1mb' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    if (!_verifyStripeSig(req.body, req.headers['stripe-signature'], secret)) {
      console.warn('[linksell stripe-webhook] signature verify failed'); return res.status(401).end();
    }
  } else {
    if (process.env.NODE_ENV === 'production') { console.warn('[linksell stripe-webhook] STRIPE_WEBHOOK_SECRET not set — rejecting'); return res.status(503).end(); }
  }
  res.status(200).end();
  try {
    const ev = JSON.parse(req.body.toString('utf8') || '{}');
    if (ev?.type === 'checkout.session.completed') {
      const sid = ev.data?.object?.id;
      if (sid && _db.hasDb()) {
        await _db.getPool().query(`UPDATE linksell_orders SET status='paid', paid_at=now() WHERE stripe_session_id=$1`, [sid]);
      }
    }
  } catch (e) { console.error('[linksell stripe-webhook]', e.message); }
});

router.get('/orders/:slug', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, orders: [] });
  const tid = await _tid(req, 'linksell:orders');
  const r = await _db.getPool().query(
    `SELECT id, product_id, customer_email, amount_cents, currency, status, created_at, paid_at FROM linksell_orders WHERE page_slug=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 200`,
    [req.params.slug, tid]
  );
  res.json({ ok:true, orders: r.rows });
});

// ── Public renderer at /bio/:slug ────────────────────────────────────────────
function _renderBio(page) {
  const c = _esc(page.primaryColor || '#0066FF');
  const links = (page.links || []).map(l => `
    <a href="${_safeUrl(l.url)}" target="_blank" rel="noopener" class="ls-item" data-search-label="${_esc((l.label || '') + ' ' + (l.url || ''))}" style="display:flex;align-items:center;gap:12px;padding:16px 20px;background:white;border:1.5px solid #E5E7EB;border-radius:14px;text-decoration:none;color:#0F172A;font-weight:600;margin-bottom:12px;transition:all .15s" onmouseover="this.style.borderColor='${c}';this.style.transform='translateY(-1px)'" onmouseout="this.style.borderColor='#E5E7EB';this.style.transform='translateY(0)'">
      ${l.icon ? `<span style="font-size:20px">${_esc(l.icon)}</span>` : ''}
      <span style="flex:1">${_esc(l.label || '')}</span>
      <span style="color:${c}">→</span>
    </a>`).join('');
  const products = (page.products || []).map(p => `
    <div class="ls-item" data-search-label="${_esc((p.name || '') + ' ' + (p.description || ''))}" style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:12px">
      ${p.imageUrl ? `<img src="${_safeUrl(p.imageUrl)}" alt="${_esc(p.name)}" style="width:100%;height:160px;object-fit:cover;border-radius:10px;margin-bottom:12px">` : ''}
      <div style="font-weight:700;color:#0F172A;margin-bottom:4px">${_esc(p.name)}</div>
      ${p.description ? `<div style="font-size:13px;color:#64748B;margin-bottom:12px">${_esc(p.description)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-weight:800;color:${c};font-size:18px">${(p.currency||'USD').toUpperCase()} ${(p.priceCents/100).toFixed(2)}</div>
        <button onclick="buy('${_esc(p.id)}')" style="margin-left:auto;background:${c};color:white;border:0;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">Buy</button>
      </div>
    </div>`).join('');
  const optin = page.emailOptin?.enabled ? `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:20px;margin-top:24px;margin-bottom:12px">
      <div style="font-weight:700;color:#0F172A;margin-bottom:10px">${_esc(page.emailOptin.headline || 'Join the list')}</div>
      <form onsubmit="event.preventDefault();optin(this)" style="display:flex;gap:8px">
        <input name="email" type="email" required placeholder="you@example.com" style="flex:1;padding:10px 14px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:14px">
        <button type="submit" style="background:${c};color:white;border:0;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">${_esc(page.emailOptin.cta || 'Subscribe')}</button>
      </form>
    </div>` : '';

  const itemCount = (page.links || []).length + (page.products || []).length;
  const searchBar = itemCount > 3 ? `
    <div style="margin-bottom:20px">
      <div style="position:relative">
        <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none">🔍</span>
        <input id="ls-search" type="search" placeholder="Search…" autocomplete="off" oninput="_lsFilter(this.value)"
          style="width:100%;box-sizing:border-box;padding:12px 14px 12px 38px;border:1.5px solid #E5E7EB;border-radius:12px;font-size:14px;background:white;outline:none;transition:border-color .15s"
          onfocus="this.style.borderColor='${c}'" onblur="this.style.borderColor='#E5E7EB'">
      </div>
      <div id="ls-no-results" style="display:none;text-align:center;color:#94A3B8;font-size:14px;padding:20px 0">No results found</div>
    </div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${_esc(page.title || 'Link in bio')}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(180deg,${c}15,${c}02 40%);min-height:100vh;color:#0F172A}#ls-search::placeholder{color:#94A3B8}</style>
</head><body>
<div style="max-width:520px;margin:0 auto;padding:48px 20px 64px">
  ${page.avatarUrl ? `<img src="${_safeUrl(page.avatarUrl)}" alt="" style="width:96px;height:96px;border-radius:50%;display:block;margin:0 auto 16px;border:3px solid white;box-shadow:0 4px 16px rgba(0,0,0,.08)">` : ''}
  <h1 style="text-align:center;font-size:24px;font-weight:800;margin:0 0 6px">${_esc(page.title || '')}</h1>
  <p style="text-align:center;color:#64748B;margin:0 0 32px">${_esc(page.bio || '')}</p>
  ${searchBar}
  ${links}
  ${products ? `<h2 id="ls-shop-header" style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#64748B;margin:32px 0 12px">Shop</h2>${products}` : ''}
  ${optin}
</div>
<script>
function _lsFilter(q) {
  var term = (q || '').trim().toLowerCase();
  var items = document.querySelectorAll('.ls-item');
  var visible = 0;
  items.forEach(function(el) {
    var label = (el.dataset.searchLabel || '').toLowerCase();
    var show = !term || label.indexOf(term) !== -1;
    el.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  var noRes = document.getElementById('ls-no-results');
  if (noRes) noRes.style.display = (term && visible === 0) ? 'block' : 'none';
  var shopHdr = document.getElementById('ls-shop-header');
  if (shopHdr) shopHdr.style.display = (term && visible === 0) ? 'none' : '';
}
async function buy(id) {
  const email = prompt('Your email (optional):') || '';
  const r = await fetch('/api/linksell/checkout/${_esc(page.slug)}', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ productId:id, customerEmail: email }) });
  const j = await r.json();
  if (j.checkoutUrl) location.href = j.checkoutUrl; else alert(j.error || 'Checkout unavailable');
}
async function optin(form) {
  const email = form.email.value;
  const r = await fetch('/api/linksell/optin/${_esc(page.slug)}', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
  if ((await r.json()).ok) { form.innerHTML = '<div style="color:#059669;font-weight:600;text-align:center;width:100%">✓ Subscribed!</div>'; }
}
</script>
${_scrollTracker.snippet('bio', page.slug || '')}
</body></html>`;
}

router.get('/render/:slug', async (req, res) => {
  const page = await _db.kvGet(_bioKey(req.params.slug), null) || { ...DEFAULT_PAGE, slug: req.params.slug };
  res.set('Content-Type', 'text/html; charset=utf-8').send(_renderBio(page));
});

module.exports = router;
