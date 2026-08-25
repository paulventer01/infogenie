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
};
