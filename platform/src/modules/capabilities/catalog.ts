// GENERATED from the InfoGenie Feature & Integration Reference (v1.0, July 2026)
// by scratchpad/features_10/gen-catalog.mjs — the platform's complete feature
// catalog: 124 distinct capabilities across 8 domains (the document's 130
// entries minus cross-references, per its §1). Each entry declares its archetype
// (§5.1), interaction model (Block 5), irreversibility (irreversible actions
// never exceed A2 — §7.2), context requirement, and integration bindings parsed
// from the document's own "What it does" / "Connected to" text.
//
// Edit the generator, not this file.

export interface CatalogEntry {
  key: string;
  name: string;
  domain: "compete" | "grow" | "reach" | "manage" | "analyse" | "monitor" | "create" | "seo";
  alsoIn: string[];
  archetype: "content_generation" | "knowledge" | "analysis" | "planning" | "operations" | "localisation";
  agentType: "embedded" | "input_heavy" | "orchestration" | "output_heavy" | "autonomous" | "human_in_loop";
  irreversible: boolean;
  requiresContext: boolean;
  entryAutonomy: number;
  autonomyCeiling: number;
  integrations: string[];
  description: string;
}

export const FEATURE_CATALOG: CatalogEntry[] = [
  {
    "key": "compete.battle_cards",
    "name": "Battle Cards",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates a structured competitive comparison for any competitor — 4 strengths, 4 weaknesses, 3 strategic moves, and 4 counter-plays."
  },
  {
    "key": "compete.share_of_voice",
    "name": "Share of Voice",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Tracks your brand&#x27;s mention share vs competitors over time as a stacked-area chart. Auto-populated every 6 hours by the Crisis Radar cron."
  },
  {
    "key": "compete.serp_position_tracker",
    "name": "SERP Position Tracker",
    "domain": "compete",
    "alsoIn": [
      "seo"
    ],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo"
    ],
    "description": "Tracks keyword rankings across 15 countries using DataForSEO. Stores historical rank data per keyword so you can see rank changes over time."
  },
  {
    "key": "compete.competitor_change_monitor",
    "name": "Competitor Change Monitor",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "slack"
    ],
    "description": "Watches any competitor URL for content changes. If the page changes by 5%+ it uses AI to classify the change type (pricing / features / messaging / design), severity, and generates a strategic insight. Sends Slack and email alerts."
  },
  {
    "key": "compete.pricing_watcher",
    "name": "Pricing Watcher",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "firecrawl"
    ],
    "description": "Scrapes competitor pricing pages using Firecrawl and extracts pricing tiers, prices, and features with AI. Stores historical snapshots so you can see pricing changes over time."
  },
  {
    "key": "compete.resilient_competitor_tracker",
    "name": "Resilient Competitor Tracker",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "firecrawl",
      "perplexity"
    ],
    "description": "Tracks specific named data points (e.g. \"current pricing\", \"number of features listed\", \"team size\") on any competitor page. Uses a cascade of Firecrawl → Perplexity fallback to ensure data is always retrieved. Stores every snapshot."
  },
  {
    "key": "compete.ad_library_spy",
    "name": "Ad Library Spy",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "meta_ads"
    ],
    "description": "Pulls live competitor ads from Meta&#x27;s Ad Library and TikTok&#x27;s Ad Library. Shows active ads, ad copy, creative formats, and when they started running."
  },
  {
    "key": "compete.ad_swipe_file",
    "name": "Ad Swipe File",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "A personal archive for saving competitor or inspiration ads discovered in the Ad Library or elsewhere. Store ad creative with notes, tags, and platform labels."
  },
  {
    "key": "compete.tech_stack_detector",
    "name": "Tech Stack Detector",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": false,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "builtwith"
    ],
    "description": "Uses BuiltWith to identify the exact technologies a competitor&#x27;s website uses — CRM, analytics, ads, ecommerce platform, CDN, chat widgets, etc. Supports multi-domain comparison (up to 5 competitors side by side)."
  },
  {
    "key": "compete.review_aggregator",
    "name": "Review Aggregator",
    "domain": "compete",
    "alsoIn": [
      "analyse"
    ],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "trustpilot_g2"
    ],
    "description": "Pulls competitor reviews from Trustpilot, G2, Google, Capterra, and TripAdvisor using Perplexity. Returns ratings, sentiment-tagged reviews, and compare mode for 2–4 brands side by side."
  },
  {
    "key": "compete.deleted_review_detection",
    "name": "Deleted Review Detection",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": false,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "slack"
    ],
    "description": "Watches for reviews that disappear between scans. When a review vanishes, it fires a Slack alert with the brand, platform, count, and review excerpts. History shows a timeline of disappeared reviews."
  },
  {
    "key": "compete.glassdoor_sentiment",
    "name": "Glassdoor Sentiment",
    "domain": "compete",
    "alsoIn": [
      "analyse"
    ],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "trustpilot_g2"
    ],
    "description": "Uses Perplexity to pull competitor Glassdoor data — overall rating, CEO approval, recommend percentage, recent reviews with pros/cons, top complaints, top praises, and 2–5 strategic cultural insights."
  },
  {
    "key": "compete.job_board_spy",
    "name": "Job Board Spy",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "trustpilot_g2"
    ],
    "description": "Pulls open roles from LinkedIn, Indeed, and competitor career pages, breaks them down by department, and generates 2–5 strategic signals about company direction from hiring patterns."
  },
  {
    "key": "compete.newsletter_tracker",
    "name": "Newsletter Tracker",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "firecrawl"
    ],
    "description": "Monitors competitor newsletters (Substack, Beehiiv, Mailchimp) using Firecrawl. Extracts the last 10 issues with subject lines, send dates, and previews."
  },
  {
    "key": "compete.youtube_comment_miner",
    "name": "YouTube Comment Miner",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "youtube"
    ],
    "description": "Collects 80–120 audience comments from a YouTube channel&#x27;s recent videos (via Perplexity), then AI-classifies them into questions, themes, sentiment breakdown, and generates 6–10 actionable content ideas from what the audience is actually asking."
  },
  {
    "key": "compete.organic_social_monitor",
    "name": "Organic Social Monitor (TikTok)",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "apify"
    ],
    "description": "Uses Apify to scrape TikTok organic posts for any brand or keyword. Returns views, likes, comments, shares, and engagement rate per video plus aggregate summary."
  },
  {
    "key": "compete.ai_competitor_war_room",
    "name": "AI Competitor War Room",
    "domain": "compete",
    "alsoIn": [
      "analyse"
    ],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "openai",
      "trustpilot_g2"
    ],
    "description": "Gathers live signals via Perplexity (recent hires, ad spend changes, new pages, pricing changes, PR, geographic expansion) then uses GPT-4o to produce a strategic move prediction — confidence score (0–100), move type, threat level (low/medium/high/critical), rationale, and recommended counter-move."
  },
  {
    "key": "compete.seo_on_page_auditor",
    "name": "SEO On-Page Auditor",
    "domain": "compete",
    "alsoIn": [
      "seo"
    ],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "meta_ads"
    ],
    "description": "Fetches any URL and runs 17 automated checks (title length, meta description, H1, viewport, canonical, OG tags, JSON-LD, alt text, noindex, word count, internal links, etc.). Returns a 0–100 score with letter grade and prioritised fix list."
  },
  {
    "key": "compete.embeddable_seo_audit_widget",
    "name": "Embeddable SEO Audit Widget",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot"
    ],
    "description": "A lead-gen widget you embed on any website. Visitors enter their URL and email address — the widget runs a live SEO audit and shows them a teaser score. Full results require a valid email (gates lead capture). Admin view shows all leads captured with their scores."
  },
  {
    "key": "compete.seo_task_manager",
    "name": "SEO Task Manager",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Converts SEO audit results into a structured task list with priority levels (P1/P2/P3), assignees, due dates, status tracking (open/in_progress/done/snoozed/won&#x27;t fix), and notes. Re-audit function automatically closes tasks where the issue is resolved."
  },
  {
    "key": "compete.tiktok_downloader",
    "name": "TikTok Downloader",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": false,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "rapidapi_tiktok",
      "tikwm"
    ],
    "description": "Accepts up to 25 TikTok URLs (including short links), resolves them via tikwm.com (with RapidAPI fallback for higher limits), and returns watermark-free MP4 download links with full metadata (caption, hashtags, music, views, likes)."
  },
  {
    "key": "compete.dataset_marketplace",
    "name": "Dataset Marketplace",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": false,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "8 pre-built AI-generated intelligence dataset packs: competitor pricing, job market signals, social proof aggregator, industry benchmarks, tech stack map, content gaps, ad creative intelligence, market sizing. Each generates a structured table with key takeaways."
  },
  {
    "key": "compete.scraping_recipe_library",
    "name": "Scraping Recipe Library",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": false,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "trustpilot_g2"
    ],
    "description": "10 pre-built extraction recipes for common intelligence tasks: G2 reviews, Product Hunt listings, Trustpilot, LinkedIn company pages, Hacker News discussions, App Store listings, Glassdoor, Capterra, competitor pricing pages, and jobs pages."
  },
  {
    "key": "compete.ai_web_extractor",
    "name": "AI Web Extractor",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Free-form data extraction in plain English. Enter any URL and an instruction like \"extract all pricing plan names and prices\". Returns a structured table."
  },
  {
    "key": "compete.schemaorg_json_ld_generator",
    "name": "Schema.org / JSON-LD Generator",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates structured data markup (JSON-LD) for 8 schema types: Organization, Article, Product, FAQPage, LocalBusiness, BreadcrumbList, Event, Recipe. Dynamic form drives every field. Live JSON-LD preview with copy-to-clipboard and save."
  },
  {
    "key": "compete.web_vitals_auditor",
    "name": "Web Vitals Auditor",
    "domain": "compete",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": false,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "pagespeed"
    ],
    "description": "Runs Google PageSpeed Insights on any URL — mobile and desktop in parallel. Returns lab metrics (LCP, FCP, CLS, TBT, Speed Index) plus CrUX field data and the top 6 performance opportunities with estimated savings."
  },
  {
    "key": "compete.business_acquisition_scanner",
    "name": "Business Acquisition Scanner",
    "domain": "compete",
    "alsoIn": [
      "analyse"
    ],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "openai"
    ],
    "description": "Scans for M&A opportunities using Perplexity and GPT-4o. 5 scan types: struggling competitors, businesses for sale, fast-growing sectors, franchise opportunities, or full scan. AI scores each opportunity (1–100) on strategic value, price attractiveness, distress signals, and growth trajectory."
  },
  {
    "key": "grow.campaign_launch",
    "name": "Campaign Launch (AI Optimizer)",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "meta_ads",
      "google_ads",
      "tiktok_ads",
      "bluealpha"
    ],
    "description": "Launches ad campaigns across Google Ads, Meta Ads, and TikTok Ads. Once launched, the AI Optimizer runs an autonomous cycle: hourly ad-insight ingest → 6-hour pause/scale rules → 12-hour Multi-Armed Bandit budget reallocation → 24-hour creative refresh. Dry-run by default; flip to LIVE in settings."
  },
  {
    "key": "grow.landing_page_builder",
    "name": "Landing Page Builder",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "AI-generates a complete, responsive landing page — hero, features, social proof steps, testimonials, FAQs, and CTA — as server-rendered HTML. Sandboxed iframe preview. A/B variant generator creates an alternative page with a different persuasion angle. Live pages served at /lp/:id."
  },
  {
    "key": "grow.ab_split_testing",
    "name": "A/B Split Testing",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates an alternative landing page variant with a different persuasion angle (social-proof-heavy, fear-based, curiosity, authority, etc.). Live pages split 50/50 by cookie. Real-time stats show views, leads, and conversion rate per variant."
  },
  {
    "key": "grow.lead_analytics_webhook",
    "name": "Lead Analytics + Webhook",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": false,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot"
    ],
    "description": "Captures every lead from landing pages (name, email, message, which variant). Shows total leads, today&#x27;s leads, and variant breakdown. Webhook forwarding sends leads to Zapier, HubSpot, Make, or any endpoint on capture."
  },
  {
    "key": "grow.cro_lab",
    "name": "CRO Lab (Conversion Boosters)",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Two embeddable conversion widgets: (1) Social Proof popup — rotating \"Sarah from Cape Town just signed up\" toast notifications with custom names/locations/actions. (2) Exit Intent popup — captures emails from visitors who are about to leave with a modal and CTA. Both track views, dismisses, and leads."
  },
  {
    "key": "grow.link_in_bio_builder",
    "name": "Link-in-Bio Builder",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Creates a mobile-optimised link page (like Linktree) with your brand colours, logo, bio, and unlimited links. Custom slug, live preview, one-click publish."
  },
  {
    "key": "grow.booking_pages",
    "name": "Booking Pages",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot"
    ],
    "description": "Generates a branded booking page where visitors can request calls or demos. Captures name, email, company, and preferred time. Integrates with your calendar via webhook."
  },
  {
    "key": "grow.ai_revenue_forecast_engine",
    "name": "AI Revenue Forecast Engine",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai"
    ],
    "description": "90-day what-if revenue modeller. Input your current spend, leads, conversion rate, AOV, CAC, and LTV. GPT-4o generates best/expected/worst case scenarios with payback period, LTV:CAC ratio, 3-month breakdown, and plain-English recommendation."
  },
  {
    "key": "grow.iroas_incrementality_module",
    "name": "iROAS Incrementality Module",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "bluealpha"
    ],
    "description": "Measures true incremental ROAS from holdout experiments. Design a holdout test, enter raw results, and get calculated: test CVR, control CVR, lift %, incremental conversions/revenue, iROAS, reported ROAS, and the delta between them. AI gives a verdict and recommended actions. Also generates budget saturation curves."
  },
  {
    "key": "grow.marketing_simulator",
    "name": "Marketing Simulator (Digital Twin)",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "A strategic sandbox with three tabs: Simulator (any \"what if\" question), Compare (2–4 scenarios side by side with AI-recommended winner), Library (24 pre-built templates across 6 categories). Auto-fills from real campaign data. Generates shareable public reports and PDFs."
  },
  {
    "key": "grow.autonomous_marketing_operator",
    "name": "Autonomous Marketing Operator",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "autonomous",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai",
      "bluealpha"
    ],
    "description": "The \"I already fixed it\" AI. Input your current ROAS, target ROAS, CAC, campaigns, and issues. GPT-4o acts as an autonomous operator: diagnoses the problem, takes 3+ decisive actions (rewrite ad / pause campaign / scale / reallocate budget / launch A/B test / update landing page), produces rewritten ad copy, budget reallocation plan, and a one-sentence summary."
  },
  {
    "key": "grow.conversion_recovery_assistant",
    "name": "Conversion Recovery Assistant",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "openai",
      "meta_ads"
    ],
    "description": "Two-panel tool. Score Calculator: computes a 0–100 Recovery Score for how much conversion data you&#x27;re losing to iOS/Safari/ad-blockers, with estimated monthly dollar gap. Setup Guide: GPT-4o-mini generates a complete step-by-step server-side tracking implementation (Meta CAPI or Google Enhanced Conversions) with copy-paste code."
  },
  {
    "key": "grow.audience_research_agent",
    "name": "Audience Research Agent",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Pre-page audience intelligence for landing pages. Returns 3–4 audience segments, 5–7 pain points, 4–5 objections with rebuttals, 8–12 power words, and 5 headline hook angles. One-click \"Apply to Brief\" pre-fills the landing page form."
  },
  {
    "key": "grow.launch_compliance_checklist",
    "name": "Launch Compliance Checklist",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Pre-launch review workflow with 18 checklist items across four phases: Brand Alignment (AI-scores copy against Brand Foundation), Copy & Proofreading (AI grammar and clarity review), Legal & Compliance (manual sign-off checklist), and Mobile Responsive (live iframe mobile preview for any landing page URL)."
  },
  {
    "key": "grow.post_launch_audit",
    "name": "Post-Launch Audit",
    "domain": "grow",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot"
    ],
    "description": "Structured 24h/48h post-launch audit. Four automated checks: Live Data (is the campaign actually spending?), Spend Verification (is consumption rate correct?), Impressions (is it delivering?), Lead Flow (creates and verifies a test contact in HubSpot as a full round-trip audit)."
  },
  {
    "key": "reach.dynamic_audiences",
    "name": "Dynamic Audiences",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot"
    ],
    "description": "Rule-based real-time contact segmentation. Build audience segments with conditions (industry, score, tag, behaviour). A 15-minute sweep cron evaluates all contacts and auto-enrols or removes them. Segments can be bound to Drip email sequences, HubSpot Static Lists, and Re-engagement campaigns — all updated automatically as contacts join or leave."
  },
  {
    "key": "reach.journey_builder",
    "name": "Journey Builder",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [],
    "description": "Visual workflow builder for multi-step marketing journeys. Nodes: trigger / wait / condition / action. Runner ticks every 60 seconds. Signal triggers connect real product events (purchase, support ticket, etc.) to journey enrolment."
  },
  {
    "key": "reach.drip_engine",
    "name": "Drip Engine",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "resend"
    ],
    "description": "Email drip sequence builder and sender. Create multi-step sequences bound to audience segments. Contacts are auto-enrolled on segment join and auto-unsubscribed on segment leave. Mutations protected by a global lock to prevent race conditions."
  },
  {
    "key": "reach.omnichannel_composer",
    "name": "Omnichannel Composer",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "resend"
    ],
    "description": "Compose and send messages across multiple channels from one place: email (Resend), SMS (Twilio), WhatsApp, push notifications (VAPID), and more. Supports templates, personalisation tokens, and scheduling."
  },
  {
    "key": "reach.re_engagement_agent",
    "name": "Re-engagement Agent",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [],
    "description": "Automatically fires a personalised 1-step win-back email to contacts who join a churn-risk audience. The win-back message is AI-generated and regeneratable. Only system-fired win-backs are auto-unsubscribed when the contact leaves the segment — manual enrollments are never touched."
  },
  {
    "key": "reach.prompt_to_campaign_builder",
    "name": "Prompt-to-Campaign Builder",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "openai",
      "hubspot"
    ],
    "description": "One sentence → full campaign. Enter a plain-text marketing brief (e.g. \"target London-based SaaS founders who haven&#x27;t opened an email in 30 days\"). GPT-4o generates a complete campaign draft: audience rules, channel, subject/body, recommended send time, and rationale. Drafts are editable before approval. Approving automatically creates the real audience segment."
  },
  {
    "key": "reach.hubspot_sync",
    "name": "HubSpot Sync",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "hubspot"
    ],
    "description": "Pushes leads, contacts, and influencers from any InfoGenie tool directly into HubSpot as contacts. Batch upsert by email. Recent contacts view shows the last 50 contacts added."
  },
  {
    "key": "reach.b2b_lead_finder",
    "name": "B2B Lead Finder",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "hubspot",
      "apollo"
    ],
    "description": "Uses Perplexity to research and return 10–20 B2B leads matching your criteria (industry, role, location, company size). Never invents email addresses. One-click push to HubSpot. Leads cached in window._lfLeads for cross-tool use."
  },
  {
    "key": "reach.lead_aggregator",
    "name": "Lead Aggregator (Multi-Source)",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "hubspot",
      "apollo"
    ],
    "description": "Sweeps leads from Perplexity AI research and Apollo.io simultaneously. Deduplicates by email/LinkedIn/name+company. Scores leads by data completeness (+15 email, +10 LinkedIn, etc.). Returns sorted lead list with source breakdown."
  },
  {
    "key": "reach.local_lead_finder",
    "name": "Local Lead Finder (Google Maps)",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot",
      "apify",
      "google_maps"
    ],
    "description": "Uses Apify to scrape local business data from Google Maps — name, category, address, phone, website, rating, review count, opening hours. Summary stats show coverage gaps (% with phone, % with website). One-click HubSpot company push."
  },
  {
    "key": "reach.email_personalizer",
    "name": "Email Personalizer",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "firecrawl",
      "openai"
    ],
    "description": "Takes any lead list and personalises a base email template for each person. Uses Firecrawl to research the lead&#x27;s company website, then GPT-4o-mini rewrites the email with specific, relevant details. Supports up to 25 leads per batch. CSV export."
  },
  {
    "key": "reach.cold_email_writer",
    "name": "Cold Email Writer",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot"
    ],
    "description": "Generates 1–5 step cold email sequences for any target. Strict-JSON output with subject, body, and a specific tone per step. Template fallback when AI is unavailable."
  },
  {
    "key": "reach.influencer_discovery",
    "name": "Influencer Discovery",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity"
    ],
    "description": "Uses Perplexity to find influencers matching your criteria (niche, platform, minimum followers). Returns profiles with follower count and engagement signals. One-click \"Add to Influencer CRM\"."
  },
  {
    "key": "reach.influencer_crm",
    "name": "Influencer CRM",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Full pipeline CRM for influencer relationships: prospect → contacted → negotiating → active. Stores profile data, contact details, rate card, notes, vet score. One-click email draft generation."
  },
  {
    "key": "reach.influencer_fake_detection_and_vetting",
    "name": "Influencer Fake-Detection & Vetting",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Research the creator across follower growth trajectory, engagement quality, comment authenticity, brand partnerships, and engagement-pod signals. Generates: score (0–100), risk level (Low/Medium/High/Suspicious), red flags, green flags, summary, engagement verdict, and follower quality assessment."
  },
  {
    "key": "reach.social_publisher",
    "name": "Social Publisher",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "meta_ads",
      "zernio",
      "wordpress",
      "reddit",
      "youtube"
    ],
    "description": "Publish and schedule content to 15 platforms (Twitter/X, Instagram, Facebook, LinkedIn, TikTok, YouTube, Pinterest, Reddit, Bluesky, Threads, Google Business, Telegram, Snapchat, WhatsApp, Discord) via Zernio API. Supports text, images, video, and scheduled posting."
  },
  {
    "key": "reach.social_analytics",
    "name": "Social Analytics",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Aggregates per-account engagement data: posts, impressions, likes, comments, shares, clicks, engagement rate, followers, and follower growth. Shows top post per account across all connected platforms."
  },
  {
    "key": "reach.backlink_intel",
    "name": "Backlink Intel",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo"
    ],
    "description": "Pulls live backlink data for any domain from DataForSEO: total backlinks, referring domains, anchor text distribution, top referring pages, new and lost links."
  },
  {
    "key": "reach.link_prospector",
    "name": "Link Prospector",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo",
      "perplexity",
      "openai"
    ],
    "description": "Takes a keyword + domain. Uses DataForSEO SERP to find the top 20 ranking pages, then Perplexity enriches each with domain strength, content relevance, contact email/Twitter, and outreach angle. GPT-4o-mini scores and ranks prospects by priority."
  },
  {
    "key": "reach.reply_assistant",
    "name": "Reply Assistant",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "openai"
    ],
    "description": "Pulls the top 30 brand mentions ranked by engagement. For each mention, GPT-4o-mini drafts a reply in your brand&#x27;s tone, with both a full version and a 240-character X variant."
  },
  {
    "key": "reach.quora_mining",
    "name": "Quora Mining",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "quora"
    ],
    "description": "Finds 8–15 most-engaged Quora questions relevant to your brand with answer count, view count, intent classification, top answer summary, and a suggested response angle for your brand."
  },
  {
    "key": "reach.chatbot_builder",
    "name": "Chatbot Builder",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [],
    "description": "Generates a complete chatbot configuration: greeting, 8–15 FAQ Q&A entries with kind tags, fallback message, lead-capture fields, suggested quick replies, accent colour, and a copy-pasteable embed snippet."
  },
  {
    "key": "reach.churn_scorer",
    "name": "Churn Scorer",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai",
      "hubspot"
    ],
    "description": "Scores contacts 0–100 for churn risk using GPT-4o-mini. Returns risk level (low/medium/high), specific risk signals, and a personalised recommendation. Bulk mode processes up to 25 contacts simultaneously."
  },
  {
    "key": "reach.meeting_notes_summarizer",
    "name": "Meeting Notes Summarizer",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "hubspot"
    ],
    "description": "Paste meeting transcript or notes → returns: summary, key points, action items, BANT scores (Budget/Authority/Need/Timeline each 0–10), overall score (0–100), deal stage, sentiment, risks, objections, and next step."
  },
  {
    "key": "reach.hashtag_intelligence",
    "name": "Hashtag Intelligence",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Research optimal hashtags for Instagram and TikTok for any keyword. Returns hashtags grouped into strategic clusters (Mega/High/Medium/Niche), each with reach level, strategy, and post frequency recommendation. Caption-ready copy block with the top 30 tags."
  },
  {
    "key": "reach.local_listings_nap_sync",
    "name": "Local Listings / NAP Sync",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "meta_ads",
      "google_maps"
    ],
    "description": "Maintains a canonical NAP (Name / Address / Phone) profile, then scans Google, Facebook, Apple Maps, Bing, and Yelp to detect mismatches. Flags inconsistencies and marks them resolved when fixed."
  },
  {
    "key": "reach.geofencing",
    "name": "Geofencing",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [],
    "description": "Define radius-based geofences (lat/lng/radius). When a contact checks in within range, it fires a templated message via the configured channel. Includes a test \"Simulate Check-in\" panel. Event log shows all trigger history."
  },
  {
    "key": "reach.ai_acquisition_engine",
    "name": "AI Acquisition Engine",
    "domain": "reach",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "perplexity",
      "openai",
      "hubspot"
    ],
    "description": "Fully autonomous lead-to-meeting pipeline. Define your target (industry, role, company size, value prop). System finds prospects via Perplexity, scores them, generates a 3-step cold email sequence via GPT-4o, and tracks the pipeline: found → emailed → meeting booked."
  },
  {
    "key": "manage.todayandx27s_marketing_brief",
    "name": "Today&#x27;s Marketing Brief (AI Marketing Director)",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "slack"
    ],
    "description": "AI-generated morning brief that merges signals from all active pillars — optimizer ROAS, SERP rank changes, AI search visibility, crisis incidents, SOV shifts, battle cards, web vitals, decision engine recommendations, customer reviews — into a ranked 3–7 action list with one-click deep-links to the relevant feature. Regenerates daily via cron. Delivers to Slack."
  },
  {
    "key": "manage.period_comparison",
    "name": "Period Comparison",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo",
      "hubspot"
    ],
    "description": "Compares marketing performance across two time periods — ad spend, impressions, clicks, leads, conversions, and HubSpot new contacts. Preset buttons (Last 7d, Last 30d, This month, Last 90d) or custom date ranges. Dual-line Chart.js chart switchable by metric. Day-by-day breakdown table. Optional DataForSEO domain organic estimate."
  },
  {
    "key": "manage.web_analytics",
    "name": "Web Analytics",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "amplitude"
    ],
    "description": "Acquisition and behaviour analytics — traffic sources, page views, sessions, bounce rate, and top pages. Powered by Amplitude events and internal tracking."
  },
  {
    "key": "manage.ai_traffic_monitor",
    "name": "AI Traffic Monitor",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Monitors traffic patterns and surfaces anomalies — sudden drops, traffic spikes, referral source changes — with AI explanation of likely causes."
  },
  {
    "key": "manage.budget_board",
    "name": "Budget Board",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "bluealpha"
    ],
    "description": "Unified budget monitoring view showing live campaign spend vs. budget across all platforms, with burn rate tracking and forecasted end-of-month spend."
  },
  {
    "key": "manage.budget_caps",
    "name": "Budget Caps",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "meta_ads"
    ],
    "description": "Platform-level daily and lifetime spend guard-rails for Google, Meta, TikTok, Microsoft, and LinkedIn. Colour-coded spend bars (green/amber/red). Configurable alert threshold (default 80%) with optional auto-pause flag."
  },
  {
    "key": "manage.marketing_okrs",
    "name": "Marketing OKRs",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai"
    ],
    "description": "Set marketing goals with success criteria and deadlines. GPT-4o generates a 5–8 task execution plan. Tasks are a checklist that auto-updates goal progress %. \"Evaluate Progress\" grades the goal (A–F) and identifies the priority next action."
  },
  {
    "key": "manage.customer_360",
    "name": "Customer 360",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Read-only unified account dashboard stitching together: Brand Foundation snapshot, Voice of Customer themes, lead totals + recent activity, audience segments, and brand deals. Empty-state cards deep-link to the source tool."
  },
  {
    "key": "manage.utm_architecture",
    "name": "UTM Architecture",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Standardised UTM URL builder with built-in channel quick-fills, live preview, and saved custom presets. Stores all tagged links with one-click copy."
  },
  {
    "key": "manage.pixel_manager_meta_capi",
    "name": "Pixel Manager + Meta CAPI",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "meta_ads"
    ],
    "description": "Unified pixel configuration hub for Meta Pixel + Conversions API, LinkedIn Insight Tag, and TikTok Pixel. Generates copy-paste pixel snippets. Meta CAPI tab fires server-side conversion events directly to Meta — bypassing ad blockers and iOS 14.5+ restrictions. Verifies connection. Event log tracks sent/failed calls."
  },
  {
    "key": "manage.investor_mode",
    "name": "Investor Mode",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai"
    ],
    "description": "AI CFO report generator. Input company financials → GPT-4o produces: executive summary, 8-metric dashboard (MRR/ARR/growth/CAC/LTV/LTV:CAC/runway/customers), 12-month revenue forecast, highlights, challenges, the ask, investor narrative, and next milestones. Generates a unique public investor portal URL (no login required)."
  },
  {
    "key": "manage.ai_marketing_marketplace",
    "name": "AI Marketing Marketplace",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Multi-tenant marketplace for sharing marketing assets. 8 categories: templates, campaigns, audience rules, prompt packs, landing pages, email sequences, AI agents, creatives. Browse, publish, and download. Download counter tracks what&#x27;s popular."
  },
  {
    "key": "manage.ai_model_comparison",
    "name": "AI Model Comparison",
    "domain": "manage",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai",
      "anthropic",
      "gemini",
      "cloudflare_ai"
    ],
    "description": "Run any prompt on up to 5 models simultaneously: GPT-4o, GPT-4o-mini, Claude 3.5 Sonnet, Claude 3 Haiku, Gemini 1.5 Flash, Gemini 1.5 Pro, Llama 3.1 8B. Parallel calls with per-model latency and token tracking. AI judge picks winner and scores each model."
  },
  {
    "key": "analyse.icp_studio",
    "name": "ICP Studio (Ideal Customer Profile)",
    "domain": "analyse",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates a detailed Ideal Customer Profile: demographics, firmographics, psychographics, pain points, buying triggers, objections, and preferred channels. Exportable as a brief for the whole team."
  },
  {
    "key": "analyse.voice_of_customer",
    "name": "Voice of Customer (VoC Mining)",
    "domain": "analyse",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Mines customer feedback from any source and AI-categorises it into 4–8 themes: praise, complaints, questions, feature requests, neutral. Returns theme frequency, representative quotes, and strategic implications."
  },
  {
    "key": "analyse.google_trends_explorer",
    "name": "Google Trends Explorer",
    "domain": "analyse",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "google_trends"
    ],
    "description": "Real-time keyword trend data (no API key required). Interest over time (0–100) for 1–3 keywords with period selector (24h to 5y) and region filter. Related queries with breakout badge. Trending now with traffic estimates and top news. Compare mode plots up to 5 keywords side by side."
  },
  {
    "key": "analyse.bing_webmaster_tools",
    "name": "Bing Webmaster Tools",
    "domain": "analyse",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo",
      "bing_webmaster"
    ],
    "description": "Bing-specific keyword performance, page query stats, site activity, crawl stats, and keyword research — as a second SEO data source alongside DataForSEO. Requires Bing Webmaster API key."
  },
  {
    "key": "analyse.accessibility_audit",
    "name": "Accessibility Audit",
    "domain": "analyse",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai"
    ],
    "description": "Fetches any URL, runs structural HTML checks plus GPT-4o deep WCAG 2.1 AA audit across 12 criteria: images, colour contrast, keyboard, forms, structure, links, ARIA, media, language, skip nav, empty elements. Returns scored 0–100 report with severity breakdown and per-criterion fixes."
  },
  {
    "key": "analyse.attribution_modeling",
    "name": "Attribution Modeling",
    "domain": "analyse",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Multi-touch attribution across your marketing channels. Shows which touchpoints (first click, last click, linear, time-decay) actually contributed to conversions."
  },
  {
    "key": "monitor.crisis_radar",
    "name": "Crisis Radar",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "slack"
    ],
    "description": "Monitors your brand across multiple sources with a 6-hour cron. Establishes a baseline (7-snapshot moving average) and triggers a crisis incident when mentions spike above it. Sends Slack alerts. Feeds Share of Voice automatically."
  },
  {
    "key": "monitor.smart_alert_routing",
    "name": "Smart Alert Routing",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "resend",
      "slack"
    ],
    "description": "Configurable alert rules across trigger kinds (crisis incident / SOV drop / digest ready / mention volume / custom) delivered to Slack or email via Resend. Test-fire any rule. Stores dispatch history."
  },
  {
    "key": "monitor.ai_daily_digest",
    "name": "AI Daily Digest",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai",
      "slack",
      "youtube"
    ],
    "description": "Generates a structured daily brief per watched brand: warnings, wins, actions, and highlights. 24-hour cron, GPT-4o-mini sections from live data. One-click Slack delivery."
  },
  {
    "key": "monitor.trending_topics",
    "name": "Trending Topics",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity"
    ],
    "description": "Uses Perplexity Sonar to detect 6–10 trending topics in your space from the last 7 days, with relevance scores and strategic implications."
  },
  {
    "key": "monitor.podcast_monitor",
    "name": "Podcast Monitor",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity"
    ],
    "description": "Uses Perplexity to scan for recent podcast episodes mentioning your brand or keywords. Returns episodes with sentiment, platform, summary, and context."
  },
  {
    "key": "monitor.reddit_pulse",
    "name": "Reddit Pulse",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai",
      "reddit"
    ],
    "description": "Searches up to 10 subreddits × 5 keywords with GPT-4o-mini sentiment classification. Returns posts with upvotes, comments, sentiment label."
  },
  {
    "key": "monitor.twitterx_pulse",
    "name": "Twitter/X Pulse",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity"
    ],
    "description": "Searches Twitter/X for brand + keywords from the last 7 days using Perplexity Sonar. Returns tweets with author, text, likes, retweets, replies, sentiment, and viral flag for high-engagement posts."
  },
  {
    "key": "monitor.youtube_monitor",
    "name": "YouTube Monitor",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "youtube"
    ],
    "description": "Tracks competitor or industry YouTube channels. Every scan pulls 3–15 recent videos with views, likes, comments, sentiment, and summary — using Perplexity (no YouTube API key required)."
  },
  {
    "key": "monitor.real_time_news",
    "name": "Real-Time News",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "rapidapi_tiktok",
      "news_api"
    ],
    "description": "Three-tab news intelligence hub: Search (keyword/brand/competitor search), Topic Feeds (curated feeds across Business/Technology/World/Science/Health/Entertainment), Saved Articles (personal bookmark library). Powered by Real-Time News Data API via RapidAPI."
  },
  {
    "key": "monitor.unified_conversation_inbox",
    "name": "Unified Conversation Inbox",
    "domain": "monitor",
    "alsoIn": [],
    "archetype": "knowledge",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "reddit",
      "quora",
      "trustpilot_g2"
    ],
    "description": "A single inbox that aggregates mentions from 7 monitoring sources: Reddit Pulse, Twitter/X Pulse, Review Aggregator, Quora, Glassdoor, Newsletter mentions, and Chatbot conversations. Status tracking (new/replied/resolved/snoozed), assignee, tags, notes, and filter bar."
  },
  {
    "key": "create.content_calendar",
    "name": "Content Calendar",
    "domain": "create",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "output_heavy",
    "irreversible": true,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 2,
    "integrations": [
      "wordpress",
      "youtube"
    ],
    "description": "AI-generates a 1–30 day content calendar across 8 channels (blog, Instagram, Twitter, LinkedIn, TikTok, YouTube, email, podcast) with topics, copy, hashtags, and a \"publish\" button per entry that connects to Social Publisher. CSV export. Content ideas from YouTube Comment Miner and Trending Topics can be added directly."
  },
  {
    "key": "create.content_modes",
    "name": "Content Modes (Article Generator)",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "wordpress"
    ],
    "description": "Generates full SEO articles in 6 specialised modes: Standard (blog), Affiliation (product review with pros/cons/verdict/rating), E-commerce (product/category pages), Local (location-based + GMB signals), Update (refresh existing content — paste your old post), Discovery (Google Discover-optimised, 500–700 words, curiosity hook)."
  },
  {
    "key": "create.wordpress_auto_publishing",
    "name": "WordPress Auto-Publishing",
    "domain": "create",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "wordpress"
    ],
    "description": "Connect multiple WordPress sites with Application Password credentials. Publish or schedule articles as draft/published/pending. Publish log tracks every post. One-click publish from Content Calendar and Content Modes."
  },
  {
    "key": "create.content_autopilot",
    "name": "Content Autopilot",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "wordpress"
    ],
    "description": "Fully autonomous content production on a schedule. Configure topics, frequency, mode, and target WordPress site. Autopilot generates and publishes content automatically on the configured schedule."
  },
  {
    "key": "create.idea_swipe_feed",
    "name": "Idea Swipe Feed",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates 20 AI content ideas per day using your Brand Foundation. Tinder-style card UI (Skip / Save / Add to Calendar). 20 pre-built content angle library (Mythbuster, Before & After, Statistics, Negative Hook, Behind the Scenes, etc.). Saved ideas view."
  },
  {
    "key": "create.video_script_generator",
    "name": "Video Script Generator",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates 1–5 video script variants for TikTok, Reels, Shorts, or LinkedIn. Each script has hook, body (spoken + onscreen text + camera cues), CTA, viral pattern, and hashtags. 6 tones. 15–180 second duration."
  },
  {
    "key": "create.voiceover",
    "name": "Voiceover (Text-to-Speech)",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai"
    ],
    "description": "Converts any text (up to 4,000 characters) to MP3 audio using OpenAI TTS. 6 voices (alloy, echo, fable, onyx, nova, shimmer) and 2 models (tts-1 / tts-1-hd). Inline audio player + download. History of last 10 recordings."
  },
  {
    "key": "create.ad_creative_studio",
    "name": "Ad Creative Studio",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "meta_ads"
    ],
    "description": "Three panels: (1) Ad Creative Generator — platform-specific ad copy for Meta, Google, TikTok, LinkedIn. (2) Pre-launch Creative Scoring — 5-dimension scoring (hook, CTA, urgency, emotional resonance, relevance) with letter grade and improvement tips. (3) UGC Video Ad Scripts — timed scene-by-scene UGC scripts (15/30/45/60s) with 5 hook styles."
  },
  {
    "key": "create.create_once_publish_everywhere",
    "name": "Create Once Publish Everywhere",
    "domain": "create",
    "alsoIn": [],
    "archetype": "operations",
    "agentType": "output_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "meta_ads"
    ],
    "description": "Generates a complete 3-platform ad package from any saved landing page. Returns tailored copy for: Meta (headline ≤30 chars, 125-char primary text, CTA), Google Display (responsive headline, 90-char description), and TikTok (3s hook script, video concept, hashtags, creator direction)."
  },
  {
    "key": "create.wireframe_generator",
    "name": "Wireframe Generator",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai",
      "anthropic"
    ],
    "description": "Generates complete, self-contained HTML wireframes for 10 page types (landing/pricing/about/product/checkout/dashboard/blog/contact/login/portfolio). Claude preferred; OpenAI fallback. Download as HTML or open in new tab."
  },
  {
    "key": "create.pitch_deck_builder",
    "name": "Pitch Deck Builder",
    "domain": "create",
    "alsoIn": [],
    "archetype": "planning",
    "agentType": "orchestration",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates a fully-structured pitch deck as JSON slide objects. Converts to downloadable PPTX (investor/sales/marketing/product/internal). Also converts Creator Studio storyboard frames directly to PPTX."
  },
  {
    "key": "create.ai_persona_studio",
    "name": "AI Persona Studio",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "openai"
    ],
    "description": "Design and manage virtual AI influencer personas: name, niche, appearance prompt, personality, content voice, posting style. AI Build auto-generates a full character from just a niche description. DALL-E 3 avatar generation. Platform-specific content generation in the persona&#x27;s voice."
  },
  {
    "key": "create.e_commerce_product_video",
    "name": "E-commerce Product Video",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Generates a 6-scene product video storyboard optimised for conversion: hook, scene breakdown (shot type, action, voiceover, text overlay, duration), CTA, ready-to-post caption, and hashtags. Links to a saved AI Persona as the presenter."
  },
  {
    "key": "create.brand_deal_pipeline",
    "name": "Brand Deal Pipeline",
    "domain": "create",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Kanban pipeline for influencer brand deals across 7 statuses (inquiry → negotiating → accepted → active → completed → rejected → paused). Track deal value, deliverables, deadlines. AI pitch generator writes initial pitch, follow-up, or counter-offer emails."
  },
  {
    "key": "seo.search_console_data",
    "name": "Search Console Data (GSC-Style)",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo"
    ],
    "description": "DataForSEO-powered equivalent of Google Search Console. Enter any domain to see: estimated clicks (ETV), impressions (search volume), CTR (position-curve estimate), avg position, position distribution (Top 3 / 4–10 / 11–20 / 21–30), monthly trend chart, sortable keyword table with position badges and 6-month sparklines, and pages breakdown grouped by URL."
  },
  {
    "key": "seo.geo_audit",
    "name": "GEO Audit (AI Search Visibility)",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity"
    ],
    "description": "Tests whether your brand and content are being cited by AI search engines — ChatGPT, Perplexity, Google SGE. Measures citation rate, brand mention frequency, and content coverage across AI-generated answers."
  },
  {
    "key": "seo.seo_content_brief_studio",
    "name": "SEO Content Brief Studio",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "content_generation",
    "agentType": "embedded",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo",
      "firecrawl",
      "openai"
    ],
    "description": "Enter a target keyword → DataForSEO pulls the top SERP results → Firecrawl scrapes each competitor page → GPT-4o-mini synthesises a complete content brief: target word count, required headings, semantic keywords, questions to answer, content gaps vs. competitors, related keywords."
  },
  {
    "key": "seo.content_score_auto_optimize",
    "name": "Content Score Auto-Optimize",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Scores any existing content against ranking signals. Returns a content health score, weaknesses, and AI-generated rewrites or additions for underperforming sections. Can auto-apply improvements."
  },
  {
    "key": "seo.keyword_explorer",
    "name": "Keyword Explorer",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "dataforseo",
      "google_trends"
    ],
    "description": "DataForSEO Labs keyword research: overview (search volume, keyword difficulty, CPC, intent) plus 5–50 keyword ideas per seed term. 15-country support."
  },
  {
    "key": "seo.full_site_seo_crawler",
    "name": "Full-Site SEO Crawler",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Crawls your entire website, checking every page against the same 17-point audit checklist as the On-Page Auditor. Returns a site-wide score with worst-offending pages ranked by issue severity."
  },
  {
    "key": "seo.keyword_page_map",
    "name": "Keyword-Page Map",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Maps your target keywords to the pages on your site best positioned to rank for them. Identifies keyword cannibalisation (multiple pages targeting the same keyword) and coverage gaps (keywords with no good target page)."
  },
  {
    "key": "seo.internal_link_suggester",
    "name": "Internal Link Suggester",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "Analyses your site&#x27;s content and suggests internal link opportunities — which pages should link to which, with suggested anchor text."
  },
  {
    "key": "seo.local_seo",
    "name": "Local SEO (Google Maps)",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "google_maps"
    ],
    "description": "Manages your local SEO presence — Google Business Profile optimisation, local keyword targeting, NAP consistency, and local citation building."
  },
  {
    "key": "seo.google_maps_competitor_intel",
    "name": "Google Maps Competitor Intel",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [
      "perplexity",
      "openai",
      "google_maps"
    ],
    "description": "Uses Perplexity to research 12–20 local competitor businesses from Google Maps data for any keyword + region. GPT-4o-mini generates a market summary: density, average rating benchmark, market maturity, opportunities, threats. Competitor table sortable by rating and review count."
  },
  {
    "key": "seo.seo_roadmap",
    "name": "SEO Roadmap",
    "domain": "seo",
    "alsoIn": [],
    "archetype": "analysis",
    "agentType": "input_heavy",
    "irreversible": false,
    "requiresContext": true,
    "entryAutonomy": 1,
    "autonomyCeiling": 3,
    "integrations": [],
    "description": "9-step guided SEO implementation roadmap. Each step has clear instructions, tools to use, and success criteria."
  }
];
