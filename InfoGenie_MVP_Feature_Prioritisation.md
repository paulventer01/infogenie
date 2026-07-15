# InfoGenie — MVP Feature Prioritisation

**Version:** 1.0  
**Date:** July 2026  
**Based on:** Full feature audit of T1–T100+ across all 5 tabs (Analyse · Create · Reach · Grow · Manage)

---

## How to Read This Document

Every feature in InfoGenie has been assessed against three questions:

1. **Does a new user need this in their first 7 days to get value?**
2. **Does removing it make the product feel broken or incomplete?**
3. **Does it differentiate InfoGenie from a generic AI writing tool?**

Features are classified as:

| Label | Meaning |
|---|---|
| ✅ **Must-Have** | Ships on day 1. Core loop breaks without it. |
| 🔜 **Post-MVP** | Real value, but users can succeed without it. Ship in months 2–4. |
| 🧊 **Deferred** | Niche, high-effort, or blocked. Revisit post-PMF. |

---

## MVP Philosophy

InfoGenie is a broad platform. The risk is shipping 150 half-working features instead of 40 excellent ones. The MVP should be **thin and deep** — fewer features, each polished enough to trust.

The MVP core covers exactly one complete user job:

> *"I want to understand my market, launch a campaign, write the content, reach my prospects, and prove the results — without switching tools."*

Everything outside that loop is deferred.

---

## Full Feature Audit

### ANALYSE Tab

| # | Feature | Classification | Rationale |
|---|---|---|---|
| — | Dashboard (overview) | ✅ Must-Have | First screen every session |
| T1 | AI Visibility & Search Pulse | ✅ Must-Have | Core competitive intelligence; unique vs. Semrush |
| T2 | Battle Cards | ✅ Must-Have | Sales enablement; immediate tangible output |
| T3 | Share of Voice | ✅ Must-Have | KPI marketers care about most |
| T2 | Crisis Radar | 🔜 Post-MVP | Valuable, not day-1 critical |
| T2 | Trending Topics | ✅ Must-Have | Content strategy signal; fast value |
| — | Competitor Profiles | ✅ Must-Have | Anchor feature of the Analyse tab |
| — | Battle Plan | 🔜 Post-MVP | Extends Battle Cards; not standalone |
| T81 | AI Competitor War Room | 🔜 Post-MVP | Power user; requires data history |
| T86 | Business Acquisition Scanner | 🧊 Deferred | Niche ICP (M&A buyers only) |
| T89 | Benchmark Intelligence | 🔜 Post-MVP | Needs network data to be useful; chicken-and-egg at launch |
| T17 | Ad Library Spy (Meta + TikTok) | ✅ Must-Have | Competitors' active ads = instant value |
| — | Organic Social Monitor | 🔜 Post-MVP | Good-to-have; covered partially by Social Publisher |
| — | LinkedIn Ad Spy | 🔜 Post-MVP | LinkedIn API access requirements; ship after Meta/Google |
| T17 | Ad Swipe File | 🔜 Post-MVP | Dependent on Ad Library; additive |
| T10 | Tech Stack Detector | ✅ Must-Have | Quick competitive signal; BuiltWith integration ready |
| T8  | Pricing Watcher | ✅ Must-Have | High-intent competitive action; shows ongoing value |
| T18 | Job Board Spy (Hiring Spy) | 🔜 Post-MVP | Interesting signal; not urgent for most users |
| — | Maps Intel | 🧊 Deferred | Local business niche only |
| T73 | Change Monitor | 🔜 Post-MVP | Power user competitive intel; requires setup |
| T75 | AI Web Extractor | 🔜 Post-MVP | Technical feature; secondary use case |
| T76 | Scraping Recipe Library | 🧊 Deferred | Developer-oriented; low mass-market demand |
| T78 | Dataset Marketplace | 🧊 Deferred | Needs content to be valuable at launch |
| T80 | Resilient Tracker | 🧊 Deferred | Overlaps Change Monitor; dedup first |
| — | SpyFu integration | 🧊 Deferred | Third-party dependency; not differentiated |
| T13 | Keyword Explorer | ✅ Must-Have | Core SEO workflow; DataForSEO powered |
| T17 | Question Mining | ✅ Must-Have | Content brief fuel; fast value delivery |
| — | Social Listening | 🔜 Post-MVP | Broad capability; good for retention |
| — | Keyword-Page Map | ✅ Must-Have | Bridges keyword data to existing content |
| — | Content Gaps vs Rivals | ✅ Must-Have | Directly answers "what should I write" |
| T12 | SERP Rank Tracker | ✅ Must-Have | Retention driver; shows progress week-over-week |
| — | Search Intent Map | 🔜 Post-MVP | Sophisticated; users need basics first |
| — | Live Google SERP | 🔜 Post-MVP | Nice-to-have visualisation |
| — | Google Trends | 🔜 Post-MVP | Supplementary signal |
| — | Bing Webmaster | 🧊 Deferred | Bing is secondary for most users |
| T6  | Backlink Explorer | ✅ Must-Have | SEO staple; DataForSEO ready |
| — | Backlink Monitor | 🔜 Post-MVP | Retention feature post-baseline |
| — | Link Prospector | 🔜 Post-MVP | Outreach workflow; build after basics |
| — | Majestic / Semrush / Ahrefs / Serpstat / ContentKing | 🧊 Deferred | Third-party mirrors; differentiate with native tools |
| — | ICP Studio | ✅ Must-Have | Foundational; shapes all downstream AI outputs |
| T8  | Voice of Customer | ✅ Must-Have | Prospect language for copy; fast AI value |
| T18 | Review Aggregator | ✅ Must-Have | Competitive + own reputation; immediate insight |
| T19 | Glassdoor Sentiment | 🔜 Post-MVP | Niche competitive signal |
| — | Real-Time News | 🔜 Post-MVP | Monitoring feature; secondary |
| T17 | Reddit Live Pulse | 🔜 Post-MVP | Useful; not day-1 critical |
| T18 | X / Twitter Pulse | 🔜 Post-MVP | Overlaps with news + Reddit |
| T16 | YouTube Monitor | 🧊 Deferred | Niche unless video-first brand |
| T17 | Newsletter Tracker | 🔜 Post-MVP | Good competitive intel; not urgent |
| T19 | Quora Q&A Mining | 🔜 Post-MVP | Content source; covered by Question Mining |
| T99 | AI Answer Share-of-Voice | ✅ Must-Have | Genuinely novel; tracks brand in ChatGPT/Perplexity answers — emerging must-have |
| — | Reputation / Presence Score | 🔜 Post-MVP | Aggregate metric; meaningful post-history |
| — | AI Anomaly Detector | 🔜 Post-MVP | Requires historical baseline |
| — | Intent Radar | 🔜 Post-MVP | Advanced; needs data volume |
| — | UGC Discovery / Review Automation | 🧊 Deferred | Specific workflow; evaluate demand |

