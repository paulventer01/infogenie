"use client";

// Native React port of the legacy `smart-send` panel (was
// `window.buildSmartSend` in public/js/ig_customer_engagement.js +
// `#view-smart-send`). Recommends optimal per-contact send times against the
// existing Express API (`POST /api/drips/smart-send-time`) via lib/api.

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Recommendation {
  email: string;
  preferred_send_time: string;
  confidence: string;
  signals_used: number;
}
interface SmartSendResp {
  ok: boolean;
  error?: string;
  population_best_time?: string;
  recommendations?: Recommendation[];
}

function badge(txt: string, color: string) {
  return (
    <span
      style={{
        background: color,
        color: "#fff",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: ".75rem",
        fontWeight: 700,
      }}
    >
      {txt}
    </span>
  );
}

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: 40,
  color: "#94a3b8",
  fontSize: "0.9rem",
};

export default function SmartSend() {
  const toast = useToast();
  const [contactsRaw, setContactsRaw] = useState("");
  const [historyRaw, setHistoryRaw] = useState("");
  const [running, setRunning] = useState(false);
  const [popBest, setPopBest] = useState("");
  const [rows, setRows] = useState<Recommendation[] | null>(null);

  async function run() {
    const contacts = contactsRaw
      .split("\n")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => ({ email: e }));
    if (!contacts.length) {
      toast("Enter at least one email.");
      return;
    }
    let history: unknown[] = [];
    if (historyRaw.trim()) {
      try {
        history = JSON.parse(historyRaw.trim());
      } catch {
        toast("History JSON is invalid.");
        return;
      }
    }
    setRunning(true);
    const d = await apiPost<SmartSendResp>("/api/drips/smart-send-time", { contacts, history });
    setRunning(false);
    if (!d.ok) {
      toast(d.error || "Error");
      return;
    }
    setPopBest(`Population best: ${d.population_best_time}`);
    setRows(d.recommendations || []);
  }

  return (
    <div>
      <div className="view-header">
        <h2>⏰ Smart Send Time Optimizer</h2>
        <p className="view-sub">
          Analyse your contacts&apos; engagement history and recommend the optimal UTC send hour per
          contact — powered by real open/click data.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 1100 }}>
        <div className="ig-card">
          <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Contact Emails</h3>
          <p style={{ fontSize: "0.82rem", color: "#6b7280", margin: "0 0 10px" }}>
            One email per line.
          </p>
          <textarea
            className="form-control"
            rows={6}
            placeholder={"alice@example.com\nbob@example.com\ncarol@example.com"}
            value={contactsRaw}
            onChange={(e) => setContactsRaw(e.target.value)}
          />
          <h3 style={{ margin: "18px 0 10px", fontSize: "1rem" }}>Engagement History (JSON)</h3>
          <p style={{ fontSize: "0.82rem", color: "#6b7280", margin: "0 0 10px" }}>
            Array of <code>{'{"email","opened_at","clicked_at"}'}</code> records. Leave blank to use
            population-level defaults.
          </p>
          <textarea
            className="form-control"
            rows={5}
            placeholder='[{"email":"alice@example.com","opened_at":"2026-06-01T09:15:00Z"},{"email":"alice@example.com","clicked_at":"2026-06-03T08:45:00Z"}]'
            value={historyRaw}
            onChange={(e) => setHistoryRaw(e.target.value)}
          />
          <button
            className="btn btn-primary"
            style={{ marginTop: 14, width: "100%" }}
            disabled={running}
            onClick={run}
          >
            {running ? "⏳ Calculating…" : "⚡ Calculate Best Send Times"}
          </button>
        </div>
        <div className="ig-card">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Recommendations</h3>
            <span style={{ fontSize: "0.82rem", color: "#6b7280" }}>{popBest}</span>
          </div>
          <div>
            {rows === null ? (
              <div style={emptyStyle}>Enter contacts and click Calculate.</div>
            ) : rows.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Email</th>
                    <th style={{ textAlign: "center", padding: "6px 8px" }}>Best Hour (UTC)</th>
                    <th style={{ textAlign: "center", padding: "6px 8px" }}>Confidence</th>
                    <th style={{ textAlign: "center", padding: "6px 8px" }}>Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 8px" }}>{r.email}</td>
                      <td
                        style={{
                          textAlign: "center",
                          fontWeight: 700,
                          color: "#6366f1",
                        }}
                      >
                        {r.preferred_send_time}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {badge(r.confidence, r.confidence === "personalized" ? "#10b981" : "#94a3b8")}
                      </td>
                      <td style={{ textAlign: "center", color: "#6b7280" }}>{r.signals_used}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={emptyStyle}>No results.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
