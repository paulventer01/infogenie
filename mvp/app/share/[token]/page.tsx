import { notFound } from "next/navigation";
import { findProspectByToken } from "@/lib/store";
import { buildInstaReportSummary } from "@/lib/reports";
import { WhiteLabelFooter, WhiteLabelHeader } from "@/components/WhiteLabelChrome";
import styles from "@/styles/mvp.module.css";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = findProspectByToken(token);
  if (!found?.prospect.analysis) notFound();

  const { agency, prospect } = found;
  const a = prospect.analysis!;
  const accent = agency.whiteLabel.accentColor || "#0F766E";

  return (
    <div className={styles.sharePage} style={{ ["--wl-accent" as string]: accent }}>
      <WhiteLabelHeader
        whiteLabel={agency.whiteLabel}
        title={`Marketing audit — ${prospect.prospectName}`}
        sub={`${a.domain} · ${a.industry} · Prepared ${new Date(prospect.createdAt).toLocaleDateString()}`}
      />

      <div className={`${styles.banner} ${styles.bannerInfo}`}>
        {a.source === "scaffold"
          ? "Scaffold audit — connect live data keys for full intelligence depth."
          : "AI-assisted audit — competitor, keyword, and creative signals for your market."}
      </div>

      <section className={styles.panel}>
        <pre className={styles.exportBox}>{buildInstaReportSummary(a, agency)}</pre>
      </section>

      <section className={styles.panel} style={{ marginTop: 16 }}>
        <h2 className={styles.panelTitle}>Competitor snapshot</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Competitor</th>
              <th>Positioning</th>
              <th>Ad presence</th>
            </tr>
          </thead>
          <tbody>
            {a.competitors.map((c) => (
              <tr key={c.domain}>
                <td>
                  <strong>{c.name}</strong>
                  <div className={styles.muted}>{c.domain}</div>
                </td>
                <td>{c.positioning}</td>
                <td>{c.adPresence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <WhiteLabelFooter whiteLabel={agency.whiteLabel} />
    </div>
  );
}
