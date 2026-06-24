"use client";

// Native React port of the legacy `trending-topics` panel (was
// `window.buildTrendingTopics` + `_tr*` helpers in app.js and
// `#view-trending-topics` in index.html). Detects what's spiking in a category
// via live web search against the existing Express API:
//   GET  /api/trends/history
//   POST /api/trends/detect   { category, keywords, country, platform }
//   POST /api/ai-quick        { prompt }   (AI Suggest helpers)
// Pre-fills the category/competitor picker from the legacy `window.analysisData`
// global set by the SPA competitor analysis.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

const COUNTRIES: [string, string][] = [
  ["ALL", "🌍 Global / All countries"],
  ["US", "🇺🇸 United States"],
  ["GB", "🇬🇧 United Kingdom"],
  ["ZA", "🇿🇦 South Africa"],
  ["AU", "🇦🇺 Australia"],
  ["CA", "🇨🇦 Canada"],
  ["DE", "🇩🇪 Germany"],
  ["FR", "🇫🇷 France"],
  ["IN", "🇮🇳 India"],
  ["JP", "🇯🇵 Japan"],
  ["BR", "🇧🇷 Brazil"],
  ["MX", "🇲🇽 Mexico"],
  ["NL", "🇳🇱 Netherlands"],
  ["ES", "🇪🇸 Spain"],
  ["IT", "🇮🇹 Italy"],
  ["AE", "🇦🇪 UAE"],
  ["SG", "🇸🇬 Singapore"],
  ["NG", "🇳🇬 Nigeria"],
  ["KE", "🇰🇪 Kenya"],
];

