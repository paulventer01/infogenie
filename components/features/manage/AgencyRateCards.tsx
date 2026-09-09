"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import {
  accessLost, draftError, filterError, memberLabel, newDraft, newFilters, ratePayload, ratesUrl, responseError,
  validRate, validRosterMember, verifyRateCardAccess,
  type Context, type Draft, type Filters, type Rate, type RatesResponse, type RosterMember, type RosterResponse, type SaveResponse,
} from "@/lib/agencyRateCards";

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
type Access = { context?: Context; canWrite?: boolean; error?: string };

export default function AgencyRateCards() {
  const [access, setAccess] = useState<Access>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setAccess({});
    void verifyRateCardAccess().then((verified) => {
      if (!live) return;
      if (verified.error) return setAccess({ error: verified.error });
      if (!verified.canRead) return setAccess({ error: "Access denied. Ask your workspace administrator for billing management and project viewing access." });
      setAccess({ context: verified.context, canWrite: verified.canWrite });
    });
    return () => { live = false; };
  }, [attempt]);
  const invalidate = useCallback((error: string) => setAccess({ error }), []);
  return <main style={{ background: "#F8FAFC", color: "#0F172A", minHeight: "100%", padding: 24 }}>
    <div style={{ maxWidth: 1240, margin: "0 auto" }}>
      <h1>Rate Card Setup</h1>
      <p>View hourly rates by member or role and add a dated rate record.</p>
      <Link href="/manage/agency-ops-dashboard">Back to Agency Operations Dashboard</Link>
      {access.error ? <><Failure>{access.error}</Failure><button style={button} onClick={() => setAttempt((n) => n + 1)}>Retry access</button></>
        : access.context ? <RatesPanel context={access.context} initialCanWrite={access.canWrite === true} invalidate={invalidate} />
          : <p role="status">Verifying account, workspace and access…</p>}
    </div>
  </main>;
}

