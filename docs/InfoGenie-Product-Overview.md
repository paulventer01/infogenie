# InfoGenie — Product Overview, Architecture & Market Strategy

**Document type:** Product & strategy reference  
**Version:** August 2026  
**Audience:** Founders, investors, product leaders, agency operators, enterprise marketing teams  
**Classification:** External-facing product narrative grounded in the implemented platform (T1–T119+)

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [What InfoGenie is — and is not](#2-what-infogenie-is--and-is-not)
3. [Architecture: how it is built and why](#3-architecture-how-it-is-built-and-why)
4. [How InfoGenie works: logic, flows, and operating model](#4-how-infogenie-works-logic-flows-and-operating-model)
5. [Feature catalog by workflow](#5-feature-catalog-by-workflow)
6. [Pain points InfoGenie resolves](#6-pain-points-infogenie-resolves)
7. [Unique selling proposition (USP)](#7-unique-selling-proposition-usp)
8. [Competitive landscape](#8-competitive-landscape)
9. [Critical safeguards for AI marketing intelligence](#9-critical-safeguards-for-ai-marketing-intelligence)
10. [Future evolution](#10-future-evolution)
11. [Market size and opportunity](#11-market-size-and-opportunity)
12. [Appendix: integrations & technical reference](#12-appendix-integrations--technical-reference)

---

## 1. Executive summary

**InfoGenie** is an **AI-powered marketing intelligence and automation platform** that consolidates competitive analysis, content creation, audience building, paid and organic channel execution, measurement, and executive decision support into a **single same-origin application**.

Unlike point tools that solve one slice of marketing (SEO-only, ads-only, or content-only), InfoGenie is designed as a **closed-loop marketing operating system**:

> **Insight → Action → Measurement → Learning → Better insight**

The platform ships **290+ routable tools** across six navigation domains — **Analyse, Create, Reach, Grow, Manage, and AI Team** — backed by **250+ Express API services**, PostgreSQL tenancy, multi-model AI routing, and strict data-honesty enforcement.

**Tagline (product):** *AI Autonomous Marketing Intelligence Platform*

**Core promise:** Help marketing teams and agencies **see the market clearly, decide faster, execute across channels, and prove ROI** — without stitching together ten disconnected SaaS products.

---

## 2. What InfoGenie is — and is not

### What it is

| Dimension | Description |
|-----------|-------------|
| **Intelligence layer** | Competitor, SERP, AI-search (GEO/AEO), brand, and market signal analysis |
| **Creation layer** | AI-assisted content, creative, landing pages, email, video scripts, personas |
| **Reach layer** | Audiences, journeys, paid ads, social publishing, lead gen, local SEO |
| **Growth layer** | Goals, attribution, True ROAS, optimizers, conversion labs |
| **Operations layer** | Calendars, briefs, reports, governance, team capacity, workspaces |
| **AI executive team** | Finance Officer, Ops Officer, Technical Manager — role-based AI advisors |

### What it is not

- **Not a full CRM** — syncs to HubSpot and similar; does not replace sales pipeline management
- **Not a payment processor** — Stripe handles billing where needed
- **Not a social network** — publishes *to* platforms via integrations (e.g. Zernio), does not host social feeds
- **Not a session recorder** — integrates with Clarity-style tools for heatmaps where configured
- **Not a “black box” AI** — strict data mode withholds synthetic metrics; demo mode badges them explicitly

---

## 3. Architecture: how it is built and why

### 3.1 Design philosophy

InfoGenie’s architecture follows five deliberate principles:

1. **Insight → Action → Measurement** — Every intelligence module connects to an action module and a measurement partner. Intelligence that cannot drive execution is considered incomplete.
2. **Same-origin simplicity** — Browser, Next.js shell, Express APIs, and session cookies share one domain. No CORS fragmentation, no split auth across subdomains.
3. **Honest data by default** — Platform default data mode is **`strict`**. Fabricated, template, or placeholder payloads are withheld or explicitly labeled — never presented as live account truth.
4. **Autonomous where safe, gated where destructive** — Optimizers, content schedulers, and suggest engines run continuously; budget launches, irreversible sends, and high-risk mutations go through **Safe Agent** (propose → simulate → approve → execute).
5. **Incremental migration, zero big-bang rewrite** — Legacy vanilla JS SPA coexists with Next.js React panels until each view is ported. Navigation and API contracts remain stable throughout.

### 3.2 Technology stack

| Layer | Technology | Role |
|-------|------------|------|
| **Public front door** | Next.js 15 (App Router), React 18, TypeScript | Auth pages, dashboard shell, 290+ lazy-loaded feature panels |
| **API & jobs** | Node.js 20+, Express 4 | 250+ `/api/*` routers, background crons, legacy SPA fallback |
| **Database** | PostgreSQL | Tenant-scoped tables, `kv_store`, sessions, encrypted credentials |
| **Cache / queues** | Redis (`ioredis`) | Job scheduling, rate limiting where configured |
| **AI** | OpenAI, Anthropic, Gemini, Perplexity, Cloudflare Workers AI, BYO LLM | Multi-model with compatibility layer (`ai_compat.js`) |
| **Exports** | pptxgenjs, pdfkit, exceljs | Board decks, weekly reports, investor mode |
| **Observability** | Sentry, OpenTelemetry (optional) | Error tracking, ops tooling for Technical Manager |

### 3.3 Process architecture (dev & production)

```
Browser
   │
   ▼
Next.js :5000  ── public front door
   │  • /login, /reset-password, React dashboard routes
   │  • Rewrites /api/* → Express :8000
   │
   ▼
Express :8000  ── API + legacy SPA + static assets
   │  • Auth gate → permission matrix → route handlers
   │  • Data-mode enforcement on every res.json()
   │  • Background jobs: optimizer, journeys, digest, autopilot, etc.
   │
   ▼
PostgreSQL + Redis
```

**Why two processes?** Express owns the mature API surface (~119 tier modules, years of domain logic). Next.js owns modern auth UX and React migration without blocking API evolution. The proxy keeps **one cookie, one origin** for users.

### 3.4 Multi-tenancy & security

- Every feature table includes **`tenant_id`**; routes resolve tenant via `services/tenants/context.js`.
- **RBAC:** `permission_matrix.js` maps each API prefix to view/write permissions; production default enforcement is **`on`**.
- **Credential vault:** Per-user OAuth tokens (Google Ads, Meta Ads, Workspace) encrypted AES-256-GCM.
- **Platform keys:** Admin-managed API keys hydrated at boot; audited, never exposed to non-admins.
- **CSRF, CSP, rate limits:** Documented in `docs/security-guardrails.md`.

### 3.5 AI architecture

Standard pattern for AI-powered features:

```
1. Inject brand context (Brand Foundation, analysis data, memory)
2. Call primary model (often GPT-4o-mini for speed/cost)
3. Parse strict JSON; reject dummy keys
4. Fallback: template (demo mode) OR error (strict mode)
5. Persist tenant-scoped result
6. Return to UI with provenance metadata
```

**BYO LLM:** Tenants can configure OpenAI-compatible endpoints by category (`writing`, `analysis`, `vision`, `audio`) with cascade pools.

**AI Governance (default: shadow):** Every AI call can be logged through Policy → Data quality → Context retrieval → Model → Output scan → Audit — **without blocking** the core Brief → Spine → calendar loop unless a tenant opts into enforce mode.

### 3.6 Navigation as product architecture

Navigation is the **single source of truth** (`lib/viewRoutes.ts`):

| Group | Purpose |
|-------|---------|
| **Analyse** | Market intelligence, competitors, SEO/SERP, backlinks, brand monitoring |
| **Create** | Brand assets, content studio, lifecycle email, creative, pages/bots, campaign planning |
| **Reach** | Audiences, lead gen, paid search/social, social command center, SEO execution, identity spine |
| **Grow** | Goals, ad performance, full-funnel ROI, conversion/SEO improvement |
| **Manage** | Morning brief, calendars, monitoring, AI config, team frameworks, reports, admin |
| **AI Team** | Executive officers + team ops (capacity, governance, providers) |

**Hub consolidations** (Search & AI Visibility, Content Studio, Goals Hub, etc.) reduce sidebar clutter while preserving deep links to specialist tools.

---

## 4. How InfoGenie works: logic, flows, and operating model

### 4.1 Canonical user journey

Documented workflow (`docs/AUDIT_INFOGENIE_WORKFLOW.md`):

```
Brief → Analyse → Create → Reach → Grow → Manage → AI Team → (loop)
```

### 4.2 Day-zero: analysis & workspace

1. **Enter URL or industry** on the home/analysis view.
2. **`runAnalysis()`** detects competitors, enriches with DataForSEO/market signals, builds dashboard context.
3. **Landing:** Today's **Marketing Brief** (`marketing-brief`) — AI Director diagnosis of priorities, risks, and opportunities.
4. **Workspace:** **New Marketing Project** + **Workspaces & Team** scope data to client/brand/tenant.

**Why this order?** Analysis without a brief is raw data. The brief translates intelligence into **today’s decisions** before the user dives into 290 tools.

### 4.3 Plan → create → reach

| Stage | Primary tools | Logic |
|-------|---------------|-------|
| **Plan** | Campaign Strategy, Content Modes, Persona Studio, Master Calendar | Define who, what, where, when before production |
| **Create** | Content Studio, Creative Hub, Landing Builder, Email tools | Generate assets grounded in brand foundation + analysis |
| **Reach** | Audience Builder, Journey Builder, Campaign Composer, Social Publisher | Deploy to humans across paid, owned, earned channels |

### 4.4 Measure → optimize → learn

| Stage | Primary tools | Logic |
|-------|---------------|-------|
| **Measure** | Analytics Hub, True ROAS, Attribution, Canonical Metrics | Connect spend to outcomes with honest provenance labels |
| **Optimize** | AI Optimizer, SEO Autopilot, Conversion Lab, Ecosystem Spine | Close gaps automatically or via suggest → apply |
| **Learn** | Marketing Memory, Decision Engine, Strategic Intelligence | Act/dismiss outcomes feed the next recommendation cycle |

### 4.5 The marketing spine (operating system layer)

**Ecosystem Spine** (`/grow/ecosystem-spine`) aggregates:

- Audiences, pixels/CAPI, attribution runs, leads, brief, optimizer state
- Emits a **health score + gap list**
- **Suggest → Resolve → Apply** creates calendar items, SEO tasks, content drafts, or deep-links to execution tools

**Agent Orchestrator** generalizes this pattern across modules (calendar, decision engine, remarketing, etc.).

### 4.6 AI Team model

InfoGenie treats AI as a **virtual executive team**, not a chatbox:

| Role | Function |
|------|----------|
| **Marketing Brief (AI Director)** | Daily diagnosis, foresight, prioritized actions |
| **Finance Officer** | Budget, ROAS, margin-aware recommendations |
| **Ops Officer** | Execution health, integrations, operational gaps |
| **Technical Manager** | Platform scan — pages, APIs, LLMs, auth, security posture |
| **Safe Agent** | Human approval gate for destructive/high-risk automations |

---

## 5. Feature catalog by workflow

InfoGenie exposes **217 sidebar items** and **293 routable view IDs**. Below is the capability map by navigation group, with **what it means** and **why it matters**.

### 5.1 Analyse — intelligence on the market

| Feature area | Key capabilities | User meaning |
|--------------|------------------|--------------|
| **Project overview** | Dashboard, 90-day roadmap | “Where am I vs. the market?” |
| **Rankings & search** | SERP tracker, keyword explorer, content gaps, live SERP | Track visibility and opportunity keywords |
| **Analytics & traffic** | Analytics hub, share of voice, visitor intel | Understand traffic quality and brand presence |
| **Competitors** | Competitor profiles, battle cards, battle plan, war room, ad library spy, benchmarks | Structured competitive positioning for sales and strategy |
| **AI search & mentions** | GEO/AEO/zero-click/voice SEO hub, mentions, crisis radar, media intel | Visibility in Google *and* AI answers (ChatGPT, Perplexity) |
| **Backlinks & site health** | Backlinks, monitors, Semrush/Ahrefs integrations, change monitor | Off-page SEO and technical authority |
| **Customers & brand** | ICP studio, VOC mining, review aggregator, reputation score, tech stack, pricing watcher | Voice-of-customer and competitor operational signals |

**Hidden intelligence archive:** 40+ specialist tools (spyfu, majestic, youtube monitor, anomaly detector, etc.) available via Intelligence Hub deep links.

### 5.2 Create — production & campaign design

| Feature area | Key capabilities | User meaning |
|--------------|------------------|--------------|
| **Brand foundations** | Brand assets, templates, creator studio | Single source of brand truth for all AI generation |
| **Content studio** | Content AI, autopilot, bulk rewriter, headline tester, press release, cold email | High-volume content production with brand voice |
| **Lifecycle email** | Newsletter studio, broadcasts, WhatsApp, voice caller, reply assistant, localization | Owned-channel lifecycle programs |
| **Design the visuals** | Carousel, Canva bridge, UGC avatars, video script, short-form video, podcast, infographics | Creative assets without a full agency |
| **Build pages & bots** | Landing builder, chatbot builder, schema generator, link-in-bio | Conversion surfaces and conversational capture |
| **Plan the campaign** | Campaign strategy, content modes, persona studio, A/B designer, pitch deck, wireframe | Strategic planning before spend |

### 5.3 Reach — audiences, leads, and distribution

| Feature area | Key capabilities | User meaning |
|--------------|------------------|--------------|
| **Build the audience** | Segments, lookalikes, journeys, surveys, geofencing, omnichannel, smart send | Who you talk to and how messages flow |
| **Find & qualify leads** | Lead gen hub, bookings, qualifier, Hunter, HubSpot/CRM sync | Pipeline feeding without manual export/import |
| **Paid search & social** | Google/Meta/TikTok campaign tools, import, conversion boosters | Launch and manage paid from one workspace |
| **Social command center** | Publisher, calendar, influencers, hashtag intel, social commerce | Organic + influencer operations |
| **Get found in search & AI** | GSC data, local SEO/listings, content brief studio, web vitals, SEO tasks | Operational SEO tied to content production |
| **First-party data spine** | Identity spine (CDP-lite), MCP server | Unified profiles, LTV scoring, next-best-action |
| **Handle replies & alerts** | Unified inbox, alert routing, inbox monitor | Brand conversation workflow |
| **Next-gen messaging** | Push, RCS, LinkedIn outreach, email warmup | Emerging high-intent channels |

### 5.4 Grow — targets, performance, ROI

| Feature area | Key capabilities | User meaning |
|--------------|------------------|--------------|
| **Set the targets** | Goals hub, growth hub, ecosystem spine, action center | OKRs/KPIs aligned to channel reality |
| **See ad performance** | Meta/Google/TikTok insights, AI optimizer, lead intelligence, remarketing, safe agent | Always-on optimization with guardrails |
| **Track full-funnel ROI** | Attribution, True ROAS, iROAS, MMM, digital twin, churn scorer, revenue forecast | Finance-grade marketing accountability |
| **Improve SEO & conversion** | Conversion lab, CRO lab, AI audit suite, link suggester, visibility leaderboard | Experimentation → measurable lift |
| **Next-gen ad channels** | CTV/streaming scaffold | Future channel expansion |

### 5.5 Manage — operations, reports, governance

| Feature area | Key capabilities | User meaning |
|--------------|------------------|--------------|
| **Morning brief** | Today's Marketing Brief | Daily executive summary |
| **Calendars & projects** | Master calendar, agent orchestrator, new project | Work coordination across teams |
| **Monitor performance** | Web analytics, heatmaps, action queue, budget board, UTM/pixel manager, execution hub, customer 360 | Operational visibility |
| **AI tools & config** | Ask InfoGenie, strategic intelligence, marketing memory, predictive intel, AutoClaw, model compare | Platform brain and configuration |
| **Team & frameworks** | 7-day playbook, growth methodology, performance flywheel | Repeatable operating playbooks |
| **Customer ops** | Re-engage, automations, brand deals, product library, signal triggers | Retention and expansion motions |
| **Reports** | Weekly report, C-suite deck, investor mode, white-label, digest | Stakeholder-ready outputs |
| **Account & admin** | Workspaces, settings/integrations, brand safety, data provenance, technical suite | Tenant administration |

### 5.6 AI Team — executive layer

| Role / tool | Purpose |
|-------------|---------|
| **Team roster** | Persona of each AI officer |
| **Finance Officer** | Budget and margin-aware guidance |
| **Ops Officer** | Integration and execution health |
| **Technical Manager** | Live platform + ops stack audit |
| **Capacity** | Team workload and AI agent allocation |
| **AI Governance** | Policy, audit, brand safety control plane |
| **AI Providers** | BYO LLM configuration |

---

## 6. Pain points InfoGenie resolves

| Pain point | How InfoGenie addresses it | Primary features |
|------------|---------------------------|------------------|
| **“I use 12 tools and nothing talks to each other”** | Same-origin spine, shared brand context, orchestrated suggest→apply | Ecosystem Spine, Agent Orchestrator, Brand Foundation |
| **“I don’t know what competitors are doing until it’s too late”** | Scheduled monitors, war room, battle cards, pricing/change trackers | Compete suite, Crisis Radar, Change Monitor |
| **“SEO and AI search are different problems now”** | Unified Search & AI Visibility hub (GEO, AEO, zero-click, voice) | AEO Optimizer, GEO Audit, AI Answer SOV |
| **“My agency can’t prove ROI”** | True ROAS, attribution, canonical metrics, investor/C-suite reports | Grow measurement stack |
| **“AI content is generic and off-brand”** | Brand Foundation injection, persona studio, field enhancer, memory loop | Create stack, Marketing Memory |
| **“Recommendations don’t learn from what we did”** | Act/dismiss → Marketing Memory → next Decision Engine run | Brief, Action Queue, Strategic Intelligence |
| **“I can’t trust the numbers in the dashboard”** | Strict data mode, provenance labels, withheld synthetic data | Data mode enforcement, Data Provenance panel |
| **“Automation is scary — one wrong click wastes budget”** | Safe Agent approval, AI governance shadow mode, suggest tiers | Safe Agent, Governance Hub |
| **“Briefings are backward-looking slides, not actions”** | Marketing Brief → deep links → calendar/SEO/content tasks | Brief, Ecosystem Spine |
| **“First-party data is scattered”** | Identity Spine CDP-lite, pixel manager, audience sync | Reach spine tools |

---

## 7. Unique selling proposition (USP)

### Primary USP

**InfoGenie is the only platform that closes the full loop from competitive + AI-search intelligence → cross-channel creation → autonomous optimization → honest ROI measurement — with an AI executive team and strict data integrity built in.**

### USP pillars (defensible differentiation)

| Pillar | What competitors typically do | What InfoGenie does |
|--------|--------------------------------|---------------------|
| **Closed-loop OS** | Point tools or suites with weak action wiring | Ecosystem Spine + Orchestrator + Brief chain insight to calendar/SEO/tasks |
| **AI search era** | Traditional SEO rank tracking only | GEO/AEO/zero-click/voice + AI Answer SOV in one hub |
| **Data honesty** | Demo data or unlabeled estimates in UI | **Strict mode default** — synthetic data withheld or badged |
| **Learning system** | Static recommendations | Marketing Memory fed by act/dismiss outcomes |
| **Executive AI team** | Single chat assistant | Role-based officers + Technical Manager ops scan |
| **Safe autonomy** | Full auto or manual only | Optimizer/autopilot + Safe Agent approval for risky actions |
| **Agency-native** | Single-brand assumptions | Multi-tenant workspaces, white-label reports, client switching |
| **BYO LLM** | Vendor lock-in to one model | Category-based provider cascade per tenant |

### Elevator pitch (30 seconds)

> InfoGenie replaces the fragmented marketing stack with one AI-native operating system: it analyses your market and competitors, tells you what to do today in plain language, helps you create and launch across every channel, optimizes spend safely, and proves ROI — while refusing to show fake metrics.

---

## 8. Competitive landscape

### 8.1 Competitive map by category

| Category | Direct / adjacent competitors | InfoGenie overlap | InfoGenie gap vs. incumbent |
|----------|------------------------------|-------------------|----------------------------|
| **SEO suites** | Semrush, Ahrefs, Moz, Surfer | Strong SERP, audit, content brief, backlinks | Incumbents deeper in historical link indexes; InfoGenie stronger on AI-search + action loop |
| **Marketing hubs** | HubSpot, Salesforce Marketing Cloud, Adobe Marketo | CRM sync, email, journeys, reports | HubSpot wins native CRM; InfoGenie wins intelligence + autonomous optimization breadth |
| **AI content** | Jasper, Copy.ai, Writer | Content studio, email, creative | Jasper wins pure writing UX; InfoGenie wins market context + distribution + measurement |
| **Ad optimization** | Smartly.io, Albert.ai, Adzooma, Optmyzr | AI Optimizer, bandit, creative refresh | Incumbents deeper per-platform; InfoGenie wins cross-channel intelligence integration |
| **Social suites** | Hootsuite, Sprout Social, Buffer | Social publisher, calendar, inbox | Incumbents win native network APIs; InfoGenie wins competitive + ROI context |
| **Analytics** | GA4, Amplitude, Mixpanel | Web analytics, attribution, digital twin | Incumbents win product analytics depth; InfoGenie wins marketing-specific closed loop |
| **Competitive intel** | Crayon, Klue, Similarweb | Battle cards, war room, monitors | Klue wins sales enablement workflow; InfoGenie wins execution + optimization linkage |
| **GEO / AI visibility** | Profound, Otterly, Peec (emerging) | AEO, GEO, AI Answer SOV | Category nascent — InfoGenie advantage is bundling with full stack |

### 8.2 Positioning statement vs. competitors

- **vs. Semrush/Ahrefs:** “They tell you what ranks; InfoGenie tells you what to *do* about it — and helps you ship the fix.”
- **vs. HubSpot:** “HubSpot runs your CRM; InfoGenie runs your *market intelligence and autonomous marketing brain* — and syncs to HubSpot.”
- **vs. Jasper:** “Jasper writes; InfoGenie *decides, writes, publishes, measures, and learns*.”
- **vs. Smartly/Albert:** “They optimize ads; InfoGenie optimizes the whole funnel including SEO, content, competitors, and executive decisions.”

### 8.3 Moat vectors (long-term)

1. **Cross-tenant benchmark data** (anonymized) — network effects as user base grows  
2. **Marketing Memory + Strategic Intelligence** — institutional knowledge compounds per tenant  
3. **Strict trust posture** — enterprise/agency buyers increasingly reject “demo data as real”  
4. **Workflow embedding** — 290 tools create high switching cost once spine + calendars + reports are live  

---

## 9. Critical safeguards for AI marketing intelligence

For InfoGenie to remain a **trustworthy AI marketing intelligence automation system**, these factors must be in place:

### 9.1 Data integrity layer

| Safeguard | Implementation | Why critical |
|-----------|----------------|--------------|
| **Strict data mode (default)** | `services/admin/data_mode.js` + global enforcement middleware | Prevents AI/template metrics from poisoning budget and ROI decisions |
| **Provenance labeling** | LIVE vs DERIVED vs PREVIEW on KPI surfaces | Users must know if a number came from ad accounts or market inference |
| **Integration truth** | Settings → Integrations; execution hub status | No fake “connected” states (fixed in intelligence audit) |
| **Fabrication lint** | `npm run lint:fabrication` in CI | Prevents new code paths from leaking synthetic data unmarked |

### 9.2 AI governance layer

| Safeguard | Default posture | Why critical |
|-----------|-----------------|--------------|
| **Shadow-first governance** | Log and warn; do not block core loop | Observability without killing daily marketing velocity |
| **Tiered action controls** | `generate_*` = auto; `launch_campaign` / `scale_budget` = suggest | Matches risk to automation level |
| **Fail open on governance errors** | Allow + `governance_degraded` log | Platform stays up; issues are visible not silent |
| **Brand safety scans** | Caution = warning, not block (default) | Prevents over-censorship of creative iteration |
| **Audit trail** | AI traces, governance events, admin issues | Enterprise compliance and post-incident review |

### 9.3 Execution safety layer

| Safeguard | Mechanism | Why critical |
|-----------|-----------|--------------|
| **Safe Agent** | Propose → simulate → approve → execute + rollback plans | Stops irreversible budget/campaign mistakes |
| **RBAC / permission matrix** | Route-level view/write keys | Agencies need client-scoped access control |
| **CSRF + session security** | HttpOnly cookies, CSRF shadow/on modes | Same-origin does not imply same trust boundary |
| **Credential vault encryption** | AES-256-GCM per user/platform | OAuth tokens are high-value attack targets |
| **SSRF-safe fetchers** | URL validation on crawlers/auditors | Prevents server-side request abuse |

### 9.4 Operational reliability layer

| Safeguard | Mechanism | Why critical |
|-----------|-----------|--------------|
| **Technical Manager** | Live scan of APIs, LLMs, pages, auth | Early detection of broken integrations before users hit them |
| **Background job isolation** | Optimizer, journey runner, digest crons | Autonomous systems must fail gracefully per tenant |
| **Multi-tenant isolation** | `tenant_id` on all tables; enforcement on | Agency platform requirement — no cross-client data leaks |
| **Ops tooling stack** | Checkly, OTEL, Promptfoo, LLM FinOps (documented) | Production AI systems need cost, quality, and uptime monitoring |

### 9.5 Human-in-the-loop principles (non-negotiable)

1. **Brief → action → calendar never blocked by default governance**  
2. **Strict mode never silently substitutes template data for real metrics**  
3. **Every autonomous action must be traceable to a recommendation ID**  
4. **Destructive actions require explicit approval unless tenant opts out of Safe Agent**  
5. **Learning loop must update from real act/dismiss outcomes, not synthetic clicks**

---

## 10. Future evolution

Roadmap synthesized from `docs/gap-priority-roadmap.md`, `docs/ecosystem-spine.md`, `docs/INFOGENIE_INTELLIGENCE_AUDIT.md`, and `docs/ai-governance-build-spec.md`.

### 10.1 Near-term (P0 — highest leverage)

| Initiative | Rationale |
|------------|-----------|
| **Zero-click & AI SERP hub** | Extend AEO/GEO with featured snippets, PAA, AI Overview citation tracking |
| **Remarketing center** | Unify pixel/CAPI health, audience sync, retargeting recommendations |
| **Referral program manager** | High-ROI owned channel; complements lead intelligence |
| **Affiliate program hub** | Operational layer on existing brand deals + UTM infrastructure |
| **Voice search optimization** | Conversational query readiness alongside AEO |

### 10.2 Mid-term (P1)

| Initiative | Rationale |
|------------|-----------|
| **Short-form video workflow** | End-to-end Reels/Shorts/TikTok campaign wizard |
| **Push notification productization** | OneSignal/Firebase connectors with segment triggers |
| **Live OAuth for GSC/GA4** | Replace preview analytics with account-truth data |
| **Write-back execution** | Queue mutations to Meta/Google/HubSpot/Slack from Strategic Intelligence |
| **Nav consolidation** | Dedupe Analytics Hub, fold Action Center into Battle Plan |

### 10.3 Long-term (platform vision)

| Direction | Target state |
|-----------|--------------|
| **Full marketing spine** | Every panel reads/writes through unified audience + attribution graph |
| **Agentic operations** | AutoClaw + Agent Orchestrator handle multi-step campaigns with Safe Agent gates |
| **Network benchmark moat** | Cross-tenant anonymized benchmarks drive default strategies |
| **MCP ecosystem** | External tools (CRM, data warehouse, creative) plug into spine via MCP |
| **Industry playbooks** | Vertical templates (fintech, ecommerce, SaaS) pre-wire analysis → playbooks |
| **Enterprise governance** | Tenant-opt-in enforce mode, role-filtered memory, compliance exports |

### 10.4 Evolution principle

InfoGenie should **not** become 50 disconnected point products. New capability ships when it **strengthens the loop**:

> **Discover → Create → Reach → Measure → Optimize → Learn**

---

## 11. Market size and opportunity

*Note: Market sizing below uses publicly cited industry categories and order-of-magnitude estimates for strategic planning. Figures should be validated against current analyst reports (Gartner, IDC, Statista) before investor materials.*

### 11.1 Category definition

InfoGenie sits at the intersection of:

- **Marketing automation / CRM hubs** (~$6–8B, growing ~9% CAGR)
- **SEO & digital marketing software** (~$4–5B)
- **Ad tech optimization & intelligence** (~$15B+ broader ad tech; ~$2–3B addressable for SMB/mid-market optimization)
- **AI marketing tools (emerging)** — fastest-growing subsegment; estimated **$40B+ TAM by 2030** across gen-AI in marketing (multiple analyst forecasts)

**Serviceable product category:** *AI-native marketing intelligence & automation platform for agencies and mid-market brands* — roughly **$8–15B SAM** globally when bundling replaceable point-tool spend.

### 11.2 Target segments

| Segment | Profile | Why InfoGenie fits |
|---------|---------|-------------------|
| **Digital agencies (10–200 staff)** | Multi-client, tool fatigue, reporting burden | Multi-tenant workspaces, white-label, full stack |
| **Mid-market brands ($10M–$500M revenue)** | Small marketing teams, high outsourcing | AI executive team replaces headcount gaps |
| **Vertical specialists** | Fintech, ecommerce, B2B SaaS | Analysis-first onboarding + playbooks |
| **Enterprise marketing ops (future)** | Governance, strict data mode, RBAC | Already architected for tenancy and honesty |

### 11.3 Sizing logic (bottom-up sketch)

| Assumption | Value |
|------------|-------|
| Target agencies + mid-market accounts globally | ~500K–2M organizations |
| Realistic paid conversion at maturity | 1–3% |
| ARPA (annual revenue per account) | $3K–$24K depending on tier/seats |
| **Implied reachable revenue at scale** | **$15M–$150M+ ARR** in core segments; higher with enterprise tier |

### 11.4 Growth drivers (2026–2030)

1. **AI search displacement of traditional SERP CTR** — GEO/AEO becomes mandatory line item  
2. **Consolidation pressure** — CFOs reducing SaaS sprawl favor unified platforms  
3. **Autonomous ad optimization** — labor savings + 24/7 execution  
4. **Data trust regulation** — strict provenance as enterprise buying criterion  
5. **Agency AI transformation** — agencies productize InfoGenie as their operating system  

### 11.5 Risks to sizing

- Incumbent bundling (HubSpot/Semrush adding AI features)  
- Platform API restrictions (Meta/Google policy changes)  
- AI cost volatility without FinOps discipline  
- Over-promising automation without Safe Agent adoption  

---

## 12. Appendix: integrations & technical reference

For the complete integrations inventory (APIs, LLMs, OAuth, tokens, status), see:

- **`docs/integrations-reference.md`** — full technical integration reference  
- **`docs/infogenie-complete-reference.md`** — T1–T119 architecture & tier index  
- **`docs/InfoGenie_Features_Guide.md`** — per-feature benefit descriptions  
- **`docs/security-guardrails.md`** — production security checklist  
- **`docs/ai-governance-build-spec.md`** — governance hard requirements  

### Quick integration categories

| Category | Examples |
|----------|----------|
| **LLMs** | OpenAI, Anthropic, Gemini, Perplexity, Cloudflare Workers AI, BYO providers |
| **SEO data** | DataForSEO, Semrush, Ahrefs, Majestic, SpyFu, PageSpeed, Bing WMT |
| **Ads** | Google Ads API, Meta Marketing API, TikTok Ads |
| **CRM / sync** | HubSpot, CRM sync scaffolds |
| **Social publish** | Zernio (15 platforms) |
| **Scraping / crawl** | Firecrawl, headless fetch |
| **Email** | Resend (transactional), Mailchimp (execution hub) |
| **Analytics** | GA4/GSC (OAuth path), Amplitude agents scaffold |
| **Payments** | Stripe |
| **Observability** | Sentry, OTEL |

---

## Document history

| Date | Change |
|------|--------|
| August 2026 | Initial comprehensive product overview for download |

---

*InfoGenie — AI Autonomous Marketing Intelligence Platform*  
*This document describes the product as implemented in the repository at time of writing. Feature availability may depend on configured integrations and data mode settings.*
