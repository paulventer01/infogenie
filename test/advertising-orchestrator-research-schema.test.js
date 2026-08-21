// test/advertising-orchestrator-research-schema.test.js — PR 3A research evidence DDL
//
// Gated on DATABASE_URL. When hasDb() is true there are ZERO per-test skips.
// Self-contained: ensureTenantSchema + ensureAgentOrchestratorSchema, no server.js boot.

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const TABLES = [
  'orchestrator_research_runs',
  'orchestrator_research_competitors',
  'orchestrator_research_evidence',
  'orchestrator_research_evidence_assets',
];

const TENANT_UNIQUE_CONSTRAINTS = [
  ['orchestrator_research_runs', 'orchestrator_research_runs_tenant_unique_idempotency_key', 'tenant_id,idempotency_key'],
  ['orchestrator_research_competitors', 'orchestrator_research_competitors_tenant_unique_dedup', 'tenant_id,research_run_id,platform,dedup_key'],
  ['orchestrator_research_competitors', 'orchestrator_research_competitors_tenant_unique_ext', 'tenant_id,research_run_id,platform,provider_advertiser_id'],
  ['orchestrator_research_competitors', 'orchestrator_research_competitors_tenant_unique_run_id', 'tenant_id,research_run_id,id'],
  ['orchestrator_research_evidence', 'orchestrator_research_evidence_tenant_unique_dedup', 'tenant_id,research_run_id,dedup_key'],
  ['orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_tenant_unique_ref', 'tenant_id,evidence_id,storage_ref'],
];

const FORBIDDEN_COLUMNS = [
  'raw_payload', 'payload', 'access_token', 'refresh_token', 'authorization',
  'email', 'phone', 'comment', 'cookie', 'body', 'media_bytes',
];

const BARE_UNIQUE_COLS = ['id', 'external_id', 'dedup_key', 'idempotency_key', 'provider_advertiser_id', 'provider_external_id'];

const SHA256_A = 'a'.repeat(64);
const SHA256_B = 'b'.repeat(64);
const SHA256_C = 'c'.repeat(64);

const SUFFIX = `aor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`;
}

