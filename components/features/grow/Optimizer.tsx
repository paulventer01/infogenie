"use client";

// Native React port of the legacy `optimizer` panel (was
// `renderOptimizerDashboard` in public/js/ig_mentions_gaps.js + `#view-optimizer`
// / `#optimizerWrap` in index.html). Shows live optimizer status, tracked
// campaigns and the decisions log from the existing Express API:
//   GET  /api/optimizer/status
//   GET  /api/optimizer/campaigns
//   GET  /api/optimizer/actions?limit=50
//   POST /api/optimizer/enable      { id, enabled }
//   POST /api/optimizer/target      { id, target_roas }
//   POST /api/optimizer/dry-run     { dryRun }
//   POST /api/optimizer/run-now
//   DELETE /api/optimizer/campaigns/:id
// Cross-tool links use lib/nav.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface StatusResponse {
  ok?: boolean;
  error?: string;
  dryRun?: boolean;
  campaigns?: { n?: number; enabled?: number };
  actionsLast24h?: number;
  platforms: { meta?: boolean; google?: boolean; tiktok?: boolean };
}
interface Perf7d {
  spend?: number | string;
  revenue?: number | string;
}
interface Campaign {
  id: number;
  name: string;
  platform: string;
  perf7d?: Perf7d;
  target_roas: number | string;
  daily_budget?: number | string;
  optimizer_enabled?: boolean;
}
interface ActionItem {
  action_type: string;
  campaign_name?: string;
  platform?: string;
  applied?: boolean;
  reason?: string;
  apply_error?: string;
  created_at: string;
}

function toast(msg: string) {
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}

