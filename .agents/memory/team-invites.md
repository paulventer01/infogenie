---
name: Team invite flow (security invariants)
description: Durable rules for the email-invite onboarding so cancelled invites can never be a login vector.
---

# Team invites — security invariants

Owner invites a teammate by email/workspace/role; invitee gets an emailed link to
set a password and join. The risky part is revocation, not the happy path.

**Invite tokens MUST be bound to a single workspace.** A bare per-user invite token
lets a cancelled invite still be accepted (and, for an existing account, act as a
password-reset/login vector). Bind each token to its tenant and gate accept on a
*matching pending membership* still existing.
**Why:** an earlier version revoked tokens only when the user's membership count hit
zero, so cancelling one of several invites left a usable token → account takeover.
**How to apply:**
- Accept must (a) require a `status='invited'` membership for the token's exact
  workspace before creating a session, and (b) activate only that one membership —
  never all of a user's invited rows.
- Cancel must always delete the unconsumed token(s) for that exact (user, workspace),
  regardless of the user's other memberships.
- Orphan cleanup (delete the user) is only safe when no password, no identities, not
  owner, and zero remaining memberships.

**Schema note:** the binding column lives on `email_tokens` but is added in the
tenants schema (not auth), because auth's schema runs before `tenants` exists.
