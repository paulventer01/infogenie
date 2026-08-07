"use client";

/**
 * Cross-platform budget arbitrage — Analyse · Rules · History.
 * Mounted under Budget Hub (and deep-link /manage/budget-arbitrage).
 * API family: /api/budget/arbitrage/*
 */

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

type SubTab = "analyse" | "rules" | "history";

interface PlatformRow {
  platform: string;
  budget: string;
  roas: string;
  cpa: string;
  cvr: string;
}

interface PlatformAnalysis {
  platform: string;
  current_budget: number;
  recommended_budget: number;
  shift_amount: number;
  shift_direction: string;
  reason?: string;
  roas_efficiency?: string;
}

interface Analysis {
  platform_analysis?: PlatformAnalysis[];
  total_shifted?: number;
  projected_roas_uplift_pct?: number;
  rationale?: string;
  urgency?: string;
  risk_level?: string;
}

interface Rule {
  id: number;
  name: string;
  platforms: string;
  total_daily_budget: number;
  max_shift_pct: number;
  reallocation_logic: string;
}

interface HistoryRow {
  id: number;
  rule_name?: string;
  total_shifted?: number;
  projected_roas_uplift?: number;
  is_executed?: boolean;
  created_at?: string;
}

const PLATFORMS = ["meta", "google", "tiktok"] as const;

function emptyRows(): PlatformRow[] {
  return PLATFORMS.map((p) => ({ platform: p, budget: "", roas: "", cpa: "", cvr: "" }));
}

