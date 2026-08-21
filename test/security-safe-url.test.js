'use strict';
// test/security-safe-url.test.js — outbound HTTPS destination policy.
//
// Locks the fail-closed contract of services/security/safe_url.js. DNS is
// mocked, so no test resolves or contacts anything. ZERO skips: every case runs
// without a database or network.

const { test } = require('node:test');
const assert = require('node:assert');
const dnsPromises = require('node:dns').promises;

const safeUrl = require('../services/security/safe_url');

// Swap dns.promises.lookup for a table lookup. `answers` maps hostname →
// address list, or an Error to simulate NXDOMAIN/SERVFAIL. An array of tables
// is consumed one call at a time, which is how the rebinding case is built.
function withDns(answers, fn) {
  const original = dnsPromises.lookup;
  const tables = Array.isArray(answers) ? answers.slice() : [answers];
  dnsPromises.lookup = async (hostname) => {
    const table = tables.length > 1 ? tables.shift() : tables[0];
    const entry = table[hostname];
    if (entry === undefined) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    if (entry instanceof Error) throw entry;
    return entry.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => { dnsPromises.lookup = original; });
}

const PUBLIC = { 'example.com': ['93.184.216.34'] };

// ── Accepted destinations ───────────────────────────────────────────────────
test('a public https host on the default port is accepted and pins its addresses', async () => {
  await withDns(PUBLIC, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://example.com/landing?utm=1');
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.hostname, 'example.com');
    assert.equal(res.port, 443);
    assert.deepEqual(res.addresses, ['93.184.216.34']);
  });
});

test('an explicit :443 is accepted and normalises to the default port', async () => {
  await withDns(PUBLIC, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://example.com:443/x');
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.port, 443);
  });
});

// ── Scheme, credentials, shape ──────────────────────────────────────────────
test('non-https schemes are refused', async () => {
  await withDns(PUBLIC, async () => {
    for (const raw of [
      'http://example.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'ftp://example.com/',
      'gopher://example.com/',
    ]) {
      const res = await safeUrl.assertSafeHttpsUrl(raw);
      assert.equal(res.ok, false, `${raw} must be refused`);
      assert.equal(res.error, 'unsafe_url');
      assert.equal(res.reason, 'protocol_not_https', `${raw} → ${res.reason}`);
    }
  });
});

test('credentials in the URL are refused', async () => {
  await withDns(PUBLIC, async () => {
    for (const raw of [
      'https://user:pass@example.com/',
      'https://user@example.com/',
      'https://:pass@example.com/',
    ]) {
      const res = await safeUrl.assertSafeHttpsUrl(raw);
      assert.equal(res.ok, false, `${raw} must be refused`);
      assert.equal(res.reason, 'credentials_in_url', `${raw} → ${res.reason}`);
    }
  });
});

test('a malformed, empty or over-long URL is refused rather than thrown', async () => {
  await withDns(PUBLIC, async () => {
    assert.equal((await safeUrl.assertSafeHttpsUrl('not a url')).reason, 'invalid_url');
    assert.equal((await safeUrl.assertSafeHttpsUrl('')).reason, 'missing_url');
    assert.equal((await safeUrl.assertSafeHttpsUrl(null)).reason, 'missing_url');
    assert.equal((await safeUrl.assertSafeHttpsUrl(undefined)).reason, 'missing_url');
    const long = `https://example.com/${'a'.repeat(safeUrl.MAX_URL_LENGTH)}`;
    assert.equal((await safeUrl.assertSafeHttpsUrl(long)).reason, 'url_too_long');
  });
});

// ── Blocked names ───────────────────────────────────────────────────────────
test('loopback and internal hostnames are blocked before DNS runs', async () => {
  // The table has no entries: a name that reached the resolver would surface
  // dns_lookup_failed, so hostname_blocked proves the name never got there.
  await withDns({}, async () => {
    for (const host of [
      'localhost', 'localhost.', 'LOCALHOST', 'app.localhost',
      'metadata', 'metadata.google.internal', 'metadata.goog',
      'anything.internal', 'printer.local',
    ]) {
      const res = await safeUrl.assertSafeHttpsUrl(`https://${host}/`);
      assert.equal(res.ok, false, `${host} must be refused`);
      assert.equal(res.reason, 'hostname_blocked', `${host} → ${res.reason}`);
    }
  });
});

// ── Blocked literals ────────────────────────────────────────────────────────
test('private, loopback and metadata IP literals are blocked', async () => {
  await withDns({}, async () => {
    for (const host of [
      '127.0.0.1', '127.1.2.3', '0.0.0.0',
      '10.0.0.5', '10.255.255.254',
      '192.168.1.1', '172.16.0.1', '172.31.255.1',
      '100.64.0.1', '100.127.9.9',
      '169.254.1.1', '169.254.169.254',
      '224.0.0.1', '255.255.255.255',
      '[::1]', '[::]', '[::ffff:127.0.0.1]', '[::ffff:8.8.8.8]',
      '[fd00:ec2::254]', '[fc00::1]', '[fe80::1]', '[ff02::1]',
    ]) {
      const res = await safeUrl.assertSafeHttpsUrl(`https://${host}/`);
      assert.equal(res.ok, false, `${host} must be refused`);
      assert.equal(res.reason, 'ip_blocked', `${host} → ${res.reason}`);
    }
  });
});

