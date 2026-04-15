# InfoGenie — AI Autonomous Marketing Intelligence Platform

## Overview
InfoGenie is a comprehensive AI-powered marketing intelligence and campaign automation platform built as a static single-page application. It enables businesses to analyse competitor marketing strategies, generate high-performing ad campaigns, and autonomously optimise results.

## Architecture
- **Type**: Node.js/Express backend + Static SPA frontend
- **Server**: `server.js` listens on port 5000 (preview) AND port 80 (external)
- **Frontend**: Pure HTML5 + CSS3 + Vanilla JavaScript
- **Charts**: Chart.js v4.4.0 (CDN)
- **Fonts**: Google Fonts — Inter + Sora (CDN)
- **Backend API**: DataForSEO + OpenAI GPT-4 (Replit AI Integrations) + RapidAPI social intelligence
- **AI**: `openai` npm package v6.34.0; uses `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` env vars (set automatically by Replit, no user key needed)

## File Structure
```
/
├── index.html          # Main SPA with all view templates
├── style.css           # Complete styling (Deep Navy + Teal + Cyan brand)
├── data.js             # Industry intelligence database + competitor data (7 industries, 11 competitor pool per industry)
├── app.js              # Main application controller (~5100 lines)
├── server.js           # Express backend (DataForSEO integration, dual-port)
└── package.json        # Node.js dependencies
```

## Key Globals (app.js)
- `analysisData` — current analysis session data
- `queuedCampaigns` — counter-campaigns queued from Win/Loss Intelligence (shown at top of Campaigns view)
- `creativeRound` — current creative batch (0=original, 1=new angles, 2=urgency hooks; wraps every 3)
- `window._wlData` — Win/Loss card data map for modal lookup
- `window._lastCampRecs` — last campaign recommendations for modal access
- `window._creativeStudio` — Creative Studio state (current campaign's full copy, scripts, email brief — used by _csDownload/_csCopyAll/_csSendEmail)

## Features
1. **Website URL Input** — Enter any website, detect industry automatically
2. **Industry Detection** — Identifies industry from URL/domain (6 industries supported)
3. **Competitor Analysis** — 5+ real competitors per industry with actual website names
4. **Dashboard** — KPI cards, CTR/ROAS charts, trend analysis, competitor table
5. **Competitor Intelligence** — Deep dive with campaigns, suggestions, audiences per competitor
6. **Campaign Analysis** — AI-generated campaign recommendations with projected metrics; each card has a "🎨 Creative Studio" button
7. **Audience Intelligence** — Aggregate audience segments with targeting recommendations
8. **AI Creative Generation** — Competitor vs. InfoGenie side-by-side cards, auto-target audience panels, CTR/ROAS dual-axis chart
9. **⚡ Intelligence Hub** — Exclusive AI features: keyword gap analysis, share of voice donut chart, competitor signal feed (dark periods/budget surges/price changes/new campaigns), predictive moves with confidence %, 90-day category domination roadmap, win/loss intelligence
10. **Settings & Integrations** — Full documentation system (38 integrations), step-by-step guides, code examples, API reference tables, error codes, troubleshooting Q&A
11. **ROAS Domination Plan** — Detailed 90-day roadmap per competitor: ROAS gap analysis with transparent reasoning, 3-phase execution plan with projected revenue, channel budget allocation, competitor weakness identification
12. **Rich Campaign Launch** — Full campaign brief before launch: AI-generated headlines/descriptions, platform strategy, bid strategy, audience spec, budget breakdown (daily/weekly/monthly), projected conversions and revenue
13. **Creative Preview Modal** — 4-format ad preview per campaign: Search Ad, Display Banner, Instagram Story, Video Script — with AI copy per format
14. **Multi-Channel Advertise Hub** — 22-platform connected accounts grid (Meta, Google, TikTok, LinkedIn, Bing, Spotify, Pinterest, X, Threads, Snapchat, Direct Mail, Local Services, etc.); 3-step lead-gen campaign creator with AI optimisation; live Optimisation Folders for active campaigns
15. **Social Content Calendar** — Monthly calendar view with per-platform post scheduling; Create Post modal with AI-generated captions (GPT-4), multi-platform selection, file upload, date/time picker; scheduled/published/draft status tracking; upcoming posts sidebar; `POST /api/ai-social-caption` GPT-4 endpoint

## Supported Industries
- E-commerce & Retail (Amazon, Shopify, eBay, Etsy, Wayfair)
- Fintech & Finance (eToro, IG Markets, Plus500, XM, Revolut)
- SaaS & Software (HubSpot, Salesforce, Monday, Mailchimp, Zendesk)
- Crypto & Web3 (Coinbase, Binance, Kraken, ByBit, Ledger)
- Travel & Hospitality (Booking.com, Expedia, Airbnb, TripAdvisor, Hotels.com)
- Education & E-Learning (Coursera, Udemy, Skillshare, MasterClass, Duolingo)
- Marketing & Analytics (Semrush, SimilarWeb, AdCreative.ai, Hootsuite, Ahrefs)

## Key Metrics Tracked
- Avg CTR (Click-Through Rate)
- ROAS (Return on Ad Spend)
- CPA (Cost Per Acquisition)
- Monthly Traffic Estimates
- Conversion Rate
- AI Opportunity Score

## Brand Identity
- Primary: Deep Navy (#0A1628)
- Accent: Teal (#00C9C8)
- Highlight: Electric Cyan (#00E5FF)
- Success: Green (#10B981)
- Warning: Gold (#F59E0B)

## Business Plan
- Pricing: $99/mo (Starter) → $399/mo (Pro) → $999/mo (Agency) → $3K–$10K (Enterprise)
- Target Market: $600B+ global digital ad spend
- Revenue Model: SaaS + Usage fees + Ad-spend management fee
