"use client";

// Native React port of the legacy `battleplan` panel (was `window.buildBattlePlan`
// + `window.switchBattlePlanComp` + `#view-battleplan` in public/js/ig_compete.js /
// index.html). Renders the per-competitor Battle Plan — hero, competitor tabs,
// selected-competitor summary, priority banner and the six action sections
// (weaknesses, keyword attack, creative, audiences, campaign counter-moves, quick
// wins) plus the Full Attack Plan launcher — directly from the legacy
// `window.analysisData` global (set by the home-page competitor analysis).
// Action buttons invoke the existing legacy globals (bpLC/bpCS/bpGA/bpBC/bpTA/bpCC/
// bpQW/openFullAttackPlanModal) which prefill the Creative Studio / Campaign
// launcher; cross-tool links go through `lib/nav#goToView`. See
// `docs/react-panel-migration.md`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import { apiGet } from "@/lib/api";

interface Campaign {
  name?: string;
  channel?: string;
  ctr?: string;
  roas?: number;
  status?: string;
  budget?: string;
}
interface Audience {
  label?: string;
  pct?: number;
}
interface AdCopy {
  headline?: string;
  body?: string;
}
interface Competitor {
  name?: string;
  url?: string;
  logo?: string;
  threatLevel?: string;
  trafficMo?: number;
  traffic?: string;
  ctr?: string;
  roas?: string | number;
  adSpend?: string;
  topChannel?: string;
  topKeywords?: string[];
  suggestions?: string[];
  campaigns?: Campaign[];
  audiences?: Audience[];
  adCopy?: AdCopy[];
  estimatedROI?: string;
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: Competitor[];
}

interface SavedAttackPlanMeta {
  id: string;
  competitor?: string;
  myDomain?: string;
  industry?: string;
  savedAt?: string;
  sources?: string[];
  source?: string;
  _fabricated?: boolean;
  opportunityScore?: number;
}

interface AttackPlanListResult {
  ok: boolean;
  error?: string;
  plans?: SavedAttackPlanMeta[];
  data_unavailable?: boolean;
  source?: string;
  message?: string;
}

interface AttackPlanDetailResult {
  ok: boolean;
  error?: string;
  plan?: Record<string, unknown> | null;
  id?: string;
  competitor?: string;
  myDomain?: string;
  industry?: string;
  savedAt?: string;
  sources?: string[];
  source?: string;
  _fabricated?: boolean;
  data_unavailable?: boolean;
  message?: string;
}

interface UnwrappedAttackPlanList {
  withheld: boolean;
  plans: SavedAttackPlanMeta[];
  error: string;
  message: string;
}

interface UnwrappedLatestPlan {
  withheld: boolean;
  empty: boolean;
  error: string;
  message: string;
  plan: Record<string, unknown> | null;
  competitor: string;
  source?: string;
  sources: string[];
  fabricated: boolean;
}

type InlinePlanKind = "loading" | "empty" | "withheld" | "error" | "ready";
type InlinePlanTab = "overview" | "weekly" | "keywords" | "wins";

interface InlinePlanState {
  kind: InlinePlanKind;
  error: string;
  message: string;
  competitor: string;
  plan: Record<string, unknown> | null;
  source?: string;
  sources: string[];
  fabricated: boolean;
}

interface WeeklyPlanRow {
  week: string;
  focus: string;
  actions: string[];
  kpi: string;
}
interface KeywordTargetRow {
  keyword: string;
  volume: string;
  cpc: string;
  priority: string;
}
interface CriticalWinRow {
  win: string;
  impact: string;
  timeframe: string;
}

interface ParsedAttackPlan {
  executiveSummary: string;
  opportunityScore: string;
  estimatedROILift: string;
  timeToResults: string;
  weeklyPlan: WeeklyPlanRow[];
  keywordTargets: KeywordTargetRow[];
  criticalWins: CriticalWinRow[];
}

const AP_LIST_UNAVAILABLE_FALLBACK =
  "Attack plan withheld: live AI output was unavailable and this workspace is in strict data mode. An administrator has been notified.";

function unwrapAttackPlanList(res: AttackPlanListResult): UnwrappedAttackPlanList {
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      _unwrapAttackPlanListPayload?: (r: AttackPlanListResult) => Partial<UnwrappedAttackPlanList>;
    };
    if (typeof w._unwrapAttackPlanListPayload === "function") {
      const u = w._unwrapAttackPlanListPayload(res);
      return {
        withheld: !!u.withheld,
        plans: Array.isArray(u.plans) ? u.plans : [],
        error: typeof u.error === "string" ? u.error : "",
        message: typeof u.message === "string" ? u.message : "",
      };
    }
  }
  if (res.data_unavailable === true || res.source === "data_unavailable") {
    const message =
      typeof res.message === "string" && res.message.trim() ? res.message.trim() : AP_LIST_UNAVAILABLE_FALLBACK;
    return { withheld: true, plans: [], error: "", message };
  }
  if (res.ok === false) {
    return {
      withheld: false,
      plans: [],
      error: res.error || "Could not load saved attack plans",
      message: "",
    };
  }
  return {
    withheld: false,
    plans: Array.isArray(res.plans) ? res.plans : [],
    error: "",
    message: "",
  };
}

