import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { buildRecommendations } from "@/lib/recommendations";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

const SOURCE_LABEL: Record<string, string> = {
  anomaly: "Anomaly",
  analysis: "Analysis",
  connector: "Connector",
  approval: "Approval",
  capacity: "Capacity",
};

export default async function RecommendationsPage() {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");

  const recs = buildRecommendations(agency);
  const p0 = recs.filter((r) => r.priority === "P0").length;

  return (
    <>
      <PageHeader
        eyebrow="Agency · Next actions"
        title="Recommendations"
        sub="Not another dashboard — what to do next and why, ranked from anomalies, analysis, connectors, and margin."
      />

      <div className={`${styles.banner} ${styles.bannerInfo}`}>
        {recs.length === 0
          ? "No open recommendations — sync connectors or run Analyse to surface actions."
          : `${recs.length} actions · ${p0} P0 (do today)`}
      </div>

      {recs.length === 0 ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.muted}>
            Recommendations appear when CPA/spend anomalies fire, connectors break, analysis
            priorities exist, or retainers are draining.
          </p>
          <div className={styles.chipRow} style={{ marginTop: 12 }}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/connectors">
              Sync connectors
            </Link>
            <Link className={`${styles.btn} ${styles.btnGhost}`} href="/analyse">
              Run Analyse
            </Link>
          </div>
        </div>
      ) : (
        <ul className={styles.list}>
          {recs.map((r) => (
            <li key={r.id} className={`${styles.listItem} ${styles.recItem}`}>
              <div className={styles.panelHead}>
                <div className={styles.chipRow}>
                  <span
                    className={`${styles.chip} ${
                      r.priority === "P0"
                        ? styles.chipDanger
                        : r.priority === "P1"
                          ? styles.chipWarn
                          : ""
                    }`}
                  >
                    {r.priority}
                  </span>
                  <span className={styles.chip}>{SOURCE_LABEL[r.source] || r.source}</span>
                  <span className={styles.muted}>{r.clientName}</span>
                </div>
                <Link className={`${styles.btn} ${styles.btnGhost}`} href={r.href}>
                  Open →
                </Link>
              </div>
              <strong className={styles.recAction}>{r.action}</strong>
              <p className={styles.muted} style={{ margin: "8px 0 0" }}>
                Why: {r.why}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
