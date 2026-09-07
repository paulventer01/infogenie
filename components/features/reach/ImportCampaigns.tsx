"use client";

// Native React port of the legacy `import-campaigns` panel (`buildImportCampaigns`
// + `#view-import-campaigns` in index.html, builder in app.js). This is a
// CLIENT-SIDE SIMULATION (the legacy panel makes no API calls): it reads the
// last analysed site from `window.analysisData` / localStorage to derive the
// domain + sector, lets the user pick ad platforms (or upload a CSV), then
// "imports" campaigns generated deterministically per-domain with a short
// simulated delay — faithfully reproducing the legacy behaviour (no fabricated
// server data).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { goToView } from "@/lib/nav";

interface Platform {
  key: string;
  name: string;
  icon: string;
  color: string;
  desc: string;
}

const PLATFORMS: Platform[] = [
  { key: "meta", name: "Meta Ads", icon: "📘", color: "#1877F2", desc: "Facebook + Instagram" },
  { key: "google", name: "Google Ads", icon: "🔍", color: "#4285F4", desc: "Search, Display, YouTube" },
  { key: "tiktok", name: "TikTok Ads", icon: "🎵", color: "#000000", desc: "TikTok Spark + In-Feed" },
  { key: "linkedin", name: "LinkedIn Ads", icon: "💼", color: "#0A66C2", desc: "Sponsored Content + InMail" },
  { key: "x", name: "X Ads", icon: "𝕏", color: "#0F172A", desc: "Promoted posts + Takeover" },
  { key: "snapchat", name: "Snapchat Ads", icon: "👻", color: "#FFFC00", desc: "Snap Ads + AR Lenses" },
  { key: "pinterest", name: "Pinterest Ads", icon: "📌", color: "#E60023", desc: "Promoted Pins + Idea Ads" },
  { key: "microsoft", name: "Microsoft Ads", icon: "🪟", color: "#00A4EF", desc: "Bing Search + Audience" },
];

const PLAT_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  snapchat: "Snapchat",
  pinterest: "Pinterest",
  microsoft: "Microsoft (Bing)",
  csv: "CSV Import",
};

interface AnalysisData {
  url?: string;
  domain?: string;
  sector?: string;
  industry?: string | { name?: string };
}

function getAD(): AnalysisData | null {
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
  const ad = getAD();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}

function lsSector(): string {
  const ad = getAD();
  if (ad) {
    if (ad.sector) return ad.sector;
    if (ad.industry && typeof ad.industry === "string") return ad.industry;
    if (ad.industry && typeof ad.industry !== "string" && ad.industry.name)
      return ad.industry.name;
  }
  return "your industry";
}

function toast(msg: string) {
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

// Shared seeded RNG (deterministic per-domain output) — ported from app.js.
function seedRng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
}

interface Campaign {
  name: string;
  objective: string;
  platform: string;
  spend: number;
  roas: number;
  health: number;
  rec: string;
}

const OBJS = ["Conversions", "Traffic", "Lead Gen", "Awareness", "App Installs", "Engagement"];
const RECS = [
  "Pause — CPA 3× target",
  "Refresh creative — fatigue 4.8",
  "Scale +30% — top ROAS",
  "Narrow audience — CPM rising",
  "Add lookalike 1% audience",
  "Move to Top Performers folder",
  "Add UTM tracking — missing",
  "Increase budget cap",
];
const VARIANTS = ["Acquisition", "Retargeting", "Lookalike", "Brand", "Promo", "Cold", "Warm"];

function genImportCampaigns(src: string, count?: number): Campaign[] {
  const rng = seedRng(lsDomain() + src);
  const sector = lsSector();
  const cn = count || 6 + Math.floor(rng() * 5);
  return Array.from({ length: cn }).map((_, i) => {
    const roas = +(0.8 + rng() * 4.2).toFixed(1);
    const health =
      roas >= 3
        ? Math.floor(78 + rng() * 22)
        : roas >= 2
          ? Math.floor(58 + rng() * 22)
          : Math.floor(28 + rng() * 32);
    return {
      name: `${sector} ${VARIANTS[i % 7]} #${i + 1}`,
      objective: OBJS[Math.floor(rng() * OBJS.length)],
      platform: PLAT_LABELS[src] || src,
      spend: Math.floor(280 + rng() * 4200),
      roas,
      health,
      rec: RECS[Math.floor(rng() * RECS.length)],
    };
  });
}

interface ImportData {
  source: string;
  sources?: string[];
  multi?: boolean;
  label?: string;
  campaigns: Campaign[];
}

