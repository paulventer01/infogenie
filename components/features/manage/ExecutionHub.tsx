"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Integration {
  id: string;
  label: string;
  category: string;
  status: string;
  detail: string;
  view: string;
}

const statusColor: Record<string, string> = {
  ready: "#059669",
  partial: "#D97706",
  research: "#2563EB",
  scaffold: "#6B7280",
  needs_key: "#DC2626",
  needs_oauth: "#DC2626",
};

export default function ExecutionHub() {
  const router = useRouter();
  const [score, setScore] = useState(0);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [segmentConfigured, setSegmentConfigured] = useState(false);
  const [trackMsg, setTrackMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [hub, seg] = await Promise.all([
      apiGet<{ score?: number; integrations?: Integration[] }>("/api/execution-hub/status"),
      apiGet<{ configured?: boolean }>("/api/segment/status"),
    ]);
    setScore(hub.score ?? 0);
    setIntegrations(hub.integrations || []);
    setSegmentConfigured(!!seg.configured);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function testSegment() {
    setBusy(true);
    setTrackMsg("");
    const r = await apiPost<{ status?: string; dryRun?: boolean; error?: string }>("/api/segment/track", {
      event: "InfoGenie Ecosystem Ping",
      properties: { surface: "execution-hub" },
    });
    setBusy(false);
    if (r.ok === false) { setTrackMsg(r.error || "Track failed"); return; }
    setTrackMsg(r.dryRun
      ? `Queued locally (status=${r.status}) — set SEGMENT_WRITE_KEY for live CDP`
      : `Forwarded to Segment (status=${r.status})`);
  }

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#f8fafc 0%,#eff6ff 50%,#ecfdf5 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Manage</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Execution Hub
        </div>
        <h1 className="ih-title">🔌 Execution Integrations</h1>
        <p className="ih-sub">
          Canva, Mailchimp, Performance Max, LinkedIn Ads, and Segment — connectors that let InfoGenie publish and sync in the real world.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase" }}>Connector readiness</div>
          <div style={{ fontSize: "2rem", fontWeight: 800 }}>{score}/100</div>
        </div>

        <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
          {integrations.map((i) => (
            <div key={i.id} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {i.label}{" "}
                  <span style={{ fontSize: "0.68rem", color: statusColor[i.status] || "#6B7280", textTransform: "uppercase", marginLeft: 6 }}>
                    {i.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#64748B" }}>{i.category} — {i.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => goToView(router, i.view)}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer", fontSize: "0.78rem", height: "fit-content" }}
              >
                Open →
              </button>
            </div>
          ))}
        </div>

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
          <h3 style={{ margin: "0 0 8px" }}>Segment CDP test</h3>
          <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "#64748B" }}>
            {segmentConfigured
              ? "Write key detected — events will forward to api.segment.io."
              : "No SEGMENT_WRITE_KEY — events are logged locally until you connect."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={testSegment}
            style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#0F766E", color: "white", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}
          >
            {busy ? "Sending…" : "Send test track event"}
          </button>
          {trackMsg && <p style={{ marginTop: 10, fontSize: "0.82rem", color: "#065F46" }}>{trackMsg}</p>}
        </div>
      </div>
    </div>
  );
}
