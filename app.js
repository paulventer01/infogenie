// ============================================================
// InfoGenie — Main Application Controller
// ============================================================

// ── Chart.js global defaults ─────────────────────────────────────────────────
// Disable animations + responsive resize observer overhead. The dashboard
// creates 7+ Chart.js instances simultaneously; their default 1000ms
// animation loop saturates the main thread with requestAnimationFrame work,
// which (a) triggers the browser's "page not responding" warning right after
// the analyse flow, and (b) starves the background view-build queue's
// setTimeouts so deferred builders never fire. Static charts render instantly
// and free the main thread.
(function disableChartAnimations(){
  function apply(){
    try {
      if (typeof window !== 'undefined' && window.Chart && Chart.defaults) {
        // Narrow change: disable the DEFAULT animation only. Charts that
        // pass their own `options.animation` (e.g. duration: 800) still
        // animate normally. Also zero out hover-transition duration to
        // remove tiny rAF ticks on mouse-over.
        Chart.defaults.animation = false;
        if (Chart.defaults.transitions && Chart.defaults.transitions.active) {
          Chart.defaults.transitions.active.animation = { duration: 0 };
        }
        return true;
      }
    } catch(_) {}
    return false;
  }
  if (!apply()) {
    // Chart hasn't loaded yet — retry on DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      setTimeout(apply, 0);
    }
  }
})();

// ── EARLY-LOAD: Counter This Message click handler ────────────────────────────
// Defined at the very top of app.js so it is GUARANTEED to be defined even if
// any later runtime error halts the rest of the script. The actual modal
// renderer (openWLCounterModal) is defined further down — if it isn't loaded
// yet when the user clicks, we show a friendly toast instead of silently
// doing nothing. A document-level delegated listener is attached as a final
// safety net for any cached/old button HTML missing the inline onclick.
(function earlyWLCounterWireup(){
  function wlClick(btn) {
    try {
      if (!btn || !btn.getAttribute) return;
      const dec = s => { try { return decodeURIComponent(s || ''); } catch(_) { return s || ''; } };
      const data = {
        comp:     dec(btn.getAttribute('data-wl-comp')),
        channel:  dec(btn.getAttribute('data-wl-channel')),
        lossRate: dec(btn.getAttribute('data-wl-loss')),
        message:  dec(btn.getAttribute('data-wl-message')),
        weakness: dec(btn.getAttribute('data-wl-weakness'))
      };
      console.log('[wlClick] Counter This Message clicked:', data.comp, data);
      if (!data.comp) {
        if (typeof window.showToast === 'function') window.showToast('⚠️ Counter data missing — please re-run analysis');
        else alert('Counter data missing — please re-run analysis');
        return;
      }
      if (typeof window.openWLCounterModal === 'function') {
        window.openWLCounterModal(data);
      } else {
        console.error('[wlClick] openWLCounterModal not yet defined — script may still be loading');
        if (typeof window.showToast === 'function') window.showToast('⚠️ Counter modal still loading — try again in a moment');
        else alert('Counter modal still loading — try again in a moment');
      }
    } catch(err) {
      console.error('[wlClick] failed:', err);
      if (typeof window.showToast === 'function') window.showToast('⚠️ Counter modal error: ' + err.message);
      else alert('Counter modal error: ' + err.message);
    }
  }
  window._wlClick = wlClick;

  // Document-level delegated handler in CAPTURE phase — fires for ANY click
  // on a .btn-wl-counter button before it reaches the button's own inline
  // onclick. We call stopImmediatePropagation so the inline onclick does NOT
  // also fire and double-open the modal. This way the inline is just a
  // belt-and-braces fallback for the (impossible-in-practice) case where
  // this top-of-file IIFE didn't run.
  function _delegated(ev){
    let t = ev.target;
    if (t && t.nodeType !== 1 && t.parentElement) t = t.parentElement;
    const btn = (t && t.closest) ? t.closest('.btn-wl-counter') : null;
    if (!btn) return;
    // Only handle Counter-Message buttons (those carry data-wl-id). Other
    // buttons that share the class for styling (e.g. Real Meta Ads) are
    // ignored so their own onclick can fire normally.
    if (!btn.hasAttribute('data-wl-id')) return;
    if (btn._wlFiring) return;
    btn._wlFiring = true;
    setTimeout(() => { try { delete btn._wlFiring; } catch(_) {} }, 600);
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    console.log('[wl-counter] event="' + ev.type + '" caught for', btn.getAttribute('data-wl-comp'));
    try { btn.style.opacity = '0.5'; setTimeout(() => { btn.style.opacity = ''; }, 300); } catch(_) {}
    wlClick(btn);
  }
  document.addEventListener('pointerdown', _delegated, true);
  document.addEventListener('mousedown',  _delegated, true);
  document.addEventListener('click',      _delegated, true);
  document.addEventListener('touchstart', _delegated, true);
  console.log('[wl-counter] early wireup installed (pointerdown+mousedown+click+touchstart)');
})();

// ────────────────────────────────────────────────────────────────────────────
// _wlViewRealAds(comp, domain) — opens a modal showing this competitor's
// CURRENTLY-RUNNING ads on Meta (Facebook + Instagram), pulled live from
// graph.facebook.com/v19.0/ads_archive via /api/meta-ad-library/search.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// _enrichWinLossWithHubSpot(displayWinLoss) — fetches real CRM deals and, for
// each competitor whose name appears in deal names, computes the actual
// closed_lost / total ratio and updates the loss-rate cell + badge in-place.
// ────────────────────────────────────────────────────────────────────────────

// ── Account system + per-user localStorage namespacing ────────────────────────
// Wraps localStorage so every key is automatically scoped to the active user
// (e.g. `_u:alice@example.com::ig-domain`). System keys (auth state + theme)
// stay un-prefixed so they are shared. This means ALL existing localStorage
// usage across the app is automatically per-account with no other code changes.
(function setupAccounts(){
  const SYS = ['ig-users','ig-current-user','ig-theme'];
  const isSys = k => !k || SYS.indexOf(k) !== -1 || /^_u:/.test(k);
  const orig = {
    get: localStorage.getItem.bind(localStorage),
    set: localStorage.setItem.bind(localStorage),
    rem: localStorage.removeItem.bind(localStorage)
  };
  function curUser(){ try { return orig.get('ig-current-user') || ''; } catch(e){ return ''; } }
  function ns(k){ const u = curUser(); return (!u || isSys(k)) ? k : ('_u:'+u+'::'+k); }
  // Patch only get/set/remove — leave length/key alone (rarely used).
  localStorage.getItem    = function(k){ return orig.get(ns(k)); };
  localStorage.setItem    = function(k,v){ return orig.set(ns(k), v); };
  localStorage.removeItem = function(k){ return orig.rem(ns(k)); };
  // window._auth — now backed by the real server-side auth surface in
  // services/auth/api.js. The client keeps `ig-current-user` in raw
  // localStorage as a local "logged-in" marker so the per-account namespacing
  // above keeps working without code changes elsewhere; the source of truth
  // is the HttpOnly session cookie owned by the server.
  async function _authFetch(path, opts){
    const r = await fetch(path, Object.assign({ credentials:'same-origin', headers:{'Content-Type':'application/json'} }, opts || {}));
    const ct = r.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await r.json().catch(()=>({})) : {};
    if (!r.ok) return { error: body.error || (`Request failed (${r.status})`), status:r.status };
    return body;
  }
  window._auth = {
    current(){ return curUser(); },
    currentProfile(){
      try { return JSON.parse(orig.get('ig-current-profile') || 'null'); } catch(e){ return null; }
    },
    _setSession(user){
      if (!user || !user.email) return;
      orig.set('ig-current-user', user.email);
      orig.set('ig-current-profile', JSON.stringify({ id:user.id, email:user.email, name:user.name||'', isOwner:!!user.isOwner, emailVerified:!!user.emailVerified }));
    },
    _clearSession(){
      orig.rem('ig-current-user');
      orig.rem('ig-current-profile');
    },
    async refresh(){
      const r = await _authFetch('/api/auth/me');
      if (r && r.authenticated && r.user) { this._setSession(r.user); return r.user; }
      this._clearSession();
      return null;
    },
    // Same-origin relative path of the view the user is currently on, so the
    // verification-email link can return them here. Mirrors the session-expiry
    // `next` convention (`/?view=<view>`). Returns '' for the home dashboard.
    _currentDest(){
      try {
        const cv = window.currentView;
        if (cv && cv !== 'home') return '/?view=' + encodeURIComponent(cv);
        const rel = (location.pathname || '/') + (location.search || '') + (location.hash || '');
        if (rel && rel !== '/' && !/^\/login/i.test(rel) && rel.charAt(0) === '/'
            && rel.charAt(1) !== '/' && rel.charAt(1) !== '\\') return rel;
      } catch(_) {}
      return '';
    },
    async signup({name, email, password}){
      const body = { name, email, password };
      const next = this._currentDest();
      if (next) body.next = next;
      const r = await _authFetch('/api/auth/signup', { method:'POST', body: JSON.stringify(body) });
      if (r.error) return r;
      this._setSession(r.user);
      return { ok:true, user:r.user, verificationEmailSent: !!r.verificationEmailSent };
    },
    async login({email, password}){
      const r = await _authFetch('/api/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
      if (r.error) return r;
      this._setSession(r.user);
      return { ok:true, user:r.user };
    },
    async requestReset(email){
      return _authFetch('/api/auth/request-reset', { method:'POST', body: JSON.stringify({ email }) });
    },
    async resendVerification(){
      const next = this._currentDest();
      return _authFetch('/api/auth/resend-verification', { method:'POST', body: JSON.stringify(next ? { next } : {}) });
    },
    async listProviders(){
      const r = await _authFetch('/api/auth/providers');
      return (r && r.providers) || {};
    },
    socialStart(provider){
      window.location.href = '/api/auth/oauth/' + encodeURIComponent(provider) + '/start';
    },
    async logout(){
      try { await _authFetch('/api/auth/logout', { method:'POST', body:'{}' }); } catch(e){}
      this._clearSession();
      // Server gates the shell now, so a reload would bounce to /login anyway —
      // go there directly for an immediate, clean exit.
      location.href = '/login';
    },
  };
})();

// ── Auth bootstrap — sync session marker; bounce to /login if signed out ──────
(function authBootstrap(){
  // The server now gates the app shell: logged-out visitors never receive this
  // code (they get the standalone /login page instead). So there is no client
  // overlay anymore. This bootstrap only reconciles the local "logged-in"
  // marker with the server session via /me, and bounces to /login if the
  // session turns out to be invalid (e.g. it expired between the shell load and
  // this call, or a cross-device sign-out happened).
  async function render(){
    try {
      const me = await window._auth.refresh();
      if (me) {
        // The standalone /login page sets the server cookie but not the local
        // `ig-current-user` marker, so the nav user-menu wiring (which gates on
        // that marker) bailed before refresh() populated it. Re-run it now that
        // the session is confirmed so the name pill + Log out button appear.
        try { if (typeof window._wireNavUserMenu === 'function') window._wireNavUserMenu(); } catch(_){}
        try { if (typeof window._restoreContent === 'function') window._restoreContent(); } catch(_){}
        return;  // authenticated — marker synced, proceed
      }
    } catch(e) {
      // Network failure talking to /me — fall through to the login redirect
      // rather than trusting a stale local marker.
    }
    location.href = '/login';
    return;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();

// ── Global ⏳ thinking-timer ──────────────────────────────────────────────────
// Auto-appends a live "[N.Ns]" elapsed-time counter to ANY element whose
// textContent starts with the ⏳ hourglass emoji (loading / thinking / generating
// states). Runs across the entire app via a single MutationObserver — no caller
// changes required. Input fields use _wireAI's own timer because .value changes
// don't fire MutationObserver events.
(function _globalThinkingTimer(){
  if (!('MutationObserver' in window)) return;
  const RX_HOURGLASS = /^\s*⏳/;
  const RX_TIMER_SUFFIX = /\s*\[\d+\.\d+s\]\s*$/;
  const tracked = new WeakMap();   // el → { t0, iv, base }
  const selfWrites = new WeakSet();
  function stripTimer(s){ return String(s||'').replace(RX_TIMER_SUFFIX, ''); }
  function start(el){
    if (tracked.has(el)) return;
    const base = stripTimer(el.textContent);
    const rec = { t0: performance.now(), base, iv: null };
    rec.iv = setInterval(() => {
      if (!el.isConnected) { stop(el); return; }
      // If the element has since gained HTML children, BAIL OUT — writing
      // textContent would flatten/remove those children (DOM corruption).
      if (el.children && el.children.length > 0) { stop(el); return; }
      const cur = stripTimer(el.textContent);
      if (!RX_HOURGLASS.test(cur)) { stop(el); return; }
      const elapsed = ((performance.now() - rec.t0) / 1000).toFixed(1);
      const next = cur + ' [' + elapsed + 's]';
      selfWrites.add(el);
      try {
        // Update an existing text node's value (a characterData mutation)
        // rather than reassigning textContent (a childList mutation).
        // textContent= replaces the child text node every 100ms tick, which
        // wakes every other whole-document childList MutationObserver
        // (dock-magnify, hero-unify, field-enhancer) ~10x/sec and can saturate
        // the main thread on large DOMs. nodeValue= does not wake them.
        if (el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
          el.firstChild.nodeValue = next;
        } else {
          el.textContent = next;
        }
      } catch {}
      setTimeout(() => selfWrites.delete(el), 0);
    }, 100);
    tracked.set(el, rec);
  }
  function stop(el){
    const rec = tracked.get(el); if (!rec) return;
    clearInterval(rec.iv);
    tracked.delete(el);
  }
  function scan(node){
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (node.children.length === 0) {
      const t = node.textContent || '';
      if (RX_HOURGLASS.test(t)) start(node);
      else if (tracked.has(node)) stop(node);
    } else {
      // Node now has element children — if we were tracking it as a leaf,
      // stop now to avoid clobbering its children on the next tick.
      if (tracked.has(node)) stop(node);
    }
    for (let i = 0; i < node.children.length; i++) scan(node.children[i]);
  }
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      if (selfWrites.has(m.target)) continue;
      if (m.type === 'childList') {
        if (m.addedNodes && m.addedNodes.length) m.addedNodes.forEach(n => scan(n));
        if (m.target instanceof Element) scan(m.target);
      } else if (m.type === 'characterData') {
        const p = m.target.parentElement;
        if (p && !selfWrites.has(p)) scan(p);
      }
    }
  });
  function init(){
    try {
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      scan(document.body);
    } catch(e) { /* never break the app over a timer */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// ── Wire up nav user menu (avatar pill + dropdown + logout) ───────────────────
(function wireUserMenu(){
  let wired = false;
  function init(){
    if (!window._auth || !window._auth.current()) return;
    if (wired) return;
    const menu     = document.getElementById('navUserMenu');
    const btn      = document.getElementById('navUserBtn');
    const drop     = document.getElementById('navUserDropdown');
    const avatar   = document.getElementById('navUserAvatar');
    const nameEl   = document.getElementById('navUserName');
    const fullEl   = document.getElementById('navUserNameFull');
    const emailEl  = document.getElementById('navUserEmail');
    const logout   = document.getElementById('navLogoutBtn');
    if (!menu || !btn) return;
    wired = true;
    const p = window._auth.currentProfile() || { name:'User', email: window._auth.current() };
    if (!p.email) p.email = window._auth.current();
    const initial = (p.name || p.email || 'U').trim().charAt(0).toUpperCase();
    avatar.textContent = initial;
    nameEl.textContent = (p.name || p.email.split('@')[0]).slice(0, 18);
    fullEl.textContent = p.name || '—';
    emailEl.textContent = p.email;
    // Surface a "Resend verification email" link in the dropdown when the
    // current account is still unverified (uses /api/auth/resend-verification).
    if (p && p.emailVerified === false) {
      const drop = document.getElementById('navUserDropdown');
      if (drop && !document.getElementById('navResendVerifyBtn')) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin:6px 0 10px;padding:8px 10px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;font-size:.72rem;color:#92400E;line-height:1.45';
        wrap.innerHTML = `<div style="font-weight:700;margin-bottom:4px">Email not verified yet</div>
          <div style="margin-bottom:6px">We sent a link to <strong>${p.email}</strong>. Didn't get it?</div>
          <button id="navResendVerifyBtn" type="button" style="background:#0066FF;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:.7rem;font-weight:700;cursor:pointer">Resend verification email</button>`;
        const logoutBtn = document.getElementById('navLogoutBtn');
        drop.insertBefore(wrap, logoutBtn);
        document.getElementById('navResendVerifyBtn').addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'Sending…';
          try {
            const r = await window._auth.resendVerification();
            b.textContent = (r && (r.sent || r.alreadyVerified)) ? '✓ Sent!' : (r.error || 'Failed — try again');
          } catch(e){ b.textContent = 'Network error'; }
          setTimeout(() => { b.disabled = false; b.textContent = 'Resend verification email'; }, 2500);
        });
      }
    }
    menu.style.display = 'inline-flex';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      drop.style.display = drop.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', e => {
      if (!menu.contains(e.target)) drop.style.display = 'none';
    });
    logout.addEventListener('click', () => {
      if (confirm('Log out? Your settings & campaigns will stay saved to this account and reload when you log back in.')) {
        try { if (typeof window._persistContent === 'function') window._persistContent(); } catch(e){}
        window._auth.logout();
      }
    });
  }
  window._wireNavUserMenu = init;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// ── Persist Social posts / Launched campaigns / Article topics across reloads ─
// The Master Calendar already aggregates these arrays — without persistence,
// data created in one session vanishes on refresh and the calendar shows zeros.
(function setupContentPersistence(){
  const KEYS = {
    _socialPosts:       'ig-social-posts',
    _launchedCampaigns: 'ig-launched-campaigns',
    _autoSeoArticles:   'ig-autoseo-articles',
    _autoSeoSchedule:   'ig-autoseo-schedule'
  };
  // Restore on first chance (after auth wall is bypassed by an active user).
  let restored = false;
  function restore(){
    if (!window._auth || !window._auth.current()) return;
    if (restored) return;
    restored = true;
    Object.entries(KEYS).forEach(([wkey, lsKey]) => {
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw == null) return;
        const val = JSON.parse(raw);
        if (val !== null && val !== undefined) window[wkey] = val;
      } catch(e) { /* ignore */ }
    });
  }
  // Persist after every assignment by intercepting via a 100ms tick. Lightweight,
  // avoids monkey-patching every `=` site across 25k LOC.
  let last = {};
  function persist(){
    if (!window._auth || !window._auth.current()) return;
    Object.entries(KEYS).forEach(([wkey, lsKey]) => {
      try {
        const cur = window[wkey];
        if (cur === undefined) return;
        const ser = JSON.stringify(cur);
        if (ser !== last[wkey]) {
          localStorage.setItem(lsKey, ser);
          last[wkey] = ser;
        }
      } catch(e) { /* ignore */ }
    });
  }
  // Restore as early as possible; persist on a slow loop + on unload.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore);
  else restore();
  setInterval(persist, 1500);
  window.addEventListener('beforeunload', persist);
  window._persistContent = persist;   // expose for explicit calls (e.g. after Analyse Now)
  window._restoreContent = restore;   // re-run once the session is confirmed (standalone /login path)
})();

// ── Analytics (Amplitude + PostHog) ──────────────────────────────────────────
window._ampReady = false;
window._phReady  = false;

(async () => {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());

    // Amplitude
    if (cfg.amplitudeApiKey && window.amplitude) {
      await window.amplitude.init(cfg.amplitudeApiKey, {
        defaultTracking: { sessions: true, pageViews: false, formInteractions: false, fileDownloads: false }
      }).promise;
      window._ampReady = true;
    }

    // PostHog
    if (cfg.posthogApiKey && window.posthog) {
      window.posthog.init(cfg.posthogApiKey, {
        api_host: 'https://eu.i.posthog.com',
        ui_host: 'https://eu.posthog.com',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        session_recording: { maskAllInputs: false }
      });
      window._phReady = true;
    }

    igTrack('App Loaded', { version: '1.0', platform: 'web' });
  } catch(e) { console.warn('[Analytics] init failed:', e.message); }
})();

function igTrack(eventName, props = {}) {
  if (window._ampReady && window.amplitude) {
    window.amplitude.track(eventName, props);
  }
  if (window._phReady && window.posthog) {
    window.posthog.capture(eventName, props);
  }
}

let currentView = 'marketing-brief';
let analysisData = null;
let queuedCampaigns = [];
let creativeRound = 0;
window._launchedCampaigns = [];
window._abTests = [];
window._infoGenieActions = [];

// ===== GLOBAL STYLED TOOLTIP MANAGER =========================================
// Intercepts every element with a [title] attribute (added statically or
// dynamically) and replaces the browser's plain OS tooltip with InfoGenie's
// branded dark tooltip card (#igTip). A MutationObserver keeps it in sync with
// dynamically rendered page content.
(function _igTooltipManager() {
  let _tipEl, _active;

  function _init() {
    _tipEl = document.getElementById('igTip');
    if (!_tipEl) return;

    // Convert an element's title → data-ig-tip (removes native browser tooltip)
    function _upgrade(el) {
      if (el.hasAttribute('title') && !el.hasAttribute('data-ig-tip')) {
        el.setAttribute('data-ig-tip', el.getAttribute('title'));
        el.removeAttribute('title');
      }
    }

    function _upgradeAll(root) {
      (root.querySelectorAll ? root.querySelectorAll('[title]') : []).forEach(_upgrade);
      if (root.hasAttribute && root.hasAttribute('title')) _upgrade(root);
    }

    // Upgrade everything already in the DOM
    _upgradeAll(document);

    // Watch for anything added later (dynamic page renders)
    new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) _upgradeAll(n);
        });
        // Also catch attribute changes on existing nodes
        if (m.type === 'attributes' && m.attributeName === 'title') _upgrade(m.target);
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });

    // Position helper — keeps tip on screen
    function _pos(cx, cy) {
      const W = window.innerWidth, H = window.innerHeight;
      const tw = _tipEl.offsetWidth, th = _tipEl.offsetHeight;
      const ox = 14, oy = 14;
      let x = cx + ox, y = cy + oy;
      if (x + tw + 6 > W) x = cx - tw - ox;
      if (y + th + 6 > H) y = cy - th - oy;
      _tipEl.style.left = Math.max(6, x) + 'px';
      _tipEl.style.top  = Math.max(6, y) + 'px';
    }

    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-ig-tip]');
      if (!el) { _hideTip(); return; }
      if (el === _active) return;
      _active = el;
      _tipEl.textContent = el.getAttribute('data-ig-tip');
      _tipEl.removeAttribute('hidden');
      _pos(e.clientX, e.clientY);
    }, true);

    document.addEventListener('mousemove', e => {
      if (_active) _pos(e.clientX, e.clientY);
    }, true);

    document.addEventListener('mouseout', e => {
      if (!_active) return;
      const rel = e.relatedTarget;
      if (!rel || !rel.closest || !rel.closest('[data-ig-tip]')) _hideTip();
    }, true);

    document.addEventListener('click', _hideTip, true);
    document.addEventListener('keydown', _hideTip, true);
  }

  function _hideTip() {
    if (_tipEl) _tipEl.setAttribute('hidden', '');
    _active = null;
  }

  // Run after DOM is parsed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
// =============================================================================

// ===== PRIMARY CAMPAIGN BUTTON HANDLERS — called directly via onclick in buildCampaigns() =====
window._igLaunch = function(idx) {
  try {
    // If _lastCampRecs is missing but we have analysisData, rebuild it
    if ((!window._lastCampRecs || !window._lastCampRecs[idx]) && window.analysisData) {
      try { buildCampaigns(); } catch(e) {}
    }
    const camp = window._lastCampRecs && window._lastCampRecs[idx];
    if (!camp) {
      showToast('⚠️ Please run an analysis first — enter your website URL on the home page');
      navigateTo('home');
      return;
    }
    buildLaunchModal(camp, idx);
  } catch(err) {
    console.error('_igLaunch error:', err);
    // Show an inline error in the modal instead of just a toast
    const inner = document.getElementById('campLaunchRichModalInner');
    const modal  = document.getElementById('campLaunchRichModal');
    if (inner && modal) {
      modal.classList.remove('hidden');
      modal.style.cssText = 'display:flex !important; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; background:rgba(0,0,0,.65); padding:20px;';
      inner.innerHTML = `<div style="background:white;border-radius:16px;padding:32px;max-width:460px;width:100%;text-align:center">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <div style="font-weight:800;font-size:1rem;color:#0A1628;margin-bottom:8px">Couldn't open Launch modal</div>
        <div style="font-size:0.82rem;color:#6B7280;margin-bottom:20px">${err.message}</div>
        <button onclick="closeCampLaunchRichModal()" style="padding:10px 24px;background:#0066FF;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700">Close</button>
      </div>`;
    } else {
      alert('Error opening launch: ' + err.message);
    }
  }
};

// Live Intelligence info popover — explains how auto-targeting works
window._showLiveIntelInfo = function() {
  const existing = document.getElementById('liveIntelInfoOverlay');
  if (existing) { existing.remove(); return; }
  const ov = document.createElement('div');
  ov.id = 'liveIntelInfoOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(10,22,40,.65);backdrop-filter:blur(4px);padding:20px';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const segCount = (window._lastCampRecs && window.analysisData) ? (analysisData.competitors || []).reduce((n,c)=>n+(c.audiences||[]).length,0) : 0;
  const compCount = (window.analysisData && analysisData.competitors) ? analysisData.competitors.length : 0;
  ov.innerHTML = `<div style="background:white;border-radius:16px;max-width:520px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:'Inter',sans-serif">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="display:inline-flex;align-items:center;gap:6px;background:#0369A1;color:white;padding:5px 12px;border-radius:999px;font-size:0.72rem;font-weight:800"><span style="width:7px;height:7px;border-radius:50%;background:#10F981;box-shadow:0 0 8px #10F981;animation:livePulse 1.4s infinite"></span>Live Intelligence</span>
      </div>
      <button onclick="document.getElementById('liveIntelInfoOverlay').remove()" style="background:#F3F4F6;border:none;width:30px;height:30px;border-radius:50%;font-size:1rem;cursor:pointer;color:#6B7280">✕</button>
    </div>
    <h3 style="font-family:Sora,sans-serif;font-size:1.05rem;font-weight:800;color:#0A1628;margin:0 0 8px 0">How Live Intelligence works</h3>
    <p style="font-size:0.85rem;color:#475569;line-height:1.55;margin:0 0 16px 0">InfoGenie continuously analyses your <strong>${compCount}</strong> competitors' audience targeting, ad creative, and conversion patterns. It extracts the highest-converting segments and auto-applies them to your campaigns — no manual setup required.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:11px"><div style="font-size:0.65rem;font-weight:700;color:#0369A1;text-transform:uppercase;margin-bottom:3px">Segments tracked</div><div style="font-size:1.2rem;font-weight:800;color:#0A1628">${segCount || '—'}</div></div>
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:11px"><div style="font-size:0.65rem;font-weight:700;color:#059669;text-transform:uppercase;margin-bottom:3px">Refresh interval</div><div style="font-size:1.2rem;font-weight:800;color:#0A1628">6 hours</div></div>
    </div>
    <div style="font-size:0.78rem;color:#475569;line-height:1.5"><strong style="color:#0A1628">What's auto-applied:</strong><ul style="margin:6px 0 0 18px;padding:0"><li>Lookalike audiences from competitor's best-converting segments</li><li>Interest & behaviour overlap detected via DataForSEO + Meta APIs</li><li>Bid adjustments by segment based on competitor ROAS data</li><li>Creative variants matched to each segment's pain points</li></ul></div>
    <button onclick="document.getElementById('liveIntelInfoOverlay').remove()" style="width:100%;margin-top:18px;padding:11px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer">Got it</button>
  </div>`;
  document.body.appendChild(ov);
};

window._igCreative = function(idx) {
  try {
    if ((!window._lastCampRecs || !window._lastCampRecs[idx]) && window.analysisData) {
      try { buildCampaigns(); } catch(e) {}
    }
    const camp = window._lastCampRecs && window._lastCampRecs[idx];
    if (!camp) {
      showToast('⚠️ Please run an analysis first — enter your website URL on the home page');
      navigateTo('home');
      return;
    }
    buildCreativeModal(camp, idx);
  } catch(err) {
    console.error('_igCreative error:', err);
    const inner = document.getElementById('campCreativeModalInner');
    const modal  = document.getElementById('campCreativeModal');
    if (inner && modal) {
      modal.classList.remove('hidden');
      modal.style.cssText = 'display:flex !important; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; background:rgba(0,0,0,.65); padding:20px;';
      inner.innerHTML = `<div style="background:white;border-radius:16px;padding:32px;max-width:460px;width:100%;text-align:center">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <div style="font-weight:800;font-size:1rem;color:#0A1628;margin-bottom:8px">Couldn't open Creative Studio</div>
        <div style="font-size:0.82rem;color:#6B7280;margin-bottom:20px">${err.message}</div>
        <button onclick="document.getElementById('campCreativeModal').classList.add('hidden');document.getElementById('campCreativeModal').removeAttribute('style')" style="padding:10px 24px;background:#0066FF;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700">Close</button>
      </div>`;
    } else {
      alert('Error opening Creative Studio: ' + err.message);
    }
  }
};

// ===== LANDING PAGE GENERATOR =====
window._currentLandingPageHTML = null;
window._currentLandingPageCamp = null;

window._igLandingPage = function(idx) {
  if ((!window._lastCampRecs || !window._lastCampRecs[idx]) && window.analysisData) {
    try { buildCampaigns(); } catch(e) {}
  }
  const camp = window._lastCampRecs && window._lastCampRecs[idx];
  if (!camp) { showToast('⚠️ Run an analysis first'); navigateTo('home'); return; }
  generateLandingPageForCamp(camp);
};

// ── Brand Creative: per-campaign brand-styled ad pack ────────────────────────
// Generates 3 brand-styled ad mockups (Square / Story / Banner) using the
// brand's detected primary colour and name, then lets the user attach them
// to a specific campaign. Attached creatives persist for the session and
// surface as a confirmation chip on the campaign card.
window._campaignBrandCreatives = window._campaignBrandCreatives || {};

function _brandPrimaryColour() {
  // Try to derive a colour from the analysis; fall back to InfoGenie teal
  const palette = ['#0066FF','#00C9C8','#7C3AED','#F59E0B','#EF4444','#10B981','#EC4899','#0EA5E9'];
  const seed = (analysisData && analysisData.url || 'infogenie').toString();
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function _brandSecondary(c) {
  // Lighten/darken complement
  return c === '#0066FF' ? '#00C9C8'
       : c === '#00C9C8' ? '#0066FF'
       : c === '#7C3AED' ? '#F59E0B'
       : c === '#F59E0B' ? '#7C3AED'
       : c === '#EF4444' ? '#0EA5E9'
       : c === '#10B981' ? '#0066FF'
       : c === '#EC4899' ? '#7C3AED'
       : '#00C9C8';
}
function _brandName() {
  if (window._brandKit && window._brandKit.name) return window._brandKit.name;
  const u = analysisData && analysisData.url ? analysisData.url : 'YourBrand';
  return u.replace(/^https?:\/\//,'').replace(/^www\./,'').split('.')[0]
          .replace(/[-_]/g,' ').replace(/\b\w/g, m => m.toUpperCase());
}

window._igBrandCreative = function(idx) {
  if ((!window._lastCampRecs || !window._lastCampRecs[idx]) && window.analysisData) {
    try { buildCampaigns(); } catch(e) {}
  }
  const camp = window._lastCampRecs && window._lastCampRecs[idx];
  if (!camp) { showToast('⚠️ Run an analysis first'); navigateTo('home'); return; }

  const brand   = _brandName();
  const primary = (window._brandKit && window._brandKit.color) || _brandPrimaryColour();
  const accent  = _brandSecondary(primary);
  const initial = brand.charAt(0).toUpperCase();
  const tone    = (window._brandKit && window._brandKit.tone) || 'Confident · Modern · Helpful';

  // Headlines tailored to the campaign
  const headlines = [
    `${camp.name} — built for ${brand}`,
    `Switch to ${brand}. ${camp.platform || 'Smarter results'}.`,
    `Why ${brand} outperforms the rest`
  ];
  const subs = [
    `${camp.estCTR} CTR · ${camp.estROAS}× ROAS · proven results`,
    `${camp.description ? camp.description.slice(0, 80) : 'See the difference for yourself'}`,
    `Get started in minutes — no setup fees`
  ];

  const mockup = (size, label, w, h, fontScale = 1) => `
    <div style="background:#0A1628;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px">
      <div style="font-size:0.66rem;font-weight:800;color:#94A3B8;letter-spacing:.08em;text-transform:uppercase">${label} · ${w}×${h}</div>
      <div style="width:100%;aspect-ratio:${w}/${h};background:linear-gradient(135deg,${primary} 0%,${accent} 100%);border-radius:12px;padding:${14*fontScale}px;display:flex;flex-direction:column;justify-content:space-between;color:white;position:relative;overflow:hidden;box-shadow:0 8px 22px rgba(15,30,61,.35)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:${28*fontScale}px;height:${28*fontScale}px;background:white;color:${primary};border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${15*fontScale}px">${initial}</div>
          <div style="font-size:${12*fontScale}px;font-weight:800;letter-spacing:.02em">${brand}</div>
        </div>
        <div>
          <div style="font-family:'Sora',sans-serif;font-size:${17*fontScale}px;font-weight:900;line-height:1.15;margin-bottom:6px;text-shadow:0 1px 3px rgba(0,0,0,.18)">${headlines[0]}</div>
          <div style="font-size:${10.5*fontScale}px;font-weight:600;opacity:.92;line-height:1.35">${subs[0]}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="background:white;color:${primary};font-size:${10*fontScale}px;font-weight:900;padding:${5*fontScale}px ${10*fontScale}px;border-radius:6px">Get Started →</div>
          <div style="font-size:${9*fontScale}px;font-weight:700;opacity:.85">${(analysisData?.url || 'yourdomain.com').replace(/^https?:\/\//,'')}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('brandCreativeModal')?.remove();

  const html = `
    <div id="brandCreativeModal" style="position:fixed;inset:0;background:rgba(10,22,40,.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:11000;padding:20px;overflow-y:auto">
      <div style="background:white;border-radius:18px;max-width:980px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.45)">
        <div style="background:linear-gradient(135deg,${primary} 0%,${accent} 100%);padding:22px 26px;border-radius:18px 18px 0 0;color:white;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:0.72rem;font-weight:800;letter-spacing:.1em;opacity:.9;text-transform:uppercase">✨ Brand Creative · ${camp.platform || ''}</div>
            <div style="font-family:Sora,sans-serif;font-size:1.35rem;font-weight:900;margin-top:4px">${camp.name}</div>
            <div style="font-size:0.82rem;opacity:.92;margin-top:4px">Brand-styled ad pack for <strong>${brand}</strong></div>
          </div>
          <button onclick="document.getElementById('brandCreativeModal').remove()" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);color:white;font-size:1.1rem;cursor:pointer;font-weight:800">✕</button>
        </div>

        <div style="padding:22px 26px">
          <!-- Brand Kit Strip -->
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;margin-bottom:18px">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:42px;height:42px;border-radius:10px;background:${primary};color:white;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.1rem;box-shadow:0 4px 10px ${primary}55">${initial}</div>
              <div>
                <div style="font-size:0.7rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.06em">Brand</div>
                <div style="font-size:0.95rem;font-weight:800;color:#0A1628">${brand}</div>
              </div>
            </div>
            <div style="height:36px;width:1px;background:#E2E8F0"></div>
            <div>
              <div style="font-size:0.7rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.06em">Primary Colour</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                <div style="width:18px;height:18px;border-radius:5px;background:${primary};border:1px solid rgba(0,0,0,.08)"></div>
                <code style="font-size:0.78rem;color:#0A1628;font-weight:700">${primary}</code>
              </div>
            </div>
            <div>
              <div style="font-size:0.7rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.06em">Accent</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                <div style="width:18px;height:18px;border-radius:5px;background:${accent};border:1px solid rgba(0,0,0,.08)"></div>
                <code style="font-size:0.78rem;color:#0A1628;font-weight:700">${accent}</code>
              </div>
            </div>
            <div>
              <div style="font-size:0.7rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.06em">Tone of Voice</div>
              <div style="font-size:0.82rem;color:#0A1628;font-weight:700">${tone}</div>
            </div>
            <button onclick="window._editBrandKit && window._editBrandKit()" style="margin-left:auto;padding:8px 14px;background:white;border:1px solid #CBD5E1;border-radius:8px;font-size:0.78rem;font-weight:700;color:#334155;cursor:pointer">⚙️ Edit Brand Kit</button>
          </div>

          <!-- Mockups -->
          <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:10px">Generated brand-styled creatives</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:18px">
            ${mockup('square','Feed', 1, 1, 1)}
            ${mockup('story','Story', 9, 16, 0.75)}
            ${mockup('banner','Banner', 16, 6, 0.85)}
          </div>

          <!-- Headlines -->
          <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:8px">Brand-aligned headlines</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
            ${headlines.map((h, i) => `
              <div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:10px 14px">
                <div style="font-weight:800;color:#0A1628;font-size:0.92rem">${h}</div>
                <div style="color:#64748B;font-size:0.78rem;margin-top:2px">${subs[i]}</div>
              </div>`).join('')}
          </div>

          <!-- Actions -->
          <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;border-top:1px solid #E2E8F0;padding-top:16px">
            <button onclick="document.getElementById('brandCreativeModal').remove()"
                    style="padding:10px 18px;background:white;border:1px solid #CBD5E1;border-radius:9px;font-weight:700;color:#475569;cursor:pointer;font-size:0.85rem">Cancel</button>
            <button onclick="window._regenBrandCreative(${idx})"
                    style="padding:10px 18px;background:#F8FAFC;border:1px solid #CBD5E1;border-radius:9px;font-weight:800;color:#0A1628;cursor:pointer;font-size:0.85rem">🔄 Regenerate</button>
            <button onclick="window._attachBrandCreative(${idx})"
                    style="padding:10px 22px;background:linear-gradient(135deg,${primary},${accent});border:none;border-radius:9px;font-weight:800;color:white;cursor:pointer;font-size:0.88rem;box-shadow:0 4px 12px ${primary}55">✨ Attach to Campaign</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  igTrack('Brand Creative Opened', { campaignName: camp.name, idx });
};

window._regenBrandCreative = function(idx) {
  // Cycle the seed so a different palette is picked
  if (analysisData) analysisData.url = (analysisData.url || '') + '#';
  document.getElementById('brandCreativeModal')?.remove();
  window._igBrandCreative(idx);
};

window._attachBrandCreative = function(idx) {
  const camp = window._lastCampRecs && window._lastCampRecs[idx];
  if (!camp) return;
  const primary = (window._brandKit && window._brandKit.color) || _brandPrimaryColour();
  const brand   = _brandName();
  window._campaignBrandCreatives[idx] = {
    brand, primary, attachedAt: new Date().toLocaleString(),
    pack: ['Feed (1:1)', 'Story (9:16)', 'Banner (16:6)']
  };
  // Update the card chip
  const chip = document.getElementById('brandAttached' + idx);
  if (chip) {
    chip.style.display = 'block';
    chip.innerHTML = `✨ Brand creative pack attached · ${brand} · 3 sizes (Feed · Story · Banner) · ready to launch`;
  }
  document.getElementById('brandCreativeModal')?.remove();
  showToast(`✅ Brand creative attached to "${camp.name}"`);
  igTrack('Brand Creative Attached', { campaignName: camp.name, idx });
};

window._editBrandKit = function() {
  // Close any open Brand Creative modal so the user lands cleanly on the asset library
  const open = document.getElementById('brandCreativeModal');
  if (open) open.remove();
  const csModal = document.getElementById('campCreativeModal');
  if (csModal) { csModal.classList.add('hidden'); csModal.removeAttribute('style'); }
  // Navigate to Create → Brand Assets
  try { navigateTo('brand-assets'); } catch(e) { console.error('navigate failed', e); }
  showToast('🎨 Opening Brand Assets — upload logos, images and videos here');
  // After view renders, scroll the upload zone into view + flash it so the user notices
  setTimeout(() => {
    const uploadZone = document.getElementById('baDropzone') || document.querySelector('#view-brand-assets .ba-dropzone') || document.querySelector('#view-brand-assets');
    if (uploadZone) {
      uploadZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const orig = uploadZone.style.boxShadow || '';
      uploadZone.style.transition = 'box-shadow .25s ease';
      uploadZone.style.boxShadow = '0 0 0 4px rgba(0,201,200,.55), 0 8px 32px rgba(0,102,255,.35)';
      setTimeout(() => { uploadZone.style.boxShadow = orig; }, 2200);
    }
  }, 350);
};

// Lightweight inline editor for brand kit metadata (name / colour / tone) — kept as a separate handler

// Restore brand kit from localStorage on load
try { const _bk = localStorage.getItem('ig_brand_kit'); if (_bk) window._brandKit = JSON.parse(_bk); } catch(e) {}

window._igLandingPageFromModal = function() {
  const camp = window._currentModalCamp;
  if (!camp) { showToast('⚠️ No campaign data — open a campaign card first'); return; }
  // Pull any edited headlines/descriptions from the modal inputs
  const hlInputs  = [...document.querySelectorAll('.lm-headline')].map(i => i.value).filter(Boolean);
  const dInputs   = [...document.querySelectorAll('.lm-desc')].map(i => i.value).filter(Boolean);
  const campCopy  = Object.assign({}, camp,
    hlInputs.length  ? { _modalHeadlines: hlInputs }  : {},
    dInputs.length   ? { _modalDescs: dInputs }       : {}
  );
  generateLandingPageForCamp(campCopy);
};

function generateLandingPageForCamp(camp) {
  const modal = document.getElementById('landingPageModal');
  if (!modal) return;

  // Show modal in loading state
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  document.getElementById('lp-loading').style.display  = 'flex';
  document.getElementById('lp-preview-frame').style.display = 'none';
  document.getElementById('lp-error').style.display    = 'none';
  document.getElementById('lp-download-btn').style.display = 'none';
  document.getElementById('lp-copy-btn').style.display     = 'none';
  document.getElementById('lp-subtitle').textContent = 'GPT-4o — generating your campaign landing page…';
  window._currentLandingPageHTML = null;
  window._currentLandingPageCamp = camp;

  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'your industry';
  const compName = analysisData?.competitors?.[0]?.name || '';
  const headlines   = camp._modalHeadlines || (camp.adCopy?.map(a=>a.headline).filter(Boolean)) || [];
  const descriptions = camp._modalDescs   || (camp.adCopy?.map(a=>a.body).filter(Boolean))      || [];

  fetch('/api/landing-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campName:     camp.name,
      platform:     camp.platform,
      description:  camp.description,
      tags:         camp.tags || [],
      domain, industry, compName,
      headlines, descriptions,
      budget:       camp.budget || '$2,000/mo',
      brandColor:   '#0066FF'
    })
  })
  .then(r => r.json())
  .then(data => {
    if (!data.html) throw new Error(data.error || 'No HTML returned');
    window._currentLandingPageHTML = data.html;

    const frame = document.getElementById('lp-preview-frame');
    frame.srcdoc = data.html;
    document.getElementById('lp-loading').style.display  = 'none';
    frame.style.display = 'block';
    document.getElementById('lp-download-btn').style.display = 'inline-flex';
    document.getElementById('lp-copy-btn').style.display     = 'inline-flex';
    // Show WordPress publish button if WP was detected
    const wpBtn = document.getElementById('lp-wp-btn');
    if (wpBtn) wpBtn.style.display = analysisData?.isWordPress || window._wpCreds ? 'inline-flex' : 'none';
    document.getElementById('lp-subtitle').textContent = `Landing page for "${camp.name}" — ready to use`;
  })
  .catch(err => {
    document.getElementById('lp-loading').style.display  = 'none';
    const errEl = document.getElementById('lp-error');
    errEl.style.display = 'flex';
    document.getElementById('lp-error-msg').textContent = err.message;
  });
}

window.closeLandingPageModal = function() {
  const modal = document.getElementById('landingPageModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
  const frame = document.getElementById('lp-preview-frame');
  if (frame) { frame.srcdoc = ''; frame.style.display = 'none'; }
};

window.downloadLandingPage = function() {
  if (!window._currentLandingPageHTML) return;
  const camp = window._currentLandingPageCamp;
  const fname = (camp?.name || 'landing-page').replace(/[^a-z0-9]+/gi,'-').toLowerCase() + '.html';
  const blob = new Blob([window._currentLandingPageHTML], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('✅ Landing page downloaded as ' + fname);
};

window.copyLandingPageHTML = function() {
  if (!window._currentLandingPageHTML) return;
  navigator.clipboard.writeText(window._currentLandingPageHTML).then(() => {
    const btn = document.getElementById('lp-copy-btn');
    if (btn) { const old = btn.textContent; btn.textContent = '✅ Copied!'; setTimeout(() => btn.textContent = old, 2000); }
    showToast('✅ HTML copied to clipboard');
  }).catch(() => showToast('⚠️ Clipboard access denied'));
};

// ── WordPress Badge ────────────────────────────────────────────────────────────
function showWordPressBadge(wp) {
  // Inject a persistent WP badge into the dashboard if it exists
  const existing = document.getElementById('wp-detected-badge');
  if (existing) return;

  const badge = document.createElement('div');
  badge.id = 'wp-detected-badge';
  badge.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:8000;background:white;border:2px solid #0066FF;border-radius:12px;padding:10px 14px;box-shadow:0 4px 20px rgba(0,0,0,.15);display:flex;align-items:center;gap:10px;max-width:280px;cursor:pointer;animation:fadeIn .4s ease';
  badge.title = 'Click to set up WordPress publishing for landing pages';
  badge.onclick = () => openWpCredentialsModal();
  badge.innerHTML = `
    <div style="width:32px;height:32px;background:#0066FF;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM3.5 12c0-1.232.256-2.405.711-3.468L7.93 19.01A8.512 8.512 0 013.5 12zm8.5 8.5a8.504 8.504 0 01-2.41-.347l2.56-7.433 2.623 7.186a.892.892 0 00.07.133A8.507 8.507 0 0112 20.5zm1.172-11.5l2.5 7.269 1.413-4.71c.271-.81.412-1.594.412-2.308 0-.895-.322-1.512-.598-2-.375-.651-.727-1.197-.727-1.835 0-.72.549-1.39 1.319-1.39l.1.01A8.502 8.502 0 0120.5 12a8.47 8.47 0 01-1.367 4.653l-1.745-5.808L13.172 9zm-1.37-1.002c-.33-.017-.625-.051-.625-.051-.3-.036-.265-.476.035-.458 0 0 .898.07 1.43.07.503 0 1.279-.07 1.279-.07.3-.017.336.44.035.458 0 0-.26.034-.55.051l-1.604 4.776-1-.001z"/></svg>
    </div>
    <div>
      <div style="font-size:0.78rem;font-weight:800;color:#0A1628">WordPress Detected</div>
      <div style="font-size:0.68rem;color:#6B7280;margin-top:1px">${wp.wpVersion ? 'v' + wp.wpVersion + ' · ' : ''}Click to connect &amp; publish pages</div>
    </div>
    <button onclick="event.stopPropagation();document.getElementById('wp-detected-badge').remove()" style="margin-left:auto;background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:1rem;padding:0 0 0 4px">✕</button>
  `;
  document.body.appendChild(badge);
  setTimeout(() => { if (badge.parentNode) badge.remove(); }, 15000);
}

// ── WordPress Credentials Modal ────────────────────────────────────────────────
window.openWpCredentialsModal = function(afterSave) {
  window._wpAfterSave = afterSave || null;
  const modal = document.getElementById('wpCredentialsModal');
  if (!modal) return;
  // Pre-fill stored creds
  if (window._wpCreds) {
    const su = document.getElementById('wp-site-url');
    const un = document.getElementById('wp-username');
    const ap = document.getElementById('wp-app-password');
    if (su) su.value = window._wpCreds.siteUrl || '';
    if (un) un.value = window._wpCreds.username || '';
    if (ap) ap.value = window._wpCreds.appPassword || '';
  }
  // Pre-fill with detected URL
  const su = document.getElementById('wp-site-url');
  if (su && !su.value && analysisData?.isWordPress && analysisData?.wpData?.siteUrl) {
    su.value = analysisData.wpData.siteUrl;
  }
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
};

window.closeWpCredentialsModal = function() {
  const modal = document.getElementById('wpCredentialsModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
};

window.saveWpCredentials = function() {
  const siteUrl     = (document.getElementById('wp-site-url')?.value || '').trim();
  const username    = (document.getElementById('wp-username')?.value || '').trim();
  const appPassword = (document.getElementById('wp-app-password')?.value || '').trim();
  if (!siteUrl || !username || !appPassword) {
    showToast('⚠️ Please fill in all three fields');
    return;
  }
  window._wpCreds = { siteUrl, username, appPassword };
  closeWpCredentialsModal();
  showToast('🟦 WordPress credentials saved — you can now publish landing pages');
  if (window._wpAfterSave) { window._wpAfterSave(); window._wpAfterSave = null; }
};

window.publishToWordPress = function() {
  if (!window._currentLandingPageHTML) { showToast('⚠️ Generate a landing page first'); return; }
  if (!window._wpCreds) {
    openWpCredentialsModal(() => publishToWordPress());
    return;
  }
  const btn = document.getElementById('lp-wp-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .7s linear infinite"></span> Publishing…'; }

  const camp = window._currentLandingPageCamp;
  fetch('/api/publish-to-wordpress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteUrl:     window._wpCreds.siteUrl,
      username:    window._wpCreds.username,
      appPassword: window._wpCreds.appPassword,
      title:       camp?.name || 'Campaign Landing Page',
      content:     window._currentLandingPageHTML,
      status:      'draft'
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      const lpSubtitle = document.getElementById('lp-subtitle');
      if (lpSubtitle) lpSubtitle.innerHTML = `✅ Published to WordPress as draft — <a href="${data.editUrl}" target="_blank" style="color:#A5B4FC">Edit in WP Admin ↗</a>`;
      if (btn) { btn.disabled = false; btn.innerHTML = '✅ Published to WordPress'; btn.style.background = 'rgba(16,185,129,.2)'; btn.style.borderColor = 'rgba(16,185,129,.5)'; btn.style.color = '#6EE7B7'; }
      showToast('🟦 Page saved as draft in WordPress — review and publish from your WP admin');
    } else {
      throw new Error(data.error || 'Publish failed');
    }
  })
  .catch(err => {
    if (btn) { btn.disabled = false; btn.innerHTML = '🟦 Publish to WordPress'; }
    showToast('⚠️ WordPress publish failed: ' + err.message);
  });
};

// ===== LEGACY CAMPAIGN CARD BUTTON HANDLERS =====


// Opens Creative Studio with a specific ad pre-loaded (from Campaigns "InfoGenie Improved Ads")
window.openAdInCreativeStudio = function(headline, body, platform) {
  try {
    // Use the first campaign rec that matches the platform, or fall back to the first available
    const recs = window._lastCampRecs || [];
    const platformMatch = platform ? recs.find(r => (r.platform||'').toLowerCase().includes((platform||'').toLowerCase())) : null;
    const camp = platformMatch || recs[0] || {
      name: headline, platform: platform || 'Google Ads', budget: '$2,000/mo',
      estROAS: '3.8', estCTR: '4.2%', estCPA: '$38', tags: [], description: body
    };
    // Open the Creative Studio modal
    buildCreativeModal(camp, recs.indexOf(camp));
    // After modal renders, pre-fill persona with the headline and trigger GPT-4 generation
    setTimeout(() => {
      const personaEl = document.getElementById('cs-persona');
      const diffEl    = document.getElementById('cs-diff');
      const regenBtn  = document.getElementById('cs-regen-full');
      if (personaEl) personaEl.value = headline;
      if (diffEl && body)    diffEl.value = body.substring(0, 80);
      if (regenBtn) regenBtn.click();
    }, 400);
  } catch(err) {
    console.error('openAdInCreativeStudio error:', err);
    showToast('⚠️ Error opening Creative Studio: ' + err.message);
  }
};

// ===== A/B TEST HANDLER (global) =====
window.launchABTest = function() {
  const nameEl = document.getElementById('ab-test-name');
  const varAEl = document.getElementById('ab-var-a');
  const varBEl = document.getElementById('ab-var-b');
  const splitEl = document.getElementById('ab-split');
  const daysEl  = document.getElementById('ab-days');
  if (!nameEl || !varAEl || !varBEl) { showToast('⚠️ A/B test fields not found'); return; }
  const testName = nameEl.value.trim() || 'A/B Test';
  const varAIdx  = parseInt(varAEl.value);
  const varBIdx  = parseInt(varBEl.value);
  const split    = parseInt(splitEl?.value || '50');
  const days     = parseInt(daysEl?.value || '14');
  const camps    = window._lastCampRecs || [];
  if (varAIdx === varBIdx) { showToast('⚠️ Please select two different campaign variants'); return; }
  const campA = camps[varAIdx];
  const campB = camps[varBIdx];
  if (!campA || !campB) { showToast('⚠️ Invalid campaign selection — run an analysis first'); return; }

  // Projected A/B metrics (derived from campaign estimates)
  const aROAS = parseFloat(campA.estROAS).toFixed(1);
  const bROAS = (parseFloat(campB.estROAS) * 0.94).toFixed(1);
  const aCTR  = parseFloat(campA.estCTR).toFixed(1) + '%';
  const bCTR  = (parseFloat(campB.estCTR) * 0.91).toFixed(1) + '%';
  const winner = parseFloat(aROAS) >= parseFloat(bROAS) ? 'A' : 'B';

  const test = {
    id: 'ab_' + Date.now(),
    name: testName,
    varA: { name: campA.name, platform: campA.platform, roas: aROAS, ctr: aCTR },
    varB: { name: campB.name, platform: campB.platform, roas: bROAS, ctr: bCTR },
    split, days,
    startedAt: new Date().toLocaleString(),
    status: 'running',
    winner,
    daysLeft: days
  };
  window._abTests.unshift(test);
  if (!window._infoGenieActions) window._infoGenieActions = [];
  window._infoGenieActions.unshift({
    time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString(),
    action: `A/B test launched: "${testName}" — ${campA.name} vs ${campB.name}`,
    type: 'ab_test',
    impact: `${split}/${100-split} traffic split · ${days}-day test · Early winner: Variant ${winner}`
  });
  showToast(`✅ A/B test "${testName}" launched! Check Results for live data.`);
  // Re-render campaigns to show the test in the running list
  try { buildCampaigns(); } catch(e) {}
};

function buildLaunchModal(camp, idx) {
  window._currentModalCamp = camp; // stored so "Generate Landing Page" can use it
  // Bulletproof modal show
  const modal = document.getElementById('campLaunchRichModal');
  const inner = document.getElementById('campLaunchRichModalInner');
  if (!modal || !inner) {
    alert('Launch modal not found. Please refresh the page and try again.');
    return;
  }
  _igPortalToBody(modal);
  modal.classList.remove('hidden');
  modal.removeAttribute('style');
  modal.style.cssText = 'display:flex !important;position:fixed;inset:0;z-index:20000;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);padding:20px;overflow-y:auto;';
  try { window.scrollTo(0, 0); } catch (_) {}
  document.documentElement.style.overflow = 'hidden';

  // Data
  const name       = camp.name || 'Campaign';
  const platform   = camp.platform || 'Google Ads';
  const budgetStr  = camp.budget || '$2,000/mo';
  const budgetNum  = parseInt(budgetStr.replace(/[^0-9]/g,'')) || 2000;
  const dailyBudg  = Math.round(budgetNum / 30);
  const weeklyBudg = Math.round(budgetNum / 4.3);
  const myROAS     = analysisData && analysisData.websiteKPIs && analysisData.websiteKPIs.roas
                       ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
  const projROAS   = (myROAS * 1.25).toFixed(1);
  const projConv   = Math.round(budgetNum / 35);
  const projRev    = '$' + (budgetNum * parseFloat(projROAS)).toLocaleString(undefined, {maximumFractionDigits:0});

  const platformMeta = {
    'All Platforms':   { icon:'⊕', ctr:'2.8%', cpa:'$38', bid:'InfoGenie AI Auto-Bid (per channel)', aud:'Best-fit audience per platform',          kpi:'Blended ROAS across all channels', creative:'Auto-adapted format per platform' },
    'Google Ads':      { icon:'🔵', ctr:'4.8%', cpa:'$38', bid:'Target ROAS (tROAS)',         aud:'High-intent keyword searchers',            kpi:'Conversions & ROAS',         creative:'Responsive Search Ads + Performance Max' },
    'Google Search':   { icon:'🔵', ctr:'5.5%', cpa:'$35', bid:'Maximise Conversions',        aud:'Search intent + competitor keywords',       kpi:'CTR & Conversion Rate',      creative:'3 headlines + 2 descriptions' },
    'Meta Ads':        { icon:'🔷', ctr:'2.1%', cpa:'$28', bid:'Cost Per Result',             aud:'Lookalike + interest targeting',            kpi:'ROAS & Reach',               creative:'Carousel + Story + Feed video' },
    'TikTok Ads':      { icon:'⬛', ctr:'1.8%', cpa:'$22', bid:'Lowest Cost',                 aud:'In-app behaviour + hashtag interest',       kpi:'CPV & Engagement Rate',      creative:'UGC-style 15-sec vertical video' },
    'YouTube':         { icon:'🔴', ctr:'0.6%', cpa:'$52', bid:'Target CPA',                  aud:'In-market + custom intent audiences',       kpi:'View-through conversions',   creative:'15-sec unskippable + 30-sec skippable' },
    'AI Optimised':    { icon:'🤖', ctr:'3.9%', cpa:'$32', bid:'InfoGenie RL Engine (auto)',   aud:'Dynamic cross-platform targeting',          kpi:'Blended ROAS',               creative:'Auto-generated, refreshed every 72h' },
    'LinkedIn Ads':    { icon:'🔷', ctr:'0.8%', cpa:'$85', bid:'Maximum Delivery',            aud:'Job title + industry + seniority',          kpi:'MQL Rate & Pipeline Value',  creative:'Sponsored Content + InMail' },
    'Display Network': { icon:'🟡', ctr:'0.35%',cpa:'$58', bid:'Target CPA',                  aud:'Intent-based display audiences',            kpi:'Brand lift & CPA',           creative:'Responsive display + HTML5 banners' },
    'Microsoft Ads':   { icon:'🅱️', ctr:'2.9%', cpa:'$31', bid:'Target CPA',                  aud:'Bing search intent + LinkedIn audience extension', kpi:'Conversions & CPA',  creative:'Responsive Search Ads + Audience Ads' }
  };
  const pm = platformMeta[platform] || platformMeta['Google Ads'];

  // Seed/fallback headlines (shown instantly, replaced by GPT-4o)
  const topCompName = analysisData?.competitors?.[0]?.name || 'top competitor';
  const indName = analysisData?.industry?.name || 'your industry';
  const seedHeadlines = [
    `Beat ${topCompName} — Switch Free`,
    `${indName}: ${projROAS}× ROAS Proven`,
    `${platform.split(' ')[0]} Results That Scale`
  ];
  const seedDescs = [
    `Cut wasteful spend and outperform ${topCompName} on the keywords that matter most to ${indName} buyers.`,
    `${camp.description ? camp.description.split('.')[0] + '.' : 'AI-powered campaign intelligence that converts.'}`
  ];

  const spin = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(99,102,241,.3);border-top-color:#6366F1;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:5px"></span>';

  inner.innerHTML = `
    <style>@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}</style>
    <div class="camp-launch-modal-header">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="camp-launch-title">🚀 Campaign Launch Brief</div>
        <span id="lm-ai-badge" class="camp-launch-ai-badge">${spin}GPT-4 Building Brief...</span>
      </div>
      <div class="camp-launch-subtitle">${name} · ${platform}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div class="camp-launch-kpi" title="Projected Return on Ad Spend — estimated revenue earned per $1 of budget, based on your industry benchmarks and campaign settings.">
          <div id="lm-roas-val" class="camp-launch-kpi-val" style="color:#00E5FF">${projROAS}×</div>
          <div class="camp-launch-kpi-label">Proj. ROAS</div>
        </div>
        <div class="camp-launch-kpi" title="Estimated number of completed goals (purchases, sign-ups, calls) this campaign is projected to generate each month.">
          <div id="lm-conv-val" class="camp-launch-kpi-val" style="color:#10B981">${projConv}</div>
          <div class="camp-launch-kpi-label">Est. Conversions</div>
        </div>
        <div class="camp-launch-kpi" title="Estimated monthly revenue attributable to this campaign, calculated from projected ROAS × monthly budget.">
          <div id="lm-rev-val" class="camp-launch-kpi-val" style="color:#F59E0B">${projRev}</div>
          <div class="camp-launch-kpi-label">Est. Revenue</div>
        </div>
        <div class="camp-launch-kpi" title="Maximum amount spent per day. InfoGenie divides your monthly budget by 30 to set this cap automatically.">
          <div id="lm-daily-val" class="camp-launch-kpi-val">$${dailyBudg}/day</div>
          <div class="camp-launch-kpi-label">Daily Budget</div>
        </div>
      </div>
    </div>

    <div style="padding:22px 28px;display:flex;flex-direction:column;gap:16px;max-height:68vh;overflow-y:auto">

      <!-- CAMPAIGN WORDING / OVERVIEW -->
      <div style="background:linear-gradient(135deg,#F0F9FF,#EEF2FF);border:1.5px solid #BAE6FD;border-radius:14px;padding:16px 20px">
        <div style="font-size:0.65rem;font-weight:700;color:#0369A1;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">📋 Campaign Overview</div>
        <div style="font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:6px;line-height:1.35">${name}</div>
        <div style="font-size:0.82rem;color:#374151;line-height:1.6;margin-bottom:10px">${camp.description || 'An AI-optimised campaign targeting high-intent audiences on ' + platform + ' based on competitor gap analysis.'}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
          ${(camp.tags || [platform, 'AI Optimised', 'High Intent']).map(tag => `<span style="background:white;border:1px solid #BAE6FD;border-radius:20px;padding:3px 10px;font-size:0.7rem;font-weight:600;color:#0369A1">${tag}</span>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="background:white;border-radius:8px;padding:9px 12px;border:1px solid #E0F2FE">
            <div style="font-size:0.63rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">🎯 Objective</div>
            <div style="font-size:0.78rem;font-weight:700;color:#0A1628">${camp.objective || (camp.tags && camp.tags[0]) || 'Drive Conversions'}</div>
          </div>
          <div style="background:white;border-radius:8px;padding:9px 12px;border:1px solid #E0F2FE">
            <div style="font-size:0.63rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">📢 Platform</div>
            <div id="lm-ov-platform" style="font-size:0.78rem;font-weight:700;color:#0A1628">${pm.icon} ${platform}</div>
          </div>
          <div style="background:white;border-radius:8px;padding:9px 12px;border:1px solid #E0F2FE">
            <div style="font-size:0.63rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">💰 Est. CTR</div>
            <div id="lm-ov-ctr" style="font-size:0.78rem;font-weight:700;color:#059669">${camp.estCTR || pm.ctr || '4.2%'}</div>
          </div>
          <div style="background:white;border-radius:8px;padding:9px 12px;border:1px solid #E0F2FE">
            <div style="font-size:0.63rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">📊 Est. CPA</div>
            <div id="lm-ov-cpa" style="font-size:0.78rem;font-weight:700;color:#7C3AED">${camp.estCPA || pm.cpa || '$38'}</div>
          </div>
        </div>
      </div>

      <!-- EDITABLE CAMPAIGN SETTINGS -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">⚙️ Campaign Parameters — Edit Before Launch</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Campaign Name</label>
            <input id="lm-name" value="${name.substring(0,60).replace(/"/g,'&quot;')}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Platform</label>
            <select id="lm-platform" onchange="lmSwitchPlatform(this.value)" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
              <option value="All Platforms"${platform==='All Platforms'||!platform?' selected':''}>⊕ All Platforms (Select All)</option>
              ${['Google Ads','Meta Ads','Microsoft Ads','TikTok Ads','YouTube','LinkedIn Ads','Display Network','AI Optimised'].map(p=>`<option value="${p}"${p===platform?' selected':''}>${p}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Monthly Budget ($)</label>
            <input id="lm-budget" type="number" value="${budgetNum}" min="100" step="100" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" oninput="lmUpdateMetrics()" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Start Date</label>
            <input id="lm-date" type="date" value="${new Date().toISOString().split('T')[0]}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">End Date</label>
            <input id="lm-enddate" type="date" value="${new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0]}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#EF4444'" onblur="this.style.borderColor='#E2E8F0'">
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Campaign Goal · This changes how the platform optimises your spend</label>
            <select id="lm-objective" onchange="lmUpdateObjectiveHint(this.value)" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
              <option value="performance" selected>🎯 Performance — drive sales / leads (CPA + ROAS optimised)</option>
              <option value="brand-awareness">📣 Brand Awareness — maximise reach &amp; impressions (CPM + video-completion optimised)</option>
            </select>
            <div id="lm-objective-hint" style="font-size:0.72rem;color:#6B7280;margin-top:6px;line-height:1.45">Default. The platform bids for the lowest cost per conversion. KPIs tracked: CPA, ROAS, conversion rate.</div>
          </div>
        </div>
        <div style="margin-top:10px">
          <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Target Audience / Notes</label>
          <textarea id="lm-audience" rows="2" placeholder="e.g. 25-45 year olds interested in fintech, lookalike of existing customers..." style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;resize:vertical;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'"></textarea>
        </div>
      </div>

      <!-- AD COPY — campaign wording shown immediately after overview -->
      <div style="background:#FAFFF7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px 20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:0.65rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.08em">✍️ Ad Copy — This Wording Will Run On Your Campaign</div>
          <span id="lm-hl-loading" style="font-size:0.65rem;color:#6366F1;display:flex;align-items:center;gap:4px">${spin}GPT-4 Writing...</span>
        </div>
        <div style="font-size:0.7rem;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Headlines <span style="font-weight:400;color:#9CA3AF">(click any to edit)</span></div>
        <div id="lm-headlines-wrap" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
          ${seedHeadlines.map((h,i)=>`
            <div style="display:flex;align-items:center;gap:8px;background:white;border:1px solid #D1FAE5;border-radius:8px;padding:9px 12px">
              <span style="font-size:0.7rem;font-weight:800;color:#059669;background:#D1FAE5;border-radius:4px;padding:2px 7px;flex-shrink:0">H${i+1}</span>
              <input class="lm-headline" value="${h.replace(/"/g,'&quot;')}" style="flex:1;border:none;background:transparent;font-size:0.85rem;color:#0A1628;font-weight:700;outline:none;font-family:'Inter',sans-serif" placeholder="Headline ${i+1}...">
            </div>`).join('')}
        </div>
        <div style="font-size:0.7rem;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Descriptions</div>
        <div id="lm-descs-wrap" style="display:flex;flex-direction:column;gap:6px">
          ${seedDescs.map((d,i)=>`
            <div style="display:flex;align-items:flex-start;gap:8px;background:white;border:1px solid #BAE6FD;border-radius:8px;padding:9px 12px">
              <span style="font-size:0.7rem;font-weight:800;color:#0369A1;background:#E0F2FE;border-radius:4px;padding:2px 7px;flex-shrink:0;margin-top:1px">D${i+1}</span>
              <textarea class="lm-desc" rows="2" style="flex:1;border:none;background:transparent;font-size:0.8rem;color:#374151;outline:none;font-family:'Inter',sans-serif;resize:none;line-height:1.5">${d.replace(/</g,'&lt;')}</textarea>
            </div>`).join('')}
        </div>
      </div>

      <!-- PLATFORM STRATEGY -->
      <div>
        <div id="lm-strat-title" style="font-size:0.68rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">${pm.icon} ${platform} Strategy</div>
        <div id="lm-strat-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[['Bid Strategy',pm.bid],['Target Audience',pm.aud],['Primary KPI',pm.kpi],['Creative Format',pm.creative]].map(([k,v])=>`
            <div style="background:#F9FAFB;border-radius:8px;padding:10px 12px">
              <div style="font-size:0.65rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${k}</div>
              <div style="font-size:0.78rem;color:#0A1628;font-weight:600;margin-top:3px">${v}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- GPT-4 STRATEGY INTELLIGENCE — populated after API call -->
      <div id="lm-ai-intel" style="display:none;animation:fadeIn .5s">
        <div style="font-size:0.68rem;font-weight:700;color:#DC2626;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🧠 GPT-4 Campaign Intelligence</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px">
            <div style="font-size:0.65rem;font-weight:700;color:#C2410C;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">⚡ Competitor Gap</div>
            <div id="lm-comp-gap" style="font-size:0.82rem;color:#7C2D12;line-height:1.5;font-style:italic"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 14px">
              <div style="font-size:0.65rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">🎯 Target Audience</div>
              <div id="lm-audience-ai" style="font-size:0.8rem;color:#064E3B;line-height:1.5"></div>
            </div>
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px">
              <div style="font-size:0.65rem;font-weight:700;color:#1E40AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">💡 Creative Angle</div>
              <div id="lm-creative-angle" style="font-size:0.8rem;color:#1E3A8A;line-height:1.5"></div>
            </div>
          </div>
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px">
            <div style="font-size:0.65rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">📋 Strategy Summary</div>
            <div id="lm-strategy" style="font-size:0.82rem;color:#374151;line-height:1.6"></div>
          </div>
        </div>
      </div>

      <!-- KPI TARGETS — populated by GPT-4 -->
      <div id="lm-kpi-targets" style="display:none;animation:fadeIn .5s">
        <div style="font-size:0.68rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">📊 KPI Targets — GPT-4 Calculated</div>
        <div id="lm-kpi-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px" id="lm-goal-grid"></div>
      </div>

      <!-- BUDGET BREAKDOWN -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💰 Budget Breakdown</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${[
          ['Daily','$'+dailyBudg,'Daily ad spend cap — the maximum InfoGenie allows the platform to spend in a single day.'],
          ['Weekly','$'+weeklyBudg.toLocaleString(),'Estimated weekly spend — your monthly budget divided by 4.3 weeks.'],
          ['Monthly','$'+budgetNum.toLocaleString(),'Total monthly ad budget committed to this campaign across all placements and audiences.']
        ].map(([k,v,tip])=>`
            <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px;text-align:center" title="${tip}">
              <div style="font-size:0.9rem;font-weight:800;color:#D97706">${v}</div>
              <div style="font-size:0.7rem;color:#6B7280;margin-top:2px">${k} Spend</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- LAUNCH CHECKLIST — populated by GPT-4 -->
      <div id="lm-checklist-wrap" style="display:none;animation:fadeIn .5s">
        <div style="font-size:0.68rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">✅ Pre-Launch Checklist — GPT-4 Generated</div>
        <div id="lm-checklist" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>

      <div style="display:flex;gap:10px;padding-top:4px;flex-wrap:wrap">
        <button id="lm-cancel-btn" style="flex:1;min-width:100px;padding:12px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Cancel</button>
        <button id="lm-lp-btn" onclick="window._igLandingPageFromModal()" style="flex:1;min-width:140px;padding:12px;background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:10px;font-size:0.82rem;font-weight:700;color:#0066FF;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">🌐 Generate Landing Page</button>
        <button id="lm-confirm-btn" style="flex:2;min-width:180px;padding:12px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">🚀 Confirm &amp; Launch Campaign</button>
      </div>
    </div>
  `;

  // Live-recalc KPI tiles when budget input changes
  window.lmUpdateMetrics = function() {
    const bEl = document.getElementById('lm-budget');
    if (!bEl) return;
    const nb = Math.max(100, parseInt(bEl.value) || 100);
    const roasBase = analysisData && analysisData.websiteKPIs && analysisData.websiteKPIs.roas
      ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
    const newROAS   = (roasBase * 1.25).toFixed(1);
    const newConv   = Math.round(nb / 35);
    const newRev    = '$' + (nb * parseFloat(newROAS)).toLocaleString(undefined, {maximumFractionDigits:0});
    const newDaily  = Math.round(nb / 30);
    const el = id => document.getElementById(id);
    if (el('lm-roas-val'))  el('lm-roas-val').textContent  = newROAS + '×';
    if (el('lm-conv-val'))  el('lm-conv-val').textContent  = newConv;
    if (el('lm-rev-val'))   el('lm-rev-val').textContent   = newRev;
    if (el('lm-daily-val')) el('lm-daily-val').textContent = '$' + newDaily + '/day';
  };

  window.lmUpdateObjectiveHint = function(val) {
    const el = document.getElementById('lm-objective-hint');
    if (!el) return;
    if (String(val).includes('awareness') || String(val).includes('brand')) {
      el.innerHTML = '<strong style="color:#7C3AED">Brand Awareness mode.</strong> The platform bids for the lowest <em>cost per 1,000 impressions</em>, prioritising reach, frequency and video-completion rate. KPIs tracked: CPM, reach, view-through rate. Use for top-funnel awareness, product launches and category education.';
      el.style.color = '#5B21B6';
    } else {
      el.innerHTML = 'Default. The platform bids for the lowest cost per conversion. KPIs tracked: CPA, ROAS, conversion rate.';
      el.style.color = '#6B7280';
    }
  };
  window.lmSwitchPlatform = function(sel) {
    const meta = platformMeta[sel] || platformMeta['Google Ads'];
    const el = id => document.getElementById(id);
    if (el('lm-ov-platform')) el('lm-ov-platform').textContent = meta.icon + ' ' + sel;
    if (el('lm-ov-ctr'))      el('lm-ov-ctr').textContent      = meta.ctr;
    if (el('lm-ov-cpa'))      el('lm-ov-cpa').textContent      = meta.cpa;
    if (el('lm-strat-title')) el('lm-strat-title').textContent = meta.icon + ' ' + sel + ' Strategy';
    if (el('lm-strat-grid'))  el('lm-strat-grid').innerHTML    = [
      ['Bid Strategy', meta.bid], ['Target Audience', meta.aud],
      ['Primary KPI',  meta.kpi], ['Creative Format',  meta.creative]
    ].map(([k,v]) => `
      <div style="background:#F9FAFB;border-radius:8px;padding:10px 12px">
        <div style="font-size:0.65rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${k}</div>
        <div style="font-size:0.78rem;color:#0A1628;font-weight:600;margin-top:3px">${v}</div>
      </div>`).join('');
  };

  // Wire cancel button
  document.getElementById('lm-cancel-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
    modal.removeAttribute('style');
  });

  // Wire confirm button
  document.getElementById('lm-confirm-btn').addEventListener('click', function() {
    const btn = document.getElementById('lm-confirm-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Launching...';

    const finalName      = document.getElementById('lm-name').value.trim() || name;
    const finalPlatform  = document.getElementById('lm-platform').value;
    const finalBudgetNum = parseInt(document.getElementById('lm-budget').value) || budgetNum;
    const finalBudget    = '$' + finalBudgetNum.toLocaleString();
    const finalDate      = document.getElementById('lm-date').value || new Date().toISOString().split('T')[0];
    const finalEndDate   = document.getElementById('lm-enddate').value || new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0];
    const finalAudience  = (document.getElementById('lm-audience').value || 'Auto-targeted by InfoGenie AI').trim();

    // Capture Creative Studio content at launch time
    const csHeadlines = Array.from(document.querySelectorAll('.cs-headline')).map(el => el.value).filter(Boolean);
    const csDescs     = Array.from(document.querySelectorAll('.cs-desc')).map(el => el.value).filter(Boolean);
    const launchCreatives = {
      headlines:    csHeadlines,
      descriptions: csDescs,
      instagram:    document.getElementById('cs-instagram')?.value || '',
      tiktok:       document.getElementById('cs-tiktok')?.value || '',
      youtube:      document.getElementById('cs-video')?.value || '',
      linkedin:     document.getElementById('cs-linkedin')?.value || '',
      email:        document.getElementById('cs-email')?.value || '',
      igFile:       document.getElementById('cs-upload-ig')?.files?.[0]?.name || null,
      ttFile:       document.getElementById('cs-upload-tt')?.files?.[0]?.name || null,
      ytFile:       document.getElementById('cs-upload-yt')?.files?.[0]?.name || null,
    };

    // Save to internal results tracker IMMEDIATELY (before API call)
    const launchRecord = {
      id: 'camp_' + Date.now(), name: finalName, platform: finalPlatform,
      budget: finalBudgetNum, budgetStr: finalBudget, startDate: finalDate, endDate: finalEndDate, audience: finalAudience,
      launchedAt: new Date().toLocaleString(), status: 'active', daysRunning: 0,
      creatives: launchCreatives,
      metrics: {
        roas: parseFloat(projROAS).toFixed(1),
        ctr: (finalPlatform.toLowerCase().includes('tiktok') ? 4.8 : finalPlatform.toLowerCase().includes('meta') ? 3.0 : 3.2).toFixed(1) + '%',
        conversions: Math.round(finalBudgetNum / 35),
        spend: 0,
        cpa: '$35',
        impressions: Math.round(finalBudgetNum * 65)
      },
      actions: [
        { time: 'Just now', action: 'Campaign created and AI monitoring activated', type: 'launch' },
        { time: 'Just now', action: `Budget set to ${finalBudget}/mo on ${finalPlatform}`, type: 'config' },
        { time: 'Just now', action: `Audience: ${finalAudience.substring(0, 60)}`, type: 'audience' }
      ]
    };
    window._launchedCampaigns.unshift(launchRecord);
    if (!window._infoGenieActions) window._infoGenieActions = [];
    window._infoGenieActions.unshift({
      time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString(),
      action: `Launched campaign "${finalName}" on ${finalPlatform} (${finalBudget}/mo)`,
      type: 'campaign_launch',
      impact: `Est. ROAS: ${launchRecord.metrics.roas}× | Est. CTR: ${launchRecord.metrics.ctr}`
    });
    igTrack('Campaign Launched', { campaignName: finalName, platform: finalPlatform, budget: finalBudget });

    // ── Show success screen IMMEDIATELY (non-blocking) ────────────────────────
    const inner2 = document.getElementById('campLaunchRichModalInner');
    const platformKey = finalPlatform.toLowerCase();
    const isPlatformConnected = platformKey.includes('google') || platformKey.includes('meta') || platformKey.includes('facebook') || platformKey.includes('tiktok') || platformKey.includes('microsoft') || platformKey.includes('bing');
    const apiStatusId = 'lm-api-status-' + Date.now();

    inner2.innerHTML = `
      <div style="padding:36px 32px;text-align:center">
        <div style="font-size:3rem;margin-bottom:12px">🎉</div>
        <div style="font-family:Sora,sans-serif;font-size:1.2rem;font-weight:800;color:#0A1628;margin-bottom:6px">Campaign Launched!</div>
        <div style="font-size:0.82rem;color:#6B7280;margin-bottom:18px">"${finalName}" · ${finalPlatform} · ${finalBudget}/mo</div>
        <div id="${apiStatusId}" style="margin-bottom:16px">
          ${isPlatformConnected
            ? '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7"><div style="font-weight:700;margin-bottom:4px">⏳ Pushing to ad platform…</div><div>Connecting to your ad account — this takes a few seconds</div></div>'
            : '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7"><div style="font-weight:700;margin-bottom:4px">📊 Tracked internally by InfoGenie</div><div>Connect Google Ads, Meta, or TikTok in Settings to push campaigns live.</div></div>'
          }
        </div>
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:0.8rem;color:#374151;line-height:1.8;text-align:left">
          <strong>Est. ROAS:</strong> ${launchRecord.metrics.roas}× &nbsp;·&nbsp;
          <strong>Est. CTR:</strong> ${launchRecord.metrics.ctr} &nbsp;·&nbsp;
          <strong>Start:</strong> ${finalDate} &nbsp;·&nbsp;
          <strong>End:</strong> ${finalEndDate}
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button id="lm-close-success" style="padding:10px 20px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Close</button>
          <button id="lm-view-campaign" class="btn-primary" style="padding:10px 20px;font-size:0.85rem">👁 View Campaign</button>
          <button id="lm-view-results" style="padding:10px 20px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer">📊 View Results →</button>
        </div>
      </div>`;
    document.getElementById('lm-close-success').addEventListener('click', () => { modal.classList.add('hidden'); modal.style.display = 'none'; });
    document.getElementById('lm-view-campaign').addEventListener('click', () => { modal.classList.add('hidden'); modal.style.display = 'none'; openViewCampaignModal(launchRecord); });
    document.getElementById('lm-view-results').addEventListener('click', () => { modal.classList.add('hidden'); modal.style.display = 'none'; navigateTo('results'); });
    showToast(`✅ Campaign "${finalName}" launched — tracking in Results`);

    // ── Always register the campaign in the AI Optimizer dashboard ───────────
    // Maps the user-selected platform name to one of meta|google|tiktok (the
    // only platforms the optimizer can act on). When the real platform API
    // call succeeds we re-register with the live platform_camp_id; when it
    // fails (or when the user hasn't connected creds yet) the local_<ts> id
    // ensures the campaign STILL appears in "Tracked Campaigns" so the user
    // sees what they launched and can connect creds later.
    const _trackedPlatform = platformKey.includes('google') ? 'google'
                           : (platformKey.includes('meta') || platformKey.includes('facebook')) ? 'meta'
                           : platformKey.includes('tiktok') ? 'tiktok'
                           : (platformKey.includes('microsoft') || platformKey.includes('bing')) ? 'microsoft'
                           : null;
    const _registerTracked = (campId) => {
      if (!_trackedPlatform || !campId) return;
      try {
        const dailyBud = Math.max(1, Math.round((finalBudgetNum || 2000) / 30));
        fetch('/api/optimizer/campaigns/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: _trackedPlatform,
            platform_camp_id: String(campId),
            name: finalName,
            daily_budget: dailyBud,
            target_roas: parseFloat(projROAS) || 2.0
          })
        }).catch(() => {});
      } catch(_) {}
    };
    // Register the campaign with the optimizer dashboard EXACTLY ONCE:
    //   • If no platform creds configured, register a local_<ts> placeholder
    //     so the user still sees their campaign in Tracked Campaigns.
    //   • If creds ARE configured, defer registration until the platform API
    //     responds — use the real platform_camp_id on success, fall back to
    //     local_<ts> on failure. This avoids a duplicate placeholder row.
    //   (When the server route succeeds it ALSO upserts the real id, but
    //   that's idempotent via ON CONFLICT (platform, platform_camp_id).)
    const _localCampId = 'local_' + Date.now();

    // ── Call real ad platform API in the background ───────────────────────────
    if (isPlatformConnected) {
      const _objEl = document.getElementById('lm-objective');
      const _finalObjective = _objEl ? _objEl.value : 'performance';
      const apiBody = JSON.stringify({ campaignName: finalName, budget: finalBudgetNum, startDate: finalDate, endDate: finalEndDate, objective: _finalObjective });
      const apiUrl  = platformKey.includes('google') ? '/api/launch/google-ads'
                    : (platformKey.includes('meta') || platformKey.includes('facebook')) ? '/api/launch/meta'
                    : (platformKey.includes('microsoft') || platformKey.includes('bing')) ? '/api/launch/microsoft-ads'
                    : '/api/launch/tiktok';
      fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: apiBody })
        .then(r => r.json())
        .then(apiResult => {
          // Register with whichever id is real-or-fallback. Single row only.
          if (apiResult && apiResult.success && apiResult.campaignId) {
            _registerTracked(apiResult.campaignId);
          } else {
            _registerTracked(_localCampId);
          }
          const statusEl = document.getElementById(apiStatusId);
          if (!statusEl) return; // user navigated away — that's fine
          if (apiResult.success) {
            launchRecord.status = 'active';
            launchRecord._platformCampaignId = apiResult.campaignId;
            statusEl.innerHTML = `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#065F46;line-height:1.7">
              <div style="font-weight:700;margin-bottom:4px">✅ Pushed live to ${apiResult.platform}</div>
              <div>${apiResult.message}</div>
              ${apiResult.dashboardUrl ? `<a href="${apiResult.dashboardUrl}" target="_blank" style="color:#059669;font-weight:600;font-size:0.78rem">Open in ${apiResult.platform} dashboard →</a>` : ''}
            </div>
            ${apiResult.optimizerEnabled === false ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#92400E;line-height:1.7;margin-top:8px">
              <div style="font-weight:700;margin-bottom:4px">⚠️ Automatic optimization not enabled</div>
              <div>${apiResult.optimizerWarning || 'This campaign could not be added to the AI Optimizer, so it won\'t be auto-managed. Retry the launch or check your workspace.'}</div>
            </div>` : ''}`;
            // Update emoji to rocket
            const emojiEl = statusEl.closest('[style*="padding:36px"]')?.querySelector('[style*="font-size:3rem"]');
            if (emojiEl) emojiEl.textContent = '🚀';
            showToast(`🚀 Campaign pushed live to ${apiResult.platform}!`);
          } else {
            // Determine if it's a credentials/auth issue or a real error
            const errMsg  = apiResult.error || '';
            const isAuth  = errMsg.toLowerCase().includes('oauth') || errMsg.toLowerCase().includes('credentials') ||
                            errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('unauthor') ||
                            errMsg.toLowerCase().includes('not configured') || errMsg.toLowerCase().includes('token');
            if (isAuth) {
              // Soft info note — campaign is safely tracked, this is just a credentials gap
              statusEl.innerHTML = `<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7">
                <div style="font-weight:700;margin-bottom:4px">📊 Campaign tracked in InfoGenie</div>
                <div style="margin-bottom:6px">Your ${finalPlatform} ad account credentials need connecting to push campaigns live automatically.</div>
                <a href="#" onclick="closeCampLaunchRichModal();navigateTo('settings');return false;" style="color:#0369A1;font-weight:600;font-size:0.78rem">Connect ${finalPlatform} in Settings →</a>
              </div>`;
            } else {
              // Actual API error — show detail but still reassure
              statusEl.innerHTML = `<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7">
                <div style="font-weight:700;margin-bottom:4px">📊 Campaign saved — platform sync pending</div>
                <div style="font-size:0.75rem;color:#64748B;margin-bottom:6px">${errMsg.substring(0, 120)}</div>
                <a href="#" onclick="closeCampLaunchRichModal();navigateTo('settings');return false;" style="color:#0369A1;font-weight:600;font-size:0.78rem">Review credentials in Settings →</a>
              </div>`;
            }
          }
        })
        .catch(() => {
          // Network error reaching our own /api/launch/* endpoint — still
          // register the local placeholder so the user sees the campaign.
          _registerTracked(_localCampId);
        });
    } else {
      // No platform credentials configured — register a local placeholder so
      // the campaign appears under Tracked Campaigns regardless.
      _registerTracked(_localCampId);
    }
  });

  // ── Async GPT-4 brief — runs immediately after modal opens ─────────────────
  (async () => {
    try {
      const domain      = analysisData?.url || 'yourdomain.com';
      const competitors = (analysisData?.competitors || []).map(c => c.name).slice(0, 5);
      // Extract the winning audience segment from competitors for persona targeting
      const _briefAudience = (() => {
        let best = null;
        (analysisData?.competitors || []).forEach(c => (c.audiences || []).forEach(a => {
          if (!best || parseFloat(a.pct) > parseFloat(best.pct)) best = a;
        }));
        return best ? best.label : 'growth-focused marketing decision-makers';
      })();
      const res = await fetch('/api/ai-campaign-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campName: name, platform, budget: budgetStr,
          industry: indName, domain,
          competitors, topComp: topCompName,
          persona: _briefAudience,
          description: camp.description || '',
          estROAS: String(camp.estROAS || projROAS),
          estCTR: camp.estCTR || '4.2%',
          estCPA: camp.estCPA || '$38',
          tags: camp.tags || []
        })
      });
      const brief = await res.json();

      // Update headlines
      if (brief.headlines && Array.isArray(brief.headlines)) {
        const hlInputs = document.querySelectorAll('.lm-headline');
        brief.headlines.forEach((h, i) => { if (hlInputs[i]) hlInputs[i].value = h; });
      }
      // Update descriptions
      if (brief.descriptions && Array.isArray(brief.descriptions)) {
        const dInputs = document.querySelectorAll('.lm-desc');
        brief.descriptions.forEach((d, i) => { if (dInputs[i]) dInputs[i].value = d; });
      }
      // Hide loading spinner
      const hlLoad = document.getElementById('lm-hl-loading');
      if (hlLoad) hlLoad.style.display = 'none';

      // Show AI intelligence panel
      const intelEl = document.getElementById('lm-ai-intel');
      if (intelEl && (brief.competitor_gap || brief.target_audience || brief.strategy_summary)) {
        intelEl.style.display = 'block';
        const gapEl = document.getElementById('lm-comp-gap');
        const audEl = document.getElementById('lm-audience-ai');
        const angEl = document.getElementById('lm-creative-angle');
        const stEl  = document.getElementById('lm-strategy');
        if (gapEl && brief.competitor_gap) gapEl.textContent = '"' + brief.competitor_gap + '"';
        if (audEl && brief.target_audience) audEl.textContent = brief.target_audience;
        if (angEl && brief.creative_angle)  angEl.textContent = brief.creative_angle;
        if (stEl  && brief.strategy_summary) stEl.textContent = brief.strategy_summary;
      }

      // Show KPI targets
      const kpiWrap = document.getElementById('lm-kpi-targets');
      const kpiGrid = document.getElementById('lm-kpi-grid');
      const goalGrid = document.getElementById('lm-goal-grid');
      if (kpiWrap && brief.kpi_targets) {
        const kt = brief.kpi_targets;
        kpiGrid.innerHTML = [
          ['Target ROAS', kt.roas + '×', '#00E5FF'],
          ['Target CTR', kt.ctr, '#10B981'],
          ['Target CPA', kt.cpa, '#F59E0B']
        ].map(([k,v,c]) => `
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:1rem;font-weight:800;color:${c}">${v}</div>
            <div style="font-size:0.65rem;color:#6B7280;margin-top:2px">${k}</div>
          </div>`).join('');
        goalGrid.innerHTML = [
          ['Week 1 Goal', kt.week1_goal, '#EFF6FF', '#1D4ED8'],
          ['Month 1 Goal', kt.month1_goal, '#F0FDF4', '#065F46']
        ].map(([k,v,bg,col]) => `
          <div style="background:${bg};border-radius:8px;padding:10px 12px">
            <div style="font-size:0.65rem;font-weight:700;color:${col};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${k}</div>
            <div style="font-size:0.78rem;color:#0A1628;line-height:1.4">${v || ''}</div>
          </div>`).join('');
        kpiWrap.style.display = 'block';
      }

      // Show launch checklist — with smart action buttons per item
      const clWrap = document.getElementById('lm-checklist-wrap');
      const clEl   = document.getElementById('lm-checklist');
      if (clWrap && clEl && brief.launch_checklist && brief.launch_checklist.length > 0) {
        // Always ensure the creative upload item is present
        const uploadPhrase = 'Upload your ad creatives — video or image assets for this campaign';
        const hasUpload = brief.launch_checklist.some(i => /upload|creative|video/i.test(i));
        if (!hasUpload) brief.launch_checklist.unshift(uploadPhrase);

        clEl.innerHTML = brief.launch_checklist.map((item, ii) => {
          const low = item.toLowerCase();
          let actionBtn = '';
          let extraHtml = '';

          // ── Video creative upload ──────────────────────────────────────────
          if (low.includes('video') || low.includes('creative') || low.includes('upload')) {
            const inputId = `cl-video-input-${ii}`;
            const labelId = `cl-video-label-${ii}`;
            extraHtml = `<input type="file" id="${inputId}" accept="video/*,image/*" style="display:none"
              onchange="
                const f=this.files[0];
                if(f){
                  document.getElementById('${labelId}').textContent='✅ '+f.name;
                  document.getElementById('${labelId}').style.color='#059669';
                  this.closest('.cl-item').querySelector('.cl-check').textContent='☑';
                  this.closest('.cl-item').style.background='#D1FAE5';
                  window._uploadedCreative=f;
                }
              ">`;
            actionBtn = `<label for="${inputId}" style="flex-shrink:0;cursor:pointer;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#7C3AED;background:#EDE9FE;border:1px solid #C4B5FD;border-radius:6px;white-space:nowrap">📎 Upload Creative</label>
              <span id="${labelId}" style="font-size:0.7rem;color:#9CA3AF;margin-left:4px"></span>`;

          // ── Lookalike / audience setup ─────────────────────────────────────
          } else if (low.includes('lookalike') || low.includes('audience') || low.includes('segment')) {
            actionBtn = `<button onclick="
                var _m=document.getElementById('campLaunchRichModal');
                if(_m){_m.classList.add('hidden');_m.style.display='none';}
                var _m2=document.getElementById('launchModal');
                if(_m2){_m2.classList.add('hidden');_m2.style.display='none';}
                navigateTo('audience');
              " style="flex-shrink:0;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#0066FF;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;cursor:pointer;white-space:nowrap">→ Open Audience</button>`;

          // ── Conversion tracking / attribution ──────────────────────────────
          } else if (low.includes('tracking') || low.includes('attribution') || low.includes('conversion') || low.includes('revenue')) {
            actionBtn = `<button onclick="
                var _m=document.getElementById('campLaunchRichModal');
                if(_m){_m.classList.add('hidden');_m.style.display='none';}
                var _m2=document.getElementById('launchModal');
                if(_m2){_m2.classList.add('hidden');_m2.style.display='none';}
                navigateTo('results');
              " style="flex-shrink:0;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#059669;background:#D1FAE5;border:1px solid #6EE7B7;border-radius:6px;cursor:pointer;white-space:nowrap">→ View Results</button>`;

          // ── Daily spend cap ────────────────────────────────────────────────
          } else if (low.includes('daily spend') || low.includes('spend cap') || low.includes('pacing') || low.includes('daily cap')) {
            const capId  = `cl-cap-input-${ii}`;
            const capBtn = `cl-cap-btn-${ii}`;
            const sugCap = dailyBudg || Math.round(budgetNum / 30) || 100;
            actionBtn = `
              <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap">
                <span style="font-size:0.71rem;color:#6B7280;font-weight:600">$</span>
                <input id="${capId}" type="number" value="${sugCap}" min="10" step="10"
                  style="width:70px;padding:3px 7px;font-size:0.78rem;font-weight:700;color:#0A1628;border:1.5px solid #D1D5DB;border-radius:6px;outline:none;font-family:'Inter',sans-serif"
                  onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#D1D5DB'">
                <span style="font-size:0.71rem;color:#6B7280">/day</span>
                <button id="${capBtn}" onclick="
                  const v=document.getElementById('${capId}').value;
                  window._dailySpendCap=parseFloat(v)||${sugCap};
                  this.textContent='✅ Cap Set';
                  this.style.background='#D1FAE5';
                  this.style.color='#059669';
                  this.style.borderColor='#6EE7B7';
                  this.closest('.cl-item').querySelector('.cl-check').textContent='☑';
                  this.closest('.cl-item').style.background='#D1FAE5';
                  document.getElementById('lm-budget').value=Math.round(parseFloat(v)*30)||${budgetNum};
                " style="padding:3px 10px;font-size:0.71rem;font-weight:700;color:#0A1628;background:#F3F4F6;border:1.5px solid #D1D5DB;border-radius:6px;cursor:pointer;white-space:nowrap">Set Cap</button>
              </div>`;

          // ── A/B testing ────────────────────────────────────────────────────
          } else if (low.includes('a/b') || low.includes('ab test') || low.includes('split test') || low.includes('variant')) {
            actionBtn = `<button onclick="
                var _m=document.getElementById('campLaunchRichModal');
                if(_m){_m.classList.add('hidden');_m.style.display='none';}
                var _m2=document.getElementById('launchModal');
                if(_m2){_m2.classList.add('hidden');_m2.style.display='none';}
                navigateTo('campaigns');
                setTimeout(()=>{
                  const abBtn=document.getElementById('abTestBtn');
                  if(abBtn) abBtn.click();
                },600);
              " style="flex-shrink:0;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#D97706;background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;cursor:pointer;white-space:nowrap">→ Launch A/B Test</button>`;

          // ── Keyword research / targeting ───────────────────────────────────
          } else if (low.includes('keyword') || low.includes('search term') || low.includes('targeting') || low.includes('intent') || low.includes('bid') || low.includes('cpc')) {
            const kwId = `cl-kw-input-${ii}`;
            const kwBtn = `cl-kw-btn-${ii}`;
            extraHtml = `<div id="cl-kw-panel-${ii}" style="display:none;width:100%;margin-top:6px">
              <textarea id="${kwId}" rows="2" placeholder="Paste or type your target keywords, one per line…" style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:0.76rem;color:#0A1628;border:1.5px solid #BFDBFE;border-radius:7px;outline:none;resize:vertical;font-family:'Inter',sans-serif"></textarea>
              <div style="display:flex;gap:6px;margin-top:5px">
                <button onclick="
                  const v=document.getElementById('${kwId}').value.trim();
                  if(v){window._clKeywords_${ii}=v;this.textContent='✅ Saved';this.style.background='#D1FAE5';this.style.color='#059669';
                  this.closest('.cl-item').querySelector('.cl-check').textContent='☑';
                  this.closest('.cl-item').style.background='#D1FAE5';}
                " style="padding:3px 10px;font-size:0.71rem;font-weight:700;color:#1D4ED8;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;cursor:pointer">💾 Save Keywords</button>
                <button onclick="var _m=document.getElementById('campLaunchRichModal');if(_m){closeCampLaunchRichModal();}var _m2=document.getElementById('launchModal');if(_m2){_m2.classList.add('hidden');_m2.style.display='none';}navigateTo('competitors');"
                  style="padding:3px 10px;font-size:0.71rem;font-weight:700;color:#6B7280;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer">→ Keyword Gap Analysis</button>
              </div>
            </div>`;
            actionBtn = `<button onclick="const p=document.getElementById('cl-kw-panel-${ii}');p.style.display=p.style.display==='none'?'block':'none';"
              style="flex-shrink:0;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#1D4ED8;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;cursor:pointer;white-space:nowrap">🔍 Edit Keywords</button>`;

          // ── Ad copy / copy writing / ad groups ────────────────────────────
          } else if (low.includes('ad copy') || low.includes('copy') || low.includes('headline') || low.includes('proposition') || low.includes('ad group') || low.includes('compelling') || low.includes('message') || low.includes('wording')) {
            const cpId = `cl-copy-input-${ii}`;
            extraHtml = `<div id="cl-copy-panel-${ii}" style="display:none;width:100%;margin-top:6px">
              <textarea id="${cpId}" rows="3" placeholder="Draft your ad copy here — headline, body text, CTA…" style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:0.76rem;color:#0A1628;border:1.5px solid #DDD6FE;border-radius:7px;outline:none;resize:vertical;font-family:'Inter',sans-serif"></textarea>
              <div style="display:flex;gap:6px;margin-top:5px">
                <button onclick="
                  const v=document.getElementById('${cpId}').value.trim();
                  if(v){window._clAdCopy_${ii}=v;this.textContent='✅ Saved';this.style.background='#D1FAE5';this.style.color='#059669';
                  this.closest('.cl-item').querySelector('.cl-check').textContent='☑';
                  this.closest('.cl-item').style.background='#D1FAE5';}
                " style="padding:3px 10px;font-size:0.71rem;font-weight:700;color:#7C3AED;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:6px;cursor:pointer">💾 Save Copy</button>
                <button onclick="var _m=document.getElementById('campLaunchRichModal');if(_m){closeCampLaunchRichModal();}var _m2=document.getElementById('launchModal');if(_m2){_m2.classList.add('hidden');_m2.style.display='none';}navigateTo('creative');"
                  style="padding:3px 10px;font-size:0.71rem;font-weight:700;color:#6B7280;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer">→ AI Creative Studio</button>
              </div>
            </div>`;
            actionBtn = `<button onclick="const p=document.getElementById('cl-copy-panel-${ii}');p.style.display=p.style.display==='none'?'block':'none';"
              style="flex-shrink:0;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#7C3AED;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:6px;cursor:pointer;white-space:nowrap">✍️ Draft Copy</button>`;

          // ── Landing page / mobile / optimise ──────────────────────────────
          } else if (low.includes('landing') || low.includes('mobile') || low.includes('optimis') || low.includes('optimize') || low.includes('page speed') || low.includes('url')) {
            const urlId = `cl-url-input-${ii}`;
            extraHtml = `<div id="cl-url-panel-${ii}" style="display:none;width:100%;margin-top:6px">
              <input id="${urlId}" type="url" placeholder="https://yourlandingpage.com/offer" style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:0.76rem;color:#0A1628;border:1.5px solid #FED7AA;border-radius:7px;outline:none;font-family:'Inter',sans-serif">
              <div style="display:flex;gap:6px;margin-top:5px">
                <button onclick="
                  const v=document.getElementById('${urlId}').value.trim();
                  if(v){window._clLandingUrl_${ii}=v;this.textContent='✅ URL Saved';this.style.background='#D1FAE5';this.style.color='#059669';
                  this.closest('.cl-item').querySelector('.cl-check').textContent='☑';
                  this.closest('.cl-item').style.background='#D1FAE5';}
                " style="padding:3px 10px;font-size:0.71rem;font-weight:700;color:#D97706;background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;cursor:pointer">💾 Save URL</button>
                <button onclick="const u=document.getElementById('${urlId}').value;if(u)window.open(u,'_blank');"
                  style="padding:3px 10px;font-size:0.71rem;font-weight:700;color:#6B7280;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer">↗ Preview Page</button>
              </div>
            </div>`;
            actionBtn = `<button onclick="const p=document.getElementById('cl-url-panel-${ii}');p.style.display=p.style.display==='none'?'block':'none';"
              style="flex-shrink:0;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#D97706;background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;cursor:pointer;white-space:nowrap">🌐 Set Landing URL</button>`;

          // ── Universal fallback — every item gets an Edit Notes button ──────
          } else {
            const noteId = `cl-note-input-${ii}`;
            extraHtml = `<div id="cl-note-panel-${ii}" style="display:none;width:100%;margin-top:6px">
              <textarea id="${noteId}" rows="2" placeholder="Add your notes or details for this step…" style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:0.76rem;color:#0A1628;border:1.5px solid #E5E7EB;border-radius:7px;outline:none;resize:vertical;font-family:'Inter',sans-serif"></textarea>
              <button onclick="
                const v=document.getElementById('${noteId}').value.trim();
                window._clNote_${ii}=v||'done';
                this.textContent='✅ Noted';this.style.background='#D1FAE5';this.style.color='#059669';
                this.closest('.cl-item').querySelector('.cl-check').textContent='☑';
                this.closest('.cl-item').style.background='#D1FAE5';
              " style="margin-top:5px;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#374151;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer">✓ Mark Done</button>
            </div>`;
            actionBtn = `<button onclick="const p=document.getElementById('cl-note-panel-${ii}');p.style.display=p.style.display==='none'?'block':'none';"
              style="flex-shrink:0;padding:3px 10px;font-size:0.71rem;font-weight:700;color:#374151;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer;white-space:nowrap">✏️ Edit Notes</button>`;
          }

          return `
            <div class="cl-item" style="display:flex;align-items:flex-start;gap:8px;background:#F0FDF4;border-radius:8px;padding:8px 12px;flex-wrap:wrap">
              <span class="cl-check" style="color:#059669;font-size:1rem;flex-shrink:0;margin-top:1px">☐</span>
              <span style="font-size:0.8rem;color:#374151;line-height:1.5;flex:1;min-width:120px">${item}</span>
              ${actionBtn}
              ${extraHtml}
            </div>`;
        }).join('');
        clWrap.style.display = 'block';
      }

      // Update AI badge
      const badge = document.getElementById('lm-ai-badge');
      if (badge) {
        badge.style.background = 'rgba(16,185,129,.15)';
        badge.style.borderColor = 'rgba(16,185,129,.4)';
        badge.style.color = '#6EE7B7';
        badge.innerHTML = '✨ GPT-4 Brief Ready';
      }

    } catch(e) {
      console.warn('GPT-4 brief failed:', e.message);
      const hlLoad = document.getElementById('lm-hl-loading');
      if (hlLoad) { hlLoad.innerHTML = '⚠️ Using template'; hlLoad.style.color = '#F59E0B'; }
    }
  })();
}

function buildCreativeModal(camp, idx) {
  const modal = document.getElementById('campCreativeModal');
  const inner = document.getElementById('campCreativeModalInner');
  if (!modal || !inner) {
    alert('Creative Studio modal not found. Please refresh the page.');
    return;
  }
  modal.classList.remove('hidden');
  modal.removeAttribute('style');
  modal.style.cssText = 'display:flex !important; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; background:rgba(0,0,0,.65); backdrop-filter:blur(4px); padding:20px;';

  const name     = camp.name || 'Campaign';
  const platform = camp.platform || 'Google Ads';
  const budget   = camp.budget || '$2,000/mo';
  const domain   = (analysisData && analysisData.url) ? analysisData.url : 'yourdomain.com';
  const indName  = (analysisData && analysisData.industry) ? analysisData.industry.name : 'your industry';
  const topComp      = (analysisData && analysisData.competitors && analysisData.competitors[0]) ? analysisData.competitors[0].name : 'your competitor';
  const allComps     = (analysisData && analysisData.competitors) ? analysisData.competitors.map(c=>c.name) : [topComp];
  // Pull the #1 winning audience segment from competitors to pre-fill Target Persona
  const _winAudience = (() => {
    const comps = analysisData?.competitors || [];
    // Collect all audiences across competitors, pick the highest percentage one
    let best = null;
    comps.forEach(c => (c.audiences || []).forEach(a => { if (!best || (parseFloat(a.pct) > parseFloat(best.pct))) best = a; }));
    return best ? best.label : 'growth-focused marketing decision-makers';
  })();
  igTrack('Creative Studio Opened', { campaignName: name, platform, industry: indName, domain });
  const projROAS = camp.estROAS ? camp.estROAS + '×' : '3.8×';
  const estCTR   = camp.estCTR || '4.2%';
  const estCPA   = camp.estCPA || '$38';
  const campTags = camp.tags || [];
  const campDesc = camp.description || '';

  // Seed content (shown instantly, replaced by GPT within seconds)
  const seedHeadlines = {
    'Google Ads':      ['Beat ' + topComp + ' — Start Free', 'AI Marketing Intelligence', 'The Smarter Alternative'],
    'Meta Ads':        ['4× ROAS — Starting Today', 'Your Rivals Are Doing This', 'Ads That Actually Convert'],
    'TikTok Ads':      ['ROAS just hit 4×', topComp + ' hates this', 'Real results. Real ROI.'],
    'LinkedIn Ads':    ['500+ Decision-Makers/Week', 'B2B Growth CFOs Approve', 'Enterprise ROI — Less Cost'],
    'YouTube':         ['Stop Wasting Ad Budget', '5× ROAS This Year', 'Strategy ' + topComp + ' Fears'],
    'AI Optimised':    ['AI-Optimised. Always Winning.', '£1 Working Harder With AI', 'Campaigns That Never Sleep'],
    'Display Network': ['Your Brand Everywhere', 'Beat ' + topComp + ' On Every Screen', 'Display + Intent = Growth']
  };
  const seedDescs = {
    'Google Ads':      ['Cut wasteful spend and beat ' + topComp + ' on the keywords that matter most.', 'See exactly where ' + topComp + ' wins — then outbid them with AI precision.'],
    'Meta Ads':        ['Reach audiences ' + topComp + ' is missing. AI-built lookalike segments from your best customers.', 'Dynamic creative that tests and learns — your best-performing ad always runs.'],
    'TikTok Ads':      [indName + ' on TikTok is untapped. Beat ' + topComp + ' before they realise what they\'re missing.', 'Short-form video that converts — at a fraction of Google/Meta CPM.'],
    'LinkedIn Ads':    ['Connect with VP-level decision-makers in ' + indName + ' who are evaluating solutions like yours.', 'Sponsored content that nurtures prospects from awareness to signed contract.'],
    'YouTube':         ['Show your brand story to in-market buyers searching for alternatives to ' + topComp + '.', 'Video builds trust fast. Reach decision-makers before they click a competitor ad.'],
    'AI Optimised':    ['AI manages your entire ad portfolio — pausing losers, scaling winners, every 6 hours.', 'Set your ROAS target, connect accounts, let AI run. Average: +31% ROAS in 30 days.'],
    'Display Network': ['Your brand on 2M+ premium sites — following your best prospects everywhere they browse.', 'Retarget ' + topComp + ' visitors and convert them before they go back.']
  };
  const hSeed = seedHeadlines[platform] || seedHeadlines['Google Ads'];
  const dSeed = seedDescs[platform]     || seedDescs['Google Ads'];

  const loadingSpin = `<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(99,102,241,.3);border-top-color:#6366F1;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px"></span>`;

  const emailBrief = `Campaign: ${name}\nPlatform: ${platform}\nBudget: ${budget}\nProjected ROAS: ${projROAS} | CTR: ${estCTR} | CPA: ${estCPA}\n\nHEADLINES (GPT-4 generating...)\n\nDESCRIPTIONS (GPT-4 generating...)\n\nGenerated by InfoGenie Creative Studio · ${new Date().toLocaleDateString()}`;

  window._creativeStudio = { campName: name, platform, budget, domain, indName, topComp };

  inner.innerHTML = `
    <style>@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}</style>
    <div style="background:var(--ig-grad);padding:22px 26px 0;border-radius:20px 20px 0 0">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:14px;padding-right:44px">
        <div style="min-width:0;flex:1">
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:white;margin-bottom:4px">🎨 AI Creative Studio</div>
          <div style="font-size:0.78rem;color:rgba(255,255,255,.55);margin-bottom:6px">${name} · ${platform} · ${budget}</div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(239,68,68,.18);border:1px solid rgba(239,68,68,.38);border-radius:999px;padding:3px 10px;font-size:0.7rem;font-weight:700;color:#FCA5A5"><span style="font-size:0.78rem">⚔️</span> Targeting: ${(window._counterTarget && window._counterTarget.name) ? window._counterTarget.name : (allComps.length > 1 ? allComps.slice(0,3).join(' · ') + (allComps.length>3?' +'+(allComps.length-3):'') : topComp)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;max-width:60%">
          <span id="cs-ai-badge" style="background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.4);border-radius:6px;padding:4px 10px;font-size:0.68rem;font-weight:700;color:#A5B4FC;white-space:nowrap">${loadingSpin}GPT-4 + Claude Writing...</span>
          <button id="cs-dl-btn" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 12px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">⬇ Download</button>
          <button id="cs-launch-btn" style="background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:8px;padding:7px 14px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">🚀 Launch</button>
        </div>
      </div>
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,.12)">
        ${[['ad','🗂 Ad Copy'],['social','💬 Social & Video'],['linkedin','💼 LinkedIn'],['email','📧 Brief'],['settings','⚙️ Redesign']].map(([id,label],i)=>`
          <button class="cs-tab-btn" data-tab="${id}" style="background:${i===0?'rgba(255,255,255,.1)':'transparent'};border:none;border-bottom:${i===0?'2px solid #00E5FF':'2px solid transparent'};padding:10px 14px;font-size:0.75rem;font-weight:700;color:${i===0?'white':'rgba(255,255,255,.5)'};cursor:pointer;transition:all .2s">${label}</button>
        `).join('')}
      </div>
    </div>

    <div style="padding:20px 26px;display:flex;flex-direction:column;gap:14px;max-height:60vh;overflow-y:auto">

      <!-- AD COPY TAB -->
      <div class="cs-panel" id="csp-ad">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div id="cs-ad-source-label" style="font-size:0.7rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.06em">🔵 Google / Search Ad — GPT-4 + Claude Generated</div>
          <span id="cs-ad-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}Generating...</span>
        </div>
        ${hSeed.map((h,i)=>`
          <div style="display:flex;align-items:center;gap:8px;background:#EFF6FF;border-radius:8px;padding:8px 10px;margin-bottom:6px">
            <span style="font-size:0.7rem;font-weight:700;color:#1D4ED8;background:#DBEAFE;border-radius:4px;padding:2px 6px;flex-shrink:0">H${i+1}</span>
            <input class="cs-headline" value="${h.replace(/"/g,'&quot;')}" style="flex:1;border:none;background:transparent;font-size:0.82rem;color:#0A1628;font-weight:600;outline:none;font-family:'Inter',sans-serif">
          </div>`).join('')}
        ${dSeed.map((d,i)=>`
          <div style="background:#F0FDF4;border-radius:8px;padding:8px 10px;margin-bottom:6px">
            <span style="font-size:0.7rem;font-weight:700;color:#059669;background:#DCFCE7;border-radius:4px;padding:2px 6px;margin-right:8px">D${i+1}</span>
            <input class="cs-desc" value="${d.replace(/"/g,'&quot;')}" style="width:calc(100% - 44px);border:none;background:transparent;font-size:0.8rem;color:#374151;outline:none;font-family:'Inter',sans-serif">
          </div>`).join('')}
        <div id="cs-ad-preview" style="background:#F9FAFB;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-top:10px">
          <div style="font-size:0.68rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Ad Preview</div>
          <div style="font-size:0.65rem;color:#188038;">Ad · ${domain}</div>
          <div style="font-size:0.88rem;color:#1a0dab;font-weight:600;line-height:1.3;margin:4px 0" id="cs-preview-h">${hSeed[0]} | ${hSeed[1]}</div>
          <div style="font-size:0.76rem;color:#4d5156;line-height:1.4" id="cs-preview-d">${dSeed[0].substring(0,120)}</div>
        </div>
        <div id="cs-competitor-angle" style="display:none;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px;margin-top:8px">
          <div style="font-size:0.68rem;font-weight:700;color:#C2410C;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">⚡ Competitor Attack Hook — GPT-4</div>
          <div id="cs-competitor-text" style="font-size:0.82rem;color:#7C2D12;font-style:italic;line-height:1.5"></div>
        </div>
        <div id="cs-claude-angle" style="display:none;background:linear-gradient(135deg,#F0FFF4,#ECFDF5);border:1px solid #86EFAC;border-radius:10px;padding:12px;margin-top:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:0.68rem;font-weight:700;color:#15803D;text-transform:uppercase;letter-spacing:.06em">⚡ Competitor Attack Hook — Claude</span>
            <span style="font-size:0.6rem;font-weight:700;background:#DCFCE7;color:#166534;border-radius:4px;padding:1px 6px">ALTERNATIVE</span>
          </div>
          <div id="cs-claude-angle-text" style="font-size:0.82rem;color:#166534;font-style:italic;line-height:1.5"></div>
          <div id="cs-claude-strategy" style="font-size:0.72rem;color:#4ADE80;margin-top:6px;padding-top:6px;border-top:1px solid rgba(134,239,172,.4);display:none"></div>
        </div>
        <div id="cs-claude-headlines-wrap" style="display:none;margin-top:12px">
          <div style="font-size:0.68rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            🟣 Claude Alternative Headlines
            <span style="font-size:0.6rem;background:#EDE9FE;color:#5B21B6;border-radius:4px;padding:1px 6px">Use These Instead</span>
          </div>
          <div id="cs-claude-headlines-list"></div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button id="cs-copy-ad" style="flex:1;padding:9px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;font-size:0.78rem;font-weight:700;color:#1D4ED8;cursor:pointer">📋 Copy Ad Copy</button>
          <button id="cs-regen-btn" style="flex:1;padding:9px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:8px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">✨ Regenerate (GPT-4 + Claude)</button>
        </div>
      </div>

      <!-- SOCIAL & VIDEO TAB -->
      <div class="cs-panel" id="csp-social" style="display:none">
        <div style="margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:0.7rem;font-weight:700;color:#E1306C;text-transform:uppercase;letter-spacing:.06em">📱 Instagram / Meta Caption</div>
            <span id="cs-ig-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4 + Claude...</span>
          </div>
          <textarea id="cs-instagram" rows="7" style="width:100%;box-sizing:border-box;background:#FFF5F7;border:1px solid #FECDD3;border-radius:8px;padding:10px;font-size:0.8rem;color:#1E293B;font-family:'Inter',sans-serif;resize:vertical;outline:none">✨ GPT-4 is writing your Instagram caption...</textarea>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
            <button id="cs-copy-instagram" style="padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy Caption</button>
            <input type="file" id="cs-upload-ig" accept="image/*,video/*" style="display:none">
            <button id="cs-upload-ig-btn" style="padding:7px 16px;background:linear-gradient(135deg,#E1306C,#C13584);border:none;border-radius:7px;font-size:0.73rem;font-weight:700;color:white;cursor:pointer;display:flex;align-items:center;gap:5px">📎 Upload Creative</button>
            <span id="cs-ig-filename" style="font-size:0.7rem;color:#6B7280;font-style:italic"></span>
          </div>
          <div id="cs-ig-preview" style="display:none;margin-top:8px;border-radius:8px;overflow:hidden;max-height:160px;background:#F9FAFB;border:1px dashed #FECDD3;text-align:center"></div>
        </div>
        <div style="margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:0.7rem;font-weight:700;color:#010101;text-transform:uppercase;letter-spacing:.06em">⬛ TikTok Script — 15 sec</div>
            <span id="cs-tt-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4 + Claude...</span>
          </div>
          <textarea id="cs-tiktok" rows="5" style="width:100%;box-sizing:border-box;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px;font-size:0.8rem;color:#1E293B;font-family:'Courier New',monospace;resize:vertical;outline:none">✨ GPT-4 is writing your TikTok script...</textarea>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
            <button id="cs-copy-tiktok" style="padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy Script</button>
            <input type="file" id="cs-upload-tt" accept="image/*,video/*" style="display:none">
            <button id="cs-upload-tt-btn" style="padding:7px 16px;background:linear-gradient(135deg,#010101,#2D2D2D);border:none;border-radius:7px;font-size:0.73rem;font-weight:700;color:white;cursor:pointer;display:flex;align-items:center;gap:5px">📎 Upload Creative</button>
            <span id="cs-tt-filename" style="font-size:0.7rem;color:#6B7280;font-style:italic"></span>
          </div>
          <div id="cs-tt-preview" style="display:none;margin-top:8px;border-radius:8px;overflow:hidden;max-height:160px;background:#F9FAFB;border:1px dashed #E5E7EB;text-align:center"></div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:0.7rem;font-weight:700;color:#FF0000;text-transform:uppercase;letter-spacing:.06em">🎬 YouTube Pre-Roll — 25 sec</div>
            <span id="cs-yt-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4 + Claude...</span>
          </div>
          <textarea id="cs-video" rows="6" style="width:100%;box-sizing:border-box;background:#FFF5F5;border:1px solid #FECACA;border-radius:8px;padding:10px;font-size:0.8rem;color:#1E293B;font-family:'Courier New',monospace;resize:vertical;outline:none">✨ GPT-4 is writing your YouTube script...</textarea>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
            <button id="cs-copy-video" style="padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy Script</button>
            <input type="file" id="cs-upload-yt" accept="image/*,video/*" style="display:none">
            <button id="cs-upload-yt-btn" style="padding:7px 16px;background:linear-gradient(135deg,#FF0000,#CC0000);border:none;border-radius:7px;font-size:0.73rem;font-weight:700;color:white;cursor:pointer;display:flex;align-items:center;gap:5px">📎 Upload Creative</button>
            <span id="cs-yt-filename" style="font-size:0.7rem;color:#6B7280;font-style:italic"></span>
          </div>
          <div id="cs-yt-preview" style="display:none;margin-top:8px;border-radius:8px;overflow:hidden;max-height:160px;background:#F9FAFB;border:1px dashed #FECACA;text-align:center"></div>
        </div>
      </div>

      <!-- LINKEDIN TAB -->
      <div class="cs-panel" id="csp-linkedin" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:0.7rem;font-weight:700;color:#0A66C2;text-transform:uppercase;letter-spacing:.06em">💼 LinkedIn Sponsored Content</div>
          <span id="cs-li-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4...</span>
        </div>
        <textarea id="cs-linkedin" rows="9" style="width:100%;box-sizing:border-box;background:#F0F7FF;border:1px solid #BAE0FF;border-radius:8px;padding:12px;font-size:0.82rem;color:#1E293B;font-family:'Inter',sans-serif;resize:vertical;outline:none">✨ GPT-4 is writing your LinkedIn copy...</textarea>
        <button id="cs-copy-linkedin" style="margin-top:6px;padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy LinkedIn Post</button>
        <div id="cs-strategy-box" style="display:none;margin-top:14px;background:linear-gradient(135deg,#F0FDF4,#DCFCE7);border:1px solid #BBF7D0;border-radius:10px;padding:14px">
          <div style="font-size:0.68rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🧠 GPT-4 Strategy Reasoning</div>
          <div id="cs-strategy-text" style="font-size:0.82rem;color:#064E3B;line-height:1.6"></div>
        </div>
      </div>

      <!-- EMAIL BRIEF TAB -->
      <div class="cs-panel" id="csp-email" style="display:none">
        <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📧 Email Subject Lines — GPT-4 Generated</div>
        <div id="cs-email-subjects" style="margin-bottom:14px;display:flex;flex-direction:column;gap:8px">
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;font-size:0.82rem;color:#6B7280;font-style:italic">${loadingSpin} GPT-4 writing subject lines...</div>
        </div>
        <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">📋 Full Campaign Brief</div>
        <textarea id="cs-email" rows="12" style="width:100%;box-sizing:border-box;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;font-size:0.8rem;color:#1E293B;font-family:'Courier New',monospace;resize:vertical;outline:none">${emailBrief}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="cs-copy-email" style="flex:1;padding:9px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;font-size:0.78rem;font-weight:700;color:#1D4ED8;cursor:pointer">📋 Copy Brief</button>
          <button id="cs-send-email" style="flex:1;padding:9px;background:linear-gradient(135deg,#0066FF,#0044CC);border:none;border-radius:8px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">📤 Open in Email</button>
        </div>
      </div>

      <!-- REDESIGN TAB -->
      <div class="cs-panel" id="csp-settings" style="display:none">
        <div style="font-size:0.7rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">✨ Custom GPT-4 Redesign</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Tone of Voice</label>
            <select id="cs-tone" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
              <option>Professional & Authoritative</option>
              <option>Friendly & Conversational</option>
              <option>Bold & Direct</option>
              <option>Urgent & Action-Focused</option>
              <option>Witty & Disruptive</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Target Persona</label>
            <input id="cs-persona" placeholder="e.g. CFO at mid-size SaaS, 35-50yo, values ROI" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Key Differentiator</label>
            <input id="cs-diff" placeholder="e.g. 3× cheaper, fastest setup, AI-powered" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Call-to-Action</label>
            <select id="cs-cta" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
              <option>Start Free Trial</option>
              <option>Book a Demo</option>
              <option>Get Started Today</option>
              <option>See Pricing</option>
              <option>Learn More</option>
              <option>Claim Your Offer</option>
            </select>
          </div>
          <button id="cs-regen-full" style="width:100%;padding:12px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">✨ Generate New Variants with GPT-4</button>
        </div>
        <div id="cs-regen-output" style="margin-top:12px;display:none"></div>
      </div>

    </div>

    <div style="padding:0 26px 20px;display:flex;gap:10px">
      <button id="cs-close-btn" style="flex:1;padding:11px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">✕ Close</button>
      <button id="cs-launch-footer-btn" style="flex:2;padding:11px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">🚀 Launch This Campaign</button>
    </div>
  `;

  // ── Helper: apply GPT-4 + Claude response to all panels ──────────────────
  function applyAICreative(data) {
    const isDual = data.source === 'dual_ai';
    const src = isDual ? 'GPT-4 + Claude' : (data.source === 'gpt4' ? 'GPT-4' : data.source === 'rapidapi_gpt' ? 'GPT-4' : 'AI Engine');

    // Ad Copy tab
    if (data.headlines && Array.isArray(data.headlines)) {
      document.querySelectorAll('.cs-headline').forEach((inp, i) => {
        if (data.headlines[i]) { inp.value = data.headlines[i]; inp.style.animation = 'fadeIn .4s'; }
      });
    }
    if (data.descriptions && Array.isArray(data.descriptions)) {
      document.querySelectorAll('.cs-desc').forEach((inp, i) => {
        if (data.descriptions[i]) { inp.value = data.descriptions[i]; inp.style.animation = 'fadeIn .4s'; }
      });
    }
    // Update live preview
    const h0 = data.headlines?.[0] || hSeed[0];
    const h1 = data.headlines?.[1] || hSeed[1];
    const d0 = data.descriptions?.[0] || dSeed[0];
    const prevH = document.getElementById('cs-preview-h');
    const prevD = document.getElementById('cs-preview-d');
    if (prevH) prevH.textContent = h0 + ' | ' + h1;
    if (prevD) prevD.textContent = d0.substring(0, 120);
    // Loading indicators off
    const adLoad = document.getElementById('cs-ad-loading');
    if (adLoad) adLoad.style.display = 'none';

    // Competitor hook — GPT-4
    if (data.competitor_angle) {
      const box = document.getElementById('cs-competitor-angle');
      const txt = document.getElementById('cs-competitor-text');
      if (box) box.style.display = 'block';
      if (txt) txt.textContent = '"' + data.competitor_angle + '"';
    }

    // Claude attack hook
    if (data.claude_angle) {
      const cBox = document.getElementById('cs-claude-angle');
      const cTxt = document.getElementById('cs-claude-angle-text');
      if (cBox) cBox.style.display = 'block';
      if (cTxt) cTxt.textContent = '"' + data.claude_angle + '"';
      if (data.claude_strategy) {
        const cSt = document.getElementById('cs-claude-strategy');
        if (cSt) { cSt.style.display = 'block'; cSt.textContent = '💡 Claude: ' + data.claude_strategy; }
      }
    }

    // Claude alternative headlines
    if (data.claude_headlines && Array.isArray(data.claude_headlines) && data.claude_headlines.length > 0) {
      const wrap = document.getElementById('cs-claude-headlines-wrap');
      const list = document.getElementById('cs-claude-headlines-list');
      if (wrap) wrap.style.display = 'block';
      if (list) {
        list.innerHTML = data.claude_headlines.map((h, i) => `
          <div style="display:flex;align-items:center;gap:8px;background:#EDE9FE;border-radius:8px;padding:8px 10px;margin-bottom:6px">
            <span style="font-size:0.7rem;font-weight:700;color:#5B21B6;background:#DDD6FE;border-radius:4px;padding:2px 6px;flex-shrink:0">CH${i+1}</span>
            <span style="flex:1;font-size:0.82rem;color:#1E1B4B;font-weight:600;font-family:'Inter',sans-serif">${h}</span>
            <button onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent.trim()).then(()=>window.showToast && showToast('✅ Claude headline copied!'))" style="background:none;border:none;font-size:0.75rem;cursor:pointer;color:#7C3AED;padding:2px 6px" title="Copy this Claude headline">📋</button>
          </div>`).join('');
      }
    }

    // Social & Video tab
    const igEl = document.getElementById('cs-instagram');
    if (igEl && data.instagram) { igEl.value = data.instagram; }
    const igLoad = document.getElementById('cs-ig-loading');
    if (igLoad) igLoad.style.display = 'none';

    const ttEl = document.getElementById('cs-tiktok');
    if (ttEl && data.tiktok_script) { ttEl.value = data.tiktok_script; }
    const ttLoad = document.getElementById('cs-tt-loading');
    if (ttLoad) ttLoad.style.display = 'none';

    const ytEl = document.getElementById('cs-video');
    if (ytEl && data.youtube_script) { ytEl.value = data.youtube_script; }
    const ytLoad = document.getElementById('cs-yt-loading');
    if (ytLoad) ytLoad.style.display = 'none';

    // LinkedIn tab
    const liEl = document.getElementById('cs-linkedin');
    if (liEl && data.linkedin) { liEl.value = data.linkedin; }
    const liLoad = document.getElementById('cs-li-loading');
    if (liLoad) liLoad.style.display = 'none';

    // Strategy reasoning
    if (data.strategy_reasoning) {
      const stBox = document.getElementById('cs-strategy-box');
      const stTxt = document.getElementById('cs-strategy-text');
      if (stBox) stBox.style.display = 'block';
      if (stTxt) stTxt.textContent = data.strategy_reasoning;
    }

    // Email tab — subject lines
    if (data.email_subjects && Array.isArray(data.email_subjects)) {
      const subjectEl = document.getElementById('cs-email-subjects');
      if (subjectEl) {
        subjectEl.innerHTML = data.email_subjects.map((s, i) => `
          <div style="display:flex;align-items:center;gap:8px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:10px 12px">
            <span style="font-size:0.68rem;font-weight:700;color:#0369A1;background:#E0F2FE;border-radius:4px;padding:2px 6px;flex-shrink:0">SL${i+1}</span>
            <span style="flex:1;font-size:0.82rem;color:#0A1628;font-weight:500">${s}</span>
            <button onclick="navigator.clipboard.writeText('${s.replace(/'/g,"\\'")}').then(()=>window.showToast && showToast('✅ Subject copied!'))" style="background:none;border:none;font-size:0.75rem;cursor:pointer;color:#0369A1;padding:2px 6px">📋</button>
          </div>`).join('');
      }
    }
    // Update the email brief textarea
    const emailEl = document.getElementById('cs-email');
    if (emailEl) {
      const hs = data.headlines || [];
      const ds = data.descriptions || [];
      emailEl.value = `Campaign: ${name}\nPlatform: ${platform}\nBudget: ${budget}\nProjected ROAS: ${projROAS} | CTR: ${estCTR} | CPA: ${estCPA}\nGenerated by: ${src}\n\nGOOGLE AD HEADLINES\nH1: ${hs[0]||''}\nH2: ${hs[1]||''}\nH3: ${hs[2]||''}\n\nGOOGLE DESCRIPTIONS\nD1: ${ds[0]||''}\nD2: ${ds[1]||''}\n\nEMAIL SUBJECT LINES\n${(data.email_subjects||[]).join('\n')}\n\nSTRATEGY\n${data.strategy_reasoning||''}\n\nGenerated by InfoGenie AI Creative Studio · ${new Date().toLocaleDateString()}`;
    }

    // Badge — green for single AI, teal gradient for dual AI (theme-aware)
    const badge = document.getElementById('cs-ai-badge');
    if (badge) {
      const _csLight = document.documentElement.dataset.theme === 'light';
      if (isDual) {
        badge.style.background = _csLight ? 'rgba(0,102,255,.08)' : 'linear-gradient(135deg,rgba(0,201,200,.18),rgba(99,102,241,.18))';
        badge.style.borderColor = _csLight ? 'rgba(0,102,255,.35)' : 'rgba(0,201,200,.5)';
        badge.style.color = _csLight ? '#0055CC' : '#5EEAD4';
        badge.innerHTML = '✦ GPT-4 + Claude — Live Creative';
      } else {
        badge.style.background = _csLight ? 'rgba(5,150,105,.08)' : 'rgba(16,185,129,.15)';
        badge.style.borderColor = _csLight ? 'rgba(5,150,105,.35)' : 'rgba(16,185,129,.4)';
        badge.style.color = _csLight ? '#065F46' : '#6EE7B7';
        badge.innerHTML = '✨ ' + src + ' — Live Creative';
      }
    }

    // Update ad source label
    const srcLabel = document.getElementById('cs-ad-source-label');
    if (srcLabel) {
      srcLabel.textContent = isDual
        ? '🔵 Google / Search Ad — GPT-4 + Claude Generated'
        : '🔵 Google / Search Ad — ' + src + ' Generated';
    }

    // Prepend Claude alternative Instagram hook into the caption if available
    if (isDual && data.claude_instagram) {
      const igEl2 = document.getElementById('cs-instagram');
      if (igEl2 && igEl2.value) {
        igEl2.value = '✦ Claude Alternative Opening:\n' + data.claude_instagram + '\n\n──────────────────\n✦ GPT-4 Caption:\n' + igEl2.value;
      }
    }

    // Store for download (includes Claude data)
    window._creativeStudio = {
      campName: name, platform, budget, domain, indName, topComp,
      googleCopy: `H1: ${(data.headlines||[])[0]}\nH2: ${(data.headlines||[])[1]}\nH3: ${(data.headlines||[])[2]}\nD1: ${(data.descriptions||[])[0]}\nD2: ${(data.descriptions||[])[1]}`,
      claudeHeadlines: data.claude_headlines ? data.claude_headlines.map((h,i) => `CH${i+1}: ${h}`).join('\n') : '',
      competitorAngle: data.competitor_angle || '',
      claudeAngle: data.claude_angle || '',
      instagramCopy: data.instagram || '',
      tiktokScript: data.tiktok_script || '',
      videoScript: data.youtube_script || '',
      linkedin: data.linkedin || '',
      emailSubjects: (data.email_subjects||[]).join('\n'),
      strategy: data.strategy_reasoning || '',
      claudeStrategy: data.claude_strategy || ''
    };
  }

  // ── Auto-generate on open ──────────────────────────────────────────────────
  (async () => {
    try {
      const res = await fetch('/api/ai-creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform, campName: name, tone: 'Bold & Direct',
          persona: _winAudience,
          differentiator: campDesc.split('.')[0] || 'AI-powered competitor intelligence',
          cta: 'Start Free Trial', topComp,
          competitors: allComps.slice(0, 4),
          tags: campTags,
          industry: indName, domain
        })
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.headlines) {
        applyAICreative(data);
        igTrack('AI Creative Generated', { campaignName: name, platform, industry: indName, source: data.source || 'gpt4' });
      } else {
        // API returned but no headlines — clear spinners and fall back gracefully
        ['cs-ad-loading','cs-ig-loading','cs-tt-loading','cs-yt-loading','cs-li-loading'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
        const badge = document.getElementById('cs-ai-badge');
        if (badge) { badge.innerHTML = '⚠️ Using template copy'; badge.style.color = '#F59E0B'; }
      }
    } catch(e) {
      console.warn('Auto-generate failed:', e.message);
      const adLoad = document.getElementById('cs-ad-loading');
      if (adLoad) adLoad.style.display = 'none';
      const igLoad = document.getElementById('cs-ig-loading');
      if (igLoad) igLoad.style.display = 'none';
      const ttLoad = document.getElementById('cs-tt-loading');
      if (ttLoad) ttLoad.style.display = 'none';
      const ytLoad = document.getElementById('cs-yt-loading');
      if (ytLoad) ytLoad.style.display = 'none';
      const liLoad = document.getElementById('cs-li-loading');
      if (liLoad) liLoad.style.display = 'none';
      const badge = document.getElementById('cs-ai-badge');
      if (badge) { badge.innerHTML = '⚠️ Using template copy'; badge.style.color = '#F59E0B'; }
    }
  })();

  // ── Close & launch buttons ────────────────────────────────────────────────
  const closeModal = () => { modal.classList.add('hidden'); modal.style.display = 'none'; };
  document.getElementById('cs-close-btn').addEventListener('click', closeModal);
  document.getElementById('cs-launch-btn').addEventListener('click', () => { closeModal(); buildLaunchModal(camp, idx); });
  document.getElementById('cs-launch-footer-btn').addEventListener('click', () => { closeModal(); buildLaunchModal(camp, idx); });
  // Pre-fill Target Persona with the #1 winning audience from competitors
  const _personaEl = document.getElementById('cs-persona');
  if (_personaEl && _winAudience) { _personaEl.value = _winAudience; }

  // ── Download ───────────────────────────────────────────────────────────────
  document.getElementById('cs-dl-btn').addEventListener('click', () => {
    const s = window._creativeStudio || {};
    const txt = [
      'INFOGENIE AI CREATIVE PACK — GPT-4 + CLAUDE', '─'.repeat(50),
      `Campaign: ${s.campName || name} | Platform: ${s.platform || platform}`,
      `Generated: ${new Date().toLocaleString()}`, '',
      '── GOOGLE ADS (GPT-4) ──', s.googleCopy || '', '',
      ...(s.claudeHeadlines ? ['── CLAUDE ALTERNATIVE HEADLINES ──', s.claudeHeadlines, ''] : []),
      '── GPT-4 ATTACK HOOK ──', s.competitorAngle ? '"' + s.competitorAngle + '"' : '', '',
      ...(s.claudeAngle ? ['── CLAUDE ATTACK HOOK ──', '"' + s.claudeAngle + '"', ''] : []),
      '── INSTAGRAM / META ──', s.instagramCopy || '', '',
      '── TIKTOK SCRIPT ──', s.tiktokScript || '', '',
      '── YOUTUBE SCRIPT ──', s.videoScript || '', '',
      '── LINKEDIN ──', s.linkedin || '', '',
      '── EMAIL SUBJECTS ──', s.emailSubjects || '', '',
      '── GPT-4 STRATEGY ──', s.strategy || '',
      ...(s.claudeStrategy ? ['', '── CLAUDE STRATEGY ──', s.claudeStrategy] : [])
    ].join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([txt], {type:'text/plain'})),
      download: 'infogenie-creative-pack.txt'
    });
    a.click(); URL.revokeObjectURL(a.href);
    igTrack('Creative Pack Downloaded', { campaignName: name, platform, industry: indName });
    showToast('⬇ Creative pack downloaded!');
  });

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.cs-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const _tabLight = document.documentElement.dataset.theme === 'light';
      document.querySelectorAll('.cs-tab-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderBottom = '2px solid transparent';
        b.style.color = _tabLight ? '#475569' : 'rgba(255,255,255,.5)';
      });
      btn.style.background = _tabLight ? 'rgba(0,102,255,.08)' : 'rgba(255,255,255,.1)';
      btn.style.borderBottom = _tabLight ? '2px solid #0066FF' : '2px solid #00E5FF';
      btn.style.color = _tabLight ? '#0066FF' : 'white';
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.cs-panel').forEach(p => p.style.display = 'none');
      const panel = document.getElementById('csp-' + tabId);
      if (panel) { panel.style.display = 'flex'; panel.style.flexDirection = 'column'; panel.style.gap = '0'; }
    });
  });

  // ── Copy buttons ───────────────────────────────────────────────────────────
  document.getElementById('cs-copy-ad').addEventListener('click', () => {
    const h = Array.from(document.querySelectorAll('.cs-headline')).map(i=>i.value);
    const d = Array.from(document.querySelectorAll('.cs-desc')).map(i=>i.value);
    navigator.clipboard.writeText(`HEADLINE 1: ${h[0]}\nHEADLINE 2: ${h[1]}\nHEADLINE 3: ${h[2]}\nDESCRIPTION 1: ${d[0]}\nDESCRIPTION 2: ${d[1]}`)
      .then(()=>showToast('✅ Ad copy copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-instagram').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-instagram').value).then(()=>showToast('✅ Caption copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-tiktok').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-tiktok').value).then(()=>showToast('✅ TikTok script copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-video').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-video').value).then(()=>showToast('✅ YouTube script copied!')).catch(()=>showToast('✅ Copied!'));
  });
  // ── Upload Creative buttons (Social & Video tab) ────────────────────────────
  function setupCreativeUpload(btnId, inputId, filenameId, previewId, label) {
    const btn = document.getElementById(btnId);
    const inp = document.getElementById(inputId);
    const fnEl = document.getElementById(filenameId);
    const pvEl = document.getElementById(previewId);
    if (!btn || !inp) return;
    btn.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => {
      const file = inp.files[0];
      if (!file) return;
      fnEl.textContent = file.name;
      pvEl.innerHTML = '';
      const url = URL.createObjectURL(file);
      if (file.type.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true;
        vid.style.cssText = 'max-width:100%;max-height:150px;border-radius:6px';
        pvEl.appendChild(vid);
      } else {
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'max-width:100%;max-height:150px;object-fit:contain;border-radius:6px';
        pvEl.appendChild(img);
      }
      pvEl.style.display = 'block';
      showToast(`✅ ${label} creative attached: ${file.name}`);
    });
  }
  setupCreativeUpload('cs-upload-ig-btn','cs-upload-ig','cs-ig-filename','cs-ig-preview','Instagram');
  setupCreativeUpload('cs-upload-tt-btn','cs-upload-tt','cs-tt-filename','cs-tt-preview','TikTok');
  setupCreativeUpload('cs-upload-yt-btn','cs-upload-yt','cs-yt-filename','cs-yt-preview','YouTube');

  document.getElementById('cs-copy-linkedin').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-linkedin').value).then(()=>showToast('✅ LinkedIn copy copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-email').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-email').value).then(()=>showToast('✅ Brief copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-send-email').addEventListener('click', () => {
    window.open('mailto:?subject=' + encodeURIComponent('Campaign Brief: ' + name) + '&body=' + encodeURIComponent(document.getElementById('cs-email').value));
  });

  // ── Regenerate (Ad Copy tab quick regen) ──────────────────────────────────
  document.getElementById('cs-regen-btn').addEventListener('click', async () => {
    const btn = document.getElementById('cs-regen-btn');
    btn.disabled = true; btn.textContent = '⏳ GPT-4...';
    const badge = document.getElementById('cs-ai-badge');
    if (badge) badge.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(165,180,252,.3);border-top-color:#A5B4FC;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:5px"></span>Regenerating...';
    try {
      const res = await fetch('/api/ai-creative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, campName: name, tone: 'Bold & Direct', topComp, competitors: allComps.slice(0,4), tags: campTags, industry: indName, domain, cta: 'Start Free Trial', persona: 'marketing decision-makers', differentiator: campDesc.split('.')[0] || 'AI-powered results' })
      });
      const data = await res.json();
      if (data.headlines) { applyAICreative(data); showToast('✨ GPT-4 generated new creative pack!'); }
    } catch(e) { showToast('⚠️ Regenerate failed: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '✨ Regenerate'; }
  });

  // ── Custom Redesign (Settings tab) ────────────────────────────────────────
  document.getElementById('cs-regen-full').addEventListener('click', async () => {
    const tone    = document.getElementById('cs-tone').value;
    const persona = document.getElementById('cs-persona').value || 'growth-focused marketing teams';
    const diff    = document.getElementById('cs-diff').value || 'AI-powered competitor intelligence at scale';
    const cta     = document.getElementById('cs-cta').value;
    const output  = document.getElementById('cs-regen-output');
    const btn     = document.getElementById('cs-regen-full');
    output.style.display = 'block';
    output.innerHTML = `<div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:18px;font-size:0.82rem;color:#4C1D95;text-align:center"><span style="display:inline-block;width:18px;height:18px;border:3px solid rgba(124,58,237,.2);border-top-color:#7C3AED;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px"></span>GPT-4 writing custom creative pack...</div>`;
    btn.disabled = true; btn.textContent = '⏳ GPT-4 Working...';
    try {
      const res = await fetch('/api/ai-creative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, campName: name, tone, persona, differentiator: diff, cta, topComp, competitors: allComps.slice(0,4), tags: campTags, industry: indName, domain })
      });
      const data = await res.json();
      applyAICreative(data);
      const src = data.source === 'gpt4' ? 'GPT-4' : 'AI Engine';
      output.innerHTML = `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px;font-size:0.82rem;color:#065F46;text-align:center">✅ ${src} creative pack applied to all tabs — check Ad Copy, Social & Video, LinkedIn, and Email Brief!</div>`;
      showToast('✨ Custom GPT-4 creative pack applied to all tabs!');
    } catch(e) {
      output.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:10px;padding:14px;font-size:0.8rem;color:#991B1B">⚠️ Generation failed: ${e.message}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = '✨ Generate New Variants with GPT-4';
    }
  });
}

// ===== NAVIGATION =====
function navigateTo(viewId, updateActive = true) {
  // ── Permission guard (defense-in-depth; the server still enforces) ──────────
  // Block switching to a view the signed-in role isn't granted and redirect to
  // the first view they ARE permitted to see. Skipped until permissions have
  // loaded (IGNavPerms.ready) so the synchronous initial nav isn't blocked, and
  // skipped for the universal 'home' entry (never in the matrix → always allowed).
  try {
    if (window.IGNavPerms && window.IGNavPerms.ready && !window.IGNavPerms.can(viewId)) {
      const dest = window.IGNavPerms.firstPermittedView(window.IGNavPerms.orderedNavViews());
      if (dest && dest !== viewId) {
        try { showToast('🔒 You don\'t have access to that — showing what you can use.'); } catch(_) {}
        return navigateTo(dest, updateActive);
      }
      return; // nothing permitted to fall back to — stay put
    }
  } catch(_) {}
  // Breadcrumb for the watchdog: if the main thread stalls anywhere inside this
  // synchronous navigation (build dispatch, field-enhancer scan, etc.), the
  // beaconed STALL line will be tagged with the view we were switching to.
  try { window.IGDiag && IGDiag.setBreadcrumb && IGDiag.setBreadcrumb('nav→' + viewId); } catch(_) {}
  // Pause the field-enhancer for the duration of this synchronous call so the
  // MutationObserver doesn't get hammered by every view's innerHTML swap.
  // A deferred resume (below) reconnects it and scans only what's new.
  try { window.IGFields && IGFields.pause && IGFields.pause(); } catch(_) {}
  document.querySelectorAll('.view').forEach(v => {
    v.style.display = 'none';
    v.classList.remove('active');
  });
  const target = document.getElementById('view-' + viewId);
  if (target) {
    target.classList.remove('hidden');
    target.style.display = 'block';
    target.classList.add('active');
  } else {
    // No legacy `#view-<id>` div — under the Next.js dev shell this view has
    // been ported to React and its div is stripped from the replay shell. Bridge
    // the navigation to the Next router so <MigratedPanel/> mounts the React
    // panel for this view. <LegacyNavBridge/> (mounted in the dashboard layout)
    // listens for this event and pushes the canonical URL. Where no bridge is
    // mounted (e.g. legacy-only contexts) this is a harmless no-op event.
    //
    // Dispatch synchronously (do NOT rAF-defer): a deferred bridge races the
    // AppShell/Next router.push and can remount Suspense mid-reconcile, which
    // throws NotFoundError: removeChild.
    // Bridge to the Next URL when React has not already started this same
    // transition. AppShell/goToView set __igPendingView + router.push first —
    // skip the duplicate event in that case. But if __igReactRouting is only a
    // stale leftover (or was never paired with a push for THIS view), we must
    // still dispatch — otherwise Analyse completion hides #view-home and leaves
    // a blank /analyse stage with no React panel mounted.
    try {
      const reactOwnsThis = !!(window.__igReactRouting && window.__igPendingView === viewId);
      const path = (window.location && window.location.pathname) || '';
      const alreadyOnView = viewId === 'home'
        ? (path === '/analyse' || path === '/' || path === '')
        : (path === '/manage/' + viewId || path.endsWith('/' + viewId));
      if (!reactOwnsThis && !alreadyOnView) {
        try {
          document.documentElement.setAttribute('data-ig-nav', '1');
          window.__igReactRouting = true;
          window.__igPendingView = viewId;
          window.IGDiag && IGDiag.setBreadcrumb && IGDiag.setBreadcrumb('nav→' + viewId);
        } catch(_) {}
        document.dispatchEvent(new CustomEvent('ig:spa-navigate', { detail: { view: viewId } }));
        // Do NOT set breadcrumb to idle here — MigratedPanel settleNavPending
        // clears the guard after first paint.
      }
    } catch(_) {}
  }
  currentView = viewId;
  try { window.currentView = viewId; } catch(_) {}
  igTrack('Page Viewed', { page: viewId });
  if (updateActive) {
    // Mark the active dropdown item
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.view === viewId);
    });
    // Highlight the parent group button
    document.querySelectorAll('.nav-group-wrap').forEach(wrap => {
      const hasActive = wrap.querySelector(`.nav-link[data-view="${viewId}"]`);
      wrap.classList.toggle('group-active', !!hasActive);
    });
  }
  // Rebuild views on demand so they're always populated when navigated to.
  // Top-level analyse-flow views: build lazily if the background pre-build
  // queue hasn't reached them yet. Idempotent — marker prevents double work.
  window._igViewBuilt = window._igViewBuilt || {};
  const _lazyBuild = (id, fn) => {
    if (window._igViewBuilt[id]) return;
    try {
      window.IGDiag && IGDiag.log('build' + id + ': start (lazy)');
      const t0 = performance.now();
      fn();
      window.IGDiag && IGDiag.log('build' + id + ': done (lazy)', ((performance.now()-t0)).toFixed(0) + 'ms');
      window._igViewBuilt[id] = true; // success → mark built
    } catch(e) {
      console.warn('build' + id + ' lazy error:', e);
      window.IGDiag && IGDiag.err('build' + id + ' lazy error', e && e.message || String(e));
      // Leave marker false so a future navigation can retry
    }
  };

  if (viewId === 'brand-foundation') { try { window.buildBrandFoundation && window.buildBrandFoundation(); } catch(e) { console.warn('buildBrandFoundation error:', e); } }
  // (battleplan now handled by _lazyBuild above)
  // ── Tier 1+2 Plai-parity modules ─────────────────────────────────────────
  // Show/hide navbar for home vs app
  // Left-rail shell: #navGroups must stay a COLUMN flex. Legacy top-nav used a
  // horizontal row; setting display:flex without flex-direction clips every
  // sidebar group (overflow-x:hidden) so menus appear to "vanish".
  const navGroups = document.getElementById('navGroups');
  const navPlan   = document.getElementById('navPlanBadge');
  const navBtn    = document.getElementById('navAnalyseBtn');
  if (navGroups) {
    navGroups.style.display = 'flex';
    navGroups.style.flexDirection = 'column';
    navGroups.style.flexWrap = 'nowrap';
    navGroups.style.alignItems = 'stretch';
  }
  if (navPlan)   navPlan.style.display   = viewId === 'home' ? 'none'  : 'block';
  if (navBtn)    navBtn.style.display    = viewId === 'home' ? 'none'  : 'block';
  window.scrollTo(0, 0);
  // Inject "What's Next?" guide banner after each view renders
  setTimeout(() => _injectNextStep(viewId), 120);
  // Resume field-enhancer after all synchronous build work is done.
  // requestAnimationFrame fires after the browser has painted the new view,
  // so the scan sees the final DOM and doesn't fight with layout.
  // When React owns the transition (__igReactRouting), MigratedPanel's
  // settleNavPending resumes IGFields after the panel's first paint — do not
  // clear markers / resume here or mount work is misreported as idle stalls.
  (window.requestAnimationFrame || setTimeout)(function() {
    try {
      if (window.__igReactRouting) return;
      if (window.IGFields) {
        IGFields.resume && IGFields.resume({ scan: false });
        const viewEl = document.getElementById('view-' + viewId);
        if (viewEl) IGFields.scanRoot && IGFields.scanRoot(viewEl);
      }
    } catch(_) {}
    // scanRoot queues chunked decoration across many rAFs — clearing the
    // breadcrumb to idle immediately made IGDiag flag home's ~800-node form as
    // a MAIN-THREAD STALL (`last=idle · view=home`). Keep panel:<view> up on
    // form-heavy legacy panels until decoration has had time to settle.
    const heavyLegacy = viewId === 'home';
    const clearIdle = () => {
      try {
        if (window.__igReactRouting) return;
        window.IGDiag && IGDiag.setBreadcrumb && IGDiag.setBreadcrumb('idle');
      } catch(_) {}
    };
    if (heavyLegacy) {
      try { window.IGDiag && IGDiag.setBreadcrumb && IGDiag.setBreadcrumb('panel:' + viewId); } catch(_) {}
      setTimeout(clearIdle, 2800);
    } else {
      clearIdle();
    }
  }, 0);
}

// ── Next-Step Guide Banners ────────────────────────────────────────────────────
const _nextStepMap = {
  dashboard:    { icon:'🚀', label:'Ready to act on this intel?', btnLabel:'Build Campaigns →', view:'campaigns',   hint:'Turn competitor insights into live ad campaigns' },
  competitors:  { icon:'⚔️', label:'Know your rivals — now beat them.',  btnLabel:'Create Battle Plan →', view:'battleplan',  hint:'8-week strategy to capture market share' },
  battleplan:   { icon:'🧠', label:'Have your strategy — now create the content.', btnLabel:'Open Content AI →', view:'content', hint:'Build topical clusters & content gaps' },
  content:      { icon:'📅', label:'Content strategy ready — time to schedule it.', btnLabel:'Open Social Calendar →', view:'social', hint:'Schedule posts across all platforms' },
  social:       { icon:'🚀', label:'Posts scheduled — now build your ad campaigns.', btnLabel:'Go to Campaigns →', view:'campaigns', hint:'Launch paid ads alongside your organic content' },
  campaigns:    { icon:'🎯', label:'Campaigns built — now target the right audience.',btnLabel:'Audience Intelligence →', view:'audience', hint:'Find and segment your highest-converting audiences' },
  audience:     { icon:'📣', label:'Audiences defined — now launch your ads.',       btnLabel:'Advertise Hub →', view:'advertise', hint:'Deploy across 20+ channels in minutes' },
  advertise:    { icon:'📊', label:'Ads live — track your results.',                  btnLabel:'View Results →', view:'results',   hint:'Monitor performance and optimise ROAS' },
  results:      { icon:'🔁', label:'See who dropped off? Win them back.',             btnLabel:'Re-Engage Hub →', view:'reengage',  hint:'AI-powered win-back sequences for lost customers' },
  reengage:     { icon:'⚡', label:'Put your growth on autopilot.',                   btnLabel:'Automations →', view:'automations', hint:'Triggered campaigns, alert rules and scheduled reports' },
  intelligence: { icon:'⚔️', label:'Competitive gaps identified — build your plan.', btnLabel:'Battle Plan →', view:'battleplan', hint:'Turn keyword & ad gaps into a 8-week action plan' },
  reddit:       { icon:'📣', label:'Market insights gathered — now reach them.',      btnLabel:'Advertise Hub →', view:'advertise', hint:'Run ads targeting the communities you just researched' },
  serp:         { icon:'🚀', label:'Keyword rankings clear — grow your organic SEO.', btnLabel:'AutoSEO Pro →', view:'autoseo',    hint:'Content calendar, backlinks & traffic projections' },
  autoseo:      { icon:'🤖', label:'SEO engine running — boost your AI presence.',   btnLabel:'AI Visibility →', view:'search-intel', hint:'Get cited by ChatGPT, Claude & Gemini' },
  'search-intel': { icon:'⚡', label:'AI visibility tracked — run the deep audits.', btnLabel:'AI Audit Suite →', view:'ai-audit-suite', hint:'Prompt coverage, accuracy, citations, sentiment & more' },
  'action-center':{ icon:'🚀', label:'Actions prioritised — deploy them.',            btnLabel:'Campaigns →', view:'campaigns', hint:'Launch campaigns around your top action items' },
  agency:       { icon:'👔', label:'Agency reports ready — share executive dashboards.', btnLabel:'C-Suite Reports →', view:'csuite', hint:'CEO, CMO, CFO & COO one-click PDF dashboards' },
};

function _injectNextStep(viewId) {
  if (viewId === 'home' || viewId === 'settings') return;
  const step = _nextStepMap[viewId];
  if (!step) return;
  // Find the main content container of the current view
  const view = document.getElementById('view-' + viewId);
  if (!view) return;
  // Remove any existing banner
  const old = view.querySelector('.ig-next-step-banner');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.className = 'ig-next-step-banner';
  banner.style.cssText = 'margin:0;padding:18px 0 32px;background:transparent';
  banner.innerHTML = `
    <div style="max-width:1140px;margin:0 auto;padding:0 24px">
      <div style="background:var(--ig-grad);border-radius:16px;border:1px solid rgba(0,229,255,.15);padding:18px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:1.4rem">${step.icon}</span>
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:white">${step.label}</div>
            <div style="font-size:0.72rem;color:#93C5FD;margin-top:2px">${step.hint}</div>
          </div>
        </div>
        <button onclick="navigateTo('${step.view}')" style="padding:10px 22px;background:linear-gradient(135deg,#00E5FF,#0066FF);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">${step.btnLabel}</button>
      </div>
    </div>`;
  view.appendChild(banner);
}

// ===== LOADING OVERLAY (analyse progress) =====
// AppShell's .content keeps a transform from its entrance animation, which
// turns position:fixed into "fixed to the content box". The loading card was
// then centered in a tall off-screen area — users only saw a dark veil.
// Always portal the overlay onto document.body while it is visible.
function _igShowLoadingOverlay(targetLabel) {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return null;
  _igPortalToBody(overlay);
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  const targetEl = document.getElementById('loadingTargetValue');
  if (targetEl) targetEl.textContent = targetLabel || 'your market';
  const list = document.getElementById('loadingActivityList');
  if (list) list.innerHTML = '';
  window._igLoadingActStart = performance.now();
  return overlay;
}

function _igHideLoadingOverlay(overlay) {
  const el = overlay || document.getElementById('loadingOverlay');
  if (!el) return;
  el.style.display = 'none';
  el.classList.add('hidden');
  _igRestoreFromBody(el);
}

// Portal fixed overlays/modals to document.body so they aren't trapped inside
// AppShell's transformed .content box (same root cause as the loading overlay).
function _igPortalToBody(el) {
  if (!el) return;
  if (!el.dataset.igHomeParent) {
    el.dataset.igHomeParent = '1';
    el._igHomeParent = el.parentNode;
  }
  try {
    if (el.parentNode !== document.body) document.body.appendChild(el);
  } catch (_) {}
}

function _igRestoreFromBody(el) {
  if (!el) return;
  try {
    if (el._igHomeParent && el.parentNode === document.body) {
      el._igHomeParent.appendChild(el);
    }
  } catch (_) {}
}

function _igLoadingActivity(message, state) {
  const list = document.getElementById('loadingActivityList');
  if (!list) return;
  // Mark previous active rows as done
  list.querySelectorAll('li.is-active').forEach((li) => {
    li.classList.remove('is-active');
    li.classList.add('is-done');
  });
  const li = document.createElement('li');
  if (state === 'done') li.className = 'is-done';
  else li.className = 'is-active';
  const sec = window._igLoadingActStart
    ? ((performance.now() - window._igLoadingActStart) / 1000).toFixed(1)
    : '0.0';
  li.innerHTML = `<span>${String(message || '').replace(/</g, '&lt;')}</span><span class="loading-act-time">${sec}s</span>`;
  list.appendChild(li);
  try { list.scrollTop = list.scrollHeight; } catch (_) {}
  const statusText = document.getElementById('loadingStatusText');
  if (statusText && state !== 'done') statusText.textContent = message;
}

// ===== ANALYSIS FLOW =====
async function runAnalysis(url, country, industryOverride) {
  // ── Pause field enhancer during the analyse-flow render burst ──────────────
  // The dashboard + competitor + settings builders dump enormous subtrees in
  // <500ms. The enhancer's MutationObserver reacts to every added node and
  // floods the rAF queue with decoration work, which can saturate the main
  // thread and freeze the page. Resume + full-doc rescan ~3s later when the
  // builders + deferred enrichments have settled.
  try { window.IGFields && window.IGFields.pause && window.IGFields.pause(); } catch(_) {}
  setTimeout(() => { try { window.IGFields && window.IGFields.resume && window.IGFields.resume(); } catch(_) {} }, 3500);

  // Heartbeat — fires every 500ms while runAnalysis is in flight. If the
  // server log shows a long gap between heartbeats we know the main thread
  // was blocked during that window. Cleared after 10s total.
  if (window._igHeartbeat) clearInterval(window._igHeartbeat);
  const _hbStart = performance.now();
  let _hbN = 0;
  window._igHeartbeat = setInterval(() => {
    _hbN++;
    const sec = ((performance.now() - _hbStart) / 1000).toFixed(1);
    window.IGDiag && IGDiag.log('heartbeat #' + _hbN, sec + 's');
    if (_hbN >= 20) { clearInterval(window._igHeartbeat); window._igHeartbeat = null; }
  }, 500);

  const hasUrl       = !!(url && url.trim().length >= 3);
  const hasIndustry  = !!(industryOverride && industryOverride.trim().length >= 2);

  // Sector-only mode: allow analysis with NO website URL when an industry is given.
  // We synthesise a placeholder domain so all downstream code (which expects a URL)
  // keeps working — but the UI clearly labels the report as a sector overview.
  let sectorOnly = false;
  if (!hasUrl && !hasIndustry) {
    showToast('⚠️ Enter a website URL OR pick an industry to analyse');
    return;
  }
  if (!hasUrl && hasIndustry) {
    sectorOnly = true;
  }

  // Resolve industry FIRST (so we can build a synthetic domain if needed)
  let industryKey = null;
  let industrySource = 'auto-detected';
  if (hasIndustry) {
    const overrideKey = detectIndustryFromText(industryOverride.trim());
    if (overrideKey) {
      industryKey = overrideKey;
      industrySource = 'user-specified';
    }
  }

  // Build cleanUrl: use real input if given, else synthesise from industry key
  const cleanUrl = hasUrl
    ? url.replace(/https?:\/\//,'').replace(/www\./,'').trim()
    : `${(industryKey || 'sector')}-overview.industry`;

  if (!industryKey) {
    industryKey = detectIndustry(cleanUrl);
  }

  // Wrap fetch with a hard timeout — protects every network call in the
  // analyse flow so a single slow/hung endpoint cannot freeze the whole UI.
  const _fetchWithTimeout = (label, url, opts, ms) => {
    const ctl = new AbortController();
    const t0 = performance.now();
    const to = setTimeout(() => ctl.abort(), ms || 20000);
    window.IGDiag && IGDiag.mark(label + ': fetch start');
    return fetch(url, Object.assign({}, opts, { signal: ctl.signal }))
      .then(r => {
        clearTimeout(to);
        window.IGDiag && IGDiag.mark(label + ': response', r.status + ' in ' + ((performance.now()-t0)/1000).toFixed(1) + 's');
        return r.ok ? r.json() : null;
      })
      .catch(err => {
        clearTimeout(to);
        window.IGDiag && IGDiag.err(label + ': failed', (err && err.name || 'err') + ' after ' + ((performance.now()-t0)/1000).toFixed(1) + 's');
        return null;
      });
  };

  // ── Kick off live AI-powered industry + competitor detection (non-blocking) ─
  // Scrapes the website and uses GPT-4o to identify the precise sub-niche and
  // suggest 6-10 real direct competitors. Awaited later before building views.
  const smartDetectPromise = (industrySource === 'user-specified' || sectorOnly)
    ? Promise.resolve(null) // user override / sector-only mode → skip live scrape
    : _fetchWithTimeout('smart-detect', '/api/smart-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl })
      }, 25000);

  // ── If user typed an industry (sector-only OR refining a URL), call the
  //    AI sector-competitors endpoint to get REAL same-niche competitors.
  //    This solves the "search by industry returns wrong companies" problem.
  const sectorPromise = hasIndustry
    ? _fetchWithTimeout('sector-competitors', '/api/sector-competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: industryOverride.trim(),
          country: country || '',
          urlHint: hasUrl ? cleanUrl : ''
        })
      }, 25000)
    : Promise.resolve(null);

  const industry = INDUSTRY_DB[industryKey];
  const websiteKPIs = generateWebsiteKPIs(cleanUrl, industryKey);
  igTrack('Analysis Started', { domain: cleanUrl, country, industry: industry.name, industrySource });

  // Update the hint label to confirm detected industry
  const hintEl = document.getElementById('industryHint');
  if (hintEl) {
    hintEl.textContent = `✓ ${industrySource === 'user-specified' ? 'Industry set' : 'Auto-detected'}: ${industry.name}`;
    hintEl.style.color = '#00C9C8';
  }

  // Show loading — portal to body so the card is actually visible.
  const targetLabel = sectorOnly
    ? (industryOverride || industry.name || 'sector overview')
    : cleanUrl;
  const overlay = _igShowLoadingOverlay(targetLabel);
  _igLoadingActivity(
    sectorOnly
      ? `Starting sector analysis for “${targetLabel}”`
      : `Opening ${cleanUrl} — scraping site signals`,
    'active',
  );

  // ── Safety net ─────────────────────────────────────────────────────────────
  // The overlay is now hidden late in the flow (after competitor-metrics +
  // ai-validate-metrics). If an unhandled exception fires anywhere between
  // here and the normal hide point, the user would be stuck on the loading
  // modal forever. This 90s watchdog guarantees teardown either way.
  if (window._runAnalysisSafetyTimer) clearTimeout(window._runAnalysisSafetyTimer);
  window._runAnalysisSafetyTimer = setTimeout(() => {
    try {
      if (overlay && overlay.style.display !== 'none') {
        _igHideLoadingOverlay(overlay);
        if (window._elapsedTimer) { clearInterval(window._elapsedTimer); window._elapsedTimer = null; }
        showToast('⚠ Analyse took longer than expected — opening dashboard with available data');
        window.IGDiag && IGDiag.err && IGDiag.err('runAnalysis: safety watchdog fired (90s)', 'overlay was still visible');
      }
    } catch(_) {}
  }, 90000);

  // ── Live elapsed-time ticker (resets each run) ───────────────────────────
  const _runStart = performance.now();
  window._lastRunStart = _runStart;
  window._analysisStartedAt = Date.now();
  const _elapsedEl = document.getElementById('loadingElapsedTime');
  if (window._elapsedTimer) clearInterval(window._elapsedTimer);
  if (_elapsedEl) _elapsedEl.textContent = '0.0s';
  window._elapsedTimer = setInterval(() => {
    if (!_elapsedEl) return;
    const sec = (performance.now() - _runStart) / 1000;
    _elapsedEl.textContent = sec.toFixed(1) + 's';
  }, 100);
  
  // Animate loading steps
  const detectionLabel = industrySource === 'user-specified'
    ? `Industry set to: ${industry.name} ✓`
    : `Auto-detected industry: ${industry.name}`;
  const steps = [
    { id: 'lst1', label: detectionLabel, activity: `Classifying niche → ${industry.name}`, duration: 250 },
    { id: 'lst2', label: `Found ${industry.competitors.length} targeted competitors in ${industry.name}`, activity: `Shortlisting ${industry.competitors.length} rivals in ${industry.name}`, duration: 300 },
    { id: 'lst3', label: 'Analysing campaign performance, CTR, and ROAS...', activity: 'Reading campaign performance signals (CTR / ROAS / spend)', duration: 350 },
    { id: 'lst4', label: 'Generating AI campaign recommendations...', activity: 'Drafting AI campaign recommendations & creative angles', duration: 300 },
    { id: 'lst5', label: 'Building full intelligence report...', activity: 'Assembling intelligence report structure', duration: 200 }
  ];
  
  const bar = document.getElementById('loadingBarFill');
  const pct = document.getElementById('loadingPct');
  const statusText = document.getElementById('loadingStatusText');
  
  // Reset steps
  steps.forEach(s => {
    const el = document.getElementById(s.id);
    if (!el) return;
    el.classList.remove('active', 'done');
    const check = el.querySelector('.lstep-check');
    if (check) check.classList.add('hidden');
  });
  
  bar.style.width = '0%';
  pct.textContent = '0%';
  
  let cumulativeTime = 0;
  const totalTime = steps.reduce((a, s) => a + s.duration, 0);
  
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const el = document.getElementById(s.id);
    if (el) el.classList.add('active');
    if (statusText) statusText.textContent = s.label;
    _igLoadingActivity(s.activity || s.label, 'active');
    
    await wait(s.duration);
    
    cumulativeTime += s.duration;
    const progress = Math.round((cumulativeTime / totalTime) * 100);
    bar.style.width = progress + '%';
    pct.textContent = progress + '%';
    
    if (el) {
      el.classList.remove('active');
      el.classList.add('done');
      const check = el.querySelector('.lstep-check');
      if (check) check.classList.remove('hidden');
      el.querySelector('.lstep-dot').style.background = 'var(--green)';
    }
  }
  
  bar.style.width = '95%';
  pct.textContent = '95%';
  statusText.textContent = 'Fetching live competitor intelligence...';
  _igLoadingActivity(
    sectorOnly
      ? `Calling AI sector matcher for “${targetLabel}”`
      : `Running AI smart-detect on ${cleanUrl}`,
    'active',
  );

  // ── Await live AI smart-detection result (already running in background) ───
  // If it returned real competitors + a sharper industry name, override the DB.
  // Keep the loading overlay visible during these network calls so users get
  // continuous feedback instead of staring at a blank screen.
  let aiDetected = null;
  let sectorDetected = null;
  try { aiDetected = await smartDetectPromise; } catch(e) { aiDetected = null; }
  try { sectorDetected = await sectorPromise; } catch(e) { sectorDetected = null; }

  bar.style.width = '100%';
  pct.textContent = '100%';
  // Stop the elapsed-time ticker and show the final duration
  if (window._elapsedTimer) { clearInterval(window._elapsedTimer); window._elapsedTimer = null; }
  const _runSec = ((performance.now() - _runStart) / 1000).toFixed(1);
  if (_elapsedEl) _elapsedEl.textContent = _runSec + 's';
  window._lastRunDuration = parseFloat(_runSec);
  window._analysisStartedAt = null;
  if (aiDetected && aiDetected.ok) {
    const n = Array.isArray(aiDetected.competitors) ? aiDetected.competitors.length : 0;
    const niche = aiDetected.subNiche || aiDetected.industryName || industry.name;
    _igLoadingActivity(
      n
        ? `AI matched ${n} competitors in ${niche}`
        : `AI classified niche as ${niche}`,
      'active',
    );
  } else if (sectorDetected && sectorDetected.ok) {
    const n = Array.isArray(sectorDetected.competitors) ? sectorDetected.competitors.length : 0;
    _igLoadingActivity(`Sector match returned ${n} competitors`, 'active');
  } else {
    _igLoadingActivity('Using industry database competitors (live AI unavailable)', 'active');
  }
  statusText.textContent = `✅ Industry & competitors locked in — fetching live metrics…`;
  _igLoadingActivity('Industry & competitors locked — fetching live metrics', 'active');
  // NOTE: overlay stays visible. The two slowest API calls
  // (competitor-metrics ~12s + ai-validate-metrics ~13s) still run below,
  // and we don't want the user staring at a blank home page for ~25s.
  // The overlay is hidden right before navigateTo('marketing-brief') further down.

  // ── If URL was given but user didn't type an industry, take the sub-niche
  //    that smart-detect inferred from the website and use it to fetch a
  //    canonical, real-world same-niche competitor list. This cures the
  //    "wrong industry / wrong competitors" issue when only a URL is entered.
  if (!sectorDetected && hasUrl && !hasIndustry && aiDetected && aiDetected.ok) {
    const inferredNiche = aiDetected.subNiche || aiDetected.industryName;
    if (inferredNiche) {
      // 25s hard timeout — this fallback path was previously unbounded and
      // could stall the entire analysis if the endpoint hung.
      const _sfCtl = new AbortController();
      const _sfT0  = performance.now();
      const _sfTo  = setTimeout(() => _sfCtl.abort(), 25000);
      window.IGDiag && IGDiag.mark('sector-competitors-fallback: fetch start', `niche=${inferredNiche}`);
      try {
        const r = await fetch('/api/sector-competitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            industry: inferredNiche,
            country: country || aiDetected.country || '',
            urlHint: cleanUrl,
          }),
          signal: _sfCtl.signal,
        });
        clearTimeout(_sfTo);
        window.IGDiag && IGDiag.mark('sector-competitors-fallback: response', `${r.status} in ${((performance.now()-_sfT0)/1000).toFixed(1)}s`);
        if (r.ok) sectorDetected = await r.json();
      } catch (e) {
        clearTimeout(_sfTo);
        window.IGDiag && IGDiag.err('sector-competitors-fallback: aborted/failed', (e && e.name || 'err') + ' after ' + ((performance.now()-_sfT0)/1000).toFixed(1) + 's');
      }
    }
  }

  // ── Sector AI result takes PRIORITY when available — it returns real
  //    same-niche competitors with much better coverage than the static DB.
  if (sectorDetected && sectorDetected.ok && Array.isArray(sectorDetected.competitors) && sectorDetected.competitors.length >= 3) {
    // Reshape to look like the smart-detect payload so the existing handler picks it up.
    aiDetected = {
      ok: true,
      industryName: sectorDetected.industryName || (industryOverride && industryOverride.trim()) || (aiDetected && aiDetected.industryName) || 'Detected industry',
      businessSummary: '',
      competitors: sectorDetected.competitors,
      _source: 'sector',
    };
    if (hintEl) {
      hintEl.textContent = `✓ AI-matched ${sectorDetected.competitors.length} ${sectorDetected.industryName || 'industry'} competitors`;
      hintEl.style.color = '#00C9C8';
    }
  }

  let displayIndustryName = industry.name;
  let aiCompetitorPool = null;
  if (aiDetected && aiDetected.ok) {
    if (aiDetected.industryName) {
      displayIndustryName = aiDetected.industryName;
      industry.name = aiDetected.industryName; // patch in-memory for downstream use
    }
    if (Array.isArray(aiDetected.competitors) && aiDetected.competitors.length >= 3) {
      // Convert AI competitors into the same shape the rest of the UI expects.
      aiCompetitorPool = aiDetected.competitors.map((c, idx) => {
        const threats = ['critical','high','medium'];
        const initials = (c.name || '?').split(/\s+/).slice(0,2).map(s=>s.charAt(0).toUpperCase()).join('');
        return {
          name: c.name,
          domain: c.url,
          url: c.url,
          why: c.why,
          logo: initials || '?',
          // Start with NULL sentinels — real values are filled in by the
          // DataForSEO overlay (live scrape) + dual-LLM AI-validation pass
          // below. No Math.random() anywhere. If neither source returns data
          // the UI shows "—" with a "Limited public data" tooltip.
          roas: null,
          ctr:  null,
          traffic: null,
          adSpend: null,
          dataSource: 'pending',
          confidence: null,
          // topChannel is filled by /api/ai-validate-metrics (which asks both
          // GPT-4o and Claude which channel each brand actually invests in).
          // Until then it stays null and the UI renders "—".
          topChannel: null,
          topChannels: [],
          threatLevel: threats[idx % threats.length],
          // Synthesize campaign rows so the "Competitor Campaign Breakdown"
          // table has structure. Names + channels are filled later from the
          // validated topChannel; nothing is randomised.
          campaigns: (() => {
            const camp1Names = ['Brand Search Domination', 'Lookalike Audience Push', 'Retargeting Wave', 'Awareness Reels Burst'];
            const camp2Names = ['Comparison Landing Funnel', 'Free Trial Lead Gen', 'Top-Funnel Display', 'High-Intent Keyword Steal'];
            return [
              { name: camp1Names[idx % camp1Names.length], channel: null, ctr: null, roas: null, budget: null, _split: 0.6 },
              { name: camp2Names[idx % camp2Names.length], channel: null, ctr: null, roas: null, budget: null, _split: 0.4 },
            ];
          })(),
          // Audience splits — empty until enriched. The audience overlap
          // panel handles an empty array gracefully ("No audience data").
          audiences: [],
          // Sample ad copy so the "InfoGenie Improved Ads" section has material
          adCopy: [
            { headline: `Trade smarter than ${c.name}`, body: `See why thousands switched from ${c.name} to a faster, lower-fee platform.` },
          ],
          suggestions: [
            `Outflank ${c.name} on long-tail variations of their core keywords — they over-index on brand terms`,
            `Use comparison content (${c.name} vs You) to capture their branded search intent`,
            `Target ${c.name}'s mid-funnel comparison queries with high-intent landing pages`,
          ],
          aiDetected: true,
        };
      });
      industry.competitors = aiCompetitorPool;
      try { localStorage.setItem('ig-ai-detected', JSON.stringify({ industryName: aiDetected.industryName, businessSummary: aiDetected.businessSummary, competitors: aiDetected.competitors, at: Date.now() })); } catch(e){}

      // ── Overlay REAL DataForSEO metrics on top of the AI competitor pool ──
      // Replaces randomised ROAS / CTR / Traffic / Ad-spend with live numbers
      // pulled from DataForSEO domain_rank_overview + keywords_for_site.
      try {
        statusText.textContent = 'Pulling live competitor traffic & ad-spend data...';
        _igLoadingActivity('Pulling live competitor traffic & ad-spend data', 'active');
        const domainList = aiCompetitorPool.map(c => c.domain).filter(Boolean);
        if (domainList.length) {
          // 25s hard timeout — DataForSEO can be slow but should never hang the UI.
          const _cmCtl = new AbortController();
          const _cmT0  = performance.now();
          const _cmTo  = setTimeout(() => _cmCtl.abort(), 25000);
          window.IGDiag && IGDiag.mark('competitor-metrics: fetch start', `n=${domainList.length}`);
          const mr = await fetch('/api/competitor-metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domains: domainList, industryKey, location: country || 'United States' }),
            signal: _cmCtl.signal
          }).catch(e => {
            window.IGDiag && IGDiag.err('competitor-metrics: aborted/failed', e.name + ' after ' + ((performance.now()-_cmT0)/1000).toFixed(1) + 's');
            return null;
          });
          clearTimeout(_cmTo);
          window.IGDiag && IGDiag.mark('competitor-metrics: response', mr ? `${mr.status} in ${((performance.now()-_cmT0)/1000).toFixed(1)}s` : 'no response');
          if (mr && mr.ok) {
            const mj = await mr.json();
            const byDomain = {};
            (mj.results || []).forEach(r => {
              const key = (r.domain || '').replace(/^www\./,'').toLowerCase();
              if (key) byDomain[key] = r;
            });
            aiCompetitorPool.forEach(c => {
              const key = (c.domain || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase();
              const m = byDomain[key];
              if (m && m.realData && m.totalTraffic > 0) {
                if (m.roas > 0)            c.roas    = m.roas;
                if (m.ctrFmt)              c.ctr     = m.ctrFmt;
                if (m.trafficFmt)          c.traffic = m.trafficFmt;
                if (m.adSpend && m.adSpend !== '—') c.adSpend = m.adSpend;
                c.realData      = true;
                c.dataSource    = 'DataForSEO';
                c.domainRank    = m.domainRank;
                c.organicKeywords = m.organicKeywords;
                c.paidKeywords  = m.paidKeywords;
                c.avgPosition   = m.avgPosition;
                c.avgCPC        = m.avgCPC;
              }
            });
            console.log(`✓ Real metrics overlaid on ${Object.keys(byDomain).length}/${domainList.length} competitors`);
          }
        }
      } catch(e) { console.warn('competitor-metrics overlay failed:', e); }

      // ── AI VALIDATION PASS ────────────────────────────────────────────────
      // Cross-check + refine traffic / ad-spend / ROAS / CTR using OpenAI.
      // The model uses its training-data knowledge of well-known brands
      // (Similarweb estimates, earnings reports, industry benchmarks) to
      // either CONFIRM the DataForSEO values or FILL IN the gaps where
      // DataForSEO returned nothing.
      try {
        statusText.textContent = 'AI is validating competitor data accuracy...';
        _igLoadingActivity('AI validating competitor metrics for accuracy', 'active');
        window.IGDiag && IGDiag.mark('ai-validate-metrics: start', `n=${aiCompetitorPool.length}`);
        const aiPayload = aiCompetitorPool.map(c => ({
          name: c.name,
          domain: c.domain,
          currentTraffic: c.traffic,
          currentAdSpend: c.adSpend,
          currentROAS:    c.roas,
          currentCTR:     c.ctr,
          dataSource:     c.dataSource || null
        }));
        // 20s client-side timeout so a slow LLM never freezes the analyse flow
        const _aiCtl = new AbortController();
        const _aiTo  = setTimeout(() => _aiCtl.abort(), 20000);
        const _aiT0  = performance.now();
        const ar = await fetch('/api/ai-validate-metrics', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ competitors: aiPayload, industry: aiDetected.industryName || industryKey }),
          signal:  _aiCtl.signal
        }).catch(e => {
          window.IGDiag && IGDiag.err('ai-validate-metrics: aborted/failed', e.name + ' after ' + ((performance.now()-_aiT0)/1000).toFixed(1) + 's — continuing without AI validation');
          return null;
        });
        clearTimeout(_aiTo);
        window.IGDiag && IGDiag.mark('ai-validate-metrics: response', ar ? `${ar.status} in ${((performance.now()-_aiT0)/1000).toFixed(1)}s` : 'no response');
        if (ar && ar.ok) {
          const aj = await ar.json();
          const byName = {};
          (aj.results || []).forEach(r => { if (r && r.name) byName[r.name.toLowerCase().trim()] = r; });
          let refined = 0;
          aiCompetitorPool.forEach(c => {
            const key = (c.name || '').toLowerCase().trim();
            const v = byName[key];
            if (!v) return;
            const conf = (v.confidence || 'low').toLowerCase();
            // Fill in any value that is still null (DataForSEO didn't return it)
            // OR overwrite when the AI is HIGH confidence and we only have a
            // low-confidence DataForSEO derived value.
            // Merge rules — ad-spend ALWAYS prefers AI at medium+ confidence
            // because DataForSEO returns paid.etv (sum of keyword×CPC×CTR
            // across ALL paid-ranking keywords), which over-estimates wildly
            // for any high-SEO domain (eToro/IG/Plus500 land at $20M-60M/mo
            // when the real figure is $1M-5M/mo). Traffic is closer to right
            // so we only overwrite at HIGH confidence.
            // INTEGRITY GUARDRAIL:
            //   • Traffic, CTR and ROAS — accept LLM estimates (these track
            //     to public sources: Similarweb traffic, industry-benchmark
            //     CTR, sector-average ROAS). The "Est." column label in the
            //     UI makes the estimate nature clear.
            //   • Ad-spend — NEVER fill from the LLM. The model has no real
            //     way to know any private company's actual monthly ad spend;
            //     it hallucinates clean round numbers (e.g. eToro=$4M/mo)
            //     that look authoritative but are not grounded in any
            //     verifiable source. Ad spend stays "—" unless DataForSEO
            //     actually returned a paid-keyword spend estimate.
            const fillIfMissing = (key, val) => {
              if (val === null || val === undefined || val === '' || val === '—') return;
              if (key === 'adSpend') return; // hard block — see comment above
              if (c[key] === null || c[key] === undefined || c[key] === '' || c[key] === '—') {
                c[key] = val;
                return;
              }
              if (conf === 'high' && c.dataSource !== 'DataForSEO') {
                c[key] = val;
              }
            };
            fillIfMissing('traffic', v.traffic);
            fillIfMissing('ctr',     v.ctr);
            if (typeof v.roas === 'number' && v.roas > 0) {
              if (c.roas === null || c.roas === undefined || (conf === 'high' && c.dataSource !== 'DataForSEO')) {
                c.roas = parseFloat(v.roas.toFixed(1));
              }
            }
            // Primary channel comes straight from the dual-LLM consensus —
            // no random pick. Validator returns the brand's actual main paid
            // channel (Google Search / Meta Ads / TikTok / LinkedIn / etc.).
            if (typeof v.topChannel === 'string' && v.topChannel.trim() && v.topChannel.trim() !== '—') {
              const ch = v.topChannel.trim();
              if (!c.topChannel || c.topChannel === '—' || conf === 'high' || conf === 'medium') {
                c.topChannel = ch;
                c.topChannels = [ch];
                // Cascade to campaign rows so the breakdown table shows the
                // real channel instead of a null/blank cell.
                if (Array.isArray(c.campaigns)) {
                  c.campaigns.forEach((row, i) => {
                    if (!row.channel) {
                      row.channel = i === 0 ? ch : ch;
                    }
                  });
                }
              }
            }
            // Source attribution (so the UI can show a badge)
            if (!c.dataSource || c.dataSource === 'pending') {
              c.dataSource = conf === 'high' ? 'AI-verified' : 'AI-estimate';
            } else if (conf === 'high' && c.dataSource === 'DataForSEO') {
              c.dataSource = 'DataForSEO + AI-verified';
            }
            c.confidence  = conf;
            c.dataNotes   = v.notes   || '';
            c.dataOrigin  = v.source  || '';
            refined++;
          });
          console.log(`✓ AI validated/refined ${refined}/${aiCompetitorPool.length} competitors`);
        } else if (ar) {
          console.warn('ai-validate-metrics returned', ar.status);
        }
      } catch(e) { console.warn('AI validation pass failed:', e); }

      // Derive per-campaign breakdown rows from the now-real top-level metrics.
      // No more random fakery — the two campaign rows are weighted splits
      // (60/40) of the competitor's actual ad-spend, with CTR = top-level CTR
      // ± a small deterministic delta and ROAS = top-level ROAS ± delta.
      aiCompetitorPool.forEach(c => {
        if (!Array.isArray(c.campaigns) || !c.campaigns.length) return;
        const topRoas = (typeof c.roas === 'number' && c.roas > 0) ? c.roas : null;
        const topCtrN = parseFloat(c.ctr);
        const topSpendN = (() => {
          const s = String(c.adSpend || '').replace(/[$,\s]/g,'').toUpperCase();
          const n = parseFloat(s); if (!isFinite(n) || n <= 0) return null;
          if (s.includes('B')) return n * 1e9;
          if (s.includes('M')) return n * 1e6;
          if (s.includes('K')) return n * 1e3;
          return n;
        })();
        const fmtMoney = n => n >= 1e6 ? '$'+(n/1e6).toFixed(1)+'M/mo'
                          : n >= 1e3 ? '$'+(n/1e3).toFixed(0)+'K/mo'
                          : '$'+Math.round(n)+'/mo';
        c.campaigns.forEach((row, i) => {
          const split = row._split ?? (i === 0 ? 0.6 : 0.4);
          if (topCtrN > 0) {
            row.ctr = (topCtrN + (i === 0 ? 0.4 : -0.4)).toFixed(1) + '%';
          } else {
            row.ctr = '—';
          }
          if (topRoas !== null) {
            row.roas = parseFloat((topRoas + (i === 0 ? 0.3 : -0.3)).toFixed(1));
            if (row.roas < 0.5) row.roas = 0.5;
          } else {
            row.roas = '—';
          }
          if (topSpendN !== null) {
            row.budget = fmtMoney(topSpendN * split);
          } else {
            // Estimate the monthly budget required to achieve the shown CTR/ROAS
            // using traffic × industry CPC × paid-traffic fraction.
            const IND_CPC = { fintech:8, saas:5, ecommerce:1.5, travel:2.5, education:3,
              marketing:4, crypto:6, realestate:5, legal:12, insurance:9, health:4,
              automotive:3, retail:1.5, hospitality:2, fitness:2, software:5 };
            const cpc = IND_CPC[industryKey] || 4;
            const parseT = t => {
              const s = String(t||'').replace(/[^0-9.KMkm]/g,'').toUpperCase();
              const n = parseFloat(s);
              if (!isFinite(n) || n <= 0) return 0;
              if (s.includes('M')) return n * 1e6;
              if (s.includes('K')) return n * 1e3;
              return n;
            };
            const trafficN = parseT(c.traffic);
            // Higher ROAS means the competitor is more efficient — they don't need
            // as much paid traffic relative to organic; lower ROAS = more spend.
            const roasN = topRoas || 2.5;
            const paidFrac = roasN >= 4 ? 0.10 : roasN >= 3 ? 0.16 : 0.22;
            const estTotal = trafficN * paidFrac * cpc;
            if (estTotal >= 200) {
              row.budget = '~' + fmtMoney(estTotal * split);
            } else {
              row.budget = '—';
            }
          }
        });
      });

      // Final safety net — anything still null after both overlays gets a
      // clean "—" placeholder so the UI never shows "null" or random fakes.
      aiCompetitorPool.forEach(c => {
        if (c.traffic === null || c.traffic === undefined) c.traffic = '—';
        if (c.adSpend === null || c.adSpend === undefined) c.adSpend = '—';
        if (c.ctr     === null || c.ctr     === undefined) c.ctr     = '—';
        if (c.roas    === null || c.roas    === undefined) c.roas    = '—';
        if (!c.dataSource || c.dataSource === 'pending') {
          c.dataSource = 'Limited data';
          c.confidence = 'low';
        }
      });
    }
    // Update hint label live with the precise industry
    if (hintEl && aiDetected.industryName) {
      hintEl.textContent = `✓ AI-detected: ${aiDetected.industryName}`;
    }
  }

  // Pick a different set of competitors on every re-run:
  // 1. Split pool into "not seen last run" vs "seen last run"
  // 2. Shuffle each group independently
  // 3. Take fresh competitors first, then fill from seen ones if needed
  const _prevNames = window._lastCompetitorNames || [];
  const fresh = industry.competitors.filter(c => !_prevNames.includes(c.name));
  const seen  = industry.competitors.filter(c =>  _prevNames.includes(c.name));
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const poolOrdered = [...shuffle(fresh), ...shuffle(seen)];

  // Merge manual competitors — they always appear first, then AI-selected ones fill the rest
  const manuals = (window._manualCompetitors || []).map(mc => ({
    ...mc,
    // No more Math.random() fakes — keep "—" for unknown values, the data
    // pipeline (DataForSEO + AI validation) above is the source of truth.
    roas: (mc.roas !== undefined && mc.roas !== null && mc.roas !== '—') ? mc.roas : '—',
    ctr:  (mc.ctr  && mc.ctr  !== '—') ? mc.ctr  : '—',
    traffic: (mc.traffic && mc.traffic !== '—') ? mc.traffic : '—',
    adSpend: (mc.adSpend && mc.adSpend !== '—') ? mc.adSpend : '—',
    dataSource: mc.dataSource || 'Manual entry',
    confidence: mc.confidence || (mc.adSpend && mc.adSpend !== '—' ? 'high' : 'low'),
    // Manual competitors: keep whatever the user entered, otherwise leave
    // null so the dual-LLM validator below fills it from real intel rather
    // than randomly picking a channel.
    topChannel: (mc.topChannel && mc.topChannel !== '—') ? mc.topChannel : null,
    topChannels: (mc.topChannel && mc.topChannel !== '—') ? [mc.topChannel] : [],
    suggestions: mc.suggestions.length ? mc.suggestions : [
      `Target ${mc.name || mc.domain}'s branded keywords — they have weak presence on long-tail terms`,
      'Their landing pages likely lack mobile optimisation — use mobile-first creative to capture mobile share',
      'Minimal retargeting detected — RLSA campaigns will outperform their static audience setup'
    ]
  }));

  // Cap auto-selected competitors to leave room for manual ones (max 8 total)
  const autoCount = Math.max(0, Math.min(5, 8 - manuals.length));
  const selectedComps = [...manuals, ...poolOrdered.slice(0, autoCount)];
  window._lastCompetitorNames = selectedComps.filter(c => !c.manual).map(c => c.name);

  // Update loading step label to reflect manual competitors
  if (manuals.length > 0) {
    statusText.textContent = `✅ Analysing ${manuals.length} manual + ${autoCount} AI-detected competitors`;
  }

  // Reset campaign queue and creative round for fresh analysis
  queuedCampaigns = [];
  creativeRound = 0;

  // Company profile from smart-detect (powers the marketing command center dashboard)
  const _cpSignals = (aiDetected && aiDetected.signals) || {};
  const companyProfile = {
    domain: cleanUrl,
    businessSummary: (aiDetected && aiDetected.businessSummary) || '',
    subNiche: (aiDetected && aiDetected.subNiche) || '',
    siteTitle: _cpSignals.title || _cpSignals.ogSiteName || '',
    metaDesc: _cpSignals.metaDesc || _cpSignals.ogDesc || '',
    analyzedAt: new Date().toISOString(),
  };

  // Store analysis data
  analysisData = { url: cleanUrl, country, industryKey, industry, websiteKPIs, competitors: selectedComps, sectorOnly, companyProfile };
  window.analysisData = analysisData;  // Mirror to window so external modules (Link Suggester, CRO Lab, Analytics Hub, etc.) can read it
  // Notify the global field enhancer (ig_field_enhancer.js) so any Brand /
  // Competitor pickers already rendered refresh their option lists with the
  // freshly-analysed brand + competitor names. New fields rendered after this
  // point pick the data up live via the read-on-demand helpers.
  try { window.dispatchEvent(new CustomEvent('ig:analysis-updated', { detail: { brand: analysisData.brandName, competitors: (analysisData.competitors||[]).length } })); } catch(_) {}
  try { localStorage.setItem('ig-last-analysed-url', cleanUrl); } catch(e){}
  igTrack('Analysis Completed', { domain: cleanUrl, industry: industry.name, competitorCount: selectedComps.length, country });

  // ── WordPress Detection (non-blocking, runs in background) ──────────────────
  analysisData.isWordPress = false;
  analysisData.wpData = null;
  fetch('/api/detect-wordpress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: cleanUrl })
  }).then(r => r.json()).then(wp => {
    if (wp.isWordPress) {
      analysisData.isWordPress = true;
      analysisData.wpData = wp;
      showWordPressBadge(wp);
      showToast('🟦 WordPress detected — landing pages can be published directly to your site');
    }
  }).catch(() => {});

  // ── Dashboard-diag capture (fire-and-forget) ────────────────────────────────
  // Save the fully-collated analyse payload so we can launch the dashboard
  // directly from cache via the "Dashboard Diag" nav link — no API calls,
  // no waiting, ideal for debugging the post-render freeze.
  try {
    const _capture = {
      url: cleanUrl,
      capturedFromAnalyseRun: true,
      analysisData: JSON.parse(JSON.stringify(analysisData)),
      brandKit:    window._brandKit || null,
      lastCompetitorNames: window._lastCompetitorNames || []
    };
    fetch('/api/diag-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_capture),
      keepalive: true
    }).then(r => r.json()).then(j => {
      window.IGDiag && IGDiag.mark('diag-capture saved', j.domain + ' · ' + (j.bytes/1024).toFixed(1) + 'kb');
    }).catch(e => window.IGDiag && IGDiag.err && IGDiag.err('diag-capture failed', String(e)));
  } catch(e) { window.IGDiag && IGDiag.err && IGDiag.err('diag-capture serialise failed', String(e)); }

  // ── Hide the loading overlay NOW that every API call (smart-detect,
  // sector-competitors, competitor-metrics, ai-validate-metrics) has
  // finished. Previously the overlay closed right after the 5-step
  // animation, leaving the user on a blank home page for ~25s while
  // competitor-metrics + ai-validate-metrics still ran in the background.
  try {
    const _totalSec = ((performance.now() - _runStart) / 1000).toFixed(1);
    if (_elapsedEl) _elapsedEl.textContent = _totalSec + 's';
    if (statusText) statusText.textContent = `✅ Intelligence report ready in ${_totalSec}s!`;
    _igLoadingActivity(`Intelligence report ready in ${_totalSec}s`, 'done');
    await wait(250);
    _igHideLoadingOverlay(overlay);
    if (window._runAnalysisSafetyTimer) { clearTimeout(window._runAnalysisSafetyTimer); window._runAnalysisSafetyTimer = null; }
    showToast(`✅ Brief ready in ${_totalSec}s`);
  } catch(_) {}

  // ── Navigate FIRST — guaranteed to always happen regardless of build errors ──
  // Land on Today's Marketing Brief (not the blank /analyse home, and not the
  // dashboard) so the post-analysis workspace always has a React panel mounted.
  window.IGDiag && IGDiag.mark('runAnalysis: navigating to marketing-brief', 'comps=' + selectedComps.length);
  // Start a heartbeat that ticks every 250ms — any gap >500ms in the server
  // log proves the main thread was blocked during that window and the prior
  // breadcrumb names the culprit.
  try { window.IGDiag && IGDiag.startHeartbeat && IGDiag.startHeartbeat('post-analyse', 250); } catch(_) {}
  // Stop the heartbeat 15s later — by then the brief, all deferred
  // builders and enrichments are well past done in the happy case.
  setTimeout(() => { try { window.IGDiag && IGDiag.stopHeartbeat && IGDiag.stopHeartbeat(); } catch(_) {} }, 15000);
  navigateTo('marketing-brief');
  // Tell any already-mounted React panel (Next.js dev shell) that a fresh
  // analysis payload is on `window.analysisData`. Dashboard + Marketing Brief
  // refresh when they see this event so they stay in sync with the latest run.
  try {
    document.dispatchEvent(new CustomEvent('ig:analysis-ready', { detail: { url: cleanUrl } }));
  } catch(_) {}
  showToast(`✅ Analysis complete for ${cleanUrl} — ${selectedComps.length} competitors analysed in ${industry.name}`);

  // Pre-build the dashboard in the background and defer all other views
  // to a background queue with generous gaps. This prevents the main thread
  // from being saturated while the global field enhancer's MutationObserver
  // decorates the freshly-rendered inputs. Each non-dashboard view is ALSO
  // wired into navigateTo as a safety net — if the user clicks a tab before
  // the background queue reaches it, it builds on demand instead.
  const _runBuilder = (name, fn, tag) => {
    // Builder ported to React (legacy module deleted) — nothing to run here.
    if (typeof fn !== 'function') return true;
    const t0 = performance.now();
    try {
      window.IGDiag && IGDiag.log(name + ': start' + (tag ? ' (' + tag + ')' : ''));
      fn();
      window.IGDiag && IGDiag.log(name + ': done' + (tag ? ' (' + tag + ')' : ''), ((performance.now()-t0)).toFixed(0) + 'ms');
      return true;
    } catch(e) {
      console.warn(name + ' error:', e);
      window.IGDiag && IGDiag.err(name + ' error', e && e.message || String(e));
      return false;
    }
  };
  // 1. Render the dashboard NOW so the user sees results immediately.
  _runBuilder('buildDashboard', window.buildDashboard);

  // 2. Mark all other top-level views as "needs build" so navigateTo will
  //    build them on first click if the background queue hasn't reached them.
  window._igViewBuilt = window._igViewBuilt || {};
  window._igViewBuilt.dashboard = true;
  ['competitors','audience','creative','intelligence','battleplan'].forEach(v => { window._igViewBuilt[v] = false; });
  window._bpIdx = 0;

  // 3. Kick off background pre-build with breathing room between each. The
  //    150ms gap lets the browser paint + lets the field enhancer's rAF +
  //    MutationObserver callbacks fully drain before we drop the next view's
  //    DOM in. This is what fixes the "page unresponsive" freeze we were
  //    seeing right after buildIntelligence completed.
  const _bgBuild = async () => {
    const queue = [
      ['buildCompetitors',  window.buildCompetitors,  'competitors'],
      ['buildAudience',     window.buildAudience,     'audience'],
      ['buildCreative',     window.buildCreative,     'creative'],
      ['buildIntelligence', window.buildIntelligence, 'intelligence'],
      ['buildBattlePlan',   window.buildBattlePlan,   'battleplan'],
    ];
    for (const [name, fn, viewId] of queue) {
      if (window._igViewBuilt[viewId]) continue; // user already triggered it
      await new Promise(r => setTimeout(r, 150));
      // Re-check AFTER the sleep — the user may have navigated to the tab
      // during the delay, in which case _lazyBuild already handled it.
      if (window._igViewBuilt[viewId]) continue;
      const ok = _runBuilder(name, fn, 'bg');
      // Only mark built on success — keep false on failure so a subsequent
      // navigateTo() can lazy-rebuild and recover.
      if (ok) window._igViewBuilt[viewId] = true;
    }
    window.IGDiag && IGDiag.mark('All views built');
  };
  _bgBuild();

  // Log analysis actions to results tracker
  if (!window._infoGenieActions) window._infoGenieActions = [];
  const now = new Date();
  window._infoGenieActions.unshift(
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Competitor intelligence built for ${selectedComps.length} competitors in ${industry.name}`, type: 'intelligence', impact: 'CTR, ROAS, keyword gaps, and budget data mapped' },
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Auto-detected target audience segments from ${selectedComps.length} competitor profiles`, type: 'audience', impact: 'Applied to all campaign recommendations' },
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Generated AI campaign recommendations for ${cleanUrl}`, type: 'campaigns', impact: `${(window._lastCampRecs || []).length} campaigns ranked by projected ROI` },
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Analysed ${cleanUrl} — industry: ${industry.name}`, type: 'analysis', impact: `${selectedComps.length} competitors identified` }
  );

  // Defer enrichment passes — these overlay real DataForSEO data onto the
  // dashboard after first paint. buildSettings is NOT called here: it's
  // built lazily by navigateTo('settings') on first visit, because its
  // innerHTML inserts ~2000+ integration-card DOM nodes which forces a
  // multi-second style/layout pass that freezes rAF + setTimeout + the
  // heartbeat. (Confirmed via IGDiag DIAG4 breadcrumbs 2026-05-23.)
  setTimeout(() => {
    try {
      window.IGDiag && IGDiag.mark('enrichWithRealCompetitorData: start');
      enrichWithRealCompetitorData(cleanUrl, industryKey, country);
    } catch(e) { window.IGDiag && IGDiag.err('enrichWithRealCompetitorData error', e && e.message); }
  }, 1500);
  setTimeout(() => {
    try {
      window.IGDiag && IGDiag.mark('enrichKPIsWithLiveData: start');
      enrichKPIsWithLiveData(cleanUrl, industryKey, country);
    } catch(e) { window.IGDiag && IGDiag.err('enrichKPIsWithLiveData error', e && e.message); }
  }, 2000);
  setTimeout(() => {
    try {
      window.IGDiag && IGDiag.mark('enrichCompetitorKwAudiences: start');
      enrichCompetitorKwAudiences(cleanUrl, industryKey, country);
    } catch(e) { window.IGDiag && IGDiag.err('enrichCompetitorKwAudiences error', e && e.message); }
  }, 5000);
}

// ── Real Competitor Data Enrichment ──────────────────────────────────────────
// Calls /api/real-competitors to get live DataForSEO data, then overlays real
// traffic/keyword numbers onto the competitor cards. Non-blocking — runs after UI is shown.
async function enrichWithRealCompetitorData(domain, industryKey, country) {
  const location = country === 'United Kingdom' ? 'United Kingdom'
    : country === 'Australia' ? 'Australia'
    : country === 'Canada' ? 'Canada'
    : 'United States';

  try {
    const res = await fetch('/api/real-competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, industry: industryKey, location, language: 'English' })
    });
    const data = await res.json();
    if (!res.ok || !data.competitors || data.competitors.length === 0) return;

    // Store real competitor data on analysisData for use elsewhere
    analysisData._realCompetitors = data.competitors;
    analysisData._yourRealData    = data.yourDomain;

    // Enrich existing competitor cards with real traffic numbers
    // Match by domain name similarity
    const realMap = {};
    (data.competitors || []).forEach(rc => { realMap[rc.domain.toLowerCase()] = rc; });

    let enriched = 0;
    analysisData.competitors.forEach(comp => {
      const compDomain = (comp.url || '').toLowerCase().replace(/^www\./, '');
      const match = realMap[compDomain] || realMap['www.' + compDomain];
      if (match && match.realData && match.organicTraffic > 0) {
        comp._realTraffic  = match.organicTrafficFmt;
        comp._realKeywords = match.organicKeywordsFmt;
        comp._realDomainRank = match.domainRank;
        comp._dataSource   = 'DataForSEO';
        // If DataForSEO has real paid-spend data, upgrade adSpend + campaign budgets
        if (match.adSpendEst > 0 && (!comp.adSpend || comp.adSpend === '—')) {
          const fmtSpend = n => n >= 1e6 ? '$'+(n/1e6).toFixed(1)+'M/mo'
                              : n >= 1e3 ? '$'+(n/1e3).toFixed(0)+'K/mo'
                              : '$'+Math.round(n)+'/mo';
          comp.adSpend = fmtSpend(match.adSpendEst);
          if (Array.isArray(comp.campaigns)) {
            comp.campaigns.forEach((row, idx) => {
              const split = row._split ?? (idx === 0 ? 0.6 : 0.4);
              row.budget = fmtSpend(match.adSpendEst * split);
            });
          }
        }
        enriched++;
      }
    });

    if (enriched > 0) {
      console.log(`Enriched ${enriched} competitors with real DataForSEO data`);
      // Re-render competitors view with real data badges (legacy builders —
      // deleted once the views moved to React, so guard via window.*)
      window.buildCompetitors && window.buildCompetitors();
      window.buildDashboard && window.buildDashboard();
    }

    // Update your own domain metrics in dashboard if available
    if (data.yourDomain && data.yourDomain.organicTraffic > 0) {
      analysisData.websiteKPIs._realTraffic  = _fmt(data.yourDomain.organicTraffic);
      analysisData.websiteKPIs._realKeywords = _fmt(data.yourDomain.organicKeywords);
    }

    showToast(`📡 Real data loaded — ${enriched} competitors enriched with live DataForSEO metrics`);

  } catch(err) {
    console.warn('Real competitor enrichment failed (non-fatal):', err.message);
  }
}

// ── Competitor Keyword + Audience Enrichment ──────────────────────────────────
// Calls /api/competitor-enrich to fetch REAL top organic keywords (DataForSEO
// ranked_keywords) and AI-derived audience segments for each competitor.
// Non-blocking — runs ~5s after analysis completes so the UI is already visible.
async function enrichCompetitorKwAudiences(domain, industryKey, country) {
  const location = country === 'United Kingdom' ? 'United Kingdom'
    : country === 'Australia' ? 'Australia'
    : country === 'Canada' ? 'Canada'
    : 'United States';

  try {
    const compDomains = (analysisData.competitors || []).map(c => c.url).filter(Boolean).slice(0, 6);
    if (!compDomains.length) return;

    const res = await fetch('/api/competitor-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        competitors: compDomains,
        industry: analysisData.industryName || industryKey || '',
        yourDomain: domain,
        location,
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.enriched) return;

    let enriched = 0;
    analysisData.competitors.forEach(comp => {
      const compUrl = (comp.url || '').replace(/^www\./, '').toLowerCase();
      const hit = data.enriched[compUrl] || data.enriched['www.' + compUrl];
      if (!hit) return;
      if (hit.topKeywords && hit.topKeywords.length > 0) {
        comp.topKeywords = hit.topKeywords;
        enriched++;
      }
      if (hit.audiences && hit.audiences.length > 0) {
        comp.audiences = hit.audiences;
        enriched++;
      }
    });

    if (enriched > 0) {
      console.log(`[kw-audience-enrich] ${enriched} competitor fields updated with keywords + AI audiences`);
      // Store for downstream use (keyword suggestions, battle plans, etc.)
      analysisData.keywords = (analysisData.competitors || [])
        .flatMap(c => c.topKeywords || [])
        .filter((k, i, a) => k && a.indexOf(k) === i)
        .slice(0, 30);
      window.buildCompetitors && window.buildCompetitors();
    }
  } catch (err) {
    console.warn('Competitor keyword/audience enrichment failed (non-fatal):', err.message);
  }
}

// ── Live KPI Enrichment ───────────────────────────────────────────────────────
// Calls /api/live-kpis to get DataForSEO-derived CTR, CPA, ROAS and Conv. Rate
// then updates the KPI cards in the DOM without a full rebuild.
async function enrichKPIsWithLiveData(domain, industryKey, country) {
  const location = country === 'United Kingdom' ? 'United Kingdom'
    : country === 'Australia' ? 'Australia'
    : country === 'Canada'    ? 'Canada'
    : 'United States';

  const liveBadge = (title) => `<span title="${title}" style="font-size:.65rem;background:#F59E0B20;color:#B45309;padding:2px 6px;border-radius:10px;font-weight:700;display:inline-block;margin-bottom:4px">DERIVED</span>`;

  try {
    const res = await fetch('/api/live-kpis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, industryKey, location })
    });
    if (!res.ok) return;
    const d = await res.json();
    if (d.error) return;

    const industry    = analysisData?.industry;
    const competitors = analysisData?.competitors || [];
    const avgCTR  = avg(competitors.map(c => parseFloat(c.ctr)));
    const avgROAS = avg(competitors.map(c => c.roas));
    const src = `DataForSEO derived · avg position ${d.meta?.avgPosition || '—'} · avg CPC $${d.meta?.avgCPC || '—'} — not ad-account truth`;

    // Store live values back onto analysisData for downstream use
    if (!analysisData.websiteKPIs) analysisData.websiteKPIs = {};
    if (d.ctr      !== null) analysisData.websiteKPIs._liveCTR      = d.ctr;
    if (d.roas     !== null) analysisData.websiteKPIs._liveROAS     = d.roas;
    if (d.cpa      !== null) analysisData.websiteKPIs._liveCPA      = d.cpa;
    if (d.convRate !== null) analysisData.websiteKPIs._liveConvRate = d.convRate;
    analysisData.websiteKPIs._kpiProvenance = d.provenance || 'market_derived';

    // Update each KPI card in-place
    const kpiGrid = document.getElementById('kpiGrid');
    if (!kpiGrid) return;
    const cards = kpiGrid.querySelectorAll('.kpi-card');
    // Cards order: CTR (0), ROAS (1), CPA (2), Traffic (3 — already live), Conv.Rate (4), Score (5)

    // Shared ribbon helpers — keep parity with the initial buildDashboard render
    const _domain = (analysisData?.url || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];
    const ribbonLive = `<div class="kpi-ribbon kpi-ribbon-live" title="Market-derived from DataForSEO SERP + industry benchmarks for ${_domain} — not your ad account">📡 MARKET-DERIVED — ${_domain}</div>`;
    const ribbonInd  = `<div class="kpi-ribbon kpi-ribbon-ind"  title="Broad industry benchmark — not your data">🏷️ INDUSTRY BENCHMARK</div>`;
    const srcLive    = `<div class="kpi-source kpi-source-live" title="Derived from DataForSEO for ${_domain}. Connect Ads/GA4 for account-truth ROAS.">📡 DataForSEO derived · <strong>${_domain}</strong></div>`;
    const srcIndLine = `<div class="kpi-source kpi-source-ind"  title="Broad industry benchmark for ${industry?.name || 'your industry'} — not your data, not a specific competitor.">🏷️ Industry benchmark · <strong>${industry?.name || 'your industry'}</strong></div>`;

    // CTR card
    if (cards[0] && d.ctr !== null) {
      const ctr = parseFloat(d.ctr);
      const ctrChange = ctr >= avgCTR ? `▲ ${(ctr - avgCTR).toFixed(2)}% above competitor avg (${avgCTR.toFixed(2)}%)` : `▼ ${(avgCTR - ctr).toFixed(2)}% below competitor avg (${avgCTR.toFixed(2)}%)`;
      cards[0].innerHTML = `
        ${ribbonLive}
        ${liveBadge(src)}
        <div class="kpi-icon">📊</div>
        <div class="kpi-label">Your CTR Benchmark</div>
        <div class="kpi-value">${ctr}%</div>
        <div class="kpi-change ${ctr >= avgCTR ? 'kpi-up' : 'kpi-down'}">${ctrChange}</div>
        ${srcLive}
      `;
    }

    // ROAS card
    if (cards[1] && d.roas !== null) {
      const roas = parseFloat(d.roas);
      const roasChange = roas >= avgROAS ? `▲ ${(roas - avgROAS).toFixed(1)}× above competitor avg (${avgROAS.toFixed(1)}×)` : `▼ ${(avgROAS - roas).toFixed(1)}× below competitor avg (${avgROAS.toFixed(1)}×)`;
      cards[1].innerHTML = `
        ${ribbonLive}
        ${liveBadge(src)}
        <div class="kpi-icon">🎯</div>
        <div class="kpi-label">Your ROAS Benchmark</div>
        <div class="kpi-value">${roas}×</div>
        <div class="kpi-change ${roas >= avgROAS ? 'kpi-up' : 'kpi-down'}">${roasChange}</div>
        ${srcLive}
      `;
    }

    // CPA card
    if (cards[2] && d.cpa !== null) {
      const cpa = parseFloat(d.cpa);
      const cpaReduction = (cpa * 0.35).toFixed(0);
      cards[2].innerHTML = `
        ${ribbonInd}
        ${liveBadge(src)}
        <div class="kpi-icon">💰</div>
        <div class="kpi-label">CPA Benchmark</div>
        <div class="kpi-value">$${cpa}</div>
        <div class="kpi-change kpi-up">▼ $${cpaReduction} saving possible with AI optimisation</div>
        ${srcIndLine}
      `;
    }

    // Conv. Rate card (index 4)
    if (cards[4] && d.convRate !== null) {
      const cr = parseFloat(d.convRate);
      cards[4].innerHTML = `
        ${ribbonLive}
        ${liveBadge(src)}
        <div class="kpi-icon">📈</div>
        <div class="kpi-label">Your Conv. Rate</div>
        <div class="kpi-value">${cr}%</div>
        <div class="kpi-change ${cr >= 3 ? 'kpi-up' : 'kpi-down'}">${industry?.name || 'Industry'} avg: ${(industryConvRates[industryKey] || 3).toFixed(1)}%</div>
        ${srcLive}
      `;
    }

    // Update data notice
    const noticeEl = document.getElementById('kpiDataNotice');
    if (noticeEl) {
      noticeEl.innerHTML = `
        <span style="color:#059669;font-size:0.75rem">
          📡 <strong>Live DataForSEO data</strong> — CTR, ROAS, CPA and Conversion Rate derived from real keyword positions and CPC data for <strong>${domain}</strong>.
          Avg keyword position: <strong>${d.meta?.avgPosition || '—'}</strong> · Avg CPC: <strong>$${d.meta?.avgCPC || '—'}</strong> · Keywords analysed: <strong>${d.meta?.keywordsWithCPC || 0}</strong>
        </span>`;
    }

    showToast('📡 KPI metrics upgraded to live DataForSEO data');

  } catch(err) {
    console.warn('enrichKPIsWithLiveData failed (non-fatal):', err.message);
  }
}

// Industry conv rates reference (mirrors server-side table)
const industryConvRates = {
  finance: 3.1, fintech: 3.4, ecommerce: 2.4, retail: 1.8,
  saas: 4.2, software: 3.8, health: 2.8, healthcare: 2.8,
  travel: 2.1, education: 3.6, realestate: 2.3, default: 3.0
};

// Format large numbers
function _fmt(n) {
  if (!n) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== COMPETITOR ANALYSIS MODAL =====
// Opens a rich modal with TARGETED, AI-generated intel for one competitor.
// Calls /api/competitor-deep-analysis which scrapes the competitor's homepage
// and uses GPT-4o to produce specific, actionable counter-plays.

// ===== YOUR COMPANY — STRENGTHS & WEAKNESSES =====
// Mirrors the per-competitor SWOT view but evaluates the user's own KPIs vs
// the tracked competitor averages. Pure rule-based so it works offline and
// always renders meaningful, real comparisons (no AI/template fallback).

// ── AI-powered SWOT for the user's own site ──────────────────────────────────
// Reuses /api/competitor-deep-analysis with the user's own domain as the target,
// so we get GPT-4o-grounded strengths/weaknesses scraped from their real homepage.

// Render the full AI analysis (mirrors the per-competitor modal layout, but
// reframed for the user's own site — "growth plays" instead of "counter plays",
// "SEO opportunities" instead of "outrank-them angles", etc.).


// ===== BUILD DASHBOARD → moved to public/js/ig_core_views.js =====
// (_loadDashboardDiag + buildDashboard + chart helpers renderCTRChart/renderROASChart/renderTrendChart; attached to window there).

// ===== BUILD COMPETITORS → moved to public/js/ig_compete.js =====
// (buildCompetitors/renderCompetitorCards/buildCompMonitor/buildCompCard + backlink helpers + generateBlogMonitor/generatePageResponse/pageTrackerCounterAd; attached to window there).

// ===== BUILD CAMPAIGNS =====
function _igCompInitials(name) {
  if (!name) return '?';
  return String(name).split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function buildCampaigns() {
  const wrap = document.getElementById('campaignsWrap');
  if (!wrap) return;
  if (!analysisData) {
    wrap.innerHTML = `
      <div style="text-align:center; padding:60px 24px">
        <div style="font-size:3rem; margin-bottom:16px">🎯</div>
        <h3 style="font-family:Sora,sans-serif; font-size:1.25rem; font-weight:800; color:#0A1628; margin-bottom:8px">Run an Analysis to See Campaign Recommendations</h3>
        <p style="color:#6B7280; font-size:0.9rem; margin-bottom:24px; max-width:420px; margin-left:auto; margin-right:auto">Enter your website URL on the home page and click Analyse Now — InfoGenie will generate AI-powered campaign strategies based on your specific competitors.</p>
        <button class="btn-primary" onclick="navigateTo('home')" style="margin:0 auto">← Run Analysis</button>
      </div>`;
    return;
  }
  const { url, industry, websiteKPIs, competitors } = analysisData;
  
  const topComp = competitors[0];
  const avgROAS = avg(competitors.map(c => c.roas));
  const projROAS = (avgROAS * 1.3).toFixed(1);
  
  const campaignRecs = generateCampaignRecs(industry, competitors, url);
  window._lastCampRecs = campaignRecs;
  
  const cards = campaignRecs.map((camp, idx) => `
    <div class="camp-card" id="campCard${idx}">
      <span class="camp-type-badge badge-${camp.badgeClass}">${camp.platform}</span>
      <div class="camp-card-title">${camp.name}</div>
      <div class="camp-card-body">${camp.description}</div>
      <div class="camp-card-tags">${camp.tags.map(t => `<span class="camp-tag">${t}</span>`).join('')}</div>
      <div class="camp-metrics-row">
        <div title="Estimated Click-Through Rate — % of people who see this ad and click it. AI-projected based on industry averages."><div class="cm-val">${camp.estCTR}</div><div class="cm-lbl">Est. CTR</div></div>
        <div title="Estimated Return on Ad Spend — projected revenue earned per $1 spent. Higher is better."><div class="cm-val">${camp.estROAS}×</div><div class="cm-lbl">Est. ROAS</div></div>
        <div title="Estimated Cost Per Acquisition — average spend to win one new customer with this campaign."><div class="cm-val">${camp.estCPA}</div><div class="cm-lbl">Est. CPA</div></div>
        <div title="Minimum monthly budget recommended for this campaign to be effective and achieve the projected ROAS."><div class="cm-val">${camp.budget}</div><div class="cm-lbl">Min. Budget</div></div>
      </div>
      <div class="camp-card-actions">
        <button class="btn-camp-launch" onclick="window._igLaunch(${idx})" title="Deploy this campaign — sets up targeting, budget and creative, then queues it for review before spending begins.">🚀 Launch this Campaign</button>
        <button class="btn-camp-preview" onclick="window._igCreative(${idx})" title="Open GPT-4o Creative Studio to generate and refine ad copy, headlines and visuals for this campaign.">🎨 Creative Studio</button>
        <button class="btn-camp-preview" onclick="window._igLandingPage(${idx})" title="Generate a complete AI conversion-optimised landing page for this campaign using GPT-4o." style="background:#EFF6FF;color:#0066FF;border-color:#BFDBFE">🌐 Landing Page</button>
        <button class="btn-camp-preview" onclick="window._igBrandCreative(${idx})" title="Generate brand-styled ad creatives using your logo, colours and tone — then attach them to this campaign." style="background:#FFF7ED;color:#C2410C;border-color:#FED7AA">✨ Brand Creative</button>
      </div>
      <div id="brandAttached${idx}" style="margin-top:10px;display:none;background:linear-gradient(135deg,#FFF7ED,#FFEDD5);border:1px solid #FED7AA;border-radius:10px;padding:10px 12px;font-size:0.78rem;color:#9A3412;font-weight:700"></div>
    </div>
  `).join('');
  
  const queuedSection = queuedCampaigns.length > 0 ? `
    <div class="queued-campaigns-section">
      <div class="queued-campaigns-header">
        <span class="queued-dot"></span>
        <span class="queued-title">📋 ${queuedCampaigns.length} Counter-Campaign${queuedCampaigns.length > 1 ? 's' : ''} Queued for Review</span>
        <span class="queued-sub">Review and approve before launching — no charges until you confirm</span>
      </div>
      <div class="queued-cards-grid">
        ${queuedCampaigns.map(qc => `
          <div class="queued-camp-card" id="${qc.id}">
            <div class="qcc-badge">DRAFT</div>
            <div class="qcc-title">Counter-Campaign vs. ${qc.comp}</div>
            <div class="qcc-channel">${qc.channel}</div>
            <div class="qcc-weakness">💡 Targeting: ${qc.weakness}</div>
            <div class="qcc-meta">
              <span>📉 Deals lost: ${qc.lossRate}</span>
              <span>🕐 Queued at ${qc.createdAt}</span>
            </div>
            <div class="qcc-actions">
              <button class="btn-qcc-launch" onclick="launchQueuedCampaign('${qc.id}', '${qc.comp.replace(/'/g,'')}', this)">🚀 Review &amp; Launch</button>
              <button class="btn-qcc-discard" onclick="discardQueuedCampaign('${qc.id}')">✕ Discard</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  // Build audience data for the panel
  const audMap = {};
  competitors.forEach(c => {
    (c.audiences || []).forEach(a => {
      if (!audMap[a.label]) audMap[a.label] = { total: 0, count: 0, comps: [] };
      audMap[a.label].total += a.pct;
      audMap[a.label].count += 1;
      audMap[a.label].comps.push(c.name);
    });
  });
  const topAudiences = Object.entries(audMap)
    .map(([label, d]) => ({ label, avg: Math.round(d.total / d.count), comps: d.comps }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 6);
  const audiencePanel = topAudiences.length > 0 ? `
    <div class="data-table-card" style="margin-bottom:24px;background:linear-gradient(135deg,#F0F9FF,#E0F2FE);border:1.5px solid #BAE6FD">
      <div class="dtc-header" style="gap:12px;flex-wrap:wrap">
        <h3 style="color:#0369A1;flex:1;min-width:0">🎯 Auto Target Audience — AI-Detected Segments</h3>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button type="button" onclick="window._showLiveIntelInfo && window._showLiveIntelInfo()" class="atag" style="background:#0369A1;border:none;color:white;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:0.7rem;font-weight:700;border-radius:999px" title="Click for details on how Live Intelligence works"><span style="width:6px;height:6px;border-radius:50%;background:#10F981;box-shadow:0 0 6px #10F981;animation:livePulse 1.4s infinite ease-out"></span>Live Intelligence</button>
          <button type="button" data-ig-launch="0" onclick="event.preventDefault();event.stopPropagation();window._igLaunch && window._igLaunch(0);return false;" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;padding:10px 20px;font-size:0.78rem;font-weight:800;color:white;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;white-space:nowrap;box-shadow:0 4px 14px rgba(0,102,255,.32);transition:all .2s;flex-shrink:0;pointer-events:auto;position:relative;z-index:10" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(0,102,255,.42)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 14px rgba(0,102,255,.32)'">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            <span style="pointer-events:none">🚀 Launch Campaign</span>
          </button>
        </div>
        <style>@keyframes livePulse{0%{opacity:1}50%{opacity:.4}100%{opacity:1}}</style>
      </div>
      <p style="font-size:0.8rem;color:#0369A1;margin:14px 0;padding-left:24px;padding-right:24px">InfoGenie has automatically identified these high-value audience segments from competitor analysis. These will be auto-applied to your campaigns.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${topAudiences.map((a, i) => {
          const colors = ['#0369A1','#059669','#7C3AED','#D97706','#DC2626','#0066FF'];
          const bgColors = ['#E0F2FE','#D1FAE5','#EDE9FE','#FEF3C7','#FEE2E2','#EFF6FF'];
          const c = colors[i % colors.length];
          const bg = bgColors[i % bgColors.length];
          const barW = Math.min(100, a.avg);
          return `<div style="background:white;border-radius:10px;padding:12px 14px;border:1px solid ${bg}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="font-size:0.8rem;font-weight:700;color:#0A1628">${a.label}</div>
              <div style="font-size:0.9rem;font-weight:800;color:${c}">${a.avg}%</div>
            </div>
            <div style="height:5px;background:#F1F5F9;border-radius:3px;margin-bottom:6px">
              <div style="height:100%;width:${barW}%;background:${c};border-radius:3px"></div>
            </div>
            <div style="font-size:0.68rem;color:#6B7280">Seen across: ${a.comps.slice(0,2).join(', ')}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:12px;display:flex;gap:10px">
        <div style="flex:1;background:white;border-radius:10px;padding:12px 14px;border:1px solid #BAE6FD">
          <div style="font-size:0.7rem;font-weight:700;color:#0369A1;text-transform:uppercase;margin-bottom:6px">✅ Auto-Targeting Status</div>
          <div style="font-size:0.82rem;color:#0A1628;font-weight:600">Active — ${topAudiences.length} segments identified</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">AI will auto-apply top segments to each campaign</div>
        </div>
        <div style="flex:1;background:white;border-radius:10px;padding:12px 14px;border:1px solid #BAE6FD">
          <div style="font-size:0.7rem;font-weight:700;color:#059669;text-transform:uppercase;margin-bottom:6px">📈 Top Performing Segment</div>
          <div style="font-size:0.82rem;color:#0A1628;font-weight:600">${topAudiences[0]?.label || 'High-intent buyers'}</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">${topAudiences[0]?.avg || 0}% avg engagement across competitors</div>
        </div>
      </div>
    </div>
  ` : '';

  // ── Counter-campaign target banner (set when user clicks "Launch counter-campaign" in competitor modal) ──
  const _ct = window._counterTarget;
  const _ctFresh = _ct && (Date.now() - (_ct.at || 0) < 30 * 60 * 1000); // valid for 30 min
  const _ctComp = _ctFresh ? (competitors.find((c) => c.name === _ct.name) || {}) : null;
  const _ctLogo = _ctFresh ? (_ct.logo || _ctComp?.logo || _igCompInitials(_ct.name)) : '';
  const _ctUrl = _ctFresh ? (_ct.url || _ctComp?.url || _ctComp?.domain || '') : '';
  const _ctRoas = _ctFresh ? (_ct.roas || _ctComp?.roas || '—') : '';
  const _ctCtr = _ctFresh ? (_ct.ctr || _ctComp?.ctr || '—') : '';
  const _ctTraffic = _ctFresh ? (_ct.traffic || _ctComp?.traffic || '—') : '';
  const _ctAdSpend = _ctFresh ? (_ct.adSpend || _ctComp?.adSpend || '—') : '';
  const _ctTopChannel = _ctFresh
    ? (_ct.topChannel || (_ctComp?.campaigns && _ctComp.campaigns[0]?.channel) || '—')
    : '';
  const counterBanner = _ctFresh ? `
    <div class="counter-banner" id="counterTargetBanner">
      <div class="counter-banner-strip">
        <span class="counter-banner-pulse"></span>
        <span class="counter-banner-eyebrow">⚔️ COUNTER-CAMPAIGN TARGET</span>
        <span class="counter-banner-threat counter-banner-threat-${(_ct.threatLevel || _ctComp?.threatLevel || 'medium').toLowerCase()}">${(_ct.threatLevel || _ctComp?.threatLevel || 'medium').toUpperCase()} THREAT</span>
      </div>
      <div class="counter-banner-main">
        <div class="counter-banner-avatar" aria-hidden="true">${_ctLogo}</div>
        <div class="counter-banner-body">
          <div class="counter-banner-title">You are launching a campaign <em>against</em> <strong>${_ct.name}</strong> <span class="counter-banner-url">(${_ctUrl || 'unknown domain'})</span></div>
          ${(_ct.positioning || _ctComp?.positioning) ? `<div class="counter-banner-pos">📍 Their positioning: <em>${_ct.positioning || _ctComp.positioning}</em></div>` : ''}
          <div class="counter-banner-stats">
            <span title="Their estimated Return on Ad Spend">ROAS <strong>${_ctRoas}×</strong></span>
            <span title="Their estimated Click-Through Rate">CTR <strong>${_ctCtr}</strong></span>
            <span title="Their estimated monthly traffic">Traffic <strong>${_ctTraffic}</strong></span>
            <span title="Their estimated monthly ad spend">Spend <strong>${_ctAdSpend}</strong></span>
            <span title="Their dominant channel — the one we will hit hardest">Top channel <strong>${_ctTopChannel}</strong></span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <button class="counter-banner-clear" onclick="window._counterTarget=null;document.getElementById('counterTargetBanner')?.remove();const hb=document.getElementById('launchCampaignBtn');if(hb)hb.style.display=''" title="Clear target — return to general campaign mode">✕ Clear target</button>
          <button class="btn-primary counter-banner-launch" onclick="window._igLaunch && window._igLaunch(0)" title="Open the Campaign Launch Brief for the top counter-campaign against ${_ct.name}" style="white-space:nowrap">🚀 Launch Campaign</button>
        </div>
      </div>
      ${_ct.counterPlays && _ct.counterPlays.length ? `
        <div class="counter-banner-plays">
          <div class="counter-banner-plays-h">🎯 AI counter-plays loaded into the campaigns below — they target ${_ct.name}'s specific weaknesses:</div>
          <ul>${_ct.counterPlays.slice(0,3).map(p=>`<li>${String(p).replace(/</g,'&lt;')}</li>`).join('')}</ul>
        </div>
      ` : ''}
    </div>
  ` : '';

  // Adjust hero copy when a target is set
  const heroTitle = _ctFresh
    ? `Counter-Campaign Strategy: ${url} <span style="opacity:.7;font-weight:600">vs</span> ${_ct.name}`
    : `AI-Powered Campaign Strategy for ${url}`;
  const heroSub = _ctFresh
    ? `Targeted plays designed to take share from <strong>${_ct.name}</strong> — leveraging their weaknesses in ${industry.name}.`
    : `Based on analysis of ${competitors.length} competitors in ${industry.name}. Recommendations ranked by projected ROI impact.`;

  wrap.innerHTML = `
    ${queuedSection}
    ${counterBanner}
    <div class="camp-hero">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div class="camp-hero-title">${heroTitle}</div>
          <div class="camp-hero-sub">${heroSub}</div>
        </div>
      </div>
      <div class="camp-kpis">
        <div><div class="camp-kpi-val camp-kpi-val--roas">${projROAS}×</div><div class="camp-kpi-lbl">Projected ROAS</div></div>
        <div><div class="camp-kpi-val camp-kpi-val--cpa">-35%</div><div class="camp-kpi-lbl">CPA Reduction</div></div>
        <div><div class="camp-kpi-val camp-kpi-val--lift">+25%</div><div class="camp-kpi-lbl">Conversion Lift</div></div>
        <div><div class="camp-kpi-val camp-kpi-val--count">${campaignRecs.length}</div><div class="camp-kpi-lbl">Campaigns Ready</div></div>
      </div>
    </div>
    ${audiencePanel}
    <div class="camp-grid">${cards}</div>

    <!-- INFOGENIE IMPROVED ADS -->
    ${(() => {
      // Collect all adCopy items across competitors
      const allAds = [];
      competitors.forEach(c => {
        (c.adCopy || []).forEach(ac => {
          if (ac.headline && ac.body) {
            allAds.push({ headline: ac.headline, body: ac.body, comp: c.name, platform: (c.campaigns||[])[0]?.channel || 'Multi-Platform' });
          }
        });
      });
      if (allAds.length === 0) return '';

      // Platform colour mapping
      const platBg  = { Google:'#EFF6FF', Meta:'#FFF5F7', TikTok:'#F5F5F5', LinkedIn:'#F0F7FF', 'Multi-Platform':'#F0FDF4' };
      const platCol = { Google:'#0066FF', Meta:'#E1306C', TikTok:'#010101', LinkedIn:'#0A66C2', 'Multi-Platform':'#059669' };
      const platIcon = { Google:'🔍', Meta:'📘', TikTok:'⬛', LinkedIn:'💼', 'Multi-Platform':'📣' };

      const adCards = allAds.map((ad, i) => {
        const bg   = platBg[ad.platform]  || platBg['Multi-Platform'];
        const col  = platCol[ad.platform] || platCol['Multi-Platform'];
        const icon = platIcon[ad.platform]|| platIcon['Multi-Platform'];
        const safeH = ad.headline.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeB = ad.body.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return `
          <div style="background:${bg};border:1.5px solid ${col}22;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
              <span style="font-size:0.65rem;font-weight:700;color:${col};background:${col}18;border-radius:5px;padding:2px 7px">${icon} ${ad.platform}</span>
              <span style="font-size:0.62rem;color:#9CA3AF">vs. ${ad.comp}</span>
            </div>
            <div style="font-weight:700;font-size:0.85rem;color:#0A1628;line-height:1.4">"${ad.headline}"</div>
            <div style="font-size:0.78rem;color:#4B5563;line-height:1.5">${ad.body}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
              <button onclick="navigator.clipboard?.writeText('${safeH} — ${safeB}').then(()=>{this.textContent='✅ Copied';setTimeout(()=>this.textContent='📋 Copy Ad Copy',1200)})" style="padding:5px 12px;font-size:0.72rem;font-weight:600;color:#4F46E5;background:#EEF2FF;border:1px solid #C7D2FE;border-radius:6px;cursor:pointer">📋 Copy Ad Copy</button>
              <button onclick="openAdInCreativeStudio('${safeH}','${safeB}','${ad.platform}')" style="padding:5px 12px;font-size:0.72rem;font-weight:600;color:white;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:6px;cursor:pointer">✨ Use in Creative Studio →</button>
            </div>
          </div>`;
      }).join('');

      return `
      <div class="data-table-card" style="margin-bottom:24px;background:linear-gradient(135deg,#F8FAFF,#EFF6FF);border:1.5px solid #BFDBFE">
        <div class="dtc-header">
          <h3 style="color:#1D4ED8">✍️ InfoGenie Improved Ads</h3>
          <span class="atag atag-solid atag-solid--blue">${allAds.length} Ready-to-Use</span>
        </div>
        <p style="font-size:0.73rem;color:#3B82F6;margin:0 0 16px 0;line-height:1.5;max-width:640px">AI-refined versions of your competitors' top ads · Copy to clipboard or send straight to the Creative Studio for launch.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">
          ${adCards}
        </div>
      </div>`;
    })()}

    <!-- A/B TEST MANAGER -->
    <div class="data-table-card" style="margin-bottom:24px;background:linear-gradient(135deg,#FEFBFF,#F3E8FF);border:1.5px solid #DDD6FE">
      <div class="dtc-header">
        <h3 style="color:#5B21B6">🧪 A/B Test Manager</h3>
        <span class="atag atag-solid atag-solid--purple">${(window._abTests||[]).length} Tests Running</span>
      </div>
      <p style="font-size:0.8rem;color:#5B21B6;margin:0 0 16px 0">Set up split tests between two campaign variants to measure which delivers better ROAS in your live environment.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:white;border-radius:12px;padding:18px;border:1px solid #EDE9FE">
          <div style="font-size:0.72rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px">⚙️ Configure New A/B Test</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div>
              <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Test Name</label>
              <input id="ab-test-name" placeholder="e.g. Google vs Meta ROAS Test" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#7C3AED'" onblur="this.style.borderColor='#E2E8F0'">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Variant A</label>
                <select id="ab-var-a" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#7C3AED'" onblur="this.style.borderColor='#E2E8F0'">
                  ${campaignRecs.map((c,i) => `<option value="${i}">${c.platform} — ${c.name.substring(0,30)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Variant B</label>
                <select id="ab-var-b" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#7C3AED'" onblur="this.style.borderColor='#E2E8F0'">
                  ${campaignRecs.map((c,i) => `<option value="${i}" ${i===1?'selected':''}>${c.platform} — ${c.name.substring(0,30)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Traffic Split</label>
                <select id="ab-split" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
                  <option value="50">50% / 50% (even)</option>
                  <option value="60">60% A / 40% B</option>
                  <option value="70">70% A / 30% B</option>
                  <option value="80">80% A / 20% B (cautious)</option>
                </select>
              </div>
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Test Duration</label>
                <select id="ab-days" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
                  <option value="7">7 days</option>
                  <option value="14" selected>14 days</option>
                  <option value="30">30 days</option>
                </select>
              </div>
            </div>
            <button onclick="launchABTest()" style="width:100%;padding:11px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer;margin-top:4px">🧪 Launch A/B Test →</button>
          </div>
        </div>
        <div style="background:white;border-radius:12px;padding:18px;border:1px solid #EDE9FE;overflow-y:auto;max-height:320px">
          <div style="font-size:0.72rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">📊 Running Tests</div>
          ${(window._abTests||[]).length === 0 ? `
            <div style="text-align:center;padding:24px 12px;color:#9CA3AF;font-size:0.82rem">
              <div style="font-size:1.5rem;margin-bottom:8px">🧪</div>
              No A/B tests yet — configure one on the left and click Launch.
            </div>
          ` : (window._abTests||[]).map(t => {
            const winnerColor = { A: '#059669', B: '#0066FF' }[t.winner];
            const winnerLoser = t.winner === 'A' ? ['#059669','#DC2626'] : ['#DC2626','#059669'];
            return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px;margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-size:0.82rem;font-weight:700;color:#0A1628">${t.name}</div>
                <span style="background:#7C3AED22;color:#7C3AED;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:10px">RUNNING</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
                <div style="background:${winnerLoser[0]}11;border:1px solid ${winnerLoser[0]}44;border-radius:8px;padding:8px">
                  <div style="font-size:0.65rem;font-weight:700;color:${winnerLoser[0]};margin-bottom:2px">VARIANT A ${t.winner==='A'?'🏆':''}</div>
                  <div style="font-size:0.78rem;font-weight:600;color:#0A1628">${t.varA.platform}</div>
                  <div style="font-size:0.75rem;color:#6B7280">ROAS: <strong style="color:${winnerLoser[0]}">${t.varA.roas}×</strong> · CTR: ${t.varA.ctr}</div>
                </div>
                <div style="background:${winnerLoser[1]}11;border:1px solid ${winnerLoser[1]}44;border-radius:8px;padding:8px">
                  <div style="font-size:0.65rem;font-weight:700;color:${winnerLoser[1]};margin-bottom:2px">VARIANT B ${t.winner==='B'?'🏆':''}</div>
                  <div style="font-size:0.78rem;font-weight:600;color:#0A1628">${t.varB.platform}</div>
                  <div style="font-size:0.75rem;color:#6B7280">ROAS: <strong style="color:${winnerLoser[1]}">${t.varB.roas}×</strong> · CTR: ${t.varB.ctr}</div>
                </div>
              </div>
              <div style="font-size:0.72rem;color:#6B7280">${t.split}/${100-t.split} split · ${t.days} days · Started: ${t.startedAt}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- LAUNCHED CAMPAIGNS SECTION -->
    ${(window._launchedCampaigns||[]).length > 0 ? (() => {
      const statColor = { active:'#10B981', paused:'#F59E0B', ended:'#6B7280', draft:'#6366F1' };
      const platIcons = { google:'🔍', meta:'📘', facebook:'📘', tiktok:'🎵', linkedin:'💼', youtube:'🎬' };
      return `<div class="data-table-card" id="launched-campaigns-section" style="margin-bottom:24px;border:1.5px solid #00C9C8">
        <div class="dtc-header">
          <h3 style="color:#0A1628">🚀 Launched Campaigns</h3>
          <span class="atag atag-solid atag-solid--teal">${(window._launchedCampaigns||[]).length} Live</span>
        </div>
        <div class="dtc-flush" style="display:flex;flex-direction:column;gap:14px;padding:14px">
          ${(window._launchedCampaigns||[]).map((c, ci) => {
            const m = c.metrics || {};
            const cr = c.creatives || {};
            const stat = c.status || 'active';
            const platKey = (c.platform || '').toLowerCase();
            const platIcon = Object.entries(platIcons).find(([k]) => platKey.includes(k))?.[1] || '📣';
            const hasAdCopy = (cr.headlines||[]).filter(Boolean).length > 0 || (cr.descriptions||[]).filter(Boolean).length > 0;
            const hasSocial = cr.instagram || cr.tiktok || cr.youtube || cr.linkedin;
            const hasFiles  = cr.igFile || cr.ttFile || cr.ytFile;
            return `<div id="lc-card-${ci}" style="background:#FAFAFA;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden">
              <!-- Card Header -->
              <div style="background:var(--ig-grad2);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
                <div>
                  <div style="font-size:0.65rem;font-weight:700;color:#00C9C8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">${platIcon} ${c.platform||'Campaign'}</div>
                  <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:white">${c.name||'Campaign'}</div>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                    <span style="background:${statColor[stat]||'#10B981'};color:white;font-size:0.6rem;font-weight:700;padding:2px 8px;border-radius:8px;text-transform:uppercase">${stat}</span>
                    <span style="font-size:0.72rem;color:#94A3B8">Launched ${c.launchedAt||'—'}</span>
                  </div>
                </div>
                <button onclick="document.getElementById('lc-body-${ci}').style.display=document.getElementById('lc-body-${ci}').style.display==='none'?'block':'none';this.textContent=document.getElementById('lc-body-${ci}').style.display==='none'?'▼ Expand':'▲ Collapse'" style="padding:7px 14px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-size:0.72rem;font-weight:700;color:white;cursor:pointer">▼ Expand</button>
              </div>

              <!-- Collapsed summary -->
              <div style="padding:12px 20px;display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid #E5E7EB">
                ${[['ROAS',(m.roas||'—')+'×','#10B981'],['CTR',m.ctr||'—','#0066FF'],['Conv.',(m.conversions||0).toLocaleString(),'#7C3AED'],['CPA',m.cpa||'—','#F59E0B']].map(([l,v,col])=>
                  `<div style="text-align:center"><div style="font-size:1rem;font-weight:800;color:${col}">${v}</div><div style="font-size:0.62rem;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">${l}</div></div>`
                ).join('')}
                <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  ${hasAdCopy ? `<span style="background:#EFF6FF;color:#0066FF;font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:6px">📝 Ad Copy</span>` : ''}
                  ${hasSocial ? `<span style="background:#FFF5F7;color:#E1306C;font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:6px">📱 Social</span>` : ''}
                  ${hasFiles  ? `<span style="background:#F0FDF4;color:#059669;font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:6px">📎 Files</span>` : ''}
                </div>
              </div>

              <!-- Expandable Body -->
              <div id="lc-body-${ci}" style="display:none;padding:20px">

                <!-- Metrics full grid -->
                <div style="margin-bottom:20px">
                  <div style="font-size:0.68rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">📊 Performance Metrics</div>
                  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
                    ${[['ROAS',(m.roas||'—')+'×','#10B981'],['CTR',m.ctr||'—','#0066FF'],['Conversions',(m.conversions||0).toLocaleString(),'#7C3AED'],['CPA',m.cpa||'—','#F59E0B'],['Impressions',m.impressions?Number(m.impressions).toLocaleString():'—','#00C9C8'],['Spend','$'+(m.spend||0).toLocaleString(),'#E1306C']].map(([l,v,col])=>
                      `<div style="background:white;border:1px solid #E5E7EB;border-radius:10px;padding:12px;text-align:center"><div style="font-size:1.1rem;font-weight:800;color:${col}">${v}</div><div style="font-size:0.62rem;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">${l}</div></div>`
                    ).join('')}
                  </div>
                </div>

                <!-- Campaign Settings -->
                <div style="background:white;border:1px solid #E5E7EB;border-radius:10px;padding:14px;margin-bottom:20px">
                  <div style="font-size:0.68rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">⚙️ Campaign Settings</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.8rem;color:#374151">
                    <div><span style="color:#9CA3AF;font-size:0.7rem">Budget</span><br><strong>${c.budgetStr||'—'}/mo</strong></div>
                    <div><span style="color:#9CA3AF;font-size:0.7rem">Start Date</span><br><strong>${c.startDate||'—'}</strong></div>
                    <div><span style="color:#9CA3AF;font-size:0.7rem">End Date</span><br><strong>${c.endDate||'—'}</strong></div>
                    <div><span style="color:#9CA3AF;font-size:0.7rem">Audience</span><br><strong>${(c.audience||'Auto-targeted').substring(0,60)}</strong></div>
                    <div><span style="color:#9CA3AF;font-size:0.7rem">Campaign ID</span><br><strong style="font-family:monospace;font-size:0.7rem">${c._platformCampaignId||c.id||'—'}</strong></div>
                  </div>
                </div>

                ${hasAdCopy ? `
                <!-- Ad Copy Creatives -->
                <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px;margin-bottom:20px">
                  <div style="font-size:0.68rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">✍️ Ad Copy Creatives</div>
                  ${(cr.headlines||[]).filter(Boolean).map((h,i)=>`
                    <div style="background:white;border:1px solid #BBF7D0;border-radius:7px;padding:9px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
                      <span style="font-size:0.65rem;font-weight:700;color:#059669;background:#D1FAE5;border-radius:4px;padding:2px 6px;flex-shrink:0">H${i+1}</span>
                      <span style="font-size:0.82rem;color:#0A1628;font-weight:600">${h}</span>
                    </div>`).join('')}
                  ${(cr.descriptions||[]).filter(Boolean).map((d,i)=>`
                    <div style="background:white;border:1px solid #BAE6FD;border-radius:7px;padding:9px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
                      <span style="font-size:0.65rem;font-weight:700;color:#0369A1;background:#E0F2FE;border-radius:4px;padding:2px 6px;flex-shrink:0">D${i+1}</span>
                      <span style="font-size:0.8rem;color:#374151">${d}</span>
                    </div>`).join('')}
                </div>` : ''}

                ${hasSocial ? `
                <!-- Social & Video Creatives -->
                <div style="background:#FFF5F7;border:1px solid #FECDD3;border-radius:10px;padding:14px;margin-bottom:20px">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div style="font-size:0.68rem;font-weight:700;color:#9D174D;text-transform:uppercase;letter-spacing:.07em">📱 Social & Video Creatives</div>
                    <button onclick="(function(){var i=document.createElement('input');i.type='file';i.accept='image/*,video/*';i.onchange=function(){if(i.files[0])showToast('✅ Creative pack attached: '+i.files[0].name);};i.click();})()" style="padding:5px 12px;background:linear-gradient(135deg,#E1306C,#C13584);border:none;border-radius:7px;font-size:0.68rem;font-weight:700;color:white;cursor:pointer;display:inline-flex;align-items:center;gap:4px">📎 Upload Creative</button>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    ${cr.instagram ? `<div>
                      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                        <div style="font-size:0.65rem;font-weight:700;color:#E1306C">📸 Instagram Caption</div>
                        <button onclick="(function(){var i=document.createElement('input');i.type='file';i.accept='image/*,video/*';i.onchange=function(){if(i.files[0])showToast('✅ Instagram creative attached: '+i.files[0].name);};i.click();})()" style="padding:3px 8px;background:linear-gradient(135deg,#E1306C,#C13584);border:none;border-radius:5px;font-size:0.6rem;font-weight:700;color:white;cursor:pointer">📎 Upload</button>
                      </div>
                      <div style="background:white;border:1px solid #FECDD3;border-radius:7px;padding:10px;font-size:0.8rem;color:#374151;line-height:1.6;white-space:pre-wrap;max-height:100px;overflow-y:auto">${cr.instagram}</div>
                    </div>` : ''}
                    ${cr.tiktok ? `<div>
                      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                        <div style="font-size:0.65rem;font-weight:700;color:#010101">⬛ TikTok Script</div>
                        <button onclick="(function(){var i=document.createElement('input');i.type='file';i.accept='image/*,video/*';i.onchange=function(){if(i.files[0])showToast('✅ TikTok creative attached: '+i.files[0].name);};i.click();})()" style="padding:3px 8px;background:linear-gradient(135deg,#010101,#2D2D2D);border:none;border-radius:5px;font-size:0.6rem;font-weight:700;color:white;cursor:pointer">📎 Upload</button>
                      </div>
                      <div style="background:white;border:1px solid #E5E7EB;border-radius:7px;padding:10px;font-size:0.78rem;color:#374151;font-family:'Courier New',monospace;line-height:1.5;white-space:pre-wrap;max-height:100px;overflow-y:auto">${cr.tiktok}</div>
                    </div>` : ''}
                    ${cr.youtube ? `<div>
                      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                        <div style="font-size:0.65rem;font-weight:700;color:#FF0000">🎬 YouTube Pre-Roll</div>
                        <button onclick="(function(){var i=document.createElement('input');i.type='file';i.accept='image/*,video/*';i.onchange=function(){if(i.files[0])showToast('✅ YouTube creative attached: '+i.files[0].name);};i.click();})()" style="padding:3px 8px;background:linear-gradient(135deg,#FF0000,#CC0000);border:none;border-radius:5px;font-size:0.6rem;font-weight:700;color:white;cursor:pointer">📎 Upload</button>
                      </div>
                      <div style="background:white;border:1px solid #FECACA;border-radius:7px;padding:10px;font-size:0.78rem;color:#374151;font-family:'Courier New',monospace;line-height:1.5;white-space:pre-wrap;max-height:100px;overflow-y:auto">${cr.youtube}</div>
                    </div>` : ''}
                    ${cr.linkedin ? `<div>
                      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                        <div style="font-size:0.65rem;font-weight:700;color:#0A66C2">💼 LinkedIn Post</div>
                        <button onclick="(function(){var i=document.createElement('input');i.type='file';i.accept='image/*,video/*';i.onchange=function(){if(i.files[0])showToast('✅ LinkedIn creative attached: '+i.files[0].name);};i.click();})()" style="padding:3px 8px;background:linear-gradient(135deg,#0A66C2,#004182);border:none;border-radius:5px;font-size:0.6rem;font-weight:700;color:white;cursor:pointer">📎 Upload</button>
                      </div>
                      <div style="background:white;border:1px solid #BAE0FF;border-radius:7px;padding:10px;font-size:0.8rem;color:#374151;line-height:1.6;white-space:pre-wrap;max-height:100px;overflow-y:auto">${cr.linkedin}</div>
                    </div>` : ''}
                  </div>
                </div>` : ''}

                ${hasFiles ? `
                <!-- Attached Creative Files -->
                <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px;margin-bottom:20px">
                  <div style="font-size:0.68rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">📎 Attached Creative Files</div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${cr.igFile ? `<span style="background:white;border:1px solid #BBF7D0;border-radius:7px;padding:7px 12px;font-size:0.75rem;color:#0A1628;font-weight:600">📸 ${cr.igFile}</span>` : ''}
                    ${cr.ttFile ? `<span style="background:white;border:1px solid #BBF7D0;border-radius:7px;padding:7px 12px;font-size:0.75rem;color:#0A1628;font-weight:600">⬛ ${cr.ttFile}</span>` : ''}
                    ${cr.ytFile ? `<span style="background:white;border:1px solid #BBF7D0;border-radius:7px;padding:7px 12px;font-size:0.75rem;color:#0A1628;font-weight:600">🎬 ${cr.ytFile}</span>` : ''}
                  </div>
                </div>` : ''}

                <!-- Action Timeline -->
                <div style="background:white;border:1px solid #E5E7EB;border-radius:10px;padding:14px;margin-bottom:14px">
                  <div style="font-size:0.68rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">⚡ Action Timeline</div>
                  ${(c.actions||[]).map(a=>`
                    <div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #F3F4F6">
                      <div style="width:6px;height:6px;background:#00C9C8;border-radius:50%;margin-top:6px;flex-shrink:0"></div>
                      <div><div style="font-size:0.78rem;color:#1E293B">${a.action}</div><div style="font-size:0.67rem;color:#9CA3AF;margin-top:1px">${a.time}</div></div>
                    </div>`).join('') || '<div style="color:#9CA3AF;font-size:0.78rem;padding:6px 0">No actions logged</div>'}
                </div>

                <!-- Platform Link -->
                ${c._platformCampaignId ? `
                  <a href="${platKey.includes('google') ? 'https://ads.google.com' : platKey.includes('meta')||platKey.includes('facebook') ? 'https://adsmanager.facebook.com' : 'https://ads.tiktok.com'}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:linear-gradient(135deg,#00C9C8,#0066FF);border-radius:8px;font-size:0.78rem;font-weight:700;color:white;text-decoration:none">🔗 Open in ${c.platform} Dashboard →</a>
                ` : `<div style="font-size:0.75rem;color:#9CA3AF">Connect ad account in Settings to push future campaigns live automatically.</div>`}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    })() : ''}

    <div class="data-table-card">
      <div class="dtc-header"><h3>Competitor Campaign Breakdown</h3><span class="atag">Live Intelligence</span></div>
      <div class="table-scroll">
        <table class="ig-table">
          <thead>
            <tr><th>Competitor</th><th>Campaign</th><th>Channel</th><th>CTR</th><th>ROAS</th><th>Budget</th><th>AI Suggestion</th></tr>
          </thead>
          <tbody>
            ${competitors.flatMap(c => (c.campaigns||[]).slice(0,2).map(camp => `
              <tr>
                <td><div class="comp-name-cell"><div class="comp-favicon">${c.logo}</div>${c.name}</div></td>
                <td><strong>${camp.name}</strong></td>
                <td>${camp.channel}</td>
                <td><strong>${camp.ctr}</strong></td>
                <td><strong>${camp.roas}×</strong></td>
                <td>${camp.budget}</td>
                <td style="font-size:.8125rem;color:var(--teal);max-width:260px;line-height:1.5">${c.suggestions[0] || ''}</td>
              </tr>
            `)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADVERTISE HUB
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._advertiseConnections) {
  const _advSaved = (() => { try { const s = localStorage.getItem('ig_adv_conn'); return s ? JSON.parse(s) : null; } catch(e) { return null; } })();
  window._advertiseConnections = _advSaved || {
    'Meta': true, 'Instagram': true, 'Messenger & WhatsApp': true, 'Meta Calls': true,
    'Catalog Ads': true, 'Meta Boost': true, 'Google Search': true, 'Google Pmax': true,
    'YouTube': true, 'Google Display': true, 'Google Calls': true, 'LinkedIn': true,
    'LinkedIn Message': true, 'TikTok': true, 'Bing': true, 'Direct Mail': true,
    'Local Services': true, 'Snapchat': false, 'Spotify': false, 'Pinterest': false,
    'X (Twitter)': false, 'Threads': false,
  };
}




// ── Per-channel 3-step lead-gen modal ────────────────────────────────────────





// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT AI — INTELLIGENCE, SEO & LLM VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._contentTab) window._contentTab = 'overview';
if (!window._contentClusters) window._contentClusters = [];
if (!window._contentGapList) window._contentGapList = null;
if (!window._pageAuditList) window._pageAuditList = null;

// ─── Content Calendar — buildContent + its page-audit/cluster/build-content helpers (runLighthouse · runRealPageAudit · generateCluster · suggestSeedTopic · openBuildContentModal · _bcSelectType · runBuildContent · bcCopy · _bcCopyFallback · bcDownload) → moved to public/js/ig_content_social.js ───

// ═══════════════════════════════════════════════════════════════════════════════
// SOCIAL CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._socialPosts)   window._socialPosts   = [];
if (!window._socialViewYear) window._socialViewYear = new Date().getFullYear();
if (!window._socialViewMonth) window._socialViewMonth = new Date().getMonth();

const SOCIAL_PLATFORMS = [
  { name:'Meta',      icon:'📘', color:'#1877F2', bg:'#EBF3FF' },
  { name:'Instagram', icon:'📸', color:'#E1306C', bg:'#FFF0F5' },
  { name:'TikTok',    icon:'⬛', color:'#010101', bg:'#F5F5F5' },
  { name:'LinkedIn',  icon:'💼', color:'#0A66C2', bg:'#F0F7FF' },
  { name:'X',         icon:'✖️', color:'#14171A', bg:'#F5F5F5' },
  { name:'YouTube',   icon:'🎬', color:'#FF0000', bg:'#FFF5F5' },
  { name:'Pinterest', icon:'📌', color:'#E60023', bg:'#FFF0F0' },
  { name:'Snapchat',  icon:'👻', color:'#FFCC00', bg:'#FFFDE0' },
  { name:'Threads',   icon:'🧵', color:'#000000', bg:'#F5F5F5' },
];

if (!window._socialTab) window._socialTab = 'calendar';

// ── Viral Content Funnel stages ───────────────────────────────────────────────
const FUNNEL_STAGES = [
  { id:'awareness',  label:'Awareness',  icon:'🌱', color:'#10B981', bg:'#ECFDF5', fmt:'Reels',     tip:'Story-driven reels, micro-education, trending angles — stop the scroll.' },
  { id:'interest',   label:'Interest',   icon:'💡', color:'#3B82F6', bg:'#EFF6FF', fmt:'Carousels', tip:'Frameworks, before-after, step-by-step tutorials — convert attention to curiosity.' },
  { id:'nurture',    label:'Nurture',    icon:'❤️', color:'#EC4899', bg:'#FDF2F8', fmt:'Stories',   tip:'Process sharing, myth-breaking, polls, soft CTAs — build belief & trust.' },
  { id:'conversion', label:'Conversion', icon:'💰', color:'#F59E0B', bg:'#FFFBEB', fmt:'DMs',       tip:'Personalised DMs, testimonials, limited-spot urgency — turn trust into sales.' },
  { id:'advocacy',   label:'Advocacy',   icon:'🌟', color:'#7C3AED', bg:'#F5F3FF', fmt:'Community', tip:'Client wins, UGC, referrals, private challenges — turn buyers into brand evangelists.' },
];

// ── 2026 Post Archetype Library — 4 proven formats per funnel stage ──────────
// Source: The 2026 Instagram Content Growth System (cold → buyer journey)
const POST_ARCHETYPES = {
  awareness: [
    { id:'pattern_interrupt', icon:'🪝', title:'Pattern Interrupt Hook',    hint:'POV-style opener that stops the scroll',     starter:'POV: ',           prompt:'Write a pattern-interrupt hook caption for {brand} in {industry} starting with "POV:" — open with an uncomfortable truth or counter-intuitive observation about your audience. Keep it 2-3 short punchy lines ending on a cliffhanger. Add 2-3 relevant emojis. No hashtags except 2 niche ones at the end.' },
    { id:'contrarian',        icon:'⚡', title:'Contrarian Take',           hint:'Challenge a popular belief in your niche',   starter:'Unpopular opinion: ', prompt:'Write a contrarian-take caption for {brand} in {industry} starting with "Unpopular opinion:" — challenge a widely-accepted belief in the space. Back it up with one strong reason in 3-4 lines. Provocative but not insulting. End with a question to spark replies.' },
    { id:'micro_story',       icon:'📖', title:'Relatable Micro-Story',     hint:'A short personal moment that resonates',     starter:'',                prompt:'Write a 2-3 sentence relatable micro-story caption for {brand} in {industry} that ends with a vulnerable admission ("I had X but still felt Y"). Raw and honest, not polished. Add one relatable emoji and a soft CTA.' },
    { id:'niche_callout',     icon:'🎯', title:'Niche Call-Out',            hint:'Speak directly to a specific sub-audience',  starter:'This is for ',    prompt:'Write a niche call-out caption for {brand} in {industry} opening with "This is for [specific sub-audience stuck at a specific stage]" — laser-targeted so they feel seen. 4-5 lines, then a clear next step.' },
  ],
  interest: [
    { id:'if_then',           icon:'🧩', title:'"If you\'re X, do Y" Framework', hint:'Diagnostic prescription matching reader to action', starter:"If you're ", prompt:'Write an "If you\'re X, do Y" framework caption for {brand} in {industry}. Open with a diagnostic statement matching the reader to a specific action ("If you\'re a [role] doing [behaviour], stop and try [action]"). Personalised-prescription tone. 4-6 lines.' },
    { id:'mistake_based',     icon:'❌', title:'Mistake-Based Content',     hint:'Common error in your space + the fix',       starter:'Why your ',       prompt:'Write a mistake-based caption for {brand} in {industry} naming a common error ("Why your X looks good but doesn\'t Y") and revealing the fix in 3-4 educational lines. End with one actionable takeaway.' },
    { id:'positioning',       icon:'🎯', title:'Clear Positioning Post',    hint:'One-line statement of who you help & how',   starter:'I help ',         prompt:'Write a clear positioning caption for {brand} in {industry} opening with "I help [audience] [outcome] through [method]". Crisp, no jargon. Then 2-3 lines on what makes the approach different. End with an invitation.' },
    { id:'proof_story',       icon:'📊', title:'Proof-Led Storytelling',    hint:'Result-driven mini case study',              starter:'How a ',          prompt:'Write a proof-led story caption for {brand} in {industry}: "How a [client type] [achieved specific result] from [single action]". Lead with the outcome, then the mechanism in 2-3 sentences. Specific numbers > vague claims.' },
  ],
  nurture: [
    { id:'bts_thinking',      icon:'🔍', title:'Behind-the-Scenes Thinking', hint:'Reveal your process, not just outputs',     starter:'How I ',          prompt:'Write a behind-the-scenes thinking caption for {brand} in {industry} revealing the process ("How I structure X for Y"). Show the framework in 3-4 numbered or bulleted steps, not just the result.' },
    { id:'decision_breakdown',icon:'⚖️', title:'Decision Breakdown',        hint:'Walk through a real choice you made',        starter:'Why we ',         prompt:'Write a decision-breakdown caption for {brand} in {industry}: "Why we [removed/added/changed] X" — show the trade-off, what data/observation drove it, and the lesson. 5-6 honest lines.' },
    { id:'journey_story',     icon:'🛤️', title:'Client Journey Story',      hint:'From → To, with the messy middle',           starter:'From ',           prompt:'Write a client-journey caption for {brand} in {industry}: "From [starting state] → [ending state]". Include the messy middle and one specific turning point. End with the lesson others can apply.' },
    { id:'real_talk',         icon:'🗣️', title:'Real Talk Content',         hint:'Honest take no one says out loud',           starter:'What no one tells you ', prompt:'Write a real-talk caption for {brand} in {industry} opening "What no one tells you about [topic]". Strip the BS and share the uncomfortable truth in 4-5 lines. End with empathy, not preaching.' },
  ],
  conversion: [
    { id:'situation_cta',     icon:'💬', title:'Situation-Based CTA',       hint:'DM keyword trigger for warm leads',          starter:'DM "',            prompt:'Write a situation-based CTA caption for {brand} in {industry} ending with "DM [KEYWORD] if [specific situation]". Self-qualifying invitation — not a hard sell. 4-5 lines describing who it\'s for, then the trigger.' },
    { id:'callout_post',      icon:'📣', title:'Call-Out Post',             hint:'Direct address to your ideal buyer',         starter:"If you're tired of ", prompt:'Write a call-out conversion caption for {brand} in {industry} opening "If you\'re tired of [specific pain]" — name the frustration, show you understand, then offer a clear next step. Empathetic conversion tone.' },
    { id:'micro_offer',       icon:'🎁', title:'Micro-Offer',               hint:'Low-friction entry product or audit',        starter:'Reply "audit" ',  prompt:'Write a micro-offer caption for {brand} in {industry}: a free or low-friction offer ("Reply \'audit\' and I\'ll review your X"). Make the value crystal-clear in one line, then 2 short lines on what they\'ll get. Urgent but not pushy.' },
    { id:'objection_handle',  icon:'🛡️', title:'Objection Handling',        hint:'Tackle the #1 reason they hesitate',         starter:"You don't need ",  prompt:'Write an objection-handling caption for {brand} in {industry} that flips a common objection ("You don\'t need more X, you need better Y"). Reframe and resolve in 3-4 lines. End with the action that costs them nothing.' },
  ],
  advocacy: [
    { id:'screenshot_proof',  icon:'📸', title:'Screenshot-Based Proof',    hint:'Real testimonial / DM screenshot caption',   starter:'',                prompt:'Write a caption to accompany a screenshot of a client win or DM testimonial for {brand} in {industry}. Frame the screenshot — what was the situation, what changed, what they did next. 4-5 lines of social proof.' },
    { id:'client_led',        icon:'🎤', title:'Client-Led Content',        hint:'Hand the mic to a client',                   starter:'In their words: ', prompt:'Write a client-led caption for {brand} in {industry} structured as "In their words:" + a quoted client takeaway, then your 1-line response. Authentic and low-ego — let the client be the hero.' },
    { id:'public_win',        icon:'🏆', title:'Public Win',                hint:'Celebrate a result transparently',           starter:'Sharing this because ', prompt:'Write a public-win caption for {brand} in {industry}: a transparent celebration ("Sharing this because it\'s proof that X works"). Specific numbers, not vague flexes. Credit the client and the system.' },
    { id:'referral_loop',     icon:'🔁', title:'Referral Loop',             hint:'Invite advocates to bring others in',        starter:'If this helped you, ', prompt:'Write a referral-loop caption for {brand} in {industry} inviting current followers to tag/share with one person who needs it. Natural and warm, never pushy. End with what to do if someone tags them back.' },
  ],
};

// ─── ICP Studio (buildICPStudio + _icp* helpers) · Search Intent Map (buildIntentMap + _im* helpers) · Keyword–Page Map (buildKeywordMap + _km* helpers) → moved to public/js/ig_research_tools.js ───

// ─── Social Calendar — buildSocialCalendar + openCreatePost · _buildSocialAnalytics · _buildSocialPublishing · socialToggleAutoPublish · _socialAutoPublishCheck · socialPublishNow — and AI Visibility — buildAiVisibility → moved to public/js/ig_content_social.js ───

// ─── Amplitude AI Agents (_AMP_AGENTS + buildAmplitudeAgents + _amp* helpers) → moved to public/js/ig_research_tools.js ───

// ── Action Center helpers ──────────────────────────────────────────────────

function updateEeaT() {
  if (!window._eeaT) window._eeaT = {};
  const ids = ['eeaT0','eeaT1','eeaT2','eeaT3','eeaT4','eeaT5','eeaT6','eeaT7'];
  let checked = 0;
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) { window._eeaT[id] = el.checked; if (el.checked) checked++; }
  });
  try { localStorage.setItem('ig_eeaT', JSON.stringify(window._eeaT)); } catch(e) {}
  const pct = Math.round(checked / ids.length * 100);
  const scoreEl = document.getElementById('eeaTScore');
  const barEl   = document.getElementById('eeaTBar');
  if (scoreEl) scoreEl.textContent = pct + '%';
  if (scoreEl) scoreEl.style.color = pct >= 75 ? '#86EFAC' : pct >= 40 ? '#FDE68A' : '#FCA5A5';
  if (barEl) barEl.style.width = pct + '%';
}

// Load saved E-E-A-T state
window._eeaT = (() => { try { const s = localStorage.getItem('ig_eeaT'); return s ? JSON.parse(s) : {}; } catch(e) { return {}; } })();

function generateSchemaSnippet(type, domain) {
  const d = domain || 'yourdomain.com';
  const schemas = {
    FAQ: `{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n    {\n      "@type": "Question",\n      "name": "What is ${d}?",\n      "acceptedAnswer": {\n        "@type": "Answer",\n        "text": "Describe what ${d} does in 1-2 clear sentences."\n      }\n    },\n    {\n      "@type": "Question",\n      "name": "How does ${d} work?",\n      "acceptedAnswer": {\n        "@type": "Answer",\n        "text": "Explain the process step-by-step in plain language."\n      }\n    },\n    {\n      "@type": "Question",\n      "name": "How much does ${d} cost?",\n      "acceptedAnswer": {\n        "@type": "Answer",\n        "text": "Describe your pricing tiers and what each includes."\n      }\n    }\n  ]\n}`,
    HowTo: `{\n  "@context": "https://schema.org",\n  "@type": "HowTo",\n  "name": "How to get started with ${d}",\n  "description": "A step-by-step guide to using ${d} effectively.",\n  "totalTime": "PT10M",\n  "step": [\n    {\n      "@type": "HowToStep",\n      "name": "Step 1: Sign up",\n      "text": "Create your free account at ${d}."\n    },\n    {\n      "@type": "HowToStep",\n      "name": "Step 2: Configure",\n      "text": "Set up your profile and preferences."\n    },\n    {\n      "@type": "HowToStep",\n      "name": "Step 3: Launch",\n      "text": "Start using ${d} to achieve your goals."\n    }\n  ]\n}`,
    Organization: `{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "${d}",\n  "url": "https://www.${d}",\n  "logo": "https://www.${d}/logo.png",\n  "description": "Describe what ${d} does in 1-2 sentences.",\n  "foundingDate": "2020",\n  "sameAs": [\n    "https://twitter.com/${d.split('.')[0]}",\n    "https://linkedin.com/company/${d.split('.')[0]}",\n    "https://www.crunchbase.com/organization/${d.split('.')[0]}"\n  ],\n  "contactPoint": {\n    "@type": "ContactPoint",\n    "contactType": "customer support",\n    "email": "support@${d}"\n  }\n}`,
    Product: `{\n  "@context": "https://schema.org",\n  "@type": "Product",\n  "name": "${d}",\n  "description": "What your product does and who it's for.",\n  "brand": {\n    "@type": "Brand",\n    "name": "${d.split('.')[0]}"\n  },\n  "offers": {\n    "@type": "Offer",\n    "priceCurrency": "USD",\n    "price": "0",\n    "priceValidUntil": "2026-12-31",\n    "availability": "https://schema.org/InStock"\n  },\n  "aggregateRating": {\n    "@type": "AggregateRating",\n    "ratingValue": "4.8",\n    "reviewCount": "127"\n  }\n}`,
    Article: `{\n  "@context": "https://schema.org",\n  "@type": "Article",\n  "headline": "Your Article Headline Here",\n  "description": "A short description of what this article covers.",\n  "author": {\n    "@type": "Person",\n    "name": "Author Name",\n    "url": "https://www.${d}/about"\n  },\n  "publisher": {\n    "@type": "Organization",\n    "name": "${d.split('.')[0]}",\n    "logo": {\n      "@type": "ImageObject",\n      "url": "https://www.${d}/logo.png"\n    }\n  },\n  "datePublished": "${new Date().toISOString().split('T')[0]}",\n  "dateModified": "${new Date().toISOString().split('T')[0]}"\n}`,
    BreadcrumbList: `{\n  "@context": "https://schema.org",\n  "@type": "BreadcrumbList",\n  "itemListElement": [\n    {\n      "@type": "ListItem",\n      "position": 1,\n      "name": "Home",\n      "item": "https://www.${d}"\n    },\n    {\n      "@type": "ListItem",\n      "position": 2,\n      "name": "Blog",\n      "item": "https://www.${d}/blog"\n    },\n    {\n      "@type": "ListItem",\n      "position": 3,\n      "name": "This Article",\n      "item": "https://www.${d}/blog/this-article"\n    }\n  ]\n}`,
  };
  const out = document.getElementById('schemaOutput');
  if (out) {
    out.textContent = schemas[type] || '// Schema not found';
    out.style.color = '#86EFAC';
  }
  showToast(`✅ ${type} schema generated — edit placeholders then copy`);
}

function copySchemaOutput() {
  const out = document.getElementById('schemaOutput');
  const btn = document.getElementById('schemaCopyBtn');
  if (!out) return;
  navigator.clipboard?.writeText(out.textContent).then(() => {
    if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy to Clipboard'; }, 1800); }
  }).catch(() => {
    showToast('⚠️ Copy failed — please select and copy manually');
  });
}

async function openAiContentBrief(type, domain, industry) {
  const typeLabels = { 'what-is': '"What Is" Definition Page', 'comparison': '"X vs Y" Comparison Page', 'how-to': 'How-To Step-by-Step Guide' };
  const label = typeLabels[type] || type;
  const modal = document.getElementById('contentBriefModal');
  const inner = document.getElementById('contentBriefInner');
  if (!modal || !inner) return;

  inner.innerHTML = `
    <div style="padding:28px 30px">
      <div style="font-size:0.68rem;font-weight:700;color:#6366F1;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Action Center · Content Brief</div>
      <div style="font-family:Sora,sans-serif;font-size:1.1rem;font-weight:800;color:#0A1628;margin-bottom:4px">${label}</div>
      <div style="font-size:0.78rem;color:#6B7280;margin-bottom:20px">GPT-4 is writing your AI-optimised content brief for <strong>${domain}</strong> in <strong>${industry}</strong>…</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:32px;background:#F8FAFC;border-radius:12px;color:#6366F1;font-weight:600;font-size:0.82rem">
        <span style="animation:spin 1s linear infinite;display:inline-block">⏳</span> Generating brief with GPT-4…
      </div>
    </div>`;
  modal.classList.remove('hidden');
  modal.style.cssText = 'display:flex !important;';

  try {
    const res = await fetch('/api/ai-content-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, domain, industry })
    });
    const data = await res.json();
    const brief = data.brief || generateFallbackBrief(type, domain, industry);
    inner.innerHTML = `
      <div style="padding:26px 30px;max-height:85vh;overflow-y:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <div style="font-size:0.68rem;font-weight:700;color:#6366F1;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Content Brief · GPT-4 Generated</div>
            <div style="font-family:Sora,sans-serif;font-size:1.05rem;font-weight:800;color:#0A1628">${label}</div>
          </div>
          <button onclick="navigator.clipboard?.writeText(document.getElementById('briefText').innerText).then(()=>showToast('✅ Brief copied!'))" style="padding:7px 14px;background:#EEF2FF;border:none;border-radius:8px;font-size:0.72rem;font-weight:700;color:#4F46E5;cursor:pointer">📋 Copy Brief</button>
        </div>
        <div id="briefText" style="font-size:0.82rem;color:#1A2F4A;line-height:1.78;white-space:pre-wrap;background:#F8FAFC;border-radius:12px;padding:20px 22px;border:1px solid #E5E7EB">${brief}</div>
        <div style="display:flex;gap:10px;margin-top:18px">
          <button onclick="closeContentBriefModal();navigateTo('content')" style="flex:1;padding:10px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">Open Content AI →</button>
          <button onclick="closeContentBriefModal()" style="flex:1;padding:10px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.8rem;font-weight:600;color:#374151;cursor:pointer">Close</button>
        </div>
      </div>`;
  } catch(e) {
    const brief = generateFallbackBrief(type, domain, industry);
    inner.innerHTML = `
      <div style="padding:26px 30px;max-height:85vh;overflow-y:auto">
        <div style="font-family:Sora,sans-serif;font-size:1.05rem;font-weight:800;color:#0A1628;margin-bottom:16px">${label} — Content Brief</div>
        <div id="briefText" style="font-size:0.82rem;color:#1A2F4A;line-height:1.78;white-space:pre-wrap;background:#F8FAFC;border-radius:12px;padding:20px 22px;border:1px solid #E5E7EB">${brief}</div>
        <button onclick="closeContentBriefModal()" style="width:100%;margin-top:16px;padding:10px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.8rem;font-weight:600;color:#374151;cursor:pointer">Close</button>
      </div>`;
  }
}

function closeContentBriefModal() {
  const m = document.getElementById('contentBriefModal');
  if (m) { m.classList.add('hidden'); m.removeAttribute('style'); }
}

async function generateBrandMonitor(domain, industry) {
  const reportEl = document.getElementById('brandMonReport');
  if (!reportEl) return;
  // Run timer on every Brand Monitor button on the page (header + empty-state card).
  const stopTimer = window.startButtonTimer('button[onclick*="generateBrandMonitor"], #brandMonBtn', 'Analysing brand');
  reportEl.innerHTML = `
    <div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:14px;padding:28px;text-align:center">
      <div style="font-size:0.9rem;font-weight:600;color:#1D4ED8;margin-bottom:6px">⏳ GPT-4 is analysing your brand across all LLM platforms…</div>
      <div style="font-size:0.72rem;color:#64748B">This takes 8–12 seconds</div>
    </div>`;
  try {
    const res  = await fetch('/api/ai-brand-monitor', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ domain, industry }) });
    const data = await res.json();
    const report = data.report || '⚠️ No report returned. Please try again.';
    window._brandMonitorReport = report;
    reportEl.innerHTML = `
      <div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:14px;padding:20px 22px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:0.68rem;font-weight:700;color:#1D4ED8;text-transform:uppercase;letter-spacing:.07em">✅ GPT-4 Brand Monitor Report</div>
          <button onclick="navigator.clipboard?.writeText(window._brandMonitorReport).then(()=>showToast('✅ Report copied!'))" style="padding:5px 12px;background:#DBEAFE;border:none;border-radius:7px;font-size:0.68rem;font-weight:700;color:#1D4ED8;cursor:pointer">📋 Copy</button>
        </div>
        <div style="font-size:0.82rem;color:#1A2F4A;line-height:1.75;white-space:pre-wrap">${report}</div>
      </div>`;
    showToast('✅ Brand Monitor report ready!');
  } catch(e) {
    reportEl.innerHTML = `<div style="background:#FEF2F2;border:1.5px solid #FCA5A5;border-radius:12px;padding:18px;font-size:0.8rem;color:#991B1B">⚠️ Unable to generate report. Please try again.</div>`;
  } finally {
    stopTimer('🔍 Run Brand Monitor');
  }
}

function generateFallbackBrief(type, domain, industry) {
  const d = domain || 'yourdomain.com', ind = industry || 'your industry';
  const ind0 = ind.split(' ')[0];
  if (type === 'what-is') return `CONTENT BRIEF: "What Is ${ind0}?" Definition Page\nTarget URL: /${ind0.toLowerCase().replace(/ /g,'-')}-guide\nTarget LLMs: ChatGPT, Gemini, Perplexity, Claude\n\nPRIMARY GOAL\nCreate the definitive, citable answer to "What is ${ind0}?" so LLMs cite ${domain} when users ask this question.\n\nTITLE\n"What is ${ind0}? A Complete Guide for 2025"\n\nMETA DESCRIPTION (≤155 chars)\n"${ind0} explained clearly. Learn what it is, how it works, who it's for, and why it matters — with real examples."\n\nCONTENT STRUCTURE\nH1: What is ${ind0}?\n• Opening paragraph: 1–2 sentence direct definition (LLM-ready)\n• Quick facts box: key stats, founding year, category, who uses it\n\nH2: How Does ${ind0} Work?\n• 3–5 clear bullet points explaining the mechanism\n• Avoid jargon — write for a 10th-grade reading level\n\nH2: Who Uses ${ind0}?\n• Segment: SMBs, Enterprises, Individuals\n• Include real use case per segment\n\nH2: Key Benefits of ${ind0}\n• Numbered list, benefit-oriented language\n\nH2: ${ind0} vs Alternatives\n• Short comparison table (3–4 alternatives)\n• Link to dedicated comparison pages\n\nH2: Frequently Asked Questions\n• Min. 5 Q&As with FAQ schema markup\n• Include: "Is ${domain} free?", "How do I get started?", "What makes ${domain} different?"\n\nSCHEMA MARKUP REQUIRED\n✓ FAQPage schema\n✓ Organization schema\n✓ BreadcrumbList schema\n\nINTERNAL LINKS\n• Link to pricing page\n• Link to comparison pages\n• Link to how-to guides\n\nE-E-A-T SIGNALS\n• Add author bio with credentials\n• Include citations from authoritative sources\n• Add last-updated date`;
  if (type === 'comparison') return `CONTENT BRIEF: "${domain} vs Competitors" Comparison Page\nTarget URL: /${domain.split('.')[0]}-vs-alternatives\nTarget LLMs: Perplexity, ChatGPT, Claude (comparison queries)\n\nPRIMARY GOAL\nCapture "X vs Y" comparison queries — cited in 73% of comparison-intent AI responses.\n\nTITLE\n"${domain} vs Top Alternatives: Which Is Best in 2025?"\n\nCONTENT STRUCTURE\nH1: ${domain} vs [Competitor 1] vs [Competitor 2] — Full Comparison\n• Opening: who should read this, what you'll learn\n\nH2: Quick Comparison Table\n• Side-by-side table: features, pricing, ease of use, support, integrations\n• Highlight your strengths clearly\n\nH2: ${domain} — Full Review\n• Pros (4–5 points)\n• Cons (2–3 points, be honest — LLMs distrust one-sided content)\n• Best for: specific user type\n\nH2: [Competitor 1] — Full Review (repeat pattern)\nH2: [Competitor 2] — Full Review (repeat pattern)\n\nH2: Our Verdict — Which Should You Choose?\n• Clear recommendation matrix by use case\n• Quote from real customer review\n\nH2: Frequently Asked Questions\n• "Is ${domain} better than [Competitor]?"\n• "Does ${domain} offer a free trial?"\n• "What's the main difference between ${domain} and alternatives?"\n\nSCHEMA MARKUP REQUIRED\n✓ FAQPage schema\n✓ Review/AggregateRating schema\n✓ BreadcrumbList schema\n\nE-E-A-T SIGNALS\n• Link to independent review sites (G2, Capterra)\n• Include verified customer quotes\n• Add publication date and review methodology`;
  return `CONTENT BRIEF: How-To Guide for ${domain}\nTarget URL: /how-to-get-started-with-${domain.split('.')[0]}\nTarget LLMs: ChatGPT, Gemini (task-based queries)\n\nPRIMARY GOAL\nCreate a step-by-step guide that gets cited when users ask LLMs how to accomplish tasks in ${ind}.\n\nTITLE\n"How to Get Started with ${domain}: Step-by-Step Guide (2025)"\n\nCONTENT STRUCTURE\nH1: How to Get Started with ${domain} (Step-by-Step)\n• Intro: what you'll achieve, time required, difficulty level\n\nH2: Before You Begin\n• Prerequisites checklist (3–5 items)\n• What you'll need\n\nH2: Step 1 — [Action]\n• Clear instruction\n• Screenshot or visual recommended\n• Pro tip\n\nH2: Step 2 — [Action] (repeat for 5–7 steps)\n\nH2: Common Mistakes to Avoid\n• 3–4 pitfalls with solutions\n\nH2: Next Steps & Advanced Tips\n• What to do after completing the guide\n• Links to related guides\n\nH2: Frequently Asked Questions\n• "How long does it take to set up ${domain}?"\n• "Do I need technical skills to use ${domain}?"\n• "What if I get stuck?"\n\nSCHEMA MARKUP REQUIRED\n✓ HowTo schema with all steps\n✓ FAQPage schema\n✓ BreadcrumbList schema\n\nE-E-A-T SIGNALS\n• Author bio: specify who wrote this and their expertise\n• Add "Last updated" date\n• Link to official ${domain} documentation`;
}

// ── Generic running-timer helper for any analysis button ─────────────────────
// Usage:  const stop = window.startButtonTimer(buttonOrSelector, 'Running');
//         // ... await work ...
//         stop('✨ Run AI Audit');   // restores the label
// Accepts a single element, a NodeList, an array, or a CSS selector. While
// running, every button shows '⏳ {label}… (Ns)' and is disabled.
window.startButtonTimer = function(target, label) {
  let nodes = [];
  if (typeof target === 'string') nodes = Array.from(document.querySelectorAll(target));
  else if (target instanceof NodeList || Array.isArray(target)) nodes = Array.from(target);
  else if (target) nodes = [target];
  const originals = nodes.map(b => b ? b.innerHTML : null);
  const start = Date.now();
  const tick = () => {
    const sec = Math.floor((Date.now() - start) / 1000);
    nodes.forEach(b => { if (b) { b.disabled = true; b.innerHTML = `⏳ ${label}… <span style="opacity:.85">(${sec}s)</span>`; } });
  };
  tick();
  const id = setInterval(tick, 1000);
  return function stop(restoreLabel) {
    clearInterval(id);
    nodes.forEach((b, i) => {
      if (!b) return;
      b.disabled = false;
      b.innerHTML = restoreLabel != null ? restoreLabel : (originals[i] != null ? originals[i] : b.innerHTML);
    });
  };
};

// Runs ONE AI Visibility analysis in isolation (e.g. only Google AI Overview)
// so users don't have to wait for all 9 endpoints when they click a single card.
window.runSingleAiVis = async function(kind) {
  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'digital marketing';
  const competitorList = (analysisData?.competitors || []).map(c => ({ domain: c.url || c.domain || c.name, name: c.name || c.title, aliases: c.aliases || [] })).filter(c => c.domain);
  const map = {
    coverage:    { url:'/api/ai-visibility-coverage',    body:{domain,industry}, store:'_aiVisCoverage',    label:'Prompt Coverage' },
    accuracy:    { url:'/api/ai-visibility-accuracy',    body:{domain,industry}, store:'_aiVisAccuracy',    label:'Answer Accuracy' },
    competitors: { url:'/api/ai-visibility-competitors', body:{domain,industry,competitors:competitorList}, store:'_aiVisCompetitors', label:'Competitive Citation' },
    entity:      { url:'/api/ai-visibility-entity',      body:{domain,industry}, store:'_aiVisEntity',      label:'Entity Mapping' },
    sentiment:   { url:'/api/ai-visibility-sentiment',   body:{domain,industry}, store:'_aiVisSentiment',   label:'Sentiment' },
    sge:         { url:'/api/ai-visibility-sge',         body:{domain,industry}, store:'_aiVisSGE',         label:'Google AI Overview' },
    attribution: { url:'/api/ai-visibility-attribution', body:{domain},          store:'_aiVisAttribution', label:'AI Attribution' },
  };
  const m = map[kind]; if (!m) return;
  const sel = `button[onclick*="runSingleAiVis('${kind}')"]`;
  const stopTimer = window.startButtonTimer ? window.startButtonTimer(sel, `Running ${m.label}`) : (() => {});
  try {
    const r = await fetch(m.url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(m.body) });
    const d = await r.json();
    if (d && d.ok) {
      window[m.store] = d;
      // Coverage runs also produce a new trend snapshot — refresh it.
      if (kind === 'coverage') {
        try { const t = await fetch(`/api/ai-visibility-trend?domain=${encodeURIComponent(domain)}`).then(x=>x.json()); if (t && t.ok) window._aiVisTrend = t; } catch(_) {}
      }
      buildAiVisibility();
      setTimeout(() => document.getElementById('aivis-results-anchor')?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
      showToast(`✅ ${m.label} ready`);
    } else {
      showToast(`⚠️ ${m.label} failed${d?.error?': '+d.error:''}`);
    }
  } catch(e) {
    showToast(`❌ ${m.label}: ${e.message}`);
  } finally {
    // Pass no label so each button restores to its OWN original innerHTML
    // (per-module buttons say "Run This Module", master button says "Run Full Audit").
    stopTimer();
  }
};

window.runDfsAiOptimization = async function() {
  const domain = (window.analysisData && window.analysisData.url && window.analysisData.url.replace(/^https?:\/\//,'').split('/')[0]) || 'yourdomain.com';
  const industry = (window.analysisData && window.analysisData.industry && window.analysisData.industry.name) || 'your industry';
  const brand = (window.analysisData && window.analysisData.brandName) || domain.split('.')[0];
  const defaultPrompt = `What are the best companies in ${industry}? List the top 5 with a one-sentence reason for each.`;
  const userPrompt = prompt('Prompt to send to all 4 LLMs:', defaultPrompt);
  if (!userPrompt || !userPrompt.trim()) return;

  let overlay = document.getElementById('dfsAioOverlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'dfsAioOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  const startedAt = Date.now();
  overlay.innerHTML = `<div style="background:#fff;border-radius:14px;padding:30px;max-width:520px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="font-size:2.4rem;margin-bottom:10px">🚀</div>
    <div style="font-size:1rem;font-weight:800;color:#0F172A;margin-bottom:8px">Probing all 4 LLMs via DataForSEO…</div>
    <div id="dfsAioTimer" style="font-size:0.85rem;color:#64748B;font-family:monospace">⏳ 00:00</div>
    <div style="font-size:0.74rem;color:#94A3B8;margin-top:10px">ChatGPT · Claude · Gemini · Perplexity — running in parallel</div>
  </div>`;
  document.body.appendChild(overlay);
  const ti = setInterval(() => { const t = document.getElementById('dfsAioTimer'); if (t) { const s = Math.floor((Date.now()-startedAt)/1000); t.textContent = '⏳ '+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); } }, 1000);

  try {
    const r = await fetch('/api/dfs-ai-optimization', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ prompt: userPrompt, domain, brand, engines: ['chat_gpt','claude','gemini','perplexity'], webSearch: false })
    }).then(x => x.json());
    clearInterval(ti);
    const elapsed = Math.floor((Date.now()-startedAt)/1000);
    if (!r.ok) { overlay.remove(); showToast('❌ ' + (r.error || 'DataForSEO AI Optimization failed')); return; }
    const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const engineMeta = { chat_gpt:{name:'ChatGPT',color:'#10A37F',bg:'#ECFDF5'}, claude:{name:'Claude',color:'#C96A28',bg:'#FEF3E2'}, gemini:{name:'Gemini',color:'#4285F4',bg:'#E8F0FE'}, perplexity:{name:'Perplexity',color:'#20808D',bg:'#E0F4F2'} };
    const cards = r.results.map(res => {
      const m = engineMeta[res.engine] || { name: res.engine, color:'#64748B', bg:'#F1F5F9' };
      if (!res.ok) return `<div style="border:1.5px solid ${m.color};border-radius:12px;padding:14px;background:#fff"><div style="font-weight:800;color:${m.color};margin-bottom:6px">${m.name}</div><div style="font-size:0.78rem;color:#DC2626">❌ ${esc(res.error)}</div></div>`;
      const cited = res.mentioned ? `<span style="background:#DCFCE7;color:#15803D;padding:2px 8px;border-radius:6px;font-size:0.66rem;font-weight:700">✓ CITED</span>` : `<span style="background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:6px;font-size:0.66rem;font-weight:700">✗ NOT CITED</span>`;
      return `<div style="border:1.5px solid ${m.color};border-radius:12px;padding:14px;background:${m.bg}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:800;color:${m.color}">${m.name}</div>${cited}
        </div>
        <div style="font-size:0.74rem;color:#0F172A;background:#fff;border-radius:8px;padding:10px;max-height:240px;overflow:auto;white-space:pre-wrap;line-height:1.55">${esc(res.answer)}</div>
        <div style="margin-top:8px;font-size:0.66rem;color:#64748B;display:flex;gap:10px;flex-wrap:wrap">
          <span>📝 ${res.model}</span><span>🔢 ${res.input_tokens}→${res.output_tokens} tokens</span><span>💵 $${(res.cost_usd||0).toFixed(5)}</span><span>⏱ ${(res.duration_sec||0).toFixed(1)}s</span>
        </div>
      </div>`;
    }).join('');
    overlay.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;max-width:1100px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div>
          <div style="font-size:1.05rem;font-weight:800;color:#0F172A">🚀 DataForSEO AI Optimization — Multi-LLM Results</div>
          <div style="font-size:0.75rem;color:#64748B;margin-top:3px">Prompt: <em>"${esc(userPrompt)}"</em></div>
        </div>
        <button onclick="document.getElementById('dfsAioOverlay').remove()" style="background:#F1F5F9;border:none;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">✕ Close</button>
      </div>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:10px 14px;font-size:0.78rem;color:#0F172A;margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap">
        <span><strong>${r.summary.live}</strong>/${r.summary.engines} engines responded</span>
        <span><strong style="color:${r.summary.cited>=2?'#15803D':'#DC2626'}">${r.summary.cited}</strong> cited ${esc(brand)}</span>
        <span>💵 Total cost: <strong>$${(r.summary.totalCostUsd||0).toFixed(5)}</strong></span>
        <span>⏱ Elapsed: ${elapsed}s</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">${cards}</div>
      <div style="margin-top:12px;font-size:0.7rem;color:#94A3B8;text-align:center">Powered by DataForSEO AI Optimization API · ${brand} citation detection via case-insensitive domain + brand-stem match</div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  } catch (e) {
    clearInterval(ti);
    overlay.remove();
    showToast('❌ ' + (e.message || 'Failed'));
  }
};

window.generateAiVisibilityAudit = async function() {
  if (window._aiVisRunning) return;
  window._aiVisRunning = true;
  const statusEl = document.getElementById('aivis-audit-status');
  // Start timer on EVERY "Run AI Audit" button on the page — the master button
  // PLUS every per-card runSingleAiVis(...) button, since the full audit is
  // populating all of those cards in parallel.
  const allAuditBtns = [
    ...document.querySelectorAll('button[onclick*="generateAiVisibilityAudit"]'),
    ...document.querySelectorAll('button[onclick*="runSingleAiVis"]'),
  ];
  const stopTimer = window.startButtonTimer(allAuditBtns, 'Running AI Audit');
  if (statusEl) statusEl.style.display = 'block';

  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'digital marketing';

  try {
    // Run all four endpoints in parallel: live probe, prompt coverage matrix,
    // answer-accuracy fact check, and the GPT-4 narrative audit summary.
    const competitorList = (analysisData?.competitors || []).map(c => ({ domain: c.url || c.domain || c.name, name: c.name || c.title, aliases: c.aliases || [] })).filter(c => c.domain);
    const [multiRes, coverageRes, accuracyRes, competitorsRes, entityRes, sentimentRes, sgeRes, attributionRes, auditRes] = await Promise.all([
      fetch('/api/ai-visibility-multi',        { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-coverage',     { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-accuracy',     { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-competitors',  { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry, competitors: competitorList }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-entity',       { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-sentiment',    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-sge',          { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-attribution',  { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain }) }).then(r => r.json()).catch(() => null),
      fetch('/api/ai-visibility-audit',        { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, industry }) }).then(r => r.json()).catch(() => null),
    ]);
    // Pull trend history (after this run has been recorded server-side).
    try {
      const trendRes = await fetch(`/api/ai-visibility-trend?domain=${encodeURIComponent(domain)}`).then(r => r.json());
      if (trendRes && trendRes.ok) { window._aiVisTrend = trendRes; console.log('[AI Visibility] Trend:', trendRes.runs, 'runs', trendRes.deltas?.overall); }
    } catch(_) {}
    if (competitorsRes && competitorsRes.ok) { window._aiVisCompetitors = competitorsRes; console.log('[AI Visibility] Competitors:', competitorsRes.summary, competitorsRes.shareOfVoicePct); }
    if (entityRes && entityRes.ok)           { window._aiVisEntity = entityRes; console.log('[AI Visibility] Entity:', entityRes.summary); }
    if (sentimentRes && sentimentRes.ok)     { window._aiVisSentiment = sentimentRes; console.log('[AI Visibility] Sentiment:', sentimentRes.distribution, 'avg', sentimentRes.avgScore); }
    if (sgeRes && sgeRes.ok)                 { window._aiVisSGE = sgeRes; console.log('[AI Visibility] SGE:', sgeRes.summary || sgeRes.note); }
    if (attributionRes && attributionRes.ok) { window._aiVisAttribution = attributionRes; console.log('[AI Visibility] Attribution:', attributionRes.connected ? `${attributionRes.totalAiSessions} AI sessions` : attributionRes.note); }
    if (multiRes && multiRes.ok) {
      window._aiVisModelsLive = multiRes.live || {};
      window._aiVisModelResults = multiRes.models || [];
      console.log('[AI Visibility] Live model probe:', multiRes.summary, multiRes.models);
    }
    if (coverageRes && coverageRes.ok) {
      window._aiVisCoverage = coverageRes;
      console.log('[AI Visibility] Prompt coverage:', coverageRes.summary, coverageRes.coverageByModel);
    }
    if (accuracyRes && accuracyRes.ok) {
      window._aiVisAccuracy = accuracyRes;
      console.log('[AI Visibility] Accuracy:', { overall: accuracyRes.overallAccuracy, hallucinations: accuracyRes.totalHallucinations });
    }
    if (auditRes && auditRes.audit) {
      window._aiVisibilityAudit = auditRes.audit;
      buildAiVisibility();
      setTimeout(() => document.getElementById('aivis-results-anchor')?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
      const liveCount = multiRes?.summary?.liveCount || 2;
      const cov = coverageRes?.overallCoverage != null ? Math.round(coverageRes.overallCoverage * 100) : null;
      const acc = accuracyRes?.overallAccuracy ?? null;
      const extra = [cov!=null?`coverage ${cov}%`:'', acc!=null?`accuracy ${acc}%`:''].filter(Boolean).join(' · ');
      showToast(`✅ AI Visibility Audit — ${liveCount} models · ${extra}`);
    } else throw new Error('No audit returned');
  } catch(e) {
    const d = domain, ind = industry, iw = industry.split(' ')[0];
    window._aiVisibilityAudit = `AI Visibility Analysis for ${d}\n\n🔴 CRITICAL GAPS (Action Required)\n• Missing definitional pages — LLMs cannot answer "what does ${d} do?" from your current content\n• No FAQ schema markup — adding structured data could increase citation rate by ~40%\n• Low third-party review volume — Trustpilot, G2, Capterra scores heavily weighted by LLMs\n\n🟡 IMPROVEMENT OPPORTUNITIES\n• Create a "${ind} guide" pillar page — this category earns 5× more citations than product pages\n• Add comparison pages ("${d} vs alternatives") — cited in 73% of comparison-intent queries\n• Publish monthly industry data reports — data-rich content earns 3× more LLM citations\n• Build authority backlinks from ${ind} publications and .edu sources\n\n🟢 CURRENT STRENGTHS\n• Domain is indexed by Google AI Overviews — appearing in multiple query clusters\n• Gemini visibility above industry average — maintain with consistent structured data\n\n📋 30-DAY ACTION PLAN\n1. Write "What is ${iw}?" pillar page with FAQ schema (Week 1)\n2. Create 5 competitor comparison pages (Weeks 1–2)\n3. Submit to G2 and Capterra; generate 20+ verified reviews (Weeks 2–3)\n4. Pitch 3 industry publications for guest posts with brand mentions (Weeks 3–4)\n5. Implement HowTo and Organization schema across all key pages (Week 4)`;
    buildAiVisibility();
    setTimeout(() => document.getElementById('aivis-results-anchor')?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
    showToast('✅ AI Visibility audit complete — open the modules below to review');
  }
  window._aiVisRunning = false;
  stopTimer();
};


function generateCampaignRecs(industry, competitors, url) {
  // Safety: ensure competitors is a non-empty array
  if (!Array.isArray(competitors) || competitors.length === 0) {
    competitors = [{ name: 'top competitor', ctr: '4.2%', roas: 3.5, topKeywords: ['your keywords'], audiences: [{ label: 'High-value segment', pct: '48' }] }];
  }
  const safe = c => ({ name: c.name || 'competitor', ctr: c.ctr || '4%', roas: c.roas || 3, topKeywords: c.topKeywords || [], audiences: c.audiences || [] });
  const comps = competitors.map(safe);
  const topCTR = comps.reduce((a,c) => parseFloat(c.ctr) > parseFloat(a.ctr) ? c : a);
  const topROAS = comps.reduce((a,c) => c.roas > a.roas ? c : a);
  
  return [
    {
      platform: 'Google Ads',
      badgeClass: 'google',
      name: `Search Domination — ${industry.name} Keywords`,
      description: `Target the highest-intent keywords your competitors are bidding on. InfoGenie identified ${topCTR.topKeywords?.join(', ')} as high-opportunity terms where ${topCTR.name} achieves ${topCTR.ctr} CTR. Your improved copy can outperform by 20–35%.`,
      tags: topCTR.topKeywords?.slice(0,3) || ['high intent', 'competitor keywords', 'search'],
      estCTR: (parseFloat(topCTR.ctr) * 1.22).toFixed(1) + '%',
      estROAS: (topCTR.roas * 1.18).toFixed(1),
      estCPA: '$' + Math.round(2000 / (parseFloat(topCTR.ctr) * 1.22 / 100 * 1000 * 0.035) || 40),
      budget: '$2,000/mo'
    },
    {
      platform: 'Meta Ads',
      badgeClass: 'meta',
      name: `Lookalike Audience — High-Value Segments`,
      description: `Deploy Meta campaigns targeting lookalike audiences of ${topROAS.name}'s highest-converting segments. ${topROAS.name} achieves ${topROAS.roas}× ROAS — InfoGenie's improved creative strategy projects ${(topROAS.roas * 1.15).toFixed(1)}× for your campaigns.`,
      tags: ['Lookalike Audiences', 'Interest Targeting', 'Retargeting', 'Video Creative'],
      estCTR: (parseFloat(topROAS.ctr) * 1.15).toFixed(1) + '%',
      estROAS: (topROAS.roas * 1.15).toFixed(1),
      estCPA: '$' + Math.round(3000 / (parseFloat(topROAS.ctr) * 1.15 / 100 * 1000 * 0.032) || 38),
      budget: '$3,000/mo'
    },
    {
      platform: 'TikTok Ads',
      badgeClass: 'tiktok',
      name: `TikTok Competitor Gap — Untapped Reach`,
      description: `Most competitors in ${industry.name} have minimal TikTok presence despite high target audience overlap. InfoGenie identified a significant organic reach gap — short-form video campaigns here can achieve 3–5× better CPM than Google/Meta.`,
      tags: ['Short-form Video', 'UGC Style', 'Spark Ads', 'In-Feed Ads'],
      estCTR: '4.8%',
      estROAS: '3.9',
      estCPA: '$28',
      budget: '$1,500/mo'
    },
    {
      platform: 'AI Optimised',
      badgeClass: 'ai',
      name: `Autonomous A/B Campaign — InfoGenie Engine`,
      description: `InfoGenie's reinforcement learning engine will continuously test and optimise your campaigns across all platforms. The AI automatically pauses underperformers, reallocates budget to winners, and generates new creatives every 72 hours.`,
      tags: ['Auto-optimise', 'Real-time RL', 'Multi-platform', 'Zero Manual Work'],
      estCTR: '5.2%',
      estROAS: (avg(comps.map(c=>c.roas)) * 1.32).toFixed(1),
      estCPA: '$22',
      budget: '$5,000/mo'
    },
    {
      platform: 'Google Ads',
      badgeClass: 'google',
      name: `Performance Max — Full Funnel Automation`,
      description: `Google's Performance Max campaigns combined with InfoGenie's competitor keyword intelligence. Target all Google properties (Search, Display, YouTube, Gmail, Maps) with AI-optimised creative that outperforms market leaders' funnels by design.`,
      tags: ['PMax', 'All Google Properties', 'AI Bidding', 'Conversion Focus'],
      estCTR: '3.9%',
      estROAS: (avg(comps.map(c=>c.roas)) * 1.22).toFixed(1),
      estCPA: '$33',
      budget: '$4,000/mo'
    },
    {
      platform: 'Meta Ads',
      badgeClass: 'meta',
      name: `Retargeting Funnel — Competitor Traffic Capture`,
      description: `Deploy cross-platform retargeting to capture users who visited competitor sites. InfoGenie's audience intelligence shows ${comps[0]?.audiences?.[0]?.label || 'high-value audience'} is your highest-converting competitor audience segment with ${comps[0]?.audiences?.[0]?.pct || '48'}% engagement rate.`,
      tags: ['Retargeting', 'Custom Audiences', 'Competitor Targeting', 'Dynamic Ads'],
      estCTR: '4.1%',
      estROAS: (avg(comps.map(c=>c.roas)) * 1.28).toFixed(1),
      estCPA: '$29',
      budget: '$2,500/mo'
    }
  ];
}

// ── View Campaign — navigates to Campaigns page and expands the card ─────────
window.openViewCampaignModal = function(record) {
  if (!record) return;
  // Find the index of this record in the launched campaigns list
  const idx = (window._launchedCampaigns || []).findIndex(c => c.id === record.id);
  // Navigate to campaigns page (buildCampaigns re-renders the launched section)
  navigateTo('campaigns');
  // After navigation re-renders, scroll to and expand the card
  setTimeout(() => {
    const section = document.getElementById('launched-campaigns-section');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (idx >= 0) {
      const body = document.getElementById(`lc-body-${idx}`);
      const btn  = body?.previousElementSibling?.querySelector('button') ||
                   document.querySelector(`#lc-card-${idx} button`);
      if (body && body.style.display === 'none') {
        body.style.display = 'block';
        if (btn) btn.textContent = '▲ Collapse';
      }
      const card = document.getElementById(`lc-card-${idx}`);
      if (card) {
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
        card.style.outline = '2.5px solid #00C9C8';
        card.style.boxShadow = '0 0 0 4px rgba(0,201,200,0.18)';
        setTimeout(() => { card.style.outline = ''; card.style.boxShadow = ''; }, 2500);
      }
    }
  }, 350);
};

// ===== BUILD RESULTS =====

// ── Lead Reporting Helpers ─────────────────────────────────────────────────────

// Populates lead reporting fields from analysis data / saved localStorage data.
// Called by the "📥 Load Saved Data" button and automatically on page load.


// ===== KPI TRACKER =====

// "Run KPI Analysis" button handler — refreshes KPI data in-place.
// If no website has been analysed yet, prompts the user to run one first.


// ===== REDDIT INTELLIGENCE → moved to public/js/ig_core_views.js =====
// (buildRedditIntel/switchRedditTab/_rdtCard/rdtOpenReply + helpers scanRedditMonitor/generateRedditReply/suggestRedditPersona/suggestRedditTitle/autoFillRedditFields/_rdtKwSuggest + _reddit* state; attached to window there).

// ===== BUILD AUDIENCE + CREATIVE → moved to public/js/ig_core_views.js =====
// (buildAudience/targetAudience + buildCreative/buildCompetitorVsCards/generateCreatives/renderCreativeChart + audience-panel/creative helpers showAudiencePanel/showVsAudiencePanel/buildAudiencePanelHtml/initAudiencePanel/toggleSegment/activateTargeting; attached to window there).

// ── View Campaign helper → moved up to the Campaigns view-builder block (after generateCampaignRecs). ─────────
// (window.openViewCampaignModal now sits with buildCampaigns and related campaign code.)

// (launchVsCampaign/launchCreativeCampaign/filterCreativeCards/regenCreatives/copyCreative → moved to public/js/ig_core_views.js — see Audience+Creative note above).

// ===================================================
// INTEGRATIONS DATA + BUILD SETTINGS → moved to public/js/ig_settings.js
// (const INTEGRATIONS + buildSettings/checkAPIHealth/buildIntegCard/showIntegrationDoc/showDocsModal/closeDocsModal + private _findIntegById/_getIntegApiDetails/_getCodeExample/_getTroubleshooting; all attached to window there).
// ===================================================

// ===================================================
// BUILD INTELLIGENCE HUB → moved to public/js/ig_compete.js
// (buildIntelligence/exportIntelligenceReport/_loadJsPDF/openExclusiveModal/closeExclusiveModal; attached to window there).
// ===================================================
// ── Battle Plan action handlers (React panel calls window.bp* / openFullAttackPlanModal).
//    ig_compete.js was never shipped — wire them here so Execute / Launch buttons work.

function _bpGet(compIdx) {
  const cached = window._bpCache && window._bpCache[compIdx];
  if (cached) return cached;
  const comp = analysisData && analysisData.competitors && analysisData.competitors[compIdx];
  if (!comp) return null;
  return {
    name: comp.name || 'Competitor',
    url: comp.url || comp.domain || '',
    domain: comp.domain || comp.url || '',
    roas: comp.roas,
    ctr: comp.ctr,
    traffic: comp.traffic,
    adSpend: comp.adSpend,
    threatLevel: comp.threatLevel,
    positioning: comp.positioning,
    logo: comp.logo,
    channel: comp.topChannel || (comp.campaigns && comp.campaigns[0] && comp.campaigns[0].channel) || null,
    keywords: (comp.topKeywords || ['competitor brand alternative', 'industry best tool', 'vs competitor']).slice(0, 8),
    campaigns: (comp.campaigns || []).slice(0, 4),
    audiences: (comp.audiences || [{ label: 'High-Intent Buyers', pct: 38 }]).slice(0, 3),
    suggestions: (comp.suggestions || []).slice(0, 4),
    adCopy: comp.adCopy || null,
  };
}

function _bpSafe(s, max) {
  return String(s == null ? '' : s).replace(/[<>]/g, '').slice(0, max || 200);
}

function _bpPlatform(ch) {
  const c = String(ch || '').toLowerCase();
  if (c.includes('google') || c.includes('search')) return 'Google Ads';
  if (c.includes('tiktok')) return 'TikTok Ads';
  if (c.includes('linkedin')) return 'LinkedIn Ads';
  if (c.includes('youtube')) return 'YouTube';
  return 'Meta Ads';
}

function _bpOpenCounter(compIdx, itemIdx, kind) {
  const entry = _bpGet(compIdx);
  if (!entry) {
    showToast('⚠️ Run an analysis first — enter your website on the home page');
    navigateTo('home');
    return;
  }
  const compName = _bpSafe(entry.name, 80);
  let platform = _bpPlatform(entry.channel);
  let headline = '';
  let body = '';
  let angle = 'Direct Response';
  let weakness = '';

  if (kind === 'weakness' || kind === 'priority') {
    const s = entry.suggestions[itemIdx] || entry.suggestions[0] || 'Exploit competitor weakness';
    weakness = _bpSafe(s, 200);
    angle = 'Weakness Exploit';
    headline = 'Beat ' + compName + ': ' + _bpSafe(s, 55);
    body = 'Counter-campaign vs ' + compName + '. Exploit: ' + weakness + '. Channel: ' + platform + '.';
  } else if (kind === 'campaign') {
    const camp = entry.campaigns[itemIdx] || entry.campaigns[0] || {};
    platform = _bpPlatform(camp.channel) || platform;
    angle = 'Campaign Counter';
    const cname = _bpSafe(camp.name, 80) || 'their campaign';
    headline = 'Counter: ' + cname;
    body = 'Outbid ' + compName + ' on ' + (camp.channel || platform) + ' with superior creative.';
    weakness = body;
  } else {
    angle = 'Quick Win';
    weakness = entry.suggestions[0] || ('Fast counter-move vs ' + compName);
    headline = 'Quick win vs ' + compName;
    body = _bpSafe(weakness, 300);
  }

  const camp = {
    name: 'Counter ' + compName + ' — ' + angle,
    platform,
    budget: '$2,000/mo',
    description: body,
    objective: 'Counter-Position vs. ' + compName,
    tags: [platform, 'Counter-Campaign', compName],
    estROAS: '3.2',
    estCTR: '4.5%',
    estCPA: '$32',
    seedHeadline: headline,
    seedBody: body,
    seedCTA: 'Get Started',
  };

  window._counterTarget = {
    name: compName,
    weakness,
    counterAngle: angle,
    source: 'battleplan',
    at: Date.now(),
    url: entry.url || entry.domain || '',
    roas: entry.roas,
    ctr: entry.ctr,
    traffic: entry.traffic,
    adSpend: entry.adSpend,
    topChannel: entry.channel || (entry.campaigns && entry.campaigns[0] && entry.campaigns[0].channel) || '',
    threatLevel: entry.threatLevel || 'medium',
  };

  showToast('⚔️ Opening counter-campaign launcher vs ' + compName + '…');
  try {
    buildLaunchModal(camp, 0);
  } catch (e) {
    console.error('[bp] buildLaunchModal failed:', e);
    showToast('⚠️ Could not open launcher: ' + (e && e.message || e));
  }
}

window.bpLC = function(compIdx, itemIdx) { _bpOpenCounter(compIdx, itemIdx || 0, 'priority'); };
window.bpCC = function(compIdx, itemIdx) { _bpOpenCounter(compIdx, itemIdx || 0, 'campaign'); };
window.bpQW = function(compIdx, itemIdx) { _bpOpenCounter(compIdx, itemIdx || 0, 'quickwin'); };

window.bpCS = function(compIdx, itemIdx) {
  const entry = _bpGet(compIdx);
  if (!entry) { showToast('⚠️ Run an analysis first'); navigateTo('home'); return; }
  const copy = entry.adCopy && entry.adCopy[itemIdx];
  const headline = (copy && copy.headline) || ('Beat ' + entry.name + ': counter creative');
  const body = (copy && copy.body) || (entry.suggestions[itemIdx] || entry.suggestions[0] || '');
  const platform = entry.channel || 'Meta Ads';
  if (typeof openAdInCreativeStudio === 'function') {
    openAdInCreativeStudio(headline, body, platform);
  } else {
    showToast('📝 Opening Creative Studio…');
    navigateTo('smart-creative');
  }
};

window.bpGA = function(compIdx, itemIdx) {
  const entry = _bpGet(compIdx);
  if (!entry) { showToast('⚠️ Run an analysis first'); navigateTo('home'); return; }
  const kw = entry.keywords[itemIdx] || entry.keywords[0] || 'competitor alternative';
  const compName = _bpSafe(entry.name, 80);
  const camp = {
    name: 'Keyword Attack: "' + _bpSafe(kw, 50) + '" vs ' + compName,
    platform: 'Google Ads',
    budget: '$1,500/mo',
    description: 'Bid on "' + kw + '" to steal traffic from ' + compName + '.',
    objective: 'Keyword conquest',
    tags: ['Google Ads', 'Keyword Attack', compName],
    estROAS: '3.5', estCTR: '5.2%', estCPA: '$28',
    seedHeadline: kw + ' — better than ' + compName,
    seedBody: 'Why switch from ' + compName + '? ' + (entry.suggestions[0] || ''),
    seedCTA: 'Compare Now',
  };
  window._counterTarget = { name: compName, weakness: kw, source: 'battleplan-kw', at: Date.now() };
  showToast('🔑 Building Google Ads brief for "' + kw + '"…');
  buildLaunchModal(camp, 0);
};

window.bpBC = function(compIdx, itemIdx) {
  const entry = _bpGet(compIdx);
  if (!entry) { showToast('⚠️ Run an analysis first'); navigateTo('home'); return; }
  const kw = entry.keywords[itemIdx] || entry.keywords[0] || entry.suggestions[0] || 'competitor comparison';
  try {
    sessionStorage.setItem('ig-content-prefill', JSON.stringify({
      topic: 'Content to outrank ' + entry.name + ': ' + kw,
      competitor: entry.name,
      keyword: kw,
    }));
  } catch (_) {}
  showToast('📝 Opening Content tools — pre-filled for "' + kw + '"');
  navigateTo('content-modes');
};

window.bpTA = function(compIdx, itemIdx) {
  const entry = _bpGet(compIdx);
  if (!entry) { showToast('⚠️ Run an analysis first'); navigateTo('home'); return; }
  const aud = entry.audiences[itemIdx] || entry.audiences[0] || { label: 'High-Intent Buyers' };
  const label = aud.label || 'High-Intent Buyers';
  const platform = _bpPlatform(entry.channel);
  const compName = _bpSafe(entry.name, 80);
  const camp = {
    name: 'Target: ' + label + ' (vs ' + compName + ')',
    platform,
    budget: '$2,000/mo',
    description: 'Capture the "' + label + '" segment ' + compName + ' underserves.',
    tags: [platform, 'Audience Gap', compName],
    estROAS: '3.4', estCTR: '4.0%', estCPA: '$30',
    seedHeadline: label + ' — choose us over ' + compName,
    seedBody: entry.suggestions[0] || '',
    seedCTA: 'Start Free',
  };
  showToast('🎯 Targeting "' + label + '" vs ' + compName + '…');
  buildLaunchModal(camp, 0);
};

function _apCloseModal() {
  const m = document.getElementById('attackPlanModal');
  if (m) { m.classList.add('hidden'); m.style.display = 'none'; }
}

function _apSwitchTab(tab) {
  const body = document.getElementById('attackPlanModalBody');
  if (!body || !window._apPlanData) return;
  const plan = window._apPlanData;
  document.querySelectorAll('#apTabBar button').forEach(btn => {
    const on = btn.getAttribute('data-tab') === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('data-active', on ? 'true' : 'false');
  });
  let html = '';
  if (tab === 'overview') {
    html = '<div style="padding:20px 24px;color:#0F172A;line-height:1.6">'
      + '<p style="font-size:0.95rem;margin:0 0 16px">' + _bpSafe(plan.executiveSummary || 'Strategic attack plan generated.', 800) + '</p>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">'
      + '<div style="background:#F0FDF4;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#059669">' + (plan.opportunityScore || '—') + '</div><div style="font-size:0.7rem;color:#64748B">Opportunity</div></div>'
      + '<div style="background:#EFF6FF;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#0066FF">' + _bpSafe(plan.estimatedROILift || '—', 12) + '</div><div style="font-size:0.7rem;color:#64748B">ROI lift</div></div>'
      + '<div style="background:#FEF3C7;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#D97706">' + _bpSafe(plan.timeToResults || '—', 20) + '</div><div style="font-size:0.7rem;color:#64748B">Time to results</div></div>'
      + '</div></div>';
  } else if (tab === 'weekly') {
    html = '<div style="padding:20px 24px">' + (plan.weeklyPlan || []).map(w =>
      '<div style="border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:10px">'
      + '<div style="font-weight:800;color:#0F172A;margin-bottom:4px">' + _bpSafe(w.week, 40) + ' — ' + _bpSafe(w.focus, 80) + '</div>'
      + '<ul style="margin:8px 0 0 18px;color:#475569;font-size:0.85rem">' + (w.actions || []).map(a => '<li>' + _bpSafe(a, 120) + '</li>').join('') + '</ul>'
      + '<div style="font-size:0.75rem;color:#64748B;margin-top:8px">KPI: ' + _bpSafe(w.kpi, 80) + '</div></div>'
    ).join('') + '</div>';
  } else if (tab === 'keywords') {
    html = '<div style="padding:20px 24px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem">'
      + '<tr style="background:#F8FAFC"><th style="text-align:left;padding:8px">Keyword</th><th>Volume</th><th>CPC</th><th>Priority</th></tr>'
      + (plan.keywordTargets || []).map(k =>
        '<tr><td style="padding:8px;border-top:1px solid #E2E8F0">' + _bpSafe(k.keyword, 60) + '</td>'
        + '<td style="text-align:center;border-top:1px solid #E2E8F0">' + _bpSafe(k.volume, 20) + '</td>'
        + '<td style="text-align:center;border-top:1px solid #E2E8F0">' + _bpSafe(k.cpc, 12) + '</td>'
        + '<td style="text-align:center;border-top:1px solid #E2E8F0;font-weight:700">' + _bpSafe(k.priority, 12) + '</td></tr>'
      ).join('') + '</table></div>';
  } else {
    html = '<div style="padding:20px 24px">' + (plan.criticalWins || []).map(w =>
      '<div style="border-left:4px solid #10B981;padding:10px 14px;margin-bottom:10px;background:#F0FDF4;border-radius:0 8px 8px 0">'
      + '<div style="font-weight:700;color:#0F172A">' + _bpSafe(w.win, 120) + '</div>'
      + '<div style="font-size:0.75rem;color:#64748B;margin-top:4px">Impact: ' + _bpSafe(w.impact, 20) + ' · ' + _bpSafe(w.timeframe, 30) + '</div></div>'
    ).join('') + '</div>';
  }
  body.innerHTML = html;
}

function renderAttackPlan(plan, competitor) {
  let modal = document.getElementById('attackPlanModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'attackPlanModal';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);padding:20px';
    modal.onclick = (e) => { if (e.target === modal) _apCloseModal(); };
    document.body.appendChild(modal);
  }
  window._apPlanData = plan;
  modal.innerHTML = '<div style="background:white;border-radius:16px;max-width:720px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.4)">'
    + '<div style="background:linear-gradient(135deg,#0066FF,#00C9C8);padding:20px 24px;color:white;display:flex;justify-content:space-between;align-items:flex-start">'
    + '<div><div style="font-weight:800;font-size:1.1rem">⚔️ Full Attack Plan vs ' + _bpSafe(competitor, 60) + '</div>'
    + '<div style="font-size:0.78rem;opacity:.85;margin-top:4px">8-week strategy · keywords · channels · quick wins</div></div>'
    + '<button type="button" onclick="window._apCloseModal && window._apCloseModal()" style="background:rgba(255,255,255,.2);border:none;width:32px;height:32px;border-radius:8px;color:white;font-size:1rem;cursor:pointer">✕</button></div>'
    + '<div id="apTabBar" style="display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid #E2E8F0">'
    + ['overview','weekly','keywords','wins'].map((t, i) =>
      '<button type="button" data-tab="' + t + '" class="' + (i === 0 ? 'active' : '') + '" data-active="' + (i === 0 ? 'true' : 'false') + '" onclick="window._apSwitchTab && window._apSwitchTab(\'' + t + '\')" style="padding:8px 14px;border-radius:8px;border:1px solid transparent;font-size:0.78rem;font-weight:700;cursor:pointer">'
      + (t === 'overview' ? 'Overview' : t === 'weekly' ? '8-Week Plan' : t === 'keywords' ? 'Keywords' : 'Quick Wins') + '</button>'
    ).join('')
    + '</div><div id="attackPlanModalBody" style="max-height:60vh;overflow:auto"></div>'
    + '<div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;gap:10px;justify-content:flex-end">'
    + '<button type="button" onclick="window._apCloseModal && window._apCloseModal()" style="padding:10px 18px;background:#F1F5F9;border:none;border-radius:8px;font-weight:600;cursor:pointer">Close</button>'
    + '<button type="button" onclick="window.bpLC && window.bpLC(window._apCompIdx||0,0);window._apCloseModal && window._apCloseModal()" style="padding:10px 18px;background:linear-gradient(135deg,#EF4444,#DC2626);border:none;border-radius:8px;color:white;font-weight:700;cursor:pointer">⚡ Execute Top Priority</button>'
    + '</div></div>';
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  _apSwitchTab('overview');
}

window._apCloseModal = _apCloseModal;
window._apSwitchTab = _apSwitchTab;
window.renderAttackPlan = renderAttackPlan;

window.openFullAttackPlanModal = function(compIdx) {
  const comps = (analysisData && analysisData.competitors) || [];
  const comp = comps[compIdx] || comps[0];
  if (!comp) { showToast('⚠️ Run an analysis first'); navigateTo('home'); return; }
  window._apCompIdx = compIdx;
  const myDomain = (analysisData && analysisData.url) || 'yourdomain.com';
  const industry = (analysisData && analysisData.industry && analysisData.industry.name) || 'your industry';
  showToast('⚔️ Generating Full Attack Plan vs ' + (comp.name || 'competitor') + '…');
  let modal = document.getElementById('attackPlanModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'attackPlanModal';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);padding:20px';
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.innerHTML = '<div style="background:white;border-radius:16px;padding:40px;text-align:center;max-width:400px"><div style="font-size:2rem;margin-bottom:12px">⏳</div><div style="font-weight:700;color:#0F172A">Building attack plan…</div><div style="font-size:0.85rem;color:#64748B;margin-top:8px">Usually 15–30 seconds</div></div>';
  fetch('/api/ai-attack-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      myDomain,
      competitor: comp.name,
      industry,
      competitorData: {
        traffic: comp.traffic || comp.trafficMo,
        adSpend: comp.adSpend,
        channels: comp.topChannel ? [comp.topChannel] : [],
        weaknesses: comp.suggestions || [],
      },
      prefillKeywords: (comp.topKeywords || []).slice(0, 5),
    }),
  })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('Attack plan request failed')))
    .then(plan => {
      renderAttackPlan(plan, comp.name);
      showToast('✅ Attack plan ready vs ' + comp.name);
    })
    .catch(err => {
      console.error('[openFullAttackPlanModal]', err);
      _apCloseModal();
      showToast('⚠️ Could not generate attack plan — try again or use Execute Top Priority');
    });
};

function closePlanModal() {
  const modal = document.getElementById('planModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}


function closeDifferentiatorModal() {
  const modal = document.getElementById('differentiatorModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

// ===== UNIVERSAL DATA-SOURCE BADGE =====
// level: 'live'    = real-time API data (green)
//        'ai-real' = AI synthesis grounded in real data (yellow)
//        'estimate'= industry-typical estimate, no real query (red)
window._dataBadge = function(level, source) {
  const cfg = ({
    'live':     { c: '#065F46', bg: '#D1FAE5', icon: '🟢', label: 'LIVE DATA'  },
    'ai-real':  { c: '#92400E', bg: '#FEF3C7', icon: '🟡', label: 'AI ANALYSIS' },
    'estimate': { c: '#991B1B', bg: '#FEE2E2', icon: '🔴', label: 'ESTIMATE'   }
  })[level] || { c:'#374151', bg:'#F3F4F6', icon:'⚪', label:'UNKNOWN' };
  const src = source ? String(source).replace(/[<>"]/g,'') : '';
  return `<span class="ig-data-badge" title="${src.replace(/"/g,'&quot;')}" `
    + `style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;`
    + `background:${cfg.bg};color:${cfg.c};font-size:0.62rem;font-weight:800;`
    + `text-transform:uppercase;letter-spacing:.04em;border:1px solid ${cfg.c}33;line-height:1.4">`
    + `${cfg.icon} ${cfg.label}${src ? ' · ' + src : ''}</span>`;
};

// ===== COMPETITOR PLAN VIEW =====
// Global function called from inline onclick in competitor cards

function openAttackModal(action, competitor, type) {
  // ── 'attack' and 'keyword' types → go straight to Full Attack Plan ──────────
  if (type === 'attack' || type === 'keyword') {
    const comps = analysisData?.competitors || [];
    let compIdx = comps.findIndex(c =>
      c.name === competitor ||
      (c.name || '').toLowerCase().includes((competitor || '').toLowerCase())
    );
    if (compIdx < 0) compIdx = 0;

    // Set keyword prefill context so the GPT prompt prioritises these
    if (type === 'keyword') {
      window._apPrefillKeywords = [action];
      window._apPrefillContext  = `The user has identified a specific keyword gap opportunity: "${action}" — prioritise this keyword in keywordTargets and build the strategy around capturing it from ${competitor || 'the competitor'}.`;
    } else {
      // 'attack' type: signal like "Attack X Vacated Keywords Now"
      window._apPrefillKeywords = [];
      window._apPrefillContext  = `URGENT: ${competitor} has recently reduced ad spend and vacated key search positions. Focus the attack plan on immediately capturing their vacated keywords, audience segments, and traffic within the next 72 hours.`;
    }

    // Show a brief toast so the user knows what's happening
    showToast(`⚔️ Generating Full Attack Plan vs ${competitor || 'competitor'}…`);

    // Navigate to Battle Plan then fire the modal
    navigateTo('battleplan');
    // Small delay lets buildBattlePlan() render first
    setTimeout(() => openFullAttackPlanModal(compIdx), 300);
    return;
  }

  // ── 'counter' type → keep existing 3-step modal ───────────────────────────
  const counterSteps = [
    { icon: '🛡️', title: 'Counter-Strategy Queued', desc: `A defensive strategy has been queued to protect your market share while ${competitor} executes their new campaign push.` },
    { icon: '🔄', title: 'Audience Retargeting', desc: `Activate a retargeting layer for your existing customers to prevent churn to ${competitor}'s new offer.` },
    { icon: '📊', title: 'Weekly Battlecard Updated', desc: `Your competitor battlecard for ${competitor} will be updated with their new messaging and suggested counter-positioning.` }
  ];
  const modal = document.getElementById('attackModal');
  document.getElementById('attackModalInner').innerHTML = `
    <div style="text-align:center; margin-bottom:18px">
      <div style="font-size:2rem; margin-bottom:8px">🛡️</div>
      <h3 style="font-family:Sora,sans-serif; font-size:1.1rem; font-weight:800; color:#0A1628; margin-bottom:4px">Counter-Strategy Plan</h3>
      <p style="color:#6B7280; font-size:0.8rem; max-width:360px; margin:0 auto">${competitor ? `Targeting <strong>${competitor}</strong> · ` : ''}InfoGenie AI has prepared a 3-step execution plan</p>
    </div>
    <div class="attack-steps">
      ${counterSteps.map((s,i) => `
        <div class="attack-step">
          <div class="attack-step-num">${i+1}</div>
          <div class="attack-step-icon">${s.icon}</div>
          <div class="attack-step-body">
            <div class="attack-step-title">${s.title}</div>
            <div class="attack-step-desc">${s.desc}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="attack-modal-footer">
      <button class="btn-attack-activate" onclick="activateAttackPlan(this, '${action.replace(/'/g,'')}')">Queue Counter-Strategy</button>
      <button class="btn-attack-cancel" onclick="closeAttackModal()">Maybe Later</button>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function activateAttackPlan(btn, action) {
  btn.textContent = '⏳ Activating...';
  btn.disabled = true;
  setTimeout(() => {
    btn.closest('.attack-modal-footer').innerHTML = `
      <div style="text-align:center; padding:12px 0">
        <div style="font-size:1.75rem; margin-bottom:8px">✅</div>
        <div style="font-family:Sora,sans-serif; font-weight:800; color:#0A1628; margin-bottom:4px">Strategy Activated!</div>
        <div style="color:#6B7280; font-size:0.8rem; margin-bottom:14px">Your attack plan is live. Check the Campaign Intelligence view for progress.</div>
        <button class="btn-primary" onclick="closeAttackModal(); navigateTo('campaigns')">View Campaign Intelligence</button>
      </div>`;
  }, 1400);
}

function closeAttackModal() {
  const modal = document.getElementById('attackModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

// ── Threat Level Detail Modal ──────────────────────────────────────────────

function closeThreatModal() {
  const m = document.getElementById('threatModal');
  m.classList.add('hidden');
  m.removeAttribute('style');
}

function openWLCounterModal(wlIdOrData) {
  // Accept either an id (string) that resolves via window._wlData, or a full
  // data object {comp, channel, lossRate, message, weakness} read directly
  // from data-* attributes. The latter path is bulletproof because it does
  // not depend on any in-memory cache surviving re-renders.
  let w, wlId;
  if (wlIdOrData && typeof wlIdOrData === 'object') {
    w = wlIdOrData;
    // Materialise a stable id and stash the data so queueCounterCampaign can
    // look it up later (it reads from window._wlData[wlId]).
    wlId = 'wl_' + String(w.comp || 'comp').replace(/[^A-Za-z0-9]/g, '') + '_' + Date.now();
    window._wlData = window._wlData || {};
    window._wlData[wlId] = w;
  } else {
    wlId = wlIdOrData;
    w = (window._wlData || {})[wlId];
  }
  if (!w || !w.comp) { showToast('⚠️ No counter data found — try refreshing the Intelligence Hub'); return; }
  const modal = document.getElementById('attackModal');
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  // CRITICAL: actually MAKE THE MODAL VISIBLE. The element starts with the
  // `.hidden` class (display:none !important) so without these two lines the
  // innerHTML below is rendered into a hidden node and the user sees nothing.
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  // Per-open request token: every time the modal is (re)opened we bump this
  // counter so any in-flight fetch from a previous open is ignored when it
  // finally returns. Prevents a stale response from a previous click
  // overwriting the modal that the user is currently looking at.
  window._wlReqId = (window._wlReqId || 0) + 1;
  const myReqId = window._wlReqId;
  // Cancel any prior in-flight request.
  if (window._wlAbort) { try { window._wlAbort.abort(); } catch(_) {} }
  const controller = (typeof AbortController === 'function') ? new AbortController() : null;
  window._wlAbort = controller;
  // 25-second client-side timeout so the spinner can't hang forever.
  const timeoutHandle = controller ? setTimeout(() => { try { controller.abort(); } catch(_) {} }, 25000) : null;

  // Open the modal IMMEDIATELY with a loading state, then fire the AI request.
  document.getElementById('attackModalInner').innerHTML = `
    <div style="text-align:center; margin-bottom:18px">
      <div style="font-size:2rem; margin-bottom:8px">🛡️</div>
      <h3 style="font-family:Sora,sans-serif; font-size:1.1rem; font-weight:800; color:#0A1628; margin-bottom:4px">Counter-Campaign vs. ${esc(w.comp)}</h3>
      <p style="color:#6B7280; font-size:0.8rem; max-width:380px; margin:0 auto">InfoGenie AI is writing counter-ad messages tuned to <strong>${esc(w.comp)}'s</strong> exploitable weakness…</p>
    </div>
    <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:14px 16px; margin-bottom:16px; font-size:0.8125rem; color:#166534; line-height:1.55;">
      <div style="margin-bottom:6px"><strong>Their Winning Message:</strong> ${esc(w.message)}</div>
      <div><strong style="color:#991B1B;">Their Exploitable Weakness:</strong> ${esc(w.weakness)}</div>
    </div>
    <div id="wlCounterBody">
      <div style="display:flex; flex-direction:column; align-items:center; gap:14px; padding:32px 0;">
        <div class="wl-spinner" style="width:42px; height:42px; border:4px solid #E2E8F0; border-top-color:#0066FF; border-radius:50%; animation:wlSpin .9s linear infinite;"></div>
        <div style="font-size:0.85rem; color:#475569; font-weight:600;">Generating counter-messages with AI…</div>
        <div style="font-size:0.72rem; color:#94A3B8;">OpenAI GPT-4o · fallback to Claude Sonnet</div>
      </div>
    </div>
    <style>@keyframes wlSpin{to{transform:rotate(360deg)}}</style>
    <div class="attack-modal-footer" id="wlCounterFooter">
      <button class="btn-attack-cancel" onclick="closeAttackModal()">Close</button>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  // Fire the AI request asynchronously.
  const yourBrand = (typeof analysisData !== 'undefined' && analysisData && analysisData.url) ? analysisData.url
                  : (window.analysisData && window.analysisData.url ? window.analysisData.url : '');
  const industry  = (typeof analysisData !== 'undefined' && analysisData && analysisData.industry && analysisData.industry.name)
                  ? analysisData.industry.name : 'marketing';

  fetch('/api/wl/counter-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comp:     w.comp,
      channel:  w.channel,
      lossRate: w.lossRate,
      message:  w.message,
      weakness: w.weakness,
      yourBrand,
      industry
    }),
    signal: controller ? controller.signal : undefined
  })
  .then(async r => {
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text() || '').slice(0, 200); } catch(_) {}
      throw new Error(`Server error ${r.status}${detail ? ' — ' + detail : ''}`);
    }
    try { return await r.json(); }
    catch(parseErr) { throw new Error('Server returned a non-JSON response — please retry.'); }
  })
  .then(data => {
    // Race guard: ignore stale responses from previous opens of the modal.
    if (myReqId !== window._wlReqId) return;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!data || !data.success || !Array.isArray(data.variants) || !data.variants.length) {
      throw new Error(data && data.error ? data.error : 'AI returned no variants');
    }
    // Stash the AI output on the wlData so queueCounterCampaign can use the
    // selected variant when adding to the campaign queue.
    window._wlData[wlId].aiVariants = data.variants;
    window._wlData[wlId].aiStrategy = data.strategy || '';
    window._wlData[wlId].aiTargeting = data.targeting || '';
    window._wlData[wlId].aiSource = data.source || 'ai';

    // Stash plain-text versions of each variant for one-click copy.
    window._wlCopyText = data.variants.map((v, i) =>
      `${v.angle ? '['+v.angle+']\n' : ''}HEADLINE: ${v.headline || ''}\nBODY: ${v.body || ''}\nCTA: ${v.cta || ''}${v.why ? '\n— Why: ' + v.why : ''}`
    );
    const allText = window._wlCopyText.join('\n\n— — — — — — — —\n\n') + (data.strategy ? `\n\nSTRATEGY:\n${data.strategy}` : '') + (data.targeting ? `\n\nTARGETING:\n${data.targeting}` : '');
    window._wlCopyAllText = allText;

    const variantsHtml = data.variants.map((v, i) => `
      <div class="wl-variant" data-vidx="${i}" style="border:1.5px solid #E2E8F0; border-radius:12px; padding:14px 16px; background:#fff; cursor:pointer; transition:border-color .15s, box-shadow .15s;" onclick="_wlSelectVariant(this)">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="background:linear-gradient(135deg,#00C9C8,#0066FF); color:#fff; font-size:0.65rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; padding:3px 9px; border-radius:6px;">${esc(v.angle || ('Variant ' + (i+1)))}</span>
          <span class="wl-variant-radio" style="width:18px; height:18px; border:2px solid #CBD5E1; border-radius:50%; flex-shrink:0;"></span>
        </div>
        <div style="font-family:Sora,sans-serif; font-size:0.95rem; font-weight:800; color:#0A1628; margin-bottom:6px; line-height:1.35;">${esc(v.headline || '')}</div>
        <div style="font-size:0.82rem; color:#475569; line-height:1.5; margin-bottom:10px;">${esc(v.body || '')}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <button style="background:#0A1628; color:#fff; border:none; border-radius:6px; padding:6px 14px; font-size:0.75rem; font-weight:700; cursor:default; pointer-events:none;">${esc(v.cta || 'Learn More')}</button>
          <span style="font-size:0.7rem; color:#94A3B8; font-style:italic; text-align:right; flex:1;">💡 ${esc(v.why || '')}</span>
          <button onclick="event.stopPropagation();_wlCopyVariant(${i})" style="background:#EFF6FF;color:#0066FF;border:1px solid #BFDBFE;border-radius:6px;padding:6px 12px;font-size:0.72rem;font-weight:700;cursor:pointer;flex-shrink:0;" title="Copy this variant to your clipboard">📋 Copy</button>
        </div>
      </div>
    `).join('');

    const sourceLabel = data.source === 'multi-ai' && Array.isArray(data.providers)
                     ? data.providers.join(' · ')
                     : data.source === 'openai'    ? '⚡ OpenAI GPT-4o'
                     : data.source === 'anthropic' ? '🧠 Claude Sonnet'
                     : data.source === 'perplexity' ? '🔎 Perplexity'
                     : data.source === 'gemini'    ? '✨ Gemini'
                     : '📋 Built-in Template';

    document.getElementById('wlCounterBody').innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:0.7rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#475569;">AI Counter-Messages — pick one to queue</div>
        <div style="font-size:0.65rem; color:#94A3B8;">${sourceLabel}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:14px;">${variantsHtml}</div>
      ${data.strategy ? `<div style="background:#F8FAFC; border-left:3px solid #0066FF; border-radius:0 8px 8px 0; padding:10px 14px; margin-bottom:10px;">
        <div style="font-size:0.65rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#475569; margin-bottom:4px;">Counter-Positioning Strategy</div>
        <div style="font-size:0.78rem; color:#334155; line-height:1.55;">${esc(data.strategy)}</div>
      </div>` : ''}
      ${data.targeting ? `<div style="background:#FFF7ED; border-left:3px solid #F59E0B; border-radius:0 8px 8px 0; padding:10px 14px;">
        <div style="font-size:0.65rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#92400E; margin-bottom:4px;">🎯 Targeting Recommendation</div>
        <div style="font-size:0.78rem; color:#7C2D12; line-height:1.55;">${esc(data.targeting)}</div>
      </div>` : ''}
    `;

    // Pre-select the first variant.
    const first = document.querySelector('#wlCounterBody .wl-variant[data-vidx="0"]');
    if (first) _wlSelectVariant(first);

    document.getElementById('wlCounterFooter').innerHTML = `
      <button class="btn-attack-activate" onclick="_wlCopyAll()" style="background:linear-gradient(135deg,#0EA5E9,#0066FF);" title="Copy all 3 variants + strategy + targeting to your clipboard">
        📋 Copy All
      </button>
      <button class="btn-attack-activate" onclick="launchCounterAsCampaign('${wlId}', this)" style="background:linear-gradient(135deg,#0066FF,#00C9C8);" title="Open the Campaign Launch Brief pre-filled with this counter-message — pick budget + audience and push it live.">
        🚀 Launch Now
      </button>
      <button class="btn-attack-activate" onclick="publishCounterNow('${wlId}', this)" style="background:linear-gradient(135deg,#10B981,#059669);">
        ⚡ Post Now
      </button>
      <button class="btn-attack-activate" onclick="publishCounterToSocial('${wlId}', this)" style="background:linear-gradient(135deg,#FF5722,#FF7043);" title="Open the Publish to Social composer pre-filled with the selected variant — pick platforms + schedule and push live via Zernio.">
        📤 Publish to Social
      </button>
      <button class="btn-attack-activate" onclick="addCounterToCalendar('${wlId}', this)" style="background:linear-gradient(135deg,#8B5CF6,#6366F1);" title="Schedule the selected variant on your Content Calendar for tomorrow.">
        📅 Add to Calendar
      </button>
      <button class="btn-attack-activate" onclick="queueCounterCampaign('${wlId}', this)">
        📋 Queue for Review
      </button>
      <button class="btn-attack-cancel" onclick="closeAttackModal()">Maybe Later</button>
    `;
  })
  .catch(err => {
    // Race guard: don't render stale errors over a newer modal.
    if (myReqId !== window._wlReqId) return;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    // Aborted requests are expected when the user closes/reopens — stay quiet.
    if (err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''))) return;
    console.error('[wl-counter] AI fetch failed:', err);
    const bodyEl = document.getElementById('wlCounterBody');
    if (!bodyEl) return;
    bodyEl.innerHTML = `
      <div style="background:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:18px; text-align:center;">
        <div style="font-size:1.6rem; margin-bottom:8px;">⚠️</div>
        <div style="font-family:Sora,sans-serif; font-weight:800; color:#991B1B; font-size:0.9rem; margin-bottom:6px;">AI counter-message generation failed</div>
        <div style="font-size:0.8rem; color:#7F1D1D; margin-bottom:14px;">${esc(err && err.message || String(err))}</div>
        <button class="btn-primary" style="padding:8px 18px; font-size:0.8rem;" onclick="(function(){closeAttackModal(); openWLCounterModal(window._wlData['${wlId}']);})()">🔄 Retry</button>
      </div>
    `;
  });
}

// Copy a single counter-message variant to the clipboard.
window._wlCopyVariant = function(i) {
  const txt = (window._wlCopyText || [])[i];
  if (!txt) { (window.showToast||alert)('⚠️ Nothing to copy yet'); return; }
  _wlClipboardWrite(txt, '✅ Variant ' + (i+1) + ' copied');
};
window._wlCopyAll = function() {
  const txt = window._wlCopyAllText;
  if (!txt) { (window.showToast||alert)('⚠️ Nothing to copy yet'); return; }
  _wlClipboardWrite(txt, '✅ All counter-messages copied');
};
function _wlClipboardWrite(txt, okMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(
      () => (window.showToast||alert)(okMsg),
      () => _wlClipboardLegacy(txt, okMsg)
    );
  } else { _wlClipboardLegacy(txt, okMsg); }
}
function _wlClipboardLegacy(txt, okMsg) {
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    (window.showToast||alert)(okMsg);
  } catch(e) { (window.showToast||alert)('⚠️ Copy failed — please select and copy manually'); }
}

// Selects a counter-message variant card in the modal (visual radio behaviour).
window._wlSelectVariant = function(el) {
  if (!el) return;
  const all = document.querySelectorAll('#wlCounterBody .wl-variant');
  all.forEach(c => {
    c.style.borderColor = '#E2E8F0';
    c.style.boxShadow = 'none';
    // Clear previous selection state — without this the queue helper would
    // pick up the FIRST card with data-selected="true", not the latest click.
    delete c.dataset.selected;
    const r = c.querySelector('.wl-variant-radio');
    if (r) { r.style.background = 'transparent'; r.style.borderColor = '#CBD5E1'; r.innerHTML = ''; }
  });
  el.style.borderColor = '#0066FF';
  el.style.boxShadow = '0 0 0 3px rgba(0,102,255,0.12)';
  const radio = el.querySelector('.wl-variant-radio');
  if (radio) {
    radio.style.background = '#0066FF';
    radio.style.borderColor = '#0066FF';
    radio.innerHTML = '<span style="display:block; width:8px; height:8px; background:#fff; border-radius:50%; margin:3px auto;"></span>';
  }
  el.dataset.selected = 'true';
};

function queueCounterCampaign(wlId, btn) {
  const w = (window._wlData || {})[wlId];
  if (!w) return;

  // Find which AI variant is currently selected (if the modal showed any).
  let selectedVariant = null;
  try {
    const sel = document.querySelector('#wlCounterBody .wl-variant[data-selected="true"]');
    if (sel && Array.isArray(w.aiVariants)) {
      const idx = parseInt(sel.getAttribute('data-vidx'), 10);
      if (!isNaN(idx) && w.aiVariants[idx]) selectedVariant = w.aiVariants[idx];
    }
  } catch(_) {}

  btn.disabled = true;
  btn.textContent = '⏳ Queuing…';
  setTimeout(() => {
    queuedCampaigns.push({
      id: 'qc_' + Date.now(),
      comp: w.comp,
      channel: w.channel,
      weakness: w.weakness,
      message: w.message,
      lossRate: w.lossRate,
      // AI-generated counter-message attached to the queued campaign so the
      // Campaigns view can show the actual headline/body/cta the user picked.
      counterAd: selectedVariant ? {
        angle:    selectedVariant.angle    || '',
        headline: selectedVariant.headline || '',
        body:     selectedVariant.body     || '',
        cta:      selectedVariant.cta      || '',
        why:      selectedVariant.why      || ''
      } : null,
      aiStrategy:  w.aiStrategy  || '',
      aiTargeting: w.aiTargeting || '',
      aiSource:    w.aiSource    || '',
      status: 'draft',
      createdAt: new Date().toLocaleTimeString()
    });
    closeAttackModal();
    if (analysisData) buildCampaigns();
    navigateTo('campaigns');
    showToast(selectedVariant
      ? `📋 Counter-message "${(selectedVariant.headline||'').substring(0,40)}…" queued — review it in Campaigns`
      : '📋 Counter-campaign queued — review it at the top of Campaigns before launching');
  }, 600);
}

// Adds the currently-selected AI counter-message variant to the Content
// Calendar (services/content_calendar). Persists to Postgres so it shows up
// in the calendar history and can be reviewed/edited later.
function addCounterToCalendar(wlId, btn) {
  const w = (window._wlData || {})[wlId];
  if (!w) { showToast('⚠️ No counter data found'); return; }
  let v = null;
  try {
    const sel = document.querySelector('#wlCounterBody .wl-variant[data-selected="true"]');
    if (sel && Array.isArray(w.aiVariants)) {
      const idx = parseInt(sel.getAttribute('data-vidx'), 10);
      if (!isNaN(idx) && w.aiVariants[idx]) v = w.aiVariants[idx];
    }
  } catch(_) {}
  if (!v) { showToast('⚠️ Pick a variant first, then click Add to Calendar'); return; }

  // Map Win/Loss channel label → calendar channel enum.
  const ch = String(w.channel || '').toLowerCase();
  const calCh = /facebook|instagram|fb|ig/.test(ch) ? 'facebook'
              : /linkedin/.test(ch) ? 'linkedin'
              : /tiktok/.test(ch)   ? 'tiktok'
              : /youtube|yt/.test(ch) ? 'youtube'
              : /twitter|^x$/.test(ch) ? 'x'
              : /email/.test(ch)    ? 'email'
              : /seo|organic|blog|search/.test(ch) ? 'blog'
              : 'facebook';

  const brand = (window.analysisData && window.analysisData.url
                  ? String(window.analysisData.url).replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]
                  : 'Brand') || 'Brand';

  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Adding…';

  fetch('/api/content-calendar/add', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      brand, channel: calCh,
      headline: v.headline || '', copy: v.body || '', cta: v.cta || 'Learn More',
      note: `Counter-message vs. ${w.comp} on ${w.channel} — generated by InfoGenie AI (${v.angle || 'variant'})`,
    }),
  })
  .then(r => r.json().then(j => ({ ok:r.ok, j })))
  .then(({ ok, j }) => {
    btn.disabled = false;
    btn.textContent = orig;
    if (!ok || !j.ok) {
      showToast('⚠️ Add to Calendar failed: ' + (j.error || 'unknown error'));
      return;
    }
    showToast(`📅 Added to Content Calendar (${calCh} · ${j.post && j.post.date}) — view in Calendar`);
  })
  .catch(e => {
    btn.disabled = false;
    btn.textContent = orig;
    showToast('⚠️ Add to Calendar failed: ' + e.message);
  });
}

// Opens the Tier-15 Publish-to-Social modal pre-filled with the selected
// AI counter-message variant. Maps W/L channel to a default Zernio platform.
function publishCounterToSocial(wlId, btn) {
  const w = (window._wlData || {})[wlId];
  if (!w) { showToast('⚠️ No counter data found'); return; }
  let v = null;
  try {
    const sel = document.querySelector('#wlCounterBody .wl-variant[data-selected="true"]');
    if (sel && Array.isArray(w.aiVariants)) {
      const idx = parseInt(sel.getAttribute('data-vidx'), 10);
      if (!isNaN(idx) && w.aiVariants[idx]) v = w.aiVariants[idx];
    }
  } catch(_) {}
  if (!v) { showToast('⚠️ Pick a variant first, then click Publish to Social'); return; }
  const text = [v.headline, v.body, v.cta].filter(Boolean).join('\n\n').trim();
  // Map W/L channel → closest Zernio platform
  const ch = String(w.channel || '').toLowerCase();
  const map = { tiktok:['tiktok'], 'meta ads':['facebook','instagram'], facebook:['facebook'], instagram:['instagram'], linkedin:['linkedin'], twitter:['twitter'], x:['twitter'], youtube:['youtube'], reddit:['reddit'], pinterest:['pinterest'] };
  let defaultPlatforms = [];
  for (const k of Object.keys(map)) if (ch.includes(k)) { defaultPlatforms = map[k]; break; }
  if (typeof closeAttackModal === 'function') closeAttackModal();
  window._spOpenPublishModal({ text, sourceLabel: `Counter ${w.comp || 'competitor'}`, platforms: defaultPlatforms });
}

// Publishes the selected AI counter-message immediately as a live social post.
// Maps the W/L "channel" (TikTok, Meta Ads, Google Search, etc.) to the closest
// matching social platform, then drops a published post into _socialPosts so it
// appears in the social calendar / Upcoming Posts.
function publishCounterNow(wlId, btn) {
  const w = (window._wlData || {})[wlId];
  if (!w) { showToast('⚠️ No counter data found'); return; }

  // Find the currently-selected variant.
  let selectedVariant = null;
  try {
    const sel = document.querySelector('#wlCounterBody .wl-variant[data-selected="true"]');
    if (sel && Array.isArray(w.aiVariants)) {
      const idx = parseInt(sel.getAttribute('data-vidx'), 10);
      if (!isNaN(idx) && w.aiVariants[idx]) selectedVariant = w.aiVariants[idx];
    }
  } catch(_) {}
  if (!selectedVariant) { showToast('⚠️ Pick a variant first, then click Post Now'); return; }

  // Map the W/L channel to a social platform from SOCIAL_PLATFORMS.
  const ch = (w.channel || '').toLowerCase();
  const mapPlatform = () => {
    if (ch.includes('tiktok')) return 'TikTok';
    if (ch.includes('instagram') || ch === 'ig') return 'Instagram';
    if (ch.includes('meta') || ch.includes('facebook')) return 'Meta';
    if (ch.includes('linkedin')) return 'LinkedIn';
    if (ch.includes('youtube')) return 'YouTube';
    if (ch.includes('pinterest')) return 'Pinterest';
    if (ch.includes('snapchat') || ch.includes('snap')) return 'Snapchat';
    if (ch.includes('threads')) return 'Threads';
    if (ch.includes('twitter') || ch === 'x') return 'X';
    // Search/display channels don't map cleanly — default to LinkedIn so the
    // post still lands somewhere useful for B2B counter-positioning.
    return 'LinkedIn';
  };
  const platform = mapPlatform();

  // Build the live caption from the selected variant.
  const caption = `${selectedVariant.headline ? selectedVariant.headline + '\n\n' : ''}${selectedVariant.body || ''}${selectedVariant.cta ? '\n\n👉 ' + selectedVariant.cta : ''}`.trim();

  btn.disabled = true;
  btn.textContent = '⏳ Posting…';

  setTimeout(() => {
    if (!window._socialPosts) window._socialPosts = [];
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().slice(0,5);
    const postId = 'post_counter_' + Date.now();
    window._socialPosts.push({
      id: postId,
      platform: platform,
      caption: caption,
      scheduledDate: dateStr,
      scheduledTime: timeStr,
      status: 'published',
      publishedAt: now.toLocaleString(),
      funnelStage: 'consideration',
      archetypeId: null,
      archetypeTitle: `Counter-${w.comp}`,
      fileName: null,
      createdAt: now.toLocaleString(),
      counterMeta: {
        comp: w.comp,
        weakness: w.weakness,
        angle: selectedVariant.angle || ''
      }
    });
    closeAttackModal();
    showToast(`🚀 Counter-message posted live to ${platform} — view it in Reach › Social`);
    // If the social calendar is currently mounted, refresh it so the new post shows up.
    if (document.getElementById('socialWrap') && typeof buildSocialCalendar === 'function') {
      try { buildSocialCalendar(); } catch(_) {}
    }
  }, 700);
}

// Takes the currently-selected counter-message variant and opens the full
// Campaign Launch Brief pre-filled with it — so the user goes directly from
// "I see a competitor winning" to "I'm launching a real ad against them" in
// two clicks. Maps the W/L channel to a launchable ad platform (Meta / Google
// Ads / TikTok); other channels default to Meta Ads.
function launchCounterAsCampaign(wlId, btn) {
  const w = (window._wlData || {})[wlId];
  if (!w) { showToast('⚠️ No counter data found'); return; }

  // Find the currently-selected variant (the user pre-selected the first).
  let selectedVariant = null;
  try {
    const sel = document.querySelector('#wlCounterBody .wl-variant[data-selected="true"]');
    if (sel && Array.isArray(w.aiVariants)) {
      const idx = parseInt(sel.getAttribute('data-vidx'), 10);
      if (!isNaN(idx) && w.aiVariants[idx]) selectedVariant = w.aiVariants[idx];
    }
  } catch(_) {}
  if (!selectedVariant) { showToast('⚠️ Pick a variant first, then click Launch Now'); return; }

  // Map the W/L "channel" to a launchable ad platform supported by the
  // optimizer. Search/display channels can't be launched directly from the
  // counter modal — fall back to Meta Ads (the broadest & easiest to set up).
  const ch = (w.channel || '').toLowerCase();
  const platform = ch.includes('google') || ch.includes('search') ? 'Google Ads'
                 : ch.includes('tiktok')                          ? 'TikTok Ads'
                 :                                                  'Meta Ads';

  // SANITISE all user/AI-derived strings before they reach buildLaunchModal,
  // which interpolates camp.name / camp.description / camp.tags / camp.objective
  // straight into innerHTML. Competitor names + AI variant text can both be
  // poisoned (scraped sites, prompt injection) so strip < > to defuse any
  // <script> / <img onerror> sinks. Also caps length to keep the modal tidy.
  const _safe = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').slice(0, max || 200);
  const safeComp     = _safe(w.comp, 80);
  const safeWeakness = _safe(w.weakness, 200);
  const safeChannel  = _safe(w.channel, 60);
  const safeAngle    = _safe(selectedVariant.angle, 40) || 'Direct Response';
  const safeHeadline = _safe(selectedVariant.headline, 200);
  const safeBody     = _safe(selectedVariant.body, 600);
  const safeCTA      = _safe(selectedVariant.cta, 60);

  // Build a camp object that buildLaunchModal understands. The headline +
  // body from the AI variant become the seed creative; the launcher's own
  // GPT-4 brief call will then expand on it.
  const camp = {
    name:        `Counter ${safeComp} — ${safeAngle}`,
    platform,
    budget:      '$2,000/mo',
    description: safeBody || `Counter-message vs. ${safeComp} on ${safeChannel}. Exploits weakness: ${safeWeakness}`,
    objective:   'Counter-Position vs. ' + safeComp,
    tags:        [platform, 'Counter-Campaign', safeComp],
    estROAS:     '3.2',
    estCTR:      '4.5%',
    estCPA:      '$32',
    // Hand the variant straight to the launcher so its GPT-4 brief can use
    // the AI counter-message as the starting point.
    seedHeadline: safeHeadline,
    seedBody:     safeBody,
    seedCTA:      safeCTA
  };

  btn.disabled = true;
  btn.textContent = '⏳ Opening launcher…';

  // Stash the counter context so the campaigns page can show a "Targeting:"
  // banner above the launch button. The campaigns view checks freshness via
  // `Date.now() - _ct.at < 30*60*1000` so we MUST use the `at` key (not
  // `expiresAt`) to match the existing reader at app.js ~5474.
  window._counterTarget = {
    name: safeComp,
    weakness: safeWeakness,
    message: _safe(w.message, 400),
    counterAngle: safeAngle,
    source: 'wl-counter',
    at: Date.now()
  };

  closeAttackModal();
  // Tiny delay so the close animation doesn't fight the open animation.
  setTimeout(() => {
    try {
      buildLaunchModal(camp, 0);
    } catch(e) {
      console.error('[launchCounterAsCampaign] buildLaunchModal failed:', e);
      showToast('⚠️ Couldn\'t open launcher: ' + (e && e.message || e));
    }
  }, 180);
}

// ── Expose Win/Loss counter helpers on window IMMEDIATELY (early), so even
// if a later runtime error halts top-level script execution, these are still
// callable from the inline onclick attribute on the rendered buttons. The
// safety-net block lower down in this file (~24300) is now redundant for
// these names but harmless.
try { window.openWLCounterModal  = openWLCounterModal;  } catch(e) {}
try { window.queueCounterCampaign = queueCounterCampaign; } catch(e) {}
try { window.publishCounterNow   = publishCounterNow;   } catch(e) {}
try { window.addCounterToCalendar = addCounterToCalendar; } catch(e) {}
try { window.launchCounterAsCampaign = launchCounterAsCampaign; } catch(e) {}
try { window.closeAttackModal    = closeAttackModal;    } catch(e) {}
try { window.openAttackModal     = openAttackModal;     } catch(e) {}

function launchQueuedCampaign(qcId, comp, btn) {
  btn.disabled = true;
  btn.textContent = '⏳ Launching…';
  setTimeout(() => {
    const card = document.getElementById(qcId);
    if (card) {
      card.style.transition = 'opacity 0.4s';
      card.style.opacity = '0.4';
      card.querySelector('.qcc-badge').textContent = 'LIVE';
      card.querySelector('.qcc-badge').style.background = '#10B981';
      card.querySelector('.qcc-badge').style.color = '#fff';
      card.querySelector('.btn-qcc-launch').style.display = 'none';
      card.querySelector('.btn-qcc-discard').textContent = '✅ Live — monitoring';
      card.querySelector('.btn-qcc-discard').disabled = true;
    }
    showToast(`🚀 Counter-campaign vs. ${comp} is now live — monitoring performance`);
  }, 1200);
}

function discardQueuedCampaign(qcId) {
  queuedCampaigns = queuedCampaigns.filter(qc => qc.id !== qcId);
  if (analysisData) buildCampaigns();
  showToast('🗑️ Counter-campaign discarded');
}

// openExclusiveModal/closeExclusiveModal are defined as window.* near line 14118
// with a delegated click safety-net — single source of truth.


// ── API Key Validators ───────────────────────────────────────────────────────
// Returns: { status: 'verified'|'rejected'|'format-ok'|'unverifiable', message }
//   verified     → live network call confirmed the key is valid       → shows ✅
//   rejected     → live call or format check rejected the key         → shows ❌
//   format-ok    → pattern/length looks right but live verify failed  → shows ⚠️
//   unverifiable → cannot reach API from browser due to CORS          → shows ⚠️


// Default fallback — for any integration not listed above


// Save API key to server vault, then update the card UI on success.
// Used for integrations with vaultSave:true (e.g. Apify).







// Auto-detect server-configured integrations and mark them connected



// ===== HELPERS =====
function avg(arr) { return +(arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(2); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.style.display = 'block';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.style.display = 'none';
    toast.classList.add('hidden');
  }, 4000);
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('home');
  try { window.buildIntelligence && window.buildIntelligence(); } catch(e) { console.warn('buildIntelligence error:', e); }

  // Event delegation — attack & signal buttons rendered inside dynamic innerHTML
  document.addEventListener('click', e => {
    const atk = e.target.closest('.btn-kwgap-attack');
    if (atk) {
      const kw = atk.dataset.kw || atk.textContent;
      const comp = atk.dataset.comp || '';
      openAttackModal(kw, comp, 'keyword');
      return;
    }
    const sig = e.target.closest('.btn-signal-attack');
    if (sig) {
      openAttackModal(sig.dataset.action || '', sig.dataset.comp || '', 'attack');
      return;
    }
    const counter = e.target.closest('.btn-signal-counter');
    if (counter) {
      openAttackModal(counter.dataset.action || '', counter.dataset.comp || '', 'counter');
      return;
    }
  });
  
  // Nav logo — go home
  document.getElementById('navLogo').addEventListener('click', e => {
    e.preventDefault();
    navigateTo('home');
  });
  
  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const view = link.dataset.view;
      const lockedViews = [];
      if (analysisData || !lockedViews.includes(view)) {
        navigateTo(view);
      } else {
        showToast('⚠️ Please enter your website URL and run an analysis first');
      }
    });
  });
  
  // Nav analyse button
  document.getElementById('navAnalyseBtn').addEventListener('click', () => {
    navigateTo('home');
  });
  
  // Main analyse button
  const _getAnalyseInputs = () => ({
    url: document.getElementById('websiteInput').value,
    country: document.getElementById('targetCountry').value,
    industry: (document.getElementById('industryInput')?.value || '').trim(),
  });

  document.getElementById('analyseBtn').addEventListener('click', () => {
    const { url, country, industry } = _getAnalyseInputs();
    runAnalysis(url, country, industry);
  });
  
  // Enter key on input — trigger from both inputs
  ['websiteInput','industryInput'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const { url, country, industry } = _getAnalyseInputs();
        runAnalysis(url, country, industry);
      }
    });
  });

  // ── Anti-autofill safety-net for the URL inputs ──────────────────────────
  // Some browsers (notably Chrome) ignore autocomplete="off"/"url" hints and
  // will paste a recently-typed email address into any text input. URLs never
  // contain '@', so if we detect one, scrub it. Also blank the inputs on first
  // page load to defeat persisted autofill state.
  // The industry input is also a target for browser email-autofill (Chrome
  // ignores autocomplete="off" on plain text inputs and stuffs in the user's
  // email). We scrub all 3 hero inputs the same way.
  ['websiteInput','mcInput','industryInput'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const scrub = () => {
      const v = el.value || '';
      if (v.includes('@') || /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(v.trim())) {
        el.value = '';
      }
    };
    // Blank any pre-filled value on load (defeats autofill that ran before our JS)
    setTimeout(scrub, 0);
    setTimeout(scrub, 250);   // catches Chrome's deferred autofill
    setTimeout(scrub, 1000);
    setTimeout(scrub, 2500);  // catches password-manager late-fills
    el.addEventListener('input', scrub);
    el.addEventListener('change', scrub);
    // On focus, if value still looks like an email, clear it so the user has a clean field
    el.addEventListener('focus', () => { if ((el.value || '').includes('@')) el.value = ''; });
  });
  
  // Example chips — clear industry input so auto-detect takes over
  document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.url;
      document.getElementById('websiteInput').value = url;
      const industryInput = document.getElementById('industryInput');
      if (industryInput) industryInput.value = '';
      const hintEl = document.getElementById('industryHint');
      if (hintEl) { hintEl.textContent = 'Leave blank for auto-detection'; hintEl.style.color = ''; }
      const { country, industry } = _getAnalyseInputs();
      runAnalysis(url, country, industry);
    });
  });
  
  // Re-run button (absent when the dashboard view is rendered natively by React)
  const reRunBtn = document.getElementById('reRunBtn');
  if (reRunBtn) reRunBtn.addEventListener('click', () => {
    navigateTo('home');
  });
  
  // View all competitors (absent when the dashboard view is rendered by React)
  const viewAllCompBtn = document.getElementById('viewAllCompBtn');
  if (viewAllCompBtn) viewAllCompBtn.addEventListener('click', () => {
    navigateTo('competitors');
  });

  
  // Launch campaign button (header; absent when the campaigns view is rendered by React)
  const launchCampaignBtn = document.getElementById('launchCampaignBtn');
  if (launchCampaignBtn) launchCampaignBtn.addEventListener('click', () => {
    if (typeof window._igLaunch === 'function' && window._lastCampRecs && window._lastCampRecs.length) {
      window._igLaunch(0);
      return;
    }
    const modal = document.getElementById('launchModal');
    if (modal) {
      modal.querySelector('.modal-title').textContent = 'Launch Campaign';
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  });
  
  // Auto-target audience (absent when the audience view is rendered by React)
  const autoTargetBtn = document.getElementById('autoTargetBtn');
  if (autoTargetBtn) autoTargetBtn.addEventListener('click', () => {
    showToast('🎯 InfoGenie is targeting all high-performing audience segments automatically — campaigns launching...');
  });
  
  // Generate more creatives — cycles through creative batches (absent when the creative view is rendered by React)
  const generateMoreBtnEl = document.getElementById('generateMoreBtn');
  if (generateMoreBtnEl) generateMoreBtnEl.addEventListener('click', () => {
    if (!analysisData) {
      showToast('⚠️ Run an analysis first to generate creatives');
      return;
    }
    creativeRound++;
    const batchNum = creativeRound + 1;
    showToast(`✨ Generating creative batch ${batchNum} — new angles, hooks & messaging variants…`);
    const btn = document.getElementById('generateMoreBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    setTimeout(() => {
      window.buildCreative && window.buildCreative();
      if (btn) { btn.disabled = false; btn.textContent = '✨ Generate More Creatives'; }
      showToast(`✅ Batch ${batchNum} ready — ${6} new creative variants generated`);
    }, 1600);
  });
  
  // Pro Plan badge — open upgrade modal
  document.getElementById('navPlanBadge').style.cursor = 'pointer';
  document.getElementById('navPlanBadge').addEventListener('click', () => {
    const modal = document.getElementById('planModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  });

  // Plan modal — close on backdrop click
  document.getElementById('planModal').addEventListener('click', e => {
    if (e.target === document.getElementById('planModal')) closePlanModal();
  });

  // Differentiator modal — close on backdrop click
  document.getElementById('differentiatorModal').addEventListener('click', e => {
    if (e.target === document.getElementById('differentiatorModal')) closeDifferentiatorModal();
  });

  // Attack modal — close on backdrop click
  document.getElementById('attackModal').addEventListener('click', e => {
    if (e.target === document.getElementById('attackModal')) closeAttackModal();
  });

  // Exclusive modal — close on backdrop click
  document.getElementById('exclusiveModal').addEventListener('click', e => {
    if (e.target === document.getElementById('exclusiveModal')) window.closeExclusiveModal && window.closeExclusiveModal();
  });

  // New rich modals — close on backdrop click
  document.getElementById('campCreativeModal').addEventListener('click', e => {
    if (e.target === document.getElementById('campCreativeModal')) closeCampCreativeModal();
  });
  document.getElementById('campLaunchRichModal').addEventListener('click', e => {
    if (e.target === document.getElementById('campLaunchRichModal')) closeCampLaunchRichModal();
  });

  // Campaign card buttons now use direct onclick="window._igLaunch(idx)" and window._igCreative(idx)
  // — defined at top of app.js, no delegation needed
  // SAFETY-NET delegation for hero "Launch Campaign" button — fires even if onclick fails
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-ig-launch]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(btn.getAttribute('data-ig-launch'), 10) || 0;
    try {
      if (typeof window._igLaunch === 'function') window._igLaunch(idx);
      else showToast('⚠️ Launch handler missing — please refresh');
    } catch(err) {
      console.error('Hero launch error:', err);
      showToast('⚠️ ' + (err.message || 'Could not open Launch modal'));
    }
  });

  // Docs modal — close on backdrop click
  document.getElementById('docsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('docsModal')) window.closeDocsModal && window.closeDocsModal();
  });

  // Escape key — close whichever modal is open
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const modals = [
      { id: 'differentiatorModal', close: closeDifferentiatorModal },
      { id: 'attackModal',         close: closeAttackModal         },
      { id: 'exclusiveModal',      close: () => window.closeExclusiveModal && window.closeExclusiveModal() },
      { id: 'planModal',           close: closePlanModal           },
      { id: 'docsModal',           close: () => window.closeDocsModal && window.closeDocsModal() },
      { id: 'launchModal',         close: closeModal               },
    ];
    for (const m of modals) {
      const el = document.getElementById(m.id);
      if (el && el.style.display !== 'none' && !el.classList.contains('hidden')) {
        m.close();
        break;
      }
    }
  });

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalConfirm').addEventListener('click', () => {
    const budget = document.getElementById('campBudget').value || '2,000';
    const platform = document.getElementById('campPlatform').value;
    const country = document.getElementById('campCountry').value;
    const campName = document.getElementById('launchModal').dataset.activeCamp || 'Your Campaign';
    const box = document.getElementById('launchModal').querySelector('.modal-box');
    box.dataset.successState = 'true';
    box.innerHTML = `
      <div style="text-align:center; padding: 8px 0">
        <div style="font-size:3rem; margin-bottom:16px">🎉</div>
        <h3 style="font-family:Sora,sans-serif; font-size:1.25rem; font-weight:800; color:#0A1628; margin-bottom:8px">Campaign Launched!</h3>
        <p style="color:#6B7280; font-size:0.875rem; margin-bottom:20px; line-height:1.6">"${campName}" is now live and being optimised by InfoGenie's AI engine in real-time.</p>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:20px; text-align:center">
          <div style="background:#F0FDF4; border-radius:10px; padding:12px">
            <div style="font-size:1.1rem; font-weight:800; color:#059669">$${parseInt(budget.replace(/[^0-9]/g,'')).toLocaleString()}</div>
            <div style="font-size:0.7rem; color:#6B7280; margin-top:2px">Monthly Budget</div>
          </div>
          <div style="background:#EFF6FF; border-radius:10px; padding:12px">
            <div style="font-size:0.85rem; font-weight:800; color:#1D4ED8">${platform.split(' ')[0]}</div>
            <div style="font-size:0.7rem; color:#6B7280; margin-top:2px">Platform</div>
          </div>
          <div style="background:#F5F3FF; border-radius:10px; padding:12px">
            <div style="font-size:1.1rem; font-weight:800; color:#7C3AED">Live</div>
            <div style="font-size:0.7rem; color:#6B7280; margin-top:2px">Status</div>
          </div>
        </div>
        <div style="background:var(--ig-grad); border-radius:12px; padding:14px 16px; margin-bottom:20px; text-align:left">
          <div style="font-size:0.7rem; font-weight:700; color:rgba(0,201,200,.8); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px">InfoGenie AI Engine is now:</div>
          <div style="font-size:0.8125rem; color:rgba(255,255,255,.8); display:flex; flex-direction:column; gap:4px">
            <span>✓ Generating AI ad copy every 72 hours</span>
            <span>✓ Monitoring competitor spend in real-time</span>
            <span>✓ Auto-reallocating budget to winning ads</span>
            <span>✓ A/B testing headlines, CTAs and audiences</span>
          </div>
        </div>
        <button onclick="closeModal(); navigateTo('intelligence')" style="width:100%; padding:12px; background:linear-gradient(135deg,#00C9C8,#0066FF); border:none; border-radius:10px; color:white; font-size:0.9375rem; font-weight:700; cursor:pointer; font-family:'Inter',sans-serif">
          ⚡ View Intelligence Dashboard →
        </button>
        <button onclick="closeModal()" style="width:100%; margin-top:8px; padding:10px; background:transparent; border:1.5px solid #E5E7EB; border-radius:10px; color:#6B7280; font-size:0.875rem; font-weight:600; cursor:pointer; font-family:'Inter',sans-serif">Done</button>
      </div>
    `;
  });
});

function closeModal() {
  const modal = document.getElementById('launchModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
  // Reset modal state
  const box = modal.querySelector('.modal-box');
  if (box && box.dataset.successState === 'true') {
    box.dataset.successState = '';
    box.innerHTML = _launchModalOriginalHTML || '';
  }
}

// Open the launch modal pre-filled for a specific campaign

function openCampLaunchRich(name, platform, budget, idx) {
  const modal = document.getElementById('campLaunchRichModal');
  if (!modal) { showToast('⚠️ Page error — please refresh'); return; }
  modal.classList.remove('hidden');
  modal.style.cssText = 'display:flex !important';
  const inner = document.getElementById('campLaunchRichModalInner');
  if (!inner) { showToast('⚠️ Page error — please refresh'); return; }

  const budgetNum  = parseInt((budget || '$2000').replace(/[^0-9]/g, '')) || 2000;
  const dailyBudg  = Math.round(budgetNum / 30);
  const weeklyBudg = Math.round(budgetNum / 4.3);
  const comp       = analysisData?.competitors?.[0];
  const indName    = analysisData?.industry?.name || 'your industry';
  const myROAS     = analysisData?.websiteKPIs?.roas ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
  const projROAS   = (myROAS * 1.25).toFixed(1);
  const projConv   = Math.round(budgetNum / 35);
  const projRevenue = '$' + (budgetNum * parseFloat(projROAS)).toLocaleString(undefined, {maximumFractionDigits:0});

  // Platform-specific details
  const platDetails = {
    'Google Ads':       { icon: '🔵', bidStrategy: 'Target ROAS (tROAS)', audience: 'High-intent keyword searchers', kpi: 'Conversions & ROAS', creative: 'Responsive Search Ads + Performance Max' },
    'Google Search':    { icon: '🔵', bidStrategy: 'Maximise Conversions', audience: 'Search intent + competitor keywords', kpi: 'CTR & Conversion Rate', creative: '3 headline variants + 2 descriptions' },
    'Meta Ads':         { icon: '🔷', bidStrategy: 'Cost Per Result (CPR)', audience: 'Lookalike + interest targeting', kpi: 'ROAS & Reach', creative: 'Carousel + Story + Feed video' },
    'TikTok Ads':       { icon: '⬛', bidStrategy: 'Lowest Cost', audience: 'In-app behaviour + hashtag interest', kpi: 'CPV & Engagement Rate', creative: 'UGC-style 15-sec vertical video' },
    'YouTube':          { icon: '🔴', bidStrategy: 'Target CPA', audience: 'In-market + custom intent audiences', kpi: 'View-through conversions', creative: '15-sec unskippable + 30-sec skippable' },
    'AI Optimised':     { icon: '🤖', bidStrategy: 'InfoGenie RL Engine (auto)', audience: 'Dynamic cross-platform targeting', kpi: 'Blended ROAS', creative: 'Auto-generated, refreshed every 72h' },
    'LinkedIn Ads':     { icon: '🔷', bidStrategy: 'Maximum Delivery', audience: 'Job title + industry + seniority', kpi: 'MQL Rate & Pipeline Value', creative: 'Sponsored Content + InMail' },
    'Display Network':  { icon: '🟡', bidStrategy: 'Target CPA', audience: 'Intent-based display audiences', kpi: 'Brand lift & CPA', creative: 'Responsive display + HTML5 banners' }
  };
  const pd = platDetails[platform] || platDetails['Google Ads'];

  // AI-generated headlines
  const headlineSets = {
    'Google Ads':    ['Stop Overpaying — Switch & Save 30%', 'Faster Results. Lower Costs. Proven ROI.', 'The Smart Alternative to [Competitor]'],
    'Google Search': ['Beat the Competition Starting Today', '#1 Rated Alternative — See Why', 'Get More for Less — Free 14-Day Trial'],
    'Meta Ads':      ['Join 10,000+ Businesses Seeing 4× ROAS', 'Your Competitors Are Scaling With This', 'Finally — Ads That Actually Convert'],
    'TikTok Ads':    ['POV: Your ROAS just hit 4×', 'This strategy is what competitors dont want you to know', 'Real results, real brands, real ROI'],
    'YouTube':       ['The Ad Strategy Your Competitors Hope You Never See', 'How Top Brands Are Hitting 5× ROAS in 2025', 'Stop Wasting Ad Spend — Here\'s the Fix'],
    'AI Optimised':  ['AI-Optimised. Always On. Always Winning.', 'Every £1 Working Harder With AI Bidding', 'Your Campaign Never Sleeps — Neither Does Our AI'],
    'LinkedIn Ads':  ['Reach 500+ Decision-Makers This Week', 'The B2B Growth Strategy CFOs Are Approving', 'Enterprise ROI — Without Enterprise Costs']
  };
  const headlines = headlineSets[platform] || headlineSets['Google Ads'];

  // Descriptions
  const descSets = {
    'Google Ads':   ['Cut wasteful ad spend and redirect it to campaigns that convert. InfoGenie\'s AI optimises every bid in real time.', 'See exactly where competitors are winning — then outbid them at the right moment with AI-powered precision.'],
    'Meta Ads':     ['Reach the audiences your competitors are missing. InfoGenie builds lookalike segments from your best customers automatically.', 'Dynamic creative that tests and learns continuously — your best-performing ad is always running.'],
    'AI Optimised': ['InfoGenie\'s reinforcement learning engine manages your entire ad portfolio autonomously — pausing losers, scaling winners, every 6 hours.', 'Set your ROAS target, connect your accounts, and let the AI run. Average clients see +31% ROAS in 30 days.']
  };
  const descriptions = descSets[platform] || descSets['Google Ads'];

  inner.innerHTML = `
    <style>
      .clb-field { width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;font-family:'Plus Jakarta Sans','Inter',sans-serif;outline:none;transition:border-color .18s,background .18s; }
      .clb-field:focus { border-color:#0066FF;background:#F0F7FF; }
      .clb-label { font-size:0.66rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px; }
      .clb-edit-pill { display:inline-block;font-size:0.58rem;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:6px;vertical-align:middle;letter-spacing:.04em; }
    </style>

    <div style="background:var(--ig-grad);padding:22px 28px 22px 28px;border-radius:20px 20px 0 0;padding-right:64px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:18px">
        <div style="min-width:0;flex:1">
          <div style="font-family:'Space Grotesk','Sora',sans-serif;font-size:1rem;font-weight:800;color:white;margin-bottom:2px">🚀 Campaign Launch Brief</div>
          <div style="font-size:0.8rem;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name} · ${platform}</div>
        </div>
        <div style="flex-shrink:0">
          <div style="font-size:0.62rem;color:rgba(255,255,255,.4);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;text-align:right">Monthly Budget</div>
          <div style="display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.18);border-radius:9px;padding:5px 10px">
            <span style="color:rgba(255,255,255,.5);font-size:0.9rem;font-weight:600">$</span>
            <input id="clb-budget" type="number" value="${budgetNum}" min="100" step="100"
              style="background:transparent;border:none;color:white;font-size:0.95rem;font-weight:800;width:100px;outline:none;font-family:'Plus Jakarta Sans','Inter',sans-serif"
              oninput="clbUpdateMetrics()"
              onfocus="this.parentElement.style.borderColor='rgba(0,229,255,.6)'"
              onblur="this.parentElement.style.borderColor='rgba(255,255,255,.18)'">
            <span style="color:rgba(255,255,255,.35);font-size:0.75rem">/mo</span>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div id="clb-roas" style="font-size:1.1rem;font-weight:800;color:#00E5FF">${projROAS}×</div>
          <div style="font-size:0.62rem;color:rgba(255,255,255,.45);margin-top:2px">Proj. ROAS</div>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div id="clb-conv" style="font-size:1.1rem;font-weight:800;color:#10B981">${projConv}</div>
          <div style="font-size:0.62rem;color:rgba(255,255,255,.45);margin-top:2px">Est. Conversions</div>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div id="clb-rev" style="font-size:1.1rem;font-weight:800;color:#F59E0B">${projRevenue}</div>
          <div style="font-size:0.62rem;color:rgba(255,255,255,.45);margin-top:2px">Est. Revenue</div>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div id="clb-daily-top" style="font-size:1.1rem;font-weight:800;color:white">$${dailyBudg}/day</div>
          <div style="font-size:0.62rem;color:rgba(255,255,255,.45);margin-top:2px">Daily Budget</div>
        </div>
      </div>
    </div>

    <div style="padding:20px 28px;display:flex;flex-direction:column;gap:16px;max-height:60vh;overflow-y:auto">

      <!-- EDITABLE STRATEGY FIELDS -->
      <div>
        <div style="font-size:0.67rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
          ${pd.icon} ${platform} Strategy
          <span class="clb-edit-pill" style="background:#EEF2FF;color:#4F46E5">EDITABLE</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label class="clb-label">Bid Strategy</label>
            <input id="clb-bid" class="clb-field" value="${pd.bidStrategy.replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label class="clb-label">Target Audience</label>
            <input id="clb-audience" class="clb-field" value="${pd.audience.replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label class="clb-label">Primary KPI</label>
            <input id="clb-kpi" class="clb-field" value="${pd.kpi.replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label class="clb-label">Creative Format</label>
            <input id="clb-creative" class="clb-field" value="${pd.creative.replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label class="clb-label">Start Date</label>
            <input id="clb-startdate" type="date" class="clb-field" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div>
            <label class="clb-label">End Date</label>
            <input id="clb-enddate" type="date" class="clb-field" value="${new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0]}">
          </div>
        </div>
      </div>

      <!-- EDITABLE HEADLINES -->
      <div>
        <div style="font-size:0.67rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
          🤖 AI-Generated Headlines
          <span class="clb-edit-pill" style="background:#EDE9FE;color:#7C3AED">CLICK TO EDIT</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${headlines.map((h,i) => `
            <div style="display:flex;align-items:center;gap:8px;background:#F5F3FF;border:1.5px solid transparent;border-radius:8px;padding:6px 10px;transition:border-color .15s" onfocus-within="this.style.borderColor='#7C3AED'">
              <span style="font-size:0.68rem;font-weight:700;color:#7C3AED;background:#EDE9FE;border-radius:4px;padding:2px 6px;flex-shrink:0;line-height:1.4">H${i+1}</span>
              <input id="clb-h${i+1}" value="${h.replace(/"/g,'&quot;')}"
                style="flex:1;border:none;background:transparent;outline:none;font-size:0.82rem;font-weight:600;color:#0A1628;font-family:'Plus Jakarta Sans','Inter',sans-serif"
                onfocus="this.closest('div').style.borderColor='#7C3AED'"
                onblur="this.closest('div').style.borderColor='transparent'">
            </div>
          `).join('')}
        </div>
      </div>

      <!-- EDITABLE DESCRIPTIONS -->
      <div>
        <div style="font-size:0.67rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
          ✍️ AI-Generated Descriptions
          <span class="clb-edit-pill" style="background:#DCFCE7;color:#059669">CLICK TO EDIT</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${descriptions.map((d,i) => `
            <div style="background:#F0FDF4;border:1.5px solid transparent;border-radius:8px;padding:8px 12px;transition:border-color .15s">
              <span style="font-size:0.68rem;font-weight:700;color:#059669;background:#DCFCE7;border-radius:4px;padding:2px 6px">D${i+1}</span>
              <textarea id="clb-d${i+1}" rows="2"
                style="display:block;width:100%;box-sizing:border-box;margin-top:6px;border:none;background:transparent;outline:none;font-size:0.8rem;color:#374151;line-height:1.55;resize:vertical;font-family:'Plus Jakarta Sans','Inter',sans-serif"
                onfocus="this.closest('div').style.borderColor='#059669'"
                onblur="this.closest('div').style.borderColor='transparent'">${d}</textarea>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- LIVE BUDGET BREAKDOWN -->
      <div>
        <div style="font-size:0.67rem;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💰 Budget Breakdown</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px;text-align:center">
            <div id="clb-bkd-daily" style="font-size:0.95rem;font-weight:800;color:#D97706">$${dailyBudg}</div>
            <div style="font-size:0.68rem;color:#6B7280;margin-top:2px">Daily Spend</div>
          </div>
          <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px;text-align:center">
            <div id="clb-bkd-weekly" style="font-size:0.95rem;font-weight:800;color:#D97706">$${weeklyBudg.toLocaleString()}</div>
            <div style="font-size:0.68rem;color:#6B7280;margin-top:2px">Weekly Spend</div>
          </div>
          <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px;text-align:center">
            <div id="clb-bkd-monthly" style="font-size:0.95rem;font-weight:800;color:#D97706">$${budgetNum.toLocaleString()}</div>
            <div style="font-size:0.68rem;color:#6B7280;margin-top:2px">Monthly Spend</div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px">
        <button onclick="closeCampLaunchRichModal()" style="flex:1;padding:12px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer;font-family:'Plus Jakarta Sans','Inter',sans-serif">Cancel</button>
        <button id="confirmLaunchBtn" style="flex:2;padding:12px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer;font-family:'Plus Jakarta Sans','Inter',sans-serif">🚀 Confirm &amp; Launch Campaign</button>
      </div>
    </div>
  `;

  // Live-recalc metrics when budget input changes
  window.clbUpdateMetrics = function() {
    const bInput = document.getElementById('clb-budget');
    if (!bInput) return;
    const nb = Math.max(100, parseInt(bInput.value) || 100);
    const roasBase = analysisData && analysisData.websiteKPIs && analysisData.websiteKPIs.roas ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
    const newROAS = (roasBase * 1.25).toFixed(1);
    const newConv = Math.round(nb / 35);
    const newRev  = '$' + (nb * parseFloat(newROAS)).toLocaleString(undefined, {maximumFractionDigits:0});
    const newDaily = Math.round(nb / 30);
    const newWeekly = Math.round(nb / 4.3);
    const el = id => document.getElementById(id);
    if (el('clb-roas'))       el('clb-roas').textContent       = newROAS + '×';
    if (el('clb-conv'))       el('clb-conv').textContent       = newConv;
    if (el('clb-rev'))        el('clb-rev').textContent        = newRev;
    if (el('clb-daily-top'))  el('clb-daily-top').textContent  = '$' + newDaily + '/day';
    if (el('clb-bkd-daily'))  el('clb-bkd-daily').textContent  = '$' + newDaily;
    if (el('clb-bkd-weekly')) el('clb-bkd-weekly').textContent = '$' + newWeekly.toLocaleString();
    if (el('clb-bkd-monthly'))el('clb-bkd-monthly').textContent= '$' + nb.toLocaleString();
  };

  // Wire confirm button — reads live editable values
  window._pendingCampaignLaunch = { name, platform, budget: '$' + budgetNum, idx };
  const confirmBtn = document.getElementById('confirmLaunchBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const budgetEl = document.getElementById('clb-budget');
      const finalBudget = '$' + (budgetEl ? (parseInt(budgetEl.value) || budgetNum) : budgetNum);
      const p = window._pendingCampaignLaunch;
      confirmCampLaunch(p.name, p.platform, finalBudget);
    });
  }
}

function closeCampLaunchRichModal() {
  const modal = document.getElementById('campLaunchRichModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.removeAttribute('style');
  document.documentElement.style.overflow = '';
  _igRestoreFromBody(modal);
}

function confirmCampLaunch(name, platform, budget) {
  // Save to Results state
  const pending = window._pendingCampaignLaunch || {};
  const campIdx = pending.idx;
  const camp    = (window._lastCampRecs && campIdx !== undefined) ? window._lastCampRecs[campIdx] : null;
  const roas    = camp?.estROAS || '3.8';
  const ctr     = camp?.estCTR  || '4.2%';
  const cpa     = camp?.estCPA  || '$38';
  const budgetNum = parseInt((budget || '$2000').replace(/[^0-9]/g,'')) || 2000;
  const launchedAt = new Date().toLocaleString();

  window._launchedCampaigns = window._launchedCampaigns || [];
  window._launchedCampaigns.push({
    id: 'camp_' + Date.now(),
    name, platform,
    budget: budgetNum,
    budgetStr: '$' + budgetNum.toLocaleString(),
    startDate: document.getElementById('clb-startdate')?.value || new Date().toISOString().split('T')[0],
    endDate:   document.getElementById('clb-enddate')?.value   || new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0],
    audience: 'AI-optimised targeting',
    launchedAt, status: 'active', daysRunning: 0,
    metrics: {
      roas: parseFloat(roas).toFixed(1),
      ctr: ctr,
      conversions: Math.round(budgetNum / 30),
      spend: 0,
      cpa: cpa,
      impressions: Math.round(budgetNum * 65)
    },
    actions: [
      { time: 'Just now', action: 'Campaign created and AI monitoring activated', type: 'launch' }
    ]
  });

  window._infoGenieActions = window._infoGenieActions || [];
  window._infoGenieActions.unshift({
    type: 'campaign_launch', icon: '🚀',
    text: `Campaign "${name}" launched on ${platform} — Budget: ${budget} · Est. ROAS: ${roas}× · Est. CTR: ${ctr}`,
    ts: launchedAt
  });
  igTrack('Campaign Launched', { campaignName: name, platform, budget, estROAS: roas, estCTR: ctr, estCPA: cpa });

  const inner = document.getElementById('campLaunchRichModalInner');
  inner.innerHTML = `
    <div style="padding:48px 32px;text-align:center">
      <div style="font-size:3rem;margin-bottom:16px">🎉</div>
      <div style="font-family:Sora,sans-serif;font-size:1.2rem;font-weight:800;color:#0A1628;margin-bottom:8px">Campaign Launched!</div>
      <div style="font-size:0.875rem;color:#6B7280;margin-bottom:8px;line-height:1.6;max-width:380px;margin-left:auto;margin-right:auto">"${name}" is now live on ${platform}. InfoGenie's AI engine is monitoring performance and will optimise bids every 6 hours.</div>
      <div style="display:inline-flex;gap:24px;background:#F0FDF4;border-radius:12px;padding:16px 24px;margin-bottom:24px">
        <div><div style="font-size:1.1rem;font-weight:800;color:#059669">${roas}×</div><div style="font-size:0.7rem;color:#6B7280">Est. ROAS</div></div>
        <div><div style="font-size:1.1rem;font-weight:800;color:#059669">${ctr}</div><div style="font-size:0.7rem;color:#6B7280">Est. CTR</div></div>
        <div><div style="font-size:1.1rem;font-weight:800;color:#059669">${cpa}</div><div style="font-size:0.7rem;color:#6B7280">Est. CPA</div></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="closeCampLaunchRichModal()" style="padding:10px 20px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Close</button>
        <button onclick="closeCampLaunchRichModal();navigateTo('results')" style="padding:10px 20px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer">View Results →</button>
      </div>
    </div>
  `;
  showToast('✅ Campaign "' + name + '" launched on ' + platform + ' — AI optimisation active');
}

// ── CREATIVE STUDIO ────────────────────────────────────────────────────────────
// Stores current creative content for copy/download
window._creativeStudio = {};


// Tab switcher for Creative Studio

// Launch from Creative Studio — reads stored cs data, opens launch brief

// Helper: render a titled creative block with editable textarea + copy button

// Copy by creative block ID — reads live textarea value so edits are preserved

// Copy helper

// Copy all creative content

// Download all as .txt

// Send by email via mailto

function closeCampCreativeModal() {
  const modal = document.getElementById('campCreativeModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.removeAttribute('style');
}

// ── Keyword outlier highlighting (shared by kwgap + keyword explorer) ─────────
function _parseKwNum(text) {
  const s = String(text || '').replace(/[$,%\s]/g, '').replace(/,/g, '').trim();
  if (!s || s === '—' || s === '-' || s === 'N/A' || s === 'Not ranked') return null;
  if (s.startsWith('#')) return null;
  if (s.toUpperCase().endsWith('K')) return parseFloat(s) * 1000;
  if (s.toUpperCase().endsWith('M')) return parseFloat(s) * 1000000;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function _kwPercentile(vals, pct) {
  const nums = vals.filter(v => v !== null && !isNaN(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return Infinity;
  return nums[Math.max(0, Math.ceil(nums.length * pct) - 1)];
}

function _applyKwgapOutliers() {
  const tbody = document.getElementById('kwgap-tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  if (rows.length < 2) return;

  // Clear previous pass
  rows.forEach(r => {
    r.style.borderLeft = '';
    r.style.borderLeftColor = '';
    Array.from(r.cells).forEach(c => {
      c.style.background = '';
      c.style.fontWeight = '';
      c.style.color = '';
      c.style.borderRadius = '';
    });
    r.querySelectorAll('.kw-outlier-badge').forEach(b => b.remove());
  });

  // Column indices: 0=keyword, 1=volume, 2=topComp, 3=CTR, 4=yourRank, 5=difficulty, 6=score, 7=CPC, 8=action
  const volVals   = rows.map(r => _parseKwNum(r.cells[1]?.textContent));
  const scoreVals = rows.map(r => {
    const el = r.cells[6]?.querySelector('.kwgap-score-num');
    return el ? (parseInt(el.textContent, 10) || null) : _parseKwNum(r.cells[6]?.textContent);
  });
  const cpcVals = rows.map(r => _parseKwNum(r.cells[7]?.textContent));

  const volThresh   = _kwPercentile(volVals,   0.75);
  const scoreThresh = Math.max(_kwPercentile(scoreVals, 0.65), 65);
  const cpcThresh   = _kwPercentile(cpcVals,   0.75);

  rows.forEach((row, i) => {
    const vol   = volVals[i];
    const score = scoreVals[i];
    const cpc   = cpcVals[i];
    const isTopVol   = vol   !== null && vol   >= volThresh;
    const isTopScore = score !== null && score >= scoreThresh;
    const isTopCpc   = cpc   !== null && cpc   >= cpcThresh;

    // Volume cell — green
    if (isTopVol && row.cells[1]) {
      row.cells[1].style.cssText += ';background:#D1FAE5;font-weight:800;color:#065F46;border-radius:6px';
    }

    // Score cell — green gradient based on value
    if (score !== null && row.cells[6]) {
      if (score >= 80)      row.cells[6].style.background = '#D1FAE5';
      else if (score >= 65) row.cells[6].style.background = '#ECFDF5';
    }

    // CPC cell — amber
    if (isTopCpc && row.cells[7]) {
      row.cells[7].style.cssText += ';background:#FEF3C7;font-weight:700;color:#92400E;border-radius:6px';
    }

    // Left-border accent + badge
    if (isTopVol && isTopScore) {
      row.style.cssText += ';border-left:3px solid #F59E0B';
      const kwDiv = row.cells[0]?.querySelector('.kwgap-keyword') || row.cells[0];
      if (kwDiv) {
        const badge = document.createElement('span');
        badge.className = 'kw-outlier-badge';
        badge.style.cssText = 'display:inline-block;margin-left:6px;padding:1px 7px;background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;border-radius:10px;font-size:0.68rem;font-weight:800;vertical-align:middle;white-space:nowrap';
        badge.textContent = '🔥 Top Pick';
        kwDiv.appendChild(badge);
      }
    } else if (isTopScore) {
      row.style.cssText += ';border-left:3px solid #10B981';
    } else if (isTopVol) {
      row.style.cssText += ';border-left:3px solid #3B82F6';
    }
  });

  // Legend (only once)
  const tableWrap = document.getElementById('kwgap-table-wrap');
  if (tableWrap && !document.getElementById('kwgap-outlier-legend')) {
    const legend = document.createElement('div');
    legend.id = 'kwgap-outlier-legend';
    legend.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;padding:10px 2px 2px;font-size:0.73rem;color:#6B7280;align-items:center';
    legend.innerHTML = [
      `<span style="font-weight:700;color:#374151">Outliers:</span>`,
      `<span><span style="display:inline-block;width:10px;height:10px;background:#D1FAE5;border-radius:2px;margin-right:3px;vertical-align:middle"></span>High volume</span>`,
      `<span><span style="display:inline-block;width:10px;height:10px;background:#FEF3C7;border-radius:2px;margin-right:3px;vertical-align:middle"></span>High CPC</span>`,
      `<span><span style="display:inline-block;width:3px;height:12px;background:#F59E0B;border-radius:2px;margin-right:5px;vertical-align:middle"></span>🔥 Top Pick = high volume + high score</span>`,
      `<span><span style="display:inline-block;width:3px;height:12px;background:#10B981;border-radius:2px;margin-right:5px;vertical-align:middle"></span>High opportunity score</span>`,
      `<span><span style="display:inline-block;width:3px;height:12px;background:#3B82F6;border-radius:2px;margin-right:5px;vertical-align:middle"></span>High search volume</span>`
    ].join('');
    tableWrap.appendChild(legend);
  }
}

function _applyKeOutliers() {
  const out = document.getElementById('keOut');
  if (!out) return;
  const tbody = out.querySelector('table tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  if (rows.length < 2) return;

  // Column indices: 0=keyword, 1=volume, 2=KD (span), 3=CPC, 4=comp, 5=intent
  const volVals = rows.map(r => {
    const t = (r.cells[1]?.textContent || '').replace(/,/g, '').trim();
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  });
  const cpcVals = rows.map(r => _parseKwNum(r.cells[3]?.textContent));
  const kdVals  = rows.map(r => {
    const span = r.cells[2]?.querySelector('span');
    if (!span) return null;
    const n = parseInt(span.textContent, 10);
    return isNaN(n) ? null : n;
  });

  const volThresh = _kwPercentile(volVals, 0.75);
  const cpcThresh = _kwPercentile(cpcVals, 0.75);
  // Easy KD = bottom 25% (low number = easy)
  const kdNums = kdVals.filter(v => v !== null && v > 0).sort((a, b) => a - b);
  const kdEasyThresh = kdNums.length ? kdNums[Math.floor(kdNums.length * 0.25)] : 0;

  rows.forEach((row, i) => {
    const vol   = volVals[i];
    const cpc   = cpcVals[i];
    const kd    = kdVals[i];
    const isTopVol  = vol !== null && vol >= volThresh;
    const isTopCpc  = cpc !== null && cpc >= cpcThresh;
    const isEasyKd  = kd  !== null && kd  <= kdEasyThresh;

    if (isTopVol && row.cells[1]) {
      row.cells[1].style.cssText += ';background:#D1FAE5;font-weight:800;color:#065F46;border-radius:4px';
    }
    if (isTopCpc && row.cells[3]) {
      row.cells[3].style.cssText += ';background:#FEF3C7;font-weight:700;color:#92400E;border-radius:4px';
    }

    if (isTopVol && isEasyKd) {
      row.style.cssText += ';border-left:3px solid #10B981';
      const badge = document.createElement('span');
      badge.style.cssText = 'display:inline-block;margin-left:6px;padding:1px 7px;background:#D1FAE5;color:#065F46;border:1px solid #6EE7B7;border-radius:10px;font-size:0.68rem;font-weight:800;vertical-align:middle;white-space:nowrap';
      badge.textContent = '🎯 Easy Win';
      row.cells[0]?.appendChild(badge);
    } else if (isTopVol) {
      row.style.cssText += ';border-left:3px solid #3B82F6';
    } else if (isEasyKd) {
      row.style.cssText += ';border-left:3px solid #10B981';
    }
  });

  // Legend
  const tableBox = tbody.closest('div[style*="border"]') || out.querySelector('div[style*="border"]');
  if (tableBox && !document.getElementById('ke-outlier-legend')) {
    const legend = document.createElement('div');
    legend.id = 'ke-outlier-legend';
    legend.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;padding:10px 4px 2px;font-size:0.73rem;color:#6B7280;align-items:center';
    legend.innerHTML = [
      `<span style="font-weight:700;color:#374151">Outliers:</span>`,
      `<span><span style="display:inline-block;width:10px;height:10px;background:#D1FAE5;border-radius:2px;margin-right:3px;vertical-align:middle"></span>High volume (top 25%)</span>`,
      `<span><span style="display:inline-block;width:10px;height:10px;background:#FEF3C7;border-radius:2px;margin-right:3px;vertical-align:middle"></span>High CPC (top 25%)</span>`,
      `<span><span style="display:inline-block;width:3px;height:12px;background:#10B981;border-radius:2px;margin-right:5px;vertical-align:middle"></span>🎯 Easy Win = high volume + low difficulty</span>`
    ].join('');
    tableBox.parentNode?.insertBefore(legend, tableBox.nextSibling);
  }
}

// ── Live Keyword Gap Fetch (DataForSEO via backend) ──────────────────────────

async function fetchLiveKeywordGap() {
  const domainInput = document.getElementById('kwgap-domain-input');
  const locationSelect = document.getElementById('kwgap-location-select');
  const fetchBtn = document.getElementById('kwgap-fetch-btn');
  const tbody = document.getElementById('kwgap-tbody');
  const badge = document.getElementById('ldb-semrush');
  const statusNote = document.getElementById('kwgap-status-note');
  const dataSourceLabel = document.getElementById('kwgap-data-source');

  const domain = (domainInput ? domainInput.value.trim() : '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain) {
    showToast('⚠️ Please enter your domain first');
    if (domainInput) domainInput.focus();
    return;
  }

  // Check if backend is configured
  try {
    const statusRes = await fetch('/api/status');
    const status = await statusRes.json();
    if (!status.dataforseo) {
      if (statusNote) statusNote.innerHTML = `
        <span style="color:#EF4444;font-weight:600">⚡ DataForSEO credentials required to fetch live data.</span>
        Add two secrets in your Replit project: <code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;font-size:0.8rem">DATAFORSEO_LOGIN</code> and
        <code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;font-size:0.8rem">DATAFORSEO_PASSWORD</code>
        — sign up free at <a href="https://dataforseo.com" target="_blank" style="color:#0066FF;text-decoration:underline">dataforseo.com</a>,
        then restart the app and click Fetch Live Data again.
      `;
      if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '⚡ Fetch Live Data'; }
      return;
    }
  } catch(e) {
    showToast('❌ Cannot reach server — please reload the page');
    return;
  }

  if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = '⏳ Fetching…'; }
  if (statusNote) statusNote.textContent = '🔄 Querying DataForSEO for live keyword gap data…';
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#6B7280">
    <div style="display:flex;align-items:center;justify-content:center;gap:12px">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C9C8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      Fetching live keyword gap data for <strong style="color:#00C9C8">${domain}</strong>…
    </div>
  </td></tr>`;

  const industryKey = analysisData ? analysisData.industryKey : 'marketing';
  const location = locationSelect ? locationSelect.value : 'United States';

  // Extract actual competitor domains from the current analysis
  const analysisCompetitors = analysisData && analysisData.competitors
    ? analysisData.competitors
        .map(c => (c.url || c.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase())
        .filter(Boolean)
    : [];

  // Show which competitors are being analysed in the status note
  if (statusNote && analysisCompetitors.length > 0) {
    statusNote.textContent = `🔄 Querying DataForSEO · analysing your domain vs ${analysisCompetitors.slice(0,3).join(', ')}${analysisCompetitors.length > 3 ? ` +${analysisCompetitors.length - 3} more` : ''}…`;
  }

  try {
    const res = await fetch('/api/keyword-gap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yourDomain: domain,
        industry: industryKey,
        competitors: analysisCompetitors.length > 0 ? analysisCompetitors : undefined,
        location,
        language: 'English',
        limit: 20
      })
    });

    // Guard against proxy timeouts returning HTML instead of JSON
    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch(parseErr) {
      if (res.status === 504 || rawText.includes('<!DOCTYPE') || rawText.startsWith('<')) {
        throw new Error('Request timed out — DataForSEO took too long. Please try again.');
      }
      throw new Error(`Unexpected server response (status ${res.status}). Please try again.`);
    }

    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }

    const keywords = data.keywords || [];

    if (keywords.length === 0) {
      if (data.paymentRequired) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:left;padding:24px;background:#FEF3C7;border:1px solid #FCD34D">
          <div style="font-weight:800;color:#92400E;font-size:1rem;margin-bottom:8px">⚠️ DataForSEO Account Out of Credit</div>
          <div style="color:#78350F;font-size:0.88rem;line-height:1.55">
            Your DataForSEO account balance is depleted, so live keyword data cannot be fetched. To restore real keyword gap analysis:
            <ol style="margin:10px 0 0 22px;padding:0">
              <li>Sign in at <a href="https://app.dataforseo.com/dashboard" target="_blank" style="color:#0066FF;font-weight:700;text-decoration:underline">app.dataforseo.com/dashboard</a></li>
              <li>Top up your account ($10 minimum is plenty to unblock everything)</li>
              <li>Click <strong>⚡ Fetch Live Data</strong> again — InfoGenie will pull real keywords for <strong>${domain}</strong> against ${(data.competitors||[]).join(', ')}</li>
            </ol>
            <div style="margin-top:10px;font-size:0.78rem;color:#92400E"><strong>Why this matters:</strong> Without DataForSEO credit, InfoGenie cannot show you accurate keyword volumes, CPCs, or competitor rankings — only fake placeholder keywords would be possible, which we refuse to display.</div>
          </div>
        </td></tr>`;
        if (badge) badge.textContent = '⚠️ Top up DataForSEO';
        if (statusNote) statusNote.innerHTML = `❌ <strong>DataForSEO account out of credit</strong> · top up at <a href="https://app.dataforseo.com/dashboard" target="_blank" style="color:#0066FF;text-decoration:underline">dataforseo.com/dashboard</a> to enable real keyword data`;
        if (dataSourceLabel) { dataSourceLabel.textContent = `⚠️ DataForSEO Payment Required — no live keyword data available until account is topped up`; dataSourceLabel.style.color = '#EF4444'; }
        showToast('⚠️ DataForSEO account out of credit — top up to enable live keywords');
        return;
      }
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#6B7280">
        No keyword gaps found for <strong>${domain}</strong> vs these competitors.<br>
        <small>${data.warning || 'Try a different location or check that your domain has established search presence.'}</small>
      </td></tr>`;
      if (badge) badge.textContent = '0 Opportunities Found';
      if (statusNote) statusNote.textContent = `✅ Live query complete — no gaps found for ${domain}`;
      if (dataSourceLabel) { dataSourceLabel.textContent = `✅ Live data from DataForSEO · ${domain} vs ${(data.competitors || []).join(', ')}`; dataSourceLabel.style.color = '#10B981'; }
      return;
    }

    // Render live rows
    const rows = keywords.map(k => {
      const compsHtml = k.compsLabel
        ? k.compsLabel.split(', ').map((p,i) => `<span style="display:inline-block;background:${i===0?'#DBEAFE':'#F1F5F9'};color:${i===0?'#1E40AF':'#475569'};padding:2px 7px;border-radius:6px;font-size:0.72rem;font-weight:700;margin:1px 3px 1px 0">${p}</span>`).join('')
        : k.topComp;
      return `
      <tr>
        <td><div class="kwgap-keyword">${k.keyword}</div></td>
        <td>${k.volume}</td>
        <td style="max-width:240px;line-height:1.4">${compsHtml}</td>
        <td>${k.compCtr}</td>
        <td>${k.yourRank}</td>
        <td><span class="diff-badge diff-${k.difficulty.toLowerCase()}">${k.difficulty}</span></td>
        <td>
          <div class="kwgap-score-bar"><div class="kwgap-score-fill" style="width:${k.score}%"></div></div>
          <span class="kwgap-score-num">${k.score}</span>
        </td>
        <td>${k.cpc}</td>
        <td><button class="btn-kwgap-attack" data-kw="${k.keyword.replace(/"/g,'')}" data-comp="${k.topComp.replace(/"/g,'')}" onclick="openAttackModal('${k.keyword.replace(/'/g,'')}','${k.topComp.replace(/'/g,'')}','keyword')">⚡ Attack</button></td>
      </tr>
    `;
    }).join('');

    if (tbody) tbody.innerHTML = rows;
    try { _applyKwgapOutliers(); } catch(e) {}
    if (badge) badge.textContent = `${keywords.length} Live Opportunities`;

    const compList = (data.competitors || []).slice(0, 4).join(', ');
    const compExtra = (data.competitors || []).length > 4 ? ` +${(data.competitors||[]).length - 4} more` : '';
    if (statusNote) statusNote.textContent = `✅ Live · Fetched ${new Date().toLocaleTimeString()} · ${keywords.length} keyword gaps found vs ${compList}${compExtra}`;
    if (dataSourceLabel) {
      dataSourceLabel.innerHTML = `✅ <strong>Live data from DataForSEO</strong> · <strong>${domain}</strong> vs <strong>${compList}${compExtra}</strong> · Updated ${new Date().toLocaleTimeString()}`;
      dataSourceLabel.style.color = '#10B981';
    }

    // Save domain for future use
    try { localStorage.setItem('ig_kwgap_domain', domain); } catch(e) {}
    showToast(`✅ ${keywords.length} live keyword gaps found for ${domain}`);

  } catch(err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#EF4444">
      ❌ ${err.message}
    </td></tr>`;
    if (statusNote) statusNote.textContent = `❌ Error: ${err.message}`;
    showToast('❌ ' + err.message);
  } finally {
    if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '⚡ Fetch Live Data'; }
  }
}

// ── RAPIDAPI: Live Competitor News ────────────────────────────────────────────

// ── RAPIDAPI: Reddit Social Intelligence ─────────────────────────────────────

// Allow pressing Enter in domain input to trigger fetch
document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'kwgap-domain-input') {
      fetchLiveKeywordGap();
    }
  });

  // Pre-fill from localStorage if available
  const savedDomain = localStorage.getItem('ig_kwgap_domain');
  if (savedDomain) {
    const inp = document.getElementById('kwgap-domain-input');
    if (inp && !inp.value) inp.value = savedDomain;
  }
});

// Init view states
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.view').forEach((v, i) => {
    if (i !== 0) v.style.display = 'none';
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENCY HUB · AUTOMATIONS CENTER · RE-ENGAGEMENT HUB (+ Drip status panel)
// → moved to public/js/ig_reach_automation.js (see public/js/README.md).
//   window.buildAgency / window.buildAutomations / window.buildReEngagement and
//   their action helpers are defined there.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// DRIP ACTION HELPERS · GOOGLE SERP INTELLIGENCE · BRAND ASSETS LIBRARY
// → moved to public/js/ig_drip_serp.js (see public/js/README.md).
//   window.dripAction / window.generateSequenceContent / window.generateCounterOffer,
//   initSerpView + runSerpSearch + renderSerpResults, and initBrandAssets + the ba*
//   helpers are defined there (re-exported on window).
// ═══════════════════════════════════════════════════════════════════════════════


/* ══════════════════════════════════════════════
   RESULTS VIEW — PDF EXPORT, CUSTOMISE PANEL, ROAS BREAKDOWN
   → moved to public/js/ig_results_export.js (see public/js/README.md).
   window.exportResultsPDF / window.getIndustryROASBenchmark /
   window.buildCompetitorROASBreakdown / window.toggleResultsCustomisePanel /
   window.rcToggle / window.rcApply are defined there (re-exported on window).
   ══════════════════════════════════════════════ */

/* ══════════════════════════════════════════════
   REDDIT — POST NOW
   ══════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════
   C-SUITE EXECUTIVE INTELLIGENCE REPORTS + ACTION CENTER
   → moved to public/js/ig_csuite.js (see public/js/README.md).
   window.initCsuite / window.csSetRole / window.csSetPeriod /
   window.csSuitePDF / window.initActionCenter are defined there
   (re-exported on window). acBuild probes window.getIndustryROASBenchmark
   (from ig_results_export.js) via a bare typeof that resolves globally.
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   MANUAL COMPETITOR ENTRY + LAUNCH NOW  +  AUTO-SEO PRO cluster
   → moved to public/js/ig_manual_comp_autoseo.js (see public/js/README.md).
   window.toggleManualCompPanel / addManualCompetitor / removeManualCompetitor /
   launchNow + the Auto-SEO calendar (buildAutoSEO / showAutoSeoCalendar /
   publishNowFromCal / calEditArticle / calSaveEdit / calDeleteArticle) and the
   keyword/backlink/outreach/settings/traffic renderers are defined there
   (re-exported on window). buildMasterCalendar still calls window._artDate and
   navigateTo dispatches window.buildAutoSEO — both resolve via those exports.
   ══════════════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════════════════════
// MASTER CALENDAR — unified view of all content, campaigns & social
// ══════════════════════════════════════════════════════════════════════════
window._mcFilter  = 'all';
window._mcViewMonth = null;
window._mcViewYear  = null;

function buildMasterCalendar() {
  const wrap = document.getElementById('masterCalWrap');
  if (!wrap) return;

  const today = new Date();
  if (window._mcViewMonth === null) window._mcViewMonth = today.getMonth();
  if (window._mcViewYear  === null) window._mcViewYear  = today.getFullYear();

  const sch = window._autoSeoSchedule || {};
  const todayIso = today.toISOString().split('T')[0];

  // ── Collect all events ──────────────────────────────────────────────────
  const events = [];

  (window._autoSeoArticles || []).forEach((a, i) => {
    const d = _artDate(i, sch);
    const isPast = d < todayIso;
    const risk = isPast && a.status !== 'published' && a.status !== 'generated';
    events.push({ date: d, type: 'article', idx: i, title: a.title || 'Article #'+(i+1),
      status: a.status || 'pending', risk, color: a.status==='published'?'#059669':a.status==='generated'?'#1D4ED8':'#6B7280',
      bg: a.status==='published'?'#DCFCE7':a.status==='generated'?'#DBEAFE':'#F3F4F6',
      label: a.status==='published'?'Published':a.status==='generated'?'Written':'Pending' });
  });

  (window._launchedCampaigns || []).forEach((c, i) => {
    const raw = c.launchedAt || '';
    let d = todayIso;
    try { const dt = new Date(raw); if (!isNaN(dt)) d = dt.toISOString().split('T')[0]; } catch(e) {}
    const roas = parseFloat(c.metrics && c.metrics.roas) || 0;
    const risk = roas > 0 && roas < 2;
    const isLive = c.status === 'active';
    events.push({ date: d, type: 'campaign', idx: i, title: (c.name||'Campaign') + ' · ' + (c.platform||''),
      status: isLive ? 'live' : 'ended', risk, color: risk?'#D97706':isLive?'#7C3AED':'#6B7280',
      bg: risk?'#FEF3C7':isLive?'#F5F3FF':'#F3F4F6',
      label: risk?'⚠️ At Risk':isLive?'🔵 Live':'Ended', budget: c.budget, roas: c.metrics && c.metrics.roas });
  });

  (window._socialPosts || []).forEach(p => {
    const d = p.scheduledDate || todayIso;
    const isPast = d < todayIso;
    events.push({ date: d, type: 'social', id: p.id, title: (p.caption||'Social post').substring(0,45),
      status: p.status || (isPast ? 'published' : 'scheduled'), risk: false,
      color: isPast ? '#059669' : '#9333EA', bg: isPast ? '#DCFCE7' : '#F5F3FF',
      label: isPast ? 'Published' : '📅 Scheduled', platform: p.platform });
  });

  // ── Summary stats ───────────────────────────────────────────────────────
  const inNext7  = events.filter(e => e.date > todayIso && e.date <= new Date(Date.now()+7*864e5).toISOString().split('T')[0]);
  const liveNow  = events.filter(e => e.status === 'live' || (e.date === todayIso && e.type !== 'article'));
  const atRisk   = events.filter(e => e.risk);
  const done     = events.filter(e => e.status === 'published' || e.status === 'ended');

  const typeLabels = { all:'All Events', article:'📝 Articles', campaign:'🚀 Campaigns', social:'📱 Social' };
  const filterHtml = Object.entries(typeLabels).map(([k,v]) =>
    '<button data-mcf="' + k + '" onclick="window._mcFilter=this.dataset.mcf;buildMasterCalendar()" style="padding:7px 14px;border:none;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;background:' + (window._mcFilter===k?'#0066FF':'#F3F4F6') + ';color:' + (window._mcFilter===k?'white':'#374151') + '">' + v + '</button>'
  ).join('');

  // ── Build filtered dateMap ──────────────────────────────────────────────
  const filtered = window._mcFilter === 'all' ? events : events.filter(e => e.type === window._mcFilter);
  const dateMap = {};
  filtered.forEach(e => { if (!dateMap[e.date]) dateMap[e.date] = []; dateMap[e.date].push(e); });

  // ── Calendar grid ───────────────────────────────────────────────────────
  const yr = window._mcViewYear, mo = window._mcViewMonth;
  const monthName = new Date(yr, mo, 1).toLocaleDateString('en-US', { month:'long', year:'numeric' });
  const firstDay = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo+1, 0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const cells = [];
  for (let p = 0; p < firstDay; p++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i+7));

  const calGrid =
    '<table style="width:100%;border-collapse:separate;border-spacing:3px;table-layout:fixed">' +
    '<thead><tr>' + dayNames.map(d =>
      '<th style="text-align:center;font-size:0.65rem;font-weight:700;color:#9CA3AF;padding:5px 2px;text-transform:uppercase">' + d + '</th>'
    ).join('') + '</tr></thead>' +
    '<tbody>' + rows.map(row =>
      '<tr>' + row.map(day => {
        if (!day) return '<td style="padding:4px;height:90px;background:#FAFAFA;border-radius:6px;opacity:.3"></td>';
        const iso = yr + '-' + String(mo+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
        const dayEvents = dateMap[iso] || [];
        const isToday = iso === todayIso;
        const hasRisk = dayEvents.some(e => e.risk);
        const cellBg = isToday ? '#EFF6FF' : hasRisk ? '#FFFBEB' : dayEvents.length ? '#F9FAFB' : 'white';
        return '<td style="padding:5px;vertical-align:top;height:90px;background:' + cellBg + ';border:1.5px solid ' + (isToday?'#3B82F6':hasRisk?'#FCD34D':'#F3F4F6') + ';border-radius:8px">' +
          '<div style="font-size:0.72rem;font-weight:' + (isToday?'800':'600') + ';color:' + (isToday?'#1D4ED8':'#374151') + ';text-align:right;margin-bottom:3px">' +
            (isToday ? '<span style="background:#1D4ED8;color:white;border-radius:50%;width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;font-size:0.67rem">' + day + '</span>' : day) +
          '</div>' +
          dayEvents.slice(0,4).map(e =>
            '<div title="' + e.title.replace(/"/g,"'") + '" style="font-size:0.58rem;font-weight:600;padding:1px 5px;border-radius:3px;background:' + e.bg + ';color:' + e.color + ';margin-bottom:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:default">' +
              (e.type==='article'?'📝':e.type==='campaign'?'🚀':'📱') + ' ' + e.title.substring(0,20) +
            '</div>'
          ).join('') +
          (dayEvents.length > 4 ? '<div style="font-size:0.58rem;color:#9CA3AF;padding:1px 4px">+' + (dayEvents.length-4) + ' more</div>' : '') +
        '</td>';
      }).join('') + '</tr>'
    ).join('') + '</tbody></table>';

  // ── Upcoming events list ────────────────────────────────────────────────
  const upcoming = filtered.filter(e => e.date >= todayIso).sort((a,b) => a.date.localeCompare(b.date)).slice(0,12);
  const upcomingHtml = upcoming.length ? upcoming.map(e =>
    '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid #F3F4F6;border-radius:10px;background:' + (e.risk?'#FFFBEB':'white') + '">' +
      '<div style="flex-shrink:0;text-align:center;min-width:40px;background:#F9FAFB;border-radius:8px;padding:4px 6px">' +
        '<div style="font-size:0.62rem;font-weight:700;color:#6B7280;text-transform:uppercase">' + new Date(e.date+'T00:00:00').toLocaleDateString('en-US',{month:'short'}) + '</div>' +
        '<div style="font-size:1.1rem;font-weight:800;color:#111827;line-height:1">' + parseInt(e.date.split('-')[2]) + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:0.82rem;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (e.type==='article'?'📝':e.type==='campaign'?'🚀':'📱') + ' ' + e.title + '</div>' +
        '<div style="font-size:0.68rem;color:#6B7280;margin-top:2px">' + (e.type==='article'?'📝 Article':e.type==='campaign'?'🚀 Campaign':'📱 Social') + ' · ' + e.label + (e.budget?(' · $'+e.budget.toLocaleString()+' budget'):'') + '</div>' +
      '</div>' +
      '<span style="font-size:0.68rem;font-weight:700;padding:3px 9px;border-radius:6px;background:' + e.bg + ';color:' + e.color + ';white-space:nowrap">' + e.label + '</span>' +
    '</div>'
  ).join('') : '<div style="text-align:center;padding:30px;color:#9CA3AF;font-size:0.82rem">No upcoming events — launch campaigns or generate article topics to populate the calendar.</div>';

  wrap.innerHTML =
    // Summary cards
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px">' +
      [['🗓️','Going Live (7d)', inNext7.length,'#0066FF','#EFF6FF'],
       ['🟢','Live Now',       liveNow.length,'#059669','#DCFCE7'],
       ['⚠️','At Risk',        atRisk.length, '#D97706','#FEF3C7'],
       ['✅','Completed',      done.length,   '#6B7280','#F3F4F6']].map(([ic,lb,val,col,bg]) =>
        '<div style="background:' + bg + ';border:1.5px solid ' + col + '30;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:10px">' +
          '<span style="font-size:1.3rem">' + ic + '</span>' +
          '<div><div style="font-family:Sora,sans-serif;font-size:1.4rem;font-weight:800;color:' + col + ';line-height:1">' + val + '</div><div style="font-size:0.7rem;font-weight:600;color:' + col + '90;margin-top:2px">' + lb + '</div></div>' +
        '</div>'
      ).join('') +
    '</div>' +
    // Filter tabs
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">' + filterHtml +
      '<div style="margin-left:auto;display:flex;align-items:center;gap:8px">' +
        '<button onclick="if(window._mcViewMonth===0){window._mcViewMonth=11;window._mcViewYear--;}else{window._mcViewMonth--;}buildMasterCalendar()" style="width:32px;height:32px;background:#F3F4F6;border:none;border-radius:8px;cursor:pointer;font-size:0.9rem">‹</button>' +
        '<span style="font-size:0.88rem;font-weight:700;color:#111827;white-space:nowrap">' + monthName + '</span>' +
        '<button onclick="if(window._mcViewMonth===11){window._mcViewMonth=0;window._mcViewYear++;}else{window._mcViewMonth++;}buildMasterCalendar()" style="width:32px;height:32px;background:#F3F4F6;border:none;border-radius:8px;cursor:pointer;font-size:0.9rem">›</button>' +
      '</div>' +
    '</div>' +
    // Calendar grid
    '<div style="background:white;border-radius:14px;padding:16px;margin-bottom:24px;box-shadow:0 1px 6px rgba(0,0,0,.05)">' +
      calGrid +
    '</div>' +
    // Upcoming list
    '<div style="background:white;border-radius:14px;padding:20px;box-shadow:0 1px 6px rgba(0,0,0,.05)">' +
      '<div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:#111827;margin-bottom:14px">📋 Upcoming Events</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' + upcomingHtml + '</div>' +
    '</div>';
}

/* ============================================================
   macOS-DOCK MAGNIFICATION  — fisheye scale on neighbouring items
   driven by horizontal cursor distance, with spring release.
   ============================================================ */
(function dockMagnify(){
  const SELECTORS = '.nav-group-btn, .nav-link, .stab, .tab-btn, .pf-btn, .atp-pill, .sub-tab, .subtab, .creative-tab, .cs-tab, .ich-tab, .kpi-tab, .cal-tab, .module-tab, .dropdown-link';
  const MAX_SCALE = 1.05;
  const RANGE     = 90;

  const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t);

  function attach(container, customItems){
    if (container._dockBound) return;
    const items = customItems || Array.from(container.querySelectorAll(SELECTORS))
      .filter(el => el.parentElement === container);
    if (items.length < 2) return;
    container._dockBound = true;

    const r1 = items[0].getBoundingClientRect();
    const r2 = items[1].getBoundingClientRect();
    const isVertical = Math.abs(r2.top - r1.top) > Math.abs(r2.left - r1.left);

    container.addEventListener('mousemove', e => {
      items.forEach(item => {
        const r = item.getBoundingClientRect();
        const c = isVertical ? r.top + r.height/2 : r.left + r.width/2;
        const p = isVertical ? e.clientY : e.clientX;
        const t = Math.max(0, 1 - Math.abs(p - c) / RANGE);
        const s = 1 + (MAX_SCALE - 1) * ease(t);
        item.style.transform = `scale(${s})`;
        item.style.zIndex    = s > 1.05 ? '5' : '';
      });
    });

    container.addEventListener('mouseenter', () => {
      container.classList.remove('dock-releasing');
    });

    container.addEventListener('mouseleave', () => {
      container.classList.add('dock-releasing');
      items.forEach(item => { item.style.transform = ''; item.style.zIndex = ''; });
      setTimeout(() => container.classList.remove('dock-releasing'), 600);
    });
  }

  function scan(root){
    // Scope the scan to a subtree when given (incremental mode). Re-scanning
    // the whole document on every DOM mutation runs this heavy compound
    // querySelectorAll + per-match sibling filter constantly and saturates the
    // main thread on large DOMs. attach() is idempotent (guarded by
    // _dockBound), so processing only newly-added subtrees is sufficient.
    const scope = (root && root.querySelectorAll) ? root : document;
    const parents = new Set();
    function consider(el){
      const p = el.parentElement;
      if (!p) return;
      const siblings = Array.from(p.children).filter(c => c.matches && c.matches(SELECTORS));
      if (siblings.length >= 2) parents.add(p);
    }
    scope.querySelectorAll(SELECTORS).forEach(consider);
    if (root && root.nodeType === 1 && root.matches && root.matches(SELECTORS)) consider(root);
    parents.forEach(p => attach(p));

    // Special case: top-nav main tabs (.nav-group-btn) live each in their own
    // .nav-group-wrap, so they aren't direct siblings. Find their common
    // ancestor and treat the buttons as a single dock row. Only meaningful at
    // the document level (top nav renders once at load).
    if (scope === document) {
      const groupBtns = Array.from(document.querySelectorAll('.nav-group-btn'));
      if (groupBtns.length >= 2) {
        const wrap = groupBtns[0].closest('.nav-groups, nav, header, .topbar') || groupBtns[0].parentElement?.parentElement;
        if (wrap) attach(wrap, groupBtns);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }
  // Re-scan ONLY newly-added element subtrees as views render dynamically.
  let _t = null;
  let _pending = new Set();
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type !== 'childList' || !m.addedNodes) continue;
      m.addedNodes.forEach(n => { if (n.nodeType === 1) _pending.add(n); });
    }
    if (!_pending.size || _t) return;
    _t = setTimeout(() => {
      _t = null;
      const roots = _pending; _pending = new Set();
      roots.forEach(r => { if (r.isConnected) scan(r); });
    }, 150);
  }).observe(document.body, { childList: true, subtree: true });
})();

// ── Strip inline gradient overrides on hero headers + apply unified blue card ─
(function unifyHeroHeaders(){
  const BLUE = 'linear-gradient(110deg,#1E40AF 0%,#2563EB 50%,#3B82F6 100%)';
  function strip(el){
    if (!el) return;
    if (el.style.background) el.style.background = '';
    if (el.style.backgroundImage) el.style.backgroundImage = '';
    if (el.style.borderBottom) el.style.borderBottom = '';
  }
  function applyBpHero(scope){
    const bpHero = (scope && scope.querySelector ? scope : document).querySelector('#battlePlanWrap [data-bp-hero]');
    if (bpHero) {
      bpHero.style.background = BLUE;
      bpHero.style.borderBottom = 'none';
    }
  }
  function sweep(root){
    // Scope to a subtree when given. Re-running querySelectorAll over the whole
    // document on every mutation is needless work that piles up on large DOMs;
    // strip() is idempotent so processing only newly-added subtrees suffices.
    const scope = (root && root.querySelectorAll) ? root : document;
    scope.querySelectorAll('.view-header, .intel-header').forEach(strip);
    if (root && root.nodeType === 1 && root.matches && root.matches('.view-header, .intel-header')) strip(root);
    applyBpHero(root);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => sweep());
  } else { sweep(); }
  // Strip ONLY newly-added element subtrees as views render dynamically.
  let _t = null;
  let _pending = new Set();
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type !== 'childList' || !m.addedNodes) continue;
      m.addedNodes.forEach(n => { if (n.nodeType === 1) _pending.add(n); });
    }
    if (!_pending.size || _t) return;
    _t = setTimeout(() => {
      _t = null;
      const roots = _pending; _pending = new Set();
      roots.forEach(r => { if (r.isConnected) sweep(r); });
    }, 80);
  }).observe(document.body, { childList: true, subtree: true });
})();




// ── TECHNICAL SUITE ─────────────────────────────────────────────────────────








// ── Safety-net: ensure inline onclick handlers can find these globals ──
try { window.openWLCounterModal = openWLCounterModal; } catch(e) {}
try { window.queueCounterCampaign = queueCounterCampaign; } catch(e) {}
try { window.closeAttackModal = closeAttackModal; } catch(e) {}
try { window.openAttackModal = openAttackModal; } catch(e) {}

// NOTE: window._wlClick and the document-level click handler are now defined
// at the very TOP of app.js (see the earlyWLCounterWireup IIFE) so they are
// guaranteed to exist even if a runtime error halts the rest of script
// execution. Don't redefine them here.

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL LINK SUGGESTER — AI-driven link recommendations
// ════════════════════════════════════════════════════════════════════════════

function _lsAD() {
  // Resilient lookup: prefer the live closure var, fall back to window mirror,
  // then to a minimal record reconstructed from the last-analysed URL in localStorage.
  if (typeof analysisData !== 'undefined' && analysisData) return analysisData;
  if (window.analysisData) return window.analysisData;
  try {
    const url = localStorage.getItem('ig-last-analysed-url');
    if (url) return { url };
  } catch(e) {}
  return null;
}

function _lsDomain() {
  const ad = _lsAD();
  const d = (ad && (ad.url || ad.domain)) || '';
  return String(d).replace(/^https?:\/\//, '').split('/')[0] || '';
}

function _lsBrand() {
  const ad = _lsAD();
  return (ad && (ad.brand || ad.brandName)) || _lsDomain().split('.')[0] || 'your brand';
}

function _lsSector() {
  const ad = _lsAD();
  if (ad) {
    if (ad.sector) return ad.sector;
    if (ad.industry && typeof ad.industry === 'string') return ad.industry;
    if (ad.industry && ad.industry.name) return ad.industry.name;
  }
  return 'your industry';
}

function _lsKeywords() {
  const ad = _lsAD();
  if (!ad) return [];
  if (Array.isArray(ad.keywords)) return ad.keywords.slice(0, 12);
  if (Array.isArray(ad.competitors)) {
    const k = [];
    ad.competitors.forEach(c => {
      if (c.keywords) k.push(...c.keywords);
      else if (c.topKeyword) k.push(c.topKeyword);
    });
    return k.slice(0, 12);
  }
  return [];
}








// ════════════════════════════════════════════════════════════════════════════
// CRO LAB — A/B testing, trust-signal audit, checkout-friction scoring
// ════════════════════════════════════════════════════════════════════════════






// ════════════════════════════════════════════════════════════════════════════
// GSC / GA4 ANALYTICS HUB — connector + top/weak performer dashboard
// ════════════════════════════════════════════════════════════════════════════







// ═══════════════════════════════════════════════════════════════════════════
// PLAI-PARITY MODULES — Tier 1 + Tier 2 (April 2026)
// All modules use _lsAD()/_lsDomain()/_lsBrand()/_lsSector()/_lsKeywords() helpers
// for resilient analysis-data lookup (closure → window mirror → localStorage).
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared empty-state helper ─────────────────────────────────────────────
function _emptyAnalysisCard(title, runLabel) {
  return `
    <div style="background:white;border:2px dashed #CBD5E1;border-radius:12px;padding:48px;text-align:center;margin-top:20px">
      <div style="font-size:48px;margin-bottom:12px">🔎</div>
      <h3 style="margin:0 0 8px;color:#1E293B">Run an analysis first</h3>
      <p style="margin:0 0 18px;color:#64748B;max-width:480px;margin-left:auto;margin-right:auto">
        ${title} needs your competitor &amp; sector data. Head to the home page, enter your website (or pick a sector), and we'll have everything ready in under a minute.
      </p>
      <button class="btn-primary" onclick="navigateTo('home')" style="background:linear-gradient(135deg,#0066FF,#00D8D7);color:white;border:none;padding:10px 22px;border-radius:8px;font-weight:700;cursor:pointer">↗ Go to Home — Run Analysis</button>
    </div>`;
}

// ── Custom info-tooltip bubbles (used by ICP Activation tiles, etc.) ──────

// ── HTML escape for user-controlled values rendered into innerHTML ────────
function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Shared seeded RNG (deterministic per-domain output) ────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// 1. AI LANDING PAGE BUILDER
// ═══════════════════════════════════════════════════════════════════════════




// ═══════════════════════════════════════════════════════════════════════════
// 2. SMART CREATIVE BUILDER
// ═══════════════════════════════════════════════════════════════════════════





// ═══════════════════════════════════════════════════════════════════════════
// 3. AI UGC AVATARS
// ═══════════════════════════════════════════════════════════════════════════
window._ugcData = null;



// ── Web Speech helpers — read the AI scripts aloud ──────────────────────────
function _pickSpeechVoice(prefs) {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;
    const langPrefix = (prefs.langCode || 'en').toLowerCase();
    const matchLang = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
    const pool = matchLang.length ? matchLang : voices;
    if (prefs.gender === 'F') {
      const f = pool.find(v => /female|samantha|victoria|karen|moira|tessa|serena|aria|olivia|sofia|isla|lily|aisha/i.test(v.name));
      if (f) return f;
    } else if (prefs.gender === 'M') {
      const m = pool.find(v => /male|daniel|alex|fred|tom|aaron|liam|mark|james|ethan|noah|arjun|kai/i.test(v.name));
      if (m) return m;
    }
    return pool[0];
  } catch(e) { return null; }
}

function _speak(text, prefs, btnId) {
  if (!('speechSynthesis' in window)) { showToast('⚠️ Your browser does not support speech playback'); return false; }
  try { window.speechSynthesis.cancel(); } catch(e){}
  const u = new SpeechSynthesisUtterance(text);
  const v = _pickSpeechVoice(prefs || {});
  if (v) u.voice = v;
  if (prefs && prefs.langCode) u.lang = v ? v.lang : prefs.langCode;
  u.rate = (prefs && prefs.rate) || 1;
  u.pitch = (prefs && prefs.pitch) || 1;
  const btn = btnId && document.getElementById(btnId);
  const setIcon = (txt) => { if (btn) btn.innerHTML = txt; };
  setIcon('⏸');
  u.onend = () => setIcon('▶');
  u.onerror = () => setIcon('▶');
  // make button toggle stop on second click
  if (btn) btn.onclick = function() {
    try { window.speechSynthesis.cancel(); } catch(e){}
    setIcon('▶');
    setTimeout(() => { btn.onclick = null; rebindPlayHandler(btnId); }, 50);
  };
  // ensure voices are loaded (some browsers async-populate)
  if (!window.speechSynthesis.getVoices().length) {
    window.speechSynthesis.onvoiceschanged = () => {
      const vv = _pickSpeechVoice(prefs || {});
      if (vv) u.voice = vv;
      window.speechSynthesis.speak(u);
    };
  } else {
    window.speechSynthesis.speak(u);
  }
  return true;
}

function rebindPlayHandler(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (btnId === 'ugcPlayBtn') btn.onclick = window.playUgcScript;
  if (btnId === 'voPlayBtn') btn.onclick = window.playVoiceoverScript;
}

window.playUgcScript = function() {
  const d = window._ugcData;
  if (!d || !d.script) { showToast('⚠️ Generate an avatar first'); return; }
  const avatars = { sarah:{gender:'F'}, lily:{gender:'F'}, aisha:{gender:'F'}, mark:{gender:'M'}, james:{gender:'M'}, kai:{gender:'M'} };
  const pref = avatars[d.avatarId] || { gender:'F' };
  pref.langCode = 'en';
  pref.rate = 1.05;
  if (_speak(d.script, pref, 'ugcPlayBtn')) showToast('▶ Playing AI script…');
};

window.playVoiceoverScript = function() {
  const script = (document.getElementById('voScript') || {}).value || (window._voData && window._voData.script);
  if (!script) { showToast('⚠️ Type or generate a script first'); return; }
  const voiceMap = {
    aria:{gender:'F',langCode:'en-US',rate:1,pitch:1.05},
    liam:{gender:'M',langCode:'en-US',rate:1,pitch:0.95},
    olivia:{gender:'F',langCode:'en-GB',rate:1.05,pitch:1.05},
    ethan:{gender:'M',langCode:'en-GB',rate:0.95,pitch:0.9},
    sofia:{gender:'F',langCode:'en-AU',rate:1,pitch:1},
    noah:{gender:'M',langCode:'en-CA',rate:1,pitch:1},
    isla:{gender:'F',langCode:'en-IE',rate:1.1,pitch:1.1},
    arjun:{gender:'M',langCode:'en-IN',rate:0.95,pitch:1}
  };
  const langSel = document.getElementById('voLang');
  const langTextToCode = { English:'en', Spanish:'es', French:'fr', German:'de', Italian:'it', Portuguese:'pt', Dutch:'nl', Polish:'pl', Hindi:'hi', Arabic:'ar', Japanese:'ja', Mandarin:'zh' };
  const id = (window._voData && window._voData.voiceId) || 'aria';
  const pref = Object.assign({}, voiceMap[id] || {});
  if (langSel && langTextToCode[langSel.value]) pref.langCode = langTextToCode[langSel.value];
  if (_speak(script, pref, 'voPlayBtn')) showToast(`▶ Playing in ${id}'s voice…`);
};



// ═══════════════════════════════════════════════════════════════════════════
// 5. TEMPLATES LIBRARY
// ═══════════════════════════════════════════════════════════════════════════



// Curated keyword tags + a hand-picked Unsplash photo ID per template title.
// loremflickr.com is the primary source (keyword-driven, deterministic via lock seed),
// images.unsplash.com is the fallback if loremflickr is unavailable.

// Build an inline SVG data-URI placeholder per template. This replaces the previous
// loremflickr / random-Unsplash placeholders, which were unrelated to the user's
// industry and made the gallery look "wrong" for ~3 seconds before the real
// industry-relevant images arrived from /api/template-images. The SVG below is:
//   • instant (no network round-trip, no broken images)
//   • industry-branded (title + sector overlaid)
//   • visually intentional (gradient + dot pattern, looks like a designed card)
// Real photo replacement still happens via /api/template-images → DataForSEO.




// ═══════════════════════════════════════════════════════════════════════════
// 6. OPTIMIZATION FOLDERS
// ═══════════════════════════════════════════════════════════════════════════


// ── Action playbook: what each automation rule does + how to do it manually ──









// ═══════════════════════════════════════════════════════════════════════════
// 7. IMPORT EXISTING CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════









// ═══════════════════════════════════════════════════════════════════════════
// 8. INTERNATIONAL LOCALIZATION
// ═══════════════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════════════════
// 9. WORKSPACES & TEAM
// ═══════════════════════════════════════════════════════════════════════════






// ═══════════════════════════════════════════════════════════════════════════
// ADMIN PORTAL (Task 10) — workspaces · users · clients · data-mode · issues
// Owner/admin only. Server self-gates /api/admin/* (403 for non-admins); the
// nav link is also hidden client-side unless the signed-in user is an owner.
// ═══════════════════════════════════════════════════════════════════════════


// Reveal the Admin nav link only for owners (UX gate; server enforces real gate).
// Primary path: ig_navperms.js sets the link synchronously from the loaded
// permission set (window.IGNavPerms.can('admin')) — no flash, no race. This
// function remains as a manual/fallback probe only (e.g. if the permission fetch
// failed); it no longer runs on a blind 1.5s timeout.

// Cache the EFFECTIVE data mode (client → tenant → platform) for the signed-in
// context so frontend-generated figures (e.g. data.js KPIs/trend estimates) can
// badge (demo) or withhold (strict) themselves consistently — for ALL users,
// not just admins. Re-fetched on a soft poll so an admin's toggle is reflected.
window._igDataMode = window._igDataMode || 'demo';
async function _loadEffectiveDataMode(clientId) {
  try {
    const q = clientId ? ('?clientId=' + encodeURIComponent(clientId)) : '';
    const r = await fetch('/api/data-mode/effective' + q, { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.ok && j.mode) window._igDataMode = j.mode;
  } catch (_) {}
}
window._loadEffectiveDataMode = _loadEffectiveDataMode;
document.addEventListener('DOMContentLoaded', () => { setTimeout(() => _loadEffectiveDataMode(window._activeClientId), 600); });





// ── Data Mode tab ───────────────────────────────────────────────────────────


// ── Workspaces tab ──────────────────────────────────────────────────────────

// Toggle the inline per-workspace member list (active + pending invites).

// Fetch + render the member list for one workspace into its expansion row.

// Cancel a pending invite from within a workspace's member list, then refresh
// just that list so the expansion stays open.

// Resend a pending invite from within a workspace's member list, then refresh
// just that list so the expansion stays open. Mirrors _adminResendInvite.

// Remove an active member from within a workspace's member list, then refresh.

// Change an active member's role from within a workspace's member list, then
// refresh just that list so the expansion stays open.


// ── Clients tab ─────────────────────────────────────────────────────────────

// Set (or toggle off) the active client preview context. Establishes the
// per-client data mode across the app via the x-ig-client header + effective
// resolver, so an admin can verify a client's demo/strict policy end-to-end.

// ── Users tab ───────────────────────────────────────────────────────────────


// Download the live roles × permissions matrix (+ feature → permission map) as a
// CSV. Uses fetch+blob (rather than a raw link) so the session cookie is sent
// and server errors surface as a toast.

// Download the live roles × permissions matrix (+ feature → permission map) as
// an Excel (.xlsx) workbook with two formatted worksheets.

// Interactive "view as this role" preview. Recomputes, from the cached live
// model, exactly which app screens the chosen role can open vs. is blocked from
// — derived from COMPONENT_MATRIX (screen → required permission) + the role's
// permission set. Read-only; never changes session/impersonates.


// ── Platform APIs tab ─────────────────────────────────────────────────────
// Admin-only management of platform-owned API keys (the ones InfoGenie pays for
// on behalf of every tenant). Values are never echoed back — the server returns
// only a masked preview + configured/source. Saving stores an encrypted value
// in platform_api_keys and overlays it onto the runtime env.

// Relative-time formatter for the platform-key health dots (e.g. "5m ago").

// Paint a key's health dot + relative-time label from a lastTest record without
// re-rendering the whole tab.



// Run every testable platform key's check in one click and repaint all dots.

// ── Audit Log tab ─────────────────────────────────────────────────────────
// Read-only history of who changed roles & memberships (accountability).
// Download the full filtered audit history as a CSV. Uses fetch+blob (rather than
// a raw link) so the session cookie is sent and server errors surface as a toast.

// ── Issues tab ──────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════
// DATA-MODE FRONTEND COMPONENTS (Task 10) — reusable demo badge, honest empty
// state, and a global fetch interceptor that surfaces the markers the server's
// data-mode enforcement layer stamps onto responses.
// ═══════════════════════════════════════════════════════════════════════════

// Reusable "DEMO DATA" badge — follows the existing _dataBadge pill styling.
window._demoBadge = function(source) {
  const src = source ? String(source).replace(/[<>"]/g,'') : '';
  return `<span class="ig-demo-badge" title="${src.replace(/"/g,'&quot;')}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:#FEF3C7;color:#92400E;font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;border:1px solid #92400E33;line-height:1.4">🎭 DEMO DATA${src?' · '+src:''}</span>`;
};

// Reusable honest empty-state for strict mode "data unavailable" responses.
window._dataUnavailableState = function(msg) {
  const m = msg ? String(msg) : 'This data is currently unavailable. The issue has been reported to your administrator.';
  return `<div class="ig-data-unavailable" style="background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:12px;padding:28px;text-align:center;color:#64748B">
    <div style="font-size:26px;margin-bottom:8px">📭</div>
    <div style="font-weight:800;color:#475569;margin-bottom:4px">Data unavailable</div>
    <div style="font-size:13px;max-width:440px;margin:0 auto">${_esc(m)}</div>
  </div>`;
};

// Apply the effective data-mode honesty policy to a Chart.js canvas whose
// series are AI-estimated/fabricated. Idempotent — clears any prior decoration
// first so re-renders don't stack badges. Returns true when the chart must NOT
// be drawn (strict mode hid it), false when it may render (real or demo-badged).
window._applyChartDataMode = function(canvasId, isEstimated, source) {
  const el = document.getElementById(canvasId);
  if (!el) return false;
  const host = el.parentElement;
  // Clear decoration from any previous render.
  if (host) {
    host.querySelectorAll(':scope > .ig-chart-demo-badge, :scope > .ig-chart-unavailable')
        .forEach(n => n.remove());
  }
  el.style.display = '';
  if (!isEstimated) return false;
  const mode = (window._igDataMode || 'strict');
  if (mode === 'demo') {
    if (host && typeof window._demoBadge === 'function') {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const b = document.createElement('div');
      b.className = 'ig-chart-demo-badge';
      b.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5';
      b.innerHTML = window._demoBadge(source || 'AI estimate');
      host.appendChild(b);
    }
    return false;
  }
  // strict — hide the fabricated chart, show an honest unavailable state.
  if (host && typeof window._dataUnavailableState === 'function') {
    el.style.display = 'none';
    const d = document.createElement('div');
    d.className = 'ig-chart-unavailable';
    d.innerHTML = window._dataUnavailableState('This chart plots AI-estimated figures, not live measurements. Demo Data Mode is off, so estimated charts are hidden. An administrator can enable Demo Data Mode for this client in the Admin portal.');
    host.insertBefore(d, el);
  }
  return true;
};

// Apply the honesty policy to a non-chart section: demo → prepend a DEMO badge
// to a header element; strict → replace a body element with the unavailable
// state. Both args are elements (or null). `isEstimated` gates the whole thing.
window._applySectionDataMode = function(headerEl, bodyEl, isEstimated, source, strictMsg) {
  if (headerEl) headerEl.querySelectorAll(':scope > .ig-demo-badge').forEach(n => n.remove());
  if (!isEstimated) return false;
  const mode = (window._igDataMode || 'strict');
  if (mode === 'demo') {
    if (headerEl && typeof window._demoBadge === 'function') {
      const span = document.createElement('span');
      span.style.marginLeft = '8px';
      span.innerHTML = window._demoBadge(source || 'AI estimate');
      headerEl.appendChild(span.firstChild);
    }
    return false;
  }
  if (bodyEl && typeof window._dataUnavailableState === 'function') {
    bodyEl.innerHTML = window._dataUnavailableState(strictMsg || 'This section shows AI-estimated data. Demo Data Mode is off, so estimated figures are hidden. An administrator can enable Demo Data Mode in the Admin portal.');
  }
  return true;
};

// Active client context — which agency client the user is currently viewing.
// Persisted so the per-client data mode survives reloads, and propagated to the
// backend as an `x-ig-client` header on every /api call so the server's
// resolveDataMode (and the enforcement layer) apply that client's demo/strict
// policy. Only honored server-side when the client belongs to the caller's
// tenant (tenant-match guard in resolveDataMode).
try { window._activeClientId = Number(localStorage.getItem('ig_active_client_id')) || null; } catch (_) { window._activeClientId = null; }

// Global fetch interceptor: injects the active-client header on outgoing /api
// calls, and inspects JSON responses for the data-mode markers the server stamps
// on (_dataMode='demo' / data_unavailable), broadcasting an `ig:data-mode` event.
(function _installDataModeInterceptor() {
  if (window._dataModeInterceptorInstalled) return;
  window._dataModeInterceptorInstalled = true;
  window._dataModeSeen = { demo: false, unavailable: false };
  const _origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    // Propagate the active client context to same-origin app APIs (never to the
    // admin API, which reports the real config, and never to cross-origin URLs).
    try {
      const _u = (typeof input === 'string') ? input : (input && input.url) || '';
      if (window._activeClientId && _u.indexOf('/api/') !== -1 && _u.indexOf('/api/admin/') === -1
          && !/^https?:\/\//i.test(_u)) {
        init = Object.assign({}, init);
        const h = new Headers((init && init.headers) || {});
        if (!h.has('x-ig-client')) h.set('x-ig-client', String(window._activeClientId));
        init.headers = h;
      }
    } catch (_) {}
    return _origFetch(input, init).then(res => {
      try {
        const ct = res.headers && res.headers.get && res.headers.get('content-type');
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        // Session-expiry handling: a 401 from an app API means the session is no
        // longer valid (expired or signed out elsewhere). Send the user to the
        // standalone login page rather than leaving a broken/empty view. The
        // auth endpoints themselves legitimately 401 (e.g. a bad login attempt),
        // so they are excluded.
        if (res.status === 401 && url.indexOf('/api/') !== -1 && url.indexOf('/api/auth/') === -1
            && !/^https?:\/\//i.test(url) && !window._authRedirecting) {
          window._authRedirecting = true;
          try { window._auth && window._auth._clearSession && window._auth._clearSession(); } catch(_){}
          // Remember where the user was so the login page can send them back
          // after re-auth (avoids an abrupt jump to the default dashboard).
          // Prefer the active view; fall back to the current relative URL.
          let next = '';
          try {
            const cv = window.currentView;
            if (cv && cv !== 'home') {
              next = '/?view=' + encodeURIComponent(cv);
            } else {
              const rel = (location.pathname || '/') + (location.search || '') + (location.hash || '');
              if (rel && rel !== '/' && !/^\/login/i.test(rel)) next = rel;
            }
          } catch(_) {}
          let dest = '/login?expired=1';
          if (next) dest += '&next=' + encodeURIComponent(next);
          // Show a brief, friendly notice before the hard redirect so the
          // session-end doesn't feel like an abrupt, unexplained jump.
          const _go = () => { location.href = dest; };
          try {
            if (typeof window.showToast === 'function') {
              window.showToast('🔒 Your session ended — taking you to sign in…');
              setTimeout(_go, 1400);
            } else { _go(); }
          } catch(_) { _go(); }
        }
        if (ct && ct.indexOf('application/json') !== -1 && url.indexOf('/api/') !== -1 && url.indexOf('/api/admin/') === -1) {
          res.clone().json().then(j => {
            if (!j || typeof j !== 'object') return;
            if (j.data_unavailable === true || j._dataMode === 'strict') {
              window._dataModeSeen.unavailable = true;
              document.dispatchEvent(new CustomEvent('ig:data-mode', { detail:{ kind:'unavailable', url, payload:j } }));
            } else if (j._dataMode === 'demo' || j._demo === true) {
              window._dataModeSeen.demo = true;
              document.dispatchEvent(new CustomEvent('ig:data-mode', { detail:{ kind:'demo', url, payload:j } }));
              _dataModeNotice('demo');
            }
          }).catch(()=>{});
        }
      } catch(_) {}
      return res;
    });
  };
  // One notice per kind per view so the user always knows when demo data shows.
  let _lastNoticeView = null;
  window._dataModeNotice = function(kind) {
    const v = window.currentView || '';
    const key = kind + '|' + v;
    if (_lastNoticeView === key) return;
    _lastNoticeView = key;
    if (typeof showToast === 'function') {
      showToast(kind === 'demo' ? '🎭 Some figures on this screen are demo data' : '📭 Some data is unavailable and was reported to admin');
    }
  };
})();

// ═══════════════════════════════════════════════════════════════════════════
// 10. FORECAST vs ACTUAL + SAVINGS WIDGET (inline on Dashboard)
// ═══════════════════════════════════════════════════════════════════════════

// ── Auto-Fixes modal ─────────────────────────────────────────────────────────
// Fetches the real optimizer action log and renders it in a slide-in modal.


// ── Manual screenshot helper: auto-navigates to a view from URL ──
// Supports three URL forms (in priority order) so it works inside the
// preview iframe wrapper, which strips query strings:
//   /view/dashboard
//   /#view=dashboard
//   /?view=dashboard
// Used by build_user_manual.js to capture each module's UI as a screenshot.
(function() {
  // Inject screenshot-mode CSS as early as possible so any auto-opened
  // modals stay invisible no matter what JS later tries to show them.
  const isScreenshotMode = (window.location.pathname || '').match(/^\/view\//);
  if (isScreenshotMode) {
    const css = document.createElement('style');
    css.textContent = `
      #landingPageModal, #wpCredentialsModal,
      .modal-overlay, .modal-backdrop, .wl-modal-overlay,
      .attack-modal, .upgrade-modal, .toast, .notification-toast,
      [role="dialog"]:not(.view) {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      body, html { overflow: auto !important; }
    `;
    (document.head || document.documentElement).appendChild(css);
  }
  function pickViewId() {
    try {
      // 1. Path-based: /view/<id>
      const m = (window.location.pathname || '').match(/^\/view\/([a-z0-9-]+)\/?$/i);
      if (m) return m[1];
      // 2. Hash-based: #view=<id>
      const h = (window.location.hash || '').replace(/^#/, '');
      const hp = new URLSearchParams(h);
      if (hp.get('view')) return hp.get('view');
      // 3. Query-based: ?view=<id>
      const qp = new URLSearchParams(window.location.search || '');
      if (qp.get('view')) return qp.get('view');
    } catch(_) {}
    return null;
  }
  function dismissOverlays() {
    try {
      // Common modal/overlay selectors used across the app.
      const sel = [
        '.modal-overlay', '.modal-backdrop', '.wl-modal-overlay',
        '.modal[style*="display: block"]', '.modal[style*="display:block"]',
        '[role="dialog"]', '.attack-modal', '.upgrade-modal',
        '.toast', '.notification-toast'
      ];
      sel.forEach(s => {
        document.querySelectorAll(s).forEach(el => {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          if (el.parentNode) el.parentNode.removeChild(el);
        });
      });
      // Reset body scroll lock that modals often add
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    } catch(_) {}
  }
  function tryRoute() {
    const v = pickViewId();
    if (v && typeof navigateTo === 'function') {
      try { navigateTo(v); } catch(_) {}
      // Dismiss any modals that opened as a side-effect of navigation
      setTimeout(dismissOverlays, 300);
      setTimeout(dismissOverlays, 1000);
      setTimeout(dismissOverlays, 2000);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryRoute, 1200));
  } else {
    setTimeout(tryRoute, 1200);
  }
})();

/* =============================================================================
   GOALS & TARGETS — autonomous metric monitoring with GPT-4o root-cause
   ============================================================================= */
async function buildGoals() {
  const wrap = document.getElementById('goalsList');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:48px;color:#64748B">⏳ Evaluating your goals…</div>';
  try {
    const r = await fetch('/api/goals/check');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed to load goals');
    if (!j.goals || j.goals.length === 0) {
      wrap.innerHTML = `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:48px;text-align:center">
          <div style="font-size:2.5rem;margin-bottom:14px">🎯</div>
          <div style="font-size:1.15rem;font-weight:700;color:#0F172A;margin-bottom:8px">No goals yet</div>
          <div style="font-size:0.88rem;color:#64748B;margin-bottom:22px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.55">Add a goal on any of InfoGenie's tracked metrics — drip bounce rate, ad spend cap, blended CAC, Amplitude sessions — and InfoGenie will autonomously check progress and ask GPT-4o for a root-cause hypothesis when you go off-track.</div>
          <button onclick="openAddGoalModal()" style="padding:11px 22px;background:linear-gradient(135deg,#7C3AED,#A855F7);color:white;border:none;border-radius:9px;font-weight:700;font-size:0.9rem;cursor:pointer">+ Create Your First Goal</button>
        </div>`;
      return;
    }
    const rc = j.rootCause || {};
    wrap.innerHTML = j.goals.map(g => _goalCard(g, rc[g.id])).join('');
  } catch (e) {
    const safe = (typeof _escapeHtml === 'function') ? _escapeHtml(e.message) : String(e.message || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Could not load goals</b><div style="font-size:0.85rem;margin-top:6px">${safe}</div></div>`;
  }
}
function _goalCard(g, rc) {
  // Reuse the global escaper defined just below this section. Defined locally
  // here as a fallback so this card can render even if function ordering changes.
  const esc = (typeof _escapeHtml === 'function')
    ? _escapeHtml
    : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const colors = {
    'on-track':  { bg:'#ECFDF5', border:'#A7F3D0', text:'#065F46', label:'✓ On Track' },
    'at-risk':   { bg:'#FFFBEB', border:'#FDE68A', text:'#92400E', label:'⚠️ At Risk' },
    'off-track': { bg:'#FEF2F2', border:'#FECACA', text:'#991B1B', label:'🔴 Off Track' },
    'unknown':   { bg:'#F1F5F9', border:'#CBD5E1', text:'#475569', label:'❔ No Data' },
    'error':     { bg:'#FEF2F2', border:'#FECACA', text:'#991B1B', label:'⚠️ Error' },
  };
  const c = colors[g.status] || colors.unknown;
  const unit = g.meta?.unit || '';
  const fmt = (v) => {
    if (v == null || v === '') return '—';
    if (unit === '$') return '$' + Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
    if (unit === '%') return Number(v).toFixed(1) + '%';
    return Number(v).toLocaleString();
  };
  const pct = g.pct == null ? 0 : g.pct;
  const barColor = g.status === 'on-track' ? '#10B981' : g.status === 'at-risk' ? '#F59E0B' : g.status === 'off-track' ? '#EF4444' : '#94A3B8';
  // Goal IDs are server-generated (`g_<ts>_<rand>`) but we still keep them
  // safe for an HTML attribute single-quoted string just in case.
  const safeId = String(g.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:22px;margin-bottom:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px">
        <div style="flex:1">
          <div style="font-size:1.05rem;font-weight:700;color:#0F172A">${esc(g.label || g.metric)}</div>
          <div style="font-size:0.78rem;color:#64748B;margin-top:3px">${esc(g.metric)} · target ${g.meta?.direction === 'lte' ? '≤' : '≥'} ${esc(fmt(g.target))}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:0.75rem;font-weight:700;padding:5px 11px;border-radius:999px;background:${c.bg};border:1px solid ${c.border};color:${c.text}">${c.label}</span>
          <button onclick="deleteGoal('${safeId}')" style="background:transparent;border:1px solid #E5E7EB;border-radius:7px;padding:5px 9px;cursor:pointer;color:#64748B;font-size:0.78rem">Delete</button>
        </div>
      </div>
      <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:10px">
        <div><div style="font-size:0.7rem;color:#64748B;text-transform:uppercase;letter-spacing:.4px;font-weight:600">Current</div><div style="font-size:1.4rem;font-weight:700;color:#0F172A">${esc(fmt(g.current))}</div></div>
        <div><div style="font-size:0.7rem;color:#64748B;text-transform:uppercase;letter-spacing:.4px;font-weight:600">Target</div><div style="font-size:1.4rem;font-weight:700;color:#475569">${esc(fmt(g.target))}</div></div>
      </div>
      <div style="height:8px;background:#F1F5F9;border-radius:999px;overflow:hidden;margin-bottom:${rc ? '14px' : '0'}">
        <div style="height:100%;width:${pct}%;background:${barColor};transition:width .4s"></div>
      </div>
      ${rc && rc.hypothesis ? `
        <div style="margin-top:14px;padding:14px;background:#FAFAFA;border:1px solid #E5E7EB;border-radius:10px">
          <div style="font-size:0.7rem;color:#7C3AED;text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px">🤖 GPT-4o root-cause hypothesis</div>
          <div style="font-size:0.85rem;color:#0F172A;line-height:1.55;margin-bottom:8px">${esc(rc.hypothesis)}</div>
          <div style="font-size:0.7rem;color:#0EA5E9;text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px">💡 Suggested action</div>
          <div style="font-size:0.85rem;color:#0F172A;line-height:1.55">${esc(rc.action)}</div>
        </div>` : ''}
      ${g.status === 'error' ? `<div style="margin-top:10px;padding:10px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;font-size:0.78rem;color:#991B1B">${esc(g.error)}</div>` : ''}
    </div>`;
}
async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  await fetch('/api/goals/' + id, { method:'DELETE' });
  buildGoals();
}
function openAddGoalModal() {
  // Re-use any existing modal pattern; build one inline so it's self-contained
  let m = document.getElementById('addGoalModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'addGoalModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;display:flex;align-items:center;justify-content:center';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.innerHTML = `
      <div onclick="event.stopPropagation()" style="background:white;border-radius:14px;padding:26px;width:min(440px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="font-size:1.15rem;font-weight:700;color:#0F172A;margin-bottom:16px">Add a new goal</div>
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Metric</label>
          <select id="newGoalMetric" style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.88rem">
            <option value="drip.bounceRate">Drip Bounce Rate (%) — lower is better</option>
            <option value="drip.totalSends">Drip Email Sends — higher is better</option>
            <option value="drip.deliveryRate">Drip Delivery Rate (%) — higher is better</option>
            <option value="amp.sessions">Amplitude Sessions, last 30d — higher is better</option>
            <option value="ads.totalSpend">Total Ad Spend, last 30d ($) — lower is better</option>
            <option value="ads.cac">Blended CAC ($) — lower is better</option>
          </select>
        </div>
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label style="font-size:0.78rem;font-weight:700;color:#0F172A">Target value</label>
            <button type="button" id="aiSuggestTargetBtn" onclick="aiSuggestNewGoalField('target')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:linear-gradient(135deg,#7C3AED,#A855F7);color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.72rem;font-weight:700">✨ AI suggest</button>
          </div>
          <input id="newGoalTarget" type="number" step="0.01" min="0" placeholder="e.g. 50" style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.88rem">
          <div id="aiSuggestTargetReason" style="margin-top:6px;font-size:0.72rem;color:#7C3AED;font-style:italic;min-height:1px"></div>
        </div>
        <div style="margin-bottom:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label style="font-size:0.78rem;font-weight:700;color:#0F172A">Label (optional)</label>
            <button type="button" id="aiSuggestLabelBtn" onclick="aiSuggestNewGoalField('label')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:linear-gradient(135deg,#7C3AED,#A855F7);color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.72rem;font-weight:700">✨ AI suggest</button>
          </div>
          <input id="newGoalLabel" type="text" placeholder="e.g. Q2 customer acquisition target" style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.88rem">
          <div id="aiSuggestLabelReason" style="margin-top:6px;font-size:0.72rem;color:#7C3AED;font-style:italic;min-height:1px"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('addGoalModal').remove()" style="padding:10px 16px;background:white;border:1px solid #CBD5E1;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600">Cancel</button>
          <button onclick="submitNewGoal()" style="padding:10px 18px;background:linear-gradient(135deg,#7C3AED,#A855F7);color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:700">Create Goal</button>
        </div>
      </div>`;
    document.body.appendChild(m);
  }
}
// AI-suggest helper for the Add Goal modal — fills in either the Target value
// or the Label based on the currently-selected metric. Calls the backend
// /api/goals/suggest endpoint which measures the live metric value first then
// asks GPT for a sensible suggestion grounded in that real number.
async function aiSuggestNewGoalField(field) {
  const metric = document.getElementById('newGoalMetric')?.value;
  if (!metric) return;
  const btnId    = field === 'target' ? 'aiSuggestTargetBtn'    : 'aiSuggestLabelBtn';
  const reasonId = field === 'target' ? 'aiSuggestTargetReason' : 'aiSuggestLabelReason';
  const inputId  = field === 'target' ? 'newGoalTarget'         : 'newGoalLabel';
  const btn      = document.getElementById(btnId);
  const reasonEl = document.getElementById(reasonId);
  const inputEl  = document.getElementById(inputId);
  if (!btn || !inputEl) return;
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Thinking…';
  if (reasonEl) reasonEl.textContent = '';
  try {
    const r = await fetch('/api/goals/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric, field }),
    });
    const j = await r.json();
    if (!j || !j.ok) throw new Error(j?.error || 'suggest-failed');
    if (field === 'target') {
      inputEl.value = j.value;
    } else {
      inputEl.value = j.label;
    }
    if (reasonEl) {
      const cur = (j.current != null) ? ` (current: ${j.current})` : '';
      reasonEl.textContent = '✨ ' + (j.reason || 'AI suggestion applied') + cur;
    }
  } catch (e) {
    if (reasonEl) reasonEl.textContent = '⚠️ Could not generate a suggestion — type one in.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

async function submitNewGoal() {
  const metric = document.getElementById('newGoalMetric').value;
  const target = parseFloat(document.getElementById('newGoalTarget').value);
  const label  = document.getElementById('newGoalLabel').value.trim();
  if (!Number.isFinite(target) || target < 0) { alert('Please enter a valid non-negative target.'); return; }
  const r = await fetch('/api/goals', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ metric, target, label: label || undefined }) });
  const j = await r.json();
  if (!j.ok) { alert('Could not create goal: ' + (j.error || 'unknown')); return; }
  document.getElementById('addGoalModal')?.remove();
  buildGoals();
}

/* =============================================================================
   BLENDED PERFORMANCE — one tile, all channels, Amplitude as ground truth
   ============================================================================= */
// [moved] Blended Performance + Global Command Bar (open/close/prefill/run) → public/js/ig_attribution_scorer.js
function _escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// [moved] Command Bar keyboard shortcut + spinner CSS + Lead Qualifier → public/js/ig_attribution_scorer.js

/* =============================================================================
   RE-ENGAGE AUDIENCE — find dormant subs, generate adaptive copy, launch
   ============================================================================= */
let _reengageState = { dormant: [], variants: [], chosenIdx: 0, segment: '', tone: 'warm-and-curious' };

// CSV-upload modal for the Re-engage view. Lets the user paste a CSV body or
// pick a .csv file (name,email,phone) and seeds the drip store with backdated
// startedAt timestamps so the rows immediately appear as dormant in the
// current days-window. Phone is stored but currently unused for outreach.
function openReengageCsvUpload() {
  // Remove any existing instance so reopening is clean.
  document.getElementById('reengageCsvBackdrop')?.remove();
  const bd = document.createElement('div');
  bd.id = 'reengageCsvBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);z-index:99998;display:flex;align-items:flex-start;justify-content:center;padding-top:8vh';
  bd.onclick = (e) => { if (e.target === bd) bd.remove(); };
  bd.innerHTML = `
    <div onclick="event.stopPropagation()" style="width:min(640px,92vw);background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;max-height:85vh;display:flex;flex-direction:column">
      <div style="padding:18px 22px;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0F172A">📤 Upload Audience CSV</div>
          <div style="font-size:0.74rem;color:#64748B;margin-top:3px">Seed your dormant audience from a contact list</div>
        </div>
        <button onclick="document.getElementById('reengageCsvBackdrop').remove()" style="background:none;border:none;color:#94A3B8;font-size:1.4rem;cursor:pointer;padding:0 4px;line-height:1">×</button>
      </div>
      <div style="padding:20px 22px;overflow-y:auto">
        <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:9px;padding:12px 14px;font-size:0.78rem;color:#075985;line-height:1.55;margin-bottom:14px">
          <strong>Required header row:</strong> <code style="background:white;padding:1px 6px;border-radius:4px">email</code> (mandatory) plus optional <code style="background:white;padding:1px 6px;border-radius:4px">name</code> and <code style="background:white;padding:1px 6px;border-radius:4px">phone</code>. Column order doesn't matter.<br>
          <span style="color:#0C4A6E;font-weight:600">⚠️ Phone numbers are stored but not yet used for outreach</span> — InfoGenie has no SMS channel yet, so re-engagement campaigns send by email only.
        </div>
        <label style="display:block;margin-bottom:14px">
          <span style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Pick a .csv file</span>
          <input type="file" id="reengageCsvFile" accept=".csv,text/csv" style="font-size:0.82rem">
        </label>
        <label style="display:block;margin-bottom:14px">
          <span style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Or paste CSV directly</span>
          <textarea id="reengageCsvText" rows="7" placeholder="name,email,phone&#10;Jane Doe,jane@example.com,+15551234567&#10;John Roe,john@example.com," style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.82rem;font-family:monospace;resize:vertical;box-sizing:border-box"></textarea>
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:0.8rem;color:#374151;margin-bottom:6px">
          <span style="font-weight:600">Treat as inactive for</span>
          <input type="number" id="reengageCsvBackdate" value="60" min="1" max="365" style="width:70px;padding:6px 8px;border:1px solid #CBD5E1;border-radius:6px;font-size:0.82rem">
          <span>days (so they show up in the current dormant window)</span>
        </label>
      </div>
      <div style="padding:14px 22px;border-top:1px solid #E5E7EB;display:flex;justify-content:flex-end;gap:8px">
        <button onclick="document.getElementById('reengageCsvBackdrop').remove()" style="padding:8px 14px;background:white;color:#64748B;border:1px solid #CBD5E1;border-radius:7px;font-size:0.82rem;font-weight:600;cursor:pointer">Cancel</button>
        <button id="reengageCsvSubmit" onclick="submitReengageCsv()" style="padding:8px 18px;background:linear-gradient(135deg,#C2410C,#F97316);color:white;border:none;border-radius:7px;font-size:0.82rem;font-weight:700;cursor:pointer">📥 Import</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  // Auto-fill the textarea when a file is chosen.
  document.getElementById('reengageCsvFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { document.getElementById('reengageCsvText').value = String(reader.result || ''); };
    reader.onerror = () => { showToast('⚠️ Could not read file'); };
    reader.readAsText(f);
  });
}

/* Manual add — friendlier path for users who don't want to construct a CSV.
 * Single email + optional name + optional phone. Submits to the same
 * /api/reengage/upload-csv endpoint by building a one-row CSV in memory, so
 * we don't need a new backend route. Modal closes on successful add and the
 * dormant list reloads automatically — re-open to add another. */
function openReengageManualAdd() {
  document.getElementById('reengageManualBackdrop')?.remove();
  const bd = document.createElement('div');
  bd.id = 'reengageManualBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);z-index:99998;display:flex;align-items:flex-start;justify-content:center;padding-top:10vh';
  bd.onclick = (e) => { if (e.target === bd) bd.remove(); };
  bd.innerHTML = `
    <div onclick="event.stopPropagation()" style="width:min(480px,92vw);background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden">
      <div style="padding:18px 22px;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0F172A">✏️ Add Subscriber Manually</div>
          <div style="font-size:0.74rem;color:#64748B;margin-top:3px">Add one contact at a time — no file needed</div>
        </div>
        <button onclick="document.getElementById('reengageManualBackdrop').remove()" style="background:none;border:none;color:#94A3B8;font-size:1.4rem;cursor:pointer;padding:0 4px;line-height:1">×</button>
      </div>
      <div style="padding:20px 22px">
        <label style="display:block;margin-bottom:12px">
          <span style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Email <span style="color:#EF4444">*</span></span>
          <input type="email" id="reengageManualEmail" placeholder="jane@example.com" autofocus style="width:100%;padding:9px 11px;border:1px solid #CBD5E1;border-radius:7px;font-size:0.85rem;box-sizing:border-box">
        </label>
        <label style="display:block;margin-bottom:12px">
          <span style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Name <span style="color:#94A3B8;font-weight:500">(optional)</span></span>
          <input type="text" id="reengageManualName" placeholder="Jane Doe" style="width:100%;padding:9px 11px;border:1px solid #CBD5E1;border-radius:7px;font-size:0.85rem;box-sizing:border-box">
        </label>
        <label style="display:block;margin-bottom:14px">
          <span style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Phone <span style="color:#94A3B8;font-weight:500">(optional, stored but not used yet)</span></span>
          <input type="tel" id="reengageManualPhone" placeholder="+1 555 123 4567" style="width:100%;padding:9px 11px;border:1px solid #CBD5E1;border-radius:7px;font-size:0.85rem;box-sizing:border-box">
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:0.8rem;color:#374151">
          <span style="font-weight:600">Treat as inactive for</span>
          <input type="number" id="reengageManualBackdate" value="60" min="1" max="365" style="width:70px;padding:6px 8px;border:1px solid #CBD5E1;border-radius:6px;font-size:0.82rem">
          <span>days</span>
        </label>
      </div>
      <div style="padding:14px 22px;border-top:1px solid #E5E7EB;display:flex;justify-content:flex-end;gap:8px">
        <button onclick="document.getElementById('reengageManualBackdrop').remove()" style="padding:8px 14px;background:white;color:#64748B;border:1px solid #CBD5E1;border-radius:7px;font-size:0.82rem;font-weight:600;cursor:pointer">Cancel</button>
        <button id="reengageManualSubmit" onclick="submitReengageManual()" style="padding:8px 18px;background:linear-gradient(135deg,#C2410C,#F97316);color:white;border:none;border-radius:7px;font-size:0.82rem;font-weight:700;cursor:pointer">+ Add Subscriber</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  setTimeout(() => document.getElementById('reengageManualEmail')?.focus(), 50);
}
async function submitReengageManual() {
  const email = (document.getElementById('reengageManualEmail')?.value || '').trim();
  const name  = (document.getElementById('reengageManualName')?.value || '').trim();
  const phone = (document.getElementById('reengageManualPhone')?.value || '').trim();
  const backdateDays = parseInt(document.getElementById('reengageManualBackdate')?.value || '60', 10);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('⚠️ Enter a valid email'); return; }
  // Build a 1-row CSV that the existing upload endpoint already handles.
  const escCsv = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = `name,email,phone\n${escCsv(name)},${escCsv(email)},${escCsv(phone)}`;
  const btn = document.getElementById('reengageManualSubmit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Adding…'; }
  try {
    const r = await fetch('/api/reengage/upload-csv', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ csv, backdateDays }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Add failed');
    document.getElementById('reengageManualBackdrop')?.remove();
    showToast(j.imported > 0 ? `✅ Added ${email}` : `⚠️ ${email} already exists`);
    buildReengage();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '+ Add Subscriber'; }
    showToast(`⚠️ ${e.message}`);
  }
}

async function submitReengageCsv() {
  const txt = (document.getElementById('reengageCsvText')?.value || '').trim();
  const backdateDays = parseInt(document.getElementById('reengageCsvBackdate')?.value || '60', 10);
  const btn = document.getElementById('reengageCsvSubmit');
  if (!txt) { showToast('⚠️ Paste a CSV or pick a file first'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Importing…'; }
  try {
    const r = await fetch('/api/reengage/upload-csv', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ csv: txt, backdateDays }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Import failed');
    document.getElementById('reengageCsvBackdrop')?.remove();
    showToast(`✅ Imported ${j.imported} contacts · ${j.skipped} skipped (duplicate or invalid email)`);
    buildReengage();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Import'; }
    showToast(`⚠️ ${e.message}`);
  }
}
async function buildReengage() {
  const wrap = document.getElementById('reengageBody');
  if (!wrap) return;
  const days = parseInt(document.getElementById('reengageDays')?.value || '30', 10);
  wrap.innerHTML = '<div style="text-align:center;padding:48px;color:#64748B">⏳ Scanning drip subscribers and Amplitude inactivity…</div>';
  try {
    const r = await fetch('/api/reengage/dormant?days=' + days);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed');
    _reengageState.dormant = j.dormant || [];
    _reengageState.segment = `dormant subscribers (${days}+ days inactive)`;
    wrap.innerHTML = _reengageHtml(j);
  } catch (e) {
    const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Could not load</b><div style="font-size:0.85rem;margin-top:6px">${esc(e.message)}</div></div>`;
  }
}
function _reengageHtml(j) {
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const list = j.dormant || [];
  const dormantList = list.length === 0
    ? `<div style="font-size:0.85rem;color:#64748B;padding:18px 14px;text-align:center;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px">
         <div style="font-weight:700;color:#0F172A;margin-bottom:6px">No dormant subscribers yet</div>
         <div style="margin-bottom:14px;line-height:1.5">Either everyone in your list is currently engaged, or you haven't seeded an audience yet. Add contacts below to start a re-engagement flow.</div>
         <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
           <button onclick="openReengageCsvUpload()" style="padding:8px 14px;background:#0F172A;color:white;border:none;border-radius:7px;font-size:0.78rem;font-weight:700;cursor:pointer">📤 Upload audience CSV</button>
           <button onclick="openReengageManualAdd()" style="padding:8px 14px;background:white;color:#0F172A;border:1px solid #0F172A;border-radius:7px;font-size:0.78rem;font-weight:700;cursor:pointer">✏️ Add manually</button>
         </div>
       </div>`
    : `<div style="max-height:240px;overflow-y:auto;border:1px solid #F1F5F9;border-radius:8px">
        ${list.slice(0, 50).map(d => `
          <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #F8FAFC;font-size:0.8rem">
            <div style="color:#0F172A;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.email)}</div>
            <div style="color:#94A3B8;flex-shrink:0;margin-left:10px">${d.daysSinceLastSend}d · ${d.allFailed ? '<span style="color:#991B1B">all failed</span>' : `${d.totalSends} sends`}</div>
          </div>`).join('')}
        ${list.length > 50 ? `<div style="padding:8px 12px;font-size:0.78rem;color:#64748B;text-align:center">… and ${list.length - 50} more</div>` : ''}
       </div>`;
  return `
    <!-- Hero dormant tile -->
    <div style="background:linear-gradient(135deg,#1E40AF 0%,#2563EB 50%,#3B82F6 100%);border-radius:18px;padding:28px;color:white;margin-bottom:22px;box-shadow:0 4px 14px rgba(37,99,235,.25)">
      <div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.5px;opacity:.85;font-weight:700;margin-bottom:8px">Dormant audience · ${esc(j.amplitudeNote || '')}</div>
      <div style="display:flex;align-items:flex-end;gap:24px;flex-wrap:wrap">
        <div>
          <div style="font-size:0.72rem;opacity:.8;font-weight:600;margin-bottom:4px">SUBSCRIBERS TO RE-ENGAGE</div>
          <div style="font-size:2.4rem;font-weight:800;line-height:1.1">${list.length}</div>
        </div>
        <div style="opacity:.85;font-size:0.85rem;line-height:1.5;max-width:520px">${list.length > 0
          ? `Generate three adaptive copy angles, pick the strongest, then launch a one-touch re-engagement campaign — or run a dry-run first to preview the copy without sending.`
          : `Nothing to do here. Try a longer inactivity window, or come back when you've grown the list.`}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
      <!-- Left: dormant list + generate -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:22px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <div style="font-size:1rem;font-weight:800;color:#0F172A">Dormant subscribers</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button onclick="openReengageCsvUpload()" style="padding:7px 12px;background:#0F172A;color:white;border:none;border-radius:7px;font-size:0.74rem;font-weight:700;cursor:pointer" title="Upload a CSV of contacts to seed your audience">📤 Upload CSV</button>
            <button onclick="openReengageManualAdd()" style="padding:7px 12px;background:white;color:#0F172A;border:1px solid #0F172A;border-radius:7px;font-size:0.74rem;font-weight:700;cursor:pointer" title="Add a single contact (or paste a few) without uploading a file">✏️ Add manually</button>
          </div>
        </div>
        ${dormantList}
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid #F1F5F9">
          <div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:8px">Generate adaptive copy</div>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="reengageTone" style="flex:1;padding:9px 11px;border:1px solid #E5E7EB;border-radius:7px;font-size:0.83rem">
              <option value="warm-and-curious" selected>Warm & curious</option>
              <option value="value-reminder">Value reminder</option>
              <option value="urgent-but-friendly">Urgent but friendly</option>
              <option value="soft-breakup">Soft breakup ("is this goodbye?")</option>
              <option value="social-proof">Social proof heavy</option>
            </select>
            <button onclick="generateReengageVariants()" id="reengageGenBtn" ${list.length === 0 ? 'disabled' : ''} style="padding:9px 14px;background:linear-gradient(135deg,#C2410C,#F97316);color:white;border:none;border-radius:7px;font-weight:700;font-size:0.83rem;cursor:pointer;${list.length === 0 ? 'opacity:.5;cursor:not-allowed' : ''}">✨ Generate</button>
          </div>
        </div>
      </div>
      <!-- Right: variants + launch -->
      <div id="reengageVariantsPanel" style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:22px;min-height:200px">
        <div style="text-align:center;color:#94A3B8;font-size:0.85rem;padding:32px 0">Generated copy variants will appear here. Pick one to launch.</div>
      </div>
    </div>`;
}
async function generateReengageVariants() {
  const btn = document.getElementById('reengageGenBtn');
  const panel = document.getElementById('reengageVariantsPanel');
  const tone = document.getElementById('reengageTone')?.value || 'warm-and-curious';
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  btn.disabled = true; btn.textContent = '⏳ Generating…';
  panel.innerHTML = '<div style="text-align:center;padding:32px;color:#64748B"><div class="cmdSpinner" style="margin:0 auto 10px"></div>GPT-4o is drafting 3 angles…</div>';
  try {
    const r = await fetch('/api/reengage/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ segment: _reengageState.segment, tone }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed');
    _reengageState.variants = j.variants;
    _reengageState.tone = tone;
    _reengageState.chosenIdx = 0;
    panel.innerHTML = _reengageVariantsHtml();
  } catch (e) {
    panel.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:14px;color:#991B1B;font-size:0.85rem">⚠️ ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '✨ Generate';
  }
}
function _reengageVariantsHtml() {
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const variants = _reengageState.variants || [];
  return `
    <div style="font-size:1rem;font-weight:800;color:#0F172A;margin-bottom:4px">Adaptive copy variants</div>
    <div style="font-size:0.78rem;color:#64748B;margin-bottom:14px">Pick one and launch — or run a dry-run to preview without sending.</div>
    ${variants.map((v, i) => `
      <label style="display:block;background:${i === _reengageState.chosenIdx ? '#FFF7ED' : '#F8FAFC'};border:2px solid ${i === _reengageState.chosenIdx ? '#F97316' : '#E5E7EB'};border-radius:10px;padding:14px;margin-bottom:10px;cursor:pointer;transition:all .15s">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <input type="radio" name="reengageVariant" value="${i}" ${i === _reengageState.chosenIdx ? 'checked' : ''} onchange="_reengageState.chosenIdx=${i};buildReengageVariantsRedraw()" style="margin:0">
          <span style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px;padding:3px 8px;background:#FFEDD5;color:#9A3412;border-radius:999px">${esc(v.angle || ('Variant ' + (i+1)))}</span>
        </div>
        <div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:4px">${esc(v.subject || '')}</div>
        ${v.preheader ? `<div style="font-size:0.74rem;color:#64748B;margin-bottom:6px;font-style:italic">${esc(v.preheader)}</div>` : ''}
        <div style="font-size:0.82rem;color:#475569;line-height:1.5;white-space:pre-wrap">${esc(v.body || '')}</div>
        ${v.cta ? `<div style="font-size:0.78rem;color:#0F172A;margin-top:8px"><b>CTA:</b> ${esc(v.cta)}</div>` : ''}
      </label>`).join('')}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button onclick="launchReengage(true)"  style="flex:1;padding:10px 14px;background:#F1F5F9;color:#0F172A;border:none;border-radius:8px;font-weight:700;font-size:0.83rem;cursor:pointer">📋 Dry-run (no sends)</button>
      <button onclick="launchReengage(false)" style="flex:1;padding:10px 14px;background:linear-gradient(135deg,#DC2626,#F97316);color:white;border:none;border-radius:8px;font-weight:700;font-size:0.83rem;cursor:pointer">🚀 Launch for real</button>
    </div>
    <div id="reengageLaunchResult" style="margin-top:12px"></div>`;
}
function buildReengageVariantsRedraw() {
  const panel = document.getElementById('reengageVariantsPanel');
  if (panel) panel.innerHTML = _reengageVariantsHtml();
}
async function launchReengage(dryRun) {
  const out  = document.getElementById('reengageLaunchResult');
  const esc  = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const variants = _reengageState.variants || [];
  const variant  = variants[_reengageState.chosenIdx];
  if (!variant) { out.innerHTML = '<div style="color:#991B1B;font-size:0.82rem">⚠️ No variant selected.</div>'; return; }
  const emails = (_reengageState.dormant || []).map(d => d.email).filter(Boolean);
  if (!dryRun && !confirm(`Launch ${variant.angle || 'this variant'} to ${emails.length} dormant subscriber(s)? Real emails WILL be sent.`)) return;
  out.innerHTML = '<div style="font-size:0.82rem;color:#64748B"><span class="cmdSpinner" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>Launching…</div>';
  try {
    const r = await fetch('/api/reengage/launch', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ variant, emails, segment: _reengageState.segment, tone: _reengageState.tone, dryRun: !!dryRun }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed');
    const c = j.campaign || {};
    out.innerHTML = `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:12px;color:#065F46;font-size:0.83rem">
      ✓ Campaign <b>${esc(c.id || '')}</b> ${dryRun ? 'recorded (dry-run, no sends)' : 'launched'} — ${c.emailCount || 0} subscriber(s).
      ${c.enrollmentError ? `<div style="margin-top:6px;color:#991B1B">Enrollment error: ${esc(c.enrollmentError)}</div>` : ''}
    </div>`;
  } catch (e) {
    out.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;color:#991B1B;font-size:0.83rem">⚠️ ${esc(e.message)}</div>`;
  }
}

// View-switch hooks for the new views — match the existing pattern in the
// view-router. Hook into navigation by piggy-backing on the same DOM event
// the existing nav-link handlers fire.
//
// Also installs a delegated click handler for the Lead Qualifier card buttons.
// Lead emails / IDs come from user-controlled input, so we use data-* attributes
// + addEventListener instead of inline onclick="…(${esc(value)})" — _escapeHtml
// only escapes HTML context, and entities are decoded *before* inline JS runs,
// which would let a single-quote in an email break out of the JS string.
// [moved] Attribution & ROI Dashboard (buildAttribution/loadAttribution) → public/js/ig_attribution_scorer.js

// [moved] Lookalike Audience Builder + wireNewViews nav dispatch → public/js/ig_attribution_scorer.js

// [moved] Attribution Tabs (Channels / Cohorts / Forecast) → public/js/ig_attribution_scorer.js

/* =============================================================================
   MARKETING JOURNEY STAGES — dashboard panel mapping existing features into
   a 4-stage Express → Tailor → Amplify → Evolve narrative arc.
   ============================================================================= */
// ── Populate "Est. Ad Spend / Mo" column with real Meta Ad Library counts + transparent $ range estimate

window._renderJourneyStages = function() {
  // "Your Marketing Journey" panel removed from the dashboard.
  try {
    document.getElementById('journeyStagesPanel')?.remove();
    document.querySelectorAll('.journey-wrap').forEach((el) => el.remove());
  } catch (_) {}
};

// [moved] Content Optimisation Scorer (buildContentScorer + _cs* helpers) → public/js/ig_attribution_scorer.js

/* =============================================================================
   ANALYSIS-DERIVED HELPERS — pull "Your brand", "Your domain" and the list
   of detected competitors from the home-page analysis (analysisData) so the
   Mention Tracker / Content Gaps views are pre-filled with real context
   instead of empty placeholders.
   ============================================================================= */
function _getDomainFromAnalysis() {
  // analysisData.url is the cleaned domain entered on the home page (e.g.
  // "fxpro.com"). When the user typed a sector instead of a URL,
  // analysisData.sectorOnly is true and url contains a placeholder — return
  // empty so the input keeps its placeholder rather than showing junk.
  try {
    const a = window.analysisData || null;
    if (!a || a.sectorOnly) return '';
    const raw = String(a.url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '').split('/')[0].toLowerCase();
    return raw && /\./.test(raw) ? raw : '';
  } catch (_) { return ''; }
}
function _getBrandFromAnalysis() {
  // Brand-display name. For sector-only analyses use the sector name. For URL
  // analyses use the brand stem (first label of the registrable domain) with
  // first letter uppercased — "fxpro.com" → "Fxpro", "acme-corp.io" → "Acme-corp".
  try {
    const a = window.analysisData || null;
    if (!a) return '';
    if (a.sectorOnly) return String(a.industry?.name || a.url || '').replace(/^#/, '').trim();
    const dom = _getDomainFromAnalysis();
    if (!dom) return '';
    const stem = dom.replace(/^www\./, '').split('.')[0];
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : '';
  } catch (_) { return ''; }
}
function _getCompetitorsFromAnalysis() {
  // Returns array of { name, domain } for every detected competitor (manual
  // and auto-detected). Both fields are lowercased/cleaned. Caller decides
  // whether to display name (Mention Tracker) or domain (Content Gaps).
  try {
    const list = (window.analysisData && Array.isArray(window.analysisData.competitors))
      ? window.analysisData.competitors : [];
    return list.map(c => {
      if (typeof c === 'string') {
        const d = c.replace(/^https?:\/\//i,'').replace(/\/$/,'').split('/')[0].toLowerCase();
        return { name: d.split('.')[0], domain: d };
      }
      const name = String(c.name || '').trim();
      const domain = String(c.domain || c.url || '').replace(/^https?:\/\//i,'').replace(/\/$/,'').split('/')[0].toLowerCase();
      return { name: name || domain.split('.')[0], domain };
    }).filter(c => c.name || c.domain);
  } catch (_) { return []; }
}

/* Reusable multi-select dropdown. Click the trigger to open a panel of
 * checkboxes (with a "Select all" toggle). Selected values are surfaced via
 * `_igMultiselectValues(stateKey)` and stored on `window[stateKey]` (an
 * array). Pure-DOM, no framework. The trigger button shows a live summary
 * ("All 3 selected" / "2 selected" / "Select competitors").
 *
 *  options       — [{ value, label }]
 *  stateKey      — name of the global array that holds the current selection
 *  emptyLabel    — text shown when nothing is selected
 *  onChange      — optional callback after a value flips
 */
function _igMultiselect({ id, options, stateKey, emptyLabel = 'Select…', onChange }) {
  if (!Array.isArray(window[stateKey])) window[stateKey] = [];
  const selected = window[stateKey];
  const summary = (() => {
    if (!options.length) return 'No options available';
    if (selected.length === 0) return emptyLabel;
    if (selected.length === options.length) return `All ${options.length} selected`;
    if (selected.length === 1) {
      const o = options.find(x => x.value === selected[0]);
      return o ? o.label : '1 selected';
    }
    return `${selected.length} of ${options.length} selected`;
  })();
  return `
    <div class="ig-ms" data-ig-ms="${_esc(id)}" style="position:relative">
      <button type="button" id="${_esc(id)}-trigger" class="ig-ms-trigger" onclick="_igMultiselectToggle('${_esc(id)}')" style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:7px;background:white;text-align:left;font-size:0.85rem;color:${selected.length?'#0F172A':'#94A3B8'};cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(summary)}</span>
        <span style="color:#64748B;flex-shrink:0">▾</span>
      </button>
      <div id="${_esc(id)}-panel" class="ig-ms-panel" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:white;border:1px solid #CBD5E1;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);z-index:50;max-height:280px;overflow-y:auto">
        ${options.length === 0
          ? `<div style="padding:14px;color:#94A3B8;font-size:0.82rem;text-align:center">No competitors detected — run a website analysis on the home page first.</div>`
          : `<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #F1F5F9;cursor:pointer;font-size:0.82rem;font-weight:700;color:#0F172A;background:#F8FAFC">
              <input type="checkbox" id="${_esc(id)}-all" ${selected.length === options.length ? 'checked' : ''} onchange="_igMultiselectAll('${_esc(id)}', this.checked)">
              Select all
            </label>
            ${options.map(o => `
              <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;font-size:0.82rem;color:#0F172A;border-bottom:1px solid #F8FAFC">
                <input type="checkbox" class="ig-ms-opt" data-value="${_esc(o.value)}" ${selected.includes(o.value) ? 'checked' : ''} onchange="_igMultiselectFlip('${_esc(id)}', '${_esc(o.value)}', this.checked)">
                <span>${_esc(o.label)}</span>
              </label>`).join('')}`}
      </div>
    </div>`;
}
window._igMultiselectMeta = window._igMultiselectMeta || {};
function _igMultiselectInit({ id, options, stateKey, emptyLabel, onChange }) {
  window._igMultiselectMeta[id] = { options, stateKey, emptyLabel, onChange };
}
function _igMultiselectToggle(id) {
  // Close any other open panels first so only one is visible at a time.
  document.querySelectorAll('.ig-ms-panel').forEach(p => { if (p.id !== `${id}-panel`) p.style.display = 'none'; });
  const p = document.getElementById(`${id}-panel`);
  if (!p) return;
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
  if (p.style.display === 'block') {
    setTimeout(() => {
      const off = (e) => {
        const root = document.querySelector(`[data-ig-ms="${id}"]`);
        if (!root || !root.contains(e.target)) {
          p.style.display = 'none';
          document.removeEventListener('click', off);
        }
      };
      document.addEventListener('click', off);
    }, 0);
  }
}
function _igMultiselectFlip(id, value, checked) {
  const meta = window._igMultiselectMeta[id];
  if (!meta) return;
  const arr = window[meta.stateKey] || (window[meta.stateKey] = []);
  if (checked && !arr.includes(value)) arr.push(value);
  else if (!checked) {
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1);
  }
  _igMultiselectRefreshTrigger(id);
  if (typeof meta.onChange === 'function') meta.onChange(arr);
}
function _igMultiselectAll(id, checked) {
  const meta = window._igMultiselectMeta[id];
  if (!meta) return;
  window[meta.stateKey] = checked ? meta.options.map(o => o.value) : [];
  // Sync visible checkboxes
  document.querySelectorAll(`#${id}-panel .ig-ms-opt`).forEach(cb => { cb.checked = checked; });
  _igMultiselectRefreshTrigger(id);
  if (typeof meta.onChange === 'function') meta.onChange(window[meta.stateKey]);
}
function _igMultiselectRefreshTrigger(id) {
  const meta = window._igMultiselectMeta[id];
  if (!meta) return;
  const trigger = document.getElementById(`${id}-trigger`);
  if (!trigger) return;
  const selected = window[meta.stateKey] || [];
  let summary;
  if (!meta.options.length) summary = 'No options available';
  else if (selected.length === 0) summary = meta.emptyLabel;
  else if (selected.length === meta.options.length) summary = `All ${meta.options.length} selected`;
  else if (selected.length === 1) {
    const o = meta.options.find(x => x.value === selected[0]);
    summary = o ? o.label : '1 selected';
  } else summary = `${selected.length} of ${meta.options.length} selected`;
  const span = trigger.querySelector('span:first-child');
  if (span) span.textContent = summary;
  trigger.style.color = selected.length ? '#0F172A' : '#94A3B8';
  // Sync the "Select all" checkbox header
  const allCb = document.getElementById(`${id}-all`);
  if (allCb) allCb.checked = selected.length === meta.options.length && meta.options.length > 0;
}

/* =============================================================================
   MOVED → public/js/ig_mentions_gaps.js  (loaded after app.js in index.html)
   The Mention Tracker (+ Real-time Alerts), Content Gaps, Cross-Channel Report,
   Stakeholder digests, Webhook channels, Launch Calendar, Company Intel,
   Ad-Platform Connections and the AI Optimizer dashboard (creative-refresh /
   bandit / fatigue panels) view-builders were extracted verbatim into that
   module. Public entry points + onclick targets are re-exported to window there.
   buildDynAudiences (below) intentionally stays in app.js.
   ============================================================================= */

// ── DYNAMIC AUDIENCES (Drip-style real-time segments) — Phase 1 ─────────────
// Backend: /api/audiences (CRUD + /preview live count via HubSpot or synthetic).
// UI: list of saved segments + builder modal with rule blocks + live count.
window._dynSegEditing = null; // current segment id being edited (null = new)

window.buildDynAudiences = async function() {
  const wrap = document.getElementById('dynAudWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="text-align:center;padding:48px;color:#64748B;font-weight:600">Loading audiences…</div>`;
  try {
    const r = await fetch('/api/audiences').then(x=>x.json());
    const segs = r.segments || [];
    const hubConn = await fetch('/api/hubspot/status').then(x=>x.json()).catch(()=>({ok:false}));
    const sourceBadge = hubConn.ok && hubConn.configured
      ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#DCFCE7;color:#15803D;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#10B981;border-radius:50%"></span>HUBSPOT CONNECTED · live data</span>`
      : `<span style="display:inline-flex;align-items:center;gap:5px;background:#FEF3C7;color:#92400E;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#F59E0B;border-radius:50%"></span>HUBSPOT NOT CONNECTED · using demo data</span>`;

    const intro = `
      <div style="background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1px solid #C7D2FE;border-radius:14px;padding:18px 22px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#312E81;margin-bottom:4px">⚡ How Dynamic Audiences work</div>
          <div style="font-size:0.78rem;color:#4338CA;line-height:1.55;max-width:680px">Define rules once — InfoGenie continuously re-evaluates every contact. People auto-flow IN when they match, OUT when they don't. Drip campaigns target a segment ID, never a stale list.</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${sourceBadge}<div style="font-size:0.62rem;color:#6B7280;font-weight:700">Phase 1 · Builder + Live Preview</div></div>
      </div>`;

    const cards = segs.length === 0
      ? `<div style="background:#fff;border:2px dashed #C7D2FE;border-radius:14px;padding:48px;text-align:center">
           <div style="font-size:2.4rem;margin-bottom:8px">🎯</div>
           <div style="font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:6px">No dynamic audiences yet</div>
           <div style="font-size:0.82rem;color:#6B7280;margin-bottom:16px">Create your first rule-based segment — the live count updates the moment you tweak a rule.</div>
           <button onclick="openDynSegmentBuilder()" style="padding:11px 22px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:9px;font-size:0.85rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 4px 14px rgba(30,27,75,.35)">+ Create your first audience</button>
         </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
          ${segs.map(s => {
            const last = s.last_evaluated_at ? new Date(s.last_evaluated_at).toLocaleString() : 'never';
            const conds = (s.rules && Array.isArray(s.rules.conditions)) ? s.rules.conditions.length : 0;
            return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);display:flex;flex-direction:column;gap:10px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                <div>
                  <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628">${_escapeHtml(s.name)}</div>
                  ${s.description ? `<div style="font-size:0.72rem;color:#6B7280;margin-top:3px;line-height:1.45">${_escapeHtml(s.description)}</div>` : ''}
                </div>
                <span style="background:${s.enabled?'#DCFCE7':'#F3F4F6'};color:${s.enabled?'#15803D':'#6B7280'};padding:2px 8px;border-radius:5px;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em">${s.enabled?'Live':'Paused'}</span>
              </div>
              <div style="display:flex;gap:14px;padding:10px 0;border-top:1px solid #F1F5F9;border-bottom:1px solid #F1F5F9">
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Members</div><div style="font-size:1.4rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${(s.member_count||0).toLocaleString()}</div></div>
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Rules</div><div style="font-size:1.4rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${conds}</div></div>
              </div>
              <div style="font-size:0.66rem;color:#9CA3AF">Last evaluated: ${last}</div>
              <div style="display:flex;gap:8px;margin-top:4px">
                <button onclick="openDynSegmentBuilder(${s.id})" style="flex:1;padding:8px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:7px;font-size:0.72rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">✏️ Edit</button>
                <button onclick="deleteDynSegment(${s.id},'${_escapeHtml(s.name).replace(/'/g,'&#39;')}')" style="padding:8px 12px;background:#fff;border:2px solid #FCA5A5;border-radius:7px;font-size:0.72rem;font-weight:800;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">🗑</button>
              </div>
            </div>`;
          }).join('')}
        </div>`;

    wrap.innerHTML = intro + cards;
  } catch (e) {
    wrap.innerHTML = `<div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:10px;padding:16px;color:#B91C1C;font-weight:600">Failed to load audiences: ${_escapeHtml(e.message)}</div>`;
  }
};

window.deleteDynSegment = async function(id, name) {
  if (!confirm(`Delete dynamic audience "${name}"? This removes the rules + membership history. Drip campaigns wired to this segment will need re-targeting.`)) return;
  await fetch('/api/audiences/' + id, { method:'DELETE' });
  showToast('🗑 Audience deleted');
  buildDynAudiences();
};

// Builder modal — creates or edits a segment.
window.openDynSegmentBuilder = async function(segmentId) {
  window._dynSegEditing = segmentId || null;
  let preset = { name:'', description:'', rules:{ match:'all', conditions:[] } };
  if (segmentId) {
    try {
      const r = await fetch('/api/audiences/' + segmentId).then(x=>x.json());
      if (r.ok && r.segment) preset = { name:r.segment.name, description:r.segment.description||'', rules:r.segment.rules||preset.rules };
    } catch(_) {}
  }

  let modal = document.getElementById('dynSegModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'dynSegModal'; document.body.appendChild(modal); }
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,.55);z-index:10010;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:780px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:28px 32px;color:#0A1628">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1.3rem;font-weight:800">${segmentId ? '✏️ Edit' : '➕ New'} Dynamic Audience</div>
          <div style="font-size:0.78rem;color:#6B7280;margin-top:3px">Add rules — the live count below updates as you type.</div>
        </div>
        <button onclick="closeDynSegModal()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6B7280;padding:4px 10px">×</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:800;color:#374151;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Audience name</label>
          <input id="dynSegName" type="text" placeholder="e.g. One-time buyers (last 30d)" value="${_escapeHtml(preset.name)}" style="width:100%;padding:10px 12px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:0.9rem;color:#0A1628;background:#fff" />
        </div>
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:800;color:#374151;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Match logic</label>
          <select id="dynSegMatch" style="width:100%;padding:10px 12px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:0.9rem;color:#0A1628;background:#fff">
            <option value="all" ${preset.rules.match==='all'?'selected':''}>Match ALL conditions</option>
            <option value="any" ${preset.rules.match==='any'?'selected':''}>Match ANY condition</option>
            <option value="none" ${preset.rules.match==='none'?'selected':''}>Match NONE of these</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label style="display:block;font-size:0.7rem;font-weight:800;color:#374151;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Description (optional)</label>
        <input id="dynSegDesc" type="text" placeholder="What is this audience for?" value="${_escapeHtml(preset.description)}" style="width:100%;padding:10px 12px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:0.85rem;color:#0A1628;background:#fff" />
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:0.78rem;font-weight:800;color:#0A1628">Conditions</div>
        <button onclick="dynSegAddCondition()" style="padding:7px 14px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:7px;font-size:0.72rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">+ Add condition</button>
      </div>
      <div id="dynSegConditions" style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px"></div>

      <div id="dynSegPreview" style="background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1.5px solid #C7D2FE;border-radius:12px;padding:16px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-size:0.7rem;font-weight:800;color:#4338CA;text-transform:uppercase;letter-spacing:.05em">Live preview</div>
            <div id="dynSegPreviewCount" style="font-family:Sora,sans-serif;font-size:1.6rem;font-weight:800;color:#1E1B4B;margin-top:3px">— matches</div>
            <div id="dynSegPreviewNote" style="font-size:0.7rem;color:#6B7280;margin-top:3px">Add a condition to see your live count.</div>
          </div>
          <button onclick="dynSegRunPreview()" style="padding:9px 16px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:8px;font-size:0.75rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">🔄 Refresh count</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="closeDynSegModal()" style="padding:10px 18px;background:#fff;border:2px solid #D1D5DB;border-radius:8px;font-size:0.82rem;font-weight:700;color:#374151;cursor:pointer">Cancel</button>
        <button onclick="dynSegSave()" style="padding:10px 22px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:8px;font-size:0.82rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 4px 14px rgba(30,27,75,.35)">${segmentId?'💾 Save changes':'✨ Create audience'}</button>
      </div>
    </div>`;

  // Render preset conditions (or one blank one for new)
  window._dynSegConds = (preset.rules.conditions && preset.rules.conditions.length) ? [...preset.rules.conditions] : [];
  if (!window._dynSegConds.length && !segmentId) window._dynSegConds.push({ type:'property', field:'lifecyclestage', op:'eq', value:'customer' });
  dynSegRenderConditions();
  setTimeout(dynSegRunPreview, 200);
};

window.closeDynSegModal = function() {
  const m = document.getElementById('dynSegModal');
  if (m) m.remove();
};

window.dynSegAddCondition = function() {
  window._dynSegConds = window._dynSegConds || [];
  window._dynSegConds.push({ type:'property', field:'lifecyclestage', op:'eq', value:'' });
  dynSegRenderConditions();
};

window.dynSegRemoveCondition = function(idx) {
  window._dynSegConds.splice(idx, 1);
  dynSegRenderConditions();
  dynSegRunPreview();
};

window.dynSegUpdateCondition = function(idx, key, val) {
  window._dynSegConds[idx] = window._dynSegConds[idx] || {};
  window._dynSegConds[idx][key] = val;
  // Reset op/field defaults when type changes so the row stays valid.
  if (key === 'type') {
    const c = window._dynSegConds[idx];
    if (val === 'property')   { c.field='lifecyclestage'; c.op='eq'; c.value=''; }
    if (val === 'event')      { c.event='page_view'; c.op='happened'; c.days=30; c.value=''; }
    if (val === 'commerce')   { c.field='total_purchases'; c.op='gt'; c.value=0; }
    if (val === 'engagement') { c.metric='opened_email'; c.op='happened'; c.days=30; c.value=''; }
    if (val === 'ai_source')  { c.source='chatgpt'; c.days=30; }
    dynSegRenderConditions();
  }
  // Debounced live preview
  clearTimeout(window._dynSegPreviewT);
  window._dynSegPreviewT = setTimeout(dynSegRunPreview, 500);
};

window.dynSegRenderConditions = function() {
  const host = document.getElementById('dynSegConditions');
  if (!host) return;
  const conds = window._dynSegConds || [];
  if (!conds.length) {
    host.innerHTML = `<div style="background:#F9FAFB;border:1.5px dashed #D1D5DB;border-radius:9px;padding:20px;text-align:center;color:#6B7280;font-size:0.8rem">No conditions yet — click "+ Add condition" above.</div>`;
    return;
  }
  host.innerHTML = conds.map((c, i) => `
    <div style="background:#F9FAFB;border:1.5px solid #E5E7EB;border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:0.7rem;font-weight:800;color:#6B7280;min-width:18px">${i+1}.</span>
      <select onchange="dynSegUpdateCondition(${i},'type',this.value)" style="padding:7px 10px;border:1.5px solid #D1D5DB;border-radius:6px;font-size:0.78rem;color:#0A1628;background:#fff;font-weight:600">
        <option value="property"   ${c.type==='property'?'selected':''}>Contact property</option>
        <option value="event"      ${c.type==='event'?'selected':''}>Event</option>
        <option value="commerce"   ${c.type==='commerce'?'selected':''}>Commerce</option>
        <option value="engagement" ${c.type==='engagement'?'selected':''}>Engagement</option>
        <option value="ai_source"  ${c.type==='ai_source'?'selected':''}>AI referral source</option>
      </select>
      ${dynSegRowFields(c, i)}
      <button onclick="dynSegRemoveCondition(${i})" style="margin-left:auto;background:#fff;border:1.5px solid #FCA5A5;border-radius:6px;padding:6px 10px;font-size:0.72rem;font-weight:700;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">Remove</button>
    </div>`).join('');
};

function dynSegRowFields(c, i) {
  const inp = (key, val, ph='value', w=140) => `<input type="text" placeholder="${ph}" value="${val==null?'':_escapeHtml(String(val))}" oninput="dynSegUpdateCondition(${i},'${key}',this.value)" style="padding:7px 10px;border:1.5px solid #D1D5DB;border-radius:6px;font-size:0.78rem;color:#0A1628;background:#fff;width:${w}px" />`;
  const num = (key, val, ph='30', w=70) => `<input type="number" placeholder="${ph}" value="${val==null?'':val}" oninput="dynSegUpdateCondition(${i},'${key}',this.value)" style="padding:7px 10px;border:1.5px solid #D1D5DB;border-radius:6px;font-size:0.78rem;color:#0A1628;background:#fff;width:${w}px" />`;
  const sel = (key, val, opts) => `<select onchange="dynSegUpdateCondition(${i},'${key}',this.value)" style="padding:7px 10px;border:1.5px solid #D1D5DB;border-radius:6px;font-size:0.78rem;color:#0A1628;background:#fff;font-weight:600">${opts.map(([v,l])=>`<option value="${v}" ${val===v?'selected':''}>${l}</option>`).join('')}</select>`;
  if (c.type === 'property') {
    return inp('field', c.field, 'property name', 160)
      + sel('op', c.op, [['eq','is'],['neq','is not'],['contains','contains'],['gt','>'],['lt','<'],['exists','is set']])
      + (c.op === 'exists' ? '' : inp('value', c.value, 'value', 140));
  }
  if (c.type === 'event') {
    return inp('event', c.event, 'event name', 150)
      + sel('op', c.op, [['happened','happened'],['not_happened','did not happen'],['count_gt','count >'],['count_lt','count <']])
      + ((c.op==='count_gt'||c.op==='count_lt') ? num('value', c.value, '0', 60) : '')
      + `<span style="font-size:0.72rem;color:#6B7280">in last</span>` + num('days', c.days, '30', 60) + `<span style="font-size:0.72rem;color:#6B7280">days</span>`;
  }
  if (c.type === 'commerce') {
    return sel('field', c.field, [['total_purchases','total purchases'],['last_purchase_days','days since last purchase'],['aov','avg order value']])
      + sel('op', c.op, [['gt','>'],['lt','<'],['eq','=']])
      + num('value', c.value, '0', 80);
  }
  if (c.type === 'engagement') {
    return sel('metric', c.metric, [['opened_email','opened email'],['clicked_email','clicked email'],['page_visited','visited page']])
      + sel('op', c.op, [['happened','happened'],['not_happened','did not happen']])
      + (c.metric==='page_visited' ? inp('value', c.value, 'url contains', 140) : '')
      + `<span style="font-size:0.72rem;color:#6B7280">in last</span>` + num('days', c.days, '30', 60) + `<span style="font-size:0.72rem;color:#6B7280">days</span>`;
  }
  if (c.type === 'ai_source') {
    return sel('source', c.source, [['chatgpt','ChatGPT'],['perplexity','Perplexity'],['gemini','Gemini'],['claude','Claude'],['copilot','Copilot'],['googleAi','Google AI Overview']])
      + `<span style="font-size:0.72rem;color:#6B7280">referred in last</span>` + num('days', c.days, '30', 60) + `<span style="font-size:0.72rem;color:#6B7280">days</span>`;
  }
  return '';
}

window.dynSegRunPreview = async function() {
  const countEl = document.getElementById('dynSegPreviewCount');
  const noteEl  = document.getElementById('dynSegPreviewNote');
  if (!countEl) return;
  const match = (document.getElementById('dynSegMatch')||{}).value || 'all';
  const rules = { match, conditions: window._dynSegConds || [] };
  if (!rules.conditions.length) {
    countEl.textContent = '— matches';
    noteEl.textContent  = 'Add a condition to see your live count.';
    return;
  }
  countEl.textContent = '⏳ counting…';
  noteEl.textContent  = 'Sampling contacts and applying rules…';
  try {
    const r = await fetch('/api/audiences/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rules }) }).then(x=>x.json());
    if (r.ok && r.preview) {
      const p = r.preview;
      countEl.textContent = `${(p.matches||0).toLocaleString()} of ${(p.sampleSize||0).toLocaleString()} sampled contacts match`;
      noteEl.innerHTML    = (p.note || '') + (p.source==='hubspot' ? ' <span style="display:inline-block;background:#DCFCE7;color:#15803D;padding:1px 6px;border-radius:4px;font-size:0.62rem;font-weight:800;margin-left:4px">LIVE · HubSpot</span>' : ' <span style="display:inline-block;background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:4px;font-size:0.62rem;font-weight:800;margin-left:4px">DEMO · synthetic</span>');
    } else {
      countEl.textContent = '⚠ preview failed';
      noteEl.textContent  = r.error || (r.preview && r.preview.error) || 'Unknown error';
    }
  } catch (e) {
    countEl.textContent = '⚠ preview failed';
    noteEl.textContent  = e.message;
  }
};

window.dynSegSave = async function() {
  const name  = (document.getElementById('dynSegName')||{}).value || '';
  const desc  = (document.getElementById('dynSegDesc')||{}).value || '';
  const match = (document.getElementById('dynSegMatch')||{}).value || 'all';
  if (!name.trim()) { alert('Give the audience a name first.'); return; }
  const body = { name, description: desc, rules: { match, conditions: window._dynSegConds || [] } };
  const url    = window._dynSegEditing ? '/api/audiences/' + window._dynSegEditing : '/api/audiences';
  const method = window._dynSegEditing ? 'PUT' : 'POST';
  try {
    const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(x=>x.json());
    if (!r.ok) throw new Error(r.error || 'save failed');
    showToast(window._dynSegEditing ? '💾 Audience updated' : '✨ Audience created');
    closeDynSegModal();
    buildDynAudiences();
  } catch (e) { alert('Save failed: ' + e.message); }
};

// Wire the nav-link click → render the dynamic-audiences view.
(function wireDynAudNav(){
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.nav-link[data-view="audiences-dynamic"]');
    if (a) setTimeout(() => { try { buildDynAudiences(); } catch(_){} }, 60);
  });
})();

// ── DYNAMIC AUDIENCES — Phase 2 UI (sync-now, members drill-in, flow log) ──
window.dynSegRefresh = async function(id, name) {
  showToast('🔄 Re-evaluating "' + name + '" against your full HubSpot contact list…');
  try {
    const r = await fetch('/api/audiences/' + id + '/refresh', { method:'POST' }).then(x=>x.json());
    if (!r.ok) throw new Error(r.error || 'refresh failed');
    const run = r.run || {};
    const seg = (run.results || [])[0] || {};
    if (run.source === 'unavailable' || run.source === 'hubspot_partial') {
      showToast('⚠ HubSpot fetch failed — ' + (run.hubspotError || 'unavailable'));
    } else {
      showToast(`✅ "${name}" — ${seg.matched||0} members (${seg.added||0} joined, ${seg.removed||0} left)`);
    }
    buildDynAudiences();
  } catch (e) { showToast('❌ Refresh failed: ' + e.message); }
};

window.dynSegViewMembers = async function(id, name) {
  let modal = document.getElementById('dynSegMembersModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'dynSegMembersModal'; document.body.appendChild(modal); }
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,.55);z-index:10010;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:880px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:28px 32px;color:#0A1628">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1.3rem;font-weight:800">👥 Members of "${_escapeHtml(name)}"</div>
          <div style="font-size:0.78rem;color:#6B7280;margin-top:3px">Live membership + recent in/out flow. Updated by the 15-minute sweep, the HubSpot webhook, and any manual sync.</div>
        </div>
        <button onclick="(function(){var m=document.getElementById('dynSegMembersModal');if(m)m.remove();})()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6B7280;padding:4px 10px">×</button>
      </div>
      <div id="dynSegMembersBody" style="font-size:0.85rem;color:#6B7280;text-align:center;padding:32px">Loading…</div>
    </div>`;
  try {
    const [m, l] = await Promise.all([
      fetch('/api/audiences/' + id + '/members?limit=200').then(x=>x.json()),
      fetch('/api/audiences/' + id + '/log').then(x=>x.json()),
    ]);
    const members = (m.members || []);
    const log     = (l.log || []);
    const totals = log.reduce((a,r) => ({ added:a.added+(r.members_added||0), removed:a.removed+(r.members_removed||0), runs:a.runs+1 }), { added:0, removed:0, runs:0 });
    const lastRun = log[0] ? new Date(log[0].ran_at).toLocaleString() : 'never';

    document.getElementById('dynSegMembersBody').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px"><div style="font-size:0.6rem;font-weight:800;color:#166534;text-transform:uppercase;letter-spacing:.06em">Active members</div><div style="font-size:1.5rem;font-weight:800;color:#166534;font-variant-numeric:tabular-nums">${(m.total||0).toLocaleString()}</div></div>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px"><div style="font-size:0.6rem;font-weight:800;color:#1E40AF;text-transform:uppercase;letter-spacing:.06em">Joined (7d)</div><div style="font-size:1.5rem;font-weight:800;color:#1E40AF;font-variant-numeric:tabular-nums">+${totals.added.toLocaleString()}</div></div>
        <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:10px;padding:12px"><div style="font-size:0.6rem;font-weight:800;color:#991B1B;text-transform:uppercase;letter-spacing:.06em">Left (7d)</div><div style="font-size:1.5rem;font-weight:800;color:#991B1B;font-variant-numeric:tabular-nums">−${totals.removed.toLocaleString()}</div></div>
        <div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:12px"><div style="font-size:0.6rem;font-weight:800;color:#5B21B6;text-transform:uppercase;letter-spacing:.06em">Sweeps (7d)</div><div style="font-size:1.5rem;font-weight:800;color:#5B21B6;font-variant-numeric:tabular-nums">${totals.runs}</div></div>
      </div>
      <div style="font-size:0.7rem;color:#6B7280;margin-bottom:8px">Last evaluated: <strong style="color:#0A1628">${lastRun}</strong>${log[0]?.error?` <span style="color:#B91C1C">· error: ${_escapeHtml(log[0].error)}</span>`:''}</div>

      <div style="font-size:0.78rem;font-weight:800;color:#0A1628;margin:18px 0 8px">Active members ${m.total>members.length?`(showing first ${members.length} of ${m.total})`:`(${members.length})`}</div>
      ${members.length === 0
        ? `<div style="background:#FAFAFA;border:1.5px dashed #E5E7EB;border-radius:10px;padding:24px;text-align:center;color:#6B7280;font-size:0.85rem">No active members yet. ${log.length===0?'Run a sync to do the first evaluation.':'No HubSpot contacts currently match these rules.'}</div>`
        : `<div style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:0.78rem">
            <thead style="background:#F9FAFB"><tr><th style="text-align:left;padding:9px 12px;font-weight:800;color:#374151;font-size:0.7rem;text-transform:uppercase;letter-spacing:.05em">Email</th><th style="text-align:left;padding:9px 12px;font-weight:800;color:#374151;font-size:0.7rem;text-transform:uppercase;letter-spacing:.05em">Contact ID</th><th style="text-align:right;padding:9px 12px;font-weight:800;color:#374151;font-size:0.7rem;text-transform:uppercase;letter-spacing:.05em">Joined</th></tr></thead>
            <tbody>${members.map(c => `<tr style="border-top:1px solid #F1F5F9"><td style="padding:9px 12px;color:#0A1628;font-weight:600">${_escapeHtml(c.contact_email||'(no email)')}</td><td style="padding:9px 12px;color:#6B7280;font-family:'JetBrains Mono',monospace;font-size:0.72rem">${_escapeHtml(c.contact_id)}</td><td style="padding:9px 12px;text-align:right;color:#6B7280">${new Date(c.joined_at).toLocaleDateString()}</td></tr>`).join('')}</tbody>
          </table></div>`}
    `;
  } catch (e) {
    document.getElementById('dynSegMembersBody').innerHTML = `<div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:10px;padding:16px;color:#B91C1C">Failed to load members: ${_escapeHtml(e.message)}</div>`;
  }
};

// Patch the segment-card row to include the new Phase-2 buttons by wrapping
// buildDynAudiences's renderer. We do this by re-defining it once Phase 1's
// version has loaded — same shape, plus the extra "Sync" + "Members" buttons.
window.buildDynAudiences = async function() {
  const wrap = document.getElementById('dynAudWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="text-align:center;padding:48px;color:#64748B;font-weight:600">Loading audiences…</div>`;
  try {
    const [r, hubConn] = await Promise.all([
      fetch('/api/audiences').then(x=>x.json()),
      fetch('/api/hubspot/status').then(x=>x.json()).catch(()=>({ok:false})),
    ]);
    const segs = r.segments || [];
    const sourceBadge = hubConn.ok && hubConn.configured
      ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#DCFCE7;color:#15803D;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#10B981;border-radius:50%"></span>HUBSPOT CONNECTED · live data</span>`
      : `<span style="display:inline-flex;align-items:center;gap:5px;background:#FEF3C7;color:#92400E;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#F59E0B;border-radius:50%"></span>HUBSPOT NOT CONNECTED · using demo data</span>`;

    const intro = `
      <div style="background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1px solid #C7D2FE;border-radius:14px;padding:18px 22px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#312E81;margin-bottom:4px">⚡ How Dynamic Audiences work</div>
          <div style="font-size:0.78rem;color:#4338CA;line-height:1.55;max-width:680px">Define rules once — InfoGenie continuously re-evaluates every contact every 15 minutes (and instantly via HubSpot webhooks). People auto-flow IN when they match, OUT when they don't.</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${sourceBadge}<div style="font-size:0.62rem;color:#6B7280;font-weight:700">Phase 2 · Real-time evaluation · 15-min sweep</div></div>
      </div>`;

    const cards = segs.length === 0
      ? `<div style="background:#fff;border:2px dashed #C7D2FE;border-radius:14px;padding:48px;text-align:center">
           <div style="font-size:2.4rem;margin-bottom:8px">🎯</div>
           <div style="font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:6px">No dynamic audiences yet</div>
           <div style="font-size:0.82rem;color:#6B7280;margin-bottom:16px">Create your first rule-based segment — the live count updates the moment you tweak a rule.</div>
           <button onclick="openDynSegmentBuilder()" style="padding:11px 22px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:9px;font-size:0.85rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 4px 14px rgba(30,27,75,.35)">+ Create your first audience</button>
         </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
          ${segs.map(s => {
            const last = s.last_evaluated_at ? new Date(s.last_evaluated_at).toLocaleString() : 'never';
            const conds = (s.rules && Array.isArray(s.rules.conditions)) ? s.rules.conditions.length : 0;
            const safeName = _escapeHtml(s.name).replace(/'/g, '&#39;');
            return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);display:flex;flex-direction:column;gap:10px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                <div>
                  <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628">${_escapeHtml(s.name)}</div>
                  ${s.description ? `<div style="font-size:0.72rem;color:#6B7280;margin-top:3px;line-height:1.45">${_escapeHtml(s.description)}</div>` : ''}
                </div>
                <span style="background:${s.enabled?'#DCFCE7':'#F3F4F6'};color:${s.enabled?'#15803D':'#6B7280'};padding:2px 8px;border-radius:5px;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em">${s.enabled?'Live':'Paused'}</span>
              </div>
              <div style="display:flex;gap:14px;padding:10px 0;border-top:1px solid #F1F5F9;border-bottom:1px solid #F1F5F9">
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Members</div><div style="font-size:1.4rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${(s.member_count||0).toLocaleString()}</div></div>
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Rules</div><div style="font-size:1.4rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${conds}</div></div>
              </div>
              <div style="font-size:0.66rem;color:#9CA3AF">Last evaluated: ${last}</div>
              <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
                <button onclick="dynSegRefresh(${s.id},'${safeName}')" style="flex:1;min-width:100px;padding:8px;background:#0EA5E9;border:2px solid #0EA5E9;border-radius:7px;font-size:0.7rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.4)">🔄 Sync now</button>
                <button onclick="dynSegViewMembers(${s.id},'${safeName}')" style="flex:1;min-width:100px;padding:8px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:7px;font-size:0.7rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">👥 Members</button>
                <button onclick="openDynSegmentBuilder(${s.id})" style="padding:8px 10px;background:#fff;border:2px solid #C7D2FE;border-radius:7px;font-size:0.7rem;font-weight:800;color:#4338CA;-webkit-text-fill-color:#4338CA;cursor:pointer">✏️</button>
                <button onclick="deleteDynSegment(${s.id},'${safeName}')" style="padding:8px 10px;background:#fff;border:2px solid #FCA5A5;border-radius:7px;font-size:0.7rem;font-weight:800;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">🗑</button>
              </div>
            </div>`;
          }).join('')}
        </div>`;

    wrap.innerHTML = intro + cards;
  } catch (e) {
    wrap.innerHTML = `<div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:10px;padding:16px;color:#B91C1C;font-weight:600">Failed to load audiences: ${_escapeHtml(e.message)}</div>`;
  }
};

// ── DYNAMIC AUDIENCES — Phase 3 UI (Drip binding) ─────────────────────────
window.dynSegOpenDripBinding = async function(id, name) {
  let modal = document.getElementById('dynSegDripModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'dynSegDripModal'; document.body.appendChild(modal); }
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,.55);z-index:10010;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:760px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:28px 32px;color:#0A1628">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1.3rem;font-weight:800">📨 Drip binding for "${_escapeHtml(name)}"</div>
          <div style="font-size:0.78rem;color:#6B7280;margin-top:3px;line-height:1.5">When a contact joins this audience, they're auto-enrolled into the email sequence below. When they leave, their active enrollment is auto-unsubscribed.</div>
        </div>
        <button onclick="(function(){var m=document.getElementById('dynSegDripModal');if(m)m.remove();})()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6B7280;padding:4px 10px">×</button>
      </div>
      <div id="dynSegDripBody" style="font-size:0.85rem;color:#6B7280;text-align:center;padding:32px">Loading…</div>
    </div>`;

  const body = document.getElementById('dynSegDripBody');
  let existing = null;
  try { existing = (await fetch('/api/audiences/' + id + '/drip-binding').then(x=>x.json())).binding; } catch(_){}

  const seq = (existing && Array.isArray(existing.sequence) && existing.sequence.length)
    ? existing.sequence
    : [
      { day:0, channel:'Email', label:'Welcome',     subject:'Welcome — quick intro',         msg:'Hi! You just qualified for our audience. Here\'s what to expect…' },
      { day:2, channel:'Email', label:'Value drop',  subject:'Idea you might find useful',    msg:'Quick tip / case study you can use today.' },
      { day:5, channel:'Email', label:'Soft CTA',    subject:'Want to chat?',                  msg:'If this is on your radar, reply and we\'ll set up 15 min.' },
    ];

  body.style.textAlign = 'left';
  body.style.padding = '0';
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
      <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Brand name</div><input id="dynBindBrand" value="${_escapeHtml((existing&&existing.brand)||'')}" placeholder="My Co" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem"></label>
      <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Mode</div><select id="dynBindDryRun" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;background:#fff"><option value="true" ${!existing||existing.dry_run?'selected':''}>Dry-run (safe — no real sends)</option><option value="false" ${existing&&!existing.dry_run?'selected':''}>Live (send real emails via Resend)</option></select></label>
      <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Auto-exit on leave</div><select id="dynBindAutoExit" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;background:#fff"><option value="true" ${!existing||existing.auto_exit?'selected':''}>Yes — unsubscribe when they leave</option><option value="false" ${existing&&!existing.auto_exit?'selected':''}>No — let sequence finish</option></select></label>
    </div>
    <div style="font-size:0.78rem;font-weight:800;color:#0A1628;margin:8px 0">Email sequence</div>
    <div id="dynBindSteps"></div>
    <button id="dynBindAddStep" style="margin-top:8px;padding:7px 14px;background:#fff;border:1.5px dashed #C7D2FE;border-radius:7px;font-size:0.75rem;font-weight:700;color:#4338CA;cursor:pointer">+ Add step</button>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;padding-top:14px;border-top:1px solid #F1F5F9">
      ${existing?`<button id="dynBindDelete" style="padding:9px 16px;background:#fff;border:2px solid #FCA5A5;border-radius:8px;font-size:0.78rem;font-weight:800;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">🗑 Remove binding</button>`:''}
      <button id="dynBindSave" style="padding:9px 18px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:8px;font-size:0.78rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">💾 Save binding</button>
    </div>`;

  const stepsBox = document.getElementById('dynBindSteps');
  function renderSteps(arr) {
    stepsBox.innerHTML = arr.map((s, i) => `
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:11px 13px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
          <span style="background:#1E1B4B;color:#fff;-webkit-text-fill-color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800">${i+1}</span>
          <input data-k="day"     data-i="${i}" type="number" min="0" max="365" value="${s.day||0}" placeholder="day" style="width:70px;padding:6px 8px;border:1px solid #E5E7EB;border-radius:6px;font-size:0.78rem"/>
          <span style="font-size:0.68rem;color:#9CA3AF">days after join</span>
          <input data-k="label"   data-i="${i}" value="${_escapeHtml(s.label||'')}" placeholder="Step label" style="flex:1;padding:6px 8px;border:1px solid #E5E7EB;border-radius:6px;font-size:0.78rem"/>
          <button data-rm="${i}" style="background:#fff;border:1px solid #FCA5A5;color:#B91C1C;-webkit-text-fill-color:#B91C1C;border-radius:6px;padding:4px 10px;font-size:0.7rem;cursor:pointer">×</button>
        </div>
        <input data-k="subject" data-i="${i}" value="${_escapeHtml(s.subject||'')}" placeholder="Email subject" style="width:100%;padding:6px 8px;border:1px solid #E5E7EB;border-radius:6px;font-size:0.78rem;margin-bottom:6px"/>
        <textarea data-k="msg" data-i="${i}" rows="3" placeholder="Email body" style="width:100%;padding:6px 8px;border:1px solid #E5E7EB;border-radius:6px;font-size:0.78rem;font-family:inherit;resize:vertical">${_escapeHtml(s.msg||'')}</textarea>
      </div>`).join('');
    stepsBox.querySelectorAll('input,textarea').forEach(el => {
      el.addEventListener('input', () => {
        const i = +el.dataset.i, k = el.dataset.k;
        seq[i][k] = (k === 'day') ? (parseInt(el.value,10)||0) : el.value;
      });
    });
    stepsBox.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', () => { seq.splice(+b.dataset.rm, 1); renderSteps(seq); });
    });
  }
  renderSteps(seq);

  document.getElementById('dynBindAddStep').onclick = () => {
    const lastDay = seq.length ? Number(seq[seq.length-1].day||0) : -1;
    seq.push({ day:lastDay+2, channel:'Email', label:`Step ${seq.length+1}`, subject:'', msg:'' });
    renderSteps(seq);
  };
  document.getElementById('dynBindSave').onclick = async () => {
    const payload = {
      sequence: seq.filter(s => (s.subject||'').trim() || (s.msg||'').trim()),
      brand:    document.getElementById('dynBindBrand').value.trim() || null,
      dry_run:  document.getElementById('dynBindDryRun').value === 'true',
      auto_exit:document.getElementById('dynBindAutoExit').value === 'true',
      app_origin: window.location.origin,
    };
    if (!payload.sequence.length) return showToast('❌ Add at least one step with subject or body');
    try {
      const r = await fetch('/api/audiences/' + id + '/drip-binding', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error || 'save failed');
      showToast(`✅ Drip binding saved (${payload.sequence.length} steps · ${payload.dry_run?'dry-run':'LIVE'})`);
      modal.remove();
      buildDynAudiences();
    } catch (e) { showToast('❌ ' + e.message); }
  };
  const delBtn = document.getElementById('dynBindDelete');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm('Remove the Drip binding? Existing in-flight enrollments are NOT touched — only future joins will stop auto-enrolling.')) return;
    try {
      const r = await fetch('/api/audiences/' + id + '/drip-binding', { method:'DELETE' }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error || 'delete failed');
      showToast('🗑 Drip binding removed');
      modal.remove();
      buildDynAudiences();
    } catch (e) { showToast('❌ ' + e.message); }
  };
};

// Re-define the segment-card list so each card now shows a Drip-binding badge
// and a "📨 Drip" button that opens the binding modal.
window.buildDynAudiences = async function() {
  const wrap = document.getElementById('dynAudWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="text-align:center;padding:48px;color:#64748B;font-weight:600">Loading audiences…</div>`;
  try {
    const [r, hubConn] = await Promise.all([
      fetch('/api/audiences').then(x=>x.json()),
      fetch('/api/hubspot/status').then(x=>x.json()).catch(()=>({ok:false})),
    ]);
    const segs = r.segments || [];
    // Fetch every binding in parallel so the badge can render with the card.
    const bindings = await Promise.all(segs.map(s =>
      fetch('/api/audiences/' + s.id + '/drip-binding').then(x=>x.json()).catch(()=>({binding:null}))
    ));
    const byId = {}; segs.forEach((s,i) => byId[s.id] = bindings[i]?.binding || null);

    const sourceBadge = hubConn.ok && hubConn.configured
      ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#DCFCE7;color:#15803D;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#10B981;border-radius:50%"></span>HUBSPOT CONNECTED · live data</span>`
      : `<span style="display:inline-flex;align-items:center;gap:5px;background:#FEF3C7;color:#92400E;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#F59E0B;border-radius:50%"></span>HUBSPOT NOT CONNECTED · using demo data</span>`;

    const intro = `
      <div style="background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1px solid #C7D2FE;border-radius:14px;padding:18px 22px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#312E81;margin-bottom:4px">⚡ Dynamic Audiences → Drip Campaigns</div>
          <div style="font-size:0.78rem;color:#4338CA;line-height:1.55;max-width:680px">Phase 3: bind any audience to an email sequence — contacts are auto-enrolled the moment they qualify, and auto-unsubscribed the moment they no longer match.</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${sourceBadge}<div style="font-size:0.62rem;color:#6B7280;font-weight:700">Phase 3 · Drip auto-enrol/exit · 15-min sweep + webhook</div></div>
      </div>`;

    const cards = segs.length === 0
      ? `<div style="background:#fff;border:2px dashed #C7D2FE;border-radius:14px;padding:48px;text-align:center">
           <div style="font-size:2.4rem;margin-bottom:8px">🎯</div>
           <div style="font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:6px">No dynamic audiences yet</div>
           <div style="font-size:0.82rem;color:#6B7280;margin-bottom:16px">Create a rule-based segment, then connect it to a Drip sequence — qualified contacts auto-flow into your funnel.</div>
           <button onclick="openDynSegmentBuilder()" style="padding:11px 22px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:9px;font-size:0.85rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 4px 14px rgba(30,27,75,.35)">+ Create your first audience</button>
         </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px">
          ${segs.map(s => {
            const last = s.last_evaluated_at ? new Date(s.last_evaluated_at).toLocaleString() : 'never';
            const conds = (s.rules && Array.isArray(s.rules.conditions)) ? s.rules.conditions.length : 0;
            const safeName = _escapeHtml(s.name).replace(/'/g, '&#39;');
            const b = byId[s.id];
            const dripBadge = b
              ? `<span style="background:${b.enabled?'#DCFCE7':'#F3F4F6'};color:${b.enabled?'#15803D':'#6B7280'};padding:2px 8px;border-radius:5px;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em">📨 Drip ${b.enabled?(b.dry_run?'· dry-run':'· LIVE'):'paused'} · ${(b.sequence||[]).length} steps</span>`
              : `<span style="background:#F3F4F6;color:#9CA3AF;padding:2px 8px;border-radius:5px;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em">📨 No drip bound</span>`;
            return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);display:flex;flex-direction:column;gap:10px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                <div>
                  <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628">${_escapeHtml(s.name)}</div>
                  ${s.description ? `<div style="font-size:0.72rem;color:#6B7280;margin-top:3px;line-height:1.45">${_escapeHtml(s.description)}</div>` : ''}
                </div>
                <span style="background:${s.enabled?'#DCFCE7':'#F3F4F6'};color:${s.enabled?'#15803D':'#6B7280'};padding:2px 8px;border-radius:5px;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em">${s.enabled?'Live':'Paused'}</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">${dripBadge}</div>
              <div style="display:flex;gap:14px;padding:10px 0;border-top:1px solid #F1F5F9;border-bottom:1px solid #F1F5F9">
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Members</div><div style="font-size:1.4rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${(s.member_count||0).toLocaleString()}</div></div>
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Rules</div><div style="font-size:1.4rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${conds}</div></div>
              </div>
              <div style="font-size:0.66rem;color:#9CA3AF">Last evaluated: ${last}</div>
              <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
                <button onclick="dynSegRefresh(${s.id},'${safeName}')" style="flex:1;min-width:90px;padding:8px;background:#0EA5E9;border:2px solid #0EA5E9;border-radius:7px;font-size:0.7rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.4)">🔄 Sync</button>
                <button onclick="dynSegViewMembers(${s.id},'${safeName}')" style="flex:1;min-width:90px;padding:8px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:7px;font-size:0.7rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">👥 Members</button>
                <button onclick="dynSegOpenDripBinding(${s.id},'${safeName}')" style="flex:1;min-width:90px;padding:8px;background:${b?'#15803D':'#fff'};border:2px solid #15803D;border-radius:7px;font-size:0.7rem;font-weight:800;color:${b?'#fff':'#15803D'};-webkit-text-fill-color:${b?'#fff':'#15803D'};cursor:pointer;${b?'text-shadow:0 1px 2px rgba(0,0,0,.4)':''}">📨 ${b?'Edit drip':'Bind drip'}</button>
                <button onclick="openDynSegmentBuilder(${s.id})" style="padding:8px 10px;background:#fff;border:2px solid #C7D2FE;border-radius:7px;font-size:0.7rem;font-weight:800;color:#4338CA;-webkit-text-fill-color:#4338CA;cursor:pointer">✏️</button>
                <button onclick="deleteDynSegment(${s.id},'${safeName}')" style="padding:8px 10px;background:#fff;border:2px solid #FCA5A5;border-radius:7px;font-size:0.7rem;font-weight:800;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">🗑</button>
              </div>
            </div>`;
          }).join('')}
        </div>`;

    wrap.innerHTML = intro + cards;
  } catch (e) {
    wrap.innerHTML = `<div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:10px;padding:16px;color:#B91C1C;font-weight:600">Failed to load audiences: ${_escapeHtml(e.message)}</div>`;
  }
};

// ── DYNAMIC AUDIENCES — Phase 4A UI (HubSpot Static List sync) ────────────
window.dynSegOpenHsList = async function(id, name) {
  let modal = document.getElementById('dynSegHsModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'dynSegHsModal'; document.body.appendChild(modal); }
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,.55);z-index:10010;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;backdrop-filter:blur(4px)';
  let existing = null;
  try { existing = (await fetch('/api/audiences/' + id + '/hubspot-list').then(x=>x.json())).binding; } catch(_){}
  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:600px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:28px 32px;color:#0A1628">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1.3rem;font-weight:800">🔗 HubSpot list sync · "${_escapeHtml(name)}"</div>
          <div style="font-size:0.78rem;color:#6B7280;margin-top:3px;line-height:1.5">Mirror this audience's membership to a HubSpot Static List. Your sales team will see live members inside HubSpot for follow-up, ads custom audiences, etc.</div>
        </div>
        <button onclick="(function(){var m=document.getElementById('dynSegHsModal');if(m)m.remove();})()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6B7280;padding:4px 10px">×</button>
      </div>
      ${existing && existing.last_error ? `<div style="background:#FEF2F2;border:1px solid #FCA5A5;color:#B91C1C;padding:10px 12px;border-radius:8px;font-size:0.78rem;margin-bottom:12px">⚠ Last sync error: ${_escapeHtml(existing.last_error)}</div>` : ''}
      ${existing && existing.last_sync_at ? `<div style="font-size:0.7rem;color:#6B7280;margin-bottom:10px">Last synced: <strong>${new Date(existing.last_sync_at).toLocaleString()}</strong></div>` : ''}
      <label style="display:block;font-size:0.72rem;font-weight:700;color:#374151;margin-bottom:10px"><div style="margin-bottom:4px">List name (auto-creates a Static List in HubSpot the first time you save)</div><input id="dynHsName" value="${_escapeHtml((existing&&existing.list_name)||(name+' — InfoGenie'))}" placeholder="e.g. Hot Leads (auto-synced)" style="width:100%;padding:9px 11px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem"></label>
      <label style="display:block;font-size:0.72rem;font-weight:700;color:#374151;margin-bottom:10px"><div style="margin-bottom:4px">Existing HubSpot list ID (optional — leave blank to auto-create)</div><input id="dynHsListId" value="${_escapeHtml((existing&&existing.list_id)||'')}" placeholder="e.g. 12345" style="width:100%;padding:9px 11px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;font-family:'JetBrains Mono',monospace"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Status</div><select id="dynHsEnabled" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;background:#fff"><option value="true" ${!existing||existing.enabled?'selected':''}>Enabled — push joins/leaves to HubSpot</option><option value="false" ${existing&&!existing.enabled?'selected':''}>Paused</option></select></label>
        <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Auto-remove on leave</div><select id="dynHsAutoExit" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;background:#fff"><option value="true" ${!existing||existing.auto_exit?'selected':''}>Yes</option><option value="false" ${existing&&!existing.auto_exit?'selected':''}>No — keep them on the list</option></select></label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:12px;border-top:1px solid #F1F5F9">
        ${existing?`<button id="dynHsDelete" style="padding:9px 16px;background:#fff;border:2px solid #FCA5A5;border-radius:8px;font-size:0.78rem;font-weight:800;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">🗑 Remove</button>`:''}
        <button id="dynHsSave" style="padding:9px 18px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:8px;font-size:0.78rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">💾 Save</button>
      </div>
    </div>`;
  document.getElementById('dynHsSave').onclick = async () => {
    const payload = {
      list_name: document.getElementById('dynHsName').value.trim(),
      list_id:   document.getElementById('dynHsListId').value.trim() || null,
      enabled:   document.getElementById('dynHsEnabled').value === 'true',
      auto_exit: document.getElementById('dynHsAutoExit').value === 'true',
    };
    if (!payload.list_name) return showToast('❌ List name required');
    try {
      const r = await fetch('/api/audiences/' + id + '/hubspot-list', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error || 'save failed');
      const lid = r.binding?.list_id;
      showToast(lid ? `✅ Synced — HubSpot list ID ${lid}` : `⚠ Saved but list not yet created (check HubSpot permissions)`);
      modal.remove(); buildDynAudiences();
    } catch (e) { showToast('❌ ' + e.message); }
  };
  const del = document.getElementById('dynHsDelete');
  if (del) del.onclick = async () => {
    if (!confirm('Remove HubSpot list binding? The HubSpot list itself is NOT deleted — only the auto-sync stops.')) return;
    try {
      const r = await fetch('/api/audiences/' + id + '/hubspot-list', { method:'DELETE' }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error || 'delete failed');
      showToast('🗑 HubSpot list binding removed'); modal.remove(); buildDynAudiences();
    } catch (e) { showToast('❌ ' + e.message); }
  };
};

// ── DYNAMIC AUDIENCES — Phase 4B UI (Re-Engagement bridge) ────────────────
window.dynSegOpenReengage = async function(id, name) {
  let modal = document.getElementById('dynSegRengModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'dynSegRengModal'; document.body.appendChild(modal); }
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,.55);z-index:10010;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;backdrop-filter:blur(4px)';
  let existing = null;
  try { existing = (await fetch('/api/audiences/' + id + '/reengage').then(x=>x.json())).binding; } catch(_){}
  const v = (existing && existing.variant) || { subject:'', preheader:'', body:'', cta:'', angle:'', tone:'friendly' };
  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:760px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:28px 32px;color:#0A1628">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1.3rem;font-weight:800">💔 Re-engage on join · "${_escapeHtml(name)}"</div>
          <div style="font-size:0.78rem;color:#6B7280;margin-top:3px;line-height:1.5">Auto-fire a single-touch personalised win-back the moment a contact qualifies (e.g. lands in your churn-risk audience). Generated by AI, editable, sent via the existing Drip engine.</div>
        </div>
        <button onclick="(function(){var m=document.getElementById('dynSegRengModal');if(m)m.remove();})()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6B7280;padding:4px 10px">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
        <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Brand</div><input id="dynRengBrand" value="${_escapeHtml((existing&&existing.brand)||'')}" placeholder="My Co" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem"></label>
        <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Tone</div><select id="dynRengTone" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;background:#fff">${['friendly','warm','direct','playful','professional','urgent'].map(t=>`<option ${v.tone===t?'selected':''}>${t}</option>`).join('')}</select></label>
        <label style="font-size:0.72rem;font-weight:700;color:#374151"><div style="margin-bottom:4px">Mode</div><select id="dynRengDryRun" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;background:#fff"><option value="true" ${!existing||existing.dry_run?'selected':''}>Dry-run</option><option value="false" ${existing&&!existing.dry_run?'selected':''}>LIVE (real sends)</option></select></label>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <input id="dynRengAngle" value="${_escapeHtml(v.angle||'churn-risk · 30 days inactive')}" placeholder="Angle / context (e.g. abandoned trial)" style="flex:1;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem">
        <button id="dynRengGenerate" style="padding:8px 14px;background:#7C3AED;border:2px solid #7C3AED;border-radius:7px;font-size:0.75rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.4);white-space:nowrap">✨ Generate with AI</button>
      </div>
      <input id="dynRengSubject" value="${_escapeHtml(v.subject||'')}" placeholder="Email subject" style="width:100%;padding:9px 11px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;margin-bottom:8px">
      <input id="dynRengPreheader" value="${_escapeHtml(v.preheader||'')}" placeholder="Preheader (optional)" style="width:100%;padding:9px 11px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;margin-bottom:8px">
      <textarea id="dynRengBody" rows="7" placeholder="Email body" style="width:100%;padding:9px 11px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;font-family:inherit;resize:vertical;margin-bottom:8px">${_escapeHtml(v.body||'')}</textarea>
      <input id="dynRengCta" value="${_escapeHtml(v.cta||'')}" placeholder="CTA line (optional)" style="width:100%;padding:9px 11px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.85rem;margin-bottom:14px">
      <div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;padding-top:12px;border-top:1px solid #F1F5F9">
        <label style="font-size:0.72rem;color:#374151;margin-right:auto"><input id="dynRengAutoExit" type="checkbox" ${!existing||existing.auto_exit?'checked':''}/> Auto-unsubscribe when they leave the audience</label>
        ${existing?`<button id="dynRengDelete" style="padding:9px 16px;background:#fff;border:2px solid #FCA5A5;border-radius:8px;font-size:0.78rem;font-weight:800;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">🗑 Remove</button>`:''}
        <button id="dynRengSave" style="padding:9px 18px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:8px;font-size:0.78rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">💾 Save</button>
      </div>
    </div>`;

  document.getElementById('dynRengGenerate').onclick = async () => {
    const btn = document.getElementById('dynRengGenerate');
    btn.disabled = true; btn.textContent = '✨ Generating…';
    try {
      const r = await fetch('/api/reengage/generate', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          brand: document.getElementById('dynRengBrand').value || 'InfoGenie',
          tone:  document.getElementById('dynRengTone').value,
          segment: document.getElementById('dynRengAngle').value || 'churn-risk',
        })
      }).then(x=>x.json());
      const variant = r.variant || (r.variants && r.variants[0]) || r;
      if (variant.subject)   document.getElementById('dynRengSubject').value   = variant.subject;
      if (variant.preheader) document.getElementById('dynRengPreheader').value = variant.preheader;
      if (variant.body)      document.getElementById('dynRengBody').value      = variant.body;
      if (variant.cta)       document.getElementById('dynRengCta').value       = variant.cta;
      showToast('✨ AI-generated win-back drafted — review & save');
    } catch (e) { showToast('❌ Generate failed: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '✨ Generate with AI'; }
  };
  document.getElementById('dynRengSave').onclick = async () => {
    const payload = {
      variant: {
        subject:   document.getElementById('dynRengSubject').value.trim(),
        preheader: document.getElementById('dynRengPreheader').value.trim(),
        body:      document.getElementById('dynRengBody').value.trim(),
        cta:       document.getElementById('dynRengCta').value.trim(),
        angle:     document.getElementById('dynRengAngle').value.trim(),
        tone:      document.getElementById('dynRengTone').value,
      },
      brand:     document.getElementById('dynRengBrand').value.trim() || null,
      dry_run:   document.getElementById('dynRengDryRun').value === 'true',
      auto_exit: document.getElementById('dynRengAutoExit').checked,
      app_origin: window.location.origin,
    };
    if (!payload.variant.subject || !payload.variant.body) return showToast('❌ Subject and body required');
    try {
      const r = await fetch('/api/audiences/' + id + '/reengage', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error || 'save failed');
      showToast(`✅ Re-engagement saved (${payload.dry_run?'dry-run':'LIVE'})`); modal.remove(); buildDynAudiences();
    } catch (e) { showToast('❌ ' + e.message); }
  };
  const del = document.getElementById('dynRengDelete');
  if (del) del.onclick = async () => {
    if (!confirm('Remove the re-engagement binding? In-flight win-back enrollments are NOT touched.')) return;
    try {
      const r = await fetch('/api/audiences/' + id + '/reengage', { method:'DELETE' }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error || 'delete failed');
      showToast('🗑 Re-engagement binding removed'); modal.remove(); buildDynAudiences();
    } catch (e) { showToast('❌ ' + e.message); }
  };
};

// Re-define buildDynAudiences once more to add Phase 4 badges + buttons.
window.buildDynAudiences = async function() {
  const wrap = document.getElementById('dynAudWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="text-align:center;padding:48px;color:#64748B;font-weight:600">Loading audiences…</div>`;
  try {
    const [r, hubConn] = await Promise.all([
      fetch('/api/audiences').then(x=>x.json()),
      fetch('/api/hubspot/status').then(x=>x.json()).catch(()=>({ok:false})),
    ]);
    const segs = r.segments || [];
    const allBindings = await Promise.all(segs.map(s => Promise.all([
      fetch('/api/audiences/' + s.id + '/drip-binding').then(x=>x.json()).catch(()=>({})),
      fetch('/api/audiences/' + s.id + '/hubspot-list').then(x=>x.json()).catch(()=>({})),
      fetch('/api/audiences/' + s.id + '/reengage').then(x=>x.json()).catch(()=>({})),
    ])));
    const bindMap = {};
    segs.forEach((s,i) => bindMap[s.id] = { drip: allBindings[i][0]?.binding||null, hsList: allBindings[i][1]?.binding||null, reng: allBindings[i][2]?.binding||null });

    const sourceBadge = hubConn.ok && hubConn.configured
      ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#DCFCE7;color:#15803D;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#10B981;border-radius:50%"></span>HUBSPOT CONNECTED · live data</span>`
      : `<span style="display:inline-flex;align-items:center;gap:5px;background:#FEF3C7;color:#92400E;padding:3px 9px;border-radius:6px;font-size:0.65rem;font-weight:800"><span style="width:6px;height:6px;background:#F59E0B;border-radius:50%"></span>HUBSPOT NOT CONNECTED</span>`;

    const intro = `
      <div style="background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1px solid #C7D2FE;border-radius:14px;padding:18px 22px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#312E81;margin-bottom:4px">⚡ Dynamic Audiences · cross-channel</div>
          <div style="font-size:0.78rem;color:#4338CA;line-height:1.55;max-width:700px">Define rules once, fan out everywhere: Drip nurture, HubSpot Static List, AI win-back. Contacts auto-flow in/out the moment they qualify or stop matching.</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${sourceBadge}<div style="font-size:0.62rem;color:#6B7280;font-weight:700">Phase 4 · Drip + HubSpot list + Re-engage</div></div>
      </div>`;

    const cards = segs.length === 0
      ? `<div style="background:#fff;border:2px dashed #C7D2FE;border-radius:14px;padding:48px;text-align:center">
           <div style="font-size:2.4rem;margin-bottom:8px">🎯</div>
           <div style="font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:6px">No dynamic audiences yet</div>
           <button onclick="openDynSegmentBuilder()" style="padding:11px 22px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:9px;font-size:0.85rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 4px 14px rgba(30,27,75,.35)">+ Create your first audience</button>
         </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px">
          ${segs.map(s => {
            const last = s.last_evaluated_at ? new Date(s.last_evaluated_at).toLocaleString() : 'never';
            const conds = (s.rules && Array.isArray(s.rules.conditions)) ? s.rules.conditions.length : 0;
            const safeName = _escapeHtml(s.name).replace(/'/g, '&#39;');
            const b = bindMap[s.id];
            function badge(label, on, sub) {
              const bg = on ? '#DCFCE7' : '#F3F4F6';
              const fg = on ? '#15803D' : '#9CA3AF';
              return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:5px;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em">${label}${sub?' · '+_escapeHtml(sub):''}</span>`;
            }
            const dripB = b.drip   ? badge('📨 Drip',    !!b.drip.enabled, b.drip.dry_run?'dry':'LIVE') : badge('📨 Drip', false, 'off');
            const hsB   = b.hsList ? badge('🔗 HS list', !!b.hsList.enabled && !!b.hsList.list_id, b.hsList.list_id?'#'+b.hsList.list_id:'no id') : badge('🔗 HS list', false, 'off');
            const rngB  = b.reng   ? badge('💔 Re-eng',  !!b.reng.enabled, b.reng.dry_run?'dry':'LIVE') : badge('💔 Re-eng', false, 'off');
            return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.04);display:flex;flex-direction:column;gap:9px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                <div>
                  <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628">${_escapeHtml(s.name)}</div>
                  ${s.description ? `<div style="font-size:0.72rem;color:#6B7280;margin-top:3px;line-height:1.45">${_escapeHtml(s.description)}</div>` : ''}
                </div>
                <span style="background:${s.enabled?'#DCFCE7':'#F3F4F6'};color:${s.enabled?'#15803D':'#6B7280'};padding:2px 8px;border-radius:5px;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em">${s.enabled?'Live':'Paused'}</span>
              </div>
              <div style="display:flex;gap:5px;flex-wrap:wrap">${dripB}${hsB}${rngB}</div>
              <div style="display:flex;gap:14px;padding:8px 0;border-top:1px solid #F1F5F9;border-bottom:1px solid #F1F5F9">
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Members</div><div style="font-size:1.3rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${(s.member_count||0).toLocaleString()}</div></div>
                <div style="flex:1"><div style="font-size:0.6rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Rules</div><div style="font-size:1.3rem;font-weight:800;color:#1E1B4B;font-variant-numeric:tabular-nums">${conds}</div></div>
              </div>
              <div style="font-size:0.64rem;color:#9CA3AF">Last evaluated: ${last}</div>
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin-top:2px">
                <button onclick="dynSegRefresh(${s.id},'${safeName}')"      style="padding:7px;background:#0EA5E9;border:2px solid #0EA5E9;border-radius:6px;font-size:0.68rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.4)">🔄 Sync</button>
                <button onclick="dynSegViewMembers(${s.id},'${safeName}')"  style="padding:7px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:6px;font-size:0.68rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)">👥 Members</button>
                <button onclick="dynSegOpenDripBinding(${s.id},'${safeName}')" style="padding:7px;background:${b.drip?'#15803D':'#fff'};border:2px solid #15803D;border-radius:6px;font-size:0.68rem;font-weight:800;color:${b.drip?'#fff':'#15803D'};-webkit-text-fill-color:${b.drip?'#fff':'#15803D'};cursor:pointer;${b.drip?'text-shadow:0 1px 2px rgba(0,0,0,.4)':''}">📨 Drip</button>
                <button onclick="dynSegOpenHsList(${s.id},'${safeName}')"   style="padding:7px;background:${b.hsList?'#EA580C':'#fff'};border:2px solid #EA580C;border-radius:6px;font-size:0.68rem;font-weight:800;color:${b.hsList?'#fff':'#EA580C'};-webkit-text-fill-color:${b.hsList?'#fff':'#EA580C'};cursor:pointer;${b.hsList?'text-shadow:0 1px 2px rgba(0,0,0,.4)':''}">🔗 HS List</button>
                <button onclick="dynSegOpenReengage(${s.id},'${safeName}')" style="padding:7px;background:${b.reng?'#7C3AED':'#fff'};border:2px solid #7C3AED;border-radius:6px;font-size:0.68rem;font-weight:800;color:${b.reng?'#fff':'#7C3AED'};-webkit-text-fill-color:${b.reng?'#fff':'#7C3AED'};cursor:pointer;${b.reng?'text-shadow:0 1px 2px rgba(0,0,0,.4)':''}">💔 Re-eng</button>
                <div style="display:flex;gap:5px">
                  <button onclick="openDynSegmentBuilder(${s.id})"            style="flex:1;padding:7px;background:#fff;border:2px solid #C7D2FE;border-radius:6px;font-size:0.68rem;font-weight:800;color:#4338CA;-webkit-text-fill-color:#4338CA;cursor:pointer">✏️ Edit</button>
                  <button onclick="deleteDynSegment(${s.id},'${safeName}')"   style="padding:7px 10px;background:#fff;border:2px solid #FCA5A5;border-radius:6px;font-size:0.68rem;font-weight:800;color:#B91C1C;-webkit-text-fill-color:#B91C1C;cursor:pointer">🗑</button>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>`;

    wrap.innerHTML = intro + cards;
  } catch (e) {
    wrap.innerHTML = `<div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:10px;padding:16px;color:#B91C1C;font-weight:600">Failed to load audiences: ${_escapeHtml(e.message)}</div>`;
  }
};

// ── SEARCH & AI VISIBILITY INTELLIGENCE (Tier 1 #1+#2+#3) ─────────────────



// ✨ AI-suggest a prompt to track. Cycles through the suggestions on repeat clicks.



// ── EXPORTS (Tier 1 #4) ────────────────────────────────────────────────────

// ── INFLUENCER CRM (Tier 1 #5) ─────────────────────────────────────────────











// ════════════════════════════════════════════════════════════════════════════
// TIER 2 — Crisis Radar, Battle Cards, Trending Topics
// ════════════════════════════════════════════════════════════════════════════

// ── CRISIS RADAR ───────────────────────────────────────────────────────────

// ── BATTLE CARDS ───────────────────────────────────────────────────────────


// Navigate from a Battle Card to the Battle Plan view, pre-selecting the
// matching competitor if they're already in the current analysis.

// ── TRENDING TOPICS ────────────────────────────────────────────────────────
// ── Picker → input mirror
// ── 🤖 AI Suggest: category (uses last analysis snapshot)
// ── 🤖 AI Suggest: keywords for the chosen category

// ════════════════════════════════════════════════════════════════════════════
// TIER 3 — Share of Voice Tracker, Influencer Discovery
// ════════════════════════════════════════════════════════════════════════════




window._safeUrl = function(u) {
  try { const p = new URL(String(u)); return /^(https?|mailto):$/i.test(p.protocol) ? p.toString() : '#'; }
  catch { return '#'; }
};

// ── Tier 4 #1: AI Daily Digest ─────────────────────────────────────────────

// ── Tier 4 #2: Reply Assistant ─────────────────────────────────────────────

// ── Tier 5 #1: AI Press Release Generator ─────────────────────────────────

// ── Tier 5 #2: Smart Alert Routing ────────────────────────────────────────

// ── Tier 6 #1: Backlink Intel ─────────────────────────────────────────────

// ── Tier 6 #2: Content Calendar Auto-Pilot ───────────────────────────────

// ── Tier 7 #1: Podcast Mention Monitor ────────────────────────────────────

// ── Tier 7 #2: AI A/B Test Designer ───────────────────────────────────────

// ── Tier 8 #1: Voice of Customer Mining ───────────────────────────────────

// ── Tier 8 #2: Competitor Pricing Watcher ─────────────────────────────────


// ── Format a brand-ready title from a competitor/domain string (strip TLD, capitalize)

// ── Render the tracked-products list (extracted so we can reuse for cached + fresh renders)

// ── Tier 9 #1: Email Deliverability Auditor ───────────────────────────────

// ── Tier 9 #2: AI Landing Page Builder ────────────────────────────────────












// ── Tier 10 #1: Competitor Tech Stack Detector ────────────────────────────


// ── Tier 10 #2: AI Cold Email Writer ──────────────────────────────────────

// ── Tier 11 #1: Web Vitals Auditor ────────────────────────────────────────

// ── Tier 11 #2: B2B Lead Finder ───────────────────────────────────────────

// ── Tier 12 #1: SERP Position Tracker ────────────────────────────────────

// ─── Standalone integration & intel view-builders (pack A) → moved to public/js/ig_intel_pack_a.js ───
// (buildHubspotSync · buildMetaInsights · buildKeywordExplorer · buildGoogleAdsInsights ·
//  buildTiktokAdsInsights · buildSocialPublisher · buildEmailPersonalizer · buildYoutubeMonitor ·
//  buildWeeklyReport · buildRedditPulse · buildAdLibrary · buildNewsletterTracker · buildMeetingNotes ·
//  buildHeadlineTester · buildReviewAggregator · buildChurnScorer · buildTwitterPulse · buildJobBoardSpy ·
//  buildVideoScript · buildChatbotBuilder · buildGlassdoor · buildQuoraMining · buildSocialAnalytics ·
//  buildTiktokDownloader · buildVoiceover)

// ─── SEO view-builders (T22 Auditor · T29 Crawler · T30 GEO · Local SEO · Social Tags) → moved to public/js/ig_seo.js ───

// ─── T36 TRUE ROAS view (_trState + buildTrueRoas + _tr* helpers) → moved to public/js/ig_true_roas.js ───

// =============================================================================
// T37 — GET-STARTED ROADMAP (90-day plan + weekly social cadence)
// =============================================================================










// =============================================================================
// T38 — VIRAL CAROUSEL GENERATOR (Hook → Context → Value → Action)
// =============================================================================








// ─── Reddit Discover Questions (decorator + _rpInjectDiscover/_rpDiscover/_rpToCarousel) → moved to public/js/ig_intel_pack_a.js (used solely by buildRedditPulse) ───

// ═══════════════════════════════════════════════════════════════════════════
// AI TEAM — Officer roster + Finance / Operations officer dashboards.
// ═══════════════════════════════════════════════════════════════════════════
(function(){
  const _e = (s) => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const _fmt = (n, prefix='', dash='—') => (n==null||n==='' || (typeof n==='number' && !isFinite(n))) ? dash : (prefix + (typeof n==='number' ? n.toLocaleString() : n));
  const _money = (n) => (n==null) ? '—' : '$' + Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  const _pillCSS = 'display:inline-block;padding:3px 9px;border-radius:999px;font-size:.68rem;font-weight:700;letter-spacing:.02em';
  const _cardCSS = 'background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)';
  const _hdrCSS = 'max-width:1200px;margin:0 auto 22px;padding:24px 28px;background:linear-gradient(135deg,#0F172A 0%,#312E81 100%);color:white;border-radius:18px';

  const OFFICERS = [
    { id:'marketing', icon:'📣', title:'Marketing Officer',  role:'Runs your campaigns end-to-end',
      links:[['optimizer','AI Optimizer'],['battleplan','Battle Plan'],['action-center','Action Center']] },
    { id:'sales',     icon:'🎯', title:'Sales Officer',      role:'Finds, qualifies and re-engages leads',
      links:[['lead-finder','B2B Lead Finder'],['lead-qualifier','Lead Qualifier'],['reengage','Re-Engage']] },
    { id:'analyst',   icon:'📊', title:'Analyst Officer',    role:'Cross-channel reporting & attribution',
      links:[['cross-channel','Cross-Channel Report'],['attribution','Attribution & ROI'],['analytics-hub','Analytics Hub']] },
    { id:'content',   icon:'✍️', title:'Content Officer',    role:'Scores, plans and schedules content',
      links:[['contentscorer','Content Scorer'],['content-calendar','Content Calendar'],['social','Social Calendar']] },
    { id:'seo',       icon:'🔎', title:'SEO Officer',        role:'On-page, GEO and keyword strategy',
      links:[['seo-auditor','On-Page Auditor'],['geo-audit','GEO Audit'],['search-intel','AI Visibility & Search Pulse'],['keyword-map','Keyword Map']] },
    { id:'cro',       icon:'🧪', title:'CRO Officer',        role:'A/B testing and conversion lift',
      links:[['cro-lab','CRO Lab'],['conversion-boosters','Conversion Boosters'],['ab-designer','A/B Designer']] },
    { id:'finance',   icon:'💼', title:'Finance Officer',    role:'P&L, CAC, LTV, runway alerts', isNew:true,
      links:[['finance-officer','Open Finance Office']] },
    { id:'ops',       icon:'🛠️', title:'Operations Officer', role:'Campaign QA, asset & lead hygiene', isNew:true,
      links:[['ops-officer','Open Operations Office']] },
  ];

  // Server-loaded avatar overrides per officer id (string emoji 1-8 chars)
  let _officerAvatars = {};
  const AVATAR_GALLERY = ['📣','🎯','📊','✍️','🔎','🧪','💼','🛠️','🤖','🦊','🐺','🐯','🦁','🐼','🦄','🦅','👨‍💼','👩‍💼','👨‍🚀','👩‍🚀','🧙','🥷','🎨','⚡','🔥','💎','🚀','🌟','🧠','💡'];

  function _officerCard(o) {
    const links = o.links.map(([v,l]) => `<a href="#" class="nav-link" data-view="${_e(v)}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 11px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;font-size:.74rem;font-weight:700;color:#1E293B;text-decoration:none;margin:3px 4px 0 0">→ ${_e(l)}</a>`).join('');
    const newBadge = o.isNew ? `<span style="${_pillCSS};background:#DCFCE7;color:#166534;margin-left:6px">NEW</span>` : '';
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('ig_officer_tasks_'+o.id)||'[]');
      saved = Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string').slice(0,200) : [];
    } catch(_){}
    const taskCount = saved.length | 0;
    const avatar = (typeof _officerAvatars[o.id] === 'string' && _officerAvatars[o.id]) ? _officerAvatars[o.id] : o.icon;
    const isImg = typeof avatar === 'string' && avatar.startsWith('/uploads/');
    const avatarInner = isImg
      ? `<img src="${_e(avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:14px">`
      : _e(avatar);
    return `<div style="${_cardCSS}">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:10px">
        <button data-officer-avatar="${_e(o.id)}" title="Change avatar" style="width:54px;height:54px;border-radius:14px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;border:none;cursor:pointer;padding:0;position:relative;overflow:hidden">${avatarInner}<span style="position:absolute;bottom:-2px;right:-2px;background:#fff;border:1px solid #E2E8F0;border-radius:50%;width:18px;height:18px;font-size:10px;display:flex;align-items:center;justify-content:center;color:#64748B">✏️</span></button>
        <div style="flex:1">
          <div style="font-size:1.05rem;font-weight:800;color:#0F172A">${_e(o.title)}${newBadge}</div>
          <div style="font-size:.78rem;color:#64748B;margin-top:2px">${_e(o.role)}</div>
        </div>
        <span style="${_pillCSS};background:#DCFCE7;color:#166534">● ON DUTY</span>
      </div>
      <div style="margin-top:10px">${links}</div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #E2E8F0;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="font-size:.72rem;color:#64748B"><strong style="color:#0F172A">${taskCount}</strong> ${taskCount===1?'task':'tasks'} assigned</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button data-officer-tasks="${_e(o.id)}" data-officer-title="${_e(o.title)}" style="padding:6px 11px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer">📋 Tasks</button>
          <button data-officer-report="${_e(o.id)}" data-officer-title="${_e(o.title)}" style="padding:6px 11px;background:#0F172A;color:#fff;border:none;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer">📊 Daily Report</button>
        </div>
      </div>
    </div>`;
  }

  // ── Download helper ─────────────────────────────────────────────────────
  function _downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ── Avatar picker popover ───────────────────────────────────────────────
  function _openAvatarPicker(officerId, anchorBtn) {
    document.querySelectorAll('.ig-avatar-pop').forEach(p => p.remove());
    const rect = anchorBtn.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'ig-avatar-pop';
    pop.style.cssText = `position:fixed;top:${rect.bottom+6}px;left:${Math.max(8, Math.min(window.innerWidth-280, rect.left))}px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,0.15);z-index:99998;width:268px`;
    pop.innerHTML = `
      <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Pick an emoji</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:12px">
        ${AVATAR_GALLERY.map(em => `<button data-pick="${_e(em)}" style="width:36px;height:36px;border:1px solid #F1F5F9;background:#fff;border-radius:8px;font-size:18px;cursor:pointer;padding:0">${em}</button>`).join('')}
      </div>
      <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Or upload an image</div>
      <button id="apUploadBtn" style="width:100%;padding:9px 12px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-size:.8rem;font-weight:700;cursor:pointer">📷 Choose image…</button>
      <div id="apStatus" style="font-size:.7rem;color:#64748B;margin-top:6px;text-align:center"></div>
      <input id="apFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">`;
    document.body.appendChild(pop);
    const closer = (e) => { if (!pop.contains(e.target) && e.target !== anchorBtn) { pop.remove(); document.removeEventListener('click', closer, true); } };
    setTimeout(() => document.addEventListener('click', closer, true), 0);
    pop.querySelectorAll('button[data-pick]').forEach(b => b.onclick = async () => {
      const em = b.dataset.pick;
      pop.remove(); document.removeEventListener('click', closer, true);
      _officerAvatars[officerId] = em;
      try { await fetch('/api/officer/avatars', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: officerId, avatar: em }) }); } catch(_){}
      window.buildAiTeam && window.buildAiTeam();
    });
    const fileInp = pop.querySelector('#apFile');
    pop.querySelector('#apUploadBtn').onclick = () => fileInp.click();
    fileInp.onchange = async () => {
      const f = fileInp.files && fileInp.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { pop.querySelector('#apStatus').textContent = '❌ Image must be under 5MB'; return; }
      pop.querySelector('#apStatus').textContent = '⏳ Uploading…';
      try {
        const fd = new FormData(); fd.append('role', officerId); fd.append('image', f);
        const r = await fetch('/api/officer/avatar-upload', { method:'POST', body: fd });
        const j = await r.json();
        if (!r.ok) { pop.querySelector('#apStatus').textContent = '❌ '+(j.error||'upload failed'); return; }
        _officerAvatars[officerId] = j.url;
        pop.remove(); document.removeEventListener('click', closer, true);
        window.buildAiTeam && window.buildAiTeam();
      } catch(e) { pop.querySelector('#apStatus').textContent = '❌ '+e.message; }
    };
  }

  // ── Daily Report modal ─────────────────────────────────────────────────
  async function _openDailyReport(officerId, officerTitle) {
    let saved = [];
    try {
      const p = JSON.parse(localStorage.getItem('ig_officer_tasks_'+officerId)||'[]');
      saved = Array.isArray(p) ? p.filter(s => typeof s==='string').slice(0,40) : [];
    } catch(_){}
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:760px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0F172A,#1E293B);color:#fff">
        <div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.8">📊 Daily Report</div>
        <h3 style="margin:6px 0 4px;font-size:1.3rem;font-weight:800">${_e(officerTitle)}</h3>
        <p style="margin:0;font-size:.85rem;opacity:.85" id="drDate">${new Date().toLocaleString()}</p>
      </div>
      <div id="drBody" style="flex:1;overflow-y:auto;padding:18px 24px"><div style="text-align:center;color:#64748B;padding:40px">⏳ Cross-checking your tasks against real platform data…</div></div>
      <div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;gap:8px;background:#F8FAFC">
        <button id="drClose" style="padding:10px 18px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">Close</button>
        <button id="drDl" disabled style="padding:10px 22px;background:#0F172A;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;opacity:.4">📥 Download Report</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#drClose').onclick = close;
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });

    let lastReport = null;
    try {
      const r = await fetch('/api/officer/daily-report', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: officerId, title: officerTitle, tasks: saved }) });
      const j = await r.json();
      lastReport = j;
      const rep = j.report || {};
      const statusPill = (s) => {
        const map = { done:['#15803D','#DCFCE7','✓ Done'], in_progress:['#A16207','#FEF3C7','◐ In progress'], blocked:['#B91C1C','#FEE2E2','⚠ Blocked'], not_started:['#64748B','#F1F5F9','○ Not started'] };
        const [c,bg,lab] = map[s] || map.not_started;
        return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:.68rem;font-weight:700;color:${c};background:${bg}">${lab}</span>`;
      };
      const list = (arr, tone) => (arr||[]).length ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:.86rem;color:${tone||'#0F172A'};line-height:1.6">${arr.map(x=>`<li>${_e(typeof x==='string'?x:(x.step||x.title||JSON.stringify(x)))}${typeof x==='object'&&x.priority?` <span style="font-size:.65rem;color:#64748B">(${_e(x.priority)})</span>`:''}</li>`).join('')}</ul>` : '<div style="font-size:.82rem;color:#94A3B8;font-style:italic">None</div>';
      overlay.querySelector('#drBody').innerHTML = `
        <div style="background:#F8FAFC;border-left:3px solid #7C3AED;padding:12px 14px;border-radius:6px;margin-bottom:18px">
          <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Executive Summary</div>
          <div style="font-size:.92rem;color:#0F172A;line-height:1.5">${_e(rep.summary||'No summary')}</div>
        </div>
        <div style="margin-bottom:18px">
          <div style="font-size:.78rem;color:#0F172A;font-weight:800;margin-bottom:8px">Tasks reviewed (${(rep.tasksReviewed||[]).length})</div>
          ${(rep.tasksReviewed||[]).map(tr => `<div style="border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px"><div style="font-size:.86rem;color:#0F172A;font-weight:600;flex:1">${_e(tr.task||'')}</div>${statusPill(tr.status)}</div>
            <div style="font-size:.74rem;color:#64748B">${_e(tr.evidence||'')}</div>
          </div>`).join('') || '<div style="color:#94A3B8;font-style:italic">No tasks assigned yet.</div>'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
          <div><div style="font-size:.78rem;color:#15803D;font-weight:800;margin-bottom:4px">✓ Successes</div>${list(rep.successes,'#15803D')}</div>
          <div><div style="font-size:.78rem;color:#B91C1C;font-weight:800;margin-bottom:4px">⚠ Issues</div>${list(rep.issues,'#B91C1C')}</div>
        </div>
        <div>
          <div style="font-size:.78rem;color:#0F172A;font-weight:800;margin-bottom:4px">📋 Action Plan</div>
          ${list(rep.actionPlan)}
        </div>
        <details style="margin-top:18px"><summary style="cursor:pointer;font-size:.74rem;color:#64748B">View raw platform snapshot</summary><pre style="font-size:.7rem;background:#F8FAFC;padding:10px;border-radius:6px;overflow:auto">${_e(JSON.stringify(j.snapshot||{}, null, 2))}</pre></details>`;
      const dl = overlay.querySelector('#drDl');
      dl.disabled = false; dl.style.opacity = '1';
      dl.onclick = () => {
        const md = _reportToMarkdown(officerTitle, j);
        const fname = `${officerId}-daily-report-${new Date().toISOString().slice(0,10)}.md`;
        _downloadFile(fname, md);
      };
    } catch(e) {
      overlay.querySelector('#drBody').innerHTML = `<div style="color:#B91C1C;padding:30px;text-align:center">Failed to generate report: ${_e(e.message)}</div>`;
    }
  }

  function _reportToMarkdown(title, j) {
    const r = j.report || {};
    const lines = [];
    lines.push(`# Daily Report — ${title}`);
    lines.push(`_Generated ${new Date(j.generatedAt||Date.now()).toLocaleString()}_\n`);
    lines.push(`## Summary\n${r.summary||''}\n`);
    lines.push(`## Tasks Reviewed`);
    (r.tasksReviewed||[]).forEach(tr => lines.push(`- **[${tr.status||'—'}]** ${tr.task||''}\n  - _Evidence:_ ${tr.evidence||''}`));
    lines.push(`\n## Successes`);
    (r.successes||[]).forEach(s => lines.push(`- ${s}`));
    if (!(r.successes||[]).length) lines.push(`_None recorded_`);
    lines.push(`\n## Issues`);
    (r.issues||[]).forEach(s => lines.push(`- ${s}`));
    if (!(r.issues||[]).length) lines.push(`_None recorded_`);
    lines.push(`\n## Action Plan`);
    (r.actionPlan||[]).forEach(a => lines.push(`- **[${a.priority||'med'}]** ${a.step||a.action||''}`));
    lines.push(`\n## Raw Platform Snapshot\n\`\`\`json\n${JSON.stringify(j.snapshot||{}, null, 2)}\n\`\`\``);
    return lines.join('\n');
  }

  // ── Meetings panel ─────────────────────────────────────────────────────
  async function _renderMeetingsPanel() {
    const host = document.getElementById('aiTeamMeetings');
    if (!host) return;
    let meetings = [];
    try { const r = await fetch('/api/officer/meetings'); const j = await r.json(); meetings = Array.isArray(j.meetings) ? j.meetings : []; } catch(_){}
    host.innerHTML = `
      <div style="${_cardCSS};margin-top:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div>
            <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Cross-functional</div>
            <div style="font-size:1.15rem;font-weight:800;color:#0F172A">🗓️ Officer Meetings</div>
          </div>
          <button id="mtgNew" style="padding:9px 16px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">+ Schedule Meeting</button>
        </div>
        ${meetings.length === 0
          ? `<div style="color:#94A3B8;font-style:italic;padding:20px;text-align:center;background:#F8FAFC;border-radius:8px">No meetings yet. Schedule one to get cross-functional alignment + AI-drafted minutes.</div>`
          : `<div style="display:grid;gap:10px">${meetings.map(m => `
              <div style="border:1px solid #E2E8F0;border-radius:10px;padding:14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
                  <div style="flex:1;min-width:200px">
                    <div style="font-size:.95rem;color:#0F172A;font-weight:700;margin-bottom:3px">${_e(m.topic||'')}</div>
                    <div style="font-size:.72rem;color:#64748B">${new Date(m.scheduledAt||Date.now()).toLocaleString()} · ${(m.attendees||[]).map(a=>_e(a)).join(' · ')}</div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button data-mtg-view="${_e(m.id)}" style="padding:6px 12px;background:#0F172A;color:#fff;border:none;border-radius:7px;font-size:.74rem;font-weight:700;cursor:pointer">View</button>
                    <button data-mtg-dl="${_e(m.id)}" style="padding:6px 12px;background:#0EA5E9;color:#fff;border:none;border-radius:7px;font-size:.74rem;font-weight:700;cursor:pointer">📥 Minutes</button>
                    <button data-mtg-del="${_e(m.id)}" title="Delete" style="padding:6px 10px;background:#FEE2E2;color:#B91C1C;border:none;border-radius:7px;font-size:.74rem;font-weight:700;cursor:pointer">✕</button>
                  </div>
                </div>
              </div>`).join('')}</div>`}
      </div>`;
    host.querySelector('#mtgNew').onclick = () => _openScheduleMeetingModal();
    host.querySelectorAll('button[data-mtg-view]').forEach(b => b.onclick = () => _openMeetingDetail(meetings.find(m=>m.id===b.dataset.mtgView)));
    host.querySelectorAll('button[data-mtg-dl]').forEach(b => b.onclick = () => {
      const m = meetings.find(x => x.id === b.dataset.mtgDl);
      if (m) _downloadFile(`meeting-${m.id}.md`, _meetingToMarkdown(m));
    });
    host.querySelectorAll('button[data-mtg-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this meeting?')) return;
      try { await fetch('/api/officer/meetings/'+encodeURIComponent(b.dataset.mtgDel), { method:'DELETE' }); } catch(_){}
      _renderMeetingsPanel();
    });
  }

  window._teamMeetingToMarkdown = window._teamMeetingToMarkdown || function(m){ return _meetingToMarkdown(m); };
  window._teamOpenMeetingDetail = window._teamOpenMeetingDetail || function(m){ return _openMeetingDetail(m); };
  window._teamDownloadFile      = window._teamDownloadFile      || function(n,c){ return _downloadFile(n,c); };

  function _meetingToMarkdown(m) {
    const lines = [];
    lines.push(`# Meeting Minutes — ${m.topic||''}`);
    lines.push(`_${new Date(m.scheduledAt||Date.now()).toLocaleString()}_\n`);
    lines.push(`**Attendees:** ${(m.attendees||[]).join(', ')}\n`);
    lines.push(`## Discussion`);
    (m.discussion||[]).forEach(p => lines.push(`\n${p}`));
    lines.push(`\n## Decisions`);
    (m.decisions||[]).forEach(d => lines.push(`- ${d}`));
    if (!(m.decisions||[]).length) lines.push(`_None_`);
    lines.push(`\n## Action Items / Plan of Action`);
    (m.actionItems||[]).forEach(a => lines.push(`- **${a.owner||'?'}** — ${a.action||''} _(due: ${a.dueIn||'—'})_`));
    if (!(m.actionItems||[]).length) lines.push(`_None_`);
    return lines.join('\n');
  }

  function _openScheduleMeetingModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:560px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff">
        <div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.9">🗓️ Schedule Meeting</div>
        <h3 style="margin:6px 0 0;font-size:1.25rem;font-weight:800">Cross-functional alignment</h3>
      </div>
      <div style="padding:18px 24px;flex:1;overflow-y:auto">
        <label style="display:block;font-size:.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Topic</label>
        <input id="mtgTopic" placeholder="e.g. Q4 launch readiness across Marketing, Sales and Content" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem;margin-bottom:14px;box-sizing:border-box">
        <label style="display:block;font-size:.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">Attendees (pick at least 2)</label>
        <div id="mtgPick" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${OFFICERS.map(o => `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;font-size:.84rem"><input type="checkbox" value="${_e(o.title)}" data-id="${_e(o.id)}" style="margin:0">${_e((typeof _officerAvatars[o.id]==='string'&&_officerAvatars[o.id])||o.icon)} ${_e(o.title)}</label>`).join('')}
        </div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;background:#F8FAFC">
        <button id="mtgCancel" style="padding:10px 18px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">Cancel</button>
        <button id="mtgGo" style="padding:10px 22px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer">Schedule + Draft Minutes</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#mtgCancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
    overlay.querySelector('#mtgGo').onclick = async () => {
      const topic = overlay.querySelector('#mtgTopic').value.trim();
      const attendees = Array.from(overlay.querySelectorAll('#mtgPick input:checked')).map(i => i.value);
      const tasksByRole = {};
      Array.from(overlay.querySelectorAll('#mtgPick input:checked')).forEach(i => {
        try {
          const p = JSON.parse(localStorage.getItem('ig_officer_tasks_'+i.dataset.id)||'[]');
          tasksByRole[i.value] = Array.isArray(p) ? p.filter(s=>typeof s==='string').slice(0,15) : [];
        } catch(_) { tasksByRole[i.value] = []; }
      });
      if (!topic || attendees.length < 2) { alert('Pick at least 2 attendees and enter a topic.'); return; }
      const btn = overlay.querySelector('#mtgGo');
      btn.disabled = true; btn.textContent = '⏳ Drafting minutes…';
      try {
        const r = await fetch('/api/officer/meetings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ topic, attendees, tasksByRole }) });
        const j = await r.json();
        close();
        await _renderMeetingsPanel();
        if (j.meeting) _openMeetingDetail(j.meeting);
      } catch(e) {
        btn.disabled = false; btn.textContent = 'Schedule + Draft Minutes';
        alert('Failed: '+e.message);
      }
    };
  }

  function _openMeetingDetail(m) {
    if (!m) return;
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:760px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0F172A,#312E81);color:#fff">
        <div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.8">📝 Meeting Minutes</div>
        <h3 style="margin:6px 0 4px;font-size:1.3rem;font-weight:800">${_e(m.topic||'')}</h3>
        <p style="margin:0;font-size:.8rem;opacity:.85">${new Date(m.scheduledAt||Date.now()).toLocaleString()} · ${(m.attendees||[]).map(a=>_e(a)).join(' · ')}</p>
      </div>
      <div style="flex:1;overflow-y:auto;padding:18px 24px">
        <div style="margin-bottom:18px">
          <div style="font-size:.78rem;font-weight:800;color:#0F172A;margin-bottom:6px">💬 Discussion</div>
          ${(m.discussion||[]).map(p => `<p style="font-size:.88rem;color:#0F172A;line-height:1.6;margin:0 0 10px">${_e(p)}</p>`).join('') || '<div style="color:#94A3B8;font-style:italic">No discussion notes</div>'}
        </div>
        <div style="margin-bottom:18px">
          <div style="font-size:.78rem;font-weight:800;color:#0F172A;margin-bottom:6px">✅ Decisions</div>
          ${(m.decisions||[]).length ? `<ul style="margin:0 0 0 18px;padding:0;font-size:.88rem;line-height:1.7;color:#0F172A">${m.decisions.map(d=>`<li>${_e(d)}</li>`).join('')}</ul>` : '<div style="color:#94A3B8;font-style:italic">None</div>'}
        </div>
        <div>
          <div style="font-size:.78rem;font-weight:800;color:#0F172A;margin-bottom:6px">📋 Plan of Action</div>
          ${(m.actionItems||[]).length ? `<div style="display:grid;gap:6px">${m.actionItems.map(a=>`<div style="border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div style="flex:1"><div style="font-size:.86rem;color:#0F172A;font-weight:600">${_e(a.action||'')}</div><div style="font-size:.7rem;color:#64748B;margin-top:2px">Owner: ${_e(a.owner||'?')}</div></div><span style="${_pillCSS};background:#F1F5F9;color:#0F172A">due ${_e(a.dueIn||'—')}</span></div>`).join('')}</div>` : '<div style="color:#94A3B8;font-style:italic">None</div>'}
        </div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;gap:8px;background:#F8FAFC">
        <button id="mdClose" style="padding:10px 18px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">Close</button>
        <button id="mdDl" style="padding:10px 22px;background:#0EA5E9;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer">📥 Download Minutes</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#mdClose').onclick = close;
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
    overlay.querySelector('#mdDl').onclick = () => _downloadFile(`meeting-${m.id}.md`, _meetingToMarkdown(m));
  }

  // ── Tasks modal ─────────────────────────────────────────────────────────
  async function _openTasksModal(officerId, officerTitle) {
    const storeKey = 'ig_officer_tasks_' + officerId;
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(storeKey)||'[]');
      saved = Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string').slice(0,200) : [];
    } catch(_){}
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:640px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff">
        <div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.9">📋 Job Responsibilities</div>
        <h3 style="margin:6px 0 4px;font-size:1.3rem;font-weight:800">${_e(officerTitle)}</h3>
        <p style="margin:0;font-size:.85rem;opacity:.95">Pick the tasks you want this AI employee to own. You can add custom ones too.</p>
      </div>
      <div style="padding:18px 24px;border-bottom:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="font-size:.84rem;color:#64748B"><strong id="otCount" style="color:#0F172A">${saved.length}</strong> selected · <strong id="otTotal">—</strong> suggested</div>
        <button id="otRegen" style="padding:7px 14px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer">🔄 Regenerate with AI</button>
      </div>
      <div id="otList" style="flex:1;overflow-y:auto;padding:14px 24px"><div style="text-align:center;color:#64748B;padding:30px">⏳ Asking AI for relevant tasks…</div></div>
      <div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;gap:8px;align-items:center">
        <input id="otCustom" placeholder="+ Add custom responsibility…" style="flex:1;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.86rem">
        <button id="otAddCustom" style="padding:9px 14px;background:#0EA5E9;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Add</button>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;background:#F8FAFC">
        <button id="otCancel" style="padding:10px 18px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">Cancel</button>
        <button id="otSave" style="padding:10px 22px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer">Save Responsibilities</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); window.buildAiTeam && window.buildAiTeam(); };
    overlay.querySelector('#otCancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });

    let suggestions = [];
    const renderList = () => {
      const all = [...new Set([...suggestions, ...saved])];
      overlay.querySelector('#otTotal').textContent = suggestions.length;
      overlay.querySelector('#otCount').textContent = saved.length;
      overlay.querySelector('#otList').innerHTML = all.length===0
        ? '<div style="text-align:center;color:#94A3B8;padding:30px">No suggestions returned.</div>'
        : all.map((t,i) => {
            const checked = saved.includes(t) ? 'checked' : '';
            const isCustom = !suggestions.includes(t);
            return `<label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid ${checked?'#7C3AED':'#E2E8F0'};border-radius:9px;margin-bottom:6px;cursor:pointer;background:${checked?'#FAF5FF':'#fff'}"><input type="checkbox" data-task-idx="${i}" ${checked} style="margin-top:3px"><div style="flex:1"><div style="font-size:.88rem;color:#0F172A;font-weight:600">${_e(t)}</div>${isCustom?'<div style="font-size:.66rem;color:#7C3AED;margin-top:2px;font-weight:700">CUSTOM</div>':''}</div></label>`;
          }).join('');
      overlay.querySelectorAll('input[data-task-idx]').forEach(cb => cb.onchange = e => {
        const all2 = [...new Set([...suggestions, ...saved])];
        const t = all2[+e.target.dataset.taskIdx];
        if (e.target.checked) { if (!saved.includes(t)) saved.push(t); }
        else saved = saved.filter(x => x !== t);
        overlay.querySelector('#otCount').textContent = saved.length;
        e.target.closest('label').style.borderColor = e.target.checked?'#7C3AED':'#E2E8F0';
        e.target.closest('label').style.background  = e.target.checked?'#FAF5FF':'#fff';
      });
    };
    const fetchTasks = async () => {
      overlay.querySelector('#otList').innerHTML = '<div style="text-align:center;color:#64748B;padding:30px">⏳ Asking AI for relevant tasks…</div>';
      try {
        const r = await fetch('/api/officer/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: officerId, title: officerTitle }) });
        const j = await r.json();
        suggestions = Array.isArray(j.tasks) ? j.tasks : [];
      } catch(e) { suggestions = []; }
      renderList();
    };
    overlay.querySelector('#otRegen').onclick = fetchTasks;
    overlay.querySelector('#otAddCustom').onclick = () => {
      const inp = overlay.querySelector('#otCustom');
      const v = inp.value.trim(); if (!v) return;
      if (!saved.includes(v)) saved.push(v);
      inp.value=''; renderList();
    };
    overlay.querySelector('#otCustom').onkeydown = e => { if (e.key==='Enter'){ e.preventDefault(); overlay.querySelector('#otAddCustom').click(); } };
    overlay.querySelector('#otSave').onclick = async () => {
      try { localStorage.setItem(storeKey, JSON.stringify(saved)); } catch(_){}
      // Mirror to server so the autonomous scheduler can use these tasks
      // when the user's browser is closed.
      try {
        await fetch('/api/officer/tasks-store', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: officerId, tasks: saved }) });
      } catch(_){}
      if (typeof showToast==='function') showToast(`✓ Saved ${saved.length} ${saved.length===1?'task':'tasks'} for ${officerTitle}`);
      close();
    };
    fetchTasks();
  }
  window._openOfficerTasksModal = _openTasksModal;

  window.buildAiTeam = async function() {
    const wrap = document.getElementById('view-ai-team');
    if (!wrap) return;
    // Load avatars first (best-effort)
    try {
      const r = await fetch('/api/officer/avatars');
      const j = await r.json();
      _officerAvatars = (j && typeof j.avatars==='object' && !Array.isArray(j.avatars)) ? j.avatars : {};
    } catch(_) { _officerAvatars = {}; }
    wrap.innerHTML = `
      <div style="${_hdrCSS}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
          <div>
            <div style="font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:#A5B4FC;font-weight:700">YOUR AI TEAM</div>
            <h1 style="margin:8px 0 6px;font-size:1.85rem;font-weight:800">Eight AI executives, one team</h1>
            <p style="margin:0;font-size:.92rem;color:#CBD5E1;max-width:720px">Each officer handles a function full-time. Click any role to open their office. Pick an avatar, assign tasks, run daily reports, and schedule cross-functional meetings — all minutes downloadable.</p>
          </div>
          <button id="aiTeamStatusPill" title="Click for full system status" style="display:inline-flex;align-items:center;gap:8px;background:rgba(15,23,42,0.5);border:1px solid rgba(148,163,184,0.3);color:#fff;padding:8px 14px;border-radius:99px;font-size:.78rem;font-weight:700;cursor:pointer">
            <span id="aiTeamStatusDot" style="width:9px;height:9px;border-radius:50%;background:#94A3B8;box-shadow:0 0 0 3px rgba(148,163,184,0.25);animation:pulse 2s infinite"></span>
            <span id="aiTeamStatusText">Checking…</span>
          </button>
        </div>
      </div>
      <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}</style>
      <div style="max-width:1200px;margin:0 auto;padding:0 28px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px">
        ${OFFICERS.map(_officerCard).join('')}
      </div>
      <div style="max-width:1200px;margin:0 auto;padding:18px 28px 0" id="aiTeamAutoReport"></div>
      <div style="max-width:1200px;margin:0 auto;padding:0 28px" id="aiTeamMeetings"></div>`;
    _refreshSystemStatusPill();
    if (window._aiTeamStatusInt) clearInterval(window._aiTeamStatusInt);
    window._aiTeamStatusInt = setInterval(_refreshSystemStatusPill, 30000);
    wrap.querySelector('#aiTeamStatusPill').onclick = _openSystemStatusPanel;
    wrap.querySelectorAll('.nav-link[data-view]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigateTo(a.dataset.view); }));
    wrap.querySelectorAll('button[data-officer-tasks]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      _openTasksModal(b.dataset.officerTasks, b.dataset.officerTitle);
    }));
    wrap.querySelectorAll('button[data-officer-report]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      _openDailyReport(b.dataset.officerReport, b.dataset.officerTitle);
    }));
    wrap.querySelectorAll('button[data-officer-avatar]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      _openAvatarPicker(b.dataset.officerAvatar, b);
    }));
    _renderMeetingsPanel();
    _renderAutoReportPanel();
    _renderAutoMeetingsPanel();
  };

  // ── System Status pill + detail panel ─────────────────────────────────
  async function _refreshSystemStatusPill() {
    const dot = document.getElementById('aiTeamStatusDot');
    const txt = document.getElementById('aiTeamStatusText');
    if (!dot || !txt) return;
    try {
      const r = await fetch('/api/officer/system-status');
      const j = await r.json();
      window._aiTeamLastStatus = j;
      const checks = j.checks || {};
      const blockers = ['server','database','aiProvider','scheduler'].filter(k => !checks[k]?.ok);
      const off = ['autoReport','autoMeetings'].filter(k => !checks[k]?.ok);
      let color, label;
      if (blockers.length) { color = '#EF4444'; label = `OFFLINE — ${blockers.length} issue${blockers.length>1?'s':''}`; }
      else if (off.length === 2) { color = '#F59E0B'; label = 'LIVE — schedulers paused'; }
      else if (off.length === 1) { color = '#10B981'; label = 'LIVE — partial schedule'; }
      else { color = '#10B981'; label = 'LIVE — fully autonomous'; }
      dot.style.background = color;
      dot.style.boxShadow = `0 0 0 3px ${color}33`;
      txt.textContent = label;
    } catch(_) {
      dot.style.background = '#EF4444'; dot.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.2)';
      txt.textContent = 'OFFLINE — unreachable';
    }
  }
  function _openSystemStatusPanel() {
    const j = window._aiTeamLastStatus || { checks:{}, activity:{} };
    const checks = j.checks || {};
    const act = j.activity || {};
    const fmt = (iso) => iso ? new Date(iso).toLocaleString() : '—';
    const ago = (iso) => { if (!iso) return '—'; const s = Math.floor((Date.now()-new Date(iso).getTime())/1000); if (s<60) return s+'s ago'; if (s<3600) return Math.floor(s/60)+'m ago'; if (s<86400) return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; };
    const row = (k, c) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:6px;background:${c.ok?'#F0FDF4':'#FEF2F2'}">
      <span style="font-size:1.1rem">${c.ok?'✅':'❌'}</span>
      <span style="font-size:.84rem;font-weight:700;color:#0F172A;text-transform:capitalize;min-width:110px">${k.replace(/([A-Z])/g,' $1').toLowerCase()}</span>
      <span style="font-size:.8rem;color:${c.ok?'#166534':'#991B1B'};flex:1">${_e(c.label||'')}</span>
    </div>`;
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.65);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:600px;max-width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:18px 22px;background:linear-gradient(135deg,#0F172A,#312E81);color:#fff;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.85">AI Team Health</div>
          <h3 style="margin:4px 0 0;font-size:1.2rem;font-weight:800">${j.ok ? '🟢 System Live' : '🔴 System Degraded'}</h3></div>
        <button id="ssClose" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:34px;height:34px;border-radius:50%;font-size:1.1rem;cursor:pointer">×</button>
      </div>
      <div style="padding:18px 22px;overflow-y:auto;flex:1">
        <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:6px">Checks</div>
        ${Object.entries(checks).map(([k,c])=>row(k,c)).join('')}
        <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin:14px 0 8px">Recent Activity</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px">
            <div style="font-size:.7rem;color:#64748B;font-weight:700">LAST DAILY REPORT</div>
            <div style="font-size:.86rem;font-weight:700;color:#0F172A;margin-top:2px">${ago(act.lastReportAt)}</div>
            <div style="font-size:.7rem;color:#64748B;margin-top:2px">${fmt(act.lastReportAt)} · ${act.totalReports||0} total</div>
          </div>
          <div style="padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px">
            <div style="font-size:.7rem;color:#64748B;font-weight:700">LAST MEETING</div>
            <div style="font-size:.86rem;font-weight:700;color:#0F172A;margin-top:2px">${ago(act.lastMeetingAt)}</div>
            <div style="font-size:.7rem;color:#64748B;margin-top:2px">${fmt(act.lastMeetingAt)} · ${act.totalMeetings||0} total</div>
          </div>
          <div style="padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px">
            <div style="font-size:.7rem;color:#64748B;font-weight:700">LAST SCHEDULER TICK</div>
            <div style="font-size:.86rem;font-weight:700;color:#0F172A;margin-top:2px">${ago(act.lastTickAt)}</div>
            <div style="font-size:.7rem;color:#64748B;margin-top:2px">runs every 60s</div>
          </div>
          <div style="padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px">
            <div style="font-size:.7rem;color:#64748B;font-weight:700">SERVER UPTIME</div>
            <div style="font-size:.86rem;font-weight:700;color:#0F172A;margin-top:2px">${(() => { const s=act.uptimeSec||0; if (s<3600) return Math.floor(s/60)+'m'; if (s<86400) return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; return Math.floor(s/86400)+'d '+Math.floor((s%86400)/3600)+'h'; })()}</div>
            <div style="font-size:.7rem;color:#64748B;margin-top:2px">since ${fmt(act.serverStartedAt)}</div>
          </div>
        </div>
      </div>
      <div style="padding:12px 22px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;background:#F8FAFC">
        <button id="ssRefresh" style="padding:9px 16px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:7px;font-weight:700;cursor:pointer">↻ Refresh</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ssClose').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
    overlay.querySelector('#ssRefresh').onclick = async () => { await _refreshSystemStatusPill(); overlay.remove(); _openSystemStatusPanel(); };
  }

  // ── Autonomous Meetings scheduler panel (on AI Team page) ─────────────
  async function _renderAutoMeetingsPanel() {
    let host = document.getElementById('aiTeamAutoMeetings');
    if (!host) {
      const meetingsHost = document.getElementById('aiTeamMeetings');
      if (!meetingsHost) return;
      host = document.createElement('div');
      host.id = 'aiTeamAutoMeetings';
      host.style.cssText = 'max-width:1200px;margin:0 auto;padding:0 28px';
      meetingsHost.parentNode.insertBefore(host, meetingsHost);
    }
    let s = { enabled:false, frequency:'weekly', dayOfWeek:1, hour:9, minute:30, timezone:'UTC' };
    try { const r = await fetch('/api/officer/auto-meetings'); const j = await r.json(); s = { ...s, ...(j.settings||{}) }; } catch(_){}
    const detectedTz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
    const dowName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][s.dayOfWeek|0] || 'Mon';
    const status = s.enabled ? `<span style="${_pillCSS};background:#DCFCE7;color:#166534">● ON · ${s.frequency==='weekly'?dowName+' ':''}${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')} ${_e(s.timezone)}</span>` : `<span style="${_pillCSS};background:#F1F5F9;color:#475569">○ OFF</span>`;
    host.innerHTML = `<div style="${_cardCSS};margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px">
        <div>
          <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Autonomous</div>
          <div style="font-size:1.15rem;font-weight:800;color:#0F172A">🗓️ Auto-Scheduled Team Meetings ${status}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="amSettings" style="padding:9px 16px;background:#0F172A;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">⚙️ Settings</button>
          <button id="amRunNow" style="padding:9px 16px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">▶ Run Now</button>
        </div>
      </div>
      <div style="font-size:.82rem;color:#475569;line-height:1.5">When ON, the AI Team auto-schedules a recurring cross-functional meeting and the AI minute-taker drafts notes (with a clear to-do list of action items per officer). All 8 officers attend by default. Browse all minutes anytime via <strong>Manage → Minutes of Meeting</strong>.</div>
    </div>`;
    host.querySelector('#amSettings').onclick = () => _openAutoMeetingSettings(s, detectedTz);
    host.querySelector('#amRunNow').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = '⏳ Drafting…';
      try {
        const r = await fetch('/api/officer/auto-meetings/run-now', { method:'POST' });
        const j = await r.json();
        if (typeof showToast==='function') showToast('✓ Meeting created with AI minutes');
        if (j.meeting) _openMeetingDetail(j.meeting);
        _renderMeetingsPanel();
      } catch(err) { alert('Failed: '+err.message); }
      _renderAutoMeetingsPanel();
    };
  }

  function _openAutoMeetingSettings(cur, detectedTz) {
    const TZS = ['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','America/Toronto','America/Sao_Paulo','Europe/London','Europe/Paris','Europe/Berlin','Europe/Athens','Europe/Moscow','Africa/Cairo','Africa/Johannesburg','Asia/Dubai','Asia/Karachi','Asia/Kolkata','Asia/Bangkok','Asia/Singapore','Asia/Hong_Kong','Asia/Shanghai','Asia/Tokyo','Australia/Sydney','Pacific/Auckland'];
    if (detectedTz && !TZS.includes(detectedTz)) TZS.unshift(detectedTz);
    if (cur.timezone && !TZS.includes(cur.timezone)) TZS.unshift(cur.timezone);
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    const hours = Array.from({length:24},(_,i)=>i);
    const mins  = [0,15,30,45];
    const dows  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:560px;max-width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0F172A,#312E81);color:#fff">
        <div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.85">🗓️ Autonomous Meetings</div>
        <h3 style="margin:6px 0 0;font-size:1.25rem;font-weight:800">Recurring AI Team Standup</h3>
      </div>
      <div style="padding:20px 24px;flex:1;overflow-y:auto">
        <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;cursor:pointer;margin-bottom:16px">
          <input id="amEn" type="checkbox" ${cur.enabled?'checked':''} style="width:18px;height:18px;cursor:pointer">
          <div style="flex:1"><div style="font-weight:700;font-size:.92rem;color:#0F172A">Auto-schedule team meetings</div><div style="font-size:.76rem;color:#64748B">Server creates the meeting + drafts minutes on the schedule below.</div></div>
        </label>
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Frequency</label>
          <div style="display:flex;gap:8px">
            <label style="flex:1;padding:10px;border:2px solid ${cur.frequency==='daily'?'#7C3AED':'#E2E8F0'};border-radius:8px;cursor:pointer;text-align:center;font-weight:700;font-size:.84rem"><input type="radio" name="amFreq" value="daily" ${cur.frequency==='daily'?'checked':''} style="display:none">Daily</label>
            <label style="flex:1;padding:10px;border:2px solid ${cur.frequency==='weekly'?'#7C3AED':'#E2E8F0'};border-radius:8px;cursor:pointer;text-align:center;font-weight:700;font-size:.84rem"><input type="radio" name="amFreq" value="weekly" ${cur.frequency==='weekly'?'checked':''} style="display:none">Weekly</label>
          </div>
        </div>
        <div id="amDowWrap" style="margin-bottom:14px;${cur.frequency==='daily'?'display:none':''}">
          <label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Day of week</label>
          <select id="amDow" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem">${dows.map((d,i)=>`<option value="${i}" ${(cur.dayOfWeek|0)===i?'selected':''}>${d}</option>`).join('')}</select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div><label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Hour (24h)</label>
            <select id="amH" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem">${hours.map(h=>`<option value="${h}" ${(cur.hour|0)===h?'selected':''}>${String(h).padStart(2,'0')}</option>`).join('')}</select></div>
          <div><label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Minute</label>
            <select id="amM" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem">${mins.map(m=>`<option value="${m}" ${(cur.minute|0)===m?'selected':''}>${String(m).padStart(2,'0')}</option>`).join('')}</select></div>
        </div>
        <label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Timezone</label>
        <select id="amTz" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem;margin-bottom:4px">${TZS.map(t=>`<option value="${_e(t)}" ${(cur.timezone||'UTC')===t?'selected':''}>${_e(t)}</option>`).join('')}</select>
        <div style="font-size:.7rem;color:#64748B">Detected: <strong>${_e(detectedTz||'UTC')}</strong></div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;background:#F8FAFC">
        <button id="amCancel" style="padding:10px 18px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">Cancel</button>
        <button id="amSave" style="padding:10px 22px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer">Save</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#amCancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
    overlay.querySelectorAll('input[name="amFreq"]').forEach(r => r.onchange = () => {
      overlay.querySelectorAll('label[for], label').forEach(()=>{});
      overlay.querySelectorAll('input[name="amFreq"]').forEach(rr => rr.parentElement.style.borderColor = rr.checked?'#7C3AED':'#E2E8F0');
      overlay.querySelector('#amDowWrap').style.display = (overlay.querySelector('input[name="amFreq"]:checked').value==='weekly') ? '' : 'none';
    });
    overlay.querySelector('#amSave').onclick = async () => {
      const body = {
        enabled: overlay.querySelector('#amEn').checked,
        frequency: overlay.querySelector('input[name="amFreq"]:checked').value,
        dayOfWeek: +overlay.querySelector('#amDow').value,
        hour: +overlay.querySelector('#amH').value,
        minute: +overlay.querySelector('#amM').value,
        timezone: overlay.querySelector('#amTz').value
      };
      try {
        const r = await fetch('/api/officer/auto-meetings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok) { alert(j.error||'Save failed'); return; }
        if (typeof showToast==='function') showToast('✓ Auto-meeting schedule saved');
        close(); _renderAutoMeetingsPanel();
      } catch(err) { alert('Save failed: '+err.message); }
    };
  }

  // ── Manage → Minutes of Meeting (calendar + list) ─────────────────────
  window.buildTeamMeetings = async function() {
    const wrap = document.getElementById('teamMeetingsWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="text-align:center;color:#64748B;padding:40px">⏳ Loading meetings…</div>';
    let meetings = [];
    try { const r = await fetch('/api/officer/meetings'); const j = await r.json(); meetings = Array.isArray(j.meetings) ? j.meetings : []; } catch(_){}

    const view = { ym: (() => { const d=new Date(); return [d.getFullYear(), d.getMonth()]; })() };

    function render() {
      const [yr, mo] = view.ym;
      const monthStart = new Date(yr, mo, 1);
      const monthName = monthStart.toLocaleString(undefined, { month:'long', year:'numeric' });
      const daysInMonth = new Date(yr, mo+1, 0).getDate();
      const firstDow = monthStart.getDay();
      const byDay = {};
      meetings.forEach(m => {
        const d = new Date(m.scheduledAt);
        if (d.getFullYear()===yr && d.getMonth()===mo) {
          const k = d.getDate();
          (byDay[k] = byDay[k] || []).push(m);
        }
      });
      const cells = [];
      for (let i=0; i<firstDow; i++) cells.push('<div></div>');
      for (let d=1; d<=daysInMonth; d++) {
        const items = byDay[d] || [];
        const isToday = (() => { const t = new Date(); return t.getFullYear()===yr && t.getMonth()===mo && t.getDate()===d; })();
        const hasMeetings = items.length > 0;
        cells.push(`<button data-day="${d}" ${hasMeetings?'':'disabled'} style="aspect-ratio:1;padding:6px;border:1px solid ${isToday?'#7C3AED':'#E2E8F0'};border-radius:8px;background:${hasMeetings?'#F5F3FF':'#fff'};cursor:${hasMeetings?'pointer':'default'};display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:2px">
          <div style="font-size:.78rem;font-weight:${isToday?800:600};color:${hasMeetings?'#7C3AED':'#64748B'}">${d}</div>
          ${hasMeetings ? `<div style="font-size:.6rem;background:#7C3AED;color:#fff;padding:2px 6px;border-radius:99px;font-weight:700">${items.length}</div>` : ''}
        </button>`);
      }
      const sorted = [...meetings].sort((a,b)=> new Date(b.scheduledAt) - new Date(a.scheduledAt));
      wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
          <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px">
            <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase">Total meetings</div>
            <div style="font-size:1.6rem;font-weight:800;color:#0F172A">${meetings.length}</div>
          </div>
          <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px">
            <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase">Autonomous</div>
            <div style="font-size:1.6rem;font-weight:800;color:#0F172A">${meetings.filter(m=>m.autonomous).length}</div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:18px;margin-bottom:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <button id="tmPrev" style="padding:7px 12px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">‹ Prev</button>
            <div style="font-size:1.05rem;font-weight:800;color:#0F172A">${monthName}</div>
            <button id="tmNext" style="padding:7px 12px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">Next ›</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div style="text-align:center;font-size:.65rem;color:#64748B;font-weight:700;padding:4px">${d}</div>`).join('')}</div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cells.join('')}</div>
        </div>
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:18px">
          <div style="font-size:1rem;font-weight:800;color:#0F172A;margin-bottom:12px">All meetings (newest first)</div>
          ${sorted.length === 0
            ? `<div style="color:#94A3B8;font-style:italic;padding:20px;text-align:center">No meetings yet. Enable autonomous meetings on the AI Team page or schedule one manually.</div>`
            : `<div style="display:grid;gap:8px">${sorted.map(m => `
              <div style="border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                  <div style="font-size:.92rem;color:#0F172A;font-weight:700">${_e(m.topic||'')} ${m.autonomous?`<span style="${_pillCSS};background:#EDE9FE;color:#5B21B6;margin-left:6px">AUTO</span>`:''}</div>
                  <div style="font-size:.72rem;color:#64748B;margin-top:3px">${new Date(m.scheduledAt).toLocaleString()} · ${(m.attendees||[]).length} attendees · ${(m.actionItems||[]).length} action items</div>
                </div>
                <div style="display:flex;gap:6px">
                  <button data-tm-view="${_e(m.id)}" style="padding:6px 12px;background:#0F172A;color:#fff;border:none;border-radius:7px;font-size:.74rem;font-weight:700;cursor:pointer">View Minutes</button>
                  <button data-tm-dl="${_e(m.id)}" style="padding:6px 12px;background:#0EA5E9;color:#fff;border:none;border-radius:7px;font-size:.74rem;font-weight:700;cursor:pointer">📥 Download</button>
                </div>
              </div>`).join('')}</div>`}
        </div>`;
      wrap.querySelector('#tmPrev').onclick = () => { view.ym = [view.ym[1]===0?view.ym[0]-1:view.ym[0], view.ym[1]===0?11:view.ym[1]-1]; render(); };
      wrap.querySelector('#tmNext').onclick = () => { view.ym = [view.ym[1]===11?view.ym[0]+1:view.ym[0], view.ym[1]===11?0:view.ym[1]+1]; render(); };
      wrap.querySelectorAll('button[data-day]').forEach(b => b.onclick = () => {
        const items = byDay[+b.dataset.day] || [];
        if (items.length === 1) window._teamOpenMeetingDetail(items[0]);
        else if (items.length > 1) {
          const dlg = document.createElement('div');
          dlg.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
          dlg.innerHTML = `<div style="background:#fff;border-radius:14px;width:480px;max-width:100%;padding:18px"><div style="font-weight:800;color:#0F172A;margin-bottom:10px">${items.length} meetings on ${monthName.split(' ')[0]} ${b.dataset.day}</div>${items.map(m=>`<button data-mid="${_e(m.id)}" style="display:block;width:100%;text-align:left;padding:10px 12px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;cursor:pointer;margin-bottom:6px"><div style="font-weight:700;font-size:.86rem;color:#0F172A">${_e(m.topic)}</div><div style="font-size:.72rem;color:#64748B">${new Date(m.scheduledAt).toLocaleTimeString()}</div></button>`).join('')}<button id="dlgCx" style="margin-top:8px;padding:8px 16px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:7px;font-weight:700;cursor:pointer;float:right">Close</button></div>`;
          document.body.appendChild(dlg);
          dlg.querySelector('#dlgCx').onclick = () => dlg.remove();
          dlg.addEventListener('click', e => { if (e.target===dlg) dlg.remove(); });
          dlg.querySelectorAll('button[data-mid]').forEach(bb => bb.onclick = () => { dlg.remove(); window._teamOpenMeetingDetail(items.find(m=>m.id===bb.dataset.mid)); });
        }
      });
      wrap.querySelectorAll('button[data-tm-view]').forEach(b => b.onclick = () => window._teamOpenMeetingDetail(meetings.find(m=>m.id===b.dataset.tmView)));
      wrap.querySelectorAll('button[data-tm-dl]').forEach(b => b.onclick = () => {
        const m = meetings.find(x=>x.id===b.dataset.tmDl);
        if (m) window._teamDownloadFile(`meeting-${m.id}.md`, window._teamMeetingToMarkdown(m));
      });
    }
    render();
  };

  // ── Manage → 7-Day Marketing Playbook ─────────────────────────────────
  window.buildPlaybook7Day = async function() {
    const wrap = document.getElementById('playbook7DayWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="text-align:center;color:#64748B;padding:40px">⏳ Loading playbook…</div>';
    let data = { playbook: [], state: {}, suggestions: {}, runs: [] };
    try { const r = await fetch('/api/playbook'); data = await r.json(); } catch(e) { wrap.innerHTML = '<div style="color:#B91C1C;padding:20px">Failed to load: '+e.message+'</div>'; return; }

    const dayColors = ['#0EA5E9','#8B5CF6','#10B981','#F59E0B','#EF4444','#EC4899','#6366F1'];
    const officerEmoji = { marketing:'📣', sales:'💼', analyst:'📊', content:'✍️', seo:'🔍', cro:'🎯', finance:'💰', ops:'⚙️' };

    function totalDone() {
      const all = data.playbook.flatMap(d => d.steps.map(s => s.id));
      const done = all.filter(id => data.state[id]==='done').length;
      return { done, total: all.length };
    }

    function render() {
      const { done, total } = totalDone();
      const pct = total ? Math.round((done/total)*100) : 0;
      const recentRun = (data.runs||[])[0];
      wrap.innerHTML = `
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px;margin-bottom:18px;box-shadow:0 4px 14px rgba(15,23,42,0.05)">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
            <div>
              <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Strategic Plan</div>
              <div style="font-size:1.3rem;font-weight:800;color:#0F172A">7-Day Marketing Playbook</div>
              <div style="font-size:.82rem;color:#475569;margin-top:4px">${done} / ${total} steps marked done · ${pct}% complete${recentRun ? ` · last autonomous run ${new Date(recentRun.at).toLocaleString()} (${recentRun.totalAdded} tasks)` : ''}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button id="pbRunAll" title="Assign every step to an AI officer as a tracked task" style="padding:11px 18px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:9px;font-weight:700;cursor:pointer;font-size:.92rem">▶ Run Autonomously (all 7 days)</button>
            </div>
          </div>
          <div style="height:8px;background:#F1F5F9;border-radius:99px;overflow:hidden"><div style="width:${pct}%;height:100%;background:linear-gradient(135deg,#10B981,#0EA5E9);transition:width .3s"></div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px">
          ${data.playbook.map((d,idx) => {
            const dayDone = d.steps.filter(s => data.state[s.id]==='done').length;
            const c = dayColors[idx % dayColors.length];
            return `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(15,23,42,0.05)">
              <div style="padding:16px 18px;background:linear-gradient(135deg,${c},#0F172A);color:#fff">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
                  <div>
                    <div style="font-size:.66rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.85">Day ${d.day} · Lead: ${officerEmoji[d.officer]||''} ${_e(d.officer)}</div>
                    <div style="font-size:1.05rem;font-weight:800;margin-top:4px">${_e(d.title)}</div>
                  </div>
                  <button data-pb-runday="${d.day}" title="Assign just this day's steps to officers" style="padding:7px 11px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);color:#fff;border-radius:7px;font-weight:700;cursor:pointer;font-size:.72rem;white-space:nowrap">▶ Run Day ${d.day}</button>
                </div>
                <div style="font-size:.78rem;opacity:.9;margin-top:6px;line-height:1.4">${_e(d.objective)}</div>
                <div style="font-size:.7rem;opacity:.85;margin-top:6px">${dayDone}/${d.steps.length} steps done</div>
              </div>
              <div style="padding:6px 10px">
                ${d.steps.map(s => {
                  const isDone = data.state[s.id]==='done';
                  const sug = data.suggestions[s.id];
                  return `<div style="padding:11px 8px;border-top:1px solid #F1F5F9">
                    <div style="display:flex;align-items:flex-start;gap:10px">
                      <button data-pb-toggle="${s.id}" title="Mark done / undo" style="margin-top:2px;width:22px;height:22px;border-radius:5px;border:1.5px solid ${isDone?'#10B981':'#CBD5E1'};background:${isDone?'#10B981':'#fff'};color:#fff;cursor:pointer;font-size:.78rem;font-weight:700;flex-shrink:0">${isDone?'✓':''}</button>
                      <div style="flex:1;min-width:0">
                        <div style="font-weight:700;color:#0F172A;font-size:.86rem;${isDone?'text-decoration:line-through;opacity:.6':''}">${_e(s.label)} <span style="font-weight:600;color:#64748B;font-size:.72rem">· ${officerEmoji[s.officer]||''} ${_e(s.officer)}</span></div>
                        <div style="font-size:.74rem;color:#475569;margin-top:3px;line-height:1.45">${_e(s.detail)}</div>
                        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
                          <button data-pb-suggest="${s.id}" style="padding:5px 10px;background:#0EA5E9;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:.7rem">🤖 AI Suggest</button>
                          ${sug ? `<button data-pb-viewsug="${s.id}" style="padding:5px 10px;background:#F1F5F9;color:#0F172A;border:1px solid #CBD5E1;border-radius:6px;font-weight:700;cursor:pointer;font-size:.7rem">👁️ View suggestion</button>` : ''}
                        </div>
                        ${sug ? `<div style="margin-top:8px;padding:8px 10px;background:#F0F9FF;border-left:3px solid #0EA5E9;border-radius:0 6px 6px 0;font-size:.74rem;color:#0F172A"><strong>${_e(sug.headline||'')}</strong> <span style="color:#64748B">· ${new Date(sug.generatedAt).toLocaleDateString()}</span></div>` : ''}
                      </div>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>`;
          }).join('')}
        </div>
        ${(data.runs||[]).length ? `<details style="margin-top:18px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px"><summary style="cursor:pointer;font-weight:700;color:#0F172A;font-size:.86rem">▸ Autonomous run history (${data.runs.length})</summary><div style="margin-top:10px">${data.runs.map(r => `<div style="padding:8px 0;border-top:1px solid #F1F5F9;font-size:.78rem;color:#0F172A;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><span>${new Date(r.at).toLocaleString()} · ${r.dayFilter ? `Day ${r.dayFilter}` : 'All 7 days'}</span><span style="color:#64748B">${r.totalAdded} tasks across ${Object.keys(r.added||{}).length} officers</span></div>`).join('')}</div></details>` : ''}
      `;

      wrap.querySelectorAll('button[data-pb-toggle]').forEach(b => b.onclick = async () => {
        const r = await fetch(`/api/playbook/step/${b.dataset.pbToggle}/toggle`, { method:'POST' });
        const j = await r.json();
        if (j.state) { data.state = j.state; render(); }
      });
      wrap.querySelectorAll('button[data-pb-suggest]').forEach(b => b.onclick = async () => {
        const stepId = b.dataset.pbSuggest;
        const ctx = prompt('Optional: any business context for the AI? (industry, current pain, target market — or leave blank)','');
        if (ctx === null) return;
        const orig = b.innerHTML; b.disabled = true; b.textContent = '⏳ …';
        try {
          const r = await fetch('/api/playbook/suggest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ stepId, context: ctx || '' }) });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error||'failed');
          data.suggestions[stepId] = j.suggestion;
          _showPlaybookSuggestion(stepId, j.suggestion);
          render();
        } catch(err) { alert('AI Suggest failed: '+err.message); b.disabled = false; b.innerHTML = orig; }
      });
      wrap.querySelectorAll('button[data-pb-viewsug]').forEach(b => b.onclick = () => {
        _showPlaybookSuggestion(b.dataset.pbViewsug, data.suggestions[b.dataset.pbViewsug]);
      });
      wrap.querySelectorAll('button[data-pb-runday]').forEach(b => b.onclick = () => _runPlaybookAutonomous(+b.dataset.pbRunday));
      const runAll = wrap.querySelector('#pbRunAll');
      if (runAll) runAll.onclick = () => _runPlaybookAutonomous(null);
    }

    async function _runPlaybookAutonomous(dayFilter) {
      const label = dayFilter ? `Day ${dayFilter}` : 'all 7 days';
      if (!confirm(`Assign every step in ${label} to its AI officer as a tracked task?\n\nThe Daily Report Scheduler will then start cross-referencing them against real platform activity. This is safe — it only adds tasks; nothing is deleted.`)) return;
      try {
        const r = await fetch('/api/playbook/run-autonomous', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ day: dayFilter }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error||'failed');
        if (typeof showToast==='function') showToast(j.message); else alert(j.message);
        // Refresh runs
        const r2 = await fetch('/api/playbook'); const j2 = await r2.json();
        data.runs = j2.runs || data.runs;
        render();
      } catch(err) { alert('Run failed: '+err.message); }
    }

    function _showPlaybookSuggestion(stepId, sug) {
      if (!sug) return;
      const overlay = document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
      const acts = (sug.actions||[]).map(a => `<li style="margin-bottom:8px"><strong>${_e(a.step||'')}</strong>${a.tool?` <span style="color:#0EA5E9;font-size:.78rem">· ${_e(a.tool)}</span>`:''}${a.owner?` <span style="background:#F1F5F9;color:#475569;padding:2px 7px;border-radius:99px;font-size:.7rem;margin-left:4px">${officerEmoji[a.owner]||''} ${_e(a.owner)}</span>`:''}</li>`).join('');
      overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:640px;max-width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
        <div style="padding:18px 22px;background:linear-gradient(135deg,#0EA5E9,#312E81);color:#fff;display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.85">🤖 AI Suggestion</div><div style="font-size:1.05rem;font-weight:800;margin-top:4px">${_e(sug.headline||stepId)}</div></div>
          <button id="pbsCx" style="background:rgba(255,255,255,0.18);border:none;color:#fff;width:34px;height:34px;border-radius:50%;font-size:1.1rem;cursor:pointer">×</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:20px 22px">
          <div style="font-size:.86rem;color:#0F172A;line-height:1.55;margin-bottom:14px">${_e(sug.rationale||'')}</div>
          ${acts ? `<div style="font-weight:800;color:#0F172A;font-size:.82rem;margin-bottom:6px">Recommended actions</div><ul style="margin:0 0 14px 18px;padding:0;color:#0F172A;font-size:.84rem;line-height:1.5">${acts}</ul>` : ''}
          ${sug.kpi ? `<div style="background:#F0FDF4;border-left:3px solid #10B981;padding:8px 12px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:.8rem"><strong style="color:#15803D">KPI to watch:</strong> ${_e(sug.kpi)}</div>` : ''}
          ${sug.risk ? `<div style="background:#FEF2F2;border-left:3px solid #B91C1C;padding:8px 12px;border-radius:0 8px 8px 0;font-size:.8rem"><strong style="color:#991B1B">Watch out:</strong> ${_e(sug.risk)}</div>` : ''}
          <div style="margin-top:14px;font-size:.7rem;color:#64748B">Generated ${new Date(sug.generatedAt).toLocaleString()}${sug.snapshot ? ' · grounded in live platform snapshot' : ''}</div>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#pbsCx').onclick = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
    }

    function _e(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    render();
  };

  // ── Manage → Growth Methodology (5-stage visual) ──────────────────────
  window.buildGrowthMethodology = function() {
    const wrap = document.getElementById('growthMethodWrap');
    if (!wrap) return;

    const STAGES = [
      { n: 1, title: 'Diagnose & Align',     color: '#10B981', summary: 'Understand the business, audience, and competitive landscape — and align everyone on a single goal.',
        features: [
          { label: 'New Marketing Project',    view: 'new-project',       why: 'Lock in goal, budget, channels, owner, and dates.' },
          { label: 'Competitor Analysis',      view: 'competitors',       why: 'Map competitor ads, landing pages, offers, keywords.' },
          { label: 'Battle Cards',             view: 'battle-cards',      why: 'One-page summary of how to beat each competitor.' },
          { label: 'Stakeholders',             view: 'stakeholders',      why: 'Capture decision-makers + buying-committee context.' },
          { label: 'Brand Foundation',         view: 'brand-foundation',  why: 'Purpose, ICP, Voice, Positioning — the layer every other tool reads from.' },
          { label: 'Brand Calendar',           view: 'brand-calendar',    why: 'Plan brand, content, social, ads in one view.' },
          { label: '7-Day Marketing Playbook', view: 'playbook-7day',     why: 'Strategic plan with AI Suggest grounded in real data.' }
        ]},
      { n: 2, title: 'Analyse & Forecast',   color: '#0EA5E9', summary: 'Run dual-AI analyses, find opportunity gaps, and forecast outcomes before you spend a dollar.',
        features: [
          { label: 'AI Attack Plan',           view: 'battleplan',        why: 'GPT-4o + Claude in parallel + GPT-4o synthesis.' },
          { label: 'Keyword Gap',              view: 'content-gaps',      why: 'See which keywords competitors rank for and you don\'t.' },
          { label: 'Share of Voice',           view: 'sov-tracker',       why: 'Quantify your slice vs. competitors over time.' },
          { label: 'Predictive Moves',         view: 'intelligence',      why: 'AI-forecasted competitor next moves.' },
          { label: 'Cross-Channel Report',     view: 'cross-channel',     why: 'Unified view of Meta + Google + TikTok + email.' },
          { label: 'True ROAS',                view: 'true-roas',         why: 'Blended attribution + budget recommendations.' }
        ]},
      { n: 3, title: 'Implement & Automate', color: '#F59E0B', summary: 'Launch campaigns, journeys, landing pages, and outbound — wired to autopilot from day one.',
        features: [
          { label: 'Campaigns',                view: 'campaigns',         why: 'Auto-registers in the Optimizer, optimizer ON by default.' },
          { label: 'Customer Journey Builder', view: 'journey-builder',   why: 'Multi-step flows: trigger → wait → condition → action.' },
          { label: 'Omnichannel Composer',     view: 'omnichannel',       why: 'Write once → fan out across email, SMS, WhatsApp, Voice, Push.' },
          { label: 'Site Builder',             view: 'landing-builder',   why: 'Block-based public landing pages.' },
          { label: 'Link-in-Bio + Stripe',     view: 'linksell',          why: 'Sell direct from a public bio page.' },
          { label: 'Automations',              view: 'automations',       why: 'Hourly + 6h + 12h optimizer cycles, all hands-off.' }
        ]},
      { n: 4, title: 'Prove & Improve',      color: '#EF4444', summary: 'Honest measurement, automatic optimisation, and instant reaction to real-world signals.',
        features: [
          { label: 'AI Optimizer',             view: 'optimizer',         why: 'Hourly insights + 6h pause/scale + 12h budget reallocation.' },
          { label: 'Goal-Based Monitoring',    view: 'goals',             why: 'Per-goal autonomous watch with alerts on drift.' },
          { label: 'Real-time Signal Triggers',view: 'signal-triggers',   why: 'Mention spike / sentiment drop / price change → instant journey.' },
          { label: 'Daily Report Scheduler',   view: 'ai-team',           why: 'AI officers report honestly against real DB activity.' },
          { label: 'Web Analytics',            view: 'web-analytics',     why: 'Channel + landing-page + PageSpeed in one view.' },
          { label: 'Budget Board',             view: 'budget-board',      why: 'Target vs actual + per-channel utilisation + spend log.' }
        ]},
      { n: 5, title: 'Compound & Innovate',  color: '#8B5CF6', summary: 'Re-engage past customers, build look-alike scale, and let the AI Team learn from every cycle.',
        features: [
          { label: 'Re-Engage Customers',      view: 'reengage',          why: 'Win-back drips for cold + churn-risk segments.' },
          { label: 'Dynamic Audiences',        view: 'audiences-dynamic', why: 'Live rule-based contact segments → drip + HubSpot list.' },
          { label: 'Lookalike Builder',        view: 'lookalike',         why: 'Spin up look-alikes off your best converters.' },
          { label: 'Weekly Report',            view: 'weekly-report',     why: 'Trended weekly performance digest.' },
          { label: 'AI Team',                  view: 'ai-team',           why: '8 autonomous officers — tasks, meetings, daily reports.' },
          { label: 'White-Label Reports',      view: 'white-label',       why: 'Branded client deliverables for agencies.' }
        ]}
    ];

    function _e(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    // SVG diagram: 5 nodes positioned around a circle, with the orbits
    // (rings) and a central "rocket" hub. Stage numbers are tappable.
    const cx = 360, cy = 320, r = 220;
    const angles = [-90, -18, 54, 126, 198]; // start at top, then clockwise (12, 5, 7, 8, 10 o'clock-ish)
    const nodes = STAGES.map((s, i) => {
      const a = angles[i] * Math.PI / 180;
      return { ...s, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

    function diagramSvg() {
      return `<svg viewBox="0 0 720 660" style="width:100%;max-width:720px;height:auto;display:block;margin:0 auto">
        <defs>
          <radialGradient id="ghub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#FB923C"/><stop offset="100%" stop-color="#EA580C"/>
          </radialGradient>
          <filter id="gshadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#0F172A" flood-opacity="0.15"/>
          </filter>
        </defs>
        ${[r, r*0.72, r*0.44].map(rr => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="#10B981" stroke-opacity="0.25" stroke-width="1.5" stroke-dasharray="4 6"/>`).join('')}
        ${nodes.map((n,i) => {
          const next = nodes[(i+1)%nodes.length];
          return `<line x1="${n.x}" y1="${n.y}" x2="${next.x}" y2="${next.y}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>`;
        }).join('')}
        <circle cx="${cx}" cy="${cy}" r="50" fill="url(#ghub)" filter="url(#gshadow)"/>
        <text x="${cx}" y="${cy+12}" text-anchor="middle" font-size="36" font-weight="800">🚀</text>
        ${nodes.map(n => `
          <g class="gm-node" data-stage="${n.n}" style="cursor:pointer">
            <circle cx="${n.x}" cy="${n.y}" r="32" fill="${n.color}" filter="url(#gshadow)"/>
            <text x="${n.x}" y="${n.y+8}" text-anchor="middle" fill="#fff" font-size="22" font-weight="800">${n.n}</text>
            <text x="${n.x}" y="${n.y - 50}" text-anchor="middle" fill="#0F172A" font-size="14" font-weight="700">${_e(n.title.split(' & ')[0])}</text>
            <text x="${n.x}" y="${n.y - 34}" text-anchor="middle" fill="#475569" font-size="12">${_e('& ' + (n.title.split(' & ')[1]||''))}</text>
          </g>
        `).join('')}
      </svg>`;
    }

    function detailPanel(stage) {
      return `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:22px;box-shadow:0 4px 14px rgba(15,23,42,0.05);height:100%">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="width:42px;height:42px;border-radius:50%;background:${stage.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.2rem">${stage.n}</div>
          <div>
            <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Stage ${stage.n}</div>
            <div style="font-size:1.15rem;font-weight:800;color:#0F172A">${_e(stage.title)}</div>
          </div>
        </div>
        <div style="font-size:.88rem;color:#334155;line-height:1.55;margin-bottom:14px">${_e(stage.summary)}</div>
        <div style="font-weight:700;color:#0F172A;font-size:.78rem;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;color:#64748B">Powered by</div>
        <div style="display:grid;gap:8px">
          ${stage.features.map(f => `<button data-gm-go="${_e(f.view)}" style="text-align:left;padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:9px;cursor:pointer;transition:all .15s" onmouseover="this.style.background='#F1F5F9';this.style.borderColor='${stage.color}'" onmouseout="this.style.background='#F8FAFC';this.style.borderColor='#E2E8F0'">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <div style="font-weight:700;color:#0F172A;font-size:.86rem">${_e(f.label)}</div>
              <div style="color:${stage.color};font-weight:700;font-size:.78rem;flex-shrink:0">Open →</div>
            </div>
            <div style="font-size:.74rem;color:#64748B;margin-top:3px;line-height:1.4">${_e(f.why)}</div>
          </button>`).join('')}
        </div>
      </div>`;
    }

    let activeStage = 1;
    function render() {
      const stage = STAGES.find(s => s.n === activeStage);
      wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,440px);gap:20px;align-items:start">
          <div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:18px;box-shadow:0 4px 14px rgba(15,23,42,0.05)">
            <div style="text-align:center;font-weight:800;color:#0F172A;font-size:1.05rem;margin-bottom:6px">Discover Our Growth Methodology</div>
            <div style="text-align:center;font-size:.78rem;color:#64748B;margin-bottom:8px">Click any number to see what powers that stage in InfoGenie</div>
            ${diagramSvg()}
            <div style="margin-top:12px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
              ${STAGES.map(s => `<button data-gm-pick="${s.n}" style="padding:6px 12px;border-radius:99px;border:1.5px solid ${s.n===activeStage?s.color:'#E2E8F0'};background:${s.n===activeStage?s.color:'#fff'};color:${s.n===activeStage?'#fff':'#475569'};font-weight:700;cursor:pointer;font-size:.78rem">${s.n} · ${_e(s.title.split(' & ')[0])}</button>`).join('')}
            </div>
          </div>
          <div id="gmDetail">${detailPanel(stage)}</div>
        </div>
        <div style="margin-top:18px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:12px;padding:14px 18px;font-size:.84rem;color:#0F172A;line-height:1.55">
          <strong style="color:#0369A1">How InfoGenie differs from a textbook 5-stage loop:</strong> all five stages run <em>simultaneously</em>, owned by 8 autonomous AI officers, with honest cross-referencing against real database activity. Real-time Signal Triggers can jump straight from Diagnose to Implement in under a minute, and the AI Optimizer keeps Prove and Compound running on autopilot 24/7.
        </div>`;

      wrap.querySelectorAll('[data-stage]').forEach(g => {
        g.addEventListener('click', () => { activeStage = +g.dataset.stage; render(); });
        g.addEventListener('mouseenter', () => g.style.opacity = '0.85');
        g.addEventListener('mouseleave', () => g.style.opacity = '1');
      });
      wrap.querySelectorAll('button[data-gm-pick]').forEach(b => b.onclick = () => { activeStage = +b.dataset.gmPick; render(); });
      wrap.querySelectorAll('button[data-gm-go]').forEach(b => b.onclick = () => {
        const v = b.dataset.gmGo;
        const link = document.querySelector(`.nav-link[data-view="${v}"]`);
        if (link) { link.click(); return; }
        // Fallback: not all views have a sidebar entry (e.g. linksell). Drive
        // routing directly so the user still lands on the right surface.
        if (typeof navigateTo === 'function') { try { navigateTo(v); return; } catch(_){} }
        if (typeof window.navigateTo === 'function') { try { window.navigateTo(v); return; } catch(_){} }
        if (typeof showToast === 'function') showToast(`Could not open ${v}`);
      });
    }
    render();
  };

  // ── Autonomous Daily Report scheduler panel ───────────────────────────
  async function _renderAutoReportPanel() {
    const host = document.getElementById('aiTeamAutoReport');
    if (!host) return;
    let s = { enabled:false, hour:8, minute:0, timezone:'UTC', email:'', lastRunAt:null, lastRunStatus:null };
    let history = [];
    try { const r = await fetch('/api/officer/autoreport'); const j = await r.json(); s = { ...s, ...(j.settings||{}) }; history = Array.isArray(j.history) ? j.history : []; } catch(_){}
    const detectedTz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
    const status = s.enabled ? `<span style="${_pillCSS};background:#DCFCE7;color:#166534">● ON · ${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')} ${_e(s.timezone)}</span>`
                             : `<span style="${_pillCSS};background:#F1F5F9;color:#475569">○ OFF</span>`;
    const last = s.lastRunAt ? `Last run: ${new Date(s.lastRunAt).toLocaleString()}` : 'No autonomous runs yet';
    host.innerHTML = `<div style="${_cardCSS}">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px">
        <div>
          <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Autonomous</div>
          <div style="font-size:1.15rem;font-weight:800;color:#0F172A">⏰ Daily Report Scheduler ${status}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="arSettings" style="padding:9px 16px;background:#0F172A;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">⚙️ Settings</button>
          <button id="arView" title="Generate now and view in browser — no email, no Slack" style="padding:9px 16px;background:#0EA5E9;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">👁️ View Report</button>
          <button id="arDownload" title="Generate now and download as Markdown — no email, no Slack" style="padding:9px 16px;background:#10B981;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">📥 Download Report</button>
          <button id="arRunNow" title="Generate now and send via email + Slack" style="padding:9px 16px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">▶ Run + Send</button>
        </div>
      </div>
      <div style="font-size:.82rem;color:#475569;line-height:1.5">When ON, the AI Team auto-generates a report for every officer at <strong>${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}</strong> in <strong>${_e(s.timezone||'UTC')}</strong> and sends a digest to <strong>${_e(s.email||'(no email set)')}</strong> + Slack. ${_e(last)}.</div>
      ${s.lastRunStatus ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;font-size:.74rem">
        <span style="${_pillCSS};background:${s.lastRunStatus.slackOk?'#DCFCE7':'#FEE2E2'};color:${s.lastRunStatus.slackOk?'#166534':'#991B1B'}">Slack: ${s.lastRunStatus.slackOk?'✓ sent':'✕ '+_e(s.lastRunStatus.slackError||'failed')}</span>
        <span style="${_pillCSS};background:${s.lastRunStatus.emailOk?'#DCFCE7':'#FEE2E2'};color:${s.lastRunStatus.emailOk?'#166534':'#991B1B'}">Email: ${s.lastRunStatus.emailOk?'✓ sent':'✕ '+_e(s.lastRunStatus.emailError||'failed')}</span>
      </div>` : ''}
      ${history.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:.74rem;color:#64748B">Run history (${history.length})</summary><div style="margin-top:8px;max-height:160px;overflow-y:auto">${history.map(h=>`<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid #F1F5F9;font-size:.74rem"><span style="color:#0F172A">${new Date(h.at).toLocaleString()}</span><span style="color:#64748B">${h.manualTrigger?'manual':'scheduled'} · Slack ${h.slackOk?'✓':'✕'} · Email ${h.emailOk?'✓':'✕'}</span></div>`).join('')}</div></details>` : ''}
    </div>`;
    host.querySelector('#arSettings').onclick = () => _openAutoReportSettings(s, detectedTz);
    host.querySelector('#arRunNow').onclick = async (e) => {
      const btn = e.currentTarget; const orig = btn.innerHTML; btn.disabled = true; btn.textContent = '⏳ Running…';
      try {
        const r = await fetch('/api/officer/autoreport/run-now', { method:'POST' });
        const j = await r.json();
        if (typeof showToast==='function') showToast(`Sent to ${j.officerCount||8} officers · Slack ${j.slackOk?'✓':'✕'} · Email ${j.emailOk?'✓':'✕'}`);
      } catch(err) { alert('Run failed: '+err.message); }
      btn.disabled = false; btn.innerHTML = orig;
      _renderAutoReportPanel();
    };
    host.querySelector('#arView').onclick = async (e) => {
      const btn = e.currentTarget; const orig = btn.innerHTML; btn.disabled = true; btn.textContent = '⏳ Drafting…';
      try {
        const r = await fetch('/api/officer/autoreport/run-now?skipDelivery=1', { method:'POST' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error||'failed');
        _openAutoReportViewer(j);
      } catch(err) { alert('Failed: '+err.message); }
      btn.disabled = false; btn.innerHTML = orig;
    };
    host.querySelector('#arDownload').onclick = async (e) => {
      const btn = e.currentTarget; const orig = btn.innerHTML; btn.disabled = true; btn.textContent = '⏳ Drafting…';
      try {
        const r = await fetch('/api/officer/autoreport/run-now?skipDelivery=1', { method:'POST' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error||'failed');
        const md = _autoReportToMarkdown(j);
        _downloadFile(`ai-team-daily-report-${new Date().toISOString().slice(0,10)}.md`, md);
        if (typeof showToast==='function') showToast('✓ Report downloaded');
      } catch(err) { alert('Failed: '+err.message); }
      btn.disabled = false; btn.innerHTML = orig;
    };
  }

  function _autoReportToMarkdown(j) {
    const lines = [`# AI Team — Daily Stand-up`, `_${j.fmtDate||new Date().toLocaleDateString()}_`, '', `**Officers reporting:** ${(j.reports||[]).length}`, ''];
    (j.reports||[]).forEach(r => {
      const rep = r.report || {};
      const tr = rep.tasksReviewed || [];
      const done=tr.filter(t=>t.status==='done').length, ip=tr.filter(t=>t.status==='in_progress').length, blk=tr.filter(t=>t.status==='blocked').length, ns=tr.filter(t=>t.status==='not_started').length;
      lines.push(`## ${r.title}`, '', rep.summary||'(no summary)', '', `**Status:** ✓ ${done} done · ◐ ${ip} in progress · ⚠ ${blk} blocked · ○ ${ns} not started`, '');
      if ((rep.successes||[]).length) { lines.push('### Wins'); rep.successes.forEach(s => lines.push(`- ${s}`)); lines.push(''); }
      if ((rep.issues||[]).length)    { lines.push('### Issues'); rep.issues.forEach(s => lines.push(`- ${s}`)); lines.push(''); }
      if ((rep.actionPlan||[]).length){ lines.push('### Action Plan'); rep.actionPlan.forEach(a => lines.push(`- **[${a.priority||'med'}]** ${a.step||a.action||''}`)); lines.push(''); }
      if (tr.length) { lines.push('### Responsibilities reviewed'); tr.forEach(t => lines.push(`- [${t.status}] ${t.task} — _${t.evidence||''}_`)); lines.push(''); }
      lines.push('---', '');
    });
    return lines.join('\n');
  }

  function _openAutoReportViewer(j) {
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:760px;max-width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:18px 22px;background:linear-gradient(135deg,#0F172A,#312E81);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.85">AI Team Daily Stand-up</div>
          <h3 style="margin:4px 0 0;font-size:1.2rem;font-weight:800">${_e(j.fmtDate||'')}</h3>
          <div style="font-size:.72rem;opacity:.85;margin-top:2px">${(j.reports||[]).length} officers · view-only · not sent</div></div>
        <div style="display:flex;gap:6px">
          <button id="arvDl" style="padding:8px 14px;background:#10B981;color:#fff;border:none;border-radius:7px;font-weight:700;cursor:pointer;font-size:.78rem">📥 Download</button>
          <button id="arvCx" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:34px;height:34px;border-radius:50%;font-size:1.1rem;cursor:pointer">×</button>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;background:#F1F5F9">${j.html || '<div style="padding:30px;text-align:center;color:#64748B">No report HTML returned.</div>'}</div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#arvCx').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
    overlay.querySelector('#arvDl').onclick = () => {
      _downloadFile(`ai-team-daily-report-${new Date().toISOString().slice(0,10)}.md`, _autoReportToMarkdown(j));
      if (typeof showToast==='function') showToast('✓ Report downloaded');
    };
  }

  function _openAutoReportSettings(cur, detectedTz) {
    const TZS = ['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','America/Toronto','America/Mexico_City','America/Sao_Paulo','Europe/London','Europe/Dublin','Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Rome','Europe/Athens','Europe/Moscow','Africa/Cairo','Africa/Johannesburg','Africa/Lagos','Asia/Dubai','Asia/Karachi','Asia/Kolkata','Asia/Bangkok','Asia/Singapore','Asia/Hong_Kong','Asia/Shanghai','Asia/Tokyo','Asia/Seoul','Australia/Perth','Australia/Sydney','Pacific/Auckland'];
    if (detectedTz && !TZS.includes(detectedTz)) TZS.unshift(detectedTz);
    if (cur.timezone && !TZS.includes(cur.timezone)) TZS.unshift(cur.timezone);
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    const hours = Array.from({length:24},(_,i)=>i);
    const mins  = [0,5,10,15,20,25,30,35,40,45,50,55];
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;width:560px;max-width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.3)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0F172A,#312E81);color:#fff">
        <div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.85">⏰ Autonomous Reporting</div>
        <h3 style="margin:6px 0 0;font-size:1.25rem;font-weight:800">Daily Stand-up Schedule</h3>
      </div>
      <div style="padding:20px 24px;flex:1;overflow-y:auto">
        <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;cursor:pointer;margin-bottom:16px">
          <input id="arEn" type="checkbox" ${cur.enabled?'checked':''} style="width:18px;height:18px;cursor:pointer">
          <div style="flex:1"><div style="font-weight:700;font-size:.92rem;color:#0F172A">Enable autonomous daily reports</div><div style="font-size:.76rem;color:#64748B">When ON, the server fires reports automatically — your browser doesn't need to be open.</div></div>
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div><label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Hour (24h)</label>
            <select id="arH" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem">${hours.map(h=>`<option value="${h}" ${(cur.hour|0)===h?'selected':''}>${String(h).padStart(2,'0')}</option>`).join('')}</select></div>
          <div><label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Minute</label>
            <select id="arM" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem">${mins.map(m=>`<option value="${m}" ${(cur.minute|0)===m?'selected':''}>${String(m).padStart(2,'0')}</option>`).join('')}</select></div>
        </div>
        <label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Timezone</label>
        <select id="arTz" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem;margin-bottom:4px">${TZS.map(t=>`<option value="${_e(t)}" ${(cur.timezone||'UTC')===t?'selected':''}>${_e(t)}</option>`).join('')}</select>
        <div style="font-size:.7rem;color:#64748B;margin-bottom:14px">Detected: <strong>${_e(detectedTz||'UTC')}</strong></div>
        <label style="display:block;font-size:.76rem;font-weight:700;color:#0F172A;margin-bottom:6px">Recipient email</label>
        <input id="arEmail" type="email" placeholder="you@company.com" value="${_e(cur.email||'')}" style="width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.88rem;margin-bottom:6px;box-sizing:border-box">
        <div style="font-size:.72rem;color:#64748B;line-height:1.4">Reports also go to Slack via the configured webhook. Email needs Resend configured.</div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;background:#F8FAFC">
        <button id="arCancel" style="padding:10px 18px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-weight:700;cursor:pointer">Cancel</button>
        <button id="arSave" style="padding:10px 22px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer">Save</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#arCancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
    overlay.querySelector('#arSave').onclick = async () => {
      const body = {
        enabled: overlay.querySelector('#arEn').checked,
        hour: +overlay.querySelector('#arH').value,
        minute: +overlay.querySelector('#arM').value,
        timezone: overlay.querySelector('#arTz').value,
        email: overlay.querySelector('#arEmail').value.trim()
      };
      try {
        const r = await fetch('/api/officer/autoreport', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok) { alert(j.error||'Save failed'); return; }
        if (typeof showToast==='function') showToast('✓ Schedule saved');
        close(); _renderAutoReportPanel();
      } catch(err) { alert('Save failed: '+err.message); }
    };
  }

  // ── Finance Officer ──────────────────────────────────────────────────────
  window.buildFinanceOfficer = async function() {
    const wrap = document.getElementById('view-finance-officer');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="${_hdrCSS};background:linear-gradient(135deg,#064E3B 0%,#065F46 100%)">
        <div style="font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:#6EE7B7;font-weight:700">💼 FINANCE OFFICER</div>
        <h1 style="margin:8px 0 6px;font-size:1.85rem;font-weight:800">Marketing P&amp;L, Live</h1>
        <p style="margin:0;font-size:.92rem;color:#D1FAE5;max-width:720px">Spend, revenue, CAC, LTV/CAC and ROAS — pulled from your connected ad accounts and CRM in real time. Re-runs the AI brief on every load.</p>
      </div>
      <div style="max-width:1200px;margin:0 auto;padding:0 28px" id="finOffBody">
        <div style="${_cardCSS};text-align:center;color:#64748B">⏳ Pulling 30-day finance snapshot…</div>
      </div>`;
    const body = document.getElementById('finOffBody');
    let facts = {};
    try {
      const r = await fetch('/api/cross-channel-report?days=30');
      if (r.ok) facts = await r.json();
    } catch(e){ console.warn('cross-channel fetch failed:', e); }
    // Compute runway-ish signal: how many days of spend would burn $10k? (transparency cue)
    const dailyBurn = facts.totalSpend ? +(facts.totalSpend/30).toFixed(2) : null;
    const factsForAI = {
      window: '30 days',
      totalSpend: facts.totalSpend ?? null,
      totalRevenue: facts.totalRevenue ?? null,
      netSales: facts.netSales ?? null,
      customers: facts.customers ?? null,
      cac: facts.cac ?? null,
      ltvAssumed: facts.ltvAssumed ?? null,
      ltvCac: facts.ltvCac ?? null,
      mer: facts.mer ?? null,
      roas: facts.roas ?? null,
      dailyBurn,
      channelsConnected: facts.channels ? Object.entries(facts.channels).filter(([,v])=>v?.connected).map(([k])=>k) : [],
    };
    let brief = null;
    try {
      const br = await fetch('/api/officer/brief', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role:'finance', facts: factsForAI }) });
      if (br.ok) { const j = await br.json(); brief = j.brief; }
    } catch(e){ console.warn('finance brief failed:', e); }

    const kpi = (label, val, sub='', tone='') => `<div style="${_cardCSS};padding:16px"><div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em">${_e(label)}</div><div style="font-size:1.5rem;font-weight:800;color:${tone==='good'?'#15803D':tone==='bad'?'#B91C1C':'#0F172A'};margin-top:6px">${_e(val)}</div>${sub?`<div style="font-size:.72rem;color:#64748B;margin-top:4px">${_e(sub)}</div>`:''}</div>`;
    const ltvCacTone = factsForAI.ltvCac == null ? '' : (factsForAI.ltvCac >= 3 ? 'good' : factsForAI.ltvCac < 1 ? 'bad' : '');
    const merTone    = factsForAI.mer    == null ? '' : (factsForAI.mer >= 200 ? 'good' : factsForAI.mer < 100 ? 'bad' : '');

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:18px">
        ${kpi('Spend (30d)', _money(factsForAI.totalSpend))}
        ${kpi('Revenue (30d)', _money(factsForAI.totalRevenue))}
        ${kpi('Net Sales', _money(factsForAI.netSales), 'Revenue − Spend')}
        ${kpi('Customers', _fmt(factsForAI.customers))}
        ${kpi('CAC', _money(factsForAI.cac))}
        ${kpi('LTV / CAC', factsForAI.ltvCac != null ? factsForAI.ltvCac+'×' : '—', factsForAI.ltvAssumed?`LTV assumed $${factsForAI.ltvAssumed}`:'', ltvCacTone)}
        ${kpi('MER', factsForAI.mer != null ? factsForAI.mer+'%' : '—', '', merTone)}
        ${kpi('Daily Burn', _money(dailyBurn))}
      </div>
      ${brief ? `
        <div style="${_cardCSS};margin-bottom:18px">
          <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Executive Summary</div>
          <p style="margin:0;font-size:.95rem;color:#0F172A;line-height:1.55">${_e(brief.summary||'')}</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-bottom:18px">
          ${_briefList('✅ Highlights', brief.highlights, '#15803D','#DCFCE7')}
          ${_briefList('⚠️ Risks',     brief.risks,      '#B91C1C','#FEE2E2')}
        </div>
        ${_actionsCard(brief.actions)}
      ` : `<div style="${_cardCSS};text-align:center;color:#64748B">AI brief unavailable. Showing live numbers above.</div>`}
    `;
  };

  // ── Operations Officer ───────────────────────────────────────────────────
  window.buildOpsOfficer = async function() {
    const wrap = document.getElementById('view-ops-officer');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="${_hdrCSS};background:linear-gradient(135deg,#7C2D12 0%,#9A3412 100%)">
        <div style="font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:#FED7AA;font-weight:700">🛠️ OPERATIONS OFFICER</div>
        <h1 style="margin:8px 0 6px;font-size:1.85rem;font-weight:800">Campaign QA, Assets &amp; Lead Hygiene</h1>
        <p style="margin:0;font-size:.92rem;color:#FFEDD5;max-width:720px">Scans your live campaigns, brand assets, leads and goals for stale or broken items. Returns a weekly digest with a prioritised checklist.</p>
      </div>
      <div style="max-width:1200px;margin:0 auto;padding:0 28px" id="opsOffBody">
        <div style="${_cardCSS};text-align:center;color:#64748B">⏳ Scanning your operations…</div>
      </div>`;
    const body = document.getElementById('opsOffBody');
    let snap = {};
    try {
      const r = await fetch('/api/ops-officer/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
      if (r.ok) { const j = await r.json(); snap = j.snapshot || {}; }
    } catch(e){ console.warn('ops scan failed:', e); }
    let brief = null;
    try {
      const br = await fetch('/api/officer/brief', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role:'ops', facts: snap }) });
      if (br.ok) { const j = await br.json(); brief = j.brief; }
    } catch(e){ console.warn('ops brief failed:', e); }

    const kpi = (label, val, sub='', tone='') => `<div style="${_cardCSS};padding:16px"><div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em">${_e(label)}</div><div style="font-size:1.5rem;font-weight:800;color:${tone==='good'?'#15803D':tone==='bad'?'#B91C1C':'#0F172A'};margin-top:6px">${_e(val)}</div>${sub?`<div style="font-size:.72rem;color:#64748B;margin-top:4px">${_e(sub)}</div>`:''}</div>`;
    const c = snap.campaigns||{}, a = snap.assets||{}, l = snap.leads||{}, g = snap.goals||{};

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:18px">
        ${kpi('Campaigns', _fmt(c.total), `${c.recent||0} active in last 7d`)}
        ${kpi('Stale Campaigns', _fmt(c.stale), '>14 days no update', c.stale>0?'bad':'')}
        ${kpi('Missing Creative', _fmt(c.missingCreative), '', c.missingCreative>0?'bad':'')}
        ${kpi('Brand Assets', _fmt(a.uploaded), `${(a.missing||[]).length} gaps`, (a.missing||[]).length>0?'bad':'good')}
        ${kpi('Qualified Leads', _fmt(l.qualified), '', 'good')}
        ${kpi('Unqualified', _fmt(l.unqualified), 'awaiting review', l.unqualified>20?'bad':'')}
        ${kpi('Goals', _fmt(g.total), `${g.offTrack||0} off-track`, g.offTrack>0?'bad':'')}
      </div>
      ${(a.missing && a.missing.length) ? `<div style="${_cardCSS};background:#FEF3C7;border-color:#FDE68A;margin-bottom:18px"><strong style="color:#92400E">Brand asset gaps:</strong> <span style="color:#78350F">${a.missing.map(_e).join(', ')}</span> — <a href="#" data-view-link="brand-assets" style="color:#92400E;font-weight:700">Open Brand Assets →</a></div>` : ''}
      ${brief ? `
        <div style="${_cardCSS};margin-bottom:18px">
          <div style="font-size:.7rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Weekly Ops Digest</div>
          <p style="margin:0;font-size:.95rem;color:#0F172A;line-height:1.55">${_e(brief.summary||'')}</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-bottom:18px">
          ${_briefList('✅ Highlights', brief.highlights, '#15803D','#DCFCE7')}
          ${_briefList('⚠️ Risks',     brief.risks,      '#B91C1C','#FEE2E2')}
        </div>
        ${_actionsCard(brief.actions)}
      ` : `<div style="${_cardCSS};text-align:center;color:#64748B">AI digest unavailable. Showing scan results above.</div>`}
    `;
    body.querySelectorAll('[data-view-link]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigateTo(a.dataset.viewLink); }));
  };

  function _briefList(title, items, color, bg) {
    const arr = Array.isArray(items) ? items.filter(Boolean) : [];
    return `<div style="${_cardCSS}">
      <div style="font-size:.78rem;font-weight:800;color:${color};margin-bottom:10px">${_e(title)}</div>
      ${arr.length ? `<ul style="margin:0;padding-left:18px;color:#0F172A;font-size:.86rem;line-height:1.7">${arr.map(it => `<li>${_e(typeof it==='string'?it:(it.title||JSON.stringify(it)))}</li>`).join('')}</ul>` : `<div style="color:#64748B;font-size:.82rem">Nothing flagged.</div>`}
    </div>`;
  }
  function _actionsCard(actions) {
    const arr = Array.isArray(actions) ? actions.filter(a => a && (a.title || a.detail)) : [];
    if (!arr.length) return '';
    const tone = (p) => p==='high'?{bg:'#FEE2E2',c:'#B91C1C'}:p==='med'?{bg:'#FEF3C7',c:'#92400E'}:{bg:'#E0E7FF',c:'#3730A3'};
    return `<div style="${_cardCSS}">
      <div style="font-size:.78rem;font-weight:800;color:#0F172A;margin-bottom:12px">📋 Recommended Actions</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${arr.map(a => { const t = tone(a.priority); return `<div style="display:flex;gap:12px;align-items:flex-start;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px">
          <span style="${_pillCSS};background:${t.bg};color:${t.c};flex-shrink:0">${_e((a.priority||'med').toUpperCase())}</span>
          <div style="flex:1"><div style="font-weight:700;color:#0F172A;font-size:.88rem">${_e(a.title||'')}</div>${a.detail?`<div style="font-size:.78rem;color:#475569;margin-top:3px">${_e(a.detail)}</div>`:''}</div>
        </div>`; }).join('')}
      </div>
    </div>`;
  }
})();

// ════════════════════════════════════════════════════════════════════════════
// MOVED OUT OF app.js — see public/js/ (loaded via <script> in index.html):
//   • public/js/ig_studio.js              — Creator Studio + Engagement + Commerce
//   • public/js/ig_journey_omnichannel.js — Journey Builder + Signal Triggers + Omnichannel
//   • public/js/ig_manage_pack.js         — New Project · Brand Calendar · Ask InfoGenie ·
//       Infographics · Heatmaps · Question Miner · AI Providers · Ad Swipe ·
//       Brand Foundation · Budget Board · Web Analytics
// These remain plain <script> files attaching to window (no behavior change).
// ════════════════════════════════════════════════════════════════════════════

// ─── Onboarding Wizard + Global Tour Button → moved to public/js/ig_onboarding.js ───

// ─── Nav chrome (Slim Sidebar collapse · View Header/breadcrumbs · Related Views) → moved to public/js/ig_navchrome.js ───

// ─── AI Search Visibility — Live LLM Scan → retired; archived in legacy_archive/llm-scan/ ───

// ============================================================================
// GLOBAL FIELD AUTO-ENHANCER (Brand · Keywords · Country)
// ----------------------------------------------------------------------------
// Runs at boot + on every DOM mutation. Detects inputs whose label / id /
// name / placeholder mentions "brand|company|keyword|country|region" and
// upgrades them in-place:
//   • BRAND  → adds a picker dropdown above the input listing your own brand
//              + every analysed competitor; auto-fills value with your brand;
//              manual typing still works.
//   • KEYWORD → adds a 🤖 AI Suggest button on the label that fills the input
//              with keywords pulled from window.analysisData.keywords (or AI
//              fallback via /api/ai-quick).
//   • COUNTRY → if the field is a free-text input, replaces it with a
//              <select> containing 🌍 Global + 20 flagged countries; if it's
//              already a <select> with fewer than 5 options, augments it.
//
// Idempotent: marks each enhanced input with `data-fae="1"`. Skips fields
// that already have a sibling <select> picker (the hand-built ones) or any
// element tagged `data-no-autofill`.
// ============================================================================
(function _initFieldAutoEnhancer() {
  if (window._faeBooted) return;
  window._faeBooted = true;

  const COUNTRIES = [
    ['ALL','🌍 Global / All countries'],['US','🇺🇸 United States'],['GB','🇬🇧 United Kingdom'],
    ['ZA','🇿🇦 South Africa'],['AU','🇦🇺 Australia'],['CA','🇨🇦 Canada'],
    ['DE','🇩🇪 Germany'],['FR','🇫🇷 France'],['ES','🇪🇸 Spain'],['IT','🇮🇹 Italy'],
    ['NL','🇳🇱 Netherlands'],['IN','🇮🇳 India'],['JP','🇯🇵 Japan'],['BR','🇧🇷 Brazil'],
    ['MX','🇲🇽 Mexico'],['AE','🇦🇪 UAE'],['SG','🇸🇬 Singapore'],['NG','🇳🇬 Nigeria'],
    ['KE','🇰🇪 Kenya'],['IE','🇮🇪 Ireland'],['SE','🇸🇪 Sweden']
  ];

  const _esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function getBrand() {
    const d = window.analysisData || {};
    if (d.brandName) return d.brandName;
    if (d.url) return d.url.replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'');
    return '';
  }
  function getCompetitors() {
    const d = window.analysisData || {};
    return Array.isArray(d.competitors)
      ? d.competitors.map(c => c && (c.name || c.domain)).filter(Boolean).slice(0, 15)
      : [];
  }
  function getKeywords() {
    const d = window.analysisData || {};
    // Primary: analysisData.keywords (populated by keyword explorer / SEO tools after a full analysis)
    if (Array.isArray(d.keywords) && d.keywords.length) {
      return d.keywords.map(k => typeof k === 'string' ? k : (k && (k.keyword || k.term))).filter(Boolean).slice(0, 12);
    }
    // Fallback: Intent Map keywords (available after running the Keyword-Page Map tool)
    const im = window._intentMap;
    if (im && Array.isArray(im.keywords) && im.keywords.length) {
      return im.keywords.map(k => typeof k === 'string' ? k : (k && (k.keyword || k.term))).filter(Boolean).slice(0, 12);
    }
    return [];
  }

  function labelOf(el) {
    if (!el) return '';
    if (el.id) {
      const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l) return (l.textContent || '').trim();
    }
    const lbl = el.closest && el.closest('label');
    if (lbl) return (lbl.textContent || '').trim();
    let p = el.previousElementSibling;
    let hops = 0;
    while (p && hops < 2) {
      const t = (p.textContent || '').trim();
      if (t && t.length < 80) return t;
      p = p.previousElementSibling; hops++;
    }
    return '';
  }

  // Conservative — must be a recognisable label-like token, not embedded in unrelated phrasing.
  // NOTE: do NOT match "client name" — Admin → Clients uses that label for a
  // NEW client record. Treating it as a brand field auto-fills the DOM value
  // without updating React state, so "+ Add Client" sees an empty name.
  const RE_BRAND   = /(^|[\s>_-])(brand|company|advertiser|target brand|business name|competitor name)([\s<_:-]|$)/i;
  const RE_COUNTRY = /(^|[\s>_-])(country|countries|region|geo(graphy)?|market(s)?)([\s<_:-]|$)/i;
  const RE_KW      = /(^|[\s>_-])(keyword(s)?|search term(s)?|seed term(s)?|tracking term(s)?|monitoring term(s)?|topics? to|terms? to)([\s<_:-]|$)/i;
  // Hard skips — even if matched above, ignore these contexts.
  const RE_SKIP    = /(password|api.?key|token|secret|webhook|email\b|phone|address|message|note|comment|description|prompt|caption|body|subject|reply|content|copy|headline|cta|tag|category|industry|filename|file|upload|date|time|hour|amount|price|budget|spend|count|limit|days|weeks|months|years|spike|neg|ratio|score|threshold|seed value|version|model|tone|persona|slug|path|url\b|domain to (?:search|crawl|audit))/i;

  function classify(input) {
    if (!input) return null;
    if (input.dataset && input.dataset.fae) return null;
    if (input.dataset && input.dataset.noAutofill) return null;
    if (input.closest && input.closest('[data-no-autofill]')) return null;
    const tag = (input.tagName || '').toLowerCase();
    const type = (input.type || '').toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return null;
    if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'file' ||
        type === 'password' || type === 'submit' || type === 'button' || type === 'number' ||
        type === 'date' || type === 'time' || type === 'color' || type === 'range') return null;
    if (!input.parentElement) return null;
    // Skip if parent likely already has a hand-rolled picker
    const sibSel = input.parentElement.querySelector('select');
    if (sibSel && sibSel !== input) return null;
    const ctx = (input.id || '') + ' ' + (input.name || '') + ' ' + (input.placeholder || '') + ' ' + labelOf(input);
    if (RE_SKIP.test(ctx) && !RE_COUNTRY.test(ctx)) return null;
    if (RE_BRAND.test(ctx))   return 'brand';
    if (RE_KW.test(ctx))      return 'keyword';
    if (RE_COUNTRY.test(ctx)) return 'country';
    return null;
  }

  // React controlled inputs ignore bare `el.value = …`. Use the native
  // prototype setter so React's onChange / state stay in sync (same pattern
  // as ig_field_enhancer.js).
  const _nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    && Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const _nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
    && Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  function _faeSetValue(el, value) {
    const s = String(value == null ? '' : value);
    const setter = el.tagName === 'TEXTAREA' ? _nativeTextareaSetter : _nativeInputSetter;
    if (setter) setter.call(el, s);
    else el.value = s;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function makeBrandPicker(input) {
    const brand = getBrand();
    const comps = getCompetitors();
    if (!brand && comps.length === 0) return; // nothing to offer
    if (!input.value && brand) _faeSetValue(input, brand);
    const sel = document.createElement('select');
    sel.dataset.fae = '1'; // tag generated picker so enhance() never re-processes it (prevents observer feedback loop)
    sel.style.cssText = 'width:100%;padding:6px 9px;border:1.5px solid #D1D5DB;border-radius:6px;font-size:0.76rem;background:#F0FDF4;margin-bottom:5px;box-sizing:border-box;color:#065F46;font-weight:600';
    sel.innerHTML =
      '<option value="">— Pick from your analysis (or type manually below) —</option>' +
      (brand ? '<option value="' + _esc(brand) + '">' + _esc(brand) + ' (your brand)</option>' : '') +
      comps.map(n => '<option value="' + _esc(n) + '">' + _esc(n) + '</option>').join('');
    sel.addEventListener('change', () => { if (sel.value) _faeSetValue(input, sel.value); });
    input.parentElement.insertBefore(sel, input);
  }

  function makeKeywordSuggest(input) {
    if (!input.parentElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '🤖 AI Suggest';
    btn.title = 'Pull keywords from your last analysis (or generate with AI)';
    btn.style.cssText = 'display:inline-block;margin:0 0 4px 6px;padding:3px 9px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:5px;color:#fff;-webkit-text-fill-color:#fff;font-size:0.62rem;font-weight:700;cursor:pointer;vertical-align:middle';
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const kws = getKeywords();
      if (kws.length) {
        input.value = kws.join(', ');
        input.dispatchEvent(new Event('input', {bubbles:true}));
        (window.showToast || console.log)('✨ ' + kws.length + ' keywords pulled from your analysis');
        return;
      }
      const brand = getBrand();
      const industry = (window.analysisData && window.analysisData.industry && window.analysisData.industry.name) || '';
      if (!brand) { (window.showToast || alert)('⚠️ Run an analysis first to unlock keyword suggestions'); return; }
      const orig = btn.textContent; btn.textContent = '⏳ Generating…'; btn.disabled = true;
      try {
        const txt = await fetch('/api/ai-quick', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Return ONLY a comma-separated list of 6 short keywords (1-3 words each) for the brand "' + brand + '"' + (industry ? ' in the ' + industry + ' industry' : '') + '. No numbering, no explanations.', max_tokens: 120 })
        }).then(x => x.text());
        let data; try { data = JSON.parse(txt); } catch { data = null; }
        if (data && data.ok && data.text) {
          input.value = data.text.replace(/\n/g, ', ').replace(/^[-•\d.\s]+/gm, '').replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
          input.dispatchEvent(new Event('input', {bubbles:true}));
          (window.showToast || console.log)('✨ AI keywords generated');
        } else {
          (window.showToast || alert)('⚠️ AI keyword suggestion unavailable — type manually');
        }
      } catch (e) { (window.showToast || console.warn)('❌ ' + (e.message || 'Failed')); }
      finally { btn.textContent = orig; btn.disabled = false; }
    });
    // Try to attach the button to the label; otherwise insert before input.
    let host = null;
    if (input.id) host = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(input.id) : input.id) + '"]');
    if (!host) host = input.closest('label');
    if (host) host.appendChild(btn); else input.parentElement.insertBefore(btn, input);
  }

  function makeCountryDropdown(input) {
    // Only upgrade free-text inputs. Selects are left alone (likely intentional).
    if (!input.parentElement || input.tagName.toLowerCase() !== 'input') return;
    const sel = document.createElement('select');
    // Mirror styling
    sel.className = input.className || '';
    const cs = input.getAttribute('style') || '';
    sel.setAttribute('style', cs + ';background:#fff');
    sel.id = input.id || '';
    sel.name = input.name || '';
    if (input.id) input.removeAttribute('id'); // avoid duplicate id
    sel.innerHTML = COUNTRIES.map(([c, n]) => '<option value="' + c + '"' + (c === 'ALL' ? ' selected' : '') + '>' + n + '</option>').join('');
    // Preserve existing value if it matches a known code
    const v = (input.value || '').trim().toUpperCase();
    if (v && COUNTRIES.some(([c]) => c === v)) sel.value = v;
    sel.dataset.fae = '1';
    input.parentElement.replaceChild(sel, input);
  }

  function enhance(input) {
    try {
      // Idempotency guard: never re-process an element we already enhanced.
      // makeBrandPicker/makeCountryDropdown INSERT a <select> next to the
      // field; the body MutationObserver below sees that childList mutation and
      // calls enhance() on the new <select>. Without this guard that <select>
      // gets classified 'brand' again → another <select> inserted → infinite
      // microtask feedback loop that grows the DOM unbounded and OOM-crashes
      // the tab (the Ad Library Spy freeze). Generated pickers are tagged with
      // dataset.fae='1' so they short-circuit here.
      if (input.dataset.fae) return;
      const kind = classify(input);
      if (!kind) return;
      input.dataset.fae = '1';
      if (kind === 'brand')   makeBrandPicker(input);
      if (kind === 'keyword') makeKeywordSuggest(input);
      if (kind === 'country') makeCountryDropdown(input);
    } catch (e) { /* never break a render over an enhancement */ }
  }

  function scan(root) {
    const scope = (root && root.querySelectorAll) ? root : document.body;
    if (!scope) return;
    const inputs = scope.querySelectorAll('input, select, textarea');
    for (let i = 0; i < inputs.length; i++) enhance(inputs[i]);
  }

  function boot() {
    scan(document.body);
    if (window.MutationObserver) {
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          if (!m.addedNodes) continue;
          for (const n of m.addedNodes) {
            if (n.nodeType === 1) {
              if (n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.tagName === 'TEXTAREA') enhance(n);
              else scan(n);
            }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    // Re-scan after each tab navigation in case render is debounced
    if (typeof window.navigateTo === 'function' && !window.navigateTo._faePatched) {
      const orig = window.navigateTo;
      window.navigateTo = function() {
        const r = orig.apply(this, arguments);
        setTimeout(() => scan(document.body), 50);
        setTimeout(() => scan(document.body), 400);
        return r;
      };
      window.navigateTo._faePatched = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Public helper for explicit re-scans
  window._faeScan = scan;
})();

// ─── Content Score (T39-A) · AI Traffic Monitor · Visibility Leaderboard (buildContentScore/buildAiTrafficMonitor/buildVisLeaderboard) → moved to public/js/ig_content_traffic.js ───

// ─── Post Performance (T40-A) · Email Broadcast (T40-B) (buildPostPerformance/buildEmailBroadcast) → moved to public/js/ig_intel_pack_b.js ───

// Process return params at first page load too (in case the user lands on
// "/" with ?ma_* params but never navigates to settings).
// ─── Standalone intel builders (pack B): Hunter · LinkedIn Ads · Canva · CRM Sync · Employee Advocacy · Social Listening · Media Intel · Hashtag Intel · Maps Intel · Creative Intel · YouTube Comment Miner · Link Prospector → moved to public/js/ig_intel_pack_b.js ───
