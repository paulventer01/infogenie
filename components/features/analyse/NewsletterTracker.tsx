"use client";

// Native React port of the legacy `newsletter-tracker` panel (was
// `window.buildNewsletterTracker` + `#view-newsletter-tracker` in index.html).
// Tracks competitor newsletter archives and uses AI to extract subject lines +
// cadence, via the existing Express API:
//   GET    /api/newsletter-tracker/targets
//   POST   /api/newsletter-tracker/targets
//   POST   /api/newsletter-tracker/scan/:id
//   GET    /api/newsletter-tracker/history/:id
//   DELETE /api/newsletter-tracker/targets/:id
// through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Target {
  id: number;
  brand: string;
  newsletter_name: string;
  archive_url: string;
  last_scanned_at?: string | null;
}
interface Issue {
  subject?: string;
  sent_date?: string;
  preview?: string;
  url?: string;
}
interface TargetsResult {
  ok: boolean;
  error?: string;
  targets?: Target[];
}
interface ScanResult {
  ok: boolean;
  error?: string;
  issues?: Issue[];
}

function safeUrl(u?: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

type RowState = { status: "idle" | "loading"; error?: string; issues?: Issue[] };

export default function NewsletterTracker() {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [listError, setListError] = useState("");
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const [rows, setRows] = useState<Record<number, RowState>>({});

  async function load() {
    setListError("");
    const r = await apiGet<TargetsResult>("/api/newsletter-tracker/targets");
    if (!r.ok) {
      setListError(r.error || "failed");
      setTargets([]);
      return;
    }
    setTargets(r.targets || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!brand.trim() || !name.trim() || !url.trim()) {
      setAddMsg("⚠ All fields required");
      return;
    }
    setAddMsg("");
    const r = await apiPost<TargetsResult>("/api/newsletter-tracker/targets", {
      brand: brand.trim(),
      newsletter_name: name.trim(),
      archive_url: url.trim(),
    });
    if (!r.ok) {
      setAddMsg("❌ " + (r.error || "failed"));
      return;
    }
    setName("");
    setUrl("");
    setAddMsg("✅ Newsletter tracked");
    await load();
  }

  async function scan(id: number) {
    setRows((p) => ({ ...p, [id]: { status: "loading" } }));
    const r = await apiPost<ScanResult>(
      `/api/newsletter-tracker/scan/${id}`,
      {},
    );
    if (!r.ok) {
      setRows((p) => ({ ...p, [id]: { status: "idle", error: r.error } }));
      return;
    }
    setRows((p) => ({ ...p, [id]: { status: "idle", issues: r.issues || [] } }));
    await load();
  }

  async function history(id: number) {
    setRows((p) => ({ ...p, [id]: { status: "loading" } }));
    const r = await apiGet<ScanResult>(`/api/newsletter-tracker/history/${id}`);
    if (!r.ok) {
      setRows((p) => ({ ...p, [id]: { status: "idle", error: r.error } }));
      return;
    }
    setRows((p) => ({ ...p, [id]: { status: "idle", issues: r.issues || [] } }));
  }

  async function remove(id: number) {
    if (
      !window.confirm("Stop tracking this newsletter? (history retained)")
    )
      return;
    await apiDelete(`/api/newsletter-tracker/targets/${id}`);
    await load();
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 3,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 7,
    border: "1px solid #D1D5DB",
    borderRadius: 5,
    fontSize: "0.82rem",
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Newsletter Tracker
              </div>
              <h2 className="view-title">📧 Newsletter Tracker</h2>
              <p className="view-sub">
                Monitor competitor newsletter archives. Add a
                Substack/Beehiiv/Mailchimp archive URL → AI extracts subject
                lines + cadence.
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
            ➕ Track a Newsletter Archive
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1.6fr auto",
              gap: 8,
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>BRAND</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Stripe"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>NEWSLETTER NAME</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stripe Weekly"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>
                ARCHIVE URL (Substack/Beehiiv/Mailchimp/etc)
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.substack.com/archive"
                style={inputStyle}
              />
            </div>
            <button
              onClick={add}
              style={{
                background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                color: "#fff",
                border: "none",
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ➕ Track
            </button>
          </div>
          {addMsg && (
            <div
              style={{ marginTop: 8, fontSize: "0.78rem", color: "#6B7280" }}
            >
              {addMsg}
            </div>
          )}
        </div>

        <div>
          {targets === null && <div style={{ color: "#9CA3AF" }}>Loading…</div>}
          {listError && (
            <div style={{ color: "#991B1B" }}>⚠ {listError}</div>
          )}
          {targets !== null && !listError && targets.length === 0 && (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px dashed #D1D5DB",
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
                color: "#6B7280",
              }}
            >
              No newsletters tracked yet. Add an archive URL above.
            </div>
          )}
          {(targets || []).map((t) => {
            const row = rows[t.id];
            const archiveUrl = safeUrl(t.archive_url);
            return (
              <div
                key={t.id}
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#0A1628",
                        fontSize: "1rem",
                      }}
                    >
                      📧 {t.newsletter_name}
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "#6B7280",
                        marginTop: 2,
                      }}
                    >
                      {t.brand} ·{" "}
                      {archiveUrl ? (
                        <a
                          href={archiveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#0066FF" }}
                        >
                          {t.archive_url}
                        </a>
                      ) : (
                        t.archive_url
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "#9CA3AF",
                        marginTop: 2,
                      }}
                    >
                      {t.last_scanned_at
                        ? "Last scanned " +
                          new Date(t.last_scanned_at).toLocaleString()
                        : "Never scanned"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => scan(t.id)}
                      style={{
                        background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                        color: "#fff",
                        border: "none",
                        padding: "7px 14px",
                        borderRadius: 6,
                        fontSize: "0.74rem",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      🔍 Scan
                    </button>
                    <button
                      onClick={() => history(t.id)}
                      style={{
                        background: "#F3F4F6",
                        border: "1px solid #E5E7EB",
                        color: "#374151",
                        padding: "7px 12px",
                        borderRadius: 6,
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      📜 History
                    </button>
                    <button
                      onClick={() => remove(t.id)}
                      style={{
                        background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        color: "#991B1B",
                        padding: "7px 12px",
                        borderRadius: 6,
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontSize: "0.82rem",
                    color: "#9CA3AF",
                  }}
                >
                  {row?.status === "loading" &&
                    "⏳ Scraping + extracting issues (10-30s)…"}
                  {row?.error && (
                    <div style={{ color: "#991B1B" }}>❌ {row.error}</div>
                  )}
                  {row?.issues && row.issues.length === 0 && (
                    <div style={{ color: "#9CA3AF" }}>
                      No issues extracted. Try a different archive URL.
                    </div>
                  )}
                  {row?.issues && row.issues.length > 0 && (
                    <div style={{ display: "grid", gap: 6 }}>
                      {row.issues.map((it, i) => {
                        const iurl = safeUrl(it.url);
                        return (
                          <div
                            key={i}
                            style={{
                              background: "#F9FAFB",
                              border: "1px solid #E5E7EB",
                              borderRadius: 6,
                              padding: "9px 12px",
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 700,
                                color: "#0A1628",
                                fontSize: "0.86rem",
                              }}
                            >
                              {iurl ? (
                                <a
                                  href={iurl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: "#0A1628",
                                    textDecoration: "none",
                                  }}
                                >
                                  {it.subject || ""}
                                </a>
                              ) : (
                                it.subject || ""
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: "0.72rem",
                                color: "#6B7280",
                                marginTop: 2,
                              }}
                            >
                              {it.sent_date || ""}
                              {it.preview ? ` · ${it.preview}` : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
