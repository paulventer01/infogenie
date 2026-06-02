'use strict';
// test/static-asset-caching.test.js — Returning-visitor caching contract.
//
// Fingerprinted static assets (.js/.css carrying a content-hash `?v=`) are
// served `public, max-age=31536000, immutable` so returning visitors are served
// straight from cache and never re-download an unchanged file (e.g. the ~3.6 MB
// app.js). This behaviour lives in two places that could silently regress:
//   • the global Cache-Control middleware in server.js (sets `no-store` on
//     everything by default), and
//   • the express.static mount whose `setHeaders` hook (setVersionedAssetHeaders)
//     UPGRADES a matching-hash asset to the immutable header.
// A change to either could quietly revert returning visitors to re-downloading
// every asset on every load (no-store) with nobody noticing.
//
// Strategy: stand up a tiny Express app wired EXACTLY like server.js — the same
// global middleware headers, the real serveVersionedHtml for index.html, and the
// real setVersionedAssetHeaders on express.static — then make live HTTP requests
// and assert the resulting Cache-Control headers. The version-matching logic and
// header upgrade come from the SHIPPED services/static_versioning module, so the
// test tracks the real implementation. A final source-level guard asserts
// server.js still wires those pieces together so the functional contract here
// cannot be bypassed by a wiring change.
//
// Run: node --test   (or: npm test)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const staticVersioning = require('../services/static_versioning');

const IMMUTABLE = 'public, max-age=31536000, immutable';

let tmpRoot;
let server;
let baseUrl;
let appJsVersion;
let styleCssVersion;

// Build a temp web root with a couple of fingerprintable assets + an index.html
// that references them, then serve it with the same wiring as server.js.
before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-static-cache-'));
  fs.writeFileSync(path.join(tmpRoot, 'app.js'), 'console.log("app bundle bytes");\n');
  fs.writeFileSync(path.join(tmpRoot, 'style.css'), 'body { color: #123456; }\n');
  fs.writeFileSync(
    path.join(tmpRoot, 'index.html'),
    '<!DOCTYPE html><html><head><link rel="stylesheet" href="/style.css">'
      + '</head><body><script src="/app.js"></script></body></html>',
  );

  appJsVersion = staticVersioning.assetVersion(path.join(tmpRoot, 'app.js'));
  styleCssVersion = staticVersioning.assetVersion(path.join(tmpRoot, 'style.css'));
  assert.ok(appJsVersion, 'precondition: app.js content hash computed');
  assert.ok(styleCssVersion, 'precondition: style.css content hash computed');

  const app = express();

  // Mirror server.js's global Cache-Control middleware: everything defaults to
  // no-store / no-cache / Expires:0 unless a later handler upgrades it.
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // index.html → auto-versioned + no-cache (real handler).
  const serveIndex = staticVersioning.serveVersionedHtml(
    path.join(tmpRoot, 'index.html'),
    tmpRoot,
  );
  app.get(['/', '/index.html'], serveIndex);

  // An /api/* route that does nothing special — it must keep the global
  // middleware's no-store header (APIs are never cached).
  app.get('/api/ping', (req, res) => res.json({ ok: true }));

  // Static mount with the real setHeaders hook that upgrades matching-hash
  // assets to immutable.
  app.use(express.static(tmpRoot, {
    etag: false,
    lastModified: false,
    setHeaders: staticVersioning.setVersionedAssetHeaders,
  }));

  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function get(reqPath) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${reqPath}`, (res) => {
      res.resume(); // drain body
      res.on('end', () => resolve(res));
    }).on('error', reject);
  });
}

test('matching-hash .js is served immutable (returning visitors skip re-download)', async () => {
  const res = await get(`/app.js?v=${appJsVersion}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], IMMUTABLE);
  // The no-store siblings must be cleared or browsers won't cache.
  assert.equal(res.headers.pragma, undefined);
  assert.equal(res.headers.expires, undefined);
});

test('matching-hash .css is served immutable', async () => {
  const res = await get(`/style.css?v=${styleCssVersion}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], IMMUTABLE);
  assert.equal(res.headers.pragma, undefined);
  assert.equal(res.headers.expires, undefined);
});

test('stale/wrong ?v= is NOT immutable — falls back to no-store so the URL self-corrects', async () => {
  const res = await get('/app.js?v=deadbeef00');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.doesNotMatch(res.headers['cache-control'], /immutable/);
});

test('no ?v= at all is NOT immutable — stays no-store', async () => {
  const res = await get('/app.js');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.doesNotMatch(res.headers['cache-control'], /immutable/);
});

test('index.html stays no-cache (so it always picks up fresh asset versions)', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-cache');
});

test('/api/* responses stay no-store (never cached)', async () => {
  const res = await get('/api/ping');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.doesNotMatch(res.headers['cache-control'], /immutable/);
});

// Source-level guard: the functional test above wires the pieces itself, so it
// would keep passing even if server.js stopped using them. Assert server.js
// still mounts express.static with the real setHeaders hook and still serves
// index.html through serveVersionedHtml, so the contract can't be bypassed by a
// wiring change.
test('server.js still wires the immutable-asset caching into express.static', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /express\.static\(/, 'server.js mounts express.static');
  assert.match(
    src,
    /setHeaders:\s*_staticVersioning\.setVersionedAssetHeaders/,
    'express.static still uses setVersionedAssetHeaders as its setHeaders hook',
  );
  assert.match(
    src,
    /_staticVersioning\.serveVersionedHtml\(/,
    'index.html still served through serveVersionedHtml',
  );
});
