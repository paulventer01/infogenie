-- Phase 0 · Migration 0002 — Multi-tenancy (agency → client hierarchy)
--
-- Block 8 / Section 8.4. Tenants form a two-level hierarchy: an agency parent
-- with client children. Customer data is scoped to a single tenant and isolated
-- by row-level security. The only sanctioned cross-tenant path in the whole
-- platform is the benchmark aggregation service (Phase 5), which is NOT built
-- here — there is deliberately no cross-tenant read path in Phase 0.

create table tenants (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('agency', 'client')),
  parent_tenant_id  uuid references tenants(id) on delete restrict,
  name              text not null,
  slug              text not null unique,
  created_at        timestamptz not null default now(),
  -- A client must sit under an agency; an agency has no parent.
  constraint tenants_hierarchy_ck check (
    (type = 'client' and parent_tenant_id is not null) or
    (type = 'agency' and parent_tenant_id is null)
  )
);

create index tenants_parent_idx on tenants (parent_tenant_id);

-- ---------------------------------------------------------------------------
-- Reusable RLS helper: apply the standard tenant policy to a table that has a
-- NOT NULL `tenant_id uuid`. USING governs which rows are visible; WITH CHECK
-- governs which rows may be written — so a session scoped to tenant A can
-- neither read nor insert tenant B's rows. FORCE ROW LEVEL SECURITY makes the
-- policy apply even to the table owner (defence in depth).
-- ---------------------------------------------------------------------------
create or replace function apply_tenant_rls(target regclass) returns void
  language plpgsql
as $$
begin
  execute format('alter table %s enable row level security', target);
  execute format('alter table %s force row level security', target);
  execute format($p$
    create policy tenant_isolation on %s
      using (tenant_id = app_current_tenant())
      with check (tenant_id = app_current_tenant())
  $p$, target);
end
$$;
