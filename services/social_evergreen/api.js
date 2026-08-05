// Evergreen / recurring social posts — republish on an interval.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const _mem = new Map(); // tid -> rules[]
let _seq = 1;

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  if (!_db.hasDb()) return 1;
  return null;
}

function _list(tid) {
  if (!_mem.has(tid)) _mem.set(tid, []);
  return _mem.get(tid);
}

async function _ensureSchema() {
  if (!_db.hasDb()) return;
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS social_evergreen_posts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL,
      source_draft_id INT,
      profile_id VARCHAR(80) NOT NULL,
      text TEXT,
      media_urls JSONB DEFAULT '[]',
      platforms JSONB DEFAULT '[]',
      interval_days INT NOT NULL DEFAULT 30,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_published_at TIMESTAMPTZ,
      max_reposts INT,
      repost_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_social_evergreen_next
      ON social_evergreen_posts(is_active, next_run_at);
  `);
}

async function _listRules(tid) {
  if (_db.hasDb()) {
    try {
      await _ensureSchema();
      const p = await _db.getPool();
      const r = await p.query(
        `SELECT * FROM social_evergreen_posts WHERE tenant_id=$1 ORDER BY next_run_at ASC`,
        [tid],
      );
      return r.rows.map(_row);
    } catch (_) {}
  }
  return _list(tid).map((r) => ({ ...r }));
}

function _row(r) {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    source_draft_id: r.source_draft_id,
    profile_id: r.profile_id,
    text: r.text || '',
    media_urls: Array.isArray(r.media_urls) ? r.media_urls : [],
    platforms: Array.isArray(r.platforms) ? r.platforms : [],
    interval_days: Number(r.interval_days) || 30,
    next_run_at: r.next_run_at,
    last_published_at: r.last_published_at || null,
    max_reposts: r.max_reposts == null ? null : Number(r.max_reposts),
    repost_count: Number(r.repost_count) || 0,
    is_active: r.is_active !== false,
    created_at: r.created_at,
  };
}

router.get('/list', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'evergreen:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  res.json({ ok: true, rules: await _listRules(tid) });
}));

router.post('/', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'evergreen:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const body = req.body || {};
  const profile_id = String(body.profile_id || body.profileId || '').trim();
  const text = String(body.text || '').trim();
  const platforms = Array.isArray(body.platforms) ? body.platforms.map((p) => String(p).toLowerCase()) : [];
  if (!profile_id) return _err(res, 400, 'profile_id required');
  if (!text) return _err(res, 400, 'text required');
  if (!platforms.length) return _err(res, 400, 'platforms required');
  const interval_days = Math.max(1, Math.min(365, Number(body.interval_days) || 30));
  const max_reposts = body.max_reposts != null ? Number(body.max_reposts) : null;
  const next_run_at = body.next_run_at
    ? new Date(body.next_run_at).toISOString()
    : new Date(Date.now() + interval_days * 86400000).toISOString();
  const media_urls = Array.isArray(body.media_urls) ? body.media_urls : [];
  const source_draft_id = body.source_draft_id || body.sourceDraftId || null;

  if (_db.hasDb()) {
    try {
      await _ensureSchema();
      const p = await _db.getPool();
      const r = await p.query(
        `INSERT INTO social_evergreen_posts
          (tenant_id,source_draft_id,profile_id,text,media_urls,platforms,interval_days,next_run_at,max_reposts)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) RETURNING *`,
        [tid, source_draft_id, profile_id, text, JSON.stringify(media_urls), JSON.stringify(platforms), interval_days, next_run_at, max_reposts],
      );
      return res.json({ ok: true, rule: _row(r.rows[0]) });
    } catch (e) {
      return _err(res, 500, e.message);
    }
  }

  const rule = {
    id: _seq++,
    tenant_id: tid,
    source_draft_id,
    profile_id,
    text,
    media_urls,
    platforms,
    interval_days,
    next_run_at,
    last_published_at: null,
    max_reposts,
    repost_count: 0,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  _list(tid).push(rule);
  res.json({ ok: true, rule });
}));

router.patch('/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'evergreen:patch');
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = req.params.id;
  const body = req.body || {};

  if (_db.hasDb()) {
    try {
      await _ensureSchema();
      const p = await _db.getPool();
      const r = await p.query(
        `UPDATE social_evergreen_posts SET
           is_active=COALESCE($1,is_active),
           interval_days=COALESCE($2,interval_days),
           max_reposts=COALESCE($3,max_reposts),
           next_run_at=COALESCE($4,next_run_at)
         WHERE id=$5 AND tenant_id=$6 RETURNING *`,
        [
          body.is_active != null ? !!body.is_active : null,
          body.interval_days != null ? Number(body.interval_days) : null,
          body.max_reposts !== undefined ? body.max_reposts : null,
          body.next_run_at || null,
          id,
          tid,
        ],
      );
      if (!r.rows.length) return _err(res, 404, 'not found');
      return res.json({ ok: true, rule: _row(r.rows[0]) });
    } catch (e) {
      return _err(res, 500, e.message);
    }
  }

  const list = _list(tid);
  const idx = list.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return _err(res, 404, 'not found');
  if (body.is_active != null) list[idx].is_active = !!body.is_active;
  if (body.interval_days != null) list[idx].interval_days = Number(body.interval_days);
  if (body.max_reposts !== undefined) list[idx].max_reposts = body.max_reposts;
  if (body.next_run_at) list[idx].next_run_at = body.next_run_at;
  res.json({ ok: true, rule: list[idx] });
}));

router.delete('/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'evergreen:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  if (_db.hasDb()) {
    try {
      await _ensureSchema();
      const p = await _db.getPool();
      await p.query(`DELETE FROM social_evergreen_posts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      return res.json({ ok: true });
    } catch (e) {
      return _err(res, 500, e.message);
    }
  }
  const next = _list(tid).filter((r) => String(r.id) !== String(req.params.id));
  _mem.set(tid, next);
  res.json({ ok: true });
}));