---

### CREATE Tab

| # | Feature | Classification | Rationale |
|---|---|---|---|
| — | Brand Foundation / Assets | ✅ Must-Have | Singleton that improves every other AI output |
| — | Content AI (blogs · long-form) | ✅ Must-Have | Core content generation |
| T17 | Headline Tester | ✅ Must-Have | Quick win; instant copy improvement |
| T10 | Cold Email Writer | ✅ Must-Have | Outreach copy; pairs with LinkedIn/lead tools |
| T16 | Email Personalizer (1-to-1) | ✅ Must-Have | Scales cold email; direct revenue impact |
| — | Email Broadcast + Tracking | ✅ Must-Have | Core send capability |
| — | Email Campaign Analytics | ✅ Must-Have | Needed alongside Email Broadcast |
| T18 | Video Script Generator | ✅ Must-Have | High-demand content type; AI differentiator |
| T21 | AI Voiceovers | 🔜 Post-MVP | Extends video scripts; nice-to-have |
| — | AI Creative (single ad) | ✅ Must-Have | Ad copy generation |
| — | Smart Creative Builder (multi-format) | ✅ Must-Have | Batch ad creative across Meta/Google/TikTok |
| T72 | Ad Creative from Landing Page | ✅ Must-Have | "Create once, publish everywhere" — strong differentiator |
| T9  | Landing Page Builder | ✅ Must-Have | Core conversion tool |
| — | AI Landing Pages (A/B + leads) | ✅ Must-Have | AI-generated LP with A/B and lead capture |
| T71 | Landing Page Lead Capture + Webhook | ✅ Must-Have | LP without leads is pointless |
| — | Link-in-Bio + Stripe | ✅ Must-Have | Common use case; high utility |
| T19 | Chatbot Builder | 🔜 Post-MVP | Good but secondary for MVP |
| T25 | SEO Schema Generator | 🔜 Post-MVP | Power user SEO feature |
| T5  | Press Release Writer | 🔜 Post-MVP | Useful; not MVP-critical |
| — | Content Calendar | ✅ Must-Have | Planning layer tying all content together |
| — | Content Modes | ✅ Must-Have | Enables blog autopilot; core for content marketers |
| T7  | A/B Test Designer | ✅ Must-Have | Paired with campaign launch |
| — | Campaign Strategy | ✅ Must-Have | Brief → strategy doc; unlocks everything downstream |
| — | Carousel Generator | 🔜 Post-MVP | Social-first format; additive |
| T17 | Headline Tester | ✅ Must-Have | Already counted above |
| — | AI Persona Studio | 🔜 Post-MVP | Refines targeting; secondary |
| — | Infographic Generator | 🔜 Post-MVP | Visual content; good post-MVP addition |
| T6  | Content Autopilot | 🔜 Post-MVP | Advanced; requires proven content workflow first |
| — | Canva / UGC Avatars / Product Video / Wireframe | 🧊 Deferred | Design-adjacent; out of scope for MVP |
| T5  | Reply Assistant | 🔜 Post-MVP | Inbound handling; secondary to outbound MVP |
| — | Localization (40+ langs) | 🔜 Post-MVP | International teams only at MVP |
| T16 | Audio Summary Generator | 🧊 Deferred | Niche content format |

