"use client";

// Native React port of the legacy `serp` panel (was `initSerpView` +
// `runSerpSearch` + `renderSerpResults` + `#view-serp` in
// public/js/ig_drip_serp.js). Fetches live Google SERP results from the existing
// Express API (`GET /api/serp?q=&type=&num=&gl=&location=`). Quick-search chips
// are seeded from the legacy `window.analysisData` global. Reuses the legacy
// `serp-*` CSS classes (served via the global `/style.css`).
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useMemo, useState } from "react";

interface SerpResult {
  position?: number;
  domain?: string;
  date?: string;
  url?: string;
  title?: string;
  snippet?: string;
  favicon?: string;
}
interface SerpAd {
  domain?: string;
  url?: string;
  title?: string;
  snippet?: string;
}
interface KnowledgeGraph {
  title?: string;
  type?: string;
  description?: string;
}
interface SerpData {
  error?: string;
  aiGenerated?: boolean;
  relatedSearches?: string[];
  knowledgeGraph?: KnowledgeGraph | null;
  ads?: SerpAd[];
  organic?: SerpResult[];
  news?: SerpResult[];
  query?: string;
  location?: string;
  total?: number;
}
interface AnalysisCompetitor {
  name?: string;
}
interface AnalysisData {
  competitors?: AnalysisCompetitor[];
}

const GL_MAP: Record<string, string> = {
  Global: "",
  "United States": "us",
  "United Kingdom": "uk",
  Australia: "au",
  Canada: "ca",
  Germany: "de",
  France: "fr",
  India: "in",
  Singapore: "sg",
};

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