async function runDue(now = new Date()) {
  const draftsApi = require('../social_drafts/api');
  const results = [];
  const due = [];

  if (_db.hasDb()) {
    try {
      await _ensureSchema();
      const p = await _db.getPool();
      const r = await p.query(
        `SELECT * FROM social_evergreen_posts WHERE is_active=TRUE AND next_run_at <= $1 LIMIT 50`,
        [now.toISOString()],
      );
      due.push(...r.rows.map(_row));
    } catch (_) {}
  } else {
    for (const [tid, rules] of _mem.entries()) {
      for (const rule of rules) {
        if (rule.is_active && new Date(rule.next_run_at) <= now) due.push({ ...rule, tenant_id: tid });
      }
    }
  }

  for (const rule of due) {
    if (rule.max_reposts != null && rule.repost_count >= rule.max_reposts) {
      await _deactivate(rule);
      continue;
    }
    try {
      const child = await draftsApi._insertDraft(rule.tenant_id, {
        profile_id: rule.profile_id,
        status: 'draft',
        text: rule.text,
        media_urls: rule.media_urls || [],
        platforms: rule.platforms || [],
        scheduled_for: now.toISOString(),
        meta: { evergreen_rule_id: rule.id, evergreen: true },
        created_by: 'social_evergreen',
      });
      // Leave as scheduled draft — publish when Zernio key present via approve helper skip path
      await draftsApi._updateDraft(rule.tenant_id, child.id, { status: 'scheduled' });
      await _bump(rule, now);
      results.push({ ok: true, rule_id: rule.id, draft_id: child.id });
    } catch (e) {
      results.push({ ok: false, rule_id: rule.id, error: e.message });
    }
  }
  return results;
}

async function _bump(rule, now) {
  const next = new Date(now.getTime() + rule.interval_days * 86400000).toISOString();
  if (_db.hasDb()) {
    try {
      const p = await _db.getPool();
      await p.query(
        `UPDATE social_evergreen_posts SET repost_count=repost_count+1, last_published_at=$1, next_run_at=$2 WHERE id=$3`,
        [now.toISOString(), next, rule.id],
      );
      return;
    } catch (_) {}
  }
  const list = _list(rule.tenant_id);
  const row = list.find((r) => String(r.id) === String(rule.id));
  if (row) {
    row.repost_count = (row.repost_count || 0) + 1;
    row.last_published_at = now.toISOString();
    row.next_run_at = next;
  }
}

async function _deactivate(rule) {
  if (_db.hasDb()) {
    try {
      const p = await _db.getPool();
      await p.query(`UPDATE social_evergreen_posts SET is_active=FALSE WHERE id=$1`, [rule.id]);
      return;
    } catch (_) {}
  }
  const row = _list(rule.tenant_id).find((r) => String(r.id) === String(rule.id));
  if (row) row.is_active = false;
}

