"use client";

import { useState } from "react";
import { api, type AnalyseResult } from "@/lib/api";
import GateChecklist from "@/components/GateChecklist";

const REGIONS = ["Global", "North America", "Europe", "United Kingdom", "South Africa", "Middle East", "Asia-Pacific", "Latin America"];
const TRY = ["shopify.com", "etoro.com", "hubspot.com", "coursera.org", "booking.com", "coinbase.com"];

export default function AnalysePage() {
  const [website, setWebsite] = useState("");
  const [sector, setSector] = useState("");
  const [region, setRegion] = useState("Global");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);

  async function run(e?: React.FormEvent, presetSite?: string) {
    e?.preventDefault();
    const site = presetSite ?? website;
    if (!site && !sector) { setError("Enter a website or a sector — either one is enough to begin."); return; }
    setRunning(true); setError(null); setResult(null); setGateOpen(false);
    try {
      setResult(await api.analyse({ website: site || undefined, sector: sector || undefined, region }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="analyse-hero">
        <span className="hero-kicker">● AI-powered autonomous marketing intelligence</span>
        <h1 className="hero-title">
          Turn Competitor Intel<br />Into <span className="hero-grad">Autonomous Growth</span>
        </h1>
        <p className="hero-sub">
          Enter your website — or just pick a sector — and InfoGenie infers your industry, identifies
          the competitors in that exact industry, and analyses each one into a battle plan. Every run
          goes through the guardrail gate and onto the audit rail.
        </p>
      </div>

      <form className="card analyse-card" onSubmit={run}>
        <div className="analyse-row">
          <div className="url-input">
            <span className="url-prefix">https://</span>
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="yourwebsite.com"
              aria-label="Website"
            />
          </div>
          <select className="input region-select" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="btn primary analyse-btn" type="submit" disabled={running}>
            {running ? "Analysing…" : "→ Analyse Now"}
          </button>
        </div>
        <div className="analyse-row">
          <input
            type="text"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="…or analyse by sector alone — e.g. SaaS, fintech, e-commerce, travel, crypto"
            aria-label="Sector"
          />
        </div>
        <div className="try-row">
          <span>Try:</span>
          {TRY.map((t) => (
            <button key={t} type="button" className="chip" onClick={() => { setWebsite(t); void run(undefined, t); }}>
              {t}
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>

      {result && (
        <div className="stack" style={{ marginTop: 18 }}>
          <div className={`banner ${result.status === "blocked" ? "block" : "pass"}`} style={{ marginBottom: 0 }}>
            {result.status === "blocked"
              ? <>Blocked by the gate: {result.gate.reason}</>
              : <>Mapped <b>{result.market.competitors.length} competitors</b> in <b>{result.market.industry}</b> ({result.market.region}) for <b>{result.market.subject}</b> — analysed through the governed path
                {result.status === "pending_approval" ? "; battle plan queued for approval." : "."}</>}
            <button type="button" className="gate-link" onClick={() => setGateOpen((o) => !o)}>
              {gateOpen ? "hide gate verdict" : "gate verdict"}
            </button>
          </div>

          {gateOpen && (
            <div className="card">
              <GateChecklist gate={result.gate} />
            </div>
          )}

          {result.status !== "blocked" && (
            <>
              <div className="competitor-grid">
                {result.market.competitors.map((c) => (
                  <div key={c.domain + c.name} className="card competitor-card">
                    <div className="comp-head">
                      <div>
                        <b>{c.name}</b>
                        <div className="comp-domain">{c.domain}</div>
                      </div>
                      <span className={`pill threat-${c.threat}`}>{c.threat} threat</span>
                    </div>
                    <p className="comp-positioning">{c.positioning}</p>
                    <div className="comp-lists">
                      <div>
                        <span className="comp-label">Strengths</span>
                        <ul>{c.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                      </div>
                      <div>
                        <span className="comp-label">Weaknesses</span>
                        <ul>{c.weaknesses.map((w) => <li key={w}>{w}</li>)}</ul>
                      </div>
                    </div>
                    <div className="comp-counter"><b>Counter-move:</b> {c.counterMove}</div>
                  </div>
                ))}
              </div>
              {result.output && (
                <div className="card">
                  <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Battle plan</h2>
                  <div className="output-box">{result.output}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
