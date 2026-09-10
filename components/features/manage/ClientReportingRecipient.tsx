"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPut } from "@/lib/api";
import { API, accessLost, responseError } from "@/lib/clientReporting";
import { recipientDraftError, validRecipientResponse, type RecipientDraft, type RecipientResponse } from "@/lib/clientReportingRecipient";

type Props = { clientId: number; checkAccess: () => Promise<boolean>; clearContext: (message: string) => void };
const card = { marginTop: 20, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFFFFF" };
const input = { border: "1px solid #94A3B8", borderRadius: 6, padding: 9, width: "100%", boxSizing: "border-box" as const, background: "#FFFFFF", color: "#0F172A" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };

export default function ClientReportingRecipient({ clientId, checkAccess, clearContext }: Props) {
  const [draft, setDraft] = useState<RecipientDraft>({ email: "", enabled: true });
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const live = useRef(false), sequence = useRef(0);
  const stop = useCallback(() => { live.current = false; ++sequence.current; }, []);
  useEffect(() => { live.current = true; return stop; }, [stop, clientId]);
  const load = useCallback(async () => {
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiGet<RecipientResponse>(`${API}/${clientId}/recipient`);
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validRecipientResponse(result, clientId)) throw new Error(failure || "The delivery recipient could not be loaded.");
      if (!await checkAccess() || !current()) return;
      setConfigured(result.configured);
      setDraft(result.recipient ? { email: result.recipient.email, enabled: result.recipient.enabled } : { email: "", enabled: true });
      setDirty(false);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "The delivery recipient could not be loaded.");
    } finally { if (current()) setBusy(false); }
  }, [checkAccess, clearContext, clientId]);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    const issue = recipientDraftError(draft);
    if (issue) { setError(issue); return; }
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (!await checkAccess() || !current()) return;
      const payload = { email: draft.email.trim().toLowerCase(), enabled: draft.enabled };
      const result = await apiPut<RecipientResponse>(`${API}/${clientId}/recipient`, payload);
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validRecipientResponse(result, clientId) || !result.recipient) throw new Error(failure || "The delivery recipient could not be saved.");
      if (!await checkAccess() || !current()) return;
      setConfigured(true);
      setDraft({ email: result.recipient.email, enabled: result.recipient.enabled });
      setDirty(false); setNotice(result.recipient.enabled ? "Delivery recipient saved." : "Delivery recipient saved and deactivated.");
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "The delivery recipient could not be saved.");
    } finally { if (current()) setSaving(false); }
  }
  return <section aria-label="Client report delivery recipient" style={card}>
    <h2>Report email recipient</h2>
    <p>Set the client email address used when you explicitly email a generated report. Deactivate delivery to block sends without deleting the saved address.</p>
    {busy && <p role="status">Loading delivery recipient…</p>}
    {!busy && <form aria-label="Delivery recipient" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        Recipient email
        <input name="recipient_email" type="email" maxLength={240} style={input} value={draft.email}
          onChange={(event) => { setDraft((previous) => ({ ...previous, email: event.target.value })); setDirty(true); setNotice(null); }} />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input name="recipient_enabled" type="checkbox" checked={draft.enabled}
          onChange={(event) => { setDraft((previous) => ({ ...previous, enabled: event.target.checked })); setDirty(true); setNotice(null); }} />
        Enable email delivery for this client
      </label>
      <button type="submit" style={button} disabled={saving || !dirty}>{saving ? "Saving…" : configured ? "Save recipient" : "Add recipient"}</button>
      <button type="button" style={button} disabled={saving || busy} onClick={() => void load()}>Reload recipient</button>
    </form>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!busy && configured && !draft.enabled && <p role="status">Email delivery is deactivated for this client.</p>}
  </section>;
}
