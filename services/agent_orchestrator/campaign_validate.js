'use strict';

const { fail } = require('./errors');
const { sha256Hex, canonicalize } = require('./hash');
const { normalizeKey } = require('./research_validate');
const { toBigInt, requirePositiveMicros, JSON_MICROS_MAX, microsToJson } = require('./money');
const { assertSafeHttpsUrl } = require('../security/safe_url');
const { containsCredentialMaterial } = require('./research_errors');
const C = require('./campaign_contracts');

const SELF_CREDENTIAL_REF = 'user_integrations';
const OWNED_CREDENTIAL_REF = /^user_integrations:([1-9][0-9]{0,15})$/;

const FORBIDDEN = new Set(C.FORBIDDEN.map(normalizeKey));
const ALLOW = {
  root: new Set(C.KEYS), account: new Set(C.ACCOUNT), destination: new Set(C.DESTINATION),
  budget: new Set(C.BUDGET), schedule: new Set(C.SCHEDULE), geo: new Set(C.GEO),
  audience: new Set(C.AUDIENCE), placement: new Set(C.PLACEMENT), creative: new Set(C.CREATIVE),
  tracking: new Set(C.TRACKING), provenance: new Set(C.PROVENANCE), extension: new Set(C.EXTENSION),
};

function vf(field, reason) { fail('validation_failed', { field, reason: reason || 'invalid' }); }
function isPlain(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}
function txt(v, min, max, field) {
  if (typeof v !== 'string') vf(field, 'not_string');
  const s = v;
  if (s.length < min || s.length > max) vf(field, 'length');
  return s;
}
function optTxt(v, max, field) {
  if (v == null) return undefined;
  return txt(v, 0, max, field);
}
function rejectUnknown(obj, allowed, field) {
  if (!isPlain(obj)) vf(field || 'object', 'not_object');
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN.has(normalizeKey(k))) vf(k, 'forbidden');
    if (!allowed.has(k)) vf(field ? `${field}.${k}` : k, 'unknown');
  }
}
function walkForbidden(value) {
  if (value == null || typeof value !== 'object') return;
  if (Buffer.isBuffer(value)) vf('value', 'binary');
  if (Array.isArray(value)) { value.forEach(walkForbidden); return; }
  for (const k of Object.keys(value)) {
    if (FORBIDDEN.has(normalizeKey(k))) vf(k, 'forbidden');
    walkForbidden(value[k]);
  }
}
function uniqueEnum(arr, allowed, field) {
  if (!Array.isArray(arr) || !arr.length) vf(field, 'empty');
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!allowed.includes(x)) vf(field, 'invalid_enum');
    if (seen.has(x)) vf(field, 'duplicate');
    seen.add(x);
    out.push(x);
  }
  return out;
}
function isoAt(v, field) {
  if (typeof v !== 'string' || !v) vf(field, 'not_string');
  const t = Date.parse(v);
  if (!Number.isFinite(t)) vf(field, 'not_iso');
  return v;
}

