"use client";

// Native React port of the legacy `vertical-playbooks` panel (was
// `window.buildVerticalPlaybooks` in public/js/ig_moat_features.js +
// `#view-vertical-playbooks`). Lists pre-built industry playbooks, generates a
// custom one, activates playbooks, and renders a 90-day roadmap detail — against
// the existing Express API (`/api/playbooks/*`) via lib/api.

import { useCallback, useEffect, useRef, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";

interface Phase {
  week?: string;
  title?: string;
  tasks?: string[];
}
interface PlaybookContent {
  icon?: string;
  title?: string;
  description?: string;
  tags?: string[];
  phases?: Phase[];
  channels?: string[];
  compliance?: string[];
  benchmarks?: Record<string, string | number>;
}
interface Playbook {
  id: number;
  title: string;
  description?: string;
  content?: PlaybookContent;
}
interface ActivePlaybook {
  playbook_id: number;
  title?: string;
  activated_at: string;
  content?: PlaybookContent;
}

const PHASE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981"];

export default function VerticalPlaybooks() {
  const [list, setList] = useState<Playbook[] | null>(null);
  const [active, setActive] = useState<ActivePlaybook[]>([]);
  const [detail, setDetail] = useState<{ content: PlaybookContent; id?: number } | null>(null);
  const [ind, setInd] = useState("");
  const [desc, setDesc] = useState("");
  const [budget, setBudget] = useState("");
  const [generating, setGenerating] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const d = await apiGet<{ ok: boolean; playbooks?: Playbook[] }>("/api/playbooks/list");
    if (d.ok) setList(d.playbooks || []);
  }, []);

  const loadActive = useCallback(async () => {
    const d = await apiGet<{ ok: boolean; active?: ActivePlaybook[] }>(
      "/api/playbooks/active/list",
    );
    if (d.ok && d.active) setActive(d.active);
  }, []);

  useEffect(() => {
    loadList();
    loadActive();
  }, [loadList, loadActive]);

  useEffect(() => {
    if (detail && detailRef.current)
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail]);

  async function generate() {
    const i = ind.trim();
    if (!i) {
      alert("Enter your industry.");
      return;
    }
    setGenerating(true);
    const d = await apiPost<{ ok: boolean; error?: string; playbook?: PlaybookContent }>(
      "/api/playbooks/generate-custom",
      { industry: i, business_description: desc, budget: +budget || 0 },
    );
    setGenerating(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setDetail({ content: d.playbook || {} });
    loadActive();
  }

  async function loadDetail(id: number) {
    const d = await apiGet<{ ok: boolean; playbook?: Playbook }>(`/api/playbooks/${id}`);
    if (!d.ok) return;
    setDetail({ content: d.playbook?.content || {}, id: d.playbook?.id });
  }

  async function activate(id: number) {
    const d = await apiPost<{ ok: boolean; error?: string }>(`/api/playbooks/activate/${id}`);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    alert("✅ Playbook activated! Track your progress below.");
    loadActive();
  }

  return (
    <div>
      <div className="view-header">
        <h2>📋 Vertical Playbooks</h2>
        <p className="view-sub">
          Pre-built, benchmarked 90-day growth playbooks for your industry — channels,
          templates, and compliance baked in. Activate one and follow the phases.
        </p>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div style={{ flex: 2, minWidth: 300 }}>
          {!list ? null : !list.length ? (
            <div className="ig-card" style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>
              Loading playbooks…
            </div>
          ) : (
            <>
              <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Industry Playbooks</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
                  gap: 16,
                }}
              >
                {list.map((pb) => {
                  const c = pb.content || {};
                  return (
                    <div
                      key={pb.id}
                      className="ig-card"
                      style={{ cursor: "pointer", transition: "box-shadow .15s" }}
                      onClick={() => loadDetail(pb.id)}
                      onMouseOver={(e) =>
                        (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,.1)")
                      }
                      onMouseOut={(e) => (e.currentTarget.style.boxShadow = "")}
                    >
                      <div style={{ fontSize: "2rem", marginBottom: 6 }}>{c.icon || "📋"}</div>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{pb.title}</div>
                      <div style={{ fontSize: ".82rem", color: "#6b7280", marginBottom: 10 }}>
                        {pb.description || ""}
                      </div>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}
                      >
                        {(c.tags || []).map((t, i) => (
                          <span
                            key={i}
                            style={{
                              background: "#eff6ff",
                              color: "#3b82f6",
                              borderRadius: 4,
                              padding: "2px 6px",
                              fontSize: ".7rem",
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: ".75rem", color: "#6b7280" }}>
                          {(c.phases || []).length} phases · {(c.channels || []).length} channels
                        </span>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            activate(pb.id);
                          }}
                        >
                          Activate
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="ig-card">
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>🤖 Generate Custom Playbook</h3>
            <div className="form-group">
              <label>Industry</label>
              <input
                className="form-control"
                placeholder="e.g. EdTech, Fintech, Pets"
                value={ind}
                onChange={(e) => setInd(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Describe your business</label>
              <textarea
                className="form-control"
                rows={2}
                placeholder="B2B SaaS for HR teams, 30 paying customers…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Monthly Budget</label>
              <input
                className="form-control"
                type="number"
                placeholder="5000"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
            <button
              className="btn btn-outline"
              style={{ width: "100%" }}
              disabled={generating}
              onClick={generate}
            >
              {generating ? "Generating…" : "⚡ AI Generate Playbook"}
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            {active.length > 0 && (
              <>
                <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Active Playbooks</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {active.map((a, i) => (
                    <div
                      key={i}
                      className="ig-card"
                      style={{ padding: 12, cursor: "pointer" }}
                      onClick={() =>
                        setDetail({ content: a.content || {}, id: a.playbook_id })
                      }
                    >
                      <div style={{ fontWeight: 600 }}>
                        {a.content?.icon || "📋"} {a.title || ""}
                      </div>
                      <div style={{ fontSize: ".75rem", color: "#6b7280", marginTop: 2 }}>
                        Activated: {new Date(a.activated_at).toLocaleDateString()}
                      </div>
                      <div
                        style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}
                      >
                        {(a.content?.tags || []).map((t, j) => (
                          <span
                            key={j}
                            style={{
                              background: "#eff6ff",
                              color: "#3b82f6",
                              borderRadius: 4,
                              padding: "1px 6px",
                              fontSize: ".7rem",
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div ref={detailRef}>
        {detail && <PlaybookDetail content={detail.content} id={detail.id} onActivate={activate} />}
      </div>
    </div>
  );
}

function PlaybookDetail({
  content: c,
  id,
  onActivate,
}: {
  content: PlaybookContent;
  id?: number;
  onActivate: (id: number) => void;
}) {
  return (
    <div className="ig-card" style={{ marginBottom: 16 }}>
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
          <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>
            {c.icon || "📋"} {c.title || ""}
          </div>
          <p style={{ color: "#374151", margin: "4px 0" }}>{c.description || ""}</p>
        </div>
        {id ? (
          <button className="btn btn-primary" onClick={() => onActivate(id)}>
            ▶ Activate Playbook
          </button>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {Object.entries(c.benchmarks || {})
          .slice(0, 6)
          .map(([k, v]) => (
            <div
              key={k}
              style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}
            >
              <div
                style={{
                  fontSize: ".7rem",
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                {k.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#3b82f6" }}>{v}</div>
              <div style={{ fontSize: ".7rem", color: "#9ca3af" }}>benchmark target</div>
            </div>
          ))}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}
      >
        <div>
          <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>
            CHANNELS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(c.channels || []).map((ch, i) => (
              <span
                key={i}
                style={{
                  background: "#f0fdf4",
                  color: "#065f46",
                  borderRadius: 4,
                  padding: "3px 10px",
                  fontSize: ".82rem",
                  fontWeight: 600,
                }}
              >
                {ch}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#ef4444", marginBottom: 6 }}>
            COMPLIANCE
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: ".82rem", color: "#374151" }}>
            {(c.compliance || []).map((cc, i) => (
              <li key={i}>{cc}</li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>
          90-DAY ROADMAP
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(c.phases || []).map((ph, i) => {
            const col = PHASE_COLORS[i % PHASE_COLORS.length];
            return (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div
                  style={{
                    minWidth: 72,
                    background: col,
                    color: "#fff",
                    borderRadius: 6,
                    padding: "4px 8px",
                    textAlign: "center",
                    fontSize: ".75rem",
                    fontWeight: 700,
                    lineHeight: 1.3,
                  }}
                >
                  {ph.week || `Phase ${i + 1}`}
                </div>
                <div style={{ flex: 1, background: "#f9fafb", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: col }}>
                    {ph.title || ""}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: ".85rem", color: "#374151" }}>
                    {(ph.tasks || []).map((t, j) => (
                      <li key={j}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
