"use client";

// view id -> React component map for migrated dashboard panels.
//
// Keep this in lockstep with `lib/migratedViews.ts` (the MIGRATED_VIEWS list):
// every entry there should have a component here, and vice-versa. <MigratedPanel/>
// looks the active view up in this map to decide whether to render React or fall
// through to the replayed legacy panel.

import type { ComponentType } from "react";
import SeoRoadmap from "@/components/features/reach/SeoRoadmap";
import Deliverability from "@/components/features/reach/Deliverability";
import WebVitals from "@/components/features/reach/WebVitals";
import TechStack from "@/components/features/analyse/TechStack";
import GrowthMethodology from "@/components/features/manage/GrowthMethodology";
import WhiteLabel from "@/components/features/manage/WhiteLabel";
import BulkReports from "@/components/features/manage/BulkReports";
import ModelCompare from "@/components/features/manage/ModelCompare";
import CampaignComposer from "@/components/features/reach/CampaignComposer";
import Geofencing from "@/components/features/reach/Geofencing";
import LocalListings from "@/components/features/seo/LocalListings";
import ReviewAutomation from "@/components/features/compete/ReviewAutomation";
import MarketingBrief from "@/components/features/manage/MarketingBrief";
import WebAnalytics from "@/components/features/manage/WebAnalytics";
import VerticalPlaybooks from "@/components/features/manage/VerticalPlaybooks";
import Flywheel from "@/components/features/manage/Flywheel";
import Playbook7Day from "@/components/features/manage/Playbook7Day";
import NewProject from "@/components/features/manage/NewProject";
import MarketingOKR from "@/components/features/manage/MarketingOKR";
import MasterCalendar from "@/components/features/manage/MasterCalendar";
import BrandCalendar from "@/components/features/manage/BrandCalendar";
import Launches from "@/components/features/manage/Launches";
import AiTraffic from "@/components/features/manage/AiTraffic";
import Heatmaps from "@/components/features/manage/Heatmaps";
import BudgetBoard from "@/components/features/manage/BudgetBoard";
import Customer360 from "@/components/features/manage/Customer360";
import ActionQueue from "@/components/features/manage/ActionQueue";
import AdCommentMonitor from "@/components/features/grow/AdCommentMonitor";
import AskInfoGenie from "@/components/features/manage/AskInfoGenie";
import MarketingMemory from "@/components/features/manage/MarketingMemory";
import PredictiveIntelligence from "@/components/features/manage/PredictiveIntelligence";
import AgentGoals from "@/components/features/manage/AgentGoals";
import AiProviders from "@/components/features/manage/AiProviders";
import MeetingNotes from "@/components/features/manage/MeetingNotes";
import TeamMeetings from "@/components/features/manage/TeamMeetings";
import Infographics from "@/components/features/manage/Infographics";
import Reengage from "@/components/features/manage/Reengage";
import Automations from "@/components/features/manage/Automations";
import EmployeeAdvocacy from "@/components/features/manage/EmployeeAdvocacy";
import SignalTriggers from "@/components/features/manage/SignalTriggers";
import Stakeholders from "@/components/features/manage/Stakeholders";
import Results from "@/components/features/manage/Results";
import WeeklyReport from "@/components/features/manage/WeeklyReport";
import CrossChannel from "@/components/features/manage/CrossChannel";
import Csuite from "@/components/features/manage/Csuite";
import InvestorMode from "@/components/features/manage/InvestorMode";
import Agency from "@/components/features/manage/Agency";
import Marketplace from "@/components/features/manage/Marketplace";
import Workspaces from "@/components/features/manage/Workspaces";
import Admin from "@/components/features/manage/Admin";
import TechnicalSuite from "@/components/features/manage/TechnicalSuite";
import BrandSafety from "@/components/features/manage/BrandSafety";
import DataProvenance from "@/components/features/manage/DataProvenance";
import Settings from "@/components/features/manage/Settings";
import Dashboard from "@/components/features/analyse/Dashboard";
import Roadmap from "@/components/features/analyse/Roadmap";
import Competitors from "@/components/features/analyse/Competitors";
import BattleCards from "@/components/features/analyse/BattleCards";
import Battleplan from "@/components/features/analyse/Battleplan";
import Intelligence from "@/components/features/analyse/Intelligence";
import WarRoom from "@/components/features/analyse/WarRoom";
import BizScanner from "@/components/features/analyse/BizScanner";
import Benchmarks from "@/components/features/analyse/Benchmarks";
import AdLibrary from "@/components/features/analyse/AdLibrary";
import OrganicSocial from "@/components/features/analyse/OrganicSocial";
import LinkedinAds from "@/components/features/analyse/LinkedinAds";
import AdSwipe from "@/components/features/analyse/AdSwipe";
import PricingWatch from "@/components/features/analyse/PricingWatch";
import JobBoardSpy from "@/components/features/analyse/JobBoardSpy";
import MapsIntel from "@/components/features/analyse/MapsIntel";
import ChangeMonitor from "@/components/features/analyse/ChangeMonitor";
import WebExtractor from "@/components/features/analyse/WebExtractor";
import RecipeScraper from "@/components/features/analyse/RecipeScraper";
import DatasetMarket from "@/components/features/analyse/DatasetMarket";
import ResilientTracker from "@/components/features/analyse/ResilientTracker";
import SovTracker from "@/components/features/analyse/SovTracker";
import TrendingTopics from "@/components/features/analyse/TrendingTopics";
import CrisisRadar from "@/components/features/analyse/CrisisRadar";
import IcpStudio from "@/components/features/analyse/IcpStudio";
import Voc from "@/components/features/analyse/Voc";
import ReviewAggregator from "@/components/features/analyse/ReviewAggregator";
import Glassdoor from "@/components/features/analyse/Glassdoor";
import Mentions from "@/components/features/analyse/Mentions";
import Reddit from "@/components/features/analyse/Reddit";
import RedditPulse from "@/components/features/analyse/RedditPulse";
import TwitterPulse from "@/components/features/analyse/TwitterPulse";
import YoutubeMonitor from "@/components/features/analyse/YoutubeMonitor";
import YtCommentMiner from "@/components/features/analyse/YtCommentMiner";
import PodcastMonitor from "@/components/features/analyse/PodcastMonitor";
import QuoraMining from "@/components/features/analyse/QuoraMining";
import NewsletterTracker from "@/components/features/analyse/NewsletterTracker";
import KeywordExplorer from "@/components/features/analyse/KeywordExplorer";
import QuestionMiner from "@/components/features/analyse/QuestionMiner";
import SocialListening from "@/components/features/analyse/SocialListening";
import MediaIntel from "@/components/features/analyse/MediaIntel";
import KeywordMap from "@/components/features/analyse/KeywordMap";
import IntentMap from "@/components/features/analyse/IntentMap";
import ContentGaps from "@/components/features/analyse/ContentGaps";
import Serp from "@/components/features/analyse/Serp";
import SerpTracker from "@/components/features/analyse/SerpTracker";
import BingWebmaster from "@/components/features/analyse/BingWebmaster";
import GoogleTrends from "@/components/features/analyse/GoogleTrends";
import SpyFu from "@/components/features/analyse/SpyFu";
import MajesticSEO from "@/components/features/analyse/MajesticSEO";
import SemrushIntel from "@/components/features/analyse/SemrushIntel";
import AhrefsIntel from "@/components/features/analyse/AhrefsIntel";
import SerpstatIntel from "@/components/features/analyse/SerpstatIntel";
import ContentKingMonitor from "@/components/features/analyse/ContentKingMonitor";
import RealtimeNews from "@/components/features/monitor/RealtimeNews";
import AttributionDashboard from "@/components/features/analyse/AttributionDashboard";
import ProductLibrary from "@/components/features/manage/ProductLibrary";
import EmailCampaignAnalytics from "@/components/features/reach/EmailCampaignAnalytics";
import Backlinks from "@/components/features/analyse/Backlinks";
import BacklinkMonitor from "@/components/features/analyse/BacklinkMonitor";
import LinkProspector from "@/components/features/analyse/LinkProspector";
import BrandAssets from "@/components/features/create/BrandAssets";
import Templates from "@/components/features/create/Templates";
import Studio from "@/components/features/create/Studio";
import Content from "@/components/features/create/Content";
import HeadlineTester from "@/components/features/create/HeadlineTester";
import PressRelease from "@/components/features/create/PressRelease";
import ColdEmail from "@/components/features/create/ColdEmail";
import EmailPersonalizer from "@/components/features/create/EmailPersonalizer";
import EmailBroadcast from "@/components/features/create/EmailBroadcast";
import Whatsapp from "@/components/features/create/Whatsapp";
import VoiceCaller from "@/components/features/create/VoiceCaller";
import ReplyAssistant from "@/components/features/create/ReplyAssistant";
import Localization from "@/components/features/create/Localization";
import Creative from "@/components/features/create/Creative";
import SmartCreative from "@/components/features/create/SmartCreative";
import Carousel from "@/components/features/create/Carousel";
import Canva from "@/components/features/create/Canva";
import UgcAvatars from "@/components/features/create/UgcAvatars";
import VideoScript from "@/components/features/create/VideoScript";
import Voiceover from "@/components/features/create/Voiceover";
import CreativeIntel from "@/components/features/create/CreativeIntel";
import LandingBuilder from "@/components/features/create/LandingBuilder";
import SiteBuilder from "@/components/features/create/SiteBuilder";
import Linksell from "@/components/features/create/Linksell";
import SchemaGenerator from "@/components/features/create/SchemaGenerator";
import ChatbotBuilder from "@/components/features/create/ChatbotBuilder";
import Campaigns from "@/components/features/create/Campaigns";
import ContentCalendar from "@/components/features/create/ContentCalendar";
import ContentModes from "@/components/features/create/ContentModes";
import ContentAutopilot from "@/components/features/create/ContentAutopilot";
import AdCreative from "@/components/features/create/AdCreative";
import IdeaFeed from "@/components/features/create/IdeaFeed";
import PitchDeck from "@/components/features/create/PitchDeck";
import Wireframe from "@/components/features/create/Wireframe";
import Accessibility from "@/components/features/create/Accessibility";
import PersonaStudio from "@/components/features/create/PersonaStudio";
import EcomVideo from "@/components/features/create/EcomVideo";
import BrandDeals from "@/components/features/create/BrandDeals";
import Social from "@/components/features/create/Social";
import Audience from "@/components/features/reach/Audience";
import Lookalike from "@/components/features/reach/Lookalike";
import AudiencesDynamic from "@/components/features/reach/AudiencesDynamic";
import JourneyBuilder from "@/components/features/reach/JourneyBuilder";
import Omnichannel from "@/components/features/reach/Omnichannel";
import LeadGenHub from "@/components/features/reach/LeadGenHub";
import Bookings from "@/components/features/reach/Bookings";
import LeadQualifier from "@/components/features/reach/LeadQualifier";
import HubspotSync from "@/components/features/reach/HubspotSync";
import CrmSync from "@/components/features/reach/CrmSync";
import Hunter from "@/components/features/reach/Hunter";
import Advertise from "@/components/features/reach/Advertise";
import ImportCampaigns from "@/components/features/reach/ImportCampaigns";
import OptFolders from "@/components/features/reach/OptFolders";
import AbDesigner from "@/components/features/reach/AbDesigner";
import ConversionBoosters from "@/components/features/reach/ConversionBoosters";
import SocialPublisher from "@/components/features/reach/SocialPublisher";
import Discovery from "@/components/features/reach/Discovery";
import Influencers from "@/components/features/reach/Influencers";
import TiktokDownloader from "@/components/features/reach/TiktokDownloader";
import HashtagIntel from "@/components/features/reach/HashtagIntel";
import SearchIntel from "@/components/features/reach/SearchIntel";
import GeoAudit from "@/components/features/reach/GeoAudit";
import LocalSeo from "@/components/features/reach/LocalSeo";
import SeoAuditor from "@/components/features/reach/SeoAuditor";
import ContentScore from "@/components/features/reach/ContentScore";
import SeoCrawler from "@/components/features/reach/SeoCrawler";
import SocialTags from "@/components/features/reach/SocialTags";
import SeoTasks from "@/components/features/reach/SeoTasks";
import SeoWidget from "@/components/features/reach/SeoWidget";
import UnifiedInbox from "@/components/features/reach/UnifiedInbox";
import AlertRouting from "@/components/features/reach/AlertRouting";
import Digest from "@/components/features/reach/Digest";
import Goals from "@/components/features/grow/Goals";
import KpiTracker from "@/components/features/grow/KpiTracker";
import ActionCenter from "@/components/features/grow/ActionCenter";
import MetaInsights from "@/components/features/grow/MetaInsights";
import GoogleAdsInsights from "@/components/features/grow/GoogleAdsInsights";
import TiktokAdsInsights from "@/components/features/grow/TiktokAdsInsights";
import SocialAnalytics from "@/components/features/grow/SocialAnalytics";
import PostPerformance from "@/components/features/grow/PostPerformance";
import Optimizer from "@/components/features/grow/Optimizer";
import AutoOperator from "@/components/features/grow/AutoOperator";
import SafeAgent from "@/components/features/grow/SafeAgent";
import AnalyticsHub from "@/components/features/grow/AnalyticsHub";
import AmplitudeAgents from "@/components/features/grow/AmplitudeAgents";
import BlendedPerf from "@/components/features/grow/BlendedPerf";
import Attribution from "@/components/features/grow/Attribution";
import TrueRoas from "@/components/features/grow/TrueRoas";
import Iroas from "@/components/features/grow/Iroas";
import ConversionRecovery from "@/components/features/grow/ConversionRecovery";
import ChurnScorer from "@/components/features/grow/ChurnScorer";
import RevenueForecast from "@/components/features/grow/RevenueForecast";
import DigitalTwin from "@/components/features/grow/DigitalTwin";
import Mmm from "@/components/features/grow/Mmm";
import Autoseo from "@/components/features/grow/Autoseo";
import Contentscorer from "@/components/features/grow/Contentscorer";
import LinkSuggester from "@/components/features/grow/LinkSuggester";
import CroLab from "@/components/features/grow/CroLab";
import AiAuditSuite from "@/components/features/grow/AiAuditSuite";
import VisLeaderboard from "@/components/features/grow/VisLeaderboard";
import LandingPages from "@/components/features/grow/LandingPages";
import AiTeam from "@/components/features/aiteam/AiTeam";
import FinanceOfficer from "@/components/features/aiteam/FinanceOfficer";
import OpsOfficer from "@/components/features/aiteam/OpsOfficer";
import UtmBuilder from "@/components/features/manage/UtmBuilder";
import BudgetCaps from "@/components/features/manage/BudgetCaps";
import PixelManager from "@/components/features/manage/PixelManager";
import LaunchCompliance from "@/components/features/grow/LaunchCompliance";
import PostLaunchAudit from "@/components/features/grow/PostLaunchAudit";
import AudioSummary from "@/components/features/creator/AudioSummary";
import SelfHealing from "@/components/features/grow/SelfHealing";
import CtvStreaming from "@/components/features/grow/CtvStreaming";
import RcsCampaigns from "@/components/features/reach/RcsCampaigns";

