"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

/* --- Types --- */

interface ReviewReplyDraft {
  id: number;
  platform: string;
  reviewer_name: string;
  rating: number;
  review_text: string;
  ai_draft_reply: string;
  status: 'pending' | 'approved' | 'dismissed';
  created_at: string;
}

interface ReviewRequestRule {
  id: number;
  tenant_id: number;
  name: string;
  trigger_type: string;
  channel: string;
  delay_hours: number;
  message_template: string;
  target_platform_url: string;
  active: boolean;
  created_at: string;
}

interface ReviewRequestLog {
  id: number;
  rule_id: number;
  rule_name?: string;
  contact_email: string;
  contact_phone: string;
  sent_at: string;
  status: string;
}

/* --- Main Component --- */

export default function ReviewAutomation() {
  const [activeTab, setActiveTab] = useState<'replies' | 'rules'>('replies');
  const [drafts, setDrafts] = useState<ReviewReplyDraft[]>([]);
  const [rules, setRules] = useState<ReviewRequestRule[]>([]);
  const [logs, setLogs] = useState<ReviewRequestLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states for new rule
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [newRule, setNewRule] = useState<Partial<ReviewRequestRule>>({
    name: '',
    trigger_type: 'after_purchase',
    channel: 'email',
    delay_hours: 24,
    message_template: 'Hi! How was your experience with us? Leave a review here: {{link}}',
    target_platform_url: '',
    active: true
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [draftsRes, rulesRes, logsRes] = await Promise.all([
        apiGet<{ ok: boolean, drafts: ReviewReplyDraft[] }>("/api/review-monitor/replies?status=pending"),
        apiGet<{ ok: boolean, rules: ReviewRequestRule[] }>("/api/review-monitor/request-rules"),
        apiGet<{ ok: boolean, logs: ReviewRequestLog[] }>("/api/review-monitor/request-logs")
      ]);

      if (draftsRes.ok) setDrafts(draftsRes.drafts);
      if (rulesRes.ok) setRules(rulesRes.rules);
      if (logsRes.ok) setLogs(logsRes.logs);
    } catch (err) {
      console.error("Error fetching data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleApprove = async (id: number) => {
    const res = await apiPost<{ ok: boolean }>(`/api/review-monitor/replies/${id}/approve`, {});
    if (res.ok) setDrafts(drafts.filter(d => d.id !== id));
  };

  const handleDismiss = async (id: number) => {
    const res = await apiPost<{ ok: boolean }>(`/api/review-monitor/replies/${id}/dismiss`, {});
    if (res.ok) setDrafts(drafts.filter(d => d.id !== id));
  };

  const handleRegenerate = async (draft: ReviewReplyDraft) => {
    const res = await apiPost<{ ok: boolean, draft: ReviewReplyDraft }>("/api/review-monitor/replies/generate", {
      review_text: draft.review_text,
      rating: draft.rating,
      reviewer_name: draft.reviewer_name,
      platform: draft.platform,
      source_review_id: draft.id.toString() // Or source_review_id if available
    });
    if (res.ok) {
      setDrafts(drafts.map(d => d.id === draft.id ? res.draft : d));
    }
  };

  const handleCreateRule = async () => {
    const res = await apiPost<{ ok: boolean, rule: ReviewRequestRule }>("/api/review-monitor/request-rules", newRule);
    if (res.ok) {
      setRules([res.rule, ...rules]);
      setShowRuleForm(false);
      setNewRule({
        name: '',
        trigger_type: 'after_purchase',
        channel: 'email',
        delay_hours: 24,
        message_template: 'Hi! How was your experience with us? Leave a review here: {{link}}',
        target_platform_url: '',
        active: true
      });
    }
  };

  const handleToggleRule = async (rule: ReviewRequestRule) => {
    const res = await apiPut<{ ok: boolean }>(`/api/review-monitor/request-rules/${rule.id}`, {
      ...rule,
      active: !rule.active
    });
    if (res.ok) {
      setRules(rules.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!confirm("Are you sure?")) return;
    const res = await apiDelete<{ ok: boolean }>(`/api/review-monitor/request-rules/${id}`);
    if (res.ok) setRules(rules.filter(r => r.id !== id));
  };

  const handleTestRule = async (ruleId: number) => {
    const contact = prompt("Enter test email or phone:");
    if (!contact) return;
    const res = await apiPost<{ ok: boolean, log: ReviewRequestLog }>(`/api/review-monitor/request-rules/${ruleId}/trigger`, {
      contact_email: contact.includes('@') ? contact : undefined,
      contact_phone: !contact.includes('@') ? contact : undefined,
    });
    if (res.ok) {
      setLogs([res.log, ...logs]);
      alert(`Test triggered! Status: ${res.log.status}`);
    }
  };

  return (
    <div className="review-automation-container" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0 }}>Review Automation</h1>
        <div className="btn-group">
          <button 
            className={`btn ${activeTab === 'replies' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('replies')}
          >
            AI Reply Drafts
          </button>
          <button 
            className={`btn ${activeTab === 'rules' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('rules')}
          >
            Review Request Rules
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      ) : activeTab === 'replies' ? (
        /* --- AI Reply Drafts Section --- */
        <div className="replies-section">
          <div style={{ marginBottom: '16px', color: '#666' }}>
            {drafts.length} pending replies needing approval.
          </div>
          {drafts.length === 0 ? (
            <div className="ig-card" style={{ textAlign: 'center', padding: '40px' }}>
              <h3>All caught up!</h3>
              <p>No pending review replies at the moment.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '20px' }}>
              {drafts.map(draft => (
                <div key={draft.id} className="ig-card" style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>{draft.reviewer_name}</span>
                      <span style={{ margin: '0 8px', color: '#ccc' }}>•</span>
                      <span style={{ color: '#666' }}>{draft.platform}</span>
                      <span style={{ margin: '0 8px', color: '#ccc' }}>•</span>
                      <span style={{ color: draft.rating >= 4 ? '#10b981' : draft.rating <= 2 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
                        {draft.rating}/5 Stars
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#999' }}>
                      {new Date(draft.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  
                  <div style={{ background: '#f9fafb', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.9rem', fontStyle: 'italic' }}>
                    &quot;{draft.review_text}&quot;
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#666', marginBottom: '4px', display: 'block' }}>
                      AI Suggested Reply
                    </label>
                    <textarea 
                      className="form-control"
                      value={draft.ai_draft_reply}
                      onChange={(e) => {
                        setDrafts(drafts.map(d => d.id === draft.id ? { ...d, ai_draft_reply: e.target.value } : d));
                      }}
                      rows={3}
                      style={{ fontSize: '0.9rem' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => handleApprove(draft.id)}>
                      Approve & Send
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleRegenerate(draft)}>
                      Regenerate
                    </button>
                    <button className="btn btn-outline btn-sm" style={{ color: '#ef4444' }} onClick={() => handleDismiss(draft.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* --- Review Request Rules Section --- */
        <div className="rules-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>Automation Rules</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowRuleForm(!showRuleForm)}>
              {showRuleForm ? 'Cancel' : '+ Create Rule'}
            </button>
          </div>

          {showRuleForm && (
            <div className="ig-card" style={{ marginBottom: '24px', background: '#f0f4ff' }}>
              <h4>New Review Request Rule</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className="form-group">
                  <label>Rule Name</label>
                  <input 
                    className="form-control" 
                    value={newRule.name} 
                    onChange={e => setNewRule({ ...newRule, name: e.target.value })}
                    placeholder="e.g. Post-Purchase Feedback"
                  />
                </div>
                <div className="form-group">
                  <label>Trigger</label>
                  <select 
                    className="form-control"
                    value={newRule.trigger_type}
                    onChange={e => setNewRule({ ...newRule, trigger_type: e.target.value })}
                  >
                    <option value="after_purchase">After Purchase</option>
                    <option value="after_support_ticket">After Support Ticket</option>
                    <option value="manual">Manual Trigger Only</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Channel</label>
                  <select 
                    className="form-control"
                    value={newRule.channel}
                    onChange={e => setNewRule({ ...newRule, channel: e.target.value })}
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Delay (Hours)</label>
                  <input 
                    type="number"
                    className="form-control" 
                    value={newRule.delay_hours} 
                    onChange={e => setNewRule({ ...newRule, delay_hours: parseInt(e.target.value) })}
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Message Template (use {"{{link}}"} for review URL)</label>
                <textarea 
                  className="form-control" 
                  rows={3}
                  value={newRule.message_template}
                  onChange={e => setNewRule({ ...newRule, message_template: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Target Platform URL</label>
                <input 
                  className="form-control" 
                  value={newRule.target_platform_url}
                  onChange={e => setNewRule({ ...newRule, target_platform_url: e.target.value })}
                  placeholder="https://g.page/your-business/review"
                />
              </div>
              <button className="btn btn-primary" onClick={handleCreateRule}>Save Rule</button>
            </div>
          )}

          <div style={{ display: 'grid', gap: '16px', marginBottom: '32px' }}>
            {rules.map(rule => (
              <div key={rule.id} className="ig-card" style={{ opacity: rule.active ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0' }}>{rule.name}</h4>
                    <div style={{ fontSize: '0.85rem', color: '#666' }}>
                      Sends via {rule.channel} {rule.delay_hours}h after {rule.trigger_type.replace('_', ' ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => handleTestRule(rule.id)}>Test Send</button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleToggleRule(rule)}>
                      {rule.active ? 'Disable' : 'Enable'}
                    </button>
                    <button className="btn btn-outline btn-sm" style={{ color: '#ef4444' }} onClick={() => handleDeleteRule(rule.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
            {rules.length === 0 && !showRuleForm && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>No rules created yet.</div>
            )}
          </div>

          <h3>Recent Send Logs</h3>
          <div className="ig-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Rule</th>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Contact</th>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Sent At</th>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '12px' }}>{log.rule_name || `Rule #${log.rule_id}`}</td>
                    <td style={{ padding: '12px' }}>{log.contact_email || log.contact_phone}</td>
                    <td style={{ padding: '12px' }}>{new Date(log.sent_at).toLocaleString()}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ 
                        padding: '2px 8px', 
                        borderRadius: '4px', 
                        fontSize: '0.75rem', 
                        fontWeight: 700,
                        background: log.status === 'sent' ? '#dcfce7' : '#f3f4f6',
                        color: log.status === 'sent' ? '#166534' : '#666'
                      }}>
                        {log.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '20px', color: '#666' }}>No logs yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
