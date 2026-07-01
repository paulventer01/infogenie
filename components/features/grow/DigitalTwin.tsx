"use client";

// Marketing Simulator — upgraded from the original single what-if panel.
// Three tabs: Simulator / Compare (up to 4 scenarios side-by-side) / Library (24+ templates).
// API surface: GET /scenarios, GET /templates, GET /autofill, POST /simulate,
//              GET /history, POST /compare, POST /scenarios/:id/share,
//              GET /scenarios/:id/pdf, GET /share/:token (public).

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";

/* ─────────────────────────────────────── types ───────────────────────────── */
interface Template {
  id: number;
  category: string;
  icon: string;
  label: string;
  prompt: string;
}
interface TemplatesResponse {
  ok: boolean;
  templates: Template[];
  grouped: Record<string, Template[]>;
}
interface TimelineRow   { period: string; what_happens: string; metric_impact: string; }
interface MetricAffected{ metric: string; direction: string; estimated_change: string; }
interface SimResults {
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
interface SimRow {
  id: number;
  scenario: string;
  question: string;
  scenario_name?: string;
  results: SimResults;
  share_token?: string;
  created_at: string;
}
interface HistoryResp  { ok: boolean; simulations?: SimRow[]; }
interface SimResp      { ok: boolean; error?: string; question?: string; id?: number; results?: SimResults; created_at?: string; }
interface ShareResp    { ok: boolean; token?: string; url?: string; }
interface CompareResp  { ok: boolean; scenarios?: Array<{ id:number; name:string; question:string; results:SimResults; created_at:string }>; winner_id?: number; comparison_group_id?: string; error?: string; }
interface AutofillResp { ok: boolean; context?: string | null; }

/* ─────────────────────────────────────── helpers ─────────────────────────── */
function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] as string));
}
function verdictColor(v: string) {
  return v === "positive" ? "#10b981" : v === "negative" ? "#ef4444" : v === "mixed" ? "#f59e0b" : "#6b7280";
}
function verdictBadge(v: string) {
  const bg = verdictColor(v);
  return `<span style="background:${bg};color:#fff;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:700;text-transform:uppercase">${esc(v)}</span>`;
}
function scoreRing(val: number) {
  const pct = Math.min(100, Math.max(0, val));
  const col = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return `<div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:conic-gradient(${col} ${pct}%,#e5e7eb 0);font-size:1rem;font-weight:700;color:${col}">${val}</div>`;
}

