"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface TimelineRow {
  period: string;
  what_happens: string;
  metric_impact: string;
}
interface MetricAffected {
  metric: string;
  direction: string;
  estimated_change: string;
}
interface SimResults {
  confidence?: number;
  scenario_title?: string;
  verdict?: string;
  executive_summary?: string;
  timeline?: TimelineRow[];
  upsides?: string[];
  risks?: string[];
  key_metrics_affected?: MetricAffected[];
  recommended_action?: string;
  alternative_scenarios?: string[];
}
interface ShareData {
  ok: boolean;
  question?: string;
  scenario_name?: string;
  results?: SimResults;
  created_at?: string;
  error?: string;
}

function verdictColor(v: string) {
  return v === "positive"
    ? "#10b981"
    : v === "negative"
    ? "#ef4444"
    : v === "mixed"
    ? "#f59e0b"
    : "#6b7280";
}

function ConfidenceRing({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const col = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 64,
        height: 64,
        borderRadius: "50%",
        background: `conic-gradient(${col} ${pct}%, #e5e7eb 0)`,
        fontSize: "1.1rem",
        fontWeight: 700,
        color: col,
        flexShrink: 0,
      }}
    >
      {pct}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const bg = verdictColor(verdict);
  return (
    <span
      style={{
        background: bg,
        color: "#fff",
        borderRadius: 4,
        padding: "2px 10px",
        fontSize: ".75rem",
        fontWeight: 700,
        textTransform: "uppercase",
        display: "inline-block",
      }}
    >
      {verdict}
    </span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,.08)",
        padding: "20px 24px",
        marginBottom: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: ".75rem",
        fontWeight: 700,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: ".06em",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

