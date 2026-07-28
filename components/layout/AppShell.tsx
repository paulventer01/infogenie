"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV_GROUPS, viewToPath, type NavItem } from "@/lib/viewRoutes";
import NavGroup from "./NavGroup";
import AccountMenu from "./AccountMenu";
import styles from "../../styles/shell.module.css";

const LOGO_SVG =
  '<svg width="20" height="20" viewBox="0 0 40 40" fill="none"><path d="M13 20 Q20 10 27 20 Q20 30 13 20Z" fill="white" opacity="0.95"/><circle cx="20" cy="20" r="4" fill="white"/></svg>';

const BELL_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';

const MENU_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

const CHEVRON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';

const BRIEF_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';

const SPARK_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/></svg>';

const LS_ANALYSED = "ig:analysed";
const LS_SIDEBAR = "ig:sidebar-open";

function allGroupsOpen(): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const g of NAV_GROUPS) next[g.key] = true;
  return next;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [navReady, setNavReady] = useState(true);
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Open every group by default so menus never look "empty" on first click.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(allGroupsOpen);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    try {
      // Prefer expanded rail so submenus are visible; honor explicit collapse.
      const stored = localStorage.getItem(LS_SIDEBAR);
      if (stored === "0") setOpen(false);
      else setOpen(true);
      if (localStorage.getItem(LS_ANALYSED)) setNavReady(true);
    } catch {
      /* private browsing */
    }

    fetch("/api/marketing-brief/merged")
      .then((r) => r.json())
      .then((d) => {
        if (d?.brief?.signals?.length > 0) {
          setNavReady(true);
          try {
            localStorage.setItem(LS_ANALYSED, "1");
          } catch {
            /* noop */
          }
        }
      })
      .catch(() => {});
  }, []);

  // Guard against legacy app.js setting #navGroups to horizontal flex.
  useEffect(() => {
    const el = document.getElementById("navGroups");
    if (!el) return;
    const lock = () => {
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.flexWrap = "nowrap";
      el.style.alignItems = "stretch";
    };
    lock();
    const obs = new MutationObserver(lock);
    obs.observe(el, { attributes: true, attributeFilter: ["style"] });
    return () => obs.disconnect();
  }, []);

  // Legacy ig_navperms.js can leave display:none on React rail nodes; strip it.
  useEffect(() => {
    const scrub = () => {
      document
        .querySelectorAll(
          "#ig-side-rail [data-ig-react-nav], #ig-side-rail a[data-view]",
        )
        .forEach((node) => {
          const el = node as HTMLElement;
          el.style.removeProperty("display");
          el.removeAttribute("data-perm-hidden");
        });
    };
    scrub();
    document.addEventListener("ig:navperms-ready", scrub);
    const t = window.setInterval(scrub, 800);
    const stop = window.setTimeout(() => window.clearInterval(t), 6000);
    return () => {
      document.removeEventListener("ig:navperms-ready", scrub);
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, []);

  useEffect(() => {
    const onReady = () => {
      setNavReady(true);
      try {
        localStorage.setItem(LS_ANALYSED, "1");
      } catch {
        /* noop */
      }
    };
    document.addEventListener("ig:analysis-ready", onReady);
    return () => document.removeEventListener("ig:analysis-ready", onReady);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SIDEBAR, open ? "1" : "0");
    } catch {
      /* noop */
    }
    document.body.dataset.sidebar = open ? "open" : "closed";
  }, [open]);

  const onNavClick = (e: React.MouseEvent, item: NavItem) => {
    e.preventDefault();
    setMobileOpen(false);
    setOpen(true);
    if (item.action === "dashboardDiag") {
      try {
        window._loadDashboardDiag?.();
      } catch {
        /* noop */
      }
      return;
    }
    if (item.action === "wpConnect") {
      try {
        window.openWpCredentialsModal?.();
      } catch {
        /* noop */
      }
      return;
    }
    if (!item.view) return;
    try {
      window.navigateTo?.(item.view);
    } catch {
      /* noop */
    }
    router.push(viewToPath(item.view));
  };

  const goBrief = (e?: React.MouseEvent) => {
    e?.preventDefault();
    setMobileOpen(false);
    setOpen(true);
    try {
      window.navigateTo?.("marketing-brief");
    } catch {
      /* noop */
    }
    router.push("/manage/marketing-brief");
  };

  const goAnalyse = (e?: React.MouseEvent) => {
    e?.preventDefault();
    setMobileOpen(false);
    setOpen(true);
    try {
      window.navigateTo?.("home");
    } catch {
      /* noop */
    }
    router.push("/analyse");
  };

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return NAV_GROUPS;
    return NAV_GROUPS.map((g) => ({
      ...g,
      sections: g.sections
        .map((s) => ({
          ...s,
          items: s.items.filter(
            (it) =>
              it.label.toLowerCase().includes(q) ||
              (it.view || "").toLowerCase().includes(q),
          ),
        }))
        .filter((s) => s.items.length > 0),
    })).filter((g) => g.sections.length > 0);
  }, [filter]);

  useEffect(() => {
    if (filter.trim() && filteredGroups[0]) {
      setOpenGroups((prev) => {
        const next = { ...prev };
        for (const g of filteredGroups) next[g.key] = true;
        return next;
      });
    }
  }, [filter, filteredGroups]);

  const toggleGroup = (key: string) => {
    // If the rail is icon-collapsed, expand it so the submenu is visible.
    if (!open) {
      setOpen(true);
      setOpenGroups((prev) => ({ ...prev, [key]: true }));
      return;
    }
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const shellClass = [
    styles.shell,
    open ? "" : styles.shellCollapsed,
    mobileOpen ? styles.shellMobileOpen : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass} id="ig-app-shell">
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close menu"
        onClick={() => setMobileOpen(false)}
      />

      <aside className={styles.rail} id="ig-side-rail" aria-label="Primary">
        <div className={styles.railTop}>
          <button
            type="button"
            className={styles.brandBtn}
            id="navLogo"
            onClick={navReady ? goBrief : goAnalyse}
            title="InfoGenie"
          >
            <span
              className={styles.brandMark}
              dangerouslySetInnerHTML={{ __html: LOGO_SVG }}
            />
            <span className={styles.brandText}>
              Info<em>Genie</em>
            </span>
          </button>
          <button
            type="button"
            className={styles.toggle}
            aria-label={open ? "Collapse menu" : "Expand menu"}
            aria-expanded={open}
            title={open ? "Collapse menu" : "Expand menu"}
            onClick={() => setOpen((v) => !v)}
            dangerouslySetInnerHTML={{ __html: CHEVRON_SVG }}
          />
        </div>

        <div className={styles.railSearch}>
          <input
            id="ig-nav-filter"
            name="ig-nav-tool-filter"
            type="text"
            inputMode="search"
            placeholder="Filter tools…"
            value={filter}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-form-type="other"
            readOnly
            onFocus={(e) => e.currentTarget.removeAttribute("readonly")}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter navigation"
          />
          {filter.trim() && filteredGroups.length === 0 ? (
            <button
              type="button"
              className={styles.filterClear}
              onClick={() => setFilter("")}
            >
              No matches — clear filter
            </button>
          ) : null}
        </div>

        <nav className={styles.railNav} id="navGroups">
          {navReady ? (
            <>
              <button
                type="button"
                className={styles.briefBtn}
                title="Today's Marketing Brief"
                onClick={goBrief}
              >
                <span
                  className={styles.gIcon}
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: BRIEF_SVG }}
                />
                <span className={styles.gLabel}>Brief</span>
              </button>

              {filteredGroups.map((group) => (
                <NavGroup
                  key={group.key}
                  group={group}
                  open={!!openGroups[group.key] || !!filter.trim()}
                  onToggle={() => toggleGroup(group.key)}
                  onNavClick={onNavClick}
                />
              ))}
            </>
          ) : (
            <button
              type="button"
              className={styles.briefBtn}
              onClick={goAnalyse}
              title="Run your first analysis to unlock the full menu"
            >
              <span
                className={styles.gIcon}
                aria-hidden
                dangerouslySetInnerHTML={{ __html: SPARK_SVG }}
              />
              <span className={styles.gLabel}>Start with Analyse</span>
            </button>
          )}
        </nav>

        <div className={styles.railFoot}>
          <button
            type="button"
            className={styles.analyseBtn}
            id="navAnalyseBtn"
            onClick={goAnalyse}
          >
            + Analyse
          </button>
        </div>
      </aside>

      <div className={styles.stage}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              className={styles.mobileToggle}
              aria-label="Open menu"
              onClick={() => {
                setOpen(true);
                setMobileOpen(true);
              }}
              dangerouslySetInnerHTML={{ __html: MENU_SVG }}
            />
            <div className={styles.crumb}>Workspace</div>
          </div>
          <div className={styles.topbarRight}>
            <div className={styles.plan} id="navPlanBadge">
              Pro
            </div>
            <button
              className={`${styles.iconBtn} theme-toggle`}
              id="themeToggle"
              aria-label="Toggle light/dark mode"
              title="Toggle light/dark mode"
              type="button"
            >
              <span className="theme-icon-dark">🌙</span>
              <span className="theme-icon-light">☀️</span>
            </button>
            <button
              className={`${styles.iconBtn} alerts-bell`}
              id="alertsBell"
              aria-label="Open real-time alerts"
              title="Real-time alerts"
              type="button"
              onClick={() => {
                try {
                  window.toggleAlertsPanel?.();
                } catch {
                  /* noop */
                }
              }}
              dangerouslySetInnerHTML={{
                __html:
                  BELL_SVG +
                  '<span class="alerts-bell-badge" id="alertsBellBadge" style="display:none">0</span>',
              }}
            />
            <a
              href="/manual/download"
              className={styles.manual}
              id="navManualBtn"
              title="Download the InfoGenie User Manual (PDF)"
              download="InfoGenie_User_Manual.pdf"
            >
              Manual
            </a>
            <AccountMenu />
          </div>
        </header>
        <div className={styles.content} id="ig-shell-content">
          {children}
        </div>
      </div>
    </div>
  );
}
