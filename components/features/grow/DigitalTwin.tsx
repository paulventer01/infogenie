"use client";

// Native React port of the legacy `digital-twin` panel (was
// `window.buildDigitaltwin` in public/js/ig_advanced_features.js +
// `#view-digital-twin` in index.html). Runs AI "what if" business simulations
// against the existing Express API (`GET /api/digital-twin/scenarios`,
// `POST /api/digital-twin/simulate`, `GET /api/digital-twin/history`) via
// `lib/api`.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Scenario {
  id: string;
  label: string;
  icon: string;
}
interface ScenariosResponse {
  ok: boolean;
  scenarios: Scenario[];
}
interface TimelineRow {
  period: string;
  what_happens: string;
  metric_impact: string;
}
interface MetricAffected {
  metric: string;
  direction: string;
  estimated_change: string;
}
interface TwinResults {
  confidence?: number;
  scenario_title?: string;
  verdict?: string;
  executive_summary?: string;
  timeline?: TimelineRow[];
  upsides?: string[];
  risks?: string[];
  key_metrics_affected?: MetricAffected[];
  recommended_action?: string;
  alternative_scenarios?: string[];
}
interface SimResponse {
  ok: boolean;
  error?: string;
  question?: string;
  results?: TwinResults;
}
interface SavedSim {
  question: string;
  created_at: string;
  results?: TwinResults;
}
interface HistoryResponse {
  ok: boolean;
  simulations?: SavedSim[];
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
function verdictBadge(v: string): string {
  const map: Record<string, string> = {
    positive: "#10b981",
    negative: "#ef4444",
    neutral: "#6b7280",
    mixed: "#f59e0b",
  };
  const bg = map[v] || "#6b7280";
  return `<span style="background:${bg};color:#fff;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:700;text-transform:uppercase">${esc(v)}</span>`;
}
function scoreRing(val: number, max = 100): string {
  const pct = Math.min(100, Math.max(0, Math.round((val / max) * 100)));
  const col = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return `<div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:conic-gradient(${col} ${pct}%,#e5e7eb 0);font-size:1rem;font-weight:700;color:${col}">${val}</div>`;
}

function renderResult(r: TwinResults, question: string): string {
  return `
<div class="ig-card" style="border-left:4px solid #8b5cf6;margin-bottom:16px">
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">
    ${scoreRing(r.confidence || 65)}
    <div>
      <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase">Simulation Result</div>
      <div style="font-size:1.1rem;font-weight:700">${esc(r.scenario_title || question || "")}</div>
      <div style="margin-top:4px">${verdictBadge(r.verdict || "mixed")}</div>
    </div>
  </div>
  <p style="color:#374151;margin-bottom:16px">${esc(r.executive_summary || "")}</p>

  ${
    r.timeline?.length
      ? `<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">WHAT HAPPENS OVER 90 DAYS</div>
    <div style="display:flex;flex-direction:column;gap:8px">${r.timeline
      .map(
        (t) => `
      <div style="display:flex;gap:12px;padding:10px;background:#faf5ff;border-radius:8px">
        <div style="width:80px;min-width:80px;font-size:.75rem;font-weight:700;color:#8b5cf6;padding-top:2px">${esc(t.period)}</div>
        <div><div style="font-size:.85rem;font-weight:600">${esc(t.what_happens)}</div><div style="font-size:.8rem;color:#6b7280">${esc(t.metric_impact)}</div></div>
      </div>`,
      )
      .join("")}</div>
  </div>`
      : ""
  }

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div><div style="font-size:.75rem;font-weight:600;color:#10b981;margin-bottom:6px">✅ UPSIDES</div><ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${(r.upsides || []).map((u) => `<li>${esc(u)}</li>`).join("")}</ul></div>
    <div><div style="font-size:.75rem;font-weight:600;color:#ef4444;margin-bottom:6px">⚠️ RISKS</div><ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${(r.risks || []).map((u) => `<li>${esc(u)}</li>`).join("")}</ul></div>
  </div>

  ${
    r.key_metrics_affected?.length
      ? `<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">METRICS AFFECTED</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${r.key_metrics_affected
      .map((m) => {
        const col =
          m.direction === "up"
            ? "#10b981"
            : m.direction === "down"
              ? "#ef4444"
              : "#6b7280";
        const arrow =
          m.direction === "up" ? "↑" : m.direction === "down" ? "↓" : "→";
        return `<div style="background:#f9fafb;border-radius:8px;padding:8px 14px;text-align:center"><div style="font-size:.75rem;color:#6b7280">${esc(m.metric)}</div><div style="font-size:1rem;font-weight:700;color:${col}">${arrow} ${esc(m.estimated_change)}</div></div>`;
      })
      .join("")}</div>
  </div>`
      : ""
  }

  <div style="background:#eff6ff;border-radius:8px;padding:12px">
    <div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:4px">⚡ RECOMMENDED ACTION</div>
    <div>${esc(r.recommended_action || "")}</div>
  </div>

  ${
    r.alternative_scenarios?.length
      ? `<div style="margin-top:12px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">EXPLORE NEXT</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${r.alternative_scenarios.map((a) => `<button class="btn btn-sm btn-outline" data-alt="${esc(a)}">${esc(a)}</button>`).join("")}</div>
  </div>`
      : ""
  }
</div>`;
}

