"use client";

// Native React port of the legacy `whatsapp` panel (was `window.buildWhatsApp`
// in public/js/ig_studio.js + the `#view-whatsapp` container in index.html).
//
// Sends and receives WhatsApp messages via the Meta Cloud API against the
// existing Express endpoints (all via `lib/api`):
//   GET    /api/whatsapp/status
//   GET    /api/whatsapp/threads
//   GET    /api/whatsapp/thread/:wa
//   POST   /api/whatsapp/send                {to, text}
//   POST   /api/whatsapp/send-bulk           {templateId, name, recipients}
//   GET    /api/whatsapp/templates
//   POST   /api/whatsapp/templates           {name, language, body, isMetaApproved}
//   DELETE /api/whatsapp/templates/:id
//   GET    /api/whatsapp/campaigns
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface WaStatus {
  ok: boolean;
  configured?: boolean;
  phoneNumberId?: string;
}
interface WaThread {
  wa_id: string;
  name?: string;
  preview?: string;
}
interface WaMessage {
  direction: string;
  body?: string;
  created_at: string;
  status?: string;
}
interface WaTemplate {
  id: number;
  name: string;
  language: string;
  var_count: number;
  is_meta_approved: boolean;
  body: string;
}
interface WaCampaign {
  name: string;
  template_name?: string;
  sent: number;
  total: number;
  failed: number;
  status: string;
}

function toast(msg: string, kind: "ok" | "err" = "ok") {
  const fn = (window as unknown as { showToast?: (m: string) => void }).showToast;
  if (fn) fn((kind === "err" ? "⚠️ " : "") + msg);
  else alert(msg);
}

const card: React.CSSProperties = {
  background: "white",
  border: "1px solid #E5E7EB",
  borderRadius: 12,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 9,
  border: "1.5px solid #E5E7EB",
  borderRadius: 8,
  margin: "4px 0",
  boxSizing: "border-box",
};