function fieldText(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return "—";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function parseAttackPlanBody(plan: Record<string, unknown>): ParsedAttackPlan {
  const weeklyRaw = Array.isArray(plan.weeklyPlan) ? plan.weeklyPlan : [];
  const kwRaw = Array.isArray(plan.keywordTargets) ? plan.keywordTargets : [];
  const winsRaw = Array.isArray(plan.criticalWins) ? plan.criticalWins : [];
  return {
    executiveSummary: typeof plan.executiveSummary === "string" ? plan.executiveSummary : "",
    opportunityScore: fieldText(plan.opportunityScore),
    estimatedROILift: fieldText(plan.estimatedROILift),
    timeToResults: fieldText(plan.timeToResults),
    weeklyPlan: weeklyRaw.map((w) => {
      const row = asRecord(w);
      const actions = Array.isArray(row.actions)
        ? row.actions.map((a) => fieldText(a)).filter((a) => a !== "—")
        : [];
      return {
        week: fieldText(row.week),
        focus: fieldText(row.focus),
        actions,
        kpi: fieldText(row.kpi),
      };
    }),
    keywordTargets: kwRaw.map((k) => {
      const row = asRecord(k);
      return {
        keyword: fieldText(row.keyword),
        volume: fieldText(row.volume),
        cpc: fieldText(row.cpc),
        priority: fieldText(row.priority),
      };
    }),
    criticalWins: winsRaw.map((w) => {
      const row = asRecord(w);
      return {
        win: fieldText(row.win),
        impact: fieldText(row.impact),
        timeframe: fieldText(row.timeframe),
      };
    }),
  };
}

function unwrapLatestPlan(res: AttackPlanDetailResult): UnwrappedLatestPlan {
  if (res.data_unavailable === true || res.source === "data_unavailable") {
    const message =
      typeof res.message === "string" && res.message.trim() ? res.message.trim() : AP_LIST_UNAVAILABLE_FALLBACK;
    return {
      withheld: true,
      empty: false,
      error: "",
      message,
      plan: null,
      competitor: "",
      sources: [],
      fabricated: false,
    };
  }
  if (res.ok === false) {
    return {
      withheld: false,
      empty: false,
      error: res.error || "Could not load battle plan",
      message: "",
      plan: null,
      competitor: "",
      sources: [],
      fabricated: false,
    };
  }
  if (!res.plan) {
    return {
      withheld: false,
      empty: true,
      error: "",
      message: "",
      plan: null,
      competitor: "",
      sources: [],
      fabricated: false,
    };
  }
  const sources = Array.isArray(res.sources) ? res.sources : [];
  const fabricated = !!(res._fabricated || res.source === "template" || sources.includes("template"));
  return {
    withheld: false,
    empty: false,
    error: "",
    message: "",
    plan: res.plan,
    competitor: typeof res.competitor === "string" ? res.competitor : "",
    source: res.source,
    sources,
    fabricated,
  };
}

function detailToInline(res: AttackPlanDetailResult, competitorHint?: string): InlinePlanState {
  const u = unwrapLatestPlan(res);
  if (u.withheld) {
    return {
      kind: "withheld",
      error: "",
      message: u.message,
      competitor: competitorHint || u.competitor,
      plan: null,
      sources: [],
      fabricated: false,
    };
  }
  if (u.error) {
    return {
      kind: "error",
      error: u.error,
      message: "",
      competitor: "",
      plan: null,
      sources: [],
      fabricated: false,
    };
  }
  if (u.empty || !u.plan) {
    return {
      kind: "empty",
      error: "",
      message: "",
      competitor: "",
      plan: null,
      sources: [],
      fabricated: false,
    };
  }
  return {
    kind: "ready",
    error: "",
    message: "",
    competitor: competitorHint || u.competitor || "Competitor",
    plan: u.plan,
    source: u.source,
    sources: u.sources,
    fabricated: u.fabricated,
  };
}

function formatSavedAt(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hours ago`;
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function planHonestyBadge(p: SavedAttackPlanMeta): { label: string; style: CSSProperties } {
  const sources = Array.isArray(p.sources) ? p.sources : [];
  const fabricated = !!(p._fabricated || p.source === "template" || sources.includes("template"));
  if (fabricated) {
    return { label: "ESTIMATE · TEMPLATE", style: { background: "#FEE2E2", color: "#991B1B" } };
  }
  const live = sources.filter((s) => s && s !== "template");
  if (live.length) {
    return { label: `AI ANALYSIS · ${live.join(" + ")}`, style: { background: "#FEF3C7", color: "#92400E" } };
  }
  return { label: "AI ANALYSIS", style: { background: "#FEF3C7", color: "#92400E" } };
}

function openSavedPlanBridge(payload: AttackPlanDetailResult, competitor?: string): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    openSavedAttackPlan?: (p: AttackPlanDetailResult, name?: string) => boolean;
    renderAttackPlan?: (plan: Record<string, unknown>, name: string) => void;
    _unwrapAttackPlanPayload?: (p: AttackPlanDetailResult) => {
      withheld?: boolean;
      ok?: boolean;
      plan?: Record<string, unknown> | null;
      message?: string;
      error?: string;
      source?: string;
      fabricated?: boolean;
      sources?: string[];
    };
    _apShowUnavailable?: (message?: string) => void;
    _apPlanMeta?: { source?: string; fabricated?: boolean; sources?: string[] };
    showToast?: (m: string) => void;
  };
  if (typeof w.openSavedAttackPlan === "function") {
    return w.openSavedAttackPlan(payload, competitor);
  }
  if (typeof w._unwrapAttackPlanPayload === "function") {
    const unwrapped = w._unwrapAttackPlanPayload(payload);
    if (unwrapped.withheld) {
      w._apShowUnavailable?.(unwrapped.message || unwrapped.error);
      w.showToast?.("📭 Attack plan withheld — live AI output unavailable in strict data mode");
      return false;
    }
    if (!unwrapped.ok || !unwrapped.plan) {
      w.showToast?.("⚠️ Could not load saved attack plan");
      return false;
    }
    w._apPlanMeta = {
      source: unwrapped.source,
      fabricated: unwrapped.fabricated,
      sources: unwrapped.sources,
    };
    if (typeof w.renderAttackPlan === "function") {
      w.renderAttackPlan(unwrapped.plan, competitor || payload.competitor || "Competitor");
      return true;
    }
  }
  if (!payload.plan) {
    w.showToast?.("⚠️ Could not load saved attack plan");
    return false;
  }
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const fabricated = !!(payload._fabricated || payload.source === "template" || sources.includes("template"));
  w._apPlanMeta = { source: payload.source, fabricated, sources };
  if (typeof w.renderAttackPlan === "function") {
    w.renderAttackPlan(payload.plan, competitor || payload.competitor || "Competitor");
    return true;
  }
  w.showToast?.("⚠️ Action not ready — refresh the page and try again (openSavedAttackPlan)");
  return false;
}

function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || null;
}

// Deterministic seed hash — ported verbatim from the legacy `_blSeed` so the
// opportunity score and per-keyword CPC match the original presentation exactly.
function blSeed(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function callWin(name: string, ...args: number[]): void {
  if (typeof window === "undefined") return;
  const fn = (window as unknown as Record<string, ((...a: number[]) => void) | undefined>)[name];
  if (typeof fn === "function") {
    try {
      fn(...args);
      return;
    } catch {
      /* legacy handler error */
    }
  }
  const w = window as unknown as { showToast?: (m: string) => void };
  w.showToast?.(`⚠️ Action not ready — refresh the page and try again (${name})`);
}

function fmtT(n: number): string {
  return n >= 1e9
    ? (n / 1e9).toFixed(1) + "B"
    : n >= 1e6
      ? (n / 1e6).toFixed(1) + "M"
      : n >= 1e3
        ? (n / 1e3).toFixed(0) + "K"
        : String(n || 0);
}

const KW_VOLUMES = [14800, 8200, 22000, 6600, 18400, 4400, 9800, 12000];
const KW_DIFFICULTIES = ["Low", "Medium", "Medium", "High"];
const KW_COLORS = ["#0066FF", "#7C3AED", "#059669", "#D97706"];
const ANGLES = ["Pain-Point Contrast", "Benefit Superiority", "Social Proof Attack", "Value Proposition"];
const AUD_CHANNELS = ["Meta Ads", "Google Ads", "LinkedIn Ads", "TikTok Ads"];
const AUD_GAPS = [
  "Underserved by competitor — low ad frequency in this segment",
  "Poor creative resonance — competitor uses generic messaging here",
  "Budget mismatch — competitor over-spends on lower-intent tiers",
];

interface Btn {
  label: string;
  onClick: () => void;
  style: CSSProperties;
}
interface CardData {
  border: string;
  badgeStyle: CSSProperties;
  badge: string;
  title: string;
  body: string;
  buttons: Btn[];
}

const btnBase: CSSProperties = {
  padding: "6px 14px",
  border: "none",
  borderRadius: 8,
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
};
const primaryStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff" };
const dangerStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#EF4444,#DC2626)", color: "#fff" };
const purpleStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", color: "#fff" };
const greenStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff" };
const ghostStyle: CSSProperties = { ...btnBase, background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#374151" };
const tealStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#00C9C8,#00E5FF)", color: "#0A1628" };

function Card({ data }: { data: CardData }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E5E7EB",
        borderLeft: `4px solid ${data.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: "0.62rem", fontWeight: 800, padding: "3px 8px", borderRadius: 5, flexShrink: 0, ...data.badgeStyle }}>
          {data.badge}
        </span>
        <div
          style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0A1628", lineHeight: 1.4 }}
          dangerouslySetInnerHTML={{ __html: data.title }}
        />
      </div>
      <div
        style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.55, marginBottom: 10 }}
        dangerouslySetInnerHTML={{ __html: data.body }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {data.buttons.map((b, i) => (
          <button key={i} onClick={b.onClick} style={b.style}>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>{icon}</span>
        <div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.9rem", fontWeight: 800, color: "white" }} dangerouslySetInnerHTML={{ __html: title }} />
          <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,.4)", marginTop: 2 }} dangerouslySetInnerHTML={{ __html: sub }} />
        </div>
      </div>
      {children}
    </div>
  );
}

/** Server-side saved plans — independent of in-page analysisData. */
function SavedPlansSection({
  variant,
  emptyCopy,
  onShowInline,
}: {
  variant: "embedded" | "standalone";
  emptyCopy: string;
  onShowInline?: (payload: AttackPlanDetailResult, competitor?: string) => void;
}) {
  const [savedPlans, setSavedPlans] = useState<SavedAttackPlanMeta[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedWithheld, setSavedWithheld] = useState<string | null>(null);
  const [viewingPlanId, setViewingPlanId] = useState<string | null>(null);

  const loadSavedPlans = useCallback(async () => {
    setSavedLoading(true);
    setSavedError(null);
    setSavedWithheld(null);
    const res = await apiGet<AttackPlanListResult>("/api/ai-attack-plan/list");
    const unwrapped = unwrapAttackPlanList(res);
    if (unwrapped.withheld) {
      setSavedPlans([]);
      setSavedWithheld(unwrapped.message || AP_LIST_UNAVAILABLE_FALLBACK);
      setSavedLoading(false);
      return;
    }
    if (unwrapped.error) {
      setSavedPlans([]);
      setSavedError(unwrapped.error);
      setSavedLoading(false);
      return;
    }
    setSavedPlans(unwrapped.plans);
    setSavedLoading(false);
  }, []);

  useEffect(() => {
    void loadSavedPlans();
  }, [loadSavedPlans]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSaved = () => {
      void loadSavedPlans();
    };
    window.addEventListener("ig:attack-plan-saved", onSaved);
    return () => window.removeEventListener("ig:attack-plan-saved", onSaved);
  }, [loadSavedPlans]);

  async function viewSavedPlan(entry: SavedAttackPlanMeta) {
    if (!entry.id) return;
    setViewingPlanId(entry.id);
    const res = await apiGet<AttackPlanDetailResult>(`/api/ai-attack-plan/${entry.id}`);
    setViewingPlanId(null);
    if (res.error === "not_found") {
      const w = window as unknown as { showToast?: (m: string) => void };
      w.showToast?.("⚠️ Saved attack plan not found");
      void loadSavedPlans();
      return;
    }
    const competitor = entry.competitor || res.competitor;
    onShowInline?.(res, competitor);
    openSavedPlanBridge(res, competitor);
  }

  const wrapStyle: CSSProperties =
    variant === "standalone"
      ? {
          background: "linear-gradient(135deg,rgba(0,201,200,.1),rgba(0,102,255,.06))",
          border: "1px solid rgba(0,201,200,.2)",
          borderRadius: 14,
          padding: "20px 24px",
        }
      : { marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(0,201,200,.22)" };

  return (
    <div className="bp-saved-plans" data-bp-saved-plans="1" style={wrapStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0F172A" }}>
            📂 Saved Attack Plans
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 2 }}>
            Re-open a generated plan anytime — closing the dialog does not delete it
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadSavedPlans()}
          disabled={savedLoading}
          style={{
            padding: "6px 12px",
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            fontSize: "0.72rem",
            fontWeight: 700,
            color: "#475569",
            cursor: savedLoading ? "wait" : "pointer",
          }}
        >
          {savedLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {savedLoading && savedPlans.length === 0 && !savedError ? (
        <div style={{ fontSize: "0.8rem", color: "#64748B", padding: "12px 0" }}>Loading saved plans…</div>
      ) : null}

      {savedError ? (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: "0.8rem",
            color: "#991B1B",
          }}
        >
          Could not load saved attack plans — {savedError}
        </div>
      ) : null}

      {savedWithheld ? (
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 10,
            padding: "16px 14px",
            fontSize: "0.8rem",
            color: "#78350F",
          }}
        >
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#92400E", marginBottom: 8 }}>
            📭 Saved plans withheld
          </div>
          <div style={{ lineHeight: 1.55, color: "#92400E" }}>{savedWithheld}</div>
          <div style={{ fontSize: "0.75rem", color: "#64748B", lineHeight: 1.5, marginTop: 10 }}>
            Live AI output was unavailable. Strict data mode hides estimated/template plans and reports the issue to an administrator — generating a new plan will not restore access to saved plans here.
          </div>
        </div>
      ) : null}

      {!savedLoading && !savedError && !savedWithheld && savedPlans.length === 0 ? (
        <div
          style={{
            background: "#F8FAFC",
            border: "1px dashed #CBD5E1",
            borderRadius: 10,
            padding: "16px 14px",
            fontSize: "0.8rem",
            color: "#64748B",
            textAlign: "center",
          }}
        >
          {emptyCopy}
        </div>
      ) : null}

      {!savedError && savedPlans.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {savedPlans.map((p) => {
            const honesty = planHonestyBadge(p);
            const viewing = viewingPlanId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  background: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0F172A" }}>
                    vs {p.competitor || "Competitor"}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 3 }}>
                    Generated {formatSavedAt(p.savedAt)}
                    {p.myDomain ? ` · ${p.myDomain}` : ""}
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      marginTop: 6,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: "0.6rem",
                      fontWeight: 800,
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
                      ...honesty.style,
                    }}
                  >
                    {honesty.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void viewSavedPlan(p)}
                  disabled={viewing}
                  style={{
                    padding: "8px 16px",
                    background: "linear-gradient(135deg,#0066FF,#00C9C8)",
                    border: "none",
                    borderRadius: 8,
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "#fff",
                    cursor: viewing ? "wait" : "pointer",
                    whiteSpace: "nowrap",
                    opacity: viewing ? 0.7 : 1,
                  }}
                >
                  {viewing ? "Opening…" : "View plan"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const INLINE_TABS: { id: InlinePlanTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "weekly", label: "8-Week Plan" },
  { id: "keywords", label: "Keywords" },
  { id: "wins", label: "Quick Wins" },
];

