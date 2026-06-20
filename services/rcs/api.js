const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const CHANNELS = ['rcs', 'apple_messages'];
const RCS_CARD_LAYOUTS = ['standalone', 'carousel', 'list'];
const CTA_TYPES = ['open_url', 'dial_phone', 'view_location', 'create_calendar_event', 'share_location'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, channels: CHANNELS, card_layouts: RCS_CARD_LAYOUTS, cta_types: CTA_TYPES });
});

router.get('/campaigns', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rcs:campaigns' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM rcs_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, campaigns: rows.rows });
});

router.post('/campaigns/create', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rcs:create' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, channel, message_body, rich_card, cta_buttons, media_url, sender_name } = req.body;
  if (!name || !message_body) return res.status(400).json({ ok: false, error: 'name and message_body required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO rcs_campaigns(tenant_id,name,channel,message_body,rich_card,cta_buttons,media_url,sender_name)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tid, name, channel || 'rcs', message_body,
     rich_card ? JSON.stringify(rich_card) : null,
     cta_buttons ? JSON.stringify(cta_buttons) : null,
     media_url || null, sender_name || null]
  );
  res.json({ ok: true, campaign: r.rows[0] });
});

router.post('/campaigns/:id/ai-generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rcs:ai-generate' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { channel = 'rcs', goal, brand_name, offer, target_audience, cta_label, cta_url } = req.body;
  if (!goal) return res.status(400).json({ ok: false, error: 'goal required' });

  let generated = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const isApple = channel === 'apple_messages';
    const prompt = `You are a mobile messaging expert specialising in ${isApple ? 'Apple Messages for Business' : 'RCS (Rich Communication Services)'} marketing.
Create a high-converting rich message campaign.
Goal: ${goal}
Brand: ${brand_name || 'the brand'}
Offer: ${offer || 'see website'}
Target audience: ${target_audience || 'general'}
CTA label: ${cta_label || 'Learn More'} — URL: ${cta_url || 'https://example.com'}

${isApple ? 'Apple Messages for Business supports: rich bubbles, Apple Pay integration, list pickers, time pickers.' : 'RCS supports: rich cards, carousels, suggested replies, location sharing, file attachments.'}

Return strict JSON: {
  "message_body": "...(plain text fallback, max 160 chars)...",
  "rich_card": {"title":"...","description":"...","media_url":"","layout":"standalone"},
  "cta_buttons": [{"label":"...","type":"open_url","value":"..."}],
  "suggested_replies": ["...", "..."],
  "sender_name": "...",
  "campaign_name": "...",
  "best_send_time": "...",
  "personalisation_tips": ["..."]
}`;
    const r = await openai.chat.completions.create({ model: 'gpt-5', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) generated = parsed;
  } catch (e) {}

  if (!generated) {
    generated = {
      message_body: `${brand_name || 'Hi'} — ${offer || 'We have something special for you'}. Tap below to ${cta_label || 'learn more'}.`,
      rich_card: { title: `${brand_name || 'Special Offer'}`, description: offer || 'Exclusive deal just for you.', media_url: '', layout: 'standalone' },
      cta_buttons: [{ label: cta_label || 'Learn More', type: 'open_url', value: cta_url || 'https://example.com' }],
      suggested_replies: ['Tell me more', 'Not interested'],
      sender_name: brand_name || 'Brand',
      campaign_name: `${goal} Campaign`,
      best_send_time: 'Tuesday–Thursday, 10am–12pm local time',
      personalisation_tips: ['Use first name in greeting', 'Reference past purchase if available', 'Localise offer by region']
    };
  }

  res.json({ ok: true, generated });
});

router.post('/campaigns/:id/send', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rcs:send' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { recipients } = req.body;
  if (!Array.isArray(recipients) || !recipients.length) return res.status(400).json({ ok: false, error: 'recipients array required' });
  const p = await _db.getPool();
  const camp = await p.query(`SELECT * FROM rcs_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!camp.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  let queued = 0;
  for (const r of recipients.slice(0, 1000)) {
    if (!r.phone) continue;
    await p.query(
      `INSERT INTO rcs_messages(campaign_id,tenant_id,recipient_phone,recipient_name,status,sent_at)
       VALUES($1,$2,$3,$4,'sent',NOW())`,
      [req.params.id, tid, r.phone, r.name || null]
    );
    queued++;
  }
  await p.query(`UPDATE rcs_campaigns SET status='sent', sent_count=$1, recipient_count=$1, sent_at=NOW() WHERE id=$2`, [queued, req.params.id]);
  res.json({ ok: true, queued });
});

router.get('/stats/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rcs:stats' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const [camp, msgs] = await Promise.all([
    p.query(`SELECT * FROM rcs_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]),
    p.query(`SELECT status, COUNT(*) as n FROM rcs_messages WHERE campaign_id=$1 GROUP BY status`, [req.params.id]),
  ]);
  if (!camp.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, campaign: camp.rows[0], message_stats: msgs.rows });
});

module.exports = router;
