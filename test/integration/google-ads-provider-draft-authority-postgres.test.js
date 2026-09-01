'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../db');
const schema = require('../../services/agent_orchestrator/schema');
const authority = require('../../services/security/google_ads_provider_draft_capabilities');
const { makeFixtures } = require('../helpers');

const H = crypto.createHash('sha256').update('{}').digest('hex');
const CUSTOMER = '123-456-7890';
const FP = crypto.createHash('sha256').update('1234567890').digest('hex');
const permit = (key) => key === authority.PERMISSION;
const denied = (code) => (error) => error && error.code === code;

async function tx(fn) {
  const client = await db.getPool().connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function replica(sql, params = []) {
  const client = await db.getPool().connect();
  try {
    await client.query("SET session_replication_role='replica'");
    // node-postgres cannot use extended-query parameters with a multi-command
    // fixture batch. Render only these locally generated scalar fixture values;
    // lifecycle code below continues to use ordinary parameterized queries.
    if (sql.split(';').filter((part) => part.trim()).length > 1 && params.length) {
      const literal = (value) => typeof value === 'number'
        ? String(value)
        : `'${String(value).replaceAll("'", "''")}'`;
      const rendered = sql.replace(/\$(\d+)/g, (_match, index) => literal(params[Number(index) - 1]));
      return await client.query(rendered);
    }
    return await client.query(sql, params);
  } finally {
    await client.query("SET session_replication_role='origin'");
    client.release();
  }
}

if (!db.hasDb()) {
  test('PR10A PostgreSQL authority requires DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else test('Google Ads authority is isolated, stale-safe, atomic, and single-use under PostgreSQL concurrency', async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await schema.ensureAgentOrchestratorSchema();
  const tenant = await fx.seedTenant();
  const otherTenant = await fx.seedTenant();
  const user = await fx.seedUser({ tenantId: tenant.id, owner: false });
  const otherUser = await fx.seedUser({ tenantId: tenant.id, owner: false });
  const tag = crypto.randomUUID();
  const workflowApprovalId = 100000000 + parseInt(tag.slice(0, 7), 16);
  const id = (kind) => `${kind}-${tag}`;
  const ids = { workflow:id('workflow'), draft:id('draft'), approval:id('approval'),
    request:id('request'), intent:id('intent'), credential:id('credential') };

  t.after(async () => replica(`
    DELETE FROM orchestrator_audit_events WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_google_ads_provider_draft_confirmations WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_delivery_intents WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_publish_requests WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_publish_approvals WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_draft_revisions WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_drafts WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_tenant_google_ads_credential_refs WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_approvals WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_workflows WHERE tenant_id IN ($1,$2);
    DELETE FROM tenant_users WHERE tenant_id IN ($1,$2);
    DELETE FROM users WHERE id IN ($3,$4);
    DELETE FROM tenants WHERE id IN ($1,$2)`, [tenant.id, otherTenant.id, user.id, otherUser.id]));

  await replica(`
    INSERT INTO roles(tenant_id,key,name,permissions)
      VALUES($2,$17,'PR10A authority','["advertising.provider_drafts.create"]'::jsonb);
    UPDATE tenant_users SET role_id=(SELECT id FROM roles WHERE tenant_id=$2 AND key=$17)
      WHERE tenant_id=$2 AND user_id=$3;
    INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'PR10A fixture');
    INSERT INTO orchestrator_approvals(id,tenant_id,workflow_id,gate,content_hash,decision,actor_user_id)
      VALUES(${workflowApprovalId},$2,$1,'campaign_publishing',$5,'approved',$3);
    INSERT INTO orchestrator_campaign_drafts
      (id,tenant_id,workflow_id,status,current_revision,contract_hash,idempotency_key)
      VALUES($4,$2,$1,'approved_for_publish',1,$5,$6);
    INSERT INTO orchestrator_campaign_draft_revisions
      (id,tenant_id,draft_id,revision,contract_json,contract_hash,validation_status)
      VALUES($7,$2,$4,1,'{}',$5,'passed');
    INSERT INTO orchestrator_campaign_publish_approvals
      (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
      VALUES($8,$2,$4,1,$5,'{}',${workflowApprovalId},$3,$9,now()+interval '1 hour');
    INSERT INTO orchestrator_campaign_publish_requests
      (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,idempotency_key,request_hash)
      VALUES($10,$2,$4,$8,${workflowApprovalId},1,$5,$5,$3,$11,$5);
    INSERT INTO orchestrator_campaign_delivery_intents
      (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
      VALUES($12,$2,$10,$4,$8,${workflowApprovalId},$13,1,$5,$5,$5,$14,$3);
    INSERT INTO orchestrator_tenant_google_ads_credential_refs
      (tenant_id,id,account_fingerprint,version,owner_user_id) VALUES($2,$15,$16,1,$3)`,
  [ids.workflow,tenant.id,user.id,ids.draft,H,id('draft-key'),id('revision'),ids.approval,
    id('approval-key'),ids.request,id('request-key'),ids.intent,id('outbox'),id('intent-key'),ids.credential,FP,id('role')]);

  const base = { tenantId:tenant.id, actorUserId:user.id, actorType:'human', principalType:'user',
    sessionId:id('session'), hasExplicitTenantPermission:permit, draftId:ids.draft, draftRevision:1,
    publishingRequestId:ids.request, publishApprovalId:ids.approval, intentId:ids.intent,
    credentialRefId:ids.credential, credentialRefVersion:1, googleAdsCustomerId:CUSTOMER,
    ttlMs:300000 };
  const issue = async (overrides = {}) => tx(async (c) => {
    const input={...base,...overrides};
    if(!input.finalConfirmationId) {
      const confirmation=await authority.confirm(c,{...input,finalConfirmation:authority.CONFIRMATION});
      input.finalConfirmationId=confirmation.confirmation_id;
    }
    return authority.issue(c,input);
  });

  await assert.rejects(issue({ tenantId:otherTenant.id }), denied('authority_not_found'));
  await assert.rejects(issue({ actorUserId:user.id + 99999 }), denied('authority_not_found'));
  await assert.rejects(issue({ sessionId:id('wrong'), principalType:'worker' }), denied('human_session_required'));
  await assert.rejects(issue({ hasExplicitTenantPermission:()=>false }), denied('permission_denied'));

  for (const [table,column] of [
    ['orchestrator_campaign_publish_approvals','actor_user_id'],
    ['orchestrator_campaign_publish_requests','requested_by'],
    ['orchestrator_campaign_delivery_intents','requested_by'],
  ]) {
    await replica(`UPDATE ${table} SET ${column}=$3 WHERE tenant_id=$1 AND ${table.endsWith('approvals')?'id=$2':table.endsWith('requests')?'id=$2':'id=$2'}`,
      [tenant.id, table.endsWith('approvals')?ids.approval:table.endsWith('requests')?ids.request:ids.intent, otherUser.id]);
    await assert.rejects(issue({finalConfirmationId:id(`lineage-${column}`),confirmedAt:new Date()}),denied('authoritative_binding_mismatch'));
    await replica(`UPDATE ${table} SET ${column}=$3 WHERE tenant_id=$1 AND id=$2`,
      [tenant.id, table.endsWith('approvals')?ids.approval:table.endsWith('requests')?ids.request:ids.intent, user.id]);
  }

  for (const status of ['cancelled','approval_expired','ready_for_approval']) {
    await replica('UPDATE orchestrator_campaign_drafts SET status=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft,status]);
    await assert.rejects(issue({finalConfirmationId:id(`issue-${status}`),confirmedAt:new Date()}),denied('authoritative_binding_mismatch'));
  }
  await replica("UPDATE orchestrator_campaign_drafts SET status='approved_for_publish' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.draft]);

  const raced = await Promise.allSettled([issue(), issue()]);
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1,
    raced.map((r) => r.reason && `${r.reason.code}:${r.reason.message}`).join(','));
  assert.equal(raced.filter((r) => r.status === 'rejected').length, 1);
  const cap = raced.find((r) => r.status === 'fulfilled').value;
  assert.equal(cap.external_action_taken, false);
  assert.deepEqual(Object.keys(cap).sort(), ['capability_id','consumed_at','expires_at','external_action_taken',
    'issued_at','reserved_at','revoked_at','status'].sort());

  const action = (method, extra = {}, common = {}) => tx((c) => authority[method](c,
    { ...base, capabilityId:cap.capability_id, ...common, ...extra }));
  await assert.rejects(action('reserve',{reservationId:id('wrong-tenant')},{tenantId:otherTenant.id}),denied('capability_rejected'));
  await assert.rejects(action('reserve',{reservationId:id('wrong-session')},{sessionId:id('other-session')}),denied('capability_rejected'));

  for (const status of ['cancelled','approval_expired','ready_for_approval']) {
    await replica('UPDATE orchestrator_campaign_drafts SET status=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft,status]);
    await assert.rejects(action('reserve',{reservationId:id(`reserve-${status}`)}),denied('authoritative_binding_mismatch'));
  }
  await replica("UPDATE orchestrator_campaign_drafts SET status='approved_for_publish' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.draft]);

  await replica('UPDATE orchestrator_campaign_drafts SET current_revision=2 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft]);
  await assert.rejects(action('reserve',{reservationId:id('stale-draft')}),denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_campaign_drafts SET current_revision=1 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft]);
  await replica("UPDATE orchestrator_campaign_publish_approvals SET revoked_at=now(),revoke_reason='test' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.approval]);
  await assert.rejects(action('reserve',{reservationId:id('revoked-approval')}),denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_campaign_publish_approvals SET revoked_at=NULL,revoke_reason=NULL WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.approval]);
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET version=2 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential]);
  await assert.rejects(action('reserve',{reservationId:id('stale-credential')}),denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET version=1,account_fingerprint=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential,'a'.repeat(64)]);
  await assert.rejects(action('reserve',{reservationId:id('stale-account')}),denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET account_fingerprint=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential,FP]);
  await db.getPool().query("UPDATE orchestrator_advertising_tenant_kill_switches SET active=true,version=version+1,updated_at=now()+interval '1 second' WHERE tenant_id=$1 AND switch_key='google_ads_provider_draft'",[tenant.id]);
  await assert.rejects(action('reserve',{reservationId:id('kill-switch')}),denied('authoritative_binding_mismatch'));
  await db.getPool().query("UPDATE orchestrator_advertising_tenant_kill_switches SET active=false,version=version+1,updated_at=now()+interval '2 seconds' WHERE tenant_id=$1 AND switch_key='google_ads_provider_draft'",[tenant.id]);

  await assert.rejects(tx(async (c) => { await authority.reserve(c,{...base,capabilityId:cap.capability_id,reservationId:id('rollback')});throw new Error('injected');}),/injected/);
  assert.equal((await db.getPool().query('SELECT status FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id=$1 AND id=$2',[tenant.id,cap.capability_id])).rows[0].status,'issued');

  const reservations = await Promise.allSettled([1,2].map((n) => action('reserve',{reservationId:id(`reservation-${n}`)})));
  assert.equal(reservations.filter((r) => r.status === 'fulfilled').length,1);
  const winner = reservations.find((r) => r.status === 'fulfilled').value;
  assert.equal(winner.external_action_taken,false);
  const stored = (await db.getPool().query('SELECT reservation_id_hash FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id=$1 AND id=$2',[tenant.id,cap.capability_id])).rows[0];
  const reservation = [1,2].map((n)=>id(`reservation-${n}`)).find((value)=>crypto.createHash('sha256').update(value).digest('hex')===stored.reservation_id_hash);
  for (const status of ['cancelled','approval_expired','ready_for_approval']) {
    await replica('UPDATE orchestrator_campaign_drafts SET status=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft,status]);
    await assert.rejects(action('consume',{reservationId:reservation,invocationId:id(`consume-${status}`)}),denied('authoritative_binding_mismatch'));
  }
  await replica("UPDATE orchestrator_campaign_drafts SET status='approved_for_publish' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.draft]);
  const consumes = await Promise.allSettled([1,2].map((n)=>action('consume',{reservationId:reservation,invocationId:id(`invocation-${n}`)})));
  assert.equal(consumes.filter((r)=>r.status==='fulfilled').length,1);
  assert.equal(consumes.find((r)=>r.status==='fulfilled').value.external_action_taken,false);
  await assert.rejects(action('consume',{reservationId:reservation,invocationId:id('replay')}),denied('capability_rejected'));
  const replayConfirmation=await tx((c)=>authority.confirm(c,{...base,finalConfirmation:authority.CONFIRMATION}));
  const confirmationRace=await Promise.allSettled([1,2].map(()=>issue({finalConfirmationId:replayConfirmation.confirmation_id})));
  assert.equal(confirmationRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(confirmationRace.filter((result)=>result.status==='rejected'&&result.reason?.code==='fresh_confirmation_required').length,1);
  const replayed=confirmationRace.find((result)=>result.status==='fulfilled').value;
  await tx((c)=>authority.revoke(c,{...base,capabilityId:replayed.capability_id}));
  await assert.rejects(issue({finalConfirmationId:replayConfirmation.confirmation_id}),denied('fresh_confirmation_required'));

  const expiryIds={draft:id('expiry-draft'),approval:id('expiry-approval'),request:id('expiry-request'),intent:id('expiry-intent')};
  await replica(`
    INSERT INTO orchestrator_campaign_drafts
      (id,tenant_id,workflow_id,status,current_revision,contract_hash,idempotency_key)
      VALUES($1,$2,$3,'approved_for_publish',1,$4,$5);
    INSERT INTO orchestrator_campaign_draft_revisions
      (id,tenant_id,draft_id,revision,contract_json,contract_hash,validation_status)
      VALUES($6,$2,$1,1,'{}',$4,'passed');
    INSERT INTO orchestrator_campaign_publish_approvals
      (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
      VALUES($7,$2,$1,1,$4,'{}',${workflowApprovalId},$8,$9,clock_timestamp()+interval '2 seconds');
    INSERT INTO orchestrator_campaign_publish_requests
      (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,idempotency_key,request_hash)
      VALUES($10,$2,$1,$7,${workflowApprovalId},1,$4,$4,$8,$11,$4);
    INSERT INTO orchestrator_campaign_delivery_intents
      (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
      VALUES($12,$2,$10,$1,$7,${workflowApprovalId},$13,1,$4,$4,$4,$14,$8)`,
  [expiryIds.draft,tenant.id,ids.workflow,H,id('expiry-draft-key'),id('expiry-revision'),expiryIds.approval,
    user.id,id('expiry-approval-key'),expiryIds.request,id('expiry-request-key'),expiryIds.intent,
    id('expiry-outbox'),id('expiry-intent-key')]);
  const expiryBase={...base,draftId:expiryIds.draft,publishApprovalId:expiryIds.approval,
    publishingRequestId:expiryIds.request,intentId:expiryIds.intent};
  const approvalClockCap=await issue(expiryBase);
  const blocker=await db.getPool().connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT 1 FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant.id,expiryIds.approval]);
  const waitingReserve=tx((c)=>authority.reserve(c,{...expiryBase,capabilityId:approvalClockCap.capability_id,reservationId:id('approval-expiry-wait')}));
  await new Promise((resolve)=>setTimeout(resolve,2100));
  await blocker.query('COMMIT');blocker.release();
  const approvalExpired=await waitingReserve;
  assert.deepEqual(approvalExpired,{expired:true,capability_id:approvalClockCap.capability_id,error:'capability_expired',external_action_taken:false});
  await assert.rejects(db.getPool().query("UPDATE orchestrator_google_ads_provider_draft_capabilities SET status='issued' WHERE tenant_id=$1 AND id=$2",[tenant.id,cap.capability_id]),/orchestrator_gapdc_immutable/);

  const revoked = await issue();
  await action('revoke',{}, {capabilityId:revoked.capability_id});
  await assert.rejects(action('consume',{reservationId:id('none'),invocationId:id('revoked')},{capabilityId:revoked.capability_id}),denied('capability_rejected'));
  const expiring = await issue({ttlMs:1});
  await new Promise((resolve)=>setTimeout(resolve,5));
  const expired = await action('reserve',{reservationId:id('expired')},{capabilityId:expiring.capability_id});
  assert.deepEqual(expired,{expired:true,capability_id:expiring.capability_id,
    error:'capability_expired',external_action_taken:false});
  assert.equal(Object.hasOwn(expired,'cap'),false);
  await assert.rejects(action('reserve',{reservationId:id('revive')},{capabilityId:expiring.capability_id}),denied('capability_rejected'));

  const elapsed = await issue({ttlMs:1});
  await new Promise((resolve)=>setTimeout(resolve,5));
  const elapsedView = await action('get',{}, {capabilityId:elapsed.capability_id});
  assert.equal(elapsedView.status,'expired');
  const replacement = await issue();
  assert.equal(replacement.status,'issued');

  const audits = await db.getPool().query('SELECT event,detail::text FROM orchestrator_audit_events WHERE tenant_id=$1 AND workflow_id=$2',[tenant.id,ids.workflow]);
  assert.ok(audits.rowCount>=7);for(const row of audits.rows){assert.deepEqual(Object.keys(JSON.parse(row.detail)),['capability_id']);assert.doesNotMatch(row.detail,/123-?456|credential|token|googleapis|https?:/i);}
});
