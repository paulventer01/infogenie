const express = require('express');
const router = express.Router();
const _db = require('../../db');
const { runAudit } = require('../seo_auditor/api');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[seo-tasks]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label, allowFallback: true });
}
const VALID_STATUS = new Set(['open', 'in_progress', 'done', 'snoozed', 'wont_fix']);
function _priorityFor(check) {
  // fail = high (1), warn = medium (2). Heavy weights bump priority.
  if (check.status === 'fail') return check.weight >= 6 ? 1 : 2;
  if (check.status === 'warn') return check.weight >= 6 ? 2 : 3;
  return 3;
}

router.get('/test', (req, res) => res.json({ ok: true, db: _db.hasDb && _db.hasDb() }));

// Import every warn/fail check from a SEO audit run as open tasks.
// The audit run is looked up scoped by caller's tenant — a guessed id from
// another tenant returns 404 (not "found but mis-stamped").
router.post('/import-from-audit', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const auditRunId = parseInt(req.body?.auditRunId, 10);
  if (!auditRunId) return _err(res, 400, 'auditRunId required');
  const tid = await _tid(req, 'seo-tasks:import');
  const r = await _db.getPool().query(
    `SELECT id, url, checks FROM seo_audit_runs WHERE id=$1 AND tenant_id=$2`,
    [auditRunId, tid]
  );
  if (!r.rowCount) return _err(res, 404, 'Audit run not found.');
  const { url, checks } = r.rows[0];
  const issues = (checks || []).filter(c => c.status === 'warn' || c.status === 'fail');

  // Race-safe: rely on the tenant-scoped partial unique index
  // `uniq_seo_tasks_active_tenant` and let ON CONFLICT DO NOTHING absorb
  // concurrent imports / re-audits — `RETURNING id` is empty when a duplicate
  // active task already exists.
  let created = 0, skipped = 0;
  for (const c of issues) {
    const r2 = await _db.getPool().query(
      `INSERT INTO seo_tasks (tenant_id, source, source_url, check_id, label, message, fix, priority, audit_run_id)
       VALUES ($1,'seo_audit',$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, source_url, check_id) WHERE status NOT IN ('done','wont_fix') DO NOTHING
       RETURNING id`,
      [tid, url, c.id, c.label, c.message, c.fix, _priorityFor(c), auditRunId]
    );
    if (r2.rowCount) created++; else skipped++;
  }
  res.json({ ok: true, created, skipped, total: issues.length });
}));

// List tasks with filters + pagination, hard-scoped to caller's tenant.
router.get('/list', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, tasks: [] });
  const tid = await _tid(req, 'seo-tasks:list');
  const status = String(req.query.status || '').trim();
  const priority = parseInt(req.query.priority, 10);
  const url = String(req.query.url || '').trim();
  const where = ['tenant_id=$1'];
  const args = [tid];
  if (status && VALID_STATUS.has(status)) { args.push(status); where.push(`status=$${args.length}`); }
  if (priority >= 1 && priority <= 3) { args.push(priority); where.push(`priority=$${args.length}`); }
  if (url) { args.push('%' + url + '%'); where.push(`source_url ILIKE $${args.length}`); }
  const sql = `SELECT id, source, source_url, check_id, label, message, fix, priority, status, assignee,
                      due_date, snoozed_until, notes, audit_run_id, created_at, updated_at, closed_at
                 FROM seo_tasks
                WHERE ${where.join(' AND ')}
                ORDER BY (status='done')::int, priority, created_at DESC LIMIT 500`;
  const r = await _db.getPool().query(sql, args);
  res.json({ ok: true, tasks: r.rows });
}));

router.get('/stats', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, stats: {} });
  const tid = await _tid(req, 'seo-tasks:stats');
  const r = await _db.getPool().query(
    `SELECT status, COUNT(*)::int AS n FROM seo_tasks WHERE tenant_id=$1 GROUP BY status`, [tid]);
  const stats = { open: 0, in_progress: 0, done: 0, snoozed: 0, wont_fix: 0 };
  r.rows.forEach(row => { stats[row.status] = row.n; });
  stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
  res.json({ ok: true, stats });
}));

