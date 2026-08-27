'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../services/agent_orchestrator/meta_paused_draft_reconciliation');

function observation(kind, overrides = {}) {
  return {
    object_kind: kind,
    outcome: 'observed',
    status_classification: kind === 'creative' ? 'not_applicable' : 'paused',
    account_binding_matches: true,
    campaign_parent_matches: kind === 'campaign' || kind === 'creative' ? 'not_applicable' : true,
    adset_parent_matches: kind === 'ad' ? true : 'not_applicable',
    creative_link_matches: kind === 'ad' ? true : 'not_applicable',
    observed_at: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}
function graph(overrides = {}) {
  const observations = R.KINDS.map((kind) => observation(kind, overrides[kind] || {}));
  return { attempted_observations: 4, completed_observations: 4, observations };
}

test('fully observed paused four-object graph verifies', () => {
  const result = R.evaluate(graph());
  assert.equal(result.state, 'verified');
  assert.deepEqual(result.classifications, []);
  assert.equal(result.observations.length, 4);
});

for (const kind of ['campaign', 'adset', 'ad']) {
  test(`${kind} ACTIVE or delivering is a discrepancy`, () => {
    const active = R.evaluate(graph({ [kind]: { status_classification: kind === 'ad' ? 'delivering' : 'active' } }));
    assert.equal(active.state, 'discrepancy_detected');
    assert.deepEqual(active.classifications, [`${kind}_${kind === 'ad' ? 'delivering' : 'active'}`]);
  });
}

test('missing Creative requires human-review discrepancy', () => {
  const result = R.evaluate(graph({ creative: { outcome: 'missing', error_classification: 'not_found' } }));
  assert.equal(result.state, 'discrepancy_detected');
  assert.deepEqual(result.classifications, ['creative_missing']);
});

test('wrong account and every wrong relationship fail closed as discrepancies', () => {
  const result = R.evaluate(graph({
    campaign: { account_binding_matches: false },
    adset: { campaign_parent_matches: false },
    ad: { campaign_parent_matches: false, adset_parent_matches: false, creative_link_matches: false },
  }));
  assert.equal(result.state, 'discrepancy_detected');
  assert.deepEqual(result.classifications, [
    'ad_adset_mismatch', 'ad_campaign_mismatch', 'ad_creative_mismatch',
    'adset_campaign_mismatch', 'campaign_account_mismatch',
  ]);
});

test('unknown status and unknown bindings are never treated as safe', () => {
  const result = R.evaluate(graph({ campaign: { status_classification: 'unknown', account_binding_matches: 'unknown' } }));
  assert.equal(result.state, 'discrepancy_detected');
  assert.deepEqual(result.classifications, ['campaign_account_mismatch', 'campaign_unsafe_status']);
});

test('partial or duplicate observations fail rather than verify', () => {
  const partial = graph(); partial.completed_observations = 3; partial.observations.pop();
  assert.deepEqual(R.evaluate(partial).classifications, ['partial_observation']);
  const duplicate = graph(); duplicate.observations[3] = observation('campaign');
  assert.equal(R.evaluate(duplicate).state, 'failed');
});

test('provider timeout, unauthorized, malformed, oversized, and permanent/transient responses remain failures', () => {
  for (const error of ['provider_unavailable', 'provider_unauthorized', 'invalid_provider_response', 'response_too_large', 'provider_rejected', 'rate_limited']) {
    const result = R.evaluate(graph({ campaign: { outcome: error === 'rate_limited' ? 'transient_failure' : 'permanent_failure', error_classification: error } }));
    assert.equal(result.state, 'failed');
    assert.deepEqual(result.classifications, [`campaign_${error}`]);
  }
});

test('public contract is sanitized and exposes only operational evidence', () => {
  const row = {
    id: 'mrr_safe', state: 'discrepancy_detected', observations: graph().observations,
    classifications: ['ad_active'], audit_ref: 'mrr-audit:safe', created_at: 'now', completed_at: 'later',
    provider_object_id: 'provider-secret', account_fingerprint: 'account-secret', credential_ref_id: 'vault-secret',
  };
  const output = R.publicRun(row); const serialized = JSON.stringify(output);
  assert.deepEqual(Object.keys(output).sort(), ['audit_reference','completed_at','created_at','discrepancy_classifications','failure_classifications','object_kinds','observations','reconciliation_run_id','state']);
  assert.doesNotMatch(serialized, /provider-secret|account-secret|vault-secret|provider_object_id|account_fingerprint|credential/i);
});

test('module has no provider mutation reachability', () => {
  const src = require('fs').readFileSync(require.resolve('../services/agent_orchestrator/meta_paused_draft_reconciliation'), 'utf8');
  assert.doesNotMatch(src, /require\(['"].*meta_paused_draft['"]\)|https\.request|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
});

function transactionalPool(handler) {
  const calls=[];
  const client={
    async query(sql,params) { calls.push(String(sql).trim().split(/\s+/).slice(0,3).join(' ')); return handler(String(sql),params,calls); },
    release() { calls.push('RELEASE'); },
  };
  return { calls, pool:{ connect:async()=>client } };
}
function consumed() {
  return { requested_by:1,workflow_id:'wf',draft_id:'draft',publishing_request_id:'request',execution_id:'execution',
    snapshot_hash:'a'.repeat(64),intent_id:'intent',intent_hash:'b'.repeat(64),credential_ref_id:'cred',
    credential_ref_version:1,account_fingerprint:'c'.repeat(64),ledger_root_hash:'d'.repeat(64) };
}
function runRow(overrides={}) {
  return { id:'mrr_test',tenant_id:1,authorization_id:'mra_test',invocation_id_hash:'e'.repeat(64),requested_by:1,
    workflow_id:'wf',state:'observing',observations:[],classifications:[],audit_ref:'mrr-audit:test',
    observing_at:new Date('2026-08-27T00:00:00Z'),observation_deadline:new Date('2026-08-27T00:00:30Z'),...overrides };
}

test('creation transaction rolls authorization back when run insertion fails', async () => {
  let authorization='issued';
  const {pool,calls}=transactionalPool(async(sql)=>{
    if (sql==='BEGIN') return {};
    if (/INSERT INTO orchestrator_campaign_reconciliation_runs/.test(sql)) throw new Error('insert_failed');
    if (sql==='ROLLBACK') { authorization='issued'; return {}; }
    return {};
  });
  const consumeIntoRunImpl=async(client)=>{ authorization='consumed'; await client.query('INSERT INTO orchestrator_campaign_reconciliation_runs'); };
  await assert.rejects(R._test.createObservingRun(pool,{},1,'mra_test','e'.repeat(64),new Date(),consumeIntoRunImpl),/insert_failed/);
  assert.equal(authorization,'issued'); assert.ok(calls.includes('ROLLBACK'));
});

test('initial audit failure rolls back run and authorization together', async () => {
  let authorization='issued'; let runPersisted=false;
  const row=runRow();
  const {pool,calls}=transactionalPool(async(sql)=>{
    if (/INSERT INTO orchestrator_campaign_reconciliation_runs/.test(sql)) { runPersisted=true; return {rowCount:1,rows:[row]}; }
    if (sql==='ROLLBACK') { authorization='issued'; runPersisted=false; }
    return {};
  });
  const consumeIntoRunImpl=async()=>{ authorization='consumed'; runPersisted=true; return {consumed:consumed(),row}; };
  await assert.rejects(R._test.createObservingRun(pool,{},1,'mra_test','e'.repeat(64),new Date(),consumeIntoRunImpl,async()=>{throw new Error('audit_failed');}),/audit_failed/);
  assert.equal(authorization,'issued'); assert.equal(runPersisted,false); assert.ok(calls.includes('ROLLBACK'));
});

test('creation commits consumption, run and initial audit in one transaction', async () => {
  const row=runRow();
  const {pool,calls}=transactionalPool(async()=>({}));
  await R._test.createObservingRun(pool,{},1,'mra_test','e'.repeat(64),new Date(),async()=>({consumed:consumed(),row}),async()=>{});
  assert.equal(calls[0],'BEGIN'); assert.equal(calls.at(-2),'COMMIT');
});

test('pre-deadline replay returns observing without provider reachability', async () => {
  const row=runRow(); let updates=0;
  const {pool}=transactionalPool(async(sql)=>{
    if (/SELECT \* FROM orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[row]};
    if (/UPDATE orchestrator_campaign_reconciliation_runs/.test(sql)) updates+=1;
    return {};
  });
  const out=await R._test.existingOrRecover(pool,1,'mra_test','e'.repeat(64),new Date('2026-08-27T00:00:10Z'));
  assert.equal(out.state,'observing'); assert.equal(updates,0);
});

test('expired observation lease atomically records interrupted failure and audit', async () => {
  const stale=runRow(); const failed=runRow({state:'failed',classifications:['interrupted_observation'],completed_at:new Date()});
  let audited=false;
  const {pool,calls}=transactionalPool(async(sql)=>{
    if (/SELECT \* FROM orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[stale]};
    if (/UPDATE orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[failed]};
    return {};
  });
  const out=await R._test.existingOrRecover(pool,1,'mra_test','e'.repeat(64),new Date('2026-08-27T00:01:00Z'),async()=>{audited=true;});
  assert.equal(out.state,'failed'); assert.deepEqual(out.failure_classifications,['interrupted_observation']);
  assert.equal(audited,true); assert.equal(calls.at(-2),'COMMIT');
});

test('stale recovery audit failure rolls back terminal transition', async () => {
  const stale=runRow(); let rolledBack=false;
  const {pool}=transactionalPool(async(sql)=>{
    if (/SELECT \* FROM orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[stale]};
    if (/UPDATE orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[runRow({state:'failed'})]};
    if (sql==='ROLLBACK') rolledBack=true;
    return {};
  });
  await assert.rejects(R._test.existingOrRecover(pool,1,'mra_test','e'.repeat(64),new Date('2026-08-27T00:01:00Z'),async()=>{throw new Error('audit_failed');}),/audit_failed/);
  assert.equal(rolledBack,true);
});

for (const state of ['verified','discrepancy_detected','failed']) test(`${state} transition rolls back when terminal audit fails`, async () => {
  let rolledBack=false; const terminal=runRow({state});
  const {pool}=transactionalPool(async(sql)=>{
    if (/SELECT \* FROM orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[runRow()]};
    if (/UPDATE orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[terminal]};
    if (sql==='ROLLBACK') rolledBack=true;
    return {};
  });
  await assert.rejects(R._test.finishRun(pool,1,'mrr_test',{state,classifications:[],observations:[]},new Date(),async()=>{throw new Error('audit_failed');}),/audit_failed/);
  assert.equal(rolledBack,true);
});

test('terminal retry returns persisted honest result without another update', async () => {
  let updates=0; const terminal=runRow({state:'verified',completed_at:new Date()});
  const {pool}=transactionalPool(async(sql)=>{
    if (/SELECT \* FROM orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[terminal]};
    if (/UPDATE orchestrator_campaign_reconciliation_runs/.test(sql)) updates+=1;
    return {};
  });
  const out=await R._test.finishRun(pool,1,'mrr_test',{state:'failed',classifications:['x'],observations:[]});
  assert.equal(out.state,'verified'); assert.equal(updates,0);
});
