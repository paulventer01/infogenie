const express = require('express');
const _https = require('https');
const router = express.Router();

const PLATFORMS = ['twitter','instagram','facebook','linkedin','tiktok','youtube','pinterest','reddit','bluesky','threads','googlebusiness','telegram','snapchat','whatsapp','discord'];

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _hasCreds() {
  const k = process.env.ZERNIO_API_KEY;
  return k && !/^_DUMMY/i.test(k);
}
function _friendlyError(err, status) {
  if (!err) return err;
  if (status === 401 || /unauthor|invalid.*key|invalid.*token/i.test(err)) return `${err} → Your ZERNIO_API_KEY is invalid or revoked. Generate a new key at https://zernio.com/dashboard.`;
  if (status === 402 || /quota|limit|payment/i.test(err)) return `${err} → You've hit your Zernio plan limit. Upgrade at https://zernio.com/pricing.`;
  if (/profile/i.test(err) && /not found/i.test(err)) return `${err} → Create a profile first via the "+ New Profile" button.`;
  if (/account|connect/i.test(err) && /not.*found|no.*connected/i.test(err)) return `${err} → Connect at least one social account for this profile before posting.`;
  return err;
}

async function _zernio(method, path, body) {
  return await new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const req = _https.request({
      hostname:'zernio.com', path:`/api/v1${path}`, method,
      headers: {
        'Authorization': `Bearer ${process.env.ZERNIO_API_KEY}`,
        'Content-Type':'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, r => {
      let d=''; r.on('data', c => d += c); r.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (r.statusCode >= 200 && r.statusCode < 300) resolve({ ok:true, data:j });
          else resolve({ ok:false, status:r.statusCode, error: j.error?.message || j.error || j.message || `zernio ${r.statusCode}` });
        } catch (e) { resolve({ ok:false, status:r.statusCode, error:`parse failed (${r.statusCode}): ${d.slice(0,200)}` }); }
      });
    });
    req.on('error', e => resolve({ ok:false, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok:false, error:'zernio timeout (30s)' }); });
    if (data) req.write(data);
    req.end();
  });
}

router.get('/platforms', (req, res) => res.json({ ok:true, platforms: PLATFORMS }));

router.post('/test', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'ZERNIO_API_KEY required — add it as a Replit Secret.');
  const r = await _zernio('GET', '/profiles');
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  const profiles = r.data?.profiles || r.data?.data || (Array.isArray(r.data) ? r.data : []);
  res.json({ ok:true, profile_count: profiles.length, profiles });
});

router.get('/profiles', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', profiles:[], note:'Add ZERNIO_API_KEY to manage profiles.' });
  const r = await _zernio('GET', '/profiles');
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  res.json({ ok:true, profiles: r.data?.profiles || r.data?.data || (Array.isArray(r.data) ? r.data : []) });
});

router.post('/profiles', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'ZERNIO_API_KEY required.');
  const name = String(req.body?.name || '').trim();
  if (!name) return _err(res, 400, 'name required');
  const r = await _zernio('POST', '/profiles', { name });
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  res.json({ ok:true, profile: r.data?.profile || r.data });
});

router.get('/accounts', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', accounts:[], note:'Add ZERNIO_API_KEY.' });
  const profileId = String(req.query.profileId || '').trim();
  const path = profileId ? `/accounts?profileId=${encodeURIComponent(profileId)}` : '/accounts';
  const r = await _zernio('GET', path);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  res.json({ ok:true, accounts: r.data?.accounts || r.data?.data || (Array.isArray(r.data) ? r.data : []) });
});

router.post('/connect-url', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'ZERNIO_API_KEY required.');
  const platform = String(req.body?.platform || '').toLowerCase().trim();
  const profileId = String(req.body?.profileId || '').trim();
  if (!PLATFORMS.includes(platform)) return _err(res, 400, `platform must be one of: ${PLATFORMS.join(', ')}`);
  if (!profileId) return _err(res, 400, 'profileId required');
  const r = await _zernio('GET', `/connect/${platform}?profileId=${encodeURIComponent(profileId)}`);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  res.json({ ok:true, authUrl: r.data?.authUrl || r.data?.url || r.data });
});

