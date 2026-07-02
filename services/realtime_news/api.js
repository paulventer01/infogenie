// T116 Real-Time News — live news search, topic feeds, saved articles
// Powered by Real-Time News Data API on RapidAPI (real-time-news-data.p.rapidapi.com)
// Requires RAPIDAPI_KEY (already wired as a shared platform key).
const express = require('express');
const router  = express.Router();
const https   = require('https');
const _tenantCtx = require('../tenants/context');
const { getDb } = require('../../db');

const NEWS_HOST = 'real-time-news-data.p.rapidapi.com';

function _key() {
  return (process.env.RAPIDAPI_KEY || '').trim().replace(/^['"]+|['"]+$/g, '');
}
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[realtime-news]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

function callNewsApi(path) {
  return new Promise((resolve, reject) => {
    const key = _key();
    if (!key) return reject(new Error('RAPIDAPI_KEY not configured'));
    const options = {
      hostname: NEWS_HOST,
      path,
      method: 'GET',
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': NEWS_HOST }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, body: { _raw: raw } }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('News API timeout')); });
    req.end();
  });
}

function normaliseArticle(a, query = '', topic = '') {
  return {
    title:     a.title || '',
    snippet:   a.snippet || a.description || (a.body || '').slice(0, 300),
    url:       a.link || a.url || '#',
    source:    a.source_name || (a.publisher && a.publisher.title) || a.publisher || 'News',
    image:     a.photo_url || a.image_url || a.thumbnail || null,
    published: a.published_datetime_utc || a.pub_date || a.date || '',
    query,
    topic
  };
}

function looksLikeAuthError(body) {
  if (!body || typeof body !== 'object') return false;
  const msg = String(body.message || body._raw || '').toLowerCase();
  return msg.includes('not subscribed') || msg.includes('does not exist') ||
         msg.includes('invalid api key') || msg.includes('unauthorized');
}

// ── GET /api/realtime-news/status ─────────────────────────────────────────────
router.get('/status', _safe(async (req, res) => {
  const key = _key();
  if (!key) return res.json({ configured: false, reason: 'no_key' });
  try {
    const { status, body } = await callNewsApi('/search?query=marketing&limit=1&country=US&lang=en');
    if (looksLikeAuthError(body)) return res.json({ configured: false, reason: 'not_subscribed' });
    return res.json({ configured: status === 200 && body.status === 'OK' });
  } catch(e) {
    return res.json({ configured: false, reason: e.message });
  }
}));

// ── POST /api/realtime-news/search ────────────────────────────────────────────
router.post('/search', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rtn:search' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const { query = '', country = 'US', lang = 'en', limit = 12 } = req.body;
  if (!query.trim()) return _err(res, 400, 'query required');
  if (!_key()) return _err(res, 400, 'RAPIDAPI_KEY not configured');

  const q = encodeURIComponent(query.trim());
  const { status, body } = await callNewsApi(
    `/search?query=${q}&limit=${Math.min(Number(limit) || 12, 20)}&country=${country}&lang=${lang}`
  );

  if (looksLikeAuthError(body)) {
    return res.status(400).json({
      ok: false, error: 'not_subscribed',
      message: 'Subscribe to "Real-Time News Data" on RapidAPI (free tier available).'
    });
  }

  const articles = (body.status === 'OK' && Array.isArray(body.data))
    ? body.data.map(a => normaliseArticle(a, query))
    : [];

  const db = getDb();
  if (db) {
    db.query(
      `INSERT INTO rtn_search_history (tenant_id, query, result_count) VALUES ($1,$2,$3)`,
      [tid, query.trim(), articles.length]
    ).catch(() => {});
  }

  res.json({ articles, count: articles.length, source: 'live' });
}));

// ── POST /api/realtime-news/topic ─────────────────────────────────────────────
router.post('/topic', _safe(async (req, res) => {
  const { topic = 'TECHNOLOGY', country = 'US', lang = 'en', limit = 12 } = req.body;
  const VALID = ['WORLD','NATION','BUSINESS','TECHNOLOGY','ENTERTAINMENT','SPORTS','SCIENCE','HEALTH'];
  const t = topic.toUpperCase();
  if (!VALID.includes(t)) return _err(res, 400, 'invalid topic');
  if (!_key()) return _err(res, 400, 'RAPIDAPI_KEY not configured');

  const { body } = await callNewsApi(
    `/topic-news?topic=${t}&limit=${Math.min(Number(limit) || 12, 20)}&country=${country}&lang=${lang}`
  );
  if (looksLikeAuthError(body)) return _err(res, 400, 'not_subscribed');

  const articles = (body.status === 'OK' && Array.isArray(body.data))
    ? body.data.map(a => normaliseArticle(a, '', t))
    : [];
  res.json({ articles, topic: t, count: articles.length, source: 'live' });
}));

// ── POST /api/realtime-news/headlines ─────────────────────────────────────────
router.post('/headlines', _safe(async (req, res) => {
  const { topic = 'TECHNOLOGY', country = 'US', lang = 'en' } = req.body;
  if (!_key()) return _err(res, 400, 'RAPIDAPI_KEY not configured');

  const { body } = await callNewsApi(
    `/topic-headlines?topic=${topic.toUpperCase()}&country=${country}&lang=${lang}`
  );
  if (looksLikeAuthError(body)) return _err(res, 400, 'not_subscribed');

  const articles = (body.status === 'OK' && Array.isArray(body.data))
    ? body.data.map(a => normaliseArticle(a, '', topic))
    : [];
  res.json({ articles, count: articles.length, source: 'live' });
}));

// ── POST /api/realtime-news/saved ─────────────────────────────────────────────
router.post('/saved', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rtn:save' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const { article_url, title, snippet, source_name, published_at, search_query, topic, sentiment, notes } = req.body;
  if (!article_url || !title) return _err(res, 400, 'article_url and title required');

  const db = getDb();
  if (!db) return _err(res, 503, 'db unavailable');

  const { rows } = await db.query(
    `INSERT INTO rtn_saved_articles
       (tenant_id, article_url, title, snippet, source_name, published_at, search_query, topic, sentiment, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [tid, article_url, title, snippet || '', source_name || '',
     published_at || null, search_query || '', topic || '', sentiment || 'neutral', notes || '']
  );
  res.json({ id: rows[0].id, saved: true });
}));

// ── GET /api/realtime-news/saved ──────────────────────────────────────────────
router.get('/saved', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rtn:saved-list' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = getDb();
  if (!db) return res.json({ articles: [] });

  const { rows } = await db.query(
    `SELECT * FROM rtn_saved_articles WHERE tenant_id=$1 ORDER BY saved_at DESC LIMIT 50`,
    [tid]
  );
  res.json({ articles: rows });
}));

// ── DELETE /api/realtime-news/saved/:id ───────────────────────────────────────
router.delete('/saved/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rtn:unsave' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = getDb();
  if (!db) return _err(res, 503, 'db unavailable');

  await db.query(
    `DELETE FROM rtn_saved_articles WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  res.json({ deleted: true });
}));

// ── GET /api/realtime-news/history ────────────────────────────────────────────
router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'rtn:history' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = getDb();
  if (!db) return res.json({ history: [] });

  const { rows } = await db.query(
    `SELECT query, result_count, searched_at FROM rtn_search_history
     WHERE tenant_id=$1 ORDER BY searched_at DESC LIMIT 20`,
    [tid]
  );
  res.json({ history: rows });
}));

module.exports = router;
