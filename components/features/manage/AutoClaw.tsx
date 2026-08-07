"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";

interface Status {
  ok?: boolean;
  zai?: {
    configured?: boolean;
    endpoint?: { endpointId?: string; label?: string; baseUrl?: string; model?: string; fallback?: boolean };
    productUrl?: string;
    docsUrl?: string;
  };
  gateway?: { configured?: boolean; enabled?: boolean; url?: string | null };
  models?: string[];
}

interface Config {
  gateway_url?: string;
  hooks_token_set?: boolean;
  endpoint_mode?: string;
  preferred_model?: string;
  enabled?: boolean;
}

interface Task {
  id: number;
  task_type?: string;
  message: string;
  status: string;
  error?: string;
  created_at: string;
}

const ENDPOINT_OPTS = [
  { value: "auto", label: "Auto-detect (recommended)" },
  { value: "zai-coding-global", label: "AutoClaw / Coding Plan (Global)" },
  { value: "zai-coding-cn", label: "AutoClaw / Coding Plan (CN)" },
  { value: "zai-global", label: "Z.ai General (Global)" },
  { value: "zai-cn", label: "Z.ai General (CN)" },
];

export default function AutoClaw() {
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<Config>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [hooksToken, setHooksToken] = useState("");
  const [endpointMode, setEndpointMode] = useState("auto");
  const [model, setModel] = useState("glm-5.2");
  const [enabled, setEnabled] = useState(false);
  const [taskMsg, setTaskMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [st, cfg, tk] = await Promise.all([
      apiGet<Status>("/api/autoclaw/status"),
      apiGet<{ ok?: boolean; config?: Config }>("/api/autoclaw/config"),
      apiGet<{ ok?: boolean; tasks?: Task[] }>("/api/autoclaw/tasks"),
    ]);
    if (st.ok) setStatus(st);
    const c = cfg.config || {};
    setConfig(c);
    setGatewayUrl(c.gateway_url || "");
    setEndpointMode(c.endpoint_mode || "auto");
    setModel(c.preferred_model || "glm-5.2");
    setEnabled(!!c.enabled);
    setTasks(tk.tasks || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    setBusy("save");
    const r = await apiPut<{ ok?: boolean; error?: string }>("/api/autoclaw/config", {
      gateway_url: gatewayUrl,
      hooks_token: hooksToken || undefined,
      endpoint_mode: endpointMode,
      preferred_model: model,
      enabled,
    });
    setBusy("");
    setHooksToken("");
    setMsg(r.ok ? "Settings saved." : (r.error || "Save failed"));
    load();
  };

  const detectEndpoint = async () => {
    setBusy("detect");
    const r = await apiPost<{ ok?: boolean; detected?: { label?: string; model?: string } }>("/api/autoclaw/detect-endpoint", { mode: endpointMode });
    setBusy("");
    if (r.ok && r.detected) setMsg(`Detected: ${r.detected.label} · model ${r.detected.model}`);
    else setMsg("Detection failed — check ZAI_API_KEY in Admin → Platform APIs.");
    load();
  };

  const dispatchTask = async () => {
    if (!taskMsg.trim()) return;
    setBusy("dispatch");
    const r = await apiPost<{ ok?: boolean; error?: string; dispatch?: { error?: string } }>("/api/autoclaw/dispatch", {
      message: taskMsg,
      task_type: "marketing",
      deliver: false,
    });
    setBusy("");
    setMsg(r.ok ? "Task dispatched to AutoClaw gateway." : (r.error || r.dispatch?.error || "Dispatch failed"));
    setTaskMsg("");
    load();
  };

  const ep = status?.zai?.endpoint;

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#eef2ff 0%,#e8f6f3 55%,#f0fdf4 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Manage</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> AutoClaw
        </div>
        <h1 className="ih-title">🦞 AutoClaw</h1>
        <p className="ih-sub">
          Connect InfoGenie to <a href="https://autoclaw.z.ai/" target="_blank" rel="noreferrer">AutoClaw</a> — Z.ai&apos;s desktop AI partner with GLM 5.2, browser automation, and 50+ skills.
          API calls route through the AutoClaw Coding Plan endpoint; long-running tasks dispatch to your local OpenClaw gateway.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        {msg && (
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", padding: 12, borderRadius: 10, marginBottom: 16, fontSize: "0.85rem" }}>
            {msg}
          </div>
        )}

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Z.ai / GLM status</h3>
          <div style={{ fontSize: "0.85rem", color: "#374151", lineHeight: 1.6 }}>
            <div>API key: {status?.zai?.configured ? "✅ configured" : "❌ add ZAI_API_KEY in Admin → Platform APIs"}</div>
            {ep && (
              <div>Endpoint: <strong>{ep.label}</strong> ({ep.endpointId}) · model <code>{ep.model}</code>{ep.fallback ? " (fallback)" : ""}</div>
            )}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={endpointMode} onChange={(e) => setEndpointMode(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #D1D5DB" }}>
              {ENDPOINT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button type="button" disabled={busy === "detect"} onClick={detectEndpoint} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>
              {busy === "detect" ? "Detecting…" : "Detect endpoint"}
            </button>
          </div>
        </div>

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>OpenClaw / AutoClaw gateway</h3>
          <p style={{ fontSize: "0.82rem", color: "#6B7280", margin: "0 0 14px" }}>
            Point at your running AutoClaw desktop gateway (hooks enabled). InfoGenie sends tasks via <code>POST /hooks/agent</code>.
          </p>
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>Gateway URL</label>
          <input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} placeholder="https://your-gateway:18789" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 10, boxSizing: "border-box" }} />
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>Hooks token {config.hooks_token_set ? "(saved — leave blank to keep)" : ""}</label>
          <input type="password" value={hooksToken} onChange={(e) => setHooksToken(e.target.value)} placeholder="hooks.token from openclaw.json" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 10, boxSizing: "border-box" }} />
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>Preferred model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 12 }}>
            {(status?.models || ["glm-5.2"]).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: "0.85rem" }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable gateway dispatch from InfoGenie
          </label>
          <button type="button" disabled={busy === "save"} onClick={saveConfig} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer" }}>
            {busy === "save" ? "Saving…" : "Save settings"}
          </button>
        </div>

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Dispatch a task</h3>
          <textarea value={taskMsg} onChange={(e) => setTaskMsg(e.target.value)} rows={4} placeholder="e.g. Pull last week's Google Ads search terms, flag wasteful queries, and draft negative keyword list for review." style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", marginBottom: 10, boxSizing: "border-box", fontFamily: "inherit" }} />
          <button type="button" disabled={!enabled || busy === "dispatch"} onClick={dispatchTask} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: enabled ? "linear-gradient(135deg,#10B981,#059669)" : "#9CA3AF", color: "white", fontWeight: 700, cursor: enabled ? "pointer" : "not-allowed" }}>
            {busy === "dispatch" ? "Sending…" : "Send to AutoClaw"}
          </button>
        </div>

        {tasks.length > 0 && (
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: "0 0 12px" }}>Recent dispatches</h3>
            {tasks.slice(0, 10).map((t) => (
              <div key={t.id} style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.82rem" }}>
                <div style={{ fontWeight: 600 }}>{t.status} · {t.task_type || "task"}</div>
                <div style={{ color: "#6B7280", marginTop: 4 }}>{t.message.slice(0, 160)}{t.message.length > 160 ? "…" : ""}</div>
                {t.error && <div style={{ color: "#B91C1C", marginTop: 4 }}>{t.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
