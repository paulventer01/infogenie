"use client";

// Native React port of the legacy `iroas` panel (was `window.buildIroas` +
// the `_iroas*` helpers in public/js/ig_creator_suite.js + `#view-iroas`).
// Manages incrementality holdout tests, AI interpretation, and AI budget
// saturation analysis against the existing Express API:
//   GET    /api/iroas/tests
//   POST   /api/iroas/tests
//   PUT    /api/iroas/tests/:id
//   DELETE /api/iroas/tests/:id
//   POST   /api/iroas/tests/:id/interpret
//   POST   /api/iroas/saturation
// See docs/react-panel-migration.md for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

interface Computed {
  test_cvr?: number;
  control_cvr?: number;
  lift_pct: number | null;
  incremental_conversions: number;
  incremental_revenue: number;
  iroas: number | null;
  reported_roas: number | null;
  iroas_vs_reported: number | null;
}

interface IroasTest {
  id: number;
  name: string;
  campaign_name?: string;
  channel: string;
  holdout_pct: number;
  status: string;
  test_reach?: number;
  control_reach?: number;
  test_conversions?: number;
  control_conversions?: number;
  test_spend?: number;
  reported_revenue?: number;
  avg_order_value?: number;
  notes?: string;
  start_date?: string | null;
  end_date?: string | null;
  computed: Computed | null;
}

interface TestsResult {
  ok?: boolean;
  error?: string;
  tests?: IroasTest[];
}

interface SatCurve {
  channel: string;
  saturation_point: number;
  data?: { spend: number; iroas: number }[];
  insight?: string;
}

interface SatResult {
  ok?: boolean;
  error?: string;
  curves?: SatCurve[];
  recommendation?: string;
  source?: string;
}

interface Interpretation {
  verdict?: string;
  headline?: string;
  analysis?: string;
  actions?: string[];
}

interface InterpretResult {
  ok?: boolean;
  error?: string;
  interpretation?: Interpretation;
}

const VERDICT_COLORS: Record<string, string> = {
  positive: "#22c55e",
  neutral: "#f59e0b",
  negative: "#ef4444",
  pending: "#94a3b8",
};

function fmtMoney(v: number | null | undefined, cur = "USD"): string {
  if (v === null || v === undefined || (!v && v !== 0)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0,
  }).format(v);
}

interface NewTestForm {
  name: string;
  campaign_name: string;
  channel: string;
  holdout_pct: string;
  start_date: string;
  end_date: string;
  notes: string;
}

const EMPTY_NEW: NewTestForm = {
  name: "",
  campaign_name: "",
  channel: "meta",
  holdout_pct: "10",
  start_date: "",
  end_date: "",
  notes: "",
};

interface EditForm {
  test_reach: string;
  control_reach: string;
  test_conversions: string;
  control_conversions: string;
  test_spend: string;
  reported_revenue: string;
  avg_order_value: string;
  status: string;
}

