# Ops tooling stack (Technical Manager)

Ship order:

1. **Checkly** (or Better Stack) — external synthetics for `/api/health`, `/api/ready`, login, dashboard, AI Team, reports
2. **OpenTelemetry + OpenLLMetry → SigNoz** — API / Postgres / LLM traces
3. **Nango** — Meta / Google / HubSpot / Shopify OAuth refresh + reconnect
4. **GitGuardian** — secret leak CI + TM local scan
5. **Promptfoo** — prompt/model promotion gate
6. **Traceloop / LLM FinOps** — per-tenant cost/latency/error alerts

Deferred: Infisical, incident.io / PagerDuty, Uptrace.

## Environment

| Variable | Purpose |
|----------|---------|
| `CHECKLY_API_KEY` / `CHECKLY_ACCOUNT_ID` | Pull Checkly check inventory |
| `CHECKLY_BASE_URL` or `PUBLIC_BASE_URL` | External check target origin |
| `BETTERSTACK_API_KEY` | Alternative uptime provider |
| `OTEL_EXPORTER_OTLP_ENDPOINT` or `SIGNOZ_OTLP_ENDPOINT` | OTLP/HTTP traces endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` / `SIGNOZ_INGESTION_KEY` | Auth header for SigNoz |
| `OTEL_SERVICE_NAME` | Defaults to `infogenie` |
| `OTEL_NODE_ENABLED=1` | Enable full `@opentelemetry/sdk-node` when installed |
| `TRACELOOP_API_KEY` / `TRACELOOP_BASE_URL` | OpenLLMetry / FinOps SaaS |
| `NANGO_SECRET_KEY` / `NANGO_HOST` | OAuth connector platform |
| `GITGUARDIAN_API_KEY` | CI + API health |
| `PROMPTFOO_ENFORCE=1` | Block promotions when eval gate fails |
| `PROMPTFOO_PASS_THRESHOLD` | Default `0.85` |
| `LLM_COST_WARN_USD` / `LLM_COST_CRITICAL_USD` | FinOps thresholds |

## APIs

- `GET /api/ops-tooling/status` — full stack for Technical Manager
- `GET /api/ops-tooling/synthetics` · `POST /api/ops-tooling/synthetics/run`
- `GET /api/ops-tooling/nango/status` · `POST /api/ops-tooling/nango/connect-session`
- `GET /api/ops-tooling/gitguardian`
- `GET /api/ops-tooling/promptfoo` · `POST /api/ops-tooling/promptfoo/assert-gate`
- `GET /api/ops-tooling/finops`
- `GET /api/ops-tooling/otel`

## Scripts

```bash
npm run eval:prompts      # Promptfoo gate artifact → promptfoo/results.json
npm run scan:secrets      # Local GitGuardian-style heuristic scan
node checkly/infogenie.checks.js
```

Technical Manager desk shows the **Ops tooling stack** card on each 30s scan.
