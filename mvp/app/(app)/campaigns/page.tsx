import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getSessionWorkspace } from "@/lib/session";
import { writeWorkspace } from "@/lib/store";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { CampaignDraft } from "@/lib/types";

async function createCampaign(formData: FormData) {
  "use server";
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) redirect("/");
  const a = ws.analysis;
  const budget = Math.max(500, Number(formData.get("budget") || 2500));
  const objective = String(formData.get("objective") || "Leads");
  const rival = a.competitors[0]?.name || "category leaders";
  const campaign: CampaignDraft = {
    id: randomUUID(),
    name: `${a.brandName} · ${objective} sprint`,
    objective,
    channels: ["Meta", "Google"],
    budgetMonthly: budget,
    landingHeadline: `${a.brandName} vs ${rival}`,
    landingBody: `Win the comparison. ${a.actions[0]?.why || a.summary}\n\nProof: ${a.swot.strengths[0]}\nOffer: Start in minutes · ${a.pricingSignals[0]}`,
    status: "ready",
    createdAt: new Date().toISOString(),
  };
  writeWorkspace({ ...ws, campaigns: [campaign, ...ws.campaigns].slice(0, 10) });
  redirect("/campaigns");
}

export default async function CampaignsPage() {
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) return <NeedAnalysis />;

  return (
    <>
      <PageHeader
        eyebrow="Day 2 · Launch"
        title="Campaign + landing from one brief"
        sub="MVP creates a ready brief for Meta + Google. Live ad-account push comes next."
      />
      <div className={styles.grid2}>
        <form className={styles.panel} action={createCampaign}>
          <h2 className={styles.panelTitle}>New campaign brief</h2>
          <div className={styles.field} style={{ marginTop: 12 }}>
            <label htmlFor="objective">Objective</label>
            <select id="objective" name="objective" defaultValue="Leads">
              <option>Leads</option>
              <option>Traffic</option>
              <option>Sales</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="budget">Monthly budget (USD)</label>
            <input id="budget" name="budget" type="number" min={500} step={100} defaultValue={2500} />
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
            Build brief →
          </button>
        </form>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Campaigns</h2>
          {ws.campaigns.length === 0 ? (
            <p className={styles.muted}>No campaigns yet.</p>
          ) : (
            <ul className={styles.list}>
              {ws.campaigns.map((c) => (
                <li key={c.id} className={styles.listItem}>
                  <strong>
                    {c.name}{" "}
                    <span className={styles.chipGold} style={{ marginLeft: 6 }}>
                      {c.status}
                    </span>
                  </strong>
                  <div className={styles.muted}>
                    {c.channels.join(" · ")} · ${c.budgetMonthly.toLocaleString()}/mo ·{" "}
                    {c.objective}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <strong>{c.landingHeadline}</strong>
                    <pre
                      className={styles.muted}
                      style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "6px 0 0" }}
                    >
                      {c.landingBody}
                    </pre>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
