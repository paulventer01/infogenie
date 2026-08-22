"use client";

// Native React port of the legacy `bulk-reports` panel (was
// `window.buildBulkReports` in public/js/ig_seo.js + `#view-bulk-reports`).
// Uploads a CSV of URLs (multipart), lists recent batch runs, and offers
// zip/CSV downloads + delete — against the existing Express API
// (`POST /api/bulk-reports/run`, `GET /api/bulk-reports`,
// `DELETE /api/bulk-reports/:id`). Auto-refreshes while a run is in flight.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiDelete } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { showToast } from "@/hooks/useToast";

interface Run {
  id: number;
  name: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  created_at: string;
}

export default function BulkReports() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [headless, setHeadless] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await apiGet<{ runs?: Run[] }>("/api/bulk-reports");
      const list = r.runs || [];
      setRuns(list);
      setListError(null);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (list.some((run) => run.status !== "done" && run.status !== "failed")) {
        timerRef.current = setTimeout(loadList, 5000);
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadList();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [loadList]);

  async function start() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      showToast("⚠️ Choose a CSV file first");
      return;
    }
    const fd = new FormData();
    fd.append("file", f);
    fd.append("name", name || "");
    fd.append("headless", headless ? "1" : "0");
    showToast("⏳ Uploading and queuing audits…");
    try {
      const r = await fetch("/api/bulk-reports/run", { method: "POST", body: fd }).then((x) =>
        x.json(),
      );
      if (!r.ok) {
        showToast("❌ " + (r.error || "failed"));
        return;
      }
      showToast("✅ Run #" + r.runId + " started — " + r.total + " URLs queued");
      loadList();
    } catch (e) {
      showToast("❌ " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete run #" + id + "?")) return;
    await apiDelete("/api/bulk-reports/" + id);
    loadList();
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Bulk Reporting
              </div>
              <h2 className="view-title">📦 Bulk Reporting</h2>
              <p className="view-sub">
                Upload a CSV of website URLs (one per row, no header needed) and
                InfoGenie will batch-run a full SEO audit on every URL. Download a zip of
                branded PDFs (uses your White-Label profile if enabled) plus a flat CSV
                of every check, ready for prospecting or client deliverables. Up to 500
                URLs per run, 4 audits in parallel, resumes automatically if the server
                restarts.
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
          <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>
            📥 Upload CSV of URLs
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                Run name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cape Town agency prospects"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.88rem",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                CSV file (one URL per row, max 500)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{
                  width: "100%",
                  padding: 7,
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                }}
              />
            </div>
          </div>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.82rem",
              color: "#374151",
              marginBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
            />{" "}
            Render every page in a real browser (slower, but works for JS-heavy SPAs)
          </label>
          <br />
          <button
            onClick={start}
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
            📦 Start Batch
          </button>
          <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 10 }}>
            PDFs use your{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goToView(router, "white-label");
              }}
              style={{ color: "#0f766e", fontWeight: 700 }}
            >
              White-Label
            </a>{" "}
            brand profile if it&apos;s enabled.
          </div>
        </div>

        <div id="brList">
          {listError ? (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {listError}
            </div>
          ) : !runs ? (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                color: "#6B7280",
              }}
            >
              ⏳ Loading runs…
            </div>
          ) : !runs.length ? (
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
              No bulk runs yet. Upload a CSV above to get started.
            </div>
          ) : (
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
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>📦 Recent Bulk Runs ({runs.length})</span>
                <button
                  onClick={loadList}
                  style={{
                    padding: "6px 12px",
                    background: "#F3F4F6",
                    border: "1px solid #D1D5DB",
                    borderRadius: 6,
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  ↻ Refresh
                </button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    {["RUN", "STATUS"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "9px 14px",
                          textAlign: "left",
                          color: "#6B7280",
                          fontSize: "0.7rem",
                          fontWeight: 800,
                          letterSpacing: ".06em",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                    <th
                      style={{
                        padding: "9px 14px",
                        textAlign: "right",
                        color: "#6B7280",
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        letterSpacing: ".06em",
                      }}
                    >
                      PROGRESS
                    </th>
                    <th
                      style={{
                        padding: "9px 14px",
                        textAlign: "left",
                        color: "#6B7280",
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        letterSpacing: ".06em",
                      }}
                    >
                      DOWNLOADS
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const pct =
                      run.total > 0
                        ? Math.round(((run.completed || 0) + (run.failed || 0)) / run.total * 100)
                        : 0;
                    const tone =
                      run.status === "done"
                        ? "#059669"
                        : run.status === "failed"
                          ? "#DC2626"
                          : "#0066FF";
                    return (
                      <tr key={run.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "11px 14px" }}>
                          <div style={{ fontWeight: 700, color: "#0A1628" }}>{run.name}</div>
                          <div style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>
                            #{run.id} · {new Date(run.created_at).toLocaleString()}
                          </div>
                        </td>
                        <td style={{ padding: "11px 14px" }}>
                          <span
                            style={{
                              background: tone + "22",
                              color: tone,
                              padding: "3px 9px",
                              borderRadius: 6,
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td style={{ padding: "11px 14px", textAlign: "right" }}>
                          <div style={{ fontWeight: 700, color: "#0A1628" }}>
                            {run.completed}/{run.total}
                            {run.failed ? (
                              <span style={{ color: "#DC2626", fontSize: "0.78rem" }}>
                                {" "}
                                ({run.failed} failed)
                              </span>
                            ) : null}
                          </div>
                          <div
                            style={{
                              background: "#E5E7EB",
                              height: 5,
                              borderRadius: 3,
                              marginTop: 5,
                              overflow: "hidden",
                            }}
                          >
                            <div style={{ width: `${pct}%`, height: "100%", background: tone }} />
                          </div>
                        </td>
                        <td style={{ padding: "11px 14px" }}>
                          <a
                            href={`/api/bulk-reports/${run.id}/zip`}
                            style={{
                              color: "#0f766e",
                              fontWeight: 700,
                              fontSize: "0.8rem",
                              textDecoration: "none",
                              marginRight: 10,
                            }}
                          >
                            📦 Zip of PDFs
                          </a>
                          <a
                            href={`/api/bulk-reports/${run.id}/csv`}
                            style={{
                              color: "#0066FF",
                              fontWeight: 700,
                              fontSize: "0.8rem",
                              textDecoration: "none",
                            }}
                          >
                            📊 CSV
                          </a>
                        </td>
                        <td style={{ padding: "11px 14px", textAlign: "right" }}>
                          <button
                            onClick={() => remove(run.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#9CA3AF",
                              cursor: "pointer",
                              fontSize: "1rem",
                            }}
                            title="Delete"
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
          )}
        </div>
      </div>
    </div>
  );
}
