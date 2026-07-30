"use client";

// Native React port of the legacy `contentscorer` panel (was
// `window.buildContentScorer` + the `_cs*` helpers in
// public/js/ig_attribution_scorer.js + `#view-contentscorer` in index.html).
// Pulls the live top-10 SERP for a keyword, scrapes the winning pages and scores
// the user's page 0–100 against the SERP-winning average. Calls the existing
// Express API (`GET /api/content-scorer/countries`,
// `GET /api/content-scorer/related`, `POST /api/content-scorer/analyze`) via
// `lib/api`. Reuses the legacy `cs-*` CSS from the global style.css.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

const CS_MAX_COUNTRIES = 6;

// Priority order used when more than CS_MAX_COUNTRIES are selected.
const CS_COUNTRY_PRIORITY = [
  "US", "GB", "CA", "AU", "DE", "FR", "IN", "JP", "BR", "MX", "ES", "IT", "NL",
  "IE", "SG", "AE", "ZA", "SA", "TR", "PL", "SE", "NO", "DK", "FI", "CH", "AT",
  "BE", "PT", "GR", "CZ", "RO", "HU", "UA", "RU", "HK", "TW", "MY", "TH", "ID",
  "PH", "VN", "PK", "BD", "EG", "NG", "KE", "MA", "AR", "CL", "CO", "PE", "NZ",
];

interface Country {
  code: string;
  name: string;
}

interface AnalysisCompetitor {
  keywords?: string[];
  topKeyword?: string;
}
interface AnalysisData {
  url?: string;
  domain?: string;
  keywords?: string[];
  competitors?: AnalysisCompetitor[];
}

interface CountriesResult {
  ok: boolean;
  countries?: Country[];
  error?: string;
}

interface RelatedKeyword {
  keyword: string;
  searchVolume?: number | null;
}
interface RelatedResult {
  ok: boolean;
  keywords?: RelatedKeyword[];
  error?: string;
}

interface BarItem {
  score?: number;
  max?: number;
}
interface Breakdown {
  wordCount?: BarItem & { target?: number; median?: number };
  headings?: BarItem & {
    h1?: number;
    h2?: number;
    h3?: number;
    avgH2InSerp?: number;
  };
  lsiCoverage?: BarItem & {
    covered?: number;
    total?: number;
    coveredTerms?: string[];
    missingTerms?: string[];
  };
  faq?: BarItem & { hasSchema?: boolean; hasHeuristic?: boolean };
  schema?: BarItem & { types?: string[] };
  titleMeta?: BarItem & { titleLen?: number; metaDescLen?: number };
}
interface Recommendation {
  priority?: string;
  category?: string;
  action?: string;
  why?: string;
}
interface CompetitorRow {
  rank: number;
  domain: string;
  title?: string;
  ok: boolean;
  wordCount: number;
  h2: number;
  hasFAQ?: boolean;
  hasSchema?: boolean;
  error?: string;
}
interface CountryResult {
  ok: boolean;
  country?: string;
  score?: number | null;
  error?: string;
  warning?: string;
  keyword?: string;
  breakdown?: Breakdown;
  recommendations?: Recommendation[];
  competitorSummary?: CompetitorRow[];
  target?: { url?: string };
}
interface AnalyzeResult {
  ok: boolean;
  error?: string;
  multi?: boolean;
  countries?: string[];
  target?: { url?: string };
  results?: CountryResult[];
  generatedAt?: string;
  keyword?: string;
}

function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { analysisData?: AnalysisData };
  if (w.analysisData) return w.analysisData;
  try {
    const url = localStorage.getItem("ig-last-analysed-url");
    if (url) return { url };
  } catch {
    /* ignore */
  }
  return null;
}

function lsDomain(): string {
  const ad = getAnalysisData();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}

function lsKeywords(): string[] {
  const ad = getAnalysisData();
  if (!ad) return [];
  if (Array.isArray(ad.keywords)) return ad.keywords.slice(0, 12);
  if (Array.isArray(ad.competitors)) {
    const k: string[] = [];
    ad.competitors.forEach((c) => {
      if (c.keywords) k.push(...c.keywords);
      else if (c.topKeyword) k.push(c.topKeyword);
    });
    return k.slice(0, 12);
  }
  return [];
}

