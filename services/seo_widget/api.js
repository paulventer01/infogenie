const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { runAudit } = require('../seo_auditor/api');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[seo-widget]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _safeColor(s) { return /^#[0-9A-Fa-f]{6}$/.test(String(s || '')) ? s : '#0066FF'; }
function _safeText(s, max = 80) { return String(s || '').replace(/[<>"'\\]/g, '').slice(0, max); }
function _emailValid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()); }

router.get('/test', (req, res) => res.json({ ok: true, db: _db.hasDb && _db.hasDb() }));

// Manage sites
router.get('/sites', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, sites: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-widget:sites' });
  const r = await _db.getPool().query(`SELECT id, name, accent, cta_text, owner_email, created_at,
      (SELECT COUNT(*) FROM seo_widget_leads l WHERE l.site_id = s.id AND l.tenant_id = $1) AS lead_count
    FROM seo_widget_sites s WHERE s.tenant_id = $1 ORDER BY created_at DESC LIMIT 50`, [tid]);
  res.json({ ok: true, sites: r.rows });
}));

router.post('/sites', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const name = _safeText(req.body?.name, 80) || 'My Site';
  const accent = _safeColor(req.body?.accent);
  const ctaText = _safeText(req.body?.ctaText, 80) || 'Get my free SEO audit';
  const ownerEmail = String(req.body?.ownerEmail || '').trim().slice(0, 200);
  const id = 'sw_' + crypto.randomBytes(8).toString('hex');
  await _db.getPool().query(
    `INSERT INTO seo_widget_sites (id, name, accent, cta_text, owner_email) VALUES ($1,$2,$3,$4,$5)`,
    [id, name, accent, ctaText, ownerEmail || null]
  );
  res.json({ ok: true, id, name, accent, ctaText });
}));

router.delete('/sites/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-widget:site-delete' });
  await _db.getPool().query(`DELETE FROM seo_widget_leads WHERE site_id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  await _db.getPool().query(`DELETE FROM seo_widget_sites WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
}));

router.get('/sites/:id/leads', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, leads: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-widget:leads' });
  const r = await _db.getPool().query(
    `SELECT id, email, url, score, grade, created_at FROM seo_widget_leads WHERE site_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 200`,
    [req.params.id, tid]
  );
  res.json({ ok: true, leads: r.rows });
}));

// Public: serve the embed JS (no auth, CORS *).
// Customers paste <script src="https://yourdomain/api/seo-widget/embed/sw_xxx.js"></script>
// onto their marketing site. The script injects an inline form into <div id="infogenie-seo-widget">
// (or appends to body) that POSTs to /api/seo-widget/audit/sw_xxx.
router.get('/embed/:siteId.js', _safeAsync(async (req, res) => {
  const siteId = req.params.siteId;
  if (!_db.hasDb || !_db.hasDb()) { res.type('application/javascript').send('console.warn("[infogenie] widget unavailable: no DB");'); return; }
  const r = await _db.getPool().query(`SELECT id, name, accent, cta_text FROM seo_widget_sites WHERE id=$1`, [siteId]);
  if (!r.rowCount) { res.type('application/javascript').send(`console.warn("[infogenie] widget ${JSON.stringify(siteId)} not found");`); return; }
  const site = r.rows[0];
  const origin = `${req.protocol}://${req.get('host')}`;
  const cfg = { id: site.id, name: site.name, accent: site.accent, ctaText: site.cta_text, endpoint: `${origin}/api/seo-widget/audit/${site.id}` };
  // Inline JS — IIFE, no globals leaked, works on any host.
  const js = `(function(){
  var CFG = ${JSON.stringify(cfg)};
  function el(tag, attrs, children) { var e = document.createElement(tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (children||[]).forEach(function(c){ if(typeof c==='string') e.appendChild(document.createTextNode(c)); else if(c) e.appendChild(c); }); return e; }
  function mount() {
    var host = document.getElementById('infogenie-seo-widget') || document.body.appendChild(el('div', { id:'infogenie-seo-widget' }));
    host.innerHTML = '';
    host.style.cssText = 'font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:24px auto;padding:24px;background:#fff;border:1px solid #E5E7EB;border-radius:14px;box-shadow:0 4px 20px rgba(0,0,0,.06)';
    var title = el('div',{ style:'font-size:1.25rem;font-weight:800;color:#0A1628;margin-bottom:6px' },['🔍 Free SEO Audit']);
    var sub = el('div',{ style:'font-size:0.86rem;color:#6B7280;margin-bottom:16px' },['Get a 100-point SEO report on any URL — title, meta, H1, alt text, schema, mobile, sitemap and more.']);
    var urlIn = el('input',{ type:'url', placeholder:'https://example.com', style:'width:100%;padding:10px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.92rem;box-sizing:border-box;margin-bottom:10px' });
    var emailIn = el('input',{ type:'email', placeholder:'you@company.com (we\\'ll email the full report)', style:'width:100%;padding:10px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.92rem;box-sizing:border-box;margin-bottom:14px' });
    var btn = el('button',{ type:'button', style:'width:100%;background:'+CFG.accent+';color:#fff;border:none;padding:12px 18px;border-radius:8px;font-size:0.96rem;font-weight:800;cursor:pointer' },[CFG.ctaText]);
    var out = el('div',{ style:'margin-top:14px;font-size:0.88rem' },[]);
    var foot = el('div',{ style:'margin-top:14px;font-size:0.66rem;color:#9CA3AF;text-align:center' },['Powered by InfoGenie']);
    btn.onclick = function() {
      var url = urlIn.value.trim(); var email = emailIn.value.trim();
      if (!url) { out.innerHTML = '<span style="color:#B91C1C">⚠ Enter a URL</span>'; return; }
      if (!/^https?:\\/\\//i.test(url)) url = 'https://' + url;
      out.innerHTML = '<span style="color:#6B7280">⏳ Auditing your site (5-15s)…</span>';
      btn.disabled = true; btn.style.opacity='0.6';
      fetch(CFG.endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: url, email: email }) })
        .then(function(r){ return r.json(); })
        .then(function(j){
          btn.disabled=false; btn.style.opacity='1';
          if (!j.ok) { out.innerHTML = '<span style="color:#B91C1C">'+(j.error||'Audit failed')+'</span>'; return; }
          var t = j.teaser; var color = j.score>=80?'#10B981':j.score>=60?'#F59E0B':'#EF4444';
          out.innerHTML = '<div style="text-align:center;padding:18px;background:#F9FAFB;border-radius:10px"><div style="font-size:3rem;font-weight:800;color:'+color+'">'+j.score+'/100</div><div style="font-size:0.84rem;color:#374151;margin-bottom:8px">Grade '+j.grade+' · '+t.passed+' passed · '+t.warned+' warnings · '+t.failed+' failed</div>'+(j.emailQueued?'<div style="font-size:0.78rem;color:#10B981;font-weight:700">📧 Full report sent to '+(email||'your email')+'</div>':'<div style="font-size:0.78rem;color:#6B7280">Add your email above and re-run for the full PDF report.</div>')+'</div>';
        })
        .catch(function(e){ btn.disabled=false; btn.style.opacity='1'; out.innerHTML='<span style="color:#B91C1C">Network error</span>'; });
    };
    [title, sub, urlIn, emailIn, btn, out, foot].forEach(function(n){ host.appendChild(n); });
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();`;
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/javascript').send(js);
}));

