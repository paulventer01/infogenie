"use client";

// Native React port of the legacy `dataset-market` panel (was
// `window.buildDatasetMarket` + `#view-dataset-market` in index.html).
// Generates AI-powered structured intelligence datasets via the existing
// Express API (`GET /api/dataset-market/packs`,
// `POST /api/dataset-market/generate`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Pack {
  id: string;
  icon?: string;
  label?: string;
  description?: string;
  fields?: string[];
}
interface PacksResult {
  ok: boolean;
  error?: string;
  packs?: Pack[];
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  title?: string;
  subtitle?: string;
  key_takeaways?: string[];
  columns?: string[];
  rows?: Record<string, unknown>[];
  disclaimer?: string;
}
interface GenState {
  status: "idle" | "loading" | "done" | "error";
  error?: string;
  result?: GenerateResult;
}

function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  if (!rows || !rows.length)
    return <p style={{ color: "#6B7280", fontSize: 14 }}>No data found.</p>;
  return (
    <div
      style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #E5E7EB" }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                style={{
                  padding: "10px 12px",
                  background: "#F9FAFB",
                  borderBottom: "1px solid #E5E7EB",
                  textAlign: "left",
                  fontSize: 12,
                  textTransform: "uppercase",
                  color: "#6B7280",
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td
                  key={c}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid #F3F4F6",
                    fontSize: 13,
                    color: "#111827",
                    maxWidth: 280,
                    wordBreak: "break-word",
                  }}
                >
                  {String(r[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DatasetMarket() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [gens, setGens] = useState<Record<string, GenState>>({});

  useEffect(() => {
    let alive = true;
    apiGet<PacksResult>("/api/dataset-market/packs").then((d) => {
      if (!alive) return;
      if (!d.ok) {
        setStatus("error");
        return;
      }
      setPacks(d.packs || []);
      setStatus("done");
    });
    return () => {
      alive = false;
    };
  }, []);

  async function generate(packId: string) {
    const ind = industry.trim() || "SaaS";
    const reg = region.trim() || "Global";
    const compStr = competitors.trim();
    const comps = compStr
      ? compStr.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    setGens((prev) => ({ ...prev, [packId]: { status: "loading" } }));
    const d = await apiPost<GenerateResult>("/api/dataset-market/generate", {
      pack_id: packId,
      industry: ind,
      region: reg,
      competitors: comps,
    });
    if (!d.ok) {
      setGens((prev) => ({
        ...prev,
        [packId]: { status: "error", error: d.error || "Generation failed" },
      }));
      return;
    }
    setGens((prev) => ({ ...prev, [packId]: { status: "done", result: d } }));
  }

  const controlStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 7,
    fontSize: 13,
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
                <span className="bc-sep">›</span> Dataset Marketplace
              </div>
              <h2 className="view-title">📦 Dataset Marketplace</h2>
              <p className="view-sub">
                Generate AI-powered structured intelligence datasets for your
                industry — competitor pricing, job market signals, social proof,
                market sizing, tech stack maps, and more.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {status === "loading" && (
          <div style={{ color: "#6B7280", padding: "32px 0" }}>
            Loading dataset packs…
          </div>
        )}
        {status === "error" && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <p style={{ color: "#DC2626" }}>Failed to load packs</p>
          </div>
        )}
        {status === "done" && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
                marginBottom: 24,
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 4,
                  }}
                >
                  Industry
                </label>
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. SaaS, FinTech, eCommerce"
                  style={controlStyle}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 4,
                  }}
                >
                  Region
                </label>
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g. Global, US, Europe"
                  style={controlStyle}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 4,
                  }}
                >
                  Key Competitors (comma-sep)
                </label>
                <input
                  value={competitors}
                  onChange={(e) => setCompetitors(e.target.value)}
                  placeholder="Salesforce, HubSpot, Pipedrive"
                  style={controlStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
                gap: 16,
              }}
            >
              {packs.map((p) => {
                const g = gens[p.id];
                return (
                  <div
                    key={p.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 12,
                      padding: 20,
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 10 }}>
                      {p.icon}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#111827",
                        marginBottom: 6,
                      }}
                    >
                      {p.label}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#6B7280",
                        marginBottom: 12,
                      }}
                    >
                      {p.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        marginBottom: 14,
                      }}
                    >
                      {(p.fields || []).map((f) => (
                        <span
                          key={f}
                          style={{
                            background: "#EDE9FE",
                            color: "#5B21B6",
                            padding: "2px 7px",
                            borderRadius: 10,
                            fontSize: 11,
                          }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => generate(p.id)}
                      disabled={g?.status === "loading"}
                      style={{
                        width: "100%",
                        padding: 9,
                        background: "#6366F1",
                        color: "#fff",
                        border: "none",
                        borderRadius: 7,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Generate Dataset →
                    </button>
                    <div style={{ marginTop: 12 }}>
                      {g?.status === "loading" && (
                        <div style={{ color: "#6B7280", fontSize: 13 }}>
                          Generating dataset with AI — this takes 20-30s…
                        </div>
                      )}
                      {g?.status === "error" && (
                        <div style={{ color: "#DC2626", fontSize: 13 }}>
                          {g.error}
                        </div>
                      )}
                      {g?.status === "done" && g.result && (
                        <>
                          <div style={{ marginBottom: 12 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 14,
                                color: "#111827",
                                marginBottom: 2,
                              }}
                            >
                              {g.result.title || ""}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#6B7280",
                                marginBottom: 10,
                              }}
                            >
                              {g.result.subtitle || ""} ·{" "}
                              {g.result.rows?.length || 0} rows
                            </div>
                            {(g.result.key_takeaways || []).length > 0 && (
                              <ul
                                style={{
                                  margin: "0 0 12px 0",
                                  paddingLeft: 18,
                                }}
                              >
                                {(g.result.key_takeaways || []).map((t, i) => (
                                  <li
                                    key={i}
                                    style={{
                                      fontSize: 13,
                                      color: "#374151",
                                      marginBottom: 4,
                                    }}
                                  >
                                    {t}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <DataTable
                            columns={g.result.columns || []}
                            rows={g.result.rows || []}
                          />
                          <div
                            style={{
                              fontSize: 11,
                              color: "#9CA3AF",
                              marginTop: 8,
                            }}
                          >
                            {g.result.disclaimer || ""}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
