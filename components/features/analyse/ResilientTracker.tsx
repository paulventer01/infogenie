"use client";

// Native React port of the legacy `resilient-tracker` panel (was
// `window.buildResilientTracker` + `#view-resilient-tracker` in index.html).
// Tracks specific data points on competitor pages with auto-healing extraction
// via the existing Express API (`/api/resilient-tracker/*`) through `lib/api`.
// The legacy snapshot-history modal becomes a React state-driven overlay.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface DataPoint {
  key: string;
  description?: string;
}
interface Tracker {
  id: number;
  url: string;
  label?: string;
  last_method?: string | null;
  consecutive_failures?: number;
  data_points?: DataPoint[] | string;
  last_data?: Record<string, unknown> | string;
}
interface TrackersResult {
  ok: boolean;
  error?: string;
  trackers?: Tracker[];
}
interface CheckResult {
  ok: boolean;
  error?: string;
  method?: string;
}
interface Snapshot {
  created_at: string;
  method?: string;
  data?: Record<string, unknown> | string;
}
interface SnapshotsResult {
  ok: boolean;
  error?: string;
  snapshots?: Snapshot[];
}

type CheckState =
  | { type: "loading" }
  | { type: "error"; msg: string }
  | { type: "ok"; method: string };

function parseDataPoints(dp: Tracker["data_points"]): DataPoint[] {
  if (Array.isArray(dp)) return dp;
  if (typeof dp === "string") {
    try {
      return JSON.parse(dp || "[]");
    } catch {
      return [];
    }
  }
  return [];
}

function parseRecord(d: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (typeof d === "string") {
    try {
      return JSON.parse(d || "{}");
    } catch {
      return {};
    }
  }
  return d || {};
}

