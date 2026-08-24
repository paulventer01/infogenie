'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');
const { OrchError } = require('../services/agent_orchestrator/errors');
const {
  insertEvidenceItem,
  insertCompetitor,
  ensureResearchLimits,
} = require('../services/agent_orchestrator/research_store');
const { nonLiveHonestyMetrics } = require('../services/agent_orchestrator/research_honesty');
const {
  insertCreativeArtifact,
  reviseCreativeArtifact,
  approveCreativeArtifact,
  loadCreativeArtifact,
} = require('../services/agent_orchestrator/creative_store');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');

const HAS_DB = db.hasDb();
const SUFFIX = `aoc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`;
}

function isValidation(err, reason) {
  return err instanceof OrchError && err.code === 'validation_failed' && (!reason || err.extra.reason === reason);
}

async function insertWorkflow(p, tenantId, wfId) {
  await p.query(
    `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
    [wfId, tenantId, `creative host ${wfId}`]
  );
}

async function insertApproval(p, tenantId, wfId) {
  const row = (await p.query(
    `INSERT INTO orchestrator_approvals
       (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'research_execution',$3,'approved',1,'["meta","google","tiktok"]'::jsonb)
     RETURNING id`,
    [tenantId, wfId, `hash-${wfId}`]
  )).rows[0];
  return row.id;
}

async function insertRun(p, tenantId, wfId, approvalId, opts = {}) {
  const id = opts.id || nid('run');
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state, research_brief, search_parameters)
     VALUES ($1,$2,$3,$4,1,$5::text[],$6,$7,'','{}'::jsonb)`,
    [id, tenantId, wfId, approvalId, ['meta'], opts.idempotencyKey || nid('idemp'), opts.state || 'completed']
  );
  return id;
}

async function seedHost(p, tenantId, opts = {}) {
  const wfId = nid('wf');
  await insertWorkflow(p, tenantId, wfId);
  const approvalId = await insertApproval(p, tenantId, wfId);
  const runId = await insertRun(p, tenantId, wfId, approvalId, { state: opts.state || 'completed' });
  return { wfId, approvalId, runId };
}

function evidencePayload(tenantId, runId, competitorId, extra = {}) {
  const now = extra.capturedAt || new Date().toISOString();
  return {
    id: extra.id || nid('ev'),
    tenant_id: tenantId,
    research_run_id: runId,
    competitor_id: competitorId,
    platform: 'meta',
    source_type: 'ad_creative',
    provider_external_id: extra.providerExternalId || nid('ext'),
    canonical_source_url: extra.url || `https://www.facebook.com/ads/library/?id=${nid('ad')}`,
    advertiser_name: 'Acme Ads',
    creative_format: 'image',
    headline: extra.headline || nid('hl'),
    body_text: 'Public ad copy',
    excerpt: 'Public ad copy',
    captured_at: now,
    created_at: extra.createdAt || now,
    expires_at: extra.expiresAt,
    retention_class: extra.retentionClass || 'standard',
    provider_metrics: extra.providerMetrics || nonLiveHonestyMetrics(),
    metrics_kind: extra.metricsKind || 'estimated',
    provenance_method: 'ad_library',
    connector_id: 'meta_research',
    connector_version: '1.0.0',
    contract_version: 'v1',
    dedup_key: extra.dedupKey || nid('dedup'),
  };
}

function competitorPayload(tenantId, runId) {
  return {
    id: nid('comp'),
    tenant_id: tenantId,
    research_run_id: runId,
    platform: 'meta',
    provider_advertiser_id: nid('adv'),
    normalized_name: 'Acme Ads',
    discovery_source: 'ad_library',
    captured_at: new Date().toISOString(),
  };
}

function citationFrom(ev, workflowId) {
  return {
    evidence_id: ev.id,
    research_run_id: ev.research_run_id,
    workflow_id: workflowId,
    source_url: ev.canonical_source_url,
    platform_source_id: ev.provider_external_id,
    evidence_fingerprint: ev.content_fingerprint,
    evidence_hash: ev.content_fingerprint,
    honesty_class: (ev.provider_metrics && ev.provider_metrics.source) || 'fixture',
    source_label: (ev.provider_metrics && ev.provider_metrics.source) || 'fixture',
    captured_at: ev.captured_at,
  };
}

