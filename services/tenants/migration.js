// services/tenants/migration.js — Phase 2 table migration helper
//
// One function, `addTenantIdColumn(tableName, options)`, that:
//   1. Adds  `tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`
//      to the target table if not already present.
//   2. Backfills NULL `tenant_id` rows to the platform's default tenant
//      (the first tenant owned by an is_owner=TRUE user). All pre-multi-
//      tenancy data was global+owner-gated, so it logically belongs there.
//   3. Creates an index on (tenant_id) — or (tenant_id, <extra cols>) if
//      `options.indexExtra` is provided — for query performance.
//   4. Optionally drops a singleton CHECK constraint (e.g. brand_foundation's
//      `CHECK (id = 1)`) so per-tenant rows become possible.
//   5. Optionally adds a UNIQUE (tenant_id [, ...extra]) constraint to
//      preserve per-tenant singleton semantics where the table is meant to
//      hold one row per tenant.
//
// Idempotent on every boot. Safe to call repeatedly. The column stays
// NULLABLE during Phase 2 — once every service is wired to set it,
// `markTenantIdNotNull(tableName)` can flip it (Phase 2 closeout).
//
// Closeout uses `enforceTenantIdNotNull` / `{ failClosed:true }`.
// That path NEVER backfills with `_getDefaultTenantId`. A read-only preflight
// runs FIRST: if any row would remain NULL after the simulated parent JOIN,
// the helper returns `{ ok:false, reason:'preflight' }` and performs zero DDL
// and zero UPDATEs (no half-migrated UNIQUE/CHECK/INDEX/ADD COLUMN).
// Parent backfill UPDATE is allowed only after preflight says every remaining
// NULL is parent-mappable, then ADD COLUMN + UPDATE + SET NOT NULL commit
// together. A defensive in-transaction NULL check ROLLBACKs (never COMMITs
// partial DDL) with `{ ok:false, reason:'orphans' }`.

const _db = require('../../db');
const {
  preflightUnmappedForTable,
  PARENT_BACKFILL,
} = require('./preflight');

async function _tableExists(p, name) {
  const r = await p.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1 LIMIT 1`, [name]);
  return r.rowCount > 0;
}

async function _columnExists(p, table, column) {
  const r = await p.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, column]);
  return r.rowCount > 0;
}

async function _constraintExists(p, table, constraint) {
  const r = await p.query(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema='public' AND table_name=$1 AND constraint_name=$2 LIMIT 1`,
    [table, constraint]);
  return r.rowCount > 0;
}

async function _indexExists(p, indexName) {
  const r = await p.query(
    `SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND indexname=$1 LIMIT 1`, [indexName]);
  return r.rowCount > 0;
}

async function _getDefaultTenantId(p) {
  let r = await p.query(`
    SELECT t.id
      FROM tenants t
      JOIN users   u ON u.id = t.created_by_user_id
     WHERE t.status='active' AND u.is_owner=TRUE
     ORDER BY t.id ASC LIMIT 1
  `);
  if (!r.rows[0]) {
    r = await p.query(`SELECT id FROM tenants WHERE status='active' ORDER BY id ASC LIMIT 1`);
  }
  return r.rows[0] ? r.rows[0].id : null;
}

async function _tenantFkExists(p, table) {
  const r = await p.query(
    `SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE n.nspname = 'public'
        AND t.relname = $1
        AND c.contype = 'f'
        AND a.attname = 'tenant_id'
      LIMIT 1`,
    [table]);
  return r.rowCount > 0;
}

async function _isTenantIdNullable(p, table) {
  const col = await p.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id' LIMIT 1`,
    [table]);
  return !!(col.rows[0] && col.rows[0].is_nullable === 'YES');
}

/**
 * Fail-closed tenant_id closeout for an existing production table.
 *
 * Never assigns rows to tenant 1 / the default tenant. Optional
 * `backfillFrom` copies tenant_id from a parent row only when the parent
 * itself has a non-null tenant_id.
 *
 * Fail-before-DDL: a read-only preflight runs first. If any row would remain
 * NULL after the simulated parent JOIN, this returns
 * `{ ok:false, reason:'preflight' }` with zero DDL and zero UPDATEs.
 * Parent UPDATE is allowed only after every remaining NULL is parent-mappable;
 * ADD COLUMN + UPDATE + SET NOT NULL then commit together.
 * Does not DELETE. Boot-safe (never throws). Transactional per table.
 *
 * @param {string} tableName
 * @param {object} [options]
 * @param {string[]} [options.indexExtra]
 * @param {string} [options.dropCheck]
 * @param {string[]} [options.uniqueWithExtra]
 * @param {{parentTable:string,parentIdColumn:string,childFkColumn:string}} [options.backfillFrom]
 */
