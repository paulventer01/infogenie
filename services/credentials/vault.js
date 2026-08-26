// services/credentials/vault.js — Per-User Credential Vault
//
// Encrypted, per-(user, platform) credential store. The canonical home for
// every third-party API token / OAuth refresh token that used to live in
// shared environment variables. Google Ads is the first integration migrated;
// other platforms (Meta, TikTok, DataForSEO, ...) follow in future rounds.
//
// Encryption: AES-256-GCM. Key sourced from CREDENTIAL_ENCRYPTION_KEY env var
// (32 raw bytes encoded as base64 or hex). The server refuses to boot in
// production without it.
//
// Storage row shape:
//   user_integrations(user_id, platform, ciphertext, iv, tag, status,
//                     connected_at, updated_at)
//   The decrypted plaintext is a JSON object whose keys are platform-specific
//   (e.g. { devToken, clientId, clientSecret, refreshToken, customerId,
//          loginCustomerId? } for Google Ads).

const crypto = require('crypto');
const _db = require('../../db');

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let _key = null;
let _keyChecked = false;

function _loadKey() {
  if (_keyChecked) return _key;
  _keyChecked = true;
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[credentials] CREDENTIAL_ENCRYPTION_KEY is required in production. ' +
        'Generate one with: openssl rand -base64 32'
      );
    }
    console.warn(
      '[credentials] CREDENTIAL_ENCRYPTION_KEY not set — vault disabled in dev. ' +
      'Generate one with: openssl rand -base64 32'
    );
    _key = null;
    return _key;
  }
  let buf;
  try {
    if (/^[A-Fa-f0-9]+$/.test(raw) && raw.length === 64) buf = Buffer.from(raw, 'hex');
    else buf = Buffer.from(raw, 'base64');
  } catch (e) {
    throw new Error('[credentials] CREDENTIAL_ENCRYPTION_KEY invalid encoding: ' + e.message);
  }
  if (buf.length !== 32) {
    throw new Error(`[credentials] CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). ` +
                    'Generate one with: openssl rand -base64 32');
  }
  _key = buf;
  return _key;
}

function hasKey() { try { return !!_loadKey(); } catch { return false; } }

// True iff the given user has an active (status != 'disconnected') credential
// row for the platform. This is the correct per-user check for status UIs.
// Public callers use the pool and must not pass a client. A publishing-request
// transaction may pass `{ client, tenantId }` to lock the matching
// actor/platform row on that existing connection until COMMIT/ROLLBACK.
// Presence only: never SELECT ciphertext/iv/tag or decrypt.
async function hasCredentials(userId, platform, opts) {
  const uid = _normUserId(userId);
  if (!uid || !_db.hasDb()) return false;
  const client = opts && opts.client && typeof opts.client.query === 'function'
    ? opts.client
    : null;
  const tenantId = opts && opts.tenantId != null ? Number(opts.tenantId) : NaN;
  const scopedTenant = Number.isInteger(tenantId) && tenantId > 0;
  try {
    if (!client) await ensureCredentialsSchema();
    const q = client || _db.getPool();
    let sql;
    let params;
    if (client && scopedTenant) {
      sql = `SELECT 1 FROM user_integrations ui
              JOIN tenant_users tu
                ON tu.user_id = ui.user_id AND tu.tenant_id = $3 AND tu.status = 'active'
             WHERE ui.user_id=$1 AND ui.platform=$2 AND ui.status <> 'disconnected'
             LIMIT 1
             FOR UPDATE OF ui`;
      params = [uid, platform, tenantId];
    } else if (client) {
      sql = `SELECT 1 FROM user_integrations
              WHERE user_id=$1 AND platform=$2 AND status <> 'disconnected'
              LIMIT 1 FOR UPDATE`;
      params = [uid, platform];
    } else {
      sql = `SELECT 1 FROM user_integrations
              WHERE user_id=$1 AND platform=$2 AND status <> 'disconnected'
              LIMIT 1`;
      params = [uid, platform];
    }
    const r = await q.query(sql, params);
    return r.rows.length > 0;
  } catch (err) {
    if (client) throw err;
    return false;
  }
}

