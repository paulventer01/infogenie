'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');

const SCHEMA_SRC = path.join(__dirname, '../../services/agent_orchestrator/schema.js');
const HEX = 'a'.repeat(64);
const CRED = 'orchestrator_tenant_meta_credential_refs';
const CHAL = 'orchestrator_campaign_provider_challenges';
const CONF = 'orchestrator_campaign_provider_confirmations';
const TABLES = [CRED, CHAL, CONF];
const FORBIDDEN_SECRET_RE =
  /ciphertext|access_token|refresh_token|vault_payload|confirmation_phrase|confirm_phrase|provider_id|ad_account|page_id|pixel_id|api_key/i;
const FORBIDDEN_COLUMNS = [
  'credential', 'credentials', 'credential_ref', 'token', 'tokens', 'access_token',
  'refresh_token', 'secret', 'password', 'vault', 'vault_payload', 'authorization',
  'header', 'headers', 'provider', 'provider_data', 'provider_campaign_id',
  'provider_id', 'external_campaign_id', 'external_id', 'body', 'request_body',
  'raw_body', 'confirmation_phrase', 'confirmation_text', 'confirm_phrase',
  'snapshot_json', 'snapshot', 'payload', 'api_key', 'ciphertext', 'iv', 'tag',
  'ad_account_id', 'page_id', 'pixel_id',
];
const SHAPES = {
  [CRED]: { req: 'id,tenant_id,platform,environment,status,account_fingerprint,version,owner_user_id,created_at,updated_at', nul: 'revoked_at' },
  [CHAL]: {
    req: 'id,tenant_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,contract_version,operation,platform,phrase_salt,status,idempotency_key,requested_by,expires_at,created_at',
    nul: 'consumed_at,consumed_confirmation_id',
  },
  [CONF]: {
    req: 'id,tenant_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,contract_version,operation,platform,phrase_salt,phrase_digest,status,idempotency_key,requested_by,expires_at,created_at',
    nul: 'spent_at',
  },
};
const CHAL_FKS = [
  ['orchestrator_cpc_tenant_draft_fkey', 'tenant_id,draft_id', 'orchestrator_campaign_drafts', 'c'],
  ['orchestrator_cpc_tenant_rev_fkey', 'tenant_id,draft_id,revision', 'orchestrator_campaign_draft_revisions', 'c'],
  ['orchestrator_cpc_tenant_pub_appr_fkey', 'tenant_id,publish_approval_id', 'orchestrator_campaign_publish_approvals', 'c'],
  ['orchestrator_cpc_tenant_pub_req_fkey', 'tenant_id,publishing_request_id', 'orchestrator_campaign_publish_requests', 'c'],
  ['orchestrator_cpc_tenant_intent_fkey', 'tenant_id,intent_id', 'orchestrator_campaign_delivery_intents', 'c'],
  ['orchestrator_cpc_tenant_attempt_fkey', 'tenant_id,attempt_id', 'orchestrator_campaign_delivery_attempts', 'c'],
  ['orchestrator_cpc_tenant_attempt_bind_fkey', 'tenant_id,attempt_id,outbox_id,intent_id', 'orchestrator_campaign_delivery_attempts', 'c'],
  ['orchestrator_cpc_tenant_cred_ref_fkey', 'tenant_id,credential_ref_id', CRED, 'a'],
];

function ids(prefix) {
  const S = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let n = 0;
  return {
    S,
    nid: (p) => `${p}-${S}-${++n}`,
    hx: () => (++n).toString(16).padStart(64, '0'),
  };
}

function src() { return fs.readFileSync(SCHEMA_SRC, 'utf8'); }
function createTable(s, t) {
  const start = s.indexOf(`CREATE TABLE IF NOT EXISTS ${t}`);
  assert.ok(start >= 0, t);
  const from = s.indexOf('(', start);
  let d = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')') { d--; if (!d) return s.slice(start, i + 1); }
  }
  throw new Error(t);
}
function fnBody(s, name) {
  const start = s.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  const m = s.indexOf('$fn$', start);
  const end = s.indexOf('$fn$ LANGUAGE plpgsql', m + 4);
  return s.slice(start, end);
}
function installSqlBlobs(s) {
  const out = [];
  const re = /_installInTransaction\(p, `/g;
  let m;
  while ((m = re.exec(s))) {
    const from = m.index + m[0].length;
    const to = s.indexOf('`', from);
    if (to < 0) throw new Error('unclosed _installInTransaction');
    out.push(s.slice(from, to));
  }
  return out;
}
function triggerOn(sql, table) {
  return new RegExp(`(?:DROP|CREATE)\\s+TRIGGER[\\s\\S]*?\\bON\\s+${table}\\b`).test(sql);
}

