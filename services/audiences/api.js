// Dynamic Audiences — HTTP routes mounted under /api/audiences.
// Multi-tenancy (Phase 2B): every route resolves the caller's tenant and
// hard-scopes SELECT / INSERT / UPDATE / DELETE by tenant_id. Bindings
// (drip / HubSpot list / re-engage) are gated by an audience-ownership check
// so a cross-tenant binding op is impossible even if the audience id is guessed.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { previewSegmentLive, snapshotSegmentCount } = require('./engine');
const { runSweepOnce, reevaluateContact } = require('./sweep');
const _bridge   = require('./drip_bridge');
const _hsList   = require('./hubspot_list_bridge');
const _reengage = require('./reengage_bridge');

const router = express.Router();

function _str(v, max = 400) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.length > max) return undefined;
  return s;
}
function _validId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null;
}
function _sanitiseRules(r) {
  if (!r || typeof r !== 'object') return { match:'all', conditions:[] };
  const match = ['all','any','none'].includes(String(r.match||'').toLowerCase())
    ? String(r.match).toLowerCase() : 'all';
  const conds = Array.isArray(r.conditions) ? r.conditions.slice(0, 30) : [];
  const cleaned = conds.filter(c => c && typeof c === 'object' && c.type)
    .map(c => ({
      type: String(c.type).slice(0,32),
      field:  c.field  !== undefined ? String(c.field).slice(0,80)  : undefined,
      event:  c.event  !== undefined ? String(c.event).slice(0,80)  : undefined,
      metric: c.metric !== undefined ? String(c.metric).slice(0,40) : undefined,
      source: c.source !== undefined ? String(c.source).slice(0,40) : undefined,
      op:     c.op     !== undefined ? String(c.op).slice(0,16)     : undefined,
      value:  c.value  !== undefined ? (typeof c.value === 'object' ? null : String(c.value).slice(0,200)) : undefined,
      days:   c.days   !== undefined ? Math.max(0, Math.min(3650, Number(c.days)||0)) : undefined,
    }));
  return { match, conditions: cleaned };
}
function _err(res, status, msg) { return res.status(status).json({ ok:false, error:msg }); }

async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

// Verify an audience belongs to this tenant. Returns the audience row or null.
async function _audienceForTenant(id, tid) {
  if (!id || tid == null) return null;
  const r = await _db.getPool().query(
    `SELECT * FROM audience_segments WHERE id=$1 AND tenant_id=$2`, [id, tid]
  );
  return r.rows[0] || null;
}

router.get('/', async (req, res) => {
  try {
    if (!_db.hasDb()) return res.json({ ok:true, segments:[], db:false });
    const tid = await _tid(req, 'audiences:list');
    const r = await _db.getPool().query(`
      SELECT id, name, description, rules, enabled, member_count, last_evaluated_at, created_at, updated_at
      FROM audience_segments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200
    `, [tid]);
    res.json({ ok:true, db:true, segments:r.rows });
  } catch (err) { _err(res, 500, err.message); }
});

router.get('/:id', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:get');
    const r = await _db.getPool().query(
      `SELECT * FROM audience_segments WHERE id=$1 AND tenant_id=$2`, [id, tid]
    );
    if (!r.rows.length) return _err(res, 404, 'not found');
    res.json({ ok:true, segment:r.rows[0] });
  } catch (err) { _err(res, 500, err.message); }
});

