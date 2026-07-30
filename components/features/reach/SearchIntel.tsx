"use client";

// Native React port of the legacy `search-intel` panel (was
// `window.buildSearchIntel` + `_siRenderAi/_siRenderPulse/_siRenderImage` in
// app.js + `#view-search-intel` in index.html). Tracks AI-engine visibility,
// pulses search demand (DataForSEO) and runs image/logo recognition against the
// existing Express API via `lib/api`:
//   GET    /api/search-intel/queries
//   POST   /api/search-intel/queries
//   DELETE /api/search-intel/queries/:id
//   POST   /api/search-intel/queries/:id/run
//   GET    /api/search-intel/queries/:id/history?limit=40
//   POST   /api/search-intel/suggest-prompts
//   POST   /api/search-intel/pulse
//   POST   /api/search-intel/image
// Exports stream from /api/exports/{pptx|pdf|xlsx}/search-intel.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

type Tab = "ai" | "pulse" | "img";

interface Query {
  id: number;
  query: string;
  brand: string;
  locale: string;
  competitors?: string[];
  last_run_at?: string | null;
  run_count?: number;
  hit_count?: number;
}
interface QueriesResult {
  ok?: boolean;
  error?: string;
  queries?: Query[];
}
interface RunSummary {
  brandHits: number;
  providers?: Record<string, unknown>;
  competitorTotal: number;
}
interface RunResult {
  ok: boolean;
  error?: string;
  summary?: RunSummary;
}
interface SuggestResult {
  ok?: boolean;
  error?: string;
  prompts?: string[];
}
interface HistoryRun {
  provider: string;
  brand_mentioned?: boolean;
  brand_position?: number | null;
  ran_at: string;
  error?: string;
  response_text?: string;
  competitor_hits?: string[];
  citations?: (string | { url?: string })[];
}
interface HistoryResult {
  ok?: boolean;
  error?: string;
  runs?: HistoryRun[];
}
interface PulseSuggestion {
  keyword?: string;
  search_volume?: number;
  cpc?: number;
  competition?: string;
  intent?: string;
}
interface PulseResult {
  ok: boolean;
  error?: string;
  suggestions?: PulseSuggestion[];
  totalVolume?: number;
}
interface ImageBrand {
  name?: string;
  confidence?: number;
  location?: string;
}
interface ImageResult {
  ok: boolean;
  error?: string;
  brands?: (ImageBrand | string)[];
  objects?: string[];
  cached?: boolean;
}

interface AnalysisCompetitor {
  name?: string;
}
interface AnalysisData {
  url?: string;
  competitors?: AnalysisCompetitor[];
}
interface BrandKit {
  name?: string;
}

