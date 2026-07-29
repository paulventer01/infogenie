import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getSessionWorkspace } from "@/lib/session";
import { writeWorkspace } from "@/lib/store";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { ContentDraft } from "@/lib/types";

async function createDraft(formData: FormData) {
  "use server";
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) redirect("/");
  const kind = String(formData.get("kind") || "blog") as ContentDraft["kind"];
  const a = ws.analysis;
  const rival = a.competitors[0]?.name || "category leaders";
  const templates: Record<ContentDraft["kind"], { title: string; body: string }> = {
    blog: {
      title: `How ${a.brandName} wins vs ${rival} in ${a.industry}`,
      body: `${a.brand.voice}\n\n1. The comparison buyers actually make\n2. Proof points ${a.brandName} can own this month\n3. A clear next step (demo / trial / call)\n\nKeyword hook: ${a.keywords[0]?.keyword || a.industry}`,
    },
    "cold-email": {
      title: `Cold email — ${a.brandName} ICP opener`,
      body: `Subject: Quick idea for your ${a.industry} pipeline\n\nHi {{first_name}},\n\nNoticed teams comparing ${rival} often hit the same wall: ${a.competitors[0]?.weakness || "generic messaging"}.\n\n${a.brandName} takes a sharper angle — ${a.actions[0]?.title || "proof-led acquisition"}.\n\nWorth a 15-min look?\n\n— ${a.brandName}`,
    },
    ad: {
      title: `Meta ad — ${a.ads[0]?.angle || "switching"} angle`,
      body: `Primary text: ${a.ads[0]?.body || "Proof over promises."}\nHeadline: ${a.brandName} vs the old way\nCTA: ${a.ads[0]?.cta || "Learn more"}\n\nVoice check: ${a.brand.doSay.join(" · ")}`,
    },
    landing: {
      title: `${a.brandName} vs ${rival}`,
      body: `Hero: The clearer ${a.industry} choice when ${rival} feels bloated.\n\nBullets:\n- ${a.swot.strengths[0]}\n- ${a.actions[0]?.why}\n- Pricing signal: ${a.pricingSignals[0]}\n\nCTA: Start free · Brand colors ${a.brand.colors.primary} / ${a.brand.colors.accent}`,
    },
  };
  const t = templates[kind];
  const draft: ContentDraft = {
    id: randomUUID(),
    kind,
    title: t.title,
    body: t.body,
    createdAt: new Date().toISOString(),
  };
  writeWorkspace({ ...ws, drafts: [draft, ...ws.drafts].slice(0, 20) });
  redirect("/create");
}

export default async function CreatePage() {
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) return <NeedAnalysis />;

  return (
    <>
      <PageHeader
        eyebrow="Day 3 · Create"
        title="Draft from your analysis"
        sub="Blog, cold email, ad, or landing copy — grounded in Brand Foundation."
      />
      <div className={styles.grid2}>
        <form className={styles.panel} action={createDraft}>
          <h2 className={styles.panelTitle}>New draft</h2>
          <div className={styles.field} style={{ marginTop: 12 }}>
            <label htmlFor="kind">Format</label>
            <select id="kind" name="kind" defaultValue="blog">
              <option value="blog">Blog / long-form</option>
              <option value="cold-email">Cold email</option>
              <option value="ad">Ad creative</option>
              <option value="landing">Landing page copy</option>
            </select>
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
            Generate draft →
          </button>
        </form>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Recent drafts</h2>
          {ws.drafts.length === 0 ? (
            <p className={styles.muted}>No drafts yet — generate your first from the left.</p>
          ) : (
            <ul className={styles.list}>
              {ws.drafts.map((d) => (
                <li key={d.id} className={styles.listItem}>
                  <strong>
                    {d.title}{" "}
                    <span className={styles.chip} style={{ marginLeft: 6 }}>
                      {d.kind}
                    </span>
                  </strong>
                  <pre
                    className={styles.muted}
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      margin: "8px 0 0",
                    }}
                  >
                    {d.body}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
