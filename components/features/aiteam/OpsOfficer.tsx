"use client";

// Native React port of the legacy `ops-officer` panel (was
// `window.buildOpsOfficer` + `#view-ops-officer`, inline in `app.js`). Scans live
// campaigns, brand assets, leads and goals via the existing Express API
// (`POST /api/ops-officer/scan`) and re-runs the AI digest
// (`POST /api/officer/brief`) on every load. See
// `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { BriefList, ActionsCard } from "./FinanceOfficer";

type BriefItem = string | { title?: string };
interface BriefAction {
  title?: string;
  detail?: string;
  priority?: string;
}
interface Brief {
  summary?: string;
  highlights?: BriefItem[];
  risks?: BriefItem[];
  actions?: BriefAction[];
}

interface OpsSnapshot {
  campaigns?: { total?: number; recent?: number; stale?: number; missingCreative?: number };
  assets?: { uploaded?: number; missing?: string[] };
  leads?: { qualified?: number; unqualified?: number };
  goals?: { total?: number; offTrack?: number };
}

const CARD =
  "background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)";

function fmt(n: number | string | null | undefined, prefix = "", dash = "—"): string {
  if (n == null || n === "" || (typeof n === "number" && !isFinite(n))) return dash;
  return prefix + (typeof n === "number" ? n.toLocaleString() : n);
}

function styleObj(css: string): React.CSSProperties {
  const out: Record<string, string> = {};
  css.split(";").forEach((rule) => {
    const i = rule.indexOf(":");
    if (i === -1) return;
    const key = rule.slice(0, i).trim();
    const val = rule.slice(i + 1).trim();
    if (!key) return;
    const jsKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[jsKey] = val;
  });
  return out as React.CSSProperties;
}

function Kpi({
  label,
  val,
  sub = "",
  tone = "",
}: {
  label: string;
  val: string;
  sub?: string;
  tone?: "good" | "bad" | "";
}) {
  return (
    <div style={styleObj(CARD + ";padding:16px")}>
      <div
        style={{
          fontSize: ".7rem",
          color: "#64748B",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color: tone === "good" ? "#15803D" : tone === "bad" ? "#B91C1C" : "#0F172A",
          marginTop: 6,
        }}
      >
        {val}
      </div>
      {sub ? (
        <div style={{ fontSize: ".72rem", color: "#64748B", marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  );
}

export default function OpsOfficer() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [snap, setSnap] = useState<OpsSnapshot>({});
  const [brief, setBrief] = useState<Brief | null>(null);

  const nav = useCallback((view: string) => goToView(router, view), [router]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let snapshot: OpsSnapshot = {};
      const r = await apiPost<{ ok: boolean; snapshot?: OpsSnapshot }>(
        "/api/ops-officer/scan",
        {},
      );
      if (r.ok) snapshot = r.snapshot || {};
      if (!alive) return;
      setSnap(snapshot);

      const br = await apiPost<{ ok: boolean; brief?: Brief }>("/api/officer/brief", {
        role: "ops",
        facts: snapshot,
      });
      if (!alive) return;
      if (br.ok) setBrief(br.brief ?? null);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const c = snap.campaigns || {};
  const a = snap.assets || {};
  const l = snap.leads || {};
  const g = snap.goals || {};
  const missing = a.missing || [];

  return (
    <div>
      <div
        style={styleObj(
          "max-width:1200px;margin:0 auto 22px;padding:24px 28px;color:white;border-radius:18px;background:linear-gradient(135deg,#7C2D12 0%,#9A3412 100%)",
        )}
      >
        <div
          style={{
            fontSize: ".72rem",
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#FED7AA",
            fontWeight: 700,
          }}
        >
          🛠️ OPERATIONS OFFICER
        </div>
        <h1 style={{ margin: "8px 0 6px", fontSize: "1.85rem", fontWeight: 800 }}>
          Campaign QA, Assets &amp; Lead Hygiene
        </h1>
        <p style={{ margin: 0, fontSize: ".92rem", color: "#FFEDD5", maxWidth: 720 }}>
          Scans your live campaigns, brand assets, leads and goals for stale or broken items.
          Returns a weekly digest with a prioritised checklist.
        </p>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
        {loading ? (
          <div style={styleObj(CARD + ";text-align:center;color:#64748B")}>
            ⏳ Scanning your operations…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))",
                gap: 14,
                marginBottom: 18,
              }}
            >
              <Kpi label="Campaigns" val={fmt(c.total)} sub={`${c.recent || 0} active in last 7d`} />
              <Kpi
                label="Stale Campaigns"
                val={fmt(c.stale)}
                sub=">14 days no update"
                tone={(c.stale || 0) > 0 ? "bad" : ""}
              />
              <Kpi
                label="Missing Creative"
                val={fmt(c.missingCreative)}
                tone={(c.missingCreative || 0) > 0 ? "bad" : ""}
              />
              <Kpi
                label="Brand Assets"
                val={fmt(a.uploaded)}
                sub={`${missing.length} gaps`}
                tone={missing.length > 0 ? "bad" : "good"}
              />
              <Kpi label="Qualified Leads" val={fmt(l.qualified)} tone="good" />
              <Kpi
                label="Unqualified"
                val={fmt(l.unqualified)}
                sub="awaiting review"
                tone={(l.unqualified || 0) > 20 ? "bad" : ""}
              />
              <Kpi
                label="Goals"
                val={fmt(g.total)}
                sub={`${g.offTrack || 0} off-track`}
                tone={(g.offTrack || 0) > 0 ? "bad" : ""}
              />
            </div>
            {missing.length ? (
              <div
                style={styleObj(
                  CARD + ";background:#FEF3C7;border-color:#FDE68A;margin-bottom:18px",
                )}
              >
                <strong style={{ color: "#92400E" }}>Brand asset gaps:</strong>{" "}
                <span style={{ color: "#78350F" }}>{missing.join(", ")}</span> —{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    nav("brand-assets");
                  }}
                  style={{ color: "#92400E", fontWeight: 700 }}
                >
                  Open Brand Assets →
                </a>
              </div>
            ) : null}
            {brief ? (
              <>
                <div style={styleObj(CARD + ";margin-bottom:18px")}>
                  <div
                    style={{
                      fontSize: ".7rem",
                      color: "#64748B",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                      marginBottom: 8,
                    }}
                  >
                    Weekly Ops Digest
                  </div>
                  <p style={{ margin: 0, fontSize: ".95rem", color: "#0F172A", lineHeight: 1.55 }}>
                    {brief.summary || ""}
                  </p>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
                    gap: 18,
                    marginBottom: 18,
                  }}
                >
                  <BriefList title="✅ Highlights" items={brief.highlights} color="#15803D" />
                  <BriefList title="⚠️ Risks" items={brief.risks} color="#B91C1C" />
                </div>
                <ActionsCard actions={brief.actions} />
              </>
            ) : (
              <div style={styleObj(CARD + ";text-align:center;color:#64748B")}>
                AI digest unavailable. Showing scan results above.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
