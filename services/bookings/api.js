// Bookings — calendar slot scheduling.
// Pattern: 1 schedule (kv_store) drives a public booking page at /book/:slug.
// Slots are generated from a weekly availability template + bookings table
// blocks them out. Confirmation email is sent via Resend when configured;
// otherwise the booking is still saved and surfaced in the dashboard.

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label, allowFallback: true });
}

async function ensureBookingsSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id           SERIAL PRIMARY KEY,
      schedule_slug TEXT NOT NULL,
      starts_at    TIMESTAMPTZ NOT NULL,
      duration_min INT NOT NULL,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      phone        TEXT,
      notes        TEXT,
      status       TEXT DEFAULT 'confirmed',     -- confirmed | cancelled
      created_at   TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(schedule_slug, starts_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_confirmed_slot ON bookings(schedule_slug, starts_at) WHERE status='confirmed';
  `);
  try { await addTenantIdColumn('bookings'); }
  catch (e) { console.error('[bookings] addTenantIdColumn:', e.message); }
  // Tenant-scoped double-book guard: two tenants can each operate a schedule
  // with the same slug independently. Create-first-then-drop legacy.
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_tenant_confirmed_slot
                        ON bookings (tenant_id, schedule_slug, starts_at) WHERE status='confirmed'`);
    await pool.query(`DROP INDEX IF EXISTS uq_bookings_confirmed_slot`);
  } catch (e) { console.error('[bookings] uniq migrate:', e.message); }
}
ensureBookingsSchema().catch(e => console.error('[bookings] schema:', e.message));

const DEFAULT_SCHEDULE = {
  slug: 'default',
  title: '30-min discovery call',
  description: 'Pick a time and we\'ll send you a calendar invite.',
  durationMin: 30,
  bufferMin: 10,
  timezone: 'Africa/Johannesburg',
  weekly: { 1:['09:00','10:00','11:00','14:00','15:00'], 2:['09:00','10:00','11:00','14:00','15:00'], 3:['09:00','10:00','11:00','14:00','15:00'], 4:['09:00','10:00','11:00','14:00','15:00'], 5:['09:00','10:00','11:00'] },
  blockedDates: [],
  notifyEmail: '',
};

// Schedule kv is keyed publicly by slug (so /book/:slug works), but every
// stored blob carries tenant_id so we can: (a) reject slug-squatting between
// tenants, (b) stamp the right tenant_id onto each booking row.
const _kvKey = slug => `bookings:schedule:${slug}`;

router.get('/schedule/:slug', async (req, res) => {
  const sched = await _db.kvGet(_kvKey(req.params.slug), null);
  // Authenticated dashboard reads must not leak another tenant's slug config.
  // Blob carries tenant_id; if caller resolves to a tenant and the blob is
  // stamped to a different one, return 404 (don't disclose existence).
  if (sched && Number.isFinite(+sched.tenant_id)) {
    const tid = await _tid(req, 'bookings:get-schedule');
    if (+sched.tenant_id !== tid) return _err(res, 404, 'schedule not found');
  }
  res.json({ ok:true, schedule: sched || DEFAULT_SCHEDULE });
});

router.post('/schedule/:slug', async (req, res) => {
  const tid = await _tid(req, 'bookings:save-schedule');
  const existing = await _db.kvGet(_kvKey(req.params.slug), null);
  if (existing && Number.isFinite(+existing.tenant_id) && +existing.tenant_id !== tid) {
    return _err(res, 409, 'Slug already in use by another workspace — pick a different slug.');
  }
  const merged = { ...DEFAULT_SCHEDULE, ...(req.body || {}), slug: req.params.slug, tenant_id: tid };
  await _db.kvSet(_kvKey(req.params.slug), merged);
  res.json({ ok:true, schedule: merged });
});

// ── Slots: produce next-N-days availability minus existing bookings ─────────
router.get('/slots/:slug', async (req, res) => {
  const sched = await _db.kvGet(_kvKey(req.params.slug), null) || DEFAULT_SCHEDULE;
  const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 14));
  const now = new Date();
  const out = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(now); day.setUTCDate(day.getUTCDate() + d);
    const iso = day.toISOString().slice(0, 10);
    if ((sched.blockedDates || []).includes(iso)) continue;
    const dow = day.getUTCDay();
    const times = sched.weekly?.[String(dow)] || sched.weekly?.[dow] || [];
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      const dt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm));
      if (dt < now) continue;
      out.push({ iso: dt.toISOString(), date: iso, time: t });
    }
  }
  if (_db.hasDb() && out.length) {
    // Subtract bookings owned by the schedule's tenant (or all if blob is
    // legacy/un-stamped) so a fresh tenant doesn't see another tenant's slots
    // as taken.
    const scopeTid = Number.isFinite(+sched.tenant_id) ? +sched.tenant_id : null;
    const sql = scopeTid != null
      ? `SELECT starts_at FROM bookings WHERE schedule_slug=$1 AND tenant_id=$2 AND status='confirmed' AND starts_at >= now() AND starts_at < now() + ($3 || ' days')::interval`
      : `SELECT starts_at FROM bookings WHERE schedule_slug=$1 AND status='confirmed' AND starts_at >= now() AND starts_at < now() + ($2 || ' days')::interval`;
    const params = scopeTid != null ? [req.params.slug, scopeTid, days] : [req.params.slug, days];
    const r = await _db.getPool().query(sql, params);
    const taken = new Set(r.rows.map(row => new Date(row.starts_at).toISOString()));
    for (let i = out.length - 1; i >= 0; i--) if (taken.has(out[i].iso)) out.splice(i, 1);
  }
  res.json({ ok:true, slots: out, schedule: { title: sched.title, durationMin: sched.durationMin, timezone: sched.timezone, description: sched.description } });
});