---

### REACH Tab

| # | Feature | Classification | Rationale |
|---|---|---|---|
| — | Audience Builder | ✅ Must-Have | Entry point to all audience work |
| — | Dynamic Audiences (live segments) | ✅ Must-Have | Automation backbone; DashClicks parity |
| — | Journey Builder | ✅ Must-Have | Core automation feature |
| — | Visual Email Designer | ✅ Must-Have | Required alongside Email Broadcast |
| — | Omnichannel Composer | ✅ Must-Have | Email + SMS + WhatsApp in one place |
| — | Lead Generation (B2B finder) | ✅ Must-Have | Core top-of-funnel tool |
| — | Bookings (public scheduler) | ✅ Must-Have | Conversion action; high demand |
| T12 | HubSpot CRM Sync | ✅ Must-Have | Integration most users expect |
| — | Advertise Hub (Meta · Google · TikTok) | ✅ Must-Have | Campaign launch is a core MVP feature |
| — | Import Existing Campaigns | ✅ Must-Have | Onboarding ramp for users with existing ads |
| T27 | Conversion Boosters (popups) | ✅ Must-Have | Quick CRO win; embeddable widgets |
| — | Social Publisher (15 platforms) | ✅ Must-Have | Organic posting is table stakes |
| T22 | On-Page SEO Audit | ✅ Must-Have | Core SEO workflow |
| T23 | Embeddable Audit Widget | ✅ Must-Have | Agency lead-gen tool; strong differentiation |
| T24 | SEO Task Manager | ✅ Must-Have | Turns audit into action; retention driver |
| — | GEO Audit (ChatGPT · Perplexity) | ✅ Must-Have | Unique feature; AI search visibility |
| — | Web Vitals Auditor | ✅ Must-Have | Performance data users want |
| T9  | Email Deliverability Audit | ✅ Must-Have | Paired with Email Warm-Up |
| T15 | Email Warm-Up | ✅ Must-Have | Critical for cold outreach users |
| — | LinkedIn Outreach Automation | ✅ Must-Have | High-demand outreach channel |
| T26 | Unified Conversation Inbox | ✅ Must-Have | Ties all monitoring into one actionable stream |
| T5  | Alert Routing | ✅ Must-Have | Notifications are table stakes for monitoring |
| — | Content Scorer / Auto-Optimize | ✅ Must-Have | Improves existing content; quick win |
| — | AI Visibility & Search Pulse | ✅ Must-Have | (also in Analyse; dual placement) |
| — | Local SEO | 🔜 Post-MVP | Local business users only at MVP |
| — | Local Listings / NAP Sync | 🔜 Post-MVP | Same as above |
| — | Full-Site SEO Crawler | 🔜 Post-MVP | Power user; needs baseline audit first |
| — | SEO Roadmap | 🔜 Post-MVP | Guided flow; useful but not blocking |
| — | Lookalike Audiences | 🔜 Post-MVP | Needs audience data history |
| — | AI Segment Suggestions | 🔜 Post-MVP | Enhances audience builder |
| — | Audience → Ad Platform Sync | 🔜 Post-MVP | Advanced; ship after ad platform basics |
| — | Smart Send Time | 🔜 Post-MVP | Nice-to-have optimisation |
| — | AI Campaign Translator | 🔜 Post-MVP | International teams only |
| — | Influencer Discovery / CRM | 🔜 Post-MVP | Separate workflow |
| T20 | TikTok Asset Downloader | 🔜 Post-MVP | Tool for content repurposers |
| T97 | Identity Spine (CDP-lite) | 🔜 Post-MVP | Requires data volume; ship after audiences |
| — | MCP Server (AI tool integrations) | 🧊 Deferred | Developer feature |
| — | Inbox Placement Monitor | 🔜 Post-MVP | Enhances deliverability suite |
| — | RCS & Apple Messages | 🧊 Deferred | Emerging channel; very low current adoption |
| — | Geofencing | 🧊 Deferred | Location infra overhead; niche |
| — | Prompt-to-Campaign Builder | 🔜 Post-MVP | Interesting; overlaps with existing tools |
| — | In-App Survey Builder | 🔜 Post-MVP | Secondary engagement tool |

