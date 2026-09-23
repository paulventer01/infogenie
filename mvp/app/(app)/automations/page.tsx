import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { writeAgency } from "@/lib/store";
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
  createAutomation,
  runAutomationOnce,
} from "@/lib/automations";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { AutomationAction, AutomationTrigger } from "@/lib/types";

async function addRule(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const name = String(formData.get("name") || "").trim() || "Untitled automation";
  const trigger = String(formData.get("trigger") || "anomaly_cpa") as AutomationTrigger;
  const action = String(formData.get("action") || "notify_owner") as AutomationAction;
  const clientId = String(formData.get("clientId") || "all") as string | "all";
  const rule = createAutomation(name, clientId, trigger, action);
  writeAgency({
    ...agency,
    automations: [rule, ...(agency.automations || [])],
  });
  redirect("/automations");
}

async function toggleRule(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const id = String(formData.get("id") || "");
  writeAgency({
    ...agency,
    automations: (agency.automations || []).map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r
    ),
  });
  redirect("/automations");
}

async function runRule(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const id = String(formData.get("id") || "");
  writeAgency(runAutomationOnce(agency, id));
  redirect("/automations?ran=1");
}

async function deleteRule(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const id = String(formData.get("id") || "");
  writeAgency({
    ...agency,
    automations: (agency.automations || []).filter((r) => r.id !== id),
  });
  redirect("/automations");
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ ran?: string }>;
}) {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const sp = await searchParams;
  const rules = agency.automations || [];

  return (
    <>
      <PageHeader
        eyebrow="P3 · Automation builder"
        title="Automations"
        sub="When X happens, do Y — across all clients or one. Full builder is the long-term moat; MVP ships trigger → action rules you can toggle and dry-run."
      />

      {sp.ran ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Dry-run recorded (last run timestamp). Production would fire notify/pause/report actions.
        </div>
      ) : null}

      <div className={styles.grid2}>
        <form className={styles.panel} action={addRule}>
          <h2 className={styles.panelTitle}>New rule</h2>
          <div className={styles.field} style={{ marginTop: 12 }}>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" placeholder="CPA spike → notify" required />
          </div>
          <div className={styles.field}>
            <label htmlFor="clientId">Scope</label>
            <select id="clientId" name="clientId" defaultValue="all">
              <option value="all">All clients</option>
              {agency.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="trigger">When</label>
            <select id="trigger" name="trigger" defaultValue="anomaly_cpa">
              {Object.entries(TRIGGER_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="action">Then</label>
            <select id="action" name="action" defaultValue="notify_owner">
              {Object.entries(ACTION_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
            Add automation
          </button>
        </form>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Active rules ({rules.filter((r) => r.enabled).length})</h2>
          {rules.length === 0 ? (
            <p className={styles.muted}>No rules yet — add one on the left.</p>
          ) : (
            <ul className={styles.list}>
              {rules.map((r) => (
                <li key={r.id} className={styles.listItem}>
                  <div className={styles.panelHead}>
                    <strong>
                      {r.name}{" "}
                      <span className={`${styles.chip} ${r.enabled ? styles.chipOk : ""}`}>
                        {r.enabled ? "on" : "off"}
                      </span>
                    </strong>
                    <div className={styles.alertActions}>
                      <form action={toggleRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                          {r.enabled ? "Disable" : "Enable"}
                        </button>
                      </form>
                      <form action={runRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                          Dry-run
                        </button>
                      </form>
                      <form action={deleteRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                  <p className={styles.muted} style={{ margin: "6px 0 0" }}>
                    When <strong>{TRIGGER_LABELS[r.trigger]}</strong> →{" "}
                    <strong>{ACTION_LABELS[r.action]}</strong>
                    {r.clientId !== "all"
                      ? ` · ${agency.clients.find((c) => c.id === r.clientId)?.name || "client"}`
                      : " · all clients"}
                    {r.lastRunAt
                      ? ` · last run ${new Date(r.lastRunAt).toLocaleString()}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
