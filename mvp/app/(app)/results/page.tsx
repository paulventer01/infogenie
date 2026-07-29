import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/session";
import { writeWorkspace } from "@/lib/store";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { ResultsSnapshot } from "@/lib/types";

async function refreshResults() {
  "use server";
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) redirect("/");
  const spend = ws.campaigns[0]?.budgetMonthly || 2500;
  const conversions = Math.max(12, Math.round(spend / 85));
  const revenue = conversions * 220;
  const results: ResultsSnapshot = {
    spend,
    conversions,
    roas: Math.round((revenue / spend) * 100) / 100,
    cac: Math.round(spend / conversions),
    ctr: 1.8,
    note: "Illustrative snapshot — not live platform data. Connect Meta/Google for honest funnel metrics.",
    generatedAt: new Date().toISOString(),
    source: "illustrative",
  };
  writeWorkspace({ ...ws, results });
  redirect("/results");
}

export default async function ResultsPage() {
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) return <NeedAnalysis />;
  const r = ws.results;
  const a = ws.analysis;

  return (
    <>
      <PageHeader
        eyebrow="Day 7 · Prove"
        title="Weekly results"
        sub="Honest funnel view — illustrative until integrations connect. Weekly narrative lives in Reports."
        right={
          <div className={styles.chipRow}>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="/reports">
              Open weekly report →
            </a>
            <form action={refreshResults}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                Refresh snapshot
              </button>
            </form>
          </div>
        }
      />

      {!r ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.muted}>No snapshot yet — refresh to generate the Day 7 view.</p>
        </div>
      ) : (
        <>
          <div className={`${styles.banner} ${styles.bannerWarn}`}>
            {r.note} Source: <strong>{r.source}</strong>
          </div>
          <div className={styles.grid3} style={{ marginBottom: 16 }}>
            <div className={styles.panel}>
              <div className={styles.metric}>
                <span className={styles.metricVal}>{r.roas}×</span>
                <span className={styles.metricLbl}>ROAS</span>
              </div>
            </div>
            <div className={styles.panel}>
              <div className={styles.metric}>
                <span className={styles.metricVal}>${r.cac}</span>
                <span className={styles.metricLbl}>CAC</span>
              </div>
            </div>
            <div className={styles.panel}>
              <div className={styles.metric}>
                <span className={styles.metricVal}>{r.conversions}</span>
                <span className={styles.metricLbl}>Conversions</span>
              </div>
            </div>
          </div>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Weekly report draft</h2>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                lineHeight: 1.55,
                margin: "12px 0 0",
              }}
            >
              {`Weekly marketing report — ${a.brandName}
Domain: ${a.domain} · ${a.industry}

Performance
- Spend: $${r.spend.toLocaleString()}
- ROAS: ${r.roas}× · CAC: $${r.cac} · CTR: ${r.ctr}%
- Conversions: ${r.conversions}

Focus next week
1. ${a.actions[0]?.title}
2. ${a.actions[1]?.title || "Continue creative tests"}
3. ${a.actions[2]?.title || "Protect comparison SERP"}

Competitor watch
${a.competitors.map((c) => `- ${c.name}: ${c.positioning}`).join("\n")}
`}
            </pre>
          </section>
        </>
      )}
    </>
  );
}
