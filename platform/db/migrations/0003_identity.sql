-- Phase 0 · Migration 0003 — Identity & access
--
-- Block 10 identity components. SSO/MFA are enforced in the application layer;
-- the schema carries the state they need (federated identities, TOTP secret,
-- MFA flag). RBAC is modelled as roles → permissions, assigned per membership.
-- "No standing production data access for support roles" is realised by giving
-- support users no memberships and requiring time-boxed, audited JIT elevation.
--
-- These are platform-infrastructure tables (consulted during authentication,
-- before a tenant context exists) rather than tenant customer data, so they are
-- governed by application authorisation and least privilege rather than by the
-- tenant RLS policy applied to customer-data tables.

create table roles (
  key         text primary key,          -- owner | admin | operator | analyst | support | guardrail
  description text not null
);

create table role_permissions (
  role_key   text not null references roles(key) on delete cascade,
  permission text not null,              -- e.g. 'consent:write', 'send:execute', 'audit:read'
  primary key (role_key, permission)
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text,                    -- null for SSO-only accounts
  mfa_enabled   boolean not null default false,
  totp_secret   text,                    -- encrypted at rest in the app layer; never logged
  is_support    boolean not null default false,  -- support staff: no standing tenant access
  created_at    timestamptz not null default now(),
  disabled_at   timestamptz
);

-- Federated identities for SSO (provider + subject uniquely identify a user).
create table identities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  provider   text not null,
  subject    text not null,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);

-- Membership grants a user a role within a tenant. An agency operator holds a
-- membership on the agency tenant and may act within its client tenants; a
-- client user holds a membership on that client only.
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  role_key   text not null references roles(key),
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);
create index memberships_tenant_idx on memberships (tenant_id);

-- Sessions with rolling expiry and revocation. `active_tenant_id` is the client
-- context the session is currently acting within (set when an agency operator
-- enters a client). Only the token *hash* is stored.
create table sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  token_hash        text not null unique,
  active_tenant_id  uuid references tenants(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  expires_at        timestamptz not null,
  revoked_at        timestamptz
);
create index sessions_user_idx on sessions (user_id);

-- Scoped, rotatable service credentials (least privilege). Only the hash is stored.
create table service_credentials (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references tenants(id) on delete cascade,
  name       text not null,
  scopes     jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz
);

-- Just-in-time elevation. Support staff have no memberships; to touch a tenant
-- they request a time-boxed grant with a justification, which is recorded here
-- and in the audit rail, and is visible to the tenant.
create table access_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  reason      text not null,
  granted_by  uuid references users(id),
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index access_grants_lookup_idx on access_grants (user_id, tenant_id, expires_at);

-- Baseline RBAC roles and permissions.
insert into roles (key, description) values
  ('owner',     'Tenant owner — full administrative control within the tenant'),
  ('admin',     'Administrator — manage users, settings and configuration'),
  ('operator',  'Operator — run capabilities and approve governed actions'),
  ('analyst',   'Analyst — read data and insights, no external actions'),
  ('support',   'Platform support — no standing access; JIT elevation only'),
  ('guardrail', 'Guardrail monitor — always-active oversight; cannot be disabled by tenants');

insert into role_permissions (role_key, permission) values
  ('owner','tenant:admin'), ('owner','user:manage'), ('owner','consent:write'),
  ('owner','consent:read'), ('owner','audit:read'), ('owner','dsr:execute'), ('owner','send:approve'),
  ('admin','user:manage'), ('admin','consent:write'), ('admin','consent:read'),
  ('admin','audit:read'), ('admin','dsr:execute'),
  ('operator','consent:write'), ('operator','consent:read'), ('operator','send:approve'),
  ('analyst','consent:read'), ('analyst','audit:read'),
  ('guardrail','audit:read'), ('guardrail','consent:read');
