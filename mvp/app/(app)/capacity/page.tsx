import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { writeAgency } from "@/lib/store";
import { clientProfitability, memberUtilization } from "@/lib/capacity";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function updateHours(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const assignmentId = String(formData.get("assignmentId") || "");
  const hours = Math.max(0, Number(formData.get("hours") || 0));
  writeAgency({
    ...agency,
    assignments: agency.assignments.map((a) =>
      a.id === assignmentId ? { ...a, hoursThisWeek: hours } : a
    ),
  });
  redirect("/capacity");
}

async function updateRetainer(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const clientId = String(formData.get("clientId") || "");
  const retainerMonthly = Math.max(0, Number(formData.get("retainer") || 0));
  writeAgency({
    ...agency,
    clients: agency.clients.map((c) =>
      c.id === clientId ? { ...c, retainerMonthly } : c
    ),
  });
  redirect("/capacity");
}

export default async function CapacityPage() {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");

  const util = memberUtilization(agency);
  const profit = clientProfitability(agency);
  const overloaded = util.filter((u) => u.overloaded).length;
  const draining = profit.filter((p) => p.draining).length;

  return (
    <>
      <PageHeader
        eyebrow="Agency ops · MVP thin"
        title="Capacity & margin"
        sub="See who's overloaded and which retainers are actually profitable — without a full finance stack."
      />

      <div className={styles.grid3} style={{ marginBottom: 16 }}>
        <div className={`${styles.panel} ${styles.statPanel}`}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{agency.team.length}</span>
            <span className={styles.metricLbl}>Team members</span>
          </div>
        </div>
        <div className={`${styles.panel} ${styles.statPanel}`}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{overloaded}</span>
            <span className={styles.metricLbl}>Overloaded (&gt;90%)</span>
          </div>
        </div>
        <div className={`${styles.panel} ${styles.statPanel}`}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{draining}</span>
            <span className={styles.metricLbl}>Draining accounts</span>
          </div>
        </div>
      </div>

      <div className={styles.grid2}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Team utilization</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Hours</th>
                <th>Util %</th>
              </tr>
            </thead>
            <tbody>
              {util.map((row) => (
                <tr key={row.member.id}>
                  <td>
                    <strong>{row.member.name}</strong>
                    {row.overloaded ? (
                      <span className={`${styles.severity} ${styles.sevhigh}`} style={{ marginLeft: 6 }}>
                        Overloaded
                      </span>
                    ) : null}
                  </td>
                  <td>{row.member.role}</td>
                  <td>
                    {row.assignedHours}/{row.capacity}h
                  </td>
                  <td>{row.utilizationPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className={styles.panelTitle} style={{ marginTop: 20, fontSize: "1rem" }}>
            Adjust hours this week
          </h3>
          <ul className={styles.list}>
            {agency.assignments.slice(0, 12).map((a) => {
              const member = agency.team.find((t) => t.id === a.memberId);
              const client = agency.clients.find((c) => c.id === a.clientId);
              return (
                <li key={a.id} className={styles.listItem}>
                  <strong>
                    {member?.name} → {client?.name}
                  </strong>
                  <form action={updateHours} className={styles.alertActions}>
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <input
                      name="hours"
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={a.hoursThisWeek}
                      style={{ width: 80, padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
                    />
                    <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                      Save
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Client profitability</h2>
          <p className={styles.muted} style={{ marginBottom: 12 }}>
            Margin = retainer − (weekly hours × hourly cost × 4.3). Thin model — not full P&amp;L.
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Retainer</th>
                <th>Labor</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {profit.map((row) => (
                <tr key={row.client.id}>
                  <td>
                    <strong>{row.client.name}</strong>
                    {row.draining ? (
                      <span className={`${styles.severity} ${styles.sevcritical}`} style={{ marginLeft: 6 }}>
                        Draining
                      </span>
                    ) : (
                      <span className={styles.chip} style={{ marginLeft: 6 }}>
                        Healthy
                      </span>
                    )}
                    <div className={styles.muted}>{row.hours}h this week</div>
                  </td>
                  <td>
                    <form action={updateRetainer} className={styles.alertActions}>
                      <input type="hidden" name="clientId" value={row.client.id} />
                      <input
                        name="retainer"
                        type="number"
                        min={0}
                        step={100}
                        defaultValue={row.retainer}
                        style={{ width: 110, padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
                      />
                      <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                        Save
                      </button>
                    </form>
                  </td>
                  <td>${row.laborCost.toLocaleString()}</td>
                  <td>
                    ${row.margin.toLocaleString()} ({row.marginPct}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.muted} style={{ marginTop: 10 }}>
            Thin model for Monday staffing decisions — not a full finance system.
          </p>
        </section>
      </div>
    </>
  );
}
