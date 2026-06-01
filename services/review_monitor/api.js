// services/review_monitor/api.js — T46 Deleted Review Detection
// Routes: GET /deleted   GET /stats
// Exported helper: recordSnapshot(tenantId, brand, platform, reviews[])

const express = require('express');
const crypto  = require('crypto');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(fn) { return (req, res) => Promise.resolve(fn(req, res)).catch(e => { if (!res.headersSent) _err(res, 500, e.message); }); }

// ── Date normalizer ───────────────────────────────────────────────────────────
// Perplexity scan returns dates as "YYYY-MM-DD or relative" — relative strings
// like "2 weeks ago" drift on every scan, causing false deletions if included
// in the fingerprint. Detect and discard relative strings; parse absolute dates
// to YYYY-MM-DD so the token is canonical regardless of original format.
function _normalizeDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  // Relative date — exclude from fingerprint to prevent drift
  if (/\b(ago|last|yesterday|today|week|month|day|hour|minute|just now)\b/i.test(s)) return '';
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch (_) {}
  // Non-parseable string that isn't obviously relative — include as-is so
  // purely static strings (e.g. "March 2024") still contribute to identity.
  return s.slice(0, 20).toLowerCase();
}

// ── Stable review fingerprint (author + normalised date + rating) ────────────
// Body is intentionally excluded — review text can be edited/truncated by the
// platform without the review being truly removed, which would create false
// "deleted" events if body were part of the identity.
function _reviewId(author, date, rating) {
  const stableDate = _normalizeDate(date);
  const str = `${String(author || '').trim()}|${stableDate}|${rating || 0}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

// ── Slack alert helper ────────────────────────────────────────────────────────
async function _sendSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return;
    const body = Buffer.from(JSON.stringify({ text }));
    await new Promise(resolve => {
      const req = _https.request({
        hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
      }, r => { r.resume(); r.on('end', resolve); });
      req.on('error', resolve);
      req.setTimeout(10000, () => { req.destroy(); resolve(); });
      req.write(body); req.end();
    });
  } catch (_) {}
}

// ── Tenant-scoped email recipient resolver ───────────────────────────────────
// Priority: RESEND_ALERT_EMAIL env (platform override) → tenant creator's email
// (scoped to the specific tenantId so multi-tenant deployments never leak across
// workspaces). Returns null if neither is available.
async function _getAlertEmail(tenantId) {
  if (process.env.RESEND_ALERT_EMAIL) return process.env.RESEND_ALERT_EMAIL;
  try {
    if (_db.hasDb && _db.hasDb() && tenantId != null) {
      const r = await _db.getPool().query(
        `SELECT u.email FROM users u
           JOIN tenants t ON t.created_by_user_id = u.id
          WHERE t.id = $1 LIMIT 1`,
        [tenantId]
      );
      if (r.rows[0] && r.rows[0].email) return r.rows[0].email;
    }
  } catch (_) {}
  return null;
}

// ── Resend email alert helper ─────────────────────────────────────────────────
async function _sendEmail(tenantId, subject, htmlBody) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || /^_DUMMY/i.test(apiKey)) return;
  const from = process.env.RESEND_FROM_EMAIL || 'alerts@resend.dev';
  const to = await _getAlertEmail(tenantId);
  if (!to) return;
  try {
    const payload = Buffer.from(JSON.stringify({ from, to, subject, html: htmlBody }));
    await new Promise(resolve => {
      const req = _https.request({
        hostname: 'api.resend.com', path: '/emails', method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': payload.length
        }
      }, r => { r.resume(); r.on('end', resolve); });
      req.on('error', resolve);
      req.setTimeout(15000, () => { req.destroy(); resolve(); });
      req.write(payload); req.end();
    });
  } catch (_) {}
}

// ── Core snapshot helper — called by review_aggregator after every scan ───────
// Returns array of newly-deleted review rows.
async function recordSnapshot(tenantId, brand, platform, reviews) {
  if (!_db.hasDb || !_db.hasDb()) return [];
  if (tenantId == null) return [];
  const pool = _db.getPool();

  // Build list of current review IDs using stable author+normalizedDate+rating fingerprint
  const currentIds = reviews.map(rv => _reviewId(rv.author, rv.date, rv.rating));

  // Upsert all current reviews (mark as seen / resurrect if previously deleted)
  for (let i = 0; i < reviews.length; i++) {
    const rv = reviews[i];
    const rid = currentIds[i];
    await pool.query(`
      INSERT INTO review_snapshots (tenant_id, brand, platform, review_id, rating, author, title, body, first_seen_at, last_seen_at, deleted, deleted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),false,NULL)
      ON CONFLICT (tenant_id, brand, platform, review_id) DO UPDATE SET
        last_seen_at = now(),
        deleted      = false,
        deleted_at   = NULL,
        rating       = EXCLUDED.rating,
        title        = EXCLUDED.title
    `, [tenantId, brand, platform, rid,
        Number(rv.rating) || null,
        String(rv.author || '').slice(0, 200),
        rv.title ? String(rv.title).slice(0, 400) : null,
        rv.body  ? String(rv.body).slice(0, 2000)  : null]);
  }

  // Find rows that were active before but are not in the current set → mark deleted
  let newlyDeleted = [];
  if (currentIds.length > 0) {
    const placeholders = currentIds.map((_, j) => `$${j + 4}`).join(',');
    const r = await pool.query(`
      UPDATE review_snapshots
         SET deleted = true, deleted_at = now()
       WHERE tenant_id = $1 AND brand = $2 AND platform = $3
         AND deleted   = false
         AND review_id NOT IN (${placeholders})
      RETURNING *
    `, [tenantId, brand, platform, ...currentIds]);
    newlyDeleted = r.rows;
  } else {
    // No reviews returned — mark all as deleted
    const r = await pool.query(`
      UPDATE review_snapshots
         SET deleted = true, deleted_at = now()
       WHERE tenant_id = $1 AND brand = $2 AND platform = $3 AND deleted = false
      RETURNING *
    `, [tenantId, brand, platform]);
    newlyDeleted = r.rows;
  }

  // Alert (Slack + email) if any reviews disappeared
  if (newlyDeleted.length > 0) {
    const preview = newlyDeleted.slice(0, 3).map(rv =>
      `• ${rv.author || 'Anonymous'} (${rv.rating || '?'}★): "${String(rv.body || '').slice(0, 80)}${(rv.body || '').length > 80 ? '…' : ''}"`
    ).join('\n');
    const alertText = `🗑️ *Review Deletion Alert* — *${brand}* on *${platform}*\n` +
      `${newlyDeleted.length} review(s) disappeared since the last scan.\n${preview}`;
    const htmlBody = `<h2>🗑️ Review Deletion Alert</h2>
