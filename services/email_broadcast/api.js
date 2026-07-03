const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const crypto  = require('crypto');
const _tenantCtx = require('../tenants/context');

const _err = (res, code, msg) => res.status(code).json({ ok:false, error: msg });

function _pool() { return _db.getPool(); }
function _hasDb() { return _db.hasDb(); }

// ── Resend send helper (reuse existing env vars) ──────────────────────────────
async function _sendEmail({ to, toName, subject, html, text, fromName, fromEmail, broadcastId, recipientId }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');
  const from = fromEmail
    ? `${fromName || 'InfoGenie'} <${fromEmail}>`
    : (process.env.RESEND_FROM_EMAIL || 'InfoGenie <onboarding@resend.dev>');
  const body = {
    from,
    to: toName ? [`${toName} <${to}>`] : [to],
    subject,
    html: html || undefined,
    text: text || undefined,
    tags: [
      { name: 'broadcast_id', value: String(broadcastId) },
      { name: 'recipient_id', value: String(recipientId) }
    ]
  };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.message || data?.name || JSON.stringify(data));
  return data.id; // Resend message ID
}

// ── List broadcasts ───────────────────────────────────────────────────────────
router.get('/broadcasts', async (req, res) => {
  if (!_hasDb()) return res.json({ ok:true, broadcasts:[], note:'Database not configured.' });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:list' });
    const { rows } = await _pool().query(
      `SELECT id,name,subject,from_name,from_email,status,recipient_count,sent_count,
              open_count,click_count,bounce_count,complaint_count,unsubscribe_count,
              created_at,sent_at
       FROM email_broadcasts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [tid]
    );
    res.json({ ok:true, broadcasts: rows });
  } catch(e) { _err(res, 500, e.message); }
});

// ── Create draft broadcast ────────────────────────────────────────────────────
router.post('/broadcasts', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const { name, subject, from_name, from_email, body_html, body_text } = req.body || {};
  if (!name) return _err(res, 400, 'name required');
  if (!subject) return _err(res, 400, 'subject required');
  if (!body_html && !body_text) return _err(res, 400, 'body_html or body_text required');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:create' });
    const { rows } = await _pool().query(
      `INSERT INTO email_broadcasts (tenant_id,name,subject,from_name,from_email,body_html,body_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, name, subject, from_name || 'InfoGenie', from_email || '', body_html || '', body_text || '']
    );
    res.json({ ok:true, broadcast: rows[0] });
  } catch(e) { _err(res, 500, e.message); }
});

// ── Get single broadcast with stats ──────────────────────────────────────────
router.get('/broadcasts/:id', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:get' });
    const { rows } = await _pool().query('SELECT * FROM email_broadcasts WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rows.length) return _err(res, 404, 'broadcast not found');
    const bc = rows[0];
    // Compute open/click/bounce rates
    const s = bc.sent_count || 0;
    bc.open_rate    = s > 0 ? Number(((bc.open_count / s) * 100).toFixed(1)) : 0;
    bc.click_rate   = s > 0 ? Number(((bc.click_count / s) * 100).toFixed(1)) : 0;
    bc.bounce_rate  = s > 0 ? Number(((bc.bounce_count / s) * 100).toFixed(1)) : 0;
    bc.delivery_rate = s > 0 ? Number((((s - bc.bounce_count) / s) * 100).toFixed(1)) : 0;
    res.json({ ok:true, broadcast: bc });
  } catch(e) { _err(res, 500, e.message); }
});

// ── Update draft broadcast ────────────────────────────────────────────────────
router.put('/broadcasts/:id', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const { name, subject, from_name, from_email, body_html, body_text } = req.body || {};
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:update' });
    const { rows } = await _pool().query('SELECT status FROM email_broadcasts WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rows.length) return _err(res, 404, 'broadcast not found');
    if (rows[0].status !== 'draft') return _err(res, 400, 'only draft broadcasts can be edited');
    await _pool().query(
      `UPDATE email_broadcasts SET name=COALESCE($1,name), subject=COALESCE($2,subject),
       from_name=COALESCE($3,from_name), from_email=COALESCE($4,from_email),
       body_html=COALESCE($5,body_html), body_text=COALESCE($6,body_text) WHERE id=$7 AND tenant_id=$8`,
      [name, subject, from_name, from_email, body_html, body_text, id, tid]
    );
    const { rows: r2 } = await _pool().query('SELECT * FROM email_broadcasts WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.json({ ok:true, broadcast: r2[0] });
  } catch(e) { _err(res, 500, e.message); }
});

