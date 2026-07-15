const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI  = require('openai');

const OBJECTIVES = [
  { id: 'lead_generation',    label: 'Lead Generation' },
  { id: 'partnership',        label: 'Partnership / BD' },
  { id: 'recruitment',        label: 'Recruiting' },
  { id: 'brand_awareness',    label: 'Brand Awareness' },
  { id: 'event_promotion',    label: 'Event Promotion' },
  { id: 'product_launch',     label: 'Product Launch' },
];

const CONTACT_STATUSES = [
  'pending', 'connection_sent', 'connected', 'followup_1_sent', 'followup_2_sent', 'followup_3_sent', 'replied', 'converted', 'not_interested', 'no_response'
];

router.get('/config', (req, res) => {
  res.json({ ok: true, objectives: OBJECTIVES, contact_statuses: CONTACT_STATUSES });
});

router.get('/sequences', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:sequences' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT s.*,
       COUNT(c.id) FILTER (WHERE c.status='pending')            AS pending_count,
       COUNT(c.id) FILTER (WHERE c.status='connection_sent')    AS sent_count,
       COUNT(c.id) FILTER (WHERE c.status='connected')          AS connected_count,
       COUNT(c.id) FILTER (WHERE c.status='replied')            AS replied_count,
       COUNT(c.id) FILTER (WHERE c.status='converted')          AS converted_count,
       COUNT(c.id)                                               AS total_count
     FROM linkedin_sequences s
     LEFT JOIN linkedin_contacts c ON c.sequence_id=s.id
     WHERE s.tenant_id=$1 GROUP BY s.id ORDER BY s.created_at DESC`,
    [tid]
  );
  res.json({ ok: true, sequences: r.rows });
});

router.post('/sequences', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:create-seq' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const {
    name, objective = 'lead_generation', target_title, target_industry,
    connection_message, followup_1_message, followup_1_delay_days = 3,
    followup_2_message, followup_2_delay_days = 7,
    followup_3_message, followup_3_delay_days = 14,
    daily_connection_limit = 20
  } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO linkedin_sequences(tenant_id,name,objective,target_title,target_industry,connection_message,followup_1_message,followup_1_delay_days,followup_2_message,followup_2_delay_days,followup_3_message,followup_3_delay_days,daily_connection_limit)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [tid, name, objective, target_title || null, target_industry || null,
     connection_message || null, followup_1_message || null, followup_1_delay_days,
     followup_2_message || null, followup_2_delay_days,
     followup_3_message || null, followup_3_delay_days, daily_connection_limit]
  );
  res.json({ ok: true, sequence: r.rows[0] });
});

router.put('/sequences/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:update-seq' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const {
    name, objective, target_title, target_industry, connection_message,
    followup_1_message, followup_1_delay_days, followup_2_message, followup_2_delay_days,
    followup_3_message, followup_3_delay_days, daily_connection_limit, status
  } = req.body;
  const p = await _db.getPool();
  await p.query(
    `UPDATE linkedin_sequences SET
       name=COALESCE($1,name), objective=COALESCE($2,objective),
       target_title=COALESCE($3,target_title), target_industry=COALESCE($4,target_industry),
       connection_message=COALESCE($5,connection_message),
       followup_1_message=COALESCE($6,followup_1_message), followup_1_delay_days=COALESCE($7,followup_1_delay_days),
       followup_2_message=COALESCE($8,followup_2_message), followup_2_delay_days=COALESCE($9,followup_2_delay_days),
       followup_3_message=COALESCE($10,followup_3_message), followup_3_delay_days=COALESCE($11,followup_3_delay_days),
       daily_connection_limit=COALESCE($12,daily_connection_limit), status=COALESCE($13,status),
       updated_at=NOW()
     WHERE id=$14 AND tenant_id=$15`,
    [name, objective, target_title, target_industry, connection_message,
     followup_1_message, followup_1_delay_days, followup_2_message, followup_2_delay_days,
     followup_3_message, followup_3_delay_days, daily_connection_limit, status,
     req.params.id, tid]
  );
  res.json({ ok: true });
});

router.post('/sequences/:id/ai-generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:ai-gen' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const seq = await p.query(`SELECT * FROM linkedin_sequences WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!seq.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const s = seq.rows[0];
  const { brand_name, your_role, value_prop, tone = 'professional' } = req.body;

  let messages = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `Write a 3-step LinkedIn outreach sequence for the following:

Objective: ${s.objective}
Target: ${s.target_title || 'Senior professionals'} in ${s.target_industry || 'their industry'}
Sender brand/role: ${brand_name || ''} / ${your_role || 'Outreach'}
Value proposition: ${value_prop || 'our solution helps them grow'}
Tone: ${tone}

Rules:
- Connection request: max 300 characters (LinkedIn limit), personalised, no hard sell, curiosity-led
- Follow-up 1 (Day ${s.followup_1_delay_days}): max 600 chars, reference connection, provide value
- Follow-up 2 (Day ${s.followup_2_delay_days}): max 500 chars, soft CTA (meeting / demo / reply)
- Follow-up 3 (Day ${s.followup_3_delay_days}): max 400 chars, last gentle nudge, no pressure
- Use [First Name] as the personalisation token
- Do NOT use generic openers like "I hope this finds you well"

Return strict JSON: {
  "connection_message": "...",
  "followup_1_message": "...",
  "followup_2_message": "...",
  "followup_3_message": "...",
  "subject_angles": ["..."],
  "tips": ["..."]
}`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    if (!parsed._DUMMY) messages = parsed;
  } catch (e) {}

  if (!messages) {
    return res.status(500).json({ ok: false, error: 'openai_key_required' });
  }

  // Auto-save to the sequence
  await p.query(
    `UPDATE linkedin_sequences SET connection_message=$1,followup_1_message=$2,followup_2_message=$3,followup_3_message=$4,updated_at=NOW() WHERE id=$5`,
    [messages.connection_message, messages.followup_1_message, messages.followup_2_message, messages.followup_3_message, req.params.id]
  );

  res.json({ ok: true, messages });
});

