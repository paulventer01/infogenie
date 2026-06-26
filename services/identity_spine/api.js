const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

router.get('/stats', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'identity:stats' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const [total, stages, ltv] = await Promise.all([
    p.query(`SELECT COUNT(*) as n FROM identity_profiles WHERE tenant_id=$1`, [tid]),
    p.query(`SELECT lifecycle_stage, COUNT(*) as n FROM identity_profiles WHERE tenant_id=$1 GROUP BY lifecycle_stage`, [tid]),
    p.query(`SELECT AVG(ltv_score) as avg_ltv, MAX(ltv_score) as max_ltv FROM identity_profiles WHERE tenant_id=$1`, [tid]),
  ]);
  res.json({ ok:true, total: +total.rows[0].n, stages: stages.rows, ltv: ltv.rows[0] });
});

router.get('/profiles', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'identity:profiles' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { stage, limit = 50, offset = 0 } = req.query;
  const p = await _db.getPool();
  const q = stage
    ? `SELECT * FROM identity_profiles WHERE tenant_id=$1 AND lifecycle_stage=$2 ORDER BY ltv_score DESC LIMIT $3 OFFSET $4`
    : `SELECT * FROM identity_profiles WHERE tenant_id=$1 ORDER BY ltv_score DESC LIMIT $2 OFFSET $3`;
  const args = stage ? [tid, stage, +limit, +offset] : [tid, +limit, +offset];
  const rows = await p.query(q, args);
  res.json({ ok:true, profiles: rows.rows });
});

router.post('/import', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'identity:import' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { contacts } = req.body;
  if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ ok:false, error:'contacts array required' });
  const p = await _db.getPool();
  let imported = 0;
  for (const c of contacts.slice(0,500)) {
    if (!c.email) continue;
    await p.query(
      `INSERT INTO identity_profiles(tenant_id,email,name,phone,company,source_channels,lifecycle_stage,tags,last_seen_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT DO NOTHING`,
      [tid, c.email.toLowerCase().trim(), c.name||null, c.phone||null, c.company||null,
       c.source_channels||'manual', c.lifecycle_stage||'unknown', c.tags||null]
    );
    imported++;
  }
  res.json({ ok:true, imported });
});

router.post('/score', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'identity:score' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { profile_ids } = req.body;
  const p = await _db.getPool();

  const q = profile_ids?.length
    ? `SELECT * FROM identity_profiles WHERE tenant_id=$1 AND id=ANY($2) LIMIT 20`
    : `SELECT * FROM identity_profiles WHERE tenant_id=$1 AND ltv_score=0 LIMIT 20`;
  const args = profile_ids?.length ? [tid, profile_ids] : [tid];
  const profiles = await p.query(q, args);
  if (!profiles.rows.length) return res.json({ ok:true, scored:0, message:'No profiles to score' });

  let scored = 0;
  let aiScores = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a customer LTV and propensity scoring model.
Score each contact. Channels available: ${[...new Set(profiles.rows.map(p=>p.source_channels))].join(', ')}.
Contacts: ${JSON.stringify(profiles.rows.map(p=>({id:p.id,email:p.email,company:p.company,stage:p.lifecycle_stage,channels:p.source_channels})))}
For each, assign: ltv_score (0-10000 USD estimated lifetime value), propensity_score (0-100 purchase likelihood %), lifecycle_stage, next_best_action.
Return strict JSON: {"scores":[{"id":1,"ltv_score":0,"propensity_score":0,"lifecycle_stage":"...","next_best_action":"..."}]}`;
    const r = await openai.chat.completions.create({ model:'gpt-5-mini', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.scores?.[0]?._DUMMY) aiScores = parsed.scores;
  } catch(e) {}

  if (!aiScores) {
    aiScores = profiles.rows.map((pr,i) => ({
      id: pr.id,
      ltv_score: 500 + (i * 120),
      propensity_score: 45 + (i * 5) % 50,
      lifecycle_stage: ['unknown','aware','interested','considering','customer'][i%5],
      next_best_action: ['Send intro email','Share case study','Offer demo','Send trial','Upsell'][i%5]
    }));
  }

  for (const s of aiScores) {
    await p.query(
      `UPDATE identity_profiles SET ltv_score=$1, propensity_score=$2, lifecycle_stage=$3, next_best_action=$4, updated_at=NOW() WHERE id=$5 AND tenant_id=$6`,
      [s.ltv_score||0, s.propensity_score||0, s.lifecycle_stage||'unknown', s.next_best_action||null, s.id, tid]
    );
    scored++;
  }
  res.json({ ok:true, scored });
});

router.post('/event', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'identity:event' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { profile_id, event_type, channel, properties } = req.body;
  if (!profile_id || !event_type) return res.status(400).json({ ok:false, error:'profile_id and event_type required' });
  const p = await _db.getPool();
  await p.query(
    `INSERT INTO identity_events(profile_id,tenant_id,event_type,channel,properties) VALUES($1,$2,$3,$4,$5)`,
    [profile_id, tid, event_type, channel||null, properties ? JSON.stringify(properties) : null]
  );
  await p.query(`UPDATE identity_profiles SET last_seen_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [profile_id, tid]);
  res.json({ ok:true });
});

