"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

type Mode = "standard" | "boardroom";
type Tab  = "ask" | "history" | "boardroom";

interface Evidence {
  index: number;
  type: string;
  content: string;
  relevance: number;
}
interface Action {
  label: string;
  description: string;
  effort?: string;
  impact?: string;
}
interface KeyMetric {
  metric: string;
  value: string;
  trend: string;
  source: string;
}
interface Risk {
  risk?: string;
  mitigation?: string;
}
interface BoardAction {
  action?: string;
  owner?: string;
  timeline?: string;
  priority?: string;
}
interface BoardroomBrief {
  executive_summary?: string;
  key_metrics?: KeyMetric[];
  key_insights?: string[];
  strategic_implications?: string[];
  risks?: (Risk | string)[];
  decision_needed?: string;
  actions?: (BoardAction | string)[];
}

interface AskResult {
  ok?: boolean;
  question?: string;
  mode?: Mode;
  topic?: string;
  headline?: string;
  answer?: string;
  confidence?: number;
  evidence?: Evidence[];
  risk_flags?: string[];
  recommended_actions?: Action[];
  boardroom_brief?: BoardroomBrief | null;
  chunksUsed?: number;
  predictionsUsed?: number;
  liveDataUsed?: boolean;
  source?: string;
  autoIndexed?: boolean;
  indexCount?: number;
  error?: string;
}

interface HistoryItem {
  id: number;
  question: string;
  answer_json: AskResult;
  mode: Mode;
  topic?: string;
  created_at: string;
}

interface Card {
  id: number;
  question: string;
  answer_json: AskResult;
  mode: Mode;
  pinned: boolean;
  created_at: string;
}

interface IndexStatus {
  ok?: boolean;
  indexed?: number;
  lastUpdated?: string | null;
}

const SUGGESTIONS_STANDARD = [
  "What if we raise prices 8% and lose 5% of volume?",
  "What happens if our largest customer churns?",
  "Why is ROAS down — root-cause decomposition?",
  "Should I be worried about our CAC payback vs peers?",
  "Which landing page is converting best?",
  "What changed in the last 7 days?",
];

const SUGGESTIONS_BOARDROOM = [
  "Summarise our marketing performance for the board",
  "What is our biggest growth risk this quarter?",
  "Should I be worried about CAC payback vs comparable firms?",
  "What decisions need leadership sign-off?",
];

const TYPE_LABELS: Record<string, string> = {
  campaign: "Campaign", insight: "Ad Insight", lead: "Lead", mention: "Mention",
  landing_page: "Landing Page", content_calendar: "Content", brand_calendar: "Brand Calendar",
  budget: "Budget", booking: "Booking", linksell: "Link-in-Bio", audience: "Audience", task: "Task",
  document_pdf: "PDF Doc", document_docx: "Word Doc", document_csv: "CSV", document_txt: "Document",
  connector_slack: "Slack", connector_notion: "Notion", connector_drive: "Google Drive",
};
const TYPE_ICONS: Record<string, string> = {
  campaign: "📣", insight: "📊", lead: "👤", mention: "💬",
  landing_page: "🔗", content_calendar: "📅", brand_calendar: "🗓",
  budget: "💰", booking: "📆", linksell: "🔗", audience: "👥", task: "✅",
  document_pdf: "📄", document_docx: "📝", document_csv: "📊", document_txt: "📃",
  connector_slack: "💬", connector_notion: "📓", connector_drive: "📁",
};

const EFFORT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  low:    { bg: "#F0FDF4", text: "#166534", border: "#BBF7D0" },
  medium: { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" },
  high:   { bg: "#FFF5F5", text: "#B91C1C", border: "#FECACA" },
};
const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  high:   { bg: "#FEF2F2", text: "#B91C1C" },
  medium: { bg: "#FFFBEB", text: "#92400E" },
  low:    { bg: "#F0FDF4", text: "#166534" },
};
const TREND_ICON: Record<string, string> = { up: "📈", down: "📉", stable: "➡️" };

