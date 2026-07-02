"use client";

// Ad Comment Monitor — scans active Meta ad posts for comments, analyses
// sentiment with AI, and surfaces negative comments as actionable alerts.
// Requires META_ACCESS_TOKEN + META_AD_ACCOUNT_ID to be configured.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Alert {
  id: string;
  platform: string;
  ad_name: string;
  comment_text: string;
  author: string;
  sentiment: "positive" | "neutral" | "negative";
  actioned: boolean;
  actioned_note: string;
  detected_at: string;
}

interface AlertsResp {
  ok: boolean;
  alerts?: Alert[];
  summary?: { positive: number; neutral: number; negative: number };
  error?: string;
}
interface ScanResp { ok: boolean; scanned?: number; new_alerts?: number; message?: string; error?: string; }
interface ActionResp { ok: boolean; error?: string; }

const SENT_META: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  positive: { icon: "😊", color: "#15803d", bg: "#dcfce7", label: "Positive" },
  neutral:  { icon: "😐", color: "#475569", bg: "#f1f5f9", label: "Neutral"  },
  negative: { icon: "😠", color: "#b91c1c", bg: "#fee2e2", label: "Negative" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdCommentMonitor() {
  const [alerts, setAlerts]     = useState<Alert[]>([]);
  const [summary, setSummary]   = useState<AlertsResp["summary"]>();
  const [loading, setLoading]   = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter]     = useState<"all" | "negative" | "positive" | "neutral">("all");
  const [showActioned, setShowActioned] = useState(false);
  const [noteInputs, setNoteInputs]     = useState<Record<string, string>>({});
  const [scanResult, setScanResult]     = useState<ScanResp | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("sentiment", filter);
    if (!showActioned) params.set("actioned", "false");
    const r = await apiGet<AlertsResp>(`/api/ad-comments/alerts?${params}`);
    setAlerts(r.ok && r.alerts ? r.alerts : []);
    if (r.ok && r.summary) setSummary(r.summary);
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter, showActioned]);

  async function scan() {
    setScanning(true);
    setScanResult(null);
    const r = await apiPost<ScanResp>("/api/ad-comments/scan", {});
    setScanning(false);
    setScanResult(r);
    if (r.ok) load();
  }

  async function markActioned(id: string) {
    const note = noteInputs[id] || "";
    await apiPost<ActionResp>(`/api/ad-comments/${id}/action`, { note });
    load();
  }

  const negCount = summary?.negative ?? 0;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Ad Comment Monitor
              </div>
              <h2 className="view-title">💬 Ad Comment Monitor</h2>
              <p className="view-sub">
                Scans your active Meta (Facebook & Instagram) ad posts for
                comments, uses AI to classify sentiment, and flags negative
                comments that need your attention.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>

        {/* Controls */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
          <button
            className="btn btn-primary"
            onClick={scan}
            disabled={scanning}
          >
            {scanning ? "⏳ Scanning ads…" : "🔍 Scan ad comments now"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.84rem", color: "#64748b", cursor: "pointer" }}>
            <input type="checkbox" checked={showActioned} onChange={e => setShowActioned(e.target.checked)} />
            Show actioned
          </label>
        </div>

        {/* Scan result banner */}
        {scanResult && (
          <div style={{
            background: scanResult.ok ? "#f0fdf4" : "#fee2e2",
            border: `1px solid ${scanResult.ok ? "#bbf7d0" : "#fecaca"}`,
            color: scanResult.ok ? "#15803d" : "#b91c1c",
            borderRadius: 8, padding: "10px 14px", fontSize: "0.86rem", marginBottom: 14,
          }}>
            {scanResult.ok
              ? scanResult.message || `✓ Scanned ${scanResult.scanned} ad post${scanResult.scanned !== 1 ? "s" : ""} — ${scanResult.new_alerts} new alert${scanResult.new_alerts !== 1 ? "s" : ""} detected`
              : `Error: ${scanResult.error}`
            }
          </div>
        )}

        {/* Summary pills */}
        {summary && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            {(["negative", "neutral", "positive"] as const).map(s => {
              const m = SENT_META[s];
              const count = summary[s] ?? 0;
              return (
                <button
                  key={s}
                  onClick={() => setFilter(filter === s ? "all" : s)}
                  style={{
                    background: filter === s ? m.bg : "#fff",
                    color: m.color,
                    border: `1.5px solid ${filter === s ? m.color : "#e2e8f0"}`,
                    borderRadius: 20, padding: "6px 16px", fontSize: "0.83rem",
                    fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {m.icon} {count} {m.label}
                  {s === "negative" && count > 0 && " ⚠"}
                </button>
              );
            })}
            <button
              onClick={() => setFilter("all")}
              style={{
                background: filter === "all" ? "#eff6ff" : "#fff",
                color: "#1d4ed8",
                border: `1.5px solid ${filter === "all" ? "#bfdbfe" : "#e2e8f0"}`,
                borderRadius: 20, padding: "6px 16px", fontSize: "0.83rem",
                fontWeight: 700, cursor: "pointer",
              }}
            >
              All
            </button>
          </div>
        )}

        {negCount > 0 && !showActioned && filter === "all" && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: "0.86rem", color: "#b91c1c", fontWeight: 600, marginBottom: 14 }}>
            ⚠ {negCount} unactioned negative comment{negCount !== 1 ? "s" : ""} need your attention
          </div>
        )}

        {/* Alerts list */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading comments…</div>
          ) : alerts.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              <div style={{ fontSize: "2rem", marginBottom: 10 }}>💬</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No comments found</div>
              <div style={{ fontSize: "0.85rem" }}>
                Click <strong>Scan ad comments now</strong> to fetch comments from your active Meta ads.
                <br />
                Requires <code>META_ACCESS_TOKEN</code> and <code>META_AD_ACCOUNT_ID</code> to be configured.
              </div>
            </div>
          ) : (
            alerts.map((alert, i) => {
              const m = SENT_META[alert.sentiment] || SENT_META.neutral;
              return (
                <div
                  key={alert.id}
                  style={{
                    padding: "14px 18px",
                    borderBottom: i < alerts.length - 1 ? "1px solid #f1f5f9" : undefined,
                    display: "flex",
                    gap: 14,
                    alignItems: "flex-start",
                    opacity: alert.actioned ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontSize: "1.5rem", lineHeight: 1, paddingTop: 2, flexShrink: 0 }}>{m.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ background: m.bg, color: m.color, borderRadius: 10, padding: "2px 8px", fontSize: "0.74rem", fontWeight: 700 }}>
                        {m.label}
                      </span>
                      <span style={{ color: "#64748b", fontSize: "0.77rem" }}>
                        on <strong>{alert.ad_name || "ad"}</strong>
                      </span>
                      <span style={{ color: "#94a3b8", fontSize: "0.74rem", marginLeft: "auto" }}>
                        {timeAgo(alert.detected_at)}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: 2 }}>
                      {alert.author}
                    </div>
                    <div style={{ color: "#334155", fontSize: "0.87rem", marginBottom: alert.actioned ? 0 : 10 }}>
                      &ldquo;{alert.comment_text}&rdquo;
                    </div>
                    {alert.actioned && alert.actioned_note && (
                      <div style={{ color: "#64748b", fontSize: "0.78rem", fontStyle: "italic" }}>
                        Note: {alert.actioned_note}
                      </div>
                    )}
                    {!alert.actioned && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          className="form-control"
                          style={{ flex: 1, minWidth: 140, maxWidth: 280, fontSize: "0.82rem", padding: "5px 9px" }}
                          placeholder="Add a note (optional)"
                          value={noteInputs[alert.id] || ""}
                          onChange={e => setNoteInputs(prev => ({ ...prev, [alert.id]: e.target.value }))}
                        />
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => markActioned(alert.id)}
                          style={{ fontSize: "0.8rem" }}
                        >
                          ✓ Mark actioned
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
