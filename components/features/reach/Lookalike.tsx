"use client";

// Native React port of the legacy `lookalike` panel (was `window.buildLookalike`
// + generateLookalike / _lookalikeResultHtml / exportLookalikeCSV in
// public/js/ig_attribution_scorer.js + `#view-lookalike`). Turns a competitor
// domain / persona description / customer profile into platform-ready Meta LLA,
// Google Customer Match and TikTok LLA specs via the existing Express API
// (`/api/lookalike/generate` + `/api/lookalike/export`) through lib/api.

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

type SeedType = "competitor" | "description" | "customer-profile";
type PlatformId = "meta" | "google" | "tiktok";

interface DetailedTargeting {
  interests?: string[];
  behaviors?: string[];
}
interface MetaSpec {
  audienceName?: string;
  lookalikeSize?: string;
  estReachM?: number;
  sourceAudienceSuggestion?: string;
  detailedTargeting?: DetailedTargeting;
  exclusions?: string[];
  uploadInstructions?: string;
}
interface GoogleSpec {
  audienceName?: string;
  matchType?: string;
  uploadFormat?: string;
  similarAudienceTopics?: string[];
  inMarketSegments?: string[];
  uploadInstructions?: string;
}
interface TiktokSpec {
  audienceName?: string;
  lookalikeMode?: string;
  seedAudienceSuggestion?: string;
  interestCategories?: string[];
  behaviors?: string[];
  creators?: string[];
  uploadInstructions?: string;
}
interface SeedPersona {
  persona?: string;
  demographics?: string;
  channels?: string[];
  buyingTrigger?: string;
}
interface LookalikeSpec {
  summary?: string;
  demographics?: { ageRange?: string; incomeBand?: string };
  geo?: { primaryCountry?: string };
  estimatedSize?: { low: number; high: number };
  platforms?: { meta?: MetaSpec; google?: GoogleSpec; tiktok?: TiktokSpec };
  interests?: string[];
  behaviors?: string[];
  jobTitles?: string[];
  industries?: string[];
  intentKeywords?: string[];
  seedExamples?: SeedPersona[];
  warnings?: string[];
}
interface GenResponse {
  ok: boolean;
  error?: string;
  spec?: LookalikeSpec;
}

const SEED_OPTIONS: { v: SeedType; t: string; d: string }[] = [
  { v: "competitor", t: "🏆 Competitor domain", d: "Pull SERP signals from a competitor URL" },
  { v: "description", t: "✍️ Audience description", d: "Free-text persona / customer description" },
  { v: "customer-profile", t: "🧬 Customer profile", d: "Paste an existing customer/buyer profile" },
];

const COUNTRIES: [string, string][] = [
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"],
  ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["BR", "Brazil"], ["MX", "Mexico"], ["JP", "Japan"], ["IN", "India"],
];

const SIZES: [string, string][] = [
  ["1%", "1% (most similar, smallest)"], ["2%", "2%"], ["3%", "3%"], ["5%", "5%"], ["10%", "10% (broadest)"],
];

const PLATFORM_OPTS: { v: PlatformId; l: string }[] = [
  { v: "meta", l: "📘 Meta LLA" },
  { v: "google", l: "🔵 Google CM" },
  { v: "tiktok", l: "⬛ TikTok LLA" },
];

const SEED_LABELS: Record<SeedType, { label: string; placeholder: string }> = {
  competitor: { label: "Competitor domain", placeholder: "e.g. competitor.com" },
  description: { label: "Audience description", placeholder: "e.g. Marketing leaders at SaaS companies who buy attribution tools" },
  "customer-profile": { label: "Customer profile", placeholder: "e.g. CMOs / VPs of Marketing at $10M-100M ARR B2B SaaS, urban US/CA/UK" },
};

function Tag({ txt, color }: { txt: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: color + "15",
        color,
        padding: "4px 10px",
        borderRadius: 99,
        fontSize: "0.74rem",
        fontWeight: 600,
        margin: "3px 4px 3px 0",
      }}
    >
      {txt}
    </span>
  );
}

function TagList({ arr, color }: { arr?: string[]; color: string }) {
  if (!arr || !arr.length) return null;
  return <>{arr.slice(0, 24).map((t, i) => <Tag key={i} txt={t} color={color} />)}</>;
}

function fmtRange(rng?: { low: number; high: number }): string {
  return rng ? `${(rng.low / 1e6).toFixed(1)}M – ${(rng.high / 1e6).toFixed(1)}M` : "—";
}