// ── Delete broadcast ──────────────────────────────────────────────────────────
router.delete('/broadcasts/:id', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:delete' });
    await _pool().query('DELETE FROM email_broadcasts WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.json({ ok:true });
  } catch(e) { _err(res, 500, e.message); }
});

// ── Add recipients (JSON array or CSV text) ───────────────────────────────────
router.post('/broadcasts/:id/recipients', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  // Accept: { emails: [{email,name?}] } or { csv: "email,name\n..." }
  let list = [];
  if (Array.isArray(req.body?.emails)) {
    list = req.body.emails.map(r => ({
      email: String(r.email || r).trim().toLowerCase(),
      name: String(r.name || r.first_name || '').trim()
    }));
  } else if (typeof req.body?.csv === 'string') {
    const lines = req.body.csv.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(',');
      const email = (parts[0] || '').trim().toLowerCase();
      const name  = (parts[1] || '').trim().replace(/^["']|["']$/g, '');
      if (email) list.push({ email, name });
    }
  }
  list = list.filter(r => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)).slice(0, 50000);
  if (!list.length) return _err(res, 400, 'no valid email addresses found');

  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:add-recipients' });
    const { rows: bc } = await _pool().query('SELECT status, tenant_id FROM email_broadcasts WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!bc.length) return _err(res, 404, 'broadcast not found');
    if (bc[0].status !== 'draft') return _err(res, 400, 'can only add recipients to a draft broadcast');

    let added = 0;
    for (const r of list) {
      const { rowCount } = await _pool().query(
        `INSERT INTO email_broadcast_recipients (tenant_id, broadcast_id, email, name)
         VALUES ($1,$2,$3,$4) ON CONFLICT (broadcast_id, email) DO NOTHING`,
        [bc[0].tenant_id, id, r.email, r.name]
      );
      added += rowCount;
    }
    await _pool().query(
      `UPDATE email_broadcasts SET recipient_count=(
         SELECT COUNT(*) FROM email_broadcast_recipients WHERE broadcast_id=$1 AND tenant_id=$2
       ) WHERE id=$1 AND tenant_id=$2`, [id, tid]
    );
    res.json({ ok:true, added, total: list.length });
  } catch(e) { _err(res, 500, e.message); }
});

// ── List recipients ───────────────────────────────────────────────────────────
router.get('/broadcasts/:id/recipients', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const id = parseInt(req.params.id, 10);
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  const statusFilter = req.query.status;
  const allowed = ['queued','sent','opened','clicked','bounced','complained','unsubscribed'];
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:recipients' });
    const params = [id, limit, offset, tid];
    let where = '';
    if (statusFilter && allowed.includes(statusFilter)) {
      where = ` AND status=$5`;
      params.push(statusFilter);
    }
    const { rows } = await _pool().query(
      `SELECT id,email,name,status,sent_at,opened_at,clicked_at,bounced_at FROM email_broadcast_recipients
       WHERE broadcast_id=$1 AND tenant_id=$4 ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      params
    );
    const hasStatus = statusFilter && allowed.includes(statusFilter);
    const { rows: cnt } = await _pool().query(
      `SELECT COUNT(*) AS total FROM email_broadcast_recipients WHERE broadcast_id=$1 AND tenant_id=$2${hasStatus ? ' AND status=$3' : ''}`,
      hasStatus ? [id, tid, statusFilter] : [id, tid]
    );
    res.json({ ok:true, recipients: rows, total: parseInt(cnt[0].total, 10) });
  } catch(e) { _err(res, 500, e.message); }
});

// ── Send broadcast ────────────────────────────────────────────────────────────
router.post('/broadcasts/:id/send', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:send' });
    const { rows } = await _pool().query('SELECT * FROM email_broadcasts WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rows.length) return _err(res, 404, 'broadcast not found');
    const bc = rows[0];
    if (!['draft','paused'].includes(bc.status)) return _err(res, 400, `Cannot send a broadcast in '${bc.status}' status.`);
    if (!process.env.RESEND_API_KEY) return _err(res, 503, 'RESEND_API_KEY not configured — add it in Settings.');

    // Mark as sending immediately; respond to client; fan-out in background
    await _pool().query(`UPDATE email_broadcasts SET status='sending', sent_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    res.json({ ok:true, message: 'Broadcast queued — emails are sending in the background.' });

    // Background fan-out (async, no await from the route). tid captured in the
    // closure keeps every write tenant-scoped even though we've left the request.
    ;(async () => {
      try {
        const BATCH = 5; // max 5 concurrent Resend sends
        const { rows: recips } = await _pool().query(
          `SELECT id,email,name FROM email_broadcast_recipients WHERE broadcast_id=$1 AND status='queued' AND tenant_id=$2`,
          [id, tid]
        );
        for (let i = 0; i < recips.length; i += BATCH) {
          const chunk = recips.slice(i, i + BATCH);
          await Promise.allSettled(chunk.map(async r => {
            try {
              const msgId = await _sendEmail({
                to: r.email, toName: r.name,
                subject: bc.subject, html: bc.body_html, text: bc.body_text,
                fromName: bc.from_name, fromEmail: bc.from_email,
                broadcastId: id, recipientId: r.id
              });
              await _pool().query(
                `UPDATE email_broadcast_recipients SET status='sent', resend_message_id=$1, sent_at=now() WHERE id=$2 AND tenant_id=$3`,
                [msgId, r.id, tid]
              );
              await _pool().query(
                `UPDATE email_broadcasts SET sent_count=sent_count+1 WHERE id=$1 AND tenant_id=$2`, [id, tid]
              );
            } catch(sendErr) {
              console.warn(`[email-broadcast] send failed for ${r.email}:`, sendErr.message);
              await _pool().query(
                `UPDATE email_broadcast_recipients SET status='bounced', bounced_at=now() WHERE id=$1 AND tenant_id=$2`, [r.id, tid]
              );
              await _pool().query(
                `UPDATE email_broadcasts SET bounce_count=bounce_count+1 WHERE id=$1 AND tenant_id=$2`, [id, tid]
              );
            }
          }));
          // Tiny pause between batches to respect Resend rate limits
          if (i + BATCH < recips.length) await new Promise(r => setTimeout(r, 200));
        }
        await _pool().query(`UPDATE email_broadcasts SET status='sent' WHERE id=$1 AND tenant_id=$2`, [id, tid]);
      } catch(err) {
        console.error('[email-broadcast] fan-out error:', err.message);
      }
    })();
  } catch(e) { _err(res, 500, e.message); }
});

