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

const _db = require('../../db');

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
 */
async function addTenantIdColumn(tableName, options = {}) {
  if (!_db.hasDb()) return { ok:false, reason:'no_db' };
  const p = _db.getPool();
  const t = _safeIdent(tableName);

  if (!(await _tableExists(p, t))) {
    return { ok:false, reason:'table_missing', table:t };
  }

  const result = { table:t, added:false, backfilled:0, indexed:false, droppedCheck:false, uniqueAdded:false };

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
};
