"use client";

// Native React port of the legacy `backlink-monitor` panel (was
// `window.buildBacklinkMonitor` + `_bmAdd` / `_bmDel` / `_bmRunOne` /
// `_bmRunAll` / `_bmRefresh` in public/js/ig_seo.js + `#view-backlink-monitor`
// in index.html). Tracks new and lost backlinks on any domain via the existing
// Express API through `lib/api`:
//   GET    /api/backlink-monitor/domains
//   GET    /api/backlink-monitor/changes?limit=200
//   POST   /api/backlink-monitor/domains      { domain, alert_email, alert_slack_webhook, frequency }
//   DELETE /api/backlink-monitor/domains/:id
//   POST   /api/backlink-monitor/run-now      { monitor_id } | {}
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Monitor {
  id: number;
  domain: string;
  alert_email?: string;
  alert_slack_webhook?: string;
  frequency?: string;
  last_total_referring?: number;
  last_run_at?: string | null;
}
interface LinkChange {
  change_type: string;
  domain: string;
  referring_domain: string;
  rank?: number;
  country?: string;
  detected_at: string;
}
interface DomainsResult {
  ok?: boolean;
  error?: string;
  monitors?: Monitor[];
}
interface ChangesResult {
  ok?: boolean;
  changes?: LinkChange[];
}
interface AddResult {
  ok: boolean;
  error?: string;
  monitor?: Monitor;
}
interface RunResult {
  ok?: boolean;
  results?: { ok?: boolean; error?: string; newCount?: number; lostCount?: number }[];
}

