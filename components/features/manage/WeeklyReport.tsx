"use client";

// Native React port of the legacy `weekly-report` panel (was
// `window.buildWeeklyReport` in public/js/ig_intel_pack_a.js +
// `#view-weekly-report`). Generates / previews / emails the weekly auto-PDF
// report and manages auto-send subscriptions against the existing Express API
// (`/api/weekly-report/preview|send|subs|runs`, `/api/weekly-report/pdf`) via
// lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface ReportSection {
  title: string;
  kind?: string;
  rows?: unknown[];
  body?: string;
}
interface Report {
  title: string;
  sections: ReportSection[];
}
interface PreviewResult {
  ok: boolean;
  error?: string;
  report?: Report;
}
interface SendResult {
  ok: boolean;
  error?: string;
  sent_to?: string;
  sections?: number;
}
interface Sub {
  id: number;
  brand: string;
  email: string;
  last_sent_at?: string | null;
}
interface SubsResult {
  ok: boolean;
  error?: string;
  subs?: Sub[];
}
interface Run {
  brand: string;
  sections_count: number;
  sent_to?: string | null;
  generated_at: string;
}
interface RunsResult {
  ok: boolean;
  error?: string;
  runs?: Run[];
}

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "report"; report: Report }
  | { kind: "sending" }
  | { kind: "sent"; sent_to: string; sections: number; brand: string };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 7,
  border: "1px solid #D1D5DB",
  borderRadius: 5,
  fontSize: "0.82rem",
  boxSizing: "border-box",
};

