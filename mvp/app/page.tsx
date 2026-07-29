import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readAgency } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/session";
import styles from "@/styles/mvp.module.css";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  const agency = readAgency();
  const authed = !!(sid && agency && agency.id === sid);

  if (authed) {
    redirect("/agency");
  }

  return (
    <div className={styles.heroGate}>
      <section className={styles.heroCopy}>
        <h1 className={styles.heroBrand}>InfoGenie</h1>
        <p className={styles.heroLead}>
          Run every client from one workspace — research, campaigns, and reports without the
          spreadsheet grind.
        </p>
      </section>
      <section className={styles.heroPanel} id="login">
        <LoginCard error={sp.error} />
      </section>
    </div>
  );
}

function LoginCard({ error }: { error?: string }) {
  return (
    <form className={styles.card} action="/api/session?op=login" method="post">
      <p className={styles.eyebrow}>Agency access</p>
      <h2 className={styles.panelTitle} style={{ marginBottom: 8 }}>
        Sign in to your command center
      </h2>
      <p className={styles.muted} style={{ marginBottom: 16 }}>
        Demo login — any email + password <strong>mvp</strong>
      </p>
      {error === "password" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>Password must be mvp</div>
      ) : null}
      {error === "email" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>Enter a valid email</div>
      ) : null}
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" placeholder="you@agency.com" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" placeholder="mvp" required />
      </div>
      <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`} type="submit">
        Enter InfoGenie →
      </button>
    </form>
  );
}
