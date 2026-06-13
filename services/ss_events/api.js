const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const SOURCE_TYPES = ['web','mobile','offline','crm','phone','email','pos','api'];
const EVENT_TYPES = ['purchase','lead','page_view','add_to_cart','checkout','phone_call','offline_sale','form_submit','subscription','trial_start','demo_request'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, source_types: SOURCE_TYPES, event_types: EVENT_TYPES });
});

router.get('/sources', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ss-events:sources' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM ss_sources WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, sources: rows.rows });
});

router.post('/sources/add', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ss-events:add-source' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { source_name, source_type, pixel_id, description } = req.body;
  if (!source_name || !source_type) return res.status(400).json({ ok: false, error: 'source_name and source_type required' });
  const token = crypto.randomBytes(24).toString('hex');
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO ss_sources(tenant_id,source_name,source_type,pixel_id,ingest_token,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tid, source_name, source_type, pixel_id || null, token, description || null]
  );
  res.json({ ok: true, source: r.rows[0], ingest_url: `/api/ss-events/ingest/${token}` });
});

router.delete('/sources/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ss-events:delete-source' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM ss_sources WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/ingest/:token', async (req, res) => {
  const p = await _db.getPool();
  const src = await p.query(`SELECT * FROM ss_sources WHERE ingest_token=$1 AND is_active=TRUE`, [req.params.token]);
  if (!src.rows.length) return res.status(401).json({ ok: false, error: 'invalid_token' });
  const source = src.rows[0];
  const events = Array.isArray(req.body) ? req.body : (req.body.events || [req.body]);
  let ingested = 0;
  for (const ev of events.slice(0, 100)) {
    if (!ev.event_name) continue;
    const emailHash = ev.email ? crypto.createHash('sha256').update(ev.email.toLowerCase().trim()).digest('hex') : null;
    const phoneHash = ev.phone ? crypto.createHash('sha256').update(ev.phone.replace(/\D/g, '')).digest('hex') : null;
    const ipHash = req.socket?.remoteAddress ? crypto.createHash('sha256').update(req.socket.remoteAddress).digest('hex') : null;
    await p.query(
      `INSERT INTO ss_events(tenant_id,source_id,source_name,event_name,event_type,email_hash,phone_hash,fbclid,gclid,ttclid,value,currency,properties,user_agent,ip_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [source.tenant_id, source.id, source.source_name, ev.event_name, ev.event_type || ev.event_name,
       emailHash, phoneHash, ev.fbclid || null, ev.gclid || null, ev.ttclid || null,
       ev.value || null, ev.currency || 'USD', ev.properties ? JSON.stringify(ev.properties) : null,
       req.headers['user-agent'] || null, ipHash]
    );
    ingested++;
  }
  await p.query(`UPDATE ss_sources SET event_count=event_count+$1, last_event_at=NOW() WHERE id=$2`, [ingested, source.id]);
  res.json({ ok: true, ingested });
});

router.post('/ingest', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ss-events:ingest-auth' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { source_id, events } = req.body;
  if (!Array.isArray(events) || !events.length) return res.status(400).json({ ok: false, error: 'events array required' });
  const p = await _db.getPool();
  let src = null;
  if (source_id) {
    const sr = await p.query(`SELECT * FROM ss_sources WHERE id=$1 AND tenant_id=$2`, [source_id, tid]);
    src = sr.rows[0] || null;
  }
  let ingested = 0;
  for (const ev of events.slice(0, 100)) {
    if (!ev.event_name) continue;
    const emailHash = ev.email ? crypto.createHash('sha256').update(ev.email.toLowerCase().trim()).digest('hex') : null;
    const phoneHash = ev.phone ? crypto.createHash('sha256').update(ev.phone.replace(/\D/g, '')).digest('hex') : null;
    await p.query(
      `INSERT INTO ss_events(tenant_id,source_id,source_name,event_name,event_type,email_hash,phone_hash,fbclid,gclid,ttclid,value,currency,properties)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tid, src?.id || null, src?.source_name || 'manual', ev.event_name, ev.event_type || ev.event_name,
       emailHash, phoneHash, ev.fbclid || null, ev.gclid || null, ev.ttclid || null,
       ev.value || null, ev.currency || 'USD', ev.properties ? JSON.stringify(ev.properties) : null]
    );
    ingested++;
  }
  res.json({ ok: true, ingested });
});

router.get('/report', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ss-events:report' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { days = 30 } = req.query;
  const p = await _db.getPool();
  const [totals, byEvent, bySource, withRevenue, timeline] = await Promise.all([
    p.query(`SELECT COUNT(*) as n, SUM(value) as total_revenue FROM ss_events WHERE tenant_id=$1 AND received_at > NOW()-INTERVAL '1 day'*$2`, [tid, +days]),
    p.query(`SELECT event_name, COUNT(*) as n, SUM(value) as revenue FROM ss_events WHERE tenant_id=$1 AND received_at > NOW()-INTERVAL '1 day'*$2 GROUP BY event_name ORDER BY n DESC LIMIT 20`, [tid, +days]),
    p.query(`SELECT source_name, COUNT(*) as n FROM ss_events WHERE tenant_id=$1 AND received_at > NOW()-INTERVAL '1 day'*$2 GROUP BY source_name ORDER BY n DESC`, [tid, +days]),
    p.query(`SELECT COUNT(*) as n, SUM(value) as revenue FROM ss_events WHERE tenant_id=$1 AND value IS NOT NULL AND received_at > NOW()-INTERVAL '1 day'*$2`, [tid, +days]),
    p.query(`SELECT DATE(received_at) as date, COUNT(*) as events, SUM(value) as revenue FROM ss_events WHERE tenant_id=$1 AND received_at > NOW()-INTERVAL '1 day'*$2 GROUP BY DATE(received_at) ORDER BY date DESC LIMIT 30`, [tid, +days]),
  ]);
  res.json({ ok: true, period_days: +days, totals: { events: +totals.rows[0].n, revenue: +(totals.rows[0].total_revenue || 0) }, by_event: byEvent.rows, by_source: bySource.rows, revenue_events: withRevenue.rows[0], timeline: timeline.rows });
});

module.exports = router;
