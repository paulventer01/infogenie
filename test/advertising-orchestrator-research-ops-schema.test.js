// test/advertising-orchestrator-research-ops-schema.test.js — PR 3A retention, quota, fingerprint
//
// Gated on DATABASE_URL. When hasDb() is true there are ZERO per-test skips.
// Self-contained: ensureTenantSchema + ensureAgentOrchestratorSchema, no server.js boot.

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const SHA256_A = 'a'.repeat(64);
const SHA256_C = 'c'.repeat(64);
const SUFFIX = `aoro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`;
}

async function seedResearchLimits(p, tenantId, opts = {}) {
  await p.query(
    `INSERT INTO orchestrator_tenant_limits
       (tenant_id, max_research_evidence_records, max_research_evidence_payload_bytes)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id) DO UPDATE SET
       max_research_evidence_records = EXCLUDED.max_research_evidence_records,
       max_research_evidence_payload_bytes = EXCLUDED.max_research_evidence_payload_bytes`,
    [tenantId, opts.records ?? 10000, opts.bytes ?? 104857600]
  );
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
      opts.gate || 'research_execution',
      opts.contentHash || `hash-${wfId}`,
      opts.decision || 'approved',
      opts.objectVersion || 1,
      JSON.stringify(opts.approvedPlatforms || ['meta', 'google', 'tiktok']),
    ]
  )).rows[0];
  return row.id;
}

async function insertRun(p, tenantId, wfId, approvalId, opts = {}) {
  const id = opts.id || nid('run');
  const searchSql = opts.searchParametersSql || '$10::jsonb';
  const contSql = opts.continuationStateSql || `'{}'::jsonb`;
  const params = [
    id,
    tenantId,
    wfId,
    approvalId,
    opts.approvalObjectVersion || 1,
    opts.platforms || ['meta'],
    opts.idempotencyKey || nid('idemp'),
    opts.state || 'pending',
    opts.researchBrief || '',
  ];
  if (!opts.searchParametersSql) params.push(JSON.stringify(opts.searchParameters || {}));
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state, research_brief, search_parameters,
        continuation_state)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9, ${searchSql}, ${contSql})`,
    params
  );
  return id;
}

async function seedHost(p, tenantId, opts = {}) {
  const wfId = opts.wfId || nid('wf');
  if (!opts.reuseWorkflow) {
    await insertWorkflow(p, tenantId, wfId);
  }
  const approvalId = opts.approvalId || await insertApproval(p, tenantId, wfId, opts);
  const runId = await insertRun(p, tenantId, wfId, approvalId, opts);
  return { wfId, approvalId, runId };
}

async function insertCompetitor(p, tenantId, runId, opts = {}) {
  const id = opts.id || nid('comp');
  await p.query(
    `INSERT INTO orchestrator_research_competitors
       (id, tenant_id, research_run_id, platform, provider_advertiser_id, normalized_name,
        discovery_source, captured_at, dedup_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)`,
    [
      id,
      tenantId,
      runId,
      opts.platform || 'meta',
      opts.providerAdvertiserId || nid('adv'),
      opts.normalizedName || 'Acme Ads',
      opts.discoverySource || 'ad_library',
      opts.dedupKey || nid('cdedup'),
    ]
  );
  return id;
}

async function insertEvidence(p, tenantId, runId, competitorId, opts = {}) {
  const id = opts.id || nid('ev');
  const retentionClass = opts.retentionClass || 'standard';
  const fingerprint = opts.contentFingerprint || opts.evidenceHash || SHA256_A;
  const hasExpires = Object.prototype.hasOwnProperty.call(opts, 'expiresAt');
  const hasCreated = Object.prototype.hasOwnProperty.call(opts, 'createdAt');
  const params = [
    id,
    tenantId,
    runId,
    competitorId,
    opts.platform || 'meta',
    opts.sourceType || 'ad_creative',
    opts.providerExternalId || null,
    opts.headline || '',
    opts.bodyText || '',
    opts.excerpt || '',
    opts.advertiserName || '',
    JSON.stringify(opts.providerMetrics || {}),
    opts.provenanceMethod || 'ad_library',
    opts.connectorId || 'meta_research',
    opts.connectorVersion || '1.0.0',
    fingerprint,
    opts.dedupKey || nid('ededup'),
    opts.supersedesId || null,
    retentionClass,
  ];
  const expiresSql = hasExpires ? `$${params.length + 1}::timestamptz` : `now() + interval '30 days'`;
  if (hasExpires) params.push(opts.expiresAt);
  const createdSql = hasCreated ? `$${params.length + 1}::timestamptz` : 'now()';
  if (hasCreated) params.push(opts.createdAt);
  await p.query(
    `INSERT INTO orchestrator_research_evidence
       (id, tenant_id, research_run_id, competitor_id, platform, source_type,
        provider_external_id, headline, body_text, excerpt, advertiser_name,
        captured_at, provider_metrics, provenance_method, connector_id, connector_version,
        content_fingerprint, dedup_key, supersedes_id, retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12::jsonb, $13,$14,$15,$16,$17,$18,$19,
             ${expiresSql}, ${createdSql})`,
    params
  );
  return id;
}

async function insertAsset(p, tenantId, evidenceId, opts = {}) {
  const id = opts.id || nid('asset');
  const retentionClass = opts.retentionClass || 'standard';
  const hasExpires = Object.prototype.hasOwnProperty.call(opts, 'expiresAt');
  const hasCreated = Object.prototype.hasOwnProperty.call(opts, 'createdAt');
  const params = [
    id,
    tenantId,
    evidenceId,
    opts.mediaType || 'image',
    opts.storageRef || `s3://orch/${id}`,
    opts.checksum || SHA256_C,
    retentionClass,
  ];
  const expiresSql = hasExpires ? `$${params.length + 1}::timestamptz` : `now() + interval '30 days'`;
  if (hasExpires) params.push(opts.expiresAt);
  const createdSql = hasCreated ? `$${params.length + 1}::timestamptz` : 'now()';
  if (hasCreated) params.push(opts.createdAt);
  await p.query(
    `INSERT INTO orchestrator_research_evidence_assets
       (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at,
        retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7, ${expiresSql}, ${createdSql})`,
    params
  );
  return id;
}

