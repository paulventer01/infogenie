# InfoGenie — MVP Product Requirements Document

**Version:** 1.0  
**Date:** July 2026  
**Status:** Living Document  

---

## 1. Executive Summary

InfoGenie is an AI-powered marketing intelligence and campaign automation platform built for growth-stage businesses, digital agencies, and marketing teams who need the power of an enterprise marketing stack without the enterprise price tag or headcount.

The MVP delivers a single, unified workspace covering the full marketing lifecycle: competitor intelligence, paid campaign management, SEO and content, lead outreach, and performance reporting — all orchestrated by AI so small teams can compete with large ones.

---

## 2. Problem Statement

Small and mid-market marketing teams face three compounding problems:

| Problem | Impact |
|---|---|
| **Tool sprawl** — 10–15 disconnected SaaS tools (Semrush, HubSpot, Mailchimp, Meta Ads Manager, etc.) | No unified view; data lives in silos; reporting is manual |
| **AI gap** — AI tools exist but aren't connected to execution | Insights don't automatically become campaigns or optimisations |
| **Talent gap** — No budget for dedicated SEO, paid, CRM, and analytics specialists | Campaigns underperform; growth stalls |

InfoGenie collapses those 10–15 tools into one, with AI filling the specialist role.

---

## 3. Target Users

### Primary: The Growth Marketer
- **Role:** Solo marketer or small team (1–5 people) at a $1M–$20M ARR company
- **Goal:** Drive pipeline and revenue, prove ROI to the board
- **Pain:** Drowning in tools, no time to optimise everything manually
- **Quote:** *"I need to know what my competitors are doing, run ads, write content, and report on all of it — but I'm one person."*

### Secondary: The Digital Agency
- **Role:** Agency managing 5–50 client accounts
- **Goal:** Deliver more value per client without proportionally growing headcount
- **Pain:** Client reporting is manual; insights don't scale across accounts
- **Quote:** *"I spend 40% of my time building reports. I want to spend it on strategy."*

### Tertiary: The Founder/CEO
- **Role:** Founder wearing the marketing hat at a pre-PMF startup
- **Goal:** Understand their market, launch their first campaigns, generate early leads
- **Pain:** No marketing background; no budget for an agency
- **Quote:** *"I need something that just tells me what to do and then does it."*

---

## 4. Product Vision

> **"One platform, every marketing move — researched, executed, and optimised by AI."**

InfoGenie's north star is a single workspace where a marketer can:
1. Understand their competitive landscape in minutes
2. Launch paid and organic campaigns from the same interface
3. Have AI continuously optimise those campaigns
4. Send branded reports to clients or leadership automatically

---

## 5. MVP Scope

The MVP covers five core capability areas (tabs in the product):

### 5.1 Compete
*Know exactly what competitors are doing and where to outflank them.*

| Feature | Description | Priority |
|---|---|---|
| Competitor Profiles | AI-scraped overview of up to 10 competitors (positioning, messaging, tech stack) | P0 |
| Battle Cards | Head-to-head comparison cards for sales conversations | P0 |
| Ad Library Spy | Competitor active ads across Facebook, Google, TikTok | P0 |
| Share of Voice | Brand vs. competitor visibility across search and social | P1 |
| Question Mining | "People Also Ask" + Reddit/forum questions in your niche | P1 |
| Win/Loss Intel | AI analysis of why deals are won or lost | P2 |

### 5.2 Grow
*Launch campaigns, build pages, and optimise for conversion.*

| Feature | Description | Priority |
|---|---|---|
| Campaign Launch | One-click campaign creation for Google, Meta, TikTok from a brief | P0 |
| AI Optimizer | Multi-armed bandit algorithm: pauses poor ads, scales winners every 6h | P0 |
| Landing Page Builder | AI-generated landing pages with booking + lead capture | P0 |
| CRO Lab | A/B test headlines, CTAs, and layouts with statistical significance | P1 |
| Funnel Analytics | Step-by-step conversion tracker (view → opt-in → sale) with EPC/EPPV/ACV | P1 |
| AutoSEO Pro | Autonomous SEO: keyword gaps → content briefs → published posts | P1 |
| Bulk Content Rewriter | Batch rewrite up to 20 articles at once with tone/intensity settings | P2 |
| Link-in-Bio | Customisable bio link page for social profiles | P2 |

### 5.3 Reach
*Get in front of the right people at the right time across every channel.*

| Feature | Description | Priority |
|---|---|---|
| Journey Builder | Visual trigger → wait → condition → action automation builder | P0 |
| Omnichannel Composer | Draft and send Email, SMS, WhatsApp, Push from one interface | P0 |
| Dynamic Audiences | Rule-based segments that update live based on behaviour | P0 |
| Drip Engine | Multi-step email/SMS drip sequences with AI-written copy | P1 |
| LinkedIn Outreach Automation | Connection sequences and AI-personalised follow-up messages | P1 |
| Email Warm-Up | Gradual sending volume ramp to protect sender reputation | P1 |
| Re-engagement Agent | AI automatically identifies and re-engages dormant contacts | P2 |