async function parseContract(raw) {
  if (!isPlain(raw)) vf('contract', 'not_object');
  walkForbidden(raw);
  rejectUnknown(raw, ALLOW.root, '');
  const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (bytes > C.MAX_JSON) vf('contract_json', 'oversized');
  if (raw.contract_version !== C.CONTRACT_VERSION) vf('contract_version', 'invalid');
  if (!C.OBJECTIVES.includes(raw.objective)) vf('objective', 'invalid_enum');
  const platforms = uniqueEnum(raw.platforms, C.PLATFORMS, 'platforms');
  if (!Array.isArray(raw.accounts) || !raw.accounts.length) vf('accounts', 'empty');
  const accounts = raw.accounts.map((a, i) => {
    rejectUnknown(a, ALLOW.account, `accounts[${i}]`);
    if (!platforms.includes(a.platform)) vf(`accounts[${i}].platform`, 'not_in_platforms');
    const ref = a.credential_ref;
    if (ref == null || ref === '' || typeof ref !== 'string' || !C.CREDENTIAL_REF_RE.test(ref)) {
      fail('missing_credentials', { field: `accounts[${i}].credential_ref` });
    }
    return { platform: a.platform, credential_ref: ref };
  });
  const seenPlat = new Set();
  for (const a of accounts) {
    if (seenPlat.has(a.platform)) vf('accounts', 'duplicate_platform');
    seenPlat.add(a.platform);
  }
  rejectUnknown(raw.destination, ALLOW.destination, 'destination');
  const url = String(raw.destination.landing_page_url || '');
  rejectUnknown(raw.budget, ALLOW.budget, 'budget');
  if (typeof raw.budget.amount_micros === 'number' && !Number.isFinite(raw.budget.amount_micros)) {
    vf('budget.amount_micros', 'non_finite');
  }
  let micros;
  try { micros = requirePositiveMicros(toBigInt(raw.budget.amount_micros)); }
  catch (e) { vf('budget.amount_micros', 'invalid'); }
  if (micros > JSON_MICROS_MAX) vf('budget.amount_micros', 'overflow');
  if (!C.CURRENCIES.includes(raw.budget.currency)) vf('budget.currency', 'invalid_enum');
  rejectUnknown(raw.schedule, ALLOW.schedule, 'schedule');
  const start_at = isoAt(raw.schedule.start_at, 'schedule.start_at');
  const schedule = { start_at };
  if (raw.schedule.end_at != null) {
    const end_at = isoAt(raw.schedule.end_at, 'schedule.end_at');
    if (Date.parse(end_at) <= Date.parse(start_at)) vf('schedule.end_at', 'before_start');
    schedule.end_at = end_at;
  }
  rejectUnknown(raw.geo, ALLOW.geo, 'geo');
  if (!Array.isArray(raw.geo.countries) || raw.geo.countries.length < 1 || raw.geo.countries.length > C.MAX_COUNTRIES) {
    vf('geo.countries', 'invalid');
  }
  const countries = raw.geo.countries.map((c, i) => {
    if (typeof c !== 'string' || !C.ISO2.test(c)) vf(`geo.countries[${i}]`, 'invalid');
    return c;
  });
  let audience;
  if (raw.audience != null) {
    rejectUnknown(raw.audience, ALLOW.audience, 'audience');
    audience = { name: txt(raw.audience.name, 1, 120, 'audience.name') };
    if (raw.audience.notes != null) audience.notes = txt(raw.audience.notes, 0, 500, 'audience.notes');
  }
  let placements;
  if (raw.placements != null) {
    if (!isPlain(raw.placements)) vf('placements', 'not_object');
    placements = {};
    for (const k of Object.keys(raw.placements)) {
      if (FORBIDDEN.has(normalizeKey(k))) vf(`placements.${k}`, 'forbidden');
      if (!platforms.includes(k)) vf(`placements.${k}`, 'unknown_platform');
      rejectUnknown(raw.placements[k], ALLOW.placement, `placements.${k}`);
      placements[k] = { type: txt(raw.placements[k].type, 1, 64, `placements.${k}.type`) };
    }
  }
  if (!Array.isArray(raw.creatives) || raw.creatives.length < 1 || raw.creatives.length > C.MAX_CREATIVES) {
    vf('creatives', 'invalid');
  }
  const creatives = raw.creatives.map((cr, i) => {
    rejectUnknown(cr, ALLOW.creative, `creatives[${i}]`);
    if (!C.CREATIVE_KINDS.includes(cr.kind)) vf(`creatives[${i}].kind`, 'invalid_enum');
    const asset_id = String(cr.asset_id || '');
    if (!C.ASSET_ID_RE.test(asset_id)) vf(`creatives[${i}].asset_id`, 'invalid');
    const version = cr.version;
    if (!Number.isInteger(version) || version < 1) vf(`creatives[${i}].version`, 'invalid');
    const content_hash = String(cr.content_hash || '');
    if (!C.HEX64.test(content_hash)) vf(`creatives[${i}].content_hash`, 'invalid');
    return { kind: cr.kind, asset_id, version, content_hash };
  });
  rejectUnknown(raw.tracking, ALLOW.tracking, 'tracking');
  const tracking = {
    utm_source: txt(raw.tracking.utm_source, 1, 64, 'tracking.utm_source'),
    utm_medium: txt(raw.tracking.utm_medium, 1, 64, 'tracking.utm_medium'),
    utm_campaign: txt(raw.tracking.utm_campaign, 1, 64, 'tracking.utm_campaign'),
  };
  rejectUnknown(raw.provenance, ALLOW.provenance, 'provenance');
  const provenance = { workflow_id: txt(raw.provenance.workflow_id, 1, 128, 'provenance.workflow_id') };
  if (raw.provenance.proposal_id != null) provenance.proposal_id = txt(raw.provenance.proposal_id, 1, 128, 'provenance.proposal_id');
  if (raw.provenance.brief_artifact_id != null) provenance.brief_artifact_id = txt(raw.provenance.brief_artifact_id, 1, 128, 'provenance.brief_artifact_id');
  if (raw.provenance.evidence_hash != null) {
    const eh = String(raw.provenance.evidence_hash);
    if (!C.HEX64.test(eh)) vf('provenance.evidence_hash', 'invalid');
    provenance.evidence_hash = eh;
  }
  let platform_extensions;
  if (raw.platform_extensions != null) {
    if (!isPlain(raw.platform_extensions)) vf('platform_extensions', 'not_object');
    platform_extensions = {};
    for (const k of Object.keys(raw.platform_extensions)) {
      if (FORBIDDEN.has(normalizeKey(k))) vf(`platform_extensions.${k}`, 'forbidden');
      if (!platforms.includes(k)) vf(`platform_extensions.${k}`, 'unknown_platform');
      rejectUnknown(raw.platform_extensions[k], ALLOW.extension, `platform_extensions.${k}`);
      const ext = {};
      const src = raw.platform_extensions[k];
      if (src.optimization_goal != null) ext.optimization_goal = txt(src.optimization_goal, 1, 64, `platform_extensions.${k}.optimization_goal`);
      if (src.placement != null) ext.placement = txt(src.placement, 1, 64, `platform_extensions.${k}.placement`);
      platform_extensions[k] = ext;
    }
  }
  const safe = await assertSafeHttpsUrl(url);
  if (!safe.ok) fail('unsafe_url', { reason: safe.reason, field: 'destination.landing_page_url' });
  const contract = {
    contract_version: C.CONTRACT_VERSION, objective: raw.objective, platforms, accounts,
    destination: { landing_page_url: safe.url },
    budget: { amount_micros: microsToJson(micros), currency: raw.budget.currency },
    schedule, geo: { countries }, creatives, tracking, provenance,
  };
  if (audience) contract.audience = audience;
  if (placements) contract.placements = placements;
  if (platform_extensions) contract.platform_extensions = platform_extensions;
  return contract;
}

