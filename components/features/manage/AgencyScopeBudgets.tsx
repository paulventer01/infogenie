"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import {
  accessLost, baselinePayload, baselinesUrl, draftError, filterError, matchesPayload, newDraft, newFilters,
  normalizeBaseline, normalizeBaselines, overlappingBaselines, responseError, scopeAccessMessage, verifyScopeBudgetAccess,
  type Baseline, type BaselinesResponse, type Context, type Draft, type Filters, type Payload, type SaveResponse,
} from "@/lib/agencyScopeBudgets";

const card: CSSProperties = { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, marginTop: 16 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };
const input: CSSProperties = { border: "1px solid #94A3B8", borderRadius: 6, padding: 8, width: "100%", boxSizing: "border-box", color: "#0F172A", background: "#FFFFFF" };
const button: CSSProperties = { border: 0, borderRadius: 6, padding: "9px 14px", background: "#0F766E", color: "#FFFFFF", marginRight: 8 };
const cell: CSSProperties = { padding: 8, textAlign: "left", verticalAlign: "top", borderBottom: "1px solid #E2E8F0" };
const budgetFields = [["contracted_hours", "Contracted hours"], ["change_budget_hours", "Change budget hours"], ["contracted_value", "Contracted value"]] as const;
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "grid", gap: 4, alignContent: "start" }}>{label}{children}</label>;
}
function Failure({ children }: { children: ReactNode }) {
  return <p role="alert" style={{ background: "#FEF2F2", color: "#991B1B", padding: 12, borderRadius: 6 }}>{children}</p>;
}
type Access = { context?: Context; canWrite?: boolean; error?: string };

export default function AgencyScopeBudgets() {
  const [access, setAccess] = useState<Access>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setAccess({});
    void verifyScopeBudgetAccess().then((verified) => {
      if (!live) return;
      if (verified.error) return setAccess({ error: scopeAccessMessage(verified.error) });
      if (!verified.canRead) return setAccess({ error: "Access denied. Scope budgets require billing management and project viewing access." });
      setAccess({ context: verified.context, canWrite: verified.canWrite });
    });
    return () => { live = false; };
  }, [attempt]);
  const invalidate = useCallback((error: string) => setAccess({ error: scopeAccessMessage(error) }), []);
  return <main style={{ background: "#F8FAFC", color: "#0F172A", minHeight: "100%", padding: 24 }}>
    <div style={{ maxWidth: 1240, margin: "0 auto" }}>
      <h1>Scope &amp; Budget Setup</h1>
      <p>View active scope baselines and add an agreed period of work.</p>
      <Link href="/manage/agency-ops-dashboard">Back to Agency Operations Dashboard</Link>
      {access.error ? <><Failure>{access.error}</Failure><button type="button" style={button} onClick={() => setAttempt((n) => n + 1)}>Retry access</button></>
        : access.context ? <BudgetsPanel context={access.context} initialCanWrite={access.canWrite === true} invalidate={invalidate} />
          : <p role="status">Verifying account, workspace and access…</p>}
    </div>
  </main>;
}