---

### GROW Tab

| # | Feature | Classification | Rationale |
|---|---|---|---|
| — | Goals & Targets | ✅ Must-Have | Anchors ROI conversation |
| — | KPI Tracker (live) | ✅ Must-Have | Essential performance layer |
| — | Action Center ("do this next") | ✅ Must-Have | Daily activation driver |
| T13 | Meta Ads Insights | ✅ Must-Have | Most users are on Meta |
| T14 | Google Ads Insights | ✅ Must-Have | Second most common platform |
| — | Organic Social Analytics | ✅ Must-Have | Content performance visibility |
| — | AI Campaign Optimizer (MAB) | ✅ Must-Have | Core AI automation; hours cron pauses/scales |
| T82 | AI Revenue Forecast Engine | ✅ Must-Have | 90-day what-if; accessible to non-analysts |
| — | Blended Performance (CAC) | ✅ Must-Have | True north metric for growth |
| — | True ROAS (margin-aware) | ✅ Must-Have | Ad platform ROAS is misleading without this |
| — | Funnel Analytics (EPC/EPPV/ACV) | ✅ Must-Have | Step-by-step conversion tracking with JS pixel |
| — | Churn-Risk Scorer | ✅ Must-Have | Retention signal for subscription/SaaS users |
| T90 | Media Mix Modeler | 🔜 Post-MVP | Budget optimisation tool; needs spend history |
| T83 | Digital Twin / Marketing Simulator | 🔜 Post-MVP | Power user; needs scenario experience |
| T14 | TikTok Ads Insights | 🔜 Post-MVP | Third priority ad platform |
| — | Post Performance | 🔜 Post-MVP | Detailed social; secondary |
| T88 | Autonomous Marketing Operator | 🔜 Post-MVP | Aggressive AI autonomy; trust must be earned |
| T92 | Safe Agent (propose → approve) | 🔜 Post-MVP | Governance layer; valuable post-trust |
| — | Self-Healing Ad Accounts | 🔜 Post-MVP | Advanced automation |
| — | GSC & GA4 Hub | 🧊 Deferred | Blocked by Google Workspace OAuth policy |
| — | Amplitude AI Agents | 🔜 Post-MVP | Requires Amplitude event history |
| — | Attribution Modelling | 🔜 Post-MVP | Data science feature; needs volume |
| — | iROAS Incrementality | 🧊 Deferred | Advanced measurement; SMB overkill |
| T74 | Conversion Recovery (CAPI) | 🔜 Post-MVP | Important but complex setup |
| T96 | Experiment Suite | 🔜 Post-MVP | Incrementality testing; post-baseline |
| — | AutoSEO Pro (autonomous) | ✅ Must-Have | Flagship SEO automation |
| — | Content Scorer | ✅ Must-Have | Per-URL AI improvement feedback |
| — | Bulk Content Rewriter | ✅ Must-Have | Batch AI rewrite; built and working |
| — | CRO Lab (A/B page tests) | ✅ Must-Have | Conversion optimisation; pairs with LP Builder |
| — | Internal Link Suggester | 🔜 Post-MVP | SEO enhancement; secondary |
| — | AI Audit Suite (deep) | 🔜 Post-MVP | Power user; basic audit first |
| — | Visibility Rank Table | 🔜 Post-MVP | Aggregate reporting; post-baseline |
| — | CTV & Streaming Audio | 🧊 Deferred | Emerging channel; limited SMB demand |

