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
        header: "1 · Project overview",
        items: [
          { view: "dashboard", icon: "📊", label: "Dashboard" },
          { view: "roadmap", icon: "🗺️", label: "Get Started Roadmap" },
        ],
      },
      {
        header: "2 · Rankings & search",
        items: [
          { view: "serp-tracker", icon: "📍", label: "Rank Tracker" },
          { view: "keyword-explorer", icon: "🔬", label: "Keyword Explorer" },
          { view: "content-gaps", icon: "🧩", label: "Content Gaps vs Rivals" },
          { view: "serp", icon: "🔎", label: "Live Google SERP" },
        ],
      },
      {
        header: "3 · Analytics & traffic",
        items: [
          { view: "analytics-hub", icon: "📈", label: "Analytics Hub" },
          { view: "sov-tracker", icon: "📉", label: "Share of Voice" },
          { view: "visitor-intel", icon: "🔍", label: "Visitor Intelligence" },
        ],
      },
      {
        header: "4 · Competitors",
        items: [
          { view: "competitors", icon: "🏆", label: "Competitor Profiles" },
          { view: "battleplan", icon: "⚔️", label: "Marketing Plan / Battle Plan" },
          { view: "battle-cards", icon: "🛡️", label: "Battle Cards" },
          { view: "intelligence", icon: "🧠", label: "Intelligence Hub", className: "nav-link-intel" },
          { view: "war-room", icon: "🗡️", label: "AI Competitor War Room" },
          { view: "ad-library", icon: "🕵️", label: "Ad Library Spy" },
          { view: "benchmarks", icon: "📶", label: "Benchmark Intelligence" },
        ],
      },
      {
        header: "5 · AI search & mentions",
        items: [
          { view: "geo-audit", icon: "🛸", label: "AI Results / GEO Audit" },
          { view: "aeo-optimizer", icon: "💬", label: "Answer Engine Optimization (AEO)" },
          { view: "zero-click-hub", icon: "👁️", label: "Zero-Click Hub (snippets · PAA · AI Overview)" },
          { view: "voice-seo", icon: "🎙️", label: "Voice Search SEO" },
          { view: "mentions", icon: "🌐", label: "Mentions Hub" },
          { view: "social-listening", icon: "👂", label: "Social Listening" },
          { view: "media-intel", icon: "📰", label: "Media Intelligence" },
          { view: "realtime-news", icon: "🗞️", label: "Real-Time News" },
          { view: "crisis-radar", icon: "🚨", label: "Crisis Radar" },
        ],
      },
      {
        header: "6 · Backlinks & site health",
        items: [
          { view: "backlinks", icon: "🔗", label: "Backlink Explorer" },
          { view: "backlink-monitor", icon: "🛰️", label: "Backlink Health Monitor" },
          { view: "seo-auditor", icon: "🧭", label: "Website Audit" },
          { view: "change-monitor", icon: "🔔", label: "Page Changes Monitor" },
          { view: "semrush", icon: "📟", label: "Semrush Intel" },
          { view: "ahrefs", icon: "🕵️‍♂️", label: "Ahrefs Intel" },
        ],
      },
      {
        header: "7 · Customers & brand",
        items: [
          { view: "icp-studio", icon: "🎯", label: "ICP Studio" },
          { view: "voc", icon: "🗣️", label: "Voice of Customer" },
          { view: "review-aggregator", icon: "⭐", label: "Review Aggregator" },
          { view: "reputation-score", icon: "🌟", label: "Reputation Score" },
          { view: "presence-score", icon: "📡", label: "Presence Score" },
          { view: "organic-social", icon: "📱", label: "Organic Social Monitor" },
          { view: "tech-stack", icon: "🧱", label: "Tech Stack Detector" },
          { view: "pricing-watch", icon: "💰", label: "Pricing Watcher" },
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
        header: "2 · Content Studio",
        items: [
          { view: "content-studio", icon: "🧬", label: "Content Studio — start here" },
          { view: "content", icon: "✍️", label: "Content AI (blogs · long-form)" },
          { view: "content-autopilot", icon: "🦾", label: "Content Autopilot" },
          { view: "bulk-rewriter", icon: "🖊️", label: "Bulk Content Rewriter" },
          { view: "headline-tester", icon: "🏹", label: "Headline Tester" },
          { view: "press-release", icon: "📄", label: "Press Release Writer" },
          { view: "cold-email", icon: "✉️", label: "Cold Email Writer" },
          { view: "email-personalizer", icon: "📨", label: "Email Personalizer (1-to-1)" },
        ],
      },
      {
        header: "3 · Lifecycle email",
        items: [
          { view: "lifecycle-email", icon: "📧", label: "Lifecycle Email — start here" },
          { view: "newsletter-studio", icon: "📰", label: "Newsletter Studio" },
          { view: "email-broadcast", icon: "📨", label: "Email Broadcast + Tracking" },
          { view: "email-analytics", icon: "🖥️", label: "Email Campaign Analytics" },
          { view: "whatsapp", icon: "💬", label: "WhatsApp Channel" },
          { view: "voice-caller", icon: "📞", label: "AI Voice Caller" },
          { view: "reply-assistant", icon: "📩", label: "Reply Assistant (inbound)" },
          { view: "localization", icon: "🌍", label: "Localization (40+ langs)" },
        ],
      },
      {
        header: "4 · Design the visuals",
        items: [
          { view: "creative", icon: "🖌️", label: "AI Creative (single ad)" },
          { view: "smart-creative", icon: "✨", label: "Smart Creative Builder (multi)" },
          { view: "carousel", icon: "🎠", label: "Carousel Generator" },
          { view: "canva", icon: "🎨", label: "Canva Template Launcher" },
          { view: "ugc-avatars", icon: "🧑‍🎤", label: "UGC Avatar Videos" },
          { view: "video-script", icon: "🎬", label: "Video Script Generator" },
          { view: "short-form-video", icon: "📹", label: "Short-Form Video Workflow" },
          { view: "podcast-studio", icon: "🎙️", label: "Podcast Marketing Studio" },
          { view: "voiceover", icon: "🔊", label: "AI Voiceovers" },
          { view: "audio-summary", icon: "🎧", label: "Audio Summary Generator (article → MP3)" },
          { view: "creative-intel", icon: "💡", label: "Creative Intel (what performs)" },
          { view: "infographics", icon: "🏞️", label: "Infographic Generator" },
        ],
      },
      {
        header: "5 · Build pages & bots",
        items: [
          { view: "conversational-ai", icon: "🤖", label: "Conversational AI — start here" },
          { view: "landing-pages", icon: "🚀", label: "AI Landing Pages (A/B · leads · ad package)" },
          { view: "landing-builder", icon: "🌎", label: "Landing Page Builder" },
          { view: "site-builder", icon: "🏗️", label: "Site Builder (multi-page)" },
          { view: "linksell", icon: "🛒", label: "Link-in-Bio + Stripe" },
          { view: "schema-generator", icon: "🏷️", label: "SEO Schema Generator" },
          { view: "chatbot-builder", icon: "🤖", label: "Chatbot Builder" },
        ],
      },
      {
        header: "6 · Plan the campaign",
        items: [
          { view: "campaigns", icon: "🛫", label: "Campaign Strategy" },
          { view: "content-calendar", icon: "🗓️", label: "Content Calendar" },
          { view: "content-modes", icon: "✍️", label: "Content Modes" },
          { view: "ad-creative", icon: "🖍️", label: "Ad Creative Gen" },
          { view: "idea-feed", icon: "🕯️", label: "Idea Swipe Feed" },
          { view: "pitch-deck", icon: "🧮", label: "Pitch Deck Builder" },
          { view: "wireframe", icon: "📏", label: "Wireframe Generator" },
          { view: "ab-designer", icon: "🧪", label: "A/B Test Designer" },
          { view: "persona-studio", icon: "🎪", label: "AI Persona Studio" },
          { view: "ecom-video", icon: "🛍️", label: "Product Video" },
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
          { view: "audience", icon: "🔢", label: "Audience Builder (start)" },
          { view: "lookalike", icon: "👥", label: "Lookalike Audiences" },
          { view: "audiences-dynamic", icon: "🔄", label: "Dynamic Audiences (live)" },
          { view: "journey-builder", icon: "🛤️", label: "Customer Journey Builder" },
          { view: "surveys", icon: "📋", label: "In-App Survey Builder" },
          { view: "interactive-leads", icon: "🧩", label: "Interactive Lead Builder (quizzes → CRM)" },
          { view: "email-designer", icon: "🗂️", label: "Visual Email Designer" },
          { view: "ai-segments", icon: "🧿", label: "AI Segment Suggestions" },
          { view: "audience-ad-sync", icon: "📻", label: "Audience → Ad Platform Sync (Meta / Google)" },
          { view: "omnichannel", icon: "🗃️", label: "Omnichannel Composer (Email · SMS · WhatsApp · Voice · Push)" },
          { view: "smart-send", icon: "⏰", label: "Smart Send Time Optimizer" },
          { view: "translate", icon: "🌏", label: "AI Campaign Translator" },
          { view: "campaign-composer", icon: "🪄", label: "Prompt-to-Campaign Builder" },
          { view: "geofencing", icon: "📌", label: "Geofencing (location triggers)" },
        ],
      },
      {
        header: "2 · Find & qualify leads",
        items: [
          { view: "lead-gen", icon: "🧲", label: "Lead Generation" },
          { view: "bookings", icon: "📅", label: "Bookings (public scheduler)" },
          { view: "lead-qualifier", icon: "✅", label: "Lead Qualifier (AI score)" },
          { view: "hubspot-sync", icon: "🔁", label: "HubSpot CRM Sync" },
          { view: "crm-sync", icon: "♻️", label: "CRM Sync (ActiveCampaign · ConvertKit)" },
          { view: "hunter", icon: "🗄️", label: "Hunter.io Email Finder" },
          { view: "referral-manager", icon: "🌟", label: "Referral Program Manager" },
        ],
      },
      {
        header: "3 · Paid search & social",
        items: [
          { view: "paid-search-social", icon: "💳", label: "Paid Search & Social — start here" },
          { view: "advertise", icon: "📣", label: "Advertise Hub (Meta · Google · TikTok)" },
          { view: "import-campaigns", icon: "📥", label: "Import Existing Campaigns" },
          { view: "opt-folders", icon: "📁", label: "Campaign Folders" },
          { view: "conversion-boosters", icon: "⚡", label: "Conversion Boosters (popups)" },
        ],
      },
      {
        header: "4 · Social command center",
        items: [
          { view: "social-command-center", icon: "📱", label: "Social Command Center — start here" },
          { view: "social-publisher", icon: "📤", label: "Social Publisher (calendar · drafts · 15 platforms)" },
          { view: "discovery", icon: "🔭", label: "Influencer Discovery" },
          { view: "influencers", icon: "💫", label: "Influencer CRM" },
          { view: "tiktok-downloader", icon: "⬇️", label: "TikTok Asset Downloader" },
          { view: "hashtag-intel", icon: "🔖", label: "Hashtag Intelligence (Instagram & TikTok)" },
          { view: "social-commerce", icon: "🛍️", label: "Social Commerce Hub" },
        ],
      },
      {
        header: "5 · Get found in search & AI",
        items: [
          { view: "gsc-data", icon: "🧾", label: "Search Console Data" },
          { view: "search-intel", icon: "🔮", label: "AI Visibility & Search Pulse" },
          { view: "local-seo", icon: "📑", label: "Local SEO (Google Maps)" },
          { view: "local-listings", icon: "🏬", label: "Local Listings / NAP Sync" },
          { view: "content-brief", icon: "📃", label: "SEO Content Brief Studio" },
          { view: "content-score", icon: "📜", label: "Content Score Auto-Optimize" },
          { view: "seo-crawler", icon: "🕸️", label: "Full-Site SEO Crawler" },
          { view: "seo-roadmap", icon: "🗾", label: "SEO Roadmap" },
          { view: "web-vitals", icon: "⏱️", label: "Web Vitals" },
          { view: "seo-tasks", icon: "🗒️", label: "SEO Task Manager" },
        ],
      },
      {
        header: "6 · First-party data spine",
        items: [
          { view: "identity-spine", icon: "🪪", label: "Identity Spine (CDP · LTV · propensity)" },
          { view: "mcp-server", icon: "🔌", label: "MCP Ecosystem (server + client)" },
        ],
      },
      {
        header: "7 · Handle replies & alerts",
        items: [
          { view: "unified-inbox", icon: "📬", label: "Unified Inbox" },
          { view: "alert-routing", icon: "🔕", label: "Alert Routing" },
          { view: "inbox-monitor", icon: "📭", label: "Inbox Placement Monitor" },
        ],
      },
      {
        header: "8 · Next-gen messaging",
        items: [
          { view: "messaging-channels", icon: "🗃️", label: "Messaging Channels (SMS · WhatsApp · Push)" },
          { view: "push-marketing", icon: "🔔", label: "Push Notification Marketing" },
          { view: "rcs-campaigns",     icon: "💭", label: "RCS & Apple Messages (rich interactive messaging)" },
          { view: "linkedin-outreach", icon: "💼", label: "LinkedIn Outreach Automation (sequences)" },
          { view: "email-warmup",      icon: "🔥", label: "Email Warm-Up (inbox trust builder)" },
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
          { view: "agent-goals", icon: "🏁", label: "Marketing Goals (set · plan · track)" },
          { view: "growth-hub", icon: "🚀", label: "Growth Marketing — start here" },
          { view: "ecosystem-spine", icon: "🕸️", label: "Ecosystem Spine (audiences · attribution · close-loop)" },
          { view: "goals", icon: "📎", label: "Goals & Targets" },
          { view: "kpi-tracker", icon: "💹", label: "KPI Tracker (live)" },
          { view: "action-center", icon: "🎥", label: "Action Center (do this next)" },
        ],
      },
      {
        header: "2 · See ad performance",
        items: [
          { view: "meta-insights", icon: "📘", label: "Meta Ads Insights" },
          { view: "google-ads-insights", icon: "🅖", label: "Google Ads Insights" },
          { view: "tiktok-ads-insights", icon: "🎵", label: "TikTok Ads Insights" },
          { view: "social-analytics", icon: "🖇️", label: "Organic Social Analytics" },
          { view: "post-performance", icon: "⚗️", label: "Post Performance" },
          { view: "optimizer", icon: "🦿", label: "AI Campaign Optimizer (auto)" },
          { view: "lead-intelligence", icon: "🎯", label: "Lead Intelligence (GLM)" },
          { view: "remarketing-suite", icon: "🔄", label: "Remarketing Suite" },
          { view: "ad-comment-monitor", icon: "🗨️", label: "Ad Comment Monitor (Meta)" },
          { view: "auto-operator", icon: "🧫", label: "Autonomous Marketing Operator" },
          { view: "safe-agent", icon: "🔒", label: "Safe Agent (propose → approve → execute)" },
          { view: "self-healing", icon: "🩹", label: "Self-Healing Ad Accounts (AI rejection repair)" },
        ],
      },
      {
        header: "3 · Track full-funnel ROI",
        items: [
          // Analytics Hub lives under Analyse — link from dashboard/ROI tools, do not re-list here
          { view: "amplitude-agents", icon: "🥈", label: "Amplitude AI Agents" },
          { view: "blended-perf", icon: "💎", label: "Blended Performance (CAC)" },
          { view: "attribution", icon: "🥉", label: "Attribution Modeling" },
          { view: "true-roas", icon: "💵", label: "True ROAS (margin-aware)" },
          { view: "iroas", icon: "🎖️", label: "iROAS Incrementality" },
          { view: "conversion-recovery", icon: "🔃", label: "Conversion Recovery (CAPI)" },
          { view: "churn-scorer", icon: "⚠️", label: "Churn-Risk Scorer" },
          { view: "revenue-forecast", icon: "🏅", label: "AI Revenue Forecast Engine" },
          { view: "digital-twin",     icon: "🪞", label: "Digital Twin (what-if simulator)" },
          { view: "mmm",             icon: "🎛️", label: "Media Mix Modeler (optimal allocation)" },
          { view: "funnel-analytics", icon: "💥", label: "Funnel Analytics (page views · opt-ins · sales · EPC)" },
        ],
      },
      {
        header: "4 · Improve SEO & conversion",
        items: [
          { view: "conversion-lab", icon: "🧪", label: "Conversion Lab — start here" },
          { view: "seo-growth-autopilot", icon: "🚀", label: "SEO Growth Autopilot (Growth Plan)" },
          { view: "autoseo", icon: "✈️", label: "AutoSEO Pro (autonomous)" },
          { view: "contentscorer", icon: "📝", label: "Content Scorer" },
          { view: "link-suggester", icon: "⛓️", label: "Internal Link Suggester" },
          { view: "cro-lab",        icon: "💢", label: "CRO Lab (page tests)" },
          // Bulk rewriter lives under Create → Content Studio (single destination)
          { view: "ai-audit-suite", icon: "💯", label: "AI Audit Suite (deep)" },
          { view: "vis-leaderboard", icon: "🧑‍🤝‍🧑", label: "Visibility Rank Table (Δ)" },
          { action: "wpConnect", icon: "🟦", label: "Connect to WordPress" },
        ],
      },
      {
        header: "5 · Next-gen ad channels",
        items: [
          { view: "ctv-streaming", icon: "📺", label: "CTV & Streaming Audio (Roku · Hulu · Spotify)" },
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
        header: "0 · Morning Brief",
        items: [
          { view: "marketing-brief", icon: "🗯️", label: "Today's Marketing Brief — AI Director" },
        ],
      },
      {
        header: "1 · Calendars & projects",
        items: [
          { view: "new-project", icon: "👋", label: "+ New Marketing Project" },
          { view: "master-calendar", icon: "📆", label: "Master Calendar (everything)" },
          { view: "brand-calendar", icon: "🕰️", label: "Brand Calendar (10 categories)" },
          { view: "calendar-assistant", icon: "📅", label: "Calendar Assistant (AI schedule · conflicts)" },
          { view: "agent-orchestrator", icon: "🤖", label: "Agent Orchestrator (cross-module suggest → apply)" },
          { view: "social", icon: "🙌", label: "Social Calendar (schedule view)" },
          // Social Publisher lives under Reach → Social command center (single destination)
          { view: "launches", icon: "👏", label: "Product Launch Calendar" },
        ],
      },
      {
        header: "2 · Monitor performance",
        items: [
          { view: "period-comparison", icon: "👁️", label: "Period Comparison (performance vs prior)" },
          { view: "web-analytics", icon: "🫀", label: "Web Analytics (acquisition + behaviour)" },
          { view: "ai-traffic", icon: "✒️", label: "AI Traffic Monitor" },
          { view: "heatmaps", icon: "🖋️", label: "Heatmaps + Session Replay" },
          { view: "action-queue", icon: "📹", label: "Daily Action Queue (what to do today)" },
          { view: "marketing-okr", icon: "📷", label: "Marketing OKRs (live campaign data)" },
          { view: "canonical-metrics", icon: "📐", label: "Canonical Metrics (SSOT · pacing · goals)" },
          // Marketing Goals live under Grow → Set the targets (single destination)
          { view: "budget", icon: "💰", label: "Budget (spend · ROI · 3-month plan)" },
          { view: "budget-board", icon: "🪙", label: "Budget Board (monitor + spend)" },
          { view: "budget-caps", icon: "🚦", label: "Budget Caps (platform daily + lifetime limits)" },
          { view: "utm-builder", icon: "📸", label: "UTM Architecture (link builder + presets)" },
          { view: "pixel-manager", icon: "🎞️", label: "Pixel Manager (Meta CAPI · LinkedIn · TikTok)" },
          { view: "affiliate-hub", icon: "🤝", label: "Affiliate Program Hub" },
          { view: "execution-hub", icon: "🔌", label: "Execution Hub (Canva · Mailchimp · PMax · Segment)" },
          { view: "launch-compliance", icon: "☑️", label: "Launch Compliance Checklist (brand · copy · legal · mobile)" },
          { view: "post-launch-audit", icon: "📽️", label: "Post-Launch Audit (live data + lead flow 24-48h)" },
          { view: "customer-360", icon: "🎚️", label: "Customer 360 (unified account view)" },
        ],
      },
      {
        header: "3 · AI tools & config",
        items: [
          { view: "ask-infogenie", icon: "🎧", label: "Ask InfoGenie (your data)" },
          { view: "strategic-intelligence", icon: "🧠", label: "Strategic Intelligence (root-cause · scenarios · write-back)" },
          { view: "marketing-memory", icon: "🔉", label: "Marketing Memory (knowledge graph)" },
          { view: "predictive-intelligence", icon: "🪬", label: "Predictive Intelligence (90-day AI forecast)" },
          // AI Providers + Governance live under AI Team → Team ops (single destination)
          { view: "autoclaw", icon: "🦞", label: "AutoClaw (Z.ai GLM agent)" },
          { view: "model-compare", icon: "⚖️", label: "Model Comparison (A/B prompts)" },
          { view: "vertical-playbooks", icon: "🔇", label: "Vertical Playbooks (industry packs)" },
        ],
      },
      {
        header: "4 · Team & frameworks",
        items: [
          { view: "meeting-notes", icon: "✏️", label: "Meeting Notes (transcript summarize)" },
          // Team Capacity + AI Team minutes live under AI Team → Team ops
          { view: "playbook-7day", icon: "📖", label: "7-Day Marketing Playbook" },
          { view: "growth-methodology", icon: "💶", label: "Growth Methodology (5-stage)" },
          { view: "flywheel", icon: "🔁", label: "Performance Growth Flywheel" },
        ],
      },
      {
        header: "5 · Run the customer ops",
        items: [
          { view: "reengage", icon: "💷", label: "Re-Engage Customers (drip)" },
          { view: "automations", icon: "🛠️", label: "Automations" },
          { view: "employee-advocacy", icon: "📢", label: "Employee Advocacy" },
          { view: "signal-triggers", icon: "💳", label: "Real-time Signal Triggers" },
          { view: "stakeholders", icon: "👤", label: "Stakeholders" },
          { view: "brand-deals", icon: "🤝", label: "Brand Deal Pipeline" },
          { view: "product-library", icon: "📦", label: "Product Library (catalog + USP)" },
        ],
      },
      {
        header: "6 · Send reports",
        items: [
          { view: "results", icon: "🏦", label: "Results Snapshot" },
          { view: "weekly-report", icon: "🏧", label: "Weekly Report" },
          { view: "cross-channel", icon: "🎁", label: "Cross-Channel Report" },
          { view: "csuite", icon: "👔", label: "C-Suite Reports (CEO · CMO · CFO)" },
          { view: "investor-mode", icon: "📫", label: "Investor Mode (portal + forecasts)" },
          { view: "white-label", icon: "📪", label: "White-Label Reports" },
          { view: "bulk-reports",   icon: "📮", label: "Bulk Reporting (multi-client)" },
          { view: "insta-reports",  icon: "💻", label: "InstaReports (prospect audit reports)" },
          { view: "digest", icon: "🌅", label: "Daily Digest Email" },
        ],
      },
      {
        header: "7 · Account & admin",
        items: [
          { view: "agency", icon: "🏢", label: "Agency Workspace" },
          { view: "marketplace", icon: "🏪", label: "AI Marketing Marketplace" },
          { view: "workspaces", icon: "👪", label: "Workspaces & Team" },
          { view: "admin", icon: "🔐", label: "Admin Portal", id: "navAdminLink", hidden: true },
          { view: "technical-suite", icon: "🔧", label: "Technical Suite" },
          { view: "brand-safety", icon: "🗝️", label: "Brand Safety & Compliance" },
          { view: "data-provenance", icon: "🖨️", label: "Data Provenance (audit trail)" },
          { view: "settings", icon: "🔩", label: "Settings & Integrations" },
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
        items: [{ view: "ai-team", icon: "⌨️", label: "Team Roster" }],
      },
      {
        header: "Officers",
        items: [
          { view: "finance-officer", icon: "🖱️", label: "Finance Officer" },
          { view: "ops-officer", icon: "⚒️", label: "Operations Officer" },
          { view: "technical-manager", icon: "🛡️", label: "Technical Manager (platform · security · live status)" },
        ],
      },
      {
        // Paths stay under /manage/* via VIEW_TO_PATH overrides below — listed here
        // so officer workflow (roster → capacity → meetings) is discoverable.
        header: "Team ops",
        items: [
          { view: "capacity", icon: "👥", label: "Team Capacity & Workload" },
          { view: "team-meetings", icon: "💴", label: "Minutes of Meeting" },
          { view: "ai-providers", icon: "🔈", label: "AI Providers (BYO LLM)" },
          { view: "ai-governance", icon: "🛡️", label: "AI Governance Hub" },
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
        // Keep the first canonical path (e.g. Analyse Analytics Hub over Grow duplicate).
        if (!VIEW_TO_PATH[item.view]) {
          VIEW_TO_PATH[item.view] = `/${group.key}/${item.view}`;
        }
      }
    }
  }
}

// Keep established bookmark paths when nav ownership moves (AI Team ops, etc.).
VIEW_TO_PATH.flywheel = "/manage/flywheel";
VIEW_TO_PATH["canonical-metrics"] = "/manage/canonical-metrics";
VIEW_TO_PATH.capacity = "/manage/capacity";
VIEW_TO_PATH["team-meetings"] = "/manage/team-meetings";
VIEW_TO_PATH["ai-providers"] = "/manage/ai-providers";
VIEW_TO_PATH["ai-governance"] = "/manage/ai-governance";

/**
 * Views trimmed from the default Analyse sidebar (to reduce duplicates) but still
 * reachable via deep link, nav search, and dashboard module tiles.
 */
export const SIDEBAR_HIDDEN_VIEWS: readonly string[] = [
  "deliverability",
  "biz-scanner",
  "linkedin-ads",
  "ad-swipe",
  "job-board-spy",
  "maps-intel",
  "web-extractor",
  "recipe-scraper",
  "dataset-market",
  "resilient-tracker",
  "trending-topics",
  "glassdoor",
  "reddit",
  "reddit-pulse",
  "twitter-pulse",
  "youtube-monitor",
  "yt-comment-miner",
  "podcast-monitor",
  "quora-mining",
  "newsletter-tracker",
  "question-miner",
  "keyword-map",
  "intent-map",
  "google-trends",
  "bing-webmaster",
  "spyfu",
  "majestic",
  "serpstat",
  "contentking",
  "link-prospector",
  "accessibility",
  "social-tags",
  "seo-widget",
  "review-automation",
  "ave",
  "anomaly-detector",
  "intent-radar",
  "hashtag-tracker",
  "influence-score",
  "project-compare",
  "geo-insights",
  "ugc-discovery",
];

for (const view of SIDEBAR_HIDDEN_VIEWS) {
  ALL_VIEW_IDS.add(view);
  if (!VIEW_TO_PATH[view]) VIEW_TO_PATH[view] = `/analyse/${view}`;
}

/** Canonical dashboard URL for a `data-view` id, or `/` if unknown. */
export function viewToPath(view: string): string {
  if (view === "home") return "/analyse";
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
  "marketing-simulator":"digital-twin",
  // Relabel-first hub shortcuts (marketing taxonomy discoverability)
  "sem":               "paid-search-social",
  "ppc":               "paid-search-social",
  "paid-search":       "paid-search-social",
  "paid-social":       "paid-search-social",
  "content-marketing": "content-studio",
  "ai-content":        "content-studio",
  "social-media":      "social-command-center",
  "organic-social-hub":"social-command-center",
  "email-marketing":   "lifecycle-email",
  "email-automation":  "lifecycle-email",
  "sms-marketing":     "messaging-channels",
  "push-notifications":"messaging-channels",
  "chatbot":           "conversational-ai",
  "cro":               "conversion-lab",
  "growth-marketing":  "growth-hub",
};

/**
 * Resolve a dashboard pathname to its `data-view` id. The group segment is
 * cosmetic — the last path segment is the view id, accepted only if it's a real
 * nav view (or a known alias). `/` maps to the marketing-brief home screen.
 */
export function pathToViewId(pathname: string): string | null {
  // / → analysis form on first load; 'home' is not a migrated React view so
  // MigratedPanel renders nothing and the legacy #view-home entry form shows.
  if (!pathname || pathname === "/" || pathname === "/analyse") return "home";
  const segs = pathname.split("/").filter(Boolean);
  if (!segs.length) return null;
  const last = segs[segs.length - 1];
  if (ALL_VIEW_IDS.has(last)) return last;
  // Gracefully redirect retired view IDs to their replacement hub.
  return VIEW_ID_ALIASES[last] ?? null;
}