// ── Stats (open/click/bounce rates) ──────────────────────────────────────────
router.get('/broadcasts/:id/stats', async (req, res) => {
  if (!_hasDb()) return _err(res, 503, 'Database not configured.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email_broadcast:stats' });
    const { rows } = await _pool().query('SELECT * FROM email_broadcasts WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rows.length) return _err(res, 404, 'broadcast not found');
    const bc = rows[0];
    const s = bc.sent_count || 0;
    // Status breakdown
    const { rows: breakdown } = await _pool().query(
      `SELECT status, COUNT(*) AS cnt FROM email_broadcast_recipients WHERE broadcast_id=$1 AND tenant_id=$2 GROUP BY status`,
      [id, tid]
    );
    const byStatus = {};
    for (const r of breakdown) byStatus[r.status] = parseInt(r.cnt, 10);

    res.json({
      ok: true,
      id: bc.id,
      name: bc.name,
      subject: bc.subject,
      status: bc.status,
      sent_at: bc.sent_at,
      recipient_count: bc.recipient_count,
      sent_count: s,
      open_count: bc.open_count,
      click_count: bc.click_count,
      bounce_count: bc.bounce_count,
      complaint_count: bc.complaint_count,
      unsubscribe_count: bc.unsubscribe_count,
      open_rate:    s > 0 ? Number(((bc.open_count / s) * 100).toFixed(1)) : 0,
      click_rate:   s > 0 ? Number(((bc.click_count / s) * 100).toFixed(1)) : 0,
      bounce_rate:  s > 0 ? Number(((bc.bounce_count / s) * 100).toFixed(1)) : 0,
      delivery_rate: s > 0 ? Number((((s - bc.bounce_count) / s) * 100).toFixed(1)) : 0,
      by_status: byStatus
    });
  } catch(e) { _err(res, 500, e.message); }
});

