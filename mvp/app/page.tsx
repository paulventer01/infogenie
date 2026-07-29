import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createWorkspace, readWorkspace } from "@/lib/store";
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
  const existing = readWorkspace();
  const ws =
    existing && existing.email === email ? existing : createWorkspace(email);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, ws.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect(ws.analysis ? "/dashboard" : "/#analyse");
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  const ws = readWorkspace();
  const authed = !!(sid && ws && ws.id === sid);

  if (authed && ws?.analysis) {
    redirect("/dashboard");
  }

  return (
    <div className={styles.heroGate}>
      <section className={styles.heroCopy}>
        <p className={styles.eyebrow} style={{ color: "rgba(244,239,230,.7)" }}>
          Second build · greenfield MVP
        </p>
        <h1 className={styles.heroBrand}>InfoGenie</h1>
        <p className={styles.heroLead}>
          One loop: understand the market, launch the campaign, write the assets,
          reach prospects, prove the week — without the 250-panel sprawl.
        </p>
        <div className={styles.chipRow}>
          <span className={styles.chipGold}>Day 1 Analyse</span>
          <span className={styles.chipGold}>Day 2 Launch</span>
          <span className={styles.chipGold}>Day 7 Prove</span>
        </div>
      </section>
      <section className={styles.heroPanel} id="analyse">
        {authed ? <AnalyseCard /> : <LoginCard error={sp.error} action={loginAction} />}
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
        Sign in to your workspace
      </h2>
      <p className={styles.muted} style={{ marginBottom: 16 }}>
        Local demo auth — use any email and password <strong>mvp</strong>. Separate from
        the full InfoGenie app.
      </p>
      {error === "password" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>Password must be mvp</div>
      ) : null}
      {error === "email" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>Enter a valid email</div>
      ) : null}
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" placeholder="you@company.com" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" placeholder="mvp" required />
      </div>
      <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`} type="submit">
        Continue →
      </button>
    </form>
  );
}

async function analyseAction(formData: FormData) {
  "use server";
  const domain = String(formData.get("domain") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  if (!domain) redirect("/?error=domain");

  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  const ws = readWorkspace();
  if (!sid || !ws || ws.id !== sid) redirect("/");

  const { runAnalysis } = await import("@/lib/analyse");
  const analysis = await runAnalysis({ domain, industry: industry || undefined });
  const { writeWorkspace } = await import("@/lib/store");
  writeWorkspace({ ...ws, analysis, results: null });
  redirect("/dashboard");
}

function AnalyseCard() {
  return (
    <form className={styles.card} action={analyseAction}>
      <p className={styles.eyebrow}>Day 1</p>
      <h2 className={styles.panelTitle} style={{ marginBottom: 8 }}>
        Analyse a domain
      </h2>
      <p className={styles.muted} style={{ marginBottom: 16 }}>
        Builds competitors, ad angles, keywords, tech/pricing signals, and brand voice for
        the rest of the loop.
      </p>
      <div className={styles.field}>
        <label htmlFor="domain">Domain</label>
        <input
          id="domain"
          name="domain"
          placeholder="cmtrading.com"
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="industry">Industry (optional)</label>
        <input id="industry" name="industry" placeholder="Fintech & Finance" />
      </div>
      <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`} type="submit">
        Analyse Now →
      </button>
    </form>
  );
}