const TOPIC_LABELS: Record<string, string> = {
  roas: "📈 ROAS", spend: "💰 Spend", leads: "👤 Leads", campaigns: "📣 Campaigns",
  seo: "🔍 SEO", content: "📅 Content", competitors: "⚔️ Competitors",
  audiences: "👥 Audiences", performance: "📊 Performance", revenue: "💵 Revenue",
  general: "💬 General",
};

function ConfidenceRing({ value }: { value: number }) {
  const r  = 22;
  const cx = 28;
  const cy = 28;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  const color  = value >= 75 ? "#10B981" : value >= 50 ? "#F59E0B" : "#EF4444";
  const label  = value >= 75 ? "High" : value >= 50 ? "Medium" : "Low";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 56 }}>
      <svg width={cx * 2} height={cy * 2}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E5E7EB" strokeWidth={4} />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={11} fontWeight={800} fill={color}>{value}%</text>
      </svg>
      <span style={{ fontSize: "0.62rem", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
    </div>
  );
}

function renderAnswerText(text: string): React.ReactNode {
  return text.split("\n").map((line, i, arr) => {
    const l = line.replace(/^[-•]\s/, "• ");
    const parts: React.ReactNode[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0, k = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l)) !== null) {
      if (m.index > last) parts.push(l.slice(last, m.index));
      parts.push(<strong key={k++}>{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < l.length) parts.push(l.slice(last));
    return <span key={i}>{parts}{i < arr.length - 1 ? <br /> : null}</span>;
  });
}