export default function Whatsapp() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [threads, setThreads] = useState<WaThread[] | null>(null);
  const [threadsErr, setThreadsErr] = useState("");
  const [activeWa, setActiveWa] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaMessage[] | null>(null);
  const [threadErr, setThreadErr] = useState("");
  const [reply, setReply] = useState("");

  const [modal, setModal] = useState<"tpls" | "bulk" | "new" | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const loadThreads = useCallback(async () => {
    setThreadsErr("");
    const r = await apiGet<{ ok: boolean; error?: string; threads?: WaThread[] }>(
      "/api/whatsapp/threads",
    );
    if (!r.ok) {
      setThreadsErr(r.error || "failed");
      setThreads([]);
      return;
    }
    setThreads(r.threads || []);
  }, []);

  useEffect(() => {
    (async () => {
      const st = await apiGet<WaStatus>("/api/whatsapp/status");
      setStatus(st);
    })();
    loadThreads();
  }, [loadThreads]);

  async function openThread(wa: string) {
    setActiveWa(wa);
    setMessages(null);
    setThreadErr("");
    setReply("");
    const r = await apiGet<{
      ok: boolean;
      error?: string;
      messages?: WaMessage[];
    }>("/api/whatsapp/thread/" + encodeURIComponent(wa));
    if (!r.ok) {
      setThreadErr(r.error || "failed");
      return;
    }
    setMessages(r.messages || []);
  }

  async function sendReply() {
    if (!activeWa) return;
    const r = await apiPost("/api/whatsapp/send", { to: activeWa, text: reply });
    if (!r.ok) {
      toast(r.error || "failed", "err");
      return;
    }
    openThread(activeWa);
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> WhatsApp Channel
              </div>
              <h2 className="view-title">💬 WhatsApp Channel</h2>
              <p className="view-sub">
                Send and receive WhatsApp messages via Meta Cloud API.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 64 }}>
        {/* Status banner */}
        <div style={{ marginBottom: 16 }}>
          {status &&
            (status.configured ? (
              <div
                style={{
                  background: "#ECFDF5",
                  color: "#065F46",
                  padding: "10px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                ✓ WhatsApp configured (phone {status.phoneNumberId}). Webhook URL:{" "}
                <code>{origin}/api/whatsapp/webhook</code>
              </div>
            ) : (
              <div
                style={{
                  background: "#FEF3C7",
                  color: "#78350F",
                  padding: "12px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                ⚠ WhatsApp not configured. Add{" "}
                <code>WHATSAPP_PHONE_NUMBER_ID</code>,{" "}
                <code>WHATSAPP_ACCESS_TOKEN</code> and{" "}
                <code>WHATSAPP_VERIFY_TOKEN</code> in Secrets, then point your Meta
                webhook to <code>{origin}/api/whatsapp/webhook</code>.
              </div>
            ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px 1fr",
            gap: 16,
            minHeight: 500,
          }}
        >
          {/* Threads */}
          <div style={{ ...card, padding: 14, overflowY: "auto" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 10,
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <strong style={{ alignSelf: "center" }}>Threads</strong>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setModal("tpls")}
                  style={pillBtn("#0066FF")}
                >
                  📋 Templates
                </button>
                <button
                  onClick={() => setModal("bulk")}
                  style={pillBtn("#7C3AED")}
                >
                  🚀 Bulk Send
                </button>
                <button onClick={() => setModal("new")} style={pillBtn("#25D366")}>
                  + New
                </button>
              </div>
            </div>
            <div>
              {threads === null ? (
                "Loading…"
              ) : threadsErr ? (
                <div style={{ color: "#DC2626" }}>{threadsErr}</div>
              ) : threads.length === 0 ? (
                <p style={{ color: "#94A3B8", fontSize: 13 }}>No threads yet.</p>
              ) : (
                threads.map((th) => (
                  <div
                    key={th.wa_id}
                    onClick={() => openThread(th.wa_id)}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      cursor: "pointer",
                      borderBottom: "1px solid #F1F5F9",
                      background: activeWa === th.wa_id ? "#F0F9FF" : undefined,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {th.name || th.wa_id}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#64748B",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {th.preview || ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Thread pane */}
          <div style={{ ...card, padding: 18 }}>
            {!activeWa ? (
              <p
                style={{
                  color: "#94A3B8",
                  textAlign: "center",
                  margin: "60px 0",
                }}
              >
                Select a thread or click + New to start a conversation.
              </p>
            ) : threadErr ? (
              <div style={{ color: "#DC2626" }}>{threadErr}</div>
            ) : messages === null ? (
              "Loading…"
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: 500,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    paddingBottom: 10,
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  +{activeWa}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        margin: "8px 0",
                        display: "flex",
                        justifyContent:
                          m.direction === "out" ? "flex-end" : "flex-start",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "70%",
                          background:
                            m.direction === "out" ? "#DCF8C6" : "#F1F5F9",
                          padding: "8px 12px",
                          borderRadius: 12,
                          fontSize: 14,
                        }}
                      >
                        {m.body || ""}
                        <div
                          style={{
                            fontSize: 10,
                            color: "#64748B",
                            marginTop: 2,
                          }}
                        >
                          {new Date(m.created_at).toLocaleString()}
                          {m.status ? " · " + m.status : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    paddingTop: 10,
                    borderTop: "1px solid #F1F5F9",
                  }}
                >
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendReply()}
                    placeholder="Reply…"
                    style={{
                      flex: 1,
                      padding: 10,
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 8,
                    }}
                  />
                  <button onClick={sendReply} style={pillBtn("#25D366", 18)}>
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal === "tpls" && <TemplatesModal onClose={() => setModal(null)} />}
      {modal === "bulk" && <BulkModal onClose={() => setModal(null)} />}
      {modal === "new" && (
        <NewMessageModal
          onClose={() => setModal(null)}
          onSent={() => {
            setModal(null);
            loadThreads();
          }}
        />
      )}
    </div>
  );
}

function pillBtn(bg: string, padX = 10): React.CSSProperties {
  return {
    background: bg,
    color: "white",
    border: 0,
    padding: `6px ${padX}px`,
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
  };
}

function ModalShell({
  title,
  width = 640,
  onClose,
  children,
}: {
  title: string;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.6)",
        zIndex: 99998,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          maxWidth: width,
          width: "100%",
          padding: 28,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: 0,
              fontSize: 24,
              cursor: "pointer",
              color: "#64748B",
            }}
          >
            ×
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

function TemplatesModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [lang, setLang] = useState("en_US");
  const [body, setBody] = useState("");
  const [approved, setApproved] = useState(false);

  const reload = useCallback(async () => {
    setErr("");
    const r = await apiGet<{
      ok: boolean;
      error?: string;
      templates?: WaTemplate[];
    }>("/api/whatsapp/templates");
    if (!r.ok) {
      setErr(r.error || "failed");
      setTemplates([]);
      return;
    }
    setTemplates(r.templates || []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function save() {
    const r = await apiPost("/api/whatsapp/templates", {
      name,
      language: lang,
      body,
      isMetaApproved: approved,
    });
    if (!r.ok) {
      toast(r.error || "failed", "err");
      return;
    }
    toast("Saved ✓");
    setName("");
    setBody("");
    setApproved(false);
    reload();
  }

  async function del(id: number) {
    if (!confirm("Delete this template?")) return;
    await apiDelete("/api/whatsapp/templates/" + id);
    reload();
  }

  return (
    <ModalShell title="📋 WhatsApp Templates" onClose={onClose}>
      <div>
        {templates === null ? (
          "Loading…"
        ) : err ? (
          <div style={{ color: "#DC2626" }}>{err}</div>
        ) : templates.length === 0 ? (
          <p style={{ color: "#94A3B8", fontSize: 13 }}>
            No templates yet — save one below.
          </p>
        ) : (
          templates.map((t) => (
            <div
              key={t.id}
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                padding: 10,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "start",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {t.name}{" "}
                    {t.is_meta_approved ? (
                      <span
                        style={{
                          background: "#ECFDF5",
                          color: "#065F46",
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 99,
                          marginLeft: 4,
                        }}
                      >
                        META ✓
                      </span>
                    ) : (
                      <span
                        style={{
                          background: "#FEF3C7",
                          color: "#78350F",
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 99,
                          marginLeft: 4,
                        }}
                      >
                        TEXT
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>
                    {t.language} · {t.var_count} vars
                  </div>
                </div>
                <button
                  onClick={() => del(t.id)}
                  style={{
                    background: "#FEE2E2",
                    color: "#991B1B",
                    border: 0,
                    padding: "4px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Delete
                </button>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#475569",
                  marginTop: 6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {t.body}
              </div>
            </div>
          ))
        )}
      </div>
      <hr style={{ border: 0, borderTop: "1px solid #E5E7EB", margin: "16px 0" }} />
      <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Save / update template</h3>
      <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 10px" }}>
        Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code> for variables. Tick
        &quot;Meta-approved&quot; only after Meta has approved this exact template
        name in your WhatsApp Business Manager — otherwise sends use plain text
        (24-hour window only).
      </p>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
      >
        <label>
          Name (lowercase, no spaces)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="welcome_offer"
            style={inputStyle}
          />
        </label>
        <label>
          Language
          <input
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>
      <label>
        Body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Hi {{1}}, your order {{2}} is on its way!"
          style={{ ...inputStyle, fontFamily: "inherit", margin: "4px 0 8px" }}
        />
      </label>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          marginBottom: 10,
        }}
      >
        <input
          type="checkbox"
          checked={approved}
          onChange={(e) => setApproved(e.target.checked)}
        />{" "}
        Already approved by Meta
      </label>
      <button
        onClick={save}
        style={{
          background: "#0066FF",
          color: "white",
          border: 0,
          padding: "10px 18px",
          borderRadius: 8,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Save template
      </button>
    </ModalShell>
  );
}

function BulkModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [campName, setCampName] = useState(
    `Campaign ${new Date().toLocaleDateString()}`,
  );
  const [tplId, setTplId] = useState("");
  const [recText, setRecText] = useState("");
  const [out, setOut] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [campaigns, setCampaigns] = useState<WaCampaign[] | null>(null);

  const reloadCamps = useCallback(async () => {
    const r = await apiGet<{ ok: boolean; campaigns?: WaCampaign[] }>(
      "/api/whatsapp/campaigns",
    );
    setCampaigns(r.ok ? r.campaigns || [] : []);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await apiGet<{ ok: boolean; templates?: WaTemplate[] }>(
        "/api/whatsapp/templates",
      );
      const tpls = r.ok ? r.templates || [] : [];
      setTemplates(tpls);
      if (tpls.length) setTplId(String(tpls[0].id));
    })();
    reloadCamps();
  }, [reloadCamps]);

  async function launch() {
    if (!tplId) {
      toast("Create a template first", "err");
      return;
    }
    const lines = recText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const recipients = lines.map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      const to = parts.shift();
      const vars: Record<string, string> = {};
      parts.forEach((v, i) => {
        vars[i + 1] = v;
      });
      return { to, vars };
    });
    if (!recipients.length) {
      toast("Add at least one recipient", "err");
      return;
    }
    setOut({ kind: "ok", text: "⏳ Launching…" });
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      campaignId?: number;
      total?: number;
    }>("/api/whatsapp/send-bulk", {
      templateId: Number(tplId),
      name: campName,
      recipients,
    });
    if (!r.ok) {
      setOut({ kind: "err", text: r.error || "failed" });
      return;
    }
    setOut({
      kind: "ok",
      text: `✓ Campaign #${r.campaignId} queued — ${r.total} recipients. It runs in the background; refresh this list in a moment.`,
    });
    setTimeout(reloadCamps, 1500);
  }

  return (
    <ModalShell title="🚀 Bulk Send WhatsApp" onClose={onClose}>
      <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 14px" }}>
        Pick a template, then paste recipients — one per line. Format:{" "}
        <code>phone, var1, var2, …</code> (phone with country code, no{" "}
        <code>+</code>).
      </p>
      <label>
        Campaign name
        <input
          value={campName}
          onChange={(e) => setCampName(e.target.value)}
          style={{ ...inputStyle, margin: "4px 0 10px" }}
        />
      </label>
      <label>
        Template
        <select
          value={tplId}
          onChange={(e) => setTplId(e.target.value)}
          style={{ ...inputStyle, margin: "4px 0 10px" }}
        >
          {templates.length === 0 ? (
            <option value="">— No templates yet — create one first —</option>
          ) : (
            templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.var_count} vars
                {t.is_meta_approved ? " · META" : " · TEXT"})
              </option>
            ))
          )}
        </select>
      </label>
      <label>
        Recipients (one per line)
        <textarea
          value={recText}
          onChange={(e) => setRecText(e.target.value)}
          rows={8}
          placeholder={"27821234567, Alice, ORDER-123\n27827654321, Bob, ORDER-124"}
          style={{
            ...inputStyle,
            fontFamily: "monospace",
            fontSize: 12,
            margin: "4px 0 12px",
          }}
        />
      </label>
      <button
        onClick={launch}
        style={{
          background: "#7C3AED",
          color: "white",
          border: 0,
          padding: "11px 22px",
          borderRadius: 8,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        🚀 Launch send
      </button>
      {out && (
        <div style={{ marginTop: 12 }}>
          {out.kind === "err" ? (
            <div style={{ color: "#DC2626" }}>{out.text}</div>
          ) : out.text.startsWith("⏳") ? (
            <div>{out.text}</div>
          ) : (
            <div
              style={{
                background: "#ECFDF5",
                color: "#065F46",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {out.text}
            </div>
          )}
        </div>
      )}
      <hr
        style={{ border: 0, borderTop: "1px solid #E5E7EB", margin: "18px 0 12px" }}
      />
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Recent campaigns</h3>
      <div>
        {campaigns === null ? (
          "Loading…"
        ) : campaigns.length === 0 ? (
          <p style={{ color: "#94A3B8", fontSize: 13 }}>No campaigns yet.</p>
        ) : (
          campaigns.map((c, i) => (
            <div
              key={i}
              style={{
                borderBottom: "1px solid #F1F5F9",
                padding: "8px 0",
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: "#64748B", fontSize: 12 }}>
                  {c.template_name || ""} · {c.sent}/{c.total} sent{" "}
                  {c.failed ? "· " + c.failed + " failed" : ""}
                </div>
              </div>
              <span
                style={{
                  background: c.status === "done" ? "#ECFDF5" : "#FEF3C7",
                  color: c.status === "done" ? "#065F46" : "#78350F",
                  padding: "3px 9px",
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 600,
                  alignSelf: "center",
                }}
              >
                {c.status}
              </span>
            </div>
          ))
        )}
      </div>
    </ModalShell>
  );
}

function NewMessageModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");

  async function send() {
    const r = await apiPost("/api/whatsapp/send", { to, text: msg });
    if (!r.ok) {
      toast(r.error || "failed", "err");
      return;
    }
    toast("Sent ✓");
    onSent();
  }

  return (
    <ModalShell title="Send WhatsApp" onClose={onClose}>
      <label>
        To (phone with country code, no +)
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="27821234567"
          style={{ ...inputStyle, padding: 10, margin: "6px 0 12px" }}
        />
      </label>
      <label>
        Message
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={4}
          style={{ ...inputStyle, padding: 10, fontFamily: "inherit" }}
        />
      </label>
      <p style={{ fontSize: 12, color: "#64748B" }}>
        Note: outside the 24-hour window you must use a pre-approved template
        instead. Set the template name in the body field.
      </p>
      <button
        onClick={send}
        style={{
          marginTop: 8,
          background: "#25D366",
          color: "white",
          border: 0,
          padding: "12px 24px",
          borderRadius: 8,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Send
      </button>
    </ModalShell>
  );
}
