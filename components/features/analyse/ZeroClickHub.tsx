"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Signal {
  id: string;
  label: string;
  status: string;
  weight: number;
  earned: number;
  message?: string;
  fix?: string;
}

interface Report {
  id?: string;
  url: string;
  score: number;
  grade: string;
  clicklessImpressionPct?: number;
  aeoScore?: number;
  signals?: Signal[];
  fixes?: { id: string; label: string; status: string; fix: string }[];
  priority?: string;
  created_at?: string;
}

const statusIcon = (s: string) => (s === "pass" ? "✅" : s === "warn" ? "⚠️" : "❌");

export default function ZeroClickHub() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const h = await apiGet<{ ok?: boolean; runs?: Report[] }>("/api/zero-click/runs");
    setHistory(h.runs || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setErr("");
    const r = await apiPost<Report & { ok?: boolean; error?: string }>("/api/zero-click/run", { url: url.trim() });
    setLoading(false);
    if (!r.ok) { setErr(r.error || "Audit failed"); return; }
    setReport(r);
    load();
  };

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#eef2ff 0%,#e0f2fe 55%,#ecfdf5 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Analyse</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Zero-Click Hub
        </div>
        <h1 className="ih-title">🎯 Zero-Click & AI SERP Hub</h1>
        <p className="ih-sub">
          Featured snippets, People Also Ask, and AI Overview readiness — extends your AEO score with zero-click visibility signals.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <h3 style={{ margin: "0 0 12px" }}>Run zero-click audit</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yoursite.com/page"
              style={{ flex: 1, minWidth: 240, padding: 10, borderRadius: 8, border: "1px solid #D1D5DB" }}
            />
            <button type="button" disabled={loading} onClick={run} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer" }}>
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
          {err && <p style={{ color: "#B91C1C", fontSize: "0.85rem", marginTop: 10 }}>{err}</p>}
        </div>

        {report && (
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: "2rem", fontWeight: 900, color: "#0A1628" }}>
                  {report.score}/100 <span style={{ fontSize: "1.2rem" }}>Grade {report.grade}</span>
                </div>
                <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>{report.url}</div>
                {report.clicklessImpressionPct != null && (
                  <div style={{ fontSize: "0.85rem", marginTop: 8, color: "#374151" }}>
                    Est. zero-click impression share: <strong>{report.clicklessImpressionPct}%</strong>
                    {report.aeoScore != null && <> · AEO {report.aeoScore}/100</>}
                  </div>
                )}
                {report.priority && <p style={{ fontSize: "0.85rem", marginTop: 8 }}>{report.priority}</p>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => goToView(router, "aeo-optimizer")} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>Open AEO</button>
                <button type="button" onClick={() => goToView(router, "serp-tracker")} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#10B981", color: "white", fontWeight: 700, cursor: "pointer" }}>Rank Tracker</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              {(report.signals || []).map((s) => (
                <div key={s.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6B7280" }}>{statusIcon(s.status)} {s.label}</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 800, marginTop: 4 }}>{Math.round((s.earned / s.weight) * 100)}%</div>
                  <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "6px 0 0" }}>{s.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: "0 0 12px" }}>Recent audits</h3>
            {history.slice(0, 8).map((r) => (
              <div key={r.id || r.url} style={{ padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.82rem", display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "#374151" }}>{r.url}</span>
                <span style={{ fontWeight: 700 }}>{r.score}/100 ({r.grade})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
