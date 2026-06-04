const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

const MODES      = ['article', 'affiliation', 'ecommerce', 'local', 'discovery'];
const FREQS      = ['daily', 'every3days', 'weekly', 'biweekly', 'monthly'];
const WP_STATUSES = ['draft', 'publish', 'pending'];

function _nextRunAt(frequency, from) {
  const d = from ? new Date(from) : new Date();
  const days = { daily: 1, every3days: 3, weekly: 7, biweekly: 14, monthly: 30 };
  d.setDate(d.getDate() + (days[frequency] || 7));
  return d;
}

// ── POST /schedules — create a new autopilot schedule ────────────────────
router.post('/schedules', async (req, res) => {
  const name         = String(req.body?.name         || '').trim().slice(0, 100);
  const brand        = String(req.body?.brand        || '').trim().slice(0, 100);
  const keyword      = String(req.body?.keyword      || '').trim().slice(0, 200);
  const mode         = MODES.includes(req.body?.mode) ? req.body.mode : 'article';
  const frequency    = FREQS.includes(req.body?.frequency) ? req.body.frequency : 'weekly';
  const auto_publish = Boolean(req.body?.auto_publish);
  const wp_status    = WP_STATUSES.includes(req.body?.wp_status) ? req.body.wp_status : 'draft';
  const wp_site_id   = req.body?.wp_site_id ? Number(req.body.wp_site_id) : null;
  const channels     = Array.isArray(req.body?.channels) ? req.body.channels.slice(0, 6) : ['blog'];
  const location     = String(req.body?.location     || '').trim().slice(0, 100);

  if (!name)    return _err(res, 400, 'name required');
  if (!keyword) return _err(res, 400, 'keyword required');
  if (!_db.hasDb()) return _err(res, 503, 'no-db');

  const tid = await _tenantCtx.resolveTenantId(req, { label: 'autopilot:create' });

  // Validate wp_site_id belongs to this tenant
  if (wp_site_id) {
    const sr = await _db.getPool().query(
      `SELECT id FROM wordpress_sites WHERE id=$1 AND tenant_id=$2 AND status='active'`, [wp_site_id, tid]
    );
    if (!sr.rows[0]) return _err(res, 400, 'WordPress site not found or not connected');
  }

  const r = await _db.getPool().query(
    `INSERT INTO autopilot_schedules
       (tenant_id, name, brand, keyword, mode, channels, frequency, wp_site_id, auto_publish, wp_status, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [tid, name, brand || keyword, keyword, mode, JSON.stringify(channels),
     frequency, wp_site_id || null, auto_publish, wp_status, _nextRunAt(frequency)]
  );
  res.json({ ok: true, schedule: r.rows[0] });
});

// ── GET /schedules ────────────────────────────────────────────────────────
router.get('/schedules', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, schedules: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'autopilot:list' });
  const r = await _db.getPool().query(
    `SELECT s.*, w.name as wp_site_name, w.site_url as wp_site_url
       FROM autopilot_schedules s
       LEFT JOIN wordpress_sites w ON w.id = s.wp_site_id
      WHERE s.tenant_id=$1 ORDER BY s.created_at DESC`,
    [tid]
  );
  res.json({ ok: true, schedules: r.rows });
});

// ── PATCH /schedules/:id — toggle enabled / update ───────────────────────
router.patch('/schedules/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'autopilot:update' });
  const updates = []; const vals = [];
  if (typeof req.body?.enabled === 'boolean') { updates.push(`enabled=$${vals.length+1}`); vals.push(req.body.enabled); }
  if (req.body?.name)      { updates.push(`name=$${vals.length+1}`);      vals.push(String(req.body.name).slice(0,100)); }
  if (req.body?.keyword)   { updates.push(`keyword=$${vals.length+1}`);   vals.push(String(req.body.keyword).slice(0,200)); }
  if (req.body?.frequency && FREQS.includes(req.body.frequency)) {
    updates.push(`frequency=$${vals.length+1}`); vals.push(req.body.frequency);
    updates.push(`next_run_at=$${vals.length+1}`); vals.push(_nextRunAt(req.body.frequency));
  }
  if (!updates.length) return _err(res, 400, 'nothing to update');
  vals.push(id, tid);
  await _db.getPool().query(
    `UPDATE autopilot_schedules SET ${updates.join(',')} WHERE id=$${vals.length-1} AND tenant_id=$${vals.length}`, vals
  );
  res.json({ ok: true });
});

// ── DELETE /schedules/:id ─────────────────────────────────────────────────
router.delete('/schedules/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'autopilot:delete' });
  await _db.getPool().query(`DELETE FROM autopilot_schedules WHERE id=$1 AND tenant_id=$2`, [id, tid]);
  res.json({ ok: true });
});

// ── GET /logs ─────────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, logs: [] });
  const tid   = await _tenantCtx.resolveTenantId(req, { label: 'autopilot:logs' });
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const r = await _db.getPool().query(
    `SELECT l.*, s.name as schedule_name, s.keyword, s.mode
       FROM autopilot_logs l
       LEFT JOIN autopilot_schedules s ON s.id = l.schedule_id
      WHERE l.tenant_id=$1 ORDER BY l.created_at DESC LIMIT $2`,
    [tid, limit]
  );
  res.json({ ok: true, logs: r.rows });
});

// ── POST /run-now/:id — manually trigger a schedule ──────────────────────
router.post('/run-now/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'autopilot:run-now' });
  const r = await _db.getPool().query(
    `SELECT s.*, w.site_url, w.username, w.app_password
       FROM autopilot_schedules s
       LEFT JOIN wordpress_sites w ON w.id = s.wp_site_id
      WHERE s.id=$1 AND s.tenant_id=$2`, [id, tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'Schedule not found');
  const sched = r.rows[0];

  // Kick off generation async — return immediately so UI doesn't hang
  _runSchedule(sched, tid).catch(e => console.warn('[autopilot] run-now error:', e.message));
  res.json({ ok: true, message: 'Running — check logs in a few seconds' });
});

// ── Internal runner ───────────────────────────────────────────────────────
async function _runSchedule(sched, tid) {
  const pool = _db.getPool();
  let logStatus = 'ok', logDetail = '', wpPostUrl = null;
  try {
    // Generate content via content-modes API (internal call)
    const contentModesApi = require('../content_modes/api');
    const genResult = await _callContentModes(sched);
    if (!genResult || !genResult.article) throw new Error('Content generation returned empty result');

    const { article } = genResult;
    logDetail = `Generated: "${article.title || sched.keyword}" (${article.word_count || '?'} words, source: ${genResult.source})`;

    // Optionally publish to WordPress
    if (sched.auto_publish && sched.wp_site_id && sched.site_url && sched.username && sched.app_password) {
      const { _decrypt } = _getEncryptHelpers();
      const decPw = _decrypt(sched.app_password);
      const wpResp = await _wpPost(sched.site_url, sched.username, decPw, {
        title: article.title || sched.keyword,
        content: _articleToHtml(article),
        status: sched.wp_status || 'draft',
      });
      if (wpResp && wpResp.link) {
        wpPostUrl = wpResp.link;
        logDetail += ` → Published to WP as ${sched.wp_status} (post #${wpResp.id})`;
        await pool.query(
          `INSERT INTO wordpress_publish_log (tenant_id, site_id, wp_post_id, title, status, post_url, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, sched.wp_site_id, wpResp.id, article.title, sched.wp_status, wpResp.link, 'autopilot']
        );
      }
    }
  } catch (e) {
    logStatus = 'error';
    logDetail = e.message;
    console.warn('[autopilot] run error for schedule', sched.id, ':', e.message);
  }

  // Write log + update schedule
  await pool.query(
    `INSERT INTO autopilot_logs (schedule_id, tenant_id, status, detail, wp_post_url)
     VALUES ($1,$2,$3,$4,$5)`,
    [sched.id, tid, logStatus, logDetail, wpPostUrl]
  );
  await pool.query(
    `UPDATE autopilot_schedules SET last_run_at=now(), next_run_at=$1, run_count=run_count+1 WHERE id=$2`,
    [_nextRunAt(sched.frequency), sched.id]
  );
}

// Shared decrypt helper (reuse from wordpress/api without circular dependency)
function _getEncryptHelpers() {
  const crypto = require('crypto');
  const ALG = 'aes-256-gcm';
  const key = (() => {
    const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!raw) return null;
    try { const b = Buffer.from(raw, 'base64'); return b.length === 32 ? b : null; } catch { return null; }
  })();
  return {
    _decrypt(stored) {
      if (!key) return stored;
      try {
        const buf = Buffer.from(stored, 'base64');
        const iv = buf.slice(0, 12), tag = buf.slice(12, 28), enc = buf.slice(28);
        const dec = crypto.createDecipheriv(ALG, key, iv); dec.setAuthTag(tag);
        return dec.update(enc) + dec.final('utf8');
      } catch { return stored; }
    },
  };
}

async function _callContentModes(sched) {
  // Directly require and simulate the internal generate logic
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) {
    return { source: 'template', article: { title: sched.keyword, word_count: 1200, intro: '', sections: [], conclusion: '', cta: '' } };
  }
  // Delegate via internal HTTP to avoid circular imports
  return new Promise(resolve => {
    const body = JSON.stringify({
      mode: sched.mode, keyword: sched.keyword, brand: sched.brand,
      location: null, audience: null, tone: null,
    });
    const req = require('http').request({
      hostname: '127.0.0.1', port: process.env.PORT || 5000,
      path: '/api/content-modes/generate', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'X-Autopilot-Internal': '1', 'X-InfoGenie-Key': process.env.INFOGENIE_API_KEY || '' },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(90000, () => req.destroy());
    req.write(body); req.end();
  });
}

async function _wpPost(siteUrl, username, appPassword, { title, content, status }) {
  const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
  const bodyStr = JSON.stringify({ title, content, status });
  return new Promise(resolve => {
    const url = new URL(`${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts`);
    const proto = url.protocol === 'https:' ? require('https') : require('http');
    const req = proto.request({
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname, method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve(r.statusCode === 201 ? JSON.parse(d) : null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => req.destroy());
    req.write(bodyStr); req.end();
  });
}

function _articleToHtml(article) {
  let html = '';
  if (article.intro) html += `<p>${article.intro}</p>\n`;
  for (const s of (article.sections || [])) {
    html += `<h2>${s.heading || ''}</h2>\n<p>${(s.body || '').replace(/\n/g, '</p><p>')}</p>\n`;
  }
  if (article.conclusion) html += `<p>${article.conclusion}</p>\n`;
  if (article.cta) html += `<p><strong>${article.cta}</strong></p>\n`;
  return html;
}

// ── Hourly cron ───────────────────────────────────────────────────────────
function startAutopilotCron() {
  if (!_db.hasDb()) return;
  const INTERVAL = 60 * 60 * 1000; // 1 hour
  async function tick() {
    try {
      const pool = _db.getPool();
      const r = await pool.query(
        `SELECT s.*, w.site_url, w.username, w.app_password
           FROM autopilot_schedules s
           LEFT JOIN wordpress_sites w ON w.id = s.wp_site_id
          WHERE s.enabled = true AND s.next_run_at <= now()`
      );
      for (const sched of r.rows) {
        await _runSchedule(sched, sched.tenant_id).catch(e =>
          console.warn('[autopilot] cron error schedule', sched.id, e.message)
        );
      }
      if (r.rows.length) console.log(`[autopilot] cron ran ${r.rows.length} schedule(s)`);
    } catch (e) { console.warn('[autopilot] cron tick error:', e.message); }
  }
  setInterval(tick, INTERVAL);
  setTimeout(tick, 30000); // first tick 30s after boot
  console.log('[autopilot] cron started — hourly');
}

module.exports = router;
module.exports.startAutopilotCron = startAutopilotCron;
