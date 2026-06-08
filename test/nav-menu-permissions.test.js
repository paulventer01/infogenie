'use strict';
// test/nav-menu-permissions.test.js — Permission-driven navigation menu (Task 147)
//
// Proves the frontend renders & guards navigation from the user's REAL role
// permissions, consuming the SAME component→permission matrix the backend
// exports (COMPONENT_MATRIX). Two layers are exercised:
//   1. The pure, DOM-free core (createNavPerms) — can() / firstPermittedView() /
//      guard() — driven by a real system role (Client Viewer) against the real
//      shipped matrix. This is the logic the menu + view-guard depend on.
//   2. The browser DOM layer (applyToMenu) under jsdom — a representative menu is
//      filtered and we assert the disallowed items, their now-empty section,
//      their now-empty group (+ its separator), and the Admin Portal link are all
//      hidden, while permitted items stay visible and an admin sees everything.
//
// The server remains the real boundary (see permission-matrix.test.js); this
// asserts the non-bypassable UX layer on top of it.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const matrix = require('../services/tenants/permission_matrix');
const { SYSTEM_ROLES } = require('../services/tenants/permissions');
const { createNavPerms } = require('../public/js/ig_navperms.js');

const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ig_navperms.js'),
  'utf8',
);

function rolePerms(key) {
  const r = SYSTEM_ROLES.find((x) => x.key === key);
  if (!r) throw new Error(`unknown role ${key}`);
  return r.permissions.slice();
}

// Client Viewer is the canonical low-privilege role: dashboard/analytics/reports/
// brand(+calendar) reads only. It must NOT see compete/grow/admin surfaces.
const VIEWER_PERMS = rolePerms('client_viewer');

// ── 1. Pure core, real matrix, real role ────────────────────────────────────
test('core: a restricted role can see only its permitted views', () => {
  const np = createNavPerms().configure({
    permissions: VIEWER_PERMS,
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: false,
  });

  // Permitted (Client Viewer holds the mapped key)
  assert.equal(np.can('dashboard'), true, 'dashboard.view granted');
  assert.equal(np.can('web-analytics'), true, 'analytics.view granted');
  assert.equal(np.can('brand-calendar'), true, 'brand.calendar.view granted');
  assert.equal(np.can('bulk-reports'), true, 'reports.view granted');

  // Denied (role lacks the mapped key)
  assert.equal(np.can('competitors'), false, 'compete.competitors.view NOT granted');
  assert.equal(np.can('optimizer'), false, 'grow.optimizer.view NOT granted');
  assert.equal(np.can('admin'), false, 'platform.tenants.manage NOT granted');

  // Unmapped surface (e.g. the universal home entry) is always allowed.
  assert.equal(np.can('home'), true, 'unmapped view is allowed');
  assert.equal(np.requiredFor('home'), null, 'home is not in the matrix');
});

test('core: platform admin bypasses every component check', () => {
  const np = createNavPerms().configure({
    permissions: [], // empty — bypass must not depend on granular perms
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: true,
  });
  assert.equal(np.can('optimizer'), true, 'admin sees grow');
  assert.equal(np.can('competitors'), true, 'admin sees compete');
  assert.equal(np.can('admin'), true, 'admin sees the Admin Portal');
});

test('core: firstPermittedView / visibleViews respect menu order', () => {
  const np = createNavPerms().configure({
    permissions: VIEWER_PERMS,
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: false,
  });
  const order = ['optimizer', 'admin', 'competitors', 'dashboard', 'web-analytics'];
  // First three are denied → the first permitted in order is 'dashboard'.
  assert.equal(np.firstPermittedView(order), 'dashboard');
  assert.deepEqual(np.visibleViews(order), ['dashboard', 'web-analytics']);
});

