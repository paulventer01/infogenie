// Tier 29 — Multi-Page SEO Crawler
// BFS crawls a site (same-origin only), runs the T22 19-check audit on every
// discovered page, aggregates into a site-wide score + worst-offender list.
// Hard caps: 100 pages, 5 min wall-clock, 4 concurrent audits.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _https = require('https');
const _http = require('http');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { isUrlSafeToFetch } = require('../_shared/ssrf');
const { runAudit } = require('../seo_auditor/api');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[seo-crawler]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
const HARD_MAX_PAGES = 100;
const HARD_TIMEOUT_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;

function _fetchHtml(rawUrl, redirects = 0) {
  return new Promise(async resolve => {
    if (redirects > 4) return resolve({ ok: false, error: 'Too many redirects' });
    const safe = await isUrlSafeToFetch(rawUrl);
    if (!safe.ok) return resolve({ ok: false, error: safe.error });
    let u; try { u = new URL(rawUrl); } catch { return resolve({ ok: false, error: 'Invalid URL' }); }
    const lib = u.protocol === 'https:' ? _https : _http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'InfoGenie-SEO-Crawler/1.0', 'Accept': 'text/html' }
    }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = new URL(r.headers.location, rawUrl).toString();
        r.resume(); return resolve(_fetchHtml(next, redirects + 1));
      }
      if (r.statusCode >= 400) { r.resume(); return resolve({ ok: false, error: 'HTTP ' + r.statusCode }); }
      const ct = String(r.headers['content-type'] || '');
      if (!/text\/html|application\/xhtml/i.test(ct)) { r.resume(); return resolve({ ok: false, error: 'not html' }); }
      const chunks = []; let total = 0;
      r.on('data', c => { total += c.length; if (total > 2 * 1024 * 1024) { r.destroy(); return resolve({ ok: false, error: 'too large' }); } chunks.push(c); });
      r.on('end', () => resolve({ ok: true, html: Buffer.concat(chunks).toString('utf8'), finalUrl: rawUrl }));
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

function _extractLinks(html, baseUrl) {
  const out = new Set();
  let baseHost; try { baseHost = new URL(baseUrl).host; } catch { return []; }
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null && out.size < 200) {
    let href = m[1].trim();
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    let u; try { u = new URL(abs); } catch { continue; }
    if (u.host !== baseHost) continue;
    if (!/^https?:$/.test(u.protocol)) continue;
    // Strip fragment + dedupe
    const clean = u.origin + u.pathname + (u.search || '');
    // Skip obvious binary/asset paths
    if (/\.(png|jpe?g|gif|svg|webp|css|js|pdf|zip|mp4|mp3|woff2?|ico|xml|json)(\?|$)/i.test(u.pathname)) continue;
    out.add(clean);
  }
  return Array.from(out);
}

const _runs = new Map(); // id → in-memory state for active runs

