// Single source of truth for the dashboard navigation.
//
// `NAV_GROUPS` mirrors the legacy `<nav id="navbar">` in index.html exactly
// (group order, section headers, every `data-view`, icon and label). The React
// <Navbar/> renders from it, and the route<->view maps are derived from it so
// hard-navigation (e.g. /analyse/competitors) resolves to the right `data-view`
// panel and clicking a nav link can `router.push` the matching URL.

export interface NavItem {
  /** The legacy `data-view` id (omitted for action-only items). */
  view?: string;
  label: string;
  /** Emoji icon shown in `.ndl-icon`. */
  icon: string;
  /** Non-navigation items that call a global instead of navigateTo. */
  action?: "dashboardDiag" | "wpConnect";
  /** Extra class on the `<a>` (e.g. nav-link-intel). */
  className?: string;
  /** DOM id (e.g. navAdminLink). */
  id?: string;
  /** Hover title. */
  title?: string;
  /** Render hidden (display:none) — shown later by legacy scripts. */
  hidden?: boolean;
}

export interface NavSection {
  header?: string;
  items: NavItem[];
}

export interface NavFooter {
  /** data-open-group target. */
  group: string;
  /** Raw inner HTML of the `.nav-drop-next` anchor. */
  html: string;
}

export interface NavGroupDef {
  key: string;
  label: string;
  /** Full <svg> markup for the group button icon. */
  icon: string;
  /** Right-aligned dropdown (adds nav-dropdown-right). */
  dropdownRight?: boolean;
  /** Render a `.ngb-sep` after this group. */
  sepAfter?: boolean;
  sections: NavSection[];
  footer?: NavFooter;
}

