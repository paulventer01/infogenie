import Link from "next/link";
import styles from "@/styles/mvp.module.css";

export function PageHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className={styles.topbar}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.h1}>{title}</h1>
        {sub ? <p className={styles.sub}>{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function NeedAnalysis() {
  return (
    <div className={`${styles.panel} ${styles.empty}`}>
      <p className={styles.h1} style={{ fontSize: "1.6rem" }}>
        Run Analyse first
      </p>
      <p className={styles.muted} style={{ margin: "8px auto 16px", maxWidth: "42ch" }}>
        The MVP loop starts with a domain. Analyse builds competitors, ads, keywords, and brand
        voice for everything downstream.
      </p>
      <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/analyse">
        Analyse a domain →
      </Link>
    </div>
  );
}
