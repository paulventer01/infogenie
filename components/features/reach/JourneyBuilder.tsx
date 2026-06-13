"use client";

// Native React port of the legacy `journey-builder` panel (was
// `window.buildJourneyBuilder` in public/js/ig_journey_omnichannel.js +
// `#view-journey-builder`). Lists journeys, toggles status, test-runs and
// deletes them, and edits a sequential node graph (trigger · wait · condition ·
// send) — all against the existing Express API (`/api/journeys*`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

type NodeType = "trigger" | "wait" | "condition" | "action";

interface NodeConfig {
  minutes?: number;
  key?: string;
  equals?: string;
  channel?: string;
  subject?: string;
  message?: string;
}

interface JNode {
  id: string;
  type: NodeType;
  config: NodeConfig;
}

interface JEdge {
  from: string;
  to: string;
}

interface JourneyStats {
  started?: number;
  completed?: number;
}

interface Journey {
  id: string | null;
  name: string;
  description?: string;
  status: string;
  trigger_type?: string;
  nodes: JNode[];
  edges: JEdge[];
  stats?: JourneyStats;
}

const CHANNELS = ["email", "sms", "whatsapp", "voice", "webpush", "tag"];

function blankJourney(): Journey {
  return {
    id: null,
    name: "New Journey",
    description: "",
    status: "draft",
    trigger_type: "manual",
    nodes: [{ id: "n1", type: "trigger", config: {} }],
    edges: [],
  };
}

