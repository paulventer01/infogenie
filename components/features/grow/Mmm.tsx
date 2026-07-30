"use client";

// Native React port of the legacy `mmm` panel (was `window.buildMmm` in
// public/js/ig_moat_features.js + `#view-mmm` in index.html). Models the optimal
// budget split across channels against the existing Express API
// (`POST /api/mmm/model` and `GET /api/mmm/history`) via `lib/api`.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface AllocRow {
  channel: string;
  budget: number;
  roas_curve?: string;
  expected_revenue?: number;
  expected_conversions?: number;
  rationale?: string;
}
interface ScenarioCase {
  total_revenue?: number;
  roas?: number;
  allocation_note?: string;
}
interface ShiftRow {
  from: string;
  to: string;
  amount?: number;
  why?: string;
}
interface ChannelInsight {
  channel: string;
  saturation_level: string;
  key_insight: string;
}
interface MMMResults {
  summary?: string;
  top_recommendation?: string;
  recommended_allocation?: AllocRow[];
  scenarios?: Record<string, ScenarioCase>;
  current_vs_recommended?: {
    uplift_pct?: number;
    incremental_revenue?: number;
  };
  budget_to_shift?: ShiftRow[];
  channel_insights?: ChannelInsight[];
}
interface ModelResponse {
  ok: boolean;
  error?: string;
  results?: MMMResults;
}
interface SavedModel {
  scenario_name: string;
  created_at: string;
  results?: MMMResults;
}
interface HistoryResponse {
  ok: boolean;
  models?: SavedModel[];
}

const CHANNELS = [
  "Google Search",
  "Meta Ads",
  "TikTok",
  "LinkedIn",
  "Email",
  "SEO/Content",
  "YouTube",
  "Pinterest",
  "Programmatic Display",
  "Radio/Podcast",
  "Other",
];

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

