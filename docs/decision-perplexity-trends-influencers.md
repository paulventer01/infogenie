# Decision Record: Perplexity for Trending Topics & Influencer Discovery

**Status:** Backlog — Perplexity kept as current approach; platform/vendor integrations deferred.

## Context

Trending Topics (`services/trends/api.js`) and Influencer Discovery (`services/discovery/api.js`) both use Perplexity's `sonar` model — a live web-search LLM — as their data source.

### Why Perplexity is used today

- Its `sonar` model has **live web search + citations**, so it can answer "what's hot in the last 7 days" and return source URLs.
- Plain OpenAI answers from a training cutoff and can't do "right now" or cite live sources.
- Zero third-party platform integrations required — works immediately with just a key.

### Known limitations

- **Not connected to Instagram, TikTok, Facebook or YouTube.** Searches and summarizes the public web (news, blogs, creator-database listings, public profiles).
- **Follower counts and engagement rates are LLM estimates** — can be stale, rounded, or hallucinated.
- **"Trending" = "what the web is talking about,"** not a platform's actual trending feed.
- No **audience demographics** or fake-follower / audience-quality signals.

## Migration options (when we act)

### Option A — Build open platform integrations ourselves

- **YouTube Data API** — open, just an API key. `chart=mostPopular` gives genuine trending videos + channel stats. Highest-value, lowest-friction win.
- **Instagram Graph "Business Discovery"** — real public metrics for business/creator accounts by handle. Requires Meta app review + permissions. No general trends feed.
- **TikTok Creative Center** — genuine trends data (hashtags/sounds/videos), some endpoints public. Research API (creator stats) needs approval and is often denied for commercial use.
- Tradeoff: no audience demographics / fake-follower detection; scraping gaps is ToS-violating and high-maintenance.

### Option B — Buy a paid influencer-data vendor API

| Vendor | Strength |
|---|---|
| **Modash** | Broad coverage (IG/TikTok/YouTube), developer-friendly, usage-based pricing — usually the sweet spot for SaaS. |
| **Phyllo** | Consented first-party data; creators connect their own accounts (Plaid-for-creators). Authoritative real metrics. |
| **HypeAuditor** | Fraud / fake-follower detection + audience quality scoring. |
| Upfluence, Heepsy, Klear/Meltwater, CreatorIQ | All-in-one or enterprise alternatives. |

### Option C — Build our own influencer database

Requires: official APIs + large-scale scraping, audience-sampling models, continuous refresh pipeline for tens-to-hundreds of millions of profiles, plus GDPR/ToS/legal exposure. Months of work + ongoing maintenance. Only worth it if data *is* the product.

## Recommended direction (when we act)

**Hybrid:** build the open pieces (YouTube → IG Business Discovery → TikTok Creative Center), buy one vendor (Modash or Phyllo) for deep discovery + audience quality, and **keep Perplexity as the universal fallback** for niches/platforms not yet integrated.

## Files affected when implementing

- `services/trends/api.js` — Trending Topics data source
- `services/discovery/api.js` — Influencer Discovery data source
- `services/admin/platform_keys.js` — add any new vendor API key to the admin-managed platform keys table
