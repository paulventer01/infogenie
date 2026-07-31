"use client";

import { useState, useEffect, useCallback } from "react";

interface MemoryNode {
  id: number;
  node_type: string;
  source_ref: string | null;
  summary: string;
  detail_json: Record<string, unknown>;
  importance_score: number;
  created_at: string;
}

interface HealthData {
  node_count: number;
  oldest_node: string | null;
  last_ingested: string | null;
  embedding_coverage: number;
  has_openai: boolean;
}

const NODE_TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  campaign_result:      { label: "Campaign Result",      icon: "🚀", color: "#3B82F6" },
  competitor_signal:    { label: "Competitor Signal",    icon: "🏆", color: "#EF4444" },
  content_performance:  { label: "Content Performance",  icon: "📝", color: "#8B5CF6" },
  audience_shift:       { label: "Audience Shift",       icon: "👥", color: "#F59E0B" },
  lead_event:           { label: "Lead Event",           icon: "🎯", color: "#10B981" },
  manual_observation:   { label: "Manual Observation",   icon: "📌", color: "#6B7280" },
  ai_synthesis:         { label: "AI Synthesis",         icon: "🧠", color: "#06B6D4" },
  business_fact:        { label: "Business Fact",        icon: "📚", color: "#0F766E" },
  strategic_decision:   { label: "Strategic Decision",   icon: "⚖️", color: "#1D4ED8" },
  outcome_review:       { label: "Outcome Review",       icon: "✅", color: "#059669" },
  benchmark_insight:    { label: "Benchmark Insight",    icon: "📶", color: "#B45309" },
};

const ALL_TYPES = Object.keys(NODE_TYPE_META);

function ImportanceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "#EF4444" : pct >= 40 ? "#F59E0B" : "#6B7280";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: ".68rem", fontWeight: 700,
      color, background: color + "18", borderRadius: 6, padding: "2px 7px",
    }}>
      ●&nbsp;{pct}%
    </span>
  );
}

