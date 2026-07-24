-- Phase 1 · Migration 0006 — Brand Foundation & context (Block 2)
--
-- "The difference between a system that generates plausible marketing text and
-- one that generates THIS client's marketing, correctly grounded." InfoGenie's
-- single greatest source of defensibility — the layer competitors cannot copy
-- from a model provider. It MUST be versioned (so an asset generated in March
-- can be explained against a brand change in June and rolled back), and it MUST
-- be injected into every generation path — enforced, not encouraged.

create table brand_foundations (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  version               integer not null,
  is_current            boolean not null default true,
  -- Identity & positioning (assembled into the prompt context block)
  company_name          text not null,
  mission               text,
  positioning           text,
  voice_tone            text,
  key_messages          text[] not null default '{}',
  differentiators       text[] not null default '{}',
  competitors           text[] not null default '{}',
  icp                   jsonb not null default '{}'::jsonb,  -- demographics / psychographics / pain points
  -- Brand-safety rules (machine-checkable, consumed by the guardrail gate)
  prohibited_terms      text[] not null default '{}',
  mandatory_disclaimers text[] not null default '{}',
  claim_rules           jsonb not null default '{}'::jsonb,  -- { regulated_categories, comparative_allowed }
  created_at            timestamptz not null default now(),
  created_by            text,
  unique (tenant_id, version)
);
-- Exactly one current version per tenant.
create unique index brand_current_one_per_tenant
  on brand_foundations (tenant_id) where is_current;

select apply_tenant_rls('brand_foundations');
