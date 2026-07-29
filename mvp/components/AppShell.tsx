"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/styles/mvp.module.css";

const NAV: { day: string; items: { href: string; label: string; icon: string }[] }[] = [
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
  brandName,
}: {
  children: React.ReactNode;
  email: string;
  brandName?: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <div className={styles.brandName}>InfoGenie</div>
          <div className={styles.brandTag}>MVP · Day 1–7 loop</div>
        </div>
        <nav className={styles.nav}>
          {NAV.map((group) => (
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
          <div>{brandName ? `Workspace · ${brandName}` : "No analysis yet"}</div>
          <div style={{ opacity: 0.7, marginTop: 4 }}>{email}</div>
          <form action="/api/session?op=logout" method="post" style={{ marginTop: 10 }}>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="submit" style={{ color: "#f4efe6", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25)" }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
