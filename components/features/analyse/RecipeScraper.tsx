"use client";

// Native React port of the legacy `recipe-scraper` panel (was
// `window.buildRecipeScraper` + `#view-recipe-scraper` in index.html).
// Lists pre-built scraping recipes and runs them against a target URL via the
// existing Express API (`GET /api/recipe-scraper/recipes`,
// `POST /api/recipe-scraper/run`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Recipe {
  id: string;
  icon?: string;
  label?: string;
  description?: string;
  source?: string;
  fields?: string[];
}
interface RecipesResult {
  ok: boolean;
  error?: string;
  recipes?: Recipe[];
}
interface RunResult {
  ok: boolean;
  error?: string;
  summary?: string;
  total_found?: number;
  columns?: string[];
  rows?: Record<string, unknown>[];
}
interface RunState {
  url: string;
  status: "idle" | "loading" | "done" | "error";
  error?: string;
  result?: RunResult;
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

export default function RecipeScraper() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  useEffect(() => {
    let alive = true;
    apiGet<RecipesResult>("/api/recipe-scraper/recipes").then((d) => {
      if (!alive) return;
      if (!d.ok) {
        setStatus("error");
        return;
      }
      setRecipes(d.recipes || []);
      setStatus("done");
    });
    return () => {
      alive = false;
    };
  }, []);

  function setUrl(id: string, url: string) {
    setRuns((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || { status: "idle" }), url },
    }));
  }

  async function run(id: string) {
    const cur = runs[id];
    const url = (cur?.url || "").trim();
    if (!url) {
      alert("Please paste a target URL");
      return;
    }
    setRuns((prev) => ({ ...prev, [id]: { url, status: "loading" } }));
    const d = await apiPost<RunResult>("/api/recipe-scraper/run", {
      recipe_id: id,
      target_url: url,
    });
    if (!d.ok) {
      setRuns((prev) => ({
        ...prev,
        [id]: { url, status: "error", error: d.error || "Extraction failed" },
      }));
      return;
    }
    setRuns((prev) => ({ ...prev, [id]: { url, status: "done", result: d } }));
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Scraping Recipe Library
              </div>
              <h2 className="view-title">📋 Scraping Recipe Library</h2>
              <p className="view-sub">
                Pre-built extraction recipes for G2 reviews, Product Hunt,
                Trustpilot, LinkedIn, Glassdoor, pricing pages, job boards and
                more. One-click — just add your target URL.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {status === "loading" && (
          <div style={{ color: "#6B7280", padding: "32px 0" }}>
            Loading recipes…
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
            <p style={{ color: "#DC2626" }}>Failed to load recipes</p>
          </div>
        )}
        {status === "done" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
              gap: 16,
            }}
          >
            {recipes.map((r) => {
              const st = runs[r.id];
              return (
                <div
                  key={r.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{r.icon}</div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#111827",
                        marginBottom: 4,
                      }}
                    >
                      {r.label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6B7280",
                        marginBottom: 8,
                      }}
                    >
                      {r.description}
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                      Source: {r.source}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#6B7280",
                        marginBottom: 6,
                      }}
                    >
                      EXTRACTED FIELDS
                    </div>
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                    >
                      {(r.fields || []).map((f) => (
                        <span
                          key={f}
                          style={{
                            background: "#F3F4F6",
                            color: "#374151",
                            padding: "2px 7px",
                            borderRadius: 10,
                            fontSize: 11,
                          }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginTop: "auto" }}>
                    <input
                      value={st?.url || ""}
                      onChange={(e) => setUrl(r.id, e.target.value)}
                      placeholder="Paste target URL here…"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #D1D5DB",
                        borderRadius: 7,
                        fontSize: 13,
                        boxSizing: "border-box",
                        marginBottom: 8,
                      }}
                    />
                    <button
                      onClick={() => run(r.id)}
                      disabled={st?.status === "loading"}
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
                      Run Recipe →
                    </button>
                    <div style={{ marginTop: 10 }}>
                      {st?.status === "loading" && (
                        <div style={{ color: "#6B7280", fontSize: 13 }}>
                          Fetching and extracting…
                        </div>
                      )}
                      {st?.status === "error" && (
                        <div style={{ color: "#DC2626", fontSize: 13 }}>
                          {st.error}
                        </div>
                      )}
                      {st?.status === "done" && st.result && (
                        <div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "#6B7280",
                              marginBottom: 8,
                            }}
                          >
                            {st.result.summary} · {st.result.total_found} rows
                          </div>
                          <DataTable
                            columns={st.result.columns || []}
                            rows={st.result.rows || []}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