async function enforceTenantIdNotNull(tableName, options = {}) {
  if (!_db.hasDb()) return { ok:false, reason:'no_db' };
  const p = _db.getPool();
  const t = _safeIdent(tableName);

  if (!(await _tableExists(p, t))) {
    return { ok:false, reason:'table_missing', table:t };
  }

  const result = {
    table: t,
    added: false,
    backfilled: 0,
    indexed: false,
    droppedCheck: false,
    uniqueAdded: false,
    notNullSet: false,
    fkAdded: false,
  };

  const backfillFrom = options.backfillFrom || PARENT_BACKFILL[t] || null;

  // Read-only preflight BEFORE any DDL / UPDATE. Unresolved rows abort with
  // zero schema change so the table is never left half-migrated.
  try {
    const pre = await preflightUnmappedForTable(t, { backfillFrom });
    if (pre.count > 0) {
      console.error(
        `[tenants/migration] FAIL-BEFORE-DDL preflight on ${t}: ${pre.count} unmapped row(s) — ` +
        `zero DDL, zero UPDATEs; rows left in place (no default-tenant assignment). ` +
        `Run: DATABASE_URL=postgres://… node scripts/tenant-schema-preflight.js`
      );
      return Object.assign({
        ok: false,
        reason: 'preflight',
        orphanCount: pre.count,
        ids: pre.ids,
        columnMissing: pre.columnMissing,
      }, result);
    }
  } catch (e) {
    console.error(`[tenants/migration] preflight error on ${t}: ${e.message}`);
    return Object.assign({ ok:false, reason:'preflight', error:e.message }, result);
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');

    if (!(await _columnExists(client, t, 'tenant_id'))) {
      await client.query(
        `ALTER TABLE ${t} ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`
      );
      result.added = true;
    }

    if (backfillFrom) {
      const parent = _safeIdent(backfillFrom.parentTable);
      const parentId = _safeIdent(backfillFrom.parentIdColumn);
      const childFk = _safeIdent(backfillFrom.childFkColumn);
      const r = await client.query(
        `UPDATE ${t} AS child
            SET tenant_id = parent.tenant_id
           FROM ${parent} AS parent
          WHERE child.${childFk} = parent.${parentId}
            AND child.tenant_id IS NULL
            AND parent.tenant_id IS NOT NULL`
      );
      result.backfilled = r.rowCount || 0;
    }

    // Always (tenant_id); plus (tenant_id, extras) when requested.
    const tenantIdx = `${t}_tenant_idx`.slice(0, 63);
    if (!(await _indexExists(client, tenantIdx))) {
      await client.query(`CREATE INDEX ${tenantIdx} ON ${t} (tenant_id)`);
      result.indexed = true;
    }
    const extras = Array.isArray(options.indexExtra) ? options.indexExtra.map(_safeIdent) : [];
    if (extras.length) {
      const idxCols = ['tenant_id', ...extras].join(', ');
      const idxName = `${t}_tenant_idx_${extras.join('_')}`.slice(0, 63);
      if (!(await _indexExists(client, idxName))) {
        await client.query(`CREATE INDEX ${idxName} ON ${t} (${idxCols})`);
        result.indexed = true;
      }
    }

    if (options.dropCheck) {
      const c = _safeIdent(options.dropCheck);
      if (await _constraintExists(client, t, c)) {
        await client.query(`ALTER TABLE ${t} DROP CONSTRAINT ${c}`);
        result.droppedCheck = true;
      }
    }

    if (Array.isArray(options.uniqueWithExtra)) {
      const uExtras = options.uniqueWithExtra.map(_safeIdent);
      const uCols = ['tenant_id', ...uExtras].join(', ');
      const uName = `${t}_tenant_unique${uExtras.length ? '_' + uExtras.join('_') : ''}`.slice(0, 63);
      if (!(await _constraintExists(client, t, uName))) {
        try {
          await client.query(`ALTER TABLE ${t} ADD CONSTRAINT ${uName} UNIQUE (${uCols})`);
          result.uniqueAdded = true;
        } catch (e) {
          console.error(`[tenants/migration] fail-closed UNIQUE on ${t}(${uCols}): ${e.message}`);
          result.uniqueError = e.message;
        }
      }
    }

    const nulls = await client.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id IS NULL`);
    const orphanCount = nulls.rows[0].n;
    if (orphanCount > 0) {
      // Defensive: preflight should have caught this. ROLLBACK so we never
      // commit ADD COLUMN / INDEX / UNIQUE / DROP CHECK without SET NOT NULL.
      await client.query('ROLLBACK');
      console.error(
        `[tenants/migration] FAIL-CLOSED orphans on ${t}: ${orphanCount} row(s) still NULL — ` +
        `transaction rolled back (no partial DDL); rows left in place (no default-tenant assignment)`
      );
      return Object.assign({
        ok: false,
        reason: 'orphans',
        orphanCount,
        added: false,
        backfilled: 0,
        indexed: false,
        droppedCheck: false,
        uniqueAdded: false,
        notNullSet: false,
        fkAdded: false,
      }, { table: t });
    }

    if (await _isTenantIdNullable(client, t)) {
      await client.query(`ALTER TABLE ${t} ALTER COLUMN tenant_id SET NOT NULL`);
      result.notNullSet = true;
    }

    if (!(await _tenantFkExists(client, t))) {
      const fkName = `${t}_tenant_id_fkey`.slice(0, 63);
      // SAVEPOINT so an FK ADD failure cannot abort the outer transaction.
      // Without it, PostgreSQL treats the later COMMIT as ROLLBACK and the
      // caller would see { ok:true } while SET NOT NULL / UNIQUE were discarded.
      await client.query('SAVEPOINT closeout_fk');
      try {
        await client.query(
          `ALTER TABLE ${t} ADD CONSTRAINT ${fkName} FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`
        );
        await client.query('RELEASE SAVEPOINT closeout_fk');
        result.fkAdded = true;
      } catch (e) {
        // Must succeed: if this throws, the outer catch ROLLBACKs (never COMMIT).
        await client.query('ROLLBACK TO SAVEPOINT closeout_fk');
        console.warn(`[tenants/migration] fail-closed FK on ${t}.tenant_id: ${e.message}`);
        result.fkError = e.message;
      }
    }

    await client.query('COMMIT');
    return Object.assign({ ok:true }, result);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
    console.error(`[tenants/migration] fail-closed closeout failed on ${t}: ${e.message}`);
    return Object.assign({ ok:false, reason:'error', error:e.message }, result);
  } finally {
    client.release();
  }
}

// Validate an identifier so we can safely interpolate it into DDL strings.
// PostgreSQL identifiers: [a-z_][a-z0-9_]*  (lowercase, length-restricted to 63).
function _safeIdent(name) {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`unsafe SQL identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * @param {string} tableName
 * @param {object} [options]
 * @param {string[]} [options.indexExtra]      additional columns to include in the
 *                                             secondary index, e.g. ['created_at'].
 * @param {string} [options.dropCheck]         name of a CHECK constraint to drop
 *                                             (e.g. 'brand_foundation_singleton').
 * @param {string[]} [options.uniqueWithExtra] columns to combine with tenant_id
 *                                             for a UNIQUE constraint. Pass [] to
 *                                             enforce one row per tenant.
 *                                             Omit to skip the unique constraint.
 * @param {boolean} [options.notNull]          when true, flip tenant_id to NOT NULL
 *                                             after a successful backfill (every row
 *                                             has a tenant). Graceful: if any row is
 *                                             still NULL it logs + skips instead of
 *                                             throwing, so boot never crashes.
 * @param {boolean} [options.failClosed]       when true, skip the historical
 *                                             default-tenant backfill and run
 *                                             `enforceTenantIdNotNull` instead.
 *                                             Never assigns orphaned rows to
 *                                             tenant 1 / any default tenant.
 * @param {{parentTable:string,parentIdColumn:string,childFkColumn:string}} [options.backfillFrom]
 *                                             optional parent-join backfill used
 *                                             only by the fail-closed path.
 */
async function addTenantIdColumn(tableName, options = {}) {
  if (options.failClosed) {
    return enforceTenantIdNotNull(tableName, options);
  }
  if (!_db.hasDb()) return { ok:false, reason:'no_db' };
  const p = _db.getPool();
  const t = _safeIdent(tableName);

  if (!(await _tableExists(p, t))) {
    return { ok:false, reason:'table_missing', table:t };
  }

  const result = { table:t, added:false, backfilled:0, indexed:false, droppedCheck:false, uniqueAdded:false, notNullSet:false };

  // 1) Add tenant_id column if missing
  if (!(await _columnExists(p, t, 'tenant_id'))) {
    await p.query(`ALTER TABLE ${t} ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`);
    result.added = true;
  }

  // 2) Backfill NULLs to the default tenant
  const defaultTid = await _getDefaultTenantId(p);
  if (defaultTid) {
    const r = await p.query(`UPDATE ${t} SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTid]);
    result.backfilled = r.rowCount || 0;
  }

  // 3) Index
  const extras = Array.isArray(options.indexExtra) ? options.indexExtra.map(_safeIdent) : [];
  const idxCols = ['tenant_id', ...extras].join(', ');
  const idxName = `${t}_tenant_idx${extras.length ? '_' + extras.join('_') : ''}`.slice(0, 63);
  if (!(await _indexExists(p, idxName))) {
    await p.query(`CREATE INDEX ${idxName} ON ${t} (${idxCols})`);
    result.indexed = true;
  }

  // 4) Drop a singleton CHECK constraint if requested
  if (options.dropCheck) {
    const c = _safeIdent(options.dropCheck);
    if (await _constraintExists(p, t, c)) {
      await p.query(`ALTER TABLE ${t} DROP CONSTRAINT ${c}`);
      result.droppedCheck = true;
    }
  }

  // 5) Optional UNIQUE (tenant_id [, ...extras])
  if (Array.isArray(options.uniqueWithExtra)) {
    const uExtras = options.uniqueWithExtra.map(_safeIdent);
    const uCols = ['tenant_id', ...uExtras].join(', ');
    const uName = `${t}_tenant_unique${uExtras.length ? '_' + uExtras.join('_') : ''}`.slice(0, 63);
    if (!(await _constraintExists(p, t, uName))) {
      try {
        await p.query(`ALTER TABLE ${t} ADD CONSTRAINT ${uName} UNIQUE (${uCols})`);
        result.uniqueAdded = true;
      } catch (e) {
        // Don't crash boot — log + continue. Most common cause: existing duplicate
        // (tenant_id, ...) rows from pre-migration data. Operator can clean up.
        console.error(`[tenants/migration] could not add UNIQUE on ${t}(${uCols}): ${e.message}`);
        result.uniqueError = e.message;
      }
    }
  }

  // 6) Optionally flip tenant_id to NOT NULL after a successful backfill.
  // This is what keeps every workspace row owned by a tenant — no orphan
  // rows that bypass enforcement. Graceful by design: if a row is still NULL
  // (e.g. backfill skipped because no default tenant exists yet), we log and
  // skip rather than throw, so boot is never blocked. Idempotent: if the
  // column is already NOT NULL we do nothing.
  if (options.notNull) {
    try {
      const col = await p.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id' LIMIT 1`, [t]);
      const isNullable = col.rows[0] && col.rows[0].is_nullable === 'YES';
      if (isNullable) {
        const nulls = await p.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id IS NULL`);
        if (nulls.rows[0].n === 0) {
          await p.query(`ALTER TABLE ${t} ALTER COLUMN tenant_id SET NOT NULL`);
          result.notNullSet = true;
        } else {
          result.notNullSkipped = `${nulls.rows[0].n} null rows`;
          console.warn(`[tenants/migration] skipped NOT NULL on ${t}.tenant_id — ${nulls.rows[0].n} rows still NULL`);
        }
      }
    } catch (e) {
      result.notNullError = e.message;
      console.warn(`[tenants/migration] could not set NOT NULL on ${t}.tenant_id: ${e.message}`);
    }
  }

  return Object.assign({ ok:true }, result);
}

// Mark tenant_id NOT NULL — call only after every code path setting that
// column has been verified for the table. Will throw if any row still has
// NULL tenant_id (which is what we want — better to fail boot than silently
// orphan rows). Safe to re-run after the first success.
async function markTenantIdNotNull(tableName) {
  if (!_db.hasDb()) return { ok:false, reason:'no_db' };
  const p = _db.getPool();
  const t = _safeIdent(tableName);
  const nulls = await p.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id IS NULL`);
  if (nulls.rows[0].n > 0) {
    throw new Error(`cannot mark ${t}.tenant_id NOT NULL — ${nulls.rows[0].n} rows still NULL`);
  }
  await p.query(`ALTER TABLE ${t} ALTER COLUMN tenant_id SET NOT NULL`);
  return { ok:true, table:t };
}

// Convenience: run addTenantIdColumn for a batch of plain table names with
// no extra options. Returns an array of per-table results, never throws on a
// single failure — collects errors so the rest still run.
async function batchAddTenantId(tableNames) {
  const out = [];
  for (const name of tableNames) {
    try {
      out.push(await addTenantIdColumn(name));
    } catch (e) {
      out.push({ ok:false, table:name, error:e.message });
    }
  }
  return out;
}

module.exports = {
  addTenantIdColumn,
  batchAddTenantId,
  markTenantIdNotNull,
  enforceTenantIdNotNull,
};