const LOCALES: { value: string; label: string }[] = [
  { value: "global", label: "🌍 Global / Worldwide" },
  { value: "en-US", label: "🇺🇸 United States" },
  { value: "en-GB", label: "🇬🇧 United Kingdom" },
  { value: "en-CA", label: "🇨🇦 Canada" },
  { value: "en-AU", label: "🇦🇺 Australia" },
  { value: "en-NZ", label: "🇳🇿 New Zealand" },
  { value: "en-IE", label: "🇮🇪 Ireland" },
  { value: "en-ZA", label: "🇿🇦 South Africa" },
  { value: "en-IN", label: "🇮🇳 India" },
  { value: "en-SG", label: "🇸🇬 Singapore" },
  { value: "en-PH", label: "🇵🇭 Philippines" },
  { value: "en-NG", label: "🇳🇬 Nigeria" },
  { value: "en-KE", label: "🇰🇪 Kenya" },
  { value: "de-DE", label: "🇩🇪 Germany" },
  { value: "de-AT", label: "🇦🇹 Austria" },
  { value: "de-CH", label: "🇨🇭 Switzerland" },
  { value: "fr-FR", label: "🇫🇷 France" },
  { value: "fr-BE", label: "🇧🇪 Belgium" },
  { value: "fr-CA", label: "🇨🇦 Canada (French)" },
  { value: "es-ES", label: "🇪🇸 Spain" },
  { value: "es-MX", label: "🇲🇽 Mexico" },
  { value: "es-AR", label: "🇦🇷 Argentina" },
  { value: "es-CO", label: "🇨🇴 Colombia" },
  { value: "es-CL", label: "🇨🇱 Chile" },
  { value: "pt-BR", label: "🇧🇷 Brazil" },
  { value: "pt-PT", label: "🇵🇹 Portugal" },
  { value: "it-IT", label: "🇮🇹 Italy" },
  { value: "nl-NL", label: "🇳🇱 Netherlands" },
  { value: "sv-SE", label: "🇸🇪 Sweden" },
  { value: "nb-NO", label: "🇳🇴 Norway" },
  { value: "da-DK", label: "🇩🇰 Denmark" },
  { value: "fi-FI", label: "🇫🇮 Finland" },
  { value: "pl-PL", label: "🇵🇱 Poland" },
  { value: "ja-JP", label: "🇯🇵 Japan" },
  { value: "ko-KR", label: "🇰🇷 South Korea" },
  { value: "zh-CN", label: "🇨🇳 China" },
  { value: "zh-TW", label: "🇹🇼 Taiwan" },
  { value: "zh-HK", label: "🇭🇰 Hong Kong" },
  { value: "ar-AE", label: "🇦🇪 UAE" },
  { value: "ar-SA", label: "🇸🇦 Saudi Arabia" },
  { value: "tr-TR", label: "🇹🇷 Turkey" },
  { value: "ru-RU", label: "🇷🇺 Russia" },
  { value: "id-ID", label: "🇮🇩 Indonesia" },
  { value: "th-TH", label: "🇹🇭 Thailand" },
  { value: "vi-VN", label: "🇻🇳 Vietnam" },
  { value: "ms-MY", label: "🇲🇾 Malaysia" },
  { value: "he-IL", label: "🇮🇱 Israel" },
  { value: "el-GR", label: "🇬🇷 Greece" },
];

const PROVIDER_ICONS: Record<string, string> = {
  openai: "🟢",
  anthropic: "🟠",
  perplexity: "🔵",
  gemini: "🟣",
};

const TABS: { id: Tab; label: string }[] = [
  { id: "ai", label: "🤖 AI Visibility" },
  { id: "pulse", label: "🔍 Search Pulse" },
  { id: "img", label: "📸 Image / Logo" },
];

function showToast(msg: string) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

