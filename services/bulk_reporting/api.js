// T35.1 — Bulk Reporting
//
// Upload a CSV of URLs → InfoGenie batch-runs each URL through the SEO
// On-Page Auditor (T22) → user can download a zipped folder of branded PDFs
// (white-labelled via T28 brand profile) plus a flat CSV of every check.
//
// Reuses: services/seo_auditor.runAudit (T22), services/exports/pdf_report.streamPdf
// (T28-aware), services/white_label.getBrand (T28). Persists in
// bulk_audit_runs / bulk_audit_items so progress is resumable across restarts
// and the user can come back hours later to download.
//
// Concurrency cap = 4 in-process. Hard cap of 500 URLs per run protects the
// LLM/credit budget. CSV parser is tolerant of headers + quoted cells.

const express = require('express');
const multer = require('multer');
const { PassThrough } = require('stream');
const archiver = require('archiver');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { runAudit } = require('../seo_auditor/api');
const { streamPdf } = require('../exports/pdf_report');

const router = express.Router();
const _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const MAX_URLS = 500;
const CONCURRENCY = 4;
const _activeRuns = new Set();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

function _normUrl(s) {
  let u = String(s || '').trim().replace(/^["']|["']$/g, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const p = new URL(u); return p.toString(); } catch { return null; }
}

// Tolerant CSV row splitter (handles quoted cells with commas).
function _splitCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function _parseCsv(buf) {
  const text = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/^\ufeff/, '');
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const cells0 = _splitCsvLine(lines[0]);
  // Detect header: if any cell on row 1 looks URL-ish, treat as data; otherwise skip row 1.
  const looksUrl = c => /^https?:\/\//i.test((c || '').trim()) || /\./.test((c || '').trim());
  const startIdx = cells0.some(looksUrl) ? 0 : 1;
  // Pick the first column that contains a URL on the first data row.
  const firstData = lines[startIdx] ? _splitCsvLine(lines[startIdx]) : [];
  let urlCol = firstData.findIndex(looksUrl);
  if (urlCol < 0) urlCol = 0;
  const out = [];
  for (let i = startIdx; i < lines.length && out.length < MAX_URLS; i++) {
    const cells = _splitCsvLine(lines[i]);
    const u = _normUrl(cells[urlCol]);
    if (u) out.push(u);
  }
  // Dedupe keeping order.
  return Array.from(new Set(out));
}

async function _loadBrand() {
  try {
    const wl = require('../white_label/api');
    if (wl && typeof wl.getBrand === 'function') {
      const b = await wl.getBrand();
      return (b && b.enabled) ? b : null;
    }
  } catch {}
  return null;
}

// Render a single audit result to a PDF Buffer using existing streamPdf.
// streamPdf calls res.setHeader / res.pipe — we shim a PassThrough so we can
// collect the bytes without going to the wire.
function _renderPdfBuffer(report, brand) {
  return new Promise((resolve, reject) => {
    const sink = new PassThrough();
    sink.setHeader = () => {};
    const chunks = [];
    sink.on('data', c => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    try { streamPdf(report, sink, 'audit.pdf', brand); } catch (e) { reject(e); }
  });
}

function _auditToReport(item) {
  const r = item.report_json || {};
  const rows = (r.checks || []).map(c => [c.id, c.label, c.status, String(c.weight || 0), String(c.earned || 0), c.message || '', c.fix || '']);
  return {
    title: `SEO Audit — ${item.url}`,
    generated_at: item.processed_at || new Date().toISOString(),
    sections: [
      { title: 'Summary', kind: 'text', body:
        `URL: ${item.url}\nScore: ${item.score ?? '—'} (${item.grade || '—'})\nPassed: ${item.passed ?? 0} · Warned: ${item.warned ?? 0} · Failed: ${item.failed ?? 0}` },
      { title: 'Checks', kind: 'table', headers: ['ID','Check','Status','Weight','Earned','Detail','Recommended Fix'], rows },
    ],
  };
}

// ── Worker ───────────────────────────────────────────────────────────────────
async function _processRun(runId, opts = {}) {
  if (_activeRuns.has(runId)) return;
  _activeRuns.add(runId);
  try {
    const pool = _db.getPool();
    const headless = !!opts.headless;
    while (true) {
      // Atomically claim a batch of pending rows: SELECT FOR UPDATE SKIP LOCKED
      // inside a single UPDATE…RETURNING so concurrent workers (or a duplicate
      // resume on boot) can never grab the same item twice.
      const claim = await pool.query(
        `UPDATE bulk_audit_items SET status='processing', processed_at=now()
           WHERE id IN (
             SELECT id FROM bulk_audit_items
              WHERE run_id=$1 AND status='pending'
              ORDER BY id LIMIT $2
              FOR UPDATE SKIP LOCKED
           )
         RETURNING id, url`,
        [runId, CONCURRENCY],
      );
      if (!claim.rows.length) break;
      await Promise.all(claim.rows.map(async row => {
        try {
          const out = await runAudit(row.url, { headless });
          if (out && out.ok) {
            await pool.query(
              `UPDATE bulk_audit_items
                 SET status='done', score=$2, grade=$3, passed=$4, warned=$5, failed=$6,
                     report_json=$7, processed_at=now()
               WHERE id=$1`,
              [row.id, out.score, out.grade, out.summary?.passed || 0, out.summary?.warned || 0, out.summary?.failed || 0, JSON.stringify(out)],
            );
          } else {
            await pool.query(
              `UPDATE bulk_audit_items SET status='failed', error=$2, processed_at=now() WHERE id=$1`,
              [row.id, (out && out.error) || 'unknown error'],
            );
          }
        } catch (e) {
          await pool.query(
            `UPDATE bulk_audit_items SET status='failed', error=$2, processed_at=now() WHERE id=$1`,
            [row.id, e.message || 'error'],
          ).catch(() => {});
        }
      }));
    }
    // Recompute counters from the items table so they always match reality
    // (no drift if a process was killed mid-row).
    await pool.query(
      `UPDATE bulk_audit_runs SET
         completed = (SELECT COUNT(*) FROM bulk_audit_items WHERE run_id=$1 AND status='done'),
         failed    = (SELECT COUNT(*) FROM bulk_audit_items WHERE run_id=$1 AND status='failed'),
         status='done', finished_at=now()
       WHERE id=$1`,
      [runId],
    );
  } catch (e) {
    console.warn('[bulk-reports] run', runId, 'failed:', e.message);
    try { await _db.getPool().query(`UPDATE bulk_audit_runs SET status='failed', finished_at=now() WHERE id=$1`, [runId]); } catch {}
  } finally {
    _activeRuns.delete(runId);
  }
}

// On boot, resume any run that was mid-flight when the process died.
async function resumePendingRuns() {
  if (!_db.hasDb()) return;
  try {
    const pool = _db.getPool();
    // Reset orphaned 'processing' rows back to 'pending' so claim picks them up.
    await pool.query(
      `UPDATE bulk_audit_items SET status='pending'
         WHERE status='processing' AND run_id IN (SELECT id FROM bulk_audit_runs WHERE status='running')`,
    );
    const r = await pool.query(`SELECT id, settings FROM bulk_audit_runs WHERE status='running'`);
    for (const row of r.rows) {
      const opts = (row.settings && row.settings.opts) || {};
      setImmediate(() => _processRun(Number(row.id), opts));
    }
    if (r.rows.length) console.log(`[bulk-reports] resumed ${r.rows.length} in-flight run(s)`);
  } catch (e) { console.warn('[bulk-reports] resume failed:', e.message); }
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.post('/run', _upload.single('file'), async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  let urls = [];
  if (req.file && req.file.buffer) urls = _parseCsv(req.file.buffer);
  else if (Array.isArray(req.body?.urls)) urls = req.body.urls.map(_normUrl).filter(Boolean).slice(0, MAX_URLS);
  if (!urls.length) return _err(res, 400, 'No valid URLs found in upload');
  const name = String(req.body?.name || `Bulk audit ${new Date().toISOString().slice(0, 10)}`).slice(0, 120);
  const headless = String(req.body?.headless || '') === '1' || req.body?.headless === true;
  const pool = _db.getPool();
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk_reporting:run' });
  const ins = await pool.query(
    `INSERT INTO bulk_audit_runs (tenant_id, name, total, settings) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tid, name, urls.length, JSON.stringify({ opts: { headless } })],
  );
  const runId = Number(ins.rows[0].id);
  const values = urls.map((_, i) => `($1, $2, $${i + 3})`).join(',');
  await pool.query(
    `INSERT INTO bulk_audit_items (tenant_id, run_id, url) VALUES ${values}`,
    [tid, runId, ...urls],
  );
  setImmediate(() => _processRun(runId, { headless }));
  res.json({ ok: true, runId, total: urls.length, name });
});

router.get('/', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk_reporting:list' });
  const r = await _db.getPool().query(
    `SELECT id, name, status, total, completed, failed, created_at, finished_at
       FROM bulk_audit_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 50`,
    [tid],
  );
  res.json({ ok: true, runs: r.rows });
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk_reporting:get' });
  const pool = _db.getPool();
  const r = await pool.query(`SELECT * FROM bulk_audit_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  if (!r.rows.length) return _err(res, 404, 'not found');
  const items = await pool.query(
    `SELECT id, url, status, score, grade, passed, warned, failed, error, processed_at
       FROM bulk_audit_items WHERE run_id=$1 AND tenant_id=$2 ORDER BY id LIMIT 1000`,
    [id, tid],
  );
  res.json({ ok: true, run: r.rows[0], items: items.rows });
});

router.delete('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk_reporting:delete' });
  await _db.getPool().query(`DELETE FROM bulk_audit_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  res.json({ ok: true });
});

router.get('/:id/csv', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = parseInt(req.params.id, 10);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk_reporting:csv' });
  const pool = _db.getPool();
  const r = await pool.query(
    `SELECT url, status, score, grade, passed, warned, failed, error, processed_at, report_json
       FROM bulk_audit_items WHERE run_id=$1 AND tenant_id=$2 ORDER BY id`,
    [id, tid],
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-audit-${id}.csv"`);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  res.write('url,check_id,check_label,status,weight,earned,score,grade,detail,fix\n');
  for (const row of r.rows) {
    const checks = (row.report_json && row.report_json.checks) || [];
    if (!checks.length) {
      res.write([esc(row.url), '', '', esc(row.status), '', '', esc(row.score), esc(row.grade), esc(row.error || ''), ''].join(',') + '\n');
      continue;
    }
    for (const c of checks) {
      res.write([esc(row.url), esc(c.id), esc(c.label), esc(c.status), esc(c.weight), esc(c.earned), esc(row.score), esc(row.grade), esc(c.message || ''), esc(c.fix || '')].join(',') + '\n');
    }
  }
  res.end();
});

