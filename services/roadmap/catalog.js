// T37 — Get-Started Roadmap catalog
//
// 90-day plan inspired by the popular "Digital Marketing 90-Day Action Plan"
// social-media lead magnet. Every row maps a beginner task to the InfoGenie
// view that AUTOMATES it, so the user can stop reading SEO articles and
// just click into the tool.
//
// Stable `id` per row so progress tracking survives reorders.
// `view` is the SPA view-id (used by navigateTo) — null when the task is
// reading/setup/no-tool.

const PLAN = [
  // ── Days 1-30 · SEO ───────────────────────────────────────────────────────
  { id:'d1',  day:1,  focus:'SEO', learn:'What is SEO?',                   action:'Run a free audit on your homepage to see what SEO actually measures.', view:'seo-auditor',     viewLabel:'Open SEO Auditor' },
  { id:'d2',  day:2,  focus:'SEO', learn:'How search engines work',         action:'Crawl your full site to see what Google sees.',                       view:'seo-crawler',     viewLabel:'Open Site Crawler' },
  { id:'d3',  day:3,  focus:'SEO', learn:'Types of SEO (on/off/technical)',action:'Read your audit report — every check is tagged on-page or technical.',view:'seo-auditor',     viewLabel:'Open SEO Auditor' },
  { id:'d4',  day:4,  focus:'SEO', learn:'Examples of SEO done right',     action:'Pull battle cards on your top 3 competitors.',                        view:'battle-cards',    viewLabel:'Open Battle Cards' },
  { id:'d5',  day:5,  focus:'SEO', learn:'Keyword research basics',         action:'Find keywords your competitors rank for that you don\'t.',            view:'keyword-explorer',viewLabel:'Open Keyword Explorer' },
  { id:'d6',  day:6,  focus:'SEO', learn:'Tools for keywords',              action:'Map every keyword to a target page.',                                 view:'keyword-map',     viewLabel:'Open Keyword Map' },
  { id:'d7',  day:7,  focus:'SEO', learn:'On-page SEO overview',           action:'Re-run the auditor with the "Render with real browser" toggle on.',   view:'seo-auditor',     viewLabel:'Open SEO Auditor' },
  { id:'d8',  day:8,  focus:'SEO', learn:'Optimise meta tags',              action:'The auditor flags every page with bad title/description length.',     view:'seo-auditor',     viewLabel:'Open SEO Auditor' },
  { id:'d9',  day:9,  focus:'SEO', learn:'Technical SEO basics',            action:'Crawl up to 100 pages and review the worst-offender list.',           view:'seo-crawler',     viewLabel:'Open Site Crawler' },
  { id:'d10', day:10, focus:'SEO', learn:'Mobile & speed testing',          action:'Run Web Vitals (Google PageSpeed) on your homepage.',                 view:'web-vitals',      viewLabel:'Open Web Vitals' },
  { id:'d11', day:11, focus:'SEO', learn:'Google Search Console basics',    action:'Connect GSC in the Analytics Hub.',                                   view:'analytics-hub',   viewLabel:'Open GSC / GA4 Hub' },
  { id:'d12', day:12, focus:'SEO', learn:'Analyse GSC reports',             action:'Find pages with high impressions but low CTR — easy wins.',           view:'analytics-hub',   viewLabel:'Open GSC / GA4 Hub' },
  { id:'d13', day:13, focus:'SEO', learn:'GA4 setup',                       action:'Connect GA4 in the Analytics Hub.',                                   view:'analytics-hub',   viewLabel:'Open GSC / GA4 Hub' },
  { id:'d14', day:14, focus:'SEO', learn:'Understand GA4 reports',          action:'Open the funnel-health view to see where users drop off.',            view:'analytics-hub',   viewLabel:'Open GSC / GA4 Hub' },
  { id:'d15', day:15, focus:'SEO', learn:'SEO content writing',             action:'Score one of your existing blog posts for SEO + readability.',        view:'contentscorer',   viewLabel:'Open Content Scorer' },
  { id:'d16', day:16, focus:'SEO', learn:'Content structure',               action:'Audit a single page — headings (H1→H6) hierarchy is one of 32 checks.',view:'seo-auditor',    viewLabel:'Open SEO Auditor' },
  { id:'d17', day:17, focus:'SEO', learn:'Internal linking',                action:'Run the internal link suggester on a target page.',                   view:'link-suggester',  viewLabel:'Open Link Suggester' },
  { id:'d18', day:18, focus:'SEO', learn:'Build a link structure',          action:'Use Content Gaps to find sibling topics worth linking together.',     view:'content-gaps',    viewLabel:'Open Content Gaps' },
  { id:'d19', day:19, focus:'SEO', learn:'Backlink basics',                 action:'See your current backlinks via DataForSEO.',                          view:'backlinks',       viewLabel:'Open Backlink Intel' },
  { id:'d20', day:20, focus:'SEO', learn:'Earn free backlinks',             action:'Find broken links on competitor sites you could replace.',            view:'backlinks',       viewLabel:'Open Backlink Intel' },
  { id:'d21', day:21, focus:'SEO', learn:'SEO tools overview',              action:'Set up the Backlink Monitor so you\'re alerted on new/lost links.',   view:'backlink-monitor',viewLabel:'Open Backlink Monitor' },
  { id:'d22', day:22, focus:'SEO', learn:'Google Trends',                   action:'Open Trending Topics to see what\'s rising in your niche.',           view:'trending-topics', viewLabel:'Open Trending Topics' },
  { id:'d23', day:23, focus:'SEO', learn:'Competitor analysis',             action:'Pull a full attack plan vs your top competitor.',                     view:'battleplan',      viewLabel:'Open Attack Plan' },
  { id:'d24', day:24, focus:'SEO', learn:'Schema markup / JSON-LD',         action:'Generate Organization + LocalBusiness schema for your site.',         view:'schema-generator',viewLabel:'Open Schema Generator' },
  { id:'d25', day:25, focus:'SEO', learn:'Local SEO essentials',            action:'Run the Local SEO basics audit on your homepage.',                    view:'local-seo',       viewLabel:'Open Local SEO' },
  { id:'d26', day:26, focus:'SEO', learn:'AI / generative engine SEO',      action:'Run the GEO audit to see how ChatGPT/Perplexity see your pages.',     view:'geo-audit',       viewLabel:'Open GEO Audit' },
  { id:'d27', day:27, focus:'SEO', learn:'Social tags / OpenGraph',         action:'Audit social tags so your links look good in shares.',                view:'social-tags',     viewLabel:'Open Social Tags Audit' },
  { id:'d28', day:28, focus:'SEO', learn:'Track your rankings',             action:'Add 5-10 target keywords to the SERP Tracker.',                       view:'serp-tracker',    viewLabel:'Open SERP Tracker' },
  { id:'d29', day:29, focus:'SEO', learn:'Fix what\'s broken',              action:'Open the SEO Task Manager — every audit warning is a task you can assign.', view:'seo-tasks',  viewLabel:'Open SEO Task Manager' },
  { id:'d30', day:30, focus:'SEO', learn:'Build a content calendar',        action:'Plan the next 30 days of posts in the Content Calendar.',             view:'content-calendar',viewLabel:'Open Content Calendar' },

  // ── Days 31-60 · SMM (Social Media Marketing) ─────────────────────────────
  { id:'d31', day:31, focus:'SMM', learn:'Pick your social platforms',      action:'Open Social Publisher to see all 15 platforms you can post to.',      view:'social-publisher',viewLabel:'Open Social Publisher' },
  { id:'d32', day:32, focus:'SMM', learn:'Profile optimisation',            action:'Audit your social tags + favicons so profiles render correctly.',     view:'social-tags',     viewLabel:'Open Social Tags Audit' },
  { id:'d33', day:33, focus:'SMM', learn:'Plan a weekly cadence',           action:'See the recommended Instagram/Facebook/LinkedIn schedule.',           view:'roadmap',         viewLabel:'See Weekly Cadence' },
  { id:'d34', day:34, focus:'SMM', learn:'Write your first post',           action:'Test 10 headline variants for the post you\'re about to publish.',    view:'headline-tester', viewLabel:'Open Headline Tester' },
  { id:'d35', day:35, focus:'SMM', learn:'Schedule your week',              action:'Bulk-schedule a week of content via Social Publisher.',               view:'social-publisher',viewLabel:'Open Social Publisher' },
  { id:'d36', day:36, focus:'SMM', learn:'Reels & short-form video',        action:'Generate a 30-second TikTok/Reels script.',                           view:'video-script',    viewLabel:'Open Video Script Generator' },
  { id:'d37', day:37, focus:'SMM', learn:'Add voiceover to videos',         action:'Convert your script to a voiceover MP3 (6 voices, 2 quality tiers).', view:'voiceover',       viewLabel:'Open Voiceover' },
  { id:'d38', day:38, focus:'SMM', learn:'Carousel posts',                  action:'Plan a carousel topic from your Content Calendar.',                   view:'content-calendar',viewLabel:'Open Content Calendar' },
  { id:'d39', day:39, focus:'SMM', learn:'Spy on competitors\' ads',        action:'Open Ad Library Spy — see live Meta + TikTok ads competitors run.',   view:'ad-library',      viewLabel:'Open Ad Library Spy' },
  { id:'d40', day:40, focus:'SMM', learn:'Download competitor TikToks',     action:'Bulk-download no-watermark MP4s from TikTok URLs.',                   view:'tiktok-downloader',viewLabel:'Open TikTok Downloader' },
  { id:'d41', day:41, focus:'SMM', learn:'Reddit listening',                action:'Search Reddit Pulse for mentions of your brand or category.',         view:'reddit-pulse',    viewLabel:'Open Reddit Pulse' },
  { id:'d42', day:42, focus:'SMM', learn:'Twitter/X listening',             action:'Set up a Twitter/X Pulse query for your brand name.',                 view:'twitter-pulse',   viewLabel:'Open Twitter/X Pulse' },
  { id:'d43', day:43, focus:'SMM', learn:'Quora intent mining',             action:'Find buyer-intent questions on Quora.',                               view:'quora-mining',    viewLabel:'Open Quora Mining' },
  { id:'d44', day:44, focus:'SMM', learn:'Glassdoor sentiment',             action:'Check what employees say about competitors (and you).',               view:'glassdoor',       viewLabel:'Open Glassdoor Sentiment' },
  { id:'d45', day:45, focus:'SMM', learn:'Review aggregation',              action:'Pull reviews from 5 sites into one feed.',                            view:'review-aggregator',viewLabel:'Open Review Aggregator' },
  { id:'d46', day:46, focus:'SMM', learn:'Voice of Customer',               action:'Run a VoC analysis on your reviews to find the top complaints.',      view:'voc',             viewLabel:'Open Voice of Customer' },
  { id:'d47', day:47, focus:'SMM', learn:'Reply to comments fast',          action:'Use the AI Reply Assistant to draft on-brand responses.',             view:'reply-assistant', viewLabel:'Open Reply Assistant' },
  { id:'d48', day:48, focus:'SMM', learn:'One inbox for everything',        action:'Open the Unified Inbox — Reddit, X, reviews, Quora, all in one feed.',view:'unified-inbox',   viewLabel:'Open Unified Inbox' },
  { id:'d49', day:49, focus:'SMM', learn:'Newsletter tracking',             action:'Track competitor newsletters so you don\'t miss what they ship.',     view:'newsletter-tracker',viewLabel:'Open Newsletter Tracker' },
  { id:'d50', day:50, focus:'SMM', learn:'Podcast monitoring',              action:'Search podcast mentions of your brand.',                              view:'podcast-monitor', viewLabel:'Open Podcast Monitor' },
  { id:'d51', day:51, focus:'SMM', learn:'YouTube monitoring',              action:'Set up YouTube monitoring for your category.',                        view:'youtube-monitor', viewLabel:'Open YouTube Monitor' },
  { id:'d52', day:52, focus:'SMM', learn:'Influencer discovery',            action:'Find creators in your niche.',                                        view:'discovery',       viewLabel:'Open Influencer Discovery' },
  { id:'d53', day:53, focus:'SMM', learn:'Manage your influencer list',     action:'Save shortlisted creators in the Influencer CRM.',                    view:'influencers',     viewLabel:'Open Influencer CRM' },
  { id:'d54', day:54, focus:'SMM', learn:'Crisis radar',                    action:'Set up a 6-hour crisis-monitoring sweep with Slack alerts.',          view:'crisis-radar',    viewLabel:'Open Crisis Radar' },
  { id:'d55', day:55, focus:'SMM', learn:'Press release',                   action:'Generate a press release for your next launch.',                      view:'press-release',   viewLabel:'Open Press Release Generator' },
  { id:'d56', day:56, focus:'SMM', learn:'Share-of-voice tracking',         action:'See your share-of-voice vs competitors.',                             view:'sov-tracker',     viewLabel:'Open SoV Tracker' },
  { id:'d57', day:57, focus:'SMM', learn:'Daily AI digest',                 action:'Turn on the 24h AI Daily Digest.',                                    view:'digest',          viewLabel:'Open AI Daily Digest' },
  { id:'d58', day:58, focus:'SMM', learn:'Smart alert routing',             action:'Wire mentions into Slack + email by topic.',                          view:'alert-routing',   viewLabel:'Open Alert Routing' },
  { id:'d59', day:59, focus:'SMM', learn:'Add a chatbot',                   action:'Build a FAQ chatbot from your site\'s content.',                      view:'chatbot-builder', viewLabel:'Open Chatbot Builder' },
  { id:'d60', day:60, focus:'SMM', learn:'Add conversion popups',           action:'Embed Social Proof + Exit Intent popups on your site.',               view:'conversion-boosters',viewLabel:'Open Conversion Boosters' },

  // ── Days 61-90 · PPC (Paid Advertising) ───────────────────────────────────
  { id:'d61', day:61, focus:'PPC', learn:'Define your ICP',                 action:'Build your Ideal Customer Profile in ICP Studio.',                    view:'icp-studio',      viewLabel:'Open ICP Studio' },
  { id:'d62', day:62, focus:'PPC', learn:'Generate audiences',              action:'Build a lookalike audience from your best customers.',                view:'lookalike',       viewLabel:'Open Lookalike Builder' },
  { id:'d63', day:63, focus:'PPC', learn:'Dynamic audiences',               action:'Create a real-time dynamic audience that updates every 15 minutes.',  view:'audiences-dynamic',viewLabel:'Open Dynamic Audiences' },
  { id:'d64', day:64, focus:'PPC', learn:'Find B2B leads',                  action:'Use the B2B Lead Finder to build a prospect list.',                   view:'lead-finder',     viewLabel:'Open Lead Finder' },
  { id:'d65', day:65, focus:'PPC', learn:'Qualify your leads',              action:'Run leads through the Lead Qualifier Agent.',                         view:'lead-qualifier',  viewLabel:'Open Lead Qualifier' },
  { id:'d66', day:66, focus:'PPC', learn:'Cold email sequences',            action:'Generate a 5-step cold email sequence.',                              view:'cold-email',      viewLabel:'Open Cold Email Writer' },
  { id:'d67', day:67, focus:'PPC', learn:'Email deliverability',            action:'Audit your domain DNS (SPF/DKIM/DMARC) for inbox placement.',         view:'deliverability',  viewLabel:'Open Deliverability Auditor' },
  { id:'d68', day:68, focus:'PPC', learn:'Personalise emails at scale',     action:'Use the Email Personalizer for 1:1 prospect emails.',                 view:'email-personalizer',viewLabel:'Open Email Personalizer' },
  { id:'d69', day:69, focus:'PPC', learn:'Sync to your CRM',                action:'Batch-upsert prospects into HubSpot.',                                view:'hubspot-sync',    viewLabel:'Open HubSpot Sync' },
  { id:'d70', day:70, focus:'PPC', learn:'Build a landing page',            action:'Use the server-rendered Landing Page builder for your campaign.',     view:'landing-pages',   viewLabel:'Open Landing Pages' },
  { id:'d71', day:71, focus:'PPC', learn:'A/B test ideas',                  action:'Design an A/B test (variants + sample size).',                        view:'ab-designer',     viewLabel:'Open A/B Test Designer' },
  { id:'d72', day:72, focus:'PPC', learn:'Generate ad creative',            action:'Open the Creative Studio to generate ad copy + visuals.',             view:'creative',        viewLabel:'Open Creative Studio' },
  { id:'d73', day:73, focus:'PPC', learn:'Launch your first campaign',      action:'Launch a campaign — it auto-registers in the Optimizer.',             view:'campaigns',       viewLabel:'Open Campaigns' },
  { id:'d74', day:74, focus:'PPC', learn:'Connect Meta Ads',                action:'Pull Meta spend, impressions, conversions into the dashboard.',       view:'meta-insights',   viewLabel:'Open Meta Ads Insights' },
  { id:'d75', day:75, focus:'PPC', learn:'Connect Google Ads',              action:'Wire Google Ads via OAuth2 + GAQL.',                                  view:'google-ads-insights',viewLabel:'Open Google Ads Insights' },
  { id:'d76', day:76, focus:'PPC', learn:'Connect TikTok Ads',              action:'Wire TikTok Marketing API for spend + reach data.',                   view:'tiktok-ads-insights',viewLabel:'Open TikTok Ads Insights' },
  { id:'d77', day:77, focus:'PPC', learn:'Cross-channel reporting',         action:'See blended CFO-glance metrics across all channels.',                 view:'cross-channel',   viewLabel:'Open Cross-Channel Report' },
  { id:'d78', day:78, focus:'PPC', learn:'Blended ROAS',                    action:'View MER, LTV/CAC, Net Sales — the metrics CFOs want.',               view:'blended-perf',    viewLabel:'Open Blended Performance' },
  { id:'d79', day:79, focus:'PPC', learn:'True ROAS (offline revenue)',     action:'Sync HubSpot deals or upload a CSV — see your real ROAS.',            view:'true-roas',       viewLabel:'Open True ROAS' },
  { id:'d80', day:80, focus:'PPC', learn:'Attribution model',               action:'Open the Attribution dashboard.',                                     view:'attribution',     viewLabel:'Open Attribution' },
  { id:'d81', day:81, focus:'PPC', learn:'Let the AI optimise budgets',     action:'Open the AI Optimizer — pause/scale/hold actions, dry-run by default.',view:'optimizer',      viewLabel:'Open AI Optimizer' },
  { id:'d82', day:82, focus:'PPC', learn:'Why did the AI do that?',         action:'Read the Decision Log — every recommendation has a reason + diff.',   view:'optimizer',       viewLabel:'Open Decision Log' },
  { id:'d83', day:83, focus:'PPC', learn:'Day-part budget shifting',        action:'See which hours of the day perform best per campaign.',               view:'optimizer',       viewLabel:'Open Dayparting' },
  { id:'d84', day:84, focus:'PPC', learn:'Predict creative fatigue',        action:'See which creatives will burn out in the next 3 days.',               view:'optimizer',       viewLabel:'Open Fatigue Forecast' },
  { id:'d85', day:85, focus:'PPC', learn:'Re-engage churned users',         action:'Set up the Re-Engagement Agent.',                                     view:'reengage',        viewLabel:'Open Re-Engagement' },
  { id:'d86', day:86, focus:'PPC', learn:'Score churn risk',                action:'Run the Churn Scorer (0-100) on your customer list.',                 view:'churn-scorer',    viewLabel:'Open Churn Scorer' },
  { id:'d87', day:87, focus:'PPC', learn:'Set autonomous goals',            action:'Define metric goals — InfoGenie monitors + flags off-track ones.',    view:'goals',           viewLabel:'Open Goals' },
  { id:'d88', day:88, focus:'PPC', learn:'White-label your reports',        action:'Set your agency colours, logo, footer — every export auto-applies.',  view:'white-label',     viewLabel:'Open White-Label' },
  { id:'d89', day:89, focus:'PPC', learn:'Bulk reports',                    action:'Run a 500-URL batch SEO audit, download a zip of branded PDFs.',      view:'bulk-reports',    viewLabel:'Open Bulk Reports' },
  { id:'d90', day:90, focus:'PPC', learn:'Weekly recap email',              action:'Turn on the 7-day Weekly Report so a PDF lands in your inbox.',       view:'weekly-report',   viewLabel:'Open Weekly Report' },
];

