-- Phase 0 · Migration 0005 — Audit rail (append-only, tamper-evident)
--
-- Block 10 / Section 8. An append-only, tamper-evident record of every
-- consequential action: what happened, which agent or user initiated it, on
-- what evidence, under whose approval, and what the outcome was. The schema is
-- designed for the questions in Section 9, not for developer convenience.
--
-- Tamper-evidence is a per-tenant hash chain: each row's hash covers the
-- previous row's hash plus this row's content, and the hash is computed by a
-- database trigger (not the application), so a client cannot forge the chain.

create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,  -- global monotonic ordering
  tenant_id     uuid references tenants(id) on delete restrict,  -- null = platform-level event
  occurred_at   timestamptz not null default now(),
  actor_type    text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id      text,                    -- user id, agent id or service name
  action        text not null,           -- e.g. 'consent.withdraw', 'dsr.erase', 'session.create'
  resource_type text,
  resource_id   text,
  evidence      jsonb not null default '{}'::jsonb,  -- what the decision was based on
  approval      jsonb not null default '{}'::jsonb,  -- who approved, if applicable
  outcome       text,
  prev_hash     text,
  hash          text not null
);
create index audit_tenant_seq_idx on audit_log (tenant_id, seq);

-- Compute the hash chain on insert. Runs as invoker; under the app's tenant
-- context RLS lets it read this tenant's prior rows, which is exactly the chain
-- scope we want.
create or replace function audit_chain() returns trigger
  language plpgsql
as $$
declare
  prev text;
  payload text;
begin
  select a.hash into prev
    from audit_log a
   where a.tenant_id is not distinct from new.tenant_id
   order by a.seq desc
   limit 1;

  new.prev_hash := prev;
  payload := concat_ws('|',
    coalesce(prev, ''),
    coalesce(new.tenant_id::text, ''),
    new.occurred_at::text,
    new.actor_type,
    coalesce(new.actor_id, ''),
    new.action,
    coalesce(new.resource_type, ''),
    coalesce(new.resource_id, ''),
    coalesce(new.evidence::text, '{}'),
    coalesce(new.approval::text, '{}'),
    coalesce(new.outcome, '')
  );
  new.hash := encode(digest(payload, 'sha256'), 'hex');
  return new;
end
$$;

create trigger audit_chain_trg
  before insert on audit_log
  for each row execute function audit_chain();

-- Enforce append-only: block UPDATE and DELETE for everyone, and additionally
-- revoke the privileges from the app role (defence in depth).
create or replace function audit_immutable() returns trigger
  language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end
$$;

create trigger audit_no_mutate
  before update or delete on audit_log
  for each row execute function audit_immutable();

alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy tenant_isolation on audit_log
  using (tenant_id = app_current_tenant())
  with check (tenant_id = app_current_tenant());

grant select, insert on audit_log to infogenie_app;
revoke update, delete on audit_log from infogenie_app;
