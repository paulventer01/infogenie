"use client";

// Native React port of the legacy `change-monitor` panel (was
// `window.buildChangeMonitor` + `#view-change-monitor` in index.html). Watches
// competitor URLs for changes via the existing Express API
// (`/api/change-monitor/*`) through `lib/api`. The legacy diffs modal becomes a
// React state-driven overlay.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Watch {
  id: number;
  url: string;
  label?: string;
  status: string;
  last_changed?: string | null;
  diff_count?: number;
  check_interval_hours?: number;
}
interface WatchesResult {
  ok: boolean;
  error?: string;
  watches?: Watch[];
}
interface Diff {
  detected_at: string;
  diff_summary?: string;
  strategic_insight?: string;
  severity?: string;
  change_type?: string;
}
interface CheckResult {
  ok: boolean;
  error?: string;
  first_check?: boolean;
  changed?: boolean;
  pct_change?: number;
  diff?: Diff;
}
interface DiffsResult {
  ok: boolean;
  error?: string;
  diffs?: Diff[];
}

type CheckState =
  | { type: "loading" }
  | { type: "error"; msg: string }
  | { type: "baseline" }
  | { type: "changed"; diff: Diff }
  | { type: "nochange"; pct: number };

const SEV_COLOR: Record<string, { bg: string; fg: string }> = {
  high: { bg: "#FEE2E2", fg: "#991B1B" },
  medium: { bg: "#FEF3C7", fg: "#92400E" },
  low: { bg: "#D1FAE5", fg: "#065F46" },
};

