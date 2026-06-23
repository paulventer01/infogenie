"use client";

// Native React port of the legacy `roadmap` panel (was `window.buildRoadmap` +
// `#view-roadmap` in app.js / index.html). Renders the 90-day plan, weekly
// social cadence and five principles against the existing Express API
// (`GET /api/roadmap/catalog`, `GET /api/roadmap/progress`,
// `POST|DELETE /api/roadmap/progress/:id`, `POST /api/roadmap/reset`) via
// `lib/api`. Cross-tool links use `goToView`. See
// `docs/react-panel-migration.md`.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface PlanTask {
  id: string;
  day: number;
  focus: string;
  learn: string;
  action: string;
  view?: string;
  viewLabel?: string;
}
interface CadenceDay {
  day: string;
  task: string;
}
interface CadencePlatform {
  name: string;
  icon: string;
  color: string;
  days: CadenceDay[];
}
interface Principle {
  label: string;
  icon: string;
  body: string;
}
interface CatalogResult {
  ok?: boolean;
  error?: string;
  plan?: PlanTask[];
  socialCadence?: Record<string, CadencePlatform>;
  principles?: Principle[];
}
interface ProgressResult {
  ok?: boolean;
  error?: string;
  completed?: Record<string, string>;
}

type Tab = "plan" | "cadence" | "principles";
type Filter = "ALL" | "SEO" | "SMM" | "PPC";

const FOCUS_COLOR: Record<string, string> = { SEO: "#0891B2", SMM: "#EC4899", PPC: "#7C3AED" };
const PRINCIPLE_LINK: Record<string, { view: string; label: string }> = {
  PLAN: { view: "content-calendar", label: "Open Content Calendar" },
  CREATE: { view: "creative", label: "Open Creative Studio" },
  ENGAGE: { view: "unified-inbox", label: "Open Unified Inbox" },
  ANALYZE: { view: "cross-channel", label: "Open Cross-Channel Report" },
  GROW: { view: "campaigns", label: "Open Campaigns" },
};