export default function SimulatorSharePage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";

  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/digital-twin/share/${token}`, { credentials: "omit" })
      .then((r) => r.json())
      .then((j: ShareData) => setData(j))
      .catch(() => setData({ ok: false, error: "Failed to load simulation." }))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={pageStyle}>
        <Header name="Loading…" question="" createdAt="" />
        <div style={{ textAlign: "center", padding: "48px 16px", color: "#6b7280" }}>
          Loading simulation…
        </div>
      </div>
    );
  }

  if (!data?.ok || !data.results) {
    return (
      <div style={pageStyle}>
        <Header name="Simulation not found" question="" createdAt="" />
        <div
          style={{
            maxWidth: 820,
            margin: "0 auto",
            padding: "48px 16px",
            textAlign: "center",
            color: "#6b7280",
          }}
        >
          <p style={{ fontSize: "1rem" }}>
            {data?.error || "This simulation link is invalid or has expired."}
          </p>
          <Link
            href="/"
            style={{
              display: "inline-block",
              marginTop: 24,
              padding: "10px 22px",
              background: "#8b5cf6",
              color: "#fff",
              borderRadius: 8,
              fontWeight: 700,
              textDecoration: "none",
              fontSize: ".9rem",
            }}
          >
            Run your own simulation →
          </Link>
        </div>
      </div>
    );
  }

  const r = data.results;
  const name = data.scenario_name || data.question || "";
  const verdict = r.verdict || "mixed";
  const conf = Math.min(100, Math.max(0, r.confidence || 65));

  return (
    <div style={pageStyle}>
      <Header name={name} question={data.question || ""} createdAt={data.created_at || ""} />

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px 60px" }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <ConfidenceRing value={conf} />
            <div>
              <div style={{ fontSize: ".75rem", color: "#6b7280", textTransform: "uppercase", marginBottom: 4 }}>
                Simulation Result
              </div>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: 6 }}>
                {r.scenario_title || name}
              </div>
              <VerdictBadge verdict={verdict} />
            </div>
          </div>
          {r.executive_summary && (
            <p style={{ marginTop: 16, lineHeight: 1.65, color: "#374151" }}>
              {r.executive_summary}
            </p>
          )}
        </Card>

        {!!r.timeline?.length && (
          <Card>
            <SectionTitle>📅 What happens over 90 days</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {r.timeline.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 14,
                    padding: "10px 14px",
                    background: "#faf5ff",
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      width: 90,
                      minWidth: 90,
                      fontSize: ".75rem",
                      fontWeight: 700,
                      color: "#8b5cf6",
                      paddingTop: 2,
                    }}
                  >
                    {t.period}
                  </div>
                  <div>
                    <div style={{ fontSize: ".88rem", fontWeight: 600 }}>{t.what_happens}</div>
                    <div style={{ fontSize: ".8rem", color: "#6b7280", marginTop: 2 }}>
                      {t.metric_impact}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {!!r.key_metrics_affected?.length && (
          <Card>
            <SectionTitle>📊 Metrics affected</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {r.key_metrics_affected.map((m, i) => {
                const col =
                  m.direction === "up"
                    ? "#10b981"
                    : m.direction === "down"
                    ? "#ef4444"
                    : "#6b7280";
                const arrow =
                  m.direction === "up" ? "↑" : m.direction === "down" ? "↓" : "→";
                return (
                  <div
                    key={i}
                    style={{
                      background: "#f9fafb",
                      borderRadius: 8,
                      padding: "10px 16px",
                      textAlign: "center",
                      minWidth: 100,
                    }}
                  >
                    <div style={{ fontSize: ".75rem", color: "#6b7280", marginBottom: 4 }}>
                      {m.metric}
                    </div>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: col }}>
                      {arrow} {m.estimated_change}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {(!!r.upsides?.length || !!r.risks?.length) && (
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {!!r.upsides?.length && (
                <div>
                  <SectionTitle>✅ Upsides</SectionTitle>
                  <ul style={{ paddingLeft: 18, color: "#374151", fontSize: ".88rem", lineHeight: 1.8 }}>
                    {r.upsides.map((u, i) => <li key={i}>{u}</li>)}
                  </ul>
                </div>
              )}
              {!!r.risks?.length && (
                <div>
                  <SectionTitle>⚠️ Risks</SectionTitle>
                  <ul style={{ paddingLeft: 18, color: "#374151", fontSize: ".88rem", lineHeight: 1.8 }}>
                    {r.risks.map((u, i) => <li key={i}>{u}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        )}

        {r.recommended_action && (
          <Card>
            <SectionTitle>⚡ Recommended Action</SectionTitle>
            <div
              style={{
                background: "#eff6ff",
                borderRadius: 8,
                padding: "14px 16px",
                fontSize: ".9rem",
                color: "#1e40af",
                lineHeight: 1.6,
              }}
            >
              {r.recommended_action}
            </div>
          </Card>
        )}

        <div
          style={{
            textAlign: "center",
            padding: "24px 16px 8px",
            borderTop: "1px solid #e5e7eb",
            marginTop: 8,
          }}
        >
          <p style={{ fontSize: ".85rem", color: "#6b7280", marginBottom: 16 }}>
            Want to model your own scenarios?
          </p>
          <Link
            href="/"
            style={{
              display: "inline-block",
              padding: "11px 26px",
              background: "linear-gradient(135deg,#8b5cf6,#6d28d9)",
              color: "#fff",
              borderRadius: 8,
              fontWeight: 700,
              textDecoration: "none",
              fontSize: ".9rem",
              boxShadow: "0 2px 8px rgba(139,92,246,.35)",
            }}
          >
            Run your own simulation with InfoGenie →
          </Link>
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  background: "#f3f4f6",
  minHeight: "100vh",
  color: "#111827",
};

function Header({
  name,
  question,
  createdAt,
}: {
  name: string;
  question: string;
  createdAt: string;
}) {
  const dateStr = createdAt
    ? new Date(createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
  return (
    <div
      style={{
        background: "linear-gradient(135deg,#8b5cf6,#6d28d9)",
        color: "#fff",
        padding: "32px 24px 28px",
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <p
          style={{
            fontSize: ".7rem",
            opacity: 0.7,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            marginBottom: 8,
          }}
        >
          InfoGenie · Marketing Simulator
        </p>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 6 }}>{name}</h1>
        {question && name !== question && (
          <p style={{ fontSize: ".9rem", opacity: 0.85, marginBottom: 4 }}>{question}</p>
        )}
        {dateStr && (
          <p style={{ fontSize: ".75rem", opacity: 0.6, marginTop: 6 }}>Generated {dateStr}</p>
        )}
      </div>
    </div>
  );
}
