const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _safeAsync(handler) { return (req, res) => Promise.resolve(handler(req, res)).catch(e => { console.warn('[youtube-monitor] route error:', e.message); if (!res.headersSent) _err(res, 500, e.message || 'internal error'); }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

async function _perplexityScan(channelName, channelUrl, maxVideos) {
  if (!_hasPerplexity()) return null;
  const prompt = `Find the ${maxVideos} most recent YouTube videos uploaded by the channel "${channelName}" (URL: ${channelUrl}). For each video return:
- title (exact)
- url (full youtube.com/watch URL)
- published_at (ISO date or "X days ago")
- view_count (integer, best estimate)
- like_count (integer or null)
- comment_count (integer or null)
- sentiment ("positive" | "neutral" | "negative" — based on comments tone)
- summary (1 sentence, what the video is about)

Return strict JSON only: {"videos":[{...}]}. If you cannot find the channel, return {"videos":[],"note":"channel not found"}. Never invent — use real data only.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'sonar', temperature:0.1, max_tokens:2500,
      messages:[{ role:'user', content: prompt }]
    });
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) return resolve(null);
          const parsed = JSON.parse(m[0]);
          resolve(Array.isArray(parsed.videos) ? parsed.videos.slice(0, maxVideos) : []);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => {
  res.json({ ok:true, perplexity: _hasPerplexity(), db: _db.hasDb && _db.hasDb() });
});

router.get('/channels', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, channels:[], note:'DB not configured' });
  const tid = await _tid(req, 'yt:channels-list');
  const brand = req.query.brand ? String(req.query.brand).trim() : null;
  const sql = brand
    ? `SELECT * FROM yt_channels WHERE tenant_id=$1 AND brand=$2 ORDER BY created_at DESC`
    : `SELECT * FROM yt_channels WHERE tenant_id=$1 ORDER BY created_at DESC`;
  const r = await _db.getPool().query(sql, brand ? [tid, brand] : [tid]);
  res.json({ ok:true, channels: r.rows });
}));

router.post('/channels', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const brand = String(req.body?.brand || '').trim();
  const channel_name = String(req.body?.channel_name || '').trim();
  const channel_url = String(req.body?.channel_url || '').trim();
  if (!brand || !channel_name || !channel_url) return _err(res, 400, 'brand, channel_name, channel_url required');
  if (!/^https?:\/\/(www\.)?youtube\.com\//i.test(channel_url)) return _err(res, 400, 'channel_url must be a youtube.com URL (e.g. https://www.youtube.com/@MrBeast)');
  try {
    const tid = await _tid(req, 'yt:channels-add');
    const r = await _db.getPool().query(
      `INSERT INTO yt_channels (tenant_id, brand, channel_name, channel_url) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, brand, channel_url) DO UPDATE SET channel_name=EXCLUDED.channel_name, enabled=true RETURNING *`,
      [tid, brand, channel_name, channel_url]
    );
    res.json({ ok:true, channel: r.rows[0] });
  } catch (e) { _err(res, 400, e.message); }
}));

router.delete('/channels/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const tid = await _tid(req, 'yt:channels-del');
  await _db.getPool().query('DELETE FROM yt_channels WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id, 10), tid]);
  res.json({ ok:true });
}));

router.post('/scan/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required for live YouTube scans');
  const id = parseInt(req.params.id, 10);
  const max = Math.max(3, Math.min(15, parseInt(req.body?.max || 8, 10)));
  const tid = await _tid(req, 'yt:scan');
  const ch = await _db.getPool().query('SELECT * FROM yt_channels WHERE id=$1 AND tenant_id=$2', [id, tid]);
  if (!ch.rows.length) return _err(res, 404, 'channel not found');
  const c = ch.rows[0];
  const videos = await _perplexityScan(c.channel_name, c.channel_url, max);
  if (!videos) return _err(res, 502, 'YouTube scan failed — Perplexity unreachable or rate-limited');
  if (!videos.length) {
    await _db.getPool().query('UPDATE yt_channels SET last_scanned_at=now() WHERE id=$1 AND tenant_id=$2', [id, tid]);
    return res.json({ ok:true, channel:c, videos:[], note:'No videos found — verify the channel URL is correct.' });
  }
  // Store snapshots — stamped with same tid that owns the parent channel.
  for (const v of videos) {
    try {
      await _db.getPool().query(
        `INSERT INTO yt_snapshots (tenant_id, channel_id, video_title, video_url, published_at, view_count, like_count, comment_count, sentiment, summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tid, id, String(v.title||'').slice(0,500), String(v.url||'').slice(0,500), String(v.published_at||'').slice(0,100),
         Number.isFinite(+v.view_count) ? +v.view_count : null,
         Number.isFinite(+v.like_count) ? +v.like_count : null,
         Number.isFinite(+v.comment_count) ? +v.comment_count : null,
         String(v.sentiment||'neutral').slice(0,20), String(v.summary||'').slice(0,1000)]
      );
    } catch(_) {}
  }
  await _db.getPool().query('UPDATE yt_channels SET last_scanned_at=now() WHERE id=$1 AND tenant_id=$2', [id, tid]);
  res.json({ ok:true, channel:c, videos, scanned_at: new Date().toISOString() });
}));

router.get('/history/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, snapshots:[] });
  const id = parseInt(req.params.id, 10);
  const tid = await _tid(req, 'yt:history');
  // Ownership gate then tenant-scoped snapshots query for defense-in-depth.
  const own = await _db.getPool().query('SELECT 1 FROM yt_channels WHERE id=$1 AND tenant_id=$2', [id, tid]);
  if (!own.rows.length) return _err(res, 404, 'channel not found');
  const r = await _db.getPool().query('SELECT * FROM yt_snapshots WHERE channel_id=$1 AND tenant_id=$2 ORDER BY captured_at DESC LIMIT 50', [id, tid]);
  res.json({ ok:true, snapshots: r.rows });
}));

module.exports = router;
