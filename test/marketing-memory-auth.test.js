// Marketing Memory / knowledge-graph must accept session `req.user` auth.
// A Passport-style `req.isAuthenticated()` check always 401'd logged-in users
// and the global fetch interceptor bounced them to /login.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const kg = require('../services/knowledge_graph/api');

let server, PORT;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Simulate InfoGenie session auth (no Passport).
    if (req.headers['x-test-user'] === '1') {
      req.user = { id: 1, email: 'demo@infogenie.local', isOwner: true };
    }
    next();
  });
  // Stub tenant resolution to avoid DB dependency for the auth gate test.
  const ctx = require('../services/tenants/context');
  ctx.resolveTenantId = async () => 1;
  const db = require('../db');
  db.hasDb = () => false;

  app.use('/api/knowledge-graph', kg.router);
  server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  PORT = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function get(path, authed) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      headers: authed ? { 'x-test-user': '1' } : {},
    }, (res) => {
      let c = '';
      res.on('data', (d) => { c += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(c || '{}') }));
    }).on('error', reject);
  });
}

test('knowledge-graph nodes accepts session req.user', async () => {
  const r = await get('/api/knowledge-graph/nodes?page=1&per=5', true);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.nodes));
});

test('knowledge-graph health accepts session req.user', async () => {
  const r = await get('/api/knowledge-graph/health', true);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('knowledge-graph nodes rejects anonymous callers', async () => {
  const r = await get('/api/knowledge-graph/nodes?page=1&per=5', false);
  assert.equal(r.status, 401);
  assert.equal(r.body.ok, false);
});