function briefInput(tenantId, host, ev, extra = {}) {
  return {
    id: extra.id || nid('brief'),
    artifact_id: extra.artifact_id || extra.id || nid('art'),
    kind: 'creative_brief',
    tenant_id: tenantId,
    workflow_id: host.wfId,
    research_run_id: host.runId,
    citations: extra.citations || [citationFrom(ev, host.wfId)],
    objective: extra.objective || 'Awareness for winter jackets',
    target_audience: extra.target_audience || 'Outdoor shoppers',
    platform: extra.platform || 'meta',
    placement: extra.placement || 'feed',
    format: extra.format || 'image',
    angle: { text: extra.angleText || 'Stay warm without the bulk' },
    hook: { text: extra.hookText || 'Packable warmth' },
    primary_message: { text: extra.messageText || 'A packable jacket for feed' },
    supporting_claims: extra.supporting_claims || [{
      text: 'Public ads use packable-warmth language',
      claim_kind: 'factual',
      evidence_backed: true,
    }],
    offer: extra.offer || 'Free shipping',
    call_to_action: extra.call_to_action || 'Shop the drop',
    visual_direction: extra.visual_direction || 'Product on snow',
    script_or_storyboard: extra.script_or_storyboard || 'Hook then product then CTA',
    limitations: 'Library snapshot only',
    confidence: 'medium',
  };
}