// Picks the top CS_MAX_COUNTRIES from a selection using priority ordering.
function trimToCap(codes: string[]): { kept: string[]; dropped: string[] } {
  if (codes.length <= CS_MAX_COUNTRIES)
    return { kept: codes.slice(), dropped: [] };
  const sorted = codes.slice().sort((a, b) => {
    const ia = CS_COUNTRY_PRIORITY.indexOf(a);
    const ib = CS_COUNTRY_PRIORITY.indexOf(b);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    return ra - rb;
  });
  return {
    kept: sorted.slice(0, CS_MAX_COUNTRIES),
    dropped: sorted.slice(CS_MAX_COUNTRIES),
  };
}

function scoreColor(score: number): string {
  return score >= 80
    ? "#10B981"
    : score >= 60
      ? "#F59E0B"
      : score >= 40
        ? "#F97316"
        : "#EF4444";
}
function scoreLabel(score: number): string {
  return score >= 80
    ? "Excellent"
    : score >= 60
      ? "Good"
      : score >= 40
        ? "Needs work"
        : "Underperforming";
}

const DEFAULT_RUN_HINT = "Live SERP fetch + page scrape — usually 8–15 seconds.";
const FALLBACK_COUNTRIES: Country[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
];

interface RelatedState {
  forKw: string;
  priorKws: string[];
  remoteKws: RelatedKeyword[];
  remoteError?: string;
  loading: boolean;
}

