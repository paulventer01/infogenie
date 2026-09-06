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
const https = require('https');
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
        credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
        PRIMARY KEY (user_id, platform)
      );
    `);
    await p.query(`ALTER TABLE user_integrations
      ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1`);
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

// Read a credential only when the mutable vault row is still the exact version
// frozen into a provider authorization. Rotation increments the vault version,
// so an old authorization fails closed rather than silently receiving a newer
// token for the same user/account.
async function getCredentialsAtVersion(userId, platform, expectedVersion) {
  const uid = _normUserId(userId);
  const version = _positiveInt(expectedVersion);
  if (!uid || !version || !_db.hasDb() || !hasKey()) return null;
  await ensureCredentialsSchema();
  const r = await _db.getPool().query(
    `SELECT ciphertext, iv, tag, status FROM user_integrations
      WHERE user_id=$1 AND platform=$2 AND credential_version=$3`,
    [uid, platform, version]
  );
  if (r.rowCount !== 1 || r.rows[0].status === 'disconnected') return null;
  try {
    return JSON.parse(_decrypt(r.rows[0].ciphertext, r.rows[0].iv, r.rows[0].tag));
  } catch (_e) {
    return null;
  }
}

// Google Ads persistence is authorized against the tenant PINNED at the start
// of the OAuth flow — never the session's current tenant and never the global
// permission matrix. The tenant, the membership and the applicable role (either
// a tenant-local role or a system role) are locked here, inside the same
// transaction that writes user_integrations and the credential reference, so a
// revocation racing the write either commits first (and this fails closed) or
// waits behind COMMIT/ROLLBACK.
const GOOGLE_ADS_INTEGRATIONS_PERMISSION = 'tenant.integrations.manage';

async function _lockGoogleAdsTenantAuthority(client, tenantId, userId) {
  const authorized = await client.query(`SELECT 1
      FROM tenants t
      JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$2 AND tu.status='active'
      JOIN roles r ON r.id=tu.role_id AND (r.tenant_id=t.id OR r.tenant_id IS NULL)
     WHERE t.id=$1 AND t.status='active' AND r.permissions ? $3
     FOR UPDATE OF t, tu, r`,
  [tenantId, userId, GOOGLE_ADS_INTEGRATIONS_PERMISSION]);
  // Exactly one authorized row, or nothing is written. Ambiguity is a denial.
  if (authorized.rowCount !== 1) {
    throw new Error('saveCredentials: active tenant membership with tenant.integrations.manage required');
  }
}

async function saveCredentials(userId, platform, blob, opts = {}) {
  const uid = _normUserId(userId);
  if (!uid) throw new Error('saveCredentials: invalid userId');
  if (!_db.hasDb()) throw new Error('saveCredentials: no DATABASE_URL');
  if (!hasKey()) throw new Error('saveCredentials: CREDENTIAL_ENCRYPTION_KEY not set');
  await ensureCredentialsSchema();
  const { ciphertext, iv, tag } = _encrypt(JSON.stringify(blob || {}));
  const tenantId = _positiveInt(opts.tenantId);
  const customerId = platform === 'google_ads' ? String(blob?.customerId || '').replace(/[^0-9]/g, '') : '';
  if (platform === 'google_ads' && (!tenantId || !customerId)) throw new Error('saveCredentials: Google Ads tenant and customer required');
  const client = await _db.getPool().connect();
  try {
    await client.query('BEGIN');
    let referenceId = null;
    if (platform === 'google_ads') {
      await _lockGoogleAdsTenantAuthority(client, tenantId, uid);
    }
    const saved = await client.query(`
      INSERT INTO user_integrations (user_id, platform, ciphertext, iv, tag, status, connected_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,'connected', clock_timestamp(), clock_timestamp())
      ON CONFLICT (user_id, platform)
      DO UPDATE SET ciphertext = EXCLUDED.ciphertext,
                    iv         = EXCLUDED.iv,
                    tag        = EXCLUDED.tag,
                    status     = 'connected',
                    credential_version = user_integrations.credential_version + 1,
                    updated_at = clock_timestamp()
      RETURNING credential_version`, [uid, platform, ciphertext, iv, tag]);
    const version = Number(saved.rows[0].credential_version);
    if (platform === 'google_ads') {
      const fingerprint = _accountFingerprintOfGoogleAdsCustomerId(customerId);
      await client.query(`UPDATE orchestrator_tenant_google_ads_credential_refs
        SET status='revoked',revoked_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE owner_user_id=$1 AND status='active'`, [uid]);
      referenceId = `google_ads_${uid}_${version}`;
      await client.query(`INSERT INTO orchestrator_tenant_google_ads_credential_refs
        (tenant_id,id,platform,status,account_fingerprint,version,owner_user_id)
        VALUES($1,$2,'google_ads','active',$3,$4,$5)`,
      [tenantId, referenceId, fingerprint, version, uid]);
    }
    await client.query('COMMIT');
    return { ok: true, version, ...(referenceId ? { referenceId } : {}) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function getGoogleAdsCredentialReference(userId, tenantId) {
  const uid = _normUserId(userId);
  const tid = _positiveInt(tenantId);
  if (!uid || !tid || !_db.hasDb() || !hasKey()) return null;
  await ensureCredentialsSchema();
  const client = await _db.getPool().connect();
  try {
    await client.query('BEGIN');
    const memberships = await client.query(`SELECT tu.tenant_id FROM tenant_users tu
      JOIN tenants t ON t.id=tu.tenant_id AND t.status='active'
      WHERE tu.user_id=$1 AND tu.status='active' ORDER BY tu.tenant_id FOR UPDATE OF tu,t`, [uid]);
    if (!memberships.rows.some((row) => Number(row.tenant_id) === tid)) { await client.query('ROLLBACK'); return null; }
    const integration = await client.query(`SELECT ciphertext,iv,tag,status,credential_version
      FROM user_integrations WHERE user_id=$1 AND platform='google_ads' FOR UPDATE`, [uid]);
    if (integration.rowCount !== 1 || integration.rows[0].status !== 'connected') {
      await client.query('ROLLBACK'); return null;
    }
    const version = Number(integration.rows[0].credential_version);
    let customerId;
    try {
      const blob = JSON.parse(_decrypt(integration.rows[0].ciphertext, integration.rows[0].iv, integration.rows[0].tag));
      customerId = String(blob?.customerId || '').replace(/[^0-9]/g, '');
    } catch (_error) { await client.query('ROLLBACK'); return null; }
    if (!customerId || !Number.isSafeInteger(version) || version < 1) { await client.query('ROLLBACK'); return null; }
    const fingerprint = _accountFingerprintOfGoogleAdsCustomerId(customerId);
    const refs = await client.query(`SELECT tenant_id,id,version,status,revoked_at,account_fingerprint
      FROM orchestrator_tenant_google_ads_credential_refs WHERE owner_user_id=$1 FOR UPDATE`, [uid]);
    const exact = refs.rows.find((row) => Number(row.tenant_id) === tid && Number(row.version) === version
      && row.status === 'active' && !row.revoked_at && row.account_fingerprint === fingerprint);
    if (exact) { await client.query('COMMIT'); return Object.freeze({ referenceId: exact.id, version }); }
    // A legacy per-user credential may be claimed only once. Never redirect an
    // established tenant reference merely because the session tenant changed.
    if ((refs.rows.length === 0 && memberships.rowCount !== 1)
      || refs.rows.some((row) => row.status === 'active' && !row.revoked_at && Number(row.tenant_id) !== tid)
      || refs.rows.some((row) => Number(row.tenant_id) === tid && Number(row.version) >= version)) {
      await client.query('ROLLBACK'); return null;
    }
    await client.query(`UPDATE orchestrator_tenant_google_ads_credential_refs
      SET status='revoked',revoked_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND owner_user_id=$2 AND status='active' AND version<$3`, [tid, uid, version]);
    const referenceId = `google_ads_${uid}_${version}`;
    await client.query(`INSERT INTO orchestrator_tenant_google_ads_credential_refs
      (tenant_id,id,platform,status,account_fingerprint,version,owner_user_id)
      VALUES($1,$2,'google_ads','active',$3,$4,$5)`, [tid, referenceId, fingerprint, version, uid]);
    await client.query('COMMIT');
    return Object.freeze({ referenceId, version });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return null;
    throw error;
  } finally { client.release(); }
}

async function deleteCredentials(userId, platform, opts = {}) {
  const uid = _normUserId(userId);
  if (!uid || !_db.hasDb()) return { ok: true };
  await ensureCredentialsSchema();
  const tenantId = _positiveInt(opts.tenantId);
  if (platform === 'google_ads' && !tenantId) throw new Error('deleteCredentials: Google Ads tenant required');
  const erased = _encrypt('{}');
  const client = await _db.getPool().connect();
  try {
    await client.query('BEGIN');
    if (platform === 'google_ads') {
      const membership = await client.query(`SELECT 1 FROM tenant_users
        WHERE tenant_id=$1 AND user_id=$2 AND status='active' FOR UPDATE`, [tenantId, uid]);
      if (membership.rowCount !== 1) throw new Error('deleteCredentials: active tenant membership required');
      await client.query(`UPDATE orchestrator_tenant_google_ads_credential_refs
        SET status='revoked',revoked_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE owner_user_id=$1 AND status='active'`, [uid]);
    }
    await client.query(`UPDATE user_integrations
      SET ciphertext=$3,iv=$4,tag=$5,status='disconnected',credential_version=credential_version+1,updated_at=clock_timestamp()
      WHERE user_id=$1 AND platform=$2`, [uid, platform, erased.ciphertext, erased.iv, erased.tag]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
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

// Metadata-only Google Ads account binding for guarded authority records.
// The normalized customer id is used only as hash input and is never returned,
// persisted, logged, or used to resolve credential secret material.
function _accountFingerprintOfGoogleAdsCustomerId(customerId) {
  const normalized = String(customerId || '').replace(/[\s-]/g, '');
  if (!/^[0-9]{10}$/.test(normalized)) return null;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * PR10B.1 metadata-only Google Ads binding check. Locks the tenant-owned
 * credential REFERENCE row and asserts it still matches the capability binding
 * (tenant, owner, id, version, account fingerprint). Reads no user_integrations
 * row, decrypts nothing, and returns no customer id — secret resolution for the
 * paused-draft provider call is deferred to PR10B.2.
 */
async function assertGoogleAdsProviderDraftCredentialRefMetadata(client, opts) {
  const c = _requireTxClient(client);
  const o = opts || {};
  const tenantId = _positiveInt(o.tenantId);
  const ownerUserId = _positiveInt(o.ownerUserId);
  const version = _positiveInt(o.credentialRefVersion);
  const refId = o.credentialRefId != null ? String(o.credentialRefId) : '';
  const fingerprint = o.accountFingerprint != null ? String(o.accountFingerprint) : '';
  if (!tenantId || !ownerUserId || !version || !refId || !/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw _credError('validation_failed', 'google ads credential reference binding is invalid');
  }
  const r = await c.query(`SELECT tenant_id,id,platform,status,revoked_at,version,owner_user_id,account_fingerprint
      FROM orchestrator_tenant_google_ads_credential_refs
     WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, refId]);
  if (r.rowCount !== 1) {
    throw _credError('missing_credentials', 'no tenant-owned Google Ads credential reference');
  }
  const row = r.rows[0];
  if (row.status !== 'active' || row.revoked_at != null || row.platform !== 'google_ads') {
    throw _credError('missing_credentials', 'tenant-owned Google Ads credential reference is not active');
  }
  if (Number(row.tenant_id) !== tenantId || Number(row.owner_user_id) !== ownerUserId) {
    throw _credError('permission_denied', 'credential reference owner does not match the capability actor');
  }
  if (Number(row.version) !== version
      || !_sameString(String(row.account_fingerprint), fingerprint)) {
    throw _credError('context_mismatch', 'credential reference binding does not match the capability');
  }
  return Object.freeze({ credential_ref_id: String(row.id), credential_ref_version: Number(row.version) });
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

