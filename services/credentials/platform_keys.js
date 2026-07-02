// services/credentials/platform_keys.js — Platform-owned API keys (Task 136)
//
// These are the keys InfoGenie itself pays for and operates on behalf of EVERY
// tenant: the LLM providers, the SEO/intel data vendors, and the shared infra
// (Resend, Stripe, web-push, Amplitude). They are NOT tenant-scoped — there is
// exactly one value per key for the whole platform — so they live in their own
// `platform_api_keys` table (key_name PRIMARY KEY) rather than in the per-user
// credential vault or the tenant-scoped kv api-key store.
//
// Storage: AES-256-GCM (the same cipher + master key used by the user vault,
// reused via vault.encryptString/decryptString) so a DB dump never leaks a key.
//
// Runtime resolution: at boot we hydrate() the DB values into process.env (and
// known aliases) so the hundreds of existing `process.env.X` readers across the
// codebase transparently pick up the admin-managed value, with the original env
// var as the fallback when no DB row exists. resolvePlatformKey(name) is the
// explicit accessor for new code. DB always wins over env.

const _db = require('../../db');
const _vault = require('./vault');

// ── Registry ────────────────────────────────────────────────────────────────
// Each entry is ONE environment variable (the canonical key_name). Multi-var
// services (Cloudflare, DataForSEO, Resend, Stripe, VAPID) are modelled as
// several entries sharing a `service` label so the UI can group them.
//   secret:    mask the value in the UI and never echo it back
//   aliases:   other env var names some modules read — kept in sync on hydrate
//   test:      logical id for testKey() live checks (openai/anthropic/dataforseo/resend)
//   settingsIds: the lowercased platform identifiers these keys used to be saved
//               under via /api/settings/api-key — used to build the blocklist
const REGISTRY = [
  // ── AI Models ──────────────────────────────────────────────────────────────
  { key: 'AI_INTEGRATIONS_OPENAI_API_KEY', group: 'AI Models', service: 'OpenAI', label: 'OpenAI API Key', desc: 'GPT-4o / GPT-4o-mini — ad copy, strategy, chat, DALL·E', secret: true, aliases: ['OPENAI_API_KEY'], test: 'openai', settingsIds: ['openai'] },
  { key: 'AI_INTEGRATIONS_ANTHROPIC_API_KEY', group: 'AI Models', service: 'Anthropic', label: 'Anthropic API Key', desc: 'Claude — deep competitive analysis & long-form strategy', secret: true, aliases: ['ANTHROPIC_API_KEY'], test: 'anthropic', settingsIds: ['anthropic'] },
  { key: 'GEMINI_API_KEY', group: 'AI Models', service: 'Google Gemini', label: 'Gemini API Key', desc: 'Google Gemini — multimodal generation & analysis', secret: true, test: 'gemini', settingsIds: ['gemini'] },
  { key: 'PERPLEXITY_API_KEY', group: 'AI Models', service: 'Perplexity', label: 'Perplexity API Key', desc: 'Perplexity — live web-grounded research', secret: true, test: 'perplexity', settingsIds: ['perplexity'] },
  { key: 'CLOUDFLARE_ACCOUNT_ID', group: 'AI Models', service: 'Cloudflare Workers AI', label: 'Cloudflare Account ID', desc: 'Workers AI (Llama 3.1) — account identifier', secret: false, settingsIds: ['cloudflare'] },
  { key: 'CLOUDFLARE_AI_TOKEN', group: 'AI Models', service: 'Cloudflare Workers AI', label: 'Cloudflare AI Token', desc: 'Workers AI (Llama 3.1) — API token', secret: true, test: 'cloudflare', settingsIds: ['cloudflare'] },
  { key: 'RAPIDAPI_KEY', group: 'AI Models', service: 'RapidAPI', label: 'RapidAPI Key', desc: 'Multi-purpose RapidAPI key — Meta Llama 3.2 Vision (LLM fallback) + Google SEO Keyword Research (keyword-research-for-seo)', secret: true, test: 'rapidapi_llama', settingsIds: ['rapidapi'] },

  // ── Data & Intelligence ─────────────────────────────────────────────────────
  { key: 'DATAFORSEO_LOGIN', group: 'Data & Intelligence', service: 'DataForSEO', label: 'DataForSEO Login', desc: 'SEO/SERP/keyword data — account login', secret: false, test: 'dataforseo', settingsIds: ['dataforseo', 'dataseo'] },
  { key: 'DATAFORSEO_PASSWORD', group: 'Data & Intelligence', service: 'DataForSEO', label: 'DataForSEO Password', desc: 'SEO/SERP/keyword data — account password', secret: true, testedBy: 'dataforseo', settingsIds: ['dataforseo', 'dataseo'] },
  { key: 'FIRECRAWL_API_KEY', group: 'Data & Intelligence', service: 'Firecrawl', label: 'Firecrawl API Key', desc: 'Website crawling & scraping', secret: true, test: 'firecrawl', settingsIds: ['firecrawl'] },
  { key: 'APOLLO_API_KEY', group: 'Data & Intelligence', service: 'Apollo', label: 'Apollo API Key', desc: 'B2B contact & company enrichment', secret: true, test: 'apollo', settingsIds: ['apollo'] },
  { key: 'ZERNIO_API_KEY', group: 'Data & Intelligence', service: 'Zernio', label: 'Zernio API Key', desc: 'Social publishing', secret: true, settingsIds: ['zernio'] },
  { key: 'MODASH_API_KEY', group: 'Data & Intelligence', service: 'Modash', label: 'Modash API Key', desc: 'Influencer Discovery — real follower counts, engagement rates & audience-quality scores (IG/TikTok/YouTube)', secret: true, test: 'modash', settingsIds: ['modash'] },
  { key: 'BUILTWITH_API_KEY', group: 'Data & Intelligence', service: 'BuiltWith', label: 'BuiltWith API Key', desc: 'Tech-stack detection', secret: true, test: 'builtwith', settingsIds: ['builtwith'] },
  { key: 'GOOGLE_PAGESPEED_API_KEY', group: 'Data & Intelligence', service: 'Google PageSpeed', label: 'PageSpeed API Key', desc: 'Core Web Vitals & page performance audits', secret: true, test: 'pagespeed', settingsIds: ['pagespeed', 'google_pagespeed'] },
  { key: 'GOOGLE_SEARCH_API_KEY', group: 'Data & Intelligence', service: 'Google Search', label: 'Google Search API Key', desc: 'Custom Search / SERP visibility', secret: true, test: 'google_search', settingsIds: ['google_search'] },
  { key: 'YOUTUBE_DATA_API_KEY', group: 'Data & Intelligence', service: 'YouTube Data', label: 'YouTube Data API Key', desc: 'YouTube trending videos (chart=mostPopular) for Trending Topics', secret: true, test: 'youtube_data', settingsIds: ['youtube_data'] },
  { key: 'BING_WEBMASTER_API_KEY', group: 'Data & Intelligence', service: 'Bing Webmaster', label: 'Bing Webmaster API Key', desc: 'Bing keyword performance, page stats, and crawl data — free second SEO data source alongside Google', secret: true, test: 'bing_webmaster', settingsIds: ['bing_webmaster'] },

  // ── Infrastructure ──────────────────────────────────────────────────────────
  { key: 'RESEND_API_KEY', group: 'Infrastructure', service: 'Resend', label: 'Resend API Key', desc: 'Transactional & broadcast email', secret: true, test: 'resend', settingsIds: ['resend'] },
  { key: 'RESEND_WEBHOOK_SECRET', group: 'Infrastructure', service: 'Resend', label: 'Resend Webhook Secret', desc: 'Verifies inbound Resend webhooks', secret: true, settingsIds: ['resend'] },
  { key: 'RESEND_FROM_EMAIL', group: 'Infrastructure', service: 'Resend', label: 'Resend From Email', desc: 'Verified sender address (must be a verified Resend domain)', secret: false, settingsIds: ['resend'] },
  { key: 'AMPLITUDE_API_KEY', group: 'Infrastructure', service: 'Amplitude', label: 'Amplitude API Key', desc: 'Product analytics ingestion', secret: true, test: 'amplitude', settingsIds: ['amplitude'] },
  { key: 'STRIPE_SECRET_KEY', group: 'Infrastructure', service: 'Stripe', label: 'Stripe Secret Key', desc: 'Billing & checkout', secret: true, test: 'stripe', settingsIds: ['stripe'] },
  { key: 'STRIPE_WEBHOOK_SECRET', group: 'Infrastructure', service: 'Stripe', label: 'Stripe Webhook Secret', desc: 'Verifies inbound Stripe webhooks', secret: true, settingsIds: ['stripe'] },
  { key: 'VAPID_PUBLIC_KEY', group: 'Infrastructure', service: 'Web Push (VAPID)', label: 'VAPID Public Key', desc: 'Web-push subscription public key', secret: false, settingsIds: ['vapid'] },
  { key: 'VAPID_PRIVATE_KEY', group: 'Infrastructure', service: 'Web Push (VAPID)', label: 'VAPID Private Key', desc: 'Web-push signing private key', secret: true, settingsIds: ['vapid'] },
  { key: 'VAPID_SUBJECT', group: 'Infrastructure', service: 'Web Push (VAPID)', label: 'VAPID Subject', desc: 'Web-push contact (mailto: or https URL)', secret: false, settingsIds: ['vapid'] },
];