function BudgetsPanel({ context, initialCanWrite, invalidate }: { context: Context; initialCanWrite: boolean; invalidate: (message: string) => void }) {
  const [canWrite, setCanWrite] = useState(initialCanWrite);
  const [contextError, setContextError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [filters, setFilters] = useState<Filters>(newFilters);
  const filtersRef = useRef(filters);
  const [rows, setRows] = useState<Baseline[]>([]);
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [review, setReview] = useState<Payload | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const live = useRef(false), generation = useRef(0), listVersion = useRef(0), submitting = useRef(false);
  const checkTail = useRef(Promise.resolve()), pendingChecks = useRef(0);
  const stopRequests = useCallback(() => { live.current = false; ++generation.current; ++listVersion.current; }, []);
  const clearContext = useCallback((message: string) => {
    stopRequests(); setRows([]); setDraft(newDraft()); setReview(null); setFilters(newFilters());
    setSaved(false); setSaveError(null); invalidate(message);
  }, [invalidate, stopRequests]);
  const checkContext = useCallback(async () => {
    const version = generation.current;
    const current = () => live.current && version === generation.current;
    if (!current()) return null;
    // Serialize access checks so an older success cannot overwrite a newer denial.
    ++pendingChecks.current; setChecking(true);
    const prior = checkTail.current;
    let release!: () => void;
    checkTail.current = new Promise<void>((resolve) => { release = resolve; });
    try {
      await prior;
      if (!current()) return null;
      const verified = await verifyScopeBudgetAccess(context);
      if (!current()) return null;
      if (verified.lost || (!verified.error && !verified.canRead)) {
        clearContext(verified.error || "Read access was revoked. Ask your workspace administrator to restore scope budget access.");
        return null;
      }
      setContextError(verified.error ? scopeAccessMessage(verified.error) : null);
      if (!verified.error) setCanWrite(verified.canWrite === true);
      else { setRows([]); setListState("error"); setListError("Access could not be verified. Apply filters after restoring access."); }
      return verified;
    } finally {
      release(); --pendingChecks.current;
      if (current()) setChecking(pendingChecks.current > 0);
    }
  }, [context, clearContext]);

  const loadBaselines = useCallback(async (selected: Filters, createdId?: string) => {
    const version = ++listVersion.current, epoch = generation.current;
    const current = () => live.current && version === listVersion.current && epoch === generation.current;
    setRows([]);
    const invalid = filterError(selected);
    setListError(invalid); setListState(invalid ? "error" : "loading");
    if (invalid) return;
    try {
      const access = await checkContext();
      if (!current() || !access || access.error) return;
      let result: BaselinesResponse;
      try { result = await apiGet<BaselinesResponse>(baselinesUrl(selected)); }
      catch { result = { ok: false, error: "Baselines unavailable. Apply filters to try again." }; }
      if (!current()) return;
      const error = responseError(result);
      if (accessLost(error)) return clearContext(error!);
      const normalized = error ? null : normalizeBaselines(result, selected);
      const after = await checkContext();
      if (!current() || !after || after.error) return;
      const failure = error || (!normalized ? "Invalid baseline response; data withheld." : createdId && !normalized.some((row) => row.id === createdId)
        ? "The saved baseline was not returned by the refresh. Verify the list before adding another." : null);
      setRows(failure ? [] : normalized!); setListError(failure); setListState(failure ? "error" : "ready");
    } catch {
      if (current()) { setListError("Baselines unavailable. Apply filters to try again."); setListState("error"); }
    }
  }, [checkContext, clearContext]);
  useEffect(() => {
    live.current = true;
    void loadBaselines(filtersRef.current);
    const recheck = () => { void checkContext(); };
    window.addEventListener("focus", recheck); window.addEventListener("pageshow", recheck);
    window.addEventListener("storage", recheck); document.addEventListener("visibilitychange", recheck);
    return () => {
      stopRequests();
      window.removeEventListener("focus", recheck); window.removeEventListener("pageshow", recheck);
      window.removeEventListener("storage", recheck); document.removeEventListener("visibilitychange", recheck);
    };
  }, [loadBaselines, checkContext, stopRequests]);

  function changeFilter(key: keyof Filters, value: string) {
    if (submitting.current) return;
    filtersRef.current = { ...filtersRef.current, [key]: value };
    ++listVersion.current; setFilters(filtersRef.current); setRows([]); setListError(null); setListState("idle");
  }
  function changeDraft(key: keyof Draft, value: string) {
    setDraft((old) => ({ ...old, [key]: value })); setReview(null); setSaveError(null); setSaved(false);
  }
  async function save() {
    if (!live.current || submitting.current || !canWrite || contextError || checking || !review) return;
    const invalid = draftError(draft);
    if (invalid || !matchesPayload({ id: "draft", ...review }, baselinePayload(draft))) { setSaveError(invalid || "Review the updated draft first."); setReview(null); return; }
    submitting.current = true; setSaving(true); setSaveError(null); setSaved(false);
    const epoch = generation.current, payload = review;
    const current = () => live.current && epoch === generation.current;
    try {
      const access = await checkContext();
      if (!current() || !access) return;
      if (access.error || !access.canWrite) { setSaveError("Save not attempted. Verify project editing access. Draft retained."); return; }
      let result: SaveResponse;
      try { result = await apiPost<SaveResponse>("/api/agency-ops/scope-baselines", payload); }
      catch { result = { ok: false, error: "Request unavailable." }; }
      if (!current()) return;
      const error = responseError(result), row = error ? null : normalizeBaseline(result.baseline);
      if (accessLost(error)) return clearContext(error!);
      const after = await checkContext();
      if (!current() || !after) return;
      if (error || !row || !matchesPayload(row, payload)) {
        setSaveError("Save not confirmed. Draft retained. Verify the list for this client and period before manually retrying; the server may have received the request.");
        setReview(null); return;
      }
      // Only the validated POST confirms saving; a failed GET cannot undo it.
      setSaved(true); setDraft(newDraft()); setReview(null);
      const selected = { from: row.period_start, to: row.period_end, client_ref: row.client_ref };
      filtersRef.current = selected; setFilters(selected); ++listVersion.current; setRows([]);
      if (after.error) { setListState("error"); return; }
      await loadBaselines(selected, row.id);
    } finally {
      if (current()) { submitting.current = false; setSaving(false); }
    }
  }
  // Keep drafts in memory during transient verification outages, but render no financial state.
  if (checking || contextError) return <>
    {checking ? <p role="status">Verifying scope budget access…</p> : <><Failure>{contextError}</Failure>
      <p>Scope data is hidden until access is verified.</p><button type="button" style={button} onClick={() => void checkContext()}>Retry access check</button></>}
  </>;
  const overlaps = review ? overlappingBaselines(rows, review) : [];
  return <>
    <p>Use the same client and project references as your time entries. Leave project blank to cover all projects for that client.</p>
    <p>Period overlap selects the full baseline. Scope consumption counts work across its full baseline period, even outside these filters. Overlapping baselines independently count the same matching work; they are not automatic versions or replacements.</p>
    <p>Saved baselines cannot be edited, replaced or deleted here. Each row keeps its currency; no currency conversion or combined totals are shown.</p>
    {!canWrite && <p role="status">Read-only access. Adding scope baselines requires project editing access.</p>}
    {saveError && <Failure>{saveError}</Failure>}
    {saved && <p role="status">{listState === "error" ? "Saved, but list refresh failed. Apply filters to verify the list; do not resubmit the saved baseline."
      : listState === "loading" ? "Saved. Refreshing the created client and period…" : listState === "idle" ? "Saved. Filters changed; apply them to view matching baselines." : "Saved. The list was refreshed for the created client and period."}</p>}
    <section style={card} aria-label="Active scope baselines">
      <h2>Active scope baselines</h2>
      <form aria-label="Scope filters" onSubmit={(e) => { e.preventDefault(); if (!submitting.current) void loadBaselines(filtersRef.current); }}>
        <fieldset disabled={saving} style={{ border: 0, padding: 0 }}><legend>Inclusive period overlap and optional exact client</legend>
          <div style={grid}>
            <Field label="From"><input name="filter_from" type="date" required style={input} value={filters.from} onChange={(e) => changeFilter("from", e.target.value)} /></Field>
            <Field label="To"><input name="filter_to" type="date" required style={input} value={filters.to} onChange={(e) => changeFilter("to", e.target.value)} /></Field>
            <Field label="Exact client reference (optional)"><input name="filter_client_ref" maxLength={200} style={input} value={filters.client_ref} onChange={(e) => changeFilter("client_ref", e.target.value)} /></Field>
          </div><p><button type="submit" style={button}>Apply filters</button></p>
        </fieldset>
      </form>
      <p>Only ACTIVE baselines overlapping From through To, inclusive, are returned. Inactive rows and periods outside these filters are not shown. The default is the local month to date.</p>
      {listState === "loading" && <p role="status">Loading active baselines…</p>}
      {listState === "idle" && <p role="status">Filters changed. Apply filters to load matching baselines.</p>}
      {listError && <Failure>{listError}</Failure>}
      {listState === "ready" && rows.length === 0 && <p>No active baselines overlap this period and client filter.</p>}
      {listState === "ready" && rows.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
        <caption>Active baselines matching the applied filters</caption>
        <thead><tr>{["Name", "Client reference", "Project reference", "Start", "End", "Contracted hours", "Change budget hours", "Contracted value", "Currency"].map((title) => <th key={title} scope="col" style={cell}>{title}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td style={cell}>{row.name}</td><td style={cell}>{row.client_ref}</td><td style={cell}>{row.project_ref || "All client projects"}</td>
          <td style={cell}>{row.period_start}</td><td style={cell}>{row.period_end}</td>
          {budgetFields.map(([key]) => <td key={key} style={cell}>{row[key].toFixed(2)}</td>)}<td style={cell}>{row.currency}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {canWrite && <section style={card} aria-label="Add active baseline">
      <h2>Add active baseline</h2>
      <form aria-label="Review scope budget" onSubmit={(e) => {
        e.preventDefault(); if (submitting.current || review) return;
        const invalid = draftError(draft); setSaveError(invalid); if (!invalid) setReview(baselinePayload(draft));
      }}>
        <fieldset disabled={saving || !!review} style={{ border: 0, padding: 0 }}><legend>New baseline details</legend>
          <div style={grid}>
            {([["client_ref", "Client reference"], ["project_ref", "Project reference (optional)"], ["name", "Baseline name"]] as const).map(([key, label]) => <Field key={key} label={label}>
              <input name={key} style={input} required={key !== "project_ref"} maxLength={200} value={draft[key]} onChange={(e) => changeDraft(key, e.target.value)} />
            </Field>)}
            {budgetFields.map(([key, label]) => <Field key={key} label={label}><input name={key} type="text" inputMode="decimal" required style={input} value={draft[key]} onChange={(e) => changeDraft(key, e.target.value)} /></Field>)}
            <Field label="Currency (e.g. USD)"><input name="currency" required maxLength={10} style={input} value={draft.currency} onChange={(e) => changeDraft("currency", e.target.value)} /></Field>
            {([["period_start", "Baseline start"], ["period_end", "Baseline end"]] as const).map(([key, label]) => <Field key={key} label={label}>
              <input name={key} type="date" required style={input} value={draft[key]} onChange={(e) => changeDraft(key, e.target.value)} />
            </Field>)}
          </div>
          <p>Enter each amount explicitly, including zero. Hours: 0–1,000,000. Contracted value: 0–1,000,000,000. At most two decimal places. Contracted value records the agreement value.</p>
          <button type="submit" style={button}>Review budget inputs</button>
          <button type="button" style={button} onClick={() => { setDraft(newDraft()); setReview(null); setSaveError(null); }}>Clear draft</button>
        </fieldset>
      </form>
      {review && <section aria-label="Review baseline" aria-live="polite">
        <h3>Review before saving</h3>
        <p>{review.name} — Client: {review.client_ref}; Project: {review.project_ref || "All client projects"}. ACTIVE, {review.period_start} through {review.period_end}.</p>
        <dl>{budgetFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{review[key].toFixed(2)}{key === "contracted_value" ? ` ${review.currency}` : " hours"}</dd></div>)}</dl>
        {overlaps.length > 0 && <Failure>{overlaps.length} loaded baseline(s) overlap this client/project coverage and period: {overlaps.map((row) => row.name).join(", ")}. Adding this baseline may count work again.</Failure>}
        <p>Overlap checks cover only loaded active baselines. Filters may exclude other overlaps. Review the client and period before adding; existing baselines remain independent.</p>
        <button type="button" style={button} disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save active baseline"}</button>
        <button type="button" style={button} disabled={saving} onClick={() => setReview(null)}>Back to draft</button>
      </section>}
    </section>}
  </>;
}