function renderResult(r: MMMResults): string {
  const alloc = r.recommended_allocation || [];
  const total = alloc.reduce((s, c) => s + c.budget, 0) || 1;
  const roas_cols: Record<string, string> = {
    linear: "#3b82f6",
    log: "#10b981",
    "s-curve": "#8b5cf6",
  };
  return `
<div class="ig-card" style="margin-bottom:16px">
  <div style="font-size:1rem;font-weight:600;margin-bottom:8px">Recommended Media Mix</div>
  <p style="color:#374151;margin-bottom:16px">${esc(r.summary || "")}</p>
  <div style="background:#f0fdf4;border-radius:8px;padding:12px;margin-bottom:16px">
    <span style="font-weight:600;color:#10b981">⚡ Top recommendation: </span>${esc(r.top_recommendation || "")}
  </div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem">
    <thead><tr style="background:#f9fafb">${["Channel", "Budget", "%", "Response Curve", "Exp. Revenue", "Exp. Conv.", "Rationale"].map((h) => `<th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;white-space:nowrap">${h}</th>`).join("")}</tr></thead>
    <tbody>${alloc
      .map((c) => {
        const pct = Math.round((c.budget / total) * 100);
        return `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px 12px;font-weight:600">${esc(c.channel)}</td>
        <td style="padding:8px 12px">$${(c.budget || 0).toLocaleString()}</td>
        <td style="padding:8px 12px">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:60px;height:6px;background:#f3f4f6;border-radius:3px"><div style="width:${pct}%;height:100%;background:#3b82f6;border-radius:3px"></div></div>
            ${pct}%
          </div>
        </td>
        <td style="padding:8px 12px"><span style="background:${(roas_cols[c.roas_curve || ""] || "#6b7280") + "20"};color:${roas_cols[c.roas_curve || ""] || "#6b7280"};border-radius:4px;padding:2px 6px;font-size:.75rem;font-weight:600">${esc(c.roas_curve || "")}</span></td>
        <td style="padding:8px 12px;color:#10b981;font-weight:600">$${(c.expected_revenue || 0).toLocaleString()}</td>
        <td style="padding:8px 12px">${(c.expected_conversions || 0).toLocaleString()}</td>
        <td style="padding:8px 12px;font-size:.8rem;color:#374151;max-width:200px">${esc(c.rationale || "")}</td>
      </tr>`;
      })
      .join("")}</tbody>
  </table></div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:16px">
  ${(
    [
      ["conservative", "Conservative 🛡️", "#6b7280"],
      ["base", "Base Case 📊", "#3b82f6"],
      ["aggressive", "Aggressive 🚀", "#10b981"],
    ] as const
  )
    .map(([k, label, col]) => {
      const s = r.scenarios?.[k] || {};
      return `<div class="ig-card" style="border-top:3px solid ${col}">
      <div style="font-weight:600;margin-bottom:8px">${label}</div>
      <div style="font-size:1.4rem;font-weight:800;color:${col}">$${(s.total_revenue || 0).toLocaleString()}</div>
      <div style="font-size:.8rem;color:#6b7280">ROAS: ${s.roas || 0}x</div>
      <div style="font-size:.8rem;color:#374151;margin-top:6px">${esc(s.allocation_note || "")}</div>
    </div>`;
    })
    .join("")}
  <div class="ig-card" style="border-top:3px solid #f59e0b">
    <div style="font-weight:600;margin-bottom:8px">vs Current 📈</div>
    <div style="font-size:1.1rem;font-weight:700;color:#f59e0b">+${r.current_vs_recommended?.uplift_pct || 0}%</div>
    <div style="font-size:.8rem;color:#6b7280">ROAS uplift</div>
    <div style="font-size:.8rem;color:#374151;margin-top:6px">+$${(r.current_vs_recommended?.incremental_revenue || 0).toLocaleString()} incremental</div>
  </div>
</div>
${
  r.budget_to_shift?.length
    ? `<div class="ig-card">
  <div style="font-weight:600;margin-bottom:12px">💸 Budget Shifts to Make</div>
  <div style="display:flex;flex-direction:column;gap:8px">${r.budget_to_shift
    .map(
      (s) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px;background:#fef3c7;border-radius:8px">
      <div style="flex:1"><span style="font-weight:600">${esc(s.from)}</span> → <span style="font-weight:600">${esc(s.to)}</span></div>
      <div style="font-weight:700;color:#f59e0b">$${(s.amount || 0).toLocaleString()}</div>
      <div style="font-size:.8rem;color:#374151;flex:2">${esc(s.why || "")}</div>
    </div>`,
    )
    .join("")}
  </div>
</div>`
    : ""
}
${
  r.channel_insights?.length
    ? `<div class="ig-card" style="margin-top:16px">
  <div style="font-weight:600;margin-bottom:12px">Channel Health</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
    ${r.channel_insights
      .map((c) => {
        const col =
          c.saturation_level === "over"
            ? "#ef4444"
            : c.saturation_level === "under"
              ? "#3b82f6"
              : "#10b981";
        return `<div style="background:#f9fafb;border-radius:8px;padding:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;font-size:.85rem">${esc(c.channel)}</span>
          <span style="font-size:.7rem;font-weight:700;padding:2px 6px;border-radius:4px;background:${col + "20"};color:${col}">${esc(c.saturation_level)}</span>
        </div>
        <div style="font-size:.8rem;color:#374151">${esc(c.key_insight)}</div>
      </div>`;
      })
      .join("")}
  </div>
</div>`
    : ""
}`;
}

interface ChannelRow {
  channel: string;
  budget: string;
}

