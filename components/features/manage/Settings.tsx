"use client";

// Native React port of the legacy `settings` panel (was `window.buildSettings`
// in public/js/ig_settings.js + `#view-settings`). Settings & Integrations: the
// INTEGRATIONS catalog (Ad Platforms / Intelligence APIs / AI Models / CRM &
// Automation / Analytics & Data / Communication / Google Workspace), the
// integration cards with Connect / Test / OAuth / vault-save actions, the
// account-settings form + toggles, and both the master docs modal and the
// per-integration docs modal. Connection state mirrors the legacy localStorage
// (`ig_integ_<id>`) plus server detection. API health reads `GET /api/status`,
// server-detected integrations read `GET /api/integrations/status`, and
// vault-save keys POST to `/api/settings/api-key` — the same endpoints the
// legacy builder + its app.js helpers used. Connect/Test helpers (connectCard,
// connectVault, connectOAuth, testConnection + API_VALIDATORS) are ported as
// component logic. Rich step/doc markup is parsed to JSX (no innerHTML).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { safeUrl } from "@/lib/utils";

interface IntegStep {
  text: string;
}

interface IntegItem {
  id: string;
  logo: string;
  name: string;
  tagline: string;
  authType: "oauth" | "apikey";
  placeholder?: string;
  vaultSave?: boolean;
  unlocks: string[];
  steps: IntegStep[];
}

interface IntegCategory {
  label: string;
  icon: string;
  desc: string;
  badge: string;
  items: IntegItem[];
}

type IntegrationsMap = Record<string, IntegCategory>;

interface ApiStatus {
  dataforseo?: boolean;
  rapidapi?: boolean;
  [key: string]: unknown;
}

interface IntegrationsStatus {
  configured?: string[];
  [key: string]: unknown;
}

interface VaultSaveResult {
  ok: boolean;
  error?: string;
}

interface VaultStatusResult {
  ok: boolean;
  configured?: boolean;
  error?: string;
}

type ValidatorStatus = "verified" | "rejected" | "format-ok" | "unverifiable";

interface ValidatorResult {
  status: ValidatorStatus;
  message: string;
}

type Validator = (key: string) => ValidatorResult | Promise<ValidatorResult>;

interface ApiDetails {
  baseUrl: string;
  rateLimits: string;
  plans: string;
  errorCodes: Array<[string, string]>;
}