function Badge({ label, color }: { label: string; color: { bg: string; fg: string } }) {
  return (
    <span
      style={{
        background: color.bg,
        color: color.fg,
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

export default function ChangeMonitor() {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState(true);
  const [slack, setSlack] = useState(false);
  const [interval, setIntervalHrs] = useState("6");

  const [watches, setWatches] = useState<Watch[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "done">("loading");
  const [checks, setChecks] = useState<Record<number, CheckState>>({});
  const [modal, setModal] = useState<{ label: string; diffs: Diff[] } | null>(
    null,
  );

  async function load() {
    setListStatus("loading");
    const d = await apiGet<WatchesResult>("/api/change-monitor/watches");
    setWatches(d.ok ? d.watches || [] : []);
    setListStatus("done");
  }

  useEffect(() => {
    load();
  }, []);

  async function addWatch() {
    const u = url.trim();
    if (!u) {
      alert("Please enter a URL");
      return;
    }
    const d = await apiPost<{ ok: boolean; error?: string }>(
      "/api/change-monitor/watches",
      {
        url: u,
        label: label.trim(),
        check_interval_hours: Number(interval),
        alert_email: email,
        alert_slack: slack,
      },
    );
    if (!d.ok) {
      alert(d.error || "Failed to add watch");
      return;
    }
    setUrl("");
    setLabel("");
    load();
  }

  async function check(id: number) {
    setChecks((prev) => ({ ...prev, [id]: { type: "loading" } }));
    const d = await apiPost<CheckResult>(`/api/change-monitor/check/${id}`);
    if (!d.ok) {
      setChecks((prev) => ({
        ...prev,
        [id]: { type: "error", msg: d.error || "Check failed" },
      }));
      return;
    }
    if (d.first_check) {
      setChecks((prev) => ({ ...prev, [id]: { type: "baseline" } }));
    } else if (d.changed && d.diff) {
      setChecks((prev) => ({ ...prev, [id]: { type: "changed", diff: d.diff! } }));
    } else {
      setChecks((prev) => ({
        ...prev,
        [id]: { type: "nochange", pct: d.pct_change || 0 },
      }));
    }
    load();
  }

  async function pause(id: number) {
    await apiPost(`/api/change-monitor/watches/${id}/pause`);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Remove this watch?")) return;
    await apiDelete(`/api/change-monitor/watches/${id}`);
    load();
  }

  async function showDiffs(id: number, lbl: string) {
    const d = await apiGet<DiffsResult>(`/api/change-monitor/diffs/${id}`);
    setModal({ label: lbl, diffs: d.ok ? d.diffs || [] : [] });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 14,
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Change Monitor
              </div>
              <h2 className="view-title">🔔 Competitor Change Monitor</h2>
              <p className="view-sub">
                Watch any competitor URL for changes. When their pricing page,
                features page, or homepage updates — you get an instant
                AI-powered summary of what changed and why it matters
                strategically.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginBottom: 24,
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 6,
              }}
            >
              Competitor URL to Watch
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://competitor.com/pricing"
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 6,
              }}
            >
              Label
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Competitor Pricing Page"
              style={inputStyle}
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 28,
            alignItems: "center",
          }}
        >
          <label style={{ fontSize: 13, color: "#374151" }}>
            <input
              type="checkbox"
              checked={email}
              onChange={(e) => setEmail(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Email alerts
          </label>
          <label style={{ fontSize: 13, color: "#374151" }}>
            <input
              type="checkbox"
              checked={slack}
              onChange={(e) => setSlack(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Slack alerts
          </label>
          <select
            value={interval}
            onChange={(e) => setIntervalHrs(e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #D1D5DB",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <option value="1">Check every hour</option>
            <option value="6">Check every 6 hours</option>
            <option value="12">Check every 12 hours</option>
            <option value="24">Check every 24 hours</option>
          </select>
          <button
            onClick={addWatch}
            style={{
              padding: "10px 20px",
              background: "#6366F1",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add Watch
          </button>
        </div>

        <div>
          {listStatus === "loading" && (
            <div style={{ color: "#6B7280", padding: "32px 0" }}>
              Loading watches…
            </div>
          )}
          {listStatus === "done" && !watches.length && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <p
                style={{
                  color: "#6B7280",
                  textAlign: "center",
                  margin: 0,
                }}
              >
                No watches yet. Add a competitor URL above to get started.
              </p>
            </div>
          )}
          {listStatus === "done" &&
            watches.map((w) => {
              const since = w.last_changed
                ? new Date(w.last_changed).toLocaleDateString()
                : "Never";
              const cs = checks[w.id];
              return (
                <div
                  key={w.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 24,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <Badge
                          label={w.status}
                          color={
                            w.status === "active"
                              ? { bg: "#D1FAE5", fg: "#065F46" }
                              : { bg: "#F3F4F6", fg: "#374151" }
                          }
                        />
                        <strong style={{ fontSize: 15, color: "#111827" }}>
                          {w.label || w.url}
                        </strong>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6B7280",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {w.url}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#9CA3AF",
                          marginTop: 4,
                        }}
                      >
                        {(w.diff_count || 0) > 0 ? (
                          <strong style={{ color: "#EF4444" }}>
                            {w.diff_count} change
                            {(w.diff_count || 0) > 1 ? "s" : ""} detected
                          </strong>
                        ) : (
                          "No changes detected"
                        )}{" "}
                        · Last changed: {since} · Checked every{" "}
                        {w.check_interval_hours}h
                      </div>
                    </div>
                    <div
                      style={{ display: "flex", gap: 8, flexShrink: 0 }}
                    >
                      <button
                        onClick={() => check(w.id)}
                        style={{
                          padding: "7px 14px",
                          background: "#F0FDF4",
                          color: "#166534",
                          border: "1px solid #BBF7D0",
                          borderRadius: 7,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ▶ Check Now
                      </button>
                      <button
                        onClick={() => showDiffs(w.id, w.label || w.url)}
                        style={{
                          padding: "7px 14px",
                          background: "#EFF6FF",
                          color: "#1D4ED8",
                          border: "1px solid #BFDBFE",
                          borderRadius: 7,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        📋 Diffs
                      </button>
                      <button
                        onClick={() => pause(w.id)}
                        style={{
                          padding: "7px 14px",
                          background: "#F9FAFB",
                          color: "#374151",
                          border: "1px solid #E5E7EB",
                          borderRadius: 7,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        {w.status === "active" ? "⏸ Pause" : "▶ Resume"}
                      </button>
                      <button
                        onClick={() => remove(w.id)}
                        style={{
                          padding: "7px 14px",
                          background: "#FEF2F2",
                          color: "#DC2626",
                          border: "1px solid #FECACA",
                          borderRadius: 7,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  {cs && (
                    <div style={{ marginTop: 12 }}>
                      {cs.type === "loading" && (
                        <div style={{ color: "#6B7280", fontSize: 13 }}>
                          Fetching page and comparing…
                        </div>
                      )}
                      {cs.type === "error" && (
                        <div
                          style={{
                            color: "#DC2626",
                            fontSize: 13,
                            padding: 8,
                            background: "#FEF2F2",
                            borderRadius: 6,
                          }}
                        >
                          {cs.msg}
                        </div>
                      )}
                      {cs.type === "baseline" && (
                        <div
                          style={{
                            color: "#065F46",
                            fontSize: 13,
                            padding: 8,
                            background: "#D1FAE5",
                            borderRadius: 6,
                          }}
                        >
                          ✅ Baseline captured. Future checks will detect changes
                          from this snapshot.
                        </div>
                      )}
                      {cs.type === "nochange" && (
                        <div
                          style={{
                            color: "#374151",
                            fontSize: 13,
                            padding: 8,
                            background: "#F9FAFB",
                            borderRadius: 6,
                          }}
                        >
                          ✓ No significant changes detected ({cs.pct}% word
                          delta).
                        </div>
                      )}
                      {cs.type === "changed" && (
                        <div
                          style={{
                            background: "#FEF3C7",
                            borderRadius: 8,
                            padding: 14,
                            borderLeft: "3px solid #F59E0B",
                          }}
                        >
                          <div
                            style={{ display: "flex", gap: 8, marginBottom: 8 }}
                          >
                            <Badge
                              label="CHANGED"
                              color={{ bg: "#FEF3C7", fg: "#92400E" }}
                            />
                            <Badge
                              label={`${cs.diff.severity} severity`}
                              color={
                                SEV_COLOR[cs.diff.severity || ""] || {
                                  bg: "#F3F4F6",
                                  fg: "#374151",
                                }
                              }
                            />
                            <Badge
                              label={cs.diff.change_type || "other"}
                              color={{ bg: "#DBEAFE", fg: "#1E40AF" }}
                            />
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              color: "#111827",
                              marginBottom: 6,
                            }}
                          >
                            <strong>What changed:</strong>{" "}
                            {cs.diff.diff_summary}
                          </div>
                          <div style={{ fontSize: 13, color: "#374151" }}>
                            <strong>Strategic insight:</strong>{" "}
                            {cs.diff.strategic_insight}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => setModal(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 28,
              maxWidth: 700,
              width: "100%",
              maxHeight: "80vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 18 }}>
                Change History — {modal.label}
              </h3>
              <button
                onClick={() => setModal(null)}
                style={{
                  background: "#F3F4F6",
                  border: "none",
                  borderRadius: "50%",
                  width: 32,
                  height: 32,
                  cursor: "pointer",
                  fontSize: 18,
                }}
              >
                ×
              </button>
            </div>
            {!modal.diffs.length ? (
              <p style={{ color: "#6B7280" }}>No changes detected yet.</p>
            ) : (
              modal.diffs.map((df, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid #E5E7EB",
                    borderRadius: 8,
                    padding: 14,
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9CA3AF",
                      marginBottom: 6,
                    }}
                  >
                    {new Date(df.detected_at).toLocaleString()}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#111827",
                      marginBottom: 4,
                    }}
                  >
                    <strong>Change:</strong> {df.diff_summary}
                  </div>
                  <div style={{ fontSize: 13, color: "#374151" }}>
                    <strong>Insight:</strong> {df.strategic_insight}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
