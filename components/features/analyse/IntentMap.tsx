"use client";

// Native React port of the legacy `intent-map` panel (was `buildIntentMap` +
// `generateIntentMap` + `#view-intent-map` / `#intentMapWrap` in
// public/js/ig_research_tools.js). Classifies keywords by search intent via the
// existing Express API (`POST /api/intent-map`). Config seeds (brand,
// competitors, keywords) come from the legacy `window.analysisData` global.
// "Send to Battle Plan" persists must-do keywords to localStorage + navigates;
// "Export CSV" downloads the full classification.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

type Intent = "informational" | "commercial" | "transactional" | "navigational";
type Priority = "must-do" | "nice-to-have" | "skip";
type Cpc = "low" | "medium" | "high";

interface IntentKeyword {
  keyword: string;
  intent: Intent;
  confidence: number;
  recommendedPageType: string;
  intentMatchScore: number;
  matchReason?: string;
  competitorGap?: boolean;
  gapReason?: string;
  priority: Priority;
  estimatedCPC: Cpc;
  opportunity: string;
}
interface IntentSummary {
  total: number;
  byIntent: Record<Intent, number>;
  avgIntentMatch: number;
  gaps: number;
  mustDoCount: number;
}
interface IntentMapData {
  keywords: IntentKeyword[];
  summary: IntentSummary;
}
interface IntentMapResponse extends Partial<IntentMapData> {
  error?: string;
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: { name?: string; topKeywords?: string[] }[];
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function toast(msg: string) {
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}

function seedKeywords(ad: AnalysisData): string {
  const seeds = new Set<string>();
  (ad.competitors || []).forEach((c) => {
    (c.topKeywords || [])
      .slice(0, 3)
      .forEach((k) => seeds.add(String(k).toLowerCase()));
  });
  const rawDomain = String(ad.url || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*/, "")
    .replace(/^www\./, "");
  const brandRoot = rawDomain.split(".")[0];
  if (brandRoot) {
    seeds.add(`${brandRoot} reviews`);
    seeds.add(`${brandRoot} login`);
    seeds.add(`is ${brandRoot} legit`);
  }
  const topComp = (ad.competitors || []).map((c) => c.name).filter(Boolean)[0];
  if (brandRoot && topComp) seeds.add(`${brandRoot} vs ${topComp}`);
  if (ad.industry?.name) {
    seeds.add(`best ${ad.industry.name} platform`);
    seeds.add(`how to choose a ${ad.industry.name} provider`);
  }
  return Array.from(seeds).slice(0, 12).join(", ");
}

const BUCKETS: {
  key: Intent;
  label: string;
  icon: string;
  color: string;
  bg: string;
  desc: string;
}[] = [
  { key: "informational", label: "Informational", icon: "📚", color: "#0066FF", bg: "#EFF6FF", desc: "User wants to learn" },
  { key: "commercial", label: "Commercial", icon: "⚖️", color: "#0f766e", bg: "#F5F3FF", desc: "User comparing options" },
  { key: "transactional", label: "Transactional", icon: "💳", color: "#10B981", bg: "#ECFDF5", desc: "User ready to buy" },
  { key: "navigational", label: "Navigational", icon: "🧭", color: "#F59E0B", bg: "#FEF3C7", desc: "User searching a brand" },
];

export default function IntentMap() {
  const router = useRouter();
  const ad = useMemo(getAnalysisData, []);
  const [brand, setBrand] = useState(ad.url || "");
  const [comps, setComps] = useState(
    (ad.competitors || []).map((c) => c.name).filter(Boolean).join(", "),
  );
  const [keywords, setKeywords] = useState(() => seedKeywords(ad));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [map, setMap] = useState<IntentMapData | null>(null);

  async function generate() {
    if (busy) {
      toast("⏳ Already generating — please wait");
      return;
    }
    const kwList = keywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const compList = comps
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (kwList.length === 0) {
      toast("⚠️ Enter at least one keyword to classify");
      return;
    }
    if (kwList.length > 40) toast("ℹ️ Capping at the first 40 keywords");
    setBusy(true);
    setError("");
    setMap(null);
    try {
      const resp = await fetch("/api/intent-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          brand,
          url: ad.url || brand,
          industry: ad.industry?.name || "marketing",
          keywords: kwList,
          competitors: compList,
        }),
      });
      const data = (await resp.json()) as IntentMapResponse;
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      if (!data.keywords || !data.summary)
        throw new Error("Malformed response");
      const result: IntentMapData = {
        keywords: data.keywords,
        summary: data.summary,
      };
      setMap(result);
      toast(
        `✅ Mapped ${result.summary.total} keywords · ${result.summary.gaps} gap${result.summary.gaps === 1 ? "" : "s"} · ${result.summary.mustDoCount} must-do`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Intent mapping failed");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!map?.keywords?.length) {
      toast("⚠️ Generate the intent map first");
      return;
    }
    const rows: (string | number)[][] = [
      [
        "Keyword",
        "Intent",
        "Confidence",
        "Recommended Page Type",
        "Page-Fit Score",
        "Page-Fit Reason",
        "Competitor Gap",
        "Gap Reason",
        "Priority",
        "Estimated CPC",
        "Opportunity",
      ],
    ];
    map.keywords.forEach((k) =>
      rows.push([
        k.keyword,
        k.intent,
        k.confidence,
        k.recommendedPageType,
        k.intentMatchScore,
        k.matchReason || "",
        k.competitorGap ? "YES" : "no",
        k.gapReason || "",
        k.priority,
        k.estimatedCPC,
        k.opportunity,
      ]),
    );
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `intent-map-${Date.now()}.csv`;
    a.click();
    toast("✅ CSV downloaded");
  }

  function sendToBattlePlan() {
    if (!map?.keywords?.length) {
      toast("⚠️ Generate the intent map first");
      return;
    }
    const mustDos = map.keywords.filter((k) => k.priority === "must-do");
    if (mustDos.length === 0) {
      toast("ℹ️ No must-do keywords to send");
      return;
    }
    (window as unknown as { _intentMustDos?: IntentKeyword[] })._intentMustDos =
      mustDos;
    try {
      localStorage.setItem("infogenie_intent_mustdos", JSON.stringify(mustDos));
    } catch {
      /* ignore quota errors */
    }
    toast(
      `⚔️ Queued ${mustDos.length} must-do keyword${mustDos.length === 1 ? "" : "s"} for Battle Plan`,
    );
    setTimeout(() => goToView(router, "battleplan"), 600);
  }

  return (
    <div className="view-header-wrap">
      <div
        className="view-header ig-panel-hero"
        style={{ background: "linear-gradient(135deg,#0066FF 0%,#0f766e 100%)" }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#C7D9FF" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(199,217,255,.8)" }}
                >
                  Analyse
                </span>{" "}
                <span className="bc-sep" style={{ color: '#94a3b8' }}>
                  ›
                </span>{" "}
                Intent Map
              </div>
              <h2 className="view-title">🧭 Search Intent Map</h2>
              <p className="view-sub">
                Classify every keyword by user intent, match it to the right page
                type, and surface gaps your competitors are exploiting.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                onClick={generate}
                disabled={busy}
                style={{ background: "white", color: "#0066FF" }}
              >
                {busy ? "⏱ Generating…" : "⚡ Generate Intent Map"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 60 }}
      >
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 16,
            padding: "22px 24px",
            marginBottom: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg,#0066FF,#0f766e)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.1rem",
              }}
            >
              ⚙️
            </div>
            <div>
              <div
                style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0A1628" }}
              >
                Intent Map Settings
              </div>
              <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                Keywords are classified by GPT-4o into 4 intent buckets and matched
                to the right page type.
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div>
              <label style={imLabel}>Your brand / domain</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="yourdomain.com"
                style={imInput}
              />
            </div>
            <div>
              <label style={imLabel}>Competitors (comma-separated)</label>
              <input
                value={comps}
                onChange={(e) => setComps(e.target.value)}
                placeholder="OANDA, Plus500, FXCM"
                style={imInput}
              />
            </div>
          </div>
          <div>
            <label style={imLabel}>
              Keywords to classify (comma-separated · up to 40)
            </label>
            <textarea
              rows={3}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="forex trading, CFD broker reviews, best forex platform, open trading account, Plus500 vs OANDA"
              style={{ ...imInput, fontFamily: "inherit", resize: "vertical" }}
            />
            <div style={{ fontSize: "0.7rem", color: "#94A3B8", marginTop: 6 }}>
              Auto-seeded from your competitor analysis. Edit freely.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              marginTop: 16,
            }}
          >
            <button
              onClick={generate}
              disabled={busy}
              style={{
                padding: "10px 22px",
                background: "linear-gradient(135deg,#0066FF,#0f766e)",
                border: "none",
                borderRadius: 10,
                fontSize: "0.82rem",
                fontWeight: 700,
                color: "white",
                cursor: busy ? "wait" : "pointer",
                minWidth: 200,
                opacity: busy ? 0.75 : 1,
              }}
            >
              {busy ? "⏱ Generating…" : "⚡ Generate Intent Map"}
            </button>
          </div>
        </div>

        <div>
          {busy && (
            <div
              style={{
                background: "white",
                border: "1px solid #E2E8F0",
                borderRadius: 16,
                padding: "60px 24px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  color: "#0A1628",
                  marginBottom: 6,
                }}
              >
                Classifying keywords…
              </div>
              <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
                GPT-4o is mapping intent, page-type fit, and competitor gaps
              </div>
            </div>
          )}
          {!busy && error && (
            <div
              style={{
                background: "white",
                border: "1px solid #FECACA",
                borderRadius: 16,
                padding: "40px 24px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: 10 }}>⚠️</div>
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  color: "#DC2626",
                  marginBottom: 8,
                }}
              >
                Intent mapping failed
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#64748B",
                  marginBottom: 14,
                  maxWidth: 480,
                  marginLeft: "auto",
                  marginRight: "auto",
                }}
              >
                {error}
              </div>
              <button
                onClick={generate}
                style={{
                  padding: "9px 20px",
                  background: "#0066FF",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                🔄 Try Again
              </button>
            </div>
          )}
          {!busy && !error && !map && (
            <div
              style={{
                background: "white",
                border: "1px dashed #CBD5E1",
                borderRadius: 16,
                padding: "60px 24px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: 14 }}>🧭</div>
              <div
                style={{
                  fontSize: "1rem",
                  fontWeight: 800,
                  color: "#0A1628",
                  marginBottom: 6,
                }}
              >
                Ready to map your search intent
              </div>
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "#64748B",
                  maxWidth: 520,
                  margin: "0 auto",
                  lineHeight: 1.5,
                }}
              >
                Enter your keywords above and click{" "}
                <strong style={{ color: "#0066FF" }}>Generate Intent Map</strong>.
                GPT-4o will classify each one into Informational, Commercial,
                Transactional or Navigational, recommend the right page type, and
                flag gaps your competitors are exploiting.
              </div>
            </div>
          )}
          {!busy && map && (
            <IntentResults
              map={map}
              onExport={exportCsv}
              onSend={sendToBattlePlan}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const imLabel: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: ".05em",
  marginBottom: 6,
  display: "block",
};
const imInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 14px",
  border: "1.5px solid #E2E8F0",
  borderRadius: 10,
  fontSize: "0.85rem",
  color: "#0A1628",
  outline: "none",
};

