"use client";

// Native React port of the legacy `linkedin-ads` panel (was
// `window.buildLinkedinAds` + `#view-linkedin-ads` in ig_intel_pack_b.js).
// AI-researches a competitor's LinkedIn advertising via the existing Express
// API (`GET /api/linkedin-ads/history`, `POST /api/linkedin-ads/search`)
// through `lib/api`. See `docs/react-panel-migration.md` for the pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface HistoryItem {
  company: string;
  created_at?: string;
}
interface HistoryResponse {
  ok?: boolean;
  history?: HistoryItem[];
}
interface Targeting {
  likely_audiences?: string[];
  job_titles?: string[];
  industries?: string[];
  seniority?: string[];
}
interface AdResult {
  company?: string;
  posting_cadence?: string;
  budget_signal?: string;
  overview?: string;
  ad_formats?: Record<string, unknown>[];
  copy_themes?: Record<string, unknown>[];
  targeting?: Targeting;
  gaps_to_exploit?: string[];
  top_performing_angles?: string[];
}
interface SearchResponse {
  ok: boolean;
  error?: string;
  result?: AdResult;
}

export default function LinkedinAds() {
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AdResult | null>(null);

  async function loadHistory() {
    const d = await apiGet<HistoryResponse>("/api/linkedin-ads/history");
    setHistory(d.history || []);
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function search() {
    const c = company.trim();
    if (!c) {
      alert("Enter a company name.");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const d = await apiPost<SearchResponse>("/api/linkedin-ads/search", {
      company: c,
      industry: industry.trim(),
    });
    if (!d.ok) {
      setStatus("error");
      setError(d.error || "failed");
      return;
    }
    setResult(d.result || {});
    setStatus("idle");
    void loadHistory();
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> LinkedIn Ad Spy
              </div>
              <h2 className="view-title">💼 LinkedIn Ad Spy</h2>
              <p className="view-sub">
                Research any competitor&apos;s LinkedIn advertising strategy — ad
                formats, copy themes, targeting signals, creative style, budget
                tier, and gaps you can exploit. Powered by AI research against
                the LinkedIn Ad Library.
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
            maxWidth: 900,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3
              style={{
                margin: "0 0 4px",
                fontSize: "1rem",
                fontWeight: 700,
                color: "#111",
              }}
            >
              Research Competitor LinkedIn Ads
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: "0.83rem",
                color: "#6B7280",
              }}
            >
              AI-powered research against the LinkedIn Ad Library — ad formats,
              copy themes, targeting signals, budget tier and gaps to exploit.
            </p>
            <input
              placeholder="Company name (e.g. HubSpot)"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 14px",
                border: "1px solid #D1D5DB",
                borderRadius: 8,
                fontSize: "0.9rem",
                marginBottom: 10,
              }}
            />
            <input
              placeholder="Industry (optional)"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 14px",
                border: "1px solid #D1D5DB",
                borderRadius: 8,
                fontSize: "0.9rem",
                marginBottom: 14,
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={search}
                disabled={status === "loading"}
                style={{
                  flex: 1,
                  padding: 11,
                  background: "#0077B5",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                🔍 Research Ads
              </button>
              <button
                onClick={() =>
                  window.open("https://www.linkedin.com/ad-library/", "_blank")
                }
                style={{
                  padding: "11px 14px",
                  background: "#F9FAFB",
                  border: "1px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  cursor: "pointer",
                }}
              >
                Open Library ↗
              </button>
            </div>
          </div>

          <div
            style={{
              background: "#EFF6FF",
              border: "1px solid #BFDBFE",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <h4
              style={{
                margin: "0 0 10px",
                fontSize: "0.9rem",
                fontWeight: 700,
                color: "#1D4ED8",
              }}
            >
              Recent Searches
            </h4>
            {history.length === 0 ? (
              <p style={{ fontSize: "0.83rem", color: "#6B7280", margin: 0 }}>
                No searches yet.
              </p>
            ) : (
              history.slice(0, 5).map((h, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                    cursor: "pointer",
                  }}
                  onClick={() => setCompany(h.company)}
                >
                  <span
                    style={{
                      fontSize: "0.84rem",
                      fontWeight: 600,
                      color: "#1D4ED8",
                    }}
                  >
                    💼 {h.company}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "#9CA3AF",
                      marginLeft: "auto",
                    }}
                  >
                    {h.created_at
                      ? new Date(h.created_at).toLocaleDateString()
                      : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 32,
                textAlign: "center",
                color: "#6B7280",
              }}
            >
              <div style={{ fontSize: "1.4rem", marginBottom: 8 }}>🔍</div>
              Researching {company} LinkedIn ads — this takes 10–20 seconds...
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                color: "#DC2626",
                padding: 16,
                background: "#FEF2F2",
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <ResultView result={result} fallbackCompany={company} />
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        padding: "18px 20px",
        marginBottom: 14,
      }}
    >
      <h4
        style={{
          margin: "0 0 10px",
          fontSize: "0.9rem",
          fontWeight: 700,
          color: "#111",
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function Table({
  rows,
  cols,
}: {
  rows?: Record<string, unknown>[];
  cols: string[];
}) {
  if (!rows || !rows.length)
    return (
      <p style={{ color: "#9CA3AF", fontSize: "0.83rem", margin: "8px 0" }}>
        No data available.
      </p>
    );
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "0.83rem",
        marginTop: 8,
      }}
    >
      <thead>
        <tr>
          {cols.map((c) => (
            <th
              key={c}
              style={{
                padding: "8px 12px",
                textAlign: "left",
                background: "#F9FAFB",
                borderBottom: "2px solid #E5E7EB",
                fontWeight: 700,
                color: "#374151",
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
            {Object.values(row).map((v, vi) => (
              <td key={vi} style={{ padding: "8px 12px", color: "#374151" }}>
                {String(v ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Chips({ arr }: { arr?: string[] }) {
  if (!arr || !arr.length)
    return (
      <span style={{ color: "#9CA3AF", fontSize: "0.83rem" }}>
        Not available
      </span>
    );
  return (
    <>
      {arr.map((s, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            padding: "4px 12px",
            margin: 3,
            borderRadius: 12,
            background: "#F0F7FF",
            border: "1px solid #BFDBFE",
            color: "#1D4ED8",
            fontSize: "0.8rem",
          }}
        >
          {String(s)}
        </span>
      ))}
    </>
  );
}

function ResultView({
  result: x,
  fallbackCompany,
}: {
  result: AdResult;
  fallbackCompany: string;
}) {
  const company = x.company || fallbackCompany;
  const labelCell = (k: string, arr?: string[]) => (
    <div>
      <div
        style={{
          fontSize: "0.78rem",
          fontWeight: 700,
          color: "#6B7280",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {k}
      </div>
      <Chips arr={arr} />
    </div>
  );
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          background: "#0077B5",
          color: "#fff",
          padding: "16px 20px",
          borderRadius: 12,
        }}
      >
        <span style={{ fontSize: "1.5rem" }}>💼</span>
        <div>
          <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
            {company} — LinkedIn Ad Intelligence
          </div>
          <div style={{ fontSize: "0.84rem", opacity: 0.85, marginTop: 2 }}>
            {x.posting_cadence ? "Cadence: " + x.posting_cadence : ""}{" "}
            {x.budget_signal ? "· Budget: " + x.budget_signal : ""}
          </div>
        </div>
        <a
          href={`https://www.linkedin.com/ad-library/search?q=${encodeURIComponent(company)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            marginLeft: "auto",
            padding: "8px 14px",
            background: "rgba(255,255,255,0.2)",
            borderRadius: 8,
            color: "#fff",
            textDecoration: "none",
            fontSize: "0.83rem",
            fontWeight: 600,
          }}
        >
          View Library ↗
        </a>
      </div>

      <Section title="Overview">
        <p
          style={{
            margin: 0,
            fontSize: "0.88rem",
            color: "#374151",
            lineHeight: 1.6,
          }}
        >
          {x.overview || "No overview available."}
        </p>
      </Section>

      <Section title="Ad Formats Used">
        <Table rows={x.ad_formats} cols={["Format", "Usage", "Frequency"]} />
      </Section>

      <Section title="Copy Themes & CTAs">
        <Table
          rows={x.copy_themes}
          cols={["Theme", "Example Headline", "Example CTA"]}
        />
      </Section>

      <Section title="Targeting Signals">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {labelCell("Likely Audiences", x.targeting?.likely_audiences)}
          {labelCell("Job Titles", x.targeting?.job_titles)}
          {labelCell("Industries", x.targeting?.industries)}
          {labelCell("Seniority", x.targeting?.seniority)}
        </div>
      </Section>

      <Section title="Gaps to Exploit">
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          {x.gaps_to_exploit?.length ? (
            x.gaps_to_exploit.map((g, i) => (
              <li
                key={i}
                style={{
                  fontSize: "0.85rem",
                  color: "#374151",
                  marginBottom: 6,
                  lineHeight: 1.5,
                }}
              >
                {g}
              </li>
            ))
          ) : (
            <li style={{ color: "#9CA3AF" }}>No gaps identified.</li>
          )}
        </ol>
      </Section>

      {x.top_performing_angles && x.top_performing_angles.length > 0 && (
        <Section title="Top Performing Angles">
          <Chips arr={x.top_performing_angles} />
        </Section>
      )}
    </div>
  );
}
