"use client";

// Native React port of the legacy `unified-inbox` panel (was
// `window.buildUnifiedInbox` in public/js/ig_seo.js + `#view-unified-inbox` in
// index.html). One inbox-style stream across Reddit, Twitter/X, Reviews, Quora,
// Glassdoor, Newsletters, Chatbot and Gmail, backed by the existing Express API
// (`/api/unified-inbox/*` and `/api/integrations/workspace/gmail/*`) via
// `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { showToast } from "@/hooks/useToast";

interface InboxItem {
  id: number;
  source: string;
  status: string;
  sentiment?: string;
  author?: string;
  title?: string;
  content?: string;
  notes?: string;
  source_url?: string;
  occurred_at?: string;
  ingested_at?: string;
}

interface ListResult {
  ok: boolean;
  error?: string;
  items: InboxItem[];
}

interface InboxStats {
  total?: number;
  status?: { new?: number; replied?: number; resolved?: number; snoozed?: number };
}

interface StatsResult {
  ok: boolean;
  stats?: InboxStats;
}

interface IngestResult {
  ok: boolean;
  error?: string;
  counts?: Record<string, number>;
}

interface GmailThread {
  id: string;
  unread?: boolean;
  from: string;
  subject: string;
  snippet?: string;
  date?: string;
  messageCount?: number;
}

interface GmailThreadsResult {
  ok: boolean;
  error?: string;
  threads: GmailThread[];
}

interface GmailMessage {
  from: string;
  to: string;
  date?: string;
  body?: string;
  snippet?: string;
}

interface GmailThreadResult {
  ok: boolean;
  error?: string;
  messages: GmailMessage[];
}

const SOURCES = [
  { k: "", label: "All sources", emoji: "📬" },
  { k: "gmail", label: "Gmail", emoji: "📧" },
  { k: "reddit", label: "Reddit", emoji: "👽" },
  { k: "twitter", label: "Twitter/X", emoji: "🐦" },
  { k: "review", label: "Reviews", emoji: "⭐" },
  { k: "quora", label: "Quora", emoji: "❓" },
  { k: "glassdoor", label: "Glassdoor", emoji: "🏢" },
  { k: "newsletter", label: "Newsletters", emoji: "📧" },
  { k: "chatbot", label: "Chatbot", emoji: "💬" },
];

const STATUSES = [
  { k: "", label: "All" },
  { k: "new", label: "New" },
  { k: "replied", label: "Replied" },
  { k: "resolved", label: "Resolved" },
  { k: "snoozed", label: "Snoozed" },
];

const SENT_DOT: Record<string, string> = { positive: "#16a34a", negative: "#dc2626", neutral: "#94a3b8" };

const BADGE_CSS = `.uibox-badge{font-size:0.72rem;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px}
.uibox-st-new{background:#e0f2fe;color:#0369a1}
.uibox-st-replied{background:#f1f5f9;color:#475569}
.uibox-st-resolved{background:#dcfce7;color:#166534}
.uibox-st-snoozed{background:#fef3c7;color:#92400e}`;

function sourceEmoji(k: string): string {
  return (SOURCES.find((s) => s.k === k) || {}).emoji || "•";
}

function fmtDate(d?: string): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

function safeUrl(u: string): string {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.href : "#";
  } catch {
    return "#";
  }
}

interface ReplyTarget {
  threadId: string;
  to: string;
  subject: string;
}

