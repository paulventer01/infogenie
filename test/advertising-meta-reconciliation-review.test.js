'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('fs');
const R=require('../services/agent_orchestrator/meta_reconciliation_human_review');
const reviewApi=require('../services/agent_orchestrator/reconciliation_review_api');
const {listPermissions}=require('../services/tenants/permissions');
const opts=(x={})=>({tenantId:1,actorUserId:7,actorType:'human',hasPermission:(p)=>p===R.PERMISSION,...x});

test('exact dedicated permission and authenticated human actor are required',async()=>{
  assert.equal(R.PERMISSION,'advertising.reconciliation.review'); assert.ok(listPermissions().some(x=>x.key===R.PERMISSION));
  const dead={query:async()=>{throw Error('db reached')}};
  for(const x of [{actorUserId:null},{actorType:'agent'},{hasPermission:()=>false},{hasPermission:(p)=>p==='advertising.reconciliation.read'}])
    await assert.rejects(R.getCase(dead,{...opts(),...x,caseId:'x'}),{code:x.hasPermission?'permission_denied':'authentication_required'});
});

test('review API rejects API-key and non-session principals as non-human',()=>{
  const human={user:{id:7},session:{userId:7}};
  assert.equal(reviewApi._isHumanSessionRequest(human),true);
  assert.equal(reviewApi._isHumanSessionRequest({...human,viaApiKey:true}),false);
  assert.equal(reviewApi._isHumanSessionRequest({user:{id:7,viaApiKey:true},session:{userId:7}}),false);
  assert.equal(reviewApi._isHumanSessionRequest({user:{id:7}}),false);
  assert.equal(reviewApi._isHumanSessionRequest({user:{id:7},session:{userId:8}}),false);
});

test('classification and note policy is bounded and sanitized',()=>{
  for(const c of R.CLASSIFICATIONS) assert.equal(R._test.classification(c),c);
  for(const c of ['verified','anything','']) assert.throws(()=>R._test.classification(c),{code:'invalid_classification'});
  assert.equal(R._test.note('  human\n decision  '),'human decision');
  for(const n of ['', 'x'.repeat(R.NOTE_MAX+1),'Bearer abc','https://meta.test/x','account_id 123','API key abc'])
    assert.throws(()=>R._test.note(n),{code:'invalid_note'});
});

test('public case is a strict safe projection and categories are bounded',()=>{
  const row={id:'c',reconciliation_run_id:'r',state:'failed',classification:'observation_failure',assigned_reviewer_id:7,
    note:'safe',original_state:'failed',original_classifications:['observation_failure','BAD SECRET'],created_at:'a',audit_ref:'audit',version:1,
    authorization_id:'secret-auth',credential_ref_id:'secret-credential',account_fingerprint:'secret-account',ledger_root_hash:'secret-ledger',
    snapshot_hash:'secret-snapshot',intent_hash:'secret-intent',observations:[{token:'secret-token'}]};
  const out=R.publicCase(row), serialized=JSON.stringify(out);
  assert.deepEqual(Object.keys(out).sort(),['acknowledged_at','assigned_reviewer','audit_reference','case_id','classification','closed_at','created_at','discrepancy_classifications','escalated_at','failure_classifications','note','reconciliation_run_id','state','version']);
  assert.deepEqual(out.failure_classifications,['observation_failure']);
  assert.doesNotMatch(serialized,/secret|credential|fingerprint|ledger|snapshot|intent|token|observations/i);
});

function poolFor(state='open'){
  const row={tenant_id:1,id:'case',reconciliation_run_id:'run',workflow_id:'wf',state,version:0,original_state:'failed',
    original_classifications:['observation_failure'],audit_ref:'audit',created_at:'now'}; const calls=[];
  const client={release(){},async query(sql,p=[]){calls.push(sql);
    if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {rowCount:0,rows:[]};
    if(/SELECT c\.\*/.test(sql)) return {rowCount:1,rows:[{...row}]};
    if(/SELECT to_state/.test(sql)) return {rowCount:0,rows:[]};
    if(/UPDATE orchestrator_campaign_reconciliation_review_cases/.test(sql)){row.state=p[2];row.classification=p[3];row.assigned_reviewer_id=p[4];row.note=p[5];row.version++;return {rowCount:1,rows:[{...row}]};}
    if(/INSERT INTO orchestrator_campaign_reconciliation_review_events|INSERT INTO orchestrator_audit_events/.test(sql)) return {rowCount:1,rows:[]};
    throw Error(`unexpected SQL ${sql}`);
  }}; return {connect:async()=>client,calls,row};
}
for(const [from,to,method] of [['open','acknowledged','acknowledge'],['open','escalated','escalate'],['acknowledged','escalated','escalate'],['acknowledged','closed','close'],['escalated','closed','close']])
  test(`${from} -> ${to} commits event and audit atomically`,async()=>{const p=poolFor(from);const out=await R[method](p,{...opts(),caseId:'case',decisionId:`d-${from}-${to}`,expectedVersion:0,classification:'observation_failure',note:'Human operational decision'});assert.equal(out.state,to);assert.match(p.calls.at(-1),/COMMIT/);});

for(const [from,method] of [['open','close'],['acknowledged','acknowledge'],['escalated','acknowledge'],['closed','close']])
  test(`${from} cannot ${method}`,async()=>assert.rejects(R[method](poolFor(from),{...opts(),caseId:'case',decisionId:'decision',expectedVersion:0,classification:'closed_unresolved',note:'Human operational decision'}),{code:'invalid_review_transition'}));

test('audit failure rolls transition and event back',async()=>{const p=poolFor('open');const base=p.connect;p.connect=async()=>{const c=await base();const q=c.query.bind(c);c.query=async(sql,a)=>{if(/INSERT INTO orchestrator_audit_events/.test(sql))throw Error('audit failed');return q(sql,a);};return c;};await assert.rejects(R.acknowledge(p,{...opts(),caseId:'case',decisionId:'decision',expectedVersion:0,classification:'observation_failure',note:'Human operational decision'}),/audit failed/);assert.ok(p.calls.some(x=>/^ROLLBACK/.test(x)));});

test('module exposes no provider, retry, deletion, reopening, or verification reachability',()=>{
  const src=fs.readFileSync(require.resolve('../services/agent_orchestrator/meta_reconciliation_human_review'),'utf8');
  assert.doesNotMatch(src,/fetch\(|https\.request|meta_paused_draft|reconcile\(|getCredentials|vault/);
  for(const k of Object.keys(R)) assert.doesNotMatch(k,/delete|reopen|retry|verify|provider/i);
});