export default function DigitalTwin() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeId, setActiveId] = useState("");
  const [question, setQuestion] = useState("");
  const [ctx, setCtx] = useState("");
  const [running, setRunning] = useState(false);
  const [resultHtml, setResultHtml] = useState("");
  const [simulations, setSimulations] = useState<SavedSim[]>([]);

  async function loadHistory() {
    const d = await apiGet<HistoryResponse>("/api/digital-twin/history");
    if (d.ok && d.simulations?.length) setSimulations(d.simulations);
  }

  useEffect(() => {
    apiGet<ScenariosResponse>("/api/digital-twin/scenarios").then((d) => {
      if (d.ok) setScenarios(d.scenarios);
    });
    loadHistory();
  }, []);

  function pickScenario(s: Scenario) {
    setActiveId(s.id);
    if (s.id !== "custom") setQuestion(s.label);
  }

  async function run() {
    const q = question.trim();
    if (!q) {
      alert("Enter a scenario or question.");
      return;
    }
    setRunning(true);
    const business_context: Record<string, string> = {};
    (ctx || "").split("\n").forEach((line) => {
      const [k, ...vs] = line.split(":");
      if (k && vs.length) business_context[k.trim()] = vs.join(":").trim();
    });
    const d = await apiPost<SimResponse>("/api/digital-twin/simulate", {
      question: q,
      business_context,
    });
    setRunning(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResultHtml(renderResult(d.results || {}, d.question || q));
    loadHistory();
  }

  function onResultClick(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    const alt = t.getAttribute("data-alt");
    if (alt) setQuestion(alt);
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Digital Twin
              </div>
              <h2 className="view-title">🪞 Business Digital Twin</h2>
              <p className="view-sub">
                Ask &quot;what if&quot; questions and get AI-simulated business
                outcomes before committing real budget.
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
          <div className="form-group">
            <label>Pick a scenario</label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 16,
              }}
            >
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  className={`btn btn-sm btn-outline${activeId === s.id ? " active" : ""}`}
                  onClick={() => pickScenario(s)}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Or ask your own &quot;what if&quot; question</label>
            <input
              className="form-control"
              placeholder="e.g. What if I launch in Australia and cut Meta spend by 50%?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>
              Business Context (optional — more context = better simulation)
            </label>
            <textarea
              className="form-control"
              rows={3}
              placeholder={
                "Monthly revenue: R50k\nChannels: Google + Meta\nProduct: SaaS subscription\nAOV: R1,200\nCAC: R400"
              }
              value={ctx}
              onChange={(e) => setCtx(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={running}
            onClick={run}
          >
            {running ? "Simulating…" : "🪞 Run Simulation"}
          </button>
        </div>

        <div
          onClick={onResultClick}
          dangerouslySetInnerHTML={{ __html: resultHtml }}
        />

        {simulations.length > 0 && (
          <>
            <h3
              style={{
                fontSize: ".9rem",
                fontWeight: 600,
                color: "#6b7280",
                margin: "16px 0 8px",
              }}
            >
              Previous Simulations
            </h3>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {simulations.map((s, i) => (
                <div
                  key={i}
                  className="ig-card"
                  style={{ padding: 12, cursor: "pointer" }}
                  onClick={() =>
                    setResultHtml(
                      renderResult(s.results || {}, s.question),
                    )
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{s.question}</span>
                    <span
                      style={{ color: "#6b7280", fontSize: ".8rem" }}
                    >
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div
                    style={{ marginTop: 4 }}
                    dangerouslySetInnerHTML={{
                      __html: verdictBadge(s.results?.verdict || "mixed"),
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
