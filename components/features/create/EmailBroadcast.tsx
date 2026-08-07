"use client";

// Native React port of the legacy `email-broadcast` panel
// (was `window.buildEmailBroadcast` in public/js/ig_intel_pack_b.js filling
// `#ebWrap`, header from `#view-email-broadcast` in index.html). Bulk email
// sender with open/click/bounce tracking via the existing Express API:
//   GET    /api/email-broadcast/broadcasts                → { ok, broadcasts[] }
//   POST   /api/email-broadcast/broadcasts                → { ok, broadcast }
//   GET    /api/email-broadcast/broadcasts/:id            → { ok, broadcast }
//   GET    /api/email-broadcast/broadcasts/:id/stats      → { ok, ...rates }
//   GET    /api/email-broadcast/broadcasts/:id/recipients → { ok, recipients[], total }
//   POST   /api/email-broadcast/broadcasts/:id/recipients → { ok, added, total }
//   POST   /api/email-broadcast/broadcasts/:id/send       → { ok, message }
//   DELETE /api/email-broadcast/broadcasts/:id
// Webhook target: POST /api/email-broadcast/webhook (shown in the Stats tab).

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Broadcast {
  id: number;
  name: string;
  subject: string;
  status: string;
  recipient_count?: number;
  sent_count?: number;
  open_count?: number;
  click_count?: number;
  bounce_count?: number;
  sent_at?: string;
  from_name?: string;
  from_email?: string;
  created_at?: string;
}
interface ListResult {
  ok: boolean;
  error?: string;
  broadcasts?: Broadcast[];
}
interface DetailResult {
  ok: boolean;
  error?: string;
  broadcast?: Broadcast;
}
interface StatsResult {
  ok: boolean;
  error?: string;
  sent_count?: number;
  open_count?: number;
  click_count?: number;
  bounce_count?: number;
  complaint_count?: number;
  open_rate?: number;
  click_rate?: number;
  bounce_rate?: number;
  delivery_rate?: number;
}
interface Recipient {
  email: string;
  name?: string;
  status: string;
  sent_at?: string;
  opened_at?: string;
}
interface RecipientsResult {
  ok: boolean;
  error?: string;
  recipients?: Recipient[];
  total?: number;
}
interface SaveResult {
  ok: boolean;
  error?: string;
  broadcast?: { id: number };
}
interface AddResult {
  ok: boolean;
  error?: string;
  added?: number;
  total?: number;
}
interface SendResult {
  ok: boolean;
  error?: string;
  message?: string;
}

type ViewMode = "list" | "create" | "detail";
type DetailTab = "stats" | "recipients" | "add-recipients";

const fmtPct = (n?: number) => (n || 0).toFixed(1) + "%";
const fmtNum = (n?: number) => Number(n || 0).toLocaleString();
const fmtDate = (s?: string) => {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
};

function StatusBadge({ status }: { status: string }) {
  const cfg =
    (
      {
        draft: "#6B7280:#F3F4F6",
        sending: "#D97706:#FEF3C7",
        sent: "#059669:#D1FAE5",
        paused: "#7C3AED:#EDE9FE",
      } as Record<string, string>
    )[status] || "#6B7280:#F3F4F6";
  const [fg, bg] = cfg.split(":");
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: "0.7rem",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 99,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

function RecipBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: "#6B7280",
    sent: "#374151",
    opened: "#0066FF",
    clicked: "#7C3AED",
    bounced: "#EF4444",
    complained: "#D97706",
    unsubscribed: "#9CA3AF",
  };
  const bg: Record<string, string> = {
    queued: "#F3F4F6",
    sent: "#F9FAFB",
    opened: "#EFF6FF",
    clicked: "#EDE9FE",
    bounced: "#FEE2E2",
    complained: "#FEF3C7",
    unsubscribed: "#F3F4F6",
  };
  return (
    <span
      style={{
        background: bg[status] || "#F3F4F6",
        color: colors[status] || "#6B7280",
        fontSize: "0.68rem",
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 99,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

function StatCard({
  label,
  val,
  sub,
  color,
}: {
  label: string;
  val: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        padding: "16px 20px",
        textAlign: "center",
        minWidth: 110,
        flex: 1,
      }}
    >
      <div style={{ fontSize: "1.6rem", fontWeight: 900, color: color || "#0A1628" }}>
        {val}
      </div>
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          color: "#374151",
          marginTop: 2,
        }}
      >
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: "0.68rem", color: "#9CA3AF", marginTop: 1 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  borderBottom: "1px solid #E5E7EB",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 7,
  fontSize: "0.85rem",
  color: "#0A1628",
};
const fieldLabel: React.CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 700,
  color: "#374151",
  display: "block",
  marginBottom: 4,
};

