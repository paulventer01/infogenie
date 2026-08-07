"use client";

// Native React port of the legacy `alert-routing` panel (was
// `window.buildAlertRouting` + `#view-alert-routing` in index.html). Build rules
// that route Crisis incidents, SoV drops and digest alerts to Slack/email,
// backed by the existing Express API (`/api/alert-routing/*`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface Channel {
  kind: string;
  email?: string;
}

interface TriggerFilter {
  brand?: string;
  min_severity?: string;
}

interface Rule {
  id: number;
  name: string;
  trigger_kind: string;
  trigger_filter?: TriggerFilter;
  channels?: Channel[];
  enabled?: boolean;
  fire_count?: number;
  last_fired_at?: string | null;
}

interface RulesResult {
  ok: boolean;
  error?: string;
  rules: Rule[];
}

interface DispatchChannel {
  kind: string;
  ok: boolean;
  error?: string;
}

interface Dispatch {
  rule_name?: string;
  event_kind: string;
  created_at: string;
  channels_sent?: DispatchChannel[];
}

interface DispatchesResult {
  ok: boolean;
  error?: string;
  dispatches: Dispatch[];
}

interface TestResult {
  ok: boolean;
  error?: string;
  dispatched?: { dispatched?: { channels?: { ok: boolean }[] }[] };
}

const TRIGGER_KINDS = ["crisis_incident", "sov_drop", "digest_ready", "mention_volume", "custom"];
const SEVERITIES = ["low", "med", "high"];

interface EditorState {
  id: number | null;
  name: string;
  triggerKind: string;
  fBrand: string;
  fSev: string;
  slack: boolean;
  email: boolean;
  emailTo: string;
}