const _byKey = new Map(REGISTRY.map(e => [e.key, e]));

// Platform identifiers that must NOT be writable/readable via the tenant-scoped
// /api/settings/api-key endpoint by non-admins (Task 136 step 5).
const PLATFORM_KEY_BLOCKLIST = new Set(
  REGISTRY.flatMap(e => (e.settingsIds || []).map(s => String(s).toLowerCase()))
);

function isPlatformKeyName(name) {
  return PLATFORM_KEY_BLOCKLIST.has(String(name || '').toLowerCase().trim());
}

// In-memory cache of DB-sourced values only (key_name -> plaintext value).
const _cache = new Map();

// In-memory cache of the last live-test verdict per key_name. Mirrors the
// platform_key_tests table so the synchronous statusAll() can surface a health
// dot without a DB round-trip. Shape: { status, message, testedAt(ISO), testedBy }.
const _lastTestCache = new Map();

// ── Schema ────────────────────────────────────────────────────────────────────
async function ensurePlatformKeysSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS platform_api_keys (
      key_name    TEXT PRIMARY KEY,
      ciphertext  BYTEA NOT NULL,
      iv          BYTEA NOT NULL,
      tag         BYTEA NOT NULL,
      updated_by  INTEGER,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Last live-test result per key. Separate from platform_api_keys because a
  // key may be configured via env only (no platform_api_keys row) yet still be
  // testable, and we want its verdict to survive a reload regardless.
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS platform_key_tests (
      key_name   TEXT PRIMARY KEY,
      status     TEXT NOT NULL,
      message    TEXT,
      tested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      tested_by  INTEGER
    )
  `);
}

// Push a resolved value into process.env (+ aliases) so legacy direct readers
// pick it up. DB always overrides whatever env shipped at boot.
function _applyToEnv(entry, value) {
  if (value == null) return;
  process.env[entry.key] = value;
  for (const a of (entry.aliases || [])) process.env[a] = value;
}

// Load all DB values, decrypt, cache, and overlay onto process.env.
async function hydrate() {
  if (!_db.hasDb()) return 0;
  await ensurePlatformKeysSchema();
  let n = 0;
  try {
    const r = await _db.getPool().query('SELECT key_name, ciphertext, iv, tag FROM platform_api_keys');
    for (const row of r.rows) {
      const entry = _byKey.get(row.key_name);
      if (!entry) continue; // unknown / retired key — ignore
      try {
        const val = _vault.decryptString(row.ciphertext, row.iv, row.tag);
        if (val == null || val === '') { _cache.delete(row.key_name); continue; }
        _cache.set(row.key_name, val);
        _applyToEnv(entry, val);
        n++;
      } catch (e) {
        console.warn(`[platform-keys] decrypt failed for ${row.key_name}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn('[platform-keys] hydrate failed:', e.message);
  }
  // Load the last-test verdicts into the in-memory cache so the health dots
  // render correctly on the first page load after a restart.
  try {
    const tr = await _db.getPool().query('SELECT key_name, status, message, tested_at, tested_by FROM platform_key_tests');
    _lastTestCache.clear();
    for (const row of tr.rows) {
      if (!_byKey.has(row.key_name)) continue;
      _lastTestCache.set(row.key_name, {
        status: row.status,
        message: row.message || '',
        testedAt: row.tested_at ? new Date(row.tested_at).toISOString() : null,
        testedBy: row.tested_by != null ? Number(row.tested_by) : null,
      });
    }
  } catch (e) {
    console.warn('[platform-keys] last-test hydrate failed:', e.message);
  }
  console.log(`[platform-keys] hydrated ${n} key(s) from DB`);
  return n;
}

