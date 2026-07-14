// test/data-mode-charts.test.js — Client-side chart/section honesty gating (Task 24)
//
// The backend honesty suite (data-mode-strict.test.js) proves the SERVER
// withholds fabricated payloads in strict mode and badges them in demo mode.
// This suite covers the matching CLIENT-SIDE gate: the two helpers in app.js
// that every fabricated chart/section routes through —
//   • window._applyChartDataMode(canvasId, isEstimated, source)
//   • window._applySectionDataMode(headerEl, bodyEl, isEstimated, source, msg)
//
// A regression here (a chart that forgets the helper, or a strict path that
// still draws AI numbers) would otherwise only be caught by manual inspection.
//
// Strategy: extract the REAL helper source out of app.js (no copy/paste drift)
// and eval it inside a jsdom window, then drive each branch and assert the DOM.
//   demo   → canvas stays visible, a DEMO badge is appended
//   strict → canvas hidden, body replaced with the honest "unavailable" state
//   not-estimated → renders normally (helper returns false, no decoration)
//
// Run: node --test   (or: npm test)

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// ── Pull the live helper source out of app.js so the test tracks the shipped
// implementation. We slice contiguous, uniquely-anchored regions rather than
// hardcoding line numbers (app.js is ~50k lines and shifts constantly). ──────
const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Also include extracted per-feature JS files (split from app.js) so the
// call-site floor tests below count across the full frontend surface.
const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');
const EXTRACTED_SRC = fs.readdirSync(PUBLIC_JS)
  .filter(f => f.endsWith('.js'))
  .map(f => { try { return fs.readFileSync(path.join(PUBLIC_JS, f), 'utf8'); } catch { return ''; } })
  .join('\n');
const ALL_SRC = SRC + '\n' + EXTRACTED_SRC;

