export interface EngagementChannel {
  name: string;
  color: string;
  sessions: number;
  engaged: number;
  engagementRate: number;
  bounceRate: number;
  avgEngagement: string;
  eventsPerSession: number;
}

export interface SearchQueryRow {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export interface MarketingIntel {
  domain: string;
  period: string;
  engagementByChannel: EngagementChannel[];
  lowCtrQueries: SearchQueryRow[];
  channelTrend: { name: string; color: string; points: number[] }[];
  scrollDepth: { pct: number; total: number; unique: number }[];
  audienceSplit: { newUsers: number; returningUsers: number; newBounce: number; retBounce: number };
  topReturningPages: { path: string; label: string; visitors: number; delta: number }[];
  siteSearches: { term: string; searches: number; pct: number }[];
  seoNotes: { date: string; note: string }[];
  dataSource: string;
}

export function buildMarketingIntel(domain: string, industryName?: string): MarketingIntel;
