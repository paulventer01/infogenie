"use client";

// Native React port of the legacy `ad-library` panel (was
// `window.buildAdLibrary` + `#view-ad-library` in index.html). Pulls
// competitors' currently-running ads from Meta (live Graph API), Google Ads
// Transparency Center, LinkedIn Ad Library, TikTok Ad Library, and X (Twitter)
// Ads Transparency against the existing Express API:
//   • POST /api/ad-library/<platform>        { brand, country } -> { ok, ads, note }
//   • POST /api/ad-library/analyze-creative  -> { ok, analysis, source }
//   • POST /api/ad-swipe/save                -> { ok }
// The brand picker + competitor options pre-fill from the legacy
// `window.analysisData` global (set by the home-page competitor analysis), which
// still lives in the replayed SPA.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api";

// ── Country list (UI configuration — mirrors window._AL_COUNTRIES) ──────────
const AL_COUNTRIES: [string, string][] = [
  ["ALL", "🌍 All countries"],
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"],
  ["AU", "Australia"], ["NZ", "New Zealand"], ["IE", "Ireland"],
  ["ZA", "South Africa"], ["NG", "Nigeria"], ["KE", "Kenya"], ["EG", "Egypt"],
  ["MA", "Morocco"], ["GH", "Ghana"],
  ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"],
  ["NL", "Netherlands"], ["BE", "Belgium"], ["PT", "Portugal"],
  ["CH", "Switzerland"], ["AT", "Austria"], ["SE", "Sweden"], ["NO", "Norway"],
  ["DK", "Denmark"], ["FI", "Finland"], ["IS", "Iceland"], ["PL", "Poland"],
  ["CZ", "Czech Republic"], ["SK", "Slovakia"], ["HU", "Hungary"],
  ["RO", "Romania"], ["BG", "Bulgaria"], ["GR", "Greece"], ["HR", "Croatia"],
  ["SI", "Slovenia"], ["EE", "Estonia"], ["LV", "Latvia"], ["LT", "Lithuania"],
  ["LU", "Luxembourg"], ["MT", "Malta"], ["CY", "Cyprus"], ["UA", "Ukraine"],
  ["RS", "Serbia"],
  ["RU", "Russia"], ["TR", "Turkey"], ["IL", "Israel"],
  ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["QA", "Qatar"],
  ["KW", "Kuwait"], ["BH", "Bahrain"], ["OM", "Oman"], ["JO", "Jordan"],
  ["LB", "Lebanon"],
  ["IN", "India"], ["PK", "Pakistan"], ["BD", "Bangladesh"],
  ["LK", "Sri Lanka"], ["NP", "Nepal"],
  ["CN", "China"], ["HK", "Hong Kong"], ["TW", "Taiwan"], ["JP", "Japan"],
  ["KR", "South Korea"], ["SG", "Singapore"], ["MY", "Malaysia"],
  ["TH", "Thailand"], ["VN", "Vietnam"], ["ID", "Indonesia"],
  ["PH", "Philippines"],
  ["MX", "Mexico"], ["BR", "Brazil"], ["AR", "Argentina"], ["CL", "Chile"],
  ["CO", "Colombia"], ["PE", "Peru"], ["UY", "Uruguay"], ["VE", "Venezuela"],
  ["EC", "Ecuador"], ["BO", "Bolivia"], ["PY", "Paraguay"],
  ["CR", "Costa Rica"], ["PA", "Panama"], ["DO", "Dominican Republic"],
  ["GT", "Guatemala"], ["HN", "Honduras"], ["SV", "El Salvador"],
  ["NI", "Nicaragua"], ["PR", "Puerto Rico"], ["JM", "Jamaica"],
  ["TT", "Trinidad and Tobago"],
];

