-- Phase 0 · Migration 0004 — Consent, preference & suppression
--
-- Section 9.3 — "the single most compliance-critical data structure in the
-- platform, and the reason it is built in Phase 0." Consent is per person, per
-- channel, per purpose (never a single boolean); every record carries its
-- provenance; withdrawal is as easy as granting; suppression is hierarchical;
-- and reachability is resolved at send time, never cached from build time.

-- Tenant-scoped person/contact.
create table persons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  external_id text,                       -- id in the tenant's source system
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  erased_at   timestamptz                 -- set by a data-subject erasure (DSR)
);
create index persons_tenant_idx on persons (tenant_id);
select apply_tenant_rls('persons');

-- Append-mostly consent ledger. The latest record per (person, channel,
-- purpose) is authoritative; history is retained for proof.
create table consent_records (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  person_id      uuid not null references persons(id) on delete cascade,
  channel        text not null,           -- email | sms | whatsapp | push | voice
  purpose        text not null,           -- transactional | marketing | ...
  state          text not null check (state in ('granted', 'withdrawn')),
  source         text not null,           -- where the consent was captured
  method         text not null,           -- how (form, import, api, double-opt-in)
  notice_version text,                     -- exact notice/policy version shown
  proof          jsonb not null default '{}'::jsonb,  -- evidence of capture
  occurred_at    timestamptz not null default now()
);
create index consent_lookup_idx on consent_records (tenant_id, person_id, channel, purpose, occurred_at desc);
select apply_tenant_rls('consent_records');

-- Tenant-scoped suppression (tenant / campaign / regulatory scopes).
create table suppressions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  scope        text not null check (scope in ('tenant', 'campaign', 'regulatory')),
  channel      text not null,
  address_hash text not null,             -- sha256(normalised email/phone)
  campaign_id  uuid,
  reason       text not null,
  created_at   timestamptz not null default now()
);
create index suppressions_lookup_idx on suppressions (tenant_id, channel, address_hash);
select apply_tenant_rls('suppressions');

-- Platform-global suppression (a cross-tenant do-not-contact list). Keyed by a
-- one-way address hash so it survives erasure of the underlying person, and so
-- it can be honoured without holding the plaintext address. Deliberately NOT
-- tenant-scoped — it is the platform's global unsubscribe / DNC register — and
-- therefore has no RLS. Reads are through the reachability service only.
create table global_suppressions (
  address_hash text not null,
  channel      text not null,
  reason       text not null,
  created_at   timestamptz not null default now(),
  primary key (address_hash, channel)
);
grant select, insert on global_suppressions to infogenie_app;