interface Topic {
  title?: string;
  why?: string;
  sources?: string[];
  thumbnail?: string;
  type?: "hashtag" | "video";
  viewCount?: number;
}
interface HistoryRun {
  id?: number;
  topics?: Topic[];
  source?: string;
  category?: string;
  category_label?: string;
  country?: string;
  requested_platform?: string;
  ran_at?: string;
  pinned?: boolean;
  pin_label?: string | null;
}
interface HistoryResp {
  ok?: boolean;
  error?: string;
  runs?: HistoryRun[];
}
interface DetectResp {
  ok?: boolean;
  error?: string;
  topics?: Topic[];
  source?: string;
  category?: string;
  categoryLabel?: string;
}
interface AiQuickResp {
  text?: string;
  answer?: string;
  result?: string;
}

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisKeyword {
  keyword?: string;
  term?: string;
}
interface IntentMap {
  keywords?: (string | AnalysisKeyword)[];
}
interface AnalysisData {
  brandName?: string;
  industry?: string;
  competitors?: AnalysisCompetitor[];
  keywords?: (string | AnalysisKeyword)[];
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
function getIntentMap(): IntentMap | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { _intentMap?: IntentMap })._intentMap;
}
function safeUrl(u: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "#";
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function topicCountBadge(count: number): { bg: string; color: string } {
  if (count >= 10) return { bg: "#D1FAE5", color: "#065F46" };
  if (count >= 5) return { bg: "#DBEAFE", color: "#1E3A8A" };
  if (count > 0) return { bg: "#F3F4F6", color: "#374151" };
  return { bg: "#FEF3C7", color: "#92400E" };
}

function SidebarSparkline({
  runs,
  activeHistoryKey,
}: {
  runs: HistoryRun[];
  activeHistoryKey: string | null;
}) {
  if (runs.length < 2) return null;
  const ordered = [...runs].reverse();
  const counts = ordered.map((r) => (r.topics || []).length);
  const max = Math.max(...counts, 1);
  const W = 182;
  const H = 32;
  const barW = Math.max(4, Math.floor((W - (counts.length - 1) * 2) / counts.length));
  const gap = counts.length > 1 ? (W - barW * counts.length) / (counts.length - 1) : 0;

  return (
    <div
      style={{
        padding: "8px 12px 2px",
        borderBottom: "1px solid #F3F4F6",
      }}
      title="Topic count per scan (oldest → newest)"
    >
      <div
        style={{
          fontSize: "0.58rem",
          fontWeight: 700,
          color: "#9CA3AF",
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Topics per scan
      </div>
      <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
        {ordered.map((run, i) => {
          const count = counts[i];
          const barH = Math.max(3, Math.round((count / max) * (H - 4)));
          const x = i * (barW + gap);
          const y = H - barH;
          const isActive = runKey(run, ordered.length - 1 - i) === activeHistoryKey;
          return (
            <g key={runKey(run, ordered.length - 1 - i)}>
              <title>{`${run.category || "scan"}: ${count} topic${count !== 1 ? "s" : ""}`}</title>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={2}
                fill={isActive ? "#7C3AED" : count === 0 ? "#E5E7EB" : "#C4B5FD"}
                opacity={isActive ? 1 : 0.75}
              />
              {isActive && (
                <rect x={x} y={H + 2} width={barW} height={2} rx={1} fill="#7C3AED" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function sourceBadgeColor(source: string | undefined): string {
  if (source === "perplexity") return "#7C3AED";
  if (source === "youtube") return "#FF0000";
  if (source === "template") return "#9CA3AF";
  return "#6B7280";
}

function sourceBadgeLabel(run: HistoryRun): string {
  if (run.source === "youtube") {
    return run.category_label ? `▶ ${run.category_label}` : "▶ YouTube";
  }
  if (run.source === "perplexity") return "Perplexity";
  return run.source || "unknown";
}

interface RenderState {
  topics: Topic[];
  source: string;
  category: string;
  categoryLabel?: string;
  country?: string;
  historyKey?: string;
  requestedPlatform?: string;
  pin_label?: string | null;
}

function runKey(run: HistoryRun, idx: number): string {
  if (run.id != null) return `id:${run.id}`;
  if (run.ran_at) return `ts:${run.ran_at}`;
  return `idx:${idx}`;
}

export default function TrendingTopics() {
  const { brand, compNames } = useMemo(() => {
    const ad = getAnalysisData();
    const b = ad.brandName || "";
    const comps = Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter((n): n is string => !!n)
          .slice(0, 10)
      : [];
    return { brand: b, compNames: comps };
  }, []);

  const [pick, setPick] = useState("");
  const [cat, setCat] = useState("");
  const [kw, setKw] = useState("");
  const [country, setCountry] = useState("ALL");
  const [platform, setPlatform] = useState("");
  const [result, setResult] = useState<RenderState | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [kwBusy, setKwBusy] = useState(false);
  const [ytKeyConfigured, setYtKeyConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (platform !== "youtube") return;
    let cancelled = false;
    apiGet<{ configured?: boolean }>("/api/settings/api-key/youtube-data")
      .then((r) => { if (!cancelled) setYtKeyConfigured(r.configured === true); })
      .catch(() => { if (!cancelled) setYtKeyConfigured(false); });
    return () => { cancelled = true; };
  }, [platform]);

  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);
  const [hoveredRunId, setHoveredRunId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [tiktokFilter, setTiktokFilter] = useState<"all" | "hashtag" | "video">("all");
  const [labelingId, setLabelingId] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [labelIsEdit, setLabelIsEdit] = useState(false);

  useEffect(() => {
    setCat(brand);
  }, [brand]);

  const loadHistory = useCallback(async () => {
    const h = await apiGet<HistoryResp>("/api/trends/history");
    const runs = h.runs || [];
    setHistoryRuns(runs);
    const last = runs[0];
    if (last) {
      setResult({
        topics: last.topics || [],
        source: last.source || "",
        category: last.category || "",
        categoryLabel: last.category_label || undefined,
        country: last.country || "ALL",
        historyKey: runKey(last, 0),
        requestedPlatform: last.requested_platform || undefined,
        pin_label: last.pin_label,
      });
    }
  }, []);

  function selectHistoryRun(run: HistoryRun, idx: number) {
    const runCountry = run.country || "ALL";
    setCountry(runCountry);
    setResult({
      topics: run.topics || [],
      source: run.source || "",
      category: run.category || "",
      categoryLabel: run.category_label || undefined,
      country: runCountry,
      historyKey: runKey(run, idx),
      requestedPlatform: run.requested_platform || undefined,
      pin_label: run.pin_label,
    });
    setStatus("idle");
    setErrMsg("");
  }

  async function deleteRun(id: number | undefined) {
    if (id == null || deletingId != null) return;
    setDeletingId(id);
    const deletedIdx = historyRuns.findIndex((r) => r.id === id);
    const deletedRun = deletedIdx >= 0 ? historyRuns[deletedIdx] : undefined;
    const wasActive = !!deletedRun && result?.historyKey === runKey(deletedRun, deletedIdx);
    const updated = historyRuns.filter((r) => r.id !== id);
    setHistoryRuns(updated);
    if (wasActive) {
      const next = updated[0];
      if (next) {
        setResult({
          topics: next.topics || [],
          source: next.source || "",
          category: next.category || "",
          categoryLabel: next.category_label || undefined,
          country: next.country || undefined,
          historyKey: runKey(next, 0),
        });
      } else {
        setResult(null);
      }
    }
    const resp = await apiDelete(`/api/trends/history/${id}`);
    if (!resp.ok) {
      await loadHistory();
      toast("⚠ Could not delete scan — please try again");
    }
    setDeletingId(null);
  }

  function startPin(e: React.MouseEvent, run: HistoryRun) {
    e.stopPropagation();
    if (run.id == null) return;
    if (run.pinned) {
      setLabelDraft(run.pin_label || "");
      setLabelIsEdit(true);
      setLabelingId(run.id);
    } else {
      setLabelDraft(run.pin_label || "");
      setLabelIsEdit(false);
      setLabelingId(run.id);
    }
  }

  async function doTogglePin(run: HistoryRun, label: string | null) {
    if (run.id == null) return;
    const optimisticRuns = historyRuns.map((r) =>
      r.id === run.id
        ? { ...r, pinned: !r.pinned, pin_label: !r.pinned ? label : null }
        : r
    );
    const sorted = [
      ...optimisticRuns.filter((r) => r.pinned),
      ...optimisticRuns.filter((r) => !r.pinned),
    ];
    setHistoryRuns(sorted);
    setLabelingId(null);
    const body = label != null ? { label } : {};
    const resp = await apiPatch<{ ok?: boolean; pinned?: boolean }>(`/api/trends/history/${run.id}/pin`, body);
    if (!resp.ok) {
      await loadHistory();
    }
  }

  function confirmPin(run: HistoryRun) {
    void doTogglePin(run, labelDraft.trim());
  }

  async function doUpdateLabel(run: HistoryRun, newLabel: string) {
    if (run.id == null) return;
    const trimmed = newLabel.trim();
    setHistoryRuns((prev) =>
      prev.map((r) => r.id === run.id ? { ...r, pin_label: trimmed || null } : r)
    );
    setLabelingId(null);
    const resp = await apiPatch<{ ok?: boolean }>(`/api/trends/history/${run.id}/pin`, {
      label: trimmed,
      labelOnly: true,
    });
    if (!resp.ok) {
      await loadHistory();
      toast("⚠ Could not update label — please try again");
    }
  }

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  function onPickChange(v: string) {
    setPick(v);
    if (v) setCat(v);
  }

  async function suggestCat() {
    setCatBusy(true);
    const ad = getAnalysisData();
    const comps = Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const industry = ad.industry || "";
    const r = await apiPost<AiQuickResp>("/api/ai-quick", {
      prompt: `Brand: ${brand}\nKnown competitors: ${comps.join(", ") || "(none)"}\nIndustry hint: ${industry}\n\nReturn ONE concise category label (2-4 words, no punctuation) that best describes the market this brand sells into. Only output the label, nothing else.`,
    });
    const value = (r.text || r.answer || r.result || "")
      .toString()
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .slice(0, 50);
    if (value) {
      setCat(value);
      toast("✅ Category suggested");
    } else toast("⚠ Couldn't infer a category — type one manually");
    setCatBusy(false);
  }

  async function suggestKw() {
    let category = cat.trim();
    if (!category && pick) {
      category = pick;
      setCat(pick);
    }
    if (!category && typeof window !== "undefined") {
      const stored = (localStorage.getItem("ig-domain") || "")
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0];
      if (stored) {
        category = stored;
        setCat(stored);
      }
    }
    if (!category) {
      toast("❌ Type or suggest a category first");
      return;
    }
    setKwBusy(true);

    // Step 1: keywords already in the last analysis
    const ad = getAnalysisData();
    const im = getIntentMap();
    const directKws: string[] = [];
    if (Array.isArray(ad.keywords) && ad.keywords.length) {
      ad.keywords.forEach((k) => {
        const s = typeof k === "string" ? k : k.keyword || k.term || "";
        if (s) directKws.push(s);
      });
    }
    if (!directKws.length && im && Array.isArray(im.keywords) && im.keywords.length) {
      im.keywords.forEach((k) => {
        const s = typeof k === "string" ? k : k.keyword || k.term || "";
        if (s) directKws.push(s);
      });
    }
    if (directKws.length) {
      setKw(directKws.slice(0, 6).join(", "));
      toast(
        "✅ " +
          Math.min(directKws.length, 6) +
          " keywords pulled from your analysis",
      );
      setKwBusy(false);
      return;
    }

    // Step 2: AI generation
    const r = await apiPost<AiQuickResp>("/api/ai-quick", {
      prompt: `Category: ${category}\n\nReturn 5 short trend-tracking keywords (1-2 words each, lowercase, comma-separated, no numbering, no punctuation other than commas). Focus on terms that indicate emerging trends in this category right now.`,
    });
    const kws = (r.text || r.answer || r.result || "")
      .toString()
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .slice(0, 200);
    if (kws) {
      setKw(kws);
      toast("✅ Keywords suggested");
    } else toast("⚠ No keyword suggestions returned — type manually");
    setKwBusy(false);
  }

  async function detect() {
    const category = cat.trim();
    if (!category) {
      toast("❌ Category required");
      return;
    }
    const keywords = kw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setStatus("loading");
    setErrMsg("");
    const body: Record<string, unknown> = {
      category,
      keywords,
      country: country.trim() || "ALL",
    };
    if (platform) body.platform = platform;
    const r = await apiPost<DetectResp>("/api/trends/detect", body);
    if (!r.ok) {
      setStatus("error");
      setErrMsg(r.error || "failed");
      return;
    }
    setResult({
      topics: r.topics || [],
      source: r.source || "",
      category: r.category || category,
      categoryLabel: r.categoryLabel,
      country: country.trim() || "ALL",
      requestedPlatform: platform || undefined,
    });
    setTiktokFilter("all");
    setStatus("idle");
    // Reload history so the new run appears in the sidebar
    const h = await apiGet<HistoryResp>("/api/trends/history");
    const runs = h.runs || [];
    setHistoryRuns(runs);
    if (runs[0]) setResult((prev) => (prev ? { ...prev, historyKey: runKey(runs[0], 0) } : prev));
  }

  const pickerOpts = [
    ...(brand ? [{ value: brand, label: `${brand} (your brand)` }] : []),
    ...compNames.map((n) => ({ value: n, label: n })),
  ];

  const aiBtn: React.CSSProperties = {
    background: "linear-gradient(135deg,#7C3AED,#A855F7)",
    color: "#fff",
    border: 0,
    padding: "2px 8px",
    borderRadius: 8,
    fontSize: "0.6rem",
    fontWeight: 800,
    cursor: "pointer",
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1.5px solid #E5E7EB",
    borderRadius: 6,
    fontSize: "0.82rem",
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Trending Topics
              </div>
              <h2 className="view-title">🔥 Trending Topics</h2>
              <p className="view-sub">
                What&apos;s spiking in your category right now — powered by live
                web search via Perplexity.
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
            padding: 18,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontWeight: 800,
              fontSize: "1rem",
              marginBottom: 12,
            }}
          >
            What&apos;s hot in your category?
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 2fr 130px 130px auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 3,
                }}
              >
                <div
                  style={{
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  Category *
                </div>
                <button
                  type="button"
                  onClick={suggestCat}
                  disabled={catBusy}
                  title="Let AI infer your category from your last analysis"
                  style={aiBtn}
                >
                  {catBusy ? "⏳…" : "🤖 AI Suggest"}
                </button>
              </div>
              {pickerOpts.length > 0 && (
                <select
                  value={pick}
                  onChange={(e) => onPickChange(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    border: "1.5px solid #E5E7EB",
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    marginBottom: 4,
                    background: "#F9FAFB",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">
                    — Pick a brand/competitor as category seed —
                  </option>
                  {pickerOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                placeholder="e.g. AI marketing, fintech, fitness apparel"
                style={input}
              />
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 3,
                }}
              >
                <div
                  style={{
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  Keywords (comma, optional)
                </div>
                <button
                  type="button"
                  onClick={suggestKw}
                  disabled={kwBusy}
                  title="Let AI suggest keywords for the chosen category"
                  style={aiBtn}
                >
                  {kwBusy ? "⏳…" : "🤖 AI Suggest"}
                </button>
              </div>
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="growth, automation"
                style={input}
              />
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
                Country
              </div>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                style={input}
              >
                {COUNTRIES.map(([c, l]) => (
                  <option key={c} value={c}>
                    {l}
                  </option>
                ))}
              </select>
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
                Platform
              </div>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                style={input}
              >
                <option value="">🌐 All Web</option>
                <option value="youtube">▶️ YouTube</option>
                <option value="tiktok">🎵 TikTok</option>
              </select>
            </label>
            <button
              onClick={detect}
              disabled={status === "loading"}
              style={{
                padding: "9px 18px",
                background: "#B91C1C",
                border: "2px solid #B91C1C",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.5)",
              }}
            >
              🔥 Detect
            </button>
          </div>
          {platform === "youtube" && ytKeyConfigured !== true && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "#FFF7ED",
                border: "1px solid #FED7AA",
                borderRadius: 8,
                fontSize: "0.74rem",
                color: "#92400E",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: "1rem" }}>ℹ️</span>
              <span>
                <strong>YouTube Data API key required.</strong> Go to{" "}
                <strong>Settings → Integrations → Intelligence APIs</strong>{" "}
                and connect your <strong>YouTube Data API</strong> key to fetch
                live trending results.
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          {/* History sidebar */}
          {historyRuns.length > 1 && (
            <div
              style={{
                width: 210,
                flexShrink: 0,
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {(() => {
                const pinnedCount = historyRuns.filter((r) => r.pinned).length;
                return (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid #F3F4F6",
                      fontFamily: "Sora,sans-serif",
                      fontWeight: 800,
                      fontSize: "0.75rem",
                      color: "#374151",
                      background: "#F9FAFB",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>🕑</span> Past Scans
                    <span
                      style={{
                        background: "#E5E7EB",
                        color: "#6B7280",
                        borderRadius: 10,
                        padding: "1px 6px",
                        fontSize: "0.65rem",
                        fontWeight: 700,
                      }}
                    >
                      {historyRuns.length}
                    </span>
                    {pinnedCount > 0 && (
                      <button
                        type="button"
                        title={pinnedOnly ? "Show all scans" : "Show pinned scans only"}
                        onClick={() => setPinnedOnly((v) => !v)}
                        style={{
                          marginLeft: "auto",
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          padding: "2px 7px",
                          borderRadius: 10,
                          border: pinnedOnly ? "1.5px solid #F59E0B" : "1.5px solid #E5E7EB",
                          background: pinnedOnly ? "#FFFBEB" : "transparent",
                          color: pinnedOnly ? "#92400E" : "#6B7280",
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          cursor: "pointer",
                          transition: "all 0.15s",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ⭐ Pinned
                        <span
                          style={{
                            background: pinnedOnly ? "#F59E0B" : "#E5E7EB",
                            color: pinnedOnly ? "#fff" : "#6B7280",
                            borderRadius: 8,
                            padding: "0px 5px",
                            fontSize: "0.6rem",
                            fontWeight: 800,
                          }}
                        >
                          {pinnedCount}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })()}
              <SidebarSparkline runs={historyRuns} activeHistoryKey={result?.historyKey ?? null} />
              <div
                style={{
                  padding: "6px 14px",
                  borderBottom: "1px solid #F3F4F6",
                  background: "#F9FAFB",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => setPinnedOnly(!pinnedOnly)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: pinnedOnly ? "#FDF2F8" : "transparent",
                    border: `1px solid ${pinnedOnly ? "#F9A8D4" : "#E5E7EB"}`,
                    borderRadius: 6,
                    padding: "2px 8px",
                    fontSize: "0.64rem",
                    fontWeight: 700,
                    color: pinnedOnly ? "#BE185D" : "#6B7280",
                    cursor: "pointer",
                    transition: "all 0.1s",
                  }}
                >
                  ⭐ Pinned
                </button>
              </div>
              <div style={{ maxHeight: 480, overflowY: "auto" }}>
                {historyRuns
                  .filter((run) => !pinnedOnly || run.pinned)
                  .map((run, idx) => {
                  const key = runKey(run, idx);
                  const isActive = !!result?.historyKey && result.historyKey === key;
                  const isHovered = run.id != null ? run.id === hoveredRunId : false;
                  const isDeleting = run.id != null ? run.id === deletingId : false;
                  const isPinned = !!run.pinned;
                  return (
                    <div
                      key={key}
                      style={{ position: "relative" }}
                      onMouseEnter={() => run.id != null && setHoveredRunId(run.id)}
                      onMouseLeave={() => setHoveredRunId(null)}
                    >
                      <button
                        type="button"
                        onClick={() => selectHistoryRun(run, idx)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          background: isActive ? "#F5F3FF" : isPinned ? "#FFFBEB" : isHovered ? "#F9FAFB" : "transparent",
                          border: "none",
                          borderLeft: isActive ? "3px solid #7C3AED" : isPinned ? "3px solid #F59E0B" : "3px solid transparent",
                          borderBottom: "1px solid #F3F4F6",
                          padding: "9px 56px 9px 12px",
                          cursor: "pointer",
                          transition: "background 0.1s",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            marginBottom: 3,
                          }}
                        >
                          {isPinned && (
                            <span style={{ fontSize: "0.65rem", lineHeight: 1 }} title={run.pin_label ? `Pinned · ${run.pin_label}` : "Pinned"}>📌</span>
                          )}
                          <span
                            style={{
                              background: sourceBadgeColor(run.source),
                              color: "#fff",
                              borderRadius: 4,
                              padding: "1px 5px",
                              fontSize: "0.55rem",
                              fontWeight: 800,
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {sourceBadgeLabel(run)}
                          </span>
                          {run.requested_platform === "youtube" && (
                            <span
                              style={{
                                background: "#FF0000",
                                color: "#fff",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontSize: "0.55rem",
                                fontWeight: 800,
                                whiteSpace: "nowrap",
                              }}
                              title="YouTube scan"
                            >
                              ▶ YouTube
                            </span>
                          )}
                          {run.requested_platform === "tiktok" && (
                            <span
                              style={{
                                background: "#010101",
                                color: "#fff",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontSize: "0.55rem",
                                fontWeight: 800,
                                whiteSpace: "nowrap",
                              }}
                              title="TikTok scan"
                            >
                              🎵 TikTok
                            </span>
                          )}
                          {run.country && run.country !== "ALL" && (
                            <span
                              style={{
                                fontSize: "0.6rem",
                                color: "#9CA3AF",
                                fontWeight: 600,
                              }}
                            >
                              {run.country}
                            </span>
                          )}
                          {idx === 0 && !isPinned && (
                            <span
                              style={{
                                marginLeft: "auto",
                                background: "#D1FAE5",
                                color: "#065F46",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontSize: "0.55rem",
                                fontWeight: 800,
                                flexShrink: 0,
                              }}
                            >
                              latest
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: isActive ? 700 : 600,
                            color: isActive ? "#5B21B6" : "#111827",
                            lineHeight: 1.3,
                            marginBottom: 2,
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {run.category || "—"}
                        </div>
                        {isPinned && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                              marginBottom: 2,
                            }}
                          >
                            {run.pin_label && (
                              <span
                                style={{
                                  fontSize: "0.62rem",
                                  color: "#92400E",
                                  background: "#FEF3C7",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  minWidth: 0,
                                }}
                              >
                                {run.pin_label}
                              </span>
                            )}
                            {!run.pin_label && !isHovered && (
                              <span
                                style={{
                                  fontSize: "0.6rem",
                                  color: "#D1D5DB",
                                  letterSpacing: "0.01em",
                                  userSelect: "none",
                                  pointerEvents: "none",
                                }}
                              >
                                + label
                              </span>
                            )}
                            {isHovered && (
                              <button
                                type="button"
                                title={run.pin_label ? "Edit pin label" : "Add pin label"}
                                onClick={(e) => startPin(e, run)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: "0 2px",
                                  lineHeight: 1,
                                  fontSize: "0.65rem",
                                  color: "#92400E",
                                  flexShrink: 0,
                                  opacity: 0.7,
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
                              >
                                ✏
                              </button>
                            )}
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginTop: 3,
                          }}
                        >
                          {run.ran_at ? (
                            <div style={{ fontSize: "0.62rem", color: "#9CA3AF" }}>
                              {fmtDate(run.ran_at)}
                            </div>
                          ) : (
                            <span />
                          )}
                          {(() => {
                            const count = (run.topics || []).length;
                            const { bg, color } = topicCountBadge(count);
                            return (
                              <span
                                title={`${count} topic${count !== 1 ? "s" : ""} returned`}
                                style={{
                                  background: bg,
                                  color,
                                  borderRadius: 10,
                                  padding: "1px 6px",
                                  fontSize: "0.6rem",
                                  fontWeight: 700,
                                  whiteSpace: "nowrap",
                                  flexShrink: 0,
                                }}
                              >
                                {count} topic{count !== 1 ? "s" : ""}
                              </span>
                            );
                          })()}
                        </div>
                      </button>
                      {/* Star/pin button — always visible */}
                      {run.id != null && (
                        <button
                          type="button"
                          title={isPinned ? "Unpin this scan" : "Pin this scan"}
                          onClick={(e) => startPin(e, run)}
                          style={{
                            position: "absolute",
                            top: "50%",
                            right: 30,
                            transform: "translateY(-50%)",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            lineHeight: 1,
                            padding: "2px 3px",
                            borderRadius: 4,
                            opacity: isPinned ? 1 : 0.3,
                            transition: "opacity 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.opacity = isPinned ? "1" : "0.3";
                          }}
                        >
                          ⭐
                        </button>
                      )}
                      {/* Inline label input — shown when pinning or editing label */}
                      {labelingId === run.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            zIndex: 20,
                            background: "#fff",
                            border: `1.5px solid ${labelIsEdit ? "#F59E0B" : "#7C3AED"}`,
                            borderRadius: 8,
                            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                            padding: "10px 10px 8px",
                          }}
                        >
                          <div style={{ fontSize: "0.64rem", fontWeight: 700, color: "#6B7280", marginBottom: 5 }}>
                            {labelIsEdit ? "Edit pin label" : "Add a label (optional)"}
                          </div>
                          <input
                            autoFocus
                            maxLength={80}
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (labelIsEdit) { void doUpdateLabel(run, labelDraft); }
                                else { confirmPin(run); }
                              }
                              if (e.key === "Escape") { e.preventDefault(); setLabelingId(null); }
                            }}
                            placeholder="e.g. Q3 benchmark, pre-launch watch…"
                            style={{
                              width: "100%",
                              padding: "5px 7px",
                              border: "1px solid #E5E7EB",
                              borderRadius: 5,
                              fontSize: "0.72rem",
                              boxSizing: "border-box",
                              outline: "none",
                            }}
                          />
                          <div style={{ display: "flex", gap: 5, marginTop: 6, justifyContent: "flex-end" }}>
                            {labelIsEdit && (
                              <button
                                type="button"
                                onClick={() => { void doTogglePin(run, null); }}
                                style={{
                                  padding: "3px 8px",
                                  background: "transparent",
                                  border: "1px solid #FCA5A5",
                                  borderRadius: 5,
                                  fontSize: "0.65rem",
                                  cursor: "pointer",
                                  color: "#B91C1C",
                                  marginRight: "auto",
                                }}
                              >
                                Unpin
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setLabelingId(null)}
                              style={{
                                padding: "3px 8px",
                                background: "transparent",
                                border: "1px solid #D1D5DB",
                                borderRadius: 5,
                                fontSize: "0.65rem",
                                cursor: "pointer",
                                color: "#6B7280",
                              }}
                            >
                              Cancel
                            </button>
                            {labelIsEdit ? (
                              <button
                                type="button"
                                onClick={() => { void doUpdateLabel(run, labelDraft); }}
                                style={{
                                  padding: "3px 10px",
                                  background: "#F59E0B",
                                  border: "none",
                                  borderRadius: 5,
                                  fontSize: "0.65rem",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  color: "#fff",
                                }}
                              >
                                ✏ Save label
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => confirmPin(run)}
                                style={{
                                  padding: "3px 10px",
                                  background: "#7C3AED",
                                  border: "none",
                                  borderRadius: 5,
                                  fontSize: "0.65rem",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  color: "#fff",
                                }}
                              >
                                📌 Pin
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Delete button — appears on hover */}
                      {(isHovered || isDeleting) && run.id != null && (
                        <button
                          type="button"
                          title="Delete this scan"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRun(run.id);
                          }}
                          disabled={isDeleting}
                          style={{
                            position: "absolute",
                            top: "50%",
                            right: 8,
                            transform: "translateY(-50%)",
                            background: "transparent",
                            border: "none",
                            cursor: isDeleting ? "default" : "pointer",
                            color: "#9CA3AF",
                            fontSize: "0.75rem",
                            lineHeight: 1,
                            padding: "2px 4px",
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color = "#EF4444";
                            (e.currentTarget as HTMLButtonElement).style.background = "#FEE2E2";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color = "#9CA3AF";
                            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                          }}
                        >
                          {isDeleting ? "…" : "✕"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
          {status === "loading" && (
            <div
              style={{ textAlign: "center", padding: 40, color: "#6B7280" }}
            >
              {platform === "youtube"
                ? "⏳ Fetching YouTube trending videos…"
                : platform === "tiktok"
                  ? "⏳ Fetching TikTok trending hashtags & videos…"
                  : "⏳ Searching live web…"}
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {errMsg}
            </div>
          )}
          {status === "idle" && result && (() => {
            const hasBoth =
              result.source === "tiktok" &&
              result.topics.some((t) => t.type === "hashtag") &&
              result.topics.some((t) => t.type === "video");
            const filteredTopics =
              hasBoth && tiktokFilter !== "all"
                ? result.topics.filter((t) => t.type === tiktokFilter)
                : result.topics;
            return (
            <>
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
                    fontSize: "0.95rem",
                  }}
                >
                  🔥 Trending in{" "}
                  <span style={{ color: "#B91C1C" }}>{result.category}</span>
                  {result.country && result.country !== "ALL" && (
                    <>
                      {" "}
                      ·{" "}
                      <span style={{ color: "#6B7280" }}>{result.country}</span>
                    </>
                  )}{" "}
                  · {filteredTopics.length} topics
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {result.pin_label && (
                    <span
                      style={{
                        background: "#FEF3C7",
                        color: "#92400E",
                        border: "1px solid #FCD34D",
                        padding: "3px 9px",
                        borderRadius: 5,
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={result.pin_label}
                    >
                      📌 {result.pin_label}
                    </span>
                  )}
                  {result.country && result.country !== "ALL" && (
                    <span
                      style={{
                        background: "#F3F4F6",
                        color: "#374151",
                        padding: "3px 8px",
                        borderRadius: 5,
                        fontSize: "0.62rem",
                        fontWeight: 700,
                      }}
                    >
                      {result.country}
                    </span>
                  )}
                  {result.source === "tiktok" && result.topics.some(t => t.type === "hashtag") && (
                    <span
                      style={{
                        background: "#E9065E",
                        color: "#fff",
                        padding: "3px 9px",
                        borderRadius: 5,
                        fontSize: "0.62rem",
                        fontWeight: 800,
                        textTransform: "uppercase",
                      }}
                    >
                      # Hashtag Feed
                    </span>
                  )}
                  {result.source === "tiktok" && result.topics.some(t => t.type === "video") && (
                    <span
                      style={{
                        background: "#010101",
                        color: "#fff",
                        padding: "3px 9px",
                        borderRadius: 5,
                        fontSize: "0.62rem",
                        fontWeight: 800,
                        textTransform: "uppercase",
                      }}
                    >
                      🎵 Videos
                    </span>
                  )}
                  {result.source !== "tiktok" && (
                    <span
                      style={{
                        background:
                          result.source === "perplexity"
                            ? "#7C3AED"
                            : result.source === "youtube"
                              ? "#FF0000"
                              : "#9CA3AF",
                        color: "#fff",
                        padding: "3px 9px",
                        borderRadius: 5,
                        fontSize: "0.62rem",
                        fontWeight: 800,
                        textTransform: "uppercase",
                      }}
                    >
                      {result.source === "youtube"
                        ? result.categoryLabel
                          ? `▶ YouTube Trending · ${result.categoryLabel}`
                          : "▶ YouTube"
                        : result.source === "perplexity"
                          ? "Perplexity"
                          : result.source}
                    </span>
                  )}
                </div>
              </div>

              {/* Placeholder notice — shown when API falls back to template data */}
              {result.source === "template" && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    background: "#FFFBEB",
                    border: "1.5px solid #FCD34D",
                    borderRadius: 10,
                    padding: "12px 16px",
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontSize: "1.25rem", lineHeight: 1, flexShrink: 0 }}>⚠️</span>
                  <div style={{ fontSize: "0.8rem", color: "#92400E", lineHeight: 1.5 }}>
                    <strong>These are placeholder topics, not live data.</strong> No Perplexity
                    API key is configured, so InfoGenie fell back to a built-in template instead
                    of running a live web search.{" "}
                    To see real trending results, go to{" "}
                    <strong>Settings → Integrations → Intelligence APIs</strong> and add your{" "}
                    <strong>Perplexity API key</strong>, then re-run the scan.
                  </div>
                </div>
              )}

              {/* YouTube fallback notice — shown when YouTube was requested but returned no live data */}
              {result.requestedPlatform === "youtube" && result.source !== "youtube" && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    background: "#FFF1F1",
                    border: "1.5px solid #FCA5A5",
                    borderRadius: 10,
                    padding: "12px 16px",
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontSize: "1.25rem", lineHeight: 1, flexShrink: 0 }}>▶️</span>
                  <div style={{ fontSize: "0.8rem", color: "#991B1B", lineHeight: 1.5 }}>
                    <strong>YouTube live data is unavailable for this scan.</strong> The YouTube
                    Data API key is either missing or has exceeded its daily quota, so InfoGenie
                    fell back to{" "}
                    {result.source === "template" ? "placeholder topics" : "a Perplexity web search"} instead.{" "}
                    To pull real YouTube trending videos, go to{" "}
                    <strong>Settings → Integrations → Intelligence APIs</strong> and add your{" "}
                    <strong>YouTube Data API key</strong>, then re-run the scan.
                  </div>
                </div>
              )}

              {/* TikTok fallback notice — shown when TikTok was requested but returned no live data */}
              {result.requestedPlatform === "tiktok" && result.source !== "tiktok" && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    background: "#FFF1F1",
                    border: "1.5px solid #FCA5A5",
                    borderRadius: 10,
                    padding: "12px 16px",
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontSize: "1.25rem", lineHeight: 1, flexShrink: 0 }}>🎵</span>
                  <div style={{ fontSize: "0.8rem", color: "#991B1B", lineHeight: 1.5 }}>
                    <strong>TikTok live data is unavailable for this scan.</strong> The TikTok
                    RapidAPI key is either missing or returned no results, so InfoGenie fell back
                    to{" "}
                    {result.source === "template" ? "placeholder topics" : "a Perplexity web search"} instead.{" "}
                    To pull real TikTok trending hashtags and videos, go to{" "}
                    <strong>Settings → Integrations → Intelligence APIs</strong> and add your{" "}
                    <strong>TikTok RapidAPI key</strong>, then re-run the scan.
                  </div>
                </div>
              )}

              {/* Segmented filter — only when TikTok returns both hashtags and videos */}
              {hasBoth && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0,
                    marginBottom: 14,
                    background: "#F3F4F6",
                    borderRadius: 8,
                    padding: 3,
                    width: "fit-content",
                  }}
                >
                  {(
                    [
                      { key: "all", label: "All" },
                      { key: "hashtag", label: "# Hashtags only" },
                      { key: "video", label: "🎵 Videos only" },
                    ] as { key: "all" | "hashtag" | "video"; label: string }[]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTiktokFilter(key)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 6,
                        border: "none",
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        background:
                          tiktokFilter === key
                            ? key === "hashtag"
                              ? "#E9065E"
                              : key === "video"
                                ? "#010101"
                                : "#fff"
                            : "transparent",
                        color:
                          tiktokFilter === key
                            ? key === "all"
                              ? "#0A1628"
                              : "#fff"
                            : "#6B7280",
                        boxShadow:
                          tiktokFilter === key
                            ? "0 1px 3px rgba(0,0,0,0.15)"
                            : "none",
                        transition: "all 0.15s",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))",
                  gap: 14,
                }}
              >
                {(() => {
                  const maxHashtagViews = filteredTopics
                    .filter((t) => t.type === "hashtag" && (t.viewCount || 0) > 0)
                    .reduce((m, t) => Math.max(m, t.viewCount || 0), 0);
                  const sortedTopics = [
                    ...filteredTopics
                      .filter((t) => t.type === "hashtag")
                      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)),
                    ...filteredTopics.filter((t) => t.type !== "hashtag"),
                  ];
                  const hashtagCount = sortedTopics.filter((t) => t.type === "hashtag").length;
                  return sortedTopics.map((t, i) => {
                  const isHashtag = t.type === "hashtag";
                  const isVideo = t.type === "video";
                  const videoIdx = isVideo ? i - hashtagCount : i;
                  const accentColor = isHashtag
                    ? "#E9065E"
                    : videoIdx < 3 ? "#B91C1C" : videoIdx < 6 ? "#F59E0B" : "#9CA3AF";
                  const cardBg = isHashtag ? "#FFF8FA" : "#fff";
                  return (
                    <div
                      key={i}
                      style={{
                        background: cardBg,
                        border: `1px solid ${isHashtag ? "#FBCFE8" : "#E5E7EB"}`,
                        borderLeft: `4px solid ${accentColor}`,
                        borderRadius: 10,
                        padding: "14px 16px",
                      }}
                    >
                      {result.source === "youtube" && t.thumbnail && (
                        <a
                          href={safeUrl(t.sources?.[0] || "")}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "block", marginBottom: 10 }}
                        >
                          <img
                            src={t.thumbnail}
                            alt={t.title || "YouTube thumbnail"}
                            style={{
                              width: "100%",
                              aspectRatio: "16/9",
                              objectFit: "cover",
                              borderRadius: 6,
                              display: "block",
                            }}
                          />
                        </a>
                      )}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 800,
                            color: isHashtag ? "#E9065E" : "#0A1628",
                            fontSize: isHashtag ? "1.05rem" : "0.95rem",
                            letterSpacing: isHashtag ? "-0.01em" : undefined,
                          }}
                        >
                          {isHashtag ? (
                            <span>{t.title || ""}</span>
                          ) : (
                            <span>#{i + 1}. {t.title || ""}</span>
                          )}
                        </div>
                        {isHashtag && (
                          <span
                            style={{
                              background: "#E9065E",
                              color: "#fff",
                              fontSize: "0.55rem",
                              fontWeight: 800,
                              padding: "2px 6px",
                              borderRadius: 4,
                              whiteSpace: "nowrap",
                              marginLeft: 6,
                              flexShrink: 0,
                            }}
                          >
                            # Hashtag
                          </span>
                        )}
                        {isVideo && (
                          <span
                            style={{
                              background: "#010101",
                              color: "#fff",
                              fontSize: "0.55rem",
                              fontWeight: 800,
                              padding: "2px 6px",
                              borderRadius: 4,
                              whiteSpace: "nowrap",
                              marginLeft: 6,
                              flexShrink: 0,
                            }}
                          >
                            🎵 Video
                          </span>
                        )}
                        {result.source === "youtube" && (
                          <span
                            style={{
                              background: "#FF0000",
                              color: "#fff",
                              fontSize: "0.55rem",
                              fontWeight: 800,
                              padding: "2px 6px",
                              borderRadius: 4,
                              whiteSpace: "nowrap",
                              marginLeft: 6,
                              flexShrink: 0,
                            }}
                          >
                            ▶ YouTube
                          </span>
                        )}
                      </div>
                      {/* View count pill + trend-strength bar — always rendered for hashtag cards */}
                      {isHashtag && (
                        <div style={{ marginBottom: 8 }}>
                          {t.viewCount && t.viewCount > 0 && (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                background: "#FDF2F8",
                                border: "1px solid #FBCFE8",
                                borderRadius: 20,
                                padding: "2px 10px",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                color: "#BE185D",
                              }}
                            >
                              👁 {Number(t.viewCount).toLocaleString()} views
                            </span>
                          )}
                          {/* Trend-strength bar — proportional when data exists, muted stub when not */}
                          {(() => {
                            const hasViews = maxHashtagViews > 0 && (t.viewCount || 0) > 0;
                            const pct = hasViews
                              ? Math.max(4, Math.round(((t.viewCount || 0) / maxHashtagViews) * 100))
                              : 0;
                            const tooltip = hasViews
                              ? `Trend strength: ${Math.round(((t.viewCount || 0) / maxHashtagViews) * 100)}% of top hashtag`
                              : "Trend strength: no view data";
                            return (
                              <div style={{ marginTop: t.viewCount && t.viewCount > 0 ? 6 : 0, display: "flex", alignItems: "center", gap: 8 }}>
                                <div
                                  title={tooltip}
                                  style={{
                                    flex: 1,
                                    height: 5,
                                    background: hasViews ? "#FCE7F3" : "#F3F4F6",
                                    borderRadius: 99,
                                    overflow: "hidden",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${pct}%`,
                                      height: "100%",
                                      background: hasViews
                                        ? "linear-gradient(90deg,#E9065E,#FB7185)"
                                        : "#E5E7EB",
                                      borderRadius: 99,
                                      transition: "width 0.4s ease",
                                    }}
                                  />
                                </div>
                                {hasViews && (
                                  <span
                                    style={{
                                      fontSize: "0.68rem",
                                      fontWeight: 700,
                                      color: "#BE185D",
                                      whiteSpace: "nowrap",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {Math.round(((t.viewCount || 0) / maxHashtagViews) * 100)}% trend strength
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "#374151",
                          marginBottom: 8,
                          lineHeight: 1.5,
                        }}
                      >
                        {t.why || ""}
                      </div>
                      {(t.sources || []).length > 0 && (
                        <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                          {(t.sources || []).slice(0, 3).map((u, j) => (
                            <a
                              key={j}
                              href={safeUrl(u)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: isHashtag ? "#E9065E" : "#7C3AED",
                                display: "block",
                                marginTop: 2,
                              }}
                            >
                              {u.replace(/^https?:\/\//, "").slice(0, 60)}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                  });
                })()}
              </div>
            </>
            );
          })()}
          </div>
        </div>
      </div>
    </div>
  );
}
