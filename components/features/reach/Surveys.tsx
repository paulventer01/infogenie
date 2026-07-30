"use client";

// Native React port of the legacy `surveys` panel (was `window.buildSurveys`
// in public/js/ig_customer_engagement.js + `#view-surveys`). In-app survey
// builder with AI analysis against the existing Express API
// (`GET/POST /api/surveys`, `DELETE /api/surveys/:id`,
// `GET /api/surveys/:id/responses`, `POST /api/surveys/:id/analyse`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Question {
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  options_raw?: string;
}
interface SurveyRow {
  id: string;
  title: string;
  status?: string;
  question_count?: number;
  response_count?: number;
}
interface SurveyResponse {
  respondent_email?: string;
  created_at: string;
  answers?: Record<string, unknown>;
}
interface Analysis {
  nps_score?: number | null;
  nps_bucket?: string;
  summary?: string;
  themes?: string[];
  action_items?: string[];
}
interface SurveysResp {
  ok: boolean;
  error?: string;
  surveys?: SurveyRow[];
}
interface ResponsesResp {
  ok: boolean;
  error?: string;
  responses?: SurveyResponse[];
}
interface AnalyseResp {
  ok: boolean;
  error?: string;
  analysis?: Analysis;
}

const Q_TYPE_LABELS: Record<string, string> = {
  text: "Free text",
  nps_scale: "NPS scale (0-10)",
  rating_5: "Rating 1-5",
  rating_10: "Rating 1-10",
  yes_no: "Yes / No",
  multiple_choice: "Multiple choice",
};
const Q_TYPES = ["text", "nps_scale", "rating_5", "rating_10", "yes_no", "multiple_choice"];

function badge(txt: string, color: string) {
  return (
    <span
      style={{
        background: color,
        color: "#fff",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: ".75rem",
        fontWeight: 700,
      }}
    >
      {txt}
    </span>
  );
}

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: 40,
  color: "#94a3b8",
  fontSize: "0.9rem",
};

