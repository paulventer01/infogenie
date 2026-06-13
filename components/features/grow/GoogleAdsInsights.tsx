"use client";

// Native React port of the legacy `google-ads-insights` panel (was
// `window.buildGoogleAdsInsights` / `_gaiLoad` / `_gaiTest` in
// `public/js/ig_intel_pack_a.js` + `#view-google-ads-insights` in index.html).
// Renders live Google Ads performance — account summary tiles, campaign table
// and top ads — pulled from the same Express endpoints:
//   POST /api/google-ads-insights/test
//   GET  /api/google-ads-insights/account-summary?date_preset=…
//   GET  /api/google-ads-insights/campaigns?date_preset=…
//   GET  /api/google-ads-insights/top-ads?date_preset=…
// See docs/react-panel-migration.md for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Summary {
  spend: number;
  revenue: number;
  roas: number;
  conversions: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
}
interface SummaryResult {
  ok: boolean;
  note?: string;
  error?: string;
  summary?: Summary;
}
interface Campaign {
  name?: string;
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
}
interface CampaignsResult {
  ok: boolean;
  note?: string;
  error?: string;
  campaigns?: Campaign[];
}
interface AdItem {
  name?: string;
  campaign?: string;
  ad_group?: string;
  ctr: number;
  clicks: number;
  spend: number;
}
interface AdsResult {
  ok: boolean;
  note?: string;
  error?: string;
  ads?: AdItem[];
}
interface TestResult {
  ok: boolean;
  error?: string;
  account?: { name?: string; currency?: string };
}

type Kind = "pct" | "money" | "roas" | "int";

function fmt(n: number | null | undefined, kind: Kind = "int"): string {
  if (n === null || n === undefined) return "—";
  if (kind === "pct") return parseFloat(String(n)).toFixed(2) + "%";
  if (kind === "money")
    return (
      "$" +
      parseFloat(String(n)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  if (kind === "roas") return parseFloat(String(n)).toFixed(2) + "×";
  return parseInt(String(n), 10).toLocaleString();
}

const roasColor = (r: number) =>
  r >= 2 ? "#15803D" : r >= 1 ? "#F59E0B" : "#DC2626";

const TH: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: "0.68rem",
  color: "#6B7280",
  fontWeight: 700,
  textTransform: "uppercase",
};
const THR: React.CSSProperties = { ...TH, textAlign: "right" };
const TD: React.CSSProperties = {
  padding: "9px 12px",
  textAlign: "right",
  color: "#374151",
};

function Tile({
  label,
  val,
  color,
}: {
  label: string;
  val: React.ReactNode;
  color: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderTop: `3px solid ${color}`,
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          color: "#6B7280",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color: "#0A1628",
          marginTop: 4,
        }}
      >
        {val}
      </div>
    </div>
  );
}