router.get('/contacts/:sequence_id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:contacts' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT * FROM linkedin_contacts WHERE sequence_id=$1 AND tenant_id=$2 ORDER BY added_at DESC LIMIT 200`,
    [req.params.sequence_id, tid]
  );
  res.json({ ok: true, contacts: r.rows });
});

router.post('/contacts', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:add-contacts' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { sequence_id, contacts } = req.body;
  if (!sequence_id || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ ok: false, error: 'sequence_id and contacts[] required' });
  }
  const p = await _db.getPool();
  // Verify sequence ownership
  const seq = await p.query(`SELECT id FROM linkedin_sequences WHERE id=$1 AND tenant_id=$2`, [sequence_id, tid]);
  if (!seq.rows.length) return res.status(404).json({ ok: false, error: 'sequence not found' });

  let added = 0;
  for (const c of contacts.slice(0, 500)) {
    try {
      await p.query(
        `INSERT INTO linkedin_contacts(sequence_id,tenant_id,linkedin_url,first_name,last_name,title,company,industry,location,email)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING`,
        [sequence_id, tid, c.linkedin_url || null, c.first_name || null, c.last_name || null,
         c.title || null, c.company || null, c.industry || null, c.location || null, c.email || null]
      );
      added++;
    } catch (e) {}
  }
  res.json({ ok: true, added });
});

router.put('/contacts/:id/status', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:contact-status' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { status, reply_snippet, notes } = req.body;
  if (!status || !CONTACT_STATUSES.includes(status)) {
    return res.status(400).json({ ok: false, error: `status must be one of: ${CONTACT_STATUSES.join(', ')}` });
  }
  const p = await _db.getPool();
  const now = new Date().toISOString();
  const updates = { status };
  if (status === 'connection_sent')  updates.connection_sent_at = now;
  if (status === 'connected')        updates.connected_at = now;
  if (status === 'followup_1_sent')  updates.followup_1_sent_at = now;
  if (status === 'followup_2_sent')  updates.followup_2_sent_at = now;
  if (status === 'followup_3_sent')  updates.followup_3_sent_at = now;
  if (status === 'replied')          updates.replied_at = now;
  if (reply_snippet)                 updates.reply_snippet = reply_snippet;
  if (notes)                         updates.notes = notes;

  const setClauses = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`).join(', ');
  const values = [...Object.values(updates), req.params.id, tid];
  await p.query(
    `UPDATE linkedin_contacts SET ${setClauses} WHERE id=$${values.length - 1} AND tenant_id=$${values.length}`,
    values
  );
  res.json({ ok: true, status });
});

router.delete('/contacts/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin-outreach:delete-contact' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM linkedin_contacts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

module.exports = router;