const PLATFORMS: [string, string, string][] = [
  ["meta", "📘 Meta Ad Library", "#1877F2"],
  ["google", "🔍 Google Ads (Search · Display · YouTube)", "#34A853"],
  ["tiktok", "🎵 TikTok Ad Library", "#000000"],
  ["linkedin", "💼 LinkedIn Ad Library", "#0A66C2"],
  ["x", "𝕏 X (Twitter) Ads Transparency", "#0F172A"],
];

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta Ad Library",
  google: "Google Ads Transparency Center",
  tiktok: "TikTok Ad Library",
  linkedin: "LinkedIn Ad Library",
  x: "X (Twitter) Ads Transparency",
};

const MANUAL = "__manual__";
const MAX_RENDER_ADS = 150;

interface Ad {
  id?: string | number;
  page_name?: string;
  advertiser?: string;
  title?: string;
  body?: string;
  ad_text?: string;
  description?: string;
  snapshot_url?: string;
  url?: string;
  created?: string | number;
  first_seen?: string;
  platforms?: unknown[];
  industry?: string;
  _country?: string;
}

interface PlatformResult {
  ok: boolean;
  ads?: Ad[];
  note?: string | null;
  error?: string;
}

interface ResultBlock {
  platform: string;
  label: string;
  brand: string;
  country: string;
  res: PlatformResult;
}

interface AnalysisCompetitor {
  domain?: string;
  url?: string;
  website?: string;
  name?: string;
}
interface AnalysisData {
  url?: string;
  domain?: string;
  brandName?: string;
  companyName?: string;
  competitors?: AnalysisCompetitor[];
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}

