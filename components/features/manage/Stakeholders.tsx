"use client";

// Native React port of the legacy `stakeholders` panel (was `buildStakeholders`
// / `_renderStakeholders` + the webhook channels block in
// public/js/ig_mentions_gaps.js + `#view-stakeholders`). Manages the per-account
// alert digest list and real-time webhook channels against the existing Express
// API (`/api/stakeholders/*`, `/api/webhooks/*`, `/api/slack/send`).

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Stakeholder {
  id: string;
  name: string;
  email: string;
  addedAt: string;
}

interface StakeholdersResult {
  ok: boolean;
  error?: string;
  stakeholders: Stakeholder[];
  lastEmailSentAt?: string | null;
  emailConfigured?: boolean;
  dataSource?: string;
  confidence?: string;
}

interface Webhook {
  id: string;
  type: string;
  label: string;
  urlMasked?: string;
  active?: boolean;
  lastError?: string;
  lastErrorAt?: string;
  lastOkAt?: string;
}

interface WebhooksResult {
  ok: boolean;
  error?: string;
  webhooks: Webhook[];
  types?: string[];
  lastDispatchAt?: string | null;
}

interface Msg {
  color: string;
  text: string;
}

const WEBHOOK_TYPE_META: Record<string, { label: string; emoji: string; placeholder: string; help: string }> = {
  slack: {
    label: "Slack",
    emoji: "💬",
    placeholder: "https://hooks.slack.com/services/T0/B0/xxxxxxxx",
    help: "In Slack: Apps → Incoming Webhooks → Add to channel → copy the webhook URL.",
  },
  teams: {
    label: "Teams",
    emoji: "👥",
    placeholder: "https://outlook.office.com/webhook/...",
    help: "In Teams: channel ⋯ → Connectors → Incoming Webhook → create → copy URL.",
  },
  telegram: {
    label: "Telegram",
    emoji: "✈️",
    placeholder: "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>",
    help: "Create a bot via @BotFather (get TOKEN). Get your chat_id from @userinfobot. Paste the full URL.",
  },
  generic: {
    label: "Generic",
    emoji: "🔗",
    placeholder: "https://hook.example.com/...",
    help: "Any HTTPS endpoint — for n8n, Zapier, Make, Pipedream, IFTTT, or your own backend. Receives JSON: { source, alerts:[...] }.",
  },
};

function typeMeta(type: string) {
  return WEBHOOK_TYPE_META[type] || WEBHOOK_TYPE_META.generic;
}

