# InfoGenie — Capacity & Scale Targets

One-page capacity model for sizing Postgres pools, cron cadence, AI spend, and
horizontal-scale decisions. Update when traffic or product surface changes.

## Target profile (MVP → early production)

| Metric | Target | Notes |
|--------|--------|-------|
| Workspaces (tenants) | 50–200 | Logical isolation via `tenant_id` |
| Daily active users (DAU) | 100–500 | Owners + workspace members |
| Peak concurrent sessions | 50–100 | Cookie sessions in Postgres |
| Peak API RPS (all routes) | 30–80 | Sustained; bursts to ~150 for 1–2 min |
| Hot paths | Optimizer status, SERP, AEO/GEO audit, search-intel | Prefer cache + queue over sync fan-out |
| Read : write ratio | ~70 : 30 | Audits and AI runs are write-heavy spikes |
| Postgres storage (12 mo) | 20–80 GB | Audit runs, lead intel, creatives metadata |
| Upload / object storage | 50–200 GB | Avatars, creatives, voiceovers — prefer S3 |
| AI spend cap (platform) | Configurable via budget caps | Default: fail closed when `INFOGENIE_API_KEY` set |

## Per-request budgets

| Workload | Latency budget (p95) | Upstream |
|----------|----------------------|----------|
| Auth / session / CRUD | &lt; 200 ms | Postgres |
| Rank / keyword / SERP | &lt; 8 s | DataForSEO |
| Page audit (GEO/AEO) | &lt; 25 s | Firecrawl + HTML checks |
| LLM generation | &lt; 30 s | OpenAI / Anthropic / Z.ai |
| Optimizer ingest tick | &lt; 5 min wall | Ad platform APIs |

## Infrastructure sizing

| Resource | Single-VM (current) | Next scale step |
|----------|---------------------|-----------------|
| App processes | 1× Express + 1× Next | Separate worker process (`JOB_WORKER=1`) |
| Postgres pool | `max: 5` (web) + session conn | Web 10 + worker 5; add PgBouncer if &gt;2 instances |
| Redis | Optional (`REDIS_URL`) | Required for ≥2 app instances (rate limits + cache) |
| Job queue | Postgres `job_queue` | Same table; add Redis/Bull only if job volume &gt; 10k/day |
| Object storage | Local `uploads/` or S3 | S3/R2 when multi-instance or CDN |
| CDN | Browser cache headers | Cloudflare/CloudFront in front of static + uploads |

## Failure & cost controls

- **Circuit breakers** on OpenAI, DataForSEO, RapidAPI — open after repeated failures; short-circuit with clear errors.
- **Retries** with exponential backoff on transient HTTP (429/5xx/timeouts).
- **Rate limits** shared via Redis when configured; process-local otherwise.
- **AI budget caps** — daily per-provider ceilings when API-key auth is enabled.
- **Dead-letter jobs** — after `max_attempts`, rows move to `status=dead` for inspection.

## What breaks first at 10× load

1. In-process crons duplicating work if multiple web replicas start without advisory locks / job ledger.
2. Postgres pool exhaustion (`max: 5`) under parallel audits + optimizer.
3. Upstream rate limits (DataForSEO / RapidAPI / OpenAI) without shared circuit breakers.
4. Local `uploads/` invisible across instances.

Mitigations for those are implemented under `services/infra/` and `services/jobs/`.

## Env knobs

```
NODE_ENV=production
REDIS_URL=redis://...
S3_BUCKET=...
S3_REGION=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=...          # optional (R2 / MinIO)
S3_PUBLIC_BASE_URL=...   # CDN or public bucket URL
SENTRY_DSN=...
JOB_WORKER=1             # run scheduler/worker loops
PERMISSION_ENFORCEMENT=on
MULTITENANT_ENFORCEMENT=on
SECURITY_CSRF=on
```
