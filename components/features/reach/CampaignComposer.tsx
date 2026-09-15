"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import PanelHero from "@/components/layout/PanelHero";
import ContentSafetyWarnings from "@/components/layout/ContentSafetyWarnings";

interface AudienceRules {
  match: string;
  conditions: any[];
}

interface CampaignDraft {
  campaign_name: string;
  audience_description: string;
  audience_rules: AudienceRules;
  channel: string;
  subject: string;
  body: string;
  recommended_send_time: string;
  rationale: string;
  source?: string;
}

interface DraftRow {
  id: number;
  prompt: string;
  draft: CampaignDraft;
  status: 'draft' | 'approved' | 'launched';
  segment_id: number | null;
  content_safety_warnings?: string[];
  created_at: string;
  updated_at: string;
}

interface DraftsResp {
  ok: boolean;
  drafts: DraftRow[];
  error?: string;
}

interface GenerateResp {
  ok: boolean;
  draft: DraftRow;
  segment_id?: number;
  content_safety_warnings?: string[];
  error?: string;
  userMessage?: string;
}

export default function CampaignComposer() {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<DraftRow[]>([]);
  const [activeDraft, setActiveDraft] = useState<DraftRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [approvingDraftId, setApprovingDraftId] = useState<number | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});
  const [approveErrors, setApproveErrors] = useState<Record<number, string>>({});
  const activeDraftRef = useRef<DraftRow | null>(null);
  const saveRequestRef = useRef<Map<number, number>>(new Map());
  const approveRequestRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    activeDraftRef.current = activeDraft;
  }, [activeDraft]);

  function invalidatePendingSave(draftId: number) {
    saveRequestRef.current.set(draftId, (saveRequestRef.current.get(draftId) || 0) + 1);
  }

  function invalidatePendingApprove(draftId: number) {
    approveRequestRef.current.set(draftId, (approveRequestRef.current.get(draftId) || 0) + 1);
  }

  function clearSaveError(draftId: number) {
    setSaveErrors((prev) => {
      if (!prev[draftId]) return prev;
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
  }

  function clearApproveError(draftId: number) {
    setApproveErrors((prev) => {
      if (!prev[draftId]) return prev;
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
  }

  function activateDraft(row: DraftRow | null) {
    if (activeDraft?.id != null) {
      invalidatePendingSave(activeDraft.id);
      clearSaveError(activeDraft.id);
      clearApproveError(activeDraft.id);
    }
    setSaving(false);
    setApprovingDraftId((prev) => (prev === activeDraft?.id ? null : prev));
    setActiveDraft(row);
  }

  const activeSaveError = activeDraft ? saveErrors[activeDraft.id] || null : null;
  const activeApproveError = activeDraft ? approveErrors[activeDraft.id] || null : null;
  const isApprovingActive = activeDraft != null && approvingDraftId === activeDraft.id;

  useEffect(() => {
    refreshHistoryOnly();
  }, []);

  async function refreshHistoryOnly() {
    const d = await apiGet<DraftsResp>("/api/campaign-composer/drafts");
    if (!d.ok) return;
    const activeId = activeDraftRef.current?.id;
    setHistory(d.drafts);
    if (activeId == null) return;
    setActiveDraft((prev) => {
      if (!prev || prev.id !== activeId) return prev;
      const latest = d.drafts.find((row) => row.id === activeId);
      if (!latest) return prev;
      return {
        ...prev,
        status: latest.status,
        segment_id: latest.segment_id,
        updated_at: latest.updated_at,
      };
    });
  }

  async function applyApprovedHistory(draftId: number, approvedRow: DraftRow, stillActive: boolean, preserveDraft?: CampaignDraft) {
    setHistory((prev) => prev.map((row) => (
      row.id === draftId
        ? { ...approvedRow, draft: stillActive && preserveDraft ? preserveDraft : (approvedRow.draft || row.draft) }
        : row
    )));
    await refreshHistoryOnly();
  }

  async function generate() {
    if (!prompt.trim()) return;
    if (activeDraft?.id != null) {
      invalidatePendingSave(activeDraft.id);
      invalidatePendingApprove(activeDraft.id);
      clearSaveError(activeDraft.id);
      clearApproveError(activeDraft.id);
      setSaving(false);
      setApprovingDraftId((prev) => (prev === activeDraft.id ? null : prev));
    }
    setGenerating(true);
    const d = await apiPost<GenerateResp>("/api/campaign-composer/generate", { prompt });
    setGenerating(false);
    if (d.ok) {
      const warnings = d.content_safety_warnings || d.draft?.content_safety_warnings || [];
      setActiveDraft({
        ...d.draft,
        content_safety_warnings: warnings,
      });
      clearSaveError(d.draft.id);
      await refreshHistoryOnly();
    } else {
      alert(d.userMessage || d.error || "Failed to generate campaign");
    }
  }

  async function saveDraft() {
    if (!activeDraft || activeDraft.status !== 'draft') return;
    const draftId = activeDraft.id;
    const reqSeq = (saveRequestRef.current.get(draftId) || 0) + 1;
    saveRequestRef.current.set(draftId, reqSeq);
    const draftSnapshot = JSON.stringify(activeDraft.draft);

    setSaving(true);
    const d = await apiPut<GenerateResp>(`/api/campaign-composer/drafts/${draftId}`, { draft: activeDraft.draft });

    if (saveRequestRef.current.get(draftId) !== reqSeq) return;
    const current = activeDraftRef.current;
    if (!current || current.id !== draftId) return;

    setSaving(false);
    if (d.ok) {
      clearSaveError(draftId);
      const warnings = d.content_safety_warnings || d.draft?.content_safety_warnings || [];
      const userEditedDuringSave = JSON.stringify(current.draft) !== draftSnapshot;
      if (userEditedDuringSave) {
        setActiveDraft((prev) => (
          prev && prev.id === draftId
            ? {
              ...prev,
              content_safety_warnings: warnings,
              updated_at: d.draft?.updated_at || prev.updated_at,
            }
            : prev
        ));
      } else {
        setActiveDraft({
          ...d.draft,
          content_safety_warnings: warnings,
        });
      }
      await refreshHistoryOnly();
    } else {
      const code = d.error || "";
      if (code === "content_safety_blocked" || code === "content_safety_unavailable") {
        setSaveErrors((prev) => ({
          ...prev,
          [draftId]: String(d.userMessage || d.error || "Save blocked by content safety checks."),
        }));
        return;
      }
      alert(d.error || "Failed to save draft");
    }
  }

  async function approveDraft() {
    if (!activeDraft || activeDraft.status !== 'draft') return;
    if (!confirm("This will create a real audience segment. Continue?")) return;
    const draftId = activeDraft.id;
    const reqSeq = (approveRequestRef.current.get(draftId) || 0) + 1;
    approveRequestRef.current.set(draftId, reqSeq);
    const draftSnapshot = JSON.stringify(activeDraft.draft);

    setApprovingDraftId(draftId);
    const d = await apiPost<GenerateResp>(`/api/campaign-composer/drafts/${draftId}/approve`, {});

    if (approveRequestRef.current.get(draftId) !== reqSeq) return;

    setApprovingDraftId((prev) => (prev === draftId ? null : prev));

    const finishApproved = async (serverDraft: DraftRow, warnings: string[]) => {
      const current = activeDraftRef.current;
      const stillActive = current && current.id === draftId;
      const approvedRow: DraftRow = {
        ...(serverDraft || current || activeDraft!),
        status: 'approved',
        segment_id: serverDraft?.segment_id ?? d.segment_id ?? current?.segment_id ?? null,
        content_safety_warnings: warnings,
      };
      const preserveDraft = stillActive && JSON.stringify(current!.draft) !== draftSnapshot
        ? current!.draft
        : undefined;
      await applyApprovedHistory(draftId, approvedRow, !!stillActive, preserveDraft);
      if (!stillActive) return;
      if (preserveDraft) {
        setActiveDraft((prev) => (
          prev && prev.id === draftId
            ? {
              ...prev,
              status: 'approved',
              segment_id: approvedRow.segment_id,
              content_safety_warnings: warnings,
              updated_at: serverDraft?.updated_at || prev.updated_at,
            }
            : prev
        ));
      } else {
        setActiveDraft(approvedRow);
      }
      alert("Campaign approved and segment created!");
    };

    if (d.ok) {
      clearApproveError(draftId);
      const warnings = d.content_safety_warnings || d.draft?.content_safety_warnings || [];
      await finishApproved(d.draft, warnings);
      return;
    }

    const code = d.error || "";
    if (code === "already_approved" && d.draft) {
      clearApproveError(draftId);
      await finishApproved(d.draft, d.draft.content_safety_warnings || []);
      return;
    }

    const current = activeDraftRef.current;
    if (!current || current.id !== draftId) return;

    if (code === "content_safety_blocked" || code === "content_safety_unavailable") {
      setApproveErrors((prev) => ({
        ...prev,
        [draftId]: String(d.userMessage || d.error || "Approval blocked by content safety checks."),
      }));
      return;
    }
    alert(d.userMessage || d.error || "Failed to approve campaign");
  }

  const updateDraftField = (field: keyof CampaignDraft, value: any) => {
    if (!activeDraft) return;
    clearSaveError(activeDraft.id);
    clearApproveError(activeDraft.id);
    setActiveDraft({
      ...activeDraft,
      draft: { ...activeDraft.draft, [field]: value }
    });
  };

  return (
    <div style={{ padding: "8px 4px 40px", maxWidth: 1200, margin: "0 auto" }}>
      <PanelHero
        group="Reach"
        title="🪄 Prompt-to-Campaign Builder"
        subtitle="Describe the campaign in plain language and InfoGenie drafts audience rules, channel copy, and send timing."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 350px", gap: 24, alignItems: "flex-start" }}>
        {/* Main Workspace */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Prompt Box */}
          <div className="ig-card">
            <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>New Campaign Prompt</h3>
            <textarea
              className="form-control"
              rows={3}
              placeholder="e.g. Win back customers who haven't ordered in 60 days with 15% off"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={generating}
            />
            <button
              className="btn btn-primary"
              style={{ marginTop: 12, width: "100%" }}
              onClick={generate}
              disabled={generating || !prompt.trim()}
            >
              {generating ? "Generating Campaign..." : "Generate Campaign Draft"}
            </button>
          </div>

          {/* Draft Result */}
          {activeDraft && (
            <div className="ig-card" style={{ borderLeft: `4px solid ${activeDraft.status === 'draft' ? '#f59e0b' : '#10b981'}` }}>
              <ContentSafetyWarnings warnings={activeDraft.content_safety_warnings} />
              {activeSaveError ? (
                <div
                  role="alert"
                  style={{
                    background: "#FEE2E2",
                    border: "1px solid #FCA5A5",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 12,
                    fontSize: "0.85rem",
                    color: "#991B1B",
                  }}
                >
                  {activeSaveError}
                </div>
              ) : null}
              {activeApproveError ? (
                <div
                  role="alert"
                  style={{
                    background: "#FEE2E2",
                    border: "1px solid #FCA5A5",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 12,
                    fontSize: "0.85rem",
                    color: "#991B1B",
                  }}
                >
                  {activeApproveError}
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: "1.1rem", margin: 0 }}>{activeDraft.draft.campaign_name}</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  <span className={`badge ${activeDraft.status === 'draft' ? 'badge-warning' : 'badge-success'}`} style={{ 
                    backgroundColor: activeDraft.status === 'draft' ? '#f59e0b' : '#10b981',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    textTransform: 'uppercase'
                  }}>
                    {activeDraft.status}
                  </span>
                  {activeDraft.draft.source === 'openai' && (
                    <span style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 'bold' }}>✨ AI Generated</span>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div className="form-group">
                  <label>Campaign Name</label>
                  <input
                    className="form-control"
                    value={activeDraft.draft.campaign_name}
                    onChange={(e) => updateDraftField('campaign_name', e.target.value)}
                    disabled={activeDraft.status !== 'draft'}
                  />
                </div>
                <div className="form-group">
                  <label>Channel</label>
                  <select
                    className="form-control"
                    value={activeDraft.draft.channel}
                    onChange={(e) => updateDraftField('channel', e.target.value)}
                    disabled={activeDraft.status !== 'draft'}
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Audience Description</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={activeDraft.draft.audience_description}
                  onChange={(e) => updateDraftField('audience_description', e.target.value)}
                  disabled={activeDraft.status !== 'draft'}
                />
              </div>

              {activeDraft.draft.channel === 'email' && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label>Subject Line</label>
                  <input
                    className="form-control"
                    value={activeDraft.draft.subject}
                    onChange={(e) => updateDraftField('subject', e.target.value)}
                    disabled={activeDraft.status !== 'draft'}
                  />
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Message Body</label>
                <textarea
                  className="form-control"
                  rows={6}
                  value={activeDraft.draft.body}
                  onChange={(e) => updateDraftField('body', e.target.value)}
                  disabled={activeDraft.status !== 'draft'}
                />
              </div>

              <div style={{ background: "#f9fafb", padding: 12, borderRadius: 8, marginBottom: 20 }}>
                <div style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: "bold", marginBottom: 4 }}>STRATEGY RATIONALE</div>
                <div style={{ fontSize: "0.9rem", color: "#374151" }}>{activeDraft.draft.rationale}</div>
                <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: 8 }}>
                  <strong>Recommended Send:</strong> {activeDraft.draft.recommended_send_time}
                </div>
              </div>

              {activeDraft.status === 'draft' && (
                <div style={{ display: "flex", gap: 12 }}>
                  <button className="btn btn-outline" style={{ flex: 1 }} onClick={saveDraft} disabled={saving || isApprovingActive}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={approveDraft} disabled={saving || isApprovingActive}>
                    {isApprovingActive ? "Approving..." : "Approve & Create Segment"}
                  </button>
                </div>
              )}

              {activeDraft.status === 'approved' && activeDraft.segment_id && (
                <div style={{ textAlign: "center", padding: "10px", background: "#ecfdf5", color: "#047857", borderRadius: "8px", fontWeight: "bold" }}>
                  ✅ Audience segment created (ID: {activeDraft.segment_id})
                </div>
              )}
            </div>
          )}
        </div>

        {/* History Sidebar */}
        <div className="ig-card" style={{ maxHeight: "80vh", overflowY: "auto" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: 16 }}>History</h3>
          {history.length === 0 ? (
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "20px 0" }}>
              No drafts yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {history.map((row) => (
                <div
                  key={row.id}
                  onClick={() => activateDraft(row)}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${activeDraft?.id === row.id ? '#8b5cf6' : '#e5e7eb'}`,
                    background: activeDraft?.id === row.id ? '#f5f3ff' : '#fff',
                    cursor: "pointer",
                    fontSize: "0.85rem"
                  }}
                >
                  <div style={{ fontWeight: "bold", marginBottom: 4 }}>{row.draft.campaign_name || "Untitled"}</div>
                  <div style={{ color: "#6b7280", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
                    <span>{new Date(row.created_at).toLocaleDateString()}</span>
                    <span style={{ color: row.status === 'draft' ? '#f59e0b' : '#10b981' }}>{row.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