const INTEGRATIONS: IntegrationsMap = {
  platforms: {
    label: "Ad Platforms",
    icon: "🚀",
    desc: "Connect your advertising accounts to let InfoGenie autonomously create, launch, and optimise campaigns across every major platform.",
    badge: "7 Platforms",
    items: [
      {
        id: "google-ads", logo: "🔵", name: "Google Ads",
        tagline: "Search, Display, YouTube, Shopping & Performance Max",
        authType: "oauth",
        unlocks: [
          "Autonomous campaign creation & bidding on all Google properties",
          "Keyword intelligence synced from competitor analysis",
          "Real-time bid optimisation via InfoGenie RL engine",
          "Performance Max campaign auto-configuration",
        ],
        steps: [
          { text: 'Go to <a href="https://ads.google.com" target="_blank">ads.google.com</a> and sign in to your account' },
          { text: "Navigate to <strong>Tools & Settings → API Centre</strong>" },
          { text: "Click <strong>Apply for API Access</strong> and complete the form" },
          { text: "Once approved, copy your <code>Developer Token</code>" },
          { text: "Click <strong>Connect via OAuth</strong> below — InfoGenie handles the rest" },
        ],
      },
      {
        id: "meta-ads", logo: "🔷", name: "Meta Ads Manager",
        tagline: "Facebook, Instagram, Messenger & Audience Network",
        authType: "oauth",
        unlocks: [
          "Automated Facebook & Instagram campaign deployment",
          "Lookalike audience creation from competitor intelligence",
          "Dynamic creative testing across audience segments",
          "Real-time ROAS monitoring and budget reallocation",
        ],
        steps: [
          { text: 'Go to <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a> and create an App' },
          { text: "Add the <strong>Marketing API</strong> product to your app" },
          { text: "Generate a <strong>System User Access Token</strong> with <code>ads_management</code> permission" },
          { text: "Note your <strong>Ad Account ID</strong> (format: act_123456789)" },
          { text: "Click <strong>Connect via OAuth</strong> — InfoGenie will request permissions automatically" },
        ],
      },
      {
        id: "tiktok-ads", logo: "⬛", name: "TikTok Ads",
        tagline: "In-Feed, TopView, Spark Ads & Brand Takeovers",
        authType: "apikey",
        placeholder: "TikTok Ads Access Token (Bearer xxxxx...)",
        unlocks: [
          "Short-form video campaign creation and deployment",
          "Spark Ads from organic content amplification",
          "TikTok audience intelligence and targeting",
          "Creative performance tracking and auto-optimisation",
        ],
        steps: [
          { text: 'Visit <a href="https://ads.tiktok.com/marketing_api" target="_blank">TikTok for Business Developers</a>' },
          { text: "Create a developer account and register your app under <strong>My Apps</strong>" },
          { text: "Complete the <strong>app review</strong> process (typically 1–3 business days)" },
          { text: "Once approved, generate an <strong>Access Token</strong> from your app dashboard" },
          { text: "Note your <strong>Advertiser ID</strong> from TikTok Ads Manager → Account → Advertiser Info" },
          { text: "Paste your Access Token above and click <strong>Connect</strong>" },
        ],
      },
      {
        id: "linkedin-ads", logo: "🔷", name: "LinkedIn Campaign Manager",
        tagline: "Sponsored Content, Message Ads & Lead Gen Forms",
        authType: "oauth",
        unlocks: [
          "B2B audience targeting by job title, industry, and company size",
          "Sponsored content and InMail campaign automation",
          "Lead Gen Form integration with CRM sync",
          "LinkedIn Insight Tag conversion tracking",
        ],
        steps: [
          { text: 'Go to <a href="https://developer.linkedin.com" target="_blank">developer.linkedin.com</a> and create an app' },
          { text: "Add the <strong>Marketing Developer Platform</strong> product" },
          { text: "Request access to <code>r_ads</code> and <code>rw_ads</code> permissions" },
          { text: "Generate OAuth 2.0 credentials (Client ID + Client Secret)" },
          { text: "Click <strong>Connect via OAuth</strong> to authorise InfoGenie" },
        ],
      },
      {
        id: "x-ads", logo: "🐦", name: "X (Twitter) Ads",
        tagline: "Promoted Tweets, Follower Campaigns & App Installs",
        authType: "apikey",
        placeholder: "X Ads API Access Token",
        unlocks: [
          "Promoted tweet campaigns targeting competitor followers",
          "Trend-based ad scheduling and real-time campaign pivots",
          "Keyword and hashtag audience targeting",
          "Conversation ads and app install campaigns",
        ],
        steps: [
          { text: 'Apply for <a href="https://developer.twitter.com" target="_blank">X Developer Access</a> at developer.twitter.com' },
          { text: "Create a Project and App in the developer portal" },
          { text: "Apply for <strong>Ads API access</strong> (requires a funded ads account)" },
          { text: "Navigate to <strong>Keys & Tokens</strong> and generate Access Token + Secret" },
          { text: "Paste your Access Token above and click <strong>Connect</strong>" },
        ],
      },
      {
        id: "pinterest-ads", logo: "🔴", name: "Pinterest Ads",
        tagline: "Promoted Pins, Shopping Campaigns & Video Ads",
        authType: "oauth",
        unlocks: [
          "Product catalogue and shopping campaign automation",
          "Visual audience discovery and interest targeting",
          "Seasonal campaign scheduling with AI creative generation",
          "Shopping spotlight and collection ads",
        ],
        steps: [
          { text: 'Go to <a href="https://developers.pinterest.com" target="_blank">developers.pinterest.com</a>' },
          { text: "Create a new app and request <strong>Ads API access</strong>" },
          { text: "Set your <strong>Redirect URI</strong> to <code>https://app.infogenie.ai/oauth/pinterest</code>" },
          { text: "Note your App ID and App Secret from the app settings" },
          { text: "Click <strong>Connect via OAuth</strong> to link your Pinterest Business account" },
        ],
      },
      {
        id: "amazon-ads", logo: "🟠", name: "Amazon Ads",
        tagline: "Sponsored Products, Brands, Display & DSP",
        authType: "apikey",
        placeholder: "Amazon Ads API Refresh Token",
        unlocks: [
          "Sponsored Products & Brands campaign automation",
          "Amazon DSP programmatic display campaigns",
          "Keyword harvesting from search term reports",
          "ASIN-level competitor targeting and product ads",
        ],
        steps: [
          { text: 'Sign in to <a href="https://advertising.amazon.com" target="_blank">advertising.amazon.com</a>' },
          { text: "Navigate to <strong>Account Access → API Access</strong>" },
          { text: "Create a Security Profile under <strong>Login with Amazon</strong>" },
          { text: "Use Amazon's OAuth flow to generate a <strong>Refresh Token</strong>" },
          { text: "Note your <strong>Profile IDs</strong> for each marketplace you want to manage" },
          { text: "Paste your Refresh Token above and click <strong>Connect</strong>" },
        ],
      },
    ],
  },

  intelligence: {
    label: "Intelligence APIs",
    icon: "🔍",
    desc: "Connect your own competitive-intelligence subscriptions — traffic estimates, keyword data, backlinks, ad libraries, and brand monitoring.",
    badge: "10 Sources",
    items: [
      {
        id: "youtube-data", logo: "▶️", name: "YouTube Data API",
        tagline: "Live trending videos by category, country & topic — powers Trending Topics",
        authType: "apikey",
        vaultSave: true,
        placeholder: "YouTube Data API Key (AIza...)",
        unlocks: [
          "🔴 LIVE: Trending YouTube videos by category and country updated in real time",
          "View counts, channel names, and direct video links for each trending result",
          "Category-mapped trending (Music, Gaming, Sports, Tech, and 25+ more)",
          "Replaces AI-estimated trends with real YouTube chart data",
        ],
        steps: [
          { text: 'Go to <a href="https://console.cloud.google.com" target="_blank">Google Cloud Console</a> and sign in' },
          { text: "Create or select a project, then navigate to <strong>APIs & Services → Library</strong>" },
          { text: "Search for <strong>YouTube Data API v3</strong> and click <strong>Enable</strong>" },
          { text: "Go to <strong>APIs & Services → Credentials</strong> and click <strong>+ Create Credentials → API Key</strong>" },
          { text: "Copy the generated key and paste it above, then click <strong>Connect</strong>" },
          { text: "Optional: restrict the key to the <strong>YouTube Data API v3</strong> for security" },
        ],
      },
      {
        id: "semrush", logo: "📊", name: "Semrush API",
        tagline: "Keyword rankings, PPC data, backlinks & competitor analysis",
        authType: "apikey",
        placeholder: "Semrush API Key (sk_xxxxxxxxxxxx)",
        unlocks: [
          "Competitor keyword rankings and estimated traffic",
          "PPC keyword data with CPC and competition scores",
          "Backlink analysis for domain authority comparison",
          "Display advertising and ad copy intelligence",
        ],
        steps: [
          { text: 'Sign in to <a href="https://semrush.com" target="_blank">semrush.com</a> and go to <strong>Account → API</strong>' },
          { text: "Subscribe to the <strong>Semrush API</strong> — Business plan or above recommended" },
          { text: "Copy your <strong>API Key</strong> from the API dashboard" },
          { text: "Paste your API Key in the field above" },
          { text: "Click <strong>Test Connection</strong> to verify — InfoGenie will confirm your data units balance" },
        ],
      },
      {
        id: "similarweb", logo: "🌐", name: "SimilarWeb API",
        tagline: "Traffic intelligence, audience demographics & referral data",
        authType: "apikey",
        placeholder: "SimilarWeb API Key",
        unlocks: [
          "Competitor monthly traffic estimates with confidence levels",
          "Traffic source breakdown (organic, paid, social, referral)",
          "Audience demographics by country, device, and age",
          "Top referring domains and organic keywords",
        ],
        steps: [
          { text: 'Visit <a href="https://www.similarweb.com/corp/developer/digital-intelligence-api" target="_blank">SimilarWeb Developer Portal</a>' },
          { text: "Request access to the <strong>Digital Intelligence API</strong>" },
          { text: "Once approved, navigate to <strong>My Account → API Key</strong>" },
          { text: "Copy your API Key and paste it in the field above" },
          { text: "Click <strong>Test Connection</strong> — InfoGenie will verify your monthly unit allowance" },
        ],
      },
      {
        id: "ahrefs", logo: "🔗", name: "Ahrefs API",
        tagline: "Backlink data, keyword explorer & content gap analysis",
        authType: "apikey",
        placeholder: "Ahrefs API Token (v3)",
        unlocks: [
          "Domain Rating and backlink profile comparison",
          "Keyword difficulty and organic traffic potential",
          "Content gap analysis vs. competitor pages",
          "Top-performing competitor content identification",
        ],
        steps: [
          { text: 'Sign in to <a href="https://ahrefs.com" target="_blank">ahrefs.com</a> (Business plan required for API)' },
          { text: "Go to <strong>Account Settings → API</strong>" },
          { text: "Generate a new <strong>API v3 Token</strong>" },
          { text: "Set token permissions: <code>site_explorer</code>, <code>keywords_explorer</code>" },
          { text: "Paste your token above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "spyfu", logo: "🕵️", name: "SpyFu API",
        tagline: "Google Ads history, competitor keywords & ad copy spy",
        authType: "apikey",
        placeholder: "SpyFu API Key",
        unlocks: [
          "Complete Google Ads history for any competitor domain",
          "Every keyword a competitor has ever bought on Google",
          "Historical ad copy and A/B test variations",
          "Estimated monthly Google Ads spend per competitor",
        ],
        steps: [
          { text: 'Sign up at <a href="https://www.spyfu.com" target="_blank">spyfu.com</a> (API plan required)' },
          { text: "Navigate to <strong>Account → Integrations → API Key</strong>" },
          { text: "Copy your API Key" },
          { text: "Paste it above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "moz", logo: "🎯", name: "Moz API",
        tagline: "Domain Authority, Page Authority & link metrics",
        authType: "apikey",
        placeholder: "Moz Access ID:Secret Key",
        unlocks: [
          "Domain Authority and Page Authority scores for competitors",
          "Spam score and link quality analysis",
          "Top competitor pages by authority",
          "Keyword ranking opportunity identification",
        ],
        steps: [
          { text: 'Sign up at <a href="https://moz.com/products/api" target="_blank">moz.com/products/api</a>' },
          { text: "Navigate to <strong>API → Access Credentials</strong>" },
          { text: "Copy your <strong>Access ID</strong> and <strong>Secret Key</strong>" },
          { text: "Enter them in the format <code>AccessID:SecretKey</code> above" },
          { text: "Click <strong>Test Connection</strong> to verify" },
        ],
      },
      {
        id: "meta-ad-library", logo: "📣", name: "Meta Ad Library API",
        tagline: "Every active Facebook & Instagram competitor ad — live, in real time",
        authType: "apikey",
        placeholder: "Meta Access Token (EAA...)",
        unlocks: [
          "🔴 LIVE: See every active Facebook & Instagram ad from any competitor domain",
          "Competitor ad creative, copy, call-to-action, and spend range — updated daily",
          "Identify which competitor ads have been running longest (highest performers)",
          "Demographic targeting breakdown: age, gender, location for each competitor ad",
          "Auto-populate InfoGenie Signal Feed with new competitor creative launches",
        ],
        steps: [
          { text: 'Go to <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a> and create or open an existing app' },
          { text: "Add the <strong>Marketing API</strong> product — navigate to <strong>App Dashboard → Add Product</strong>" },
          { text: "Go to <strong>Tools → Graph API Explorer</strong> and generate a <strong>User Access Token</strong>" },
          { text: "Select the following permission: <code>ads_read</code> — this grants access to the Ad Library" },
          { text: "Convert to a long-lived token: call <code>GET /oauth/access_token?grant_type=fb_exchange_token</code> with your short-lived token" },
          { text: "Paste your long-lived token above and click <strong>Test Connection</strong> — InfoGenie will verify Ad Library access immediately" },
        ],
      },
      {
        id: "apify", logo: "🕸️", name: "Apify",
        tagline: "Web scraping platform — powers TikTok Organic Monitor & Local Lead Finder",
        authType: "apikey",
        vaultSave: true,
        placeholder: "Apify API Token (apify_api_...)",
        unlocks: [
          "🔴 LIVE: TikTok Organic Monitor — track any brand or keyword's TikTok videos, views & engagement",
          "Local Lead Finder — pull verified Google Maps business leads for any location + category",
          "Top creator analysis per keyword — identify who is driving competitor TikTok reach",
          "Export leads with phone numbers, ratings, hours, and website URLs in one click",
        ],
        steps: [
          { text: 'Visit <a href="https://console.apify.com/sign-up" target="_blank">console.apify.com</a> and create a free account' },
          { text: "Go to <strong>Settings → Integrations → API tokens</strong>" },
          { text: "Click <strong>+ Create new token</strong> and copy the value (starts with <code>apify_api_</code>)" },
          { text: "Paste your token above and click <strong>Connect</strong> — saved instantly, no restart needed" },
        ],
      },
      {
        id: "profound", logo: "🧠", name: "Profound",
        tagline: "Brand mention tracking across ChatGPT, Claude, Perplexity, Gemini",
        authType: "apikey",
        placeholder: "Profound API Key",
        unlocks: [
          "Live brand-visibility scores in answer-engine results",
          "Competitor benchmark across all major LLMs",
          "Prompt-coverage gap analysis for AI search",
          "Citation source tracking (which sites the LLMs quote about you)",
        ],
        steps: [
          { text: 'Visit <a href="https://www.tryprofound.com" target="_blank">tryprofound.com</a> and request API access' },
          { text: "Once approved, copy your <strong>API Key</strong> from the dashboard" },
          { text: "In Replit Secrets, add <code>PROFOUND_API_KEY</code>" },
          { text: "Open the AI Visibility Suite — Profound metrics appear automatically when configured" },
        ],
      },
      {
        id: "brandwatch", logo: "👁️", name: "Brandwatch API",
        tagline: "Real-time competitor mentions, sentiment & share of voice monitoring",
        authType: "apikey",
        placeholder: "Brandwatch API Token",
        unlocks: [
          "🔴 LIVE: Competitor brand mentions across 100M+ sources updated in real time",
          "Sentiment analysis: track positive/negative shifts in competitor perception instantly",
          "Live Share of Voice data powering the Intelligence Hub SOV chart",
          "Crisis and opportunity detection — competitor negative spikes = acquisition moment",
          "Auto-trigger Signal Feed alerts when competitor sentiment drops sharply",
        ],
        steps: [
          { text: 'Log in to <a href="https://app.brandwatch.com" target="_blank">app.brandwatch.com</a> with your Brandwatch account' },
          { text: "Navigate to <strong>Settings → API Access</strong> (Consumer Intelligence or Social Intelligence plan required)" },
          { text: "Click <strong>Generate New Token</strong> — select scopes: <code>queries:read</code>, <code>mentions:read</code>, <code>analytics:read</code>" },
          { text: "Copy your API token (it starts with <code>Bearer </code> — include this prefix when pasting)" },
          { text: "Set up at least one <strong>Competitor Query</strong> in Brandwatch that tracks your top 3 competitor brand names" },
          { text: "Paste your token above and click <strong>Test Connection</strong> — InfoGenie will sync your query list and begin live monitoring" },
        ],
      },
    ],
  },

  ai: {
    label: "AI Models",
    icon: "🤖",
    desc: "Connect your own AI model subscriptions for image, voice, video, and copy generation. InfoGenie's core GPT-4o, Claude, Gemini, and Perplexity intelligence is included on every plan — no key required.",
    badge: "8 Models",
    items: [
      {
        id: "stability", logo: "🎨", name: "Stability AI",
        tagline: "Stable Diffusion for AI-generated ad images & visuals",
        authType: "apikey",
        placeholder: "Stability AI API Key (sk-xxxx...)",
        unlocks: [
          "Stable Diffusion XL for high-quality ad image generation",
          "Image-to-image transformation for creative variations",
          "Brand-consistent visual asset generation at scale",
          "Competitor creative style analysis and improvement",
        ],
        steps: [
          { text: 'Sign up at <a href="https://platform.stability.ai" target="_blank">platform.stability.ai</a>' },
          { text: "Navigate to <strong>Account → API Keys</strong>" },
          { text: "Click <strong>Create API Key</strong>" },
          { text: "Copy your API key (starts with <code>sk-</code>)" },
          { text: "Paste it above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "mistral", logo: "🌀", name: "Mistral AI",
        tagline: "Fast, cost-efficient AI for bulk copy generation & analysis",
        authType: "apikey",
        placeholder: "Mistral API Key",
        unlocks: [
          "Mistral Large for fast, cost-efficient ad copy at scale",
          "Batch campaign analysis across multiple competitors",
          "Multilingual ad copy for global campaigns",
          "Fast real-time campaign suggestion generation",
        ],
        steps: [
          { text: 'Go to <a href="https://console.mistral.ai" target="_blank">console.mistral.ai</a>' },
          { text: "Navigate to <strong>API Keys</strong> in the dashboard" },
          { text: "Click <strong>Create new key</strong>" },
          { text: "Copy your key and paste it above" },
          { text: "Click <strong>Test Connection</strong> — InfoGenie will use Mistral for high-volume tasks" },
        ],
      },
      {
        id: "elevenlabs", logo: "🔊", name: "ElevenLabs",
        tagline: "AI voice generation for video ad voiceovers & audio content",
        authType: "apikey",
        vaultSave: true,
        placeholder: "ElevenLabs API Key",
        unlocks: [
          "AI voiceover generation for video and audio ads",
          "Multi-language voice localisation for global campaigns",
          "Brand voice cloning for consistent audio identity",
          "Podcast and audio ad creation from ad copy",
        ],
        steps: [
          { text: 'Sign up at <a href="https://elevenlabs.io" target="_blank">elevenlabs.io</a>' },
          { text: "Go to <strong>Profile → API Key</strong>" },
          { text: "Copy your API key" },
          { text: "Paste it above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "adcreative", logo: "🎨", name: "AdCreative.ai",
        tagline: "Autonomous AI ad creative generation optimised for conversions",
        authType: "apikey",
        placeholder: "AdCreative.ai API Key",
        unlocks: [
          "Generate 100+ ad creative variants per campaign automatically",
          "Conversion-score ranking — InfoGenie picks the highest-converting designs",
          "Platform-native sizing: Google, Meta, TikTok, LinkedIn, Display",
          "Brand kit integration — all creatives match your visual identity",
          "Competitor creative analysis and one-click improvement",
        ],
        steps: [
          { text: 'Sign up at <a href="https://adcreative.ai" target="_blank">adcreative.ai</a> and choose a plan with API access' },
          { text: "Navigate to <strong>Account → API Settings</strong>" },
          { text: "Generate your API Key and copy it" },
          { text: "Upload your brand kit (logo, colours, fonts) in AdCreative dashboard" },
          { text: "Paste your API key above — InfoGenie will auto-generate creatives on every campaign launch" },
        ],
      },
      {
        id: "jasper", logo: "✍️", name: "Jasper AI",
        tagline: "Autonomous marketing copy, campaign strategy & content at scale",
        authType: "apikey",
        placeholder: "Jasper AI API Key",
        unlocks: [
          "AI-generated ad headlines, descriptions, and CTAs for every campaign",
          "Full campaign strategy documents generated from competitor analysis",
          "Brand voice training — Jasper writes in your exact tone",
          "Long-form landing page copy matched to each campaign angle",
          "Auto-generated A/B test copy variants (50+ per campaign)",
        ],
        steps: [
          { text: 'Go to <a href="https://jasper.ai" target="_blank">jasper.ai</a> and sign up for a Business or Teams plan' },
          { text: "Navigate to <strong>Settings → Integrations → API</strong>" },
          { text: "Click <strong>Generate API Key</strong> and copy it" },
          { text: "Set up your Brand Voice in Jasper by uploading 3–5 content samples" },
          { text: "Paste your key above — InfoGenie will use Jasper for all campaign copy generation" },
        ],
      },
      {
        id: "canva", logo: "🎨", name: "Canva",
        tagline: "Connect Canva for Design Kit briefs + template deep-links",
        authType: "apikey",
        vaultSave: true,
        placeholder: "Canva Client ID (optional — or use Connect OAuth)",
        unlocks: [
          "Design Kit briefs that paste straight into Canva text layers",
          "Curated template deep-links by content type",
          "OAuth Connect when CANVA_CLIENT_ID + CANVA_CLIENT_SECRET are set",
        ],
        steps: [
          { text: 'Create a Connect app at <a href="https://www.canva.com/developers/" target="_blank">canva.com/developers</a>' },
          { text: "Set env <code>CANVA_CLIENT_ID</code> + <code>CANVA_CLIENT_SECRET</code> on the server" },
          { text: "Open Create → Canva → Connect Canva (OAuth) or paste Client ID above for status" },
        ],
      },
      {
        id: "runway", logo: "🎬", name: "Runway ML",
        tagline: "AI video ad generation — text-to-video & image-to-video at scale",
        authType: "apikey",
        vaultSave: true,
        placeholder: "Runway ML API Key (Bearer ...)",
        unlocks: [
          "Generate 15-second and 30-second video ads from text prompts",
          "Image-to-video for product shots — auto-animated for Story & Reels",
          "Video creative for TikTok, YouTube Pre-roll, Instagram Stories",
          "Competitor ad reimagining — take their concept, improve it with AI",
          "Auto-subtitle and caption generation for accessibility compliance",
        ],
        steps: [
          { text: 'Sign up at <a href="https://runwayml.com" target="_blank">runwayml.com</a> and access the API section' },
          { text: "Go to <strong>Settings → API Keys</strong>" },
          { text: "Click <strong>Create new key</strong> — pricing is credit-based at $0.01 per credit" },
          { text: "Note: Video generation costs ~$0.05–0.40 per second depending on resolution" },
          { text: "Paste your Bearer token above — InfoGenie uses Gen-2 by default, Gen-3 Alpha for premium quality" },
        ],
      },
      {
        id: "heygen", logo: "🧑‍🎤", name: "HeyGen",
        tagline: "Avatar / talking-head video ads from a script",
        authType: "apikey",
        vaultSave: true,
        placeholder: "HeyGen API Key",
        unlocks: [
          "Avatar spokespeople for product and offer videos",
          "Multi-language lip-sync for localization",
          "Fast short-form creatives for paid social",
        ],
        steps: [
          { text: 'Sign up at <a href="https://www.heygen.com" target="_blank">heygen.com</a>' },
          { text: "Open <strong>Settings → API</strong> and create a key" },
          { text: "Paste it above — use Create → AI Video to render" },
        ],
      },
      {
        id: "xai", logo: "𝕏", name: "xAI Grok",
        tagline: "Grok answers for AI visibility / citation probes",
        authType: "apikey",
        vaultSave: true,
        placeholder: "xAI API Key",
        unlocks: [
          "Probe how Grok answers category queries",
          "Complement LLM Gap Analyzer with an X-native model",
        ],
        steps: [
          { text: 'Get a key at <a href="https://console.x.ai" target="_blank">console.x.ai</a>' },
          { text: "Paste it above and click <strong>Connect</strong> — saved to your workspace vault (survives reload)" },
        ],
      },
      {
        id: "fireflies", logo: "🎙", name: "Fireflies.ai",
        tagline: "Auto-ingest meeting transcripts into Meeting Notes",
        authType: "apikey",
        vaultSave: true,
        placeholder: "Fireflies API Key",
        unlocks: [
          "Pull transcripts into InfoGenie Meeting Notes",
          "Run BANT summaries without paste friction",
        ],
        steps: [
          { text: 'Open <a href="https://app.fireflies.ai" target="_blank">Fireflies</a> → Integrations → API' },
          { text: "Copy your API key, paste it above, and click <strong>Connect</strong>" },
        ],
      },
      {
        id: "deepl", logo: "🌍", name: "DeepL",
        tagline: "Campaign-quality localization for multi-market launches",
        authType: "apikey",
        vaultSave: true,
        placeholder: "DeepL Auth Key",
        unlocks: [
          "Translate ad/email/landing copy with DeepL quality",
          "Feed Localization workflows with accurate source text",
        ],
        steps: [
          { text: 'Create a key at <a href="https://www.deepl.com/pro-api" target="_blank">deepl.com/pro-api</a>' },
          { text: "Free keys end with <code>:fx</code> — paste the full key above and click <strong>Connect</strong>" },
        ],
      },
      {
        id: "notion", logo: "📓", name: "Notion",
        tagline: "Export Attack Plan briefs into your agency workspace",
        authType: "apikey",
        vaultSave: true,
        placeholder: "Notion Internal Integration Token",
        unlocks: [
          "Push briefs / Attack Plans into Notion pages",
          "Agency handoff without leaving InfoGenie",
        ],
        steps: [
          { text: 'Create an integration at <a href="https://www.notion.so/my-integrations" target="_blank">notion.so/my-integrations</a>' },
          { text: "Share a parent page with the integration and set <code>NOTION_PARENT_PAGE_ID</code>" },
          { text: "Paste the token above and click <strong>Connect</strong>" },
        ],
      },
      {
        id: "copyai", logo: "🖊️", name: "Copy.ai",
        tagline: "GTM AI platform for autonomous campaign workflows & bulk copy",
        authType: "apikey",
        placeholder: "Copy.ai API Key",
        unlocks: [
          "Automated end-to-end campaign copy workflows from a single brief",
          "Bulk generation of 200+ ad copy variations per campaign in seconds",
          "Email sequence automation triggered by campaign conversion events",
          "Sales enablement copy synced with CRM campaign data",
          "Competitor messaging gap analysis and counter-copy generation",
        ],
        steps: [
          { text: 'Go to <a href="https://copy.ai" target="_blank">copy.ai</a> and sign up for Team or Enterprise plan' },
          { text: "Navigate to <strong>Settings → API Access</strong>" },
          { text: "Generate your API key and copy it" },
          { text: "Paste it above and click <strong>Test Connection</strong>" },
          { text: "InfoGenie will use Copy.ai for high-volume campaign brief-to-copy automation" },
        ],
      },
      {
        id: "artlist", logo: "🎵", name: "Artlist.io",
        tagline: "Licensed music & video assets for professional ad campaigns",
        authType: "apikey",
        placeholder: "Artlist Enterprise API Key",
        unlocks: [
          "Access 1M+ royalty-free music tracks for video ad soundtracks",
          "AI-matched music selection based on campaign mood and audience",
          "Stock video footage for display and social video campaigns",
          "AI-generated video and image assets via Artlist's AI ecosystem",
          "Full commercial licensing — no copyright issues on paid campaigns",
        ],
        steps: [
          { text: 'Visit <a href="https://artlist.io/enterprise" target="_blank">artlist.io/enterprise</a> and request an Enterprise account' },
          { text: "Artlist API keys are issued via your Account Manager (self-service portal launching 2025)" },
          { text: "Once issued, your API key will authenticate via OAuth 2.0 client credentials" },
          { text: "Artlist is best suited for video-heavy campaigns — YouTube, TikTok, Instagram Reels" },
          { text: "Paste your key above once issued — InfoGenie will auto-select music tracks for video creatives" },
        ],
      },
    ],
  },

  crm: {
    label: "CRM & Automation",
    icon: "🔗",
    desc: "Connect your CRM and automation platforms to route leads, sync contacts, and automate follow-up workflows triggered by InfoGenie campaign conversions.",
    badge: "7 Platforms",
    items: [
      {
        id: "hubspot", logo: "🟠", name: "HubSpot CRM",
        tagline: "Contact sync, deal pipeline & campaign attribution",
        authType: "oauth",
        unlocks: [
          "Auto-sync campaign leads directly into HubSpot contacts",
          "Deal creation and pipeline stage automation",
          "Campaign attribution reports in HubSpot Dashboards",
          "Retargeting lists built from CRM segments",
        ],
        steps: [
          { text: 'Go to <a href="https://developers.hubspot.com" target="_blank">developers.hubspot.com</a> and create a Private App' },
          { text: "Under <strong>Scopes</strong>, enable: <code>crm.objects.contacts.write</code>, <code>crm.objects.deals.write</code>" },
          { text: "Generate your <strong>Private App Access Token</strong>" },
          { text: "Alternatively, click <strong>Connect via OAuth</strong> for instant setup" },
          { text: "InfoGenie will automatically create a custom property <code>infogenie_source</code> for attribution" },
        ],
      },
      {
        id: "salesforce", logo: "🔵", name: "Salesforce CRM",
        tagline: "Lead routing, opportunity management & revenue attribution",
        authType: "oauth",
        unlocks: [
          "Campaign lead auto-routing into Salesforce leads/contacts",
          "Opportunity creation from qualified ad conversions",
          "Revenue attribution via campaign UTM tracking",
          "AI-powered lead scoring from engagement signals",
        ],
        steps: [
          { text: "Go to <strong>Setup → Apps → App Manager</strong> in Salesforce" },
          { text: "Create a <strong>Connected App</strong> with OAuth enabled" },
          { text: "Add scopes: <code>api</code>, <code>refresh_token</code>, <code>offline_access</code>" },
          { text: "Set the callback URL to <code>https://app.infogenie.ai/oauth/salesforce</code>" },
          { text: "Click <strong>Connect via OAuth</strong> below to authorise" },
        ],
      },
      {
        id: "pipedrive", logo: "🟢", name: "Pipedrive",
        tagline: "Deal management, contact sync & pipeline automation",
        authType: "apikey",
        placeholder: "Pipedrive API Token",
        unlocks: [
          "Auto-create deals from InfoGenie campaign conversions",
          "Contact enrichment with campaign source and UTMs",
          "Pipeline stage triggers based on campaign performance",
          "Activity logging for all AI-generated touchpoints",
        ],
        steps: [
          { text: "Sign in to Pipedrive and go to <strong>Personal Preferences → API</strong>" },
          { text: "Copy your <strong>Personal API Token</strong>" },
          { text: "Paste it in the field above" },
          { text: "Click <strong>Test Connection</strong> — InfoGenie will map your pipeline stages automatically" },
        ],
      },
      {
        id: "klaviyo", logo: "📧", name: "Klaviyo",
        tagline: "Email marketing automation & audience sync for e-commerce",
        authType: "apikey",
        placeholder: "Klaviyo Private API Key",
        unlocks: [
          "Sync InfoGenie campaign audiences into Klaviyo lists",
          "Trigger email flows from ad click and conversion events",
          "Revenue attribution across InfoGenie ads + email flows",
          "Suppression list sync to reduce ad spend waste",
        ],
        steps: [
          { text: 'Go to <a href="https://klaviyo.com" target="_blank">klaviyo.com</a> → <strong>Account → Settings → API Keys</strong>' },
          { text: "Click <strong>Create Private API Key</strong>" },
          { text: "Select scopes: <code>Lists: Full Access</code>, <code>Profiles: Full Access</code>, <code>Events: Full Access</code>" },
          { text: "Copy the private key and paste it above" },
          { text: "Click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "marketo", logo: "🟣", name: "Marketo (Adobe)",
        tagline: "B2B marketing automation, lead scoring & nurture campaigns",
        authType: "apikey",
        placeholder: "Marketo Client ID:Client Secret",
        unlocks: [
          "B2B lead sync from InfoGenie LinkedIn campaigns",
          "Lead scoring enrichment from campaign engagement data",
          "Automated nurture programme triggers post-ad-click",
          "Revenue Cycle Analytics integration for full-funnel reporting",
        ],
        steps: [
          { text: "In Marketo, go to <strong>Admin → Integration → LaunchPoint</strong>" },
          { text: "Click <strong>New Service</strong> and choose <strong>Custom</strong>" },
          { text: 'Enter "InfoGenie" as the service name' },
          { text: "Under <strong>Admin → Web Services</strong>, copy your <strong>REST API Endpoint</strong>" },
          { text: "Go to <strong>Admin → LaunchPoint</strong>, find your service, and click <strong>View Details</strong> for Client ID and Secret" },
          { text: "Enter them in format <code>ClientID:ClientSecret</code> above" },
        ],
      },
      {
        id: "zapier", logo: "⚡", name: "Zapier",
        tagline: "Connect 6,000+ apps with no-code automation workflows",
        authType: "apikey",
        placeholder: "Zapier API Key",
        unlocks: [
          "Trigger any Zap from InfoGenie campaign events",
          "Route leads to any app in Zapier's 6,000+ ecosystem",
          "Multi-step automation across CRM, email, sheets, and Slack",
          "Custom webhook triggers from InfoGenie AI alerts",
        ],
        steps: [
          { text: 'Sign in to <a href="https://zapier.com" target="_blank">zapier.com</a> and go to <strong>Settings → API</strong>' },
          { text: "Generate your <strong>API Key</strong>" },
          { text: "In InfoGenie, copy your <strong>Webhook URL</strong> from the Zapier connection panel" },
          { text: "Create a Zap with <strong>Webhooks by Zapier</strong> as the trigger using your webhook URL" },
          { text: "Paste your Zapier API Key above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "make", logo: "🔵", name: "Make (Integromat)",
        tagline: "Visual automation builder with advanced data transformation",
        authType: "apikey",
        placeholder: "Make API Token",
        unlocks: [
          "Visual workflow automation triggered by campaign events",
          "Complex data transformation between InfoGenie and other systems",
          "Advanced scheduling and conditional automation logic",
          "Real-time webhook processing from ad platform events",
        ],
        steps: [
          { text: 'Go to <a href="https://make.com" target="_blank">make.com</a> → <strong>Profile → API</strong>' },
          { text: 'Click <strong>Add token</strong> and name it "InfoGenie"' },
          { text: "Copy the generated token" },
          { text: "In Make, create a new Scenario using the <strong>Webhooks</strong> module as trigger" },
          { text: "Copy the webhook URL and paste it into InfoGenie's Make settings panel" },
          { text: "Enter your API token above and click <strong>Test Connection</strong>" },
        ],
      },
    ],
  },

  analytics: {
    label: "Analytics & Data",
    icon: "📈",
    desc: "Connect analytics and data platforms to give InfoGenie complete visibility into your performance — enabling smarter competitor benchmarking and ROI attribution.",
    badge: "8 Platforms",
    items: [
      {
        id: "shopify", logo: "🛍️", name: "Shopify Admin API",
        tagline: "Live revenue, AOV & order volume from your Shopify store",
        authType: "apikey",
        placeholder: "Shopify Admin Access Token (shpat_...)",
        unlocks: [
          "Real revenue & paid-orders KPIs in Results dashboard",
          "AOV trend tied directly to ad-campaign spend",
          "Refund + cancellation tracking for ROAS accuracy",
          "Auto-attribute orders to InfoGenie campaign UTMs",
        ],
        steps: [
          { text: "Open your Shopify admin → <strong>Settings → Apps and sales channels → Develop apps</strong>" },
          { text: 'Click <strong>Create an app</strong>, name it "InfoGenie"' },
          { text: "Under <strong>Configuration → Admin API access scopes</strong>, enable <code>read_orders</code>, <code>read_products</code>, <code>read_customers</code>" },
          { text: "Click <strong>Install app</strong> and copy the <strong>Admin API access token</strong> (shown once)" },
          { text: "In Replit Secrets, add <code>SHOPIFY_SHOP</code> (e.g. <code>mystore.myshopify.com</code>) and <code>SHOPIFY_ADMIN_TOKEN</code>" },
        ],
      },
      {
        id: "appsflyer", logo: "📱", name: "AppsFlyer",
        tagline: "Mobile install attribution, in-app events & cohort analysis",
        authType: "apikey",
        placeholder: "AppsFlyer API Token (V2)",
        unlocks: [
          "Real install + event totals in the Mobile section of Results",
          "Cross-channel mobile attribution alongside Meta/Google/TikTok",
          "Cohort retention curves tied to acquisition source",
          "CPI / CPA monitoring per campaign for mobile",
        ],
        steps: [
          { text: 'Sign in to <a href="https://hq1.appsflyer.com" target="_blank">hq1.appsflyer.com</a>' },
          { text: "Click your account icon → <strong>Security Center → Manage your AppsFlyer API tokens</strong>" },
          { text: "Generate a <strong>V2 API token</strong> with Pull API access" },
          { text: "Locate your <strong>App ID</strong> (e.g. <code>com.example.app</code> or <code>id123456789</code>) under My Apps" },
          { text: "In Replit Secrets, add <code>APPSFLYER_API_TOKEN</code> and <code>APPSFLYER_APP_ID</code>" },
        ],
      },
      {
        id: "ga4", logo: "📊", name: "Google Analytics 4",
        tagline: "Website traffic, user behaviour & conversion events",
        authType: "oauth",
        unlocks: [
          "Real website conversion data fed into ROAS calculations",
          "Audience segment sync for better campaign targeting",
          "Attribution modelling across InfoGenie campaigns",
          "Funnel drop-off identification for landing page insights",
        ],
        steps: [
          { text: 'Go to <a href="https://analytics.google.com" target="_blank">analytics.google.com</a> → <strong>Admin → Property Settings</strong>' },
          { text: "Note your <strong>Measurement ID</strong> (format: G-XXXXXXXXXX)" },
          { text: "Under <strong>Admin → Service Accounts</strong>, create a service account with <strong>Viewer</strong> access" },
          { text: "Download the <strong>JSON credentials file</strong>" },
          { text: "Click <strong>Connect via OAuth</strong> for the simplified setup (recommended)" },
        ],
      },
      {
        id: "gsc", logo: "🔍", name: "Google Search Console",
        tagline: "Organic search performance, impressions & CTR data",
        authType: "oauth",
        unlocks: [
          "Organic keyword CTR benchmarked against paid campaign CTR",
          "Top search queries feeding into keyword targeting",
          "Page performance data for landing page optimisation",
          "Core Web Vitals insight for campaign quality scores",
        ],
        steps: [
          { text: 'Go to <a href="https://search.google.com/search-console" target="_blank">Google Search Console</a>' },
          { text: "Verify ownership of your domain if not already done" },
          { text: "Click <strong>Connect via OAuth</strong> below — InfoGenie requests read-only access" },
          { text: "Select your property when prompted during OAuth flow" },
        ],
      },
      {
        id: "adobe", logo: "🔴", name: "Adobe Analytics",
        tagline: "Enterprise-grade analytics with custom dimensions & segments",
        authType: "apikey",
        placeholder: "Adobe Analytics Client ID:Secret",
        unlocks: [
          "Enterprise segment sync for precision ad targeting",
          "Multi-channel attribution across all InfoGenie campaigns",
          "Custom metric integration for revenue and LTV reporting",
          "Real-time data feeds for autonomous campaign decisions",
        ],
        steps: [
          { text: 'Go to <a href="https://developer.adobe.com/console" target="_blank">Adobe Developer Console</a>' },
          { text: "Create a new Project and add the <strong>Analytics API</strong> service" },
          { text: "Generate <strong>OAuth Server-to-Server credentials</strong>" },
          { text: "Note your <strong>Report Suite ID</strong> from Adobe Analytics Admin" },
          { text: "Enter Client ID and Secret in format <code>ClientID:Secret</code> above" },
          { text: "Click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "mixpanel", logo: "🟣", name: "Mixpanel",
        tagline: "Product analytics, user events & cohort analysis",
        authType: "apikey",
        placeholder: "Mixpanel Service Account Secret",
        unlocks: [
          "User behaviour event data for audience segmentation",
          "Cohort analysis to identify best-converting user journeys",
          "Funnel performance feeding into campaign landing page scores",
          "Retention data for lifetime value optimisation",
        ],
        steps: [
          { text: 'Go to <a href="https://mixpanel.com" target="_blank">mixpanel.com</a> → <strong>Settings → Project Settings → Service Accounts</strong>' },
          { text: "Click <strong>Add Service Account</strong> with <strong>Analyst</strong> role" },
          { text: "Copy the <strong>Username</strong> and <strong>Secret</strong>" },
          { text: "Note your <strong>Project Token</strong> from Project Settings" },
          { text: "Enter the Service Account Secret above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "segment", logo: "🟢", name: "Segment (Twilio)",
        tagline: "Customer data platform — unify events across all touchpoints",
        authType: "apikey",
        placeholder: "Segment Write Key",
        unlocks: [
          "Unified customer event data from all touchpoints",
          "Audience sync to InfoGenie from Segment Personas",
          "Real-time event streaming for campaign trigger automation",
          "Identity resolution across devices and channels",
        ],
        steps: [
          { text: 'Sign in to <a href="https://segment.com" target="_blank">segment.com</a> → <strong>Sources → Add Source</strong>' },
          { text: 'Create a new source named "InfoGenie"' },
          { text: "Copy the <strong>Write Key</strong> from source settings" },
          { text: "Navigate to <strong>Destinations → Add Destination</strong> and add InfoGenie as a destination" },
          { text: "Paste your Write Key above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "hotjar", logo: "🔥", name: "Hotjar",
        tagline: "Heatmaps, session recordings & conversion funnel analysis",
        authType: "apikey",
        placeholder: "Hotjar Personal API Token",
        unlocks: [
          "Landing page heatmap data informing ad creative direction",
          "Session recording access for post-click UX analysis",
          "Funnel analysis identifying conversion drop-off points",
          "User feedback insights for ad messaging refinement",
        ],
        steps: [
          { text: 'Sign in to <a href="https://hotjar.com" target="_blank">hotjar.com</a> → <strong>Account → Personal API Tokens</strong>' },
          { text: "Click <strong>Generate a personal API token</strong>" },
          { text: 'Give it the name "InfoGenie" and copy the token' },
          { text: "Note your <strong>Site ID</strong> from the Hotjar dashboard" },
          { text: "Paste your token above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "posthog", logo: "🦔", name: "PostHog",
        tagline: "Open-source product analytics, session replay & feature flags",
        authType: "apikey",
        placeholder: "PostHog Personal API Key (phx_...)",
        unlocks: [
          "Ad campaign → conversion funnel tracking end-to-end",
          "Session replay of post-click user journeys",
          "Feature flag integration for A/B test targeting",
          "Cohort export for precision retargeting audiences",
        ],
        steps: [
          { text: 'Go to <a href="https://app.posthog.com" target="_blank">app.posthog.com</a> → <strong>Settings → Personal API Keys</strong>' },
          { text: "Click <strong>Create personal API key</strong> and give it a descriptive name" },
          { text: "Select scopes: <code>query:read</code> and <code>project:read</code>" },
          { text: "Copy the key (starts with <code>phx_</code>) and paste it above" },
          { text: "Click <strong>Test Connection</strong>" },
        ],
      },
    ],
  },

  communication: {
    label: "Communication",
    icon: "💬",
    desc: "Connect messaging and communication platforms to receive real-time InfoGenie alerts, route campaign leads to chatbots, and automate customer engagement workflows.",
    badge: "6 Channels",
    items: [
      {
        id: "slack", logo: "💬", name: "Slack",
        tagline: "Real-time campaign alerts, performance reports & AI insights",
        authType: "oauth",
        unlocks: [
          "Real-time campaign performance alerts to any Slack channel",
          "Daily / weekly intelligence digest delivered to your team",
          "Instant competitor change notifications",
          "AI-generated action recommendations via Slack bot",
        ],
        steps: [
          { text: 'Go to <a href="https://api.slack.com/apps" target="_blank">api.slack.com/apps</a> and click <strong>Create New App</strong>' },
          { text: 'Choose <strong>From scratch</strong> and name it "InfoGenie Bot"' },
          { text: "Under <strong>OAuth & Permissions</strong>, add scopes: <code>chat:write</code>, <code>channels:read</code>, <code>users:read</code>" },
          { text: "Click <strong>Install to Workspace</strong>" },
          { text: "Or simply click <strong>Connect via OAuth</strong> below for one-click setup" },
        ],
      },
      {
        id: "whatsapp", logo: "📱", name: "WhatsApp Business API",
        tagline: "Lead qualification chatbot & conversational campaign follow-up",
        authType: "apikey",
        placeholder: "WhatsApp Business API Token",
        unlocks: [
          "Automated lead qualification chatbot via WhatsApp",
          "Campaign follow-up sequences triggered by ad conversions",
          "Product recommendation bot for e-commerce campaigns",
          "Appointment booking and demo scheduling automation",
        ],
        steps: [
          { text: 'Access the WhatsApp Business API via <a href="https://developers.facebook.com/docs/whatsapp" target="_blank">Meta for Developers</a>' },
          { text: "Create a Meta Business Account and verify your business" },
          { text: "Add the WhatsApp product to your Meta App" },
          { text: "Navigate to <strong>WhatsApp → API Setup</strong> and generate a temporary Access Token" },
          { text: "Add your <strong>Phone Number ID</strong> and <strong>WhatsApp Business Account ID</strong>" },
          { text: "Paste your token above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "telegram", logo: "✈️", name: "Telegram Bot",
        tagline: "Instant campaign alerts, competitor updates & AI notifications",
        authType: "apikey",
        placeholder: "Telegram Bot Token (123456:ABCdef...)",
        unlocks: [
          "Instant push notifications for campaign performance changes",
          "Competitor alert delivery to your Telegram channel",
          "Daily AI intelligence digest via Telegram",
          "Command-based campaign control via Telegram bot commands",
        ],
        steps: [
          { text: "Open Telegram and start a chat with <strong>@BotFather</strong>" },
          { text: "Send the command <code>/newbot</code> and follow the prompts" },
          { text: 'Choose a name (e.g. "InfoGenie Alerts") and a username (e.g. <code>infogenie_alerts_bot</code>)' },
          { text: "BotFather will send you a <strong>Bot Token</strong> — copy it" },
          { text: "Get your <strong>Chat ID</strong> by messaging <code>@userinfobot</code> on Telegram" },
          { text: "Paste your Bot Token above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "sendgrid", logo: "📧", name: "SendGrid (Twilio)",
        tagline: "Transactional emails, campaign reports & lead notifications",
        authType: "apikey",
        placeholder: "SendGrid API Key (SG.xxxx...)",
        unlocks: [
          "Campaign performance reports delivered to your inbox",
          "Transactional emails for lead capture from campaigns",
          "Weekly competitor intelligence digest emails",
          "Custom email templates for InfoGenie notifications",
        ],
        steps: [
          { text: 'Sign in to <a href="https://sendgrid.com" target="_blank">sendgrid.com</a> and go to <strong>Settings → API Keys</strong>' },
          { text: "Click <strong>Create API Key</strong>" },
          { text: "Choose <strong>Full Access</strong> or <strong>Restricted Access</strong> with <code>Mail Send</code> enabled" },
          { text: "Copy the key immediately (starts with <code>SG.</code>)" },
          { text: "Verify your sender email domain under <strong>Settings → Sender Authentication</strong>" },
          { text: "Paste your API key above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "teams", logo: "🔷", name: "Microsoft Teams",
        tagline: "Campaign alerts & AI reports delivered to Teams channels",
        authType: "apikey",
        placeholder: "Teams Webhook URL",
        unlocks: [
          "InfoGenie campaign alerts posted to Teams channels",
          "Daily marketing intelligence reports in Teams",
          "Competitor change notifications for your marketing team",
          "Approval workflows for autonomous campaign launches",
        ],
        steps: [
          { text: "In Microsoft Teams, navigate to the channel where you want alerts" },
          { text: "Click the <strong>⋯ (More Options)</strong> next to the channel name" },
          { text: "Select <strong>Connectors → Incoming Webhook → Configure</strong>" },
          { text: 'Give the webhook a name ("InfoGenie") and upload the InfoGenie logo' },
          { text: "Click <strong>Create</strong> and copy the webhook URL generated" },
          { text: "Paste the webhook URL in the field above and click <strong>Test Connection</strong>" },
        ],
      },
      {
        id: "intercom", logo: "🔵", name: "Intercom",
        tagline: "Lead chat qualification & customer engagement automation",
        authType: "apikey",
        placeholder: "Intercom Access Token",
        unlocks: [
          "Auto-create Intercom leads from InfoGenie campaign conversions",
          "Trigger Intercom chat proactively to high-intent visitors",
          "Sync campaign UTM data to Intercom contact attributes",
          "AI-suggested chat scripts based on competitor messaging",
        ],
        steps: [
          { text: 'Sign in to <a href="https://app.intercom.com" target="_blank">app.intercom.com</a> and go to <strong>Settings → Developers → Developer Hub</strong>' },
          { text: 'Click <strong>New App</strong> and create an app named "InfoGenie"' },
          { text: "Under <strong>Authentication</strong>, copy the <strong>Access Token</strong>" },
          { text: "Enable permissions: <code>Read/Write Users</code>, <code>Read/Write Conversations</code>" },
          { text: "Paste your Access Token above and click <strong>Test Connection</strong>" },
        ],
      },
    ],
  },

  productivity: {
    label: "Google Workspace",
    icon: "🔷",
    desc: "Connect Gmail, Google Drive, and Google Calendar in one OAuth click — monitor your inbox inside Unified Inbox, save reports and exports to Drive, and sync Brand Calendar items to Google Calendar.",
    badge: "3 Apps",
    items: [
      {
        id: "google-workspace",
        logo: "🔷",
        name: "Google Workspace",
        tagline: "Gmail · Google Drive · Google Calendar",
        authType: "oauth",
        unlocks: [
          "Read and reply to Gmail threads directly inside Unified Inbox",
          "Save AI-generated assets, scripts, and reports to Google Drive",
          "Sync Brand Calendar items to Google Calendar as all-day events",
          "One-click OAuth — all three apps, one consent screen",
        ],
        steps: [
          { text: 'Go to <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a> and create or select a project' },
          { text: "Enable <strong>Gmail API</strong>, <strong>Google Drive API</strong>, and <strong>Google Calendar API</strong> under <strong>APIs &amp; Services → Library</strong>" },
          { text: "Under <strong>Credentials → Create Credentials → OAuth 2.0 Client ID</strong>, choose <strong>Web application</strong>" },
          { text: "Add your InfoGenie URL + <code>/api/integrations/workspace/oauth/callback</code> to <strong>Authorised Redirect URIs</strong>" },
          { text: "Set <code>GOOGLE_WORKSPACE_CLIENT_ID</code> and <code>GOOGLE_WORKSPACE_CLIENT_SECRET</code> in your environment secrets" },
          { text: "Click <strong>Connect via OAuth</strong> below — InfoGenie requests read/send for Gmail, <code>drive.file</code> for Drive, and <code>calendar.events</code> for Calendar" },
        ],
      },
    ],
  },
};

const API_DETAILS: Record<string, ApiDetails> = {
  "youtube-data": { baseUrl: "https://www.googleapis.com/youtube/v3", rateLimits: "10,000 units/day (free tier); each videos.list costs 1 unit", plans: "Free — requires Google Cloud project with YouTube Data API v3 enabled", errorCodes: [["403 quotaExceeded", "Daily quota exhausted — check Google Cloud Console quotas"], ["400 keyInvalid", "API key is invalid or not enabled for YouTube Data API v3"], ["403 accessNotConfigured", "YouTube Data API v3 not enabled — go to API Library and enable it"], ["400 regionNotSupported", "Region code not supported — try a different country"]] },
  "google-ads": { baseUrl: "https://googleads.googleapis.com/v16", rateLimits: "10,000 req/day per customer", plans: "Active Google Ads account + API access approval", errorCodes: [["UNAUTHENTICATED", "OAuth token expired — re-authenticate"], ["INVALID_ARGUMENT", "Check field names match Google Ads API spec"], ["RESOURCE_EXHAUSTED", "Daily quota exceeded — reduce request volume"], ["NOT_FOUND", "Customer ID or campaign ID does not exist"]] },
  "meta-ads": { baseUrl: "https://graph.facebook.com/v19.0", rateLimits: "200 calls/hour per ad account", plans: "Active Meta Business Manager + Marketing API access", errorCodes: [["190", "Access token expired — reconnect via OAuth"], ["100", "Invalid parameter — check field names"], ["17", "API rate limit hit — wait 1 hour"], ["803", "Ad account ID format must be act_XXXXXXX"]] },
  "tiktok-ads": { baseUrl: "https://business-api.tiktok.com/open_api/v1.3", rateLimits: "1,000 req/min (campaign), 100 req/min (reporting)", plans: "TikTok for Business account + approved API access", errorCodes: [["40100", "Access token invalid — regenerate in developer portal"], ["40002", "Missing required parameter"], ["50002", "Service temporarily unavailable — retry with exponential back-off"]] },
  "linkedin-ads": { baseUrl: "https://api.linkedin.com/v2", rateLimits: "100 req/day for free, varies by API product", plans: "LinkedIn Marketing Developer Platform access required", errorCodes: [["401", "OAuth token invalid or expired"], ["403", "Insufficient permissions — check r_ads/rw_ads scope"], ["429", "Rate limit exceeded"], ["404", "Campaign or account ID not found"]] },
  "x-ads": { baseUrl: "https://ads-api.twitter.com/12", rateLimits: "300 req/15 min window", plans: "Funded X Ads account + Ads API access (approved)", errorCodes: [["32", "Authentication required — check token"], ["88", "Rate limit exceeded"], ["186", "Tweet text too long"], ["261", "Application cannot perform write actions"]] },
  "pinterest-ads": { baseUrl: "https://api.pinterest.com/v5", rateLimits: "1,000 req/min for campaigns", plans: "Pinterest Business account + Ads API approval", errorCodes: [["401", "Invalid access token"], ["403", "Insufficient scope"], ["429", "Rate limit exceeded"], ["400", "Invalid request body"]] },
  "amazon-ads": { baseUrl: "https://advertising-api.amazon.com", rateLimits: "Varies by endpoint (50–1000 req/sec)", plans: "Amazon Seller/Vendor Central account + advertising account", errorCodes: [["401", "Refresh token expired — re-authenticate"], ["400", "Invalid profile ID or body"], ["429", "Throttled — implement exponential back-off"], ["403", "Insufficient access to this profile"]] },
  semrush: { baseUrl: "https://api.semrush.com", rateLimits: "Based on API units (Business: 3,000/day)", plans: "Semrush API subscription (Business plan recommended)", errorCodes: [["ERROR 50 :: NOTHING FOUND", "Domain has no indexed data in Semrush"], ["ERROR 80 :: NOT ENOUGH UNITS", "API unit balance depleted — upgrade plan"], ["ERROR 120 :: WRONG KEY", "Invalid API key — regenerate in account settings"]] },
  similarweb: { baseUrl: "https://api.similarweb.com/v1", rateLimits: "Depends on plan (typically 1,000 req/month)", plans: "SimilarWeb Digital Intelligence API subscription", errorCodes: [["401", "Invalid API key"], ["402", "Monthly quota exhausted"], ["404", "Website not found in SimilarWeb database"]] },
  ahrefs: { baseUrl: "https://api.ahrefs.com/v3", rateLimits: "500 rows/request, 1,000 req/day (Business)", plans: "Ahrefs Business plan or above", errorCodes: [["401", "Invalid or revoked API token"], ["403", "Feature not available on your plan"], ["429", "Rate limit exceeded — reduce request frequency"]] },
  spyfu: { baseUrl: "https://www.spyfu.com/apis/url_api", rateLimits: "10,000 results/day on Pro plan", plans: "SpyFu API plan subscription", errorCodes: [["403", "Invalid API credentials"], ["429", "Daily rate limit exceeded"], ["404", "Domain not indexed by SpyFu"]] },
  moz: { baseUrl: "https://lsapi.seomoz.com/v2", rateLimits: "10 queries per 10 seconds (free), higher on paid", plans: "Moz Pro API access (paid plan)", errorCodes: [["401", "Invalid Access ID or Secret Key"], ["429", "Request rate exceeded"], ["400", "Invalid URL or parameter"]] },
  "meta-ad-library": { baseUrl: "https://graph.facebook.com/v19.0/ads_archive", rateLimits: "200 calls/hour per user token, 500/day per app", plans: "Any Facebook Developer App with ads_read permission (free)", errorCodes: [["190", "Access token expired or invalid — regenerate a long-lived token"], ["100", "Missing or invalid parameter — check ad_type and ad_reached_countries fields"], ["17", "Rate limit hit — wait 1 hour before retrying"], ["200", "Insufficient permissions — ensure ads_read scope is granted on your token"]] },
  brandwatch: { baseUrl: "https://api.brandwatch.com/v2", rateLimits: "60 req/min for mentions, 10 req/min for analytics", plans: "Brandwatch Consumer Intelligence or Social Intelligence plan", errorCodes: [["401", "Invalid or expired API token — regenerate in Settings → API Access"], ["403", "Scope not granted — check queries:read and mentions:read permissions"], ["429", "Rate limit exceeded — Brandwatch enforces per-minute windows"], ["404", "Query ID not found — verify your query was created in Brandwatch dashboard"]] },
  stability: { baseUrl: "https://api.stability.ai/v1", rateLimits: "150 credits/month (free), purchase additional", plans: "Stability AI API account with image credits", errorCodes: [["401", "Invalid API key"], ["402", "Insufficient credits to complete request"], ["400", "Invalid aspect ratio or prompt format"]] },
  hubspot: { baseUrl: "https://api.hubapi.com", rateLimits: "100 req/10s, 40,000 req/day", plans: "HubSpot Marketing Hub (Starter or above recommended)", errorCodes: [["401", "Invalid API key or OAuth token"], ["403", "Scope not authorised — check OAuth permissions"], ["429", "Rate limit exceeded"], ["404", "Contact or list ID not found"]] },
  salesforce: { baseUrl: "https://{instance}.salesforce.com/services/data/v59.0", rateLimits: "100,000 API calls/24 hours (Enterprise)", plans: "Salesforce Enterprise or Unlimited edition", errorCodes: [["INVALID_SESSION_ID", "Session expired — refresh OAuth token"], ["REQUEST_LIMIT_EXCEEDED", "Daily API limit reached"], ["FIELD_INTEGRITY_EXCEPTION", "Required field missing or invalid"]] },
  zapier: { baseUrl: "https://hooks.zapier.com/hooks/catch", rateLimits: "Depends on Zap plan (100–50,000 tasks/month)", plans: "Zapier Professional plan or above for webhooks", errorCodes: [["410", "Webhook URL disabled — re-create Zap"], ["400", "Invalid JSON payload — check Content-Type header"]] },
  make: { baseUrl: "https://hook.eu1.make.com/{webhook-id}", rateLimits: "Based on Make.com plan (ops/month)", plans: "Make.com Core plan or above", errorCodes: [["400", "Invalid payload structure"], ["404", "Scenario not found or inactive"]] },
  klaviyo: { baseUrl: "https://a.klaviyo.com/api", rateLimits: "75 req/s burst, sustained at 10 req/s", plans: "Klaviyo account with API key access", errorCodes: [["401", "Invalid API key prefix — check pk_/sk_ format"], ["403", "Insufficient scope for this endpoint"], ["429", "Rate throttled — implement retry logic"]] },
  ga4: { baseUrl: "https://analyticsdata.googleapis.com/v1beta", rateLimits: "10,000 tokens/hour, 1 req/s per property", plans: "Google Analytics 4 property + Google Cloud project", errorCodes: [["401", "OAuth token expired — re-authenticate"], ["403", "No access to this GA4 property"], ["429", "Quota exceeded — reduce sampling rate"]] },
  segment: { baseUrl: "https://api.segment.io/v1", rateLimits: "No hard limit on tracking; workspace-level throttle", plans: "Segment Team plan or above for source access", errorCodes: [["401", "Invalid write key"], ["400", "Malformed event payload"], ["413", "Payload too large — keep events under 32KB"]] },
  mixpanel: { baseUrl: "https://data.mixpanel.com/api/2.0", rateLimits: "400 queries/hour (Enterprise)", plans: "Mixpanel Growth or Enterprise plan", errorCodes: [["403", "Invalid project secret"], ["400", "Invalid date range or property name"], ["429", "Query rate limit exceeded"]] },
  hotjar: { baseUrl: "https://api.hotjar.com/v1", rateLimits: "100 req/min", plans: "Hotjar Business plan for API access", errorCodes: [["401", "Invalid personal API key"], ["404", "Site ID not found"], ["429", "Rate limit exceeded"]] },
  slack: { baseUrl: "https://slack.com/api", rateLimits: "1 req/sec for most methods", plans: "Slack workspace + Bot Token with channels:write scope", errorCodes: [["invalid_auth", "Invalid or revoked bot token"], ["channel_not_found", "Bot not invited to the channel"], ["rate_limited", "Slow down — implement Retry-After header"]] },
  teams: { baseUrl: "https://smba.trafficmanager.net/apis", rateLimits: "1,500 msgs/sec, 3,600/hour per app", plans: "Microsoft 365 or Azure AD + Teams app registration", errorCodes: [["401", "Invalid or expired access token"], ["403", "Bot not added to team or channel"], ["429", "Too many requests — respect Retry-After header"]] },
};

function getApiDetails(item: IntegItem): ApiDetails {
  return (
    API_DETAILS[item.id] || {
      baseUrl: "https://api." + item.id.replace("-", "") + ".com/v1",
      rateLimits: "Refer to provider documentation",
      plans: "Paid account required",
      errorCodes: [["401", "Invalid credentials"], ["429", "Rate limit exceeded"], ["400", "Invalid request parameters"]],
    }
  );
}

interface CodeExample {
  lang: string;
  code: string;
}

function getCodeExample(item: IntegItem): CodeExample {
  const api = getApiDetails(item);
  if (item.authType === "oauth") {
    return {
      lang: "JavaScript (fetch)",
      code: `<span class="c-comment">// InfoGenie — ${item.name} API request example</span>
<span class="c-kw">const</span> response = <span class="c-kw">await</span> fetch(
  <span class="c-str">'${api.baseUrl}/campaigns'</span>,
  {
    <span class="c-key">method</span>: <span class="c-str">'GET'</span>,
    <span class="c-key">headers</span>: {
      <span class="c-str">'Authorization'</span>: <span class="c-str">'Bearer YOUR_OAUTH_ACCESS_TOKEN'</span>,
      <span class="c-str">'Content-Type'</span>: <span class="c-str">'application/json'</span>
    }
  }
);
<span class="c-kw">const</span> data = <span class="c-kw">await</span> response.json();
console.log(data); <span class="c-comment">// InfoGenie uses this to sync campaign data</span>`,
    };
  }
  const keyFormat = item.placeholder ? item.placeholder.split(" ")[0] : "YOUR_API_KEY";
  return {
    lang: "cURL",
    code: `<span class="c-comment"># InfoGenie — ${item.name} connection test</span>
curl -X GET <span class="c-str">'${api.baseUrl}'</span> \\
  -H <span class="c-str">'Authorization: Bearer ${keyFormat}'</span> \\
  -H <span class="c-str">'Content-Type: application/json'</span>

<span class="c-comment"># Expected: 200 OK with account/profile data</span>
<span class="c-comment"># If you see 401: your API key is invalid or has no permissions</span>`,
  };
}

interface TroubleItem {
  q: string;
  a: string;
}

function getTroubleshooting(item: IntegItem): TroubleItem[] {
  const isOAuth = item.authType === "oauth";
  return [
    {
      q: isOAuth ? "OAuth authorisation fails or redirects to an error page" : "My API key is valid but the Test Connection button fails",
      a: isOAuth
        ? "Make sure you are signed in to the correct account in the browser before clicking Connect via OAuth. Also check that your app has the required permissions/scopes listed in Step 3 above."
        : "Ensure you've copied the full key without leading/trailing spaces. Some keys are environment-specific (e.g. sandbox vs. production). Try pasting into a plain text editor first to check for hidden characters.",
    },
    {
      q: "Connected successfully but InfoGenie shows no data",
      a: `Wait 2–5 minutes after first connecting — InfoGenie needs to complete an initial data sync. If data is still missing after 10 minutes, check that your ${item.name} account has at least one active campaign or dataset.`,
    },
    {
      q: "I see a rate limit error in the activity log",
      a: `${item.name} rate limits: ${getApiDetails(item).rateLimits}. InfoGenie automatically spaces out requests. If you see persistent rate limit errors, check that no other tools are simultaneously hitting the same API credentials.`,
    },
    {
      q: "How do I disconnect this integration?",
      a: "Disconnecting from InfoGenie only removes the credentials from our system — it does not revoke access in your provider account. To fully revoke, also remove the InfoGenie app from your " + item.name + " account settings.",
    },
  ];
}

// ── API key validators (ported from app.js API_VALIDATORS) ───────────────────
function fmtOk(message: string): ValidatorResult { return { status: "format-ok", message }; }
function rej(message: string): ValidatorResult { return { status: "rejected", message }; }
function ok(message: string): ValidatorResult { return { status: "verified", message }; }
function unv(message: string): ValidatorResult { return { status: "unverifiable", message }; }

interface MetaGraphResponse {
  id?: string;
  error?: { message?: string };
}

const API_VALIDATORS: Record<string, Validator> = {
  "youtube-data": async (key) => {
    if (!key.startsWith("AIza")) return rej('Invalid format — YouTube Data API keys start with "AIza"');
    if (key.length < 39) return rej("Key too short — YouTube Data API keys are 39 characters. Check you copied it in full.");
    try {
      const r = await fetch(`/api/settings/api-key/youtube-data/test?key=${encodeURIComponent(key)}`);
      const data = (await r.json()) as { ok: boolean; status?: string; message?: string; error?: string };
      if (!r.ok) return unv(data.error || "Could not reach the test endpoint");
      if (data.status === "verified") return ok(data.message || "YouTube Data API key confirmed live — connection active");
      if (data.status === "rejected") return rej(data.message || "YouTube rejected this key");
      return unv(data.message || "Could not verify the key — check your internet connection");
    } catch {
      return unv("Could not reach the YouTube API test endpoint — check your connection");
    }
  },
  mistral: async (key) => {
    if (key.length < 32) return rej("Key too short — Mistral API keys are 32 characters");
    if (!/^[A-Za-z0-9]+$/.test(key)) return rej("Invalid characters — Mistral keys are alphanumeric only");
    try {
      const r = await fetch("https://api.mistral.ai/v1/models", { headers: { Authorization: "Bearer " + key } });
      if (r.status === 200) return ok("Mistral API key confirmed live — connection active");
      if (r.status === 401) return rej("Mistral rejected this key — check it is correct and has not been revoked");
      return rej(`Mistral returned HTTP ${r.status}`);
    } catch {
      return unv("Could not reach Mistral — check your internet connection");
    }
  },
  elevenlabs: async (key) => {
    if (key.length < 32) return rej("Key too short — ElevenLabs API keys are at least 32 characters");
    if (!/^[a-f0-9]+$/i.test(key)) return rej("Invalid format — ElevenLabs API keys are hexadecimal strings (a-f, 0-9 only)");
    try {
      const r = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key } });
      if (r.status === 200) return ok("ElevenLabs key confirmed live — connection active");
      if (r.status === 401) return rej("ElevenLabs rejected this key — it may be incorrect or revoked");
      return rej(`ElevenLabs returned HTTP ${r.status}`);
    } catch {
      return unv("Could not reach ElevenLabs — check your internet connection");
    }
  },
  stability: (key) => {
    if (!key.startsWith("sk-")) return rej('Invalid format — Stability keys typically start with "sk-"');
    if (key.length < 20) return rej("Key too short — check you copied it in full");
    return unv("Stability AI does not allow browser-side API validation. Key format looks plausible — actual validity will be confirmed on first image generation request.");
  },
  adcreative: (key) => {
    if (key.length < 30) return rej("Key too short — AdCreative.ai API keys are typically 40+ characters");
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return rej("Invalid characters — AdCreative.ai keys contain only letters, numbers, underscores, and hyphens");
    return unv("AdCreative.ai does not allow browser-side API validation. Key format looks plausible — actual validity will be confirmed on first creative generation request.");
  },
  jasper: (key) => {
    if (key.length < 30) return rej("Key too short — Jasper API keys are typically 40+ characters");
    return unv("Jasper does not allow browser-side API validation. Key length looks plausible — actual validity will be confirmed on first copy generation request.");
  },
  copyai: (key) => {
    if (key.length < 30) return rej("Key too short — Copy.ai API keys are typically 40+ characters");
    return unv("Copy.ai does not allow browser-side API validation. Key length looks plausible — actual validity will be confirmed on first workflow run.");
  },
  artlist: (key) => {
    if (key.length < 30) return rej("Key too short — Artlist Enterprise keys are 40+ characters");
    return unv("Artlist does not allow browser-side API validation. Key length looks plausible — actual validity will be confirmed on first asset request.");
  },
  canva: (key) => {
    if (key.length < 8) return rej("Value too short — paste your Canva Client ID, or leave blank and use OAuth Connect.");
    return unv("Canva Connect uses Client ID + Secret on the server. Client ID format looks plausible — use Create → Canva → Connect for OAuth.");
  },
  runway: (key) => {
    if (key.length < 30) return rej("Key too short — Runway ML API keys are typically 40+ characters. Check you copied it in full.");
    return unv("Runway ML does not allow browser-side API validation. Key length looks correct — actual validity will be confirmed on first video generation request.");
  },
  heygen: (key) => {
    if (key.length < 20) return rej("Key too short — check you copied the full HeyGen API key.");
    return unv("HeyGen keys are validated on first AI Video render.");
  },
  xai: (key) => {
    if (key.length < 20) return rej("Key too short — xAI keys are typically longer. Copy the full key.");
    return unv("xAI/Grok keys are validated on the first Grok probe.");
  },
  fireflies: (key) => {
    if (key.length < 20) return rej("Key too short — paste the full Fireflies API key.");
    return unv("Fireflies keys are validated on transcript ingest.");
  },
  deepl: (key) => {
    if (key.length < 16) return rej("Key too short — DeepL auth keys are longer (free keys end with :fx).");
    return unv("DeepL keys are validated on the first translate call.");
  },
  notion: (key) => {
    if (!/^secret_/.test(key) && key.length < 40) return rej("Notion internal tokens usually start with secret_ — check you copied the integration token.");
    return unv("Notion tokens are validated when exporting a page.");
  },
  semrush: (key) => {
    if (!/^[a-f0-9]{32}$/i.test(key)) return rej("Invalid format — Semrush API keys are exactly 32 hexadecimal characters (a-f, 0-9). Check you copied the full key.");
    return unv("Semrush does not allow browser-side API calls. The key matches the correct 32-character hex format — actual validity will be confirmed on the first keyword data request.");
  },
  brandwatch: (key) => {
    if (key.length < 40) return rej("Key too short — Brandwatch API tokens are typically 60+ characters. Check you copied it in full.");
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return rej("Invalid characters — Brandwatch tokens contain only letters, numbers, underscores, and hyphens");
    return unv("Brandwatch does not allow browser-side API calls (CORS policy). Key format looks plausible — actual validity will be confirmed on the first social listening query.");
  },
  "meta-ad-library": async (key) => {
    if (key.length < 50) return rej("Token too short — Meta access tokens are typically 150+ characters");
    try {
      const r = await fetch(`https://graph.facebook.com/me?access_token=${encodeURIComponent(key)}`);
      const data = (await r.json()) as MetaGraphResponse;
      if (data.id) return ok(`Meta token confirmed live — connected as user ID ${data.id}. Ad Library access is active.`);
      if (data.error) return rej(`Meta rejected this token: ${data.error.message}`);
      return rej("Meta token validation failed — check it has Ad Library read permissions");
    } catch {
      return unv("Could not reach Meta Graph API — check your internet connection");
    }
  },
  "tiktok-ads": (key) => {
    if (key.length < 60) return rej("Token too short — TikTok access tokens are typically 100+ characters. Check you copied it in full.");
    return unv("TikTok does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on the first ad deployment.");
  },
  "x-ads": (key) => {
    if (key.length < 80) return rej("Bearer token too short — Twitter Bearer tokens are typically 100+ characters. Check you copied it in full.");
    return unv("Twitter/X does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on the first ad push.");
  },
  "amazon-ads": (key) => {
    if (key.length < 60) return rej("Token too short — Amazon refresh tokens are typically 100+ characters. Check you copied it in full.");
    return unv("Amazon Ads tokens cannot be validated from the browser. Token length looks correct — actual validity will be confirmed on the first campaign sync.");
  },
  pipedrive: async (key) => {
    if (!/^[a-f0-9]{40}$/i.test(key)) return rej("Invalid format — Pipedrive API tokens are exactly 40 hexadecimal characters");
    try {
      const r = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${encodeURIComponent(key)}`);
      const data = (await r.json()) as { success?: boolean; data?: { name?: string }; error?: string };
      if (data.success && data.data) return ok(`Pipedrive key confirmed live — connected as ${data.data.name || "user"}`);
      if (!data.success) return rej(`Pipedrive rejected this key: ${data.error || "invalid token"}`);
      return rej("Pipedrive validation failed — check the key is correct");
    } catch {
      return unv("Could not reach Pipedrive — check your internet connection");
    }
  },
  sendgrid: (key) => {
    if (!key.startsWith("SG.")) return rej('Invalid format — SendGrid API keys always start with "SG." followed by two dot-separated base64 strings');
    if (key.length < 60) return rej("Key too short — SendGrid keys are typically 70+ characters. Check you copied it in full.");
    if ((key.match(/\./g) || []).length < 2) return rej('Invalid format — SendGrid keys have the structure "SG.xxxx.xxxx" with exactly 2 dots');
    return unv('SendGrid does not allow browser-side API validation. Key matches the correct "SG.xxxx.xxxx" format — actual validity will be confirmed on first email send.');
  },
  intercom: (key) => {
    if (key.length < 40) return rej("Token too short — Intercom access tokens are typically 50+ characters. Check you copied it in full.");
    return unv("Intercom does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on first contact sync.");
  },
  whatsapp: (key) => {
    if (key.length < 80) return rej("Token too short — WhatsApp Business API tokens are typically 150+ characters. Check you copied it in full.");
    return unv("WhatsApp Business API tokens cannot be validated from the browser. Token length looks correct — actual validity will be confirmed on first message send.");
  },
  telegram: (key) => {
    if (!/^\d{8,12}:[A-Za-z0-9_-]{35}$/.test(key)) return rej('Invalid format — Telegram bot tokens follow the exact pattern "123456789:ABCDef..." (8–12 digit bot ID, colon, then exactly 35 alphanumeric characters). Get yours from @BotFather on Telegram.');
    return unv("Token matches the correct Telegram bot format — actual validity will be confirmed on first message send. You can also test your bot by messaging it directly in Telegram.");
  },
  teams: (key) => {
    if (!key.startsWith("https://")) return rej('Invalid format — Teams webhook URLs must start with "https://"');
    if (!key.includes("webhook.office.com") && !key.includes("logic.azure.com")) return rej('Invalid URL — Teams Incoming Webhook URLs must contain "webhook.office.com". Logic App URLs contain "logic.azure.com".');
    return unv("Teams webhook URL matches the correct format — actual delivery will be confirmed on first alert event.");
  },
  zapier: (key) => {
    if (key.length < 30) return rej("Key too short — Zapier API keys are typically 40+ characters. Check you copied it in full.");
    return unv("Zapier does not allow browser-side API validation. Key length looks correct — actual validity will be confirmed on first Zap trigger.");
  },
  make: (key) => {
    if (key.length < 20) return rej("Token too short — Make API tokens are typically 30+ characters. Check you copied it in full.");
    return unv("Make does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on first scenario run.");
  },
  segment: (key) => {
    if (key.length < 20) return rej("Write Key too short — Segment write keys are typically 22 characters. Check you copied it in full.");
    return unv("Segment write keys cannot be validated from the browser. Key length looks correct — actual validity will be confirmed on first event send.");
  },
  apify: async (key) => {
    if (!key.startsWith("apify_api_")) return rej('Invalid format — Apify API tokens start with "apify_api_"');
    if (key.length < 40) return rej("Key too short — Apify API tokens are typically 50+ characters. Check you copied it in full.");
    try {
      const r = await fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(key)}`);
      if (r.status === 200) {
        const d = (await r.json()) as { data?: { username?: string; profile?: { name?: string } } };
        const name = d.data?.username || d.data?.profile?.name || "user";
        return ok(`Apify token confirmed live — connected as ${name}`);
      }
      if (r.status === 401) return rej("Apify rejected this token — check it is correct and active in console.apify.com → Settings → API tokens");
      return rej(`Apify returned HTTP ${r.status} — check the token is valid`);
    } catch {
      return unv("Could not reach Apify — token format looks correct, validity will be confirmed on first scrape");
    }
  },
};

function defaultValidator(key: string): ValidatorResult {
  if (/^\s|\s$/.test(key)) return rej("Key has leading or trailing spaces — please paste it again without extra whitespace");
  if (key.length < 16) return rej("Key too short — most API keys are at least 20 characters. Check you copied it in full.");
  return unv("This integration cannot be validated from the browser. Key length looks correct — actual validity will be confirmed when InfoGenie first calls this API.");
}

// ── Minimal markup → JSX parser (replaces innerHTML for the embedded HTML in
// step text + the syntax-highlighted code example). Handles <a>, <strong>,
// <code>, <span class>, <br> and HTML entities only — no innerHTML. ──────────
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, "\u00a0");
}

const TAG_RE = /<(a|strong|code|span)\b([^>]*)>([\s\S]*?)<\/\1>|<br\s*\/?>/;

function parseMarkup(html: string, keyPrefix = "k"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = html;
  let i = 0;
  while (rest.length) {
    const m = rest.match(TAG_RE);
    if (!m || m.index === undefined) {
      nodes.push(decodeEntities(rest));
      break;
    }
    if (m.index > 0) nodes.push(decodeEntities(rest.slice(0, m.index)));
    const k = `${keyPrefix}-${i}`;
    if (m[0].toLowerCase().startsWith("<br")) {
      nodes.push(<br key={k} />);
    } else {
      const tag = m[1];
      const attrs = m[2] || "";
      const inner = m[3] || "";
      const children = parseMarkup(inner, k);
      if (tag === "a") {
        const href = (attrs.match(/href="([^"]*)"/) || [])[1] || "#";
        nodes.push(
          <a key={k} href={safeUrl(href)} target="_blank" rel="noopener">
            {children}
          </a>,
        );
      } else if (tag === "strong") {
        nodes.push(<strong key={k}>{children}</strong>);
      } else if (tag === "code") {
        nodes.push(<code key={k}>{children}</code>);
      } else {
        const cls = (attrs.match(/class="([^"]*)"/) || [])[1];
        nodes.push(
          <span key={k} className={cls}>
            {children}
          </span>,
        );
      }
    }
    rest = rest.slice(m.index + m[0].length);
    i++;
  }
  return nodes;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

function findIntegById(id: string): { item: IntegItem; catKey: string; catLabel: string; catIcon: string } | null {
  for (const [catKey, cat] of Object.entries(INTEGRATIONS)) {
    const item = cat.items.find((it) => it.id === id);
    if (item) return { item, catKey, catLabel: cat.label, catIcon: cat.icon };
  }
  return null;
}

function listVaultSaveIds(): string[] {
  const ids: string[] = [];
  for (const cat of Object.values(INTEGRATIONS)) {
    for (const item of cat.items) {
      if (item.vaultSave) ids.push(item.id);
    }
  }
  return ids;
}

type ConnState = Record<string, "1" | "oauth">;

function readStoredState(): ConnState {
  const out: ConnState = {};
  if (typeof localStorage === "undefined") return out;
  for (const cat of Object.values(INTEGRATIONS)) {
    for (const item of cat.items) {
      try {
        const v = localStorage.getItem("ig_integ_" + item.id);
        if (v === "1" || v === "oauth") out[item.id] = v;
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

export default function Settings() {
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<string>(Object.keys(INTEGRATIONS)[0]);
  const [connected, setConnected] = useState<ConnState>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [apiHealth, setApiHealth] = useState<ReactNode>(
    <>
      <span style={{ color: "var(--green)", fontSize: "1rem" }}>●</span>&nbsp;Checking API connections…
    </>,
  );
  const [docsOpen, setDocsOpen] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);
  /** Platforms with a key stored in the server vault (raw key is never returned). */
  const [vaultConfigured, setVaultConfigured] = useState<Record<string, boolean>>({});

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const markConnected = useCallback((id: string, value: "1" | "oauth") => {
    try {
      localStorage.setItem("ig_integ_" + id, value);
    } catch {
      /* ignore */
    }
    setConnected((prev) => {
      const authType = findIntegById(id)?.item.authType;
      return { ...prev, [id]: authType === "oauth" ? "oauth" : value };
    });
  }, []);

  // Restore stored connection state + server-detected integrations + API health.
  useEffect(() => {
    let cancelled = false;
    setConnected(readStoredState());

    (async () => {
      const status = await apiGet<IntegrationsStatus>("/api/integrations/status");
      if (cancelled) return;
      const configured = Array.isArray(status.configured) ? status.configured : [];
      if (configured.length) {
        setConnected((prev) => {
          const next = { ...prev };
          for (const id of configured) {
            if (!next[id]) {
              const authType = findIntegById(id)?.item.authType;
              const val: "1" | "oauth" = authType === "oauth" ? "oauth" : "1";
              next[id] = val;
              try {
                localStorage.setItem("ig_integ_" + id, val);
              } catch {
                /* ignore */
              }
            }
          }
          return next;
        });
      }
    })();

    // Vault is the source of truth for vaultSave platforms (survives new tunnel
    // origins / cleared localStorage). GET never returns the raw key — only
    // configured:true|false — so mark Connected and show a saved placeholder.
    (async () => {
      const ids = listVaultSaveIds();
      const results = await Promise.all(
        ids.map(async (id) => {
          const r = await apiGet<VaultStatusResult>(`/api/settings/api-key/${encodeURIComponent(id)}`);
          return { id, configured: !!(r.ok && r.configured) };
        }),
      );
      if (cancelled) return;
      const vaultNext: Record<string, boolean> = {};
      setConnected((prev) => {
        const next = { ...prev };
        for (const { id, configured } of results) {
          vaultNext[id] = configured;
          if (configured) {
            next[id] = "1";
            try {
              localStorage.setItem("ig_integ_" + id, "1");
            } catch {
              /* ignore */
            }
          }
        }
        return next;
      });
      setVaultConfigured(vaultNext);
    })();

    (async () => {
      const data = await apiGet<ApiStatus>("/api/status");
      if (cancelled) return;
      if (data && (data.dataforseo !== undefined || data.rapidapi !== undefined)) {
        const dfColor = data.dataforseo ? "#10B981" : "#DC2626";
        const rapColor = data.rapidapi ? "#10B981" : "#F59E0B";
        const dfLabel = data.dataforseo ? "✓ Connected" : "✗ Not configured";
        const rapLabel = data.rapidapi ? "✓ Connected" : "! Key missing";
        const allOk = !!data.dataforseo && !!data.rapidapi;
        setApiHealth(
          <>
            <span style={{ color: allOk ? "#10B981" : "#F59E0B", fontSize: "1rem" }}>●</span>
            &nbsp;API Status:&nbsp;
            <span style={{ color: dfColor, fontWeight: 700 }}>DataForSEO {dfLabel}</span>
            &nbsp;·&nbsp;
            <span style={{ color: rapColor, fontWeight: 700 }}>RapidAPI {rapLabel}</span>
            &nbsp;·&nbsp;
            <span style={{ color: "#10B981", fontWeight: 700 }}>AI Engine Online</span>
          </>,
        );
      } else {
        setApiHealth(
          <>
            <span style={{ color: "#F59E0B" }}>●</span>&nbsp;API health check unavailable — server is running
          </>,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const connectedCount = Object.keys(connected).length;

  async function testConnection(id: string) {
    const key = (inputs[id] || "").trim();
    if (!key) {
      toast("⚠️ Please enter your API key first");
      return;
    }
    setTesting((p) => ({ ...p, [id]: true }));
    toast("🔄 Contacting " + id + " API…");
    try {
      const validator = API_VALIDATORS[id];
      const result = await Promise.resolve(typeof validator === "function" ? validator(key) : defaultValidator(key));
      if (result.status === "verified") toast("✅ " + result.message);
      else if (result.status === "rejected") toast("❌ " + result.message);
      else toast("⚠️ Cannot verify live: " + result.message);
    } catch (e) {
      toast("❌ Validation error — " + (e instanceof Error ? e.message : "unexpected error"));
    } finally {
      setTesting((p) => ({ ...p, [id]: false }));
    }
  }

  async function connectVault(id: string, name: string) {
    const key = (inputs[id] || "").trim();
    if (!key) {
      toast("⚠️ Please enter your API key before connecting");
      return;
    }
    setSaving((p) => ({ ...p, [id]: true }));
    const r = await apiPost<VaultSaveResult>("/api/settings/api-key", { platform: id, key });
    if (!r.ok) {
      setSaving((p) => ({ ...p, [id]: false }));
      const err = r.error || "unknown error";
      if (err === "Login required" || /login|unauthorized|401/i.test(err)) {
        toast("❌ Sign in to save API keys — they are stored in your workspace vault");
      } else if (err === "no_tenant") {
        toast("❌ No workspace selected — pick a tenant, then Connect again");
      } else if (/DATABASE_URL|no DATABASE/i.test(err)) {
        toast("❌ Database not configured — cannot persist API keys");
      } else {
        toast("❌ Could not save key: " + err);
      }
      return;
    }
    markConnected(id, "1");
    setVaultConfigured((p) => ({ ...p, [id]: true }));
    // Never keep the raw key in React state after a successful vault write.
    setInputs((p) => ({ ...p, [id]: "" }));
    setSaving((p) => ({ ...p, [id]: false }));
    toast(
      `✅ ${name} key saved to your workspace — ${id === "apify" ? "TikTok Organic Monitor and Local Lead Finder are now active" : name + " stays connected after reload"}`,
    );
  }

  function connectCard(id: string, name: string) {
    const key = (inputs[id] || "").trim();
    if (!key) {
      toast("⚠️ Please enter your API key before connecting");
      return;
    }
    markConnected(id, "1");
    const liveMsg =
      id === "semrush"
        ? "✅ Semrush connected — Keyword Gap table now shows live data"
        : id === "brandwatch"
          ? "✅ Brandwatch connected — Signal Feed and SOV chart now show live monitoring"
          : id === "meta-ad-library"
            ? "✅ Meta Ad Library connected — competitor ads now pulled live from Facebook"
            : `✅ ${name} connected — InfoGenie is now using this integration`;
    toast(liveMsg);
  }

  function connectOAuth(id: string, name: string) {
    markConnected(id, "oauth");
    toast(`✅ ${name} connected via OAuth — campaigns can now be deployed automatically`);
  }

  function openIntegrationDoc(id: string) {
    if (!findIntegById(id)) {
      toast("Integration not found");
      return;
    }
    setDocId(id);
    setDocsOpen(true);
  }

  function openDocsModal() {
    setDocId(null);
    setDocsOpen(true);
  }

  function closeDocsModal() {
    setDocsOpen(false);
  }

  function goToCard(catKey: string, id: string) {
    closeDocsModal();
    setActiveTab(catKey);
    setTimeout(() => {
      const el = cardRefs.current[id];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }

  function copyCode(code: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(
        () => toast("📋 Code copied"),
        () => toast("⚠️ Could not copy"),
      );
    }
  }

  const cats = Object.entries(INTEGRATIONS);

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span> Settings
              </div>
              <h2 className="view-title">Integrations & Settings</h2>
              <p className="view-sub">
                Connect APIs, AI models, and tools to power InfoGenie&apos;s full intelligence engine
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="settings-page">
          <div className="integ-summary-bar">
            <div
              className="isb-item"
              title="Total number of third-party services you have connected to InfoGenie. Each connection unlocks live data, AI features, or direct campaign deployment."
            >
              <span className="isb-count" id="connectedCount">
                {connectedCount}
              </span>{" "}
              integrations connected
            </div>
            <div className="isb-divider" />
            <div
              className="isb-item"
              id="apiHealthDisplay"
              title="Live status of all connected API credentials — green means all connections are healthy and responsive."
            >
              {apiHealth}
            </div>
            <div className="isb-divider" />
            <div
              className="isb-item"
              title="Recommended minimum setup — connecting one ad platform lets InfoGenie push campaigns live; connecting an AI model enables Creative Studio and AI brief generation."
            >
              <span style={{ color: "var(--gold)" }}>⚡</span>&nbsp;Tip: Connect at least{" "}
              <strong>one Ad Platform</strong> + <strong>one AI Model</strong> to enable full autonomous operation
            </div>
            <div className="isb-cta" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn-primary" onClick={openDocsModal}>
                📖 Full Docs
              </button>
              <a
                className="btn-primary"
                href="/source"
                target="_blank"
                rel="noopener"
                style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", border: "1px solid rgba(0,229,255,0.3)" }}
              >
                🧾 View Source Code
              </a>
            </div>
          </div>

          <div className="settings-tab-bar">
            {cats.map(([key, cat]) => (
              <button
                key={key}
                className={`stab ${activeTab === key ? "active" : ""}`}
                data-tab={key}
                onClick={() => setActiveTab(key)}
              >
                <span className="stab-icon">{cat.icon}</span>
                <span className="stab-label">{cat.label}</span>
                <span className="stab-count">{cat.items.length}</span>
              </button>
            ))}
          </div>

          {cats.map(([key, cat]) => (
            <div key={key} className={`integ-panel ${activeTab === key ? "active" : ""}`} id={`panel-${key}`}>
              <div className="integ-category-header">
                <div className="ich-icon">{cat.icon}</div>
                <div className="ich-text">
                  <div className="ich-title">{cat.label}</div>
                  <div className="ich-sub">{cat.desc}</div>
                </div>
                <div className="ich-badge">{cat.badge}</div>
              </div>
              <div className="integ-cards-grid">
                {cat.items.map((item) => {
                  const isApiKey = item.authType === "apikey";
                  const isConn = !!connected[item.id];
                  const isOAuthBtn = item.authType === "oauth";
                  return (
                    <div
                      key={item.id}
                      className={`integ-card${isConn ? " connected" : ""}`}
                      id={`card-${item.id}`}
                      ref={(el) => {
                        cardRefs.current[item.id] = el;
                      }}
                    >
                      <div className="integ-card-top">
                        <div className="integ-logo">{item.logo}</div>
                        <div className="integ-meta">
                          <div className="integ-name">{item.name}</div>
                          <div className="integ-tagline">{item.tagline}</div>
                        </div>
                        <div
                          className={`integ-conn-status ${isConn ? "ics-live" : "ics-off"}`}
                          id={`status-${item.id}`}
                        >
                          <span>{isConn ? "●" : "○"}</span> {isConn ? "Connected" : "Not connected"}
                        </div>
                      </div>
                      <div className="integ-card-body">
                        <div className="unlocks-title">✦ What it unlocks in InfoGenie</div>
                        <ul className="unlocks-list">
                          {item.unlocks.map((u, ui) => (
                            <li key={ui}>
                              <span className="ul-check">✓</span>
                              <span>{u}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="steps-title">↳ How to integrate</div>
                        <div className="steps-list">
                          {item.steps.map((s, si) => (
                            <div className="step-item" key={si}>
                              <div className="step-num">{si + 1}</div>
                              <div className="step-text">{parseMarkup(s.text, `s${si}`)}</div>
                            </div>
                          ))}
                        </div>
                        {isApiKey ? (
                          <>
                            <div className="api-key-row">
                              <input
                                type="password"
                                className="api-key-inp"
                                placeholder={
                                  item.vaultSave && vaultConfigured[item.id]
                                    ? "Key saved on server — paste a new key to replace"
                                    : item.placeholder || "Paste your API Key here..."
                                }
                                id={`inp-${item.id}`}
                                value={inputs[item.id] || ""}
                                onChange={(e) => setInputs((p) => ({ ...p, [item.id]: e.target.value }))}
                                autoComplete="off"
                              />
                              <button
                                className="btn-test"
                                disabled={!!testing[item.id]}
                                onClick={() => testConnection(item.id)}
                              >
                                {testing[item.id] ? "Testing…" : "Test"}
                              </button>
                            </div>
                            <div className="integ-card-actions">
                              <button
                                className={`btn-connect-card${isConn ? " btn-connected-card" : ""}`}
                                id={`btn-${item.id}`}
                                disabled={!!saving[item.id]}
                                onClick={() =>
                                  item.vaultSave ? connectVault(item.id, item.name) : connectCard(item.id, item.name)
                                }
                              >
                                {saving[item.id] ? "Saving…" : isConn ? "✓ Connected" : "Connect"}
                              </button>
                              <button className="btn-docs-card" onClick={() => openIntegrationDoc(item.id)}>
                                📖 View Docs
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="integ-card-actions" style={{ flexDirection: "column", gap: 8 }}>
                            <button
                              className={`oauth-btn${isConn ? " connected" : ""}`}
                              id={`btn-${item.id}`}
                              onClick={() => connectOAuth(item.id, item.name)}
                            >
                              {isConn ? (
                                <>
                                  <span>✓</span> Connected via OAuth
                                </>
                              ) : (
                                <>
                                  <span>🔐</span> Connect via OAuth
                                </>
                              )}
                            </button>
                            <button
                              className="btn-docs-card"
                              style={{ width: "100%", textAlign: "center" }}
                              onClick={() => openIntegrationDoc(item.id)}
                            >
                              📖 View Integration Docs
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="acct-settings-section">
            <div className="acct-settings-header">
              <div className="acct-settings-title">⚙️ InfoGenie Account Settings</div>
              <div className="acct-settings-sub">
                Configure your AI engine preferences, compliance settings, and notification rules
              </div>
            </div>
            <div className="settings-form">
              <div className="sf-row">
                <div className="sf-group">
                  <label title="Your company or brand name — used to personalise AI-generated content, briefs, and reports throughout InfoGenie.">
                    Business Name
                  </label>
                  <input
                    type="text"
                    className="sf-input"
                    placeholder="Your Company Name"
                    id="sfBizName"
                    title="Enter your brand name as it should appear in campaign briefs, AI creative, and exported reports."
                  />
                </div>
                <div className="sf-group">
                  <label title="Your primary advertising market — InfoGenie uses this to filter keyword data, benchmark costs, and recommend localised audiences.">
                    Default Target Region
                  </label>
                  <select
                    className="sf-select"
                    id="sfRegion"
                    defaultValue="global"
                    title="Sets the default geography for all new campaign projections, CPC benchmarks, and audience sizing estimates."
                  >
                    <option value="global">🌍 Global</option>
                    <option value="us">🇺🇸 United States</option>
                    <option value="uk">🇬🇧 United Kingdom</option>
                    <option value="au">🇦🇺 Australia</option>
                    <option value="za">🇿🇦 South Africa</option>
                    <option value="ae">🇦🇪 UAE</option>
                    <option value="sg">🇸🇬 Singapore</option>
                    <option value="de">🇩🇪 Germany</option>
                    <option value="ca">🇨🇦 Canada</option>
                    <option value="fr">🇫🇷 France</option>
                  </select>
                </div>
              </div>
              <div className="sf-row">
                <div className="sf-group">
                  <label title="Your total monthly advertising budget across all channels — used to generate ROAS projections, daily spend caps, and budget allocation recommendations.">
                    Monthly Ad Budget (USD)
                  </label>
                  <input
                    type="number"
                    className="sf-input"
                    placeholder="e.g. 5000"
                    id="sfBudget"
                    title="InfoGenie uses this figure to calculate per-campaign budget splits, project expected revenue, and flag overspend risks."
                  />
                </div>
                <div className="sf-group">
                  <label title="Your InfoGenie subscription tier — determines the number of competitors tracked, AI calls per month, and available integrations.">
                    Subscription Plan
                  </label>
                  <select
                    className="sf-select"
                    id="sfPlan"
                    defaultValue="Professional — $399/mo"
                    title="Upgrade your plan to unlock higher API limits, more competitor slots, and dedicated support."
                  >
                    <option>Professional — $399/mo</option>
                    <option>Starter — $99/mo</option>
                    <option>Agency — $999/mo</option>
                    <option>Enterprise — Custom</option>
                  </select>
                </div>
              </div>
              <div className="sf-row">
                <div className="sf-group">
                  <label title="The AI model powering InfoGenie's creative generation, brief writing, and analysis. GPT-4o is recommended for best performance.">
                    Primary AI Model
                  </label>
                  <select
                    className="sf-select"
                    defaultValue="OpenAI GPT-4o (Recommended)"
                    title="Switch between GPT-4o, Claude, Gemini, or Mistral — each model has different strengths for creative versus analytical tasks."
                  >
                    <option>OpenAI GPT-4o (Recommended)</option>
                    <option>Anthropic Claude 3.5 Sonnet</option>
                    <option>Google Gemini Pro</option>
                    <option>Mistral Large</option>
                  </select>
                </div>
                <div className="sf-group">
                  <label title="Weekly or monthly intelligence reports will be sent to this email address.">
                    Report Delivery Email
                  </label>
                  <input
                    type="email"
                    className="sf-input"
                    placeholder="you@company.com"
                    title="Receive scheduled competitor intelligence digests, campaign performance summaries, and keyword shift alerts at this address."
                  />
                </div>
              </div>
              <button
                className="sf-save"
                onClick={() => toast("✅ Settings saved — InfoGenie AI engine updated")}
                title="Save all account settings — changes apply immediately to all future AI generations, projections, and campaign briefs."
              >
                Save Account Settings
              </button>
            </div>
            {[
              {
                name: "Autonomous Campaign Optimisation",
                desc: "Allow InfoGenie AI to automatically pause underperformers and reallocate budget 24/7",
              },
              {
                name: "Real-time Competitor Monitoring",
                desc: "Alert me instantly when competitors launch new campaigns or change their ad spend",
              },
              {
                name: "AI Creative Auto-generation",
                desc: "Automatically generate and test new creatives when performance drops below your ROAS threshold",
              },
              {
                name: "Weekly Intelligence Reports",
                desc: "Receive a full competitor intelligence digest every Monday morning",
              },
              {
                name: "GDPR / CCPA / POPIA Compliance Mode",
                desc: "Enforce data privacy compliance on all campaigns, integrations, and audience targeting",
              },
              {
                name: "Multi-region Campaign Compliance Check",
                desc: "Auto-validate campaigns against local advertising regulations before launch",
              },
            ].map((t) => (
              <div className="toggle-row" key={t.name}>
                <div className="toggle-info">
                  <div className="toggle-name">{t.name}</div>
                  <div className="toggle-desc">{t.desc}</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" defaultChecked />
                  <span className="toggle-slider" />
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {docsOpen && (
        <div className="modal-backdrop" id="docsModal" style={{ display: "flex" }}>
          <div className="modal-box docs-modal-box">
            <button className="modal-x" onClick={closeDocsModal}>
              ✕
            </button>
            <div className="docs-modal-inner" id="docsModalInner">
              {docId ? <IntegrationDoc id={docId} onBack={openDocsModal} onGoToCard={goToCard} onCopy={copyCode} /> : <MasterDocs onTab={(k) => { closeDocsModal(); setActiveTab(k); }} onDoc={openIntegrationDoc} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface MasterDocsProps {
  onTab: (key: string) => void;
  onDoc: (id: string) => void;
}

function MasterDocs({ onTab, onDoc }: MasterDocsProps) {
  const tiles: Array<{ key: string; icon: string; name: string; count: string; desc: string }> = [
    { key: "platforms", icon: "🚀", name: "Ad Platforms", count: "7", desc: "Google Ads, Meta, TikTok, LinkedIn, X, Pinterest, Amazon — deploy campaigns autonomously across all major platforms." },
    { key: "intelligence", icon: "🔍", name: "Intelligence APIs", count: "6", desc: "Semrush, SimilarWeb, Ahrefs, BuiltWith, SpyFu, Moz — power competitor analysis with real traffic and keyword data." },
    { key: "ai", icon: "🤖", name: "AI Models", count: "6", desc: "OpenAI, Claude, Gemini, Stability AI, Mistral, ElevenLabs — drive ad copy, creative generation, and strategic reasoning." },
    { key: "crm", icon: "🔗", name: "CRM & Automation", count: "7", desc: "HubSpot, Salesforce, Pipedrive, Klaviyo, Marketo, Zapier, Make — route leads and automate workflows from campaigns." },
    { key: "analytics", icon: "📈", name: "Analytics & Data", count: "7", desc: "GA4, Search Console, Adobe Analytics, Mixpanel, Segment, Hotjar, Amplitude — feed real performance data into InfoGenie." },
    { key: "communication", icon: "💬", name: "Communication", count: "6", desc: "Slack, WhatsApp, Telegram, SendGrid, Microsoft Teams, Intercom — receive alerts and route leads via your preferred channels." },
  ];

  const quickStart: Array<[string, ReactNode]> = [
    ["Run your first analysis", <>Enter any competitor or your own website URL on the Home page and click <strong>Analyse Now</strong>. InfoGenie detects your industry and maps the competitive landscape automatically — no setup required.</>],
    ["Connect at least one Ad Platform", <>Go to <strong>Settings → Ad Platforms</strong> and connect Google Ads or Meta Ads via OAuth. This enables InfoGenie to autonomously deploy, pause, and optimise campaigns on your behalf. OAuth takes under 60 seconds.</>],
    ["Connect an AI Model", <>Go to <strong>Settings → AI Models</strong> and paste your OpenAI API key (starts with <code>sk-proj-</code>). This powers ad copy generation, strategic analysis, and creative recommendations. OpenAI GPT-4o is recommended for best results.</>],
    ["Add an Intelligence API (optional but powerful)", <>Connect Semrush or SimilarWeb under <strong>Settings → Intelligence APIs</strong> to enrich competitor data with real keyword rankings, traffic estimates, and ad spend data. Semrush Business plan or above required for API access.</>],
    ["Launch your first autonomous campaign", <>Navigate to <strong>Campaigns</strong>, choose a recommended campaign, and click <strong>Launch Campaign</strong>. InfoGenie will configure targeting, creative, bidding, and budget automatically based on competitor intelligence — then monitor and optimise 24/7.</>],
  ];

  return (
    <>
      <div className="docs-header">
        <div className="docs-header-title">📖 InfoGenie Integration Documentation</div>
        <div className="docs-header-sub">
          Everything you need to connect InfoGenie to your ad platforms, analytics tools, AI models, and communication
          channels — and start running autonomous campaigns.
        </div>
        <div className="docs-header-badges">
          <span className="docs-badge green">● Platform Online</span>
          <span className="docs-badge">v2.4.1</span>
          <span className="docs-badge">33 Integrations Available</span>
          <span className="docs-badge">REST API + OAuth 2.0</span>
        </div>
      </div>

      <div className="docs-body">
        <div>
          <div className="docs-section-title">🚀 Quick Start — Get live in 15 minutes</div>
          <div className="docs-steps">
            {quickStart.map(([title, desc], i) => (
              <div className="docs-step" key={i}>
                <div className="docs-step-num">{i + 1}</div>
                <div className="docs-step-content">
                  <div className="docs-step-title">{title}</div>
                  <div className="docs-step-desc">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="docs-section-title">🔌 Integration Categories</div>
          <div className="docs-integ-grid">
            {tiles.map((t) => (
              <div className="docs-integ-tile" key={t.key} onClick={() => onTab(t.key)}>
                <div className="dit-header">
                  <span className="dit-icon">{t.icon}</span>
                  <span className="dit-name">{t.name}</span>
                  <span className="dit-count">{t.count}</span>
                </div>
                <div className="dit-desc">{t.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="docs-section-title">📋 All Integrations — Click Any to View Full Docs</div>
          <div className="docs-dir-grid">
            {Object.entries(INTEGRATIONS).flatMap(([, cat]) =>
              cat.items.map((item) => (
                <div className="docs-dir-item" key={item.id} onClick={() => onDoc(item.id)}>
                  <div className="docs-dir-logo">{item.logo}</div>
                  <div className="docs-dir-info">
                    <div className="docs-dir-name">{item.name}</div>
                    <div className="docs-dir-cat">
                      {cat.icon} {cat.label}
                    </div>
                  </div>
                  <span className={`docs-dir-auth ${item.authType}`}>
                    {item.authType === "oauth" ? "OAuth" : "API Key"}
                  </span>
                </div>
              )),
            )}
          </div>
        </div>

        <div>
          <div className="docs-section-title">🔐 Authentication Methods</div>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>How it works</th>
                <th>Used by</th>
                <th>Security</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="dt-badge dt-oauth">OAuth 2.0</span>
                </td>
                <td>
                  One-click connect — InfoGenie requests permissions and securely stores refresh tokens. You never share
                  passwords.
                </td>
                <td>Google Ads, Meta, LinkedIn, Pinterest, HubSpot, Salesforce, Slack, GA4, GSC</td>
                <td>Industry standard. Revoke access anytime from the platform&apos;s security settings.</td>
              </tr>
              <tr>
                <td>
                  <span className="dt-badge dt-apikey">API Key</span>
                </td>
                <td>
                  Generate a key in the platform&apos;s developer console and paste it here. InfoGenie stores it encrypted
                  using AES-256.
                </td>
                <td>OpenAI, Semrush, Ahrefs, TikTok, Klaviyo, SendGrid, Slack webhook, Hotjar, and more</td>
                <td>Keys are stored encrypted. Never share keys with third parties. Rotate keys periodically.</td>
              </tr>
              <tr>
                <td>
                  <span className="dt-badge dt-webhook">Webhook URL</span>
                </td>
                <td>InfoGenie sends event payloads to a URL you provide. Used for one-way notification delivery.</td>
                <td>Slack, Microsoft Teams, Zapier, Make</td>
                <td>Webhook URLs are unique per connection. Rotate by generating a new webhook in the platform.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <div className="docs-section-title">💎 Plan & Integration Limits</div>
          <div className="docs-plan-grid">
            {[
              { name: "Starter", price: "$99/mo", featured: false, feats: ["2 ad platforms", "1 AI model", "1 intelligence API", "1 communication channel", "5 competitor analyses/mo", "Basic AI campaigns"] },
              { name: "Professional", price: "$399/mo", featured: true, feats: ["All ad platforms", "3 AI models", "3 intelligence APIs", "All communication channels", "Unlimited analyses", "Autonomous optimisation"] },
              { name: "Agency", price: "$999/mo", featured: false, feats: ["Everything in Pro", "All 33 integrations", "CRM + Analytics sync", "Up to 25 client accounts", "White-label reports", "Priority support"] },
              { name: "Enterprise", price: "Custom", featured: false, feats: ["Everything in Agency", "Custom AI model training", "Dedicated infrastructure", "Unlimited client accounts", "SLA guarantee", "Custom integrations"] },
            ].map((p) => (
              <div className={`docs-plan-card${p.featured ? " featured" : ""}`} key={p.name}>
                <div className="dpc-header">
                  <div className="dpc-name">{p.name}</div>
                  <div className="dpc-price">{p.price}</div>
                </div>
                <div className="dpc-body">
                  {p.feats.map((f) => (
                    <div className="dpc-feat" key={f}>
                      <span className="dpc-feat-check">✓</span>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            background: "var(--gray-50)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "16px 20px",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <span style={{ fontSize: "1.25rem", flexShrink: 0 }}>🔒</span>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>
              Security & Data Handling
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--gray-500)", lineHeight: 1.6 }}>
              All API keys and OAuth tokens are encrypted at rest using AES-256 and in transit using TLS 1.3. InfoGenie
              never stores raw credentials in plaintext. You can revoke all integration access at any time from this
              settings page. InfoGenie is SOC 2 Type II compliant and GDPR-ready. Your competitor analysis data is never
              shared with third parties or used to train our AI models.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

interface IntegrationDocProps {
  id: string;
  onBack: () => void;
  onGoToCard: (catKey: string, id: string) => void;
  onCopy: (code: string) => void;
}

function IntegrationDoc({ id, onBack, onGoToCard, onCopy }: IntegrationDocProps) {
  const found = findIntegById(id);
  if (!found) return null;
  const { item, catKey, catLabel, catIcon } = found;
  const api = getApiDetails(item);
  const codeEx = getCodeExample(item);
  const trouble = getTroubleshooting(item);
  const authLabel = item.authType === "oauth" ? "OAuth 2.0" : "API Key";
  const authClass = item.authType === "oauth" ? "oauth" : "apikey";

  return (
    <div className="integ-doc-page">
      <div className="integ-doc-hero">
        <div className="integ-doc-hero-top">
          <button className="integ-doc-back" onClick={onBack}>
            ← All Integrations
          </button>
          <div className="integ-doc-logo">{item.logo}</div>
          <div className="integ-doc-hero-text">
            <div className="integ-doc-name">{item.name}</div>
            <div className="integ-doc-tagline">{item.tagline}</div>
            <div className="integ-doc-badges">
              <span className="docs-badge">
                {catIcon} {catLabel}
              </span>
              <span className={`docs-badge ${authClass === "oauth" ? "green" : ""}`}>{authLabel}</span>
              <span className="docs-badge">InfoGenie Integration</span>
            </div>
          </div>
        </div>
      </div>

      <div className="integ-doc-body">
        <div>
          <div className="docs-section-title">✦ What connecting {item.name} unlocks in InfoGenie</div>
          <div className="docs-unlocks">
            {item.unlocks.map((u, i) => (
              <div className="docs-unlock-item" key={i}>
                <span className="docs-unlock-check">✓</span>
                <span className="docs-unlock-text">{u}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="docs-section-title">↳ Step-by-Step Integration Guide</div>
          <div className="docs-doc-steps">
            {item.steps.map((s, i) => (
              <div className="docs-doc-step" key={i}>
                <div className="docs-doc-num">{i + 1}</div>
                <div className="docs-doc-text">{parseMarkup(s.text, `ds${i}`)}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="docs-section-title">{"{'{'}"} Code Example — API Request</div>
          <div className="docs-code-block">
            <div className="docs-code-bar">
              <span className="docs-code-lang">{codeEx.lang}</span>
              <span>• {item.name} Integration</span>
              <button className="docs-code-copy" onClick={() => onCopy(stripTags(codeEx.code))}>
                Copy
              </button>
            </div>
            <div className="docs-code-content">{parseMarkup(codeEx.code, "code")}</div>
          </div>
        </div>

        <div>
          <div className="docs-section-title">⚙ API Reference</div>
          <table className="docs-api-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Base URL</td>
                <td>
                  <code>{api.baseUrl}</code>
                </td>
              </tr>
              <tr>
                <td>Auth Method</td>
                <td>
                  <code>{authLabel}</code>
                </td>
              </tr>
              <tr>
                <td>Rate Limits</td>
                <td>{api.rateLimits}</td>
              </tr>
              <tr>
                <td>Plan Required</td>
                <td>{api.plans}</td>
              </tr>
              <tr>
                <td>InfoGenie Sync Interval</td>
                <td>Every 15 minutes (campaigns), 1 hour (analytics)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <div className="docs-section-title">⚠ Common Error Codes</div>
          <table className="docs-api-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Meaning & Fix</th>
              </tr>
            </thead>
            <tbody>
              {api.errorCodes.map(([code, msg], i) => (
                <tr key={i}>
                  <td>
                    <code>{code}</code>
                  </td>
                  <td>{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="docs-section-title">🔧 Troubleshooting</div>
          <div className="docs-trouble-list">
            {trouble.map((t, i) => (
              <div className="docs-trouble-item" key={i}>
                <div className="docs-trouble-q">❓ {t.q}</div>
                <div className="docs-trouble-a">{t.a}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-auto-target" onClick={() => onGoToCard(catKey, item.id)}>
            Go to {item.name} Settings →
          </button>
          <button className="btn-vs-copy" onClick={onBack}>
            ← Back to All Integrations
          </button>
        </div>
      </div>
    </div>
  );
}
