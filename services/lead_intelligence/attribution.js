// Parse UTM / click-id params from landing URLs for lead attribution.

function _qp(url, key) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.searchParams.get(key) || null;
  } catch {
    return null;
  }
}

function parseAttribution(pageUrl, extra = {}) {
  const url = String(pageUrl || extra.pageUrl || '').trim();
  const out = {
    utm_source: extra.utm_source || (url ? _qp(url, 'utm_source') : null),
    utm_medium: extra.utm_medium || (url ? _qp(url, 'utm_medium') : null),
    utm_campaign: extra.utm_campaign || (url ? _qp(url, 'utm_campaign') : null),
    utm_term: extra.utm_term || (url ? _qp(url, 'utm_term') : null),
    utm_content: extra.utm_content || (url ? _qp(url, 'utm_content') : null),
    gclid: extra.gclid || (url ? _qp(url, 'gclid') : null),
    fbclid: extra.fbclid || (url ? _qp(url, 'fbclid') : null),
    msclkid: extra.msclkid || (url ? _qp(url, 'msclkid') : null),
    page_url: url || null,
  };
  if (out.gclid || (out.utm_source && /google/i.test(out.utm_source))) out.platform = 'google';
  else if (out.fbclid || (out.utm_source && /facebook|meta|instagram/i.test(out.utm_source))) out.platform = 'meta';
  else if (out.msclkid) out.platform = 'microsoft';
  else if (out.utm_source) out.platform = String(out.utm_source).slice(0, 32).toLowerCase();
  else out.platform = null;
  return out;
}

module.exports = { parseAttribution };
