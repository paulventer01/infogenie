---
name: Platform API key connectivity tests
description: How the admin "Platform APIs" tab live-tests each platform key, and the per-vendor probe quirks
---

# Platform key live tests (`services/credentials/platform_keys.js` → `testKey`)

Each REGISTRY entry declares testability via three mutually-exclusive shapes:
- `test: '<id>'` — has its own live check → gets a **Test** button.
- `testedBy: '<id>'` — validated as part of a sibling's test (e.g. DataForSEO password is exercised by the login test) → no button, no marker.
- neither → genuinely untestable → UI shows an italic **"No test available"** (honest, not a silent pass).

`statusAll()` exposes `testable` / `covered` / `noTest` booleans the frontend card uses.

## Vendor probe quirks (learned the hard way — don't "simplify" these)
- **Apollo** `GET /api/v1/auth/health` returns **HTTP 200 even for a bad key**. Truth is in the body: `is_logged_in:true` = valid. Header `X-Api-Key`. A 200 alone is a false positive.
- **Cloudflare** `GET /user/tokens/verify` returns **400** (not 401) for a malformed/unknown token — treat 400/401/403 all as invalid.
- **BuiltWith** returns **HTTP 200 with an in-body `Errors[]`** for a bad key — must parse the body.
- **Google (PageSpeed, Custom Search)**: call the endpoint with **no `url`/`cx`/`q`** so the request fails validation *before* running any audit (cheap). A bad key yields a body matching `/api key not valid/i`; a valid key complains about the missing param (treat as accepted).
- **Perplexity / Firecrawl**: auth-probe with an empty `{}` body → bad key = 401/403, valid key = 400 (bad request) without spending tokens/credits.
- **Amplitude** `POST /2/httpapi` with `events:[]` → bad key body matches `/invalid api key/i`; valid key complains about missing events. No real events ingested.
- **Stripe** `GET /v1/balance`, **OpenAI/Anthropic** `/models`, **DataForSEO** `/appendix/user_data`, **Resend** `/domains`: clean 200/401.

**Why:** several vendors don't 401 on bad auth, so HTTP-status-only checks silently pass. All probes use `_fetchT` (12s abort timeout) so a hung vendor can't block the admin UI.

Genuinely untestable (no cheap endpoint): VAPID keys, webhook secrets (Resend/Stripe), Resend From Email, Cloudflare Account ID, Zernio.
