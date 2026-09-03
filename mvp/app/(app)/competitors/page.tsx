import { getSessionWorkspace } from "@/lib/session";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

export default async function CompetitorsPage() {
  const ws = await getSessionWorkspace();
  const a = ws?.analysis;
  if (!a) return <NeedAnalysis />;

  return (
    <>
      <PageHeader
        eyebrow="Day 1 · Compete"
        title="Competitor profiles"
        sub={`Who ${a.brandName} is up against in ${a.industry}.`}
      />
      <div className={styles.grid3}>
        {a.competitors.map((c) => (
          <article key={c.domain} className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{c.name}</h2>
              <span className={styles.chip}>{c.adPresence} ads</span>
            </div>
            <p className={styles.muted} style={{ marginTop: 0 }}>
              {c.domain} · est. traffic {c.estimatedTraffic}
            </p>
            <p style={{ lineHeight: 1.5 }}>{c.positioning}</p>
            <div className={styles.list} style={{ marginTop: 12 }}>
              <div className={styles.listItem}>
                <strong>Strength</strong>
                <span className={styles.muted}>{c.strength}</span>
              </div>
              <div className={styles.listItem}>
                <strong>Weakness</strong>
                <span className={styles.muted}>{c.weakness}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