function contractHash(contract) { return sha256Hex(canonicalize(contract)); }

async function checkCreatives(client, tenantId, creatives) {
  const errors = [];
  for (let i = 0; i < creatives.length; i++) {
    const cr = creatives[i];
    const field = `creatives[${i}]`;
    let row = null;
    if (cr.kind === 'creative_brief') {
      row = (await client.query(
        `SELECT 1 FROM orchestrator_creative_artifacts
          WHERE tenant_id=$1 AND (id=$2 OR artifact_id=$2) AND version=$3 AND content_hash=$4 AND status='approved'
          LIMIT 1`,
        [tenantId, cr.asset_id, cr.version, cr.content_hash]
      )).rows[0];
    } else if (cr.kind === 'static_image') {
      row = (await client.query(
        `SELECT 1 FROM orchestrator_static_image_assets
          WHERE tenant_id=$1 AND id=$2 AND usable=true AND asset_hash=$3
            AND ($4::int = 1 OR proposal_version=$4)
          LIMIT 1`,
        [tenantId, cr.asset_id, cr.content_hash, cr.version]
      )).rows[0];
    } else if (cr.kind === 'video') {
      const q = cr.version === 1
        ? `SELECT 1 FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND id=$2 AND usable=true LIMIT 1`
        : `SELECT 1 FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND id=$2 AND usable=true AND 1=0 LIMIT 1`;
      row = (await client.query(q, [tenantId, cr.asset_id])).rows[0];
    }
    if (!row) errors.push({ code: 'missing_creative', field });
  }
  return errors;
}

function vaultPlatformKey(platform) {
  if (typeof platform !== 'string' || !Object.prototype.hasOwnProperty.call(C.VAULT_PLATFORM, platform)) {
    return null;
  }
  const key = C.VAULT_PLATFORM[platform];
  return typeof key === 'string' && key ? key : null;
}

function ownedCredentialUserId(credentialRef, userId) {
  if (typeof credentialRef !== 'string' || !C.CREDENTIAL_REF_RE.test(credentialRef)) return null;
  if (containsCredentialMaterial(credentialRef)) return null;
  if (!Number.isInteger(userId) || userId < 1) return null;
  if (credentialRef === SELF_CREDENTIAL_REF) return userId;
  const owned = OWNED_CREDENTIAL_REF.exec(credentialRef);
  if (!owned) return null;
  const owner = Number(owned[1]);
  if (owner !== userId) return null;
  return userId;
}

async function actorInTenant(client, tenantId, userId) {
  if (!client || tenantId == null || !Number.isInteger(userId) || userId < 1) return false;
  const r = await client.query(
    `SELECT 1 FROM tenant_users WHERE tenant_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [tenantId, userId]
  );
  return r.rows.length > 0;
}

async function checkCredentials(userId, contract, opts) {
  const vault = require('../credentials/vault');
  const errors = [];
  const tenantId = opts && opts.tenantId;
  const client = opts && opts.client;
  if (!(await actorInTenant(client, tenantId, userId))) {
    errors.push({ code: 'missing_credentials', field: 'accounts' });
    return errors;
  }
  const have = new Set((contract.accounts || []).map((a) => a.platform));
  for (const p of contract.platforms || []) {
    if (!have.has(p) || !vaultPlatformKey(p)) {
      errors.push({ code: 'missing_credentials', field: `accounts.${p}` });
    }
  }
  for (const a of contract.accounts || []) {
    const vaultKey = vaultPlatformKey(a.platform);
    if (!vaultKey) {
      errors.push({ code: 'missing_credentials', field: `accounts.${a.platform}` });
      continue;
    }
    const ownerId = ownedCredentialUserId(a.credential_ref, userId);
    if (!ownerId) {
      errors.push({ code: 'missing_credentials', field: 'accounts.credential_ref' });
      continue;
    }
    const ok = await vault.hasCredentials(ownerId, vaultKey);
    if (!ok) errors.push({ code: 'missing_credentials', field: `accounts.${a.platform}` });
  }
  return errors;
}

module.exports = {
  parseContract, contractHash, checkCreatives, checkCredentials,
  vaultPlatformKey, ownedCredentialUserId, optTxt, txt, vf,
};
