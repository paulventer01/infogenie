const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

function _oa() { return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY }); }

const STATUSES = ['inquiry','negotiating','accepted','active','completed','rejected','paused'];
const DEAL_TYPES = ['sponsored_post','affiliate','gifted','ambassador','product_review','ugc','other'];

/* ── list ── */
router.get('/', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'branddeals:list' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { status } = req.query;
    let q = `SELECT bd.*, p.name as persona_name FROM brand_deals bd LEFT JOIN ai_personas p ON p.id=bd.persona_id WHERE bd.tenant_id=$1`;
    const params = [tid];
    if (status) { q += ` AND bd.status=$2`; params.push(status); }
    q += ` ORDER BY bd.created_at DESC`;
    const { rows } = await _db.getPool().query(q, params);
    res.json({ ok: true, deals: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── stats summary (before /:id so "stats" is not captured as an id) ── */
router.get('/stats/summary', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'branddeals:stats' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { rows } = await _db.getPool().query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status='inquiry') as inquiries,
        COUNT(*) FILTER (WHERE status='negotiating') as negotiating,
        COUNT(*) FILTER (WHERE status='accepted' OR status='active') as active,
        COUNT(*) FILTER (WHERE status='completed') as completed,
        COALESCE(SUM(negotiated_rate) FILTER (WHERE status='completed'), 0) as total_earned,
        COALESCE(SUM(negotiated_rate) FILTER (WHERE status IN ('accepted','active')), 0) as pipeline_value
      FROM brand_deals WHERE tenant_id=$1`, [tid]);
    res.json({ ok: true, stats: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── create ── */
router.post('/', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'branddeals:create' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { brand_name, contact_name, contact_email, product, deal_type, offered_rate, currency, notes, follow_up_date, deadline, persona_id } = req.body;
    if (!brand_name) return res.status(400).json({ ok: false, error: 'brand_name required' });
    const { rows } = await _db.getPool().query(
      `INSERT INTO brand_deals (tenant_id,brand_name,contact_name,contact_email,product,deal_type,offered_rate,currency,notes,follow_up_date,deadline,persona_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [tid, brand_name, contact_name||'', contact_email||'', product||'', deal_type||'sponsored_post',
       offered_rate||null, currency||'USD', notes||'', follow_up_date||null, deadline||null, persona_id||null]
    );
    res.json({ ok: true, deal: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── update ── */
router.put('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'branddeals:update' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { brand_name, contact_name, contact_email, product, deal_type, offered_rate, negotiated_rate, currency, status, deliverables, notes, follow_up_date, deadline, persona_id } = req.body;
    const { rows } = await _db.getPool().query(
      `UPDATE brand_deals SET brand_name=COALESCE($3,brand_name), contact_name=COALESCE($4,contact_name),
       contact_email=COALESCE($5,contact_email), product=COALESCE($6,product), deal_type=COALESCE($7,deal_type),
       offered_rate=COALESCE($8,offered_rate), negotiated_rate=COALESCE($9,negotiated_rate), currency=COALESCE($10,currency),
       status=COALESCE($11,status), deliverables=COALESCE($12,deliverables), notes=COALESCE($13,notes),
       follow_up_date=COALESCE($14,follow_up_date), deadline=COALESCE($15,deadline),
       persona_id=COALESCE($16,persona_id), updated_at=now()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, tid, brand_name, contact_name, contact_email, product, deal_type, offered_rate, negotiated_rate, currency, status, deliverables, notes, follow_up_date, deadline, persona_id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, deal: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── delete ── */
router.delete('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'branddeals:delete' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    await _db.getPool().query(`DELETE FROM brand_deals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── AI generate pitch / counter-pitch ── */
router.post('/:id/generate-pitch', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'branddeals:pitch' });
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT bd.*, p.name as persona_name, p.niche, p.content_voice, p.personality FROM brand_deals bd LEFT JOIN ai_personas p ON p.id=bd.persona_id WHERE bd.id=$1 AND bd.tenant_id=$2`,
      [req.params.id, tid]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
    const d = rows[0];
    const { pitch_type = 'initial' } = req.body;

    const completion = await _oa().chat.completions.create({
      model: 'gpt-5',
      messages: [{
        role: 'user',
        content: `Write a ${pitch_type === 'counter' ? 'counter-offer' : pitch_type === 'follow_up' ? 'follow-up' : 'initial pitch'} email for this influencer brand deal:
Influencer: ${d.persona_name || 'AI Influencer'}
Niche: ${d.niche || 'lifestyle'}
Voice: ${d.content_voice || 'professional but friendly'}
Brand: ${d.brand_name}
Product: ${d.product || 'their product'}
Offered rate: ${d.offered_rate ? '$' + d.offered_rate : 'not yet specified'}
${pitch_type === 'counter' ? 'Negotiated rate: $' + (d.negotiated_rate || (d.offered_rate * 1.3).toFixed(0)) : ''}
Deal type: ${d.deal_type}
Return JSON: {"subject":"...","body":"...","tone":"...","key_points":["..."]}`
      }],
      response_format: { type: 'json_object' }, max_tokens: 800
    });

    let result = {};
    try { result = JSON.parse(completion.choices[0].message.content); } catch (_) {}
    if (result._DUMMY || !result.subject) {
      result = {
        subject: `Partnership Opportunity — ${d.brand_name} x ${d.persona_name || 'Influencer'}`,
        body: `Hi ${d.contact_name || 'there'},\n\nThank you for reaching out about a partnership with ${d.brand_name}. I'd love to learn more about the ${d.product || 'collaboration'} opportunity.\n\nLooking forward to connecting!\n\nBest regards`,
        tone: 'professional and enthusiastic',
        key_points: ['Express interest', 'Request details', 'Propose next step'],
        source: 'template'
      };
    }
    res.json({ ok: true, pitch: result, source: result.source || 'gpt-5' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