test('a public IP literal is allowed and pins itself', async () => {
  await withDns({}, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://93.184.216.34/');
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.addresses, ['93.184.216.34']);
  });
});

test('decimal, hex, octal and short-form IP encodings are refused', async () => {
  await withDns({}, async () => {
    for (const host of ['2130706433', '0x7f000001', '0177.0.0.1', '127.1', '192.168.1']) {
      const res = await safeUrl.assertSafeHttpsUrl(`https://${host}/`);
      assert.equal(res.ok, false, `${host} must be refused`);
      assert.equal(res.reason, 'ip_literal_ambiguous', `${host} → ${res.reason}`);
    }
  });
});

test('isBlockedIp fails closed on anything that is not a parseable IP', () => {
  assert.equal(safeUrl.isBlockedIp('93.184.216.34'), false);
  assert.equal(safeUrl.isBlockedIp('2606:2800:220:1:248:1893:25c8:1946'), false);
  for (const v of ['', null, undefined, 'not-an-ip', '999.1.1.1', '0x7f000001', 42]) {
    assert.equal(safeUrl.isBlockedIp(v), true, `${String(v)} must be treated as blocked`);
  }
});

// ── Ports ───────────────────────────────────────────────────────────────────
test('any explicit port other than 443 is refused', async () => {
  await withDns(PUBLIC, async () => {
    for (const port of [80, 8080, 8443, 22, 6379, 5432]) {
      const res = await safeUrl.assertSafeHttpsUrl(`https://example.com:${port}/`);
      assert.equal(res.ok, false, `:${port} must be refused`);
      assert.equal(res.reason, 'port_not_allowed', `:${port} → ${res.reason}`);
    }
  });
});

// ── DNS ─────────────────────────────────────────────────────────────────────
test('a DNS failure is not safe', async () => {
  await withDns({ 'broken.example': new Error('SERVFAIL') }, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://broken.example/');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'dns_lookup_failed');
  });
  await withDns({}, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://nxdomain.example/');
    assert.equal(res.reason, 'dns_lookup_failed');
  });
  await withDns({ 'empty.example': [] }, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://empty.example/');
    assert.equal(res.reason, 'dns_no_addresses');
  });
});

test('a public name whose A record is private is refused', async () => {
  await withDns({ 'evil.example': ['10.1.2.3'] }, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://evil.example/');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'private_address');
  });
  // A mixed record set is refused too — one private answer disqualifies the host.
  await withDns({ 'mixed.example': ['93.184.216.34', '169.254.169.254'] }, async () => {
    const res = await safeUrl.assertSafeHttpsUrl('https://mixed.example/');
    assert.equal(res.reason, 'private_address');
  });
});

// ── Redirects ───────────────────────────────────────────────────────────────
test('a redirect target runs the identical policy', async () => {
  await withDns({ ...PUBLIC, 'internal.example': ['192.168.5.5'] }, async () => {
    const downgrade = await safeUrl.assertSafeRedirect('http://example.com/');
    assert.equal(downgrade.ok, false);
    assert.equal(downgrade.reason, 'protocol_not_https');

    const toPrivate = await safeUrl.assertSafeRedirect('https://internal.example/');
    assert.equal(toPrivate.ok, false);
    assert.equal(toPrivate.reason, 'private_address');

    const toMetadata = await safeUrl.assertSafeRedirect('https://169.254.169.254/latest/meta-data/');
    assert.equal(toMetadata.ok, false);
    assert.equal(toMetadata.reason, 'ip_blocked');

    const okRedirect = await safeUrl.assertSafeRedirect('https://example.com/next');
    assert.equal(okRedirect.ok, true, JSON.stringify(okRedirect));
    assert.deepEqual(okRedirect.addresses, ['93.184.216.34']);
  });
});

// ── DNS rebinding ───────────────────────────────────────────────────────────
test('a host that answers public then private fails the pin check', async () => {
  await withDns([
    { 'rebind.example': ['93.184.216.34'] },
    { 'rebind.example': ['169.254.169.254'] },
  ], async () => {
    const first = await safeUrl.assertSafeHttpsUrl('https://rebind.example/');
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(first.addresses, ['93.184.216.34']);

    // Second resolution is what a fetch would use — it must not be reached.
    const pinned = await safeUrl.assertPinnedAddresses('rebind.example', first.addresses);
    assert.equal(pinned.ok, false);
    assert.equal(pinned.reason, 'private_address');
  });
});

test('a pin whose record set merely changed to another public address is refused', async () => {
  await withDns([
    { 'moved.example': ['93.184.216.34'] },
    { 'moved.example': ['93.184.216.35'] },
  ], async () => {
    const first = await safeUrl.assertSafeHttpsUrl('https://moved.example/');
    assert.equal(first.ok, true);
    const pinned = await safeUrl.assertPinnedAddresses('moved.example', first.addresses);
    assert.equal(pinned.ok, false);
    assert.equal(pinned.reason, 'dns_rebind');
  });
});

