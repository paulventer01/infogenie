"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ClientSwitcher from "@/components/ClientSwitcher";
import styles from "@/styles/mvp.module.css";

const AGENCY_NAV = [
  { href: "/agency", label: "Command Center", icon: "◉" },
  { href: "/reports", label: "Weekly Reports", icon: "▤" },
  { href: "/prospects", label: "InstaReports", icon: "◇" },
];

const CLIENT_NAV: { day: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    day: "Day 1 — Analyse",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "◈" },
      { href: "/competitors", label: "Competitors", icon: "⚔" },
      { href: "/ads", label: "Ad Spy", icon: "▣" },
      { href: "/keywords", label: "Keywords", icon: "⌕" },
    ],
  },
  {
    day: "Day 2–3 — Launch & Create",
    items: [
      { href: "/brand", label: "Brand Foundation", icon: "◎" },
      { href: "/create", label: "Create", icon: "✎" },
      { href: "/campaigns", label: "Campaigns", icon: "▶" },
    ],
  },
  {
    day: "Day 5–7 — Reach & Prove",
    items: [
      { href: "/reach", label: "Reach", icon: "➔" },
      { href: "/results", label: "Results", icon: "▦" },
    ],
  },
];

export default function AppShell({
  children,
  email,
  agencyName,
  brandName,
  clients,
  activeClientId,
  openAlertCount,
}: {
  children: React.ReactNode;
  email: string;
  agencyName: string;
  brandName?: string | null;
  clients: { id: string; name: string }[];
  activeClientId: string | null;
  openAlertCount: number;
}) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <div className={styles.brandName}>InfoGenie</div>
          <div className={styles.brandTag}>MVP · Agency tier</div>
        </div>

        <div className={styles.clientBlock}>
          <div className={styles.navDay}>Agency</div>
          <ClientSwitcher clients={clients} activeClientId={activeClientId} />
        </div>

        <nav className={styles.nav}>
          <div className={styles.navDay}>Agency ops</div>
          {AGENCY_NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
                {item.href === "/agency" && openAlertCount > 0 ? (
                  <span className={styles.navBadge}>{openAlertCount}</span>
                ) : null}
              </Link>
            );
          })}

          {CLIENT_NAV.map((group) => (
            <div key={group.day}>
              <div className={styles.navDay}>{group.day}</div>
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.railFoot}>
          <div>{agencyName}</div>
          <div style={{ marginTop: 4 }}>
            {brandName ? `Client · ${brandName}` : "Select client workspace"}
          </div>
          <div style={{ opacity: 0.7, marginTop: 4 }}>{email}</div>
          <form action="/api/session?op=logout" method="post" style={{ marginTop: 10 }}>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              type="submit"
              style={{ color: "#f4efe6", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25)" }}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
