"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Signal { id: string; label: string; status: string; weight: number; earned: number; message?: string; fix?: string }
interface Report { url: string; score: number; grade: string; signals?: Signal[]; priority?: string }

export default function VoiceSeo() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const h = await apiGet<{ ok?: boolean; runs?: Report[] }>("/api/voice-seo/runs");
    setHistory(h.runs || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!url.trim()) return;
    setLoading(true);
    const r = await apiPost<Report & { ok?: boolean }>("/api/voice-seo/run", { url: url.trim() });
    setLoading(false);
    if (r.ok !== false) setReport(r);
    load();
  };

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#f0fdf4 0%,#e0f2fe 55%,#eef2ff 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Analyse</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Voice SEO
        </div>
        <h1 className="ih-title">🎙️ Voice Search Optimization</h1>
        <p className="ih-sub">
          Conversational queries, speakable answers (~29 words), and FAQ schema — a fast follow-on to AEO for Alexa, Siri, and Google Assistant.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yoursite.com/page" style={{ flex: 1, minWidth: 240, padding: 10, borderRadius: 8, border: "1px solid #D1D5DB" }} />
            <button type="button" disabled={loading} onClick={run} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#0F766E", color: "white", fontWeight: 700, cursor: "pointer" }}>
              {loading ? "Running…" : "Voice audit"}
            </button>
            <button type="button" onClick={() => goToView(router, "zero-click-hub")} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>Zero-Click Hub</button>
          </div>
        </div>

        {report && (
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 18 }}>
            <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>{report.score}/100 · Grade {report.grade}</div>
            <p style={{ fontSize: "0.85rem", color: "#6B7280" }}>{report.url}</p>
            {report.priority && <p style={{ fontSize: "0.85rem" }}>{report.priority}</p>}
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {(report.signals || []).map((s) => (
                <div key={s.id} style={{ fontSize: "0.82rem", padding: 10, background: "#F9FAFB", borderRadius: 8 }}>
                  <strong>{s.label}</strong> — {s.status} ({Math.round((s.earned / s.weight) * 100)}%)
                  {s.fix && s.status !== "pass" && <div style={{ color: "#64748B", marginTop: 4 }}>{s.fix}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div style={{ fontSize: "0.8rem", color: "#6B7280" }}>
            {history.length} past voice audit(s) on file.
          </div>
        )}
      </div>
    </div>
  );
}