function EvidenceAccordion({ items }: { items: Evidence[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 14, border: "1px solid #E5E7EB", borderRadius: 8 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "transparent", border: 0, cursor: "pointer", fontSize: "0.76rem", fontWeight: 700, color: "#374151" }}
      >
        <span>📌 Evidence Sources ({items.length})</span>
        <span style={{ fontSize: "0.6rem", color: "#9CA3AF" }}>{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px" }}>
          {items.map(e => (
            <div key={e.index} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px solid #F3F4F6", alignItems: "flex-start" }}>
              <span style={{ minWidth: 24, height: 20, borderRadius: 4, background: "#EEF2FF", color: "#4F46E5", fontSize: "0.65rem", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{e.index}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#6B7280", marginBottom: 2 }}>
                  {TYPE_ICONS[e.type] || ""} {TYPE_LABELS[e.type] || e.type} · {e.relevance}% match
                </div>
                <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.45 }}>{e.content}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EffortImpactBadge({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  const v = value.toLowerCase();
  const c = EFFORT_COLORS[v] || EFFORT_COLORS.medium;
  return (
    <span style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, padding: "1px 6px", borderRadius: 8, fontSize: "0.6rem", fontWeight: 700 }}>
      {label}: {value}
    </span>
  );
}

function AnswerBubble({
  result, onStar, onExport, starred, exporting,
}: {
  result: AskResult;
  onStar: () => void;
  onExport: () => void;
  starred?: boolean;
  exporting?: boolean;
}) {
  const isBoardroom = result.mode === "boardroom";
  const bb = result.boardroom_brief;
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 20, marginTop: 16 }}>
      {result.autoIndexed && (
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1D4ED8", padding: "7px 12px", borderRadius: 7, fontSize: "0.74rem", marginBottom: 12 }}>
          ⚡ Auto-indexed {result.indexCount} chunks. Future answers will be faster.
        </div>
      )}

      {/* Header row */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
        {typeof result.confidence === "number" && <ConfidenceRing value={result.confidence} />}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            {isBoardroom && (
              <span style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", color: '#0f172a', padding: "3px 9px", borderRadius: 12, fontSize: "0.66rem", fontWeight: 800, letterSpacing: ".04em" }}>
                🏛️ BOARDROOM
              </span>
            )}
            {result.liveDataUsed && (
              <span style={{ background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA", padding: "3px 8px", borderRadius: 12, fontSize: "0.66rem", fontWeight: 700 }}>
                📡 Live Data
              </span>
            )}
            {result.source === "vector-retrieval" && !result.liveDataUsed && (
              <span style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE", padding: "3px 8px", borderRadius: 12, fontSize: "0.66rem", fontWeight: 700 }}>
                ⚡ {result.chunksUsed} chunks
              </span>
            )}
            {(result.predictionsUsed || 0) > 0 && (
              <span style={{ background: "#F5F3FF", color: "#7C3AED", border: "1px solid #DDD6FE", padding: "3px 8px", borderRadius: 12, fontSize: "0.66rem", fontWeight: 700 }}>
                🔮 {result.predictionsUsed} predictions
              </span>
            )}
            {result.topic && (
              <span style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", padding: "3px 8px", borderRadius: 12, fontSize: "0.66rem", fontWeight: 600 }}>
                {TOPIC_LABELS[result.topic] || result.topic}
              </span>
            )}
          </div>
          <div style={{ fontSize: "1.02rem", fontWeight: 800, color: "#0A1628", lineHeight: 1.3 }}>
            {result.headline || result.question}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <button
            onClick={onStar}
            title={starred ? "Saved as Intelligence Card" : "Save as Intelligence Card"}
            style={{ background: starred ? "#FEF9C3" : "#F9FAFB", border: `1px solid ${starred ? "#FDE047" : "#E5E7EB"}`, borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, color: starred ? "#713F12" : "#6B7280" }}
          >{starred ? "⭐ Saved" : "☆ Save"}</button>
          <button
            onClick={onExport} disabled={exporting}
            title="Export as PDF"
            style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 7, padding: "5px 9px", cursor: exporting ? "default" : "pointer", fontSize: "0.82rem", fontWeight: 700, color: "#374151" }}
          >{exporting ? "⏳" : "⬇️ PDF"}</button>
        </div>
      </div>

      {/* Main answer */}
      <div style={{ fontSize: "0.93rem", lineHeight: 1.7, color: "#0A1628" }}>
        {renderAnswerText(result.answer || "")}
      </div>

      {/* Risk flags */}
      {(result.risk_flags || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>⚠️ Risk Flags</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(result.risk_flags!).map((rf, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 7, padding: "6px 10px" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#B91C1C", minWidth: 16 }}>⚠</span>
                <span style={{ fontSize: "0.78rem", color: "#374151" }}>{rf}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence */}
      {(result.evidence || []).length > 0 && <EvidenceAccordion items={result.evidence!} />}

      {/* Recommended actions */}
      {(result.recommended_actions || []).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" }}>⚡ Recommended Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(result.recommended_actions!).map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "7px 11px" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#166534", minWidth: 20 }}>{i + 1}.</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#166534" }}>{a.label}</span>
                    <EffortImpactBadge label="Effort" value={a.effort} />
                    <EffortImpactBadge label="Impact" value={a.impact} />
                  </div>
                  {a.description && <span style={{ fontSize: "0.76rem", color: "#374151" }}>{a.description}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Boardroom brief */}
      {isBoardroom && bb && (
        <div style={{ marginTop: 18, background: '#eef4ff', borderRadius: 10, padding: 16, color: "#E2E8F0" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, letterSpacing: ".06em", color: "#94A3B8", marginBottom: 14, textTransform: "uppercase" }}>🏛️ BOARDROOM BRIEF</div>

          {bb.executive_summary && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#6366F1", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Executive Summary</div>
              <div style={{ fontSize: "0.9rem", lineHeight: 1.6, color: "#F1F5F9" }}>{bb.executive_summary}</div>
            </div>
          )}

          {(bb.key_metrics || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#34D399", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>📊 Key Metrics &amp; Evidence</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8 }}>
                {(bb.key_metrics!).map((m, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,.06)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: "0.64rem", color: "#94A3B8", marginBottom: 2 }}>{TREND_ICON[m.trend] || ""} {m.source}</div>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#CBD5E1", marginBottom: 1 }}>{m.metric}</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#F1F5F9" }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(bb.key_insights || []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: '#0f766e', textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>🔑 Key Insights</div>
              {(bb.key_insights!).map((ins, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                  <span style={{ color: '#0f766e', fontWeight: 800, fontSize: "0.72rem" }}>▸</span>
                  <span style={{ fontSize: "0.83rem", color: "#CBD5E1" }}>{ins}</span>
                </div>
              ))}
            </div>
          )}

          {(bb.strategic_implications || []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#FCD34D", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>🔭 Strategic Implications</div>
              {(bb.strategic_implications!).map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                  <span style={{ color: "#FCD34D", fontWeight: 800, fontSize: "0.72rem" }}>◆</span>
                  <span style={{ fontSize: "0.83rem", color: "#CBD5E1" }}>{s}</span>
                </div>
              ))}
            </div>
          )}

          {(bb.risks || []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#F87171", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>⚠️ Risks &amp; Mitigants</div>
              {(bb.risks!).map((r, i) => {
                const riskText   = typeof r === "string" ? r : r.risk || "";
                const mitigation = typeof r === "string" ? "" : r.mitigation || "";
                return (
                  <div key={i} style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 7, padding: "7px 10px", marginBottom: 5 }}>
                    <div style={{ fontSize: "0.82rem", color: "#FCA5A5", fontWeight: 700 }}>{riskText}</div>
                    {mitigation && <div style={{ fontSize: "0.76rem", color: "#94A3B8", marginTop: 3 }}>🛡️ {mitigation}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {bb.decision_needed && (
            <div style={{ marginBottom: 12, background: "rgba(99,102,241,.15)", borderRadius: 8, padding: "8px 12px" }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: '#0f766e', textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>🗳️ Decision Required</div>
              <div style={{ fontSize: "0.85rem", color: "#E2E8F0" }}>{bb.decision_needed}</div>
            </div>
          )}

          {(bb.actions || []).length > 0 && (
            <div>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#34D399", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>📌 Board Actions</div>
              {(bb.actions!).map((a, i) => {
                const actionText = typeof a === "string" ? a : (a.action || "");
                const owner      = typeof a === "string" ? "" : (a.owner || "");
                const timeline   = typeof a === "string" ? "" : (a.timeline || "");
                const priority   = typeof a === "string" ? "" : (a.priority || "");
                const pc = PRIORITY_COLORS[(priority || "").toLowerCase()] || PRIORITY_COLORS.medium;
                return (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                    <span style={{ background: "#34D399", color: "#0F172A", borderRadius: 4, fontSize: "0.62rem", fontWeight: 800, padding: "1px 5px", minWidth: 18, textAlign: "center" }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: "0.83rem", color: "#CBD5E1" }}>{actionText}</span>
                      {(owner || timeline || priority) && (
                        <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                          {owner && <span style={{ fontSize: "0.62rem", color: "#94A3B8" }}>👤 {owner}</span>}
                          {timeline && <span style={{ fontSize: "0.62rem", color: "#94A3B8" }}>🗓 {timeline}</span>}
                          {priority && <span style={{ fontSize: "0.62rem", fontWeight: 700, background: pc.bg, color: pc.text, padding: "1px 5px", borderRadius: 6 }}>{priority.toUpperCase()}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ onReask }: { onReask: (q: string, mode: Mode) => void }) {
  const [items, setItems]     = useState<HistoryItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [topics, setTopics]   = useState<string[]>([]);
  const [search, setSearch]   = useState("");
  const [topic, setTopic]     = useState("");
  const [searchInput, setSearchInput] = useState("");
  const PAGE = 15;

  const load = useCallback(async (p: number, q: string, t: string) => {
    setLoading(true);
    const qs = [
      `limit=${PAGE}`, `offset=${p * PAGE}`,
      q.trim() ? `q=${encodeURIComponent(q.trim())}` : "",
      t ? `topic=${encodeURIComponent(t)}` : "",
    ].filter(Boolean).join("&");
    const r = await apiGet<{ ok: boolean; items: HistoryItem[]; total: number; topics: string[] }>(
      `/api/ask/history?${qs}`,
    );
    if (r.ok) {
      setItems(r.items || []);
      setTotal(r.total || 0);
      if ((r.topics || []).length) setTopics(r.topics);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(0, "", ""); }, [load]);

  function doSearch() {
    setPage(0);
    setSearch(searchInput);
    load(0, searchInput, topic);
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setTopic("");
    setPage(0);
    load(0, "", "");
  }

  const hasFilters = search || topic;

  if (loading && !items.length) {
    return <div style={{ color: "#9CA3AF", padding: 20, textAlign: "center" }}>⏳ Loading history…</div>;
  }

  return (
    <div>
      {/* Search + topic filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
          placeholder="Search questions…"
          style={{ flex: "1 1 200px", padding: "8px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.84rem" }}
        />
        {topics.length > 0 && (
          <select
            value={topic}
            onChange={e => { setTopic(e.target.value); setPage(0); load(0, search, e.target.value); }}
            style={{ padding: "8px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.82rem", background: "#fff", cursor: "pointer" }}
          >
            <option value="">All topics</option>
            {topics.map(t => <option key={t} value={t}>{TOPIC_LABELS[t] || t}</option>)}
          </select>
        )}
        <button
          onClick={doSearch}
          style={{ padding: "8px 14px", borderRadius: 8, border: 0, background: "linear-gradient(135deg,#0066FF,#7C3AED)", color: "#fff", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}
        >Search</button>
        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#F3F4F6", color: "#374151", fontSize: "0.78rem", cursor: "pointer" }}
          >✕ Clear</button>
        )}
      </div>

      {!loading && !items.length && (
        <div style={{ color: "#9CA3AF", padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>🗂️</div>
          {hasFilters ? `No questions matching your filters.` : "No questions asked yet. Your Q&A history will appear here."}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(item => {
          const aj = item.answer_json || {};
          return (
            <div key={item.id} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                    {item.mode === "boardroom" && (
                      <span style={{ background: '#eef4ff', color: "#E2E8F0", padding: "2px 7px", borderRadius: 10, fontSize: "0.62rem", fontWeight: 800 }}>🏛️ Boardroom</span>
                    )}
                    {item.topic && (
                      <span style={{ background: "#F3F4F6", color: "#6B7280", padding: "2px 7px", borderRadius: 10, fontSize: "0.62rem", fontWeight: 600 }}>{TOPIC_LABELS[item.topic] || item.topic}</span>
                    )}
                    <span style={{ fontSize: "0.68rem", color: "#9CA3AF" }}>
                      {new Date(item.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {typeof aj.confidence === "number" && (
                      <span style={{ fontSize: "0.66rem", color: "#6B7280" }}>
                        {aj.confidence >= 75 ? "🟢" : aj.confidence >= 50 ? "🟡" : "🔴"} {aj.confidence}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#0A1628", marginBottom: 3 }}>{item.question}</div>
                  {aj.headline && <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>{aj.headline}</div>}
                </div>
                <button
                  onClick={() => onReask(item.question, item.mode)}
                  style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, color: "#374151", flexShrink: 0 }}
                >Ask again →</button>
              </div>
            </div>
          );
        })}
      </div>

      {total > PAGE && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
          <button
            onClick={() => { const p = Math.max(0, page - 1); setPage(p); load(p, search, topic); }}
            disabled={page === 0}
            style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", cursor: page === 0 ? "default" : "pointer", fontSize: "0.78rem" }}
          >← Prev</button>
          <span style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: "32px" }}>Page {page + 1} of {Math.ceil(total / PAGE)}</span>
          <button
            onClick={() => { const p = page + 1; setPage(p); load(p, search, topic); }}
            disabled={(page + 1) * PAGE >= total}
            style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", cursor: (page + 1) * PAGE >= total ? "default" : "pointer", fontSize: "0.78rem" }}
          >Next →</button>
        </div>
      )}
    </div>
  );
}

function CardGrid({ refreshTick }: { refreshTick: number }) {
  const toast = useToast();
  const [cards, setCards]     = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet<{ ok: boolean; items: Card[] }>("/api/ask/cards");
    if (r.ok) setCards(r.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshTick]);

  async function togglePin(card: Card) {
    const r = await apiPatch<{ ok: boolean; card: Card }>(`/api/ask/cards/${card.id}`, { pinned: !card.pinned });
    if (r.ok) {
      setCards(cs =>
        cs.map(c => c.id === card.id ? { ...c, pinned: !card.pinned } : c)
          .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)),
      );
      toast(card.pinned ? "📌 Unpinned" : "📌 Pinned to Boardroom");
    }
  }

  async function deleteCard(card: Card) {
    const r = await apiDelete<{ ok: boolean }>(`/api/ask/cards/${card.id}`);
    if (r.ok) { setCards(cs => cs.filter(c => c.id !== card.id)); toast("🗑️ Card deleted"); }
  }

  async function exportCard(cardId: number) {
    setExporting(cardId);
    try {
      const resp = await fetch(`/api/ask/cards/${cardId}/export`);
      if (!resp.ok) { toast("⚠️ Export failed"); return; }
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `infogenie-brief-${cardId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(null); }
  }

  if (loading && !cards.length) return <div style={{ color: "#9CA3AF", padding: 20, textAlign: "center" }}>⏳ Loading cards…</div>;

  if (!cards.length) {
    return (
      <div style={{ color: "#9CA3AF", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>🏛️</div>
        No Intelligence Cards saved yet.<br />
        <span style={{ fontSize: "0.8rem" }}>Ask a question and click <strong>☆ Save</strong> to create a card.</span>
      </div>
    );
  }

  const pinned   = cards.filter(c => c.pinned);
  const unpinned = cards.filter(c => !c.pinned);

  const renderGroup = (group: Card[], label?: string) => (
    <>
      {label && group.length > 0 && (
        <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8, marginTop: 14 }}>{label}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
        {group.map(card => {
          const aj = card.answer_json || {};
          return (
            <div key={card.id} style={{
              background: "#fff", border: `1px solid ${card.pinned ? "#FDE047" : "#E5E7EB"}`,
              borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 8,
              boxShadow: card.pinned ? "0 2px 12px rgba(250,204,21,.25)" : undefined,
            }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {card.pinned && <span>📌</span>}
                {card.mode === "boardroom" && (
                  <span style={{ background: '#eef4ff', color: "#E2E8F0", padding: "2px 7px", borderRadius: 10, fontSize: "0.62rem", fontWeight: 800 }}>🏛️</span>
                )}
                {typeof aj.confidence === "number" && (
                  <span style={{ fontSize: "0.64rem", color: "#6B7280" }}>
                    {aj.confidence >= 75 ? "🟢" : aj.confidence >= 50 ? "🟡" : "🔴"} {aj.confidence}%
                  </span>
                )}
                <span style={{ fontSize: "0.64rem", color: "#9CA3AF", marginLeft: "auto" }}>
                  {new Date(card.created_at).toLocaleDateString()}
                </span>
              </div>
              <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#0A1628", lineHeight: 1.35 }}>{card.question}</div>
              {aj.headline && <div style={{ fontSize: "0.76rem", color: "#6B7280", lineHeight: 1.4 }}>{aj.headline}</div>}
              {(aj.recommended_actions || []).length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {(aj.recommended_actions || []).slice(0, 2).map((a, i) => (
                    <span key={i} style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#166534", padding: "2px 8px", borderRadius: 10, fontSize: "0.64rem", fontWeight: 600 }}>{a.label}</span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
                <button onClick={() => exportCard(card.id)} disabled={exporting === card.id} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, color: "#374151" }}>
                  {exporting === card.id ? "⏳" : "⬇️ PDF"}
                </button>
                <button onClick={() => togglePin(card)} style={{ padding: "4px 9px", borderRadius: 6, border: `1px solid ${card.pinned ? "#FDE047" : "#E5E7EB"}`, background: card.pinned ? "#FEF9C3" : "#F9FAFB", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, color: card.pinned ? "#713F12" : "#374151" }}>
                  {card.pinned ? "📌 Unpin" : "📌 Pin"}
                </button>
                <button onClick={() => deleteCard(card)} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid #FECACA", background: "#FFF5F5", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, color: "#B91C1C" }}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div>
      {renderGroup(pinned, pinned.length && unpinned.length ? "📌 Pinned" : undefined)}
      {renderGroup(unpinned, pinned.length && unpinned.length ? "Recent" : undefined)}
    </div>
  );
}

export default function AskInfoGenie() {
  const toast = useToast();
  const [tab, setTab]               = useState<Tab>("ask");
  const [mode, setMode]             = useState<Mode>("standard");
  const [query, setQuery]           = useState("");
  const [asking, setAsking]         = useState(false);
  const [result, setResult]         = useState<AskResult | null>(null);
  const [askError, setAskError]     = useState<string | null>(null);
  const [starred, setStarred]       = useState(false);
  const [exporting, setExporting]   = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>({});
  const [reindexing, setReindexing] = useState(false);
  const [cardRefreshTick, setCardRefreshTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const s = await apiGet<IndexStatus>("/api/platform-search/index-status");
      if (s.ok) setIndexStatus(s);
    })();
  }, []);

  async function reindex() {
    setReindexing(true);
    const r = await apiPost<{ ok: boolean; chunks?: number; embedded?: number; error?: string }>("/api/platform-search/reindex");
    if (r.ok) {
      toast(`✅ Indexed ${r.chunks} chunks (${r.embedded} embedded)`);
      const s = await apiGet<IndexStatus>("/api/platform-search/index-status");
      if (s.ok) setIndexStatus(s);
    } else {
      toast("⚠️ " + (r.error || "Reindex failed"));
    }
    setReindexing(false);
  }

  async function ask(q?: string, overrideMode?: Mode) {
    const question = (q ?? query).trim();
    if (!question) return;
    if (q !== undefined) setQuery(q);
    setAsking(true);
    setResult(null);
    setAskError(null);
    setStarred(false);
    const j = await apiPost<AskResult>("/api/ask/ask", { question, mode: overrideMode ?? mode });
    setAsking(false);
    if (!j.ok) { setAskError(j.error || "Failed to get answer"); return; }
    setResult(j);
    setTab("ask");
  }

  async function saveCard() {
    if (!result) return;
    const r = await apiPost<{ ok: boolean; card?: Card }>("/api/ask/cards", {
      question: result.question || query,
      answer_json: result,
      mode: result.mode || mode,
    });
    if (r.ok) {
      setStarred(true);
      setCardRefreshTick(t => t + 1);
      toast("⭐ Saved as Intelligence Card");
    } else {
      toast("⚠️ Save failed");
    }
  }

  // Export any answer (standard OR boardroom) directly to PDF via POST /api/ask/export
  async function exportCurrentAnswer() {
    if (!result) return;
    setExporting(true);
    try {
      const resp = await fetch("/api/ask/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:    result.question || query,
          answer_json: result,
          mode:        result.mode || mode,
        }),
      });
      if (!resp.ok) { toast("⚠️ Export failed"); return; }
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const slug = String(result.question || query).slice(0, 40).replace(/[^a-z0-9]/gi, "-").toLowerCase();
      a.href = url; a.download = `infogenie-brief-${slug}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  const suggestions = mode === "boardroom" ? SUGGESTIONS_BOARDROOM : SUGGESTIONS_STANDARD;
  const indexedStr  = (indexStatus.indexed || 0) > 0
    ? `${indexStatus.indexed} chunks indexed`
    : "Not yet indexed";

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700,
    fontSize: "0.8rem", transition: "all .15s",
    background: tab === t ? (t === "boardroom" ? "#0F172A" : "linear-gradient(135deg,#0066FF,#7C3AED)") : "#F3F4F6",
    color: tab === t ? "#fff" : "#6B7280",
  });

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span> Executive AI Copilot
              </div>
              <h2 className="view-title">🧠 Executive AI Copilot</h2>
              <p className="view-sub">
                Ask questions in plain English — get structured answers with confidence scores, risk flags, evidence citations, effort/impact actions, and live campaign data. Boardroom mode adds a full executive brief with predictive intelligence.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20, paddingBottom: 56 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          <button style={tabStyle("ask")} onClick={() => setTab("ask")}>💬 Ask</button>
          <button style={tabStyle("history")} onClick={() => setTab("history")}>🗂️ History</button>
          <button style={tabStyle("boardroom")} onClick={() => setTab("boardroom")}>🏛️ Boardroom</button>
        </div>

        {/* ASK TAB */}
        {tab === "ask" && (
          <>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 18, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ background: "linear-gradient(135deg,#0066FF,#7C3AED)", borderRadius: 8, padding: "4px 10px", fontSize: "0.66rem", fontWeight: 800, color: "#fff", letterSpacing: ".04em" }}>⚡ AI COPILOT</div>
                  <span style={{ fontSize: "0.73rem", color: "#9CA3AF" }}>{indexedStr}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ display: "flex", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
                    {(["standard", "boardroom"] as Mode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        style={{
                          padding: "5px 12px", border: 0, cursor: "pointer", fontSize: "0.74rem", fontWeight: 700, transition: "all .15s",
                          background: mode === m ? (m === "boardroom" ? "#0F172A" : "#EEF2FF") : "transparent",
                          color: mode === m ? (m === "boardroom" ? "#fff" : "#4F46E5") : "#9CA3AF",
                        }}
                      >
                        {m === "boardroom" ? "🏛️ Boardroom" : "💬 Standard"}
                      </button>
                    ))}
                  </div>
                  <button onClick={reindex} disabled={reindexing} style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#374151", padding: "5px 11px", borderRadius: 7, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>
                    {reindexing ? "⏳ Indexing…" : "🔄 Re-index"}
                  </button>
                </div>
              </div>

              {mode === "boardroom" && (
                <div style={{ background: "rgba(15, 118, 110, 0.08)", border: "1px solid rgba(15, 118, 110, 0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: "0.75rem", color: "#334155" }}>
                  <strong style={{ color: "#0f766e" }}>Boardroom mode</strong> — two AI passes: analyst answer + executive brief with key metrics, strategic implications, risks &amp; mitigants, and board actions with owners and timelines. Includes predictive intelligence signals.
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") ask(); }}
                  placeholder={mode === "boardroom"
                    ? "e.g. Summarise our marketing performance for the board…"
                    : "e.g. What is my ROAS by campaign? · Which leads should I call first?"}
                  style={{ flex: 1, padding: "11px 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.9rem" }}
                />
                <button
                  onClick={() => ask()}
                  disabled={asking}
                  style={{
                    background:
                      mode === "boardroom"
                        ? "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)"
                        : "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
                    color: "#ffffff",
                    WebkitTextFillColor: "#ffffff",
                    border: 0,
                    padding: "11px 22px",
                    borderRadius: 8,
                    fontWeight: 800,
                    cursor: asking ? "default" : "pointer",
                    fontSize: "0.92rem",
                    opacity: asking ? 0.7 : 1,
                    whiteSpace: "nowrap",
                    boxShadow: "0 8px 18px rgba(15, 118, 110, 0.22)",
                  }}
                >
                  {asking ? "…" : mode === "boardroom" ? "Brief →" : "Ask →"}
                </button>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {suggestions.map(s => (
                  <button key={s} onClick={() => ask(s)} style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#374151", padding: "4px 10px", borderRadius: 14, fontSize: "0.72rem", cursor: "pointer" }}>{s}</button>
                ))}
              </div>
            </div>

            {asking && (
              <div style={{ color: "#9CA3AF", display: "flex", alignItems: "center", gap: 8, padding: 16 }}>
                <span>🔍</span>
                {mode === "boardroom" ? "Running analyst + board brief with live data + predictive intelligence…" : "Searching your data and live campaign metrics…"}
              </div>
            )}
            {askError && <div style={{ color: "#DC2626", padding: "10px 0" }}>{askError}</div>}
            {result && !asking && (
              <AnswerBubble
                result={result}
                onStar={saveCard}
                onExport={exportCurrentAnswer}
                starred={starred}
                exporting={exporting}
              />
            )}
          </>
        )}

        {tab === "history" && (
          <HistoryTab onReask={(q, m) => { setMode(m); ask(q, m); }} />
        )}

        {tab === "boardroom" && (
          <CardGrid refreshTick={cardRefreshTick} />
        )}
      </div>
    </div>
  );
}
