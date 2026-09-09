"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  accessLost, draftError, entriesUrl, entryDraft, entryPayload, filterError, newDraft, newFilters,
  responseError, validEntry, validMember, verifyTimeEntryAccess,
  type Draft, type EntriesResponse, type Filters, type Member,
  type MembersResponse, type SaveResponse, type TimeEntry,
} from "@/lib/agencyTimeEntries";

const card: CSSProperties = { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, marginTop: 16 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };
const input: CSSProperties = { border: "1px solid #94A3B8", borderRadius: 6, padding: 8, width: "100%", boxSizing: "border-box", color: "#0F172A", background: "#FFFFFF" };
const button: CSSProperties = { border: 0, borderRadius: 6, padding: "9px 14px", background: "#0F766E", color: "#FFFFFF", marginRight: 8 };
const cell: CSSProperties = { padding: 8, textAlign: "left", verticalAlign: "top", borderBottom: "1px solid #E2E8F0" };
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "grid", gap: 4, alignContent: "start" }}>{label}{children}</label>;
}
function Failure({ children }: { children: ReactNode }) {
  return <p role="alert" style={{ background: "#FEF2F2", color: "#991B1B", padding: 12, borderRadius: 6 }}>{children}</p>;
}
type Access = { status: "loading" | "error" | "denied" | "ready"; message?: string; canWrite?: boolean; tenantId?: number };

export default function AgencyTimeEntries() {
  const [access, setAccess] = useState<Access>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setAccess({ status: "loading" });
    void (async () => {
      const verified = await verifyTimeEntryAccess();
      if (!live) return;
      if (verified.error) return setAccess({ status: "error", message: verified.error });
      if (!verified.canRead) {
        return setAccess({ status: "denied", message: "Access denied. Time entries require tenant.billing.manage and manage.projects.view." });
      }
      setAccess({ status: "ready", canWrite: verified.canWrite, tenantId: verified.tenantId });
    })();
    return () => { live = false; };
  }, [attempt]);
  const invalidate = useCallback((message: string) => setAccess({ status: "error", message }), []);

  return <main style={{ background: "#F8FAFC", color: "#0F172A", minHeight: "100%", padding: 24 }}>
    <div style={{ maxWidth: 1240, margin: "0 auto" }}>
      <h1>Time Entry &amp; Corrections</h1>
      <p>Record and correct delivery time for the existing capacity roster. Server permissions apply to every request.</p>
      <Link href="/manage/agency-ops-dashboard">Back to Agency Operations Dashboard</Link>
      {access.status === "loading" && <p role="status">Verifying tenant and permissions…</p>}
      {(access.status === "error" || access.status === "denied") && <>
        <Failure>{access.message}</Failure>
        <button style={button} onClick={() => setAttempt((value) => value + 1)}>Retry permissions</button>
      </>}
      {access.status === "ready" && <EntriesPanel canWrite={access.canWrite === true} tenantId={access.tenantId!} invalidate={invalidate} />}
    </div>
  </main>;
}

