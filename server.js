const express = require('express');
const path = require('path');
const https = require('https');
const fs    = require('fs');
const multer = require('multer');
const dns   = require('dns').promises;
const net   = require('net');
const crypto = require('crypto');
const expressSession = require('express-session');
const PgSession = require('connect-pg-simple')(expressSession);
const OpenAI    = require('openai');
const Anthropic  = require('@anthropic-ai/sdk');
// GPT-5 family params differ from GPT-4o (max_completion_tokens, fixed temperature,
// reasoning budget). Patch the shared OpenAI SDK once so every chat.completions.create
// across all services normalizes gpt-5* params transparently. See services/ai_compat.js.
const _aiCompat = require('./services/ai_compat');
_aiCompat.patchOpenAI(OpenAI);
// Also intercept raw fetch/https POSTs to /chat/completions (the many non-SDK
// helpers) so gpt-5* bodies are normalized regardless of transport.
_aiCompat.patchHttp();
const _authService = require('./services/auth/api');
const _authSchema  = require('./services/auth/schema');
const _credentialsVault = require('./services/credentials/vault');
const _platformKeys = require('./services/credentials/platform_keys');
const _tenantSchema     = require('./services/tenants/schema');
const _tenantMiddleware = require('./services/tenants/middleware');
const _tenantRouter     = require('./services/tenants/api');
const _permEnforce      = require('./services/tenants/permission_enforce');
const _authGate         = require('./services/auth_gate');
const _runtimeFlags     = require('./services/runtime_flags');

// Background work — port binding, the drip cron tick below, the register-time
// crons in services/officer + services/assistant_ops routes, and the BOOT_TASKS
// schema-ensure runner — must run ONLY when this file is the process entry point
// (`node server.js`, used by scripts/dev.js + scripts/start.js). When server.js
// is required as a module — the test harness calling buildApp() — this stays off
// so importing the app binds no port and starts no timers/crons. Set BEFORE the
// process-level handlers and any route module so every guard downstream reads
// the right value.
_runtimeFlags.setBackground(require.main === module);

// ── Global async safety net ──────────────────────────────────────────────────
// Node 15+ crashes the whole process on any unhandled promise rejection. In a
// long-running multi-user server a single stray async failure — e.g. a Resend
// email send rejecting because the from-domain isn't verified, or a background
// cron throwing — must NOT take the site down for everyone. An unhandled
// *rejection* leaves the rest of the process intact, so we log it loudly (so the
// underlying bug stays visible) and keep serving every other user.
//
// An uncaught *exception* is different: by the time it fires the process may be
// in a corrupted state (half-mutated globals, broken invariants), so continuing
// risks silent data corruption. We log it at fatal level and exit cleanly so the
// supervisor restarts a fresh process — fail-fast, not swallow. Explicit boot
// guards below already use process.exit(1) and are unaffected by these handlers.
// Installed first, before any boot task or route, to cover the whole lifetime.
// Only the live server installs these process-level handlers; when the app is
// merely imported for tests (build-only mode) we leave the test runner's own
// lifecycle untouched — in particular the uncaughtException → process.exit(1)
// must never fire inside a test process.
if (_runtimeFlags.backgroundEnabled()) {
  process.on('unhandledRejection', (reason) => {
    const msg = (reason && reason.stack) || (reason && reason.message) || String(reason);
    console.error('[unhandledRejection] (kept alive)', msg);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException] FATAL — exiting for a clean restart:',
      (err && err.stack) || (err && err.message) || String(err));
    process.exit(1);
  });
}

// ── Env-var name aliases ─────────────────────────────────────────────────────
// Some Replit Secrets were stored under the historical names below. The rest
// of the code reads the canonical names. Aliasing here keeps both working so
// users don't have to rename and re-paste their existing secrets.
if (!process.env.SLACK_WEBHOOK_URL && process.env.SLACK_WEBHOOK) {
  process.env.SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK;
}
if (!process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_EMAIL_KEY) {
  process.env.RAPIDAPI_KEY = process.env.RAPIDAPI_EMAIL_KEY;
}

// ── Shared AI clients (used by all routes) ───────────────────────────────────
// `let` (not `const`) so they can be rebuilt after platform_keys.hydrate() pulls
// an admin-managed OpenAI/Anthropic key out of the DB at boot. Route handlers
// close over these bindings and call them lazily, so a rebuild is picked up.
let openai = new OpenAI({
  apiKey:   process.env.AI_INTEGRATIONS_OPENAI_API_KEY || 'dummy',
  baseURL:  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
let anthropic = new Anthropic.default({
  apiKey:   process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL:  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});
function _rebuildAiClients() {
  openai = new OpenAI({
    apiKey:   process.env.AI_INTEGRATIONS_OPENAI_API_KEY || 'dummy',
    baseURL:  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  anthropic = new Anthropic.default({
    apiKey:   process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL:  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });
}

// ── Retry-with-fallback helper for OpenAI chat completions ─────────────────
// gpt-4o is occasionally returning empty 500s ("500 status code (no body)")
// from the upstream proxy. Wrapping every call gives us:
//   1. Two retries on the requested model with short back-off
//   2. Automatic fallback to gpt-5-mini (which uses different infra and is
//      usually available when gpt-4o is degraded)
// Returns the same shape as openai.chat.completions.create — throws if every
// attempt fails so callers can branch into deterministic fallbacks.
async function openaiChatWithRetry(params, opts = {}) {
  const { fallbackModel = 'gpt-5-mini', retries = 2 } = opts;
  const primary = params.model;
  let primaryErr = null;        // preserve original cause for diagnostics
  let lastTransient = false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await openai.chat.completions.create(params);
    } catch (e) {
      primaryErr = e;
      const msg = (e && e.message) || '';
      const status = (e && (e.status || e.statusCode)) || 0;
      lastTransient = /500|502|503|504|timeout|ECONN|ETIMEDOUT|fetch failed|no body/i.test(msg)
        || [500, 502, 503, 504, 408, 429].includes(status);
      if (!lastTransient) break;       // don't retry 400/401/403/404 etc
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
      }
    }
  }
  // Fallback model attempt — ONLY if last error was transient AND model differs.
  // Non-transient errors (auth, bad request, etc.) won't be fixed by switching
  // model and would obscure the real root cause.
  if (lastTransient && fallbackModel && fallbackModel !== primary) {
    try {
      console.warn(`[openai-retry] ${primary} failed (${primaryErr?.message}) — falling back to ${fallbackModel}`);
      return await openai.chat.completions.create({ ...params, model: fallbackModel });
    } catch (e) {
      const merged = new Error(`primary(${primary}): ${primaryErr?.message || primaryErr} | fallback(${fallbackModel}): ${e.message || e}`);
      merged.primaryError = primaryErr;
      merged.fallbackError = e;
      throw merged;
    }
  }
  throw primaryErr || new Error('openai retry failed');
}

const app = express();
const PORT = process.env.PORT || 5000;

// Headers required for Replit proxy/preview to work correctly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Allow embedding in iframes (needed for Replit preview pane)
  res.removeHeader('X-Frame-Options');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Capture the raw request body alongside the parsed JSON so HMAC-signed
// webhooks (Resend / Svix) can verify against the exact bytes that were
// signed by the sender. Body parser still hands the parsed object to routes.
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// Trust the Replit proxy so req.ip returns the real client IP for budget caps.
app.set('trust proxy', true);

// ── Session store (Postgres-backed, falls back to in-memory if no DB) ────────
// Required for the real per-user auth flow (signup / login / social OAuth).
// Cookie: HttpOnly, SameSite=Lax, Secure in production, 30-day rolling expiry.
const _sessionSecret = process.env.SESSION_SECRET
  || process.env.INFOGENIE_API_KEY
  || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[auth] SESSION_SECRET not set — using ephemeral secret (sessions will not survive restart unless DATABASE_URL is configured to back the session store)');
}
const _sessionStore = (process.env.DATABASE_URL)
  ? new PgSession({
      conObject: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
      tableName: 'user_sessions',
      createTableIfMissing: true,
    })
  : undefined; // falls back to MemoryStore (dev only)
app.use(expressSession({
  store: _sessionStore,
  name: 'infogenie.sid',
  secret: _sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days inactivity
  },
}));
// Populate req.user from req.session (if any). Runs before the static-file
// + API-key gate so every downstream route can read req.user.
app.use(_authService.loadUserFromSession);
// Attach tenant context (active tenant, role, permission set) to req. Phase 1
// is non-enforcing — this just makes req.tenant / req.can(perm) available to
// any route that wants to read it. No existing route is gated yet.
app.use(_tenantMiddleware.loadTenantContext);
// Mount /api/auth/* routes BEFORE the static-file handler + API-key gate so
// they remain reachable to unauthenticated visitors.
app.use('/api/auth', _authService.router);
// /api/tenants/* — same exemption from the API-key + owner gates as /api/auth.
// Logged-in users need to query/switch their own tenant memberships regardless
// of platform-owner status. Each route inside enforces its own auth check.
app.use('/api/tenants', _tenantRouter);
// Data-mode enforcement: wrap res.json on every /api response so fabricated
// data is either badged (demo) or replaced with an honest "data unavailable"
// message (strict). Wraps res.json at request start; reads the resolved
// tenant/client at flush time, so registration order is not sensitive.
// Identical behaviour in dev + prod (never NODE_ENV-gated).
app.use(require('./services/admin/enforcement').dataModeEnforcement);

// ── Client diagnostic beacon ─────────────────────────────────────────────────
// IGDiag mirrors every breadcrumb here so freezes / crashes that wipe the
// browser console still leave a server-side audit trail. Fire-and-forget,
// no auth, no body validation beyond truncation. Tiny payloads only.
// Diagnostics beacon routes → services/diag_beacon/routes.js
require('./services/diag_beacon/routes')(app, { express });

// ── Per-tenant kv-backed store helper (Task #49 Group B) ─────────────────────
// Replaces the legacy disk-file stores (goals, alerts, launches, drip, etc.).
// Each feature picks a base key; its data lives at `${base}:t<tid>` so one
// workspace can never read or overwrite another's. `_tkvMutate` serialises
// read-modify-write per (base,tid) via an in-process promise chain, mirroring
// the old per-file mutex. When the db is absent or tid is null the read/mutate
// returns the fallback and writes are no-ops (null tid never touches global).
const _tkvScope = require('./services/tenants/kv_scope');
const _tkvCtx   = require('./services/tenants/context');
const _dripUnsubscribe = require('./services/drips/unsubscribe');
const _tkvChain = new Map();
function _tkvFallback(fb) { return typeof fb === 'function' ? fb() : fb; }
async function _tkvRead(base, tid, fallback) {
  const _db = require('./db');
  if (!_db.hasDb() || tid == null) return _tkvFallback(fallback);
  const v = await _db.kvGet(_tkvScope.tkey(base, tid), undefined);
  return (v === undefined || v === null) ? _tkvFallback(fallback) : v;
}
async function _tkvWrite(base, tid, value) {
  const _db = require('./db');
  if (!_db.hasDb() || tid == null) return false;
  await _db.kvSet(_tkvScope.tkey(base, tid), value);
  return true;
}
async function _tkvMutate(base, tid, fallback, mutator) {
  const key = `${base}:t${tid}`;
  const prev = _tkvChain.get(key) || Promise.resolve();
  const run = prev.then(async () => {
    const cur = await _tkvRead(base, tid, fallback);
    const updated = await mutator(cur);
    if (updated !== undefined) await _tkvWrite(base, tid, updated);
    return updated;
  });
  _tkvChain.set(key, run.catch(() => {}));
  return run;
}

// ── Dashboard-diag capture/replay ────────────────────────────────────────────
// Save the full analysisData blob to disk so we can launch the dashboard
// directly from cached data (zero external API calls). Used by the temporary
// "Dashboard Diag" nav link to debug the post-render freeze quickly.
// Captures are stored per-workspace in kv: each capture at
// `diag_capture:t<tid>:<slug>` and a latest pointer at `diag_capture_latest:t<tid>`.
const _DIAG_CAP_PREFIX = 'diag_capture:';
const _DIAG_LATEST_KEY = 'diag_capture_latest';
// Diagnostics capture routes → services/diag_capture/routes.js
require('./services/diag_capture/routes')(app, { _DIAG_CAP_PREFIX, _DIAG_LATEST_KEY, _tkvCtx, _tkvRead, _tkvScope, _tkvWrite, express });

// ── Standalone login page ────────────────────────────────────────────────────
// Self-contained page (its own markup/styles/script — no app.js/data.js/public/js).
// This is the ONLY thing a logged-out visitor ever receives. Registered before
// the app-shell gate + express.static so it is always reachable. Authenticated
// visitors who land here are bounced into the app.
const _LOGIN_HTML_PATH = path.join(__dirname, 'login.html');
app.get(['/login', '/login.html'], (req, res) => {
  if (req.user) {
    // Already logged in (e.g. opening a verify-email link mid-session) — bounce
    // straight into the app, honoring a same-origin `next` so the user lands
    // back on the view they were on rather than the default dashboard. Validated
    // via the shared open-redirect guard before it reaches the redirect.
    const next = _authService.safeNext(req.query && req.query.next);
    return res.redirect(302, next && next !== '/' ? next : '/');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(_LOGIN_HTML_PATH);
});

// ── App-shell auth gate ──────────────────────────────────────────────────────
// Serve the app shell (index.html) and all app code ONLY to an authenticated
// session; anonymous requests for those assets are redirected to /login so the
// app's HTML/JS is never delivered to logged-out visitors. Mounted AFTER the
// session middleware (req.user is populated) and BEFORE the index.html route +
// express.static, so it wraps the versioned HTML serving rather than being
// bypassed by it. See services/auth_gate.
app.use(_authGate.appShellGate);

// ── Auto cache-busting for index.html ───────────────────────────────────────
// Serve index.html with every local .js/.css reference auto-versioned by its
// file content hash (see services/static_versioning). This retires the manual
// `?v=YYYYMMDD<TAG>` strings: editing any frontend file changes its hash, so the
// URL changes automatically and returning users always get the new bytes — with
// no manual bump and no stale-code bugs. Registered before express.static so the
// rewritten HTML wins over the raw on-disk file.
const _staticVersioning = require('./services/static_versioning');
const _serveIndexHtml = _staticVersioning.serveVersionedHtml(
  path.join(__dirname, 'index.html'),
  __dirname,
);
// When Next.js is the dev front door (NEXT_FRONT_DOOR=1, set by scripts/dev.js),
// Next owns `/` and renders the React dashboard shell, so Express must NOT serve
// the legacy SPA at the root. It still serves /index.html (and all assets/APIs)
// for the proxy. In prod (no flag) Express serves the SPA at `/` as before.
const _indexRoutes = process.env.NEXT_FRONT_DOOR === '1' ? ['/index.html'] : ['/', '/index.html'];
app.get(_indexRoutes, _serveIndexHtml);

// Fingerprinted static assets (.js/.css carrying a content-hash `?v=`) are
// served `public, max-age=31536000, immutable` via setHeaders so returning
// visitors skip re-downloading unchanged files (e.g. the 3.6 MB app.js). The
// hashed URL only appears when the bytes change, so this is always safe; HTML
// (no-cache) and API responses (no-store, set by the global middleware) are
// unaffected. See services/static_versioning.
// express.static is mounted on the project ROOT, so without a guard every file
// in the repo (server.js, db.js, services/**, package.json, docs/**, test/**,
// working .txt notes, …) would be web-reachable by path. The static guard
// restricts serving to an explicit allow-list of browser-facing assets; any
// other path falls through to a 404 instead of leaking backend source.
// See services/static_guard. (Distinct from the auth gate above, which hides
// the app shell/bundle behind login; this stops NON-app files being served at
// all.)
const _staticGuard = require('./services/static_guard');
const _serveStatic = express.static(path.join(__dirname), {
  etag: false,
  lastModified: false,
  setHeaders: _staticVersioning.setVersionedAssetHeaders,
});
app.use((req, res, next) => {
  if ((req.method === 'GET' || req.method === 'HEAD') && _staticGuard.isPublicStaticAsset(req.path)) {
    return _serveStatic(req, res, next);
  }
  return next();
});

// ── Auth gate for /api/* (production hardening) ──────────────────────────────
// When INFOGENIE_API_KEY is set, all /api/* requests must include it via:
//   Authorization: Bearer <key>  |  X-InfoGenie-Key: <key>  |  ?key=<key> (GET only)
// When the env var is unset (e.g. local dev), the middleware is a no-op so
// existing workflows keep working unchanged. Public routes (auth flow, signed
// webhooks, status pings) are allowlisted and stay open even when auth is on.
const _AUTH_PUBLIC_API_PATHS = [
  /^\/api\/auth\//,                  // session/token auth + OAuth callbacks
  /^\/api\/diag-beacon$/,            // client breadcrumb mirror — fire-and-forget
  /^\/api\/diag-capture/,            // dashboard-diag capture/replay (temp tool)
  /^\/api\/drips\/webhook\/resend$/, // Svix-signed inbound webhook
  /^\/api\/notify\/send$/,           // already gated by INFOGENIE_NOTIFY_SECRET
  /^\/api\/status$/,                 // global status
  /^\/api\/[^\/]+\/status$/,         // per-integration status pings
  /^\/api\/budget\/status$/,         // budget telemetry (useful pre-login)
  /^\/api\/seo-widget\/embed\/[^\/]+\.js$/, // public embed loader (T23)
  /^\/api\/seo-widget\/audit\/[^\/]+$/,     // public widget audit endpoint (T23, rate-limited)
  /^\/api\/conversion-boosters\/embed\/[^\/]+\.js$/, // public booster loader (T27)
  /^\/api\/conversion-boosters\/event\/[^\/]+$/,     // public event ping (T27, rate-limited)
  /^\/api\/conversion-boosters\/lead\/[^\/]+$/,      // public lead capture (T27, rate-limited)
  // Studio Pack — provider webhooks (verified by signature/shared-secret) + public renderers
  /^\/api\/whatsapp\/webhook$/,                      // Meta WhatsApp Cloud API (X-Hub-Signature-256 verified)
  /^\/api\/voice-caller\/webhook$/,                  // Vapi (shared-secret verified)
  /^\/api\/linksell\/stripe-webhook$/,               // Stripe (signature verified)
  /^\/api\/bookings\/slots\/[^\/]+$/,                // public slot list for /book/:slug
  /^\/api\/bookings\/book\/[^\/]+$/,                 // public booking submit (rate-limited)
  /^\/api\/linksell\/checkout\/[^\/]+$/,             // public Stripe checkout init (rate-limited)
  /^\/api\/linksell\/optin\/[^\/]+$/,                // public email opt-in  (rate-limited)
  /^\/api\/email-broadcast\/webhook$/,               // Resend Svix-signed broadcast events
  /^\/api\/studio\/case-study\/[^\/]+\/page$/,       // public share page for case studies (HTML render)
  /^\/api\/scroll-tracker\/event$/,                  // public scroll-depth ingest from rendered pages (rate-limited)
  /^\/api\/site-search\/event$/,                     // public site-search ingest from rendered pages (rate-limited)
  /^\/api\/landing-pages\/lead\/[^\/]+$/,            // T71 public lead capture (rate-limited)
  /^\/api\/landing-pages\/ab-view\/[^\/]+$/,         // T70 A/B view tracking
  /^\/api\/landing-pages\/ab-convert\/[^\/]+$/,      // T70 A/B conversion tracking
];

// Lightweight in-memory per-IP rate limiter for public Studio Pack POSTs.
// Sliding 60-second window, 20 requests/window/IP. Returns 429 if exceeded.
const _RL_WINDOW_MS = 60_000, _RL_MAX = 20;
const _rl = new Map();
function _rateLimitPublic(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const key = ip + '|' + req.path;
  const now = Date.now();
  const arr = (_rl.get(key) || []).filter(t => now - t < _RL_WINDOW_MS);
  if (arr.length >= _RL_MAX) return res.status(429).json({ ok:false, error:'rate_limited', retryAfterSec: Math.ceil(_RL_WINDOW_MS/1000) });
  arr.push(now); _rl.set(key, arr);
  next();
}
// Apply to public POST surfaces (cheap; never blocks dashboard usage)
const _RL_PATHS = [/^\/api\/bookings\/book\//, /^\/api\/linksell\/checkout\//, /^\/api\/linksell\/optin\//, /^\/api\/scroll-tracker\/event$/, /^\/api\/site-search\/event$/];
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  if (_RL_PATHS.some(rx => rx.test(req.path))) return _rateLimitPublic(req, res, next);
  next();
});
function _isApiPublic(p) { return _AUTH_PUBLIC_API_PATHS.some(rx => rx.test(p)); }
// API-gate: a request is allowed if EITHER
//   1. The path is in the public allowlist (auth endpoints, signed webhooks,
//      public embeds), OR
//   2. The request has a valid session cookie (req.user populated upstream), OR
//   3. The request carries the legacy INFOGENIE_API_KEY (kept as a fallback
//      for non-browser/programmatic clients).
// The historical "same-origin SPA bypass" is intentionally removed — the SPA
// must now authenticate like any other client.
// Phase 2F: extract API-key validation + principal/tenant injection. Runs
// BEFORE the public-path bypass so tenant-bound public routes (e.g.
// /api/*/status) that callers hit with a Bearer key still get req.tenant
// populated — previously the public bypass returned first and these routes
// would resolve to null tenant under enforcement=on.
async function _injectApiKeyAuth(req) {
  if (req.user) return;
  const expected = process.env.INFOGENIE_API_KEY;
  const supplied =
       (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || (req.headers['x-infogenie-key'] || '').trim()
    || (req.method === 'GET' ? String(req.query.key || '').trim() : '');
  if (!expected || !supplied || supplied !== expected) return;
  try {
    if (!global.__apiKeyPrincipal) {
      const _db = require('./db');
      if (_db.hasDb()) {
        const r = await _db.getPool().query(
          'SELECT id, email, name, is_owner FROM users WHERE is_owner = TRUE ORDER BY id ASC LIMIT 1');
        if (r.rows[0]) {
          const u = r.rows[0];
          global.__apiKeyPrincipal = { id: u.id, email: u.email, name: u.name, isOwner: true, viaApiKey: true };
        }
      }
      if (!global.__apiKeyPrincipal) {
        global.__apiKeyPrincipal = { id: 0, email: 'system@infogenie.local', name: 'API Key', isOwner: true, viaApiKey: true };
      }
    }
    req.user = global.__apiKeyPrincipal;
    req.viaApiKey = true;
    if (!req.tenant) {
      try {
        const _ctx = require('./services/tenants/context');
        const tid = await _ctx.getCronTenantId();
        if (tid) {
          req.tenant = { id: tid, name: 'API Key Default', slug: 'apikey', status: 'active' };
          global.__apiKeyTenantHits = (global.__apiKeyTenantHits || 0) + 1;
        } else {
          global.__apiKeyTenantMiss = (global.__apiKeyTenantMiss || 0) + 1;
          console.warn('[apikey] no default tenant resolvable — request proceeds without req.tenant');
        }
      } catch (e) {
        global.__apiKeyTenantMiss = (global.__apiKeyTenantMiss || 0) + 1;
        console.warn('[apikey] tenant injection failed:', e.message);
      }
    }
  } catch (_) { /* non-fatal */ }
}

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(); // only gate API
  // Always try API-key auth first — even on public paths — so tenant injection
  // happens regardless of which gate ultimately admits the request.
  await _injectApiKeyAuth(req);
  if (_isApiPublic(req.path)) return next();
  if (req.user) return next();                      // session OR api-key principal
  res.status(401).json({ ok:false, error:'auth_required',
    hint:'Log in via POST /api/auth/login, or include INFOGENIE_API_KEY via Authorization: Bearer / X-InfoGenie-Key / ?key= (GET only).' });
});

// ── Role → permission matrix enforcement ────────────────────────────────────
// The real server-side authorization boundary. Looks each authenticated /api/
// request up in services/tenants/permission_matrix.js and enforces the mapped
// permission via req.can() / req.permissions (set by loadTenantContext). Platform
// owners/admins bypass. Mounted BEFORE the admin mount so the Admin Portal is
// covered by the same single path. Rollout is staged via PERMISSION_ENFORCEMENT
// (off | shadow | on — defaults to 'shadow', which logs would-be denials without
// blocking so gaps surface before flipping to 'on').
app.use(_permEnforce.enforceMatrix);

// GET /api/_debug/permissions — owner-only observability for the permission
// rollout: current mode, allow/deny/shadow/unmapped counters, would-be denials
// per required key, and recent denial samples (actor id + route + key only —
// never request bodies or secrets). Mirrors /api/_debug/multitenant.
app.get('/api/_debug/permissions', (req, res) => {
  if (!req.user || req.user.isOwner !== true) {
    return res.status(403).json({ ok:false, error:'owner_only' });
  }
  res.json({ ok:true, ..._permEnforce.snapshot() });
});

// /api/admin/* — Admin Portal (workspaces, users, clients, data-mode, issues).
// Mounted AFTER the API-key/session auth gate (so req.user is populated for both
// session and api-key callers) but BEFORE the owner gate — platform admins who
// are not the deployment owner must still reach it. The router self-gates to
// platform_owner / platform_admin / isOwner internally.
app.use('/api/admin', require('./services/admin/api'));

// GET /api/data-mode/effective — non-admin-safe resolver returning the EFFECTIVE
// data mode (client → tenant → platform → strict) for the current request.
// Mounted before the owner gate so ANY authenticated user (not just owners) can
// read it; the frontend uses it to badge or withhold browser-generated
// estimates (e.g. data.js KPIs/trend). Changing the mode stays admin-only.
// Data-mode effective routes → services/data_mode/routes.js
require('./services/data_mode/routes')(app, {});

// ── Owner-only gate for legacy global data ──────────────────────────────────
// Until per-row user_id migration ships, all existing global tables/files are
// treated as belonging to the deployment owner (the first signup). Any
// additional accounts that sign up authenticate fine but get a 403 on legacy
// data routes — effectively an "empty workspace" until multi-tenant data
// scoping is implemented. The owner principal synthesized for API-key auth
// (above) carries isOwner=true, so programmatic clients are unaffected.
const _OWNER_GATE_ALLOW = [
  /^\/api\/auth\//,                  // own profile + logout etc.
  /^\/api\/status$/,                 // health
  /^\/api\/[^\/]+\/status$/,         // per-integration health pings
  /^\/api\/ad-platforms\/status$/,   // per-user ad-platform connection status
  /^\/api\/credentials\//,           // per-user credential vault + smoke tests
  /^\/api\/integrations\/google-ads\//, // per-user Google Ads Connect OAuth flow
  /^\/api\/integrations\/meta-ads\//,   // per-user Meta Ads Connect OAuth flow
];
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (_OWNER_GATE_ALLOW.some(rx => rx.test(req.path))) return next();
  if (!req.user) return next();              // API-key path already mapped to owner
  if (req.user.isOwner === true) return next();
  return res.status(403).json({
    ok: false, error: 'owner_only',
    hint: 'This workspace data belongs to the deployment owner. Multi-user data scoping is not yet enabled.',
  });
});

// ── Per-provider budget caps (cost-abuse protection) ────────────────────────
// Tracks calls per IP per day and globally per day. Resets at UTC midnight.
// Only enforced when INFOGENIE_API_KEY is set (i.e. paired with auth gate).
// Per-provider override via env: BUDGET_LIMIT_GEMINI_IP=200, BUDGET_LIMIT_GEMINI_GLOBAL=5000
const _budget = Object.create(null);
function _todayUtc() { return new Date().toISOString().slice(0,10); }
function _budgetLimits(provider) {
  const up = provider.toUpperCase();
  return {
    ip:     +(process.env[`BUDGET_LIMIT_${up}_IP`])     || 50,
    global: +(process.env[`BUDGET_LIMIT_${up}_GLOBAL`]) || 2000,
  };
}
function _chargeBudget(provider, ip) {
  if (!process.env.INFOGENIE_API_KEY) return;       // budgets only enforced when auth is on
  const day = _todayUtc();
  const lim = _budgetLimits(provider);
  const slot = (_budget[provider] = _budget[provider] || { day, global:0, perIp:{} });
  if (slot.day !== day) { slot.day = day; slot.global = 0; slot.perIp = {}; }
  const ipKey = String(ip || 'unknown');
  const ipCount = slot.perIp[ipKey] || 0;
  if (slot.global >= lim.global || ipCount >= lim.ip) {
    const err = new Error(`budget_exceeded:${provider}`);
    err.status = 429; err.retryAfter = 3600;
    throw err;
  }
  slot.global += 1;
  slot.perIp[ipKey] = ipCount + 1;
}
function _budgetSnapshot() {
  const day = _todayUtc();
  const out = {};
  for (const p of Object.keys(_budget)) {
    const s = _budget[p];
    out[p] = (s.day === day)
      ? { day:s.day, global:s.global, uniqueIps:Object.keys(s.perIp).length, limits:_budgetLimits(p) }
      : { day, global:0, uniqueIps:0, limits:_budgetLimits(p) };
  }
  return out;
}
function _send429IfBudget(res, err) {
  if (err && err.status === 429 && /^budget_exceeded:/.test(err.message)) {
    res.setHeader('Retry-After', String(err.retryAfter || 3600));
    res.status(429).json({ ok:false, error: err.message,
      hint:'Daily budget for this provider exhausted. Override via env BUDGET_LIMIT_*_IP / _GLOBAL.' });
    return true;
  }
  return false;
}
// Budget status · manual/backup downloads routes → services/budget_ops/routes.js
require('./services/budget_ops/routes')(app, { _budgetSnapshot, fs, path });

