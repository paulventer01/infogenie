"use client";

// Native React port of the legacy `review-aggregator` panel (was
// `window.buildReviewAggregator` + `#view-review-aggregator` / `#raWrap` in
// index.html / ig_intel_pack_a.js). Scans third-party review platforms
// (Trustpilot, G2, Google, …) for a single brand, compares 2-4 brands, and
// surfaces reviews that disappeared between scans. Talks to the existing Express
// API via `lib/api`:
//   POST /api/review-aggregator/scan      { brand, platform }
//   POST /api/review-aggregator/compare   { brands, platform }
//   GET  /api/review-monitor/deleted?brand&platform
//   GET  /api/review-monitor/stats?brand
// Brand/competitor pickers are pre-filled from the legacy `window.analysisData`.

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, type ApiResult } from "@/lib/api";

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisData {
  brandName?: string;
  competitors?: AnalysisCompetitor[];
}

interface Review {
  author?: string;
  rating?: number;
  sentiment?: string;
  title?: string;
  body?: string;
  date?: string;
}
interface ScanResult extends ApiResult {
  found?: boolean;
  avg_rating?: number;
  total_reviews?: number;
  counts?: { pos?: number; neu?: number; neg?: number };
  reviews?: Review[];
}
interface CompareBrand {
  brand?: string;
  found?: boolean;
  avg_rating?: number;
  total_reviews?: number;
  recent_count?: number;
}
interface CompareResult extends ApiResult {
  results?: CompareBrand[];
}
interface DeletedReview {
  platform?: string;
  author?: string;
  rating?: number;
  title?: string;
  body?: string;
  first_seen_at?: string;
  deleted_at?: string;
  brand?: string;
}
interface DeletedResult extends ApiResult {
  deleted?: DeletedReview[];
}
interface StatRow {
  platform?: string;
  deleted_count?: number;
  active_count?: number;
}
interface StatsResult extends ApiResult {
  totalDeletedThisMonth?: number;
  stats?: StatRow[];
}

type Tab = "single" | "compare" | "deleted";

const SENT_COLOR: Record<string, [string, string]> = {
  positive: ["#ECFDF5", "#065F46"],
  neutral: ["#F3F4F6", "#374151"],
  negative: ["#FEF2F2", "#991B1B"],
};

function _n(x: unknown, d?: number): number {
  const v = Number(x);
  return Number.isFinite(v) ? Math.round(v) : d || 0;
}
function _f(x: unknown, d?: string, p?: number): string {
  const v = Number(x);
  return Number.isFinite(v) ? v.toFixed(p == null ? 1 : p) : d || "—";
}
function stars(n: unknown): string {
  const k = Math.max(0, Math.min(5, _n(n)));
  return "★".repeat(k) + "☆".repeat(5 - k);
}
function fmtDate(s?: string): string {
  try {
    return s
      ? new Date(s).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "";
  } catch {
    return String(s || "");
  }
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #D1D5DB",
  borderRadius: 5,
  fontSize: "0.84rem",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 3,
};

