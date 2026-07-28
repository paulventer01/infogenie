# Product scaffolding (before feature build-out)

InfoGenie already has a large feature surface. New work should land on this scaffold first:

## Layers

1. **Security guardrails** — `services/security/` + `docs/security-guardrails.md`
2. **Auth & tenancy** — `services/auth/`, `services/tenants/` (permissions + tenant context)
3. **Design system** — `styles/globals.css` tokens; auth atmosphere in `styles/auth.module.css`
4. **App shell** — Next App Router layouts under `app/(auth)` and `app/(dashboard)`
5. **Feature panels** — `components/features/*` registered via `lib/migratedViews.ts` / `components/features/registry.tsx`

## UI direction

- Light-first (navy / electric blue / teal)
- Display type: **Sora**; brand: **Space Grotesk**; UI: **Plus Jakarta Sans**
- Auth is brand-first (hero + form), not a floating marketing card collage
- Prefer tokens over one-off hex in new React panels

## New feature checklist

1. Add Express route under `services/<feature>/{schema,api}.js`
2. Validate inputs with `services/security/validate.js`
3. Scope by `req.tenant` / `resolveTenantId`
4. Map permissions in `permission_matrix.js`
5. Port UI as a React panel under `components/features/<tab>/`
6. Register the view; do not reintroduce legacy `#view-*` builders