router.post('/run-due', _safeAsync(async (req, res) => {
  const results = await runDue();
  res.json({ ok: true, processed: results.length, results });
}));

/**
 * Suggest evergreen candidates from post performance + marketing memory outcomes.
 * Loop-engineering: plan the next cycle from measured results, not gut feel.
 */
router.get('/suggest-winners', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'evergreen:suggest-winners');
  if (!tid) return _err(res, 400, 'no_tenant');
  const profileId = String(req.query.profileId || req.query.profile_id || '').trim();
  const winners = [];

  // 1) Live Zernio post performance when available
  if (profileId && process.env.ZERNIO_API_KEY && !/^_DUMMY/i.test(process.env.ZERNIO_API_KEY)) {
    try {
      // Reuse publisher enrichment by calling internal logic via HTTP-less require is hard;
      // pull posts list and score heuristically from engagement fields.
      const publisher = require('../social_publisher/api');
      void publisher;
      const https = require('https');
      const posts = await new Promise((resolve) => {
        const r = https.request({
          hostname: 'zernio.com',
          path: `/api/v1/posts?profileId=${encodeURIComponent(profileId)}`,
          method: 'GET',
          headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` },
        }, (resp) => {
          let d = '';
          resp.on('data', (c) => { d += c; });
          resp.on('end', () => {
            try {
              const j = d ? JSON.parse(d) : {};
              resolve(j.posts || j.data || (Array.isArray(j) ? j : []));
            } catch { resolve([]); }
          });
        });
        r.on('error', () => resolve([]));
        r.setTimeout(15000, () => { r.destroy(); resolve([]); });
        r.end();
      });
      for (const p of posts) {
        const e = p?.analytics || p?.engagement || p?.stats || {};
        const eng = Number(e.likes || 0) + Number(e.comments || 0) + Number(e.shares || 0) + Number(e.clicks || 0);
        const text = String(p.text || p.content || p.caption || '').trim();
        if (!text || eng < 1) continue;
        winners.push({
          source: 'zernio',
          text,
          platforms: p.platforms || [p.platform].filter(Boolean),
          engTotal: eng,
          publishedAt: p.publishedAt || p.scheduledFor || null,
        });
      }
    } catch (_) {}
  }

  // 2) GSC social × search — Instagram/TikTok/YouTube/X earning Google clicks/impressions
  let gsc_social = null;
  try {
    const { fetchSocialSearchWinners } = require('../gsc_social_search/winners');
    gsc_social = await fetchSocialSearchWinners({
      siteUrl: req.query.siteUrl || req.query.site_url || process.env.GSC_SITE_URL,
      days: Number(req.query.days) || 28,
      limit: 8,
      allowDemo: !winners.length, // only inject demo GSC rows if we have nothing else yet
    });
    for (const w of gsc_social.winners || []) {
      // Prefer live GSC; skip pure demo when we already have zernio/memory rows
      if (w.source === 'gsc_search_demo' && winners.length) continue;
      winners.push({
        ...w,
        // Boost search-channel winners so they compete with native eng scores
        engTotal: Math.round((w.engTotal || 0) * (w.source === 'gsc_search' ? 1.15 : 1)),
      });
    }
  } catch (_) {}

  // 3) Marketing memory recent outcomes (always available as fallback / supplement)
  try {
    const { buildContextPack } = require('../ai_governance/context_pack');
    const pack = await buildContextPack({
      tenantId: tid,
      question: 'top performing social posts and campaign results',
      surface: 'evergreen_winners',
      limit: 4, // lean context — efficient cascade surface
    });
    for (const n of [...(pack.recent_outcomes || []), ...(pack.memory_nodes || [])]) {
      const text = String(n.summary || '').trim();
      if (!text || text.length < 20) continue;
      winners.push({
        source: 'memory',
        text,
        platforms: ['instagram', 'linkedin'],
        engTotal: Math.round((n.importance_score || n.score || 0.5) * 100),
        memory_id: n.id,
        node_type: n.node_type,
      });
    }
  } catch (_) {}

  // 4) Demo fallback so UI always has something to plan from
  if (!winners.length) {
    winners.push(
      {
        source: 'demo',
        text: 'Unpopular opinion: your content calendar does not need more posts — it needs sharper hooks. Here is the 3-line framework we use.',
        platforms: ['instagram', 'linkedin'],
        engTotal: 420,
      },
      {
        source: 'demo',
        text: 'We cut ad spend 18% and ROAS went up. The lever was creative refresh cadence — not bid strategy.',
        platforms: ['linkedin', 'twitter'],
        engTotal: 310,
      },
    );
  }

  winners.sort((a, b) => (b.engTotal || 0) - (a.engTotal || 0));
  res.json({
    ok: true,
    winners: winners.slice(0, 10),
    profileId: profileId || null,
    channels: {
      zernio: winners.some((w) => w.source === 'zernio'),
      gsc_search: winners.some((w) => w.source === 'gsc_search' || w.source === 'gsc_search_demo'),
      memory: winners.some((w) => w.source === 'memory'),
    },
    gsc_social: gsc_social
      ? { configured: gsc_social.configured, source: gsc_social.source, siteUrl: gsc_social.siteUrl, note: gsc_social.note }
      : null,
  });
}));

router.post('/from-winners', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'evergreen:from-winners');
  if (!tid) return _err(res, 400, 'no_tenant');
  const profile_id = String(req.body?.profile_id || req.body?.profileId || '').trim();
  if (!profile_id) return _err(res, 400, 'profile_id required');
  const interval_days = Math.max(1, Math.min(365, Number(req.body?.interval_days) || 30));
  let items = Array.isArray(req.body?.winners) ? req.body.winners : [];

  if (!items.length) {
    // Auto-fetch winners
    const fakeReq = { query: { profileId: profile_id }, user: req.user };
    // Inline reuse: call suggest logic by re-running lightweight path
    const suggestRes = await (async () => {
      // Minimal duplicate of suggest for self-contained create
      try {
        const { buildContextPack } = require('../ai_governance/context_pack');
        const pack = await buildContextPack({
          tenantId: tid,
          question: 'winning social posts',
          surface: 'evergreen_winners',
          limit: 5,
        });
        return (pack.recent_outcomes || pack.memory_nodes || []).map((n) => ({
          text: n.summary,
          platforms: ['instagram', 'linkedin'],
          engTotal: Math.round((n.importance_score || n.score || 0.5) * 100),
        }));
      } catch {
        return [{
          text: 'Unpopular opinion: your content calendar does not need more posts — it needs sharper hooks.',
          platforms: ['instagram', 'linkedin'],
          engTotal: 100,
        }];
      }
    })();
    items = suggestRes;
    void fakeReq;
  }

  const created = [];
  for (const [i, w] of items.slice(0, 5).entries()) {
    const text = String(w.text || '').trim();
    if (!text) continue;
    const platforms = Array.isArray(w.platforms) && w.platforms.length
      ? w.platforms.map((p) => String(p).toLowerCase())
      : ['instagram'];
    const next_run_at = new Date(Date.now() + (i + 1) * interval_days * 86400000).toISOString();
    const body = {
      profile_id,
      text,
      platforms,
      media_urls: w.media_urls || [],
      interval_days,
      next_run_at,
      max_reposts: w.max_reposts != null ? w.max_reposts : null,
    };
    // Create via same path as POST /
    if (_db.hasDb()) {
      try {
        await _ensureSchema();
        const p = await _db.getPool();
        const r = await p.query(
          `INSERT INTO social_evergreen_posts
            (tenant_id,source_draft_id,profile_id,text,media_urls,platforms,interval_days,next_run_at,max_reposts)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) RETURNING *`,
          [tid, null, profile_id, text, JSON.stringify(body.media_urls), JSON.stringify(platforms), interval_days, next_run_at, body.max_reposts],
        );
        created.push(_row(r.rows[0]));
        continue;
      } catch (_) {}
    }
    const rule = {
      id: _seq++,
      tenant_id: tid,
      source_draft_id: null,
      profile_id,
      text,
      media_urls: body.media_urls,
      platforms,
      interval_days,
      next_run_at,
      last_published_at: null,
      max_reposts: body.max_reposts,
      repost_count: 0,
      is_active: true,
      created_at: new Date().toISOString(),
      from_winner: true,
      engTotal: w.engTotal || null,
    };
    _list(tid).push(rule);
    created.push(rule);
  }

  res.json({ ok: true, created: created.length, rules: created });
}));

router._runDue = runDue;
router._resetMem = () => { _mem.clear(); _seq = 1; };
router._listForTenant = (tid) => _list(tid).map((r) => ({ ...r }));

module.exports = router;
