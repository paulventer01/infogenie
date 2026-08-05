/** Relabel-first marketing hubs — tile landing pages grouping existing tools. */

export interface MarketingHubTile {
  view: string;
  icon: string;
  label: string;
  desc: string;
  tag?: string;
}

export interface MarketingHubDef {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  tiles: MarketingHubTile[];
}

export const MARKETING_HUBS: Record<string, MarketingHubDef> = {
  "paid-search-social": {
    id: "paid-search-social",
    group: "Grow",
    title: "💳 Paid Search & Social",
    subtitle:
      "SEM, PPC, and paid social in one place — launch campaigns, read platform insights, and let the AI Optimizer improve ROAS.",
    tiles: [
      { view: "advertise", icon: "📣", label: "Advertise Hub", desc: "Launch Meta, Google & TikTok campaigns", tag: "Start here" },
      { view: "google-ads-insights", icon: "🅖", label: "Google Ads Insights", desc: "Search & Performance Max spend, CPA, ROAS" },
      { view: "meta-insights", icon: "📘", label: "Meta Ads Insights", desc: "Facebook & Instagram ad performance" },
      { view: "tiktok-ads-insights", icon: "🎵", label: "TikTok Ads Insights", desc: "Short-form paid social metrics" },
      { view: "optimizer", icon: "🦿", label: "AI Campaign Optimizer", desc: "Auto-tune budgets, bids & creatives" },
      { view: "import-campaigns", icon: "📥", label: "Import Campaigns", desc: "Pull existing ad accounts in" },
      { view: "pixel-manager", icon: "🎞️", label: "Pixel & CAPI Manager", desc: "Conversion tracking & server-side events" },
      { view: "conversion-recovery", icon: "🔃", label: "Conversion Recovery", desc: "Recover iOS / cookie-loss signal loss" },
    ],
  },
  "content-studio": {
    id: "content-studio",
    group: "Create",
    title: "🧬 Content Studio",
    subtitle:
      "Content marketing and AI content creation — blogs, long-form, autopilot publishing, and bulk rewrites.",
    tiles: [
      { view: "content", icon: "✍️", label: "Content AI", desc: "Blogs, articles & long-form copy", tag: "Start here" },
      { view: "content-autopilot", icon: "🦾", label: "Content Autopilot", desc: "Scheduled AI content pipeline" },
      { view: "bulk-rewriter", icon: "🖊️", label: "Bulk Content Rewriter", desc: "Rewrite up to 20 articles at once" },
      { view: "content-brief", icon: "📃", label: "SEO Content Brief", desc: "Briefs aligned to target keywords" },
      { view: "content-score", icon: "📜", label: "Content Score", desc: "On-page optimization score & fixes" },
      { view: "content-calendar", icon: "🗓️", label: "Content Calendar", desc: "Plan editorial & campaign content" },
      { view: "headline-tester", icon: "🏹", label: "Headline Tester", desc: "A/B headline variants with AI" },
      { view: "press-release", icon: "📄", label: "Press Release Writer", desc: "PR & thought-leadership drafts" },
    ],
  },
  "social-command-center": {
    id: "social-command-center",
    group: "Reach",
    title: "📱 Social Command Center",
    subtitle:
      "Organic social, paid social, and performance — publish everywhere, monitor engagement, and track post ROI.",
    tiles: [
      { view: "social-publisher", icon: "📤", label: "Social Publisher", desc: "Calendar · approvals · inbox · automate", tag: "Organic" },
      { view: "unified-inbox", icon: "📬", label: "Unified Inbox", desc: "Reviews · email · social DMs" },
      { view: "social-analytics", icon: "🖇️", label: "Organic Social Analytics", desc: "Engagement & follower growth" },
      { view: "post-performance", icon: "⚗️", label: "Post Performance", desc: "Top posts & content patterns" },
      { view: "organic-social", icon: "👀", label: "Organic Social Monitor", desc: "Competitor organic activity" },
      { view: "meta-insights", icon: "📘", label: "Meta Ads Insights", desc: "Paid social on Meta", tag: "Paid" },
      { view: "tiktok-ads-insights", icon: "🎵", label: "TikTok Ads Insights", desc: "Paid short-form social" },
      { view: "social-listening", icon: "👂", label: "Social Listening", desc: "Brand mentions & sentiment" },
      { view: "hashtag-intel", icon: "🔖", label: "Hashtag Intelligence", desc: "Instagram & TikTok tags" },
    ],
  },
  "lifecycle-email": {
    id: "lifecycle-email",
    group: "Create",
    title: "📧 Lifecycle Email",
    subtitle:
      "Email marketing plus automation — broadcasts, drips, re-engagement, design, and deliverability analytics.",
    tiles: [
      { view: "email-broadcast", icon: "📧", label: "Email Broadcast", desc: "Send campaigns with tracking", tag: "Send" },
      { view: "automations", icon: "🛠️", label: "Automations", desc: "Trigger-based email workflows" },
      { view: "reengage", icon: "💷", label: "Re-Engage Customers", desc: "Win-back & drip sequences" },
      { view: "email-designer", icon: "🗂️", label: "Visual Email Designer", desc: "Drag-and-drop templates" },
      { view: "email-analytics", icon: "🖥️", label: "Email Analytics", desc: "Opens, clicks & conversions" },
      { view: "email-personalizer", icon: "📨", label: "Email Personalizer", desc: "1-to-1 AI personalization" },
      { view: "smart-send", icon: "⏰", label: "Smart Send Time", desc: "Optimize send windows per contact" },
      { view: "deliverability", icon: "📬", label: "Deliverability", desc: "Inbox placement & warmup health" },
    ],
  },
  "messaging-channels": {
    id: "messaging-channels",
    group: "Reach",
    title: "💬 Messaging Channels",
    subtitle: "SMS, WhatsApp, push, and omnichannel journeys — reach customers on their preferred channel.",
    tiles: [
      { view: "omnichannel", icon: "🗃️", label: "Omnichannel Composer", desc: "Email · SMS · WhatsApp · Push · Voice", tag: "Hub" },
      { view: "whatsapp", icon: "💬", label: "WhatsApp Channel", desc: "WhatsApp Business campaigns" },
      { view: "rcs-campaigns", icon: "💭", label: "RCS & Apple Messages", desc: "Rich mobile messaging" },
      { view: "reply-assistant", icon: "📩", label: "Reply Assistant", desc: "AI replies to inbound messages" },
      { view: "unified-inbox", icon: "📬", label: "Unified Inbox", desc: "All channels in one queue" },
      { view: "journey-builder", icon: "🛤️", label: "Journey Builder", desc: "Multi-step lifecycle flows" },
    ],
  },
  "conversational-ai": {
    id: "conversational-ai",
    group: "Create",
    title: "🤖 Conversational AI",
    subtitle:
      "Chatbots, reply assistants, and Ask InfoGenie — conversational marketing across web, email, and support.",
    tiles: [
      { view: "chatbot-builder", icon: "🤖", label: "Chatbot Builder", desc: "Deploy site & landing-page bots", tag: "Build" },
      { view: "reply-assistant", icon: "📩", label: "Reply Assistant", desc: "AI drafts for inbound enquiries" },
      { view: "ask-infogenie", icon: "🎧", label: "Ask InfoGenie", desc: "Chat with your marketing data" },
      { view: "autoclaw", icon: "🦞", label: "AutoClaw Agent", desc: "GLM 5.2 agentic tasks & gateway" },
      { view: "lead-intelligence", icon: "🎯", label: "Lead Intelligence", desc: "Classify inbound leads with AI" },
      { view: "voice-caller", icon: "📞", label: "AI Voice Caller", desc: "Outbound voice conversations" },
    ],
  },
  "conversion-lab": {
    id: "conversion-lab",
    group: "Grow",
    title: "🧪 Conversion Lab",
    subtitle:
      "CRO, heatmaps, A/B tests, and conversion boosters — improve landing pages and funnel conversion rates.",
    tiles: [
      { view: "cro-lab", icon: "💢", label: "CRO Lab", desc: "Page tests & conversion experiments", tag: "Start here" },
      { view: "heatmaps", icon: "🖋️", label: "Heatmaps & Replay", desc: "Click maps & session recordings" },
      { view: "ab-designer", icon: "🧪", label: "A/B Test Designer", desc: "Design split tests with AI" },
      { view: "conversion-boosters", icon: "⚡", label: "Conversion Boosters", desc: "Popups, bars & lead capture" },
      { view: "landing-pages", icon: "🚀", label: "AI Landing Pages", desc: "A/B landing pages with lead forms" },
      { view: "funnel-analytics", icon: "💥", label: "Funnel Analytics", desc: "Views → opt-ins → sales → EPC" },
      { view: "web-analytics", icon: "🫀", label: "Web Analytics", desc: "Acquisition & behaviour funnels" },
    ],
  },
  "growth-hub": {
    id: "growth-hub",
    group: "Grow",
    title: "🚀 Growth Marketing",
    subtitle:
      "Growth methodology, forecasting, experimentation, and full-funnel ROI — scale what works.",
    tiles: [
      { view: "growth-methodology", icon: "💶", label: "Growth Methodology", desc: "5-stage growth framework", tag: "Framework" },
      { view: "flywheel", icon: "🌀", label: "Performance Flywheel", desc: "Compounding growth loops" },
      { view: "digital-twin", icon: "🪞", label: "Digital Twin", desc: "What-if scenario simulator" },
      { view: "mmm", icon: "🎛️", label: "Media Mix Modeler", desc: "Optimal budget allocation" },
      { view: "lead-gen", icon: "🧲", label: "Lead Generation", desc: "Find & qualify new leads" },
      { view: "attribution", icon: "🥉", label: "Attribution Modeling", desc: "Multi-touch channel credit" },
      { view: "true-roas", icon: "💵", label: "True ROAS", desc: "Margin-aware return on ad spend" },
      { view: "revenue-forecast", icon: "🏅", label: "Revenue Forecast", desc: "90-day AI revenue projection" },
    ],
  },
};

export const MARKETING_HUB_IDS = Object.keys(MARKETING_HUBS);
