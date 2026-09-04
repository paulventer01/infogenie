'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const R=require('../services/agent_orchestrator/google_ads_reconciliation_human_review');
const api=require('../services/agent_orchestrator/google_ads_reconciliation_review_api');
const opts=(over={})=>({tenantId:1,actorUserId:7,actorType:'human',hasPermission:(p)=>p===R.PERMISSION,...over});

test('authorization is human-only and requires the exact explicit grant before database access',async()=>{
  const dead={query:async()=>{throw Error('database reached');}};
  for(const over of [{actorUserId:null},{actorType:'agent'},{hasPermission:()=>false},{hasPermission:(p)=>p==='advertising.reconciliation.read'}])
    await assert.rejects(R.getCase(dead,opts({...over,caseId:'case'})),(e)=>['authentication_required','permission_denied'].includes(e.code));
  const req={user:{id:7},tenant:{id:1},tenantRole:{permissions:[R.PERMISSION]},session:{userId:7}};
  assert.equal(api._isHuman(req),true);assert.equal(api._hasGrant(req),true);
  assert.equal(api._isHuman({...req,viaApiKey:true}),false);assert.equal(api._hasGrant({...req,tenantRole:{permissions:[]}}),false);
});

test('safe projection omits copied lineage, provider identifiers, credentials and session material',()=>{
  const row={id:'garc_x',reconciliation_run_id:'garrun_x',state:'failed',original_state:'failed',
    original_classifications:['campaign_missing','BAD','x'.repeat(97)],authorization_id:'secret-auth',operation_id:'secret-op',
    credential_ref_id:'secret-cred',ledger_root_hash:'secret-ledger',snapshot_hash:'secret-snapshot',note:'Safe note',
    audit_ref:'audit',version:0,created_at:new Date()};const out=R.publicCase(row),text=JSON.stringify(out);
  assert.deepEqual(out.object_kinds,['campaign_budget','campaign','ad_group']);assert.deepEqual(out.failure_classifications,['campaign_missing']);
  for(const secret of ['secret-auth','secret-op','secret-cred','secret-ledger','secret-snapshot'])assert.equal(text.includes(secret),false);
  assert.equal(out.external_action_taken,false);assert.ok(Object.isFrozen(out));
});

function poolFor(state='open') {
  const calls=[];
  const row={tenant_id:1,id:'case',reconciliation_run_id:'garrun_case',workflow_id:'wf',state,
    original_state:'failed',original_classifications:['observation_failure'],version:0,audit_ref:'audit',created_at:new Date()};
  const client={
    release(){},
    async query(sql,p=[]){
      calls.push(sql.trim());
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:0};
      if(/SELECT \* FROM orchestrator_google_ads_reconciliation_review_cases/.test(sql))return {rowCount:1,rows:[{...row}]};
      if(/SELECT to_state FROM/.test(sql))return {rowCount:0,rows:[]};
      if(/UPDATE orchestrator_google_ads_reconciliation_review_cases/.test(sql)){
        row.state=p[2];row.classification=p[3];row.assigned_reviewer_id=p[4];row.note=p[5];row.version++;
        return {rowCount:1,rows:[{...row}]};
      }
      if(/INSERT INTO orchestrator_google_ads_reconciliation_review_events|INSERT INTO orchestrator_audit_events/.test(sql))return {rowCount:1,rows:[]};
      throw Error(`unexpected SQL ${sql}`);
    },
  };
  return {connect:async()=>client,calls,client};
}
for(const [from,to,method] of [['open','acknowledged','acknowledge'],['open','escalated','escalate'],['acknowledged','escalated','escalate'],['acknowledged','closed','close'],['escalated','closed','close']])test(`${from} -> ${to} is atomic`,async()=>{const p=poolFor(from);const out=await R[method](p,opts({caseId:'case',decisionId:`${from}-${to}`,expectedVersion:0,classification:'observation_failure',note:'Human operational decision'}));assert.equal(out.state,to);assert.match(p.calls.at(-1),/^COMMIT/);});
for(const [from,method] of [['open','close'],['acknowledged','acknowledge'],['escalated','acknowledge'],['closed','close']])test(`${from} cannot ${method}`,async()=>assert.rejects(R[method](poolFor(from),opts({caseId:'case',decisionId:'decision',expectedVersion:0,classification:'closed_unresolved',note:'Human operational decision'})),{code:'invalid_review_transition'}));

test('version races, idempotency conflicts and audit rollback fail closed',async()=>{
  const version=poolFor();version.client.query=async(sql)=>{if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[]};if(/SELECT \*/.test(sql))return {rowCount:1,rows:[{tenant_id:1,id:'case',state:'open',version:2}]};if(/SELECT to_state/.test(sql))return {rowCount:0,rows:[]};throw Error('unexpected');};
  await assert.rejects(R.acknowledge(version,opts({caseId:'case',decisionId:'d',expectedVersion:1,classification:'observation_failure',note:'Human decision'})),{code:'version_conflict'});
  const conflict=poolFor();conflict.client.query=async(sql)=>{if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[]};if(/SELECT \*/.test(sql))return {rowCount:1,rows:[{tenant_id:1,id:'case',state:'open',version:0}]};if(/SELECT to_state/.test(sql))return {rowCount:1,rows:[{to_state:'closed'}]};throw Error('unexpected');};
  await assert.rejects(R.acknowledge(conflict,opts({caseId:'case',decisionId:'d',expectedVersion:0,classification:'observation_failure',note:'Human decision'})),{code:'idempotency_conflict'});
  const audit=poolFor(),base=audit.client.query.bind(audit.client);audit.client.query=async(sql,p)=>{if(/INSERT INTO orchestrator_audit_events/.test(sql))throw Error('audit failed');return base(sql,p);};
  await assert.rejects(R.acknowledge(audit,opts({caseId:'case',decisionId:'d',expectedVersion:0,classification:'observation_failure',note:'Human decision'})),/audit failed/);assert.ok(audit.calls.some((x)=>/^ROLLBACK/.test(x)));
});

test('notes are bounded and secret-like material is rejected; provider and Meta paths are unreachable',()=>{
  for(const value of ['', 'x'.repeat(R.NOTE_MAX+1),'Bearer token','customer_id 123','https://example.test'])assert.throws(()=>R._test.note(value),{code:'invalid_note'});
  const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_reconciliation_human_review'),'utf8');
  assert.doesNotMatch(source,/fetch\s*\(|https\.request|googleads\.googleapis|tokenTransport|getCredentials|vault|orchestrator_campaign_reconciliation_review_cases/);
  for(const key of Object.keys(R))assert.doesNotMatch(key,/retry|reconcile|provider|vault|delete|reopen/i);
});
