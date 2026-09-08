"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { apiGet, type ApiResult } from "@/lib/api";
import {
  buildAgencyOpsQuery,
  dataUnavailableMessage,
  formatHours,
  formatMoney,
  formatPercent,
  monthStartIso,
  pricingCompleteness,
  isDataUnavailable,
  scopeStatusLabel,
  todayIso,
} from "@/lib/agencyOpsDashboard";

type Period = { from: string; to: string };
type SummaryTotals = {
  time_entries?: number;
  hours?: number;
  billable_hours?: number;
  non_billable_hours?: number;
  cost_value?: number;
  billable_value?: number;
  margin_value?: number;
  margin_pct?: number | null;
  unpriced_hours?: number;
  contracted_value?: number;
  scope_overage_hours?: number;
  currency?: string | null;
};
type ClientSummary = {
  client_ref?: string;
  hours?: number;
  billable_hours?: number;
  cost_value?: number;
  billable_value?: number;
  margin_value?: number;
  margin_pct?: number | null;
  unpriced_hours?: number;
  contracted_value?: number;
  scope_overage_hours?: number;
  currency?: string | null;
};
type ScopeSignal = {
  id?: string;
  client_ref?: string;
  project_ref?: string | null;
  name?: string;
  period_start?: string;
  period_end?: string;
  actual_hours?: number;
  allowed_hours?: number;
  overage_hours?: number;
  utilization_pct?: number | null;
  status?: string;
  severity?: string | null;
};
type SummaryResponse = ApiResult & {
  period?: Period;
  totals?: SummaryTotals;
  clients?: ClientSummary[];
  scope_signals?: ScopeSignal[];
};
type ScopeResponse = ApiResult & {
  period?: Period;
  signals?: ScopeSignal[];
};
type CapacityTotals = {
  members?: number;
  weekly_hours?: number;
  allocated_hours?: number;
  remaining_hours?: number;
  utilization_pct?: number | null;
  logged_hours?: number;
  logged_utilization_pct?: number | null;
  overloaded?: number;
  at_capacity?: number;
  available?: number;
  open_agent_tasks?: number;
};
type CapacityResponse = ApiResult & { totals?: CapacityTotals };

const cardStyle: CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: 14,
  padding: 16,
};

const buttonStyle: CSSProperties = {
  border: 0,
  borderRadius: 8,
  padding: "9px 14px",
  background: "#0F766E",
  color: "#FFFFFF",
  fontWeight: 700,
  cursor: "pointer",
};

function Failure({ message }: { message: string }) {
  return (
    <div role="alert" style={{ color: "#991B1B", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: 12 }}>
      Data unavailable: {message}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ color: "#64748B", padding: "18px 4px" }}>{children}</div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ color: "#64748B", fontSize: ".72rem", fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: "#0F172A", fontSize: "1.45rem", fontWeight: 800, marginTop: 6 }}>{value}</div>
      {detail ? <div style={{ color: "#64748B", fontSize: ".8rem", marginTop: 5 }}>{detail}</div> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={cardStyle} aria-labelledby={title.replace(/\s+/g, "-").toLowerCase()}>
      <h2 id={title.replace(/\s+/g, "-").toLowerCase()} style={{ color: "#0F172A", fontSize: "1rem", margin: "0 0 10px" }}>{title}</h2>
      {children}
    </section>
  );
}

function statusStyle(status: unknown): CSSProperties {
  if (status === "over_scope") return { color: "#991B1B", background: "#FEF2F2" };
  if (status === "change_budget_used") return { color: "#92400E", background: "#FFFBEB" };
  if (status === "within_scope") return { color: "#065F46", background: "#ECFDF5" };
  return { color: "#475569", background: "#F1F5F9" };
}