// ── PR10B.2a Google Ads paused-draft SECRET boundary ─────────────────────
//
// Last-responsible-moment secret scope for one already-funded Google Ads
// provider-draft operation. The PR10B.1 helper above stays secret-free; this is
// the only place a Google Ads refresh token may be decrypted, and it exists
// solely so a PAUSED, non-serving draft create can be authorized.
//
//   • membership in the initiating tenant is re-checked and the tenant-owned
//     credential REFERENCE row is re-locked and re-matched (tenant, owner, id,
//     version, fingerprint, active, not revoked) inside the caller's tx;
//   • the mutable user_integrations row is locked and its credential_version
//     must still equal the version frozen into the authority, so rotation drift
//     fails closed instead of handing over a newer token;
//   • decryption happens after every check, immediately before the callback;
//   • the refresh-token→access-token exchange uses an INJECTED transport with a
//     hard timeout. There is no default network client here, so this boundary
//     cannot reach Google on its own and never invokes the Ads provider;
//   • nothing is memoized, and secret fields are non-enumerable getters that
//     refuse serialization, redact inspection and die once the scope closes.
const GOOGLE_ADS_PROVIDER_DRAFT_PLATFORM = 'google_ads';
// Pinned by this boundary, never caller-supplied: an injected transport must
// not be able to redirect the refresh token at an attacker-chosen host.
const GOOGLE_ADS_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_TOKEN_TIMEOUT_MS = 8000;
const GOOGLE_ADS_MAX_TOKEN_TIMEOUT_MS = 15000;
const GOOGLE_ADS_MAX_TOKEN_LIFETIME_S = 86400;
const GOOGLE_ADS_SECRET_SCOPE_KIND = 'google_ads_paused_draft_secret_scope';
const GOOGLE_ADS_TOKEN_REQUEST_KIND = 'google_ads_paused_draft_token_request';
const _GA_SECRET_BRAND = Symbol.for('infogenie.google_ads_paused_draft_secret_scope');
const GOOGLE_ADS_ACTIVATION_SECRET_SCOPE_KIND = 'google_ads_activation_secret_scope';
const GOOGLE_ADS_ACTIVATION_TOKEN_REQUEST_KIND = 'google_ads_activation_token_request';
const _GA_ACTIVATION_SECRET_BRAND = Symbol.for('infogenie.google_ads_activation_secret_scope');