export default function JourneyBuilder() {
  const toast = useToast();
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Journey | null>(null);

  async function refresh() {
    setListError(null);
    try {
      const r = await apiGet<{ journeys?: Journey[] }>("/api/journeys");
      setJourneys(r.journeys || []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function openEditor(id: string | null) {
    if (!id) {
      setEditor(blankJourney());
      return;
    }
    try {
      const r = await apiGet<{ journey?: Journey }>("/api/journeys/" + id);
      setEditor(r.journey || blankJourney());
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  async function toggleStatus(j: Journey) {
    const ns = j.status === "active" ? "paused" : "active";
    try {
      await apiPost("/api/journeys/" + j.id + "/status", { status: ns });
      toast("✓ Status → " + ns);
      await refresh();
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  async function testRun(j: Journey) {
    const email = prompt("Test contact email:", "test@example.com");
    if (!email) return;
    try {
      await apiPost("/api/journeys/" + j.id + "/start", { contact_email: email });
      toast("✓ Test enrolled");
      await refresh();
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  async function del(j: Journey) {
    if (!confirm("Delete this journey and all run history?")) return;
    try {
      await apiDelete("/api/journeys/" + j.id);
      toast("✓ Deleted");
      await refresh();
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  function updateEditor(patch: Partial<Journey>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function rechain(nodes: JNode[]): JEdge[] {
    return nodes.slice(0, -1).map((n, k) => ({ from: n.id, to: nodes[k + 1].id }));
  }

  function addNode(t: Exclude<NodeType, "trigger">) {
    setEditor((prev) => {
      if (!prev) return prev;
      const id = "n" + (prev.nodes.length + 1) + "_" + Math.random().toString(36).slice(2, 5);
      const cfg: NodeConfig =
        t === "wait"
          ? { minutes: 60 }
          : t === "condition"
            ? { key: "", equals: "" }
            : { channel: "email", subject: "", message: "" };
      const nodes = [...prev.nodes, { id, type: t, config: cfg }];
      return { ...prev, nodes, edges: rechain(nodes) };
    });
  }

  function removeNode(idx: number) {
    setEditor((prev) => {
      if (!prev) return prev;
      const nodes = prev.nodes.filter((_, i) => i !== idx);
      return { ...prev, nodes, edges: rechain(nodes) };
    });
  }

  function updateNode(idx: number, key: keyof NodeConfig, value: string | number) {
    setEditor((prev) => {
      if (!prev) return prev;
      const nodes = prev.nodes.map((n, i) =>
        i === idx ? { ...n, config: { ...n.config, [key]: value } } : n,
      );
      return { ...prev, nodes };
    });
  }

  async function save() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      toast("⚠️ Name required");
      return;
    }
    const payload: Journey = { ...editor, name, edges: rechain(editor.nodes) };
    try {
      const r = await apiPost<{ id?: string }>("/api/journeys", payload);
      setEditor((prev) => (prev ? { ...prev, id: r.id ?? prev.id } : prev));
      toast("✓ Saved");
      await refresh();
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#0F172A" }}>
              🛤️ Customer Journey Builder
            </h1>
            <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.92rem" }}>
              Map a sequence of triggers, waits, conditions and channel sends. Each
              enrolled contact walks through it automatically.
            </p>
          </div>
          <button
            onClick={() => openEditor(null)}
            style={{
              padding: "10px 18px",
              background: "linear-gradient(135deg,#06B6D4,#0EA5E9)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            + New Journey
          </button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {listError ? (
            <div style={{ color: "#B91C1C" }}>{listError}</div>
          ) : journeys === null ? (
            <div style={{ color: "#94A3B8" }}>Loading…</div>
          ) : journeys.length === 0 ? (
            <div
              style={{
                background: "#fff",
                border: "1px dashed #CBD5E1",
                borderRadius: 12,
                padding: 32,
                textAlign: "center",
                color: "#64748B",
              }}
            >
              No journeys yet. Click <strong>+ New Journey</strong> to create your
              first one.
            </div>
          ) : (
            journeys.map((j) => (
              <div
                key={j.id ?? j.name}
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 12,
                  padding: 18,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <strong style={{ fontSize: "1.05rem", color: "#0F172A" }}>{j.name}</strong>
                    <span
                      style={{
                        padding: "3px 9px",
                        borderRadius: 99,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        background:
                          j.status === "active" ? "#DCFCE7" : j.status === "paused" ? "#FEF3C7" : "#F1F5F9",
                        color:
                          j.status === "active" ? "#15803D" : j.status === "paused" ? "#A16207" : "#475569",
                      }}
                    >
                      {j.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ color: "#64748B", fontSize: "0.85rem" }}>
                    {j.description || "No description"} · {(j.nodes || []).length} steps · started{" "}
                    {j.stats?.started || 0} · completed {j.stats?.completed || 0}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => openEditor(j.id)}
                    style={{
                      padding: "7px 13px",
                      background: "#F1F5F9",
                      border: "1px solid #CBD5E1",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleStatus(j)}
                    style={{
                      padding: "7px 13px",
                      background: j.status === "active" ? "#FEF3C7" : "#DCFCE7",
                      border: `1px solid ${j.status === "active" ? "#FBBF24" : "#86EFAC"}`,
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    {j.status === "active" ? "Pause" : "Activate"}
                  </button>
                  <button
                    onClick={() => testRun(j)}
                    style={{
                      padding: "7px 13px",
                      background: "#0EA5E9",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    Test Run
                  </button>
                  <button
                    onClick={() => del(j)}
                    style={{
                      padding: "7px 11px",
                      background: "#FEE2E2",
                      color: "#B91C1C",
                      border: "1px solid #FCA5A5",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {editor && (
          <div
            style={{
              marginTop: 24,
              background: "#fff",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              padding: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "start",
                gap: 16,
                marginBottom: 18,
              }}
            >
              <div style={{ flex: 1 }}>
                <input
                  value={editor.name}
                  onChange={(e) => updateEditor({ name: e.target.value })}
                  placeholder="Journey name"
                  style={{
                    width: "100%",
                    padding: 10,
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    border: "1px solid #E2E8F0",
                    borderRadius: 8,
                    marginBottom: 8,
                    boxSizing: "border-box",
                  }}
                />
                <textarea
                  rows={2}
                  value={editor.description || ""}
                  onChange={(e) => updateEditor({ description: e.target.value })}
                  placeholder="What does this journey do?"
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #E2E8F0",
                    borderRadius: 8,
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  onClick={save}
                  style={{
                    padding: "10px 18px",
                    background: "linear-gradient(135deg,#06B6D4,#0EA5E9)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  💾 Save
                </button>
                <button
                  onClick={() => setEditor(null)}
                  style={{
                    padding: "8px 18px",
                    background: "#F1F5F9",
                    border: "1px solid #CBD5E1",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            <h3 style={{ margin: "0 0 12px", color: "#0F172A", fontSize: "1rem" }}>
              Steps (top → bottom)
            </h3>
            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              {editor.nodes.map((n, idx) => {
                const c = n.config || {};
                if (n.type === "trigger") {
                  return (
                    <div
                      key={n.id}
                      style={{
                        background: "#F0F9FF",
                        border: "2px solid #06B6D4",
                        borderRadius: 10,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#0369A1", marginBottom: 6 }}>
                        ⚡ Trigger (entry point)
                      </div>
                      <div style={{ color: "#475569", fontSize: "0.85rem" }}>
                        Contacts enter here. Trigger via the &quot;Test Run&quot; button, an
                        enrolled audience, or a Signal Trigger pointed at this journey.
                      </div>
                    </div>
                  );
                }
                if (n.type === "wait") {
                  return (
                    <div
                      key={n.id}
                      style={{
                        background: "#FFFBEB",
                        border: "1px solid #FBBF24",
                        borderRadius: 10,
                        padding: 14,
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontWeight: 700, color: "#A16207", width: 80 }}>⏳ Wait</span>
                      <input
                        type="number"
                        min={1}
                        value={c.minutes ?? 60}
                        onChange={(e) => updateNode(idx, "minutes", +e.target.value)}
                        style={{ width: 100, padding: "6px 8px", border: "1px solid #FBBF24", borderRadius: 6 }}
                      />{" "}
                      minutes
                      <button
                        onClick={() => removeNode(idx)}
                        style={{
                          marginLeft: "auto",
                          padding: "5px 10px",
                          background: "#FEE2E2",
                          color: "#B91C1C",
                          border: "1px solid #FCA5A5",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                }
                if (n.type === "condition") {
                  return (
                    <div
                      key={n.id}
                      style={{
                        background: "#EFF6FF",
                        border: "1px solid #60A5FA",
                        borderRadius: 10,
                        padding: 14,
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 700, color: "#1D4ED8", width: 80 }}>🔀 If</span>
                      <input
                        value={c.key || ""}
                        onChange={(e) => updateNode(idx, "key", e.target.value)}
                        placeholder="contact field (e.g. country)"
                        style={{ flex: 1, minWidth: 140, padding: "6px 8px", border: "1px solid #60A5FA", borderRadius: 6 }}
                      />
                      <span>=</span>
                      <input
                        value={c.equals || ""}
                        onChange={(e) => updateNode(idx, "equals", e.target.value)}
                        placeholder="value (e.g. US)"
                        style={{ flex: 1, minWidth: 120, padding: "6px 8px", border: "1px solid #60A5FA", borderRadius: 6 }}
                      />
                      <button
                        onClick={() => removeNode(idx)}
                        style={{
                          padding: "5px 10px",
                          background: "#FEE2E2",
                          color: "#B91C1C",
                          border: "1px solid #FCA5A5",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                }
                return (
                  <div
                    key={n.id}
                    style={{
                      background: "#F0FDF4",
                      border: "1px solid #86EFAC",
                      borderRadius: 10,
                      padding: 14,
                      display: "grid",
                      gridTemplateColumns: "80px 140px 1fr auto",
                      gap: 8,
                      alignItems: "start",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#15803D", alignSelf: "center" }}>📤 Send</span>
                    <select
                      value={c.channel || "email"}
                      onChange={(e) => updateNode(idx, "channel", e.target.value)}
                      style={{ padding: "6px 8px", border: "1px solid #86EFAC", borderRadius: 6 }}
                    >
                      {CHANNELS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        value={c.subject || ""}
                        onChange={(e) => updateNode(idx, "subject", e.target.value)}
                        placeholder="Subject / push title (email + push)"
                        style={{ padding: "6px 8px", border: "1px solid #86EFAC", borderRadius: 6 }}
                      />
                      <textarea
                        rows={2}
                        value={c.message || ""}
                        onChange={(e) => updateNode(idx, "message", e.target.value)}
                        placeholder="Message body / SMS text / voice script / tag name"
                        style={{ padding: "6px 8px", border: "1px solid #86EFAC", borderRadius: 6, fontFamily: "inherit" }}
                      />
                    </div>
                    <button
                      onClick={() => removeNode(idx)}
                      style={{
                        padding: "5px 10px",
                        background: "#FEE2E2",
                        color: "#B91C1C",
                        border: "1px solid #FCA5A5",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 600,
                        alignSelf: "start",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => addNode("wait")}
                style={{ padding: "8px 14px", background: "#FEF3C7", border: "1px solid #FBBF24", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
              >
                + Wait
              </button>
              <button
                onClick={() => addNode("condition")}
                style={{ padding: "8px 14px", background: "#DBEAFE", border: "1px solid #60A5FA", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
              >
                + Condition (if/then)
              </button>
              <button
                onClick={() => addNode("action")}
                style={{ padding: "8px 14px", background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
              >
                + Send (Email/SMS/WhatsApp/Voice/Push/Tag)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
