"use client";

// Native React port of the legacy `inbox-monitor` panel (was
// `window.buildInboxMonitor` in public/js/ig_customer_engagement.js +
// `#view-inbox-monitor`). Analyses campaign-level deliverability signals via
// the existing Express API (`POST /api/deliverability/campaign-monitor`)
// through lib/api. The API expects per-send outcomes
// (`sends: [{email, delivered, bounced, opened, complained}]`), so the form
// collects campaign totals and expands them into a sends array client-side.

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface MonitorResponse {
  ok: boolean;
  error?: string;
  campaign_name?: string;
  stats?: {
    total: number;
    delivered: number;
    bounced: number;
    opened: number;
    complained: number;
    deliveryRate: number;
    bounceRate: number;
    openRate: number;
    complaintRate: number;
  };
  inbox_score?: number;
  grade?: string;
  flags?: { severity: string; issue: string }[];
  recommendations?: string[];
}

interface SendRecord {
  email: string;
  delivered: boolean;
  bounced: boolean;
  opened: boolean;
  complained: boolean;
}

// Expand campaign totals into the per-send outcome array the API expects.
// Caps the array at 2000 records, scaling all counts proportionally so the
// rates (and therefore the score) are preserved.
function buildSends(
  total: number,
  delivered: number,
  bounced: number,
  opened: number,
  complained: number,
): SendRecord[] {
  const CAP = 2000;
  let n = total;
  let d = Math.min(delivered, total);
  let b = Math.min(bounced, total - d);
  let o = Math.min(opened, d);
  let c = Math.min(complained, d);
  if (n > CAP) {
    const f = CAP / n;
    n = CAP;
    d = Math.round(d * f);
    b = Math.round(b * f);
    o = Math.round(o * f);
    c = Math.round(c * f);
  }
  const sends: SendRecord[] = [];
  for (let i = 0; i < n; i++) {
    sends.push({
      email: `contact${i + 1}@example.com`,
      delivered: i < d,
      bounced: i >= d && i < d + b,
      opened: i < o,
      complained: i < c,
    });
  }
  return sends;
}

const sevColor: Record<string, string> = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#6b7280",
};

export default function InboxMonitor() {
  const toast = useToast();
  const [campName, setCampName] = useState("");
  const [total, setTotal] = useState("");
  const [delivered, setDelivered] = useState("");
  const [bounced, setBounced] = useState("0");
  const [opened, setOpened] = useState("");
  const [complained, setComplained] = useState("0");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MonitorResponse | null>(null);

  async function run() {
    const t = parseInt(total) || 0;
    if (t <= 0) {
      toast("Enter the total number of emails sent.");
      return;
    }
    const d = parseInt(delivered) || 0;
    if (d <= 0) {
      toast("Enter how many were delivered.");
      return;
    }
    setRunning(true);
    const resp = await apiPost<MonitorResponse>(
      "/api/deliverability/campaign-monitor",
      {
        campaign_name: campName.trim() || "Unnamed Campaign",
        sends: buildSends(t, d, parseInt(bounced) || 0, parseInt(opened) || 0, parseInt(complained) || 0),
      },
    );
    setRunning(false);
    setResult(resp);
  }

  const score = result?.inbox_score ?? "—";
  const scoreColor =
    typeof score === "number"
      ? score >= 80
        ? "#10b981"
        : score >= 60
          ? "#f59e0b"
          : "#ef4444"
      : "#10b981";

  const stats = result?.stats;
  const rateBars: { label: string; pct: number }[] = stats
    ? [
        { label: "Delivery", pct: stats.deliveryRate },
        { label: "Open", pct: stats.openRate },
        { label: "Bounce", pct: stats.bounceRate },
      ]
    : [];

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <h2>📬 Inbox Placement Monitor</h2>
        <p className="view-sub">
          Enter your campaign&apos;s send outcomes to score inbox placement and
          get deliverability recommendations.
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
            <label>Campaign Name</label>
            <input
              className="form-control"
              placeholder="e.g. June Newsletter"
              value={campName}
              onChange={(e) => setCampName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Total Emails Sent</label>
            <input
              className="form-control"
              placeholder="e.g. 5000"
              type="number"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Delivered</label>
            <input
              className="form-control"
              placeholder="e.g. 4900"
              type="number"
              value={delivered}
              onChange={(e) => setDelivered(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Bounced</label>
            <input
              className="form-control"
              placeholder="e.g. 100"
              type="number"
              value={bounced}
              onChange={(e) => setBounced(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Opened</label>
            <input
              className="form-control"
              placeholder="e.g. 1200"
              type="number"
              value={opened}
              onChange={(e) => setOpened(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Spam Complaints</label>
            <input
              className="form-control"
              placeholder="e.g. 2"
              type="number"
              value={complained}
              onChange={(e) => setComplained(e.target.value)}
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
                    {result.grade ? (
                      <span
                        style={{
                          fontSize: "1.2rem",
                          marginLeft: 8,
                          verticalAlign: "middle",
                        }}
                      >
                        ({result.grade})
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#6b7280" }}>
                    Inbox Placement Score
                  </div>
                </div>
                {rateBars.length ? (
                  <div style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.85rem",
                        marginBottom: 8,
                      }}
                    >
                      Campaign Rates
                    </div>
                    {rateBars.map(({ label, pct }) => (
                      <div
                        key={label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 6,
                          fontSize: "0.82rem",
                        }}
                      >
                        <span style={{ width: 80 }}>{label}</span>
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
                                label === "Bounce"
                                  ? pct > 5
                                    ? "#ef4444"
                                    : pct > 2
                                      ? "#f59e0b"
                                      : "#10b981"
                                  : pct > 70
                                    ? "#10b981"
                                    : pct > 40
                                      ? "#f59e0b"
                                      : "#ef4444",
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span style={{ fontWeight: 600 }}>
                          {Math.round(pct * 10) / 10}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {result.flags?.length ? (
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
                    {result.flags.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: "0.82rem",
                          color: sevColor[f.severity] || "#dc2626",
                          marginBottom: 3,
                        }}
                      >
                        • {f.issue}
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