// ── Brand Creatives upload setup ──────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'creatives');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Serve uploaded files publicly
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { etag: false, lastModified: false }));

// Creative uploads · config routes → services/creatives/routes.js
require('./services/creatives/routes')(app, { UPLOADS_DIR, fs, multer, path });

// ── Generic HTTPS helper ──────────────────────────────────────────────────────
function callHttpsGeneric(hostname, path, method, body, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const data = body || '';
    const opts = {
      hostname, path, method: method || 'GET',
      headers: { 'Content-Length': Buffer.byteLength(data), ...headers }
    };
    const req = https.request(opts, res => {
      let out = '';
      res.on('data', d => out += d);
      res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Request timed out')); });
    if (data) req.write(data);
    req.end();
  });
}

// ── Ad platform connection status ─────────────────────────────────────────────
// Per-user (vault) for the calling user; owners additionally see env-var fallback.
// Ad-platform & credential status routes → services/platform_status/routes.js
require('./services/platform_status/routes')(app, { _credentialsVault, callHttpsGeneric });

// ── Google Ads campaign launch ────────────────────────────────────────────────
app.post('/api/launch/google-ads', async (req, res) => {
  const { campaignName, budget, startDate, objective = 'performance', campaignType: campaignTypeRaw } = req.body;
  const isAwareness = String(objective).toLowerCase().includes('awareness') || String(objective).toLowerCase().includes('brand');

  // Map UI campaignType → Google Ads advertisingChannelType + bidding strategy.
  // Accepts: 'search' | 'display' | 'video' | 'shopping' | 'pmax' | 'demand_gen'.
  // Falls back to awareness-driven SEARCH/DISPLAY split for older callers that
  // only sent `objective`.
  const ctRaw = String(campaignTypeRaw || '').toLowerCase().replace(/[\s_-]/g, '');
  const CT_MAP = {
    search:       { channel: 'SEARCH',          bid: { manualCpc: { enhancedCpcEnabled: false } } },
    display:      { channel: 'DISPLAY',         bid: { targetCpm: {} } },
    video:        { channel: 'VIDEO',           bid: { targetCpm: {} } },
    youtube:      { channel: 'VIDEO',           bid: { targetCpm: {} } },
    shopping:     { channel: 'SHOPPING',        bid: { manualCpc: { enhancedCpcEnabled: true } }, needsMerchant: true },
    pmax:         { channel: 'PERFORMANCE_MAX', bid: { maximizeConversions: {} } },
    performancemax:{ channel: 'PERFORMANCE_MAX', bid: { maximizeConversions: {} } },
    demandgen:    { channel: 'DEMAND_GEN',      bid: { maximizeConversions: {} } },
  };
  const ct = CT_MAP[ctRaw] || (isAwareness
    ? { channel: 'DISPLAY', bid: { targetCpm: {} } }
    : { channel: 'SEARCH',  bid: { manualCpc: { enhancedCpcEnabled: false } } });
  const merchantId = process.env.GOOGLE_MERCHANT_CENTER_ID;
  if (ct.needsMerchant && !merchantId) {
    return res.json({ success: false, error: 'Shopping campaigns require a Google Merchant Center account. Add GOOGLE_MERCHANT_CENTER_ID in Settings and verify your product feed at merchants.google.com.' });
  }
  const _gaResolved = await _credentialsVault.resolveGoogleAdsCredentials(req.user && req.user.id ? req.user.id : null);
  if (!_gaResolved.ok)
    return res.json({ success: false, error: _gaResolved.error });
  const { devToken, clientId, clientSecret, refreshToken, customerId, loginCustomerId } = _gaResolved.creds;

  try {
    // 1. Exchange refresh token for access token
    const tokenBody = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`;
    const tokenRaw = await callHttpsGeneric('oauth2.googleapis.com', '/token', 'POST', tokenBody, { 'Content-Type': 'application/x-www-form-urlencoded' });
    const tokenData = JSON.parse(tokenRaw);
    if (!tokenData.access_token) throw new Error('OAuth token refresh failed: ' + (tokenData.error_description || tokenData.error || 'unknown'));
    const accessToken = tokenData.access_token;

    const cleanId = String(customerId).replace(/-/g, '');
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'developer-token': devToken };
    if (loginCustomerId) authHeaders['login-customer-id'] = String(loginCustomerId).replace(/-/g, '');

    // 2. Create campaign budget
    const dailyMicros = String(Math.round((parseInt(String(budget).replace(/[^0-9]/g,'')) || 2000) * 1e6 / 30));
    const budgetRaw = await callHttpsGeneric('googleads.googleapis.com',
      `/v16/customers/${cleanId}/campaignBudgets:mutate`, 'POST',
      JSON.stringify({ operations: [{ create: { name: campaignName + ' Budget', amountMicros: dailyMicros, deliveryMethod: 'STANDARD' } }] }),
      authHeaders);
    const budgetData = JSON.parse(budgetRaw);
    if (!budgetData.results) throw new Error('Budget creation failed: ' + JSON.stringify(budgetData.partialFailureError || budgetData));

    // 3. Create campaign
    const sd = startDate ? startDate.replace(/-/g, '') : new Date().toISOString().split('T')[0].replace(/-/g, '');
    const campRaw = await callHttpsGeneric('googleads.googleapis.com',
      `/v16/customers/${cleanId}/campaigns:mutate`, 'POST',
      JSON.stringify({ operations: [{ create: Object.assign({
        name: campaignName, status: 'PAUSED',
        advertisingChannelType: ct.channel,
        campaignBudget: budgetData.results[0].resourceName, startDate: sd,
      }, ct.bid, ct.needsMerchant ? { shoppingSetting: { merchantId: String(merchantId), salesCountry: 'US' } } : {}
      ) }] }), authHeaders);
    const campData = JSON.parse(campRaw);
    if (!campData.results) throw new Error('Campaign creation failed: ' + JSON.stringify(campData));
    const campaignId = campData.results[0].resourceName.split('/').pop();

    // Register with optimizer (best-effort)
    let optimizerEnabled = true;
    try {
      const dailyBud = (parseInt(String(budget).replace(/[^0-9]/g,'')) || 2000) / 30;
      const _tid = await _tkvCtx.resolveTenantId(req, { label: 'launch:google' });
      await _db.getPool().query(`
        INSERT INTO ad_campaigns (tenant_id, platform, platform_camp_id, name, daily_budget, status, optimizer_enabled)
        VALUES ($4, 'google', $1, $2, $3, 'paused', TRUE)
        ON CONFLICT (tenant_id, platform, platform_camp_id) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
      `, [String(campaignId), campaignName, dailyBud, _tid]);
    } catch (_e) {
      optimizerEnabled = false;
      console.error('[Google Ads launch] optimizer registration failed:', _e.message);
    }
    try { const { ingestMemoryNode } = require('./services/knowledge_graph/api'); ingestMemoryNode({ tenant_id: _tid, node_type: 'campaign_result', summary: `Campaign "${campaignName}" launched on Google Ads (ID: ${campaignId}). Budget: $${dailyBud}/day.`, detail: { platform: 'google', campaignId, budget: dailyBud, status: 'paused' }, source_ref: `campaign:google:${campaignId}`, importance: 0.7 }).catch(() => {}); } catch (_) {}
    res.json({
      success: true, platform: 'Google Ads', campaignId, status: 'PAUSED',
      optimizerEnabled,
      optimizerWarning: optimizerEnabled ? null : 'Campaign was created on Google Ads, but it could not be added to the AI Optimizer, so automatic optimization is not running. Retry the launch or check your workspace, then re-launch to enable it.',
      message: `Campaign "${campaignName}" created in Google Ads (ID: ${campaignId}). It's paused — activate it in your Google Ads dashboard.`
        + (optimizerEnabled ? '' : ' ⚠️ Automatic optimization could not be enabled — this campaign won\'t be auto-managed by the AI Optimizer.'),
      dashboardUrl: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}`
    });
  } catch(e) {
    console.error('[Google Ads launch]', e.message);
    // Map common OAuth/API errors to actionable messages
    let friendlyError = e.message;
    if (e.message.includes('client was not found') || e.message.includes('invalid_client')) {
      friendlyError = 'Google Ads OAuth client not found — your Client ID or Client Secret is incorrect. Update them in Settings → Google Ads.';
    } else if (e.message.includes('invalid_grant') || e.message.includes('Token has been expired')) {
      friendlyError = 'Google Ads refresh token expired — re-authorise your account in Settings → Google Ads.';
    } else if (e.message.includes('PERMISSION_DENIED') || e.message.includes('not authorized')) {
      friendlyError = 'Google Ads permission denied — ensure your developer token and customer ID are correct in Settings.';
    }
    res.json({ success: false, error: friendlyError });
  }
});

// ── Meta Marketing API campaign launch ───────────────────────────────────────
app.post('/api/launch/meta', async (req, res) => {
  const { campaignName, budget, objective: objectiveOpt = 'performance' } = req.body;
  const metaObjective = (String(objectiveOpt).toLowerCase().includes('awareness') ||
                         String(objectiveOpt).toLowerCase().includes('brand'))
    ? 'OUTCOME_AWARENESS'   // optimised for reach + CPM + video-completion
    : 'OUTCOME_TRAFFIC';    // default — clicks → conversions
  const _metaResolved = await _credentialsVault.resolveMetaAdsCredentials(req.user && req.user.id ? req.user.id : null);
  if (!_metaResolved.ok)
    return res.json({ success: false, error: _metaResolved.error });
  const { accessToken, adAccountId } = _metaResolved.creds;

  try {
    const cleanToken  = String(accessToken).trim();
    const cleanAccId  = String(adAccountId).trim().replace(/\s/g, '');
    const dailyCents  = String(Math.round((parseInt(String(budget).replace(/[^0-9]/g,'')) || 2000) * 100 / 30));
    const accountId   = cleanAccId.startsWith('act_') ? cleanAccId : 'act_' + cleanAccId;
    const params      = new URLSearchParams({
      name: campaignName, objective: metaObjective, status: 'PAUSED',
      daily_budget: dailyCents, special_ad_categories: '[]', access_token: cleanToken
    });
    const campRaw  = await callHttpsGeneric('graph.facebook.com', `/v19.0/${accountId}/campaigns`, 'POST', params.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    const campData = JSON.parse(campRaw);
    if (campData.error) throw new Error(campData.error.message || 'Meta API error');
    if (!campData.id)   throw new Error('No campaign ID returned from Meta');

    let optimizerEnabled = true;
    try {
      const dailyBud = (parseInt(String(budget).replace(/[^0-9]/g,'')) || 2000) / 30;
      const _tid = await _tkvCtx.resolveTenantId(req, { label: 'launch:meta' });
      await _db.getPool().query(`
        INSERT INTO ad_campaigns (tenant_id, platform, platform_camp_id, name, daily_budget, status, optimizer_enabled)
        VALUES ($4, 'meta', $1, $2, $3, 'paused', TRUE)
        ON CONFLICT (tenant_id, platform, platform_camp_id) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
      `, [String(campData.id), campaignName, dailyBud, _tid]);
    } catch (_e) {
      optimizerEnabled = false;
      console.error('[Meta launch] optimizer registration failed:', _e.message);
    }
    try { const { ingestMemoryNode } = require('./services/knowledge_graph/api'); ingestMemoryNode({ tenant_id: _tid, node_type: 'campaign_result', summary: `Campaign "${campaignName}" launched on Meta Ads (ID: ${campData.id}). Budget: $${dailyBud}/day.`, detail: { platform: 'meta', campaignId: campData.id, budget: dailyBud, status: 'paused' }, source_ref: `campaign:meta:${campData.id}`, importance: 0.7 }).catch(() => {}); } catch (_) {}
    res.json({
      success: true, platform: 'Meta Ads', campaignId: campData.id, status: 'PAUSED',
      optimizerEnabled,
      optimizerWarning: optimizerEnabled ? null : 'Campaign was created on Meta Ads, but it could not be added to the AI Optimizer, so automatic optimization is not running. Retry the launch or check your workspace, then re-launch to enable it.',
      message: `Campaign "${campaignName}" created in Meta Ads Manager (ID: ${campData.id}). Add an Ad Set and Ads in Business Manager to go live.`
        + (optimizerEnabled ? '' : ' ⚠️ Automatic optimization could not be enabled — this campaign won\'t be auto-managed by the AI Optimizer.'),
      dashboardUrl: `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAccountId}&selected_campaign_ids=${campData.id}`
    });
  } catch(e) {
    console.error('[Meta launch]', e.message);
    let friendlyError = e.message;
    if (e.message.includes('OAuthException') || e.message.includes('Invalid OAuth') || e.message.includes('access token')) {
      friendlyError = 'Meta access token invalid or expired — update it in Settings → Meta Ads Manager.';
    } else if (e.message.includes('permission') || e.message.includes('#200')) {
      friendlyError = 'Meta API permission denied — ensure your access token has ads_management permission.';
    }
    res.json({ success: false, error: friendlyError });
  }
});

// ── Microsoft Ads (Bing) campaign launch ─────────────────────────────────────
// Mirrors the Google/Meta/TikTok launch shape. Accepts an optional `objective`
// of 'performance' (default — sales/leads) or 'brand-awareness' (reach/CPM).
app.post('/api/launch/microsoft-ads', async (req, res) => {
  const { campaignName, budget, objective = 'performance' } = req.body || {};
  const need = ['MICROSOFT_ADS_DEVELOPER_TOKEN','MICROSOFT_ADS_CLIENT_ID','MICROSOFT_ADS_CLIENT_SECRET',
                'MICROSOFT_ADS_REFRESH_TOKEN','MICROSOFT_ADS_CUSTOMER_ID','MICROSOFT_ADS_ACCOUNT_ID'];
  for (const k of need) if (!process.env[k]) return res.json({ success:false, error:`Microsoft Ads credentials not configured — set ${k} in Settings → Microsoft Ads.` });

  try {
    const tokRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_ADS_CLIENT_ID,
        client_secret: process.env.MICROSOFT_ADS_CLIENT_SECRET,
        refresh_token: process.env.MICROSOFT_ADS_REFRESH_TOKEN,
        grant_type:'refresh_token',
        scope:'https://ads.microsoft.com/msads.manage offline_access',
      }).toString(),
    });
    const tj = await tokRes.json();
    if (!tj.access_token) throw new Error('Microsoft Ads OAuth failed: ' + (tj.error_description || tj.error || 'unknown'));

    // Bing's Campaign Management API is SOAP-only. We use the JSON endpoint
    // exposed via the bingads-server bridge — same hostname, REST flavour.
    const dailyBud = Math.max(5, Math.round((parseInt(String(budget).replace(/[^0-9]/g,'')) || 2000) / 30));
    const headers = {
      'Authorization':     `Bearer ${tj.access_token}`,
      'DeveloperToken':    process.env.MICROSOFT_ADS_DEVELOPER_TOKEN,
      'CustomerId':        process.env.MICROSOFT_ADS_CUSTOMER_ID,
      'CustomerAccountId': process.env.MICROSOFT_ADS_ACCOUNT_ID,
      'Content-Type':      'application/json',
    };
    const isAwareness = String(objective).toLowerCase().includes('awareness') || String(objective).toLowerCase().includes('brand');
    const campPayload = {
      Campaigns: [{
        Name: campaignName,
        DailyBudget: dailyBud,
        BudgetType: 'DailyBudgetStandard',
        Status: 'Paused',
        TimeZone: 'PacificTimeUSCanadaTijuana',
        CampaignType: 'Search',
        // Brand awareness → TargetImpressionShare (Bing's reach-style scheme,
        // bids for top-of-page placement). Performance → MaxConversions
        // (Bing's standard Smart Bidding for sales/leads).
        BiddingScheme: isAwareness
          ? { Type: 'TargetImpressionShare', TargetImpressionShare: 65, TargetAdPosition: 'TopOfPage', MaxCpc: { Amount: 5 } }
          : { Type: 'MaxConversions' },
        Settings: [],
      }],
    };
    const campRes = await fetch('https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/Campaigns', {
      method:'POST', headers, body: JSON.stringify(campPayload),
    });
    const cj = await campRes.json().catch(() => ({}));
    const newId = cj?.CampaignIds?.[0] || cj?.Campaigns?.[0]?.Id;
    if (!newId) {
      const errMsg = cj?.PartialErrors?.[0]?.Message || cj?.error?.message || `Bing Ads error (${campRes.status})`;
      throw new Error(errMsg);
    }

    let optimizerEnabled = true;
    try {
      const _tid = await _tkvCtx.resolveTenantId(req, { label: 'launch:microsoft' });
      await _db.getPool().query(`
        INSERT INTO ad_campaigns (tenant_id, platform, platform_camp_id, name, daily_budget, status, optimizer_enabled)
        VALUES ($4, 'microsoft', $1, $2, $3, 'paused', TRUE)
        ON CONFLICT (tenant_id, platform, platform_camp_id) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
      `, [String(newId), campaignName, dailyBud, _tid]);
    } catch (_e) {
      optimizerEnabled = false;
      console.error('[Microsoft Ads launch] optimizer registration failed:', _e.message);
    }

    try { const { ingestMemoryNode } = require('./services/knowledge_graph/api'); ingestMemoryNode({ tenant_id: _tid, node_type: 'campaign_result', summary: `Campaign "${campaignName}" launched on Microsoft Ads (ID: ${newId}). Budget: $${dailyBud}/day.`, detail: { platform: 'microsoft', campaignId: newId, budget: dailyBud, status: 'paused' }, source_ref: `campaign:microsoft:${newId}`, importance: 0.7 }).catch(() => {}); } catch (_) {}
    res.json({
      success: true, platform: 'Microsoft Ads', campaignId: newId, status: 'PAUSED',
      optimizerEnabled,
      optimizerWarning: optimizerEnabled ? null : 'Campaign was created on Microsoft Ads, but it could not be added to the AI Optimizer, so automatic optimization is not running. Retry the launch or check your workspace, then re-launch to enable it.',
      message: `Campaign "${campaignName}" created in Microsoft Advertising (ID: ${newId}). It's paused — open the dashboard to add ad groups, ads and keywords, then activate.`
        + (optimizerEnabled ? '' : ' ⚠️ Automatic optimization could not be enabled — this campaign won\'t be auto-managed by the AI Optimizer.'),
      dashboardUrl: `https://ui.ads.microsoft.com/campaign/vnext/campaigns?customerId=${process.env.MICROSOFT_ADS_CUSTOMER_ID}&aid=${process.env.MICROSOFT_ADS_ACCOUNT_ID}`,
    });
  } catch (e) {
    console.error('[Microsoft Ads launch]', e.message);
    let friendlyError = e.message;
    if (/oauth|invalid_grant|refresh/i.test(e.message)) friendlyError = 'Microsoft Ads OAuth failed — your refresh token has expired. Re-authorise in Settings → Microsoft Ads.';
    else if (/developer\s*token|forbidden/i.test(e.message)) friendlyError = 'Microsoft Ads developer token missing or unapproved — apply at developers.ads.microsoft.com/Account.';
    res.json({ success: false, error: friendlyError });
  }
});

// ── TikTok Ads campaign launch ────────────────────────────────────────────────
app.post('/api/launch/tiktok', async (req, res) => {
  const { campaignName, budget } = req.body;
  const cleanAdvertiserId = _tiktokAdvertiserId();
  const accessToken  = _cleanSecret(process.env.TIKTOK_ACCESS_TOKEN || '');

  if (!cleanAdvertiserId || !accessToken)
    return res.json({ success: false, error: 'TikTok credentials not configured — connect them in Settings → TikTok Ads.' });

  try {
    const dailyBudget = Math.max(Math.round((parseInt(String(budget).replace(/[^0-9]/g,'')) || 2000) / 30), 50);
    const payload = JSON.stringify({
      advertiser_id: cleanAdvertiserId, campaign_name: campaignName,
      objective_type: 'TRAFFIC', budget_mode: 'BUDGET_MODE_DAY',
      budget: dailyBudget, operation_status: 'DISABLE'
    });
    const campRaw  = await callHttpsGeneric('business-api.tiktok.com', '/open_api/v1.3/campaign/create/', 'POST', payload, { 'Content-Type': 'application/json', 'Access-Token': accessToken });
    const campData = JSON.parse(campRaw);
    if (campData.code !== 0) throw new Error(campData.message || 'TikTok error code ' + campData.code);
    const campaignId = campData.data && campData.data.campaign_id;

    let optimizerEnabled = true;
    try {
      const dailyBud = Math.max((parseInt(String(budget).replace(/[^0-9]/g,'')) || 2000) / 30, 50);
      const _tid = await _tkvCtx.resolveTenantId(req, { label: 'launch:tiktok' });
      await _db.getPool().query(`
        INSERT INTO ad_campaigns (tenant_id, platform, platform_camp_id, name, daily_budget, status, optimizer_enabled)
        VALUES ($4, 'tiktok', $1, $2, $3, 'paused', TRUE)
        ON CONFLICT (tenant_id, platform, platform_camp_id) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
      `, [String(campaignId), campaignName, dailyBud, _tid]);
    } catch (_e) {
      optimizerEnabled = false;
      console.error('[TikTok launch] optimizer registration failed:', _e.message);
    }
    try { const { ingestMemoryNode } = require('./services/knowledge_graph/api'); ingestMemoryNode({ tenant_id: _tid, node_type: 'campaign_result', summary: `Campaign "${campaignName}" launched on TikTok Ads (ID: ${campaignId}). Budget: $${dailyBud}/day.`, detail: { platform: 'tiktok', campaignId, budget: dailyBud, status: 'paused' }, source_ref: `campaign:tiktok:${campaignId}`, importance: 0.7 }).catch(() => {}); } catch (_) {}
    res.json({
      success: true, platform: 'TikTok Ads', campaignId, status: 'DISABLED',
      optimizerEnabled,
      optimizerWarning: optimizerEnabled ? null : 'Campaign was created on TikTok Ads, but it could not be added to the AI Optimizer, so automatic optimization is not running. Retry the launch or check your workspace, then re-launch to enable it.',
      message: `Campaign "${campaignName}" created in TikTok Ads Manager (ID: ${campaignId}). Enable it and add an Ad Group in TikTok Business Center.`
        + (optimizerEnabled ? '' : ' ⚠️ Automatic optimization could not be enabled — this campaign won\'t be auto-managed by the AI Optimizer.'),
      dashboardUrl: `https://ads.tiktok.com/i18n/perf/campaign?aadvid=${cleanAdvertiserId}`
    });
  } catch(e) {
    console.error('[TikTok launch]', e.message);
    let friendlyError = e.message;
    if (e.message.includes('access_token') || e.message.includes('Unauthorized') || e.message.includes('40001')) {
      friendlyError = 'TikTok access token invalid or expired — update it in Settings → TikTok Ads.';
    }
    res.json({ success: false, error: friendlyError });
  }
});

// ── AI 90-Day Revenue Forecast ────────────────────────────────────────────────
// ── /api/ai-quick — tiny single-shot prompt → text (used by AI Suggest buttons across the UI)
// Returns { ok:true, text: "..." }. Never fabricates: if no real OpenAI key, returns ok:false with reason.
// AI quick · forecast · budget-efficiency · counter-message routes → services/ai_quick_tools/routes.js
require('./services/ai_quick_tools/routes')(app, { anthropic, openai });

// ── Competitor Ad Spend (DataForSEO paid traffic value) ───────────────────────
app.post('/api/competitor-spend', async (req, res) => {
  const { domains = [], names = [], yourDomain = '', yourBudget = 5000 } = req.body;
  if (!domains.length) return res.json({ success: false, error: 'No domains provided' });

  const clean = d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  const allDomains = [yourDomain, ...domains].filter(Boolean).map(clean).slice(0, 7);

  const results = await Promise.all(allDomains.map(async domain => {
    try {
      const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [{ target: domain }], 10000);
      const item = raw?.tasks?.[0]?.result?.[0]?.items?.[0];
      const paid = item?.metrics?.paid;
      const organic = item?.metrics?.organic;
      // paid.etv = estimated monthly value of paid search traffic ≈ ad spend
      const paidEtv   = paid ? Math.round(paid.etv || 0) : 0;
      const paidCount = paid ? (paid.count || 0) : 0;
      const orgEtv    = organic ? Math.round(organic.etv || 0) : 0;
      const orgCount  = organic ? (organic.count || 0) : 0;
      // Three-tier estimation, most-accurate first:
      //  1. paid.etv  — DataForSEO's direct estimate of monthly paid spend
      //  2. paid.count × $2.50 CPC × 5% CTR × 30d — when ETV is 0 but the
      //     domain ranks for paid keywords (count is tracked even when click
      //     volumes are too low for ETV)
      //  3. organic.etv × 8% — industry benchmark: brands with significant
      //     organic presence almost always invest ~5-15% of that value in
      //     paid amplification (defensive bidding on brand terms, retargeting,
      //     competitive keywords). Capped at $3M/mo to avoid overstatement
      //     for mega-domains. ALWAYS produces a non-zero value when the
      //     domain has any organic footprint, so the chart never shows blanks
      //     for real businesses just because their paid presence is too small
      //     for DataForSEO's keyword sample.
      let adSpend = 0;
      let source = 'fallback';
      if (paidEtv > 0) {
        adSpend = paidEtv;
        source = 'DataForSEO-ETV';
      } else if (paidCount > 0) {
        adSpend = Math.round(paidCount * 2.5 * 0.05 * 30);
        source = 'DataForSEO-Est';
      } else if (orgEtv > 0) {
        adSpend = Math.min(Math.round(orgEtv * 0.08), 3_000_000);
        source = 'DataForSEO-Organic-Est';
      } else if (orgCount > 0) {
        // Last resort: organic keyword count × tiny CPC. A single non-zero
        // value is better than a blank bar — clearly flagged as estimated.
        adSpend = Math.round(orgCount * 1.5 * 0.03 * 30);
        source = 'DataForSEO-OrgKw-Est';
      }
      return { domain, adSpend, paidKeywords: paidCount, organicKeywords: orgCount, source };
    } catch(e) {
      return { domain, adSpend: 0, source: 'fallback' };
    }
  }));

  // ── AI knowledge-based fallback for any domain DataForSEO returned 0 for ──
  // DataForSEO's keyword-sample approach genuinely has no data for many real
  // brands (regional / niche / thin SEO presence). Rather than show a blank
  // bar, batch-query GPT-4o-mini for monthly ad-spend estimates — the model
  // has strong knowledge of well-known brands (Plus500, AvaTrade, XM, FxPro,
  // IG, etc.) from public Similarweb/SemRush/earnings-report data. Single
  // batched call → ~1-2s extra latency, but every competitor ends up with a
  // realistic, knowledge-grounded number instead of a missing bar.
  // Build domain→brandName map from the names[] param so the AI gets full context
  // (e.g. "ig.com (IG Markets)" instead of just "ig.com").
  const _nameMap = {};
  domains.forEach((d, i) => { if (names[i]) _nameMap[clean(d)] = names[i]; });

  // Threshold: 50 000 — any domain where DataForSEO returned less than $50K/mo
  // gets AI enrichment. DataForSEO's keyword-sample systematically understates
  // brands that invest heavily in display/programmatic (e.g. IG Markets, OANDA).
  const zeroDomains = results.filter(r => !r.adSpend || r.adSpend < 50_000);
  if (zeroDomains.length > 0 && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    try {
      const aiList = zeroDomains.map((r, i) => {
        const brand = _nameMap[r.domain];
        return `${i+1}. ${r.domain}${brand ? ` (${brand})` : ''}`;
      }).join('\n');
      const completion = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        max_tokens: 600,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role:'system', content:'You are a senior digital-marketing analyst with deep knowledge of monthly paid-media spend for public brands and digital businesses, drawn from Similarweb, SemRush, company earnings reports, and industry benchmarks. Always return realistic numbers grounded in what you actually know — never fabricate. For obscure brands, return a conservative industry-benchmark estimate.' },
          { role:'user',   content:
`Estimate monthly Google + Meta + TikTok + LinkedIn ad-spend (USD) for each of the domains below. Return JSON:
{"results":[{"domain":"<exact>","adSpend": <integer USD/month>, "confidence":"high|medium|low"}, ...]}

Realistic ranges to anchor against:
- Mega-brand fintech / forex broker (Plus500, eToro, IG, OANDA): $500K–$5M/mo
- Mid-tier broker / SaaS (XM, AvaTrade, FxPro, Pepperstone, Exness): $200K–$1.5M/mo
- Smaller regional broker / niche SaaS: $20K–$200K/mo
- Tiny / unknown domain: $1K–$20K/mo (low confidence)

Domains:
${aiList}

Return ONLY the JSON object, no prose.` }
        ],
      });
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
      const byDomain = {};
      (parsed.results || []).forEach(r => {
        if (r && r.domain && typeof r.adSpend === 'number' && r.adSpend > 0) {
          byDomain[r.domain.toLowerCase().trim()] = r;
        }
      });
      results.forEach(r => {
        if (r.adSpend && r.adSpend >= 50_000) return;
        const k = r.domain.toLowerCase().trim();
        const v = byDomain[k];
        if (v) {
          r.adSpend = Math.round(v.adSpend);
          r.source  = 'AI-estimate-' + (v.confidence || 'low');
        }
      });
    } catch(e) {
      console.warn('competitor-spend AI fallback failed:', e.message);
      // Non-fatal — chart's frontend traffic-derived floor is the next safety net
    }
  }

  // First entry is "you", rest are competitors
  const yourSpend = results[0]?.adSpend || yourBudget;
  const compSpend = results.slice(1);
  res.json({ success: true, yourDomain: allDomains[0], yourSpend, competitors: compSpend });
});