export default function Contentscorer() {
  const [keyword, setKeyword] = useState("");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState("");

  const [countryList, setCountryList] = useState<Country[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(["US"]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  const [related, setRelated] = useState<RelatedState | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [resultError, setResultError] = useState("");
  const [trimNotice, setTrimNotice] = useState<{
    selected: number;
    kept: string[];
    dropped: string[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  const [runHint, setRunHint] = useState(DEFAULT_RUN_HINT);
  const [runHintFlash, setRunHintFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keywordRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const flashHint = useCallback((msg: string) => {
    setRunHint(msg);
    setRunHintFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setRunHint(DEFAULT_RUN_HINT);
      setRunHintFlash(false);
    }, 3500);
  }, []);

  const focusAndFlash = useCallback(
    (el: HTMLElement | null, msg: string) => {
      if (!el) return;
      el.focus();
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        /* ignore */
      }
      const orig = el.style.boxShadow;
      el.style.boxShadow = "0 0 0 3px rgba(239,68,68,.45)";
      setTimeout(() => {
        el.style.boxShadow = orig;
      }, 1600);
      if (msg) flashHint(msg);
    },
    [flashHint],
  );

  // Load country list from server (single source of truth).
  useEffect(() => {
    let alive = true;
    (async () => {
      const j = await apiGet<CountriesResult>("/api/content-scorer/countries");
      if (!alive) return;
      if (j.ok && Array.isArray(j.countries) && j.countries.length) {
        setCountryList(j.countries);
      } else {
        setCountryList(FALLBACK_COUNTRIES);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Prefill URL + keyword from prior analysis (mount only).
  useEffect(() => {
    const dom = lsDomain();
    if (dom) setUrl((u) => (u ? u : `https://${dom}`));
    const priorKws = lsKeywords();
    if (priorKws.length) setKeyword((k) => (k ? k : priorKws[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-outside closes the country panel.
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [panelOpen]);

  const countryLabel = useMemo(() => {
    const sel = selectedCountries;
    if (!sel.length)
      return { label: "No country selected", hint: "(pick at least one)" };
    if (sel.length === 1) {
      const found = countryList.find((c) => c.code === sel[0]);
      return {
        label: found ? found.name : sel[0],
        hint: "(1 selected — click to add more)",
      };
    }
    if (sel.length <= CS_MAX_COUNTRIES) {
      return {
        label: `${sel[0]} + ${sel.length - 1} more`,
        hint: `(${sel.length} selected — runs in parallel)`,
      };
    }
    return {
      label: `${sel.length} countries selected`,
      hint: `(${sel.length} selected — only top ${CS_MAX_COUNTRIES} will be scored)`,
    };
  }, [selectedCountries, countryList]);

  const filteredCountries = useMemo(() => {
    const f = countrySearch.toLowerCase().trim();
    return countryList.filter(
      (c) =>
        !f ||
        c.name.toLowerCase().includes(f) ||
        c.code.toLowerCase().includes(f),
    );
  }, [countryList, countrySearch]);

  function toggleCountry(code: string, checked: boolean) {
    setSelectedCountries((prev) => {
      const sel = new Set(prev);
      if (checked) sel.add(code);
      else sel.delete(code);
      return Array.from(sel);
    });
  }

  function selectAllCountries() {
    if (!countryList.length) {
      flashHint("Country list still loading — try again in a moment.");
      return;
    }
    const all = countryList.map((c) => c.code);
    setSelectedCountries(all);
    flashHint(
      `Selected all ${all.length} countries · only the top ${CS_MAX_COUNTRIES} (by market priority) will actually be scored per run.`,
    );
  }

  function clearCountries() {
    setSelectedCountries([]);
  }

  function onKeywordChange(v: string) {
    setKeyword(v);
    // Clear stale chips when keyword changes.
    setRelated((r) =>
      r && r.forKw && r.forKw !== v.trim().toLowerCase() ? null : r,
    );
  }

  async function loadRelatedKeywords() {
    let kw = keyword.trim();
    const priorKws = lsKeywords();
    if ((!kw || kw.length < 2) && priorKws.length) {
      kw = String(priorKws[0]).trim();
      setKeyword(kw);
    }
    // Fallback: derive a seed from the URL field.
    if (!kw || kw.length < 2) {
      const urlVal = url.trim();
      if (urlVal) {
        try {
          const host = urlVal
            .replace(/^https?:\/\//i, "")
            .split("/")[0]
            .toLowerCase();
          const stem = host.replace(/^www\./, "").split(".")[0];
          if (stem && stem.length >= 2) {
            kw = stem;
            setKeyword(kw);
            flashHint(`💡 No keyword set — using brand seed "${stem}" from your URL.`);
          }
        } catch {
          /* ignore parse errors */
        }
      }
    }
    if (!kw || kw.length < 2) {
      focusAndFlash(
        keywordRef.current,
        "⚠️ Type a keyword above (or paste a URL in the URL field) — we need a seed to suggest related ideas.",
      );
      return;
    }
    const country = selectedCountries[0] || "US";
    setSuggesting(true);
    setRelated({ forKw: kw.toLowerCase(), priorKws, remoteKws: [], loading: true });
    const j = await apiGet<RelatedResult>(
      `/api/content-scorer/related?keyword=${encodeURIComponent(kw)}&country=${encodeURIComponent(country)}`,
    );
    setRelated({
      forKw: kw.toLowerCase(),
      priorKws,
      remoteKws: j.ok && Array.isArray(j.keywords) ? j.keywords : [],
      remoteError: j.error,
      loading: false,
    });
    setSuggesting(false);
  }

  function useKeyword(kw: string) {
    setKeyword(kw);
    setRelated((r) =>
      r && r.forKw && r.forKw !== kw.trim().toLowerCase() ? null : r,
    );
    keywordRef.current?.focus();
  }

  async function runScorer() {
    const kw = keyword.trim();
    const u = url.trim();
    const d = draft.trim();
    const allSelected = selectedCountries.slice();
    if (!kw) {
      setResult(null);
      setTrimNotice(null);
      setResultError("⚠️ Enter a target keyword first.");
      focusAndFlash(keywordRef.current, "⚠️ Enter a target keyword first.");
      return;
    }
    if (!allSelected.length) {
      setResult(null);
      setTrimNotice(null);
      setResultError("⚠️ Pick at least one country.");
      flashHint("⚠️ Pick at least one country.");
      return;
    }
    if (!u && !d) {
      setResult(null);
      setTrimNotice(null);
      setResultError("⚠️ Enter your page URL or paste a draft.");
      focusAndFlash(urlRef.current, "⚠️ Enter your page URL or paste a draft below.");
      return;
    }
    const { kept: countries, dropped } = trimToCap(allSelected);
    setTrimNotice(
      dropped.length
        ? { selected: allSelected.length, kept: countries, dropped }
        : null,
    );
    setResultError("");
    setResult(null);
    setActiveTab(0);
    setRunning(true);
    const body: {
      keyword: string;
      countries: string[];
      targetUrl?: string;
      targetText?: string;
    } = { keyword: kw, countries };
    if (u) body.targetUrl = u;
    if (d) body.targetText = d;
    const j = await apiPost<AnalyzeResult>(
      "/api/content-scorer/analyze",
      body,
    );
    setRunning(false);
    if (!j.ok) {
      setResultError(`Scoring failed: ${j.error || "unknown error"}`);
      return;
    }
    setResult(j);
  }

  const noun =
    selectedCountries.length === 1
      ? "country"
      : `${trimToCap(selectedCountries).kept.length} countries`;

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
              <div className="breadcrumb" style={{ color: "#E9D5FF" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(233,213,255,.75)" }}
                >
                  Grow
                </span>{" "}
                <span
                  className="bc-sep"
                  style={{ color: "rgba(255,255,255,.3)" }}
                >
                  ›
                </span>{" "}
                Content Scorer
              </div>
              <h2 className="view-title">Content Optimisation Scorer</h2>
              <p className="view-sub">
                Pulls the live top-10 SERP for any keyword, scrapes what&apos;s
                already winning, and scores your page 0–100 against the
                SERP-winning average — with concrete recommendations to close the
                gap.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 60 }}
      >
        <div className="cs-card">
          <div className="cs-form">
            <div className="cs-field">
              <label>Target keyword</label>
              <input
                ref={keywordRef}
                type="text"
                placeholder="e.g. ai marketing automation tools"
                value={keyword}
                onChange={(e) => onKeywordChange(e.target.value)}
              />
              <div className="cs-related-row">
                <button
                  type="button"
                  className="cs-related-btn"
                  disabled={suggesting}
                  onClick={loadRelatedKeywords}
                  title="Type a target keyword above first, then click for related keyword ideas with search volume."
                >
                  {suggesting ? "Loading…" : "✨ Suggest related"}
                </button>
                <div className="cs-related-chips">
                  <RelatedChips data={related} onUse={useKeyword} />
                </div>
              </div>
            </div>

            <div className="cs-field">
              <label>
                Country{" "}
                <span style={{ opacity: 0.6, fontWeight: 400 }}>
                  {countryLabel.hint}
                </span>
              </label>
              <div className="cs-multi" ref={pickerRef}>
                <button
                  type="button"
                  className="cs-multi-toggle"
                  aria-expanded={panelOpen}
                  aria-haspopup="listbox"
                  onClick={() => setPanelOpen((o) => !o)}
                >
                  <span>{countryLabel.label}</span>
                  <span className="cs-multi-caret">▾</span>
                </button>
                <div className="cs-multi-panel" hidden={!panelOpen}>
                  <div className="cs-multi-actions">
                    <input
                      type="text"
                      className="cs-multi-search"
                      placeholder="Search countries…"
                      value={countrySearch}
                      onChange={(e) => setCountrySearch(e.target.value)}
                    />
                    <button
                      type="button"
                      className="cs-multi-link"
                      onClick={selectAllCountries}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="cs-multi-link"
                      onClick={clearCountries}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="cs-multi-list">
                    {!countryList.length ? (
                      "Loading…"
                    ) : !filteredCountries.length ? (
                      <div
                        style={{
                          opacity: 0.6,
                          padding: 12,
                          fontSize: ".85rem",
                        }}
                      >
                        No countries match.
                      </div>
                    ) : (
                      filteredCountries.map((c) => {
                        const sel = selectedCountries.includes(c.code);
                        return (
                          <label
                            key={c.code}
                            className={
                              "cs-multi-item" +
                              (sel ? " cs-multi-item-sel" : "")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={(e) =>
                                toggleCountry(c.code, e.target.checked)
                              }
                            />
                            <span className="cs-multi-code">{c.code}</span>
                            <span className="cs-multi-name">{c.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="cs-multi-foot">
                    Pick any number — the scorer runs the top {CS_MAX_COUNTRIES}{" "}
                    (by market priority) per submission.
                  </div>
                </div>
              </div>
            </div>

            <div className="cs-field cs-field-wide">
              <label>
                Your page URL{" "}
                <span style={{ opacity: 0.6, fontWeight: 400 }}>
                  (or paste draft below)
                </span>
              </label>
              <input
                ref={urlRef}
                type="text"
                placeholder="https://yoursite.com/your-page"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="cs-field cs-field-full">
              <label>
                Or paste your draft content{" "}
                <span style={{ opacity: 0.6, fontWeight: 400 }}>
                  (optional — used if URL is empty)
                </span>
              </label>
              <textarea
                rows={4}
                placeholder="Paste your article draft here for scoring before publishing…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>

            <div
              className="cs-field cs-field-full"
              style={{ display: "flex", gap: 10, alignItems: "center" }}
            >
              <button
                className="cs-go"
                disabled={running}
                onClick={runScorer}
              >
                {running ? "Scoring…" : "Score my content"}
              </button>
              <span
                style={{
                  fontSize: ".85rem",
                  opacity: 0.7,
                  color: runHintFlash ? "#F59E0B" : undefined,
                }}
              >
                {runHint}
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          {trimNotice && (
            <div className="cs-trim-notice">
              <strong>Trimmed for this run:</strong> you selected{" "}
              {trimNotice.selected} countries; the scorer caps at{" "}
              {CS_MAX_COUNTRIES} per run to stay fast and stay within
              data-provider limits.
              <div style={{ marginTop: 6 }}>
                <strong>Scoring:</strong> {trimNotice.kept.join(", ")}
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>Skipped:</strong> {trimNotice.dropped.join(", ")}{" "}
                <span style={{ opacity: 0.65 }}>
                  — re-submit with these selected to score them.
                </span>
              </div>
            </div>
          )}

          {running && (
            <div className="cs-loading">
              <div className="cs-spinner" />
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                  Analysing the SERP for &quot;{keyword.trim()}&quot; across{" "}
                  {noun}…
                </div>
                <div
                  style={{
                    opacity: 0.75,
                    fontSize: ".9rem",
                    marginTop: 4,
                  }}
                >
                  Fetching the top 10 results · scraping each page · extracting
                  LSI terms · scoring your content
                </div>
              </div>
            </div>
          )}

          {!running && resultError && (
            <div className="cs-warn">{resultError}</div>
          )}

          {!running && result && (
            <ResultView result={result} activeTab={activeTab} onTab={setActiveTab} />
          )}
        </div>
      </div>
    </div>
  );
}

function RelatedChips({
  data,
  onUse,
}: {
  data: RelatedState | null;
  onUse: (kw: string) => void;
}) {
  if (!data) return null;
  const { priorKws, remoteKws, remoteError, loading } = data;
  const seen = new Set<string>();
  const dedupe = <T extends { keyword: string }>(list: T[]): T[] =>
    list.filter((k) => {
      const key = k.keyword.toLowerCase();
      if (seen.has(key) || key === data.forKw) return false;
      seen.add(key);
      return true;
    });
  const priorClean = dedupe(priorKws.map((k) => ({ keyword: k })));
  const remoteClean = dedupe(remoteKws.map((k) => ({ ...k })));

  if (loading && !priorKws.length) {
    return (
      <span style={{ opacity: 0.6, fontSize: ".8rem" }}>
        Fetching related keywords…
      </span>
    );
  }

  const hasAny = priorClean.length || remoteClean.length;
  if (!loading && !hasAny) {
    return (
      <span style={{ opacity: 0.6, fontSize: ".8rem" }}>
        No related keywords found
        {remoteError ? " — " + remoteError : ""}.
      </span>
    );
  }

  return (
    <>
      {priorClean.length > 0 && (
        <div className="cs-rel-section">
          <span className="cs-rel-section-label">From your analyses</span>
          {priorClean.map((k) => (
            <button
              key={"p-" + k.keyword}
              type="button"
              className="cs-rel-chip cs-rel-chip-analysis"
              onClick={() => onUse(k.keyword)}
              title="From a prior InfoGenie analysis — click to use"
            >
              {k.keyword}
              <span className="cs-chip-vol cs-chip-vol-local">your data</span>
            </button>
          ))}
        </div>
      )}
      {remoteClean.length > 0 && (
        <div className="cs-rel-section">
          <span className="cs-rel-section-label">
            Live SERP related (DataForSEO)
          </span>
          {remoteClean.map((k) => (
            <button
              key={"r-" + k.keyword}
              type="button"
              className="cs-rel-chip"
              onClick={() => onUse(k.keyword)}
              title="Click to use this keyword"
            >
              {k.keyword}
              {k.searchVolume != null && (
                <span className="cs-chip-vol">
                  {Number(k.searchVolume).toLocaleString()}/mo
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {loading && priorKws.length > 0 && (
        <span
          style={{ opacity: 0.6, fontSize: ".8rem", marginLeft: 8 }}
        >
          + live SERP related…
        </span>
      )}
    </>
  );
}

function ResultView({
  result,
  activeTab,
  onTab,
}: {
  result: AnalyzeResult;
  activeTab: number;
  onTab: (i: number) => void;
}) {
  const all = Array.isArray(result.results) ? result.results : [];
  const ok = all.filter((r) => r && r.ok && r.score != null);
  const failed = all.filter((r) => !r || !r.ok || r.score == null);

  if (!ok.length && all.length) {
    return (
      <div className="cs-warn">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          No countries returned scoreable results.
        </div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {failed.map((r, i) => (
            <li key={i}>
              <strong>{r.country || "?"}</strong>:{" "}
              {r.error || r.warning || "no SERP results"}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Legacy single-country back-compat path.
  if (!all.length) {
    return (
      <CountryPanel
        data={result as unknown as CountryResult}
        target={result.target}
        generatedAt={result.generatedAt}
      />
    );
  }

  const isMulti = ok.length > 1;
  const sorted = ok.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const idx = Math.min(activeTab, ok.length - 1);

  return (
    <>
      {isMulti && (
        <div className="cs-card cs-multi-summary">
          <h4 className="cs-h">
            Cross-country comparison · &quot;{result.keyword}&quot;
          </h4>
          <p className="cs-h-sub">
            Same page, scored against the live top-10 SERP in each country. Higher
            = your page is closer to what&apos;s already winning there.
          </p>
          <div className="cs-multi-grid">
            {sorted.map((r) => {
              const sc = Number(r.score || 0);
              const col = scoreColor(sc);
              return (
                <div className="cs-multi-card" key={r.country}>
                  <div
                    className="cs-multi-circle"
                    style={{
                      background: `conic-gradient(${col} ${sc * 3.6}deg, #1E293B 0deg)`,
                    }}
                  >
                    <div className="cs-multi-circle-inner">
                      <div
                        style={{
                          color: col,
                          fontWeight: 800,
                          fontSize: "1.4rem",
                        }}
                      >
                        {sc}
                      </div>
                      <div style={{ opacity: 0.6, fontSize: ".7rem" }}>
                        /100
                      </div>
                    </div>
                  </div>
                  <div className="cs-multi-cc">{r.country}</div>
                </div>
              );
            })}
          </div>
          {failed.length > 0 && (
            <div
              style={{ marginTop: 12, fontSize: ".82rem", opacity: 0.7 }}
            >
              Note: {failed.length} country{failed.length > 1 ? "ies" : ""}{" "}
              failed —{" "}
              {failed
                .map(
                  (r) =>
                    `${r.country} (${r.error || r.warning || "unknown"})`,
                )
                .join(", ")}
            </div>
          )}
        </div>
      )}

      {isMulti && (
        <div className="cs-tabs">
          {ok.map((r, i) => (
            <button
              key={r.country}
              className={"cs-tab" + (i === idx ? " cs-tab-active" : "")}
              onClick={() => onTab(i)}
            >
              {r.country} · {r.score}
            </button>
          ))}
        </div>
      )}

      {ok.map((r, i) => (
        <div key={r.country} hidden={isMulti && i !== idx}>
          <CountryPanel
            data={r}
            target={result.target}
            generatedAt={result.generatedAt}
          />
        </div>
      ))}
    </>
  );
}

function competitorStatus(c: CompetitorRow): {
  label: string;
  color: string;
  tip: string;
} {
  const raw = String(c.error || "failed");
  const m403 = /\b(403|forbidden)\b/i.test(raw);
  const m400 = /\b400\b/i.test(raw) && !/\b40[1-9]\b/i.test(raw);
  const m429 = /\b429\b/i.test(raw);
  const m5xx = /\b5\d{2}\b/i.test(raw);
  const mTimeout = /timeout|timed out|aborted/i.test(raw);
  if (m403)
    return {
      label: "Bot-blocked",
      color: "#94A3B8",
      tip: "This site uses anti-bot protection (Cloudflare/Akamai/etc.) and returned HTTP 403. The page exists — InfoGenie just can’t crawl it from outside.",
    };
  if (m429)
    return {
      label: "Rate-limited",
      color: "#94A3B8",
      tip: "This site rate-limited our crawler (HTTP 429). Re-run the audit in a few minutes.",
    };
  if (m400)
    return {
      label: "Blocked",
      color: "#94A3B8",
      tip: "This site rejected our crawler (HTTP 400). Many sites — e.g. Facebook, LinkedIn — require login to view content.",
    };
  if (m5xx)
    return {
      label: "Server error",
      color: "#F59E0B",
      tip: `Origin server returned an error: ${raw}`,
    };
  if (mTimeout)
    return {
      label: "Timed out",
      color: "#F59E0B",
      tip: "The site took too long to respond. Re-run to retry.",
    };
  return { label: "Failed", color: "#EF4444", tip: raw };
}

function CountryPanel({
  data,
  target,
  generatedAt,
}: {
  data: CountryResult;
  target?: { url?: string };
  generatedAt?: string;
}) {
  const score = Number(data.score || 0);
  const col = scoreColor(score);
  const label = scoreLabel(score);
  const b: Breakdown = data.breakdown || {};
  const tgt = target || data.target || {};
  const country = data.country || "";

  const wc = b.wordCount || {};
  const hd = b.headings || {};
  const lsi = b.lsiCoverage || {};
  const faq = b.faq || {};
  const schema = b.schema || {};
  const tm = b.titleMeta || {};

  const barRows: { label: string; desc: string; item: BarItem }[] = [
    {
      label: "Word count",
      desc: `Yours ${wc.target || 0} · SERP median ${wc.median || 0}`,
      item: wc,
    },
    {
      label: "Heading structure",
      desc: `H1 ${hd.h1 || 0} · H2 ${hd.h2 || 0} · H3 ${hd.h3 || 0} · SERP avg H2 ${hd.avgH2InSerp || 0}`,
      item: hd,
    },
    {
      label: "Topic / LSI coverage",
      desc: `${lsi.covered || 0} of ${lsi.total || 0} key terms covered`,
      item: lsi,
    },
    {
      label: "FAQ section",
      desc: faq.hasSchema
        ? "FAQPage schema present"
        : faq.hasHeuristic
          ? "FAQ-style headings detected"
          : "No FAQ detected",
      item: faq,
    },
    {
      label: "Schema markup",
      desc: (schema.types || []).length
        ? `Types: ${(schema.types || []).join(", ")}`
        : "No JSON-LD detected",
      item: schema,
    },
    {
      label: "Title & meta",
      desc: `Title ${tm.titleLen || 0} chars · Meta ${tm.metaDescLen || 0} chars`,
      item: tm,
    },
  ];

  const recs = data.recommendations || [];
  const lsiCovered = lsi.coveredTerms || [];
  const lsiMissing = lsi.missingTerms || [];
  const comps = data.competitorSummary || [];

  return (
    <>
      <div className="cs-result-grid">
        <div className="cs-card cs-score-card">
          <div
            className="cs-score-circle"
            style={{
              background: `conic-gradient(${col} ${score * 3.6}deg, #1E293B 0deg)`,
            }}
          >
            <div className="cs-score-inner">
              <div className="cs-score-num" style={{ color: col }}>
                {score}
              </div>
              <div className="cs-score-of">/100</div>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <div
              style={{ fontWeight: 800, fontSize: "1.15rem", color: col }}
            >
              {label}
            </div>
            <div style={{ opacity: 0.75, fontSize: ".85rem", marginTop: 4 }}>
              vs SERP-winning average for &quot;{data.keyword}&quot;
            </div>
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: ".85rem",
              opacity: 0.85,
              lineHeight: 1.5,
            }}
          >
            <div>
              <strong>Your page:</strong> {tgt.url || "(draft)"}
            </div>
            <div style={{ marginTop: 6 }}>
              <strong>Country:</strong> {country} ·{" "}
              <strong>Generated:</strong>{" "}
              {generatedAt ? new Date(generatedAt).toLocaleString() : "—"}
            </div>
          </div>
        </div>

        <div className="cs-card">
          <h4 className="cs-h">Score breakdown</h4>
          <div className="cs-bars">
            {barRows.map((row, i) => {
              const item = row.item || {};
              const pct = item.max
                ? Math.round(((item.score || 0) / item.max) * 100)
                : 0;
              const barColor =
                pct >= 80 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
              return (
                <div className="cs-bar-row" key={i}>
                  <div className="cs-bar-label">
                    <div className="cs-bar-name">{row.label}</div>
                    <div className="cs-bar-desc">{row.desc}</div>
                  </div>
                  <div className="cs-bar-track">
                    <div
                      className="cs-bar-fill"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </div>
                  <div className="cs-bar-score">
                    {item.score || 0}
                    <span style={{ opacity: 0.5, fontWeight: 500 }}>
                      /{item.max || 0}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="cs-card" style={{ marginTop: 24 }}>
        <h4 className="cs-h">
          Topic coverage — semantic terms competitors use
        </h4>
        <p className="cs-h-sub">
          Extracted from the live top-10 SERP. Adding the missing terms is the
          single biggest content lever.
        </p>
        <div className="cs-lsi-grid">
          <div>
            <div className="cs-lsi-title" style={{ color: "#10B981" }}>
              ✓ Already covered ({lsiCovered.length})
            </div>
            <div className="cs-lsi-tags">
              {lsiCovered.length ? (
                lsiCovered.map((t, i) => (
                  <span className="cs-lsi-tag cs-lsi-ok" key={i}>
                    {t}
                  </span>
                ))
              ) : (
                <span style={{ opacity: 0.5, fontSize: ".85rem" }}>
                  None yet
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="cs-lsi-title" style={{ color: "#EF4444" }}>
              ✗ Missing — add these ({lsiMissing.length})
            </div>
            <div className="cs-lsi-tags">
              {lsiMissing.length ? (
                lsiMissing.map((t, i) => (
                  <span className="cs-lsi-tag cs-lsi-miss" key={i}>
                    {t}
                  </span>
                ))
              ) : (
                <span style={{ opacity: 0.5, fontSize: ".85rem" }}>
                  All key terms covered 🎉
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="cs-card" style={{ marginTop: 24 }}>
        <h4 className="cs-h">Concrete recommendations</h4>
        <p className="cs-h-sub">
          Prioritised actions to close the gap with what&apos;s already winning.
        </p>
        <div className="cs-recs">
          {recs.length ? (
            recs.map((r, i) => {
              const pri = (r.priority || "medium").toLowerCase();
              const priColor =
                pri === "high"
                  ? "#EF4444"
                  : pri === "low"
                    ? "#94A3B8"
                    : "#F59E0B";
              return (
                <div className="cs-rec" key={i}>
                  <div className="cs-rec-head">
                    <span
                      className="cs-rec-pri"
                      style={{ background: priColor }}
                    >
                      {pri.toUpperCase()}
                    </span>
                    <span className="cs-rec-cat">
                      {r.category || "Improvement"}
                    </span>
                  </div>
                  <div className="cs-rec-action">{r.action || ""}</div>
                  {r.why && <div className="cs-rec-why">{r.why}</div>}
                </div>
              );
            })
          ) : (
            <div style={{ opacity: 0.7, padding: 12 }}>
              No additional recommendations — your page already covers the basics
              for this keyword.
            </div>
          )}
        </div>
      </div>

      <div className="cs-card" style={{ marginTop: 24 }}>
        <h4 className="cs-h">SERP top 10 — what you&apos;re up against</h4>
        <div style={{ overflowX: "auto" }}>
          <table className="cs-comp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Domain &amp; title</th>
                <th style={{ textAlign: "right" }}>Words</th>
                <th>H2s</th>
                <th>FAQ</th>
                <th>Schema</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((c, i) => {
                const status = c.ok ? null : competitorStatus(c);
                return (
                  <tr key={i}>
                    <td
                      style={{
                        textAlign: "center",
                        fontWeight: 700,
                        color: "#7C3AED",
                      }}
                    >
                      {c.rank}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: ".88rem" }}>
                        {c.domain}
                      </div>
                      <div style={{ opacity: 0.6, fontSize: ".78rem" }}>
                        {(c.title || "").slice(0, 80)}
                      </div>
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {c.ok ? c.wordCount.toLocaleString() : "—"}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {c.ok ? c.h2 : "—"}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {c.ok ? (
                        c.hasFAQ ? (
                          <span style={{ color: "#10B981" }}>✓</span>
                        ) : (
                          <span style={{ opacity: 0.3 }}>—</span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {c.ok ? (
                        c.hasSchema ? (
                          <span style={{ color: "#10B981" }}>✓</span>
                        ) : (
                          <span style={{ opacity: 0.3 }}>—</span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      style={{ textAlign: "center", fontSize: ".78rem" }}
                    >
                      {c.ok ? (
                        <span style={{ color: "#10B981" }}>scraped</span>
                      ) : status ? (
                        <span
                          style={{ color: status.color, fontWeight: 600 }}
                          title={status.tip}
                        >
                          {status.label}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