function getBrandName(): string {
  if (typeof window === "undefined") return "";
  const w = window as unknown as { _brandKit?: BrandKit; analysisData?: AnalysisData };
  if (w._brandKit?.name) return w._brandKit.name;
  const u = w.analysisData?.url || "";
  if (!u) return "";
  return u
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getCompetitorsPrefill(): string {
  if (typeof window === "undefined") return "";
  const w = window as unknown as { analysisData?: AnalysisData };
  const comps = w.analysisData?.competitors;
  if (!Array.isArray(comps)) return "";
  return comps
    .map((c) => c && c.name)
    .filter((n): n is string => !!n)
    .join(", ");
}

function brandColor(name?: string | ImageBrand): string {
  return typeof name === "string" ? name : name?.name || "";
}

export default function SearchIntel() {
  const [tab, setTab] = useState<Tab>("ai");

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Search &amp; AI Visibility
              </div>
              <h2 className="view-title">🔮 Search &amp; AI Visibility</h2>
              <p className="view-sub">
                See what the world is searching for — and how (or whether) your
                brand shows up in ChatGPT, Claude, Perplexity, and Gemini
                answers.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
        <div
          style={{
            background: "linear-gradient(135deg,#F5F3FF,#EEF2FF)",
            border: "1px solid #C4B5FD",
            borderRadius: 14,
            padding: "18px 22px",
            marginBottom: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "1rem",
                fontWeight: 800,
                color: "#5B21B6",
                marginBottom: 4,
              }}
            >
              🔮 Search &amp; AI Visibility — Brandwatch-killer module
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                color: "#6D28D9",
                lineHeight: 1.55,
                maxWidth: 780,
              }}
            >
              Find demand before competitors do, track your AI-engine visibility
              daily, and detect logos in any image. Powered by GPT-4o + Claude +
              Perplexity + Gemini + DataForSEO + GPT-4o Vision.
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 6,
            marginBottom: 14,
          }}
        >
          <ExportButton format="pptx" label="📊 PowerPoint" bg="#1E1B4B" />
          <ExportButton format="pdf" label="📄 PDF" bg="#1E1B4B" />
          <ExportButton format="xlsx" label="📈 Excel" bg="#15803D" />
        </div>

        <div
          style={{
            display: "flex",
            gap: 6,
            borderBottom: "2px solid #E5E7EB",
            marginBottom: 20,
          }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "11px 18px",
                  background: active ? "#7C3AED" : "transparent",
                  border: "none",
                  borderBottom: `3px solid ${active ? "#7C3AED" : "transparent"}`,
                  fontSize: "0.82rem",
                  fontWeight: 800,
                  color: active ? "#fff" : "#6B7280",
                  WebkitTextFillColor: active ? "#fff" : "#6B7280",
                  cursor: "pointer",
                  borderRadius: "8px 8px 0 0",
                  textShadow: active ? "0 1px 2px rgba(0,0,0,.4)" : undefined,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div>
          {tab === "ai" && <AiTab />}
          {tab === "pulse" && <PulseTab />}
          {tab === "img" && <ImageTab />}
        </div>
      </div>
    </div>
  );
}

function ExportButton({
  format,
  label,
  bg,
}: {
  format: string;
  label: string;
  bg: string;
}) {
  function run() {
    showToast("⏳ Building " + format.toUpperCase() + " — download will start shortly");
    window.location.href = "/api/exports/" + format + "/search-intel";
  }
  return (
    <button
      onClick={run}
      style={{
        padding: "8px 14px",
        background: bg,
        border: `2px solid ${bg}`,
        borderRadius: 7,
        fontSize: "0.74rem",
        fontWeight: 800,
        color: "#fff",
        WebkitTextFillColor: "#fff",
        cursor: "pointer",
        textShadow: "0 1px 2px rgba(0,0,0,.5)",
      }}
    >
      {label}
    </button>
  );
}

/* ── AI Visibility tab ──────────────────────────────────────────────────── */

