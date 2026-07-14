---
name: Legacy client/API contract drift
description: Some legacy SPA panels called Express endpoints with wrong paths/payloads; React ports must be validated against server routes, not the legacy client.
---

**Rule:** When porting a legacy panel to React, derive the API contract from the Express service (`services/<name>/api.js`), never from the legacy `public/js` client code — several legacy panels shipped with broken calls that silently failed in the UI.

**Why:** A logged-in smoke pass over the ported /reach/* and /analyse/* views found the legacy client (and the faithful React ports) used: `name` where surveys expects `title`+`settings`; `/api/email-designer/templates` where the router is mounted at `/api/email-designer` (so "templates" was parsed as an `:id`); `GET /api/mcp` which has no route (manifest info lives in `GET /api/mcp/tools`; `/call` returns MCP JSON-RPC `{content,isError}` not `{ok,result}`); and campaign-monitor sent `{from_address,volume}` where the server wants `{campaign_name, sends:[{delivered,bounced,opened,complained}]}`.

**How to apply:** Before or after porting a view, run an authenticated round-trip of its primary action against the API (login as a real user, POST the exact payload the component builds) — compile/lint/tests do not catch payload-shape drift. Note: a non-owner session hits the `owner_only` data gate on most feature APIs; smoke tests need an owner account (or temporary is_owner flip) to exercise data routes.