export const MIGRATED_COMPONENTS: Record<string, ComponentType> = {
  "seo-roadmap": SeoRoadmap,
  deliverability: Deliverability,
  "web-vitals": WebVitals,
  "tech-stack": TechStack,
  "growth-methodology": GrowthMethodology,
  "white-label": WhiteLabel,
  "bulk-reports": BulkReports,
  "model-compare": ModelCompare,
  "web-analytics": WebAnalytics,
  "vertical-playbooks": VerticalPlaybooks,
  flywheel: Flywheel,
  "playbook-7day": Playbook7Day,
  // ── Remainder of the Manage group (Phase 3 batch 2) ──────────────────────
  "new-project": NewProject,
  "marketing-okr": MarketingOKR,
  "master-calendar": MasterCalendar,
  "brand-calendar": BrandCalendar,
  launches: Launches,
  "ai-traffic": AiTraffic,
  heatmaps: Heatmaps,
  "budget-board": BudgetBoard,
  "customer-360": Customer360,
  "utm-builder":   UtmBuilder,
  "budget-caps":   BudgetCaps,
  "pixel-manager":      PixelManager,
  "launch-compliance":  LaunchCompliance,
  "post-launch-audit":  PostLaunchAudit,
  "audio-summary":      AudioSummary,
  "self-healing":       SelfHealing,
  "ctv-streaming":      CtvStreaming,
  "rcs-campaigns":      RcsCampaigns,
  "action-queue": ActionQueue,
  "ad-comment-monitor": AdCommentMonitor,
  "ask-infogenie": AskInfoGenie,
  "marketing-memory": MarketingMemory,
  "predictive-intelligence": PredictiveIntelligence,
  "agent-goals": AgentGoals,
  "ai-providers": AiProviders,
  "meeting-notes": MeetingNotes,
  "team-meetings": TeamMeetings,
  infographics: Infographics,
  reengage: Reengage,
  automations: Automations,
  "employee-advocacy": EmployeeAdvocacy,
  "signal-triggers": SignalTriggers,
  stakeholders: Stakeholders,
  results: Results,
  "weekly-report": WeeklyReport,
  "cross-channel": CrossChannel,
  csuite: Csuite,
  "investor-mode": InvestorMode,
  agency: Agency,
  marketplace: Marketplace,
  workspaces: Workspaces,
  admin: Admin,
  "technical-suite": TechnicalSuite,
  "brand-safety": BrandSafety,
  "data-provenance": DataProvenance,
  settings: Settings,
  // ── Phase 3 batch 3: Analyse / Create / Reach / Grow / AI Team groups ──
  "dashboard": Dashboard,
  "roadmap": Roadmap,
  "competitors": Competitors,
  "battle-cards": BattleCards,
  "battleplan": Battleplan,
  "intelligence": Intelligence,
  "war-room": WarRoom,
  "biz-scanner": BizScanner,
  "benchmarks": Benchmarks,
  "ad-library": AdLibrary,
  "organic-social": OrganicSocial,
  "linkedin-ads": LinkedinAds,
  "ad-swipe": AdSwipe,
  "pricing-watch": PricingWatch,
  "job-board-spy": JobBoardSpy,
  "maps-intel": MapsIntel,
  "change-monitor": ChangeMonitor,
  "web-extractor": WebExtractor,
  "recipe-scraper": RecipeScraper,
  "dataset-market": DatasetMarket,
  "resilient-tracker": ResilientTracker,
  "sov-tracker": SovTracker,
  "trending-topics": TrendingTopics,
  "crisis-radar": CrisisRadar,
  "icp-studio": IcpStudio,
  "voc": Voc,
  "review-aggregator": ReviewAggregator,
  "glassdoor": Glassdoor,
  "mentions": Mentions,
  "reddit": Reddit,
  "reddit-pulse": RedditPulse,
  "twitter-pulse": TwitterPulse,
  "youtube-monitor": YoutubeMonitor,
  "yt-comment-miner": YtCommentMiner,
  "podcast-monitor": PodcastMonitor,
  "quora-mining": QuoraMining,
  "newsletter-tracker": NewsletterTracker,
  "keyword-explorer": KeywordExplorer,
  "question-miner": QuestionMiner,
  "social-listening": SocialListening,
  "media-intel": MediaIntel,
  "keyword-map": KeywordMap,
  "intent-map": IntentMap,
  "content-gaps": ContentGaps,
  "serp": Serp,
  "serp-tracker": SerpTracker,
  "bing-webmaster": BingWebmaster,
  "google-trends": GoogleTrends,
  "spyfu": SpyFu,
  "majestic": MajesticSEO,
  "semrush": SemrushIntel,
  "ahrefs": AhrefsIntel,
  "serpstat": SerpstatIntel,
  "contentking": ContentKingMonitor,
  "realtime-news": RealtimeNews,
  "attribution": AttributionDashboard,
  "product-library": ProductLibrary,
  "email-analytics": EmailCampaignAnalytics,
  "backlinks": Backlinks,
  "backlink-monitor": BacklinkMonitor,
  "link-prospector": LinkProspector,
  "brand-assets": BrandAssets,
  "templates": Templates,
  "studio": Studio,
  "content": Content,
  "headline-tester": HeadlineTester,
  "press-release": PressRelease,
  "cold-email": ColdEmail,
  "email-personalizer": EmailPersonalizer,
  "email-broadcast": EmailBroadcast,
  "whatsapp": Whatsapp,
  "voice-caller": VoiceCaller,
  "reply-assistant": ReplyAssistant,
  "localization": Localization,
  "creative": Creative,
  "smart-creative": SmartCreative,
  "carousel": Carousel,
  "canva": Canva,
  "ugc-avatars": UgcAvatars,
  "video-script": VideoScript,
  "voiceover": Voiceover,
  "creative-intel": CreativeIntel,
  "landing-builder": LandingBuilder,
  "site-builder": SiteBuilder,
  "linksell": Linksell,
  "schema-generator": SchemaGenerator,
  "chatbot-builder": ChatbotBuilder,
  "campaigns": Campaigns,
  "content-calendar": ContentCalendar,
  "content-modes": ContentModes,
  "content-autopilot": ContentAutopilot,
  "ad-creative": AdCreative,
  "idea-feed": IdeaFeed,
  "pitch-deck": PitchDeck,
  "wireframe": Wireframe,
  "accessibility": Accessibility,
  "persona-studio": PersonaStudio,
  "ecom-video": EcomVideo,
  "brand-deals": BrandDeals,
  "social": Social,
  "audience": Audience,
  "lookalike": Lookalike,
  "audiences-dynamic": AudiencesDynamic,
  "journey-builder": JourneyBuilder,
  "omnichannel": Omnichannel,
  "lead-gen": LeadGenHub,
  // Retired individual views — redirect to the Lead Generation hub
  "lead-finder": LeadGenHub,
  "local-leads": LeadGenHub,
  "lead-aggregator": LeadGenHub,
  "acquisition-engine": LeadGenHub,
  "bookings": Bookings,
  "lead-qualifier": LeadQualifier,
  "hubspot-sync": HubspotSync,
  "crm-sync": CrmSync,
  "hunter": Hunter,
  "advertise": Advertise,
  "import-campaigns": ImportCampaigns,
  "opt-folders": OptFolders,
  "ab-designer": AbDesigner,
  "conversion-boosters": ConversionBoosters,
  "social-publisher": SocialPublisher,
  "discovery": Discovery,
  "influencers": Influencers,
  "tiktok-downloader": TiktokDownloader,
  "hashtag-intel": HashtagIntel,
  "search-intel": SearchIntel,
  "geo-audit": GeoAudit,
  "local-seo": LocalSeo,
  "seo-auditor": SeoAuditor,
  "content-score": ContentScore,
  "seo-crawler": SeoCrawler,
  "social-tags": SocialTags,
  "seo-tasks": SeoTasks,
  "seo-widget": SeoWidget,
  "unified-inbox": UnifiedInbox,
  "alert-routing": AlertRouting,
  "digest": Digest,
  "goals": Goals,
  "kpi-tracker": KpiTracker,
  "action-center": ActionCenter,
  "meta-insights": MetaInsights,
  "google-ads-insights": GoogleAdsInsights,
  "tiktok-ads-insights": TiktokAdsInsights,
  "social-analytics": SocialAnalytics,
  "post-performance": PostPerformance,
  "optimizer": Optimizer,
  "auto-operator": AutoOperator,
  "safe-agent": SafeAgent,
  "analytics-hub": AnalyticsHub,
  "amplitude-agents": AmplitudeAgents,
  "blended-perf": BlendedPerf,
  "true-roas": TrueRoas,
  "iroas": Iroas,
  "conversion-recovery": ConversionRecovery,
  "churn-scorer": ChurnScorer,
  "revenue-forecast": RevenueForecast,
  "digital-twin": DigitalTwin,
  "campaign-composer": CampaignComposer,
  "geofencing": Geofencing,
  "local-listings": LocalListings,
  "review-automation": ReviewAutomation,
  "marketing-brief": MarketingBrief,
  "mmm": Mmm,
  "autoseo": Autoseo,
  "contentscorer": Contentscorer,
  "link-suggester": LinkSuggester,
  "cro-lab": CroLab,
  "ai-audit-suite": AiAuditSuite,
  "vis-leaderboard": VisLeaderboard,
  "landing-pages": LandingPages,
  "ai-team": AiTeam,
  "finance-officer": FinanceOfficer,
  "ops-officer": OpsOfficer,
};
