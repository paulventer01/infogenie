"use client";

// Native React port of the legacy `backlinks` panel (was `window.buildBacklinks`
// + `#view-backlinks` / `#blWrap` in index.html, plus `_blResearch` deep-research
// in public/js/ig_seo.js). Pulls backlink intel for a domain from the existing
// Express API via `lib/api`:
//   POST /api/backlinks/summary            { target }
//   POST /api/backlinks/referring-domains  { target, limit }
//   POST /api/backlinks/anchors            { target, limit }
//   POST /api/backlinks/pages              { target, limit }
//   POST /api/backlinks/breakdown          { target }
// The "Find Link Prospects" button hands the domain to the Link Prospector view
// via the legacy `window._lpPresetDomain` global + cross-view navigation.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Summary {
  backlinks?: number;
  referring_domains?: number;
  rank?: number;
  broken?: number;
}
interface SummaryResult {
  ok: boolean;
  error?: string;
  note?: string;
  source?: string;
  summary?: Summary;
}
interface ReferringDomain {
  domain?: string;
  rank?: number;
  backlinks?: number;
  country?: string;
  first_seen?: string;
}
interface DomainsResult {
  ok: boolean;
  error?: string;
  domains?: ReferringDomain[];
}
interface Anchor {
  anchor?: string;
  backlinks?: number;
  referring_domains?: number;
}
interface AnchorsResult {
  ok: boolean;
  note?: string;
  anchors?: Anchor[];
}
interface TopPage {
  url?: string;
  backlinks?: number;
  referring_domains?: number;
  rank?: number;
}
interface PagesResult {
  ok: boolean;
  note?: string;
  pages?: TopPage[];
}
interface TldRow {
  tld?: string;
  domains?: number;
  backlinks?: number;
}
interface CountryRow {
  country?: string;
  domains?: number;
  backlinks?: number;
}
interface BreakdownResult {
  ok: boolean;
  note?: string;
  tlds?: TldRow[];
  countries?: CountryRow[];
}

const fmt = (n: number | undefined) => Number(n || 0).toLocaleString();

