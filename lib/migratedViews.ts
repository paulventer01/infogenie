// Registry of legacy SPA panels that have been ported to native React pages.
//
// This is the single source of truth for the panel migration (Next.js Phase 3).
// It is consumed by:
//   • components/features/registry.tsx   — view id -> React component
//   • components/layout/MigratedPanel.tsx — renders the React panel for the
//     currently-routed view
//   • lib/legacyShell.ts                  — strips the ported `#view-<id>` div
//     and its `public/js` <script> out of the DEV replay shell, so the legacy
//     panel never double-renders and its module drops from the replayed bundle.
//
// PROD SAFETY (read before deleting anything): production still serves the
// vanilla-JS SPA directly via Express — there is no Next.js in prod yet (see
// `.agents/memory/nextjs-migration.md`). The legacy `#view-<id>` markup in
// `index.html` and the `public/js/<module>.js` file therefore MUST stay on
// disk: they are what prod renders. Suppression here is DEV-SHELL-ONLY. Physical
// deletion of the legacy view + module is the final step, deferred until Next
// owns the prod front door. Until then, porting a panel = (1) add a React
// component, (2) register it in `components/features/registry.tsx`, (3) add an
// entry below. The legacy files keep prod working with zero regression.

export interface MigratedView {
  /** Legacy `data-view` id — matches `#view-<id>` and the nav `data-view`. */
  view: string;
  /**
   * Basename of the `public/js` module that built this panel. Dropped from the
   * DEV replay bundle so it stops loading once React owns the view. Use `null`
   * for panels whose builder lives inline in `app.js` (nothing to drop).
   */
  legacyModule: string | null;
}

