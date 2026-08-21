// services/security/safe_url.js — outbound HTTPS destination policy (SSRF).
//
// Security-owned. This is the STRICT policy for URLs the platform may be asked
// to dereference on a tenant's behalf (orchestrator landing pages, webhook
// targets, agent fetches). It is deliberately separate from
// `services/_shared/ssrf.js`, which still permits plain `http:` for existing
// features — do not merge the two or relax this one to match it.
//
// It fails closed on every ambiguity: anything this module cannot positively
// classify as a public, https, default-port destination is refused. Nothing
// here performs a request; there is no fetch sink in this module by design.
// A caller that later does fetch must:
//   1. `assertSafeHttpsUrl(url)` and keep the returned `addresses`,
//   2. `assertPinnedAddresses(hostname, addresses)` immediately before the
//      socket is opened (DNS rebinding),
//   3. disable automatic redirect following and re-run `assertSafeRedirect`
//      on every `Location` it chooses to follow.
//
// Errors are returned, never thrown: `{ ok: false, error: 'unsafe_url', reason }`.

const net = require('net');
// Property access at call time (not destructured) so tests can substitute
// `dns.promises.lookup`.
const dnsPromises = require('dns').promises;

const MAX_URL_LENGTH = 2048;
const ALLOWED_PORT = 443;
// The hostname being resolved is attacker-chosen, so the resolver wait is too.
// Without a bound, a name delegated to a blackholed nameserver holds the calling
// request open for the whole getaddrinfo retry schedule. This caps the wait and
// fails closed; it does not cancel the underlying getaddrinfo, which still
// occupies its libuv threadpool slot until the OS gives up.
const DNS_TIMEOUT_MS = 3000;

// Exact hostnames that must never be resolved, regardless of what DNS says.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud instance metadata. `metadata` alone resolves inside GCP via search
  // domains, so the bare label is blocked too.
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  '169.254.169.254',
  'fd00:ec2::254',
]);

// Suffixes reserved for internal/private namespaces.
const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.metadata.google.internal',
  '.metadata.goog',
];

function fail(reason) {
  return { ok: false, error: 'unsafe_url', reason };
}

function _ipv4Blocked(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 0) return true;                          // 0.0.0.0/8 "this network"
  if (a === 10) return true;                         // RFC1918
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;  // RFC1918
  if (a === 192 && b === 168) return true;           // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;          // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;           // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;            // TEST-NET-3
  if (a >= 224) return true;                         // multicast, reserved, broadcast
  return false;
}

function _ipv6FirstHextet(ip) {
  const head = ip.split('::')[0];
  const first = head.split(':')[0];
  if (!first) return 0;
  const n = parseInt(first, 16);
  return Number.isFinite(n) ? n : 0;
}

function _ipv6Blocked(ip) {
  const lower = ip.toLowerCase().replace(/%.*$/, ''); // drop any zone id
  // Everything with a leading `::` is unspecified, loopback, IPv4-compatible or
  // IPv4-mapped (`::ffff:`). None of those is a legitimate public destination.
  if (lower.startsWith('::')) return true;
  const h = _ipv6FirstHextet(lower);
  if (h === 0) return true;
  if (h >= 0xfc00 && h <= 0xfdff) return true;  // unique local (fc00::/7) incl. fd00:ec2::254
  if (h >= 0xfe80 && h <= 0xfebf) return true;  // link-local
  if (h >= 0xfec0 && h <= 0xfeff) return true;  // deprecated site-local
  if (h >= 0xff00) return true;                 // multicast
  if (h === 0x64) return true;                  // 64:ff9b::/96 NAT64 (embeds IPv4)
  if (h === 0x2002) return true;                // 6to4 (embeds IPv4)
  if (lower.startsWith('2001:db8') || lower.startsWith('2001:0db8')) return true; // documentation
  if (lower.startsWith('2001:0:') || lower === '2001::') return true;             // Teredo
  return false;
}

// Public: is this literal address off-limits as an outbound destination?
// Anything that is not a parseable IP is treated as blocked (fail closed).
function isBlockedIp(ip) {
  if (typeof ip !== 'string' || !ip) return true;
  const kind = net.isIP(ip);
  if (kind === 4) return _ipv4Blocked(ip);
  if (kind === 6) return _ipv6Blocked(ip);
  return true;
}

// The WHATWG URL parser silently canonicalises decimal (2130706433), hex
// (0x7f000001), octal (0177.0.0.1) and short-form (127.1) IPv4 encodings into a
// dotted quad, so `u.hostname` no longer shows what the caller actually wrote.
// The raw authority is what a log line or an allowlist elsewhere would show, so
// those encodings are refused outright rather than silently normalised.
function _rawHost(rawUrl) {
  const afterScheme = rawUrl.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const authority = afterScheme.split(/[/?#]/)[0];
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1);
  let host = hostPart.toLowerCase();
  if (host.startsWith('[')) {
    host = host.slice(1, host.indexOf(']') === -1 ? undefined : host.indexOf(']'));
  } else {
    host = host.split(':')[0];
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function _looksLikeIpTrick(host) {
  if (net.isIP(host)) return false;
  if (/^[0-9]+$/.test(host)) return true;
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) return true;
  const labels = host.split('.');
  if (labels.length > 1 && labels.every((l) => /^(0[xX][0-9a-fA-F]+|[0-9]+)$/.test(l))) return true;
  // A real DNS name never ends in an all-numeric label.
  const last = labels[labels.length - 1];
  if (last && /^[0-9]+$/.test(last)) return true;
  return false;
}

function _hostnameShapeOk(host) {
  if (host.length > 253) return false;
  const labels = host.split('.');
  if (labels.some((l) => l.length === 0 || l.length > 63)) return false;
  return labels.every((l) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(l));
}

function _hostnameBlocked(host) {
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s));
}

