// Tier 27 — Conversion Boosters
// Two paste-once embeddable widgets for any external marketing site:
//   1. Social Proof popup — rotating "Sarah from Cape Town just signed up" toasts
//   2. Exit Intent popup — captures email when mouse leaves viewport
// Pattern mirrors T23 SEO Widget exactly: public embed loader + public event/lead
// endpoints with rate limiting, frontend admin for site management.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[conv-boosters]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _safeColor(s, fallback) { return /^#[0-9A-Fa-f]{6}$/.test(String(s || '')) ? s : fallback; }
function _safeText(s, max) { return String(s == null ? '' : s).replace(/[<>"'\\]/g, '').slice(0, max); }
function _emailValid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()); }
function _ipHash(ip) { return crypto.createHash('sha256').update(String(ip || 'anon')).digest('hex').slice(0, 16); }
// Returns the unspoofable client identifier for rate-limiting. server.js sets
// `trust proxy: true`, which makes req.ip equal to whatever the client puts in
// X-Forwarded-For — fully attacker-controlled. req.socket.remoteAddress is the
// actual TCP peer and cannot be forged from outside. Honest users behind a
// single corporate NAT will share a bucket; that's acceptable for a 5/5min
// public lead-capture limit and is the same trade-off real WAFs make.
function _rlKey(req) {
  return crypto.createHash('sha256').update(String((req.socket && req.socket.remoteAddress) || 'anon')).digest('hex').slice(0, 24);
}

const TYPES = ['social_proof', 'exit_intent'];

// In-memory rate limiter (5 events per IP per 5 min, 60 per widget per 5 min).
const _rl = new Map();
function _rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (_rl.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now); _rl.set(key, arr);
  if (_rl.size > 10000) { const k0 = _rl.keys().next().value; _rl.delete(k0); }
  return true;
}

// Default settings per widget type. Frontend uses these as form defaults.
const DEFAULTS = {
  social_proof: {
    position: 'bottom-left',          // bottom-left | bottom-right | top-left | top-right
    intervalSeconds: 12,
    displaySeconds: 5,
    accent: '#10B981',
    items: [                          // manual feed; can be overridden per widget
      { name: 'Sarah', location: 'Cape Town', action: 'just signed up', when: '2 min ago' },
      { name: 'James', location: 'London',    action: 'started a trial', when: '6 min ago' },
      { name: 'Aisha', location: 'Lagos',     action: 'booked a demo',   when: '12 min ago' },
    ],
  },
  exit_intent: {
    headline: 'Wait — before you go!',
    subheadline: 'Get our free guide and 10% off your first month.',
    ctaText: 'Send me the guide',
    accent: '#0066FF',
    dismissCookieDays: 7,
    redirectUrl: '',
  },
};

function _normaliseSettings(type, raw) {
  const d = DEFAULTS[type];
  const r = (raw && typeof raw === 'object') ? raw : {};
  if (type === 'social_proof') {
    const positions = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
    return {
      position: positions.includes(r.position) ? r.position : d.position,
      intervalSeconds: Math.max(4, Math.min(120, parseInt(r.intervalSeconds, 10) || d.intervalSeconds)),
      displaySeconds: Math.max(2, Math.min(30, parseInt(r.displaySeconds, 10) || d.displaySeconds)),
      accent: _safeColor(r.accent, d.accent),
      items: Array.isArray(r.items) && r.items.length
        ? r.items.slice(0, 50).map(i => ({
            name: _safeText(i?.name, 60) || 'Someone',
            location: _safeText(i?.location, 80) || '',
            action: _safeText(i?.action, 120) || 'just signed up',
            when: _safeText(i?.when, 40) || 'recently',
          }))
        : d.items,
    };
  }
  // exit_intent
  return {
    headline: _safeText(r.headline, 120) || d.headline,
    subheadline: _safeText(r.subheadline, 240) || d.subheadline,
    ctaText: _safeText(r.ctaText, 60) || d.ctaText,
    accent: _safeColor(r.accent, d.accent),
    dismissCookieDays: Math.max(0, Math.min(365, parseInt(r.dismissCookieDays, 10) || d.dismissCookieDays)),
    redirectUrl: (() => {
      const u = String(r.redirectUrl || '').trim();
      try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
    })(),
  };
}

router.get('/test', (req, res) => res.json({ ok: true, tier: 27, types: TYPES, db: _db.hasDb && _db.hasDb() }));
router.get('/defaults', (req, res) => res.json({ ok: true, defaults: DEFAULTS }));

