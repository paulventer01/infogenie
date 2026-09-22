"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPatch, apiFetch, type ApiResult } from "@/lib/api";
import { API, EDIT, APPROVE, access, allowed, requireOk, emptyForm, buildContract, approvalBody, verifiedDraft,
  type Context, type Brief, type Creative, type Workflow, type Form, type Campaign } from "@/lib/campaignJourney";
import styles from "@/styles/campaign-journey.module.css";

const CREATE = "orchestrator.workflows.create";
const newWorkspace = () => ({ name: "", objective: "traffic", landing: "", platform: "meta", currency: "USD" });
type Options = ApiResult & { briefs: Brief[]; creatives: Creative[] };
export default function CampaignJourney() {
  const [context, setContext] = useState<Context | null>(null);
  const [briefs, setBriefs] = useState<Brief[]>([]), [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]), [drafts, setDrafts] = useState<Campaign[]>([]);
  const [briefId, setBriefId] = useState(""), [workflowId, setWorkflowId] = useState("");
  const [form, setForm] = useState<Form>(emptyForm), [saved, setSaved] = useState<Campaign | null>(null);
  const [dirty, setDirty] = useState(false), [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false), [workspace, setWorkspace] = useState(newWorkspace);
  const createKeys = useRef(new Map<string, string>());
  const bound = useRef<Context | null>(null), generation = useRef(0), pending = useRef(false);
  const keys = useRef(new Map<string, string>());
  const brief = briefs.find(b => String(b.id) === briefId);
  const creative = creatives.find(c => c.id === form.creative);
  const keyFor = (body: object) => { const fingerprint = JSON.stringify(body); if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID()); return keys.current.get(fingerprint)!; };
  const clear = () => { setCreating(false); setWorkspace(newWorkspace()); setBriefs([]); setWorkflows([]); setCreatives([]); setDrafts([]); setSaved(null); setForm(emptyForm()); setWorkflowId(""); setBriefId(""); setConfirm(false); setDirty(false); setContext(null); };
  async function run(action: (ctx: Context, current: () => boolean) => Promise<void>, permission?: string) {
    if (pending.current) return;
    pending.current = true; const request = ++generation.current;
    const current = () => request === generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      let ctx: Context;
      try { ctx = await access(bound.current); } catch (failure) { if (current()) clear(); throw failure; }
      if (!current()) return;
      bound.current = ctx; setContext(ctx);
      if (permission && !allowed(ctx, permission)) throw new Error("You do not have permission for this action.");
      await action(ctx, current);
    } catch (failure) {
      if (current()) { setConfirm(false); setError(failure instanceof Error ? failure.message : "Could not complete this step."); }
    } finally { if (current()) { pending.current = false; setBusy(false); } }
  }
  async function verified<T extends ApiResult>(promise: Promise<T>, ctx: Context, current: () => boolean): Promise<T> {
    const response = await promise;
    try { const fresh = await access(ctx); if (current()) setContext(fresh); }
    catch (failure) { if (current()) clear(); throw failure; }
    if (!current()) throw new Error("The workspace changed. Reload to check the saved result.");
    return requireOk(response);
  }
  function load() {
    clear(); bound.current = null;
    void run(async (ctx, current) => {
      const options = await verified(apiGet<Options>(API + "/journey-options"), ctx, current);
      const list = await verified(apiGet<ApiResult & { workflows: Workflow[] }>("/api/agent-orchestrator/workflows"), ctx, current);
      if (!Array.isArray(options.briefs) || !Array.isArray(list.workflows)) throw new Error("The journey data could not be verified.");
      setBriefs(options.briefs); setWorkflows(list.workflows);
    });
  }
  useEffect(() => {
    let alive = true;
    load();
    const recheck = async () => {
      if (!alive || document.visibilityState === "hidden" || !bound.current) return;
      try {
        const fresh = await access(bound.current);
        if (bound.current && (fresh.permissions.join() !== bound.current.permissions.join() || fresh.admin !== bound.current.admin)) throw new Error("Workspace permissions changed. Reload the journey.");
      } catch (failure) {
        if (!alive) return;
        ++generation.current; pending.current = false; setBusy(false); clear();
        setError(failure instanceof Error ? failure.message : "Workspace access changed.");
      }
    };
    window.addEventListener("focus", recheck); window.addEventListener("storage", recheck);
    document.addEventListener("ig:navperms-ready", recheck); document.addEventListener("visibilitychange", recheck);
    return () => { alive = false; pending.current = false; ++generation.current; window.removeEventListener("focus", recheck); window.removeEventListener("storage", recheck); document.removeEventListener("ig:navperms-ready", recheck); document.removeEventListener("visibilitychange", recheck); };
    // All asynchronous work is bound to the verified workspace and request generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function selectWorkflow(wf?: Workflow) {
    const id = wf?.id || "";
    keys.current.clear();
    setWorkflowId(id); setSaved(null); setDrafts([]); setCreatives([]); setConfirm(false); setDirty(false);
    setForm({ ...emptyForm(), label: brief?.headline.slice(0,200) || "", objective: wf?.objective || "", landing: wf?.landing_page_url || "",
      amount: wf?.advertising_budget ? String(wf.advertising_budget) : "", currency: wf?.currency || "",
      country: wf?.target_markets?.find(m => /^[A-Z]{2}$/.test(m)) || "", audience: wf?.target_audiences?.[0] || "", platform: wf?.selected_platforms?.[0] || "" });
  }
  async function loadWorkflow(id: string, ctx: Context, current: () => boolean) {
      const options = await verified(apiGet<Options>(API + "/journey-options?workflow_id=" + encodeURIComponent(id)), ctx, current);
      const list = await verified(apiGet<ApiResult & { drafts: Campaign[] }>(API + "?workflow_id=" + encodeURIComponent(id)), ctx, current);
      if (!Array.isArray(options.creatives) || !Array.isArray(list.drafts)) throw new Error("The saved campaigns could not be verified.");
      setBriefs(options.briefs); setCreatives(options.creatives);
      setDrafts(list.drafts.filter(d => d.contract?.provenance?.marketing_brief_id).map(d => verifiedDraft(d, ctx.tenantId, id)));
  }
  function chooseWorkflow(id: string) {
    selectWorkflow(workflows.find(w => w.id === id));
    if (id) void run((ctx, current) => loadWorkflow(id, ctx, current));
  }
  function refreshCreatives() {
    void run(async (ctx, current) => {
      const options = await verified(apiGet<Options>(API + "/journey-options?workflow_id=" + encodeURIComponent(workflowId)), ctx, current);
      if (!Array.isArray(options.creatives)) throw new Error("The creative briefs could not be verified.");
      setCreatives(options.creatives); setConfirm(false);
      if (form.creative && !options.creatives.some(c => c.id === form.creative && c.version === creative?.version && c.content_hash === creative?.content_hash)) {
        setForm(v => ({ ...v, creative: "" })); setDirty(true);
        setNotice("The selected creative brief is no longer available with the same approval. Choose an approved creative brief. Your other campaign edits are preserved.");
        return;
      }
      setNotice(options.creatives.length ? "Creative briefs refreshed. Your campaign edits are preserved." : "No approved creative brief yet. Complete creative review in the other tab, then refresh here.");
    });
  }
  function createWorkspace() {
    void run(async (ctx, current) => {
      let landing: URL;
      try { landing = new URL(workspace.landing.trim()); } catch { throw new Error("Enter a valid HTTPS landing page."); }
      if (landing.protocol !== "https:" || landing.username || landing.password) throw new Error("Enter a valid HTTPS landing page.");
      if (!workspace.name.trim()) throw new Error("Enter a campaign workspace name.");
      const body = { expected_tenant_id: ctx.tenantId, expected_actor_user_id: ctx.userId, name: workspace.name.trim(),
        objective: workspace.objective, landing_page_url: landing.href, selected_platforms: [workspace.platform],
        currency: workspace.currency, advertising_budget: 0, credit_ceiling_micros: 0 };
      const fingerprint = JSON.stringify(body);
      if (!createKeys.current.has(fingerprint)) createKeys.current.set(fingerprint, crypto.randomUUID());
      const result = await verified(apiFetch<ApiResult & { workflow: Workflow }>("/api/agent-orchestrator/workflows", {
        method: "POST", headers: { "Idempotency-Key": createKeys.current.get(fingerprint)! }, body: JSON.stringify(body),
      }), ctx, current);
      const wf = result.workflow;
      if (!wf || typeof wf.id !== "string" || !wf.id || typeof wf.name !== "string") throw new Error("The new workspace could not be verified. Reload saved journey before trying again.");
      createKeys.current.delete(fingerprint);
      setWorkflows(rows => [wf, ...rows.filter(w => w.id !== wf.id)]);
      selectWorkflow(wf); setCreating(false); setWorkspace(newWorkspace());
      await loadWorkflow(wf.id, ctx, current);
      setNotice("Campaign workspace created and selected. Complete creative review to prepare your draft.");
    }, CREATE);
  }
  function showDraft(draft: Campaign) {
    const c = draft.contract;
    setSaved(draft); setBriefId(String(c.provenance.marketing_brief_id)); setConfirm(false); setDirty(false);
    const date = new Date(c.schedule.start_at);
    const localStart = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    setForm({ label: draft.label, objective: c.objective, landing: c.destination.landing_page_url, amount: String(c.budget.amount_micros / 1e6),
      currency: c.budget.currency, country: c.geo.countries[0], audience: c.audience?.name || "", start: localStart,
      platform: c.platforms[0], creative: creatives.find(a => a.artifact_id === c.creatives[0]?.asset_id && a.version === c.creatives[0]?.version)?.id || "" });
  }
  function remember(draft: Campaign) { showDraft(draft); setDrafts(rows => [draft, ...rows.filter(d => d.id !== draft.id)]); setConfirm(false); setDirty(false); }
  const editable = !saved || (saved.contract.platforms.length === 1 && saved.contract.creatives.length === 1 && saved.contract.geo.countries.length === 1
    && ["draft", "validation_failed", "ready_for_approval", "approved_for_publish", "approval_expired"].includes(saved.status));
  async function save() {
    if (!brief || !creative || !workflowId) { setError("Choose a saved brief, a campaign workspace and an approved creative brief."); return; }
    void run(async (ctx, current) => {
      const built = buildContract(form, workflowId, brief, creative);
      const oldStart = saved && new Date(saved.contract.schedule.start_at);
      const unchangedStart = oldStart && form.start === new Date(oldStart.getTime() - oldStart.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      const contract = saved ? { ...saved.contract, ...built,
        accounts: form.platform === saved.contract.platforms[0] ? saved.contract.accounts : built.accounts,
        audience: { ...saved.contract.audience, ...built.audience },
        schedule: { ...saved.contract.schedule, start_at: unchangedStart ? saved.contract.schedule.start_at : built.schedule.start_at }, tracking: saved.contract.tracking,
        provenance: { ...saved.contract.provenance, ...built.provenance } } : built;
      const body = { tenant_id: ctx.tenantId, workflow_id: workflowId, label: form.label.trim(), contract,
        ...(saved ? { expected_revision: saved.current_revision, expected_hash: saved.contract_hash } : {}) };
      const response = await verified(saved ? apiPatch<ApiResult & { draft: Campaign }>(API + "/" + encodeURIComponent(saved.id), body)
        : apiPost<ApiResult & { draft: Campaign }>(API, { ...body, idempotency_key: keyFor(body) }), ctx, current);
      remember(verifiedDraft(response.draft, ctx.tenantId, workflowId)); setNotice("Campaign draft saved. Validate it before approval.");
    }, EDIT);
  }
  function transition(kind: "validate" | "approve" | "refresh" | "revoke") {
    if (!saved || dirty) return;
    const target = saved;
    void run(async (ctx, current) => {
      const scope = { tenant_id: ctx.tenantId, draft_id: target.id, ...(kind === "approve" ? approvalBody(target) : {}) };
      const body = kind === "approve" ? { ...scope, idempotency_key: keyFor({ action: "approve", ...scope }) } : kind === "revoke" ? { ...scope, reason: "Approval withdrawn from campaign journey" } : scope;
      const url = API + "/" + encodeURIComponent(target.id);
      const response = await verified(kind === "refresh" ? apiGet<ApiResult & { draft: Campaign }>(url)
        : apiPost<ApiResult & { draft: Campaign }>(url + "/" + kind, body), ctx, current);
      remember(verifiedDraft(response.draft, ctx.tenantId, workflowId));
      if (kind === "revoke") keys.current.clear();
      setNotice(kind === "approve" ? "Approval recorded. This campaign has not been published by this journey." : "Saved campaign status refreshed.");
    }, kind === "approve" || kind === "revoke" ? APPROVE : kind === "validate" ? EDIT : undefined);
  }
  const field = (name: keyof Form, label: string, type = "text", maxLength = 200) => <label>{label}<input name={name} type={type} maxLength={maxLength} value={form[name]} required
    onChange={e => { setForm(v => ({ ...v, [name]: e.target.value })); setDirty(true); setConfirm(false); }} /></label>;
  const select = (name: keyof Form, label: string, values: string[]) => <label>{label}<select name={name} value={form[name]} required onChange={e => { setForm(v => ({ ...v, [name]: e.target.value })); setDirty(true); setConfirm(false); }}>
    <option value="">Choose {label.toLowerCase()}</option>{values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>;
  const expired = saved?.status === "approved_for_publish" && (!saved.approval_expires_at || Date.parse(saved.approval_expires_at) <= Date.now());
  const approvalReady = saved?.status === "ready_for_approval" && saved.validation_status === "passed" && !dirty && !error;
  return <section className={styles.journey} data-ig-no-enhance="true" aria-label="Campaign journey">
    <header className={styles.hero}><p className={styles.eyebrow}>CAMPAIGN WORKSPACE</p><h1>Turn a brief into a reviewed campaign.</h1><p>Choose your source, prepare the details, then approve the saved version.</p>
      <ol className={styles.progress}><li>01 · Marketing brief</li><li>02 · Campaign draft</li><li>03 · Approval</li></ol></header>
    {busy && <p role="status">Checking your workspace…</p>}
    {error && <div role="alert" className={styles.error}><p>{error}</p><button disabled={busy} onClick={load}>Reload saved journey</button></div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {context && <div className={styles.columns}>
      <div><section className={styles.card}><h2>1. Start with the marketing brief</h2>
        <fieldset disabled={busy || dirty || creating}><label>Saved marketing brief<select name="marketing_brief" value={briefId} onChange={e => { setBriefId(e.target.value); setWorkflowId(""); setSaved(null); setDrafts([]); setCreatives([]); setConfirm(false); }}>
          <option value="">Choose a brief</option>{briefs.map(b => <option key={b.id} value={b.id}>{b.brand} — {b.headline} · Brief {b.id}</option>)}</select></label>
          {brief && <div className={styles.source}><h3>{brief.headline}</h3><p>{brief.greeting}</p><small>Source: {brief.generated_by}. Review its evidence before using it.</small><details><summary>Review this saved brief’s evidence</summary>{brief.signals?.map((signal,i) => <p key={i}><strong>{signal.headline}</strong> {signal.detail}</p>)}{brief.sections?.map((section,i) => <div key={i}><h4>{section.title}</h4><ul>{section.items?.map((item,j) => <li key={j}>{item}</li>)}</ul></div>)}{!brief.signals?.length && !brief.sections?.length && <p>No supporting evidence is stored in this brief.</p>}</details>{brief.content_safety_warnings?.map((warning,i) => <p key={i} role="alert">{typeof warning === "string" ? warning : JSON.stringify(warning)}</p>)}</div>}
          {!briefs.length && <p>No saved briefs yet. <Link href="/manage/marketing-brief">Prepare a marketing brief</Link>, then reload this journey.</p>}
          <label>Campaign workspace<select name="campaign_workflow" value={workflowId} disabled={!brief || busy} onChange={e => chooseWorkflow(e.target.value)}>
            <option value="">Choose a campaign workspace</option>{workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        </fieldset>
        {!workflows.length && <p className={styles.notice}>No campaign workspaces yet. Create one here to continue with your selected brief.</p>}
        {!brief && <p>Choose a saved marketing brief first.</p>}
        {allowed(context, CREATE) ? <>
          {!creating ? <button disabled={busy || dirty || !brief} onClick={() => setCreating(true)}>Create campaign workspace</button> :
            <form onSubmit={e => { e.preventDefault(); createWorkspace(); }}>
              <h3>Create campaign workspace</h3>
              <fieldset disabled={busy} className={styles.fields}>
                <label>Workspace name<input name="workspace_name" value={workspace.name} maxLength={200} required onChange={e => setWorkspace(v => ({ ...v, name: e.target.value }))} /></label>
                <label>Workspace landing page<input name="workspace_landing" type="url" value={workspace.landing} maxLength={2048} required placeholder="https://your-site.com" onChange={e => setWorkspace(v => ({ ...v, landing: e.target.value }))} /></label>
                {([['objective', 'Workspace objective', ['awareness','traffic','leads','sales','app']], ['platform', 'Workspace platform', ['meta','google','tiktok']], ['currency', 'Workspace currency', ['USD','EUR','GBP','AUD','CAD']]] as const).map(([name,label,values]) =>
                  <label key={name}>{label}<select name={'workspace_' + name} value={workspace[name]} onChange={e => setWorkspace(v => ({ ...v, [name]: e.target.value }))}>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
                <button type="submit">Create and select workspace</button>
                <button type="button" onClick={() => setCreating(false)}>Cancel workspace setup</button>
              </fieldset>
              <p className={styles.help}>This creates a planning workspace with no spending authorised. Set the campaign budget when preparing your draft.</p>
            </form>}
        </> : <p>Ask a workspace administrator to create a campaign workspace or grant you access to create one.</p>}
        <p className={styles.help}>Showing the latest 30 briefs and 100 campaign workspaces. <Link href="/manage/agent-orchestrator">Manage campaign workspaces and creative approvals</Link>.</p>
      </section>
      {workflowId && <section className={styles.card}><h2>2. Prepare the campaign draft</h2>
        <label>Continue a saved campaign<select name="saved_campaign" disabled={busy || dirty || creating} value={saved?.id || ""} onChange={e => { const d = drafts.find(d => d.id === e.target.value); if (d) showDraft(d); else chooseWorkflow(workflowId); }}>
          <option value="">New campaign draft</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.label} · revision {d.current_revision}</option>)}</select></label>
        <p className={styles.notice}>{!creatives.length ? "An approved creative brief is needed before saving. " : "Need a different or updated creative brief? "}Open <Link href={"/manage/agent-orchestrator?workflow_id=" + encodeURIComponent(workflowId)} target="_blank" rel="noopener noreferrer">creative approvals (opens in a new tab)</Link> for this workspace and complete creative review. Your draft stays open here. Then <button disabled={busy || creating} onClick={refreshCreatives}>Refresh creative briefs</button>.</p>
        {!editable && <p>This draft needs the <Link href="/manage/agent-orchestrator">full campaign editor</Link> to preserve its multiple assets, markets or delivery state.</p>}
        <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy || creating || !editable || !allowed(context, EDIT)} className={styles.fields}>
          {field("label", "Campaign name")}{select("objective", "Objective", ["awareness", "traffic", "leads", "sales", "app"])}
          {select("platform", "Platform", ["meta", "google", "tiktok"])}{field("landing", "Landing page", "url", 2048)}
          {field("amount", "Total advertising budget", "text", 20)}{select("currency", "Currency", ["USD", "EUR", "GBP", "AUD", "CAD"])}
          {field("country", "Country code (for example, US)", "text", 2)}{field("audience", "Audience", "text", 120)}{field("start", "Start time (your local time)", "datetime-local")}
          <label>Approved creative brief<select name="creative" value={form.creative} required onChange={e => { setForm(v => ({ ...v, creative: e.target.value })); setDirty(true); setConfirm(false); }}>
            <option value="">Choose an approved creative brief</option>{creatives.map(c => <option key={c.id} value={c.id}>{c.objective || c.format || "Creative brief"} · version {c.version} · {c.artifact_id}</option>)}</select></label>
          <button type="submit" disabled={!brief || !creative || !!saved && !dirty}>Save campaign draft</button>
        </fieldset></form>
        {dirty && <p role="status">Unsaved changes. Save before validation or approval. <button disabled={busy} onClick={() => saved ? showDraft(saved) : chooseWorkflow(workflowId)}>Discard edits</button></p>}
        <p className={styles.help}>The connected advertising account belonging to the acting user is checked by validation and approval. No campaign is published here.</p>
      </section>}</div>
      <aside className={styles.card}><h2>3. Review and approve</h2>
        {!saved ? <p>Save a campaign to see its approval checklist.</p> : <>
          <h3>{saved.label}</h3><p className={styles.badge}>{expired ? "approval expired — refresh status" : saved.status.replaceAll("_", " ")}</p><p>Saved revision {saved.current_revision}{dirty ? " · edits not saved" : ""}</p>
          <dl><dt>Source brief</dt><dd>{saved.contract.provenance.marketing_brief_id}</dd><dt>Objective</dt><dd>{saved.contract.objective}</dd>
            <dt>Platforms</dt><dd>{saved.contract.platforms.join(", ")}</dd><dt>Budget</dt><dd>{saved.contract.budget.amount_micros / 1e6} {saved.contract.budget.currency}</dd>
            <dt>Landing page</dt><dd>{saved.contract.destination.landing_page_url}</dd><dt>Start</dt><dd>{saved.contract.schedule.start_at}</dd>
            {saved.contract.schedule.end_at && <><dt>End</dt><dd>{saved.contract.schedule.end_at}</dd></>}
            <dt>Audience</dt><dd>{saved.contract.audience?.name}</dd><dt>Markets</dt><dd>{saved.contract.geo.countries.join(", ")}</dd>
            <dt>Creative versions</dt><dd>{saved.contract.creatives.map(c => `${c.asset_id} · v${c.version}`).join(", ")}</dd>
          </dl>
          {saved.validation.errors.length > 0 && <div role="alert"><h3>Resolve before approval</h3><ul>{saved.validation.errors.map((e,i) => <li key={i}>{e.code.replaceAll("_", " ")}{e.field ? ` — ${e.field}` : ""}</li>)}</ul></div>}
          <button disabled={busy || dirty} onClick={() => transition("refresh")}>Refresh saved status</button>
          {allowed(context, EDIT) && ["draft", "validation_failed", "ready_for_approval", "approval_expired"].includes(saved.status) && <button disabled={busy || dirty} onClick={() => transition("validate")}>Validate saved campaign</button>}
          {approvalReady && <><p>Validation passed. Approval applies to this saved campaign’s details and creative versions.</p>
            {allowed(context, APPROVE) ? <><label className={styles.confirm}><input type="checkbox" checked={confirm} disabled={busy} onChange={e => setConfirm(e.target.checked)} />I have reviewed this saved campaign and its budget.</label>
              <button disabled={busy || !confirm} onClick={() => transition("approve")}>Approve saved campaign</button></> : <p>Ask a workspace member with campaign publishing approval permission to review this saved draft.</p>}</>}
          {saved.status === "approved_for_publish" && !expired && <div className={styles.notice}><strong>Approved — not published</strong><p>Approval expires: {saved.approval_expires_at}. Publishing and activation remain separate controlled steps.</p>
            {allowed(context, APPROVE) && <button disabled={busy || dirty} onClick={() => transition("revoke")}>Withdraw approval</button>}</div>}
        </>}
      </aside>
    </div>}
  </section>;
}
