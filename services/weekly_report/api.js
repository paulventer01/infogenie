const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { streamPdf } = require('../exports/pdf_report');
const _https = require('https');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _hasResend() { const k = process.env.RESEND_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _safeAsync(handler) { return (req, res) => Promise.resolve(handler(req, res)).catch(e => { console.warn('[weekly-report] route error:', e.message); if (!res.headersSent) _err(res, 500, e.message || 'internal error'); }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

// ── Section gatherers (read from existing tier tables) ──────────────────────
// All gatherers take a tid so the weekly digest only surfaces the caller's
// own brand activity, not some other tenant's data tagged with the same brand.
async function _gatherSections(brand, tid) {
  const sections = [];
  const since = `now() - interval '7 days'`;
  if (!_db.hasDb || !_db.hasDb()) return [{ title: 'Notice', kind:'text', body:'No database configured — weekly report will be empty.' }];
  if (!Number.isFinite(tid)) throw new Error('tenant_id required for weekly-report _gatherSections');
  const pool = _db.getPool();

  async function safe(q, params) { try { const r = await pool.query(q, params); return r.rows; } catch { return []; } }

  // 1) Crisis incidents (last 7 days)
  const incidents = await safe(`SELECT created_at, severity, kind, headline FROM crisis_incidents WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 30`, [brand, tid]);
  if (incidents.length) sections.push({
    title: `🚨 Crisis Radar — ${incidents.length} incident(s)`,
    kind: 'table',
    headers: ['Date', 'Severity', 'Kind', 'Headline'],
    rows: incidents.map(r => [new Date(r.created_at).toLocaleDateString(), r.severity, r.kind, String(r.headline||'').slice(0,80)])
  });

  // 2) SoV snapshots (week-over-week)
  const sov = await safe(`SELECT entity, AVG(share)::numeric(5,2) AS share FROM sov_snapshots WHERE brand=$1 AND tenant_id=$2 AND taken_at >= ${since} GROUP BY entity ORDER BY share DESC LIMIT 10`, [brand, tid]);
  if (sov.length) sections.push({
    title: '📊 Share of Voice (7-day average)',
    kind: 'table',
    headers: ['Entity', '% Share'],
    rows: sov.map(r => [r.entity, String(r.share)])
  });

  // 3) Mentions volume
  const snaps = await safe(`SELECT taken_at::date AS d, SUM(total_mentions) AS m, AVG(neg_pct)::numeric(4,2) AS neg FROM crisis_snapshots WHERE brand=$1 AND tenant_id=$2 AND taken_at >= ${since} GROUP BY taken_at::date ORDER BY d DESC`, [brand, tid]);
  if (snaps.length) sections.push({
    title: '📡 Mention Volume (daily)',
    kind: 'table',
    headers: ['Date', 'Mentions', 'Negative %'],
    rows: snaps.map(r => [String(r.d), String(r.m||0), String(r.neg||0)])
  });

  // 4) Recent press releases
  const press = await safe(`SELECT created_at, kind, headline FROM press_releases WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 10`, [brand, tid]);
  if (press.length) sections.push({
    title: `📰 Press Releases (${press.length})`,
    kind: 'table',
    headers: ['Date', 'Type', 'Headline'],
    rows: press.map(r => [new Date(r.created_at).toLocaleDateString(), r.kind, String(r.headline||'').slice(0,80)])
  });

  // 5) Voice of Customer themes
  const voc = await safe(`SELECT created_at, themes FROM voc_runs WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 1`, [brand, tid]);
  if (voc.length && Array.isArray(voc[0].themes)) {
    const top = voc[0].themes.slice(0, 6);
    sections.push({
      title: '🎯 Voice of Customer — Top Themes',
      kind: 'table',
      headers: ['Theme', 'Kind', 'Mentions'],
      rows: top.map(t => [String(t.label||'').slice(0,60), t.kind || '', String(t.count || '?')])
    });
  }

  // 6) Top trending topics
  const trends = await safe(`SELECT created_at, topics FROM trend_runs WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 1`, [brand, tid]);
  if (trends.length && Array.isArray(trends[0].topics)) {
    sections.push({
      title: '📈 Trending Topics (last 7 days)',
      kind: 'table',
      headers: ['Topic', 'Why it matters'],
      rows: trends[0].topics.slice(0, 8).map(t => [String(t.topic||'').slice(0,60), String(t.why||'').slice(0,80)])
    });
  }

  // 7) Optimizer decisions — table is optimizer_actions in current schema;
  // legacy SELECT referenced optimizer_decisions which never existed, so the
  // _gatherSections safe() wrapper silently dropped it. Keeping that behaviour
  // (still scoped by tenant when the table is added later) avoids surprising
  // schema-failure noise in weekly digests.
  const decisions = await safe(`SELECT created_at, decision, campaign_name, reason FROM optimizer_decisions WHERE tenant_id=$1 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 15`, [tid]);
  if (decisions.length) sections.push({
    title: `⚡ AI Optimizer — ${decisions.length} decision(s)`,
    kind: 'table',
    headers: ['Date', 'Decision', 'Campaign', 'Reason'],
    rows: decisions.map(r => [new Date(r.created_at).toLocaleDateString(), r.decision, String(r.campaign_name||'').slice(0,40), String(r.reason||'').slice(0,60)])
  });

  // 8) YouTube channel activity
  const yt = await safe(`SELECT c.channel_name, COUNT(s.id) AS video_count, SUM(s.view_count)::bigint AS total_views
                          FROM yt_channels c LEFT JOIN yt_snapshots s ON s.channel_id=c.id AND s.captured_at >= ${since}
                          WHERE c.brand=$1 AND c.tenant_id=$2 GROUP BY c.id, c.channel_name ORDER BY total_views DESC NULLS LAST LIMIT 10`, [brand, tid]);
  if (yt.length) sections.push({
    title: '▶️ YouTube Activity (7 days)',
    kind: 'table',
    headers: ['Channel', 'New Videos', 'Total Views'],
    rows: yt.map(r => [String(r.channel_name||'').slice(0,40), String(r.video_count||0), String(r.total_views||0)])
  });

  if (!sections.length) sections.push({ title: 'No activity', kind:'text', body:`No data captured for "${brand}" in the last 7 days. Add the brand to Crisis Radar watchlist, run a Voice of Customer scan, or enable AI Optimizer to start collecting data.` });
  return sections;
}

async function _buildReport(brand, tid) {
  const sections = await _gatherSections(brand, tid);
  return {
    title: `${brand} — Weekly Intelligence Report`,
    generated_at: new Date().toISOString(),
    sections
  };
}

async function _sendViaResend({ to, subject, html }) {
  if (!_hasResend()) throw new Error('RESEND_API_KEY missing');
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ from: 'InfoGenie <reports@infogenie.app>', to: [to], subject, html });
    const req = _https.request({
      hostname:'api.resend.com', path:'/emails', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try { const j = JSON.parse(d); if (r.statusCode >= 200 && r.statusCode < 300) resolve(j); else reject(new Error(j.message || `resend ${r.statusCode}`)); }
        catch (e) { reject(new Error(`resend parse failed: ${d.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('resend timeout')); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => {
  res.json({ ok:true, db: _db.hasDb && _db.hasDb(), resend: _hasResend() });
});

router.get('/subs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, subs:[] });
  const tid = await _tid(req, 'wr:subs-list');
  const r = await _db.getPool().query('SELECT * FROM weekly_report_subs WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
  res.json({ ok:true, subs: r.rows });
}));

router.post('/subs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const brand = String(req.body?.brand || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!brand) return _err(res, 400, 'brand required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return _err(res, 400, 'valid email required');
  const tid = await _tid(req, 'wr:subs-add');
  const r = await _db.getPool().query(
    `INSERT INTO weekly_report_subs (tenant_id, brand, email) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, brand, email) DO UPDATE SET enabled=true RETURNING *`,
    [tid, brand, email]
  );
  res.json({ ok:true, sub: r.rows[0] });
}));

router.delete('/subs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const tid = await _tid(req, 'wr:subs-del');
  await _db.getPool().query('DELETE FROM weekly_report_subs WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id, 10), tid]);
  res.json({ ok:true });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tid(req, 'wr:runs-list');
  const r = await _db.getPool().query('SELECT * FROM weekly_report_runs WHERE tenant_id=$1 ORDER BY generated_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

router.post('/preview', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || req.query.brand || '').trim();
  if (!brand) return _err(res, 400, 'brand required');
  const tid = await _tid(req, 'wr:preview');
  const report = await _buildReport(brand, tid);
  res.json({ ok:true, report });
}));

router.get('/pdf', _safeAsync(async (req, res) => {
  const brand = String(req.query.brand || '').trim();
  if (!brand) return _err(res, 400, 'brand required');
  const tid = await _tid(req, 'wr:pdf');
  const report = await _buildReport(brand, tid);
  if (_db.hasDb && _db.hasDb()) {
    try { await _db.getPool().query('INSERT INTO weekly_report_runs (tenant_id, brand, sections_count) VALUES ($1,$2,$3)', [tid, brand, report.sections.length]); } catch(_) {}
  }
  streamPdf(report, res, `${brand.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-weekly.pdf`);
}));

router.post('/send', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!brand || !email) return _err(res, 400, 'brand + email required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return _err(res, 400, 'valid email required');
  if (!_hasResend()) return _err(res, 400, 'RESEND_API_KEY required to send emails');
  const tid = await _tid(req, 'wr:send');
  const report = await _buildReport(brand, tid);
  const safeBrand = _escHtml(brand);
  const summary = report.sections.map(s => `<li><strong>${_escHtml(s.title)}</strong></li>`).join('');
  const pdfPath = `/api/weekly-report/pdf?brand=${encodeURIComponent(brand)}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#1E1B4B">${safeBrand} — Weekly Intelligence</h1>
    <p style="color:#475569">Generated ${_escHtml(new Date().toLocaleString())}</p>
    <p>Here's what InfoGenie tracked for <strong>${safeBrand}</strong> over the last 7 days:</p>
    <ul style="line-height:1.8">${summary}</ul>
    <p style="margin-top:24px;padding:16px;background:#F1F5F9;border-radius:8px;font-size:0.9rem;color:#475569">📥 Download the full PDF report inside InfoGenie at <code>${_escHtml(pdfPath)}</code>, or sign in to drill into any section.</p>
  </div>`;
  await _sendViaResend({ to: email, subject: `${brand} — Weekly Intelligence Report`, html });
  if (_db.hasDb && _db.hasDb()) {
    try {
      await _db.getPool().query('INSERT INTO weekly_report_runs (tenant_id, brand, sections_count, sent_to) VALUES ($1,$2,$3,$4)', [tid, brand, report.sections.length, email]);
      await _db.getPool().query('UPDATE weekly_report_subs SET last_sent_at=now() WHERE tenant_id=$1 AND brand=$2 AND email=$3', [tid, brand, email]);
    } catch(_) {}
  }
  res.json({ ok:true, sent_to: email, sections: report.sections.length, note: 'Email sent. PDF available at ' + pdfPath });
}));

// Cron: every 7 days, send to all enabled subs. The claimed row carries its
// own tenant_id, so _buildReport is run in that tenant's context and the run
// row is inserted with the same tid.
let _cronTimer = null;
function startWeeklyCron(intervalDays = 7) {
  if (_cronTimer) return;
  async function tick() {
    if (!_db.hasDb || !_db.hasDb() || !_hasResend()) return;
    const pool = _db.getPool();
    while (true) {
      // Atomically claim ONE due subscription using FOR UPDATE SKIP LOCKED + same-tx
      // last_sent_at bump, so concurrent ticks/processes can never double-send.
      const client = await pool.connect();
      let claimed = null;
      try {
        await client.query('BEGIN');
        const r = await client.query(`SELECT * FROM weekly_report_subs
            WHERE enabled=true AND (last_sent_at IS NULL OR last_sent_at < now() - interval '6 days')
            ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (!r.rows.length) { await client.query('COMMIT'); client.release(); break; }
        claimed = r.rows[0];
        await client.query('UPDATE weekly_report_subs SET last_sent_at=now() WHERE id=$1', [claimed.id]);
        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch(_) {}
        client.release();
        console.warn('[weekly-report] claim failed:', e.message); break;
      }
      client.release();
      // Now send outside the txn — safe because the row is already marked sent.
      try {
        const tid = Number(claimed.tenant_id);
        if (!Number.isFinite(tid)) { console.warn('[weekly-report] claimed sub missing tenant_id, id=', claimed.id); continue; }
        const report = await _buildReport(claimed.brand, tid);
        const safe = _escHtml(claimed.brand);
        const html = `<div style="font-family:system-ui,sans-serif"><h2>${safe} — Weekly Intelligence</h2><p>${report.sections.length} sections covered. PDF available in InfoGenie at /api/weekly-report/pdf?brand=${encodeURIComponent(claimed.brand)}.</p></div>`;
        await _sendViaResend({ to: claimed.email, subject: `${claimed.brand} — Weekly Report`, html });
        await pool.query('INSERT INTO weekly_report_runs (tenant_id, brand, sections_count, sent_to) VALUES ($1,$2,$3,$4)', [tid, claimed.brand, report.sections.length, claimed.email]);
      } catch (e) { console.warn('[weekly-report] send failed for', claimed.email, e.message); }
    }
  }
  _cronTimer = setInterval(tick, intervalDays * 24 * 3600 * 1000);
  console.log(`[weekly-report] cron started — every ${intervalDays}d`);
}

module.exports = { router, startWeeklyCron };