export default function Surveys() {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("nps");
  const [trigger, setTrigger] = useState("manual");
  const [thanks, setThanks] = useState("Thanks for your feedback!");
  const [questions, setQuestions] = useState<Question[]>([
    {
      type: "nps_scale",
      label: "How likely are you to recommend us to a friend or colleague?",
      required: true,
    },
  ]);
  const [surveys, setSurveys] = useState<SurveyRow[] | null>(null);
  const [snippet, setSnippet] = useState("Select a saved survey to see its embed code.");
  const [activeSurveyId, setActiveSurveyId] = useState<string | null>(null);
  const [responses, setResponses] = useState<SurveyResponse[] | null>(null);
  const [responsesMsg, setResponsesMsg] = useState("Select a survey to view responses.");
  const [aiResult, setAiResult] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function loadSurveys() {
    setSurveys(null);
    const d = await apiGet<SurveysResp>("/api/surveys");
    if (!d.ok || !d.surveys?.length) {
      setSurveys([]);
      return;
    }
    setSurveys(d.surveys);
    if (d.surveys[0]) showSnippet(d.surveys[0].id);
  }

  useEffect(() => {
    loadSurveys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showSnippet(id: string) {
    const origin = typeof location !== "undefined" ? location.origin : "";
    setSnippet(
      `<script src="${origin}/public/js/ig_survey_widget.js?v=1"></script>\n<div data-ig-survey="${id}"></div>`,
    );
  }

  async function selectSurvey(s: SurveyRow) {
    setActiveSurveyId(s.id);
    showSnippet(s.id);
    setResponses(null);
    setResponsesMsg("");
    const d = await apiGet<ResponsesResp>(`/api/surveys/${s.id}/responses`);
    if (!d.ok) {
      setResponses([]);
      setResponsesMsg("Could not load responses.");
      return;
    }
    const resp = d.responses || [];
    if (!resp.length) {
      setResponses([]);
      setResponsesMsg("No responses yet.");
      return;
    }
    setResponses(resp);
  }

  async function deleteSurvey(id: string) {
    if (!confirm("Delete this survey?")) return;
    const r = await apiDelete(`/api/surveys/${id}`);
    if (r.ok) {
      toast("Survey deleted");
      loadSurveys();
    } else toast(r.error || "Error");
  }

  async function runAnalyse() {
    if (!activeSurveyId) {
      toast("Select a survey first.");
      return;
    }
    setAnalysing(true);
    const d = await apiPost<AnalyseResp>(`/api/surveys/${activeSurveyId}/analyse`);
    setAnalysing(false);
    if (!d.ok) {
      toast(d.error || "Analysis failed");
      return;
    }
    setAiResult(d.analysis || {});
  }

  async function save() {
    if (!name.trim()) {
      toast("Enter a survey name.");
      return;
    }
    const qs = questions.map((q) => ({
      ...q,
      options: q.options_raw
        ? q.options_raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : q.options,
    }));
    setSaving(true);
    const d = await apiPost("/api/surveys", {
      title: name.trim(),
      questions: qs,
      settings: { type, trigger, thanks_message: thanks },
    });
    setSaving(false);
    if (d.ok) {
      toast("Survey saved!");
      loadSurveys();
      setQuestions([]);
      setName("");
    } else toast(d.error || "Save failed");
  }

  function onTypeChange(v: string) {
    setType(v);
    if (v === "nps" && questions.length === 0) {
      setQuestions([
        {
          type: "nps_scale",
          label: "How likely are you to recommend us to a friend or colleague?",
          required: true,
        },
      ]);
    } else if (v === "csat" && questions.length === 0) {
      setQuestions([
        {
          type: "rating_5",
          label: "How satisfied are you with your experience today?",
          required: true,
        },
      ]);
    }
  }

  function updateQuestion(i: number, patch: Partial<Question>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function removeQuestion(i: number) {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  }

  const previewQs = questions.filter((q) => q.label);

  return (
    <div>
      <div className="view-header">
        <h2>📋 In-App Survey Builder</h2>
        <p className="view-sub">
          Create NPS, CSAT, and multi-question surveys — embed anywhere or trigger from journeys.
          Responses analysed with AI.
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          maxWidth: 1100,
        }}
      >
        {/* Left: Create / Edit */}
        <div>
          <div className="ig-card">
            <h3 style={{ margin: "0 0 16px", fontSize: "1rem" }}>Create Survey</h3>
            <div className="form-group">
              <label>Survey Name</label>
              <input
                className="form-control"
                placeholder="e.g. Post-signup NPS"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Survey Type</label>
              <select
                className="form-control"
                value={type}
                onChange={(e) => onTypeChange(e.target.value)}
              >
                <option value="nps">NPS (Net Promoter Score)</option>
                <option value="csat">CSAT (Customer Satisfaction)</option>
                <option value="custom">Custom Questions</option>
                <option value="ces">CES (Customer Effort Score)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Trigger</label>
              <select
                className="form-control"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
              >
                <option value="manual">Manual / Embedded</option>
                <option value="page_exit">On page exit</option>
                <option value="scroll_50">50% scroll depth</option>
                <option value="time_30s">After 30 seconds</option>
                <option value="journey">Journey node</option>
              </select>
            </div>
            <div>
              <label
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: "#374151",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Questions
              </label>
              <div>
                {questions.map((q, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 8,
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select
                        value={q.type}
                        onChange={(e) => updateQuestion(i, { type: e.target.value })}
                        style={{
                          padding: "4px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 5,
                          fontSize: "0.82rem",
                        }}
                      >
                        {Q_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {Q_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="checkbox"
                        title="Required"
                        checked={!!q.required}
                        onChange={(e) => updateQuestion(i, { required: e.target.checked })}
                        style={{ width: 14, height: 14 }}
                      />
                      <label style={{ fontSize: "0.78rem", color: "#6b7280" }}>Req</label>
                      <button
                        onClick={() => removeQuestion(i)}
                        style={{
                          marginLeft: "auto",
                          padding: "2px 8px",
                          background: "#fee2e2",
                          color: "#b91c1c",
                          border: "1px solid #fca5a5",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: "0.78rem",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      value={q.label || ""}
                      placeholder="Question text…"
                      onChange={(e) => updateQuestion(i, { label: e.target.value })}
                      style={{
                        padding: "5px 8px",
                        border: "1px solid #e2e8f0",
                        borderRadius: 5,
                        fontSize: "0.85rem",
                      }}
                    />
                    {q.type === "multiple_choice" && (
                      <input
                        value={q.options_raw ?? q.options?.join(",") ?? ""}
                        placeholder="Option A,Option B,Option C"
                        onChange={(e) => updateQuestion(i, { options_raw: e.target.value })}
                        style={{
                          padding: "5px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 5,
                          fontSize: "0.8rem",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() =>
                  setQuestions((qs) => [...qs, { type: "text", label: "", required: false }])
                }
                style={{
                  padding: "6px 14px",
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  marginTop: 6,
                }}
              >
                + Add Question
              </button>
            </div>
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Thank-you message</label>
              <input
                className="form-control"
                placeholder="Thanks for your feedback!"
                value={thanks}
                onChange={(e) => setThanks(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={saving}
                onClick={save}
              >
                {saving ? "Saving…" : "💾 Save Survey"}
              </button>
              <button
                onClick={() => setPreviewOpen(true)}
                style={{
                  flex: 1,
                  padding: 10,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                👁️ Preview
              </button>
            </div>
          </div>
          {/* Embed snippet */}
          <div className="ig-card" style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem" }}>📎 Embed Code</h3>
            <p style={{ fontSize: "0.82rem", color: "#6b7280", margin: "0 0 10px" }}>
              Copy this snippet into any page to render the survey inline.
            </p>
            <pre
              style={{
                background: '#eef4ff',
                color: "#e2e8f0",
                borderRadius: 8,
                padding: 14,
                fontSize: "0.78rem",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {snippet}
            </pre>
            <button
              onClick={() =>
                navigator.clipboard.writeText(snippet).then(() => toast("Copied!"))
              }
              style={{
                marginTop: 8,
                padding: "6px 14px",
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "0.82rem",
              }}
            >
              📋 Copy
            </button>
          </div>
        </div>
        {/* Right: Responses + AI Analysis */}
        <div>
          <div className="ig-card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Saved Surveys</h3>
              <button
                onClick={loadSurveys}
                style={{
                  padding: "5px 12px",
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.82rem",
                }}
              >
                🔄 Refresh
              </button>
            </div>
            <div>
              {surveys === null ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "#6b7280",
                    fontSize: "0.9rem",
                  }}
                >
                  ⏳ Loading…
                </div>
              ) : surveys.length === 0 ? (
                <div style={emptyStyle}>No surveys yet. Create one on the left.</div>
              ) : (
                surveys.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => selectSurvey(s)}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "10px 14px",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.title}</div>
                      <div style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                        {badge(s.status || "draft", "#6366f1")} &nbsp;{s.response_count || 0}{" "}
                        responses &nbsp;· {s.question_count || 0} questions
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSurvey(s.id);
                      }}
                      style={{
                        padding: "4px 10px",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        border: "1px solid #fca5a5",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: "0.78rem",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="ig-card" style={{ marginTop: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Responses &amp; AI Analysis</h3>
              <button
                className="btn btn-primary"
                style={{ padding: "7px 14px", fontSize: "0.85rem" }}
                disabled={analysing}
                onClick={runAnalyse}
              >
                {analysing ? "⏳ Analysing…" : "🤖 AI Analyse"}
              </button>
            </div>
            <div>
              {responses && responses.length ? (
                <>
                  <div style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: 8 }}>
                    {responses.length} response(s) — most recent first
                  </div>
                  {responses.slice(0, 10).map((r, i) => (
                    <div
                      key={i}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        padding: "8px 12px",
                        marginBottom: 6,
                        fontSize: "0.82rem",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#374151" }}>
                        {r.respondent_email || "Anonymous"}
                      </div>
                      <div
                        style={{ color: "#6b7280", fontSize: "0.75rem", marginBottom: 4 }}
                      >
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                      <div style={{ color: "#374151" }}>
                        {Object.entries(r.answers || {}).map(([k, v], idx, arr) => (
                          <span key={k}>
                            <span style={{ color: "#6b7280" }}>{k}:</span>{" "}
                            <strong>{String(v)}</strong>
                            {idx < arr.length - 1 ? " · " : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={emptyStyle}>{responsesMsg}</div>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              {aiResult && (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 10,
                    padding: 16,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#15803d", marginBottom: 10 }}>
                    🤖 AI Analysis
                  </div>
                  {aiResult.nps_score != null && (
                    <div style={{ fontSize: "0.85rem", marginBottom: 6 }}>
                      <strong>NPS Score:</strong> {aiResult.nps_score} — {aiResult.nps_bucket || ""}
                    </div>
                  )}
                  {aiResult.summary && (
                    <div
                      style={{ fontSize: "0.85rem", marginBottom: 10, color: "#374151" }}
                    >
                      {aiResult.summary}
                    </div>
                  )}
                  {aiResult.themes?.length ? (
                    <div style={{ fontSize: "0.82rem", marginBottom: 8 }}>
                      <strong>Key Themes:</strong>
                      <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                        {aiResult.themes.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {aiResult.action_items?.length ? (
                    <div style={{ fontSize: "0.82rem" }}>
                      <strong>Recommended Actions:</strong>
                      <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                        {aiResult.action_items.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Preview Modal */}
      {previewOpen && (
        <div
          style={{
            display: "flex",
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 9998,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 32,
              maxWidth: 480,
              width: "90%",
              position: "relative",
            }}
          >
            <button
              onClick={() => setPreviewOpen(false)}
              style={{
                position: "absolute",
                top: 12,
                right: 16,
                background: "none",
                border: "none",
                fontSize: "1.4rem",
                cursor: "pointer",
                color: "#6b7280",
              }}
            >
              ✕
            </button>
            <div>
              <h3 style={{ margin: "0 0 20px", fontSize: "1.1rem" }}>{name || "Survey Preview"}</h3>
              {previewQs.map((q, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      fontWeight: 600,
                      display: "block",
                      marginBottom: 6,
                      fontSize: "0.9rem",
                    }}
                  >
                    {q.label}
                    {q.required && <span style={{ color: "#ef4444" }}> *</span>}
                  </label>
                  {q.type === "nps_scale" && (
                    <div style={{ display: "flex", gap: 4 }}>
                      {Array.from({ length: 11 }, (_, n) => (
                        <button
                          key={n}
                          style={{
                            width: 36,
                            height: 36,
                            border: "1px solid #e2e8f0",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontWeight: 700,
                            fontSize: "0.85rem",
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                  {q.type === "rating_5" && (
                    <div style={{ display: "flex", gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          style={{
                            width: 36,
                            height: 36,
                            border: "1px solid #e2e8f0",
                            borderRadius: 6,
                            cursor: "pointer",
                          }}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  )}
                  {q.type === "yes_no" && (
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        style={{
                          padding: "8px 20px",
                          border: "1px solid #86efac",
                          background: "#f0fdf4",
                          borderRadius: 7,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        👍 Yes
                      </button>
                      <button
                        style={{
                          padding: "8px 20px",
                          border: "1px solid #fca5a5",
                          background: "#fef2f2",
                          borderRadius: 7,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        👎 No
                      </button>
                    </div>
                  )}
                  {q.type === "text" && (
                    <textarea
                      rows={3}
                      placeholder="Your answer…"
                      style={{
                        width: "100%",
                        border: "1px solid #e2e8f0",
                        borderRadius: 7,
                        padding: 8,
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  )}
                  {q.type === "multiple_choice" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(q.options_raw
                        ? q.options_raw.split(",").map((o) => o.trim()).filter(Boolean)
                        : q.options || ["Option A", "Option B", "Option C"]
                      ).map((o, oi) => (
                        <label
                          key={oi}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: "0.85rem",
                          }}
                        >
                          <input type="radio" name={`q${i}`} /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <button
                style={{
                  width: "100%",
                  padding: 12,
                  background: "#6366f1",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                  marginTop: 8,
                }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
