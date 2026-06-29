'use strict';
// Regression guard for Chromium saved-email/password autofill leakage.
//
// Chromium ignores autocomplete="off" and uses its own form-shape heuristic to
// stuff saved emails/passwords into plain text inputs (campaign briefs, brand
// fields, lead/contact forms, settings inputs). The reliable bypass is
// autocomplete="new-password". The field enhancer applies that token (plus the
// password-manager opt-out data attributes) to every free-text input the SPA
// renders, while leaving real auth forms and genuine email/url/tel fields and
// fields with an explicit meaningful autocomplete token untouched.
//
// This test asserts that suppression is applied where it should be and NOT
// applied where it must not be, so the leak cannot silently come back and so a
// future refactor cannot over-suppress legitimate autofill.

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
  window.analysisData = { brandName: 'Acme', industry: { name: 'SaaS' }, competitors: ['Foo'] };

  const src = fs.readFileSync(path.join(__dirname, '..', 'ig_field_enhancer.js'), 'utf8');
  const run = new Function('window', 'document', 'CustomEvent', 'Event', 'MutationObserver', 'setTimeout', 'performance', 'requestAnimationFrame', 'IGDiag', src);
  run(window, window.document, window.CustomEvent, window.Event, window.MutationObserver, setTimeout, perf, raf, window.IGDiag);

  await new Promise((r) => setTimeout(r, 0));
  if (!window.IGFields) {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 0));
  }
  return { window, document: window.document };
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const ac = (el) => (el.getAttribute('autocomplete') || '').toLowerCase();

test('suppresses Chromium autofill on free-text inputs and textareas', async () => {
  const { window, document } = await bootEnhancer();
  const v = document.createElement('div');
  v.id = 'view-brief';
  v.innerHTML = `
    <label>Campaign brief</label><textarea id="brief"></textarea>
    <label>Brand name</label><input type="text" id="brand">
    <label>Headline</label><input id="headline">
    <label>Settings value</label><input type="text" id="setting" autocomplete="off">
  `;
  document.body.appendChild(v);
  window.IGFields.scanRoot(v);
  await settle(60);

  for (const id of ['brief', 'brand', 'headline', 'setting']) {
    const el = document.getElementById(id);
    assert.strictEqual(ac(el), 'new-password', `#${id} should be suppressed with autocomplete="new-password"`);
    assert.strictEqual(el.getAttribute('data-lpignore'), 'true', `#${id} should opt out of LastPass`);
    assert.strictEqual(el.getAttribute('data-1p-ignore'), 'true', `#${id} should opt out of 1Password`);
    assert.strictEqual(el.getAttribute('data-form-type'), 'other', `#${id} should opt out of Dashlane`);
    assert.strictEqual(el.dataset.igNoAutofill, '1', `#${id} should be marked processed`);
  }
});

test('never touches real auth/credential forms', async () => {
  const { window, document } = await bootEnhancer();
  const wall = document.createElement('div');
  wall.id = 'igAuthWall';
  wall.innerHTML = `
    <input type="text" id="loginUser" autocomplete="username">
    <input type="email" id="loginEmail" autocomplete="email">
  `;
  document.body.appendChild(wall);
  window.IGFields.scanRoot(wall);
  await settle(60);

  assert.strictEqual(ac(document.getElementById('loginUser')), 'username', 'login username must keep its autofill');
  assert.strictEqual(ac(document.getElementById('loginEmail')), 'email', 'login email must keep its autofill');
  assert.ok(!document.getElementById('loginUser').dataset.igNoAutofill, 'auth field must not be marked suppressed');
});

test('honours genuine email/url/tel fields and explicit meaningful autocomplete tokens', async () => {
  const { window, document } = await bootEnhancer();
  const v = document.createElement('div');
  v.id = 'view-contact';
  v.innerHTML = `
    <label>Recipient email</label><input type="email" id="recip">
    <label>Website</label><input type="url" id="site">
    <label>Phone</label><input type="tel" id="phone">
    <label>Your name</label><input type="text" id="name" autocomplete="name">
    <label>Org</label><input type="text" id="org" autocomplete="organization">
  `;
  document.body.appendChild(v);
  window.IGFields.scanRoot(v);
  await settle(60);

  // email/url/tel are not text/textarea, so suppression never rewrites them.
  assert.strictEqual(ac(document.getElementById('recip')), '', 'email field left untouched');
  assert.strictEqual(ac(document.getElementById('site')), '', 'url field left untouched');
  assert.strictEqual(ac(document.getElementById('phone')), '', 'tel field left untouched');
  // text fields that already declared a meaningful token keep it.
  assert.strictEqual(ac(document.getElementById('name')), 'name', 'explicit name token preserved');
  assert.strictEqual(ac(document.getElementById('org')), 'organization', 'explicit organization token preserved');
});