export default function EmailBroadcast() {
  const [view, setView] = useState<ViewMode>("list");

  // list
  const [list, setList] = useState<Broadcast[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  // create form
  const [cName, setCName] = useState("");
  const [cSubject, setCSubject] = useState("");
  const [cFromName, setCFromName] = useState("");
  const [cFromEmail, setCFromEmail] = useState("");
  const [cHtml, setCHtml] = useState("");
  const [cText, setCText] = useState("");
  const [createMsg, setCreateMsg] = useState<{ color: string; text: string } | null>(
    null,
  );

  // detail
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailBc, setDetailBc] = useState<Broadcast | null>(null);
  const [detailSt, setDetailSt] = useState<StatsResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailMsg, setDetailMsg] = useState<{ color: string; text: string } | null>(
    null,
  );
  const [detailTab, setDetailTab] = useState<DetailTab>("stats");

  // recipients tab
  const [recipList, setRecipList] = useState<Recipient[]>([]);
  const [recipTotal, setRecipTotal] = useState(0);
  const [recipLoading, setRecipLoading] = useState(false);
  const [recipError, setRecipError] = useState("");

  // add-recipients tab
  const [recipInput, setRecipInput] = useState("");
  const [recipMsg, setRecipMsg] = useState<{ color: string; text: string } | null>(
    null,
  );

  async function loadList() {
    setListLoading(true);
    setListError("");
    const r = await apiGet<ListResult>("/api/email-broadcast/broadcasts");
    setListLoading(false);
    if (!r.ok) {
      setListError(r.error || "Error");
      return;
    }
    setList(r.broadcasts || []);
  }

  useEffect(() => {
    loadList();
  }, []);

  function openCreate() {
    setCName("");
    setCSubject("");
    setCFromName("");
    setCFromEmail("");
    setCHtml("");
    setCText("");
    setCreateMsg(null);
    setView("create");
  }

  function backToList() {
    setView("list");
    loadList();
  }

  async function saveDraft() {
    const name = cName.trim();
    const subject = cSubject.trim();
    const from_name = cFromName.trim();
    const from_email = cFromEmail.trim();
    const body_html = cHtml.trim();
    const body_text = cText.trim();
    if (!name || !subject || (!body_html && !body_text)) {
      setCreateMsg({
        color: "#EF4444",
        text: "Name, subject and body are required.",
      });
      return;
    }
    setCreateMsg({ color: "#6B7280", text: "Saving…" });
    const r = await apiPost<SaveResult>("/api/email-broadcast/broadcasts", {
      name,
      subject,
      from_name,
      from_email,
      body_html,
      body_text,
    });
    if (!r.ok || !r.broadcast) {
      setCreateMsg({ color: "#EF4444", text: r.error || "Save failed" });
      return;
    }
    openDetail(r.broadcast.id);
  }

  async function openDetail(id: number) {
    setDetailId(id);
    setView("detail");
    setDetailTab("stats");
    setDetailMsg(null);
    setDetailError("");
    setDetailLoading(true);
    setDetailBc(null);
    const [bcR, statsR] = await Promise.all([
      apiGet<DetailResult>(`/api/email-broadcast/broadcasts/${id}`),
      apiGet<StatsResult>(`/api/email-broadcast/broadcasts/${id}/stats`),
    ]);
    setDetailLoading(false);
    if (!bcR.ok || !bcR.broadcast) {
      setDetailError(bcR.error || "Error");
      return;
    }
    setDetailBc(bcR.broadcast);
    setDetailSt(
      statsR.ok
        ? statsR
        : {
            ok: true,
            sent_count: 0,
            open_rate: 0,
            click_rate: 0,
            bounce_rate: 0,
            delivery_rate: 0,
          },
    );
  }

  async function switchTab(tab: DetailTab, id: number) {
    setDetailTab(tab);
    if (tab === "recipients") {
      setRecipLoading(true);
      setRecipError("");
      const r = await apiGet<RecipientsResult>(
        `/api/email-broadcast/broadcasts/${id}/recipients?limit=200`,
      );
      setRecipLoading(false);
      if (!r.ok) {
        setRecipError(r.error || "Error");
        return;
      }
      setRecipList(r.recipients || []);
      setRecipTotal(r.total || 0);
    } else if (tab === "add-recipients") {
      setRecipInput("");
      setRecipMsg(null);
    }
  }

  async function addRecipients(id: number) {
    const lines = recipInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const emails = lines
      .map((l) => {
        const parts = l.split(",");
        return {
          email: parts[0].trim().toLowerCase(),
          name: (parts[1] || "").trim().replace(/^["']|["']$/g, ""),
        };
      })
      .filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
    if (!emails.length) {
      setRecipMsg({ color: "#EF4444", text: "No valid email addresses found." });
      return;
    }
    setRecipMsg({ color: "#6B7280", text: `Adding ${emails.length} recipients…` });
    const r = await apiPost<AddResult>(
      `/api/email-broadcast/broadcasts/${id}/recipients`,
      { emails },
    );
    if (!r.ok) {
      setRecipMsg({ color: "#EF4444", text: r.error || "Failed" });
      return;
    }
    setRecipMsg({
      color: "#059669",
      text: `Added ${r.added} new recipients (${(r.total || 0) - (r.added || 0)} duplicates skipped).`,
    });
    setTimeout(() => openDetail(id), 1200);
  }

  async function send(id: number) {
    if (
      !confirm(
        "Send this broadcast to all queued recipients? This cannot be undone.",
      )
    )
      return;
    setDetailMsg({ color: "#6B7280", text: "Sending…" });
    const r = await apiPost<SendResult>(
      `/api/email-broadcast/broadcasts/${id}/send`,
    );
    if (!r.ok) {
      setDetailMsg({ color: "#EF4444", text: r.error || "Failed" });
      return;
    }
    setDetailMsg({ color: "#059669", text: r.message || "" });
    setTimeout(() => openDetail(id), 2000);
  }

  async function del(id: number) {
    if (!confirm("Delete this broadcast? This cannot be undone.")) return;
    await apiDelete(`/api/email-broadcast/broadcasts/${id}`);
    backToList();
  }

  return (
    <>
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Email Broadcast
              </div>
              <h2 className="view-title">📧 Email Broadcast</h2>
              <p className="view-sub">
                Send bulk emails to any contact list and track every open, click,
                bounce, and complaint in real time. Create a draft, add recipients
                by paste or CSV, send — then watch the live tracking dashboard
                update as Resend reports back.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {view === "list" && (
          <>
            {listLoading ? (
              <div style={{ textAlign: "center", padding: 32, color: "#6B7280" }}>
                Loading broadcasts…
              </div>
            ) : listError ? (
              <div style={{ color: "#991B1B", padding: 16 }}>
                Error: {listError}
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: 16,
                  }}
                >
                  <button
                    onClick={openCreate}
                    style={{
                      padding: "9px 20px",
                      background: "linear-gradient(135deg,#0066FF,#7C3AED)",
                      border: "none",
                      borderRadius: 8,
                      color: "#fff",
                      fontSize: "0.84rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    + New Broadcast
                  </button>
                </div>
                {!list.length ? (
                  <div
                    style={{
                      background: "#F9FAFB",
                      border: "1px dashed #D1D5DB",
                      borderRadius: 12,
                      padding: 48,
                      textAlign: "center",
                      color: "#6B7280",
                    }}
                  >
                    <div style={{ fontSize: "2rem", marginBottom: 10 }}>📧</div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: "#374151",
                        marginBottom: 6,
                      }}
                    >
                      No broadcasts yet
                    </div>
                    <div style={{ fontSize: "0.85rem" }}>
                      Create your first broadcast to send bulk emails with open
                      &amp; click tracking.
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "0.82rem",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#F9FAFB" }}>
                          <th style={{ ...thStyle, textAlign: "left" }}>NAME</th>
                          <th style={{ ...thStyle, textAlign: "left" }}>
                            SUBJECT
                          </th>
                          <th style={{ ...thStyle, textAlign: "center" }}>
                            STATUS
                          </th>
                          <th style={{ ...thStyle, textAlign: "right" }}>
                            RECIPIENTS
                          </th>
                          <th style={{ ...thStyle, textAlign: "right" }}>
                            OPEN RATE
                          </th>
                          <th style={{ ...thStyle, textAlign: "right" }}>
                            CLICK RATE
                          </th>
                          <th style={{ ...thStyle, textAlign: "right" }}>
                            BOUNCES
                          </th>
                          <th style={{ ...thStyle, textAlign: "right" }}>SENT</th>
                          <th style={thStyle}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((b) => {
                          const s = b.sent_count || 0;
                          const openRate =
                            s > 0
                              ? fmtPct(((b.open_count || 0) / s) * 100)
                              : "—";
                          const clickRate =
                            s > 0
                              ? fmtPct(((b.click_count || 0) / s) * 100)
                              : "—";
                          const bounceRate =
                            s > 0
                              ? fmtPct(((b.bounce_count || 0) / s) * 100)
                              : "—";
                          return (
                            <tr
                              key={b.id}
                              style={{
                                borderBottom: "1px solid #F3F4F6",
                                cursor: "pointer",
                              }}
                              onClick={() => openDetail(b.id)}
                            >
                              <td
                                style={{
                                  padding: "10px 14px",
                                  fontWeight: 700,
                                  color: "#0A1628",
                                }}
                              >
                                {b.name}
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  color: "#374151",
                                  maxWidth: 200,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {b.subject}
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "center",
                                }}
                              >
                                <StatusBadge status={b.status} />
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "right",
                                  color: "#374151",
                                }}
                              >
                                {fmtNum(b.recipient_count)}
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "right",
                                  fontWeight: 700,
                                  color: s > 0 ? "#059669" : "#9CA3AF",
                                }}
                              >
                                {openRate}
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "right",
                                  fontWeight: 700,
                                  color: s > 0 ? "#7C3AED" : "#9CA3AF",
                                }}
                              >
                                {clickRate}
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "right",
                                  color:
                                    (b.bounce_count || 0) > 0
                                      ? "#EF4444"
                                      : "#9CA3AF",
                                }}
                              >
                                {bounceRate}
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "right",
                                  color: "#6B7280",
                                }}
                              >
                                {fmtDate(b.sent_at)}
                              </td>
                              <td
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "right",
                                }}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    del(b.id);
                                  }}
                                  style={{
                                    padding: "3px 8px",
                                    background: "transparent",
                                    border: "1px solid #E5E7EB",
                                    borderRadius: 5,
                                    fontSize: "0.72rem",
                                    color: "#6B7280",
                                    cursor: "pointer",
                                  }}
                                >
                                  🗑
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {view === "create" && (
          <div style={{ maxWidth: 680 }}>
            <button
              onClick={backToList}
              style={{
                background: "transparent",
                border: "none",
                color: "#6B7280",
                fontSize: "0.82rem",
                cursor: "pointer",
                marginBottom: 16,
              }}
            >
              ← Back to broadcasts
            </button>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <h3
                style={{
                  margin: "0 0 18px",
                  color: "#0A1628",
                  fontFamily: "Sora,sans-serif",
                  fontSize: "1rem",
                }}
              >
                📧 Create New Broadcast
              </h3>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div>
                  <label style={fieldLabel}>Campaign Name</label>
                  <input
                    type="text"
                    placeholder="e.g. May Newsletter 2025"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Subject Line</label>
                  <input
                    type="text"
                    placeholder="e.g. Here's what we've been working on…"
                    value={cSubject}
                    onChange={(e) => setCSubject(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={fieldLabel}>From Name</label>
                    <input
                      type="text"
                      placeholder="InfoGenie"
                      value={cFromName}
                      onChange={(e) => setCFromName(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={fieldLabel}>
                      From Email{" "}
                      <span style={{ fontWeight: 400, color: "#9CA3AF" }}>
                        (must be verified in Resend)
                      </span>
                    </label>
                    <input
                      type="email"
                      placeholder="hello@yourcompany.com"
                      value={cFromEmail}
                      onChange={(e) => setCFromEmail(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div>
                  <label style={fieldLabel}>Email Body (HTML)</label>
                  <textarea
                    rows={8}
                    placeholder="<h1>Hello!</h1><p>Your email body here…</p>"
                    value={cHtml}
                    onChange={(e) => setCHtml(e.target.value)}
                    style={{
                      ...inputStyle,
                      fontSize: "0.82rem",
                      fontFamily: "monospace",
                      resize: "vertical",
                    }}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>
                    Plain-text fallback{" "}
                    <span style={{ fontWeight: 400, color: "#9CA3AF" }}>
                      (optional)
                    </span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Plain text version for email clients that don't render HTML"
                    value={cText}
                    onChange={(e) => setCText(e.target.value)}
                    style={{
                      ...inputStyle,
                      fontSize: "0.82rem",
                      resize: "vertical",
                    }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
                <button
                  onClick={saveDraft}
                  style={{
                    padding: "10px 22px",
                    background: "linear-gradient(135deg,#0066FF,#7C3AED)",
                    border: "none",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: "0.84rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Save Draft →
                </button>
                <button
                  onClick={backToList}
                  style={{
                    padding: "10px 16px",
                    background: "#F3F4F6",
                    border: "none",
                    borderRadius: 8,
                    color: "#374151",
                    fontSize: "0.84rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
              {createMsg && (
                <div
                  style={{
                    marginTop: 12,
                    fontSize: "0.82rem",
                    color: createMsg.color,
                  }}
                >
                  {createMsg.text}
                </div>
              )}
            </div>
          </div>
        )}

        {view === "detail" && (
          <>
            <button
              onClick={backToList}
              style={{
                background: "transparent",
                border: "none",
                color: "#6B7280",
                fontSize: "0.82rem",
                cursor: "pointer",
                marginBottom: 16,
              }}
            >
              ← Back to broadcasts
            </button>
            {detailLoading ? (
              <div
                style={{ textAlign: "center", padding: 32, color: "#6B7280" }}
              >
                Loading…
              </div>
            ) : detailError ? (
              <div style={{ color: "#991B1B", padding: 16 }}>
                Error: {detailError}
              </div>
            ) : detailBc && detailId != null ? (
              (() => {
                const bc = detailBc;
                const st = detailSt || ({ ok: true } as StatsResult);
                const id = detailId;
                const canSend = ["draft", "paused"].includes(bc.status);
                return (
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 12,
                      padding: 20,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: 12,
                        marginBottom: 14,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "1.05rem",
                            fontWeight: 800,
                            color: "#0A1628",
                          }}
                        >
                          {bc.name}
                        </div>
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#6B7280",
                            marginTop: 2,
                          }}
                        >
                          Subject: <em>{bc.subject}</em>
                        </div>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "#9CA3AF",
                            marginTop: 2,
                          }}
                        >
                          From: {bc.from_name} &lt;{bc.from_email || "—"}&gt; ·{" "}
                          {fmtDate(bc.sent_at || bc.created_at)}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <StatusBadge status={bc.status} />
                        {canSend && (
                          <button
                            onClick={() => send(id)}
                            style={{
                              padding: "8px 18px",
                              background:
                                "linear-gradient(135deg,#059669,#0066FF)",
                              border: "none",
                              borderRadius: 7,
                              color: "#fff",
                              fontSize: "0.82rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            🚀 Send Now
                          </button>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 16,
                      }}
                    >
                      <StatCard
                        label="Recipients"
                        val={fmtNum(bc.recipient_count)}
                        sub="in list"
                        color="#374151"
                      />
                      <StatCard
                        label="Delivered"
                        val={fmtNum(st.sent_count)}
                        sub={fmtPct(st.delivery_rate || 0) + " delivery"}
                        color="#0066FF"
                      />
                      <StatCard
                        label="Opened"
                        val={fmtNum(st.open_count || 0)}
                        sub={fmtPct(st.open_rate || 0) + " rate"}
                        color="#059669"
                      />
                      <StatCard
                        label="Clicked"
                        val={fmtNum(st.click_count || 0)}
                        sub={fmtPct(st.click_rate || 0) + " rate"}
                        color="#7C3AED"
                      />
                      <StatCard
                        label="Bounced"
                        val={fmtNum(st.bounce_count || 0)}
                        sub={fmtPct(st.bounce_rate || 0) + " rate"}
                        color="#EF4444"
                      />
                      <StatCard
                        label="Complained"
                        val={fmtNum(st.complaint_count || 0)}
                        color="#D97706"
                      />
                    </div>
                    {detailMsg && (
                      <div
                        style={{
                          fontSize: "0.82rem",
                          marginBottom: 10,
                          color: detailMsg.color,
                        }}
                      >
                        {detailMsg.text}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        borderBottom: "1px solid #E5E7EB",
                        marginBottom: 14,
                      }}
                    >
                      {(
                        ["stats", "recipients", "add-recipients"] as DetailTab[]
                      ).map((t) => (
                        <button
                          key={t}
                          onClick={() => switchTab(t, id)}
                          style={{
                            padding: "7px 14px",
                            background: "transparent",
                            border: "none",
                            borderBottom:
                              detailTab === t
                                ? "2px solid #7C3AED"
                                : "2px solid transparent",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            color: detailTab === t ? "#7C3AED" : "#6B7280",
                            cursor: "pointer",
                          }}
                        >
                          {t === "stats"
                            ? "📊 Stats"
                            : t === "recipients"
                              ? "👥 Recipients"
                              : "➕ Add Recipients"}
                        </button>
                      ))}
                    </div>
                    <div>
                      {detailTab === "stats" && (
                        <>
                          <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>
                            Stats are shown in the cards above. Send rate, open
                            rate, click rate and bounce rate update in real time
                            as Resend delivers and recipients engage.
                          </div>
                          <div
                            style={{
                              background: "#FEF3C7",
                              border: "1px solid #FDE68A",
                              borderRadius: 8,
                              padding: "12px 16px",
                              marginTop: 12,
                              fontSize: "0.8rem",
                              color: "#92400E",
                            }}
                          >
                            <strong>Webhook setup:</strong> To get live
                            open/click/bounce tracking, add{" "}
                            <code>
                              POST{" "}
                              {typeof window !== "undefined"
                                ? window.location.origin
                                : ""}
                              /api/email-broadcast/webhook
                            </code>{" "}
                            as an endpoint in your{" "}
                            <a
                              href="https://resend.com/webhooks"
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "#0066FF" }}
                            >
                              Resend Webhooks dashboard
                            </a>{" "}
                            and select the{" "}
                            <em>
                              email.opened, email.clicked, email.bounced,
                              email.complained
                            </em>{" "}
                            events.
                          </div>
                        </>
                      )}
                      {detailTab === "recipients" &&
                        (recipLoading ? (
                          <div
                            style={{ color: "#6B7280", fontSize: "0.82rem" }}
                          >
                            Loading recipients…
                          </div>
                        ) : recipError ? (
                          <div
                            style={{ color: "#EF4444", fontSize: "0.82rem" }}
                          >
                            {recipError}
                          </div>
                        ) : !recipList.length ? (
                          <div
                            style={{
                              color: "#6B7280",
                              fontSize: "0.82rem",
                              padding: 12,
                            }}
                          >
                            No recipients yet — use the &quot;Add Recipients&quot;
                            tab to upload contacts.
                          </div>
                        ) : (
                          <>
                            <div
                              style={{
                                fontSize: "0.76rem",
                                color: "#6B7280",
                                marginBottom: 8,
                              }}
                            >
                              {fmtNum(recipTotal)} total recipients
                            </div>
                            <div style={{ overflowX: "auto" }}>
                              <table
                                style={{
                                  width: "100%",
                                  borderCollapse: "collapse",
                                  fontSize: "0.8rem",
                                }}
                              >
                                <thead>
                                  <tr style={{ background: "#F9FAFB" }}>
                                    <th
                                      style={{
                                        ...thStyle,
                                        padding: "7px 10px",
                                        fontSize: "0.68rem",
                                        textAlign: "left",
                                      }}
                                    >
                                      EMAIL
                                    </th>
                                    <th
                                      style={{
                                        ...thStyle,
                                        padding: "7px 10px",
                                        fontSize: "0.68rem",
                                        textAlign: "left",
                                      }}
                                    >
                                      NAME
                                    </th>
                                    <th
                                      style={{
                                        ...thStyle,
                                        padding: "7px 10px",
                                        fontSize: "0.68rem",
                                        textAlign: "center",
                                      }}
                                    >
                                      STATUS
                                    </th>
                                    <th
                                      style={{
                                        ...thStyle,
                                        padding: "7px 10px",
                                        fontSize: "0.68rem",
                                        textAlign: "right",
                                      }}
                                    >
                                      SENT
                                    </th>
                                    <th
                                      style={{
                                        ...thStyle,
                                        padding: "7px 10px",
                                        fontSize: "0.68rem",
                                        textAlign: "right",
                                      }}
                                    >
                                      OPENED
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recipList.map((rp, i) => (
                                    <tr
                                      key={i}
                                      style={{
                                        borderBottom: "1px solid #F3F4F6",
                                      }}
                                    >
                                      <td
                                        style={{
                                          padding: "7px 10px",
                                          color: "#374151",
                                        }}
                                      >
                                        {rp.email}
                                      </td>
                                      <td
                                        style={{
                                          padding: "7px 10px",
                                          color: "#6B7280",
                                        }}
                                      >
                                        {rp.name || "—"}
                                      </td>
                                      <td
                                        style={{
                                          padding: "7px 10px",
                                          textAlign: "center",
                                        }}
                                      >
                                        <RecipBadge status={rp.status} />
                                      </td>
                                      <td
                                        style={{
                                          padding: "7px 10px",
                                          textAlign: "right",
                                          color: "#9CA3AF",
                                          fontSize: "0.72rem",
                                        }}
                                      >
                                        {fmtDate(rp.sent_at)}
                                      </td>
                                      <td
                                        style={{
                                          padding: "7px 10px",
                                          textAlign: "right",
                                          color: "#9CA3AF",
                                          fontSize: "0.72rem",
                                        }}
                                      >
                                        {fmtDate(rp.opened_at)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        ))}
                      {detailTab === "add-recipients" && (
                        <div style={{ maxWidth: 500 }}>
                          <div
                            style={{
                              fontSize: "0.82rem",
                              color: "#374151",
                              marginBottom: 10,
                            }}
                          >
                            Paste one email per line, or use CSV format:{" "}
                            <code>email,name</code>
                          </div>
                          <textarea
                            rows={8}
                            placeholder={
                              "alice@example.com, Alice Smith\nbob@example.com\ncarol@example.com, Carol"
                            }
                            value={recipInput}
                            onChange={(e) => setRecipInput(e.target.value)}
                            style={{
                              ...inputStyle,
                              fontSize: "0.82rem",
                              fontFamily: "monospace",
                              resize: "vertical",
                              marginBottom: 10,
                            }}
                          />
                          <button
                            onClick={() => addRecipients(id)}
                            style={{
                              padding: "9px 20px",
                              background: "#0066FF",
                              border: "none",
                              borderRadius: 7,
                              color: "#fff",
                              fontSize: "0.82rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Add Recipients
                          </button>
                          {recipMsg && (
                            <div
                              style={{
                                marginTop: 8,
                                fontSize: "0.8rem",
                                color: recipMsg.color,
                              }}
                            >
                              {recipMsg.text}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
