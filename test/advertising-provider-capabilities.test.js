'use strict';
// test/advertising-provider-capabilities.test.js — PR 6F-0 Meta
// create_provider_draft capability boundary.
//
// Zero network. Everything asserted here is a property of the security boundary
// itself; the transaction-liveness regression uses local Postgres when present:
//   • a capability cannot be forged, cloned, serialized, replayed or stretched;
//   • a capability can only be minted inside an open execution transaction, and
//     PR 6F-0 has no mint site in product code at all;
//   • the vault credential-reference boundary validates the reference and reads
//     no secret;
//   • the new permission is least-privilege and the matrix gates the approved
//     confirm surface exactly;
//   • PR #99's default-deny is untouched.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PERMISSION_ENFORCEMENT = process.env.PERMISSION_ENFORCEMENT || 'on';
process.env.MULTITENANT_ENFORCEMENT = process.env.MULTITENANT_ENFORCEMENT || 'on';

require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const db = require('../db');
const caps = require('../services/security/advertising_provider_capabilities');
const security = require('../services/security');
const guard = require('../services/security/advertising_provider_mutations');
const vault = require('../services/credentials/vault');
const matrix = require('../services/tenants/permission_matrix');
const { PERMISSIONS, SYSTEM_ROLES, isValidPermission } = require('../services/tenants/permissions');

const ROOT = path.join(__dirname, '..');
const PERMISSION_KEY = 'advertising.provider_drafts.create';
const HASH_A = 'a'.repeat(64);
const FINGERPRINT = 'b'.repeat(64);

const NOW = 1_700_000_000_000;

function bindingFixture(over) {
  return {
    tenant_id: 7,
    revision: 3,
    workflow_approval_id: 41,
    generation: 2,
    credential_ref_version: 1,
    requested_by: 12,
    draft_id: 'cd_abc',
    publish_approval_id: 'cpa_abc',
    publishing_request_id: 'cpr_abc',
    intent_id: 'cdi_abc',
    outbox_id: 'ob_abc',
    attempt_id: 'cda_abc',
    challenge_id: 'cpc_abc',
    confirmation_id: 'cpcf_abc',
    credential_ref_id: 'tmcr_abc',
    claim_token_hash: HASH_A,
    intent_hash: 'c'.repeat(64),
    snapshot_hash: 'd'.repeat(64),
    contract_hash: 'e'.repeat(64),
    request_hash: 'f'.repeat(64),
    phrase_digest: '1'.repeat(64),
    account_fingerprint: FINGERPRINT,
    issued_at_ms: NOW,
    expires_at_ms: NOW + 30_000,
    ...(over || {}),
  };
}

// A pg client that behaves like one inside an explicit transaction: SAVEPOINT
// succeeds. `notInTransaction` mirrors Postgres 25P01 for autocommit callers.
function fakeTxClient(opts) {
  const o = opts || {};
  const calls = [];
  let inTransaction = !o.notInTransaction;
  let transactionNumber = 1;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      const text = String(sql).trim();
      if (/^(?:COMMIT|ROLLBACK)\s*;?$/i.test(text)) {
        inTransaction = false;
        return { rows: [], rowCount: 0 };
      }
      if (/^BEGIN\s*;?$/i.test(text)) {
        transactionNumber += 1;
        inTransaction = true;
        return { rows: [], rowCount: 0 };
      }
      if (/^SAVEPOINT/i.test(text)) {
        if (!inTransaction) {
          const err = new Error('SAVEPOINT can only be used in transaction blocks');
          err.code = '25P01';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      }
      if (/^RELEASE SAVEPOINT/i.test(text)) return { rows: [], rowCount: 0 };
      if (/pg_current_xact_id\(\)/i.test(text)) {
        return { rows: [{ transaction_id: `tx-${transactionNumber}` }], rowCount: 1 };
      }
      if (/FROM tenant_users/.test(text)) {
        return o.member === false ? { rows: [], rowCount: 0 } : { rows: [{ '1': 1 }], rowCount: 1 };
      }
      if (new RegExp(vault.META_PROVIDER_DRAFT_TABLE).test(text)) {
        const rows = o.refRows !== undefined ? o.refRows : [credentialRefRow()];
        return { rows, rowCount: rows.length };
      }
      throw new Error('unexpected query in fake client: ' + text);
    },
  };
}

function credentialRefRow(over) {
  return {
    id: 'tmcr_abc',
    tenant_id: 7,
    platform: 'meta',
    environment: 'sandbox',
    status: 'active',
    account_fingerprint: FINGERPRINT,
    version: 1,
    owner_user_id: 12,
    revoked_at: null,
    ...(over || {}),
  };
}

async function mintFixture(over, clientOpts) {
  const client = fakeTxClient(clientOpts);
  const binding = bindingFixture(over);
  const cap = await caps.withAdvertisingProviderExecutionTransaction(client, (tx) =>
    caps.mintMetaCreateProviderDraftCapability(tx, binding));
  return { cap, binding, client };
}

function lockedContextFrom(binding) {
  const out = {};
  for (const f of caps.BINDING_FIELDS) out[f] = binding[f];
  return out;
}

async function rejectsWithCode(fn, code, label) {
  await assert.rejects(async () => fn(), (err) => {
    assert.equal(err && err.code, code, `${label}: expected code ${code}, got ${err && err.code}`);
    return true;
  }, label);
}

function throwsWithCode(fn, code, label) {
  assert.throws(fn, (err) => {
    assert.equal(err && err.code, code, `${label}: expected code ${code}, got ${err && err.code}`);
    return true;
  }, label);
}

// ── Mint surface ────────────────────────────────────────────────────────────

test('capability: minting requires a live execution-transaction scope', async () => {
  const binding = bindingFixture();
  // No handle at all.
  await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(null, binding),
    caps.CODES.MINT_DENIED, 'null handle');
  // A hand-rolled object that merely looks like a handle.
  await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability({}, binding),
    caps.CODES.MINT_DENIED, 'plain object handle');
  await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(Object.create(null), binding),
    caps.CODES.MINT_DENIED, 'null-prototype handle');
  // An escaped handle is revoked the moment the scope returns.
  let escaped = null;
  await caps.withAdvertisingProviderExecutionTransaction(fakeTxClient(), (tx) => { escaped = tx; });
  assert.ok(escaped, 'scope produced a handle');
  await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(escaped, binding),
    caps.CODES.MINT_DENIED, 'escaped handle');
});

