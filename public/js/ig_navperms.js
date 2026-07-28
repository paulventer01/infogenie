// ════════════════════════════════════════════════════════════════════════════
// ig_navperms.js — Permission-driven navigation menu (Task 147)
//   Builds & guards the nav from the signed-in user's REAL role permissions:
//     • hides every nav item the user's role doesn't grant (+ empty groups)
//     • shows the Admin Portal link only for platform owners/admins, decided
//       synchronously from the loaded permission set (no 1.5s race, no flash)
//     • blocks client-side navigation to a disallowed view and redirects to the
//       first view the user IS permitted to see
//   The SERVER remains the real security boundary (enforceMatrix). This is the
//   correct, non-bypassable UX layer on top of it — it consumes the SAME
//   component→permission matrix the backend exports (COMPONENT_MATRIX), shipped
//   to the client via GET /api/tenants/active. It never invents a second mapping.
//
//   Plain <script> attaching window.IGNavPerms; also exports a pure, DOM-free
//   core via module.exports so the verification test can drive it under Node.
//   Loaded AFTER app.js and ig_navchrome.js (the slim-sidebar restructure).
// ════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Pure, DOM-free core ────────────────────────────────────────────────────
  // Everything the verification needs (can / firstPermittedView / guard /
  // visibleViews) lives here so it can be unit-tested without a browser.
  function createNavPerms() {
    let _perms = new Set();
    let _matrix = {};
    let _isAdmin = false;
    let _ready = false;

    function configure(opts) {
      opts = opts || {};
      _perms = new Set(Array.isArray(opts.permissions) ? opts.permissions
                       : (opts.permissions instanceof Set ? Array.from(opts.permissions) : []));
      _matrix = opts.componentMatrix || {};
      _isAdmin = !!opts.isPlatformAdmin;
      _ready = true;
      return api;
    }

    // The permission key a given view (data-view) requires, or null if the view
    // is not in the matrix (unmapped surfaces are allowed but logged server-side).
    function requiredFor(view) {
      return Object.prototype.hasOwnProperty.call(_matrix, view) ? _matrix[view] : null;
    }

    // May the current principal see/use this view?
    //   • platform owner/admin sees everything (mirrors the server bypass)
    //   • unmapped views are allowed (server logs them as matrix gaps)
    //   • otherwise the role must hold the mapped permission key
    function can(view) {
      if (_isAdmin) return true;
      const need = requiredFor(view);
      if (!need) return true;
      return _perms.has(need);
    }

    // First view (in menu order) the user is permitted to see. `views` is an
    // ordered list of data-view ids. Returns null if none are permitted.
    function firstPermittedView(views) {
      if (!Array.isArray(views)) return null;
      for (const v of views) {
        if (v && can(v)) return v;
      }
      return null;
    }

    // Filter an ordered list of data-view ids down to the permitted ones.
    function visibleViews(views) {
      return (Array.isArray(views) ? views : []).filter(v => v && can(v));
    }

    // Decide whether a navigation to `view` is allowed, and if not, where to send
    // the user instead (the first permitted view from `views`). `views` is the
    // ordered fallback list (defaults to []). Returns {allowed, redirect}.
    function guard(view, views) {
      if (can(view)) return { allowed: true, redirect: null };
      return { allowed: false, redirect: firstPermittedView(views || []) };
    }

    const api = {
      configure,
      requiredFor,
      can,
      firstPermittedView,
      visibleViews,
      guard,
      get ready() { return _ready; },
      get isPlatformAdmin() { return _isAdmin; },
      get permissions() { return new Set(_perms); },
    };
    return api;
  }

  // ── Node export (verification test) ────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createNavPerms };
  }

  // ── Browser wiring ─────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const NP = createNavPerms();
  window.IGNavPerms = NP;

  // Ordered list of every data-view nav target, in the DOM order they appear in
  // the menu (drives firstPermittedView / default-landing). Recomputed on demand
  // so it reflects whatever ig_navchrome.js has restructured.
  function orderedNavViews() {
    const out = [];
    // Support legacy top-nav (.nav-link) and React left-rail (a[data-view]).
    document.querySelectorAll('#navGroups .nav-link[data-view], #navGroups a[data-view], #ig-side-rail a[data-view]').forEach(a => {
      const v = a.getAttribute('data-view');
      if (v && out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }
  NP.orderedNavViews = orderedNavViews;

  // Hide one element (keep a marker so we never fight other code that toggles it).
  function _hide(el) { if (el) { el.style.display = 'none'; el.setAttribute('data-perm-hidden', '1'); } }

  // Apply the permission filter to the rendered menu. Idempotent — safe to call
  // repeatedly (e.g. after ig_navchrome re-slims, or on late-rendered nav).
  function applyToMenu() {
    if (!NP.ready) return;

    // 1) Hide each nav link the user's role doesn't permit.
    document.querySelectorAll('#navGroups .nav-link[data-view], #navGroups a[data-view], #ig-side-rail a[data-view]').forEach(a => {
      const v = a.getAttribute('data-view');
      if (!v) return;
      if (NP.can(v)) {
        if (a.getAttribute('data-perm-hidden')) { a.style.display = ''; a.removeAttribute('data-perm-hidden'); }
      } else {
        _hide(a);
      }
    });

    // 2) Collapse empty sub-sections. Two structures can exist depending on
    //    whether ig_navchrome.js has slimmed the dropdown yet:
    //      (a) slimmed: .nav-drop-section { .nav-drop-header-toggle, .nav-drop-section-body }
    //      (b) raw:     a .nav-drop-header followed by sibling .nav-link rows
    //      (c) React rail: [class*="section"] with a[data-view]
    document.querySelectorAll('#navGroups .nav-drop-section, #ig-side-rail [data-group] > div > div').forEach(sec => {
      const links = sec.querySelectorAll('.nav-link[data-view], a[data-view]');
      const anyVisible = Array.prototype.some.call(links, l => !l.getAttribute('data-perm-hidden'));
      if (links.length && !anyVisible) _hide(sec); else if (sec.getAttribute('data-perm-hidden') && anyVisible) { sec.style.display = ''; sec.removeAttribute('data-perm-hidden'); }
      // Keep the section's count badge honest.
      const cnt = sec.querySelector('.ndh-count');
      if (cnt) cnt.textContent = String(Array.prototype.filter.call(links, l => !l.getAttribute('data-perm-hidden')).length);
    });

    // Raw (un-slimmed) headers: hide a header whose run of following links are
    // all hidden, until the next header / footer / section.
    document.querySelectorAll('#navGroups .nav-dropdown > .nav-drop-header').forEach(hdr => {
      let n = hdr.nextElementSibling;
      let any = false, sawLink = false;
      while (n && !n.classList.contains('nav-drop-header') && !n.classList.contains('nav-drop-next') && !n.classList.contains('nav-drop-section')) {
        if (n.classList.contains('nav-link') || n.matches?.('a[data-view]')) { sawLink = true; if (!n.getAttribute('data-perm-hidden')) any = true; }
        n = n.nextElementSibling;
      }
      if (sawLink && !any) _hide(hdr); else if (hdr.getAttribute('data-perm-hidden') && any) { hdr.style.display = ''; hdr.removeAttribute('data-perm-hidden'); }
    });

    // 3) Hide a whole nav group (and its leading separator) when it has no
    //    visible items at all. Covers legacy .nav-group-wrap and React [data-group].
    document.querySelectorAll('#navGroups .nav-group-wrap[data-group], #navGroups [data-group], #ig-side-rail [data-group]').forEach(wrap => {
      const links = wrap.querySelectorAll('.nav-link[data-view], a[data-view]');
      const anyVisible = Array.prototype.some.call(links, l => !l.getAttribute('data-perm-hidden'));
      if (links.length && !anyVisible) {
        _hide(wrap);
        const sep = wrap.previousElementSibling;
        if (sep && sep.classList.contains('ngb-sep')) _hide(sep);
      } else if (wrap.getAttribute('data-perm-hidden') && anyVisible) {
        wrap.style.display = '';
        wrap.removeAttribute('data-perm-hidden');
        const sep = wrap.previousElementSibling;
        if (sep && sep.classList.contains('ngb-sep') && sep.getAttribute('data-perm-hidden')) { sep.style.display = ''; sep.removeAttribute('data-perm-hidden'); }
      }
    });

    // 4) The Admin Portal link — driven synchronously by the loaded set.
    const adminLink = document.getElementById('navAdminLink');
    if (adminLink) adminLink.style.display = NP.can('admin') ? '' : 'none';
  }
  NP.applyToMenu = applyToMenu;

  // Guard the current view once permissions load. The home page ('home', and the
  // unset startup state app.js fires before this fetch resolves) is the generic
  // marketing landing where users intentionally go to run a new analysis — it is
  // always permitted, so we must NEVER auto-redirect away from it. The perms
  // fetch (/api/tenants/active) can take 10–15s, so a delayed unsolicited
  // redirect off home is disorienting and feels like a bug. We only redirect a
  // user who is parked on a view they genuinely lack permission to see.
  function enforceLanding() {
    const cur = window.currentView;
    if (!cur || cur === 'home') return;
    if (NP.can(cur)) return;
    const dest = NP.firstPermittedView(orderedNavViews());
    if (dest && dest !== cur && typeof window.navigateTo === 'function') {
      try { window.navigateTo(dest); } catch (_) {}
    }
  }
  NP.enforceLanding = enforceLanding;

  // Fetch the effective permission set + component matrix, then build/guard.
  async function load() {
    try {
      const r = await fetch('/api/tenants/active', {
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin',
      });
      if (!r.ok) return;
      const j = await r.json();
      if (!j || !j.ok) return;
      NP.configure({
        permissions: j.permissions || [],
        componentMatrix: j.componentMatrix || {},
        isPlatformAdmin: !!j.isPlatformAdmin,
      });
      // Keep the legacy global other code reads in sync (no async probe needed).
      window._isPlatformAdmin = NP.isPlatformAdmin;
      applyToMenu();
      enforceLanding();
      // ig_navchrome.js may re-slim the dropdowns for ~30s after load; re-apply
      // briefly so newly-restructured sections inherit the filter.
      let n = 0;
      const t = setInterval(() => { applyToMenu(); if (++n >= 6) clearInterval(t); }, 500);
      try { document.dispatchEvent(new CustomEvent('ig:navperms-ready')); } catch (_) {}
    } catch (_) { /* server still enforces; menu just stays fully visible */ }
  }
  NP.reload = load;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