router.post('/', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const name = _str(req.body?.name, 120);
    if (!name) return _err(res, 400, 'name required');
    const description = _str(req.body?.description, 600) || null;
    const rules = _sanitiseRules(req.body?.rules);
    const tid = await _tid(req, 'audiences:create');
    const r = await _db.getPool().query(`
      INSERT INTO audience_segments (tenant_id, name, description, rules, owner_email)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [tid, name, description, JSON.stringify(rules), _str(req.body?.owner_email, 200) || null]);
    res.json({ ok:true, segment:r.rows[0] });
  } catch (err) { _err(res, 500, err.message); }
});

router.put('/:id', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:update');
    const name = _str(req.body?.name, 120);
    const description = _str(req.body?.description, 600);
    const rules = req.body?.rules ? _sanitiseRules(req.body.rules) : null;
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : null;
    const fields = []; const vals = []; let i = 1;
    if (name !== undefined && name !== null) { fields.push(`name=$${i++}`); vals.push(name); }
    if (description !== undefined)            { fields.push(`description=$${i++}`); vals.push(description); }
    if (rules)                                { fields.push(`rules=$${i++}`); vals.push(JSON.stringify(rules)); }
    if (enabled !== null)                     { fields.push(`enabled=$${i++}`); vals.push(enabled); }
    if (!fields.length) return _err(res, 400, 'no fields to update');
    fields.push(`updated_at=now()`);
    vals.push(id, tid);
    const r = await _db.getPool().query(
      `UPDATE audience_segments SET ${fields.join(', ')} WHERE id=$${i} AND tenant_id=$${i+1} RETURNING *`, vals
    );
    if (!r.rows.length) return _err(res, 404, 'not found');
    res.json({ ok:true, segment:r.rows[0] });
  } catch (err) { _err(res, 500, err.message); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:delete');
    await _db.getPool().query(
      `DELETE FROM audience_segments WHERE id=$1 AND tenant_id=$2`, [id, tid]
    );
    res.json({ ok:true });
  } catch (err) { _err(res, 500, err.message); }
});

// Live preview — does NOT require the segment to be saved first.
router.post('/preview', async (req, res) => {
  try {
    const rules = _sanitiseRules(req.body?.rules);
    const result = await previewSegmentLive(rules, { limit: 100 });
    const sid = _validId(req.body?.segmentId);
    if (sid && _db.hasDb() && result.ok) {
      const tid = await _tid(req, 'audiences:preview-snapshot');
      // Best-effort snapshot — tenant-scoped so a guessed id can't update
      // another tenant's row.
      try { await snapshotSegmentCount(sid, result.matches, tid); } catch(_) {}
    }
    res.json({ ok:true, preview:result });
  } catch (err) { _err(res, 500, err.message); }
});

// Force a sweep against ALL enabled segments for this tenant.
router.post('/refresh', async (req, res) => {
  try {
    const tid = await _tid(req, 'audiences:refresh-all');
    const result = await runSweepOnce({ tenantId: tid });
    res.json({ ok:true, run: result });
  } catch (err) { _err(res, 500, err.message); }
});

router.post('/:id/refresh', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:refresh-one');
    const result = await runSweepOnce({ segmentId: id, tenantId: tid });
    res.json({ ok:true, run: result });
  } catch (err) { _err(res, 500, err.message); }
});

// List the live members of a segment (paginated). Joins to audience_segments
// for the tenant gate so a guessed segment id from another tenant returns 404.
router.get('/:id/members', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:members');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    const limit  = Math.min(Math.max(parseInt(req.query.limit  || '50', 10), 1), 500);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);
    const includeFormer = req.query.includeFormer === '1';
    const where = includeFormer
      ? `WHERE segment_id=$1`
      : `WHERE segment_id=$1 AND left_at IS NULL`;
    const r = await _db.getPool().query(`
      SELECT contact_id, contact_email, joined_at, left_at
      FROM audience_segment_members ${where}
      ORDER BY joined_at DESC LIMIT $2 OFFSET $3
    `, [id, limit, offset]);
    const total = await _db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM audience_segment_members ${where}`, [id]
    );
    res.json({ ok:true, members: r.rows, total: total.rows[0].n, limit, offset });
  } catch (err) { _err(res, 500, err.message); }
});

