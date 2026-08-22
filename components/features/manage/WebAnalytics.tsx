"use client";

// Native React port of the legacy `web-analytics` panel (was
// `window.buildWebAnalytics` in public/js/ig_manage_pack.js +
// `#view-web-analytics`). Read-only dashboard: pulls summary / acquisition /
// behaviour / mobile in parallel from the existing Express API
// (`/api/web-analytics/*`) via lib/api and renders KPIs, channel + landing-page
// tables, and PageSpeed mobile attention list.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { safeUrl } from "@/lib/utils";

interface Summary {
  ga4_connected?: boolean;
  sessions?: number;
  impressions?: number;
  spend_cents?: number;
}
interface Channel {
  channel: string;
  sessions?: number;
  impressions?: number;
}
interface LandingPage {
  url?: string;
  title?: string;
  score?: number | null;
}
interface MobilePage {
  url?: string;
  mobile_score?: number | null;
  mobile_lcp_ms?: number | null;
  mobile_cls?: number | null;
}

function money(cents: number) {
  return (
    "$" +
    ((cents || 0) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export default function WebAnalytics() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [mobile, setMobile] = useState<MobilePage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sum, acq, beh, mob] = await Promise.all([
          apiGet<Summary>("/api/web-analytics/summary"),
          apiGet<{ channels: Channel[] }>("/api/web-analytics/acquisition"),
          apiGet<{ landing_pages: LandingPage[] }>("/api/web-analytics/behaviour"),
          apiGet<{ pages: MobilePage[] }>("/api/web-analytics/mobile"),
        ]);
        if (cancelled) return;
        setSummary(sum);
        setChannels(acq.channels || []);
        setPages(beh.landing_pages || []);
        setMobile(mob.pages || []);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = summary
    ? [
        { label: "Sessions (30d)", val: (summary.sessions || 0).toLocaleString(), color: "#0EA5E9" },
        {
          label: "Impressions (30d)",
          val: (summary.impressions || 0).toLocaleString(),
          color: "#0284c7",
        },
        { label: "Ad Spend (30d)", val: money(summary.spend_cents || 0), color: "#16A34A" },
      ]
    : [];

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#0F172A" }}>📈 Web Analytics</h1>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.92rem" }}>
            Acquisition · Behaviour · Mobile — derived from your tracked sites + ad-platform
            insights.
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          {error ? (
            <div
              style={{
                background: "#FEE2E2",
                border: "1px solid #FCA5A5",
                color: "#B91C1C",
                borderRadius: 10,
                padding: 14,
              }}
            >
              Failed to load analytics: {error}
            </div>
          ) : summary && !summary.ga4_connected ? (
            <div
              style={{
                background: "#FEF3C7",
                border: "1px solid #F59E0B",
                borderRadius: 10,
                padding: 14,
                color: "#92400E",
                fontSize: "0.88rem",
              }}
            >
              ℹ️ <strong>GA4 not connected</strong> — showing data derived from your ad-platform
              insights and tracked-site audits. To unlock full Source/Medium, Country, and real
              session/exit data, connect Google Analytics in{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  goToView(router, "settings");
                }}
                style={{ color: "#92400E", fontWeight: 700 }}
              >
                Settings → Integrations
              </a>
              .
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {kpis.map((k) => (
            <div
              key={k.label}
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div
                style={{
                  fontSize: "0.74rem",
                  color: "#64748B",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {k.label}
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 800, color: k.color }}>{k.val}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#0F172A", fontSize: "1rem" }}>
              🤝 Acquisition — Channels (last 30d)
            </h3>
            <div>
              {loaded && channels.length === 0 ? (
                <div
                  style={{
                    color: "#94A3B8",
                    textAlign: "center",
                    padding: 20,
                    fontSize: "0.88rem",
                  }}
                >
                  No ad-platform data ingested yet.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr
                      style={{
                        textAlign: "left",
                        color: "#64748B",
                        fontSize: "0.76rem",
                        borderBottom: "1px solid #E5E7EB",
                      }}
                    >
                      <th style={{ padding: 6 }}>Channel</th>
                      <th style={{ padding: 6 }}>Sessions</th>
                      <th style={{ padding: 6 }}>Impressions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map((c, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: 6, fontWeight: 600 }}>{c.channel}</td>
                        <td style={{ padding: 6, fontWeight: 700 }}>
                          {(c.sessions || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: 6 }}>{(c.impressions || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#0F172A", fontSize: "1rem" }}>
              📄 Behaviour — Top Landing Pages
            </h3>
            <div>
              {loaded && pages.length === 0 ? (
                <div
                  style={{
                    color: "#94A3B8",
                    textAlign: "center",
                    padding: 20,
                    fontSize: "0.88rem",
                  }}
                >
                  No landing-page data yet. Run a Landing Pages audit to populate.
                </div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {pages.slice(0, 12).map((p, i) => (
                    <li key={i} style={{ marginBottom: 6, fontSize: "0.86rem" }}>
                      <a
                        href={safeUrl(p.url || "")}
                        target="_blank"
                        rel="noopener"
                        style={{ color: "#0EA5E9", textDecoration: "none" }}
                      >
                        {p.title || p.url}
                      </a>{" "}
                      {p.score != null ? (
                        <span style={{ color: "#64748B", fontSize: "0.78rem" }}>· score {p.score}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
          }}
        >
          <h3 style={{ margin: "0 0 12px", color: "#0F172A", fontSize: "1rem" }}>
            📱 Mobile — Pages needing attention (PageSpeed)
          </h3>
          <div>
            {loaded && mobile.length === 0 ? (
              <div
                style={{
                  color: "#94A3B8",
                  textAlign: "center",
                  padding: 20,
                  fontSize: "0.88rem",
                }}
              >
                No mobile audits yet. Run Web Vitals to populate.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      color: "#64748B",
                      fontSize: "0.76rem",
                      borderBottom: "1px solid #E5E7EB",
                    }}
                  >
                    <th style={{ padding: 6 }}>URL</th>
                    <th style={{ padding: 6 }}>Mobile Score</th>
                    <th style={{ padding: 6 }}>LCP (ms)</th>
                    <th style={{ padding: 6 }}>CLS</th>
                  </tr>
                </thead>
                <tbody>
                  {mobile.slice(0, 12).map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: 6, fontSize: "0.84rem" }}>
                        <a
                          href={safeUrl(p.url || "")}
                          target="_blank"
                          rel="noopener"
                          style={{ color: "#0EA5E9", textDecoration: "none" }}
                        >
                          {p.url || ""}
                        </a>
                      </td>
                      <td
                        style={{
                          padding: 6,
                          fontWeight: 700,
                          color:
                            (p.mobile_score ?? 0) >= 80
                              ? "#16A34A"
                              : (p.mobile_score ?? 0) >= 50
                                ? "#F59E0B"
                                : "#DC2626",
                        }}
                      >
                        {p.mobile_score != null ? p.mobile_score : "—"}
                      </td>
                      <td style={{ padding: 6 }}>{p.mobile_lcp_ms || "—"}</td>
                      <td style={{ padding: 6 }}>{p.mobile_cls || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