export default function Roadmap() {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanTask[]>([]);
  const [cadence, setCadence] = useState<Record<string, CadencePlatform>>({});
  const [principles, setPrinciples] = useState<Principle[]>([]);
  const [completed, setCompleted] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("plan");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState("");
  const [inflight, setInflight] = useState<Set<string>>(new Set());

  async function load() {
    setStatus("loading");
    const [cat, prog] = await Promise.all([
      apiGet<CatalogResult>("/api/roadmap/catalog"),
      apiGet<ProgressResult>("/api/roadmap/progress"),
    ]);
    if (cat.error) {
      setStatus("error");
      setError(cat.error);
      return;
    }
    setPlan(Array.isArray(cat.plan) ? cat.plan : []);
    setCadence(cat.socialCadence || {});
    setPrinciples(Array.isArray(cat.principles) ? cat.principles : []);
    setCompleted(prog.completed || {});
    setStatus("idle");
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(taskId: string, checked: boolean) {
    if (inflight.has(taskId)) return;
    setInflight((s) => new Set(s).add(taskId));
    const path = "/api/roadmap/progress/" + encodeURIComponent(taskId);
    const r = checked ? await apiPost(path) : await apiDelete(path);
    setInflight((s) => {
      const n = new Set(s);
      n.delete(taskId);
      return n;
    });
    if (r.ok === false) {
      alert("⚠️ Could not save: " + (r.error || "unknown error"));
      return;
    }
    setCompleted((c) => {
      const n = { ...c };
      if (checked) n[taskId] = new Date().toISOString();
      else delete n[taskId];
      return n;
    });
  }

  async function reset() {
    if (!confirm("Reset all 90-day progress? This cannot be undone.")) return;
    const r = await apiPost("/api/roadmap/reset");
    if (r.ok === false) {
      alert("⚠️ Could not reset: " + (r.error || "unknown error"));
      return;
    }
    setCompleted({});
  }

  const total = plan.length || 90;
  const done = Object.keys(completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const filteredPlan = filter === "ALL" ? plan : plan.filter((p) => p.focus === filter);

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "10px 18px",
        border: "none",
        background: tab === id ? "#0066FF" : "#E2E8F0",
        color: tab === id ? "white" : "#0F172A",
        fontWeight: 700,
        borderRadius: 10,
        cursor: "pointer",
        marginRight: 8,
      }}
    >
      {label}
    </button>
  );

  const filterBtn = (f: Filter, label: string, color: string) => (
    <button
      onClick={() => setFilter(f)}
      style={{
        padding: "7px 14px",
        border: `1px solid ${filter === f ? color : "#CBD5E1"}`,
        background: filter === f ? color : "white",
        color: filter === f ? "white" : "#475569",
        borderRadius: 999,
        fontSize: "0.78rem",
        fontWeight: 700,
        cursor: "pointer",
        marginRight: 6,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Roadmap
              </div>
              <h2 className="view-title">🗺️ 90-Day Marketing Roadmap</h2>
              <p className="view-sub">
                Stop reading SEO articles. Click each task — InfoGenie does the
                actual work.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {status === "loading" && (
          <div style={{ padding: 48, textAlign: "center", color: "#64748B" }}>⏳ Loading your roadmap…</div>
        )}
        {status === "error" && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14, padding: 24, color: "#991B1B" }}>
            ⚠️ Could not load: {error}
          </div>
        )}
        {status === "idle" && (
          <>
            <div style={{ background: "linear-gradient(135deg,#312E81 0%,#1E293B 50%,#0F172A 100%)", borderRadius: 18, padding: "28px 32px", color: "white", boxShadow: "0 8px 28px rgba(15,23,42,.35)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                <span style={{ fontSize: "1.4rem" }}>🗺️</span>
                <div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff" }}>Your 90-Day Marketing Roadmap</div>
                  <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.85)", marginTop: 2 }}>
                    Click each task — InfoGenie does the actual work.
                  </div>
                </div>
                <button onClick={reset} style={{ marginLeft: "auto", background: "rgba(255,255,255,.1)", color: "white", border: "1px solid rgba(255,255,255,.2)", padding: "8px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
                  ↻ Reset progress
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: "2.4rem", fontWeight: 800, lineHeight: 1, color: "#fff" }}>
                  {done}
                  <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "1.4rem" }}>/{total}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ background: "rgba(255,255,255,.1)", borderRadius: 999, height: 14, overflow: "hidden" }}>
                    <div style={{ background: "linear-gradient(90deg,#34D399,#0066FF)", width: `${pct}%`, height: "100%", transition: "width .4s" }} />
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "rgba(255,255,255,0.85)", marginTop: 6 }}>{pct}% complete</div>
                </div>
              </div>
            </div>

            <div style={{ margin: "24px 0 16px" }}>
              {tabBtn("plan", "📅 90-Day Plan")}
              {tabBtn("cadence", "📲 Weekly Social Cadence")}
              {tabBtn("principles", "🧭 Five Principles")}
            </div>

            {tab === "plan" && (
              <div>
                <div style={{ marginBottom: 14 }}>
                  {filterBtn("ALL", "All 90 days", "#0066FF")}
                  {filterBtn("SEO", "SEO (Days 1-30)", "#0891B2")}
                  {filterBtn("SMM", "Social (Days 31-60)", "#EC4899")}
                  {filterBtn("PPC", "Paid Ads (Days 61-90)", "#7C3AED")}
                </div>
                {filteredPlan.length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", color: "#64748B" }}>No tasks in this filter.</div>
                ) : (
                  filteredPlan.map((p) => {
                    const isDone = !!completed[p.id];
                    const fc = FOCUS_COLOR[p.focus] || "#64748B";
                    return (
                      <div
                        key={p.id}
                        style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px", background: isDone ? "#F0FDF4" : "white", border: `1px solid ${isDone ? "#BBF7D0" : "#E2E8F0"}`, borderRadius: 12, marginBottom: 8 }}
                      >
                        <input type="checkbox" checked={isDone} onChange={(e) => toggle(p.id, e.target.checked)} style={{ width: 20, height: 20, marginTop: 2, cursor: "pointer", accentColor: "#10B981" }} />
                        <div style={{ flex: "0 0 56px", textAlign: "center" }}>
                          <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#94A3B8", letterSpacing: ".5px" }}>DAY</div>
                          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0F172A", lineHeight: 1 }}>{p.day}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ background: fc, color: "white", padding: "2px 8px", borderRadius: 6, fontSize: "0.65rem", fontWeight: 700, letterSpacing: ".5px" }}>{p.focus}</span>
                            <span style={{ fontWeight: 700, color: "#0F172A", textDecoration: isDone ? "line-through" : "none", opacity: isDone ? 0.6 : 1 }}>{p.learn}</span>
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "#475569", opacity: isDone ? 0.6 : 1 }}>{p.action}</div>
                        </div>
                        {p.view && (
                          <button onClick={() => goToView(router, p.view as string)} style={{ flex: "0 0 auto", background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "white", border: "none", padding: "8px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            {p.viewLabel || "Open"} →
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "cadence" && (
              <div>
                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "14px 18px", marginBottom: 18, fontSize: "0.88rem", color: "#1E3A8A" }}>
                  💡 A recommended weekly cadence — balancing reach, engagement and authority. Adjust to fit your bandwidth.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
                  {Object.values(cadence).map((p, pi) => (
                    <div key={pi} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 14, padding: 18, flex: 1, minWidth: 240 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: `linear-gradient(135deg,${p.color},${p.color}99)`, color: "white", padding: "10px 14px", borderRadius: 10, margin: "-18px -18px 12px" }}>
                        <span style={{ fontSize: "1.2rem" }}>{p.icon}</span>
                        <span style={{ fontWeight: 800, letterSpacing: ".5px" }}>{String(p.name).toUpperCase()}</span>
                      </div>
                      {p.days.map((d, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: i === p.days.length - 1 ? "none" : "1px solid #F1F5F9" }}>
                          <span style={{ background: `linear-gradient(135deg,${p.color},${p.color}99)`, color: "white", width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.78rem", marginRight: 12 }}>{d.day[0]}</span>
                          <span style={{ fontSize: "0.88rem", color: "#0F172A" }}>{d.task}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                        <button onClick={() => goToView(router, "social-publisher")} style={{ flex: 1, background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "white", border: "none", padding: "8px 10px", borderRadius: 8, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}>📤 Schedule in Publisher</button>
                        <button onClick={() => goToView(router, "content-calendar")} style={{ flex: 1, background: "#F1F5F9", color: "#0F172A", border: "1px solid #CBD5E1", padding: "8px 10px", borderRadius: 8, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}>📅 Plan in Calendar</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "principles" && (
              <div>
                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px 18px", marginBottom: 18, fontSize: "0.88rem", color: "#475569" }}>
                  The 5 principles every social marketer should drill into muscle memory. Tap each card to jump to the InfoGenie tools that help you live by it.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
                  {principles.map((x, i) => {
                    const link = PRINCIPLE_LINK[x.label];
                    return (
                      <div key={i} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 14, padding: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: "1.6rem" }}>{x.icon}</span>
                          <span style={{ fontWeight: 800, fontSize: "1.05rem", letterSpacing: ".5px" }}>{x.label}</span>
                        </div>
                        <div style={{ fontSize: "0.88rem", color: "#475569", marginBottom: 14, minHeight: 42 }}>{x.body}</div>
                        {link && (
                          <button onClick={() => goToView(router, link.view)} style={{ background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "white", border: "none", padding: "8px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", width: "100%" }}>
                            {link.label} →
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