export default function BacklinkMonitor() {
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [slack, setSlack] = useState("");
  const [freq, setFreq] = useState("daily");

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [changes, setChanges] = useState<LinkChange[]>([]);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("");

  async function refresh() {
    setLoadError("");
    const [m, c] = await Promise.all([
      apiGet<DomainsResult>("/api/backlink-monitor/domains"),
      apiGet<ChangesResult>("/api/backlink-monitor/changes?limit=200"),
    ]);
    if (m.ok === false) {
      setLoadError(m.error || "Failed to load monitors");
      return;
    }
    setMonitors(m.monitors || []);
    setChanges(c.changes || []);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    if (!domain.trim()) {
      setStatus("⚠️ Domain required");
      return;
    }
    const r = await apiPost<AddResult>("/api/backlink-monitor/domains", {
      domain,
      alert_email: email,
      alert_slack_webhook: slack,
      frequency: freq,
    });
    if (!r.ok) {
      setStatus("❌ " + (r.error || "failed"));
      return;
    }
    setStatus("✅ Monitoring " + (r.monitor?.domain || domain));
    setDomain("");
    refresh();
  }

  async function del(id: number) {
    if (!window.confirm("Stop monitoring this domain?")) return;
    await apiDelete("/api/backlink-monitor/domains/" + id);
    refresh();
  }

  async function runOne(id: number) {
    setStatus("⏳ Pulling fresh snapshot…");
    const r = await apiPost<RunResult>("/api/backlink-monitor/run-now", {
      monitor_id: id,
    });
    const res = (r.results || [])[0] || {};
    setStatus(
      res.ok
        ? `✅ Refreshed: ${res.newCount || 0} new, ${res.lostCount || 0} lost`
        : "❌ " + (res.error || "failed"),
    );
    refresh();
  }

  async function runAll() {
    setStatus("⏳ Running all monitors…");
    const r = await apiPost<RunResult>("/api/backlink-monitor/run-now", {});
    setStatus("✅ Processed " + (r.results || []).length + " monitor(s)");
    refresh();
  }

  const inputStyle: React.CSSProperties = {
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    fontSize: "0.88rem",
  };
  const thStyle: React.CSSProperties = {
    padding: "9px 14px",
    textAlign: "left",
    color: "#6B7280",
    fontSize: "0.7rem",
    fontWeight: 800,
    letterSpacing: ".06em",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Backlink Monitor
              </div>
              <h2 className="view-title">🛰️ Backlink Change Monitor</h2>
              <p className="view-sub">
                Track new and lost backlinks on any domain. Daily snapshots from
                DataForSEO are diffed automatically — you get a Slack ping or
                email digest the moment a link disappears (so you can reach out
                and recover it) or a suspicious cluster of new low-quality links
                arrives (so you can disavow before it hurts rankings). Pairs with
                the Backlink Intel research view.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div
            style={{ fontWeight: 800, color: "#0A1628", marginBottom: 12 }}
          >
            ➕ Add a domain to monitor
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 2fr 1fr 1fr",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <input
              placeholder="example.com"
              style={inputStyle}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <input
              placeholder="alerts@yourcompany.com (optional)"
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              placeholder="Slack webhook URL (optional)"
              style={inputStyle}
              value={slack}
              onChange={(e) => setSlack(e.target.value)}
            />
            <select
              style={inputStyle}
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
            >
              <option value="daily">Daily check</option>
              <option value="weekly">Weekly check</option>
            </select>
          </div>
          <button
            onClick={add}
            style={{
              padding: "10px 22px",
              background: "#059669",
              border: "2px solid #059669",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          >
            🛰️ Start Monitoring
          </button>
          <button
            onClick={runAll}
            style={{
              padding: "10px 22px",
              background: "#fff",
              border: "2px solid #7C3AED",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#7C3AED",
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            ⚡ Check All Now
          </button>
          {status && (
            <div
              style={{ marginTop: 10, fontSize: "0.82rem", color: "#475569" }}
            >
              {status}
            </div>
          )}
        </div>

        {loadError ? (
          <div
            style={{
              background: "#FEE2E2",
              color: "#B91C1C",
              padding: 14,
              borderRadius: 10,
            }}
          >
            {loadError}
          </div>
        ) : monitors.length ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid #E5E7EB",
                fontWeight: 800,
                color: "#0A1628",
              }}
            >
              🛰️ Monitored Domains ({monitors.length})
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.85rem",
              }}
            >
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={thStyle}>DOMAIN</th>
                  <th style={thStyle}>ALERTS</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>REF DOMAINS</th>
                  <th style={thStyle}>LAST CHECK</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {monitors.map((mn) => {
                  const alerts = [
                    mn.alert_email && "✉️ " + mn.alert_email,
                    mn.alert_slack_webhook && "💬 Slack",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr key={mn.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td
                        style={{
                          padding: "11px 14px",
                          fontWeight: 700,
                          color: "#0A1628",
                        }}
                      >
                        {mn.domain}
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          color: "#374151",
                          fontSize: "0.78rem",
                        }}
                      >
                        {alerts || (
                          <span style={{ color: "#9CA3AF" }}>— none —</span>
                        )}{" "}
                        <span style={{ color: "#9CA3AF" }}>
                          · {mn.frequency}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: "#0A1628",
                        }}
                      >
                        {(mn.last_total_referring || 0).toLocaleString()}
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          color: "#6B7280",
                          fontSize: "0.78rem",
                        }}
                      >
                        {mn.last_run_at ? (
                          new Date(mn.last_run_at).toLocaleString()
                        ) : (
                          <span style={{ color: "#F59E0B" }}>never</span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <button
                          onClick={() => runOne(mn.id)}
                          style={{
                            background: "none",
                            border: "1px solid #7C3AED",
                            color: "#7C3AED",
                            borderRadius: 6,
                            padding: "4px 10px",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          ↻ Check
                        </button>
                        <button
                          onClick={() => del(mn.id)}
                          title="Stop"
                          style={{
                            background: "none",
                            border: "none",
                            color: "#9CA3AF",
                            cursor: "pointer",
                            fontSize: "1rem",
                          }}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 24,
              textAlign: "center",
              color: "#9CA3AF",
            }}
          >
            No domains monitored yet. Add one above to start tracking link
            changes.
          </div>
        )}

        {changes.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid #E5E7EB",
                  fontWeight: 800,
                  color: "#0A1628",
                }}
              >
                📜 Recent Link Changes ({changes.length})
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    <th style={thStyle}>WHEN</th>
                    <th style={thStyle}>DOMAIN</th>
                    <th style={thStyle}>CHANGE</th>
                    <th style={thStyle}>REFERRING</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>RANK</th>
                    <th style={thStyle}>COUNTRY</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((ch, i) => {
                    const isNew = ch.change_type === "new";
                    const tone = isNew ? "#059669" : "#DC2626";
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td
                          style={{
                            padding: "9px 14px",
                            color: "#6B7280",
                            fontSize: "0.78rem",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {new Date(ch.detected_at).toLocaleString()}
                        </td>
                        <td
                          style={{
                            padding: "9px 14px",
                            fontWeight: 700,
                            color: "#0A1628",
                          }}
                        >
                          {ch.domain}
                        </td>
                        <td style={{ padding: "9px 14px" }}>
                          <span
                            style={{
                              background: tone + "22",
                              color: tone,
                              padding: "3px 9px",
                              borderRadius: 6,
                              fontSize: "0.72rem",
                              fontWeight: 700,
                            }}
                          >
                            {isNew ? "✨ NEW" : "💔 LOST"}
                          </span>
                        </td>
                        <td style={{ padding: "9px 14px", color: "#374151" }}>
                          {ch.referring_domain}
                        </td>
                        <td
                          style={{
                            padding: "9px 14px",
                            textAlign: "right",
                            color: "#374151",
                          }}
                        >
                          {ch.rank || 0}
                        </td>
                        <td style={{ padding: "9px 14px", color: "#6B7280" }}>
                          {ch.country || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