// ── Integrations status (which env vars are configured) ───────────────────────
// Integrations status · OpenAI passthrough routes → services/integrations_status/routes.js
require('./services/integrations_status/routes')(app, { openai });

// ── DataForSEO helpers ────────────────────────────────────────────────────────

function getDataForSEOAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

async function callDataForSEO(endpoint, body, timeoutMs = 18000) {
  const auth = getDataForSEOAuth();
  if (!auth) throw new Error('DataForSEO credentials not configured');

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.dataforseo.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (apiRes) => {
      let raw = '';
      apiRes.on('data', chunk => { raw += chunk; });
      apiRes.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch(e) {
          reject(new Error('Invalid JSON from DataForSEO'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('DataForSEO request timed out')); });
    req.write(data);
    req.end();
  });
}

// ── Competitor domain map (used when user doesn't specify) ───────────────────

// ── Reusable filter: aggregator / news / review / info domains we never want
//    to surface as a "competitor". Used by both /api/smart-detect and
//    /api/sector-competitors as a belt-and-braces post-AI scrub so a domain
//    like investopedia.com or bloomberg.com can never end up on the list
//    even if the LLM slips it through.
const INFO_SITE_PATTERN = /^(?:[a-z]{2}\.)?(investopedia|investing|forexbrokers|stockbrokers|bestbrokers|tradingpedia|brokersview|brokerchooser|brokernotes|comparison|comparis|nerdwallet|wisebread|smallworldfs|metatrader[0-9]?|tradingview|myfxbook|fxstreet|tradingeconomics|babypips|dailyfx|investorjunkie|fool|reuters|cnbc|bloomberg|forbes|nytimes|wsj|techcrunch|theverge|wired|mashable|venturebeat|crunchbase|g2|capterra|getapp|trustpilot|sitejabber|glassdoor|wikipedia)\.[a-z.]+$/i;

// Keyword gap · domain · competitor metrics · SOV routes → services/competitor_metrics/routes.js
require('./services/competitor_metrics/routes')(app, { callDataForSEO, openaiChatWithRetry });

// ── RapidAPI helper ───────────────────────────────────────────────────────────

// Normalise a RapidAPI key from env: trim whitespace and strip stray surrounding
// single/double quotes that can sneak in when the secret is pasted from a UI
// that auto-quotes the value (a real key only contains alphanumerics so this
// is safe).
function getRapidApiKey(envName = 'RAPIDAPI_KEY') {
  return (process.env[envName] || '').trim().replace(/^['"]+|['"]+$/g, '');
}

async function callRapidAPI(host, path, method = 'GET', body = null) {
  const key = getRapidApiKey();
  if (!key) throw new Error('RAPIDAPI_KEY not configured');

  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: host,
      path,
      method,
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': host,
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve({ _raw: raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('RapidAPI timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// ── POST /api/competitor-news ─────────────────────────────────────────────────
// Powers the live signal feed — uses Real-Time News Data API on RapidAPI
// Subscribe free at: https://rapidapi.com/letscrape-6bRBa3QguO5/api/real-time-news-data

// Competitor news · trends · Reddit signals routes → services/market_signals/routes.js
require('./services/market_signals/routes')(app, { _chargeBudget, anthropic, callDataForSEO, callRapidAPI, https, openai, openaiChatWithRetry });

// ── POST /api/ai-visibility-coverage ──────────────────────────────────────────
// PROMPT COVERAGE — fires every prompt in the user's industry across every
// connected AI model in parallel and reports a real coverage matrix:
// for each (prompt × model) cell: cited yes/no, snippet, error.
// Returns:
//   { matrix: [{ promptId, prompt, results: [{ modelKey, modelName, cited, snippet }] }],
//     coverageByModel:   { chatgpt: 0.62, claude: 0.5, ... },
//     coverageByPrompt:  { 'brand-discovery': 1.0, ... },
//     overallCoverage:   0.55 }
app.post('/api/ai-visibility-coverage', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry', prompts: clientPrompts } = req.body || {};
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    const brandStem = cleanDomain.split('.')[0];
    const indWord = String(industry).split(' ')[0];

    // Default 8-prompt coverage set if the client didn't pass its own.
    const defaultPrompts = [
      { id:'brand-discovery', cat:'Brand Discovery', q:`What are the best ${industry} companies in 2025?` },
      { id:'comparison',      cat:'Comparison',      q:`${cleanDomain} vs its top alternatives — pros and cons?` },
      { id:'how-to',          cat:'How-To',          q:`How do I get started with ${indWord.toLowerCase()}?` },
      { id:'reviews',         cat:'Reviews',         q:`Is ${cleanDomain} worth it? What do users say about it?` },
      { id:'pricing',         cat:'Pricing',         q:`How much does ${cleanDomain} cost — pricing tiers and value?` },
      { id:'features',        cat:'Features',        q:`What does ${cleanDomain} actually do and what features does it offer?` },
      { id:'use-cases',       cat:'Use Cases',       q:`Real-world ${indWord.toLowerCase()} use cases and customer examples` },
      { id:'alternatives',    cat:'Alternatives',    q:`Top alternatives to ${cleanDomain} for ${industry}` },
    ];
    const prompts = (Array.isArray(clientPrompts) && clientPrompts.length) ? clientPrompts.slice(0, 12) : defaultPrompts;

    const detectMention = (text) => {
      if (!text) return false;
      const t = String(text).toLowerCase();
      return t.includes(cleanDomain) || (brandStem.length >= 4 && t.includes(brandStem));
    };

    // Probes for each connected model. Returns a function (q) => Promise<{cited, snippet, error?}>.
    const probes = {};
    probes.chatgpt = async (q) => {
      const c = await openai.chat.completions.create({ model:'gpt-5', max_tokens:160, messages:[{ role:'user', content:q }] });
      const t = c.choices?.[0]?.message?.content?.trim() || '';
      return { cited: detectMention(t), snippet: t.slice(0,260) };
    };
    probes.claude = async (q) => {
      const c = await anthropic.messages.create({ model:'claude-sonnet-4-6', max_tokens:200, messages:[{ role:'user', content:q }] });
      const t = c.content?.[0]?.text?.trim() || '';
      return { cited: detectMention(t), snippet: t.slice(0,260) };
    };
    if (process.env.GEMINI_API_KEY) {
      probes.gemini = async (q) => {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{ parts:[{ text:q }] }] }) });
        const d = await r.json();
        const t = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { cited: detectMention(t), snippet: t.slice(0,260) };
      };
    }
    if (process.env.PERPLEXITY_API_KEY) {
      probes.perplexity = async (q) => {
        const r = await fetch('https://api.perplexity.ai/chat/completions',
          { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`}, body: JSON.stringify({ model:'sonar', messages:[{ role:'user', content:q }] }) });
        const d = await r.json();
        const t = d?.choices?.[0]?.message?.content || '';
        return { cited: detectMention(t), snippet: t.slice(0,260) };
      };
    }
    if (process.env.DEEPSEEK_API_KEY) {
      probes.deepseek = async (q) => {
        const r = await fetch('https://api.deepseek.com/chat/completions',
          { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`}, body: JSON.stringify({ model:'deepseek-chat', messages:[{ role:'user', content:q }] }) });
        const d = await r.json();
        const t = d?.choices?.[0]?.message?.content || '';
        return { cited: detectMention(t), snippet: t.slice(0,260) };
      };
    }

    const modelMeta = {
      chatgpt:   { name:'ChatGPT' },
      claude:    { name:'Claude' },
      gemini:    { name:'Gemini' },
      perplexity:{ name:'Perplexity' },
      deepseek:  { name:'DeepSeek' },
    };
    const modelKeys = Object.keys(probes);

    // Run prompts × models fully in parallel.
    const cellPromises = [];
    prompts.forEach((p, i) => modelKeys.forEach(mk => {
      cellPromises.push(
        probes[mk](p.q)
          .then(r => ({ promptIdx:i, modelKey:mk, ...r }))
          .catch(e => ({ promptIdx:i, modelKey:mk, cited:false, snippet:'', error:e.message }))
      );
    }));
    const cells = await Promise.all(cellPromises);

    // Reshape into matrix.
    const matrix = prompts.map((p, i) => ({
      promptId: p.id || ('p'+i),
      cat: p.cat,
      prompt: p.q,
      results: modelKeys.map(mk => {
        const c = cells.find(x => x.promptIdx === i && x.modelKey === mk) || { cited:false, snippet:'', error:'no cell' };
        return { modelKey: mk, modelName: modelMeta[mk]?.name || mk, cited: !!c.cited, snippet: c.snippet || '', error: c.error };
      }),
    }));

    // Aggregations.
    const coverageByModel = {};
    modelKeys.forEach(mk => {
      const total = matrix.length;
      const hits = matrix.filter(row => row.results.find(r => r.modelKey === mk)?.cited).length;
      coverageByModel[mk] = total ? +(hits / total).toFixed(3) : 0;
    });
    const coverageByPrompt = {};
    matrix.forEach(row => {
      const total = row.results.length;
      const hits = row.results.filter(r => r.cited).length;
      coverageByPrompt[row.promptId] = total ? +(hits / total).toFixed(3) : 0;
    });
    const overallCells = matrix.length * modelKeys.length;
    const overallHits = cells.filter(c => c.cited).length;
    const overallCoverage = overallCells ? +(overallHits / overallCells).toFixed(3) : 0;

    // Record this run into trend history (best-effort, non-blocking), scoped
    // to the caller's workspace.
    try { const _aivisTid = await _tkvCtx.resolveTenantId(req, { label: 'aivis:record' }); await recordAivisRun(_aivisTid, cleanDomain, { ts: Date.now(), overallCoverage, coverageByModel, coverageByPrompt, modelKeys, totalCells: overallCells, totalCitations: overallHits }); } catch(_){}

    res.json({ ok:true, domain:cleanDomain, industry, modelKeys, matrix, coverageByModel, coverageByPrompt, overallCoverage,
      summary: { promptsRun: matrix.length, modelsRun: modelKeys.length, totalCells: overallCells, totalCitations: overallHits } });
  } catch (err) {
    console.error('/api/ai-visibility-coverage error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/ai-visibility-accuracy ──────────────────────────────────────────
// ANSWER ACCURACY — scrapes the user's homepage + about/products/services pages
// to build a "source of truth" snapshot, then asks each connected model the
// same brand-fact question and uses GPT-4o to judge each answer for accuracy
// against that source. Returns per-model accuracy score, hallucinations, and
// confirmed facts.
// AI visibility (accuracy/competitors/entity/sentiment/sge/attribution) routes → services/ai_visibility/routes.js
require('./services/ai_visibility/routes')(app, { anthropic, openai });

// ── AMPLITUDE AI AGENTS ──────────────────────────────────────────────────────
// Three on-demand agents that pull real product-analytics data from the
// Amplitude Dashboard REST API (Basic auth = AMPLITUDE_API_KEY:AMPLITUDE_SECRET_KEY)
// and pipe it through GPT-4o for trend / friction / theme analysis.
//
//   POST /api/amplitude/dashboard-agent  → top events + WoW delta + AI hypotheses
//   POST /api/amplitude/replay-agent     → funnel drop-off + AI friction analysis
//   POST /api/amplitude/feedback-agent   → feedback events grouped + AI themes
// ─────────────────────────────────────────────────────────────────────────────
function _amplitudeAuthOrError(res) {
  const apiKey = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey) {
    res.json({ ok:true, connected:false,
      missing: !apiKey ? 'AMPLITUDE_API_KEY' : 'AMPLITUDE_SECRET_KEY',
      note: !apiKey
        ? 'Connect your Amplitude project (API key + secret) to run AI agents on real product data.'
        : 'AMPLITUDE_API_KEY is configured, but the agents also need AMPLITUDE_SECRET_KEY (Amplitude → Settings → Projects → API Key + Secret).'
    });
    return null;
  }
  return 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
}
function _amplitudeFmtDate(d) { return d.toISOString().slice(0,10).replace(/-/g,''); }
async function _amplitudeFetch(path, auth) {
  const r = await fetch('https://amplitude.com' + path, { headers:{ Authorization:auth } });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { _raw: txt.slice(0,400) }; }
  if (!r.ok) {
    const msg = (j && (j.message || j.error)) || (typeof j === 'object' ? JSON.stringify(j).slice(0,200) : String(txt).slice(0,200));
    const err = new Error(`Amplitude ${r.status}: ${msg}`);
    err.status = r.status;
    throw err;
  }
  return j;
}
// Amplitude agents · content fact-check routes → services/amplitude_agents/routes.js
require('./services/amplitude_agents/routes')(app, { _amplitudeAuthOrError, _amplitudeFetch, _amplitudeFmtDate, openai, openaiChatWithRetry });

// ── AI Visibility Trend persistence ──────────────────────────────────────────
// Stores every coverage-matrix run (keyed by domain) so users can see citation
// deltas over time per model and per prompt.
// Per-workspace: trend history lives at kv `aivis_history:t<tid>` (a
// {domain:[runs]} map). null tid → empty (never reads another workspace).
const AIVIS_HISTORY_BASE = 'aivis_history';
async function loadAivisHistory(tid) {
  return await _tkvRead(AIVIS_HISTORY_BASE, tid, () => ({}));
}
async function recordAivisRun(tid, domain, run) {
  if (tid == null || !domain || !run) return;
  await _tkvMutate(AIVIS_HISTORY_BASE, tid, () => ({}), (h) => {
    const safe = (h && typeof h === 'object' && !Array.isArray(h)) ? h : {};
    if (!safe[domain]) safe[domain] = [];
    safe[domain].push(run);
    // Keep last 60 runs per domain (about 2 months daily).
    if (safe[domain].length > 60) safe[domain] = safe[domain].slice(-60);
    return safe;
  });
}

// ── GET /api/ai-visibility-trend?domain=X ─────────────────────────────────────
// TREND TRACKING — returns the historical citation series for a domain so the
// AI Visibility view can render sparklines + week-over-week deltas per model
// and per prompt.
// AI visibility/brand/content generation suite routes → services/ai_content/routes.js
require('./services/ai_content/routes')(app, { _tkvCtx, anthropic, callDataForSEO, callRapidAPI, getDataForSEOAuth, getRapidApiKey, https, loadAivisHistory, openai, path });

// Legacy 6-digit code signup verification was fully removed; real per-user
// auth lives in services/auth/{schema,api}.js (token-link verification +
// password reset + OAuth). See /api/auth/* routes.

// ════════════════════════════════════════════════════════════════════════════
// ── DRIP-CAMPAIGN EXECUTION ENGINE ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
// File-backed enrollment store + a 60-second scheduler that processes any
// due email-channel steps via Resend. Non-email channels (Retarget Ad,
// LinkedIn DM, SMS, etc.) are recorded as "pending integration" — they won't
// fire but the enrollment still progresses through the sequence so the
// timeline reflects what would happen in production.

// Per-workspace: enrollments live at kv `drip_enrollments:t<tid>` (array) and
// unsubscribes at `drip_unsubs:t<tid>` (array of lowercased emails). Every
// read/write is scoped to one tenant — a null tid yields an empty list and a
// no-op write, so a workspace can never touch another's drip data.
const DRIP_ENROLL_BASE = 'drip_enrollments';
const DRIP_UNSUB_BASE  = 'drip_unsubs';

async function _dripLoad(tid) {
  const list = await _tkvRead(DRIP_ENROLL_BASE, tid, () => []);
  return Array.isArray(list) ? list : [];
}
async function _dripSave(tid, list) {
  return await _tkvWrite(DRIP_ENROLL_BASE, tid, Array.isArray(list) ? list : []);
}

// Single-writer mutex around any read-modify-write sequence on the drip
// store. Prevents the 60s tick, an inbound webhook, and a user enroll from
// clobbering each other (last-write-wins would otherwise drop bounce/
// delivered flags). All async; queues callers FIFO. The mutex is global
// (cross-tenant) — a small concurrency cost for guaranteed correctness given
// the shared 60s tick that walks every workspace.
let _dripLockTail = Promise.resolve();
function _dripLock(fn) {
  const next = _dripLockTail.then(() => fn());
  _dripLockTail = next.catch(() => {}); // never let one error break the chain
  return next;
}
async function _dripLoadUnsubs(tid) {
  const arr = await _tkvRead(DRIP_UNSUB_BASE, tid, () => []);
  return new Set(Array.isArray(arr) ? arr : []);
}
async function _dripSaveUnsubs(tid, set) {
  return await _tkvWrite(DRIP_UNSUB_BASE, tid, [...set]);
}

// Expose the drip store helpers on a global so other modules (e.g. the
// Dynamic Audiences → Drip bridge in services/audiences/drip_bridge.js)
// can read/mutate the store under the same single-writer mutex without
// taking the latency hit of an internal HTTP loopback to /api/drips/enroll.
// All store methods are tenant-scoped: callers MUST pass the tenant id.
global._dripStore = {
  load: _dripLoad, save: _dripSave, lock: _dripLock,
  loadUnsubs: _dripLoadUnsubs, saveUnsubs: _dripSaveUnsubs,
};

// Generic Resend email sender — extracted from _sendVerificationEmail so the
// drip engine can reuse it without coupling to verification-specific HTML.
// Returns the Resend response (incl. message id) on success; throws on
// failure with an enriched error that includes a bounce classification.
async function _sendEmailViaResend({ to, subject, html, text, fromOverride }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY missing');
  const fromAddr = fromOverride || process.env.RESEND_FROM_EMAIL || 'InfoGenie <onboarding@resend.dev>';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddr, to: [to], subject, text: text || '', html: html || '' })
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`Resend ${resp.status}: ${txt.slice(0, 240)}`);
    err.status = resp.status;
    err.bodyText = txt;
    err.failureType = _classifyEmailFailure(resp.status, txt);
    throw err;
  }
  return resp.json().catch(() => ({}));
}

// Classify a failed Resend response into bounce-rate buckets so the engine
// can compute meaningful deliverability metrics.
//   bounce    — recipient rejected (invalid address, unverified domain, etc.)
//   complaint — marked as spam by the recipient
//   rate      — provider rate-limit; not a bounce, will retry naturally
//   auth      — API key / authentication problem (NOT a bounce — config issue)
//   config    — sender domain / from-address config error (NOT a bounce)
//   other     — any other failure (network, generic 4xx without bounce keywords)
// Important: only return 'bounce' when the body text actually indicates a
// recipient-side rejection. Generic 400/403/422 with no bounce keywords are
// classified as 'config' or 'other' so they don't inflate the bounce rate.
function _classifyEmailFailure(status, bodyText) {
  const s = String(bodyText || '').toLowerCase();
  if (status === 429 || /rate.?limit|too many requests/.test(s)) return 'rate';
  if (status === 401 || /unauthor|invalid.*api.?key|missing.*api.?key/i.test(s)) return 'auth';
  if (/spam|complain|abuse/.test(s)) return 'complaint';
  if (/bounce|undeliverable|user unknown|no such user|mailbox.*(?:full|not found|unavailable)|recipient.*(?:rejected|not found)|address.*(?:rejected|not.*exist)|invalid.*recipient/i.test(s)) return 'bounce';
  // Resend free-tier "you can only send to your own verified address" — this
  // is a sender-config problem, not a recipient bounce.
  if (/verified domain|verify your domain|testing emails to your own|only send.*verified/i.test(s)) return 'config';
  if (status === 422 || status === 400 || status === 403) return 'config';
  return 'other';
}

// Wrap a step's plain text content into a branded HTML email body that
// includes a working unsubscribe link (CAN-SPAM / GDPR requirement).
function _dripEmailHtml({ subject, body, brand, unsubUrl }) {
  const safeBody = String(body || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const safeBrand = String(brand || 'InfoGenie').replace(/[<>&"]/g,'').slice(0,80);
  return `<!doctype html><html><body style="margin:0;background:#F3F4F6;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.05)">
      <div style="background:linear-gradient(135deg,#D97706,#B45309);padding:18px 26px;color:#FFFFFF">
        <div style="font-size:1.1rem;font-weight:800;letter-spacing:-.01em">${safeBrand}</div>
      </div>
      <div style="padding:26px 28px;font-size:.94rem;color:#0A1628;line-height:1.6">${safeBody}</div>
      <div style="padding:14px 28px;background:#F9FAFB;border-top:1px solid #F3F4F6;font-size:.7rem;color:#9CA3AF;text-align:center">
        Sent by ${safeBrand} via InfoGenie · <a href="${unsubUrl}" style="color:#9CA3AF;text-decoration:underline">Unsubscribe</a>
      </div>
    </div></body></html>`;
}

// Process every active enrollment whose nextSendAt has come due. Runs in a
// timer below. Pure function over (enrollments, unsubs, now) → mutates each
// enrollment's currentStep / nextSendAt / status / history. Wrapped in the
// drip lock so concurrent enrolls / webhook events can't clobber updates.
// Walk every active workspace and process its due enrollments. Each tenant's
// list/unsubs are loaded and saved under its own kv keys so sends never bleed
// across workspaces.
function _dripTick() {
  return _dripLock(async () => {
    let tids = [];
    try { tids = await _tkvCtx.listActiveTenantIds(); } catch (_) { tids = []; }
    for (const tid of tids) {
      try { await _dripTickInner(tid); }
      catch (e) { console.error(`[drip] tick error (t${tid}):`, e.message); }
    }
  });
}
async function _dripTickInner(tid) {
  let list  = await _dripLoad(tid);
  if (!list.length) return;
  const unsubs = await _dripLoadUnsubs(tid);
  const now = Date.now();
  let mutated = false;
  for (const enr of list) {
    if (enr.status !== 'active') continue;
    if (unsubs.has(String(enr.email || '').toLowerCase())) {
      enr.status = 'unsubscribed';
      mutated = true;
      continue;
    }
    if (!Array.isArray(enr.sequence) || !enr.sequence.length) {
      enr.status = 'completed';
      mutated = true;
      continue;
    }
    if ((enr.nextSendAt || 0) > now) continue;
    const step = enr.sequence[enr.currentStep];
    if (!step) {
      enr.status = 'completed';
      enr.completedAt = now;
      mutated = true;
      continue;
    }
    const channel = String(step.channel || 'Email');
    const isEmail = /email/i.test(channel);
    const entry = { stepIndex: enr.currentStep, label: step.label || '', channel, sentAt: now, ok: false };
    try {
      if (enr.dryRun) {
        entry.ok = true; entry.note = 'dry-run (no real send)';
      } else if (isEmail) {
        const subject = (step.subject || step.label || `Message from ${enr.brand || 'InfoGenie'}`).slice(0, 140);
        const unsubUrl = `${enr.appOrigin || ''}/api/drips/unsubscribe?email=${encodeURIComponent(enr.email)}&t=${encodeURIComponent(tid)}`;
        const html = _dripEmailHtml({ subject, body: step.msg || '', brand: enr.brand, unsubUrl });
        const text = (step.msg || '') + `\n\n— Unsubscribe: ${unsubUrl}`;
        const sendRes = await _sendEmailViaResend({ to: enr.email, subject, html, text });
        entry.ok = true;
        // Resend returns { id: 'xxxx' } on success — keep it so async webhook
        // events (delivered/bounced/complained) can be matched back here.
        if (sendRes && sendRes.id) entry.providerId = sendRes.id;
      } else {
        entry.ok = true; entry.note = `${channel} — pending platform integration (recorded only)`;
      }
    } catch (sendErr) {
      entry.ok = false;
      entry.error = String(sendErr.message || sendErr).slice(0, 240);
      // Tag the failure type so bounce-rate vs complaint-rate stay distinct.
      entry.failureType = sendErr.failureType || 'other';
      const reasonText = (sendErr.bodyText || sendErr.message || '').slice(0, 240);
      if (entry.failureType === 'bounce') {
        entry.bounced = true;
        entry.bouncedAt = now;
        entry.bounceReason = reasonText;
      } else if (entry.failureType === 'complaint') {
        entry.complaint = true;
        entry.complaintAt = now;
        entry.complaintReason = reasonText;
      }
    }
    enr.history = enr.history || [];
    enr.history.push(entry);
    enr.currentStep += 1;
    if (enr.currentStep >= enr.sequence.length) {
      enr.status = 'completed';
      enr.completedAt = now;
    } else {
      const startedAt = enr.startedAt || now;
      const nextStep = enr.sequence[enr.currentStep];
      const dayOffset = (typeof nextStep.day === 'number' && nextStep.day >= 0) ? nextStep.day : (enr.currentStep);
      enr.nextSendAt = startedAt + dayOffset * 86400000;
    }
    mutated = true;
  }
  if (mutated) await _dripSave(tid, list);
}

// Tick every 60 seconds. Errors in the engine should never crash the server.
// Guarded so importing the app for tests (buildApp) starts no timers.
if (_runtimeFlags.backgroundEnabled()) {
  setInterval(() => { _dripTick().catch(e => console.error('[drip] tick error:', e.message)); }, 60_000);
  // Also fire once 5 seconds after boot so freshly-enrolled day-0 sends go out.
  setTimeout(() => { _dripTick().catch(()=>{}); }, 5_000);
}

// ── POST /api/drips/enroll ────────────────────────────────────────────────
// body: { contacts:[{email, name?}], sequence:[{day, channel, msg, label, subject?}],
//         brand?, dryRun?:bool, appOrigin? }
// Core enrollment logic shared by the HTTP route and in-process callers
// (e.g. the re-engagement launcher) so we avoid an authenticated loopback.
// Caller MUST pass a resolved tenant id.
async function _enrollDripCore(tid, { contacts, sequence, brand, dryRun, appOrigin }) {
  const validEmail = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  const result = await _dripLock(async () => {
    const list = await _dripLoad(tid);
    const unsubs = await _dripLoadUnsubs(tid);
    const startedAt = Date.now();
    const dayZeroOffset = (sequence[0] && typeof sequence[0].day === 'number') ? sequence[0].day : 0;
    const created = [];
    const skipped = [];
    for (const c of contacts.slice(0, 500)) {
      const email = String(c.email || '').trim().toLowerCase();
      if (!validEmail(email)) { skipped.push({ email: c.email, reason: 'invalid email' }); continue; }
      if (unsubs.has(email))  { skipped.push({ email, reason: 'unsubscribed' });          continue; }
      // Detect duplicate (active enrollment for same email + same sequence length+labels)
      const seqSig = sequence.map(s => `${s.day}|${s.channel}|${s.label||''}`).join('::');
      const dup = list.find(e => e.email === email && e.status === 'active' && e._seqSig === seqSig);
      if (dup) { skipped.push({ email, reason: 'already enrolled in this sequence' }); continue; }
      const id = 'drip_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      list.push({
        id, email,
        name: String(c.name || '').slice(0, 80),
        brand: String(brand || 'InfoGenie').slice(0, 80),
        sequence: sequence.map(s => ({
          day: Number(s.day) || 0,
          channel: String(s.channel || 'Email').slice(0, 32),
          label: String(s.label || '').slice(0, 80),
          subject: String(s.subject || s.label || '').slice(0, 140),
          msg: String(s.msg || '').slice(0, 6000),
        })),
        _seqSig: seqSig,
        startedAt,
        currentStep: 0,
        nextSendAt: startedAt + dayZeroOffset * 86400000,
        status: 'active',
        dryRun: !!dryRun,
        appOrigin: String(appOrigin || '').slice(0, 200),
        history: [],
      });
      created.push({ id, email });
    }
    await _dripSave(tid, list);
    return { created, skipped };
  });
  // Kick off an immediate tick so day-0 sends fire right away (after lock release)
  _dripTick().catch(()=>{});
  return result;
}

// Drip enrollment · stats · webhooks routes → services/drips/routes.js
require('./services/drips/routes')(app, { _dripLoad, _dripLock, _dripSave, _dripUnsubscribe, _enrollDripCore, _tkvCtx, anthropic, openaiChatWithRetry, path });

const startMsg = () => {
  console.log(`DataForSEO: ${process.env.DATAFORSEO_LOGIN ? 'CONFIGURED ✓' : 'NOT CONFIGURED — add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD secrets'}`);
};

// ── Outreach Sequence Generator ───────────────────────────────────────────────
// Outreach sequence · traffic projection · tech SEO routes → services/tech_seo/routes.js
require('./services/tech_seo/routes')(app, { openai });

// ─────────────────────────────────────────────────────────────────────────────
// ATTRIBUTION & ROI DASHBOARD
// Pulls spend from Meta/Google/TikTok, conversions from Amplitude (preferred),
// and computes per-channel ROAS / CAC / ROI under a chosen attribution model.
// Revenue is derived from Meta action_values when available, else AOV * conv.
// ─────────────────────────────────────────────────────────────────────────────
async function _fetchMetaSpendRich(days = 30, userId = null) {
  const _r = await _credentialsVault.resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok:false, channel:'meta', error:'not-configured' };
  const rawAccountId = _cleanSecret(_r.creds.adAccountId);
  const accessToken  = _cleanSecret(_r.creds.accessToken);
  if (!rawAccountId || !accessToken) return { ok:false, channel:'meta', error:'not-configured' };
  const numericId = _digitsOnly(rawAccountId) || rawAccountId;
  const acct = numericId.startsWith('act_') ? numericId : `act_${numericId}`;
  const since = new Date(Date.now() - days*86400000).toISOString().slice(0,10);
  const until = new Date().toISOString().slice(0,10);
  try {
    // Pass token via Authorization header instead of query string to avoid
    // leaking the access token through proxy / nginx / CDN access logs.
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${acct}/insights?fields=spend,impressions,clicks,actions,action_values&time_range[since]=${since}&time_range[until]=${until}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const j = await r.json();
    if (j.error) return { ok:false, channel:'meta', error: j.error.message, status:r.status };
    const row = j.data?.[0] || {};
    const purchases = (row.actions || [])
      .filter(a => /purchase|fb_pixel_purchase|complete_registration|lead/i.test(a.action_type))
      .reduce((s, a) => s + Number(a.value || 0), 0);
    const revenue = (row.action_values || [])
      .filter(a => /purchase|fb_pixel_purchase/i.test(a.action_type))
      .reduce((s, a) => s + Number(a.value || 0), 0);
    return {
      ok:true, channel:'meta',
      spend:       Number(row.spend       || 0),
      impressions: Number(row.impressions || 0),
      clicks:      Number(row.clicks      || 0),
      conversions: purchases,
      revenue,
    };
  } catch (e) { return { ok:false, channel:'meta', error: e.message }; }
}

