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
    <div className={styles.landing}>
      <header className={styles.landingTop}>
        <div className={styles.heroBrand}>InfoGenie</div>
        <a className={`${styles.btn} ${styles.btnGhost}`} href="#login">
          Start free trial
        </a>
      </header>

      <section className={styles.landingHero}>
        <p className={styles.eyebrow}>AI marketing intelligence for agencies</p>
        <h1 className={styles.landingH1}>Stop drowning in client reports. Start scaling your agency.</h1>
        <p className={styles.landingLead}>
          The AI marketing command center that unifies every platform, catches failing campaigns
          before your clients do, and creates on-brand content for every account — so your team
          bills more and churns less.
        </p>
        <div className={styles.chipRow}>
          <a className={`${styles.btn} ${styles.btnPrimary}`} href="#login">
            Start free trial
          </a>
          <a className={`${styles.btn} ${styles.btnGhost}`} href="#pillars">
            Book a demo
          </a>
        </div>
        <p className={styles.muted} style={{ marginTop: 12 }}>
          Setup in under 15 minutes. No card required. Demo password: <strong>mvp</strong>
        </p>
      </section>

      <section className={styles.landingSection} id="pains">
        <h2 className={styles.landingH2}>The 3 things quietly killing your margin</h2>
        <div className={styles.grid3}>
          <div className={styles.landingBlock}>
            <strong>Reporting eats billable hours</strong>
            <p className={styles.muted}>
              20–40% of your team&apos;s time goes to copy-pasting numbers into decks.
            </p>
          </div>
          <div className={styles.landingBlock}>
            <strong>You find out campaigns failed too late</strong>
            <p className={styles.muted}>Budget bleeds for days before anyone notices.</p>
          </div>
          <div className={styles.landingBlock}>
            <strong>Renewals get shaky without ROI proof</strong>
            <p className={styles.muted}>
              Clients ask &ldquo;what did I get?&rdquo; and the answer is buried across ten
              dashboards.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.landingSection} id="pillars">
        <h2 className={styles.landingH2}>One workspace. Every client. Zero busywork.</h2>
        <div className={styles.grid2}>
          <div className={styles.landingBlock}>
            <strong>White-label reporting on autopilot</strong>
            <p className={styles.muted}>
              Connect GA4, Meta, Google Ads, LinkedIn, TikTok, email, and CRM once. We generate
              branded client reports automatically — your logo, not ours.
            </p>
          </div>
          <div className={styles.landingBlock}>
            <strong>AI that watches every campaign 24/7</strong>
            <p className={styles.muted}>
              Get alerted the moment a CPA spikes or a channel tanks — with a plain-English
              recommendation on what to do about it.
            </p>
          </div>
          <div className={styles.landingBlock}>
            <strong>On-brand content for every client, at scale</strong>
            <p className={styles.muted}>
              Isolated brand profiles keep every client&apos;s voice distinct. Generate ads, emails,
              and social in bulk without the quality drop.
            </p>
          </div>
          <div className={styles.landingBlock}>
            <strong>Prove ROI in one click</strong>
            <p className={styles.muted}>
              Multi-touch attribution and spend-to-revenue insights that make renewal conversations
              easy.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.landingSection}>
        <h2 className={styles.landingH2}>Built for how agencies actually work</h2>
        <div className={styles.chipRow}>
          {[
            "White-label everything",
            "Per-client permissions",
            "Team capacity & profitability",
            "Client approval portal",
            "GDPR-ready",
            "Budget/bid AI",
            "Automation builder",
          ].map((t) => (
            <span key={t} className={styles.chip}>
              {t}
            </span>
          ))}
        </div>
        <blockquote className={styles.landingQuote}>
          &ldquo;We cut reporting from two days to twenty minutes and haven&apos;t lost a client
          since.&rdquo;
          <footer className={styles.muted}>— Demo Agency</footer>
        </blockquote>
      </section>

      <section className={styles.landingCta} id="login">
        <h2 className={styles.landingH2}>Give your team their hours back.</h2>
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
        Start your free trial
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
        Enter command center →
      </button>
    </form>
  );
}
