'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../services/agent_orchestrator/meta_reconciliation_read_authorizations');
const { listPermissions } = require('../services/tenants/permissions');

const h = (c) => c.repeat(64);
const crypto = require('crypto');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function ledger() {
  return [
    { object_kind:'campaign', provider_object_id:'campaign-id', provider_object_id_digest:digest('campaign-id'), parent_campaign_digest:null, parent_adset_digest:null, parent_creative_digest:null, account_fingerprint:h('a'), snapshot_hash:h('b'), compensated:false },
    { object_kind:'adset', provider_object_id:'adset-id', provider_object_id_digest:digest('adset-id'), parent_campaign_digest:digest('campaign-id'), parent_adset_digest:null, parent_creative_digest:null, account_fingerprint:h('a'), snapshot_hash:h('b'), compensated:false },
    { object_kind:'creative', provider_object_id:'creative-id', provider_object_id_digest:digest('creative-id'), parent_campaign_digest:digest('campaign-id'), parent_adset_digest:null, parent_creative_digest:null, account_fingerprint:h('a'), snapshot_hash:h('b'), compensated:false },
    { object_kind:'ad', provider_object_id:'ad-id', provider_object_id_digest:digest('ad-id'), parent_campaign_digest:digest('campaign-id'), parent_adset_digest:digest('adset-id'), parent_creative_digest:digest('creative-id'), account_fingerprint:h('a'), snapshot_hash:h('b'), compensated:false },
  ];
}

test('reconciliation read permission is separate from provider mutation permission', () => {
  const keys = listPermissions().map((p) => p.key);
  assert.ok(keys.includes(A.PERMISSION));
  assert.notEqual(A.PERMISSION, 'advertising.provider_drafts.create');
});

test('ledger binding requires exactly one authoritative four-kind lineage', () => {
  const rows=ledger(); const execution={account_fingerprint:h('a'),snapshot_hash:h('b')};
  assert.match(A.validateLineage(rows,execution),/^[0-9a-f]{64}$/);
  assert.throws(()=>A.validateLineage(rows.slice(0,3),execution),{code:'invalid_ledger_lineage'});
  assert.throws(()=>A.validateLineage([...rows.slice(0,3),rows[2]],execution),{code:'invalid_ledger_lineage'});
  assert.throws(()=>A.validateLineage(rows.map((r)=>r.object_kind==='ad'?{...r,parent_adset_digest:h('9')}:r),execution),{code:'invalid_ledger_lineage'});
  assert.throws(()=>A.validateLineage(rows.map((r)=>r.object_kind==='ad'?{...r,provider_object_id:'substituted'}:r),execution),{code:'invalid_ledger_lineage'});
});

test('authorization module exports no mutation or creation operation', () => {
  for (const key of Object.keys(A)) assert.doesNotMatch(key, /post|put|patch|delete|mutat|create/i);
});

test('issuance requires authenticated actor and request-bound exact permission evaluator', async () => {
  const noQuery={query:async()=>{throw new Error('database must not be reached')}};
  await assert.rejects(A.issue(noQuery,{tenantId:1,executionId:'x',hasPermission:()=>true}),{code:'authentication_required'});
  await assert.rejects(A.issue(noQuery,{tenantId:1,requestedBy:1,executionId:'x',hasPermission:()=>false}),{code:'permission_denied'});
  await assert.rejects(A.issue(noQuery,{tenantId:1,requestedBy:1,executionId:'x',permission:A.PERMISSION}),{code:'permission_denied'});
});

test('credential mismatch fails before secret access', async () => {
  let secretReads=0;
  const db={query:async()=>({rowCount:0,rows:[]})};
  await assert.rejects(A.observeWithConsumedCredential(db,{tenant_id:1,authorization_id:'mra_x',execution_id:'e'}, {}, async()=>{secretReads++;}),{code:'credential_boundary_mismatch'});
  assert.equal(secretReads,0);
});

