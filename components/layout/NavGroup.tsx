"use client";

import { useState, useEffect } from "react";
import type { NavGroupDef, NavItem } from "@/lib/viewRoutes";
import { viewToPath } from "@/lib/viewRoutes";
import { prefetchPanel } from "@/components/features/registry";
import styles from "../../styles/shell.module.css";

const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface NavGroupProps {
  group: NavGroupDef;
  open: boolean;
  onToggle: () => void;
  onNavClick: (e: React.MouseEvent, item: NavItem) => void;
}

/** Tracks which nested section keys are open. Missing key = closed. */
const LS_KEY = "ig-nav-open-sections-v2";

function loadOpenSections(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveOpenSections(state: Record<string, boolean>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

export default function NavGroup({
  group,
  open,
  onToggle,
  onNavClick,
}: NavGroupProps) {
  // Nested sub-menus start closed; open only when the user clicks +.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenSections(loadOpenSections());
  }, []);

  const toggleSection = (sectionKey: string) => {
    setOpenSections((prev) => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      saveOpenSections(next);
      return next;
    });
  };

  // Intentionally NO legacy classes (nav-group-wrap / nav-dropdown / nav-link).
  // Those style.css rules force hover-only absolute dropdowns and hide panels.
  return (
    <div className={styles.group} data-group={group.key} data-ig-react-nav="1">
      <button
        className={`${styles.groupBtn} ${open ? styles.groupBtnOpen : ""}`}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={group.label}
      >
        <span
          className={styles.gIcon}
          dangerouslySetInnerHTML={{ __html: group.icon }}
        />
        <span className={styles.gLabel}>{group.label}</span>
        <span
          className={styles.gChevron}
          dangerouslySetInnerHTML={{ __html: CHEVRON }}
        />
      </button>

      {open && (
        <div className={styles.groupPanel}>
          {group.sections.map((section, si) => {
            const sectionKey = `${group.key}-${si}`;
            // Headered sections default closed; header-less sections stay visible.
            const sectionOpen = section.header ? !!openSections[sectionKey] : true;
            return (
              <div key={si} className={styles.section}>
                {section.header ? (
                  <button
                    type="button"
                    className={styles.sectionHead}
                    aria-expanded={sectionOpen}
                    onClick={() => toggleSection(sectionKey)}
                  >
                    <span className={styles.sectionHeadLabel}>{section.header}</span>
                    <span className={styles.sectionHeadToggle} aria-hidden>
                      {sectionOpen ? "–" : "+"}
                    </span>
                  </button>
                ) : null}
                {sectionOpen &&
                  section.items.map((item, ii) => (
                    <a
                      key={item.view || item.action || ii}
                      href={item.view ? viewToPath(item.view) : "#"}
                      className={styles.link}
                      {...(item.id ? { id: item.id } : {})}
                      {...(item.view ? { "data-view": item.view } : {})}
                      {...(item.title ? { title: item.title } : {})}
                      {...(item.hidden ? { style: { display: "none" } } : {})}
                      onMouseEnter={() => {
                        if (item.view) prefetchPanel(item.view);
                      }}
                      onFocus={() => {
                        if (item.view) prefetchPanel(item.view);
                      }}
                      onClick={(e) => onNavClick(e, item)}
                    >
                      <span className={styles.linkIcon}>{item.icon}</span>
                      <span>{item.label}</span>
                    </a>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
