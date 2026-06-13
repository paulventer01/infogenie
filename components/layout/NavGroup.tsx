"use client";

import type { NavGroupDef, NavItem } from "@/lib/viewRoutes";

const CHEVRON =
  '<svg class="ngb-chevron" width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface NavGroupProps {
  group: NavGroupDef;
  onNavClick: (e: React.MouseEvent, item: NavItem) => void;
}

// Renders a single `.nav-group-wrap` exactly as the legacy navbar did, so the
// replayed legacy scripts (hover dropdowns, search filter, permission gating)
// keep working against matching selectors. Only the nav-link click is owned by
// React (navigateTo + router.push); the `.nav-drop-next` footer stays a plain
// anchor wired by the replayed inline delegation script.
export default function NavGroup({ group, onNavClick }: NavGroupProps) {
  return (
    <div className="nav-group-wrap" data-group={group.key}>
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
      >
        {group.sections.map((section, si) => (
          <div key={si} style={{ display: "contents" }}>
            {section.header && (
              <div className="nav-drop-header">{section.header}</div>
            )}
            {section.items.map((item, ii) => (
              <a
                key={item.view || item.action || ii}
                href="#"
                className={"nav-link" + (item.className ? " " + item.className : "")}
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
        ))}
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
