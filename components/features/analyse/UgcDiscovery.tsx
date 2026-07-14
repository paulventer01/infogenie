"use client";

// Native React port of the legacy `ugc-discovery` panel (was
// `window.buildUgcDiscovery` + `#view-ugc-discovery` in index.html /
// public/js/ig_brand24_suite.js). Discovers user-generated content for a brand
// and curates a library (save/approve/archive) against the existing Express API
// (`GET /api/ugc-discovery/items`, `POST /api/ugc-discovery/discover`,
// `PATCH /api/ugc-discovery/items/:id/status`,
// `DELETE /api/ugc-discovery/items/:id`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, type ApiResult } from "@/lib/api";
import { safeUrl } from "@/lib/utils";

interface UgcItem {
  id: number;
  platform?: string;
  ugc_type?: string;
  sentiment?: string;
  status?: string;
  content?: string;
  author?: string;
  estimated_reach?: number;
  url?: string;
}
interface ItemsResult {
  rows?: UgcItem[];
}
interface DiscoverResult extends ApiResult {
  discovered?: number;
  saved?: number;
}

const UGC_TYPES = [
  { value: "review", label: "Reviews" },
  { value: "post", label: "Posts" },
  { value: "video", label: "Videos" },
  { value: "testimonial", label: "Testimonials" },
];

function fmtNum(n: unknown) {
  return Number(n || 0).toLocaleString("en-US");
}
function sentColor(s?: string) {
  return s === "positive"
    ? "success"
    : s === "negative"
      ? "danger"
      : "secondary";
}
function Pill({ label, cls }: { label: string; cls: string }) {
  return <span className={"badge bg-" + cls}>{label}</span>;
}

export default function UgcDiscovery() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UgcItem[]>([]);
  const [brand, setBrand] = useState("");
  const [types, setTypes] = useState<Record<string, boolean>>({
    review: true,
    post: true,
    video: true,
    testimonial: true,
  });
  const [discovering, setDiscovering] = useState(false);
  const [discResult, setDiscResult] = useState<{
    ok: boolean;
    discovered?: number;
    saved?: number;
    error?: string;
  } | null>(null);

  async function load(filterBrand?: string) {
    setLoading(true);
    const items = await apiGet<ItemsResult>(
      "/api/ugc-discovery/items" +
        (filterBrand ? "?brand=" + encodeURIComponent(filterBrand) : ""),
    );
    setRows(items.rows || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function discover() {
    const b = brand.trim();
    if (!b) return;
    const ugc_types = UGC_TYPES.filter((t) => types[t.value]).map(
      (t) => t.value,
    );
    setDiscovering(true);
    setDiscResult(null);
    const d = await apiPost<DiscoverResult>("/api/ugc-discovery/discover", {
      brand: b,
      ugc_types,
    });
    setDiscovering(false);
    if (!d.ok) {
      setDiscResult({ ok: false, error: d.error || "Failed" });
      return;
    }
    setDiscResult({ ok: true, discovered: d.discovered, saved: d.saved });
    setTimeout(() => load(b), 800);
  }

  async function setStatus(id: number, status: string) {
    await apiPatch("/api/ugc-discovery/items/" + id + "/status", { status });
    load(brand.trim() || undefined);
  }

  async function del(id: number) {
    await apiDelete("/api/ugc-discovery/items/" + id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div id="ugcDiscoveryWrap">
      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary"></div>
          <p className="mt-2 text-muted">Analysing with AI…</p>
        </div>
      ) : (
        <div className="row g-4">
          <div className="col-12 col-lg-4">
            <div className="card mb-4">
              <div className="card-body">
                <h5 className="card-title">Discover UGC</h5>
                <label className="form-label fw-semibold">Brand Name</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. Figma"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <label className="form-label fw-semibold small">
                  Content Types
                </label>
                <div className="d-flex flex-wrap gap-2 mb-3 small">
                  {UGC_TYPES.map((t) => (
                    <label key={t.value}>
                      <input
                        type="checkbox"
                        className="ugc-t"
                        value={t.value}
                        checked={!!types[t.value]}
                        onChange={(e) =>
                          setTypes((prev) => ({
                            ...prev,
                            [t.value]: e.target.checked,
                          }))
                        }
                      />{" "}
                      {t.label}
                    </label>
                  ))}
                </div>
                <button
                  className="btn btn-primary w-100 mb-2"
                  onClick={discover}
                  disabled={discovering}
                >
                  📸 Discover UGC
                </button>
                <button
                  className="btn btn-outline-secondary w-100"
                  onClick={() => load(brand.trim() || undefined)}
                >
                  🔄 Reload Library
                </button>
              </div>
            </div>
            <div>
              {discovering ? (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary"></div>
                  <p className="mt-2 text-muted">Analysing with AI…</p>
                </div>
              ) : discResult ? (
                discResult.ok ? (
                  <div className="alert alert-success">
                    Found <strong>{discResult.discovered}</strong> UGC items —{" "}
                    <strong>{discResult.saved}</strong> saved.
                  </div>
                ) : (
                  <div className="alert alert-danger">{discResult.error}</div>
                )
              ) : null}
            </div>
          </div>
          <div className="col-12 col-lg-8">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">
                  UGC Library{" "}
                  <span className="badge bg-secondary">{rows.length}</span>
                </h5>
                <div>
                  {rows.length ? (
                    rows.map((item) => (
                      <div
                        key={item.id}
                        className="border rounded p-3 mb-3"
                        id={"ugc-" + item.id}
                      >
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <div className="d-flex gap-1 flex-wrap">
                            <Pill
                              label={item.platform || ""}
                              cls="secondary"
                            />{" "}
                            <Pill label={item.ugc_type || ""} cls="info" />{" "}
                            <Pill
                              label={item.sentiment || ""}
                              cls={sentColor(item.sentiment)}
                            />
                          </div>
                          <div className="d-flex gap-1">
                            {item.status !== "approved" ? (
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => setStatus(item.id, "approved")}
                              >
                                ✓ Approve
                              </button>
                            ) : (
                              <Pill label="Approved" cls="success" />
                            )}{" "}
                            {item.status !== "saved" ? (
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => setStatus(item.id, "saved")}
                              >
                                Save
                              </button>
                            ) : null}{" "}
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => del(item.id)}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <p className="mb-1 small">
                          {(item.content || "").slice(0, 200)}
                        </p>
                        <div className="small text-muted">
                          by <strong>{item.author || ""}</strong>
                          {item.estimated_reach
                            ? " · reach ~" + fmtNum(item.estimated_reach)
                            : ""}
                        </div>
                        {item.url ? (
                          <a
                            href={safeUrl(item.url)}
                            target="_blank"
                            rel="noopener"
                            className="small"
                          >
                            View →
                          </a>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-5 text-muted">
                      <p>
                        No UGC in library yet. Run a discovery scan above.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
