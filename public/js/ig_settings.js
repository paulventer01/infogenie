// =============================================================================
// ig_settings.js — Settings / Integrations surface (moved verbatim from app.js)
// -----------------------------------------------------------------------------
// Holds the INTEGRATIONS catalog plus the Settings view-builders and the
// integration-docs modal helpers, wrapped in one IIFE (see public/js/README.md).
// Public entry points (INTEGRATIONS, buildSettings, checkAPIHealth,
// buildIntegCard, showIntegrationDoc, showDocsModal, closeDocsModal) are
// re-attached to window so app.js + inline onclick= handlers resolve them.
// Reads shared globals (showToast/navigateTo/_esc/_safeUrl/analysisData/…)
// from app.js at call time. Feature-private helpers (_findIntegById,
// _getIntegApiDetails, _getCodeExample, _getTroubleshooting) stay file-scoped.
// =============================================================================
(function () {
// ===================================================
// INTEGRATIONS DATA
// ===================================================
const INTEGRATIONS = {
  platforms: {
    label: 'Ad Platforms',
    icon: '🚀',
    desc: 'Connect your advertising accounts to let InfoGenie autonomously create, launch, and optimise campaigns across every major platform.',
    badge: '7 Platforms',
    items: [
      {
        id: 'google-ads', logo: '🔵', name: 'Google Ads',
        tagline: 'Search, Display, YouTube, Shopping & Performance Max',
        authType: 'oauth',
        unlocks: [
          'Autonomous campaign creation & bidding on all Google properties',
          'Keyword intelligence synced from competitor analysis',
          'Real-time bid optimisation via InfoGenie RL engine',
          'Performance Max campaign auto-configuration'
        ],
        steps: [
          { text: 'Go to <a href="https://ads.google.com" target="_blank">ads.google.com</a> and sign in to your account' },
          { text: 'Navigate to <strong>Tools & Settings → API Centre</strong>' },
          { text: 'Click <strong>Apply for API Access</strong> and complete the form' },
          { text: 'Once approved, copy your <code>Developer Token</code>' },
          { text: 'Click <strong>Connect via OAuth</strong> below — InfoGenie handles the rest' }
        ]
      },
      {
        id: 'meta-ads', logo: '🔷', name: 'Meta Ads Manager',
        tagline: 'Facebook, Instagram, Messenger & Audience Network',
        authType: 'oauth',
        unlocks: [
          'Automated Facebook & Instagram campaign deployment',
          'Lookalike audience creation from competitor intelligence',
          'Dynamic creative testing across audience segments',
          'Real-time ROAS monitoring and budget reallocation'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a> and create an App' },
          { text: 'Add the <strong>Marketing API</strong> product to your app' },
          { text: 'Generate a <strong>System User Access Token</strong> with <code>ads_management</code> permission' },
          { text: 'Note your <strong>Ad Account ID</strong> (format: act_123456789)' },
          { text: 'Click <strong>Connect via OAuth</strong> — InfoGenie will request permissions automatically' }
        ]
      },
      {
        id: 'tiktok-ads', logo: '⬛', name: 'TikTok Ads',
        tagline: 'In-Feed, TopView, Spark Ads & Brand Takeovers',
        authType: 'apikey',
        placeholder: 'TikTok Ads Access Token (Bearer xxxxx...)',
        unlocks: [
          'Short-form video campaign creation and deployment',
          'Spark Ads from organic content amplification',
          'TikTok audience intelligence and targeting',
          'Creative performance tracking and auto-optimisation'
        ],
        steps: [
          { text: 'Visit <a href="https://ads.tiktok.com/marketing_api" target="_blank">TikTok for Business Developers</a>' },
          { text: 'Create a developer account and register your app under <strong>My Apps</strong>' },
          { text: 'Complete the <strong>app review</strong> process (typically 1–3 business days)' },
          { text: 'Once approved, generate an <strong>Access Token</strong> from your app dashboard' },
          { text: 'Note your <strong>Advertiser ID</strong> from TikTok Ads Manager → Account → Advertiser Info' },
          { text: 'Paste your Access Token above and click <strong>Connect</strong>' }
        ]
      },
      {
        id: 'linkedin-ads', logo: '🔷', name: 'LinkedIn Campaign Manager',
        tagline: 'Sponsored Content, Message Ads & Lead Gen Forms',
        authType: 'oauth',
        unlocks: [
          'B2B audience targeting by job title, industry, and company size',
          'Sponsored content and InMail campaign automation',
          'Lead Gen Form integration with CRM sync',
          'LinkedIn Insight Tag conversion tracking'
        ],
        steps: [
          { text: 'Go to <a href="https://developer.linkedin.com" target="_blank">developer.linkedin.com</a> and create an app' },
          { text: 'Add the <strong>Marketing Developer Platform</strong> product' },
          { text: 'Request access to <code>r_ads</code> and <code>rw_ads</code> permissions' },
          { text: 'Generate OAuth 2.0 credentials (Client ID + Client Secret)' },
          { text: 'Click <strong>Connect via OAuth</strong> to authorise InfoGenie' }
        ]
      },
      {
        id: 'x-ads', logo: '🐦', name: 'X (Twitter) Ads',
        tagline: 'Promoted Tweets, Follower Campaigns & App Installs',
        authType: 'apikey',
        placeholder: 'X Ads API Access Token',
        unlocks: [
          'Promoted tweet campaigns targeting competitor followers',
          'Trend-based ad scheduling and real-time campaign pivots',
          'Keyword and hashtag audience targeting',
          'Conversation ads and app install campaigns'
        ],
        steps: [
          { text: 'Apply for <a href="https://developer.twitter.com" target="_blank">X Developer Access</a> at developer.twitter.com' },
          { text: 'Create a Project and App in the developer portal' },
          { text: 'Apply for <strong>Ads API access</strong> (requires a funded ads account)' },
          { text: 'Navigate to <strong>Keys & Tokens</strong> and generate Access Token + Secret' },
          { text: 'Paste your Access Token above and click <strong>Connect</strong>' }
        ]
      },
      {
        id: 'pinterest-ads', logo: '🔴', name: 'Pinterest Ads',
        tagline: 'Promoted Pins, Shopping Campaigns & Video Ads',
        authType: 'oauth',
        unlocks: [
          'Product catalogue and shopping campaign automation',
          'Visual audience discovery and interest targeting',
          'Seasonal campaign scheduling with AI creative generation',
          'Shopping spotlight and collection ads'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.pinterest.com" target="_blank">developers.pinterest.com</a>' },
          { text: 'Create a new app and request <strong>Ads API access</strong>' },
          { text: 'Set your <strong>Redirect URI</strong> to <code>https://app.infogenie.ai/oauth/pinterest</code>' },
          { text: 'Note your App ID and App Secret from the app settings' },
          { text: 'Click <strong>Connect via OAuth</strong> to link your Pinterest Business account' }
        ]
      },
      {
        id: 'amazon-ads', logo: '🟠', name: 'Amazon Ads',
        tagline: 'Sponsored Products, Brands, Display & DSP',
        authType: 'apikey',
        placeholder: 'Amazon Ads API Refresh Token',
        unlocks: [
          'Sponsored Products & Brands campaign automation',
          'Amazon DSP programmatic display campaigns',
          'Keyword harvesting from search term reports',
          'ASIN-level competitor targeting and product ads'
        ],
        steps: [
          { text: 'Sign in to <a href="https://advertising.amazon.com" target="_blank">advertising.amazon.com</a>' },
          { text: 'Navigate to <strong>Account Access → API Access</strong>' },
          { text: 'Create a Security Profile under <strong>Login with Amazon</strong>' },
          { text: 'Use Amazon\'s OAuth flow to generate a <strong>Refresh Token</strong>' },
          { text: 'Note your <strong>Profile IDs</strong> for each marketplace you want to manage' },
          { text: 'Paste your Refresh Token above and click <strong>Connect</strong>' }
        ]
      }
    ]
  },

  intelligence: {
    label: 'Intelligence APIs',
    icon: '🔍',
    desc: 'Connect your own competitive-intelligence subscriptions — traffic estimates, keyword data, backlinks, ad libraries, and brand monitoring.',
    badge: '9 Sources',
    items: [
      {
        id: 'semrush', logo: '📊', name: 'Semrush API',
        tagline: 'Keyword rankings, PPC data, backlinks & competitor analysis',
        authType: 'apikey',
        placeholder: 'Semrush API Key (sk_xxxxxxxxxxxx)',
        unlocks: [
          'Competitor keyword rankings and estimated traffic',
          'PPC keyword data with CPC and competition scores',
          'Backlink analysis for domain authority comparison',
          'Display advertising and ad copy intelligence'
        ],
        steps: [
          { text: 'Sign in to <a href="https://semrush.com" target="_blank">semrush.com</a> and go to <strong>Account → API</strong>' },
          { text: 'Subscribe to the <strong>Semrush API</strong> — Business plan or above recommended' },
          { text: 'Copy your <strong>API Key</strong> from the API dashboard' },
          { text: 'Paste your API Key in the field above' },
          { text: 'Click <strong>Test Connection</strong> to verify — InfoGenie will confirm your data units balance' }
        ]
      },
      {
        id: 'similarweb', logo: '🌐', name: 'SimilarWeb API',
        tagline: 'Traffic intelligence, audience demographics & referral data',
        authType: 'apikey',
        placeholder: 'SimilarWeb API Key',
        unlocks: [
          'Competitor monthly traffic estimates with confidence levels',
          'Traffic source breakdown (organic, paid, social, referral)',
          'Audience demographics by country, device, and age',
          'Top referring domains and organic keywords'
        ],
        steps: [
          { text: 'Visit <a href="https://www.similarweb.com/corp/developer/digital-intelligence-api" target="_blank">SimilarWeb Developer Portal</a>' },
          { text: 'Request access to the <strong>Digital Intelligence API</strong>' },
          { text: 'Once approved, navigate to <strong>My Account → API Key</strong>' },
          { text: 'Copy your API Key and paste it in the field above' },
          { text: 'Click <strong>Test Connection</strong> — InfoGenie will verify your monthly unit allowance' }
        ]
      },
      {
        id: 'ahrefs', logo: '🔗', name: 'Ahrefs API',
        tagline: 'Backlink data, keyword explorer & content gap analysis',
        authType: 'apikey',
        placeholder: 'Ahrefs API Token (v3)',
        unlocks: [
          'Domain Rating and backlink profile comparison',
          'Keyword difficulty and organic traffic potential',
          'Content gap analysis vs. competitor pages',
          'Top-performing competitor content identification'
        ],
        steps: [
          { text: 'Sign in to <a href="https://ahrefs.com" target="_blank">ahrefs.com</a> (Business plan required for API)' },
          { text: 'Go to <strong>Account Settings → API</strong>' },
          { text: 'Generate a new <strong>API v3 Token</strong>' },
          { text: 'Set token permissions: <code>site_explorer</code>, <code>keywords_explorer</code>' },
          { text: 'Paste your token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'spyfu', logo: '🕵️', name: 'SpyFu API',
        tagline: 'Google Ads history, competitor keywords & ad copy spy',
        authType: 'apikey',
        placeholder: 'SpyFu API Key',
        unlocks: [
          'Complete Google Ads history for any competitor domain',
          'Every keyword a competitor has ever bought on Google',
          'Historical ad copy and A/B test variations',
          'Estimated monthly Google Ads spend per competitor'
        ],
        steps: [
          { text: 'Sign up at <a href="https://www.spyfu.com" target="_blank">spyfu.com</a> (API plan required)' },
          { text: 'Navigate to <strong>Account → Integrations → API Key</strong>' },
          { text: 'Copy your API Key' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'moz', logo: '🎯', name: 'Moz API',
        tagline: 'Domain Authority, Page Authority & link metrics',
        authType: 'apikey',
        placeholder: 'Moz Access ID:Secret Key',
        unlocks: [
          'Domain Authority and Page Authority scores for competitors',
          'Spam score and link quality analysis',
          'Top competitor pages by authority',
          'Keyword ranking opportunity identification'
        ],
        steps: [
          { text: 'Sign up at <a href="https://moz.com/products/api" target="_blank">moz.com/products/api</a>' },
          { text: 'Navigate to <strong>API → Access Credentials</strong>' },
          { text: 'Copy your <strong>Access ID</strong> and <strong>Secret Key</strong>' },
          { text: 'Enter them in the format <code>AccessID:SecretKey</code> above' },
          { text: 'Click <strong>Test Connection</strong> to verify' }
        ]
      },
      {
        id: 'meta-ad-library', logo: '📣', name: 'Meta Ad Library API',
        tagline: 'Every active Facebook & Instagram competitor ad — live, in real time',
        authType: 'apikey',
        placeholder: 'Meta Access Token (EAA...)',
        unlocks: [
          '🔴 LIVE: See every active Facebook & Instagram ad from any competitor domain',
          'Competitor ad creative, copy, call-to-action, and spend range — updated daily',
          'Identify which competitor ads have been running longest (highest performers)',
          'Demographic targeting breakdown: age, gender, location for each competitor ad',
          'Auto-populate InfoGenie Signal Feed with new competitor creative launches'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a> and create or open an existing app' },
          { text: 'Add the <strong>Marketing API</strong> product — navigate to <strong>App Dashboard → Add Product</strong>' },
          { text: 'Go to <strong>Tools → Graph API Explorer</strong> and generate a <strong>User Access Token</strong>' },
          { text: 'Select the following permission: <code>ads_read</code> — this grants access to the Ad Library' },
          { text: 'Convert to a long-lived token: call <code>GET /oauth/access_token?grant_type=fb_exchange_token</code> with your short-lived token' },
          { text: 'Paste your long-lived token above and click <strong>Test Connection</strong> — InfoGenie will verify Ad Library access immediately' }
        ]
      },
      {
        id: 'apify', logo: '🕸️', name: 'Apify',
        tagline: 'Web scraping platform — powers TikTok Organic Monitor & Local Lead Finder',
        authType: 'apikey',
        vaultSave: true,
        placeholder: 'Apify API Token (apify_api_...)',
        unlocks: [
          '🔴 LIVE: TikTok Organic Monitor — track any brand or keyword\'s TikTok videos, views & engagement',
          'Local Lead Finder — pull verified Google Maps business leads for any location + category',
          'Top creator analysis per keyword — identify who is driving competitor TikTok reach',
          'Export leads with phone numbers, ratings, hours, and website URLs in one click'
        ],
        steps: [
          { text: 'Visit <a href="https://console.apify.com/sign-up" target="_blank">console.apify.com</a> and create a free account' },
          { text: 'Go to <strong>Settings → Integrations → API tokens</strong>' },
          { text: 'Click <strong>+ Create new token</strong> and copy the value (starts with <code>apify_api_</code>)' },
          { text: 'Paste your token above and click <strong>Connect</strong> — saved instantly, no restart needed' }
        ]
      },
      {
        id: 'profound', logo: '🧠', name: 'Profound',
        tagline: 'Brand mention tracking across ChatGPT, Claude, Perplexity, Gemini',
        authType: 'apikey',
        placeholder: 'Profound API Key',
        unlocks: [
          'Live brand-visibility scores in answer-engine results',
          'Competitor benchmark across all major LLMs',
          'Prompt-coverage gap analysis for AI search',
          'Citation source tracking (which sites the LLMs quote about you)'
        ],
        steps: [
          { text: 'Visit <a href="https://www.tryprofound.com" target="_blank">tryprofound.com</a> and request API access' },
          { text: 'Once approved, copy your <strong>API Key</strong> from the dashboard' },
          { text: 'In Replit Secrets, add <code>PROFOUND_API_KEY</code>' },
          { text: 'Open the AI Visibility Suite — Profound metrics appear automatically when configured' }
        ]
      },
      {
        id: 'brandwatch', logo: '👁️', name: 'Brandwatch API',
        tagline: 'Real-time competitor mentions, sentiment & share of voice monitoring',
        authType: 'apikey',
        placeholder: 'Brandwatch API Token',
        unlocks: [
          '🔴 LIVE: Competitor brand mentions across 100M+ sources updated in real time',
          'Sentiment analysis: track positive/negative shifts in competitor perception instantly',
          'Live Share of Voice data powering the Intelligence Hub SOV chart',
          'Crisis and opportunity detection — competitor negative spikes = acquisition moment',
          'Auto-trigger Signal Feed alerts when competitor sentiment drops sharply'
        ],
        steps: [
          { text: 'Log in to <a href="https://app.brandwatch.com" target="_blank">app.brandwatch.com</a> with your Brandwatch account' },
          { text: 'Navigate to <strong>Settings → API Access</strong> (Consumer Intelligence or Social Intelligence plan required)' },
          { text: 'Click <strong>Generate New Token</strong> — select scopes: <code>queries:read</code>, <code>mentions:read</code>, <code>analytics:read</code>' },
          { text: 'Copy your API token (it starts with <code>Bearer </code> — include this prefix when pasting)' },
          { text: 'Set up at least one <strong>Competitor Query</strong> in Brandwatch that tracks your top 3 competitor brand names' },
          { text: 'Paste your token above and click <strong>Test Connection</strong> — InfoGenie will sync your query list and begin live monitoring' }
        ]
      }
    ]
  },

  ai: {
    label: 'AI Models',
    icon: '🤖',
    desc: 'Connect your own AI model subscriptions for image, voice, video, and copy generation. InfoGenie\'s core GPT-4o, Claude, Gemini, and Perplexity intelligence is included on every plan — no key required.',
    badge: '8 Models',
    items: [
      {
        id: 'stability', logo: '🎨', name: 'Stability AI',
        tagline: 'Stable Diffusion for AI-generated ad images & visuals',
        authType: 'apikey',
        placeholder: 'Stability AI API Key (sk-xxxx...)',
        unlocks: [
          'Stable Diffusion XL for high-quality ad image generation',
          'Image-to-image transformation for creative variations',
          'Brand-consistent visual asset generation at scale',
          'Competitor creative style analysis and improvement'
        ],
        steps: [
          { text: 'Sign up at <a href="https://platform.stability.ai" target="_blank">platform.stability.ai</a>' },
          { text: 'Navigate to <strong>Account → API Keys</strong>' },
          { text: 'Click <strong>Create API Key</strong>' },
          { text: 'Copy your API key (starts with <code>sk-</code>)' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'mistral', logo: '🌀', name: 'Mistral AI',
        tagline: 'Fast, cost-efficient AI for bulk copy generation & analysis',
        authType: 'apikey',
        placeholder: 'Mistral API Key',
        unlocks: [
          'Mistral Large for fast, cost-efficient ad copy at scale',
          'Batch campaign analysis across multiple competitors',
          'Multilingual ad copy for global campaigns',
          'Fast real-time campaign suggestion generation'
        ],
        steps: [
          { text: 'Go to <a href="https://console.mistral.ai" target="_blank">console.mistral.ai</a>' },
          { text: 'Navigate to <strong>API Keys</strong> in the dashboard' },
          { text: 'Click <strong>Create new key</strong>' },
          { text: 'Copy your key and paste it above' },
          { text: 'Click <strong>Test Connection</strong> — InfoGenie will use Mistral for high-volume tasks' }
        ]
      },
      {
        id: 'elevenlabs', logo: '🔊', name: 'ElevenLabs',
        tagline: 'AI voice generation for video ad voiceovers & audio content',
        authType: 'apikey',
        placeholder: 'ElevenLabs API Key',
        unlocks: [
          'AI voiceover generation for video and audio ads',
          'Multi-language voice localisation for global campaigns',
          'Brand voice cloning for consistent audio identity',
          'Podcast and audio ad creation from ad copy'
        ],
        steps: [
          { text: 'Sign up at <a href="https://elevenlabs.io" target="_blank">elevenlabs.io</a>' },
          { text: 'Go to <strong>Profile → API Key</strong>' },
          { text: 'Copy your API key' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'adcreative', logo: '🎨', name: 'AdCreative.ai',
        tagline: 'Autonomous AI ad creative generation optimised for conversions',
        authType: 'apikey',
        placeholder: 'AdCreative.ai API Key',
        unlocks: [
          'Generate 100+ ad creative variants per campaign automatically',
          'Conversion-score ranking — InfoGenie picks the highest-converting designs',
          'Platform-native sizing: Google, Meta, TikTok, LinkedIn, Display',
          'Brand kit integration — all creatives match your visual identity',
          'Competitor creative analysis and one-click improvement'
        ],
        steps: [
          { text: 'Sign up at <a href="https://adcreative.ai" target="_blank">adcreative.ai</a> and choose a plan with API access' },
          { text: 'Navigate to <strong>Account → API Settings</strong>' },
          { text: 'Generate your API Key and copy it' },
          { text: 'Upload your brand kit (logo, colours, fonts) in AdCreative dashboard' },
          { text: 'Paste your API key above — InfoGenie will auto-generate creatives on every campaign launch' }
        ]
      },
      {
        id: 'jasper', logo: '✍️', name: 'Jasper AI',
        tagline: 'Autonomous marketing copy, campaign strategy & content at scale',
        authType: 'apikey',
        placeholder: 'Jasper AI API Key',
        unlocks: [
          'AI-generated ad headlines, descriptions, and CTAs for every campaign',
          'Full campaign strategy documents generated from competitor analysis',
          'Brand voice training — Jasper writes in your exact tone',
          'Long-form landing page copy matched to each campaign angle',
          'Auto-generated A/B test copy variants (50+ per campaign)'
        ],
        steps: [
          { text: 'Go to <a href="https://jasper.ai" target="_blank">jasper.ai</a> and sign up for a Business or Teams plan' },
          { text: 'Navigate to <strong>Settings → Integrations → API</strong>' },
          { text: 'Click <strong>Generate API Key</strong> and copy it' },
          { text: 'Set up your Brand Voice in Jasper by uploading 3–5 content samples' },
          { text: 'Paste your key above — InfoGenie will use Jasper for all campaign copy generation' }
        ]
      },
      {
        id: 'runway', logo: '🎬', name: 'Runway ML',
        tagline: 'AI video ad generation — text-to-video & image-to-video at scale',
        authType: 'apikey',
        placeholder: 'Runway ML API Key (Bearer ...)',
        unlocks: [
          'Generate 15-second and 30-second video ads from text prompts',
          'Image-to-video for product shots — auto-animated for Story & Reels',
          'Video creative for TikTok, YouTube Pre-roll, Instagram Stories',
          'Competitor ad reimagining — take their concept, improve it with AI',
          'Auto-subtitle and caption generation for accessibility compliance'
        ],
        steps: [
          { text: 'Sign up at <a href="https://runwayml.com" target="_blank">runwayml.com</a> and access the API section' },
          { text: 'Go to <strong>Settings → API Keys</strong>' },
          { text: 'Click <strong>Create new key</strong> — pricing is credit-based at $0.01 per credit' },
          { text: 'Note: Video generation costs ~$0.05–0.40 per second depending on resolution' },
          { text: 'Paste your Bearer token above — InfoGenie uses Gen-2 by default, Gen-3 Alpha for premium quality' }
        ]
      },
      {
        id: 'copyai', logo: '🖊️', name: 'Copy.ai',
        tagline: 'GTM AI platform for autonomous campaign workflows & bulk copy',
        authType: 'apikey',
        placeholder: 'Copy.ai API Key',
        unlocks: [
          'Automated end-to-end campaign copy workflows from a single brief',
          'Bulk generation of 200+ ad copy variations per campaign in seconds',
          'Email sequence automation triggered by campaign conversion events',
          'Sales enablement copy synced with CRM campaign data',
          'Competitor messaging gap analysis and counter-copy generation'
        ],
        steps: [
          { text: 'Go to <a href="https://copy.ai" target="_blank">copy.ai</a> and sign up for Team or Enterprise plan' },
          { text: 'Navigate to <strong>Settings → API Access</strong>' },
          { text: 'Generate your API key and copy it' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' },
          { text: 'InfoGenie will use Copy.ai for high-volume campaign brief-to-copy automation' }
        ]
      },
      {
        id: 'artlist', logo: '🎵', name: 'Artlist.io',
        tagline: 'Licensed music & video assets for professional ad campaigns',
        authType: 'apikey',
        placeholder: 'Artlist Enterprise API Key',
        unlocks: [
          'Access 1M+ royalty-free music tracks for video ad soundtracks',
          'AI-matched music selection based on campaign mood and audience',
          'Stock video footage for display and social video campaigns',
          'AI-generated video and image assets via Artlist\'s AI ecosystem',
          'Full commercial licensing — no copyright issues on paid campaigns'
        ],
        steps: [
          { text: 'Visit <a href="https://artlist.io/enterprise" target="_blank">artlist.io/enterprise</a> and request an Enterprise account' },
          { text: 'Artlist API keys are issued via your Account Manager (self-service portal launching 2025)' },
          { text: 'Once issued, your API key will authenticate via OAuth 2.0 client credentials' },
          { text: 'Artlist is best suited for video-heavy campaigns — YouTube, TikTok, Instagram Reels' },
          { text: 'Paste your key above once issued — InfoGenie will auto-select music tracks for video creatives' }
        ]
      }
    ]
  },

  crm: {
    label: 'CRM & Automation',
    icon: '🔗',
    desc: 'Connect your CRM and automation platforms to route leads, sync contacts, and automate follow-up workflows triggered by InfoGenie campaign conversions.',
    badge: '7 Platforms',
    items: [
      {
        id: 'hubspot', logo: '🟠', name: 'HubSpot CRM',
        tagline: 'Contact sync, deal pipeline & campaign attribution',
        authType: 'oauth',
        unlocks: [
          'Auto-sync campaign leads directly into HubSpot contacts',
          'Deal creation and pipeline stage automation',
          'Campaign attribution reports in HubSpot Dashboards',
          'Retargeting lists built from CRM segments'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.hubspot.com" target="_blank">developers.hubspot.com</a> and create a Private App' },
          { text: 'Under <strong>Scopes</strong>, enable: <code>crm.objects.contacts.write</code>, <code>crm.objects.deals.write</code>' },
          { text: 'Generate your <strong>Private App Access Token</strong>' },
          { text: 'Alternatively, click <strong>Connect via OAuth</strong> for instant setup' },
          { text: 'InfoGenie will automatically create a custom property <code>infogenie_source</code> for attribution' }
        ]
      },
      {
        id: 'salesforce', logo: '🔵', name: 'Salesforce CRM',
        tagline: 'Lead routing, opportunity management & revenue attribution',
        authType: 'oauth',
        unlocks: [
          'Campaign lead auto-routing into Salesforce leads/contacts',
          'Opportunity creation from qualified ad conversions',
          'Revenue attribution via campaign UTM tracking',
          'AI-powered lead scoring from engagement signals'
        ],
        steps: [
          { text: 'Go to <strong>Setup → Apps → App Manager</strong> in Salesforce' },
          { text: 'Create a <strong>Connected App</strong> with OAuth enabled' },
          { text: 'Add scopes: <code>api</code>, <code>refresh_token</code>, <code>offline_access</code>' },
          { text: 'Set the callback URL to <code>https://app.infogenie.ai/oauth/salesforce</code>' },
          { text: 'Click <strong>Connect via OAuth</strong> below to authorise' }
        ]
      },
      {
        id: 'pipedrive', logo: '🟢', name: 'Pipedrive',
        tagline: 'Deal management, contact sync & pipeline automation',
        authType: 'apikey',
        placeholder: 'Pipedrive API Token',
        unlocks: [
          'Auto-create deals from InfoGenie campaign conversions',
          'Contact enrichment with campaign source and UTMs',
          'Pipeline stage triggers based on campaign performance',
          'Activity logging for all AI-generated touchpoints'
        ],
        steps: [
          { text: 'Sign in to Pipedrive and go to <strong>Personal Preferences → API</strong>' },
          { text: 'Copy your <strong>Personal API Token</strong>' },
          { text: 'Paste it in the field above' },
          { text: 'Click <strong>Test Connection</strong> — InfoGenie will map your pipeline stages automatically' }
        ]
      },
      {
        id: 'klaviyo', logo: '📧', name: 'Klaviyo',
        tagline: 'Email marketing automation & audience sync for e-commerce',
        authType: 'apikey',
        placeholder: 'Klaviyo Private API Key',
        unlocks: [
          'Sync InfoGenie campaign audiences into Klaviyo lists',
          'Trigger email flows from ad click and conversion events',
          'Revenue attribution across InfoGenie ads + email flows',
          'Suppression list sync to reduce ad spend waste'
        ],
        steps: [
          { text: 'Go to <a href="https://klaviyo.com" target="_blank">klaviyo.com</a> → <strong>Account → Settings → API Keys</strong>' },
          { text: 'Click <strong>Create Private API Key</strong>' },
          { text: 'Select scopes: <code>Lists: Full Access</code>, <code>Profiles: Full Access</code>, <code>Events: Full Access</code>' },
          { text: 'Copy the private key and paste it above' },
          { text: 'Click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'marketo', logo: '🟣', name: 'Marketo (Adobe)',
        tagline: 'B2B marketing automation, lead scoring & nurture campaigns',
        authType: 'apikey',
        placeholder: 'Marketo Client ID:Client Secret',
        unlocks: [
          'B2B lead sync from InfoGenie LinkedIn campaigns',
          'Lead scoring enrichment from campaign engagement data',
          'Automated nurture programme triggers post-ad-click',
          'Revenue Cycle Analytics integration for full-funnel reporting'
        ],
        steps: [
          { text: 'In Marketo, go to <strong>Admin → Integration → LaunchPoint</strong>' },
          { text: 'Click <strong>New Service</strong> and choose <strong>Custom</strong>' },
          { text: 'Enter "InfoGenie" as the service name' },
          { text: 'Under <strong>Admin → Web Services</strong>, copy your <strong>REST API Endpoint</strong>' },
          { text: 'Go to <strong>Admin → LaunchPoint</strong>, find your service, and click <strong>View Details</strong> for Client ID and Secret' },
          { text: 'Enter them in format <code>ClientID:ClientSecret</code> above' }
        ]
      },
      {
        id: 'zapier', logo: '⚡', name: 'Zapier',
        tagline: 'Connect 6,000+ apps with no-code automation workflows',
        authType: 'apikey',
        placeholder: 'Zapier API Key',
        unlocks: [
          'Trigger any Zap from InfoGenie campaign events',
          'Route leads to any app in Zapier\'s 6,000+ ecosystem',
          'Multi-step automation across CRM, email, sheets, and Slack',
          'Custom webhook triggers from InfoGenie AI alerts'
        ],
        steps: [
          { text: 'Sign in to <a href="https://zapier.com" target="_blank">zapier.com</a> and go to <strong>Settings → API</strong>' },
          { text: 'Generate your <strong>API Key</strong>' },
          { text: 'In InfoGenie, copy your <strong>Webhook URL</strong> from the Zapier connection panel' },
          { text: 'Create a Zap with <strong>Webhooks by Zapier</strong> as the trigger using your webhook URL' },
          { text: 'Paste your Zapier API Key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'make', logo: '🔵', name: 'Make (Integromat)',
        tagline: 'Visual automation builder with advanced data transformation',
        authType: 'apikey',
        placeholder: 'Make API Token',
        unlocks: [
          'Visual workflow automation triggered by campaign events',
          'Complex data transformation between InfoGenie and other systems',
          'Advanced scheduling and conditional automation logic',
          'Real-time webhook processing from ad platform events'
        ],
        steps: [
          { text: 'Go to <a href="https://make.com" target="_blank">make.com</a> → <strong>Profile → API</strong>' },
          { text: 'Click <strong>Add token</strong> and name it "InfoGenie"' },
          { text: 'Copy the generated token' },
          { text: 'In Make, create a new Scenario using the <strong>Webhooks</strong> module as trigger' },
          { text: 'Copy the webhook URL and paste it into InfoGenie\'s Make settings panel' },
          { text: 'Enter your API token above and click <strong>Test Connection</strong>' }
        ]
      }
    ]
  },

  analytics: {
    label: 'Analytics & Data',
    icon: '📈',
    desc: 'Connect analytics and data platforms to give InfoGenie complete visibility into your performance — enabling smarter competitor benchmarking and ROI attribution.',
    badge: '8 Platforms',
    items: [
      {
        id: 'shopify', logo: '🛍️', name: 'Shopify Admin API',
        tagline: 'Live revenue, AOV & order volume from your Shopify store',
        authType: 'apikey',
        placeholder: 'Shopify Admin Access Token (shpat_...)',
        unlocks: [
          'Real revenue & paid-orders KPIs in Results dashboard',
          'AOV trend tied directly to ad-campaign spend',
          'Refund + cancellation tracking for ROAS accuracy',
          'Auto-attribute orders to InfoGenie campaign UTMs'
        ],
        steps: [
          { text: 'Open your Shopify admin → <strong>Settings → Apps and sales channels → Develop apps</strong>' },
          { text: 'Click <strong>Create an app</strong>, name it "InfoGenie"' },
          { text: 'Under <strong>Configuration → Admin API access scopes</strong>, enable <code>read_orders</code>, <code>read_products</code>, <code>read_customers</code>' },
          { text: 'Click <strong>Install app</strong> and copy the <strong>Admin API access token</strong> (shown once)' },
          { text: 'In Replit Secrets, add <code>SHOPIFY_SHOP</code> (e.g. <code>mystore.myshopify.com</code>) and <code>SHOPIFY_ADMIN_TOKEN</code>' }
        ]
      },
      {
        id: 'appsflyer', logo: '📱', name: 'AppsFlyer',
        tagline: 'Mobile install attribution, in-app events & cohort analysis',
        authType: 'apikey',
        placeholder: 'AppsFlyer API Token (V2)',
        unlocks: [
          'Real install + event totals in the Mobile section of Results',
          'Cross-channel mobile attribution alongside Meta/Google/TikTok',
          'Cohort retention curves tied to acquisition source',
          'CPI / CPA monitoring per campaign for mobile'
        ],
        steps: [
          { text: 'Sign in to <a href="https://hq1.appsflyer.com" target="_blank">hq1.appsflyer.com</a>' },
          { text: 'Click your account icon → <strong>Security Center → Manage your AppsFlyer API tokens</strong>' },
          { text: 'Generate a <strong>V2 API token</strong> with Pull API access' },
          { text: 'Locate your <strong>App ID</strong> (e.g. <code>com.example.app</code> or <code>id123456789</code>) under My Apps' },
          { text: 'In Replit Secrets, add <code>APPSFLYER_API_TOKEN</code> and <code>APPSFLYER_APP_ID</code>' }
        ]
      },
      {
        id: 'ga4', logo: '📊', name: 'Google Analytics 4',
        tagline: 'Website traffic, user behaviour & conversion events',
        authType: 'oauth',
        unlocks: [
          'Real website conversion data fed into ROAS calculations',
          'Audience segment sync for better campaign targeting',
          'Attribution modelling across InfoGenie campaigns',
          'Funnel drop-off identification for landing page insights'
        ],
        steps: [
          { text: 'Go to <a href="https://analytics.google.com" target="_blank">analytics.google.com</a> → <strong>Admin → Property Settings</strong>' },
          { text: 'Note your <strong>Measurement ID</strong> (format: G-XXXXXXXXXX)' },
          { text: 'Under <strong>Admin → Service Accounts</strong>, create a service account with <strong>Viewer</strong> access' },
          { text: 'Download the <strong>JSON credentials file</strong>' },
          { text: 'Click <strong>Connect via OAuth</strong> for the simplified setup (recommended)' }
        ]
      },
      {
        id: 'gsc', logo: '🔍', name: 'Google Search Console',
        tagline: 'Organic search performance, impressions & CTR data',
        authType: 'oauth',
        unlocks: [
          'Organic keyword CTR benchmarked against paid campaign CTR',
          'Top search queries feeding into keyword targeting',
          'Page performance data for landing page optimisation',
          'Core Web Vitals insight for campaign quality scores'
        ],
        steps: [
          { text: 'Go to <a href="https://search.google.com/search-console" target="_blank">Google Search Console</a>' },
          { text: 'Verify ownership of your domain if not already done' },
          { text: 'Click <strong>Connect via OAuth</strong> below — InfoGenie requests read-only access' },
          { text: 'Select your property when prompted during OAuth flow' }
        ]
      },
      {
        id: 'adobe', logo: '🔴', name: 'Adobe Analytics',
        tagline: 'Enterprise-grade analytics with custom dimensions & segments',
        authType: 'apikey',
        placeholder: 'Adobe Analytics Client ID:Secret',
        unlocks: [
          'Enterprise segment sync for precision ad targeting',
          'Multi-channel attribution across all InfoGenie campaigns',
          'Custom metric integration for revenue and LTV reporting',
          'Real-time data feeds for autonomous campaign decisions'
        ],
        steps: [
          { text: 'Go to <a href="https://developer.adobe.com/console" target="_blank">Adobe Developer Console</a>' },
          { text: 'Create a new Project and add the <strong>Analytics API</strong> service' },
          { text: 'Generate <strong>OAuth Server-to-Server credentials</strong>' },
          { text: 'Note your <strong>Report Suite ID</strong> from Adobe Analytics Admin' },
          { text: 'Enter Client ID and Secret in format <code>ClientID:Secret</code> above' },
          { text: 'Click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'mixpanel', logo: '🟣', name: 'Mixpanel',
        tagline: 'Product analytics, user events & cohort analysis',
        authType: 'apikey',
        placeholder: 'Mixpanel Service Account Secret',
        unlocks: [
          'User behaviour event data for audience segmentation',
          'Cohort analysis to identify best-converting user journeys',
          'Funnel performance feeding into campaign landing page scores',
          'Retention data for lifetime value optimisation'
        ],
        steps: [
          { text: 'Go to <a href="https://mixpanel.com" target="_blank">mixpanel.com</a> → <strong>Settings → Project Settings → Service Accounts</strong>' },
          { text: 'Click <strong>Add Service Account</strong> with <strong>Analyst</strong> role' },
          { text: 'Copy the <strong>Username</strong> and <strong>Secret</strong>' },
          { text: 'Note your <strong>Project Token</strong> from Project Settings' },
          { text: 'Enter the Service Account Secret above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'segment', logo: '🟢', name: 'Segment (Twilio)',
        tagline: 'Customer data platform — unify events across all touchpoints',
        authType: 'apikey',
        placeholder: 'Segment Write Key',
        unlocks: [
          'Unified customer event data from all touchpoints',
          'Audience sync to InfoGenie from Segment Personas',
          'Real-time event streaming for campaign trigger automation',
          'Identity resolution across devices and channels'
        ],
        steps: [
          { text: 'Sign in to <a href="https://segment.com" target="_blank">segment.com</a> → <strong>Sources → Add Source</strong>' },
          { text: 'Create a new source named "InfoGenie"' },
          { text: 'Copy the <strong>Write Key</strong> from source settings' },
          { text: 'Navigate to <strong>Destinations → Add Destination</strong> and add InfoGenie as a destination' },
          { text: 'Paste your Write Key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'hotjar', logo: '🔥', name: 'Hotjar',
        tagline: 'Heatmaps, session recordings & conversion funnel analysis',
        authType: 'apikey',
        placeholder: 'Hotjar Personal API Token',
        unlocks: [
          'Landing page heatmap data informing ad creative direction',
          'Session recording access for post-click UX analysis',
          'Funnel analysis identifying conversion drop-off points',
          'User feedback insights for ad messaging refinement'
        ],
        steps: [
          { text: 'Sign in to <a href="https://hotjar.com" target="_blank">hotjar.com</a> → <strong>Account → Personal API Tokens</strong>' },
          { text: 'Click <strong>Generate a personal API token</strong>' },
          { text: 'Give it the name "InfoGenie" and copy the token' },
          { text: 'Note your <strong>Site ID</strong> from the Hotjar dashboard' },
          { text: 'Paste your token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'posthog', logo: '🦔', name: 'PostHog',
        tagline: 'Open-source product analytics, session replay & feature flags',
        authType: 'apikey',
        placeholder: 'PostHog Personal API Key (phx_...)',
        unlocks: [
          'Ad campaign → conversion funnel tracking end-to-end',
          'Session replay of post-click user journeys',
          'Feature flag integration for A/B test targeting',
          'Cohort export for precision retargeting audiences'
        ],
        steps: [
          { text: 'Go to <a href="https://app.posthog.com" target="_blank">app.posthog.com</a> → <strong>Settings → Personal API Keys</strong>' },
          { text: 'Click <strong>Create personal API key</strong> and give it a descriptive name' },
          { text: 'Select scopes: <code>query:read</code> and <code>project:read</code>' },
          { text: 'Copy the key (starts with <code>phx_</code>) and paste it above' },
          { text: 'Click <strong>Test Connection</strong>' }
        ]
      }
    ]
  },

  communication: {
    label: 'Communication',
    icon: '💬',
    desc: 'Connect messaging and communication platforms to receive real-time InfoGenie alerts, route campaign leads to chatbots, and automate customer engagement workflows.',
    badge: '6 Channels',
    items: [
      {
        id: 'slack', logo: '💬', name: 'Slack',
        tagline: 'Real-time campaign alerts, performance reports & AI insights',
        authType: 'oauth',
        unlocks: [
          'Real-time campaign performance alerts to any Slack channel',
          'Daily / weekly intelligence digest delivered to your team',
          'Instant competitor change notifications',
          'AI-generated action recommendations via Slack bot'
        ],
        steps: [
          { text: 'Go to <a href="https://api.slack.com/apps" target="_blank">api.slack.com/apps</a> and click <strong>Create New App</strong>' },
          { text: 'Choose <strong>From scratch</strong> and name it "InfoGenie Bot"' },
          { text: 'Under <strong>OAuth & Permissions</strong>, add scopes: <code>chat:write</code>, <code>channels:read</code>, <code>users:read</code>' },
          { text: 'Click <strong>Install to Workspace</strong>' },
          { text: 'Or simply click <strong>Connect via OAuth</strong> below for one-click setup' }
        ]
      },
      {
        id: 'whatsapp', logo: '📱', name: 'WhatsApp Business API',
        tagline: 'Lead qualification chatbot & conversational campaign follow-up',
        authType: 'apikey',
        placeholder: 'WhatsApp Business API Token',
        unlocks: [
          'Automated lead qualification chatbot via WhatsApp',
          'Campaign follow-up sequences triggered by ad conversions',
          'Product recommendation bot for e-commerce campaigns',
          'Appointment booking and demo scheduling automation'
        ],
        steps: [
          { text: 'Access the WhatsApp Business API via <a href="https://developers.facebook.com/docs/whatsapp" target="_blank">Meta for Developers</a>' },
          { text: 'Create a Meta Business Account and verify your business' },
          { text: 'Add the WhatsApp product to your Meta App' },
          { text: 'Navigate to <strong>WhatsApp → API Setup</strong> and generate a temporary Access Token' },
          { text: 'Add your <strong>Phone Number ID</strong> and <strong>WhatsApp Business Account ID</strong>' },
          { text: 'Paste your token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'telegram', logo: '✈️', name: 'Telegram Bot',
        tagline: 'Instant campaign alerts, competitor updates & AI notifications',
        authType: 'apikey',
        placeholder: 'Telegram Bot Token (123456:ABCdef...)',
        unlocks: [
          'Instant push notifications for campaign performance changes',
          'Competitor alert delivery to your Telegram channel',
          'Daily AI intelligence digest via Telegram',
          'Command-based campaign control via Telegram bot commands'
        ],
        steps: [
          { text: 'Open Telegram and start a chat with <strong>@BotFather</strong>' },
          { text: 'Send the command <code>/newbot</code> and follow the prompts' },
          { text: 'Choose a name (e.g. "InfoGenie Alerts") and a username (e.g. <code>infogenie_alerts_bot</code>)' },
          { text: 'BotFather will send you a <strong>Bot Token</strong> — copy it' },
          { text: 'Get your <strong>Chat ID</strong> by messaging <code>@userinfobot</code> on Telegram' },
          { text: 'Paste your Bot Token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'sendgrid', logo: '📧', name: 'SendGrid (Twilio)',
        tagline: 'Transactional emails, campaign reports & lead notifications',
        authType: 'apikey',
        placeholder: 'SendGrid API Key (SG.xxxx...)',
        unlocks: [
          'Campaign performance reports delivered to your inbox',
          'Transactional emails for lead capture from campaigns',
          'Weekly competitor intelligence digest emails',
          'Custom email templates for InfoGenie notifications'
        ],
        steps: [
          { text: 'Sign in to <a href="https://sendgrid.com" target="_blank">sendgrid.com</a> and go to <strong>Settings → API Keys</strong>' },
          { text: 'Click <strong>Create API Key</strong>' },
          { text: 'Choose <strong>Full Access</strong> or <strong>Restricted Access</strong> with <code>Mail Send</code> enabled' },
          { text: 'Copy the key immediately (starts with <code>SG.</code>)' },
          { text: 'Verify your sender email domain under <strong>Settings → Sender Authentication</strong>' },
          { text: 'Paste your API key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'teams', logo: '🔷', name: 'Microsoft Teams',
        tagline: 'Campaign alerts & AI reports delivered to Teams channels',
        authType: 'apikey',
        placeholder: 'Teams Webhook URL',
        unlocks: [
          'InfoGenie campaign alerts posted to Teams channels',
          'Daily marketing intelligence reports in Teams',
          'Competitor change notifications for your marketing team',
          'Approval workflows for autonomous campaign launches'
        ],
        steps: [
          { text: 'In Microsoft Teams, navigate to the channel where you want alerts' },
          { text: 'Click the <strong>⋯ (More Options)</strong> next to the channel name' },
          { text: 'Select <strong>Connectors → Incoming Webhook → Configure</strong>' },
          { text: 'Give the webhook a name ("InfoGenie") and upload the InfoGenie logo' },
          { text: 'Click <strong>Create</strong> and copy the webhook URL generated' },
          { text: 'Paste the webhook URL in the field above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'intercom', logo: '🔵', name: 'Intercom',
        tagline: 'Lead chat qualification & customer engagement automation',
        authType: 'apikey',
        placeholder: 'Intercom Access Token',
        unlocks: [
          'Auto-create Intercom leads from InfoGenie campaign conversions',
          'Trigger Intercom chat proactively to high-intent visitors',
          'Sync campaign UTM data to Intercom contact attributes',
          'AI-suggested chat scripts based on competitor messaging'
        ],
        steps: [
          { text: 'Sign in to <a href="https://app.intercom.com" target="_blank">app.intercom.com</a> and go to <strong>Settings → Developers → Developer Hub</strong>' },
          { text: 'Click <strong>New App</strong> and create an app named "InfoGenie"' },
          { text: 'Under <strong>Authentication</strong>, copy the <strong>Access Token</strong>' },
          { text: 'Enable permissions: <code>Read/Write Users</code>, <code>Read/Write Conversations</code>' },
          { text: 'Paste your Access Token above and click <strong>Test Connection</strong>' }
        ]
      }
    ]
  },

  productivity: {
    label: 'Google Workspace',
    icon: '🔷',
    desc: 'Connect Gmail, Google Drive, and Google Calendar in one OAuth click — monitor your inbox inside Unified Inbox, save reports and exports to Drive, and sync Brand Calendar items to Google Calendar.',
    badge: '3 Apps',
    items: [
      {
        id: 'google-workspace',
        logo: '🔷',
        name: 'Google Workspace',
        tagline: 'Gmail · Google Drive · Google Calendar',
        authType: 'oauth',
        unlocks: [
          'Read and reply to Gmail threads directly inside Unified Inbox',
          'Save AI-generated assets, scripts, and reports to Google Drive',
          'Sync Brand Calendar items to Google Calendar as all-day events',
          'One-click OAuth — all three apps, one consent screen'
        ],
        steps: [
          { text: 'Go to <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a> and create or select a project' },
          { text: 'Enable <strong>Gmail API</strong>, <strong>Google Drive API</strong>, and <strong>Google Calendar API</strong> under <strong>APIs &amp; Services → Library</strong>' },
          { text: 'Under <strong>Credentials → Create Credentials → OAuth 2.0 Client ID</strong>, choose <strong>Web application</strong>' },
          { text: 'Add your InfoGenie URL + <code>/api/integrations/workspace/oauth/callback</code> to <strong>Authorised Redirect URIs</strong>' },
          { text: 'Set <code>GOOGLE_WORKSPACE_CLIENT_ID</code> and <code>GOOGLE_WORKSPACE_CLIENT_SECRET</code> in your environment secrets' },
          { text: 'Click <strong>Connect via OAuth</strong> below — InfoGenie requests read/send for Gmail, <code>drive.file</code> for Drive, and <code>calendar.events</code> for Calendar' }
        ]
      }
    ]
  }
};

function buildSettings() {
  const wrap = document.getElementById('settingsWrap');
  const cats = Object.entries(INTEGRATIONS);
  const firstKey = cats[0][0];

  const tabsHtml = cats.map(([key, cat], i) => `
    <button class="stab ${i === 0 ? 'active' : ''}" data-tab="${key}" onclick="switchSettingsTab('${key}')">
      <span class="stab-icon">${cat.icon}</span>
      ${cat.label}
      <span class="stab-count">${cat.items.length}</span>
    </button>
  `).join('');

  const panelsHtml = cats.map(([key, cat], i) => `
    <div class="integ-panel ${i === 0 ? 'active' : ''}" id="panel-${key}">
      <div class="integ-category-header">
        <div class="ich-icon">${cat.icon}</div>
        <div class="ich-text">
          <div class="ich-title">${cat.label}</div>
          <div class="ich-sub">${cat.desc}</div>
        </div>
        <div class="ich-badge">${cat.badge}</div>
      </div>
      <div class="integ-cards-grid">
        ${cat.items.map(item => buildIntegCard(item)).join('')}
      </div>
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="settings-page">
      <div class="integ-summary-bar">
        <div class="isb-item" title="Total number of third-party services you have connected to InfoGenie. Each connection unlocks live data, AI features, or direct campaign deployment."><span class="isb-count" id="connectedCount">0</span> integrations connected</div>
        <div class="isb-divider"></div>
        <div class="isb-item" id="apiHealthDisplay" title="Live status of all connected API credentials — green means all connections are healthy and responsive.">
          <span style="color:var(--green); font-size:1rem;">●</span>&nbsp;Checking API connections…
        </div>
        <div class="isb-divider"></div>
        <div class="isb-item" title="Recommended minimum setup — connecting one ad platform lets InfoGenie push campaigns live; connecting an AI model enables Creative Studio and AI brief generation.">
          <span style="color:var(--gold);">⚡</span>&nbsp;Tip: Connect at least <strong>one Ad Platform</strong> + <strong>one AI Model</strong> to enable full autonomous operation
        </div>
        <div class="isb-cta" style="display:flex;gap:10px;align-items:center;">
          <button class="btn-primary" onclick="showDocsModal()">📖 Full Docs</button>
          <button class="btn-primary" onclick="window.open('/source','_blank')" style="background:linear-gradient(135deg,#0f2a5e,#1a3a7a);border:1px solid rgba(0,229,255,0.3);">🧾 View Source Code</button>
        </div>
      </div>

      <div class="settings-tab-bar">${tabsHtml}</div>

      ${panelsHtml}

      <div class="acct-settings-section">
        <div class="acct-settings-header">
          <div class="acct-settings-title">⚙️ InfoGenie Account Settings</div>
          <div class="acct-settings-sub">Configure your AI engine preferences, compliance settings, and notification rules</div>
        </div>
        <div class="settings-form">
          <div class="sf-row">
            <div class="sf-group">
              <label title="Your company or brand name — used to personalise AI-generated content, briefs, and reports throughout InfoGenie.">Business Name</label>
              <input type="text" class="sf-input" placeholder="Your Company Name" id="sfBizName" title="Enter your brand name as it should appear in campaign briefs, AI creative, and exported reports." />
            </div>
            <div class="sf-group">
              <label title="Your primary advertising market — InfoGenie uses this to filter keyword data, benchmark costs, and recommend localised audiences.">Default Target Region</label>
              <select class="sf-select" id="sfRegion" title="Sets the default geography for all new campaign projections, CPC benchmarks, and audience sizing estimates.">
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
          <div class="sf-row">
            <div class="sf-group">
              <label title="Your total monthly advertising budget across all channels — used to generate ROAS projections, daily spend caps, and budget allocation recommendations.">Monthly Ad Budget (USD)</label>
              <input type="number" class="sf-input" placeholder="e.g. 5000" id="sfBudget" title="InfoGenie uses this figure to calculate per-campaign budget splits, project expected revenue, and flag overspend risks." />
            </div>
            <div class="sf-group">
              <label title="Your InfoGenie subscription tier — determines the number of competitors tracked, AI calls per month, and available integrations.">Subscription Plan</label>
              <select class="sf-select" id="sfPlan" title="Upgrade your plan to unlock higher API limits, more competitor slots, and dedicated support.">
                <option>Professional — $399/mo</option>
                <option>Starter — $99/mo</option>
                <option>Agency — $999/mo</option>
                <option>Enterprise — Custom</option>
              </select>
            </div>
          </div>
          <div class="sf-row">
            <div class="sf-group">
              <label title="The AI model powering InfoGenie's creative generation, brief writing, and analysis. GPT-4o is recommended for best performance.">Primary AI Model</label>
              <select class="sf-select" title="Switch between GPT-4o, Claude, Gemini, or Mistral — each model has different strengths for creative versus analytical tasks.">
                <option>OpenAI GPT-4o (Recommended)</option>
                <option>Anthropic Claude 3.5 Sonnet</option>
                <option>Google Gemini Pro</option>
                <option>Mistral Large</option>
              </select>
            </div>
            <div class="sf-group">
              <label title="Weekly or monthly intelligence reports will be sent to this email address.">Report Delivery Email</label>
              <input type="email" class="sf-input" placeholder="you@company.com" title="Receive scheduled competitor intelligence digests, campaign performance summaries, and keyword shift alerts at this address." />
            </div>
          </div>
          <button class="sf-save" onclick="saveSettings()" title="Save all account settings — changes apply immediately to all future AI generations, projections, and campaign briefs.">Save Account Settings</button>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Autonomous Campaign Optimisation</div>
            <div class="toggle-desc">Allow InfoGenie AI to automatically pause underperformers and reallocate budget 24/7</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Real-time Competitor Monitoring</div>
            <div class="toggle-desc">Alert me instantly when competitors launch new campaigns or change their ad spend</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">AI Creative Auto-generation</div>
            <div class="toggle-desc">Automatically generate and test new creatives when performance drops below your ROAS threshold</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Weekly Intelligence Reports</div>
            <div class="toggle-desc">Receive a full competitor intelligence digest every Monday morning</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">GDPR / CCPA / POPIA Compliance Mode</div>
            <div class="toggle-desc">Enforce data privacy compliance on all campaigns, integrations, and audience targeting</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Multi-region Campaign Compliance Check</div>
            <div class="toggle-desc">Auto-validate campaigns against local advertising regulations before launch</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
      </div>
    </div>
  `;
  restoreConnectedStates();
  autoDetectServerIntegrations();
  // Check real API health asynchronously
  setTimeout(() => checkAPIHealth(), 300);
  // Hydrate the Google Ads card with real per-user vault state + handle any
  // ?ga_connected / ?ga_error / ?ga_pick query params bounced back from the
  // OAuth callback.
  setTimeout(() => { try { hydrateGoogleAdsCard(); } catch(e) { console.warn('hydrateGoogleAdsCard', e); } }, 200);
  setTimeout(() => { try { _handleGoogleAdsReturnParams(); } catch(e) {} }, 250);
  setTimeout(() => { try { hydrateMetaAdsCard(); } catch(e) { console.warn('hydrateMetaAdsCard', e); } }, 200);
  setTimeout(() => { try { _handleMetaAdsReturnParams(); } catch(e) {} }, 250);
  setTimeout(() => { try { hydrateGoogleWorkspaceCard(); } catch(e) { console.warn('hydrateGoogleWorkspaceCard', e); } }, 200);
  setTimeout(() => { try { _handleGWReturnParams(); } catch(e) {} }, 250);
  setTimeout(() => { hydrateApifyCard().catch(() => {}); }, 300);
}

async function checkAPIHealth() {
  const display = document.getElementById('apiHealthDisplay');
  if (!display) return;
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const dfColor = data.dataforseo ? '#10B981' : '#DC2626';
    const rapColor = data.rapidapi   ? '#10B981' : '#F59E0B';
    const dfLabel  = data.dataforseo ? '✓ Connected' : '✗ Not configured';
    const rapLabel = data.rapidapi   ? '✓ Connected' : '! Key missing';
    const allOk    = data.dataforseo && data.rapidapi;
    display.innerHTML = `
      <span style="color:${allOk?'#10B981':'#F59E0B'};font-size:1rem;">●</span>
      &nbsp;API Status:&nbsp;
      <span style="color:${dfColor};font-weight:700">DataForSEO ${dfLabel}</span>
      &nbsp;·&nbsp;
      <span style="color:${rapColor};font-weight:700">RapidAPI ${rapLabel}</span>
      &nbsp;·&nbsp;
      <span style="color:#10B981;font-weight:700">AI Engine Online</span>
    `;
  } catch(e) {
    display.innerHTML = '<span style="color:#F59E0B;">●</span>&nbsp;API health check unavailable — server is running';
  }
}

function buildIntegCard(item) {
  const isApiKey = item.authType === 'apikey';
  const isOAuth = item.authType === 'oauth';
  const cardId = 'card-' + item.id;

  const unlocksList = item.unlocks.map(u => `
    <li><span class="ul-check">✓</span><span>${u}</span></li>
  `).join('');

  const stepsList = item.steps.map((s, i) => `
    <div class="step-item">
      <div class="step-num">${i + 1}</div>
      <div class="step-text">${s.text}</div>
    </div>
  `).join('');

  const connectFn = (isApiKey && item.vaultSave) ? `connectVault` : `connectCard`;
  const connectSection = isApiKey ? `
    <div class="api-key-row">
      <input type="password" class="api-key-inp" placeholder="${item.placeholder || 'Paste your API Key here...'}" id="inp-${item.id}" />
      <button class="btn-test" onclick="testConnection('${item.id}')">Test</button>
    </div>
    <div class="integ-card-actions">
      <button class="btn-connect-card" id="btn-${item.id}" onclick="${connectFn}('${item.id}', '${item.name}')">Connect</button>
      <button class="btn-docs-card" onclick="showIntegrationDoc('${item.id}')">📖 View Docs</button>
    </div>
  ` : `
    <div class="integ-card-actions" style="flex-direction:column; gap:8px;">
      <button class="oauth-btn" id="btn-${item.id}" onclick="connectOAuth('${item.id}', '${item.name}')">
        <span>🔐</span> Connect via OAuth
      </button>
      <button class="btn-docs-card" style="width:100%; text-align:center;" onclick="showIntegrationDoc('${item.id}')">📖 View Integration Docs</button>
    </div>
  `;

  return `
    <div class="integ-card" id="${cardId}">
      <div class="integ-card-top">
        <div class="integ-logo">${item.logo}</div>
        <div class="integ-meta">
          <div class="integ-name">${item.name}</div>
          <div class="integ-tagline">${item.tagline}</div>
        </div>
        <div class="integ-conn-status ics-off" id="status-${item.id}">
          <span>○</span> Not connected
        </div>
      </div>
      <div class="integ-card-body">
        <div class="unlocks-title">✦ What it unlocks in InfoGenie</div>
        <ul class="unlocks-list">${unlocksList}</ul>
        <div class="steps-title">↳ How to integrate</div>
        <div class="steps-list">${stepsList}</div>
        ${connectSection}
      </div>
    </div>
  `;
}

// ===================================================
// PER-INTEGRATION DOCUMENTATION
// ===================================================

function _findIntegById(id) {
  for (const [catKey, cat] of Object.entries(INTEGRATIONS)) {
    const item = cat.items.find(i => i.id === id);
    if (item) return { item, catKey, catLabel: cat.label, catIcon: cat.icon };
  }
  return null;
}

function _getIntegApiDetails(item) {
  const isOAuth = item.authType === 'oauth';
  const apiDetails = {
    'google-ads':    { baseUrl: 'https://googleads.googleapis.com/v16', rateLimits: '10,000 req/day per customer', plans: 'Active Google Ads account + API access approval', errorCodes: [['UNAUTHENTICATED', 'OAuth token expired — re-authenticate'], ['INVALID_ARGUMENT', 'Check field names match Google Ads API spec'], ['RESOURCE_EXHAUSTED', 'Daily quota exceeded — reduce request volume'], ['NOT_FOUND', 'Customer ID or campaign ID does not exist']] },
    'meta-ads':      { baseUrl: 'https://graph.facebook.com/v19.0', rateLimits: '200 calls/hour per ad account', plans: 'Active Meta Business Manager + Marketing API access', errorCodes: [['190', 'Access token expired — reconnect via OAuth'], ['100', 'Invalid parameter — check field names'], ['17', 'API rate limit hit — wait 1 hour'], ['803', 'Ad account ID format must be act_XXXXXXX']] },
    'tiktok-ads':    { baseUrl: 'https://business-api.tiktok.com/open_api/v1.3', rateLimits: '1,000 req/min (campaign), 100 req/min (reporting)', plans: 'TikTok for Business account + approved API access', errorCodes: [['40100', 'Access token invalid — regenerate in developer portal'], ['40002', 'Missing required parameter'], ['50002', 'Service temporarily unavailable — retry with exponential back-off']] },
    'linkedin-ads':  { baseUrl: 'https://api.linkedin.com/v2', rateLimits: '100 req/day for free, varies by API product', plans: 'LinkedIn Marketing Developer Platform access required', errorCodes: [['401', 'OAuth token invalid or expired'], ['403', 'Insufficient permissions — check r_ads/rw_ads scope'], ['429', 'Rate limit exceeded'], ['404', 'Campaign or account ID not found']] },
    'x-ads':         { baseUrl: 'https://ads-api.twitter.com/12', rateLimits: '300 req/15 min window', plans: 'Funded X Ads account + Ads API access (approved)', errorCodes: [['32', 'Authentication required — check token'], ['88', 'Rate limit exceeded'], ['186', 'Tweet text too long'], ['261', 'Application cannot perform write actions']] },
    'pinterest-ads': { baseUrl: 'https://api.pinterest.com/v5', rateLimits: '1,000 req/min for campaigns', plans: 'Pinterest Business account + Ads API approval', errorCodes: [['401', 'Invalid access token'], ['403', 'Insufficient scope'], ['429', 'Rate limit exceeded'], ['400', 'Invalid request body']] },
    'amazon-ads':    { baseUrl: 'https://advertising-api.amazon.com', rateLimits: 'Varies by endpoint (50–1000 req/sec)', plans: 'Amazon Seller/Vendor Central account + advertising account', errorCodes: [['401', 'Refresh token expired — re-authenticate'], ['400', 'Invalid profile ID or body'], ['429', 'Throttled — implement exponential back-off'], ['403', 'Insufficient access to this profile']] },
    'semrush':       { baseUrl: 'https://api.semrush.com', rateLimits: 'Based on API units (Business: 3,000/day)', plans: 'Semrush API subscription (Business plan recommended)', errorCodes: [['ERROR 50 :: NOTHING FOUND', 'Domain has no indexed data in Semrush'], ['ERROR 80 :: NOT ENOUGH UNITS', 'API unit balance depleted — upgrade plan'], ['ERROR 120 :: WRONG KEY', 'Invalid API key — regenerate in account settings']] },
    'similarweb':    { baseUrl: 'https://api.similarweb.com/v1', rateLimits: 'Depends on plan (typically 1,000 req/month)', plans: 'SimilarWeb Digital Intelligence API subscription', errorCodes: [['401', 'Invalid API key'], ['402', 'Monthly quota exhausted'], ['404', 'Website not found in SimilarWeb database']] },
    'ahrefs':        { baseUrl: 'https://api.ahrefs.com/v3', rateLimits: '500 rows/request, 1,000 req/day (Business)', plans: 'Ahrefs Business plan or above', errorCodes: [['401', 'Invalid or revoked API token'], ['403', 'Feature not available on your plan'], ['429', 'Rate limit exceeded — reduce request frequency']] },
    'builtwith':     { baseUrl: 'https://api.builtwith.com/v21/api.json', rateLimits: '100 lookups/day (Basic), 2,000 (Pro)', plans: 'BuiltWith API paid plan required', errorCodes: [['400', 'Bad request — check API key format'], ['402', 'Quota exceeded for current billing period'], ['404', 'Domain not found in BuiltWith database']] },
    'spyfu':         { baseUrl: 'https://www.spyfu.com/apis/url_api', rateLimits: '10,000 results/day on Pro plan', plans: 'SpyFu API plan subscription', errorCodes: [['403', 'Invalid API credentials'], ['429', 'Daily rate limit exceeded'], ['404', 'Domain not indexed by SpyFu']] },
    'moz':               { baseUrl: 'https://lsapi.seomoz.com/v2', rateLimits: '10 queries per 10 seconds (free), higher on paid', plans: 'Moz Pro API access (paid plan)', errorCodes: [['401', 'Invalid Access ID or Secret Key'], ['429', 'Request rate exceeded'], ['400', 'Invalid URL or parameter']] },
    'meta-ad-library':   { baseUrl: 'https://graph.facebook.com/v19.0/ads_archive', rateLimits: '200 calls/hour per user token, 500/day per app', plans: 'Any Facebook Developer App with ads_read permission (free)', errorCodes: [['190', 'Access token expired or invalid — regenerate a long-lived token'], ['100', 'Missing or invalid parameter — check ad_type and ad_reached_countries fields'], ['17', 'Rate limit hit — wait 1 hour before retrying'], ['200', 'Insufficient permissions — ensure ads_read scope is granted on your token']] },
    'brandwatch':        { baseUrl: 'https://api.brandwatch.com/v2', rateLimits: '60 req/min for mentions, 10 req/min for analytics', plans: 'Brandwatch Consumer Intelligence or Social Intelligence plan', errorCodes: [['401', 'Invalid or expired API token — regenerate in Settings → API Access'], ['403', 'Scope not granted — check queries:read and mentions:read permissions'], ['429', 'Rate limit exceeded — Brandwatch enforces per-minute windows'], ['404', 'Query ID not found — verify your query was created in Brandwatch dashboard']] },
    'openai':        { baseUrl: 'https://api.openai.com/v1', rateLimits: 'GPT-4o: 10,000 RPM, 10M TPM (Tier 3)', plans: 'OpenAI paid account with GPT-4 access enabled', errorCodes: [['401', 'Invalid API key — check sk-proj- prefix'], ['429', 'Rate limit or quota exceeded — add billing credits'], ['500', 'OpenAI server error — retry with back-off'], ['400', 'Invalid request body or model name']] },
    'anthropic':     { baseUrl: 'https://api.anthropic.com/v1', rateLimits: '1,000 RPM, 400K TPM (Claude 3.5 Sonnet)', plans: 'Anthropic API account with Claude 3.5 access', errorCodes: [['401', 'Invalid API key — starts with sk-ant-'], ['529', 'API overloaded — retry with exponential back-off'], ['400', 'Invalid request — check max_tokens and model name']] },
    'gemini':        { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', rateLimits: '60 req/min (free), higher on paid', plans: 'Google AI Studio account or Google Cloud project', errorCodes: [['401', 'Invalid or missing API key'], ['429', 'Quota exceeded — enable billing on Google Cloud'], ['400', 'Invalid request — check model name and content format']] },
    'midjourney':    { baseUrl: 'https://api.userapi.ai/midjourney/v2', rateLimits: 'Based on GPU credits purchased', plans: 'Midjourney Pro or Mega plan + API access', errorCodes: [['401', 'Invalid API token'], ['400', 'Malformed prompt or missing parameters'], ['429', 'GPU queue full — retry after delay']] },
    'stability':     { baseUrl: 'https://api.stability.ai/v1', rateLimits: '150 credits/month (free), purchase additional', plans: 'Stability AI API account with image credits', errorCodes: [['401', 'Invalid API key'], ['402', 'Insufficient credits to complete request'], ['400', 'Invalid aspect ratio or prompt format']] },
    'perplexity':    { baseUrl: 'https://api.perplexity.ai', rateLimits: '60 req/min (Pro plan)', plans: 'Perplexity API subscription', errorCodes: [['401', 'Invalid or expired API key'], ['429', 'Rate limit exceeded'], ['400', 'Model not available or invalid parameters']] },
    'hubspot':       { baseUrl: 'https://api.hubapi.com', rateLimits: '100 req/10s, 40,000 req/day', plans: 'HubSpot Marketing Hub (Starter or above recommended)', errorCodes: [['401', 'Invalid API key or OAuth token'], ['403', 'Scope not authorised — check OAuth permissions'], ['429', 'Rate limit exceeded'], ['404', 'Contact or list ID not found']] },
    'salesforce':    { baseUrl: 'https://{instance}.salesforce.com/services/data/v59.0', rateLimits: '100,000 API calls/24 hours (Enterprise)', plans: 'Salesforce Enterprise or Unlimited edition', errorCodes: [['INVALID_SESSION_ID', 'Session expired — refresh OAuth token'], ['REQUEST_LIMIT_EXCEEDED', 'Daily API limit reached'], ['FIELD_INTEGRITY_EXCEPTION', 'Required field missing or invalid']] },
    'zapier':        { baseUrl: 'https://hooks.zapier.com/hooks/catch', rateLimits: 'Depends on Zap plan (100–50,000 tasks/month)', plans: 'Zapier Professional plan or above for webhooks', errorCodes: [['410', 'Webhook URL disabled — re-create Zap'], ['400', 'Invalid JSON payload — check Content-Type header']] },
    'make':          { baseUrl: 'https://hook.eu1.make.com/{webhook-id}', rateLimits: 'Based on Make.com plan (ops/month)', plans: 'Make.com Core plan or above', errorCodes: [['400', 'Invalid payload structure'], ['404', 'Scenario not found or inactive']] },
    'klaviyo':       { baseUrl: 'https://a.klaviyo.com/api', rateLimits: '75 req/s burst, sustained at 10 req/s', plans: 'Klaviyo account with API key access', errorCodes: [['401', 'Invalid API key prefix — check pk_/sk_ format'], ['403', 'Insufficient scope for this endpoint'], ['429', 'Rate throttled — implement retry logic']] },
    'mailchimp':     { baseUrl: 'https://{dc}.api.mailchimp.com/3.0', rateLimits: '10 simultaneous connections per key', plans: 'Mailchimp Standard or Premium plan', errorCodes: [['401', 'Invalid API key or data centre prefix'], ['405', 'Method not allowed for this resource'], ['400', 'Invalid field in request body']] },
    'ga4':           { baseUrl: 'https://analyticsdata.googleapis.com/v1beta', rateLimits: '10,000 tokens/hour, 1 req/s per property', plans: 'Google Analytics 4 property + Google Cloud project', errorCodes: [['401', 'OAuth token expired — re-authenticate'], ['403', 'No access to this GA4 property'], ['429', 'Quota exceeded — reduce sampling rate']] },
    'segment':       { baseUrl: 'https://api.segment.io/v1', rateLimits: 'No hard limit on tracking; workspace-level throttle', plans: 'Segment Team plan or above for source access', errorCodes: [['401', 'Invalid write key'], ['400', 'Malformed event payload'], ['413', 'Payload too large — keep events under 32KB']] },
    'mixpanel':      { baseUrl: 'https://data.mixpanel.com/api/2.0', rateLimits: '400 queries/hour (Enterprise)', plans: 'Mixpanel Growth or Enterprise plan', errorCodes: [['403', 'Invalid project secret'], ['400', 'Invalid date range or property name'], ['429', 'Query rate limit exceeded']] },
    'hotjar':        { baseUrl: 'https://api.hotjar.com/v1', rateLimits: '100 req/min', plans: 'Hotjar Business plan for API access', errorCodes: [['401', 'Invalid personal API key'], ['404', 'Site ID not found'], ['429', 'Rate limit exceeded']] },
    'bigquery':      { baseUrl: 'https://bigquery.googleapis.com/bigquery/v2', rateLimits: '300 req/min per user, 3,000/min per project', plans: 'Google Cloud project with BigQuery enabled', errorCodes: [['403', 'BigQuery API not enabled in project'], ['400', 'Invalid SQL query syntax'], ['404', 'Dataset or table not found']] },
    'snowflake':     { baseUrl: 'https://{account}.snowflakecomputing.com/api/v2', rateLimits: 'Based on warehouse credits (compute usage)', plans: 'Snowflake Standard or above, SQL API enabled', errorCodes: [['002003', 'Object does not exist'], ['390100', 'Account not found'], ['250001', 'No active warehouse — resume warehouse first']] },
    'slack':         { baseUrl: 'https://slack.com/api', rateLimits: '1 req/sec for most methods', plans: 'Slack workspace + Bot Token with channels:write scope', errorCodes: [['invalid_auth', 'Invalid or revoked bot token'], ['channel_not_found', 'Bot not invited to the channel'], ['rate_limited', 'Slow down — implement Retry-After header']] },
    'teams':         { baseUrl: 'https://smba.trafficmanager.net/apis', rateLimits: '1,500 msgs/sec, 3,600/hour per app', plans: 'Microsoft 365 or Azure AD + Teams app registration', errorCodes: [['401', 'Invalid or expired access token'], ['403', 'Bot not added to team or channel'], ['429', 'Too many requests — respect Retry-After header']] },
    'twilio':        { baseUrl: 'https://api.twilio.com/2010-04-01', rateLimits: '100 msg/sec on short codes, 1/sec on long codes', plans: 'Twilio paid account with verified number', errorCodes: [['20003', 'Authentication failure — check Account SID and Auth Token'], ['21211', 'Invalid To phone number format'], ['21614', 'Number not SMS-capable'], ['30003', 'Unreachable destination handset']] }
  };
  return apiDetails[item.id] || {
    baseUrl: 'https://api.' + item.id.replace('-', '') + '.com/v1',
    rateLimits: 'Refer to provider documentation',
    plans: 'Paid account required',
    errorCodes: [['401', 'Invalid credentials'], ['429', 'Rate limit exceeded'], ['400', 'Invalid request parameters']]
  };
}

function _getCodeExample(item) {
  const api = _getIntegApiDetails(item);
  if (item.authType === 'oauth') {
    return {
      lang: 'JavaScript (fetch)',
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
console.log(data); <span class="c-comment">// InfoGenie uses this to sync campaign data</span>`
    };
  } else {
    const keyFormat = item.placeholder ? item.placeholder.split(' ')[0] : 'YOUR_API_KEY';
    return {
      lang: 'cURL',
      code: `<span class="c-comment"># InfoGenie — ${item.name} connection test</span>
curl -X GET <span class="c-str">'${api.baseUrl}'</span> \\
  -H <span class="c-str">'Authorization: Bearer ${keyFormat}'</span> \\
  -H <span class="c-str">'Content-Type: application/json'</span>

<span class="c-comment"># Expected: 200 OK with account/profile data</span>
<span class="c-comment"># If you see 401: your API key is invalid or has no permissions</span>`
    };
  }
}

function _getTroubleshooting(item) {
  const isOAuth = item.authType === 'oauth';
  return [
    {
      q: isOAuth ? 'OAuth authorisation fails or redirects to an error page' : 'My API key is valid but the Test Connection button fails',
      a: isOAuth
        ? 'Make sure you are signed in to the correct account in the browser before clicking Connect via OAuth. Also check that your app has the required permissions/scopes listed in Step 3 above.'
        : 'Ensure you\'ve copied the full key without leading/trailing spaces. Some keys are environment-specific (e.g. sandbox vs. production). Try pasting into a plain text editor first to check for hidden characters.'
    },
    {
      q: 'Connected successfully but InfoGenie shows no data',
      a: `Wait 2–5 minutes after first connecting — InfoGenie needs to complete an initial data sync. If data is still missing after 10 minutes, check that your ${item.name} account has at least one active campaign or dataset.`
    },
    {
      q: 'I see a rate limit error in the activity log',
      a: `${item.name} rate limits: ${_getIntegApiDetails(item).rateLimits}. InfoGenie automatically spaces out requests. If you see persistent rate limit errors, check that no other tools are simultaneously hitting the same API credentials.`
    },
    {
      q: 'How do I disconnect this integration?',
      a: 'Disconnecting from InfoGenie only removes the credentials from our system — it does not revoke access in your provider account. To fully revoke, also remove the InfoGenie app from your ' + item.name + ' account settings.'
    }
  ];
}

function showIntegrationDoc(id) {
  const found = _findIntegById(id);
  if (!found) { showToast('Integration not found'); return; }
  const { item, catLabel, catIcon } = found;

  const modal = document.getElementById('docsModal');
  const inner = document.getElementById('docsModalInner');
  const api = _getIntegApiDetails(item);
  const codeEx = _getCodeExample(item);
  const trouble = _getTroubleshooting(item);
  const authLabel = item.authType === 'oauth' ? 'OAuth 2.0' : 'API Key';
  const authClass = item.authType === 'oauth' ? 'oauth' : 'apikey';

  const unlocksHtml = item.unlocks.map(u => `
    <div class="docs-unlock-item">
      <span class="docs-unlock-check">✓</span>
      <span class="docs-unlock-text">${u}</span>
    </div>
  `).join('');

  const stepsHtml = item.steps.map((s, i) => `
    <div class="docs-doc-step">
      <div class="docs-doc-num">${i + 1}</div>
      <div class="docs-doc-text">${s.text}</div>
    </div>
  `).join('');

  const errorHtml = api.errorCodes.map(([code, msg]) => `
    <tr>
      <td><code>${code}</code></td>
      <td>${msg}</td>
    </tr>
  `).join('');

  const troubleHtml = trouble.map(t => `
    <div class="docs-trouble-item">
      <div class="docs-trouble-q">❓ ${t.q}</div>
      <div class="docs-trouble-a">${t.a}</div>
    </div>
  `).join('');

  inner.innerHTML = `
    <div class="integ-doc-page">
      <div class="integ-doc-hero">
        <div class="integ-doc-hero-top">
          <button class="integ-doc-back" onclick="showDocsModal()">← All Integrations</button>
          <div class="integ-doc-logo">${item.logo}</div>
          <div class="integ-doc-hero-text">
            <div class="integ-doc-name">${item.name}</div>
            <div class="integ-doc-tagline">${item.tagline}</div>
            <div class="integ-doc-badges">
              <span class="docs-badge">${catIcon} ${catLabel}</span>
              <span class="docs-badge ${authClass === 'oauth' ? 'green' : ''}">${authLabel}</span>
              <span class="docs-badge">InfoGenie Integration</span>
            </div>
          </div>
        </div>
      </div>

      <div class="integ-doc-body">

        <!-- WHAT IT UNLOCKS -->
        <div>
          <div class="docs-section-title">✦ What connecting ${item.name} unlocks in InfoGenie</div>
          <div class="docs-unlocks">${unlocksHtml}</div>
        </div>

        <!-- STEP BY STEP -->
        <div>
          <div class="docs-section-title">↳ Step-by-Step Integration Guide</div>
          <div class="docs-doc-steps">${stepsHtml}</div>
        </div>

        <!-- CODE EXAMPLE -->
        <div>
          <div class="docs-section-title">{'{'} Code Example — API Request</div>
          <div class="docs-code-block">
            <div class="docs-code-bar">
              <span class="docs-code-lang">${codeEx.lang}</span>
              <span>• ${item.name} Integration</span>
              <button class="docs-code-copy" onclick="navigator.clipboard.writeText(document.querySelector('.docs-code-content').innerText).then(()=>showToast('📋 Code copied'))">Copy</button>
            </div>
            <div class="docs-code-content">${codeEx.code}</div>
          </div>
        </div>

        <!-- API REFERENCE -->
        <div>
          <div class="docs-section-title">⚙ API Reference</div>
          <table class="docs-api-table">
            <thead><tr><th>Property</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Base URL</td><td><code>${api.baseUrl}</code></td></tr>
              <tr><td>Auth Method</td><td><code>${authLabel}</code></td></tr>
              <tr><td>Rate Limits</td><td>${api.rateLimits}</td></tr>
              <tr><td>Plan Required</td><td>${api.plans}</td></tr>
              <tr><td>InfoGenie Sync Interval</td><td>Every 15 minutes (campaigns), 1 hour (analytics)</td></tr>
            </tbody>
          </table>
        </div>

        <!-- ERROR CODES -->
        <div>
          <div class="docs-section-title">⚠ Common Error Codes</div>
          <table class="docs-api-table">
            <thead><tr><th>Code</th><th>Meaning & Fix</th></tr></thead>
            <tbody>${errorHtml}</tbody>
          </table>
        </div>

        <!-- TROUBLESHOOTING -->
        <div>
          <div class="docs-section-title">🔧 Troubleshooting</div>
          <div class="docs-trouble-list">${troubleHtml}</div>
        </div>

        <!-- BOTTOM ACTIONS -->
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn-auto-target" onclick="closeDocsModal(); switchSettingsTab('${found.catKey}'); setTimeout(()=>{ const el=document.getElementById('card-${item.id}'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }, 200);">
            Go to ${item.name} Settings →
          </button>
          <button class="btn-vs-copy" onclick="showDocsModal()">← Back to All Integrations</button>
        </div>

      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  inner.scrollTop = 0;
}

// ===================================================
// DOCS MODAL
// ===================================================
function showDocsModal() {
  const modal = document.getElementById('docsModal');
  const inner = document.getElementById('docsModalInner');

  // Show modal immediately — content build happens after, so a template error never hides the modal
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  try {
  inner.innerHTML = `
    <div class="docs-header">
      <div class="docs-header-title">📖 InfoGenie Integration Documentation</div>
      <div class="docs-header-sub">Everything you need to connect InfoGenie to your ad platforms, analytics tools, AI models, and communication channels — and start running autonomous campaigns.</div>
      <div class="docs-header-badges">
        <span class="docs-badge green">● Platform Online</span>
        <span class="docs-badge">v2.4.1</span>
        <span class="docs-badge">33 Integrations Available</span>
        <span class="docs-badge">REST API + OAuth 2.0</span>
      </div>
    </div>

    <div class="docs-body">

      <!-- QUICK START -->
      <div>
        <div class="docs-section-title">🚀 Quick Start — Get live in 15 minutes</div>
        <div class="docs-steps">
          <div class="docs-step">
            <div class="docs-step-num">1</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Run your first analysis</div>
              <div class="docs-step-desc">Enter any competitor or your own website URL on the Home page and click <strong>Analyse Now</strong>. InfoGenie detects your industry and maps the competitive landscape automatically — no setup required.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">2</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Connect at least one Ad Platform</div>
              <div class="docs-step-desc">Go to <strong>Settings → Ad Platforms</strong> and connect Google Ads or Meta Ads via OAuth. This enables InfoGenie to autonomously deploy, pause, and optimise campaigns on your behalf. OAuth takes under 60 seconds.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">3</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Connect an AI Model</div>
              <div class="docs-step-desc">Go to <strong>Settings → AI Models</strong> and paste your OpenAI API key (starts with <code>sk-proj-</code>). This powers ad copy generation, strategic analysis, and creative recommendations. OpenAI GPT-4o is recommended for best results.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">4</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Add an Intelligence API (optional but powerful)</div>
              <div class="docs-step-desc">Connect Semrush or SimilarWeb under <strong>Settings → Intelligence APIs</strong> to enrich competitor data with real keyword rankings, traffic estimates, and ad spend data. Semrush Business plan or above required for API access.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">5</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Launch your first autonomous campaign</div>
              <div class="docs-step-desc">Navigate to <strong>Campaigns</strong>, choose a recommended campaign, and click <strong>Launch Campaign</strong>. InfoGenie will configure targeting, creative, bidding, and budget automatically based on competitor intelligence — then monitor and optimise 24/7.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- INTEGRATION CATEGORIES -->
      <div>
        <div class="docs-section-title">🔌 Integration Categories</div>
        <div class="docs-integ-grid">
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('platforms')">
            <div class="dit-header">
              <span class="dit-icon">🚀</span>
              <span class="dit-name">Ad Platforms</span>
              <span class="dit-count">7</span>
            </div>
            <div class="dit-desc">Google Ads, Meta, TikTok, LinkedIn, X, Pinterest, Amazon — deploy campaigns autonomously across all major platforms.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('intelligence')">
            <div class="dit-header">
              <span class="dit-icon">🔍</span>
              <span class="dit-name">Intelligence APIs</span>
              <span class="dit-count">6</span>
            </div>
            <div class="dit-desc">Semrush, SimilarWeb, Ahrefs, BuiltWith, SpyFu, Moz — power competitor analysis with real traffic and keyword data.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('ai')">
            <div class="dit-header">
              <span class="dit-icon">🤖</span>
              <span class="dit-name">AI Models</span>
              <span class="dit-count">6</span>
            </div>
            <div class="dit-desc">OpenAI, Claude, Gemini, Stability AI, Mistral, ElevenLabs — drive ad copy, creative generation, and strategic reasoning.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('crm')">
            <div class="dit-header">
              <span class="dit-icon">🔗</span>
              <span class="dit-name">CRM & Automation</span>
              <span class="dit-count">7</span>
            </div>
            <div class="dit-desc">HubSpot, Salesforce, Pipedrive, Klaviyo, Marketo, Zapier, Make — route leads and automate workflows from campaigns.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('analytics')">
            <div class="dit-header">
              <span class="dit-icon">📈</span>
              <span class="dit-name">Analytics & Data</span>
              <span class="dit-count">7</span>
            </div>
            <div class="dit-desc">GA4, Search Console, Adobe Analytics, Mixpanel, Segment, Hotjar, Amplitude — feed real performance data into InfoGenie.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('communication')">
            <div class="dit-header">
              <span class="dit-icon">💬</span>
              <span class="dit-name">Communication</span>
              <span class="dit-count">6</span>
            </div>
            <div class="dit-desc">Slack, WhatsApp, Telegram, SendGrid, Microsoft Teams, Intercom — receive alerts and route leads via your preferred channels.</div>
          </div>
        </div>
      </div>

      <!-- INTEGRATION DIRECTORY -->
      <div>
        <div class="docs-section-title">📋 All Integrations — Click Any to View Full Docs</div>
        <div class="docs-dir-grid">
          ${Object.entries(INTEGRATIONS).flatMap(([catKey, cat]) =>
            cat.items.map(item => `
              <div class="docs-dir-item" onclick="showIntegrationDoc('${item.id}')">
                <div class="docs-dir-logo">${item.logo}</div>
                <div class="docs-dir-info">
                  <div class="docs-dir-name">${item.name}</div>
                  <div class="docs-dir-cat">${cat.icon} ${cat.label}</div>
                </div>
                <span class="docs-dir-auth ${item.authType}">${item.authType === 'oauth' ? 'OAuth' : 'API Key'}</span>
              </div>
            `)
          ).join('')}
        </div>
      </div>

      <!-- AUTH METHODS -->
      <div>
        <div class="docs-section-title">🔐 Authentication Methods</div>
        <table class="docs-table">
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
              <td><span class="dt-badge dt-oauth">OAuth 2.0</span></td>
              <td>One-click connect — InfoGenie requests permissions and securely stores refresh tokens. You never share passwords.</td>
              <td>Google Ads, Meta, LinkedIn, Pinterest, HubSpot, Salesforce, Slack, GA4, GSC</td>
              <td>Industry standard. Revoke access anytime from the platform's security settings.</td>
            </tr>
            <tr>
              <td><span class="dt-badge dt-apikey">API Key</span></td>
              <td>Generate a key in the platform's developer console and paste it here. InfoGenie stores it encrypted using AES-256.</td>
              <td>OpenAI, Semrush, Ahrefs, TikTok, Klaviyo, SendGrid, Slack webhook, Hotjar, and more</td>
              <td>Keys are stored encrypted. Never share keys with third parties. Rotate keys periodically.</td>
            </tr>
            <tr>
              <td><span class="dt-badge dt-webhook">Webhook URL</span></td>
              <td>InfoGenie sends event payloads to a URL you provide. Used for one-way notification delivery.</td>
              <td>Slack, Microsoft Teams, Zapier, Make</td>
              <td>Webhook URLs are unique per connection. Rotate by generating a new webhook in the platform.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- PLANS -->
      <div>
        <div class="docs-section-title">💎 Plan & Integration Limits</div>
        <div class="docs-plan-grid">
          <div class="docs-plan-card">
            <div class="dpc-header">
              <div class="dpc-name">Starter</div>
              <div class="dpc-price">$99/mo</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>2 ad platforms</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>1 AI model</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>1 intelligence API</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>1 communication channel</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>5 competitor analyses/mo</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Basic AI campaigns</div>
            </div>
          </div>
          <div class="docs-plan-card featured">
            <div class="dpc-header">
              <div class="dpc-name">Professional</div>
              <div class="dpc-price">$399/mo</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>All ad platforms</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>3 AI models</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>3 intelligence APIs</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>All communication channels</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Unlimited analyses</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Autonomous optimisation</div>
            </div>
          </div>
          <div class="docs-plan-card">
            <div class="dpc-header">
              <div class="dpc-name">Agency</div>
              <div class="dpc-price">$999/mo</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Everything in Pro</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>All 33 integrations</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>CRM + Analytics sync</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Up to 25 client accounts</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>White-label reports</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Priority support</div>
            </div>
          </div>
          <div class="docs-plan-card">
            <div class="dpc-header">
              <div class="dpc-name">Enterprise</div>
              <div class="dpc-price">Custom</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Everything in Agency</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Custom AI model training</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Dedicated infrastructure</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Unlimited client accounts</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>SLA guarantee</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Custom integrations</div>
            </div>
          </div>
        </div>
      </div>

      <!-- SUPPORT -->
      <div>
        <div class="docs-section-title">🛟 Support & Resources</div>
        <div class="docs-support-grid">
          <div class="docs-support-card" onclick="showToast('📚 Opening API Reference at docs.infogenie.ai/api...')">
            <div class="dsc-icon">📚</div>
            <div class="dsc-title">API Reference</div>
            <div class="dsc-desc">Full REST API docs, endpoint specs, rate limits, and code examples in Python, JS, and cURL.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('🎥 Opening video tutorials at learn.infogenie.ai...')">
            <div class="dsc-icon">🎥</div>
            <div class="dsc-title">Video Tutorials</div>
            <div class="dsc-desc">Step-by-step video walkthroughs for every integration and core InfoGenie workflow.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('💬 Opening live chat support...')">
            <div class="dsc-icon">💬</div>
            <div class="dsc-title">Live Chat Support</div>
            <div class="dsc-desc">Chat with our integration engineers Mon–Fri 9am–6pm GMT. Response under 2 minutes on Pro+ plans.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('🐛 Opening issue tracker at github.com/infogenie...')">
            <div class="dsc-icon">🐛</div>
            <div class="dsc-title">Bug Reports</div>
            <div class="dsc-desc">Report integration issues on our public GitHub. P1 bugs fixed within 24 hours on Enterprise plans.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('🗺️ Opening public roadmap at roadmap.infogenie.ai...')">
            <div class="dsc-icon">🗺️</div>
            <div class="dsc-title">Product Roadmap</div>
            <div class="dsc-desc">Vote on upcoming integrations and features. Snapchat Ads, Reddit Ads, and BigQuery coming Q2 2026.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('📧 Opening community at community.infogenie.ai...')">
            <div class="dsc-icon">🌐</div>
            <div class="dsc-title">Community Forum</div>
            <div class="dsc-desc">Connect with 8,000+ InfoGenie users, share integration configs, and get peer advice.</div>
          </div>
        </div>
      </div>

      <!-- SECURITY NOTE -->
      <div style="background:var(--gray-50); border:1px solid var(--border); border-radius:10px; padding:16px 20px; display:flex; gap:12px; align-items:flex-start;">
        <span style="font-size:1.25rem; flex-shrink:0;">🔒</span>
        <div>
          <div style="font-size:0.875rem; font-weight:700; color:var(--navy); margin-bottom:4px;">Security & Data Handling</div>
          <div style="font-size:0.8125rem; color:var(--gray-500); line-height:1.6;">All API keys and OAuth tokens are encrypted at rest using AES-256 and in transit using TLS 1.3. InfoGenie never stores raw credentials in plaintext. You can revoke all integration access at any time from this settings page. InfoGenie is SOC 2 Type II compliant and GDPR-ready. Your competitor analysis data is never shared with third parties or used to train our AI models.</div>
        </div>
      </div>

    </div>
  `;
  } catch(err) {
    inner.innerHTML = `<div style="padding:40px 24px;text-align:center;color:#6B7280;font-size:.9rem">
      <div style="font-size:2rem;margin-bottom:12px">📖</div>
      <div style="font-weight:700;color:#0A1628;margin-bottom:8px">Integration Docs</div>
      <p>Go to <strong>Settings → any integration card → View Docs</strong> to view full setup instructions and API reference for each service.</p>
    </div>`;
  }
}

function closeDocsModal() {
  const modal = document.getElementById('docsModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

  // ── Re-attach public entry points to window ────────────────────────────────
  window.INTEGRATIONS = INTEGRATIONS;
  window.buildSettings = buildSettings;
  window.checkAPIHealth = checkAPIHealth;
  window.buildIntegCard = buildIntegCard;
  window.showIntegrationDoc = showIntegrationDoc;
  window.showDocsModal = showDocsModal;
  window.closeDocsModal = closeDocsModal;
})();
