'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),service=require('../../services/security/google_ads_activation_capabilities');
const db=require('../../db'),{ensureAuthSchema}=require('../../services/auth/schema'),{ensureTenantSchema}=require('../../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../../services/agent_orchestrator/schema');
if(!db.hasDb())test('Google activation capability PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
 before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();});
 test('PostgreSQL installs tenant-leading immutable lifecycle constraints',async()=>{const p=db.getPool();
  const columns=(await p.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='orchestrator_google_ads_activation_capabilities'`)).rows;
  assert.equal(columns.find(x=>x.column_name==='tenant_id')?.is_nullable,'NO');
 for(const name of ['orchestrator_gaac_status','orchestrator_gaac_hashes','orchestrator_gaac_review','orchestrator_gaac_lifecycle'])
   assert.equal((await p.query('SELECT count(*)::int n FROM pg_constraint WHERE conname=$1',[name])).rows[0].n,1);
  await p.query(`ALTER TABLE orchestrator_google_ads_activation_capabilities DROP CONSTRAINT orchestrator_gaac_lifecycle,
    ADD CONSTRAINT orchestrator_gaac_lifecycle CHECK(confirmed_at<=issued_at AND expires_at>issued_at)`);
  await ensureAgentOrchestratorSchema();
  const lifecycle=(await p.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='orchestrator_gaac_lifecycle'`)).rows[0].definition;
  for(const invariant of ["confirmed_at >= (issued_at - '00:05:00'::interval)","expires_at <= (issued_at + '00:10:00'::interval)",'expires_at <= approval_expires_at','reserved_at >= issued_at','reserved_at < expires_at','consumed_at >= reserved_at','consumed_at < expires_at','revoked_at >= issued_at','revoked_at < expires_at'])
   assert.ok(lifecycle.includes(invariant),`missing lifecycle invariant: ${invariant}`);
  assert.equal((await p.query(`SELECT convalidated FROM pg_constraint WHERE conname='orchestrator_gaac_lifecycle'`)).rows[0].convalidated,true);
  const probe=await p.connect();
  try{await probe.query(`CREATE TEMP TABLE gaac_freshness_probe
    (LIKE orchestrator_google_ads_activation_capabilities INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  const insertProbe=(confirmedAt)=>probe.query(`INSERT INTO gaac_freshness_probe(
    tenant_id,id,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
    publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
    operation_id,source_authorization_id,reconciliation_run_id,credential_owner_user_id,credential_ref_id,
    credential_ref_version,account_fingerprint,ledger_root_hash,confirmation_hash,confirmed_at,issued_at,
    expires_at,approval_expires_at,audit_ref) VALUES(1,$1,1,repeat('a',64),'w','d',1,repeat('b',64),'pr','pa',1,
    repeat('c',64),'i',repeat('d',64),'op','auth','run',1,'cred',1,repeat('e',64),repeat('f',64),
    repeat('0',64),$2,'2026-01-01T00:10:00Z','2026-01-01T00:15:00Z','2026-01-01T00:15:00Z','audit')`,
    [`cap_${confirmedAt.slice(14,16)}`,confirmedAt]);
  await insertProbe('2026-01-01T00:05:00Z');
  await assert.rejects(probe.query(`UPDATE gaac_freshness_probe SET approval_expires_at=expires_at-interval '1 microsecond'
    WHERE id='cap_05'`),e=>e.code==='23514');
  await assert.rejects(insertProbe('2026-01-01T00:04:59Z'),e=>e.code==='23514');
  await assert.rejects(probe.query(`UPDATE gaac_freshness_probe SET status='reserved',reservation_id_hash=repeat('1',64),
    reserved_at=expires_at+interval '1 microsecond' WHERE id='cap_05'`),e=>e.code==='23514');
  await assert.rejects(probe.query(`UPDATE gaac_freshness_probe SET status='reserved',reservation_id_hash=repeat('1',64),
    reserved_at=expires_at WHERE id='cap_05'`),e=>e.code==='23514');
  await probe.query(`UPDATE gaac_freshness_probe SET status='reserved',reservation_id_hash=repeat('1',64),
    reserved_at=expires_at-interval '1 microsecond' WHERE id='cap_05'`);
  await assert.rejects(probe.query(`UPDATE gaac_freshness_probe SET status='consumed',invocation_id_hash=repeat('2',64),
    consumed_at=expires_at WHERE id='cap_05'`),e=>e.code==='23514');
  await assert.rejects(probe.query(`UPDATE gaac_freshness_probe SET status='revoked',revoked_at=expires_at,revoked_by=1
    WHERE id='cap_05'`),e=>e.code==='23514');
  }finally{probe.release();}
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].n,1);
  const trigger=(await p.query(`SELECT pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].definition;
  const guard=(await p.query(`SELECT pg_get_functiondef(tgfoid) definition FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].definition;
  assert.match(trigger,/BEFORE INSERT OR DELETE OR UPDATE/);
  assert.match(guard,/orchestrator_gaac_invalid_initial_state/);
 });
 test('identical replay durably expires issued and reserved rows after approval expiry',async()=>{const p=db.getPool(),c=await p.connect();
  const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex'),confirmedAt=new Date(Date.now()-120000);
  const approvalExpiry=new Date(Date.now()-1000),confirmationHash=sha(`1|7|real-session|confirm|${service.CONFIRMATION}|${confirmedAt.toISOString()}`);
  const x={tenant_id:1,id:'run',state:'verified',completed_at:new Date(),created_at:new Date(),external_action_taken:true,object_count:3,
   workflow_id:'wf',draft_id:'draft',draft_revision:1,current_revision:1,draft_status:'approved_for_publish',contract_hash:'contract',publishing_request_id:'request',
   request_revision:1,request_contract_hash:'contract',publish_approval_id:'approval',request_approval_id:'approval',workflow_approval_id:2,
   request_workflow_approval_id:2,approval_revision:1,approval_contract_hash:'contract',approval_active:false,approval_expires_at:approvalExpiry,
   snapshot_hash:'snapshot',intent_id:'intent',intent_hash:'intent-hash',current_intent_hash:'intent-hash',operation_id:'operation',authorization_id:'auth',
   credential_owner_user_id:7,owner_user_id:7,credential_ref_id:'credential',credential_ref_version:1,current_credential_version:1,
   credential_status:'active',account_fingerprint:'fingerprint',ledger_root_hash:'ledger'};
  try{await c.query('BEGIN');await c.query(`CREATE TEMP TABLE orchestrator_google_ads_activation_capabilities
    (tenant_id bigint,id text,actor_user_id bigint,session_id_hash text,workflow_id text,draft_id text,draft_revision int,contract_hash text,
     publishing_request_id text,publish_approval_id text,workflow_approval_id bigint,snapshot_hash text,intent_id text,intent_hash text,operation_id text,
     source_authorization_id text,reconciliation_run_id text,review_case_id text,review_version int,closure_event_id text,rereconciliation_attempt_id text,
     credential_owner_user_id bigint,credential_ref_id text,credential_ref_version int,account_fingerprint text,ledger_root_hash text,
     confirmation_hash text,status text,issued_at timestamptz,expires_at timestamptz,approval_expires_at timestamptz,reserved_at timestamptz,
     consumed_at timestamptz,revoked_at timestamptz) ON COMMIT DROP`);
   await c.query(`CREATE TEMP TABLE orchestrator_audit_events(tenant_id bigint,workflow_id text,event text,actor_user_id bigint,detail jsonb) ON COMMIT DROP`);
   await c.query(`INSERT INTO orchestrator_google_ads_activation_capabilities
    (tenant_id,id,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,publishing_request_id,publish_approval_id,
     workflow_approval_id,snapshot_hash,intent_id,intent_hash,operation_id,source_authorization_id,reconciliation_run_id,credential_owner_user_id,
     credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,confirmation_hash,status,issued_at,expires_at,approval_expires_at)
    VALUES(1,'cap',7,$1,'wf','draft',1,'contract','request','approval',2,'snapshot','intent','intent-hash','operation','auth','run',7,
     'credential',1,'fingerprint','ledger',$2,'issued',$3,$4,$4)`,[sha('real-session'),confirmationHash,confirmedAt,approvalExpiry]);
   const client={query:(sql,params)=>{if(sql.startsWith('SELECT operation_id FROM'))return Promise.resolve({rowCount:1,rows:[{operation_id:'operation'}]});
    if(sql.startsWith('SELECT id FROM orchestrator_google_ads_provider_draft_operations'))return Promise.resolve({rowCount:1,rows:[{id:'operation'}]});
    if(sql.startsWith('SELECT run.*'))return Promise.resolve({rowCount:1,rows:[x]});
    if(sql.startsWith('SELECT id,state,version')||sql.startsWith('SELECT 1 FROM orchestrator_google_ads_reconciliation_runs'))return Promise.resolve({rowCount:0,rows:[]});
    return c.query(sql,params);}};
   const input={tenantId:1,actorUserId:7,actorType:'human',principalType:'user',sessionId:'real-session',hasExplicitTenantPermission:()=>true,
    reconciliationRunId:'run',confirmationId:'confirm',confirmation:service.CONFIRMATION,confirmedAt:confirmedAt.toISOString()};
   for(const state of ['issued','reserved']){await c.query('UPDATE orchestrator_google_ads_activation_capabilities SET status=$1 WHERE id=\'cap\'',[state]);
    assert.equal((await service.issue(client,input)).status,'expired');
    assert.equal((await c.query("SELECT status FROM orchestrator_google_ads_activation_capabilities WHERE id='cap'")).rows[0].status,'expired');}
   assert.equal((await c.query("SELECT count(*)::int n FROM orchestrator_audit_events WHERE event='google_ads_activation_capability_expired'")).rows[0].n,2);
   await c.query("UPDATE orchestrator_google_ads_activation_capabilities SET status='issued',workflow_approval_id=99 WHERE id='cap'");
   await assert.rejects(service.issue(client,input),{code:'capability_conflict'});
   await assert.rejects(service.issue(client,{...input,confirmationId:'new'}),{code:'authoritative_binding_mismatch'});
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
}