router.post('/post', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'ZERNIO_API_KEY required.');
  const text = String(req.body?.text || '').trim();
  const platforms = Array.isArray(req.body?.platforms) ? req.body.platforms.map(p => String(p).toLowerCase()).filter(p => PLATFORMS.includes(p)) : [];
  const mediaUrls = Array.isArray(req.body?.mediaUrls) ? req.body.mediaUrls.filter(u => /^https?:\/\//i.test(u)).slice(0, 4) : [];
  const scheduledFor = req.body?.scheduledFor ? String(req.body.scheduledFor) : null;
  const profileId = String(req.body?.profileId || '').trim();
  if (!text && !mediaUrls.length) return _err(res, 400, 'text or mediaUrls required');
  if (!platforms.length) return _err(res, 400, `select at least one platform (allowed: ${PLATFORMS.join(', ')})`);
  if (!profileId) return _err(res, 400, 'profileId required');
  const payload = { text, platforms, profileId };
  if (mediaUrls.length) payload.mediaUrls = mediaUrls;
  if (scheduledFor) payload.scheduledFor = scheduledFor;
  const r = await _zernio('POST', '/posts', payload);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  res.json({ ok:true, post: r.data?.post || r.data, scheduled: !!scheduledFor });
});

router.get('/posts', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', posts:[], note:'Add ZERNIO_API_KEY.' });
  const profileId = String(req.query.profileId || '').trim();
  const path = profileId ? `/posts?profileId=${encodeURIComponent(profileId)}` : '/posts';
  const r = await _zernio('GET', path);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  res.json({ ok:true, posts: r.data?.posts || r.data?.data || (Array.isArray(r.data) ? r.data : []) });
});

router.delete('/posts/:id', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'ZERNIO_API_KEY required.');
  const id = String(req.params.id);
  const r = await _zernio('DELETE', `/posts/${encodeURIComponent(id)}`);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error, r.status));
  res.json({ ok:true });
});

router.post('/schedule-calendar', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'ZERNIO_API_KEY required.');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const profileId = String(req.body?.profileId || '').trim();
  const platformMap = req.body?.platformMap || {};
  if (!profileId) return _err(res, 400, 'profileId required');
  if (!items.length) return _err(res, 400, 'items required (array of {date, channel, copy, mediaUrl?})');
  const results = [];
  for (const it of items.slice(0, 60)) {
    const text = String(it.copy || it.text || '').trim();
    const channel = String(it.channel || '').toLowerCase();
    const mapped = platformMap[channel] || (PLATFORMS.includes(channel) ? channel : null);
    if (!text || !mapped) { results.push({ ok:false, error:`skipped ${it.date}/${channel}: no copy or unmapped channel`, item: it }); continue; }
    const platforms = Array.isArray(mapped) ? mapped : [mapped];
    const validPlatforms = platforms.filter(p => PLATFORMS.includes(p));
    if (!validPlatforms.length) { results.push({ ok:false, error:`unmapped channel: ${channel}`, item: it }); continue; }
    const payload = { text, platforms: validPlatforms, profileId };
    if (it.date) payload.scheduledFor = new Date(it.date).toISOString();
    if (it.mediaUrl && /^https?:\/\//i.test(it.mediaUrl)) payload.mediaUrls = [it.mediaUrl];
    const r = await _zernio('POST', '/posts', payload);
    results.push(r.ok ? { ok:true, post: r.data?.post || r.data, item: it } : { ok:false, error: _friendlyError(r.error, r.status), item: it });
  }
  const scheduled = results.filter(r => r.ok).length;
  res.json({ ok:true, scheduled, failed: results.length - scheduled, total: results.length, results });
});

module.exports = router;