test('capability: the execution scope refuses a client outside a transaction', async () => {
  await rejectsWithCode(
    () => caps.withAdvertisingProviderExecutionTransaction(fakeTxClient({ notInTransaction: true }), () => 'nope'),
    caps.CODES.MINT_DENIED, 'autocommit client'
  );
  await rejectsWithCode(
    () => caps.withAdvertisingProviderExecutionTransaction({}, () => 'nope'),
    caps.CODES.MINT_DENIED, 'no query function'
  );
  await rejectsWithCode(
    () => caps.withAdvertisingProviderExecutionTransaction(fakeTxClient(), null),
    caps.CODES.MINT_DENIED, 'no callback'
  );
  // The probe really is a SAVEPOINT round-trip, not a no-op.
  const client = fakeTxClient();
  await caps.withAdvertisingProviderExecutionTransaction(client, () => null);
  assert.match(client.calls[0].sql, /^SAVEPOINT /);
  assert.match(client.calls[1].sql, /^RELEASE SAVEPOINT /);
  assert.match(client.calls[2].sql, /pg_current_xact_id\(\)/);
});

test('capability: COMMIT or ROLLBACK closes mint and use authority', {
  skip: !db.hasDb(),
}, async () => {
  const client = await db.getPool().connect();
  try {
    for (const ending of ['COMMIT', 'ROLLBACK']) {
      await client.query('BEGIN');
      await rejectsWithCode(
        () => caps.withAdvertisingProviderExecutionTransaction(client, async (tx) => {
          await client.query(ending);
          return caps.mintMetaCreateProviderDraftCapability(tx, bindingFixture());
        }),
        caps.CODES.MINT_DENIED,
        `${ending} before mint`
      );
    }

    await client.query('BEGIN');
    const binding = bindingFixture();
    await caps.withAdvertisingProviderExecutionTransaction(client, async (tx) => {
      const cap = await caps.mintMetaCreateProviderDraftCapability(tx, binding);
      await client.query('COMMIT');
      await client.query('BEGIN');
      await rejectsWithCode(
        () => caps.verifyMetaCreateProviderDraftCapability(
          cap,
          lockedContextFrom(binding),
          { now: NOW }
        ),
        caps.CODES.INVALID,
        'replacement transaction before use while callback scope remains live'
      );
    });

    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await rejectsWithCode(
      () => caps.withAdvertisingProviderExecutionTransaction(client, async (tx) => {
        await client.query('COMMIT');
        await client.query('BEGIN');
        return caps.mintMetaCreateProviderDraftCapability(tx, bindingFixture());
      }),
      caps.CODES.MINT_DENIED,
      'replacement transaction before mint'
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('capability: mint rejects malformed, over-long and unknown bindings', async () => {
  const client = fakeTxClient();
  await caps.withAdvertisingProviderExecutionTransaction(client, async (tx) => {
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, null),
      caps.CODES.MINT_DENIED, 'null binding');
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, bindingFixture({ tenant_id: 0 })),
      caps.CODES.MINT_DENIED, 'non-positive tenant');
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, bindingFixture({ tenant_id: '7' })),
      caps.CODES.MINT_DENIED, 'string tenant');
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, bindingFixture({ claim_token_hash: 'nope' })),
      caps.CODES.MINT_DENIED, 'bad hash');
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, bindingFixture({ draft_id: 'a'.repeat(129) })),
      caps.CODES.MINT_DENIED, 'over-long id');
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, bindingFixture({ draft_id: 'bad id/../x' })),
      caps.CODES.MINT_DENIED, 'unsafe id');
    // TTL cannot be stretched past the module ceiling, and cannot be inverted.
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx,
      bindingFixture({ expires_at_ms: NOW + caps.CAPABILITY_TTL_MS + 1 })),
    caps.CODES.MINT_DENIED, 'ttl too long');
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx,
      bindingFixture({ expires_at_ms: NOW })),
    caps.CODES.MINT_DENIED, 'zero ttl');
    // Extra keys are refused rather than ignored, so an options bag cannot ride along.
    const withExtra = bindingFixture();
    withExtra.allow_provider_write = true;
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, withExtra),
      caps.CODES.MINT_DENIED, 'extra binding key');
    // A missing field is a denial, not a default.
    const missing = bindingFixture();
    delete missing.attempt_id;
    await rejectsWithCode(() => caps.mintMetaCreateProviderDraftCapability(tx, missing),
      caps.CODES.MINT_DENIED, 'missing binding key');
  });
  assert.ok(caps.CAPABILITY_TTL_MS <= 5 * 60 * 1000, 'capability must stay short-lived');
});

// ── Shape, unforgeability, non-serializability ──────────────────────────────

test('capability: the minted object is frozen, exact-shaped and non-serializable', async () => {
  const { cap, binding } = await mintFixture();
  assert.equal(caps.isAdvertisingProviderCapability(cap), true);
  assert.equal(Object.isFrozen(cap), true, 'frozen');
  assert.equal(Object.getPrototypeOf(cap), null, 'null prototype');
  assert.deepEqual(Object.keys(cap).sort(), caps.CAPABILITY_FIELDS.slice().sort());
  assert.equal(cap.platform, 'meta');
  assert.equal(cap.operation, 'create_provider_draft');
  assert.equal(cap.contract_version, 'campaign_delivery_v1');
  assert.equal(cap.object_kind, caps.CAPABILITY_KIND);

  // Immutable: writes are refused, not silently applied.
  assert.throws(() => { 'use strict'; cap.tenant_id = 999; });
  assert.throws(() => Object.defineProperty(cap, 'tenant_id', { value: 999 }));
  assert.equal(cap.tenant_id, binding.tenant_id);

  // Cannot be written into an outbox payload, an audit row or an HTTP body.
  throwsWithCode(() => JSON.stringify(cap), caps.CODES.INVALID, 'JSON.stringify');
  throwsWithCode(() => JSON.stringify({ capability: cap }), caps.CODES.INVALID, 'nested JSON.stringify');
  throwsWithCode(() => `${cap}`, caps.CODES.INVALID, 'template string');
  assert.match(util.inspect(cap), /redacted/, 'inspection is redacted');
});

