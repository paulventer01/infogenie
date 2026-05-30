// T35.2 — Backlink Change Monitoring
//
// Tracks new and lost backlinks for a list of monitored domains via daily
// snapshots from DataForSEO referring_domains/live. Diffs each fresh snapshot
// against the prior snapshot table:
//   • a referring_domain in the new pull but absent from snapshots → 'new'
//   • a referring_domain in snapshots but absent from the new pull   → 'lost'
//
// Changes go into backlink_changes (audit trail) and trigger an optional
// digest email + Slack webhook per monitor. Recurring negative-SEO defence:
// the user gets pinged when suspicious link clusters appear.
//
// Reuses the same DataForSEO auth path as services/backlinks/api.js but does
// NOT depend on it (kept self-contained so it can be stripped out cleanly).

const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
// Fetch + snapshot must use the SAME cardinality, otherwise rows past the cap
// look "new" every run (because they're never persisted) and "lost" can be a
// rank-cutoff artifact rather than a true loss.
const MAX_DOMAINS = 1000;
// Allowlist for outbound webhook hosts to prevent SSRF via user-supplied URL.
const _SLACK_ALLOWED_HOSTS = new Set(['hooks.slack.com']);

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

function _dfsAuth() {
  const u = process.env.DATAFORSEO_LOGIN, p = process.env.DATAFORSEO_PASSWORD;
  if (!u || !p) return null;
  return 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
}

async function _dfsCall(path, payload, timeoutMs = 25000) {
  const auth = _dfsAuth(); if (!auth) throw new Error('DataForSEO not configured');
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = _https.request({
      hostname: 'api.dataforseo.com', path, method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
      try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
    }); });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('dfs timeout')));
    req.write(body); req.end();
  });
}