export default function UnifiedInbox() {
  const router = useRouter();

  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [q, setQ] = useState("");

  const [stats, setStats] = useState<InboxStats | null>(null);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [gmailThreads, setGmailThreads] = useState<GmailThread[] | null>(null);
  const [gmailNotConnected, setGmailNotConnected] = useState(false);
  const [gmailError, setGmailError] = useState("");
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [threadBodies, setThreadBodies] = useState<Record<string, GmailMessage[] | "loading" | "error">>({});

  const [ingesting, setIngesting] = useState(false);

  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replySending, setReplySending] = useState(false);

  async function loadStats() {
    const r = await apiGet<StatsResult>("/api/unified-inbox/stats");
    if (r.ok) setStats(r.stats || {});
  }

  async function loadGmail() {
    setGmailThreads(null);
    setGmailNotConnected(false);
    setGmailError("");
    const r = await apiGet<GmailThreadsResult>("/api/integrations/workspace/gmail/threads?max=20");
    if (!r.ok) {
      const notConn = !!r.error && (r.error.includes("not connected") || r.error.includes("token_refresh"));
      if (notConn) setGmailNotConnected(true);
      else setGmailError(r.error || "unknown");
      setGmailThreads([]);
      return;
    }
    setGmailThreads(r.threads || []);
  }

  async function load() {
    if (source === "gmail") {
      setItems(null);
      loadGmail();
      return;
    }
    setGmailThreads(null);
    setItems(null);
    setLoadError(false);
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (status) params.set("status", status);
    if (sentiment) params.set("sentiment", sentiment);
    if (q) params.set("q", q);
    params.set("limit", "100");
    const r = await apiGet<ListResult>("/api/unified-inbox/list?" + params.toString());
    if (!r.ok) {
      setItems([]);
      setLoadError(true);
      return;
    }
    setItems(r.items || []);
  }

  useEffect(() => {
    loadStats();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, status, sentiment]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (source !== "gmail") load();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function toggleThread(tid: string) {
    if (expandedThread === tid) {
      setExpandedThread(null);
      return;
    }
    setExpandedThread(tid);
    if (threadBodies[tid] && threadBodies[tid] !== "error") return;
    setThreadBodies((m) => ({ ...m, [tid]: "loading" }));
    const r = await apiGet<GmailThreadResult>(`/api/integrations/workspace/gmail/threads/${encodeURIComponent(tid)}`);
    if (!r.ok) {
      setThreadBodies((m) => ({ ...m, [tid]: "error" }));
      return;
    }
    setThreadBodies((m) => ({ ...m, [tid]: r.messages || [] }));
  }

  async function sendReply() {
    if (!reply) return;
    if (!replyBody.trim()) {
      alert("Please type a reply first.");
      return;
    }
    setReplySending(true);
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/integrations/workspace/gmail/reply", {
      threadId: reply.threadId,
      to: reply.to,
      subject: reply.subject,
      body: replyBody,
    });
    setReplySending(false);
    if (r.ok) {
      setReply(null);
      setReplyBody("");
      showToast("✅ Reply sent via Gmail");
    } else {
      alert("Failed to send: " + (r.error || "unknown"));
    }
  }

  async function changeStatus(id: number, value: string) {
    setItems((prev) => (prev ? prev.map((it) => (it.id === id ? { ...it, status: value } : it)) : prev));
    await apiPatch("/api/unified-inbox/" + id, { status: value });
    loadStats();
  }

  async function addNote(id: number) {
    const note = prompt("Note:");
    if (note == null) return;
    await apiPatch("/api/unified-inbox/" + id, { notes: note });
    load();
  }

  async function deleteItem(id: number) {
    if (!confirm("Delete this inbox item?")) return;
    await apiDelete("/api/unified-inbox/" + id);
    load();
    loadStats();
  }

  async function ingest() {
    setIngesting(true);
    const r = await apiPost<IngestResult>("/api/unified-inbox/ingest");
    setIngesting(false);
    if (r.ok) {
      const c = r.counts || {};
      const summary =
        Object.entries(c)
          .filter(([k, v]) => !k.endsWith("_error") && v > 0)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ") || "no new items";
      alert("Pulled: " + summary);
    } else {
      alert("Failed: " + (r.error || "unknown"));
    }
    load();
    loadStats();
  }

  const st = stats?.status || {};

  return (
    <div className="view-header-wrap">
      <style>{BADGE_CSS}</style>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Unified Inbox
              </div>
              <h2 className="view-title">📬 Unified Conversation Inbox</h2>
              <p className="view-sub">
                Every conversation surface InfoGenie monitors — Reddit, Twitter/X, Reviews, Quora, Glassdoor, Newsletter
                mentions, Chatbot — pulled into one inbox-style stream. Filter by source, status, sentiment. Mark items
                replied / resolved / snoozed and never lose track of who said what.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div className="dna-card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Inbox</div>
              <div style={{ color: "#64748b", fontSize: "0.85rem", marginTop: 2 }}>
                {stats === null ? (
                  "Loading…"
                ) : (
                  <>
                    <strong>{stats.total || 0}</strong> items ·{" "}
                    <span style={{ color: "#0ea5e9" }}>{st.new || 0} new</span> ·{" "}
                    <span style={{ color: "#64748b" }}>{st.replied || 0} replied</span> ·{" "}
                    <span style={{ color: "#16a34a" }}>{st.resolved || 0} resolved</span> ·{" "}
                    <span style={{ color: "#94a3b8" }}>{st.snoozed || 0} snoozed</span>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" onClick={ingest} disabled={ingesting}>
                {ingesting ? "⏳ Refreshing…" : "🔄 Refresh from sources"}
              </button>
            </div>
          </div>
        </div>

        <div className="dna-card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Search</label>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="title, content or author…"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid var(--border-color,#e2e8f0)",
                  borderRadius: 6,
                  background: "var(--card-bg,#fff)",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid var(--border-color,#e2e8f0)", borderRadius: 6, background: "var(--card-bg,#fff)" }}
              >
                {SOURCES.map((s) => (
                  <option key={s.k} value={s.k}>
                    {s.emoji + " " + s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid var(--border-color,#e2e8f0)", borderRadius: 6, background: "var(--card-bg,#fff)" }}
              >
                {STATUSES.map((s) => (
                  <option key={s.k} value={s.k}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Sentiment</label>
              <select
                value={sentiment}
                onChange={(e) => setSentiment(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid var(--border-color,#e2e8f0)", borderRadius: 6, background: "var(--card-bg,#fff)" }}
              >
                <option value="">Any</option>
                <option value="positive">😀 Positive</option>
                <option value="neutral">😐 Neutral</option>
                <option value="negative">😠 Negative</option>
              </select>
            </div>
          </div>
        </div>

        <div className="dna-card" style={{ padding: 0 }}>
          {source === "gmail" ? renderGmail() : renderItems()}
        </div>
      </div>

      {reply && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setReply(null);
          }}
        >
          <div style={{ background: "var(--card-bg,#fff)", borderRadius: 14, padding: 24, maxWidth: 560, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>↩ Reply via Gmail</div>
            <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: 16 }}>
              To: {reply.to} ·{" "}
              {reply.subject ? (reply.subject.startsWith("Re:") ? reply.subject : "Re: " + reply.subject) : "Re:"}
            </div>
            <textarea
              rows={6}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type your reply…"
              style={{
                width: "100%",
                padding: 10,
                border: "1.5px solid #e2e8f0",
                borderRadius: 8,
                fontFamily: "inherit",
                fontSize: "0.9rem",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                onClick={() => setReply(null)}
                style={{ padding: "8px 16px", background: "var(--bg-secondary,#f1f5f9)", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={sendReply}
                disabled={replySending}
                style={{ padding: "8px 18px", background: "#0ea5e9", color: "white", border: 0, borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
              >
                {replySending ? "Sending…" : "📤 Send Reply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderGmail() {
    if (gmailThreads === null) {
      return <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>Loading Gmail threads…</div>;
    }
    if (gmailNotConnected) {
      return (
        <div style={{ padding: "48px 32px", textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>📧</div>
          <strong>Google Workspace not connected</strong>
          <br />
          <span style={{ fontSize: "0.85rem" }}>
            Go to{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goToView(router, "settings");
              }}
            >
              Settings → Google Workspace
            </a>{" "}
            and click <strong>Connect via OAuth</strong> to enable Gmail in your inbox.
          </span>
        </div>
      );
    }
    if (gmailError) {
      return <div style={{ padding: 32, textAlign: "center", color: "#dc2626" }}>Failed to load Gmail: {gmailError}</div>;
    }
    if (!gmailThreads.length) {
      return (
        <div style={{ padding: "48px 32px", textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>📭</div>No Gmail threads found.
        </div>
      );
    }
    return gmailThreads.map((t) => {
      const body = threadBodies[t.id];
      return (
        <div
          key={t.id}
          className="uibox-row"
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-color,#e2e8f0)",
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
            cursor: "pointer",
          }}
          onClick={() => toggleThread(t.id)}
        >
          <div
            title={t.unread ? "Unread" : "Read"}
            style={{ width: 10, height: 10, borderRadius: "50%", background: t.unread ? "#0ea5e9" : "#cbd5e1", marginTop: 7, flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: "0.78rem", background: "var(--bg-secondary,#f1f5f9)", padding: "2px 8px", borderRadius: 10 }}>
                📧 gmail
              </span>
              {t.unread ? <span className="uibox-badge uibox-st-new">new</span> : null}
              <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                {t.from.replace(/<[^>]+>/g, "").trim() || "Unknown"}
              </span>
              <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>· {t.date ? new Date(t.date).toLocaleString() : ""}</span>
              {t.messageCount && t.messageCount > 1 ? (
                <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>· {t.messageCount} messages</span>
              ) : null}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.subject}</div>
            <div style={{ color: "#475569", fontSize: "0.9rem" }}>{String(t.snippet || "").slice(0, 200)}</div>
            {expandedThread === t.id && (
              <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                {body === "loading" ? (
                  <div style={{ color: "#64748b", fontSize: "0.85rem" }}>Loading thread…</div>
                ) : body === "error" || body === undefined ? (
                  <div style={{ color: "#dc2626", fontSize: "0.85rem" }}>Failed to load thread.</div>
                ) : (
                  body.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 10,
                        padding: "10px 12px",
                        background: "var(--bg-secondary,#f8fafc)",
                        borderLeft: "3px solid #0ea5e9",
                        borderRadius: "0 6px 6px 0",
                      }}
                    >
                      <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 4 }}>
                        <strong>{m.from}</strong> → {m.to} · {m.date ? new Date(m.date).toLocaleString() : ""}
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {m.body || m.snippet || ""}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            <button
              className="btn btn-link"
              onClick={(e) => {
                e.stopPropagation();
                setReply({ threadId: t.id, to: t.from, subject: t.subject });
                setReplyBody("");
              }}
              style={{ fontSize: "0.78rem", padding: "4px 8px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, color: "#0369a1", cursor: "pointer" }}
            >
              ↩ Reply
            </button>
          </div>
        </div>
      );
    });
  }

  function renderItems() {
    if (items === null) {
      return <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>Loading…</div>;
    }
    if (loadError) {
      return <div style={{ padding: 32, textAlign: "center", color: "#dc2626" }}>Failed to load.</div>;
    }
    if (!items.length) {
      return (
        <div style={{ padding: "48px 32px", textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>📭</div>
          Inbox empty for these filters.
          <br />
          <span style={{ fontSize: "0.85rem" }}>
            Hit <strong>Refresh from sources</strong> above to pull from Reddit Pulse, Twitter/X Pulse, Reviews, Quora,
            Glassdoor, Newsletter mentions and Chatbot conversations.
          </span>
        </div>
      );
    }
    return items.map((it) => {
      const dot = SENT_DOT[it.sentiment || ""] || "#cbd5e1";
      return (
        <div
          key={it.id}
          className="uibox-row"
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-color,#e2e8f0)",
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <div title={it.sentiment || "unknown"} style={{ width: 10, height: 10, borderRadius: "50%", background: dot, marginTop: 7, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: "0.78rem", background: "var(--bg-secondary,#f1f5f9)", padding: "2px 8px", borderRadius: 10 }}>
                {sourceEmoji(it.source) + " " + it.source}
              </span>
              <span className={`uibox-badge uibox-st-${it.status}`}>{it.status}</span>
              <span style={{ fontSize: "0.78rem", color: "#64748b" }}>{it.author || "Anonymous"}</span>
              <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>· {fmtDate(it.occurred_at || it.ingested_at)}</span>
              {it.source_url ? (
                <a
                  href={safeUrl(it.source_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 8, fontSize: "0.78rem", color: "#0ea5e9" }}
                >
                  open ↗
                </a>
              ) : null}
            </div>
            {it.title ? <div style={{ fontWeight: 600, marginBottom: 2 }}>{it.title}</div> : null}
            {it.content ? (
              <div style={{ color: "#475569", fontSize: "0.9rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {String(it.content).slice(0, 400)}
                {it.content.length > 400 ? "…" : ""}
              </div>
            ) : null}
            {it.notes ? (
              <div style={{ marginTop: 6, padding: "6px 10px", background: "var(--bg-secondary,#f8fafc)", borderLeft: "3px solid #0ea5e9", fontSize: "0.82rem", color: "#475569" }}>
                <strong>Note:</strong> {it.notes}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            <select
              value={it.status}
              onChange={(e) => changeStatus(it.id, e.target.value)}
              style={{ padding: "4px 8px", border: "1px solid var(--border-color,#e2e8f0)", borderRadius: 4, fontSize: "0.78rem", background: "var(--card-bg,#fff)" }}
            >
              {["new", "replied", "resolved", "snoozed"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="btn btn-link" onClick={() => addNote(it.id)} style={{ fontSize: "0.78rem", padding: "2px 6px" }}>
              📝 Note
            </button>
            <button className="btn btn-link" onClick={() => deleteItem(it.id)} style={{ fontSize: "0.78rem", padding: "2px 6px", color: "#dc2626" }}>
              🗑
            </button>
          </div>
        </div>
      );
    });
  }
}
