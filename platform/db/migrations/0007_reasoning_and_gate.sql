-- Phase 2 · Migration 0007 — Reasoning layer & the governed action pipeline
--
-- Block 3 (LLM gateway, prompt registry, cost metering), Block 5 (capability
-- registry + autonomy ladder), and §5.6 (the gate). Every model call is metered
-- at the gateway; every capability declares its archetype, entry autonomy and
-- ceiling; every consequential action passes the gate before it can execute.

-- Capability registry (platform-global). Each of the product features is a row
-- here — declaring its archetype, entry autonomy and ceiling (Block 5). This is
-- what lets 130 features be registrations on one spine rather than 130 builds.
create table capabilities (
  key              text primary key,
  name             text not null,
  domain           text not null,   -- compete | grow | reach | create | analyse | monitor | manage | seo
  archetype        text not null,   -- content_generation | knowledge | analysis | planning | operations | localisation
  agent_type       text not null,   -- embedded | input_heavy | orchestration | output_heavy | autonomous | human_in_loop
  requires_context boolean not null default true,   -- needs Brand Foundation injected
  irreversible     boolean not null default false,  -- irreversible actions never exceed A2
  entry_autonomy   integer not null default 1,      -- A0..A4 a capability enters at
  autonomy_ceiling integer not null default 2,      -- A0..A4 max it may be promoted to
  description      text
);

-- Per-tenant, per-capability autonomy level (the autonomy ladder as config).
create table tenant_capability_autonomy (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  capability_key text not null references capabilities(key),
  level          integer not null default 0,   -- A0..A4, promoted on evidence
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, capability_key)
);
select apply_tenant_rls('tenant_capability_autonomy');

-- Versioned prompt templates (production artefacts under change control, not
-- strings in code). Platform-global.
create table prompt_templates (
  key        text not null,
  version    integer not null,
  is_current boolean not null default true,
  template   text not null,
  created_at timestamptz not null default now(),
  primary key (key, version)
);
create unique index prompt_current_one_per_key on prompt_templates (key) where is_current;

-- Gateway cost metering: one row per model call, attributed to a tenant.
create table model_calls (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  capability_key    text,
  model             text not null,
  model_class       text not null,   -- frontier | small | tuned | mock
  purpose           text not null,
  input_tokens      integer not null default 0,
  output_tokens     integer not null default 0,
  cost_usd          numeric(12,6) not null default 0,
  injection_flagged boolean not null default false,
  mode              text not null,   -- live | mock
  created_at        timestamptz not null default now()
);
create index model_calls_tenant_idx on model_calls (tenant_id, created_at desc);
select apply_tenant_rls('model_calls');

-- The governed action pipeline (§5.6). A proposed consequential action is
-- recorded with the gate's verdict; it can only be executed if the gate allows
-- AND the tenant's autonomy level permits auto-execution, otherwise it is queued
-- for human approval or blocked outright.
create table actions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  capability_key text not null references capabilities(key),
  status         text not null check (status in ('pending_approval', 'approved', 'executed', 'blocked', 'rejected')),
  autonomy_level integer not null,
  gate           jsonb not null default '{}'::jsonb,   -- the 7-check verdict, human-readable
  input          jsonb not null default '{}'::jsonb,
  output         jsonb not null default '{}'::jsonb,
  model_call_id  uuid references model_calls(id),
  created_by     text,
  approved_by    text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create index actions_tenant_status_idx on actions (tenant_id, status, created_at desc);
select apply_tenant_rls('actions');

-- Seed a representative slice of the capability registry from the feature
-- reference. Autonomy defaults follow the Block 5 interaction-model table:
-- content generation is embedded/A1; competitive research is input-heavy/A3;
-- outbound send is output-heavy and irreversible (capped A2).
insert into capabilities (key, name, domain, archetype, agent_type, requires_context, irreversible, entry_autonomy, autonomy_ceiling, description) values
  ('create.content_generation', 'Content Generation', 'create', 'content_generation', 'embedded', true, false, 1, 3, 'Generate on-brand content (ad copy, posts, briefs) grounded in Brand Foundation.'),
  ('compete.battle_cards',       'Battle Cards',        'compete', 'knowledge',          'input_heavy', true, false, 1, 3, 'Structured competitive comparison — strengths, weaknesses, counter-plays.'),
  ('seo.content_brief',          'SEO Content Brief',   'seo',     'content_generation', 'embedded', true, false, 1, 3, 'Search-intent-matched content brief grounded in Brand Foundation.'),
  ('reach.outbound_send',        'Outbound Send',       'reach',   'operations',         'output_heavy', true, true, 1, 2, 'Deliver a message to a recipient — irreversible, capped at A2.');

insert into prompt_templates (key, version, template) values
  ('create.content_generation', 1,
   'You are the Content Generation capability for {{company}}. Using ONLY the brand context provided, write {{format}} for this brief. Match the brand voice. Do not invent facts, and do not make comparative, superlative, or regulated claims.');
