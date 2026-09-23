import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/session";
import { updateActiveClient } from "@/lib/store";
import { buildAttribution, renewalTalkingPoints } from "@/lib/attribution";
import { getDataMode, canShowLiveMetrics } from "@/lib/strict-mode";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { AttributionModel } from "@/lib/types";

async function generateAttribution(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.analysis) redirect("/");
  const model = String(formData.get("model") || "multi-touch-linear") as AttributionModel["model"];
  const mode = getDataMode(ctx.agency);
  const attribution = buildAttribution(ctx.client, mode, model);
  if (!attribution) redirect("/attribution?error=nodata");
  updateActiveClient(ctx.agency, (c) => ({ ...c, attribution }));
  redirect("/attribution");
}

export default async function AttributionPage({
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
  const attr = client.attribution;
  const live = canShowLiveMetrics(client, mode);
  const points = attr ? renewalTalkingPoints(client, attr) : [];

  return (
    <>
      <PageHeader
        eyebrow="P1 · Attribution / ROI"
        title="Prove ROI in one click"
        sub="Multi-touch attribution and spend-to-revenue insights that make renewal conversations easy."
        right={
          <Link className={`${styles.btn} ${styles.btnGhost}`} href="/results">
            Retention story →
          </Link>
        }
      />

      {!live ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Connect &amp; sync Meta/Google (or TikTok/LinkedIn) in Connectors for live attribution.
          Strict mode withholds fabricated ROI.
        </div>
      ) : (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Live metrics available — generate a multi-touch model for {client.analysis.brandName}.
        </div>
      )}

      {sp.error === "nodata" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          No results yet — sync connectors first, then generate attribution.
        </div>
      ) : null}

      <form className={styles.panel} action={generateAttribution} style={{ marginBottom: 16 }}>
        <h2 className={styles.panelTitle}>Generate attribution model</h2>
        <div className={styles.field} style={{ marginTop: 12, maxWidth: 360 }}>
          <label htmlFor="model">Model</label>
          <select id="model" name="model" defaultValue={attr?.model || "multi-touch-linear"}>
            <option value="multi-touch-linear">Multi-touch linear (recommended)</option>
            <option value="last-click">Last-click</option>
            <option value="first-click">First-click</option>
          </select>
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
          Build attribution →
        </button>
      </form>

      {!attr ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.muted}>
            No attribution model yet. Sync platforms, then generate for a renewal-ready one-pager.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.grid3} style={{ marginBottom: 16 }}>
            <div className={`${styles.panel} ${styles.statPanel}`}>
              <div className={styles.metric}>
                <span className={styles.metricVal}>${attr.totalSpend.toLocaleString()}</span>
                <span className={styles.metricLbl}>Spend</span>
              </div>
            </div>
            <div className={`${styles.panel} ${styles.statPanel}`}>
              <div className={styles.metric}>
                <span className={styles.metricVal}>${attr.totalRevenue.toLocaleString()}</span>
                <span className={styles.metricLbl}>Attributed revenue</span>
              </div>
            </div>
            <div className={`${styles.panel} ${styles.statPanel}`}>
              <div className={styles.metric}>
                <span className={styles.metricVal}>{attr.blendedRoas}×</span>
                <span className={styles.metricLbl}>Blended ROAS</span>
              </div>
            </div>
          </div>

          <section className={styles.panel} style={{ marginBottom: 16 }}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Channel credit · {attr.model}</h2>
              <span className={styles.chip}>{new Date(attr.generatedAt).toLocaleString()}</span>
            </div>
            <p className={styles.muted} style={{ marginBottom: 12 }}>
              {attr.note}
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Role</th>
                  <th>Share</th>
                  <th>Conv</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {attr.touches.map((t) => (
                  <tr key={t.channel}>
                    <td>
                      <strong>{t.channel}</strong>
                    </td>
                    <td>{t.role}</td>
                    <td>{t.sharePct}%</td>
                    <td>{t.conversions}</td>
                    <td>${t.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Renewal talking points</h2>
            <ul className={styles.list}>
              {points.map((p) => (
                <li key={p} className={styles.listItem}>
                  {p}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
