"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { API, accessLost, responseError } from "@/lib/clientReporting";
import {
  feedbackErrorMessage, fetchAdminFeedback, replyAdminFeedback, resolveAdminFeedback, type FeedbackThread,
} from "@/lib/clientReportingFeedback";

type Props = { clientId: number; checkAccess: () => Promise<boolean>; clearContext: (message: string) => void };

const card = { marginTop: 20, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFFFFF" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };

function ThreadRow({ thread, onReply, onResolve }: {
  thread: FeedbackThread;
  onReply: (threadId: number, body: string) => Promise<void>;
  onResolve: (threadId: number) => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = thread.kind === "change_request" ? "Change request" : "Comment";

  async function submitReply() {
    if (!reply.trim()) return;
    setActing(true);
    setError(null);
    try {
      await onReply(thread.id, reply);
      setReply("");
    } catch (e) {
      setError(e instanceof Error ? e.message : feedbackErrorMessage("internal_error"));
    } finally {
      setActing(false);
    }
  }

  async function submitResolve() {
    setActing(true);
    setError(null);
    try {
      await onResolve(thread.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : feedbackErrorMessage("internal_error"));
    } finally {
      setActing(false);
    }
  }

  return <article style={{ marginTop: 16, padding: 16, border: "1px solid #CBD5E1", borderRadius: 8 }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <strong>{label} #{thread.id}</strong>
      <span style={{ color: "#64748B", fontSize: 13 }}>
        v{thread.profile_version} · {thread.reporting_period}
        {thread.period_start ? ` · ${thread.period_start} to ${thread.period_end}` : ""}
        {thread.kind === "change_request" ? ` · ${thread.status}` : ""}
      </span>
    </header>
    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
      {thread.messages.map((message) => <div key={message.id} style={{ padding: 10, background: "#F8FAFC", borderRadius: 6 }}>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message.body}</p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748B" }}>
          {message.author_type === "agency" ? "Agency" : "Client"} · {message.created_at}
        </p>
      </div>)}
    </div>
    {error && <p role="alert" style={{ color: "#991B1B", marginTop: 12 }}>{error}</p>}
    {thread.kind === "change_request" && thread.status === "open" && <button type="button" style={{ ...button, background: "#1D4ED8" }}
      disabled={acting} onClick={() => void submitResolve()}>
      Mark resolved
    </button>}
    <form style={{ marginTop: 12 }} onSubmit={(event) => {
      event.preventDefault();
      void submitReply();
    }}>
      <label style={{ display: "grid", gap: 6 }}>
        Agency reply
        <textarea required maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)}
          rows={3} style={{ border: "1px solid #94A3B8", borderRadius: 6, padding: 9, width: "100%", boxSizing: "border-box" }} />
      </label>
      <button type="submit" style={button} disabled={acting}>{acting ? "Sending…" : "Send reply"}</button>
    </form>
  </article>;
}

export default function ClientReportingPortalFeedback({ clientId, checkAccess, clearContext }: Props) {
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false), sequence = useRef(0);

  const load = useCallback(async () => {
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setBusy(true); setError(null);
    try {
      if (!await checkAccess() || !current()) return;
      const gate = await apiGet(`${API}/${clientId}/portal`);
      const gateFailure = responseError(gate);
      if (gateFailure && accessLost(gateFailure)) clearContext(gateFailure);
      if (!current()) return;
      const result = await fetchAdminFeedback(clientId);
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure) throw new Error(feedbackErrorMessage(failure));
      setThreads(Array.isArray(result.threads) ? result.threads : []);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Portal feedback could not be loaded.");
    } finally {
      if (current()) setBusy(false);
    }
  }, [checkAccess, clearContext, clientId]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; ++sequence.current; };
  }, [load]);

  async function submitReply(threadId: number, body: string) {
    const result = await replyAdminFeedback(clientId, threadId, body);
    const failure = responseError(result);
    if (failure && accessLost(failure)) clearContext(failure);
    if (failure) throw new Error(feedbackErrorMessage(failure));
    await load();
  }

  async function submitResolve(threadId: number) {
    const result = await resolveAdminFeedback(clientId, threadId);
    const failure = responseError(result);
    if (failure && accessLost(failure)) clearContext(failure);
    if (failure) throw new Error(feedbackErrorMessage(failure));
    await load();
  }

  const openRequests = threads.filter((thread) => thread.kind === "change_request" && thread.status === "open").length;

  return <section aria-label="Client portal feedback" style={card}>
    <h2>Portal comments and change requests</h2>
    <p>Review client feedback tied to specific report snapshots. Reply in plain text or resolve open change requests.</p>
    {busy && <p role="status">Loading portal feedback…</p>}
    {!busy && <p>Open change requests: {openRequests}</p>}
    {error && <p role="alert" style={{ color: "#991B1B" }}>{error}</p>}
    {!busy && !threads.length && <p>No portal feedback yet.</p>}
    {!busy && threads.map((thread) => <ThreadRow key={thread.id} thread={thread} onReply={submitReply} onResolve={submitResolve} />)}
  </section>;
}
