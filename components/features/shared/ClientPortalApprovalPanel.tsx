"use client";

import { useState } from "react";
import { responseError } from "@/lib/clientReporting";
import {
  approvalErrorMessage, approvePortalRequest, requestPortalChanges,
} from "@/lib/clientReportingApprovals";
import type { ApprovalBinding } from "@/lib/clientReportingReport";

const card = { marginTop: 32, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#F8FAFC" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };
const danger = { ...button, background: "#B45309" };

type Props = {
  binding: ApprovalBinding | null;
  onDecision?: () => void;
};

export default function ClientPortalApprovalPanel({ binding, onDecision }: Props) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);

  async function approve() {
    if (!binding) return;
    setActing(true); setError(null); setNotice(null);
    try {
      const result = await approvePortalRequest(binding);
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        return;
      }
      setConfirmApprove(false);
      setNotice("Report approved. Your agency has been notified in the audit log.");
      onDecision?.();
    } finally {
      setActing(false);
    }
  }

  async function submitChanges() {
    if (!binding || !comment.trim()) return;
    setActing(true); setError(null); setNotice(null);
    try {
      const result = await requestPortalChanges(binding, comment);
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        return;
      }
      setComment("");
      setNotice("Change request submitted. Your agency can revise and resubmit.");
      onDecision?.();
    } finally {
      setActing(false);
    }
  }

  if (!binding && !notice && !error) return null;

  return <section aria-label="Report approval" style={card}>
    <h2>Report approval</h2>
    <p style={{ color: "#64748B" }}>
      Decisions are recorded as &ldquo;Client via portal link&rdquo; — this portal uses a shared invitation link, not a verified named person.
      Approval does not authorize campaign publishing or spending.
    </p>
    {error && <p role="alert" style={{ color: "#991B1B" }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {binding && <>
      <p><strong>Pending client approval</strong> — submission bound to request #{binding.request_id}</p>
      <p style={{ fontSize: 14, color: "#64748B" }}>The report above is the exact snapshot under review.</p>
      {!confirmApprove ? <button style={button} disabled={acting} onClick={() => setConfirmApprove(true)}>Approve report</button>
        : <div role="dialog" aria-label="Confirm approval" style={{ marginTop: 12, padding: 16, background: "#FFFFFF", borderRadius: 8 }}>
          <p>Approve this report snapshot as submitted?</p>
          <p style={{ fontSize: 14, color: "#64748B" }}>This confirms the displayed values. It does not publish campaigns or authorize spending.</p>
          <button style={button} disabled={acting} onClick={() => void approve()}>Confirm approval</button>
          <button style={button} disabled={acting} onClick={() => setConfirmApprove(false)}>Cancel</button>
        </div>}
      <form style={{ marginTop: 16 }} onSubmit={(event) => {
        event.preventDefault();
        void submitChanges();
      }}>
        <label style={{ display: "grid", gap: 6 }}>
          Request changes (required comment)
          <textarea required maxLength={4000} value={comment} onChange={(event) => setComment(event.target.value)}
            rows={4} style={{ border: "1px solid #94A3B8", borderRadius: 6, padding: 9, width: "100%", boxSizing: "border-box" }} />
        </label>
        <button type="submit" style={danger} disabled={acting || !comment.trim()}>{acting ? "Sending…" : "Submit change request"}</button>
      </form>
    </>}
  </section>;
}
