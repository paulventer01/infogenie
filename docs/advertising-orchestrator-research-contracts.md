# Advertising Orchestrator PR3A — research evidence contracts (v1)

Authoritative freeze for competitor-research evidence. Three later agents
(PR3B Meta, PR3C Google, PR3D TikTok) implement connectors against **this**
document and the runtime validators. They must not invent parallel shapes.

`CONTRACT_VERSION` is `v1` everywhere. Any other version is rejected.

This PR does **not** call live advertising APIs, does **not** store binaries,
does **not** generate creative, and does **not** publish campaigns. There is no
HTTP router, no `server.js` mount, and no permission-matrix change here.

## Modules

| File | Role |
|---|---|
| `services/agent_orchestrator/research_contracts.js` | Frozen enums, limits, required vs optional field lists |
| `services/agent_orchestrator/research_errors.js` | Connector `failure_class` taxonomy (not HTTP) |
| `services/agent_orchestrator/research_validate.js` | Hand validators; fail closed; `validation_failed` |
| `services/agent_orchestrator/research_connector.js` | Versioned connector **interface** (shapes + asserts, no network) |
| `services/agent_orchestrator/fixtures/research/*.v1.json` | Mocked success / error / pagination examples |
| `services/agent_orchestrator/schema.js` | DDL already landed; do not edit from this freeze |

PR1 `contracts.js` agent placeholders stay stubs. This freeze is the **data**
those agents will emit later.

Validators do not read `req`. Tenant authority is the `tenantId` argument
from authenticated context. If `input.tenant_id` is present and differs,
validation fails. Caller-supplied tenant is never an override.

URL checks here are **syntactic HTTPS only**: a literal `https://` prefix,
length ≤2048, printable ASCII only (no tabs, newlines, backslash authorities or
IDN forms — the stored string must be the string that was validated), no
userinfo, and no credential material in the query. Do **not** call
`assertSafeHttpsUrl` (DNS) from this layer. **PR3E fetch sinks must use**
`services/security/safe_url.js`.

`storage_ref` is a locator, not a fetch target: a scheme-less object key, or
one of `research:` / `https:` (`research_contracts.STORAGE_REF_SCHEMES`).
Protocol-relative refs, userinfo and every other scheme (`file:`, `ftp:`, `s3:`,
`data:`) are refused. Adding a scheme is a Security review.

## Connector file ownership

| PR | File | Must |
|---|---|---|
| PR3B | `services/agent_orchestrator/connectors/meta_research.js` **only** | Implement this interface; do not modify shared contracts or schema |
| PR3C | `services/agent_orchestrator/connectors/google_research.js` **only** | Same |
| PR3D | `services/agent_orchestrator/connectors/tiktok_research.js` **only** | Same |
| PR3A | shared modules in the table above | Freeze only; no live connectors |

Those connector files **do not exist** in PR3A. Do not add them here.

## PR3E reserved (do not implement in PR3B/C/D)

- Runner persistence / INSERT into PR3A tables
- HTTP routes, `server.js` mounts, permission matrix
- Live credential vault wiring
- SSRF pin via `services/security/safe_url.js` for any outbound URL
- `research_run` state machine in `workflows_api`
- Mounting connectors into the orchestrator runner

A research run is **not executable** without a matching
`research_execution` **approved** approval (schema trigger
`orchestrator_research_runs_approval_bind`). This freeze does not run that
state machine.

## Enums (match schema CHECKs)

| Name | Values |
|---|---|
| platform | `meta` \| `google` \| `tiktok` |
| run state | `pending` \| `running` \| `completed` \| `failed` \| `cancelled` |
| failure_class | `rate_limit` \| `auth_failure` \| `transient` \| `invalid_response` \| `policy_rejection` \| `terminal` |
| discovery_source | `ad_library` \| `ads_transparency_center` \| `keyword_planner` \| `public_profile` \| `connector` |
| source_type | `ad_creative` \| `ad_copy` \| `landing_page` \| `auction_insight` \| `search_term` \| `public_page` \| `public_video` \| `labelled_metric` |
| creative_format | `image` \| `video` \| `carousel` \| `text` \| `html` \| `unknown` (optional) |
| metrics_kind | `provider_reported` \| `estimated` |
| provenance_method | `ad_library` \| `ads_transparency_center` \| `keyword_planner` \| `public_scrape` \| `connector` |
| connector_id | `meta_research` \| `google_research` \| `tiktok_research` |
| retention_class | `standard` \| `short` \| `legal_hold` |
| media_type | `image` \| `video` \| `html` \| `other` |

