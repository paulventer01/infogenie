"use client";

// Native React port of the legacy `crm-sync` panel (was `window.buildCrmSync`
// in public/js/ig_intel_pack_b.js + `#view-crm-sync` in index.html). Lists CRM
// providers, tests a connection and pushes pasted contacts against the existing
// Express API (`GET /api/crm-sync/providers`, `/history`; `POST /api/crm-sync/test`,
// `/push`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Provider {
  id: string;
  label: string;
  icon: string;
  color: string;
  textColor?: string;
  configured: boolean;
  fields: string[];
}
interface HistoryRow {
  provider: string;
  status: string;
  contacts_ok: number;
  contacts_total: number;
  created_at: string;
}
interface ProvidersResult {
  ok: boolean;
  providers?: Provider[];
}
interface HistoryResult {
  ok: boolean;
  history?: HistoryRow[];
}
interface TestResult {
  ok: boolean;
  message?: string;
  error?: string;
}
interface PushResult {
  ok: boolean;
  error?: string;
  status?: string;
  pushed?: number;
  failed?: number;
  total?: number;
  errors?: string[];
}

export default function CrmSync() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const [listId, setListId] = useState("");
  const [contacts, setContacts] = useState("");

  const [testState, setTestState] = useState<TestResult | "loading" | null>(null);
  const [pushState, setPushState] = useState<
    PushResult | { loading: true; count: number } | null
  >(null);

  const load = useCallback(async () => {
    const [pr, hr] = await Promise.all([
      apiGet<ProvidersResult>("/api/crm-sync/providers"),
      apiGet<HistoryResult>("/api/crm-sync/history"),
    ]);
    const provs = pr.providers || [];
    setProviders(provs);
    setHistory(hr.history || []);
    setSelected((cur) => cur || (provs.length ? provs[0].id : null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const prov = providers.find((p) => p.id === selected);

  function selectProvider(id: string) {
    setSelected(id);
    setTestState(null);
    setPushState(null);
  }

  async function test(pid: string) {
    setTestState("loading");
    const d = await apiPost<TestResult>("/api/crm-sync/test", { provider: pid });
    setTestState(d);
  }

  async function push(pid: string) {
    const raw = contacts.trim();
    if (!raw) {
      alert("Paste at least one contact email.");
      return;
    }
    const parsed = raw
      .split("\n")
      .map((line) => {
        const parts = line.trim().split(",");
        return {
          email: (parts[0] || "").trim(),
          first_name: (parts[1] || "").trim(),
          last_name: (parts[2] || "").trim(),
        };
      })
      .filter((c) => c.email);
    if (!parsed.length) {
      alert(
        "No valid email addresses found. Make sure each line starts with an email address.",
      );
      return;
    }
    setPushState({ loading: true, count: parsed.length });
    const d = await apiPost<PushResult>("/api/crm-sync/push", {
      provider: pid,
      contacts: parsed,
      list_id: listId.trim(),
      form_id: listId.trim(),
    });
    setPushState(d);
    if (d.ok) await load();
  }

  const provLabel = prov?.label || selected || "";

  function statusBadge(p: Provider) {
    return p.configured ? (
      <span
        style={{
          padding: "3px 10px",
          background: "#D1FAE5",
          color: "#065F46",
          borderRadius: 12,
          fontSize: "0.75rem",
          fontWeight: 700,
        }}
      >
        CONFIGURED
      </span>
    ) : (
      <span
        style={{
          padding: "3px 10px",
          background: "#FEE2E2",
          color: "#991B1B",
          borderRadius: 12,
          fontSize: "0.75rem",
          fontWeight: 700,
        }}
      >
        NOT SET
      </span>
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> CRM Sync
              </div>
              <h2 className="view-title">🔄 CRM Sync</h2>
              <p className="view-sub">
                Push contacts from InfoGenie&apos;s Lead Finder, Dynamic
                Audiences, or any CSV directly into ActiveCampaign, ConvertKit,
                or Mailchimp — with sync history and per-contact status tracking.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px 1fr",
            gap: 20,
            maxWidth: 1000,
          }}
        >
          <div>
            <h3
              style={{
                margin: "0 0 14px",
                fontSize: "1rem",
                fontWeight: 700,
                color: "#111",
              }}
            >
              Select Platform
            </h3>
            {providers.map((p) => (
              <div
                key={p.id}
                onClick={() => selectProvider(p.id)}
                style={{
                  background: selected === p.id ? "#F0F4FF" : "#fff",
                  border: `2px solid ${selected === p.id ? p.color : "#E5E7EB"}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: "1.4rem" }}>{p.icon}</span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: selected === p.id ? p.color : "#111",
                    }}
                  >
                    {p.label}
                  </span>
                </div>
                {statusBadge(p)}
                {!p.configured && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#9CA3AF",
                      marginTop: 6,
                    }}
                  >
                    Required: {p.fields.join(", ")}
                  </div>
                )}
              </div>
            ))}

            <h4
              style={{
                margin: "18px 0 10px",
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "#374151",
              }}
            >
              Sync History
            </h4>
            {history.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "#9CA3AF" }}>
                No syncs yet.
              </p>
            ) : (
              history.slice(0, 5).map((h, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: "0.8rem",
                    padding: "8px 0",
                    borderBottom: "1px solid #F3F4F6",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, color: "#374151" }}>
                      {h.provider}
                    </span>
                    <span
                      style={{
                        color:
                          h.status === "ok"
                            ? "#16A34A"
                            : h.status === "partial"
                              ? "#D97706"
                              : "#DC2626",
                        fontWeight: 700,
                      }}
                    >
                      {h.status}
                    </span>
                  </div>
                  <div style={{ color: "#6B7280" }}>
                    {h.contacts_ok}/{h.contacts_total} pushed ·{" "}
                    {new Date(h.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>

          <div>
            {prov ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 18,
                    padding: "14px 18px",
                    background: prov.color + "18",
                    border: `1px solid ${prov.color}44`,
                    borderRadius: 10,
                  }}
                >
                  <span style={{ fontSize: "1.8rem" }}>{prov.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ fontWeight: 800, fontSize: "1rem", color: "#111" }}
                    >
                      {prov.label}
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>
                      {prov.configured
                        ? "Ready to sync"
                        : "API key not yet configured"}
                    </div>
                  </div>
                  <button
                    onClick={() => test(prov.id)}
                    style={{
                      padding: "8px 16px",
                      background: prov.color,
                      color: prov.textColor || "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontSize: "0.83rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Test Connection
                  </button>
                </div>
                <div style={{ marginBottom: 14 }}>
                  {testState === "loading" && (
                    <div
                      style={{
                        color: "#6B7280",
                        fontSize: "0.84rem",
                        padding: 10,
                      }}
                    >
                      Testing connection...
                    </div>
                  )}
                  {testState && testState !== "loading" && testState.ok && (
                    <div
                      style={{
                        background: "#D1FAE5",
                        border: "1px solid #6EE7B7",
                        borderRadius: 8,
                        padding: "10px 14px",
                        color: "#065F46",
                        fontSize: "0.84rem",
                        fontWeight: 600,
                      }}
                    >
                      ✓ {testState.message || "Connected successfully."}
                    </div>
                  )}
                  {testState && testState !== "loading" && !testState.ok && (
                    <div
                      style={{
                        background: "#FEE2E2",
                        border: "1px solid #FCA5A5",
                        borderRadius: 8,
                        padding: "10px 14px",
                        color: "#991B1B",
                        fontSize: "0.84rem",
                      }}
                    >
                      {testState.error ||
                        "Connection failed — check your API key."}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 20,
                  }}
                >
                  <h4
                    style={{
                      margin: "0 0 14px",
                      fontSize: "0.9rem",
                      fontWeight: 700,
                      color: "#111",
                    }}
                  >
                    Push Contacts
                  </h4>
                  {prov.id === "convertkit" && (
                    <div
                      style={{
                        background: "#FEF3C7",
                        border: "1px solid #FCD34D",
                        borderRadius: 8,
                        padding: "10px 14px",
                        fontSize: "0.82rem",
                        color: "#92400E",
                        marginBottom: 12,
                      }}
                    >
                      ConvertKit requires a <strong>Form ID</strong>. Find it in
                      ConvertKit → Forms → click your form → look at the URL:
                      .../forms/<strong>XXXXXX</strong>/edit
                    </div>
                  )}
                  {prov.id === "mailchimp" && (
                    <div
                      style={{
                        background: "#FEF3C7",
                        border: "1px solid #FCD34D",
                        borderRadius: 8,
                        padding: "10px 14px",
                        fontSize: "0.82rem",
                        color: "#92400E",
                        marginBottom: 12,
                      }}
                    >
                      Mailchimp requires your <strong>Audience/List ID</strong>.
                      Find it in Mailchimp → Audience → Manage Audience →
                      Settings → Audience ID.
                    </div>
                  )}
                  <input
                    placeholder={
                      prov.id === "convertkit"
                        ? "Form ID (e.g. 1234567)"
                        : prov.id === "mailchimp"
                          ? "Audience ID (e.g. abc123def)"
                          : "List ID (optional — leave blank to add without list)"
                    }
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "10px 14px",
                      border: "1px solid #D1D5DB",
                      borderRadius: 8,
                      fontSize: "0.88rem",
                      marginBottom: 10,
                    }}
                  />
                  <textarea
                    placeholder={
                      "Paste contacts — one per line.\nAccepts: email only, OR email,first_name,last_name\n\nExamples:\njane@acme.com\njohn@corp.com,John,Smith"
                    }
                    rows={8}
                    value={contacts}
                    onChange={(e) => setContacts(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "10px 14px",
                      border: "1px solid #D1D5DB",
                      borderRadius: 8,
                      fontSize: "0.84rem",
                      resize: "vertical",
                      marginBottom: 14,
                      fontFamily: "monospace",
                    }}
                  />
                  <button
                    onClick={() => push(prov.id)}
                    style={{
                      width: "100%",
                      padding: 12,
                      background: prov.color,
                      color: prov.textColor || "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 700,
                      fontSize: "0.95rem",
                      cursor: "pointer",
                    }}
                  >
                    Push to {prov.label} →
                  </button>
                  <div style={{ marginTop: 14 }}>
                    {pushState && "loading" in pushState && (
                      <div
                        style={{
                          color: "#6B7280",
                          fontSize: "0.84rem",
                          padding: 10,
                        }}
                      >
                        Pushing {pushState.count} contact
                        {pushState.count !== 1 ? "s" : ""} to {provLabel}...
                      </div>
                    )}
                    {pushState && !("loading" in pushState) && !pushState.ok && (
                      <div
                        style={{
                          background: "#FEE2E2",
                          border: "1px solid #FCA5A5",
                          borderRadius: 8,
                          padding: 14,
                          color: "#991B1B",
                          fontSize: "0.84rem",
                        }}
                      >
                        {pushState.error}
                      </div>
                    )}
                    {pushState && !("loading" in pushState) && pushState.ok && (
                      <div
                        style={{
                          background:
                            pushState.status === "ok"
                              ? "#D1FAE5"
                              : pushState.status === "partial"
                                ? "#FEF3C7"
                                : "#FEE2E2",
                          borderRadius: 10,
                          padding: "16px 20px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "1rem",
                            fontWeight: 800,
                            color:
                              pushState.status === "ok"
                                ? "#065F46"
                                : pushState.status === "partial"
                                  ? "#92400E"
                                  : "#991B1B",
                            marginBottom: 8,
                          }}
                        >
                          {pushState.status === "ok"
                            ? "✓ All contacts pushed!"
                            : pushState.status === "partial"
                              ? "⚠️ Partially pushed"
                              : "✗ Push failed"}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 20,
                            fontSize: "0.84rem",
                            color:
                              pushState.status === "ok"
                                ? "#065F46"
                                : pushState.status === "partial"
                                  ? "#92400E"
                                  : "#991B1B",
                          }}
                        >
                          <span>
                            Pushed: <strong>{pushState.pushed}</strong>
                          </span>
                          <span>
                            Failed: <strong>{pushState.failed}</strong>
                          </span>
                          <span>
                            Total: <strong>{pushState.total}</strong>
                          </span>
                        </div>
                        {pushState.errors && pushState.errors.length > 0 && (
                          <div
                            style={{
                              marginTop: 10,
                              fontSize: "0.78rem",
                              color: "#DC2626",
                            }}
                          >
                            {pushState.errors.map((e, i) => (
                              <div key={i}>{e}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: "#6B7280", padding: 16 }}>
                Select a platform to continue.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
