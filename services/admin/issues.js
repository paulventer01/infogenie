// services/admin/issues.js — Code-driven issue reporting (Task 10)
//
// raiseIssue() is the single entry point any backend code calls when it detects
// a problem worth surfacing to the platform admin (e.g. strict-mode data
// fabrication caught by the enforcement layer, a failing integration, etc.).
//
// Dedupe + rate-limiting:
//   • Open issues are unique per (tenant_id, dedupe_key) via a partial unique
//     index. A repeat bumps occurrence_count + last_seen_at instead of
//     inserting — so a flapping problem produces ONE inbox row, not thousands.
//   • Email alerts are batched: new issues queue into memory and flush as a
//     single digest (max one email per FLUSH_MS window), so a burst of distinct
//     issues can't fan out into an email storm.

const crypto = require('crypto');
const _db = require('../../db');
const { NOTIFY_RECIPIENTS_KEY } = require('./schema');

const FLUSH_MS = 60_000;          // batch window for email digests
const MAX_BATCH = 25;             // cap issues listed per email

let _pending = [];                // queued {title, severity, source, tenantId, occurrence}
let _flushTimer = null;
let _lastFlush = 0;

function _sev(s) {
  return ['info', 'warning', 'error', 'critical'].includes(s) ? s : 'warning';
}

function _dedupeKey({ source, code, dedupeKey, clientId }) {
  if (dedupeKey) return String(dedupeKey).slice(0, 200);
  const basis = [source || 'unknown', code || '', clientId || ''].join('|');
  return crypto.createHash('sha1').update(basis).digest('hex');
}

// Raise (or coalesce) an issue. Best-effort; never throws into callers.
// Returns { ok, id, deduped } or { ok:false } on failure.
async function raiseIssue(opts = {}) {
  try {
    if (!_db.hasDb()) return { ok: false, reason: 'no_db' };
    let tenantId = opts.tenantId;
    if (!tenantId) {
      // Attribute platform-level issues to the default tenant so the row stays
      // valid under multitenant enforcement (tenant_id NOT NULL).
      try { tenantId = await require('../tenants/context').getCronTenantId(); } catch (_) {}
    }
    if (!tenantId) return { ok: false, reason: 'no_tenant' };

    const p = _db.getPool();
    const severity = _sev(opts.severity);
    const source = String(opts.source || 'system').slice(0, 80);
    const code = opts.code ? String(opts.code).slice(0, 120) : null;
    const title = String(opts.title || 'Issue detected').slice(0, 240);
    const detail = opts.detail != null ? String(opts.detail).slice(0, 2000) : null;
    const route = opts.route ? String(opts.route).slice(0, 240) : null;
    const clientId = Number.isInteger(opts.clientId) ? opts.clientId : null;
    const dedupeKey = _dedupeKey({ source, code, dedupeKey: opts.dedupeKey, clientId });
    let context = {};
    try { context = opts.context && typeof opts.context === 'object' ? opts.context : {}; } catch (_) {}

    // Try to coalesce into an existing open issue first.
    const upd = await p.query(`
      UPDATE issues
         SET occurrence_count = occurrence_count + 1,
             last_seen_at = now(),
             severity = $3,
             detail = COALESCE($4, detail)
       WHERE tenant_id = $1 AND dedupe_key = $2 AND status = 'open'
       RETURNING id`,
      [tenantId, dedupeKey, severity, detail]);
    if (upd.rows[0]) return { ok: true, id: upd.rows[0].id, deduped: true };

    const ins = await p.query(`
      INSERT INTO issues (tenant_id, client_id, dedupe_key, severity, source, code, title, detail, context, route)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
      RETURNING id`,
      [tenantId, clientId, dedupeKey, severity, source, code, title, detail, JSON.stringify(context), route]);
    const id = ins.rows[0].id;

    _queueEmail({ id, title, severity, source, tenantId, route });
    return { ok: true, id, deduped: false };
  } catch (e) {
    console.warn('[admin/issues] raiseIssue failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

function _queueEmail(item) {
  _pending.push(item);
  if (_pending.length >= MAX_BATCH) return _flushEmails();
  if (!_flushTimer) {
    const wait = Math.max(1000, FLUSH_MS - (Date.now() - _lastFlush));
    _flushTimer = setTimeout(_flushEmails, wait);
    if (_flushTimer.unref) _flushTimer.unref();
  }
}

async function _recipients() {
  // Explicit override list wins; otherwise email every platform owner/admin.
  try {
    const override = await _db.kvGet(NOTIFY_RECIPIENTS_KEY, null);
    if (Array.isArray(override) && override.length) return override.filter(Boolean);
  } catch (_) {}
  try {
    const r = await _db.getPool().query(`
      SELECT DISTINCT u.email
        FROM users u
        LEFT JOIN platform_users pu ON pu.user_id = u.id
        LEFT JOIN roles r ON r.id = pu.role_id
       WHERE u.is_owner = TRUE
          OR r.key IN ('platform_owner','platform_admin')`);
    return r.rows.map(x => x.email).filter(Boolean);
  } catch (e) {
    console.warn('[admin/issues] recipient lookup failed:', e.message);
    return [];
  }
}

async function _sendMail(to, subject, html, text) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('[admin/issues] RESEND_API_KEY missing — alert not sent'); return; }
  const from = process.env.RESEND_FROM_EMAIL || 'InfoGenie <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Resend ${r.status}: ${t.slice(0, 200)}`); }
}

async function _flushEmails() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  _lastFlush = Date.now();
  const batch = _pending.splice(0, MAX_BATCH);
  if (!batch.length) return;
  try {
    const recipients = await _recipients();
    if (!recipients.length) return;
    const esc = s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const rows = batch.map(b =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${esc(b.severity).toUpperCase()}</strong></td>`
      + `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(b.title)}</td>`
      + `<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#6B7280">${esc(b.source)}${b.route ? ' · ' + esc(b.route) : ''}</td></tr>`
    ).join('');
    const subject = batch.length === 1
      ? `InfoGenie issue: ${batch[0].title.slice(0, 80)}`
      : `InfoGenie: ${batch.length} new issues reported`;
    const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:auto;padding:24px">
      <h2 style="color:#0066FF;margin:0 0 6px">${batch.length} new issue${batch.length > 1 ? 's' : ''} reported</h2>
      <p style="color:#6B7280;margin:0 0 16px">Open the Admin Portal → Issues inbox to acknowledge or resolve.</p>
      <table style="border-collapse:collapse;width:100%;font-size:0.9rem"><tbody>${rows}</tbody></table>
    </div>`;
    const text = batch.map(b => `[${b.severity.toUpperCase()}] ${b.title} (${b.source})`).join('\n');
    await _sendMail(recipients, subject, html, text);
    console.log(`[admin/issues] alert sent — ${batch.length} issue(s) to ${recipients.length} recipient(s)`);
  } catch (e) {
    console.warn('[admin/issues] email flush failed:', e.message);
  }
}

module.exports = { raiseIssue, _flushEmails };
