"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, type Capability, type RunResult } from "@/lib/api";
import GateChecklist from "@/components/GateChecklist";

const DOMAIN_LABELS: Record<string, string> = {
  compete: "Compete", grow: "Grow", reach: "Reach", manage: "Manage",
  analyse: "Analyse", monitor: "Monitor", create: "Create", seo: "SEO",
};

function StudioInner() {
  const searchParams = useSearchParams();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [key, setKey] = useState<string>("");
  const [brief, setBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.capabilities().then(({ capabilities }) => {
      setCapabilities(capabilities);
    }).catch(() => {});
  }, []);

  // Selection arrives from the sidebar tree (?cap=…); default to content generation.
  const capParam = searchParams.get("cap");
  useEffect(() => {
    if (capParam) {
      setKey(capParam);
      setResult(null);
      setError(null);
    } else if (!key && capabilities.length) {
      const first = capabilities.find((c) => c.key === "create.content_generation") ?? capabilities[0];
      if (first) setKey(first.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capParam, capabilities]);

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
        Pick any of the {capabilities.length} capabilities from the menu on the left — every one runs
        the same governed path: untrusted brief → integration evidence → grounded generation →
        the seven-check gate → autonomy decision → audit rail.
      </p>

      <div className="two-col" style={{ alignItems: "start" }}>
        <form className="card" onSubmit={run}>
          <div className="field">
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
              Selected capability — pick another from the Capability Studio menu on the left
            </span>
            {selected ? (
              <>
                <div className="selected-cap">
                  <b>{selected.name}</b>
                  <span className="pill level">{DOMAIN_LABELS[selected.domain] ?? selected.domain}</span>
                  {selected.irreversible && <span className="pill blocked">A2 max</span>}
                </div>
                <div className="hint">
                  {selected.description ?? ""}
                  <div style={{ marginTop: 4 }}>
                    {selected.archetype} · {selected.agent_type} · runs at A{selected.level}
                    {selected.irreversible ? " · irreversible (never exceeds A2)" : ""}
                    {selected.integrations.length > 0 && <> · draws on: {selected.integrations.join(", ")}</>}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty" style={{ padding: 14 }}>Pick a capability from the sidebar menu.</div>
            )}
          </div>
          <label className="field"><span>Brief</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. Analyse how Initech Stores is positioned against us this quarter."
              required
            />
          </label>
          <button className="btn primary" type="submit" disabled={running || !brief || !selected}>
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

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioInner />
    </Suspense>
  );
}