export default function ImportCampaigns() {
  const router = useRouter();
  const hasAnalysis = typeof window !== "undefined" && !!lsDomain();
  const [data, setData] = useState<ImportData | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  function requireAnalysis(): boolean {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return false;
    }
    return true;
  }

  function connectImportSource(src: string) {
    if (!requireAnalysis()) return;
    setBusy(true);
    setTimeout(() => {
      const campaigns = genImportCampaigns(src);
      setData({ source: src, campaigns });
      setBusy(false);
      toast(`✅ Imported ${campaigns.length} campaigns from ${PLAT_LABELS[src] || src}`);
    }, 1500);
  }

  function connectSelectedImportSources() {
    if (!requireAnalysis()) return;
    const keys = PLATFORMS.filter((p) => selected[p.key]).map((p) => p.key);
    if (!keys.length) {
      toast("⚠️ Tick at least one platform — or use Select All");
      return;
    }
    setBusy(true);
    setTimeout(() => {
      const allCampaigns: Campaign[] = [];
      keys.forEach((k) => {
        genImportCampaigns(k, 6).forEach((c) => allCampaigns.push(c));
      });
      const label =
        keys.length === 1 ? PLAT_LABELS[keys[0]] || keys[0] : `${keys.length} platforms`;
      setData({
        source: keys[0],
        sources: keys,
        multi: keys.length > 1,
        label,
        campaigns: allCampaigns,
      });
      setBusy(false);
      toast(`✅ Imported ${allCampaigns.length} campaigns from ${label}`);
    }, 1600);
  }

  function rescanFromData(d: ImportData) {
    if (!requireAnalysis()) return;
    if (d.multi && d.sources) {
      const keys = d.sources.slice();
      const sel: Record<string, boolean> = {};
      keys.forEach((k) => {
        sel[k] = true;
      });
      setSelected(sel);
      setData(null);
      setBusy(true);
      setTimeout(() => {
        const allCampaigns: Campaign[] = [];
        keys.forEach((k) => {
          genImportCampaigns(k, 6).forEach((c) => allCampaigns.push(c));
        });
        const label = keys.length === 1 ? PLAT_LABELS[keys[0]] || keys[0] : `${keys.length} platforms`;
        setData({ source: keys[0], sources: keys, multi: keys.length > 1, label, campaigns: allCampaigns });
        setBusy(false);
        toast(`✅ Imported ${allCampaigns.length} campaigns from ${label}`);
      }, 1600);
    } else {
      connectImportSource(d.source);
    }
  }

  function runImportCampaigns() {
    if (!requireAnalysis()) return;
    if (data) {
      rescanFromData(data);
      return;
    }
    const anySelected = PLATFORMS.some((p) => selected[p.key]);
    if (anySelected) {
      connectSelectedImportSources();
      return;
    }
    toast("👇 Tick the platforms to import, then hit Connect Selected");
  }

  function toggleSelectAll() {
    const allChecked = PLATFORMS.every((p) => selected[p.key]);
    const next: Record<string, boolean> = {};
    if (!allChecked) {
      PLATFORMS.forEach((p) => {
        next[p.key] = true;
      });
    }
    setSelected(next);
    toast(allChecked ? "☐ Cleared selection" : `☑ Selected all ${PLATFORMS.length} platforms`);
  }

  const allChecked = PLATFORMS.every((p) => selected[p.key]);

  const header = (
    <div
      className="view-header ig-panel-hero"
      style={{ background: "linear-gradient(135deg,#7C2D12 0%,#DC2626 50%,#0f766e 100%)" }}
    >
      <div className="container">
        <div className="vh-inner">
          <div>
            <div className="breadcrumb" style={{ color: "#FED7AA" }}>
              <span className="bc-group" style={{ color: "rgba(254,215,170,.8)" }}>
                Reach
              </span>{" "}
              <span className="bc-sep" style={{ color: '#94a3b8' }}>
                ›
              </span>{" "}
              Import Campaigns
            </div>
            <h2 className="view-title">📥 Import Existing Campaigns</h2>
            <p className="view-sub">
              Already running ads on Meta, Google, TikTok or LinkedIn? Import them in one click —
              InfoGenie audits performance and recommends fixes.
            </p>
          </div>
          <div className="vh-actions">
            <button
              className="btn-primary"
              style={{ background: "white", color: "#B91C1C" }}
              onClick={runImportCampaigns}
              disabled={busy}
            >
              📥 Scan &amp; Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!hasAnalysis) {
    return (
      <div className="view-header-wrap">
        {header}
        <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
          <div
            style={{
              background: "white",
              border: "2px dashed #CBD5E1",
              borderRadius: 12,
              padding: 48,
              textAlign: "center",
              marginTop: 20,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔎</div>
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>Run an analysis first</h3>
            <p style={{ margin: "0 auto 18px", color: "#64748B", maxWidth: 480 }}>
              Import Existing Campaigns needs your competitor &amp; sector data. Head to the home
              page, enter your website (or pick a sector), and we&apos;ll have everything ready in
              under a minute.
            </p>
            <button
              className="btn-primary"
              onClick={() => goToView(router, "home")}
              style={{
                background: "linear-gradient(135deg,#0066FF,#00D8D7)",
                color: "white",
                border: "none",
                padding: "10px 22px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ↗ Go to Home — Run Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      {header}
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {!data ? (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              border: "1px solid #E2E8F0",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 14,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3 style={{ margin: "0 0 6px", color: "#1E293B" }}>
                  Connect a platform to import campaigns
                </h3>
                <p style={{ margin: 0, color: "#64748B", fontSize: 14 }}>
                  Tick the platforms you use, then click Connect Selected. We&apos;ll OAuth into
                  each, audit performance and recommend specific fixes.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={toggleSelectAll}
                  style={{
                    padding: "9px 16px",
                    background: "linear-gradient(135deg,#0EA5E9,#0066FF)",
                    color: "white",
                    border: "none",
                    borderRadius: 7,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {allChecked ? "☐ Deselect All" : "☑ Select All"}
                </button>
                <button
                  onClick={connectSelectedImportSources}
                  disabled={busy}
                  style={{
                    padding: "9px 16px",
                    background: "#10B981",
                    color: "white",
                    border: "none",
                    borderRadius: 7,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⚡ Connect Selected
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
              {PLATFORMS.map((p) => (
                <label
                  key={p.key}
                  style={{
                    background: "white",
                    border: "1px solid #E2E8F0",
                    borderRadius: 10,
                    padding: 14,
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[p.key]}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [p.key]: e.target.checked }))
                    }
                    style={{ width: 18, height: 18, cursor: "pointer", accentColor: p.color }}
                  />
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: `${p.color}15`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      fontWeight: 800,
                      color: p.color,
                    }}
                  >
                    {p.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#1E293B" }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "#64748B" }}>{p.desc}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      connectImportSource(p.key);
                    }}
                    title="Connect just this platform"
                    style={{
                      padding: "7px 12px",
                      background: p.color,
                      color: p.key === "snapchat" ? "#0F172A" : "white",
                      border: "none",
                      borderRadius: 6,
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Connect
                  </button>
                </label>
              ))}
            </div>
            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: "#F0F9FF",
                borderLeft: "3px solid #0EA5E9",
                borderRadius: 6,
                fontSize: 12,
                color: "#0C4A6E",
              }}
            >
              <strong>OR:</strong>{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  connectImportSource("csv");
                }}
                style={{ color: "#0EA5E9", fontWeight: 700 }}
              >
                upload a CSV
              </a>{" "}
              exported from any ad platform — we&apos;ll parse it automatically.
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                background: "white",
                borderRadius: 12,
                padding: 18,
                border: "1px solid #E2E8F0",
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, color: "#1E293B", fontSize: 16 }}>
                    ✓ Connected:{" "}
                    {data.multi
                      ? data.label
                      : (PLATFORMS.find((p) => p.key === data.source) || { name: data.source }).name}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>
                    Imported {data.campaigns.length} campaigns
                    {data.multi && data.sources
                      ? ` across ${data.sources.map((k) => PLAT_LABELS[k] || k).join(", ")}`
                      : ""}{" "}
                    • Last sync: just now
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => {
                      setData(null);
                      setSelected({});
                    }}
                    style={{
                      padding: "7px 14px",
                      background: "#F1F5F9",
                      color: "#1E293B",
                      border: "1px solid #E2E8F0",
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    + Add Source
                  </button>
                  <button
                    onClick={() => rescanFromData(data)}
                    disabled={busy}
                    style={{
                      padding: "7px 14px",
                      background: "#1E293B",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ↻ Re-scan
                  </button>
                </div>
              </div>
            </div>
            <div
              style={{
                background: "white",
                borderRadius: 12,
                border: "1px solid #E2E8F0",
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead style={{ background: "#F8FAFC" }}>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "10px 14px",
                        color: "#64748B",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: ".05em",
                      }}
                    >
                      CAMPAIGN
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "10px 14px",
                        color: "#64748B",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      SPEND
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "10px 14px",
                        color: "#64748B",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      ROAS
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px 14px",
                        color: "#64748B",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      HEALTH
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "10px 14px",
                        color: "#64748B",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      RECOMMENDATION
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: "#94A3B8" }}>
                          {c.objective} • {c.platform}
                        </div>
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          padding: "11px 14px",
                          fontWeight: 700,
                          color: "#1E293B",
                        }}
                      >
                        ${c.spend.toLocaleString()}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          padding: "11px 14px",
                          fontWeight: 800,
                          color: c.roas >= 3 ? "#10B981" : c.roas >= 2 ? "#F59E0B" : "#EF4444",
                        }}
                      >
                        {c.roas}×
                      </td>
                      <td style={{ textAlign: "center", padding: "11px 14px" }}>
                        <div
                          style={{
                            display: "inline-block",
                            padding: "3px 9px",
                            background:
                              c.health >= 80 ? "#F0FDF4" : c.health >= 60 ? "#FEF3C7" : "#FEE2E2",
                            color:
                              c.health >= 80 ? "#065F46" : c.health >= 60 ? "#92400E" : "#991B1B",
                            borderRadius: 99,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {c.health}/100
                        </div>
                      </td>
                      <td style={{ padding: "11px 14px", color: "#475569" }}>{c.rec}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                onClick={() => toast("✓ All recommendations queued")}
                style={{
                  padding: "9px 18px",
                  background: "#10B981",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ✓ Apply All Fixes
              </button>
              <button
                onClick={() => toast("✓ Sync schedule set: hourly")}
                style={{
                  padding: "9px 18px",
                  background: "#F1F5F9",
                  color: "#1E293B",
                  border: "1px solid #E2E8F0",
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ⏱ Auto-sync hourly
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
