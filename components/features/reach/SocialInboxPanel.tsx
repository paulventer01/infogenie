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
}

interface Message {
  id: number | string;
  direction: string;
  body: string;
  sent_at?: string | null;
}

const PLAT_ICON: Record<string, string> = {
  instagram: "📷",
  facebook: "📘",
  tiktok: "🎵",
  linkedin: "💼",
  twitter: "𝕏",
};

export default function SocialInboxPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [source, setSource] = useState("demo");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const st = await apiGet<{ ok: boolean; provider?: string; note?: string; configured?: boolean }>("/api/social-inbox/status");
    if (st.ok) {
      setSource(st.provider || "demo");
      setNote(st.note || "");
    }
    const r = await apiGet<{ ok: boolean; threads?: Thread[]; error?: string }>("/api/social-inbox/threads");
    if (!r.ok) {
      setError(r.error || "Failed to load");
      setThreads([]);
      return;
    }
    setError(null);
    setThreads(r.threads || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openThread(t: Thread) {
    setSelected(t);
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

  async function sync() {
    setBusy(true);
    await apiPost("/api/social-inbox/sync", {});
    setBusy(false);
    load();
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: "Sora,sans-serif", fontSize: "0.95rem", color: "#0A1628" }}>
            💬 Social inbox
          </h3>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            DMs &amp; comments · {source === "omnisocials" ? "OmniSocials live" : "Demo mode"}
            {note ? ` — ${note}` : ""}
          </div>
        </div>
        <button type="button" onClick={sync} disabled={busy} style={ghostBtn}>
          🔄 Sync
        </button>
      </div>

      {error && <div style={{ color: "#991B1B", fontSize: "0.78rem", marginBottom: 8 }}>⚠ {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12, minHeight: 320 }}>
        <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
          {!threads.length ? (
            <div style={{ padding: 16, color: "#9CA3AF", fontSize: "0.78rem" }}>No conversations yet.</div>
          ) : (
            threads.map((t) => {
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
                    border: "none",
                    borderBottom: "1px solid #F1F5F9",
                    background: on ? "#FFF7ED" : "#fff",
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.78rem", color: "#0A1628" }}>
                      {PLAT_ICON[t.platform] || "💬"} {t.author || "Unknown"}
                    </div>
                    {t.unread && (
                      <span style={{ background: "#FF5722", color: "#fff", borderRadius: 8, fontSize: "0.6rem", fontWeight: 800, padding: "1px 6px" }}>
                        NEW
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.preview}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column" }}>
          {!selected ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.78rem", margin: "auto" }}>Select a conversation</div>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0A1628", marginBottom: 8 }}>
                {PLAT_ICON[selected.platform] || "💬"} {selected.author} · {selected.thread_type || "dm"}
              </div>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
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