// Parse + validate everything that does not require the network.
function _staticChecks(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return fail('missing_url');
  if (rawUrl.length > MAX_URL_LENGTH) return fail('url_too_long');

  let u;
  try { u = new URL(rawUrl); } catch (_) { return fail('invalid_url'); }

  if (u.protocol !== 'https:') return fail('protocol_not_https');
  if (u.username || u.password) return fail('credentials_in_url');
  if (u.port !== '' && Number(u.port) !== ALLOWED_PORT) return fail('port_not_allowed');

  // URL brackets IPv6 literals and lowercases the host; a trailing dot is a
  // valid FQDN but would slip past an exact-match blocklist.
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) return fail('missing_hostname');

  const raw = _rawHost(rawUrl);
  if (raw && !net.isIP(raw) && _looksLikeIpTrick(raw)) return fail('ip_literal_ambiguous');

  if (net.isIP(host)) {
    if (isBlockedIp(host)) return fail('ip_blocked');
    return { ok: true, url: u.toString(), hostname: host, port: ALLOWED_PORT, literalIp: host };
  }
  if (_hostnameBlocked(host)) return fail('hostname_blocked');
  if (_looksLikeIpTrick(host)) return fail('ip_literal_ambiguous');
  if (!_hostnameShapeOk(host)) return fail('hostname_invalid');
  return { ok: true, url: u.toString(), hostname: host, port: ALLOWED_PORT, literalIp: null };
}

const TIMED_OUT = Symbol('dns_timeout');

function _lookupWithTimeout(hostname) {
  let timer = null;
  // Deliberately not unref'd: the timer is cleared the moment the race settles,
  // so it only ever outlives a lookup that is still in flight — and a pending
  // getaddrinfo already holds the loop open by itself.
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), DNS_TIMEOUT_MS);
  });
  return Promise.race([dnsPromises.lookup(hostname, { all: true }), expiry])
    .finally(() => { if (timer) clearTimeout(timer); });
}

async function _resolveAll(hostname) {
  let records;
  try {
    records = await _lookupWithTimeout(hostname);
  } catch (_) {
    return fail('dns_lookup_failed');
  }
  if (records === TIMED_OUT) return fail('dns_lookup_timeout');
  const list = Array.isArray(records) ? records : (records ? [records] : []);
  const addresses = list.map((r) => (r && r.address ? String(r.address) : '')).filter(Boolean);
  if (!addresses.length) return fail('dns_no_addresses');
  // ANY blocked answer disqualifies the host — a round-robin record set that
  // mixes a public and a private answer is not safe to fetch.
  if (addresses.some((a) => isBlockedIp(a))) return fail('private_address');
  return { ok: true, addresses };
}

// Primary entry point. Resolves the hostname and returns the pinned address set
// so the caller can detect a rebind before it opens a socket.
async function assertSafeHttpsUrl(rawUrl) {
  const parsed = _staticChecks(rawUrl);
  if (!parsed.ok) return parsed;

  if (parsed.literalIp) {
    return {
      ok: true,
      url: parsed.url,
      hostname: parsed.hostname,
      port: parsed.port,
      addresses: [parsed.literalIp],
    };
  }

  const resolved = await _resolveAll(parsed.hostname);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    url: parsed.url,
    hostname: parsed.hostname,
    port: parsed.port,
    addresses: resolved.addresses,
  };
}

// A redirect target is a brand new destination and gets the identical policy.
// Callers must not delegate redirect following to the HTTP client.
async function assertSafeRedirect(locationUrl) {
  return assertSafeHttpsUrl(locationUrl);
}

// Re-resolve immediately before connecting. A record set that changed between
// validation and connect is refused rather than reconciled.
async function assertPinnedAddresses(hostname, pinnedAddresses) {
  if (typeof hostname !== 'string' || !hostname) return fail('missing_hostname');
  const pinned = Array.isArray(pinnedAddresses)
    ? pinnedAddresses.filter((a) => typeof a === 'string' && a)
    : [];
  if (!pinned.length) return fail('missing_pinned_addresses');
  if (pinned.some((a) => isBlockedIp(a))) return fail('private_address');

  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (_hostnameBlocked(host)) return fail('hostname_blocked');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) return fail('ip_blocked');
    if (pinned.length !== 1 || pinned[0] !== host) return fail('dns_rebind');
    return { ok: true, addresses: [host] };
  }

  const resolved = await _resolveAll(host);
  if (!resolved.ok) return resolved;
  const before = new Set(pinned);
  const after = new Set(resolved.addresses);
  if (before.size !== after.size || [...after].some((a) => !before.has(a))) {
    return fail('dns_rebind');
  }
  return { ok: true, addresses: resolved.addresses };
}

module.exports = {
  assertSafeHttpsUrl,
  assertSafeRedirect,
  assertPinnedAddresses,
  isBlockedIp,
  MAX_URL_LENGTH,
  ALLOWED_PORT,
  DNS_TIMEOUT_MS,
};
