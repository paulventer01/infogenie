'use strict';

// Tenant-scoped persistence for evidence-backed creative artifacts.
// No HTTP, no LLM, no generation, no publishing.

const crypto = require('crypto');
const { fail } = require('./errors');
const C = require('./creative_contracts');
const {
  assertCreativeArtifact,
  approvalContentHash,
  materialChanged,
} = require('./creative_validate');
const { isFakeSource, isLiveSource } = require('./research_honesty');

const UNIQUE_VIOLATION = '23505';

async function withTx(poolOrClient, fn) {
  if (poolOrClient && typeof poolOrClient.connect === 'function') {
    const c = await poolOrClient.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (err) {
      try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    } finally {
      c.release();
    }
  }
  return fn(poolOrClient);
}

function actorId(req) {
  const n = Number(req && req.user && req.user.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function requireActor(opts) {
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'actorUserId')) {
    fail('validation_failed', { field: 'actorUserId', reason: 'untrusted' });
  }
  const id = actorId(opts && opts.req);
  if (!id) fail('validation_failed', { field: 'req', reason: 'auth_required' });
  return id;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function honestyFromEvidence(row) {
  const metrics = row.provider_metrics && typeof row.provider_metrics === 'object'
    ? row.provider_metrics
    : {};
  const source = String(metrics.source || '').trim().toLowerCase();
  if (source) return source;
  return 'unverified';
}

function assertBindableEvidence(row, artifact, citation) {
  if (!row) fail('validation_failed', { field: 'citations', reason: 'missing_evidence' });
  if (Number(row.tenant_id) !== Number(artifact.tenant_id)) {
    fail('validation_failed', { field: 'citations', reason: 'missing_evidence' });
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    fail('validation_failed', { field: 'citations', reason: 'expired_evidence' });
  }
  if (String(row.workflow_id) !== String(artifact.workflow_id)) {
    fail('validation_failed', { field: 'citations', reason: 'cross_workflow_evidence' });
  }
  if (String(row.research_run_id) !== String(citation.research_run_id)
      || String(row.research_run_id) !== String(artifact.research_run_id)) {
    fail('validation_failed', { field: 'citations', reason: 'run_mismatch' });
  }
  if (String(row.run_state) !== 'completed'
      || String(row.approval_gate) !== 'research_execution'
      || String(row.approval_decision) !== 'approved') {
    fail('validation_failed', { field: 'citations', reason: 'unapproved_evidence' });
  }
  if (String(row.content_fingerprint) !== String(citation.evidence_fingerprint)) {
    fail('validation_failed', { field: 'citations', reason: 'fingerprint_mismatch' });
  }
  const liveHonesty = honestyFromEvidence(row);
  if (!C.HONESTY_CLASSES.includes(liveHonesty)) {
    fail('validation_failed', { field: 'citations', reason: 'missing_honesty' });
  }
  if (liveHonesty !== citation.honesty_class) {
    fail('validation_failed', { field: 'citations', reason: 'honesty_mismatch' });
  }
  if (isFakeSource(liveHonesty) && C.LIVE_HONESTY.includes(citation.source_label)) {
    fail('validation_failed', { field: 'citations', reason: 'fixture_as_live' });
  }
  if (isLiveSource(liveHonesty) && C.NON_LIVE_HONESTY.includes(citation.honesty_class)) {
    fail('validation_failed', { field: 'citations', reason: 'honesty_mismatch' });
  }
  const sourceUrl = row.canonical_source_url || null;
  const platformId = row.provider_external_id || null;
  if (citation.source_url && sourceUrl && citation.source_url !== sourceUrl) {
    fail('validation_failed', { field: 'citations', reason: 'source_mismatch' });
  }
  if (citation.platform_source_id && platformId && citation.platform_source_id !== platformId) {
    fail('validation_failed', { field: 'citations', reason: 'source_mismatch' });
  }
}

async function loadEvidenceForBind(client, tenantId, evidenceId) {
  const r = await client.query(
    `SELECT e.id, e.tenant_id, e.research_run_id, e.content_fingerprint,
            e.canonical_source_url, e.provider_external_id, e.expires_at,
            e.captured_at, e.provider_metrics, e.platform,
            r.workflow_id, r.state AS run_state, r.approval_id,
            a.gate AS approval_gate, a.decision AS approval_decision
       FROM orchestrator_research_evidence e
       JOIN orchestrator_research_runs r
         ON r.tenant_id = e.tenant_id AND r.id = e.research_run_id
       JOIN orchestrator_approvals a
         ON a.tenant_id = r.tenant_id AND a.id = r.approval_id
      WHERE e.tenant_id = $1 AND e.id = $2
      LIMIT 1`,
    [tenantId, evidenceId]
  );
  return r.rows[0] || null;
}

async function bindCitations(client, artifact) {
  const bound = [];
  for (const citation of artifact.citations || []) {
    if (String(citation.workflow_id) !== String(artifact.workflow_id)
        && C.CROSS_WORKFLOW_POLICY === 'reject') {
      fail('validation_failed', { field: 'citations', reason: 'cross_workflow_evidence' });
    }
    const row = await loadEvidenceForBind(client, artifact.tenant_id, citation.evidence_id);
    assertBindableEvidence(row, artifact, citation);
    bound.push({
      ...citation,
      captured_at: citation.captured_at || (row.captured_at ? new Date(row.captured_at).toISOString() : artifact.created_at),
      expires_at: citation.expires_at || (row.expires_at ? new Date(row.expires_at).toISOString() : null),
      source_url: citation.source_url || row.canonical_source_url || null,
      platform_source_id: citation.platform_source_id || row.provider_external_id || null,
    });
  }
  return bound;
}

async function insertAudit(client, row) {
  await client.query(
    `INSERT INTO orchestrator_creative_audit
       (tenant_id, artifact_id, artifact_row_id, workflow_id, event,
        actor_user_id, content_hash, evidence_hash, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      row.tenant_id,
      row.artifact_id,
      row.artifact_row_id,
      row.workflow_id,
      row.event,
      row.actor_user_id || null,
      row.content_hash,
      row.evidence_hash,
      JSON.stringify({
        kind: row.kind || null,
        version: row.version || null,
        status: row.status || null,
      }),
    ]
  );
}

async function lockArtifact(client, tenantId, artifactId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `creative_artifact:${tenantId}:${artifactId}`,
  ]);
  const r = await client.query(
    `SELECT * FROM orchestrator_creative_artifacts
      WHERE tenant_id = $1 AND artifact_id = $2
      ORDER BY version DESC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, artifactId]
  );
  return r.rows[0] || null;
}