// Persist a test verdict (best-effort) and update the in-memory cache so the
// next statusAll() reflects it immediately.
async function _recordTest(keyName, result, actorId) {
  const rec = {
    status: result && result.status ? result.status : 'error',
    message: (result && result.message) || '',
    testedAt: new Date().toISOString(),
    testedBy: Number.isInteger(actorId) ? actorId : null,
  };
  _lastTestCache.set(keyName, rec);
  if (!_db.hasDb()) return rec;
  try {
    await _db.getPool().query(`
      INSERT INTO platform_key_tests (key_name, status, message, tested_at, tested_by)
      VALUES ($1,$2,$3, now(), $4)
      ON CONFLICT (key_name) DO UPDATE
        SET status=EXCLUDED.status, message=EXCLUDED.message,
            tested_at=now(), tested_by=EXCLUDED.tested_by
    `, [keyName, rec.status, rec.message.slice(0, 500), rec.testedBy]);
  } catch (e) {
    console.warn(`[platform-keys] record test failed for ${keyName}: ${e.message}`);
  }
  return rec;
}

// Resolve a single platform key: DB cache first, then env fallback.
function resolvePlatformKey(keyName) {
  if (_cache.has(keyName)) return _cache.get(keyName);
  const v = process.env[keyName];
  return v == null || v === '' ? null : v;
}

