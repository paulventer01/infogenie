// services/tenants/preflight.js — read-only tenant-schema closeout preflight
//
// Enumerates rows that still need an explicit operator decision before
// fail-closed closeout DDL (SET NOT NULL, CHECK, UNIQUE). Never writes.
// Never maps rows onto tenant 1 / the default tenant.
//
// Operator command (also printed on stdout):
//   DATABASE_URL=postgres://… node scripts/tenant-schema-preflight.js
//
// SELECT only. The runner opens BEGIN READ ONLY and always ROLLBACK.

'use strict';

const _db = require('../../db');

const ID_CAP = 500;

// Tenant-owned closeout set: the 26 previously-nullable tables plus children
// compliance_checklist_items, post_launch_checks, backlink_monitors/snapshots/changes.
const CLOSEOUT_TABLES = [
  'ai_call_traces', 'ai_providers', 'ai_visibility_runs', 'anomaly_detections',
  'ave_reports', 'brand_calendar_items', 'brand_foundation', 'budgets',
  'geo_citation_checks', 'geo_insight_runs', 'hashtag_scans', 'hashtag_watches',
  'influence_scores', 'intent_radar_runs', 'presence_scores', 'project_comparisons',
  'reputation_scores', 'seo_tasks', 'signal_events', 'signal_triggers',
  'spend_events', 'ugc_items', 'weekly_report_runs', 'weekly_report_subs',
  'yt_channels', 'yt_snapshots',
  'compliance_checklist_items', 'post_launch_checks',
  'backlink_monitors', 'backlink_snapshots', 'backlink_changes',
];

// Deterministic parent JOIN already used by enforceTenantIdNotNull(backfillFrom).
// Rows that WOULD inherit a non-null parent.tenant_id are mapped and must not
// be reported as requiring operator action.
const PARENT_BACKFILL = {
  geo_citation_checks: {
    parentTable: 'geo_audit_runs', parentIdColumn: 'id', childFkColumn: 'run_id',
  },
  hashtag_scans: {
    parentTable: 'hashtag_watches', parentIdColumn: 'id', childFkColumn: 'watch_id',
  },
  yt_snapshots: {
    parentTable: 'yt_channels', parentIdColumn: 'id', childFkColumn: 'channel_id',
  },
  compliance_checklist_items: {
    parentTable: 'campaign_compliance_checklists', parentIdColumn: 'id', childFkColumn: 'checklist_id',
  },
  post_launch_checks: {
    parentTable: 'post_launch_audits', parentIdColumn: 'id', childFkColumn: 'audit_id',
  },
  backlink_snapshots: {
    parentTable: 'backlink_monitors', parentIdColumn: 'id', childFkColumn: 'monitor_id',
  },
  backlink_changes: {
    parentTable: 'backlink_monitors', parentIdColumn: 'id', childFkColumn: 'monitor_id',
  },
};

const JOB_QUEUE_EMPTY_PAYLOAD_CHECK = 'job_queue_global_empty_payload';
const JOB_QUEUE_EMPTY_PAYLOAD_SQL = `payload = '{}'::jsonb`;

const PLAYBOOKS_XOR_CHECK = 'vertical_playbooks_system_xor_tenant';
const PLAYBOOKS_XOR_SQL =
  `(is_system IS TRUE AND tenant_id IS NULL) OR (is_system IS FALSE AND tenant_id IS NOT NULL)`;

function _safeIdent(name) {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`unsafe SQL identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

async function _tableExists(client, name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1 LIMIT 1`, [name]);
  return r.rowCount > 0;
}

async function _columnExists(client, table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, column]);
  return r.rowCount > 0;
}

async function _constraintExists(client, table, constraint) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema='public' AND table_name=$1 AND constraint_name=$2 LIMIT 1`,
    [table, constraint]);
  return r.rowCount > 0;
}

async function _idColumn(client, table) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
        AND column_name IN ('id', 'name')
      ORDER BY CASE column_name WHEN 'id' THEN 0 ELSE 1 END
      LIMIT 1`,
    [table]);
  return r.rows[0] ? r.rows[0].column_name : null;
}