export default function Optimizer() {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [camps, setCamps] = useState<Campaign[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [errMsg, setErrMsg] = useState("");

  const load = useCallback(async () => {
    setLoadState("loading");
    const [statusR, campsR, actionsR] = await Promise.all([
      apiGet<StatusResponse>("/api/optimizer/status"),
      apiGet<{ ok?: boolean; campaigns?: Campaign[] }>("/api/optimizer/campaigns"),
      apiGet<{ ok?: boolean; actions?: ActionItem[] }>("/api/optimizer/actions?limit=50"),
    ]);
    if (!statusR.ok) {
      setErrMsg(statusR.error || "Database not configured.");
      setLoadState("error");
      return;
    }
    setStatus(statusR);
    setCamps(campsR.campaigns || []);
    setActions(actionsR.actions || []);
    setLoadState("ready");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onToggle = async (id: number, enabled: boolean) => {
    await apiPost("/api/optimizer/enable", { id, enabled });
    toast(enabled ? "✅ Optimizer enabled for this campaign" : "⏸ Optimizer disabled");
    load();
  };
  const onSetTarget = async (id: number, target_roas: string) => {
    await apiPost("/api/optimizer/target", { id, target_roas: parseFloat(target_roas) });
    toast("✅ Target ROAS updated");
  };
  const onToggleDryRun = async (toLive: boolean) => {
    if (toLive && !window.confirm("Switch to LIVE mode? The optimizer will start calling Meta/Google/TikTok APIs to PAUSE campaigns and CHANGE BUDGETS based on its rules. This affects real ad spend.")) return;
    await apiPost("/api/optimizer/dry-run", { dryRun: !toLive });
    toast(toLive ? "⚡ Optimizer is now LIVE" : "🛑 Optimizer back in dry-run");
    load();
  };
  const onRunNow = async () => {
    toast("⏳ Running optimizer — may take a few seconds…");
    const r = await apiPost<{ ok?: boolean; optimizer?: { evaluated?: number } }>("/api/optimizer/run-now");
    toast(`✅ Done — evaluated ${r.optimizer?.evaluated || 0} campaign(s)`);
    load();
  };
  const onDelete = async (id: number, name: string) => {
    if (!window.confirm(`Stop tracking "${name}"? This removes it from the optimizer (does not affect the platform).`)) return;
    await apiDelete(`/api/optimizer/campaigns/${id}`);
    toast("🗑 Removed from optimizer");
    load();
  };

  const platChip = (n: string, on?: boolean) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 14, fontSize: "0.74rem", fontWeight: 700, background: on ? "#D1FAE5" : "#F3F4F6", color: on ? "#065F46" : "#6B7280" }}>
      {on ? "●" : "○"} {n}
    </span>
  );

  return (
    <div>
      <div className="intel-header" style={{ background: "linear-gradient(110deg,#0F172A 0%,#1E40AF 50%,#0066FF 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Grow</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> AI Optimizer
        </div>
        <h1 className="ih-title">🤖 AI Campaign Optimizer</h1>
        <p className="ih-sub">
          Continuously monitors your live ad campaigns, pauses underperformers, and reallocates budget to winners. Decisions logged below — turn on apply mode when you&apos;re ready to let the AI act on your accounts.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1240, margin: "0 auto" }}>
        {loadState === "loading" && (
          <div style={{ textAlign: "center", padding: 60, color: "#6B7280" }}>Loading optimizer status…</div>
        )}
        {loadState === "error" && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", padding: 18, borderRadius: 12 }}>
            <strong>Optimizer unavailable.</strong> {errMsg}
          </div>
        )}
        {loadState === "ready" && status && (
          <>
            {/* Status strip */}
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 22px", marginBottom: 18, display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Mode</div>
                  <div style={{ marginTop: 4 }}>
                    {status.dryRun ? (
                      <span style={{ background: "#FEF3C7", color: "#92400E", padding: "4px 11px", borderRadius: 14, fontSize: "0.72rem", fontWeight: 700 }}>DRY-RUN — logging only</span>
                    ) : (
                      <span style={{ background: "#D1FAE5", color: "#065F46", padding: "4px 11px", borderRadius: 14, fontSize: "0.72rem", fontWeight: 700 }}>LIVE — applying to ad platforms</span>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Tracked</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#0A1628", marginTop: 2 }}>{status.campaigns?.n || 0}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Optimizer ON</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#0A1628", marginTop: 2 }}>{status.campaigns?.enabled || 0}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Decisions 24h</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#0A1628", marginTop: 2 }}>{status.actionsLast24h || 0}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Platforms</div>
                  <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
                    {platChip("Meta", status.platforms.meta)}
                    {platChip("Google", status.platforms.google)}
                    {platChip("TikTok", status.platforms.tiktok)}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => onToggleDryRun(!!status.dryRun)} style={{ padding: "9px 16px", background: status.dryRun ? "linear-gradient(135deg,#10B981,#059669)" : "#FFFFFF", color: status.dryRun ? "white" : "#374151", border: `1px solid ${status.dryRun ? "transparent" : "#D1D5DB"}`, borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
                  {status.dryRun ? "⚡ Switch to LIVE" : "🛑 Back to dry-run"}
                </button>
                <button onClick={onRunNow} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "white", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
                  ▶ Run optimizer now
                </button>
              </div>
            </div>

            {/* Tracked campaigns */}
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 22px", marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 14px", fontSize: "1.05rem", color: "#0A1628" }}>📡 Tracked Campaigns ({camps.length})</h3>
              {camps.length === 0 ? (
                <div style={{ padding: 36, textAlign: "center", color: "#6B7280", background: "#F9FAFB", borderRadius: 10 }}>
                  No campaigns yet. Launch a campaign from the{" "}
                  <a href="#" onClick={(e) => { e.preventDefault(); goToView(router, "campaigns"); }} style={{ color: "#0066FF", fontWeight: 600 }}>Create</a>{" "}
                  page (with Meta/Google/TikTok credentials connected) and it will appear here automatically.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #E5E7EB", color: "#6B7280", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
                        <th style={{ textAlign: "left", padding: "10px 8px" }}>Campaign</th>
                        <th style={{ textAlign: "left", padding: "10px 8px" }}>Platform</th>
                        <th style={{ textAlign: "right", padding: "10px 8px" }}>7d Spend</th>
                        <th style={{ textAlign: "right", padding: "10px 8px" }}>7d ROAS</th>
                        <th style={{ textAlign: "right", padding: "10px 8px" }}>Target ROAS</th>
                        <th style={{ textAlign: "right", padding: "10px 8px" }}>Daily Budget</th>
                        <th style={{ textAlign: "center", padding: "10px 8px" }}>Optimizer</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {camps.map((c) => {
                        const p = c.perf7d || {};
                        const spend = parseFloat(String(p.spend || 0));
                        const rev = parseFloat(String(p.revenue || 0));
                        const roas = spend > 0 ? (rev / spend).toFixed(2) : "—";
                        const roasColor = roas !== "—" && parseFloat(roas) >= parseFloat(String(c.target_roas)) ? "#059669" : roas === "—" ? "#9CA3AF" : "#DC2626";
                        return (
                          <tr key={c.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                            <td style={{ padding: "11px 8px", fontWeight: 600, color: "#0A1628" }}>{c.name}</td>
                            <td style={{ padding: "11px 8px", color: "#6B7280", textTransform: "capitalize" }}>{c.platform}</td>
                            <td style={{ padding: "11px 8px", textAlign: "right", color: "#0A1628", fontWeight: 600 }}>${spend.toFixed(2)}</td>
                            <td style={{ padding: "11px 8px", textAlign: "right", fontWeight: 800, color: roasColor }}>{roas}{roas !== "—" ? "×" : ""}</td>
                            <td style={{ padding: "11px 8px", textAlign: "right" }}>
                              <input type="number" step="0.1" defaultValue={String(c.target_roas)} onChange={(e) => onSetTarget(c.id, e.target.value)} style={{ width: 64, padding: "4px 6px", border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", textAlign: "right" }} />×
                            </td>
                            <td style={{ padding: "11px 8px", textAlign: "right", color: "#0A1628" }}>${parseFloat(String(c.daily_budget || 0)).toFixed(2)}</td>
                            <td style={{ padding: "11px 8px", textAlign: "center" }}>
                              <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
                                <input type="checkbox" checked={!!c.optimizer_enabled} onChange={(e) => onToggle(c.id, e.target.checked)} style={{ cursor: "pointer", width: 16, height: 16 }} />
                              </label>
                            </td>
                            <td style={{ padding: "11px 8px", textAlign: "right" }}>
                              <button onClick={() => onDelete(c.id, c.name)} title="Stop tracking" style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: "0.95rem" }}>🗑</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Decisions log */}
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 22px" }}>
              <h3 style={{ margin: "0 0 14px", fontSize: "1.05rem", color: "#0A1628" }}>📜 Optimizer Decisions Log</h3>
              {actions.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "#6B7280", background: "#F9FAFB", borderRadius: 10 }}>
                  No decisions yet. The optimizer runs every 6 hours, or click &quot;Run optimizer now&quot; above.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {actions.map((a, i) => {
                    const color = a.action_type === "pause" ? "#DC2626" : a.action_type === "scale_budget" ? "#059669" : a.action_type === "hold" ? "#6B7280" : "#F59E0B";
                    const icon = a.action_type === "pause" ? "⏸" : a.action_type === "scale_budget" ? "📈" : a.action_type === "hold" ? "✓" : "⚠";
                    const when = new Date(a.created_at).toLocaleString();
                    return (
                      <div key={i} style={{ display: "flex", gap: 12, padding: "11px 14px", borderLeft: `3px solid ${color}`, background: "#FAFBFC", borderRadius: 6 }}>
                        <div style={{ fontSize: "1.2rem" }}>{icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "0.82rem", color: "#0A1628" }}>
                            <strong>{a.action_type.replace(/_/g, " ")}</strong> · {a.campaign_name || "?"}{" "}
                            <span style={{ color: "#6B7280", fontSize: "0.74rem" }}>({a.platform || "?"})</span>
                            {a.applied ? (
                              <span style={{ color: "#059669", fontSize: "0.7rem", fontWeight: 700, marginLeft: 8 }}>APPLIED</span>
                            ) : (
                              <span style={{ color: "#92400E", fontSize: "0.7rem", fontWeight: 700, marginLeft: 8 }}>LOGGED</span>
                            )}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "#4B5563", marginTop: 3 }}>{a.reason || ""}</div>
                          {a.apply_error && <div style={{ fontSize: "0.74rem", color: "#DC2626", marginTop: 3 }}>⚠ {a.apply_error}</div>}
                          <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 4 }}>{when}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
