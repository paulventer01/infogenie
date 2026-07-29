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
  kind: "blog" | "cold-email" | "ad" | "landing" | "social";
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
  source: "illustrative" | "connected";
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

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AgencyAlert = {
  id: string;
  clientId: string;
  title: string;
  detail: string;
  severity: AlertSeverity;
  owner: string;
  category:
    | "spend"
    | "cpa"
    | "deliverability"
    | "deadline"
    | "integration"
    | "reporting"
    | "anomaly"
    | "approval";
  createdAt: string;
  status: "open" | "acknowledged";
};

export type ConnectorPlatform =
  | "Meta Ads"
  | "Google Ads"
  | "GA4"
  | "LinkedIn Ads"
  | "TikTok Ads"
  | "Email"
  | "HubSpot";

export type IntegrationStatus = {
  platform: ConnectorPlatform | string;
  status: "connected" | "broken" | "pending";
  note?: string;
  lastSyncedAt?: string;
  connectedAt?: string;
};

export type MetricSnapshot = {
  id: string;
  syncedAt: string;
  source: "live-sync";
  platforms: string[];
  spend: number;
  conversions: number;
  cac: number;
  ctr: number;
  roas: number;
  sessions?: number;
};

export type WeeklyReport = {
  id: string;
  narrative: string;
  generatedAt: string;
  updatedAt: string;
  status: "draft" | "final";
  /** Autopilot: schedule weekly send (Resend wired in production). */
  autopilot?: boolean;
  nextSendAt?: string;
};

export type ApprovalStatus = "pending" | "approved" | "changes_requested";

export type ApprovalItem = {
  id: string;
  clientId: string;
  kind: "draft" | "campaign" | "report";
  refId: string;
  title: string;
  preview: string;
  status: ApprovalStatus;
  note?: string;
  shareToken: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
};

export type TeamRole = "owner" | "manager" | "strategist" | "viewer";

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  teamRole: TeamRole;
  weeklyCapacityHours: number;
  hourlyCost: number;
};

export type ComplianceSettings = {
  gdprAcknowledged: boolean;
  consentLogged: boolean;
  dataResidencyNote: string;
  dpaSigned: boolean;
};

export type OptimizationSuggestion = {
  id: string;
  clientId: string;
  channel: string;
  action: "increase_budget" | "decrease_budget" | "pause" | "raise_bid" | "lower_bid";
  title: string;
  why: string;
  deltaPct: number;
  status: "proposed" | "applied" | "dismissed";
  createdAt: string;
};

export type AutomationTrigger =
  | "anomaly_cpa"
  | "report_ready"
  | "approval_pending"
  | "budget_overspend"
  | "schedule_weekly";

export type AutomationAction =
  | "notify_owner"
  | "pause_campaigns"
  | "generate_report"
  | "request_approval"
  | "apply_budget_cap";

export type AutomationRule = {
  id: string;
  name: string;
  clientId: string | "all";
  trigger: AutomationTrigger;
  action: AutomationAction;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
};

export type AttributionTouch = {
  channel: string;
  role: "first" | "assist" | "last";
  sharePct: number;
  conversions: number;
  revenue: number;
};

export type AttributionModel = {
  generatedAt: string;
  model: "multi-touch-linear" | "last-click" | "first-click";
  touches: AttributionTouch[];
  totalSpend: number;
  totalRevenue: number;
  blendedRoas: number;
  note: string;
};

export type CapacityAssignment = {
  id: string;
  memberId: string;
  clientId: string;
  hoursThisWeek: number;
};

export type ClientWorkspace = {
  id: string;
  name: string;
  domain?: string;
  owner: string;
  createdAt: string;
  retainerMonthly: number;
  analysis: Analysis | null;
  drafts: ContentDraft[];
  campaigns: CampaignDraft[];
  sequences: ReachSequence[];
  results: ResultsSnapshot | null;
  weeklyReport: WeeklyReport | null;
  alerts: AgencyAlert[];
  integrations: IntegrationStatus[];
  metricHistory: MetricSnapshot[];
  approvals: ApprovalItem[];
  acknowledgedAlertIds: string[];
  attribution: AttributionModel | null;
  optimizations: OptimizationSuggestion[];
};

export type InstaReport = {
  id: string;
  prospectName: string;
  domain: string;
  industry: string;
  analysis: Analysis | null;
  shareToken: string;
  createdAt: string;
};

export type WhiteLabel = {
  agencyName: string;
  accentColor: string;
  footerText?: string;
  tagline?: string;
  /** When true (default), client-facing pages never show InfoGenie / vendor chrome. */
  hideVendorBrand: boolean;
};

export type DataMode = "strict" | "demo";

export type ReportSection = {
  id: string;
  title: string;
  status: "ok" | "empty" | "withheld";
  body: string;
};

export type AgencyAccount = {
  id: string;
  email: string;
  agencyName: string;
  createdAt: string;
  dataMode: DataMode;
  activeClientId: string | null;
  clients: ClientWorkspace[];
  prospects: InstaReport[];
  whiteLabel: WhiteLabel;
  team: TeamMember[];
  assignments: CapacityAssignment[];
  compliance: ComplianceSettings;
  /** Demo session role for permission gates. */
  sessionRole: TeamRole;
  automations: AutomationRule[];
  /** Cumulative reporting hours saved (success metric). */
  hoursSavedReporting: number;
};

/** @deprecated Use ClientWorkspace — kept for migration */
export type Workspace = ClientWorkspace & { email: string };
