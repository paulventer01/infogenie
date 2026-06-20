'use strict';
// test/layout-fonts-guard.test.js — locks in the hydration fix for the root
// layout's <head>.
//
// Background: app/layout.tsx used to hand-author Google Fonts <link> tags (two
// <preconnect> + the stylesheet <link>) directly in <head>. The Replit dev proxy
// injects its devtools <script> into <head> after Next renders, which shifted the
// head child ordering and made React report a hydration mismatch — surfacing as
// the "artifact encountered an error" banner on / and /login.
//
// The fix moves font loading to next/font (self-hosted, Next-managed, no external
// <head> link). This guard fails if anyone reintroduces a hand-authored external
// font <link> into the layout, and asserts fonts are still sourced via next/font.
//
// Run: node --test (or: npm run test:core — this file is in that gate).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LAYOUT = path.join(__dirname, '..', 'app', 'layout.tsx');

function readLayout() {
  return fs.readFileSync(LAYOUT, 'utf8');
}

test('root layout does not hand-author an external font <link> in <head>', () => {
  const src = readLayout();

  // Any <link ... href="...fonts.googleapis..."> (or fonts.gstatic) is the
  // exact pattern that caused the head-reconciliation hydration mismatch.
  const externalFontLink =
    /<link\b[^>]*href=["'][^"']*fonts\.(googleapis|gstatic)\.com[^"']*["'][^>]*>/i;
  assert.ok(
    !externalFontLink.test(src),
    'app/layout.tsx must not hand-author an external Google Fonts <link> in <head> — ' +
      'load fonts via next/font/google instead (see test/layout-fonts-guard.test.js).',
  );

  // Belt-and-suspenders: no bare preconnect to the Google Fonts hosts either,
  // since those were part of the same reconciled-head set.
  const preconnect =
    /<link\b[^>]*rel=["']preconnect["'][^>]*fonts\.(googleapis|gstatic)\.com/i;
  assert.ok(
    !preconnect.test(src),
    'app/layout.tsx must not hand-author a Google Fonts <preconnect> <link> — next/font handles preconnect.',
  );
});

test('root layout sources fonts via next/font/google', () => {
  const src = readLayout();
  assert.match(
    src,
    /from\s+["']next\/font\/google["']/,
    'app/layout.tsx must import fonts from next/font/google so the <head> stays hydration-stable.',
  );
});