// Returns { channels: <copy with modelAdjusted conversions>, weights: {channel: 0..1} }.
// Weights always sum to 1.0 so callers can redistribute external conversion
// totals (e.g. Amplitude) using the same model.
function _applyAttributionWeights(channels, model) {
  const live = channels.filter(c => c.ok);
  if (live.length === 0) return { channels, weights: {} };
  const equalShare = 1 / live.length;
  // Default weights = current per-channel conversion share (used as fallback
  // when click data is missing). Falls back to equal share if no conv either.
  const totalConv   = live.reduce((s,c) => s + (c.conversions || 0), 0);
  const totalClicks = live.reduce((s,c) => s + (c.clicks      || 0), 0);
  let weights = {};
  if (model === 'last-click' || live.length === 1) {
    if (totalConv > 0) live.forEach(c => { weights[c.channel] = (c.conversions || 0) / totalConv; });
    else live.forEach(c => { weights[c.channel] = equalShare; });
  } else if (model === 'linear') {
    if (totalClicks > 0) live.forEach(c => { weights[c.channel] = (c.clicks || 0) / totalClicks; });
    else live.forEach(c => { weights[c.channel] = equalShare; });
  } else if (model === 'time-decay') {
    if (totalClicks > 0) {
      const raw = live.map(c => Math.pow((c.clicks || 0) / totalClicks, 2));
      const sum = raw.reduce((a,b)=>a+b, 0) || 1;
      live.forEach((c,i) => { weights[c.channel] = raw[i] / sum; });
    } else { live.forEach(c => { weights[c.channel] = equalShare; }); }
  } else if (model === 'position-based') {
    // 40% to top spender, 40% to top click-share, 20% spread across the rest.
    // If top spender == top click-share, that single channel still gets 40%
    // and the remaining 60% is split among the others (40% to runner-up by
    // clicks, 20% across the long tail) so weights always sum to 1.0.
    const sortedSpend  = [...live].sort((a,b) => (b.spend  || 0) - (a.spend  || 0));
    const sortedClicks = [...live].sort((a,b) => (b.clicks || 0) - (a.clicks || 0));
    const topSpend  = sortedSpend[0]?.channel;
    const topClicks = sortedClicks[0]?.channel;
    live.forEach(c => { weights[c.channel] = 0; });
    if (topSpend === topClicks) {
      // Single dominant channel
      weights[topSpend] = 0.40;
      const runnerUp = sortedClicks.find(c => c.channel !== topSpend)?.channel;
      if (runnerUp) {
        weights[runnerUp] = 0.40;
        const rest = live.filter(c => c.channel !== topSpend && c.channel !== runnerUp);
        const restShare = rest.length > 0 ? 0.20 / rest.length : 0;
        rest.forEach(c => { weights[c.channel] = restShare; });
        // If only 2 channels live, runner-up should absorb the 20% as well
        if (rest.length === 0) weights[runnerUp] = 0.60;
      } else {
        weights[topSpend] = 1.0; // Only 1 channel
      }
    } else {
      weights[topSpend]  = 0.40;
      weights[topClicks] = 0.40;
      const rest = live.filter(c => c.channel !== topSpend && c.channel !== topClicks);
      const restShare = rest.length > 0 ? 0.20 / rest.length : 0;
      rest.forEach(c => { weights[c.channel] = restShare; });
      // Only 2 channels live → split the 20% between the two
      if (rest.length === 0) { weights[topSpend] = 0.50; weights[topClicks] = 0.50; }
    }
  } else {
    live.forEach(c => { weights[c.channel] = equalShare; });
  }
  // Apply weights to the (current) total conversions so the channel-level
  // numbers reflect the chosen model. Caller can override if it has a more
  // authoritative conversion total (e.g. Amplitude).
  const adjusted = channels.map(c => {
    if (!c.ok) return c;
    const w = weights[c.channel] || 0;
    return { ...c, conversions: +(totalConv * w).toFixed(2), modelAdjusted: model !== 'last-click' };
  });
  return { channels: adjusted, weights };
}

app.get('/api/attribution/overview', async (req, res) => {
  try {
    const days  = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    const aov   = Math.max(0, parseFloat(req.query.aov) || 0);
    const model = ['last-click','linear','time-decay','position-based'].includes(req.query.model) ? req.query.model : 'last-click';
    const [meta, google, tiktok, amp] = await Promise.all([
      _fetchMetaSpendRich(days),
      _fetchGoogleAdsSpend(days),
      _fetchTikTokSpend(days),
      _fetchAmplitudeConversions(days),
    ]);
    const sourceChannels = [meta, google, tiktok];
    // Apply attribution model — get normalised weights (sum to 1.0) we can use
    // to redistribute the most authoritative conversion total across channels.
    const { weights } = _applyAttributionWeights(sourceChannels, model);
    // Ground-truth conversion total: prefer Amplitude when it has data, else
    // fall back to the sum of ad-platform-reported conversions.
    const adReportedConv = sourceChannels.filter(c => c.ok).reduce((s,c) => s + (c.conversions || 0), 0);
    const useAmplitude   = !!(amp.ok && Number(amp.conversions) > 0);
    const groundTruthConv = useAmplitude ? Number(amp.conversions) : adReportedConv;
    const conversionSource = useAmplitude ? 'amplitude' : 'ad-platform';
    const enriched = sourceChannels.map(c => {
      if (!c.ok) return c;
      // Per-channel conversions = ground-truth total × model weight for this channel
      const w    = weights[c.channel] || 0;
      const conv = +(groundTruthConv * w).toFixed(2);
      // Revenue: Meta action_values if present, else AOV*conv if AOV given, else null
      let revenue = Number(c.revenue || 0);
      if (!revenue && aov > 0) revenue = +(aov * conv).toFixed(2);
      const cpa  = conv > 0    ? +(c.spend / conv).toFixed(2) : null;
      const ctr  = (c.impressions||0) > 0 ? +((c.clicks||0)/c.impressions*100).toFixed(2) : null;
      const cpc  = (c.clicks||0) > 0 ? +((c.spend||0)/c.clicks).toFixed(2) : null;
      const roas = revenue > 0 && c.spend > 0 ? +(revenue / c.spend).toFixed(2) : null;
      const roi  = revenue > 0 && c.spend > 0 ? +(((revenue - c.spend) / c.spend) * 100).toFixed(1) : null;
      return {
        ...c,
        conversions: conv,
        modelAdjusted: model !== 'last-click' || useAmplitude,
        weight: +(w * 100).toFixed(1),
        revenue, cpa, ctr, cpc, roas, roi,
      };
    });
    const live = enriched.filter(c => c.ok);
    const totals = {
      spend:       +live.reduce((s,c)=>s+(c.spend||0),0).toFixed(2),
      impressions: live.reduce((s,c)=>s+(c.impressions||0),0),
      clicks:      live.reduce((s,c)=>s+(c.clicks||0),0),
      conversions: +live.reduce((s,c)=>s+(c.conversions||0),0).toFixed(2),
      revenue:     +live.reduce((s,c)=>s+(c.revenue||0),0).toFixed(2),
    };
    totals.blendedROAS = totals.spend > 0 && totals.revenue > 0 ? +(totals.revenue / totals.spend).toFixed(2) : null;
    totals.blendedCAC  = totals.conversions > 0 ? +(totals.spend / totals.conversions).toFixed(2) : null;
    totals.blendedROI  = totals.revenue > 0 && totals.spend > 0 ? +(((totals.revenue - totals.spend) / totals.spend) * 100).toFixed(1) : null;
    // Best/worst channel by ROAS (only among live with revenue)
    const ranked = live.filter(c => c.roas != null).sort((a,b) => (b.roas||0) - (a.roas||0));
    const winner = ranked[0] || null;
    const loser  = ranked.length > 1 ? ranked[ranked.length-1] : null;
    res.json({
      ok:true, days, attributionModel: model, aov,
      totals,
      channels: { meta: enriched[0], google: enriched[1], tiktok: enriched[2] },
      conversionSource,
      groundTruthConversions: groundTruthConv,
      amplitude: amp,
      insight: {
        winner: winner ? { channel: winner.channel, roas: winner.roas, roi: winner.roi } : null,
        loser:  loser  ? { channel: loser.channel,  roas: loser.roas,  roi: loser.roi  } : null,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// COHORT & FORECAST — daily breakdowns from the same Meta/Google/TikTok/
// Amplitude sources, then bucketed into ISO-week cohorts and projected forward
// using a simple least-squares linear trend with EMA smoothing.
// ─────────────────────────────────────────────────────────────────────────────
function _isoDate(d) { return new Date(d).toISOString().slice(0,10); }
function _emptyDailySeries(days) {
  const out = [];
  const today = new Date(); today.setUTCHours(0,0,0,0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(today.getUTCDate() - i);
    out.push({ date: _isoDate(d), spend:0, impressions:0, clicks:0, conversions:0, revenue:0 });
  }
  return out;
}
function _mergeDailyInto(target, source) {
  const idx = new Map(target.map((r,i) => [r.date, i]));
  for (const row of source) {
    const i = idx.get(row.date);
    if (i == null) continue;
    target[i].spend       += Number(row.spend       || 0);
    target[i].impressions += Number(row.impressions || 0);
    target[i].clicks      += Number(row.clicks      || 0);
    target[i].conversions += Number(row.conversions || 0);
    target[i].revenue     += Number(row.revenue     || 0);
  }
}
// ISO week label: YYYY-Www (week starting Monday). Used to bucket daily rows.
function _isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;          // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day);  // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}
function _isoWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1)); // Monday
  return _isoDate(d);
}

async function _fetchMetaSpendDaily(days = 90, userId = null) {
  const _r = await _credentialsVault.resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok:false, channel:'meta', error:'not-configured', daily:[] };
  const rawAccountId = _cleanSecret(_r.creds.adAccountId);
  const accessToken  = _cleanSecret(_r.creds.accessToken);
  if (!rawAccountId || !accessToken) return { ok:false, channel:'meta', error:'not-configured', daily:[] };
  const numericId = _digitsOnly(rawAccountId) || rawAccountId;
  const acct = numericId.startsWith('act_') ? numericId : `act_${numericId}`;
  const since = _isoDate(Date.now() - days*86400000);
  const until = _isoDate(Date.now());
  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${acct}/insights?fields=spend,impressions,clicks,actions,action_values&time_range[since]=${since}&time_range[until]=${until}&time_increment=1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const j = await r.json();
    if (j.error) return { ok:false, channel:'meta', error: j.error.message, status:r.status, daily:[] };
    const rows = (j.data || []).map(row => {
      const purchases = (row.actions || [])
        .filter(a => /purchase|fb_pixel_purchase|complete_registration|lead/i.test(a.action_type))
        .reduce((s,a) => s + Number(a.value || 0), 0);
      const revenue = (row.action_values || [])
        .filter(a => /purchase|fb_pixel_purchase/i.test(a.action_type))
        .reduce((s,a) => s + Number(a.value || 0), 0);
      return {
        date: row.date_start,
        spend:       Number(row.spend       || 0),
        impressions: Number(row.impressions || 0),
        clicks:      Number(row.clicks      || 0),
        conversions: purchases,
        revenue,
      };
    });
    return { ok:true, channel:'meta', daily: rows };
  } catch (e) { return { ok:false, channel:'meta', error: e.message, daily:[] }; }
}

async function _fetchGoogleAdsSpendDaily(days = 90, userId = null) {
  const _r = await _credentialsVault.resolveGoogleAdsCredentials(userId);
  if (!_r.ok) return { ok:false, channel:'google', error:'not-configured', daily:[] };
  const devToken     = _cleanSecret(_r.creds.devToken);
  const clientId     = _cleanSecret(_r.creds.clientId);
  const clientSecret = _cleanSecret(_r.creds.clientSecret);
  const refreshToken = _cleanSecret(_r.creds.refreshToken);
  const customerId   = _digitsOnly(_cleanSecret(_r.creds.customerId));
  const loginCustomerId = _r.creds.loginCustomerId ? _digitsOnly(_cleanSecret(_r.creds.loginCustomerId)) : '';
  if (!devToken || !refreshToken || !customerId || !clientId || !clientSecret) {
    return { ok:false, channel:'google', error:'not-configured', daily:[] };
  }
  try {
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }).toString(),
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return { ok:false, channel:'google', error:'oauth-failed', daily:[] };
    const since = _isoDate(Date.now() - days*86400000);
    const until = _isoDate(Date.now());
    const query = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}'`;
    const _hdrs = { 'Authorization':`Bearer ${tok.access_token}`, 'developer-token':devToken, 'Content-Type':'application/json' };
    if (loginCustomerId) _hdrs['login-customer-id'] = loginCustomerId;
    const r = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`,
      { method:'POST', headers: _hdrs, body: JSON.stringify({ query }) }
    );
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { _raw: txt.slice(0,200) }; }
    if (!r.ok) {
      const e = (Array.isArray(j) ? j[0]?.error : j.error) || { message:'unknown' };
      return { ok:false, channel:'google', error: e.message, status:r.status, daily:[] };
    }
    const rows = (Array.isArray(j) ? j : [j]).flatMap(p => p.results || []);
    // Aggregate by date (one customer can have multiple campaigns per day)
    const byDate = new Map();
    for (const row of rows) {
      const date = row.segments?.date;
      if (!date) continue;
      const cur = byDate.get(date) || { date, spend:0, impressions:0, clicks:0, conversions:0, revenue:0 };
      cur.spend       += Number(row.metrics?.costMicros        || 0) / 1_000_000;
      cur.impressions += Number(row.metrics?.impressions       || 0);
      cur.clicks      += Number(row.metrics?.clicks            || 0);
      cur.conversions += Number(row.metrics?.conversions       || 0);
      cur.revenue     += Number(row.metrics?.conversionsValue  || 0);
      byDate.set(date, cur);
    }
    return { ok:true, channel:'google', daily: Array.from(byDate.values()).sort((a,b) => a.date.localeCompare(b.date)) };
  } catch (e) { return { ok:false, channel:'google', error: e.message, daily:[] }; }
}

async function _fetchTikTokSpendDaily(days = 90) {
  const advertiserId = _tiktokAdvertiserId();
  const accessToken  = _cleanSecret(process.env.TIKTOK_ACCESS_TOKEN);
  if (!advertiserId || !accessToken) return { ok:false, channel:'tiktok', error:'not-configured', daily:[] };
  try {
    const since = _isoDate(Date.now() - days*86400000);
    const until = _isoDate(Date.now());
    const url = new URL('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/');
    url.searchParams.set('advertiser_id', advertiserId);
    url.searchParams.set('report_type',  'BASIC');
    url.searchParams.set('data_level',   'AUCTION_ADVERTISER');
    url.searchParams.set('dimensions',   JSON.stringify(['advertiser_id','stat_time_day']));
    url.searchParams.set('metrics',      JSON.stringify(['spend','impressions','clicks','conversion']));
    url.searchParams.set('start_date',   since);
    url.searchParams.set('end_date',     until);
    url.searchParams.set('page_size',    '1000');
    const r = await fetch(url, { headers:{ 'Access-Token': accessToken } });
    const j = await r.json();
    if (j.code && j.code !== 0) return { ok:false, channel:'tiktok', error: j.message, status:j.code, daily:[] };
    const rows = (j.data?.list || []).map(item => {
      const m = item.metrics || {}, dim = item.dimensions || {};
      const date = (dim.stat_time_day || '').slice(0,10);
      return {
        date,
        spend:       Number(m.spend       || 0),
        impressions: Number(m.impressions || 0),
        clicks:      Number(m.clicks      || 0),
        conversions: Number(m.conversion  || 0),
        revenue:     0,
      };
    }).filter(r => r.date);
    return { ok:true, channel:'tiktok', daily: rows };
  } catch (e) { return { ok:false, channel:'tiktok', error: e.message, daily:[] }; }
}

// Attribution cohorts/forecast · lookalike routes → services/attribution/routes.js
require('./services/attribution/routes')(app, { _amplitudeFetch, _amplitudeFmtDate, _emptyDailySeries, _fetchGoogleAdsSpendDaily, _fetchMetaSpendDaily, _fetchTikTokSpendDaily, _isoDate, _isoWeekKey, _isoWeekStart, _mergeDailyInto, openaiChatWithRetry });

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT OPTIMISATION SCORER — given a target keyword + the user's page,
// fetches the top 10 SERP results via DataForSEO, scrapes them for on-page
// signals (word count, headings, schema, FAQ), extracts LSI terms via OpenAI,
// and returns a 0-100 SERP-match score with concrete recommendations.
// 100% outward-facing: only public SERPs + the user's own URL.
// ─────────────────────────────────────────────────────────────────────────────
// DataForSEO numeric location codes for major markets worldwide.
const CONTENT_COUNTRY_CODES = {
  // North America
  US:2840, CA:2124, MX:2484,
  // South / Latin America
  BR:2076, AR:2032, CL:2152, CO:2170, PE:2604, VE:2862, EC:2218, UY:2858, BO:2068, PY:2600, CR:2188, GT:2320, DO:2214,
  // Europe — west
  GB:2826, IE:2372, FR:2250, DE:2276, ES:2724, IT:2380, PT:2620, NL:2528, BE:2056, LU:2442, CH:2756, AT:2040,
  // Europe — north
  SE:2752, NO:2578, DK:2208, FI:2246, IS:2352,
  // Europe — east
  PL:2616, CZ:2203, SK:2703, HU:2348, RO:2642, BG:2100, HR:2191, SI:2705, RS:2688, GR:2300, RU:2643, UA:2804, BY:2112, EE:2233, LV:2428, LT:2440,
  // Middle East
  AE:2784, SA:2682, IL:2376, TR:2792, EG:2818, QA:2634, KW:2414, JO:2400, LB:2422,
  // Africa
  ZA:2710, NG:2566, KE:2404, MA:2504, GH:2288, TN:2788, DZ:2012, ET:2231,
  // Asia
  IN:2356, JP:2392, CN:2156, KR:2410, HK:2344, TW:2158, SG:2702, MY:2458, TH:2764, ID:2360, PH:2608, VN:2704, PK:2586, BD:2050, LK:2144,
  // Oceania
  AU:2036, NZ:2554,
};

// Country display names (used by frontend dropdown — kept in server for single source of truth)
// Content scorer countries · related routes → services/content_scorer_meta/routes.js
require('./services/content_scorer_meta/routes')(app, { CONTENT_COUNTRY_CODES });

// ─── Real Page Audit ──────────────────────────────────────────────────────
// Crawls the user's homepage + a small set of common content paths, extracts
// real on-page signals, and computes a transparent crawlability/content score
// per page. Replaces the previous mock list. Returns dataOrigin/dataSource/
// confidence on every response.
const PAGE_AUDIT_PATHS = ['/', '/about', '/pricing', '/features', '/blog', '/contact'];
function _pageAuditScore(sig) {
  // 0–100 transparent score based on real signals
  let score = 0;
  const reasons = [];
  // Title (15)
  if (sig.title && sig.title.length >= 30 && sig.title.length <= 65) { score += 15; }
  else if (sig.title && sig.title.length > 0) { score += 7; reasons.push(`Title length ${sig.title.length} (ideal 30–65)`); }
  else { reasons.push('Missing <title>'); }
  // Meta description (10)
  if (sig.metaDesc && sig.metaDesc.length >= 70 && sig.metaDesc.length <= 160) { score += 10; }
  else if (sig.metaDesc && sig.metaDesc.length > 0) { score += 5; reasons.push(`Meta description ${sig.metaDesc.length} chars (ideal 70–160)`); }
  else { reasons.push('Missing meta description'); }
  // H1 presence — exactly one (10)
  if (sig.h1s && sig.h1s.length === 1) { score += 10; }
  else if (sig.h1s && sig.h1s.length > 1) { score += 4; reasons.push(`${sig.h1s.length} H1 tags (should be exactly 1)`); }
  else { reasons.push('No H1 tag'); }
  // H2 structure (10)
  if (sig.h2s && sig.h2s.length >= 3) { score += 10; }
  else if (sig.h2s && sig.h2s.length >= 1) { score += 5; reasons.push(`Only ${sig.h2s.length} H2 tag(s) — add subheadings`); }
  else { reasons.push('No H2 subheadings'); }
  // Word count (15)
  const wc = sig.wordCount || 0;
  if (wc >= 800) { score += 15; }
  else if (wc >= 400) { score += 10; reasons.push(`${wc} words — under 800`); }
  else if (wc >= 150) { score += 5; reasons.push(`Thin content (${wc} words)`); }
  else { reasons.push(`Very thin content (${wc} words)`); }
  // Schema markup (15)
  if (sig.schemaTypes && sig.schemaTypes.length >= 2) { score += 15; }
  else if (sig.schemaTypes && sig.schemaTypes.length === 1) { score += 8; reasons.push('Only 1 schema type — add Organization/FAQ/Article'); }
  else { reasons.push('No JSON-LD schema'); }
  // FAQ section (10)
  if (sig.hasFAQSchema) { score += 10; }
  else if (sig.hasFAQ) { score += 6; reasons.push('FAQ headings present but no FAQPage schema'); }
  else { reasons.push('No FAQ section'); }
  // Internal links (10) — proxy via href count in extracted text isn't available;
  // approximate from link density in text snippet via signals if present.
  const linkCount = (sig.internalLinks != null) ? sig.internalLinks : null;
  if (linkCount != null) {
    if (linkCount >= 10) { score += 10; }
    else if (linkCount >= 3) { score += 5; reasons.push(`Only ${linkCount} internal links`); }
    else { reasons.push(`Very few internal links (${linkCount})`); }
  } else {
    score += 5; // neutral if not measurable
  }
  // Cap and return
  score = Math.max(0, Math.min(100, score));
  // Top issue + AI-style fix suggestion (deterministic, derived from signals)
  let issue = reasons[0] || 'Page meets baseline checks';
  let fix = '';
  if (!sig.title)               fix = 'Add a 30–65 character <title> tag describing the page topic';
  else if (!sig.metaDesc)       fix = 'Add a 70–160 character meta description summarising the page';
  else if (!(sig.h1s || []).length) fix = 'Add exactly one H1 tag with the primary topic';
  else if ((sig.h1s || []).length > 1) fix = `Reduce to exactly one H1 (currently ${sig.h1s.length})`;
  else if ((sig.h2s || []).length < 3) fix = 'Add at least 3 H2 subheadings to structure the content';
  else if (wc < 800)            fix = `Expand content to 800+ words (currently ${wc}) with depth on the main topic`;
  else if (!(sig.schemaTypes || []).length) fix = 'Add JSON-LD schema (Organization, Article, or FAQPage)';
  else if (!sig.hasFAQSchema && !sig.hasFAQ) fix = 'Add an FAQ section with FAQPage schema for AI citation eligibility';
  else                          fix = 'Add 5+ internal links from related pages to strengthen topical authority';
  return { score, reasons, issue, fix };
}

app.post('/api/page-audit/run', async (req, res) => {
  const t0 = Date.now();
  const domain = (req.body?.domain || '').toString().trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return res.status(400).json({
      ok:false, error:'valid domain required',
      dataOrigin:'request_validation', dataSource:'server_validator', confidence:'high',
      transparency:'Domain failed format check before any external request was made.',
    });
  }
  // Build candidate URLs and scrape in parallel
  const urls = PAGE_AUDIT_PATHS.map(p => `https://${domain}${p}`);
  const results = await Promise.all(urls.map(u => _scrapePageForScoring(u, 9000)));
  // Helper: classify the failure so we can give an honest, useful message instead
  // of the misleading "URL might not exist" wording. Cloudflare/Akamai/PerimeterX
  // protected sites (e.g. fxpro.com) consistently return 403 to non-JS clients.
  const classifyError = (errStr) => {
    const e = String(errStr || '').toLowerCase();
    if (/\bhttp\s*403\b|forbidden/.test(e)) {
      return {
        issue: 'Site blocks automated crawlers (HTTP 403)',
        fix:   'This domain uses bot-protection (Cloudflare / Akamai / PerimeterX). InfoGenie can\'t score it from outside — to audit it, run the scan from inside your own infrastructure or whitelist our user-agent in your WAF.',
        kind:  'blocked',
      };
    }
    if (/\bhttp\s*429\b|rate.?limit/.test(e)) {
      return { issue: 'Rate-limited by the site (HTTP 429)', fix: 'Too many requests in a short window. Wait a minute and re-run, or audit one path at a time.', kind: 'blocked' };
    }
    if (/\bhttp\s*5\d{2}\b|server.error/.test(e)) {
      return { issue: 'Site returned a server error (5xx)', fix: 'The page is reachable but the server is failing. Try again later or check your origin server logs.', kind: 'server' };
    }
    if (/\bhttp\s*404\b|not.found/.test(e)) {
      return { issue: 'Page not found (HTTP 404)', fix: 'This path doesn\'t exist on the site. Remove it from your sitemap or add a redirect.', kind: 'notfound' };
    }
    if (/timeout|timed.out|aborted/.test(e)) {
      return { issue: 'Request timed out', fix: 'Page took longer than 9s to respond. Often caused by slow origin or large payloads — check Core Web Vitals.', kind: 'timeout' };
    }
    return { issue: `Could not fetch (${errStr})`, fix: 'Check this URL exists and is publicly accessible (not behind login or robots.txt block).', kind: 'other' };
  };
  const pages = results.map((r, i) => {
    if (!r.ok) {
      const c = classifyError(r.error);
      return { url: PAGE_AUDIT_PATHS[i], fullUrl: urls[i], ok:false, crawl: 0, title: PAGE_AUDIT_PATHS[i], issue: c.issue, fix: c.fix, errorKind: c.kind };
    }
    const s = _pageAuditScore(r);
    return {
      url: PAGE_AUDIT_PATHS[i],
      fullUrl: urls[i],
      ok: true,
      title: r.title || PAGE_AUDIT_PATHS[i],
      crawl: s.score,
      issue: s.issue,
      fix: s.fix,
      wordCount: r.wordCount || 0,
      h1Count: (r.h1s || []).length,
      h2Count: (r.h2s || []).length,
      schemaTypes: r.schemaTypes || [],
      hasFAQ: !!(r.hasFAQ || r.hasFAQSchema),
      reasons: s.reasons,
    };
  });
  const reachable = pages.filter(p => p.ok);
  const blockedAll = pages.length > 0 && pages.every(p => !p.ok && p.errorKind === 'blocked');
  const avgScore = reachable.length ? Math.round(reachable.reduce((a,p)=>a+p.crawl,0) / reachable.length) : 0;
  const elapsedMs = Date.now() - t0;
  res.json({
    ok: true,
    domain,
    pages,
    summary: { totalChecked: pages.length, reachable: reachable.length, avgCrawlScore: avgScore, elapsedMs, blockedAll },
    notice: blockedAll
      ? `${domain} is protected by an anti-bot service that returns HTTP 403 to all our requests. The pages exist — InfoGenie just can't fetch them from outside. Either whitelist our crawler in your WAF, or run this audit from inside your own infrastructure.`
      : null,
    dataOrigin: 'live_scrape',
    dataSource: 'http_fetch_with_browser_headers + on_page_signal_extraction',
    confidence: reachable.length >= 4 ? 'high' : reachable.length >= 2 ? 'medium' : 'low',
    transparency: `Audited ${pages.length} candidate paths on ${domain}; ${reachable.length} reachable. Each score combines title/meta length, heading structure, word count, JSON-LD schema, FAQ presence and internal link density.`,
  });
});

