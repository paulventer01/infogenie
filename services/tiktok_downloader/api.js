const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[tiktok-downloader]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

// Allowed hosts (TikTok variants only — stay narrow to avoid SSRF surprises).
const _TIKTOK_HOSTS = /^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/i;
function _isTiktokUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return _TIKTOK_HOSTS.test(u.hostname);
  } catch { return false; }
}

// Two-stage resolver:
//   Stage 1 = tikwm.com (free, no-auth public TikTok metadata + no-watermark video).
//   Stage 2 = RapidAPI's tiktok-scraper7 (paid ~$10/mo, much higher rate limits +
//             survives when tikwm gets WAF-blocked or returns 'rate limited').
// Stage 2 is only attempted when TIKTOK_RAPIDAPI_KEY is set AND stage 1 failed.
// Both adapters normalise to the same response shape so the frontend never changes.
function _normalize(url, x, hashtagsFrom) {
  const hashtags = (hashtagsFrom || '').match(/#[\p{L}\p{N}_]+/gu) || [];
  return {
    url, ok: true,
    author: x.author || '',
    authorName: x.authorName || '',
    authorAvatar: x.authorAvatar || '',
    caption: x.caption || '',
    hashtags,
    music: x.music || '',
    musicAuthor: x.musicAuthor || '',
    likes: Number(x.likes || 0),
    views: Number(x.views || 0),
    comments: Number(x.comments || 0),
    shares: Number(x.shares || 0),
    duration: Number(x.duration || 0),
    videoUrl: x.videoUrl || '',
    coverUrl: x.coverUrl || '',
    createTime: x.createTime || null,
    via: x.via || ''
  };
}

function _resolveTikwm(url) {
  return new Promise(resolve => {
    const body = `url=${encodeURIComponent(url)}&hd=1`;
    const req = _https.request({
      hostname: 'tikwm.com', path: '/api/', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Mozilla/5.0 (compatible; InfoGenie/1.0)' }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.code !== 0 || !j.data) return resolve({ url, ok: false, error: j.msg || 'tikwm returned no data' });
          const x = j.data;
          resolve(_normalize(url, {
            author: x.author?.unique_id || x.author?.nickname || '',
            authorName: x.author?.nickname || '',
            authorAvatar: x.author?.avatar || '',
            caption: x.title || '',
            music: x.music_info?.title || x.music || '',
            musicAuthor: x.music_info?.author || '',
            likes: x.digg_count, views: x.play_count, comments: x.comment_count, shares: x.share_count,
            duration: x.duration,
            videoUrl: x.hdplay || x.play || x.wmplay || '',
            coverUrl: x.cover || x.origin_cover || '',
            createTime: x.create_time ? new Date(x.create_time * 1000).toISOString() : null,
            via: 'tikwm.com'
          }, x.title));
        } catch (e) { resolve({ url, ok: false, error: 'tikwm: invalid response' }); }
      });
    });
    req.on('error', e => resolve({ url, ok: false, error: 'tikwm: ' + e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ url, ok: false, error: 'tikwm: timeout' }); });
    req.write(body); req.end();
  });
}

// RapidAPI fallback — uses the popular `tiktok-scraper7` endpoint
// (https://rapidapi.com/yi005/api/tiktok-scraper7). Free tier 100 req/mo,
// $10/mo for 100k. Set TIKTOK_RAPIDAPI_KEY to enable. Same response shape.
function _resolveRapidApi(url) {
  return new Promise(resolve => {
    const key = process.env.TIKTOK_RAPIDAPI_KEY;
    if (!key) return resolve({ url, ok: false, error: 'RapidAPI key not configured' });
    const path = `/?url=${encodeURIComponent(url)}&hd=1`;
    const req = _https.request({
      hostname: 'tiktok-scraper7.p.rapidapi.com', path, method: 'GET',
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com' }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.code !== 0 || !j.data) return resolve({ url, ok: false, error: 'RapidAPI: ' + (j.msg || 'no data') });
          const x = j.data;
          resolve(_normalize(url, {
            author: x.author?.unique_id || x.author?.nickname || '',
            authorName: x.author?.nickname || '',
            authorAvatar: x.author?.avatar || '',
            caption: x.title || '',
            music: x.music_info?.title || x.music || '',
            musicAuthor: x.music_info?.author || '',
            likes: x.digg_count, views: x.play_count, comments: x.comment_count, shares: x.share_count,
            duration: x.duration,
            videoUrl: x.hdplay || x.play || x.wmplay || '',
            coverUrl: x.cover || x.origin_cover || '',
            createTime: x.create_time ? new Date(x.create_time * 1000).toISOString() : null,
            via: 'rapidapi:tiktok-scraper7'
          }, x.title));
        } catch (e) { resolve({ url, ok: false, error: 'RapidAPI: invalid response' }); }
      });
    });
    req.on('error', e => resolve({ url, ok: false, error: 'RapidAPI: ' + e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ url, ok: false, error: 'RapidAPI: timeout' }); });
    req.end();
  });
}

