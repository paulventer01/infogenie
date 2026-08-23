'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { OrchError } = require('../services/agent_orchestrator/errors');
const {
  insertEvidenceItem,
  insertCompetitor,
  ensureResearchLimits,
} = require('../services/agent_orchestrator/research_store');
const { nonLiveHonestyMetrics } = require('../services/agent_orchestrator/research_honesty');

const HAS_DB = db.hasDb();
const SUFFIX = `aors-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`;
}

async function insertWorkflow(p, tenantId, wfId) {
  await p.query(
    `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
    [wfId, tenantId, `research host ${wfId}`]
  );
}

async function insertApproval(p, tenantId, wfId, opts = {}) {
  const row = (await p.query(
    `INSERT INTO orchestrator_approvals
       (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id`,
    [
      tenantId,
      wfId,
      'research_execution',
      opts.contentHash || `hash-${wfId}`,
      'approved',
      1,
      JSON.stringify(['meta', 'google', 'tiktok']),
    ]
  )).rows[0];
  return row.id;
}

async function insertRun(p, tenantId, wfId, approvalId, opts = {}) {
  const id = opts.id || nid('run');
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state, research_brief, search_parameters)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10::jsonb)`,
    [id, tenantId, wfId, approvalId, 1, ['meta'], opts.idempotencyKey || nid('idemp'), 'pending', '', '{}']
  );
  return id;
}

async function seedHost(p, tenantId) {
  const wfId = nid('wf');
  await insertWorkflow(p, tenantId, wfId);
  const approvalId = await insertApproval(p, tenantId, wfId);
  const runId = await insertRun(p, tenantId, wfId, approvalId);
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
    advertiser_name: extra.advertiserName || 'Acme Ads',
    creative_format: 'image',
    headline: extra.headline || nid('hl'),
    body_text: extra.bodyText || 'Public ad copy',
    excerpt: extra.excerpt || 'Public ad copy',
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

function competitorPayload(tenantId, runId, extra = {}) {
  return {
    id: extra.id || nid('comp'),
    tenant_id: tenantId,
    research_run_id: runId,
    platform: 'meta',
    provider_advertiser_id: extra.providerAdvertiserId || nid('adv'),
    normalized_name: extra.normalizedName || 'Acme Ads',
    discovery_source: 'ad_library',
    captured_at: extra.capturedAt || new Date().toISOString(),
  };
}

if (!HAS_DB) {
  test('advertising-orchestrator research store skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;
  let tenantB = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AORS A ${SUFFIX}`, `aors-a-${SUFFIX}`);
    tenantB = await mk(`AORS B ${SUFFIX}`, `aors-b-${SUFFIX}`);
    await ensureResearchLimits(p, tenantA, { records: 10000, bytes: 104857600 });
    await ensureResearchLimits(p, tenantB, { records: 10000, bytes: 104857600 });
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('insertEvidenceItem succeeds when limits are set', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, competitorPayload(tenantA, host.runId), { tenantId: tenantA });
    const row = await insertEvidenceItem(
      p,
      evidencePayload(tenantA, host.runId, comp.id),
      { tenantId: tenantA }
    );
    assert.ok(row.content_fingerprint);
    assert.match(row.content_fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'evidence_hash'), false);
    const stored = (await p.query(
      `SELECT content_fingerprint FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, row.id]
    )).rows[0];
    assert.strictEqual(stored.content_fingerprint, row.content_fingerprint);
  });

  test('0 limits → research_evidence_limit_exceeded (OrchError, code stable)', async () => {
    const p = db.getPool();
    const tenantZ = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORS zero ${SUFFIX}`, `aors-z-${SUFFIX}`]
    )).rows[0].id;
    try {
      await ensureResearchLimits(p, tenantZ, { records: 0, bytes: 0 });
      const host = await seedHost(p, tenantZ);
      const comp = await insertCompetitor(p, competitorPayload(tenantZ, host.runId), { tenantId: tenantZ });
      await assert.rejects(
        () => insertEvidenceItem(p, evidencePayload(tenantZ, host.runId, comp.id), { tenantId: tenantZ }),
        (err) => err instanceof OrchError
          && err.code === 'research_evidence_limit_exceeded'
          && err.httpStatus === 409
      );
    } finally {
      await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantZ]);
    }
  });

  test('concurrent inserts vs max_records serialize through the quota trigger', async () => {
    const pool = db.getPool();
    const tenantC = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORS conc ${SUFFIX}`, `aors-c-${SUFFIX}`]
    )).rows[0].id;
    try {
      await ensureResearchLimits(pool, tenantC, { records: 2, bytes: 104857600 });
      const host = await seedHost(pool, tenantC);
      const comp = await insertCompetitor(pool, competitorPayload(tenantC, host.runId), { tenantId: tenantC });
      const clients = [];
      try {
        for (let i = 0; i < 5; i += 1) clients.push(await pool.connect());
        const results = await Promise.allSettled(
          clients.map((c, i) => insertEvidenceItem(
            c,
            evidencePayload(tenantC, host.runId, comp.id, {
              id: nid(`ev-conc-${i}`),
              dedupKey: nid(`dk-conc-${i}`),
              headline: nid(`hl-conc-${i}`),
            }),
            { tenantId: tenantC }
          ))
        );
        const ok = results.filter((r) => r.status === 'fulfilled');
        const fail = results.filter((r) => r.status === 'rejected');
        assert.strictEqual(ok.length, 2, 'exactly 2 concurrent inserts must succeed under max_records=2');
        assert.strictEqual(fail.length, 3);
        for (const f of fail) {
          assert.ok(f.reason instanceof OrchError);
          assert.strictEqual(f.reason.code, 'research_evidence_limit_exceeded');
        }
      } finally {
        for (const c of clients) c.release();
      }
    } finally {
      await pool.query(`DELETE FROM tenants WHERE id=$1`, [tenantC]);
    }
  });

  test('cross-tenant: tenant B is unlimited by tenant A cap', async () => {
    const p = db.getPool();
    const tenantCap = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORS cap ${SUFFIX}`, `aors-cap-${SUFFIX}`]
    )).rows[0].id;
    try {
      await ensureResearchLimits(p, tenantCap, { records: 1, bytes: 104857600 });
      const hostA = await seedHost(p, tenantCap);
      const compA = await insertCompetitor(p, competitorPayload(tenantCap, hostA.runId), { tenantId: tenantCap });
      await insertEvidenceItem(p, evidencePayload(tenantCap, hostA.runId, compA.id), { tenantId: tenantCap });
      await assert.rejects(
        () => insertEvidenceItem(
          p,
          evidencePayload(tenantCap, hostA.runId, compA.id, { headline: nid('blocked') }),
          { tenantId: tenantCap }
        ),
        (err) => err instanceof OrchError && err.code === 'research_evidence_limit_exceeded'
      );

      const hostB = await seedHost(p, tenantB);
      const compB = await insertCompetitor(p, competitorPayload(tenantB, hostB.runId), { tenantId: tenantB });
      const rowB = await insertEvidenceItem(
        p,
        evidencePayload(tenantB, hostB.runId, compB.id),
        { tenantId: tenantB }
      );
      assert.ok(rowB.id);
    } finally {
      await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantCap]);
    }
  });

  test('content_fingerprint is stored; evidence_hash column is absent', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, competitorPayload(tenantA, host.runId), { tenantId: tenantA });
    const row = await insertEvidenceItem(
      p,
      evidencePayload(tenantA, host.runId, comp.id, { headline: nid('fp') }),
      { tenantId: tenantA }
    );
    const cols = (await p.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orchestrator_research_evidence'
          AND column_name IN ('content_fingerprint','evidence_hash')`
    )).rows.map((r) => r.column_name).sort();
    assert.deepStrictEqual(cols, ['content_fingerprint']);
    const stored = (await p.query(
      `SELECT content_fingerprint FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, row.id]
    )).rows[0];
    assert.strictEqual(stored.content_fingerprint, row.content_fingerprint);
    assert.doesNotMatch(
      fs.readFileSync(path.join(__dirname, '../services/agent_orchestrator/research_store.js'), 'utf8'),
      /COUNT\(\*\)/
    );
  });

  test('corrupt-low quota cache still refuses insert at cap', async () => {
    const p = db.getPool();
    const tenantQ = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORS qcache ${SUFFIX}`, `aors-qc-${SUFFIX}`]
    )).rows[0].id;
    try {
      await ensureResearchLimits(p, tenantQ, { records: 1, bytes: 104857600 });
      const host = await seedHost(p, tenantQ);
      const comp = await insertCompetitor(p, competitorPayload(tenantQ, host.runId), { tenantId: tenantQ });
      await insertEvidenceItem(p, evidencePayload(tenantQ, host.runId, comp.id), { tenantId: tenantQ });
      await p.query(
        `UPDATE orchestrator_research_quota SET evidence_count=0, payload_bytes=0 WHERE tenant_id=$1`,
        [tenantQ]
      );
      await assert.rejects(
        () => insertEvidenceItem(
          p,
          evidencePayload(tenantQ, host.runId, comp.id, { headline: nid('cap') }),
          { tenantId: tenantQ }
        ),
        (err) => err instanceof OrchError && err.code === 'research_evidence_limit_exceeded'
      );
    } finally {
      await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantQ]);
    }
  });

  test('in-copy email and phone are redacted before persist; fingerprint is of redacted text', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const {
      redactContactPii,
      toLlmSafeEvidence,
      computeContentFingerprint,
      assertEvidenceItem,
    } = require('../services/agent_orchestrator/research_validate');
    const { logger } = require('../services/infra/logger');
    const RAW_EMAIL = 'ops@ads.example';
    const RAW_PHONE = '+1 (415) 555-0100';
    const comp = await insertCompetitor(p, competitorPayload(tenantA, host.runId), { tenantId: tenantA });
    const payload = evidencePayload(tenantA, host.runId, comp.id, {
      headline: `Talk to ${RAW_EMAIL}`,
      bodyText: `Call ${RAW_PHONE} today`,
      excerpt: `${RAW_EMAIL} or ${RAW_PHONE}`,
      advertiserName: `Acme ${RAW_EMAIL}`,
    });
    delete payload.dedup_key;
    const row = await insertEvidenceItem(p, payload, { tenantId: tenantA });
    const expectedHeadline = redactContactPii(`Talk to ${RAW_EMAIL}`);
    const expectedBody = redactContactPii(`Call ${RAW_PHONE} today`);
    assert.strictEqual(row.headline, expectedHeadline);
    assert.strictEqual(row.body_text, expectedBody);
    assert.ok(!row.headline.includes(RAW_EMAIL));
    assert.ok(!row.body_text.includes(RAW_PHONE));
    assert.ok(row.excerpt.includes('[email]'));
    assert.ok(row.advertiser_name.includes('[email]'));
    assert.match(row.dedup_key, /^[0-9a-f]{64}$/);
    assert.ok(!row.dedup_key.includes('@'));
    assert.ok(!JSON.stringify(row).includes(RAW_EMAIL));
    assert.ok(!JSON.stringify(row).includes('555-0100'));

    const stored = (await p.query(
      `SELECT headline, body_text, excerpt, advertiser_name, content_fingerprint, dedup_key
         FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, row.id]
    )).rows[0];
    assert.strictEqual(stored.headline, expectedHeadline);
    assert.strictEqual(stored.body_text, expectedBody);
    assert.ok(!JSON.stringify(stored).includes(RAW_EMAIL));
    assert.ok(!JSON.stringify(stored).includes(RAW_PHONE));
    assert.strictEqual(stored.content_fingerprint, row.content_fingerprint);
    assert.strictEqual(stored.dedup_key, stored.content_fingerprint);

    const llm = toLlmSafeEvidence(stored);
    assert.ok(!JSON.stringify(llm).includes(RAW_EMAIL));
    assert.ok(!JSON.stringify(llm).includes(RAW_PHONE));
    assert.strictEqual(llm.headline, stored.headline);

    const recomputed = computeContentFingerprint({
      platform: 'meta',
      source_type: 'ad_creative',
      provider_external_id: row.provider_external_id,
      canonical_source_url: row.canonical_source_url,
      headline: stored.headline,
      body_text: stored.body_text,
      excerpt: stored.excerpt,
      advertiser_name: stored.advertiser_name,
      creative_format: row.creative_format,
    });
    assert.strictEqual(recomputed, stored.content_fingerprint);

    const lines = [];
    const origError = logger.error;
    logger.error = (msg, fields) => {
      lines.push(JSON.stringify({ msg, ...(fields || {}) }));
      return origError(msg, fields);
    };
    try {
      await assert.rejects(
        () => insertEvidenceItem(
          p,
          evidencePayload(tenantA, host.runId, comp.id, {
            headline: RAW_EMAIL,
            bodyText: RAW_PHONE,
            retentionClass: 'nope',
          }),
          { tenantId: tenantA }
        )
      );
    } finally {
      logger.error = origError;
    }
    assert.ok(!lines.join('\n').includes(RAW_EMAIL));
    assert.ok(!lines.join('\n').includes(RAW_PHONE));
    assert.ok(assertEvidenceItem);
  });
}
