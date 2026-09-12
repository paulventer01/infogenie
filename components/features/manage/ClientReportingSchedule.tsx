"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { API, accessLost, responseError, type Draft } from "@/lib/clientReporting";
import {
  defaultTimezone, normalizeDeliveryHistory, scheduleDraft, scheduleDraftError, validDeliveryHistory, validScheduleResponse,
  type DeliveryRow, type ScheduleDraft, type ScheduleResponse,
} from "@/lib/clientReportingSchedule";

type Props = {
  clientId: number;
  defaultFormat: Draft["default_format"];
  checkAccess: () => Promise<boolean>;
  clearContext: (message: string) => void;
};

const card = { marginTop: 20, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFFFFF" };
const input = { border: "1px solid #94A3B8", borderRadius: 6, padding: 9, width: "100%", boxSizing: "border-box" as const, background: "#FFFFFF", color: "#0F172A" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };

export default function ClientReportingSchedule({ clientId, defaultFormat, checkAccess, clearContext }: Props) {
  const [draft, setDraft] = useState<ScheduleDraft>(scheduleDraft(defaultFormat));
  const [configured, setConfigured] = useState(false);
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState<DeliveryRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const live = useRef(false), sequence = useRef(0);
  const stop = useCallback(() => { live.current = false; ++sequence.current; }, []);

  const loadHistory = useCallback(async (current: () => boolean) => {
    const result = await apiGet(`${API}/${clientId}/delivery-history?limit=10`);
    if (!current()) return;
    const failure = responseError(result);
    if (failure && accessLost(failure)) clearContext(failure);
    if (!failure && validDeliveryHistory(result, clientId)) setHistory(normalizeDeliveryHistory(result.deliveries));
  }, [clearContext, clientId]);

  const load = useCallback(async () => {
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiGet<ScheduleResponse>(`${API}/${clientId}/schedule`);
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validScheduleResponse(result, clientId)) throw new Error(failure || "The delivery schedule could not be loaded.");
      if (!await checkAccess() || !current()) return;
      setConfigured(result.configured);
      if (result.schedule) {
        setDraft({
          cadence: result.schedule.cadence,
          timezone: result.schedule.timezone || defaultTimezone(),
          send_time: result.schedule.send_time,
          format: result.schedule.format,
          opt_in: result.schedule.opted_in,
        });
        setPaused(result.schedule.paused);
      } else setDraft(scheduleDraft(defaultFormat));
      setDirty(false);
      await loadHistory(current);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "The delivery schedule could not be loaded.");
    } finally { if (current()) setBusy(false); }
  }, [checkAccess, clearContext, clientId, defaultFormat, loadHistory]);

  useEffect(() => { live.current = true; void load(); return stop; }, [load, stop]);

  async function save() {
    const issue = scheduleDraftError(draft);
    if (issue) { setError(issue); return; }
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (!await checkAccess() || !current()) return;
      const payload = { cadence: draft.cadence, timezone: draft.timezone, send_time: draft.send_time, format: draft.format, opt_in: true };
      const result = await apiPut<ScheduleResponse>(`${API}/${clientId}/schedule`, payload);
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validScheduleResponse(result, clientId) || !result.schedule) {
        throw new Error(failure === "no_recipient"
          ? "Add and enable a delivery recipient before scheduling reports."
          : failure === "profile_required"
            ? "Save a reporting profile before scheduling delivery."
            : failure || "The delivery schedule could not be saved.");
      }
      if (!await checkAccess() || !current()) return;
      setConfigured(true); setPaused(result.schedule.paused); setDirty(false);
      setNotice("Scheduled delivery enabled."); await loadHistory(current);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "The delivery schedule could not be saved.");
    } finally { if (current()) setSaving(false); }
  }

  async function togglePause(resume: boolean) {
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiPost<ScheduleResponse>(`${API}/${clientId}/schedule/${resume ? "resume" : "pause"}`, {});
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validScheduleResponse(result, clientId) || !result.schedule) throw new Error(failure || "The schedule could not be updated.");
      if (!await checkAccess() || !current()) return;
      setPaused(result.schedule.paused); setNotice(resume ? "Scheduled delivery resumed." : "Scheduled delivery paused.");
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "The schedule could not be updated.");
    } finally { if (current()) setSaving(false); }
  }

  return <section aria-label="Client report schedule" style={card}>
    <h2>Scheduled report delivery</h2>
    <p>Opt in to automatically email this client&apos;s report on a weekly or monthly cadence. Delivery reuses the saved profile, active recipient and report generation path.</p>
    {busy && <p role="status">Loading schedule…</p>}
    {!busy && <form aria-label="Delivery schedule" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        Cadence
        <select name="cadence" style={input} value={draft.cadence}
          onChange={(event) => { setDraft((previous) => ({ ...previous, cadence: event.target.value as ScheduleDraft["cadence"] })); setDirty(true); setNotice(null); }}>
          <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        Timezone
        <input name="timezone" style={input} value={draft.timezone} maxLength={64}
          onChange={(event) => { setDraft((previous) => ({ ...previous, timezone: event.target.value })); setDirty(true); setNotice(null); }} />
      </label>
      <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        Send time (24-hour)
        <input name="send_time" style={input} value={draft.send_time} pattern="[0-9]{2}:[0-9]{2}" maxLength={5}
          onChange={(event) => { setDraft((previous) => ({ ...previous, send_time: event.target.value })); setDirty(true); setNotice(null); }} />
      </label>
      <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        Format
        <select name="format" style={input} value={draft.format}
          onChange={(event) => { setDraft((previous) => ({ ...previous, format: event.target.value as Draft["default_format"] })); setDirty(true); setNotice(null); }}>
          <option value="pdf">PDF</option><option value="pptx">PowerPoint</option><option value="xlsx">Excel</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input name="opt_in" type="checkbox" checked={draft.opt_in}
          onChange={(event) => { setDraft((previous) => ({ ...previous, opt_in: event.target.checked })); setDirty(true); setNotice(null); }} />
        I opt in to scheduled email delivery for this client
      </label>
      <button type="submit" style={button} disabled={saving || !dirty}>{saving ? "Saving…" : configured ? "Update schedule" : "Enable schedule"}</button>
      {configured && <button type="button" style={button} disabled={saving} onClick={() => void togglePause(paused)}>
        {paused ? "Resume schedule" : "Pause schedule"}
      </button>}
      <button type="button" style={button} disabled={saving || busy} onClick={() => void load()}>Reload schedule</button>
    </form>}
    {configured && !busy && <p role="status">{paused ? "Schedule is paused — no automatic sends until resumed." : "Schedule is active."}</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!busy && history.length > 0 && <div aria-label="Delivery history" style={{ marginTop: 16 }}>
      <h3>Recent deliveries</h3>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>
          <th scope="col" style={{ textAlign: "left", padding: 8 }}>When</th>
          <th scope="col" style={{ textAlign: "left", padding: 8 }}>Status</th>
          <th scope="col" style={{ textAlign: "left", padding: 8 }}>Recipient</th>
          <th scope="col" style={{ textAlign: "left", padding: 8 }}>Profile v</th>
          <th scope="col" style={{ textAlign: "left", padding: 8 }}>Error</th>
        </tr></thead>
        <tbody>{history.map((row) => <tr key={row.id}>
          <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.attempted_at}</td>
          <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.status}</td>
          <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.recipient_email || "—"}</td>
          <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.profile_version ?? "—"}</td>
          <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.error_code || "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {!busy && configured && !history.length && <p>No delivery attempts recorded yet.</p>}
  </section>;
}