const SVG = {
  analyse:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5.8" cy="5.8" r="4.3" stroke="currentColor" stroke-width="1.5"/><path d="M9.2 9.2L13 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3.8 5.8h4M5.8 3.8v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  create:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.8 1.4 L12.6 4.2 L4.8 12 L1.4 12.6 L2 9.2 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 3.2l2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 1l1 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  reach:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="9.5" r="1.5" fill="currentColor"/><path d="M4.2 7a4 4 0 015.6 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.6 4.4a7 7 0 0110.8 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  grow:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 11L5 6.5L8 9L13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 3H13V6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  manage:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1.5l1.6 3.4 3.7.5-2.7 2.6.7 3.7L7 9.9 3.7 11.7l.7-3.7L1.7 5.4l3.7-.5L7 1.5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/></svg>',
  aiTeam:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="4.2" cy="5" r="1.8" stroke="currentColor" stroke-width="1.3"/><circle cx="9.8" cy="5" r="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M1.2 11.5c.3-1.6 1.6-2.6 3-2.6s2.7 1 3 2.6M6.8 11.5c.3-1.6 1.6-2.6 3-2.6s2.7 1 3 2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

export const NAV_GROUPS: NavGroupDef[] = [
  {
    key: "analyse",
    label: "Analyse",
    icon: SVG.analyse,
    sepAfter: true,
    sections: [
      {
        header: "1 · Start here",
        items: [
          { view: "dashboard", icon: "📊", label: "Dashboard" },
          {
            action: "dashboardDiag",
            icon: "🧪",
            label: "Dashboard Diag (replay)",
            title:
              "DIAGNOSTIC: launch the dashboard from the last captured Analyse payload — no API calls, no waiting. Run Analyse Now once on any domain to seed the cache.",
          },
          { view: "roadmap", icon: "🗺️", label: "Get Started Roadmap" },
        ],
      },
      {
        header: "2 · Know your competition",
        items: [
          { view: "competitors", icon: "🏆", label: "Competitor Profiles" },
          { view: "battle-cards", icon: "🛡️", label: "Battle Cards" },
          { view: "battleplan", icon: "⚔️", label: "Battle Plan" },
          { view: "intelligence", icon: "🧠", label: "Intelligence Hub", className: "nav-link-intel" },
          { view: "war-room", icon: "⚔️", label: "AI Competitor War Room" },
          { view: "biz-scanner", icon: "🔭", label: "Business Acquisition Scanner" },
          { view: "benchmarks", icon: "📊", label: "Benchmark Intelligence (vs network)" },
        ],
      },
      {
        header: "3 · Spy on what they're doing",
        items: [
          { view: "ad-library", icon: "🕵️", label: "Ad Library Spy" },
          { view: "organic-social", icon: "📱", label: "Organic Social Monitor" },
          { view: "linkedin-ads", icon: "🔷", label: "LinkedIn Ad Spy" },
          { view: "ad-swipe", icon: "💾", label: "Ad Swipe File" },
          { view: "tech-stack", icon: "🧱", label: "Tech Stack Detector" },
          { view: "pricing-watch", icon: "💰", label: "Pricing Watcher" },
          { view: "job-board-spy", icon: "💼", label: "Hiring Spy (Job Boards)" },
          { view: "maps-intel", icon: "🗺️", label: "Maps Intel (local competitors)" },
          { view: "change-monitor", icon: "🔔", label: "Change Monitor (page alerts)" },
          { view: "web-extractor", icon: "🧲", label: "AI Web Extractor" },
          { view: "recipe-scraper", icon: "📋", label: "Scraping Recipe Library" },
          { view: "dataset-market", icon: "📦", label: "Dataset Marketplace" },
          { view: "resilient-tracker", icon: "🛡️", label: "Resilient Tracker" },
        ],
      },
      {
        header: "4 · Read the market",
        items: [
          { view: "sov-tracker", icon: "📈", label: "Share of Voice" },
          { view: "trending-topics", icon: "🔥", label: "Trending Topics" },
          { view: "crisis-radar", icon: "🚨", label: "Crisis Radar" },
        ],
      },
      {
        header: "5 · Understand your customers",
        items: [
          { view: "icp-studio", icon: "🎯", label: "ICP Studio (your buyer)" },
          { view: "voc", icon: "🗣️", label: "Voice of Customer" },
          { view: "review-aggregator", icon: "⭐", label: "Review Aggregator" },
          { view: "glassdoor", icon: "🏢", label: "Glassdoor Sentiment" },
        ],
      },
      {
        header: "6 · Listen for mentions",
        items: [
          { view: "mentions", icon: "📰", label: "Web & News Mentions" },
          { view: "reddit", icon: "🔴", label: "Reddit Research" },
          { view: "reddit-pulse", icon: "👽", label: "Reddit Live Pulse" },
          { view: "twitter-pulse", icon: "🐦", label: "X / Twitter Pulse" },
          { view: "youtube-monitor", icon: "▶️", label: "YouTube Monitor" },
          { view: "yt-comment-miner", icon: "💬", label: "Comment Miner (content ideas)" },
          { view: "podcast-monitor", icon: "🎙️", label: "Podcast Monitor" },
          { view: "quora-mining", icon: "❓", label: "Quora Q&A Mining" },
          { view: "newsletter-tracker", icon: "📧", label: "Newsletter Tracker" },
        ],
      },
      {
        header: "7 · Brand intelligence",
        items: [
          { view: "reputation-score", icon: "⭐", label: "Reputation Score" },
          { view: "presence-score",   icon: "📡", label: "Presence Score" },
          { view: "ave",              icon: "💵", label: "Media Value (AVE)" },
          { view: "anomaly-detector", icon: "🔍", label: "AI Anomaly Detector" },
          { view: "intent-radar",     icon: "🎯", label: "Intent Radar" },
          { view: "hashtag-tracker",  icon: "🏷️", label: "Hashtag Tracker" },
          { view: "influence-score",  icon: "🏆", label: "Influence Score" },
          { view: "project-compare",  icon: "⚖️", label: "Project Comparison" },
          { view: "geo-insights",     icon: "🌍", label: "Geolocation Insights" },
          { view: "ugc-discovery",    icon: "📸", label: "UGC Discovery" },
        ],
      },
      {
        header: "8 · Find search opportunity",
        items: [
          { view: "keyword-explorer", icon: "🔬", label: "Keyword Explorer" },
          { view: "question-miner", icon: "❔", label: "Question Mining (What people ask)" },
          { view: "social-listening", icon: "👂", label: "Social Listening" },
          { view: "media-intel", icon: "📰", label: "Media Intelligence" },
          { view: "keyword-map", icon: "🗺️", label: "Keyword Map" },
          { view: "intent-map", icon: "🧭", label: "Search Intent Map" },
          { view: "content-gaps", icon: "🧩", label: "Content Gaps vs Rivals" },
          { view: "serp", icon: "🔎", label: "Live Google SERP" },
          { view: "serp-tracker", icon: "📍", label: "SERP Rank Tracker" },
          { view: "google-trends", icon: "📈", label: "Google Trends" },
          { view: "bing-webmaster", icon: "🔷", label: "Bing Webmaster Tools" },
        ],
      },
      {
        header: "8 · Backlinks",
        items: [
          { view: "backlinks", icon: "🔗", label: "Backlink Explorer" },
          { view: "backlink-monitor", icon: "🛰️", label: "Backlink Health Monitor" },
          { view: "link-prospector", icon: "🎯", label: "Link Prospector" },
        ],
      },
    ],
    footer: {
      group: "create",
      html: 'Now you know the market — <strong>Create</strong> something to say<span class="ndn-arrow">→</span>',
    },
  },
  {
    key: "create",
    label: "Create",
    icon: SVG.create,
    sepAfter: true,
    sections: [
      {
        header: "1 · Brand foundations",
        items: [
          { view: "brand-assets", icon: "🖼️", label: "Brand Assets (logo · colours)" },
          { view: "templates", icon: "📐", label: "Templates Library" },
          { view: "studio", icon: "🎭", label: "Creator Studio (all-in-one)" },
        ],
      },
      {
        header: "2 · Write the message",
        items: [
          { view: "content", icon: "🧠", label: "Content AI (blogs · long-form)" },
          { view: "headline-tester", icon: "🎯", label: "Headline Tester" },
          { view: "press-release", icon: "📰", label: "Press Release Writer" },
          { view: "cold-email", icon: "✉️", label: "Cold Email Writer" },
          { view: "email-personalizer", icon: "📨", label: "Email Personalizer (1-to-1)" },
          { view: "email-broadcast", icon: "📧", label: "Email Broadcast + Tracking" },
          { view: "whatsapp", icon: "💬", label: "WhatsApp Channel" },
          { view: "voice-caller", icon: "📞", label: "AI Voice Caller" },
          { view: "reply-assistant", icon: "📩", label: "Reply Assistant (inbound)" },
          { view: "localization", icon: "🌍", label: "Localization (40+ langs)" },
        ],
      },
      {
        header: "3 · Design the visuals",
        items: [
          { view: "creative", icon: "🖌️", label: "AI Creative (single ad)" },
          { view: "smart-creative", icon: "✨", label: "Smart Creative Builder (multi)" },
          { view: "carousel", icon: "🎠", label: "Carousel Generator" },
          { view: "canva", icon: "🎨", label: "Canva Template Launcher" },
          { view: "ugc-avatars", icon: "🧑‍🎤", label: "UGC Avatar Videos" },
          { view: "video-script", icon: "🎬", label: "Video Script Generator" },
          { view: "voiceover", icon: "🔊", label: "AI Voiceovers" },
          { view: "creative-intel", icon: "💡", label: "Creative Intel (what performs)" },
          { view: "infographics", icon: "🖼️", label: "Infographic Generator" },
        ],
      },
      {
        header: "4 · Build pages & bots",
        items: [
          { view: "landing-pages", icon: "🚀", label: "AI Landing Pages (A/B · leads · ad package)" },
          { view: "landing-builder", icon: "🌐", label: "Landing Page Builder" },
          { view: "site-builder", icon: "🧱", label: "Site Builder (multi-page)" },
          { view: "linksell", icon: "🛒", label: "Link-in-Bio + Stripe" },
          { view: "schema-generator", icon: "🏷️", label: "SEO Schema Generator" },
          { view: "chatbot-builder", icon: "🤖", label: "Chatbot Builder" },
        ],
      },
      {
        header: "5 · Plan the campaign",
        items: [
          { view: "campaigns", icon: "🚀", label: "Campaign Strategy" },
          { view: "content-calendar", icon: "🗓️", label: "Content Calendar" },
          { view: "content-modes", icon: "✍️", label: "Content Modes" },
          { view: "content-autopilot", icon: "🤖", label: "Content Autopilot" },
          { view: "ad-creative", icon: "🎨", label: "Ad Creative Gen" },
          { view: "idea-feed", icon: "💡", label: "Idea Swipe Feed" },
          { view: "pitch-deck", icon: "📊", label: "Pitch Deck Builder" },
          { view: "wireframe", icon: "📐", label: "Wireframe Generator" },
          { view: "ab-designer", icon: "🧪", label: "A/B Test Designer" },
          { view: "persona-studio", icon: "🎭", label: "AI Persona Studio" },
          { view: "ecom-video", icon: "🛒", label: "Product Video" },
        ],
      },
    ],
    footer: {
      group: "reach",
      html: 'Assets are ready — push them out via <strong>Reach</strong><span class="ndn-arrow">→</span>',
    },
  },
  {
    key: "reach",
    label: "Reach",
    icon: SVG.reach,
    sepAfter: true,
    sections: [
      {
        header: "1 · Build the audience",
        items: [
          { view: "audience", icon: "🎯", label: "Audience Builder (start)" },
          { view: "lookalike", icon: "👥", label: "Lookalike Audiences" },
          { view: "audiences-dynamic", icon: "🔄", label: "Dynamic Audiences (live)" },
          { view: "journey-builder", icon: "🛤️", label: "Customer Journey Builder" },
          { view: "surveys", icon: "📋", label: "In-App Survey Builder" },
          { view: "email-designer", icon: "🎨", label: "Visual Email Designer" },
          { view: "ai-segments", icon: "🧠", label: "AI Segment Suggestions" },
          { view: "audience-ad-sync", icon: "📡", label: "Audience → Ad Platform Sync (Meta / Google)" },
          { view: "omnichannel", icon: "📡", label: "Omnichannel Composer (Email · SMS · WhatsApp · Voice · Push)" },
          { view: "smart-send", icon: "⏰", label: "Smart Send Time Optimizer" },
          { view: "translate", icon: "🌍", label: "AI Campaign Translator" },
        ],
      },
      {
        header: "2 · Find & qualify leads",
        items: [
          { view: "lead-gen", icon: "🧲", label: "Lead Generation" },
          { view: "bookings", icon: "📅", label: "Bookings (public scheduler)" },
          { view: "lead-qualifier", icon: "✅", label: "Lead Qualifier (AI score)" },
          { view: "hubspot-sync", icon: "🔁", label: "HubSpot CRM Sync" },
          { view: "crm-sync", icon: "🔄", label: "CRM Sync (ActiveCampaign · ConvertKit)" },
          { view: "hunter", icon: "🎯", label: "Hunter.io Email Finder" },
        ],
      },
      {
        header: "3 · Launch paid ads",
        items: [
          { view: "advertise", icon: "📣", label: "Advertise Hub (Meta · Google · TikTok)" },
          { view: "import-campaigns", icon: "📥", label: "Import Existing Campaigns" },
          { view: "opt-folders", icon: "📁", label: "Campaign Folders" },
          { view: "conversion-boosters", icon: "⚡", label: "Conversion Boosters (popups)" },
        ],
      },
      {
        header: "4 · Publish organically",
        items: [
          { view: "social-publisher", icon: "📤", label: "Social Publisher (15 platforms)" },
          { view: "discovery", icon: "🔭", label: "Influencer Discovery" },
          { view: "influencers", icon: "🌟", label: "Influencer CRM" },
          { view: "tiktok-downloader", icon: "⬇️", label: "TikTok Asset Downloader" },
          { view: "hashtag-intel", icon: "🏷️", label: "Hashtag Intelligence (Instagram & TikTok)" },
        ],
      },
      {
        header: "5 · Get found in search & AI",
        items: [
          { view: "search-intel", icon: "🔮", label: "AI Visibility & Search Pulse" },
          { view: "geo-audit", icon: "🛸", label: "GEO Audit (ChatGPT · Perplexity)" },
          { view: "local-seo", icon: "📍", label: "Local SEO (Google Maps)" },
          { view: "seo-auditor", icon: "🧭", label: "On-Page SEO Audit" },
          { view: "content-score", icon: "📊", label: "Content Score Auto-Optimize" },
          { view: "seo-crawler", icon: "🕸️", label: "Full-Site SEO Crawler" },
          { view: "seo-roadmap", icon: "🗺️", label: "SEO Roadmap (9-step guide)" },
          { view: "web-vitals", icon: "⏱️", label: "Web Vitals (page speed)" },
          { view: "accessibility", icon: "♿", label: "Accessibility Audit" },
          { view: "social-tags", icon: "🔖", label: "Social Tags Audit" },
          { view: "deliverability", icon: "✉️", label: "Email Deliverability Audit" },
          { view: "seo-tasks", icon: "📋", label: "SEO Task Manager" },
          { view: "seo-widget", icon: "🧩", label: "Embeddable Lead-Gen Widget" },
        ],
      },
      {
        header: "6 · First-party data spine",
        items: [
          { view: "identity-spine", icon: "🪪", label: "Identity Spine (CDP · LTV · propensity)" },
          { view: "mcp-server", icon: "🔌", label: "MCP Server (AI tool integrations)" },
        ],
      },
      {
        header: "7 · Handle replies & alerts",
        items: [
          { view: "unified-inbox", icon: "📬", label: "Unified Inbox" },
          { view: "alert-routing", icon: "🔔", label: "Alert Routing" },
          { view: "inbox-monitor", icon: "📬", label: "Inbox Placement Monitor" },
        ],
      },
    ],
    footer: {
      group: "grow",
      html: 'Campaigns live — measure & <strong>Grow</strong> what works<span class="ndn-arrow">→</span>',
    },
  },
  {
    key: "grow",
    label: "Grow",
    icon: SVG.grow,
    dropdownRight: true,
    sepAfter: false,
    sections: [
      {
        header: "1 · Set the targets",
        items: [
          { view: "goals", icon: "🎯", label: "Goals & Targets" },
          { view: "kpi-tracker", icon: "📈", label: "KPI Tracker (live)" },
          { view: "action-center", icon: "🎬", label: "Action Center (do this next)" },
        ],
      },
      {
        header: "2 · See ad performance",
        items: [
          { view: "meta-insights", icon: "📘", label: "Meta Ads Insights" },
          { view: "google-ads-insights", icon: "🅖", label: "Google Ads Insights" },
          { view: "tiktok-ads-insights", icon: "🎵", label: "TikTok Ads Insights" },
          { view: "social-analytics", icon: "📊", label: "Organic Social Analytics" },
          { view: "post-performance", icon: "📈", label: "Post Performance" },
          { view: "optimizer", icon: "🤖", label: "AI Campaign Optimizer (auto)" },
          { view: "ad-comment-monitor", icon: "💬", label: "Ad Comment Monitor (Meta)" },
          { view: "auto-operator", icon: "🦾", label: "Autonomous Marketing Operator" },
          { view: "safe-agent", icon: "🛡️", label: "Safe Agent (propose → approve → execute)" },
        ],
      },
      {
        header: "3 · Track full-funnel ROI",
        items: [
          { view: "analytics-hub", icon: "📡", label: "GSC & GA4 Hub" },
          { view: "amplitude-agents", icon: "📶", label: "Amplitude AI Agents" },
          { view: "blended-perf", icon: "💎", label: "Blended Performance (CAC)" },
          { view: "attribution", icon: "🧮", label: "Attribution Modeling" },
          { view: "true-roas", icon: "💰", label: "True ROAS (margin-aware)" },
          { view: "iroas", icon: "📊", label: "iROAS Incrementality" },
          { view: "conversion-recovery", icon: "🔄", label: "Conversion Recovery (CAPI)" },
          { view: "churn-scorer", icon: "⚠️", label: "Churn-Risk Scorer" },
          { view: "revenue-forecast", icon: "💹", label: "AI Revenue Forecast Engine" },
          { view: "digital-twin", icon: "🪞", label: "Digital Twin (what-if simulator)" },
          { view: "mmm", icon: "🎛️", label: "Media Mix Modeler (optimal allocation)" },
        ],
      },
      {
        header: "4 · Improve SEO & content",
        items: [
          { view: "autoseo", icon: "🚀", label: "AutoSEO Pro (autonomous)" },
          { view: "contentscorer", icon: "📝", label: "Content Scorer" },
          { view: "link-suggester", icon: "🔗", label: "Internal Link Suggester" },
          { view: "cro-lab", icon: "🧪", label: "CRO Lab (page tests)" },
          { view: "ai-audit-suite", icon: "🔬", label: "AI Audit Suite (deep)" },
          { view: "vis-leaderboard", icon: "🏆", label: "Visibility Rank Table (Δ)" },
          { action: "wpConnect", icon: "🟦", label: "Connect to WordPress" },
        ],
      },
    ],
    footer: {
      group: "manage",
      html: 'Time to schedule, report & <strong>Manage</strong> the team<span class="ndn-arrow">→</span>',
    },
  },
  {
    key: "manage",
    label: "Manage",
    icon: SVG.manage,
    dropdownRight: true,
    sepAfter: true,
    sections: [
      {
        header: "1 · Calendars & projects",
        items: [
          { view: "new-project", icon: "✨", label: "+ New Marketing Project" },
          { view: "master-calendar", icon: "🗓️", label: "Master Calendar (everything)" },
          { view: "brand-calendar", icon: "📅", label: "Brand Calendar (10 categories)" },
          { view: "social", icon: "📅", label: "Social Calendar" },
          { view: "launches", icon: "🚀", label: "Product Launch Calendar" },
        ],
      },
      {
        header: "2 · Monitor performance",
        items: [
          { view: "web-analytics", icon: "📈", label: "Web Analytics (acquisition + behaviour)" },
          { view: "ai-traffic", icon: "📡", label: "AI Traffic Monitor" },
          { view: "heatmaps", icon: "🔥", label: "Heatmaps + Session Replay" },
          { view: "action-queue", icon: "🚀", label: "Daily Action Queue (what to do today)" },
          { view: "marketing-okr", icon: "🎯", label: "Marketing OKRs (live campaign data)" },
          { view: "budget-board", icon: "💰", label: "Budget Board (monitor + spend)" },
        ],
      },
      {
        header: "3 · AI tools & config",
        items: [
          { view: "ask-infogenie", icon: "💬", label: "Ask InfoGenie (your data)" },
          { view: "marketing-memory", icon: "🧠", label: "Marketing Memory (knowledge graph)" },
          { view: "predictive-intelligence", icon: "🔮", label: "Predictive Intelligence (90-day AI forecast)" },
          { view: "agent-goals", icon: "🤖", label: "AI Marketing Agent" },
          { view: "ai-providers", icon: "🧠", label: "AI Providers (bring your own LLM)" },
          { view: "model-compare", icon: "⚖️", label: "Model Comparison (A/B prompts)" },
          { view: "vertical-playbooks", icon: "📋", label: "Vertical Playbooks (industry packs)" },
        ],
      },
      {
        header: "4 · Team & frameworks",
        items: [
          { view: "meeting-notes", icon: "📝", label: "Meeting Notes" },
          { view: "team-meetings", icon: "📋", label: "Minutes of Meeting (AI Team)" },
          { view: "playbook-7day", icon: "📖", label: "7-Day Marketing Playbook" },
          { view: "growth-methodology", icon: "🎯", label: "Growth Methodology (5-stage)" },
          { view: "flywheel", icon: "🌀", label: "Performance Growth Flywheel" },
        ],
      },
      {
        header: "5 · Run the customer ops",
        items: [
          { view: "reengage", icon: "🔁", label: "Re-Engage Customers (drip)" },
          { view: "automations", icon: "⚙️", label: "Automations" },
          { view: "employee-advocacy", icon: "📣", label: "Employee Advocacy" },
          { view: "signal-triggers", icon: "⚡", label: "Real-time Signal Triggers" },
          { view: "stakeholders", icon: "👤", label: "Stakeholders" },
          { view: "brand-deals", icon: "🤝", label: "Brand Deal Pipeline" },
        ],
      },
      {
        header: "6 · Send reports",
        items: [
          { view: "results", icon: "📊", label: "Results Snapshot" },
          { view: "weekly-report", icon: "📑", label: "Weekly Report" },
          { view: "cross-channel", icon: "🌐", label: "Cross-Channel Report" },
          { view: "csuite", icon: "👔", label: "C-Suite Reports (CEO · CMO · CFO)" },
          { view: "investor-mode", icon: "📈", label: "Investor Mode (portal + forecasts)" },
          { view: "white-label", icon: "🎨", label: "White-Label Reports" },
          { view: "bulk-reports", icon: "📦", label: "Bulk Reporting (multi-client)" },
          { view: "digest", icon: "🌅", label: "Daily Digest Email" },
        ],
      },
      {
        header: "7 · Account & admin",
        items: [
          { view: "agency", icon: "🏢", label: "Agency Workspace" },
          { view: "marketplace", icon: "🛍️", label: "AI Marketing Marketplace" },
          { view: "workspaces", icon: "👥", label: "Workspaces & Team" },
          { view: "admin", icon: "🛡️", label: "Admin Portal", id: "navAdminLink", hidden: true },
          { view: "technical-suite", icon: "🛠️", label: "Technical Suite" },
          { view: "brand-safety", icon: "🔒", label: "Brand Safety & Compliance" },
          { view: "data-provenance", icon: "🔍", label: "Data Provenance (audit trail)" },
          { view: "settings", icon: "⚙️", label: "Settings & Integrations" },
        ],
      },
    ],
    footer: {
      group: "analyse",
      html: 'Loop back to <strong>Analyse</strong> — what changed this week?<span class="ndn-arrow">↻</span>',
    },
  },
  {
    key: "ai-team",
    label: "AI Team",
    icon: SVG.aiTeam,
    dropdownRight: true,
    sepAfter: false,
    sections: [
      {
        header: "Your AI executive team",
        items: [{ view: "ai-team", icon: "👥", label: "Team Roster" }],
      },
      {
        header: "Officers",
        items: [
          { view: "finance-officer", icon: "💼", label: "Finance Officer" },
          { view: "ops-officer", icon: "🛠️", label: "Operations Officer" },
        ],
      },
    ],
  },
];

// ── Derived routing maps ────────────────────────────────────────────────────
// `view` -> canonical path (`/<group>/<view>`) and the reverse lookup.
export const VIEW_TO_PATH: Record<string, string> = {};
export const ALL_VIEW_IDS = new Set<string>();

for (const group of NAV_GROUPS) {
  for (const section of group.sections) {
    for (const item of section.items) {
      if (item.view) {
        ALL_VIEW_IDS.add(item.view);
        VIEW_TO_PATH[item.view] = `/${group.key}/${item.view}`;
      }
    }
  }
}

/** Canonical dashboard URL for a `data-view` id, or `/` if unknown. */
export function viewToPath(view: string): string {
  return VIEW_TO_PATH[view] || "/";
}

/**
 * Legacy view IDs that have been consolidated into a hub view.
 * Any deep-link or bookmark to an old ID resolves to the hub so existing
 * links degrade gracefully instead of landing on the home screen.
 */
export const VIEW_ID_ALIASES: Record<string, string> = {
  "lead-finder":       "lead-gen",
  "local-leads":       "lead-gen",
  "lead-aggregator":   "lead-gen",
  "acquisition-engine":"lead-gen",
};

/**
 * Resolve a dashboard pathname to its `data-view` id. The group segment is
 * cosmetic — the last path segment is the view id, accepted only if it's a real
 * nav view (or a known alias). Returns null for `/` (which maps to the legacy
 * 'home' view).
 */
export function pathToViewId(pathname: string): string | null {
  if (!pathname || pathname === "/") return null;
  const segs = pathname.split("/").filter(Boolean);
  if (!segs.length) return null;
  const last = segs[segs.length - 1];
  if (ALL_VIEW_IDS.has(last)) return last;
  // Gracefully redirect retired view IDs to their replacement hub.
  return VIEW_ID_ALIASES[last] ?? null;
}
