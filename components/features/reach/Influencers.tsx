"use client";

// Native React port of the legacy `influencers` panel (was
// `window.buildInfluencers` + the `_inf*` helpers in app.js and
// `#view-influencers` / `#infWrap` in index.html). Pipeline-style Influencer
// CRM — prospecting, outreach, negotiation, deal value, AI vetting, and an
// AI-drafted outreach email, against the existing Express API:
//   GET    /api/influencers?status=&platform=&q=
//   GET    /api/influencers/:id
//   POST   /api/influencers
//   PATCH  /api/influencers/:id
//   DELETE /api/influencers/:id
//   POST   /api/influencers/:id/outreach
//   POST   /api/influencers/:id/vet
//   POST   /api/influencers/:id/draft-email
// via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

const INF_STATUSES = [
  "prospect",
  "contacted",
  "negotiating",
  "active",
  "declined",
  "inactive",
];
const INF_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "twitch",
  "facebook",
  "other",
];
const INF_STATUS_COLORS: Record<string, string> = {
  prospect: "#6B7280",
  contacted: "#3B82F6",
  negotiating: "#F59E0B",
  active: "#15803D",
  declined: "#B91C1C",
  inactive: "#9CA3AF",
};
const INF_VET_COLORS: Record<string, string> = {
  Low: "#15803D",
  Medium: "#D97706",
  High: "#B91C1C",
  Suspicious: "#7C3AED",
};

interface VetFlags {
  red_flags?: string[];
  green_flags?: string[];
  summary?: string;
  source?: string;
}

interface Influencer {
  id: number;
  handle: string;
  platform: string;
  name?: string;
  niche?: string;
  country?: string;
  followers?: number;
  engagement_rate?: number | string;
  contact_email?: string;
  profile_url?: string;
  status: string;
  deal_value?: number | string;
  notes?: string;
  tags?: string[];
  last_contacted_at?: string | null;
  vet_risk?: string;
  vet_score?: number;
  vetted_at?: string | null;
  vet_flags?: VetFlags;
}

interface Outreach {
  id: number;
  kind: string;
  subject?: string;
  body?: string;
  created_at: string;
}

interface StatRow {
  status: string;
  c: number | string;
  v: number | string;
}

interface ListResult {
  ok: boolean;
  error?: string;
  influencers?: Influencer[];
  stats?: StatRow[];
}

interface DetailResult {
  ok: boolean;
  error?: string;
  influencer?: Influencer;
  outreach?: Outreach[];
}

interface VetResult {
  ok: boolean;
  error?: string;
  vet?: { risk_level?: string; score?: number; source?: string };
  source?: string;
}

interface DraftResult {
  ok: boolean;
  error?: string;
  source?: string;
  subject?: string;
  body?: string;
}

interface Filter {
  status: string;
  platform: string;
  q: string;
}

interface FormState {
  handle: string;
  platform: string;
  name: string;
  niche: string;
  country: string;
  followers: number;
  engagement_rate: number;
  contact_email: string;
  profile_url: string;
  status: string;
  deal_value: number;
  notes: string;
}

const EMPTY_FORM: FormState = {
  handle: "",
  platform: "instagram",
  name: "",
  niche: "",
  country: "",
  followers: 0,
  engagement_rate: 0,
  contact_email: "",
  profile_url: "",
  status: "prospect",
  deal_value: 0,
  notes: "",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 3,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1.5px solid #E5E7EB",
  borderRadius: 6,
};