export default function ReviewAggregator() {
  const ownBrand = useMemo(() => getAnalysisData().brandName || "", []);
  const compNames = useMemo(() => {
    const ad = getAnalysisData();
    return Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter((n): n is string => !!n)
          .slice(0, 15)
      : [];
  }, []);

  const [tab, setTab] = useState<Tab>("single");

  // Single brand
  const [brand, setBrand] = useState(ownBrand);
  const [pick, setPick] = useState("");
  const [platform, setPlatform] = useState("trustpilot");
  const [scanStatus, setScanStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Compare
  const [compareBrands, setCompareBrands] = useState("");
  const [comparePlatform, setComparePlatform] = useState("trustpilot");
  const [compareStatus, setCompareStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [compareError, setCompareError] = useState("");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(
    null,
  );

  // Deleted
  const [deletedStatus, setDeletedStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [deletedError, setDeletedError] = useState("");
  const [deleted, setDeleted] = useState<DeletedReview[]>([]);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [deletedBadge, setDeletedBadge] = useState(0);

  function onPick(v: string) {
    setPick(v);
    if (v) setBrand(v);
  }

  async function runScan() {
    if (!brand.trim()) {
      setScanError("⚠ Brand required");
      setScanStatus("error");
      return;
    }
    setScanStatus("loading");
    setScanError("");
    setScanResult(null);
    setNotFound(false);
    const r = await apiPost<ScanResult>("/api/review-aggregator/scan", {
      brand: brand.trim(),
      platform,
    });
    if (!r.ok) {
      setScanError(r.error || "Scan failed");
      setScanStatus("error");
      return;
    }
    setScanStatus("idle");
    if (!r.found) {
      setNotFound(true);
      return;
    }
    setScanResult(r);
  }

  async function runCompare() {
    const brands = compareBrands
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (brands.length < 2) {
      setCompareError("⚠ Need at least 2 brands");
      setCompareStatus("error");
      return;
    }
    setCompareStatus("loading");
    setCompareError("");
    setCompareResult(null);
    const r = await apiPost<CompareResult>("/api/review-aggregator/compare", {
      brands,
      platform: comparePlatform,
    });
    if (!r.ok) {
      setCompareError(r.error || "Compare failed");
      setCompareStatus("error");
      return;
    }
    setCompareStatus("idle");
    setCompareResult(r);
  }

  async function loadDeleted() {
    setDeletedStatus("loading");
    setDeletedError("");
    const qs = new URLSearchParams();
    if (brand) qs.set("brand", brand);
    if (platform) qs.set("platform", platform);
    const [dRes, sRes] = await Promise.all([
      apiGet<DeletedResult>("/api/review-monitor/deleted?" + qs.toString()),
      apiGet<StatsResult>(
        "/api/review-monitor/stats?" +
          (brand ? new URLSearchParams({ brand }).toString() : ""),
      ),
    ]);
    const total = sRes.ok ? sRes.totalDeletedThisMonth || 0 : 0;
    setDeletedBadge(total);
    if (!dRes.ok) {
      setDeletedError(dRes.error || "Error loading deleted reviews");
      setDeletedStatus("error");
      return;
    }
    setStats(sRes.ok ? sRes : null);
    setDeleted(dRes.deleted || []);
    setDeletedStatus("idle");
  }

  useEffect(() => {
    if (tab === "deleted") loadDeleted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const tabBtn = (t: Tab, label: React.ReactNode): React.CSSProperties => ({
    padding: "8px 16px",
    borderRadius: 6,
    border: `1px solid ${tab === t ? "#1E1B4B" : "#E5E7EB"}`,
    background: tab === t ? "#1E1B4B" : "#fff",
    color: tab === t ? "#fff" : "#374151",
    fontSize: "0.78rem",
    fontWeight: 700,
    cursor: "pointer",
  });

  const altPlatform =
    platform === "google"
      ? "trustpilot"
      : platform === "trustpilot"
        ? "google"
        : "trustpilot";

  const byPlatform: Record<string, DeletedReview[]> = {};
  deleted.forEach((rv) => {
    const k = rv.platform || "other";
    (byPlatform[k] = byPlatform[k] || []).push(rv);
  });

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
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button style={tabBtn("single", "Single Brand")} onClick={() => setTab("single")}>
            Single Brand
          </button>
          <button style={tabBtn("compare", "Compare")} onClick={() => setTab("compare")}>
            Compare 2-4 Brands
          </button>
          <button style={tabBtn("deleted", "Deleted")} onClick={() => setTab("deleted")}>
            🗑️ Deleted{" "}
            {deletedBadge > 0 && (
              <span
                style={{
                  background: "#EF4444",
                  color: "#fff",
                  borderRadius: 9999,
                  fontSize: "0.65rem",
                  padding: "1px 6px",
                  marginLeft: 4,
                  verticalAlign: "middle",
                }}
              >
                {deletedBadge}
              </span>
            )}
          </button>
        </div>

        {tab === "single" && (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div>
                <label style={labelStyle}>
                  BRAND{" "}
                  <span style={{ color: "#15803D", fontWeight: 600 }}>
                    (auto-filled from your analysis)
                  </span>
                </label>
                {ownBrand || compNames.length ? (
                  <select
                    value={pick}
                    onChange={(e) => onPick(e.target.value)}
                    style={{
                      ...inputStyle,
                      padding: "7px 10px",
                      border: "1.5px solid #D1D5DB",
                      fontSize: "0.78rem",
                      background: "#F9FAFB",
                      marginBottom: 5,
                    }}
                  >
                    <option value="">
                      — Pick from your analysis (or type manually below) —
                    </option>
                    {ownBrand && (
                      <option value={ownBrand}>{ownBrand} (your brand)</option>
                    )}
                    {compNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#9CA3AF",
                      marginBottom: 5,
                    }}
                  >
                    💡 Run an analysis to unlock brand/competitor pickers.
                  </div>
                )}
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g. Stripe — or pick from list above"
                  style={{ ...inputStyle, background: ownBrand ? "#F0FDF4" : "#fff" }}
                />
              </div>
              <div>
                <label style={labelStyle}>PLATFORM</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  style={inputStyle}
                >
                  <option value="trustpilot">Trustpilot</option>
                  <option value="g2">G2</option>
                  <option value="google">Google</option>
                  <option value="capterra">Capterra</option>
                  <option value="tripadvisor">TripAdvisor</option>
                </select>
              </div>
            </div>
            <button
              onClick={runScan}
              disabled={scanStatus === "loading"}
              style={{
                background: "linear-gradient(135deg,#F59E0B,#FBBF24)",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                borderRadius: 6,
                fontSize: "0.84rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {scanStatus === "loading" ? `⏳ Scanning ${platform}…` : "⭐ Scan Reviews"}
            </button>
          </div>
        )}

        {tab === "compare" && (
          <div>
            <label style={labelStyle}>BRANDS (comma-sep, 2-4)</label>
            <input
              value={compareBrands}
              onChange={(e) => setCompareBrands(e.target.value)}
              placeholder="Stripe, Square, Adyen"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <label style={labelStyle}>PLATFORM</label>
            <select
              value={comparePlatform}
              onChange={(e) => setComparePlatform(e.target.value)}
              style={{ ...inputStyle, marginBottom: 8 }}
            >
              <option value="trustpilot">Trustpilot</option>
              <option value="g2">G2</option>
              <option value="google">Google</option>
              <option value="capterra">Capterra</option>
            </select>
            <button
              onClick={runCompare}
              disabled={compareStatus === "loading"}
              style={{
                background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                borderRadius: 6,
                fontSize: "0.84rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {compareStatus === "loading" ? "⏳ Comparing…" : "⚖️ Compare"}
            </button>
          </div>
        )}
      </div>

      {/* Output */}
      <div>
        {tab === "single" && (
          <SingleOutput
            status={scanStatus}
            error={scanError}
            notFound={notFound}
            brand={brand}
            platform={platform}
            altPlatform={altPlatform}
            result={scanResult}
          />
        )}
        {tab === "compare" && (
          <CompareOutput
            status={compareStatus}
            error={compareError}
            result={compareResult}
          />
        )}
        {tab === "deleted" && (
          <DeletedOutput
            status={deletedStatus}
            error={deletedError}
            byPlatform={byPlatform}
            stats={stats}
          />
        )}
      </div>
    </div>
  );
}

function SingleOutput({
  status,
  error,
  notFound,
  brand,
  platform,
  altPlatform,
  result,
}: {
  status: "idle" | "loading" | "error";
  error: string;
  notFound: boolean;
  brand: string;
  platform: string;
  altPlatform: string;
  result: ScanResult | null;
}) {
  if (status === "loading")
    return <div style={{ color: "#9CA3AF" }}>⏳ Scanning {platform}…</div>;
  if (status === "error")
    return (
      <div
        style={{
          background: "#FEE2E2",
          color: "#B91C1C",
          padding: 14,
          borderRadius: 10,
        }}
      >
        {error}
      </div>
    );
  if (notFound) {
    const shortNameTip = brand.length <= 4;
    return (
      <div
        style={{
          background: "#F9FAFB",
          border: "1px dashed #D1D5DB",
          borderRadius: 10,
          padding: 24,
          textAlign: "center",
          color: "#6B7280",
        }}
      >
        No reviews found for <strong>{brand}</strong> on {platform}.
        {shortNameTip && (
          <div style={{ marginTop: 10, fontSize: "0.78rem", color: "#6B7280" }}>
            💡 Tip: <strong>&quot;{brand}&quot;</strong> may be too short to
            match. Try the full company name (e.g. &quot;{brand} Group&quot; or
            &quot;{brand} Markets&quot;).
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: "0.78rem" }}>
          Try switching the platform to <strong>{altPlatform}</strong>, or enter
          a more specific company name above.
        </div>
      </div>
    );
  }
  if (!result) return null;
  const reviews = result.reviews || [];
  return (
    <div>
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: "16px 20px",
          marginBottom: 14,
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "#F59E0B" }}>
            {_f(result.avg_rating)}
          </div>
          <div
            style={{ color: "#FBBF24", fontSize: "1.1rem", letterSpacing: 2 }}
          >
            {stars(result.avg_rating)}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
            {_n(result.total_reviews)} total reviews
          </div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {(
            [
              ["pos", "POSITIVE", "#10B981"],
              ["neu", "NEUTRAL", "#6B7280"],
              ["neg", "NEGATIVE", "#EF4444"],
            ] as const
          ).map(([k, label, color]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.4rem", fontWeight: 800, color }}>
                {_n(result.counts && result.counts[k])}
              </div>
              <div
                style={{
                  fontSize: "0.66rem",
                  color: "#6B7280",
                  fontWeight: 700,
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {reviews.map((rv, i) => {
          const sc =
            SENT_COLOR[(rv.sentiment || "neutral").toLowerCase()] ||
            SENT_COLOR.neutral;
          return (
            <div
              key={i}
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 5,
                }}
              >
                <div>
                  <strong style={{ color: "#0A1628", fontSize: "0.86rem" }}>
                    {rv.author || "Anonymous"}
                  </strong>{" "}
                  <span style={{ color: "#FBBF24", letterSpacing: 1 }}>
                    {stars(rv.rating)}
                  </span>
                </div>
                <span
                  style={{
                    background: sc[0],
                    color: sc[1],
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: "0.66rem",
                    fontWeight: 700,
                  }}
                >
                  {rv.sentiment || "neutral"}
                </span>
              </div>
              {rv.title && (
                <div
                  style={{
                    fontWeight: 700,
                    color: "#0A1628",
                    fontSize: "0.86rem",
                    marginBottom: 4,
                  }}
                >
                  {rv.title}
                </div>
              )}
              <div
                style={{
                  color: "#374151",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                }}
              >
                {rv.body || ""}
              </div>
              <div
                style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 6 }}
              >
                {rv.date || ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompareOutput({
  status,
  error,
  result,
}: {
  status: "idle" | "loading" | "error";
  error: string;
  result: CompareResult | null;
}) {
  if (status === "loading")
    return <div style={{ color: "#9CA3AF" }}>⏳ Comparing brands…</div>;
  if (status === "error")
    return (
      <div
        style={{
          background: "#FEE2E2",
          color: "#B91C1C",
          padding: 14,
          borderRadius: 10,
        }}
      >
        {error}
      </div>
    );
  if (!result) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
        gap: 12,
      }}
    >
      {(result.results || []).map((b, i) => (
        <div
          key={i}
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            padding: 16,
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>
            {b.brand}
          </div>
          {b.found ? (
            <>
              <div
                style={{
                  fontSize: "2rem",
                  fontWeight: 800,
                  color: "#F59E0B",
                  margin: "8px 0",
                }}
              >
                {_f(b.avg_rating)}
              </div>
              <div style={{ fontSize: "0.74rem", color: "#6B7280" }}>
                {_n(b.total_reviews)} reviews · {_n(b.recent_count)} recent
              </div>
            </>
          ) : (
            <div
              style={{
                color: "#9CA3AF",
                marginTop: 14,
                fontSize: "0.78rem",
              }}
            >
              Not found
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DeletedOutput({
  status,
  error,
  byPlatform,
  stats,
}: {
  status: "idle" | "loading" | "error";
  error: string;
  byPlatform: Record<string, DeletedReview[]>;
  stats: StatsResult | null;
}) {
  if (status === "loading")
    return (
      <div
        style={{
          color: "#9CA3AF",
          padding: 20,
          textAlign: "center",
          fontSize: "0.82rem",
        }}
      >
        ⏳ Loading deleted reviews…
      </div>
    );
  if (status === "error")
    return <div style={{ color: "#991B1B", padding: 14 }}>{error}</div>;

  const platforms = Object.entries(byPlatform);
  if (platforms.length === 0)
    return (
      <div
        style={{
          background: "#F9FAFB",
          border: "1px dashed #D1D5DB",
          borderRadius: 10,
          padding: 28,
          textAlign: "center",
          color: "#6B7280",
          fontSize: "0.84rem",
        }}
      >
        <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>✅</div>
        No deleted reviews detected yet.
        <br />
        <span style={{ fontSize: "0.75rem", color: "#9CA3AF" }}>
          Deleted reviews appear here when a review present in a previous scan is
          missing from a new one.
        </span>
      </div>
    );

  return (
    <div style={{ padding: "4px 0" }}>
      {stats && stats.stats && stats.stats.length > 0 && (
        <div
          style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}
        >
          {stats.stats.map((s, i) => (
            <div
              key={i}
              style={{
                background: "#FFF7ED",
                border: "1px solid #FDBA74",
                borderRadius: 8,
                padding: "8px 14px",
                textAlign: "center",
                minWidth: 80,
              }}
            >
              <div
                style={{ fontSize: "1.1rem", fontWeight: 800, color: "#C2410C" }}
              >
                {s.deleted_count}
              </div>
              <div
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  color: "#9A3412",
                  textTransform: "uppercase",
                }}
              >
                {s.platform}
              </div>
              <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>
                {s.active_count} tracked
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: "0.78rem", color: "#6B7280", marginBottom: 12 }}>
        Showing up to 200 most recently removed reviews. Each scan compares
        against the previous snapshot and flags reviews that have disappeared.
      </div>
      {platforms.map(([plat, revs]) => (
        <div key={plat} style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: "0.7rem",
              fontWeight: 800,
              color: "#6B7280",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {plat.toUpperCase()}
            <span
              style={{
                background: "#FEE2E2",
                color: "#991B1B",
                borderRadius: 4,
                padding: "1px 7px",
                fontSize: "0.65rem",
              }}
            >
              {revs.length} removed
            </span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {revs.map((rv, i) => (
              <div
                key={i}
                style={{
                  background: "#fff",
                  border: "1px solid #FCA5A5",
                  borderRadius: 8,
                  padding: "12px 14px",
                  borderLeft: "4px solid #EF4444",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <strong style={{ color: "#0A1628", fontSize: "0.86rem" }}>
                      {rv.author || "Anonymous"}
                    </strong>
                    <span
                      style={{
                        color: "#FBBF24",
                        letterSpacing: 1,
                        marginLeft: 6,
                      }}
                    >
                      {stars(rv.rating)}
                    </span>
                    {rv.title && (
                      <div
                        style={{
                          fontWeight: 700,
                          color: "#374151",
                          fontSize: "0.82rem",
                          marginTop: 2,
                        }}
                      >
                        {rv.title}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span
                      style={{
                        background: "#FEE2E2",
                        color: "#991B1B",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: "0.66rem",
                        fontWeight: 700,
                      }}
                    >
                      DELETED
                    </span>
                  </div>
                </div>
                {rv.body && (
                  <div
                    style={{
                      color: "#4B5563",
                      fontSize: "0.8rem",
                      lineHeight: 1.5,
                      marginTop: 6,
                    }}
                  >
                    {String(rv.body).slice(0, 300)}
                    {rv.body.length > 300 ? "…" : ""}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginTop: 8,
                    fontSize: "0.7rem",
                    color: "#9CA3AF",
                    flexWrap: "wrap",
                  }}
                >
                  {rv.first_seen_at && (
                    <span>
                      First seen: <strong>{fmtDate(rv.first_seen_at)}</strong>
                    </span>
                  )}
                  {rv.deleted_at && (
                    <span>
                      Disappeared:{" "}
                      <strong style={{ color: "#DC2626" }}>
                        {fmtDate(rv.deleted_at)}
                      </strong>
                    </span>
                  )}
                  <span style={{ marginLeft: "auto" }}>
                    <a
                      href={`https://${plat}.com/review/${rv.brand || ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#6366F1",
                        textDecoration: "none",
                        fontWeight: 700,
                      }}
                    >
                      ⚠️ Report to platform ↗
                    </a>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
