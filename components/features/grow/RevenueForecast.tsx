"use client";

// Native React port of the legacy `revenue-forecast` panel (was
// `window.buildRevenueforecast` in public/js/ig_advanced_features.js +
// `#view-revenue-forecast` in index.html). Models best / expected / worst case
// revenue against the existing Express API
// (`POST /api/revenue-forecast/simulate` and `GET /api/revenue-forecast/history`)
// via `lib/api`.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface CaseResult {
  revenue?: number;
  leads?: number;
  customers?: number;
  cac?: number;
  roas?: number;
  notes?: string;
}
interface MonthlyRow {
  month: string;
  leads?: number;
  revenue_best?: number;
  revenue_expected?: number;
  revenue_worst?: number;
}
interface ForecastResults {
  best_case?: CaseResult;
  expected_case?: CaseResult;
  worst_case?: CaseResult;
  payback_months?: number | string;
  ltv_cac_ratio?: number | string;
  recommendation?: string;
  key_assumptions?: string[];
  risk_factors?: string[];
  monthly_breakdown?: MonthlyRow[];
}
interface SimResponse {
  ok: boolean;
  error?: string;
  results?: ForecastResults;
  inputs?: { currency?: string };
}
interface SavedForecast {
  scenario_name: string;
  created_at: string;
  results?: ForecastResults;
  inputs?: { currency?: string };
}
interface HistoryResponse {
  ok: boolean;
  forecasts?: SavedForecast[];
}

function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