export default function Influencers() {
  const [data, setData] = useState<ListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>({ status: "", platform: "", q: "" });
  // Draft form values for the filter bar (applied on "Apply").
  const [fq, setFq] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fPlatform, setFPlatform] = useState("");

  // Edit/new modal
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Detail modal
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [oKind, setOKind] = useState("email");
  const [oSubject, setOSubject] = useState("");
  const [oBody, setOBody] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    const params = new URLSearchParams();
    if (filter.status) params.set("status", filter.status);
    if (filter.platform) params.set("platform", filter.platform);
    if (filter.q) params.set("q", filter.q);
    const r = await apiGet<ListResult>("/api/influencers?" + params.toString());
    if (r.ok) setData(r);
    else {
      setLoadError(r.error || "load failed");
      setData(null);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters() {
    setFilter({ q: fq.trim(), status: fStatus, platform: fPlatform });
  }

  function resetFilters() {
    setFq("");
    setFStatus("");
    setFPlatform("");
    setFilter({ status: "", platform: "", q: "" });
  }

  async function openEdit(id?: number) {
    if (id) {
      const r = await apiGet<DetailResult>("/api/influencers/" + id);
      const inf = r.influencer;
      if (inf) {
        setForm({
          handle: inf.handle || "",
          platform: inf.platform || "instagram",
          name: inf.name || "",
          niche: inf.niche || "",
          country: inf.country || "",
          followers: Number(inf.followers) || 0,
          engagement_rate: Number(inf.engagement_rate) || 0,
          contact_email: inf.contact_email || "",
          profile_url: inf.profile_url || "",
          status: inf.status || "prospect",
          deal_value: Number(inf.deal_value) || 0,
          notes: inf.notes || "",
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setEditId(id);
    } else {
      setForm(EMPTY_FORM);
      setEditId(null);
    }
    setEditOpen(true);
  }

  async function save() {
    const payload = {
      handle: form.handle.trim(),
      platform: form.platform,
      name: form.name.trim(),
      niche: form.niche.trim(),
      country: form.country.trim(),
      status: form.status,
      followers: Number(form.followers),
      engagement_rate: Number(form.engagement_rate),
      contact_email: form.contact_email.trim(),
      deal_value: Number(form.deal_value),
      profile_url: form.profile_url.trim(),
      notes: form.notes,
    };
    if (!payload.handle) {
      showToast("❌ Handle required");
      return;
    }
    const r = editId
      ? await apiPatch<ListResult>("/api/influencers/" + editId, payload)
      : await apiPost<ListResult>("/api/influencers", payload);
    if (!r.ok) {
      showToast("❌ " + (r.error || "save failed"));
      return;
    }
    showToast("✅ Saved");
    setEditOpen(false);
    load();
  }

  async function remove(id: number) {
    let handle = "";
    const r = await apiGet<DetailResult>("/api/influencers/" + id);
    handle = r.influencer?.handle || "";
    if (
      !confirm(
        `Delete @${handle || "#" + id}? This cannot be undone (outreach log will be removed too).`,
      )
    )
      return;
    await apiDelete("/api/influencers/" + id);
    showToast("🗑 Removed");
    load();
  }

  const openDetail = useCallback(async (id: number) => {
    setDetailId(id);
    setDetail(null);
    setOKind("email");
    setOSubject("");
    setOBody("");
    const r = await apiGet<DetailResult>("/api/influencers/" + id);
    if (!r.ok) {
      showToast("❌ " + (r.error || "load failed"));
      setDetailId(null);
      return;
    }
    setDetail(r);
  }, []);

  async function addOutreach(id: number) {
    const payload = {
      kind: oKind,
      subject: oSubject.trim(),
      body: oBody.trim(),
    };
    if (!payload.body && !payload.subject) {
      showToast("❌ Add at least a subject or body");
      return;
    }
    const r = await apiPost<ListResult>("/api/influencers/" + id + "/outreach", payload);
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    showToast("✅ Logged");
    openDetail(id);
    load();
  }

  async function vet(id: number) {
    showToast("⏳ Vetting creator — this may take 20-30 seconds…");
    const r = await apiPost<VetResult>("/api/influencers/" + id + "/vet", {});
    if (!r.ok) {
      showToast("❌ Vet failed: " + (r.error || "vet failed"));
      return;
    }
    const v = r.vet || {};
    showToast(
      `✅ ${v.risk_level || "Unknown"} risk · ${v.score}/100 · ${(v.source || "").replace("+", " + ")}`,
    );
    if (detailId === id) openDetail(id);
    load();
  }

  async function draftEmail(id: number) {
    const brand = prompt("Your brand name:", "InfoGenie");
    if (brand === null) return;
    const product = prompt("Product / campaign:", "a paid creator collab");
    if (product === null) return;
    showToast("⏳ Drafting…");
    const r = await apiPost<DraftResult>("/api/influencers/" + id + "/draft-email", {
      brand,
      product,
      tone: "friendly",
    });
    if (!r.ok) {
      showToast("❌ " + (r.error || "failed"));
      return;
    }
    setOKind("email");
    setOSubject(r.subject || "");
    setOBody(r.body || "");
    showToast(
      "✅ Draft loaded (" + r.source + ") — review and click + Log to record",
    );
  }

  const list = data?.influencers || [];
  const stats = data?.stats || [];
  const totalDeal = stats.reduce((s, x) => s + Number(x.v || 0), 0);
  const totalCount = stats.reduce((s, x) => s + Number(x.c || 0), 0);

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Influencer CRM
              </div>
              <h2 className="view-title">🌟 Influencer CRM</h2>
              <p className="view-sub">
                Pipeline-style tracker for creator partnerships — prospecting,
                outreach, negotiation, deal value, and full activity log per
                creator.
              </p>
            </div>
            <div className="vh-actions">
              <button className="btn-primary" onClick={() => openEdit()}>
                + New Influencer
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loadError ? (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FCA5A5",
              borderRadius: 10,
              padding: 16,
              color: "#B91C1C",
            }}
          >
            {loadError}
          </div>
        ) : !data ? (
          <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>
            Loading creators…
          </div>
        ) : (
          <>
            {/* Stats header */}
            <div
              style={{
                background: "linear-gradient(135deg,#F5F3FF,#FDF4FF)",
                border: "1px solid #C4B5FD",
                borderRadius: 14,
                padding: "18px 22px",
                marginBottom: 18,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
                gap: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    color: "#7C3AED",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                  }}
                >
                  Creators tracked
                </div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "1.6rem",
                    fontWeight: 800,
                    color: "#1E1B4B",
                  }}
                >
                  {totalCount}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    color: "#7C3AED",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                  }}
                >
                  Total pipeline value
                </div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "1.6rem",
                    fontWeight: 800,
                    color: "#15803D",
                  }}
                >
                  ${totalDeal.toLocaleString()}
                </div>
              </div>
              {INF_STATUSES.map((s) => {
                const row = stats.find((x) => x.status === s) || { c: 0, v: 0 };
                return (
                  <div key={s}>
                    <div
                      style={{
                        fontSize: "0.6rem",
                        fontWeight: 700,
                        color: INF_STATUS_COLORS[s],
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                      }}
                    >
                      {s}
                    </div>
                    <div
                      style={{
                        fontFamily: "Sora,sans-serif",
                        fontSize: "1.2rem",
                        fontWeight: 800,
                        color: "#0A1628",
                      }}
                    >
                      {row.c}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Filter bar */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 14,
                marginBottom: 14,
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                placeholder="Search handle, name, niche…"
                value={fq}
                onChange={(e) => setFq(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: "8px 11px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 7,
                  fontSize: "0.82rem",
                }}
              />
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                style={{
                  padding: "8px 11px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 7,
                  fontSize: "0.82rem",
                  background: "#fff",
                }}
              >
                <option value="">All statuses</option>
                {INF_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={fPlatform}
                onChange={(e) => setFPlatform(e.target.value)}
                style={{
                  padding: "8px 11px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 7,
                  fontSize: "0.82rem",
                  background: "#fff",
                }}
              >
                <option value="">All platforms</option>
                {INF_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                onClick={applyFilters}
                style={{
                  padding: "8px 16px",
                  background: "#1E1B4B",
                  border: "2px solid #1E1B4B",
                  borderRadius: 7,
                  fontSize: "0.76rem",
                  fontWeight: 800,
                  color: "#fff",
                  WebkitTextFillColor: "#fff",
                  cursor: "pointer",
                  textShadow: "0 1px 2px rgba(0,0,0,.5)",
                }}
              >
                Apply
              </button>
              <button
                onClick={resetFilters}
                style={{
                  padding: "8px 12px",
                  background: "#fff",
                  border: "2px solid #E5E7EB",
                  borderRadius: 7,
                  fontSize: "0.76rem",
                  fontWeight: 700,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
            </div>

            {/* Table / empty */}
            {list.length === 0 ? (
              <div
                style={{
                  background: "#fff",
                  border: "2px dashed #C4B5FD",
                  borderRadius: 14,
                  padding: 48,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>🌟</div>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: 800,
                    color: "#0A1628",
                    marginBottom: 6,
                  }}
                >
                  No creators tracked yet
                </div>
                <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>
                  Click <strong>+ New Influencer</strong> at the top right to
                  start your pipeline.
                </div>
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
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.82rem",
                  }}
                >
                  <thead
                    style={{
                      background: "#F9FAFB",
                      color: "#6B7280",
                      textTransform: "uppercase",
                      fontSize: "0.6rem",
                      letterSpacing: ".06em",
                    }}
                  >
                    <tr>
                      <th style={{ padding: "11px 14px", textAlign: "left" }}>
                        Creator
                      </th>
                      <th style={{ padding: 11, textAlign: "left" }}>Platform</th>
                      <th style={{ padding: 11, textAlign: "right" }}>
                        Followers
                      </th>
                      <th style={{ padding: 11, textAlign: "right" }}>Eng %</th>
                      <th style={{ padding: 11, textAlign: "left" }}>Niche</th>
                      <th style={{ padding: 11, textAlign: "left" }}>Status</th>
                      <th style={{ padding: 11, textAlign: "right" }}>Deal $</th>
                      <th style={{ padding: 11, textAlign: "left" }}>
                        Last touch
                      </th>
                      <th style={{ padding: 11, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((i) => {
                      const vc = INF_VET_COLORS[i.vet_risk || ""] || "#6B7280";
                      return (
                        <tr
                          key={i.id}
                          style={{
                            borderTop: "1px solid #F3F4F6",
                            cursor: "pointer",
                          }}
                          onClick={() => openDetail(i.id)}
                        >
                          <td style={{ padding: "9px 14px" }}>
                            <div style={{ fontWeight: 800, color: "#0A1628" }}>
                              @{i.handle}
                            </div>
                            {i.name && (
                              <div
                                style={{ fontSize: "0.7rem", color: "#6B7280" }}
                              >
                                {i.name}
                              </div>
                            )}
                            {i.vet_risk && (
                              <div style={{ marginTop: 2 }}>
                                <span
                                  style={{
                                    fontSize: "0.58rem",
                                    fontWeight: 800,
                                    color: vc,
                                    background: vc + "18",
                                    border: "1px solid " + vc + "44",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                  }}
                                >
                                  🔍 {i.vet_risk} {i.vet_score}/100
                                </span>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: 9, color: "#374151" }}>
                            {i.platform}
                          </td>
                          <td
                            style={{
                              padding: 9,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                              fontWeight: 700,
                              color: "#7C3AED",
                            }}
                          >
                            {(i.followers || 0).toLocaleString()}
                          </td>
                          <td
                            style={{
                              padding: 9,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {Number(i.engagement_rate || 0).toFixed(2)}%
                          </td>
                          <td style={{ padding: 9, color: "#6B7280" }}>
                            {i.niche || "-"}
                          </td>
                          <td style={{ padding: 9 }}>
                            <span
                              style={{
                                background: INF_STATUS_COLORS[i.status],
                                color: "#fff",
                                padding: "2px 8px",
                                borderRadius: 5,
                                fontSize: "0.62rem",
                                fontWeight: 800,
                                textTransform: "uppercase",
                              }}
                            >
                              {i.status}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: 9,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                              fontWeight: 700,
                              color: "#15803D",
                            }}
                          >
                            {i.deal_value
                              ? "$" + Number(i.deal_value).toLocaleString()
                              : "-"}
                          </td>
                          <td
                            style={{
                              padding: 9,
                              fontSize: "0.7rem",
                              color: "#9CA3AF",
                            }}
                          >
                            {i.last_contacted_at
                              ? new Date(i.last_contacted_at).toLocaleDateString()
                              : "never"}
                          </td>
                          <td
                            style={{ padding: 9, textAlign: "right" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => openEdit(i.id)}
                              style={{
                                padding: "5px 10px",
                                background: "#fff",
                                border: "1.5px solid #E5E7EB",
                                borderRadius: 5,
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                color: "#374151",
                                cursor: "pointer",
                              }}
                            >
                              ✏
                            </button>{" "}
                            <button
                              onClick={() => remove(i.id)}
                              style={{
                                padding: "5px 10px",
                                background: "#fff",
                                border: "1.5px solid #FCA5A5",
                                borderRadius: 5,
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                color: "#B91C1C",
                                cursor: "pointer",
                              }}
                            >
                              🗑
                            </button>{" "}
                            <button
                              onClick={() => vet(i.id)}
                              style={{
                                padding: "5px 10px",
                                background: "#fff",
                                border: "1.5px solid #C4B5FD",
                                borderRadius: 5,
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                color: "#7C3AED",
                                cursor: "pointer",
                              }}
                            >
                              🔍 Vet
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {editOpen && (
        <EditModal
          editId={editId}
          form={form}
          setForm={setForm}
          onClose={() => setEditOpen(false)}
          onSave={save}
        />
      )}

      {detailId !== null && (
        <DetailModal
          detail={detail}
          oKind={oKind}
          oSubject={oSubject}
          oBody={oBody}
          setOKind={setOKind}
          setOSubject={setOSubject}
          setOBody={setOBody}
          onClose={() => setDetailId(null)}
          onEdit={(id) => {
            setDetailId(null);
            openEdit(id);
          }}
          onVet={vet}
          onDraftEmail={draftEmail}
          onAddOutreach={addOutreach}
        />
      )}
    </div>
  );
}

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(10,22,40,.55)",
  zIndex: 10010,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "32px 16px",
  overflowY: "auto",
  backdropFilter: "blur(4px)",
};

function EditModal({
  editId,
  form,
  setForm,
  onClose,
  onSave,
}: {
  editId: number | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onClose: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 680,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1.2rem",
              fontWeight: 800,
            }}
          >
            {editId ? "✏ Edit" : "+ New"} Influencer
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.4rem",
              cursor: "pointer",
              color: "#6B7280",
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 11,
          }}
        >
          <label>
            <div style={labelStyle}>Handle *</div>
            <input
              value={form.handle}
              onChange={(e) => set("handle", e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Platform</div>
            <select
              value={form.platform}
              onChange={(e) => set("platform", e.target.value)}
              style={{ ...inputStyle, background: "#fff" }}
            >
              {INF_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div style={labelStyle}>Display name</div>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Niche</div>
            <input
              value={form.niche}
              onChange={(e) => set("niche", e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Country</div>
            <input
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Status</div>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              style={{ ...inputStyle, background: "#fff" }}
            >
              {INF_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div style={labelStyle}>Followers</div>
            <input
              type="number"
              min={0}
              value={form.followers}
              onChange={(e) => set("followers", Number(e.target.value))}
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Engagement %</div>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={form.engagement_rate}
              onChange={(e) => set("engagement_rate", Number(e.target.value))}
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Contact email</div>
            <input
              value={form.contact_email}
              onChange={(e) => set("contact_email", e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Deal value $</div>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.deal_value}
              onChange={(e) => set("deal_value", Number(e.target.value))}
              style={inputStyle}
            />
          </label>
          <label style={{ gridColumn: "1/-1" }}>
            <div style={labelStyle}>Profile URL</div>
            <input
              value={form.profile_url}
              onChange={(e) => set("profile_url", e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ gridColumn: "1/-1" }}>
            <div style={labelStyle}>Notes</div>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </label>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 20,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px",
              background: "#fff",
              border: "2px solid #E5E7EB",
              borderRadius: 7,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#374151",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{
              padding: "9px 18px",
              background: "#7C3AED",
              border: "2px solid #7C3AED",
              borderRadius: 7,
              fontSize: "0.78rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          >
            💾 Save
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({
  detail,
  oKind,
  oSubject,
  oBody,
  setOKind,
  setOSubject,
  setOBody,
  onClose,
  onEdit,
  onVet,
  onDraftEmail,
  onAddOutreach,
}: {
  detail: DetailResult | null;
  oKind: string;
  oSubject: string;
  oBody: string;
  setOKind: (v: string) => void;
  setOSubject: (v: string) => void;
  setOBody: (v: string) => void;
  onClose: () => void;
  onEdit: (id: number) => void;
  onVet: (id: number) => void;
  onDraftEmail: (id: number) => void;
  onAddOutreach: (id: number) => void;
}) {
  const i = detail?.influencer;
  const out = detail?.outreach || [];
  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 760,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!i ? (
          <div style={{ textAlign: "center", color: "#6B7280", padding: 30 }}>
            Loading…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 14,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "1.3rem",
                    fontWeight: 800,
                  }}
                >
                  @{i.handle}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
                  {i.platform} · {(i.followers || 0).toLocaleString()} followers ·{" "}
                  {Number(i.engagement_rate || 0).toFixed(2)}% eng
                </div>
                {i.profile_url && (
                  <a
                    href={i.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "0.74rem", color: "#7C3AED" }}
                  >
                    Open profile ↗
                  </a>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => onEdit(i.id)}
                  style={{
                    padding: "7px 12px",
                    background: "#fff",
                    border: "2px solid #E5E7EB",
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ✏ Edit
                </button>
                <button
                  onClick={() => onVet(i.id)}
                  style={{
                    padding: "7px 12px",
                    background: "#fff",
                    border: "2px solid #C4B5FD",
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    fontWeight: 800,
                    color: "#7C3AED",
                    cursor: "pointer",
                  }}
                >
                  {i.vetted_at ? "🔄 Re-vet" : "🔍 Vet"}
                </button>
                <button
                  onClick={() => onDraftEmail(i.id)}
                  style={{
                    padding: "7px 12px",
                    background: "#7C3AED",
                    border: "2px solid #7C3AED",
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    fontWeight: 800,
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                    cursor: "pointer",
                    textShadow: "0 1px 2px rgba(0,0,0,.4)",
                  }}
                >
                  ✨ AI draft email
                </button>
                <button
                  onClick={onClose}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "1.4rem",
                    cursor: "pointer",
                    color: "#6B7280",
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 14,
                padding: "12px 0",
                borderTop: "1px solid #F1F5F9",
                borderBottom: "1px solid #F1F5F9",
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <DetailStat label="Status">
                <span
                  style={{
                    background: INF_STATUS_COLORS[i.status],
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 5,
                    fontSize: "0.66rem",
                    fontWeight: 800,
                  }}
                >
                  {i.status}
                </span>
              </DetailStat>
              <DetailStat label="Niche">
                <span style={{ fontWeight: 700 }}>{i.niche || "-"}</span>
              </DetailStat>
              <DetailStat label="Country">
                <span style={{ fontWeight: 700 }}>{i.country || "-"}</span>
              </DetailStat>
              <DetailStat label="Email">
                <span style={{ fontWeight: 700 }}>{i.contact_email || "-"}</span>
              </DetailStat>
              <DetailStat label="Deal">
                <span style={{ fontWeight: 800, color: "#15803D" }}>
                  {i.deal_value
                    ? "$" + Number(i.deal_value).toLocaleString()
                    : "-"}
                </span>
              </DetailStat>
            </div>

            {i.notes && (
              <div
                style={{
                  background: "#FEF3C7",
                  border: "1px solid #FDE68A",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 14,
                  fontSize: "0.8rem",
                  color: "#78350F",
                  whiteSpace: "pre-wrap",
                }}
              >
                {i.notes}
              </div>
            )}

            {(i.vet_score || i.vet_score === 0) && <VetCard inf={i} />}

            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontWeight: 800,
                marginBottom: 8,
              }}
            >
              Outreach log ({out.length})
            </div>
            <div
              style={{
                background: "#FAFBFC",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr auto",
                  gap: 8,
                  alignItems: "start",
                }}
              >
                <select
                  value={oKind}
                  onChange={(e) => setOKind(e.target.value)}
                  style={{
                    padding: 7,
                    border: "1.5px solid #E5E7EB",
                    borderRadius: 6,
                    background: "#fff",
                    fontSize: "0.78rem",
                  }}
                >
                  <option>email</option>
                  <option>dm</option>
                  <option>call</option>
                  <option>meeting</option>
                  <option>note</option>
                </select>
                <input
                  value={oSubject}
                  onChange={(e) => setOSubject(e.target.value)}
                  placeholder="Subject (optional)"
                  style={{
                    padding: "7px 10px",
                    border: "1.5px solid #E5E7EB",
                    borderRadius: 6,
                    fontSize: "0.78rem",
                  }}
                />
                <button
                  onClick={() => onAddOutreach(i.id)}
                  style={{
                    padding: "7px 14px",
                    background: "#1E1B4B",
                    border: "2px solid #1E1B4B",
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    fontWeight: 800,
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                    cursor: "pointer",
                    textShadow: "0 1px 2px rgba(0,0,0,.5)",
                  }}
                >
                  + Log
                </button>
              </div>
              <textarea
                value={oBody}
                onChange={(e) => setOBody(e.target.value)}
                placeholder="What was said / next step / outcome…"
                rows={2}
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: "8px 10px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 6,
                  fontSize: "0.78rem",
                  resize: "vertical",
                }}
              />
            </div>
            <div
              style={{
                maxHeight: 280,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {out.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    color: "#9CA3AF",
                    padding: 14,
                    fontSize: "0.8rem",
                  }}
                >
                  No outreach yet — log your first touch above.
                </div>
              ) : (
                out.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 7,
                      padding: "10px 12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.74rem",
                          fontWeight: 800,
                          color: "#1E1B4B",
                        }}
                      >
                        {o.kind}
                        {o.subject ? " · " + o.subject : ""}
                      </div>
                      <div style={{ fontSize: "0.66rem", color: "#9CA3AF" }}>
                        {new Date(o.created_at).toLocaleString()}
                      </div>
                    </div>
                    {o.body && (
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "#374151",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {o.body}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DetailStat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.6rem",
          color: "#9CA3AF",
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function VetCard({ inf }: { inf: Influencer }) {
  const vf = inf.vet_flags || {};
  const vc = INF_VET_COLORS[inf.vet_risk || ""] || "#6B7280";
  const reds = Array.isArray(vf.red_flags) ? vf.red_flags : [];
  const greens = Array.isArray(vf.green_flags) ? vf.green_flags : [];
  return (
    <div
      style={{
        background: vc + "0D",
        border: "1.5px solid " + vc + "44",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontFamily: "Sora,sans-serif",
            fontSize: "1.1rem",
            fontWeight: 800,
            color: vc,
          }}
        >
          {inf.vet_score}/100
        </div>
        <div
          style={{
            background: vc,
            color: "#fff",
            padding: "3px 10px",
            borderRadius: 5,
            fontSize: "0.66rem",
            fontWeight: 800,
            textTransform: "uppercase",
          }}
        >
          🔍 {inf.vet_risk || ""} Risk
        </div>
        <div
          style={{ fontSize: "0.64rem", color: "#9CA3AF", marginLeft: "auto" }}
        >
          Vetted{" "}
          {inf.vetted_at ? new Date(inf.vetted_at).toLocaleDateString() : ""} ·{" "}
          {(vf.source || "").replace("+", " + ")}
        </div>
      </div>
      {vf.summary && (
        <div
          style={{
            fontSize: "0.8rem",
            color: "#374151",
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          {vf.summary}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {reds.length > 0 && (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 7,
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                fontSize: "0.6rem",
                fontWeight: 800,
                color: "#B91C1C",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              ⚠ Red flags
            </div>
            {reds.map((f, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: "0.72rem",
                  color: "#7F1D1D",
                  marginBottom: 2,
                }}
              >
                • {f}
              </div>
            ))}
          </div>
        )}
        {greens.length > 0 && (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 7,
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                fontSize: "0.6rem",
                fontWeight: 800,
                color: "#15803D",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              ✓ Green flags
            </div>
            {greens.map((f, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: "0.72rem",
                  color: "#14532D",
                  marginBottom: 2,
                }}
              >
                • {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