export default function Serp() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("United Kingdom");
  const [type, setType] = useState("search");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [data, setData] = useState<SerpData | null>(null);

  const chips = useMemo(() => {
    const comps = getAnalysisData().competitors;
    if (comps && comps.length) {
      return comps
        .slice(0, 4)
        .map((c) => c.name || "")
        .filter(Boolean);
    }
    return [
      "best fintech app",
      "online banking UK",
      "crypto exchange",
      "investment app",
    ];
  }, []);

  async function search(q: string) {
    const term = q.trim();
    if (!term) return;
    setStatus("loading");
    setError("");
    try {
      const gl = GL_MAP[location] !== undefined ? GL_MAP[location] : "us";
      const params = new URLSearchParams({ q: term, type, num: "10" });
      if (gl) params.set("gl", gl);
      if (location) params.set("location", location);
      const res = await fetch("/api/serp?" + params.toString(), {
        credentials: "same-origin",
      });
      const d = (await res.json()) as SerpData;
      if (!res.ok) {
        setStatus("error");
        setError(d.error || "Search failed");
        return;
      }
      setData(d);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Search failed");
    }
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Google Search
              </div>
              <h2 className="view-title">Google Search Intelligence</h2>
              <p className="view-sub">
                Live Google SERP results — track rankings, ads, and competitor
                visibility in real time
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 28, paddingBottom: 56 }}>
        <div className="serp-search-bar">
          <div className="serp-search-input-wrap">
            <svg
              className="serp-search-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="6.5"
                cy="6.5"
                r="5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M10.5 10.5L14 14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            <input
              className="serp-search-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(query)}
              placeholder="Search Google — e.g. best fintech app UK, revolut vs monzo…"
            />
          </div>
          <select
            className="serp-location-select"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="Global">🌐 Global (All Regions)</option>
            <option value="United States">🇺🇸 United States</option>
            <option value="United Kingdom">🇬🇧 United Kingdom</option>
            <option value="Australia">🇦🇺 Australia</option>
            <option value="Canada">🇨🇦 Canada</option>
            <option value="Germany">🇩🇪 Germany</option>
            <option value="France">🇫🇷 France</option>
            <option value="India">🇮🇳 India</option>
            <option value="Singapore">🇸🇬 Singapore</option>
          </select>
          <select
            className="serp-type-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="search">Organic</option>
            <option value="news">News</option>
          </select>
          <button className="serp-search-btn" onClick={() => search(query)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="5.8" cy="5.8" r="4.3" stroke="white" strokeWidth="1.5" />
              <path
                d="M9.2 9.2L13 13"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Search
          </button>
        </div>

        <div className="serp-quick-chips">
          <span className="serp-chip-label">Quick:</span>
          {chips.map((c) => (
            <button
              key={c}
              className="serp-chip"
              onClick={() => {
                setQuery(c);
                search(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div>
          {status === "idle" && (
            <div className="serp-empty-state">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle
                  cx="21"
                  cy="21"
                  r="14"
                  stroke="rgba(0,201,200,.3)"
                  strokeWidth="2.5"
                />
                <path
                  d="M30 30L42 42"
                  stroke="rgba(0,201,200,.3)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path
                  d="M15 21h12M21 15v12"
                  stroke="rgba(0,201,200,.25)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <p>Enter a search query above to fetch live Google results</p>
            </div>
          )}
          {status === "loading" && (
            <div className="serp-loading">
              <div className="serp-spinner" />
              Searching Google…
            </div>
          )}
          {status === "error" && (
            <div className="serp-empty-state">
              <p style={{ color: "rgba(255,100,100,.7)" }}>⚠ {error}</p>
            </div>
          )}
          {status === "done" && data && <SerpResults data={data} onSearch={(q) => { setQuery(q); search(q); }} />}
        </div>
      </div>
    </div>
  );
}

function SerpResults({
  data,
  onSearch,
}: {
  data: SerpData;
  onSearch: (q: string) => void;
}) {
  const results = data.news && data.news.length ? data.news : data.organic || [];

  const kg = data.knowledgeGraph;
  const ads = data.ads || [];
  const related = data.relatedSearches || [];

  const sidebar = (
    <>
      {kg && (
        <div className="serp-sidebar-panel">
          <div className="serp-sidebar-title">Knowledge Panel</div>
          {kg.title && <div className="serp-kg-name">{kg.title}</div>}
          {kg.type && <div className="serp-kg-type">{kg.type}</div>}
          {kg.description && <div className="serp-kg-desc">{kg.description}</div>}
        </div>
      )}
      {ads.length > 0 && (
        <div className="serp-sidebar-panel">
          <div className="serp-sidebar-title">Paid Ads ({ads.length})</div>
          <div className="serp-ads-list">
            {ads.map((ad, i) => (
              <div key={i}>
                {i > 0 && (
                  <hr
                    style={{
                      border: "none",
                      borderTop: "1px solid rgba(255,255,255,.06)",
                      margin: "8px 0",
                    }}
                  />
                )}
                <div className="serp-ads-item-domain">{ad.domain || ""}</div>
                <a
                  href={ad.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="serp-ads-item-title"
                >
                  {ad.title}
                </a>
                <div className="serp-ads-item-snippet">{ad.snippet}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {related.length > 0 && (
        <div className="serp-sidebar-panel">
          <div className="serp-sidebar-title">Related Searches</div>
          <div>
            {related.map((r) => (
              <button
                key={r}
                className="serp-related-chip"
                onClick={() => onSearch(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const hasSidebar = kg || ads.length > 0 || related.length > 0;

  const resultCards = results.length ? (
    results.map((r, i) => (
      <div key={i} className="serp-result-card">
        <div className="serp-result-top">
          <img
            className="serp-favicon"
            src={r.favicon}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="serp-position">#{r.position}</span>
          <span className="serp-domain">{r.domain || ""}</span>
          {r.date && <span className="serp-date">{r.date}</span>}
        </div>
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="serp-result-title"
        >
          {r.title}
        </a>
        <div className="serp-result-snippet">{r.snippet || ""}</div>
      </div>
    ))
  ) : (
    <div className="serp-empty-state">
      <p>No results found</p>
    </div>
  );

  return (
    <>
      {data.aiGenerated && (
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: "1rem" }}>🤖</span>
          <div>
            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#92400E",
              }}
            >
              AI-Generated Search Intelligence
            </div>
            <div
              style={{ fontSize: "0.72rem", color: "#78350F", marginTop: 2 }}
            >
              Live Google Search API not available for your RapidAPI key —
              results generated by InfoGenie AI. Subscribe to a{" "}
              <a
                href="https://rapidapi.com/search/google%20search"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#D97706" }}
              >
                Google Search API on RapidAPI
              </a>{" "}
              for live results.
            </div>
          </div>
        </div>
      )}
      <div className="serp-meta-bar">
        <div className="serp-meta-query">
          Results for <strong>&quot;{data.query}&quot;</strong> — {data.location}
        </div>
        {data.total ? (
          <div className="serp-meta-total">
            ~{Number(data.total).toLocaleString()} results
          </div>
        ) : null}
      </div>
      {hasSidebar ? (
        <div className="serp-results-grid">
          <div>{resultCards}</div>
          <div className="serp-sidebar">{sidebar}</div>
        </div>
      ) : (
        resultCards
      )}
    </>
  );
}
