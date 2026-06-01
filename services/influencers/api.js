const express = require('express');
const _db = require('../../db');
const _https = require('https');
const _tenantCtx = require('../tenants/context');
const _vetter = require('./vetter');

const router = express.Router();
const VALID_STATUS = ['prospect','contacted','negotiating','active','declined','inactive'];
const VALID_PLATFORMS = ['instagram','tiktok','youtube','x','linkedin','twitch','facebook','other'];

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _id(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { _err(res, 400, 'bad id'); return null; }
  return id;
}

function _normalize(p = {}) {
  const status = VALID_STATUS.includes(p.status) ? p.status : 'prospect';
  const platform = VALID_PLATFORMS.includes(p.platform) ? p.platform : 'instagram';
  return {
    handle: String(p.handle || '').trim().slice(0, 120),
    platform,
    name: p.name ? String(p.name).slice(0, 200) : null,
    bio: p.bio ? String(p.bio).slice(0, 1000) : null,
    niche: p.niche ? String(p.niche).slice(0, 120) : null,
    country: p.country ? String(p.country).slice(0, 80) : null,
    followers: Number.isFinite(Number(p.followers)) ? Math.max(0, Math.floor(Number(p.followers))) : 0,
    engagement_rate: Number.isFinite(Number(p.engagement_rate)) ? Math.max(0, Math.min(100, Number(p.engagement_rate))) : 0,
    contact_email: p.contact_email ? String(p.contact_email).slice(0, 200) : null,
    contact_phone: p.contact_phone ? String(p.contact_phone).slice(0, 80) : null,
    profile_url: p.profile_url ? String(p.profile_url).slice(0, 500) : null,
    status,
    tags: Array.isArray(p.tags) ? p.tags.map(t => String(t).slice(0, 40)).slice(0, 20) : [],
    owner: p.owner ? String(p.owner).slice(0, 120) : null,
    deal_value: Number.isFinite(Number(p.deal_value)) ? Math.max(0, Number(p.deal_value)) : 0,
    notes: p.notes ? String(p.notes).slice(0, 4000) : null,
  };
}

router.get('/', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'influencers:list' });
    const status = req.query.status && VALID_STATUS.includes(req.query.status) ? req.query.status : null;
    const platform = req.query.platform && VALID_PLATFORMS.includes(req.query.platform) ? req.query.platform : null;
    const search = req.query.q ? '%' + String(req.query.q).slice(0, 100).toLowerCase() + '%' : null;
    const params = [tid]; const where = [`tenant_id=$1`];
    if (status)   { params.push(status);   where.push(`status=$${params.length}`); }
    if (platform) { params.push(platform); where.push(`platform=$${params.length}`); }
    if (search)   { params.push(search);   where.push(`(LOWER(handle) LIKE $${params.length} OR LOWER(COALESCE(name,'')) LIKE $${params.length} OR LOWER(COALESCE(niche,'')) LIKE $${params.length})`); }
    const sql = `SELECT * FROM influencers WHERE ${where.join(' AND ')} ORDER BY followers DESC NULLS LAST, id DESC LIMIT 500`;
    const r = await _db.getPool().query(sql, params);
    const stats = await _db.getPool().query(`SELECT status, COUNT(*)::int AS c, COALESCE(SUM(deal_value),0) AS v FROM influencers WHERE tenant_id=$1 GROUP BY status`, [tid]);
    res.json({ ok:true, influencers: r.rows, stats: stats.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  const id = _id(req, res); if (!id) return;
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'influencers:get' });
    const r = await _db.getPool().query(`SELECT * FROM influencers WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    const out = await _db.getPool().query(`SELECT * FROM influencer_outreach WHERE influencer_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 100`, [id, tid]);
    res.json({ ok:true, influencer: r.rows[0], outreach: out.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const n = _normalize(req.body || {});
  if (!n.handle) return _err(res, 400, 'handle required');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'influencers:create' });
    const r = await _db.getPool().query(`
      INSERT INTO influencers (tenant_id, handle, platform, name, bio, niche, country, followers, engagement_rate,
        contact_email, contact_phone, profile_url, status, tags, owner, deal_value, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (tenant_id, platform, handle) DO UPDATE SET
        name=EXCLUDED.name, bio=EXCLUDED.bio, niche=EXCLUDED.niche, country=EXCLUDED.country,
        followers=EXCLUDED.followers, engagement_rate=EXCLUDED.engagement_rate,
        contact_email=EXCLUDED.contact_email, contact_phone=EXCLUDED.contact_phone, profile_url=EXCLUDED.profile_url,
        status=EXCLUDED.status, tags=EXCLUDED.tags, owner=EXCLUDED.owner, deal_value=EXCLUDED.deal_value,
        notes=EXCLUDED.notes, updated_at=now()
      RETURNING *`, [tid, n.handle, n.platform, n.name, n.bio, n.niche, n.country, n.followers, n.engagement_rate,
        n.contact_email, n.contact_phone, n.profile_url, n.status, JSON.stringify(n.tags), n.owner, n.deal_value, n.notes]);
    res.json({ ok:true, influencer: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.patch('/:id', async (req, res) => {
  const id = _id(req, res); if (!id) return;
  const cur = await _db.getPool().query(`SELECT * FROM influencers WHERE id=$1`, [id]);
  if (!cur.rows[0]) return _err(res, 404, 'not found');
  const n = _normalize({ ...cur.rows[0], ...req.body });
  try {
    const r = await _db.getPool().query(`
      UPDATE influencers SET handle=$1, platform=$2, name=$3, bio=$4, niche=$5, country=$6,
        followers=$7, engagement_rate=$8, contact_email=$9, contact_phone=$10, profile_url=$11,
        status=$12, tags=$13, owner=$14, deal_value=$15, notes=$16, updated_at=now(),
        last_contacted_at=CASE WHEN $12 IN ('contacted','negotiating') AND last_contacted_at IS NULL THEN now() ELSE last_contacted_at END
      WHERE id=$17 RETURNING *`,
      [n.handle, n.platform, n.name, n.bio, n.niche, n.country, n.followers, n.engagement_rate,
       n.contact_email, n.contact_phone, n.profile_url, n.status, JSON.stringify(n.tags), n.owner,
       n.deal_value, n.notes, id]);
    res.json({ ok:true, influencer: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/:id', async (req, res) => {
  const id = _id(req, res); if (!id) return;
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'influencers:delete' });
    await _db.getPool().query(`DELETE FROM influencers WHERE id=$1 AND tenant_id=$2`, [id, tid]); res.json({ ok:true }); }
  catch (e) { _err(res, 500, e.message); }
});

router.post('/:id/outreach', async (req, res) => {
  const id = _id(req, res); if (!id) return;
  const kind = String(req.body?.kind || 'note').slice(0, 40);
  const subject = req.body?.subject ? String(req.body.subject).slice(0, 300) : null;
  const body = req.body?.body ? String(req.body.body).slice(0, 8000) : null;
  const direction = ['outbound','inbound'].includes(req.body?.direction) ? req.body.direction : 'outbound';
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'influencers:outreach' });
    const r = await _db.getPool().query(`
      INSERT INTO influencer_outreach (tenant_id, influencer_id, kind, subject, body, direction, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, id, kind, subject, body, direction, req.body?.created_by || null]);
    await _db.getPool().query(`UPDATE influencers SET last_contacted_at=now(), updated_at=now() WHERE id=$1`, [id]);
    res.json({ ok:true, outreach: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/:id/outreach/:oid', async (req, res) => {
  const id = _id(req, res); if (!id) return;
  const oid = Number(req.params.oid);
  if (!Number.isFinite(oid) || oid <= 0) return _err(res, 400, 'bad oid');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'influencers:delete-outreach' });
    await _db.getPool().query(`DELETE FROM influencer_outreach WHERE id=$1 AND influencer_id=$2 AND tenant_id=$3`, [oid, id, tid]); res.json({ ok:true }); }
  catch (e) { _err(res, 500, e.message); }
});

