'use strict';

// PR10E9: real Next -> production Express -> disposable PostgreSQL/TLS.
// Consumer owns REQUIRE_BROWSER skip/fail policy, browser login and external
// page-request blocking. Launch Puppeteer with pipe:true (no extra TCP port).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const ROOT = path.resolve(__dirname, '../..');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const TABLES = ['capacity_assignments', 'agency_time_entries', 'agency_rate_cards',
  'agency_scope_baselines', 'agent_tasks', 'agent_goals', 'team_capacity'];

function databaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid PR10E9_TEST_DATABASE_URL'); }
  assert.ok(typeof value === 'string' && !/\s/.test(value) &&
    ['postgres:', 'postgresql:'].includes(url.protocol) && LOOPBACK.has(url.hostname) &&
    url.pathname === '/infogenie_agency_browser' && url.username && url.password &&
    !url.search && !url.hash,
  'PR10E9_TEST_DATABASE_URL requires loopback, explicit credentials, exact database infogenie_agency_browser and no URL overrides');
  return url;
}

function rejectDotenv() {
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local']) {
    assert.ok(!fs.existsSync(path.join(ROOT, name)), 'Browser harness requires a checkout without dotenv files');
  }
}

// Also preloaded in Next's CLI, server child and compiler workers via NODE_OPTIONS.
// No API responses are replaced: denied traffic throws before socket creation.
function guardNetwork(ports, blocked) {
  const connect = net.Socket.prototype.connect, fetch = global.fetch;
  function admit(host, port, socketPath, tooling) {
    if (socketPath || !LOOPBACK.has(host || 'localhost') || !ports.has(Number(port))) {
      blocked(host, tooling);
      throw new Error('PR10E9 blocked outbound network');
    }
  }
  net.Socket.prototype.connect = function (...args) {
    const raw = Array.isArray(args[0]) ? args[0] : args;
    const first = raw[0];
    const options = first && typeof first === 'object' ? first :
      typeof first === 'string' ? { path: first } :
        { port: first, host: typeof raw[1] === 'string' ? raw[1] : 'localhost' };
    admit(options.host, options.port, options.path);
    return connect.apply(this, args);
  };
  global.fetch = async function (input, ...args) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    admit(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80),
      !['http:', 'https:'].includes(url.protocol),
      url.href === 'https://registry.npmjs.org/-/package/next/dist-tags' ? 'VERSION' : undefined);
    return fetch.call(this, input, ...args);
  };
  return () => { net.Socket.prototype.connect = connect; global.fetch = fetch; };
}

if (process.env.PR10E9_NEXT_CHILD === '1') {
  rejectDotenv();
  const target = new URL(process.env.EXPRESS_PROXY_TARGET);
  assert.ok(LOOPBACK.has(target.hostname) && target.protocol === 'http:');
  guardNetwork(new Set([Number(target.port), Number(process.env.PORT)]), (host, tooling) => {
    // next/font/google's native dev fallback is permitted; never fetch fonts.
    const kind = ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host) ? 'FONT' : tooling || 'EGRESS';
    process.stderr.write(`[PR10E9_${kind}_BLOCKED]\n`);
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function get(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, text }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Next readiness request timed out')));
    req.once('error', reject);
  });
}

