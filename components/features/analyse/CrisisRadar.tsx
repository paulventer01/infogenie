"use client";

// Native React port of the legacy `crisis-radar` panel (was
// `window.buildCrisisRadar` + `_cr*` helpers in app.js and
// `#view-crisis-radar` in index.html). Tracks brand/competitor mention spikes
// and sentiment incidents against the existing Express API:
//   GET    /api/crisis-radar/watchlist
//   GET    /api/crisis-radar/incidents
//   POST   /api/crisis-radar/watchlist
//   DELETE /api/crisis-radar/watchlist/:id
//   PATCH  /api/crisis-radar/incidents/:id
//   POST   /api/crisis-radar/run-now
// Pre-fills brand + competitors from the legacy `window.analysisData` /
// `window._brandKit` globals set by the SPA competitor analysis.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete, apiPatch } from "@/lib/api";

const SEV_COLORS: Record<string, string> = {
  low: "#3B82F6",
  med: "#F59E0B",
  high: "#B91C1C",
};
const STATUS_COLORS: Record<string, string> = {
  open: "#B91C1C",
  acknowledged: "#F59E0B",
  resolved: "#15803D",
};

const COUNTRIES = [
  "US", "GB", "AU", "CA", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK", "CH",
  "PL", "IN", "SG", "JP", "KR", "AE", "ZA", "BR", "MX", "AR", "CO", "NZ", "IE",
  "BE", "AT", "PT", "FI", "GR", "CZ", "HU", "RO", "TR", "IL", "SA", "EG", "NG",
  "KE", "MY", "TH", "VN", "PH", "ID", "HK", "TW", "CN", "RU", "UA",
];

interface WatchRow {
  id: number;
  brand: string;
  competitors?: string[];
  country: string;
  snapshots: number;
  open_incidents: number;
}
interface Incident {
  id: number;
  status: string;
  severity: string;
  headline: string;
  detail?: string;
  created_at: string;
  kind: string;
  slack_sent?: boolean;
}
interface WatchlistResp {
  ok?: boolean;
  error?: string;
  watchlist?: WatchRow[];
}
interface IncidentsResp {
  ok?: boolean;
  error?: string;
  incidents?: Incident[];
}
interface RunNowResp {
  ok?: boolean;
  skipped?: boolean;
  error?: string;
  ran?: number;
  results?: { incidents?: unknown[] }[];
}

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisData {
  url?: string;
  competitors?: AnalysisCompetitor[];
}
interface BrandKit {
  name?: string;
}

function toast(msg: string) {
  if (typeof window !== "undefined") {
    (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
  }
}
function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}
function getBrandKit(): BrandKit {
  if (typeof window === "undefined") return {};
  return (window as unknown as { _brandKit?: BrandKit })._brandKit || {};
}

