# InfoGenie — Security & Guardrails

Foundational guardrails for production. See also `docs/capacity.md`.

## Modules

| Module | Role | Rollout |
|--------|------|---------|
| `services/security/headers.js` | CSP (report-only by default), nosniff, HSTS (prod) | `SECURITY_CSP_ENFORCE=1` to enforce |
| `services/security/csrf.js` | Origin/Referer check on cookie mutations | prod default `on`; set `SECURITY_CSRF=shadow\|off` |
| `services/security/rate_limit.js` | Sliding-window limiter; Redis when `REDIS_URL` set | auth abuse + public POSTs |
| `services/security/prod_defaults.js` | Production-safe defaults for rollout flags | — |
| `services/tenants/permission_enforce.js` | RBAC matrix | prod default `PERMISSION_ENFORCEMENT=on` |
| `services/tenants/context.js` | Tenant resolution | prod default `MULTITENANT_ENFORCEMENT=on` |

## Recommended production env

```
NODE_ENV=production
SESSION_SECRET=<openssl rand -hex 32>
CREDENTIAL_ENCRYPTION_KEY=<openssl rand -base64 32>
INFOGENIE_API_KEY=<long random>
PERMISSION_ENFORCEMENT=on
MULTITENANT_ENFORCEMENT=on
SECURITY_CSRF=on
SECURITY_CSP_ENFORCE=1
REDIS_URL=redis://...
SENTRY_DSN=https://...
INFOGENIE_JOBS=1
```

In production, omitting the enforcement env vars still defaults them to `on`.
In development, defaults remain `shadow` / `off` / `shadow` so local work is unblocked.

## Observability

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Liveness |
| `GET /api/ready` | Readiness (Postgres required; Redis if configured) |

Structured JSON logs via `services/infra/logger.js` (`LOG_LEVEL=info|debug|warn|error`).
