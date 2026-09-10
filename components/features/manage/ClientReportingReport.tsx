"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBlob, apiGet, apiPost } from "@/lib/api";
import { API, accessLost, responseError, validClient, validProfile, type Draft, type ProfileResponse } from "@/lib/clientReporting";
import { validRecipient, type RecipientResponse } from "@/lib/clientReportingDelivery";
import { validPreview, validReportBlob, type Preview } from "@/lib/clientReportingReport";

type Props = { clientId: number; version: number; format: Draft["default_format"]; checkAccess: () => Promise<boolean>; clearContext: (message: string) => void };
export default function ClientReportingReport({ clientId, version, format, checkAccess, clearContext }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<RecipientResponse | null>(null);
  const live = useRef(false), running = useRef(false), sequence = useRef(0);
  const stop = useCallback(() => { live.current = false; ++sequence.current; }, []);
  useEffect(() => { live.current = true; return stop; }, [stop]);
  async function verify(current: () => boolean) {
    if (!await checkAccess() || !current()) throw new Error("Access could not be verified. Preview again before generating.");
    const result = await apiGet<ProfileResponse>(`${API}/${clientId}/profile`);
    if (!current()) return false;
    const failure = responseError(result);
    if (failure && accessLost(failure)) clearContext(failure);
    if (failure || !validClient(result.client) || result.client.id !== clientId || !result.configured
      || !validProfile(result.profile, clientId) || result.profile.version !== version || result.profile.default_format !== format) {
      throw new Error("The client or saved profile changed. Reload the profile before previewing again.");
    }
    if (!await checkAccess() || !current()) throw new Error("Access could not be verified. Preview again before generating.");
    return true;
  }
  async function perform(download: boolean) {
    if (running.current || !live.current || download && !preview?.can_generate) return;
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    running.current = true; setBusy(true); setError(null); setNotice(null);
    if (!download) setPreview(null);
    try {
      if (!await verify(current) || !current()) return;
      if (download) {
        const blob = await apiBlob(`${API}/${clientId}/report`, { method: "POST", body: JSON.stringify({ expected_version: version }) });
        if (!current()) return;
        if (!await validReportBlob(blob, format)) throw new Error("The downloaded report could not be verified. Preview again before retrying.");
        if (!await verify(current) || !current()) return;
        const url = URL.createObjectURL(blob), anchor = document.createElement("a");
        try { anchor.href = url; anchor.download = `client-${clientId}-report.${format}`; document.body.appendChild(anchor); anchor.click(); }
        finally { anchor.remove(); URL.revokeObjectURL(url); }
        setNotice("Report download started.");
      } else {
        const result = await apiGet<Preview>(`${API}/${clientId}/report-preview`);
        if (!current()) return;
        const failure = responseError(result);
        if (failure && accessLost(failure)) clearContext(failure);
        if (failure || !validPreview(result, clientId, version, format)) throw new Error(failure || "The preview could not be verified. Try previewing again.");
        if (!await verify(current) || !current()) return;
        setPreview(result);
      }
    } catch (e) {
      if (current()) {
        const message = e instanceof Error ? e.message : "Report request failed. Preview again before retrying.";
        if (accessLost(message)) clearContext(message);
        setPreview(null); setError(message);
      }
    } finally { if (current()) { running.current = false; setBusy(false); } }
  }
  async function prepareEmail() {
    if (running.current || !live.current || !preview?.can_generate) return;
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    running.current = true; setBusy(true); setError(null); setNotice(null); setConfirm(null);
    try {
      if (!await verify(current) || !current()) return;
      const result = await apiGet<RecipientResponse>(`${API}/${clientId}/report-recipient`);
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validRecipient(result, clientId, version, format)) {
        throw new Error(failure === "no_recipient"
          ? "No active delivery recipient is configured for this client. Add or enable one above before emailing."
          : failure || "The delivery recipient could not be verified. Preview again before emailing.");
      }
      if (!await verify(current) || !current()) return;
      setConfirm(result);
    } catch (e) {
      if (current()) {
        const message = e instanceof Error ? e.message : "Email delivery could not be prepared. Preview again before retrying.";
        if (accessLost(message)) clearContext(message);
        setError(message);
      }
    } finally { if (current()) { running.current = false; setBusy(false); } }
  }
  async function sendEmail() {
    if (running.current || !live.current || !confirm) return;
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    running.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      if (!await verify(current) || !current()) return;
      const result = await apiPost(`${API}/${clientId}/report-email`, { expected_version: version, confirm: true });
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure) throw new Error(failure === "mail_failed"
        ? "The report could not be emailed. Check mail configuration and try again."
        : failure === "no_recipient"
          ? "The delivery recipient is missing or deactivated. Reload the recipient and try again."
          : failure);
      if (!await verify(current) || !current()) return;
      setConfirm(null); setNotice(`Report emailed to ${confirm.recipient.email}.`);
    } catch (e) {
      if (current()) {
        const message = e instanceof Error ? e.message : "Email delivery failed. Preview again before retrying.";
        if (accessLost(message)) clearContext(message);
        setError(message); setConfirm(null);
      }
    } finally { if (current()) { running.current = false; setBusy(false); } }
  }
  return <section aria-label="Client report preview" style={{ marginTop: 20, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFFFFF", minWidth: 0 }}>
    <h2>Preview and generate a client report</h2>
    <p>Uses this client&apos;s saved profile and mapped records. Generate downloads a fresh snapshot, so values may differ from the preview. Email sends to the configured delivery recipient.</p>
    <button disabled={busy} onClick={() => void perform(false)}>Preview report</button>{" "}
    <button disabled={busy || !preview?.can_generate} onClick={() => void perform(true)}>Generate &amp; download {format.toUpperCase()}</button>{" "}
    <button disabled={busy || !preview?.can_generate} onClick={() => void prepareEmail()}>Email report</button>
    {busy && <p role="status">Verifying access and preparing the report…</p>}
    {confirm && !busy && <div role="dialog" aria-label="Confirm email delivery" style={{ marginTop: 16, padding: 16, border: "1px solid #CBD5E1", borderRadius: 8, background: "#F8FAFC" }}>
      <p>Email the current {format.toUpperCase()} report to <strong>{confirm.recipient.email}</strong>?</p>
      <p style={{ color: "#64748B", fontSize: 14 }}>Uses the saved delivery recipient and profile version {version}.</p>
      <button disabled={busy} onClick={() => void sendEmail()}>Confirm email</button>{" "}
      <button disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
    </div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && !busy && <article style={{ borderTop: `4px solid ${preview.brand.primaryColor || "#0F766E"}`, color: preview.brand.textColor || "#0F172A", marginTop: 16, overflowWrap: "anywhere" }}>
      {preview.brand.agencyName && <p>{preview.brand.agencyName}</p>}
      <h3>{preview.report.title}</h3><p>Snapshot: {preview.report.generated_at}</p>
      {!preview.can_generate && <p>No mapped records are available. Assign records to this client, then preview again.</p>}
      {preview.report.sections.map((section, i) => <div key={i}><h4>{section.title}</h4>
        {!section.rows.length ? <p>No data available for this section.</p> : <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label={section.title}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr>{section.headers.map((header, j) => <th key={j} scope="col" style={{ textAlign: "left", padding: 8 }}>{header}</th>)}</tr></thead>
            <tbody>{section.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k} style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{cell === null ? "—" : cell}</td>)}</tr>)}</tbody></table>
        </div>}</div>)}
      {preview.brand.footerText && <p>{preview.brand.footerText}</p>}
    </article>}
  </section>;
}
