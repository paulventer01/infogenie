"use client";

// Native React port of the legacy `budget-board` panel (was
// `window.buildBudgetBoard` in public/js/ig_manage_pack.js + `#view-budget-board`).
// Sets a monthly target, logs spend and shows per-channel utilisation against the
// existing Express API (`GET /api/budget/summary`, `POST /api/budget/budgets`,
// `POST /api/budget/spend`, `GET /api/budget/spend/recent`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface ChannelBreakdown {
  channel: string;
  allocated_cents?: number;
  spent_cents?: number;
  utilization?: number | null;
}
interface Summary {
  target_cents?: number;
  spent_cents?: number;
  remaining_cents?: number;
  utilization_pct?: number | null;
  by_channel: ChannelBreakdown[];
  projected_month_end_cents?: number;
  expected_spend_cents?: number;
  pace_pct?: number | null;
  pace_status?: string;
  waste_channels?: { channel: string; over_cents: number; utilization?: number | null }[];
}
interface SpendEvent {
  occurred_at?: string;
  channel?: string;
  amount_cents?: number;
  source?: string;
  notes?: string;
}

const CHANNELS = [
  "Meta Ads",
  "Google Ads",
  "TikTok Ads",
  "Email",
  "SMS",
  "WhatsApp",
  "Influencer",
  "SEO",
  "Events",
  "Other",
];