function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `anchor not found in app.js: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `end anchor not found in app.js: ${endMarker}`);
  return src.slice(start, end);
}

// _esc is a dependency of _dataUnavailableState; grab the real one.
const escFn = sliceBetween(SRC, 'function _esc(s) {', '\n}\n') + '\n}\n';
// Contiguous block: _demoBadge → _dataUnavailableState → _applyChartDataMode →
// _applySectionDataMode (ends right before the "Active client context" section).
const helpersBlock = sliceBetween(SRC,
  'window._demoBadge = function(source) {',
  '// Active client context');

let dom, win, doc;

before(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  win = dom.window;
  doc = win.document;
  // Eval the real helpers into the window. _esc is declared first so the
  // closures created for window._* capture it; the assignments land on window.
  win.eval(escFn + '\n' + helpersBlock);
  // Sanity: the four functions we mean to test actually loaded.
  for (const fn of ['_demoBadge', '_dataUnavailableState', '_applyChartDataMode', '_applySectionDataMode']) {
    assert.equal(typeof win[fn], 'function', `expected window.${fn} to load from app.js`);
  }
});

beforeEach(() => {
  doc.body.innerHTML = '';
  win._igDataMode = 'strict';
});

// Build <div class="host"><canvas id="..."></canvas></div> attached to body.
function mountChart(canvasId, hostPosition) {
  const host = doc.createElement('div');
  host.className = 'host';
  if (hostPosition) host.style.position = hostPosition;
  const canvas = doc.createElement('canvas');
  canvas.id = canvasId;
  host.appendChild(canvas);
  doc.body.appendChild(host);
  return { host, canvas };
}

// ── _applyChartDataMode ─────────────────────────────────────────────────────

test('chart: non-estimated input renders normally (no decoration, returns false)', () => {
  const { host, canvas } = mountChart('spendChart', 'relative');
  win._igDataMode = 'demo'; // even in demo, not-estimated must be left alone
  const hidden = win._applyChartDataMode('spendChart', false, 'Estimated spend');
  assert.equal(hidden, false, 'non-estimated chart must not be hidden');
  assert.notEqual(canvas.style.display, 'none', 'canvas must stay visible');
  assert.equal(host.querySelectorAll('.ig-chart-demo-badge').length, 0, 'no demo badge expected');
  assert.equal(host.querySelectorAll('.ig-chart-unavailable').length, 0, 'no unavailable state expected');
});

test('chart: demo mode keeps canvas visible and appends a DEMO badge (returns false)', () => {
  const { host, canvas } = mountChart('ctrChart', 'relative');
  win._igDataMode = 'demo';
  const hidden = win._applyChartDataMode('ctrChart', true, 'AI estimate');
  assert.equal(hidden, false, 'demo mode must allow the chart to render');
  assert.notEqual(canvas.style.display, 'none', 'canvas must stay visible in demo mode');
  const badges = host.querySelectorAll('.ig-chart-demo-badge');
  assert.equal(badges.length, 1, 'exactly one demo badge expected');
  assert.match(badges[0].innerHTML, /DEMO DATA/i, 'badge must carry the DEMO DATA label');
  assert.match(badges[0].innerHTML, /AI estimate/, 'badge must include the source label');
  assert.equal(host.querySelectorAll('.ig-chart-unavailable').length, 0, 'no unavailable state in demo mode');
});

test('chart: strict mode hides the canvas and shows the unavailable state (returns true)', () => {
  const { host, canvas } = mountChart('roasChart', 'relative');
  win._igDataMode = 'strict';
  const hidden = win._applyChartDataMode('roasChart', true, 'AI estimate');
  assert.equal(hidden, true, 'strict mode must signal the caller NOT to draw the chart');
  assert.equal(canvas.style.display, 'none', 'canvas must be hidden in strict mode');
  const unavail = host.querySelectorAll('.ig-chart-unavailable');
  assert.equal(unavail.length, 1, 'exactly one unavailable state expected');
  assert.match(unavail[0].innerHTML, /Data unavailable/i, 'must render the honest empty-state');
  assert.equal(host.querySelectorAll('.ig-chart-demo-badge').length, 0, 'no demo badge in strict mode');
});

test('chart: re-render is idempotent — badges do not stack', () => {
  const { host } = mountChart('trendChart', 'relative');
  win._igDataMode = 'demo';
  win._applyChartDataMode('trendChart', true, 'AI estimate');
  win._applyChartDataMode('trendChart', true, 'AI estimate');
  assert.equal(host.querySelectorAll('.ig-chart-demo-badge').length, 1, 'badge must not duplicate on re-render');
});

test('chart: switching strict→demo clears the prior unavailable state', () => {
  const { host, canvas } = mountChart('creativeChart', 'relative');
  win._igDataMode = 'strict';
  win._applyChartDataMode('creativeChart', true, 'AI estimate');
  assert.equal(host.querySelectorAll('.ig-chart-unavailable').length, 1);
  win._igDataMode = 'demo';
  win._applyChartDataMode('creativeChart', true, 'AI estimate');
  assert.equal(host.querySelectorAll('.ig-chart-unavailable').length, 0, 'stale unavailable state must be removed');
  assert.equal(host.querySelectorAll('.ig-chart-demo-badge').length, 1, 'demo badge must replace it');
  assert.notEqual(canvas.style.display, 'none', 'canvas must be visible again');
});

test('chart: missing canvas id is a no-op (returns false)', () => {
  const hidden = win._applyChartDataMode('doesNotExist', true, 'AI estimate');
  assert.equal(hidden, false, 'absent canvas must not be reported as hidden');
});

// ── _applySectionDataMode ───────────────────────────────────────────────────

function mountSection() {
  const header = doc.createElement('h3');
  header.textContent = 'Audience';
  const body = doc.createElement('div');
  body.innerHTML = '<table><tr><td>real-ish content</td></tr></table>';
  doc.body.appendChild(header);
  doc.body.appendChild(body);
  return { header, body };
}

test('section: non-estimated input leaves header/body untouched (returns false)', () => {
  const { header, body } = mountSection();
  win._igDataMode = 'demo';
  const hidden = win._applySectionDataMode(header, body, false, 'AI estimate');
  assert.equal(hidden, false);
  assert.equal(header.querySelectorAll('.ig-demo-badge').length, 0, 'no badge for real data');
  assert.match(body.innerHTML, /real-ish content/, 'body must be unchanged');
});

test('section: demo mode appends a DEMO badge to the header, body intact (returns false)', () => {
  const { header, body } = mountSection();
  win._igDataMode = 'demo';
  const hidden = win._applySectionDataMode(header, body, true, 'AI estimate');
  assert.equal(hidden, false, 'demo section must still render its body');
  const badges = header.querySelectorAll('.ig-demo-badge');
  assert.equal(badges.length, 1, 'exactly one demo badge appended to header');
  assert.match(badges[0].innerHTML, /DEMO DATA/i);
  assert.match(body.innerHTML, /real-ish content/, 'body content must be preserved in demo mode');
});

test('section: strict mode replaces the body with the unavailable state (returns true)', () => {
  const { header, body } = mountSection();
  win._igDataMode = 'strict';
  const hidden = win._applySectionDataMode(header, body, true, 'AI estimate', 'Custom strict message here');
  assert.equal(hidden, true, 'strict section must tell caller it was withheld');
  assert.equal(header.querySelectorAll('.ig-demo-badge').length, 0, 'no demo badge in strict mode');
  assert.doesNotMatch(body.innerHTML, /real-ish content/, 'fabricated body must be removed in strict mode');
  assert.match(body.innerHTML, /Data unavailable/i, 'honest empty-state must be shown');
  assert.match(body.innerHTML, /Custom strict message here/, 'custom strict message must be surfaced');
});

test('section: re-render is idempotent — header badge does not stack', () => {
  const { header, body } = mountSection();
  win._igDataMode = 'demo';
  win._applySectionDataMode(header, body, true, 'AI estimate');
  win._applySectionDataMode(header, body, true, 'AI estimate');
  assert.equal(header.querySelectorAll('.ig-demo-badge').length, 1, 'header badge must not duplicate');
});

// ── Coverage lint: every fabricated chart/section call site is well-formed ───
// A coarse regression guard. It does not (and cannot, without a runtime marker)
// prove a brand-new chart remembered to call the helper, but it catches the two
// most likely regressions: a mass removal of the gates, and a malformed call
// that silently no-ops (missing the source label that the badge/empty-state
// copy depends on).
test('lint: chart helper call sites are present and pass a source label', () => {
  // Scan app.js + all extracted public/js files (some charts were split out of app.js)
  const chartCalls = [...ALL_SRC.matchAll(/_applyChartDataMode\(\s*'([^']+)'\s*,\s*([^,]+?)\s*,\s*('[^']*'|[A-Za-z_$][\w$.]*)\s*\)/g)];
  // Keep a floor so an accidental wholesale removal of the gates fails loudly.
  // Floor reduced to 3: the dashboard charts (spendChart/ctrChart/roasChart/
  // trendChart) moved to React along with their legacy modules, so the only
  // remaining legacy call sites are socialReachChart/socialPlatChart/
  // socialEngageChart in ig_content_social.js.
  assert.ok(chartCalls.length >= 3,
    `expected >=3 _applyChartDataMode call sites, found ${chartCalls.length} — were chart gates removed?`);
  for (const m of chartCalls) {
    const [whole, canvasId, , source] = m;
    assert.ok(canvasId && canvasId.length > 0, `empty canvasId in call: ${whole}`);
    assert.ok(source && source.length > 0, `missing source label in call: ${whole}`);
  }
});

test('lint: section helper call sites are present', () => {
  // Scan app.js + all extracted public/js files (some sections were split out of app.js)
  // Floor reduced to 1: the other section gates lived in legacy modules that
  // were deleted when their views moved to React.
  const sectionCalls = [...ALL_SRC.matchAll(/_applySectionDataMode\(/g)];
  assert.ok(sectionCalls.length >= 1,
    `expected >=1 _applySectionDataMode call sites, found ${sectionCalls.length} — were section gates removed?`);
});