test('capability: plain objects, clones and proxies are not capabilities', async () => {
  const { cap, binding } = await mintFixture();
  const locked = lockedContextFrom(binding);

  const clone = { ...bindingFixture(), object_kind: caps.CAPABILITY_KIND, platform: 'meta',
    operation: 'create_provider_draft', contract_version: 'campaign_delivery_v1',
    capability_version: caps.CAPABILITY_VERSION };
  assert.equal(caps.isAdvertisingProviderCapability(clone), false, 'structural clone');
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(clone, locked, { now: NOW }),
    caps.CODES.INVALID, 'structural clone assert');

  const proxy = new Proxy(clone, {});
  assert.equal(caps.isAdvertisingProviderCapability(proxy), false, 'proxy of clone');
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(proxy, locked, { now: NOW }),
    caps.CODES.INVALID, 'proxy assert');

  // A proxy WRAPPING a real capability is a different object identity, so it is
  // not the minted capability either.
  const wrapped = new Proxy(cap, {});
  assert.equal(caps.isAdvertisingProviderCapability(wrapped), false, 'proxy of capability');

  const junkCases = [
    ['null', null], ['undefined', undefined], ['zero', 0], ['empty string', ''],
    ['string', 'cap'], ['array', []], ['function', () => {}],
    ['bare null-prototype object', Object.create(null)],
  ];
  for (const [label, junk] of junkCases) {
    assert.equal(caps.isAdvertisingProviderCapability(junk), false, label);
  }
  // Environment, request-shaped and option-shaped inputs are all rejected.
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(
    { ...process.env }, locked, { now: NOW }), caps.CODES.INVALID, 'env object');
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(
    { body: {}, headers: {}, query: {} }, locked, { now: NOW }), caps.CODES.INVALID, 'request-shaped');
});

// ── Exact binding, single use, expiry ───────────────────────────────────────

test('capability: assertion requires an exact locked execution context', async () => {
  const { binding } = await mintFixture();
  const locked = lockedContextFrom(binding);

  // Every single binding field is load-bearing.
  for (const field of caps.BINDING_FIELDS) {
    const { cap } = await mintFixture();
    const tampered = { ...locked };
    if (typeof tampered[field] === 'number') tampered[field] = tampered[field] + 1;
    else if (/_hash$|_digest$|fingerprint$/.test(field)) tampered[field] = '9'.repeat(64);
    else tampered[field] = tampered[field] + '_x';
    await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(cap, tampered, { now: NOW }),
      caps.CODES.CONTEXT_MISMATCH, `tampered ${field}`);
    // The failed assertion must NOT have spent the single use.
    assert.equal((await caps.assertMetaCreateProviderDraftCapability(cap, locked, { now: NOW })).tenant_id, 7,
      `capability still usable after a rejected context (${field})`);
  }

  // Missing and extra keys are both mismatches — no partial matching.
  const short = { ...locked };
  delete short.attempt_id;
  const extra = { ...locked, allow_provider_write: true };
  for (const [label, ctx] of [['missing key', short], ['extra key', extra], ['not an object', 'nope'], ['array', []]]) {
    const { cap } = await mintFixture();
    await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(cap, ctx, { now: NOW }),
      caps.CODES.CONTEXT_MISMATCH, label);
  }
  // The capability is not its own locked context.
  const { cap: selfCap } = await mintFixture();
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(selfCap, selfCap, { now: NOW }),
    caps.CODES.CONTEXT_MISMATCH, 'capability as its own context');
});

test('capability: one use only, and short-lived', async () => {
  const { cap, binding } = await mintFixture();
  const locked = lockedContextFrom(binding);
  const detail = await caps.assertMetaCreateProviderDraftCapability(cap, locked, { now: NOW });
  assert.equal(detail.operation, 'create_provider_draft');
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(cap, locked, { now: NOW }),
    caps.CODES.SPENT, 'replay');
  // A spent capability cannot be revived through the non-consuming verifier.
  await rejectsWithCode(() => caps.verifyMetaCreateProviderDraftCapability(cap, locked, { now: NOW }),
    caps.CODES.SPENT, 'verify after spend');

  const { cap: aged, binding: agedBinding } = await mintFixture();
  const agedLocked = lockedContextFrom(agedBinding);
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(aged, agedLocked,
    { now: agedBinding.expires_at_ms }), caps.CODES.EXPIRED, 'already expired AT expires_at_ms');
  await rejectsWithCode(() => caps.assertMetaCreateProviderDraftCapability(aged, agedLocked,
    { now: agedBinding.expires_at_ms + 1 }), caps.CODES.EXPIRED, 'expired');
  // Expiry did not spend the capability, but time cannot be argued backwards
  // through an options bag either — `now` is only ever a timestamp.
  assert.equal(await caps.verifyMetaCreateProviderDraftCapability(aged, agedLocked, { now: NOW }), true);

  // The non-consuming verifier really does not consume.
  const { cap: kept, binding: keptBinding } = await mintFixture();
  const keptLocked = lockedContextFrom(keptBinding);
  assert.equal(await caps.verifyMetaCreateProviderDraftCapability(kept, keptLocked, { now: NOW }), true);
  assert.equal(await caps.verifyMetaCreateProviderDraftCapability(kept, keptLocked, { now: NOW }), true);
  assert.equal((await caps.assertMetaCreateProviderDraftCapability(kept, keptLocked, { now: NOW })).tenant_id, 7);
});

test('capability: concurrent assertions spend exactly once', async () => {
  const { cap, binding } = await mintFixture();
  const locked = lockedContextFrom(binding);
  const results = await Promise.allSettled([
    caps.assertMetaCreateProviderDraftCapability(cap, locked, { now: NOW }),
    caps.assertMetaCreateProviderDraftCapability(cap, locked, { now: NOW }),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].value.operation, 'create_provider_draft');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason && rejected[0].reason.code, caps.CODES.SPENT);
});

// ── Audit hygiene ───────────────────────────────────────────────────────────

test('capability: the audit projection carries no secret, hash or account material', async () => {
  const { cap } = await mintFixture();
  const detail = caps.auditDetailForCapability(cap);
  assert.deepEqual(Object.keys(detail).sort(), caps.AUDIT_DETAIL_KEYS.slice().sort());
  for (const banned of caps.AUDIT_FORBIDDEN_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(detail, banned), false, `${banned} must not be auditable`);
  }
  for (const banned of ['credential_ref_id', 'account_fingerprint', 'claim_token_hash',
    'intent_hash', 'snapshot_hash', 'contract_hash', 'request_hash', 'phrase_digest',
    'phrase_salt', 'access_token', 'payload', 'snapshot']) {
    assert.equal(caps.AUDIT_DETAIL_KEYS.includes(banned), false, `${banned} not on the allowlist`);
  }
  // The projection IS serializable — it is what an audit row may hold.
  assert.doesNotThrow(() => JSON.stringify(detail));
  assert.doesNotMatch(JSON.stringify(detail), new RegExp(FINGERPRINT));
  assert.doesNotMatch(JSON.stringify(detail), new RegExp(HASH_A));
});