function _gaSecret(value, max) {
  const s = typeof value === 'string' ? value : '';
  if (!s || s.length > max || /\s/.test(s) || /^_DUMMY/i.test(s)) return null;
  return s;
}

// Enumerable metadata is safe to log. Secret fields are non-enumerable, so
// JSON.stringify, spread, Object.keys and inspection see nothing at all.
function _gaSealed(kind, safe, secret, live, brand = _GA_SECRET_BRAND) {
  const obj = Object.create(null);
  const def = (key, value, enumerable) => Object.defineProperty(obj, key, {
    value, enumerable, writable: false, configurable: false,
  });
  def('object_kind', kind, true);
  for (const [key, value] of Object.entries(safe)) def(key, value, true);
  for (const [key, value] of Object.entries(secret)) {
    if (value == null) continue;
    Object.defineProperty(obj, key, {
      enumerable: false,
      configurable: false,
      get() {
        if (!live()) throw _credError('validation_failed', `${kind} has already closed`);
        return value;
      },
    });
  }
  def(brand, true, false);
  def('toJSON', () => { throw _credError('validation_failed', `${kind} is not serializable`); }, false);
  def(Symbol.for('nodejs.util.inspect.custom'), () => `[${kind} redacted]`, false);
  return Object.freeze(obj);
}