### 5.4 Manage
*Brand, budget, team, and client management in one place.*

| Feature | Description | Priority |
|---|---|---|
| Brand Foundation | Brand voice, colours, tone stored once — injected into all AI outputs | P0 |
| Budget Board | Allocate and track spend across campaigns and channels | P0 |
| InstaReports | AI prospect audit reports — generate, brand, and email to leads | P1 |
| Weekly Report | Auto-generated performance report emailed every Monday | P1 |
| Ask InfoGenie | Conversational AI assistant for marketing questions + tasks | P1 |
| Marketing Projects | Kanban + calendar for campaigns and content | P2 |
| 7-Day Playbook | AI-generated first-week action plan for new users | P2 |

### 5.5 SEO
*Rank in search and AI-generated answers.*

| Feature | Description | Priority |
|---|---|---|
| GEO Audit | Visibility in ChatGPT, Perplexity, Gemini answers | P0 |
| Keyword-Page Map | Match target keywords to existing pages; identify gaps | P0 |
| On-Page Audit | Technical and content audit per URL | P1 |
| SERP Tracker | Daily rank tracking with Δ alerts | P1 |
| Multi-page Crawler | Full site SEO crawl with prioritised issue list | P2 |

---

## 6. User Stories

### Authentication & Onboarding
- As a new user, I can create an account with email/password or Google/Microsoft SSO so I can get started in under 2 minutes.
- As a new user, I am walked through a 7-Day AI Playbook on first login so I know exactly what to do first.
- As a team admin, I can invite teammates and assign roles so my whole team has access.

### Competitor Intelligence
- As a marketer, I can paste a competitor's URL and get an AI-generated profile in under 60 seconds so I can brief my team.
- As a marketer, I can see all active ads a competitor is running on Facebook and Google so I can understand their current strategy.
- As a sales rep, I can pull up a Battle Card before a call so I know exactly how to position against the competitor.

### Campaign Management
- As a marketer, I can write a one-sentence campaign brief and have InfoGenie generate ad copy, targeting, and a landing page so I can launch in under 30 minutes.
- As a marketer, I can set a daily budget and let the AI Optimizer automatically pause underperforming ads and scale winners so I don't waste spend overnight.
- As a marketer, I can see every campaign across Meta, Google, and TikTok in one dashboard so I don't have to log into three platforms.

### Content & SEO
- As a content marketer, I can paste 10 old blog posts and get AI-rewritten versions in my brand voice so I can refresh content without starting from scratch.
- As an SEO manager, I can see exactly which pages are ranking for which keywords and where the gaps are so I can prioritise content creation.
- As a marketer, I can audit my visibility in ChatGPT and Perplexity answers so I know if I'm appearing in AI-generated search results.

### Lead Generation & Outreach
- As an agency owner, I can generate a branded audit report for a prospect and email it to them in 2 clicks so I have a warm conversation starter.
- As an SDR, I can build a LinkedIn outreach sequence with AI-personalised connection notes and follow-up messages so I can run outreach at scale.
- As a marketer, I can set up a drip email sequence that automatically sends based on what a contact does on my site so I don't miss hot leads.

### Reporting
- As a CMO, I can receive an auto-generated weekly performance summary every Monday so I know what's working without building the report myself.
- As an agency owner, I can white-label reports with my logo and client branding so reports look professional when I send them to clients.

---

## 7. Non-Functional Requirements

| Requirement | Target |
|---|---|
| **Page load (dashboard)** | < 2s on a standard broadband connection |
| **AI response time** | < 15s for single-item AI generations (competitor profile, ad copy, etc.) |
| **Batch AI processing** | < 60s for up to 20-item batches (bulk rewriter, bulk reports) |
| **Uptime** | 99.5% (always-on VM deployment) |
| **Data isolation** | Full multi-tenant isolation — no cross-tenant data leakage |
| **Auth security** | bcrypt cost-12, HttpOnly cookies, 30-day rolling sessions, email verification |
| **Credential security** | AES-256-GCM per-user credential vault for all third-party API keys |
| **Mobile** | Responsive dashboard readable on tablet; full mobile support deferred post-MVP |

---

## 8. Technical Architecture

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 14 (App Router) + React | Incremental migration from legacy SPA; SSR for auth pages |
| Backend | Node.js + Express | Existing codebase; fast API development |
| Database | PostgreSQL (Replit managed) | Relational data + JSONB for flexible AI output storage |
| AI/LLM | GPT-4o / GPT-4o-mini, Claude 3.5, Gemini, Perplexity, Llama 3.1 | Multi-model strategy; fallbacks prevent single-vendor dependency |
| Deployment | Replit VM (always-on) | Supports background crons (optimizer, journey runner, audience sweep) |
| Email | Resend | Transactional + marketing email with webhook tracking |
| CRM | HubSpot (native integration) | Contact sync, audience mirroring to static lists |
| Data APIs | DataForSEO, Firecrawl, Apollo, BuiltWith, PageSpeed | Real data powers competitor and SEO features |

