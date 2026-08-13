"use client";

/**
 * Contribution system of record — platform ROAS beside causal iROAS / MMM.
 * Budget recommendations ranked by incremental impact, never by claimed ROAS alone.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";

type Kind = "measured" | "modelled" | "projected" | string;

type Labelled = {
  key?: string;
  label?: string;
  value: number | null;
  unit?: string;
  kind?: Kind;
  confidence?: number | null;
  evidence?: string | null;
};

type ChannelRow = {
  channel: string;
  spend: number;
  platform: { revenue: Labelled; roas: Labelled };
  causal: { revenue: Labelled; iroas: Labelled; source: string; confidence: number };
  mmm: { model: string; r2: number | null; n: number; marginal_roas: number | null };
  holdout: { test_id: number; name: string; lift_pct: number | null; iroas: number | null } | null;
  overstatement_factor: number | null;
};

type Rec = {
  from?: string | null;
  to?: string | null;
  amount: number;
  why: string;
  expected_incremental_revenue?: number;
  kind?: Kind;
  action?: string;
  confidence?: number;
};

type RecordResp = {
  ok?: boolean;
  error?: string;
  definition_version?: string;
  summary?: {
    platform?: { spend?: Labelled; revenue?: Labelled; roas?: Labelled; true_roas?: Labelled };
    causal?: { incremental_revenue?: Labelled; iroas?: Labelled };
    overstatement_factor?: number | null;
    holdout_tests_used?: number;
    note?: string;
  };
  channels?: ChannelRow[];
  budget_recommendations?: Rec[];
  method?: Record<string, string>;
};

function fmt(v: number | null | undefined, unit = "") {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  if (unit === "$") return "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (unit === "x") return `${v}x`;
  if (unit === "%") return `${v}%`;
  return String(v);
}

function KindChip({ kind }: { kind?: Kind }) {
  const color =
    kind === "measured" ? "#065F46" : kind === "projected" ? "#1D4ED8" : "#9A3412";
  const bg =
    kind === "measured" ? "#ECFDF5" : kind === "projected" ? "#EFF6FF" : "#FFF7ED";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color,
        background: bg,
        border: `1px solid ${color}33`,
        borderRadius: 999,
        padding: "2px 8px",
      }}
    >
      {kind || "unknown"}
    </span>
  );
}

export default function ContributionRecord({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<RecordResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await apiGet<RecordResp>(`/api/metrics/contribution?days=${days}`);
    if (!r || r.error || r.ok === false) {
      setError(r?.error || "Failed to load contribution record");
      setLoading(false);
      return;
    }
    setData(r);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;

  return (
    <div
      style={{
        minHeight: embedded ? "auto" : "100vh",
        background: embedded ? "transparent" : "linear-gradient(180deg,#FFF7ED 0%,#F8FAFC 42%)",
        padding: embedded ? "8px 24px 32px" : "28px 32px",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}>
          {!embedded ? (
            <div>
              <div style={{ fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0b5f59" }}>
                System of record · pain #1
              </div>
              <h1 style={{ margin: "6px 0 6px", fontSize: "1.6rem", color: "#0F172A" }}>Contribution & incrementality</h1>
              <p style={{ margin: 0, color: "#64748B", maxWidth: 620, lineHeight: 1.5 }}>
                Platform-reported ROAS beside causal iROAS (holdouts + live MMM-lite). Budget moves are ranked by
                incremental impact — never by claimed conversions alone.
              </p>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0b5f59", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Contribution record
              </div>
              <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: 13 }}>
                Causal estimates rank budget. Platform figures are shown beside, not above.
              </p>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[7, 30, 60].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: days === d ? "2px solid #0b5f59" : "1px solid var(--border)",
                  background: days === d ? "#fff" : "var(--bg-elevated)",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {d}d
              </button>
            ))}
            <button type="button" className="btn-primary" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ padding: 12, borderRadius: 10, background: "#FEF2F2", color: "#991B1B", marginBottom: 14 }}>{error}</div>
        ) : null}

        {s ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {[
              { label: "Platform ROAS", v: s.platform?.roas, accent: "#0F766E" },
              { label: "Causal iROAS", v: s.causal?.iroas, accent: "#0b5f59" },
              { label: "True ROAS", v: s.platform?.true_roas, accent: "#334155" },
              {
                label: "Overstatement",
                v: {
                  value: s.overstatement_factor ?? null,
                  unit: "x",
                  kind: "modelled" as Kind,
                },
                accent: "#DC2626",
              },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: "14px 16px",
                  background: "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#64748B", textTransform: "uppercase" }}>{card.label}</div>
                  <KindChip kind={card.v?.kind} />
                </div>
                <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800, color: card.accent }}>
                  {fmt(card.v?.value, card.v?.unit || "x")}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {s?.note ? (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #FDBA74",
              background: "#FFFBEB",
              color: "#9A3412",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {s.note}
            {data?.definition_version ? (
              <span style={{ color: "#78716C" }}> · defs {data.definition_version}</span>
            ) : null}
            {typeof s.holdout_tests_used === "number" ? (
              <span style={{ color: "#78716C" }}> · {s.holdout_tests_used} holdout channel(s)</span>
            ) : null}
          </div>
        ) : null}

        {(data?.budget_recommendations || []).length ? (
          <section style={{ marginBottom: 18 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>Budget moves ranked by causal impact</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {data!.budget_recommendations!.map((rec, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "12px 14px",
                    background: "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ color: "#0F172A" }}>
                      {rec.action === "reduce" ? "Reduce" : "Shift"} {fmt(rec.amount, "$")}
                      {rec.from ? ` from ${rec.from}` : ""}
                      {rec.to ? ` → ${rec.to}` : ""}
                    </strong>
                    <KindChip kind={rec.kind || "projected"} />
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, color: "#475569", lineHeight: 1.45 }}>{rec.why}</div>
                  {rec.expected_incremental_revenue != null ? (
                    <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#065F46" }}>
                      Expected incremental revenue: {fmt(rec.expected_incremental_revenue, "$")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>Channels — platform vs causal</h2>
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#F8FAFC", color: "#64748B" }}>
                  {["Channel", "Spend", "Platform ROAS", "Causal iROAS", "Source", "Overstatement", "MMM fit"].map((h) => (
                    <th key={h} style={{ padding: "10px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.channels || []).map((row) => (
                  <tr key={row.channel} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 700 }}>{row.channel}</td>
                    <td style={{ padding: "10px 12px" }}>{fmt(row.spend, "$")}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {fmt(row.platform.roas?.value, "x")}{" "}
                      <KindChip kind={row.platform.roas?.kind || "measured"} />
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0b5f59" }}>
                      {fmt(row.causal.iroas?.value, "x")}{" "}
                      <KindChip kind={row.causal.iroas?.kind || "modelled"} />
                    </td>
                    <td style={{ padding: "10px 12px", color: "#64748B" }}>{row.causal.source}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {row.overstatement_factor != null ? `${row.overstatement_factor}×` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#64748B" }}>
                      {row.mmm.model}
                      {row.mmm.r2 != null ? ` · R² ${row.mmm.r2}` : ""}
                      {row.holdout ? ` · holdout ${row.holdout.iroas}x` : ""}
                    </td>
                  </tr>
                ))}
                {!loading && !(data?.channels || []).length ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 16, color: "#64748B" }}>
                      No channel spend yet. Ingest ad performance or log a holdout test under iROAS.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            { view: "canonical-metrics", label: "Canonical metrics SSOT" },
            { view: "iroas", label: "iROAS holdout tests" },
            { view: "mmm", label: "MMM scenarios" },
            { view: "true-roas", label: "True ROAS offline" },
            { view: "ask-infogenie", label: "Ask InfoGenie" },
          ].map((l) => (
            <button
              key={l.view}
              type="button"
              onClick={() => goToView(router, l.view)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