async function pkUniq(t) {
  return (await db.getPool().query(
    `SELECT tc.constraint_name,tc.constraint_type,string_agg(kcu.column_name,',' ORDER BY kcu.ordinal_position) cols
     FROM information_schema.table_constraints tc
     LEFT JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema AND tc.table_name=kcu.table_name
     WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
     GROUP BY tc.constraint_name,tc.constraint_type`, [t]
  )).rows;
}
async function chkDef(t, n) {
  return (await db.getPool().query(
    'SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2',
    [`public.${t}`, n]
  )).rows[0];
}
async function fks(t) {
  return (await db.getPool().query(
    `SELECT con.conname,string_agg(att.attname,',' ORDER BY k.n) cols,ref.relname ref_table,con.confdeltype deltype,
            con.condeferrable deferrable,con.condeferred deferred
     FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace nsp ON nsp.oid=rel.relnamespace
     JOIN pg_class ref ON ref.oid=con.confrelid
     JOIN LATERAL unnest(con.conkey) WITH ORDINALITY k(attnum,n) ON true
     JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=k.attnum
     WHERE nsp.nspname='public' AND rel.relname=$1 AND con.contype='f'
     GROUP BY con.oid,con.conname,ref.relname,con.confdeltype,con.condeferrable,con.condeferred`, [t]
  )).rows;
}
async function cols(t) {
  return (await db.getPool().query(
    'SELECT column_name,is_nullable,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',
    ['public', t]
  )).rows;
}

async function assertShape(t) {
  const { req, nul } = SHAPES[t];
  const all = [...req.split(','), ...nul.split(',').filter(Boolean)];
  const got = await cols(t);
  assert.deepStrictEqual(got.map((c) => c.column_name).sort(), all.sort(), t);
  for (const name of req.split(',')) {
    const c = got.find((x) => x.column_name === name);
    assert.strictEqual(c.is_nullable, 'NO', `${t}.${name}`);
  }
  for (const name of nul.split(',').filter(Boolean)) {
    const c = got.find((x) => x.column_name === name);
    assert.strictEqual(c.is_nullable, 'YES', `${t}.${name}`);
  }
  assert.strictEqual(got.find((c) => c.column_name === 'tenant_id').data_type, 'integer');
  const pk = (await pkUniq(t)).filter((c) => c.constraint_type === 'PRIMARY KEY');
  assert.ok(pk.some((c) => c.cols === 'tenant_id,id'), t);
  const bad = got.filter((c) => FORBIDDEN_COLUMNS.includes(c.column_name) || FORBIDDEN_SECRET_RE.test(c.column_name));
  assert.deepStrictEqual(bad, [], t);
}

function assertFk(rows, name, cols, ref, del) {
  const fk = rows.find((f) => f.conname === name);
  assert.ok(fk, name);
  assert.strictEqual(fk.cols, cols, name);
  assert.strictEqual(fk.ref_table, ref, name);
  assert.strictEqual(fk.deltype, del, name);
  assert.ok(fk.cols.startsWith('tenant_id'), name);
}

async function host(p, tenant, nid) {
  const wf = nid('wf');
  await p.query('INSERT INTO orchestrator_workflows (id,tenant_id,name) VALUES ($1,$2,$3)', [wf, tenant, wf]);
  const approvalId = (await p.query(
    `INSERT INTO orchestrator_approvals (tenant_id,workflow_id,gate,content_hash,decision,object_version,approved_platforms)
     VALUES ($1,$2,'campaign_publishing',$3,'approved',1,'["meta"]'::jsonb) RETURNING id`, [tenant, wf, HEX]
  )).rows[0].id;
  return { wf, approvalId };
}