`connector_id` maps 1:1 onto platform: `meta_research`→`meta`,
`google_research`→`google`, `tiktok_research`→`tiktok`. Evidence that
disagrees is rejected.

## Size limits

| Field | Limit |
|---|---|
| id, workflow_id, research_run_id, competitor_id, evidence_id | 1–128 |
| idempotency_key | 1–256 |
| research_brief | ≤4000 |
| search_parameters JSON | ≤8192 bytes UTF-8 |
| continuation_state JSON | ≤4096 bytes UTF-8 |
| error_code | ≤128 |
| error_message / connector `message` | ≤512 |
| provider_advertiser_id / provider_external_id | 1–256 (null allowed for evidence external id) |
| normalized_name | 1–256 |
| advertiser_name | ≤256 |
| URLs (`canonical_url`, `canonical_source_url`) | HTTPS, ≤2048 |
| country | ≤8 |
| market | ≤64 |
| language | ≤16 |
| placement | ≤64 |
| headline | ≤500 |
| body_text | ≤4000 |
| excerpt | ≤2000 |
| evidence_hash / checksum_sha256 | 64 lowercase hex |
| dedup_key | 1–128 |
| provider_metrics JSON object | ≤8192 bytes; type object (not array) |
| connector_version | 1–64 |
| storage_ref | 1–1024 |
| cursor / next_cursor | ≤1024 |
| requested_platforms | 1–3 **unique** values from the platform enum |

Oversized text/JSON **fails closed**. Validators do not silently truncate
(secrets must not be clipped into storage).

### search_parameters allowed keys only

Unknown top-level keys are discarded. Nested forbidden keys are **rejected**.

| Key | Rule |
|---|---|
| `countries` | array ≤20 strings, each ≤8 |
| `languages` | array ≤10 strings, each ≤16 |
| `query` | ≤500 |
| `lookback_days` | integer 1–365 |
| `max_pages` | integer 1–50 |
| `max_results_per_page` | integer 1–100 |

## Required vs optional fields

### Research run (`assertResearchRun`)

**Required:** `id`, `tenant_id` (context), `workflow_id`, `approval_id`,
`approval_object_version`, `requested_platforms`, `idempotency_key`.

**Defaults if omitted:** `contract_version=v1`, `research_brief=''`,
`search_parameters={}`, `state=pending`, `continuation_state={}`.

**Optional:** `failure_class`, `error_code`, `error_message`, `created_at`,
`started_at`, `completed_at`, `failed_at`.

### Competitor (`assertCompetitor`)

**Required:** `id`, `tenant_id` (context), `research_run_id`, `platform`,
`provider_advertiser_id`, `normalized_name`, `discovery_source`, `captured_at`.

**Optional:** `canonical_url`, `country`, `market`, `created_at`.

**Computed if omitted:** `dedup_key`, `contract_version=v1`.

### Evidence item (`assertEvidenceItem`)

**Required:** `id`, `tenant_id` (context), `research_run_id`, `competitor_id`,
`platform`, `source_type`, `captured_at`, `provenance_method`, `connector_id`,
`connector_version`, `metrics_kind`.

**Provenance (every item):** `platform`; `canonical_source_url` **or**
`provider_external_id` (or both); `captured_at`; `research_run_id`;
`connector_id`; `connector_version`; `contract_version`; `evidence_hash`.

**Defaults if omitted:** `advertiser_name`/`headline`/`body_text`/`excerpt` empty
strings; `provider_metrics={}`; `contract_version=v1`; `retention_class=standard`;
`evidence_hash` computed; `dedup_key` = `evidence_hash`.

