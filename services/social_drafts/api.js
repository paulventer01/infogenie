// Social drafts — tenant-scoped planning layer on top of Zernio Social Publisher.
// Drafts live in Postgres (or an in-memory fallback when DATABASE_URL is absent)
// and publish via /api/social-publisher/post.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const STATUSES = ['draft', 'pending_approval', 'approved', 'scheduled', 'published', 'failed'];
const PLATFORMS = [
  'twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube',
  'pinterest', 'reddit', 'bluesky', 'threads', 'googlebusiness',
  'telegram', 'snapchat', 'whatsapp', 'discord',
];

const _mem = new Map(); // tenantId -> drafts[]
let _memSeq = 1;

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  // No-DB / demo fallback so calendar drafts still work in preview environments
  if (!_db.hasDb()) return 1;
  return null;
}

function _normalizePlatforms(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((p) => String(p).toLowerCase().trim()).filter((p) => PLATFORMS.includes(p)))];
}

function _normalizeMedia(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 4);
}

function _parseDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function _rowOut(r) {
  if (!r) return r;
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    profile_id: r.profile_id,
    status: r.status,
    text: r.text || '',
    media_urls: Array.isArray(r.media_urls) ? r.media_urls : (typeof r.media_urls === 'string' ? JSON.parse(r.media_urls || '[]') : []),
    platforms: Array.isArray(r.platforms) ? r.platforms : (typeof r.platforms === 'string' ? JSON.parse(r.platforms || '[]') : []),
    scheduled_for: r.scheduled_for || null,
    zernio_post_id: r.zernio_post_id || null,
    meta: r.meta && typeof r.meta === 'object' ? r.meta : (typeof r.meta === 'string' ? JSON.parse(r.meta || '{}') : {}),
    created_by: r.created_by || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function _memList(tid) {
  if (!_mem.has(tid)) _mem.set(tid, []);
  return _mem.get(tid);
}

async function _listDrafts(tid, { profileId, from, to, status } = {}) {
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const params = [tid];
    const clauses = ['tenant_id=$1'];
    if (profileId) {
      params.push(profileId);
      clauses.push(`profile_id=$${params.length}`);
    }
    if (from) {
      params.push(from);
      clauses.push(`(scheduled_for IS NULL OR scheduled_for >= $${params.length})`);
    }
    if (to) {
      params.push(to);
      clauses.push(`(scheduled_for IS NULL OR scheduled_for <= $${params.length})`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status=$${params.length}`);
    }
    const r = await p.query(
      `SELECT * FROM social_post_drafts WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(scheduled_for, created_at) ASC`,
      params,
    );
    return r.rows.map(_rowOut);
  }
  let rows = _memList(tid).map((r) => ({ ...r }));
  if (profileId) rows = rows.filter((r) => r.profile_id === profileId);
  if (status) rows = rows.filter((r) => r.status === status);
  if (from) {
    const f = new Date(from).getTime();
    rows = rows.filter((r) => !r.scheduled_for || new Date(r.scheduled_for).getTime() >= f);
  }
  if (to) {
    const t = new Date(to).getTime();
    rows = rows.filter((r) => !r.scheduled_for || new Date(r.scheduled_for).getTime() <= t);
  }
  rows.sort((a, b) => new Date(a.scheduled_for || a.created_at || 0) - new Date(b.scheduled_for || b.created_at || 0));
  return rows.map(_rowOut);
}

async function _getDraft(tid, id) {
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(`SELECT * FROM social_post_drafts WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    return r.rows[0] ? _rowOut(r.rows[0]) : null;
  }
  return _memList(tid).find((r) => String(r.id) === String(id)) || null;
}

async function _insertDraft(tid, fields) {
  const now = new Date().toISOString();
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(
      `INSERT INTO social_post_drafts
        (tenant_id, profile_id, status, text, media_urls, platforms, scheduled_for, zernio_post_id, meta, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10)
       RETURNING *`,
      [
        tid,
        fields.profile_id,
        fields.status || 'draft',
        fields.text || '',
        JSON.stringify(fields.media_urls || []),
        JSON.stringify(fields.platforms || []),
        fields.scheduled_for || null,
        fields.zernio_post_id || null,
        JSON.stringify(fields.meta || {}),
        fields.created_by || null,
      ],
    );
    return _rowOut(r.rows[0]);
  }
  const row = {
    id: _memSeq++,
    tenant_id: tid,
    profile_id: fields.profile_id,
    status: fields.status || 'draft',
    text: fields.text || '',
    media_urls: fields.media_urls || [],
    platforms: fields.platforms || [],
    scheduled_for: fields.scheduled_for || null,
    zernio_post_id: fields.zernio_post_id || null,
    meta: fields.meta || {},
    created_by: fields.created_by || null,
    created_at: now,
    updated_at: now,
  };
  _memList(tid).push(row);
  return _rowOut(row);
}

async function _updateDraft(tid, id, patch) {
  const existing = await _getDraft(tid, id);
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
    media_urls: patch.media_urls !== undefined ? patch.media_urls : existing.media_urls,
    platforms: patch.platforms !== undefined ? patch.platforms : existing.platforms,
    meta: patch.meta !== undefined ? { ...existing.meta, ...patch.meta } : existing.meta,
    updated_at: new Date().toISOString(),
  };
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(
      `UPDATE social_post_drafts SET
         profile_id=$1, status=$2, text=$3,
         media_urls=$4::jsonb, platforms=$5::jsonb,
         scheduled_for=$6, zernio_post_id=$7, meta=$8::jsonb,
         updated_at=NOW()
       WHERE id=$9 AND tenant_id=$10 RETURNING *`,
      [
        next.profile_id,
        next.status,
        next.text || '',
        JSON.stringify(next.media_urls || []),
        JSON.stringify(next.platforms || []),
        next.scheduled_for || null,
        next.zernio_post_id || null,
        JSON.stringify(next.meta || {}),
        id,
        tid,
      ],
    );
    return r.rows[0] ? _rowOut(r.rows[0]) : null;
  }
  const list = _memList(tid);
  const idx = list.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return null;
  list[idx] = next;
  return _rowOut(next);
}