async function graph(p, tenant, h, user, nid, hx) {
  const draft = nid('draft');
  await p.query(
    'INSERT INTO orchestrator_campaign_drafts (id,tenant_id,workflow_id,contract_hash,idempotency_key,status,current_revision) VALUES ($1,$2,$3,$4,$5,$6,1)',
    [draft, tenant, h.wf, HEX, nid('didemp'), 'draft']
  );
  await p.query(
    'INSERT INTO orchestrator_campaign_draft_revisions (id,tenant_id,draft_id,revision,contract_json,contract_hash) VALUES ($1,$2,$3,1,$4::jsonb,$5)',
    [nid('rev'), tenant, draft, '{"ok":true}', HEX]
  );
  const pub = nid('pub');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_approvals
       (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
     VALUES ($1,$2,$3,1,$4,$5::jsonb,$6,$7,$8,now()+'1 hour')`,
    [pub, tenant, draft, HEX, '{"ok":true}', h.approvalId, user, nid('pidemp')]
  );
  const reqHash = hx();
  const snap = hx();
  const req = nid('req');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_requests
       (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,status,confirmation_version,idempotency_key,request_hash)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,'requested',1,$9,$10)`,
    [req, tenant, draft, pub, h.approvalId, HEX, snap, user, nid('ridemp'), reqHash]
  );
  const obx = nid('obx');
  await p.query(
    'INSERT INTO orchestrator_outbox (id,tenant_id,workflow_id,destination,operation,payload,state,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
    [obx, tenant, h.wf, 'internal', 'create_provider_draft', '{}', 'pending', nid('oidemp')]
  );
  const intent = nid('intent');
  const intentHash = hx();
  await p.query(
    `INSERT INTO orchestrator_campaign_delivery_intents
       (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,contract_version,operation,status,idempotency_key,requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'campaign_delivery_v1','create_provider_draft','pending',$11,$12)`,
    [intent, tenant, req, draft, pub, h.approvalId, obx, HEX, snap, intentHash, nid('iidemp'), user]
  );
  const att = nid('att');
  await p.query(
    `INSERT INTO orchestrator_campaign_delivery_attempts
       (id,tenant_id,intent_id,outbox_id,draft_id,publishing_request_id,attempt_number,generation,claim_token,lease_holder,lease_expires_at,platform,intent_hash,contract_version,operation,connector,status)
     VALUES ($1,$2,$3,$4,$5,$6,1,1,$7,$8,now()+'5 minutes','meta',$9,'campaign_delivery_v1','create_provider_draft','fake','started')`,
    [att, tenant, intent, obx, draft, req, nid('claimtok'), 'worker-fake-1', intentHash]
  );
  const cred = nid('mcr');
  await p.query(
    `INSERT INTO ${CRED} (id,tenant_id,platform,environment,status,account_fingerprint,version,owner_user_id)
     VALUES ($1,$2,'meta','sandbox','active',$3,1,$4)`, [cred, tenant, hx(), user]
  );
  return {
    draftId: draft, pubId: pub, reqId: req, requestHash: reqHash, snapshotHash: snap,
    intentId: intent, outboxId: obx, intentHash, attemptId: att, credId: cred,
    claimTokenHash: hx(), phraseSalt: hx(),
  };
}

async function challenge(p, tenant, h, g, user, nid, o = {}) {
  const id = o.id || nid('chal');
  const ca = o.createdAtSql || 'now()';
  const ex = o.expiresSql || "now() + interval '5 minutes'";
  await p.query(
    `INSERT INTO ${CHAL}
       (id,tenant_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,
        generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,contract_version,operation,platform,phrase_salt,status,idempotency_key,requested_by,expires_at,created_at)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,'campaign_delivery_v1','create_provider_draft','meta',$16,'open',$17,$18,${ex},${ca})`,
    [
      id, tenant, g.draftId, g.pubId, h.approvalId, g.reqId, o.intentId || g.intentId, o.outboxId || g.outboxId,
      o.attemptId || g.attemptId, o.credentialRefId || g.credId, HEX, g.snapshotHash, g.intentHash, g.requestHash,
      o.claimTokenHash || g.claimTokenHash, o.phraseSalt || g.phraseSalt, o.idempotencyKey || nid('cidemp'), user,
    ]
  );
  return id;
}

async function confirm(p, tenant, h, g, chal, user, nid, hx, o = {}) {
  const id = o.id || nid('conf');
  const ca = o.createdAtSql || 'now()';
  const ex = o.expiresSql || "now() + interval '2 minutes'";
  await p.query(
    `INSERT INTO ${CONF}
       (id,tenant_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,
        generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,contract_version,operation,platform,phrase_salt,phrase_digest,status,idempotency_key,requested_by,expires_at,created_at)
     VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16,'campaign_delivery_v1','create_provider_draft','meta',$17,$18,'confirmed',$19,$20,${ex},${ca})`,
    [
      id, tenant, chal, g.draftId, g.pubId, h.approvalId, g.reqId, g.intentId, g.outboxId, g.attemptId, g.credId,
      HEX, g.snapshotHash, g.intentHash, g.requestHash, g.claimTokenHash,
      o.phraseSalt || g.phraseSalt, o.phraseDigest || hx(), o.idempotencyKey || nid('fidemp'), user,
    ]
  );
  return id;
}

async function credRef(p, tenant, user, nid, hx, o = {}) {
  const id = o.id || nid('mcr');
  await p.query(
    `INSERT INTO ${CRED} (id,tenant_id,platform,environment,status,account_fingerprint,version,owner_user_id)
     VALUES ($1,$2,'meta',$3,'active',$4,$5,$6)`,
    [id, tenant, o.environment || 'sandbox', o.fingerprint || hx(), o.version || 1, user]
  );
  return id;
}

module.exports = {
  HEX, CRED, CHAL, CONF, TABLES, FORBIDDEN_SECRET_RE, FORBIDDEN_COLUMNS, SHAPES, CHAL_FKS,
  ids, src, createTable, fnBody, installSqlBlobs, triggerOn, pkUniq, chkDef, fks, cols, assertShape, assertFk,
  host, graph, challenge, confirm, credRef,
};
