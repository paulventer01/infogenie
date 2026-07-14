"use client";

// Native React port of the legacy `inbox-monitor` panel (was
// `window.buildInboxMonitor` in public/js/ig_customer_engagement.js +
// `#view-inbox-monitor`). Analyses a campaign's inbox placement and surfaces
// deliverability recommendations via the existing Express API
// (`POST /api/deliverability/campaign-monitor`) through lib/api.

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface MonitorResponse {
  ok: boolean;
  error?: string;
  placement?: Record<string, number>;
  score?: number;
  deliverability_score?: number;
  issues?: string[];
  recommendations?: string[];
}

export default function InboxMonitor() {
  const toast = useToast();
  const [campId, setCampId] = useState("");
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [volume, setVolume] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MonitorResponse | null>(null);

  async function run() {
    if (!from.trim()) {
      toast("Enter a from address.");
      return;
    }
    setRunning(true);
    const d = await apiPost<MonitorResponse>(
      "/api/deliverability/campaign-monitor",
      {
        campaign_id: campId.trim(),
        from_address: from.trim(),
        subject: subject.trim(),
        volume: parseInt(volume) || 0,
      },
    );
    setRunning(false);
    setResult(d);
  }

  const placement = result?.placement || {};
  const score = result?.score ?? result?.deliverability_score ?? "—";
  const scoreColor =
    typeof score === "number"
      ? score >= 80
        ? "#10b981"
        : score >= 60
          ? "#f59e0b"
          : "#ef4444"
      : "#10b981";

  return (
    <div>
      <div className="view-header">
        <h2>📬 Inbox Placement Monitor</h2>
        <p className="view-sub">
          Analyse a campaign&apos;s inbox placement across major providers
          (Gmail, Outlook, Yahoo) and get AI-powered deliverability
          recommendations.
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          maxWidth: 1100,
        }}
      >
        <div className="ig-card">
          <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>
            Analyse Campaign
          </h3>
          <div className="form-group">
            <label>Campaign ID</label>
            <input
              className="form-control"
              placeholder="e.g. 42"
              value={campId}
              onChange={(e) => setCampId(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>From Address</label>
            <input
              className="form-control"
              placeholder="hello@yourdomain.com"
              type="email"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Subject Line</label>
            <input
              className="form-control"
              placeholder="Your email subject…"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Sample Send Volume</label>
            <input
              className="form-control"
              placeholder="e.g. 5000"
              type="number"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={running}
            onClick={run}
          >
            {running ? "⏳ Analysing…" : "🔍 Analyse Placement"}
          </button>
        </div>
        <div className="ig-card">
          <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Results</h3>
          <div>
            {result === null ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "#94a3b8",
                  fontSize: "0.9rem",
                }}
              >
                Fill in campaign details and click Analyse.
              </div>
            ) : !result.ok ? (
              <div style={{ color: "#b91c1c", fontSize: "0.85rem" }}>
                ⚠️ {result.error || "Error"}
              </div>
            ) : (
              <>
                <div style={{ textAlign: "center", marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: "2.5rem",
                      fontWeight: 900,
                      color: scoreColor,
                    }}
                  >
                    {score}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#6b7280" }}>
                    Deliverability Score
                  </div>
                </div>
                {Object.entries(placement).length ? (
                  <div style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.85rem",
                        marginBottom: 8,
                      }}
                    >
                      Placement by Provider
                    </div>
                    {Object.entries(placement).map(([prov, pct]) => (
                      <div
                        key={prov}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 6,
                          fontSize: "0.82rem",
                        }}
                      >
                        <span style={{ width: 80 }}>{prov}</span>
                        <div
                          style={{
                            flex: 1,
                            background: "#f1f5f9",
                            borderRadius: 4,
                            height: 8,
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.round(pct))}%`,
                              height: "100%",
                              background:
                                pct > 70
                                  ? "#10b981"
                                  : pct > 40
                                    ? "#f59e0b"
                                    : "#ef4444",
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span style={{ fontWeight: 600 }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {result.issues?.length ? (
                  <div style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.85rem",
                        marginBottom: 6,
                      }}
                    >
                      ⚠️ Issues Detected
                    </div>
                    {result.issues.map((issue, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: "0.82rem",
                          color: "#dc2626",
                          marginBottom: 3,
                        }}
                      >
                        • {issue}
                      </div>
                    ))}
                  </div>
                ) : null}
                {result.recommendations?.length ? (
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.85rem",
                        marginBottom: 6,
                      }}
                    >
                      ✅ Recommendations
                    </div>
                    {result.recommendations.map((r, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: "0.82rem",
                          color: "#15803d",
                          marginBottom: 3,
                        }}
                      >
                        • {r}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