// ── Admin: manage widgets ──────────────────────────────────────────────────
router.get('/widgets', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, widgets: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'cb:widgets:list' });
  const r = await _db.getPool().query(
    `SELECT w.id, w.type, w.name, w.settings, w.owner_email, w.created_at,
            (SELECT COUNT(*)::int FROM cb_events e WHERE e.widget_id=w.id AND e.event_type='view') AS views,
            (SELECT COUNT(*)::int FROM cb_events e WHERE e.widget_id=w.id AND e.event_type='lead') AS leads
     FROM cb_widgets w WHERE w.tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [tid]
  );
  res.json({ ok: true, widgets: r.rows });
}));

router.post('/widgets', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const type = String(req.body?.type || '').trim();
  if (!TYPES.includes(type)) return _err(res, 400, 'Bad type — must be one of: ' + TYPES.join(', '));
  const name = _safeText(req.body?.name, 100) || (type === 'social_proof' ? 'Social Proof' : 'Exit Intent') + ' Widget';
  const ownerEmail = String(req.body?.ownerEmail || '').trim().slice(0, 200);
  const settings = _normaliseSettings(type, req.body?.settings);
  const id = (type === 'social_proof' ? 'sp_' : 'ei_') + crypto.randomBytes(8).toString('hex');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'cb:widgets:create' });
  await _db.getPool().query(
    `INSERT INTO cb_widgets (tenant_id, id, type, name, settings, owner_email) VALUES ($1,$2,$3,$4,$5,$6)`,
    [tid, id, type, name, JSON.stringify(settings), ownerEmail || null]
  );
  res.json({ ok: true, id, type, name, settings });
}));

router.patch('/widgets/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const id = req.params.id;
  const tid = await _tenantCtx.resolveTenantId(req, { label:'cb:widgets:patch' });
  const cur = await _db.getPool().query(`SELECT type FROM cb_widgets WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  if (!cur.rowCount) return _err(res, 404, 'Widget not found');
  const sets = []; const args = [];
  if (req.body?.name !== undefined) { args.push(_safeText(req.body.name, 100)); sets.push('name=$' + args.length); }
  if (req.body?.settings !== undefined) {
    const s = _normaliseSettings(cur.rows[0].type, req.body.settings);
    args.push(JSON.stringify(s)); sets.push('settings=$' + args.length);
  }
  if (!sets.length) return _err(res, 400, 'Nothing to update');
  sets.push('updated_at=now()');
  args.push(id); args.push(tid);
  await _db.getPool().query(`UPDATE cb_widgets SET ${sets.join(', ')} WHERE id=$${args.length-1} AND tenant_id=$${args.length}`, args);
  res.json({ ok: true });
}));

router.delete('/widgets/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'cb:widgets:delete' });
  const r = await _db.getPool().query(`DELETE FROM cb_widgets WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rowCount) return _err(res, 404, 'Widget not found');
  res.json({ ok: true });
}));

router.get('/widgets/:id/events', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, events: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'cb:widgets:events' });
  // Verify widget ownership before exposing events
  const own = await _db.getPool().query(`SELECT id FROM cb_widgets WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!own.rowCount) return _err(res, 404, 'Widget not found');
  const r = await _db.getPool().query(
    `SELECT id, event_type, email, data, created_at FROM cb_events WHERE widget_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [req.params.id]
  );
  const stats = await _db.getPool().query(
    `SELECT event_type, COUNT(*)::int AS n FROM cb_events WHERE widget_id=$1 GROUP BY event_type`,
    [req.params.id]
  );
  const counts = { view: 0, lead: 0, dismiss: 0 };
  stats.rows.forEach(s => { counts[s.event_type] = s.n; });
  res.json({ ok: true, events: r.rows, counts });
}));

// ── Public: served to external sites ───────────────────────────────────────

// CORS preflight handlers — the public POSTs need an OPTIONS responder.
function _cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}
router.options('/event/:id', (req, res) => { _cors(res); res.sendStatus(204); });
router.options('/lead/:id',  (req, res) => { _cors(res); res.sendStatus(204); });

// Embed loader — paste-once <script src="…/api/conversion-boosters/embed/<id>.js"></script>
router.get('/embed/:id.js', _safeAsync(async (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  const id = req.params.id;
  if (!_db.hasDb || !_db.hasDb()) return res.send('console.warn("[infogenie] booster unavailable: no DB");');
  const r = await _db.getPool().query(`SELECT id, type, settings FROM cb_widgets WHERE id=$1`, [id]);
  if (!r.rowCount) return res.send(`console.warn("[infogenie] booster ${JSON.stringify(id)} not found");`);
  const w = r.rows[0];
  const origin = `${req.protocol}://${req.get('host')}`;
  const cfg = { id: w.id, type: w.type, settings: w.settings, eventEndpoint: `${origin}/api/conversion-boosters/event/${w.id}`, leadEndpoint: `${origin}/api/conversion-boosters/lead/${w.id}` };
  res.send(_renderEmbedJs(w.type, cfg));
}));