async function stopNext(child) {
  if (!child?.pid) return;
  function signal(value) {
    try { process.kill(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    signal('SIGTERM');
    if (child.exitCode !== null || child.signalCode !== null) { clearTimeout(timer); resolve(); }
  });
  signal('SIGKILL'); // Own detached group only; includes Next's compiler children.
}

async function startAgencyBrowser(t) {
  const dedicated = process.env.PR10E9_TEST_DATABASE_URL;
  assert.ok(dedicated, 'PR10E9_TEST_DATABASE_URL is required; ambient DATABASE_URL is never used');
  const url = databaseUrl(dedicated); // Before helpers, db, vault or app imports.
  rejectDotenv();
  assert.ok(!Object.keys(require.cache).some((file) =>
    [path.join(ROOT, 'db.js'), path.join(ROOT, 'server.js')].includes(file) ||
    file.startsWith(path.join(ROOT, 'services') + path.sep)),
  'startAgencyBrowser must run before any database or app module import, once per test process');

  const previous = { ...process.env }, ports = new Set([Number(url.port || 5432)]);
  const blocked = [], stores = new Set();
  let app, db, fx, child, restoreNetwork, closing, nextError, logs = '', fontBlocked = false, versionBlocked = false;
  async function teardown() {
    const errors = [];
    const attempt = async (fn) => { try { await fn(); } catch (error) { errors.push(error); } };
    await attempt(() => stopNext(child));
    await attempt(async () => {
      if (app) { app.server.closeAllConnections(); await app.close(); }
    });
    for (const store of stores) await attempt(() => store.close());
    if (fx) {
      const pool = db.getPool(), ids = fx.created.tenantIds;
      for (const table of TABLES) await attempt(async () => {
        if (ids.length && (await pool.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) {
          await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::int[])`, [ids]);
        }
      });
      await attempt(async () => {
        if (fx.created.userIds.length &&
          (await pool.query("SELECT to_regclass('user_sessions') AS name")).rows[0].name) {
          await pool.query("DELETE FROM user_sessions WHERE sess->>'userId'=ANY($1::text[])",
            [fx.created.userIds.map(String)]);
        }
      });
      await attempt(() => fx.cleanup()); // E8: users/memberships before tenant roles.
    }
    await attempt(async () => { if (db?.getPool()) await db.getPool().end(); });
    restoreNetwork?.();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
    if (fontBlocked) t.diagnostic('Google font downloads blocked; Next dev used its native fallback fonts.');
    if (versionBlocked) t.diagnostic('Next dev npm version lookup blocked; installed version is unchanged.');
    if (blocked.length) errors.push(new Error(`PR10E9 forbidden app/Next egress attempts: ${blocked.length}`));
    if (errors.length) throw new AggregateError(errors, 'Agency browser teardown failed');
  }
  const close = () => (closing ||= teardown());
  t.after(close);

  try {
    // Allowlist, not a provider-key blacklist. Neither process inherits ambient
    // DATABASE_URL, NODE_OPTIONS, proxy settings, PG overrides or vendor secrets.
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'PUPPETEER_EXECUTABLE_PATH', 'PUPPETEER_CACHE_DIR']) {
      if (previous[key] !== undefined) process.env[key] = previous[key];
    }
    Object.assign(process.env, { DATABASE_URL: dedicated, PR10E9_TEST_DATABASE_URL: dedicated,
      PR10E9_REQUIRE_BROWSER: previous.PR10E9_REQUIRE_BROWSER || '', NODE_ENV: 'test',
      SESSION_SECRET: 'pr10e9-synthetic-session-secret', CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 0x2a).toString('base64'),
      INFOGENIE_API_KEY: 'pr10e9-synthetic-api-key', PGCONNECT_TIMEOUT: '10', INFOGENIE_JOBS: '0',
      PERMISSION_ENFORCEMENT: 'on', MULTITENANT_ENFORCEMENT: 'on', SECURITY_CSRF: 'on',
      CI: '1', NEXT_TELEMETRY_DISABLED: '1', NEXT_TRACE_UPLOAD_DISABLED: '1' });
    restoreNetwork = guardNetwork(ports, () => blocked.push('Express/process network'));
    require('./env');
    db = require('../../db');
    const tls = await db.getPool().query('SELECT current_database() AS database, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    assert.equal(tls.rows[0]?.database, 'infogenie_agency_browser', 'Database identity required before schema setup');
    assert.equal(tls.rows[0]?.ssl, true, 'PostgreSQL TLS required before schema setup');
    fx = require('./fixtures').makeFixtures();
    await db.ensureSchema();
    await fx.ensureSchemas();
    await require('../../services/capacity/schema').ensureCapacitySchema();
    await require('../../services/agency_ops/schema').ensureAgencyOpsSchema();
    await require('../../services/agent_goals/schema').ensureAgentGoalsSchema();
    app = await require('./app').bootApp(); // No mounts, authority headers or jobs.
    assert.equal(require('../../services/runtime_flags').backgroundEnabled(), false);
    ports.add(app.port);
    app.server.on('request', (req, res) => {
      res.once('finish', () => { if (req.sessionStore) stores.add(req.sessionStore); });
    });
    await get(`${app.baseUrl}/api/auth/me`, 10_000); // Observe the real store for teardown, without logging in.
    const tenantA = await fx.seedTenant('Browser A'), tenantB = await fx.seedTenant('Browser B');
    async function actor(tenant, roleKey) {
      const user = await fx.seedUser({ tenantId: tenant.id, owner: false, roleKey });
      assert.equal(user.isOwner, false);
      return { email: user.email, password: user.password, tid: tenant.id, uid: user.id };
    }
    const actors = { owner: await actor(tenantA, 'tenant_owner'),
      other: await actor(tenantB, 'tenant_owner'), viewer: await actor(tenantA, 'analyst') };
    const dates = (await db.getPool().query(`SELECT
      to_char(date_trunc('week', CURRENT_DATE), 'YYYY-MM-DD') AS monday,
      to_char(date_trunc('week', CURRENT_DATE) + INTERVAL '1 day', 'YYYY-MM-DD') AS tuesday,
      to_char(date_trunc('week', CURRENT_DATE) + INTERVAL '6 days', 'YYYY-MM-DD') AS sunday`)).rows[0];

    const port = await freePort(), baseUrl = `http://127.0.0.1:${port}`;
    ports.add(port);
    process.env.PUBLIC_BASE_URL = baseUrl;
    const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CI: '1', NODE_ENV: 'development',
      PORT: String(port), EXPRESS_PROXY_TARGET: app.baseUrl, PR10E9_NEXT_CHILD: '1',
      NEXT_TELEMETRY_DISABLED: '1', NEXT_TRACE_UPLOAD_DISABLED: '1',
      NODE_OPTIONS: `--require ${JSON.stringify(__filename)}` };
    child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(port)],
      { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.once('error', (error) => { nextError = error; });
    const capture = (chunk) => {
      logs = (logs + chunk.toString()).slice(-12_000);
      if (logs.includes('[PR10E9_FONT_BLOCKED]')) fontBlocked = true;
      if (logs.includes('[PR10E9_VERSION_BLOCKED]')) versionBlocked = true;
      if (logs.includes('[PR10E9_EGRESS_BLOCKED]') && !blocked.includes('Next network')) blocked.push('Next network');
    };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const deadline = Date.now() + 180_000;
    let ready = false;
    while (Date.now() < deadline) {
      t.signal.throwIfAborted();
      if (nextError || child.exitCode !== null || child.signalCode !== null) break;
      try {
        const page = await get(`${baseUrl}/login`, Math.min(10_000, deadline - Date.now()));
        if (page.status === 200 && page.text.includes('<html')) { ready = true; break; }
      } catch { /* Connection refusal/compile latency is retried within the deadline. */ }
      await delay(250, undefined, { signal: t.signal });
    }
    assert.ok(ready, `Next dev failed readiness within 180s${nextError ? ': spawn failed' : ''}\n${logs}`);
    const identity = await get(`${baseUrl}/api/auth/me`, 10_000);
    assert.equal(identity.status, 200, 'Next must proxy the real Express auth endpoint');
    assert.deepEqual(JSON.parse(identity.text), { ok: true, authenticated: false, user: null });
    assert.deepEqual(blocked, [], 'No forbidden provider attempt during startup');
    return { baseUrl, actors, dates, db, fx, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Agency browser startup failed');
    }
    throw error;
  }
}

module.exports = { startAgencyBrowser };
