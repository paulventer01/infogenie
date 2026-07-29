import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/session";
import { updateActiveClient } from "@/lib/store";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import { buildRoiNarrative, buildConnectedResults } from "@/lib/roi";
import {
  allowIllustrativeResults,
  getDataMode,
  sanitizeResultsForDisplay,
  withholdReason,
} from "@/lib/strict-mode";
import styles from "@/styles/mvp.module.css";

async function syncLiveData() {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.analysis) redirect("/");
  const results = buildConnectedResults(ctx.client);
  if (!results) redirect("/results?error=no-integration");
  updateActiveClient(ctx.agency, (c) => ({ ...c, results }));
  redirect("/results");
}

async function loadDemoSnapshot() {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.analysis) redirect("/");
  const mode = getDataMode(ctx.agency);
  if (!allowIllustrativeResults(mode)) redirect("/results?error=strict");
  const spend = ctx.client.campaigns[0]?.budgetMonthly || 2500;
  const conversions = Math.max(12, Math.round(spend / 85));
  const revenue = conversions * 220;
  updateActiveClient(ctx.agency, (c) => ({
    ...c,
    results: {
      spend,
      conversions,
      roas: Math.round((revenue / spend) * 100) / 100,
      cac: Math.round(spend / conversions),
      ctr: 1.8,
      note: "Demo scaffold — switch to demo mode in Settings or connect live integrations.",
      generatedAt: new Date().toISOString(),
      source: "illustrative",
    },
  }));
  redirect("/results");
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const sp = await searchParams;
  const { client, agency } = ctx;
  if (!client.analysis) return <NeedAnalysis />;

  const mode = getDataMode(agency);
  const displayResults = sanitizeResultsForDisplay(client.results, client, mode);
  const roi = buildRoiNarrative(client, mode);
  const connected = client.integrations.some((i) => i.status === "connected");

  return (
    <>
      <PageHeader
        eyebrow="Day 7 · Prove ROI"
        title="Client retention story"
        sub="One narrative tying activity → measurable outcomes. Strict mode withholds metrics that aren't real."
        right={
          <div className={styles.chipRow}>
            <Link className={`${styles.btn} ${styles.btnGhost}`} href="/attribution">
              Attribution →
            </Link>
            <Link className={`${styles.btn} ${styles.btnGhost}`} href="/reports">
              Weekly report →
            </Link>
            {connected ? (
              <form action={syncLiveData}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                  Sync live data
                </button>
              </form>
            ) : null}
          </div>
        }
      />

      <div className={`${styles.banner} ${mode === "strict" ? styles.bannerWarn : styles.bannerInfo}`}>
        Data mode: <strong>{mode}</strong>
        {mode === "strict"
          ? " — ROAS/CAC/funnel withheld until Meta or Google is connected and synced."
          : " — demo scaffolds allowed; clearly labeled."}
      </div>

      {sp.error === "strict" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Demo snapshots disabled in strict mode. Connect integrations or switch to demo mode in
          Settings.
        </div>
      ) : null}
      {sp.error === "no-integration" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          No connected ad platform — connect Meta or Google in the client workspace first.
        </div>
      ) : null}

      <section className={styles.panel} style={{ marginBottom: 16 }}>
        <h2 className={styles.panelTitle}>{roi.headline}</h2>
        <p style={{ lineHeight: 1.55, margin: "8px 0 0" }}>{roi.summary}</p>
      </section>

      {!displayResults ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.h1} style={{ fontSize: "1.4rem" }}>
            No results yet
          </p>
          <p className={styles.muted} style={{ margin: "8px auto 16px", maxWidth: "48ch" }}>
            {withholdReason(client, mode) ||
              "Connect Meta or Google Ads, then sync live data for the client-facing ROI story."}
          </p>
          <div className={styles.chipRow} style={{ justifyContent: "center" }}>
            {connected ? (
              <form action={syncLiveData}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                  Sync from connected platforms
                </button>
              </form>
            ) : null}
            {allowIllustrativeResults(mode) ? (
              <form action={loadDemoSnapshot}>
                <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                  Load demo scaffold
                </button>
              </form>
            ) : (
              <Link className={`${styles.btn} ${styles.btnGhost}`} href="/settings">
                Switch to demo mode →
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.grid3} style={{ marginBottom: 16 }}>
          <div className={styles.panel}>
            <div className={styles.metric}>
              <span className={styles.metricVal}>{displayResults.roas}×</span>
              <span className={styles.metricLbl}>ROAS</span>
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.metric}>
              <span className={styles.metricVal}>${displayResults.cac}</span>
              <span className={styles.metricLbl}>CAC</span>
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.metric}>
              <span className={styles.metricVal}>{displayResults.conversions}</span>
              <span className={styles.metricLbl}>Conversions</span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.sectionGrid}>
        {roi.sections.map((section) => (
          <section
            key={section.title}
            className={`${styles.sectionCard} ${
              section.status === "withheld"
                ? styles.sectionWithheld
                : section.status === "empty"
                  ? styles.sectionEmpty
                  : styles.sectionOk
            }`}
          >
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{section.title}</h2>
              <span className={styles.chip}>{section.status}</span>
            </div>
            <ul className={styles.list}>
              {section.items.map((item) => (
                <li key={item} className={styles.listItem}>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