function assertBootRequirements() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
      throw new Error(
        '[credentials] Refusing to boot: CREDENTIAL_ENCRYPTION_KEY is required in production. ' +
        'Generate one with: openssl rand -base64 32'
      );
    }
    // Fail-fast on malformed key material (wrong length / bad encoding) so
    // production never starts with a broken vault.
    const k = _loadKey();
    if (!k || k.length !== 32) {
      throw new Error(
        '[credentials] Refusing to boot: CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes. ' +
        'Generate one with: openssl rand -base64 32'
      );
    }
  } else {
    // Dev: surface decode errors early too (but only warn, since key is optional).
    try { _loadKey(); } catch (e) { console.warn('[credentials]', e.message); }
  }
}

// Optional AES-GCM Additional Authenticated Data. A caller that passes an `aad`
// binds the ciphertext to that context (e.g. `meeting_notes_runs:tenant:7`), so
// a row lifted into another tenant — or read without the context — fails the
// GCM auth tag instead of decrypting. Omitting `aad` is byte-for-byte the same
// as before AAD existed, which is what keeps existing platform_api_keys and
// user_integrations rows readable.
function _normAad(aad) {
  if (aad === null || aad === undefined) return null;
  return Buffer.isBuffer(aad) ? aad : Buffer.from(String(aad), 'utf8');
}

function _encrypt(plaintext, aad) {
  const key = _loadKey();
  if (!key) throw new Error('vault encryption key not configured');
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ad = _normAad(aad);
  if (ad) cipher.setAAD(ad);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct, iv, tag };
}

function _decrypt(ciphertext, iv, tag, aad) {
  const key = _loadKey();
  if (!key) throw new Error('vault encryption key not configured');
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const ad = _normAad(aad);
  if (ad) decipher.setAAD(ad);
  const pt = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return pt.toString('utf8');
}

