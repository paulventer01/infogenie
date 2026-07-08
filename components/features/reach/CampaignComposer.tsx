"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";

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
  error?: string;
}

export default function CampaignComposer() {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<DraftRow[]>([]);
  const [activeDraft, setActiveDraft] = useState<DraftRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const d = await apiGet<DraftsResp>("/api/campaign-composer/drafts");
    if (d.ok) setHistory(d.drafts);
  }

  async function generate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    const d = await apiPost<GenerateResp>("/api/campaign-composer/generate", { prompt });
    setGenerating(false);
    if (d.ok) {
      setActiveDraft(d.draft);
      loadHistory();
    } else {
      alert(d.error || "Failed to generate campaign");
    }
  }

  async function saveDraft() {
    if (!activeDraft || activeDraft.status !== 'draft') return;
    setSaving(true);
    const d = await apiPut<GenerateResp>(`/api/campaign-composer/drafts/${activeDraft.id}`, { draft: activeDraft.draft });
    setSaving(false);
    if (d.ok) {
      setActiveDraft(d.draft);
      loadHistory();
    } else {
      alert(d.error || "Failed to save draft");
    }
  }

  async function approveDraft() {
    if (!activeDraft || activeDraft.status !== 'draft') return;
    if (!confirm("This will create a real audience segment. Continue?")) return;
    setSaving(true);
    const d = await apiPost<GenerateResp>(`/api/campaign-composer/drafts/${activeDraft.id}/approve`, {});
    setSaving(true);
    if (d.ok) {
      setActiveDraft(d.draft);
      loadHistory();
      alert("Campaign approved and segment created!");
    } else {
      alert(d.error || "Failed to approve campaign");
    }
  }

  const updateDraftField = (field: keyof CampaignDraft, value: any) => {
    if (!activeDraft) return;
    setActiveDraft({
      ...activeDraft,
      draft: { ...activeDraft.draft, [field]: value }
    });
  };

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Prompt-to-Campaign Builder</h2>
      </div>

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
                  <button className="btn btn-outline" style={{ flex: 1 }} onClick={saveDraft} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={approveDraft} disabled={saving}>
                    {saving ? "Approving..." : "Approve & Create Segment"}
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
                  onClick={() => setActiveDraft(row)}
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