function _capIds(ids) {
  if (ids.length <= ID_CAP) return { ids, truncated: false };
  return { ids: ids.slice(0, ID_CAP), truncated: true };
}

function _finding(table, reason, ids, extra = {}) {
  const capped = _capIds(ids);
  const out = {
    table,
    count: extra.count != null ? extra.count : ids.length,
    reason,
    ids: capped.ids,
  };
  // Callers often pass already-sliced ids (LIMIT ID_CAP). Honor extra.truncated
  // from preflightUnmappedForTable so the operator report still shows the flag.
  if (capped.truncated || extra.truncated) out.truncated = true;
  if (extra.columnMissing) out.columnMissing = true;
  return out;
}

/**
 * Unmapped tenant-owned rows on one table.
 * A row is unmapped when tenant_id IS NULL (or the column is missing — every
 * existing row) AND it would NOT be filled by the deterministic parent JOIN.
 * Parent-mappable rows are omitted. Default-tenant / tenant 1 is never a mapping.
 *
 * @param {string} tableName
 * @param {object} [options]
 * @param {{parentTable:string,parentIdColumn:string,childFkColumn:string}|null} [options.backfillFrom]
 * @param {import('pg').PoolClient} [options.client]
 * @returns {Promise<{ok:boolean, table:string, count:number, ids:object[], columnMissing?:boolean, reason?:string}>}
 */
