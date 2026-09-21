"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "@/styles/reporting-workspace.module.css";
import { apiGet, apiPut } from "@/lib/api";
import ClientReportingReport from "@/components/features/manage/ClientReportingReport";
import ClientReportingRecipient from "@/components/features/manage/ClientReportingRecipient";
import ClientReportingSchedule from "@/components/features/manage/ClientReportingSchedule";
import ClientReportingPortal from "@/components/features/manage/ClientReportingPortal";
import ClientReportingPortalFeedback from "@/components/features/manage/ClientReportingPortalFeedback";
import ClientReportingMappings from "@/components/features/manage/ClientReportingMappings";
import { API, BRAND_FIELDS, PERIOD_HELP, accessLost, draftError, newDraft, profileDraft, profilePayload, responseError,
  saveMatches, positiveId, validClient, validPage, validProfile, verifyAccess,
  type Client, type ClientsResponse, type Context, type Draft, type ProfileResponse } from "@/lib/clientReporting";
import { REPORTING_PERIODS, defaultMetrics, orderedMetricEditor } from "@/lib/clientReportingMetrics";

const card: CSSProperties = { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: 24, marginTop: 16 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 };
const input: CSSProperties = { border: "1px solid #94A3B8", borderRadius: 6, padding: 9, width: "100%", boxSizing: "border-box", background: "#FFFFFF", color: "#0F172A" };
const button: CSSProperties = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "grid", gap: 6, alignContent: "start" }}>{label}{children}</label>;
}
function Failure({ children }: { children: ReactNode }) {
  return <p role="alert" style={{ color: "#991B1B", background: "#FEF2F2", padding: 12, borderRadius: 6 }}>{children}</p>;
}