let _schemaReady = null;
async function ensureCredentialsSchema() {
  if (!_db.hasDb()) return;
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const p = _db.getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS user_integrations (
        user_id      INTEGER NOT NULL,
        platform     TEXT    NOT NULL,
        ciphertext   BYTEA   NOT NULL,
        iv           BYTEA   NOT NULL,
        tag          BYTEA   NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'connected'
                       CHECK (status IN ('connected','disconnected','error')),
        connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, platform)
      );
    `);
    // Backfill CHECK constraint on existing deployments (idempotent).
    try {
      await p.query(`
        ALTER TABLE user_integrations
          DROP CONSTRAINT IF EXISTS user_integrations_status_check;
        ALTER TABLE user_integrations
          ADD  CONSTRAINT user_integrations_status_check
          CHECK (status IN ('connected','disconnected','error'));
      `);
    } catch (_e) { /* ignore — table will be created with constraint on fresh installs */ }
    console.log('[credentials] schema ready (user_integrations)');
  })();
  return _schemaReady;
}

function _normUserId(userId) {
  const n = parseInt(userId, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function getCredentials(userId, platform) {
  const uid = _normUserId(userId);
  if (!uid || !_db.hasDb() || !hasKey()) return null;
  await ensureCredentialsSchema();
  const r = await _db.getPool().query(
    'SELECT ciphertext, iv, tag, status FROM user_integrations WHERE user_id=$1 AND platform=$2',
    [uid, platform]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  if (row.status === 'disconnected') return null;
  try {
    const pt = _decrypt(row.ciphertext, row.iv, row.tag);
    return JSON.parse(pt);
  } catch (e) {
    console.error('[credentials] decrypt failed for', { userId: uid, platform, err: e.message });
    return null;
  }
}

async function saveCredentials(userId, platform, blob) {
  const uid = _normUserId(userId);
  if (!uid) throw new Error('saveCredentials: invalid userId');
  if (!_db.hasDb()) throw new Error('saveCredentials: no DATABASE_URL');
  if (!hasKey()) throw new Error('saveCredentials: CREDENTIAL_ENCRYPTION_KEY not set');
  await ensureCredentialsSchema();
  const { ciphertext, iv, tag } = _encrypt(JSON.stringify(blob || {}));
  await _db.getPool().query(`
    INSERT INTO user_integrations (user_id, platform, ciphertext, iv, tag, status, connected_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,'connected', now(), now())
    ON CONFLICT (user_id, platform)
    DO UPDATE SET ciphertext = EXCLUDED.ciphertext,
                  iv         = EXCLUDED.iv,
                  tag        = EXCLUDED.tag,
                  status     = 'connected',
                  updated_at = now()
  `, [uid, platform, ciphertext, iv, tag]);
  return { ok: true };
}

async function deleteCredentials(userId, platform) {
  const uid = _normUserId(userId);
  if (!uid || !_db.hasDb()) return { ok: true };
  await ensureCredentialsSchema();
  await _db.getPool().query(
    'DELETE FROM user_integrations WHERE user_id=$1 AND platform=$2',
    [uid, platform]
  );
  return { ok: true };
}

const _ALLOWED_STATUS = new Set(['connected','disconnected','error']);
async function setStatus(userId, platform, status) {
  const uid = _normUserId(userId);
  if (!uid || !_db.hasDb()) return { ok: false };
  const s = String(status || 'connected');
  if (!_ALLOWED_STATUS.has(s)) throw new Error(`setStatus: invalid status ${s}`);
  await ensureCredentialsSchema();
  await _db.getPool().query(
    'UPDATE user_integrations SET status=$3, updated_at=now() WHERE user_id=$1 AND platform=$2',
    [uid, platform, s]
  );
  return { ok: true };
}

async function getStatus(userId, platform) {
  const uid = _normUserId(userId);
  if (!uid || !_db.hasDb()) return { connected: false, status: 'disconnected', source: null };
  await ensureCredentialsSchema();
  const r = await _db.getPool().query(
    'SELECT status, connected_at, updated_at FROM user_integrations WHERE user_id=$1 AND platform=$2',
    [uid, platform]
  );
  if (!r.rows.length) return { connected: false, status: 'disconnected', source: null };
  const row = r.rows[0];
  return {
    connected: row.status === 'connected',
    status: row.status,
    connected_at: row.connected_at,
    updated_at: row.updated_at,
    source: 'vault',
  };
}

// ── Owner check (deployment owner = first signup, is_owner=TRUE) ─────────────
async function _isOwner(userId) {
  const uid = _normUserId(userId);
  if (!uid || !_db.hasDb()) return false;
  try {
    const r = await _db.getPool().query('SELECT is_owner FROM users WHERE id=$1', [uid]);
    return !!(r.rows[0] && r.rows[0].is_owner);
  } catch { return false; }
}

// ── Google Ads — vault-first, env-fallback (owner only) resolver ─────────────
// Returns { ok, source: 'vault'|'env', creds: { devToken, clientId,
// clientSecret, refreshToken, customerId, loginCustomerId? } } when a usable
// credential set is found; otherwise { ok:false, error }. This is THE single
// place all Google Ads code reads credentials from.
//
// Pass userId=null/0 to mean "cron / system caller — use the deployment owner
// fallback unconditionally" (used by the autonomous optimizer cron jobs that
// have no request context).
function _gaCredsFromEnv() {
  const devToken     = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId   = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '';
  const all = [devToken, clientId, clientSecret, refreshToken, customerId];
  if (!all.every(v => v && !/^_DUMMY/i.test(v))) return null;
  return { devToken, clientId, clientSecret, refreshToken, customerId, loginCustomerId };
}

function _gaCredsLooksValid(c) {
  if (!c || typeof c !== 'object') return false;
  return ['devToken','clientId','clientSecret','refreshToken','customerId']
    .every(k => c[k] && !/^_DUMMY/i.test(String(c[k])));
}

// ── Meta Ads — vault-first, env-fallback (owner only) resolver ─────────────
// Vault blob shape: { accessToken, adAccountId, businessName?, email?, expiresAt? }
function _metaCredsFromEnv() {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!accessToken || !adAccountId) return null;
  if (/^_DUMMY/i.test(accessToken) || /^_DUMMY/i.test(adAccountId)) return null;
  return { accessToken, adAccountId, businessName: null, email: null };
}

function _metaCredsLooksValid(c) {
  if (!c || typeof c !== 'object') return false;
  return ['accessToken','adAccountId']
    .every(k => c[k] && !/^_DUMMY/i.test(String(c[k])));
}

async function resolveMetaAdsCredentials(userId) {
  const uid = _normUserId(userId);
  if (uid) {
    try {
      const blob = await getCredentials(uid, 'meta_ads');
      if (_metaCredsLooksValid(blob)) {
        return { ok: true, source: 'vault', creds: blob };
      }
    } catch (e) { /* fall through to env */ }
  }
  const isCron = !uid;
  const ownerOk = isCron || await _isOwner(uid);
  if (ownerOk) {
    const env = _metaCredsFromEnv();
    if (env) return { ok: true, source: 'env', creds: env };
  }
  return {
    ok: false,
    error: uid
      ? "You haven't connected Meta Ads yet — connect it from Settings → Meta Ads Manager."
      : 'Meta Ads not connected for the deployment owner.',
  };
}

async function resolveGoogleAdsCredentials(userId) {
  const uid = _normUserId(userId);
  // Per-user vault first
  if (uid) {
    try {
      const blob = await getCredentials(uid, 'google_ads');
      if (_gaCredsLooksValid(blob)) {
        return { ok: true, source: 'vault', creds: blob };
      }
    } catch (e) { /* fall through to env */ }
  }
  // Owner / system fallback to env vars
  const isCron = !uid;
  const ownerOk = isCron || await _isOwner(uid);
  if (ownerOk) {
    const env = _gaCredsFromEnv();
    if (env) return { ok: true, source: 'env', creds: env };
  }
  return {
    ok: false,
    error: uid
      ? "You haven't connected Google Ads yet — connect it from Settings → Google Ads."
      : 'Google Ads not connected for the deployment owner.',
  };
}

// ── Meta provider-draft credential REFERENCE boundary (PR 6F-0) ────────────
//
// This is the tenant-owned Meta credential-reference validation boundary. It is
// deliberately reference-only:
//
//   • it reads `orchestrator_tenant_meta_credential_refs`, a metadata table with
//     no ciphertext, iv, tag, token or account-id column at all;
//   • it never touches `user_integrations`, `platform_api_keys` or `kv_store`;
//   • it never calls _decrypt / getCredentials / resolveMetaAdsCredentials, and
//     therefore cannot produce, log or transmit secret material;
//   • the object it hands back carries no secret and refuses serialization, so a
//     reference cannot leak into an HTTP body, an outbox payload or an audit row.
//
// Nothing here weakens the default-deny gate in
// services/security/advertising_provider_mutations.js. PR 6F-0 grants a
// credential *reference* boundary and no provider access whatsoever.
const _capabilities = require('../security/advertising_provider_capabilities');

const META_PROVIDER_DRAFT_PLATFORM = 'meta';
const META_PROVIDER_DRAFT_TABLE = 'orchestrator_tenant_meta_credential_refs';
// Test/sandbox only. A production ad account is out of scope for PR 6F-0 and
// must not be reachable through this boundary.
const META_PROVIDER_DRAFT_ENVIRONMENTS = Object.freeze(['test', 'sandbox']);
const META_PROVIDER_DRAFT_REFERENCE_KIND = 'meta_provider_draft_credential_reference';
// Columns this boundary is allowed to read. Any secret-bearing column name
// appearing here would be a review failure.
const META_PROVIDER_DRAFT_REF_COLUMNS = Object.freeze([
  'id', 'tenant_id', 'platform', 'environment', 'status',
  'account_fingerprint', 'page_id', 'version', 'owner_user_id', 'revoked_at',
]);

const _REFERENCE_BRAND = Symbol.for('infogenie.meta_provider_draft_credential_reference');

function _credError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.blocked = true;
  err.published = false;
  err.external_action_taken = false;
  return err;
}

function _requireTxClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw _credError('validation_failed', 'a transaction client is required for the credential-reference boundary');
  }
  return client;
}

function _positiveInt(value) {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function _sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function _refuseSerialize() {
  throw _credError('validation_failed', 'a Meta credential reference is not serializable');
}

// Frozen, non-serializable reference. Carries no secret and no account id: the
// account fingerprint stays inside the boundary and is only ever compared.
function _buildReference(row) {
  const ref = Object.create(null);
  const define = (key, value) => Object.defineProperty(ref, key, {
    value, enumerable: true, writable: false, configurable: false,
  });
  define('object_kind', META_PROVIDER_DRAFT_REFERENCE_KIND);
  define('credential_ref_id', String(row.id));
  define('tenant_id', Number(row.tenant_id));
  define('platform', META_PROVIDER_DRAFT_PLATFORM);
  define('environment', String(row.environment));
  define('version', Number(row.version));
  define('has_secret_access', false);
  const hidden = (key, value) => Object.defineProperty(ref, key, {
    value, enumerable: false, writable: false, configurable: false,
  });
  hidden(_REFERENCE_BRAND, true);
  hidden('toJSON', _refuseSerialize);
  hidden(Symbol.for('nodejs.util.inspect.custom'), () => '[MetaProviderDraftCredentialReference redacted]');
  return Object.freeze(ref);
}

function isMetaProviderDraftCredentialReference(value) {
  if (!value || typeof value !== 'object') return false;
  try { return value[_REFERENCE_BRAND] === true; } catch (_e) { return false; }
}

async function _assertActiveTenantMember(client, tenantId, userId) {
  const r = await client.query(
    `SELECT 1 FROM tenant_users WHERE tenant_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [tenantId, userId]
  );
  if (!r.rowCount) throw _credError('permission_denied', 'credential owner is not an active member of this tenant');
}

