/**
 * Social × Search winners — pages/URLs from GSC that look like social/video
 * content earning Search / Discover visibility (clicks, impressions, CTR, position).
 */

const { hasGscCredentials, listSites, querySearchAnalytics } = require('./client');

const PLATFORM_PATTERNS = [
  { id: 'instagram', re: /instagram\.com/i },
  { id: 'tiktok', re: /tiktok\.com/i },
  { id: 'youtube', re: /(youtube\.com|youtu\.be)/i },
  { id: 'twitter', re: /(twitter\.com|x\.com)\//i },
  { id: 'facebook', re: /(facebook\.com|fb\.com|fb\.watch)/i },
  { id: 'linkedin', re: /linkedin\.com/i },
];

const SOCIAL_PATH_HINTS = /\/(reel|reels|shorts|video|watch|status|p\/|posts?\/|share\/)/i;

function detectPlatform(url) {
  const u = String(url || '');
  for (const p of PLATFORM_PATTERNS) {
    if (p.re.test(u)) return p.id;
  }
  if (SOCIAL_PATH_HINTS.test(u)) return 'social_web';
  return null;
}

function isSocialSearchRow(row) {
  const page = String((row.keys && row.keys[0]) || row.page || '');
  return !!detectPlatform(page);
}

/** Score blends search clicks + impressions (search visibility, not likes). */
function scoreRow(row) {
  const clicks = Number(row.clicks || 0);
  const impressions = Number(row.impressions || 0);
  const ctr = Number(row.ctr || 0);
  const pos = Number(row.position || 50);
  // Prefer clicks; reward impression volume lightly; slight boost for better position
  const posBoost = pos > 0 && pos <= 10 ? 20 : pos <= 20 ? 10 : 0;
  return Math.round(clicks * 12 + Math.min(impressions, 5000) * 0.05 + ctr * 2 + posBoost);
}

function rowToWinner(row, { siteUrl, source = 'gsc_search' } = {}) {
  const page = String((row.keys && row.keys[0]) || row.page || '');
  const platform = detectPlatform(page) || 'social_web';
  const engTotal = scoreRow(row);
  return {
    source,
    text: `Search-visible ${platform} content: ${page}`,
    page_url: page,
    platforms: platform === 'twitter' ? ['twitter'] : platform === 'social_web' ? ['instagram', 'youtube'] : [platform],
    engTotal,
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: row.position != null ? Number(row.position) : null,
    siteUrl: siteUrl || null,
    search_channel: 'google_search_discover',
  };
}

function demoWinners() {
  return [
    {
      source: 'gsc_search_demo',
      text: 'Search-visible youtube content: https://www.youtube.com/watch?v=demoHookFramework',
      page_url: 'https://www.youtube.com/watch?v=demoHookFramework',
      platforms: ['youtube'],
      engTotal: 520,
      clicks: 38,
      impressions: 2400,
      ctr: 1.58,
      position: 8.2,
      siteUrl: null,
      search_channel: 'google_search_discover',
    },
    {
      source: 'gsc_search_demo',
      text: 'Search-visible instagram content: https://www.instagram.com/reel/demoCadenceRefresh/',
      page_url: 'https://www.instagram.com/reel/demoCadenceRefresh/',
      platforms: ['instagram'],
      engTotal: 410,
      clicks: 22,
      impressions: 1800,
      ctr: 1.22,
      position: 12.4,
      siteUrl: null,
      search_channel: 'google_search_discover',
    },
    {
      source: 'gsc_search_demo',
      text: 'Search-visible tiktok content: https://www.tiktok.com/@brand/video/demoUnpopularOpinion',
      page_url: 'https://www.tiktok.com/@brand/video/demoUnpopularOpinion',
      platforms: ['tiktok'],
      engTotal: 360,
      clicks: 18,
      impressions: 3200,
      ctr: 0.56,
      position: 15.1,
      siteUrl: null,
      search_channel: 'google_search_discover',
    },
  ];
}

/**
 * Fetch social-ish pages earning Google Search/Discover visibility.
 * @returns {Promise<{ ok:boolean, configured:boolean, source:string, siteUrl:string|null, winners:array, note?:string }>}
 */
async function fetchSocialSearchWinners(opts = {}) {
  const limit = Math.min(20, Math.max(1, Number(opts.limit) || 10));
  const days = Math.max(1, Math.min(90, Number(opts.days) || 28));
  const allowDemo = opts.allowDemo !== false;

  if (!hasGscCredentials()) {
    return {
      ok: true,
      configured: false,
      source: allowDemo ? 'demo' : 'none',
      siteUrl: null,
      winners: allowDemo ? demoWinners().slice(0, limit) : [],
      note: 'Connect GOOGLE_SERVICE_ACCOUNT_JSON + verify a Search Console property to replace demo social×search rows.',
    };
  }

  let siteUrl = String(opts.siteUrl || process.env.GSC_SITE_URL || '').trim();
  if (!siteUrl) {
    const sites = await listSites();
    siteUrl = sites.sites?.[0]?.siteUrl || '';
  }
  if (!siteUrl) {
    return {
      ok: true,
      configured: true,
      source: allowDemo ? 'demo' : 'none',
      siteUrl: null,
      winners: allowDemo ? demoWinners().slice(0, limit) : [],
      note: 'No Search Console sites found for this service account.',
    };
  }

  // Page dimension — filter client-side for social URLs (new GSC social measurement surfaces as pages)
  const q = await querySearchAnalytics({
    siteUrl,
    days,
    dimensions: ['page'],
    rowLimit: Math.min(1000, Number(opts.rowLimit) || 500),
  });

  if (!q.ok) {
    return {
      ok: true,
      configured: true,
      source: allowDemo ? 'demo' : 'none',
      siteUrl,
      winners: allowDemo ? demoWinners().slice(0, limit) : [],
      note: q.error || 'GSC query failed — showing demo social×search winners.',
      error: q.error,
    };
  }

  let socialRows = (q.rows || []).filter(isSocialSearchRow);
  // If property is a brand site with few social URLs, also keep top pages that look like /video|/reel paths
  if (!socialRows.length) {
    socialRows = (q.rows || []).filter((r) => SOCIAL_PATH_HINTS.test(String(r.keys?.[0] || '')));
  }

  const winners = socialRows
    .map((r) => rowToWinner(r, { siteUrl, source: 'gsc_search' }))
    .sort((a, b) => (b.engTotal || 0) - (a.engTotal || 0))
    .slice(0, limit);

  if (!winners.length && allowDemo) {
    return {
      ok: true,
      configured: true,
      source: 'demo',
      siteUrl,
      winners: demoWinners().slice(0, limit),
      note: 'No social/video URLs in GSC page report yet (rollout may be gradual). Demo rows shown.',
      live_rows_scanned: (q.rows || []).length,
    };
  }

  return {
    ok: true,
    configured: true,
    source: 'gsc_search',
    siteUrl,
    winners,
    live_rows_scanned: (q.rows || []).length,
    social_rows: socialRows.length,
    days,
  };
}

function insightFromWinners(payload) {
  const winners = payload?.winners || [];
  if (!winners.length) return null;
  const top = winners[0];
  const totalClicks = winners.reduce((s, w) => s + (w.clicks || 0), 0);
  const totalImp = winners.reduce((s, w) => s + (w.impressions || 0), 0);
  const platforms = [...new Set(winners.flatMap((w) => w.platforms || []))];
  return {
    kind: 'opportunity',
    pillar: 'social-search',
    horizon: 'now',
    headline: `${winners.length} social assets earning Google Search visibility`,
    detail: `Top: ${(top.page_url || '').slice(0, 80)} · ${top.clicks || 0} clicks · ${top.impressions || 0} impr · avg pos ${top.position ?? '—'}. Totals: ${totalClicks} clicks / ${totalImp} impressions across ${platforms.join(', ') || 'social'}.`,
    action_view: 'social-publisher',
    action_label: 'Prioritize in evergreen',
    metrics: { clicks: totalClicks, impressions: totalImp, winners: winners.length, source: payload.source },
  };
}

module.exports = {
  detectPlatform,
  isSocialSearchRow,
  scoreRow,
  rowToWinner,
  demoWinners,
  fetchSocialSearchWinners,
  insightFromWinners,
  PLATFORM_PATTERNS,
};