function money(cents: number) {
  return (
    "$" +
    ((cents || 0) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function ymToday() {
  return new Date().toISOString().slice(0, 7);
}

const greenInput: React.CSSProperties = {
  width: "100%",
  padding: 9,
  border: "1px solid #BBF7D0",
  borderRadius: 8,
};

export default function BudgetBoard() {
  const toast = useToast();
  const [month, setMonth] = useState(ymToday());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<SpendEvent[]>([]);

  const [target, setTarget] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [spChannel, setSpChannel] = useState("Meta Ads");
  const [spAmount, setSpAmount] = useState("");
  const [spNotes, setSpNotes] = useState("");

  async function refresh(m: string) {
    const s = await apiGet<Summary & { ok?: boolean }>(
      "/api/budget/summary?month=" + encodeURIComponent(m),
    );
    setSummary({ ...s, by_channel: s.by_channel || [] });
    const er = await apiGet<{ events?: SpendEvent[] }>("/api/budget/spend/recent");
    setRecent(er.events || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await apiGet<Summary & { ok?: boolean }>(
        "/api/budget/summary?month=" + encodeURIComponent(month),
      );
      if (cancelled) return;
      setSummary({ ...s, by_channel: s.by_channel || [] });
      const er = await apiGet<{ events?: SpendEvent[] }>("/api/budget/spend/recent");
      if (cancelled) return;
      setRecent(er.events || []);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function saveBudget() {
    const by_channel: Record<string, number> = {};
    CHANNELS.forEach((c) => {
      const v = +(alloc[c] || 0);
      if (v > 0) by_channel[c] = v * 100;
    });
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/budget/budgets", {
      period_month: month,
      target_cents: (+target || 0) * 100,
      by_channel,
    });
    if (!r.ok) {
      toast("⚠️ " + (r.error || "Failed"));
      return;
    }
    toast("✓ Budget saved");
    refresh(month);
  }

  async function logSpend() {
    const amt = +spAmount;
    if (!amt) {
      toast("⚠️ Amount required");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/budget/spend", {
      channel: spChannel,
      amount_cents: Math.round(amt * 100),
      notes: spNotes,
      source: "manual",
    });
    if (!r.ok) {
      toast("⚠️ " + (r.error || "Failed"));
      return;
    }
    setSpAmount("");
    setSpNotes("");
    toast("✓ Logged");
    refresh(month);
  }

  const remaining = summary?.remaining_cents ?? 0;
  const util = summary?.utilization_pct;
  const pace = summary?.pace_pct;
  const paceStatus = summary?.pace_status || "unknown";
  const paceColor =
    paceStatus === "overspending" || paceStatus === "ahead"
      ? "#DC2626"
      : paceStatus === "on_pace"
        ? "#16A34A"
        : paceStatus === "underspending" || paceStatus === "far_behind"
          ? "#F59E0B"
          : "#64748B";
  const kpis = summary
    ? [
        { label: "Target", val: money(summary.target_cents || 0), color: "#0F172A" },
        { label: "Spent", val: money(summary.spent_cents || 0), color: "#0EA5E9" },
        {
          label: "Remaining",
          val: money(remaining),
          color: remaining < 0 ? "#DC2626" : "#16A34A",
        },
        {
          label: "Utilization",
          val: util == null ? "—" : util + "%",
          color: (util ?? 0) > 100 ? "#DC2626" : (util ?? 0) > 80 ? "#F59E0B" : "#16A34A",
        },
        {
          label: "Pace",
          val: pace == null ? "—" : `${pace}% · ${paceStatus.replace(/_/g, " ")}`,
          color: paceColor,
        },
        {
          label: "Projected month-end",
          val: money(summary.projected_month_end_cents || 0),
          color: (summary.projected_month_end_cents || 0) > (summary.target_cents || 0) ? "#DC2626" : "#0F172A",
        },
      ]
    : [];

  return (
    <div style={{ minHeight: "100vh", background: "#F0FDF4", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#0F172A" }}>💰 Budget Board</h1>
            <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.92rem" }}>
              Set a monthly target, log every dollar spent, see where it&apos;s going.
            </p>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #BBF7D0",
              borderRadius: 8,
              fontWeight: 600,
            }}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          {kpis.map((k) => (
            <div
              key={k.label}
              style={{
                background: "#fff",
                border: "1px solid #BBF7D0",
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div
                style={{
                  fontSize: "0.74rem",
                  color: "#64748B",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {k.label}
              </div>
              <div style={{ fontSize: "1.15rem", fontWeight: 800, color: k.color }}>{k.val}</div>
            </div>
          ))}
        </div>

        {(summary?.waste_channels || []).length > 0 && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              background: "#FEF3C7",
              border: "1px solid #FCD34D",
              borderRadius: 10,
              color: "#92400E",
              fontSize: "0.88rem",
            }}
          >
            <strong>Channel overspend:</strong>{" "}
            {(summary?.waste_channels || [])
              .map((w) => `${w.channel} (+${money(w.over_cents)})`)
              .join(" · ")}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #BBF7D0",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#15803D", fontSize: "1rem" }}>
              Set monthly budget
            </h3>
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#475569",
                marginBottom: 4,
              }}
            >
              Total target (USD)
            </label>
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="5000"
              style={{ ...greenInput, marginBottom: 10 }}
            />
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#475569",
                marginBottom: 4,
              }}
            >
              Allocations by channel (USD, optional)
            </label>
            <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              {CHANNELS.map((c) => (
                <div
                  key={c}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <label style={{ fontSize: "0.78rem", color: "#475569" }}>{c}</label>
                  <input
                    type="number"
                    value={alloc[c] || ""}
                    onChange={(e) => setAlloc((prev) => ({ ...prev, [c]: e.target.value }))}
                    placeholder="0"
                    style={{ padding: 6, border: "1px solid #BBF7D0", borderRadius: 6 }}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={saveBudget}
              style={{
                padding: "9px 18px",
                background: "#16A34A",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Save Budget
            </button>
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #BBF7D0",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#15803D", fontSize: "1rem" }}>Log a spend</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <select
                value={spChannel}
                onChange={(e) => setSpChannel(e.target.value)}
                style={{ padding: 9, border: "1px solid #BBF7D0", borderRadius: 8 }}
              >
                {CHANNELS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                type="number"
                value={spAmount}
                onChange={(e) => setSpAmount(e.target.value)}
                placeholder="Amount USD"
                step="0.01"
                style={{ padding: 9, border: "1px solid #BBF7D0", borderRadius: 8 }}
              />
            </div>
            <input
              value={spNotes}
              onChange={(e) => setSpNotes(e.target.value)}
              placeholder="Notes (optional)"
              style={{ ...greenInput, marginBottom: 10 }}
            />
            <button
              onClick={logSpend}
              style={{
                padding: "9px 18px",
                background: "#0EA5E9",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Log Spend
            </button>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #BBF7D0",
            borderRadius: 12,
            padding: 18,
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: "0 0 12px", color: "#15803D", fontSize: "1rem" }}>
            Spend analysis — by channel
          </h3>
          {summary && summary.by_channel.length === 0 ? (
            <div style={{ color: "#94A3B8", textAlign: "center", padding: 20 }}>
              No spend logged this month yet.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "#64748B",
                    fontSize: "0.78rem",
                    borderBottom: "1px solid #E2E8F0",
                  }}
                >
                  <th style={{ padding: 8 }}>Channel</th>
                  <th style={{ padding: 8 }}>Allocated</th>
                  <th style={{ padding: 8 }}>Spent</th>
                  <th style={{ padding: 8 }}>Utilization</th>
                  <th style={{ padding: 8 }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.by_channel || []).map((b, i) => {
                  const u = b.utilization;
                  const barW = u == null ? 0 : Math.min(100, u);
                  const barColor = (u ?? 0) > 100 ? "#DC2626" : (u ?? 0) > 80 ? "#F59E0B" : "#16A34A";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: 8, fontWeight: 600 }}>{b.channel}</td>
                      <td style={{ padding: 8, color: "#64748B" }}>
                        {money(b.allocated_cents || 0)}
                      </td>
                      <td style={{ padding: 8, fontWeight: 700 }}>{money(b.spent_cents || 0)}</td>
                      <td style={{ padding: 8 }}>{u == null ? "—" : u + "%"}</td>
                      <td style={{ padding: 8, width: 200 }}>
                        <div
                          style={{
                            background: "#F1F5F9",
                            borderRadius: 99,
                            height: 8,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{ height: "100%", width: `${barW}%`, background: barColor }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #BBF7D0",
            borderRadius: 12,
            padding: 18,
          }}
        >
          <h3 style={{ margin: "0 0 12px", color: "#15803D", fontSize: "1rem" }}>
            Recent spend events
          </h3>
          {recent.length === 0 ? (
            <div style={{ color: "#94A3B8", textAlign: "center", padding: 20 }}>
              Nothing logged yet.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "#64748B",
                    fontSize: "0.78rem",
                    borderBottom: "1px solid #E2E8F0",
                  }}
                >
                  <th style={{ padding: 8 }}>Date</th>
                  <th style={{ padding: 8 }}>Channel</th>
                  <th style={{ padding: 8 }}>Amount</th>
                  <th style={{ padding: 8 }}>Source</th>
                  <th style={{ padding: 8 }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 20).map((e, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "6px 8px", color: "#64748B" }}>
                      {(e.occurred_at || "").slice(0, 10)}
                    </td>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{e.channel}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>
                      {money(e.amount_cents || 0)}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#94A3B8", fontSize: "0.84rem" }}>
                      {e.source || ""}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#64748B" }}>{e.notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
