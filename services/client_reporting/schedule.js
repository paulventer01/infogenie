'use strict';

const delivery = require('./delivery');
const snapshot = require('./snapshot');
const _audit = require('../admin/audit');

const SAFE_ERRORS = new Set([
  'mail_unconfigured', 'mail_failed', 'no_recipient', 'profile_required',
  'no_mapped_records', 'client_not_found', 'recipient_disabled', 'schedule_paused',
  'not_opted_in', 'version_conflict', 'invalid_profile', 'claim_conflict',
]);

function validTimezone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); return true; }
  catch { return false; }
}

function parseSendTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(pick('year')), month: Number(pick('month')), day: Number(pick('day')),
    hour: Number(pick('hour')), minute: Number(pick('minute')), weekday: pick('weekday'),
  };
}

function isoWeekKey(year, month, day, timezone) {
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const thursday = new Date(noon);
  thursday.setUTCDate(noon.getUTCDate() + ((4 - thursday.getUTCDay() + 7) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  const isoYear = thursday.getUTCFullYear();
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function windowKey(cadence, date, timezone) {
  const { year, month, day } = zonedParts(date, timezone);
  if (cadence === 'weekly') return `weekly:${isoWeekKey(year, month, day, timezone)}`;
  return `monthly:${year}-${String(month).padStart(2, '0')}`;
}

function slotTimestamp(parts, timezone, sendTime) {
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, sendTime.hour, sendTime.minute));
  for (const offsetHours of [0, -12, 12]) {
    const probe = new Date(guess.getTime() + offsetHours * 3600000);
    const local = zonedParts(probe, timezone);
    if (local.year === parts.year && local.month === parts.month && local.day === parts.day
      && local.hour === sendTime.hour && local.minute === sendTime.minute) return probe;
  }
  return guess;
}

function computeNextDueAt(cadence, timezone, sendTime, fromDate = new Date()) {
  const send = parseSendTime(sendTime);
  if (!send) return null;
  const local = zonedParts(fromDate, timezone);
  let target = { year: local.year, month: local.month, day: local.day };
  if (cadence === 'monthly') target.day = 1;
  if (cadence === 'weekly') {
    const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    const current = weekdays[local.weekday] ?? 1;
    const delta = (1 - current + 7) % 7;
    const base = new Date(Date.UTC(local.year, local.month - 1, local.day));
    base.setUTCDate(base.getUTCDate() + delta);
    target = { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
  }
  let due = slotTimestamp(target, timezone, send);
  if (due <= fromDate) {
    if (cadence === 'weekly') due = new Date(due.getTime() + 7 * 86400000);
    else {
      const nextMonth = target.month === 12 ? { year: target.year + 1, month: 1 } : { year: target.year, month: target.month + 1 };
      due = slotTimestamp({ ...nextMonth, day: 1 }, timezone, send);
    }
  }
  return due;
}

async function recordDelivery(client, entry) {
  await client.query(`INSERT INTO client_reporting_delivery_history
    (tenant_id, client_id, window_key, status, recipient_email, profile_version, format, error_code)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    entry.tenantId, entry.clientId, entry.windowKey, entry.status, entry.recipient || null,
    entry.profileVersion ?? null, entry.format || null, entry.errorCode || null,
  ]);
}

async function processScheduleClaim(pool, row) {
  const tenantId = Number(row.tenant_id), clientId = Number(row.client_id);
  const window = windowKey(row.cadence, new Date(row.next_due_at), row.timezone);
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const claim = await connection.query(`INSERT INTO client_reporting_schedule_claims (tenant_id, client_id, window_key)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING window_key`, [tenantId, clientId, window]);
    if (!claim.rows[0]) {
      await connection.query(`UPDATE client_reporting_schedules SET next_due_at=$4, updated_at=now()
        WHERE tenant_id=$1 AND client_id=$2 AND next_due_at=$3`,
        [tenantId, clientId, row.next_due_at, computeNextDueAt(row.cadence, row.timezone, row.send_time, new Date(row.next_due_at))]);
      await connection.query('COMMIT');
      return { skipped: true, reason: 'claim_conflict' };
    }
    const tenant = await connection.query('SELECT id, status FROM tenants WHERE id=$1', [tenantId]);
    if (!tenant.rows[0] || tenant.rows[0].status !== 'active') {
      await recordDelivery(connection, { tenantId, clientId, windowKey: window, status: 'skipped', errorCode: 'tenant_inactive' });
      const nextDue = computeNextDueAt(row.cadence, row.timezone, row.send_time, new Date(row.next_due_at));
      await connection.query(`UPDATE client_reporting_schedules SET next_due_at=$3, updated_at=now()
        WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId, nextDue]);
      await connection.query('COMMIT');
      return { skipped: true, reason: 'tenant_inactive' };
    }
    if (!row.opted_in || row.paused) {
      await recordDelivery(connection, { tenantId, clientId, windowKey: window, status: 'skipped',
        errorCode: row.paused ? 'schedule_paused' : 'not_opted_in' });
      const nextDue = computeNextDueAt(row.cadence, row.timezone, row.send_time, new Date(row.next_due_at));
      await connection.query(`UPDATE client_reporting_schedules SET next_due_at=$3, updated_at=now()
        WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId, nextDue]);
      await connection.query('COMMIT');
      return { skipped: true, reason: row.paused ? 'schedule_paused' : 'not_opted_in' };
    }
    const recipientRow = await connection.query(`SELECT email, enabled FROM client_reporting_recipients
      WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
    const recipient = recipientRow.rows[0];
    if (!recipient?.enabled || !recipient.email) {
      await recordDelivery(connection, { tenantId, clientId, windowKey: window, status: 'failed',
        errorCode: recipient ? 'recipient_disabled' : 'no_recipient' });
      const nextDue = computeNextDueAt(row.cadence, row.timezone, row.send_time, new Date(row.next_due_at));
      await connection.query(`UPDATE client_reporting_schedules SET next_due_at=$3, updated_at=now()
        WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId, nextDue]);
      await connection.query('COMMIT');
      return { failed: true, errorCode: recipient ? 'recipient_disabled' : 'no_recipient' };
    }
    await connection.query('COMMIT');
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch (_) {}
    connection.release();
    throw error;
  }
  connection.release();

  let result = { tenantId, clientId, window, recipient: null, profileVersion: null, format: row.format, status: 'failed', errorCode: 'internal_error' };
  const sendClient = await pool.connect();
  try {
    const built = await snapshot.buildReportSnapshot(sendClient, tenantId, clientId);
    const profileVersion = built.profile.version;
    const format = row.format || built.profile.default_format;
    const recipientEmail = (await sendClient.query(`SELECT email FROM client_reporting_recipients
      WHERE tenant_id=$1 AND client_id=$2 AND enabled=true`, [tenantId, clientId])).rows[0]?.email;
    if (!recipientEmail) {
      result.errorCode = 'no_recipient';
      await recordDelivery(sendClient, { tenantId, clientId, windowKey: window, status: 'failed', errorCode: 'no_recipient' });
      return result;
    }
    if (!built.snapshot.can_generate) {
      result.errorCode = 'no_mapped_records';
      await recordDelivery(sendClient, { tenantId, clientId, windowKey: window, status: 'failed',
        recipient: recipientEmail, profileVersion, format, errorCode: 'no_mapped_records' });
      return result;
    }
    const reportSnapshot = { ...built.snapshot, format };
    const { buffer, filename, contentType } = await delivery.bufferReport(reportSnapshot);
    const subject = `${reportSnapshot.report.title} — ${reportSnapshot.client.name}`;
    const text = `Attached is the ${format.toUpperCase()} report "${reportSnapshot.report.title}" for ${reportSnapshot.client.name}.`;
    const html = `<div style="font-family:sans-serif;max-width:560px;line-height:1.6">
      <p>Attached is the <strong>${format.toUpperCase()}</strong> report <strong>${reportSnapshot.report.title}</strong> for ${reportSnapshot.client.name}.</p>
      <p style="color:#64748B;font-size:13px">Scheduled delivery from the saved client reporting profile (version ${profileVersion}).</p>
    </div>`;
    try {
      await delivery.sendReportEmail({ to: recipientEmail, subject, html, text, filename, content: buffer, contentType });
      result = { tenantId, clientId, window, recipient: recipientEmail, profileVersion, format, status: 'sent', errorCode: null };
      await recordDelivery(sendClient, { tenantId, clientId, windowKey: window, status: 'sent',
        recipient: recipientEmail, profileVersion, format });
    } catch (error) {
      const code = SAFE_ERRORS.has(error.code) ? error.code : (error.code === 'mail_unconfigured' || error.code === 'mail_failed' ? error.code : 'mail_failed');
      result.errorCode = code;
      await recordDelivery(sendClient, { tenantId, clientId, windowKey: window, status: 'failed',
        recipient: recipientEmail, profileVersion, format, errorCode: code });
    }
  } finally {
    const nextDue = computeNextDueAt(row.cadence, row.timezone, row.send_time, new Date(row.next_due_at));
    await pool.query(`UPDATE client_reporting_schedules SET next_due_at=$3, updated_at=now()
      WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId, nextDue]);
    sendClient.release();
  }
  await _audit.recordAudit({
    action: 'client_reporting.schedule_send', actorUserId: null, actorEmail: 'system',
    tenantId, detail: `Client ${clientId} ${result.status} window ${window}`,
    context: { client_id: clientId, window_key: window, status: result.status, error_code: result.errorCode || null,
      profile_version: result.profileVersion, format: result.format },
  });
  return result;
}

let _cronTimer = null;
async function processDueSchedules(pool) {
  while (true) {
    const client = await pool.connect();
    let row = null;
    try {
      await client.query('BEGIN');
      const due = await client.query(`SELECT s.* FROM client_reporting_schedules s
        JOIN tenants t ON t.id=s.tenant_id AND t.status='active'
        JOIN clients c ON c.tenant_id=s.tenant_id AND c.id=s.client_id AND c.status='active'
        WHERE s.opted_in=true AND s.paused=false AND s.next_due_at <= now()
        ORDER BY s.next_due_at ASC LIMIT 1 FOR UPDATE OF s SKIP LOCKED`);
      if (!due.rows[0]) { await client.query('COMMIT'); client.release(); break; }
      row = due.rows[0];
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      client.release();
      console.warn('[client-reporting/schedule] claim failed:', error.message);
      break;
    }
    client.release();
    try { await processScheduleClaim(pool, row); }
    catch (error) { console.warn('[client-reporting/schedule] send failed:', error.message); }
  }
}

function startScheduleCron(intervalMs = 60_000) {
  if (_cronTimer) return;
  const _db = require('../../db');
  async function tick() {
    if (!_db.hasDb()) return;
    try { await processDueSchedules(_db.getPool()); } catch (error) {
      console.warn('[client-reporting/schedule] tick failed:', error.message);
    }
  }
  _cronTimer = setInterval(tick, intervalMs);
  console.log('[client-reporting/schedule] cron started');
}

module.exports = {
  SAFE_ERRORS, validTimezone, parseSendTime, computeNextDueAt, windowKey,
  processDueSchedules, startScheduleCron,
};
