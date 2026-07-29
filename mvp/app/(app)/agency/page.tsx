import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { addClient } from "@/lib/store";
import { allAgencyAlerts, severityLabel } from "@/lib/alerts";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function addClientAction(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const name = String(formData.get("name") || "").trim();
  const owner = String(formData.get("owner") || "").trim();
  const domain = String(formData.get("domain") || "").trim() || undefined;
  if (!name || !owner) redirect("/agency");
  addClient(agency, name, owner, domain);
  redirect("/agency");
}

async function acknowledgeAlert(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const alertId = String(formData.get("alertId") || "");
  const clientId = String(formData.get("clientId") || "");
  const clients = agency.clients.map((c) => {
    if (c.id !== clientId) return c;
    const ids = c.acknowledgedAlertIds || [];
    if (ids.includes(alertId)) return c;
    return { ...c, acknowledgedAlertIds: [...ids, alertId] };
  });
  const { writeAgency } = await import("@/lib/store");
  writeAgency({ ...agency, clients });
  redirect("/agency");
}

export default async function AgencyPage() {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");

  const alerts = allAgencyAlerts(agency).filter((a) => a.status === "open");
  const critical = alerts.filter((a) => a.severity === "critical" || a.severity === "high");

  return (
    <>
      <PageHeader
        eyebrow="Agency · Monday standup"
        title="Command center"
        sub="All clients, severity-ranked alerts, and owner assignment — one view before the week starts."
      />

      <div className={styles.grid3} style={{ marginBottom: 16 }}>
        <div className={styles.panel}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{agency.clients.length}</span>
            <span className={styles.metricLbl}>Client workspaces</span>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{alerts.length}</span>
            <span className={styles.metricLbl}>Open alerts</span>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{critical.length}</span>
            <span className={styles.metricLbl}>Need action today</span>
          </div>
        </div>
      </div>

      <div className={styles.grid2}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Priority queue</h2>
            <span className={styles.muted}>Severity-ranked</span>
          </div>
          {alerts.length === 0 ? (
            <p className={styles.muted}>No open alerts — all clients look stable.</p>
          ) : (
            <ul className={styles.list}>
              {alerts.map((alert) => (
                <li key={alert.id} className={styles.alertRow}>
                  <div className={styles.alertTop}>
                    <span className={`${styles.severity} ${styles[`sev${alert.severity}`]}`}>
                      {severityLabel(alert.severity)}
                    </span>
                    <strong>{alert.title}</strong>
                  </div>
                  <p className={styles.muted}>{alert.detail}</p>
                  <div className={styles.alertMeta}>
                    <span>{alert.clientName}</span>
                    <span>Owner: {alert.owner}</span>
                    <span className={styles.chip}>{alert.category}</span>
                  </div>
                  <div className={styles.alertActions}>
                    <form action={acknowledgeAlert}>
                      <input type="hidden" name="alertId" value={alert.id} />
                      <input type="hidden" name="clientId" value={alert.clientId} />
                      <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                        Acknowledge
                      </button>
                    </form>
                    <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/reports">
                      Open report →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Client roster</h2>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Owner</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {agency.clients.map((c) => {
                  const open = c.alerts.filter((a) => a.status === "open").length;
                  const broken = c.integrations.filter((i) => i.status === "broken").length;
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <div className={styles.muted}>{c.domain || "No domain"}</div>
                      </td>
                      <td>{c.owner}</td>
                      <td>
                        {broken > 0 ? (
                          <span className={`${styles.severity} ${styles.sevhigh}`}>
                            {broken} integration{broken > 1 ? "s" : ""} broken
                          </span>
                        ) : open > 0 ? (
                          <span className={styles.chip}>{open} alert{open > 1 ? "s" : ""}</span>
                        ) : (
                          <span className={styles.chip}>OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <form className={styles.panel} action={addClientAction}>
            <h2 className={styles.panelTitle}>Add client workspace</h2>
            <p className={styles.muted} style={{ marginBottom: 12 }}>
              One workspace per client — plug integrations and run the Day 1–7 loop inside it.
            </p>
            <div className={styles.field}>
              <label htmlFor="name">Client name</label>
              <input id="name" name="name" placeholder="Acme Corp" required />
            </div>
            <div className={styles.field}>
              <label htmlFor="owner">Account owner</label>
              <input id="owner" name="owner" placeholder="jamie" required />
            </div>
            <div className={styles.field}>
              <label htmlFor="domain">Domain (optional)</label>
              <input id="domain" name="domain" placeholder="acme.com" />
            </div>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Add workspace →
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