<p><strong>${brand}</strong> on <strong>${platform}</strong> — ` +
      `${newlyDeleted.length} review(s) disappeared since the last scan.</p>
<ul>${newlyDeleted.slice(0, 5).map(rv =>
  `<li><strong>${rv.author || 'Anonymous'}</strong> (${rv.rating || '?'}★): ` +
  `&ldquo;${String(rv.body || '').replace(/</g, '&lt;').slice(0, 120)}${(rv.body || '').length > 120 ? '&hellip;' : ''}&rdquo;</li>`
).join('')}</ul>
<p style="color:#6B7280;font-size:12px">Detected by InfoGenie T46 Deleted Review Monitor</p>`;
    // Fire both channels concurrently; neither blocks the caller
    Promise.all([
      _sendSlack(alertText).catch(() => {}),
      _sendEmail(tenantId, `Review Deletion Alert — ${brand} on ${platform}`, htmlBody).catch(() => {})
    ]).catch(() => {});
  }

  return newlyDeleted;
}

// ── GET /api/review-monitor/deleted ──────────────────────────────────────────
router.get('/deleted', _safe(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, deleted: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'review-monitor:deleted' });
  if (tid == null) return _err(res, 400, 'no_tenant');

  const brand    = req.query.brand    ? String(req.query.brand).slice(0, 200)    : null;
  const platform = req.query.platform ? String(req.query.platform).slice(0, 40)  : null;
  const params = [tid]; const where = ['tenant_id=$1','deleted=true'];
  if (brand)    { params.push(brand);    where.push(`LOWER(brand)=LOWER($${params.length})`); }
  if (platform) { params.push(platform); where.push(`platform=$${params.length}`); }

  const r = await _db.getPool().query(
    `SELECT * FROM review_snapshots WHERE ${where.join(' AND ')} ORDER BY deleted_at DESC LIMIT 200`,
    params
  );
  res.json({ ok: true, deleted: r.rows });
}));

// ── GET /api/review-monitor/stats ─────────────────────────────────────────────
router.get('/stats', _safe(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, stats: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'review-monitor:stats' });
  if (tid == null) return _err(res, 400, 'no_tenant');

  const brand  = req.query.brand ? String(req.query.brand).slice(0, 200) : null;
  const params = [tid]; const where = ['tenant_id=$1'];
  if (brand) { params.push(brand); where.push(`LOWER(brand)=LOWER($${params.length})`); }

  const r = await _db.getPool().query(`
    SELECT platform,
           COUNT(*) FILTER (WHERE deleted=false) AS active_count,
           COUNT(*) FILTER (WHERE deleted=true)  AS deleted_count,
           COUNT(*) FILTER (WHERE deleted=true AND deleted_at >= date_trunc('month', now())) AS deleted_this_month
      FROM review_snapshots
     WHERE ${where.join(' AND ')}
     GROUP BY platform
     ORDER BY platform
  `, params);
  const totalDeletedThisMonth = r.rows.reduce((s, x) => s + Number(x.deleted_this_month || 0), 0);
  res.json({ ok: true, stats: r.rows, totalDeletedThisMonth });
}));

module.exports = router;
module.exports.recordSnapshot = recordSnapshot;
