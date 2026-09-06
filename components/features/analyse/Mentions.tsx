"use client";

// Native React port of the legacy `mentions` panel (Mention Tracker — was
// `buildMentionTracker` / `runMentionTracker` + `#view-mentions` / `#mentionsWrap`
// in index.html / ig_mentions_gaps.js). Pulls brand + competitor mentions from
// Google News (via DataForSEO) with AI sentiment, across one-or-many regions,
// then renders a sentiment breakdown, per-brand table, top sources, a daily
// share-of-voice line chart (Chart.js, loaded globally as window.Chart) and a
// recent-mentions feed. Talks to the Express API via `lib/api`:
//   POST /api/mentions  { brand, competitors, country, days }
// Brand + competitor defaults come from the legacy `window.analysisData` global.
// Reuses the global `mt-*` styles from style.css (loaded in the dashboard layout).

import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost, type ApiResult } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
  url?: string;
}
interface AnalysisData {
  brandName?: string;
  sectorOnly?: boolean;
  industry?: { name?: string };
  url?: string;
  competitors?: (AnalysisCompetitor | string)[];
}

interface Mention {
  brand?: string;
  url?: string;
  title?: string;
  snippet?: string;
  source?: string;
  date?: string;
  sentiment?: string;
  sentimentReason?: string;
}
interface SovBucket {
  date: string;
  byBrand: Record<string, number>;
}
interface SentCounts {
  positive: number;
  neutral: number;
  negative: number;
}
interface MentionsResult extends ApiResult {
  brand?: string;
  competitors?: string[];
  country?: string;
  days?: number;
  mentions?: Mention[];
  byBrand?: Record<string, number>;
  byBrandSent?: Record<string, SentCounts>;
  sentiment?: SentCounts;
  sov?: SovBucket[];
  topSources?: { source: string; count: number }[];
  total?: number;
  dataOrigin?: string;
  dataSource?: string;
  confidence?: string;
}

interface ChartInstance {
  destroy(): void;
}
interface ChartCtor {
  new (canvas: HTMLCanvasElement, config: unknown): ChartInstance;
}

const BRAND_COLORS = ["#0066FF", "#10B981", "#F59E0B", "#EC4899", "#0284c7"];

