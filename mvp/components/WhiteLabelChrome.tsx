import type { WhiteLabel } from "@/lib/types";
import styles from "@/styles/mvp.module.css";

/** Client-facing chrome — agency brand only, never InfoGenie by default. */
export function WhiteLabelHeader({
  whiteLabel,
  title,
  sub,
}: {
  whiteLabel: WhiteLabel;
  title: string;
  sub?: string;
}) {
  const accent = whiteLabel.accentColor || "#0F766E";
  return (
    <header className={styles.wlHeader} style={{ borderTopColor: accent }}>
      <div className={styles.wlBrandRow}>
        <div className={styles.wlMark} style={{ background: accent }} />
        <div>
          <p className={styles.wlAgency}>{whiteLabel.agencyName}</p>
          {whiteLabel.tagline ? <p className={styles.wlTag}>{whiteLabel.tagline}</p> : null}
        </div>
      </div>
      <h1 className={styles.h1}>{title}</h1>
      {sub ? <p className={styles.sub}>{sub}</p> : null}
    </header>
  );
}

export function WhiteLabelFooter({ whiteLabel }: { whiteLabel: WhiteLabel }) {
  const hideVendor = whiteLabel.hideVendorBrand !== false;
  return (
    <footer className={styles.shareFoot}>
      {whiteLabel.footerText || `Prepared by ${whiteLabel.agencyName}`}
      {!hideVendor ? <span className={styles.muted}> · Built with InfoGenie</span> : null}
      <div className={styles.wlCompliance}>
        Client data is isolated to this workspace. Processing under your agency DPA / GDPR
        obligations.
      </div>
    </footer>
  );
}
