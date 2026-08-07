import Link from "next/link";
import { getSessionWorkspace } from "@/lib/session";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

export default async function DashboardPage() {
  const ws = await getSessionWorkspace();
  const a = ws?.analysis;
  if (!a) return <NeedAnalysis />;

  return (
    <>
      <PageHeader
        eyebrow="Day 1 · Overview"
        title={`${a.brandName} command center`}
        sub={a.summary}
        right={
          <div className={styles.chipRow}>
            <span className={styles.chip}>{a.domain}</span>
            <span className={styles.chip}>{a.industry}</span>
            <span className={a.source === "ai" ? styles.chip : styles.chipGold}>
              {a.source === "ai" ? "AI analysis" : "Layout scaffold"}
            </span>
          </div>
        }
      />

      {a.source === "scaffold" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          No OpenAI key configured — showing a deterministic scaffold so the Day 1–7 loop still
          works. Add <code>OPENAI_API_KEY</code> in <code>mvp/.env.local</code> for live analysis.
        </div>
      ) : null}

      <div className={styles.grid3} style={{ marginBottom: 16 }}>
        <div className={styles.panel}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{a.competitors.length}</span>
            <span className={styles.metricLbl}>Competitors mapped</span>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{a.ads.length}</span>
            <span className={styles.metricLbl}>Ad angles captured</span>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{a.keywords.length}</span>
            <span className={styles.metricLbl}>Keyword opportunities</span>
          </div>
        </div>
      </div>

      <div className={styles.grid2}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Priority actions</h2>
            <Link href="/campaigns" className={styles.muted}>
              Brief a campaign →
            </Link>
          </div>
          <ul className={styles.list}>
            {a.actions.map((action) => (
              <li key={action.title} className={styles.listItem}>
                <strong>
                  {action.title}{" "}
                  <span className={styles.chip} style={{ marginLeft: 6 }}>
                    {action.effort}
                  </span>
                </strong>
                <span className={styles.muted}>
                  {action.why} · {action.channel}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>SWOT snapshot</h2>
          </div>
          <div className={styles.grid2} style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {(
              [
                ["Strengths", a.swot.strengths],
                ["Weaknesses", a.swot.weaknesses],
                ["Opportunities", a.swot.opportunities],
                ["Threats", a.swot.threats],
              ] as const
            ).map(([label, items]) => (
              <div key={label} className={styles.listItem}>
                <strong>{label}</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 16 }} className={styles.muted}>
                  {items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Tech signals</h2>
          </div>
          <div className={styles.chipRow}>
            {a.techSignals.map((t) => (
              <span key={t} className={styles.chip}>
                {t}
              </span>
            ))}
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Pricing signals</h2>
          </div>
          <ul className={styles.list}>
            {a.pricingSignals.map((p) => (
              <li key={p} className={styles.listItem}>
                {p}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