function Tile({
  value,
  label,
  bg,
  color,
}: {
  value: string | number;
  label: string;
  bg: string;
  color: string;
}) {
  return (
    <div style={{ background: bg, borderRadius: 14, padding: "18px 16px", textAlign: "center" }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color }}>{value}</div>
      <div
        style={{
          fontSize: "0.7rem",
          color: "rgba(255,255,255,.95)",
          marginTop: 6,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function IntentResults({
  map,
  onExport,
  onSend,
}: {
  map: IntentMapData;
  onExport: () => void;
  onSend: () => void;
}) {
  const { keywords, summary } = map;
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5,1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Tile value={summary.total} label="Keywords Mapped" bg="linear-gradient(135deg,#062A36,#0A4858)" color="#00E5FF" />
        <Tile value={summary.byIntent.commercial + summary.byIntent.transactional} label="High-Intent" bg="linear-gradient(135deg,#1a0a28,#2D1060)" color="#A78BFA" />
        <Tile value={`${summary.avgIntentMatch}%`} label="Avg Page-Fit" bg="linear-gradient(135deg,#0A2818,#0D5E30)" color="#10B981" />
        <Tile value={summary.gaps} label="Competitor Gaps" bg="linear-gradient(135deg,#3a1a0a,#7C2D12)" color="#FB923C" />
        <Tile value={summary.mustDoCount} label="Must-Do" bg="linear-gradient(135deg,#28080a,#7C0E20)" color="#F87171" />
      </div>

      <div
        style={{
          background: "white",
          border: "1px solid #E2E8F0",
          borderRadius: 14,
          padding: "14px 18px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ fontSize: "0.82rem", color: "#0A1628" }}>
          <strong>📋 Send must-do keywords to your Battle Plan</strong> —
          automatically queues high-priority gaps for your 90-day plan.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onExport}
            style={{
              padding: "8px 16px",
              background: "white",
              border: "1.5px solid #CBD5E1",
              borderRadius: 8,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#475569",
              cursor: "pointer",
            }}
          >
            ⬇️ Export CSV
          </button>
          <button
            onClick={onSend}
            style={{
              padding: "8px 16px",
              background: "linear-gradient(135deg,#0066FF,#0f766e)",
              border: "none",
              borderRadius: 8,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "white",
              cursor: "pointer",
            }}
          >
            ⚔️ Send to Battle Plan
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 14,
        }}
      >
        {BUCKETS.map((b) => {
          const items = keywords.filter((k) => k.intent === b.key);
          return (
            <div
              key={b.key}
              style={{
                background: "white",
                border: "1px solid #E2E8F0",
                borderRadius: 14,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  background: b.bg,
                  borderBottom: `1px solid ${b.color}33`,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: "1.1rem" }}>{b.icon}</span>
                    <span
                      style={{
                        fontSize: "0.9rem",
                        fontWeight: 800,
                        color: b.color,
                      }}
                    >
                      {b.label}
                    </span>
                  </div>
                  <span
                    style={{
                      background: b.color,
                      color: "white",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 999,
                    }}
                  >
                    {items.length}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: `${b.color}AA`,
                    fontWeight: 600,
                  }}
                >
                  {b.desc}
                </div>
              </div>
              <div
                style={{
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minHeight: 120,
                }}
              >
                {items.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "24px 8px",
                      color: "#94A3B8",
                      fontSize: "0.78rem",
                    }}
                  >
                    No keywords in this bucket
                  </div>
                ) : (
                  items.map((k, i) => (
                    <IntentCard key={i} k={k} accent={b.color} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function IntentCard({ k, accent }: { k: IntentKeyword; accent: string }) {
  const cpcColor: Record<Cpc, string> = {
    low: "#10B981",
    medium: "#F59E0B",
    high: "#EF4444",
  };
  const fitColor =
    k.intentMatchScore >= 70
      ? "#10B981"
      : k.intentMatchScore >= 40
        ? "#F59E0B"
        : "#EF4444";
  return (
    <div
      style={{
        border: "1px solid #E2E8F0",
        borderRadius: 10,
        padding: "11px 12px",
        background: "#FAFBFC",
      }}
    >
      <div
        style={{
          fontSize: "0.83rem",
          fontWeight: 700,
          color: "#0A1628",
          lineHeight: 1.3,
          marginBottom: 6,
        }}
      >
        {k.keyword}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          marginBottom: 8,
        }}
      >
        {k.priority === "must-do" && (
          <span style={{ ...badge, background: "#FEE2E2", color: "#B91C1C" }}>
            🔥 MUST-DO
          </span>
        )}
        {k.priority === "nice-to-have" && (
          <span style={{ ...badge, background: "#FEF3C7", color: "#A16207" }}>
            ★ NICE-TO-HAVE
          </span>
        )}
        {k.priority === "skip" && (
          <span style={{ ...badge, background: "#F1F5F9", color: "#64748B" }}>
            SKIP
          </span>
        )}
        {k.competitorGap && (
          <span style={{ ...badge, background: "#FEE2E2", color: "#B91C1C" }}>
            ⚠️ GAP
          </span>
        )}
        <span
          style={{
            ...badge,
            background: "white",
            border: "1px solid #CBD5E1",
            color: cpcColor[k.estimatedCPC] || "#64748B",
          }}
        >
          {String(k.estimatedCPC).toUpperCase()} CPC
        </span>
      </div>
      <div
        style={{ fontSize: "0.72rem", color: "#475569", marginBottom: 6 }}
      >
        <strong style={{ color: accent }}>→ {k.recommendedPageType}</strong>
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={barRow}>
          <span>Intent confidence</span>
          <span style={{ color: accent, fontWeight: 700 }}>
            {k.confidence}%
          </span>
        </div>
        <div style={barTrack}>
          <div
            style={{
              width: `${k.confidence}%`,
              height: "100%",
              background: accent,
            }}
          />
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={barRow}>
          <span>Page-fit</span>
          <span style={{ color: fitColor, fontWeight: 700 }}>
            {k.intentMatchScore}%
          </span>
        </div>
        <div style={{ ...barTrack, height: 5 }}>
          <div
            style={{
              width: `${k.intentMatchScore}%`,
              height: "100%",
              background: fitColor,
            }}
          />
        </div>
        {k.matchReason && (
          <div
            style={{
              fontSize: "0.66rem",
              color: "#64748B",
              lineHeight: 1.35,
              marginTop: 4,
              fontStyle: "italic",
            }}
          >
            {k.matchReason}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: "0.72rem",
          color: "#475569",
          lineHeight: 1.4,
          borderTop: "1px solid #F1F5F9",
          paddingTop: 7,
        }}
      >
        💡 {k.opportunity}
      </div>
      {k.competitorGap && k.gapReason && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "#B91C1C",
            lineHeight: 1.4,
            marginTop: 5,
          }}
        >
          ⚠️ {k.gapReason}
        </div>
      )}
    </div>
  );
}

const badge: React.CSSProperties = {
  fontSize: "0.65rem",
  fontWeight: 700,
  padding: "2px 7px",
  borderRadius: 6,
};
const barRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "0.66rem",
  color: "#64748B",
  marginBottom: 3,
};
const barTrack: React.CSSProperties = {
  height: 4,
  background: "#E2E8F0",
  borderRadius: 3,
  overflow: "hidden",
};
