import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { writeAgency } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { DataMode } from "@/lib/types";

async function saveSettings(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const dataMode = String(formData.get("dataMode") || "strict") as DataMode;
  const agencyName = String(formData.get("agencyName") || agency.agencyName).trim();
  const accentColor = String(formData.get("accentColor") || "#E8A838").trim();
  const footerText = String(formData.get("footerText") || "").trim();
  writeAgency({
    ...agency,
    agencyName,
    dataMode,
    whiteLabel: {
      agencyName,
      accentColor,
      footerText: footerText || undefined,
    },
  });
  redirect("/settings?saved=1");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const sp = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Agency · Configuration"
        title="Settings"
        sub="Data mode controls whether fabricated metrics can appear. White-label applies to all client-facing exports."
      />

      {sp.saved ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>Settings saved.</div>
      ) : null}

      <form className={styles.panel} action={saveSettings} style={{ maxWidth: 520 }}>
        <h2 className={styles.panelTitle}>Data mode</h2>
        <p className={styles.muted} style={{ marginBottom: 12 }}>
          <strong>Strict</strong> (default): withhold ROAS/CAC/funnel when platforms aren&apos;t
          connected. <strong>Demo</strong>: allow labeled scaffolds for sales previews.
        </p>
        <div className={styles.field}>
          <label htmlFor="dataMode">Mode</label>
          <select id="dataMode" name="dataMode" defaultValue={agency.dataMode || "strict"}>
            <option value="strict">Strict — no fabricated KPIs</option>
            <option value="demo">Demo — labeled scaffolds OK</option>
          </select>
        </div>

        <h2 className={styles.panelTitle} style={{ marginTop: 20 }}>
          White-label
        </h2>
        <div className={styles.field}>
          <label htmlFor="agencyName">Agency name</label>
          <input
            id="agencyName"
            name="agencyName"
            defaultValue={agency.whiteLabel.agencyName}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="accentColor">Accent color</label>
          <input
            id="accentColor"
            name="accentColor"
            type="color"
            defaultValue={agency.whiteLabel.accentColor}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="footerText">Export footer (optional)</label>
          <input
            id="footerText"
            name="footerText"
            placeholder={`Prepared by ${agency.whiteLabel.agencyName}`}
            defaultValue={agency.whiteLabel.footerText || ""}
          />
        </div>

        <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
          Save settings
        </button>
      </form>
    </>
  );
}
