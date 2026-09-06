"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";
import PanelShell from "@/components/layout/PanelShell";

interface Tool { view: string; label: string; role: string }
interface Check { id: string; done: boolean; label: string }
interface StudioStatus {
  ok?: boolean;
  channel?: string;
  score?: number;
  stats?: Record<string, unknown>;
  tools?: Tool[];
  checklist?: Check[];
  workflow?: string[];
  providers?: Record<string, boolean>;
  error?: string;
}

const META: Record<string, { group: string; title: string; sub: string; gradient: string; endpoint: string }> = {
  newsletter: {
    group: "Create",
    title: "📰 Newsletter Studio",
    sub: "Owned newsletter ops + competitor tracking — list growth, issues, automations, and intel in one studio.",
    gradient: "linear-gradient(135deg,#eff6ff 0%,#ecfdf5 55%,#fff7ed 100%)",
    endpoint: "/api/channel-studios/newsletter/status",
  },
  podcast: {
    group: "Create",
    title: "🎙️ Podcast Marketing Studio",
    sub: "From competitive podcast intel to episode briefs, show notes, distribution, and short-form clips.",
    gradient: "linear-gradient(135deg,#fdf4ff 0%,#eff6ff 55%,#ecfdf5 100%)",
    endpoint: "/api/channel-studios/podcast/status",
  },
  push: {
    group: "Reach",
    title: "🔔 Push Notification Marketing",
    sub: "Web and mobile push as a first-class channel — providers, subscribers, journeys, and pixel triggers.",
    gradient: "linear-gradient(135deg,#eff6ff 0%,#f0fdf4 55%,#fdf4ff 100%)",
    endpoint: "/api/channel-studios/push/status",
  },
  "social-commerce": {
    group: "Reach",
    title: "🛒 Social Commerce",
    sub: "Catalog, shoppable links, Stripe checkout, and attributable social selling.",
    gradient: "linear-gradient(135deg,#fff7ed 0%,#ecfdf5 55%,#eff6ff 100%)",
    endpoint: "/api/channel-studios/social-commerce/status",
  },
  interactive: {
    group: "Reach",
    title: "🧩 Interactive Lead Builder",
    sub: "Quizzes, surveys, and assessments that feed Lead Intelligence, audiences, and CRM automatically.",
    gradient: "linear-gradient(135deg,#ecfdf5 0%,#fef3c7 55%,#eff6ff 100%)",
    endpoint: "/api/channel-studios/interactive/status",
  },
};

export default function ChannelStudioPanel({ channel }: { channel: keyof typeof META }) {
  const router = useRouter();
  const meta = META[channel];
  const [data, setData] = useState<StudioStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet<StudioStatus>(meta.endpoint);
    if (r.ok !== false) setData(r);
    setLoading(false);
  }, [meta.endpoint]);

  useEffect(() => { load(); }, [load]);

  return (
    <PanelShell group={meta.group} title={meta.title} subtitle={meta.sub} maxWidth={880}>
      {loading && <p style={{ color: "#6B7280" }}>Loading studio…</p>}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 18 }}>
            <div className="ig-tile" style={card}>
              <div style={label}>Depth score</div>
              <div style={val}>{data.score ?? 0}/100</div>
            </div>
            {Object.entries(data.stats || {}).slice(0, 4).map(([k, v]) => (
              <div key={k} className="ig-tile" style={card}>
                <div style={label}>{k.replace(/([A-Z])/g, " $1")}</div>
                <div style={val}>{String(v)}</div>
              </div>
            ))}
          </div>

          {(data.checklist || []).length > 0 && (
            <div className="ig-section-card" style={{ ...card, marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 10px", color: "#0F172A" }}>Checklist</h3>
              {(data.checklist || []).map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: "0.85rem" }}>
                  <span>{c.done ? "✅" : "⬜"}</span>
                  <span style={{ color: c.done ? "#065F46" : "#374151" }}>{c.label}</span>
                </div>
              ))}
            </div>
          )}

          {(data.workflow || []).length > 0 && (
            <div className="ig-section-card" style={{ ...card, marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 10px", color: "#0F172A" }}>Workflow</h3>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: "0.85rem", color: "#374151" }}>
                {(data.workflow || []).map((step) => <li key={step} style={{ marginBottom: 6 }}>{step}</li>)}
              </ol>
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {(data.tools || []).map((t) => (
              <button key={t.view} type="button" className="ig-hub-tile" onClick={() => goToView(router, t.view)} style={toolBtn}>
                <div>
                  <strong style={{ color: "#0F172A" }}>{t.label}</strong>
                  <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748B" }}>{t.role}</p>
                </div>
                <span style={{ color: "#0066FF", fontWeight: 700 }}>Open →</span>
              </button>
            ))}
          </div>
        </>
      )}
    </PanelShell>
  );
}

const card: CSSProperties = {
  background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px",
};
const label: CSSProperties = {
  fontSize: "0.68rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase",
};
const val: CSSProperties = { fontSize: "1.35rem", fontWeight: 800, marginTop: 4 };
const toolBtn: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  textAlign: "left", background: "white", border: "1px solid #E5E7EB", borderRadius: 12,
  padding: 16, cursor: "pointer",
};