async function _lockCredentialRefRow(client, { tenantId, credentialRefId, ownerUserId }) {
  const cols = META_PROVIDER_DRAFT_REF_COLUMNS.join(', ');
  const params = [tenantId, META_PROVIDER_DRAFT_PLATFORM, ownerUserId];
  let where = `tenant_id=$1 AND platform=$2 AND owner_user_id=$3
                 AND status='active' AND revoked_at IS NULL
                 AND environment = ANY($4::text[])`;
  params.push(META_PROVIDER_DRAFT_ENVIRONMENTS.slice());
  if (credentialRefId != null) {
    params.push(String(credentialRefId));
    where += ` AND id=$${params.length}`;
  }
  const r = await client.query(
    `SELECT ${cols} FROM ${META_PROVIDER_DRAFT_TABLE} WHERE ${where} FOR UPDATE`,
    params
  );
  if (!r.rowCount) throw _credError('missing_credentials', 'no active tenant-owned Meta credential reference');
  // Ambiguity is a denial, never a "pick the first row".
  if (r.rowCount !== 1) throw _credError('validation_failed', 'tenant-owned Meta credential reference is ambiguous');
  const row = r.rows[0];
  if (row.status !== 'active' || row.revoked_at != null) {
    throw _credError('missing_credentials', 'tenant-owned Meta credential reference is revoked');
  }
  if (row.platform !== META_PROVIDER_DRAFT_PLATFORM) {
    throw _credError('validation_failed', 'credential reference platform mismatch');
  }
  if (!META_PROVIDER_DRAFT_ENVIRONMENTS.includes(String(row.environment))) {
    throw _credError('validation_failed', 'credential reference environment is not test or sandbox');
  }
  if (_positiveInt(row.version) === null) {
    throw _credError('validation_failed', 'credential reference version is invalid');
  }
  if (typeof row.account_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(row.account_fingerprint)) {
    throw _credError('validation_failed', 'credential reference account fingerprint is invalid');
  }
  _pageIdOf(row);
  return row;
}

