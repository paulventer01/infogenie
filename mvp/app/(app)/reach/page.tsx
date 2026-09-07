import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getSessionWorkspace } from "@/lib/session";
import { writeWorkspace } from "@/lib/store";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { ReachSequence } from "@/lib/types";

async function createSequence() {
  "use server";
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) redirect("/");
  const a = ws.analysis;
  const seq: ReachSequence = {
    id: randomUUID(),
    name: `${a.brandName} · 5-day reach`,
    steps: [
      { day: 0, channel: "Email", action: `Send cold opener using VoC language (${a.brand.doSay[0]})` },
      { day: 1, channel: "LinkedIn", action: `Connect note referencing ${a.competitors[0]?.name || "rival"} gap` },
      { day: 3, channel: "Email", action: `Case-style follow-up → ${a.actions[0]?.title || "priority action"}` },
      { day: 5, channel: "Email", action: "Breakup note with landing CTA from campaign brief" },
    ],
    createdAt: new Date().toISOString(),
  };
  writeWorkspace({ ...ws, sequences: [seq, ...ws.sequences].slice(0, 10) });
  redirect("/reach");
}

export default async function ReachPage() {
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) return <NeedAnalysis />;

  return (
    <>
      <PageHeader
        eyebrow="Day 5 · Reach"
        title="Prospect sequences"
        sub="Email + LinkedIn steps generated from analysis. Sending integrations are Phase 2."
      />
      <div className={styles.grid2}>
        <form className={styles.panel} action={createSequence}>
          <h2 className={styles.panelTitle}>Build a 5-day sequence</h2>
          <p className={styles.muted}>
            Uses your brand voice, top rival, and priority action so outreach matches the rest of
            the loop.
          </p>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit" style={{ marginTop: 12 }}>
            Generate sequence →
          </button>
        </form>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Sequences</h2>
          {ws.sequences.length === 0 ? (
            <p className={styles.muted}>No sequences yet.</p>
          ) : (
            <ul className={styles.list}>
              {ws.sequences.map((s) => (
                <li key={s.id} className={styles.listItem}>
                  <strong>{s.name}</strong>
                  <ol style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                    {s.steps.map((step) => (
                      <li key={`${step.day}-${step.channel}`} className={styles.muted}>
                        Day {step.day} · {step.channel} — {step.action}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
