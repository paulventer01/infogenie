"use client";
// Marketing Team Briefing Room — runs multi-agent AI strategy sessions via
// POST /api/swarm/briefing. The 5 swarm agents (CMO, SEO Director, Media Buyer,
// CRO Specialist, Data Analyst) each contribute a specialist perspective, then
// the CMO synthesises into a prioritised action plan.

import { useCallback, useEffect, useRef, useState } from "react";

interface Persona {
  id: string; name: string; title: string; icon: string; color: string;
  description: string; expertise: string[];
}
interface QuickBriefing {
  id: string; name: string; description: string; icon: string;
  default_agents: string[]; challenge_template: string;
}
interface AgentContribution {
  id: string; name: string; title: string; icon: string; color: string;
  contribution: {
    perspective: string; recommendations: string[]; quick_wins: string[];
    risks_to_flag: string[]; confidence: number; key_metric: string;
  };
}
interface PriorityAction { action: string; owner: string; timeline: string; expected_impact: string; }
interface Synthesis {
  executive_summary: string; priority_actions: PriorityAction[];
  confidence: number; rationale: string; success_metrics: string[]; biggest_risk: string;
}
interface BriefingSession {
  session_id: number; challenge: string; agents: AgentContribution[];
  synthesis: Synthesis; created_at: string;
}
interface HistoryRun {
  id: number; summary: string; session_output?: BriefingSession; started_at: string; completed_at: string;
}

type Tab = "team" | "briefing" | "history";

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#10B981" : score >= 40 ? "#F59E0B" : "#EF4444";
  const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: ".7rem", fontWeight: 800, color, background: color + "18", borderRadius: 20, padding: "3px 10px" }}>
      ● {score}% {label} confidence
    </span>
  );
}