// Event ping — view / dismiss. Rate-limited, body kept tiny.
router.post('/event/:id', express.json({ limit: '4kb' }), _safeAsync(async (req, res) => {
  _cors(res);
  const id = req.params.id;
  const ip = _rlKey(req);
  if (!_rateLimit('cb-ip:' + ip, 30, 60 * 1000)) return _err(res, 429, 'rate limited');
  if (!_rateLimit('cb-w:' + id, 600, 60 * 1000)) return _err(res, 429, 'widget rate limited');
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true });
  // Public endpoint — widget_id is the auth. Inherit tenant_id from widget row.
  const w = await _db.getPool().query(`SELECT id, tenant_id FROM cb_widgets WHERE id=$1`, [id]);
  if (!w.rowCount) return _err(res, 404, 'not found');
  const t = String(req.body?.event || '').trim();
  if (!['view', 'dismiss'].includes(t)) return _err(res, 400, 'bad event');
  await _db.getPool().query(
    `INSERT INTO cb_events (tenant_id, widget_id, event_type, data, ip_hash, ua) VALUES ($1,$2,$3,$4,$5,$6)`,
    [w.rows[0].tenant_id, id, t, req.body?.data ? JSON.stringify(req.body.data).slice(0, 1000) : null, _ipHash(ip), String(req.headers['user-agent'] || '').slice(0, 200)]
  );
  res.json({ ok: true });
}));

// Lead capture — exit intent submit. Drops into cb_events AND mirrors into
// the Unified Inbox (T26) so leads land in the inbox stream automatically.
router.post('/lead/:id', express.json({ limit: '4kb' }), _safeAsync(async (req, res) => {
  _cors(res);
  const id = req.params.id;
  const ip = _rlKey(req);
  if (!_rateLimit('cb-lead-ip:' + ip, 5, 5 * 60 * 1000)) return _err(res, 429, 'Too many submissions — try again in a few minutes.');
  if (!_rateLimit('cb-lead-w:' + id, 60, 5 * 60 * 1000)) return _err(res, 429, 'Widget submission limit reached.');
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  // Public endpoint — widget_id is the auth. Inherit tenant_id from widget row.
  const w = await _db.getPool().query(`SELECT id, type, name, tenant_id FROM cb_widgets WHERE id=$1`, [id]);
  if (!w.rowCount) return _err(res, 404, 'Widget not found');
  const widget = w.rows[0];
  const email = String(req.body?.email || '').trim().slice(0, 200);
  if (!_emailValid(email)) return _err(res, 400, 'Valid email required');
  const sourceUrl = String(req.body?.pageUrl || '').trim().slice(0, 1000) || null;
  const data = { email, pageUrl: sourceUrl, widgetName: widget.name };
  await _db.getPool().query(
    `INSERT INTO cb_events (tenant_id, widget_id, event_type, email, data, ip_hash, ua) VALUES ($1,$2,'lead',$3,$4,$5,$6)`,
    [widget.tenant_id, id, email, JSON.stringify(data), _ipHash(ip), String(req.headers['user-agent'] || '').slice(0, 200)]
  );
  // Mirror into Unified Inbox so leads show up in the inbox stream.
  try {
    const inboxSource = widget.type === 'exit_intent' ? 'exit_intent' : 'social_proof';
    const sourceId = 'cb-' + id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    await _db.getPool().query(
      `INSERT INTO unified_inbox_items (tenant_id, source, source_id, source_url, author, title, content, raw, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (source, source_id) DO NOTHING`,
      [widget.tenant_id, inboxSource, sourceId, sourceUrl, email, widget.name + ' lead capture', 'Captured email: ' + email + (sourceUrl ? ' (from ' + sourceUrl + ')' : ''), JSON.stringify(data)]
    );
  } catch (_) { /* unified_inbox table may not exist yet — non-fatal */ }
  // Lead Intelligence — auto-classify form captures with UTM attribution.
  try {
    const { ingestLead } = require('../lead_intelligence/ingest');
    await ingestLead(widget.tenant_id, {
      channel: 'form',
      email,
      page_url: sourceUrl,
      source_ref: 'cb-' + id,
      message: 'Conversion booster: ' + widget.name,
    });
  } catch (_) { /* lead_intel schema may not be ready yet */ }
  res.json({ ok: true, redirectUrl: (widget.type === 'exit_intent' && req.body?.honour ? null : null) });
}));

