import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/session";
import { updateActiveClient, writeAgency } from "@/lib/store";
import {
  connectPlatform,
  disconnectPlatform,
  syncClientMetrics,
} from "@/lib/connectors";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function connectAction(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const platform = String(formData.get("platform") || "");
  updateActiveClient(ctx.agency, (c) => connectPlatform(c, platform));
  redirect("/connectors");
}

async function disconnectAction(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const platform = String(formData.get("platform") || "");
  updateActiveClient(ctx.agency, (c) => disconnectPlatform(c, platform));
  redirect("/connectors");
}

async function syncAction(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const force = String(formData.get("forceAnomaly") || "") === "1";
  const { client, snapshot, anomalies } = syncClientMetrics(ctx.client, {
    forceAnomaly: force,
  });
  if (!snapshot) redirect("/connectors?error=no-ads");
  const next = {
    ...client,
    alerts: [
      ...anomalies,
      ...(client.alerts || []).filter((a) => a.category === "anomaly"),
    ].slice(0, 20),
  };
  writeAgency({
    ...ctx.agency,
    clients: ctx.agency.clients.map((c) => (c.id === next.id ? next : c)),
  });
  redirect(anomalies.length ? "/connectors?synced=anomaly" : "/connectors?synced=1");
}

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ synced?: string; error?: string }>;
}) {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const sp = await searchParams;
  const { client } = ctx;
  const history = client.metricHistory || [];
  const latest = history[0];

  return (
    <>
      <PageHeader
        eyebrow="Live data · MVP thin"
        title={`Connectors — ${client.name}`}
        sub="Connect platforms, sync full metric history, and raise anomaly alerts when CPA/spend/conversions move hard. Broken connectors destroy trust — health and last sync are first-class."
        right={
          <form action={syncAction}>
            <input type="hidden" name="forceAnomaly" value="0" />
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Sync now
            </button>
          </form>
        }
      />

      {sp.error === "no-ads" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Connect Meta, Google Ads, or LinkedIn Ads before syncing.
        </div>
      ) : null}
      {sp.synced === "1" ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Sync complete — metrics updated from connected platforms.
        </div>
      ) : null}
      {sp.synced === "anomaly" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Sync complete — anomalies detected. Check Command Center priority queue.
        </div>
      ) : null}

      <div className={styles.grid2}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Platforms</h2>
          <p className={styles.muted} style={{ marginBottom: 12 }}>
            Deep integrations, not samples: each sync appends history and compares to the prior
            snapshot. OAuth is stubbed in MVP — production wires real Meta/Google tokens.
          </p>
          <ul className={styles.list}>
            {client.integrations.map((i) => (
              <li key={i.platform} className={styles.listItem}>
                <strong>
                  {i.platform}{" "}
                  <span className={styles.chip} style={{ marginLeft: 6 }}>
                    {i.status}
                  </span>
                </strong>
                <span className={styles.muted}>
                  {i.note ||
                    (i.lastSyncedAt
                      ? `Last sync ${new Date(i.lastSyncedAt).toLocaleString()}`
                      : "Not synced yet")}
                </span>
                <div className={styles.alertActions}>
                  {i.status === "connected" ? (
                    <form action={disconnectAction}>
                      <input type="hidden" name="platform" value={i.platform} />
                      <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                        Disconnect
                      </button>
                    </form>
                  ) : (
                    <form action={connectAction}>
                      <input type="hidden" name="platform" value={i.platform} />
                      <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                        Connect
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <form action={syncAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="forceAnomaly" value="1" />
            <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
              Sync with forced anomaly (demo)
            </button>
          </form>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Latest live metrics</h2>
          {!latest ? (
            <p className={styles.muted}>No sync yet — connect an ads platform and sync.</p>
          ) : (
            <>
              <div className={styles.grid3} style={{ marginTop: 12 }}>
                <div className={styles.metric}>
                  <span className={styles.metricVal}>${latest.spend}</span>
                  <span className={styles.metricLbl}>Spend</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricVal}>${latest.cac}</span>
                  <span className={styles.metricLbl}>CAC</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricVal}>{latest.roas}×</span>
                  <span className={styles.metricLbl}>ROAS</span>
                </div>
              </div>
              <p className={styles.muted} style={{ marginTop: 12 }}>
                From {latest.platforms.join(", ")} · {new Date(latest.syncedAt).toLocaleString()}
              </p>
              <h3 className={styles.panelTitle} style={{ marginTop: 20, fontSize: "1rem" }}>
                Sync history
              </h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Spend</th>
                    <th>CAC</th>
                    <th>Conv</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 5).map((h) => (
                    <tr key={h.id}>
                      <td>{new Date(h.syncedAt).toLocaleString()}</td>
                      <td>${h.spend}</td>
                      <td>${h.cac}</td>
                      <td>{h.conversions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </>
  );
}