function NodeCard({ node }: { node: MemoryNode }) {
  const meta = NODE_TYPE_META[node.node_type] || { label: node.node_type, icon: "📋", color: "#6B7280" };
  const date = new Date(node.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div style={{
      background: "var(--card-bg, #fff)",
      border: "1px solid var(--border, #E5E7EB)",
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: 10,
      padding: "13px 16px",
      display: "flex", flexDirection: "column", gap: 7,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          fontSize: ".72rem", fontWeight: 700, color: meta.color,
          background: meta.color + "15", borderRadius: 6, padding: "2px 8px",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {meta.icon} {meta.label}
        </span>
        <ImportanceBadge score={node.importance_score} />
        <span style={{ fontSize: ".7rem", color: "var(--text-muted, #9CA3AF)", marginLeft: "auto" }}>{date}</span>
      </div>
      <p style={{ margin: 0, fontSize: ".82rem", color: "var(--text, #111827)", lineHeight: 1.55 }}>{node.summary}</p>
      {node.source_ref && (
        <span style={{ fontSize: ".68rem", color: "var(--text-muted, #9CA3AF)" }}>ref: {node.source_ref}</span>
      )}
    </div>
  );
}

export default function MarketingMemory() {
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");

  const [query, setQuery] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<{ answer: string; nodes: MemoryNode[] } | null>(null);

  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestForm, setIngestForm] = useState({ node_type: "manual_observation", summary: "", source_ref: "", importance: "0.5" });
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState("");

  const fetchNodes = useCallback(async (p = 1, tf = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), per: "15" });
      if (tf) params.set("node_type", tf);
      const r = await fetch(`/api/knowledge-graph/nodes?${params}`);
      const j = await r.json();
      if (j.ok) { setNodes(j.nodes); setTotal(j.total); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/knowledge-graph/health");
      const j = await r.json();
      if (j.ok) setHealth(j);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchNodes(1, "");
    fetchHealth();
  }, [fetchNodes, fetchHealth]);

  const handleTypeFilter = (t: string) => {
    setTypeFilter(t); setPage(1);
    fetchNodes(1, t);
  };

  const handleQuery = async () => {
    if (!query.trim()) return;
    setQuerying(true); setQueryResult(null);
    try {
      const r = await fetch("/api/knowledge-graph/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, limit: 6 }),
      });
      const j = await r.json();
      if (j.ok) setQueryResult({ answer: j.answer, nodes: j.nodes });
    } catch { /* silent */ }
    setQuerying(false);
  };

  const handleIngest = async () => {
    if (!ingestForm.summary.trim()) return;
    setIngesting(true); setIngestMsg("");
    try {
      const r = await fetch("/api/knowledge-graph/ingest", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_type: ingestForm.node_type,
          summary: ingestForm.summary,
          source_ref: ingestForm.source_ref || null,
          importance: parseFloat(ingestForm.importance) || 0.5,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setIngestMsg("✅ Memory node saved!");
        setIngestForm({ node_type: "manual_observation", summary: "", source_ref: "", importance: "0.5" });
        fetchNodes(1, typeFilter);
        fetchHealth();
      } else {
        setIngestMsg("❌ " + (j.error || "Failed to save"));
      }
    } catch { setIngestMsg("❌ Network error"); }
    setIngesting(false);
  };

  const totalPages = Math.ceil(total / 15);

  return (
    <div style={{ padding: "28px 32px", maxWidth: 960, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, color: "var(--text, #111827)" }}>
            🧠 Marketing Memory
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: ".85rem", color: "var(--text-muted, #6B7280)" }}>
            A living timeline of every campaign result, competitor signal, audience shift and insight InfoGenie has captured.
          </p>
        </div>
        <button
          onClick={() => setIngestOpen(!ingestOpen)}
          style={{
            padding: "9px 18px", borderRadius: 8, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff",
            fontSize: ".82rem", fontWeight: 700, whiteSpace: "nowrap",
          }}
        >
          + Add Observation
        </button>
      </div>

      {/* Health cards */}
      {health && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Active Memories", value: health.node_count.toLocaleString(), icon: "🗂️" },
            { label: "Embedding Coverage", value: `${health.embedding_coverage}%`, icon: "🔗" },
            { label: "Oldest Memory", value: health.oldest_node ? new Date(health.oldest_node).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—", icon: "📅" },
            { label: "Last Captured", value: health.last_ingested ? new Date(health.last_ingested).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—", icon: "⏱️" },
          ].map(c => (
            <div key={c.label} style={{
              background: "var(--card-bg, #fff)", border: "1px solid var(--border, #E5E7EB)",
              borderRadius: 10, padding: "14px 16px",
            }}>
              <div style={{ fontSize: "1.3rem" }}>{c.icon}</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--text, #111827)", marginTop: 4 }}>{c.value}</div>
              <div style={{ fontSize: ".72rem", color: "var(--text-muted, #9CA3AF)", marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* AI Query panel */}
      <div style={{
        background: "linear-gradient(135deg,#0066FF08,#00C9C808)",
        border: "1px solid #0066FF22", borderRadius: 12, padding: "18px 20px", marginBottom: 24,
      }}>
        <h2 style={{ margin: "0 0 10px", fontSize: ".95rem", fontWeight: 700, color: "var(--text, #111827)" }}>
          🔍 Ask your Marketing Memory
        </h2>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleQuery()}
            placeholder="e.g. What campaigns drove the most leads last quarter?"
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 8,
              border: "1px solid var(--border, #E5E7EB)", fontSize: ".84rem",
              background: "var(--card-bg, #fff)", color: "var(--text, #111827)",
              outline: "none",
            }}
          />
          <button
            onClick={handleQuery}
            disabled={querying || !query.trim()}
            style={{
              padding: "10px 18px", borderRadius: 8, border: "none", cursor: "pointer",
              background: "#0066FF", color: "#fff", fontSize: ".82rem", fontWeight: 700,
              opacity: querying || !query.trim() ? 0.6 : 1,
            }}
          >
            {querying ? "Thinking…" : "Ask"}
          </button>
        </div>

        {queryResult && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              background: "var(--card-bg, #fff)", borderRadius: 10,
              border: "1px solid var(--border, #E5E7EB)", padding: "14px 16px",
              fontSize: ".84rem", color: "var(--text, #111827)", lineHeight: 1.65,
              whiteSpace: "pre-wrap",
            }}>
              {queryResult.answer}
            </div>
            {queryResult.nodes.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ margin: 0, fontSize: ".74rem", color: "var(--text-muted, #6B7280)", fontWeight: 600 }}>
                  SOURCE MEMORIES USED
                </p>
                {queryResult.nodes.slice(0, 4).map((n, i) => (
                  <div key={n.id} style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    background: "var(--card-bg, #fff)", borderRadius: 8,
                    border: "1px solid var(--border, #E5E7EB)", padding: "10px 12px",
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 11,
                      background: "#0066FF", color: "#fff", fontSize: ".72rem",
                      fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>{i + 1}</span>
                    <span style={{ fontSize: ".8rem", color: "var(--text, #374151)", lineHeight: 1.5 }}>{n.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual ingest form */}
      {ingestOpen && (
        <div style={{
          background: "var(--card-bg, #fff)", border: "1px solid var(--border, #E5E7EB)",
          borderRadius: 12, padding: "18px 20px", marginBottom: 24,
        }}>
          <h2 style={{ margin: "0 0 14px", fontSize: ".95rem", fontWeight: 700, color: "var(--text, #111827)" }}>
            📌 Add External Observation
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text, #374151)", display: "block", marginBottom: 5 }}>Type</label>
              <select
                value={ingestForm.node_type}
                onChange={e => setIngestForm(f => ({ ...f, node_type: e.target.value }))}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, #E5E7EB)", fontSize: ".82rem", background: "var(--card-bg, #fff)", color: "var(--text, #111827)" }}
              >
                {ALL_TYPES.map(t => (
                  <option key={t} value={t}>{NODE_TYPE_META[t].icon} {NODE_TYPE_META[t].label}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text, #374151)", display: "block", marginBottom: 5 }}>Summary *</label>
              <textarea
                value={ingestForm.summary}
                onChange={e => setIngestForm(f => ({ ...f, summary: e.target.value }))}
                placeholder="e.g. Our TV campaign in Q1 drove 30% more web traffic than the previous quarter."
                rows={3}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: "1px solid var(--border, #E5E7EB)", fontSize: ".82rem",
                  background: "var(--card-bg, #fff)", color: "var(--text, #111827)",
                  resize: "vertical", boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text, #374151)", display: "block", marginBottom: 5 }}>Source / Reference (optional)</label>
              <input
                value={ingestForm.source_ref}
                onChange={e => setIngestForm(f => ({ ...f, source_ref: e.target.value }))}
                placeholder="e.g. Q1 campaign report"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, #E5E7EB)", fontSize: ".82rem", background: "var(--card-bg, #fff)", color: "var(--text, #111827)", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text, #374151)", display: "block", marginBottom: 5 }}>Importance (0–1)</label>
              <input
                type="number" min="0" max="1" step="0.1"
                value={ingestForm.importance}
                onChange={e => setIngestForm(f => ({ ...f, importance: e.target.value }))}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, #E5E7EB)", fontSize: ".82rem", background: "var(--card-bg, #fff)", color: "var(--text, #111827)", boxSizing: "border-box" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
            <button
              onClick={handleIngest}
              disabled={ingesting || !ingestForm.summary.trim()}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                background: "#10B981", color: "#fff", fontSize: ".82rem", fontWeight: 700,
                opacity: ingesting || !ingestForm.summary.trim() ? 0.6 : 1,
              }}
            >
              {ingesting ? "Saving…" : "Save to Memory"}
            </button>
            {ingestMsg && <span style={{ fontSize: ".82rem" }}>{ingestMsg}</span>}
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button
          onClick={() => handleTypeFilter("")}
          style={{
            padding: "5px 12px", borderRadius: 20, border: "1px solid var(--border, #E5E7EB)",
            background: !typeFilter ? "#0066FF" : "var(--card-bg, #fff)",
            color: !typeFilter ? "#fff" : "var(--text, #374151)",
            fontSize: ".75rem", fontWeight: 600, cursor: "pointer",
          }}
        >All</button>
        {ALL_TYPES.map(t => {
          const m = NODE_TYPE_META[t];
          const active = typeFilter === t;
          return (
            <button
              key={t}
              onClick={() => handleTypeFilter(t)}
              style={{
                padding: "5px 12px", borderRadius: 20,
                border: `1px solid ${active ? m.color : "var(--border, #E5E7EB)"}`,
                background: active ? m.color : "var(--card-bg, #fff)",
                color: active ? "#fff" : "var(--text, #374151)",
                fontSize: ".75rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              {m.icon} {m.label}
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted, #9CA3AF)" }}>Loading memories…</div>
      ) : nodes.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          background: "var(--card-bg, #fff)", border: "1px solid var(--border, #E5E7EB)", borderRadius: 12,
        }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>🧠</div>
          <h3 style={{ margin: "0 0 8px", color: "var(--text, #111827)" }}>No memories yet</h3>
          <p style={{ margin: 0, color: "var(--text-muted, #6B7280)", fontSize: ".85rem" }}>
            Use InfoGenie features — run campaigns, analyse competitors, score leads — and results will automatically appear here. You can also add observations manually above.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {nodes.map(n => <NodeCard key={n.id} node={n} />)}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 20 }}>
          <button
            disabled={page === 1}
            onClick={() => { const p = page - 1; setPage(p); fetchNodes(p, typeFilter); }}
            style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border, #E5E7EB)", background: "var(--card-bg,#fff)", color: "var(--text,#374151)", cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1, fontSize: ".82rem" }}
          >← Prev</button>
          <span style={{ padding: "7px 12px", fontSize: ".82rem", color: "var(--text-muted,#6B7280)" }}>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => { const p = page + 1; setPage(p); fetchNodes(p, typeFilter); }}
            style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border, #E5E7EB)", background: "var(--card-bg,#fff)", color: "var(--text,#374151)", cursor: page >= totalPages ? "not-allowed" : "pointer", opacity: page >= totalPages ? 0.5 : 1, fontSize: ".82rem" }}
          >Next →</button>
        </div>
      )}
    </div>
  );
}