export default function BudgetArbitrage({ embedded = false }: { embedded?: boolean } = {}) {
  const [sub, setSub] = useState<SubTab>("analyse");
  const [rows, setRows] = useState<PlatformRow[]>(emptyRows);
  const [maxShift, setMaxShift] = useState("30");
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [applied, setApplied] = useState(false);
  const [err, setErr] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const loadRules = useCallback(async () => {
    const r = await apiGet<{ ok?: boolean; rules?: Rule[]; error?: string }>("/api/budget/arbitrage/rules");
    if (r?.rules) setRules(r.rules);
  }, []);

  const loadHistory = useCallback(async () => {
    const r = await apiGet<{ ok?: boolean; history?: HistoryRow[] }>("/api/budget/arbitrage/history");
    if (r?.history) setHistory(r.history);
  }, []);

  useEffect(() => {
    if (sub === "rules") void loadRules();
    if (sub === "history") void loadHistory();
  }, [sub, loadRules, loadHistory]);

  function updateRow(platform: string, field: keyof PlatformRow, value: string) {
    setRows((prev) => prev.map((r) => (r.platform === platform ? { ...r, [field]: value } : r)));
  }

  async function analyse() {
    setBusy(true);
    setErr("");
    setAnalysis(null);
    setApplied(false);
    setHistoryId(null);
    const metrics = rows
      .map((r) => ({
        platform: r.platform,
        current_budget: Number(r.budget) || 0,
        roas: Number(r.roas) || 0,
        cpa: Number(r.cpa) || 0,
        cvr: Number(r.cvr) || 0,
      }))
      .filter((m) => m.current_budget > 0);
    if (!metrics.length) {
      setErr("Enter at least one platform daily budget.");
      setBusy(false);
      return;
    }
    const r = await apiPost<{ ok?: boolean; error?: string; analysis?: Analysis; history_id?: number }>(
      "/api/budget/arbitrage/analyse",
      { platform_metrics: metrics, max_shift_pct: Number(maxShift) || 30 },
    );
    setBusy(false);
    if (!r?.ok || !r.analysis) {
      setErr(r?.error || "Analyse failed");
      return;
    }
    setAnalysis(r.analysis);
    setHistoryId(r.history_id ?? null);
  }

  async function applyShifts() {
    if (!historyId) return;
    const r = await apiPost<{ ok?: boolean }>(`/api/budget/arbitrage/execute/${historyId}`, {});
    if (r?.ok) {
      setApplied(true);
      showToast("Shifts applied");
    } else {
      showToast("Could not apply shifts");
    }
  }

  async function createRule() {
    const name = typeof window !== "undefined" ? window.prompt("Rule name:") : null;
    if (!name) return;
    const budgetRaw = typeof window !== "undefined" ? window.prompt("Total daily budget ($):") : null;
    const budget = Number(budgetRaw);
    if (!budget) return;
    const r = await apiPost<{ ok?: boolean }>("/api/budget/arbitrage/rules", {
      name,
      platforms: "meta,google,tiktok",
      total_daily_budget: budget,
    });
    if (r?.ok) {
      showToast("Rule created");
      void loadRules();
    }
  }

  async function deleteRule(id: number) {
    await apiDelete(`/api/budget/arbitrage/rules/${id}`);
    void loadRules();
  }

  const card: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #E2E8F0",
    borderRadius: 14,
    padding: "18px 20px",
    marginBottom: 16,
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #CBD5E1",
    borderRadius: 8,
    fontSize: 13,
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        minHeight: embedded ? "auto" : "100vh",
        background: embedded ? "transparent" : "linear-gradient(180deg,#ECFDF5 0%,#F8FAFC 45%)",
        padding: embedded ? "8px 24px 32px" : "24px 28px",
      }}
    >
      {toast ? (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            background: "#ecfdf5",
            color: "#065f46",
            borderRadius: 10,
            padding: "10px 16px",
            fontWeight: 600,
            fontSize: 13,
            zIndex: 9999,
          }}
        >
          {toast}
        </div>
      ) : null}

      {!embedded ? (
        <div style={{ marginBottom: 18, maxWidth: 1100, marginLeft: "auto", marginRight: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0F766E" }}>
            Manage · Budget Hub
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: 26, fontWeight: 800, color: "#0F172A" }}>
            Cross-Platform Arbitrage
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748B", maxWidth: 720 }}>
            Shift daily budgets toward higher-ROAS platforms within a max-shift guardrail.
          </p>
        </div>
      ) : (
        <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: "#0F766E" }}>
          Reallocate spend across Meta · Google · TikTok
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #E2E8F0", marginBottom: 18 }}>
          {(
            [
              ["analyse", "Analyse & Shift"],
              ["rules", "Allocation Rules"],
              ["history", "History"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSub(id)}
              style={{
                padding: "10px 14px",
                marginBottom: -2,
                border: "none",
                borderBottom: sub === id ? "3px solid #0F766E" : "3px solid transparent",
                background: "transparent",
                color: sub === id ? "#0F766E" : "#64748B",
                fontWeight: sub === id ? 800 : 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {sub === "analyse" ? (
          <div style={card}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#0F172A" }}>Live platform metrics</h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748B" }}>
              Enter current spend and performance. AI recommends reallocations within your max shift.
            </p>
            {rows.map((r) => (
              <div
                key={r.platform}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 1fr 1fr 1fr 1fr",
                  gap: 10,
                  marginBottom: 10,
                  alignItems: "end",
                }}
              >
                <strong style={{ textTransform: "capitalize", color: "#0F172A", paddingBottom: 8 }}>{r.platform}</strong>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>
                  Daily budget ($)
                  <input style={input} type="number" value={r.budget} onChange={(e) => updateRow(r.platform, "budget", e.target.value)} />
                </label>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>
                  ROAS
                  <input style={input} type="number" step="0.1" value={r.roas} onChange={(e) => updateRow(r.platform, "roas", e.target.value)} />
                </label>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>
                  CPA ($)
                  <input style={input} type="number" value={r.cpa} onChange={(e) => updateRow(r.platform, "cpa", e.target.value)} />
                </label>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>
                  CVR (%)
                  <input style={input} type="number" step="0.1" value={r.cvr} onChange={(e) => updateRow(r.platform, "cvr", e.target.value)} />
                </label>
              </div>
            ))}
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", maxWidth: 220, marginBottom: 14 }}>
              Max shift per platform (%)
              <input style={input} type="number" min={5} max={80} value={maxShift} onChange={(e) => setMaxShift(e.target.value)} />
            </label>
            <button
              type="button"
              onClick={() => void analyse()}
              disabled={busy}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "#0F766E",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Analysing…" : "Analyse & Recommend"}
            </button>
            {err ? <p style={{ color: "#B91C1C", marginTop: 12 }}>{err}</p> : null}

            {analysis ? (
              <div style={{ marginTop: 20, borderTop: "1px solid #E2E8F0", paddingTop: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 12 }}>
                  {[
                    ["$" + Number(analysis.total_shifted || 0).toFixed(0), "Total shifted"],
                    ["+" + (analysis.projected_roas_uplift_pct || 0) + "%", "Projected ROAS uplift"],
                    [analysis.urgency || "—", "Urgency"],
                    [analysis.risk_level || "—", "Risk"],
                  ].map(([v, l]) => (
                    <div key={l} style={{ background: "#F0FDFA", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontWeight: 800, fontSize: 18, color: "#0F766E" }}>{v}</div>
                      <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>{l}</div>
                    </div>
                  ))}
                </div>
                {analysis.rationale ? <p style={{ fontSize: 13, color: "#334155" }}>{analysis.rationale}</p> : null}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#64748B" }}>
                        {["Platform", "Current", "Recommended", "Shift", "Direction", "Reason"].map((h) => (
                          <th key={h} style={{ padding: "8px 6px", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(analysis.platform_analysis || []).map((p) => (
                        <tr key={p.platform}>
                          <td style={{ padding: "8px 6px", fontWeight: 700, textTransform: "capitalize" }}>{p.platform}</td>
                          <td style={{ padding: "8px 6px" }}>${p.current_budget}</td>
                          <td style={{ padding: "8px 6px" }}>${Number(p.recommended_budget || 0).toFixed(0)}</td>
                          <td
                            style={{
                              padding: "8px 6px",
                              color: p.shift_amount > 0 ? "#059669" : p.shift_amount < 0 ? "#DC2626" : "#64748B",
                              fontWeight: 700,
                            }}
                          >
                            ${Math.abs(p.shift_amount || 0).toFixed(0)}
                          </td>
                          <td style={{ padding: "8px 6px" }}>{p.shift_direction}</td>
                          <td style={{ padding: "8px 6px", color: "#64748B" }}>{p.reason || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {historyId ? (
                  <button
                    type="button"
                    disabled={applied}
                    onClick={() => void applyShifts()}
                    style={{
                      marginTop: 14,
                      padding: "10px 16px",
                      borderRadius: 10,
                      border: "none",
                      background: applied ? "#94A3B8" : "#059669",
                      color: "#fff",
                      fontWeight: 700,
                      cursor: applied ? "default" : "pointer",
                    }}
                  >
                    {applied ? "Applied" : "Apply these shifts"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {sub === "rules" ? (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Allocation rules</h3>
              <button
                type="button"
                onClick={() => void createRule()}
                style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#0F766E", color: "#fff", fontWeight: 700, cursor: "pointer" }}
              >
                + New rule
              </button>
            </div>
            {!rules.length ? (
              <p style={{ color: "#94A3B8", fontSize: 13 }}>No allocation rules yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#64748B" }}>
                    {["Name", "Platforms", "Budget", "Logic", "Max shift", ""].map((h) => (
                      <th key={h || "x"} style={{ padding: "8px 6px", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: "8px 6px", fontWeight: 700 }}>{r.name}</td>
                      <td style={{ padding: "8px 6px" }}>{r.platforms}</td>
                      <td style={{ padding: "8px 6px" }}>${r.total_daily_budget}/day</td>
                      <td style={{ padding: "8px 6px" }}>{r.reallocation_logic}</td>
                      <td style={{ padding: "8px 6px" }}>{r.max_shift_pct}%</td>
                      <td style={{ padding: "8px 6px" }}>
                        <button type="button" onClick={() => void deleteRule(r.id)} style={{ border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {sub === "history" ? (
          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Analysis history</h3>
            {!history.length ? (
              <p style={{ color: "#94A3B8", fontSize: 13 }}>No analysis history yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#64748B" }}>
                    {["Rule", "Shifted", "ROAS uplift", "Executed", "Date"].map((h) => (
                      <th key={h} style={{ padding: "8px 6px", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td style={{ padding: "8px 6px" }}>{h.rule_name || "Ad-hoc"}</td>
                      <td style={{ padding: "8px 6px" }}>${h.total_shifted || 0}</td>
                      <td style={{ padding: "8px 6px" }}>+{h.projected_roas_uplift || 0}%</td>
                      <td style={{ padding: "8px 6px" }}>{h.is_executed ? "Yes" : "—"}</td>
                      <td style={{ padding: "8px 6px", color: "#64748B" }}>
                        {h.created_at ? new Date(h.created_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
