"use client";

// Native React port of the legacy `cross-channel` panel (was `buildCrossChannel`
// / `runCrossChannel` / `renderCrossChannel` + the ad-platform connection strip
// and setup modal in public/js/ig_mentions_gaps.js + `#view-cross-channel`).
// Pulls a unified paid/organic/earned report from the existing Express API
// (`/api/cross-channel-report`, `/api/ad-platforms/status`).

import { useEffect, useState } from "react";
import { useToast } from "@/hooks/useToast";

interface CampaignLike {
  domain?: string;
  url?: string;
  brand?: string;
  businessName?: string;
}

function getCurrentCampaign(): CampaignLike {
  if (typeof window === "undefined") return {};
  return (window as unknown as { currentCampaign?: CampaignLike }).currentCampaign || {};
}

interface PlatformStatus {
  meta?: boolean;
  googleAds?: boolean;
  tiktok?: boolean;
  microsoft?: boolean;
}

interface ChannelTotals {
  spend?: number;
  clicks?: number;
  conversions?: number;
  cpc?: number;
  cpa?: number;
}

interface PaidChannel {
  ok: boolean;
  name: string;
  icon?: string;
  spend?: number;
  clicks?: number;
  conversions?: number;
}

interface CrossChannelReport {
  ok: boolean;
  error?: string;
  days?: number;
  dataSource?: string;
  confidence?: string;
  dataOrigin?: string;
  summary?: string;
  paid?: { totals?: ChannelTotals; channels?: PaidChannel[] };
  organic?: { ok?: boolean; organicTraffic?: number; organicKeywords?: number; paidTraffic?: number; paidKeywords?: number };
  earned?: { ok?: boolean; mentions?: number; total?: number };
}

interface AdPlatformDef {
  name: string;
  icon: string;
  color: string;
  envVars: string[];
  steps: React.ReactNode[];
  timeline: string;
}

const linkStyle: React.CSSProperties = { color: "#0066FF" };