export default function Mmm() {
  const [name, setName] = useState("Q3 Media Mix");
  const [budget, setBudget] = useState("50000");
  const [weeks, setWeeks] = useState("12");
  const [industry, setIndustry] = useState("e-commerce");
  const [audience, setAudience] = useState("");
  const [channels, setChannels] = useState<ChannelRow[]>([
    { channel: CHANNELS[0], budget: "" },
    { channel: CHANNELS[0], budget: "" },
  ]);
  const [running, setRunning] = useState(false);
  const [resultHtml, setResultHtml] = useState("");
  const [models, setModels] = useState<SavedModel[]>([]);

  async function loadHistory() {
    const d = await apiGet<HistoryResponse>("/api/mmm/history");
    if (d.ok && d.models?.length) setModels(d.models);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  function addChannel() {
    setChannels((c) => [...c, { channel: CHANNELS[0], budget: "" }]);
  }
  function removeChannel(i: number) {
    setChannels((c) => c.filter((_, idx) => idx !== i));
  }
  function updateChannel(i: number, key: keyof ChannelRow, v: string) {
    setChannels((c) =>
      c.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)),
    );
  }

  async function run() {
    setRunning(true);
    const current_channels = channels
      .map((c) => ({ channel: c.channel, budget: +c.budget || 0 }))
      .filter((c) => c.budget > 0);
    const d = await apiPost<ModelResponse>("/api/mmm/model", {
      scenario_name: name || "Scenario",
      total_budget: +budget || 50000,
      timeframe_weeks: +weeks || 12,
      industry: industry || "general",
      target_audience: audience || "",
      current_channels,
    });
    setRunning(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResultHtml(renderResult(d.results || {}));
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
                <span className="bc-sep">›</span> Media Mix Modeler
              </div>
              <h2 className="view-title">🎛️ Media Mix Modeler</h2>
              <p className="view-sub">
                Model the optimal budget split across channels before spending a
                dollar — simulates diminishing returns, saturation curves, and
                cross-channel lift.
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
          style={{ maxWidth: 800, marginBottom: 24 }}
        >
          <div
            className="form-grid"
            style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
          >
            <div className="form-group">
              <label>Scenario Name</label>
              <input
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Total Budget</label>
              <input
                className="form-control"
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Timeframe (weeks)</label>
              <input
                className="form-control"
                type="number"
                value={weeks}
                onChange={(e) => setWeeks(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Industry</label>
              <input
                className="form-control"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Target Audience</label>
              <input
                className="form-control"
                placeholder="e.g. 25-45 year olds, UK, interested in fitness"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: ".85rem",
                marginBottom: 8,
              }}
            >
              Current Channel Allocations (optional — leave blank for AI to
              recommend from scratch)
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {channels.map((row, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <select
                    className="form-control"
                    style={{ flex: 2 }}
                    value={row.channel}
                    onChange={(e) =>
                      updateChannel(i, "channel", e.target.value)
                    }
                  >
                    {CHANNELS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    className="form-control"
                    type="number"
                    style={{ flex: 1 }}
                    placeholder="$0"
                    value={row.budget}
                    onChange={(e) =>
                      updateChannel(i, "budget", e.target.value)
                    }
                  />
                  <button
                    className="btn btn-xs btn-outline"
                    onClick={() => removeChannel(i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              className="btn btn-sm btn-outline"
              style={{ marginTop: 8 }}
              onClick={addChannel}
            >
              + Add Channel
            </button>
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={running}
            onClick={run}
          >
            {running ? "Modelling mix…" : "🎛️ Model Optimal Mix"}
          </button>
        </div>

        <div dangerouslySetInnerHTML={{ __html: resultHtml }} />

        {models.length > 0 && (
          <>
            <h3
              style={{
                fontSize: ".9rem",
                fontWeight: 600,
                color: "#6b7280",
                margin: "16px 0 8px",
              }}
            >
              Saved Models
            </h3>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {models.map((m, i) => (
                <div
                  key={i}
                  className="ig-card"
                  style={{ padding: 12, cursor: "pointer" }}
                  onClick={() => setResultHtml(renderResult(m.results || {}))}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {m.scenario_name}
                    </span>
                    <span
                      style={{ color: "#6b7280", fontSize: ".8rem" }}
                    >
                      {new Date(m.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: ".85rem",
                      color: "#10b981",
                      marginTop: 2,
                    }}
                  >
                    ROAS uplift: +
                    {m.results?.current_vs_recommended?.uplift_pct || 0}%
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
