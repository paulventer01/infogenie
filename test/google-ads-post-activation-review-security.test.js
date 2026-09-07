'use strict';
process.env.NODE_ENV='test';require('./helpers/env');
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const R=require('../services/agent_orchestrator/google_ads_post_activation_review');
const api=require('../services/agent_orchestrator/google_ads_post_activation_review_api');
const observations=[
 {object_kind:'campaign_budget',outcome:'observed',status_classification:'paused',account_binding_matches:true,
  campaign_parent_matches:'not_applicable',budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
 {object_kind:'campaign',outcome:'observed',status_classification:'active',account_binding_matches:true,
  campaign_parent_matches:'not_applicable',budget_parent_matches:true,observed_at:'2026-09-07T00:00:00.000Z'},
 {object_kind:'ad_group',outcome:'missing',status_classification:'unknown',account_binding_matches:'unknown',
  campaign_parent_matches:'unknown',budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
];
const source=(over={})=>({tenant_id:1,id:'gapar_source',activation_attempt_id:'attempt',activation_status:'succeeded',
 requested_by:4,session_id_hash:'secret-session',workflow_id:'workflow',state:'discrepancy_detected',observations,
 classifications:['ad_group_missing'],audit_ref:'source-audit',observing_at:new Date('2026-09-07T00:00:00Z'),
 observation_deadline:new Date('2026-09-07T00:03:00Z'),completed_at:new Date('2026-09-07T00:00:10Z'),...over});
const opts=over=>({tenantId:1,actorUserId:7,actorType:'human',principalType:'user',sessionId:'session',
 hasExplicitTenantPermission:key=>key===R.PERMISSION,...over});

test('authorization is human-only and exact-grant-only before database access',async()=>{const dead={connect:async()=>{throw Error('database reached');}};
 for(const over of [{actorUserId:null},{actorType:'agent'},{principalType:'service'},{sessionId:''},{hasExplicitTenantPermission:()=>false}])
  await assert.rejects(R.getCase(opts({...over,pool:dead,caseId:'case'})),e=>['human_session_required','permission_denied'].includes(e.code));
 const req={user:{id:7,isOwner:true},tenant:{id:1},tenantRole:{permissions:[]},session:{userId:7},sessionID:'session'};
 assert.equal(api._human(req),true);assert.equal(api._grant(req),false);assert.equal(api._human({...req,viaApiKey:true}),false);
 assert.equal(api._human({...req,user:{...req.user,principalType:'worker'}}),false);
 assert.equal(api._grant({...req,tenantRole:{permissions:[R.PERMISSION]}}),true);
});

test('route wiring is narrowly permission-gated with no owner bypass',()=>{
 const matrix=require('../services/tenants/permission_matrix'),{listPermissions}=require('../services/tenants/permissions');
 const path='/api/agent-orchestrator/google-ads-post-activation-reviews';
 for(const method of ['GET','POST','PATCH','DELETE'])assert.equal(matrix.requiredPermissionForRequest(path,method).permission,R.PERMISSION);
 assert.ok(listPermissions().some(x=>x.key===R.PERMISSION&&x.scope==='tenant'));
 const server=fs.readFileSync(require.resolve('../server'),'utf8'),start=server.indexOf('const _OWNER_GATE_ALLOW = ['),end=server.indexOf('\n];',start);
 const allow=server.slice(start,end),patterns=allow.split('\n').map(line=>line.match(/^\s*(\/\^.*?\/),/)?.[1]).filter(Boolean)
  .map(x=>new RegExp(x.slice(1,-1))),exempt=value=>patterns.some(rx=>rx.test(value));
 assert.equal(exempt(path),true);assert.equal(exempt(`${path}/case/close`),true);
 assert.equal(exempt(`${path}-export`),false);assert.equal(exempt('/api/agent-orchestrator/google-ads-post-activation-review'),false);
});

test('only complete terminal real-provider discrepancy evidence is reviewable',()=>{
 assert.deepEqual(R._test.validateSource(source()).classifications,['ad_group_missing']);
 for(const bad of [source({state:'verified_active',classifications:[]}),source({state:'failed'}),source({completed_at:null}),
  source({observations:observations.slice(0,2)}),source({observations:observations.map((x,i)=>i?x:{...x,_fabricated:true})}),
  source({observations:observations.map((x,i)=>i?x:{...x,outcome:'transient_failure'})})])
  assert.throws(()=>R._test.validateSource(bad),e=>['reconciliation_not_reviewable','reconciliation_evidence_invalid'].includes(e.code));
});

test('public projection contains only sanitized internal identity and normalized observation state',()=>{const row={id:'gaparv_case',
 reconciliation_run_id:'gapar_source',activation_attempt_id:'attempt',activation_status:'succeeded',workflow_id:'workflow',
 observed_provider_state:[{...observations[2],provider_object_id:'123',customer_id:'1234567890',access_token:'secret'}],
 source_discrepancy_classifications:['ad_group_missing','BAD'],state:'open',version:0,audit_ref:'audit',created_at:new Date(),
 credential_ref_id:'secret-credential',account_fingerprint:'secret-fingerprint',ledger_root_hash:'secret-ledger'};
 const out=R.publicCase(row),text=JSON.stringify(out);assert.equal(out.external_action_taken,false);
 assert.deepEqual(out.intended_provider_state,{campaign_budget:'paused',campaign:'active',ad_group:'active'});
 for(const secret of ['provider_object_id','customer_id','1234567890','access_token','secret-credential','secret-fingerprint','secret-ledger'])
  assert.equal(text.includes(secret),false,secret);assert.ok(Object.isFrozen(out));
});

function poolFor(state='open') {const calls=[],row={tenant_id:1,id:'case',reconciliation_run_id:'gapar_source',
 activation_attempt_id:'attempt',activation_status:'succeeded',workflow_id:'workflow',observed_provider_state:observations,
 source_discrepancy_classifications:['ad_group_missing'],state,version:0,audit_ref:'audit',created_at:new Date()};
 const client={release(){},async query(sql,p=[]){calls.push(sql.trim());if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[],rowCount:0};
  if(sql.startsWith('SELECT t.id FROM tenants'))return{rowCount:1,rows:[{id:1}]};
  if(sql.includes(`SELECT * FROM ${R.TABLE}`))return{rowCount:1,rows:[{...row}]};
  if(sql.includes(`SELECT decision_payload_hash FROM ${R.EVENTS}`))return{rowCount:0,rows:[]};
  if(sql.startsWith(`UPDATE ${R.TABLE}`)){row.state=p[2];row.disposition=p[3];row.assigned_reviewer_id=p[4];row.note=p[5];row.version++;
   return{rowCount:1,rows:[{...row}]};}
  if(sql.startsWith(`INSERT INTO ${R.EVENTS}`)||sql.startsWith('INSERT INTO orchestrator_audit_events'))return{rowCount:1,rows:[]};
  throw Error(`unexpected SQL ${sql}`);}};return{connect:async()=>client,calls,client};}
for(const [from,to,method] of [['open','acknowledged','acknowledge'],['open','escalated','escalate'],
 ['acknowledged','escalated','escalate'],['acknowledged','closed','close'],['escalated','closed','close']])
 test(`${from} -> ${to} is an atomic explicit human decision`,async()=>{const pool=poolFor(from);const out=await R[method](opts({pool,caseId:'case',
  decisionId:`${from}-${to}`,expectedVersion:0,disposition:'provider_investigation_required',note:'Human operational decision'}));
  assert.equal(out.state,to);assert.match(pool.calls.at(-1),/^COMMIT/);});

test('invalid close, stale version, altered replay and audit failure all fail closed',async()=>{
 await assert.rejects(R.close(opts({pool:poolFor('open'),caseId:'case',decisionId:'close',expectedVersion:0,
  disposition:'closed_unresolved',note:'Human close decision'})),{code:'invalid_review_transition'});
 const stale=poolFor();stale.client.query=async sql=>{if(['BEGIN','ROLLBACK'].includes(sql))return{rows:[]};
  if(sql.startsWith('SELECT t.id FROM tenants'))return{rowCount:1,rows:[{id:1}]};
  if(sql.includes(`SELECT * FROM ${R.TABLE}`))return{rowCount:1,rows:[{tenant_id:1,id:'case',state:'open',version:2}]};
  if(sql.includes('SELECT decision_payload_hash'))return{rowCount:0,rows:[]};throw Error('unexpected');};
 await assert.rejects(R.acknowledge(opts({pool:stale,caseId:'case',decisionId:'stale',expectedVersion:0,
  disposition:'activation_state_mismatch',note:'Human decision'})),{code:'version_conflict'});
 const conflict=poolFor();conflict.client.query=async sql=>{if(['BEGIN','ROLLBACK'].includes(sql))return{rows:[]};
  if(sql.startsWith('SELECT t.id FROM tenants'))return{rowCount:1,rows:[{id:1}]};
  if(sql.includes(`SELECT * FROM ${R.TABLE}`))return{rowCount:1,rows:[{tenant_id:1,id:'case',state:'open',version:0}]};
  if(sql.includes('SELECT decision_payload_hash'))return{rowCount:1,rows:[{decision_payload_hash:'different'}]};throw Error('unexpected');};
 await assert.rejects(R.acknowledge(opts({pool:conflict,caseId:'case',decisionId:'same',expectedVersion:0,
  disposition:'activation_state_mismatch',note:'Human decision'})),{code:'idempotency_conflict'});
 const audit=poolFor(),base=audit.client.query.bind(audit.client);audit.client.query=async(sql,p)=>sql.startsWith('INSERT INTO orchestrator_audit_events')
  ?Promise.reject(Error('audit failed')):base(sql,p);
 await assert.rejects(R.acknowledge(opts({pool:audit,caseId:'case',decisionId:'audit',expectedVersion:0,
  disposition:'activation_state_mismatch',note:'Human decision'})),/audit failed/);assert.ok(audit.calls.some(x=>x==='ROLLBACK'));
});

test('notes, request shapes and dependency surface reject secret or autonomous paths',()=>{
 for(const value of ['', 'x'.repeat(R.NOTE_MAX+1),'Bearer token','customer_id 123','https://example.test','1234567890','123-456-7890'])
  assert.throws(()=>R._test.note(value),{code:'invalid_note'});
 assert.equal(api._exact({reconciliation_run_id:'run'},['reconciliation_run_id']),true);
 assert.equal(api._exact({reconciliation_run_id:'run',retry:true},['reconciliation_run_id']),false);
 const src=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_post_activation_review'),'utf8');
 assert.match(src,/orchestrator_gaparv_safe_observations\(s\.observations\)/);
 assert.match(src,/s\.observing_at,s\.completed_at/);
 assert.doesNotMatch(src,/require\(['"].*(?:connector|vault|credential|oauth|activation\.js|worker|scheduler|webhook)/i);
 assert.doesNotMatch(src,/\b(?:fetch|axios)\s*\(|googleads\.googleapis|UPDATE\s+orchestrator_google_ads_post_activation_reconciliation_runs/i);
 for(const key of Object.keys(R))assert.doesNotMatch(key,/approve|retry|reconcile|provider|vault|delete|reopen/i);
});