const AD_PLATFORM_DEFS: Record<string, AdPlatformDef> = {
  meta: {
    name: "Meta Ads (Facebook + Instagram)",
    icon: "📘",
    color: "#1877F2",
    envVars: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"],
    steps: [
      <>
        Go to{" "}
        <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener" style={linkStyle}>
          developers.facebook.com/apps
        </a>{" "}
        and create a new app (type: Business).
      </>,
      <>
        Add the <strong>Marketing API</strong> product to your app.
      </>,
      <>
        Generate a long-lived <strong>System User access token</strong> with the <code>ads_read</code> and{" "}
        <code>ads_management</code> permissions.
      </>,
      <>
        Copy your Ad Account ID from{" "}
        <a href="https://business.facebook.com/adsmanager" target="_blank" rel="noopener" style={linkStyle}>
          Ads Manager
        </a>{" "}
        (the number after <code>act=</code> in the URL).
      </>,
      <>
        Add both values as Replit secrets: <code>META_ACCESS_TOKEN</code> and <code>META_AD_ACCOUNT_ID</code>.
      </>,
    ],
    timeline: "Same day — no Meta review needed for personal use.",
  },
  google: {
    name: "Google Ads",
    icon: "🔵",
    color: "#4285F4",
    envVars: [
      "GOOGLE_ADS_DEVELOPER_TOKEN",
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_REFRESH_TOKEN",
      "GOOGLE_ADS_CUSTOMER_ID",
    ],
    steps: [
      <>
        Apply for a <strong>Google Ads Developer Token</strong> from your MCC manager account at{" "}
        <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener" style={linkStyle}>
          ads.google.com/aw/apicenter
        </a>
        . Approval takes 1–3 business days.
      </>,
      <>
        Create an OAuth 2.0 Client ID in{" "}
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" style={linkStyle}>
          Google Cloud Console → Credentials
        </a>{" "}
        (type: Desktop app).
      </>,
      <>
        Generate a <strong>refresh token</strong> using Google&apos;s OAuth 2.0 Playground or the <code>oauth2l</code> CLI
        with scope <code>https://www.googleapis.com/auth/adwords</code>.
      </>,
      <>Find your Customer ID in the top-right of any Google Ads page (format: 123-456-7890).</>,
      <>Add all five values as Replit secrets.</>,
    ],
    timeline: "1–3 business days for the developer token approval.",
  },
  tiktok: {
    name: "TikTok Ads",
    icon: "⬛",
    color: "#010101",
    envVars: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID"],
    steps: [
      <>
        Sign up for{" "}
        <a href="https://ads.tiktok.com/marketing_api" target="_blank" rel="noopener" style={linkStyle}>
          TikTok for Business — Marketing API
        </a>{" "}
        and create a developer app.
      </>,
      <>Submit the app for basic-tier approval (usually granted within 24 hours).</>,
      <>
        After approval, generate an <strong>access token</strong> from the app dashboard.
      </>,
      <>
        Copy your Advertiser ID from{" "}
        <a href="https://ads.tiktok.com" target="_blank" rel="noopener" style={linkStyle}>
          TikTok Ads Manager
        </a>{" "}
        (top-right of any campaigns page).
      </>,
      <>
        Add both values as Replit secrets: <code>TIKTOK_ACCESS_TOKEN</code> and <code>TIKTOK_ADVERTISER_ID</code>.
      </>,
    ],
    timeline: "Approx. 24 hours for app approval.",
  },
  microsoft: {
    name: "Microsoft Ads (Bing)",
    icon: "🅱️",
    color: "#00A4EF",
    envVars: [
      "MICROSOFT_ADS_DEVELOPER_TOKEN",
      "MICROSOFT_ADS_CLIENT_ID",
      "MICROSOFT_ADS_CLIENT_SECRET",
      "MICROSOFT_ADS_REFRESH_TOKEN",
      "MICROSOFT_ADS_CUSTOMER_ID",
      "MICROSOFT_ADS_ACCOUNT_ID",
    ],
    steps: [
      <>
        Apply for a <strong>Microsoft Advertising Developer Token</strong> at{" "}
        <a href="https://developers.ads.microsoft.com/Account" target="_blank" rel="noopener" style={linkStyle}>
          developers.ads.microsoft.com/Account
        </a>
        . Sandbox tokens are instant; production tokens take ~3 business days.
      </>,
      <>
        Register an Azure AD app at{" "}
        <a href="https://portal.azure.com" target="_blank" rel="noopener" style={linkStyle}>
          portal.azure.com
        </a>{" "}
        → App registrations → New registration. Set redirect URI to{" "}
        <code>https://login.microsoftonline.com/common/oauth2/nativeclient</code> and add API permissions for{" "}
        <strong>Microsoft Advertising</strong> with the <code>ads.manage</code> scope.
      </>,
      <>
        Copy the <strong>Application (client) ID</strong> and create a client secret under Certificates &amp; secrets —
        copy the <em>Value</em>, not the ID.
      </>,
      <>
        Generate a <strong>refresh token</strong> by visiting the auth URL with your client_id (Microsoft&apos;s OAuth
        docs have a one-page walkthrough), then exchanging the code for tokens.
      </>,
      <>
        Find your <strong>Customer ID</strong> and <strong>Account ID</strong> in Microsoft Advertising under Tools →
        Accounts &amp; Billing (top-right shows both numbers).
      </>,
      <>Add all six values as Replit secrets.</>,
    ],
    timeline: "Approx. 1–3 business days for production developer token.",
  },
};