export default function ResilientTracker() {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [dataPointsRaw, setDataPointsRaw] = useState("");

  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "done">("loading");
  const [checks, setChecks] = useState<Record<number, CheckState>>({});
  const [modal, setModal] = useState<{ label: string; snapshots: Snapshot[] } | null>(
    null,
  );

  async function load() {
    setListStatus("loading");
    const d = await apiGet<TrackersResult>("/api/resilient-tracker/trackers");
    setTrackers(d.ok ? d.trackers || [] : []);
    setListStatus("done");
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const u = url.trim();
    if (!u) {
      alert("Please enter a URL");
      return;
    }
    const raw = dataPointsRaw.trim();
    const data_points = raw
      ? raw
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [key, ...rest] = l.split("|");
            return {
              key: (key || "").trim(),
              description: (rest.join("|") || "").trim(),
            };
          })
          .filter((p) => p.key)
      : [];
    const d = await apiPost<{ ok: boolean; error?: string }>(
      "/api/resilient-tracker/trackers",
      { url: u, label: label.trim(), data_points },
    );
    if (!d.ok) {
      alert(d.error || "Failed to add tracker");
      return;
    }
    setUrl("");
    setLabel("");
    setDataPointsRaw("");
    load();
  }

  async function check(id: number) {
    setChecks((prev) => ({ ...prev, [id]: { type: "loading" } }));
    const d = await apiPost<CheckResult>(`/api/resilient-tracker/check/${id}`);
    if (!d.ok) {
      setChecks((prev) => ({
        ...prev,
        [id]: { type: "error", msg: d.error || "Check failed" },
      }));
      return;
    }
    setChecks((prev) => ({
      ...prev,
      [id]: { type: "ok", method: d.method || "unknown" },
    }));
    setTimeout(() => load(), 800);
  }

  async function remove(id: number) {
    if (!confirm("Remove this tracker?")) return;
    await apiDelete(`/api/resilient-tracker/trackers/${id}`);
    load();
  }

  async function showSnapshots(id: number, lbl: string) {
    const d = await apiGet<SnapshotsResult>(
      `/api/resilient-tracker/snapshots/${id}`,
    );
    setModal({ label: lbl, snapshots: d.ok ? d.snapshots || [] : [] });
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
                <span className="bc-sep">›</span> Resilient Tracker
              </div>
              <h2 className="view-title">🛡️ Resilient Competitor Trackers</h2>
              <p className="view-sub">
                Track specific data points on any competitor page — pricing, team
                size, CTA text, any value. When the page structure changes, the
                tracker auto-heals using alternative methods.
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
            gap: 16,
            marginBottom: 16,
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
              URL to Track
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
              placeholder="Competitor Pricing"
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 6,
            }}
          >
            Data Points to Track (one per line: key|description)
          </label>
          <textarea
            rows={4}
            value={dataPointsRaw}
            onChange={(e) => setDataPointsRaw(e.target.value)}
            placeholder={
              "starter_price|The monthly price of the Starter plan\nteam_size|Number of employees on the About page\ncta_text|The main hero CTA button text"
            }
            style={{ ...inputStyle, fontSize: 13, fontFamily: "monospace" }}
          />
        </div>
        <button
          onClick={add}
          style={{
            padding: "10px 20px",
            background: "#6366F1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 24,
          }}
        >
          + Add Tracker
        </button>

        <div>
          {listStatus === "loading" && (
            <div style={{ color: "#6B7280", padding: "32px 0" }}>
              Loading trackers…
            </div>
          )}
          {listStatus === "done" && !trackers.length && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <p
                style={{ color: "#6B7280", textAlign: "center", margin: 0 }}
              >
                No trackers yet. Add a URL and data points above.
              </p>
            </div>
          )}
          {listStatus === "done" &&
            trackers.map((t) => {
              const dp = parseDataPoints(t.data_points);
              const lastData = parseRecord(t.last_data);
              const cs = checks[t.id];
              return (
                <div
                  key={t.id}
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
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 15, color: "#111827" }}>
                        {t.label || t.url}
                      </strong>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>
                        {t.url} · Method: {t.last_method || "not checked yet"} ·
                        Failures: {t.consecutive_failures || 0}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => check(t.id)}
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
                        onClick={() => showSnapshots(t.id, t.label || t.url)}
                        style={{
                          padding: "7px 14px",
                          background: "#EFF6FF",
                          color: "#1D4ED8",
                          border: "1px solid #BFDBFE",
                          borderRadius: 7,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        📊 History
                      </button>
                      <button
                        onClick={() => remove(t.id)}
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
                  {dp.length ? (
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        border: "1px solid #E5E7EB",
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    >
                      <thead>
                        <tr>
                          {["KEY", "LAST VALUE", "DESCRIPTION"].map((h) => (
                            <th
                              key={h}
                              style={{
                                padding: "7px 10px",
                                background: "#F9FAFB",
                                textAlign: "left",
                                fontSize: 11,
                                color: "#6B7280",
                                borderBottom: "1px solid #E5E7EB",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dp.map((p) => (
                          <tr key={p.key}>
                            <td
                              style={{
                                padding: "6px 10px",
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#374151",
                                borderBottom: "1px solid #F3F4F6",
                              }}
                            >
                              {p.key}
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                fontSize: 13,
                                color: "#111827",
                                borderBottom: "1px solid #F3F4F6",
                              }}
                            >
                              {String(lastData[p.key] ?? "—")}
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                fontSize: 12,
                                color: "#6B7280",
                                borderBottom: "1px solid #F3F4F6",
                              }}
                            >
                              {p.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0 }}>
                      No data points configured.
                    </p>
                  )}
                  {cs && (
                    <div style={{ marginTop: 10 }}>
                      {cs.type === "loading" && (
                        <div style={{ color: "#6B7280", fontSize: 13 }}>
                          Running resilient extraction (auto-heals if primary
                          method fails)…
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
                      {cs.type === "ok" && (
                        <div
                          style={{
                            color: "#065F46",
                            fontSize: 13,
                            padding: 8,
                            background: "#D1FAE5",
                            borderRadius: 6,
                          }}
                        >
                          ✅ Data updated via <strong>{cs.method}</strong>
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
              maxWidth: 600,
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
              <h3 style={{ margin: 0 }}>Snapshot History — {modal.label}</h3>
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
            {!modal.snapshots.length ? (
              <p style={{ color: "#6B7280" }}>No snapshots yet.</p>
            ) : (
              modal.snapshots.map((s, i) => {
                const data = parseRecord(s.data);
                const entries = Object.entries(data);
                return (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                      marginBottom: 12,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        background: "#F9FAFB",
                        padding: "8px 12px",
                        fontSize: 12,
                        color: "#6B7280",
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{new Date(s.created_at).toLocaleString()}</span>
                      <span>Method: {s.method || "unknown"}</span>
                    </div>
                    <table
                      style={{ width: "100%", borderCollapse: "collapse" }}
                    >
                      <tbody>
                        {entries.length ? (
                          entries.map(([k, v]) => (
                            <tr key={k}>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#374151",
                                  borderBottom: "1px solid #F3F4F6",
                                }}
                              >
                                {k}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  fontSize: 13,
                                  color: "#111827",
                                  borderBottom: "1px solid #F3F4F6",
                                }}
                              >
                                {String(v)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              style={{
                                padding: 10,
                                color: "#9CA3AF",
                                fontSize: 13,
                              }}
                            >
                              No data
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
