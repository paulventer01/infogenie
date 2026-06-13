"use client";

// Native React port of the legacy `investor-mode` panel (was
// `window.buildInvestormode` in public/js/ig_advanced_features.js +
// `#view-investor-mode`). Generates an investor report with a shareable
// read-only portal link and lists recent reports, against the existing Express
// API (`POST /api/investor-mode/generate`, `GET /api/investor-mode/history`).

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Metric {
  label?: string;
  value?: string;
  change?: string;
  trend?: string;
}
interface Report {
  executive_summary?: string;
  headline_metrics?: Metric[];
  highlights?: string[];
  challenges?: string[];
  ask?: string;
}
interface GenResult {
  ok: boolean;
  error?: string;
  company_name?: string;
  portal_token?: string;
  report?: Report;
}
interface HistReport {
  content?: { company_name?: string };
  portal_token?: string;
  created_at: string;
}
interface HistResult {
  ok: boolean;
  reports?: HistReport[];
}

const STAGES = ["pre-seed", "seed", "series-a", "series-b", "growth"];
const CURRENCIES = ["USD", "EUR", "GBP", "ZAR"];

export default function InvestorMode() {
  const [origin, setOrigin] = useState("");
  const [company, setCompany] = useState("");
  const [stage, setStage] = useState(STAGES[0]);
  const [mrr, setMrr] = useState("");
  const [arr, setArr] = useState("");
  const [growth, setGrowth] = useState("");
  const [cac, setCac] = useState("");
  const [ltv, setLtv] = useState("");
  const [burn, setBurn] = useState("");
  const [runway, setRunway] = useState("");
  const [customers, setCustomers] = useState("");
  const [currency, setCurrency] = useState(CURRENCIES[0]);
  const [highlights, setHighlights] = useState("");
  const [challenges, setChallenges] = useState("");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [history, setHistory] = useState<HistReport[]>([]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function loadHistory() {
    const d = await apiGet<HistResult>("/api/investor-mode/history");
    if (d.ok && d.reports) setHistory(d.reports);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function generate() {
    const co = company.trim();
    if (!co) {
      alert("Enter company name.");
      return;
    }
    setRunning(true);
    const d = await apiPost<GenResult>("/api/investor-mode/generate", {
      company_name: co,
      stage,
      mrr: +mrr || 0,
      arr: +arr || 0,
      growth_rate: +growth || 0,
      cac: +cac || 0,
      ltv: +ltv || 0,
      burn_rate: +burn || 0,
      runway_months: +runway || 12,
      paying_customers: +customers || 0,
      currency,
      highlights: highlights.split("\n").filter(Boolean),
      challenges: challenges.split("\n").filter(Boolean),
    });
    setRunning(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResult(d);
    loadHistory();
  }

  function renderResult() {
    if (!result) return null;
    const r = result.report || {};
    const portalUrl = origin + "/investor/" + (result.portal_token || "");
    return (
      <div className="ig-card" style={{ borderTop: "3px solid #10b981", marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>
              {result.company_name || ""} — Investor Report
            </div>
            <div style={{ color: "#6b7280", marginTop: 2 }}>{r.executive_summary || ""}</div>
          </div>
          <div>
            <div style={{ fontSize: ".75rem", color: "#6b7280", marginBottom: 4 }}>
              🔗 INVESTOR PORTAL LINK (read-only)
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="form-control"
                style={{ fontSize: ".8rem", width: 320 }}
                readOnly
                value={portalUrl}
              />
              <button
                className="btn btn-sm btn-outline"
                onClick={() => navigator.clipboard.writeText(portalUrl)}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          {(r.headline_metrics || []).map((m, i) => {
            const col = m.trend === "up" ? "#10b981" : m.trend === "down" ? "#ef4444" : "#6b7280";
            const arrow = m.trend === "up" ? "↑" : m.trend === "down" ? "↓" : "";
            return (
              <div key={i} style={{ background: "#f9fafb", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: ".7rem", color: "#6b7280", textTransform: "uppercase" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, color: col }}>
                  {arrow} {m.value}
                </div>
                {m.change && (
                  <div style={{ fontSize: ".75rem", color: "#6b7280" }}>{m.change}</div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#10b981", marginBottom: 6 }}>
              ✅ HIGHLIGHTS
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: ".85rem" }}>
              {(r.highlights || []).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
          <div>
            <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>
              ⚠️ CHALLENGES
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: ".85rem" }}>
              {(r.challenges || []).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        </div>
        {r.ask && (
          <div style={{ background: "#eff6ff", borderRadius: 8, padding: 12, marginTop: 16 }}>
            <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#3b82f6", marginBottom: 4 }}>
              THE ASK
            </div>
            <div>{r.ask}</div>
          </div>
        )}
      </div>
    );
  }

  function field(label: string, value: string, set: (v: string) => void, type = "text", placeholder = "") {
    return (
      <div className="form-group">
        <label>{label}</label>
        <input
          className="form-control"
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="view-header">
        <h2>📈 Investor Mode</h2>
        <p className="view-sub">
          Auto-generate investor reports with revenue forecasts, CAC/LTV analysis, and a shareable
          read-only investor portal link.
        </p>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="ig-card" style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Generate Investor Report</h3>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {field("Company Name", company, setCompany, "text", "Acme Inc")}
            <div className="form-group">
              <label>Stage</label>
              <select className="form-control" value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {field("MRR", mrr, setMrr, "number", "50000")}
            {field("ARR", arr, setArr, "number", "600000")}
            {field("MoM Growth Rate (%)", growth, setGrowth, "number", "12")}
            {field("CAC", cac, setCac, "number", "400")}
            {field("LTV", ltv, setLtv, "number", "2400")}
            {field("Burn Rate / Month", burn, setBurn, "number", "30000")}
            {field("Runway (months)", runway, setRunway, "number", "18")}
            {field("Paying Customers", customers, setCustomers, "number", "120")}
            <div className="form-group">
              <label>Currency</label>
              <select
                className="form-control"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Key Highlights (one per line)</label>
            <textarea
              className="form-control"
              rows={3}
              value={highlights}
              placeholder={"Signed 3 enterprise contracts\nLaunched in Germany\nRaised seed round"}
              onChange={(e) => setHighlights(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Current Challenges (one per line)</label>
            <textarea
              className="form-control"
              rows={2}
              value={challenges}
              placeholder={"Sales cycle too long\nChurn in SMB segment"}
              onChange={(e) => setChallenges(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={running}
            onClick={generate}
          >
            {running ? "Generating investor report…" : "📈 Generate Report + Portal Link"}
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          {history.length > 0 && (
            <>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Recent Reports</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((r, i) => {
                  const c = r.content || {};
                  const portalUrl = origin + "/investor/" + (r.portal_token || "");
                  return (
                    <div key={i} className="ig-card" style={{ padding: 12 }}>
                      <div style={{ fontWeight: 600 }}>{c.company_name || "Report"}</div>
                      <div style={{ fontSize: ".8rem", color: "#6b7280", margin: "2px 0" }}>
                        {new Date(r.created_at).toLocaleDateString()}
                      </div>
                      <a
                        href={portalUrl}
                        target="_blank"
                        rel="noopener"
                        style={{ fontSize: ".8rem", color: "#3b82f6" }}
                      >
                        Open investor portal ↗
                      </a>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      <div>{renderResult()}</div>
    </div>
  );
}
