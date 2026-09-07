"use client";

// Native React port of the legacy `auto-operator` panel (was
// `window.buildAutooperator` in public/js/ig_advanced_features.js + the empty
// `#view-auto-operator` div in index.html). Lets you deploy the Autonomous
// Marketing Operator and reviews what it did, via the existing Express API:
//   POST /api/auto-operator/run   { trigger, current_roas, target_roas, current_cac,
//                                   target_cac, daily_spend, budget_remaining, issues[] }
//   GET  /api/auto-operator/runs
// Reuses legacy CSS classes (ig-card, form-grid, form-group, form-control, btn).

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface AOAction {
  action?: string;
  detail?: string;
  target?: string;
  expected_impact?: string;
  status?: string;
}
interface AdCopy {
  headline?: string;
  body?: string;
  cta?: string;
}
interface BudgetRealloc {
  from?: string;
  to?: string;
  amount?: string | number;
  reason?: string;
}
interface ABTest {
  hypothesis?: string;
  variant_a?: string;
  variant_b?: string;
}
interface AOResult {
  severity?: string;
  summary?: string;
  diagnosis?: string;
  next_review?: string;
  actions_taken?: AOAction[];
  new_ad_copy?: AdCopy;
  budget_reallocation?: BudgetRealloc;
  ab_test_proposed?: ABTest;
}
interface AORun extends AOResult {
  trigger?: string;
  created_at: string;
}
interface RunResponse {
  ok?: boolean;
  error?: string;
  result?: AOResult;
}
interface RunsResponse {
  ok?: boolean;
  runs?: AORun[];
}

const SEV_COL: Record<string, string> = {
  low: "#10b981", medium: "#f59e0b", high: "#ef4444", critical: "#7f1d1d",
};
const ACTION_ICON: Record<string, string> = {
  rewrite_ad: "✏️", pause_campaign: "⏸️", scale_campaign: "📈", reallocate_budget: "💸",
  launch_ab_test: "🧪", update_landing_page: "🔧", send_alert: "🔔", adjust_bid: "⚙️",
};

function threatBadge(level: string) {
  const bg = SEV_COL[level] || "#6b7280";
  return (
    <span style={{ background: bg, color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase" }}>{level}</span>
  );
}

function ResultCard({ r }: { r: AOResult }) {
  return (
    <div className="ig-card" style={{ borderLeft: `4px solid ${SEV_COL[r.severity || "medium"]}`, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>{r.summary || "Operator completed"}</div>
          <div style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: 2 }}>{r.diagnosis || ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {threatBadge(r.severity || "medium")}
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>Review in {r.next_review || "24 hours"}</span>
        </div>
      </div>

      <h4 style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 10 }}>Actions Taken</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {(r.actions_taken || []).map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: 10, background: "#f9fafb", borderRadius: 8, alignItems: "flex-start" }}>
            <div style={{ fontSize: "1.3rem" }}>{ACTION_ICON[a.action || ""] || "⚙️"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{(a.action || "").replace(/_/g, " ").toUpperCase()}</div>
              <div style={{ fontSize: "0.85rem", color: "#374151" }}>{a.detail || ""}</div>
              <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{a.target || ""} — {a.expected_impact || ""}</div>
            </div>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: a.status === "completed" ? "#d1fae5" : "#fef3c7", color: a.status === "completed" ? "#065f46" : "#92400e" }}>{a.status || ""}</span>
          </div>
        ))}
      </div>

      {r.new_ad_copy?.headline && (
        <div style={{ background: "#faf5ff", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#0284c7", marginBottom: 8 }}>✏️ REWRITTEN AD COPY</div>
          <div><span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Headline: </span><strong>{r.new_ad_copy.headline}</strong></div>
          <div style={{ fontSize: "0.85rem", color: "#374151", margin: "4px 0" }}>{r.new_ad_copy.body || ""}</div>
          <div><span style={{ fontSize: "0.75rem", color: "#6b7280" }}>CTA: </span><strong>{r.new_ad_copy.cta || ""}</strong></div>
        </div>
      )}

      {r.budget_reallocation?.from && (
        <div style={{ background: "#eff6ff", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#3b82f6", marginBottom: 8 }}>💸 BUDGET REALLOCATION</div>
          <div style={{ fontSize: "0.85rem" }}>From <strong>{r.budget_reallocation.from}</strong> → <strong>{r.budget_reallocation.to}</strong> · {r.budget_reallocation.amount}</div>
          <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: 4 }}>{r.budget_reallocation.reason || ""}</div>
        </div>
      )}

      {r.ab_test_proposed?.hypothesis && (
        <div style={{ background: "#f0fdf4", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#10b981", marginBottom: 8 }}>🧪 A/B TEST LAUNCHED</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: "0.85rem" }}>
            <div><div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 3 }}>VARIANT A (control)</div>{r.ab_test_proposed.variant_a || ""}</div>
            <div><div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 3 }}>VARIANT B (challenger)</div>{r.ab_test_proposed.variant_b || ""}</div>
          </div>
          <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: 8 }}>Hypothesis: {r.ab_test_proposed.hypothesis}</div>
        </div>
      )}
    </div>
  );
}