**Optional:** `creative_format`, `provider_started_on`, `provider_ended_on`,
`market`, `language`, `placement`, `expires_at`, `supersedes_id`, `created_at`.

### Evidence asset (`assertEvidenceAsset`) — metadata only

**Required:** `id`, `tenant_id` (context), `evidence_id`, `media_type`,
`storage_ref`, `checksum_sha256`, `captured_at`.

**Optional:** `width_px`, `height_px`, `duration_ms` (≥0 integers), `expires_at`,
`created_at`. Default `retention_class=standard`.

Assets never store bytes. `storage_ref` is a locator (for example
`research://…` or an object-store key), not a `data:` URI.

## Deduplication (tenant-scoped)

Identity is always `(tenant_id, …)`. The same provider external id **may**
exist for two tenants. Validators accept both objects independently.

| Entity | Unique key (schema) | Default `dedup_key` |
|---|---|---|
| run | `(tenant_id, idempotency_key)` | n/a |
| competitor | `(tenant_id, research_run_id, platform, dedup_key)` and `(tenant_id, research_run_id, platform, provider_advertiser_id)` | `sha256(platform + ':' + provider_advertiser_id)` as 64 hex (raw UTF-8, not JSON-canonicalized) |
| evidence | `(tenant_id, research_run_id, dedup_key)` | `evidence_hash` |
| asset | `(tenant_id, evidence_id, storage_ref)` | n/a |

### evidence_hash

SHA-256 hex over the frozen canonical subset (via `hash.canonicalize` +
`hash.sha256Hex`):

`platform`, `source_type`, `provider_external_id`, `canonical_source_url`,
`headline`, `body_text`, `excerpt`, `advertiser_name`, `creative_format`.

If the caller supplies `evidence_hash`, it must match. Missing optional
subset fields hash as `null`.

## Retention

`retention_class` is `standard` | `short` | `legal_hold`. `expires_at` is
optional. **No sweeper in PR3A.** Evidence and asset rows are immutable while
the parent run exists (schema triggers). Replacement is a new INSERT with
`supersedes_id`.

## PII / credential / raw-payload exclusions

`research_contracts.FORBIDDEN_KEYS` is **rejected** (not stored, not stripped)
at any nesting level. Keys are compared with case and separators removed, so
`access-token`, `Access Token` and `accessToken` are the same rejected key. The
list covers raw payloads (`raw_payload`, `payload`, `raw`, `raw_response`),
credentials (`access_token`, `refresh_token`, `authorization`, `bearer`,
`cookie(s)`, `set_cookie`, `token(s)`, `id_token`, `session*`, `api_key`,
`x_api_key`, `client_secret`, `secret(s)`, `password`/`passwd`/`pwd`/
`passphrase`, `credential(s)`, `private_key`, `signing_key`, `vault`),
private identities (`email(s)`, `phone`, `telephone`, `phone_number`,
`comment(s)`, `commenter`, `user_profile`, `private_profile`, `username`,
`user_name`, `user_id`, `first_name`, `last_name`, `full_name`, `address`,
`ip`, `ip_address`, `ssn`, `national_id`, `date_of_birth`, `dob`) and binaries
(`media_bytes`, `binary`, `buffer`, `image_base64`, `video_base64`,
`data_uri`).

Values are scanned as well as key names. Any stored string — evidence text,
`research_brief`, `error_code`, `error_message`, connector `message`, cursors,
URLs and every string inside `search_parameters` / `continuation_state` /
`provider_metrics` — is rejected when it matches a credential shape
(`research_errors.containsCredentialMaterial`: `Authorization`,
`access_token`/`refresh_token`, `Bearer`/`Basic` with a long value, a dotted
JWT, a PEM private-key header, `Cookie:`/`Set-Cookie`, `api_key=`,
`client_secret=`, `password=`, `sk-…`, `infogenie.sid`, userinfo in a URL).
Rejection is deliberate: masking or truncating would store part of a secret.