router.get('/:id/zip', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = parseInt(req.params.id, 10);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk_reporting:zip' });
  const pool = _db.getPool();
  const run = await pool.query(`SELECT name FROM bulk_audit_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  if (!run.rows.length) return _err(res, 404, 'not found');
  const items = await pool.query(
    `SELECT url, score, grade, passed, warned, failed, processed_at, report_json
       FROM bulk_audit_items WHERE run_id=$1 AND tenant_id=$2 AND status='done' AND report_json IS NOT NULL ORDER BY id`,
    [id, tid],
  );
  if (!items.rows.length) return _err(res, 409, 'no completed items yet');
  const brand = await _loadBrand();
  const slug = (run.rows[0].name || 'bulk').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bulk';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-${id}.zip"`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('error', e => { try { res.end(); } catch {} ; console.warn('[bulk-reports] zip error:', e.message); });
  zip.pipe(res);
  let n = 0;
  for (const it of items.rows) {
    try {
      const buf = await _renderPdfBuffer(_auditToReport(it), brand);
      const safe = String(it.url || `audit-${++n}`).replace(/^https?:\/\//i, '').replace(/[^a-z0-9.-]+/gi, '_').slice(0, 80);
      zip.append(buf, { name: `${String(++n).padStart(3, '0')}-${safe}.pdf` });
    } catch (e) {
      console.warn('[bulk-reports] pdf render failed for', it.url, e.message);
    }
  }
  zip.finalize();
});

module.exports = router;
module.exports.resumePendingRuns = resumePendingRuns;