export default function Iroas() {
  const [tests, setTests] = useState<IroasTest[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // New test modal
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<NewTestForm>(EMPTY_NEW);
  const [newStatus, setNewStatus] = useState<{ msg: string; type: string } | null>(
    null,
  );

  // Edit results modal
  const [editTest, setEditTest] = useState<IroasTest | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  // Interpretation modal
  const [interp, setInterp] = useState<Interpretation | null>(null);

  // Saturation sidebar
  const [satBudget, setSatBudget] = useState("");
  const [satIndustry, setSatIndustry] = useState("");
  const [satLoading, setSatLoading] = useState(false);
  const [satData, setSatData] = useState<SatResult | null>(null);
  const [satError, setSatError] = useState(false);

  async function load() {
    setLoadError(false);
    const data = await apiGet<TestsResult>("/api/iroas/tests");
    if (data.error && !data.tests) {
      setLoadError(true);
      setTests([]);
      return;
    }
    setTests(data.tests || []);
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setNewForm(EMPTY_NEW);
    setNewStatus(null);
    setShowNew(true);
  }

  async function saveNewTest() {
    if (!newForm.name) {
      setNewStatus({ msg: "name required", type: "error" });
      return;
    }
    setNewStatus({ msg: "Saving…", type: "info" });
    const body = {
      name: newForm.name,
      campaign_name: newForm.campaign_name,
      channel: newForm.channel,
      holdout_pct: parseInt(newForm.holdout_pct, 10) || 10,
      start_date: newForm.start_date || null,
      end_date: newForm.end_date || null,
      notes: newForm.notes,
    };
    const data = await apiPost<TestsResult>("/api/iroas/tests", body);
    if (data.error) {
      setNewStatus({ msg: data.error, type: "error" });
      return;
    }
    setShowNew(false);
    load();
  }

  function openEdit(t: IroasTest) {
    setEditTest(t);
    setEditForm({
      test_reach: String(t.test_reach || 0),
      control_reach: String(t.control_reach || 0),
      test_conversions: String(t.test_conversions || 0),
      control_conversions: String(t.control_conversions || 0),
      test_spend: String(t.test_spend || 0),
      reported_revenue: String(t.reported_revenue || 0),
      avg_order_value: String(t.avg_order_value || 0),
      status: t.status || "active",
    });
  }

  async function saveResults() {
    if (!editTest || !editForm) return;
    const body = {
      test_reach: parseInt(editForm.test_reach, 10) || 0,
      control_reach: parseInt(editForm.control_reach, 10) || 0,
      test_conversions: parseInt(editForm.test_conversions, 10) || 0,
      control_conversions: parseInt(editForm.control_conversions, 10) || 0,
      test_spend: parseFloat(editForm.test_spend) || 0,
      reported_revenue: parseFloat(editForm.reported_revenue) || 0,
      avg_order_value: parseFloat(editForm.avg_order_value) || 0,
      status: editForm.status,
    };
    const data = await apiPut<TestsResult>(
      `/api/iroas/tests/${editTest.id}`,
      body,
    );
    if (data.error) {
      alert(data.error);
      return;
    }
    setEditTest(null);
    setEditForm(null);
    load();
  }

  async function deleteTest(id: number) {
    if (!confirm("Delete this test?")) return;
    await apiDelete(`/api/iroas/tests/${id}`);
    load();
  }

  async function interpret(id: number) {
    const data = await apiPost<InterpretResult>(
      `/api/iroas/tests/${id}/interpret`,
      {},
    );
    if (data.error || !data.interpretation) {
      alert("Interpretation failed.");
      return;
    }
    setInterp(data.interpretation);
  }

  async function runSaturation() {
    setSatLoading(true);
    setSatError(false);
    setSatData(null);
    const data = await apiPost<SatResult>("/api/iroas/saturation", {
      channels: ["meta", "google", "tiktok"],
      monthly_budget: parseFloat(satBudget) || 10000,
      industry: satIndustry || "e-commerce",
    });
    setSatLoading(false);
    if (data.error || !data.curves) {
      setSatError(true);
      return;
    }
    setSatData(data);
  }

  function renderTestCard(t: IroasTest) {
    const c = t.computed || ({} as Partial<Computed>);
    const hasData = c.iroas !== null && c.iroas !== undefined;
    const verdict = hasData
      ? c.iroas! >= 2
        ? "positive"
        : c.iroas! >= 1
          ? "neutral"
          : "negative"
      : "pending";
    const verdictColor = VERDICT_COLORS[verdict];
    return (
      <div
        key={t.id}
        className="ig-card"
        style={{ marginBottom: 12, borderLeft: `3px solid ${verdictColor}` }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{t.name}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {t.channel} · {t.holdout_pct}% holdout ·{" "}
              {t.campaign_name || "No campaign"}
            </div>
          </div>
          <span
            className="ig-badge"
            style={{ background: `${verdictColor}20`, color: verdictColor }}
          >
            {verdict}
          </span>
        </div>
        {hasData ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  padding: 8,
                  background: "var(--bg-subtle,#f8f9fa)",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                  {c.iroas}x
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  iROAS
                </div>
              </div>
              <div
                style={{
                  textAlign: "center",
                  padding: 8,
                  background: "var(--bg-subtle,#f8f9fa)",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                  {c.reported_roas ?? "—"}x
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  Reported ROAS
                </div>
              </div>
              <div
                style={{
                  textAlign: "center",
                  padding: 8,
                  background: "var(--bg-subtle,#f8f9fa)",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                  {c.lift_pct !== null && c.lift_pct !== undefined
                    ? c.lift_pct + "%"
                    : "—"}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  Lift
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: "0.82rem",
                color: "var(--text-muted)",
                marginBottom: 12,
              }}
            >
              Incremental revenue:{" "}
              <strong>{fmtMoney(c.incremental_revenue)}</strong> from{" "}
              <strong>{c.incremental_conversions || 0}</strong> incremental
              conversions
              {c.iroas_vs_reported !== null &&
                c.iroas_vs_reported !== undefined && (
                  <>
                    {" "}
                    ·{" "}
                    <span
                      style={{
                        color: c.iroas_vs_reported < 0 ? "#ef4444" : "#22c55e",
                      }}
                    >
                      {c.iroas_vs_reported > 0 ? "+" : ""}
                      {c.iroas_vs_reported}% vs reported
                    </span>
                  </>
                )}
            </div>
          </>
        ) : (
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              marginBottom: 12,
            }}
          >
            Enter test results to calculate iROAS.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => openEdit(t)}
          >
            ✏️ Update Results
          </button>
          {hasData && (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => interpret(t.id)}
            >
              🤖 AI Interpret
            </button>
          )}
          <button
            className="btn btn-sm btn-danger-outline"
            onClick={() => deleteTest(t.id)}
          >
            🗑️
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> iROAS Module
              </div>
              <h2 className="view-title">📊 iROAS Incrementality</h2>
              <p className="view-sub">
                Measure true ad lift — not just reported ROAS. Design holdout
                tests, track incremental conversions, and see where each channel
                hits diminishing returns with budget saturation curves.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {tests === null ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <span className="ig-spinner"></span>
          </div>
        ) : loadError ? (
          <div className="ig-alert ig-alert-error">Failed to load tests.</div>
        ) : (
          <div className="ig-two-col" style={{ gap: 24 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                }}
              >
                <h3 style={{ margin: 0 }}>Holdout Tests</h3>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={openNew}
                >
                  + New Test
                </button>
              </div>
              {tests.length === 0 ? (
                <div className="ig-empty-state">
                  <div className="ies-icon">🧪</div>
                  <h3>No holdout tests yet</h3>
                  <p>
                    Create your first incrementality test to measure true ad
                    lift — not just reported ROAS.
                  </p>
                </div>
              ) : (
                tests.map(renderTestCard)
              )}
            </div>
            <div style={{ width: 320, flexShrink: 0 }}>
              <div className="ig-card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px" }}>📊 Budget Saturation</h4>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: 12,
                  }}
                >
                  See where each channel hits diminishing returns and where
                  extra spend stops paying off.
                </p>
                <div style={{ marginBottom: 8 }}>
                  <label className="ig-label">Monthly Budget ($)</label>
                  <input
                    className="ig-input"
                    type="number"
                    placeholder="10000"
                    value={satBudget}
                    onChange={(e) => setSatBudget(e.target.value)}
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label className="ig-label">Industry</label>
                  <input
                    className="ig-input"
                    placeholder="e.g. e-commerce"
                    value={satIndustry}
                    onChange={(e) => setSatIndustry(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ width: "100%" }}
                  onClick={runSaturation}
                >
                  📈 Analyse Saturation
                </button>
              </div>
              <div>
                {satLoading && (
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <span className="ig-spinner"></span>
                  </div>
                )}
                {satError && (
                  <div className="ig-alert ig-alert-error">
                    Analysis failed.
                  </div>
                )}
                {satData && satData.curves && (
                  <div className="ig-card">
                    <h4 style={{ margin: "0 0 12px" }}>📉 Saturation Curves</h4>
                    {satData.curves.map((c, i) => {
                      const budget = parseFloat(satBudget) || 10000;
                      const pct = c.saturation_point
                        ? Math.min(
                            100,
                            (budget / c.saturation_point) * 100,
                          )
                        : 0;
                      return (
                        <div key={i} style={{ marginBottom: 16 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 6,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 600,
                                textTransform: "capitalize",
                              }}
                            >
                              {c.channel}
                            </span>
                            <span className="ig-badge">
                              Saturation: {fmtMoney(c.saturation_point)}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 4,
                              background: "var(--border)",
                              borderRadius: 2,
                              overflow: "hidden",
                              marginBottom: 6,
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                background: "var(--ig-primary,#667eea)",
                                width: `${pct}%`,
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            {c.insight || ""}
                          </div>
                        </div>
                      );
                    })}
                    {satData.recommendation && (
                      <div
                        style={{
                          paddingTop: 12,
                          borderTop: "1px solid var(--border)",
                          fontSize: "0.85rem",
                        }}
                      >
                        <strong>Recommendation:</strong>{" "}
                        {satData.recommendation}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New test modal */}
      {showNew && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNew(false);
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 620 }}>
            <div className="ig-modal-header">
              <h3>🧪 New Holdout Test</h3>
              <button
                className="ig-modal-close"
                onClick={() => setShowNew(false)}
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
                  <label className="ig-label">Test Name *</label>
                  <input
                    className="ig-input"
                    placeholder="Q3 Meta Holdout"
                    value={newForm.name}
                    onChange={(e) =>
                      setNewForm({ ...newForm, name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Campaign Name</label>
                  <input
                    className="ig-input"
                    placeholder="Summer Sale Campaign"
                    value={newForm.campaign_name}
                    onChange={(e) =>
                      setNewForm({ ...newForm, campaign_name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Channel</label>
                  <select
                    className="ig-select"
                    value={newForm.channel}
                    onChange={(e) =>
                      setNewForm({ ...newForm, channel: e.target.value })
                    }
                  >
                    <option value="meta">Meta (FB/IG)</option>
                    <option value="google">Google Ads</option>
                    <option value="tiktok">TikTok</option>
                    <option value="youtube">YouTube</option>
                    <option value="email">Email</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="ig-label">Holdout % (control group)</label>
                  <input
                    className="ig-input"
                    type="number"
                    min={1}
                    max={50}
                    value={newForm.holdout_pct}
                    onChange={(e) =>
                      setNewForm({ ...newForm, holdout_pct: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Start Date</label>
                  <input
                    className="ig-input"
                    type="date"
                    value={newForm.start_date}
                    onChange={(e) =>
                      setNewForm({ ...newForm, start_date: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">End Date</label>
                  <input
                    className="ig-input"
                    type="date"
                    value={newForm.end_date}
                    onChange={(e) =>
                      setNewForm({ ...newForm, end_date: e.target.value })
                    }
                  />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="ig-label">Notes</label>
                <textarea
                  className="ig-textarea"
                  rows={2}
                  placeholder="e.g. Running alongside Black Friday campaign"
                  value={newForm.notes}
                  onChange={(e) =>
                    setNewForm({ ...newForm, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="ig-modal-footer">
              <div>
                {newStatus && (
                  <div
                    className={`ig-alert ig-alert-${newStatus.type}`}
                    style={{ margin: "8px 0" }}
                  >
                    {newStatus.msg}
                  </div>
                )}
              </div>
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
                  onClick={() => setShowNew(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={saveNewTest}>
                  Create Test
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit results modal */}
      {editTest && editForm && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditTest(null);
              setEditForm(null);
            }
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 680 }}>
            <div className="ig-modal-header">
              <h3>✏️ Update Test Results — {editTest.name}</h3>
              <button
                className="ig-modal-close"
                onClick={() => {
                  setEditTest(null);
                  setEditForm(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="ig-modal-body">
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  marginBottom: 16,
                }}
              >
                Enter the raw numbers from your test. iROAS will be calculated
                automatically.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <label className="ig-label">Test Group Reach</label>
                  <input
                    className="ig-input"
                    type="number"
                    placeholder="People shown ads"
                    value={editForm.test_reach}
                    onChange={(e) =>
                      setEditForm({ ...editForm, test_reach: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Control Group Reach</label>
                  <input
                    className="ig-input"
                    type="number"
                    placeholder="Holdout group size"
                    value={editForm.control_reach}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        control_reach: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Test Conversions</label>
                  <input
                    className="ig-input"
                    type="number"
                    value={editForm.test_conversions}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        test_conversions: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Control Conversions</label>
                  <input
                    className="ig-input"
                    type="number"
                    value={editForm.control_conversions}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        control_conversions: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Ad Spend ($)</label>
                  <input
                    className="ig-input"
                    type="number"
                    value={editForm.test_spend}
                    onChange={(e) =>
                      setEditForm({ ...editForm, test_spend: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Reported Revenue ($)</label>
                  <input
                    className="ig-input"
                    type="number"
                    value={editForm.reported_revenue}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        reported_revenue: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Avg Order Value ($)</label>
                  <input
                    className="ig-input"
                    type="number"
                    placeholder="0 = auto-calculate"
                    value={editForm.avg_order_value}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        avg_order_value: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="ig-label">Status</label>
                  <select
                    className="ig-select"
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="ig-modal-footer">
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
                  onClick={() => {
                    setEditTest(null);
                    setEditForm(null);
                  }}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={saveResults}>
                  Save Results
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interpretation modal */}
      {interp && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInterp(null);
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 600 }}>
            <div className="ig-modal-header">
              <h3>🤖 AI Interpretation</h3>
              <button
                className="ig-modal-close"
                onClick={() => setInterp(null)}
              >
                ×
              </button>
            </div>
            <div className="ig-modal-body">
              {(() => {
                const vc =
                  (interp.verdict && VERDICT_COLORS[interp.verdict]) ||
                  "#94a3b8";
                return (
                  <div
                    style={{
                      background: `${vc}15`,
                      border: `1px solid ${vc}40`,
                      borderRadius: 10,
                      padding: 16,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: 700,
                        color: vc,
                        marginBottom: 8,
                      }}
                    >
                      {interp.headline || ""}
                    </div>
                    <div style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
                      {interp.analysis || ""}
                    </div>
                  </div>
                );
              })()}
              {(interp.actions || []).length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>
                    Recommended Actions
                  </div>
                  {(interp.actions || []).map((a, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        marginBottom: 8,
                        alignItems: "flex-start",
                      }}
                    >
                      <span style={{ color: "var(--ig-primary,#667eea)" }}>
                        →
                      </span>
                      <div style={{ fontSize: "0.88rem" }}>{a}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
