import { getSessionWorkspace } from "@/lib/session";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

export default async function BrandPage() {
  const ws = await getSessionWorkspace();
  const a = ws?.analysis;
  if (!a) return <NeedAnalysis />;
  const b = a.brand;

  return (
    <>
      <PageHeader
        eyebrow="Day 3 · Brand Foundation"
        title="Voice that powers every draft"
        sub="Stored once from analysis — Create and Campaigns inherit it."
      />
      <div className={styles.grid2}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Voice</h2>
          <p style={{ lineHeight: 1.55 }}>{b.voice}</p>
          <div className={styles.chipRow} style={{ marginTop: 12 }}>
            {b.tone.map((t) => (
              <span key={t} className={styles.chip}>
                {t}
              </span>
            ))}
          </div>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Palette</h2>
          <div className={styles.grid3} style={{ marginTop: 12 }}>
            {Object.entries(b.colors).map(([name, hex]) => (
              <div key={name} className={styles.listItem}>
                <div
                  style={{
                    height: 48,
                    borderRadius: 10,
                    background: hex,
                    marginBottom: 8,
                    border: "1px solid rgba(0,0,0,.08)",
                  }}
                />
                <strong style={{ textTransform: "capitalize" }}>{name}</strong>
                <div className={styles.muted}>{hex}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Do say</h2>
          <ul className={styles.list}>
            {b.doSay.map((x) => (
              <li key={x} className={styles.listItem}>
                {x}
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Don&apos;t say</h2>
          <ul className={styles.list}>
            {b.dontSay.map((x) => (
              <li key={x} className={styles.listItem}>
                {x}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