const inlineTabBtn = (active: boolean): CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: active ? "1px solid rgba(15,118,110,.28)" : "1px solid transparent",
  background: active ? "rgba(0,201,200,.14)" : "transparent",
  color: active ? "#0F766E" : "#475569",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
});

function InlineBattlePlanPanel({
  panelRef,
  state,
  tab,
  onTab,
  variant,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  state: InlinePlanState;
  tab: InlinePlanTab;
  onTab: (t: InlinePlanTab) => void;
  variant: "embedded" | "standalone";
}) {
  const wrapStyle: CSSProperties =
    variant === "standalone"
      ? {
          background: "linear-gradient(135deg,rgba(0,201,200,.1),rgba(0,102,255,.06))",
          border: "1px solid rgba(0,201,200,.2)",
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 16,
        }
      : {
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid rgba(0,201,200,.22)",
        };

  const title =
    state.kind === "ready" && state.competitor
      ? `⚔️ Battle Plan vs ${state.competitor}`
      : "⚔️ Battle Plan";
  const honesty =
    state.kind === "ready"
      ? planHonestyBadge({
          id: "inline",
          competitor: state.competitor,
          sources: state.sources,
          source: state.source,
          _fabricated: state.fabricated,
        })
      : null;
  const body = state.kind === "ready" && state.plan ? parseAttackPlanBody(state.plan) : null;

  return (
    <div
      ref={panelRef}
      id="bp-inline-battle-plan"
      className="bp-inline-plan"
      data-bp-inline-plan="1"
      data-bp-inline-state={state.kind}
      data-bp-inline-tab={tab}
      style={wrapStyle}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div
            data-bp-inline-title="1"
            style={{ fontFamily: "Sora,sans-serif", fontSize: "0.95rem", fontWeight: 800, color: "#0F172A" }}
          >
            {title}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 2 }}>8-week attack plan</div>
        </div>
        {honesty ? (
          <span
            data-bp-inline-honesty="1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: "0.6rem",
              fontWeight: 800,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              ...honesty.style,
            }}
          >
            {honesty.label}
          </span>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <div style={{ fontSize: "0.8rem", color: "#64748B", padding: "12px 0" }}>Loading battle plan…</div>
      ) : null}

      {state.kind === "empty" ? (
        <div
          data-bp-inline-empty="1"
          style={{
            background: "#F8FAFC",
            border: "1px dashed #CBD5E1",
            borderRadius: 10,
            padding: "16px 14px",
            fontSize: "0.8rem",
            color: "#64748B",
            textAlign: "center",
          }}
        >
          No battle plan yet — generate one above.
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div
          data-bp-inline-error="1"
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: "0.8rem",
            color: "#991B1B",
          }}
        >
          Could not load battle plan — {state.error}
        </div>
      ) : null}

      {state.kind === "withheld" ? (
        <div
          data-bp-inline-withheld="1"
          style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 10,
            padding: "16px 14px",
            fontSize: "0.8rem",
            color: "#78350F",
          }}
        >
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#92400E", marginBottom: 8 }}>
            📭 Saved plans withheld
          </div>
          <div style={{ lineHeight: 1.55, color: "#92400E" }}>{state.message}</div>
          <div style={{ fontSize: "0.75rem", color: "#64748B", lineHeight: 1.5, marginTop: 10 }}>
            Live AI output was unavailable. Strict data mode hides estimated/template plans and reports the issue to an administrator — generating a new plan will not restore access to saved plans here.
          </div>
        </div>
      ) : null}

      {state.kind === "ready" && body ? (
        <div>
          <div
            role="tablist"
            aria-label="Battle plan sections"
            style={{ display: "flex", gap: 4, padding: "4px 0 12px", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap" }}
          >
            {INLINE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                data-active={tab === t.id ? "true" : "false"}
                aria-selected={tab === t.id}
                onClick={() => onTab(t.id)}
                style={inlineTabBtn(tab === t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <div style={{ padding: "16px 0 4px", color: "#0F172A", lineHeight: 1.6 }}>
              <p data-bp-inline-summary="1" style={{ fontSize: "0.9rem", margin: "0 0 16px", color: "#334155" }}>
                {body.executiveSummary || "No executive summary in this plan."}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
                <div style={{ background: "#F0FDF4", borderRadius: 10, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#059669" }}>{body.opportunityScore}</div>
                  <div style={{ fontSize: "0.7rem", color: "#64748B" }}>Opportunity</div>
                </div>
                <div style={{ background: "#EFF6FF", borderRadius: 10, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0066FF" }}>{body.estimatedROILift}</div>
                  <div style={{ fontSize: "0.7rem", color: "#64748B" }}>ROI lift</div>
                </div>
                <div style={{ background: "#FEF3C7", borderRadius: 10, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#D97706" }}>{body.timeToResults}</div>
                  <div style={{ fontSize: "0.7rem", color: "#64748B" }}>Time to results</div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "weekly" ? (
            <div data-bp-inline-weekly="1" style={{ padding: "16px 0 4px" }}>
              {body.weeklyPlan.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "#64748B" }}>No weekly milestones in this plan.</div>
              ) : (
                body.weeklyPlan.map((w, i) => (
                  <div
                    key={i}
                    style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: 14, marginBottom: 10, background: "#FFFFFF" }}
                  >
                    <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>
                      {w.week} — {w.focus}
                    </div>
                    {w.actions.length > 0 ? (
                      <ul style={{ margin: "8px 0 0 18px", color: "#475569", fontSize: "0.85rem" }}>
                        {w.actions.map((a, j) => (
                          <li key={j}>{a}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 8 }}>KPI: {w.kpi}</div>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === "keywords" ? (
            <div data-bp-inline-keywords="1" style={{ padding: "16px 0 4px", overflow: "auto" }}>
              {body.keywordTargets.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "#64748B" }}>No keyword targets in this plan.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC" }}>
                      <th style={{ textAlign: "left", padding: 8 }}>Keyword</th>
                      <th style={{ padding: 8 }}>Volume</th>
                      <th style={{ padding: 8 }}>CPC</th>
                      <th style={{ padding: 8 }}>Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {body.keywordTargets.map((k, i) => (
                      <tr key={i}>
                        <td style={{ padding: 8, borderTop: "1px solid #E2E8F0", color: "#0F172A" }}>{k.keyword}</td>
                        <td style={{ textAlign: "center", borderTop: "1px solid #E2E8F0" }}>{k.volume}</td>
                        <td style={{ textAlign: "center", borderTop: "1px solid #E2E8F0" }}>{k.cpc}</td>
                        <td style={{ textAlign: "center", borderTop: "1px solid #E2E8F0", fontWeight: 700 }}>{k.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {tab === "wins" ? (
            <div data-bp-inline-wins="1" style={{ padding: "16px 0 4px" }}>
              {body.criticalWins.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "#64748B" }}>No quick wins in this plan.</div>
              ) : (
                body.criticalWins.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      borderLeft: "4px solid #10B981",
                      padding: "10px 14px",
                      marginBottom: 10,
                      background: "#F0FDF4",
                      borderRadius: "0 8px 8px 0",
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#0F172A" }}>{w.win}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 4 }}>
                      Impact: {w.impact} · {w.timeframe}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AttackPlanWorkspace({
  variant,
  emptyCopy,
}: {
  variant: "embedded" | "standalone";
  emptyCopy: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [inline, setInline] = useState<InlinePlanState>({
    kind: "loading",
    error: "",
    message: "",
    competitor: "",
    plan: null,
    sources: [],
    fabricated: false,
  });
  const [tab, setTab] = useState<InlinePlanTab>("overview");

  const loadLatest = useCallback(async () => {
    const res = await apiGet<AttackPlanDetailResult>("/api/ai-attack-plan/latest");
    setInline(detailToInline(res));
    setTab("overview");
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSaved = () => {
      void loadLatest();
    };
    window.addEventListener("ig:attack-plan-saved", onSaved);
    return () => window.removeEventListener("ig:attack-plan-saved", onSaved);
  }, [loadLatest]);

  const showInline = useCallback((res: AttackPlanDetailResult, competitor?: string) => {
    setInline(detailToInline(res, competitor));
    setTab("overview");
    panelRef.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <>
      <InlineBattlePlanPanel panelRef={panelRef} state={inline} tab={tab} onTab={setTab} variant={variant} />
      <SavedPlansSection variant={variant} emptyCopy={emptyCopy} onShowInline={showInline} />
    </>
  );
}

export default function Battleplan() {
  const router = useRouter();
  const [ad, setAd] = useState<AnalysisData | null>(() => getAnalysisData());
  const comps = useMemo(() => (ad && Array.isArray(ad.competitors) ? ad.competitors : []), [ad]);
  const [idxState, setIdxState] = useState(0);

  // AppShell restore writes window.analysisData then fires these events
  // (document + window). Do not snapshot once — pick up the restored payload.
  useEffect(() => {
    const refresh = () => setAd(getAnalysisData());
    refresh();
    document.addEventListener("ig:analysis-ready", refresh);
    document.addEventListener("ig:analysis-updated", refresh);
    window.addEventListener("ig:analysis-ready", refresh);
    window.addEventListener("ig:analysis-updated", refresh);
    return () => {
      document.removeEventListener("ig:analysis-ready", refresh);
      document.removeEventListener("ig:analysis-updated", refresh);
      window.removeEventListener("ig:analysis-ready", refresh);
      window.removeEventListener("ig:analysis-updated", refresh);
    };
  }, []);

  const hasData = comps.length > 0;
  const idx = Math.min(idxState, Math.max(0, comps.length - 1));
  const c = hasData ? comps[idx] : null;
  const cName = c?.name || "Competitor";

  // Mirror the legacy `_bpCache` so the global action wrappers (bpLC/bpCS/…)
  // resolve the same competitor payload they would in the legacy panel.
  useEffect(() => {
    if (typeof window === "undefined" || !c) return;
    const w = window as unknown as { _bpCache?: Record<number, unknown>; _bpIdx?: number };
    w._bpCache = w._bpCache || {};
    w._bpCache[idx] = {
      name: c.name || "Competitor",
      channel: c.topChannel || null,
      keywords: (c.topKeywords || ["competitor brand alternative", "industry best tool", "vs competitor", "top rated solution"]).slice(0, 8),
      campaigns: (c.campaigns || []).slice(0, 4),
      audiences: (c.audiences || [
        { label: "High-Intent Buyers", pct: 38 },
        { label: "Decision Makers", pct: 24 },
        { label: "Mid-Market Segment", pct: 22 },
      ]).slice(0, 3),
      suggestions: (c.suggestions || []).slice(0, 4),
      adCopy: c.adCopy || null,
    };
    w._bpIdx = idx;
  }, [c, idx]);

  function switchComp(i: number) {
    setIdxState(i);
    if (typeof window !== "undefined") {
      (window as unknown as { _bpIdx?: number })._bpIdx = i;
      window.scrollTo(0, 0);
    }
  }

  if (!hasData || !c) {
    return (
      <div
        data-bp-no-analysis="1"
        style={{ background: "var(--ig-page)", minHeight: "100vh", paddingBottom: 40 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 16,
            padding: "48px 40px 28px",
          }}
        >
          <div style={{ fontSize: "3.5rem" }}>⚔️</div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.5rem", fontWeight: 900, color: "white" }}>No Analysis Yet</div>
          <div style={{ color: "rgba(255,255,255,.5)", maxWidth: 420, fontSize: "0.9rem", lineHeight: 1.6 }}>
            Run a competitor analysis first to generate your personalised Battle Plan — with actions you can take directly from this page.
          </div>
          <button
            onClick={() => goToView(router, "home")}
            style={{
              padding: "13px 30px",
              background: "linear-gradient(135deg,#0066FF,#00C9C8)",
              border: "none",
              borderRadius: 12,
              color: "white",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Run Analysis →
          </button>
        </div>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
          <AttackPlanWorkspace
            variant="standalone"
            emptyCopy="No attack plans saved yet — run an analysis first, then generate a plan from this page"
          />
        </div>
      </div>
    );
  }

  const domain = ad?.url || "yourdomain.com";
  const industry = ad?.industry?.name || "your industry";
  const threat = c.threatLevel || "medium";
  const traffic = c.trafficMo ? fmtT(c.trafficMo) : c.traffic || "—";
  const oppBase = threat === "high" ? 74 : threat === "medium" ? 55 : 38;
  const oppScore = oppBase + Math.floor(blSeed(c.name || "") % 18);
  const threatColor = threat === "high" ? "#EF4444" : threat === "medium" ? "#F59E0B" : "#10B981";

  // ── 1. Exploit Weaknesses ──────────────────────────────────────────────────
  const weakCards: CardData[] = (c.suggestions || [
    "Competitor has weak personalisation in search ads",
    "Generic creative with low audience specificity",
    "No TikTok or Reels presence",
    "Over-indexed on branded keywords",
  ])
    .slice(0, 4)
    .map((s, i) => ({
      border: i < 2 ? "#EF4444" : "#F59E0B",
      badgeStyle: i < 2 ? { background: "#FEE2E2", color: "#991B1B" } : { background: "#FEF3C7", color: "#92400E" },
      badge: i < 2 ? "HIGH" : "MEDIUM",
      title: s.length > 70 ? s.slice(0, 70) + "…" : s,
      body: `${cName} leaves this gap unaddressed. A targeted counter-campaign ${c.topChannel ? "on " + c.topChannel : "on their primary channel"} can capture this audience now.`,
      buttons: [
        { label: "⚡ Launch Counter-Campaign", onClick: () => callWin("bpLC", idx, i), style: dangerStyle },
        { label: "✨ Creative Studio", onClick: () => callWin("bpCS", idx, i), style: purpleStyle },
      ],
    }));

  // ── 2. Keyword Attack ──────────────────────────────────────────────────────
  const kwCards: CardData[] = (c.topKeywords || [
    "competitor brand + alternative",
    "industry best tool",
    "vs competitor keyword",
    "top rated solution",
  ])
    .slice(0, 4)
    .map((kw, i) => {
      const vol = KW_VOLUMES[i % KW_VOLUMES.length];
      const cpc = (0.9 + (blSeed(kw) % 320) / 100).toFixed(2);
      const diff = KW_DIFFICULTIES[i % KW_DIFFICULTIES.length];
      const diffColor = diff === "Low" ? "#059669" : diff === "Medium" ? "#D97706" : "#EF4444";
      return {
        border: KW_COLORS[i],
        badgeStyle: { background: "#EFF6FF", color: "#1D4ED8" },
        badge: `${vol.toLocaleString()}/mo · CPC $${cpc}`,
        title: `"${kw}"`,
        body: `${cName} is actively bidding here with suboptimal relevance scores — you can capture traffic at <strong style="color:#059669">lower CPC</strong> with tighter ad groups. Difficulty: <span style="color:${diffColor};font-weight:700">${diff}</span>.`,
        buttons: [
          { label: "🔑 Build Google Ads", onClick: () => callWin("bpGA", idx, i), style: primaryStyle },
          { label: "📝 Build Content", onClick: () => callWin("bpBC", idx, i), style: ghostStyle },
        ],
      };
    });

  // ── 3. Creative Counter-Strategy ───────────────────────────────────────────
  const adItems = c.adCopy && c.adCopy.length > 0 ? c.adCopy.slice(0, 3) : null;
  const creativeCards: CardData[] = adItems
    ? adItems.map((acItem, i) => ({
        border: "#7C3AED",
        badgeStyle: { background: "#F5F3FF", color: "#6D28D9" },
        badge: ANGLES[i] || "Creative Angle",
        title: `"${acItem.headline || "Counter Creative"}"`,
        body: (acItem.body || "").slice(0, 110),
        buttons: [{ label: "✨ Open Creative Studio", onClick: () => callWin("bpCS", idx, i), style: purpleStyle }],
      }))
    : (c.suggestions || ["Exploit their weak personalisation with hyper-targeted messaging"]).slice(0, 3).map((s, i) => ({
        border: "#7C3AED",
        badgeStyle: { background: "#F5F3FF", color: "#6D28D9" },
        badge: ANGLES[i] || "Creative Angle",
        title: `Beat ${cName}: ${s.slice(0, 35)}${s.length > 35 ? "…" : ""}`,
        body: `Outperform ${cName} by addressing this gap with superior creative.`,
        buttons: [{ label: "✨ Open Creative Studio", onClick: () => callWin("bpCS", idx, i), style: purpleStyle }],
      }));

  // ── 4. Audience Gaps ───────────────────────────────────────────────────────
  const audCards: CardData[] = (c.audiences && c.audiences.length
    ? c.audiences
    : [
        { label: "High-Intent Buyers", pct: 38 },
        { label: "Decision Makers", pct: 24 },
        { label: "Mid-Market Segment", pct: 22 },
      ]
  )
    .slice(0, 3)
    .map((a, i) => {
      const aCh = AUD_CHANNELS[i % AUD_CHANNELS.length];
      return {
        border: "#0066FF",
        badgeStyle: { background: "#EFF6FF", color: "#1D4ED8" },
        badge: `${a.pct}% of market`,
        title: a.label || "Audience",
        body: `${AUD_GAPS[i % AUD_GAPS.length].replace("competitor", cName)}. Best capture channel: <strong>${aCh}</strong>.`,
        buttons: [
          { label: "🎯 Target This Audience", onClick: () => callWin("bpTA", idx, i), style: primaryStyle },
          { label: "👥 Audience Deep-Dive", onClick: () => goToView(router, "audience"), style: ghostStyle },
        ],
      };
    });

  // ── 5. Campaign Counter-Moves ──────────────────────────────────────────────
  const campCards: CardData[] = (c.campaigns || []).slice(0, 3).map((camp, i) => {
    const roasTarget = ((camp.roas || 0) * 1.2).toFixed(1);
    return {
      border: "#10B981",
      badgeStyle: camp.status === "Active" ? { background: "#D1FAE5", color: "#065F46" } : { background: "#FEF3C7", color: "#92400E" },
      badge: camp.status || "",
      title: `Counter: "${(camp.name || "Campaign").slice(0, 40)}"`,
      body: `${cName} runs this on <strong>${camp.channel}</strong> at ${camp.ctr} CTR / ${camp.roas}× ROAS. Launch a counter-campaign targeting the same audience with superior creative — target ROAS: <strong style="color:#059669">${roasTarget}×</strong>.`,
      buttons: [{ label: "📣 Launch Counter-Campaign", onClick: () => callWin("bpCC", idx, i), style: greenStyle }],
    };
  });

  // ── 6. Quick Wins ──────────────────────────────────────────────────────────
  const qwItems: { t: string; button: Btn }[] = [
    {
      t: c.estimatedROI || "+25% CTR improvement via tighter audience segmentation",
      button: { label: "⚡ Execute", onClick: () => callWin("bpQW", idx, 0), style: tealStyle },
    },
    {
      t: `Capture ${cName}'s branded search traffic with non-branded alternatives at lower CPC`,
      button: { label: "🔑 View Keywords", onClick: () => goToView(router, "intelligence"), style: tealStyle },
    },
    {
      t: `Expand to channels where ${cName} has minimal presence for uncontested reach`,
      button: { label: "📣 Plan Social", onClick: () => goToView(router, "social"), style: tealStyle },
    },
  ];
  const qwCards: CardData[] = qwItems.map((w) => ({
    border: "#00C9C8",
    badgeStyle: { background: "#ECFEFF", color: "#0E7490" },
    badge: "QUICK WIN",
    title: w.t.length > 80 ? w.t.slice(0, 80) + "…" : w.t,
    body: "Low effort, high impact. Act on this before competitors do.",
    buttons: [w.button],
  }));

  const topRows = (c.suggestions || []).slice(0, 3);
  const initial = (c.logo || (c.name || "?")[0]).toString()[0];

  return (
    <div style={{ background: "var(--ig-page)", minHeight: "100vh", paddingBottom: 40 }}>
      {/* Page Header */}
      <div
        data-bp-hero
        data-ig-light-hero="1"
        className="ig-panel-hero"
        style={{
          background:
            "radial-gradient(ellipse 75% 65% at 10% 15%, rgba(15,118,110,0.16), transparent 55%), radial-gradient(ellipse 55% 50% at 92% 85%, rgba(2,132,199,0.14), transparent 50%), linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 55%, #eef4ff 100%)",
          borderRadius: 18,
          margin: "18px 24px 6px",
          padding: "22px 28px",
          border: "1px solid rgba(15, 118, 110, 0.16)",
          boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
          position: "relative",
          overflow: "hidden",
          minHeight: 130,
          display: "flex",
          alignItems: "center",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -60,
            right: -40,
            width: 260,
            height: 260,
            background: "radial-gradient(circle,rgba(15,118,110,.08),transparent 70%)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            width: "100%",
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div>
            <div
              className="breadcrumb"
              style={{ fontSize: "0.65rem", fontWeight: 800, color: "#0f766e", letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 6 }}
            >
              <span className="bc-group">Analyse</span>
              <span className="bc-sep"> › </span>
              Battle Plan
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: "1.4rem" }} aria-hidden>⚔️</span>
              <h1
                className="view-title"
                style={{ fontFamily: "Sora,sans-serif", fontSize: "1.5rem", fontWeight: 900, color: "#0f172a", margin: 0 }}
              >
                Battle Plan
              </h1>
              <span
                className="hero-pill"
                style={{ background: "#FFFFFF", border: "1px solid rgba(15,118,110,.22)", padding: "3px 12px", borderRadius: 20, fontSize: "0.67rem", fontWeight: 800, color: "#1E3A8A", boxShadow: "0 1px 3px rgba(15,30,61,.10)" }}
              >
                AI-GENERATED
              </span>
            </div>
            <p className="view-sub" style={{ color: "#334155", fontSize: "0.88rem", fontWeight: 500, margin: 0 }}>
              {domain} · {industry} · {comps.length} competitors · Click any action card to execute directly
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => callWin("bpLC", idx, 0)}
              style={{ padding: "10px 20px", background: "linear-gradient(135deg,#EF4444,#DC2626)", border: "none", borderRadius: 10, fontSize: "0.8rem", fontWeight: 800, color: "#fff", cursor: "pointer", boxShadow: "0 4px 12px rgba(239,68,68,.35)" }}
            >
              ⚡ Execute Top Priority
            </button>
            <button
              onClick={() => goToView(router, "campaigns")}
              style={{ padding: "10px 20px", background: "#FFFFFF", border: "1px solid rgba(255,255,255,.6)", borderRadius: 10, fontSize: "0.8rem", fontWeight: 800, color: "#1E3A8A", cursor: "pointer", boxShadow: "0 2px 6px rgba(15,30,61,.08)" }}
            >
              📋 All Campaigns
            </button>
          </div>
        </div>
      </div>

      {/* Competitor Tabs */}
      <div style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", overflowX: "auto" }}>
        <div style={{ display: "flex", padding: "0 20px", maxWidth: 1200, margin: "0 auto" }}>
          {comps.map((comp, i) => {
            const t = comp.threatLevel || "medium";
            const dotColor = t === "high" ? "#EF4444" : t === "medium" ? "#F59E0B" : "#10B981";
            const active = i === idx;
            const cInit = (comp.logo || (comp.name || "?")[0]).toString()[0];
            return (
              <button
                key={i}
                onClick={() => switchComp(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 18px",
                  border: "none",
                  borderBottom: `3px solid ${active ? "#00A8A7" : "transparent"}`,
                  background: active ? "rgba(0,201,200,.10)" : "transparent",
                  cursor: "pointer",
                  color: active ? "#0F766E" : "#334155",
                  fontSize: "0.8rem",
                  fontWeight: active ? 700 : 600,
                  whiteSpace: "nowrap",
                  fontFamily: "'Inter',sans-serif",
                  transition: "all .15s",
                }}
              >
                <span style={{ width: 22, height: 22, borderRadius: 6, background: "linear-gradient(135deg,#0066FF,#00C9C8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", fontWeight: 800, color: "white" }}>
                  {cInit}
                </span>
                {comp.name}
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Competitor Summary */}
      <div style={{ background: "#F0FDFA", borderBottom: "1px solid #CCFBF1", padding: "14px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0066FF,#00C9C8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "white", fontSize: "0.9rem" }}>
              {initial}
            </div>
            <div>
              <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.95rem" }}>{c.name}</div>
              <div style={{ fontSize: "0.68rem", color: "#64748B" }}>{c.url || ""}</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", gap: 24, flexWrap: "wrap" }}>
            {[
              { v: traffic, l: "Traffic/mo", color: "#0E7490" },
              { v: c.ctr || "—", l: "CTR", color: "#0E7490" },
              { v: `${c.roas || "—"}×`, l: "ROAS", color: "#0E7490" },
              { v: c.adSpend || "—", l: "Ad Spend", color: "#0E7490" },
              { v: c.topChannel || "—", l: "Top Channel", color: "#0E7490" },
              { v: threat.toUpperCase(), l: "Threat", color: threatColor },
            ].map((m, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.92rem", fontWeight: 800, color: m.color }}>{m.v}</div>
                <div style={{ fontSize: "0.62rem", color: "#64748B", textTransform: "uppercase", letterSpacing: ".06em" }}>{m.l}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: "0.67rem", color: "#64748B", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".05em" }}>Opportunity Score</div>
            <div style={{ fontSize: "2rem", fontWeight: 900, fontFamily: "Sora,sans-serif", color: oppScore >= 70 ? "#059669" : oppScore >= 50 ? "#D97706" : "#2563EB", lineHeight: 1 }}>
              {oppScore}
            </div>
            <div style={{ fontSize: "0.62rem", color: "#94A3B8" }}>out of 100</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px" }}>
        {/* Priority Summary Banner */}
        <div style={{ background: "linear-gradient(135deg,rgba(239,68,68,.1),rgba(220,38,38,.04))", border: "1px solid rgba(239,68,68,.18)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#1E293B", marginBottom: 10 }}>🎯 Top Priority Actions vs {c.name}</div>
          {topRows.length > 0 ? (
            topRows.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(239,68,68,.12)" }}>
                <span style={{ fontSize: "0.62rem", fontWeight: 800, padding: "2px 8px", borderRadius: 5, flexShrink: 0, background: i === 0 ? "#FEE2E2" : "rgba(239,68,68,.12)", color: i === 0 ? "#EF4444" : "#B91C1C" }}>
                  #{i + 1}
                </span>
                <div style={{ fontSize: "0.8rem", color: "#374151", lineHeight: 1.45 }}>{s}</div>
              </div>
            ))
          ) : (
            <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>Run analysis for full recommendations</div>
          )}
        </div>

        {/* 2-Column Action Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(460px,1fr))", gap: 20 }}>
          <Section icon="🎯" title="Exploit Their Weaknesses" sub={`${(c.suggestions || []).length || 4} identified gaps in ${cName}&apos;s strategy`}>
            {weakCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="🔑" title="Keyword Attack Windows" sub={`Keywords ${cName} is over-bidding — steal their traffic at lower CPC`}>
            {kwCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="🎨" title="Creative Counter-Strategy" sub={`Ad angles that out-perform ${cName}&apos;s current creative`}>
            {creativeCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="👥" title="Untapped Audience Segments" sub={`Segments ${cName} is under-serving or ignoring`}>
            {audCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="📣" title="Campaign Counter-Moves" sub={`Live ${cName} campaigns to counter right now`}>
            {campCards.length > 0 ? (
              campCards.map((d, i) => <Card key={i} data={d} />)
            ) : (
              <div style={{ color: "rgba(255,255,255,.4)", fontSize: "0.82rem", padding: "12px 0" }}>
                No active campaigns detected — run full analysis for live campaign data.
              </div>
            )}
          </Section>
          <Section icon="💰" title="High-ROI Quick Wins" sub="Low effort, high impact — act before competitors do">
            {qwCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
        </div>

        {/* Bottom CTA */}
        <div className="bp-attack-cta" style={{ marginTop: 24, background: "linear-gradient(135deg,rgba(0,201,200,.1),rgba(0,102,255,.06))", border: "1px solid rgba(0,201,200,.2)", borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.95rem", fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>🚀 Launch Full Attack Plan</div>
              <div style={{ fontSize: "0.8rem", color: "#475569" }}>
                GPT-4 generates a complete 8-week strategy — keywords, channels, content, budget &amp; weekly milestones
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".07em" }}>Select Competitor</label>
              <select
                id="attackPlanCompSelect"
                defaultValue={String(idx)}
                style={{ padding: "10px 14px", borderRadius: 9, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", width: "100%", appearance: "auto" }}
              >
                {comps.map((cc, i) => (
                  <option key={i} value={i}>
                    {cc.name || "Competitor " + (i + 1)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 18 }}>
              <button
                onClick={() => {
                  const sel = document.getElementById("attackPlanCompSelect") as HTMLSelectElement | null;
                  callWin("openFullAttackPlanModal", parseInt(sel?.value || String(idx), 10));
                }}
                style={{ padding: "11px 24px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 10, fontSize: "0.84rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,102,255,.4)" }}
              >
                🚀 Generate Attack Plan
              </button>
              <button
                type="button"
                className="bp-cta-secondary"
                onClick={() => goToView(router, "intelligence")}
              >
                📊 Deep Intelligence
              </button>
            </div>
          </div>

          <AttackPlanWorkspace
            variant="embedded"
            emptyCopy="No attack plans saved yet — generate one above"
          />
        </div>
      </div>
    </div>
  );
}
