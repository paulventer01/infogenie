import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getSessionWorkspace } from "@/lib/session";
import { writeWorkspace } from "@/lib/store";
import { brandVoiceCheck } from "@/lib/recommendations";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { Analysis, ContentDraft } from "@/lib/types";

function templatesFor(a: Analysis): Record<ContentDraft["kind"], { title: string; body: string }> {
  const rival = a.competitors[0]?.name || "category leaders";
  return {
    blog: {
      title: `How ${a.brandName} wins vs ${rival} in ${a.industry}`,
      body: `${a.brand.voice}\n\n1. The comparison buyers actually make\n2. Proof points ${a.brandName} can own this month\n3. A clear next step (demo / trial / call)\n\nKeyword hook: ${a.keywords[0]?.keyword || a.industry}\n\nSay: ${a.brand.doSay.join("; ")}`,
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
}

async function createDraft(formData: FormData) {
  "use server";
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) redirect("/");
  const kind = String(formData.get("kind") || "blog") as ContentDraft["kind"];
  const t = templatesFor(ws.analysis)[kind];
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

async function bulkGenerate() {
  "use server";
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) redirect("/");
  const templates = templatesFor(ws.analysis);
  const kinds = Object.keys(templates) as ContentDraft["kind"][];
  const fresh: ContentDraft[] = kinds.map((kind) => {
    const t = templates[kind];
    return {
      id: randomUUID(),
      kind,
      title: t.title,
      body: t.body,
      createdAt: new Date().toISOString(),
    };
  });
  writeWorkspace({ ...ws, drafts: [...fresh, ...ws.drafts].slice(0, 24) });
  redirect("/create?bulk=1");
}

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ bulk?: string }>;
}) {
  const ws = await getSessionWorkspace();
  if (!ws?.analysis) return <NeedAnalysis />;
  const sp = await searchParams;
  const brand = ws.analysis.brand;

  return (
    <>
      <PageHeader
        eyebrow="Day 3 · Create"
        title="Brand-voice content engine"
        sub={`Per-client voice for ${ws.analysis.brandName} — bulk drafts + banned-phrase checks.`}
      />

      {sp.bulk ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Generated all four formats from this client&apos;s brand foundation.
        </div>
      ) : null}

      <section className={styles.panel} style={{ marginBottom: 16 }}>
        <h2 className={styles.panelTitle}>Voice guardrails</h2>
        <p className={styles.muted} style={{ margin: "8px 0" }}>
          Tone: {brand.tone.join(" · ")} · Voice: {brand.voice}
        </p>
        <div className={styles.grid2}>
          <div>
            <strong className={styles.muted}>Do say</strong>
            <ul className={styles.list}>
              {brand.doSay.map((s) => (
                <li key={s} className={styles.listItem}>
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <strong className={styles.muted}>Don&apos;t say</strong>
            <ul className={styles.list}>
              {brand.dontSay.map((s) => (
                <li key={s} className={styles.listItem}>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className={styles.grid2}>
        <div className={styles.stack}>
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
          <form className={styles.panel} action={bulkGenerate}>
            <h2 className={styles.panelTitle}>Bulk pack</h2>
            <p className={styles.muted} style={{ margin: "8px 0 12px" }}>
              One click: blog + cold email + ad + landing for this client&apos;s voice. Biggest scale
              lever for multi-client agencies.
            </p>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Generate all formats
            </button>
          </form>
        </div>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Recent drafts · voice score</h2>
          {ws.drafts.length === 0 ? (
            <p className={styles.muted}>No drafts yet — generate one or run bulk pack.</p>
          ) : (
            <ul className={styles.list}>
              {ws.drafts.map((d) => {
                const check = brandVoiceCheck(d.body, brand);
                return (
                  <li key={d.id} className={styles.listItem}>
                    <div className={styles.panelHead}>
                      <strong>
                        {d.title}{" "}
                        <span className={styles.chip} style={{ marginLeft: 6 }}>
                          {d.kind}
                        </span>
                      </strong>
                      <span
                        className={`${styles.chip} ${check.ok ? styles.chipOk : styles.chipDanger}`}
                      >
                        Voice {check.score}
                        {!check.ok ? " · banned hit" : ""}
                      </span>
                    </div>
                    {!check.ok ? (
                      <p className={styles.muted} style={{ margin: "6px 0 0" }}>
                        Flagged: {check.hits.join(", ")}
                      </p>
                    ) : null}
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
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