export default function Lookalike() {
  const toast = useToast();
  const [seedType, setSeedType] = useState<SeedType>("competitor");
  const [seedValue, setSeedValue] = useState("");
  const [country, setCountry] = useState("US");
  const [size, setSize] = useState("1%");
  const [context, setContext] = useState("");
  const [platforms, setPlatforms] = useState<Record<PlatformId, boolean>>({ meta: true, google: true, tiktok: true });
  const [exclude, setExclude] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [spec, setSpec] = useState<LookalikeSpec | null>(null);

  async function generate() {
    const sv = seedValue.trim();
    if (!sv) {
      toast("⚠️ Please enter a seed value first.");
      return;
    }
    const plats = (Object.keys(platforms) as PlatformId[]).filter((p) => platforms[p]);
    if (!plats.length) {
      toast("⚠️ Select at least one target platform.");
      return;
    }
    setStatus("loading");
    setError("");
    setSpec(null);
    try {
      const r = await apiPost<GenResponse>("/api/lookalike/generate", {
        seedType,
        seedValue: sv,
        platforms: plats,
        country,
        lookalikeSize: size,
        excludeExistingCustomers: exclude,
        additionalContext: context.trim(),
      });
      if (!r.ok) throw new Error(r.error || "Failed to generate");
      setSpec(r.spec || {});
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "error");
    }
  }

  async function exportCsv(platform: PlatformId) {
    if (!spec) {
      toast("⚠️ Generate an audience first.");
      return;
    }
    try {
      const r = await apiPost<{ ok: boolean; error?: string; csv?: string; filename?: string }>(
        "/api/lookalike/export",
        { spec, platform },
      );
      if (!r.ok) throw new Error(r.error || "Export failed");
      const blob = new Blob([r.csv || ""], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename || `lookalike-${platform}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast("⚠️ Could not export: " + (e instanceof Error ? e.message : "error"));
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 11,
    border: "1.5px solid #E5E7EB",
    borderRadius: 10,
    fontSize: "0.9rem",
    boxSizing: "border-box",
  };

  const meta = spec?.platforms?.meta;
  const google = spec?.platforms?.google;
  const tiktok = spec?.platforms?.tiktok;

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E40AF 50%,#0EA5E9 100%)" }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#BAE6FD" }}>
                <span className="bc-group" style={{ color: "rgba(186,230,253,.75)" }}>Reach</span>{" "}
                <span className="bc-sep" style={{ color: "rgba(255,255,255,.3)" }}>›</span> Lookalike Audiences
              </div>
              <h2 className="view-title">Lookalike Audience Builder</h2>
              <p className="view-sub">
                Turn competitor signals or seed audience descriptions into
                platform-ready Meta Lookalike, Google Customer Match, and TikTok LLA
                audience specs you can upload directly.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 60 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18 }}>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 24, boxShadow: "0 2px 10px rgba(0,0,0,.04)" }}>
            <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1.05rem", marginBottom: 4 }}>1 · Define your seed</div>
            <div style={{ fontSize: "0.82rem", color: "#64748B", marginBottom: 18 }}>
              Pick the source InfoGenie should use to model the lookalike audience.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginBottom: 18 }}>
              {SEED_OPTIONS.map((o) => {
                const sel = seedType === o.v;
                return (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setSeedType(o.v)}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      background: sel ? "#EEF2FF" : "#F8FAFC",
                      border: `1.5px solid ${sel ? "#6366F1" : "#E5E7EB"}`,
                      borderRadius: 12,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.88rem" }}>{o.t}</div>
                    <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 3 }}>{o.d}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <label style={{ display: "block" }}>
                <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#0A1628", marginBottom: 5 }}>Country</div>
                <select value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle}>
                  {COUNTRIES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#0A1628", marginBottom: 5 }}>Meta lookalike size</div>
                <select value={size} onChange={(e) => setSize(e.target.value)} style={inputStyle}>
                  {SIZES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ display: "block", marginBottom: 14 }}>
              <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#0A1628", marginBottom: 5 }}>{SEED_LABELS[seedType].label}</div>
              <input
                type="text"
                value={seedValue}
                onChange={(e) => setSeedValue(e.target.value)}
                placeholder={SEED_LABELS[seedType].placeholder}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block", marginBottom: 18 }}>
              <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#0A1628", marginBottom: 5 }}>Additional context (optional)</div>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g. We sell premium B2B SaaS, ACV $12k, primarily targeting Heads of Marketing at Series B+ companies."
                style={{ ...inputStyle, minHeight: 64, fontFamily: "inherit", resize: "vertical" }}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#0A1628" }}>Target platforms:</div>
              {PLATFORM_OPTS.map((p) => (
                <label key={p.v} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.84rem", color: "#0A1628", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={platforms[p.v]}
                    onChange={(e) => setPlatforms((prev) => ({ ...prev, [p.v]: e.target.checked }))}
                  />
                  <span>{p.l}</span>
                </label>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.84rem", color: "#0A1628", cursor: "pointer", marginLeft: "auto" }}>
                <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} />
                <span>Exclude existing customers</span>
              </label>
            </div>
            <button
              onClick={generate}
              disabled={status === "loading"}
              style={{
                width: "100%",
                padding: 14,
                background: "linear-gradient(135deg,#1E40AF 0%,#0EA5E9 100%)",
                color: "white",
                border: "none",
                borderRadius: 12,
                fontWeight: 800,
                fontSize: "0.95rem",
                cursor: "pointer",
                opacity: status === "loading" ? 0.6 : 1,
                boxShadow: "0 4px 14px rgba(14,165,233,.3)",
              }}
            >
              {status === "loading" ? "⏳ Generating audiences (this can take 20-40s)…" : "⚡ Generate Lookalike Audiences"}
            </button>
          </div>

          <div>
            {status === "loading" && (
              <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 14, padding: 32, textAlign: "center", color: "#64748B", fontWeight: 600 }}>
                ⏳ Pulling competitor signals and composing audience specs…
              </div>
            )}
            {status === "error" && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14, padding: 24, color: "#991B1B" }}>
                <b>⚠️ Generation failed</b>
                <div style={{ fontSize: "0.85rem", marginTop: 6 }}>{error}</div>
              </div>
            )}
            {spec && status === "idle" && (
              <>
                <div style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E40AF 100%)", borderRadius: 16, padding: 24, color: "white", marginBottom: 18 }}>
                  <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: ".6px", opacity: 0.78, fontWeight: 700, marginBottom: 6 }}>
                    Lookalike audience persona
                  </div>
                  <div style={{ fontSize: "1.1rem", lineHeight: 1.5, fontWeight: 600 }}>{spec.summary || ""}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14, marginTop: 18 }}>
                    {[
                      ["Age", spec.demographics?.ageRange],
                      ["Income", spec.demographics?.incomeBand],
                      ["Geo", spec.geo?.primaryCountry],
                      ["Est. size", fmtRange(spec.estimatedSize)],
                    ].map(([k, v]) => (
                      <div key={k as string}>
                        <div style={{ fontSize: "0.65rem", opacity: 0.72, fontWeight: 700, textTransform: "uppercase" }}>{k}</div>
                        <div style={{ fontWeight: 800, marginTop: 3 }}>{(v as string) || "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {(meta || google || tiktok) && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, marginBottom: 18 }}>
                    {meta && (
                      <div style={{ background: "white", border: "1.5px solid #1877F233", borderRadius: 14, padding: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>📘 Meta Lookalike Audience</div>
                          <button onClick={() => exportCsv("meta")} style={{ padding: "7px 12px", background: "#1877F2", color: "white", border: "none", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>⬇ Download CSV template</button>
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#0A1628", marginBottom: 8 }}>
                          <b>{meta.audienceName || "Meta LLA"}</b> · Size: <b>{meta.lookalikeSize || "1%"}</b> · Est reach: <b>{meta.estReachM ? meta.estReachM + "M" : "—"}</b>
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: 8 }}>Source: {meta.sourceAudienceSuggestion || "Pixel: Purchasers (180d)"}</div>
                        {meta.detailedTargeting?.interests && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Detailed targeting · interests</div>
                            <TagList arr={meta.detailedTargeting.interests} color="#1877F2" />
                          </div>
                        )}
                        {meta.detailedTargeting?.behaviors && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Behaviors</div>
                            <TagList arr={meta.detailedTargeting.behaviors} color="#1877F2" />
                          </div>
                        )}
                        {meta.exclusions?.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Exclusions</div>
                            <TagList arr={meta.exclusions} color="#EF4444" />
                          </div>
                        ) : null}
                        {meta.uploadInstructions && (
                          <div style={{ marginTop: 12, padding: "10px 12px", background: "#EFF6FF", borderLeft: "3px solid #1877F2", borderRadius: 6, fontSize: "0.78rem", color: "#1E3A8A", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {meta.uploadInstructions}
                          </div>
                        )}
                      </div>
                    )}
                    {google && (
                      <div style={{ background: "white", border: "1.5px solid #4285F433", borderRadius: 14, padding: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>🔵 Google Customer Match</div>
                          <button onClick={() => exportCsv("google")} style={{ padding: "7px 12px", background: "#4285F4", color: "white", border: "none", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>⬇ Download CSV template</button>
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#0A1628", marginBottom: 8 }}>
                          <b>{google.audienceName || "Customer Match list"}</b> · Type: <b>{google.matchType || "Customer Match"}</b>
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: 8 }}>Upload format: {google.uploadFormat || "CSV with SHA-256 hashed identifiers"}</div>
                        {google.similarAudienceTopics?.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Similar-audience topics</div>
                            <TagList arr={google.similarAudienceTopics} color="#4285F4" />
                          </div>
                        ) : null}
                        {google.inMarketSegments?.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>In-market segments</div>
                            <TagList arr={google.inMarketSegments} color="#0F9D58" />
                          </div>
                        ) : null}
                        {google.uploadInstructions && (
                          <div style={{ marginTop: 12, padding: "10px 12px", background: "#F0F7FF", borderLeft: "3px solid #4285F4", borderRadius: 6, fontSize: "0.78rem", color: "#1E3A8A", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {google.uploadInstructions}
                          </div>
                        )}
                      </div>
                    )}
                    {tiktok && (
                      <div style={{ background: "white", border: "1.5px solid #0F172A33", borderRadius: 14, padding: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem" }}>⬛ TikTok Lookalike Audience</div>
                          <button onClick={() => exportCsv("tiktok")} style={{ padding: "7px 12px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>⬇ Download CSV template</button>
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#0A1628", marginBottom: 8 }}>
                          <b>{tiktok.audienceName || "TikTok LLA"}</b> · Mode: <b>{tiktok.lookalikeMode || "Balanced"}</b>
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: 8 }}>Seed: {tiktok.seedAudienceSuggestion || "Past-180-day purchasers"}</div>
                        {tiktok.interestCategories?.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Interest categories</div>
                            <TagList arr={tiktok.interestCategories} color="#0F172A" />
                          </div>
                        ) : null}
                        {tiktok.behaviors?.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Behaviors</div>
                            <TagList arr={tiktok.behaviors} color="#FF2D55" />
                          </div>
                        ) : null}
                        {tiktok.creators?.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Creator categories</div>
                            <TagList arr={tiktok.creators} color="#10B981" />
                          </div>
                        ) : null}
                        {tiktok.uploadInstructions && (
                          <div style={{ marginTop: 12, padding: "10px 12px", background: "#F1F5F9", borderLeft: "3px solid #0F172A", borderRadius: 6, fontSize: "0.78rem", color: "#0F172A", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {tiktok.uploadInstructions}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
                  <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 10 }}>🎯 Targeting signals</div>
                  {([
                    ["Interests", spec.interests, "#6366F1"],
                    ["Behaviors", spec.behaviors, "#0EA5E9"],
                    ["Job titles", spec.jobTitles, "#10B981"],
                    ["Industries", spec.industries, "#F59E0B"],
                    ["Intent keywords", spec.intentKeywords, "#EF4444"],
                  ] as [string, string[] | undefined, string][]).map(([label, arr, color]) =>
                    arr?.length ? (
                      <div key={label} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                        <TagList arr={arr} color={color} />
                      </div>
                    ) : null,
                  )}
                </div>

                {spec.seedExamples?.length ? (
                  <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
                    <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 10 }}>🧬 Seed personas</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
                      {spec.seedExamples.map((p, i) => (
                        <div key={i} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, background: "white" }}>
                          <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.86rem", marginBottom: 4 }}>{p.persona || "—"}</div>
                          <div style={{ fontSize: "0.74rem", color: "#64748B", marginBottom: 6 }}>{p.demographics || ""}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                            {(p.channels || []).map((c, k) => <Tag key={k} txt={c} color="#6366F1" />)}
                          </div>
                          <div style={{ fontSize: "0.74rem", color: "#0A1628" }}><b>Trigger:</b> {p.buyingTrigger || ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {spec.warnings?.length ? (
                  <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 14, padding: 14 }}>
                    <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.86rem", marginBottom: 6 }}>⚠️ Compliance &amp; quality notes</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#78350F", fontSize: "0.8rem", lineHeight: 1.6 }}>
                      {spec.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
