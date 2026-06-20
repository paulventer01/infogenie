// test/helpers/env.js — Test-process environment bootstrap.
//
// MUST be required before any module that touches the credential vault
// (services/credentials/vault.js) or express-session, because both read their
// configuration once and cache it. The harness index.js requires this file at
// the very top, and tests require the harness, so the ordering is guaranteed.
//
// What it does:
//   • Sets a deterministic test CREDENTIAL_ENCRYPTION_KEY when one isn't already
//     present, so vault round-trips (AES-256-GCM encrypt/decrypt) work in the
//     test process exactly as they do in production. Real deployments set their
//     own key; we never clobber it.
//   • Sets a stable SESSION_SECRET fallback so cookie sessions are signable in
//     environments that don't export one (CI, fresh checkouts).
//
// It is intentionally additive and non-destructive: anything already configured
// in the environment wins, so running the suite against a real Replit project
// uses that project's real key material.

// 32 raw bytes, base64-encoded — the exact shape vault._loadKey() expects.
// Fixed (not random) so encrypted blobs are reproducible within a test run and
// across re-runs in the same process. Test-only; never used in production
// because a real CREDENTIAL_ENCRYPTION_KEY is always set there.
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 0x2a).toString('base64');

if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
  process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
}

if (!process.env.SESSION_SECRET) {
  // Deterministic so sessions stay valid if the harness boots more than one app
  // in the same process. INFOGENIE_API_KEY is the same fallback server.js uses.
  process.env.SESSION_SECRET =
    process.env.INFOGENIE_API_KEY || 'infogenie-test-session-secret';
}

module.exports = { TEST_ENCRYPTION_KEY };