test('the backend confirmation audit allowlist excludes secrets, hashes and credential ids', () => {
  const contracts = require('../services/agent_orchestrator/campaign_delivery_contracts');
  const allow = contracts.CONFIRM_AUDIT_DETAIL_KEYS;
  assert.ok(Array.isArray(allow) && allow.length >= 10, 'confirmation audit allowlist is explicit');
  for (const banned of ['phrase_salt', 'phrase_digest', 'claim_token', 'claim_token_hash',
    'credential_ref_id', 'account_fingerprint', 'intent_hash', 'snapshot_hash', 'contract_hash',
    'request_hash', 'payload', 'snapshot', 'access_token', 'account_id']) {
    assert.equal(allow.includes(banned), false, `${banned} must not be audit-loggable`);
  }
  const sanitized = contracts.sanitizeConfirmAuditDetail({
    action: 'confirm',
    phrase_salt: 'x'.repeat(64),
    phrase_digest: 'y'.repeat(64),
    claim_token_hash: HASH_A,
    credential_ref_id: 'tmcr_abc',
    account_fingerprint: FINGERPRINT,
    payload: { a: 1 },
  });
  assert.deepEqual(Object.keys(sanitized), ['action']);
});

// ── No premature mint surface ───────────────────────────────────────────────

test('capability: nothing in product code can mint or open the execution scope', () => {
  // Product code only. The module itself and the security docs may name the mint
  // path, and `test/` is a deliberate seam — the whole point of the scan is that
  // no shippable code path can reach it.
  const allowed = new Set([
    'services/security/advertising_provider_capabilities.js',
    'services/agent_orchestrator/campaign_provider_draft_execution.js',
    'docs/security-guardrails.md',
  ]);
  const offenders = { mint: [], scope: [] };
  const skipDirs = new Set([
    'node_modules', '.git', '.next', 'legacy_archive', 'backups', 'exports',
    '.replit_integration_files', 'coverage', 'data', 'test',
  ]);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.cursor') continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx|md)$/.test(entry.name)) continue;
      if (allowed.has(rel)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      if (src.includes('mintMetaCreateProviderDraftCapability')) offenders.mint.push(rel);
      if (src.includes('withAdvertisingProviderExecutionTransaction')) offenders.scope.push(rel);
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders.mint, [],
    'capability minting is confined to the security module and the PR 6F-1 execution path');
  assert.deepEqual(offenders.scope, [],
    'execution-transaction scope is confined to the PR 6F-1 execution path');
});

test('capability: the broad security index does not export the mint path', () => {
  for (const banned of [
    'mintMetaCreateProviderDraftCapability',
    'withAdvertisingProviderExecutionTransaction',
    'assertMetaCreateProviderDraftCapability',
    'verifyMetaCreateProviderDraftCapability',
  ]) {
    assert.equal(banned in security, false, `services/security must not re-export ${banned}`);
  }
  // The read-only half IS available for call sites that only need to recognise one.
  assert.equal(typeof security.isAdvertisingProviderCapability, 'function');
  assert.equal(security.ADVERTISING_PROVIDER_CAPABILITY_OPERATION, 'create_provider_draft');
  assert.equal(security.ADVERTISING_PROVIDER_CAPABILITY_PLATFORM, 'meta');
  assert.equal(security.ADVERTISING_PROVIDER_CAPABILITY_CODES.INVALID,
    'advertising_provider_capability_invalid');

  const indexSrc = fs.readFileSync(path.join(ROOT, 'services/security/index.js'), 'utf8');
  const exportBlock = indexSrc.slice(indexSrc.lastIndexOf('module.exports'));
  assert.doesNotMatch(exportBlock, /mintMetaCreateProviderDraftCapability/);
  assert.doesNotMatch(exportBlock, /withAdvertisingProviderExecutionTransaction/);
});