---

## 9. Integrations — MVP Must-Haves

| Category | Integration | Required for |
|---|---|---|
| Ad Platforms | Google Ads, Meta Ads | Campaign launch + optimizer |
| Email | Resend | Transactional email, reports, outreach |
| CRM | HubSpot | Contact sync, audience management |
| SEO Data | DataForSEO | Keyword data, SERP rankings |
| Web Scraping | Firecrawl | Competitor profiles, content scraping |
| Lead Data | Apollo | Lead enrichment |
| Analytics | Amplitude | Product usage tracking |
| Payments | Stripe | Subscription billing |

---

## 10. Success Metrics

### Activation (first 7 days)
- **Target:** 60% of new users complete at least one AI action (generate competitor profile, launch campaign, or create content)
- **Measure:** Event: `first_ai_action_completed`

### Engagement (day 30)
- **Target:** 40% of activated users return at least 3 times per week
- **Measure:** WAU / MAU ratio ≥ 0.6 for activated cohort

### Core Feature Adoption
| Feature | 30-day adoption target |
|---|---|
| Competitor Profile generated | 70% of users |
| Campaign launched | 40% of users |
| Report sent to client/stakeholder | 30% of users |
| AI Optimizer enabled | 25% of users |

### Revenue
- **MRR target (3 months post-launch):** $10,000
- **Average contract value:** $99–$299/month depending on tier
- **Churn:** < 5% monthly

### NPS
- **Target:** ≥ 40 at 60 days post-signup

---

## 11. Pricing (MVP)

| Tier | Price | Key Limits |
|---|---|---|
| **Starter** | $99/month | 1 user, 3 competitors tracked, 5 campaigns, basic reports |
| **Growth** | $199/month | 5 users, 10 competitors, unlimited campaigns, all reports, AI Optimizer |
| **Agency** | $299/month | 15 users, unlimited clients/tenants, white-label reports, bulk features |

All tiers include: AI content generation, Journey Builder, SEO tools, InstaReports, Email Warm-Up, LinkedIn Outreach.

---

## 12. Out of Scope — Post-MVP

The following are deliberate deferrals to keep the MVP lean and shippable:

| Feature | Rationale for deferral |
|---|---|
| Native mobile app (iOS/Android) | Web-first; add mobile after retention is proven |
| Custom AI model fine-tuning | Infrastructure complexity; OpenAI/Claude covers MVP use cases |
| Programmatic SEO at scale (1000+ pages) | Requires publishing infrastructure beyond current scope |
| Marketplace / agency partner network | Business model decision post-PMF |
| Google Analytics & Search Console sync | Blocked by Google Workspace OAuth policy for now |
| Video ad creation + editing | Requires dedicated video infrastructure |
| Call tracking / VAPI telephony | Niche; deferred unless strong demand signal |
| Shopify storefront builder | Separate product surface; evaluate post-MVP |

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenAI API cost blowout | Medium | High | GPT-4o-mini for bulk operations; rate limits per tenant; cost monitoring |
| Ad platform API policy changes | Medium | High | Multi-platform support (Google + Meta + TikTok) prevents single-vendor lock-in |
| User churn before activation | High | High | 7-Day Playbook onboarding; InstaReports as an immediate quick-win |
| Multi-tenant data leak | Low | Critical | Row-level tenant isolation enforced at ORM + DB level; `MULTITENANT_ENFORCEMENT=on` |
| Resend domain deliverability | Medium | Medium | `RESEND_FROM_EMAIL` must be a verified domain; fallback notice in setup |
| Competitor (DashClicks, Semrush) feature parity | High | Medium | Focus on AI-native integration and ease of use as differentiator, not feature count |

---

## 14. Launch Checklist

- [ ] `CREDENTIAL_ENCRYPTION_KEY` set in production environment
- [ ] `SESSION_SECRET` set
- [ ] Resend verified domain configured (`RESEND_FROM_EMAIL`)
- [ ] Stripe webhook configured for subscription billing
- [ ] `MULTITENANT_ENFORCEMENT=on` confirmed
- [ ] `PERMISSION_ENFORCEMENT=on` confirmed (after shadow mode validates)
- [ ] Google Ads OAuth redirect URI whitelisted: `${PUBLIC_URL}/api/integrations/google-ads/oauth/callback`
- [ ] Amplitude tracking verified live in production
- [ ] 7-Day Playbook emails scheduled and tested
- [ ] White-label report template reviewed with sample branding
- [ ] Load test: 50 concurrent users generating AI content
- [ ] Public InstaReport URLs tested end-to-end (generate → email → prospect views)

---

*Document owner: Product & Engineering*  
*Next review: 30 days post-launch*
