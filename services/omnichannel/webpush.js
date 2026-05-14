// Web Push via web-push lib if VAPID keys set, else logs + returns ok-stub.
const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

let _wp = null;
function getLib() {
  if (_wp !== null) return _wp;
  try {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      _wp = require('web-push');
      _wp.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:noreply@infogenie.app',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    } else { _wp = false; }
  } catch (e) { _wp = false; }
  return _wp;
}

async function ensureWebPushSchema() {
  if (!hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webpush_subs (
      endpoint   TEXT PRIMARY KEY,
      keys       JSONB NOT NULL,
      contact    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function subscribe(sub, contact) {
  if (!hasDb()) return { ok: false, error: 'no db' };
  if (!sub?.endpoint || !sub?.keys) throw new Error('invalid subscription');
  await pool.query(
    `INSERT INTO webpush_subs (endpoint, keys, contact) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET keys=EXCLUDED.keys, contact=EXCLUDED.contact`,
    [sub.endpoint, JSON.stringify(sub.keys), contact || null]
  );
  return { ok: true };
}

async function broadcast(title, body, targetSubscription) {
  const wp = getLib();
  const payload = JSON.stringify({ title, body });
  if (targetSubscription?.endpoint) {
    if (!wp) { console.log('[webpush-stub] →', title); return { ok: true, stub: true }; }
    try { await wp.sendNotification(targetSubscription, payload); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  if (!hasDb()) return { ok: false, error: 'no db' };
  const r = await pool.query(`SELECT endpoint, keys FROM webpush_subs LIMIT 500`);
  let sent = 0, failed = 0;
  for (const row of r.rows) {
    if (!wp) { sent++; continue; }
    try {
      await wp.sendNotification({ endpoint: row.endpoint, keys: row.keys }, payload);
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) {
        await pool.query(`DELETE FROM webpush_subs WHERE endpoint=$1`, [row.endpoint]);
      }
    }
  }
  if (!wp) console.log('[webpush-stub] broadcast', title, '→', r.rows.length, 'subs (no VAPID keys)');
  return { ok: true, sent, failed, stub: !wp };
}

module.exports = { ensureWebPushSchema, subscribe, broadcast };