async function _resolveOne(url) {
  const first = await _resolveTikwm(url);
  if (first.ok) return first;
  if (!process.env.TIKTOK_RAPIDAPI_KEY) {
    return { url, ok: false, error: first.error + ' (set TIKTOK_RAPIDAPI_KEY for paid fallback)' };
  }
  const second = await _resolveRapidApi(url);
  if (second.ok) return second;
  return { url, ok: false, error: `Both resolvers failed — tikwm: ${first.error} | rapidapi: ${second.error}` };
}

router.get('/test', (req, res) => {
  res.json({
    ok: true,
    resolvers: ['tikwm.com (free)', process.env.TIKTOK_RAPIDAPI_KEY ? 'rapidapi:tiktok-scraper7 (paid fallback)' : 'rapidapi: not configured (set TIKTOK_RAPIDAPI_KEY to enable)'],
    db: _db.hasDb && _db.hasDb()
  });
});

// POST /api/tiktok-downloader/parse  { urls: ["https://...","..."] }
// Resolves each URL in parallel, persists results, returns full metadata + mp4 URLs.
router.post('/parse', _safeAsync(async (req, res) => {
  const raw = req.body?.urls;
  let urls = [];
  if (Array.isArray(raw)) urls = raw;
  else if (typeof raw === 'string') urls = raw.split(/[\r\n,]+/);
  urls = urls.map(s => String(s || '').trim()).filter(Boolean);
  if (!urls.length) return _err(res, 400, 'Provide one or more TikTok URLs (one per line).');
  if (urls.length > 25) return _err(res, 400, 'Maximum 25 URLs per request.');

  const valid = [];
  const invalid = [];
  for (const u of urls) (_isTiktokUrl(u) ? valid : invalid).push(u);

  // Resolve in parallel — tikwm handles short links (vm.tiktok.com / vt.tiktok.com) automatically.
  const results = await Promise.all(valid.map(_resolveOne));

  // Persist successful results (best-effort, never blocks the response).
  if (_db.hasDb && _db.hasDb()) {
    const pool = _db.getPool();
    for (const r of results) {
      if (!r.ok) continue;
      try {
        await pool.query(
          `INSERT INTO tiktok_downloads
            (url, author, caption, hashtags, music, likes, views, comments, shares, duration_sec, video_url, cover_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [r.url, r.author, r.caption, JSON.stringify(r.hashtags || []), r.music,
           r.likes, r.views, r.comments, r.shares, r.duration, r.videoUrl, r.coverUrl]
        );
      } catch (_) {}
    }
  }

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok).concat(invalid.map(u => ({ url: u, ok: false, error: 'Not a valid TikTok URL' })));
  res.json({ ok: true, total: urls.length, succeeded: ok.length, failed: failed.length, results: ok, errors: failed });
}));

// GET /api/tiktok-downloader/recent — last 50 successful downloads
router.get('/recent', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tid(req, 'tiktok-downloader:recent');
  const r = await _db.getPool().query(
    `SELECT id, url, author, caption, hashtags, music, likes, views, comments, shares,
            duration_sec, video_url, cover_url, created_at
       FROM tiktok_downloads
      WHERE tenant_id=$1
      ORDER BY created_at DESC
      LIMIT 50`,
    [tid]
  );
  res.json({ ok: true, items: r.rows });
}));

// GET /api/tiktok-downloader/proxy?url=<videoUrl>
// Streams the mp4 through our origin so the browser can save-as without CORS
// issues and so the user gets a clean filename. Strict allow-list on host.
router.get('/proxy', _safeAsync(async (req, res) => {
  const target = String(req.query?.url || '');
  let parsed;
  try { parsed = new URL(target); } catch { return _err(res, 400, 'Invalid url'); }
  if (parsed.protocol !== 'https:') return _err(res, 400, 'https only');
  // tikwm CDN domains used for video delivery.
  if (!/(^|\.)tikwm\.com$|(^|\.)tiktokcdn\.com$|(^|\.)tiktokv\.com$/i.test(parsed.hostname)) {
    return _err(res, 400, 'Host not allowed');
  }
  const filename = `tiktok_${Date.now()}.mp4`;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const upstream = _https.get(parsed.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfoGenie/1.0)' } }, r => {
    if (r.statusCode && r.statusCode >= 400) {
      if (!res.headersSent) res.status(502);
      r.resume();
      return res.end();
    }
    r.pipe(res);
  });
  upstream.on('error', e => { console.warn('[tiktok-downloader] proxy stream error:', e.message); if (!res.headersSent) res.status(502).end(); });
  upstream.setTimeout(45000, () => { upstream.destroy(); if (!res.headersSent) res.status(504).end(); });
}));

module.exports = router;