const COUNTRIES: [string, string][] = [
  ["GLOBAL", "🌍 Global (worldwide)"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["IE", "Ireland"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["BE", "Belgium"],
  ["CH", "Switzerland"],
  ["AT", "Austria"],
  ["PT", "Portugal"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
  ["PL", "Poland"],
  ["CZ", "Czech Republic"],
  ["HU", "Hungary"],
  ["RO", "Romania"],
  ["GR", "Greece"],
  ["UA", "Ukraine"],
  ["RU", "Russia"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["IN", "India"],
  ["SG", "Singapore"],
  ["MY", "Malaysia"],
  ["TH", "Thailand"],
  ["ID", "Indonesia"],
  ["PH", "Philippines"],
  ["VN", "Vietnam"],
  ["BR", "Brazil"],
  ["MX", "Mexico"],
  ["AR", "Argentina"],
  ["CL", "Chile"],
  ["CO", "Colombia"],
  ["ZA", "South Africa"],
  ["NG", "Nigeria"],
  ["KE", "Kenya"],
  ["EG", "Egypt"],
  ["AE", "UAE"],
  ["SA", "Saudi Arabia"],
  ["IL", "Israel"],
  ["TR", "Turkey"],
];

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}

// Mirrors legacy _getBrandFromAnalysis: sector name for sector-only analyses,
// otherwise the uppercased domain stem.
function deriveBrand(a: AnalysisData): string {
  if (!a) return "";
  if (a.sectorOnly)
    return String(a.industry?.name || a.url || "")
      .replace(/^#/, "")
      .trim();
  const dom = String(a.url || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .split("/")[0];
  if (!dom) return "";
  const stem = dom.replace(/^www\./, "").split(".")[0];
  return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : "";
}

// Mirrors legacy _getCompetitorsFromAnalysis → [{ name, domain }].
function deriveCompetitors(a: AnalysisData): { name: string; domain: string }[] {
  const list = Array.isArray(a.competitors) ? a.competitors : [];
  return list
    .map((c) => {
      if (typeof c === "string") {
        const d = c
          .replace(/^https?:\/\//i, "")
          .replace(/\/$/, "")
          .split("/")[0]
          .toLowerCase();
        return { name: d.split(".")[0], domain: d };
      }
      const name = String(c.name || "").trim();
      const domain = String(c.domain || c.url || "")
        .replace(/^https?:\/\//i, "")
        .replace(/\/$/, "")
        .split("/")[0]
        .toLowerCase();
      return { name: name || domain.split(".")[0], domain };
    })
    .filter((c) => c.name || c.domain);
}

interface MultiOption {
  value: string;
  label: string;
}

function MultiSelect({
  options,
  selected,
  emptyLabel,
  onChange,
}: {
  options: MultiOption[];
  selected: string[];
  emptyLabel: string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("click", off);
    return () => document.removeEventListener("click", off);
  }, [open]);

  const summary = !options.length
    ? "No options available"
    : selected.length === 0
      ? emptyLabel
      : selected.length === options.length
        ? `All ${options.length} selected`
        : selected.length === 1
          ? options.find((o) => o.value === selected[0])?.label || "1 selected"
          : `${selected.length} of ${options.length} selected`;

  function flip(value: string, checked: boolean) {
    if (checked) onChange(Array.from(new Set([...selected, value])));
    else onChange(selected.filter((v) => v !== value));
  }
  function all(checked: boolean) {
    onChange(checked ? options.map((o) => o.value) : []);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "9px 12px",
          border: "1px solid #CBD5E1",
          borderRadius: 7,
          background: "white",
          textAlign: "left",
          fontSize: "0.85rem",
          color: selected.length ? "#0F172A" : "#94A3B8",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        <span style={{ color: "#64748B", flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid #CBD5E1",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(15,23,42,.12)",
            zIndex: 50,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {options.length === 0 ? (
            <div
              style={{
                padding: 14,
                color: "#94A3B8",
                fontSize: "0.82rem",
                textAlign: "center",
              }}
            >
              No competitors detected — run a website analysis on the home page
              first.
            </div>
          ) : (
            <>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  borderBottom: "1px solid #F1F5F9",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "#0F172A",
                  background: "#F8FAFC",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.length === options.length}
                  onChange={(e) => all(e.target.checked)}
                />
                Select all
              </label>
              {options.map((o) => (
                <label
                  key={o.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    cursor: "pointer",
                    fontSize: "0.82rem",
                    color: "#0F172A",
                    borderBottom: "1px solid #F8FAFC",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={(e) => flip(o.value, e.target.checked)}
                  />
                  {o.label}
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const SENT_STYLES: Record<string, { bg: string; color: string; icon: string }> =
  {
    positive: { bg: "#DCFCE7", color: "#166534", icon: "😊" },
    neutral: { bg: "#F1F5F9", color: "#475569", icon: "😐" },
    negative: { bg: "#FEE2E2", color: "#991B1B", icon: "☹️" },
  };

export default function Mentions() {
  const detectedCompetitors = useMemo(
    () => deriveCompetitors(getAnalysisData()),
    [],
  );
  const competitorOptions = useMemo<MultiOption[]>(
    () => detectedCompetitors.map((c) => ({ value: c.name, label: c.name })),
    [detectedCompetitors],
  );
  const countryOptions = useMemo<MultiOption[]>(
    () => COUNTRIES.map(([value, label]) => ({ value, label })),
    [],
  );
  const initialBrand = useMemo(() => {
    const a = getAnalysisData();
    return a.brandName || deriveBrand(a) || "";
  }, []);

  const [brand, setBrand] = useState(initialBrand);
  const [selectedComps, setSelectedComps] = useState<string[]>(() =>
    competitorOptions.map((o) => o.value).slice(0, 4),
  );
  const [selectedCountries, setSelectedCountries] = useState<string[]>([
    "GLOBAL",
  ]);
  const [days, setDays] = useState(30);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, elapsed: 0 });
  const [error, setError] = useState("");
  const [data, setData] = useState<MentionsResult | null>(null);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<ChartInstance | null>(null);

  async function run() {
    const b = brand.trim();
    if (!b) {
      showToast("⚠️ Enter your brand name");
      return;
    }
    const competitors = selectedComps.slice(0, 4);
    let countries = selectedCountries.slice();
    if (!countries.length) countries = ["GLOBAL"];
    if (countries.includes("GLOBAL")) countries = ["GLOBAL"];

    setLoading(true);
    setError("");
    setData(null);
    const startedAt = Date.now();
    setProgress({ done: 0, total: countries.length, elapsed: 0 });
    const tick = setInterval(() => {
      setProgress((p) => ({
        ...p,
        elapsed: Math.floor((Date.now() - startedAt) / 1000),
      }));
    }, 1000);

    try {
      const responses = new Array<MentionsResult>(countries.length);
      let cursor = 0;
      let done = 0;
      const CONCURRENCY = 12;
      const worker = async () => {
        while (cursor < countries.length) {
          const myIdx = cursor++;
          const country = countries[myIdx];
          const r = await apiPost<MentionsResult>("/api/mentions", {
            brand: b,
            competitors,
            country,
            days,
          });
          responses[myIdx] = r;
          done++;
          setProgress((p) => ({ ...p, done }));
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, countries.length) }, worker),
      );
      clearInterval(tick);

      const okResp = responses.find((r) => r.ok);
      if (!okResp) {
        throw new Error(
          responses.find((r) => !r.ok)?.error || "Failed to fetch mentions",
        );
      }
      const merged =
        responses.length === 1
          ? responses[0]
          : mergeResponses(responses, b, competitors, countries, days);
      setData(merged);
    } catch (e) {
      clearInterval(tick);
      setError(e instanceof Error ? e.message : "Failed to fetch mentions");
    } finally {
      setLoading(false);
    }
  }

  // Render the SoV line chart whenever new data lands.
  useEffect(() => {
    if (!data || !(data.total || 0) || !chartRef.current) return;
    const ChartLib = (window as unknown as { Chart?: ChartCtor }).Chart;
    if (!ChartLib) return;
    const allBrands = [data.brand || "", ...(data.competitors || [])];
    const sov = data.sov || [];
    const labels = sov.map((bk) => bk.date.slice(5));
    const datasets = allBrands.map((b, i) => ({
      label: b,
      data: sov.map((s) => s.byBrand[b] || 0),
      borderColor: BRAND_COLORS[i % BRAND_COLORS.length],
      backgroundColor: BRAND_COLORS[i % BRAND_COLORS.length] + "20",
      tension: 0.3,
      fill: false,
      borderWidth: 2,
      pointRadius: 2,
    }));
    if (chartInst.current) {
      try {
        chartInst.current.destroy();
      } catch {
        /* noop */
      }
    }
    chartInst.current = new ChartLib(chartRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 10 } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
          x: {
            ticks: {
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10,
            },
          },
        },
      },
    });
    return () => {
      if (chartInst.current) {
        try {
          chartInst.current.destroy();
        } catch {
          /* noop */
        }
        chartInst.current = null;
      }
    };
  }, [data]);

  return (
    <div>
      <div className="view-header-wrap">
        <div className="view-header ig-panel-hero">
          <div className="container">
            <div className="vh-inner">
              <div>
                <div className="breadcrumb">
                  <span className="bc-group">Analyse</span>{" "}
                  <span className="bc-sep">›</span> Web &amp; News Mentions
                </div>
                <h2 className="view-title">📰 Web &amp; News Mentions</h2>
                <p className="view-sub">
                  Monitors thousands of news sites, blogs, and online
                  publications for any mention of your brand, competitors, or
                  keywords — so you stay on top of press coverage and
                  third-party commentary.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-controls">
        <div className="mt-control">
          <label className="mt-lbl">Your brand</label>
          <input
            type="text"
            className="mt-input"
            placeholder="Acme Inc"
            value={brand}
            maxLength={80}
            onChange={(e) => setBrand(e.target.value)}
          />
        </div>
        <div className="mt-control" style={{ flex: 2 }}>
          <label className="mt-lbl">
            Competitors{" "}
            {detectedCompetitors.length ? (
              <span style={{ fontWeight: 400, color: "#64748B" }}>
                · {detectedCompetitors.length} detected from your analysis
              </span>
            ) : null}
          </label>
          <MultiSelect
            options={competitorOptions}
            selected={selectedComps}
            emptyLabel={
              detectedCompetitors.length
                ? "Select competitors"
                : "No competitors detected yet"
            }
            onChange={setSelectedComps}
          />
        </div>
        <div className="mt-control" style={{ flex: "0 0 220px" }}>
          <label className="mt-lbl">Country / region</label>
          <MultiSelect
            options={countryOptions}
            selected={selectedCountries}
            emptyLabel="Select country / region"
            onChange={setSelectedCountries}
          />
        </div>
        <div className="mt-control" style={{ flex: "0 0 110px" }}>
          <label className="mt-lbl">Window</label>
          <select
            className="mt-input"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10) || 30)}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <div
          style={{
            flex: "0 0 auto",
            justifyContent: "flex-end",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <button className="mt-btn-run" onClick={run} disabled={loading}>
            {loading ? "⏳ Pulling…" : "🔍 Pull mentions"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        {loading ? (
          <ProgressView
            brand={brand}
            competitorCount={selectedComps.length}
            progress={progress}
          />
        ) : error ? (
          <div className="mt-error">⚠️ {error}</div>
        ) : data ? (
          <Results data={data} chartRef={chartRef} />
        ) : (
          <div className="mt-empty">
            {brand ? (
              <>
                Click <strong>Pull mentions</strong> to analyse coverage for{" "}
                <strong>{brand}</strong>
                {competitorOptions.length
                  ? ` and ${selectedComps.length} competitor${selectedComps.length === 1 ? "" : "s"}`
                  : ""}
                .
              </>
            ) : (
              <>
                Run an analysis on the home page first, or type your brand name
                above and click <strong>Pull mentions</strong>.
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressView({
  brand,
  competitorCount,
  progress,
}: {
  brand: string;
  competitorCount: number;
  progress: { done: number; total: number; elapsed: number };
}) {
  const mm = String(Math.floor(progress.elapsed / 60)).padStart(2, "0");
  const ss = String(progress.elapsed % 60).padStart(2, "0");
  const brandCount = 1 + competitorCount;
  const pct = Math.max(
    4,
    (progress.done / Math.max(1, progress.total)) * 100,
  );
  return (
    <div className="mt-loading" style={{ textAlign: "center", padding: 24 }}>
      <div
        style={{
          fontSize: "0.95rem",
          fontWeight: 700,
          color: "#0F172A",
          marginBottom: 6,
        }}
      >
        ⏳ Pulling Google News for {brandCount} brand
        {competitorCount ? "s" : ""}
        {brand ? ` (${brand})` : ""}
      </div>
      <div
        style={{ fontSize: "0.82rem", color: "#475569", marginBottom: 10 }}
      >
        {progress.done} of {progress.total}{" "}
        {progress.total === 1 ? "region" : "regions"} complete · then classifying
        sentiment
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontFamily: "'Sora',sans-serif",
          fontWeight: 800,
          color: "#0066FF",
        }}
      >
        ⏱ {mm}:{ss}
      </div>
      <div
        style={{
          background: "#E2E8F0",
          borderRadius: 99,
          height: 8,
          marginTop: 12,
          maxWidth: 320,
          marginLeft: "auto",
          marginRight: "auto",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "linear-gradient(90deg,#0066FF,#00C9C8)",
            height: "100%",
            width: `${pct}%`,
            transition: "width .3s",
          }}
        />
      </div>
    </div>
  );
}

function Results({
  data,
  chartRef,
}: {
  data: MentionsResult;
  chartRef: React.RefObject<HTMLCanvasElement>;
}) {
  const total = data.total || 0;
  if (!total) {
    return (
      <div className="mt-empty">
        No mentions found in the last {data.days} days. Try a longer window or
        check the brand spelling.
      </div>
    );
  }
  const allBrands = [data.brand || "", ...(data.competitors || [])];
  const sentiment = data.sentiment || { positive: 0, neutral: 0, negative: 0 };
  const totalSent =
    sentiment.positive + sentiment.neutral + sentiment.negative;
  const sentPct = (k: keyof SentCounts) =>
    totalSent > 0 ? Math.round((sentiment[k] / totalSent) * 100) : 0;

  return (
    <>
      <div className="mt-ribbon">
        <span className="mt-ribbon-dot" style={{ background: "#10B981" }} />
        <span>📊 {data.dataSource || "DataForSEO"}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span
          style={{
            textTransform: "uppercase",
            letterSpacing: ".04em",
            fontSize: "0.65rem",
          }}
        >
          {data.confidence || "medium"} confidence
        </span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ fontWeight: 500, opacity: 0.85 }}>
          {data.dataOrigin || ""}
        </span>
      </div>

      <div className="mt-grid">
        <div className="mt-card mt-card-wide">
          <h4 className="mt-h">Sentiment breakdown</h4>
          <div className="mt-sent-bar">
            <div
              className="mt-sent-seg"
              style={{ width: `${sentPct("positive")}%`, background: "#10B981" }}
              title={`Positive: ${sentiment.positive}`}
            />
            <div
              className="mt-sent-seg"
              style={{ width: `${sentPct("neutral")}%`, background: "#94A3B8" }}
              title={`Neutral: ${sentiment.neutral}`}
            />
            <div
              className="mt-sent-seg"
              style={{ width: `${sentPct("negative")}%`, background: "#EF4444" }}
              title={`Negative: ${sentiment.negative}`}
            />
          </div>
          <div className="mt-sent-legend">
            <span>
              <span className="mt-dot" style={{ background: "#10B981" }} />{" "}
              Positive {sentiment.positive} ({sentPct("positive")}%)
            </span>
            <span>
              <span className="mt-dot" style={{ background: "#94A3B8" }} />{" "}
              Neutral {sentiment.neutral} ({sentPct("neutral")}%)
            </span>
            <span>
              <span className="mt-dot" style={{ background: "#EF4444" }} />{" "}
              Negative {sentiment.negative} ({sentPct("negative")}%)
            </span>
          </div>
        </div>

        <div className="mt-card">
          <h4 className="mt-h">Mentions by brand</h4>
          <table className="mt-table">
            <thead>
              <tr>
                <th>Brand</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Sentiment mix</th>
                <th style={{ textAlign: "right" }}>P/N/Ng</th>
              </tr>
            </thead>
            <tbody>
              {allBrands.map((b, i) => {
                const c = (data.byBrand || {})[b] || 0;
                const sb = (data.byBrandSent || {})[b] || {
                  positive: 0,
                  neutral: 0,
                  negative: 0,
                };
                const color = BRAND_COLORS[i % BRAND_COLORS.length];
                const t = sb.positive + sb.neutral + sb.negative;
                const pp = t ? (sb.positive / t) * 100 : 0;
                const pn = t ? (sb.neutral / t) * 100 : 0;
                const pg = t ? (sb.negative / t) * 100 : 0;
                return (
                  <tr key={b}>
                    <td style={{ fontWeight: 700 }}>
                      <span
                        className="mt-brand-dot"
                        style={{ background: color }}
                      />
                      {b}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{c}</td>
                    <td>
                      <div className="mt-mini-bar">
                        <span style={{ background: "#10B981", width: `${pp}%` }} />
                        <span style={{ background: "#94A3B8", width: `${pn}%` }} />
                        <span style={{ background: "#EF4444", width: `${pg}%` }} />
                      </div>
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color: "#64748b",
                        fontSize: ".78rem",
                      }}
                    >
                      {sb.positive}/{sb.neutral}/{sb.negative}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-card">
          <h4 className="mt-h">Top sources</h4>
          <table className="mt-table">
            <thead>
              <tr>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Mentions</th>
              </tr>
            </thead>
            <tbody>
              {(data.topSources || []).length ? (
                (data.topSources || []).map((s) => (
                  <tr key={s.source}>
                    <td>{s.source}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {s.count}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={2}
                    style={{ color: "#94a3b8", textAlign: "center" }}
                  >
                    No source data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-card mt-card-wide">
          <h4 className="mt-h">
            Daily share-of-voice — last {data.days} days
          </h4>
          <div style={{ position: "relative", height: 280, width: "100%" }}>
            <canvas ref={chartRef} />
          </div>
        </div>

        <div className="mt-card mt-card-wide">
          <h4 className="mt-h">
            Recent mentions ({(data.mentions || []).length})
          </h4>
          <div className="mt-mentions-list">
            {(data.mentions || []).slice(0, 60).map((m, i) => {
              let dateStr = "";
              if (m.date) {
                const t = Date.parse(m.date);
                if (!isNaN(t)) {
                  const ago = Math.floor((Date.now() - t) / 86400000);
                  dateStr =
                    ago === 0
                      ? "today"
                      : ago === 1
                        ? "yesterday"
                        : `${ago}d ago`;
                }
              }
              const cfg =
                SENT_STYLES[m.sentiment || "neutral"] || SENT_STYLES.neutral;
              return (
                <div className="mt-mention" key={i}>
                  <div className="mt-mention-head">
                    <span className="mt-mention-brand">{m.brand}</span>
                    <span
                      className="mt-sent-chip"
                      style={{ background: cfg.bg, color: cfg.color }}
                    >
                      {cfg.icon} {m.sentiment}
                    </span>
                    <span className="mt-mention-source">{m.source || ""}</span>
                    {dateStr && (
                      <span className="mt-mention-date">· {dateStr}</span>
                    )}
                  </div>
                  <a
                    className="mt-mention-title"
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.title}
                  </a>
                  {m.snippet && (
                    <div className="mt-mention-snip">{m.snippet}</div>
                  )}
                  {m.sentimentReason && (
                    <div className="mt-mention-why">💭 {m.sentimentReason}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// Multi-country merge — dedupe by brand + normalized URL, rebuild daily SoV
// buckets and aggregate counts. Mirrors the legacy merge in runMentionTracker.
function mergeResponses(
  responses: MentionsResult[],
  brand: string,
  competitors: string[],
  countries: string[],
  days: number,
): MentionsResult {
  const seen = new Set<string>();
  const allMentions: Mention[] = [];
  const byBrand: Record<string, number> = {};
  const byBrandSent: Record<string, SentCounts> = {};
  const sentiment: SentCounts = { positive: 0, neutral: 0, negative: 0 };
  const sourceCount: Record<string, number> = {};
  const allBrands = [brand, ...competitors];
  allBrands.forEach((b) => {
    byBrand[b] = 0;
    byBrandSent[b] = { positive: 0, neutral: 0, negative: 0 };
  });
  responses
    .filter((r) => r.ok)
    .forEach((r) => {
      (r.mentions || []).forEach((m) => {
        const urlKey = String(m.url || "")
          .toLowerCase()
          .replace(/[?#].*$/, "");
        const key = `${m.brand}::${urlKey}`;
        if (seen.has(key)) return;
        seen.add(key);
        allMentions.push(m);
        if (m.brand) {
          byBrand[m.brand] = (byBrand[m.brand] || 0) + 1;
          byBrandSent[m.brand] = byBrandSent[m.brand] || {
            positive: 0,
            neutral: 0,
            negative: 0,
          };
          const s = (m.sentiment || "neutral") as keyof SentCounts;
          byBrandSent[m.brand][s] = (byBrandSent[m.brand][s] || 0) + 1;
          sentiment[s] = (sentiment[s] || 0) + 1;
        }
        if (m.source) sourceCount[m.source] = (sourceCount[m.source] || 0) + 1;
      });
    });
  allMentions.sort((a, b) => {
    const ta = a.date ? Date.parse(a.date) : 0;
    const tb = b.date ? Date.parse(b.date) : 0;
    return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sov: SovBucket[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const dt = new Date(today.getTime() - d * 86400000);
    const bucket: SovBucket = {
      date: dt.toISOString().slice(0, 10),
      byBrand: {},
    };
    allBrands.forEach((b) => {
      bucket.byBrand[b] = 0;
    });
    sov.push(bucket);
  }
  allMentions.forEach((m) => {
    if (!m.date) return;
    const t = Date.parse(m.date);
    if (isNaN(t)) return;
    const dt = new Date(t);
    dt.setUTCHours(0, 0, 0, 0);
    const key = dt.toISOString().slice(0, 10);
    const bucket = sov.find((b) => b.date === key);
    if (bucket && m.brand)
      bucket.byBrand[m.brand] = (bucket.byBrand[m.brand] || 0) + 1;
  });
  const topSources = Object.entries(sourceCount)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  return {
    ok: true,
    brand,
    competitors,
    country: countries.join("+"),
    days,
    mentions: allMentions,
    byBrand,
    byBrandSent,
    sentiment,
    sov,
    topSources,
    total: allMentions.length,
    dataOrigin: `DataForSEO Google News (${countries.length} regions merged, ${allMentions.length} mentions) + AI sentiment`,
    dataSource: "DataForSEO + AI-verified",
    confidence:
      allMentions.length >= 10
        ? "high"
        : allMentions.length >= 3
          ? "medium"
          : "low",
  };
}