test('credential boundary exposes no general callback or token-bearing handle', () => {
  assert.equal(A.withConsumedCredential, undefined);
  assert.equal(typeof A.observeWithConsumedCredential, 'function');
});

test('revocation is constrained to the authorization actor', async () => {
  let call;
  const db={query:async(sql,params)=>{call={sql,params};return {rowCount:0,rows:[]};}};
  await assert.rejects(A.revoke(db,{tenantId:1,requestedBy:7,authorizationId:'mra_x',hasPermission:(p)=>p===A.PERMISSION}),{code:'authorization_rejected'});
  assert.match(call.sql,/requested_by=\$4/);
  assert.equal(call.params[3],7);
});

function execution() { return { id:'exec_1',tenant_id:1,requested_by:7,publishing_request_id:'req_1',intent_id:'intent_1',intent_hash:h('c'),snapshot_hash:h('b'),credential_ref_id:'cred_1',credential_ref_version:3,account_fingerprint:h('a'),status:'complete',outcome:'complete',objects_created:4,objects_compensated:0,draft_id:'draft_1',workflow_id:'workflow_1' }; }
function issuedRow(overrides={}) { const e=execution(); return {...e,execution_id:e.id,id:'mra_test',status:'issued',expires_at:new Date(Date.now()+60000),ledger_root_hash:A.ledgerRoot(ledger()),requested_by:7,...overrides}; }
function mockPool(row=issuedRow()) {
  const state={row:{...row},commands:[],secretReads:0,transportReads:0};
  const client={release(){},async query(sql,params=[]) {
    state.commands.push(sql.trim().split(/\s+/).slice(0,3).join(' '));
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {rowCount:0,rows:[]};
    if (/SELECT \* FROM orchestrator_campaign_reconciliation/.test(sql)) return {rowCount:1,rows:[{...state.row}]};
    if (/FROM orchestrator_campaign_provider_draft_executions/.test(sql)) return {rowCount:1,rows:[execution()]};
    if (/FROM orchestrator_campaign_provider_objects/.test(sql)) return {rowCount:4,rows:ledger()};
    if (/SET status='reserved'/.test(sql)) { state.row.status='reserved'; state.row.invocation_id_hash=params[2]; return {rowCount:1,rows:[]}; }
    if (/SET status='consumed'/.test(sql)) { state.row.status='consumed'; return {rowCount:1,rows:[]}; }
    if (/SET status='expired'/.test(sql)) { state.row.status='expired'; return {rowCount:1,rows:[]}; }
    if (/SELECT status,invocation_id_hash/.test(sql)) return {rowCount:1,rows:[state.row]};
    if (/orchestrator_tenant_meta_credential_refs/.test(sql)) return {rowCount:1,rows:[{version:3,status:'active',revoked_at:null,owner_user_id:7,account_fingerprint:h('a')}]};
    if (/INSERT INTO orchestrator_audit_events/.test(sql)) return {rowCount:1,rows:[]};
    if (/INSERT INTO orchestrator_campaign_reconciliation/.test(sql)) { state.issued=params; return {rowCount:1,rows:[]}; }
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  return {state,client,connect:async()=>client,query:(...args)=>client.query(...args)};
}
const authOpts=(overrides={})=>({tenantId:1,requestedBy:7,executionId:'exec_1',publishingRequestId:'req_1',snapshotHash:h('b'),intentId:'intent_1',intentHash:h('c'),credentialRefId:'cred_1',credentialRefVersion:3,accountFingerprint:h('a'),ledgerRootHash:A.ledgerRoot(ledger()),hasPermission:(p)=>p===A.PERMISSION,...overrides});

test('issues exact authoritative binding and atomically consumes only once', async () => {
  const db=mockPool(); const issued=await A.issue(db.client,authOpts());
  assert.match(issued.authorization_id,/^mra_/); assert.equal(db.state.issued[0],1); assert.equal(db.state.issued[11],'cred_1'); assert.equal(db.state.issued[12],3);
  db.state.row.id=issued.authorization_id;
  const consumed=await A.consumeAtomic(db,{...authOpts(),authorizationId:issued.authorization_id,invocationId:'invocation_1'});
  assert.equal(db.state.row.status,'consumed'); assert.equal(consumed.credential_ref_version,3);
  await assert.rejects(A.consumeAtomic(db,{...authOpts(),authorizationId:issued.authorization_id,invocationId:'invocation_2'}),{code:'authorization_rejected'});
});

test('issuance rejects each exact authoritative mismatch', async () => {
  for (const [key,value] of Object.entries({requestedBy:8,publishingRequestId:'wrong',snapshotHash:h('9'),intentHash:h('8'),credentialRefId:'wrong',credentialRefVersion:4,accountFingerprint:h('7'),ledgerRootHash:h('6')})) {
    await assert.rejects(A.issue(mockPool().client,authOpts({[key]:value})),{code:'authorization_lineage_mismatch'},key);
  }
  await assert.rejects(A.issue(mockPool().client,authOpts({tenantId:2})),{code:'authorization_lineage_mismatch'});
});

test('expiry, revocation, replay and second invocation fail closed with durable commit', async () => {
  const expired=mockPool(issuedRow({expires_at:new Date(0)}));
  await assert.rejects(A.consumeAtomic(expired,{...authOpts(),authorizationId:'mra_test',invocationId:'i1'}),{code:'authorization_expired'});
  assert.equal(expired.state.row.status,'expired'); assert.ok(expired.state.commands.includes('COMMIT'));
  for (const status of ['revoked','consumed']) await assert.rejects(A.consumeAtomic(mockPool(issuedRow({status})),{...authOpts(),authorizationId:'mra_test',invocationId:'i2'}),{code:'authorization_rejected'});
});

test('frozen credential is resolved only after committed consumption and never leaks; provider failure stays consumed', async () => {
  const db=mockPool(); const seen=[];
  const secret=async(_actor,_platform,version)=>{ db.state.secretReads++; seen.push(db.state.commands.at(-1)); assert.equal(version,3); return {accessToken:'TOP-SECRET',adAccountId:'act_123'}; };
  // Deliberate fingerprint mismatch proves exact account binding before egress and token sanitization.
  await assert.rejects(A.consumeAndObserve(db,{...authOpts(),authorizationId:'mra_test',invocationId:'once'},{transport:async()=>{db.state.transportReads++;}},secret),{code:'credential_boundary_mismatch'});
  assert.equal(db.state.row.status,'consumed'); assert.equal(db.state.secretReads,1); assert.equal(db.state.transportReads,0);
  assert.ok(db.state.commands.indexOf('COMMIT') < db.state.commands.findIndex((x)=>x.startsWith('SELECT status,invocation_id_hash')));
  assert.doesNotMatch(JSON.stringify(db.state),/TOP-SECRET/);
});

test('same-account credential rotation cannot substitute a newer vault version', async () => {
  const db=mockPool(); let transportReads=0;
  const versionAwareVault=async(_actor,_platform,version)=> {
    assert.equal(version,3);
    // The only current row is version 4 after rotation. An exact-version vault
    // query returns no secret even though the advertising account is unchanged.
    return null;
  };
  await assert.rejects(A.consumeAndObserve(db,{...authOpts(),authorizationId:'mra_test',invocationId:'rotation'},{transport:async()=>{transportReads++;}},versionAwareVault),{code:'credential_boundary_mismatch'});
  assert.equal(db.state.row.status,'consumed');
  assert.equal(transportReads,0);
});

test('creation capability cannot authorize reads and read authorization exposes no mutation reachability', async () => {
  await assert.rejects(A.consumeAtomic(mockPool(),{...authOpts({hasPermission:(p)=>p==='advertising.provider_drafts.create'}),authorizationId:'mra_test',invocationId:'i'}),{code:'permission_denied'});
  assert.equal(A.mutate,undefined); assert.equal(A.create,undefined); assert.equal(A.delete,undefined);
});
