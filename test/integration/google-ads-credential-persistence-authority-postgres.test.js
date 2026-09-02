'use strict';

// Security regression: Google Ads credential persistence must revalidate the
// PINNED initiating tenant's authority (active tenant, active membership, an
// applicable tenant-local OR system role carrying tenant.integrations.manage)
// inside the same transaction that writes the vault row and the credential
// reference. A membership or permission revocation racing that write must never
// leave a credential without its reference, a reference without its credential,
// or a revoked-but-unreplaced reference.

// Blocker connections plus the in-flight save need more than the default dev
// pool of 5. Set before db.js lazily builds the pool.
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../db');
const schema = require('../../services/agent_orchestrator/schema');
const vault = require('../../services/credentials/vault');
const { makeFixtures } = require('../helpers');

const DENIED = /tenant\.integrations\.manage required/;

// The reference table is append-then-revoke only: a row trigger rejects DELETE.
// Fixture teardown is the one place allowed to bypass it.
async function replica(sql, params = []) {
  const client = await db.getPool().connect();
  try {
    await client.query("SET session_replication_role='replica'");
    return await client.query(sql, params);
  } finally {
    await client.query("SET session_replication_role='origin'");
    client.release();
  }
}

async function waitUntilBlockedOnLock(match, { timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = await db.getPool().query(
      `SELECT pid FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [match]
    );
    if (waiting.rowCount > 0) return waiting.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting for a lock wait matching ${match}`);
}

if (!db.hasDb()) {
  test('Google Ads credential persistence authority requires DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else test('Google Ads credential persistence revalidates pinned tenant authority under PostgreSQL concurrency', async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await schema.ensureAgentOrchestratorSchema();
  const pool = db.getPool();
  const tag = crypto.randomBytes(4).toString('hex');

  const tenant = await fx.seedTenant('GA credential authority');
  const otherTenant = await fx.seedTenant('GA credential authority other');
  const ownerUser = await fx.seedUser({ tenantId: tenant.id, owner: true });                 // tenant_owner
  const rotationUser = await fx.seedUser({ tenantId: tenant.id, roleKey: 'tenant_admin' });  // tenant_admin
  const customUser = await fx.seedUser({ tenantId: tenant.id });
  const raceUser = await fx.seedUser({ tenantId: tenant.id, roleKey: 'tenant_admin' });
  const viewerUser = await fx.seedUser({ tenantId: tenant.id });                             // client_viewer
  const wrongRoleUser = await fx.seedUser({ tenantId: tenant.id });
  const outsiderUser = await fx.seedUser({ tenantId: otherTenant.id, owner: true });
  const tenantIds = [tenant.id, otherTenant.id];
  const userIds = [ownerUser, rotationUser, customUser, raceUser, viewerUser, wrongRoleUser, outsiderUser]
    .map((u) => u.id);

  // Every blocker is registered so a failed assertion cannot strand an open
  // transaction and turn a test failure into a teardown hang.
  const openBlockers = new Set();
  async function blocker() {
    const client = await pool.connect();
    openBlockers.add(client);
    await client.query('BEGIN');
    return {
      query: (sql, params) => client.query(sql, params),
      finish: async (verb) => {
        openBlockers.delete(client);
        try { await client.query(verb); } finally { client.release(); }
      },
    };
  }
  // Nothing here may hang teardown either; the tracked promises are already
  // settled or abandoned by the time cleanup runs.
  const inFlight = (promise) => { promise.catch(() => {}); return promise; };

  t.after(async () => {
    for (const client of openBlockers) {
      try { await client.query('ROLLBACK'); } catch (_e) { /* already gone */ }
      client.release();
    }
    openBlockers.clear();
    await replica('DELETE FROM orchestrator_tenant_google_ads_credential_refs WHERE tenant_id = ANY($1)', [tenantIds])
      .catch(() => {});
    await pool.query('DELETE FROM user_integrations WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    await pool.query("UPDATE tenants SET status='active' WHERE id = ANY($1)", [tenantIds]).catch(() => {});
    await fx.cleanup();
  });

  // A tenant-local custom role carrying only the integrations permission, and a
  // role that carries it in the WRONG tenant.
  const localRole = (await pool.query(
    `INSERT INTO roles(tenant_id,key,name,permissions) VALUES($1,$2,'GA local',$3::jsonb) RETURNING id`,
    [tenant.id, `ga-local-${tag}`, JSON.stringify(['tenant.integrations.manage'])]
  )).rows[0].id;
  const foreignRole = (await pool.query(
    `INSERT INTO roles(tenant_id,key,name,permissions) VALUES($1,$2,'GA foreign',$3::jsonb) RETURNING id`,
    [otherTenant.id, `ga-foreign-${tag}`, JSON.stringify(['tenant.integrations.manage'])]
  )).rows[0].id;
  await pool.query('UPDATE tenant_users SET role_id=$1 WHERE tenant_id=$2 AND user_id=$3',
    [localRole, tenant.id, customUser.id]);
  await pool.query('UPDATE tenant_users SET role_id=$1 WHERE tenant_id=$2 AND user_id=$3',
    [foreignRole, tenant.id, wrongRoleUser.id]);

  const customerIds = {
    owner: '1000000001', rotation: '1000000002', custom: '1000000003',
    race: '1000000004', viewer: '1000000005', wrongRole: '1000000006', outsider: '1000000007',
  };
  const save = (user, customerId, tenantId) => vault.saveCredentials(
    user.id, 'google_ads', { refreshToken: `rt-${tag}`, customerId }, { tenantId }
  );
  const integration = async (userId) => (await pool.query(
    `SELECT credential_version, status, encode(ciphertext,'hex') AS ciphertext
       FROM user_integrations WHERE user_id=$1 AND platform='google_ads'`, [userId]
  )).rows;
  const refs = async (userId) => (await pool.query(
    `SELECT tenant_id, id, version, status, revoked_at FROM orchestrator_tenant_google_ads_credential_refs
      WHERE owner_user_id=$1 ORDER BY version`, [userId]
  )).rows;

  // ── Authorized: system roles and an applicable tenant-local custom role ────
  for (const [user, customerId, label] of [
    [ownerUser, customerIds.owner, 'tenant_owner'],
    [rotationUser, customerIds.rotation, 'tenant_admin'],
    [customUser, customerIds.custom, 'custom tenant-local role'],
  ]) {
    const saved = await save(user, customerId, tenant.id);
    assert.deepEqual(saved, { ok: true, version: 1, referenceId: `google_ads_${user.id}_1` }, label);
    assert.equal((await integration(user.id)).length, 1, label);
    assert.deepEqual((await refs(user.id)).map((r) => [r.tenant_id, r.version, r.status, r.revoked_at]),
      [[tenant.id, 1, 'active', null]], label);
  }

  // ── Fail closed: no permission, wrong-tenant role, non-member, revoked
  //    membership, suspended tenant. None may write anything. ────────────────
  await pool.query("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2",
    [otherTenant.id, outsiderUser.id]);
  await pool.query("UPDATE tenants SET status='suspended' WHERE id=$1", [otherTenant.id]);
  const denials = [
    [viewerUser, customerIds.viewer, tenant.id, 'permission denied'],
    [wrongRoleUser, customerIds.wrongRole, tenant.id, 'wrong-tenant custom role'],
    [outsiderUser, customerIds.outsider, tenant.id, 'not a member of the pinned tenant'],
    [outsiderUser, customerIds.outsider, otherTenant.id, 'revoked membership in a suspended tenant'],
  ];
  for (const [user, customerId, tenantId, label] of denials) {
    await assert.rejects(save(user, customerId, tenantId), DENIED, label);
    assert.deepEqual(await integration(user.id), [], `${label}: no credential`);
    assert.deepEqual(await refs(user.id), [], `${label}: no reference`);
  }
  await pool.query("UPDATE tenants SET status='active' WHERE id=$1", [otherTenant.id]);
  await pool.query("UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2",
    [otherTenant.id, outsiderUser.id]);

  // ── Race 1: membership revocation commits while the save waits on the
  //    authority lock. The save must fail closed with nothing persisted. ─────
  const membershipBlocker = await blocker();
  await membershipBlocker.query("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2",
    [tenant.id, raceUser.id]);
  const racedMembershipSave = inFlight(save(raceUser, customerIds.race, tenant.id));
  await waitUntilBlockedOnLock('%FOR UPDATE OF t, tu, r%');
  await membershipBlocker.finish('COMMIT');
  await assert.rejects(racedMembershipSave, DENIED, 'membership revocation race');
  assert.deepEqual(await integration(raceUser.id), [], 'membership race left no credential');
  assert.deepEqual(await refs(raceUser.id), [], 'membership race left no reference');

  // ── Race 2: the role's permission is stripped while the save waits. Locking
  //    tenant_users alone would not catch this. ──────────────────────────────
  const permissionRaceUser = await fx.seedUser({ tenantId: tenant.id });
  userIds.push(permissionRaceUser.id);
  await pool.query('UPDATE tenant_users SET role_id=$1 WHERE tenant_id=$2 AND user_id=$3',
    [localRole, tenant.id, permissionRaceUser.id]);
  const permissionBlocker = await blocker();
  await permissionBlocker.query(`UPDATE roles SET permissions='[]'::jsonb WHERE id=$1`, [localRole]);
  const racedPermissionSave = inFlight(save(permissionRaceUser, '1000000008', tenant.id));
  await waitUntilBlockedOnLock('%FOR UPDATE OF t, tu, r%');
  await permissionBlocker.finish('COMMIT');
  await assert.rejects(racedPermissionSave, DENIED, 'permission revocation race');
  assert.deepEqual(await integration(permissionRaceUser.id), [], 'permission race left no credential');
  assert.deepEqual(await refs(permissionRaceUser.id), [], 'permission race left no reference');

  // ── Race 3: revocation racing a ROTATION must not tear the existing pair —
  //    no version bump, no revoked-but-unreplaced reference. ────────────────
  const before = await integration(rotationUser.id);
  const rotationBlocker = await blocker();
  await rotationBlocker.query("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2",
    [tenant.id, rotationUser.id]);
  const racedRotation = inFlight(save(rotationUser, customerIds.rotation, tenant.id));
  await waitUntilBlockedOnLock('%FOR UPDATE OF t, tu, r%');
  await rotationBlocker.finish('COMMIT');
  await assert.rejects(racedRotation, DENIED, 'rotation revocation race');
  assert.deepEqual(await integration(rotationUser.id), before, 'rotation race left the credential untouched');
  assert.deepEqual((await refs(rotationUser.id)).map((r) => [r.version, r.status, r.revoked_at]),
    [[1, 'active', null]], 'rotation race left the reference untouched');

  // ── Race 4: the opposite order. A save that already holds the authority
  //    locks blocks the revocation until it commits, and commits a complete
  //    credential + reference pair. ─────────────────────────────────────────
  const credentialBlocker = await blocker();
  await credentialBlocker.query(
    `SELECT 1 FROM user_integrations WHERE user_id=$1 AND platform='google_ads' FOR UPDATE`, [ownerUser.id]);
  const winningSave = inFlight(save(ownerUser, customerIds.owner, tenant.id));
  await waitUntilBlockedOnLock('%INSERT INTO user_integrations%');
  const lateRevocation = inFlight(pool.query(
    "UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2", [tenant.id, ownerUser.id]));
  await waitUntilBlockedOnLock('%UPDATE tenant_users SET status=%');
  await credentialBlocker.finish('COMMIT');
  assert.deepEqual(await winningSave, { ok: true, version: 2, referenceId: `google_ads_${ownerUser.id}_2` },
    'save holding the authority locks commits');
  await lateRevocation;
  assert.equal((await integration(ownerUser.id))[0].credential_version, 2);
  const ownerRefs = await refs(ownerUser.id);
  assert.deepEqual(ownerRefs.map((r) => [r.version, r.status]), [[1, 'revoked'], [2, 'active']],
    'exactly one active reference matches the committed credential version');
  assert.ok(ownerRefs[0].revoked_at instanceof Date);
  // The revocation that queued behind the save now applies, so the next save fails closed.
  await assert.rejects(save(ownerUser, customerIds.owner, tenant.id), DENIED, 'post-revocation save');
  assert.equal((await integration(ownerUser.id))[0].credential_version, 2, 'denied save bumped no version');
  assert.deepEqual((await refs(ownerUser.id)).map((r) => [r.version, r.status]), [[1, 'revoked'], [2, 'active']],
    'denied save left the reference set unchanged');
});
