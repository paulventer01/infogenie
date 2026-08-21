-- Phase 0 · Migration 0001 — Foundation: extensions, roles, tenant-context helper
--
-- Run as a superuser (the migration/bootstrap role). Creates the least-privilege
-- application role that all tenant-scoped data access uses at runtime. Because
-- that role is NOT the table owner and does NOT have BYPASSRLS, row-level
-- security applies to it — this is what makes tenant isolation structural
-- (Design Principle 7; hardest-to-reverse decision #3) rather than a matter of
-- application-code discipline.

create extension if not exists pgcrypto;   -- gen_random_uuid(), digest() for the audit hash chain

-- The runtime application role. RLS is enforced against it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'infogenie_app') then
    create role infogenie_app login password 'app_local_dev_only' nosuperuser nobypassrls noinherit;
  end if;
end
$$;

grant usage on schema public to infogenie_app;
-- Default privileges so future tables created by the migrator are usable by the app role.
alter default privileges in schema public
  grant select, insert, update, delete on tables to infogenie_app;
alter default privileges in schema public
  grant usage, select on sequences to infogenie_app;

-- ---------------------------------------------------------------------------
-- Tenant context helper.
--
-- The request middleware sets `app.current_tenant` once per transaction
-- (SET LOCAL). Every RLS policy reads it through this function. The `true`
-- (missing_ok) argument means an unset context resolves to NULL rather than
-- raising — and a NULL context matches no tenant rows, so "no context" fails
-- safe to "no data" instead of leaking everything.
-- ---------------------------------------------------------------------------
create or replace function app_current_tenant() returns uuid
  language sql stable
as $$
  select nullif(current_setting('app.current_tenant', true), '')::uuid
$$;
