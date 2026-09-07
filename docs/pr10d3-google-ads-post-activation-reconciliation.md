# PR10D.3 — Human-triggered Google Ads post-activation reconciliation

## Frozen scope

PR10D.3 may perform one synchronous, read-only Google Ads observation for one
terminal PR10D.2 activation attempt. It exists to determine whether the bound
campaign and ad group are active after a `succeeded` or ambiguous `unknown`
activation result. It must not widen Google write authority or any Meta,
publishing, optimization, or automation surface.

## Required behavior

- Require an authenticated real human session, active tenant and membership,
  and the explicit tenant `advertising.campaign.monitor` grant. No API-key,
  owner, admin, platform-role, service, worker, automation, or agent bypass.
- Accept only a server-issued PR10D.2 activation-attempt ID and a bounded
  invocation ID. Caller input cannot supply provider customer/object IDs, URLs,
  queries, fields, statuses, credentials, tokens, payloads, or retry controls.
- Admit only terminal `succeeded` and `unknown` activation attempts. A
  determinate `failed` attempt is ineligible because Google rejected the write.
- Re-lock and revalidate the complete tenant, permission, activation,
  capability, operation, credential version/fingerprint, ledger-root and
  three-object lineage before opening credential scope and before settlement.
- Persist one tenant-scoped `observing` run and its initial audit atomically
  before any credential access, token exchange, or provider traffic.
- Resolve credentials only inside the existing short-lived Google Ads
  read-only reconciliation secret boundary at the last responsible moment.
- Perform exactly three internally generated, ledger-bound GAQL Search reads:
  campaign budget, campaign, and ad group. No mutate endpoint is reachable.
- Classify the complete graph as `verified_active`, `verified_inactive`,
  `discrepancy_detected`, or `failed`. Mixed states, missing objects, identity
  drift, or changed parent relationships are discrepancies; provider/transport
  failures fail the observation without guessing.
- Persist only sanitized status, relationship, classification and timestamp
  evidence. Never expose, audit, or log provider customer IDs, provider object
  IDs, fingerprints, credential references, tokens, URLs, queries, raw
  responses, or raw provider errors.
- Make duplicate delivery metadata-only. It cannot reopen secret scope,
  exchange a token, or contact Google. An expired `observing` lease becomes a
  durable `failed` result and is never automatically retried.
- Expose one narrow, rate-limited human endpoint and one sanitized run lookup.
- Add focused security/unit tests and real PostgreSQL integration tests to the
  advertising certification runner. PostgreSQL and certification must report
  zero skips.

## Hard boundaries

No Google mutate call, provider write, campaign-budget change, bid/spend change,
object creation/deletion, publishing, activation, optimization, remediation,
queue, worker, scheduler, background trigger, automatic retry, UI, generic
query proxy, caller-controlled provider field, or unrelated Meta change.

Keep the complete PR at or below 1,500 changed lines. Do not weaken tests. Keep
the PR draft. Agents do not merge.