function EntriesPanel({ canWrite: initialCanWrite, tenantId, invalidate }: { canWrite: boolean; tenantId: number; invalidate: (message: string) => void }) {
  const [canWrite, setCanWrite] = useState(initialCanWrite);
  const [filters, setFilters] = useState<Filters>(newFilters);
  const filtersRef = useRef(filters);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [knownMemberIds, setKnownMemberIds] = useState<string[]>([]);
  const [rosterState, setRosterState] = useState<"loading" | "ready" | "error">("loading");
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const live = useRef(false);
  const listVersion = useRef(0);
  const rosterVersion = useRef(0);
  const submitting = useRef(false);
  const contextVersion = useRef(0);
  const clearContext = useCallback((message: string) => {
    live.current = false;
    invalidate(message); // Unmount discards all tenant-bound state and invalidates pending reads/writes.
  }, [invalidate]);
  const checkContext = useCallback(async () => {
    const version = ++contextVersion.current;
    const access = await verifyTimeEntryAccess(tenantId);
    if (!live.current || version !== contextVersion.current) return null;
    if (access.accessLost || access.tenantChanged || (!access.error && !access.canRead)) {
      clearContext(access.error || "Read permission was revoked. Verify permissions before continuing.");
      return null;
    }
    if (!access.error) setCanWrite(access.canWrite === true);
    return access;
  }, [tenantId, clearContext]);

  const loadEntries = useCallback(async (selected: Filters) => {
    const version = ++listVersion.current;
    setEntries([]);
    const invalid = filterError(selected);
    setListError(invalid);
    setListState(invalid ? "error" : "loading");
    if (invalid) return;
    // A refresh is also an explicit action in a potentially long-lived tab.
    const access = await verifyTimeEntryAccess(tenantId);
    if (!live.current || version !== listVersion.current) return;
    if (access.accessLost || access.tenantChanged || (!access.error && !access.canRead)) {
      return clearContext(access.error || "Read permission was revoked. Verify permissions before continuing.");
    }
    if (access.error) { setListError(access.error); setListState("error"); return; }
    setCanWrite(access.canWrite === true);
    const result = await apiGet<EntriesResponse>(entriesUrl(selected));
    if (!live.current || version !== listVersion.current) return;
    const error = responseError(result) || (!Array.isArray(result.entries) || !result.entries.every(validEntry)
      || new Set(result.entries.map((entry) => entry.id)).size !== result.entries.length ? "Invalid time-entry response; data withheld." : null);
    if (accessLost(error)) return clearContext(error!);
    if (!error) setKnownMemberIds((ids) => Array.from(new Set([...ids, ...result.entries!.map((entry) => entry.member_id)])));
    setEntries(error ? [] : result.entries!);
    setListError(error);
    setListState(error ? "error" : "ready");
  }, [tenantId, clearContext]);
  const loadMembers = useCallback(async () => {
    const version = ++rosterVersion.current;
    setMembers([]);
    setRosterState("loading");
    setRosterError(null);
    // The existing summary is project-view authorized, read-only, and returns the active roster.
    const result = await apiGet<MembersResponse>("/api/capacity/summary");
    if (!live.current || version !== rosterVersion.current) return;
    const error = responseError(result) || (!Array.isArray(result.members) || !result.members.every(validMember)
      || new Set(result.members.map((member) => member.id)).size !== result.members.length ? "Invalid capacity roster response; data withheld." : null);
    if (accessLost(error)) return clearContext(error!);
    setMembers(error ? [] : result.members!);
    setRosterError(error);
    setRosterState(error ? "error" : "ready");
  }, [clearContext]);
  useEffect(() => {
    live.current = true;
    void loadMembers();
    void loadEntries(filtersRef.current);
    return () => { live.current = false; ++listVersion.current; ++rosterVersion.current; };
  }, [loadEntries, loadMembers]);
  useEffect(() => {
    const recheck = () => {
      if (!submitting.current && document.visibilityState === "visible") void checkContext();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => { window.removeEventListener("focus", recheck); document.removeEventListener("visibilitychange", recheck); };
  }, [checkContext]);

  function changeFilter(key: keyof Filters, value: string) {
    filtersRef.current = { ...filtersRef.current, [key]: value };
    ++listVersion.current; // Invalidate immediately, even before Apply or an effect runs.
    setFilters(filtersRef.current);
    setEntries([]);
    setListError(null);
    setListState("idle");
  }
  function changeDraft(key: keyof Draft, value: string | boolean) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }
  function resetDraft() {
    setDraft(newDraft()); setEditing(null); setSaveError(null); setSaved(false);
  }
  async function save() {
    if (!live.current || submitting.current || !canWrite || rosterState !== "ready") return;
    const invalid = draftError(draft, members, editing?.member_id);
    setSaveError(invalid);
    setSaved(false);
    if (invalid) return;
    submitting.current = true;
    setSaving(true);
    const access = await checkContext();
    if (!live.current) return;
    if (!access || access.error || !access.canWrite) {
      setSaveError(`Save not attempted: ${access?.error || "Project-edit permission could not be verified."} Draft retained.`);
      submitting.current = false;
      setSaving(false);
      return;
    }
    const payload = entryPayload(draft);
    const result = editing
      ? await apiPatch<SaveResponse>("/api/agency-ops/time-entries/" + encodeURIComponent(editing.id), payload)
      : await apiPost<SaveResponse>("/api/agency-ops/time-entries", payload);
    if (!live.current) return;
    const error = responseError(result) || (!validEntry(result.entry) || (editing && result.entry.id !== editing.id)
      ? "Invalid save response." : null);
    if (accessLost(error)) return clearContext(error!);
    if (error) {
      setSaveError(`Save not confirmed: ${error} Draft retained. Check the list before retrying; the server may have received the request.`);
    } else {
      setSaved(true);
      setDraft(newDraft());
      setEditing(null);
      await loadEntries(filtersRef.current);
    }
    if (live.current) { submitting.current = false; setSaving(false); }
  }
  const memberLabel = (id: string) => {
    const member = members.find((row) => row.id === id);
    return member ? `${member.member_name}${member.active ? "" : " (inactive)"}` : `${id} — existing member (not in active roster)`;
  };

  return <>
    {!canWrite && <p role="status">Read-only access. Creating or correcting entries additionally requires manage.projects.edit.</p>}
    {saveError && <Failure>{saveError}</Failure>}
    <section style={card} aria-label="Existing time entries">
      <h2>Existing time entries</h2>
      <form aria-label="Time-entry filters" onSubmit={(event) => { event.preventDefault(); void loadEntries(filtersRef.current); }}>
        <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Filter by date, exact client reference, and capacity member</legend>
          <div style={grid}>
            <Field label="From"><input name="from" type="date" required style={input} value={filters.from} onChange={(event) => changeFilter("from", event.target.value)} /></Field>
            <Field label="To"><input name="to" type="date" required style={input} value={filters.to} onChange={(event) => changeFilter("to", event.target.value)} /></Field>
            <Field label="Client filter (optional)"><input name="client_filter" maxLength={200} style={input} value={filters.client_ref} onChange={(event) => changeFilter("client_ref", event.target.value)} /></Field>
            <Field label="Member filter"><select name="member_filter" style={input} disabled={rosterState !== "ready"} value={filters.member_id} onChange={(event) => changeFilter("member_id", event.target.value)}>
              <option value="">All capacity members</option>
              {members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member.id)}</option>)}
              {knownMemberIds.filter((id) => !members.some((member) => member.id === id)).map((id) => <option key={id} value={id}>{memberLabel(id)}</option>)}
            </select></Field>
          </div>
          <p><button style={button} type="submit" disabled={listState === "loading"}>Apply filters / Refresh list</button></p>
        </fieldset>
      </form>
      {rosterState === "loading" && <p role="status">Loading capacity roster…</p>}
      {rosterError && <><Failure>Capacity roster unavailable: {rosterError}</Failure><button type="button" style={button} onClick={() => void loadMembers()}>Retry roster</button></>}
      {rosterState === "ready" && !members.length && <p>No capacity roster members exist. Ask your administrator to configure the roster; this panel does not seed it.</p>}
      <div role="status" aria-live="polite" aria-busy={listState === "loading"}>
        {listState === "loading" && "Loading time entries…"}
        {listState === "idle" && "Filters changed. Apply filters to load matching entries."}
        {listState === "ready" && !entries.length && "No time entries match these filters."}
      </div>
      {listError && <Failure>Time entries unavailable: {listError} Use Apply filters / Refresh list to retry.</Failure>}
      {listState === "ready" && entries.length >= 500 && <p role="status">500-entry limit reached. Results may be incomplete; narrow the date, client, or member filters. No totals are shown.</p>}
      {listState === "ready" && entries.length > 0 && <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <caption>Persisted entries for {filters.from} to {filters.to}; client: {filters.client_ref.trim() || "all"}; member: {filters.member_id ? memberLabel(filters.member_id) : "all"}</caption>
          <thead><tr>{["Date", "Member", "Client / project", "Work / notes", "Hours", "Billable", ...(canWrite ? ["Correction"] : [])].map((label) => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.id}>
            <td style={cell}>{entry.work_date}</td><td style={cell}>{memberLabel(entry.member_id)}</td>
            <td style={cell}>{entry.client_ref}{entry.project_ref && <div>Project: {entry.project_ref}</div>}</td>
            <td style={{ ...cell, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{entry.work_item}{entry.notes && <div>Notes: {entry.notes}</div>}</td>
            <td style={cell}>{entry.hours}</td><td style={cell}>{entry.billable ? "Yes" : "No"}</td>
            {canWrite && <td style={cell}><button type="button" style={button} disabled={saving || rosterState !== "ready"} aria-label={`Correct ${entry.work_item}`} onClick={() => {
              setEditing(entry); setDraft(entryDraft(entry)); setSaveError(null); setSaved(false);
            }}>Correct</button></td>}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
    {canWrite && <section style={card} aria-label="Time-entry editor" data-ig-no-enhance>
      <h2>{editing ? "Correct time entry" : "New time entry"}</h2>
      {editing && <p>Correcting entry {editing.id}. Changes are saved only when you submit.</p>}
      <form aria-label="Save time entry" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={saving || rosterState !== "ready"} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Entry details (member, client, work item, date, and hours are required)</legend>
          <div style={grid}>
            <Field label="Capacity member"><select name="member_id" required style={input} value={draft.member_id} onChange={(event) => changeDraft("member_id", event.target.value)}>
              <option value="">Choose a capacity member</option>
              {editing && !members.some((member) => member.id === editing.member_id) && <option value={editing.member_id}>{memberLabel(editing.member_id)}</option>}
              {members.filter((member) => member.active || member.id === editing?.member_id).map((member) => <option key={member.id} value={member.id}>{memberLabel(member.id)}</option>)}
            </select></Field>
            {([['client_ref', 'Client reference', true], ['project_ref', 'Project reference (optional)', false], ['work_item', 'Work item', true]] as const).map(([key, label, required]) =>
              <Field key={key} label={label}><input name={key} style={input} required={required} maxLength={200} value={draft[key]} onChange={(event) => changeDraft(key, event.target.value)} /></Field>)}
            <Field label="Work date"><input name="work_date" type="date" required style={input} value={draft.work_date} onChange={(event) => changeDraft("work_date", event.target.value)} /></Field>
            <Field label="Hours (0.01–24)"><input name="hours" type="number" min="0.01" max="24" step="0.01" required style={input} value={draft.hours} onChange={(event) => changeDraft("hours", event.target.value)} /></Field>
            <label><input name="billable" type="checkbox" checked={draft.billable} onChange={(event) => changeDraft("billable", event.target.checked)} /> Billable</label>
          </div>
          <Field label="Notes (optional, maximum 2000 characters)"><textarea name="notes" style={input} rows={3} maxLength={2000} value={draft.notes} onChange={(event) => changeDraft("notes", event.target.value)} /></Field>
          <p><button type="submit" style={button} disabled={!editing && !members.some((member) => member.active)}>{saving ? "Saving…" : editing ? "Save correction" : "Create entry"}</button>
            <button type="button" style={button} onClick={resetDraft}>{editing ? "Cancel correction" : "Clear draft"}</button></p>
        </fieldset>
      </form>
      {saved && <p role="status">{listState === "error" ? "Saved, but list refresh failed. Refresh the list; do not resubmit the saved entry." : listState === "loading" ? "Saved. Refreshing persisted entries…" : "Saved. The list is refreshed from persisted data using the current filters; the entry may fall outside them."}</p>}
    </section>}
  </>;
}
