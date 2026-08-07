"use client";

// Native React port of the legacy `churn-scorer` panel (was
// `window.buildChurnScorer` in public/js/ig_intel_pack_a.js + `#view-churn-scorer`
// in index.html). Bulk-scores pasted contact JSON against the existing Express
// API (`POST /api/churn-scorer/bulk` and `GET /api/churn-scorer/scores`) via
// `lib/api`.

import { useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface ChurnResult {
  ok: boolean;
  email?: string;
  error?: string;
  score?: number;
  risk_level?: string;
  signals?: string[];
  recommendation?: string;
}
interface BulkResponse {
  ok: boolean;
  error?: string;
  results: ChurnResult[];
}
interface SavedScore {
  contact_email: string;
  score: number;
  risk_level: string;
  signals: string[];
  recommendation: string;
}
interface ScoresResponse {
  ok: boolean;
  error?: string;
  scores: SavedScore[];
}

function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}
function nInt(v: unknown): number {
  return Math.round(Number(v) || 0);
}

function renderResults(results: ChurnResult[]): string {
  const riskColor: Record<string, string> = {
    critical: "#DC2626",
    high: "#EF4444",
    medium: "#F59E0B",
    low: "#10B981",
  };
  const sorted = results.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  return `<div style="display:grid;gap:10px">${sorted
    .map((s) => {
      if (!s.ok)
        return `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;color:#991B1B;font-size:0.82rem">${esc(
          s.email || "?",
        )}: ${esc(s.error || "failed")}</div>`;
      const rc =
        riskColor[(s.risk_level || "medium").toLowerCase()] || "#F59E0B";
      return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${rc};border-radius:8px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:6px">
        <div><strong style="color:#0A1628;font-size:0.92rem">${esc(s.email || "")}</strong> <span style="background:${rc};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;text-transform:uppercase;margin-left:6px">${esc(s.risk_level || "medium")}</span></div>
        <div style="font-size:1.6rem;font-weight:800;color:${rc}">${nInt(s.score)}</div>
      </div>
      ${
        (s.signals || []).length
          ? `<div style="font-size:0.78rem;color:#374151;line-height:1.5;margin-top:4px"><strong>Signals:</strong><ul style="margin:4px 0 0;padding-left:20px">${(s.signals || [])
              .map((x) => `<li>${esc(x)}</li>`)
              .join("")}</ul></div>`
          : ""
      }
      ${
        s.recommendation
          ? `<div style="background:#F0FDF4;border-left:3px solid #10B981;padding:6px 10px;border-radius:4px;font-size:0.8rem;margin-top:8px;color:#065F46"><strong>💡 Action:</strong> ${esc(s.recommendation)}</div>`
          : ""
      }
    </div>`;
    })
    .join("")}</div>`;
}

const PLACEHOLDER =
  '[{"email":"jane@acme.com","name":"Jane Doe","logins_per_week":0.5,"days_since_last_login":21,"open_tickets":2,"days_since_last_purchase":120,"nps":4,"feature_adoption_pct":18,"tenure_days":340,"plan":"Pro","mrr":499}]';

export default function ChurnScorer() {
  const [json, setJson] = useState("");
  const [out, setOut] = useState("");

  async function scoreContacts() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setOut(
        '<div style="color:#991B1B">⚠ Invalid JSON: ' +
          esc((e as Error).message) +
          "</div>",
      );
      return;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    setOut(
      '<div style="color:#9CA3AF">⏳ Scoring ' +
        arr.length +
        " contact(s)…</div>",
    );
    const r = await apiPost<BulkResponse>("/api/churn-scorer/bulk", {
      contacts: arr,
    });
    if (!r.ok) {
      setOut(
        `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${esc(r.error)}</div>`,
      );
      return;
    }
    setOut(renderResults(r.results));
  }

  async function loadSaved() {
    setOut('<div style="color:#9CA3AF">⏳ Loading…</div>');
    const r = await apiGet<ScoresResponse>("/api/churn-scorer/scores");
    if (!r.ok || !r.scores.length) {
      setOut(
        '<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">No scored contacts yet.</div>',
      );
      return;
    }
    setOut(
      renderResults(
        r.scores.map((s) => ({
          ok: true,
          email: s.contact_email,
          score: s.score,
          risk_level: s.risk_level,
          signals: s.signals,
          recommendation: s.recommendation,
        })),
      ),
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Churn Scorer
              </div>
              <h2 className="view-title">⚠️ Predictive Churn Scorer</h2>
              <p className="view-sub">
                Score each contact 0-100 on churn risk based on engagement,
                usage, NPS, tenure and more. Bulk-score up to 25 contacts at
                once.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <h3
            style={{
              margin: "0 0 10px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
            }}
          >
            📊 Score Contacts (paste JSON)
          </h3>
          <textarea
            rows={10}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder={PLACEHOLDER}
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.82rem",
              fontFamily: "monospace",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={scoreContacts}
              style={{
                background: "linear-gradient(135deg,#DC2626,#EF4444)",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                borderRadius: 6,
                fontSize: "0.84rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ⚠️ Score Contacts
            </button>
            <button
              onClick={loadSaved}
              style={{
                background: "#F3F4F6",
                border: "1px solid #E5E7EB",
                color: "#374151",
                padding: "10px 16px",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              📜 Load Saved Scores
            </button>
          </div>
        </div>
        <div dangerouslySetInnerHTML={{ __html: out }} />
      </div>
    </div>
  );
}
