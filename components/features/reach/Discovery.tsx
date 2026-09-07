"use client";

// Native React port of the legacy `discovery` panel (was
// `window.buildDiscovery` + `#view-discovery` / `#discWrap` in index.html).
// Finds real, currently-active creators in any niche via live web search and
// lets you add them straight into the Influencer CRM against the existing
// Express API (`POST /api/discovery/influencers`, `POST /api/influencers`) via
// `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface Creator {
  handle: string;
  platform: string;
  followers?: number;
  engagement?: number;
  niche?: string;
  reason?: string;
  sources?: string[];
  audienceQuality?: number | null;
}

interface DiscoveryResult {
  ok: boolean;
  error?: string;
  creators?: Creator[];
  source?: string;
}

function safeUrl(u?: string): string {
  try {
    const p = new URL(String(u));
    return /^(https?|mailto):$/i.test(p.protocol) ? p.toString() : "#";
  } catch {
    return "#";
  }
}

const SOURCE_META: Record<string, { label: string; bg: string; title: string }> = {
  modash: {
    label: "Source: Modash",
    bg: "#047857",
    title: "Authoritative data — real follower counts & engagement rates from Modash",
  },
  perplexity: {
    label: "Source: Perplexity (estimated)",
    bg: "#0f766e",
    title: "AI-estimated via Perplexity live web search — add a Modash key for authoritative figures",
  },
  template: {
    label: "No data source",
    bg: "#9CA3AF",
    title: "No API key configured — add Modash (Platform APIs) for real data",
  },
};

export default function Discovery() {
  const [niche, setNiche] = useState("");
  const [platform, setPlatform] = useState("any");
  const [country, setCountry] = useState("US");
  const [count, setCount] = useState(8);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [searchedNiche, setSearchedNiche] = useState("");

  async function find() {
    const nicheVal = niche.trim();
    if (!nicheVal) {
      showToast("❌ Niche required");
      return;
    }
    const countryVal = country.trim() || "US";
    const countVal = Number(count) || 8;
    setErrorMsg(null);
    setResult(null);
    setLoading(true);
    const r = await apiPost<DiscoveryResult>("/api/discovery/influencers", {
      niche: nicheVal,
      platform,
      country: countryVal,
      count: countVal,
    });
    setLoading(false);
    if (!r.ok) {
      setErrorMsg(r.error || "failed");
      return;
    }
    setSearchedNiche(nicheVal);
    setResult(r);
  }

  async function add(c: Creator) {
    const payload = {
      handle: c.handle,
      platform: c.platform,
      niche: c.niche,
      follower_count: c.followers,
      engagement_rate: c.engagement,
      status: "prospect",
      notes: `Discovered via Influencer Discovery. ${c.reason || ""}\n\nSources:\n${(c.sources || []).join("\n")}`,
    };
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/influencers", payload);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    showToast(`✅ Added @${c.handle} to CRM`);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1.5px solid #E5E7EB",
    borderRadius: 6,
    fontSize: "0.82rem",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.66rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 3,
  };

  const srcKey = result?.source || "template";
  const srcMeta = SOURCE_META[srcKey] || { label: srcKey, bg: "#9CA3AF", title: "" };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Influencer Discovery
              </div>
              <h2 className="view-title">🔭 Influencer Discovery</h2>
              <p className="view-sub">
                Find real, currently-active creators in any niche. Powered by Modash when configured for authoritative
                data — falls back to Perplexity web search. One click adds them straight into your Influencer CRM.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 18, marginBottom: 18 }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "1rem", marginBottom: 12 }}>
            Find creators
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 100px 90px auto", gap: 10, alignItems: "end" }}>
            <label>
              <div style={labelStyle}>Niche *</div>
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="e.g. sustainable fashion, fintech reviews, home cooking"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Platform</div>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={inputStyle}>
                <option value="any">Any</option>
                <option>instagram</option>
                <option>tiktok</option>
                <option>youtube</option>
                <option>x</option>
                <option>linkedin</option>
              </select>
            </label>
            <label>
              <div style={labelStyle}>Country</div>
              <input value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle} />
            </label>
            <label>
              <div style={labelStyle}>Count</div>
              <input
                type="number"
                min={3}
                max={15}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={inputStyle}
              />
            </label>
            <button
              onClick={find}
              style={{
                padding: "9px 18px",
                background: "#0891B2",
                border: "2px solid #0891B2",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.5)",
              }}
            >
              🔭 Search
            </button>
          </div>
        </div>

        <div>
          {loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>⏳ Searching…</div>
          )}
          {errorMsg && (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{errorMsg}</div>
          )}
          {result && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800 }}>
                  Found {(result.creators || []).length} in <span style={{ color: "#0891B2" }}>{searchedNiche}</span>
                </div>
                <span
                  title={srcMeta.title}
                  style={{
                    background: srcMeta.bg,
                    color: "#fff",
                    padding: "3px 9px",
                    borderRadius: 5,
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    cursor: "default",
                  }}
                >
                  {srcMeta.label}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 14 }}>
                {(result.creators || []).map((c, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 10,
                      padding: "14px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>@{c.handle}</div>
                        <div style={{ fontSize: "0.7rem", color: "#0f766e", textTransform: "uppercase", fontWeight: 700 }}>
                          {c.platform}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#0A1628" }}>
                          {(c.followers || 0).toLocaleString()}
                        </div>
                        <div style={{ fontSize: "0.66rem", color: "#6B7280" }}>followers</div>
                      </div>
                    </div>
                    {c.reason ? (
                      <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.45 }}>{c.reason}</div>
                    ) : null}
                    <div style={{ display: "flex", gap: 10, fontSize: "0.7rem", color: "#6B7280", flexWrap: "wrap" }}>
                      <span>📊 {((c.engagement || 0) * 100).toFixed(1)}% engagement</span>
                      {c.niche && <span>🏷 {c.niche}</span>}
                      {c.audienceQuality != null && (
                        <span title="Audience quality score from Modash (0–1; higher = more authentic)">
                          🛡 {(c.audienceQuality * 100).toFixed(0)}% authentic audience
                        </span>
                      )}
                    </div>
                    {(c.sources || []).length ? (
                      <div style={{ fontSize: "0.66rem" }}>
                        {(c.sources || []).map((u, ui) => (
                          <a
                            key={ui}
                            href={safeUrl(u)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#0f766e", display: "block", marginTop: 1 }}
                          >
                            {u.replace(/^https?:\/\//, "").slice(0, 60)}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <button
                      onClick={() => add(c)}
                      style={{
                        padding: "8px 14px",
                        background: "#15803D",
                        border: "2px solid #15803D",
                        borderRadius: 6,
                        fontSize: "0.74rem",
                        fontWeight: 800,
                        color: "#fff",
                        WebkitTextFillColor: "#fff",
                        cursor: "pointer",
                        textShadow: "0 1px 2px rgba(0,0,0,.4)",
                      }}
                    >
                      + Add to Influencer CRM
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
