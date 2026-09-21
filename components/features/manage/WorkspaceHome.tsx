"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { API, responseError, validPage, validProfile, validClient, verifyAccess,
  type Client, type ClientsResponse, type Context, type ProfileResponse } from "@/lib/clientReporting";
import styles from "@/styles/workspace-home.module.css";

export default function WorkspaceHome() {
  const [clients, setClients] = useState<Client[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const context = useRef<Context | undefined>(undefined);
  const sequence = useRef(0);
  const selectedRef = useRef<number | null>(null);
  const mounted = useRef(false);

  // Every refresh clears client data first. Responses from an older selection or
  // workspace must never repopulate the current screen.
  const load = useCallback(async (id: number | null = null, after: number | null = null) => {
    const request = ++sequence.current;
    const current = () => mounted.current && request === sequence.current;
    setBusy(true); setError(null); setProfile(null);
    if (!after) { setClients([]); setCursor(null); }
    selectedRef.current = id; setSelected(id);
    try {
      const before = await verifyAccess(context.current);
      if (!current()) return;
      if (before.error || !before.context) throw new Error(before.error || "Workspace access could not be verified.");
      context.current = before.context;
      const page = await apiGet<ClientsResponse>(`${API}?limit=50${after ? `&cursor=${after}` : ""}`);
      if (!current()) return;
      const pageError = responseError(page);
      if (pageError || !validPage(page, after)) throw new Error(pageError || "The client list could not be verified.");
      let detail: ProfileResponse | null = null;
      if (id !== null) {
        detail = await apiGet<ProfileResponse>(`${API}/${id}/profile`);
        if (!current()) return;
        const detailError = responseError(detail);
        if (detailError || !validClient(detail.client) || detail.client.id !== id
          || !(detail.configured === false && detail.profile === null || detail.configured === true && validProfile(detail.profile, id))) {
          throw new Error(detailError || "The reporting setup could not be verified.");
        }
      }
      const afterAccess = await verifyAccess(context.current);
      if (!current()) return;
      if (afterAccess.error) throw new Error(afterAccess.error);
      setClients(rows => after ? [...rows, ...page.clients!] : page.clients!);
      setCursor(page.next_cursor!); setProfile(detail);
    } catch (failure) {
      if (!current()) return;
      setClients([]); setCursor(null); selectedRef.current = null; setSelected(null); setProfile(null);
      context.current = undefined;
      setError(failure instanceof Error ? failure.message : "Could not load this workspace. Please try again.");
    } finally { if (current()) setBusy(false); }
  }, []);

  const stop = useCallback(() => { mounted.current = false; ++sequence.current; }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const recheck = () => { if (document.visibilityState === "visible") void load(selectedRef.current); };
    const windowEvents = ["focus", "pageshow", "storage"];
    const documentEvents = ["visibilitychange", "ig:navperms-ready"];
    windowEvents.forEach(event => window.addEventListener(event, recheck));
    documentEvents.forEach(event => document.addEventListener(event, recheck));
    return () => {
      stop();
      windowEvents.forEach(event => window.removeEventListener(event, recheck));
      documentEvents.forEach(event => document.removeEventListener(event, recheck));
    };
  }, [load, stop]);

  const reporting = selected && profile ? `/manage/client-reporting?client=${selected}` : "/manage/client-reporting";
  return <section className={styles.workspace} data-ig-no-enhance="true" aria-label="Workspace overview">
    <header className={styles.hero}>
      <p className={styles.eyebrow}>YOUR WORKSPACE</p>
      <h1>A clear place to start.</h1>
      <p>Choose a client, prepare their report, and review it before sharing.</p>
      <Link className={styles.primary} href={reporting}>Open client reporting <span aria-hidden="true">→</span></Link>
    </header>
    <div className={styles.columns}>
      <section className={styles.card} aria-labelledby="workspace-client-title" aria-busy={busy}>
        <p className={styles.eyebrow}>01 / CLIENT CONTEXT</p>
        <h2 id="workspace-client-title">Who are you working on?</h2>
        <p>Reporting clients available to your current account and workspace.</p>
        {busy && <p role="status">Loading your workspace…</p>}
        {error && <div role="alert" className={styles.error}><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>}
        {!busy && !error && <>
          {clients.length > 0 ? <label className={styles.field}>Client
            <select name="workspace_client" value={selected ?? ""} onChange={event => void load(event.target.value ? Number(event.target.value) : null)}>
              <option value="">Choose a client</option>
              {/* A selected client can be outside the first page after a refresh. */}
              {profile?.client && !clients.some(client => client.id === profile.client!.id) && <option value={profile.client.id}>{profile.client.name}</option>}
              {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label> : <p>No active reporting clients are available. Ask your workspace administrator to add a client.</p>}
          {cursor && <button type="button" onClick={() => void load(selected, cursor)}>Load more clients</button>}
          <div className={styles.setup}>
            <h3>{profile?.client?.name || "Your next step"}</h3>
            {!profile ? <p>Select a client to see their saved reporting setup.</p> : profile.configured ? <>
              <span className={styles.badge}>Reporting profile saved</span>
              <p>{profile.profile!.report_title}</p>
              <p>Review source mapping and report data before requesting approval.</p>
              <Link href={reporting}>Continue this client’s report →</Link>
            </> : <>
              <span className={styles.badge}>Setup needed</span>
              <p>Choose the report source, metrics, branding and reporting period for this client.</p>
              <Link href={reporting}>Set up this client’s report →</Link>
            </>}
          </div>
        </>}
      </section>
      <section className={styles.card} aria-labelledby="workspace-journey-title">
        <p className={styles.eyebrow}>02 / YOUR REPORTING JOURNEY</p>
        <h2 id="workspace-journey-title">From setup to a client-ready report</h2>
        <ol className={styles.steps}>
          <li><strong>Choose the client</strong><p>Keep work attached to the right client.</p></li>
          <li><strong>Connect the evidence</strong><p>Map sources and check what data is available.</p></li>
          <li><strong>Review and approve</strong><p>Inspect the report and complete the required approval.</p></li>
          <li><strong>Share with confidence</strong><p>Use the reporting workspace’s delivery and portal controls.</p></li>
        </ol>
        <p className={styles.note}>A saved profile is setup progress. It does not mean a report has been approved or sent.</p>
      </section>
    </div>
    <section className={styles.card} aria-labelledby="workspace-tools-title">
      <p className={styles.eyebrow}>03 / KEEP WORK MOVING</p>
      <h2 id="workspace-tools-title">Continue your work</h2>
      <div className={styles.shortcuts}>
        <Link href="/manage/campaign-journey"><strong>Campaign journey →</strong><span>Turn a saved marketing brief into a campaign draft for approval.</span></Link>
        <Link href="/manage/marketing-brief"><strong>Marketing brief →</strong><span>Review the brief for your next marketing task.</span></Link>
        <Link href="/analyse"><strong>Analyse a business →</strong><span>Start a new business and competitor analysis.</span></Link>
        <Link href={reporting}><strong>Client reporting →</strong><span>Prepare reports, review approvals and manage sharing.</span></Link>
      </div>
    </section>
  </section>;
}