export default function Stakeholders() {
  const [data, setData] = useState<StakeholdersResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stkName, setStkName] = useState("");
  const [stkEmail, setStkEmail] = useState("");
  const [stkMsg, setStkMsg] = useState<Msg | null>(null);
  const [stkTestMsg, setStkTestMsg] = useState<Msg | null>(null);
  const [slackTestMsg, setSlackTestMsg] = useState<Msg | null>(null);

  // Webhooks
  const [whk, setWhk] = useState<WebhooksResult | null>(null);
  const [whkType, setWhkType] = useState("slack");
  const [whkLabel, setWhkLabel] = useState("");
  const [whkUrl, setWhkUrl] = useState("");
  const [whkMsg, setWhkMsg] = useState<Msg | null>(null);

  async function loadStakeholders() {
    setLoadError(null);
    const j = await apiGet<StakeholdersResult>("/api/stakeholders/list");
    if (j.ok) setData(j);
    else setLoadError(j.error || "load failed");
  }

  async function loadWebhooks() {
    const j = await apiGet<WebhooksResult>("/api/webhooks/list");
    if (j.ok) setWhk(j);
    else
      setWhk({
        ok: false,
        error: j.error || "load failed",
        webhooks: [],
        types: ["slack", "teams", "telegram", "generic"],
      });
  }

  useEffect(() => {
    loadStakeholders();
    loadWebhooks();
  }, []);

  async function addStakeholder() {
    const name = stkName.trim();
    const email = stkEmail.trim();
    if (!name || !email) {
      setStkMsg({ color: "#B91C1C", text: "Name and email are required." });
      return;
    }
    setStkMsg({ color: "#64748B", text: "Adding…" });
    const j = await apiPost<{ ok: boolean; error?: string; stakeholder?: Stakeholder }>("/api/stakeholders/add", {
      name,
      email,
    });
    if (!j.ok) {
      setStkMsg({ color: "#B91C1C", text: j.error || "Failed to add" });
      return;
    }
    setStkName("");
    setStkEmail("");
    setStkMsg({ color: "#059669", text: `Added ${j.stakeholder ? j.stakeholder.email : ""}` });
    loadStakeholders();
  }

  async function removeStakeholder(id: string) {
    if (!confirm("Remove this stakeholder from the alert list?")) return;
    const j = await apiPost<{ ok: boolean }>("/api/stakeholders/remove", { id });
    if (j.ok) loadStakeholders();
    else alert("Failed to remove");
  }

  async function testStakeholderEmail() {
    setStkTestMsg({ color: "#64748B", text: "Sending…" });
    const j = await apiPost<{ ok: boolean; error?: string; sentCount?: number; totalStakeholders?: number; failures?: unknown[] }>(
      "/api/stakeholders/test-email",
      {},
    );
    if (j.ok) {
      setStkTestMsg({ color: "#059669", text: `Sent to ${j.sentCount} of ${j.totalStakeholders}.` });
    } else {
      setStkTestMsg({
        color: "#B91C1C",
        text: j.error || `Failed (${j.failures && j.failures.length} errors)`,
      });
    }
  }

  async function testSlackWebhook() {
    setSlackTestMsg({ color: "#64748B", text: "Sending…" });
    const j = await apiPost<{ ok: boolean; error?: string; kind?: string }>("/api/slack/send", {
      text: "🧞 InfoGenie test alert — your webhook is wired correctly.",
    });
    if (j.ok) setSlackTestMsg({ color: "#059669", text: `✓ Sent to ${j.kind} — check your channel.` });
    else setSlackTestMsg({ color: "#B91C1C", text: "✗ " + (j.error || "Failed") });
  }

  async function addWebhook() {
    const label = whkLabel.trim();
    const url = whkUrl.trim();
    if (!label || !url) {
      setWhkMsg({ color: "#B91C1C", text: "Label and URL are required." });
      return;
    }
    setWhkMsg({ color: "#64748B", text: "Adding…" });
    const j = await apiPost<{ ok: boolean; error?: string }>("/api/webhooks/add", { type: whkType, label, url });
    if (!j.ok) {
      setWhkMsg({ color: "#B91C1C", text: j.error || "Failed to add" });
      return;
    }
    setWhkLabel("");
    setWhkUrl("");
    setWhkMsg({ color: "#059669", text: "✅ Added — click Test to verify it works." });
    loadWebhooks();
  }

  async function removeWebhook(id: string) {
    if (!confirm("Remove this webhook channel?")) return;
    await apiPost("/api/webhooks/remove", { id });
    loadWebhooks();
  }

  async function toggleWebhook(id: string) {
    await apiPost("/api/webhooks/toggle", { id });
    loadWebhooks();
  }

  async function testWebhook(id: string) {
    setWhkMsg({ color: "#64748B", text: "Sending test message…" });
    const j = await apiPost<{ ok: boolean; error?: string }>("/api/webhooks/test", { id });
    if (j.ok) setWhkMsg({ color: "#059669", text: "✅ Test message delivered — check your channel." });
    else setWhkMsg({ color: "#B91C1C", text: "❌ Test failed: " + (j.error || "unknown") });
    loadWebhooks();
  }

  function renderStakeholdersCard() {
    if (loadError) {
      return (
        <div
          style={{
            background: "white",
            border: "1px solid #FECACA",
            borderRadius: 10,
            padding: 18,
            color: "#B91C1C",
          }}
        >
          Failed to load: {loadError}
        </div>
      );
    }
    if (!data) {
      return <div style={{ padding: 32, textAlign: "center", color: "#64748B" }}>Loading stakeholders…</div>;
    }
    const last = data.lastEmailSentAt ? new Date(data.lastEmailSentAt).toLocaleString() : "—";
    const cfg = !!data.emailConfigured;
    const list = data.stakeholders || [];
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", marginBottom: 10 }}>Add stakeholder</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                placeholder="Full name"
                value={stkName}
                onChange={(e) => setStkName(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
              />
              <input
                type="email"
                placeholder="email@company.com"
                value={stkEmail}
                onChange={(e) => setStkEmail(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
              />
              <button
                onClick={addStakeholder}
                style={{
                  background: "#0D9488",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  padding: "9px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                + Add to alert list
              </button>
              <div style={{ fontSize: 11, minHeight: 14, color: stkMsg?.color }}>{stkMsg?.text}</div>
            </div>
          </div>
          <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", marginBottom: 10 }}>When emails fire</div>
            <ul style={{ margin: "0 0 12px 18px", padding: 0, color: "#475569", fontSize: 12, lineHeight: 1.6 }}>
              <li>
                Any new alert with <strong>severity ≥ high</strong> from <code>/api/alerts/check</code>
              </li>
              <li>Launch reminders fired by the calendar (24h, 1h, live)</li>
              <li>
                Throttled to <strong>one digest every 30 minutes</strong> to avoid noise
              </li>
            </ul>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 8 }}>
              Last digest sent: <strong>{last}</strong>
            </div>
            <div style={{ fontSize: 11, color: cfg ? "#059669" : "#B91C1C", marginBottom: 10 }}>
              Resend {cfg ? "configured ✓" : "NOT configured — set RESEND_API_KEY to enable"}
            </div>
            <button
              onClick={testStakeholderEmail}
              disabled={!cfg}
              style={{
                background: cfg ? "#1E293B" : "#94A3B8",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: cfg ? "pointer" : "not-allowed",
              }}
            >
              Send test email now
            </button>
            <button
              onClick={testSlackWebhook}
              style={{
                background: "#4A154B",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                marginLeft: 6,
              }}
            >
              💬 Test Slack/Discord
            </button>
            <div style={{ fontSize: 11, marginTop: 8, minHeight: 14, color: stkTestMsg?.color }}>{stkTestMsg?.text}</div>
            <div style={{ fontSize: 11, marginTop: 4, minHeight: 14, color: slackTestMsg?.color }}>
              {slackTestMsg?.text}
            </div>
          </div>
        </div>
        <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
          <div
            style={{
              padding: "12px 16px",
              background: "#F8FAFC",
              borderBottom: "1px solid #E2E8F0",
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {list.length} stakeholder{list.length === 1 ? "" : "s"} on the list
            </span>
            <span style={{ fontSize: 10, color: "#94A3B8" }}>
              Source: {data.dataSource} · {data.confidence} confidence
            </span>
          </div>
          {list.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    background: "#F8FAFC",
                    color: "#64748B",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  <th style={{ textAlign: "left", padding: "9px 12px" }}>Name</th>
                  <th style={{ textAlign: "left", padding: "9px 12px" }}>Email</th>
                  <th style={{ textAlign: "left", padding: "9px 12px" }}>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "10px 12px", color: "#1E293B", fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: "10px 12px", color: "#475569" }}>
                      <a href={`mailto:${s.email}`} style={{ color: "#0D9488", textDecoration: "none" }}>
                        {s.email}
                      </a>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#94A3B8", fontSize: 11 }}>
                      {new Date(s.addedAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <button
                        onClick={() => removeStakeholder(s.id)}
                        style={{
                          background: "#FEF2F2",
                          color: "#B91C1C",
                          border: "1px solid #FECACA",
                          borderRadius: 6,
                          padding: "5px 10px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 32, textAlign: "center", color: "#94A3B8" }}>
              No stakeholders yet — add one above to start receiving digests.
            </div>
          )}
        </div>
      </>
    );
  }

  function renderWebhooks() {
    if (!whk) return null;
    if (whk.ok === false && (!whk.webhooks || !whk.webhooks.length)) {
      return (
        <div
          style={{
            background: "white",
            border: "1px solid #FECACA",
            borderRadius: 10,
            padding: 14,
            color: "#B91C1C",
            marginTop: 16,
            fontSize: 12,
          }}
        >
          Failed to load webhooks{whk.error ? ": " + whk.error : ""}
        </div>
      );
    }
    const types = whk.types || ["slack", "teams", "telegram", "generic"];
    const webhooks = whk.webhooks || [];
    return (
      <>
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 18,
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>
            📡 Webhook channels — real-time alerts to chat
          </div>
          <div style={{ fontSize: 11, color: "#64748B", marginBottom: 12 }}>
            Same alerts as the email digest, delivered instantly to Slack, Teams, Telegram, or any generic HTTPS
            endpoint. No API keys from us — paste your own webhook URL.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "150px 1.4fr 2.6fr auto", gap: 8, alignItems: "start" }}>
            <select
              value={whkType}
              onChange={(e) => setWhkType(e.target.value)}
              style={{
                padding: "9px 10px",
                border: "1px solid #CBD5E1",
                borderRadius: 6,
                fontSize: 13,
                background: "white",
              }}
            >
              {types.map((t) => {
                const m = typeMeta(t);
                return (
                  <option key={t} value={t}>
                    {m.emoji + " " + m.label}
                  </option>
                );
              })}
            </select>
            <input
              type="text"
              placeholder="Label (e.g. #marketing)"
              value={whkLabel}
              onChange={(e) => setWhkLabel(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
            />
            <input
              type="text"
              placeholder={typeMeta(whkType).placeholder}
              value={whkUrl}
              onChange={(e) => setWhkUrl(e.target.value)}
              style={{
                padding: "9px 12px",
                border: "1px solid #CBD5E1",
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "monospace",
              }}
            />
            <button
              onClick={addWebhook}
              style={{
                background: "#0D9488",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "9px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              + Add
            </button>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                color: "#64748B",
                marginTop: 8,
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                padding: "8px 10px",
                borderRadius: 6,
              }}
            >
              {typeMeta(whkType).help}
            </div>
          </div>
          <div style={{ fontSize: 11, marginTop: 8, minHeight: 14, color: whkMsg?.color }}>{whkMsg?.text}</div>
        </div>
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            overflow: "hidden",
            marginTop: 12,
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              background: "#F8FAFC",
              borderBottom: "1px solid #E2E8F0",
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {webhooks.length} webhook{webhooks.length === 1 ? "" : "s"} configured
            </span>
            <span style={{ fontSize: 10, color: "#94A3B8" }}>
              Last dispatch: {whk.lastDispatchAt ? new Date(whk.lastDispatchAt).toLocaleString() : "—"}
            </span>
          </div>
          {webhooks.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {webhooks.map((w) => {
                  const m = typeMeta(w.type);
                  return (
                    <tr key={w.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 12px", color: "#1E293B" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span
                            style={{
                              background: "#F1F5F9",
                              padding: "3px 8px",
                              borderRadius: 99,
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#475569",
                            }}
                          >
                            {m.emoji + " " + m.label}
                          </span>
                          <strong style={{ fontSize: 13 }}>{w.label}</strong>
                          {w.active ? null : (
                            <span
                              style={{
                                background: "#F1F5F9",
                                color: "#94A3B8",
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 99,
                              }}
                            >
                              paused
                            </span>
                          )}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94A3B8", marginTop: 4 }}>
                          {w.urlMasked || ""}
                        </div>
                        {w.lastOkAt ? (
                          <div style={{ fontSize: 10, color: "#059669", marginTop: 3 }}>
                            ✓ Last sent OK: {new Date(w.lastOkAt).toLocaleString()}
                          </div>
                        ) : null}
                        {w.lastError ? (
                          <div style={{ fontSize: 10, color: "#B91C1C", marginTop: 3 }}>
                            ⚠ Last error: {w.lastError} ({w.lastErrorAt ? new Date(w.lastErrorAt).toLocaleString() : ""})
                          </div>
                        ) : null}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          verticalAlign: "middle",
                        }}
                      >
                        <label style={{ fontSize: 11, color: "#475569", marginRight: 8, cursor: "pointer", userSelect: "none" }}>
                          <input
                            type="checkbox"
                            checked={!!w.active}
                            onChange={() => toggleWebhook(w.id)}
                            style={{ verticalAlign: "middle" }}
                          />{" "}
                          Active
                        </label>
                        <button
                          onClick={() => testWebhook(w.id)}
                          style={{
                            background: "#EEF2FF",
                            color: "#4338CA",
                            border: "1px solid #C7D2FE",
                            borderRadius: 6,
                            padding: "5px 10px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            marginRight: 6,
                          }}
                        >
                          Test
                        </button>
                        <button
                          onClick={() => removeWebhook(w.id)}
                          style={{
                            background: "#FEF2F2",
                            color: "#B91C1C",
                            border: "1px solid #FECACA",
                            borderRadius: 6,
                            padding: "5px 10px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 24, textAlign: "center", color: "#94A3B8", fontSize: 12 }}>
              No webhooks yet — add one above to start streaming alerts to chat.
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="view" id="view-stakeholders">
      <div className="intel-header" style={{ background: "linear-gradient(110deg,#0F766E 0%,#14B8A6 50%,#5EEAD4 100%)" }}>
        <div className="breadcrumb" style={{ color: "#CCFBF1" }}>
          <span className="bc-group" style={{ color: "#CCFBF1", opacity: 0.85 }}>
            Manage
          </span>{" "}
          <span className="bc-sep" style={{ color: "#CCFBF1", opacity: 0.55 }}>
            ›
          </span>{" "}
          Stakeholders
        </div>
        <h1 className="ih-title">👤 Stakeholders</h1>
        <p className="ih-sub">
          Add the people who get a digest email when a high-severity alert fires (max one per 30 min)
        </p>
      </div>
      <div id="stakeholdersWrap" style={{ padding: "24px 28px" }}>
        {renderStakeholdersCard()}
        {data && renderWebhooks()}
      </div>
    </div>
  );
}
