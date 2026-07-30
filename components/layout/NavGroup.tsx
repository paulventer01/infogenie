"use client";

import { useState, useEffect, useMemo } from "react";
import type { NavGroupDef, NavItem } from "@/lib/viewRoutes";
import { viewToPath } from "@/lib/viewRoutes";
import { prefetchPanel } from "@/components/features/registry";
import styles from "../../styles/shell.module.css";

const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface NavGroupProps {
  group: NavGroupDef;
  open: boolean;
  activeView?: string | null;
  expandSections?: boolean;
  onToggle: () => void;
  onNavClick: (e: React.MouseEvent, item: NavItem) => void;
}

/** One open nested section key per feature group (accordion). Missing = none open. */
const LS_KEY = "ig-nav-open-section-v3";

function loadOpenSectionMap(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveOpenSectionMap(state: Record<string, string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

export default function NavGroup({
  group,
  open,
  activeView,
  expandSections = false,
  onToggle,
  onNavClick,
}: NavGroupProps) {
  // Accordion: at most one nested section open per feature group.
  const [openSectionByGroup, setOpenSectionByGroup] = useState<Record<string, string>>({});

  useEffect(() => {
    setOpenSectionByGroup(loadOpenSectionMap());
  }, []);

  // Keep the section that owns the current view open (and close siblings).
  useEffect(() => {
    if (!activeView) return;
    let matchKey: string | null = null;
    group.sections.forEach((section, si) => {
      if (!section.header) return;
      if (section.items.some((item) => item.view === activeView)) {
        matchKey = `${group.key}-${si}`;
      }
    });
    if (!matchKey) return;
    setOpenSectionByGroup((prev) => {
      if (prev[group.key] === matchKey) return prev;
      const next = { ...prev, [group.key]: matchKey as string };
      saveOpenSectionMap(next);
      return next;
    });
  }, [activeView, group]);

  const toggleSection = (sectionKey: string) => {
    setOpenSectionByGroup((prev) => {
      const currently = prev[group.key];
      const next = { ...prev };
      if (currently === sectionKey) {
        delete next[group.key];
      } else {
        next[group.key] = sectionKey;
      }
      saveOpenSectionMap(next);
      return next;
    });
  };

  const activeSectionKey = useMemo(() => {
    if (!activeView) return null;
    for (let si = 0; si < group.sections.length; si++) {
      const section = group.sections[si];
      if (section.items.some((item) => item.view === activeView)) {
        return `${group.key}-${si}`;
      }
    }
    return null;
  }, [activeView, group]);

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
            const isActiveSection = activeSectionKey === sectionKey;
            // Headered sections: accordion (one open). Header-less stay visible.
            const sectionOpen = section.header
              ? expandSections || openSectionByGroup[group.key] === sectionKey
              : true;
            return (
              <div
                key={si}
                className={`${styles.section} ${isActiveSection ? styles.sectionActive : ""} ${
                  sectionOpen && section.header ? styles.sectionOpen : ""
                }`}
              >
                {section.header ? (
                  <button
                    type="button"
                    className={`${styles.sectionHead} ${
                      isActiveSection ? styles.sectionHeadActive : ""
                    } ${sectionOpen ? styles.sectionHeadOpen : ""}`}
                    aria-expanded={sectionOpen}
                    aria-current={isActiveSection ? "true" : undefined}
                    onClick={() => toggleSection(sectionKey)}
                  >
                    <span className={styles.sectionHeadLabel}>{section.header}</span>
                    <span className={styles.sectionHeadToggle} aria-hidden>
                      {sectionOpen ? "–" : "+"}
                    </span>
                  </button>
                ) : null}
                {sectionOpen &&
                  section.items.map((item, ii) => {
                    const isActive = !!(item.view && item.view === activeView);
                    return (
                      <a
                        key={item.view || item.action || ii}
                        href={item.view ? viewToPath(item.view) : "#"}
                        className={`${styles.link} ${isActive ? styles.linkActive : ""}`}
                        aria-current={isActive ? "page" : undefined}
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
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
