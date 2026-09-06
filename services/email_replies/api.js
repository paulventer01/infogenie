// Inbound email replies for outreach — Resend Receiving webhook + inbox bridge.
const express = require('express');
const crypto = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) {
  return _tenantCtx.resolveTenantId(req, { label });
}

function _verifySvix(rawBody, headers, secret) {
  if (!secret) return !process.env.NODE_ENV || process.env.NODE_ENV !== 'production';
  try {
    const whId = headers['svix-id'] || headers['webhook-id'];
    const whTs = headers['svix-timestamp'] || headers['webhook-timestamp'];
    const whSig = headers['svix-signature'] || headers['webhook-signature'] || '';
    if (!whId || !whTs || !whSig) return false;
    if (Math.abs(Date.now() / 1000 - Number(whTs)) > 300) return false;
    const key = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice(6), 'base64')
      : Buffer.from(secret);
    const toSign = `${whId}.${whTs}.${rawBody}`;
    const expected = crypto.createHmac('sha256', key).update(toSign).digest('base64');
    return String(whSig).split(' ').some((part) => {
      const sig = part.includes(',') ? part.split(',')[1] : part.replace(/^v1,/, '');
      try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch { return false; }
    });
  } catch {
    return false;
  }
}

function _extractEmail(addr) {
  if (!addr) return '';
  const s = String(addr);
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

async function _matchOutbound(fromEmail, inReplyTo, messageId) {
  // Best-effort: match drip history providerId in KV is hard without scanning all tenants.
  // Prefer broadcast recipients by resend_message_id when In-Reply-To contains it.
  const needle = String(inReplyTo || messageId || '').replace(/[<>]/g, '').trim();
  let matched = { matched_provider_id: null, matched_channel: null, drip_enrollment_id: null, broadcast_recipient_id: null, tenant_id: null };

  if (_db.hasDb() && needle) {
    try {
      const r = await _db.getPool().query(
        `SELECT id, broadcast_id, tenant_id, resend_message_id, email
         FROM email_broadcast_recipients
         WHERE resend_message_id IS NOT NULL
           AND ($1 ILIKE '%' || resend_message_id || '%' OR resend_message_id = $1)
         ORDER BY id DESC LIMIT 1`,
        [needle]
      );
      if (r.rows[0]) {
        matched.matched_provider_id = r.rows[0].resend_message_id;
        matched.matched_channel = 'broadcast';
        matched.broadcast_recipient_id = r.rows[0].id;
        matched.tenant_id = r.rows[0].tenant_id;
      }
    } catch { /* table may not exist yet */ }
  }

  // Drip pause by from-email across active tenants (via global drip store if present).
  try {
    if (typeof global._dripStore?.listActiveTenantIds === 'function' || global._dripLoad) {
      /* handled below via optional helpers stamped by server */
    }
    if (typeof global._pauseDripOnReply === 'function') {
      const paused = await global._pauseDripOnReply(fromEmail, needle);
      if (paused?.enrollmentId) {
        matched.matched_channel = matched.matched_channel || 'drip';
        matched.drip_enrollment_id = paused.enrollmentId;
        matched.matched_provider_id = matched.matched_provider_id || paused.providerId || null;
        matched.tenant_id = matched.tenant_id || paused.tenantId || null;
      }
    }
  } catch (e) {
    console.warn('[email-replies] drip pause:', e.message);
  }
  return matched;
}

async function _ingestInbox(row) {
  try {
    const inbox = require('../unified_inbox/api');
    if (typeof inbox._upsertMany === 'function' && row.tenant_id) {
      await inbox._upsertMany([{
        source: 'email',
        source_id: row.provider_email_id || row.message_id || `reply-${row.id}`,
        source_url: null,
        author: row.from_email,
        title: row.subject || 'Email reply',
        content: row.body_text || '',
        sentiment: null,
        score: null,
        raw: row.raw,
        occurred_at: row.created_at || new Date(),
      }], row.tenant_id);
    }
  } catch (e) {
    console.warn('[email-replies] inbox ingest:', e.message);
  }
}

async function _fireReplySignal(row) {
  try {
    const { fireSignal } = require('../signal_triggers/api');
    await fireSignal('email_replied', {
      tenant_id: row.tenant_id,
      email: row.from_email,
      subject: row.subject,
      message_id: row.message_id,
      matched_channel: row.matched_channel,
    });
  } catch (e) {
    console.warn('[email-replies] fireSignal:', e.message);
  }
}

// Public Resend Receiving webhook (email.received).
router.post('/webhook', async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  const raw = req.rawBody || JSON.stringify(req.body || {});
  if (!_verifySvix(raw, req.headers, secret)) {
    return res.status(401).json({ ok: false, error: 'invalid signature' });
  }
  res.status(200).json({ ok: true });

  try {
    const ev = typeof req.body === 'object' ? req.body : JSON.parse(raw || '{}');
    const type = ev.type || ev.event || '';
    if (type && !/email\.received|inbound|received/i.test(type)) return;

    const data = ev.data || ev;
    const fromEmail = _extractEmail(data.from || data.from_email || data.sender);
    const toEmail = _extractEmail(
      Array.isArray(data.to) ? data.to[0] : (data.to || data.to_email || '')
    );
    if (!fromEmail) return;

    const subject = String(data.subject || '').slice(0, 500);
    const bodyText = String(data.text || data.body_text || data.html || '')
      .replace(/<[^>]+>/g, ' ')
      .slice(0, 8000);
    const bodyHtml = data.html ? String(data.html).slice(0, 20000) : null;
    const messageId = data.message_id || data.email_id || data.id || null;
    const inReplyTo = data.in_reply_to || data.headers?.['in-reply-to'] || null;
    const providerEmailId = String(data.email_id || data.id || messageId || '').slice(0, 200) || null;

    const matched = await _matchOutbound(fromEmail, inReplyTo, messageId);
    let tenantId = matched.tenant_id;
    if (!tenantId && _db.hasDb()) {
      // Fall back to first tenant that has this contact in broadcast recipients.
      try {
        const r = await _db.getPool().query(
          `SELECT tenant_id FROM email_broadcast_recipients WHERE lower(email)=lower($1) ORDER BY id DESC LIMIT 1`,
          [fromEmail]
        );
        tenantId = r.rows[0]?.tenant_id || null;
      } catch { /* ignore */ }
    }

    if (!_db.hasDb()) return;
    const ins = await _db.getPool().query(
      `INSERT INTO email_replies
        (tenant_id, from_email, to_email, subject, body_text, body_html, message_id, in_reply_to,
         provider, provider_email_id, matched_provider_id, matched_channel, drip_enrollment_id,
         broadcast_recipient_id, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'resend',$9,$10,$11,$12,$13,$14::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        tenantId, fromEmail, toEmail || null, subject, bodyText, bodyHtml,
        messageId, inReplyTo, providerEmailId,
        matched.matched_provider_id, matched.matched_channel,
        matched.drip_enrollment_id, matched.broadcast_recipient_id,
        JSON.stringify(data),
      ]
    );
    const row = ins.rows[0];
    if (!row) return;
    await _ingestInbox(row);
    await _fireReplySignal(row);
  } catch (e) {
    console.error('[email-replies] webhook:', e.message);
  }
});

router.get('/', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, replies: [] });
  try {
    const tid = await _tid(req, 'email-replies:list');
    const r = await _db.getPool().query(
      `SELECT id, from_email, to_email, subject, body_text, matched_channel, matched_provider_id,
              drip_enrollment_id, broadcast_recipient_id, created_at
       FROM email_replies WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [tid]
    );
    res.json({ ok: true, replies: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/stats', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, total: 0, last_7d: 0 });
  try {
    const tid = await _tid(req, 'email-replies:stats');
    const r = await _db.getPool().query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last_7d
       FROM email_replies WHERE tenant_id=$1`,
      [tid]
    );
    res.json({ ok: true, ...(r.rows[0] || { total: 0, last_7d: 0 }) });
  } catch (e) { _err(res, 500, e.message); }
});

// Manual ingest (for Gmail bridge / tests).
router.post('/ingest', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'email-replies:ingest');
    const fromEmail = _extractEmail(req.body?.from_email || req.body?.from);
    if (!fromEmail) return _err(res, 400, 'from_email required');
    const subject = String(req.body?.subject || '').slice(0, 500);
    const bodyText = String(req.body?.body_text || req.body?.text || '').slice(0, 8000);
    const messageId = req.body?.message_id || ('manual-' + crypto.randomBytes(6).toString('hex'));
    const matched = await _matchOutbound(fromEmail, req.body?.in_reply_to, messageId);
    const ins = await _db.getPool().query(
      `INSERT INTO email_replies
        (tenant_id, from_email, to_email, subject, body_text, message_id, in_reply_to,
         provider, provider_email_id, matched_provider_id, matched_channel, drip_enrollment_id,
         broadcast_recipient_id, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$6,$8,$9,$10,$11,$12::jsonb)
       RETURNING *`,
      [
        tid, fromEmail, req.body?.to_email || null, subject, bodyText, messageId,
        req.body?.in_reply_to || null,
        matched.matched_provider_id, matched.matched_channel || 'manual',
        matched.drip_enrollment_id, matched.broadcast_recipient_id,
        JSON.stringify(req.body || {}),
      ]
    );
    const row = ins.rows[0];
    await _ingestInbox(row);
    await _fireReplySignal(row);
    res.json({ ok: true, reply: row });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
module.exports._extractEmail = _extractEmail;