/**
 * Confirmation-time reference resolution: no capability exists yet, so this
 * establishes only WHICH tenant-owned reference a confirmation is bound to.
 * Returns the frozen, non-serializable reference plus the fingerprint/version
 * the later execution capability must be minted against.
 *
 * Grants no provider access and reads no secret.
 */
async function resolveTenantMetaCredentialRefForProviderDraft(client, opts) {
  const c = _requireTxClient(client);
  const o = opts || {};
  const tenantId = _positiveInt(o.tenantId);
  const ownerUserId = _positiveInt(o.ownerUserId);
  if (!tenantId || !ownerUserId) {
    throw _credError('validation_failed', 'tenantId and ownerUserId are required');
  }
  await _assertActiveTenantMember(c, tenantId, ownerUserId);
  const row = await _lockCredentialRefRow(c, {
    tenantId, ownerUserId, credentialRefId: o.credentialRefId != null ? o.credentialRefId : null,
  });
  return Object.freeze({
    reference: _buildReference(row),
    credential_ref_id: String(row.id),
    credential_ref_version: Number(row.version),
    account_fingerprint: String(row.account_fingerprint),
    environment: String(row.environment),
  });
}

/**
 * Execution-time reference boundary. Requires a minted, unexpired, unspent
 * capability whose binding matches the locked execution context exactly, then
 * re-validates the tenant-owned reference row under FOR UPDATE and matches the
 * capability's credential binding (id, version, account fingerprint, owner)
 * before invoking `fn(reference)`.
 *
 * The capability's single use is NOT spent here — spending belongs to the
 * execution assertion immediately before the provider call, which PR 6F-0 does
 * not have. No secret is read, decrypted, returned or logged.
 */