// Upsert (or clear, when value is empty) a platform key. actorId is recorded for
// the audit trail; the value itself is NEVER logged.
async function setPlatformKey(keyName, value, actorId) {
  const entry = _byKey.get(keyName);
  if (!entry) { const e = new Error('unknown platform key'); e.code = 'unknown_key'; throw e; }
  if (!_db.hasDb()) { const e = new Error('database unavailable'); e.code = 'no_db'; throw e; }

  const v = value == null ? '' : String(value).trim();

  if (v === '') {
    // Clear the DB override; runtime falls back to the original env var.
    await _db.getPool().query('DELETE FROM platform_api_keys WHERE key_name=$1', [keyName]);
    _cache.delete(keyName);
    return { ok: true, cleared: true };
  }

  if (!_vault.hasKey()) { const e = new Error('CREDENTIAL_ENCRYPTION_KEY not configured'); e.code = 'no_master_key'; throw e; }

  const { ciphertext, iv, tag } = _vault.encryptString(v);
  await _db.getPool().query(`
    INSERT INTO platform_api_keys (key_name, ciphertext, iv, tag, updated_by, updated_at)
    VALUES ($1,$2,$3,$4,$5, now())
    ON CONFLICT (key_name) DO UPDATE
      SET ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv, tag=EXCLUDED.tag,
          updated_by=EXCLUDED.updated_by, updated_at=now()
  `, [keyName, ciphertext, iv, tag, Number.isInteger(actorId) ? actorId : null]);

  _cache.set(keyName, v);
  _applyToEnv(entry, v);
  return { ok: true };
}