// ── Embed JS renderers (IIFE, no globals leaked) ───────────────────────────

function _renderEmbedJs(type, cfg) {
  if (type === 'social_proof') return _socialProofJs(cfg);
  if (type === 'exit_intent')  return _exitIntentJs(cfg);
  return 'console.warn("[infogenie] unknown booster type");';
}

function _socialProofJs(cfg) {
  return `(function(){
  var CFG = ${JSON.stringify(cfg)};
  var POS = { 'bottom-left':'bottom:20px;left:20px', 'bottom-right':'bottom:20px;right:20px', 'top-left':'top:20px;left:20px', 'top-right':'top:20px;right:20px' };
  function send(ev, data){ try { fetch(CFG.eventEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev,data:data||null}),keepalive:true}); } catch(e){} }
  function show(item){
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;'+POS[CFG.settings.position||'bottom-left']+';background:#fff;border:1px solid #E5E7EB;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:14px 18px 14px 14px;font-family:system-ui,-apple-system,sans-serif;font-size:0.9rem;color:#0A1628;max-width:340px;z-index:2147483647;display:flex;gap:12px;align-items:center;opacity:0;transform:translateY(20px);transition:opacity .35s,transform .35s';
    var dot = document.createElement('div');
    dot.style.cssText = 'width:38px;height:38px;border-radius:50%;background:'+CFG.settings.accent+';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0';
    dot.textContent = (item.name||'?').charAt(0).toUpperCase();
    var txt = document.createElement('div'); txt.style.cssText='flex:1;line-height:1.35';
    var line1 = document.createElement('div');
    line1.style.cssText = 'font-weight:600';
    line1.textContent = (item.name||'Someone') + (item.location ? ' from ' + item.location : '');
    var line2 = document.createElement('div'); line2.style.cssText='color:#6B7280;font-size:0.82rem';
    line2.textContent = (item.action||'just signed up') + ' · ' + (item.when||'recently');
    var foot = document.createElement('div'); foot.style.cssText='color:#9CA3AF;font-size:0.66rem;margin-top:2px'; foot.textContent='via InfoGenie';
    txt.appendChild(line1); txt.appendChild(line2); txt.appendChild(foot);
    var x = document.createElement('button');
    x.type='button'; x.textContent='×'; x.setAttribute('aria-label','Close');
    x.style.cssText='position:absolute;top:6px;right:8px;background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:1rem;padding:0;line-height:1';
    x.onclick = function(){ box.style.opacity='0'; setTimeout(function(){ box.remove(); },350); send('dismiss'); };
    box.appendChild(dot); box.appendChild(txt); box.appendChild(x);
    document.body.appendChild(box);
    setTimeout(function(){ box.style.opacity='1'; box.style.transform='translateY(0)'; },20);
    var hideMs = (CFG.settings.displaySeconds||5)*1000;
    setTimeout(function(){ box.style.opacity='0'; box.style.transform='translateY(20px)'; setTimeout(function(){ box.remove(); },350); }, hideMs);
    send('view', { name:item.name, location:item.location });
  }
  function start(){
    var items = (CFG.settings.items||[]).slice();
    if (!items.length) return;
    var i = 0;
    function tick(){ show(items[i % items.length]); i++; }
    setTimeout(tick, 4000); // initial delay so it doesn't fire on page paint
    setInterval(tick, (CFG.settings.intervalSeconds||12)*1000);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;
}

function _exitIntentJs(cfg) {
  return `(function(){
  var CFG = ${JSON.stringify(cfg)};
  var COOKIE = 'igxi_'+CFG.id;
  function getCookie(n){ var m = document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)')); return m?decodeURIComponent(m[1]):''; }
  function setCookie(n,v,d){ var x=new Date(); x.setTime(x.getTime()+d*86400000); document.cookie=n+'='+encodeURIComponent(v)+';expires='+x.toUTCString()+';path=/;SameSite=Lax'; }
  if ((CFG.settings.dismissCookieDays>0) && getCookie(COOKIE)) return;
  function send(ev, data){ try { fetch(CFG.eventEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev,data:data||null}),keepalive:true}); } catch(e){} }
  function close(reason){
    var bd = document.getElementById('igxi-bd-'+CFG.id); if (bd) bd.remove();
    if (CFG.settings.dismissCookieDays>0) setCookie(COOKIE,'1',CFG.settings.dismissCookieDays);
    if (reason==='dismiss') send('dismiss');
  }
  function open(){
    if (document.getElementById('igxi-bd-'+CFG.id)) return;
    var bd = document.createElement('div');
    bd.id = 'igxi-bd-'+CFG.id;
    bd.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,0.6);z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;padding:20px;animation:igxi-fade .25s ease';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;max-width:460px;width:100%;padding:32px 28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.3);position:relative;text-align:center;animation:igxi-pop .3s ease';
    var x = document.createElement('button');
    x.type='button'; x.textContent='×'; x.setAttribute('aria-label','Close');
    x.style.cssText='position:absolute;top:10px;right:14px;background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:1.6rem;padding:0;line-height:1';
    x.onclick = function(){ close('dismiss'); };
    var h = document.createElement('div'); h.style.cssText='font-size:1.5rem;font-weight:800;color:#0A1628;margin-bottom:8px'; h.textContent = CFG.settings.headline||'Wait!';
    var s = document.createElement('div'); s.style.cssText='color:#4B5563;margin-bottom:20px;line-height:1.45'; s.textContent = CFG.settings.subheadline||'';
    var inp = document.createElement('input');
    inp.type='email'; inp.placeholder='you@company.com';
    inp.style.cssText='width:100%;padding:12px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:1rem;box-sizing:border-box;margin-bottom:12px';
    var btn = document.createElement('button');
    btn.type='button'; btn.textContent = CFG.settings.ctaText||'Submit';
    btn.style.cssText='width:100%;background:'+CFG.settings.accent+';color:#fff;border:none;padding:13px 18px;border-radius:8px;font-size:1rem;font-weight:800;cursor:pointer';
    var msg = document.createElement('div'); msg.style.cssText='margin-top:10px;font-size:0.86rem;min-height:18px';
    var foot = document.createElement('div'); foot.style.cssText='color:#9CA3AF;font-size:0.7rem;margin-top:14px'; foot.textContent='Powered by InfoGenie';
    btn.onclick = function(){
      var email = inp.value.trim();
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { msg.style.color='#B91C1C'; msg.textContent='Please enter a valid email.'; return; }
      btn.disabled=true; btn.style.opacity='0.6'; msg.style.color='#6B7280'; msg.textContent='Sending…';
      fetch(CFG.leadEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,pageUrl:location.href,honour:true})})
        .then(function(r){ return r.json(); })
        .then(function(j){
          if (!j.ok){ btn.disabled=false; btn.style.opacity='1'; msg.style.color='#B91C1C'; msg.textContent=j.error||'Something went wrong.'; return; }
          msg.style.color='#10B981'; msg.textContent='✓ Got it! Check your inbox shortly.';
          setCookie(COOKIE,'1', Math.max(CFG.settings.dismissCookieDays||7,1));
          if (CFG.settings.redirectUrl) { setTimeout(function(){ location.href = CFG.settings.redirectUrl; }, 800); }
          else setTimeout(function(){ close('converted'); }, 1500);
        })
        .catch(function(){ btn.disabled=false; btn.style.opacity='1'; msg.style.color='#B91C1C'; msg.textContent='Network error.'; });
    };
    inp.addEventListener('keydown', function(e){ if (e.key==='Enter') btn.click(); });
    card.appendChild(x); card.appendChild(h); card.appendChild(s); card.appendChild(inp); card.appendChild(btn); card.appendChild(msg); card.appendChild(foot);
    bd.appendChild(card); document.body.appendChild(bd);
    if (!document.getElementById('igxi-style')) { var st=document.createElement('style'); st.id='igxi-style'; st.textContent='@keyframes igxi-fade{from{opacity:0}to{opacity:1}}@keyframes igxi-pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}'; document.head.appendChild(st); }
    inp.focus();
    send('view');
  }
  // Desktop: trigger when mouse leaves through the top of the viewport.
  // Mobile: trigger on rapid scroll-up (tab-close intent proxy).
  var fired = false;
  function arm(){
    if (fired) return; fired = true; open();
  }
  document.addEventListener('mouseout', function(e){
    if (!e.relatedTarget && !e.toElement && e.clientY<=10) arm();
  });
  var lastY = 0, lastT = Date.now();
  window.addEventListener('scroll', function(){
    var y = window.scrollY||document.documentElement.scrollTop, t = Date.now();
    if (lastY-y > 200 && t-lastT < 300 && y < 400) arm();
    lastY = y; lastT = t;
  }, { passive: true });
})();`;
}

module.exports = router;
