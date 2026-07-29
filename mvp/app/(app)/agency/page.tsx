import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { addClient, switchActiveClient } from "@/lib/store";
import { allAgencyAlerts, severityLabel } from "@/lib/alerts";
import { allClientStatuses } from "@/lib/client-status";
import { getDataMode } from "@/lib/strict-mode";
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

async function focusClient(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/agency");
  const clientId = String(formData.get("clientId") || "");
  switchActiveClient(agency, clientId);
  redirect("/reports");
}

function ragClass(rag: string) {
  if (rag === "red") return styles.ragRed;
  if (rag === "amber") return styles.ragAmber;
  return styles.ragGreen;
}

export default async function AgencyPage() {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");

  const alerts = allAgencyAlerts(agency).filter((a) => a.status === "open");
  const critical = alerts.filter((a) => a.severity === "critical" || a.severity === "high");
  const statuses = allClientStatuses(agency);
  const mode = getDataMode(agency);

  return (
    <>
      <PageHeader
        eyebrow="Agency · Monday standup"
        title="Command center"
        sub="All clients at a glance — red/amber/green status, alerts, last report, spend signals. No need to open each workspace."
        right={
          <div className={styles.chipRow}>
            <span className={styles.chip}>Data mode: {mode}</span>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/reports/bulk">
              Batch reports →
            </Link>
          </div>
        }
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

      <section className={styles.panel} style={{ marginBottom: 16 }}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Client health board</h2>
          <span className={styles.muted}>Severity × client × owner</span>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Client</th>
              <th>Owner</th>
              <th>Alerts</th>
              <th>Last report</th>
              <th>Spend signal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((row) => (
              <tr key={row.clientId}>
                <td>
                  <span className={`${styles.ragDot} ${ragClass(row.rag)}`} title={row.ragLabel} />
                  <span className={styles.muted} style={{ marginLeft: 6 }}>
                    {row.ragLabel}
                  </span>
                </td>
                <td>
                  <strong>{row.name}</strong>
                  <div className={styles.muted}>{row.domain || "No domain"}</div>
                </td>
                <td>{row.owner}</td>
                <td>{row.openAlerts || "—"}</td>
                <td>
                  {row.lastReportDate ? (
                    <>
                      {new Date(row.lastReportDate).toLocaleDateString()}
                      {row.lastReportStatus ? (
                        <span className={styles.chip} style={{ marginLeft: 6 }}>
                          {row.lastReportStatus}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className={styles.muted}>Not generated</span>
                  )}
                </td>
                <td>
                  {row.spendSignal ? (
                    <span className={`${styles.severity} ${styles.sevhigh}`}>{row.spendSignal}</span>
                  ) : (
                    <span className={styles.muted}>OK</span>
                  )}
                </td>
                <td>
                  <form action={focusClient}>
                    <input type="hidden" name="clientId" value={row.clientId} />
                    <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                      Open →
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className={styles.grid2}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Priority queue</h2>
            <span className={styles.muted}>Cross-workspace</span>
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

        <form className={styles.panel} action={addClientAction}>
          <h2 className={styles.panelTitle}>Add client workspace</h2>
          <p className={styles.muted} style={{ marginBottom: 12 }}>
            One workspace per retainer — integrations, reports, and Day 1–7 loop inside each.
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
    </>
  );
}