async function _fetchSerpTopForKeyword(keyword, countryCode = 2840, limit = 10) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { ok:false, error:'DataForSEO not configured', results:[] };
  const auth = 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
  try {
    const r = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method:'POST',
      headers:{ 'Authorization': auth, 'Content-Type':'application/json' },
      body: JSON.stringify([{ keyword, location_code: countryCode, language_code:'en', depth: limit, device:'desktop' }]),
    });
    const j = await r.json();
    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    const organic = items
      .filter(it => it.type === 'organic' && it.url)
      .slice(0, limit)
      .map((it, rank) => ({
        rank: rank + 1,
        url:    it.url,
        domain: it.domain,
        title:  it.title,
        snippet: it.description,
      }));
    return { ok:true, keyword, count: organic.length, results: organic };
  } catch (e) { return { ok:false, error: e.message, results:[] }; }
}

function _stripHtmlNoise(html) {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

// Returns structured on-page signals for SERP-match scoring. Pure regex, no
// DOM library — keeps memory bounded and works on partial responses.
function _extractContentSignals(html, sourceUrl = '') {
  const cleanHtml = _stripHtmlNoise(html);
  const titleMatch = cleanHtml.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const metaDescMatch = cleanHtml.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,400})["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : '';
  const h1s = (cleanHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || []).map(h => h.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()).filter(Boolean);
  const h2s = (cleanHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).map(h => h.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()).filter(Boolean);
  const h3s = (cleanHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi) || []).map(h => h.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()).filter(Boolean);
  const text = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  // Schema markup (JSON-LD blocks)
  const schemaBlocks = cleanHtml.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const schemaTypes = new Set();
  let hasFAQSchema = false;
  for (const block of schemaBlocks) {
    const inner = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
    try {
      const parsed = JSON.parse(inner);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of arr) {
        const collect = (n) => {
          if (!n || typeof n !== 'object') return;
          if (n['@type']) {
            const t = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
            t.forEach(x => { schemaTypes.add(String(x)); if (/FAQPage/i.test(String(x))) hasFAQSchema = true; });
          }
          if (Array.isArray(n['@graph'])) n['@graph'].forEach(collect);
        };
        collect(node);
      }
    } catch (_) { /* malformed JSON-LD — ignore */ }
  }
  // FAQ heuristic — H2/H3 ending with '?' counts as FAQ-style
  const faqStyleHeadings = [...h2s, ...h3s].filter(h => /\?\s*$/.test(h)).length;
  const hasFAQ = hasFAQSchema || faqStyleHeadings >= 3 || /<h[23][^>]*>\s*FAQ/i.test(cleanHtml);
  // Internal vs external links (only when sourceUrl supplied)
  let internalLinks = 0, externalLinks = 0;
  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
      const linkMatches = cleanHtml.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
      for (const m of linkMatches) {
        const hrefMatch = m.match(/href=["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        const href = hrefMatch[1];
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
        if (href.startsWith('/') || href.startsWith('?')) { internalLinks++; continue; }
        try {
          const linkHost = new URL(href, sourceUrl).hostname.replace(/^www\./, '');
          if (linkHost === host) internalLinks++; else externalLinks++;
        } catch (_) { /* skip malformed */ }
      }
    } catch (_) { /* skip */ }
  }
  return {
    title, metaDesc, h1s, h2s, h3s, wordCount,
    schemaTypes: Array.from(schemaTypes), hasFAQ, hasFAQSchema, faqStyleHeadings,
    internalLinks, externalLinks,
    text: text.slice(0, 4000), // for LSI extraction downstream
  };
}

// SSRF guard — block non-HTTP(S) protocols and any hostname that resolves to a
// private, loopback, link-local, or otherwise reserved IP range. Used for both
// user-supplied target URLs and (defence-in-depth) for SERP competitor URLs.
function _isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;                            // 10.0.0.0/8
    if (p[0] === 127) return true;                           // 127.0.0.0/8 loopback
    if (p[0] === 0) return true;                             // 0.0.0.0/8
    if (p[0] === 169 && p[1] === 254) return true;           // 169.254.0.0/16 link-local (incl. cloud metadata)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true;           // 192.168.0.0/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 100.64.0.0/10 CGNAT
    if (p[0] >= 224) return true;                            // multicast / reserved
    return false;
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;      // unspecified / loopback
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('fe80')) return true;               // link-local
    if (lower.startsWith('::ffff:')) return _isPrivateIp(lower.replace('::ffff:','')); // v4-mapped
    return false;
  }
  return true; // unknown form → reject
}

async function _isUrlSafeToFetch(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { return { ok:false, error:'Invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok:false, error:'Only http/https URLs are allowed' };
  const host = u.hostname;
  if (!host) return { ok:false, error:'Missing hostname' };
  // Block obvious local hostnames before doing DNS
  if (/^(localhost|metadata\.google\.internal|metadata\.goog)$/i.test(host)) return { ok:false, error:'Blocked hostname' };
  try {
    const records = await dns.lookup(host, { all:true });
    for (const rec of records) {
      if (_isPrivateIp(rec.address)) return { ok:false, error:`Hostname resolves to a private/internal IP (${rec.address})` };
    }
  } catch (e) {
    return { ok:false, error:'DNS lookup failed: ' + e.message };
  }
  return { ok:true };
}

// User-Agent rotation — real browsers, in priority order. Many WAFs (Cloudflare,
// Akamai, F5) hard-403 anything that *looks* like a bot UA. We start with a real
// Chrome UA, retry once with a Googlebot UA on 403/429 (some sites whitelist it
// for SEO crawlability), and finally a Safari UA as last resort.
const _SCRAPE_UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
];
async function _fetchWithBrowserHeaders(url, ua, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  // Build a realistic Referer for non-root paths (looks like the user clicked a
  // link from the homepage / Google) — strict bot walls weight this signal.
  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache',
  };
  try {
    const u = new URL(url);
    if (u.pathname && u.pathname !== '/' && u.pathname.length > 1) {
      // Pretend this hit came from Google search — common, benign pattern.
      headers['Referer'] = 'https://www.google.com/';
      headers['Sec-Fetch-Site'] = 'cross-site';
    }
  } catch (_) { /* malformed URL — let fetch surface the real error */ }
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers,
    });
    return r;
  } finally { clearTimeout(t); }
}
async function _scrapePageForScoring(url, timeoutMs = 9000) {
  try {
    const safety = await _isUrlSafeToFetch(url);
    if (!safety.ok) return { ok:false, url, error: safety.error };
    let r = null;
    let lastStatus = 0;
    for (const ua of _SCRAPE_UAS) {
      try {
        r = await _fetchWithBrowserHeaders(url, ua, timeoutMs);
        lastStatus = r.status;
        if (r.ok) break;
        // Only retry on bot-blocking statuses; everything else is a real page error
        if (![403, 429, 503].includes(r.status)) break;
      } catch (e) {
        if (e.name === 'AbortError') return { ok:false, url, error:'timeout' };
        // Network error — try next UA
        continue;
      }
    }
    // ── Firecrawl fallback for bot-blocked pages ────────────────────────────
    // When direct fetch returns 403/429/503 (Cloudflare / Akamai / PerimeterX),
    // try Firecrawl which uses its own headless-browser proxy network. Only
    // runs if FIRECRAWL_API_KEY is set; otherwise the original failure stands.
    if ((!r || !r.ok) && process.env.FIRECRAWL_API_KEY && [403, 429, 503].includes(lastStatus)) {
      const fc = await _firecrawlGetHtml(url, timeoutMs + 3000);
      if (fc.ok) {
        const signals = _extractContentSignals(fc.html.slice(0, 600 * 1024), url);
        return { ok:true, url, _via:'firecrawl', ...signals };
      }
    }
    if (!r) return { ok:false, url, error: `network failure` };
    if (!r.ok) return { ok:false, url, error: `HTTP ${lastStatus || r.status}` };
    // Cap at ~600KB to bound memory on bloated pages
    const buf = await r.arrayBuffer();
    const html = new TextDecoder('utf-8', { fatal:false }).decode(buf.slice(0, 600 * 1024));
    const signals = _extractContentSignals(html, url);
    return { ok:true, url, ...signals };
  } catch (e) {
    return { ok:false, url, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

// Content scorer analyze routes → services/content_scorer/routes.js
require('./services/content_scorer/routes')(app, { CONTENT_COUNTRY_CODES, _extractContentSignals, _fetchSerpTopForKeyword, _scrapePageForScoring, openaiChatWithRetry });

// ── Postgres init (T003 foundation) ──────────────────────────────────────────
// Boots the kv_store schema. Idempotent — subsequent boots no-op. If
// DATABASE_URL is unset (e.g. local dev without Replit Postgres), the kv
// helpers silently no-op so nothing breaks.
const _db = require('./db');
// ── Boot registry ───────────────────────────────────────────────────────────
// Every schema-ensure / cron-start step below registers itself here instead of
// running as its own fire-and-forget async IIFE. A single loop (see runBootTasks
// at the end of this block) awaits them in registration order, preserving the
// original source ordering and each task's own `_db.hasDb()` guard and logging.
const BOOT_TASKS = [];
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _db.ensureSchema();
      console.log('[db] kv_store ready.');
    } else {
      console.log('[db] DATABASE_URL not set — kv persistence disabled');
    }
  } catch (e) { console.error('[db] init failed:', e.message); }
});

// ── Credential vault — production secure-by-default: refuse to start without
//    a valid CREDENTIAL_ENCRYPTION_KEY. This MUST run synchronously at top
//    level (not inside a swallow-catching async IIFE) so a missing/malformed
//    key crashes the process with a non-zero exit code.
try {
  _credentialsVault.assertBootRequirements();
} catch (e) {
  console.error('[credentials-vault] FATAL —', e.message);
  process.exit(1);
}

// ── Platform Auth (users / sessions / social login) ──────────────────────────
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _authSchema.ensureAuthSchema();
      try {
        await _credentialsVault.ensureCredentialsSchema();
      } catch (e) {
        console.error('[credentials-vault] schema init failed:', e.message);
        if (process.env.NODE_ENV === 'production') {
          // Hard-fail in production — a broken vault schema is a data-integrity risk.
          process.exit(1);
        }
      }
      // Platform API keys (Task 136): create the platform_api_keys table, then
      // overlay any admin-managed values onto process.env so the rest of the app
      // (which reads process.env.X directly) transparently uses them. Finally
      // rebuild the shared OpenAI/Anthropic clients in case their keys changed.
      try {
        await _platformKeys.ensurePlatformKeysSchema();
        await _platformKeys.hydrate();
        _rebuildAiClients();
      } catch (e) {
        console.error('[platform-keys] init failed:', e.message);
      }
      // Multi-tenancy foundation (Phase 1): tenants + roles + memberships +
      // backfill of existing users into personal tenants. Additive only —
      // does not modify any existing table.
      try {
        await _tenantSchema.ensureTenantSchema();
      } catch (e) {
        console.error('[tenants] schema init failed:', e.message);
        if (process.env.NODE_ENV === 'production') process.exit(1);
      }
      // Admin Portal (Task 10): clients + issues tables, tenant data-mode
      // default column, platform data-mode default seed. Runs after tenants
      // schema so the FK to tenants(id) exists.
      try {
        await require('./services/admin/schema').ensureAdminSchema();
      } catch (e) {
        console.error('[admin] schema init failed:', e.message);
      }
      // Phase 2 mass migration: add tenant_id column + index + backfill to
      // every business table. Deferred 8s so all parallel `ensureXSchema()`
      // CREATE TABLE statements have completed first. Fully idempotent —
      // safe to re-run on every boot. Any table missing on first pass is
      // logged and picked up on the next restart.
      setTimeout(() => {
        require('./services/tenants/phase2_migrate')
          .runPhase2Migration()
          .catch(e => console.error('[tenants/phase2] failed:', e.message));
      }, 8000);
    } else {
      console.warn('[auth] disabled — DATABASE_URL not set. Sessions will be in-memory and lost on restart.');
    }
  } catch (e) { console.error('[auth] schema init failed:', e.message); }
});

// ── Autonomous Campaign Optimizer (Phase 1: ingest + rule-based) ──────────────
// Boots the optimizer schema, mounts /api/optimizer routes, and starts two
// crons: hourly Insights ingest and 6-hourly rule evaluation. All optimizer
// work is dry-run by default (logs decisions but does NOT call platform APIs)
// until the user explicitly toggles `dryRun=false` from the dashboard.
const _optimizerSchema   = require('./services/optimizer/schema');
const _optimizerIngest   = require('./services/optimizer/ingest');
const _optimizerRules    = require('./services/optimizer/rules');
const _optimizerCreative = require('./services/optimizer/creative_refresh');
const _optimizerBandit   = require('./services/optimizer/bandit');
const _optimizerRouter   = require('./services/optimizer/api');
app.use('/api/optimizer', _optimizerRouter);
// ── Dynamic Audiences (Drip-style real-time segments) ──────────────────────
const _audiencesSchema = require('./services/audiences/schema');
const _audiencesRouter = require('./services/audiences/api');
app.use('/api/audiences', _audiencesRouter);
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _audiencesSchema.ensureAudiencesSchema();
      const _audiencesSweep = require('./services/audiences/sweep');
      _audiencesSweep.startSweepCron(15); // every 15 minutes
      console.log('[audiences] schema ready, sweep cron=15m (Phase 2 — real-time evaluation)');
    } else {
      console.log('[audiences] disabled — DATABASE_URL not set');
    }
  } catch (e) { console.error('[audiences] init failed:', e.message); }
});
// ── Search & AI Visibility Intelligence (Tier 1) ──────────────────────────
const _searchIntelSchema = require('./services/search_intel/schema');
const _searchIntelRouter = require('./services/search_intel/api');
app.use('/api/search-intel', _searchIntelRouter);
const _exportsRouter = require('./services/exports/api');
app.use('/api/exports', _exportsRouter);

// ── Customer Journey Builder + Signal Triggers + Omni-Channel ─────────────
const _journeySchema    = require('./services/journey_builder/schema');
const _journeyRouter    = require('./services/journey_builder/api');
const _journeyRunner    = require('./services/journey_builder/runner');
const _signalSchema     = require('./services/signal_triggers/schema');
const _signalRouter     = require('./services/signal_triggers/api');
const _omniRouter       = require('./services/omnichannel/api');
const _webpushSvc       = require('./services/omnichannel/webpush');
app.use('/api/journeys', _journeyRouter);
app.use('/api/signal-triggers', _signalRouter);
app.use('/api/omnichannel', _omniRouter);
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _journeySchema.ensureJourneySchema();
      await _signalSchema.ensureSignalTriggersSchema();
      await _webpushSvc.ensureWebPushSchema();
      _journeyRunner.startRunner();
      console.log('[journey-builder + signal-triggers + omnichannel] ready');
    } else {
      console.log('[journey-builder] disabled — DATABASE_URL not set');
    }
  } catch (e) { console.error('[journey-builder] init failed:', e.message); }
});

// ── Marketing Projects + Brand Calendar + Budget Board + Web Analytics ────
const _projectsSchema  = require('./services/projects/schema');
const _projectsRouter  = require('./services/projects/api');
const _okrSchema       = require('./services/okr/schema');
const _okrRouter       = require('./services/okr/api');
const _bcalSchema      = require('./services/brand_calendar/schema');
const _bcalRouter      = require('./services/brand_calendar/api');
const _budgetSchema    = require('./services/budget_board/schema');
const _budgetRouter    = require('./services/budget_board/api');
const _webAnalRouter   = require('./services/web_analytics/api');
app.use('/api/projects',        _projectsRouter);
app.use('/api/okr',             _okrRouter);
app.use('/api/brand-calendar',  _bcalRouter);
app.use('/api/budget',          _budgetRouter);
app.use('/api/web-analytics',   _webAnalRouter);
app.use('/api/playbook',        require('./services/playbook_7day/api'));
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _projectsSchema.ensureProjectsSchema();
      await _okrSchema.ensureOkrSchema();
      await _bcalSchema.ensureBrandCalendarSchema();
      await _budgetSchema.ensureBudgetSchema();
      console.log('[projects + brand-calendar + budget-board + web-analytics] ready');
    }
  } catch (e) { console.error('[projects-pack] init failed:', e.message); }
});
console.log('[exports] mounted at /api/exports (formats: pptx, pdf, xlsx)');
const _influencerSchema = require('./services/influencers/schema');
const _influencerRouter = require('./services/influencers/api');
app.use('/api/influencers', _influencerRouter);
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) { await _influencerSchema.ensureInfluencerSchema(); console.log('[influencers] schema ready'); } } catch(e) { console.error('[influencers] init failed:', e.message); } });

// ── Tier 2 ─────────────────────────────────────────────────────────────────
const _crisisSchema   = require('./services/crisis_radar/schema');
const _crisisRouter   = require('./services/crisis_radar/api');
const _crisisDetector = require('./services/crisis_radar/detector');
const _battleSchema   = require('./services/battle_cards/schema');
const _battleRouter   = require('./services/battle_cards/api');
const _trendsRouter   = require('./services/trends/api');
app.use('/api/crisis-radar',   _crisisRouter);
app.use('/api/battle-cards',   _battleRouter);
app.use('/api/trends',         _trendsRouter);

// ── Tier 3 ─────────────────────────────────────────────────────────────────
const _sovSchema    = require('./services/sov/schema');
const _sovRouter    = require('./services/sov/api');
const _discoveryRouter = require('./services/discovery/api');
app.use('/api/sov',       _sovRouter);
app.use('/api/discovery', _discoveryRouter);

// ── Tier 4 ─────────────────────────────────────────────────────────────────
const _digestSchema = require('./services/digest/schema');
const _digestRouter = require('./services/digest/api');
const _replyRouter  = require('./services/reply_assistant/api');
app.use('/api/digest',          _digestRouter);
app.use('/api/reply-assistant', _replyRouter);

// ── Tier 5 ─────────────────────────────────────────────────────────────────
const _pressRouter      = require('./services/press_release/api');
const _alertRouteSchema = require('./services/alert_routing/schema');
const _alertRouteRouter = require('./services/alert_routing/api');
app.use('/api/press-release',  _pressRouter);
app.use('/api/alert-routing',  _alertRouteRouter);

// ── Tier 6 ─────────────────────────────────────────────────────────────────
const _backlinksRouter   = require('./services/backlinks/api');
const _calendarSchema    = require('./services/content_calendar/schema');
const _calendarRouter    = require('./services/content_calendar/api');
app.use('/api/backlinks',         _backlinksRouter);
app.use('/api/content-calendar',  _calendarRouter);

// ── T35 — Bulk Reporting + Backlink Change Monitoring ──────────────────────
const _bulkReportSchema  = require('./services/bulk_reporting/schema');
const _bulkReportRouter  = require('./services/bulk_reporting/api');
const _blMonitorSchema   = require('./services/backlink_monitor/schema');
const _blMonitorRouter   = require('./services/backlink_monitor/api');
app.use('/api/bulk-reports',      _bulkReportRouter);
app.use('/api/backlink-monitor',  _blMonitorRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _bulkReportSchema.ensureBulkReportingSchema();
    await _blMonitorSchema.ensureBacklinkMonitorSchema();
    _bulkReportRouter.resumePendingRuns();
    _blMonitorRouter.startCron();
    console.log('[t35] bulk-reports + backlink-monitor schemas ready');
  }
} catch (e) { console.warn('[t35] init failed:', e.message); }});

// ── T36 — True ROAS (offline conversions + profit-aware budget recs) ───────
const _trueRoasSchema = require('./services/true_roas/schema');
const _trueRoasRouter = require('./services/true_roas/api');
app.use('/api/true-roas', _trueRoasRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _trueRoasSchema.ensureTrueRoasSchema();
    _trueRoasRouter.startCron();
    console.log('[t36] true-roas schema ready');
  }
} catch (e) { console.warn('[t36] init failed:', e.message); }});

// ── T37 — Get-Started Roadmap (90-day plan + weekly social cadence) ─────────
const _roadmapSchema = require('./services/roadmap/schema');
const _roadmapRouter = require('./services/roadmap/api');
app.use('/api/roadmap', _roadmapRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _roadmapSchema.ensureRoadmapSchema();
    console.log('[t37] roadmap schema ready');
  }
} catch (e) { console.warn('[t37] init failed:', e.message); }});

// ── T38 — Carousel Generator (Hook→Context→Value→Action × 4 structures) ─────
const _carouselSchema = require('./services/carousel/schema');
const _carouselRouter = require('./services/carousel/api');
app.use('/api/carousel', _carouselRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _carouselSchema.ensureCarouselSchema();
    console.log('[t38] carousel schema ready');
  }
} catch (e) { console.warn('[t38] init failed:', e.message); }});

// ── T40 — Post Performance · Email Broadcast + Tracking ─────────────────────
const _ebRouter = require('./services/email_broadcast/api');
const _ebSchema = require('./services/email_broadcast/schema');
app.use('/api/email-broadcast', _ebRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _ebSchema.ensureEmailBroadcastSchema();
    console.log('[t40] email-broadcast schema ready');
  }
} catch (e) { console.warn('[t40] init failed:', e.message); }});

// ── T41 — Hunter · LinkedIn Ads · Canva Bridge · CRM Sync ───────────────────
const _hunterRouter   = require('./services/hunter/api');
const _hunterSchema   = require('./services/hunter/schema');
const _linkedinRouter = require('./services/linkedin_ads/api');
const _linkedinSchema = require('./services/linkedin_ads/schema');
const _canvaRouter    = require('./services/canva_bridge/api');
const _crmRouter      = require('./services/crm_sync/api');
const _crmSchema      = require('./services/crm_sync/schema');
app.use('/api/hunter',       _hunterRouter);
app.use('/api/linkedin-ads',    _linkedinRouter);
app.use('/api/canva',          _canvaRouter);
app.use('/api/crm-sync',       _crmRouter);
app.use('/api/tools/remove-bg',  require('./services/remove_bg/api'));
app.use('/api/advocacy',         require('./services/employee_advocacy/api'));
app.use('/api/social-listening', require('./services/social_listening/api'));
app.use('/api/media-intel',      require('./services/media_intel/api'));
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _hunterSchema.ensureHunterSchema();
    await _linkedinSchema.ensureLinkedinAdsSchema();
    await _crmSchema.ensureCrmSyncSchema();
    console.log('[t41] hunter + linkedin-ads + crm-sync schemas ready');
  }
} catch (e) { console.warn('[t41] init failed:', e.message); }});

// ── T42 — Employee Advocacy · Social Listening · Media Intelligence ──────────
const _advocacySchema  = require('./services/employee_advocacy/schema');
const _mediaIntelSchema = require('./services/media_intel/schema');
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _advocacySchema.ensureAdvocacySchema();
    await _mediaIntelSchema.ensureMediaIntelSchema();
    console.log('[t42] advocacy + media-intel schemas ready');
  }
} catch (e) { console.warn('[t42] init failed:', e.message); }});

// ── T39 — Content Score Auto-Optimize · AI Traffic Monitor ──────────────────
const _csRouter    = require('./services/content_score/api');
const _csSchema    = require('./services/content_score/schema');
const _atRouter    = require('./services/ai_traffic/api');
const _atSchema    = require('./services/ai_traffic/schema');
app.use('/api/content-score', _csRouter);
app.use('/api/ai-traffic', _atRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _csSchema.ensureContentScoreSchema();
    await _atSchema.ensureAiTrafficSchema();
    console.log('[t39] content-score + ai-traffic schemas ready');
  }
} catch (e) { console.warn('[t39] init failed:', e.message); }});

// ── T40 — Hashtag Intelligence (Instagram & TikTok) ─────────────────────────
const _hashtagIntelRouter = require('./services/hashtag_intel/api');
const _hashtagIntelSchema = require('./services/hashtag_intel/schema');
app.use('/api/hashtag-intel', _hashtagIntelRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _hashtagIntelSchema.ensureHashtagIntelSchema();
    console.log('[t40] hashtag-intel schema ready');
  }
} catch (e) { console.warn('[t40] hashtag-intel init failed:', e.message); }});

// ── T41 — Google Maps Competitor Intelligence ────────────────────────────────
const _mapsIntelRouter = require('./services/maps_intel/api');
const _mapsIntelSchema = require('./services/maps_intel/schema');
app.use('/api/maps-intel', _mapsIntelRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _mapsIntelSchema.ensureMapsIntelSchema();
    console.log('[t41] maps-intel schema ready');
  }
} catch (e) { console.warn('[t41] maps-intel init failed:', e.message); }});

// ── T42 — Creative Intelligence (What Makes Content Perform) ─────────────────
const _creativeIntelRouter = require('./services/creative_intel/api');
const _creativeIntelSchema = require('./services/creative_intel/schema');
app.use('/api/creative-intel', _creativeIntelRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _creativeIntelSchema.ensureCreativeIntelSchema();
    console.log('[t42] creative-intel schema ready');
  }
} catch (e) { console.warn('[t42] creative-intel init failed:', e.message); }});

// ── T43 — YouTube Comment Mining for Content Ideas ───────────────────────────
const _ytCommentMinerRouter = require('./services/yt_comment_miner/api');
const _ytCommentMinerSchema = require('./services/yt_comment_miner/schema');
app.use('/api/yt-comment-miner', _ytCommentMinerRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _ytCommentMinerSchema.ensureYtCommentMinerSchema();
    console.log('[t43] yt-comment-miner schema ready');
  }
} catch (e) { console.warn('[t43] yt-comment-miner init failed:', e.message); }});

// ── T44 — Automated Link Prospecting ─────────────────────────────────────────
const _linkProspectorRouter = require('./services/link_prospector/api');
const _linkProspectorSchema = require('./services/link_prospector/schema');
app.use('/api/link-prospector', _linkProspectorRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _linkProspectorSchema.ensureLinkProspectorSchema();
    console.log('[t44] link-prospector schema ready');
  }
} catch (e) { console.warn('[t44] link-prospector init failed:', e.message); }});