async function withTenantMetaCredentialForProviderDraft(client, opts, fn) {
  const c = _requireTxClient(client);
  const o = opts || {};
  if (typeof fn !== 'function') {
    throw _credError('validation_failed', 'a credential-reference scope callback is required');
  }
  const capability = o.capability;
  if (!_capabilities.isAdvertisingProviderCapability(capability)) {
    throw _credError(_capabilities.CODES.INVALID, 'a minted provider-draft capability is required');
  }
  // Exact binding check first — before any credential-reference read.
  await _capabilities.verifyMetaCreateProviderDraftCapability(
    capability,
    o.lockedContext,
    { now: o.now }
  );

  if (capability.platform !== META_PROVIDER_DRAFT_PLATFORM
      || capability.operation !== _capabilities.CAPABILITY_OPERATION) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'capability is not a Meta create_provider_draft capability');
  }

  const tenantId = _positiveInt(capability.tenant_id);
  const ownerUserId = _positiveInt(capability.requested_by);
  if (!tenantId || !ownerUserId) {
    throw _credError('validation_failed', 'capability tenant/owner binding is invalid');
  }
  await _assertActiveTenantMember(c, tenantId, ownerUserId);
  const row = await _lockCredentialRefRow(c, {
    tenantId, ownerUserId, credentialRefId: capability.credential_ref_id,
  });

  if (!_sameString(String(row.id), String(capability.credential_ref_id))) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'credential reference id does not match the capability');
  }
  if (Number(row.version) !== Number(capability.credential_ref_version)) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'credential reference version does not match the capability');
  }
  if (!_sameString(String(row.account_fingerprint), String(capability.account_fingerprint))) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'credential reference account does not match the capability');
  }
  if (Number(row.owner_user_id) !== ownerUserId) {
    throw _credError('permission_denied', 'credential reference owner does not match the capability actor');
  }

  return fn(_buildReference(row));
}

// ── End PR 6F-0 reference boundary ───────────────────────────────────────────

