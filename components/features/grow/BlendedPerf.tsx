"use client";

// Native React port of the legacy `blended-perf` panel (was `buildBlendedPerf`
// / `loadBlendedPerf` in public/js/ig_attribution_scorer.js +
// `#view-blended-perf` in index.html). Pulls one blended view of ad spend,
// customers and CAC across Meta + Google + TikTok (using Amplitude conversions
// as ground truth) from the existing Express API (`GET /api/blended-roas`) plus
// the True ROAS summary (`GET /api/true-roas/summary`) via `lib/api`. Links to
// other tools through `lib/nav`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface ChannelData {
  ok: boolean;
  error?: string;
  spend?: number;
  revenue?: number;
  roas?: number | null;
  cpm?: number | null;
  conversions?: number;
  clicks?: number;
}
interface AmplitudeData {
  ok: boolean;
  error?: string;
  conversions?: number;
  conversionEvents?: { event: string; count: number }[];
  note?: string;
}
interface BlendedData {
  ok: boolean;
  error?: string;
  days?: number;
  totalSpend?: number;
  mer?: number | null;
  ltvCac?: number | null;
  cac?: number | null;
  ltvAssumed?: number | null;
  netSales?: number | null;
  customers?: number;
  customerSource?: string;
  totalRevenue?: number;
  roas?: number | null;
  roasNote?: string;
  channels: { meta: ChannelData; google: ChannelData; tiktok: ChannelData };
  amplitude: AmplitudeData;
}
interface TrueRoasSummary {
  ok: boolean;
  trueRoas?: number | null;
  reportedRoas?: number | null;
  offline?: { revenue?: number };
}

type ChannelKey = "meta" | "google" | "tiktok";
const CHANNELS: { key: ChannelKey; name: string; color: string; icon: string }[] =
  [
    { key: "meta", name: "Meta Ads", color: "#1877F2", icon: "📘" },
    { key: "google", name: "Google Ads", color: "#4285F4", icon: "🔵" },
    { key: "tiktok", name: "TikTok Ads", color: "#000000", icon: "⚫" },
  ];

const SECRETS: Record<ChannelKey, string[]> = {
  meta: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"],
  google: [
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
  ],
  tiktok: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID"],
};

const fmtMoney = (n: number | null | undefined) =>
  "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtNum = (n: number | null | undefined) => Number(n || 0).toLocaleString();

function diagnose(key: ChannelKey, error?: string): { headline: string; fixHint: string } {
  const errStr = String(error || "").toLowerCase();
  if (error === "not-configured")
    return {
      headline: "Not connected",
      fixHint: "Add the credentials below in Secrets to start pulling live data.",
    };
  if (
    key === "meta" &&
    (errStr.includes("oauth") ||
      errStr.includes("access token") ||
      errStr.includes("parse"))
  )
    return {
      headline: "Meta access token invalid or expired",
      fixHint:
        "Generate a fresh long-lived token in Meta Business Manager → System Users, then re-paste it. Make sure there are no quotes or trailing spaces.",
    };
  if (
    key === "google" &&
    (errStr.includes("oauth") ||
      errStr.includes("refresh") ||
      errStr.includes("invalid_grant"))
  )
    return {
      headline: "Google Ads OAuth failed",
      fixHint:
        "Your refresh token has expired or the client ID/secret pair is wrong. Re-authorise in the Google OAuth playground and update the refresh token.",
    };
  if (key === "tiktok" && errStr.includes("advertiser"))
    return {
      headline: "TikTok advertiser ID rejected",
      fixHint:
        "The TIKTOK_ADVERTISER_ID secret must be the numeric advertiser ID only (no dashes, no quotes). Find it in TikTok Ads Manager → top-right account picker.",
    };
  return {
    headline: "Could not connect",
    fixHint: error || "Unknown error from the platform",
  };
}

