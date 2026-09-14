"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { responseError } from "@/lib/clientReporting";
import {
  approvalErrorMessage, approvalStatusLabel, decisionActorLabel, fetchAdminApprovals,
  submitAdminApproval, withdrawAdminApproval, type ApprovalRequest,
} from "@/lib/clientReportingApprovals";

type Props = {
  clientId: number;
  version: number;
  canSubmit: boolean;
  contentHash: string | null;
  checkAccess: () => Promise<boolean>;
};

const card = { marginTop: 20, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFFFFF" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };

function HistoryRow({ request }: { request: ApprovalRequest }) {
  return <tr>
    <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>#{request.snapshot.submission_number}</td>
    <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{approvalStatusLabel(request.status)}</td>
    <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{request.submitted_at}</td>
    <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>
      {request.decided_at ? `${request.decided_at} · ${decisionActorLabel(request.decision_actor_type)}` : "—"}
    </td>
    <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>
      {request.decision_comment || "—"}
    </td>
  </tr>;
}

export default function ClientReportingApprovals({ clientId, version, canSubmit, contentHash, checkAccess }: Props) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [pending, setPending] = useState<ApprovalRequest | null>(null);
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const result = await fetchAdminApprovals(clientId);
      if (!live.current) return;
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        setRequests([]);
        setPending(null);
        return;
      }
      setRequests(Array.isArray(result.requests) ? result.requests : []);
      setPending(result.pending || null);
    } finally {
      if (live.current) setBusy(false);
    }
  }, [clientId]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; };
  }, [load, version]);

  async function submit() {
    if (!contentHash) return;
    setActing(true); setError(null); setNotice(null);
    try {
      if (!await checkAccess()) return;
      const result = await submitAdminApproval(clientId, contentHash);
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        return;
      }
      if (!live.current) return;
      setNotice("Report submitted for client approval.");
      await load();
    } finally {
      if (live.current) setActing(false);
    }
  }

  async function withdraw() {
    if (!pending) return;
    setActing(true); setError(null); setNotice(null);
    try {
      if (!await checkAccess()) return;
      const result = await withdrawAdminApproval(clientId, pending.id);
      const failure = responseError(result);
      if (failure) {
        setError(approvalErrorMessage(failure));
        return;
      }
      setNotice("Pending approval withdrawn.");
      await load();
    } finally {
      if (live.current) setActing(false);
    }
  }

  return <section aria-label="Client report approvals" style={card}>
    <h2>Client report approvals</h2>
    <p style={{ color: "#64748B" }}>
      Submit the displayed report snapshot for client approval. Portal clients approve or request changes via their invitation link.
      Resolving feedback threads does not count as approval.
    </p>
    {busy && <p role="status">Loading approval history…</p>}
    {error && <p role="alert" style={{ color: "#991B1B" }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!busy && <>
      {pending ? <div style={{ marginTop: 12, padding: 12, background: "#FEF3C7", borderRadius: 8 }}>
        <p><strong>{approvalStatusLabel(pending.status)}</strong> — submission #{pending.snapshot.submission_number}
          (profile v{pending.snapshot.profile_version})</p>
        <p style={{ fontSize: 14, color: "#64748B" }}>Submitted {pending.submitted_at}</p>
        <button style={button} disabled={acting} onClick={() => void withdraw()}>Withdraw pending request</button>
      </div> : <button style={button} disabled={acting || !canSubmit || !contentHash} onClick={() => void submit()}>
        Submit displayed report for approval
      </button>}
      {!requests.length ? <p style={{ marginTop: 16 }}>No approval submissions yet.</p> : <div style={{ marginTop: 16, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            {["Submission", "Status", "Submitted", "Decision", "Comment"].map((header) => (
              <th key={header} scope="col" style={{ textAlign: "left", padding: 8 }}>{header}</th>
            ))}
          </tr></thead>
          <tbody>{requests.map((request) => <HistoryRow key={request.id} request={request} />)}</tbody>
        </table>
      </div>}
    </>}
  </section>;
}