export default function Backlinks() {
  const router = useRouter();
  const [target, setTarget] = useState("nike.com");

  const [analyzeStatus, setAnalyzeStatus] = useState<
    "idle" | "loading" | "error" | "done"
  >("idle");
  const [analyzeError, setAnalyzeError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryNote, setSummaryNote] = useState("");
  const [domains, setDomains] = useState<ReferringDomain[]>([]);

  const [researchStatus, setResearchStatus] = useState<
    "idle" | "loading" | "error" | "done"
  >("idle");
  const [researchError, setResearchError] = useState("");
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [pages, setPages] = useState<TopPage[]>([]);
  const [tlds, setTlds] = useState<TldRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [researchNote, setResearchNote] = useState("");

  async function runAnalyze() {
    const t = target.trim();
    if (!t) {
      setAnalyzeStatus("error");
      setAnalyzeError("⚠️ Target required");
      return;
    }
    setAnalyzeStatus("loading");
    setAnalyzeError("");
    const [sumR, domR] = await Promise.all([
      apiPost<SummaryResult>("/api/backlinks/summary", { target: t }),
      apiPost<DomainsResult>("/api/backlinks/referring-domains", {
        target: t,
        limit: 50,
      }),
    ]);
    if (!sumR.ok && !domR.ok) {
      setAnalyzeStatus("error");
      setAnalyzeError(sumR.error || domR.error || "failed");
      return;
    }
    setSummary(sumR.summary || {});
    setSummaryNote(sumR.note || "");
    setDomains(domR.domains || []);
    setAnalyzeStatus("done");
    if (sumR.ok && sumR.source !== "placeholder") {
      try {
        document.dispatchEvent(new CustomEvent("ig:journey-updated"));
      } catch {
        /* noop */
      }
    }
  }

  async function runResearch() {
    const t = target.trim();
    if (!t) {
      setResearchStatus("error");
      setResearchError("⚠️ Enter a target first");
      return;
    }
    setResearchStatus("loading");
    setResearchError("");
    const [anc, pgs, brk] = await Promise.all([
      apiPost<AnchorsResult>("/api/backlinks/anchors", { target: t, limit: 25 }),
      apiPost<PagesResult>("/api/backlinks/pages", { target: t, limit: 25 }),
      apiPost<BreakdownResult>("/api/backlinks/breakdown", { target: t }),
    ]);
    setAnchors(anc.anchors || []);
    setPages(pgs.pages || []);
    setTlds(brk.tlds || []);
    setCountries(brk.countries || []);
    setResearchNote(anc.note || pgs.note || brk.note || "");
    setResearchStatus("done");
  }

  function findProspects() {
    const d = target.trim();
    if (d) {
      (window as unknown as { _lpPresetDomain?: string })._lpPresetDomain = d;
    }
    goToView(router, "link-prospector");
  }

  const stat = (label: string, val: string, tint: string) => (
    <div style={{ background: tint, borderRadius: 10, padding: "14px 16px", flex: 1 }}>
      <div
        style={{
          fontSize: "0.66rem",
          fontWeight: 800,
          color: "#6B7280",
          letterSpacing: ".06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color: "#0A1628",
          marginTop: 3,
        }}
      >
        {val}
      </div>
    </div>
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Backlink Intel
              </div>
              <h2 className="view-title">🔗 Backlink Intel</h2>
              <p className="view-sub">
                See who&apos;s linking to any domain — total backlinks, referring
                domains, top sources by authority. Powered by DataForSEO.
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
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                Target domain
              </label>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runAnalyze()}
                placeholder="e.g. nike.com"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.88rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <button
              onClick={runAnalyze}
              disabled={analyzeStatus === "loading"}
              style={{
                padding: "10px 22px",
                background: "#059669",
                border: "2px solid #059669",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              🔗 Analyze
            </button>
          </div>
        </div>

        <div>
          {analyzeStatus === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Pulling backlink data…
            </div>
          )}
          {analyzeStatus === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {analyzeError}
            </div>
          )}
          {analyzeStatus === "done" && summary && (
            <>
              {summaryNote && (
                <div
                  style={{
                    background: "#FEF3C7",
                    color: "#92400E",
                    padding: "10px 14px",
                    borderRadius: 8,
                    fontSize: "0.78rem",
                    marginBottom: 14,
                  }}
                >
                  {summaryNote}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 18,
                  flexWrap: "wrap",
                }}
              >
                {stat("Backlinks", fmt(summary.backlinks), "#ECFDF5")}
                {stat("Referring Domains", fmt(summary.referring_domains), "#EFF6FF")}
                {stat("Authority Rank", fmt(summary.rank), "#FEF3C7")}
                {stat("Broken Links", fmt(summary.broken), "#FEE2E2")}
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid #E5E7EB",
                    fontWeight: 800,
                    color: "#0A1628",
                  }}
                >
                  🌐 Top Referring Domains ({domains.length})
                </div>
                {domains.length ? (
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.85rem",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#F9FAFB" }}>
                        <th style={thLeft}>DOMAIN</th>
                        <th style={thRight}>RANK</th>
                        <th style={thRight}>BACKLINKS</th>
                        <th style={thLeft}>COUNTRY</th>
                        <th style={thLeft}>FIRST SEEN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domains.map((d, i) => (
                        <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                          <td
                            style={{
                              padding: "9px 14px",
                              color: "#0A1628",
                              fontWeight: 600,
                            }}
                          >
                            {d.domain || ""}
                          </td>
                          <td style={tdRight}>{fmt(d.rank)}</td>
                          <td style={tdRight}>{fmt(d.backlinks)}</td>
                          <td style={{ padding: "9px 14px", color: "#6B7280" }}>
                            {d.country || "—"}
                          </td>
                          <td
                            style={{
                              padding: "9px 14px",
                              color: "#6B7280",
                              fontSize: "0.78rem",
                            }}
                          >
                            {d.first_seen
                              ? new Date(d.first_seen).toLocaleDateString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "#9CA3AF",
                      fontSize: "0.85rem",
                    }}
                  >
                    No referring domains returned.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={runResearch}
            disabled={researchStatus === "loading"}
            style={{
              padding: "10px 22px",
              background: "#fff",
              border: "2px solid #0f766e",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#0f766e",
              cursor: "pointer",
            }}
          >
            🔬 Deep Research (Anchors · Top Pages · TLDs · Countries)
          </button>
          <button
            onClick={findProspects}
            style={{
              padding: "10px 22px",
              background: "#EFF6FF",
              border: "2px solid #3B82F6",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#1D4ED8",
              cursor: "pointer",
            }}
          >
            🎯 Find Link Prospects
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          {researchStatus === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                color: "#6B7280",
              }}
            >
              ⏳ Pulling deep research dimensions…
            </div>
          )}
          {researchStatus === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {researchError}
            </div>
          )}
          {researchStatus === "done" && (
            <>
              {researchNote && (
                <div
                  style={{
                    background: "#FEF3C7",
                    color: "#92400E",
                    padding: "10px 14px",
                    borderRadius: 8,
                    fontSize: "0.78rem",
                    marginBottom: 12,
                  }}
                >
                  {researchNote}
                </div>
              )}
              <ResearchTable
                title="🪧 Top Anchor Texts"
                headers={["ANCHOR", "BACKLINKS", "REF DOMAINS"]}
                rightFrom={1}
                rows={anchors.map((a) => [
                  a.anchor || "(empty)",
                  fmt(a.backlinks),
                  fmt(a.referring_domains),
                ])}
              />
              <ResearchTable
                title="🏆 Top Linked Pages (yours)"
                headers={["PAGE", "BACKLINKS", "REF DOMAINS", "RANK"]}
                rightFrom={1}
                rows={pages.map((p) => [
                  p.url || "",
                  fmt(p.backlinks),
                  fmt(p.referring_domains),
                  fmt(p.rank),
                ])}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <ResearchTable
                  title="🌐 Top Linking TLDs"
                  headers={["TLD", "DOMAINS", "BACKLINKS"]}
                  rightFrom={1}
                  rows={tlds.map((t) => [
                    t.tld || "",
                    fmt(t.domains),
                    fmt(t.backlinks),
                  ])}
                />
                <ResearchTable
                  title="🗺️ Top Linking Countries"
                  headers={["COUNTRY", "DOMAINS", "BACKLINKS"]}
                  rightFrom={1}
                  rows={countries.map((c) => [
                    c.country || "",
                    fmt(c.domains),
                    fmt(c.backlinks),
                  ])}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const thLeft: React.CSSProperties = {
  padding: "9px 14px",
  textAlign: "left",
  color: "#6B7280",
  fontSize: "0.7rem",
  fontWeight: 800,
  letterSpacing: ".06em",
};
const thRight: React.CSSProperties = { ...thLeft, textAlign: "right" };
const tdRight: React.CSSProperties = {
  padding: "9px 14px",
  textAlign: "right",
  color: "#374151",
};

function ResearchTable({
  title,
  headers,
  rows,
  rightFrom,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  rightFrom: number;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #E5E7EB",
          fontWeight: 800,
          color: "#0A1628",
        }}
      >
        {title}
      </div>
      {rows.length ? (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.83rem",
          }}
        >
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              {headers.map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 14px",
                    textAlign: i >= rightFrom ? "right" : "left",
                    color: "#6B7280",
                    fontSize: "0.68rem",
                    fontWeight: 800,
                    letterSpacing: ".06em",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ borderTop: "1px solid #F3F4F6" }}>
                {r.map((c, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "7px 14px",
                      textAlign: ci >= rightFrom ? "right" : "left",
                      color: ci === 0 ? "#0A1628" : "#374151",
                    }}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div
          style={{
            padding: 18,
            textAlign: "center",
            color: "#9CA3AF",
            fontSize: "0.82rem",
          }}
        >
          No data returned.
        </div>
      )}
    </div>
  );
}
