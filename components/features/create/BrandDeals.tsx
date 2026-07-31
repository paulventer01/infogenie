"use client";

// Native React port of the legacy `brand-deals` panel (was
// `window.buildBrandDeals` + `#view-brand-deals` in index.html, defined in
// public/js/ig_creator_suite.js). Kanban brand-deal pipeline with AI pitch
// generation, backed by the existing Express API (`/api/brand-deals*`,
// `/api/personas`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";

interface Persona {
  id: number;
  name: string;
  is_active?: boolean;
}
interface Deal {
  id: number;
  brand_name: string;
  contact_name?: string;
  contact_email?: string;
  product?: string;
  deal_type?: string;
  status?: string;
  offered_rate?: number | null;
  negotiated_rate?: number | null;
  currency?: string;
  persona_id?: number | null;
  persona_name?: string;
  follow_up_date?: string;
  deadline?: string;
  deliverables?: string;
  notes?: string;
}
interface Stats {
  inquiries?: number;
  active?: number;
  completed?: number;
  total_earned?: number;
}
interface Pitch {
  subject?: string;
  body?: string;
  key_points?: string[];
}
interface DealForm {
  brand_name: string;
  contact_name: string;
  contact_email: string;
  product: string;
  deal_type: string;
  offered_rate: string;
  negotiated_rate: string;
  status: string;
  persona_id: string;
  follow_up_date: string;
  deadline: string;
  deliverables: string;
  notes: string;
}
interface Msg {
  type: "info" | "error";
  text: string;
}

const DEAL_STATUS_COLORS: Record<string, string> = {
  inquiry: "#94a3b8",
  negotiating: "#f59e0b",
  accepted: "#667eea",
  active: "#22c55e",
  completed: "#16a34a",
  rejected: "#ef4444",
  paused: "#6b7280",
};
const KANBAN = [
  "inquiry",
  "negotiating",
  "accepted",
  "active",
  "completed",
  "rejected",
];
const STATUS_OPTS = [
  "inquiry",
  "negotiating",
  "accepted",
  "active",
  "completed",
  "rejected",
  "paused",
];
const DEAL_TYPES = [
  "sponsored_post",
  "affiliate",
  "gifted",
  "ambassador",
  "product_review",
  "ugc",
  "other",
];

function formatMoney(v?: number | null, cur = "USD") {
  if (!v && v !== 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0,
  }).format(v);
}
function formatDate(s?: string) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

const EMPTY_FORM: DealForm = {
  brand_name: "",
  contact_name: "",
  contact_email: "",
  product: "",
  deal_type: "sponsored_post",
  offered_rate: "",
  negotiated_rate: "",
  status: "inquiry",
  persona_id: "",
  follow_up_date: "",
  deadline: "",
  deliverables: "",
  notes: "",
};