function renderResult(r: SimResults, question: string, showShare?: { id:number; token?:string; onShare:()=>void; onPdf:()=>void }): string {
  const shareSection = showShare ? `
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      ${showShare.token
        ? `<a href="/api/digital-twin/share/${showShare.token}" target="_blank" rel="noreferrer" style="padding:6px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:.8rem;font-weight:600;color:#1d4ed8;text-decoration:none">🔗 Share link</a>`
        : `<button onclick="window._dtShare(${showShare.id})" style="padding:6px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:.8rem;font-weight:600;color:#1d4ed8;cursor:pointer">🔗 Get share link</button>`
      }
      <a href="/api/digital-twin/scenarios/${showShare.id}/pdf" target="_blank" rel="noreferrer" style="padding:6px 14px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;font-size:.8rem;font-weight:600;color:#7c3aed;text-decoration:none">📄 Export PDF</a>
    </div>` : '';

  return `
<div class="ig-card" style="border-left:4px solid #8b5cf6;margin-bottom:16px">
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">
    ${scoreRing(r.confidence || 65)}
    <div>
      <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase">Simulation Result</div>
      <div style="font-size:1.1rem;font-weight:700">${esc(r.scenario_title || question)}</div>
      <div style="margin-top:4px">${verdictBadge(r.verdict || "mixed")}</div>
    </div>
  </div>
  <p style="color:#374151;margin-bottom:16px">${esc(r.executive_summary || "")}</p>
  ${r.timeline?.length ? `<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">WHAT HAPPENS OVER 90 DAYS</div>
    <div style="display:flex;flex-direction:column;gap:8px">${r.timeline.map(t=>`
      <div style="display:flex;gap:12px;padding:10px;background:#faf5ff;border-radius:8px">
        <div style="width:80px;min-width:80px;font-size:.75rem;font-weight:700;color:#8b5cf6;padding-top:2px">${esc(t.period)}</div>
        <div><div style="font-size:.85rem;font-weight:600">${esc(t.what_happens)}</div><div style="font-size:.8rem;color:#6b7280">${esc(t.metric_impact)}</div></div>
      </div>`).join("")}</div>
  </div>` : ""}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div><div style="font-size:.75rem;font-weight:600;color:#10b981;margin-bottom:6px">✅ UPSIDES</div><ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${(r.upsides||[]).map(u=>`<li>${esc(u)}</li>`).join("")}</ul></div>
    <div><div style="font-size:.75rem;font-weight:600;color:#ef4444;margin-bottom:6px">⚠️ RISKS</div><ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${(r.risks||[]).map(u=>`<li>${esc(u)}</li>`).join("")}</ul></div>
  </div>
  ${r.key_metrics_affected?.length ? `<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">METRICS AFFECTED</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${r.key_metrics_affected.map(m=>{
      const col=m.direction==="up"?"#10b981":m.direction==="down"?"#ef4444":"#6b7280";
      const arrow=m.direction==="up"?"↑":m.direction==="down"?"↓":"→";
      return `<div style="background:#f9fafb;border-radius:8px;padding:8px 14px;text-align:center"><div style="font-size:.75rem;color:#6b7280">${esc(m.metric)}</div><div style="font-size:1rem;font-weight:700;color:${col}">${arrow} ${esc(m.estimated_change)}</div></div>`;
    }).join("")}</div>
  </div>` : ""}
  <div style="background:#eff6ff;border-radius:8px;padding:12px">
    <div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:4px">⚡ RECOMMENDED ACTION</div>
    <div>${esc(r.recommended_action || "")}</div>
  </div>
  ${r.alternative_scenarios?.length ? `<div style="margin-top:12px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">EXPLORE NEXT</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${r.alternative_scenarios.map(a=>`<button class="btn btn-sm btn-outline" data-alt="${esc(a)}">${esc(a)}</button>`).join("")}</div>
  </div>` : ""}
  ${shareSection}
</div>`;
}

