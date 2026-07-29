import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readAgency, getActiveClient } from "@/lib/store";
import { loginAgency } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/session";
import styles from "@/styles/mvp.module.css";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!email || !email.includes("@")) {
    redirect("/?error=email");
  }
  if (password !== "mvp") {
    redirect("/?error=password");
  }
  const agency = await loginAgency(email);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, agency.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/agency");
}

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
        <p className={styles.eyebrow} style={{ color: "rgba(244,239,230,.7)" }}>
          Agency MVP · greenfield build
        </p>
        <h1 className={styles.heroBrand}>InfoGenie</h1>
        <p className={styles.heroLead}>
          One platform layer per client: analyse → create → reach → report — plus an agency
          command center for Monday standup.
        </p>
        <div className={styles.chipRow}>
          <span className={styles.chipGold}>Command center</span>
          <span className={styles.chipGold}>Weekly reports</span>
          <span className={styles.chipGold}>InstaReports</span>
        </div>
      </section>
      <section className={styles.heroPanel} id="login">
        <LoginCard error={sp.error} action={loginAction} />
      </section>
    </div>
  );
}

function LoginCard({
  error,
  action,
}: {
  error?: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form className={styles.card} action={action}>
      <p className={styles.eyebrow}>Enter the MVP</p>
      <h2 className={styles.panelTitle} style={{ marginBottom: 8 }}>
        Agency sign in
      </h2>
      <p className={styles.muted} style={{ marginBottom: 16 }}>
        Local demo auth — any email + password <strong>mvp</strong>. Separate from the full
        InfoGenie app.
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
        Open command center →
      </button>
    </form>
  );
}
