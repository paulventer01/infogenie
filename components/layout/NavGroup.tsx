"use client";

import { useState, useEffect } from "react";
import type { NavGroupDef, NavItem } from "@/lib/viewRoutes";
import styles from "../../styles/shell.module.css";

const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface NavGroupProps {
  group: NavGroupDef;
  open: boolean;
  onToggle: () => void;
  onNavClick: (e: React.MouseEvent, item: NavItem) => void;
}

const LS_KEY = "ig-nav-collapsed-sections";

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>) {
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  const toggleSection = (sectionKey: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      saveCollapsed(next);
      return next;
    });
  };

  // Intentionally NO legacy classes (nav-group-wrap / nav-dropdown / nav-link).
  // Those style.css rules force hover-only absolute dropdowns and hide panels.
  return (
    <div className={styles.group} data-group={group.key}>
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
            const isCollapsed = !!collapsed[sectionKey];
            return (
              <div key={si} className={styles.section}>
                {section.header ? (
                  <button
                    type="button"
                    className={styles.sectionHead}
                    onClick={() => toggleSection(sectionKey)}
                  >
                    {section.header}
                    <span aria-hidden>{isCollapsed ? " +" : " –"}</span>
                  </button>
                ) : null}
                {!isCollapsed &&
                  section.items.map((item, ii) => (
                    <a
                      key={item.view || item.action || ii}
                      href="#"
                      className={styles.link}
                      {...(item.id ? { id: item.id } : {})}
                      {...(item.view ? { "data-view": item.view } : {})}
                      {...(item.title ? { title: item.title } : {})}
                      {...(item.hidden ? { style: { display: "none" } } : {})}
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