const num = (v: string): number | null => {
  const n = parseFloat(v);
  return v.trim() !== "" && !Number.isNaN(n) ? n : null;
};

export default function AutoOperator() {
  const [roas, setRoas] = useState("");
  const [troas, setTroas] = useState("2.5");
  const [cac, setCac] = useState("");
  const [tcac, setTcac] = useState("");
  const [spend, setSpend] = useState("");
  const [budget, setBudget] = useState("");
  const [issues, setIssues] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AOResult | null>(null);
  const [runs, setRuns] = useState<AORun[]>([]);

  const loadHistory = useCallback(async () => {
    const d = await apiGet<RunsResponse>("/api/auto-operator/runs");
    if (d.ok && d.runs?.length) setRuns(d.runs);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const run = async () => {
    setRunning(true);
    const d = await apiPost<RunResponse>("/api/auto-operator/run", {
      trigger: "manual",
      current_roas: num(roas),
      target_roas: num(troas) ?? 2.5,
      current_cac: num(cac),
      target_cac: num(tcac),
      daily_spend: num(spend),
      budget_remaining: num(budget),
      issues: issues.split("\n").filter(Boolean),
    });
    setRunning(false);
    if (!d.ok) {
      window.alert(d.error || "Error");
      return;
    }
    setResult(d.result || null);
    loadHistory();
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> Autonomous Marketing Operator
              </div>
              <h2 className="view-title">🦾 Autonomous Marketing Operator</h2>
              <p className="view-sub">
                The AI that doesn&apos;t say &quot;here&apos;s the data&quot; — it says &quot;I already fixed it.&quot; Detects problems and acts without waiting for you.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div className="ig-card" style={{ flex: 1, minWidth: 300 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Run Operator</h3>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="form-group"><label>Current ROAS</label><input className="form-control" type="number" step="0.1" placeholder="1.8" value={roas} onChange={(e) => setRoas(e.target.value)} /></div>
              <div className="form-group"><label>Target ROAS</label><input className="form-control" type="number" step="0.1" value={troas} onChange={(e) => setTroas(e.target.value)} /></div>
              <div className="form-group"><label>Current CAC</label><input className="form-control" type="number" placeholder="320" value={cac} onChange={(e) => setCac(e.target.value)} /></div>
              <div className="form-group"><label>Target CAC</label><input className="form-control" type="number" placeholder="250" value={tcac} onChange={(e) => setTcac(e.target.value)} /></div>
              <div className="form-group"><label>Daily Spend</label><input className="form-control" type="number" placeholder="1200" value={spend} onChange={(e) => setSpend(e.target.value)} /></div>
              <div className="form-group"><label>Budget Remaining</label><input className="form-control" type="number" placeholder="18000" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
            </div>
            <div className="form-group">
              <label>Known Issues (one per line)</label>
              <textarea className="form-control" rows={3} placeholder={"ROAS dropping on Meta\nTikTok CPM spiked 40%\nLanding page CVR below 2%"} value={issues} onChange={(e) => setIssues(e.target.value)} />
            </div>
            <button onClick={run} disabled={running} className="btn btn-primary" style={{ width: "100%", background: "linear-gradient(135deg,#0f766e,#3b82f6)" }}>
              {running ? "Operator analysing & acting…" : "🦾 Deploy Operator Now"}
            </button>
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            {runs.length > 0 && (
              <>
                <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Operator Log</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {runs.slice(0, 10).map((r, i) => (
                    <div key={i} className="ig-card" style={{ padding: 10, borderLeft: `3px solid ${SEV_COL[r.actions_taken?.[0]?.status || "medium"] || "#6b7280"}`, cursor: "pointer" }} onClick={() => setResult(r)}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{r.trigger} run</div>
                      <div style={{ fontSize: "0.8rem", color: "#374151", margin: "2px 0" }}>{r.summary || ""}</div>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{new Date(r.created_at).toLocaleDateString()} · {(r.actions_taken || []).length} actions</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div>{result && <ResultCard r={result} />}</div>
      </div>
    </div>
  );
}