function AgentCard({ persona, selected, onToggle }: { persona: Persona; selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        padding: "14px 16px", borderRadius: 12, cursor: "pointer", textAlign: "left", width: "100%",
        border: `2px solid ${selected ? persona.color : "var(--border,#E5E7EB)"}`,
        background: selected ? persona.color + "10" : "var(--card-bg,#fff)",
        transition: "border-color .15s, background .15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>{persona.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: ".85rem", fontWeight: 800, color: "var(--text,#111827)" }}>{persona.name}</div>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted,#6B7280)" }}>{persona.title}</div>
        </div>
        <span style={{ width: 18, height: 18, borderRadius: 9, border: `2px solid ${selected ? persona.color : "#D1D5DB"}`, background: selected ? persona.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {selected && <span style={{ color: "#fff", fontSize: ".65rem", fontWeight: 900 }}>✓</span>}
        </span>
      </div>
      <div style={{ fontSize: ".75rem", color: "var(--text-muted,#6B7280)", lineHeight: 1.5 }}>{persona.description}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
        {persona.expertise.map(e => (
          <span key={e} style={{ fontSize: ".68rem", background: persona.color + "18", color: persona.color, borderRadius: 4, padding: "2px 7px", fontWeight: 700 }}>{e}</span>
        ))}
      </div>
    </button>
  );
}

function ContributionAccordion({ agent, index }: { agent: AgentContribution; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const c = agent.contribution;
  return (
    <div style={{ border: `1px solid var(--border,#E5E7EB)`, borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
          background: open ? agent.color + "0C" : "var(--card-bg,#fff)",
          border: "none", cursor: "pointer", borderBottom: open ? `1px solid ${agent.color}30` : "none",
          transition: "background .15s",
        }}
      >
        <span style={{ fontSize: "1.3rem" }}>{agent.icon}</span>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: ".88rem", fontWeight: 800, color: "var(--text,#111827)" }}>{agent.name}</div>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted,#6B7280)" }}>{agent.title}</div>
        </div>
        <ConfidenceBadge score={c.confidence} />
        <span style={{ fontSize: ".8rem", color: "var(--text-muted,#9CA3AF)", marginLeft: 8 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: ".72rem", fontWeight: 700, color: agent.color, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".06em" }}>Specialist Perspective</div>
            <p style={{ margin: 0, fontSize: ".85rem", color: "var(--text,#374151)", lineHeight: 1.65 }}>{c.perspective}</p>
          </div>
          {(c.recommendations || []).length > 0 && (
            <div>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: agent.color, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".06em" }}>Recommendations</div>
              <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 5 }}>
                {c.recommendations.map((r, i) => <li key={i} style={{ fontSize: ".83rem", color: "var(--text,#374151)", lineHeight: 1.55 }}>{r}</li>)}
              </ul>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {(c.quick_wins || []).length > 0 && (
              <div style={{ padding: "10px 12px", background: "#10B98108", border: "1px solid #10B98130", borderRadius: 8 }}>
                <div style={{ fontSize: ".7rem", fontWeight: 700, color: "#10B981", marginBottom: 5 }}>⚡ Quick Win</div>
                {c.quick_wins.slice(0, 2).map((w, i) => <div key={i} style={{ fontSize: ".78rem", color: "var(--text,#374151)", lineHeight: 1.45, marginBottom: 3 }}>{w}</div>)}
              </div>
            )}
            {(c.risks_to_flag || []).length > 0 && (
              <div style={{ padding: "10px 12px", background: "#EF444408", border: "1px solid #EF444420", borderRadius: 8 }}>
                <div style={{ fontSize: ".7rem", fontWeight: 700, color: "#EF4444", marginBottom: 5 }}>⚠ Risk</div>
                {c.risks_to_flag.slice(0, 2).map((r, i) => <div key={i} style={{ fontSize: ".78rem", color: "var(--text,#374151)", lineHeight: 1.45, marginBottom: 3 }}>{r}</div>)}
              </div>
            )}
          </div>
          {c.key_metric && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: agent.color + "08", border: `1px solid ${agent.color}20`, borderRadius: 7 }}>
              <span style={{ fontSize: ".72rem", fontWeight: 700, color: agent.color }}>📈 Watch:</span>
              <span style={{ fontSize: ".8rem", color: "var(--text,#374151)" }}>{c.key_metric}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SynthesisPanel({ synthesis }: { synthesis: Synthesis }) {
  return (
    <div style={{
      border: "2px solid #7C3AED40", borderRadius: 14, overflow: "hidden",
      background: "linear-gradient(135deg,#7C3AED06,#0EA5E908)",
    }}>
      <div style={{ padding: "16px 20px", background: "linear-gradient(135deg,#7C3AED,#0EA5E9)", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: "1.5rem" }}>👑</span>
        <div>
          <div style={{ fontSize: ".95rem", fontWeight: 800, color: "#fff" }}>CMO Strategy Synthesis</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.75)" }}>Unified executive action plan</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <ConfidenceBadge score={synthesis.confidence} />
        </div>
      </div>
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Executive Summary</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "var(--text,#374151)", lineHeight: 1.7 }}>{synthesis.executive_summary}</p>
        </div>
        {(synthesis.priority_actions || []).length > 0 && (
          <div>
            <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Priority Action Plan</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {synthesis.priority_actions.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px 14px", background: "var(--card-bg,#fff)", border: "1px solid var(--border,#E5E7EB)", borderRadius: 9, borderLeft: "4px solid #7C3AED" }}>
                  <span style={{ width: 24, height: 24, borderRadius: 12, background: "#7C3AED", color: "#fff", fontSize: ".7rem", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: ".85rem", fontWeight: 700, color: "var(--text,#111827)", marginBottom: 3 }}>{a.action}</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: ".72rem", color: "var(--text-muted,#6B7280)" }}>
                      <span>👤 {a.owner}</span>
                      <span>⏱ {a.timeline}</span>
                      <span>🎯 {a.expected_impact}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {(synthesis.success_metrics || []).length > 0 && (
            <div style={{ padding: "12px 14px", background: "#10B98108", border: "1px solid #10B98130", borderRadius: 9 }}>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#10B981", marginBottom: 6 }}>📊 Success Metrics</div>
              {synthesis.success_metrics.map((m, i) => <div key={i} style={{ fontSize: ".78rem", color: "var(--text,#374151)", marginBottom: 3 }}>• {m}</div>)}
            </div>
          )}
          {synthesis.biggest_risk && (
            <div style={{ padding: "12px 14px", background: "#EF444408", border: "1px solid #EF444420", borderRadius: 9 }}>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#EF4444", marginBottom: 6 }}>⚠ Biggest Risk</div>
              <div style={{ fontSize: ".78rem", color: "var(--text,#374151)", lineHeight: 1.5 }}>{synthesis.biggest_risk}</div>
            </div>
          )}
        </div>
        {synthesis.rationale && (
          <div style={{ padding: "12px 14px", background: "#7C3AED08", border: "1px solid #7C3AED20", borderRadius: 8 }}>
            <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#7C3AED" }}>▶ Rationale: </span>
            <span style={{ fontSize: ".8rem", color: "var(--text,#374151)" }}>{synthesis.rationale}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryCard({ run, onOpen }: { run: HistoryRun; onOpen: () => void }) {
  const d = new Date(run.started_at);
  const label = d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const challenge = run.session_output?.challenge || run.summary || "Briefing session";
  const agentCount = run.session_output?.agents?.length || 0;
  return (
    <div style={{ padding: "14px 16px", border: "1px solid var(--border,#E5E7EB)", borderRadius: 10, background: "var(--card-bg,#fff)", cursor: "pointer" }} onClick={onOpen}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: "1.2rem" }}>🧠</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: ".85rem", fontWeight: 700, color: "var(--text,#111827)", lineHeight: 1.4, marginBottom: 4 }}>{challenge.slice(0, 100)}{challenge.length > 100 ? "…" : ""}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: ".72rem", color: "var(--text-muted,#6B7280)" }}>
            <span>📅 {label}</span>
            {agentCount > 0 && <span>👥 {agentCount} agents</span>}
            {run.session_output?.synthesis?.confidence != null && (
              <span>● {run.session_output.synthesis.confidence}% confidence</span>
            )}
          </div>
        </div>
        <span style={{ fontSize: ".75rem", color: "#7C3AED", fontWeight: 700, whiteSpace: "nowrap" }}>View →</span>
      </div>
    </div>
  );
}