function _mask(entry, value) {
  if (!value) return '';
  if (!entry.secret) return value; // IDs / emails / public keys shown in full
  const s = String(value);
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

// Status of every key, grouped, for the admin UI. Never returns secret values
// raw — only a masked preview, the configured flag, and the source.
function statusAll() {
  const groups = {};
  for (const entry of REGISTRY) {
    const inDb = _cache.has(entry.key) && _cache.get(entry.key);
    const envVal = process.env[entry.key];
    const value = inDb ? _cache.get(entry.key) : (envVal || '');
    const configured = !!value;
    const source = inDb ? 'db' : (envVal ? 'env' : null);
    (groups[entry.group] = groups[entry.group] || []).push({
      key: entry.key,
      service: entry.service,
      label: entry.label,
      desc: entry.desc,
      secret: !!entry.secret,
      configured,
      source,
      masked: _mask(entry, value),
      // testable: has its own live check → gets a Test button.
      // covered:  validated as part of a sibling key's test (e.g. the password
      //           checked by the login test) → no button, no "no test" marker.
      // noTest:   genuinely has no cheap connectivity check → clearly labelled.
      testable: !!entry.test,
      covered: !!entry.testedBy,
      noTest: !entry.test && !entry.testedBy,
      // Last live-test verdict (null until first tested). Drives the health dot.
      lastTest: _lastTestCache.get(entry.key) || null,
    });
  }
  return Object.entries(groups).map(([group, items]) => ({ group, items }));
}

// ── Live connectivity tests (best-effort) ──────────────────────────────────────
// fetch() with an abort timeout so a hung vendor never blocks the admin UI.
async function _fetchT(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// Some vendors return HTTP 200 with an in-body error, or only reveal a bad key
// via 401/403. These helpers keep the per-service logic below readable.
const _OK = (message) => ({ ok: true, status: 'ok', message });
const _BAD = (message) => ({ ok: false, status: 'invalid', message });
const _UNCONF = (message) => ({ ok: false, status: 'unconfigured', message: message || 'No key configured' });
const _HTTP = (svc, r) => ({ ok: false, status: 'error', message: svc + ' returned HTTP ' + r.status });
async function _bodyText(r) { try { return await r.text(); } catch { return ''; } }

async function _runTest(keyName) {
  const entry = _byKey.get(keyName);
  if (!entry) return { ok: false, status: 'error', message: 'unknown key' };
  if (!entry.test) return { ok: false, status: 'error', message: 'no test available for this key' };
  try {
    if (entry.test === 'openai') {
      const key = resolvePlatformKey('AI_INTEGRATIONS_OPENAI_API_KEY') || resolvePlatformKey('OPENAI_API_KEY');
      if (!key) return _UNCONF();
      const base = (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const r = await _fetchT(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
      if (r.ok) return _OK('OpenAI reachable');
      if (r.status === 401 || r.status === 403) return _BAD('OpenAI rejected the key (HTTP ' + r.status + ')');
      return _HTTP('OpenAI', r);
    }
    if (entry.test === 'anthropic') {
      const key = resolvePlatformKey('AI_INTEGRATIONS_ANTHROPIC_API_KEY') || resolvePlatformKey('ANTHROPIC_API_KEY');
      if (!key) return _UNCONF();
      const base = (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
      const r = await _fetchT(base + '/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
      if (r.ok) return _OK('Anthropic reachable');
      if (r.status === 401 || r.status === 403) return _BAD('Anthropic rejected the key (HTTP ' + r.status + ')');
      return _HTTP('Anthropic', r);
    }
    if (entry.test === 'dataforseo') {
      const login = resolvePlatformKey('DATAFORSEO_LOGIN');
      const pass = resolvePlatformKey('DATAFORSEO_PASSWORD');
      if (!login || !pass) return _UNCONF('Login + password required');
      const auth = Buffer.from(login + ':' + pass).toString('base64');
      const r = await _fetchT('https://api.dataforseo.com/v3/appendix/user_data', { headers: { Authorization: 'Basic ' + auth } });
      if (r.ok) return _OK('DataForSEO authenticated');
      if (r.status === 401 || r.status === 403) return _BAD('DataForSEO rejected the login/password (HTTP ' + r.status + ')');
      return _HTTP('DataForSEO', r);
    }
    if (entry.test === 'resend') {
      const key = resolvePlatformKey('RESEND_API_KEY');
      if (!key) return _UNCONF();
      const r = await _fetchT('https://api.resend.com/domains', { headers: { Authorization: 'Bearer ' + key } });
      if (r.ok) return _OK('Resend authenticated');
      if (r.status === 401 || r.status === 403) return _BAD('Resend rejected the key (HTTP ' + r.status + ')');
      return _HTTP('Resend', r);
    }
    if (entry.test === 'gemini') {
      const key = resolvePlatformKey('GEMINI_API_KEY');
      if (!key) return _UNCONF();
      const r = await _fetchT('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
      if (r.ok) return _OK('Gemini reachable');
      if (r.status === 400 || r.status === 401 || r.status === 403) return _BAD('Gemini rejected the key (HTTP ' + r.status + ')');
      return _HTTP('Gemini', r);
    }
    if (entry.test === 'perplexity') {
      const key = resolvePlatformKey('PERPLEXITY_API_KEY');
      if (!key) return _UNCONF();
      // Auth probe: an empty body fails request validation (400) *after* the key
      // is checked, so a bad key surfaces as 401/403 without spending tokens.
      const r = await _fetchT('https://api.perplexity.ai/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: '{}',
      });
      if (r.status === 401 || r.status === 403) return _BAD('Perplexity rejected the key (HTTP ' + r.status + ')');
      if (r.ok || r.status === 400 || r.status === 422) return _OK('Perplexity authenticated');
      return _HTTP('Perplexity', r);
    }
    if (entry.test === 'cloudflare') {
      const token = resolvePlatformKey('CLOUDFLARE_AI_TOKEN');
      if (!token) return _UNCONF('AI token required');
      // Verifies the token is valid & active regardless of its scope. A malformed
      // or unknown token is rejected with 400/401/403 (not just 401).
      const r = await _fetchT('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) return _OK('Cloudflare token active');
      if (r.status === 400 || r.status === 401 || r.status === 403) return _BAD('Cloudflare rejected the token (HTTP ' + r.status + ')');
      return _HTTP('Cloudflare', r);
    }
    if (entry.test === 'firecrawl') {
      const key = resolvePlatformKey('FIRECRAWL_API_KEY');
      if (!key) return _UNCONF();
      // Auth probe against the scrape endpoint with an empty body — a bad key is
      // rejected (401/403) before any page is fetched, so no credits are spent.
      const r = await _fetchT('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: '{}',
      });
      if (r.status === 401 || r.status === 403) return _BAD('Firecrawl rejected the key (HTTP ' + r.status + ')');
      if (r.ok || r.status === 400 || r.status === 422) return _OK('Firecrawl authenticated');
      return _HTTP('Firecrawl', r);
    }
    if (entry.test === 'apollo') {
      const key = resolvePlatformKey('APOLLO_API_KEY');
      if (!key) return _UNCONF();
      // Apollo's health endpoint returns HTTP 200 even for a bad key — the truth
      // is in the body: is_logged_in=false means the key was not accepted.
      const r = await _fetchT('https://api.apollo.io/api/v1/auth/health', { headers: { 'X-Api-Key': key, Accept: 'application/json', 'Cache-Control': 'no-cache' } });
      if (r.status === 401 || r.status === 403) return _BAD('Apollo rejected the key (HTTP ' + r.status + ')');
      if (!r.ok) return _HTTP('Apollo', r);
      let data = null; try { data = JSON.parse(await _bodyText(r)); } catch {}
      if (data && data.is_logged_in === true) return _OK('Apollo authenticated');
      return _BAD('Apollo rejected the key');
    }
    if (entry.test === 'modash') {
      const key = resolvePlatformKey('MODASH_API_KEY');
      if (!key) return _UNCONF();
      // Probe: search with an empty filter, limit=1. A bad/missing key returns
      // 401 before any data is consumed; a valid key returns 200 or 400 (if the
      // filter is malformed for this plan). Either non-401 response means auth ok.
      const r = await _fetchT('https://api.modash.io/v1/instagram/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ filter: {}, paging: { limit: 1 } }),
      });
      if (r.status === 401 || r.status === 403) return _BAD('Modash rejected the key (HTTP ' + r.status + ')');
      if (r.ok || r.status === 400 || r.status === 422) return _OK('Modash authenticated');
      return _HTTP('Modash', r);
    }
    if (entry.test === 'builtwith') {
      const key = resolvePlatformKey('BUILTWITH_API_KEY');
      if (!key) return _UNCONF();
      // BuiltWith returns HTTP 200 with an in-body Errors[] for a bad key.
      const r = await _fetchT('https://api.builtwith.com/free1/api.json?KEY=' + encodeURIComponent(key) + '&LOOKUP=builtwith.com');
      const txt = await _bodyText(r);
      if (r.status === 401 || r.status === 403) return _BAD('BuiltWith rejected the key (HTTP ' + r.status + ')');
      if (!r.ok) return _HTTP('BuiltWith', r);
      let data = null; try { data = JSON.parse(txt); } catch {}
      const errs = data && data.Errors;
      if (Array.isArray(errs) && errs.length) {
        const msg = (errs[0] && (errs[0].Message || errs[0].message)) || String(errs[0]);
        return _BAD('BuiltWith: ' + msg);
      }
      return _OK('BuiltWith authenticated');
    }
    if (entry.test === 'pagespeed') {
      const key = resolvePlatformKey('GOOGLE_PAGESPEED_API_KEY');
      if (!key) return _UNCONF();
      // No `url` param → request fails validation *before* running any audit, so
      // a valid key returns "missing url" while a bad key returns "API key not valid".
      const r = await _fetchT('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?key=' + encodeURIComponent(key));
      const txt = await _bodyText(r);
      if (/api key not valid|api_key_invalid|keyinvalid/i.test(txt)) return _BAD('Google rejected the API key');
      if (r.ok || r.status === 400) return _OK('PageSpeed key accepted');
      if (r.status === 401 || r.status === 403) return _BAD('Google rejected the API key (HTTP ' + r.status + ')');
      return _HTTP('PageSpeed', r);
    }
    if (entry.test === 'google_search') {
      const key = resolvePlatformKey('GOOGLE_SEARCH_API_KEY');
      if (!key) return _UNCONF();
      // Same probe pattern: missing cx/q fails after the key is validated.
      const r = await _fetchT('https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(key));
      const txt = await _bodyText(r);
      if (/api key not valid|api_key_invalid|keyinvalid/i.test(txt)) return _BAD('Google rejected the API key');
      if (r.ok || r.status === 400) return _OK('Google Search key accepted');
      if (r.status === 401 || r.status === 403) return _BAD('Google rejected the API key (HTTP ' + r.status + ')');
      return _HTTP('Google Search', r);
    }
    if (entry.test === 'youtube_data') {
      const key = resolvePlatformKey('YOUTUBE_DATA_API_KEY');
      if (!key) return _UNCONF();
      // Probe: videoCategories list with a known regionCode. A bad key is
      // rejected (400 "API key not valid") before any quota is consumed.
      const r = await _fetchT('https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=' + encodeURIComponent(key));
      const txt = await _bodyText(r);
      if (/api key not valid|api_key_invalid|keyinvalid/i.test(txt)) return _BAD('YouTube Data API rejected the key');
      if (r.ok) return _OK('YouTube Data API key accepted');
      if (r.status === 400 || r.status === 401 || r.status === 403) return _BAD('YouTube Data API rejected the key (HTTP ' + r.status + ')');
      return _HTTP('YouTube Data API', r);
    }
    if (entry.test === 'bing_webmaster') {
      const key = resolvePlatformKey('BING_WEBMASTER_API_KEY');
      if (!key) return _UNCONF();
      // Probe: GetSites with a valid key returns an array (possibly empty). A bad
      // key returns HTTP 403 or a body with error code before any site data is read.
      const r = await _fetchT('https://ssl.bing.com/webmaster/api.svc/json/GetSites?apikey=' + encodeURIComponent(key));
      if (r.status === 401 || r.status === 403) return _BAD('Bing Webmaster rejected the key (HTTP ' + r.status + ')');
      if (!r.ok) return _HTTP('Bing Webmaster', r);
      let data = null; try { data = JSON.parse(await _bodyText(r)); } catch {}
      if (data && data.Message) return _BAD('Bing Webmaster: ' + data.Message);
      return _OK('Bing Webmaster key accepted');
    }
    if (entry.test === 'amplitude') {
      const key = resolvePlatformKey('AMPLITUDE_API_KEY');
      if (!key) return _UNCONF();
      // Empty events[] → 400 "missing required field" for a valid key, or an
      // "Invalid API key" body for a bad one. No real events are ingested.
      const r = await _fetchT('https://api2.amplitude.com/2/httpapi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, events: [] }),
      });
      const txt = await _bodyText(r);
      if (/invalid api key/i.test(txt)) return _BAD('Amplitude rejected the key');
      if (r.status === 401 || r.status === 403) return _BAD('Amplitude rejected the key (HTTP ' + r.status + ')');
      if (r.ok || r.status === 400) return _OK('Amplitude accepted the key');
      return _HTTP('Amplitude', r);
    }
    if (entry.test === 'stripe') {
      const key = resolvePlatformKey('STRIPE_SECRET_KEY');
      if (!key) return _UNCONF();
      const r = await _fetchT('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + key } });
      if (r.ok) return _OK('Stripe authenticated');
      if (r.status === 401 || r.status === 403) return _BAD('Stripe rejected the key (HTTP ' + r.status + ')');
      return _HTTP('Stripe', r);
    }
    if (entry.test === 'rapidapi_llama') {
      const key = resolvePlatformKey('RAPIDAPI_KEY');
      if (!key) return _UNCONF();
      // Probe: tiny chat completion — reveals a bad key (401/403) without using
      // meaningful quota. The RapidAPI host is the Llama 3.2 Vision endpoint.
      const host = 'meta-llama-3-2-vision.p.rapidapi.com';
      const r = await _fetchT('https://' + host + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-key': key,
          'x-rapidapi-host': host,
        },
        body: JSON.stringify({ model: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo', messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 5 }),
      });
      if (r.status === 401 || r.status === 403) return _BAD('RapidAPI rejected the key (HTTP ' + r.status + ')');
      if (r.ok || r.status === 400 || r.status === 422) return _OK('Meta Llama (RapidAPI) reachable');
      return _HTTP('Meta Llama (RapidAPI)', r);
    }
    return { ok: false, status: 'error', message: 'no test available for this key' };
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
    return { ok: false, status: 'error', message: aborted ? 'Test timed out' : (e.message || 'Test failed') };
  }
}

// Run a single key's live test and persist the verdict (status + timestamp) so
// it survives a reload and surfaces as a health dot in the admin UI.
async function testKey(keyName, actorId) {
  const result = await _runTest(keyName);
  // Persist every verdict (ok/invalid/error/unconfigured) so the health dot
  // always reflects the latest reality after a reload.
  const rec = await _recordTest(keyName, result, actorId);
  return { ...result, lastTest: rec };
}

// Run every testable key's check (sequentially to stay gentle on vendors) and
// persist each verdict. Returns the per-key results keyed by key_name.
async function testAll(actorId) {
  const results = {};
  for (const entry of REGISTRY) {
    if (!entry.test) continue;
    const result = await _runTest(entry.key);
    await _recordTest(entry.key, result, actorId);
    results[entry.key] = { ...result, lastTest: _lastTestCache.get(entry.key) || null };
  }
  return results;
}

function isKnownKey(keyName) { return _byKey.has(keyName); }

module.exports = {
  REGISTRY,
  PLATFORM_KEY_BLOCKLIST,
  isPlatformKeyName,
  isKnownKey,
  ensurePlatformKeysSchema,
  hydrate,
  resolvePlatformKey,
  setPlatformKey,
  statusAll,
  testKey,
  testAll,
};