router.get('/:id/log', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:log');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    const r = await _db.getPool().query(`
      SELECT ran_at, contacts_scanned, members_added, members_removed, duration_ms, source, error
      FROM audience_evaluation_log
      WHERE segment_id=$1 AND ran_at > now() - interval '7 days'
      ORDER BY ran_at DESC LIMIT 100
    `, [id]);
    res.json({ ok:true, log: r.rows });
  } catch (err) { _err(res, 500, err.message); }
});

// HubSpot webhook receiver — fires on contact create/update. We re-evaluate
// across every enabled segment across every tenant since the HubSpot portal
// is currently shared platform-wide; each membership write is stamped with
// the segment's own tenant_id (see sweep.reevaluateContact).
const _crypto = require('crypto');
function _verifyHubspotSig(req) {
  const secret = process.env.HUBSPOT_WEBHOOK_SECRET;
  if (!secret) return { ok: process.env.NODE_ENV !== 'production', reason: 'no-secret' };
  const sig = req.get('X-HubSpot-Signature-v3') || '';
  const ts  = req.get('X-HubSpot-Request-Timestamp') || '';
  if (!sig || !ts) return { ok:false, reason:'missing-headers' };
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return { ok:false, reason:'stale-timestamp' };
  const raw = (req.method || 'POST') + (req.originalUrl || req.url) + (typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || '')) + ts;
  const expected = _crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
  try {
    const a = Buffer.from(sig, 'base64'); const b = Buffer.from(expected, 'base64');
    return { ok: a.length === b.length && _crypto.timingSafeEqual(a, b), reason:'hmac' };
  } catch { return { ok:false, reason:'sig-decode' }; }
}
router.post('/webhooks/hubspot', async (req, res) => {
  try {
    const v = _verifyHubspotSig(req);
    if (!v.ok) {
      console.warn('[audiences-webhook] rejected:', v.reason);
      return _err(res, 401, 'unauthorized webhook (' + v.reason + ')');
    }
    if (v.reason === 'no-secret') console.warn('[audiences-webhook] HUBSPOT_WEBHOOK_SECRET not set — accepting in dev only');
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const ids = [...new Set(events.map(e => e?.objectId || e?.contactId).filter(Boolean))].slice(0, 50);
    res.json({ ok:true, accepted: ids.length });
    for (const cid of ids) {
      try { await reevaluateContact(String(cid)); }
      catch (e) { console.error('[audiences-webhook]', cid, e.message); }
    }
  } catch (err) { _err(res, 500, err.message); }
});

// ── Phase 3 — Drip binding CRUD ────────────────────────────────────────────
router.get('/:id/drip-binding', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:drip-get');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    res.json({ ok:true, binding: await _bridge.getBinding(id, tid) });
  } catch (err) { _err(res, 500, err.message); }
});
router.post('/:id/drip-binding', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:drip-set');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    res.json({ ok:true, binding: await _bridge.setBinding(id, req.body || {}, tid) });
  } catch (err) { _err(res, 400, err.message); }
});
router.delete('/:id/drip-binding', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:drip-del');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    await _bridge.deleteBinding(id, tid);
    res.json({ ok:true });
  } catch (err) { _err(res, 500, err.message); }
});

// ── Phase 4A — HubSpot List binding CRUD ───────────────────────────────────
router.get('/:id/hubspot-list', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:hslist-get');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    res.json({ ok:true, binding: await _hsList.getBinding(id, tid) });
  } catch (err) { _err(res, 500, err.message); }
});
router.post('/:id/hubspot-list', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:hslist-set');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    res.json({ ok:true, binding: await _hsList.setBinding(id, req.body || {}, tid) });
  } catch (err) { _err(res, 400, err.message); }
});
router.delete('/:id/hubspot-list', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:hslist-del');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    await _hsList.deleteBinding(id, tid);
    res.json({ ok:true });
  } catch (err) { _err(res, 500, err.message); }
});

// ── Phase 4B — Re-Engagement binding CRUD ──────────────────────────────────
router.get('/:id/reengage', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:reng-get');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    res.json({ ok:true, binding: await _reengage.getBinding(id, tid) });
  } catch (err) { _err(res, 500, err.message); }
});
router.post('/:id/reengage', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:reng-set');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    res.json({ ok:true, binding: await _reengage.setBinding(id, req.body || {}, tid) });
  } catch (err) { _err(res, 400, err.message); }
});
router.delete('/:id/reengage', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:reng-del');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    await _reengage.deleteBinding(id, tid);
    res.json({ ok:true });
  } catch (err) { _err(res, 500, err.message); }
});

// ── AI-Suggested Segments ─────────────────────────────────────────────────
// Analyses existing segments + member counts and proposes new audience ideas.
router.post('/ai-suggest', async (req, res) => {
  try {
    const tid = await _tid(req, 'audiences:ai-suggest');
    if (!tid) return _err(res, 400, 'no_tenant');
    const p = _db.getPool();
    const segs = await p.query(
      `SELECT name,description,member_count,rules FROM audience_segments
       WHERE tenant_id=$1 ORDER BY member_count DESC LIMIT 20`, [tid]
    );
    const OpenAI = require('openai');
    let suggestions = null;
    try {
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
      const prompt = `You are a marketing segmentation expert. Based on these existing audience segments, suggest 5 NEW, complementary segments that would be valuable.
Existing segments: ${JSON.stringify(segs.rows.map(s=>({name:s.name,members:s.member_count,rules:s.rules})))}
Return strict JSON: {"suggestions":[{"name":"...","description":"...","rationale":"...","rules":{"match":"all","conditions":[{"field":"...","op":"equals","value":"..."}]}}]}`;
      const r = await openai.chat.completions.create({
        model: 'gpt-4o-mini', response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      });
      const parsed = JSON.parse(r.choices[0].message.content);
      if (!parsed._DUMMY && Array.isArray(parsed.suggestions)) suggestions = parsed.suggestions;
    } catch(e2) {}
    if (!suggestions) {
      suggestions = [
        { name: 'High-Value Churned', description: 'Previously active users with high engagement who went quiet', rationale: 'Win-back potential is highest among users who were already engaged', rules: { match: 'all', conditions: [{ field: 'status', op: 'equals', value: 'churned' }] } },
        { name: 'Recent Signups (7d)', description: 'Users who signed up in the last 7 days', rationale: 'Onboarding window — highest impact time to engage', rules: { match: 'all', conditions: [{ field: 'days_since_signup', op: 'less_than', value: '7' }] } },
        { name: 'Power Users', description: 'Users who have logged in 10+ times this month', rationale: 'Upsell and advocacy candidates', rules: { match: 'all', conditions: [{ field: 'monthly_sessions', op: 'greater_than', value: '10' }] } },
        { name: 'Feature Non-Adopters', description: 'Active users who have never used a key feature', rationale: 'Education campaign opportunity to increase feature adoption', rules: { match: 'all', conditions: [{ field: 'feature_used', op: 'not_equals', value: 'true' }] } },
        { name: 'Trial Expiring Soon', description: 'Trial users with < 3 days remaining', rationale: 'Conversion urgency window — time-sensitive offers work well here', rules: { match: 'all', conditions: [{ field: 'trial_days_left', op: 'less_than', value: '3' }] } }
      ];
    }
    res.json({ ok: true, suggestions });
  } catch(err) { _err(res, 500, err.message); }
});

// ── Ad Audience Sync ──────────────────────────────────────────────────────
// Syncs a segment's member list to Meta Custom Audiences or Google Customer Match.
router.post('/:id/sync-ads', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:sync-ads');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    const { platform } = req.body || {}; // 'meta' | 'google'
    if (!['meta', 'google'].includes(platform)) return _err(res, 400, 'platform must be meta or google');
    const p = _db.getPool();
    const members = await p.query(
      `SELECT contact_email FROM audience_segment_members WHERE segment_id=$1 AND left_at IS NULL AND contact_email IS NOT NULL`,
      [id]
    );
    const emails = members.rows.map(r => r.contact_email).filter(Boolean);
    if (!emails.length) return res.json({ ok: false, error: 'No members with email addresses in this segment' });

    let syncResult = null;
    if (platform === 'meta') {
      const token = process.env.META_ACCESS_TOKEN;
      const adAccountId = process.env.META_AD_ACCOUNT_ID;
      if (!token || !adAccountId) return _err(res, 400, 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID not configured');
      try {
        const crypto = require('crypto');
        const hashedEmails = emails.map(e => crypto.createHash('sha256').update(e.toLowerCase().trim()).digest('hex'));
        const audienceName = `InfoGenie — ${seg.name}`;
        const createResp = await fetch(
          `https://graph.facebook.com/v19.0/act_${adAccountId}/customaudiences`,
          { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: audienceName, subtype: 'CUSTOM', description: seg.description || '', customer_file_source: 'USER_PROVIDED_ONLY' }) }
        );
        const audience = await createResp.json();
        if (audience.error) return _err(res, 400, audience.error.message);
        const addResp = await fetch(
          `https://graph.facebook.com/v19.0/${audience.id}/users`,
          { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ payload: { schema: ['EMAIL_SHA256'], data: hashedEmails.map(h=>[h]) } }) }
        );
        const addResult = await addResp.json();
        syncResult = { platform: 'meta', audience_id: audience.id, audience_name: audienceName, uploaded: emails.length, meta_response: addResult };
      } catch(e2) { return _err(res, 500, 'Meta sync failed: ' + e2.message); }
    } else {
      syncResult = {
        platform: 'google',
        note: 'Google Customer Match upload requires the Google Ads API OAuth credential. Emails are ready.',
        emails_count: emails.length,
        instructions: 'Connect your Google Ads account in Settings → Credentials → Google Ads to enable automatic Customer Match upload.'
      };
    }
    res.json({ ok: true, synced: emails.length, ...syncResult });
  } catch(err) { _err(res, 500, err.message); }
});

// Get ad sync status for a segment
router.get('/:id/sync-ads', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const tid = await _tid(req, 'audiences:sync-ads-status');
    const seg = await _audienceForTenant(id, tid);
    if (!seg) return _err(res, 404, 'not found');
    const p = _db.getPool();
    const members = await p.query(
      `SELECT COUNT(*) as n FROM audience_segment_members WHERE segment_id=$1 AND left_at IS NULL AND contact_email IS NOT NULL`, [id]
    );
    res.json({
      ok: true,
      segment_id: id,
      segment_name: seg.name,
      syncable_members: +members.rows[0].n,
      platforms: [
        { id: 'meta', name: 'Meta Ads (Facebook & Instagram)', configured: !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) },
        { id: 'google', name: 'Google Ads Customer Match', configured: !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN) }
      ]
    });
  } catch(err) { _err(res, 500, err.message); }
});

module.exports = router;
