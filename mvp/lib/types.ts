export type Competitor = {
  name: string;
  domain: string;
  positioning: string;
  strength: string;
  weakness: string;
  estimatedTraffic: string;
  adPresence: "High" | "Medium" | "Low";
};

export type AdSpyItem = {
  platform: "Meta" | "Google" | "TikTok";
  advertiser: string;
  headline: string;
  body: string;
  cta: string;
  angle: string;
};

export type KeywordRow = {
  keyword: string;
  volume: string;
  difficulty: string;
  intent: "Informational" | "Commercial" | "Transactional";
  opportunity: string;
};

export type Swot = {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
};

export type PriorityAction = {
  title: string;
  why: string;
  channel: string;
  effort: "S" | "M" | "L";
};

export type BrandFoundation = {
  voice: string;
  tone: string[];
  colors: { primary: string; accent: string; ink: string };
  doSay: string[];
  dontSay: string[];
};

export type ContentDraft = {
  id: string;
  kind: "blog" | "cold-email" | "ad" | "landing";
  title: string;
  body: string;
  createdAt: string;
};

export type CampaignDraft = {
  id: string;
  name: string;
  objective: string;
  channels: string[];
  budgetMonthly: number;
  landingHeadline: string;
  landingBody: string;
  status: "draft" | "ready";
  createdAt: string;
};

export type ReachSequence = {
  id: string;
  name: string;
  steps: { day: number; channel: string; action: string }[];
  createdAt: string;
};

export type ResultsSnapshot = {
  roas: number;
  cac: number;
  ctr: number;
  conversions: number;
  spend: number;
  note: string;
  generatedAt: string;
};

export type Analysis = {
  domain: string;
  brandName: string;
  industry: string;
  summary: string;
  analysedAt: string;
  source: "ai" | "scaffold";
  competitors: Competitor[];
  ads: AdSpyItem[];
  keywords: KeywordRow[];
  techSignals: string[];
  pricingSignals: string[];
  swot: Swot;
  actions: PriorityAction[];
  brand: BrandFoundation;
};

export type Workspace = {
  id: string;
  email: string;
  createdAt: string;
  analysis: Analysis | null;
  drafts: ContentDraft[];
  campaigns: CampaignDraft[];
  sequences: ReachSequence[];
  results: ResultsSnapshot | null;
};