export default function CrisisRadar() {
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [incFilter, setIncFilter] = useState("");
  const [running, setRunning] = useState(false);

  // Prefill data from the legacy globals
  const { prefillBrand, comps } = useMemo(() => {
    const ad = getAnalysisData();
    const bk = getBrandKit();
    const brand =
      bk.name ||
      (ad.url
        ? ad.url
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .replace(/^www\./, "")
        : "");
    const competitors = Array.isArray(ad.competitors)
      ? ad.competitors.map((c) => c.name).filter((n): n is string => !!n)
      : [];
    return { prefillBrand: brand, comps: competitors };
  }, []);

  // Form state
  const [brand, setBrand] = useState("");
  const [selectedComps, setSelectedComps] = useState<Set<string>>(new Set());
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(
    new Set(["US"]),
  );
  const [spike, setSpike] = useState("1.8");
  const [neg, setNeg] = useState("0.35");

  useEffect(() => {
    setBrand(prefillBrand);
    setSelectedComps(new Set(comps));
  }, [prefillBrand, comps]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [wl, inc] = await Promise.all([
      apiGet<WatchlistResp>("/api/crisis-radar/watchlist"),
      apiGet<IncidentsResp>("/api/crisis-radar/incidents"),
    ]);
    if (wl.ok === false || inc.ok === false) {
      setError(wl.error || inc.error || "Failed to load Crisis Radar");
      setLoading(false);
      return;
    }
    setWatchlist(wl.watchlist || []);
    setIncidents(inc.incidents || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleComp(c: string) {
    setSelectedComps((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  function toggleCountry(c: string) {
    setSelectedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function addWatch() {
    if (!brand.trim()) {
      toast("❌ Brand required — run an analysis first to auto-fill it");
      return;
    }
    const competitors = Array.from(selectedComps);
    const countries = Array.from(selectedCountries);
    if (countries.length === 0) {
      toast("❌ Pick at least one country (or tick Select all)");
      return;
    }
    const spike_multiplier = Number(spike);
    const neg_pct_threshold = Number(neg);
    let okCount = 0;
    let errCount = 0;
    let lastErr = "";
    for (const country of countries) {
      const r = await apiPost<{ ok?: boolean; error?: string }>(
        "/api/crisis-radar/watchlist",
        { brand, competitors, country, spike_multiplier, neg_pct_threshold },
      );
      if (!r.ok) {
        errCount++;
        lastErr = r.error || "Failed to track";
      } else okCount++;
    }
    if (okCount > 0)
      toast(
        `✅ Tracking ${brand} in ${okCount} ${okCount === 1 ? "country" : "countries"}${errCount ? ` · ${errCount} failed` : ""}`,
      );
    else toast("❌ " + (lastErr || "Failed to track"));
    load();
  }

  async function deleteWatch(id: number, b: string) {
    if (
      !window.confirm(
        `Stop tracking ${b}? Incidents and snapshots will be removed.`,
      )
    )
      return;
    await apiDelete(`/api/crisis-radar/watchlist/${id}`);
    toast("🗑 Removed");
    load();
  }

  async function setStatus(id: number, status: string) {
    await apiPatch(`/api/crisis-radar/incidents/${id}`, { status });
    toast("✅ " + status);
    load();
  }

  async function runNow() {
    setRunning(true);
    toast("⏳ Running scan — this may take 30-60s…");
    const r = await apiPost<RunNowResp>("/api/crisis-radar/run-now");
    if (!r.ok && !r.skipped) {
      toast("❌ " + (r.error || "failed"));
      setRunning(false);
      return;
    }
    if (r.skipped) toast("⏳ Already running — please wait");
    else {
      const newInc = (r.results || []).reduce(
        (s, x) => s + (x.incidents?.length || 0),
        0,
      );
      toast(`✅ Scanned ${r.ran} brands · ${newInc} new incident(s)`);
      await load();
    }
    setRunning(false);
  }

  const open = incidents.filter((i) => i.status === "open");
  const hasPrefill = !!prefillBrand && comps.length > 0;

  const card: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    padding: 18,
    marginBottom: 18,
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Crisis Radar
              </div>
              <h2 className="view-title">🚨 Crisis Radar</h2>
              <p className="view-sub">
                Daily anomaly detection on mention volume + sentiment. Detects
                spikes vs your 7-day baseline and fires Slack alerts when
                configured.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                onClick={runNow}
                disabled={running}
              >
                {running ? "⏳ Scanning…" : "▶ Run scan now"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>
            Loading…
          </div>
        )}
        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#B91C1C",
              padding: 16,
              borderRadius: 10,
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                gap: 14,
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #FCA5A5",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    color: "#B91C1C",
                    textTransform: "uppercase",
                  }}
                >
                  Open incidents
                </div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "2rem",
                    fontWeight: 800,
                    color: "#B91C1C",
                  }}
                >
                  {open.length}
                </div>
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    color: "#6B7280",
                    textTransform: "uppercase",
                  }}
                >
                  Tracked brands
                </div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "2rem",
                    fontWeight: 800,
                    color: "#0A1628",
                  }}
                >
                  {watchlist.length}
                </div>
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    color: "#6B7280",
                    textTransform: "uppercase",
                  }}
                >
                  Total incidents (90d)
                </div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "2rem",
                    fontWeight: 800,
                    color: "#0A1628",
                  }}
                >
                  {incidents.length}
                </div>
              </div>
              <div
                style={{
                  background: "linear-gradient(135deg,#FEF3C7,#FDE68A)",
                  border: "1px solid #F59E0B",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    color: "#92400E",
                    textTransform: "uppercase",
                  }}
                >
                  Slack alerts
                </div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    color: "#78350F",
                    paddingTop: 6,
                  }}
                >
                  {incidents.filter((i) => i.slack_sent).length} sent
                </div>
              </div>
            </div>

            {/* Watchlist + add form */}
            <div style={card}>
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontWeight: 800,
                  fontSize: "1rem",
                  marginBottom: 12,
                }}
              >
                Watchlist
              </div>
              {!hasPrefill && (
                <div
                  style={{
                    background: "#FEF3C7",
                    border: "1px solid #F59E0B",
                    color: "#92400E",
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontSize: "0.78rem",
                    marginBottom: 12,
                  }}
                >
                  ⚠ Run an analysis on the <strong>+ Analyse</strong> tab first —
                  your brand and competitors will auto-fill here.
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <label style={{ display: "block" }}>
                  <div
                    style={{
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      marginBottom: 3,
                    }}
                  >
                    Brand *{" "}
                    <span style={{ color: "#15803D", fontWeight: 600 }}>
                      (auto-filled from your analysis)
                    </span>
                  </div>
                  <input
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Run an analysis first"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 6,
                      fontSize: "0.85rem",
                      background: brand ? "#F0FDF4" : "#fff",
                      boxSizing: "border-box",
                    }}
                  />
                </label>
                <div>
                  <div
                    style={{
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      marginBottom: 3,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>
                      Competitors{" "}
                      <span style={{ color: "#15803D", fontWeight: 600 }}>
                        (from your analysis)
                      </span>
                    </span>
                    {comps.length > 0 && (
                      <label
                        style={{
                          fontSize: "0.68rem",
                          color: "#374151",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedComps.size === comps.length}
                          onChange={(e) =>
                            setSelectedComps(
                              e.target.checked ? new Set(comps) : new Set(),
                            )
                          }
                        />{" "}
                        Select all
                      </label>
                    )}
                  </div>
                  <div
                    style={{
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 6,
                      padding: "8px 10px",
                      maxHeight: 90,
                      overflowY: "auto",
                      background: "#fff",
                      fontSize: "0.82rem",
                    }}
                  >
                    {comps.length === 0 ? (
                      <div style={{ color: "#9CA3AF", fontSize: "0.76rem" }}>
                        No competitors found yet — run an analysis to
                        auto-populate this list.
                      </div>
                    ) : (
                      comps.map((c) => (
                        <label
                          key={c}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            marginRight: 14,
                            padding: "3px 0",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedComps.has(c)}
                            onChange={() => toggleComp(c)}
                          />{" "}
                          {c}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 100px 100px auto",
                  gap: 14,
                  alignItems: "end",
                  marginBottom: 6,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      marginBottom: 3,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>Country / Region (select one or many)</span>
                    <label
                      style={{
                        fontSize: "0.68rem",
                        color: "#374151",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCountries.size === COUNTRIES.length}
                        onChange={(e) =>
                          setSelectedCountries(
                            e.target.checked ? new Set(COUNTRIES) : new Set(),
                          )
                        }
                      />{" "}
                      Select all
                    </label>
                  </div>
                  <div
                    style={{
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 6,
                      padding: "8px 10px",
                      maxHeight: 90,
                      overflowY: "auto",
                      background: "#fff",
                      fontSize: "0.78rem",
                      columnCount: 4,
                      columnGap: 14,
                    }}
                  >
                    {COUNTRIES.map((c) => (
                      <label
                        key={c}
                        style={{
                          display: "block",
                          padding: "2px 0",
                          cursor: "pointer",
                          breakInside: "avoid",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCountries.has(c)}
                          onChange={() => toggleCountry(c)}
                        />{" "}
                        {c}
                      </label>
                    ))}
                  </div>
                </div>
                <label>
                  <div
                    style={{
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      marginBottom: 3,
                    }}
                  >
                    Spike ×
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    value={spike}
                    onChange={(e) => setSpike(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 9px",
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 6,
                      fontSize: "0.8rem",
                      boxSizing: "border-box",
                    }}
                  />
                </label>
                <label>
                  <div
                    style={{
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      marginBottom: 3,
                    }}
                  >
                    Neg %
                  </div>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={neg}
                    onChange={(e) => setNeg(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 9px",
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 6,
                      fontSize: "0.8rem",
                      boxSizing: "border-box",
                    }}
                  />
                </label>
                <button
                  onClick={addWatch}
                  style={{
                    padding: "9px 16px",
                    background: "#B91C1C",
                    border: "2px solid #B91C1C",
                    borderRadius: 6,
                    fontSize: "0.78rem",
                    fontWeight: 800,
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                    cursor: "pointer",
                    textShadow: "0 1px 2px rgba(0,0,0,.5)",
                    whiteSpace: "nowrap",
                  }}
                >
                  + Track
                </button>
              </div>

              {watchlist.length === 0 ? (
                <div
                  style={{
                    color: "#9CA3AF",
                    textAlign: "center",
                    padding: 14,
                    fontSize: "0.82rem",
                  }}
                >
                  No brands tracked yet — add one above.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.82rem",
                  }}
                >
                  <thead
                    style={{
                      background: "#F9FAFB",
                      color: "#6B7280",
                      textTransform: "uppercase",
                      fontSize: "0.6rem",
                    }}
                  >
                    <tr>
                      <th style={{ padding: "8px 10px", textAlign: "left" }}>
                        Brand
                      </th>
                      <th style={{ padding: 8, textAlign: "left" }}>
                        Competitors
                      </th>
                      <th style={{ padding: 8, textAlign: "left" }}>Country</th>
                      <th style={{ padding: 8, textAlign: "right" }}>
                        Snapshots
                      </th>
                      <th style={{ padding: 8, textAlign: "right" }}>
                        Open incidents
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.map((w) => (
                      <tr key={w.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontWeight: 800,
                            color: "#0A1628",
                          }}
                        >
                          {w.brand}
                        </td>
                        <td style={{ padding: 8, color: "#6B7280" }}>
                          {(w.competitors || []).join(", ") || "-"}
                        </td>
                        <td style={{ padding: 8 }}>{w.country}</td>
                        <td
                          style={{
                            padding: 8,
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {w.snapshots}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            textAlign: "right",
                            fontWeight: 800,
                            color: w.open_incidents > 0 ? "#B91C1C" : "#15803D",
                          }}
                        >
                          {w.open_incidents}
                        </td>
                        <td style={{ padding: 8, textAlign: "right" }}>
                          <button
                            onClick={() => deleteWatch(w.id, w.brand)}
                            style={{
                              padding: "5px 10px",
                              background: "#fff",
                              border: "1.5px solid #FCA5A5",
                              borderRadius: 5,
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              color: "#B91C1C",
                              cursor: "pointer",
                            }}
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Incidents */}
            <div style={{ ...card, marginBottom: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontWeight: 800,
                    fontSize: "1rem",
                  }}
                >
                  Recent incidents
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["", "open", "acknowledged", "resolved"].map((s) => (
                    <button
                      key={s || "all"}
                      onClick={() => setIncFilter(s)}
                      style={{
                        padding: "5px 11px",
                        background: incFilter === s ? "#1E1B4B" : "#fff",
                        color: incFilter === s ? "#fff" : "#374151",
                        WebkitTextFillColor: incFilter === s ? "#fff" : "#374151",
                        border: `1.5px solid ${incFilter === s ? "#1E1B4B" : "#E5E7EB"}`,
                        borderRadius: 5,
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {s || "all"}
                    </button>
                  ))}
                </div>
              </div>
              {incidents.length === 0 ? (
                <div
                  style={{
                    color: "#9CA3AF",
                    textAlign: "center",
                    padding: 30,
                    fontSize: "0.85rem",
                  }}
                >
                  🎉 No incidents — your radar is quiet.
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {incidents
                    .filter((i) => !incFilter || i.status === incFilter)
                    .map((i) => (
                      <div
                        key={i.id}
                        style={{
                          border: "1px solid #E5E7EB",
                          borderLeft: `4px solid ${SEV_COLORS[i.severity] || "#9CA3AF"}`,
                          borderRadius: 8,
                          padding: "12px 14px",
                          background: "#fff",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 10,
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 800,
                                color: "#0A1628",
                                fontSize: "0.9rem",
                              }}
                            >
                              {i.headline}
                            </div>
                            {i.detail && (
                              <div
                                style={{
                                  fontSize: "0.78rem",
                                  color: "#6B7280",
                                  marginTop: 3,
                                }}
                              >
                                {i.detail}
                              </div>
                            )}
                            <div
                              style={{
                                fontSize: "0.68rem",
                                color: "#9CA3AF",
                                marginTop: 5,
                              }}
                            >
                              {new Date(i.created_at).toLocaleString()} ·{" "}
                              {i.kind} ·{" "}
                              {i.slack_sent ? "📤 slack sent" : "no slack"}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              gap: 4,
                            }}
                          >
                            <span
                              style={{
                                background: STATUS_COLORS[i.status] || "#9CA3AF",
                                color: "#fff",
                                padding: "2px 8px",
                                borderRadius: 5,
                                fontSize: "0.62rem",
                                fontWeight: 800,
                                textTransform: "uppercase",
                              }}
                            >
                              {i.status}
                            </span>
                            {i.status === "open" && (
                              <button
                                onClick={() =>
                                  setStatus(i.id, "acknowledged")
                                }
                                style={{
                                  padding: "3px 8px",
                                  background: "#fff",
                                  border: "1.5px solid #F59E0B",
                                  borderRadius: 4,
                                  fontSize: "0.66rem",
                                  fontWeight: 700,
                                  color: "#92400E",
                                  cursor: "pointer",
                                }}
                              >
                                Acknowledge
                              </button>
                            )}
                            {i.status !== "resolved" && (
                              <button
                                onClick={() => setStatus(i.id, "resolved")}
                                style={{
                                  padding: "3px 8px",
                                  background: "#fff",
                                  border: "1.5px solid #15803D",
                                  borderRadius: 4,
                                  fontSize: "0.66rem",
                                  fontWeight: 700,
                                  color: "#15803D",
                                  cursor: "pointer",
                                }}
                              >
                                Resolve
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