/* ─────────────────────────────────────── Simulator tab ───────────────────── */
function SimulatorTab({ history, onSimDone, initialTemplate }: {
  history: SimRow[];
  onSimDone: (row: SimRow) => void;
  initialTemplate?: Template | null;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [grouped, setGrouped]     = useState<Record<string, Template[]>>({});
  const [question, setQuestion]   = useState("");
  const [ctx, setCtx]             = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [running, setRunning]     = useState(false);
  const [resultHtml, setResultHtml] = useState("");
  const [lastId, setLastId]       = useState<number | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [autoCtx, setAutoCtx]     = useState<string | null>(null);
  const [autoLoaded, setAutoLoaded] = useState(false);

  useEffect(() => {
    if (initialTemplate) {
      setQuestion(initialTemplate.prompt);
      setScenarioName(initialTemplate.label);
    }
    apiGet<TemplatesResponse>("/api/digital-twin/templates").then(d => {
      if (d.ok) { setTemplates(d.templates); setGrouped(d.grouped); }
    });
    apiGet<AutofillResp>("/api/digital-twin/autofill").then(d => {
      if (d.ok && d.context) { setAutoCtx(d.context); }
    });
    // expose share callback for inline html buttons
    (window as unknown as Record<string, unknown>)._dtShare = async (id: number) => {
      const d = await apiPost<ShareResp>(`/api/digital-twin/scenarios/${id}/share`, {});
      if (d.ok && d.url) {
        setShareToken(d.token || null);
        setResultHtml(prev => prev); // trigger re-render
        alert(`Share link copied!\n${d.url}`);
      }
    };
  }, []);

  function pickTemplate(t: Template) {
    setQuestion(t.prompt);
    setScenarioName(t.label);
  }

  function loadAutoCtx() {
    if (autoCtx) { setCtx(autoCtx); setAutoLoaded(true); }
  }

  async function run() {
    const q = question.trim();
    if (!q) { alert("Enter a scenario question."); return; }
    setRunning(true);
    setResultHtml("");
    const business_context: Record<string, string> = {};
    (ctx || "").split("\n").forEach(line => {
      const [k, ...vs] = line.split(":");
      if (k && vs.length) business_context[k.trim()] = vs.join(":").trim();
    });
    const d = await apiPost<SimResp>("/api/digital-twin/simulate", {
      question: q,
      scenario_name: scenarioName || q,
      business_context,
    });
    setRunning(false);
    if (!d.ok) { alert(d.error || "Error running simulation"); return; }
    const id = d.id ?? null;
    setLastId(id);
    setShareToken(null);
    setResultHtml(renderResult(d.results || {}, d.question || q,
      id ? { id, token: undefined, onShare: () => {}, onPdf: () => {} } : undefined));
    if (d.id) {
      const row: SimRow = {
        id: d.id, scenario: "custom", question: d.question || q,
        scenario_name: scenarioName || q, results: d.results || {},
        created_at: d.created_at || new Date().toISOString(),
      };
      onSimDone(row);
    }
  }

  async function doShare() {
    if (!lastId) return;
    const d = await apiPost<ShareResp>(`/api/digital-twin/scenarios/${lastId}/share`, {});
    if (d.ok && d.token) {
      setShareToken(d.token);
      alert(`Share link:\n${d.url}`);
    }
  }

  function onResultClick(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    const alt = t.getAttribute("data-alt");
    if (alt) setQuestion(alt);
  }

  const categories = Object.keys(grouped);

  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* Left: form */}
      <div style={{ flex: "1 1 340px", minWidth: 300 }}>
        <div className="ig-card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: ".95rem", marginBottom: 12 }}>⚙️ Configure Simulation</div>

          <div className="form-group">
            <label>Scenario name (optional label)</label>
            <input className="form-control" placeholder="e.g. Q3 budget cut scenario"
              value={scenarioName} onChange={e => setScenarioName(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Scenario / &quot;What if&quot; question</label>
            <textarea className="form-control" rows={3}
              placeholder="e.g. What if I increased ad spend by 50% and launched in the UK simultaneously?"
              value={question} onChange={e => setQuestion(e.target.value)} />
          </div>

          <div className="form-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <label style={{ margin: 0 }}>Business context</label>
              {autoCtx && !autoLoaded && (
                <button className="btn btn-sm btn-outline" onClick={loadAutoCtx} style={{ fontSize: ".75rem" }}>
                  ⚡ Auto-fill from campaigns
                </button>
              )}
            </div>
            <textarea className="form-control" rows={4}
              placeholder={"Monthly revenue: $50k\nChannels: Google + Meta\nProduct: SaaS subscription\nAOV: $1,200\nCAC: $400"}
              value={ctx} onChange={e => setCtx(e.target.value)} />
            {autoLoaded && <div style={{ fontSize: ".75rem", color: "#10b981", marginTop: 4 }}>✅ Auto-filled from your campaign data</div>}
          </div>

          <button className="btn btn-primary" style={{ width: "100%" }}
            disabled={running} onClick={run}>
            {running ? "Simulating…" : "🪞 Run Simulation"}
          </button>

          {lastId && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn-sm btn-outline" onClick={doShare} style={{ flex: 1 }}>
                🔗 {shareToken ? "Share link ready" : "Get share link"}
              </button>
              <a href={`/api/digital-twin/scenarios/${lastId}/pdf`} target="_blank" rel="noreferrer"
                className="btn btn-sm btn-outline" style={{ flex: 1, textDecoration: "none", textAlign: "center" }}>
                📄 Export PDF
              </a>
            </div>
          )}
          {shareToken && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: "#f0fdf4", borderRadius: 6, fontSize: ".75rem", wordBreak: "break-all" }}>
              <strong>Share URL:</strong>{" "}
              <a href={`/api/digital-twin/share/${shareToken}`} target="_blank" rel="noreferrer">
                /api/digital-twin/share/{shareToken}
              </a>
            </div>
          )}
        </div>

        {/* Template quick-picks by category */}
        {categories.length > 0 && (
          <div className="ig-card">
            <div style={{ fontWeight: 700, fontSize: ".9rem", marginBottom: 10 }}>📚 Quick-fill from Library</div>
            {categories.map(cat => (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                  {cat}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {grouped[cat].map(t => (
                    <button key={t.id} className="btn btn-sm btn-outline"
                      onClick={() => pickTemplate(t)}
                      style={{ fontSize: ".75rem" }}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: results + history */}
      <div style={{ flex: "1 1 400px", minWidth: 320 }}>
        {resultHtml ? (
          <div onClick={onResultClick} dangerouslySetInnerHTML={{ __html: resultHtml }} />
        ) : (
          !running && (
            <div className="ig-card" style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>
              <div style={{ fontSize: "3rem", marginBottom: 12 }}>🪞</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Run your first simulation</div>
              <div style={{ fontSize: ".85rem" }}>Pick a template or type your own &quot;what if&quot; question, then click Run.</div>
            </div>
          )
        )}

        {history.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: ".85rem", fontWeight: 700, color: "#374151", marginBottom: 8 }}>
              📋 Previous Simulations ({history.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.slice(0, 10).map(s => (
                <div key={s.id} className="ig-card" style={{ padding: "10px 14px", cursor: "pointer" }}
                  onClick={() => setResultHtml(renderResult(s.results, s.question,
                    { id: s.id, token: s.share_token, onShare: () => {}, onPdf: () => {} }))}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: ".85rem" }}>{s.scenario_name || s.question}</span>
                    <span style={{ color: "#6b7280", fontSize: ".75rem", whiteSpace: "nowrap" }}>
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: verdictBadge(s.results?.verdict || "mixed") }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────── Compare tab ─────────────────────── */
function CompareTab({ history }: { history: SimRow[] }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult]     = useState<CompareResp | null>(null);
  const [loading, setLoading]   = useState(false);

  function toggle(id: number) {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length < 4 ? [...prev, id] : prev
    );
    setResult(null);
  }

  async function compare() {
    if (selected.length < 2) { alert("Pick at least 2 simulations to compare."); return; }
    setLoading(true);
    const d = await apiPost<CompareResp>("/api/digital-twin/compare", { scenario_ids: selected });
    setLoading(false);
    setResult(d);
  }

  const verdictCols: Record<string, string> = {
    positive: "#10b981", mixed: "#f59e0b", neutral: "#6b7280", negative: "#ef4444",
  };

  if (history.length < 2) {
    return (
      <div className="ig-card" style={{ textAlign: "center", padding: 48, color: "#6b7280" }}>
        <div style={{ fontSize: "3rem", marginBottom: 12 }}>⚖️</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Run 2+ simulations first</div>
        <div style={{ fontSize: ".85rem" }}>Go to the Simulator tab, run a few scenarios, then come back here to compare them side-by-side.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="ig-card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>⚖️ Select up to 4 scenarios to compare</div>
        <div style={{ fontSize: ".82rem", color: "#6b7280", marginBottom: 14 }}>
          {selected.length} / 4 selected
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {history.map(s => {
            const sel = selected.includes(s.id);
            return (
              <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                padding: "10px 14px", borderRadius: 8, border: `2px solid ${sel ? "#8b5cf6" : "#e5e7eb"}`,
                background: sel ? "#faf5ff" : "#fff", transition: "all .15s" }}>
                <input type="checkbox" checked={sel} onChange={() => toggle(s.id)} style={{ width: 16, height: 16 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: ".85rem" }}>{s.scenario_name || s.question}</div>
                  <div style={{ fontSize: ".75rem", color: "#6b7280" }}>{new Date(s.created_at).toLocaleDateString()}</div>
                </div>
                <span style={{ background: verdictCols[s.results?.verdict || ""] || "#6b7280",
                  color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase" }}>
                  {s.results?.verdict || "?"}
                </span>
              </label>
            );
          })}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }}
          disabled={selected.length < 2 || loading} onClick={compare}>
          {loading ? "Comparing…" : `⚖️ Compare ${selected.length} Scenarios`}
        </button>
      </div>

      {result?.ok && result.scenarios && (
        <div>
          {result.winner_id && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: ".85rem" }}>
              🏆 <strong>Recommended scenario:</strong>{" "}
              {result.scenarios.find(s => s.id === result.winner_id)?.name || "—"}
              {" "}(highest positive verdict + confidence)
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${result.scenarios.length}, 1fr)`, gap: 14, overflowX: "auto" }}>
            {result.scenarios.map(s => {
              const r = s.results;
              const isWinner = s.id === result.winner_id;
              const col = verdictCols[r?.verdict || ""] || "#6b7280";
              return (
                <div key={s.id} className="ig-card" style={{
                  borderTop: `4px solid ${col}`,
                  outline: isWinner ? "2px solid #10b981" : "none",
                  minWidth: 220,
                }}>
                  {isWinner && (
                    <div style={{ background: "#f0fdf4", borderRadius: 4, padding: "2px 8px", fontSize: ".72rem",
                      fontWeight: 700, color: "#065f46", marginBottom: 8, display: "inline-block" }}>
                      🏆 Recommended
                    </div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: ".9rem", marginBottom: 8 }}>{s.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 44, height: 44, borderRadius: "50%",
                      background: `conic-gradient(${col} ${r?.confidence || 0}%,#e5e7eb 0)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: ".8rem", fontWeight: 700, color: col }}>
                      {r?.confidence || 0}
                    </div>
                    <span style={{ background: col, color: "#fff", borderRadius: 4, padding: "2px 7px",
                      fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase" }}>
                      {r?.verdict || "—"}
                    </span>
                  </div>
                  <p style={{ fontSize: ".8rem", color: "#374151", marginBottom: 10 }}>{r?.executive_summary || "—"}</p>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: ".7rem", fontWeight: 700, color: "#10b981", marginBottom: 4 }}>✅ UPSIDES</div>
                    <ul style={{ margin: 0, paddingLeft: 14, fontSize: ".78rem" }}>
                      {(r?.upsides || []).slice(0, 3).map((u, i) => <li key={i}>{u}</li>)}
                    </ul>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: ".7rem", fontWeight: 700, color: "#ef4444", marginBottom: 4 }}>⚠️ RISKS</div>
                    <ul style={{ margin: 0, paddingLeft: 14, fontSize: ".78rem" }}>
                      {(r?.risks || []).slice(0, 3).map((u, i) => <li key={i}>{u}</li>)}
                    </ul>
                  </div>
                  {r?.key_metrics_affected?.length && (
                    <div>
                      <div style={{ fontSize: ".7rem", fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>METRICS</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {r.key_metrics_affected.slice(0, 4).map((m, i) => {
                          const mc = m.direction === "up" ? "#10b981" : m.direction === "down" ? "#ef4444" : "#6b7280";
                          const arr = m.direction === "up" ? "↑" : m.direction === "down" ? "↓" : "→";
                          return (
                            <div key={i} style={{ background: "#f9fafb", borderRadius: 6, padding: "4px 8px", textAlign: "center" }}>
                              <div style={{ fontSize: ".65rem", color: "#6b7280" }}>{m.metric}</div>
                              <div style={{ fontSize: ".78rem", fontWeight: 700, color: mc }}>{arr} {m.estimated_change}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                    <a href={`/api/digital-twin/scenarios/${s.id}/pdf`} target="_blank" rel="noreferrer"
                      style={{ fontSize: ".72rem", color: "#7c3aed", textDecoration: "none",
                        background: "#f5f3ff", borderRadius: 4, padding: "3px 8px" }}>
                      📄 PDF
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {result && !result.ok && (
        <div style={{ color: "#ef4444", padding: 12 }}>Error: {result.error}</div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────── Library tab ─────────────────────── */
function LibraryTab({ onUseTemplate }: { onUseTemplate: (t: Template) => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [grouped, setGrouped]     = useState<Record<string, Template[]>>({});
  const [search, setSearch]       = useState("");

  useEffect(() => {
    apiGet<TemplatesResponse>("/api/digital-twin/templates").then(d => {
      if (d.ok) { setTemplates(d.templates); setGrouped(d.grouped); }
    });
  }, []);

  const q = search.toLowerCase();
  const filtered = q
    ? templates.filter(t => t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q))
    : null;

  const displayGroups: Record<string, Template[]> = filtered
    ? { "Search Results": filtered }
    : grouped;

  const categories = Object.keys(displayGroups);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <input className="form-control" placeholder="🔍 Search templates…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 380 }} />
      </div>

      {categories.length === 0 && (
        <div style={{ color: "#6b7280", textAlign: "center", padding: 48 }}>No templates found.</div>
      )}

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, fontSize: ".95rem", marginBottom: 12, color: "#374151",
            borderBottom: "2px solid #e5e7eb", paddingBottom: 8 }}>
            {cat}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
            {displayGroups[cat].map(t => (
              <div key={t.id} className="ig-card" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ fontSize: "1.6rem", lineHeight: 1, minWidth: 32 }}>{t.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: ".88rem", marginBottom: 6 }}>{t.label}</div>
                    <div style={{ fontSize: ".78rem", color: "#6b7280", marginBottom: 10, lineHeight: 1.5 }}>{t.prompt}</div>
                    <button className="btn btn-sm btn-primary"
                      onClick={() => onUseTemplate(t)}
                      style={{ fontSize: ".78rem" }}>
                      ▶ Use this template
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────── Root component ─────────────────── */
export default function DigitalTwin() {
  const [tab, setTab]         = useState<"simulator" | "compare" | "library">("simulator");
  const [history, setHistory] = useState<SimRow[]>([]);
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null);

  const loadHistory = useCallback(async () => {
    const d = await apiGet<HistoryResp>("/api/digital-twin/history");
    if (d.ok && d.simulations) setHistory(d.simulations);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  function onSimDone(row: SimRow) {
    setHistory(prev => [row, ...prev.filter(r => r.id !== row.id)]);
  }

  function useTemplate(t: Template) {
    setPendingTemplate(t);
    setTab("simulator");
  }

  const TABS = [
    { id: "simulator" as const, label: "🪞 Simulator" },
    { id: "compare"   as const, label: `⚖️ Compare${history.length >= 2 ? ` (${history.length})` : ""}` },
    { id: "library"   as const, label: "📚 Library (24 templates)" },
  ];

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Marketing Simulator
              </div>
              <h2 className="view-title">🪞 Marketing Simulator</h2>
              <p className="view-sub">
                Run AI &quot;what if&quot; scenarios, compare up to 4 strategies side-by-side, and pick the best move before spending a cent.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "2px solid #e5e7eb", paddingBottom: 0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "8px 18px", border: "none", borderRadius: "6px 6px 0 0", cursor: "pointer",
                fontWeight: 600, fontSize: ".85rem",
                background: tab === t.id ? "#8b5cf6" : "transparent",
                color: tab === t.id ? "#fff" : "#6b7280",
                borderBottom: tab === t.id ? "2px solid #8b5cf6" : "none",
                marginBottom: tab === t.id ? -2 : 0,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "simulator" && (
          <SimulatorTab
            history={history}
            onSimDone={onSimDone}
            initialTemplate={pendingTemplate}
          />
        )}
        {tab === "compare"   && <CompareTab history={history} />}
        {tab === "library"   && <LibraryTab onUseTemplate={useTemplate} />}
      </div>
    </div>
  );
}
