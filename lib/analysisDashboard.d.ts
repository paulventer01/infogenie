export interface Competitor {
  name?: string;
  domain?: string;
  url?: string;
  traffic?: string;
  trafficMo?: number;
  ctr?: string | number;
  roas?: string | number;
  adSpend?: string;
  adSpendEst?: number;
  topChannel?: string;
  topChannels?: string[];
  threatLevel?: string;
  why?: string;
  suggestions?: string[];
}

export interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  websiteKPIs?: {
    ctr: number;
    roas: number;
    cpa: number | string;
    convRate: number | string;
    trafficMo: number;
  };
  competitors?: Competitor[];
  companyProfile?: {
    domain?: string;
    businessSummary?: string;
    subNiche?: string;
    siteTitle?: string;
    metaDesc?: string;
    analyzedAt?: string;
  };
  _yourRealData?: { organicTraffic?: number };
}

export interface SwotBlock {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface ChannelRow {
  name: string;
  share: number;
  color: string;
}

export interface PriorityAction {
  title: string;
  detail: string;
  impact: "high" | "medium" | "low";
  area: string;
  view?: string;
}

export function buildSwot(ad: AnalysisData, yourDomain: string): SwotBlock;
export function buildChannelMix(comps: Competitor[]): ChannelRow[];
export function buildPriorityActions(ad: AnalysisData): PriorityAction[];
export function formatAdSpend(c: Competitor): string;
export function blendedMarketingMetrics(ad: AnalysisData): {
  monthlyTraffic: number;
  roas: number;
  roasVsMarket: number;
  cpa?: number | string;
  convRate?: number | string;
  marketShare: number | null;
  competitorCount: number;
  projectedRoas: string | null;
};
