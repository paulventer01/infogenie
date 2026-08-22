'use strict';

// Resolve opaque credential_ref values for research connectors.
// Secrets stay in memory for the request. They are never persisted, returned,
// or written to logs. Missing / dummy / foreign refs fail closed.

const { normalizeCredentialRef } = require('./outbox');
const { containsCredentialMaterial } = require('./research_errors');
const vault = require('../credentials/vault');
const C = require('./research_contracts');

const VAULT_PLATFORM = Object.freeze({
  meta_research: 'meta_ads',
  google_research: 'google_ads',
  tiktok_research: 'tiktok_ads',
});

const SELF_REF = 'user_integrations';
const OWNED_REF = /^user_integrations:([1-9][0-9]{0,15})$/;

function safeRef(credentialRef) {
  const ref = normalizeCredentialRef(credentialRef);
  if (!ref) return null;
  if (containsCredentialMaterial(ref)) return null;
  return ref;
}

function assertOwnedRef(credentialRef, userId) {
  const ref = safeRef(credentialRef);
  if (!ref) return { ok: false, error: 'missing_credentials', error_code: 'invalid_credential_ref' };
  if (ref === SELF_REF) return { ok: true, ref, userId };
  const m = OWNED_REF.exec(ref);
  if (!m) return { ok: false, error: 'missing_credentials', error_code: 'invalid_credential_ref' };
  const owner = Number(m[1]);
  if (!Number.isInteger(userId) || userId < 1 || owner !== userId) {
    return { ok: false, error: 'missing_credentials', error_code: 'invalid_credential_ref' };
  }
  return { ok: true, ref, userId };
}

function tokenFromBlob(blob) {
  if (!blob || typeof blob !== 'object') return null;
  const raw = blob.accessToken || blob.access_token || blob.token || blob.apiKey || null;
  if (raw == null || raw === '') return null;
  const s = String(raw);
  if (!s || /^_DUMMY/i.test(s)) return null;
  return s;
}

async function defaultResolveSecret({ connectorId, userId }) {
  if (!C.CONNECTOR_IDS.includes(connectorId) || !userId) return null;
  if (connectorId === 'meta_research' && typeof vault.resolveMetaAdsCredentials === 'function') {
    const r = await vault.resolveMetaAdsCredentials(userId);
    return r && r.ok ? tokenFromBlob(r.creds) : null;
  }
  if (connectorId === 'google_research' && typeof vault.resolveGoogleAdsCredentials === 'function') {
    const r = await vault.resolveGoogleAdsCredentials(userId);
    return r && r.ok ? tokenFromBlob(r.creds) : null;
  }
  const platform = VAULT_PLATFORM[connectorId];
  if (!platform || typeof vault.getCredentials !== 'function') return null;
  const blob = await vault.getCredentials(userId, platform);
  return tokenFromBlob(blob);
}

async function resolveResearchCredential({
  connectorId, credentialRef, userId, resolveSecret,
}) {
  if (!C.CONNECTOR_IDS.includes(String(connectorId || ''))) {
    return { ok: false, error: 'connector_unavailable', error_code: 'connector_unavailable' };
  }
  const owned = assertOwnedRef(credentialRef, userId);
  if (!owned.ok) return owned;
  const resolver = typeof resolveSecret === 'function' ? resolveSecret : defaultResolveSecret;
  let token = null;
  try {
    token = await resolver({
      connectorId,
      credentialRef: owned.ref,
      userId: owned.userId,
    });
  } catch (_) {
    return { ok: false, error: 'missing_credentials', error_code: 'missing_credentials' };
  }
  if (!token) return { ok: false, error: 'missing_credentials', error_code: 'missing_credentials' };
  return { ok: true, credentialRef: owned.ref, token };
}

function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return containsCredentialMaterial(value) ? '[redacted]' : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const nk = String(k).toLowerCase().replace(/[-_\s]/g, '');
    if (/(token|secret|authorization|password|credential|cookie|apikey)/.test(nk)) {
      out[k] = '[redacted]';
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out;
}

module.exports = {
  VAULT_PLATFORM,
  safeRef,
  assertOwnedRef,
  resolveResearchCredential,
  redactSecrets,
  tokenFromBlob,
};