async function _deleteDraft(tid, id) {
  if (_db.hasDb()) {
    const p = await _db.getPool();
    const r = await p.query(`DELETE FROM social_post_drafts WHERE id=$1 AND tenant_id=$2 RETURNING id`, [id, tid]);
    return r.rowCount > 0;
  }
  const list = _memList(tid);
  const before = list.length;
  const next = list.filter((r) => String(r.id) !== String(id));
  _mem.set(tid, next);
  return next.length < before;
}

async function _publishViaZernio(_req, draft) {
  const https = require('https');
  const key = process.env.ZERNIO_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) {
    return { ok: false, error: 'ZERNIO_API_KEY required — add it as a Replit Secret.' };
  }
  const payload = {
    text: draft.text || '',
    platforms: draft.platforms || [],
    profileId: draft.profile_id,
  };
  if (draft.media_urls?.length) payload.mediaUrls = draft.media_urls;
  if (draft.scheduled_for) payload.scheduledFor = draft.scheduled_for;

  return await new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const r = https.request({
      hostname: 'zernio.com',
      path: '/api/v1/posts',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (resp) => {
      let d = '';
      resp.on('data', (c) => { d += c; });
      resp.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            resolve({ ok: true, post: j.post || j.data || j });
          } else {
            resolve({ ok: false, error: j.error?.message || j.error || j.message || `zernio ${resp.statusCode}` });
          }
        } catch (e) {
          resolve({ ok: false, error: `parse failed: ${d.slice(0, 200)}` });
        }
      });
    });
    r.on('error', (e) => resolve({ ok: false, error: e.message }));
    r.setTimeout(30000, () => { r.destroy(); resolve({ ok: false, error: 'zernio timeout (30s)' }); });
    r.write(data);
    r.end();
  });
}

router.get('/test', _safeAsync(async (req, res) => {
  res.json({
    ok: true,
    name: 'Social Drafts',
    statuses: STATUSES,
    platforms: PLATFORMS,
    db: !!(_db.hasDb && _db.hasDb()),
  });
}));

router.get('/list', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  const profileId = String(req.query.profileId || '').trim() || null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const drafts = await _listDrafts(tid, { profileId, from, to, status });
  res.json({ ok: true, drafts, source: _db.hasDb() ? 'db' : 'memory' });
}));

router.post('/', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const body = req.body || {};
  const profile_id = String(body.profile_id || body.profileId || '').trim();
  if (!profile_id) return _err(res, 400, 'profile_id required');
  const platforms = _normalizePlatforms(body.platforms);
  const text = String(body.text || '').trim();
  const media_urls = _normalizeMedia(body.media_urls || body.mediaUrls || []);
  if (!text && !media_urls.length) return _err(res, 400, 'text or media_urls required');
  const scheduled_for = _parseDate(body.scheduled_for || body.scheduledFor);
  const status = STATUSES.includes(body.status) ? body.status : 'draft';
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const draft = await _insertDraft(tid, {
    profile_id,
    status,
    text,
    media_urls,
    platforms,
    scheduled_for,
    meta,
    created_by: req.user?.email || req.user?.id || null,
  });
  res.json({ ok: true, draft });
}));

