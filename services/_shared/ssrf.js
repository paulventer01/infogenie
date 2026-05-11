const net = require('net');
const dns = require('dns').promises;

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.replace('::ffff:', ''));
    return false;
  }
  return true;
}

async function isUrlSafeToFetch(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { return { ok: false, error: 'Invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Only http/https URLs allowed' };
  const host = u.hostname;
  if (!host) return { ok: false, error: 'Missing hostname' };
  if (/^(localhost|metadata\.google\.internal|metadata\.goog)$/i.test(host)) return { ok: false, error: 'Blocked hostname' };
  try {
    const records = await dns.lookup(host, { all: true });
    for (const rec of records) {
      if (isPrivateIp(rec.address)) return { ok: false, error: `Hostname resolves to a private IP (${rec.address})` };
    }
  } catch (e) {
    return { ok: false, error: 'DNS lookup failed: ' + e.message };
  }
  return { ok: true };
}

module.exports = { isPrivateIp, isUrlSafeToFetch };
