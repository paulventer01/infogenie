"use client";

// Native React port of the legacy `pricing-watch` panel (was inline
// `window._pw*` builders + `#view-pricing-watch` in app.js). Tracks competitor
// product prices over time via the existing Express API
// (`GET`/`POST /api/pricing-watch/targets`, `POST /api/pricing-watch/scan/:id`,
// `DELETE /api/pricing-watch/targets/:id`, `GET /api/pricing-watch/snapshots/:id`)
// through `lib/api`. See `docs/react-panel-migration.md` for the pattern.

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface LatestSnapshot {
  price?: number | null;
  currency?: string;
  original_price?: number | null;
  promo?: string;
  in_stock?: boolean;
  taken_at?: string;
}
interface Target {
  id: number;
  label?: string;
  url: string;
  competitor?: string;
  latest?: LatestSnapshot | null;
  snapshot_count?: number;
}
interface TargetsResponse {
  ok: boolean;
  error?: string;
  targets?: Target[];
}
interface Snapshot {
  taken_at?: string;
  price?: number | null;
  currency?: string;
  original_price?: number | null;
  promo?: string;
  in_stock?: boolean;
}
interface SnapshotsResponse {
  ok: boolean;
  error?: string;
  snapshots?: Snapshot[];
}
interface AnalysisCompetitor {
  name?: string;
  domain?: string;
  url?: string;
  website?: string;
}
interface AnalysisData {
  competitors?: AnalysisCompetitor[];
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function brandName(raw?: string): string {
  if (!raw) return "";
  let s = String(raw).trim();
  s = s
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "");
  if (/\./.test(s)) s = s.split(".")[0];
  s = s.replace(/[-_]+/g, " ").trim();
  if (!s) return "";
  if (s === s.toUpperCase() && s.length <= 6) return s;
  return s
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export default function PricingWatch() {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [picked, setPicked] = useState("");
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [history, setHistory] = useState<Record<number, Snapshot[] | null>>({});

  const comps = useMemo(() => {
    const ad = getAnalysisData();
    return (Array.isArray(ad.competitors) ? ad.competitors : [])
      .map((c) => ({
        name: c.name || c.domain || c.url || c.website || "",
        domain: (c.domain || c.url || c.website || "")
          .replace(/^https?:\/\//i, "")
          .replace(/^www\./i, "")
          .replace(/\/.*$/, ""),
      }))
      .filter((c) => c.name);
  }, []);

  async function load() {
    const r = await apiGet<TargetsResponse>("/api/pricing-watch/targets");
    if (!r.ok) {
      setLoadErr(r.error || "failed");
      return;
    }
    setLoadErr("");
    setTargets(r.targets || []);
  }

  useEffect(() => {
    void load();
  }, []);

  function pickComp(v: string) {
    setPicked(v);
  }

  function suggest(field: "label" | "competitor" | "url") {
    const c = comps.find((x) => x.name === picked);
    if (!c) {
      showToast(
        "⚠️ No analysed competitors yet — pick one from the dropdown above, or run an analysis first.",
      );
      return;
    }
    if (field === "label") setLabel(`${c.name} — pricing page`);
    else if (field === "competitor") setCompetitor(c.name);
    else if (field === "url") {
      if (!c.domain) {
        showToast("⚠️ This competitor has no known domain — type one manually.");
        return;
      }
      setUrl(`https://${c.domain}/pricing`);
    }
  }

  async function add() {
    if (!label.trim() || !url.trim()) {
      showToast("⚠️ Label + URL required");
      return;
    }
    const r = await apiPost<TargetsResponse>("/api/pricing-watch/targets", {
      label,
      url,
      competitor,
    });
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    setLabel("");
    setUrl("");
    setCompetitor("");
    showToast("✅ Target added");
    await load();
  }

  async function scan(id: number) {
    showToast("⏳ Scanning…");
    const r = await apiPost<{ ok: boolean; error?: string; snapshot?: LatestSnapshot }>(
      "/api/pricing-watch/scan/" + id,
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    showToast(
      `✅ Scanned: ${r.snapshot?.currency || ""}${r.snapshot?.price ?? "—"}`,
    );
    await load();
  }

  async function del(id: number) {
    if (!confirm("Delete this tracked product and all its snapshots?")) return;
    const r = await apiDelete<TargetsResponse>("/api/pricing-watch/targets/" + id);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    showToast("✅ Deleted");
    await load();
  }

  async function toggleHistory(id: number) {
    if (history[id] !== undefined) {
      setHistory((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      return;
    }
    setHistory((p) => ({ ...p, [id]: null }));
    const r = await apiGet<SnapshotsResponse>(
      "/api/pricing-watch/snapshots/" + id + "?limit=50",
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      setHistory((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      return;
    }
    setHistory((p) => ({ ...p, [id]: r.snapshots || [] }));
  }

  const inputStyle: React.CSSProperties = {
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    fontSize: "0.88rem",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Competitor Pricing Watcher
              </div>
              <h2 className="view-title">💰 Competitor Pricing Watcher</h2>
              <p className="view-sub">
                Track competitor product prices over time. Add a product URL,
                scan it for price / promo / stock, and watch the history build up.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          {comps.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 12,
                paddingBottom: 12,
                borderBottom: "1px solid #F1F5F9",
              }}
            >
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                }}
              >
                Pre-fill from analysed competitor:
              </span>
              <select
                value={picked}
                onChange={(e) => pickComp(e.target.value)}
                style={{ ...inputStyle, fontSize: "0.82rem", background: "#fff" }}
              >
                <option value="">Select competitor…</option>
                {comps.map((c, i) => (
                  <option key={i} value={c.name}>
                    {c.name}
                    {c.domain ? ` — ${c.domain}` : ""}
                  </option>
                ))}
              </select>
              {(["label", "competitor", "url"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => suggest(f)}
                  style={{
                    padding: "5px 11px",
                    background: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                    borderRadius: 6,
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#1D4ED8",
                    cursor: "pointer",
                  }}
                >
                  ↳ {f === "url" ? "URL" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. Acme — Pro plan)"
              style={{ ...inputStyle, flex: 1, minWidth: 160 }}
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Product / pricing URL"
              style={{ ...inputStyle, flex: 2, minWidth: 220 }}
            />
            <input
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              placeholder="Competitor (optional)"
              style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            />
            <button
              onClick={add}
              style={{
                padding: "10px 22px",
                background: "#0066FF",
                border: "2px solid #0066FF",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              ＋ Add Target
            </button>
          </div>
        </div>

        {loadErr && !targets ? (
          <div
            style={{
              background: "#FEE2E2",
              color: "#B91C1C",
              padding: 14,
              borderRadius: 10,
            }}
          >
            ⚠ Couldn&apos;t load tracked products: {loadErr}{" "}
            <button
              onClick={load}
              style={{
                marginLeft: 10,
                padding: "4px 12px",
                background: "#fff",
                border: "1px solid #B91C1C",
                color: "#B91C1C",
                borderRadius: 5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ↻ Retry
            </button>
          </div>
        ) : targets === null ? (
          <div style={{ color: "#6B7280", fontSize: "0.85rem" }}>
            Loading tracked products…
          </div>
        ) : targets.length === 0 ? (
          <div
            style={{
              background: "#F9FAFB",
              border: "1px dashed #D1D5DB",
              borderRadius: 10,
              padding: 24,
              textAlign: "center",
              color: "#6B7280",
              fontSize: "0.88rem",
            }}
          >
            No targets yet. Add a product URL above to start tracking.
          </div>
        ) : (
          <div>
            <div
              style={{
                fontWeight: 800,
                color: "#0A1628",
                fontSize: "0.95rem",
                marginBottom: 10,
              }}
            >
              📊 Tracked products ({targets.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {targets.map((t) => {
                const lat = t.latest;
                const title =
                  brandName(t.competitor) ||
                  (t.label || "").trim() ||
                  brandName(t.url) ||
                  "Untitled";
                const subtitle =
                  brandName(t.competitor) || brandName(t.url) || "—";
                const hist = history[t.id];
                return (
                  <div
                    key={t.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 10,
                      padding: "14px 18px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 14,
                        alignItems: "flex-start",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 800,
                            color: "#0A1628",
                            fontSize: "1rem",
                          }}
                        >
                          {title}
                        </div>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "#475569",
                            fontWeight: 600,
                            marginTop: 2,
                          }}
                        >
                          {subtitle}
                        </div>
                        {t.label &&
                          t.label.trim() &&
                          t.label.trim() !== title && (
                            <div
                              style={{
                                fontSize: "0.72rem",
                                color: "#6B7280",
                                marginTop: 2,
                              }}
                            >
                              {t.label}
                            </div>
                          )}
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#9CA3AF",
                            marginTop: 4,
                          }}
                        >
                          <a
                            href={t.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#0EA5E9" }}
                          >
                            {t.url.slice(0, 80)}
                            {t.url.length > 80 ? "…" : ""}
                          </a>
                        </div>
                        <div
                          style={{
                            marginTop: 8,
                            display: "flex",
                            gap: 14,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "1.4rem",
                              fontWeight: 800,
                              color: "#0A1628",
                            }}
                          >
                            {lat && lat.price != null
                              ? `${lat.currency || ""}${lat.price}`
                              : "—"}
                            {lat && lat.original_price ? (
                              <span
                                style={{
                                  textDecoration: "line-through",
                                  color: "#9CA3AF",
                                  fontSize: "0.78rem",
                                  marginLeft: 6,
                                }}
                              >
                                {lat.currency || ""}
                                {lat.original_price}
                              </span>
                            ) : null}
                          </div>
                          {lat?.promo && (
                            <span
                              style={{
                                background: "#FEF3C7",
                                color: "#92400E",
                                padding: "3px 8px",
                                borderRadius: 5,
                                fontSize: "0.7rem",
                                fontWeight: 700,
                              }}
                            >
                              {lat.promo}
                            </span>
                          )}
                          {lat && lat.in_stock === false && (
                            <span
                              style={{
                                background: "#FEE2E2",
                                color: "#B91C1C",
                                padding: "3px 8px",
                                borderRadius: 5,
                                fontSize: "0.7rem",
                                fontWeight: 700,
                              }}
                            >
                              OUT OF STOCK
                            </span>
                          )}
                          <span
                            style={{ fontSize: "0.72rem", color: "#9CA3AF" }}
                          >
                            {lat
                              ? "last: " +
                                new Date(lat.taken_at || "").toLocaleString()
                              : "never scanned"}{" "}
                            · {t.snapshot_count} snapshot(s)
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <button
                          onClick={() => scan(t.id)}
                          style={{
                            padding: "7px 14px",
                            background: "#15803D",
                            border: "2px solid #15803D",
                            borderRadius: 6,
                            fontSize: "0.74rem",
                            fontWeight: 800,
                            color: "#fff",
                            WebkitTextFillColor: "#fff",
                            cursor: "pointer",
                            textShadow: "0 1px 2px rgba(0,0,0,.4)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          ⚡ Scan Now
                        </button>
                        <button
                          onClick={() => toggleHistory(t.id)}
                          style={{
                            padding: "6px 14px",
                            background: "#fff",
                            border: "1.5px solid #D1D5DB",
                            borderRadius: 6,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: "#374151",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          📈 History
                        </button>
                        <button
                          onClick={() => del(t.id)}
                          style={{
                            padding: "6px 14px",
                            background: "#fff",
                            border: "1.5px solid #FECACA",
                            borderRadius: 6,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: "#B91C1C",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          🗑 Delete
                        </button>
                      </div>
                    </div>
                    {hist !== undefined && (
                      <HistoryTable snapshots={hist} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryTable({ snapshots }: { snapshots: Snapshot[] | null }) {
  if (snapshots === null)
    return (
      <div style={{ marginTop: 10, color: "#6B7280", fontSize: "0.8rem" }}>
        Loading…
      </div>
    );
  if (!snapshots.length)
    return (
      <div style={{ marginTop: 10, color: "#9CA3AF", fontSize: "0.8rem" }}>
        No snapshots yet — click ⚡ Scan Now.
      </div>
    );
  return (
    <div
      style={{
        marginTop: 12,
        background: "#F9FAFB",
        borderRadius: 8,
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          fontWeight: 800,
          color: "#0A1628",
          fontSize: "0.78rem",
          marginBottom: 6,
        }}
      >
        📈 Last {snapshots.length} snapshots
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.78rem",
        }}
      >
        <thead>
          <tr style={{ color: "#6B7280" }}>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>When</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>Price</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>Original</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>Promo</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>Stock</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s, i) => (
            <tr key={i} style={{ borderTop: "1px solid #E5E7EB" }}>
              <td style={{ padding: "4px 6px", color: "#374151" }}>
                {new Date(s.taken_at || "").toLocaleString()}
              </td>
              <td
                style={{
                  padding: "4px 6px",
                  textAlign: "right",
                  color: "#0A1628",
                  fontWeight: 700,
                }}
              >
                {s.currency || ""}
                {s.price ?? "—"}
              </td>
              <td
                style={{
                  padding: "4px 6px",
                  textAlign: "right",
                  color: "#9CA3AF",
                }}
              >
                {s.original_price ? (s.currency || "") + s.original_price : "—"}
              </td>
              <td style={{ padding: "4px 6px", color: "#92400E" }}>
                {s.promo || "—"}
              </td>
              <td style={{ padding: "4px 6px" }}>
                {s.in_stock === false ? "❌" : "✓"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