function asCols(cols) {
  if (Array.isArray(cols)) return cols.map(String);
  return String(cols || '').replace(/^{|}$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function uniqueIndexCols(table) {
  const p = db.getPool();
  const rows = (await p.query(
    `SELECT i.relname AS index_name,
            ix.indisprimary,
            array_agg(a.attname ORDER BY x.n) AS cols
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE t.relname = $1
        AND ix.indisunique
        AND a.attnum > 0
      GROUP BY i.relname, ix.indisprimary`,
    [table]
  )).rows;
  return rows.map((r) => ({
    name: r.index_name,
    primary: r.indisprimary,
    cols: r.cols,
  }));
}

async function constraints(table) {
  const p = db.getPool();
  return (await p.query(
    `SELECT tc.constraint_name, tc.constraint_type,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public' AND tc.table_name = $1
        AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
      GROUP BY tc.constraint_name, tc.constraint_type`,
    [table]
  )).rows;
}

async function tenantFk(table) {
  const p = db.getPool();
  return (await p.query(
    `SELECT confrel.relname AS foreign_table,
            con.confdeltype AS delete_type
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_class confrel ON confrel.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = $1
        AND con.contype = 'f'
        AND confrel.relname = 'tenants'
        AND att.attname = 'tenant_id'
        AND k.n = 1`,
    [table]
  )).rows[0];
}

async function namedFkCols(table, name) {
  const p = db.getPool();
  const row = (await p.query(
    `SELECT string_agg(att.attname, ',' ORDER BY k.n) AS cols
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = $1
        AND con.conname = $2
        AND con.contype = 'f'
      GROUP BY con.oid`,
    [table, name]
  )).rows[0];
  return row ? row.cols : null;
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
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state, research_brief, search_parameters)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10::jsonb)`,
    [
      id,
      tenantId,
      wfId,
      approvalId,
      opts.approvalObjectVersion || 1,
      opts.platforms || ['meta'],
      opts.idempotencyKey || nid('idemp'),
      opts.state || 'pending',
      opts.researchBrief || '',
      JSON.stringify(opts.searchParameters || {}),
    ]
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
  await p.query(
    `INSERT INTO orchestrator_research_evidence
       (id, tenant_id, research_run_id, competitor_id, platform, source_type,
        provider_external_id, headline, body_text, captured_at, provider_metrics,
        provenance_method, connector_id, connector_version, evidence_hash, dedup_key,
        supersedes_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10::jsonb, $11,$12,$13,$14,$15,$16)`,
    [
      id,
      tenantId,
      runId,
      competitorId,
      opts.platform || 'meta',
      opts.sourceType || 'ad_creative',
      opts.providerExternalId || null,
      opts.headline || '',
      opts.bodyText || '',
      JSON.stringify(opts.providerMetrics || {}),
      opts.provenanceMethod || 'ad_library',
      opts.connectorId || 'meta_research',
      opts.connectorVersion || '1.0.0',
      opts.evidenceHash || SHA256_A,
      opts.dedupKey || nid('ededup'),
      opts.supersedesId || null,
    ]
  );
  return id;
}

if (!HAS_DB) {
  test('advertising-orchestrator research schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
    tenantA = await mk(`AOR A ${SUFFIX}`, `aor-a-${SUFFIX}`);
    tenantB = await mk(`AOR B ${SUFFIX}`, `aor-b-${SUFFIX}`);
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('PR3A research tables exist with NOT NULL tenant_id FK CASCADE and PK (tenant_id, id)', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...TABLES].sort(), 'all PR3A tables must exist');

    for (const table of TABLES) {
      const col = (await p.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`,
        [table]
      )).rows[0];
      assert.ok(col, `${table}.tenant_id must exist`);
      assert.strictEqual(col.is_nullable, 'NO', `${table}.tenant_id must be NOT NULL`);

      const pk = (await constraints(table)).filter((c) => c.constraint_type === 'PRIMARY KEY');
      assert.ok(pk.some((c) => c.cols === 'tenant_id,id'), `${table} PRIMARY KEY must be (tenant_id, id)`);

      const fk = await tenantFk(table);
      assert.ok(fk, `${table}.tenant_id must be a foreign key`);
      assert.strictEqual(fk.foreign_table, 'tenants', `${table}.tenant_id must reference tenants`);
      assert.strictEqual(fk.delete_type, 'c', `${table}.tenant_id must ON DELETE CASCADE`);
    }

    const wf = (await p.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='orchestrator_workflows'`
    )).rows;
    assert.strictEqual(wf.length, 1, 'PR1 orchestrator_workflows must still exist');
  });

  test('second ensureAgentOrchestratorSchema is idempotent', async () => {
    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    const fkCols = await namedFkCols(
      'orchestrator_research_evidence',
      'orchestrator_research_evidence_tenant_competitor_fkey'
    );
    assert.strictEqual(
      fkCols,
      'tenant_id,research_run_id,competitor_id',
      'competitor FK must stay (tenant_id, research_run_id, competitor_id) after repeated ensure'
    );
  });

  test('unique indexes/constraints lead with tenant_id; no bare natural-key uniques', async () => {
    for (const [table, name, cols] of TENANT_UNIQUE_CONSTRAINTS) {
      const cons = await constraints(table);
      const unique = cons.filter((c) => c.constraint_type === 'UNIQUE');
      assert.ok(
        unique.some((c) => c.constraint_name === name && c.cols === cols),
        `${name} UNIQUE (${cols}) must exist on ${table}`
      );
    }

    const parentUniques = [
      ['orchestrator_workflows', 'orchestrator_workflows_tenant_unique_id', 'tenant_id,id'],
      ['orchestrator_approvals', 'orchestrator_approvals_tenant_unique_id', 'tenant_id,id'],
    ];
    for (const [table, name, cols] of parentUniques) {
      const cons = await constraints(table);
      assert.ok(
        cons.some((c) => c.constraint_type === 'UNIQUE' && c.constraint_name === name && c.cols === cols),
        `${name} UNIQUE (${cols}) must exist on ${table}`
      );
    }

    const liveIdx = (await db.getPool().query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public'
          AND indexname='orchestrator_research_runs_tenant_unique_live_wf'`
    )).rows[0];
    assert.ok(liveIdx, 'orchestrator_research_runs_tenant_unique_live_wf must exist');
    assert.match(liveIdx.indexdef, /UNIQUE/i);
    assert.match(liveIdx.indexdef, /tenant_id/);
    assert.match(liveIdx.indexdef, /workflow_id/);
    assert.match(liveIdx.indexdef, /WHERE/i);

    for (const table of TABLES) {
      const idxs = await uniqueIndexCols(table);
      for (const idx of idxs) {
        const cols = asCols(idx.cols);
        assert.strictEqual(
          cols[0],
          'tenant_id',
          `${table} unique index ${idx.name} must lead with tenant_id (got ${cols.join(',')})`
        );
        if (cols.length === 1) {
          assert.fail(`${table} unique index ${idx.name} is a single-column unique`);
        }
        if (cols.length === 1 || (cols.length === 1 && BARE_UNIQUE_COLS.includes(cols[0]))) {
          assert.fail(`${table} must not unique ${cols[0]} alone`);
        }
        if (cols.length === 1 && BARE_UNIQUE_COLS.includes(cols[0])) {
          assert.fail(`${table} unique on ${cols[0]} alone`);
        }
      }
      assert.ok(
        !idxs.some((i) => {
          const cols = asCols(i.cols);
          return cols.length === 1 && BARE_UNIQUE_COLS.includes(cols[0]);
        }),
        `${table} must not have UNIQUE on id/dedup_key/idempotency_key/external id alone`
      );
    }
  });

  test('cross-tenant composite FKs reject workflow, approval, competitor, and evidence references', async () => {
    const p = db.getPool();
    const hostA = await seedHost(p, tenantA);
    const hostB = await seedHost(p, tenantB);
    const compA = await insertCompetitor(p, tenantA, hostA.runId);
    await insertCompetitor(p, tenantB, hostB.runId);

    await assert.rejects(
      () => insertRun(p, tenantB, hostA.wfId, hostB.approvalId, { id: nid('run-xwf') }),
      /foreign key|violates|approval_required/i,
      'tenant B run must not reference tenant A workflow_id'
    );
    await assert.rejects(
      () => insertRun(p, tenantB, hostB.wfId, hostA.approvalId, { id: nid('run-xappr') }),
      /foreign key|violates|approval_required/i,
      'tenant B run must not reference tenant A approval_id'
    );
    await assert.rejects(
      () => insertCompetitor(p, tenantB, hostA.runId, { id: nid('comp-xrun') }),
      /foreign key|violates/i,
      'tenant B competitor must not reference tenant A research_run_id'
    );
    const compB = (await p.query(
      `SELECT id FROM orchestrator_research_competitors WHERE tenant_id=$1 LIMIT 1`,
      [tenantB]
    )).rows[0].id;
    await assert.rejects(
      () => insertEvidence(p, tenantB, hostA.runId, compB, { id: nid('ev-xrun') }),
      /foreign key|violates/i,
      'tenant B evidence must not reference tenant A research_run_id'
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, hostA.runId, compB, { id: nid('ev-xcomp') }),
      /foreign key|violates/i,
      'tenant A evidence must not cite tenant B competitor'
    );

    const evidenceA = await insertEvidence(p, tenantA, hostA.runId, compA, { id: nid('ev-ok') });
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_evidence_assets
           (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at)
         VALUES ($1,$2,$3,'image',$4,$5, now())`,
        [nid('asset-xev'), tenantB, evidenceA, `research://meta/${evidenceA}`, SHA256_C]
      ),
      /foreign key|violates/i,
      'tenant B asset must not reference tenant A evidence_id'
    );
  });

  test('evidence competitor FK binds the same research run; UNIQUE (tenant_id, research_run_id, id) exists', async () => {
    const p = db.getPool();

    const unique = (await constraints('orchestrator_research_competitors'))
      .filter((c) => c.constraint_type === 'UNIQUE');
    assert.ok(
      unique.some((c) =>
        c.constraint_name === 'orchestrator_research_competitors_tenant_unique_run_id'
        && c.cols === 'tenant_id,research_run_id,id'
      ),
      'orchestrator_research_competitors_tenant_unique_run_id UNIQUE (tenant_id, research_run_id, id) must exist'
    );

    const fkCols = await namedFkCols(
      'orchestrator_research_evidence',
      'orchestrator_research_evidence_tenant_competitor_fkey'
    );
    assert.strictEqual(
      fkCols,
      'tenant_id,research_run_id,competitor_id',
      'competitor FK must be (tenant_id, research_run_id, competitor_id)'
    );

    const run1 = await seedHost(p, tenantA);
    const run2 = await seedHost(p, tenantA);
    const compRun1 = await insertCompetitor(p, tenantA, run1.runId);
    await assert.rejects(
      () => insertEvidence(p, tenantA, run2.runId, compRun1, { id: nid('ev-xrun-comp') }),
      /foreign key|violates/i,
      'same-tenant evidence must not cite a competitor from another research run'
    );
    await insertEvidence(p, tenantA, run1.runId, compRun1, { id: nid('ev-samerun') });
  });

  test('CHECK rejects invalid platform, source_type, state, and contract_version', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);

    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_runs
           (id, tenant_id, workflow_id, approval_id, approval_object_version,
            requested_platforms, idempotency_key, state)
         VALUES ($1,$2,$3,$4,1, ARRAY['meta']::text[], $5, 'done')`,
        [nid('run-bad-state'), tenantA, host.wfId, host.approvalId, nid('idemp')]
      ),
      /state|check/i,
      'invalid research run state must be rejected'
    );
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_runs
           (id, tenant_id, workflow_id, approval_id, approval_object_version,
            requested_platforms, idempotency_key, contract_version)
         VALUES ($1,$2,$3,$4,1, ARRAY['meta']::text[], $5, 'v2')`,
        [nid('run-bad-cv'), tenantA, host.wfId, host.approvalId, nid('idemp')]
      ),
      /contract_version|check/i,
      'invalid contract_version must be rejected'
    );
    const facebookAppr = await insertApproval(p, tenantA, host.wfId, {
      approvedPlatforms: ['meta', 'facebook'],
      contentHash: nid('hash-facebook'),
    });
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_runs
           (id, tenant_id, workflow_id, approval_id, approval_object_version,
            requested_platforms, idempotency_key)
         VALUES ($1,$2,$3,$4,1, ARRAY['facebook']::text[], $5)`,
        [nid('run-bad-plat'), tenantA, host.wfId, facebookAppr, nid('idemp')]
      ),
      /requested_platforms|check/i,
      'invalid requested platform must be rejected'
    );

    const comp = await insertCompetitor(p, tenantA, host.runId);
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_competitors
           (id, tenant_id, research_run_id, platform, provider_advertiser_id, normalized_name,
            discovery_source, captured_at, dedup_key)
         VALUES ($1,$2,$3,'facebook',$4,'x','ad_library', now(), $5)`,
        [nid('comp-bad-plat'), tenantA, host.runId, nid('adv'), nid('cdedup')]
      ),
      /platform|check/i,
      'invalid competitor platform must be rejected'
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, { id: nid('ev-bad-src'), sourceType: 'secret' }),
      /source_type|check/i,
      'invalid source_type must be rejected'
    );
  });

  test('tenant-scoped idempotency, competitor dedup, and evidence dedup serialize under concurrency', async () => {
    const pool = db.getPool();
    const host = await seedHost(pool, tenantA);
    const sharedIdemp = nid('idemp-conc');
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      const runResults = await Promise.allSettled([
        insertRun(c1, tenantA, host.wfId, host.approvalId, {
          id: nid('run-conc-1'),
          idempotencyKey: sharedIdemp,
          state: 'completed',
        }),
        insertRun(c2, tenantA, host.wfId, host.approvalId, {
          id: nid('run-conc-2'),
          idempotencyKey: sharedIdemp,
          state: 'completed',
        }),
      ]);
      const runOk = runResults.filter((r) => r.status === 'fulfilled');
      const runFail = runResults.filter((r) => r.status === 'rejected');
      assert.strictEqual(runOk.length, 1, 'exactly one concurrent idempotent run insert must succeed');
      assert.strictEqual(runFail.length, 1, 'exactly one concurrent idempotent run insert must fail');
      assert.strictEqual(runFail[0].reason.code, '23505');

      const sharedCompDedup = nid('cdedup-conc');
      const compResults = await Promise.allSettled([
        insertCompetitor(c1, tenantA, host.runId, { id: nid('comp-conc-1'), dedupKey: sharedCompDedup, providerAdvertiserId: nid('adv') }),
        insertCompetitor(c2, tenantA, host.runId, { id: nid('comp-conc-2'), dedupKey: sharedCompDedup, providerAdvertiserId: nid('adv') }),
      ]);
      const compOk = compResults.filter((r) => r.status === 'fulfilled');
      const compFail = compResults.filter((r) => r.status === 'rejected');
      assert.strictEqual(compOk.length, 1, 'exactly one concurrent competitor dedup insert must succeed');
      assert.strictEqual(compFail.length, 1, 'exactly one concurrent competitor dedup insert must fail');
      assert.strictEqual(compFail[0].reason.code, '23505');

      const compId = await insertCompetitor(pool, tenantA, host.runId);
      const sharedEvDedup = nid('ededup-conc');
      const evResults = await Promise.allSettled([
        insertEvidence(c1, tenantA, host.runId, compId, { id: nid('ev-conc-1'), dedupKey: sharedEvDedup, evidenceHash: SHA256_A }),
        insertEvidence(c2, tenantA, host.runId, compId, { id: nid('ev-conc-2'), dedupKey: sharedEvDedup, evidenceHash: SHA256_B }),
      ]);
      const evOk = evResults.filter((r) => r.status === 'fulfilled');
      const evFail = evResults.filter((r) => r.status === 'rejected');
      assert.strictEqual(evOk.length, 1, 'exactly one concurrent evidence dedup insert must succeed');
      assert.strictEqual(evFail.length, 1, 'exactly one concurrent evidence dedup insert must fail');
      assert.strictEqual(evFail[0].reason.code, '23505');
    } finally {
      c1.release();
      c2.release();
    }
  });

  test('same provider_advertiser_id, provider_external_id, and evidence id may exist for different tenants', async () => {
    const p = db.getPool();
    const hostA = await seedHost(p, tenantA);
    const hostB = await seedHost(p, tenantB);
    const sharedAdv = `adv-shared-${SUFFIX}`;
    const sharedExt = `ext-shared-${SUFFIX}`;
    const sharedEvId = `ev-shared-${SUFFIX}`;
    const sharedCompId = `comp-shared-${SUFFIX}`;

    await insertCompetitor(p, tenantA, hostA.runId, {
      id: sharedCompId,
      providerAdvertiserId: sharedAdv,
      dedupKey: nid('cdedup'),
    });
    await insertCompetitor(p, tenantB, hostB.runId, {
      id: sharedCompId,
      providerAdvertiserId: sharedAdv,
      dedupKey: nid('cdedup'),
    });
    await insertEvidence(p, tenantA, hostA.runId, sharedCompId, {
      id: sharedEvId,
      providerExternalId: sharedExt,
      evidenceHash: SHA256_A,
    });
    await insertEvidence(p, tenantB, hostB.runId, sharedCompId, {
      id: sharedEvId,
      providerExternalId: sharedExt,
      evidenceHash: SHA256_A,
    });

    const counts = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orchestrator_research_competitors
           WHERE provider_advertiser_id=$1) AS comps,
         (SELECT COUNT(*)::int FROM orchestrator_research_evidence
           WHERE id=$2) AS evidence`,
      [sharedAdv, sharedEvId]
    );
    assert.strictEqual(counts.rows[0].comps, 2);
    assert.strictEqual(counts.rows[0].evidence, 2);
  });

  test('evidence UPDATE is rejected; replacement INSERT with supersedes_id succeeds', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const evId = await insertEvidence(p, tenantA, host.runId, comp, {
      headline: 'original',
      evidenceHash: SHA256_A,
    });

    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence SET headline='tamper' WHERE tenant_id=$1 AND id=$2`,
        [tenantA, evId]
      ),
      /orchestrator_research_evidence_immutable/
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, evId]
      ),
      /orchestrator_research_evidence_immutable/
    );

    const replacement = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-super'),
      headline: 'corrected',
      evidenceHash: SHA256_B,
      supersedesId: evId,
    });
    const row = (await p.query(
      `SELECT supersedes_id, headline FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, replacement]
    )).rows[0];
    assert.strictEqual(row.supersedes_id, evId);
    assert.strictEqual(row.headline, 'corrected');

    const original = (await p.query(
      `SELECT headline FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, evId]
    )).rows[0];
    assert.strictEqual(original.headline, 'original', 'original provenance must be unchanged');
  });

  test('oversized research_brief, provider_metrics, headline, and body_text fail CHECK', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);

    await assert.rejects(
      () => insertRun(p, tenantA, host.wfId, host.approvalId, {
        id: nid('run-brief'),
        researchBrief: 'x'.repeat(4001),
        state: 'completed',
      }),
      /research_brief|check/i
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-head'),
        headline: 'h'.repeat(501),
      }),
      /headline|check/i
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-body'),
        bodyText: 'b'.repeat(4001),
      }),
      /body_text|check/i
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-metrics'),
        providerMetrics: { blob: 'm'.repeat(9000) },
      }),
      /provider_metrics|check/i
    );
  });

  test('forbidden dump/PII columns and BYTEA do not exist on PR3A tables', async () => {
    const p = db.getPool();
    const forbidden = (await p.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name = ANY($1)
          AND column_name = ANY($2)`,
      [TABLES, FORBIDDEN_COLUMNS]
    )).rows;
    assert.deepStrictEqual(forbidden, [], 'PR3A tables must not have dump/PII columns');

    const bytea = (await p.query(
      `SELECT table_name, column_name, udt_name
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name = ANY($1)
          AND (udt_name = 'bytea' OR column_name IN ('media_bytes','raw_bytes','asset_bytes'))`,
      [TABLES]
    )).rows;
    assert.deepStrictEqual(bytea, [], 'PR3A tables must not have BYTEA or media_bytes columns');

    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const evId = await insertEvidence(p, tenantA, host.runId, comp);
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_evidence_assets
           (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at, media_bytes)
         VALUES ($1,$2,$3,'image',$4,$5, now(), $6::bytea)`,
        [nid('asset-bytea'), tenantA, evId, 's3://bucket/key', SHA256_C, Buffer.from('nope')]
      ),
      /column .*media_bytes|does not exist/i
    );
  });

  test('approval-binding trigger requires matching research_execution approved snapshot', async () => {
    const p = db.getPool();
    const wfId = nid('wf-bind');
    await insertWorkflow(p, tenantA, wfId);
    const approved = await insertApproval(p, tenantA, wfId, { objectVersion: 1 });

    await assert.rejects(
      () => insertRun(p, tenantA, wfId, 2147483646, { id: nid('run-missing-appr') }),
      /orchestrator_research_runs_approval_required|foreign key|violates/i,
      'missing approval must be rejected'
    );

    const wrongGate = await insertApproval(p, tenantA, wfId, {
      gate: 'creative_generation',
      contentHash: nid('hash-gate'),
    });
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, wrongGate, { id: nid('run-wrong-gate') }),
      /orchestrator_research_runs_approval_required/
    );

    const rejected = await insertApproval(p, tenantA, wfId, {
      decision: 'rejected',
      contentHash: nid('hash-rej'),
    });
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, rejected, { id: nid('run-rejected') }),
      /orchestrator_research_runs_approval_required/
    );

    const wfOther = nid('wf-other');
    await insertWorkflow(p, tenantA, wfOther);
    const otherAppr = await insertApproval(p, tenantA, wfOther, { contentHash: nid('hash-other') });
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, otherAppr, { id: nid('run-wf-mismatch') }),
      /orchestrator_research_runs_approval_required|foreign key|violates/i
    );

    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approved, {
        id: nid('run-ver-mismatch'),
        approvalObjectVersion: 99,
      }),
      /orchestrator_research_runs_approval_required/
    );

    const emptyPlat = await insertApproval(p, tenantA, wfId, {
      approvedPlatforms: [],
      contentHash: nid('hash-empty'),
    });
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, emptyPlat, { id: nid('run-empty-plat') }),
      /orchestrator_research_runs_approval_required/
    );

    await insertRun(p, tenantA, wfId, approved, { id: nid('run-bind-ok') });
  });

  test('research_runs identity columns cannot be updated; state can', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA, { id: nid('run-ident') });

    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_runs SET requested_platforms = ARRAY['google']::text[]
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, host.runId]
      ),
      /orchestrator_research_runs_identity_immutable/
    );
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_runs SET idempotency_key=$3
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, host.runId, nid('idemp-tamper')]
      ),
      /orchestrator_research_runs_identity_immutable/
    );
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_runs SET research_brief='tamper'
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, host.runId]
      ),
      /orchestrator_research_runs_identity_immutable/
    );
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_runs SET workflow_id=$3
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, host.runId, nid('wf-tamper')]
      ),
      /orchestrator_research_runs_identity_immutable|orchestrator_research_runs_approval_required/
    );

    await p.query(
      `UPDATE orchestrator_research_runs
          SET state='running', started_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, host.runId]
    );
    const row = (await p.query(
      `SELECT state FROM orchestrator_research_runs WHERE tenant_id=$1 AND id=$2`,
      [tenantA, host.runId]
    )).rows[0];
    assert.strictEqual(row.state, 'running');
  });

  test('live partial unique allows history but only one pending/running run per workflow+contract', async () => {
    const p = db.getPool();
    const wfId = nid('wf-live');
    await insertWorkflow(p, tenantA, wfId);
    const approvalId = await insertApproval(p, tenantA, wfId);
    const first = await insertRun(p, tenantA, wfId, approvalId, {
      id: nid('run-live-1'),
      state: 'pending',
    });

    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-live-2'),
        state: 'running',
      }),
      /unique|duplicate|23505/i
    );

    await p.query(
      `UPDATE orchestrator_research_runs SET state='completed', completed_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, first]
    );

    const second = await insertRun(p, tenantA, wfId, approvalId, {
      id: nid('run-live-3'),
      state: 'pending',
    });
    const count = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_runs
        WHERE tenant_id=$1 AND workflow_id=$2`,
      [tenantA, wfId]
    )).rows[0].n;
    assert.strictEqual(count, 2);
    assert.ok(second);
  });

  test('DELETE FROM tenants cascades all four PR3A research tables', async () => {
    const p = db.getPool();
    const tenantC = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AOR C ${SUFFIX}`, `aor-c-${SUFFIX}`]
    )).rows[0].id;
    const host = await seedHost(p, tenantC);
    const comp = await insertCompetitor(p, tenantC, host.runId, { id: nid('comp-casc') });
    const evId = await insertEvidence(p, tenantC, host.runId, comp, { id: nid('ev-casc') });
    await p.query(
      `INSERT INTO orchestrator_research_evidence_assets
         (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at)
       VALUES ($1,$2,$3,'image',$4,$5, now())`,
      [nid('asset-casc'), tenantC, evId, `s3://orch/${SUFFIX}/asset`, SHA256_C]
    );

    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantC]);

    const left = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tenants WHERE id=$1) AS tenants,
         (SELECT COUNT(*)::int FROM orchestrator_research_runs WHERE tenant_id=$1) AS runs,
         (SELECT COUNT(*)::int FROM orchestrator_research_competitors WHERE tenant_id=$1) AS comps,
         (SELECT COUNT(*)::int FROM orchestrator_research_evidence WHERE tenant_id=$1) AS evidence,
         (SELECT COUNT(*)::int FROM orchestrator_research_evidence_assets WHERE tenant_id=$1) AS assets`,
      [tenantC]
    );
    assert.strictEqual(left.rows[0].tenants, 0);
    assert.strictEqual(left.rows[0].runs, 0, 'tenant DELETE must cascade research_runs');
    assert.strictEqual(left.rows[0].comps, 0, 'tenant DELETE must cascade competitors');
    assert.strictEqual(left.rows[0].evidence, 0, 'tenant DELETE must cascade evidence');
    assert.strictEqual(left.rows[0].assets, 0, 'tenant DELETE must cascade evidence assets');
  });

  test('asset UPDATE is rejected while parent evidence exists; no BYTEA insert surface', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const evId = await insertEvidence(p, tenantA, host.runId, comp);
    const assetId = nid('asset-immut');
    await p.query(
      `INSERT INTO orchestrator_research_evidence_assets
         (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at)
       VALUES ($1,$2,$3,'image',$4,$5, now())`,
      [assetId, tenantA, evId, `s3://orch/${assetId}`, SHA256_C]
    );
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence_assets SET storage_ref='s3://tamper'
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetId]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetId]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );
  });
}