// ── Weekly Social Cadence (from the "Social Media Marketing Schedules" lead magnet)
const SOCIAL_CADENCE = {
  instagram: {
    name: 'Instagram', icon: '📸', color: '#E1306C',
    days: [
      { day:'Mon', task:'Feed Post' },
      { day:'Tue', task:'Stories (3-5)' },
      { day:'Wed', task:'Reel' },
      { day:'Thu', task:'Stories (3-5)' },
      { day:'Fri', task:'Carousel' },
      { day:'Sat', task:'Stories (3-5)' },
      { day:'Sun', task:'Reel' },
    ],
  },
  facebook: {
    name: 'Facebook', icon: '📘', color: '#1877F2',
    days: [
      { day:'Mon', task:'Feed Post' },
      { day:'Tue', task:'Engagement (Post / Comments)' },
      { day:'Wed', task:'Video Post' },
      { day:'Thu', task:'Engagement (Post / Comments)' },
      { day:'Fri', task:'Link Post (Website / Blog)' },
      { day:'Sat', task:'Community Engagement' },
      { day:'Sun', task:'Live / Q&A' },
    ],
  },
  linkedin: {
    name: 'LinkedIn', icon: '💼', color: '#0A66C2',
    days: [
      { day:'Mon', task:'Industry Insight (Post)' },
      { day:'Tue', task:'Company Update (Post)' },
      { day:'Wed', task:'Thought Leadership (Article / Post)' },
      { day:'Thu', task:'Engagement (Comment / Share)' },
      { day:'Fri', task:'Job / Career Content' },
      { day:'Sat', task:'Educational Content' },
      { day:'Sun', task:'Weekly Recap (Post)' },
    ],
  },
};

// ── 5 social-marketing principles (from the same lead magnet)
const PRINCIPLES = [
  { icon:'🎯', label:'PLAN',    body:'Plan content weekly & align with goals.' },
  { icon:'✏️', label:'CREATE',  body:'High-quality, valuable & engaging content.' },
  { icon:'👥', label:'ENGAGE',  body:'Respond to comments, DMs & build community.' },
  { icon:'📊', label:'ANALYZE', body:'Track performance & optimise strategy.' },
  { icon:'🚀', label:'GROW',    body:'Collaborate, run ads & expand reach.' },
];

module.exports = { PLAN, SOCIAL_CADENCE, PRINCIPLES };