async function indexDef(name) {
  const row = (await db.getPool().query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
    [name]
  )).rows[0];
  return row ? row.indexdef : null;
}

async function checkExists(table, name) {
  const row = (await db.getPool().query(
    `SELECT 1 FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass`,
    [name, `public.${table}`]
  )).rows[0];
  return !!row;
}

if (!HAS_DB) {
  test('advertising-orchestrator research ops schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
    tenantA = await mk(`AORO A ${SUFFIX}`, `aoro-a-${SUFFIX}`);
    tenantB = await mk(`AORO B ${SUFFIX}`, `aoro-b-${SUFFIX}`);
    await seedResearchLimits(p, tenantA);
    await seedResearchLimits(p, tenantB);
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('jsonb_typeof CHECKs reject arrays/scalars; second ensure is idempotent', async () => {
    const p = db.getPool();
    const wfId = nid('wf-json');
    await insertWorkflow(p, tenantA, wfId);
    const approvalId = await insertApproval(p, tenantA, wfId, { contentHash: nid('hash-json') });

    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-json-arr'),
        searchParametersSql: `'[]'::jsonb`,
      }),
      /search_parameters|check/i,
      "'[]'::jsonb search_parameters must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-json-num'),
        searchParametersSql: `'1'::jsonb`,
      }),
      /search_parameters|check/i,
      "'1'::jsonb search_parameters must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-json-str'),
        searchParametersSql: `'"x"'::jsonb`,
      }),
      /search_parameters|check/i,
      "'\"x\"'::jsonb search_parameters must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-cont-arr'),
        continuationStateSql: `'[]'::jsonb`,
      }),
      /continuation_state|check/i,
      "'[]'::jsonb continuation_state must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-cont-num'),
        continuationStateSql: `'1'::jsonb`,
      }),
      /continuation_state|check/i
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-cont-str'),
        continuationStateSql: `'"x"'::jsonb`,
      }),
      /continuation_state|check/i
    );

    await insertRun(p, tenantA, wfId, approvalId, {
      id: nid('run-json-ok'),
      searchParameters: {},
    });

    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    assert.ok(await checkExists('orchestrator_research_runs', 'orchestrator_research_runs_search_parameters_type_check'));
    assert.ok(await checkExists('orchestrator_research_runs', 'orchestrator_research_runs_continuation_state_type_check'));
    await insertRun(p, tenantA, wfId, approvalId, {
      id: nid('run-json-ok2'),
      searchParameters: { market: 'us' },
      state: 'completed',
    });
  });

  test('fail-closed retention: standard/short require expires_at > created_at; legal_hold may omit it', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const ts = new Date();

    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-std-null'),
        retentionClass: 'standard',
        expiresAt: null,
      }),
      /retention_expiry|check/i,
      'standard insert without expires_at must fail'
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-short-null'),
        retentionClass: 'short',
        expiresAt: null,
      }),
      /retention_expiry|check/i,
      'short insert without expires_at must fail'
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-std-eq'),
        retentionClass: 'standard',
        createdAt: ts,
        expiresAt: ts,
      }),
      /retention_expiry|check/i,
      'standard expires_at <= created_at must fail'
    );

    await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-hold-null'),
      retentionClass: 'legal_hold',
      expiresAt: null,
    });

    const evId = await insertEvidence(p, tenantA, host.runId, comp, { id: nid('ev-asset-ret') });
    await assert.rejects(
      () => insertAsset(p, tenantA, evId, { retentionClass: 'standard', expiresAt: null }),
      /retention_expiry|check/i
    );
    await insertAsset(p, tenantA, evId, { retentionClass: 'legal_hold', expiresAt: null });
  });

  test('expired non-hold DELETE succeeds; UPDATE and live DELETE stay immutable; legal_hold DELETE refused', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const liveId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-live'),
      expiresAt: futureAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence SET headline='tamper' WHERE tenant_id=$1 AND id=$2`,
        [tenantA, liveId]
      ),
      /orchestrator_research_evidence_immutable/
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, liveId]
      ),
      /orchestrator_research_evidence_immutable/,
      'non-expired DELETE must stay immutable'
    );

    const expiredId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-exp'),
      retentionClass: 'standard',
      createdAt,
      expiresAt: expiredAt,
    });
    await p.query(
      `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, expiredId]
    );
    const gone = (await p.query(
      `SELECT 1 FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, expiredId]
    )).rows;
    assert.strictEqual(gone.length, 0, 'expired non-hold DELETE must succeed');

    const holdId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-hold-del'),
      retentionClass: 'legal_hold',
      expiresAt: expiredAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, holdId]
      ),
      /orchestrator_research_evidence_immutable/,
      'legal_hold DELETE must be refused while the run exists'
    );

    const futureId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-future'),
      expiresAt: futureAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, futureId]
      ),
      /orchestrator_research_evidence_immutable/,
      'future expires_at DELETE must fail'
    );

    const assetLive = await insertAsset(p, tenantA, liveId, { expiresAt: futureAt, createdAt });
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence_assets SET storage_ref='s3://tamper'
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetLive]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetLive]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );

    const assetExp = await insertAsset(p, tenantA, liveId, {
      id: nid('asset-exp'),
      createdAt,
      expiresAt: expiredAt,
    });
    await p.query(
      `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, assetExp]
    );

    const assetHold = await insertAsset(p, tenantA, liveId, {
      retentionClass: 'legal_hold',
      expiresAt: expiredAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetHold]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );
  });

  test('sweep indexes exist, are partial, and lead with tenant_id', async () => {
    const ev = await indexDef('idx_orchestrator_research_evidence_tenant_expires');
    const assets = await indexDef('idx_orchestrator_research_evidence_assets_tenant_expires');
    assert.ok(ev, 'idx_orchestrator_research_evidence_tenant_expires must exist');
    assert.ok(assets, 'idx_orchestrator_research_evidence_assets_tenant_expires must exist');
    assert.match(ev, /\(tenant_id,\s*expires_at,\s*id\)/);
    assert.match(assets, /\(tenant_id,\s*expires_at,\s*id\)/);
    assert.match(ev, /WHERE/i);
    assert.match(assets, /WHERE/i);
    assert.match(ev, /retention_class/);
    assert.match(assets, /retention_class/);
  });

  test('content_fingerprint column exists; evidence_hash column does not', async () => {
    const p = db.getPool();
    const cols = (await p.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orchestrator_research_evidence'
          AND column_name IN ('content_fingerprint','evidence_hash')`
    )).rows.map((r) => r.column_name).sort();
    assert.deepStrictEqual(cols, ['content_fingerprint']);
    assert.ok(await checkExists('orchestrator_research_evidence', 'orchestrator_research_evidence_content_fingerprint_check'));
    assert.strictEqual(
      await checkExists('orchestrator_research_evidence', 'orchestrator_research_evidence_evidence_hash_check'),
      false
    );
    const fpIdx = await indexDef('idx_orchestrator_research_evidence_tenant_fingerprint');
    assert.ok(fpIdx);
    assert.match(fpIdx, /content_fingerprint/);
    assert.strictEqual(await indexDef('idx_orchestrator_research_evidence_tenant_hash'), null);
  });

  test('volume quota: concurrent inserts serialize; payload and cross-tenant isolation; 0 is fail-closed; delete frees quota', async () => {
    const pool = db.getPool();
    const tenantConc = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO conc ${SUFFIX}`, `aoro-conc-${SUFFIX}`]
    )).rows[0].id;
    const tenantZero = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO zero ${SUFFIX}`, `aoro-zero-${SUFFIX}`]
    )).rows[0].id;
    const tenantPay = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO pay ${SUFFIX}`, `aoro-pay-${SUFFIX}`]
    )).rows[0].id;
    const tenantDec = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO dec ${SUFFIX}`, `aoro-dec-${SUFFIX}`]
    )).rows[0].id;

    try {
      await seedResearchLimits(pool, tenantConc, { records: 2, bytes: 104857600 });
      await seedResearchLimits(pool, tenantB, { records: 10000, bytes: 104857600 });
      await seedResearchLimits(pool, tenantPay, { records: 100, bytes: 1500 });
      await seedResearchLimits(pool, tenantDec, { records: 1, bytes: 104857600 });

      const hostConc = await seedHost(pool, tenantConc);
      const compConc = await insertCompetitor(pool, tenantConc, hostConc.runId);
      const clients = [];
      try {
        for (let i = 0; i < 5; i += 1) clients.push(await pool.connect());
        const results = await Promise.allSettled(
          clients.map((c, i) => insertEvidence(c, tenantConc, hostConc.runId, compConc, {
            id: nid(`ev-conc-${i}`),
            dedupKey: nid(`ededup-conc-${i}`),
          }))
        );
        const ok = results.filter((r) => r.status === 'fulfilled');
        const fail = results.filter((r) => r.status === 'rejected');
        assert.strictEqual(ok.length, 2, 'exactly 2 concurrent inserts must succeed under max_records=2');
        assert.strictEqual(fail.length, 3, 'exactly 3 concurrent inserts must fail');
        for (const f of fail) {
          assert.match(
            String(f.reason && f.reason.message),
            /orchestrator_research_evidence_limit_exceeded/
          );
        }
      } finally {
        for (const c of clients) c.release();
      }

      const hostB = await seedHost(pool, tenantB);
      const compB = await insertCompetitor(pool, tenantB, hostB.runId);
      await insertEvidence(pool, tenantB, hostB.runId, compB, { id: nid('ev-xtenant') });

      const hostPay = await seedHost(pool, tenantPay);
      const compPay = await insertCompetitor(pool, tenantPay, hostPay.runId);
      const fat = 'b'.repeat(1000);
      await insertEvidence(pool, tenantPay, hostPay.runId, compPay, {
        id: nid('ev-pay-1'),
        bodyText: fat,
      });
      await assert.rejects(
        () => insertEvidence(pool, tenantPay, hostPay.runId, compPay, {
          id: nid('ev-pay-2'),
          bodyText: fat,
        }),
        /orchestrator_research_evidence_limit_exceeded/,
        'same tenant must not exceed payload bytes'
      );

      const hostZero = await seedHost(pool, tenantZero);
      const compZero = await insertCompetitor(pool, tenantZero, hostZero.runId);
      await assert.rejects(
        () => insertEvidence(pool, tenantZero, hostZero.runId, compZero, { id: nid('ev-zero') }),
        /orchestrator_research_evidence_limit_exceeded/,
        'missing/zero limits must reject the first insert'
      );

      const hostDec = await seedHost(pool, tenantDec);
      const compDec = await insertCompetitor(pool, tenantDec, hostDec.runId);
      const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredId = await insertEvidence(pool, tenantDec, hostDec.runId, compDec, {
        id: nid('ev-dec-1'),
        createdAt,
        expiresAt: expiredAt,
      });
      await assert.rejects(
        () => insertEvidence(pool, tenantDec, hostDec.runId, compDec, { id: nid('ev-dec-block') }),
        /orchestrator_research_evidence_limit_exceeded/
      );
      await pool.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantDec, expiredId]
      );
      await insertEvidence(pool, tenantDec, hostDec.runId, compDec, { id: nid('ev-dec-2') });
    } finally {
      await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantConc, tenantZero, tenantPay, tenantDec]]);
    }
  });

  test('orchestrator_research_quota is tenant PK CASCADE and limits default to 0', async () => {
    const p = db.getPool();
    const pk = (await p.query(
      `SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE tc.table_schema='public' AND tc.table_name='orchestrator_research_quota'
          AND tc.constraint_type='PRIMARY KEY'
        GROUP BY tc.constraint_name`
    )).rows[0];
    assert.strictEqual(pk.cols, 'tenant_id');

    const fk = (await p.query(
      `SELECT confrel.relname AS foreign_table, con.confdeltype AS delete_type
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         JOIN pg_class confrel ON confrel.oid = con.confrelid
        WHERE nsp.nspname='public'
          AND rel.relname='orchestrator_research_quota'
          AND con.contype='f'
          AND confrel.relname='tenants'`
    )).rows[0];
    assert.ok(fk);
    assert.strictEqual(fk.delete_type, 'c');

    const tenantD = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO def ${SUFFIX}`, `aoro-def-${SUFFIX}`]
    )).rows[0].id;
    await p.query(`INSERT INTO orchestrator_tenant_limits (tenant_id) VALUES ($1)`, [tenantD]);
    const limits = (await p.query(
      `SELECT max_research_evidence_records, max_research_evidence_payload_bytes
         FROM orchestrator_tenant_limits WHERE tenant_id=$1`,
      [tenantD]
    )).rows[0];
    assert.strictEqual(limits.max_research_evidence_records, 0);
    assert.strictEqual(Number(limits.max_research_evidence_payload_bytes), 0);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantD]);
  });
}
