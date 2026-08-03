// Shared lead ingest + classify — used by API routes and channel webhooks.
const _db = require('../../db');
const { parseAttribution } = require('./attribution');
const { classifyLead } = require('./classifier');

async function _enqueueReview(pool, tenantId, { item_type, item_id, title, summary, priority, meta }) {
  await pool.query(`
    INSERT INTO lead_intel_review_queue (tenant_id, item_type, item_id, title, summary, priority, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [tenantId, item_type, item_id || null, title, summary || null, priority || 'normal', meta ? JSON.stringify(meta) : null]);
}

async function ingestLead(tenantId, body = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'database not configured' };
  const channel = String(body.channel || 'form').slice(0, 32);
  const attr = parseAttribution(body.page_url || body.pageUrl, body);
  const pool = _db.getPool();

  const ins = await pool.query(`
    INSERT INTO lead_intel_leads (
      tenant_id, channel, source_ref, contact_name, contact_email, contact_phone, message,
      page_url, platform, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      gclid, fbclid, raw_payload, review_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending')
    RETURNING *
  `, [
    tenantId, channel, body.source_ref ? String(body.source_ref).slice(0, 120) : null,
    body.contact_name || body.name || null,
    body.contact_email || body.email || null,
    body.contact_phone || body.phone || null,
    body.message || body.notes || null,
    attr.page_url, attr.platform, attr.utm_source, attr.utm_medium, attr.utm_campaign,
    attr.utm_term, attr.utm_content, attr.gclid, attr.fbclid,
    JSON.stringify(body),
  ]);

  const lead = ins.rows[0];
  const cls = await classifyLead(lead, tenantId);
  const reviewStatus = cls.tier === 'junk' ? 'auto_junk' : (cls.tier === 'sales_opportunity' ? 'priority' : 'pending');

  await pool.query(`
    UPDATE lead_intel_leads SET
      score=$2, tier=$3, classification=$3, reasoning=$4, signals=$5, suggested_actions=$6,
      classifier_model=$7, classified_at=now(), review_status=$8, updated_at=now()
    WHERE id=$1
  `, [
    lead.id, cls.score, cls.tier, cls.reasoning,
    JSON.stringify(cls.signals), JSON.stringify(cls.suggestedActions),
    cls.model, reviewStatus,
  ]);

  if (cls.tier === 'sales_opportunity' || cls.tier === 'junk') {
    await _enqueueReview(pool, tenantId, {
      item_type: 'lead',
      item_id: lead.id,
      title: `${cls.tier === 'sales_opportunity' ? 'Hot lead' : 'Junk lead'}: ${lead.contact_email || lead.contact_phone || channel}`,
      summary: cls.reasoning,
      priority: cls.tier === 'sales_opportunity' ? 'high' : 'low',
      meta: { leadId: lead.id, tier: cls.tier, channel },
    });
  }

  return { ok: true, lead: { ...lead, ...cls, review_status: reviewStatus } };
}

module.exports = { ingestLead };
