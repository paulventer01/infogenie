"use client";

import { useRouter } from "next/navigation";
import { NAV_GROUPS, viewToPath, type NavItem } from "@/lib/viewRoutes";
import NavGroup from "./NavGroup";
import AccountMenu from "./AccountMenu";

const LOGO_SVG =
  '<svg width="32" height="32" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="url(#logoGrad)"/><path d="M13 20 Q20 10 27 20 Q20 30 13 20Z" fill="white" opacity="0.9"/><circle cx="20" cy="20" r="4" fill="white"/><defs><linearGradient id="logoGrad" x1="0" y1="0" x2="40" y2="40"><stop offset="0%" stop-color="#00C9C8"/><stop offset="100%" stop-color="#0066FF"/></linearGradient></defs></svg>';

const BELL_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';

// React replacement for the legacy `<nav id="navbar">`. The DOM structure, ids
// and classes mirror index.html exactly so the replayed legacy scripts (app.js
// nav wiring, ig_navperms/ig_navchrome MutationObservers, theme toggle, the
// nav-drop-next delegation) attach to it unchanged. React only adds the SPA
// routing concern: nav-link clicks call navigateTo (instant panel swap) AND
// router.push (keeps the URL in sync) so deep links / back-forward work.
export default function Navbar() {
  const router = useRouter();

  const onNavClick = (e: React.MouseEvent, item: NavItem) => {
    e.preventDefault();
    if (item.action === "dashboardDiag") {
      try {
        window._loadDashboardDiag?.();
      } catch {
        /* legacy not loaded yet */
      }
      return;
    }
    if (item.action === "wpConnect") {
      try {
        window.openWpCredentialsModal?.();
      } catch {
        /* legacy not loaded yet */
      }
      return;
    }
    if (!item.view) return;
    try {
      window.navigateTo?.(item.view);
    } catch {
      /* legacy not loaded yet — router.push still updates the URL */
    }
    router.push(viewToPath(item.view));
  };

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      window.navigateTo?.("home");
    } catch {
      /* noop */
    }
    router.push("/");
  };

  return (
    <nav className="navbar" id="navbar">
      <div className="nav-inner">
        {/* Row 1: logo + actions */}
        <div className="nav-top-row">
          <a href="#" className="nav-logo" id="navLogo" onClick={goHome}>
            <div
              className="logo-mark"
              dangerouslySetInnerHTML={{ __html: LOGO_SVG }}
            />
            <span className="logo-text">
              Info<span className="logo-genie">Genie</span>
            </span>
          </a>
          <div className="nav-actions">
            <div className="nav-plan-badge" id="navPlanBadge">
              Pro
            </div>
            <button
              className="theme-toggle"
              id="themeToggle"
              aria-label="Toggle light/dark mode"
              title="Toggle light/dark mode"
            >
              <span className="theme-icon-dark">🌙</span>
              <span className="theme-icon-light">☀️</span>
            </button>
            <button
              className="alerts-bell"
              id="alertsBell"
              aria-label="Open real-time alerts"
              title="Real-time alerts"
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
            <AccountMenu />
            <a
              href="/manual/download"
              className="nav-manual-btn"
              id="navManualBtn"
              title="Download the InfoGenie User Manual (PDF)"
              download="InfoGenie_User_Manual.pdf"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                background: "#F3F4F6",
                border: "1px solid #E5E7EB",
                borderRadius: "20px",
                color: "#374151",
                fontSize: ".74rem",
                fontWeight: 700,
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              📘 Manual
            </a>
            <button
              className="btn-nav-analyse"
              id="navAnalyseBtn"
              onClick={goHome}
            >
              + Analyse
            </button>
          </div>
        </div>
        {/* Row 2: group dropdown buttons */}
        <div className="nav-groups" id="navGroups">
          {NAV_GROUPS.map((group) => (
            <div key={group.key} style={{ display: "contents" }}>
              <NavGroup group={group} onNavClick={onNavClick} />
              {group.sepAfter && <span className="ngb-sep" />}
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