export default function GoogleAdsInsights() {
  const [dp, setDp] = useState("last_30d");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [camps, setCamps] = useState<CampaignsResult | null>(null);
  const [ads, setAds] = useState<AdsResult | null>(null);
  const [testMsg, setTestMsg] = useState("");

  const load = useCallback(async (preset: string) => {
    setLoading(true);
    const [s, c, a] = await Promise.all([
      apiGet<SummaryResult>(
        `/api/google-ads-insights/account-summary?date_preset=${preset}`,
      ),
      apiGet<CampaignsResult>(
        `/api/google-ads-insights/campaigns?date_preset=${preset}`,
      ),
      apiGet<AdsResult>(
        `/api/google-ads-insights/top-ads?date_preset=${preset}`,
      ),
    ]);
    setSummary(s);
    setCamps(c);
    setAds(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(dp);
  }, [dp, load]);

  async function runTest() {
    setTestMsg("⏳ Pinging Google Ads…");
    const r = await apiPost<TestResult>("/api/google-ads-insights/test");
    setTestMsg(
      r.ok
        ? `✅ Connected: ${r.account?.name || ""} (${r.account?.currency || ""})`
        : "❌ " + (r.error || "failed"),
    );
  }

  const m = summary?.summary;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Google Ads Insights
              </div>
              <h2 className="view-title">🅖 Google Ads Insights</h2>
              <p className="view-sub">
                Live performance from your Google Ads account — spend, ROAS, top
                campaigns and best ads. Pulled in real-time via the Google Ads
                API.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background:
              "linear-gradient(135deg,#4285F4 0%,#34A853 50%,#FBBC04 100%)",
            color: "#fff",
            borderRadius: 12,
            padding: "18px 22px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>
              🅖 Google Ads API
            </div>
            <div style={{ fontSize: "0.82rem", opacity: 0.92, marginTop: 2 }}>
              Live spend, ROAS, top campaigns and ads — refreshes on every load.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={dp}
              onChange={(e) => setDp(e.target.value)}
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                border: "none",
                fontWeight: 700,
                fontSize: "0.82rem",
                color: "#0A1628",
                cursor: "pointer",
              }}
            >
              <option value="last_7d">Last 7 days</option>
              <option value="last_14d">Last 14 days</option>
              <option value="last_30d">Last 30 days</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
            </select>
            <button
              onClick={runTest}
              style={{
                padding: "8px 14px",
                background: "rgba(255,255,255,.18)",
                border: "2px solid rgba(255,255,255,.35)",
                color: "#fff",
                WebkitTextFillColor: "#fff",
                borderRadius: 6,
                fontWeight: 800,
                cursor: "pointer",
                fontSize: "0.78rem",
              }}
            >
              ⚡ Test
            </button>
          </div>
        </div>

        {testMsg && (
          <div
            style={{
              background: "#EFF6FF",
              color: "#1E40AF",
              padding: "10px 14px",
              borderRadius: 10,
              marginBottom: 16,
              fontSize: "0.82rem",
              fontWeight: 600,
            }}
          >
            {testMsg}
          </div>
        )}

        {/* Summary */}
        <div>
          {loading && (
            <div style={{ color: "#6B7280", padding: 14 }}>
              ⏳ Loading account…
            </div>
          )}
          {!loading && summary?.note && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: 14,
                borderRadius: 10,
                border: "1px solid #FDE68A",
              }}
            >
              {summary.note}
            </div>
          )}
          {!loading && !summary?.note && !summary?.ok && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {summary?.error || "failed"}
            </div>
          )}
          {!loading && summary?.ok && !summary?.note && m && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(165px,1fr))",
                gap: 12,
              }}
            >
              <Tile label="Spend" val={fmt(m.spend, "money")} color="#4285F4" />
              <Tile
                label="Revenue"
                val={fmt(m.revenue, "money")}
                color="#15803D"
              />
              <Tile
                label="ROAS"
                val={fmt(m.roas, "roas")}
                color={roasColor(m.roas)}
              />
              <Tile
                label="Conversions"
                val={(m.conversions ?? 0).toFixed(2)}
                color="#15803D"
              />
              <Tile
                label="Impressions"
                val={fmt(m.impressions)}
                color="#0EA5E9"
              />
              <Tile label="Clicks" val={fmt(m.clicks)} color="#0EA5E9" />
              <Tile label="CTR" val={fmt(m.ctr, "pct")} color="#F59E0B" />
              <Tile label="CPC" val={fmt(m.cpc, "money")} color="#F59E0B" />
              <Tile label="CPM" val={fmt(m.cpm, "money")} color="#F59E0B" />
            </div>
          )}
        </div>

        {/* Campaigns */}
        <div style={{ marginTop: 16 }}>
          {!loading &&
          (!camps?.ok || camps?.note || !camps?.campaigns?.length) ? (
            <>
              <h3 style={{ margin: "18px 0 10px", color: "#0A1628" }}>
                Campaigns
              </h3>
              <div
                style={{
                  background: "#F9FAFB",
                  border: "1px dashed #D1D5DB",
                  borderRadius: 10,
                  padding: 24,
                  textAlign: "center",
                  color: "#6B7280",
                }}
              >
                {camps?.note || "No campaign data for this period."}
              </div>
            </>
          ) : !loading && camps?.campaigns ? (
            <>
              <h3 style={{ margin: "18px 0 10px", color: "#0A1628" }}>
                Campaigns ({camps.campaigns.length})
              </h3>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  overflow: "hidden",
                  overflowX: "auto",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.82rem",
                    minWidth: 780,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      <th style={TH}>Campaign</th>
                      <th style={THR}>Spend</th>
                      <th style={THR}>Revenue</th>
                      <th style={THR}>ROAS</th>
                      <th style={THR}>Impr.</th>
                      <th style={THR}>Clicks</th>
                      <th style={THR}>CTR</th>
                      <th style={THR}>CPC</th>
                      <th style={THR}>Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {camps.campaigns.map((x, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td
                          style={{
                            padding: "9px 12px",
                            color: "#0A1628",
                            fontWeight: 600,
                            maxWidth: 320,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {x.name || ""}
                        </td>
                        <td
                          style={{
                            padding: "9px 12px",
                            textAlign: "right",
                            color: "#0A1628",
                          }}
                        >
                          {fmt(x.spend, "money")}
                        </td>
                        <td
                          style={{
                            padding: "9px 12px",
                            textAlign: "right",
                            color: "#0A1628",
                          }}
                        >
                          {fmt(x.revenue, "money")}
                        </td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>
                          <span
                            style={{
                              background: roasColor(x.roas),
                              color: "#fff",
                              padding: "2px 7px",
                              borderRadius: 4,
                              fontWeight: 800,
                              fontSize: "0.74rem",
                            }}
                          >
                            {fmt(x.roas, "roas")}
                          </span>
                        </td>
                        <td style={TD}>{fmt(x.impressions)}</td>
                        <td style={TD}>{fmt(x.clicks)}</td>
                        <td style={TD}>{fmt(x.ctr, "pct")}</td>
                        <td style={TD}>{fmt(x.cpc, "money")}</td>
                        <td style={TD}>{(x.conversions ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        {/* Top ads */}
        {!loading && ads?.ok && !ads?.note && ads?.ads?.length ? (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: "18px 0 10px", color: "#0A1628" }}>
              Top ads by CTR
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                gap: 12,
              }}
            >
              {ads.ads.map((x, i) => (
                <div
                  key={i}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 10,
                    padding: 13,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#0A1628",
                      fontSize: "0.86rem",
                      marginBottom: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {x.name || ""}
                  </div>
                  <div
                    style={{
                      color: "#6B7280",
                      fontSize: "0.74rem",
                      marginBottom: 8,
                    }}
                  >
                    {(x.campaign || "") + " · " + (x.ad_group || "")}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span
                      style={{
                        background: "#F0FDF4",
                        color: "#15803D",
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                      }}
                    >
                      CTR {fmt(x.ctr, "pct")}
                    </span>
                    <span
                      style={{
                        background: "#EFF6FF",
                        color: "#1E40AF",
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                      }}
                    >
                      {fmt(x.clicks)} clicks
                    </span>
                    <span
                      style={{
                        background: "#FEF3C7",
                        color: "#92400E",
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                      }}
                    >
                      {fmt(x.spend, "money")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