Also rejected: `Buffer`, `Uint8Array` / `ArrayBuffer`, `data:` URIs, and
oversized base64 blobs pretending to be media. Unknown **non-forbidden**
provider fields are discarded; required fields are kept.

Validated objects are detached from the caller's JSON (no shared references)
and deep-frozen, so a connector cannot add a key after validation and before
the PR3E INSERT.

## Metrics honesty

`metrics_kind` is required. Values in `provider_metrics` are
**provider-reported** or **estimated**. They are never independently verified
facts. Do not add `verified` / `independently_verified` flags. Fixtures are
mocked labelled examples, not live measurements.

## Connector error taxonomy (not HTTP)

| `failure_class` / `error` | `retry_class` |
|---|---|
| `rate_limit` | `retryable` |
| `auth_failure` | `terminal` (do not retry with the same credentials) |
| `transient` | `retryable` |
| `invalid_response` | `terminal` |
| `policy_rejection` | `terminal` |
| `terminal` | `terminal` |

Error pages never include a provider body. `message` is sanitized text ≤512
with no tokens or credential URLs.

`research_errors.js` is separate from HTTP `errors.js` (`OrchError` /
`fail`). Connector codes are not HTTP status mapping. Validators still throw
`fail('validation_failed')` for shape errors (`HTTP_FOR_CODE` already has
that code). `notImplemented(connector_id)` throws `terminal`.

## Pagination

- `cursor` on the request is an opaque string or `null` (≤1024).
- Success `page.next_cursor` is an opaque string; `page.has_more` is boolean.
- `next_cursor` is `null` when done (`has_more === false`).
- `has_more === true` requires a non-empty `next_cursor`.
- An empty page (`competitors`/`evidence`/`assets` = `[]`) with
  `has_more: false` is valid.

See `fixtures/research/connector-pagination.v1.json`.

## Connector interface

`assertConnectorRequest` / `assertConnectorPage` / `assertConnectorError` /
`assertConnectorResult` (ok true/false union). `assertConnectorIdentity`
checks `connector_id`, `connector_version`, `contract_version=v1`.

**Request:** `connector_id`, `connector_version`, `contract_version`,
`tenant_id` (context), `research_run_id`, `workflow_id`, `approval_id`,
`approval_object_version`, `requested_platforms`, `research_brief`,
`search_parameters`, `cursor`, `continuation_state`, `idempotency_key`.
`requested_platforms` must include the connector’s platform.

**Success page:**

```
{ ok: true, contract_version, connector_id, connector_version,
  competitors, evidence, assets,
  page: { next_cursor, has_more },
  continuation_state,
  rate_limit: { limit, remaining, reset_at } | null,
  retry_class: 'none' }
```

**Error page:**

```
{ ok: false, error, retry_class, retry_after_ms | null,
  rate_limit | null, continuation_state, message }
```

No implementations in this PR call the network. PR3B/C/D must implement
this interface only.

## Example normalized pages

Mocked public-library shapes after normalization (not live API traffic):

- Meta Ad Library — `services/agent_orchestrator/fixtures/research/meta.v1.json`
- Google Ads Transparency Center — `…/google.v1.json`
- TikTok public ad/creative — `…/tiktok.v1.json`
- Errors — `…/connector-errors.v1.json`
- Pagination — `…/connector-pagination.v1.json`

Public URL patterns only, for example
`https://www.facebook.com/ads/library/?id=…`,
`https://adstransparency.google.com/…`,
`https://library.tiktok.com/…`.

## Runtime helpers

```js
assertResearchRun(input, { tenantId })
assertCompetitor(input, { tenantId })
assertEvidenceItem(input, { tenantId })
assertEvidenceAsset(input, { tenantId })
computeEvidenceHash(sanitizedCanonicalObject)
computeCompetitorDedupKey({ platform, provider_advertiser_id })
sanitizeEvidenceText(s, max)
stripUnknown(obj, allowedKeys)
assertNoForbiddenFields(obj)
assertConnectorIdentity / assertConnectorRequest / assertConnectorResult
```

Normalized objects contain only allowed keys and are ready to INSERT in PR3E.
This PR performs no database writes.
