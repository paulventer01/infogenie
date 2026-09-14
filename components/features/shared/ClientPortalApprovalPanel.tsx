"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { responseError } from "@/lib/clientReporting";
import {
  approvalErrorMessage, approvalStatusLabel, approvePortalRequest, fetchPortalPendingApproval,
  requestPortalChanges, type ApprovalRequest,
} from "@/lib/clientReportingApprovals";

const card = { marginTop: 32, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#F8FAFC" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };
const danger = { ...button, background: "#B45309" };

type Props = {
  onDecision?: () => void;
};

export default function ClientPortalApprovalPanel({ onDecision }: Props) {
  const [pending, setPending] = useState<ApprovalRequest | null>(null);
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const live = useRef(true);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const result = await fetchPortalPendingApproval();
      if (!live.current) return;
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        setPending(null);
        return;
      }
      setPending(result.pending || null);
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; };
  }, [load]);

  async function approve() {
    if (!pending) return;
    setActing(true); setError(null); setNotice(null);
    try {
      const result = await approvePortalRequest(pending.id);
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        return;
      }
      setConfirmApprove(false);
      setNotice("Report approved. Your agency has been notified in the audit log.");
      setPending(null);
      onDecision?.();
    } finally {
      if (live.current) setActing(false);
    }
  }

  async function submitChanges() {
    if (!pending || !comment.trim()) return;
    setActing(true); setError(null); setNotice(null);
    try {
      const result = await requestPortalChanges(pending.id, comment);
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        return;
      }
      setComment("");
      setNotice("Change request submitted. Your agency can revise and resubmit.");
      setPending(null);
      onDecision?.();
    } finally {
      if (live.current) setActing(false);
    }
  }

  if (!busy && !pending && !notice && !error) return null;

  return <section aria-label="Report approval" style={card}>
    <h2>Report approval</h2>
    <p style={{ color: "#64748B" }}>
      Decisions are recorded as &ldquo;Client via portal link&rdquo; — this portal uses a shared invitation link, not a verified named person.
      Approval does not authorize campaign publishing or spending.
    </p>
    {busy && <p role="status">Loading approval status…</p>}
    {error && <p role="alert" style={{ color: "#991B1B" }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && !busy && <>
      <p><strong>{approvalStatusLabel(pending.status)}</strong> — submission #{pending.snapshot.submission_number}
        (profile v{pending.snapshot.profile_version})</p>
      <p style={{ fontSize: 14, color: "#64748B" }}>Submitted {pending.submitted_at}. The report above is the exact snapshot under review.</p>
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
      </form>}
    </>}
  </section>;
}
