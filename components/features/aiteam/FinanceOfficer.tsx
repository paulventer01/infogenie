"use client";

// Native React port of the legacy `finance-officer` panel (was
// `window.buildFinanceOfficer` + `#view-finance-officer`, inline in `app.js`).
// Pulls a live 30-day marketing P&L from the existing Express API
// (`GET /api/cross-channel-report?days=30`) and re-runs the AI brief
// (`POST /api/officer/brief`) on every load. See
// `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiResult } from "@/lib/api";

interface ChannelInfo {
  connected?: boolean;
}
interface CrossChannelFacts {
  totalSpend?: number | null;
  totalRevenue?: number | null;
  netSales?: number | null;
  customers?: number | null;
  cac?: number | null;
  ltvAssumed?: number | null;
  ltvCac?: number | null;
  mer?: number | null;
  roas?: number | null;
  channels?: Record<string, ChannelInfo>;
}

interface FactsForAI {
  window: string;
  totalSpend: number | null;
  totalRevenue: number | null;
  netSales: number | null;
  customers: number | null;
  cac: number | null;
  ltvAssumed: number | null;
  ltvCac: number | null;
  mer: number | null;
  roas: number | null;
  dailyBurn: number | null;
  channelsConnected: string[];
}

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

const CARD =
  "background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)";

function money(n: number | null | undefined): string {
  return n == null
    ? "—"
    : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
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

export function BriefList({
  title,
  items,
  color,
}: {
  title: string;
  items?: BriefItem[];
  color: string;
}) {
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div style={styleObj(CARD)}>
      <div style={{ fontSize: ".78rem", fontWeight: 800, color, marginBottom: 10 }}>
        {title}
      </div>
      {arr.length ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            color: "#0F172A",
            fontSize: ".86rem",
            lineHeight: 1.7,
          }}
        >
          {arr.map((it, i) => (
            <li key={i}>{typeof it === "string" ? it : it.title || JSON.stringify(it)}</li>
          ))}
        </ul>
      ) : (
        <div style={{ color: "#64748B", fontSize: ".82rem" }}>Nothing flagged.</div>
      )}
    </div>
  );
}

export function ActionsCard({ actions }: { actions?: BriefAction[] }) {
  const arr = Array.isArray(actions)
    ? actions.filter((a) => a && (a.title || a.detail))
    : [];
  if (!arr.length) return null;
  const tone = (p?: string) =>
    p === "high"
      ? { bg: "#FEE2E2", c: "#B91C1C" }
      : p === "med"
        ? { bg: "#FEF3C7", c: "#92400E" }
        : { bg: "#E0E7FF", c: "#3730A3" };
  return (
    <div style={styleObj(CARD)}>
      <div style={{ fontSize: ".78rem", fontWeight: 800, color: "#0F172A", marginBottom: 12 }}>
        📋 Recommended Actions
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {arr.map((a, i) => {
          const t = tone(a.priority);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: 12,
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                borderRadius: 10,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontSize: ".68rem",
                  fontWeight: 700,
                  letterSpacing: ".02em",
                  background: t.bg,
                  color: t.c,
                  flexShrink: 0,
                }}
              >
                {(a.priority || "med").toUpperCase()}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "#0F172A", fontSize: ".88rem" }}>
                  {a.title || ""}
                </div>
                {a.detail ? (
                  <div style={{ fontSize: ".78rem", color: "#475569", marginTop: 3 }}>
                    {a.detail}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FinanceOfficer() {
  const [loading, setLoading] = useState(true);
  const [facts, setFacts] = useState<FactsForAI | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let raw: CrossChannelFacts = {};
      const r = await apiGet<CrossChannelFacts & ApiResult>(
        "/api/cross-channel-report?days=30",
      );
      if (r && (r as ApiResult).ok !== false) raw = r;

      const dailyBurn = raw.totalSpend ? +(raw.totalSpend / 30).toFixed(2) : null;
      const factsForAI: FactsForAI = {
        window: "30 days",
        totalSpend: raw.totalSpend ?? null,
        totalRevenue: raw.totalRevenue ?? null,
        netSales: raw.netSales ?? null,
        customers: raw.customers ?? null,
        cac: raw.cac ?? null,
        ltvAssumed: raw.ltvAssumed ?? null,
        ltvCac: raw.ltvCac ?? null,
        mer: raw.mer ?? null,
        roas: raw.roas ?? null,
        dailyBurn,
        channelsConnected: raw.channels
          ? Object.entries(raw.channels)
              .filter(([, v]) => v?.connected)
              .map(([k]) => k)
          : [],
      };
      if (!alive) return;
      setFacts(factsForAI);

      const br = await apiPost<{ ok: boolean; brief?: Brief }>("/api/officer/brief", {
        role: "finance",
        facts: factsForAI,
      });
      if (!alive) return;
      if (br.ok) setBrief(br.brief ?? null);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ltvCacTone: "good" | "bad" | "" =
    !facts || facts.ltvCac == null
      ? ""
      : facts.ltvCac >= 3
        ? "good"
        : facts.ltvCac < 1
          ? "bad"
          : "";
  const merTone: "good" | "bad" | "" =
    !facts || facts.mer == null ? "" : facts.mer >= 200 ? "good" : facts.mer < 100 ? "bad" : "";

  return (
    <div>
      <div
        style={styleObj(
          "max-width:1200px;margin:0 auto 22px;padding:24px 28px;color:white;border-radius:18px;background:linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        )}
      >
        <div
          style={{
            fontSize: ".72rem",
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#0f766e",
            fontWeight: 700,
          }}
        >
          💼 FINANCE OFFICER
        </div>
        <h1 style={{ margin: "8px 0 6px", fontSize: "1.85rem", fontWeight: 800 }}>
          Marketing P&amp;L, Live
        </h1>
        <p style={{ margin: 0, fontSize: ".92rem", color: "#0f766e", maxWidth: 720 }}>
          Spend, revenue, CAC, LTV/CAC and ROAS — pulled from your connected ad accounts and
          CRM in real time. Re-runs the AI brief on every load.
        </p>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
        {loading || !facts ? (
          <div style={styleObj(CARD + ";text-align:center;color:#64748B")}>
            ⏳ Pulling 30-day finance snapshot…
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
              <Kpi label="Spend (30d)" val={money(facts.totalSpend)} />
              <Kpi label="Revenue (30d)" val={money(facts.totalRevenue)} />
              <Kpi label="Net Sales" val={money(facts.netSales)} sub="Revenue − Spend" />
              <Kpi label="Customers" val={fmt(facts.customers)} />
              <Kpi label="CAC" val={money(facts.cac)} />
              <Kpi
                label="LTV / CAC"
                val={facts.ltvCac != null ? facts.ltvCac + "×" : "—"}
                sub={facts.ltvAssumed ? `LTV assumed $${facts.ltvAssumed}` : ""}
                tone={ltvCacTone}
              />
              <Kpi
                label="MER"
                val={facts.mer != null ? facts.mer + "%" : "—"}
                tone={merTone}
              />
              <Kpi label="Daily Burn" val={money(facts.dailyBurn)} />
            </div>
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
                    Executive Summary
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
                AI brief unavailable. Showing live numbers above.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