if (!HAS_DB) {
  test('advertising-orchestrator creative store skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;
  let tenantB = null;
  let userId = null;

  before(async () => {
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AOC A ${SUFFIX}`, `aoc-a-${SUFFIX}`);
    tenantB = await mk(`AOC B ${SUFFIX}`, `aoc-b-${SUFFIX}`);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr4a') RETURNING id`,
      [`pr4a-${SUFFIX}@example.test`]
    )).rows[0].id;
    await ensureResearchLimits(p, tenantA, { records: 10000, bytes: 104857600 });
    await ensureResearchLimits(p, tenantB, { records: 10000, bytes: 104857600 });
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  async function seedEvidence(p, tenantId, opts = {}) {
    const host = await seedHost(p, tenantId, opts);
    const comp = await insertCompetitor(p, competitorPayload(tenantId, host.runId), { tenantId });
    const ev = await insertEvidenceItem(
      p,
      evidencePayload(tenantId, host.runId, comp.id, opts.evidence || {}),
      { tenantId }
    );
    return { host, ev };
  }

  const req = () => ({ user: { id: userId } });

  test('schema has tenant-scoped creative tables and version uniqueness', async () => {
    const p = db.getPool();
    for (const table of ['orchestrator_creative_artifacts', 'orchestrator_creative_citations', 'orchestrator_creative_audit']) {
      const cols = (await p.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name=$1`,
        [table]
      )).rows.map((r) => r.column_name);
      assert.ok(cols.includes('tenant_id'), table);
      assert.ok(!cols.includes('email'));
      assert.ok(!cols.includes('access_token'));
    }
    const uq = (await p.query(
      `SELECT 1 FROM pg_constraint WHERE conname='orchestrator_creative_artifacts_tenant_unique_version'`
    )).rowCount;
    assert.strictEqual(uq, 1);
  });

  test('evidence from another workflow is rejected', async () => {
    const p = db.getPool();
    const a = await seedEvidence(p, tenantA);
    const other = await seedEvidence(p, tenantA);
    await assert.rejects(
      () => insertCreativeArtifact(
        p,
        briefInput(tenantA, a.host, other.ev),
        { tenantId: tenantA, req: req() }
      ),
      (err) => isValidation(err, 'cross_workflow_evidence')
    );
  });

  test('cross-tenant evidence cannot be attached', async () => {
    const p = db.getPool();
    const a = await seedEvidence(p, tenantA);
    const b = await seedEvidence(p, tenantB);
    await assert.rejects(
      () => insertCreativeArtifact(p, briefInput(tenantA, a.host, b.ev), { tenantId: tenantA, req: req() }),
      (err) => isValidation(err, 'missing_evidence')
    );
  });

  test('missing, expired, unapproved evidence is rejected', async () => {
    const p = db.getPool();
    const pending = await seedEvidence(p, tenantA, { state: 'pending' });
    await assert.rejects(
      () => insertCreativeArtifact(p, briefInput(tenantA, pending.host, pending.ev), { tenantId: tenantA, req: req() }),
      (err) => isValidation(err, 'unapproved_evidence')
    );

    const missingHost = await seedHost(p, tenantA);
    const live = await seedEvidence(p, tenantA);
    const ghost = {
      ...live.ev,
      id: nid('missing'),
      research_run_id: missingHost.runId,
    };
    await assert.rejects(
      () => insertCreativeArtifact(
        p,
        briefInput(tenantA, missingHost, ghost),
        { tenantId: tenantA, req: req() }
      ),
      (err) => isValidation(err, 'missing_evidence')
    );

    const past = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const expiredAt = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const expired = await seedEvidence(p, tenantA, {
      evidence: { createdAt: past, capturedAt: past, expiresAt: expiredAt },
    });
    await assert.rejects(
      () => insertCreativeArtifact(p, briefInput(tenantA, expired.host, expired.ev), { tenantId: tenantA, req: req() }),
      (err) => isValidation(err, 'expired_evidence')
    );
  });

  test('fixture evidence remains labelled synthetic and cannot be stored as live', async () => {
    const p = db.getPool();
    const { host, ev } = await seedEvidence(p, tenantA);
    const cit = citationFrom(ev, host.wfId);
    assert.strictEqual(cit.honesty_class, 'fixture');
    await assert.rejects(
      () => insertCreativeArtifact(
        p,
        briefInput(tenantA, host, ev, { citations: [{ ...cit, source_label: 'live' }] }),
        { tenantId: tenantA, req: req() }
      ),
      (err) => isValidation(err, 'fixture_as_live')
    );
    const row = await insertCreativeArtifact(p, briefInput(tenantA, host, ev), { tenantId: tenantA, req: req() });
    assert.strictEqual(row.payload.citations[0].honesty_class, 'fixture');
    assert.notStrictEqual(row.payload.citations[0].source_label, 'live');
  });

  test('approved versions are immutable and revisions invalidate approval', async () => {
    const p = db.getPool();
    const { host, ev } = await seedEvidence(p, tenantA);
    const created = await insertCreativeArtifact(
      p,
      briefInput(tenantA, host, ev, { artifact_id: nid('immut') }),
      { tenantId: tenantA, req: req() }
    );
    await assert.rejects(
      () => approveCreativeArtifact(p, {
        tenantId: tenantA,
        artifactId: created.artifact_id,
        req: req(),
      }),
      (err) => isValidation(err, 'required')
    );
    await assert.rejects(
      () => approveCreativeArtifact(p, {
        tenantId: tenantA,
        artifactId: created.artifact_id,
        req: req(),
        contentHash: 'c'.repeat(64),
        objectVersion: created.version,
      }),
      (err) => err instanceof OrchError && err.code === 'approval_stale'
    );
    const approved = await approveCreativeArtifact(p, {
      tenantId: tenantA,
      artifactId: created.artifact_id,
      req: req(),
      contentHash: approvalContentHash(created.content_hash, created.evidence_hash),
      objectVersion: created.version,
    });
    assert.strictEqual(approved.status, 'approved');
    assert.ok(approved.approval_id);
    await assert.rejects(
      p.query(
        `UPDATE orchestrator_creative_artifacts SET payload = payload || '{"x":1}'::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA, created.id]
      )
    );
    const revised = await reviseCreativeArtifact(
      p,
      briefInput(tenantA, host, ev, { artifact_id: created.artifact_id, id: created.artifact_id, hookText: 'Changed hook' }),
      { tenantId: tenantA, req: req() }
    );
    assert.strictEqual(revised.status, 'draft');
    assert.strictEqual(revised.version, 2);
    assert.equal(revised.approval_id, null);
    const old = await loadCreativeArtifact(p, { tenantId: tenantA, artifactId: created.artifact_id, version: 1 });
    assert.strictEqual(old.status, 'superseded');
    const events = (await p.query(
      `SELECT event FROM orchestrator_creative_audit WHERE tenant_id=$1 AND artifact_id=$2 ORDER BY id`,
      [tenantA, created.artifact_id]
    )).rows.map((r) => r.event);
    assert.ok(events.includes('approved'));
    assert.ok(events.includes('invalidated'));
    assert.ok(events.includes('superseded'));
    assert.ok(events.includes('revised'));
  });

  test('concurrent version creation cannot duplicate versions', async () => {
    const p = db.getPool();
    const { host } = await seedEvidence(p, tenantA);
    const artifactId = nid('race');
    const hash = 'd'.repeat(64);
    await p.query(
      `INSERT INTO orchestrator_creative_artifacts
         (id, tenant_id, artifact_id, kind, workflow_id, research_run_id, version,
          status, content_hash, evidence_hash, payload)
       VALUES ($1,$2,$3,'angle',$4,$5,1,'draft',$6,$6,'{}'::jsonb)`,
      [nid('row'), tenantA, artifactId, host.wfId, host.runId, hash]
    );
    await assert.rejects(
      p.query(
        `INSERT INTO orchestrator_creative_artifacts
           (id, tenant_id, artifact_id, kind, workflow_id, research_run_id, version,
            status, content_hash, evidence_hash, payload)
         VALUES ($1,$2,$3,'angle',$4,$5,1,'draft',$6,$6,'{}'::jsonb)`,
        [nid('row'), tenantA, artifactId, host.wfId, host.runId, hash]
      )
    );
  });

  test('PII is rejected at persist and actorUserId cannot be spoofed', async () => {
    const p = db.getPool();
    const { host, ev } = await seedEvidence(p, tenantA);
    await assert.rejects(
      () => insertCreativeArtifact(
        p,
        briefInput(tenantA, host, ev, { target_audience: 'Call +1 (415) 555-0123' }),
        { tenantId: tenantA, req: req() }
      ),
      (err) => isValidation(err, 'pii')
    );
    await assert.rejects(
      () => insertCreativeArtifact(p, briefInput(tenantA, host, ev), { tenantId: tenantA, actorUserId: userId }),
      (err) => isValidation(err, 'untrusted')
    );
  });
}