async function preflightUnmappedForTable(tableName, options = {}) {
  const t = _safeIdent(tableName);
  const ownClient = !options.client;
  const p = options.client || (_db.hasDb() ? _db.getPool() : null);
  if (!p) return { ok: false, reason: 'no_db', table: t, count: 0, ids: [] };

  let client = options.client;
  let startedTx = false;
  try {
    if (ownClient) {
      client = await p.connect();
      await client.query('BEGIN READ ONLY');
      startedTx = true;
    }

    if (!(await _tableExists(client, t))) {
      return { ok: true, table: t, count: 0, ids: [], skipped: true, reason: 'table_missing' };
    }

    const backfillFrom = options.backfillFrom || PARENT_BACKFILL[t] || null;
    const hasTid = await _columnExists(client, t, 'tenant_id');
    const idCol = await _idColumn(client, t);
    const idExpr = idCol ? `child.${_safeIdent(idCol)}` : 'child.ctid::text';
    const idAlias = idCol || 'id';

    let sql;
    const params = [];

    if (backfillFrom) {
      const parent = _safeIdent(backfillFrom.parentTable);
      const parentId = _safeIdent(backfillFrom.parentIdColumn);
      const childFk = _safeIdent(backfillFrom.childFkColumn);
      const parentExists = await _tableExists(client, parent);
      const parentHasTid = parentExists && await _columnExists(client, parent, 'tenant_id');
      const childHasFk = await _columnExists(client, t, childFk);

      if (parentExists && parentHasTid && childHasFk) {
        const childNullPred = hasTid ? 'child.tenant_id IS NULL' : 'TRUE';
        sql = `
          SELECT ${idExpr} AS id, child.${childFk} AS parent_id
            FROM ${t} AS child
            LEFT JOIN ${parent} AS parent
              ON child.${childFk} = parent.${parentId}
             AND parent.tenant_id IS NOT NULL
           WHERE ${childNullPred}
             AND parent.${parentId} IS NULL
           ORDER BY ${idExpr}
           LIMIT ${ID_CAP + 1}`;
      } else {
        // Parent missing / no parent.tenant_id / no FK: nothing is JOIN-mappable.
        sql = hasTid
          ? `SELECT ${idExpr} AS id FROM ${t} AS child WHERE child.tenant_id IS NULL ORDER BY ${idExpr} LIMIT ${ID_CAP + 1}`
          : `SELECT ${idExpr} AS id FROM ${t} AS child ORDER BY ${idExpr} LIMIT ${ID_CAP + 1}`;
      }
    } else if (hasTid) {
      sql = `SELECT ${idExpr} AS id FROM ${t} AS child WHERE child.tenant_id IS NULL ORDER BY ${idExpr} LIMIT ${ID_CAP + 1}`;
    } else {
      sql = `SELECT ${idExpr} AS id FROM ${t} AS child ORDER BY ${idExpr} LIMIT ${ID_CAP + 1}`;
    }

    const r = await client.query(sql, params);
    const truncated = r.rows.length > ID_CAP;
    const rows = truncated ? r.rows.slice(0, ID_CAP) : r.rows;
    const ids = rows.map((row) => {
      const item = { id: row.id };
      if (Object.prototype.hasOwnProperty.call(row, 'parent_id')) item.parent_id = row.parent_id;
      if (idAlias !== 'id' && idCol) item[idCol] = row.id;
      return item;
    });

    let count = ids.length;
    if (truncated) {
      if (hasTid) {
        const c = await client.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id IS NULL`);
        count = c.rows[0].n;
      } else {
        const c = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        count = c.rows[0].n;
      }
    }

    return {
      ok: count === 0,
      table: t,
      count,
      ids,
      columnMissing: !hasTid,
      truncated,
      reason: count === 0 ? undefined : 'unmapped_tenant_id',
    };
  } finally {
    if (ownClient && client) {
      if (startedTx) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      }
      client.release();
    }
  }
}

async function _listPlaybookXorViolations(client) {
  const table = 'vertical_playbooks';
  if (!(await _tableExists(client, table))) {
    return [];
  }
  const hasTid = await _columnExists(client, table, 'tenant_id');
  const hasFlag = await _columnExists(client, table, 'is_system');
  const hasVertical = await _columnExists(client, table, 'vertical');
  if (!hasFlag) return [];

  const verticalExpr = hasVertical ? 'vertical' : 'NULL::text AS vertical';
  let sql;
  if (hasTid) {
    sql = `
      SELECT id, is_system, ${verticalExpr}
        FROM vertical_playbooks
       WHERE NOT (
         (is_system IS TRUE AND tenant_id IS NULL)
         OR (is_system IS FALSE AND tenant_id IS NOT NULL)
       )
       ORDER BY id
       LIMIT ${ID_CAP + 1}`;
  } else {
    // No tenant_id column: catalog (is_system TRUE) is the valid implied shape.
    // Custom / null flag rows would not be filled by any JOIN — report them.
    sql = `
      SELECT id, is_system, ${verticalExpr}
        FROM vertical_playbooks
       WHERE is_system IS NOT TRUE
       ORDER BY id
       LIMIT ${ID_CAP + 1}`;
  }
  const r = await client.query(sql);
  const truncated = r.rows.length > ID_CAP;
  const rows = truncated ? r.rows.slice(0, ID_CAP) : r.rows;
  return rows.map((row) => {
    let reason = 'playbook_xor';
    if (row.is_system === true) reason = 'playbook_system_with_tenant';
    else if (row.is_system === false) reason = 'playbook_custom_unmapped';
    else reason = 'playbook_is_system_null';
    return {
      id: row.id,
      is_system: row.is_system,
      vertical: row.vertical,
      reason,
    };
  });
}

async function _listJobQueuePayloadViolations(client) {
  if (!(await _tableExists(client, 'job_queue'))) return [];
  if (!(await _columnExists(client, 'job_queue', 'payload'))) return [];
  const r = await client.query(`
    SELECT id, name, status
      FROM job_queue
     WHERE payload IS DISTINCT FROM '{}'::jsonb
     ORDER BY id
     LIMIT ${ID_CAP + 1}
  `);
  const truncated = r.rows.length > ID_CAP;
  const rows = truncated ? r.rows.slice(0, ID_CAP) : r.rows;
  let extraCount = rows.length;
  if (truncated) {
    const c = await client.query(
      `SELECT COUNT(*)::int AS n FROM job_queue WHERE payload IS DISTINCT FROM '{}'::jsonb`);
    extraCount = c.rows[0].n;
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    _count: extraCount,
  }));
}

/**
 * Full closeout preflight. Read-only. Never considers default-tenant mapping.
 *
 * @param {object} [options]
 * @param {string[]} [options.tables] restrict to these table names
 * @param {import('pg').PoolClient} [options.client]
 * @returns {Promise<{ok:boolean, tables:object[], reason?:string}>}
 */
async function preflightTenantSchemaCloseout(options = {}) {
  if (!_db.hasDb()) {
    return { ok: false, reason: 'no_db', tables: [] };
  }
  const only = options.tables ? new Set(options.tables) : null;
  const ownClient = !options.client;
  const pool = _db.getPool();
  let client = options.client;
  let startedTx = false;
  const findings = [];

  try {
    if (!client) client = await pool.connect();
    if (ownClient) {
      await client.query('BEGIN READ ONLY');
      startedTx = true;
    }

    for (const table of CLOSEOUT_TABLES) {
      if (only && !only.has(table)) continue;
      const u = await preflightUnmappedForTable(table, {
        client,
        backfillFrom: PARENT_BACKFILL[table] || null,
      });
      if (u.skipped) continue;
      if (u.count > 0) {
        findings.push(_finding(table, 'unmapped_tenant_id', u.ids, {
          count: u.count,
          columnMissing: u.columnMissing,
          truncated: !!u.truncated,
        }));
      }
    }

    if (!only || only.has('vertical_playbooks')) {
      const rows = await _listPlaybookXorViolations(client);
      if (rows.length) {
        const byReason = new Map();
        for (const row of rows) {
          if (!byReason.has(row.reason)) byReason.set(row.reason, []);
          byReason.get(row.reason).push({
            id: row.id,
            is_system: row.is_system,
            vertical: row.vertical,
          });
        }
        for (const [reason, ids] of byReason) {
          findings.push(_finding('vertical_playbooks', reason, ids));
        }
      }
    }

    if (!only || only.has('job_queue')) {
      const rows = await _listJobQueuePayloadViolations(client);
      if (rows.length) {
        const count = rows[0]._count || rows.length;
        const ids = rows.map((row) => ({ id: row.id, name: row.name, status: row.status }));
        findings.push(_finding('job_queue', 'job_queue_payload', ids, {
          count,
          truncated: count > ID_CAP,
        }));
      }
    }

    return { ok: findings.length === 0, tables: findings };
  } catch (e) {
    console.error(`[tenants/preflight] closeout preflight failed: ${e.message}`);
    return { ok: false, reason: 'error', error: e.message, tables: findings };
  } finally {
    if (ownClient && client) {
      if (startedTx) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      }
      client.release();
    }
  }
}

/**
 * Schema modules call this before adding CHECK / UNIQUE / SET NOT NULL.
 * Returns { ok:true } when the named table has no unresolved preflight rows.
 * Does not throw.
 */
async function assertCloseoutPreflightClean(tableName, options = {}) {
  if (!_db.hasDb()) return { ok: false, reason: 'no_db' };
  try {
    const t = _safeIdent(tableName);
    if (t === 'job_queue' || t === 'vertical_playbooks') {
      const report = await preflightTenantSchemaCloseout({ tables: [t] });
      if (!report.ok) {
        return {
          ok: false,
          reason: 'preflight',
          tables: report.tables,
          count: report.tables.reduce((s, x) => s + (x.count || 0), 0),
        };
      }
      return { ok: true };
    }
    const u = await preflightUnmappedForTable(t, {
      backfillFrom: options.backfillFrom || PARENT_BACKFILL[t] || null,
    });
    if (u.count > 0) {
      return {
        ok: false,
        reason: 'preflight',
        table: t,
        count: u.count,
        ids: u.ids,
        columnMissing: u.columnMissing,
      };
    }
    return { ok: true, table: t };
  } catch (e) {
    console.error(`[tenants/preflight] assertCloseoutPreflightClean(${tableName}): ${e.message}`);
    return { ok: false, reason: 'error', error: e.message };
  }
}

async function addCheckConstraintIfClean({ table, name, expression, kind }) {
  if (!_db.hasDb()) return { ok: false, reason: 'no_db' };
  const p = _db.getPool();
  try {
    const t = _safeIdent(table);
    const c = _safeIdent(name);
    if (!(await _tableExists(p, t))) return { ok: false, reason: 'table_missing', table: t };
    if (await _constraintExists(p, t, c)) return { ok: true, existed: true, table: t, constraint: c };

    const clean = await assertCloseoutPreflightClean(t);
    if (!clean.ok) {
      console.error(
        `[tenants/preflight] skip CHECK ${c} on ${t}: unresolved rows ` +
        `(count=${clean.count || 0}, reason=${clean.reason}) — operator must decide; ` +
        `not auto-assigned, not stripped, not deleted`
      );
      return Object.assign({ ok: false, reason: 'preflight', constraint: c }, clean);
    }

    await p.query(`ALTER TABLE ${t} ADD CONSTRAINT ${c} CHECK (${expression})`);
    return { ok: true, added: true, table: t, constraint: c, kind: kind || null };
  } catch (e) {
    console.error(`[tenants/preflight] ADD CONSTRAINT ${name} on ${table}: ${e.message}`);
    return { ok: false, reason: 'error', error: e.message };
  }
}

/** Idempotent job_queue CHECK: platform jobs only; payload must be {}. */
async function ensureJobQueueEmptyPayloadCheck() {
  return addCheckConstraintIfClean({
    table: 'job_queue',
    name: JOB_QUEUE_EMPTY_PAYLOAD_CHECK,
    expression: JOB_QUEUE_EMPTY_PAYLOAD_SQL,
    kind: 'job_queue_payload',
  });
}

/** Idempotent MIXED playbook CHECK: system xor tenant_id. */
async function ensureVerticalPlaybooksXorCheck() {
  return addCheckConstraintIfClean({
    table: 'vertical_playbooks',
    name: PLAYBOOKS_XOR_CHECK,
    expression: PLAYBOOKS_XOR_SQL,
    kind: 'playbook_xor',
  });
}

function formatPreflightReport(report) {
  const lines = [];
  lines.push('InfoGenie tenant-schema closeout preflight (read-only; SELECT only).');
  lines.push('Operator command: DATABASE_URL=postgres://… node scripts/tenant-schema-preflight.js');
  lines.push('npm script:      npm run tenant:preflight');
  lines.push('Never maps rows to tenant 1 / the default tenant. Never INSERT/UPDATE/DELETE/DDL.');
  lines.push('');
  if (report.reason === 'no_db') {
    lines.push('Result: ERROR — DATABASE_URL is not set. Refusing to skip (exit 2).');
  } else if (report.reason === 'error') {
    lines.push('Result: ERROR — ' + (report.error || 'preflight query failed'));
  } else if (report.ok) {
    lines.push('Result: CLEAN — no operator mapping required.');
  } else {
    lines.push('Result: ACTION REQUIRED — unresolved rows; closeout DDL must not start.');
    for (const t of report.tables || []) {
      const bits = (t.ids || []).map((id) => (id && typeof id === 'object' ? JSON.stringify(id) : String(id)));
      const more = t.truncated ? ' (truncated)' : '';
      lines.push(`  ${t.table}: count=${t.count} reason=${t.reason}${t.columnMissing ? ' (tenant_id column missing)' : ''} ids=[${bits.join(', ')}]${more}`);
    }
  }
  lines.push('');
  lines.push('--- JSON ---');
  lines.push(JSON.stringify({
    ok: !!report.ok,
    tables: report.tables || [],
    reason: report.reason || undefined,
  }));
  return lines.join('\n');
}

module.exports = {
  CLOSEOUT_TABLES,
  PARENT_BACKFILL,
  JOB_QUEUE_EMPTY_PAYLOAD_CHECK,
  JOB_QUEUE_EMPTY_PAYLOAD_SQL,
  PLAYBOOKS_XOR_CHECK,
  PLAYBOOKS_XOR_SQL,
  ID_CAP,
  _finding,
  preflightTenantSchemaCloseout,
  preflightUnmappedForTable,
  assertCloseoutPreflightClean,
  addCheckConstraintIfClean,
  ensureJobQueueEmptyPayloadCheck,
  ensureVerticalPlaybooksXorCheck,
  formatPreflightReport,
};
