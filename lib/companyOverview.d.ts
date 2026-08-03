export interface OverviewTrend {
  pct: number;
  up: boolean;
}

export interface OverviewSnapshot {
  key: string;
  label: string;
  value: string;
  trend: OverviewTrend;
  view: string;
  cta?: string | null;
  live?: boolean;
}

export interface OverviewModule {
  key: string;
  label: string;
  color: string;
  desc: string;
  view: string;
  metrics: { label: string; value: string; trend: OverviewTrend }[];
}

export interface JourneyStep {
  step: number;
  label: string;
  desc: string;
  view: string;
  done: boolean;
}

export interface OverviewWidgetMetric {
  label: string;
  value: string;
  tone?: "danger" | "warn" | "info" | "ok";
}

export interface OverviewWidget {
  id: string;
  title: string;
  view: string;
  accent: string;
  hero?: { label: string; value: string; suffix?: string };
  metrics: OverviewWidgetMetric[];
  note?: string;
}

export interface CompanyOverview {
  domain: string;
  industry: string;
  snapshot: OverviewSnapshot[];
  modules: OverviewModule[];
  widgets: OverviewWidget[];
  journey: JourneyStep[];
  profile: {
    domain?: string;
    businessSummary?: string;
    subNiche?: string;
    siteTitle?: string;
    metaDesc?: string;
    analyzedAt?: string;
  } | null;
}

export function buildCompanyOverview(
  domain: string,
  industryName: string,
  analysisData: Record<string, unknown> | null | undefined,
  journeyStatus?: Record<string, boolean> | null,
): CompanyOverview;

export function buildOverviewWidgets(
  domain: string,
  analysisData: Record<string, unknown>,
  kpis: Record<string, unknown>,
): OverviewWidget[];