export default function WeeklyReport() {
  const toast = useToast();
  const [brand, setBrand] = useState("");
  const [email, setEmail] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });

  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);

  async function loadSubs() {
    const r = await apiGet<SubsResult>("/api/weekly-report/subs");
    if (!r.ok) {
      setSubsError(r.error || "unknown");
      setSubs(null);
      return;
    }
    setSubsError(null);
    setSubs(r.subs || []);
  }

  async function loadRuns() {
    const r = await apiGet<RunsResult>("/api/weekly-report/runs");
    if (!r.ok) {
      setRunsError(r.error || "unknown");
      setRuns(null);
      return;
    }
    setRunsError(null);
    setRuns(r.runs || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, r] = await Promise.all([
        apiGet<SubsResult>("/api/weekly-report/subs"),
        apiGet<RunsResult>("/api/weekly-report/runs"),
      ]);
      if (cancelled) return;
      if (s.ok) setSubs(s.subs || []);
      else setSubsError(s.error || "unknown");
      if (r.ok) setRuns(r.runs || []);
      else setRunsError(r.error || "unknown");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function doPreview() {
    const b = brand.trim();
    if (!b) {
      toast("⚠ Brand required");
      return;
    }
    setPreview({ kind: "loading" });
    const r = await apiPost<PreviewResult>("/api/weekly-report/preview", { brand: b });
    if (!r.ok || !r.report) {
      setPreview({ kind: "error", text: r.error || "unknown" });
      return;
    }
    setPreview({ kind: "report", report: r.report });
  }

  function onPdfClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!brand.trim()) {
      e.preventDefault();
      toast("⚠ Brand required");
    }
  }

  async function doSend() {
    const b = brand.trim();
    const em = email.trim();
    if (!b || !em) {
      toast("⚠ Brand + email required");
      return;
    }
    setPreview({ kind: "sending" });
    const r = await apiPost<SendResult>("/api/weekly-report/send", { brand: b, email: em });
    if (!r.ok) {
      setPreview({ kind: "error", text: r.error || "unknown" });
      return;
    }
    setPreview({
      kind: "sent",
      sent_to: r.sent_to || "",
      sections: r.sections || 0,
      brand: b,
    });
    await loadRuns();
  }

  async function addSub() {
    const b = brand.trim();
    const em = email.trim();
    if (!b || !em) {
      toast("⚠ Fill brand + email above first");
      return;
    }
    const r = await apiPost<SubsResult>("/api/weekly-report/subs", { brand: b, email: em });
    if (!r.ok) {
      toast("❌ " + (r.error || "unknown"));
      return;
    }
    toast("✅ Subscription saved");
    await loadSubs();
  }

  async function delSub(id: number) {
    if (!confirm("Cancel this subscription?")) return;
    await apiDelete(`/api/weekly-report/subs/${id}`);
    await loadSubs();
  }

  const pdfHref = brand.trim()
    ? `/api/weekly-report/pdf?brand=${encodeURIComponent(brand.trim())}`
    : "#";

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
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
          📑 Generate / Send Now
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto auto auto",
            gap: 8,
            alignItems: "end",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 3,
              }}
            >
              BRAND
            </label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. Nike"
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 3,
              }}
            >
              EMAIL TO (for send)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>
          <button
            onClick={doPreview}
            style={{
              background: "#F3F4F6",
              border: "1px solid #E5E7EB",
              color: "#374151",
              padding: "8px 14px",
              borderRadius: 6,
              fontSize: "0.76rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            👁 Preview
          </button>
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener"
            onClick={onPdfClick}
            style={{
              background: "#1E1B4B",
              color: "#fff",
              padding: "8px 14px",
              borderRadius: 6,
              fontSize: "0.76rem",
              fontWeight: 800,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            📥 Download PDF
          </a>
          <button
            onClick={doSend}
            style={{
              background: "linear-gradient(135deg,#059669,#10B981)",
              color: "#fff",
              border: "none",
              padding: "8px 14px",
              borderRadius: 6,
              fontSize: "0.76rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            📨 Send now
          </button>
        </div>
        <div style={{ marginTop: 14 }}>
          {preview.kind === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Building report from your last 7 days of data…
            </div>
          )}
          {preview.kind === "sending" && (
            <div style={{ color: "#9CA3AF" }}>⏳ Sending via Resend…</div>
          )}
          {preview.kind === "error" && (
            <div style={{ color: "#991B1B" }}>❌ {preview.text}</div>
          )}
          {preview.kind === "report" && (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                padding: 14,
                fontSize: "0.84rem",
              }}
            >
              <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 8 }}>
                {preview.report.title} · {preview.report.sections.length} section(s)
              </div>
              {preview.report.sections.map((s, i) => (
                <div
                  key={i}
                  style={{
                    margin: "6px 0",
                    padding: 8,
                    background: "#fff",
                    borderRadius: 6,
                    borderLeft: "3px solid #1E1B4B",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#0A1628" }}>{s.title}</div>
                  {s.kind === "table" ? (
                    <div style={{ fontSize: "0.74rem", color: "#6B7280", marginTop: 3 }}>
                      {(s.rows || []).length} row(s)
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.78rem", color: "#374151", marginTop: 3 }}>
                      {s.body || ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {preview.kind === "sent" && (
            <div
              style={{
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                padding: 12,
                borderRadius: 8,
              }}
            >
              ✅ Sent to {preview.sent_to} · {preview.sections} section(s). Download PDF:{" "}
              <a
                href={`/api/weekly-report/pdf?brand=${encodeURIComponent(preview.brand)}`}
                target="_blank"
                rel="noopener"
                style={{ color: "#065F46", fontWeight: 700 }}
              >
                here
              </a>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 18,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <h3
            style={{
              margin: 0,
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
            }}
          >
            📬 Auto-send subscriptions (every 7 days)
          </h3>
          <button
            onClick={addSub}
            style={{
              background: "#1E1B4B",
              color: "#fff",
              border: "none",
              padding: "7px 14px",
              borderRadius: 6,
              fontSize: "0.74rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ＋ Add
          </button>
        </div>
        <div style={{ fontSize: "0.84rem", color: "#9CA3AF" }}>
          {subsError ? (
            <div style={{ color: "#991B1B" }}>⚠ {subsError}</div>
          ) : subs === null ? (
            "Loading…"
          ) : subs.length === 0 ? (
            <div style={{ color: "#9CA3AF", fontStyle: "italic" }}>
              No subscriptions yet. Add one above to get a weekly auto-emailed PDF.
            </div>
          ) : (
            subs.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "#F9FAFB",
                  border: "1px solid #E5E7EB",
                  borderRadius: 6,
                  marginBottom: 5,
                }}
              >
                <div>
                  <strong style={{ color: "#0A1628" }}>{s.brand}</strong> →{" "}
                  <span style={{ color: "#6B7280" }}>{s.email}</span>
                </div>
                <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>
                  {s.last_sent_at
                    ? "Last sent " + new Date(s.last_sent_at).toLocaleDateString()
                    : "Never sent"}{" "}
                  <button
                    onClick={() => delSub(s.id)}
                    style={{
                      marginLeft: 10,
                      background: "#FEF2F2",
                      border: "1px solid #FECACA",
                      color: "#991B1B",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 18,
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
          📜 Recent runs
        </h3>
        <div style={{ fontSize: "0.84rem", color: "#9CA3AF" }}>
          {runsError ? (
            <div style={{ color: "#991B1B" }}>⚠ {runsError}</div>
          ) : runs === null ? (
            "Loading…"
          ) : runs.length === 0 ? (
            <div style={{ color: "#9CA3AF", fontStyle: "italic" }}>No runs yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 5 }}>
              {runs.slice(0, 15).map((run, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    background: "#F9FAFB",
                    borderRadius: 5,
                    fontSize: "0.8rem",
                  }}
                >
                  <div>
                    <strong>{run.brand}</strong> · {run.sections_count} sections
                  </div>
                  <div style={{ color: "#6B7280" }}>
                    {run.sent_to ? "📧 " + run.sent_to : "📥 download only"} ·{" "}
                    {new Date(run.generated_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
