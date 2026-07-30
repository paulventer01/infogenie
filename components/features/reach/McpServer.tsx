"use client";

// Native React port of the legacy `mcp-server` panel (was
// `window.buildMcpServer` in public/js/ig_customer_engagement.js +
// `#view-mcp-server`). Exposes InfoGenie as an MCP tool server against the
// existing Express API (`GET /api/mcp/tools`, `POST /api/mcp/call`) via
// lib/api. The tools discovery response doubles as the server manifest
// (protocol, version, name, description) — there is no separate `GET /api/mcp`
// manifest route.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface McpTool {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; example?: unknown }>;
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
// MCP JSON-RPC shape: success → { content: [{type,text}], isError }, error →
// { error: { code, message } }.
interface CallResp {
  ok?: boolean;
  error?: string | { code?: number; message?: string };
  content?: { type: string; text: string }[];
  isError?: boolean;
}

export default function McpServer() {
  const toast = useToast();
  const [manifest, setManifest] = useState<ToolsResp | null>(null);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [selTool, setSelTool] = useState("");
  const [args, setArgs] = useState("{}");
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; body: string } | null>(null);

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

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <h2>🔌 MCP Server</h2>
        <p className="view-sub">
          InfoGenie as an MCP (Model Context Protocol) tool server — connect any AI agent to your
          marketing data and actions.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 1000 }}>
        <div>
          <div className="ig-card">
            <h3 style={{ margin: "0 0 16px", fontSize: "1rem" }}>🔌 Connection Details</h3>
            <div>
              {manifest === null ? (
                <div
                  style={{ textAlign: "center", padding: 32, color: "#6b7280", fontSize: "0.9rem" }}
                >
                  ⏳ Loading…
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "#6b7280", fontWeight: 700 }}>
                      SERVER NAME
                    </span>
                    <div style={{ fontWeight: 600 }}>{manifest.name || "InfoGenie MCP"}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "#6b7280", fontWeight: 700 }}>
                      VERSION
                    </span>
                    <div style={{ fontWeight: 600 }}>{manifest.version || "1.0"}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "#6b7280", fontWeight: 700 }}>
                      ENDPOINT
                    </span>
                    <code
                      style={{
                        fontSize: "0.78rem",
                        background: "#f8fafc",
                        padding: "4px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {origin}/api/mcp/tools
                    </code>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#10b981",
                        display: "inline-block",
                      }}
                    />
                    <span style={{ fontSize: "0.85rem", color: "#15803d", fontWeight: 600 }}>
                      Server Online
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="ig-card" style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Available Tools</h3>
            <div>
              {tools === null ? (
                <div
                  style={{ textAlign: "center", padding: 32, color: "#6b7280", fontSize: "0.9rem" }}
                >
                  ⏳ Loading…
                </div>
              ) : (
                tools.map((t) => (
                  <div
                    key={t.name}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 7,
                      padding: "9px 12px",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#4f46e5" }}>
                      {t.name}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 2 }}>
                      {t.description}
                    </div>
                    {t.inputSchema?.properties && (
                      <div style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 4 }}>
                        Params: {Object.keys(t.inputSchema.properties).join(", ")}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div>
          <div className="ig-card">
            <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>🧪 Test a Tool</h3>
            <div className="form-group">
              <label>Tool Name</label>
              <select
                className="form-control"
                value={selTool}
                onChange={(e) => onSelectTool(e.target.value)}
              >
                {tools === null ? (
                  <option value="">Loading…</option>
                ) : (
                  tools.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="form-group">
              <label>Arguments (JSON)</label>
              <textarea
                className="form-control"
                rows={5}
                placeholder='{"query": "competitors"}'
                value={args}
                onChange={(e) => setArgs(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              disabled={calling}
              onClick={call}
            >
              {calling ? "⏳ Calling…" : "🚀 Call Tool"}
            </button>
            <div style={{ marginTop: 14, fontSize: "0.82rem" }}>
              {result &&
                (result.ok ? (
                  <div
                    style={{
                      background: "#f0fdf4",
                      border: "1px solid #86efac",
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#15803d", marginBottom: 8 }}>
                      ✅ Result
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: "0.78rem",
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                        color: "#374151",
                      }}
                    >
                      {result.body}
                    </pre>
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#fef2f2",
                      border: "1px solid #fca5a5",
                      borderRadius: 8,
                      padding: 12,
                      color: "#b91c1c",
                      fontSize: "0.82rem",
                    }}
                  >
                    ⚠️ {result.body}
                  </div>
                ))}
            </div>
          </div>
          <div className="ig-card" style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>📚 Integration Guides</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 4 }}>
                  Claude (Anthropic)
                </div>
                <code
                  style={{
                    fontSize: "0.75rem",
                    background: "#f8fafc",
                    padding: "6px 10px",
                    borderRadius: 5,
                    display: "block",
                    color: "#374151",
                  }}
                >
                  mcp install --url {origin}/api/mcp/tools
                </code>
              </div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 4 }}>
                  OpenAI Agents SDK
                </div>
                <code
                  style={{
                    fontSize: "0.75rem",
                    background: "#f8fafc",
                    padding: "6px 10px",
                    borderRadius: 5,
                    display: "block",
                    color: "#374151",
                  }}
                >
                  MCPServerSse(url=&quot;{origin}/api/mcp/tools&quot;)
                </code>
              </div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 4 }}>
                  Direct HTTP
                </div>
                <code
                  style={{
                    fontSize: "0.75rem",
                    background: "#f8fafc",
                    padding: "6px 10px",
                    borderRadius: 5,
                    display: "block",
                    color: "#374151",
                  }}
                >
                  POST {origin}/api/mcp/call
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