function publicRow(row, payload) {
  const body = payload && typeof payload === 'object' ? { ...payload } : {};
  body.approval_status = row.status;
  return Object.freeze({
    id: row.id,
    artifact_id: row.artifact_id,
    kind: row.kind,
    tenant_id: row.tenant_id,
    workflow_id: row.workflow_id,
    research_run_id: row.research_run_id,
    version: Number(row.version),
    status: row.status,
    contract_version: row.contract_version,
    content_hash: row.content_hash,
    evidence_hash: row.evidence_hash,
    approval_id: row.approval_id,
    approval_object_version: row.approval_object_version,
    created_by: row.created_by,
    approved_by: row.approved_by,
    created_at: row.created_at,
    approved_at: row.approved_at,
    payload: Object.freeze(body),
  });
}

async function insertCitationRows(client, tenantId, artifactRowId, citations) {
  for (const c of citations) {
    await client.query(
      `INSERT INTO orchestrator_creative_citations
         (id, tenant_id, artifact_row_id, evidence_id, research_run_id, workflow_id,
          source_url, platform_source_id, evidence_fingerprint, evidence_hash,
          honesty_class, source_label, captured_at, expires_at, contract_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz,$15)`,
      [
        newId('cit'),
        tenantId,
        artifactRowId,
        c.evidence_id,
        c.research_run_id,
        c.workflow_id,
        c.source_url,
        c.platform_source_id,
        c.evidence_fingerprint,
        c.evidence_hash,
        c.honesty_class,
        c.source_label,
        c.captured_at,
        c.expires_at,
        c.contract_version || C.CONTRACT_VERSION,
      ]
    );
  }
}