export default function AlertRouting() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [rulesError, setRulesError] = useState("");
  const [dispatches, setDispatches] = useState<Dispatch[] | null>(null);
  const [dispatchesError, setDispatchesError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);

  async function loadRules() {
    setRulesError("");
    const r = await apiGet<RulesResult>("/api/alert-routing/");
    if (!r.ok) {
      setRules([]);
      setRulesError(r.error || "failed");
      return;
    }
    setRules(r.rules || []);
  }

  async function loadDispatches() {
    setDispatchesError("");
    const r = await apiGet<DispatchesResult>("/api/alert-routing/dispatches?limit=15");
    if (!r.ok) {
      setDispatches([]);
      setDispatchesError(r.error || "failed");
      return;
    }
    setDispatches(r.dispatches || []);
  }

  useEffect(() => {
    loadRules();
    loadDispatches();
  }, []);

  function openEditor(id: number | null) {
    const r = id != null ? (rules || []).find((x) => x.id === id) || null : null;
    const f = (r && r.trigger_filter) || {};
    const ch = (r && r.channels) || [];
    setEditor({
      id,
      name: r ? r.name : "",
      triggerKind: r ? r.trigger_kind : TRIGGER_KINDS[0],
      fBrand: f.brand || "",
      fSev: f.min_severity || "",
      slack: !!ch.find((c) => c.kind === "slack"),
      email: !!ch.find((c) => c.kind === "email"),
      emailTo: (ch.find((c) => c.kind === "email") || {}).email || "",
    });
  }

  async function saveRule() {
    if (!editor) return;
    const channels: Channel[] = [];
    if (editor.slack) channels.push({ kind: "slack" });
    if (editor.email) channels.push({ kind: "email", email: editor.emailTo });
    const trigger_filter: TriggerFilter = {};
    if (editor.fBrand.trim()) trigger_filter.brand = editor.fBrand.trim();
    if (editor.fSev) trigger_filter.min_severity = editor.fSev;
    const payload = {
      name: editor.name,
      trigger_kind: editor.triggerKind,
      trigger_filter,
      channels,
      enabled: true,
    };
    const url = editor.id ? "/api/alert-routing/" + editor.id : "/api/alert-routing/";
    const r = editor.id ? await apiPut(url, payload) : await apiPost(url, payload);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    showToast("✅ Saved");
    setEditor(null);
    await loadRules();
  }

  async function deleteRule(id: number) {
    if (!confirm("Delete this rule?")) return;
    const r = await apiDelete("/api/alert-routing/" + id);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    showToast("✅ Deleted");
    await loadRules();
  }

  async function testRule(id: number) {
    const r = await apiPost<TestResult>("/api/alert-routing/test/" + id);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    const channels = r.dispatched?.dispatched?.[0]?.channels || [];
    const okCount = channels.filter((c) => c.ok).length;
    const failCount = channels.filter((c) => !c.ok).length;
    showToast(`✅ Test fired — ${okCount} ok, ${failCount} failed`);
    await loadDispatches();
    await loadRules();
  }

  const labelStyle = {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 4,
  } as const;
  const inputStyle = {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 6,
    fontSize: "0.86rem",
    boxSizing: "border-box",
  } as const;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Alert Routing
              </div>
              <h2 className="view-title">🔔 Smart Alert Routing</h2>
              <p className="view-sub">
                Build rules that route Crisis incidents, SoV drops and digest alerts to Slack and email. Filter by
                brand, severity, kind. Test-fire any rule with one click.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>📋 Active Rules</div>
          <button
            onClick={() => openEditor(null)}
            style={{
              padding: "9px 18px",
              background: "#EC4899",
              border: "2px solid #EC4899",
              borderRadius: 8,
              fontSize: "0.78rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          >
            + New Rule
          </button>
        </div>

        <div>
          {rules === null ? (
            <div style={{ color: "#6B7280", fontSize: "0.85rem" }}>Loading rules…</div>
          ) : rulesError ? (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{rulesError}</div>
          ) : rules.length === 0 ? (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px dashed #D1D5DB",
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
                color: "#6B7280",
                fontSize: "0.88rem",
              }}
            >
              No rules yet. Click <strong>+ New Rule</strong> to create one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderLeft: `4px solid ${rule.enabled ? "#15803D" : "#9CA3AF"}`,
                    borderRadius: 8,
                    padding: "14px 16px",
                    display: "flex",
                    gap: 14,
                    alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.92rem" }}>{rule.name}</div>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 3 }}>
                      {rule.trigger_kind}
                      {rule.trigger_filter?.brand ? " · brand: " + rule.trigger_filter.brand : ""}
                      {rule.trigger_filter?.min_severity ? " · min severity: " + rule.trigger_filter.min_severity : ""}{" "}
                      · channels: {(rule.channels || []).map((c) => c.kind).join(", ") || "none"}
                    </div>
                    <div style={{ fontSize: "0.66rem", color: "#9CA3AF", marginTop: 2 }}>
                      Fired {rule.fire_count || 0}×{" "}
                      {rule.last_fired_at ? "· last " + new Date(rule.last_fired_at).toLocaleString() : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => testRule(rule.id)}
                    style={{
                      padding: "7px 12px",
                      background: "#fff",
                      border: "2px solid #0891B2",
                      borderRadius: 6,
                      fontSize: "0.72rem",
                      fontWeight: 800,
                      color: "#0891B2",
                      cursor: "pointer",
                    }}
                  >
                    ⚡ Test
                  </button>
                  <button
                    onClick={() => openEditor(rule.id)}
                    style={{
                      padding: "7px 12px",
                      background: "#fff",
                      border: "2px solid #D1D5DB",
                      borderRadius: 6,
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#374151",
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    style={{
                      padding: "7px 12px",
                      background: "#fff",
                      border: "2px solid #FCA5A5",
                      borderRadius: 6,
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#B91C1C",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {editor && (
          <div
            style={{
              background: "#fff",
              border: "2px solid #EC4899",
              borderRadius: 12,
              padding: 20,
              marginTop: 14,
            }}
          >
            <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "1rem", marginBottom: 14 }}>
              {editor.id ? "✏️ Edit Rule" : "➕ New Rule"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Rule name</label>
                <input
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder="e.g. High-sev Nike crisis to Slack"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Trigger</label>
                <select
                  value={editor.triggerKind}
                  onChange={(e) => setEditor({ ...editor, triggerKind: e.target.value })}
                  style={inputStyle}
                >
                  {TRIGGER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Filter: brand (optional)</label>
                <input
                  value={editor.fBrand}
                  onChange={(e) => setEditor({ ...editor, fBrand: e.target.value })}
                  placeholder="e.g. Nike"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Filter: min severity (crisis only)</label>
                <select
                  value={editor.fSev}
                  onChange={(e) => setEditor({ ...editor, fSev: e.target.value })}
                  style={inputStyle}
                >
                  <option value="">any</option>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>
                Channels
              </label>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginRight: 18,
                  fontSize: "0.82rem",
                  color: "#374151",
                }}
              >
                <input
                  type="checkbox"
                  checked={editor.slack}
                  onChange={(e) => setEditor({ ...editor, slack: e.target.checked })}
                />{" "}
                Slack (uses SLACK_WEBHOOK_URL)
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "#374151" }}>
                <input
                  type="checkbox"
                  checked={editor.email}
                  onChange={(e) => setEditor({ ...editor, email: e.target.checked })}
                />{" "}
                Email →
              </label>
              <input
                value={editor.emailTo}
                onChange={(e) => setEditor({ ...editor, emailTo: e.target.value })}
                placeholder="alerts@you.com"
                style={{
                  marginLeft: 6,
                  padding: "6px 10px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 5,
                  fontSize: "0.78rem",
                  width: 240,
                }}
              />
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                onClick={saveRule}
                style={{
                  padding: "9px 18px",
                  background: "#15803D",
                  border: "2px solid #15803D",
                  borderRadius: 6,
                  fontSize: "0.78rem",
                  fontWeight: 800,
                  color: "#fff",
                  WebkitTextFillColor: "#fff",
                  cursor: "pointer",
                  textShadow: "0 1px 2px rgba(0,0,0,.4)",
                }}
              >
                💾 Save
              </button>
              <button
                onClick={() => setEditor(null)}
                style={{
                  padding: "9px 18px",
                  background: "#fff",
                  border: "2px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem", marginBottom: 10 }}>
            📜 Recent Dispatches
          </div>
          <div>
            {dispatches === null ? (
              <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>Loading…</div>
            ) : dispatchesError ? (
              <div style={{ color: "#B91C1C", fontSize: "0.8rem" }}>{dispatchesError}</div>
            ) : dispatches.length === 0 ? (
              <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>No dispatches yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {dispatches.map((d, idx) => {
                  const chs = d.channels_sent || [];
                  const okCount = chs.filter((c) => c.ok).length;
                  const status = okCount === chs.length ? "#15803D" : okCount > 0 ? "#F59E0B" : "#B91C1C";
                  return (
                    <div
                      key={idx}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderLeft: `3px solid ${status}`,
                        borderRadius: 6,
                        padding: "10px 14px",
                        fontSize: "0.78rem",
                        color: "#374151",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                        <div>
                          <strong>{d.rule_name || "(deleted rule)"}</strong> · {d.event_kind}
                        </div>
                        <div style={{ color: "#9CA3AF", fontSize: "0.7rem" }}>
                          {new Date(d.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 3 }}>
                        {chs
                          .map((c) => `${c.ok ? "✅" : "❌"} ${c.kind}${c.error ? " — " + c.error : ""}`)
                          .join(" · ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
