// WhatsApp Channel — Meta WhatsApp Cloud API integration.
// Mirrors the Drip + Conversation Inbox pattern used elsewhere: /send (template
// or text), /webhook (Meta posts here), /threads (list contacts), /thread/:wa
// (full message log), /stats. All inbound + outbound messages are persisted to
// the wa_messages table so they can also surface in the Unified Inbox view.
//
// Required Replit secrets:
//   WHATSAPP_PHONE_NUMBER_ID   — from Meta Business → WhatsApp → API Setup
//   WHATSAPP_ACCESS_TOKEN      — long-lived system user token w/ whatsapp_business_messaging
//   WHATSAPP_VERIFY_TOKEN      — your own random string (also pasted into Meta webhook)
//   WHATSAPP_BUSINESS_ACCT_ID  — optional, for template list

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');

const GRAPH = 'https://graph.facebook.com/v19.0';
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

async function ensureWhatsappSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS wa_messages (
      id           SERIAL PRIMARY KEY,
      direction    TEXT NOT NULL,                    -- 'in' | 'out'
      wa_id        TEXT NOT NULL,                    -- the contact's WhatsApp number
      message_id   TEXT,                             -- Meta's wamid
      body         TEXT,
      template     TEXT,                             -- if outbound template
      status       TEXT DEFAULT 'sent',              -- sent|delivered|read|failed
      raw          JSONB,
      created_at   TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wa_messages_wa ON wa_messages(wa_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS wa_contacts (
      wa_id TEXT PRIMARY KEY, name TEXT, last_at TIMESTAMPTZ DEFAULT now(), unread_count INT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS wa_templates (
      id           SERIAL PRIMARY KEY,
      name         TEXT UNIQUE NOT NULL,
      category     TEXT DEFAULT 'MARKETING',         -- MARKETING|UTILITY|AUTHENTICATION
      language     TEXT DEFAULT 'en_US',
      body         TEXT NOT NULL,                    -- with {{1}} {{2}} placeholders
      var_count    INT DEFAULT 0,
      is_meta_approved BOOLEAN DEFAULT FALSE,        -- TRUE once registered with Meta
      created_at   TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS wa_campaigns (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      template_id  INT REFERENCES wa_templates(id) ON DELETE SET NULL,
      template_name TEXT,
      total        INT DEFAULT 0,
      sent         INT DEFAULT 0,
      failed       INT DEFAULT 0,
      status       TEXT DEFAULT 'queued',            -- queued|running|done|failed
      created_at   TIMESTAMPTZ DEFAULT now(),
      finished_at  TIMESTAMPTZ
    );
  `);
}
ensureWhatsappSchema().catch(e => console.error('[whatsapp] schema:', e.message));

function _hasCreds() {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN
            && !/^_DUMMY/i.test(process.env.WHATSAPP_PHONE_NUMBER_ID)
            && !/^_DUMMY/i.test(process.env.WHATSAPP_ACCESS_TOKEN));
}

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    configured: _hasCreds(),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ? '***' + String(process.env.WHATSAPP_PHONE_NUMBER_ID).slice(-4) : null,
    webhookVerifyTokenSet: !!process.env.WHATSAPP_VERIFY_TOKEN,
  });
});

// ── Send: text or template ───────────────────────────────────────────────────
router.post('/send', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'WhatsApp credentials missing — set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.');
  const { to, text, template, languageCode = 'en_US', components } = req.body || {};
  if (!to) return _err(res, 400, 'to (recipient phone with country code, no +) required');
  const cleanTo = String(to).replace(/[^0-9]/g, '');
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const body = template
    ? { messaging_product:'whatsapp', to: cleanTo, type:'template',
        template: { name: template, language:{ code: languageCode }, components: components || [] } }
    : { messaging_product:'whatsapp', to: cleanTo, type:'text', text:{ body: String(text || '').slice(0, 4000), preview_url: true } };
  try {
    const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error?.message || `Meta returned ${r.status}`);
    const wamid = j.messages?.[0]?.id || null;
    if (_db.hasDb()) {
      await _db.getPool().query(
        `INSERT INTO wa_messages (direction, wa_id, message_id, body, template, raw) VALUES ('out', $1, $2, $3, $4, $5::jsonb)`,
        [cleanTo, wamid, text || null, template || null, JSON.stringify(j)]
      );
      await _db.getPool().query(
        `INSERT INTO wa_contacts (wa_id, last_at) VALUES ($1, now())
         ON CONFLICT (wa_id) DO UPDATE SET last_at=EXCLUDED.last_at`, [cleanTo]
      );
    }
    res.json({ ok:true, messageId: wamid });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Webhook: Meta verification handshake (GET) + message delivery (POST) ─────
router.get('/webhook', (req, res) => {
  const mode  = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const chal  = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(chal);
  res.status(403).send('verify failed');
});

// Meta requires us to verify the X-Hub-Signature-256 header against the raw body
// using the App Secret. We capture raw body via express.raw, verify, then JSON.parse.
const _crypto = require('crypto');
function _verifyMetaSignature(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // Allow unverified ONLY when no app secret configured (dev mode)
  const sig = String(req.headers['x-hub-signature-256'] || '');
  if (!sig.startsWith('sha256=')) return false;
  const expected = 'sha256=' + _crypto.createHmac('sha256', appSecret).update(req.body).digest('hex');
  try { return _crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}
router.post('/webhook', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  if (!_verifyMetaSignature(req)) { console.warn('[whatsapp webhook] signature verify failed'); return res.status(401).end(); }
  res.status(200).end(); // ack immediately per Meta requirement
  let body;
  try { body = JSON.parse(req.body.toString('utf8') || '{}'); } catch { return; }
  try {
    const entry = body?.entry || [];
    for (const e of entry) for (const ch of (e.changes || [])) {
      const v = ch.value || {};
      // Inbound messages
      for (const m of (v.messages || [])) {
        const wa = m.from;
        const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || '[non-text]';
        const name = (v.contacts || []).find(c => c.wa_id === wa)?.profile?.name || null;
        if (_db.hasDb()) {
          await _db.getPool().query(
            `INSERT INTO wa_messages (direction, wa_id, message_id, body, raw) VALUES ('in', $1, $2, $3, $4::jsonb)`,
            [wa, m.id, text, JSON.stringify(m)]
          );
          await _db.getPool().query(
            `INSERT INTO wa_contacts (wa_id, name, last_at, unread_count) VALUES ($1, $2, now(), 1)
             ON CONFLICT (wa_id) DO UPDATE SET name=COALESCE(EXCLUDED.name, wa_contacts.name), last_at=EXCLUDED.last_at, unread_count=wa_contacts.unread_count+1`,
            [wa, name]
          );
        }
      }
      // Status callbacks (delivered/read/failed)
      for (const s of (v.statuses || [])) {
        if (_db.hasDb()) {
          await _db.getPool().query(
            `UPDATE wa_messages SET status=$1 WHERE message_id=$2`, [s.status, s.id]
          );
        }
      }
    }
  } catch (e) { console.error('[whatsapp webhook]', e.message); }
});

// ── Threads ──────────────────────────────────────────────────────────────────
router.get('/threads', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, threads: [] });
  try {
    const r = await _db.getPool().query(`
      SELECT c.wa_id, c.name, c.last_at, c.unread_count,
             (SELECT body FROM wa_messages m WHERE m.wa_id=c.wa_id ORDER BY created_at DESC LIMIT 1) AS preview
      FROM wa_contacts c ORDER BY c.last_at DESC LIMIT 100
    `);
    res.json({ ok:true, threads: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/thread/:wa', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, messages: [] });
  try {
    await _db.getPool().query(`UPDATE wa_contacts SET unread_count=0 WHERE wa_id=$1`, [req.params.wa]);
    const r = await _db.getPool().query(
      `SELECT direction, body, template, status, message_id, created_at FROM wa_messages WHERE wa_id=$1 ORDER BY created_at ASC LIMIT 500`,
      [req.params.wa]
    );
    res.json({ ok:true, messages: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/stats', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, totalIn:0, totalOut:0, contacts:0, last24h:0 });
  try {
    const out = await _db.getPool().query(`SELECT COUNT(*)::int AS n FROM wa_messages WHERE direction='out'`);
    const inn = await _db.getPool().query(`SELECT COUNT(*)::int AS n FROM wa_messages WHERE direction='in'`);
    const c   = await _db.getPool().query(`SELECT COUNT(*)::int AS n FROM wa_contacts`);
    const r24 = await _db.getPool().query(`SELECT COUNT(*)::int AS n FROM wa_messages WHERE created_at > now() - interval '24 hours'`);
    res.json({ ok:true, totalOut: out.rows[0].n, totalIn: inn.rows[0].n, contacts: c.rows[0].n, last24h: r24.rows[0].n });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Templates: list / save / delete ──────────────────────────────────────────
router.get('/templates', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, templates: [] });
  try {
    const r = await _db.getPool().query(`SELECT id, name, category, language, body, var_count, is_meta_approved, created_at FROM wa_templates ORDER BY created_at DESC LIMIT 200`);
    res.json({ ok:true, templates: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/templates', async (req, res) => {
  const { name, category = 'MARKETING', language = 'en_US', body, isMetaApproved = false } = req.body || {};
  if (!name || !body) return _err(res, 400, 'name and body required');
  if (!/^[a-z0-9_]+$/.test(String(name))) return _err(res, 400, 'name must be lowercase letters, numbers, underscores only');
  if (!_db.hasDb()) return _err(res, 500, 'No DB');
  // Detect {{1}} {{2}} ... placeholders so the sender knows how many vars to bind
  const matches = String(body).match(/\{\{(\d+)\}\}/g) || [];
  const varCount = matches.length ? Math.max(...matches.map(m => parseInt(m.replace(/[^0-9]/g,''), 10))) : 0;
  try {
    const r = await _db.getPool().query(
      `INSERT INTO wa_templates (name, category, language, body, var_count, is_meta_approved)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (name) DO UPDATE SET category=EXCLUDED.category, language=EXCLUDED.language, body=EXCLUDED.body, var_count=EXCLUDED.var_count, is_meta_approved=EXCLUDED.is_meta_approved
       RETURNING id, name, var_count`,
      [name, category, language, body, varCount, !!isMetaApproved]
    );
    res.json({ ok:true, template: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/templates/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'No DB');
  try { await _db.getPool().query(`DELETE FROM wa_templates WHERE id=$1`, [req.params.id]); res.json({ ok:true }); }
  catch (e) { _err(res, 500, e.message); }
});

// ── Bulk send: render template body with vars and send to many recipients ────
// Body: { templateId | templateName, name, recipients:[{ to:'27821234567', vars:{1:'Alice',2:'#123'} }, ...] }
// If the template is registered with Meta (is_meta_approved=true) we send via
// the WhatsApp template channel (cold-window safe). Otherwise we fall back to
// a free-form text send (only valid inside the 24h customer-service window).
router.post('/send-bulk', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'WhatsApp credentials missing.');
  if (!_db.hasDb()) return _err(res, 500, 'No DB');
  const { templateId, templateName, name = `Campaign ${new Date().toISOString().slice(0,16)}`, recipients = [] } = req.body || {};
  if (!Array.isArray(recipients) || !recipients.length) return _err(res, 400, 'recipients[] required');
  if (recipients.length > 1000) return _err(res, 400, 'Max 1000 recipients per bulk send');

  // Resolve template
  let tpl = null;
  try {
    const q = templateId
      ? await _db.getPool().query(`SELECT * FROM wa_templates WHERE id=$1`, [templateId])
      : await _db.getPool().query(`SELECT * FROM wa_templates WHERE name=$1`, [templateName]);
    tpl = q.rows[0];
  } catch (e) { return _err(res, 500, e.message); }
  if (!tpl) return _err(res, 404, 'Template not found');

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const cmp = await _db.getPool().query(
    `INSERT INTO wa_campaigns (name, template_id, template_name, total, status) VALUES ($1,$2,$3,$4,'running') RETURNING id`,
    [name, tpl.id, tpl.name, recipients.length]
  );
  const campaignId = cmp.rows[0].id;
  res.json({ ok:true, campaignId, total: recipients.length });

  // Fire & forget — process serially with small delay (Meta tier: 80 msg/sec hard cap)
  (async () => {
    let sent = 0, failed = 0;
    for (const rec of recipients) {
      const to = String(rec.to || '').replace(/[^0-9]/g, '');
      if (!to) { failed++; continue; }
      const vars = rec.vars || {};
      // Render body for the local log
      const renderedBody = String(tpl.body).replace(/\{\{(\d+)\}\}/g, (_,n)=> String(vars[n] ?? ''));
      const components = tpl.var_count > 0
        ? [{ type:'body', parameters: Array.from({length: tpl.var_count}, (_,i)=>({ type:'text', text: String(vars[i+1] ?? '') })) }]
        : [];
      const body = tpl.is_meta_approved
        ? { messaging_product:'whatsapp', to, type:'template',
            template: { name: tpl.name, language:{ code: tpl.language }, components } }
        : { messaging_product:'whatsapp', to, type:'text', text:{ body: renderedBody.slice(0,4000), preview_url:true } };
      try {
        const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
          method:'POST',
          headers:{ 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type':'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error?.message || `Meta ${r.status}`);
        const wamid = j.messages?.[0]?.id || null;
        await _db.getPool().query(
          `INSERT INTO wa_messages (direction, wa_id, message_id, body, template, raw) VALUES ('out',$1,$2,$3,$4,$5::jsonb)`,
          [to, wamid, renderedBody, tpl.name, JSON.stringify({ campaignId })]
        );
        await _db.getPool().query(
          `INSERT INTO wa_contacts (wa_id, last_at) VALUES ($1, now()) ON CONFLICT (wa_id) DO UPDATE SET last_at=EXCLUDED.last_at`, [to]
        );
        sent++;
      } catch (e) {
        failed++;
        await _db.getPool().query(
          `INSERT INTO wa_messages (direction, wa_id, body, template, status, raw) VALUES ('out',$1,$2,$3,'failed',$4::jsonb)`,
          [to, renderedBody, tpl.name, JSON.stringify({ campaignId, error: e.message })]
        ).catch(()=>{});
      }
      await _db.getPool().query(`UPDATE wa_campaigns SET sent=$1, failed=$2 WHERE id=$3`, [sent, failed, campaignId]).catch(()=>{});
      await new Promise(r => setTimeout(r, 80)); // ~12 msg/sec — well under Meta limits
    }
    await _db.getPool().query(`UPDATE wa_campaigns SET status='done', finished_at=now(), sent=$1, failed=$2 WHERE id=$3`, [sent, failed, campaignId]).catch(()=>{});
  })().catch(e => console.error('[whatsapp bulk]', e.message));
});

router.get('/campaigns', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, campaigns: [] });
  try {
    const r = await _db.getPool().query(`SELECT id, name, template_name, total, sent, failed, status, created_at, finished_at FROM wa_campaigns ORDER BY created_at DESC LIMIT 50`);
    res.json({ ok:true, campaigns: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