// ── T47-T50: WordPress Publishing · Content Modes · Autopilot · Audio ──────
const _wpRouter           = require('./services/wordpress/api');
const _wpSchema           = require('./services/wordpress/schema');
const _contentModesRouter = require('./services/content_modes/api');
const _contentModesSchema = require('./services/content_modes/schema');
const _autopilotRouter    = require('./services/autopilot/api');
const _autopilotSchema    = require('./services/autopilot/schema');
const _audioSummaryRouter = require('./services/audio_summary/api');
const _adCreativeRouter   = require('./services/ad_creative/api');
const _adCreativeSchema   = require('./services/ad_creative/schema');
const _ideaFeedRouter     = require('./services/idea_feed/api');
const _ideaFeedSchema     = require('./services/idea_feed/schema');
app.use('/api/wordpress',      _wpRouter);
app.use('/api/content-modes',  _contentModesRouter);
app.use('/api/autopilot',      _autopilotRouter);
app.use('/api/audio-summary',  _audioSummaryRouter);
app.use('/api/ad-creative',    _adCreativeRouter);
app.use('/api/idea-feed',      _ideaFeedRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _wpSchema.ensureWordpressSchema();
    await _contentModesSchema.ensureContentModesSchema();
    await _autopilotSchema.ensureAutopilotSchema();
    _autopilotRouter.startAutopilotCron();
    await _adCreativeSchema.ensureAdCreativeSchema();
    await _ideaFeedSchema.ensureIdeaFeedSchema();
    console.log('[t47-55] wordpress + content-modes + autopilot + audio-summary + ad-creative + idea-feed ready');
  }
} catch (e) { console.warn('[t47-55] init failed:', e.message); }});

// ── T60-T64: AI Persona Studio · iROAS · Agent Goals · Ecom Video · Brand Deals ──
const _personaRouter      = require('./services/persona/api');
const _personaSchema      = require('./services/persona/schema');
const _iroasRouter        = require('./services/iroas/api');
const _iroasSchema        = require('./services/iroas/schema');
const _agentGoalsRouter   = require('./services/agent_goals/api');
const _agentGoalsSchema   = require('./services/agent_goals/schema');
const _brandDealsRouter   = require('./services/brand_deals/api');
const _brandDealsSchema   = require('./services/brand_deals/schema');
app.use('/api/personas',      _personaRouter);
app.use('/api/iroas',         _iroasRouter);
app.use('/api/agent-goals',   _agentGoalsRouter);
app.use('/api/brand-deals',   _brandDealsRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _personaSchema.ensurePersonaSchema();
    await _iroasSchema.ensureIroasSchema();
    await _agentGoalsSchema.ensureAgentGoalsSchema();
    await _brandDealsSchema.ensureBrandDealsSchema();
    console.log('[t60-64] persona + iroas + agent-goals + brand-deals ready');
  }
} catch (e) { console.warn('[t60-64] init failed:', e.message); }});

// ── E-commerce Product Video (T63) ──────────────────────────────────────────
app.post('/api/ecom-video/generate', async (req, res) => {
  try {
    const _tenantCtx = require('./services/tenants/context');
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'ecom-video:generate' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const OpenAI = require('openai');
    const oa = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const { product_name, product_description, target_audience, video_style, platform, persona_name } = req.body;
    if (!product_name) return res.status(400).json({ error: 'product_name required' });

    const completion = await oa.chat.completions.create({
      model: 'gpt-5',
      messages: [{
        role: 'user',
        content: `You are a world-class e-commerce video director. Create a compelling product video storyboard for:
Product: ${product_name}
Description: ${product_description || 'Not provided'}
Target audience: ${target_audience || 'general consumers'}
Platform: ${platform || 'Instagram Reels / TikTok'}
Style: ${video_style || 'lifestyle + demo hybrid'}
${persona_name ? `Presenter: ${persona_name} (AI influencer persona)` : ''}

Generate a 6-scene video storyboard optimised for conversion. Each scene has a shot, action, voiceover, and text overlay.
Return JSON: {"title":"...","duration_seconds":30,"hook":"...","scenes":[{"scene":1,"shot_type":"...","action":"...","voiceover":"...","text_overlay":"...","duration_s":5}],"cta":"...","caption":"...","hashtags":["..."]}`
      }],
      response_format: { type: 'json_object' }, max_tokens: 1200
    });

    let result = {};
    try { result = JSON.parse(completion.choices[0].message.content); } catch (_) {}
    if (result._DUMMY || !result.scenes) {
      result = {
        title: `${product_name} — 30s Product Video`,
        duration_seconds: 30,
        hook: `Wait — have you seen what ${product_name} actually does?`,
        scenes: [
          { scene: 1, shot_type: 'Close-up', action: 'Product reveal from packaging', voiceover: `Introducing ${product_name}`, text_overlay: product_name, duration_s: 4 },
          { scene: 2, shot_type: 'Medium shot', action: 'Lifestyle context shot — product in use', voiceover: product_description || 'The product you didn\'t know you needed', text_overlay: 'Before vs After', duration_s: 5 },
          { scene: 3, shot_type: 'Close-up detail', action: 'Key feature highlight with zoom', voiceover: 'Here\'s why it\'s different', text_overlay: 'Key Feature', duration_s: 5 },
          { scene: 4, shot_type: 'B-roll', action: 'Happy customer / results shot', voiceover: 'Thousands of people already love it', text_overlay: '⭐⭐⭐⭐⭐ 4.9 rating', duration_s: 5 },
          { scene: 5, shot_type: 'Product flat lay', action: 'All variants / what\'s included', voiceover: 'Everything you need, nothing you don\'t', text_overlay: 'What\'s Inside', duration_s: 5 },
          { scene: 6, shot_type: 'CTA card', action: 'Link in bio / swipe up animation', voiceover: 'Get yours — link in bio', text_overlay: 'Shop Now 🛒', duration_s: 6 }
        ],
        cta: 'Link in bio — limited stock',
        caption: `You need to try ${product_name} 🔥 Link in bio 👆`,
        hashtags: ['#productreview', '#musthave', '#amazonfinds', '#tiktokmademebuyit'],
        source: 'template'
      };
    }
    res.json({ storyboard: result, source: result.source || 'gpt-5' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Veo 3 Video Generation ─────────────────────────────────────────────────
app.post('/api/ecom-video/render-veo', async (req, res) => {
  try {
    const _tenantCtx = require('./services/tenants/context');
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'ecom-video:render-veo' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey || /^_DUMMY/i.test(geminiKey)) {
      return res.status(503).json({ error: 'GEMINI_API_KEY required for Veo 3 video generation' });
    }
    const { prompt, aspect_ratio = '9:16', duration_seconds = 5 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const _h = require('https');
    const body = JSON.stringify({
      prompt: { text: String(prompt).slice(0, 500) },
      generationConfig: {
        durationSeconds: Math.min(8, Math.max(4, parseInt(duration_seconds) || 5)),
        aspectRatio: aspect_ratio,
        numberOfVideos: 1,
        personGeneration: 'DONT_ALLOW'
      }
    });
    const opName = await new Promise((resolve, reject) => {
      const r = _h.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/veo-003:generateVideo?key=${geminiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, resp => {
        let d = ''; resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.error) return reject(new Error(j.error.message || JSON.stringify(j.error)));
            if (!j.name) return reject(new Error('No operation returned from Veo API'));
            resolve(j.name);
          } catch (e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.setTimeout(30000, () => { r.destroy(); reject(new Error('Veo API submission timed out')); });
      r.write(body); r.end();
    });
    res.json({ ok: true, operation_id: opName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ecom-video/veo-status', async (req, res) => {
  try {
    const _tenantCtx = require('./services/tenants/context');
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'ecom-video:veo-status' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey || /^_DUMMY/i.test(geminiKey)) return res.status(503).json({ error: 'No Gemini key' });
    const opName = req.query.op;
    if (!opName || !/^operations\//.test(opName)) return res.status(400).json({ error: 'Invalid operation id' });
    const _h = require('https');
    const poll = await new Promise((resolve, reject) => {
      const r = _h.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/${opName}?key=${geminiKey}`,
        method: 'GET'
      }, resp => {
        let d = ''; resp.on('data', c => d += c);
        resp.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      });
      r.on('error', reject);
      r.setTimeout(20000, () => { r.destroy(); reject(new Error('Poll timeout')); });
      r.end();
    });
    if (poll.error) return res.status(500).json({ error: poll.error.message || 'Operation error' });
    if (!poll.done) return res.json({ status: 'pending', progress: poll.metadata?.progressPercent || null });
    const samples = poll.response?.generateVideoResponse?.generatedSamples ||
                    poll.response?.generatedSamples || [];
    if (!samples.length) return res.json({ status: 'failed', error: 'No video generated' });
    const videoUri = samples[0]?.video?.uri;
    const mimeType = samples[0]?.video?.mimeType || 'video/mp4';
    if (!videoUri) return res.json({ status: 'failed', error: 'No video URI in Veo response' });
    const _h2 = require('https');
    const videoB64 = await new Promise((resolve, reject) => {
      const fullUrl = videoUri + (videoUri.includes('?') ? '&' : '?') + `key=${geminiKey}`;
      const u = new URL(fullUrl);
      const r = _h2.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' }, resp => {
        const chunks = []; resp.on('data', c => chunks.push(c));
        resp.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      });
      r.on('error', reject);
      r.setTimeout(60000, () => { r.destroy(); reject(new Error('Video download timeout')); });
      r.end();
    });
    res.json({ status: 'complete', video_base64: videoB64, mime_type: mimeType });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Settings: simple API-key vault (tenant-scoped, Postgres kv_store) ─────
// POST /api/settings/api-key  { platform, key }  → saves encrypted key
// GET  /api/settings/api-key/:platform           → { ok, configured: bool }
// Platform-owned API keys are managed only via the admin "Platform APIs" tab
// (POST/GET /api/admin/platform-keys). Block non-admins from reading or writing
// those key names through the tenant-scoped user settings vault (Task 136).
function _settingsCallerIsPlatformAdmin(req) {
  if (!req.user) return false;
  if (req.user.isOwner === true) return true;
  const k = req.platformRole && req.platformRole.key;
  return k === 'platform_owner' || k === 'platform_admin';
}
app.post('/api/settings/api-key', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Login required' });
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'settings:save-api-key' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { platform, key } = req.body || {};
    if (!platform || typeof platform !== 'string' || !platform.trim())
      return res.status(400).json({ ok: false, error: 'platform required' });
    if (_platformKeys.isPlatformKeyName(platform) && !_settingsCallerIsPlatformAdmin(req))
      return res.status(403).json({ ok: false, error: 'platform_key_admin_only' });
    if (!key || typeof key !== 'string' || !key.trim())
      return res.status(400).json({ ok: false, error: 'key required' });
    const _vault = require('./services/credentials/vault');
    await _vault.setApiKey(tid, platform.toLowerCase().trim(), key.trim());
    console.log(`[settings] api-key saved: platform=${platform.toLowerCase().trim()} tid=${tid}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[settings] api-key save error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get('/api/settings/api-key/:platform', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Login required' });
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'settings:get-api-key' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    if (_platformKeys.isPlatformKeyName(req.params.platform) && !_settingsCallerIsPlatformAdmin(req))
      return res.status(403).json({ ok: false, error: 'platform_key_admin_only' });
    const _vault = require('./services/credentials/vault');
    const k = await _vault.getApiKey(tid, req.params.platform.toLowerCase().trim());
    res.json({ ok: true, configured: !!(k && k.trim()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/settings/api-key/youtube-data/test?key=<api_key>
// Performs a live probe against the YouTube Data API v3 using the supplied key.
// Returns { ok, status: "verified"|"rejected"|"error", message }.
app.get('/api/settings/api-key/youtube-data/test', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Login required' });
    const key = (req.query.key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'key query param required' });
    const _https = require('https');
    const url = `https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=${encodeURIComponent(key)}`;
    const result = await new Promise((resolve) => {
      const req2 = _https.get(url, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (r.statusCode === 200 && data.items && data.items.length > 0) {
              resolve({ status: 'verified', message: 'YouTube Data API key confirmed live — connection active' });
            } else if (r.statusCode === 400 && data.error) {
              const reason = (data.error.errors && data.error.errors[0] && data.error.errors[0].reason) || '';
              if (reason === 'keyInvalid') {
                resolve({ status: 'rejected', message: 'YouTube rejected this key — it is invalid or not enabled for YouTube Data API v3' });
              } else {
                resolve({ status: 'rejected', message: `YouTube returned an error: ${data.error.message || 'bad request'}` });
              }
            } else if (r.statusCode === 403 && data.error) {
              const reason = (data.error.errors && data.error.errors[0] && data.error.errors[0].reason) || '';
              if (reason === 'accessNotConfigured') {
                resolve({ status: 'rejected', message: 'YouTube Data API v3 is not enabled — go to your Google Cloud Console API Library and enable it' });
              } else if (reason === 'quotaExceeded') {
                resolve({ status: 'rejected', message: 'Daily quota exceeded — check your Google Cloud Console quotas' });
              } else {
                resolve({ status: 'rejected', message: `YouTube API access denied: ${data.error.message || 'forbidden'}` });
              }
            } else {
              resolve({ status: 'rejected', message: `YouTube returned HTTP ${r.statusCode} — check the key is correct and the API is enabled` });
            }
          } catch {
            resolve({ status: 'error', message: 'Could not parse YouTube API response' });
          }
        });
      });
      req2.on('error', (e) => resolve({ status: 'error', message: `Network error reaching YouTube API: ${e.message}` }));
      req2.setTimeout(8000, () => { req2.destroy(); resolve({ status: 'error', message: 'YouTube API request timed out' }); });
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[youtube-data-test]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── T65-T66: Apify — Organic Social Monitor · Local Lead Finder ──────────
const _apifyRouter = require('./services/apify/api');
app.use('/api/apify', _apifyRouter);

// ── Growth Flywheel + SEO Roadmap ─────────────────────────────────────────
const _flywheelRouter   = require('./services/flywheel/api');
const _seoRoadmapRouter = require('./services/seo_roadmap/api');
app.use('/api/flywheel',     _flywheelRouter);
app.use('/api/seo-roadmap',  _seoRoadmapRouter);

// ── T56-T59: Pitch Deck · Accessibility Audit · Wireframe Generator ──────
const _pitchDeckRouter      = require('./services/pitch_deck/api');
const _pitchDeckSchema      = require('./services/pitch_deck/schema');
const _accessibilityRouter  = require('./services/accessibility/api');
const _accessibilitySchema  = require('./services/accessibility/schema');
const _wireframeRouter      = require('./services/wireframe/api');
const _wireframeSchema      = require('./services/wireframe/schema');
app.use('/api/pitch-deck',      _pitchDeckRouter);
app.use('/api/accessibility',   _accessibilityRouter);
app.use('/api/wireframe',       _wireframeRouter);
BOOT_TASKS.push(async () => { try {
  if (_db.hasDb()) {
    await _pitchDeckSchema.ensurePitchDeckSchema();
    await _accessibilitySchema.ensureAccessibilitySchema();
    await _wireframeSchema.ensureWireframeSchema();
    console.log('[t56-59] pitch-deck + accessibility + wireframe ready');
  }
} catch (e) { console.warn('[t56-59] init failed:', e.message); }});

// ── Tier 7 ─────────────────────────────────────────────────────────────────
const _podcastSchema = require('./services/podcast_monitor/schema');
const _podcastRouter = require('./services/podcast_monitor/api');
const _abdSchema     = require('./services/ab_designer/schema');
const _abdRouter     = require('./services/ab_designer/api');
app.use('/api/podcast-monitor', _podcastRouter);
app.use('/api/ab-designer',     _abdRouter);

// ── Tier 8 ─────────────────────────────────────────────────────────────────
const _vocSchema   = require('./services/voc/schema');
const _vocRouter   = require('./services/voc/api')({ callDataForSEO, openaiChatWithRetry });
const _pwSchema    = require('./services/pricing_watch/schema');
const _pwRouter    = require('./services/pricing_watch/api');
app.use('/api/voc',            _vocRouter);
app.use('/api/pricing-watch',  _pwRouter);

// Customer 360 — unified account view (aggregates brand foundation, VoC,
// leads, audience segments, brand deals; no dedicated schema of its own).
const _customer360Router = require('./services/customer_360/api');
app.use('/api/customer-360', _customer360Router);

// ── T73-T80 Intelligence Tools ────────────────────────────────────────────
const _cmSchema        = require('./services/change_monitor/schema');
const _cmRouter        = require('./services/change_monitor/api');
const _crRouter        = require('./services/conversion_recovery/api');
const _wxRouter        = require('./services/web_extractor/api');
const _rsRouter        = require('./services/recipe_scraper/api');
const _laRouter        = require('./services/lead_aggregator/api');
const _dmRouter        = require('./services/dataset_market/api');
const _mcRouter        = require('./services/model_compare/api');
const _rtSchema        = require('./services/resilient_tracker/schema');
const _rtRouter        = require('./services/resilient_tracker/api');
app.use('/api/change-monitor',       _cmRouter);
app.use('/api/conversion-recovery',  _crRouter);
app.use('/api/web-extractor',        _wxRouter);
app.use('/api/recipe-scraper',       _rsRouter);
app.use('/api/lead-aggregator',      _laRouter);
app.use('/api/dataset-market',       _dmRouter);
app.use('/api/model-compare',        _mcRouter);
app.use('/api/resilient-tracker',    _rtRouter);
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) { await _cmSchema.ensureChangeMonitorSchema(); await _rtSchema.ensureResilientTrackerSchema(); } } catch(e) { console.warn('[t73-t80] schema init failed:', e.message); } });

// ── Ad Comment Monitor ───────────────────────────────────────────────────────
const _adCommentsSchema = require('./services/ad_comments/schema');
const _adCommentsRouter = require('./services/ad_comments/api');
app.use('/api/ad-comments', _adCommentsRouter);

// ── Tier 89-94 ──────────────────────────────────────────────────────────────
const _decisionEngineSchema  = require('./services/decision_engine/schema');
const _decisionEngineRouter  = require('./services/decision_engine/api');
const _experimentSuiteSchema = require('./services/experiment_suite/schema');
const _experimentSuiteRouter = require('./services/experiment_suite/api');
const _identitySpineSchema   = require('./services/identity_spine/schema');
const _identitySpineRouter   = require('./services/identity_spine/api');
const _approvalWfSchema      = require('./services/approval_workflows/schema');
const _approvalWfRouter      = require('./services/approval_workflows/api');
const _aiAnswerSovSchema     = require('./services/ai_answer_sov/schema');
const _aiAnswerSovRouter     = require('./services/ai_answer_sov/api');
const _revenueIntelSchema    = require('./services/revenue_intel/schema');
const _revenueIntelRouter    = require('./services/revenue_intel/api');
const _dataProductsSchema    = require('./services/data_products/schema');
const _dataProductsRouter    = require('./services/data_products/api');
const _benchmarksSchema   = require('./services/benchmarks/schema');
const _benchmarksRouter   = require('./services/benchmarks/api');
const _mmmSchema          = require('./services/mmm/schema');
const _mmmRouter          = require('./services/mmm/api');
const _brandSafetySchema  = require('./services/brand_safety/schema');
const _brandSafetyRouter  = require('./services/brand_safety/api');
const _safeAgentSchema    = require('./services/safe_agent/schema');
const _safeAgentRouter    = require('./services/safe_agent/api');
const _provenanceSchema   = require('./services/data_provenance/schema');
const _provenanceRouter   = require('./services/data_provenance/api');
const _playbooksSchema    = require('./services/vertical_playbooks/schema');
const _playbooksRouter    = require('./services/vertical_playbooks/api');
app.use('/api/decision-engine',  _decisionEngineRouter);
app.use('/api/experiments',      _experimentSuiteRouter);
app.use('/api/identity',         _identitySpineRouter);  // includes /stitch + /merge (profile stitching)
app.use('/api/approvals',        _approvalWfRouter);
app.use('/api/ai-answer-sov',    _aiAnswerSovRouter);
app.use('/api/revenue-intel',    _revenueIntelRouter);
app.use('/api/data-products',    _dataProductsRouter);
app.use('/api/benchmarks',      _benchmarksRouter);
app.use('/api/mmm',             _mmmRouter);
app.use('/api/brand-safety',    _brandSafetyRouter);
app.use('/api/safe-agent',      _safeAgentRouter);
app.use('/api/data-provenance', _provenanceRouter);
app.use('/api/playbooks',       _playbooksRouter);
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) { await _adCommentsSchema.ensureAdCommentsSchema(); } } catch(e) { console.warn('[ad-comments] schema init failed:', e.message); } });
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) {
  await _decisionEngineSchema.ensureDecisionEngineSchema();
  await _experimentSuiteSchema.ensureExperimentSuiteSchema();
  await _identitySpineSchema.ensureIdentitySpineSchema();
  await _approvalWfSchema.ensureApprovalWorkflowsSchema();
  await _aiAnswerSovSchema.ensureAiAnswerSovSchema();
  await _revenueIntelSchema.ensureRevenueIntelSchema();
  await _dataProductsSchema.ensureDataProductsSchema();
  console.log('[t95-t101] schemas ready');
} } catch(e) { console.warn('[t95-t101] schema init failed:', e.message); } });
// ── ROI Ledger ───────────────────────────────────────────────────────────────
const _roiLedgerSchema  = require('./services/roi_ledger/schema');
const _roiLedgerRouter  = require('./services/roi_ledger/api');
app.use('/api/roi-ledger', _roiLedgerRouter);
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) {
  await _roiLedgerSchema.ensureRoiLedgerSchema();
  console.log('[roi-ledger] schema ready');
} } catch(e) { console.warn('[roi-ledger] schema init failed:', e.message); } });
// ── Tier 102-111 ─────────────────────────────────────────────────────────────
const _swarmSchema            = require('./services/agent_swarm/schema');
const _swarmRouter            = require('./services/agent_swarm/api');
const _selfHealingSchema      = require('./services/self_healing/schema');
const _selfHealingRouter      = require('./services/self_healing/api');
const _budgetArbSchema        = require('./services/budget_arbitrage/schema');
const _budgetArbRouter        = require('./services/budget_arbitrage/api');
const _ssEventsSchema         = require('./services/ss_events/schema');
const _ssEventsRouter         = require('./services/ss_events/api');
const _ctvSchema              = require('./services/ctv/schema');
const _ctvRouter              = require('./services/ctv/api');
const _rcsSchema              = require('./services/rcs/schema');
const _rcsRouter              = require('./services/rcs/api');
const _llmKbSchema            = require('./services/llm_kb/schema');
const _llmKbRouter            = require('./services/llm_kb/api');
const _kgApi                  = require('./services/knowledge_graph/api');
const _kgSchema               = require('./services/knowledge_graph/schema');
const _predictionsSchema      = require('./services/predictions/schema');
const _predictionsApi         = require('./services/predictions/api');
const _privacySchema          = require('./services/privacy_compliance/schema');
const _privacyRouter          = require('./services/privacy_compliance/api');
const _brandDnaSchema         = require('./services/brand_dna/schema');
const _brandDnaRouter         = require('./services/brand_dna/api');
const _workflowBuilderSchema  = require('./services/workflow_builder/schema');
const _workflowBuilderRouter  = require('./services/workflow_builder/api');
app.use('/api/swarm',              _swarmRouter);
app.use('/api/self-healing',       _selfHealingRouter);
app.use('/api/budget-arbitrage',   _budgetArbRouter);
app.use('/api/ss-events',          _ssEventsRouter);
app.use('/api/ctv',                _ctvRouter);
app.use('/api/rcs',                _rcsRouter);
app.use('/api/llm-kb',             _llmKbRouter);
app.use('/api/knowledge-graph',    _kgApi.router);
app.use('/api/predictions',        _predictionsApi.router);
// Knowledge Graph monthly rollup — fires daily at 03:00-ish (off-peak).
if (_runtimeFlags.backgroundEnabled()) {
  const _kgRollupDelay = (() => {
    const now = new Date();
    const next3am = new Date(now); next3am.setHours(3, 0, 0, 0);
    if (next3am <= now) next3am.setDate(next3am.getDate() + 1);
    return next3am - now;
  })();
  setTimeout(() => {
    _kgApi.runMonthlyRollup().catch(e => console.warn('[knowledge-graph] rollup error:', e.message));
    setInterval(() => {
      _kgApi.runMonthlyRollup().catch(e => console.warn('[knowledge-graph] rollup error:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, _kgRollupDelay);
  // Predictions — refresh all active tenants every 6 hours
  setInterval(() => {
    _predictionsApi.runPredictionsRefreshForAllTenants().catch(e => console.warn('[predictions] cron error:', e.message));
  }, 6 * 60 * 60 * 1000);
}
app.use('/api/privacy-compliance', _privacyRouter);
app.use('/api/brand-dna',          _brandDnaRouter);
app.use('/api/workflow-builder',   _workflowBuilderRouter);
const _askCopilotSchema = require('./services/ask_copilot/schema');
const _askCopilotRouter = require('./services/ask_copilot/api');
app.use('/api/ask',                _askCopilotRouter);
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) {
  await _askCopilotSchema.ensureAskCopilotSchema();
  console.log('[ask-copilot] schema ready');
} } catch(e) { console.warn('[ask-copilot] schema init failed:', e.message); } });
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) {
  await _swarmSchema.ensureAgentSwarmSchema();
  await _selfHealingSchema.ensureSelfHealingSchema();
  await _budgetArbSchema.ensureBudgetArbitrageSchema();
  await _ssEventsSchema.ensureSsEventsSchema();
  await _ctvSchema.ensureCtvSchema();
  await _rcsSchema.ensureRcsSchema();
  await _llmKbSchema.ensureLlmKbSchema();
  await _kgSchema.ensureKnowledgeGraphSchema();
  await _predictionsSchema.ensurePredictionsSchema();
  await _privacySchema.ensurePrivacyComplianceSchema();
  await _brandDnaSchema.ensureBrandDnaSchema();
  await _workflowBuilderSchema.ensureWorkflowBuilderSchema();
  console.log('[t102-t111] schemas ready');
} } catch(e) { console.warn('[t102-t111] schema init failed:', e.message); } });
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) {
  await _benchmarksSchema.ensureBenchmarksSchema();
  await _mmmSchema.ensureMmmSchema();
  await _brandSafetySchema.ensureBrandSafetySchema();
  await _safeAgentSchema.ensureSafeAgentSchema();
  await _provenanceSchema.ensureDataProvenanceSchema();
  await _playbooksSchema.ensureVerticalPlaybooksSchema();
  console.log('[t89-t94] schemas ready');
} } catch(e) { console.warn('[t89-t94] schema init failed:', e.message); } });

