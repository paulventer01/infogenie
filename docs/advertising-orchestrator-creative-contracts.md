# Advertising Orchestrator PR4A — evidence-to-brief contracts (v1)

Frozen contracts that turn approved research evidence into versioned angles,
hooks, messages, claims, concepts and creative briefs. This PR does **not**
generate static images or video, does **not** call LLMs, and does **not**
publish or activate campaigns. There is no new public `/api` router.

| File | Role |
|---|---|
| `creative_contracts.js` | Enums, limits, field lists |
| `creative_validate.js` | Fail-closed validators |
| `creative_store.js` | Tenant-scoped persist, evidence bind, approval |
| `schema.js` | `orchestrator_creative_artifacts`, `_citations`, `_audit` |

`CONTRACT_VERSION` is `v1`. Tenant authority is `opts.tenantId` from
authenticated context; a mismatched body `tenant_id` is rejected. Human
approval reuses `orchestrator_approvals` (`gate=creative_generation`,
`object_type=creative_artifact`) bound to `approvalContentHash(content_hash, evidence_hash)`.
Approved rows are immutable; revisions insert a new version and supersede the
previous approval. Fixture/synthetic evidence cannot be labelled `live`.