test('an unchanged public record set passes the pin check', async () => {
  await withDns(PUBLIC, async () => {
    const first = await safeUrl.assertSafeHttpsUrl('https://example.com/');
    const pinned = await safeUrl.assertPinnedAddresses('example.com', first.addresses);
    assert.equal(pinned.ok, true, JSON.stringify(pinned));
    assert.deepEqual(pinned.addresses, ['93.184.216.34']);
  });
});

test('assertPinnedAddresses fails closed on a missing or private pin', async () => {
  await withDns(PUBLIC, async () => {
    assert.equal((await safeUrl.assertPinnedAddresses('', ['93.184.216.34'])).reason, 'missing_hostname');
    assert.equal((await safeUrl.assertPinnedAddresses('example.com', [])).reason, 'missing_pinned_addresses');
    assert.equal((await safeUrl.assertPinnedAddresses('example.com', null)).reason, 'missing_pinned_addresses');
    assert.equal((await safeUrl.assertPinnedAddresses('example.com', ['10.0.0.1'])).reason, 'private_address');
    assert.equal((await safeUrl.assertPinnedAddresses('localhost', ['93.184.216.34'])).reason, 'hostname_blocked');
  });
});

// ── Caller contract ─────────────────────────────────────────────────────────
test('the module exports a stable surface and opens no sockets', () => {
  for (const k of ['assertSafeHttpsUrl', 'assertSafeRedirect', 'assertPinnedAddresses', 'isBlockedIp']) {
    assert.equal(typeof safeUrl[k], 'function', `${k} must stay exported`);
  }
  assert.equal(safeUrl.MAX_URL_LENGTH, 2048);
  assert.equal(safeUrl.ALLOWED_PORT, 443);

  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services/security/safe_url.js'), 'utf8'
  );
  // There is no fetch sink in the policy module by design; adding one here
  // would bypass the pin-then-connect contract the callers are told to follow.
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'safe_url must not perform requests');
  assert.doesNotMatch(src, /require\(['"](node:)?https?['"]\)/, 'safe_url must not load an HTTP client');
});

test('a resolver that does not answer is refused rather than waited on', async () => {
  // An attacker-chosen hostname delegated to a blackholed nameserver would
  // otherwise hold the calling request open for the whole getaddrinfo retry
  // schedule.
  const original = dnsPromises.lookup;
  dnsPromises.lookup = () => new Promise(() => {});
  try {
    const started = Date.now();
    const res = await safeUrl.assertSafeHttpsUrl('https://blackhole.example/');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'dns_lookup_timeout');
    assert.ok(Date.now() - started < safeUrl.DNS_TIMEOUT_MS * 3,
      'the wait must be bounded by DNS_TIMEOUT_MS');
  } finally {
    dnsPromises.lookup = original;
  }
});

test('the orchestrator landing_page_url policy is wired into workflows_api', async () => {
  // Backend wired this module into create and PATCH. The assertion is that the
  // call site still exists on both write paths — a landing page that is only
  // shape-checked (https, credential-free, <=2048) would pass a private,
  // loopback or metadata host straight into the row.
  await withDns({ ...PUBLIC, 'lp.internal.example': ['10.10.0.9'] }, async () => {
    const good = await safeUrl.assertSafeHttpsUrl('https://example.com/campaign-landing');
    assert.equal(good.ok, true, JSON.stringify(good));

    for (const [raw, reason] of [
      ['http://example.com/lp', 'protocol_not_https'],
      ['https://u:p@example.com/lp', 'credentials_in_url'],
      ['https://lp.internal.example/lp', 'private_address'],
      ['https://169.254.169.254/lp', 'ip_blocked'],
      [`https://example.com/${'x'.repeat(2048)}`, 'url_too_long'],
    ]) {
      const res = await safeUrl.assertSafeHttpsUrl(raw);
      assert.equal(res.ok, false, `${raw} must be refused`);
      assert.equal(res.reason, reason, `${raw} → ${res.reason}`);
    }
  });

  const fs = require('node:fs');
  const path = require('node:path');
  const wf = fs.readFileSync(
    path.join(__dirname, '..', 'services/agent_orchestrator/workflows_api.js'), 'utf8'
  );
  assert.match(wf, /require\(['"]\.\.\/security\/safe_url['"]\)/,
    'workflows_api must use the Security-owned policy, not a local URL check');
  assert.match(wf, /assertSafeHttpsUrl\(/, 'the policy must actually be called');
  // Both write paths, not just create: a PATCH that only shape-checks the URL
  // would let an approved workflow be retargeted at an internal host.
  const calls = wf.match(/assertLandingUrl\(/g) || [];
  assert.ok(calls.length >= 3,
    `create and PATCH must both validate the landing page (found ${calls.length} references)`);
  // A `{ ok: false }` result must fail the write. Returning it unchecked is the
  // documented way a caller fails open by its own choice.
  assert.match(wf, /if \(!check\.ok\) fail\('validation_failed'\)/,
    'an unsafe URL must fail the write, not be ignored');
});
