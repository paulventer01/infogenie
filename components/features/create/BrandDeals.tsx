"use client";

// Native React port of the legacy `brand-deals` panel (was
// `window.buildBrandDeals` + `#view-brand-deals` in index.html, defined in
// public/js/ig_creator_suite.js). Kanban brand-deal pipeline with AI pitch
// generation, backed by the existing Express API (`/api/brand-deals*`,
// `/api/personas`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
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
interface AnalysisData {
  brandName?: string;
  brand?: string;
  companyName?: string;
  url?: string;
  domain?: string;
  industry?: string | { name?: string };
  competitors?: (string | { name?: string; brand?: string; domain?: string })[];
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

function readAnalysis(): AnalysisData {
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function analysisBrand(): string {
  const a = readAnalysis();
  const direct = a.brandName || a.brand || a.companyName;
  if (direct) return String(direct).trim();
  const dom = String(a.url || a.domain || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(".")[0]
    .trim();
  if (!dom) return "";
  return dom.charAt(0).toUpperCase() + dom.slice(1);
}

function analysisCompetitors(): string[] {
  const a = readAnalysis();
  return (a.competitors || [])
    .map((c) =>
      typeof c === "string"
        ? c
        : String(c?.name || c?.brand || c?.domain || "").trim(),
    )
    .filter(Boolean)
    .slice(0, 6);
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

/* InfoGenie teal design tokens — match theme-v2 / ig-card language */
const IG = {
  ink: "#0b1220",
  muted: "#5b6577",
  border: "rgba(11, 18, 32, 0.1)",
  surface: "#ffffff",
  stage: "#f3f6fb",
  panel2: "#f8fafc",
  teal: "#0f766e",
  blue: "#0284c7",
  green: "#16a34a",
  warm: "#0f766e",
  soft: "rgba(15, 118, 110, 0.12)",
  shadow: "0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px rgba(11, 18, 32, 0.06)",
  grad: "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
  radius: 12,
  radiusSm: 8,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: IG.muted,
  marginBottom: 6,
};
const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: IG.radiusSm,
  border: `1.5px solid ${IG.border}`,
  background: IG.surface,
  color: IG.ink,
  fontSize: "0.9rem",
  fontFamily: "inherit",
  outline: "none",
};
const sectionStyle: CSSProperties = {
  border: `1px solid ${IG.border}`,
  borderRadius: IG.radius,
  padding: "16px 16px 14px",
  background: IG.panel2,
  marginBottom: 12,
};
const sectionTitleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: "0.88rem",
  fontWeight: 800,
  color: IG.ink,
  letterSpacing: "-0.01em",
};
const chipStyle: CSSProperties = {
  border: `1px solid ${IG.border}`,
  background: IG.surface,
  color: IG.teal,
  borderRadius: 999,
  padding: "5px 11px",
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
const suggestBtnStyle: CSSProperties = {
  border: `1px solid rgba(15, 118, 110, 0.25)`,
  background: IG.soft,
  color: IG.teal,
  borderRadius: 8,
  padding: "3px 8px",
  fontSize: "0.68rem",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.3,
};

function FieldLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 6,
        minHeight: 22,
      }}
    >
      <label style={{ ...labelStyle, marginBottom: 0 }}>{children}</label>
      {action}
    </div>
  );
}

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
  const [suggesting, setSuggesting] = useState<keyof DealForm | null>(null);
  const [workspaceBrand, setWorkspaceBrand] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);

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
    setWorkspaceBrand(analysisBrand());
    setCompetitors(analysisCompetitors());
    const refresh = () => {
      setWorkspaceBrand(analysisBrand());
      setCompetitors(analysisCompetitors());
    };
    window.addEventListener("ig:analysis-updated", refresh);
    return () => window.removeEventListener("ig:analysis-updated", refresh);
  }, []);

  function setField(k: keyof DealForm, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openNew() {
    setEditId(null);
    const brand = analysisBrand();
    setWorkspaceBrand(brand);
    setCompetitors(analysisCompetitors());
    setForm({ ...EMPTY_FORM, brand_name: brand || "" });
    setSaveStatus(null);
    setSuggesting(null);
    setModalOpen(true);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function openEdit(d: Deal) {
    setEditId(d.id);
    setWorkspaceBrand(analysisBrand());
    setCompetitors(analysisCompetitors());
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
    setSuggesting(null);
    setModalOpen(true);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function suggestField(field: keyof DealForm, label: string) {
    setSuggesting(field);
    try {
      const ad = readAnalysis();
      const industry =
        (ad.industry &&
          (typeof ad.industry === "string" ? ad.industry : ad.industry.name)) ||
        "";
      const r = await apiPost<{ ok?: boolean; value?: string; error?: string }>(
        "/api/studio/ai-suggest",
        {
          field: `Generate a realistic value for the brand-deal form field "${label}". Reply with ONE short value only — no preamble.`,
          fieldLabel: label,
          brand: form.brand_name || ad.brandName || ad.brand || "",
          industry,
          currentValue: form[field] || "",
          context: `Deal type: ${form.deal_type}; product: ${form.product}`,
        },
      );
      const v = String(r?.value || "").trim();
      if (!v) throw new Error(r?.error || "Empty suggestion");
      setField(field, v);
    } catch (e) {
      setSaveStatus({
        type: "error",
        text: "AI Suggest failed: " + (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setSuggesting(null);
    }
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
        ) : modalOpen ? (
          <div
            className="ig-card"
            data-ig-no-enhance=""
            style={{
              borderRadius: IG.radius,
              border: `1px solid ${IG.border}`,
              boxShadow: IG.shadow,
              overflow: "hidden",
              background: IG.surface,
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                padding: "20px 22px 16px",
                borderBottom: `1px solid ${IG.border}`,
                background:
                  "linear-gradient(135deg, rgba(15,118,110,0.08) 0%, rgba(2,132,199,0.06) 100%)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: "0.66rem",
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: IG.teal,
                    marginBottom: 4,
                  }}
                >
                  Brand deal pipeline
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "1.25rem",
                    fontWeight: 800,
                    color: IG.ink,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {editId ? "Edit deal" : "New brand deal"}
                </h3>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "0.86rem",
                    color: IG.muted,
                    lineHeight: 1.45,
                    maxWidth: 560,
                  }}
                >
                  Brand, commercial terms, and dates — scroll to complete every section,
                  then create the deal.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setModalOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: IG.radiusSm,
                  border: `1px solid ${IG.border}`,
                  background: IG.surface,
                  color: IG.muted,
                  fontSize: "1.2rem",
                  lineHeight: 1,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "18px 22px 8px" }}>
              <section style={sectionStyle}>
                <h4 style={sectionTitleStyle}>Brand & contact</h4>
                <div style={{ marginBottom: 12 }}>
                  <FieldLabel>Brand name *</FieldLabel>
                  {(workspaceBrand || competitors.length > 0) && (
                    <select
                      data-ig-skip=""
                      className="ig-select"
                      style={{ ...inputStyle, marginBottom: 8, color: IG.teal, fontWeight: 600 }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) setField("brand_name", e.target.value);
                        e.target.value = "";
                      }}
                    >
                      <option value="">Pick from your analysis…</option>
                      {workspaceBrand && (
                        <option value={workspaceBrand}>{workspaceBrand} (my brand)</option>
                      )}
                      {competitors.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    data-ig-skip=""
                    className="ig-input"
                    style={inputStyle}
                    value={form.brand_name}
                    onChange={(e) => setField("brand_name", e.target.value)}
                    placeholder="e.g. LUMI Skincare"
                  />
                  {(workspaceBrand || competitors.length > 0) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {workspaceBrand && (
                        <button
                          type="button"
                          style={{
                            ...chipStyle,
                            background: IG.soft,
                            borderColor: "rgba(15,118,110,0.3)",
                          }}
                          onClick={() => setField("brand_name", workspaceBrand)}
                        >
                          My brand · {workspaceBrand}
                        </button>
                      )}
                      {competitors.map((c) => (
                        <button
                          key={c}
                          type="button"
                          style={chipStyle}
                          onClick={() => setField("brand_name", c)}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <FieldLabel
                      action={
                        <button
                          type="button"
                          style={suggestBtnStyle}
                          disabled={suggesting === "contact_name"}
                          onClick={() => suggestField("contact_name", "Contact Name")}
                        >
                          {suggesting === "contact_name" ? "…" : "Suggest"}
                        </button>
                      }
                    >
                      Contact name
                    </FieldLabel>
                    <input
                      data-ig-skip=""
                      className="ig-input"
                      style={inputStyle}
                      value={form.contact_name}
                      onChange={(e) => setField("contact_name", e.target.value)}
                      placeholder="Sarah Lee"
                    />
                  </div>
                  <div>
                    <FieldLabel
                      action={
                        <button
                          type="button"
                          style={suggestBtnStyle}
                          disabled={suggesting === "contact_email"}
                          onClick={() => suggestField("contact_email", "Contact Email")}
                        >
                          {suggesting === "contact_email" ? "…" : "Suggest"}
                        </button>
                      }
                    >
                      Contact email
                    </FieldLabel>
                    <input
                      data-ig-skip=""
                      className="ig-input"
                      style={inputStyle}
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setField("contact_email", e.target.value)}
                      placeholder="sarah@brand.com"
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <FieldLabel
                      action={
                        <button
                          type="button"
                          style={suggestBtnStyle}
                          disabled={suggesting === "product"}
                          onClick={() => suggestField("product", "Product")}
                        >
                          {suggesting === "product" ? "…" : "Suggest"}
                        </button>
                      }
                    >
                      Product / offer
                    </FieldLabel>
                    <input
                      data-ig-skip=""
                      className="ig-input"
                      style={inputStyle}
                      value={form.product}
                      onChange={(e) => setField("product", e.target.value)}
                      placeholder="Vitamin C Serum launch kit"
                    />
                  </div>
                </div>
              </section>

              <section style={sectionStyle}>
                <h4 style={sectionTitleStyle}>Commercial terms</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <FieldLabel>Deal type</FieldLabel>
                    <select
                      data-ig-skip=""
                      className="ig-select"
                      style={inputStyle}
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
                    <FieldLabel>Status</FieldLabel>
                    <select
                      data-ig-skip=""
                      className="ig-select"
                      style={inputStyle}
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
                  <div>
                    <FieldLabel>Offered rate ($)</FieldLabel>
                    <input
                      data-ig-skip=""
                      className="ig-input"
                      style={inputStyle}
                      type="number"
                      value={form.offered_rate}
                      onChange={(e) => setField("offered_rate", e.target.value)}
                      placeholder="500"
                    />
                  </div>
                  <div>
                    <FieldLabel>Negotiated rate ($)</FieldLabel>
                    <input
                      data-ig-skip=""
                      className="ig-input"
                      style={inputStyle}
                      type="number"
                      value={form.negotiated_rate}
                      onChange={(e) => setField("negotiated_rate", e.target.value)}
                      placeholder="650"
                    />
                  </div>
                  {personas.length > 0 && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <FieldLabel>Persona</FieldLabel>
                      <select
                        data-ig-skip=""
                        className="ig-select"
                        style={inputStyle}
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
                </div>
              </section>

              <section style={{ ...sectionStyle, marginBottom: 8 }}>
                <h4 style={sectionTitleStyle}>Timeline & scope</h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <FieldLabel>Follow-up date</FieldLabel>
                    <input
                      data-ig-skip=""
                      className="ig-input"
                      style={inputStyle}
                      type="date"
                      value={form.follow_up_date}
                      onChange={(e) => setField("follow_up_date", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Deadline</FieldLabel>
                    <input
                      data-ig-skip=""
                      className="ig-input"
                      style={inputStyle}
                      type="date"
                      value={form.deadline}
                      onChange={(e) => setField("deadline", e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <FieldLabel
                    action={
                      <button
                        type="button"
                        style={suggestBtnStyle}
                        disabled={suggesting === "deliverables"}
                        onClick={() => suggestField("deliverables", "Deliverables")}
                      >
                        {suggesting === "deliverables" ? "…" : "Suggest"}
                      </button>
                    }
                  >
                    Deliverables
                  </FieldLabel>
                  <input
                    data-ig-skip=""
                    className="ig-input"
                    style={inputStyle}
                    value={form.deliverables}
                    onChange={(e) => setField("deliverables", e.target.value)}
                    placeholder="e.g. 2 Instagram posts, 1 Reel, 3 stories"
                  />
                </div>
                <div>
                  <FieldLabel>Notes</FieldLabel>
                  <textarea
                    data-ig-skip=""
                    className="ig-textarea"
                    style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    placeholder="Context, talking points, or negotiation history"
                  />
                </div>
              </section>

              {saveStatus && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: "10px 12px",
                    borderRadius: IG.radiusSm,
                    fontSize: "0.84rem",
                    fontWeight: 600,
                    background: saveStatus.type === "error" ? "#FEF2F2" : IG.soft,
                    color: saveStatus.type === "error" ? "#991B1B" : IG.teal,
                    border:
                      saveStatus.type === "error"
                        ? "1px solid #FECACA"
                        : "1px solid rgba(15,118,110,0.25)",
                  }}
                >
                  {saveStatus.text}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                flexWrap: "wrap",
                padding: "14px 22px 18px",
                borderTop: `1px solid ${IG.border}`,
                background: IG.panel2,
              }}
            >
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{
                  padding: "10px 16px",
                  borderRadius: IG.radiusSm,
                  border: `1px solid ${IG.border}`,
                  background: IG.surface,
                  color: IG.muted,
                  fontWeight: 700,
                  fontSize: "0.86rem",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Back to pipeline
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!form.brand_name.trim()}
                style={{
                  padding: "10px 18px",
                  borderRadius: IG.radiusSm,
                  border: "none",
                  background: form.brand_name.trim() ? IG.grad : "#94A3B8",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: "0.86rem",
                  cursor: form.brand_name.trim() ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  boxShadow: form.brand_name.trim()
                    ? "0 8px 18px rgba(15, 118, 110, 0.28)"
                    : "none",
                }}
              >
                {editId ? "Save changes" : "Create deal"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Metric strip — matches InfoGenie ig-card language */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 22,
              }}
            >
              {(
                [
                  ["Inquiries", stats.inquiries || 0, "#5b6577", "💬"],
                  ["Active deals", stats.active || 0, IG.green, "🤝"],
                  ["Completed", stats.completed || 0, IG.teal, "✅"],
                  ["Total earned", formatMoney(stats.total_earned || 0), IG.blue, "💰"],
                ] as [string, string | number, string, string][]
              ).map(([l, v, c, icon]) => (
                <div
                  key={l}
                  className="ig-card"
                  style={{
                    padding: "16px 18px",
                    borderRadius: IG.radius,
                    boxShadow: IG.shadow,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      background: IG.soft,
                      color: IG.teal,
                      display: "grid",
                      placeItems: "center",
                      fontSize: "1.1rem",
                      flexShrink: 0,
                    }}
                  >
                    {icon}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: IG.muted,
                        marginBottom: 2,
                      }}
                    >
                      {l}
                    </div>
                    <div style={{ fontSize: "1.35rem", fontWeight: 800, color: c, letterSpacing: "-0.02em" }}>
                      {v}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pipeline board */}
            <div
              className="ig-card"
              style={{
                padding: 18,
                borderRadius: IG.radius,
                boxShadow: IG.shadow,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "1.05rem",
                      fontWeight: 800,
                      color: IG.ink,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    Deal pipeline
                  </h3>
                  <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: IG.muted }}>
                    Move deals from inquiry to paid — click a card to edit or generate a pitch.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openNew}
                  style={{
                    background: IG.grad,
                    border: "none",
                    borderRadius: IG.radiusSm,
                    padding: "10px 16px",
                    fontWeight: 800,
                    fontSize: "0.85rem",
                    boxShadow: "0 8px 18px rgba(15, 118, 110, 0.22)",
                  }}
                >
                  + New deal
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 12,
                  alignItems: "stretch",
                }}
              >
                {KANBAN.map((status) => {
                  const groupDeals = deals.filter((d) => d.status === status);
                  const col = DEAL_STATUS_COLORS[status] || "#94a3b8";
                  return (
                    <div
                      key={status}
                      style={{
                        background: IG.stage,
                        border: `1px solid ${IG.border}`,
                        borderRadius: IG.radius,
                        minHeight: 220,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "11px 12px",
                          background: IG.surface,
                          borderBottom: `1px solid ${IG.border}`,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: col,
                            boxShadow: `0 0 0 3px ${col}22`,
                          }}
                        />
                        <span
                          style={{
                            fontWeight: 800,
                            textTransform: "capitalize",
                            fontSize: "0.8rem",
                            color: IG.ink,
                            flex: 1,
                          }}
                        >
                          {status}
                        </span>
                        <span
                          style={{
                            fontSize: "0.68rem",
                            fontWeight: 800,
                            color: IG.teal,
                            background: IG.soft,
                            borderRadius: 999,
                            padding: "2px 8px",
                          }}
                        >
                          {groupDeals.length}
                        </span>
                      </div>

                      <div style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                        {groupDeals.length === 0 ? (
                          <div
                            style={{
                              flex: 1,
                              display: "grid",
                              placeItems: "center",
                              textAlign: "center",
                              padding: "18px 10px",
                              color: IG.muted,
                              fontSize: "0.75rem",
                              border: `1px dashed ${IG.border}`,
                              borderRadius: IG.radiusSm,
                              background: "rgba(255,255,255,0.55)",
                            }}
                          >
                            No deals yet
                          </div>
                        ) : (
                          groupDeals.map((d) => {
                            const dcol = DEAL_STATUS_COLORS[d.status || ""] || "#94a3b8";
                            return (
                              <div
                                key={d.id}
                                className="ig-card"
                                style={{
                                  padding: 12,
                                  borderRadius: IG.radiusSm,
                                  borderLeft: `3px solid ${dcol}`,
                                  boxShadow: "0 1px 2px rgba(11,18,32,0.04)",
                                  cursor: "pointer",
                                }}
                                onClick={() => openEdit(d)}
                              >
                                <div
                                  style={{
                                    fontWeight: 800,
                                    fontSize: "0.88rem",
                                    color: IG.ink,
                                    marginBottom: 2,
                                  }}
                                >
                                  {d.brand_name}
                                </div>
                                {d.product && (
                                  <div
                                    style={{
                                      fontSize: "0.76rem",
                                      color: IG.muted,
                                      marginBottom: 6,
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
                                    gap: 6,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: "0.65rem",
                                      fontWeight: 700,
                                      textTransform: "capitalize",
                                      color: IG.teal,
                                      background: IG.soft,
                                      borderRadius: 6,
                                      padding: "2px 7px",
                                    }}
                                  >
                                    {(d.deal_type || "").replace(/_/g, " ")}
                                  </span>
                                  {(d.negotiated_rate || d.offered_rate) != null && (
                                    <span
                                      style={{
                                        fontSize: "0.82rem",
                                        fontWeight: 800,
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
                                {d.follow_up_date && (
                                  <div
                                    style={{
                                      fontSize: "0.72rem",
                                      color: IG.warm,
                                      marginBottom: 8,
                                      fontWeight: 600,
                                    }}
                                  >
                                    Follow up {formatDate(d.follow_up_date)}
                                  </div>
                                )}
                                <div
                                  style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-outline"
                                    onClick={() => openEdit(d)}
                                    style={{ borderRadius: 6, fontWeight: 700 }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-outline"
                                    onClick={() => openPitch(d.id)}
                                    style={{ borderRadius: 6, fontWeight: 700 }}
                                  >
                                    Pitch
                                  </button>
                                  <select
                                    className="ig-select"
                                    style={{
                                      fontSize: "0.72rem",
                                      padding: "2px 6px",
                                      height: "auto",
                                      borderRadius: 6,
                                      flex: 1,
                                      minWidth: 90,
                                    }}
                                    value={d.status || "inquiry"}
                                    onChange={(e) => changeStatus(d.id, e.target.value)}
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
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {pitchId != null && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPitchId(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "32px 16px",
            overflowY: "auto",
            background: "rgba(11, 18, 32, 0.5)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            className="ig-modal"
            data-ig-no-enhance=""
            style={{
              width: "min(640px, 100%)",
              margin: "0 auto",
              borderRadius: 16,
              border: `1px solid ${IG.border}`,
              boxShadow: "0 24px 64px rgba(11, 18, 32, 0.22)",
              overflow: "hidden",
              background: IG.surface,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                padding: "20px 22px 12px",
                borderBottom: "1px solid #E8EEF8",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "1.15rem",
                    fontWeight: 800,
                    color: "#0A1628",
                  }}
                >
                  AI pitch generator
                </h3>
                <p style={{ margin: "6px 0 0", fontSize: "0.84rem", color: "#64748B" }}>
                  Draft an outreach email grounded in this deal.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPitchId(null)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid #E2E8F0",
                  background: "#fff",
                  color: "#475569",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: "16px 22px" }}>
              <div style={{ marginBottom: 12 }}>
                <FieldLabel>Pitch type</FieldLabel>
                <select
                  data-ig-skip=""
                  style={inputStyle}
                  value={pitchType}
                  onChange={(e) => setPitchType(e.target.value)}
                >
                  <option value="initial">Initial pitch</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="counter">Counter offer</option>
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
                      background: "#F8FAFF",
                      border: "1px solid #E2E8F0",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 10, color: "#0A1628" }}>
                      Subject: {pitch.subject || ""}
                    </div>
                    <div
                      style={{
                        fontSize: "0.88rem",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        color: "#334155",
                      }}
                    >
                      {pitch.body || ""}
                    </div>
                    {(pitch.key_points || []).length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            color: "#64748B",
                            marginBottom: 6,
                            letterSpacing: "0.04em",
                          }}
                        >
                          KEY POINTS
                        </div>
                        {(pitch.key_points || []).map((kp, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: "0.82rem",
                              color: "#475569",
                              marginBottom: 4,
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
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "14px 22px 18px",
                borderTop: "1px solid #E8EEF8",
              }}
            >
              <button
                type="button"
                onClick={doPitch}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: IG.grad,
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 8px 18px rgba(15, 118, 110, 0.28)",
                }}
              >
                Generate pitch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
