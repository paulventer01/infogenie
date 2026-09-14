"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPortalFeedback, fetchPortalFeedback, replyPortalFeedback,
  reportContextFromPreview, type FeedbackThread, type ReportContext,
} from "@/lib/clientReportingFeedback";
import { responseError } from "@/lib/clientReporting";
import type { Preview } from "@/lib/clientReportingReport";

type Props = { preview: Preview };

const card = { marginTop: 32, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#F8FAFC" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };

function ThreadCard({ thread, onReply }: { thread: FeedbackThread; onReply: (threadId: number, body: string) => Promise<void> }) {
  const [reply, setReply] = useState("");
  const [acting, setActing] = useState(false);
  const label = thread.kind === "change_request" ? "Change request" : "Comment";
  return <article style={{ marginTop: 16, padding: 16, border: "1px solid #CBD5E1", borderRadius: 8, background: "#FFFFFF" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <strong>{label}</strong>
      <span style={{ color: "#64748B", fontSize: 13 }}>
        Profile v{thread.profile_version} · {thread.reporting_period}
        {thread.period_start ? ` · ${thread.period_start} to ${thread.period_end}` : ""}
        {thread.kind === "change_request" ? ` · ${thread.status}` : ""}
      </span>
    </header>
    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
      {thread.messages.map((message) => <div key={message.id} style={{ padding: 10, background: "#F8FAFC", borderRadius: 6 }}>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message.body}</p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748B" }}>
          {message.author_type === "agency" ? "Agency" : "You"} · {message.created_at}
        </p>
      </div>)}
    </div>
    {thread.status === "open" && <form style={{ marginTop: 12 }} onSubmit={(event) => {
      event.preventDefault();
      if (!reply.trim()) return;
      setActing(true);
      void onReply(thread.id, reply).finally(() => { setReply(""); setActing(false); });
    }}>
      <label style={{ display: "grid", gap: 6 }}>
        Reply
        <textarea required maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)}
          rows={3} style={{ border: "1px solid #94A3B8", borderRadius: 6, padding: 9, width: "100%", boxSizing: "border-box" }} />
      </label>
      <button type="submit" style={button} disabled={acting}>{acting ? "Sending…" : "Send reply"}</button>
    </form>}
  </article>;
}

export default function ClientPortalFeedbackPanel({ preview }: Props) {
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"comment" | "change_request">("comment");
  const context = reportContextFromPreview(preview);
  const live = useRef(true);

  const load = useCallback(async (ctx: ReportContext) => {
    setBusy(true); setError(null);
    try {
      const result = await fetchPortalFeedback(ctx);
      if (!live.current) return;
      const failure = responseError(result);
      if (failure) {
        setError(failure === "report_context_stale" ? "This report changed while you were writing. Reload and try again."
          : "Comments could not be loaded.");
        setThreads([]);
        return;
      }
      setThreads(Array.isArray(result.threads) ? result.threads : []);
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load(context);
    return () => { live.current = false; };
  }, [load, context.profile_version, context.reporting_period, context.timezone, context.start_date, context.end_date]);

  async function submitThread() {
    setActing(true); setError(null);
    try {
      const result = await createPortalFeedback(kind, body, context);
      const failure = responseError(result);
      if (failure) {
        setError(failure === "report_context_stale" ? "This report changed while you were writing. Reload and try again."
          : "Your message could not be sent.");
        return;
      }
      setBody("");
      await load(context);
    } finally {
      setActing(false);
    }
  }

  async function submitReply(threadId: number, text: string) {
    const result = await replyPortalFeedback(threadId, text);
    const failure = responseError(result);
    if (failure) throw new Error(failure);
    await load(context);
  }

  return <section aria-label="Report feedback" style={card}>
    <h2>Comments and change requests</h2>
    <p style={{ color: "#64748B" }}>Feedback is tied to this report snapshot (profile v{preview.profile_version}, {preview.reporting_period}).</p>
    {busy && <p role="status">Loading feedback…</p>}
    {error && <p role="alert" style={{ color: "#991B1B" }}>{error}</p>}
    {!busy && <>
      <form onSubmit={(event) => { event.preventDefault(); void submitThread(); }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <label><input type="radio" name="feedback-kind" value="comment" checked={kind === "comment"} onChange={() => setKind("comment")} /> Comment</label>
          <label><input type="radio" name="feedback-kind" value="change_request" checked={kind === "change_request"} onChange={() => setKind("change_request")} /> Request a change</label>
        </div>
        <label style={{ display: "grid", gap: 6 }}>
          Message
          <textarea required maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)}
            rows={4} style={{ border: "1px solid #94A3B8", borderRadius: 6, padding: 9, width: "100%", boxSizing: "border-box" }} />
        </label>
        <button type="submit" style={button} disabled={acting || !body.trim()}>{acting ? "Sending…" : "Submit"}</button>
      </form>
      {!threads.length ? <p>No comments or change requests yet for this report snapshot.</p>
        : threads.map((thread) => <ThreadCard key={thread.id} thread={thread} onReply={submitReply} />)}
    </>}
  </section>;
}
