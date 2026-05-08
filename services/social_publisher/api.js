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

// ── Analytics ─────────────────────────────────────────────────────────────────
// Aggregates per-account engagement from Zernio. Tries 3 endpoint shapes
// because Zernio docs vary: /accounts/:id/analytics, /analytics?accountId=:id,
// and falls back to deriving stats from /posts (which include per-platform
// engagement once published).
async function _fetchAccountAnalytics(accountId, dateRange) {
  const qs = dateRange ? `?range=${encodeURIComponent(dateRange)}` : '';
  let r = await _zernio('GET', `/accounts/${encodeURIComponent(accountId)}/analytics${qs}`);
  if (r.ok) return { ok:true, source:'accounts/:id/analytics', data:r.data };
  r = await _zernio('GET', `/analytics?accountId=${encodeURIComponent(accountId)}${dateRange ? `&range=${encodeURIComponent(dateRange)}` : ''}`);
  if (r.ok) return { ok:true, source:'analytics?accountId=', data:r.data };
  return { ok:false, error: r.error, status: r.status };
}

router.get('/analytics', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'ZERNIO_API_KEY required.');
  const profileId = String(req.query.profileId || '').trim();
  const dateRange = String(req.query.range || '30d').trim();
  if (!profileId) return _err(res, 400, 'profileId required');

  // 1. Get all connected accounts for this profile
  const acctR = await _zernio('GET', `/accounts?profileId=${encodeURIComponent(profileId)}`);
  if (!acctR.ok) return _err(res, 400, _friendlyError(acctR.error, acctR.status));
  const accounts = acctR.data?.accounts || acctR.data?.data || (Array.isArray(acctR.data) ? acctR.data : []);
  if (!accounts.length) return res.json({ ok:true, accounts:[], totals:{ posts:0, impressions:0, engagement:0, followers:0 }, note:'No social accounts connected — connect at least one platform in Social Publisher first.' });

  // 2. Pull posts (each may include engagement) — used as fallback if direct analytics endpoint 404s
  const postsR = await _zernio('GET', `/posts?profileId=${encodeURIComponent(profileId)}`);
  const posts = postsR.ok ? (postsR.data?.posts || postsR.data?.data || (Array.isArray(postsR.data) ? postsR.data : [])) : [];

  // 3. For each account, fetch dedicated analytics + derive from posts
  // Build platform-uniqueness map first — platform-only matching is only safe
  // when this profile has exactly 1 account on that platform (else two
  // accounts on the same platform would each claim 100% of the platform's posts).
  const platformCounts = {};
  for (const a of accounts) {
    const p = String(a.platform || a.network || '').toLowerCase();
    platformCounts[p] = (platformCounts[p] || 0) + 1;
  }
  // Unified engagement extractor — Zernio's per-post engagement may live under
  // analytics, engagement, or stats keys depending on platform/SDK version.
  function _extractEng(p) {
    const e = p?.analytics || p?.engagement || p?.stats || {};
    return {
      impressions: Number(e.impressions || e.views || e.reach || 0),
      likes: Number(e.likes || e.favorites || 0),
      comments: Number(e.comments || e.replies || 0),
      shares: Number(e.shares || e.retweets || e.reposts || 0),
      clicks: Number(e.clicks || e.linkClicks || 0)
    };
  }
  function _engTotal(eng) { return eng.likes + eng.comments + eng.shares + eng.clicks; }

  const out = [];
  let totals = { posts: 0, impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0, followers: 0 };
  for (const a of accounts) {
    const acctId = a._id || a.id;
    const platform = a.platform || a.network || 'unknown';
    const platformLower = String(platform).toLowerCase();
    const username = a.username || a.handle || a.name || '';
    const followerCount = Number(a.followerCount || a.followers || a.audienceSize || 0);
    const platformIsUnique = platformCounts[platformLower] === 1;

    let dedicated = null;
    if (acctId) {
      const dr = await _fetchAccountAnalytics(acctId, dateRange);
      if (dr.ok) dedicated = dr.data?.analytics || dr.data?.data || dr.data || null;
    }

    // Strict per-account post matching:
    //   - If post carries account ID(s), use exact ID match (always correct).
    //   - Else fall back to platform match ONLY when this profile has exactly
    //     one account on that platform (otherwise we'd double-count).
    const myPosts = posts.filter(p => {
      const pAccts = p.accounts || p.accountIds || [];
      const hasIdHints = Array.isArray(pAccts) && pAccts.length > 0;
      if (hasIdHints) return pAccts.some(x => (x?._id || x?.id || x) === acctId);
      if (!platformIsUnique) return false;
      const pPlats = (p.platforms || []).map(x => String(x).toLowerCase());
      return pPlats.includes(platformLower);
    });
    const derived = myPosts.reduce((acc, p) => {
      const e = _extractEng(p);
      acc.posts += 1;
      acc.impressions += e.impressions;
      acc.likes += e.likes;
      acc.comments += e.comments;
      acc.shares += e.shares;
      acc.clicks += e.clicks;
      return acc;
    }, { posts:0, impressions:0, likes:0, comments:0, shares:0, clicks:0 });

    // Prefer dedicated stats if present, else derived
    const stats = {
      posts: Number(dedicated?.posts || derived.posts),
      impressions: Number(dedicated?.impressions || dedicated?.views || derived.impressions),
      likes: Number(dedicated?.likes || derived.likes),
      comments: Number(dedicated?.comments || derived.comments),
      shares: Number(dedicated?.shares || derived.shares),
      clicks: Number(dedicated?.clicks || derived.clicks),
      followers: Number(dedicated?.followers || dedicated?.followerCount || followerCount),
      followerGrowth: Number(dedicated?.followerGrowth || dedicated?.growth7d || 0)
    };
    const totalEng = stats.likes + stats.comments + stats.shares + stats.clicks;
    stats.engagementRate = stats.impressions > 0 ? Number(((totalEng / stats.impressions) * 100).toFixed(2)) : 0;

    // Top post for this account — use the same unified engagement extractor
    // so we don't miss posts whose engagement lives under .engagement or .stats.
    const topPost = myPosts.slice().sort((a,b) => _engTotal(_extractEng(b)) - _engTotal(_extractEng(a)))[0] || null;
    const topPostEng = topPost ? _engTotal(_extractEng(topPost)) : 0;

    totals.posts += stats.posts;
    totals.impressions += stats.impressions;
    totals.likes += stats.likes;
    totals.comments += stats.comments;
    totals.shares += stats.shares;
    totals.clicks += stats.clicks;
    totals.followers += stats.followers;

    out.push({
      accountId: acctId,
      platform,
      username,
      stats,
      topPost: topPost ? {
        id: topPost._id || topPost.id,
        text: String(topPost.text || topPost.content || '').slice(0, 240),
        publishedAt: topPost.publishedAt || topPost.scheduledFor || topPost.createdAt,
        url: topPost.url || topPost.permalink || null,
        engagement: topPostEng
      } : null,
      analyticsSource: dedicated ? 'zernio_analytics_endpoint' : (myPosts.length ? 'derived_from_posts' : 'no_data')
    });
  }
  totals.engagementRate = totals.impressions > 0
    ? Number((((totals.likes + totals.comments + totals.shares + totals.clicks) / totals.impressions) * 100).toFixed(2))
    : 0;

  res.json({ ok:true, profileId, range: dateRange, accounts: out, totals });
});

module.exports = router;