export default function ClientReportingProfiles() {
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [linkedClient, setLinkedClient] = useState<Client | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [pendingClient, setPendingClient] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [saved, setSaved] = useState(false);
  const live = useRef(false), denied = useRef(false), submitting = useRef(false);
  const context = useRef<Context | null>(null);
  const generation = useRef(0), listSequence = useRef(0), profileSequence = useRef(0), checks = useRef(0);

  const stop = useCallback(() => { live.current = false; ++generation.current; checks.current = 0; }, []);
  const clearContext = useCallback((message: string) => {
    ++generation.current; ++listSequence.current; ++profileSequence.current;
    denied.current = true; context.current = null; checks.current = 0; submitting.current = false;
    setLinkedClient(null); setChecking(false); setAccessError(message); setClients([]); setCursor(null); setClientId(null); setPendingClient(null);
    setDraft(null); setDirty(false); setSaving(false); setSaved(false); setSaveError(null); setProfileError(null); setReloadRequired(false);
  }, []);
  const checkAccess = useCallback(async () => {
    if (!live.current || denied.current) return false;
    const epoch = generation.current;
    ++checks.current; setChecking(true);
    try {
      const verified = await verifyAccess(context.current || undefined);
      if (!live.current || epoch !== generation.current) return false;
      if (verified.error) {
        if (verified.lost) clearContext(verified.error); else setAccessError(verified.error);
        return false;
      }
      // An overlapping first check may have established a context while this one was pending.
      if (context.current && (context.current.userId !== verified.context!.userId || context.current.tenantId !== verified.context!.tenantId)) {
        clearContext("Account or workspace changed. Previous client details and unsaved changes were cleared. Verify access to continue.");
        return false;
      }
      context.current = verified.context!; setAccessError(null); return true;
    } finally {
      if (live.current && epoch === generation.current) { --checks.current; setChecking(checks.current > 0); }
    }
  }, [clearContext]);
  const loadClients = useCallback(async (after: number | null = null) => {
    const sequence = ++listSequence.current, epoch = generation.current;
    const current = () => live.current && epoch === generation.current && sequence === listSequence.current;
    setListBusy(true); setListError(null);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiGet<ClientsResponse>(API + "?limit=50" + (after ? `&cursor=${after}` : ""));
      if (!current()) return;
      const error = responseError(result) || (!validPage(result, after) ? "Client list could not be verified. Try again." : null);
      if (error && accessLost(error)) return clearContext(error);
      if (!await checkAccess() || !current()) return;
      if (error) { setListError(error); return; }
      setClients((rows) => after ? [...rows, ...result.clients!] : result.clients!); setCursor(result.next_cursor!);
    } finally { if (current()) setListBusy(false); }
  }, [checkAccess, clearContext]);
  const loadProfile = useCallback(async (id: number) => {
    const sequence = ++profileSequence.current, epoch = generation.current;
    const current = () => live.current && epoch === generation.current && sequence === profileSequence.current;
    // Do not promote a requested/deep-linked ID into shared child panels until
    // the server has verified that the client belongs to this workspace.
    setClientId(null); setLinkedClient(null); setVersion(0); setPendingClient(null); setDraft(null); setDirty(false); setProfileBusy(true);
    setProfileError(null); setSaveError(null); setSaved(false); setReloadRequired(false);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiGet<ProfileResponse>(`${API}/${id}/profile`);
      if (!current()) return;
      const error = responseError(result) || (!validClient(result.client) || result.client.id !== id
        || !(result.configured === false && result.profile === null || result.configured === true && validProfile(result.profile, id))
        ? "Reporting profile could not be verified. Reload to try again." : null);
      if (error && accessLost(error)) return clearContext(error);
      if (!await checkAccess() || !current()) return;
      if (error) { setProfileError(error === "client_not_found" ? "This client is no longer available in this workspace." : error); return; }
      setLinkedClient(result.client!); setClientId(id); setVersion(result.profile?.version || 0);
      setDraft(result.profile ? profileDraft(result.profile) : newDraft());
    } finally { if (current()) setProfileBusy(false); }
  }, [checkAccess, clearContext]);

  useEffect(() => {
    live.current = true; denied.current = false; context.current = null; ++generation.current;
    setClients([]); setClientId(null); setDraft(null); setAccessError(null); setCursor(null);
    void loadClients();
    const recheck = () => { if (document.visibilityState === "visible") void checkAccess(); };
    const windowEvents = ["focus", "pageshow", "storage"];
    const documentEvents = ["visibilitychange", "ig:navperms-ready"];
    windowEvents.forEach((event) => window.addEventListener(event, recheck));
    documentEvents.forEach((event) => document.addEventListener(event, recheck));
    return () => {
      stop();
      windowEvents.forEach((event) => window.removeEventListener(event, recheck));
      documentEvents.forEach((event) => document.removeEventListener(event, recheck));
    };
  }, [attempt, checkAccess, loadClients, stop]);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("client"));
    if (positiveId(id)) void loadProfile(id);
  }, [attempt, loadProfile]);

  function change(key: keyof Draft, value: string) {
    setDraft((previous) => {
      if (!previous) return null;
      if (key === "report_source" && value !== previous.report_source) {
        return { ...previous, report_source: value as Draft["report_source"], selected_metrics: defaultMetrics(value as Draft["report_source"]) };
      }
      return { ...previous, [key]: value };
    });
    setDirty(true); setSaved(false);
    if (!reloadRequired) setSaveError(null);
  }
  function toggleMetric(key: string) {
    setDraft((previous) => {
      if (!previous) return null;
      const selected = previous.selected_metrics.includes(key)
        ? previous.selected_metrics.filter((metric) => metric !== key)
        : [...previous.selected_metrics, key];
      return { ...previous, selected_metrics: selected };
    });
    setDirty(true); setSaved(false); if (!reloadRequired) setSaveError(null);
  }
  function moveMetric(key: string, direction: -1 | 1) {
    setDraft((previous) => {
      if (!previous) return null;
      const index = previous.selected_metrics.indexOf(key);
      if (index < 0) return previous;
      const target = index + direction;
      if (target < 0 || target >= previous.selected_metrics.length) return previous;
      const next = [...previous.selected_metrics];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...previous, selected_metrics: next };
    });
    setDirty(true); setSaved(false); if (!reloadRequired) setSaveError(null);
  }
  async function save() {
    if (!draft || !dirty || !clientId || submitting.current || reloadRequired || checking || accessError || denied.current) return;
    const error = draftError(draft);
    setSaveError(error); setSaved(false);
    if (error) return;
    const sequence = profileSequence.current, epoch = generation.current;
    const current = () => live.current && epoch === generation.current && sequence === profileSequence.current;
    submitting.current = true; setSaving(true);
    try {
      if (!await checkAccess() || !current()) return;
      const payload = profilePayload(draft, version);
      const result = await apiPut<ProfileResponse>(`${API}/${clientId}/profile`, payload);
      if (!current()) return;
      const failure = responseError(result) || (!result.configured || !validProfile(result.profile, clientId)
        || !saveMatches(result.profile, payload) ? "The save response could not be verified." : null);
      if (failure && accessLost(failure)) return clearContext(failure);
      // Until both context and the save result are verified, a second write is unsafe.
      setReloadRequired(true);
      setSaveError("Save confirmation is pending. If access cannot be verified, reload the profile before trying again.");
      if (!await checkAccess() || !current()) return;
      if (failure) {
        setReloadRequired(true);
        setSaveError(failure === "version_conflict"
          ? "Someone else saved this profile. Your changes are retained. Discard changes and reload the latest profile before editing again."
          : failure === "client_not_found" ? "This client is no longer available. Your changes have not been confirmed."
            : "Save not confirmed. Your changes are retained. Reload the profile before trying again; the server may have received the save.");
        return;
      }
      setDraft(profileDraft(result.profile!)); setVersion(result.profile!.version); setDirty(false); setSaved(true); setReloadRequired(false); setSaveError(null);
    } finally { if (current()) { submitting.current = false; setSaving(false); } }
  }
  const protectedVisible = !checking && !accessError && !!context.current;
  const selected = clients.find((client) => client.id === clientId) || (linkedClient?.id === clientId ? linkedClient : null);
  const ready = !!clientId && !!draft && version > 0 && !dirty && !profileBusy && !saving && !reloadRequired && !profileError;
  function goStep(id: string) {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: "auto", block: "start" }); target?.focus({ preventScroll: true });
  }
  return <main className={styles.workspace} data-ig-no-enhance>
    <div className={styles.inner}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Workspace / Client reporting</p>
        <h1>Turn results into a clear story.</h1>
        <p>Build a client report from the data you trust. Preview the details, get approval and give your client a place to respond.</p>
      </header>
      <nav className={styles.steps} aria-label="Reporting journey">
        {[{id:"report-client",title:"Choose client",note:"Start with a workspace",enabled:protectedVisible},
          {id:"report-setup",title:"Build report",note:"Profile and data sources",enabled:protectedVisible && !!clientId},
          {id:"report-review",title:"Preview & approve",note:"Check before sharing",enabled:protectedVisible && ready},
          {id:"report-share",title:"Share & follow up",note:"Portal and delivery",enabled:protectedVisible && ready}].map((step,index)=><button
            key={step.id} type="button" className={styles.step} disabled={!step.enabled} onClick={()=>goStep(step.id)}>
            <span className={styles.number}>{index+1}</span><span><strong>{step.title}</strong><small>{step.note}</small></span>
          </button>)}
      </nav>
      {checking && <p role="status">Verifying account, workspace and access…</p>}
      {accessError && <><Failure>{accessError}</Failure><button style={button} onClick={() => {
        if (context.current && !denied.current) void checkAccess().then((valid) => { if (valid && !clients.length) void loadClients(); });
        else setAttempt((n) => n + 1);
      }}>Retry access</button></>}
      <div hidden={!protectedVisible}>
        <section id="report-client" tabIndex={-1} className={styles.section} style={card} aria-label="Select client">
          <h2>Choose a client</h2>
          <Field label="Client"><select name="client_id" style={input} value={clientId || ""} disabled={saving || !!pendingClient || !clients.length} onChange={(event) => {
            const id = Number(event.target.value);
            if (!clients.some((client) => client.id === id) || id === clientId) return;
            if (dirty || reloadRequired) setPendingClient(id); else void loadProfile(id);
          }}><option value="" disabled>Choose an active client</option>
            {linkedClient && !clients.some(client => client.id === linkedClient.id) && <option value={linkedClient.id}>{linkedClient.name} (#{linkedClient.id})</option>}
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name} (#{client.id})</option>)}
          </select></Field>
          {pendingClient && <div role="alert"><p>Switching clients discards your unsaved changes.</p>
            <button style={button} onClick={() => void loadProfile(pendingClient)}>Discard changes and switch</button>
            <button style={button} onClick={() => setPendingClient(null)}>Keep editing</button></div>}
          {listBusy && <p role="status">Loading clients…</p>}
          {profileBusy && !clientId && <p role="status">Verifying the selected client…</p>}
          {!clientId && profileError && <Failure>{profileError}</Failure>}
          {listError && <><Failure>{listError}</Failure><button style={button} disabled={listBusy || saving} onClick={() => void loadClients(cursor)}>Retry clients</button></>}
          {!listBusy && !listError && !clients.length && <p>No active clients are available. Ask your workspace administrator to add a client.</p>}
          {cursor && !listError && <button style={button} disabled={listBusy || saving} onClick={() => void loadClients(cursor)}>Load more clients</button>}
        </section>
        {clientId && <div className={styles.context}><strong>{selected?.name || "Selected client"}</strong><span className={styles.pill}>{dirty ? "Unsaved changes" : version ? "Saved profile" : "Setup needed"}</span></div>}
        {clientId && <section id="report-setup" tabIndex={-1} className={styles.section} style={card} aria-label="Client profile">
          <h2>{selected?.name || "Selected client"}</h2>
          {profileBusy && <p role="status">Loading reporting profile…</p>}
          {profileError && <Failure>{profileError}</Failure>}
          {saveError && <Failure>{saveError}</Failure>}
          {draft && <>
            <p role="status">{saved ? "Profile saved." : version ? dirty ? "Unsaved changes." : "Saved profile loaded." : "Not configured. These defaults are unsaved."}</p>
            <form aria-label="Reporting profile" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <fieldset disabled={saving || checking || !!accessError || !!pendingClient} style={{ border: 0, padding: 0 }}>
                <legend>Reporting preferences</legend>
                <div style={grid}>
                  <Field label="Report source"><select name="report_source" style={input} value={draft.report_source} onChange={(event) => change("report_source", event.target.value)}>
                    <option value="search-intel">Search intelligence</option><option value="campaigns">Campaigns</option>
                  </select></Field>
                  <Field label="Default format"><select name="default_format" style={input} value={draft.default_format} onChange={(event) => change("default_format", event.target.value)}>
                    <option value="pdf">PDF</option><option value="pptx">PowerPoint</option><option value="xlsx">Excel</option>
                  </select></Field>
                  <Field label="Report title"><input name="report_title" required maxLength={160} style={input} value={draft.report_title} onChange={(event) => change("report_title", event.target.value)} /></Field>
                  <Field label="Branding"><select name="branding_mode" style={input} value={draft.branding_mode} onChange={(event) => change("branding_mode", event.target.value)}>
                    <option value="workspace">Use workspace branding</option><option value="custom">Custom client branding</option>
                  </select></Field>
                </div>
                <div style={{ marginTop: 16 }}>
                  <h3>Report metrics</h3>
                  <p>Choose and order the metrics included in preview, exports, email and the client portal.</p>
                  <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {orderedMetricEditor(draft.report_source, draft.selected_metrics).map((entry) => {
                      const selected = draft.selected_metrics.includes(entry.key);
                      const index = draft.selected_metrics.indexOf(entry.key);
                      return <li key={entry.key} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <label><input type="checkbox" checked={selected} onChange={() => toggleMetric(entry.key)} /> {entry.label}</label>
                        {selected && <>
                          <button type="button" style={button} disabled={index === 0} onClick={() => moveMetric(entry.key, -1)} aria-label={`Move ${entry.label} up`}>↑</button>
                          <button type="button" style={button} disabled={index === draft.selected_metrics.length - 1} onClick={() => moveMetric(entry.key, 1)} aria-label={`Move ${entry.label} down`}>↓</button>
                        </>}
                      </li>;
                    })}
                  </ol>
                </div>
                <div style={{ marginTop: 16 }}>
                  <h3>Default reporting period</h3>
                  <p>{PERIOD_HELP}</p>
                  <div style={grid}>
                    <Field label="Relative period"><select name="reporting_period" style={input} value={draft.reporting_period} onChange={(event) => change("reporting_period", event.target.value)}>
                      {REPORTING_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
                    </select></Field>
                    <Field label="Timezone (IANA)"><input name="reporting_timezone" required maxLength={64} style={input} value={draft.reporting_timezone}
                      onChange={(event) => change("reporting_timezone", event.target.value)} placeholder="UTC" /></Field>
                  </div>
                </div>
                {draft.branding_mode === "workspace" ? <p>This profile will use the workspace branding preference.</p> : <>
                  <p>Set the client&apos;s agency name, footer and colours. Blank colour fields leave that override unset.</p>
                  <div style={grid}>{BRAND_FIELDS.map(([key, label, max]) => <Field key={key} label={label}>
                    <input name={key} maxLength={max} placeholder={key.endsWith("Color") ? "#RRGGBB" : ""} style={input} value={draft.branding_overrides[key] || ""} onChange={(event) => {
                      const value = event.target.value;
                      setDraft((previous) => previous ? { ...previous, branding_overrides: { ...previous.branding_overrides, [key]: value } } : null);
                      setDirty(true); setSaved(false); if (!reloadRequired) setSaveError(null);
                    }} />
                  </Field>)}</div>
                </>}
                <button type="submit" style={button} disabled={reloadRequired || !dirty}>{saving ? "Saving…" : "Save profile"}</button>
              </fieldset>
            </form>
          </>}
          {!profileBusy && <button style={button} disabled={saving} onClick={() => void loadProfile(clientId)}>
            {dirty || reloadRequired ? "Discard changes and reload" : "Reload profile"}
          </button>}
        </section>}
        {clientId && context.current && !pendingClient && <ClientReportingMappings
          key={`${context.current.userId}:${context.current.tenantId}:${clientId}`}
          clientId={clientId} checkAccess={checkAccess} clearContext={clearContext} />}
        <div id="report-review" tabIndex={-1} className={styles.section}>

        {clientId && context.current && !pendingClient && (draft && version > 0 && !dirty && !profileBusy && !saving && !reloadRequired && !profileError
          ? <ClientReportingReport key={`${context.current.userId}:${context.current.tenantId}:${clientId}:${version}`}
            clientId={clientId} version={version} format={draft.default_format} timezone={draft.reporting_timezone}
            checkAccess={checkAccess} clearContext={clearContext} />
          : <p>Save or reload the reporting profile before previewing and generating reports.</p>)}
        </div>
        <div id="report-share" tabIndex={-1} className={styles.section}>
        {clientId && context.current && !pendingClient && <ClientReportingRecipient
          key={`${context.current.userId}:${context.current.tenantId}:${clientId}:recipient`}
          clientId={clientId} checkAccess={checkAccess} clearContext={clearContext} />}
        {clientId && context.current && !pendingClient && draft && version > 0 && !dirty && !profileBusy && !saving && !reloadRequired && !profileError
          && <ClientReportingSchedule key={`${context.current.userId}:${context.current.tenantId}:${clientId}:schedule`}
            clientId={clientId} defaultFormat={draft.default_format} checkAccess={checkAccess} clearContext={clearContext} />}
        {clientId && context.current && !pendingClient && draft && version > 0 && !dirty && !profileBusy && !saving && !reloadRequired && !profileError
          && <ClientReportingPortal key={`${context.current.userId}:${context.current.tenantId}:${clientId}:portal`}
            clientId={clientId} checkAccess={checkAccess} clearContext={clearContext} />}
        {clientId && context.current && !pendingClient && draft && version > 0 && !dirty && !profileBusy && !saving && !reloadRequired && !profileError
          && <ClientReportingPortalFeedback key={`${context.current.userId}:${context.current.tenantId}:${clientId}:portal-feedback`}
            clientId={clientId} checkAccess={checkAccess} clearContext={clearContext} />}

        </div>
      </div>
    </div>
  </main>;
}
