"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ClientSwitcher from "@/components/ClientSwitcher";
import BackNav from "@/components/BackNav";
import styles from "@/styles/mvp.module.css";

type NavItem = { href: string; label: string; icon: string; badge?: number };
type NavSection = { id: string; label: string; items: NavItem[] };

function isItemActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === "/reports") return pathname === "/reports";
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

function sectionContainsPath(section: NavSection, pathname: string) {
  return section.items.some((item) => isItemActive(pathname, item.href));
}

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

  const sections: NavSection[] = useMemo(
    () => [
      {
        id: "agency-ops",
        label: "Agency ops",
        items: [
          { href: "/agency", label: "Command Center", icon: "◆", badge: openAlertCount },
          { href: "/recommendations", label: "Recommendations", icon: "→" },
          { href: "/connectors", label: "Connectors", icon: "⌁" },
          { href: "/attribution", label: "Attribution / ROI", icon: "¤" },
          { href: "/approvals", label: "Approvals", icon: "✓" },
          { href: "/capacity", label: "Capacity & Margin", icon: "%" },
          { href: "/optimize", label: "Budget & Bids", icon: "↑" },
          { href: "/automations", label: "Automations", icon: "⟳" },
          { href: "/reports", label: "Weekly Reports", icon: "▣" },
          { href: "/reports/bulk", label: "Batch Reports", icon: "▤" },
          { href: "/prospects", label: "InstaReports", icon: "◇" },
          { href: "/settings", label: "Settings", icon: "⚙" },
        ],
      },
      {
        id: "day-1",
        label: "Day 1 — Analyse",
        items: [
          { href: "/dashboard", label: "Dashboard", icon: "◈" },
          { href: "/analyse", label: "Analyse", icon: "◎" },
          { href: "/competitors", label: "Competitors", icon: "⇄" },
          { href: "/ads", label: "Ad Spy", icon: "▣" },
          { href: "/keywords", label: "Keywords", icon: "⌕" },
        ],
      },
      {
        id: "day-2-3",
        label: "Day 2–3 — Launch & Create",
        items: [
          { href: "/brand", label: "Brand Foundation", icon: "◎" },
          { href: "/create", label: "Create", icon: "✎" },
          { href: "/campaigns", label: "Campaigns", icon: "▶" },
        ],
      },
      {
        id: "day-5-7",
        label: "Day 5–7 — Reach & Prove",
        items: [
          { href: "/reach", label: "Reach", icon: "➔" },
          { href: "/results", label: "Results", icon: "▦" },
        ],
      },
    ],
    [openAlertCount]
  );

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenSections((prev) => {
      const next = { ...prev };
      for (const section of sections) {
        if (sectionContainsPath(section, pathname)) {
          next[section.id] = true;
        }
      }
      return next;
    });
  }, [pathname, sections]);

  function toggleSection(id: string) {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <div className={styles.brandName}>InfoGenie</div>
          <div className={styles.brandTag}>Agency OS</div>
        </div>

        <div className={styles.clientBlock}>
          <div className={styles.navDay}>Client workspace</div>
          <ClientSwitcher clients={clients} activeClientId={activeClientId} />
        </div>

        <nav className={styles.nav} aria-label="Main">
          {sections.map((section) => {
            const open = !!openSections[section.id];
            const hasActive = sectionContainsPath(section, pathname);
            return (
              <div key={section.id} className={styles.navSection}>
                <button
                  type="button"
                  className={`${styles.navToggle} ${hasActive ? styles.navToggleActive : ""}`}
                  aria-expanded={open}
                  aria-controls={`nav-panel-${section.id}`}
                  onClick={() => toggleSection(section.id)}
                >
                  <span className={styles.navToggleLabel}>{section.label}</span>
                  <span className={`${styles.navChevron} ${open ? styles.navChevronOpen : ""}`} aria-hidden>
                    ▾
                  </span>
                </button>
                <div
                  id={`nav-panel-${section.id}`}
                  className={`${styles.navPanel} ${open ? styles.navPanelOpen : ""}`}
                  hidden={!open}
                >
                  {section.items.map((item) => {
                    const active = isItemActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                      >
                        <span className={styles.navIcon}>{item.icon}</span>
                        <span>{item.label}</span>
                        {item.badge && item.badge > 0 ? (
                          <span className={styles.navBadge}>{item.badge}</span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={styles.railFoot}>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{agencyName}</div>
          <div style={{ marginTop: 4 }}>
            {brandName ? `Client · ${brandName}` : "Select client workspace"}
          </div>
          <div style={{ opacity: 0.8, marginTop: 4 }}>{email}</div>
          <form action="/api/session?op=logout" method="post" style={{ marginTop: 12 }}>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className={styles.main}>
        <div className={styles.backBar}>
          <BackNav fallback="/analyse" />
        </div>
        {children}
      </main>
    </div>
  );
}