---

### MANAGE Tab

| # | Feature | Classification | Rationale |
|---|---|---|---|
| — | Today's Marketing Brief (AI Director) | ✅ Must-Have | First screen; daily habit-forming feature |
| — | Brand Calendar | ✅ Must-Have | Planning layer; 10 content categories |
| — | Budget Board | ✅ Must-Have | Spend tracking is basic expectation |
| — | UTM Builder | ✅ Must-Have | Campaign tracking hygiene |
| — | Web Analytics (acquisition + behaviour) | ✅ Must-Have | Basic traffic visibility |
| — | Daily Action Queue | ✅ Must-Have | Drives daily active use |
| — | Ask InfoGenie | ✅ Must-Have | AI assistant on your own data |
| — | AI Providers (bring your own LLM) | ✅ Must-Have | Needed for users with own API keys |
| T16 | Weekly Report | ✅ Must-Have | Auto-delivered Monday; strong retention driver |
| — | Daily Digest Email | ✅ Must-Have | Daily engagement loop |
| — | Results Snapshot | ✅ Must-Have | Quick-share performance view |
| — | Cross-Channel Report | ✅ Must-Have | Unified ad + organic performance |
| — | White-Label Reports | ✅ Must-Have | Agency differentiation; needed on day 1 for agencies |
| — | InstaReports (prospect audit) | ✅ Must-Have | Lead generation tool; built and working |
| — | Re-Engage Customers (drip) | ✅ Must-Have | Retention automation |
| T5  | Alert Routing | ✅ Must-Have | Notifications across Slack + email |
| — | Signal Triggers | ✅ Must-Have | Real-time event → automation bridge |
| — | 7-Day Marketing Playbook | ✅ Must-Have | Onboarding completion driver |
| T84 | Acquisition Engine (full pipeline) | 🔜 Post-MVP | Prospect→meeting pipeline; powerful but complex |
| T85 | Investor Mode (portal + forecasts) | 🔜 Post-MVP | Niche but impressive; ship by month 3 |
| T95 | Decision Engine | 🔜 Post-MVP | Requires multi-source data history |
| T100 | Revenue Intelligence (B2B intent) | 🔜 Post-MVP | B2B sales; secondary market |
| T98 | Approval Workflows | 🔜 Post-MVP | Governance; needed at team scale |
| T91 | Brand Safety & Compliance | 🔜 Post-MVP | Regulated industries; important but secondary |
| T79 | AI Model Comparison | 🔜 Post-MVP | Power user / technical users |
| T93 | Data Provenance | 🧊 Deferred | Transparency layer; not day-1 needed |
| T87 | AI Marketing Marketplace | 🧊 Deferred | Network-effect feature; needs users first |
| — | C-Suite Reports | 🔜 Post-MVP | Extends reporting suite |
| — | Budget Caps | 🔜 Post-MVP | Advanced spend controls |
| — | Pixel Manager | 🔜 Post-MVP | Technical tracking layer |
| — | Heatmaps + Session Replay | 🔜 Post-MVP | CRO enhancement |
| — | Customer 360 | 🔜 Post-MVP | Needs contact history |
| — | Master Calendar | 🔜 Post-MVP | Power user; basic calendar first |
| — | Marketing OKRs | 🔜 Post-MVP | Framework layer; additive |
| — | Marketing Memory (knowledge graph) | 🔜 Post-MVP | Long-term AI personalisation |
| — | Predictive Intelligence | 🔜 Post-MVP | Forecasting needs baseline data |
| — | AI Marketing Agent | 🔜 Post-MVP | Autonomous agent; trust first |
| — | Workspaces & Team | ✅ Must-Have | Multi-user is day-1 requirement |
| — | Admin Portal | ✅ Must-Have | Owner management essential |
| — | Settings & Integrations | ✅ Must-Have | Core configuration surface |
| — | Bulk Reporting (multi-client) | 🔜 Post-MVP | Agency feature; ship after white-label |
| — | AI Team (Finance / Ops Officers) | 🧊 Deferred | Interesting but complex; no clear MVP job |

