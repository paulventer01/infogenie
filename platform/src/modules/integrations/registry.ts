// The integration landscape, transcribed from the Feature & Integration
// Reference §10. 27 live in the reference implementation; 12 recorded as
// not connected WITH the reason, because the reason determines whether the
// gap is worth closing ("a blocked integration is not a backlog item").

export type IntegrationStatus = "live" | "pending" | "blocked" | "not_integrated";

export interface IntegrationEntry {
  key: string;
  name: string;
  purpose: string;
  status: IntegrationStatus;
  reason?: string;
  authKind?: "api_key" | "oauth" | "none";
}

export const INTEGRATION_CATALOG: IntegrationEntry[] = [
  // ---- §10.1 Connected and operational ----
  { key: "openai", name: "OpenAI (GPT-4o, DALL-E 3, TTS)", purpose: "AI backbone for LLM tasks, image generation, voiceover", status: "live" },
  { key: "anthropic", name: "Anthropic (Claude)", purpose: "AI reasoning — primary in this build; all calls traverse the LLM gateway", status: "live" },
  { key: "gemini", name: "Google Gemini", purpose: "Tertiary AI — model comparison, AI visibility", status: "live" },
  { key: "perplexity", name: "Perplexity Sonar", purpose: "Live web research — competitor intel, influencer discovery, listening", status: "live" },
  { key: "cloudflare_ai", name: "Cloudflare Workers AI (Llama)", purpose: "Fourth AI model — comparison, fallback", status: "live" },
  { key: "dataforseo", name: "DataForSEO", purpose: "SERP data, keyword research, backlinks, domain rank, historical rank", status: "live" },
  { key: "firecrawl", name: "Firecrawl", purpose: "Web scraping — competitor monitoring, pricing pages, content extraction", status: "live" },
  { key: "hubspot", name: "HubSpot", purpose: "CRM sync — contacts, deals, lists, company creation", status: "live", authKind: "oauth" },
  { key: "resend", name: "Resend", purpose: "Email delivery — drip sequences, reports, alerts, review requests", status: "live" },
  { key: "meta_ads", name: "Meta Ads (Graph API)", purpose: "Campaign insights, ad library spy, CAPI conversion events", status: "live", authKind: "oauth" },
  { key: "google_ads", name: "Google Ads (Ads API)", purpose: "Campaign insights — per-user OAuth vault", status: "live", authKind: "oauth" },
  { key: "tiktok_ads", name: "TikTok Ads (Marketing API)", purpose: "Campaign insights", status: "live", authKind: "oauth" },
  { key: "zernio", name: "Zernio API", purpose: "15-platform social publishing and analytics", status: "live" },
  { key: "amplitude", name: "Amplitude", purpose: "Product analytics, web analytics, AI agents", status: "live" },
  { key: "apollo", name: "Apollo.io", purpose: "Lead data for the Lead Aggregator", status: "live" },
  { key: "builtwith", name: "BuiltWith", purpose: "Tech stack detection", status: "live" },
  { key: "pagespeed", name: "Google PageSpeed Insights", purpose: "Web Vitals auditing", status: "live" },
  { key: "google_trends", name: "Google Trends", purpose: "Keyword trend data — no key required", status: "live", authKind: "none" },
  { key: "bing_webmaster", name: "Bing Webmaster Tools", purpose: "Bing-specific SEO data", status: "live" },
  { key: "slack", name: "Slack", purpose: "Alert routing, daily digest delivery, crisis notifications", status: "live", authKind: "oauth" },
  { key: "stripe", name: "Stripe", purpose: "Payment processing", status: "live" },
  { key: "wordpress", name: "WordPress (REST API)", purpose: "Auto-publishing for Content Modes and Content Calendar", status: "live" },
  { key: "apify", name: "Apify", purpose: "TikTok organic scraping, Google Maps lead scraping", status: "live" },
  { key: "rapidapi_tiktok", name: "RapidAPI (TikTok / News)", purpose: "TikTok downloader fallback; real-time news data", status: "live" },
  { key: "tikwm", name: "tikwm.com", purpose: "TikTok downloader primary source (free)", status: "live", authKind: "none" },
  { key: "reddit", name: "Reddit (public API)", purpose: "Reddit Pulse — no auth required", status: "live", authKind: "none" },
  { key: "news_api", name: "Real-Time News Data", purpose: "Live news intelligence", status: "live" },
  { key: "google_maps", name: "Google Maps (via Apify)", purpose: "Local lead scraping", status: "live" },
  { key: "youtube", name: "YouTube (public data)", purpose: "Comment mining, channel monitoring", status: "live", authKind: "none" },
  { key: "quora", name: "Quora (public data)", purpose: "Question mining", status: "live", authKind: "none" },
  { key: "trustpilot_g2", name: "Review platforms (via Perplexity)", purpose: "Trustpilot / G2 / Capterra / Glassdoor review aggregation", status: "live", authKind: "none" },
  // ---- §10.2 Not connected, blocked or pending — with the reason ----
  { key: "google_search_console", name: "Google Search Console", purpose: "GSC data", status: "blocked", reason: "OAuth blocked by Google Workspace org policy — replaced by DataForSEO-powered GSC view" },
  { key: "google_analytics", name: "Google Analytics 4", purpose: "Web analytics", status: "blocked", reason: "OAuth blocked by org policy — replaced by Amplitude + internal analytics" },
  { key: "microsoft_ads", name: "Microsoft Ads", purpose: "Campaign insights", status: "pending", reason: "Environment variables defined; implementation pending verification" },
  { key: "linkedin_ads", name: "LinkedIn Ads", purpose: "Campaign insights", status: "pending", reason: "Insight Tag generation exists; API campaign insights not built (publishing via Zernio works)" },
  { key: "whatsapp", name: "WhatsApp (direct API)", purpose: "Messaging", status: "pending", reason: "Supported via Zernio; direct Business API not wired" },
  { key: "twilio", name: "Twilio SMS", purpose: "SMS delivery", status: "pending", reason: "Variables defined; not wired to a live route" },
  { key: "vapi", name: "VAPI (Voice AI)", purpose: "Voice call automation", status: "pending", reason: "Variables defined; not implemented" },
  { key: "web_push", name: "Web Push (VAPID)", purpose: "Push notifications", status: "pending", reason: "Variables defined; delivery not wired end-to-end" },
  { key: "semrush", name: "Semrush", purpose: "SEO data", status: "not_integrated", reason: "DataForSEO covers the same use cases" },
  { key: "ahrefs", name: "Ahrefs", purpose: "SEO data", status: "not_integrated", reason: "DataForSEO covers the same use cases" },
  { key: "shopify", name: "Shopify", purpose: "E-commerce storefront", status: "not_integrated", reason: "No storefront connection yet" },
  { key: "salesforce", name: "Salesforce", purpose: "CRM", status: "not_integrated", reason: "HubSpot covers CRM needs" },
];
