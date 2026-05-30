---
name: Admin audit log (role & membership changes)
description: Design decisions for the append-only admin_audit_log behind platform.audit.view.
---

# Admin audit log

Append-only record of every membership / platform-role mutation made in the
Admin Portal (member add/role-change/remove, platform-role grant/revoke, invite
send/cancel). Written via a best-effort `recordAudit()` helper that never throws
into callers — a logging failure must not break the actual mutation. Surfaced
read-only in the Admin Portal "Audit Log" tab; the router-level platform
owner/admin gate already covers `platform.audit.view`.

**Platform-role changes have no workspace, so the row attributes to the default
tenant** (via `getCronTenantId()`) to satisfy the multitenant `tenant_id NOT
NULL` rule, with `workspace_id` left NULL. Same pattern as the issues table.
**Why:** the audit table is tenant-scoped like every other feature table, but
granting platform admin is a cross-tenant act with no natural tenant.

**Actor/target emails are denormalized snapshots** on the row, not just FK ids.
**Why:** cancelling an invite can orphan-delete the invitee user row, which would
otherwise erase who the entry was about. Old/new role are stored as role *names*
(snapshots) for the same reason.

**How to apply:** to log a new role/membership mutation, capture the prior
role/email BEFORE the mutating query, then call `recordAudit({action, actor*,
target*, tenantId, workspaceId, workspaceName, oldRole, newRole, detail})`.