router.patch('/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const tid = await _tid(req, 'seo-tasks:patch');
  const fields = [], args = [];
  const set = (col, val) => { args.push(val); fields.push(`${col}=$${args.length}`); };
  if (req.body.status !== undefined) {
    if (!VALID_STATUS.has(req.body.status)) return _err(res, 400, 'invalid status');
    set('status', req.body.status);
    if (req.body.status === 'done' || req.body.status === 'wont_fix') set('closed_at', new Date());
    else set('closed_at', null);
  }
  if (req.body.priority !== undefined) {
    const p = parseInt(req.body.priority, 10);
    if (![1, 2, 3].includes(p)) return _err(res, 400, 'priority must be 1/2/3');
    set('priority', p);
  }
  if (req.body.assignee !== undefined) set('assignee', String(req.body.assignee || '').slice(0, 120) || null);
  if (req.body.dueDate !== undefined) set('due_date', req.body.dueDate || null);
  if (req.body.snoozedUntil !== undefined) set('snoozed_until', req.body.snoozedUntil || null);
  if (req.body.notes !== undefined) set('notes', String(req.body.notes || '').slice(0, 2000) || null);
  if (!fields.length) return _err(res, 400, 'no fields to update');
  set('updated_at', new Date());
  args.push(id);
  args.push(tid);
  const sql = `UPDATE seo_tasks SET ${fields.join(', ')} WHERE id=$${args.length - 1} AND tenant_id=$${args.length} RETURNING *`;
  const r = await _db.getPool().query(sql, args);
  if (!r.rowCount) return _err(res, 404, 'task not found');
  res.json({ ok: true, task: r.rows[0] });
}));

router.delete('/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const tid = await _tid(req, 'seo-tasks:delete');
  await _db.getPool().query(
    `DELETE FROM seo_tasks WHERE id=$1 AND tenant_id=$2`,
    [parseInt(req.params.id, 10), tid]);
  res.json({ ok: true });
}));

// Re-audit one URL and auto-close any open tasks (for this tenant) whose check
// now passes. The new audit run is stamped with caller's tenant, and any newly
// failing checks are imported into the caller's tenant's task list.
router.post('/reaudit', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const url = String(req.body?.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const tid = await _tid(req, 'seo-tasks:reaudit');
  const audit = await runAudit(url);
  if (!audit.ok) return _err(res, 502, audit.error);

  const passingChecks = audit.checks.filter(c => c.status === 'pass').map(c => c.id);
  let autoClosed = 0;
  if (passingChecks.length) {
    const r = await _db.getPool().query(
      `UPDATE seo_tasks
          SET status='done', closed_at=now(), updated_at=now(),
              notes = COALESCE(notes, '') || E'\n[auto-closed: re-audit ' || to_char(now(),'YYYY-MM-DD HH24:MI') || ' shows this check now passes]'
        WHERE source_url=$1 AND check_id = ANY($2::text[]) AND status NOT IN ('done','wont_fix') AND tenant_id=$3
        RETURNING id`,
      [audit.url, passingChecks, tid]
    );
    autoClosed = r.rowCount;
  }

  // Persist the new audit (stamped to caller's tenant) and import any
  // newly-failing checks.
  let newAuditId = null;
  try {
    const r2 = await _db.getPool().query(
      `INSERT INTO seo_audit_runs (tenant_id, url, score, grade, checks, summary) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, audit.url, audit.score, audit.grade, JSON.stringify(audit.checks), JSON.stringify(audit.summary)]
    );
    newAuditId = r2.rows[0].id;
  } catch (_) {}

  // Race-safe insert via the tenant-scoped partial unique index — see
  // /import-from-audit comment.
  let imported = 0;
  for (const c of audit.checks.filter(c => c.status === 'warn' || c.status === 'fail')) {
    const r3 = await _db.getPool().query(
      `INSERT INTO seo_tasks (tenant_id, source, source_url, check_id, label, message, fix, priority, audit_run_id)
       VALUES ($1,'seo_audit',$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, source_url, check_id) WHERE status NOT IN ('done','wont_fix') DO NOTHING
       RETURNING id`,
      [tid, audit.url, c.id, c.label, c.message, c.fix, _priorityFor(c), newAuditId]
    );
    if (r3.rowCount) imported++;
  }
  res.json({ ok: true, score: audit.score, grade: audit.grade, autoClosed, imported, newAuditId });
}));

module.exports = router;