const fmtMoney = (n?: number) => "$" + (n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtNum = (n?: number) => (n || 0).toLocaleString("en-US");

export default function CrossChannel() {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<CrossChannelReport | null>(null);
  const [loadingNote, setLoadingNote] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [setupKey, setSetupKey] = useState<string | null>(null);

  async function loadStatus() {
    let s: PlatformStatus = { meta: false, googleAds: false, tiktok: false, microsoft: false };
    try {
      const r = await fetch("/api/ad-platforms/status", { credentials: "same-origin" });
      if (r.ok) s = (await r.json()) as PlatformStatus;
    } catch {
      /* render with all-disconnected fallback */
    }
    setStatus(s);
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function runReport() {
    const camp = getCurrentCampaign();
    const domain =
      (camp.domain || camp.url || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .split("/")[0] || "";
    const brand = camp.brand || camp.businessName || "";

    setRunning(true);
    setReport(null);
    setReportError(null);
    setLoadingNote(
      `⏳ Pulling live data from Meta, Google Ads, TikTok${domain ? ", organic SERP" : ""}${
        brand ? ", earned media" : ""
      }…`,
    );
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (domain) params.set("domain", domain);
      if (brand) params.set("brand", brand);
      const r = await fetch("/api/cross-channel-report?" + params.toString(), { credentials: "same-origin" });
      const j = (await r.json()) as CrossChannelReport;
      if (!j.ok) throw new Error(j.error || "Report failed");
      setReport(j);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Report failed");
    } finally {
      setRunning(false);
      setLoadingNote(null);
    }
  }

  function renderConnections() {
    if (!status) {
      return (
        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 14,
            padding: "14px 18px",
            fontSize: "0.78rem",
            color: "#6B7280",
          }}
        >
          ⏳ Checking ad platform connections…
        </div>
      );
    }
    const map = [
      { key: "meta", on: !!status.meta },
      { key: "google", on: !!status.googleAds },
      { key: "microsoft", on: !!status.microsoft },
      { key: "tiktok", on: !!status.tiktok },
    ];
    const allOn = map.every((m) => m.on);
    const noneOn = map.every((m) => !m.on);
    const bannerStyle: React.CSSProperties = allOn
      ? {
          background: "linear-gradient(135deg,rgba(5,150,105,.08),rgba(5,150,105,.02))",
          border: "1px solid rgba(5,150,105,.25)",
          color: "#065F46",
        }
      : noneOn
        ? {
            background: "linear-gradient(135deg,rgba(217,119,6,.08),rgba(217,119,6,.02))",
            border: "1px solid rgba(217,119,6,.25)",
            color: "#92400E",
          }
        : {
            background: "linear-gradient(135deg,rgba(0,102,255,.06),rgba(0,201,200,.04))",
            border: "1px solid rgba(0,102,255,.2)",
            color: "#0C4A6E",
          };
    const bannerText = allOn ? (
      <>✅ All ad platforms connected — your Cross-Channel Report is pulling live data.</>
    ) : noneOn ? (
      <>
        ⚠️ No ad platforms connected — click <strong>Connect now</strong> on any channel below to see the setup steps.
        Each requires credentials from that platform.
      </>
    ) : (
      <>
        🟡 {map.filter((m) => m.on).length} of {map.length} ad platforms connected — connect the rest for a full unified
        report.
      </>
    );
    return (
      <>
        <div style={{ ...bannerStyle, fontWeight: 700, fontSize: "0.78rem", padding: "12px 16px", borderRadius: "12px 12px 0 0" }}>
          {bannerText}
        </div>
        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderTop: "none",
            borderRadius: "0 0 14px 14px",
            padding: "14px 18px",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
            Channels
          </span>
          {map.map((m) => {
            const def = AD_PLATFORM_DEFS[m.key];
            const dot = m.on ? "#10B981" : "#9CA3AF";
            const label = m.on ? "Connected" : "Not connected";
            return (
              <button
                key={m.key}
                onClick={() => setSetupKey(m.key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: m.on ? "#F0FDF4" : "#F9FAFB",
                  border: `1px solid ${m.on ? "#BBF7D0" : "#E5E7EB"}`,
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: "0.74rem",
                  fontWeight: 600,
                  color: "#0F172A",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }}></span>
                <span>
                  {def.icon} {def.name.split(" (")[0]}
                </span>
                <span style={{ color: m.on ? "#059669" : "#9CA3AF", fontWeight: 700 }}>{label}</span>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  function renderResults() {
    if (reportError) {
      return <div className="cg-error">⚠️ {reportError}</div>;
    }
    if (running) {
      return <div className="cg-loading">{loadingNote}</div>;
    }
    if (!report) {
      return (
        <div className="cg-empty">
          Click <strong>Generate report</strong> to pull live data from all connected channels.
        </div>
      );
    }
    const d = report;
    const t = d.paid?.totals || {};
    return (
      <>
        <div className="mt-ribbon">
          <span className="mt-ribbon-dot" style={{ background: "#0891B2" }}></span>
          <span>📊 {d.dataSource || ""}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span style={{ textTransform: "uppercase", letterSpacing: ".04em", fontSize: ".65rem" }}>
            {d.confidence || "medium"} confidence
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span style={{ fontWeight: 500, opacity: 0.85 }}>{d.dataOrigin || ""}</span>
        </div>
        <div className="ccr-summary-card">
          <div className="ccr-summary-h">📋 Executive summary</div>
          <div className="ccr-summary-body">{d.summary || ""}</div>
        </div>
        <div className="ccr-totals">
          <div className="ccr-total">
            <div className="ccr-total-l">Total paid spend</div>
            <div className="ccr-total-v">{fmtMoney(t.spend)}</div>
          </div>
          <div className="ccr-total">
            <div className="ccr-total-l">Total clicks</div>
            <div className="ccr-total-v">{fmtNum(t.clicks)}</div>
          </div>
          <div className="ccr-total">
            <div className="ccr-total-l">Total conversions</div>
            <div className="ccr-total-v">{fmtNum(t.conversions)}</div>
          </div>
          <div className="ccr-total">
            <div className="ccr-total-l">Blended CPC</div>
            <div className="ccr-total-v">${(t.cpc || 0).toFixed(2)}</div>
          </div>
          <div className="ccr-total">
            <div className="ccr-total-l">Blended CPA</div>
            <div className="ccr-total-v">{t.cpa && t.cpa > 0 ? "$" + t.cpa.toFixed(2) : "—"}</div>
          </div>
        </div>
        <div className="ccr-channels">
          {(d.paid?.channels || []).map((c, i) => {
            if (!c.ok) {
              const platformKey = /meta|facebook/i.test(c.name)
                ? "meta"
                : /google/i.test(c.name)
                  ? "google"
                  : /tiktok/i.test(c.name)
                    ? "tiktok"
                    : "";
              return (
                <div className="ccr-channel ccr-channel-off" key={i}>
                  <div className="ccr-ch-head">
                    <span className="ccr-ch-icon">{c.icon || ""}</span>
                    <span>{c.name}</span>
                  </div>
                  <div className="ccr-ch-status">Not connected</div>
                  {platformKey ? (
                    <button
                      onClick={() => setSetupKey(platformKey)}
                      style={{
                        marginTop: 8,
                        padding: "7px 14px",
                        background: "linear-gradient(135deg,#0066FF,#00C9C8)",
                        border: "none",
                        borderRadius: 8,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        color: "white",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      🔌 Connect now
                    </button>
                  ) : null}
                </div>
              );
            }
            const cpc = (c.clicks || 0) > 0 ? (c.spend || 0) / (c.clicks || 1) : 0;
            const cpa = (c.conversions || 0) > 0 ? (c.spend || 0) / (c.conversions || 1) : 0;
            return (
              <div className="ccr-channel" key={i}>
                <div className="ccr-ch-head">
                  <span className="ccr-ch-icon">{c.icon || ""}</span>
                  <span>{c.name}</span>
                  <span className="ccr-ch-live">LIVE</span>
                </div>
                <div className="ccr-ch-stats">
                  <div>
                    <div className="ccr-stat-l">Spend</div>
                    <div className="ccr-stat-v">{fmtMoney(c.spend)}</div>
                  </div>
                  <div>
                    <div className="ccr-stat-l">Clicks</div>
                    <div className="ccr-stat-v">{fmtNum(c.clicks)}</div>
                  </div>
                  <div>
                    <div className="ccr-stat-l">Conv.</div>
                    <div className="ccr-stat-v">{fmtNum(c.conversions)}</div>
                  </div>
                  <div>
                    <div className="ccr-stat-l">CPC</div>
                    <div className="ccr-stat-v">${cpc.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="ccr-stat-l">CPA</div>
                    <div className="ccr-stat-v">{cpa > 0 ? "$" + cpa.toFixed(2) : "—"}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {d.organic?.ok ? (
          <div className="ccr-card">
            <h4 className="mt-h">🔎 Organic visibility</h4>
            <div className="ccr-org-stats">
              <div>
                <div className="ccr-stat-l">Organic traffic (est.)</div>
                <div className="ccr-stat-v">{fmtNum(d.organic.organicTraffic)}/mo</div>
              </div>
              <div>
                <div className="ccr-stat-l">Ranking keywords</div>
                <div className="ccr-stat-v">{fmtNum(d.organic.organicKeywords)}</div>
              </div>
              <div>
                <div className="ccr-stat-l">Paid traffic (est.)</div>
                <div className="ccr-stat-v">{fmtNum(d.organic.paidTraffic)}/mo</div>
              </div>
              <div>
                <div className="ccr-stat-l">Paid keywords</div>
                <div className="ccr-stat-v">{fmtNum(d.organic.paidKeywords)}</div>
              </div>
            </div>
          </div>
        ) : null}
        {d.earned?.ok ? (
          <div className="ccr-card">
            <h4 className="mt-h">📰 Earned media (last {d.days} days)</h4>
            <div className="ccr-org-stats">
              <div>
                <div className="ccr-stat-l">Mentions in window</div>
                <div className="ccr-stat-v">{fmtNum(d.earned.mentions)}</div>
              </div>
              <div>
                <div className="ccr-stat-l">Mentions all-time (in SERP)</div>
                <div className="ccr-stat-v">{fmtNum(d.earned.total)}</div>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  const setupDef = setupKey ? AD_PLATFORM_DEFS[setupKey] : null;

  return (
    <div className="view" id="view-cross-channel">
      <div className="view-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" }}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: '#0f766e' }}>
                <span className="bc-group" style={{ color: "rgba(167,243,208,.75)" }}>
                  Manage
                </span>{" "}
                <span className="bc-sep" style={{ color: '#94a3b8' }}>
                  ›
                </span>{" "}
                Cross-Channel Report
              </div>
              <h2 className="view-title">Cross-Channel Report</h2>
              <p className="view-sub">
                Unified view across Meta, Google Ads, TikTok, organic search, and earned media — with an AI-written
                executive summary.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="container" id="crossChannelWrap" style={{ paddingTop: 24, paddingBottom: 60 }}>
        <div style={{ marginBottom: 18 }}>{renderConnections()}</div>
        <div className="ccr-controls">
          <div className="ccr-control" style={{ flex: "0 0 130px" }}>
            <label className="cg-lbl">Time window</label>
            <select
              className="cg-input"
              value={days}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10) || 30;
                setDays(v);
              }}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          <div className="ccr-control" style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-end" }}>
            <button className="cg-btn-run" disabled={running} onClick={runReport}>
              {running ? "⏳ Pulling…" : "🌐 Generate report"}
            </button>
          </div>
        </div>
        <div id="ccrResults" style={{ marginTop: 24 }}>
          {renderResults()}
        </div>
      </div>

      {setupDef && setupKey && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSetupKey(null);
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 18,
              maxWidth: 640,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 25px 80px rgba(0,0,0,.4)",
            }}
          >
            <div
              style={{
                background: `linear-gradient(135deg,${setupDef.color},#0066FF)`,
                padding: "22px 26px",
                borderRadius: "18px 18px 0 0",
                color: "white",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.1rem", fontWeight: 800 }}>
                    🔌 Connect {setupDef.name}
                  </div>
                  <div style={{ fontSize: "0.78rem", opacity: 0.85, marginTop: 4 }}>{setupDef.timeline}</div>
                </div>
                <button
                  onClick={() => setSetupKey(null)}
                  style={{
                    background: "rgba(255,255,255,.15)",
                    border: "none",
                    color: "white",
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    fontSize: "1rem",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div style={{ padding: "22px 26px" }}>
              <div
                style={{
                  background: "#FFFBEB",
                  border: "1px solid #FCD34D",
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginBottom: 18,
                  fontSize: "0.8rem",
                  color: "#78350F",
                  lineHeight: 1.55,
                }}
              >
                <strong>⚠️ Setup requires credentials from the platform.</strong> InfoGenie cannot fetch live data until
                you complete these steps and add the credentials as Replit secrets. Once added, refresh this page and the
                channel will show <strong style={{ color: "#059669" }}>Connected</strong>.
              </div>
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: 8,
                }}
              >
                Required Replit secrets
              </div>
              <div style={{ marginBottom: 18 }}>
                {setupDef.envVars.map((v) => (
                  <code
                    key={v}
                    style={{
                      display: "inline-block",
                      background: '#eef4ff',
                      color: "#67E8F9",
                      padding: "3px 9px",
                      borderRadius: 6,
                      fontSize: "0.74rem",
                      fontFamily: "'JetBrains Mono',monospace",
                      margin: "2px 4px 2px 0",
                    }}
                  >
                    {v}
                  </code>
                ))}
              </div>
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: 8,
                }}
              >
                Setup steps
              </div>
              <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {setupDef.steps.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
                    <div
                      style={{
                        flexShrink: 0,
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg,#0066FF,#00C9C8)",
                        color: "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: "0.78rem",
                      }}
                    >
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, fontSize: "0.84rem", color: "#0F172A", lineHeight: 1.55 }}>{s}</div>
                  </li>
                ))}
              </ol>
            </div>
            <div
              style={{
                padding: "14px 26px",
                borderTop: "1px solid #F1F5F9",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                background: "#FAFBFC",
                borderRadius: "0 0 18px 18px",
              }}
            >
              <button
                onClick={() => setSetupKey(null)}
                style={{
                  padding: "10px 20px",
                  background: "white",
                  border: "1px solid #E5E7EB",
                  borderRadius: 9,
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
              <button
                onClick={() => {
                  setSetupKey(null);
                  loadStatus();
                  toast("🔄 Re-checking connection status…");
                }}
                style={{
                  padding: "10px 20px",
                  background: "linear-gradient(135deg,#0066FF,#00C9C8)",
                  border: "none",
                  borderRadius: 9,
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                ↻ Re-check status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
