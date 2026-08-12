// Auto-UTM for outbound email HTML — rewrite http(s) links with campaign UTMs.
// Also records attribution touchpoints when revenue events arrive.

function appendAutoUtm(html, opts = {}) {
  const source = String(opts.utm_source || 'infogenie').slice(0, 80);
  const medium = String(opts.utm_medium || 'email').slice(0, 80);
  const campaign = String(opts.utm_campaign || 'campaign').slice(0, 120);
  const content = opts.utm_content ? String(opts.utm_content).slice(0, 120) : '';
  const term = opts.utm_term ? String(opts.utm_term).slice(0, 120) : '';
  const skipPatterns = [
    /unsubscribe/i,
    /mailto:/i,
    /tel:/i,
    /javascript:/i,
    /\/api\/drips\/unsubscribe/i,
    /\/l\//i, // already shortened UTM links
  ];

  return String(html || '').replace(
    /href=(["'])(https?:\/\/[^"']+)\1/gi,
    (full, quote, url) => {
      if (skipPatterns.some((re) => re.test(url))) return full;
      try {
        const u = new URL(url);
        if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', source);
        if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', medium);
        if (!u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', campaign);
        if (content && !u.searchParams.has('utm_content')) u.searchParams.set('utm_content', content);
        if (term && !u.searchParams.has('utm_term')) u.searchParams.set('utm_term', term);
        return `href=${quote}${u.toString()}${quote}`;
      } catch {
        return full;
      }
    }
  );
}

function buildEmailUtm({ channel = 'drip', campaignName, stepLabel, broadcastId }) {
  return {
    utm_source: 'infogenie',
    utm_medium: 'email',
    utm_campaign: String(campaignName || channel || 'email').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) || 'email',
    utm_content: stepLabel || (broadcastId ? `broadcast-${broadcastId}` : ''),
  };
}

module.exports = { appendAutoUtm, buildEmailUtm };
