"use client";

// MCP Server (export) + MCP Client (consume official/community/builtin servers)

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface McpTool {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; example?: unknown }>;
    required?: string[];
  };
}
interface ToolsResp {
  ok?: boolean;
  error?: string;
  protocol?: string;
  version?: string;
  name?: string;
  description?: string;
  tools?: McpTool[];
}
interface CallResp {
  ok?: boolean;
  error?: string | { code?: number; message?: string };
  content?: { type: string; text: string }[];
  isError?: boolean;
}

interface ClientServer {
  id: number;
  name: string;
  category?: string;
  transport?: string;
  builtin?: string | null;
  base_url?: string;
  enabled?: boolean;
  loopback?: boolean;
}

interface Preset {
  id: string;
  name: string;
  category: string;
  transport: string;
  description: string;
  requiresCustomUrl?: boolean;
}

type Tab = "server" | "client";

export default function McpServer() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("server");
  const [manifest, setManifest] = useState<ToolsResp | null>(null);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [selTool, setSelTool] = useState("");
  const [args, setArgs] = useState("{}");
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; body: string } | null>(null);

  const [servers, setServers] = useState<ClientServer[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selServer, setSelServer] = useState<number | null>(null);
  const [clientTools, setClientTools] = useState<McpTool[]>([]);
  const [clientTool, setClientTool] = useState("");
  const [clientArgs, setClientArgs] = useState("{}");
  const [clientResult, setClientResult] = useState<{ ok: boolean; body: string } | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [busyClient, setBusyClient] = useState(false);

  const origin = typeof location !== "undefined" ? location.origin : "";

  useEffect(() => {
    (async () => {
      const t = await apiGet<ToolsResp>("/api/mcp/tools");
      if (t.ok !== false) setManifest(t);
      if (t.ok !== false && Array.isArray(t.tools)) {
        setTools(t.tools);
        if (t.tools[0]) setSelTool(t.tools[0].name);
      }
    })();
  }, []);

  const loadClient = useCallback(async () => {
    const [p, s] = await Promise.all([
      apiGet<{ ok?: boolean; presets?: Preset[] }>("/api/mcp-client/presets"),
      apiGet<{ ok?: boolean; servers?: ClientServer[] }>("/api/mcp-client/servers?seed=1"),
    ]);
    if (p.ok !== false) setPresets(p.presets || []);
    if (s.ok !== false) {
      const list = s.servers || [];
      setServers(list);
      if (!selServer && list[0]) setSelServer(list[0].id);
    }
  }, [selServer]);

  useEffect(() => {
    if (tab === "client") loadClient();
  }, [tab, loadClient]);

  useEffect(() => {
    if (tab !== "client" || !selServer) return;
    (async () => {
      const r = await apiGet<{ ok?: boolean; tools?: McpTool[]; error?: string }>(
        `/api/mcp-client/servers/${selServer}/tools`,
      );
      if (r.ok !== false) {
        setClientTools(r.tools || []);
        if (r.tools?.[0]) setClientTool(r.tools[0].name);
      } else {
        setClientTools([]);
        toast(r.error || "Failed to list remote tools");
      }
    })();
  }, [tab, selServer, toast]);

  function onSelectTool(name: string) {
    setSelTool(name);
    const tool = tools?.find((t) => t.name === name);
    if (!tool?.inputSchema?.properties) {
      setArgs("{}");
      return;
    }
    const sample: Record<string, unknown> = {};
    Object.entries(tool.inputSchema.properties).forEach(([k, v]) => {
      sample[k] = v.example ?? (v.type === "number" ? 0 : v.type === "boolean" ? false : "");
    });
    setArgs(JSON.stringify(sample, null, 2));
  }

  async function call() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || "{}");
    } catch {
      toast("Invalid JSON in arguments");
      return;
    }
    setCalling(true);
    const d = await apiPost<CallResp>("/api/mcp/call", { name: selTool, arguments: parsed });
    setCalling(false);
    if (d.ok !== false && !d.isError && Array.isArray(d.content)) {
      setResult({ ok: true, body: d.content.map((c) => c.text).join("\n") });
    } else {
      const msg =
        typeof d.error === "string" ? d.error : d.error?.message || "Tool call failed";
      setResult({ ok: false, body: msg });
    }
  }

  async function addPreset(presetId: string) {
    setBusyClient(true);
    const body: Record<string, unknown> = { preset_id: presetId };
    if (customUrl.trim()) body.base_url = customUrl.trim();
    const r = await apiPost<{ ok?: boolean; error?: string }>("/api/mcp-client/servers", body);
    setBusyClient(false);
    if (r.ok === false) {
      toast(r.error || "Failed to add server");
      return;
    }
    toast("MCP server connected");
    setCustomUrl("");
    loadClient();
  }

  async function toggleServer(id: number, enabled: boolean) {
    await apiPatch(`/api/mcp-client/servers/${id}`, { enabled });
    loadClient();
  }

  async function removeServer(id: number) {
    if (!confirm("Remove this MCP connection?")) return;
    await apiDelete(`/api/mcp-client/servers/${id}`);
    if (selServer === id) setSelServer(null);
    loadClient();
  }

  async function callClientTool() {
    if (!selServer || !clientTool) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(clientArgs || "{}");
    } catch {
      toast("Invalid JSON");
      return;
    }
    setBusyClient(true);
    const d = await apiPost<CallResp>(`/api/mcp-client/servers/${selServer}/call`, {
      name: clientTool,
      arguments: parsed,
    });
    setBusyClient(false);
    if (d.ok !== false && !d.isError && Array.isArray(d.content)) {
      setClientResult({ ok: true, body: d.content.map((c) => c.text).join("\n") });
    } else {
      const msg =
        typeof d.error === "string" ? d.error : d.error?.message || "Remote tool call failed";
      setClientResult({ ok: false, body: msg });
    }
  }

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <h2>🔌 MCP Ecosystem</h2>
        <p className="view-sub">
          Export InfoGenie as an MCP tool server, and connect as a client to Fetch, Memory, Mangools Streamable HTTP MCP, and custom REST / JSON-RPC servers.
        </p>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#F1F5F9", borderRadius: 10, padding: 4, maxWidth: 360 }}>
        {([
          { id: "server" as const, label: "1 · Server (export)" },
          { id: "client" as const, label: "2 · Client (connect)" },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontWeight: 800,
              fontSize: "0.74rem",
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#0F172A" : "#64748B",
              boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "server" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 1000 }}>
          <div>
            <div className="ig-card">
              <h3 style={{ margin: "0 0 16px", fontSize: "1rem" }}>🔌 Connection Details</h3>
              {manifest === null ? (
                <div style={{ textAlign: "center", padding: 32, color: "#6b7280", fontSize: "0.9rem" }}>⏳ Loading…</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "#6b7280", fontWeight: 700 }}>SERVER NAME</span>
                    <div style={{ fontWeight: 600 }}>{manifest.name || "InfoGenie MCP"}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "#6b7280", fontWeight: 700 }}>TOOLS</span>
                    <div style={{ fontWeight: 600 }}>{tools?.length ?? 0} data + action tools</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "#6b7280", fontWeight: 700 }}>ENDPOINT</span>
                    <code style={{ fontSize: "0.78rem", background: "#f8fafc", padding: "4px 8px", borderRadius: 4 }}>
                      {origin}/api/mcp/tools
                    </code>
                  </div>
                </div>
              )}
            </div>
            <div className="ig-card" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Available Tools</h3>
              {tools === null ? (
                <div style={{ padding: 24, color: "#6b7280" }}>⏳ Loading…</div>
              ) : (
                tools.map((t) => (
                  <div key={t.name} style={{ border: "1px solid #e2e8f0", borderRadius: 7, padding: "9px 12px", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0F766E" }}>{t.name}</div>
                    <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 2 }}>{t.description}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <div className="ig-card">
              <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>🧪 Test a Tool</h3>
              <div className="form-group">
                <label>Tool Name</label>
                <select className="form-control" value={selTool} onChange={(e) => onSelectTool(e.target.value)}>
                  {(tools || []).map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Arguments (JSON)</label>
                <textarea className="form-control" rows={5} value={args} onChange={(e) => setArgs(e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={calling} onClick={call}>
                {calling ? "⏳ Calling…" : "🚀 Call Tool"}
              </button>
              {result && (
                <pre style={{ marginTop: 12, fontSize: "0.78rem", whiteSpace: "pre-wrap", background: result.ok ? "#f0fdf4" : "#fef2f2", padding: 12, borderRadius: 8 }}>
                  {result.body}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "client" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 1100 }}>
          <div>
            <div className="ig-card">
              <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Connected servers</h3>
              <p style={{ margin: "0 0 12px", fontSize: "0.78rem", color: "#6B7280" }}>
                Builtin Fetch + Memory seed automatically. Mangools SEO MCP auto-connects when <code>MANGOOLS_API_KEY</code> is saved in Platform APIs.
              </p>
              {!servers.length ? (
                <div style={{ color: "#9CA3AF", fontSize: "0.78rem" }}>No servers — seeding…</div>
              ) : (
                servers.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      border: selServer === s.id ? "1px solid #0D9488" : "1px solid #E5E7EB",
                      background: selServer === s.id ? "#F0FDFA" : "#fff",
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <button type="button" onClick={() => setSelServer(s.id)} style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0A1628" }}>{s.name}</div>
                        <div style={{ fontSize: "0.68rem", color: "#6B7280" }}>
                          {s.category} · {s.transport}{s.builtin ? ` · ${s.builtin}` : ""}
                        </div>
                      </button>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <label style={{ fontSize: "0.68rem", fontWeight: 700 }}>
                          <input type="checkbox" checked={s.enabled !== false} onChange={(e) => toggleServer(s.id, e.target.checked)} /> On
                        </label>
                        <button type="button" onClick={() => removeServer(s.id)} style={{ fontSize: "0.68rem", color: "#991B1B", background: "none", border: "none", cursor: "pointer" }}>Remove</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="ig-card" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>Add from catalog</h3>
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="Custom base URL (for REST/JSON-RPC presets)"
                style={{ width: "100%", boxSizing: "border-box", padding: 8, border: "1px solid #D1D5DB", borderRadius: 6, marginBottom: 10, fontSize: "0.78rem" }}
              />
              <div style={{ display: "grid", gap: 6 }}>
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busyClient}
                    onClick={() => addPreset(p.id)}
                    style={{ textAlign: "left", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", background: "#F9FAFB", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 800, fontSize: "0.78rem", color: "#0A1628" }}>{p.name}</div>
                    <div style={{ fontSize: "0.68rem", color: "#6B7280" }}>{p.category} · {p.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ig-card">
            <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Call remote / builtin tool</h3>
            <div className="form-group">
              <label>Tool</label>
              <select className="form-control" value={clientTool} onChange={(e) => setClientTool(e.target.value)}>
                {clientTools.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Arguments (JSON)</label>
              <textarea className="form-control" rows={5} value={clientArgs} onChange={(e) => setClientArgs(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busyClient || !selServer} onClick={callClientTool}>
              {busyClient ? "⏳ Calling…" : "🚀 Call via MCP client"}
            </button>
            {clientResult && (
              <pre style={{ marginTop: 12, fontSize: "0.78rem", whiteSpace: "pre-wrap", background: clientResult.ok ? "#f0fdf4" : "#fef2f2", padding: 12, borderRadius: 8 }}>
                {clientResult.body}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
