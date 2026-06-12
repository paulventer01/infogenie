const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');


// Log a provenance record for an insight
router.post('/log', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'provenance:log' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const {
    insight_key, insight_label, source_type, source_name, source_url,
    is_ai_estimated = false, ai_model, freshness_hours, data_snapshot = {}
  } = req.body;
  if (!insight_key || !source_type) return res.status(400).json({ ok:false, error:'insight_key and source_type required' });
  const p = await _db.getPool();
  const row = await p.query(
    `INSERT INTO insight_provenance(tenant_id,insight_key,insight_label,source_type,source_name,source_url,is_ai_estimated,ai_model,freshness_hours,data_snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT DO NOTHING RETURNING id`,
    [tid, insight_key, insight_label||insight_key, source_type, source_name||null, source_url||null,
     !!is_ai_estimated, ai_model||null, freshness_hours||null, JSON.stringify(data_snapshot)]
  );
  res.json({ ok:true, id: row.rows[0]?.id });
});

// Get all provenance records for this tenant (the "audit trail")
router.get('/insights', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'provenance:insights' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { source_type, is_ai, search } = req.query;
  const p = await _db.getPool();
  let q = `SELECT id,insight_key,insight_label,source_type,source_name,source_url,is_ai_estimated,ai_model,freshness_hours,fetched_at,created_at
           FROM insight_provenance WHERE tenant_id=$1`;
  const params = [tid];
  if (source_type) { params.push(source_type); q += ` AND source_type=$${params.length}`; }
  if (is_ai === 'true') { q += ` AND is_ai_estimated=TRUE`; }
  if (is_ai === 'false') { q += ` AND is_ai_estimated=FALSE`; }
  if (search) { params.push('%'+search+'%'); q += ` AND (insight_label ILIKE $${params.length} OR source_name ILIKE $${params.length})`; }
  q += ` ORDER BY fetched_at DESC LIMIT 100`;
  const rows = await p.query(q, params);
  // Summarise
  const all = await p.query(`SELECT source_type, is_ai_estimated, COUNT(*) FROM insight_provenance WHERE tenant_id=$1 GROUP BY source_type, is_ai_estimated`, [tid]);
  const summary = { total:0, ai_estimated:0, real_data:0, sources:{} };
  for (const r of all.rows) {
    summary.total += +r.count;
    if (r.is_ai_estimated) summary.ai_estimated += +r.count; else summary.real_data += +r.count;
    summary.sources[r.source_type] = (summary.sources[r.source_type]||0) + +r.count;
  }
  res.json({ ok:true, insights: rows.rows, summary });
});

// Get provenance for a specific insight key
router.get('/insights/:key', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'provenance:insight-key' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT * FROM insight_provenance WHERE tenant_id=$1 AND insight_key=$2 ORDER BY fetched_at DESC LIMIT 10`,
    [tid, req.params.key]
  );
  res.json({ ok:true, records: rows.rows });
});

// Bulk-log provenance records (for batch operations)
router.post('/bulk-log', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'provenance:bulk-log' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { records = [] } = req.body;
  if (!records.length) return res.status(400).json({ ok:false, error:'records array required' });
  const p = await _db.getPool();
  let saved = 0;
  for (const rec of records.slice(0,50)) {
    try {
      await p.query(
        `INSERT INTO insight_provenance(tenant_id,insight_key,insight_label,source_type,source_name,source_url,is_ai_estimated,ai_model,freshness_hours,data_snapshot)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [tid, rec.insight_key, rec.insight_label||rec.insight_key, rec.source_type, rec.source_name||null,
         rec.source_url||null, !!rec.is_ai_estimated, rec.ai_model||null, rec.freshness_hours||null, JSON.stringify(rec.data_snapshot||{})]
      );
      saved++;
    } catch(e) { /* skip bad records */ }
  }
  res.json({ ok:true, saved });
});

module.exports = router;
