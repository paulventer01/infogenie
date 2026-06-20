// test/helpers/app.js — Boot a faithful test instance of the InfoGenie API.
//
// Why not require('../server')?
//   server.js neither exports its Express `app` nor is safe to require: at load
//   time it runs every BOOT_TASKS schema-ensure, starts the drip setInterval,
//   and — via services/competitor_detect/routes.js — calls app.listen() on the
//   internal port. Requiring it would bind a port and spin up crons. The task
//   is explicit that the harness must work against the app as-is without
//   refactoring product code, so instead we compose the SAME middleware chain
//   from the real modules, in the same order server.js mounts them:
//
//     express.json (with rawBody) → session → loadUserFromSession →
//     loadTenantContext → /api/auth → /api/tenants → api-key gate (+ tenant
//     injection) → enforceMatrix → [feature routers under test]
//
//   This mirrors server.js lines ~146-466 so authenticated calls, tenant
//   scoping and permission enforcement behave exactly as in production.

require('./env'); // must run before vault/session config is read

const express = require('express');
const expressSession = require('express-session');

const _authService    = require('../../services/auth/api');
const _tenantMW       = require('../../services/tenants/middleware');
const _tenantRouter   = require('../../services/tenants/api');
const _tenantCtx      = require('../../services/tenants/context');
const _permEnforce    = require('../../services/tenants/permission_enforce');
const _db             = require('../../db');

// Faithful re-implementation of server.js _injectApiKeyAuth: validate the
// INFOGENIE_API_KEY and, on a match, attach the owner principal + default
// tenant so api-key callers get the same tenant scope they do in production.
async function _injectApiKeyAuth(req) {
  if (req.user) return;
  const expected = process.env.INFOGENIE_API_KEY;
  const supplied =
       (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || (req.headers['x-infogenie-key'] || '').trim()
    || (req.method === 'GET' ? String((req.query && req.query.key) || '').trim() : '');
  if (!expected || !supplied || supplied !== expected) return;
  try {
    let principal = null;
    if (_db.hasDb()) {
      const r = await _db.getPool().query(
        'SELECT id, email, name, is_owner FROM users WHERE is_owner = TRUE ORDER BY id ASC LIMIT 1');
      if (r.rows[0]) {
        const u = r.rows[0];
        principal = { id: u.id, email: u.email, name: u.name, isOwner: true, viaApiKey: true };
      }
    }
    if (!principal) {
      principal = { id: 0, email: 'system@infogenie.local', name: 'API Key', isOwner: true, viaApiKey: true };
    }
    req.user = principal;
    req.viaApiKey = true;
    if (!req.tenant) {
      const tid = await _tenantCtx.getCronTenantId();
      if (tid) req.tenant = { id: tid, name: 'API Key Default', slug: 'apikey', status: 'active' };
    }
  } catch (_) { /* non-fatal — request proceeds unauthenticated */ }
}

// Build (but don't start) the Express app. Exposed separately so a test can
// mount extra middleware/routers before listening if it ever needs to.
function buildApp(opts = {}) {
  const {
    mount,                       // function(app): mount feature routers under test
    enforceMatrix = true,        // include the real permission gate (server default)
    includeAuthRoutes = true,    // mount /api/auth + /api/tenants
  } = opts;

  const app = express();
  app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.set('trust proxy', true);

  // In-memory session store — no DB pollution, single in-process app. Cookie
  // config mirrors server.js except `secure` (NODE_ENV isn't production in
  // tests, so the cookie must be sent over plain http).
  app.use(expressSession({
    name: 'infogenie.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 },
  }));

  app.use(_authService.loadUserFromSession);
  app.use(_tenantMW.loadTenantContext);

  if (includeAuthRoutes) {
    app.use('/api/auth', _authService.router);
    app.use('/api/tenants', _tenantRouter);
  }

  // API gate — try api-key auth first (so tenant injection always runs), then
  // require a principal for non-public /api paths.
  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    await _injectApiKeyAuth(req);
    if (req.user) return next();
    res.status(401).json({ ok: false, error: 'auth_required' });
  });

  if (enforceMatrix) app.use(_permEnforce.enforceMatrix);

  if (typeof mount === 'function') mount(app);

  return app;
}

// Boot the app on an ephemeral port. Returns { app, server, port, baseUrl,
// close() } — call close() in an after() hook for a clean teardown.
async function bootApp(opts = {}) {
  const app = buildApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  return {
    app,
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close() { return new Promise((r) => server.close(r)); },
  };
}

module.exports = { bootApp, buildApp, _injectApiKeyAuth };