// Public audit endpoint hit by the embed JS. CORS open. Persists every lead.
router.options('/audit/:siteId', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// In-memory rate limiter for the public audit endpoint.
// 5 req per IP per 5min, 30 req per site per 5min — keeps the unauthenticated
// endpoint from being abused as a free crawler / DoS amplifier.
const _rlBuckets = new Map(); // key -> [timestamps]
function _rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (_rlBuckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  _rlBuckets.set(key, arr);
  // Lazy GC — cap map at 10k keys to bound memory.
  if (_rlBuckets.size > 10000) {
    const k0 = _rlBuckets.keys().next().value;
    _rlBuckets.delete(k0);
  }
  return true;
}

router.post('/audit/:siteId', _safeAsync(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const siteId = req.params.siteId;

  // Rate-limit the public, unauthenticated endpoint. Window: 5min.
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || 'anon';
  if (!_rateLimit('ip:' + ip, 5, 5 * 60 * 1000)) return _err(res, 429, 'Too many audit requests from your IP — try again in a few minutes.');
  if (!_rateLimit('site:' + siteId, 30, 5 * 60 * 1000)) return _err(res, 429, 'This widget has hit its 5-minute audit limit — try again shortly.');

  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const site = await _db.getPool().query(`SELECT id FROM seo_widget_sites WHERE id=$1`, [siteId]);
  if (!site.rowCount) return _err(res, 404, 'Widget not found.');

  const url = String(req.body?.url || '').trim();
  const email = String(req.body?.email || '').trim();
  if (!url) return _err(res, 400, 'url required');

  const audit = await runAudit(url);
  if (!audit.ok) return _err(res, 400, audit.error);

  let auditRunId = null;
  try {
    const r = await _db.getPool().query(
      `INSERT INTO seo_audit_runs (url, score, grade, checks, summary) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [audit.url, audit.score, audit.grade, JSON.stringify(audit.checks), JSON.stringify(audit.summary)]
    );
    auditRunId = r.rows[0].id;
  } catch (_) {}

  if (_emailValid(email)) {
    try {
      await _db.getPool().query(
        `INSERT INTO seo_widget_leads (site_id, email, url, score, grade, audit_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [siteId, email, audit.url, audit.score, audit.grade, auditRunId]
      );
    } catch (_) {}
  }

  // Teaser only (no full check details until they give email — gates the lead capture).
  const emailQueued = _emailValid(email);
  res.json({
    ok: true, score: audit.score, grade: audit.grade,
    teaser: { passed: audit.summary.passed, warned: audit.summary.warned, failed: audit.summary.failed },
    emailQueued,
    fullReport: emailQueued ? { url: audit.url, summary: audit.summary, checks: audit.checks } : null
  });
}));

module.exports = router;
