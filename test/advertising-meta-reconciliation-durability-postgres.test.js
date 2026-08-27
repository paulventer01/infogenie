'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../db');
const R = require('../services/agent_orchestrator/meta_paused_draft_reconciliation');
const A = require('../services/agent_orchestrator/meta_reconciliation_read_authorizations');

const suffix=`${Date.now()}_${Math.random().toString(36).slice(2)}`.replace(/[^a-z0-9_]/gi,'');
const schema=`recon_dur_${suffix}`;
const invocationId='invocation';
const invocationHash=crypto.createHash('sha256').update(String(invocationId)).digest('hex');
const now=new Date('2026-08-27T00:00:00.000Z');
const later=new Date(now.getTime()+R.OBSERVATION_LEASE_MS+1);

if (!db.hasDb()) {
  test('PostgreSQL reconciliation durability skipped — no DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});
} else {
  const root=db.getPool(); let lockClient;
  async function connect() {
    const client=await root.connect();
    await client.query(`SET search_path TO ${schema},public`);
    return client;
  }
  const pool={
    connect,
    async query(sql,params) { const c=await connect(); try { return await c.query(sql,params); } finally { c.release(); } },
  };
  async function audit(c,row,event) {
    await c.query(`INSERT INTO orchestrator_audit_events
      (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [row.tenant_id,row.workflow_id,event,row.requested_by,JSON.stringify({reconciliation_run_id:row.id,audit_reference:row.audit_ref})]);
  }
  function consumed() {
    return { authorization_id:'mra_test',invocation_id_hash:invocationHash,tenant_id:1,requested_by:1,
      workflow_id:'wf',draft_id:'draft',execution_id:'execution',publishing_request_id:'request',
      snapshot_hash:'a'.repeat(64),intent_id:'intent',intent_hash:'b'.repeat(64),credential_ref_id:'cred',
      credential_ref_version:1,account_fingerprint:'c'.repeat(64),ledger_root_hash:'d'.repeat(64),ledger_objects:[] };
  }
  async function consumeIntoRun(c,_opts,run) {
    const auth=await c.query(`SELECT * FROM orchestrator_campaign_reconciliation_read_authorizations
      WHERE tenant_id=1 AND id='mra_test' FOR UPDATE`);
    if (auth.rows[0].status!=='issued') { const e=new Error('authorization_rejected'); e.code='authorization_rejected'; throw e; }
    const inserted=await c.query(`INSERT INTO orchestrator_campaign_reconciliation_runs
      (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,
       execution_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,
       ledger_root_hash,state,audit_ref,observing_at,observation_deadline)
      VALUES(1,$1,'mra_test',$2,1,'wf','draft','request','execution',$3,'intent',$4,'cred',1,$5,$6,
        'observing',$7,$8,$9) RETURNING *`,
    [run.id,invocationHash,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),'d'.repeat(64),run.auditRef,run.observingAt,run.observationDeadline]);
    await c.query(`UPDATE orchestrator_campaign_reconciliation_read_authorizations
      SET status='consumed',invocation_id_hash=$1 WHERE tenant_id=1 AND id='mra_test'`,[invocationHash]);
    await c.query(`INSERT INTO orchestrator_audit_events(tenant_id,workflow_id,event,actor_user_id,detail)
      VALUES(1,'wf','authorization_consumed',1,'{}')`);
    return {consumed:consumed(),row:inserted.rows[0]};
  }
  async function reset() {
    await pool.query(`TRUNCATE orchestrator_audit_events,orchestrator_campaign_reconciliation_runs,
      orchestrator_campaign_reconciliation_read_authorizations`);
    await pool.query(`INSERT INTO orchestrator_campaign_reconciliation_read_authorizations
      (tenant_id,id,status,invocation_id_hash) VALUES(1,'mra_test','issued',NULL)`);
  }
  async function counts() {
    return {
      authorization:(await pool.query(`SELECT status FROM orchestrator_campaign_reconciliation_read_authorizations
        WHERE tenant_id=1 AND id='mra_test'`)).rows[0].status,
      runs:(await pool.query(`SELECT count(*)::int n FROM orchestrator_campaign_reconciliation_runs`)).rows[0].n,
      audits:(await pool.query(`SELECT count(*)::int n FROM orchestrator_audit_events`)).rows[0].n,
    };
  }
  async function observing(deadline=new Date(now.getTime()+R.OBSERVATION_LEASE_MS)) {
    await pool.query(`UPDATE orchestrator_campaign_reconciliation_read_authorizations
      SET status='consumed',invocation_id_hash=$1 WHERE tenant_id=1 AND id='mra_test'`,[invocationHash]);
    await pool.query(`INSERT INTO orchestrator_campaign_reconciliation_runs
      (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,
       execution_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,
       ledger_root_hash,state,audit_ref,observing_at,observation_deadline)
      VALUES(1,'mrr_existing','mra_test',$1,1,'wf','draft','request','execution',$2,'intent',$3,'cred',1,$4,$5,
        'observing','mrr-audit:existing',$6,$7)`,
    [invocationHash,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),'d'.repeat(64),now,deadline]);
  }

  before(async()=>{
    lockClient=await root.connect();
    await lockClient.query(`SELECT pg_advisory_lock(hashtext($1))`,[schema]);
    await lockClient.query(`CREATE SCHEMA ${schema}`);
    await lockClient.query(`CREATE TABLE ${schema}.orchestrator_campaign_reconciliation_read_authorizations(
      tenant_id int NOT NULL,id text NOT NULL,status text NOT NULL,invocation_id_hash text,PRIMARY KEY(tenant_id,id))`);
    await lockClient.query(`CREATE TABLE ${schema}.orchestrator_campaign_reconciliation_runs(
      tenant_id int NOT NULL,id text NOT NULL,authorization_id text NOT NULL,invocation_id_hash text NOT NULL,
      requested_by int NOT NULL,workflow_id text NOT NULL,draft_id text NOT NULL,publishing_request_id text NOT NULL,
      execution_id text NOT NULL,snapshot_hash text NOT NULL,intent_id text NOT NULL,intent_hash text NOT NULL,
      credential_ref_id text NOT NULL,credential_ref_version int NOT NULL,account_fingerprint text NOT NULL,
      ledger_root_hash text NOT NULL,state text NOT NULL,observations jsonb NOT NULL DEFAULT '[]',
      classifications text[] NOT NULL DEFAULT '{}',audit_ref text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      observing_at timestamptz,observation_deadline timestamptz,completed_at timestamptz,
      PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,authorization_id),UNIQUE(tenant_id,invocation_id_hash),
      CHECK(state IN('observing','verified','discrepancy_detected','failed')))`);
    await lockClient.query(`CREATE TABLE ${schema}.orchestrator_audit_events(
      id bigserial PRIMARY KEY,tenant_id int NOT NULL,workflow_id text NOT NULL,event text NOT NULL,
      actor_user_id int NOT NULL,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  });
  after(async()=>{
    await lockClient.query(`DROP SCHEMA ${schema} CASCADE`);
    await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`,[schema]); lockClient.release();
  });

  test('D1 failures before/at run insertion roll back authorization, run and audits',async()=>{
    await reset();
    await assert.rejects(R._test.createObservingRun(pool,{},1,'mra_test',invocationHash,now,
      async()=>{throw new Error('before_insert');},audit),/before_insert/);
    assert.deepEqual(await counts(),{authorization:'issued',runs:0,audits:0});

    const c=await connect(); await c.query(`CREATE FUNCTION reject_run() RETURNS trigger LANGUAGE plpgsql AS
      $$BEGIN RAISE EXCEPTION 'run_insert_failed'; END$$`);
    await c.query(`CREATE TRIGGER reject_run BEFORE INSERT ON orchestrator_campaign_reconciliation_runs
      FOR EACH ROW EXECUTE FUNCTION reject_run()`); c.release();
    await assert.rejects(R._test.createObservingRun(pool,{},1,'mra_test',invocationHash,now,consumeIntoRun,audit),/run_insert_failed/);
    assert.deepEqual(await counts(),{authorization:'issued',runs:0,audits:0});
    await pool.query(`DROP TRIGGER reject_run ON orchestrator_campaign_reconciliation_runs`);
  });

  test('D1 initial-audit failure rolls back run and consumed authorization',async()=>{
    await reset();
    await assert.rejects(R._test.createObservingRun(pool,{},1,'mra_test',invocationHash,now,consumeIntoRun,
      async(c)=>{await c.query(`INSERT INTO missing_initial_audit VALUES(1)`);}),/missing_initial_audit/);
    assert.deepEqual(await counts(),{authorization:'issued',runs:0,audits:0});
  });

  test('D1 concurrent PostgreSQL starts create and consume once; loser observes no provider',async()=>{
    await reset(); let entries=0; let releaseFirst; const release=new Promise(r=>{releaseFirst=r;}); let both;
    const bothEntered=new Promise(r=>{both=r;});
    const concurrentConsume=async(c,o,run)=>{
      entries+=1; if(entries===2) both();
      const locked=await c.query(`SELECT status FROM orchestrator_campaign_reconciliation_read_authorizations
        WHERE tenant_id=1 AND id='mra_test' FOR UPDATE`);
      if(entries===1) await release;
      if(locked.rows[0].status!=='issued'){const e=new Error('authorization_rejected');e.code='authorization_rejected';throw e;}
      return consumeIntoRun(c,o,run);
    };
    const originalConsume=A.consumeIntoReconciliationRun; const originalObserve=A.observeWithConsumedCredential;
    let providerCalls=0; let finishProvider;
    A.consumeIntoReconciliationRun=concurrentConsume;
    A.observeWithConsumedCredential=async()=>{providerCalls+=1;await new Promise(r=>{finishProvider=r;});return {attempted_observations:0,completed_observations:0,observations:[]};};
    const opts={tenantId:1,requestedBy:1,authorizationId:'mra_test',invocationId,hasPermission:()=>true,now};
    try {
      const first=R.reconcile(pool,opts); const second=R.reconcile(pool,opts);
      await bothEntered; releaseFirst(); const loser=await second;
      assert.equal(loser.state,'observing'); assert.equal(providerCalls,1);
      finishProvider(); await first;
      assert.deepEqual(await counts(),{authorization:'consumed',runs:1,audits:3});
    } finally { A.consumeIntoReconciliationRun=originalConsume; A.observeWithConsumedCredential=originalObserve; }
  });

  test('D2 real observing replay and stale recovery never invoke provider',async()=>{
    await reset(); await observing(); let providerCalls=0;
    const inProgress=await R._test.existingOrRecover(pool,1,'mra_test',invocationHash,new Date(now.getTime()+1),async()=>{providerCalls+=1;});
    assert.equal(inProgress.state,'observing'); assert.equal(providerCalls,0);
    const failed=await R._test.existingOrRecover(pool,1,'mra_test',invocationHash,later,audit);
    assert.equal(failed.state,'failed'); assert.deepEqual(failed.failure_classifications,['interrupted_observation']);
    assert.equal(providerCalls,0);
    const row=(await pool.query(`SELECT state,classifications FROM orchestrator_campaign_reconciliation_runs`)).rows[0];
    assert.equal(row.state,'failed'); assert.deepEqual(row.classifications,['interrupted_observation']);
    assert.equal((await counts()).authorization,'consumed');
  });

  test('D2 stale-recovery audit failure rolls terminal state back',async()=>{
    await reset(); await observing();
    await assert.rejects(R._test.existingOrRecover(pool,1,'mra_test',invocationHash,later,
      async(c)=>{await c.query(`INSERT INTO missing_recovery_audit VALUES(1)`);}),/missing_recovery_audit/);
    assert.equal((await pool.query(`SELECT state FROM orchestrator_campaign_reconciliation_runs`)).rows[0].state,'observing');
  });

  for (const state of ['verified','discrepancy_detected','failed']) test(`D3 ${state} audit failure rolls settlement back`,async()=>{
    await reset(); await observing();
    await assert.rejects(R._test.finishRun(pool,1,'mrr_existing',{state,classifications:[state],observations:[]},later,
      async(c)=>{await c.query(`INSERT INTO missing_terminal_audit VALUES(1)`);}),/missing_terminal_audit/);
    assert.equal((await pool.query(`SELECT state FROM orchestrator_campaign_reconciliation_runs`)).rows[0].state,'observing');
  });

  test('D3 terminal state and audit commit together; retry is read-only',async()=>{
    await reset(); await observing();
    const done=await R._test.finishRun(pool,1,'mrr_existing',{state:'verified',classifications:[],observations:[]},later,audit);
    assert.equal(done.state,'verified');
    const audits=(await pool.query(`SELECT event FROM orchestrator_audit_events ORDER BY id`)).rows;
    assert.deepEqual(audits.map(x=>x.event),['meta_paused_draft_reconciliation_verified']);
    const again=await R._test.finishRun(pool,1,'mrr_existing',{state:'failed',classifications:['wrong'],observations:[]},later,audit);
    assert.equal(again.state,'verified');
    assert.equal((await pool.query(`SELECT count(*)::int n FROM orchestrator_audit_events`)).rows[0].n,1);
  });
}
