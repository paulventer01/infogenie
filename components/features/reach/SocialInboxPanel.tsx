"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

interface Thread {
  id: number | string;
  platform: string;
  thread_type?: string;
  author?: string;
  preview?: string;
  unread?: boolean;
  status?: string;
  last_message_at?: string | null;
  triage_status?: string;
  priority?: string;
  assignee?: string | null;
  labels?: string[];
}

interface Message {
  id: number | string;
  direction: string;
  body: string;
  sent_at?: string | null;
}

type ViewMode = "list" | "board";

const PLAT_ICON: Record<string, string> = {
  instagram: "📷",
  facebook: "📘",
  tiktok: "🎵",
  linkedin: "💼",
  twitter: "𝕏",
};

const TRIAGE_COLS = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting", label: "Waiting" },
  { id: "closed", label: "Closed" },
] as const;

const PRI_COLOR: Record<string, { bg: string; fg: string }> = {
  p0: { bg: "#FEE2E2", fg: "#991B1B" },
  p1: { bg: "#FFEDD5", fg: "#9A3412" },
  p2: { bg: "#E0F2FE", fg: "#075985" },
  p3: { bg: "#F3F4F6", fg: "#6B7280" },
};

export default function SocialInboxPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [columns, setColumns] = useState<Record<string, Thread[]>>({});
  const [source, setSource] = useState("demo");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("board");
  const [assigneeDraft, setAssigneeDraft] = useState("");

  const load = useCallback(async () => {
    const st = await apiGet<{ ok: boolean; provider?: string; note?: string; configured?: boolean }>("/api/social-inbox/status");
    if (st.ok) {
      setSource(st.provider || "demo");
      setNote(st.note || "");
    }
    const [listR, boardR] = await Promise.all([
      apiGet<{ ok: boolean; threads?: Thread[]; error?: string }>("/api/social-inbox/threads"),
      apiGet<{ ok: boolean; columns?: Record<string, Thread[]>; error?: string }>("/api/social-inbox/board"),
    ]);
    if (!listR.ok) {
      setError(listR.error || "Failed to load");
      setThreads([]);
      return;
    }
    setError(null);
    setThreads(listR.threads || []);
    if (boardR.ok) setColumns(boardR.columns || {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openThread(t: Thread) {
    setSelected(t);
    setAssigneeDraft(t.assignee || "");
    setMessages([]);
    const r = await apiGet<{ ok: boolean; messages?: Message[]; error?: string }>(
      `/api/social-inbox/threads/${encodeURIComponent(String(t.id))}/messages`,
    );
    if (r.ok) setMessages(r.messages || []);
    else setError(r.error || "Failed to load messages");
    if (t.unread) {
      await apiPatch(`/api/social-inbox/threads/${encodeURIComponent(String(t.id))}`, { unread: false, status: t.status || "new" });
      load();
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    const r = await apiPost<{ ok: boolean; error?: string }>(
      `/api/social-inbox/threads/${encodeURIComponent(String(selected.id))}/reply`,
      { body: reply.trim() },
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Reply failed");
      return;
    }
    setReply("");
    openThread(selected);
    load();
  }

  async function patchThread(id: number | string, body: Record<string, unknown>) {
    setBusy(true);
    const r = await apiPatch<{ ok: boolean; thread?: Thread; error?: string }>(
      `/api/social-inbox/threads/${encodeURIComponent(String(id))}`,
      body,
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Update failed");
      return;
    }
    if (r.thread) setSelected(r.thread);
    load();
  }

  async function autoTriage() {
    setBusy(true);
    const r = await apiPost<{ ok: boolean; updated?: number; error?: string }>("/api/social-inbox/triage/auto", {});
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Auto-triage failed");
      return;
    }
    setError(null);
    load();
  }

  async function sync() {
    setBusy(true);
    await apiPost("/api/social-inbox/sync", {});
    setBusy(false);
    load();
  }

  function PriorityBadge({ p }: { p?: string }) {
    const key = (p || "p2").toLowerCase();
    const c = PRI_COLOR[key] || PRI_COLOR.p2;
    return (
      <span style={{ background: c.bg, color: c.fg, borderRadius: 4, fontSize: "0.58rem", fontWeight: 800, padding: "1px 5px", textTransform: "uppercase" }}>
        {key}
      </span>
    );
  }

  function ThreadCard({ t, compact }: { t: Thread; compact?: boolean }) {
    const on = selected && String(selected.id) === String(t.id);
    return (
      <button
        key={String(t.id)}
        type="button"
        onClick={() => openThread(t)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          border: compact ? "1px solid #E5E7EB" : "none",
          borderBottom: compact ? undefined : "1px solid #F1F5F9",
          borderRadius: compact ? 8 : 0,
          background: on ? "#FFF7ED" : "#fff",
          padding: compact ? "8px 10px" : "10px 12px",
          cursor: "pointer",
          marginBottom: compact ? 6 : 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: "0.76rem", color: "#0A1628" }}>
            {PLAT_ICON[t.platform] || "💬"} {t.author || "Unknown"}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <PriorityBadge p={t.priority} />
            {t.unread && (
              <span style={{ background: "#FF5722", color: "#fff", borderRadius: 8, fontSize: "0.58rem", fontWeight: 800, padding: "1px 5px" }}>
                NEW
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.preview}
        </div>
        {(t.labels?.length || t.assignee) && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {t.assignee && (
              <span style={{ fontSize: "0.58rem", color: "#374151", background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>@{t.assignee}</span>
            )}
            {(t.labels || []).slice(0, 3).map((l) => (
              <span key={l} style={{ fontSize: "0.58rem", color: "#0D9488", background: "#CCFBF1", padding: "1px 5px", borderRadius: 4 }}>{l}</span>
            ))}
          </div>
        )}
      </button>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: "Sora,sans-serif", fontSize: "0.95rem", color: "#0A1628" }}>
            💬 Social inbox
          </h3>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            Issue-style triage · {source === "omnisocials" ? "OmniSocials live" : "Demo mode"}
            {note ? ` — ${note}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setView(view === "board" ? "list" : "board")} style={ghostBtn}>
            {view === "board" ? "☰ List" : "▦ Board"}
          </button>
          <button type="button" onClick={autoTriage} disabled={busy} style={ghostBtn}>
            ✦ Auto-triage
          </button>
          <button type="button" onClick={sync} disabled={busy} style={ghostBtn}>
            🔄 Sync
          </button>
        </div>
      </div>

      {error && <div style={{ color: "#991B1B", fontSize: "0.78rem", marginBottom: 8 }}>⚠ {error}</div>}

      {view === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: 10, marginBottom: 14, overflowX: "auto" }}>
          {TRIAGE_COLS.map((col) => (
            <div key={col.id} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: 8, minHeight: 160 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#374151", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                <span>{col.label}</span>
                <span style={{ color: "#9CA3AF" }}>{(columns[col.id] || []).length}</span>
              </div>
              {(columns[col.id] || []).map((t) => (
                <ThreadCard key={String(t.id)} t={t} compact />
              ))}
              {!(columns[col.id] || []).length && (
                <div style={{ fontSize: "0.68rem", color: "#D1D5DB", fontStyle: "italic", padding: 4 }}>Empty</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: view === "list" ? "1fr 1.2fr" : "1fr", gap: 12, minHeight: view === "list" ? 320 : undefined }}>
        {view === "list" && (
          <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
            {!threads.length ? (
              <div style={{ padding: 16, color: "#9CA3AF", fontSize: "0.78rem" }}>No conversations yet.</div>
            ) : (
              threads.map((t) => <ThreadCard key={String(t.id)} t={t} />)
            )}
          </div>
        )}

        <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", minHeight: 280 }}>
          {!selected ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.78rem", margin: "auto" }}>Select a conversation to triage</div>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0A1628", marginBottom: 6 }}>
                {PLAT_ICON[selected.platform] || "💬"} {selected.author} · {selected.thread_type || "dm"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
                <PriorityBadge p={selected.priority} />
                <select
                  value={selected.priority || "p2"}
                  onChange={(e) => patchThread(selected.id, { priority: e.target.value })}
                  style={selectStyle}
                >
                  {["p0", "p1", "p2", "p3"].map((p) => (
                    <option key={p} value={p}>{p.toUpperCase()}</option>
                  ))}
                </select>
                <select
                  value={selected.triage_status || "open"}
                  onChange={(e) => patchThread(selected.id, { triage_status: e.target.value })}
                  style={selectStyle}
                >
                  {TRIAGE_COLS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <input
                  value={assigneeDraft}
                  onChange={(e) => setAssigneeDraft(e.target.value)}
                  onBlur={() => {
                    if ((selected.assignee || "") !== assigneeDraft.trim()) {
                      patchThread(selected.id, { assignee: assigneeDraft.trim() || null });
                    }
                  }}
                  placeholder="Assignee"
                  style={{ ...selectStyle, width: 110 }}
                />
                {selected.triage_status !== "closed" ? (
                  <button type="button" disabled={busy} onClick={() => patchThread(selected.id, { triage_status: "closed" })} style={ghostBtn}>
                    Close
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => patchThread(selected.id, { triage_status: "open" })} style={ghostBtn}>
                    Reopen
                  </button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, maxHeight: 220 }}>
                {messages.map((m) => (
                  <div
                    key={String(m.id)}
                    style={{
                      alignSelf: m.direction === "outbound" ? "flex-end" : "flex-start",
                      background: m.direction === "outbound" ? "#ECFDF5" : "#F3F4F6",
                      color: "#0A1628",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: "0.78rem",
                      maxWidth: "85%",
                      lineHeight: 1.45,
                    }}
                  >
                    {m.body}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  style={{ flex: 1, padding: 8, border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem" }}
                />
                <button type="button" onClick={sendReply} disabled={busy || !reply.trim()} style={primaryBtn}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const selectStyle: CSSProperties = {
  padding: "4px 6px",
  border: "1px solid #D1D5DB",
  borderRadius: 5,
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#374151",
  background: "#fff",
};

const ghostBtn: CSSProperties = {
  background: "#F3F4F6",
  border: "1px solid #E5E7EB",
  color: "#374151",
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
};

const primaryBtn: CSSProperties = {
  background: "#FF5722",
  color: "#fff",
  border: "none",
  padding: "8px 14px",
  borderRadius: 6,
  fontSize: "0.74rem",
  fontWeight: 800,
  cursor: "pointer",
};