function _accountFingerprintOf(adAccountId) {
  const normalized = String(adAccountId || '').replace(/^act_/, '').trim();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function _pageIdOf(row) {
  const raw = row && row.page_id != null ? String(row.page_id).trim() : '';
  if (!/^[0-9]{1,32}$/.test(raw)) {
    throw _credError('validation_failed', 'tenant-owned Meta credential reference is missing a bound page id');
  }
  return raw;
}

async function _buildProviderDraftExecutionSecretHandle(client, capability) {
  if (!_capabilities.isAdvertisingProviderCapability(capability)) {
    throw _credError(_capabilities.CODES.INVALID, 'a minted provider-draft capability is required');
  }
  if (!_capabilities.isConsumedProviderDraftCapability(capability)) {
    throw _credError(_capabilities.CODES.SPENT, 'provider-draft capability must be consumed before secret access');
  }
  if (capability.platform !== META_PROVIDER_DRAFT_PLATFORM
      || capability.operation !== _capabilities.CAPABILITY_OPERATION) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'capability is not a Meta create_provider_draft capability');
  }

  const tenantId = _positiveInt(capability.tenant_id);
  const ownerUserId = _positiveInt(capability.requested_by);
  if (!tenantId || !ownerUserId) {
    throw _credError('validation_failed', 'capability tenant/owner binding is invalid');
  }
  await _assertActiveTenantMember(client, tenantId, ownerUserId);
  const row = await _lockCredentialRefRow(client, {
    tenantId, ownerUserId, credentialRefId: capability.credential_ref_id,
  });
  if (!_sameString(String(row.id), String(capability.credential_ref_id))) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'credential reference id does not match the capability');
  }
  if (Number(row.version) !== Number(capability.credential_ref_version)) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'credential reference version does not match the capability');
  }
  if (!_sameString(String(row.account_fingerprint), String(capability.account_fingerprint))) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'credential reference account does not match the capability');
  }
  if (!META_PROVIDER_DRAFT_ENVIRONMENTS.includes(String(row.environment))) {
    throw _credError('validation_failed', 'credential reference environment is out of scope');
  }

  let blob;
  try {
    blob = await getCredentials(ownerUserId, 'meta_ads');
  } catch (_e) {
    throw _credError('missing_credentials', 'Meta Ads credentials are not connected for this actor');
  }
  if (!_metaCredsLooksValid(blob)) {
    throw _credError('missing_credentials', 'Meta Ads credentials are not connected for this actor');
  }
  const fingerprint = _accountFingerprintOf(blob.adAccountId);
  if (!fingerprint || !_sameString(fingerprint, String(capability.account_fingerprint))) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'Meta ad account does not match the capability binding');
  }
  const pageId = _pageIdOf(row);
  if (blob.pageId != null && !_sameString(String(blob.pageId), pageId)) {
    throw _credError(_capabilities.CODES.CONTEXT_MISMATCH, 'Meta page id does not match the credential reference binding');
  }

  const handle = Object.create(null);
  Object.defineProperty(handle, 'accessToken', {
    enumerable: true, configurable: false, writable: false,
    value: String(blob.accessToken),
  });
  Object.defineProperty(handle, 'adAccountId', {
    enumerable: true, configurable: false, writable: false,
    value: String(blob.adAccountId),
  });
  Object.defineProperty(handle, 'pageId', {
    enumerable: true, configurable: false, writable: false,
    value: pageId,
  });
  Object.defineProperty(handle, 'environment', {
    enumerable: true, configurable: false, writable: false,
    value: String(row.environment),
  });
  Object.defineProperty(handle, 'has_secret_access', {
    enumerable: true, configurable: false, writable: false,
    value: true,
  });
  Object.defineProperty(handle, Symbol.for('nodejs.util.inspect.custom'), {
    configurable: false,
    value: () => '[MetaProviderDraftExecutionSecret redacted]',
  });
  Object.defineProperty(handle, 'toJSON', {
    configurable: false,
    value: () => { throw _credError('validation_failed', 'credential handle is not serializable'); },
  });
  return Object.freeze(handle);
}

/**
 * PR 6F-1 execution-time secret boundary. Requires a minted capability whose
 * single use has already been consumed by assertMetaCreateProviderDraftCapability.
 * Decrypts the tenant-owned Meta Ads integration only inside `fn`, verifies the
 * account fingerprint binding, and never logs, persists or returns the secret.
 */
async function withTenantMetaCredentialSecretForProviderDraftExecution(client, opts, fn) {
  const c = _requireTxClient(client);
  const o = opts || {};
  if (typeof fn !== 'function') {
    throw _credError('validation_failed', 'a credential execution scope callback is required');
  }
  const handle = await _buildProviderDraftExecutionSecretHandle(c, o.capability);
  return fn(handle);
}