async function insertVersionRow(client, {
  tenantId, payload, citations, version, supersedesId, createdBy, status,
}) {
  const id = newId('cart');
  const body = { ...payload, citations, approval_status: status };
  try {
    await client.query(
      `INSERT INTO orchestrator_creative_artifacts
         (id, tenant_id, artifact_id, kind, workflow_id, research_run_id, version,
          supersedes_id, status, contract_version, content_hash, evidence_hash,
          payload, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
      [
        id,
        tenantId,
        payload.artifact_id,
        payload.kind,
        payload.workflow_id,
        payload.research_run_id,
        version,
        supersedesId,
        status,
        payload.contract_version,
        payload.content_hash,
        payload.evidence_hash,
        JSON.stringify(body),
        createdBy,
      ]
    );
  } catch (err) {
    if (err && err.code === UNIQUE_VIOLATION) {
      fail('validation_failed', { field: 'version', reason: 'duplicate_version' });
    }
    throw err;
  }
  await insertCitationRows(client, tenantId, id, citations);
  return { id, version, status };
}

async function insertCreativeArtifactTx(client, input, opts) {
  const tenantId = opts && opts.tenantId;
  const createdBy = requireActor(opts);
  const payload = assertCreativeArtifact(input, { tenantId });
  const citations = await bindCitations(client, payload);
  const latest = await lockArtifact(client, tenantId, payload.artifact_id);
  if (latest) {
    fail('validation_failed', { field: 'artifact_id', reason: 'already_exists' });
  }
  const inserted = await insertVersionRow(client, {
    tenantId,
    payload: { ...payload, citations },
    citations,
    version: 1,
    supersedesId: null,
    createdBy,
    status: 'draft',
  });
  await insertAudit(client, {
    tenant_id: tenantId,
    artifact_id: payload.artifact_id,
    artifact_row_id: inserted.id,
    workflow_id: payload.workflow_id,
    event: 'created',
    actor_user_id: createdBy,
    content_hash: payload.content_hash,
    evidence_hash: payload.evidence_hash,
    kind: payload.kind,
    version: 1,
    status: 'draft',
  });
  const row = (await client.query(
    `SELECT * FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND id=$2`,
    [tenantId, inserted.id]
  )).rows[0];
  return publicRow(row, { ...payload, citations, approval_status: 'draft' });
}

async function reviseCreativeArtifactTx(client, input, opts) {
  const tenantId = opts && opts.tenantId;
  const createdBy = requireActor(opts);
  const payload = assertCreativeArtifact(input, { tenantId });
  const citations = await bindCitations(client, payload);
  const latest = await lockArtifact(client, tenantId, payload.artifact_id);
  if (!latest) fail('not_found');
  if (String(latest.kind) !== String(payload.kind)) {
    fail('validation_failed', { field: 'kind', reason: 'kind_mismatch' });
  }
  const nextVersion = Number(latest.version) + 1;
  const wasApproved = latest.status === 'approved';
  const changed = materialChanged(latest.payload, { ...payload, citations });
  if (wasApproved && !changed) {
    return publicRow(latest, latest.payload);
  }
  if (latest.status === 'draft' || wasApproved) {
    await client.query(
      `UPDATE orchestrator_creative_artifacts
          SET status = $3
        WHERE tenant_id = $1 AND id = $2 AND status = $4`,
      [tenantId, latest.id, wasApproved || latest.status === 'draft' ? 'superseded' : latest.status, latest.status]
    );
  }
  const inserted = await insertVersionRow(client, {
    tenantId,
    payload: { ...payload, citations },
    citations,
    version: nextVersion,
    supersedesId: latest.id,
    createdBy,
    status: 'draft',
  });
  if (wasApproved) {
    await insertAudit(client, {
      tenant_id: tenantId,
      artifact_id: payload.artifact_id,
      artifact_row_id: latest.id,
      workflow_id: payload.workflow_id,
      event: 'invalidated',
      actor_user_id: createdBy,
      content_hash: latest.content_hash,
      evidence_hash: latest.evidence_hash,
      kind: payload.kind,
      version: Number(latest.version),
      status: 'superseded',
    });
    await insertAudit(client, {
      tenant_id: tenantId,
      artifact_id: payload.artifact_id,
      artifact_row_id: latest.id,
      workflow_id: payload.workflow_id,
      event: 'superseded',
      actor_user_id: createdBy,
      content_hash: latest.content_hash,
      evidence_hash: latest.evidence_hash,
      kind: payload.kind,
      version: Number(latest.version),
      status: 'superseded',
    });
  }
  await insertAudit(client, {
    tenant_id: tenantId,
    artifact_id: payload.artifact_id,
    artifact_row_id: inserted.id,
    workflow_id: payload.workflow_id,
    event: 'revised',
    actor_user_id: createdBy,
    content_hash: payload.content_hash,
    evidence_hash: payload.evidence_hash,
    kind: payload.kind,
    version: nextVersion,
    status: 'draft',
  });
  const row = (await client.query(
    `SELECT * FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND id=$2`,
    [tenantId, inserted.id]
  )).rows[0];
  return publicRow(row, { ...payload, citations, approval_status: 'draft' });
}

async function approveCreativeArtifactTx(client, opts) {
  const tenantId = opts && opts.tenantId;
  const actorUserId = requireActor(opts);
  const artifactId = String(opts.artifactId || '');
  if (!artifactId) fail('validation_failed', { field: 'artifactId', reason: 'required' });
  const claimedVersion = Number(opts && opts.objectVersion);
  if (!Number.isInteger(claimedVersion)) fail('validation_failed', { field: 'objectVersion', reason: 'required' });
  if (!opts || opts.contentHash == null || opts.contentHash === '') {
    fail('validation_failed', { field: 'contentHash', reason: 'required' });
  }
  const latest = await lockArtifact(client, tenantId, artifactId);
  if (!latest) fail('not_found');
  if (latest.status !== 'draft') {
    fail('validation_failed', { field: 'status', reason: 'not_draft' });
  }
  const hash = approvalContentHash(latest.content_hash, latest.evidence_hash);
  if (claimedVersion !== Number(latest.version)) fail('approval_stale');
  if (String(opts.contentHash) !== hash) fail('approval_stale');
  const approval = (await client.query(
    `INSERT INTO orchestrator_approvals (
       tenant_id, workflow_id, gate, object_type, object_id, object_version,
       content_hash, approved_platforms, actor_user_id, decision, permission_snapshot
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'[]'::jsonb,$8,'approved','[]'::jsonb
     ) RETURNING id, object_version, content_hash`,
    [
      tenantId,
      latest.workflow_id,
      C.APPROVAL_GATE,
      C.APPROVAL_OBJECT_TYPE,
      latest.artifact_id,
      latest.version,
      hash,
      actorUserId,
    ]
  )).rows[0];
  const updated = await client.query(
    `UPDATE orchestrator_creative_artifacts
        SET status = 'approved',
            approval_id = $3,
            approval_object_version = $4,
            approved_by = $5,
            approved_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
      RETURNING *`,
    [tenantId, latest.id, approval.id, approval.object_version, actorUserId]
  );
  if (!updated.rowCount) fail('approval_stale');
  const row = updated.rows[0];
  await insertAudit(client, {
    tenant_id: tenantId,
    artifact_id: row.artifact_id,
    artifact_row_id: row.id,
    workflow_id: row.workflow_id,
    event: 'approved',
    actor_user_id: actorUserId,
    content_hash: row.content_hash,
    evidence_hash: row.evidence_hash,
    kind: row.kind,
    version: Number(row.version),
    status: 'approved',
  });
  return publicRow(row, row.payload);
}

async function loadCreativeArtifact(client, opts) {
  const tenantId = opts && opts.tenantId;
  const artifactId = String(opts.artifactId || '');
  if (!artifactId) fail('validation_failed', { field: 'artifactId', reason: 'required' });
  const version = opts.version == null ? null : Number(opts.version);
  const r = version
    ? await client.query(
      `SELECT * FROM orchestrator_creative_artifacts
        WHERE tenant_id=$1 AND artifact_id=$2 AND version=$3`,
      [tenantId, artifactId, version]
    )
    : await client.query(
      `SELECT * FROM orchestrator_creative_artifacts
        WHERE tenant_id=$1 AND artifact_id=$2
        ORDER BY version DESC LIMIT 1`,
      [tenantId, artifactId]
    );
  if (!r.rowCount) fail('not_found');
  const row = r.rows[0];
  return publicRow(row, row.payload);
}

function insertCreativeArtifact(poolOrClient, input, opts) {
  return withTx(poolOrClient, (client) => insertCreativeArtifactTx(client, input, opts));
}

function reviseCreativeArtifact(poolOrClient, input, opts) {
  return withTx(poolOrClient, (client) => reviseCreativeArtifactTx(client, input, opts));
}

function approveCreativeArtifact(poolOrClient, opts) {
  return withTx(poolOrClient, (client) => approveCreativeArtifactTx(client, opts));
}

module.exports = {
  insertCreativeArtifact,
  reviseCreativeArtifact,
  approveCreativeArtifact,
  loadCreativeArtifact,
  approvalContentHash,
};
