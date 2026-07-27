// Imported FIRST by every test file so config reads these before app modules
// evaluate. Points at the local Phase 0 database; CI overrides via real env.
process.env.DATABASE_URL ??= "postgres://infogenie_app:app_local_dev_only@127.0.0.1:5433/infogenie";
process.env.ADMIN_DATABASE_URL ??= "postgres://postgres@127.0.0.1:5433/infogenie";
process.env.HASH_PEPPER ??= "test-pepper";
// Tests never depend on external networks: pin evidence to the deterministic
// mock adapters (the live no-cost adapters are covered by parser unit tests),
// and strip any model credential so the gateway serves its deterministic mock —
// the suite asserts governed behaviour, never model output, and must not spend.
process.env.EVIDENCE_LIVE = "0";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
