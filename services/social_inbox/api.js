// Social engagement inbox — DMs / comments via OmniSocials (optional) with
// in-memory demo threads when no key is configured.
const express = require('express');
const https = require('https');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const _memThreads = new Map(); // tid -> threads[]
const _memMessages = new Map(); // threadKey -> messages[]
let _seq = 1;

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  if (!_db.hasDb()) return 1;
  return null;
}

function _hasOmni() {
  const k = process.env.OMNISOCIALS_API_KEY;
  return !!(k && !/^_DUMMY/i.test(k));
}

function _omni(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.omnisocials.com',
      path: `/v1${path}`,
      method,
      headers: {
        Authorization: `Bearer ${process.env.OMNISOCIALS_API_KEY}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (r.statusCode >= 200 && r.statusCode < 300) resolve({ ok: true, data: j.data || j });
          else resolve({ ok: false, error: j.error?.message || j.message || `omnisocials ${r.statusCode}` });
        } catch (e) {
          resolve({ ok: false, error: `parse: ${d.slice(0, 160)}` });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    if (data) req.write(data);
    req.end();
  });
}

async function _ensureSchema() {
  if (!_db.hasDb()) return;
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS social_inbox_threads (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL,
      provider VARCHAR(20) NOT NULL DEFAULT 'demo',
      external_thread_id VARCHAR(200) NOT NULL,
      platform VARCHAR(40) NOT NULL,
      thread_type VARCHAR(20) DEFAULT 'dm',
      author VARCHAR(200),
      preview TEXT,
      unread BOOLEAN DEFAULT TRUE,
      status VARCHAR(20) DEFAULT 'new',
      last_message_at TIMESTAMPTZ,
      raw JSONB,
      UNIQUE(tenant_id, provider, external_thread_id)
    );
    CREATE TABLE IF NOT EXISTS social_inbox_messages (
      id SERIAL PRIMARY KEY,
      thread_id INT REFERENCES social_inbox_threads(id) ON DELETE CASCADE,
      external_message_id VARCHAR(200),
      direction VARCHAR(10),
      body TEXT,
      sent_at TIMESTAMPTZ,
      raw JSONB
    );
  `);
}

function _seedDemo(tid) {
  if (_memThreads.has(tid) && _memThreads.get(tid).length) return;
  const now = Date.now();
  const threads = [
    {
      id: _seq++,
      tenant_id: tid,
      provider: 'demo',
      external_thread_id: 'demo-ig-1',
      platform: 'instagram',
      thread_type: 'dm',
      author: '@alex.creative',
      preview: 'Loved your last carousel — do you offer brand kits?',
      unread: true,
      status: 'new',
      last_message_at: new Date(now - 3600000).toISOString(),
    },
    {
      id: _seq++,
      tenant_id: tid,
      provider: 'demo',
      external_thread_id: 'demo-fb-1',
      platform: 'facebook',
      thread_type: 'comment',
      author: 'Jordan Lee',
      preview: 'When is the next webinar? Counting on this!',
      unread: true,
      status: 'new',
      last_message_at: new Date(now - 7200000).toISOString(),
    },
    {
      id: _seq++,
      tenant_id: tid,
      provider: 'demo',
      external_thread_id: 'demo-tt-1',
      platform: 'tiktok',
      thread_type: 'comment',
      author: '@growth.maya',
      preview: 'This hook is fire 🔥 recipe please?',
      unread: false,
      status: 'replied',
      last_message_at: new Date(now - 86400000).toISOString(),
    },
  ];
  _memThreads.set(tid, threads);
  for (const t of threads) {
    _memMessages.set(`${tid}:${t.id}`, [
      {
        id: _seq++,
        thread_id: t.id,
        direction: 'inbound',
        body: t.preview,
        sent_at: t.last_message_at,
      },
    ]);
  }
}

router.get('/status', _safeAsync(async (req, res) => {
  res.json({
    ok: true,
    provider: _hasOmni() ? 'omnisocials' : 'demo',
    configured: _hasOmni(),
    note: _hasOmni()
      ? 'OmniSocials inbox API connected'
      : 'Demo mode — add OMNISOCIALS_API_KEY for live DMs/comments',
  });
}));

