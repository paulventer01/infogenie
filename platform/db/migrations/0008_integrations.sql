-- Phase 3 · Migration 0008 — Integration hub
--
-- The Feature & Integration Reference (§10) records 27 live integrations and 12
-- deliberately-unconnected ones. The hub makes that landscape first-class:
-- a platform-global provider registry, per-capability bindings (which features
-- draw on which providers), and a tenant-scoped credential vault. Secrets are
-- write-only: stored encrypted at the application layer, never returned by any
-- API, with only a display hint (last 4) readable.

create table integrations (
  key       text primary key,
  name      text not null,
  purpose   text not null,
  status    text not null check (status in ('live', 'pending', 'blocked', 'not_integrated')),
  reason    text,           -- why a non-live integration is not wired (§10.2)
  auth_kind text not null default 'api_key'   -- api_key | oauth | none
);

-- Which capabilities draw on which providers (derived from the reference's
-- "What it does" / "Connected to" text; synced from the code catalog).
create table capability_integrations (
  capability_key  text not null references capabilities(key) on delete cascade,
  integration_key text not null references integrations(key) on delete cascade,
  primary key (capability_key, integration_key)
);

-- Tenant-scoped connector credentials (Block 8 metering surface + §8.2
-- "credential compromise" controls: scoped, encrypted, never rendered back).
create table tenant_integration_credentials (
  tenant_id        uuid not null references tenants(id) on delete cascade,
  integration_key  text not null references integrations(key) on delete cascade,
  secret_encrypted text not null,   -- AES-256-GCM, app-layer key (managed KMS in production)
  secret_hint      text not null,   -- last 4 characters, for display only
  created_by       text,
  created_at       timestamptz not null default now(),
  rotated_at       timestamptz,
  primary key (tenant_id, integration_key)
);
select apply_tenant_rls('tenant_integration_credentials');