test('core: guard blocks a disallowed view and redirects to a permitted one', () => {
  const np = createNavPerms().configure({
    permissions: VIEWER_PERMS,
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: false,
  });
  const fallback = ['optimizer', 'dashboard', 'web-analytics'];

  const blocked = np.guard('optimizer', fallback);
  assert.equal(blocked.allowed, false, 'optimizer is blocked');
  assert.equal(blocked.redirect, 'dashboard', 'redirected to first permitted view');

  const ok = np.guard('dashboard', fallback);
  assert.equal(ok.allowed, true, 'dashboard is allowed');
  assert.equal(ok.redirect, null);
});

// ── 2. DOM layer under jsdom ─────────────────────────────────────────────────
// A representative menu mirroring index.html's structure: groups with separators,
// section headers, data-view links, and the Admin Portal link.
function buildMenuDom() {
  const html = `<!DOCTYPE html><html><body>
    <div class="nav-groups" id="navGroups">
      <div class="nav-group-wrap" data-group="analyse">
        <button class="nav-group-btn" type="button"><span class="ngb-label">Analyse</span></button>
        <div class="nav-dropdown">
          <div class="nav-drop-header">Start here</div>
          <a href="#" class="nav-link" data-view="dashboard"><span class="ndl-text">Dashboard</span></a>
          <div class="nav-drop-header">Know your competition</div>
          <a href="#" class="nav-link" data-view="competitors"><span class="ndl-text">Competitors</span></a>
          <a href="#" class="nav-link" data-view="battle-cards"><span class="ndl-text">Battle Cards</span></a>
        </div>
      </div>
      <span class="ngb-sep"></span>
      <div class="nav-group-wrap" data-group="grow">
        <button class="nav-group-btn" type="button"><span class="ngb-label">Grow</span></button>
        <div class="nav-dropdown">
          <div class="nav-drop-header">See ad performance</div>
          <a href="#" class="nav-link" data-view="optimizer"><span class="ndl-text">Optimizer</span></a>
          <a href="#" class="nav-link" data-view="meta-insights"><span class="ndl-text">Meta Insights</span></a>
        </div>
      </div>
      <span class="ngb-sep"></span>
      <div class="nav-group-wrap" data-group="manage">
        <button class="nav-group-btn" type="button"><span class="ngb-label">Manage</span></button>
        <div class="nav-dropdown">
          <div class="nav-drop-header">Brand</div>
          <a href="#" class="nav-link" data-view="brand-calendar"><span class="ndl-text">Brand Calendar</span></a>
          <a href="#" class="nav-link" id="navAdminLink" data-view="admin"><span class="ndl-text">Admin Portal</span></a>
        </div>
      </div>
    </div>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  // Evaluate the shipped module inside this window — `module` is undefined here so
  // the browser branch runs and defines window.IGNavPerms. (load()'s fetch is a
  // no-op under jsdom; we drive configure()/applyToMenu() explicitly.)
  dom.window.eval(MODULE_SRC);
  return dom;
}

const vis = (dom, sel) => {
  const el = dom.window.document.querySelector(sel);
  return el && el.style.display !== 'none';
};

test('dom: a restricted role\'s rendered menu omits disallowed items, sections, groups and the admin link', () => {
  const dom = buildMenuDom();
  const NP = dom.window.IGNavPerms;
  NP.configure({
    permissions: VIEWER_PERMS,
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: false,
  });
  NP.applyToMenu();

  // Permitted items stay visible.
  assert.equal(vis(dom, '.nav-link[data-view="dashboard"]'), true, 'dashboard visible');
  assert.equal(vis(dom, '.nav-link[data-view="brand-calendar"]'), true, 'brand-calendar visible');

  // Disallowed items are hidden.
  assert.equal(vis(dom, '.nav-link[data-view="competitors"]'), false, 'competitors hidden');
  assert.equal(vis(dom, '.nav-link[data-view="battle-cards"]'), false, 'battle-cards hidden');
  assert.equal(vis(dom, '.nav-link[data-view="optimizer"]'), false, 'optimizer hidden');
  assert.equal(vis(dom, '.nav-link[data-view="meta-insights"]'), false, 'meta-insights hidden');

  // The Admin Portal link is hidden for a non-admin.
  assert.equal(vis(dom, '#navAdminLink'), false, 'admin link hidden');

  // A section whose every link is hidden shows no empty header.
  const headers = dom.window.document.querySelectorAll('[data-group="analyse"] .nav-drop-header');
  const competeHeader = Array.from(headers).find((h) => /competition/i.test(h.textContent));
  assert.ok(competeHeader, 'sanity: found the competition header');
  assert.equal(competeHeader.style.display, 'none', 'empty section header hidden');

  // The whole Grow group (all items disallowed) is hidden, with its separator.
  const grow = dom.window.document.querySelector('[data-group="grow"]');
  assert.equal(grow.style.display, 'none', 'grow group hidden');
  assert.equal(grow.previousElementSibling.style.display, 'none', 'grow separator hidden');

  // The Manage group survives (brand-calendar is permitted) even though the admin
  // link inside it is hidden.
  assert.notEqual(dom.window.document.querySelector('[data-group="manage"]').style.display, 'none', 'manage group visible');

  // orderedNavViews + firstPermittedView land on the first permitted view.
  assert.equal(NP.firstPermittedView(NP.orderedNavViews()), 'dashboard', 'default landing = first permitted');
});

test('dom: startup landing redirects off the generic home view to the first permitted view', () => {
  const dom = buildMenuDom();
  const NP = dom.window.IGNavPerms;
  // Capture the redirect target the boot flow would navigate to.
  const calls = [];
  dom.window.navigateTo = (v) => { calls.push(v); dom.window.currentView = v; };

  // Simulate app.js's synchronous startup nav, which fires before perms load.
  dom.window.currentView = 'home';

  NP.configure({
    permissions: VIEWER_PERMS,
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: false,
  });
  NP.applyToMenu();
  NP.enforceLanding();

  // The restricted user must be moved off 'home' onto their first permitted nav
  // view (dashboard is first in DOM order and is permitted).
  assert.deepEqual(calls, ['dashboard'], 'redirected from home to first permitted view');
});

test('dom: startup landing does NOT yank a user off a view they already chose', () => {
  const dom = buildMenuDom();
  const NP = dom.window.IGNavPerms;
  const calls = [];
  dom.window.navigateTo = (v) => { calls.push(v); dom.window.currentView = v; };

  // User navigated to a permitted view before perms resolved.
  dom.window.currentView = 'brand-calendar';

  NP.configure({
    permissions: VIEWER_PERMS,
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: false,
  });
  NP.enforceLanding();

  assert.deepEqual(calls, [], 'no redirect — already on a permitted view');
});

test('dom: a user parked on a disallowed view at load is redirected to a permitted one', () => {
  const dom = buildMenuDom();
  const NP = dom.window.IGNavPerms;
  const calls = [];
  dom.window.navigateTo = (v) => { calls.push(v); dom.window.currentView = v; };

  // Parked on a view this role cannot see (e.g. a stale deep link).
  dom.window.currentView = 'optimizer';

  NP.configure({
    permissions: VIEWER_PERMS,
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: false,
  });
  NP.enforceLanding();

  assert.deepEqual(calls, ['dashboard'], 'bounced from disallowed view to first permitted');
});

test('dom: a platform admin sees every item including the Admin Portal link', () => {
  const dom = buildMenuDom();
  const NP = dom.window.IGNavPerms;
  NP.configure({
    permissions: [],
    componentMatrix: matrix.COMPONENT_MATRIX,
    isPlatformAdmin: true,
  });
  NP.applyToMenu();

  assert.equal(vis(dom, '.nav-link[data-view="optimizer"]'), true, 'admin sees optimizer');
  assert.equal(vis(dom, '.nav-link[data-view="competitors"]'), true, 'admin sees competitors');
  assert.equal(vis(dom, '#navAdminLink'), true, 'admin sees the admin link');
  assert.notEqual(dom.window.document.querySelector('[data-group="grow"]').style.display, 'none', 'grow group visible for admin');
});