test('capability: the module has no network, env, vault or provider sink', () => {
  const src = fs.readFileSync(path.join(ROOT, 'services/security/advertising_provider_capabilities.js'), 'utf8');
  assert.doesNotMatch(src, /process\.env/, 'no env read — there is no kill-switch bypass here');
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /require\(['"](https?|axios|node-fetch|undici|googleapis|facebook-nodejs-business-sdk|pg)['"]\)/);
  assert.doesNotMatch(src, /credentials\/vault/);
  assert.doesNotMatch(src, /decrypt|access_token|refresh_token/i);
  assert.doesNotMatch(src, /require\(['"]\.\.\/\.\.\/db['"]\)/);
  // Registries must stay module-private.
  assert.match(src, /const MINTED = new WeakSet\(\)/);
  assert.match(src, /const LIVE_TX = new WeakMap\(\)/);
  const exportBlock = src.slice(src.lastIndexOf('module.exports'));
  for (const banned of ['MINTED', 'STATE', 'LIVE_TX']) {
    assert.doesNotMatch(exportBlock, new RegExp(`\\b${banned}\\b`), `${banned} must stay private`);
  }
});

test('capability: only the PR 6F-1 execution module may reach the capability module', () => {
  const allowed = new Set(['campaign_provider_draft_execution.js']);
  const dir = path.join(ROOT, 'services/agent_orchestrator');
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    if (allowed.has(name)) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(src, /advertising_provider_capabilities/,
      `${name} must not reach the capability module`);
  }
});

// ── PR #99 default-deny is preserved ───────────────────────────────────────

test('guard: PR #99 default-deny survives, and a capability cannot ride a denial', async () => {
  assert.equal(guard.isAdvertisingProviderMutationAllowed(), false);
  assert.equal(security.isAdvertisingProviderMutationAllowed(), false);
  const guardSrc = fs.readFileSync(path.join(ROOT, 'services/security/advertising_provider_mutations.js'), 'utf8');
  assert.doesNotMatch(guardSrc, /process\.env/, 'the kill switch reads no environment variable');
  // The allow predicate body is still a bare `return false;`.
  const allowFn = guardSrc.slice(guardSrc.indexOf('function isAdvertisingProviderMutationAllowed'));
  assert.match(allowFn.slice(0, allowFn.indexOf('}')), /\{\s*return false;\s*$/);

  const { cap } = await mintFixture();
  // A capability handed to the deny payload must be dropped, not serialized.
  const payload = guard.denyAdvertisingProviderMutation({ platform: 'meta', capability: cap, nested: { cap } });
  assert.equal(payload.ok, false);
  assert.equal(payload.blocked, true);
  assert.equal(payload.published, false);
  assert.equal(payload.external_action_taken, false);
  assert.equal('capability' in payload, false, 'capability stripped from the deny payload');
  assert.equal('nested' in payload, false, 'non-primitive extras dropped');
  assert.equal(payload.platform, 'meta');
  assert.doesNotThrow(() => JSON.stringify(payload), 'deny payload stays serializable');

  // Same for the throwing guard's context.
  assert.throws(() => guard.assertAdvertisingProviderMutationAllowed({ op: 'x', capability: cap }), (err) => {
    assert.equal(err.code, 'advertising_provider_mutation_disabled');
    assert.equal('capability' in err.context, false);
    assert.equal(err.context.op, 'x');
    assert.doesNotThrow(() => JSON.stringify(err.context));
    return true;
  });
});

// ── Vault credential-REFERENCE boundary ─────────────────────────────────────

test('vault: the provider-draft boundary requires a real capability and a transaction client', async () => {
  const { cap, binding } = await mintFixture();
  const locked = lockedContextFrom(binding);
  const fn = () => 'reached';

  await rejectsWithCode(() => vault.withTenantMetaCredentialForProviderDraft(null,
    { capability: cap, lockedContext: locked, now: NOW }, fn), 'validation_failed', 'no client');
  await rejectsWithCode(() => vault.withTenantMetaCredentialForProviderDraft(fakeTxClient(),
    { capability: { ...binding }, lockedContext: locked, now: NOW }, fn),
  caps.CODES.INVALID, 'plain-object capability');
  await rejectsWithCode(() => vault.withTenantMetaCredentialForProviderDraft(fakeTxClient(),
    { capability: cap, lockedContext: { ...locked, tenant_id: 8 }, now: NOW }, fn),
  caps.CODES.CONTEXT_MISMATCH, 'mismatched locked context');
  await rejectsWithCode(() => vault.withTenantMetaCredentialForProviderDraft(fakeTxClient(),
    { capability: cap, lockedContext: locked, now: binding.expires_at_ms + 1 }, fn),
  caps.CODES.EXPIRED, 'expired capability');
  await rejectsWithCode(() => vault.withTenantMetaCredentialForProviderDraft(fakeTxClient(),
    { capability: cap, lockedContext: locked, now: NOW }, null), 'validation_failed', 'no callback');
});

test('vault: the boundary validates status, revocation, environment, version, account and owner', async () => {
  const { cap, binding } = await mintFixture();
  const locked = lockedContextFrom(binding);
  const opts = { capability: cap, lockedContext: locked, now: NOW };
  const fn = (ref) => ref;

  // Happy path — reference only.
  const ref = await vault.withTenantMetaCredentialForProviderDraft(fakeTxClient(), opts, fn);
  assert.equal(vault.isMetaProviderDraftCredentialReference(ref), true);
  assert.equal(ref.object_kind, vault.META_PROVIDER_DRAFT_REFERENCE_KIND);
  assert.equal(ref.credential_ref_id, 'tmcr_abc');
  assert.equal(ref.tenant_id, 7);
  assert.equal(ref.platform, 'meta');
  assert.equal(ref.environment, 'sandbox');
  assert.equal(ref.has_secret_access, false);
  assert.equal(Object.isFrozen(ref), true);
  // No secret and no account identifier on the reference, and it cannot be
  // serialized into a response or an audit row.
  assert.equal('account_fingerprint' in ref, false);
  assert.equal('access_token' in ref, false);
  assert.equal('ciphertext' in ref, false);
  assert.throws(() => JSON.stringify(ref), /not serializable/);
  assert.match(util.inspect(ref), /redacted/);

  const cases = [
    ['revoked row', { refRows: [credentialRefRow({ status: 'revoked', revoked_at: new Date().toISOString() })] }, 'missing_credentials'],
    ['revoked_at set', { refRows: [credentialRefRow({ revoked_at: new Date().toISOString() })] }, 'missing_credentials'],
    ['no row', { refRows: [] }, 'missing_credentials'],
    ['ambiguous rows', { refRows: [credentialRefRow(), credentialRefRow({ id: 'tmcr_other' })] }, 'validation_failed'],
    ['production environment', { refRows: [credentialRefRow({ environment: 'production' })] }, 'validation_failed'],
    ['wrong platform', { refRows: [credentialRefRow({ platform: 'google' })] }, 'validation_failed'],
    ['bad fingerprint', { refRows: [credentialRefRow({ account_fingerprint: 'nope' })] }, 'validation_failed'],
    ['inactive member', { member: false }, 'permission_denied'],
    ['owner mismatch', { refRows: [credentialRefRow({ owner_user_id: 99 })] }, 'permission_denied'],
    ['version drift', { refRows: [credentialRefRow({ version: 2 })] }, caps.CODES.CONTEXT_MISMATCH],
    ['account swap', { refRows: [credentialRefRow({ account_fingerprint: '3'.repeat(64) })] }, caps.CODES.CONTEXT_MISMATCH],
    ['id swap', { refRows: [credentialRefRow({ id: 'tmcr_other' })] }, caps.CODES.CONTEXT_MISMATCH],
  ];
  for (const [label, clientOpts, code] of cases) {
    const fresh = await mintFixture();
    await rejectsWithCode(() => vault.withTenantMetaCredentialForProviderDraft(
      fakeTxClient(clientOpts),
      { capability: fresh.cap, lockedContext: lockedContextFrom(fresh.binding), now: NOW },
      fn
    ), code, label);
  }

  // The boundary does not spend the capability's single use.
  const keep = await mintFixture();
  const keepLocked = lockedContextFrom(keep.binding);
  await vault.withTenantMetaCredentialForProviderDraft(fakeTxClient(),
    { capability: keep.cap, lockedContext: keepLocked, now: NOW }, fn);
  assert.equal((await caps.assertMetaCreateProviderDraftCapability(
    keep.cap,
    keepLocked,
    { now: NOW }
  )).tenant_id, 7);
});

test('vault: the confirmation-time resolver binds a reference without a capability or a secret', async () => {
  const client = fakeTxClient();
  const bound = await vault.resolveTenantMetaCredentialRefForProviderDraft(client, {
    tenantId: 7, ownerUserId: 12,
  });
  assert.equal(bound.credential_ref_id, 'tmcr_abc');
  assert.equal(bound.credential_ref_version, 1);
  assert.equal(bound.account_fingerprint, FINGERPRINT);
  assert.equal(bound.environment, 'sandbox');
  assert.equal(vault.isMetaProviderDraftCredentialReference(bound.reference), true);

  // Row selection is locked, tenant-scoped, owner-scoped and sandbox-only.
  const refQuery = client.calls.find((c) => c.sql.includes(vault.META_PROVIDER_DRAFT_TABLE));
  assert.ok(refQuery, 'reference row was read');
  assert.match(refQuery.sql, /FOR UPDATE/);
  assert.match(refQuery.sql, /tenant_id=\$1/);
  assert.match(refQuery.sql, /owner_user_id=\$3/);
  assert.match(refQuery.sql, /status='active'/);
  assert.match(refQuery.sql, /revoked_at IS NULL/);
  assert.deepEqual(refQuery.params[3], ['test', 'sandbox']);
  for (const banned of ['ciphertext', 'iv', 'tag', 'access_token', 'refresh_token', 'user_integrations']) {
    assert.doesNotMatch(refQuery.sql, new RegExp(`\\b${banned}\\b`), `${banned} must not be selected`);
  }

  await rejectsWithCode(() => vault.resolveTenantMetaCredentialRefForProviderDraft(client, { tenantId: 0, ownerUserId: 12 }),
    'validation_failed', 'bad tenant');
  await rejectsWithCode(() => vault.resolveTenantMetaCredentialRefForProviderDraft(
    fakeTxClient({ member: false }), { tenantId: 7, ownerUserId: 12 }),
  'permission_denied', 'inactive member');
});

test('vault: the provider-draft boundary source reads no secret material', () => {
  const src = fs.readFileSync(path.join(ROOT, 'services/credentials/vault.js'), 'utf8');
  const start = src.indexOf('Meta provider-draft credential REFERENCE boundary');
  const end = src.indexOf('End PR 6F-0 reference boundary', start);
  assert.ok(start > 0 && end > start, 'boundary section is delimited');
  // Strip comment lines — the section's own prose names what it must never do.
  const section = src.slice(start, end)
    .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  for (const banned of ['_decrypt(', '_encrypt(', 'getCredentials(', 'resolveMetaAdsCredentials(',
    'user_integrations', 'platform_api_keys', 'kvGet', 'kvSet', 'access_token', 'refresh_token']) {
    assert.equal(section.includes(banned), false, `${banned} must not appear in the reference boundary`);
  }
  assert.doesNotMatch(section, /\bfetch\s*\(/);
  assert.equal(vault.META_PROVIDER_DRAFT_ENVIRONMENTS.includes('production'), false);
  assert.deepEqual(vault.META_PROVIDER_DRAFT_ENVIRONMENTS.slice(), ['test', 'sandbox']);
  for (const col of vault.META_PROVIDER_DRAFT_REF_COLUMNS) {
    assert.doesNotMatch(col, /ciphertext|iv|tag|token|secret/, `${col} is not a metadata column`);
  }
});

// ── Least-privilege permission + exact matrix coverage ──────────────────────

test('permission: advertising.provider_drafts.create is a least-privilege tenant key', () => {
  assert.equal(isValidPermission(PERMISSION_KEY), true);
  const row = PERMISSIONS.find((p) => p.key === PERMISSION_KEY);
  assert.equal(row.scope, 'tenant', 'never platform-scope');
  assert.ok(row.label, 'needs a human label for access reviews');
  assert.equal(/\.view$/.test(PERMISSION_KEY), false, 'not a view key — read-only roles must not inherit it');

  const held = (roleKey) => new Set(SYSTEM_ROLES.find((r) => r.key === roleKey).permissions);
  for (const roleKey of ['tenant_owner', 'tenant_admin', 'platform_owner', 'platform_admin']) {
    assert.equal(held(roleKey).has(PERMISSION_KEY), true, `${roleKey} must hold ${PERMISSION_KEY}`);
  }
  for (const roleKey of ['marketer', 'analyst', 'content_creator', 'client_viewer']) {
    assert.equal(held(roleKey).has(PERMISSION_KEY), false,
      `${roleKey} must NOT hold ${PERMISSION_KEY} — workflow authoring never implies provider authority`);
  }
  // Separation of duty: the publishing gate approval is not the provider key.
  const marketer = held('marketer');
  assert.equal(marketer.has('orchestrator.workflows.view'), true);
  assert.equal(marketer.has(PERMISSION_KEY), false);
});

test('matrix: every mounted confirm surface resolves to the provider-draft key exactly', () => {
  assert.deepEqual(matrix.validate(), [], 'matrix references only catalog keys');

  const CONFIRM_PREFIXES = [
    '/api/agent-orchestrator/campaign-drafts/provider-draft-confirmation-challenge',
    '/api/agent-orchestrator/campaign-drafts/confirm-provider-draft',
    '/api/agent-orchestrator/campaign-drafts/execute-provider-draft',
  ];

  // EVERY verb on the confirm surface — at the prefix itself and at any depth
  // beneath it — must land on the provider-draft key. `view` carries the same
  // key as `write` so that a GET added under either prefix later fails closed
  // instead of inheriting the coarse campaign-drafts workflow key.
  for (const prefix of CONFIRM_PREFIXES) {
    const paths = [
      prefix,
      `${prefix}/cd_1`,
      `${prefix}/cd_1/publishing-requests/cpr_1/delivery-intents/cdi_1`,
      `${prefix}/cd_1/publishing-requests/cpr_1/delivery-intents/cdi_1/anything-later`,
    ];
    for (const p of paths) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'GET', 'HEAD', 'OPTIONS']) {
        assert.equal(matrix.requiredPermissionForRequest(p, method).permission, PERMISSION_KEY,
          `${method} ${p}`);
      }
    }
  }

  // The key must be out of reach for every role that can author or approve a
  // workflow but has no provider authority — on every verb, not just writes.
  for (const roleKey of ['analyst', 'marketer', 'content_creator', 'client_viewer']) {
    const held = new Set(SYSTEM_ROLES.find((r) => r.key === roleKey).permissions);
    for (const prefix of CONFIRM_PREFIXES) {
      for (const method of ['POST', 'GET']) {
        const required = matrix.requiredPermissionForRequest(prefix, method).permission;
        assert.equal(held.has(required), false, `${roleKey} must not reach ${method} ${prefix}`);
      }
    }
  }

  // Existing rows are untouched.
  assert.equal(matrix.requiredPermissionForRequest('/api/agent-orchestrator/campaign-drafts', 'POST').permission,
    'orchestrator.workflows.view');
  assert.equal(matrix.requiredPermissionForRequest('/api/agent-orchestrator/campaign-drafts/cd_1/approve', 'POST').permission,
    'orchestrator.workflows.view');
  assert.equal(matrix.requiredPermissionForRequest('/api/agent-orchestrator/campaign-drafts/cd_1/publishing-requests', 'POST').permission,
    'orchestrator.workflows.view');
  assert.equal(matrix.requiredPermissionForRequest('/api/agent-orchestrator/state', 'GET').permission,
    'brand.calendar.view');
  assert.equal(matrix.requiredPermissionForRequest('/api/optimizer/dry-run', 'POST').permission,
    'grow.optimizer.control');
  assert.equal(matrix.requiredPermissionForRequest('/api/totally-made-up', 'GET').matched, false);
});

test('matrix: the confirm surface is not exempted from the legacy owner gate', () => {
  // /api/agent-orchestrator/campaign-drafts is deliberately absent from
  // _OWNER_GATE_ALLOW, so a non-owner is refused `owner_only` before the matrix
  // is consulted. Exempting it would make the matrix row plus the handler key
  // the SOLE gate on a provider-touching action — a change to the enforcement
  // stack that must be reviewed in docs/security-guardrails.md, not slipped in
  // as a routing tweak. Fail here until that review happens.
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const start = server.indexOf('_OWNER_GATE_ALLOW');
  assert.ok(start > 0, '_OWNER_GATE_ALLOW must be locatable');
  const allow = server.slice(start, server.indexOf('];', start));

  assert.doesNotMatch(allow, /campaign-drafts/,
    'campaign-drafts must stay owner-gated, or the PR 6F-0 confirm surface loses a gate');
  assert.doesNotMatch(allow, /confirm-provider-draft|provider-draft-confirmation-challenge/,
    'the provider-draft confirm surface must not be individually owner-gate exempt');
  // Sanity: the exemptions that DO exist are still the two reviewed ones, so
  // this test is reading the real list rather than an empty slice.
  assert.match(allow, /agent-orchestrator\\\/workflows/);
  assert.match(allow, /agent-orchestrator\\\/credits/);
});

test('matrix: no provider-draft route hides its action segment behind a variable id', () => {
  // The matrix gates by prefix only. A route whose action segment sits *behind*
  // a path parameter (…/campaign-drafts/:id/…/confirm-provider-draft) matches no
  // row of its own and silently inherits the coarse campaign-drafts row, i.e.
  // orchestrator.workflows.view — a privilege regression a Marketer could ride.
  // Registering such a route must fail here rather than ship ungated.
  const src = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_api.js'), 'utf8');
  const registrations = [...src.matchAll(/router\.(?:post|put|patch|delete)\(\s*\n?\s*'([^']+)'/g)]
    .map((m) => m[1]);
  assert.ok(registrations.length > 0, 'route registrations must be discoverable');

  const ACTIONS = /(provider-draft|provider-challenge)/;
  const matched = registrations.filter((r) => ACTIONS.test(r));
  assert.equal(matched.length, 3,
    `expected exactly the challenge, confirm and execute routes, got: ${matched.join(', ')}`);

  for (const route of matched) {
    const segments = route.split('/').filter(Boolean);
    const actionAt = segments.findIndex((s) => ACTIONS.test(s));
    const firstParamAt = segments.findIndex((s) => s.startsWith(':'));
    assert.ok(
      firstParamAt === -1 || actionAt < firstParamAt,
      `route "${route}" puts its provider-draft action behind a path parameter, so no `
      + 'permission-matrix prefix can gate it. Move the action segment ahead of the ids '
      + 'or give the surface its own mount prefix.',
    );

    // The literal prefix in front of the first parameter is what the matrix
    // sees; it must resolve to the provider-draft key on every verb.
    const literal = segments.slice(0, firstParamAt === -1 ? segments.length : firstParamAt);
    const mounted = `/api/agent-orchestrator/campaign-drafts/${literal.join('/')}`;
    for (const method of ['POST', 'GET']) {
      assert.equal(matrix.requiredPermissionForRequest(mounted, method).permission, PERMISSION_KEY,
        `${method} ${mounted} (from route "${route}") is not gated on ${PERMISSION_KEY}`);
    }

    // The human-visible chain, and nothing else, may be named by the caller.
    const params = segments.filter((s) => s.startsWith(':'));
    assert.deepEqual(params, [':draftId', ':publishingRequestId', ':intentId'],
      `route "${route}" must name only the draft, publishing request and delivery intent`);
  }

  // The superseded aliases are gone, not merely unused.
  assert.doesNotMatch(src, /provider-challenges/,
    'the old /provider-challenges alias must be removed, not left mounted');
  assert.doesNotMatch(src, /attempts\/:attemptId/,
    'no route may take an attempt id from the client');
});

test('matrix: the confirm surface accepts no client-supplied capability or credential id', () => {
  // PR 6F-0 contract: the request may name the human-visible resource chain
  // only. Capability, outbox, credential and provider-account identifiers are
  // server-derived; accepting them from the client is a forgery surface.
  const src = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_api.js'), 'utf8');
  const start = src.indexOf("router.post(\n  '/provider-draft-confirmation-challenge");
  assert.ok(start > 0, 'provider-draft challenge route must be locatable');
  const end = src.indexOf("router.post('/:id/revoke'", start);
  assert.ok(end > start, 'confirm block must be bounded');
  const block = src.slice(start, end);

  // Server-derived: never accepted from the path, never read from the body.
  // `challenge_id` is deliberately absent from this list — the challenge is a
  // human-visible artifact issued to this actor, and the confirm step names it
  // in the body. It is validated against the locked graph by
  // confirmMatchesChallenge, so naming it grants nothing.
  const SERVER_DERIVED = [
    'capabilityId', 'capability_id', 'capability',
    'outboxId', 'outbox_id',
    'attemptId', 'attempt_id',
    'credentialId', 'credential_id', 'credentialRef', 'credential_ref',
    'accountId', 'account_id', 'adAccountId', 'ad_account_id',
    'claimToken', 'claim_token', 'generation',
  ];
  for (const name of SERVER_DERIVED) {
    assert.doesNotMatch(block, new RegExp(`req\\.params\\.${name}\\b`),
      `confirm surface must not read req.params.${name}`);
    assert.doesNotMatch(block, new RegExp(`:${name}\\b`),
      `confirm surface must not declare a :${name} path parameter`);
    assert.doesNotMatch(block, new RegExp(`body\\.${name}\\b`),
      `confirm surface must not read body.${name}`);
  }

  // The only path parameters either handler reads are the human-visible chain.
  const readParams = [...block.matchAll(/req\.params\.([A-Za-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(readParams)].sort(), ['draftId', 'intentId', 'publishingRequestId'],
    'the confirm surface reads a path parameter outside the approved chain');
  // No provider reach-out, no secret read, no capability minting from a handler.
  assert.doesNotMatch(block, /\bfetch\s*\(/);
  assert.doesNotMatch(block, /connectors\//);
  assert.doesNotMatch(block, /mintMetaCreateProviderDraftCapability/);
  assert.doesNotMatch(block, /withAdvertisingProviderExecutionTransaction/);
  assert.doesNotMatch(block, /getCredentials\s*\(/);
  assert.match(block, /published:\s*false/);
  assert.match(block, /external_action_taken:\s*false/);
  assert.match(block, /rejectApiKey:\s*true/);
});

test('confirmations: outbox, attempt and credential reference are all server-derived', () => {
  // The request names the draft, publishing request and delivery intent. Every
  // other identifier the confirmation binds to is derived from the locked graph,
  // so the confirming human cannot choose which attempt, outbox or credential
  // reference the confirmation attaches to.
  const src = fs.readFileSync(
    path.join(ROOT, 'services/agent_orchestrator/campaign_provider_confirmations.js'), 'utf8');
  const start = src.indexOf('async function loadAuthoritativeGraph');
  assert.ok(start > 0);
  const graph = src.slice(start, src.indexOf('function publicChallenge', start));

  // The graph is entered through the intent, which is the deepest id the caller
  // may name, and every named id must agree with the locked row.
  assert.match(graph, /lockIntent\(c,\s*o\.tenantId,\s*intentId\)/);
  assert.match(graph, /assertSame\(intent\.draft_id,\s*draftId/);
  assert.match(graph, /assertSame\(intent\.publishing_request_id,\s*publishingRequestId/);

  // Outbox derived from the intent; attempt derived from the outbox.
  assert.match(graph, /lockByTenantAndId\(c,\s*\{\s*tenantId:\s*o\.tenantId,\s*id:\s*intent\.outbox_id\s*\}\)/);
  assert.match(graph, /latestAttemptForOutbox\(c,\s*\{\s*tenantId:\s*o\.tenantId,\s*outboxId:\s*intent\.outbox_id\s*\}\)/);
  assert.doesNotMatch(graph, /lockAttempt\(/, 'no lookup keyed on a caller-named attempt id');
  assert.doesNotMatch(graph, /o\.attemptId|attemptId/, 'the graph must not read a caller attempt id');
  assert.doesNotMatch(graph, /o\.outboxId|o\.credentialRefId|o\.challengeId/);

  // The derived attempt is still fully cross-checked against the named chain.
  assert.match(graph, /assertSame\(attempt\.draft_id,\s*draftId/);
  assert.match(graph, /assertSame\(attempt\.publishing_request_id,\s*publishingRequestId/);
  assert.match(graph, /assertSame\(attempt\.intent_id,\s*intentId/);
  assert.match(graph, /assertSame\(intent\.outbox_id,\s*attempt\.outbox_id/);
  assert.match(graph, /assertSame\(intent\.intent_hash,\s*attempt\.intent_hash/);
  assert.match(graph, /attempt\.status !== 'started'/);
  assert.match(graph, /attempt\.published === true \|\| attempt\.external_action_taken === true/);

  // The lease must be live, judged on the DATABASE clock rather than the app's,
  // so a settled or abandoned attempt cannot be confirmed.
  assert.match(src, /SELECT clock_timestamp\(\) AS now/);
  assert.doesNotMatch(src, /const nowMs = Date\.now\(\)/);
  assert.match(src, /attempt\.lease_expires_at/);
  assert.match(src, /leaseMs <= nowMs/);
  assert.match(src, /fail\('lease_conflict'\)/);

  // The credential reference comes through the vault boundary, not a local
  // SELECT, so revocation/environment/version policy cannot drift.
  assert.match(graph, /resolveBoundCredentialRef\(c,\s*o\.tenantId,\s*o\.userId\)/);
  assert.match(src, /resolveTenantMetaCredentialRefForProviderDraft/);
  assert.doesNotMatch(src, /orchestrator_tenant_meta_credential_refs/,
    'the confirmation path must not query the credential-reference table directly');

  // Actor identity is re-derived from the bound approval, not from the request.
  assert.match(graph, /boundActorId\(pub\)/);
  assert.match(graph, /assertActiveMember\(c,\s*o\.tenantId,\s*o\.userId\)/);

  // No provider reach-out and no secret read while building the graph.
  assert.doesNotMatch(graph, /\bfetch\s*\(/);
  assert.doesNotMatch(graph, /getCredentials\s*\(/);
  assert.doesNotMatch(src, /_decrypt|access_token|refresh_token|vault_payload/);
});

test('confirmations: the public projections disclose no credential, hash or phrase material', () => {
  const confirmations = require('../services/agent_orchestrator/campaign_provider_confirmations');
  // A row carrying every sensitive column the tables can hold. Whatever the
  // projections copy out is what reaches an HTTP body.
  const row = {
    id: 'cpc_1', tenant_id: 7, challenge_id: 'cpc_1',
    draft_id: 'cd_1', publishing_request_id: 'cpr_1', intent_id: 'cdi_1',
    attempt_id: 'cda_1', status: 'open',
    contract_version: 'campaign_delivery_v1', operation: 'create_provider_draft',
    platform: 'meta', requested_by: 5,
    expires_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z',
    // None of the following may ever be projected.
    outbox_id: 'cdo_LEAK', credential_ref_id: 'cref_LEAK',
    publish_approval_id: 'cpa_LEAK', workflow_approval_id: 99, generation: 3,
    phrase_salt: 'a'.repeat(64), phrase_digest: 'b'.repeat(64),
    claim_token_hash: 'c'.repeat(64), contract_hash: 'd'.repeat(64),
    snapshot_hash: 'e'.repeat(64), intent_hash: 'f'.repeat(64),
    request_hash: '0'.repeat(64),
  };

  const FORBIDDEN_VALUES = [
    'cdo_LEAK', 'cref_LEAK', 'cpa_LEAK',
    'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64),
    'e'.repeat(64), 'f'.repeat(64), '0'.repeat(64),
  ];
  const FORBIDDEN_KEYS = [
    'outbox_id', 'credential_ref_id', 'publish_approval_id', 'workflow_approval_id',
    'generation', 'phrase_salt', 'phrase_digest', 'claim_token_hash',
    'contract_hash', 'snapshot_hash', 'intent_hash', 'request_hash',
  ];

  for (const [label, projected] of [
    ['publicChallenge', confirmations.publicChallenge(row)],
    ['publicConfirmation', confirmations.publicConfirmation(row)],
  ]) {
    const text = JSON.stringify(projected);
    for (const key of FORBIDDEN_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(projected, key), false,
        `${label} must not project ${key}`);
    }
    for (const value of FORBIDDEN_VALUES) {
      assert.doesNotMatch(text, new RegExp(value), `${label} leaked ${value}`);
    }
    assert.equal(projected.tenant_id, 7, `${label} keeps the tenant for client-side scoping`);
  }
});