// ── Tier 81-88 ──────────────────────────────────────────────────────────────
const _warRoomSchema        = require('./services/war_room/schema');
const _warRoomRouter        = require('./services/war_room/api');
const _revForecastSchema    = require('./services/revenue_forecast/schema');
const _revForecastRouter    = require('./services/revenue_forecast/api');
const _digitalTwinSchema    = require('./services/digital_twin/schema');
const _digitalTwinRouter    = require('./services/digital_twin/api');
const _acqEngineSchema      = require('./services/acquisition_engine/schema');
const _acqEngineRouter      = require('./services/acquisition_engine/api');
const _investorSchema       = require('./services/investor_mode/schema');
const _investorRouter       = require('./services/investor_mode/api');
const _marketplaceSchema    = require('./services/marketplace/schema');
const _marketplaceRouter    = require('./services/marketplace/api');
const _autoOperatorSchema   = require('./services/auto_operator/schema');
const _autoOperatorRouter   = require('./services/auto_operator/api');
app.use('/api/war-room',          _warRoomRouter);
app.use('/api/revenue-forecast',  _revForecastRouter);
app.use('/api/digital-twin',      _digitalTwinRouter);
app.use('/api/acquisition-engine',_acqEngineRouter);
app.use('/api/investor-mode',     _investorRouter);
app.use('/api/marketplace',       _marketplaceRouter);
app.use('/api/auto-operator',     _autoOperatorRouter);
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) {
  await _warRoomSchema.ensureWarRoomSchema();
  await _revForecastSchema.ensureRevenueForecastSchema();
  await _digitalTwinSchema.ensureDigitalTwinSchema();
  await _acqEngineSchema.ensureAcquisitionEngineSchema();
  await _investorSchema.ensureInvestorModeSchema();
  await _marketplaceSchema.ensureMarketplaceSchema();
  await _autoOperatorSchema.ensureAutoOperatorSchema();
  console.log('[t81-t88] schemas ready');
} } catch(e) { console.warn('[t81-t88] schema init failed:', e.message); } });
// Public investor portal (no auth required)
app.get('/investor/:token', async (req, res) => {
  const p = await _db.getPool();
  const row = await p.query(`SELECT content,created_at FROM investor_reports WHERE portal_token=$1`, [req.params.token]);
  if (!row.rows.length) return res.status(404).send('<h2>Report not found or link expired.</h2>');
  const r = row.rows[0].content;
  const co = r.company_name || 'Company';
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${co} — Investor Report</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#111}h1{font-size:2rem;margin-bottom:4px}.badge{display:inline-block;background:#f3f4f6;border-radius:6px;padding:4px 12px;font-size:.85rem;color:#6b7280;margin-bottom:32px}.metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin:24px 0}.metric-card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px}.metric-label{font-size:.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}.metric-value{font-size:1.5rem;font-weight:700;margin:4px 0}.metric-trend-up{color:#10b981}.metric-trend-down{color:#ef4444}.metric-trend-flat{color:#6b7280}.section{margin:32px 0}.section h2{font-size:1.1rem;font-weight:600;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-bottom:16px}ul{padding-left:20px}li{margin:6px 0}.footer{margin-top:48px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:.8rem;color:#9ca3af;text-align:center}</style></head><body>
<h1>${co}</h1><div class="badge">Investor Report · ${new Date(row.rows[0].created_at).toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</div>
<div class="section"><h2>Executive Summary</h2><p>${r.executive_summary||''}</p></div>
<div class="metric-grid">${(r.headline_metrics||[]).map(m=>`<div class="metric-card"><div class="metric-label">${m.label}</div><div class="metric-value metric-trend-${m.trend||'flat'}">${m.value}</div>${m.change?'<div class="metric-label">'+m.change+'</div>':''}</div>`).join('')}</div>
<div class="section"><h2>Highlights</h2><ul>${(r.highlights||[]).map(h=>`<li>${h}</li>`).join('')}</ul></div>
<div class="section"><h2>Investor Narrative</h2><p>${r.investor_narrative||''}</p></div>
${r.ask?`<div class="section"><h2>The Ask</h2><p>${r.ask}</p></div>`:''}
<div class="footer">Generated by InfoGenie · Read-only investor view</div>
</body></html>`);
});

// ── Tier 9 ─────────────────────────────────────────────────────────────────
const _delivRouter = require('./services/deliverability/api');
const _lpSchema    = require('./services/landing_pages/schema');
const _lpRouter    = require('./services/landing_pages/api');
const _bfSchema    = require('./services/brand_foundation/schema');
const _bfRouter    = require('./services/brand_foundation/api');
app.use('/api/deliverability', _delivRouter);
app.use('/api/landing-pages',  _lpRouter);

// ── Customer.io-inspired features (Surveys · Email Designer · MCP · Smart Send · Ad Sync) ──
const _surveysSchema = require('./services/surveys/schema');
const _surveysRouter = require('./services/surveys/api');
const { router: _emailDesignerRouter } = require('./services/email_designer/api');
const _emailDesignerSchema = require('./services/email_designer/schema');
const _mcpRouter = require('./services/mcp/api');
const _smartSendRouter = require('./services/drips/smart_send');
const _commentsSchema = require('./services/comments/schema');
const _commentsRouter = require('./services/comments/api');
app.use('/api/surveys',        _surveysRouter);
app.use('/api/email-designer', _emailDesignerRouter);
app.use('/api/mcp',            _mcpRouter);
app.use('/api/drips',          _smartSendRouter);   // adds /api/drips/smart-send-time + /api/drips/translate
app.use('/api/comments',       _commentsRouter);    // F13 team collaboration asset comments
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) {
      await _surveysSchema.ensureSurveysSchema();
      await _emailDesignerSchema.ensureEmailDesignerSchema();
      await _commentsSchema.ensureCommentsSchema();
      console.log('[surveys/email-designer/comments] schemas ready');
    }
  } catch(e) { console.warn('[surveys/email-designer/comments] schema init failed:', e.message); }
});

// ── T70/T71 Public landing page serve (/lp/:id) ───────────────────────────
app.get('/lp/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).send('<!DOCTYPE html><h1>Bad request</h1>');
  if (!_db.hasDb()) return res.status(503).send('<!DOCTYPE html><h1>Service unavailable</h1>');
  try {
    const pr = await _db.getPool().query(`SELECT id, html, views, webhook_url FROM landing_pages WHERE id=$1`, [id]);
    const page = pr.rows[0];
    if (!page) return res.status(404).send('<!DOCTYPE html><h1>404 — Page not found</h1>');
    const vr = await _db.getPool().query(`SELECT id, html FROM landing_page_ab_variants WHERE page_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]);
    const hasVariant = !!vr.rows[0];
    const cookieName = 'lp_v_' + id;
    let variant = req.cookies?.[cookieName];
    if (!variant) variant = (hasVariant && Math.random() < 0.5) ? 'b' : 'a';
    const useVariant = (variant === 'b' && hasVariant) ? 'b' : 'a';
    const html = (useVariant === 'b') ? vr.rows[0].html : page.html;
    res.cookie(cookieName, useVariant, { maxAge: 86400000, httpOnly: true, sameSite: 'lax' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.send(html);
  } catch (e) { console.warn('[lp public]', e.message); res.status(500).send('<!DOCTYPE html><h1>Error</h1>'); }
});
app.use('/api/brand-foundation', _bfRouter);

// ── Tier 10 ────────────────────────────────────────────────────────────────
const _techStackRouter = require('./services/tech_stack/api');
const _coldEmailSchema = require('./services/cold_email/schema');
const _coldEmailRouter = require('./services/cold_email/api');
app.use('/api/tech-stack',  _techStackRouter);
app.use('/api/cold-email',  _coldEmailRouter);

// ── Tier 11 ────────────────────────────────────────────────────────────────
const _webVitalsRouter  = require('./services/web_vitals/api');
const _leadFinderSchema = require('./services/lead_finder/schema');
const _leadFinderRouter = require('./services/lead_finder/api');
app.use('/api/web-vitals',  _webVitalsRouter);
app.use('/api/lead-finder', _leadFinderRouter);
app.use('/api/lead-runs',   require('./services/lead_runs/api'));

// ── Tier 12 ────────────────────────────────────────────────────────────────
const _serpTrackerSchema = require('./services/serp_tracker/schema');
const _serpTrackerRouter = require('./services/serp_tracker/api');
const _hubspotSyncRouter = require('./services/hubspot_sync/api');
app.use('/api/serp-tracker', _serpTrackerRouter);
app.use('/api/hubspot-sync', _hubspotSyncRouter);

// ── Tier 13 ────────────────────────────────────────────────────────────────
const _metaInsightsRouter = require('./services/meta_ads_insights/api');
const _kwExplorerSchema   = require('./services/keyword_explorer/schema');
const _kwExplorerRouter   = require('./services/keyword_explorer/api');
app.use('/api/meta-insights',     _metaInsightsRouter);
app.use('/api/keyword-explorer',  _kwExplorerRouter);

// ── Tier 14 ────────────────────────────────────────────────────────────────
const _googleAdsInsightsRouter = require('./services/google_ads_insights/api');
const _tiktokAdsInsightsRouter = require('./services/tiktok_ads_insights/api');
app.use('/api/google-ads-insights', _googleAdsInsightsRouter);
app.use('/api/integrations/google-ads',  require('./services/google_ads_oauth/api'));
app.use('/api/integrations/workspace',  require('./services/google_workspace/api'));
app.use('/api/integrations/meta-ads',   require('./services/meta_ads_oauth/api'));
app.use('/api/tiktok-ads-insights', _tiktokAdsInsightsRouter);
const _microsoftAdsInsightsRouter = require('./services/microsoft_ads_insights/api');
app.use('/api/microsoft-ads-insights', _microsoftAdsInsightsRouter);

// ── New Feature Pack: Studio + Engagement + Commerce ───────────────────────
app.use('/api/studio',         require('./services/creator_studio/api'));
app.use('/api/whatsapp',       require('./services/whatsapp_channel/api'));
app.use('/api/voice-caller',   require('./services/voice_caller/api'));
app.use('/api/bookings',       require('./services/bookings/api'));
app.use('/api/site-builder',   require('./services/site_builder/api'));
app.use('/api/linksell',       require('./services/linksell/api'));
app.use('/api/scroll-tracker',  require('./services/scroll_tracker/api'));
app.use('/api/seo-annotations', require('./services/seo_annotations/api'));
app.use('/api/site-search',     require('./services/site_search/api'));
// Public renderers (no /api prefix) — rewrite path & forward to mounted router
// Public LP / Bio / Booking pages routes → services/public_pages/routes.js
require('./services/public_pages/routes')(app, {});

// ── Tier 15 ────────────────────────────────────────────────────────────────
const _socialPublisherRouter = require('./services/social_publisher/api');
app.use('/api/social-publisher', _socialPublisherRouter);

// ── Tier 16 ────────────────────────────────────────────────────────────────
const _emailPersonalizerRouter = require('./services/email_personalizer/api');
const _ytSchema = require('./services/youtube_monitor/schema');
const _ytRouter = require('./services/youtube_monitor/api');
const _wrSchema = require('./services/weekly_report/schema');
const _wrModule = require('./services/weekly_report/api');
app.use('/api/email-personalizer', _emailPersonalizerRouter);
app.use('/api/youtube-monitor', _ytRouter);
app.use('/api/weekly-report', _wrModule.router);
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _ytSchema.ensureYoutubeMonitorSchema();
    await _wrSchema.ensureWeeklyReportSchema();
    console.log('[tier16] youtube-monitor + weekly-report schemas ready');
    _wrModule.startWeeklyCron(7);
  }
} catch (e) { console.warn('[tier16] schema/cron init failed:', e.message); }});

// ── Tier 18 ────────────────────────────────────────────────────────────────
const _revAggSchema = require('./services/review_aggregator/schema');
const _revAggRouter = require('./services/review_aggregator/api');
const _churnSchema = require('./services/churn_scorer/schema');
const _churnRouter = require('./services/churn_scorer/api');
const _twPulseSchema = require('./services/twitter_pulse/schema');
const _twPulseRouter = require('./services/twitter_pulse/api');
const _jobSpySchema = require('./services/job_board_spy/schema');
const _jobSpyRouter = require('./services/job_board_spy/api');
const _videoScriptRouter = require('./services/video_script/api');
const _revMonSchema = require('./services/review_monitor/schema');
const _revMonRouter = require('./services/review_monitor/api');
app.use('/api/review-aggregator', _revAggRouter);
app.use('/api/review-monitor', _revMonRouter);
app.use('/api/churn-scorer', _churnRouter);
app.use('/api/twitter-pulse', _twPulseRouter);
app.use('/api/job-board-spy', _jobSpyRouter);
app.use('/api/video-script', _videoScriptRouter);
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _revAggSchema.ensureReviewAggregatorSchema();
    await _revMonSchema.ensureReviewMonitorSchema();
    await _churnSchema.ensureChurnScorerSchema();
    await _twPulseSchema.ensureTwitterPulseSchema();
    await _jobSpySchema.ensureJobBoardSpySchema();
    console.log('[tier18] review-aggregator + review-monitor + churn-scorer + twitter-pulse + job-board-spy schemas ready');
  }
} catch (e) { console.warn('[tier18] schema init failed:', e.message); }});

// ── Tier 19 ────────────────────────────────────────────────────────────────
const _chatbotSchema = require('./services/chatbot_builder/schema');
const _chatbotRouter = require('./services/chatbot_builder/api');
const _glassdoorSchema = require('./services/glassdoor_sentiment/schema');
const _glassdoorRouter = require('./services/glassdoor_sentiment/api');
const _quoraSchema = require('./services/quora_mining/schema');
const _quoraRouter = require('./services/quora_mining/api');
app.use('/api/chatbot', _chatbotRouter);
app.use('/api/glassdoor', _glassdoorRouter);
app.use('/api/quora-mining', _quoraRouter);
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _chatbotSchema.ensureChatbotBuilderSchema();
    await _glassdoorSchema.ensureGlassdoorSentimentSchema();
    await _quoraSchema.ensureQuoraMiningSchema();
    console.log('[tier19] chatbot-builder + glassdoor-sentiment + quora-mining schemas ready');
  }
} catch (e) { console.warn('[tier19] schema init failed:', e.message); }});

// ── Tier 20 ────────────────────────────────────────────────────────────────
const _ttDlSchema = require('./services/tiktok_downloader/schema');
const _ttDlRouter = require('./services/tiktok_downloader/api');
app.use('/api/tiktok-downloader', _ttDlRouter);
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _ttDlSchema.ensureTiktokDownloaderSchema();
    console.log('[tier20] tiktok-downloader schema ready');
  }
} catch (e) { console.warn('[tier20] schema init failed:', e.message); }});

// ── Tier 21 + 22 + 23 ──────────────────────────────────────────────────────
const _voSchema = require('./services/voiceover/schema');
const _voRouter = require('./services/voiceover/api');
const _seoSchema = require('./services/seo_auditor/schema');
const _seoRouter = require('./services/seo_auditor/api');
const _seoWidgetSchema = require('./services/seo_widget/schema');
const _seoWidgetRouter = require('./services/seo_widget/api');
app.use('/api/voiceover', _voRouter);
app.use('/api/seo-auditor', _seoRouter);
app.use('/api/seo-widget', _seoWidgetRouter);
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _voSchema.ensureVoiceoverSchema();
    await _seoSchema.ensureSeoAuditorSchema();
    await _seoWidgetSchema.ensureSeoWidgetSchema();
    console.log('[tier21-23] voiceover + seo-auditor + seo-widget schemas ready');
  }
} catch (e) { console.warn('[tier21-23] schema init failed:', e.message); }});

// ── Tier 24 + 25 + 26 + 27 ─────────────────────────────────────────────────
const _seoTasksSchema = require('./services/seo_tasks/schema');
const _seoTasksRouter = require('./services/seo_tasks/api');
const _schemaGenSchema = require('./services/schema_generator/schema');
const _schemaGenRouter = require('./services/schema_generator/api');
const _inboxSchema = require('./services/unified_inbox/schema');
const _inboxRouter = require('./services/unified_inbox/api');
const _cbSchema = require('./services/conversion_boosters/schema');
const _cbRouter = require('./services/conversion_boosters/api');
app.use('/api/seo-tasks', _seoTasksRouter);
app.use('/api/schema-generator', _schemaGenRouter);
app.use('/api/unified-inbox', _inboxRouter);
app.use('/api/conversion-boosters', _cbRouter);

// ── Tier 28 + 29 + 30 + 31 + 32 ──────────────────────────────────────────
const _wlRouter = require('./services/white_label/api');
const _scrRouter = require('./services/seo_crawler/api');
const _geoRouter = require('./services/geo_audit/api');
const _aiVisRouter = require('./services/ai_visibility/api');
const _lsRouter  = require('./services/local_seo/api');
const _stRouter  = require('./services/social_tags/api');
app.use('/api/white-label', _wlRouter);
app.use('/api/seo-crawler', _scrRouter);
app.use('/api/geo-audit', _geoRouter);
app.use('/api/ai-visibility', _aiVisRouter);
app.use('/api/local-seo', _lsRouter);
app.use('/api/social-tags', _stRouter);
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    const { ensureSeoCrawlerSchema } = require('./services/seo_crawler/schema');
    const { ensureGeoAuditSchema } = require('./services/geo_audit/schema');
    const { ensureAiVisibilitySchema } = require('./services/ai_visibility/schema');
    await ensureAiVisibilitySchema();
    const { ensureLocalSeoSchema }  = require('./services/local_seo/schema');
    const { ensureSocialTagsSchema } = require('./services/social_tags/schema');
    await ensureSeoCrawlerSchema();
    await ensureGeoAuditSchema();
    await ensureLocalSeoSchema();
    await ensureSocialTagsSchema();
    console.log('[tier28-32] white-label + seo-crawler + geo-audit + local-seo + social-tags ready');
  }
} catch (e) { console.warn('[tier28-32] schema init failed:', e.message); }});
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _seoTasksSchema.ensureSeoTasksSchema();
    await _schemaGenSchema.ensureSchemaGeneratorSchema();
    await _inboxSchema.ensureUnifiedInboxSchema();
    await _cbSchema.ensureConversionBoostersSchema();
    console.log('[tier24-27] seo-tasks + schema-generator + unified-inbox + conversion-boosters schemas ready');
  }
} catch (e) { console.warn('[tier24-27] schema init failed:', e.message); }});

// ── Tier 17 ────────────────────────────────────────────────────────────────
const _redditRouter = require('./services/reddit_pulse/api');
const _redditSchema = require('./services/reddit_pulse/schema');
const _adLibRouter = require('./services/ad_library/api');
const _adSwipeRouter = require('./services/ad_swipe/api');
const _adSwipeSchema = require('./services/ad_swipe/schema');
const _platformSearchRouter = require('./services/platform_search/api');
const _infographicsRouter   = require('./services/infographics/api');
const _heatmapsRouter       = require('./services/heatmaps/api');
const _heatmapsSchema       = require('./services/heatmaps/schema');
const _questionMinerRouter  = require('./services/question_miner/api');
const _aiProvidersRouter    = require('./services/ai_providers/api');
const _aiProvidersSchema    = require('./services/ai_providers/schema');
const _nlSchema = require('./services/newsletter_tracker/schema');
const _nlRouter = require('./services/newsletter_tracker/api');
const _meetingRouter = require('./services/meeting_notes/api');
const _headlineRouter = require('./services/headline_tester/api');
// ── Brand Intelligence Suite (10 features) ──────────────────────────────────
const _reputationScoreRouter  = require('./services/reputation_score/api');
const _reputationScoreSchema  = require('./services/reputation_score/schema');
const _aveRouter              = require('./services/ave/api');
const _aveSchema              = require('./services/ave/schema');
const _anomalyDetectorRouter  = require('./services/anomaly_detector/api');
const _anomalyDetectorSchema  = require('./services/anomaly_detector/schema');
const _intentRadarRouter      = require('./services/intent_radar/api');
const _intentRadarSchema      = require('./services/intent_radar/schema');
const _hashtagTrackerRouter   = require('./services/hashtag_tracker/api');
const _hashtagTrackerSchema   = require('./services/hashtag_tracker/schema');
const _presenceScoreRouter    = require('./services/presence_score/api');
const _presenceScoreSchema    = require('./services/presence_score/schema');
const _projectCompareRouter   = require('./services/project_compare/api');
const _projectCompareSchema   = require('./services/project_compare/schema');
const _influenceScoreRouter   = require('./services/influence_score/api');
const _influenceScoreSchema   = require('./services/influence_score/schema');
const _geoInsightsRouter      = require('./services/geo_insights/api');
const _geoInsightsSchema      = require('./services/geo_insights/schema');
const _ugcDiscoveryRouter     = require('./services/ugc_discovery/api');
const _ugcDiscoverySchema     = require('./services/ugc_discovery/schema');
const _bizScannerRouter       = require('./services/biz_scanner/api');
const _bizScannerSchema       = require('./services/biz_scanner/schema');
app.use('/api/reputation-score', _reputationScoreRouter);
app.use('/api/ave',              _aveRouter);
app.use('/api/anomaly-detector', _anomalyDetectorRouter);
app.use('/api/intent-radar',     _intentRadarRouter);
app.use('/api/hashtag-tracker',  _hashtagTrackerRouter);
app.use('/api/presence-score',   _presenceScoreRouter);
app.use('/api/project-compare',  _projectCompareRouter);
app.use('/api/influence-score',  _influenceScoreRouter);
app.use('/api/geo-insights',     _geoInsightsRouter);
app.use('/api/ugc-discovery',    _ugcDiscoveryRouter);
app.use('/api/biz-scanner',      _bizScannerRouter);
BOOT_TASKS.push(async () => { try {
  if (process.env.DATABASE_URL) {
    await _reputationScoreSchema.ensureReputationScoreSchema();
    await _aveSchema.ensureAveSchema();
    await _anomalyDetectorSchema.ensureAnomalyDetectorSchema();
    await _intentRadarSchema.ensureIntentRadarSchema();
    await _hashtagTrackerSchema.ensureHashtagTrackerSchema();
    await _presenceScoreSchema.ensurePresenceScoreSchema();
    await _projectCompareSchema.ensureProjectCompareSchema();
    await _influenceScoreSchema.ensureInfluenceScoreSchema();
    await _geoInsightsSchema.ensureGeoInsightsSchema();
    await _ugcDiscoverySchema.ensureUgcDiscoverySchema();
    await _bizScannerSchema.ensureBizScannerSchema();
    console.log('[brand-intel] all 10 brand intelligence schemas ready');
  }
} catch (e) { console.warn('[brand-intel] schema init failed:', e.message); }});
app.use('/api/reddit-pulse', _redditRouter);
app.use('/api/ad-library', _adLibRouter);
app.use('/api/ad-swipe', _adSwipeRouter);
app.use('/api/platform-search', _platformSearchRouter);
app.use('/api/infographics',    _infographicsRouter);
app.use('/api/heatmaps',        _heatmapsRouter);
app.use('/api/question-miner',  _questionMinerRouter);
app.use('/api/ai-providers',    _aiProvidersRouter);
app.use('/api/newsletter-tracker', _nlRouter);
app.use('/api/meeting-notes', _meetingRouter);
app.use('/api/headline-tester', _headlineRouter);
// Cloudflare status routes → services/cloudflare_status/routes.js
require('./services/cloudflare_status/routes')(app, { BOOT_TASKS, _abdSchema, _adSwipeSchema, _aiProvidersSchema, _alertRouteSchema, _battleSchema, _bfSchema, _calendarSchema, _coldEmailSchema, _crisisDetector, _crisisSchema, _db, _digestRouter, _digestSchema, _heatmapsSchema, _kwExplorerSchema, _leadFinderSchema, _lpSchema, _nlSchema, _optimizerBandit, _optimizerCreative, _optimizerIngest, _optimizerRules, _optimizerSchema, _podcastSchema, _pwSchema, _redditSchema, _searchIntelSchema, _serpTrackerSchema, _sovSchema, _vocSchema });

// ── Slack / Discord webhook (real-time alert delivery alongside email) ───────
// Auto-detects payload format based on the hostname. Slack expects { text: ... }
// or { blocks: [...] }; Discord expects { content: ... } or { embeds: [...] }.
function _slackOrDiscordKind(url) {
  if (!url) return null;
  if (url.includes('hooks.slack.com'))            return 'slack';
  if (url.includes('discord.com/api/webhooks'))   return 'discord';
  if (url.includes('discordapp.com/api/webhooks'))return 'discord';
  return 'slack'; // default — most webhooks accept Slack payload shape
}
// Allowlist of webhook hosts we will deliver to. Prevents SSRF / misconfig.
const _CHAT_WEBHOOK_HOSTS = new Set(['hooks.slack.com', 'discord.com', 'discordapp.com']);
async function _sendChatWebhook(text, opts = {}) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error('SLACK_WEBHOOK_URL not configured');
  // Parse + enforce HTTPS + allowlist host before any network call.
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('SLACK_WEBHOOK_URL is not a valid URL'); }
  if (parsed.protocol !== 'https:') throw new Error('SLACK_WEBHOOK_URL must use https');
  if (!_CHAT_WEBHOOK_HOSTS.has(parsed.hostname)) {
    throw new Error(`SLACK_WEBHOOK_URL host not allowed: ${parsed.hostname}`);
  }
  // DNS + private-IP guard reuses the codebase's hardened SSRF helper.
  const safety = await _isUrlSafeToFetch(url);
  if (!safety.ok) throw new Error(`webhook URL rejected: ${safety.reason}`);

  const kind = _slackOrDiscordKind(url);
  const payload = (kind === 'discord')
    ? { content: text.slice(0, 1900), username: opts.username || 'InfoGenie' }
    : { text, username: opts.username || 'InfoGenie', icon_emoji: opts.icon || ':robot_face:' };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',                       // refuse cross-host redirects
    signal: AbortSignal.timeout(8000),        // hard 8s ceiling
  });
  if (r.status >= 300 && r.status < 400) throw new Error(`webhook redirected (${r.status}) — refused`);
  if (!r.ok) throw new Error(`webhook HTTP ${r.status}`);
  return { ok:true, kind };
}
// Slack status routes → services/slack_status/routes.js
require('./services/slack_status/routes')(app, { _slackOrDiscordKind });
app.post('/api/slack/send', async (req, res) => {
  if (!process.env.SLACK_WEBHOOK_URL) return _missingCreds(res, 'slack', ['SLACK_WEBHOOK_URL']);
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok:false, error:'text required' });
    try { _chargeBudget('slack', req.ip); } catch (e) { if (_send429IfBudget(res, e)) return; throw e; }
    const out = await _sendChatWebhook(text, { username: req.body?.username, icon: req.body?.icon });
    res.json(out);
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ── Apollo.io organization enrichment (turn domain → company profile) ────────
// Free-tier endpoint: returns company name, industry, employee count, founded
// year, LinkedIn, location, tech keywords for any domain. Accepts either a
// domain ("example.com") or a full email — the email's domain part is used.
// Useful for both competitor intel AND inferring company info from lead emails.
// Apollo status routes → services/apollo_status/routes.js
require('./services/apollo_status/routes')(app, {});
app.post('/api/apollo/enrich', async (req, res) => {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return _missingCreds(res, 'apollo', ['APOLLO_API_KEY']);
  try {
    let raw = String(req.body?.domain || req.body?.email || '').trim().toLowerCase();
    if (!raw) return res.status(400).json({ ok:false, error:'domain or email required' });
    // Extract domain from email if needed; strip protocol + path from full URLs.
    if (raw.includes('@')) raw = raw.split('@')[1];
    raw = raw.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'');
    if (!raw.includes('.')) return res.status(400).json({ ok:false, error:'valid domain required' });

    try { _chargeBudget('apollo', req.ip); } catch (e) { if (_send429IfBudget(res, e)) return; throw e; }
    const _apolloAc = new AbortController();
    const _apolloTm = setTimeout(() => _apolloAc.abort(), 10000);
    let r;
    try {
      r = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(raw)}`, {
        method:'GET',
        headers:{ 'X-Api-Key': key, 'Cache-Control':'no-cache', 'Accept':'application/json' },
        signal: _apolloAc.signal,
      });
    } finally { clearTimeout(_apolloTm); }
    if (r.status === 401 || r.status === 403) return res.json({ ok:false, error:'Apollo API key is invalid or expired — update it in Platform APIs settings.' });
    if (r.status === 422 || r.status === 404) return res.json({ ok:false, error:'No Apollo record found for this domain.' });
    if (r.status === 429) return res.json({ ok:false, error:'Apollo API rate limit reached — try again in a few minutes.' });
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ ok:false, error:`Apollo API error (HTTP ${r.status})`, detail: body.slice(0, 500) });
    }
    const d = await r.json();
    const o = d?.organization || {};
    res.json({
      ok: true,
      domain: raw,
      company: {
        name:        o.name || null,
        domain:      o.primary_domain || o.website_url || raw,
        industry:    o.industry || null,
        keywords:    o.keywords || [],
        description: o.short_description || null,
        size:        o.estimated_num_employees || null,
        annualRevenue: o.annual_revenue_printed || null,
        founded:     o.founded_year || null,
        logo:        o.logo_url || null,
        linkedIn:    o.linkedin_url || null,
        twitter:     o.twitter_url || null,
        facebook:    o.facebook_url || null,
        phone:       o.sanitized_phone || o.phone || null,
        address:     [o.street_address, o.city, o.state, o.country].filter(Boolean).join(', ') || null,
        techStack:   o.technology_names || [],
      }
    });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ ok:false, error:'Apollo API timed out (10 s) — try again or check your API key.' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ── BuiltWith API (detect competitors' tech stack) ───────────────────────────
// Returns the technologies a domain is using: CMS, analytics, ads, hosting,
// payment, marketing automation, etc. Free tier ~200 lookups/mo.
// BuiltWith status routes → services/builtwith_status/routes.js
require('./services/builtwith_status/routes')(app, {});
app.post('/api/builtwith/lookup', async (req, res) => {
  const key = process.env.BUILTWITH_API_KEY;
  if (!key) return _missingCreds(res, 'builtwith', ['BUILTWITH_API_KEY']);
  try {
    let domain = String(req.body?.domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//,'').replace(/\/.*$/,'');
    if (!domain || !domain.includes('.')) return res.status(400).json({ ok:false, error:'valid domain required' });
    try { _chargeBudget('builtwith', req.ip); } catch (e) { if (_send429IfBudget(res, e)) return; throw e; }
    const _bwAc = new AbortController();
    const _bwTm = setTimeout(() => _bwAc.abort(), 10000);
    let r;
    try {
      r = await fetch(`https://api.builtwith.com/free1/api.json?KEY=${encodeURIComponent(key)}&LOOKUP=${encodeURIComponent(domain)}`, { signal: _bwAc.signal });
    } finally { clearTimeout(_bwTm); }
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ ok:false, error:`HTTP ${r.status}`, detail: body.slice(0, 500) });
    }
    const d = await r.json();
    // BuiltWith free1 returns aggregate COUNTS per group/category, not tech
    // names (those require a paid plan). Reshape into a flat, sorted list of
    // active categories so the frontend can display "what they're using".
    const groups = d?.groups || [];
    const categories = [];
    let totalLive = 0;
    for (const g of groups) {
      for (const c of (g.categories || [])) {
        const live = Number(c.live || 0);
        if (live > 0) {
          totalLive += live;
          categories.push({
            group: g.name || '',
            category: c.name || '',
            live,
            dead: Number(c.dead || 0),
            latest: c.latest ? new Date(c.latest).toISOString().slice(0,10) : null,
          });
        }
      }
    }
    categories.sort((a,b) => b.live - a.live);
    res.json({
      ok: true,
      domain,
      tier: 'free',
      note: 'Showing category-level counts. For specific tool names per category, a paid BuiltWith plan is required.',
      firstSeen: d?.first ? new Date(d.first).toISOString().slice(0,10) : null,
      lastSeen:  d?.last  ? new Date(d.last ).toISOString().slice(0,10) : null,
      totalLiveTechnologies: totalLive,
      categoryCount: categories.length,
      categories,
    });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ ok:false, error:'BuiltWith API timed out (10 s) — try again.' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// KPI ANALYSIS — AI-estimated actuals from DataForSEO domain signals + GPT-4o