export const MIGRATED_VIEWS: MigratedView[] = [
  { view: "seo-roadmap", legacyModule: "ig_seo_roadmap.js" },
  // deliverability / web-vitals / tech-stack builders all live INLINE in app.js
  // (window.buildDeliverability, window.buildWebVitals, window.buildTechStack),
  // so there is no dedicated public/js module to drop — legacyModule is null and
  // suppression relies solely on stripping each `#view-<id>` div from the DEV
  // replay shell.
  { view: "deliverability", legacyModule: null },
  { view: "web-vitals", legacyModule: null },
  { view: "tech-stack", legacyModule: null },
  // The Manage-group panels below all live in SHARED public/js modules
  // (ig_seo.js, ig_manage_pack.js, ig_moat_features.js, ig_intelligence_tools.js)
  // — or inline in app.js — that still build many NOT-YET-migrated sibling
  // views. Dropping the whole module would break those siblings, so legacyModule
  // stays `null` here: suppression relies solely on stripping the `#view-<id>`
  // div (every builder early-returns when its target div/wrap is gone). Only a
  // panel whose module is dedicated to migrated views (like the pilot's
  // ig_seo_roadmap.js) may drop its module.
  { view: "growth-methodology", legacyModule: null },
  { view: "white-label", legacyModule: null },
  { view: "bulk-reports", legacyModule: null },
  { view: "model-compare", legacyModule: null },
  { view: "web-analytics", legacyModule: null },
  { view: "vertical-playbooks", legacyModule: null },
  // flywheel has a DEDICATED module (ig_growth_flywheel.js) — safe to drop from
  // the replay bundle. playbook-7day's builder lives inline in app.js (nothing
  // to drop), so its suppression relies solely on stripping the `#view-*` div.
  { view: "flywheel", legacyModule: "ig_growth_flywheel.js" },
  { view: "capacity", legacyModule: null },
  { view: "canonical-metrics", legacyModule: null },
  { view: "contribution-record", legacyModule: null },
  { view: "playbook-7day", legacyModule: null },
  // Registry panels that were missing from this list (SpaRouter legacy race risk)
  { view: "aeo-optimizer", legacyModule: null },
  { view: "autoclaw", legacyModule: null },
  { view: "lead-intelligence", legacyModule: null },
  // ── Remainder of the Manage group (Phase 3 batch 2) ──────────────────────
  // Every panel below either lives inline in app.js or in a SHARED public/js
  // module (ig_manage_pack.js, ig_reach_automation.js, ig_mentions_gaps.js,
  // ig_intel_pack_a/b.js, ig_advanced_features.js, ig_moat_features.js,
  // ig_content_traffic.js, ig_creator_suite.js, ig_journey_omnichannel.js,
  // ig_csuite.js, ig_settings.js) that still builds NOT-YET-migrated non-Manage
  // sibling views. Per the shared-module rule, legacyModule stays `null`:
  // suppression relies solely on stripping the `#view-<id>` div (every builder
  // early-returns when its target div/wrap is gone).
  { view: "new-project", legacyModule: null },
  { view: "master-calendar", legacyModule: null },
  { view: "brand-calendar", legacyModule: null },
  { view: "calendar-assistant", legacyModule: null },
  { view: "launches", legacyModule: null },
  { view: "ai-traffic", legacyModule: null },
  { view: "heatmaps", legacyModule: null },
  { view: "budget", legacyModule: null },
  { view: "budget-board", legacyModule: null },
  { view: "seo-ai-visibility", legacyModule: null },
  { view: "creative-hub", legacyModule: null },
  { view: "pages-hub", legacyModule: null },
  { view: "organic-performance", legacyModule: null },
  // Goals Hub is registered via agent-goals / goals / canonical-metrics / marketing-okr / kpi-tracker keys
  { view: "ask-infogenie", legacyModule: null },
  { view: "strategic-intelligence", legacyModule: null },
  { view: "marketing-memory", legacyModule: null },
  { view: "predictive-intelligence", legacyModule: null },
  { view: "agent-goals", legacyModule: null },
  { view: "ai-providers", legacyModule: null },
  { view: "meeting-notes", legacyModule: null },
  { view: "team-meetings", legacyModule: null },
  { view: "infographics", legacyModule: null },
  { view: "reengage", legacyModule: null },
  { view: "automations", legacyModule: null },
  { view: "employee-advocacy", legacyModule: null },
  { view: "signal-triggers", legacyModule: null },
  { view: "stakeholders", legacyModule: null },
  { view: "results", legacyModule: null },
  { view: "weekly-report", legacyModule: null },
  { view: "cross-channel", legacyModule: null },
  { view: "csuite", legacyModule: null },
  { view: "investor-mode", legacyModule: null },
  { view: "agency", legacyModule: null },
  { view: "marketplace", legacyModule: null },
  { view: "workspaces", legacyModule: null },
  { view: "admin", legacyModule: null },
  { view: "technical-suite", legacyModule: null },
  { view: "brand-safety", legacyModule: null },
  { view: "data-provenance", legacyModule: null },
  { view: "settings", legacyModule: null },
  // ── Phase 3 batch 3: Analyse / Create / Reach / Grow / AI Team (all builders
  // are shared modules or inline app.js — legacyModule null; suppression via
  // #view-<id> div strip) ──
  { view: "dashboard", legacyModule: null },
  { view: "roadmap", legacyModule: null },
  { view: "competitors", legacyModule: null },
  { view: "battle-cards", legacyModule: null },
  { view: "battleplan", legacyModule: null },
  { view: "intelligence", legacyModule: null },
  { view: "war-room", legacyModule: null },
  { view: "biz-scanner", legacyModule: null },
  { view: "benchmarks", legacyModule: null },
  { view: "ad-library", legacyModule: null },
  { view: "organic-social", legacyModule: null },
  { view: "linkedin-ads", legacyModule: null },
  { view: "ad-swipe", legacyModule: null },
  { view: "pricing-watch", legacyModule: null },
  { view: "job-board-spy", legacyModule: null },
  { view: "maps-intel", legacyModule: null },
  { view: "change-monitor", legacyModule: null },
  { view: "web-extractor", legacyModule: null },
  { view: "recipe-scraper", legacyModule: null },
  { view: "dataset-market", legacyModule: null },
  { view: "resilient-tracker", legacyModule: null },
  { view: "sov-tracker", legacyModule: null },
  { view: "trending-topics", legacyModule: null },
  { view: "crisis-radar", legacyModule: null },
  { view: "icp-studio", legacyModule: null },
  { view: "voc", legacyModule: null },
  { view: "review-aggregator", legacyModule: null },
  { view: "glassdoor", legacyModule: null },

  { view: "content-brief", legacyModule: null },
  { view: "period-comparison", legacyModule: null },
  { view: "gsc-data", legacyModule: null },
  { view: "visitor-intel", legacyModule: null },
  { view: "mentions", legacyModule: null },
  { view: "reddit", legacyModule: null },
  { view: "reddit-pulse", legacyModule: null },
  { view: "twitter-pulse", legacyModule: null },
  { view: "youtube-monitor", legacyModule: null },
  { view: "yt-comment-miner", legacyModule: null },
  { view: "podcast-monitor", legacyModule: null },
  { view: "quora-mining", legacyModule: null },
  { view: "newsletter-tracker", legacyModule: null },
  { view: "keyword-explorer", legacyModule: null },
  { view: "question-miner", legacyModule: null },
  { view: "social-listening", legacyModule: null },
  { view: "media-intel", legacyModule: null },
  { view: "keyword-map", legacyModule: null },
  { view: "intent-map", legacyModule: null },
  { view: "content-gaps", legacyModule: null },
  { view: "serp", legacyModule: null },
  { view: "serp-tracker", legacyModule: null },
  { view: "daily-trends", legacyModule: null },
  { view: "traffic-sources", legacyModule: null },
  { view: "market-overview", legacyModule: null },
  { view: "serp-gap", legacyModule: null },
  { view: "llm-gap", legacyModule: null },
  { view: "ad-intel", legacyModule: null },
  { view: "influencer-analytics", legacyModule: null },
  { view: "brand-monitor", legacyModule: null },
  { view: "google-trends", legacyModule: null },
  { view: "bing-webmaster", legacyModule: null },
  { view: "spyfu", legacyModule: null },
  { view: "majestic", legacyModule: null },
  { view: "semrush", legacyModule: null },
  { view: "ahrefs", legacyModule: null },
  { view: "serpstat", legacyModule: null },
  { view: "contentking", legacyModule: null },
  { view: "realtime-news", legacyModule: null },
  { view: "backlinks", legacyModule: null },
  { view: "backlink-monitor", legacyModule: null },
  { view: "link-prospector", legacyModule: null },
  { view: "brand-assets", legacyModule: null },
  { view: "templates", legacyModule: null },
  { view: "studio", legacyModule: null },
  { view: "content", legacyModule: null },
  { view: "headline-tester", legacyModule: null },
  { view: "press-release", legacyModule: null },
  { view: "cold-email", legacyModule: null },
  { view: "email-personalizer", legacyModule: null },
  { view: "email-broadcast", legacyModule: null },
  { view: "whatsapp", legacyModule: null },
  { view: "voice-caller", legacyModule: null },
  { view: "reply-assistant", legacyModule: null },
  { view: "localization", legacyModule: null },
  { view: "creative", legacyModule: null },
  { view: "smart-creative", legacyModule: null },
  { view: "carousel", legacyModule: null },
  { view: "canva", legacyModule: null },
  { view: "ugc-avatars", legacyModule: null },
  { view: "video-script", legacyModule: null },
  { view: "voiceover", legacyModule: null },
  { view: "creative-intel", legacyModule: null },
  { view: "landing-builder", legacyModule: null },
  { view: "site-builder", legacyModule: null },
  { view: "linksell", legacyModule: null },
  { view: "schema-generator", legacyModule: null },
  { view: "chatbot-builder", legacyModule: null },
  { view: "campaigns", legacyModule: null },
  { view: "content-calendar", legacyModule: null },
  { view: "content-modes", legacyModule: null },
  { view: "content-autopilot", legacyModule: null },
  { view: "ad-creative", legacyModule: null },
  { view: "idea-feed", legacyModule: null },
  { view: "pitch-deck", legacyModule: null },
  { view: "wireframe", legacyModule: null },
  { view: "accessibility", legacyModule: null },
  { view: "persona-studio", legacyModule: null },
  { view: "ecom-video", legacyModule: null },
  { view: "brand-deals", legacyModule: null },
  { view: "social", legacyModule: null },
  { view: "audience", legacyModule: null },
  { view: "lookalike", legacyModule: null },
  { view: "audiences-dynamic", legacyModule: null },
  { view: "journey-builder", legacyModule: null },
  { view: "omnichannel", legacyModule: null },
  { view: "lead-gen", legacyModule: null },
  // Retired individual views — registry maps these to LeadGenHub so the
  // React shell intercepts them and renders the hub instead of falling
  // through to the legacy builder or blank panel.
  { view: "lead-finder", legacyModule: null },
  { view: "local-leads", legacyModule: null },
  { view: "lead-aggregator", legacyModule: null },
  { view: "acquisition-engine", legacyModule: null },
  { view: "bookings", legacyModule: null },
  { view: "lead-qualifier", legacyModule: null },
  { view: "hubspot-sync", legacyModule: null },
  { view: "crm-sync", legacyModule: null },
  { view: "hunter", legacyModule: null },
  { view: "advertise", legacyModule: null },
  { view: "import-campaigns", legacyModule: null },
  { view: "opt-folders", legacyModule: null },
  { view: "ab-designer", legacyModule: null },
  { view: "conversion-boosters", legacyModule: null },
  { view: "social-publisher", legacyModule: null },
  { view: "discovery", legacyModule: null },
  { view: "influencers", legacyModule: null },
  { view: "tiktok-downloader", legacyModule: null },
  { view: "hashtag-intel", legacyModule: null },
  { view: "search-intel", legacyModule: null },
  { view: "geo-audit", legacyModule: null },
  { view: "local-seo", legacyModule: null },
  { view: "seo-auditor", legacyModule: null },
  { view: "content-score", legacyModule: null },
  { view: "seo-crawler", legacyModule: null },
  { view: "social-tags", legacyModule: null },
  { view: "seo-tasks", legacyModule: null },
  { view: "seo-widget", legacyModule: null },
  { view: "unified-inbox", legacyModule: null },
  { view: "alert-routing", legacyModule: null },
  { view: "digest", legacyModule: null },
  { view: "goals", legacyModule: null },
  { view: "kpi-tracker", legacyModule: null },
  { view: "action-center", legacyModule: null },
  { view: "meta-insights", legacyModule: null },
  { view: "google-ads-insights", legacyModule: null },
  { view: "tiktok-ads-insights", legacyModule: null },
  { view: "social-analytics", legacyModule: null },
  { view: "post-performance", legacyModule: null },
  { view: "optimizer", legacyModule: null },
  { view: "auto-operator", legacyModule: null },
  { view: "safe-agent", legacyModule: null },
  { view: "analytics-hub", legacyModule: null },
  { view: "amplitude-agents", legacyModule: null },
  { view: "blended-perf", legacyModule: null },
  { view: "attribution", legacyModule: null },
  { view: "true-roas", legacyModule: null },
  { view: "iroas", legacyModule: null },
  { view: "conversion-recovery", legacyModule: null },
  { view: "churn-scorer", legacyModule: null },
  { view: "revenue-forecast", legacyModule: null },
  { view: "digital-twin", legacyModule: null },
  { view: "campaign-composer", legacyModule: null },
  { view: "geofencing", legacyModule: null },
  { view: "local-listings", legacyModule: null },
  { view: "review-automation", legacyModule: null },
  { view: "marketing-brief", legacyModule: null },
  { view: "mmm", legacyModule: null },
  { view: "product-library", legacyModule: null },
  { view: "email-analytics", legacyModule: null },
  { view: "autoseo", legacyModule: null },
  { view: "seo-growth-autopilot", legacyModule: null },
  { view: "contentscorer", legacyModule: null },
  { view: "link-suggester", legacyModule: null },
  { view: "cro-lab", legacyModule: null },
  { view: "ai-audit-suite", legacyModule: null },
  { view: "vis-leaderboard", legacyModule: null },
  { view: "landing-pages", legacyModule: null },
  { view: "ai-team", legacyModule: null },
  { view: "finance-officer", legacyModule: null },
  { view: "ops-officer", legacyModule: null },
  { view: "technical-manager", legacyModule: null },
  // Customer 360 is a brand-new panel (not a legacy port) — lives entirely in
  // React with no legacy #view-customer-360 markup or public/js builder.
  { view: "customer-360", legacyModule: null },
  // New panels — no legacy markup or public/js builders.
  { view: "utm-builder",   legacyModule: null },
  { view: "budget-caps",   legacyModule: null },
  { view: "budget-arbitrage", legacyModule: null },
  { view: "pixel-manager",      legacyModule: null },
  { view: "launch-compliance",  legacyModule: null },
  { view: "post-launch-audit",  legacyModule: null },
  { view: "audio-summary",      legacyModule: null },
  { view: "self-healing",       legacyModule: null },
  { view: "ctv-streaming",      legacyModule: null },
  { view: "rcs-campaigns",      legacyModule: null },
  { view: "funnel-analytics",   legacyModule: null },
  { view: "bulk-rewriter",      legacyModule: null },
  { view: "insta-reports",      legacyModule: null },
  { view: "email-warmup",       legacyModule: null },
  { view: "linkedin-outreach",  legacyModule: null },
  // Customer-engagement pack — ig_customer_engagement.js is DEDICATED to these
  // 8 views (buildSurveys/EmailDesigner/McpServer/SmartSend/AiSegments/
  // AudienceAdSync/Translation/InboxMonitor), so the module can be dropped from
  // the DEV replay bundle. Listing it once is enough (MIGRATED_MODULES dedupes
  // by usage); keep it on the first entry only to avoid duplicates.
  { view: "surveys",          legacyModule: "ig_customer_engagement.js" },
  { view: "email-designer",   legacyModule: null },
  { view: "mcp-server",       legacyModule: null },
  { view: "smart-send",       legacyModule: null },
  { view: "ai-segments",      legacyModule: null },
  { view: "audience-ad-sync", legacyModule: null },
  { view: "translate",        legacyModule: null },
  { view: "inbox-monitor",    legacyModule: null },
  // Brand Intelligence suite — ig_brand24_suite.js is DEDICATED to these 10
  // views, so it too drops from the DEV replay bundle (listed once).
  { view: "reputation-score", legacyModule: "ig_brand24_suite.js" },
  { view: "presence-score",   legacyModule: null },
  { view: "ave",              legacyModule: null },
  { view: "anomaly-detector", legacyModule: null },
  { view: "intent-radar",     legacyModule: null },
  { view: "hashtag-tracker",  legacyModule: null },
  { view: "influence-score",  legacyModule: null },
  { view: "project-compare",  legacyModule: null },
  { view: "geo-insights",     legacyModule: null },
  { view: "ugc-discovery",    legacyModule: null },
  // identity-spine's builder lives in the SHARED ig_strategic_features.js
  // (decision-engine / experiment-suite / approval-workflows are still legacy),
  // so the module must keep loading — suppression is div-strip only.
  { view: "identity-spine",   legacyModule: null },
  // React-only additions (never had a legacy panel or module).
  { view: "marketing-okr",      legacyModule: null },
  { view: "action-queue",       legacyModule: null },
  { view: "ad-comment-monitor", legacyModule: null },
  // Relabel-first marketing hubs (tile landing pages)
  { view: "paid-search-social", legacyModule: null },
  { view: "content-studio", legacyModule: null },
  { view: "social-command-center", legacyModule: null },
  { view: "lifecycle-email", legacyModule: null },
  { view: "messaging-channels", legacyModule: null },
  { view: "conversational-ai", legacyModule: null },
  { view: "conversion-lab", legacyModule: null },
  { view: "growth-hub", legacyModule: null },
  // Gap-priority build (P0/P1 roadmap)
  { view: "zero-click-hub", legacyModule: null },
  { view: "voice-seo", legacyModule: null },
  { view: "remarketing-suite", legacyModule: null },
  { view: "referral-manager", legacyModule: null },
  { view: "affiliate-hub", legacyModule: null },
  { view: "short-form-video", legacyModule: null },
  { view: "push-marketing", legacyModule: null },
  { view: "social-commerce", legacyModule: null },
  // Centralized Marketing Ecosystem
  { view: "ecosystem-spine", legacyModule: null },
  { view: "agent-orchestrator", legacyModule: null },
  { view: "ai-governance", legacyModule: null },
  { view: "newsletter-studio", legacyModule: null },
  { view: "podcast-studio", legacyModule: null },
  { view: "interactive-leads", legacyModule: null },
  { view: "execution-hub", legacyModule: null },
];

/** Set of view ids now rendered by React. */
export const MIGRATED_VIEW_IDS = new Set<string>(
  MIGRATED_VIEWS.map((m) => m.view),
);

/** `public/js` module basenames to drop from the DEV replay bundle. */
export const MIGRATED_MODULES: string[] = MIGRATED_VIEWS.map(
  (m) => m.legacyModule,
).filter((m): m is string => !!m);

/** True when a `data-view` id has been ported to a native React page. */
export function isMigratedView(view: string | null | undefined): boolean {
  return !!view && MIGRATED_VIEW_IDS.has(view);
}