function _normTarget(t) {
  return String(t || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').slice(0, 253);
}

async function _sendDigest(monitor, news, losts) {
  // Use Slack webhook + Resend mail if available. Both are optional and we
  // never throw on dispatch failure — the snapshot+changes are still recorded.
  const subject = `Backlink update: ${monitor.domain} — ${news.length} new, ${losts.length} lost`;
  const lines = [];
  if (news.length) {
    lines.push(`✨ NEW LINKS (${news.length})`);
    news.slice(0, 25).forEach(d => lines.push(`  · ${d.referring_domain} (rank ${d.rank || 0}${d.country ? ', ' + d.country : ''})`));
    if (news.length > 25) lines.push(`  … and ${news.length - 25} more`);
  }
  if (losts.length) {
    if (lines.length) lines.push('');
    lines.push(`💔 LOST LINKS (${losts.length})`);
    losts.slice(0, 25).forEach(d => lines.push(`  · ${d.referring_domain} (rank ${d.rank || 0}${d.country ? ', ' + d.country : ''})`));
    if (losts.length > 25) lines.push(`  … and ${losts.length - 25} more`);
  }
  const body = lines.join('\n');

  if (monitor.alert_slack_webhook) {
    try {
      const url = new URL(monitor.alert_slack_webhook);
      if (url.protocol !== 'https:' || !_SLACK_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
        console.warn('[backlink-monitor] slack webhook rejected (not on allowlist):', url.hostname);
      } else {
        await new Promise((resolve, reject) => {
          const payload = JSON.stringify({ text: `*${subject}*\n\`\`\`${body}\`\`\`` });
          const req = _https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
            r => { r.resume(); r.on('end', resolve); });
          req.on('error', reject);
          req.setTimeout(8000, () => req.destroy(new Error('slack timeout')));
          req.write(payload); req.end();
        });
      }
    } catch (e) { console.warn('[backlink-monitor] slack send failed:', e.message); }
  }
  if (monitor.alert_email) {
    try {
      // Use Replit Mail integration if available.
      let replitMail;
      try { replitMail = require('@replitmail/sdk'); } catch {}
      if (replitMail && typeof replitMail.sendEmail === 'function') {
        await replitMail.sendEmail({ to: monitor.alert_email, subject, text: body });
      } else if (process.env.RESEND_API_KEY) {
        const payload = JSON.stringify({ from: 'InfoGenie <onboarding@resend.dev>', to: [monitor.alert_email], subject, text: body });
        await new Promise((resolve, reject) => {
          const req = _https.request({ hostname: 'api.resend.com', path: '/emails', method: 'POST',
            headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
            r => { r.resume(); r.on('end', resolve); });
          req.on('error', reject);
          req.setTimeout(8000, () => req.destroy(new Error('resend timeout')));
          req.write(payload); req.end();
        });
      }
    } catch (e) { console.warn('[backlink-monitor] email send failed:', e.message); }
  }
}

async function _runMonitor(monitor) {
  if (!_dfsAuth()) return { ok: false, error: 'DataForSEO not configured' };
  const pool = _db.getPool();
  const target = _normTarget(monitor.domain);
  // Fetch the same cap we persist so domains beyond MAX_DOMAINS aren't
  // re-flagged 'new' every run.
  const j = await _dfsCall('/v3/backlinks/referring_domains/live',
    [{ target, limit: MAX_DOMAINS, order_by: ['rank,desc'], backlinks_status_type: 'live' }]);
  const items = (j?.tasks?.[0]?.result?.[0]?.items || []).filter(it => it && it.domain).slice(0, MAX_DOMAINS);

  // Diff + snapshot replace + monitor stamp in ONE transaction so a crash
  // can't leave changes recorded while the snapshot stays stale (which would
  // duplicate the same 'new'/'lost' rows on the next run).
  const client = await pool.connect();
  let news = [], losts = [];
  try {
    await client.query('BEGIN');
    // Lock this monitor's snapshot rows so a parallel cron tick + manual
    // run-now can't both compute a diff against the same state.
    const prev = await client.query(
      `SELECT referring_domain FROM backlink_snapshots WHERE monitor_id=$1 FOR UPDATE`,
      [monitor.id],
    );
    const prevSet = new Set(prev.rows.map(r => r.referring_domain));
    const currSet = new Set(items.map(it => it.domain));
    news = items.filter(it => !prevSet.has(it.domain)).map(it => ({
      referring_domain: it.domain, rank: it.rank || 0, country: it.country || null,
    }));
    losts = [];
    for (const r of prev.rows) {
      if (!currSet.has(r.referring_domain)) losts.push({ referring_domain: r.referring_domain, rank: 0, country: null });
    }
    for (const c of news) {
      await client.query(
        `INSERT INTO backlink_changes (tenant_id, monitor_id, change_type, referring_domain, rank, country) VALUES ($1, $2, 'new', $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [monitor.tenant_id, monitor.id, c.referring_domain, c.rank, c.country],
      );
    }
    for (const c of losts) {
      await client.query(
        `INSERT INTO backlink_changes (tenant_id, monitor_id, change_type, referring_domain, rank, country) VALUES ($1, $2, 'lost', $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [monitor.tenant_id, monitor.id, c.referring_domain, c.rank, c.country],
      );
    }
    await client.query(`DELETE FROM backlink_snapshots WHERE monitor_id=$1`, [monitor.id]);
    for (const it of items) {
      await client.query(
        `INSERT INTO backlink_snapshots (tenant_id, monitor_id, referring_domain, rank, backlinks, country, first_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (monitor_id, referring_domain) DO UPDATE
           SET rank = EXCLUDED.rank, backlinks = EXCLUDED.backlinks, country = EXCLUDED.country, snapshot_at = now()`,
        [monitor.tenant_id, monitor.id, it.domain, it.rank || 0, it.backlinks || 0, it.country || null, it.first_seen || null],
      );
    }
    await client.query(
      `UPDATE backlink_monitors SET last_run_at = now(), last_total_referring = $2 WHERE id = $1`,
      [monitor.id, items.length],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if ((news.length || losts.length) && (monitor.alert_email || monitor.alert_slack_webhook)) {
    await _sendDigest(monitor, news, losts);
    await pool.query(
      `UPDATE backlink_changes SET notified_at = now() WHERE monitor_id=$1 AND notified_at IS NULL`,
      [monitor.id],
    );
  }
  return { ok: true, target, refreshed: items.length, newCount: news.length, lostCount: losts.length };
}

let _cronTimer = null, _cronRunning = false;
async function _cronTick() {
  if (_cronRunning) return; _cronRunning = true;
  try {
    if (!_db.hasDb() || !_dfsAuth()) return;
    // Daily monitors: last_run >24h ago. Weekly: >7d.
    const r = await _db.getPool().query(`
      SELECT * FROM backlink_monitors
      WHERE (last_run_at IS NULL)
         OR (frequency='daily' AND last_run_at < now() - interval '23 hours')
         OR (frequency='weekly' AND last_run_at < now() - interval '6 days 23 hours')
      ORDER BY last_run_at NULLS FIRST LIMIT 25
    `);
    for (const m of r.rows) {
      try { await _runMonitor(m); } catch (e) { console.warn('[backlink-monitor] tick fail', m.domain, e.message); }
    }
    if (r.rows.length) console.log(`[backlink-monitor] cron processed ${r.rows.length} monitor(s)`);
  } finally { _cronRunning = false; }
}

function startCron() {
  if (_cronTimer) return;
  _cronTimer = setInterval(_cronTick, 60 * 60 * 1000); // hourly tick, per-monitor frequency gates inside
  setTimeout(_cronTick, 90 * 1000);
  console.log('[backlink-monitor] cron started (hourly tick, daily/weekly per monitor)');
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/domains', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, monitors: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'backlink_monitor:domains' });
  const r = await _db.getPool().query(`SELECT * FROM backlink_monitors WHERE tenant_id=$1 ORDER BY id DESC`, [tid]);
  res.json({ ok: true, monitors: r.rows });
});

router.post('/domains', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const domain = _normTarget(req.body?.domain);
  if (!domain) return _err(res, 400, 'domain required');
  const alert_email = String(req.body?.alert_email || '').trim().slice(0, 200) || null;
  const alert_slack = String(req.body?.alert_slack_webhook || '').trim().slice(0, 500) || null;
  const frequency = ['daily','weekly'].includes(req.body?.frequency) ? req.body.frequency : 'daily';
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'backlink_monitor:create' });
  try {
    const r = await _db.getPool().query(
      `INSERT INTO backlink_monitors (tenant_id, domain, alert_email, alert_slack_webhook, frequency)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (domain) DO UPDATE
         SET alert_email = EXCLUDED.alert_email,
             alert_slack_webhook = EXCLUDED.alert_slack_webhook,
             frequency = EXCLUDED.frequency
       RETURNING *`,
      [tid, domain, alert_email, alert_slack, frequency],
    );
    res.json({ ok: true, monitor: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/domains/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'backlink_monitor:delete-domain' });
  await _db.getPool().query(`DELETE FROM backlink_monitors WHERE id=$1 AND tenant_id=$2`, [parseInt(req.params.id, 10), tid]);
  res.json({ ok: true });
});

router.get('/changes', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, changes: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'backlink_monitor:changes' });
  const monitorId = parseInt(req.query.monitor_id, 10);
  const type = ['new','lost'].includes(req.query.type) ? req.query.type : null;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const params = [];
  const where = [];
  params.push(tid); where.push(`m.tenant_id = $${params.length}`);
  if (Number.isFinite(monitorId)) { params.push(monitorId); where.push(`c.monitor_id = $${params.length}`); }
  if (type) { params.push(type); where.push(`c.change_type = $${params.length}`); }
  const sql = `SELECT c.*, m.domain FROM backlink_changes c JOIN backlink_monitors m ON m.id=c.monitor_id
               WHERE ${where.join(' AND ')}
               ORDER BY c.detected_at DESC LIMIT ${limit}`;
  const r = await _db.getPool().query(sql, params);
  res.json({ ok: true, changes: r.rows });
});

router.post('/run-now', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = parseInt(req.body?.monitor_id, 10);
  const pool = _db.getPool();
  const r = id
    ? await pool.query(`SELECT * FROM backlink_monitors WHERE id=$1`, [id])
    : await pool.query(`SELECT * FROM backlink_monitors ORDER BY last_run_at NULLS FIRST LIMIT 25`);
  const results = [];
  for (const m of r.rows) {
    try { results.push({ id: m.id, domain: m.domain, ...(await _runMonitor(m)) }); }
    catch (e) { results.push({ id: m.id, domain: m.domain, ok: false, error: e.message }); }
  }
  res.json({ ok: true, results });
});

module.exports = router;
module.exports.startCron = startCron;
