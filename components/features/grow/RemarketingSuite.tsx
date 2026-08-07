"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Rec {
  id: string;
  priority: string;
  title: string;
  detail: string;
  actionView: string;
}

interface Status {
  healthScore?: number;
  pixels?: { configured: number; total: number; score: number };
  audiences?: { segments: number; enabled: number; retargetingSegments: number; totalMembers: number };
  capiEvents30d?: number;
  recommendations?: Rec[];
}

const priColor: Record<string, string> = { high: "#DC2626", medium: "#D97706", low: "#2563EB" };

export default function RemarketingSuite() {
  const router = useRouter();
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet<{ ok?: boolean } & Status>("/api/remarketing/status");
    if (r.ok !== false) setData(r);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#fef3c7 0%,#eef2ff 55%,#ecfdf5 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Grow</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Remarketing Suite
        </div>
        <h1 className="ih-title">🔄 Remarketing & Retargeting Center</h1>
        <p className="ih-sub">
          Pixel health, audience pools, and CAPI signal strength — one checklist to answer “are we retargeting properly?”
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
        {loading && <p style={{ color: "#6B7280" }}>Loading status…</p>}
        {data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
              {[
                ["Health score", `${data.healthScore ?? 0}/100`],
                ["Pixels live", `${data.pixels?.configured ?? 0}/${data.pixels?.total ?? 3}`],
                ["Retarget segments", String(data.audiences?.retargetingSegments ?? 0)],
                ["Audience members", String(data.audiences?.totalMembers ?? 0)],
                ["CAPI events (30d)", String(data.capiEvents30d ?? 0)],
              ].map(([label, val]) => (
                <div key={String(label)} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: 4 }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
              <h3 style={{ margin: "0 0 14px" }}>Recommended actions</h3>
              {(data.recommendations || []).map((rec) => (
                <div key={rec.id} style={{ padding: "12px 0", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>
                      <span style={{ color: priColor[rec.priority] || "#374151", textTransform: "uppercase", fontSize: "0.65rem", marginRight: 8 }}>{rec.priority}</span>
                      {rec.title}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: "0.82rem", color: "#64748B" }}>{rec.detail}</p>
                  </div>
                  <button type="button" onClick={() => goToView(router, rec.actionView)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#0066FF", color: "white", fontWeight: 700, cursor: "pointer", fontSize: "0.78rem" }}>
                    Fix →
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