export default function BrandDeals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<DealForm>(EMPTY_FORM);
  const [saveStatus, setSaveStatus] = useState<Msg | null>(null);

  const [pitchId, setPitchId] = useState<number | null>(null);
  const [pitchType, setPitchType] = useState("initial");
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchError, setPitchError] = useState("");

  async function load() {
    setLoading(true);
    const [dealsData, statsData, personasData] = await Promise.all([
      apiGet<{ ok?: boolean; deals?: Deal[]; error?: string }>("/api/brand-deals"),
      apiGet<{ ok?: boolean; stats?: Stats }>("/api/brand-deals/stats/summary"),
      apiGet<{ ok?: boolean; personas?: Persona[] }>("/api/personas"),
    ]);
    setLoading(false);
    // Success is ok:true OR a deals array (API historically omitted ok).
    if (dealsData.ok === false || (dealsData.ok !== true && !Array.isArray(dealsData.deals))) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setDeals(dealsData.deals || []);
    setStats(statsData.stats || {});
    setPersonas((personasData.personas || []).filter((p) => p.is_active !== false));
  }

  useEffect(() => {
    load();
  }, []);

  function setField(k: keyof DealForm, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openNew() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setSaveStatus(null);
    setModalOpen(true);
  }

  function openEdit(d: Deal) {
    setEditId(d.id);
    setForm({
      brand_name: d.brand_name || "",
      contact_name: d.contact_name || "",
      contact_email: d.contact_email || "",
      product: d.product || "",
      deal_type: d.deal_type || "sponsored_post",
      offered_rate: d.offered_rate != null ? String(d.offered_rate) : "",
      negotiated_rate:
        d.negotiated_rate != null ? String(d.negotiated_rate) : "",
      status: d.status || "inquiry",
      persona_id: d.persona_id != null ? String(d.persona_id) : "",
      follow_up_date: d.follow_up_date?.split("T")[0] || "",
      deadline: d.deadline?.split("T")[0] || "",
      deliverables: d.deliverables || "",
      notes: d.notes || "",
    });
    setSaveStatus(null);
    setModalOpen(true);
  }

  async function save() {
    setSaveStatus({ type: "info", text: "Saving…" });
    const body = {
      brand_name: form.brand_name,
      contact_name: form.contact_name,
      contact_email: form.contact_email,
      product: form.product,
      deal_type: form.deal_type,
      offered_rate: parseFloat(form.offered_rate) || null,
      negotiated_rate: parseFloat(form.negotiated_rate) || null,
      status: form.status,
      deliverables: form.deliverables,
      notes: form.notes,
      follow_up_date: form.follow_up_date || null,
      deadline: form.deadline || null,
      persona_id: parseInt(form.persona_id) || null,
    };
    const r = editId
      ? await apiPut<{ ok?: boolean; deal?: Deal; error?: string }>(
          `/api/brand-deals/${editId}`,
          body,
        )
      : await apiPost<{ ok?: boolean; deal?: Deal; error?: string }>(
          "/api/brand-deals",
          body,
        );
    if (r.ok === false || (r.ok !== true && !r.deal)) {
      setSaveStatus({ type: "error", text: r.error || "Save failed." });
      return;
    }
    setModalOpen(false);
    load();
  }

  async function changeStatus(id: number, status: string) {
    await apiPut(`/api/brand-deals/${id}`, { status });
    load();
  }

  function openPitch(id: number) {
    setPitchId(id);
    setPitchType("initial");
    setPitch(null);
    setPitchError("");
  }

  async function doPitch() {
    if (pitchId == null) return;
    setPitchLoading(true);
    setPitchError("");
    setPitch(null);
    const r = await apiPost<{ ok?: boolean; pitch?: Pitch; error?: string }>(
      `/api/brand-deals/${pitchId}/generate-pitch`,
      { pitch_type: pitchType },
    );
    setPitchLoading(false);
    if (r.ok === false || (r.ok !== true && !r.pitch)) {
      setPitchError(r.error || "Generation failed.");
      return;
    }
    setPitch(r.pitch || {});
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Brand Deals
              </div>
              <h2 className="view-title">🤝 Brand Deal Pipeline</h2>
              <p className="view-sub">
                Track every brand deal from first inquiry to payment — with a
                kanban pipeline, AI-generated pitch emails, counter-offer
                writers, and earnings tracking across all your AI personas.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loadError ? (
          <div className="ig-alert ig-alert-error">Failed to load deals.</div>
        ) : loading ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <span className="ig-spinner" />
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: 12,
                marginBottom: 24,
              }}
            >
              {(
                [
                  ["💬 Inquiries", stats.inquiries || 0, "#94a3b8"],
                  ["🤝 Active Deals", stats.active || 0, "#22c55e"],
                  ["✅ Completed", stats.completed || 0, "#16a34a"],
                  ["💰 Total Earned", formatMoney(stats.total_earned || 0), "#667eea"],
                ] as [string, string | number, string][]
              ).map(([l, v, c], i) => (
                <div
                  key={i}
                  className="ig-card"
                  style={{ textAlign: "center", padding: 16 }}
                >
                  <div
                    style={{ fontSize: "1.4rem", fontWeight: 700, color: c }}
                  >
                    {v}
                  </div>
                  <div
                    style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}
                  >
                    {l}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <h3 style={{ margin: 0 }}>Deal Pipeline</h3>
              <button className="btn btn-primary" onClick={openNew}>
                + New Deal
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                gap: 16,
                alignItems: "start",
              }}
            >
              {KANBAN.map((status) => {
                const groupDeals = deals.filter((d) => d.status === status);
                const col = DEAL_STATUS_COLORS[status] || "#94a3b8";
                return (
                  <div key={status}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: col,
                        }}
                      />
                      <span
                        style={{
                          fontWeight: 600,
                          textTransform: "capitalize",
                          fontSize: "0.85rem",
                        }}
                      >
                        {status}
                      </span>
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        ({groupDeals.length})
                      </span>
                    </div>
                    {groupDeals.map((d) => {
                      const dcol = DEAL_STATUS_COLORS[d.status || ""] || "#94a3b8";
                      return (
                        <div
                          key={d.id}
                          className="ig-card"
                          style={{
                            marginBottom: 8,
                            padding: 12,
                            borderLeft: `3px solid ${dcol}`,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "0.9rem",
                              marginBottom: 2,
                            }}
                          >
                            {d.brand_name}
                          </div>
                          {d.product && (
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "var(--text-muted)",
                                marginBottom: 4,
                              }}
                            >
                              {d.product}
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 8,
                            }}
                          >
                            <span
                              className="ig-badge ig-badge-xs"
                              style={{ textTransform: "capitalize" }}
                            >
                              {(d.deal_type || "").replace(/_/g, " ")}
                            </span>
                            {(d.negotiated_rate || d.offered_rate) && (
                              <span
                                style={{
                                  fontSize: "0.85rem",
                                  fontWeight: 600,
                                  color: dcol,
                                }}
                              >
                                {formatMoney(
                                  d.negotiated_rate || d.offered_rate,
                                  d.currency || "USD",
                                )}
                              </span>
                            )}
                          </div>
                          {d.persona_name && (
                            <div
                              style={{
                                fontSize: "0.78rem",
                                color: "var(--text-muted)",
                                marginBottom: 8,
                              }}
                            >
                              👤 {d.persona_name}
                            </div>
                          )}
                          {d.follow_up_date && (
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#f59e0b",
                                marginBottom: 6,
                              }}
                            >
                              📅 Follow up: {formatDate(d.follow_up_date)}
                            </div>
                          )}
                          <div
                            style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                          >
                            <button
                              className="btn btn-xs btn-outline"
                              onClick={() => openEdit(d)}
                            >
                              ✏️
                            </button>
                            <button
                              className="btn btn-xs btn-outline"
                              onClick={() => openPitch(d.id)}
                            >
                              📧 Pitch
                            </button>
                            <select
                              className="ig-select"
                              style={{
                                fontSize: "0.75rem",
                                padding: "2px 6px",
                                height: "auto",
                              }}
                              value={d.status || "inquiry"}
                              onChange={(e) =>
                                changeStatus(d.id, e.target.value)
                              }
                            >
                              {STATUS_OPTS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 640 }}>
            <div className="ig-modal-header">
              <h3>{editId ? "✏️ Edit Deal" : "+ New Brand Deal"}</h3>
              <button
                className="ig-modal-close"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="ig-modal-body">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <label className="ig-label">Brand Name *</label>
                  <input
                    className="ig-input"
                    value={form.brand_name}
                    onChange={(e) => setField("brand_name", e.target.value)}
                    placeholder="e.g. LUMI Skincare"
                  />
                </div>
                <div>
                  <label className="ig-label">Contact Name</label>
                  <input
                    className="ig-input"
                    value={form.contact_name}
                    onChange={(e) => setField("contact_name", e.target.value)}
                    placeholder="Sarah Lee"
                  />
                </div>
                <div>
                  <label className="ig-label">Contact Email</label>
                  <input
                    className="ig-input"
                    type="email"
                    value={form.contact_email}
                    onChange={(e) => setField("contact_email", e.target.value)}
                    placeholder="sarah@brand.com"
                  />
                </div>
                <div>
                  <label className="ig-label">Product</label>
                  <input
                    className="ig-input"
                    value={form.product}
                    onChange={(e) => setField("product", e.target.value)}
                    placeholder="Vitamin C Serum"
                  />
                </div>
                <div>
                  <label className="ig-label">Deal Type</label>
                  <select
                    className="ig-select"
                    value={form.deal_type}
                    onChange={(e) => setField("deal_type", e.target.value)}
                  >
                    {DEAL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ig-label">Offered Rate ($)</label>
                  <input
                    className="ig-input"
                    type="number"
                    value={form.offered_rate}
                    onChange={(e) => setField("offered_rate", e.target.value)}
                    placeholder="500"
                  />
                </div>
                <div>
                  <label className="ig-label">Negotiated Rate ($)</label>
                  <input
                    className="ig-input"
                    type="number"
                    value={form.negotiated_rate}
                    onChange={(e) => setField("negotiated_rate", e.target.value)}
                    placeholder="650"
                  />
                </div>
                <div>
                  <label className="ig-label">Status</label>
                  <select
                    className="ig-select"
                    value={form.status}
                    onChange={(e) => setField("status", e.target.value)}
                  >
                    {STATUS_OPTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                {personas.length > 0 && (
                  <div>
                    <label className="ig-label">Persona</label>
                    <select
                      className="ig-select"
                      value={form.persona_id}
                      onChange={(e) => setField("persona_id", e.target.value)}
                    >
                      <option value="">None</option>
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="ig-label">Follow-up Date</label>
                  <input
                    className="ig-input"
                    type="date"
                    value={form.follow_up_date}
                    onChange={(e) => setField("follow_up_date", e.target.value)}
                  />
                </div>
                <div>
                  <label className="ig-label">Deadline</label>
                  <input
                    className="ig-input"
                    type="date"
                    value={form.deadline}
                    onChange={(e) => setField("deadline", e.target.value)}
                  />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="ig-label">Deliverables</label>
                <input
                  className="ig-input"
                  value={form.deliverables}
                  onChange={(e) => setField("deliverables", e.target.value)}
                  placeholder="e.g. 2x Instagram posts, 1x Reel, 3 stories"
                />
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="ig-label">Notes</label>
                <textarea
                  className="ig-textarea"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                />
              </div>
            </div>
            <div className="ig-modal-footer">
              {saveStatus && (
                <div
                  className={`ig-alert ig-alert-${saveStatus.type}`}
                  style={{ margin: "8px 0" }}
                >
                  {saveStatus.text}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                  marginTop: 8,
                }}
              >
                <button
                  className="btn btn-outline"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={save}>
                  {editId ? "Save Changes" : "Create Deal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pitchId != null && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPitchId(null);
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 600 }}>
            <div className="ig-modal-header">
              <h3>📧 AI Pitch Generator</h3>
              <button
                className="ig-modal-close"
                onClick={() => setPitchId(null)}
              >
                ×
              </button>
            </div>
            <div className="ig-modal-body">
              <div style={{ marginBottom: 12 }}>
                <label className="ig-label">Pitch Type</label>
                <select
                  className="ig-select"
                  value={pitchType}
                  onChange={(e) => setPitchType(e.target.value)}
                >
                  <option value="initial">Initial Pitch</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="counter">Counter Offer</option>
                </select>
              </div>
              <div>
                {pitchLoading && (
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <span className="ig-spinner" />
                  </div>
                )}
                {pitchError && (
                  <div className="ig-alert ig-alert-error">{pitchError}</div>
                )}
                {pitch && !pitchLoading && (
                  <div
                    style={{
                      background: "var(--bg-subtle,#f8f9fa)",
                      borderRadius: 10,
                      padding: 16,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>
                      Subject: {pitch.subject || ""}
                    </div>
                    <div
                      style={{
                        fontSize: "0.88rem",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {pitch.body || ""}
                    </div>
                    {(pitch.key_points || []).length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            fontWeight: 600,
                            color: "var(--text-muted)",
                            marginBottom: 4,
                          }}
                        >
                          KEY POINTS
                        </div>
                        {(pitch.key_points || []).map((kp, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: "0.82rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            • {kp}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="ig-modal-footer">
              <button className="btn btn-primary" onClick={doPitch}>
                ✨ Generate Pitch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