function AiTab() {
  const [queries, setQueries] = useState<Query[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [locale, setLocale] = useState("global");
  const [suggesting, setSuggesting] = useState(false);

  const suggestCache = useRef<{
    brand: string;
    competitors: string;
    locale: string;
    prompts: string[];
    idx: number;
  }>({ brand: "", competitors: "", locale: "", prompts: [], idx: 0 });

  const [history, setHistory] = useState<{
    name: string;
    runs: HistoryRun[] | null;
    error: string | null;
  } | null>(null);

  async function load() {
    setLoadError(null);
    const r = await apiGet<QueriesResult>("/api/search-intel/queries");
    if (r.ok === false) {
      setLoadError(r.error || "Failed to load");
      setQueries([]);
      return;
    }
    setQueries(r.queries || []);
  }

  useEffect(() => {
    setBrand(getBrandName());
    setCompetitors(getCompetitorsPrefill());
    load();
  }, []);

  async function createQuery() {
    const payload = {
      query: query.trim(),
      brand: brand.trim(),
      competitors: competitors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      locale: locale.trim() || "en-US",
    };
    if (!payload.query || !payload.brand) {
      showToast("❌ Prompt and brand required");
      return;
    }
    const r = await apiPost<RunResult>("/api/search-intel/queries", payload);
    if (!r.ok) {
      showToast("❌ " + (r.error || "create failed"));
      return;
    }
    setQuery("");
    showToast("✅ Tracking added — click ▶ Run now to fire it across 4 AIs");
    load();
  }

  async function suggestPrompt() {
    const b = brand.trim();
    const compRaw = competitors.trim();
    const loc = (locale || "en-US").trim();
    if (!b) {
      showToast("❌ Add your brand first so suggestions match your space");
      return;
    }
    const cache = suggestCache.current;
    const sameContext =
      cache.brand === b &&
      cache.competitors === compRaw &&
      cache.locale === loc &&
      cache.prompts.length > 0;
    if (sameContext) {
      cache.idx = (cache.idx + 1) % cache.prompts.length;
      setQuery(cache.prompts[cache.idx]);
      showToast("✨ Suggestion " + (cache.idx + 1) + " of " + cache.prompts.length);
      return;
    }
    setSuggesting(true);
    try {
      const r = await apiPost<SuggestResult>("/api/search-intel/suggest-prompts", {
        brand: b,
        locale: loc,
        competitors: compRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      const prompts = Array.isArray(r.prompts)
        ? r.prompts.filter((p) => typeof p === "string" && p.trim())
        : [];
      if (!prompts.length) throw new Error(r.error || "no suggestions");
      suggestCache.current = {
        brand: b,
        competitors: compRaw,
        locale: loc,
        prompts,
        idx: 0,
      };
      setQuery(prompts[0]);
      showToast("✨ " + prompts.length + " suggestions ready — click ✨ again to cycle");
    } catch (e) {
      showToast("❌ Suggest failed: " + (e instanceof Error ? e.message : "failed"));
    } finally {
      setSuggesting(false);
    }
  }

  async function deleteQuery(id: number) {
    if (!confirm("Stop tracking this prompt? History is preserved.")) return;
    await apiDelete("/api/search-intel/queries/" + id);
    showToast("🗑 Removed");
    load();
  }

  async function runQuery(id: number) {
    showToast("⏳ Asking 4 AIs in parallel… this takes ~10s");
    const r = await apiPost<RunResult>(
      "/api/search-intel/queries/" + id + "/run",
    );
    if (!r.ok || !r.summary) {
      showToast("❌ " + (r.error || "run failed"));
      return;
    }
    const s = r.summary;
    const hits = s.brandHits;
    const total = Object.keys(s.providers || {}).length;
    showToast(
      `✅ Done — brand cited in ${hits}/${total} AI answers (${s.competitorTotal} competitor mentions)`,
    );
    load();
  }

  async function openHistory(id: number, name: string) {
    setHistory({ name, runs: null, error: null });
    const r = await apiGet<HistoryResult>(
      "/api/search-intel/queries/" + id + "/history?limit=40",
    );
    if (r.ok === false) {
      setHistory({ name, runs: null, error: r.error || "Failed to load" });
      return;
    }
    setHistory({ name, runs: r.runs || [], error: null });
  }

  return (
    <div>
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
            fontSize: "0.95rem",
            fontWeight: 800,
            color: "#0A1628",
            marginBottom: 4,
          }}
        >
          + Track a new prompt
        </div>
        <div
          style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 12 }}
        >
          Examples: &quot;best CRM for SaaS startups&quot;, &quot;alternatives to
          Hubspot&quot;, &quot;what is the best email marketing platform&quot;
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "stretch",
              minWidth: 0,
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Prompt to track"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "9px 11px",
                border: "1.5px solid #E5E7EB",
                borderRadius: 7,
                fontSize: "0.85rem",
              }}
            />
            <button
              onClick={suggestPrompt}
              disabled={suggesting}
              title="✨ Let AI suggest a prompt to track"
              style={{
                padding: "9px 11px",
                background: "#EEF2FF",
                border: "1.5px solid #C7D2FE",
                borderRadius: 7,
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "#3730A3",
                cursor: suggesting ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {suggesting ? "⏳ Thinking…" : "✨ Suggest"}
            </button>
          </div>
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Your brand"
            style={{
              padding: "9px 11px",
              border: "1.5px solid #E5E7EB",
              borderRadius: 7,
              fontSize: "0.85rem",
            }}
          />
          <input
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder="Comp1, Comp2"
            style={{
              padding: "9px 11px",
              border: "1.5px solid #E5E7EB",
              borderRadius: 7,
              fontSize: "0.85rem",
            }}
          />
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            style={{
              padding: "9px 11px",
              border: "1.5px solid #E5E7EB",
              borderRadius: 7,
              fontSize: "0.85rem",
              background: "#fff",
              color: "#0F172A",
            }}
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            onClick={createQuery}
            style={{
              padding: "9px 18px",
              background: '#eef4ff',
              border: "2px solid #1E1B4B",
              borderRadius: 7,
              fontSize: "0.78rem",
              fontWeight: 800,
              color: "#0f172a",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.5)",
              whiteSpace: "nowrap",
            }}
          >
            + Add
          </button>
        </div>
      </div>

      {queries === null ? (
        <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>
          Loading tracked queries…
        </div>
      ) : loadError ? (
        <div
          style={{
            background: "#FEE2E2",
            border: "1px solid #FCA5A5",
            borderRadius: 10,
            padding: 16,
            color: "#B91C1C",
            fontWeight: 600,
          }}
        >
          Failed: {loadError}
        </div>
      ) : queries.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "2px dashed #C4B5FD",
            borderRadius: 14,
            padding: 48,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>🤖</div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
              marginBottom: 6,
            }}
          >
            No tracked AI prompts yet
          </div>
          <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>
            Add a prompt above — we&apos;ll ask 4 AIs daily and track whether your
            brand is named, where it ranks, and which competitors steal the
            spotlight.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(420px,1fr))",
            gap: 14,
          }}
        >
          {queries.map((q) => (
            <QueryCard
              key={q.id}
              q={q}
              onRun={() => runQuery(q.id)}
              onHistory={() => openHistory(q.id, q.query)}
              onDelete={() => deleteQuery(q.id)}
            />
          ))}
        </div>
      )}

      {history && (
        <HistoryModal data={history} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

function QueryCard({
  q,
  onRun,
  onHistory,
  onDelete,
}: {
  q: Query;
  onRun: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const last = q.last_run_at ? new Date(q.last_run_at).toLocaleString() : "never";
  const hitRate = q.run_count
    ? Math.round((100 * (q.hit_count || 0)) / q.run_count)
    : 0;
  const badgeBg = hitRate > 50 ? "#DCFCE7" : hitRate > 0 ? "#FEF3C7" : "#FEE2E2";
  const badgeColor =
    hitRate > 50 ? "#15803D" : hitRate > 0 ? "#92400E" : "#B91C1C";
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div
          style={{
            fontFamily: "Sora,sans-serif",
            fontSize: "0.92rem",
            fontWeight: 800,
            color: "#0A1628",
          }}
        >
          &quot;{q.query}&quot;
        </div>
        <span
          style={{
            background: badgeBg,
            color: badgeColor,
            padding: "2px 8px",
            borderRadius: 5,
            fontSize: "0.62rem",
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {hitRate}% hit
        </span>
      </div>
      <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
        Brand: <strong>{q.brand}</strong> · Locale: <strong>{q.locale}</strong>
        {q.competitors?.length ? " · vs " + q.competitors.join(", ") : ""}
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          padding: "8px 0",
          borderTop: "1px solid #F1F5F9",
          borderBottom: "1px solid #F1F5F9",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "0.6rem",
              fontWeight: 700,
              color: "#9CA3AF",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Runs
          </div>
          <div
            style={{ fontSize: "1.2rem", fontWeight: 800, color: "#1E1B4B" }}
          >
            {q.run_count || 0}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "0.6rem",
              fontWeight: 700,
              color: "#9CA3AF",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Brand cited
          </div>
          <div
            style={{ fontSize: "1.2rem", fontWeight: 800, color: "#1E1B4B" }}
          >
            {q.hit_count || 0}
          </div>
        </div>
      </div>
      <div style={{ fontSize: "0.62rem", color: "#9CA3AF" }}>
        Last run: {last}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 5,
        }}
      >
        <button
          onClick={onRun}
          style={{
            padding: 7,
            background: "#7C3AED",
            border: "2px solid #7C3AED",
            borderRadius: 6,
            fontSize: "0.7rem",
            fontWeight: 800,
            color: "#fff",
            WebkitTextFillColor: "#fff",
            cursor: "pointer",
            textShadow: "0 1px 2px rgba(0,0,0,.4)",
          }}
        >
          ▶ Run now
        </button>
        <button
          onClick={onHistory}
          style={{
            padding: 7,
            background: '#eef4ff',
            border: "2px solid #1E1B4B",
            borderRadius: 6,
            fontSize: "0.7rem",
            fontWeight: 800,
            color: "#0f172a",
            WebkitTextFillColor: "#fff",
            cursor: "pointer",
            textShadow: "0 1px 2px rgba(0,0,0,.5)",
          }}
        >
          📜 History
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: 7,
            background: "#fff",
            border: "2px solid #FCA5A5",
            borderRadius: 6,
            fontSize: "0.7rem",
            fontWeight: 800,
            color: "#B91C1C",
            WebkitTextFillColor: "#B91C1C",
            cursor: "pointer",
          }}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

function HistoryModal({
  data,
  onClose,
}: {
  data: { name: string; runs: HistoryRun[] | null; error: string | null };
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,40,.55)",
        zIndex: 10010,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "32px 16px",
        overflowY: "auto",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 840,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
      >
        {data.runs === null && !data.error ? (
          <div style={{ textAlign: "center", color: "#6B7280", padding: 30 }}>
            Loading run history…
          </div>
        ) : data.error ? (
          <>
            <ModalHeader name={data.name} count={0} onClose={onClose} />
            <div
              style={{
                background: "#FEE2E2",
                border: "1px solid #FCA5A5",
                borderRadius: 10,
                padding: 16,
                color: "#B91C1C",
                fontWeight: 600,
              }}
            >
              {data.error}
            </div>
          </>
        ) : (
          <>
            <ModalHeader
              name={data.name}
              count={data.runs ? data.runs.length : 0}
              onClose={onClose}
            />
            {!data.runs || data.runs.length === 0 ? (
              <div
                style={{ textAlign: "center", color: "#6B7280", padding: 24 }}
              >
                No runs yet — click ▶ Run now on the card.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  maxHeight: "62vh",
                  overflowY: "auto",
                }}
              >
                {data.runs.map((rn, i) => (
                  <HistoryRunRow key={i} rn={rn} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ModalHeader({
  name,
  count,
  onClose,
}: {
  name: string;
  count: number;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 16,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "Sora,sans-serif",
            fontSize: "1.2rem",
            fontWeight: 800,
          }}
        >
          📜 AI Visibility history
        </div>
        <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 3 }}>
          &quot;{name}&quot; · {count} runs
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          fontSize: "1.4rem",
          cursor: "pointer",
          color: "#6B7280",
        }}
      >
        ×
      </button>
    </div>
  );
}

function HistoryRunRow({ rn }: { rn: HistoryRun }) {
  const ico = PROVIDER_ICONS[rn.provider] || "⚪";
  const cits = Array.isArray(rn.citations) ? rn.citations : [];
  const comps = Array.isArray(rn.competitor_hits) ? rn.competitor_hits : [];
  const text = rn.response_text || "";
  return (
    <div
      style={{
        background: "#FAFBFC",
        border: "1px solid #E5E7EB",
        borderRadius: 9,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: "0.8rem", fontWeight: 800 }}>
          {ico} {rn.provider}{" "}
          {rn.brand_mentioned ? (
            <span style={{ color: "#15803D" }}>
              · cited{rn.brand_position ? " #" + rn.brand_position : ""}
            </span>
          ) : (
            <span style={{ color: "#B91C1C" }}>· not cited</span>
          )}
        </div>
        <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>
          {new Date(rn.ran_at).toLocaleString()}
        </div>
      </div>
      {rn.error ? (
        <div style={{ fontSize: "0.7rem", color: "#B91C1C" }}>⚠ {rn.error}</div>
      ) : (
        <>
          <div
            style={{
              fontSize: "0.74rem",
              color: "#374151",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {text.slice(0, 500)}
            {text.length > 500 ? "…" : ""}
          </div>
          {comps.length > 0 && (
            <div
              style={{ fontSize: "0.66rem", color: "#92400E", marginTop: 4 }}
            >
              Competitors named: {comps.join(", ")}
            </div>
          )}
          {cits.length > 0 && (
            <div
              style={{ fontSize: "0.66rem", color: "#6B7280", marginTop: 4 }}
            >
              Citations:{" "}
              {cits.slice(0, 5).map((c, i) => {
                const url = typeof c === "string" ? c : c.url || "";
                return (
                  <span key={i}>
                    {i > 0 ? " · " : ""}
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#7C3AED" }}
                    >
                      {url.slice(0, 60)}
                    </a>
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Search Pulse tab ───────────────────────────────────────────────────── */

function PulseTab() {
  const [seed, setSeed] = useState("");
  const [locale, setLocale] = useState("en-US");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<PulseResult | null>(null);

  async function run() {
    const s = seed.trim();
    if (!s) {
      showToast("❌ Seed required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<PulseResult>("/api/search-intel/pulse", {
      seed: s,
      locale,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "pulse failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  const sugg = result?.suggestions || [];

  return (
    <div>
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
            fontSize: "0.95rem",
            fontWeight: 800,
            color: "#0A1628",
            marginBottom: 4,
          }}
        >
          🔍 What is the world searching for?
        </div>
        <div
          style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 12 }}
        >
          Enter a seed term — we&apos;ll fetch up to 50 related searches with
          monthly volume, intent, and trend.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. 'crm software'"
            style={{
              flex: 1,
              padding: "9px 11px",
              border: "1.5px solid #E5E7EB",
              borderRadius: 7,
              fontSize: "0.85rem",
            }}
          />
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            style={{
              padding: "9px 11px",
              border: "1.5px solid #E5E7EB",
              borderRadius: 7,
              fontSize: "0.85rem",
              background: "#fff",
            }}
          >
            <option>en-US</option>
            <option>en-GB</option>
            <option>en-ZA</option>
            <option>en-AU</option>
            <option>en-CA</option>
          </select>
          <button
            onClick={run}
            disabled={status === "loading"}
            style={{
              padding: "9px 18px",
              background: "#7C3AED",
              border: "2px solid #7C3AED",
              borderRadius: 7,
              fontSize: "0.78rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
              whiteSpace: "nowrap",
            }}
          >
            🔍 Pulse
          </button>
        </div>
      </div>

      <div>
        {status === "loading" && (
          <div style={{ textAlign: "center", padding: 32, color: "#6B7280" }}>
            Pulsing DataForSEO…
          </div>
        )}
        {status === "error" && (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FCA5A5",
              borderRadius: 10,
              padding: 16,
              color: "#B91C1C",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}
        {status === "idle" && result && (
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
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontWeight: 800,
                  color: "#0A1628",
                }}
              >
                {sugg.length} ideas around &quot;{seed.trim()}&quot;
              </div>
              <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                Total monthly volume:{" "}
                <strong style={{ color: "#7C3AED" }}>
                  {(result.totalVolume || 0).toLocaleString()}
                </strong>
              </div>
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.78rem",
              }}
            >
              <thead
                style={{
                  background: "#F9FAFB",
                  color: "#6B7280",
                  textTransform: "uppercase",
                  fontSize: "0.62rem",
                  letterSpacing: ".06em",
                }}
              >
                <tr>
                  <th style={{ padding: "10px 16px", textAlign: "left" }}>
                    Keyword
                  </th>
                  <th style={{ padding: 10, textAlign: "right" }}>Volume</th>
                  <th style={{ padding: 10, textAlign: "right" }}>CPC</th>
                  <th style={{ padding: 10, textAlign: "left" }}>Comp</th>
                  <th style={{ padding: 10, textAlign: "left" }}>Intent</th>
                </tr>
              </thead>
              <tbody>
                {sugg.map((s, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                    <td
                      style={{
                        padding: "8px 16px",
                        fontWeight: 600,
                        color: "#0A1628",
                      }}
                    >
                      {s.keyword || ""}
                    </td>
                    <td
                      style={{
                        padding: 8,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 700,
                        color: "#7C3AED",
                      }}
                    >
                      {(s.search_volume || 0).toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: 8,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      ${(s.cpc || 0).toFixed(2)}
                    </td>
                    <td style={{ padding: 8 }}>{s.competition || "-"}</td>
                    <td style={{ padding: 8, color: "#6B7280" }}>
                      {s.intent || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Image / Logo tab ───────────────────────────────────────────────────── */

function ImageTab() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImageResult | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState("");

  async function run() {
    const u = url.trim();
    if (!u) {
      showToast("❌ URL required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    setAnalyzedUrl(u);
    const r = await apiPost<ImageResult>("/api/search-intel/image", { url: u });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "analyze failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  const brands = result?.brands || [];
  const objects = result?.objects || [];

  return (
    <div>
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
            fontSize: "0.95rem",
            fontWeight: 800,
            color: "#0A1628",
            marginBottom: 4,
          }}
        >
          📸 Image / Logo Recognition
        </div>
        <div
          style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 12 }}
        >
          Paste any public image URL — GPT-4o Vision lists every brand/logo it
          can see plus the main objects/scene. Use this to find brand
          appearances in social images even when nobody @-mentions you.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="https://example.com/photo.jpg"
            style={{
              flex: 1,
              padding: "9px 11px",
              border: "1.5px solid #E5E7EB",
              borderRadius: 7,
              fontSize: "0.85rem",
            }}
          />
          <button
            onClick={run}
            disabled={status === "loading"}
            style={{
              padding: "9px 18px",
              background: "#7C3AED",
              border: "2px solid #7C3AED",
              borderRadius: 7,
              fontSize: "0.78rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
              whiteSpace: "nowrap",
            }}
          >
            📸 Analyze
          </button>
        </div>
      </div>

      <div>
        {status === "loading" && (
          <div style={{ textAlign: "center", padding: 32, color: "#6B7280" }}>
            Analyzing with GPT-4o Vision…
          </div>
        )}
        {status === "error" && (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FCA5A5",
              borderRadius: 10,
              padding: 16,
              color: "#B91C1C",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}
        {status === "idle" && result && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
              display: "grid",
              gridTemplateColumns: "280px 1fr",
              gap: 18,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={analyzedUrl}
              alt="Analyzed"
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #E5E7EB",
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0.3";
              }}
            />
            <div>
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  color: "#0A1628",
                  marginBottom: 8,
                }}
              >
                Detected brands ({brands.length})
                {result.cached && (
                  <span
                    style={{
                      fontSize: "0.6rem",
                      color: "#6B7280",
                      fontWeight: 600,
                    }}
                  >
                    {" "}
                    · cached
                  </span>
                )}
              </div>
              {brands.length === 0 ? (
                <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
                  No brand logos detected.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginBottom: 14,
                  }}
                >
                  {brands.map((b, i) => {
                    const obj = typeof b === "string" ? null : b;
                    return (
                      <div
                        key={i}
                        style={{
                          background: "#F5F3FF",
                          border: "1px solid #C4B5FD",
                          borderRadius: 7,
                          padding: "7px 11px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontWeight: 800, color: "#5B21B6" }}>
                          {brandColor(b)}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                          {obj?.confidence
                            ? Math.round(obj.confidence * 100) + "%"
                            : ""}{" "}
                          {obj?.location ? "· " + obj.location : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "0.85rem",
                  fontWeight: 800,
                  color: "#0A1628",
                  marginBottom: 6,
                }}
              >
                Objects / scene
              </div>
              <div style={{ fontSize: "0.78rem", color: "#374151" }}>
                {objects.join(" · ") || "—"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