export default function AgencyOpsDashboard() {
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(todayIso);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [scope, setScope] = useState<ScopeResponse | null>(null);
  const [capacity, setCapacity] = useState<CapacityResponse | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const query = buildAgencyOpsQuery(from, to);
    const [summaryResult, scopeResult, capacityResult] = await Promise.all([
      apiGet<SummaryResponse>("/api/agency-ops/summary" + query),
      apiGet<ScopeResponse>("/api/agency-ops/scope-signals" + query),
      apiGet<CapacityResponse>("/api/capacity/summary?read_only=true"),
    ]);
    const summaryUnavailable = isDataUnavailable(summaryResult);
    const scopeUnavailable = isDataUnavailable(scopeResult);
    const capacityUnavailable = isDataUnavailable(capacityResult);
    if (requestId !== requestIdRef.current) return;
    setSummary(summaryResult.ok && !summaryUnavailable ? summaryResult : null);
    setScope(scopeResult.ok && !scopeUnavailable ? scopeResult : null);
    setCapacity(capacityResult.ok && !capacityUnavailable ? capacityResult : null);
    setSummaryError(
      summaryUnavailable
        ? dataUnavailableMessage(summaryResult)
        : summaryResult.ok ? null : summaryResult.error || "summary request failed",
    );
    setScopeError(
      scopeUnavailable
        ? dataUnavailableMessage(scopeResult)
        : scopeResult.ok ? null : scopeResult.error || "scope-signal request failed",
    );
    setCapacityError(
      capacityUnavailable
        ? dataUnavailableMessage(capacityResult)
        : capacityResult.ok ? null : capacityResult.error || "capacity request failed",
    );
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totals = summary?.totals;
  const currency = totals?.currency || null;
  const signals = scope?.signals || [];
  const clients = summary?.clients || [];
  const pricing = useMemo(
    () => pricingCompleteness(totals?.hours, totals?.unpriced_hours),
    [totals?.hours, totals?.unpriced_hours],
  );

  return (
    <main style={{ minHeight: "100%", background: "#F8FAFC", padding: "28px 24px", color: "#0F172A" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap", marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Agency Operations Dashboard</h1>
            <p style={{ margin: "7px 0 0", color: "#64748B", maxWidth: 700 }}>
              A read-only view of delivery time, margin health, pricing completeness, scope exposure, and team capacity.
            </p>
          </div>
          <form
            onSubmit={(event) => { event.preventDefault(); void refresh(); }}
            style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}
            aria-label="Reporting period"
          >
            <label style={{ display: "grid", gap: 4, color: "#475569", fontSize: ".78rem", fontWeight: 700 }}>
              From
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 9px" }} />
            </label>
            <label style={{ display: "grid", gap: 4, color: "#475569", fontSize: ".78rem", fontWeight: 700 }}>
              To
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 9px" }} />
            </label>
            <button type="submit" style={buttonStyle} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          </form>
        </header>

        <div role="status" aria-live="polite" aria-busy={loading} style={{ minHeight: 24, marginBottom: 12, color: "#64748B", fontSize: ".88rem" }}>
          {loading ? "Loading Agency Operations data…" : `Selected period: ${from} to ${to}`}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
          <Metric label="Logged time" value={formatHours(totals?.hours)} detail={`${totals?.time_entries ?? "Unavailable"} entries in selected period`} />
          <Metric label="Billable time" value={formatHours(totals?.billable_hours)} />
          <Metric label="Margin" value={formatMoney(totals?.margin_value, currency)} detail={formatPercent(totals?.margin_pct)} />
          <Metric label="Billable value" value={formatMoney(totals?.billable_value, currency)} />
          <Metric label="Pricing completeness" value={formatPercent(pricing)} detail={`${formatHours(totals?.unpriced_hours)} without an effective rate`} />
          <Metric label="Scope overage" value={formatHours(totals?.scope_overage_hours)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 16 }}>
          <Panel title="Financial and pricing context">
            {summaryError ? <Failure message={summaryError} /> : !summary ? <Empty>No summary data is available for this period.</Empty> : (
              <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px 16px", margin: 0, fontSize: ".9rem" }}>
                <dt>Cost value</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatMoney(totals?.cost_value, currency)}</dd>
                <dt>Contracted value</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatMoney(totals?.contracted_value, currency)}</dd>
                <dt>Non-billable time</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatHours(totals?.non_billable_hours)}</dd>
                <dt>Reporting currency</dt><dd style={{ margin: 0, fontWeight: 700 }}>{currency || "Unavailable"}</dd>
              </dl>
            )}
          </Panel>

          <Panel title="Capacity this week">
            {capacityError ? <Failure message={capacityError} /> : !capacity ? <Empty>Capacity data is unavailable.</Empty> : (
              <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px 16px", margin: 0, fontSize: ".9rem" }}>
                <dt>Team members</dt><dd style={{ margin: 0, fontWeight: 700 }}>{capacity.totals?.members ?? "Unavailable"}</dd>
                <dt>Weekly capacity</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatHours(capacity.totals?.weekly_hours)}</dd>
                <dt>Allocated</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatHours(capacity.totals?.allocated_hours)}</dd>
                <dt>Logged this week</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatHours(capacity.totals?.logged_hours)}</dd>
                <dt>Utilization</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatPercent(capacity.totals?.utilization_pct)}</dd>
                <dt>Open tasks</dt><dd style={{ margin: 0, fontWeight: 700 }}>{capacity.totals?.open_agent_tasks ?? "Unavailable"}</dd>
              </dl>
            )}
          </Panel>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Panel title="Scope signals">
            {scopeError ? <Failure message={scopeError} /> : signals.length === 0 ? <Empty>No active scope baselines overlap the selected period.</Empty> : (
              <div style={{ display: "grid", gap: 9 }}>
                {signals.map((signal, index) => (
                  <div key={signal.id || `${signal.client_ref || "signal"}-${index}`} style={{ borderTop: index ? "1px solid #E2E8F0" : 0, paddingTop: index ? 9 : 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <strong>{signal.name || signal.client_ref || "Unnamed baseline"}</strong>
                      <span style={{ ...statusStyle(signal.status), borderRadius: 999, padding: "4px 8px", fontSize: ".72rem", fontWeight: 800, whiteSpace: "nowrap" }}>{scopeStatusLabel(signal.status)}</span>
                    </div>
                    <div style={{ color: "#64748B", fontSize: ".82rem", marginTop: 5 }}>
                      {signal.client_ref || "Client unavailable"} · {formatHours(signal.actual_hours)} used of {formatHours(signal.allowed_hours)} allowed · {formatPercent(signal.utilization_pct)}
                    </div>
                    {signal.overage_hours && signal.overage_hours > 0 ? <div style={{ color: "#991B1B", fontSize: ".8rem", marginTop: 4 }}>{formatHours(signal.overage_hours)} over allowed hours</div> : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Client margin detail">
            {summaryError ? <Failure message={summaryError} /> : clients.length === 0 ? <Empty>No client-level summary data is available for this period.</Empty> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                  <thead><tr style={{ textAlign: "left", color: "#64748B" }}><th style={tableHead}>Client</th><th style={tableHead}>Hours</th><th style={tableHead}>Margin</th><th style={tableHead}>Pricing</th></tr></thead>
                  <tbody>
                    {clients.map((client, index) => (
                      <tr key={client.client_ref || `client-${index}`} style={{ borderTop: "1px solid #E2E8F0" }}>
                        <td style={tableCell}>{client.client_ref || "Unavailable"}</td>
                        <td style={tableCell}>{formatHours(client.hours)}</td>
                        <td style={tableCell}>{formatMoney(client.margin_value, client.currency || currency)} <span style={{ color: "#64748B" }}>({formatPercent(client.margin_pct)})</span></td>
                        <td style={tableCell}>{client.unpriced_hours === undefined ? "Unavailable" : formatHours(Math.max(0, Number(client.hours || 0) - Number(client.unpriced_hours || 0))) + " complete"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}

const tableHead: CSSProperties = { padding: "8px 6px", fontSize: ".7rem", textTransform: "uppercase" };
const tableCell: CSSProperties = { padding: "9px 6px", color: "#0F172A", verticalAlign: "top" };