router.post('/bulk', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:bulk');
  if (!tid) return _err(res, 400, 'no_tenant');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const profile_id = String(req.body?.profile_id || req.body?.profileId || '').trim();
  if (!profile_id) return _err(res, 400, 'profile_id required');
  if (!items.length) return _err(res, 400, 'items required');
  const created = [];
  for (const it of items.slice(0, 100)) {
    const platforms = _normalizePlatforms(it.platforms || (it.platform ? [it.platform] : []));
    const text = String(it.text || it.caption || it.copy || '').trim();
    const media_urls = _normalizeMedia(it.media_urls || it.mediaUrls || []);
    if (!text && !media_urls.length) continue;
    let scheduled_for = _parseDate(it.scheduled_for || it.scheduledFor);
    if (!scheduled_for && it.scheduledDate) {
      const t = it.scheduledTime || '09:00';
      scheduled_for = _parseDate(`${it.scheduledDate}T${t}`);
    }
    const draft = await _insertDraft(tid, {
      profile_id,
      status: 'draft',
      text,
      media_urls,
      platforms,
      scheduled_for,
      meta: {
        imported: true,
        funnel_stage: it.funnelStage || it.funnel_stage || null,
        archetype_id: it.archetypeId || it.archetype_id || null,
        ...(it.meta || {}),
      },
      created_by: req.user?.email || req.user?.id || null,
    });
    created.push(draft);
  }
  res.json({ ok: true, created: created.length, drafts: created });
}));

router.get('/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:get');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');
  res.json({ ok: true, draft });
}));

router.patch('/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:patch');
  if (!tid) return _err(res, 400, 'no_tenant');
  const existing = await _getDraft(tid, req.params.id);
  if (!existing) return _err(res, 404, 'not found');
  if (existing.status === 'pending_approval') {
    return _err(res, 400, 'Draft is pending approval — withdraw approval first or wait for a decision.');
  }
  const body = req.body || {};
  const patch = {};
  if (body.profile_id != null || body.profileId != null) {
    patch.profile_id = String(body.profile_id || body.profileId).trim();
  }
  if (body.text != null) patch.text = String(body.text);
  if (body.media_urls != null || body.mediaUrls != null) {
    patch.media_urls = _normalizeMedia(body.media_urls || body.mediaUrls);
  }
  if (body.platforms != null) patch.platforms = _normalizePlatforms(body.platforms);
  if (body.scheduled_for !== undefined || body.scheduledFor !== undefined) {
    patch.scheduled_for = _parseDate(body.scheduled_for !== undefined ? body.scheduled_for : body.scheduledFor);
  }
  if (body.status != null && STATUSES.includes(body.status)) patch.status = body.status;
  if (body.meta != null && typeof body.meta === 'object') patch.meta = body.meta;
  const draft = await _updateDraft(tid, req.params.id, patch);
  res.json({ ok: true, draft });
}));

router.post('/:id/publish', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:publish');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');
  if (draft.status === 'pending_approval') {
    return _err(res, 400, 'Draft is pending approval and cannot be published yet.');
  }
  if (!draft.platforms?.length) return _err(res, 400, 'select at least one platform on the draft');
  if (!draft.text && !(draft.media_urls || []).length) return _err(res, 400, 'draft has no text or media');

  const result = await _publishViaZernio(req, draft);
  if (!result.ok) {
    await _updateDraft(tid, draft.id, { status: 'failed', meta: { ...(draft.meta || {}), last_error: result.error } });
    return _err(res, 400, result.error);
  }
  const zid = result.post?._id || result.post?.id || null;
  const nextStatus = draft.scheduled_for ? 'scheduled' : 'published';
  const updated = await _updateDraft(tid, draft.id, {
    status: nextStatus,
    zernio_post_id: zid ? String(zid) : draft.zernio_post_id,
    meta: { ...(draft.meta || {}), published_at: new Date().toISOString() },
  });
  res.json({ ok: true, draft: updated, post: result.post, scheduled: !!draft.scheduled_for });
}));

router.delete('/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-drafts:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  const draft = await _getDraft(tid, req.params.id);
  if (!draft) return _err(res, 404, 'not found');

  // Best-effort cancel on Zernio if we have a scheduled post id
  if (draft.zernio_post_id && process.env.ZERNIO_API_KEY && !/^_DUMMY/i.test(process.env.ZERNIO_API_KEY)) {
    try {
      const https = require('https');
      await new Promise((resolve) => {
        const r = https.request({
          hostname: 'zernio.com',
          path: `/api/v1/posts/${encodeURIComponent(draft.zernio_post_id)}`,
          method: 'DELETE',
          headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` },
        }, (resp) => { resp.resume(); resp.on('end', resolve); });
        r.on('error', () => resolve());
        r.setTimeout(10000, () => { r.destroy(); resolve(); });
        r.end();
      });
    } catch (_) { /* non-fatal */ }
  }

  const ok = await _deleteDraft(tid, req.params.id);
  res.json({ ok });
}));

// Test helpers
router._mem = _mem;
router._resetMem = () => { _mem.clear(); _memSeq = 1; };

module.exports = router;