function norm(u: string): string {
  return String(u || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function domToBrand(d: string): string {
  const core = (d || "").split(".")[0];
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : "";
}

function safeUrl(u: string | undefined): string {
  if (!u) return "";
  try {
    const parsed = new URL(u, "https://x");
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return u;
  } catch {
    /* ignore */
  }
  return "";
}

// Bounded-concurrency async map (mirrors legacy _alMapLimit). Caps the
// per-country fan-out so a multi-country search never fires hundreds of fetches
// at once.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let idx = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = new Array(n).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export default function AdLibrary() {
  const [brandPick, setBrandPick] = useState(MANUAL);
  const [brand, setBrand] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    () => new Set(PLATFORMS.map((p) => p[0])),
  );
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(
    () => new Set(["US"]),
  );
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [results, setResults] = useState<ResultBlock[]>([]);
  const [topError, setTopError] = useState("");

  const countryWrapRef = useRef<HTMLDivElement>(null);

  // Brand picker options pre-filled from the latest analysis.
  const { ownBrand, compNames } = useMemo(() => {
    const ad = getAnalysisData();
    const ownDom = norm(ad.url || ad.domain || "");
    const own = ad.brandName || ad.companyName || domToBrand(ownDom);
    const comps = Array.isArray(ad.competitors) ? ad.competitors : [];
    const names = comps
      .map((c) => {
        const d = norm(c.domain || c.url || c.website || "");
        return c.name || domToBrand(d);
      })
      .filter((n): n is string => !!n);
    return { ownBrand: own, compNames: names };
  }, []);

  useEffect(() => {
    if (ownBrand) {
      setBrandPick(ownBrand);
      setBrand((b) => b || ownBrand);
    }
  }, [ownBrand]);

  // Close the country menu when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        countryWrapRef.current &&
        !countryWrapRef.current.contains(e.target as Node)
      ) {
        setCountryMenuOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const totalCountries = AL_COUNTRIES.filter(([c]) => c !== "ALL").length;
  const countryLabel = (() => {
    if (selectedCountries.size === 0) return "— pick at least one —";
    if (selectedCountries.size === totalCountries)
      return `🌍 All countries (${totalCountries})`;
    if (selectedCountries.size === 1) {
      const code = Array.from(selectedCountries)[0];
      const found = AL_COUNTRIES.find(([c]) => c === code);
      return found ? `${found[1]} (${code})` : code;
    }
    return `${selectedCountries.size} countries selected`;
  })();

  const brandHint =
    ownBrand || compNames.length
      ? {
          color: "#15803D",
          text: "✓ Pre-filled from your latest analysis. Pick another brand or type your own.",
        }
      : { color: "#9CA3AF", text: "" };

  function onBrandPickChange(v: string) {
    setBrandPick(v);
    if (v && v !== MANUAL) setBrand(v);
    else if (v === MANUAL) setBrand("");
  }

  function toggleCountry(code: string, checked: boolean) {
    setSelectedCountries((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function selectAllCountries(all: boolean) {
    if (all) {
      setSelectedCountries(
        new Set(AL_COUNTRIES.filter(([c]) => c !== "ALL").map(([c]) => c)),
      );
    } else {
      setSelectedCountries(new Set());
    }
  }

  function togglePlatform(id: string, checked: boolean) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllPlatforms(checked: boolean) {
    setSelectedPlatforms(
      checked ? new Set(PLATFORMS.map((p) => p[0])) : new Set(),
    );
  }

  const filteredCountries = (() => {
    const f = countrySearch.toLowerCase().trim();
    return AL_COUNTRIES.filter(
      ([code, name]) =>
        code !== "ALL" &&
        (!f ||
          name.toLowerCase().includes(f) ||
          code.toLowerCase().includes(f)),
    );
  })();

  async function runSearch() {
    const b = brand.trim();
    const allCodes = Array.from(selectedCountries);
    const selected = PLATFORMS.map((p) => p[0]).filter((id) =>
      selectedPlatforms.has(id),
    );
    setResults([]);
    setTopError("");
    if (!b) {
      setTopError("⚠ Brand required");
      return;
    }
    if (!allCodes.length) {
      setTopError("⚠ Select at least one country");
      return;
    }
    if (!selected.length) {
      setTopError("⚠ Select at least one platform");
      return;
    }

    // 10+ countries → collapse to a single worldwide search per platform.
    const useGlobal = allCodes.length >= 10;
    const countries = useGlobal ? ["ALL"] : allCodes;
    const countryLbl = useGlobal
      ? `All countries (${allCodes.length})`
      : allCodes.length === 1
        ? allCodes[0]
        : `${allCodes.length} countries`;

    setRunning(true);
    setProgress(selected);

    await Promise.all(
      selected.map(async (platform) => {
        let finalRes: PlatformResult;
        try {
          const perCountry = await mapLimit(countries, 6, async (cc) => {
            const r = await apiPost<PlatformResult>(
              `/api/ad-library/${platform}`,
              { brand: b, country: cc },
            );
            return { cc, r };
          });
          const ok = perCountry.filter((x) => x.r && x.r.ok);
          const errs = perCountry.filter((x) => !x.r || !x.r.ok);
          const seen = new Set<string>();
          const merged: Ad[] = [];
          ok.forEach(({ cc, r }) => {
            (r.ads || []).forEach((a) => {
              const id = String(
                a.id ||
                  `${a.page_name || a.advertiser || ""}::${a.title || ""}::${(
                    a.body ||
                    a.ad_text ||
                    ""
                  ).slice(0, 80)}`,
              );
              if (seen.has(id)) return;
              seen.add(id);
              merged.push({ _country: cc, ...a });
            });
          });
          const totalFound = merged.length;
          if (merged.length > MAX_RENDER_ADS) merged.length = MAX_RENDER_ADS;
          const noteParts: string[] = [];
          if (errs.length)
            noteParts.push(
              `${errs.length} of ${countries.length} country lookup(s) failed.`,
            );
          if (totalFound > MAX_RENDER_ADS)
            noteParts.push(
              `Showing first ${MAX_RENDER_ADS} of ${totalFound} ads.`,
            );
          finalRes = ok.length
            ? { ok: true, ads: merged, note: noteParts.join(" ") || null }
            : {
                ok: false,
                error:
                  (errs[0] && errs[0].r && errs[0].r.error) ||
                  "All country lookups failed",
              };
        } catch (e) {
          finalRes = {
            ok: false,
            error:
              "Network error: " +
              (e instanceof Error ? e.message : "unknown"),
          };
        }
        setProgress((prev) => prev.filter((p) => p !== platform));
        setResults((prev) => [
          ...prev,
          {
            platform,
            label: PLATFORM_LABELS[platform] || platform,
            brand: b,
            country: countryLbl,
            res: finalRes,
          },
        ]);
      }),
    );

    setRunning(false);
    setProgress([]);
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 4,
  };
  const inputStyle: React.CSSProperties = {
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 6,
    fontSize: "0.9rem",
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
                <span className="bc-sep">›</span> Ad Library Spy
              </div>
              <h2 className="view-title">🕵️ Ad Library Spy</h2>
              <p className="view-sub">
                Pull competitors&apos; currently-running ads from Meta (live
                Graph API), Google Ads Transparency Center, LinkedIn Ad Library,
                TikTok Ad Library, and X (Twitter) Ads Transparency.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {/* Search form */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <h3
            style={{
              margin: "0 0 10px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
            }}
          >
            🔍 Search Ad Libraries
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 280px",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>BRAND / ADVERTISER</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={brandPick}
                  onChange={(e) => onBrandPickChange(e.target.value)}
                  style={{
                    ...inputStyle,
                    fontSize: "0.84rem",
                    minWidth: 200,
                    background: "#fff",
                  }}
                >
                  {ownBrand && (
                    <option value={ownBrand}>
                      🏠 Your brand — {ownBrand}
                    </option>
                  )}
                  {compNames.length > 0 && (
                    <optgroup label="Your analysed competitors">
                      {compNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value={MANUAL}>
                    {!ownBrand && !compNames.length
                      ? "✏️ Type a brand manually…"
                      : "✏️ Type manually…"}
                  </option>
                </select>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="…or type any brand"
                  style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                />
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: "0.68rem",
                  color: brandHint.color,
                }}
              >
                {brandHint.text ? (
                  brandHint.text
                ) : (
                  <>
                    No analysis yet. Run + analyse a competitor first to
                    auto-fill your brand &amp; competitors.
                  </>
                )}
              </div>
            </div>

            <div style={{ position: "relative" }} ref={countryWrapRef}>
              <label style={labelStyle}>
                COUNTRY{" "}
                <span
                  style={{
                    fontWeight: 600,
                    color: "#9CA3AF",
                    fontSize: "0.66rem",
                  }}
                >
                  (multi-select)
                </span>
              </label>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCountryMenuOpen((o) => !o);
                  setCountrySearch("");
                }}
                style={{
                  width: "100%",
                  padding: "9px 32px 9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.9rem",
                  background: "#fff",
                  textAlign: "left",
                  cursor: "pointer",
                  position: "relative",
                  fontWeight: 600,
                  color: "#0A1628",
                }}
              >
                <span>{countryLabel}</span>
                <span
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#6B7280",
                    fontSize: "0.7rem",
                    pointerEvents: "none",
                  }}
                >
                  ▼
                </span>
              </button>
              {countryMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "100%",
                    marginTop: 4,
                    background: "#fff",
                    border: "1px solid #D1D5DB",
                    borderRadius: 6,
                    boxShadow: "0 8px 24px rgba(0,0,0,.15)",
                    zIndex: 1000,
                    maxHeight: 340,
                    overflow: "hidden",
                  }}
                >
                  <input
                    type="text"
                    placeholder="Search country…"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    autoFocus
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "none",
                      borderBottom: "1px solid #E5E7EB",
                      fontSize: "0.82rem",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "6px 8px",
                      borderBottom: "1px solid #E5E7EB",
                      background: "#F9FAFB",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => selectAllCountries(true)}
                      style={{
                        flex: 1,
                        padding: 5,
                        background: "#0066FF",
                        color: "#fff",
                        border: 0,
                        borderRadius: 4,
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      ✓ All countries
                    </button>
                    <button
                      type="button"
                      onClick={() => selectAllCountries(false)}
                      style={{
                        flex: 1,
                        padding: 5,
                        background: "#fff",
                        color: "#0066FF",
                        border: "1px solid #0066FF",
                        borderRadius: 4,
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setCountryMenuOpen(false)}
                      style={{
                        padding: "5px 10px",
                        background: "#0F172A",
                        color: "#fff",
                        border: 0,
                        borderRadius: 4,
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Done
                    </button>
                  </div>
                  <div style={{ maxHeight: 230, overflowY: "auto" }}>
                    {filteredCountries.length ? (
                      filteredCountries.map(([code, name]) => (
                        <label
                          key={code}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 12px",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            color: "#0A1628",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedCountries.has(code)}
                            onChange={(e) =>
                              toggleCountry(code, e.target.checked)
                            }
                            style={{
                              width: 14,
                              height: 14,
                              accentColor: "#0066FF",
                              cursor: "pointer",
                            }}
                          />{" "}
                          {name} ({code})
                        </label>
                      ))
                    ) : (
                      <div
                        style={{
                          padding: 14,
                          textAlign: "center",
                          color: "#9CA3AF",
                          fontSize: "0.8rem",
                        }}
                      >
                        No matches
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Platforms */}
          <div
            style={{
              background: "#F9FAFB",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 800,
                  color: "#0A1628",
                }}
              >
                PLATFORMS TO SEARCH
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "#0066FF",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedPlatforms.size === PLATFORMS.length}
                  onChange={(e) => toggleAllPlatforms(e.target.checked)}
                  style={{
                    width: 14,
                    height: 14,
                    cursor: "pointer",
                    accentColor: "#0066FF",
                  }}
                />{" "}
                Select all
              </label>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
                gap: 8,
              }}
            >
              {PLATFORMS.map(([id, label, color]) => (
                <label
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    color: "#0A1628",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.has(id)}
                    onChange={(e) => togglePlatform(id, e.target.checked)}
                    style={{
                      width: 15,
                      height: 15,
                      cursor: "pointer",
                      accentColor: color,
                      flexShrink: 0,
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={runSearch}
            disabled={running}
            style={{
              width: "100%",
              background: "linear-gradient(135deg,#0066FF,#7C3AED)",
              color: "#fff",
              border: "none",
              padding: 13,
              borderRadius: 8,
              fontSize: "0.92rem",
              fontWeight: 800,
              cursor: running ? "wait" : "pointer",
              opacity: running ? 0.7 : 1,
              boxShadow: "0 4px 12px rgba(0,102,255,.25)",
            }}
          >
            {running ? "⏳ Searching…" : "🚀 Run Ad Library Search"}
          </button>
          <div
            style={{
              marginTop: 8,
              fontSize: "0.7rem",
              color: "#6B7280",
              lineHeight: 1.45,
            }}
          >
            📘 Meta = live Graph API · the rest scrape each platform&apos;s
            public ad transparency archive (requires PERPLEXITY_API_KEY).
          </div>
        </div>

        {/* Output */}
        <div>
          {topError && (
            <div
              style={{
                background: topError.startsWith("⚠ Select at least one platform")
                  ? "#FEF3C7"
                  : "#FEE2E2",
                color: topError.startsWith(
                  "⚠ Select at least one platform",
                )
                  ? "#92400E"
                  : "#991B1B",
                padding: 12,
                borderRadius: 8,
              }}
            >
              {topError}
            </div>
          )}

          {progress.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
              {progress.map((p) => (
                <div
                  key={p}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontSize: "0.82rem",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      border: "2px solid #E5E7EB",
                      borderTopColor: "#0066FF",
                      borderRadius: "50%",
                      animation: "alSpin 0.8s linear infinite",
                    }}
                  />
                  <span style={{ fontWeight: 700, color: "#0A1628" }}>
                    {PLATFORM_LABELS[p] || p}
                  </span>
                  <span style={{ color: "#6B7280", fontSize: "0.74rem" }}>
                    searching…
                  </span>
                </div>
              ))}
              <style>{`@keyframes alSpin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          <div style={{ display: "grid", gap: 18 }}>
            {results.map((block, i) => (
              <ResultBlockView key={`${block.platform}-${i}`} block={block} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultBlockView({ block }: { block: ResultBlock }) {
  const { label, brand, country, res } = block;
  const blockStyle: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #E5E7EB",
    borderRadius: 10,
    padding: 14,
  };

  if (!res.ok) {
    return (
      <div style={blockStyle}>
        <div
          style={{ fontWeight: 800, color: "#0A1628", marginBottom: 8 }}
        >
          {label}
        </div>
        <div
          style={{
            background: "#FEE2E2",
            color: "#B91C1C",
            padding: 10,
            borderRadius: 6,
            fontSize: "0.82rem",
          }}
        >
          {res.error || "Unknown error"}
        </div>
      </div>
    );
  }

  const ads = res.ads || [];
  if (!ads.length) {
    return (
      <div style={blockStyle}>
        <div
          style={{ fontWeight: 800, color: "#0A1628", marginBottom: 8 }}
        >
          {label}
        </div>
        <div
          style={{
            background: "#F9FAFB",
            border: "1px dashed #D1D5DB",
            borderRadius: 6,
            padding: 14,
            textAlign: "center",
            color: "#6B7280",
            fontSize: "0.8rem",
          }}
        >
          {res.note || "No active ads found."}
        </div>
      </div>
    );
  }

  return (
    <div style={blockStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 800, color: "#0A1628" }}>
          {label}
          {res.note && (
            <span
              style={{
                fontSize: "0.7rem",
                color: "#92400E",
                background: "#FEF3C7",
                border: "1px solid #FCD34D",
                borderRadius: 5,
                padding: "2px 7px",
                marginLeft: 8,
              }}
            >
              {res.note}
            </span>
          )}
        </div>
        <div style={{ fontSize: "0.74rem", color: "#6B7280" }}>
          ✅ {ads.length} ad(s) for {brand} ({country})
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
          gap: 10,
        }}
      >
        {ads.map((a, i) => (
          <AdCard
            key={String(a.id ?? i)}
            ad={a}
            brand={brand}
            platform={block.platform}
          />
        ))}
      </div>
    </div>
  );
}

interface CreativeAnalysis {
  quality_score?: number;
  estimated_performance?: string;
  hook_score?: number | string;
  hook_type?: string;
  emotional_appeal?: string;
  cta_strength?: string;
  copy_clarity?: string;
  tone?: string;
  persuasion_tactics?: string[];
  strengths?: string[];
  weaknesses?: string[];
  improvement_suggestions?: string[];
  visual_notes?: string;
}
interface AnalyzeResult {
  ok: boolean;
  error?: string;
  source?: string;
  analysis?: CreativeAnalysis;
}

function AdCard({
  ad,
  brand,
  platform,
}: {
  ad: Ad;
  brand: string;
  platform: string;
}) {
  const [saveLabel, setSaveLabel] = useState("💾 Save to Swipe File");
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);

  const advertiser = ad.page_name || ad.advertiser || brand;
  const bodyText = (ad.body || ad.ad_text || "").slice(0, 240);
  const viewUrl = safeUrl(ad.snapshot_url || ad.url);
  const platformsStr = Array.isArray(ad.platforms)
    ? ad.platforms.map((p) => String(p)).join(", ")
    : "";

  async function save() {
    const r = await apiPost("/api/ad-swipe/save", {
      source: platform,
      external_id: ad.id || null,
      advertiser,
      headline: ad.title || "",
      body: ad.body || ad.ad_text || "",
      cta: ad.description || "",
      snapshot_url: ad.snapshot_url || ad.url || "",
      platforms: ad.platforms || [],
    });
    if (r.ok) {
      setSaveLabel("✅ Saved");
      setSaved(true);
      setSaveErr(false);
    } else {
      setSaveLabel("⚠ " + (r.error || "failed"));
      setSaveErr(true);
    }
  }

  async function analyze() {
    setAnalyzing(true);
    setAnalysis(null);
    const r = await apiPost<AnalyzeResult>("/api/ad-library/analyze-creative", {
      brand_name: advertiser,
      headline: ad.title || "",
      ad_text: ad.body || ad.ad_text || "",
      image_url: ad.snapshot_url || ad.url || "",
    });
    setAnalyzing(false);
    setAnalysis(r);
  }

  return (
    <div
      style={{
        background: "#F9FAFB",
        border: "1px solid #E5E7EB",
        borderRadius: 8,
        padding: 11,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: "#0A1628",
          fontSize: "0.82rem",
          marginBottom: 4,
        }}
      >
        {advertiser}
      </div>
      {ad.title && (
        <div
          style={{
            fontWeight: 600,
            color: "#1E1B4B",
            fontSize: "0.8rem",
            marginBottom: 3,
          }}
        >
          {ad.title}
        </div>
      )}
      <div
        style={{
          color: "#374151",
          fontSize: "0.76rem",
          lineHeight: 1.4,
          whiteSpace: "pre-wrap",
        }}
      >
        {bodyText}
      </div>
      {ad.description && (
        <div
          style={{
            color: "#6B7280",
            fontSize: "0.72rem",
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          {ad.description.slice(0, 140)}
        </div>
      )}
      <div
        style={{
          fontSize: "0.68rem",
          color: "#9CA3AF",
          marginTop: 7,
          borderTop: "1px solid #E5E7EB",
          paddingTop: 6,
        }}
      >
        {ad.created
          ? "📅 " + new Date(ad.created).toLocaleDateString() + " · "
          : ""}
        {ad.first_seen ? "👁 " + ad.first_seen + " · " : ""}
        {platformsStr}
        {ad.industry ? " · " + ad.industry : ""}
        {viewUrl && (
          <>
            {" · "}
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#0066FF", fontWeight: 700 }}
            >
              View →
            </a>
          </>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          marginTop: 8,
        }}
      >
        <button
          onClick={save}
          disabled={saved}
          style={{
            background: saved ? "#D1FAE5" : "#FEF3C7",
            border: `1px solid ${saved ? "#34D399" : "#FCD34D"}`,
            color: saved ? "#065F46" : saveErr ? "#991B1B" : "#92400E",
            padding: 6,
            borderRadius: 6,
            fontSize: "0.72rem",
            fontWeight: 800,
            cursor: saved ? "default" : "pointer",
          }}
        >
          {saveLabel}
        </button>
        <button
          onClick={analyze}
          disabled={analyzing}
          style={{
            background: "#EEF2FF",
            border: "1px solid #C7D2FE",
            color: "#3730A3",
            padding: 6,
            borderRadius: 6,
            fontSize: "0.72rem",
            fontWeight: 800,
            cursor: analyzing ? "wait" : "pointer",
          }}
        >
          {analyzing
            ? "⏳ Analysing…"
            : analysis
              ? "🔍 Re-analyze"
              : "🔍 Analyze Creative"}
        </button>
      </div>
      {analyzing && (
        <div style={{ fontSize: "0.76rem", color: "#6B7280", padding: "8px 0" }}>
          Analysing with Gemini Vision…
        </div>
      )}
      {analysis && !analyzing && (
        <CreativeAnalysisView result={analysis} />
      )}
    </div>
  );
}

function CreativeAnalysisView({ result }: { result: AnalyzeResult }) {
  if (!result.ok || !result.analysis) {
    return (
      <div style={{ color: "#991B1B", fontSize: "0.75rem", padding: "8px 0" }}>
        {result.error || "Analysis failed"}
      </div>
    );
  }
  const a = result.analysis;
  const scoreColor =
    (a.quality_score ?? 0) >= 75
      ? "#16a34a"
      : (a.quality_score ?? 0) >= 50
        ? "#d97706"
        : "#dc2626";
  const perfColor =
    a.estimated_performance === "high"
      ? "#16a34a"
      : a.estimated_performance === "medium"
        ? "#d97706"
        : "#dc2626";
  const metrics: [string, string][] = [
    ["Hook", `${a.hook_score ?? ""}/10`],
    ["Hook Type", (a.hook_type || "").replace(/_/g, " ")],
    ["Emotion", a.emotional_appeal || ""],
    ["CTA", a.cta_strength || ""],
    ["Clarity", a.copy_clarity || ""],
    ["Tone", a.tone || ""],
  ];

  return (
    <div
      style={{
        border: "1px solid #E0E7FF",
        borderRadius: 8,
        background: "#F5F7FF",
        padding: 10,
        fontSize: "0.74rem",
        marginTop: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span
          style={{ fontWeight: 800, color: "#1E1B4B", fontSize: "0.78rem" }}
        >
          🔍 Creative Analysis{" "}
          <span style={{ fontWeight: 400, color: "#6B7280" }}>
            ({result.source || "ai"})
          </span>
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <span
            style={{
              background: scoreColor,
              color: "#fff",
              borderRadius: 4,
              padding: "2px 8px",
              fontWeight: 800,
              fontSize: "0.78rem",
            }}
          >
            {a.quality_score || 0}/100
          </span>
          <span
            style={{
              background: perfColor,
              color: "#fff",
              borderRadius: 4,
              padding: "2px 8px",
              fontWeight: 700,
              fontSize: "0.72rem",
              textTransform: "capitalize",
            }}
          >
            {a.estimated_performance || "medium"}
          </span>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 4,
          marginBottom: 8,
        }}
      >
        {metrics.map(([l, v]) => (
          <div
            key={l}
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 4,
              padding: "4px 6px",
            }}
          >
            <div
              style={{
                fontSize: "0.64rem",
                fontWeight: 700,
                color: "#6B7280",
                textTransform: "uppercase",
              }}
            >
              {l}
            </div>
            <div
              style={{
                fontWeight: 600,
                color: "#0A1628",
                textTransform: "capitalize",
              }}
            >
              {v}
            </div>
          </div>
        ))}
      </div>
      {Array.isArray(a.persuasion_tactics) && a.persuasion_tactics.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: "#1E1B4B" }}>Tactics: </span>
          {a.persuasion_tactics.map((t, i) => (
            <span
              key={i}
              style={{
                background: "#DBEAFE",
                color: "#1E40AF",
                borderRadius: 3,
                padding: "1px 5px",
                fontSize: "0.7rem",
                marginRight: 3,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {Array.isArray(a.strengths) && a.strengths.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span
            style={{ fontSize: "0.68rem", fontWeight: 700, color: "#15803D" }}
          >
            ✓{" "}
          </span>
          <span style={{ fontSize: "0.72rem", color: "#166534" }}>
            {a.strengths.join(" · ")}
          </span>
        </div>
      )}
      {Array.isArray(a.weaknesses) && a.weaknesses.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span
            style={{ fontSize: "0.68rem", fontWeight: 700, color: "#B91C1C" }}
          >
            ✗{" "}
          </span>
          <span style={{ fontSize: "0.72rem", color: "#991B1B" }}>
            {a.weaknesses.join(" · ")}
          </span>
        </div>
      )}
      {Array.isArray(a.improvement_suggestions) &&
        a.improvement_suggestions.length > 0 && (
          <div
            style={{
              borderTop: "1px solid #E0E7FF",
              paddingTop: 6,
              marginTop: 4,
            }}
          >
            <div
              style={{ fontWeight: 700, color: "#1E1B4B", marginBottom: 4 }}
            >
              💡 Improvements
            </div>
            {a.improvement_suggestions.map((i, idx) => (
              <div key={idx} style={{ color: "#374151", marginBottom: 3 }}>
                • {i}
              </div>
            ))}
          </div>
        )}
      {a.visual_notes && (
        <div style={{ marginTop: 6, color: "#6B7280", fontStyle: "italic" }}>
          {a.visual_notes}
        </div>
      )}
    </div>
  );
}
