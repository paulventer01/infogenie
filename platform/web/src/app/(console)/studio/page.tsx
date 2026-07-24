"use client";

import { useEffect, useState } from "react";
import { api, type Capability, type RunResult } from "@/lib/api";
import GateChecklist from "@/components/GateChecklist";

export default function StudioPage() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [key, setKey] = useState<string>("");
  const [brief, setBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.capabilities().then(({ capabilities }) => {
      setCapabilities(capabilities);
      const first = capabilities.find((c) => c.key === "create.content_generation") ?? capabilities[0];
      if (first) setKey(first.key);
    }).catch(() => {});
  }, []);

  const selected = capabilities.find((c) => c.key === key);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true); setError(null); setResult(null);
    try {
      setResult(await api.run(key, brief));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Capability Studio</h1>
      <p className="page-sub">
        Run a governed capability. The brief is treated as untrusted input (screened for prompt
        injection), grounded in the current Brand Foundation, and the output passes the seven-check
        guardrail gate before anything is allowed to happen with it.
      </p>

      <div className="two-col" style={{ alignItems: "start" }}>
        <form className="card" onSubmit={run}>
          <label className="field"><span>Capability</span>
            <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
              {capabilities.map((c) => (
                <option key={c.key} value={c.key}>{c.name} ({c.domain})</option>
              ))}
            </select>
            {selected && (
              <div className="hint">
                {selected.archetype} · {selected.agent_type} · runs at A{selected.level}
                {selected.irreversible ? " · irreversible (never exceeds A2)" : ""}
              </div>
            )}
          </label>
          <label className="field"><span>Brief</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. Write a short social post announcing our winter sale."
              required
            />
          </label>
          <button className="btn primary" type="submit" disabled={running || !brief}>
            {running ? "Running through the gate…" : "▶ Run capability"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>

        <div className="stack">
          {!result && !running && (
            <div className="card"><div className="empty">The gate verdict and output will appear here.</div></div>
          )}
          {result && (
            <>
              <div className={`banner ${result.status === "executed" ? "pass" : result.status === "pending_approval" ? "hold" : "block"}`} style={{ marginBottom: 0 }}>
                {result.status === "pending_approval" && <>Passed the gate at <b>A{result.autonomyLevel}</b> — queued for human approval (the system proposes, a human disposes).</>}
                {result.status === "executed" && <>Passed the gate and executed within <b>A{result.autonomyLevel}</b> bounds.</>}
                {result.status === "blocked" && <>Blocked by the gate: {result.gate.reason}</>}
              </div>
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontSize: 15, margin: 0 }}>Gate verdict</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span className={`pill ${result.status}`}>{result.status.replace("_", " ")}</span>
                    <span className="pill level">{result.mode === "live" ? "live model" : "mock engine"}</span>
                    {result.brandVersion && <span className="pill level">brand v{result.brandVersion}</span>}
                  </div>
                </div>
                <GateChecklist gate={result.gate} />
              </div>
              {result.output && (
                <div className="card">
                  <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Output</h2>
                  <div className="output-box">{result.output}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