// ── Public booking endpoint ──────────────────────────────────────────────────
router.post('/book/:slug', async (req, res) => {
  const { startsAt, name, email, phone = '', notes = '' } = req.body || {};
  if (!startsAt || !name || !email) return _err(res, 400, 'startsAt, name, email required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return _err(res, 400, 'Invalid email');
  if (String(name).length > 200 || String(notes).length > 2000) return _err(res, 400, 'Field too long');
  const dt = new Date(startsAt);
  if (isNaN(dt.getTime())) return _err(res, 400, 'Invalid startsAt');
  if (dt.getTime() < Date.now() - 60_000) return _err(res, 400, 'Slot is in the past');
  if (!_db.hasDb()) return _err(res, 503, 'Database not available');
  const sched = await _db.kvGet(_kvKey(req.params.slug), null) || DEFAULT_SCHEDULE;
  const day = dt.toISOString().slice(0, 10);
  if ((sched.blockedDates || []).includes(day)) return _err(res, 409, 'Date not available');
  const dow = dt.getUTCDay();
  const allowedTimes = sched.weekly?.[String(dow)] || sched.weekly?.[dow] || [];
  const hhmm = dt.toISOString().slice(11, 16);
  if (!allowedTimes.includes(hhmm)) return _err(res, 409, 'Slot not in published availability');
  // The booking row inherits the schedule blob's tenant_id (public caller has
  // no session); legacy un-stamped blobs default to platform tenant 1.
  const ownerTid = Number.isFinite(+sched.tenant_id) ? +sched.tenant_id : 1;
  try {
    const ins = await _db.getPool().query(
      `INSERT INTO bookings (tenant_id, schedule_slug, starts_at, duration_min, name, email, phone, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ownerTid, req.params.slug, dt.toISOString(), sched.durationMin, name, email, phone, notes]
    );
    _sendConfirmation({ schedule: sched, startsAt: dt.toISOString(), name, email, phone, notes }).catch(e => console.warn('[bookings email]', e.message));
    res.json({ ok:true, bookingId: ins.rows[0].id, confirmedAt: dt.toISOString() });
  } catch (e) {
    if (String(e.code) === '23505') return _err(res, 409, 'Slot just taken — pick another');
    _err(res, 500, e.message);
  }
});

async function _sendConfirmation({ schedule, startsAt, name, email, phone, notes }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const dt = new Date(startsAt);
  const when = dt.toLocaleString('en-GB', { dateStyle:'full', timeStyle:'short', timeZone: schedule.timezone || 'Africa/Johannesburg' });
  const body = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;max-width:560px">
    <h2 style="color:#0066FF">✓ Your booking is confirmed</h2>
    <p>Hi ${name},</p>
    <p>You're booked for <strong>${schedule.title}</strong> on:</p>
    <p style="background:#F0F9FF;padding:12px 16px;border-left:4px solid #0066FF;font-size:16px"><strong>${when}</strong> (${schedule.durationMin} min)</p>
    ${notes ? `<p><strong>Your notes:</strong> ${notes}</p>` : ''}
    <p>You'll receive a calendar invite and meeting link shortly. Reply to this email to reschedule.</p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from:'Bookings <onboarding@resend.dev>', to:[email], subject: `Confirmed: ${schedule.title} — ${when}`, html: body }),
  });
  if (schedule.notifyEmail) {
    await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ from:'Bookings <onboarding@resend.dev>', to:[schedule.notifyEmail],
        subject: `New booking: ${name} on ${when}`,
        html: `<p>${name} (${email}${phone ? ', '+phone : ''}) booked ${schedule.title} for <strong>${when}</strong>.</p>${notes ? `<p>Notes: ${notes}</p>` : ''}` }),
    });
  }
}

router.get('/list/:slug', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, bookings: [] });
  const tid = await _tid(req, 'bookings:list');
  const r = await _db.getPool().query(
    `SELECT id, starts_at, duration_min, name, email, phone, notes, status, created_at
       FROM bookings WHERE schedule_slug=$1 AND tenant_id=$2 ORDER BY starts_at DESC LIMIT 200`,
    [req.params.slug, tid]
  );
  res.json({ ok:true, bookings: r.rows });
});

router.post('/cancel/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'No DB');
  const tid = await _tid(req, 'bookings:cancel');
  const r = await _db.getPool().query(
    `UPDATE bookings SET status='cancelled' WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  if (!r.rowCount) return _err(res, 404, 'booking not found');
  res.json({ ok:true });
});

module.exports = router;
