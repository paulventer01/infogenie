---
name: Google Workspace OAuth integration
description: How Gmail+Drive+Calendar are connected as one OAuth flow in InfoGenie
---

**Rule:** All three Google Workspace apps share a single OAuth consent screen and a single vault entry (`google_workspace`). Do not create separate OAuth flows per app.

**Scopes:** `gmail.readonly gmail.send drive.file calendar.events openid email`

**Env vars (operator-level):** `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET`

**Vault key:** `google_workspace` → stores `{ clientId, clientSecret, refreshToken, email }`

**Return params after OAuth:** `?gw_connected=1&settings=integrations` or `?gw_error=<code>&settings=integrations`

**Route prefix:** `/api/integrations/workspace/`

**Service file:** `services/google_workspace/api.js`

**Why:** Matches the pattern from `services/google_ads_oauth/api.js` exactly. Per-user vault, not tenant-scoped (same as Google Ads OAuth). The `_getAccessToken(userId)` helper refreshes on every call — no in-memory caching needed since tokens are short-lived.

**How to apply:** If extending to add more Google APIs (e.g. Sheets), add the new scope to SCOPES array in `services/google_workspace/api.js`, add the new endpoints, and update the Settings card description. The existing OAuth flow will automatically request the new scope on next connect (user must reconnect since `prompt: 'consent'` forces re-consent).

**UI integration points:**
- Settings card: INTEGRATIONS.productivity in app.js → `hydrateGoogleWorkspaceCard()` at ~line 40243
- Brand Calendar: `_bcSyncToGCal()` in public/js/ig_manage_pack.js
- Unified Inbox: `loadGmail()` + `_gmailReplyModal()` in public/js/ig_seo.js
- Creator Studio: `_gwSaveToDrive()` in public/js/ig_studio.js