export default function BlendedPerf() {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<BlendedData | null>(null);
  const [trueRoas, setTrueRoas] = useState<TrueRoasSummary | null>(null);
  const [state, setState] = useState<"loading" | "error" | "done">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async (d: number) => {
    setState("loading");
    setError("");
    setTrueRoas(null);
    const res = await apiGet<BlendedData>("/api/blended-roas?days=" + d);
    if (!res.ok) {
      setError(res.error || "Failed");
      setState("error");
      return;
    }
    setData(res);
    setState("done");
    const t = await apiGet<TrueRoasSummary>(
      "/api/true-roas/summary?days=" + d,
    );
    if (t.ok) setTrueRoas(t);
  }, []);

  useEffect(() => {
    load(days);
  }, [load, days]);

  const renderTrueRoasInline = () => {
    if (!trueRoas) return <span>⏳ Loading True ROAS…</span>;
    const t = trueRoas;
    if (
      t.trueRoas == null &&
      (!t.offline || (t.offline.revenue || 0) === 0)
    ) {
      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            goToView(router, "true-roas");
          }}
          style={{ color: '#0f766e', textDecoration: "underline" }}
        >
          💡 Add offline revenue → unlock True ROAS
        </a>
      );
    }
    const uplift =
      t.reportedRoas && t.trueRoas
        ? +(((t.trueRoas / t.reportedRoas) - 1) * 100).toFixed(1)
        : null;
    return (
      <>
        <b style={{ color: "#34D399" }}>True ROAS:</b>{" "}
        {t.trueRoas != null ? t.trueRoas.toFixed(2) + "×" : "—"}{" "}
        <span style={{ opacity: 0.7 }}>
          (+${Math.round(t.offline?.revenue || 0).toLocaleString()} offline
          {uplift != null && uplift > 0 ? `, +${uplift}% vs reported` : ""})
        </span>
      </>
    );
  };

  const tileStyle: React.CSSProperties = {
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 14,
    padding: 18,
  };
  const tileLabel: React.CSSProperties = {
    fontSize: "0.7rem",
    opacity: 0.7,
    fontWeight: 700,
    letterSpacing: ".5px",
    textTransform: "uppercase",
    marginBottom: 6,
  };
  const tileVal: React.CSSProperties = {
    fontSize: "1.95rem",
    fontWeight: 800,
    lineHeight: 1.1,
  };
  const tileSub: React.CSSProperties = {
    fontSize: "0.66rem",
    opacity: 0.6,
    marginTop: 4,
  };

  const renderBody = () => {
    if (state === "loading")
      return (
        <div style={{ textAlign: "center", padding: 48, color: "#64748B" }}>
          ⏳ Pulling spend from Meta + Google + TikTok and conversions from
          Amplitude…
        </div>
      );
    if (state === "error" || !data)
      return (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 14,
            padding: 24,
            color: "#991B1B",
          }}
        >
          <b>⚠️ Could not load</b>
          <div style={{ fontSize: "0.85rem", marginTop: 6 }}>{error}</div>
        </div>
      );

    const j = data;
    const okCount = CHANNELS.filter((c) => j.channels[c.key].ok).length;
    return (
      <>
        {/* Blended Summary hero */}
        <div
          style={{
            background:
              "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            borderRadius: 18,
            padding: "28px 32px",
            color: "white",
            marginBottom: 22,
            boxShadow: "0 8px 28px rgba(15,23,42,.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 14,
              marginBottom: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "1.15rem" }}>📊</span>
              <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>
                Blended Summary
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {CHANNELS.map((c) => (
                <span
                  key={c.key}
                  title={`${c.name} · ${j.channels[c.key].ok ? "live" : "not connected"}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    fontSize: "0.85rem",
                    background: j.channels[c.key].ok ? c.color : "#475569",
                    opacity: j.channels[c.key].ok ? 1 : 0.4,
                  }}
                >
                  {c.icon}
                </span>
              ))}
            </div>
            <div
              style={{
                marginLeft: "auto",
                fontSize: "0.74rem",
                opacity: 0.7,
              }}
            >
              Last {Number(j.days) || 0} days · {okCount}/3 channels live
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 18,
            }}
          >
            <div style={tileStyle}>
              <div style={tileLabel}>Total Ad Spend</div>
              <div style={tileVal}>{fmtMoney(j.totalSpend)}</div>
            </div>
            <div style={tileStyle}>
              <div style={tileLabel}>MER</div>
              <div style={tileVal}>
                {j.mer != null ? j.mer.toFixed(1) + "%" : "—"}
              </div>
              <div style={tileSub}>Revenue ÷ Spend</div>
            </div>
            <div style={tileStyle}>
              <div style={tileLabel}>LTV/CAC</div>
              <div style={tileVal}>
                {j.ltvCac != null ? j.ltvCac.toFixed(2) : "—"}
              </div>
              <div style={tileSub}>
                {j.cac != null ? "CAC " + fmtMoney(j.cac) : "No CAC yet"}
                {j.ltvAssumed != null
                  ? " · LTV assumed " + fmtMoney(j.ltvAssumed)
                  : ""}
              </div>
            </div>
            <div style={tileStyle}>
              <div style={tileLabel}>Net Sales</div>
              <div style={tileVal}>
                {j.netSales != null ? fmtMoney(j.netSales) : "—"}
              </div>
              <div style={tileSub}>Revenue minus ad spend</div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginTop: 14,
              fontSize: "0.72rem",
              opacity: 0.75,
            }}
          >
            <span>
              <b>Customers:</b> {fmtNum(j.customers)}{" "}
              <span style={{ opacity: 0.7 }}>({j.customerSource})</span>
            </span>
            <span>
              <b>Total Revenue:</b>{" "}
              {j.totalRevenue ? fmtMoney(j.totalRevenue) : "—"}
            </span>
            <span>
              <b>Reported ROAS:</b>{" "}
              {j.roas != null ? j.roas.toFixed(2) + "×" : "—"}
            </span>
            <span style={{ color: '#0f766e' }}>{renderTrueRoasInline()}</span>
          </div>
        </div>

        {/* Per-channel breakdown */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 16,
            marginBottom: 22,
          }}
        >
          {CHANNELS.map((c) => {
            const d = j.channels[c.key];
            if (!d.ok) {
              const { headline, fixHint } = diagnose(c.key, d.error);
              const fixSecrets = SECRETS[c.key];
              return (
                <div
                  key={c.key}
                  style={{
                    background: "white",
                    border: "1px solid #E5E7EB",
                    borderRadius: 14,
                    padding: 20,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: "1.2rem" }}>{c.icon}</span>
                    <div style={{ fontWeight: 700, color: "#0F172A" }}>
                      {c.name}
                    </div>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: "0.66rem",
                        fontWeight: 700,
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: "#FEF2F2",
                        color: "#991B1B",
                        border: "1px solid #FECACA",
                      }}
                    >
                      NOT LIVE
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.82rem",
                      color: "#92400E",
                      background: "#FFFBEB",
                      border: "1px solid #FDE68A",
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      ⚠️ {headline}
                    </div>
                    <div style={{ fontSize: "0.78rem", lineHeight: 1.45 }}>
                      {fixHint}
                    </div>
                  </div>
                  {fixSecrets.length ? (
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "#64748B",
                        marginBottom: 6,
                      }}
                    >
                      <strong>Secrets to update:</strong>{" "}
                      {fixSecrets.map((s) => (
                        <code
                          key={s}
                          style={{
                            background: "#F1F5F9",
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontSize: "0.72rem",
                            marginRight: 4,
                          }}
                        >
                          {s}
                        </code>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => goToView(router, "settings")}
                    style={{
                      marginTop: 6,
                      background: "white",
                      color: "#0EA5E9",
                      border: "1.5px solid #0EA5E9",
                      padding: "7px 14px",
                      borderRadius: 8,
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ⚙️ Open Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => load(days)}
                    style={{
                      marginTop: 6,
                      marginLeft: 6,
                      background: "#F0F9FF",
                      color: "#0369A1",
                      border: "1px solid #BAE6FD",
                      padding: "7px 14px",
                      borderRadius: 8,
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    🔄 Retry
                  </button>
                </div>
              );
            }
            const hasRev = Number(d.revenue || 0) > 0;
            const metric = (label: string, value: string, color?: string) => (
              <div>
                <div
                  style={{
                    fontSize: "0.68rem",
                    color: "#64748B",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".4px",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontSize: "1.15rem",
                    fontWeight: 700,
                    color: color || "#0F172A",
                  }}
                >
                  {value}
                </div>
              </div>
            );
            return (
              <div
                key={c.key}
                style={{
                  background: "white",
                  border: "1px solid #E5E7EB",
                  borderRadius: 14,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 14,
                  }}
                >
                  <span
                    style={{
                      fontSize: "1.2rem",
                      display: "inline-flex",
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      background: c.color,
                      color: "white",
                    }}
                  >
                    {c.icon}
                  </span>
                  <div style={{ fontWeight: 700, color: "#0F172A" }}>
                    {c.name}
                  </div>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: "#ECFDF5",
                      color: "#065F46",
                      border: "1px solid #A7F3D0",
                    }}
                  >
                    LIVE
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2,1fr)",
                    gap: 12,
                  }}
                >
                  {metric("Ad Spend", fmtMoney(d.spend))}
                  {metric(
                    "Revenue",
                    hasRev ? fmtMoney(d.revenue) : "—",
                    hasRev ? "#059669" : "#94A3B8",
                  )}
                  {metric(
                    "ROAS",
                    d.roas != null ? d.roas.toFixed(2) + "×" : "—",
                    d.roas != null ? "#0F172A" : "#94A3B8",
                  )}
                  {metric(
                    "CPM",
                    d.cpm != null ? fmtMoney(d.cpm) : "—",
                    d.cpm != null ? "#0F172A" : "#94A3B8",
                  )}
                  <div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "#64748B",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: ".4px",
                      }}
                    >
                      Conversions
                    </div>
                    <div
                      style={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        color: "#475569",
                      }}
                    >
                      {fmtNum(d.conversions)}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "#64748B",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: ".4px",
                      }}
                    >
                      Clicks
                    </div>
                    <div
                      style={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        color: "#475569",
                      }}
                    >
                      {fmtNum(d.clicks)}
                    </div>
                  </div>
                </div>
                {!hasRev && (
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: "0.68rem",
                      color: "#94A3B8",
                    }}
                  >
                    Wire this campaign into the AI Optimizer to populate revenue
                    + ROAS + CPM.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Amplitude conversion source */}
        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 14,
            padding: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: "1.2rem" }}>📊</span>
            <div style={{ fontWeight: 700, color: "#0F172A" }}>
              Amplitude conversion source
            </div>
          </div>
          {j.amplitude.ok ? (
            (j.amplitude.conversions || 0) > 0 ? (
              <>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "#475569",
                    marginBottom: 10,
                  }}
                >
                  Counted{" "}
                  <b style={{ color: "#0F172A" }}>
                    {fmtNum(j.amplitude.conversions)}
                  </b>{" "}
                  conversions across these events:
                </div>
                <div
                  style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                >
                  {(j.amplitude.conversionEvents || []).map((e, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: "0.78rem",
                        padding: "5px 10px",
                        background: "#F1F5F9",
                        borderRadius: 999,
                        color: "#0F172A",
                      }}
                    >
                      <b>{e.event}</b>: {fmtNum(e.count)}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "#92400E",
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  borderRadius: 8,
                  padding: 11,
                }}
              >
                {j.amplitude.note || "No conversion-pattern events found."}{" "}
                Falling back to <b>ad-platform-reported conversions</b> for
                blended CAC.
              </div>
            )
          ) : (
            <div
              style={{
                fontSize: "0.85rem",
                color: "#991B1B",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                padding: 11,
              }}
            >
              ⚠️ Amplitude error: {j.amplitude.error || "unknown"}. CAC computed
              from ad-platform-reported conversions instead.
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: "0.78rem",
            color: "#64748B",
            lineHeight: 1.5,
          }}
        >
          <b>Note on ROAS:</b> {j.roasNote}
        </div>
      </>
    );
  };

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{
          background:
            "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: '#0f766e' }}>
                <span
                  className="bc-group"
                  style={{ color: '#0f766e' }}
                >
                  Grow
                </span>{" "}
                <span
                  className="bc-sep"
                  style={{ color: '#94a3b8' }}
                >
                  ›
                </span>{" "}
                Blended Performance
              </div>
              <h2 className="view-title">Blended Performance</h2>
              <p className="view-sub">
                One blended view of ad spend, customers, and CAC across Meta +
                Google + TikTok — using your Amplitude conversion events as
                ground truth instead of channel-reported numbers.
              </p>
            </div>
            <div className="vh-actions">
              <select
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10))}
                style={{
                  padding: "9px 12px",
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <button
                className="btn-refresh-solid"
                style={{ color: "#047857" }}
                onClick={() => load(days)}
              >
                ↻ Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 40 }}
      >
        {renderBody()}
      </div>
    </div>
  );
}