// POST /api/kpi-analysis  { domain, brand, industry, competitors[] }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/kpi-analysis', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'kpi-analysis' });
    const { domain, brand, industry, competitors } = req.body || {};
    if (!domain) return res.status(400).json({ ok: false, error: 'domain required' });

    // 1. DataForSEO domain rank overview (best-effort)
    let domainSignals = null;
    try {
      const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', [{ target: domain }], 12000);
      const item = raw?.tasks?.[0]?.result?.[0]?.items?.[0];
      if (item) {
        const paid    = item.metrics?.paid    || {};
        const organic = item.metrics?.organic || {};
        domainSignals = {
          paidKeywords:    paid.count    || 0,
          paidEtv:         Math.round(paid.etv    || 0),
          organicKeywords: organic.count || 0,
          organicEtv:      Math.round(organic.etv || 0),
          rankAbsolute:    item.rank_absolute || null
        };
      }
    } catch (_e) { /* proceed without DataForSEO */ }

    // 2. GPT-4o-mini synthesis of KPI estimates
    const prompt = `You are a senior digital-marketing analyst. Using the domain intelligence signals below, estimate this brand's CURRENT marketing KPI performance with realistic, data-grounded values.

Return ONLY a valid JSON object with exactly these keys (all numeric):
- roas          (return on ad spend ratio, e.g. 2.4)
- ctr           (click-through rate %, e.g. 3.8)
- cpa           (cost per acquisition USD, e.g. 54)
- convRate      (conversion rate %, e.g. 2.1)
- impressions   (estimated monthly impressions, e.g. 420000)
- spend         (estimated monthly ad spend USD, e.g. 18500)
- conversions   (estimated monthly conversions, e.g. 340)
- qualityScore  (Google Ads quality score 1-10, e.g. 7)
- budgetUtil    (budget utilisation %, e.g. 82)

Rules: values must be realistic for the industry and domain size; do NOT use placeholder round numbers; reflect the organic/paid signals provided.

Domain: ${domain}
Brand: ${brand || domain}
Industry: ${industry || 'general'}
DataForSEO signals: ${domainSignals ? JSON.stringify(domainSignals) : 'unavailable'}
Known competitors: ${Array.isArray(competitors) && competitors.length ? competitors.slice(0,5).join(', ') : 'none provided'}`;

    const gptRes = await openaiChatWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 400
    });
    let kpis = {};
    try { kpis = JSON.parse(gptRes.choices[0].message.content); } catch (_) { kpis = {}; }

    // Guard: ensure all keys are present and numeric
    const defaults = { roas:2.1, ctr:2.8, cpa:58, convRate:1.9, impressions:180000, spend:9500, conversions:160, qualityScore:6, budgetUtil:74 };
    for (const k of Object.keys(defaults)) {
      if (typeof kpis[k] !== 'number' || !isFinite(kpis[k])) kpis[k] = defaults[k];
    }

    return res.json({ ok: true, kpis, domainSignals, source: 'ai_estimated' });
  } catch (e) {
    console.error('[kpi-analysis]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Postgres / kv_store status ping.
// DB status · smart-detect · sector competitors routes → services/competitor_detect/routes.js
require('./services/competitor_detect/routes')(app, { INFO_SITE_PATTERN, _db, callDataForSEO, openai, openaiChatWithRetry, startMsg });

// ─────────────────────────────────────────────────────────────────────────────
// BLENDED PERFORMANCE — Meta + Google + TikTok spend, Amplitude conversions,
// blended CAC. Each per-channel fetch is independent so Promise.all surfaces
// partial data even when one platform errors.
// ─────────────────────────────────────────────────────────────────────────────
// Strip whitespace, surrounding quotes, and other characters secrets often
// pick up when copy-pasted (e.g. "Bearer ", smart quotes, BOM, newlines).
function _cleanSecret(v) {
  if (v == null) return '';
  let s = String(v).replace(/^\uFEFF/, '').trim();
  s = s.replace(/^Bearer\s+/i, '');
  // Strip a single pair of MATCHING surrounding quotes (straight or smart).
  // Pair-aware so "value' / 'value" / “value' don't accidentally get stripped.
  const quotePairs = [['"','"'], ["'","'"], ['\u201C','\u201D'], ['\u2018','\u2019']];
  for (const [open, close] of quotePairs) {
    if (s.length >= 2 && s[0] === open && s[s.length-1] === close) {
      s = s.slice(1, -1).trim();
      break;
    }
  }
  return s;
}
function _digitsOnly(v) { return String(v == null ? '' : v).replace(/\D+/g, ''); }
// TikTok advertiser IDs are purely numeric. If the env var contains any letters
// it is the wrong credential (e.g. a RapidAPI key) — treat as not configured.
function _tiktokAdvertiserId() {
  const raw = _cleanSecret(process.env.TIKTOK_ADVERTISER_ID || '').replace(/^['"\s]+|['"\s]+$/g, '');
  return /^[0-9]+$/.test(raw) ? raw : '';
}

async function _fetchMetaSpend(days = 30, userId = null) {
  const _r = await _credentialsVault.resolveMetaAdsCredentials(userId);
  if (!_r.ok) return { ok:false, source:'placeholder', channel:'meta', error:'not-configured', note:'Connect Meta Ads in Settings → Integrations to see live data.' };
  const rawAccountId = _cleanSecret(_r.creds.adAccountId);
  const accessToken  = _cleanSecret(_r.creds.accessToken);
  if (!rawAccountId || !accessToken) return { ok:false, source:'placeholder', channel:'meta', error:'not-configured', note:'Connect Meta Ads in Settings → Integrations to see live data.' };
  // Account IDs are numeric; allow optional act_ prefix and strip stray chars
  const numericId = _digitsOnly(rawAccountId);
  const accountId = numericId || rawAccountId;
  const acct  = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const since = new Date(Date.now() - days*86400000).toISOString().slice(0,10);
  const until = new Date().toISOString().slice(0,10);
  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${acct}/insights?fields=spend,impressions,clicks,actions&time_range[since]=${since}&time_range[until]=${until}&access_token=${accessToken}`
    );
    const j = await r.json();
    if (j.error) return { ok:false, channel:'meta', error: j.error.message, status:r.status };
    const row = j.data?.[0] || {};
    const purchases = (row.actions || [])
      .filter(a => /purchase|fb_pixel_purchase|complete_registration|lead/i.test(a.action_type))
      .reduce((s, a) => s + Number(a.value || 0), 0);
    return {
      ok:true, channel:'meta',
      spend:       Number(row.spend       || 0),
      impressions: Number(row.impressions || 0),
      clicks:      Number(row.clicks      || 0),
      conversions: purchases,
    };
  } catch (e) { return { ok:false, channel:'meta', error: e.message }; }
}

async function _fetchGoogleAdsSpend(days = 30, userId = null) {
  const _r = await _credentialsVault.resolveGoogleAdsCredentials(userId);
  if (!_r.ok) return { ok:false, source:'placeholder', channel:'google', error:'not-configured', note:'Connect Google Ads in Settings → Integrations to see live data.' };
  const devToken     = _cleanSecret(_r.creds.devToken);
  const clientId     = _cleanSecret(_r.creds.clientId);
  const clientSecret = _cleanSecret(_r.creds.clientSecret);
  const refreshToken = _cleanSecret(_r.creds.refreshToken);
  const customerId   = _digitsOnly(_cleanSecret(_r.creds.customerId));
  const loginCustomerId = _r.creds.loginCustomerId ? _digitsOnly(_cleanSecret(_r.creds.loginCustomerId)) : '';
  if (!devToken || !refreshToken || !customerId || !clientId || !clientSecret) {
    return { ok:false, source:'placeholder', channel:'google', error:'not-configured', note:'Connect Google Ads in Settings → Integrations to see live data.' };
  }
  try {
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }).toString(),
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return { ok:false, channel:'google', error:'oauth-failed', detail: tok.error_description || tok.error };
    const since = new Date(Date.now() - days*86400000).toISOString().slice(0,10);
    const until = new Date().toISOString().slice(0,10);
    const query = `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}'`;
    const r = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`,
      {
        method:'POST',
        headers: Object.assign({
          'Authorization':  `Bearer ${tok.access_token}`,
          'developer-token': devToken,
          'Content-Type':    'application/json',
        }, loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
        body: JSON.stringify({ query }),
      }
    );
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { _raw: txt.slice(0,200) }; }
    if (!r.ok) {
      const e = (Array.isArray(j) ? j[0]?.error : j.error) || { message:'unknown' };
      return { ok:false, channel:'google', error: e.message, status:r.status };
    }
    const rows = (Array.isArray(j) ? j : [j]).flatMap(p => p.results || []);
    let spend=0, imp=0, clk=0, conv=0;
    for (const row of rows) {
      spend += Number(row.metrics?.costMicros   || 0) / 1_000_000;
      imp   += Number(row.metrics?.impressions  || 0);
      clk   += Number(row.metrics?.clicks       || 0);
      conv  += Number(row.metrics?.conversions  || 0);
    }
    return { ok:true, channel:'google', spend:+spend.toFixed(2), impressions:imp, clicks:clk, conversions:conv };
  } catch (e) { return { ok:false, channel:'google', error: e.message }; }
}

async function _fetchTikTokSpend(days = 30) {
  const advertiserId = _tiktokAdvertiserId();
  const accessToken  = _cleanSecret(process.env.TIKTOK_ACCESS_TOKEN);
  if (!advertiserId || !accessToken) return { ok:false, source:'placeholder', channel:'tiktok', error:'not-configured', note:'Connect TikTok Ads in Settings → Integrations to see live data.' };
  try {
    const since = new Date(Date.now() - days*86400000).toISOString().slice(0,10);
    const until = new Date().toISOString().slice(0,10);
    const url = new URL('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/');
    url.searchParams.set('advertiser_id', advertiserId);
    url.searchParams.set('report_type',  'BASIC');
    url.searchParams.set('data_level',   'AUCTION_ADVERTISER');
    url.searchParams.set('dimensions',   JSON.stringify(['advertiser_id']));
    url.searchParams.set('metrics',      JSON.stringify(['spend','impressions','clicks','conversion']));
    url.searchParams.set('start_date',   since);
    url.searchParams.set('end_date',     until);
    const r = await fetch(url, { headers:{ 'Access-Token': accessToken } });
    const j = await r.json();
    if (j.code && j.code !== 0) return { ok:false, channel:'tiktok', error: j.message, status: j.code };
    const row = j.data?.list?.[0]?.metrics || {};
    return {
      ok:true, channel:'tiktok',
      spend:       Number(row.spend       || 0),
      impressions: Number(row.impressions || 0),
      clicks:      Number(row.clicks      || 0),
      conversions: Number(row.conversion  || 0),
    };
  } catch (e) { return { ok:false, channel:'tiktok', error: e.message }; }
}

// ── Microsoft Advertising (Bing Ads) — submit/poll/download CSV report.
//    Bing's reporting API is async, so this can take 8-14s. We cap polling
//    at ~14s and degrade gracefully if the report is still building.
async function _fetchMicrosoftSpend(days = 30) {
  const need = ['MICROSOFT_ADS_DEVELOPER_TOKEN','MICROSOFT_ADS_CLIENT_ID','MICROSOFT_ADS_CLIENT_SECRET',
                'MICROSOFT_ADS_REFRESH_TOKEN','MICROSOFT_ADS_CUSTOMER_ID','MICROSOFT_ADS_ACCOUNT_ID'];
  for (const k of need) {
    const v = _cleanSecret(process.env[k]);
    if (!v) return { ok:false, source:'placeholder', channel:'microsoft', error:'not-configured', note:'Connect Microsoft Ads in Settings → Integrations to see live data.' };
  }
  try {
    // 1) OAuth — refresh access token
    const tok = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     _cleanSecret(process.env.MICROSOFT_ADS_CLIENT_ID),
        client_secret: _cleanSecret(process.env.MICROSOFT_ADS_CLIENT_SECRET),
        refresh_token: _cleanSecret(process.env.MICROSOFT_ADS_REFRESH_TOKEN),
        grant_type:    'refresh_token',
        scope:         'https://ads.microsoft.com/msads.manage offline_access',
      }).toString(),
    });
    const tj = await tok.json().catch(() => ({}));
    if (!tj.access_token) return { ok:false, channel:'microsoft', error:'oauth-failed', detail: tj.error_description || tj.error };
    const headers = {
      'Authorization':     `Bearer ${tj.access_token}`,
      'DeveloperToken':    _cleanSecret(process.env.MICROSOFT_ADS_DEVELOPER_TOKEN),
      'CustomerId':        _cleanSecret(process.env.MICROSOFT_ADS_CUSTOMER_ID),
      'CustomerAccountId': _cleanSecret(process.env.MICROSOFT_ADS_ACCOUNT_ID),
      'Content-Type':      'application/json',
    };
    const REPORTING = 'https://reporting.api.bingads.microsoft.com/Reporting/v13';
    // 2) Submit report
    const submit = await fetch(`${REPORTING}/GenerateReport/Submit`, {
      method:'POST', headers,
      body: JSON.stringify({ ReportRequest: {
        ExcludeColumnHeaders:false, ExcludeReportFooter:true, ExcludeReportHeader:true,
        Format:'Csv', ReportName:`IG Account ${days}d`, ReturnOnlyCompleteData:false,
        Type:'AccountPerformanceReport',
        Aggregation: days <= 7 ? 'Daily' : days <= 31 ? 'Daily' : 'Weekly',
        Columns:['AccountId','TimePeriod','Spend','Impressions','Clicks','Conversions','Revenue'],
        Scope:{ AccountIds:[Number(process.env.MICROSOFT_ADS_ACCOUNT_ID)] },
        Time:{ PredefinedTime: days <= 7 ? 'LastSevenDays' : days <= 30 ? 'LastMonth' : 'LastThreeMonths' },
      } }),
    });
    const sj = await submit.json().catch(() => ({}));
    if (!submit.ok || !sj.ReportRequestId) {
      const msg = sj?.Errors?.[0]?.Message || sj?.error?.message || `submit-${submit.status}`;
      return { ok:false, channel:'microsoft', error: msg };
    }
    // 3) Poll
    const reqId = sj.ReportRequestId;
    const deadline = Date.now() + 14000;
    let downloadUrl = null, lastStatus = 'Pending';
    const delays = [1500, 2000, 2500, 3000, 3500];
    let i = 0;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, delays[Math.min(i++, delays.length-1)]));
      const pr = await fetch(`${REPORTING}/GenerateReport/Poll`, {
        method:'POST', headers, body: JSON.stringify({ ReportRequestId: reqId }),
      });
      const pj = await pr.json().catch(() => ({}));
      lastStatus = pj?.ReportRequestStatus?.Status || lastStatus;
      if (lastStatus === 'Success') { downloadUrl = pj.ReportRequestStatus.ReportDownloadUrl; break; }
      if (lastStatus === 'Error')   return { ok:false, channel:'microsoft', error:'report-error' };
    }
    if (!downloadUrl) return { ok:false, channel:'microsoft', error:'report-pending', detail:'Bing report still building — refresh in ~1 min' };
    // 4) Download
    const dl = await fetch(downloadUrl);
    if (!dl.ok) return { ok:false, channel:'microsoft', error:`download-${dl.status}` };
    // Bing returns the report Csv directly; if the URL points to a .zip we
    // fall back to extracting via decompression. node fetch handles gzip on
    // the wire, so the raw download is the inner CSV in the common case.
    let csv = await dl.text();
    // If the response is a ZIP container (PK header), bail gracefully —
    // upstream caller can retry next cycle. Avoids garbled parsing.
    if (csv.charCodeAt(0) === 0x50 && csv.charCodeAt(1) === 0x4B) {
      return { ok:false, channel:'microsoft', error:'zipped-report-unsupported', detail:'Bing returned a zipped report bundle — set ExcludeReportHeader/Footer in the request and retry.' };
    }
    // Robust CSV split — handles quoted fields with embedded commas and
    // doubled-quote escaping ("" → ").
    const splitCsv = (line) => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === ',' && !q) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map(s => s.replace(/^"|"$/g, ''));
    };
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { ok:true, channel:'microsoft', spend:0, impressions:0, clicks:0, conversions:0, revenue:0 };
    const hdrs = splitCsv(lines[0]).map(h => h.trim());
    const idx  = (n) => hdrs.indexOf(n);
    let spend=0, imp=0, clk=0, conv=0, rev=0;
    for (let r = 1; r < lines.length; r++) {
      const cells = splitCsv(lines[r]);
      const num = (i) => i >= 0 ? Number(String(cells[i]||'').replace(/[^0-9.\-]/g,'')) || 0 : 0;
      spend += num(idx('Spend')); imp += num(idx('Impressions')); clk += num(idx('Clicks'));
      conv  += num(idx('Conversions')); rev += num(idx('Revenue'));
    }
    return { ok:true, channel:'microsoft', spend:+spend.toFixed(2), impressions:imp, clicks:clk, conversions:conv, revenue:+rev.toFixed(2) };
  } catch (e) { return { ok:false, channel:'microsoft', error: e.message }; }
}

// Look for conversion-pattern events in the user's Amplitude project. Used as
// the ground-truth customer count for blended CAC when available.
async function _fetchAmplitudeConversions(days = 30) {
  const apiKey    = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey) return { ok:false, channel:'amplitude', error:'not-configured' };
  const auth = 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  try {
    const eventsList = await _amplitudeFetch('/api/2/events/list', auth);
    const all = (eventsList?.data || []).map(e => e.value).filter(Boolean);
    const convPatterns = /signup|sign_up|register|subscribe|subscription|purchase|checkout|conversion|order_completed|paid|new_customer|trial_start|account_created/i;
    const matches = all.filter(e => convPatterns.test(e));
    if (!matches.length) {
      return { ok:true, channel:'amplitude', conversions:0, conversionEvents:[],
               note:'No conversion-pattern events in this Amplitude project (looked for signup/purchase/subscribe/etc).' };
    }
    const end   = new Date();
    const start = new Date(); start.setDate(start.getDate() - days);
    const fmt = _amplitudeFmtDate;
    let total = 0;
    const byEvent = [];
    for (const ev of matches.slice(0, 5)) {
      try {
        const e = encodeURIComponent(JSON.stringify({ event_type: ev }));
        const j = await _amplitudeFetch(
          `/api/2/events/segmentation?e=${e}&start=${fmt(start)}&end=${fmt(end)}&m=totals`,
          auth
        );
        const series = j?.data?.series?.[0] || [];
        const sum = series.reduce((a, b) => a + (Number(b) || 0), 0);
        total += sum;
        byEvent.push({ event: ev, count: sum });
      } catch (_) { /* skip events that fail individually */ }
    }
    return { ok:true, channel:'amplitude', conversions: total, conversionEvents: byEvent };
  } catch (e) { return { ok:false, channel:'amplitude', error: e.message, status: e.status }; }
}

// T34 — pull revenue per platform from `ad_performance_hourly` (the optimizer's
// own ingested table). This lets us compute MER + per-channel ROAS without
// adding new fields to the spend fetchers and without depending on Stripe/Shopify.
// Blended ROAS · marketing officer suite routes → services/officer/routes.js
require('./services/officer/routes')(app, { _db, _fetchAmplitudeConversions, _fetchGoogleAdsSpend, _fetchMetaSpend, _fetchTikTokSpend, _sendChatWebhook, _sendEmailViaResend, _tkvCtx, fs, multer, openai, openaiChatWithRetry, path });

// Goals · Lead Qualifier · Re-engagement routes → services/growth_ops/routes.js
require('./services/growth_ops/routes')(app, {
  _amplitudeFetch, _amplitudeFmtDate, _dripLoad, _dripLock, _dripSave, _enrollDripCore, _fetchAmplitudeConversions, _fetchGoogleAdsSpend, _fetchMetaSpend, _fetchTikTokSpend, _tkvCtx, _tkvRead, _tkvWrite, openaiChatWithRetry,
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSISTANT COMMAND BAR — natural-language → executes real InfoGenie endpoints
// via GPT-4o function calling. Two-shot: tool selection, then result summary.
// Destructive tools require explicit confirmation (preview then re-call with
// confirm:true).
// ─────────────────────────────────────────────────────────────────────────────
// Assistant · mentions · alerts · stakeholders · webhooks · launches routes → services/assistant_ops/routes.js
require('./services/assistant_ops/routes')(app, { _DIAG_CAP_PREFIX, _DIAG_LATEST_KEY, _fetchGoogleAdsSpend, _fetchMetaSpend, _fetchMicrosoftSpend, _fetchTikTokSpend, _isUrlSafeToFetch, _sendEmailViaResend, _tkvCtx, _tkvMutate, _tkvRead, _tkvScope, callDataForSEO, fs, openaiChatWithRetry, path });

// ═════════════════════════════════════════════════════════════════════════════
// EXTRA INTEGRATIONS — wired 2026-04-30
// Each endpoint returns { ok, configured, ... } and degrades gracefully when
// the required env var(s) are missing (configured:false + helpful note).
// ═════════════════════════════════════════════════════════════════════════════

function _missingCreds(res, integration, missing) {
  return res.json({
    ok: true, configured: false, integration, missing,
    note: `${integration} not configured — set ${missing.join(' + ')} in Secrets to enable live data.`,
    dataOrigin: 'fallback', dataSource: 'env_check', confidence: 'none',
  });
}

// ─── Meta Ad Library API (uses META_ACCESS_TOKEN) ────────────────────────────
// POST /api/meta-ad-library/search { query?, domain?, country?, limit? }
//
// Strategy:
//  1. Try the official Meta Graph API (/v19.0/ads_archive) — fast + structured.
//  2. If Meta returns the "Application does not have permission" error (which
//     happens when the user behind the token has not completed Facebook's
//     Identity Confirmation flow at facebook.com/ID), fall back to scraping
//     the public facebook.com/ads/library page via Firecrawl. The scraped
//     page is the same data anyone can see in a browser, with no auth.
// Meta ad library · notify · GA4 · GSC routes → services/analytics_connectors/routes.js
require('./services/analytics_connectors/routes')(app, { _chargeBudget, _credentialsVault, _missingCreds, _send429IfBudget });

// Internal helper: scrape a URL via Firecrawl and return raw HTML for our
// existing on-page-signal extractor in _scrapePageForScoring.
async function _firecrawlGetHtml(url, timeoutMs = 12000) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { ok:false, error:'firecrawl_not_configured' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method:'POST', signal: ctrl.signal,
      headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ url, formats:['html'] })
    });
    const j = await r.json();
    if (!j.success || !j.data?.html) return { ok:false, error: j.error || 'no html returned' };
    return { ok:true, html: j.data.html };
  } catch (err) {
    return { ok:false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(t);
  }
}

// ── SpyFu ────────────────────────────────────────────────────────────────────
const _spyfuRouter = require('./services/spyfu/api');
app.use('/api/spyfu', _spyfuRouter);

// ── Majestic SEO ──────────────────────────────────────────────────────────────
const _majesticRouter = require('./services/majestic/api');
app.use('/api/majestic', _majesticRouter);

// ── T116 — Real-Time News ─────────────────────────────────────────────────────
const _rtnRouter = require('./services/realtime_news/api');
const _rtnSchema = require('./services/realtime_news/schema');
app.use('/api/realtime-news', _rtnRouter);
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) await _rtnSchema.ensureRealtimeNewsSchema();
    console.log('[t116] realtime-news schema ready');
  } catch(e) { console.warn('[t116] schema init failed:', e.message); }
});

// ── T117 Multi-touch Attribution Dashboard ────────────────────────────────────
const _attrRouter = require('./services/attribution/api');
const _attrSchema = require('./services/attribution/schema');
app.use('/api/attribution', _attrRouter);
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) await _attrSchema.ensureAttributionSchema();
    console.log('[t117] attribution schema ready');
  } catch(e) { console.warn('[t117] attribution schema init failed:', e.message); }
});

// ── T118 Product Library ──────────────────────────────────────────────────────
const _prodLibRouter = require('./services/product_library/api');
const _prodLibSchema = require('./services/product_library/schema');
app.use('/api/products', _prodLibRouter);
BOOT_TASKS.push(async () => {
  try {
    if (_db.hasDb()) await _prodLibSchema.ensureProductLibrarySchema();
    console.log('[t118] product-library schema ready');
  } catch(e) { console.warn('[t118] product-library schema init failed:', e.message); }
});

// ── Bing Webmaster Tools ─────────────────────────────────────────────────────
const _bingWmtSchema = require('./services/bing_webmaster/schema');
const _bingWmtRouter = require('./services/bing_webmaster/api');
app.use('/api/bing-webmaster', _bingWmtRouter);
BOOT_TASKS.push(async () => { try { if (_db.hasDb()) { await _bingWmtSchema.ensureBingWebmasterSchema(); console.log('[bing-wmt] schema ready'); } } catch(e) { console.error('[bing-wmt] init failed:', e.message); } });

// ── Google Trends ────────────────────────────────────────────────────────────
const _googleTrendsRouter = require('./services/google_trends/api');
app.use('/api/google-trends', _googleTrendsRouter);

// ── Semrush ───────────────────────────────────────────────────────────────────
const _semrushRouter = require('./services/semrush/api');
app.use('/api/semrush', _semrushRouter);

// ── Ahrefs ────────────────────────────────────────────────────────────────────
const _ahrefsRouter = require('./services/ahrefs/api');
app.use('/api/ahrefs', _ahrefsRouter);

// ── Serpstat ──────────────────────────────────────────────────────────────────
const _serpstatRouter = require('./services/serpstat/api');
app.use('/api/serpstat', _serpstatRouter);

// ── ContentKing ───────────────────────────────────────────────────────────────
const _contentkingRouter = require('./services/contentking/api');
app.use('/api/contentking', _contentkingRouter);

// ─── Profound (LLM brand-mention tracker) ───────────────────────────────────
// Profound · Shopify · AppsFlyer routes → services/external_connectors/routes.js
require('./services/external_connectors/routes')(app, { _missingCreds });

// ── App builder export (for the test harness) ────────────────────────────────
// server.js builds and wires the Express `app` above at require time. Because
// the background guard (set near the top from require.main===module) is off when
// this file is required as a module, importing it binds no port and starts no
// timers/crons — requiring it is side-effect-free beyond constructing `app`.
// buildApp() hands that fully-configured app (full middleware chain, auth routes
// and matrix enforcement included) to test/helpers/app.js so the harness no
// longer hand-rebuilds the middleware chain. It returns the singleton app.
function buildApp() { return app; }
module.exports = { app, buildApp };