async function _executeCrawl(runId, rootUrl, maxPages, tenantId) {
  const start = Date.now();
  const visited = new Set();
  const queue = [rootUrl];
  const results = [];
  let aborted = false;
  const state = _runs.get(runId);

  async function worker() {
    while (queue.length && results.length < maxPages && !aborted) {
      if (Date.now() - start > HARD_TIMEOUT_MS) { aborted = true; break; }
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);
      // Audit (re-fetches HTML internally for full check coverage)
      const audit = await runAudit(url).catch(e => ({ ok: false, error: e.message }));
      if (audit && audit.ok) {
        results.push({ url, score: audit.score, grade: audit.grade, summary: audit.summary, checks: audit.checks });
        if (state) state.progress = results.length;
        // Persist incrementally so the user sees pages stream in
        if (_db.hasDb && _db.hasDb()) {
          try {
            await _db.getPool().query(
              `INSERT INTO seo_crawl_pages (tenant_id, run_id, url, score, grade, summary, checks) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [tenantId, runId, url, audit.score, audit.grade, JSON.stringify(audit.summary || {}), JSON.stringify(audit.checks || [])]
            );
          } catch (e) { console.warn('[seo-crawler] insert page failed', e.message); }
        }
        // Discover new internal links from this page (only if we still need pages)
        if (results.length < maxPages) {
          const fetched = await _fetchHtml(url);
          if (fetched.ok) {
            const links = _extractLinks(fetched.html, url);
            for (const l of links) {
              if (!visited.has(l) && !queue.includes(l) && (results.length + queue.length) < maxPages * 3) queue.push(l);
            }
          }
        }
      } else if (state) { state.errors = (state.errors || 0) + 1; }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const avg = results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 0;
  const grade = avg >= 90 ? 'A' : avg >= 80 ? 'B' : avg >= 70 ? 'C' : avg >= 60 ? 'D' : 'F';
  const status = aborted ? 'partial' : 'completed';
  if (_db.hasDb && _db.hasDb()) {
    try {
      await _db.getPool().query(
        `UPDATE seo_crawl_runs SET page_count=$2, avg_score=$3, site_grade=$4, status=$5, completed_at=now() WHERE id=$1`,
        [runId, results.length, Number(avg.toFixed(1)), grade, status]
      );
    } catch (e) { console.warn('[seo-crawler] finalise failed', e.message); }
  }
  if (state) { state.status = status; state.avg = avg; state.grade = grade; state.completed = true; }
}

router.post('/run', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const url = String((req.body && req.body.url) || '').trim();
  let maxPages = parseInt((req.body && req.body.maxPages) || 25, 10);
  if (!url) return _err(res, 400, 'url required');
  maxPages = Math.max(1, Math.min(HARD_MAX_PAGES, maxPages));
  const safe = await isUrlSafeToFetch(url);
  if (!safe.ok) return _err(res, 400, safe.error);
  const id = 'crawl_' + crypto.randomBytes(6).toString('hex');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-crawler:run' });
  await _db.getPool().query(
    `INSERT INTO seo_crawl_runs (tenant_id, id, root_url, max_pages, status) VALUES ($1, $2, $3, $4, 'running')`,
    [tid, id, url, maxPages]
  );
  _runs.set(id, { id, rootUrl: url, maxPages, progress: 0, errors: 0, status: 'running', completed: false });
  // Fire and forget
  _executeCrawl(id, url, maxPages, tid).catch(e => {
    console.warn('[seo-crawler] crawl failed', e.message);
    _db.getPool().query(`UPDATE seo_crawl_runs SET status='failed', error=$2, completed_at=now() WHERE id=$1`, [id, e.message]).catch(()=>{});
  });
  res.json({ ok: true, id, maxPages });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-crawler:runs' });
  const r = await _db.getPool().query(
    `SELECT id, root_url, max_pages, page_count, avg_score, site_grade, status, started_at, completed_at FROM seo_crawl_runs WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 40`,
    [tid]
  );
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const id = req.params.id;
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-crawler:run-get' });
  const meta = await _db.getPool().query(`SELECT * FROM seo_crawl_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  if (!meta.rowCount) return _err(res, 404, 'Run not found');
  const pages = await _db.getPool().query(
    `SELECT url, score, grade, summary, checks FROM seo_crawl_pages WHERE run_id=$1 AND tenant_id=$2 ORDER BY score ASC, url ASC`, [id, tid]
  );
  const live = _runs.get(id);
  const aggregate = _aggregateInsights(pages.rows);
  // Strip heavy `checks` from page rows we ship to the frontend (kept only for aggregation).
  const slimPages = pages.rows.map(({ checks, ...rest }) => rest);
  res.json({
    ok: true,
    run: meta.rows[0],
    pages: slimPages,
    aggregate,
    live: live ? { progress: live.progress, errors: live.errors || 0, status: live.status } : null
  });
}));

// CSV export of every page in the crawl + its score/grade/issue counts.
router.get('/runs/:id/export.csv', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const id = req.params.id;
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-crawler:export-csv' });
  const r = await _db.getPool().query(
    `SELECT url, score, grade, summary FROM seo_crawl_pages WHERE run_id=$1 AND tenant_id=$2 ORDER BY score ASC, url ASC`, [id, tid]
  );
  const csvEscape = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = ['url','score','grade','passed','warned','failed'];
  const rows = [header.join(',')];
  for (const row of r.rows) {
    const s = row.summary || {};
    rows.push([row.url, row.score, row.grade, s.passed||0, s.warned||0, s.failed||0].map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="seo_crawl_${id}.csv"`);
  res.send(rows.join('\n'));
}));

// Bulk-import every warn/fail check from every page in the crawl as SEO tasks.
// De-dupes via the seo_tasks (source_url, check_id) partial unique index.
router.post('/runs/:id/import-tasks', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const id = req.params.id;
  const onlyFails = !!(req.body && req.body.onlyFails);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-crawler:import-tasks' });
  const r = await _db.getPool().query(
    `SELECT url, checks FROM seo_crawl_pages WHERE run_id=$1 AND tenant_id=$2`, [id, tid]
  );
  if (!r.rowCount) return _err(res, 404, 'No pages in this crawl');
  let created = 0, skipped = 0, total = 0;
  for (const row of r.rows) {
    const issues = (row.checks || []).filter(c => c && c.id && c.label && (onlyFails ? c.status === 'fail' : (c.status === 'fail' || c.status === 'warn')));
    for (const c of issues) {
      total++;
      const priority = c.status === 'fail' ? (c.weight >= 6 ? 1 : 2) : (c.weight >= 6 ? 2 : 3);
      const ins = await _db.getPool().query(
        `INSERT INTO seo_tasks (tenant_id, source, source_url, check_id, label, message, fix, priority)
         VALUES ($7, 'seo_crawl', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (source_url, check_id) WHERE status NOT IN ('done','wont_fix') DO NOTHING
         RETURNING id`,
        [row.url, c.id, c.label, c.message, c.fix, priority, tid]
      );
      if (ins.rowCount) created++; else skipped++;
    }
  }
  res.json({ ok: true, created, skipped, total });
}));

router.delete('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'seo-crawler:run-delete' });
  await _db.getPool().query(`DELETE FROM seo_crawl_pages WHERE run_id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  await _db.getPool().query(`DELETE FROM seo_crawl_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  _runs.delete(req.params.id);
  res.json({ ok: true });
}));

// Roll page-level checks into site-wide insights:
//  - topIssues: per check_id, how many pages it affects + cumulative weighted impact
//  - quickWins: top 5 failing checks ordered by impact (pages_affected × weight)
//  - worstPages: bottom 8 pages by score
function _aggregateInsights(pages) {
  if (!pages.length) return { topIssues: [], quickWins: [], worstPages: [], totals: { pages: 0, failures: 0, warnings: 0, uniqueIssues: 0 } };
  const byCheck = new Map(); // check_id -> { id, label, fix, status, weight, pages:Set, failPages:Set, warnPages:Set }
  let totalFail = 0, totalWarn = 0;
  for (const p of pages) {
    for (const c of (p.checks || [])) {
      if (c.status === 'pass') continue;
      if (c.status === 'fail') totalFail++;
      if (c.status === 'warn') totalWarn++;
      let entry = byCheck.get(c.id);
      if (!entry) {
        entry = { id: c.id, label: c.label, fix: c.fix, message: c.message, weight: c.weight || 1, failPages: [], warnPages: [] };
        byCheck.set(c.id, entry);
      }
      if (c.status === 'fail') entry.failPages.push(p.url);
      else if (c.status === 'warn') entry.warnPages.push(p.url);
    }
  }
  const topIssues = Array.from(byCheck.values()).map(e => {
    const pagesAffected = e.failPages.length + e.warnPages.length;
    return {
      id: e.id, label: e.label, fix: e.fix, message: e.message, weight: e.weight,
      failCount: e.failPages.length, warnCount: e.warnPages.length, pagesAffected,
      impact: pagesAffected * e.weight,
      pctOfSite: Math.round((pagesAffected / pages.length) * 100),
      sampleFailPages: e.failPages.slice(0, 5),
      sampleWarnPages: e.warnPages.slice(0, 5)
    };
  }).sort((a, b) => b.impact - a.impact);
  const quickWins = topIssues.filter(i => i.failCount > 0).slice(0, 5);
  const worstPages = pages.slice().sort((a, b) => (a.score || 0) - (b.score || 0)).slice(0, 8)
    .map(p => ({ url: p.url, score: p.score, grade: p.grade, summary: p.summary }));
  return {
    topIssues: topIssues.slice(0, 20),
    quickWins,
    worstPages,
    totals: { pages: pages.length, failures: totalFail, warnings: totalWarn, uniqueIssues: byCheck.size }
  };
}

module.exports = router;