function renderResult(results: ForecastResults, currency: string): string {
  const r = results || {};
  const cur = currency || "";
  const cases: { key: keyof ForecastResults; label: string; col: string }[] = [
    { key: "best_case", label: "Best Case 🚀", col: "#10b981" },
    { key: "expected_case", label: "Expected 📊", col: "#3b82f6" },
    { key: "worst_case", label: "Worst Case ⚠️", col: "#f59e0b" },
  ];
  return `
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:24px">
  ${cases
    .map((c) => {
      const v = (r[c.key] as CaseResult) || {};
      return `<div class="ig-card" style="border-top:3px solid ${c.col}">
      <div style="font-weight:600;margin-bottom:12px">${c.label}</div>
      <div style="font-size:1.6rem;font-weight:800;color:${c.col}">${cur} ${(v.revenue || 0).toLocaleString()}</div>
      <div style="font-size:.8rem;color:#6b7280;margin-top:4px">Revenue / 90 days</div>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px;font-size:.85rem">
        <span>👥 ${(v.leads || 0).toLocaleString()} leads</span>
        <span>🤝 ${(v.customers || 0).toLocaleString()} customers</span>
        <span>📉 CAC: ${cur} ${(v.cac || 0).toLocaleString()}</span>
        <span>📈 ROAS: ${v.roas || 0}x</span>
      </div>
      ${v.notes ? `<div style="font-size:.75rem;color:#6b7280;margin-top:8px;border-top:1px solid #f3f4f6;padding-top:8px">${esc(v.notes)}</div>` : ""}
    </div>`;
    })
    .join("")}
</div>
<div class="ig-card" style="margin-bottom:16px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div><div style="font-size:.75rem;color:#6b7280">PAYBACK PERIOD</div><div style="font-size:1.3rem;font-weight:700">${r.payback_months || "?"} months</div></div>
    <div><div style="font-size:.75rem;color:#6b7280">LTV/CAC RATIO</div><div style="font-size:1.3rem;font-weight:700">${r.ltv_cac_ratio || "?"}x</div></div>
  </div>
  <div style="background:#eff6ff;border-radius:8px;padding:12px;margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:4px">📋 RECOMMENDATION</div>
    <div style="color:#374151">${esc(r.recommendation || "")}</div>
  </div>
  ${r.key_assumptions?.length ? `<div><div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">KEY ASSUMPTIONS</div><ul style="margin:0;padding-left:20px;font-size:.85rem;color:#374151">${r.key_assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
  ${r.risk_factors?.length ? `<div style="margin-top:12px"><div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">RISK FACTORS</div><ul style="margin:0;padding-left:20px;font-size:.85rem;color:#ef4444">${r.risk_factors.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
</div>
${
  r.monthly_breakdown?.length
    ? `
<div class="ig-card">
  <div style="font-weight:600;margin-bottom:12px">Monthly Breakdown</div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem">
    <thead><tr style="background:#f9fafb">${["Month", "Leads", "Best", "Expected", "Worst"].map((h) => `<th style="padding:8px 12px;text-align:left;font-weight:600;color:#6b7280">${h}</th>`).join("")}</tr></thead>
    <tbody>${r.monthly_breakdown
      .map(
        (m) => `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 12px;font-weight:600">${esc(m.month)}</td>
      <td style="padding:8px 12px">${(m.leads || 0).toLocaleString()}</td>
      <td style="padding:8px 12px;color:#10b981;font-weight:600">${cur} ${(m.revenue_best || 0).toLocaleString()}</td>
      <td style="padding:8px 12px;color:#3b82f6;font-weight:600">${cur} ${(m.revenue_expected || 0).toLocaleString()}</td>
      <td style="padding:8px 12px;color:#f59e0b;font-weight:600">${cur} ${(m.revenue_worst || 0).toLocaleString()}</td>
    </tr>`,
      )
      .join("")}</tbody>
  </table></div>
</div>`
    : ""
}`;
}

export default function RevenueForecast() {
  const [form, setForm] = useState({
    name: "Budget Increase Scenario",
    spend: "10000",
    change: "5000",
    leads: "200",
    cvr: "3",
    aov: "500",
    cac: "250",
    ltv: "1500",
    currency: "USD",
  });
  const [running, setRunning] = useState(false);
  const [resultHtml, setResultHtml] = useState("");
  const [forecasts, setForecasts] = useState<SavedForecast[]>([]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function loadHistory() {
    const d = await apiGet<HistoryResponse>("/api/revenue-forecast/history");
    if (d.ok && d.forecasts?.length) setForecasts(d.forecasts);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function run() {
    setRunning(true);
    const body = {
      scenario_name: form.name,
      current_monthly_spend: +form.spend || 10000,
      budget_change: +form.change || 5000,
      current_leads: +form.leads || 200,
      conversion_rate: +form.cvr || 3,
      aov: +form.aov || 500,
      cac: +form.cac || 250,
      ltv: +form.ltv || 1500,
      currency: form.currency,
    };
    const d = await apiPost<SimResponse>(
      "/api/revenue-forecast/simulate",
      body,
    );
    setRunning(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResultHtml(renderResult(d.results || {}, d.inputs?.currency || ""));
    loadHistory();
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Revenue Forecast
              </div>
              <h2 className="view-title">💹 AI Revenue Forecast Engine</h2>
              <p className="view-sub">
                Model best / expected / worst case revenue outcomes for any
                budget or strategy change.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
        <div
          className="ig-card"
          style={{ maxWidth: 720, marginBottom: 24 }}
        >
          <div
            className="form-grid"
            style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
          >
            <div className="form-group">
              <label>Scenario Name</label>
              <input
                className="form-control"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Current Monthly Ad Spend</label>
              <input
                className="form-control"
                type="number"
                value={form.spend}
                onChange={(e) => set("spend", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Budget Change (+/-)</label>
              <input
                className="form-control"
                type="number"
                placeholder="+5000 or -2000"
                value={form.change}
                onChange={(e) => set("change", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Current Monthly Leads</label>
              <input
                className="form-control"
                type="number"
                value={form.leads}
                onChange={(e) => set("leads", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Conversion Rate (%)</label>
              <input
                className="form-control"
                type="number"
                step="0.1"
                value={form.cvr}
                onChange={(e) => set("cvr", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Average Order Value</label>
              <input
                className="form-control"
                type="number"
                value={form.aov}
                onChange={(e) => set("aov", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Current CAC</label>
              <input
                className="form-control"
                type="number"
                value={form.cac}
                onChange={(e) => set("cac", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Customer LTV</label>
              <input
                className="form-control"
                type="number"
                value={form.ltv}
                onChange={(e) => set("ltv", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Currency</label>
              <select
                className="form-control"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
              >
                <option>USD</option>
                <option>EUR</option>
                <option>GBP</option>
                <option>ZAR</option>
                <option>AUD</option>
              </select>
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={running}
            onClick={run}
          >
            {running ? "Modelling scenarios…" : "📊 Run Forecast"}
          </button>
        </div>

        <div dangerouslySetInnerHTML={{ __html: resultHtml }} />

        {forecasts.length > 0 && (
          <>
            <h3
              style={{
                fontSize: ".9rem",
                fontWeight: 600,
                color: "#6b7280",
                margin: "16px 0 8px",
              }}
            >
              Saved Scenarios
            </h3>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {forecasts.map((f, i) => (
                <div
                  key={i}
                  className="ig-card"
                  style={{ padding: 12, cursor: "pointer" }}
                  onClick={() =>
                    setResultHtml(
                      renderResult(
                        f.results || {},
                        f.inputs?.currency || "",
                      ),
                    )
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {f.scenario_name}
                    </span>
                    <span style={{ color: "#6b7280", fontSize: ".8rem" }}>
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: ".85rem",
                      color: "#10b981",
                      marginTop: 4,
                    }}
                  >
                    Expected: {f.inputs?.currency || ""}{" "}
                    {(
                      f.results?.expected_case?.revenue || 0
                    ).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