// ── Resend webhook (email.opened / email.clicked / email.bounced / email.complained) ──
// This path must be in the public allowlist in server.js (no auth required).
// Uses the same Svix-style signature verification as the drip webhook.
router.post('/webhook', async (req, res) => {
  // Signature verification (same logic as drip webhook)
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const id        = req.get('svix-id') || req.get('webhook-id');
    const timestamp = req.get('svix-timestamp') || req.get('webhook-timestamp');
    const sigHeader = req.get('svix-signature') || req.get('webhook-signature');
    if (!id || !timestamp || !sigHeader) {
      return res.status(401).json({ ok:false, error:'missing signature headers' });
    }
    const tsNum = parseInt(timestamp, 10);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now()/1000 - tsNum) > 300) {
      return res.status(401).json({ ok:false, error:'stale timestamp' });
    }
    const raw = req.rawBody || JSON.stringify(req.body || {});
    const signedPayload = `${id}.${timestamp}.${raw}`;
    const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret);
    const expected = crypto.createHmac('sha256', key).update(signedPayload).digest('base64');
    const sigs = sigHeader.split(' ').map(s => s.split(',')[1]).filter(Boolean);
    const match = sigs.some(s => {
      try { return crypto.timingSafeEqual(Buffer.from(s, 'base64'), Buffer.from(expected, 'base64')); }
      catch { return false; }
    });
    if (!match) return res.status(401).json({ ok:false, error:'signature mismatch' });
  }

  if (!_hasDb()) return res.json({ ok:true, ignored:'no db' });
  const evt  = req.body || {};
  const type = String(evt.type || evt.event || '').toLowerCase();
  const data = evt.data || evt;
  const msgId = data.email_id || data.id || data.message_id;
  if (!msgId) return res.json({ ok:true, ignored:'no message id' });

  try {
    const { rows } = await _pool().query(
      `SELECT id, broadcast_id, tenant_id FROM email_broadcast_recipients WHERE resend_message_id=$1 LIMIT 1`,
      [msgId]
    );
    if (!rows.length) return res.json({ ok:true, matched:0 });
    // Tenant is derived from the matched recipient row (resolved via the
    // globally-unique Resend message id) — the webhook itself has no session.
    const { id: recipId, broadcast_id: broadcastId, tenant_id: tid } = rows[0];

    if (type.includes('opened') || type.includes('open')) {
      await _pool().query(
        `UPDATE email_broadcast_recipients SET status='opened', opened_at=COALESCE(opened_at,now()) WHERE id=$1 AND tenant_id=$2`, [recipId, tid]
      );
      await _pool().query(
        `UPDATE email_broadcasts SET open_count=open_count+1 WHERE id=$1 AND tenant_id=$3 AND NOT EXISTS (
           SELECT 1 FROM email_broadcast_recipients WHERE id=$2 AND tenant_id=$3 AND opened_at IS NOT NULL AND opened_at < now()
         )`, [broadcastId, recipId, tid]
      );
      // Simpler: just increment (Resend may fire multiple opens — acceptable for now)
      await _pool().query(`UPDATE email_broadcasts SET open_count=open_count+1 WHERE id=$1 AND tenant_id=$2`, [broadcastId, tid]);
    } else if (type.includes('clicked') || type.includes('click')) {
      await _pool().query(
        `UPDATE email_broadcast_recipients SET status='clicked', clicked_at=COALESCE(clicked_at,now()) WHERE id=$1 AND tenant_id=$2`, [recipId, tid]
      );
      await _pool().query(`UPDATE email_broadcasts SET click_count=click_count+1 WHERE id=$1 AND tenant_id=$2`, [broadcastId, tid]);
    } else if (type.includes('bounced') || type.includes('bounce')) {
      await _pool().query(
        `UPDATE email_broadcast_recipients SET status='bounced', bounced_at=COALESCE(bounced_at,now()) WHERE id=$1 AND tenant_id=$2`, [recipId, tid]
      );
      await _pool().query(`UPDATE email_broadcasts SET bounce_count=bounce_count+1 WHERE id=$1 AND tenant_id=$2`, [broadcastId, tid]);
    } else if (type.includes('complain')) {
      await _pool().query(
        `UPDATE email_broadcast_recipients SET status='complained' WHERE id=$1 AND tenant_id=$2`, [recipId, tid]
      );
      await _pool().query(`UPDATE email_broadcasts SET complaint_count=complaint_count+1 WHERE id=$1 AND tenant_id=$2`, [broadcastId, tid]);
    }
    res.json({ ok:true, matched:1 });
  } catch(e) {
    console.error('[email-broadcast] webhook error:', e.message);
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ── GET /api/email-broadcast/analytics ───────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-broadcast:analytics' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const pool = _pool();
    const { rows } = await pool.query(
      `SELECT id, name, subject, status, recipient_count, sent_count,
              open_count, click_count, bounce_count, complaint_count, unsubscribe_count,
              created_at, sent_at
       FROM email_broadcasts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [tid]
    );
    const totals = rows.reduce((acc, b) => ({
      campaigns: acc.campaigns + 1,
      sent: acc.sent + (b.sent_count || 0),
      opens: acc.opens + (b.open_count || 0),
      clicks: acc.clicks + (b.click_count || 0),
      bounces: acc.bounces + (b.bounce_count || 0),
      unsubscribes: acc.unsubscribes + (b.unsubscribe_count || 0),
    }), { campaigns: 0, sent: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 });
    res.json({ ok: true, broadcasts: rows, totals });
  } catch (e) {
    console.error('[email-broadcast] analytics error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
