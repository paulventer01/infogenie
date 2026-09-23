import { getSessionWorkspace } from "@/lib/session";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

export default async function AdsPage() {
  const ws = await getSessionWorkspace();
  const a = ws?.analysis;
  if (!a) return <NeedAnalysis />;

  return (
    <>
      <PageHeader
        eyebrow="Day 1 · Ad Spy"
        title="Competitor ad angles"
        sub="Creative patterns to steal (ethically) for your first brief."
      />
      <div className={styles.grid2}>
        {a.ads.map((ad, i) => (
          <article key={`${ad.platform}-${i}`} className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{ad.headline}</h2>
              <span className={styles.chipGold}>{ad.platform}</span>
            </div>
            <p className={styles.muted} style={{ marginTop: 0 }}>
              {ad.advertiser} · angle: {ad.angle}
            </p>
            <p style={{ lineHeight: 1.55 }}>{ad.body}</p>
            <div className={styles.chipRow} style={{ marginTop: 12 }}>
              <span className={styles.chip}>CTA · {ad.cta}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