router.get('/threads', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-inbox:threads');
  if (!tid) return _err(res, 400, 'no_tenant');
  const platform = String(req.query.platform || '').toLowerCase();
  const status = String(req.query.status || '');

  if (_hasOmni()) {
    const r = await _omni('GET', '/inbox/conversations');
    if (!r.ok) return _err(res, 400, r.error);
    let threads = (Array.isArray(r.data) ? r.data : r.data?.conversations || []).map((c, i) => ({
      id: c.id || i,
      provider: 'omnisocials',
      external_thread_id: String(c.id || c.thread_id || i),
      platform: c.platform || c.network || 'unknown',
      thread_type: c.type || c.kind || 'dm',
      author: c.author || c.from || c.username || 'unknown',
      preview: c.preview || c.snippet || c.last_message || '',
      unread: c.unread !== false,
      status: c.status || (c.unread ? 'new' : 'replied'),
      last_message_at: c.last_message_at || c.updated_at || null,
    }));
    if (platform) threads = threads.filter((t) => t.platform === platform);
    if (status) threads = threads.filter((t) => t.status === status);
    return res.json({ ok: true, threads, source: 'omnisocials' });
  }

  _seedDemo(tid);
  let threads = [...(_memThreads.get(tid) || [])];
  if (platform) threads = threads.filter((t) => t.platform === platform);
  if (status) threads = threads.filter((t) => t.status === status);
  res.json({ ok: true, threads, source: 'demo' });
}));

router.get('/threads/:id/messages', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-inbox:messages');
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = req.params.id;

  if (_hasOmni()) {
    const r = await _omni('GET', `/inbox/conversations/${encodeURIComponent(id)}/messages`);
    if (!r.ok) return _err(res, 400, r.error);
    const messages = (Array.isArray(r.data) ? r.data : r.data?.messages || []).map((m, i) => ({
      id: m.id || i,
      direction: m.direction || (m.outbound ? 'outbound' : 'inbound'),
      body: m.body || m.text || m.content || '',
      sent_at: m.sent_at || m.created_at || null,
    }));
    return res.json({ ok: true, messages, source: 'omnisocials' });
  }

  _seedDemo(tid);
  const messages = _memMessages.get(`${tid}:${id}`) || [];
  res.json({ ok: true, messages, source: 'demo' });
}));

router.post('/threads/:id/reply', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-inbox:reply');
  if (!tid) return _err(res, 400, 'no_tenant');
  const body = String(req.body?.body || req.body?.text || '').trim();
  if (!body) return _err(res, 400, 'body required');
  const id = req.params.id;

  if (_hasOmni()) {
    const r = await _omni('POST', `/inbox/conversations/${encodeURIComponent(id)}/reply`, { body, text: body });
    if (!r.ok) return _err(res, 400, r.error);
    return res.json({ ok: true, message: r.data });
  }

  _seedDemo(tid);
  const key = `${tid}:${id}`;
  if (!_memMessages.has(key)) _memMessages.set(key, []);
  const msg = {
    id: _seq++,
    thread_id: Number(id),
    direction: 'outbound',
    body,
    sent_at: new Date().toISOString(),
  };
  _memMessages.get(key).push(msg);
  const threads = _memThreads.get(tid) || [];
  const t = threads.find((x) => String(x.id) === String(id));
  if (t) {
    t.preview = body.slice(0, 120);
    t.unread = false;
    t.status = 'replied';
    t.last_message_at = msg.sent_at;
  }
  res.json({ ok: true, message: msg, source: 'demo' });
}));

router.patch('/threads/:id', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'social-inbox:patch');
  if (!tid) return _err(res, 400, 'no_tenant');
  _seedDemo(tid);
  const threads = _memThreads.get(tid) || [];
  const t = threads.find((x) => String(x.id) === String(req.params.id));
  if (!t) return _err(res, 404, 'not found');
  if (req.body?.status) t.status = String(req.body.status);
  if (req.body?.unread != null) t.unread = !!req.body.unread;
  res.json({ ok: true, thread: t });
}));

router.post('/sync', _safeAsync(async (req, res) => {
  if (!_hasOmni()) {
    return res.json({ ok: true, synced: 0, note: 'Demo mode — nothing to sync. Add OMNISOCIALS_API_KEY.' });
  }
  const r = await _omni('GET', '/inbox/conversations');
  if (!r.ok) return _err(res, 400, r.error);
  const n = Array.isArray(r.data) ? r.data.length : (r.data?.conversations || []).length;
  res.json({ ok: true, synced: n, source: 'omnisocials' });
}));

router._resetMem = () => { _memThreads.clear(); _memMessages.clear(); _seq = 1; };

module.exports = router;
