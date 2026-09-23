import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/session";
import { updateActiveClient } from "@/lib/store";
import { applyOptimization, generateOptimizations } from "@/lib/optimize";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function regenerate() {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.analysis) redirect("/");
  const optimizations = generateOptimizations(ctx.client);
  updateActiveClient(ctx.agency, (c) => ({ ...c, optimizations }));
  redirect("/optimize");
}

async function applyAction(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const id = String(formData.get("id") || "");
  updateActiveClient(ctx.agency, (c) => applyOptimization(c, id));
  redirect("/optimize?applied=1");
}

async function dismissAction(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const id = String(formData.get("id") || "");
  updateActiveClient(ctx.agency, (c) => ({
    ...c,
    optimizations: (c.optimizations || []).map((o) =>
      o.id === id ? { ...o, status: "dismissed" as const } : o
    ),
  }));
  redirect("/optimize");
}

export default async function OptimizePage({
  searchParams,
}: {
  searchParams: Promise<{ applied?: string }>;
}) {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const sp = await searchParams;
  const { client } = ctx;
  if (!client.analysis) return <NeedAnalysis />;

  const opts = client.optimizations || [];
  const proposed = opts.filter((o) => o.status === "proposed");

  return (
    <>
      <PageHeader
        eyebrow="P2 · AI optimization"
        title="Budget & bid recommendations"
        sub="AI watches sync history and proposes budget/bid moves — apply or dismiss. Full auto-bid is the long-term moat; this is the agency-safe first step."
        right={
          <form action={regenerate}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Generate suggestions
            </button>
          </form>
        }
      />

      {sp.applied ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Applied to campaign budget/status. Review under Campaigns.
        </div>
      ) : null}

      <div className={`${styles.banner} ${styles.bannerWarn}`}>
        Recommendations only — nothing auto-publishes to ad platforms in MVP. Connectors stay
        human-in-the-loop until you enable automations.
      </div>

      {opts.length === 0 ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.muted}>
            No suggestions yet. Sync connectors (ideally 2+ snapshots), then generate. Or seed from
            campaign briefs.
          </p>
          <form action={regenerate} style={{ marginTop: 12 }}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Generate now
            </button>
          </form>
        </div>
      ) : (
        <ul className={styles.list}>
          {opts.map((o) => (
            <li key={o.id} className={`${styles.listItem} ${styles.recItem}`}>
              <div className={styles.panelHead}>
                <div className={styles.chipRow}>
                  <span
                    className={`${styles.chip} ${
                      o.status === "applied"
                        ? styles.chipOk
                        : o.status === "dismissed"
                          ? ""
                          : styles.chipWarn
                    }`}
                  >
                    {o.status}
                  </span>
                  <span className={styles.chip}>{o.channel}</span>
                  <span className={styles.chip}>{o.action.replace(/_/g, " ")}</span>
                  {o.deltaPct !== 0 ? (
                    <span className={styles.muted}>
                      {o.deltaPct > 0 ? "+" : ""}
                      {o.deltaPct}%
                    </span>
                  ) : null}
                </div>
                {o.status === "proposed" ? (
                  <div className={styles.alertActions}>
                    <form action={applyAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                        Apply
                      </button>
                    </form>
                    <form action={dismissAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                        Dismiss
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>
              <strong className={styles.recAction}>{o.title}</strong>
              <p className={styles.muted} style={{ margin: "8px 0 0" }}>
                Why: {o.why}
              </p>
            </li>
          ))}
        </ul>
      )}

      {proposed.length > 0 ? (
        <p className={styles.muted} style={{ marginTop: 16 }}>
          {proposed.length} open ·{" "}
          <Link href="/automations">Wire into automations →</Link>
        </p>
      ) : null}
    </>
  );
}
