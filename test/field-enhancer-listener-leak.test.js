'use strict';
// Regression guard for the Ad Library Spy / heavy-view freeze.
//
// The field enhancer used to attach a fresh window 'ig:analysis-updated'
// listener for EVERY decorated brand/competitor picker. Because every view
// that swaps innerHTML re-decorates fresh fields, the listener count grew
// without bound across navigations (240 fields -> 240 listeners, +N per
// re-visit), each one retaining a detached <select> + closure. That runaway
// accumulation is what locked the main thread after an analyse run.
//
// The fix uses ONE shared listener that rebuilds whatever pickers are
// currently in the DOM. This test asserts the global listener count stays
// bounded no matter how many fields are decorated or how often a view is
// re-built, so the leak cannot silently come back.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function bootEnhancer() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
  const { window } = dom;
  const perf = (window.performance && window.performance.now) ? window.performance : { now: () => Date.now() };
  const raf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (cb) => setTimeout(() => cb(perf.now()), 0);
  window.IGDiag = { log() {}, mark() {}, err() {} };
  window.analysisData = { brandName: 'Acme', industry: { name: 'SaaS' }, competitors: ['Foo', 'Bar', 'Baz'] };

  // Count window 'ig:analysis-updated' listeners.
  let igListeners = 0;
  const add = window.addEventListener.bind(window);
  const rem = window.removeEventListener.bind(window);
  window.addEventListener = (t, fn, o) => { if (t === 'ig:analysis-updated') igListeners++; return add(t, fn, o); };
  window.removeEventListener = (t, fn, o) => { if (t === 'ig:analysis-updated') igListeners--; return rem(t, fn, o); };

  const src = fs.readFileSync(path.join(__dirname, '..', 'ig_field_enhancer.js'), 'utf8');
  const run = new Function('window', 'document', 'CustomEvent', 'Event', 'MutationObserver', 'setTimeout', 'performance', 'requestAnimationFrame', 'IGDiag', src);
  run(window, window.document, window.CustomEvent, window.Event, window.MutationObserver, setTimeout, perf, raf, window.IGDiag);

  // start() runs on DOMContentLoaded, which jsdom fires asynchronously.
  await new Promise((r) => setTimeout(r, 0));
  if (!window.IGFields && typeof window.document.dispatchEvent === 'function') {
    // Fallback: trigger start() directly if the load event already passed.
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 0));
  }

  return { window, document: window.document, listeners: () => igListeners };
}

function fieldsHtml(prefix, n) {
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<div><label>Competitor name</label><input type="text" id="${prefix}_c${i}"></div>`;
    html += `<div><label>Brand name</label><input type="text" id="${prefix}_b${i}"></div>`;
  }
  return html;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('global ig:analysis-updated listener count stays bounded across heavy decoration + repeated navigation', async () => {
  const { window, document, listeners } = await bootEnhancer();
  const IGFields = window.IGFields;
  assert.ok(IGFields, 'field enhancer exposes IGFields');

  // 1. Pre-build several heavy views full of brand/competitor fields (mirrors
  //    the analyse flow building dashboard/competitors/audience/... at once).
  for (const id of ['dashboard', 'competitors', 'audience', 'creative', 'intelligence', 'battleplan']) {
    const v = document.createElement('div');
    v.id = 'view-' + id;
    v.innerHTML = fieldsHtml(id, 20);
    document.body.appendChild(v);
  }
  await settle(300); // let the MutationObserver chunked-decoration drain

  const afterPrebuild = listeners();

  // 2. Repeatedly re-build a view that swaps its innerHTML (like buildAdLibrary
  //    on every navigation), then decorate it via the public scanRoot hook.
  const adView = document.createElement('div');
  adView.id = 'view-ad-library';
  adView.innerHTML = fieldsHtml('al', 5);
  document.body.appendChild(adView);
  await settle(100);

  for (let n = 0; n < 15; n++) {
    IGFields.pause();
    adView.innerHTML = fieldsHtml('al', 5);
    IGFields.resume({ scan: false });
    IGFields.scanRoot(adView);
    await settle(30);
  }

  const afterNav = listeners();

  // The whole point: a SINGLE shared listener, not one-per-field/per-visit.
  assert.ok(afterPrebuild <= 1, `expected <=1 global listener after prebuilding 240 fields, got ${afterPrebuild}`);
  assert.ok(afterNav <= 1, `expected <=1 global listener after 15 navigations, got ${afterNav}`);

  // Pickers must still actually exist and be wired in the live view.
  const pickers = adView.querySelectorAll('select[data-ig-comp-picker]');
  assert.ok(pickers.length > 0, 'competitor pickers are still rendered in the live view');
});

test('ig:analysis-updated refreshes the live pickers in place', async () => {
  const { window, document } = await bootEnhancer();
  const IGFields = window.IGFields;

  const v = document.createElement('div');
  v.id = 'view-test';
  v.innerHTML = fieldsHtml('t', 2);
  document.body.appendChild(v);
  IGFields.scanRoot(v);
  await settle(30);

  const picker = v.querySelector('select[data-ig-comp-picker]');
  assert.ok(picker, 'a picker was rendered');
  const before = picker.querySelectorAll('option').length;

  // Update analysis data and fire the event the analyse flow dispatches.
  window.analysisData.competitors = ['Foo', 'Bar', 'Baz', 'Qux', 'Quux'];
  window.dispatchEvent(new window.CustomEvent('ig:analysis-updated', { detail: {} }));
  await settle(10);

  const after = picker.querySelectorAll('option').length;
  assert.ok(after > before, `picker options refreshed in place (${before} -> ${after})`);
});
