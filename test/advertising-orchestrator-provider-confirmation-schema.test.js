'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');
const h = require('./helpers/pr6f0SchemaDb');

const HAS_DB = db.hasDb();
const { nid, hx, S } = h.ids('ao6f0');

test('PR6F-0 CREATE TABLE is tenant-leading, digest-only, TTL-capped, and omits secrets', () => {
  const src = h.src();
  for (const t of h.TABLES) {
    assert.match(src, new RegExp(`'${t}'`));
    assert.match(src, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`));
  }
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_provider_challenges'/);
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_provider_confirmations'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_provider_challenges'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_provider_confirmations'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_tenant_meta_credential_refs'/);

  const sb = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_sandbox_outcomes');
  const ci = src.indexOf(`CREATE TABLE IF NOT EXISTS ${h.CRED}`);
  const hi = src.indexOf(`CREATE TABLE IF NOT EXISTS ${h.CHAL}`);
  const fi = src.indexOf(`CREATE TABLE IF NOT EXISTS ${h.CONF}`);
  assert.ok(sb >= 0 && ci > sb);
  assert.ok(hi > ci && fi > hi);

  const block = src.slice(src.indexOf('const ADVERTISING_ORCH_TABLES'), src.indexOf('];', src.indexOf('const ADVERTISING_ORCH_TABLES')) + 2);
  assert.ok(block.indexOf(`'${h.CRED}'`) >= 0);
  assert.ok(block.indexOf(`'${h.CHAL}'`) > block.indexOf(`'${h.CRED}'`));
  assert.ok(block.indexOf(`'${h.CONF}'`) > block.indexOf(`'${h.CHAL}'`));

  const cred = h.createTable(src, h.CRED);
  assert.match(cred, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(cred, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(cred, /UNIQUE \(tenant_id, account_fingerprint, version\)/);
  assert.match(cred, /platform TEXT NOT NULL DEFAULT 'meta'/);
  assert.match(cred, /CHECK \(platform = 'meta'\)/);
  assert.match(cred, /environment IN \('test','sandbox'\)/);
  assert.match(cred, /status IN \('active','revoked'\)/);
  assert.doesNotMatch(cred, h.FORBIDDEN_SECRET_RE);
  assert.doesNotMatch(cred, /\bconfirmation_phrase\b/);
  for (const col of ['ciphertext', 'access_token', 'refresh_token', 'credential_ref', 'provider_id', 'ad_account_id']) {
    assert.doesNotMatch(cred, new RegExp(`\\b${col}\\b`), `${h.CRED} must not declare ${col}`);
  }

  const chal = h.createTable(src, h.CHAL);
  assert.match(chal, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(chal, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(chal, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(chal, /UNIQUE \(tenant_id, attempt_id\)/);
  assert.match(chal, /INTERVAL '5 minutes'/);
  assert.match(chal, /phrase_salt TEXT NOT NULL/);
  assert.doesNotMatch(chal, /phrase_digest/);
  assert.doesNotMatch(chal, /\bconfirmation_phrase\b/);
  assert.doesNotMatch(chal, /\bprovider_id\b/);
  assert.doesNotMatch(chal, h.FORBIDDEN_SECRET_RE);
  for (const col of h.FORBIDDEN_COLUMNS) assert.doesNotMatch(chal, new RegExp(`\\b${col}\\b`, 'i'), `${h.CHAL} ${col}`);

  const conf = h.createTable(src, h.CONF);
  assert.match(conf, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(conf, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(conf, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(conf, /UNIQUE \(tenant_id, challenge_id\)/);
  assert.match(conf, /UNIQUE \(tenant_id, attempt_id\)/);
  assert.match(conf, /INTERVAL '2 minutes'/);
  assert.match(conf, /phrase_salt TEXT NOT NULL/);
  assert.match(conf, /phrase_digest TEXT NOT NULL/);
  assert.doesNotMatch(conf, /\bconfirmation_phrase\b/);
  assert.doesNotMatch(conf, h.FORBIDDEN_SECRET_RE);
  for (const col of h.FORBIDDEN_COLUMNS) assert.doesNotMatch(conf, new RegExp(`\\b${col}\\b`, 'i'), `${h.CONF} ${col}`);

  for (const name of new Set(src.match(/orchestrator_(tmcr|cpc|cpcf)_[a-z0-9_]+|idx_(tmcr|cpc|cpcf)_[a-z0-9_]+|orchestrator_campaign_provider_(challenges|confirmations)_[a-z0-9_]+|orchestrator_tenant_meta_credential_refs_[a-z0-9_]+/g) || [])) {
    assert.ok(name.length <= 63, name);
  }

  const tmcr = h.fnBody(src, 'orchestrator_tmcr_guard');
  assert.match(tmcr, /TG_OP = 'UPDATE'/);
  assert.match(tmcr, /NEW\.status IS DISTINCT FROM 'revoked'/);
  assert.match(tmcr, /RAISE EXCEPTION 'orchestrator_tmcr_immutable'/);
  assert.match(src, /BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_tenant_meta_credential_refs/);

  const cpc = h.fnBody(src, 'orchestrator_cpc_guard');
  assert.match(cpc, /NEW\.status IS DISTINCT FROM 'consumed'/);
  assert.match(cpc, /RAISE EXCEPTION 'orchestrator_cpc_immutable'/);
  assert.match(cpc, /RAISE EXCEPTION 'orchestrator_cpc_binding'/);
  assert.match(src, /BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_challenges/);

  const cpcf = h.fnBody(src, 'orchestrator_cpcf_guard');
  assert.match(cpcf, /NEW\.status IS DISTINCT FROM 'spent'/);
  assert.match(cpcf, /RAISE EXCEPTION 'orchestrator_cpcf_immutable'/);
  assert.match(cpcf, /RAISE EXCEPTION 'orchestrator_cpcf_binding'/);
  assert.match(src, /BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_confirmations/);

  for (const name of [
    'orchestrator_cpc_tenant_draft_fkey', 'orchestrator_cpc_tenant_rev_fkey',
    'orchestrator_cpc_tenant_pub_appr_fkey', 'orchestrator_cpc_tenant_wf_appr_fkey',
    'orchestrator_cpc_tenant_pub_req_fkey', 'orchestrator_cpc_tenant_intent_fkey',
    'orchestrator_cpc_tenant_outbox_fkey', 'orchestrator_cpc_tenant_attempt_fkey',
    'orchestrator_cpc_tenant_attempt_bind_fkey', 'orchestrator_cpc_tenant_cred_ref_fkey',
    'orchestrator_cda_tenant_unique_id_bind',
  ]) assert.match(src, new RegExp(name));
  assert.doesNotMatch(src, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_objects/);
  assert.doesNotMatch(src, /provider_object_ledger/);
});

test('PR6F-0 challenge and confirmation trigger DDL never share one _installInTransaction', () => {
  const src = h.src();
  const blobs = h.installSqlBlobs(src);
  const iCpc = blobs.findIndex((s) => /CREATE\s+TRIGGER\s+orchestrator_cpc_guard\b/.test(s));
  const iCpcf = blobs.findIndex((s) => /CREATE\s+TRIGGER\s+orchestrator_cpcf_guard\b/.test(s));
  assert.ok(iCpc >= 0 && iCpcf >= 0 && iCpc < iCpcf);
  assert.notStrictEqual(iCpc, iCpcf);
  assert.ok(h.triggerOn(blobs[iCpc], h.CHAL));
  assert.ok(h.triggerOn(blobs[iCpcf], h.CONF));
  assert.ok(!h.triggerOn(blobs[iCpc], h.CONF));
  assert.ok(!h.triggerOn(blobs[iCpcf], h.CHAL));
  assert.match(blobs[iCpc], /DROP TRIGGER IF EXISTS orchestrator_cpc_guard ON orchestrator_campaign_provider_challenges/);
  assert.match(blobs[iCpc], /CREATE TRIGGER orchestrator_cpc_guard[\s\S]*ON orchestrator_campaign_provider_challenges/);
  assert.match(blobs[iCpcf], /DROP TRIGGER IF EXISTS orchestrator_cpcf_guard ON orchestrator_campaign_provider_confirmations/);
  assert.match(blobs[iCpcf], /CREATE TRIGGER orchestrator_cpcf_guard[\s\S]*ON orchestrator_campaign_provider_confirmations/);
  for (const sql of blobs) {
    assert.ok(
      !(h.triggerOn(sql, h.CHAL) && h.triggerOn(sql, h.CONF)),
      'challenge and confirmation trigger DDL must not share one _installInTransaction'
    );
  }
});

if (!HAS_DB) {
  test('advertising-orchestrator provider-confirmation schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA, tenantB, hostA, hostB, userId;

  before(async () => {
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      'INSERT INTO tenants (name,slug,status) VALUES ($1,$2,$3) RETURNING id', [label, slug, 'active']
    )).rows[0].id;
    tenantA = await mk(`AO6F0 A ${S}`, `ao6f0-a-${S}`);
    tenantB = await mk(`AO6F0 B ${S}`, `ao6f0-b-${S}`);
    hostA = await h.host(p, tenantA, nid);
    hostB = await h.host(p, tenantB, nid);
    userId = (await p.query(
      'INSERT INTO users (email,password_hash,name) VALUES ($1,$2,$3) RETURNING id',
      [`pr6f0-${S}@example.test`, 'x', 'pr6f0']
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query('DELETE FROM tenants WHERE id = ANY($1)', [ids]);
    if (userId) await p.query('DELETE FROM users WHERE id=$1', [userId]);
  });

  test('PR6F-0 tables exist with tenant-leading PK, required columns, and no secret surfaces', async () => {
    const present = (await db.getPool().query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name = ANY($2)',
      ['public', h.TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...h.TABLES].sort());
    for (const t of h.TABLES) await h.assertShape(t);
  });

  test('named uniques and tenant-scoped FKs lead with tenant_id', async () => {
    const credKeys = await h.pkUniq(h.CRED);
    assert.ok(credKeys.some((c) => c.constraint_name === 'orchestrator_tmcr_tenant_unique_fp_ver'
      && c.cols === 'tenant_id,account_fingerprint,version'));
    const chalKeys = await h.pkUniq(h.CHAL);
    assert.ok(chalKeys.some((c) => c.constraint_name === 'orchestrator_cpc_tenant_unique_idemp' && c.cols === 'tenant_id,idempotency_key'));
    assert.ok(chalKeys.some((c) => c.constraint_name === 'orchestrator_cpc_tenant_unique_attempt' && c.cols === 'tenant_id,attempt_id'));
    const confKeys = await h.pkUniq(h.CONF);
    assert.ok(confKeys.some((c) => c.constraint_name === 'orchestrator_cpcf_tenant_unique_idemp' && c.cols === 'tenant_id,idempotency_key'));
    assert.ok(confKeys.some((c) => c.constraint_name === 'orchestrator_cpcf_tenant_unique_challenge' && c.cols === 'tenant_id,challenge_id'));
    assert.ok(confKeys.some((c) => c.constraint_name === 'orchestrator_cpcf_tenant_unique_attempt' && c.cols === 'tenant_id,attempt_id'));
    const attKeys = await h.pkUniq('orchestrator_campaign_delivery_attempts');
    assert.ok(attKeys.some((c) => c.constraint_name === 'orchestrator_cda_tenant_unique_id_bind'
      && c.cols === 'tenant_id,id,outbox_id,intent_id'));

    const chalFks = await h.fks(h.CHAL);
    for (const row of h.CHAL_FKS) h.assertFk(chalFks, ...row);
    const wfFk = chalFks.find((f) => f.conname === 'orchestrator_cpc_tenant_wf_appr_fkey');
    assert.ok(wfFk);
    assert.strictEqual(wfFk.deltype, 'a');
    assert.strictEqual(wfFk.deferrable, true);
    const obFk = chalFks.find((f) => f.conname === 'orchestrator_cpc_tenant_outbox_fkey');
    assert.ok(obFk);
    assert.strictEqual(obFk.ref_table, 'orchestrator_outbox');
    assert.strictEqual(obFk.deltype, 'a');
    assert.strictEqual(obFk.deferrable, true);

    const confFks = await h.fks(h.CONF);
    const chRef = confFks.find((f) => f.conname === 'orchestrator_cpcf_tenant_challenge_fkey');
    assert.ok(chRef);
    assert.strictEqual(chRef.cols, 'tenant_id,challenge_id');
    assert.strictEqual(chRef.ref_table, h.CHAL);
    const bindFk = confFks.find((f) => f.conname === 'orchestrator_cpcf_tenant_attempt_bind_fkey');
    assert.ok(bindFk);
    assert.strictEqual(bindFk.cols, 'tenant_id,attempt_id,outbox_id,intent_id');
  });

  test('TTL CHECKs cap challenge at 5 minutes and confirmation at 2 minutes', async () => {
    const chalTtl = await h.chkDef(h.CHAL, 'orchestrator_cpc_ttl_check');
    assert.match(chalTtl.definition, /expires_at > created_at/);
    assert.match(chalTtl.definition, /00:05:00|INTERVAL '5 minutes'|interval '5 minutes'/i);
    const confTtl = await h.chkDef(h.CONF, 'orchestrator_cpcf_ttl_check');
    assert.match(confTtl.definition, /expires_at > created_at/);
    assert.match(confTtl.definition, /00:02:00|INTERVAL '2 minutes'|interval '2 minutes'/i);

    const p = db.getPool();
    const g = await h.graph(p, tenantA, hostA, userId, nid, hx);
    await assert.rejects(() => h.challenge(p, tenantA, hostA, g, userId, nid, { expiresSql: "now() + interval '5 minutes 1 second'" }), /ttl_check|check/i);
    await assert.rejects(() => h.challenge(p, tenantA, hostA, g, userId, nid, { createdAtSql: 'now()', expiresSql: 'now()' }), /ttl_check|check/i);
    const ch = await h.challenge(p, tenantA, hostA, g, userId, nid);
    await assert.rejects(() => h.confirm(p, tenantA, hostA, g, ch, userId, nid, hx, { expiresSql: "now() + interval '2 minutes 1 second'" }), /ttl_check|check/i);
    await h.confirm(p, tenantA, hostA, g, ch, userId, nid, hx);
  });

  test('digest-only storage: hex salt/digest accepted; plaintext phrase columns absent', async () => {
    const chCols = await h.cols(h.CHAL);
    const cfCols = await h.cols(h.CONF);
    for (const name of ['confirmation_phrase', 'confirmation_text', 'confirm_phrase', 'phrase']) {
      assert.ok(!chCols.some((c) => c.column_name === name));
      assert.ok(!cfCols.some((c) => c.column_name === name));
    }
    assert.ok(chCols.some((c) => c.column_name === 'phrase_salt'));
    assert.ok(!chCols.some((c) => c.column_name === 'phrase_digest'));
    assert.ok(cfCols.some((c) => c.column_name === 'phrase_salt'));
    assert.ok(cfCols.some((c) => c.column_name === 'phrase_digest'));

    const p = db.getPool();
    const g = await h.graph(p, tenantA, hostA, userId, nid, hx);
    await assert.rejects(() => h.challenge(p, tenantA, hostA, g, userId, nid, { phraseSalt: 'CONFIRM PROVIDER DRAFT' }), /salt_check|check/i);
    const ch = await h.challenge(p, tenantA, hostA, g, userId, nid);
    await assert.rejects(() => h.confirm(p, tenantA, hostA, g, ch, userId, nid, hx, { phraseDigest: 'please-confirm-this-phrase-now' }), /digest_check|check/i);
    const cf = await h.confirm(p, tenantA, hostA, g, ch, userId, nid, hx, { phraseDigest: hx() });
    const stored = (await p.query(`SELECT phrase_salt,phrase_digest FROM ${h.CONF} WHERE tenant_id=$1 AND id=$2`, [tenantA, cf])).rows[0];
    assert.match(stored.phrase_salt, /^[0-9a-f]{64}$/);
    assert.match(stored.phrase_digest, /^[0-9a-f]{64}$/);
  });

  test('cross-tenant FKs refuse foreign draft, attempt, outbox, intent, and credential refs', async () => {
    const p = db.getPool();
    const gA = await h.graph(p, tenantA, hostA, userId, nid, hx);
    const gB = await h.graph(p, tenantB, hostB, userId, nid, hx);
    for (const fn of [
      () => h.challenge(p, tenantA, hostA, { ...gA, draftId: gB.draftId }, userId, nid),
      () => h.challenge(p, tenantA, hostA, gA, userId, nid, { attemptId: gB.attemptId }),
      () => h.challenge(p, tenantA, hostA, gA, userId, nid, { outboxId: gB.outboxId, intentId: gB.intentId, attemptId: gB.attemptId }),
      () => h.challenge(p, tenantA, hostA, gA, userId, nid, { credentialRefId: gB.credId }),
    ]) await assert.rejects(fn, /foreign key|violates|binding/i);
    await h.challenge(p, tenantB, hostB, gB, userId, nid);
  });

  test('credential refs are Meta/test-or-sandbox only and revoke monotonically', async () => {
    const p = db.getPool();
    for (const fn of [
      () => p.query(`INSERT INTO ${h.CRED} (id,tenant_id,platform,environment,status,account_fingerprint,version,owner_user_id) VALUES ($1,$2,'google','sandbox','active',$3,1,$4)`, [nid('mcr'), tenantA, hx(), userId]),
      () => p.query(`INSERT INTO ${h.CRED} (id,tenant_id,platform,environment,status,account_fingerprint,version,owner_user_id) VALUES ($1,$2,'meta','production','active',$3,1,$4)`, [nid('mcr'), tenantA, hx(), userId]),
      () => p.query(`INSERT INTO ${h.CRED} (id,tenant_id,platform,environment,status,account_fingerprint,version,owner_user_id,revoked_at) VALUES ($1,$2,'meta','test','revoked',$3,1,$4,now())`, [nid('mcr'), tenantA, hx(), userId]),
    ]) await assert.rejects(fn, /platform_check|environment_check|tmcr_immutable|immutable|check/i);

    const credId = await h.credRef(p, tenantA, userId, nid, hx, { environment: 'test' });
    await assert.rejects(() => p.query(`UPDATE ${h.CRED} SET platform='google' WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]), /tmcr_immutable|immutable/i);
    await assert.rejects(() => p.query(`UPDATE ${h.CRED} SET version=2 WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]), /tmcr_immutable|immutable/i);
    await p.query(`UPDATE ${h.CRED} SET status='revoked',revoked_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]);
    await assert.rejects(() => p.query(`UPDATE ${h.CRED} SET status='active',revoked_at=NULL WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]), /tmcr_immutable|immutable/i);
    await assert.rejects(() => p.query(`DELETE FROM ${h.CRED} WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]), /tmcr_immutable|immutable/i);
  });

  test('challenges consume once; confirmations spend once; identity stays frozen', async () => {
    const p = db.getPool();
    const g = await h.graph(p, tenantA, hostA, userId, nid, hx);
    const ch = await h.challenge(p, tenantA, hostA, g, userId, nid);
    await assert.rejects(p.query(`UPDATE ${h.CHAL} SET status='consumed' WHERE tenant_id=$1 AND id=$2`, [tenantA, ch]), /cpc_immutable|immutable/i);
    await assert.rejects(p.query(`UPDATE ${h.CHAL} SET phrase_salt=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, ch, hx()]), /cpc_immutable|immutable/i);
    const cf = await h.confirm(p, tenantA, hostA, g, ch, userId, nid, hx);
    await p.query(`UPDATE ${h.CHAL} SET status='consumed',consumed_at=now(),consumed_confirmation_id=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, ch, cf]);
    await assert.rejects(p.query(`UPDATE ${h.CHAL} SET consumed_confirmation_id=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, ch, nid('other')]), /cpc_immutable|immutable/i);
    await assert.rejects(p.query(`UPDATE ${h.CONF} SET phrase_digest=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, cf, hx()]), /cpcf_immutable|immutable/i);
    await p.query(`UPDATE ${h.CONF} SET status='spent',spent_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantA, cf]);
    await assert.rejects(p.query(`UPDATE ${h.CONF} SET status='confirmed',spent_at=NULL WHERE tenant_id=$1 AND id=$2`, [tenantA, cf]), /cpcf_immutable|immutable/i);
    await assert.rejects(p.query(`DELETE FROM ${h.CONF} WHERE tenant_id=$1 AND id=$2`, [tenantA, cf]), /cpcf_immutable|immutable/i);
    await assert.rejects(p.query(`DELETE FROM ${h.CHAL} WHERE tenant_id=$1 AND id=$2`, [tenantA, ch]), /cpc_immutable|immutable/i);
  });

  test('confirmation insert refuses mismatched challenge bindings and salt', async () => {
    const p = db.getPool();
    const g = await h.graph(p, tenantA, hostA, userId, nid, hx);
    const ch = await h.challenge(p, tenantA, hostA, g, userId, nid);
    await assert.rejects(() => h.confirm(p, tenantA, hostA, g, ch, userId, nid, hx, { phraseSalt: hx() }), /cpcf_binding|binding/i);
  });

  test('mismatched attempt/outbox/intent bind is refused and tenant cascade cleans rows', async () => {
    const p = db.getPool();
    const gA = await h.graph(p, tenantA, hostA, userId, nid, hx);
    const draft = nid('draft');
    await p.query('INSERT INTO orchestrator_campaign_drafts (id,tenant_id,workflow_id,contract_hash,idempotency_key,status,current_revision) VALUES ($1,$2,$3,$4,$5,$6,1)', [draft, tenantA, hostA.wf, h.HEX, nid('didemp'), 'draft']);
    await p.query('INSERT INTO orchestrator_campaign_draft_revisions (id,tenant_id,draft_id,revision,contract_json,contract_hash) VALUES ($1,$2,$3,1,$4::jsonb,$5)', [nid('rev'), tenantA, draft, '{"ok":true}', h.HEX]);
    const pub = nid('pub');
    await p.query(`INSERT INTO orchestrator_campaign_publish_approvals (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at) VALUES ($1,$2,$3,1,$4,$5::jsonb,$6,$7,$8,now()+'1 hour')`, [pub, tenantA, draft, h.HEX, '{"ok":true}', hostA.approvalId, userId, nid('pidemp')]);
    const req = nid('req');
    await p.query(`INSERT INTO orchestrator_campaign_publish_requests (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,status,confirmation_version,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,'requested',1,$9,$10)`, [req, tenantA, draft, pub, hostA.approvalId, h.HEX, hx(), userId, nid('ridemp'), hx()]);
    const obx = nid('obx');
    await p.query('INSERT INTO orchestrator_outbox (id,tenant_id,workflow_id,destination,operation,payload,state,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)', [obx, tenantA, hostA.wf, 'internal', 'create_provider_draft', '{}', 'pending', nid('oidemp')]);
    const intent = nid('intent');
    await p.query(`INSERT INTO orchestrator_campaign_delivery_intents (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,contract_version,operation,status,idempotency_key,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'campaign_delivery_v1','create_provider_draft','pending',$11,$12)`, [intent, tenantA, req, draft, pub, hostA.approvalId, obx, h.HEX, hx(), hx(), nid('iidemp'), userId]);
    await assert.rejects(() => h.challenge(p, tenantA, hostA, gA, userId, nid, { outboxId: obx, intentId: intent }), /foreign key|violates|binding/i);

    const iso = (await p.query('INSERT INTO tenants (name,slug,status) VALUES ($1,$2,$3) RETURNING id', [`AO6F0 cascade ${S}`, `ao6f0-c-${S}`, 'active'])).rows[0].id;
    const hC = await h.host(p, iso, nid);
    const gC = await h.graph(p, iso, hC, userId, nid, hx);
    const ch = await h.challenge(p, iso, hC, gC, userId, nid);
    await h.confirm(p, iso, hC, gC, ch, userId, nid, hx);
    await p.query('DELETE FROM tenants WHERE id=$1', [iso]);
    const left = await p.query(
      `SELECT (SELECT count(*)::int FROM ${h.CHAL} WHERE tenant_id=$1) challenges,
              (SELECT count(*)::int FROM ${h.CONF} WHERE tenant_id=$1) confirmations,
              (SELECT count(*)::int FROM ${h.CRED} WHERE tenant_id=$1) creds`, [iso]
    );
    assert.deepStrictEqual(left.rows[0], { challenges: 0, confirmations: 0, creds: 0 });
  });

  test('ensureAgentOrchestratorSchema is idempotent for PR6F-0 tables', async () => {
    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    assert.equal((await p.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name = ANY($2)', ['public', h.TABLES])).rowCount, 3);
    const g = await h.graph(p, tenantA, hostA, userId, nid, hx);
    await h.confirm(p, tenantA, hostA, g, await h.challenge(p, tenantA, hostA, g, userId, nid), userId, nid, hx);
  });

  test('concurrent ensureAgentOrchestratorSchema and confirmation DML produce zero 40P01', async () => {
    const ROUNDS = 40;
    const dml = await db.getPool().connect();
    const deadlocks = [];
    const other = [];
    const note = (side, err) => {
      const rec = { side, code: err && err.code, message: err && err.message };
      if (err && err.code === '40P01') deadlocks.push(rec);
      else other.push(rec);
    };
    let stop = false;
    let dmlCount = 0;
    const dmlLoop = (async () => {
      while (!stop) {
        try {
          const g = await h.graph(dml, tenantA, hostA, userId, nid, hx);
          const ch = await h.challenge(dml, tenantA, hostA, g, userId, nid);
          await h.confirm(dml, tenantA, hostA, g, ch, userId, nid, hx);
          dmlCount += 1;
        } catch (err) {
          note('confirm', err);
          if (!(err && err.code === '40P01')) stop = true;
        }
      }
    })();
    try {
      for (let i = 0; i < ROUNDS; i++) {
        try { await ensureAgentOrchestratorSchema(); }
        catch (err) { note('ensure', err); }
      }
    } finally {
      stop = true;
      await dmlLoop;
      dml.release();
    }
    assert.deepStrictEqual(other, [], `unexpected errors under concurrent ensure vs confirmation DML:\n${other.map((d) => `${d.side} ${d.code}: ${d.message}`).join('\n')}`);
    assert.ok(dmlCount >= ROUNDS, `expected >=${ROUNDS} confirmation inserts overlapping ensure, got ${dmlCount}`);
    assert.deepStrictEqual(deadlocks, [], `40P01 under concurrent ensure vs confirmation DML:\n${deadlocks.map((d) => `${d.side} ${d.code}: ${d.message}`).join('\n')}`);
  });
}