// T45 — Fake-Detection & Deep Vetting
router.post('/:id/vet', async (req, res) => {
  const id = _id(req, res); if (!id) return;
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'influencers:vet' });
    if (tid == null) return _err(res, 400, 'no_tenant');
    const r = await _db.getPool().query(`SELECT * FROM influencers WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    const inf = r.rows[0];
    const vet = await _vetter.vetInfluencer(inf);
    await _db.getPool().query(
      `UPDATE influencers SET vet_score=$1, vet_risk=$2, vet_flags=$3, vetted_at=now(), updated_at=now() WHERE id=$4`,
      [vet.score, vet.risk_level, JSON.stringify(vet), id]
    );
    res.json({ ok: true, vet, source: vet.source });
  } catch (e) { _err(res, 500, e.message); }
});

// AI-drafted outreach email — uses OpenAI if available, falls back to template
router.post('/:id/draft-email', async (req, res) => {
  const id = _id(req, res); if (!id) return;
  try {
    const r = await _db.getPool().query(`SELECT * FROM influencers WHERE id=$1`, [id]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    const inf = r.rows[0];
    const brand = String(req.body?.brand || 'our brand').slice(0, 120);
    const product = String(req.body?.product || 'our product').slice(0, 200);
    const tone = ['friendly','professional','direct','playful'].includes(req.body?.tone) ? req.body.tone : 'friendly';

    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (key && !/^_DUMMY/i.test(key)) {
      const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You write short, ${tone} influencer outreach emails. Output strict JSON: {"subject":"...","body":"..."} — body has 2-3 short paragraphs, no markdown, ends with a clear ask.` },
          { role: 'user', content: `Influencer: @${inf.handle} (${inf.platform}, ${inf.followers} followers, niche: ${inf.niche || 'unknown'}). Brand: ${brand}. Product: ${product}. Goal: open a paid collaboration conversation.` },
        ],
        temperature: 0.7, max_tokens: 400,
      });
      const data = await new Promise((resolve, reject) => {
        const req2 = _https.request({
          hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
          headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, r2 => { let d=''; r2.on('data', c=>d+=c); r2.on('end',()=>{ try{resolve({status:r2.statusCode,json:JSON.parse(d)})}catch{resolve({status:r2.statusCode,json:{}})} }); });
        req2.on('error', reject); req2.setTimeout(20000, () => req2.destroy(new Error('timeout')));
        req2.write(body); req2.end();
      });
      if (data.status === 200) {
        const raw = (data.json?.choices?.[0]?.message?.content || '').trim().replace(/^```json|```$/g,'').trim();
        try {
          const parsed = JSON.parse(raw);
          return res.json({ ok:true, source:'openai', subject: parsed.subject, body: parsed.body });
        } catch { /* fall through */ }
      }
    }
    // Template fallback
    const subject = `Quick collab idea for @${inf.handle}`;
    const tplBody = `Hey ${inf.name || inf.handle},\n\nWe've been following your ${inf.niche || 'content'} on ${inf.platform} — your audience of ${(inf.followers||0).toLocaleString()} is exactly the crowd we'd love to reach with ${product}.\n\nWe're putting together a paid collaboration round at ${brand} and would love to chat about whether it's a fit. We can move fast and keep creative direction with you.\n\nWould you be open to a quick 15-min call this or next week?\n\nThanks,\n${brand} team`;
    res.json({ ok:true, source:'template', subject, body: tplBody });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
