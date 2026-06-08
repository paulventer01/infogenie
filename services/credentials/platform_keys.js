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
  { key: 'GEMINI_API_KEY', group: 'AI Models', service: 'Google Gemini', label: 'Gemini API Key', desc: 'Google Gemini — multimodal generation & analysis', secret: true, settingsIds: ['gemini'] },
  { key: 'PERPLEXITY_API_KEY', group: 'AI Models', service: 'Perplexity', label: 'Perplexity API Key', desc: 'Perplexity — live web-grounded research', secret: true, settingsIds: ['perplexity'] },
  { key: 'CLOUDFLARE_ACCOUNT_ID', group: 'AI Models', service: 'Cloudflare Workers AI', label: 'Cloudflare Account ID', desc: 'Workers AI (Llama 3.1) — account identifier', secret: false, settingsIds: ['cloudflare'] },
  { key: 'CLOUDFLARE_AI_TOKEN', group: 'AI Models', service: 'Cloudflare Workers AI', label: 'Cloudflare AI Token', desc: 'Workers AI (Llama 3.1) — API token', secret: true, settingsIds: ['cloudflare'] },

  // ── Data & Intelligence ─────────────────────────────────────────────────────
  { key: 'DATAFORSEO_LOGIN', group: 'Data & Intelligence', service: 'DataForSEO', label: 'DataForSEO Login', desc: 'SEO/SERP/keyword data — account login', secret: false, test: 'dataforseo', settingsIds: ['dataforseo', 'dataseo'] },
  { key: 'DATAFORSEO_PASSWORD', group: 'Data & Intelligence', service: 'DataForSEO', label: 'DataForSEO Password', desc: 'SEO/SERP/keyword data — account password', secret: true, settingsIds: ['dataforseo', 'dataseo'] },
  { key: 'FIRECRAWL_API_KEY', group: 'Data & Intelligence', service: 'Firecrawl', label: 'Firecrawl API Key', desc: 'Website crawling & scraping', secret: true, settingsIds: ['firecrawl'] },
  { key: 'APOLLO_API_KEY', group: 'Data & Intelligence', service: 'Apollo', label: 'Apollo API Key', desc: 'B2B contact & company enrichment', secret: true, settingsIds: ['apollo'] },
  { key: 'ZERNIO_API_KEY', group: 'Data & Intelligence', service: 'Zernio', label: 'Zernio API Key', desc: 'Social publishing', secret: true, settingsIds: ['zernio'] },
  { key: 'BUILTWITH_API_KEY', group: 'Data & Intelligence', service: 'BuiltWith', label: 'BuiltWith API Key', desc: 'Tech-stack detection', secret: true, settingsIds: ['builtwith'] },
  { key: 'GOOGLE_PAGESPEED_API_KEY', group: 'Data & Intelligence', service: 'Google PageSpeed', label: 'PageSpeed API Key', desc: 'Core Web Vitals & page performance audits', secret: true, settingsIds: ['pagespeed', 'google_pagespeed'] },
  { key: 'GOOGLE_SEARCH_API_KEY', group: 'Data & Intelligence', service: 'Google Search', label: 'Google Search API Key', desc: 'Custom Search / SERP visibility', secret: true, settingsIds: ['google_search'] },

  // ── Infrastructure ──────────────────────────────────────────────────────────
  { key: 'RESEND_API_KEY', group: 'Infrastructure', service: 'Resend', label: 'Resend API Key', desc: 'Transactional & broadcast email', secret: true, test: 'resend', settingsIds: ['resend'] },
  { key: 'RESEND_WEBHOOK_SECRET', group: 'Infrastructure', service: 'Resend', label: 'Resend Webhook Secret', desc: 'Verifies inbound Resend webhooks', secret: true, settingsIds: ['resend'] },
  { key: 'RESEND_FROM_EMAIL', group: 'Infrastructure', service: 'Resend', label: 'Resend From Email', desc: 'Verified sender address (must be a verified Resend domain)', secret: false, settingsIds: ['resend'] },
  { key: 'AMPLITUDE_API_KEY', group: 'Infrastructure', service: 'Amplitude', label: 'Amplitude API Key', desc: 'Product analytics ingestion', secret: true, settingsIds: ['amplitude'] },
  { key: 'STRIPE_SECRET_KEY', group: 'Infrastructure', service: 'Stripe', label: 'Stripe Secret Key', desc: 'Billing & checkout', secret: true, settingsIds: ['stripe'] },
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
  console.log(`[platform-keys] hydrated ${n} key(s) from DB`);
  return n;
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
      testable: !!entry.test,
    });
  }
  return Object.entries(groups).map(([group, items]) => ({ group, items }));
}

// ── Live connectivity tests (best-effort) ──────────────────────────────────────
async function testKey(keyName) {
  const entry = _byKey.get(keyName);
  if (!entry) return { ok: false, status: 'error', message: 'unknown key' };
  if (!entry.test) return { ok: false, status: 'error', message: 'no test available for this key' };
  try {
    if (entry.test === 'openai') {
      const key = resolvePlatformKey('AI_INTEGRATIONS_OPENAI_API_KEY') || resolvePlatformKey('OPENAI_API_KEY');
      if (!key) return { ok: false, status: 'unconfigured', message: 'No key configured' };
      const base = (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
      return r.ok ? { ok: true, status: 'ok', message: 'OpenAI reachable' }
                  : { ok: false, status: 'error', message: 'OpenAI returned HTTP ' + r.status };
    }
    if (entry.test === 'anthropic') {
      const key = resolvePlatformKey('AI_INTEGRATIONS_ANTHROPIC_API_KEY') || resolvePlatformKey('ANTHROPIC_API_KEY');
      if (!key) return { ok: false, status: 'unconfigured', message: 'No key configured' };
      const base = (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
      const r = await fetch(base + '/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
      return r.ok ? { ok: true, status: 'ok', message: 'Anthropic reachable' }
                  : { ok: false, status: 'error', message: 'Anthropic returned HTTP ' + r.status };
    }
    if (entry.test === 'dataforseo') {
      const login = resolvePlatformKey('DATAFORSEO_LOGIN');
      const pass = resolvePlatformKey('DATAFORSEO_PASSWORD');
      if (!login || !pass) return { ok: false, status: 'unconfigured', message: 'Login + password required' };
      const auth = Buffer.from(login + ':' + pass).toString('base64');
      const r = await fetch('https://api.dataforseo.com/v3/appendix/user_data', { headers: { Authorization: 'Basic ' + auth } });
      return r.ok ? { ok: true, status: 'ok', message: 'DataForSEO authenticated' }
                  : { ok: false, status: 'error', message: 'DataForSEO returned HTTP ' + r.status };
    }
    if (entry.test === 'resend') {
      const key = resolvePlatformKey('RESEND_API_KEY');
      if (!key) return { ok: false, status: 'unconfigured', message: 'No key configured' };
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: 'Bearer ' + key } });
      return r.ok ? { ok: true, status: 'ok', message: 'Resend authenticated' }
                  : { ok: false, status: 'error', message: 'Resend returned HTTP ' + r.status };
    }
    return { ok: false, status: 'error', message: 'no test available for this key' };
  } catch (e) {
    return { ok: false, status: 'error', message: e.message };
  }
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
};
