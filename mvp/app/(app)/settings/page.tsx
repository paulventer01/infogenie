import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { writeAgency } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { canManageSettings, complianceReady, roleLabel } from "@/lib/permissions";
import styles from "@/styles/mvp.module.css";
import type { DataMode, TeamRole } from "@/lib/types";

async function saveSettings(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");

  const sessionRole = String(formData.get("sessionRole") || agency.sessionRole) as TeamRole;
  const nextRole = ["owner", "manager", "strategist", "viewer"].includes(sessionRole)
    ? sessionRole
    : agency.sessionRole;

  // Always allow demo role switching so viewers can elevate themselves in the MVP.
  if (!canManageSettings(agency.sessionRole || "owner")) {
    writeAgency({ ...agency, sessionRole: nextRole });
    redirect("/settings?saved=1");
  }

  const dataMode = String(formData.get("dataMode") || "strict") as DataMode;
  const agencyName = String(formData.get("agencyName") || agency.agencyName).trim();
  const accentColor = String(formData.get("accentColor") || "#0F766E").trim();
  const footerText = String(formData.get("footerText") || "").trim();
  const tagline = String(formData.get("tagline") || "").trim();
  const hideVendorBrand = formData.get("hideVendorBrand") === "on";
  const dataResidencyNote = String(
    formData.get("dataResidencyNote") || agency.compliance?.dataResidencyNote || ""
  ).trim();

  writeAgency({
    ...agency,
    agencyName,
    dataMode,
    sessionRole: nextRole,
    whiteLabel: {
      agencyName,
      accentColor,
      footerText: footerText || undefined,
      tagline: tagline || undefined,
      hideVendorBrand,
    },
    compliance: {
      gdprAcknowledged: formData.get("gdprAcknowledged") === "on",
      consentLogged: formData.get("consentLogged") === "on",
      dpaSigned: formData.get("dpaSigned") === "on",
      dataResidencyNote:
        dataResidencyNote || "EU / UK processing only (configure with legal)",
    },
  });
  redirect("/settings?saved=1");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; denied?: string }>;
}) {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const sp = await searchParams;
  const wl = agency.whiteLabel;
  const compliance = agency.compliance || {
    gdprAcknowledged: false,
    consentLogged: false,
    dataResidencyNote: "EU / UK processing only (configure with legal)",
    dpaSigned: false,
  };
  const ready = complianceReady(agency);
  const canEdit = canManageSettings(agency.sessionRole || "owner");

  return (
    <>
      <PageHeader
        eyebrow="Agency · Configuration"
        title="Settings"
        sub="White-label, data mode, staff roles, and GDPR / DPA acknowledgments — the adoption non-negotiables."
      />

      {sp.saved ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>Settings saved.</div>
      ) : null}
      {sp.denied ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Only owners can change agency settings. Switch session role below (demo) or ask an owner.
        </div>
      ) : null}

      {!ready ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Compliance incomplete — acknowledge GDPR, consent logging, and DPA before pitching enterprise
          clients.
        </div>
      ) : (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Compliance flags set · residency: {compliance.dataResidencyNote}
        </div>
      )}

      <form className={styles.panel} action={saveSettings} style={{ maxWidth: 560 }}>
        <h2 className={styles.panelTitle}>Permissions &amp; roles (demo)</h2>
        <p className={styles.muted} style={{ marginBottom: 12 }}>
          Switch your session role to feel gates. Team roster roles live under Capacity. Clients only
          ever see their own share/review links.
        </p>
        <div className={styles.field}>
          <label htmlFor="sessionRole">Your session role</label>
          <select id="sessionRole" name="sessionRole" defaultValue={agency.sessionRole || "owner"}>
            <option value="owner">Owner — full settings</option>
            <option value="manager">Manager — clients &amp; reports</option>
            <option value="strategist">Strategist — create &amp; analyse</option>
            <option value="viewer">Viewer — read-only</option>
          </select>
        </div>
        <ul className={styles.list} style={{ marginTop: 8, marginBottom: 16 }}>
          {agency.team.map((m) => (
            <li key={m.id} className={styles.listItem}>
              <strong>{m.name}</strong> · {m.role} · {roleLabel(m.teamRole || "strategist")}
            </li>
          ))}
        </ul>

        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
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
            White-label (client portal &amp; reports)
          </h2>
          <p className={styles.muted} style={{ marginBottom: 12 }}>
            Agencies won&apos;t tolerate your logo in front of their clients. Hide vendor brand by
            default.
          </p>
          <div className={styles.field}>
            <label htmlFor="agencyName">Agency name</label>
            <input id="agencyName" name="agencyName" defaultValue={wl.agencyName} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="tagline">Tagline</label>
            <input
              id="tagline"
              name="tagline"
              placeholder="Performance marketing, reported your way"
              defaultValue={wl.tagline || ""}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="accentColor">Accent color</label>
            <input
              id="accentColor"
              name="accentColor"
              type="color"
              defaultValue={wl.accentColor || "#0F766E"}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="footerText">Export footer (optional)</label>
            <input
              id="footerText"
              name="footerText"
              placeholder={`Prepared by ${wl.agencyName}`}
              defaultValue={wl.footerText || ""}
            />
          </div>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              name="hideVendorBrand"
              defaultChecked={wl.hideVendorBrand !== false}
            />
            Hide InfoGenie / vendor branding on client-facing pages
          </label>

          <h2 className={styles.panelTitle} style={{ marginTop: 20 }}>
            Data security &amp; compliance (GDPR)
          </h2>
          <p className={styles.muted} style={{ marginBottom: 12 }}>
            You&apos;re the data custodian for your clients. These flags are the MVP acknowledgment
            surface — wire real DPA/consent tooling in production.
          </p>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              name="gdprAcknowledged"
              defaultChecked={compliance.gdprAcknowledged}
            />
            GDPR processor obligations acknowledged
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" name="consentLogged" defaultChecked={compliance.consentLogged} />
            Client marketing consent logged per workspace
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" name="dpaSigned" defaultChecked={compliance.dpaSigned} />
            Data Processing Agreement on file
          </label>
          <div className={styles.field}>
            <label htmlFor="dataResidencyNote">Data residency note</label>
            <input
              id="dataResidencyNote"
              name="dataResidencyNote"
              defaultValue={compliance.dataResidencyNote}
            />
          </div>

          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
            Save settings
          </button>
        </fieldset>
        {!canEdit ? (
          <p className={styles.muted} style={{ marginTop: 12 }}>
            Agency config is read-only as {roleLabel(agency.sessionRole || "viewer")}. Switch to Owner
            above (demo) or ask an owner.
          </p>
        ) : (
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            type="submit"
            style={{ marginTop: 12 }}
          >
            Save role only
          </button>
        )}
      </form>
    </>
  );
}