---

## The 50 Must-Have Features — Summary

These are the 50 features that define the InfoGenie MVP. Everything else is additive.

### 🔍 Understand the Market (10)
| Feature | Why it must ship |
|---|---|
| Competitor Profiles | Anchor feature; users sign up for this |
| Battle Cards | Immediate actionable output |
| Ad Library Spy | Competitors' live ads = fastest intelligence |
| Tech Stack Detector | Quick signal about competitor investment |
| Pricing Watcher | Ongoing competitive signal; drives return visits |
| Keyword Explorer | Foundation of all SEO and content work |
| Question Mining | "What to write" answered instantly |
| Content Gaps vs Rivals | Direct content roadmap input |
| SERP Rank Tracker | Progress metric; retention flywheel |
| AI Answer Share-of-Voice | Unique to InfoGenie; tracks brand in ChatGPT/Perplexity |

### ✍️ Create Content & Campaigns (12)
| Feature | Why it must ship |
|---|---|
| Brand Foundation | Improves every AI output; set once |
| Content AI (blogs · long-form) | Core content generation |
| Cold Email Writer | Outbound copy on demand |
| Email Personalizer (1-to-1) | Scales cold email impact |
| Video Script Generator | High-demand format; AI advantage |
| Smart Creative Builder | Multi-format ad creative in one go |
| Landing Page Builder + AI LP | Campaign destination; paired with ad launch |
| LP Lead Capture + Webhook | LP without leads is useless |
| Ad Creative from Landing Page | "Create once publish everywhere" differentiator |
| Content Calendar | Planning backbone |
| Campaign Strategy | Brief → strategy → execution |
| A/B Test Designer | Built-in optimisation mindset |

### 📣 Launch & Reach (11)
| Feature | Why it must ship |
|---|---|
| Advertise Hub (Meta · Google · TikTok) | Campaign launch is the core value |
| AI Campaign Optimizer (MAB) | Auto-optimise; 6h pause/scale/reallocate |
| Social Publisher (15 platforms) | Organic reach is table stakes |
| Journey Builder | Marketing automation foundation |
| Dynamic Audiences | Live segments → automated targeting |
| Omnichannel Composer | Email + SMS + WhatsApp unified |
| Lead Generation | Top-of-funnel data |
| HubSpot CRM Sync | Expected integration |
| Conversion Boosters (exit intent + social proof) | Embeddable widgets; quick CRO wins |
| LinkedIn Outreach Automation | High-demand prospecting channel |
| Email Warm-Up | Prerequisite for cold email deliverability |

### 📈 Measure & Grow (9)
| Feature | Why it must ship |
|---|---|
| Meta Ads Insights | Primary ad platform dashboard |
| Google Ads Insights | Second most common |
| Funnel Analytics (JS pixel + EPC) | Step-by-step conversion tracking |
| True ROAS (margin-aware) | Real performance vs. platform ROAS |
| Blended Performance (CAC) | True north metric |
| Churn-Risk Scorer | Retention signal |
| AI Revenue Forecast Engine | 90-day what-if; accessible to non-analysts |
| Content Scorer | Per-URL feedback; SEO improvement loop |
| CRO Lab (A/B page tests) | Conversion optimisation |

### 🛠️ Manage & Report (8)
| Feature | Why it must ship |
|---|---|
| Today's Marketing Brief (AI Director) | Daily habit-forming entry point |
| Budget Board | Spend tracking expectation |
| Weekly Report (auto email) | Strongest retention driver |
| White-Label Reports | Day-1 agency requirement |
| InstaReports (prospect audit) | Lead generation tool for agencies |
| Ask InfoGenie | AI on your own data |
| Workspaces & Team | Multi-user is not optional |
| 7-Day Playbook | Onboarding completion |

