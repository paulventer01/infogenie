const express = require('express');
const router = express.Router();
const sms = require('./sms');
const wp = require('./webpush');
const _tenantCtx = require('../tenants/context');

// ── Get available channels + which are configured ──
router.get('/channels', (_req, res) => {
  const channels = [
    { id: 'email',    label: 'Email',          configured: !!process.env.RESEND_API_KEY,           via: 'Resend' },
    { id: 'sms',      label: 'SMS',            configured: !!process.env.TWILIO_ACCOUNT_SID,       via: 'Twilio' },
    { id: 'whatsapp', label: 'WhatsApp',       configured: !!process.env.WHATSAPP_PHONE_NUMBER_ID, via: 'Meta Cloud API' },
    { id: 'voice',    label: 'AI Voice Call',  configured: !!process.env.VAPI_API_KEY,             via: 'Vapi.ai' },
    { id: 'webpush',  label: 'Web Push',       configured: !!process.env.VAPID_PUBLIC_KEY,         via: 'web-push (VAPID)' }
  ].map((c) => ({ ...c, stub: !c.configured }));
  res.json({ channels });
});

// ── Web Push subscription endpoint (called from the service worker on the frontend) ──
router.post('/webpush/subscribe', async (req, res) => {
  try {
    const { subscription, contact } = req.body || {};
    // Service-worker call carries the user's session cookie when signed in;
    // fall back to the default tenant so a logged-out subscribe still lands somewhere.
    const tid = await _tenantCtx.resolveTenantId(req, { label:'omni:webpush:subscribe' })
      || await _tenantCtx.getDefaultTenantId();
    const out = await wp.subscribe(subscription, contact, tid);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/webpush/public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// ── Unified send: pick channels, fire to each contact ──
router.post('/send', async (req, res) => {
  try {
    const { channels = [], contacts = [], subject = '', body = '' } = req.body || {};
    if (!Array.isArray(channels) || channels.length === 0) return res.status(400).json({ error: 'pick at least one channel' });
    if (!Array.isArray(contacts) || contacts.length === 0) return res.status(400).json({ error: 'add at least one contact' });
    const results = [];
    // Web Push is a single broadcast (not per-contact) — fire once up front, then strip from the per-contact loop.
    const perContactChannels = channels.filter(ch => ch !== 'webpush');
    if (channels.includes('webpush')) {
      try {
        const tid = await _tenantCtx.resolveTenantId(req, { label:'omni:send:webpush' });
        const r = await wp.broadcast(subject || 'Update', body, undefined, tid);
        results.push({ channel: 'webpush', ok: r.ok !== false, sent: r.sent, stub: !!r.stub, error: r.error });
      } catch (e) { results.push({ channel: 'webpush', ok: false, error: e.message }); }
    }
    for (const c of contacts) {
      for (const ch of perContactChannels) {
        try {
          if (ch === 'email' && c.email) {
            if (process.env.RESEND_API_KEY) {
              const { Resend } = require('resend');
              const r = new Resend(process.env.RESEND_API_KEY);
              await r.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'noreply@infogenie.app',
                to: c.email, subject: subject || 'Update', text: body
              });
              results.push({ channel: 'email', to: c.email, ok: true });
            } else {
              results.push({ channel: 'email', to: c.email, ok: false, note: 'RESEND_API_KEY not set' });
            }
          } else if (ch === 'sms' && c.phone) {
            const r = await sms.sendSms(c.phone, body);
            results.push({ channel: 'sms', to: c.phone, ok: true, stub: !!r.stub });
          } else if (ch === 'whatsapp' && c.phone) {
            try {
              const wa = require('../whatsapp_channel/api');
              if (wa && typeof wa.sendText === 'function') { await wa.sendText(c.phone, body); results.push({ channel: 'whatsapp', to: c.phone, ok: true }); }
              else results.push({ channel: 'whatsapp', to: c.phone, ok: false, note: 'WhatsApp module not exporting sendText' });
            } catch (e) { results.push({ channel: 'whatsapp', to: c.phone, ok: false, error: e.message }); }
          } else if (ch === 'voice' && c.phone) {
            try {
              const v = require('../voice_caller/api');
              if (v && typeof v.placeCall === 'function') { await v.placeCall(c.phone, body); results.push({ channel: 'voice', to: c.phone, ok: true }); }
              else results.push({ channel: 'voice', to: c.phone, ok: false, note: 'Voice module not exporting placeCall' });
            } catch (e) { results.push({ channel: 'voice', to: c.phone, ok: false, error: e.message }); }
          } else {
            results.push({ channel: ch, ok: false, note: 'no matching contact field' });
          }
        } catch (e) { results.push({ channel: ch, ok: false, error: e.message }); }
      }
    }
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
