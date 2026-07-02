"use client";

import { useState, useEffect, useRef } from "react";
import type { NavGroupDef, NavItem } from "@/lib/viewRoutes";

const CHEVRON =
  '<svg class="ngb-chevron" width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface NavGroupProps {
  group: NavGroupDef;
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
  }
}

export default function NavGroup({ group, onNavClick }: NavGroupProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filterText, setFilterText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  const toggle = (sectionKey: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      saveCollapsed(next);
      return next;
    });
  };

  const q = filterText.trim().toLowerCase();

  return (
    <div className="nav-group-wrap" data-group={group.key} onMouseLeave={() => setFilterText("")}>
      <button className="nav-group-btn" type="button">
        <span
          className="ngb-icon"
          dangerouslySetInnerHTML={{ __html: group.icon }}
        />
        <span className="ngb-label">{group.label}</span>
        <span dangerouslySetInnerHTML={{ __html: CHEVRON }} />
      </button>
      <div
        className={
          "nav-dropdown" + (group.dropdownRight ? " nav-dropdown-right" : "")
        }
        data-slimmed="1"
      >
        {/* ── Filter input ─────────────────────────────────────────── */}
        <div className="nav-drop-search">
          <input
            ref={inputRef}
            type="text"
            className="nav-drop-search-input"
            placeholder={`Filter ${group.label.toLowerCase()}…`}
            aria-label={`Filter ${group.label} menu`}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>

        {/* ── Sections ─────────────────────────────────────────────── */}
        {group.sections.map((section, si) => {
          const sectionKey = `${group.key}-${si}`;
          const isCollapsed = !!collapsed[sectionKey];

          const visibleItems = section.items.filter((item) => {
            if (!q) return true;
            return (
              item.label?.toLowerCase().includes(q) ||
              item.view?.toLowerCase().includes(q)
            );
          });

          if (q && visibleItems.length === 0) return null;

          return (
            <div key={si}>
              {section.header ? (
                <button
                  className={
                    "nav-section-toggle" +
                    (isCollapsed && !q ? " nav-section-collapsed" : "")
                  }
                  type="button"
                  onClick={() => toggle(sectionKey)}
                  title={isCollapsed ? "Expand section" : "Collapse section"}
                >
                  <span>{section.header}</span>
                  <svg
                    className="nst-chevron"
                    width="8"
                    height="8"
                    viewBox="0 0 10 10"
                  >
                    <path
                      d="M2 3.5l3 3 3-3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
              <div
                className={
                  "nav-section-body" +
                  (isCollapsed && !q ? " nav-section-body--collapsed" : "")
                }
              >
                {visibleItems.map((item, ii) => (
                  <a
                    key={item.view || item.action || ii}
                    href="#"
                    className={
                      "nav-link" +
                      (item.className ? " " + item.className : "")
                    }
                    {...(item.id ? { id: item.id } : {})}
                    {...(item.view ? { "data-view": item.view } : {})}
                    {...(item.title ? { title: item.title } : {})}
                    {...(item.hidden ? { style: { display: "none" } } : {})}
                    onClick={(e) => onNavClick(e, item)}
                  >
                    <span className="ndl-icon">{item.icon}</span>
                    <span className="ndl-text">{item.label}</span>
                  </a>
                ))}
              </div>
            </div>
          );
        })}

        {group.footer && (
          <a
            href="#"
            className="nav-drop-next"
            data-open-group={group.footer.group}
            dangerouslySetInnerHTML={{ __html: group.footer.html }}
          />
        )}
      </div>
    </div>
  );
}