function isGoogleAdsPausedDraftSecretScope(value) {
  try { return !!value && typeof value === 'object' && value[_GA_SECRET_BRAND] === true; } catch (_e) { return false; }
}
function isGoogleAdsActivationSecretScope(value) {
  try { return !!value && typeof value === 'object' && value[_GA_ACTIVATION_SECRET_BRAND] === true
    && value.object_kind === GOOGLE_ADS_ACTIVATION_SECRET_SCOPE_KIND; } catch (_e) { return false; }
}

// Pinned production token transport. It accepts only the sealed request created
// below, follows no redirect, returns no raw response and never retries.
function googleAdsOAuthTokenTransport(request) {
  const kinds = [GOOGLE_ADS_TOKEN_REQUEST_KIND, GOOGLE_ADS_ACTIVATION_TOKEN_REQUEST_KIND];
  if (!request || !kinds.includes(request.object_kind) || request.url !== GOOGLE_ADS_OAUTH_TOKEN_URL
    || request.method !== 'POST' || request.grant_type !== 'refresh_token') {
    return Promise.reject(_credError('token_exchange_failed', 'google ads token exchange failed'));
  }
  let body;
  try { body = new URLSearchParams({client_id: request.clientId, client_secret: request.clientSecret,
    refresh_token: request.refreshToken, grant_type: 'refresh_token'}).toString(); }
  catch (_e) { return Promise.reject(_credError('token_exchange_failed', 'google ads token exchange failed')); }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(_credError('token_exchange_failed', 'google ads token exchange failed')); } };
    const req = https.request(GOOGLE_ADS_OAUTH_TOKEN_URL, {method: 'POST', timeout: request.timeoutMs,
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)}}, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return fail(); }
      res.on('data', (chunk) => { size += chunk.length; if (size > 65536) { req.destroy(); fail(); } else chunks.push(chunk); });
      res.on('end', () => { if (settled) return; let parsed; try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_e) { return fail(); } settled = true; resolve(parsed); });
    });
    req.on('timeout', () => { req.destroy(); fail(); }); req.on('error', fail); req.end(body);
  });
}