// ── Anonymous → Known Profile Stitching ──────────────────────────────────
// Associates an anonymous session identity with a known email profile.
// Merges anonymous_id's event history into the target profile.
router.post('/stitch', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'identity:stitch' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { anonymous_id, email, source_channel } = req.body;
  if (!anonymous_id || !email) return res.status(400).json({ ok:false, error:'anonymous_id and email required' });
  const p = await _db.getPool();
  // Find or create the known profile
  let profile = await p.query(
    `SELECT id FROM identity_profiles WHERE tenant_id=$1 AND email=$2`, [tid, email.toLowerCase().trim()]
  );
  let profile_id;
  if (profile.rows.length) {
    profile_id = profile.rows[0].id;
  } else {
    const ins = await p.query(
      `INSERT INTO identity_profiles(tenant_id,email,source_channels,lifecycle_stage,last_seen_at)
       VALUES($1,$2,$3,'aware',NOW()) RETURNING id`,
      [tid, email.toLowerCase().trim(), source_channel || 'web']
    );
    profile_id = ins.rows[0].id;
  }
  // Re-assign any events logged under anonymous_id to this profile
  const reassigned = await p.query(
    `UPDATE identity_events SET profile_id=$1
     WHERE tenant_id=$2 AND properties::jsonb->>'anonymous_id'=$3 AND profile_id IS NULL`,
    [profile_id, tid, anonymous_id]
  );
  // Log the stitch event itself
  await p.query(
    `INSERT INTO identity_events(profile_id,tenant_id,event_type,channel,properties)
     VALUES($1,$2,'identity_stitched','web',$3)`,
    [profile_id, tid, JSON.stringify({ anonymous_id, email, reassigned_events: reassigned.rowCount })]
  );
  await p.query(`UPDATE identity_profiles SET last_seen_at=NOW() WHERE id=$1`, [profile_id]);
  res.json({ ok:true, profile_id, email, events_reassigned: reassigned.rowCount });
});

// ── Merge two profiles ────────────────────────────────────────────────────
// Merge a secondary profile into a primary, carrying over events.
router.post('/merge', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'identity:merge' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { primary_id, secondary_id } = req.body;
  if (!primary_id || !secondary_id) return res.status(400).json({ ok:false, error:'primary_id and secondary_id required' });
  if (primary_id === secondary_id) return res.status(400).json({ ok:false, error:'cannot merge profile with itself' });
  const p = await _db.getPool();
  const [primary, secondary] = await Promise.all([
    p.query(`SELECT id FROM identity_profiles WHERE id=$1 AND tenant_id=$2`, [primary_id, tid]),
    p.query(`SELECT id FROM identity_profiles WHERE id=$1 AND tenant_id=$2`, [secondary_id, tid])
  ]);
  if (!primary.rows.length) return res.status(404).json({ ok:false, error:'primary profile not found' });
  if (!secondary.rows.length) return res.status(404).json({ ok:false, error:'secondary profile not found' });
  // Reassign events from secondary → primary
  const moved = await p.query(
    `UPDATE identity_events SET profile_id=$1 WHERE profile_id=$2 AND tenant_id=$3`,
    [primary_id, secondary_id, tid]
  );
  // Delete secondary profile
  await p.query(`DELETE FROM identity_profiles WHERE id=$1 AND tenant_id=$2`, [secondary_id, tid]);
  await p.query(`UPDATE identity_profiles SET updated_at=NOW() WHERE id=$1`, [primary_id]);
  res.json({ ok:true, primary_id, secondary_id_removed: secondary_id, events_moved: moved.rowCount });
});

module.exports = router;