/**
 * Same secret boundary as above, but opens a short transaction to lock the
 * credential reference, commits before `fn`, and never holds FOR UPDATE across
 * provider I/O.
 */
async function withTenantMetaCredentialSecretForConsumedProviderDraft(pool, opts, fn) {
  if (!pool || typeof pool.connect !== 'function') {
    throw _credError('validation_failed', 'a database pool is required for provider-draft secret access');
  }
  if (typeof fn !== 'function') {
    throw _credError('validation_failed', 'a credential execution scope callback is required');
  }
  const client = await pool.connect();
  let handle;
  try {
    await client.query('BEGIN');
    handle = await _buildProviderDraftExecutionSecretHandle(client, (opts || {}).capability);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
  return fn(handle);
}

// ── Simple API-key vault (tenant-scoped, kv_store, AES-256-GCM) ──────────
// Unlike getCredentials/saveCredentials (per-user, user_integrations table),
// these are platform-wide per-tenant keys (e.g. Apify, Firecrawl).
// kv_store key shape: `apikey:<platform>:t<tid>`
async function setApiKey(tid, platform, keyStr) {
  if (!_db.hasDb()) throw new Error('setApiKey: no DATABASE_URL');
  let stored;
  if (hasKey()) {
    const { ciphertext, iv, tag } = _encrypt(keyStr);
    stored = {
      ct:  ciphertext.toString('base64'),
      iv:  iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  } else {
    // Dev mode — no CREDENTIAL_ENCRYPTION_KEY, store plain (never in production)
    stored = { plain: keyStr };
  }
  await _db.kvSet(`apikey:${platform}:t${tid}`, stored);
  return { ok: true };
}

async function getApiKey(tid, platform) {
  if (!_db.hasDb()) return null;
  const stored = await _db.kvGet(`apikey:${platform}:t${tid}`, null);
  if (!stored) return null;
  if (stored.plain !== undefined) return stored.plain;
  try {
    const pt = _decrypt(
      Buffer.from(stored.ct,  'base64'),
      Buffer.from(stored.iv,  'base64'),
      Buffer.from(stored.tag, 'base64')
    );
    return pt;
  } catch (e) {
    console.error('[credentials] getApiKey decrypt failed', { platform, err: e.message });
    return null;
  }
}

module.exports = {
  // Generic vault API
  ensureCredentialsSchema,
  assertBootRequirements,
  hasKey,
  // Low-level AES-256-GCM helpers (used by platform_keys.js for its own table).
  // _encrypt(plaintext, aad?) -> { ciphertext:Buffer, iv:Buffer, tag:Buffer }
  // _decrypt(ciphertext, iv, tag, aad?) -> plaintext string
  // `aad` is optional Additional Authenticated Data (string or Buffer). It must
  // match on decrypt; omit it on both sides for legacy/unbound payloads.
  encryptString: _encrypt,
  decryptString: _decrypt,
  hasCredentials,
  getCredentials,
  saveCredentials,
  deleteCredentials,
  getStatus,
  setStatus,
  // Simple tenant-scoped API-key store
  setApiKey,
  getApiKey,
  // Platform-specific resolvers
  resolveGoogleAdsCredentials,
  resolveMetaAdsCredentials,
  // PR 6F-0 — tenant-owned Meta credential REFERENCE boundary (no secret access)
  META_PROVIDER_DRAFT_PLATFORM,
  META_PROVIDER_DRAFT_TABLE,
  META_PROVIDER_DRAFT_ENVIRONMENTS,
  META_PROVIDER_DRAFT_REFERENCE_KIND,
  META_PROVIDER_DRAFT_REF_COLUMNS,
  isMetaProviderDraftCredentialReference,
  resolveTenantMetaCredentialRefForProviderDraft,
  withTenantMetaCredentialForProviderDraft,
  withTenantMetaCredentialSecretForProviderDraftExecution,
  withTenantMetaCredentialSecretForConsumedProviderDraft,
  accountFingerprintOfMetaAdAccount: _accountFingerprintOf,
};