export default function BriefingRoom() {
  const [activeTab, setActiveTab] = useState<Tab>("team");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [quickBriefings, setQuickBriefings] = useState<QuickBriefing[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set(["cmo", "seo_director", "media_buyer", "cro_specialist", "data_analyst"]));
  const [challenge, setChallenge] = useState("");
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState<BriefingSession | null>(null);
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingSession, setViewingSession] = useState<BriefingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  const loadPersonas = useCallback(async () => {
    try {
      const r = await fetch("/api/swarm/personas");
      const j = await r.json();
      if (j.ok) setPersonas(j.personas || []);
    } catch (_) {}
  }, []);

  const loadQuickBriefings = useCallback(async () => {
    try {
      const r = await fetch("/api/swarm/quick-briefings");
      const j = await r.json();
      if (j.ok) setQuickBriefings(j.quick_briefings || []);
    } catch (_) {}
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/swarm/runs?type=briefing");
      const j = await r.json();
      if (j.ok) setHistory(j.runs || []);
    } catch (_) {}
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    loadPersonas();
    loadQuickBriefings();
  }, [loadPersonas, loadQuickBriefings]);

  useEffect(() => {
    if (activeTab === "history") loadHistory();
  }, [activeTab, loadHistory]);

  const toggleAgent = (id: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  };

  const runBriefing = async () => {
    if (!challenge.trim() || running) return;
    setRunning(true);
    setError(null);
    setSession(null);
    try {
      const r = await fetch("/api/swarm/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: challenge.trim(), agents: Array.from(selectedAgents) }),
      });
      const j = await r.json();
      if (j.ok) { setSession(j as BriefingSession); setActiveTab("briefing"); }
      else setError(j.error || "Briefing failed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    setRunning(false);
  };

  const applyQuickBriefing = (qb: QuickBriefing) => {
    setChallenge(qb.challenge_template);
    setSelectedAgents(new Set(qb.default_agents));
  };

  const TAB_STYLE = (active: boolean) => ({
    padding: "10px 20px", border: "none", borderBottom: active ? "2px solid #7C3AED" : "2px solid transparent",
    background: "none", cursor: "pointer", fontSize: ".85rem", fontWeight: active ? 800 : 600,
    color: active ? "#7C3AED" : "var(--text-muted,#6B7280)", transition: "color .15s, border-color .15s",
  });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.35rem", fontWeight: 800, color: "var(--text,#111827)" }}>
          🧠 Marketing Team Briefing Room
        </h2>
        <p style={{ margin: 0, fontSize: ".85rem", color: "var(--text-muted,#6B7280)" }}>
          Brief your AI marketing team on a strategic challenge. Each agent contributes their specialist perspective — the CMO synthesises into a prioritised action plan.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border,#E5E7EB)", marginBottom: 24, gap: 0 }}>
        {([["team", "👥 Team & Briefing"], ["briefing", "📋 Latest Session"], ["history", "🕐 History"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} style={TAB_STYLE(activeTab === t)} onClick={() => setActiveTab(t)}>{label}</button>
        ))}
      </div>

      {/* ── Tab: Team & Briefing ───────────────────────────────────────────── */}
      {activeTab === "team" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Agent selector */}
          <div>
            <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-muted,#6B7280)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>
              Select Team Members ({selectedAgents.size} selected)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
              {personas.map(p => (
                <AgentCard key={p.id} persona={p} selected={selectedAgents.has(p.id)} onToggle={() => toggleAgent(p.id)} />
              ))}
              {personas.length === 0 && [
                { id: "cmo", name: "CMO", title: "Chief Marketing Officer", icon: "👑", color: "#7C3AED", description: "Strategy, brand, budget, leadership", expertise: ["Strategy", "Brand"] },
                { id: "seo_director", name: "SEO Director", title: "SEO & Content Director", icon: "🔍", color: "#059669", description: "Organic search, content, keywords", expertise: ["SEO", "Content"] },
                { id: "media_buyer", name: "Media Buyer", title: "Paid Media Director", icon: "📣", color: "#DC2626", description: "Paid ads, ROAS, creative testing", expertise: ["Paid Ads", "ROAS"] },
                { id: "cro_specialist", name: "CRO Specialist", title: "Conversion Specialist", icon: "🧪", color: "#D97706", description: "Landing pages, A/B testing, funnels", expertise: ["CRO", "Testing"] },
                { id: "data_analyst", name: "Data Analyst", title: "Marketing Data Analyst", icon: "📊", color: "#0284C7", description: "Attribution, trends, benchmarks", expertise: ["Analytics", "Attribution"] },
              ].map(p => (
                <AgentCard key={p.id} persona={p as Persona} selected={selectedAgents.has(p.id)} onToggle={() => toggleAgent(p.id)} />
              ))}
            </div>
          </div>

          {/* Quick Briefings */}
          {quickBriefings.length > 0 && (
            <div>
              <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-muted,#6B7280)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>
                Quick Briefings — Common Scenarios
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
                {quickBriefings.map(qb => (
                  <button
                    key={qb.id}
                    onClick={() => applyQuickBriefing(qb)}
                    style={{ padding: "12px 14px", border: "1px solid var(--border,#E5E7EB)", borderRadius: 10, background: "var(--card-bg,#fff)", cursor: "pointer", textAlign: "left", transition: "border-color .15s, box-shadow .15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#7C3AED"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border,#E5E7EB)"; }}
                  >
                    <div style={{ fontSize: "1.3rem", marginBottom: 6 }}>{qb.icon}</div>
                    <div style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--text,#111827)", marginBottom: 3 }}>{qb.name}</div>
                    <div style={{ fontSize: ".74rem", color: "var(--text-muted,#6B7280)", lineHeight: 1.4 }}>{qb.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Challenge input */}
          <div>
            <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-muted,#6B7280)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
              Strategic Challenge
            </div>
            <textarea
              value={challenge}
              onChange={e => setChallenge(e.target.value)}
              placeholder="Describe the strategic challenge you want your marketing team to tackle. Be specific — context helps each agent give better advice. e.g. 'Our CAC rose 40% last quarter across Meta and Google. Conversion rates are flat but CPCs are up. What should we do?'"
              rows={5}
              style={{
                width: "100%", boxSizing: "border-box", padding: "12px 14px",
                border: "1.5px solid var(--border,#E5E7EB)", borderRadius: 10,
                fontSize: ".88rem", lineHeight: 1.6, color: "var(--text,#374151)",
                background: "var(--card-bg,#fff)", resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            {error && <p style={{ margin: "6px 0 0", fontSize: ".8rem", color: "#EF4444" }}>⚠ {error}</p>}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: ".78rem", color: "var(--text-muted,#6B7280)" }}>
                {challenge.length}/2000 characters · {selectedAgents.size} agent{selectedAgents.size !== 1 ? "s" : ""} selected
              </div>
              <button
                onClick={runBriefing}
                disabled={running || !challenge.trim()}
                style={{
                  padding: "12px 28px", borderRadius: 10, border: "none", cursor: running || !challenge.trim() ? "not-allowed" : "pointer",
                  background: "linear-gradient(135deg,#7C3AED,#0EA5E9)", color: "#fff", fontSize: ".88rem", fontWeight: 800,
                  opacity: running || !challenge.trim() ? 0.6 : 1,
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {running ? (
                  <>
                    <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 1s linear infinite" }} />
                    Running Briefing…
                  </>
                ) : "🚀 Run Briefing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Latest Session ────────────────────────────────────────────── */}
      {activeTab === "briefing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {running && (
            <div style={{ textAlign: "center", padding: "60px 24px" }}>
              <div style={{ width: 48, height: 48, border: "4px solid #7C3AED30", borderTopColor: "#7C3AED", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
              <div style={{ fontSize: ".95rem", fontWeight: 700, color: "var(--text,#111827)", marginBottom: 6 }}>Running your team briefing…</div>
              <div style={{ fontSize: ".82rem", color: "var(--text-muted,#6B7280)" }}>Each agent is analysing the challenge sequentially. This typically takes 20-40 seconds.</div>
            </div>
          )}
          {!running && !session && (
            <div style={{ textAlign: "center", padding: "60px 24px", background: "var(--card-bg,#fff)", border: "1px solid var(--border,#E5E7EB)", borderRadius: 14 }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🧠</div>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text,#111827)", marginBottom: 6 }}>No session yet</div>
              <div style={{ fontSize: ".85rem", color: "var(--text-muted,#6B7280)", marginBottom: 16 }}>Go to <strong>Team & Briefing</strong> to run your first strategy session.</div>
              <button onClick={() => setActiveTab("team")} style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#7C3AED,#0EA5E9)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: ".85rem" }}>
                Start Briefing
              </button>
            </div>
          )}
          {!running && session && (
            <>
              <div style={{ padding: "14px 16px", background: "#7C3AED08", border: "1px solid #7C3AED20", borderRadius: 10 }}>
                <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#7C3AED", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>Strategic Challenge</div>
                <div style={{ fontSize: ".88rem", color: "var(--text,#374151)", lineHeight: 1.6 }}>{session.challenge}</div>
              </div>
              <div>
                <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-muted,#6B7280)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>
                  Team Contributions
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(session.agents || []).map((a, i) => <ContributionAccordion key={a.id} agent={a} index={i} />)}
                </div>
              </div>
              {session.synthesis && <SynthesisPanel synthesis={session.synthesis} />}
            </>
          )}
        </div>
      )}

      {/* ── Tab: History ───────────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {viewingSession ? (
            <div>
              <button onClick={() => setViewingSession(null)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid var(--border,#E5E7EB)", borderRadius: 8, background: "var(--card-bg,#fff)", cursor: "pointer", fontSize: ".8rem", fontWeight: 700, marginBottom: 16, color: "var(--text,#374151)" }}>
                ← Back to History
              </button>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ padding: "14px 16px", background: "#7C3AED08", border: "1px solid #7C3AED20", borderRadius: 10 }}>
                  <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#7C3AED", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>Strategic Challenge</div>
                  <div style={{ fontSize: ".88rem", color: "var(--text,#374151)", lineHeight: 1.6 }}>{viewingSession.challenge}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(viewingSession.agents || []).map((a, i) => <ContributionAccordion key={a.id} agent={a} index={i} />)}
                </div>
                {viewingSession.synthesis && <SynthesisPanel synthesis={viewingSession.synthesis} />}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text,#111827)" }}>Past Briefings</div>
                <button onClick={loadHistory} style={{ padding: "7px 14px", border: "1px solid var(--border,#E5E7EB)", borderRadius: 7, background: "var(--card-bg,#fff)", cursor: "pointer", fontSize: ".78rem", fontWeight: 700, color: "var(--text,#374151)" }}>
                  🔄 Refresh
                </button>
              </div>
              {historyLoading && <div style={{ textAlign: "center", padding: "30px", color: "var(--text-muted,#6B7280)", fontSize: ".85rem" }}>Loading history…</div>}
              {!historyLoading && history.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 24px", background: "var(--card-bg,#fff)", border: "1px solid var(--border,#E5E7EB)", borderRadius: 12, color: "var(--text-muted,#6B7280)", fontSize: ".85rem" }}>
                  No briefing sessions yet. Run your first briefing to see it here.
                </div>
              )}
              {history.map(run => (
                <HistoryCard
                  key={run.id}
                  run={run}
                  onOpen={() => {
                    if (run.session_output) setViewingSession(run.session_output);
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