---

## What "MVP-Ready" Means Per Feature

Not all Must-Have features need the same level of polish. This table defines the minimum acceptable bar for each.

| Feature | Minimum Acceptable Bar |
|---|---|
| Competitor Profiles | Returns structured profile in < 30s; no DUMMY keys in output |
| Ad Library Spy | Shows ≥ 5 live competitor ads from Meta; TikTok via Perplexity acceptable |
| Campaign Launch | Creates real campaign object in Meta or Google; lands as local_ if no creds |
| AI Optimizer | Runs hourly; pause/scale logic documented; dry-run shown clearly in UI |
| Landing Page Builder | Generates mobile-responsive HTML; leads captured; webhook fires |
| Journey Builder | Trigger → wait → action works end-to-end with email action |
| Weekly Report | Auto-sends Monday; graceful "no data" sections; PDF downloadable |
| InstaReports | Report generated < 30s; email sends via Resend; public link works |
| Funnel Analytics | JS pixel fires events; stats update same day; CSV export |
| SERP Rank Tracker | Daily scan for up to 20 keywords; delta shown vs previous run |
| Email Warm-Up | Schedule configurable; daily send log visible; blacklist check works |

---

## Post-MVP Roadmap — Recommended Build Order

Once the 50 Must-Have features are solid, this is the recommended sequence:

**Month 2:**
- Chatbot Builder (T19) — completes the lead capture story
- Backlink Monitor — activates the backlink dataset
- Content Autopilot — flagship SEO automation extension
- Local SEO + Local Listings — expands ICP to local businesses
- Budget Caps + Pixel Manager — campaign management depth

**Month 3:**
- Investor Mode (T85) — impressive demo feature; attracts funded startups
- C-Suite Reports — agency upsell
- AI Competitor War Room (T81) — power user retention
- Identity Spine / CDP-lite (T97) — first-party data moat
- Approval Workflows (T98) — team-scale governance

**Month 4:**
- Media Mix Modeler (T90) — high-value budget allocation
- Digital Twin / Marketing Simulator (T83) — strategic planning
- Benchmark Intelligence (T89) — network effects compound over time
- Brand Safety & Compliance (T91) — regulated industry expansion
- Decision Engine (T95) — AI synthesis across all data

**Post-PMF (Month 5+):**
- Safe Agent / Autonomous Operator — full AI autonomy
- RCS & Apple Messages — emerging channel
- Revenue Intelligence (T100) — B2B enterprise tier
- AI Marketing Marketplace (T87) — network effects / community
- CTV & Streaming Audio — next-gen ad channel

---

## Features to Explicitly Cut from MVP Marketing

These features exist in the codebase but should not be prominently marketed until they are polished:

| Feature | Reason |
|---|---|
| GSC & GA4 Hub | Blocked by Google Workspace OAuth org policy |
| Majestic / Semrush / Ahrefs integrations | Third-party mirrors; not differentiated; may look like copies |
| AI Team (Finance Officer / Ops Officer) | Too experimental for first impression |
| CTV & Streaming Audio | Niche audience; needs sales explanation |
| iROAS Incrementality | Requires statistical literacy to use correctly |
| Dataset Marketplace | Needs content to be useful; chicken-and-egg |
| Scraping Recipe Library | Developer-oriented; wrong audience at MVP |

---

## The One-Page MVP Story

If InfoGenie MVP does only this, it wins:

```
Day 1:   Run competitor analysis → see their ads, keywords, pricing, tech stack
Day 2:   Launch a campaign → Meta + Google from one brief, landing page auto-generated
Day 3:   Write content → blog posts, cold emails, video scripts aligned to your brand voice
Day 5:   Reach prospects → LinkedIn sequences, email warm-up, journey automation
Day 7:   Review results → ROAS, CAC, funnel conversion, weekly report auto-emailed
```

Every Must-Have feature on this list either enables one of these five days or makes it significantly better. Anything else ships later.

---

*Document owner: Product*  
*Review cadence: Monthly sprint planning*