// One exchange, hard deadline, no retry. Transport rejections are re-wrapped so
// a third-party error string can never carry credential material outward, and
// the result is validated before anything downstream may use it.
async function _gaExchangeAccessToken(transport, timeoutMs, request) {
  let timer = null;
  let res;
  const expired = () => _credError('token_exchange_failed', 'google ads token exchange failed');
  try {
    res = await Promise.race([
      Promise.resolve().then(() => transport(request)),
      // Deliberately not unref'd: a hanging transport must still be rejected
      // even when nothing else keeps the loop alive. Always cleared below.
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(expired()), timeoutMs); }),
    ]);
  } catch (_e) { throw expired(); } finally { if (timer) clearTimeout(timer); }
  const accessToken = _gaSecret(res && res.access_token, 4096);
  const expiresIn = _positiveInt(res && res.expires_in);
  if (!accessToken || !expiresIn || expiresIn > GOOGLE_ADS_MAX_TOKEN_LIFETIME_S) throw expired();
  return { accessToken, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

/**
 * Open a Google Ads paused-draft secret scope for the authority binding in
 * `opts` and run `fn(handle)` inside it. Fails closed on inactive membership,
 * a revoked or drifted credential reference, vault version drift, an account
 * fingerprint that no longer matches, or an unusable token exchange. Returns
 * whatever `fn` returns; the boundary itself yields no token, customer id or
 * fingerprint.
 */
async function _withGoogleAdsSecretScope(client, opts, fn, profile) {
  const c = _requireTxClient(client);
  const o = opts || {};
  const timeoutMs = _positiveInt(o.tokenTimeoutMs) || GOOGLE_ADS_TOKEN_TIMEOUT_MS;
  const tenantId = _positiveInt(o.tenantId);
  const ownerUserId = _positiveInt(o.ownerUserId);
  if (typeof fn !== 'function' || typeof o.tokenTransport !== 'function'
      || !tenantId || !ownerUserId || timeoutMs > GOOGLE_ADS_MAX_TOKEN_TIMEOUT_MS) {
    throw _credError('validation_failed', 'google ads secret scope binding is invalid');
  }
  if (!hasKey()) {
    throw _credError('missing_credentials', 'CREDENTIAL_ENCRYPTION_KEY is required for provider-draft secret access');
  }

  await _assertActiveTenantMember(c, tenantId, ownerUserId);
  const reference = await assertGoogleAdsProviderDraftCredentialRefMetadata(c, {
    tenantId,
    ownerUserId,
    credentialRefId: o.credentialRefId,
    credentialRefVersion: o.credentialRefVersion,
    accountFingerprint: o.accountFingerprint,
  });

  const r = await c.query(
    `SELECT ciphertext, iv, tag, status, credential_version FROM user_integrations
      WHERE user_id=$1 AND platform=$2 FOR UPDATE`,
    [ownerUserId, GOOGLE_ADS_PROVIDER_DRAFT_PLATFORM]
  );
  const row = r.rowCount === 1 ? r.rows[0] : null;
  if (!row || row.status === 'disconnected') {
    throw _credError('missing_credentials', 'Google Ads is not connected for this actor');
  }
  if (Number(row.credential_version) !== reference.credential_ref_version) {
    throw _credError('context_mismatch', 'Google Ads credential version drifted from the authority');
  }

  let blob;
  try { blob = JSON.parse(_decrypt(row.ciphertext, row.iv, row.tag)); } catch (_e) {
    throw _credError('missing_credentials', 'Google Ads credentials could not be opened');
  }
  // The normalized customer id is compared as a hash and never returned out of
  // the scope, logged, or persisted by this boundary.
  const fingerprint = _accountFingerprintOfGoogleAdsCustomerId(blob && blob.customerId);
  if (!fingerprint || !_sameString(fingerprint, String(o.accountFingerprint))) {
    throw _credError('context_mismatch', 'Google Ads account does not match the authority binding');
  }
  const refreshToken = _gaSecret(blob.refreshToken, 4096);
  const clientId = _gaSecret(blob.clientId, 512);
  const clientSecret = _gaSecret(blob.clientSecret, 512);
  const developerToken = _gaSecret(blob.devToken, 512);
  const customerId = String(blob.customerId).replace(/[\s-]/g, '');
  const loginCustomerId = blob.loginCustomerId ? String(blob.loginCustomerId).replace(/[\s-]/g, '') : null;
  if (!refreshToken || !clientId || !clientSecret || !developerToken) {
    throw _credError('missing_credentials', 'Google Ads OAuth material is incomplete');
  }
  if (loginCustomerId !== null && !/^[0-9]{10}$/.test(loginCustomerId)) {
    throw _credError('validation_failed', 'Google Ads login customer binding is invalid');
  }

  let exchangeOpen = true; let scopeOpen = true;
  const request = _gaSealed(profile.tokenKind, {
    url: GOOGLE_ADS_OAUTH_TOKEN_URL, method: 'POST', grant_type: 'refresh_token', timeoutMs,
  }, { clientId, clientSecret, refreshToken }, () => exchangeOpen, profile.brand);
  let token;
  try { token = await _gaExchangeAccessToken(o.tokenTransport, timeoutMs, request); } finally { exchangeOpen = false; }
  const handle = _gaSealed(profile.scopeKind, {
    credential_ref_id: reference.credential_ref_id,
    credential_ref_version: reference.credential_ref_version,
    account_fingerprint_matches: true,
    access_token_expires_at: token.expiresAt,
    has_secret_access: true,
  }, { accessToken: token.accessToken, developerToken, customerId, loginCustomerId }, () => scopeOpen, profile.brand);
  try { return await fn(handle); } finally { scopeOpen = false; }
}
async function withGoogleAdsPausedDraftSecretScope(client, opts, fn) {
  return _withGoogleAdsSecretScope(client, opts, fn, {
    tokenKind: GOOGLE_ADS_TOKEN_REQUEST_KIND, scopeKind: GOOGLE_ADS_SECRET_SCOPE_KIND, brand: _GA_SECRET_BRAND,
  });
}
async function withGoogleAdsActivationSecretScope(client, opts, fn) {
  return _withGoogleAdsSecretScope(client, opts, fn, {
    tokenKind: GOOGLE_ADS_ACTIVATION_TOKEN_REQUEST_KIND, scopeKind: GOOGLE_ADS_ACTIVATION_SECRET_SCOPE_KIND,
    brand: _GA_ACTIVATION_SECRET_BRAND,
  });
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
  getCredentialsAtVersion,
  saveCredentials,
  getGoogleAdsCredentialReference,
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
  accountFingerprintOfGoogleAdsCustomerId: _accountFingerprintOfGoogleAdsCustomerId,
  // PR10B.1 — metadata-only Google Ads reference assertion (no secret access)
  assertGoogleAdsProviderDraftCredentialRefMetadata,
  // PR10B.2a — Google Ads paused-draft secret scope (injected transport only)
  GOOGLE_ADS_OAUTH_TOKEN_URL,
  GOOGLE_ADS_TOKEN_TIMEOUT_MS,
  GOOGLE_ADS_MAX_TOKEN_TIMEOUT_MS,
  isGoogleAdsPausedDraftSecretScope,
  withGoogleAdsPausedDraftSecretScope,
  isGoogleAdsActivationSecretScope,
  withGoogleAdsActivationSecretScope,
  googleAdsOAuthTokenTransport,
};