function RatesPanel({ context, initialCanWrite, invalidate }: { context: Context; initialCanWrite: boolean; invalidate: (message: string) => void }) {
  const [canWrite, setCanWrite] = useState(initialCanWrite);
  const [contextError, setContextError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(newFilters);
  const filtersRef = useRef(filters);
  const [rates, setRates] = useState<Rate[]>([]);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [rosterState, setRosterState] = useState<"loading" | "ready" | "error">("loading");
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const live = useRef(false);
  const generation = useRef(0);
  const listVersion = useRef(0);
  const rosterVersion = useRef(0);
  const submitting = useRef(false);
  const stopRequests = useCallback(() => {
    live.current = false; ++generation.current; ++listVersion.current; ++rosterVersion.current;
  }, []);
  const clearContext = useCallback((message: string) => {
    stopRequests();
    setRates([]); setMembers([]); setKnownIds([]); setDraft(newDraft()); setFilters(newFilters());
    invalidate(message);
  }, [invalidate, stopRequests]);
  const checkContext = useCallback(async () => {
    const version = generation.current;
    const verified = await verifyRateCardAccess(context);
    if (!live.current || version !== generation.current) return null;
    if (verified.lost || (!verified.error && !verified.canRead)) {
      clearContext(verified.error || "Read access was revoked. Ask your workspace administrator to restore access.");
      return null;
    }
    setContextError(verified.error);
    if (!verified.error) setCanWrite(verified.canWrite === true);
    return verified;
  }, [context, clearContext]);

  const loadRates = useCallback(async (selected: Filters) => {
    const version = ++listVersion.current;
    const current = () => live.current && version === listVersion.current;
    setRates([]);
    const invalid = filterError(selected);
    setListError(invalid); setListState(invalid ? "error" : "loading");
    if (invalid) return;
    try {
      const access = await checkContext();
      if (!current() || !access) return;
      if (access.error) { setListError(access.error); setListState("error"); return; }
      const result = await apiGet<RatesResponse>(ratesUrl(selected));
      if (!current()) return;
      const error = responseError(result) || (!Array.isArray(result.rates) || result.rates.length > 500
        || !result.rates.every(validRate) || new Set(result.rates.map((r) => r.id)).size !== result.rates.length
        ? "Invalid rate response; data withheld." : null);
      if (accessLost(error)) return clearContext(error!);
      // Recheck after the read too: a session can change while its response is pending.
      const after = await checkContext();
      if (!current() || !after) return;
      const failure = after.error || error;
      setRates(failure ? [] : result.rates!); setListError(failure); setListState(failure ? "error" : "ready");
      if (!failure) setKnownIds((ids) => Array.from(new Set([...ids, ...result.rates!.flatMap((r) => r.member_id ? [r.member_id] : [])])));
    } catch {
      if (current()) { setListError("Rates unavailable. Refresh to try again."); setListState("error"); }
    }
  }, [checkContext, clearContext]);
  const loadMembers = useCallback(async () => {
    const version = ++rosterVersion.current;
    const current = () => live.current && version === rosterVersion.current;
    setMembers([]); setRosterState("loading"); setRosterError(null);
    try {
      const access = await checkContext();
      if (!current() || !access) return;
      if (access.error) { setRosterError(access.error); setRosterState("error"); return; }
      const result = await apiGet<RosterResponse>("/api/capacity/summary");
      if (!current()) return;
      const error = responseError(result) || (!Array.isArray(result.members) || !result.members.every(validRosterMember)
        || new Set(result.members.map((m) => m.id)).size !== result.members.length ? "Invalid capacity roster; data withheld." : null);
      if (accessLost(error)) return clearContext(error!);
      const after = await checkContext();
      if (!current() || !after) return;
      const failure = after.error || error;
      setMembers(failure ? [] : result.members!.filter((m) => m.active));
      setRosterError(failure); setRosterState(failure ? "error" : "ready");
    } catch {
      if (current()) { setRosterError("Roster unavailable. Try again."); setRosterState("error"); }
    }
  }, [checkContext, clearContext]);
  useEffect(() => {
    live.current = true;
    void loadRates(filtersRef.current); void loadMembers();
    const recheck = () => { if (document.visibilityState === "visible") void checkContext(); };
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("storage", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      stopRequests();
      window.removeEventListener("focus", recheck); window.removeEventListener("pageshow", recheck);
      window.removeEventListener("storage", recheck); document.removeEventListener("visibilitychange", recheck);
    };
  }, [loadRates, loadMembers, checkContext, stopRequests]);

  function changeFilter(key: keyof Filters, value: string) {
    filtersRef.current = key === "scope" ? { ...newFilters(), scope: value as Filters["scope"] } : { ...filtersRef.current, [key]: value };
    ++listVersion.current; setFilters(filtersRef.current); setRates([]); setListError(null); setListState("idle");
  }
  function changeDraft(key: keyof Draft, value: string | boolean) {
    setDraft((d) => key === "scope" ? { ...d, scope: value as Draft["scope"], member_id: "", role: "" } : { ...d, [key]: value });
    setSaved(false); setSaveError(null);
  }
  async function save() {
    if (!live.current || submitting.current || !canWrite || (draft.scope === "member" && rosterState !== "ready")) return;
    const invalid = draftError(draft, members);
    setSaveError(invalid); setSaved(false);
    if (invalid) return;
    submitting.current = true; setSaving(true);
    const version = generation.current;
    const current = () => live.current && version === generation.current;
    let confirmed = false;
    try {
      const access = await checkContext();
      if (!current() || !access) return;
      if (access.error || !access.canWrite) {
        setSaveError(`Save not attempted: ${access.error || "Project editing access is required."} Draft retained.`); return;
      }
      const payload = ratePayload(draft);
      const result = await apiPost<SaveResponse>("/api/agency-ops/rates", payload);
      if (!current()) return;
      const error = responseError(result) || (!validRate(result.rate)
        || Object.entries(payload).some(([key, value]) => result.rate![key as keyof Rate] !== value) ? "Invalid save response." : null);
      if (accessLost(error)) return clearContext(error!);
      const after = await checkContext();
      if (!current() || !after) return;
      if (error) {
        setSaveError(`Save not confirmed: ${error} Draft retained. Check the list before retrying; the server may have received the request.`);
      } else {
        confirmed = true; setSaved(true); setDraft(newDraft());
        await loadRates(filtersRef.current);
      }
    } catch {
      if (current()) setSaveError(confirmed ? "Saved, but list refresh failed. Refresh the list; do not resubmit."
        : "Save not confirmed. Draft retained. Check the list before retrying; the server may have received the request.");
    } finally {
      if (current()) { submitting.current = false; setSaving(false); }
    }
  }
  const memberIds = Array.from(new Set([...members.map((m) => m.id), ...knownIds]));
  const labelMember = (id: string) => memberLabel(id, members, rosterState === "ready");
  const roles = Array.from(new Set(members.flatMap((m) => m.role?.trim() ? [m.role] : [])));
  return <>
    <p>For each work date, eligible active member rates take precedence over role rates. Within the same scope, the later effective start wins; a later-created record breaks a start-date tie. Existing records stay in the history. Backdating can change pricing for earlier work dates.</p>
    {!canWrite && <p role="status">Read-only access. Adding rates requires project editing access.</p>}
    {contextError && <Failure>{contextError} <button style={button} onClick={() => void checkContext()}>Retry access check</button></Failure>}
    {saveError && <Failure>{saveError}</Failure>}
    <section style={card} aria-label="Existing rates">
      <h2>Existing rates</h2>
      <form aria-label="Rate filters" onSubmit={(e) => { e.preventDefault(); void loadRates(filtersRef.current); }}>
        <fieldset disabled={saving || !!contextError} style={{ border: 0, padding: 0 }}>
          <legend>Filter by member or exact role</legend>
          <div style={grid}>
            <Field label="Show rates"><select name="filter_scope" style={input} value={filters.scope} onChange={(e) => changeFilter("scope", e.target.value)}>
              <option value="all">All scopes</option><option value="member">Member</option><option value="role">Role</option>
            </select></Field>
            {filters.scope === "member" && <Field label="Member filter"><select name="member_filter" style={input} value={filters.member_id} onChange={(e) => changeFilter("member_id", e.target.value)}>
              <option value="">Choose a member</option>{memberIds.map((id) => <option key={id} value={id}>{labelMember(id)}</option>)}
            </select></Field>}
            {filters.scope === "role" && <Field label="Exact role filter"><input name="role_filter" list="rate-roles" maxLength={200} style={input} value={filters.role} onChange={(e) => changeFilter("role", e.target.value)} /></Field>}
          </div><p><button style={button} type="submit">Refresh rates</button></p>
        </fieldset>
      </form>
      <p>The list returns at most 500 records. Each row keeps its own currency; no totals or currency conversions are shown.</p>
      {listState === "loading" && <p role="status">Loading rates…</p>}
      {listState === "idle" && <p role="status">Filters changed. Refresh rates to load matching records.</p>}
      {listError && <Failure>{listError}</Failure>}
      {listState === "ready" && rates.length === 0 && <p>No rate records match these filters.</p>}
      {listState === "ready" && rates.length === 500 && <p role="status">500-record limit reached. More records may exist; narrow the member or role filter. This is not complete pricing coverage.</p>}
      {listState === "ready" && rates.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
        <caption>Stored rate history</caption>
        <thead><tr>{["Scope", "Hourly cost", "Hourly bill rate", "Currency", "Effective from", "Effective to", "Active"].map((title) => <th key={title} scope="col" style={cell}>{title}</th>)}</tr></thead>
        <tbody>{rates.map((rate) => <tr key={rate.id}>
          <td style={cell}>{rate.member_id ? <>Member: {labelMember(rate.member_id)}{rate.role && <>; recorded role: {rate.role}</>}</>
            : rate.role ? <>Role: {rate.role}</> : "Default (existing record)"}</td>
          <td style={cell}>{rate.cost_rate.toFixed(2)}</td><td style={cell}>{rate.bill_rate.toFixed(2)}</td><td style={cell}>{rate.currency || "Not specified"}</td>
          <td style={cell}>{rate.effective_from}</td><td style={cell}>{rate.effective_to || "No end date"}</td><td style={cell}>{rate.active ? "Yes" : "No"}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {rosterState === "loading" && <p role="status">Loading active roster…</p>}
    {rosterError && <Failure>Capacity roster unavailable: {rosterError} <button style={button} disabled={saving} onClick={() => void loadMembers()}>Retry roster</button></Failure>}
    {rosterState === "ready" && !members.length && <p>No active roster members are available. You can still add a named role rate.</p>}
    <datalist id="rate-roles">{roles.map((role) => <option key={role} value={role} />)}</datalist>
    {canWrite && <section style={card} aria-label="Add rate">
      <h2>Add a dated rate</h2>
      <p>Choose a member or enter the exact role name. Role suggestions come from the active roster. Saving adds a new record; it does not edit or delete history.</p>
      <form aria-label="Save rate" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset disabled={saving || !!contextError} style={{ border: 0, padding: 0 }}>
          <div style={grid}>
            <Field label="Rate applies to"><select name="scope" style={input} value={draft.scope} onChange={(e) => changeDraft("scope", e.target.value)}>
              <option value="member">Member</option><option value="role">Role</option>
            </select></Field>
            {draft.scope === "member" ? <Field label="Member"><select name="member_id" style={input} required disabled={rosterState !== "ready"} value={draft.member_id} onChange={(e) => changeDraft("member_id", e.target.value)}>
              <option value="">Choose an active member</option>{members.map((m) => <option key={m.id} value={m.id}>{labelMember(m.id)}</option>)}
            </select></Field> : <Field label="Exact role name"><input name="role" list="rate-roles" style={input} required maxLength={200} value={draft.role} onChange={(e) => changeDraft("role", e.target.value)} /></Field>}
            {([["cost_rate", "Hourly cost"], ["bill_rate", "Hourly bill rate"]] as const).map(([key, label]) => <Field key={key} label={label}>
              <input name={key} type="text" inputMode="decimal" style={input} required value={draft[key]} onChange={(e) => changeDraft(key, e.target.value)} />
            </Field>)}
            <Field label="Currency (e.g. USD)"><input name="currency" style={input} required maxLength={10} value={draft.currency} onChange={(e) => changeDraft("currency", e.target.value)} /></Field>
            <Field label="Effective from"><input name="effective_from" type="date" style={input} required value={draft.effective_from} onChange={(e) => changeDraft("effective_from", e.target.value)} /></Field>
            <Field label="Effective to (optional)"><input name="effective_to" type="date" style={input} value={draft.effective_to} onChange={(e) => changeDraft("effective_to", e.target.value)} /></Field>
            <label><input name="active" type="checkbox" checked={draft.active} onChange={(e) => changeDraft("active", e.target.checked)} /> Active</label>
          </div>
          <p>Enter both amounts explicitly, from 0 to 1,000,000 with at most two decimal places.</p>
          <button type="submit" style={button} disabled={draft.scope === "member" && (rosterState !== "ready" || !members.length)}>{saving ? "Saving…" : "Save rate"}</button>
          <button type="button" style={button} onClick={() => { setDraft(newDraft()); setSaveError(null); setSaved(false); }}>Clear draft</button>
        </fieldset>
      </form>
    </section>}
    {saved && <p role="status">{listState === "error" ? "Saved, but list refresh failed. Refresh rates; do not resubmit the saved rate."
      : listState === "loading" ? "Saved. Refreshing rate history…" : listState === "idle" ? "Saved. Filters changed; refresh rates to view matching history."
        : "Saved. Rate history was refreshed using the current filters; the new record may fall outside them."}</p>}
  </>;
}
