---
version: alpha
name: InfoGenie MVP Light
description: >
  Light-first operational marketing intelligence console. Cool gray-blue stage
  (#f3f6fb), white panels, teal primary (#0f766e) paired with sky accent (#0284c7).
  Outfit for display/brand, Manrope for UI. Soft layered shadows and 10–12px radii.
  Dense SaaS tool aesthetic with pastel light heroes — not a marketing landing page.

colors:
  primary: "#0f766e"
  primary-hover: "#0b5f59"
  primary-soft: "rgba(15, 118, 110, 0.12)"
  primary-border: "rgba(15, 118, 110, 0.16)"
  secondary: "#0284c7"
  secondary-soft: "rgba(2, 132, 199, 0.1)"
  accent-success: "#16a34a"
  accent-warm: "#f97316"
  accent-danger: "#dc2626"
  accent-cyan: "#38bdf8"
  background: "#f3f6fb"
  background-gradient-top: "#eef3f9"
  background-gradient-bottom: "#e8eef6"
  surface: "#ffffff"
  surface-subtle: "#f8fafc"
  surface-elevated: "#ffffff"
  surface-rail: "#ffffff"
  text-primary: "#0b1220"
  text-secondary: "#5b6577"
  text-muted: "#5b6577"
  text-dim: "#94a3b8"
  text-hero: "#0f172a"
  text-hero-muted: "#475569"
  text-inverse: "#ffffff"
  border: "rgba(11, 18, 32, 0.1)"
  border-subtle: "rgba(11, 18, 32, 0.08)"
  border-strong: "rgba(11, 18, 32, 0.16)"
  border-hero: "rgba(15, 118, 110, 0.16)"
  success: "#16a34a"
  warning: "#f97316"
  danger: "#dc2626"
  info: "#0284c7"
  selection: "rgba(15, 118, 110, 0.22)"
  focus-ring: "0 0 0 3px rgba(15, 118, 110, 0.12)"
  brand-gradient: "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)"
  brand-gradient-alt: "linear-gradient(135deg, #0f766e 0%, #16a34a 100%)"
  hero-gradient: "linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 48%, #eef4ff 100%)"
  header-stripe: "linear-gradient(90deg, #0f766e, #0284c7, #f97316)"
  dark-background: "#0b1220"
  dark-surface: "#121a2a"
  dark-surface-2: "#162033"
  dark-text: "#e8eef8"
  dark-muted: "#94a3b8"
  dark-border: "rgba(232, 238, 248, 0.1)"
  tm-hero-start: "#0f172a"
  tm-hero-mid: "#134e4a"
  tm-hero-end: "#0f766e"
  hub-accent: "#4F46E5"
  aiteam-tab-accent: "#7C3AED"
  contribution-accent: "#C2410C"
  onboarding-blue: "#0066FF"
  onboarding-aqua: "#14B8A6"
  metrics-card-border: "#D1FAE5"
  kind-measured-bg: "#ECFDF5"
  kind-measured-fg: "#065F46"
  kind-modelled-bg: "#FFF7ED"
  kind-modelled-fg: "#9A3412"
  kind-projected-bg: "#EFF6FF"
  kind-projected-fg: "#1D4ED8"

typography:
  display-family: "Outfit, Avenir Next, sans-serif"
  ui-family: "Manrope, Avenir Next, sans-serif"
  brand-family: "Outfit, Avenir Next, sans-serif"
  weights:
    ui: [400, 500, 600, 700, 800]
    display: [500, 600, 700, 800]
  roles:
    brand:
      family: display
      size: "1.35rem"
      weight: 800
      letter-spacing: "-0.04em"
    page-title:
      family: display
      size: "1.35rem"
      weight: 800
      line-height: 1.25
      letter-spacing: "-0.02em"
    section-title:
      family: display
      size: "1rem"
      weight: 800
    body:
      family: ui
      size: "15px"
      weight: 400
      line-height: 1.5
    body-small:
      family: ui
      size: "0.9rem"
      weight: 400
      line-height: 1.55
    label:
      family: ui
      size: "0.72rem"
      weight: 700
      letter-spacing: "0.05em"
      transform: uppercase
    button:
      family: ui
      size: "0.84rem"
      weight: 700
    button-primary:
      family: ui
      size: "0.84rem"
      weight: 800
    table-header:
      family: ui
      size: "0.72rem"
      weight: 700
      transform: uppercase
      letter-spacing: "0.05em"
    nav-item:
      family: ui
      size: "0.875rem"
      weight: 600
    caption:
      family: ui
      size: "0.68rem"
      weight: 700
      transform: uppercase

rounded:
  sm: "8px"
  control: "10px"
  default: "12px"
  lg: "14px"
  xl: "16px"
  hero: "16px"
  auth-panel: "24px"
  brand-mark: "11px"
  pill: "999px"

spacing:
  base: "4px"
  scale: ["6px", "10px", "14px", "18px", "24px"]
  page-padding-x: "12px"
  page-padding-y: "10px 12px 40px"
  card-padding: "18px"
  section-gap: "14px"
  control-gap: "8px"
  form-field-gap: "12px"
  rail-open: "280px"
  rail-closed: "76px"
  topbar-min-height: "58px"
  brand-bar-min-height: "68px"

shadows:
  sm: "0 1px 0 rgba(11, 18, 32, 0.04)"
  default: "0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px rgba(11, 18, 32, 0.06)"
  lg: "0 24px 60px rgba(11, 18, 32, 0.1)"
  button-primary: "0 10px 24px rgba(15, 118, 110, 0.22)"
  hero: "0 10px 28px rgba(15, 23, 42, 0.06)"
  sticky-header: "0 4px 18px rgba(11, 18, 32, 0.06)"
  mobile-rail: "16px 0 40px rgba(11, 18, 32, 0.12)"
  auth-card: "0 24px 60px rgba(17, 24, 39, 0.1)"
  modal: "0 24px 60px rgba(0, 0, 0, 0.25)"
  focus: "0 0 0 3px rgba(15, 118, 110, 0.12)"
  nav-active-inset: "inset 3px 0 0 #0f766e"

components:
  button-primary:
    height: "40px"
    padding: "0 16px"
    radius: "10px"
    background: "linear-gradient(135deg, #0f766e, #0284c7)"
    color: "#ffffff"
    weight: 800
  button-secondary:
    height: "40px"
    padding: "0 16px"
    radius: "10px"
    background: "#ffffff"
    border: "1.5px solid rgba(11, 18, 32, 0.1)"
  input:
    min-height: "42px"
    padding: "10px 13px"
    radius: "8px"
    border: "1.5px solid rgba(11, 18, 32, 0.1)"
  card:
    background: "#ffffff"
    border: "1px solid rgba(11, 18, 32, 0.1)"
    radius: "12px"
    shadow: "0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px rgba(11, 18, 32, 0.06)"
    padding: "18px"
  table-cell-padding: "10px 12px"
  badge-radius: "8px"
  modal-radius: "16px"
---

# InfoGenie Design System

> **Source of truth:** the running Next.js + Express application in this repository
> (`styles/globals.css`, `styles/theme-v2.css`, `styles/shell.module.css`,
> `styles/auth.module.css`, feature React panels, and `style.css` legacy layer).
> This document reverse-engineers what is **implemented**, not an aspirational redesign.
>
> Companion references: `design-reference/`.

## Overview

InfoGenie is a **dense operational marketing-intelligence console**, not a consumer marketing site and not a glassy “AI SaaS landing” shell.

### Visual character (mental model)

- **Light-first.** Default `data-theme="light"`. Cool gray-blue stage `#f3f6fb` with soft teal/sky atmospheric radials. White content panels sit on that stage.
- **Brand pair:** Teal `#0f766e` (primary / MVP) + Sky `#0284c7` (secondary / “complete app” accent). Together they form the signature 135° brand gradient used on primary buttons, brand mark, and key CTAs. Warm orange `#f97316` appears sparingly (header stripe, warm accents) — never as the main chrome color.
- **Typography dual-stack:** **Outfit** (display, brand, page titles — heavy 700–800, tight negative tracking) and **Manrope** (UI body, controls, tables). Body ≈ 15px. Hierarchy comes more from **weight + tracking** than from huge size jumps.
- **Surfaces:** Mostly **flat white cards** with a **1px low-contrast border** (`rgba(11,18,32,0.1)`) plus a **soft dual-layer shadow** (hairline top + large soft umbra). Depth is restrained — panels do not float aggressively.
- **Corners:** Soft but not pill-like for containers — typically **10–12px** controls/cards, **16px** heroes, **24px** auth panels. Pills (`999px`) are reserved for chips/filters, not primary buttons.
- **Density:** Dual. The **workspace home** is a spacious marketing command (centered hero, analyse card, stats). **Tool pages** are operational — KPIs, tables, filters, modest page padding (`10px 12px 40px`). Vertical rhythm uses a 6 / 10 / 14 / 18 / 24px scale.
- **Heroes:** Most feature pages open with a **pastel light hero** (mint → ice → lavender: `#e8f6f3 → #eaf2fb → #eef4ff`) with teal/sky radial washes, dark ink `#0f172a`, and a teal-tinted border. This is the opposite of dark neon dashboards.
- **Exceptions that define character:**
  - **Technical Manager** keeps an intentional **dark teal technical hero** (`#0f172a → #134e4a → #0f766e`).
  - **Ops Officer** uses a lighter atmospheric hero with grid texture and **no box-shadow**.
  - **Goals Hub** uses indigo `#4F46E5` tabs; **AI Team** top tabs use violet `#7C3AED`; **Contribution** uses orange wash `#C2410C`; **onboarding** uses legacy blue→aqua `#0066FF→#14B8A6`.
  - **Auth** allows frosted glass on the form panel; workspace stage may show a faint square grid.
- **Navigation:** Fixed **280px** white left rail (collapses to **76px**). Nav group icons are small inline SVGs; **nav leaf items often use emoji**. Active nav uses a **teal soft fill** and **3px inset left bar**, not a heavy filled pill.
- **Motion:** Restrained — rail width 0.28s cubic-bezier, brand mark subtle pulse, auth orbs, focus rings. No mesh-purple glow, no multi-layer neon.

### What must never be substituted

Do **not** replace this look with: purple-on-white AI gradients, cream/terracotta editorial themes, broadsheet zero-radius newspapers, Inter/Roboto/system-only stacks, floating multi-shadow card dashboards, or full-bleed dark mode as the default.

---

## Colors

### Brand & semantic (light — authoritative)

| Token | Value | Usage |
|-------|-------|--------|
| Primary | `#0f766e` | Links, active nav ink, brand accents, focus |
| Primary hover/dark | `#0b5f59` | Active tab text, pressed teal |
| Primary soft | `rgba(15,118,110,0.12)` | Active nav/tab backgrounds |
| Secondary / info | `#0284c7` | Sky accent, secondary chips, gradients |
| Success | `#16a34a` | Positive deltas, healthy status |
| Warm / warning | `#f97316` | Header stripe end, warm callouts |
| Danger | `#dc2626` | Errors, critical badges, destructive |
| Cyan | `#38bdf8` | Occasional highlight (legacy Signal) |

### Surfaces & text (light)

| Token | Value | Usage |
|-------|-------|--------|
| Stage / page | `#f3f6fb` | App background under shell |
| Stage atmospherics | radials teal 14% + sky 10% over `#eef3f9 → #f3f6fb → #e8eef6` | `.shell` background |
| Surface | `#ffffff` | Cards, rail, modals |
| Surface subtle | `#f8fafc` | Table headers, secondary panels (`--ig-panel2`) |
| Text primary / ink | `#0b1220` | Body, titles |
| Text secondary/muted | `#5b6577` | Supporting copy |
| Text dim | `#94a3b8` | Placeholders, separators, meta |
| Hero ink | `#0f172a` | Titles on pastel heroes |
| Hero muted | `#475569` | Subtitles on pastel heroes |
| Border | `rgba(11,18,32,0.1)` | Default 1px rules |
| Border strong | `rgba(11,18,32,0.16)` | Emphasized edges |
| Selection | `rgba(15,118,110,0.22)` | `::selection` |

### Gradients (required brand DNA)

```css
/* Primary CTA / brand mark */
background: linear-gradient(135deg, #0f766e 0%, #0284c7 100%);

/* Alt success-leaning */
background: linear-gradient(135deg, #0f766e 0%, #16a34a 100%);

/* Feature panel hero (default) */
background:
  radial-gradient(ellipse 75% 65% at 10% 15%, rgba(15,118,110,0.16), transparent 55%),
  radial-gradient(ellipse 55% 50% at 92% 85%, rgba(2,132,199,0.14), transparent 50%),
  linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 48%, #eef4ff 100%);

/* Thin accent bar under some headers */
background: linear-gradient(90deg, #0f766e, #0284c7, #f97316);
```

### Dark theme (opt-in, incomplete)

Dark mode flips shell/stage tokens when `html[data-theme="dark"]`:

- Stage `#0b1220`, surface `#121a2a`, text `#e8eef8`, muted `#94a3b8`, border `rgba(232,238,248,0.1)`.
- Many feature module CSS files and pastel heroes remain light-biased; **do not treat dark as fully designed**.
- Technical Manager dark hero remains dark in light mode by design.

### Legacy conflicts (document, do not revive as primary)

`style.css` still defines older Signal tokens (`--teal: #22C55E`, cyan `#00C9C8`, blue `#0066FF`, page `#E8EDF5`). Under `#ig-app-shell`, `theme-v2.css` overrides toward MVP teal/sky. **New work must follow MVP tokens**, not legacy Signal lime/cyan.

---

## Typography

### Families

Loaded via `next/font/google` in `app/layout.tsx` as CSS variables `--font-outfit` and `--font-manrope` (no `<link>` tags).

| Role | Family | Weights |
|------|--------|---------|
| Display / brand / H1–H3 | Outfit + `"Avenir Next", sans-serif` | 500–800 |
| UI / body / controls | Manrope + `"Avenir Next", sans-serif` | 400–800 |

**Do not** introduce Inter, Roboto, Arial, or system-ui as the primary UI face. Legacy references to Sora / Plus Jakarta / Inter in older CSS are aliases or leftovers — map them to Outfit/Manrope.

### Hierarchy (relationships)

- Page titles (~`1.35rem` / 800) are only modestly larger than body (`15px`); **weight and `-0.02em` to `-0.04em` tracking** create hierarchy.
- Section titles often stay near `1rem` but jump to weight 800.
- Labels/meta use **uppercase + 0.05em tracking + ~0.68–0.72rem + weight 700**, not smaller gray body text alone.
- Brand wordmark: Outfit 800, `1.35rem`, `-0.04em`; the “Genie” portion may be emphasized (`em`) without changing family.
- Primary button text is **heavier (800)** than secondary (700) at the same size (`0.84rem`).

### Concrete roles

| Role | Spec |
|------|------|
| Brand (rail) | Outfit 800 / 1.35rem / ls -0.04em / ink |
| Page title (PanelHero) | Outfit 800 / 1.35rem / lh 1.25 / ls -0.02em / `#0f172a` |
| Breadcrumb group | Manrope 700 / 0.72rem / `#0f766e` |
| Subtitle | Manrope 400 / 0.9rem / lh 1.55 / `#475569` / max-width ~720px |
| Body | Manrope 400 / 15px / `#0b1220` |
| Table header | Manrope 700 / 0.72rem / uppercase / ls 0.05em / `#64748b` on `#f8fafc` |
| Button | Manrope 700–800 / 0.84rem |
| Caption / plan badge | Manrope 700 / 0.68rem / uppercase |

Antialiasing: `-webkit-font-smoothing: antialiased`; `text-rendering: optimizeLegibility`.

---

## Layout

### Desktop application shell

```
┌────────────┬────────────────────────────────────────────┐
│ Rail 280px │ Topbar min-height 58px (sticky feel)       │
│ white      ├────────────────────────────────────────────┤
│ brand 68px │ Stage: atmospheric gray-blue               │
│ nav groups │ Content padding: 10px 12px 40px            │
│            │ Feature panels / heroes / grids            │
└────────────┴────────────────────────────────────────────┘
```

| Dimension | Value |
|-----------|-------|
| Rail open | `280px` (`--shell-w-open`) |
| Rail collapsed | `76px` (`--shell-w-closed`) |
| Rail z-index | `1200` |
| Brand row min-height | `68px`; padding `16px 14px 12px` |
| Brand mark | `38×38px`, radius `11px`, brand gradient |
| Topbar min-height | `58px`; padding `10px 20px` |
| Topbar bg | `rgba(243,246,251,0.9)` |
| Icon button | `36×36px`, radius `10px` |
| Collapse toggle | `34×34px`, radius `10px` |
| Stage margin-left | equals rail width |
| Content padding | `10px 12px 40px` (`#ig-shell-content`) |
| Typical feature max-width | ~1120–1280px centered inside content (`margin: 0 auto`) |

Shell root: `#ig-app-shell`. Stage background is **not flat** — dual radials + vertical wash (see Colors).

### Company context bar

When present, a full-width pastel strip (`#e7f5f2 → #eaf3fb → #eef6ff`) sits above content with compact controls — same family as heroes, lower height.

### Grid patterns

- KPI strips: `display: grid; grid-template-columns: repeat(auto-fit, minmax(120–160px, 1fr)); gap: 10px`
- Main split views: often `1.1fr / 0.9fr` or `1.2fr / 1fr` with `gap: 14px`
- Form stacks: single column, `gap: 12px`
- Do not force a 12-column marketing grid; operational auto-fit grids dominate.

### Scrolling

- Rail is `position: fixed`; stage scrolls independently.
- Sticky topbar uses soft shadow `0 4px 18px rgba(11,18,32,0.06)` when applicable.
- Tables may scroll horizontally inside rounded containers; prefer keeping header row visible via container scroll, not redesigning into cards on desktop.

---

## Elevation & Depth

Hierarchy is created by **border + soft shadow + tonal stage**, not by large floating decks.

| Layer | Treatment |
|-------|-----------|
| Stage | Tonal gradient + radials (no shadow) |
| Rail | White / near-white gradient fill, `1px` right border, optional `backdrop-filter: blur(10px)` |
| Cards / panels | White + `1px` border + `--v2-shadow` |
| Heroes (default) | Pastel fill + teal border + light hero shadow `0 10px 28px rgba(15,23,42,0.06)` |
| Ops hero | Atmospheric fill, **box-shadow: none** |
| TM hero | Dark gradient, border `#115e59`, **no heavy glow** |
| Primary button | Teal→sky gradient + `0 10px 24px rgba(15,118,110,0.22)` |
| Modal | Dim backdrop ~`rgba(15,23,42,0.55)` + modal shadow `0 24px 60px rgba(0,0,0,0.25)` |
| Active nav | Soft teal fill + `inset 3px 0 0 #0f766e` |

**Do not** stack multi-layer dramatic shadows on every card. **Do not** use glassmorphic blur on content cards (rail blur is the exception).

---

## Shapes

| Element | Radius |
|---------|--------|
| Inputs (theme-v2) | `8px` |
| Buttons / chips active | `10px` |
| Brand mark | `11px` |
| Cards / tables / default | `12px` (`--v2-radius`, `--radius`) |
| Larger panels | `14px` (`--radius-lg`) |
| Panel heroes | `16px` |
| Ops officer hero | `20px` |
| Auth card/panel | `24px` |
| Status pills / filter chips | `999px` when used as pills |
| Avatars (AI Team) | circle or near-circle in roster cards |

Primary buttons are **rounded rectangles (10px), not pills**.

---

## Components

### Buttons

#### Primary (`.btn-primary`, `.ig-btn-primary`, analyse/CTA aliases)

```
min-height: 40px;
padding: 0 16px;
border-radius: 10px;
border: none;
background: linear-gradient(135deg, #0f766e, #0284c7);
color: #ffffff;
font-size: 0.84rem;
font-weight: 800;
box-shadow: 0 10px 24px rgba(15, 118, 110, 0.22);
```

Hover: slightly darker teal bias / retain gradient; cursor pointer. Disabled: reduced opacity (~0.5–0.6), no strong shadow.

#### Secondary / ghost / outline

```
min-height: 40px;
padding: 0 16px;
border-radius: 10px;
background: #ffffff;
border: 1.5px solid rgba(11, 18, 32, 0.1);
color: #0b1220;
font-weight: 700;
```

#### Destructive

Solid or bordered `#dc2626` text/background variants in confirmations; do not use brand gradient for destroy actions.

#### Icon buttons (shell)

`36×36px`, radius `10px`, white bg, `1px` icon border, ink `#334155`, SVG ~16–18px.

#### Auth submit

Padding `13px`, radius `12px`, same brand gradient, stronger shadow `0 12px 28px rgba(15,118,110,0.28)`.

### Form controls

| Property | Value |
|----------|-------|
| Min height | `42px` |
| Padding | `10px 13px` |
| Border | `1.5px solid` border token |
| Radius | `8px` (v2) / `10px` (some `.ig-input`) |
| Background | `#ffffff` |
| Placeholder | `#94a3b8` |
| Focus | border teal + `box-shadow: 0 0 0 3px rgba(15,118,110,0.12–0.16)` |
| Label | above field, weight 600–700, muted or ink |
| Helper / error | 12–13px; error `#dc2626` / soft red surface `#FEF2F2` |

Checkboxes/radios: native or lightly styled; accent color teal. Toggles (e.g. auto-meetings): `role="switch"` with clear ON/OFF track using teal when on.

Search fields: same input chrome; optional leading icon with 8–10px gap.

### Cards / panels

```
background: #ffffff;
border: 1px solid rgba(11, 18, 32, 0.1);
border-radius: 12px;
box-shadow: 0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px rgba(11, 18, 32, 0.06);
padding: 18px; /* --ig-space-4 */
```

- Headings inside cards: tight margin (`0 0 12px`), weight 800.
- Interactive cards may use `cursor: pointer` and border emphasis on hover — **not** large lift.
- Alert/info panels often use tinted backgrounds (`#ECFDF5`, `#EFF6FF`, `#FFF7ED`, `#FEF2F2`) with matching borders rather than icons-only alerts.

### Tables

| Part | Spec |
|------|------|
| Container | radius 12px, border 1px, white bg, overflow hidden/auto |
| Header cell | bg `#f8fafc`, padding `10px 12px`, 0.72rem uppercase, weight 700, color `#64748b` |
| Body cell | padding `10px 12px`, ~13px, ink |
| Row divider | `1px solid` border token |
| Hover | subtle `#f8fafc` wash |
| Numeric cols | often stronger weight for key metrics |
| Empty | muted 13px message inside padding 16px |

Density is **compact operational**, tighter than form spacing.

### Tabs & chips

- Tabs / pills / chips: radius `8px` (sometimes pill 999 for filters).
- Active: background `rgba(15,118,110,0.12)`, text `#0b5f59` or `#0f766e`, weight 800.
- Inactive: muted text, transparent/white bg, 1px border optional.
- Goals Hub tabs: bottom border indicator `3px solid #4F46E5` appears in that hub (indigo accent exception — see Screen-Specific Exceptions). Prefer teal elsewhere.

### Badges & status

- Small uppercase labels, weight 700–800, radius 8px or 999.
- Semantic tints: green `#ECFDF5/#065F46`, orange `#FFF7ED/#9A3412`, red `#FEF2F2/#991B1B`, blue `#EFF6FF/#1D4ED8`, slate muted.
- Kind chips for metrics (`measured` / `modelled` / `projected`) use these tinted pills.

### Navigation (rail)

- Group headers: small caps / muted, with 14×14 SVG.
- Items: emoji + label, padding ~8–10px 12px, radius ~8–10px.
- Active: teal soft fill + inset 3px teal bar.
- Hover: `#f8fafc` wash.
- Collapsed rail: icons/emoji centered, labels hidden, width 76px.

### Dialogs / overlays

- Backdrop: `rgba(15,23,42,0.55)` (marketing) or darker legacy `rgba(0,0,0,0.6)` + blur 4px.
- Dialog surface: white, radius 16px (prefer), padding ~24–40px, shadow lg.
- Footer actions: right-aligned, secondary then primary; destructive separated.
- Close control: icon button top-right.

### Menus / dropdowns

- White surface, 1px border, radius 10–12px, soft default shadow.
- Item height ~36–40px, padding 8–12px.
- Hover fill `#f8fafc`; destructive item text `#dc2626`.

### Alerts / toasts

- Inline alerts common: tinted panels with border, 13px text, radius 10–12px.
- Critical/high lists in TM use white inner cards on tinted sections.
- Prefer in-page feedback over aggressive toast stacks.

### Heroes (shared PanelHero)

Anatomy:

1. Breadcrumb: group (teal) › title fragment (muted)
2. Title: 1.35rem / 800
3. Subtitle: 0.9rem / `#475569`
4. Optional actions cluster right

Chrome: pastel hero gradient, border `rgba(15,118,110,0.16)`, radius 16px, padding `22px 24px`, margin bottom 18px, color `#0f172a`.

---

## Navigation

See Layout + Components. Additional rules:

- Product areas: Analyse / Reach / Grow / Manage / AI Team (emoji-led leaves).
- Back controls and “Related” pill links appear inside hubs (Goals Hub) as white pills with 1px border.
- Account / theme toggles live in topbar; theme toggle may show 🌙/☀️ emoji.
- Mobile ≤900px: rail becomes off-canvas (`min(86vw, 300px)`), backdrop, shadow `16px 0 40px rgba(11,18,32,0.12)`.

---

## Iconography

| Context | System |
|---------|--------|
| Rail group headers | Custom inline SVG (14×14), stroke aligned to muted/ink |
| Rail items / many features | **Emoji** as leading icons |
| Shell chrome | Inline SVG strings (logo mark, bell, menu, chevron) |
| Status | Color tints + text; occasional ●/○ bullets in monitors |

**No Lucide/Heroicons dependency in package.json.** Do not mix a third outline icon library into chrome. If SVGs are added, keep 1.5–2px stroke, 16–20px box, teal/sky/ink colors only.

AI Team roster uses photographic/illustrated **webp avatars** under `public/avatars/ai-team/` (copies in `design-reference/assets/`).

---

## Imagery & Illustration

| Asset | Description | Placement |
|-------|-------------|-----------|
| Brand mark | Rounded square 38×38 with teal→sky gradient + logo glyph | Rail top |
| Favicon | `public/favicon.svg` | Browser |
| AI Team avatars | Soft portrait webps per officer role | AI Team roster cards |
| Hero backgrounds | CSS-only pastel (or dark TM) gradients — **not** stock photos | Feature headers |
| Auth left/brand panel | Atmospheric CSS gradients + large Outfit brand type | Login |

There is **no** full-bleed photography hero in the app shell. Atmosphere = CSS radials/gradients.

---

## Data Visualization

Charts inside marketing/dashboard modules typically sit in white cards with:

- Grid lines: very light slate
- Series colors should prefer **teal `#0f766e`, sky `#0284c7`, green `#16a34a`, orange `#f97316`**, then slate — not default chart-library categorical rainbows
- Tooltip: white, 12px radius, 1px border, small shadow
- Empty: muted sentence, no decorative illustration required
- KPI numbers: large weight 800 (`1.35–1.6rem` or `22–28px`), labels uppercase 0.68–0.72rem muted
- Positive/negative deltas: green `#16A34A` / red `#DC2626` (invert meaning for “bad when up” metrics like CAC)

Canonical Metrics / Contribution pages use chip labels (`measured`/`modelled`) beside figures — preserve that honesty pattern visually.

---

## Responsive Behaviour

| Breakpoint | Behaviour |
|------------|-----------|
| ≤900px | Rail off-canvas; hamburger/topbar controls; content full width |
| ≤860px | Auth layout → single column |
| ≤720px | Multi-column heroes/action rows stack (ops hero, some grids) |
| ≤640px | Tighter cards; overview widgets stack |
| Mobile content | Keep 12px-class horizontal padding; grids → 1 column via `auto-fit` |

Tables: allow horizontal scroll rather than turning every row into a card (unless a specific module already does).

---

## Interaction States

| State | Treatment |
|-------|-----------|
| Default | As component specs |
| Hover (nav/list) | `#f8fafc` wash |
| Hover (primary btn) | Retain gradient; slightly stronger shadow/brightness |
| Active/selected | Teal soft fill + inset bar or 2px teal border |
| Focus | `0 0 0 3px rgba(15,118,110,0.12)` |
| Disabled | opacity ~0.5; no pointer |
| Loading | Button label → “Scanning…/Loading…”; cursors wait; skeletons uncommon — often muted text |
| Error | `#FEF2F2` bg, `#FECACA` border, `#991B1B` text |
| Success | `#ECFDF5` / `#A7F3D0` / `#065F46` |
| Warning | `#FFF7ED` / `#FDBA74` / `#9A3412` |

---

## Motion

| Motion | Spec |
|--------|------|
| Rail expand/collapse | `width 0.28s cubic-bezier(0.22, 1, 0.36, 1)` |
| Brand mark pulse | `brandPulse 4.5s ease-in-out infinite` scale 1 → 1.04 |
| Brand text hide | opacity/width 0.2s |
| General hovers | ~150–200ms color/background |
| `prefers-reduced-motion` | Respect — disable brand pulse / nonessential transitions in shell/auth |

No page-transition white flashes; no parallax; no modal spring extravagance required.

---

## Page Patterns

### Auth / login

Desktop is a **2-column split** on an atmospheric stage (not a lone centered card):

```
background:
  radial-gradient(ellipse 70% 55% at 8% 12%, rgba(15,118,110,0.18), transparent 50%),
  radial-gradient(ellipse 60% 50% at 92% 88%, rgba(2,132,199,0.14), transparent 48%),
  linear-gradient(160deg, #f4f7fb 0%, #eef3f9 45%, #e8eef6 100%);
```

Animated soft orbs (`authOrb` 16s alternate) sit behind content. Shell rises with `authRise` 0.65–0.8s.

| Zone | Spec |
|------|------|
| Grid | `1.2fr 0.9fr`, gap `clamp(24px, 5vw, 72px)`, max width ~1120px |
| Brand mark | 44×44 SVG + Outfit wordmark `clamp(2.1–3rem)` / 800 / ls `-0.05em`; “Genie” uses gradient text clip teal→sky |
| Hero title | Outfit `clamp(1.9–2.85rem)` / 800 / ls `-0.04em` / max-width ~13ch |
| Hero lead | 1.05rem / 500 / `#5b6577` / max ~34ch |
| Meta pills | Uppercase 0.74rem / 800 / ls 0.06em; white 70% bg; 8px radius; 7px brand-gradient dots |
| Form panel | max-width 420px; padding 28px; radius **24px**; `rgba(255,255,255,0.86)`; border near-white; shadow `0 24px 60px rgba(17,24,39,0.1)`; **backdrop-filter: blur(20px) saturate(150%)** — auth is the main place soft glass is intentional |
| Mode tabs | Track `rgba(17,24,39,0.05)`, radius 14px, padding 4px; active white + teal text + light shadow, radius 11px |
| Inputs | Labels above; focus border teal; min ~42px |
| Submit | Full width; padding 13px; radius 12px; brand gradient; shadow `0 12px 28px rgba(15,118,110,0.28)`; label “Log In →” |
| Forgot | Teal text link centered under submit |
| Mobile ≤860px | Single column; panel stretches full width |

### Workspace / Analyse home (marketing command)

The default post-login workspace is **more promotional than a dense ops dashboard**, while still inside the app chrome:

1. Stage shows cool gray-blue wash **plus a faint large square grid** (≈40px cells) — keep this atmosphere; do not flatten to solid white.
2. Centered product badge pill: “✨ AI-POWERED AUTONOMOUS MARKETING INTELLIGENCE” + small blue **NEW** chip.
3. Large centered Outfit headline; accent phrase (“Autonomous Growth”) in **teal** (or teal→violet highlight) — not a full purple marketing gradient on the whole title.
4. Supporting sentence centered, muted slate, ~60–70ch.
5. **Primary analyse card**: large white floating panel, soft shadow + optional light outer glow; URL field (`https://` prefix), region select (“Global”), primary **Analyse Now** (brand gradient), secondary sector field, “+ Add competitors manually”, darker **Launch Campaign** CTA, and a “Try:” row of domain pills with multicolour dots.
6. Trust strip: “ANALYSES ACROSS” + platform marks + “180+ Countries”.
7. Stats row: four large teal figures (`200K+`, `35%`, `3.2x`, `<60s`) with uppercase muted labels and vertical hairline dividers.

This screen is the **exception** that may feel landing-like. Other operational tools must **not** copy this sparse centered marketing composition.

### App shell + standard feature page

Most tools follow:

1. Optional company context bar (pastel strip)
2. Pastel **PanelHero** (group, title, subtitle, actions) — or page-local hero matching the same DNA
3. KPI/stat row (`auto-fit` min 120–160px, gap 10)
4. Action bar (primary + secondary)
5. Content panels / tables / grids (gap 14–18)
6. Related links as white/outline pills

Content max-width typically **1120–1200px** centered inside `#ig-shell-content` padding `10px 12px 40px`.

### Goals Hub (`/manage/goals` and related deep links)

Chrome (hub-specific indigo):

```
padding: 22px 24px 8px; max-width: 1180px; margin: 0 auto;
eyebrow: 11px / 800 / uppercase / #4F46E5;   /* GROW · GOALS HUB */
title: 28px / 800 / #0F172A;
subtitle: 14px / #64748B / max-width 720 / lh 1.5;
tablist: gap 6px; border-bottom 2px solid #E2E8F0;
tab: padding 10px 14px; font 13px; inactive #64748B/600; active #4F46E5/800 + 3px bottom #4F46E5;
blurb under tabs: 12px #64748B;
related pills: padding 6px 10px; radius 999; border 1px #E2E8F0; 12px/600 #334155;
```

Tabs embed: Marketing Goals, Targets, Metrics SSOT, Contribution, OKRs, KPI Tracker.

**Empty state (Targets):** white card; centered bullseye; “No goals yet”; body copy; indigo primary “+ Create Your First Goal” (hub accent).

### Canonical Metrics / Metrics SSOT

Standalone wash: `linear-gradient(180deg,#ECFDF5 0%,#F8FAFC 45%)` when not embedded; padding `28px 32px` (embedded: `8px 24px 32px`). Max-width 1120.

- Eyebrow uppercase teal `#0F766E` 0.7rem/800 ls 0.1em
- H1 ~1.6rem `#0F172A`
- KPI grid: `auto-fit minmax(140px,1fr)` gap 10; cards white, border `#D1FAE5`, radius 12, padding 12–14
- Kind chips: measured `#ECFDF5/#065F46`, modelled `#FFF7ED/#9A3412`, projected `#EFF6FF/#1D4ED8` — uppercase ~9–10px/800 pill 999
- KPI value ~1.35rem/800
- Pacing callout: amber `#FFF7ED/#FCD34D`
- Mini bar chart: teal bars `#0F766E` opacity scaled by value, radius 2px, ~120px row height
- Contribution CTA strip: orange-bordered banner linking to contribution record

### Contribution & incrementality

Standalone wash: `linear-gradient(180deg,#FFF7ED 0%,#F8FAFC 42%)` — warm orange tint. Eyebrow `#C2410C`.

- Day chips `[7,30,60]`: radius 8; active `2px solid #C2410C`
- Summary KPIs: `minmax(180px,1fr)` gap 10; cards radius 14 padding 14–16; values **28px/800** with accents teal / orange / slate / red
- KindChip: 10px/800 uppercase, border `color+33`, radius 999, padding 2×8
- Note banner: `#FFFBEB` / `#FDBA74` / `#9A3412`
- Channel table: overflow-x auto; thead `#F8FAFC` uppercase 11px; cells padding 10×12; 13px body
- Budget recommendation rows: white cards radius 12, strong title + muted why + green incremental revenue line

### AI Team roster (`/ai-team`)

1. Top tabs **AI Officer Team** / **Briefing Room**: bottom border 2px `#E5E7EB`; active underline **`2px solid #7C3AED`** and purple text `#7C3AED` (violet exception). Padding `12px 22px`, font 0.88rem.
2. Hero: pastel brand gradient (PanelHero DNA), radius **18px**, padding 24×28, max-width 1200. Eyebrow “YOUR AI TEAM” teal uppercase ls 0.18em. Title ~1.85rem/800. Status pill: frosted white, radius 99, live pulse dot with colored halo.
3. Officer grid: `auto-fill minmax(320px,1fr)` gap 18; cards white, border `#E5E7EB`, radius **14**, padding 18, shadow `0 1px 2px rgba(0,0,0,.04)`.
4. Card anatomy: circular avatar (webp), green “• ON DUTY” pill, title + role, tool link chips, footer with task count + teal **Tasks** + outlined **Daily Report**.
5. Below: Auto Daily Report panel, Auto Meetings panel (with switch), Meetings list — dense operational sections.
6. Modals: overlay `rgba(15,23,42,0.6)`, high z-index (~99999), padding 20.

Route note: Technical Manager desk is **`/ai-team/technical-manager`** (bare `/technical-manager` may fall through to legacy marketing shell).

### Technical Manager

Observed anatomy:

1. **Dark teal hero** (`#0f172a → #134e4a → #0f766e`), light text, rounded ~16px, eyebrow “TECHNICAL MANAGER · SENIOR ROLE”, title “Entire-system monitor”, frosted status pill (e.g. CRITICAL with red).
2. KPI grids: white cards, semantic red/orange/teal labels (“OVERALL: CRITICAL”, counts, SURFACES, TOOLING GAPS).
3. Subsystem row: OK / RISK / OFF with tinted cards when unhealthy.
4. Action bar: solid teal “Refresh scan now” + ghost outline related links.
5. Real-time monitor: mint/teal tinted panel listing surfaces + API latency rows with green/red dots.
6. Ops tooling stack: numbered ship-order rows, yellow SETUP / Live badges.

Do not force pastel remap onto the TM hero.

### Onboarding wizard (first-run modal)

Legacy `#ig-onb-*` (`index.html` + `public/js/ig_onboarding.js`) — Signal-era blue→teal:

| Part | Spec |
|------|------|
| Overlay | `rgba(15,23,42,0.78)` + `backdrop-filter: blur(6px)` |
| Card | white; radius 18px; max-width 640px; shadow `0 24px 60px rgba(0,0,0,0.35)`; enter 0.28s ease-out |
| Header `.igh` | `linear-gradient(135deg,#0066FF,#14B8A6)`; white text; padding 28×32×22; top radii 18 |
| Steps | 5px tall pills; gap 6; idle `#E2E8F0`; current `#0066FF`; done `#14B8A6` |
| Choice grid | 2×2; `#F8FAFC` + 1.5px `#E2E8F0`; radius 11; selected `#EFF6FF` + `#0066FF` + ring `0 0 0 3px rgba(0,102,255,.12)` |
| Footer | skip outline gray; next blue→teal gradient; back `#F1F5F9` |

Preserve as a **legacy-gradient exception**; do not restyle into purple glass AI chrome.

### List / index

- Hero or page title + primary CTA
- Filters/chips
- Table in white rounded container
- Empty muted row or illustrated empty (Goals uses icon + CTA)

### Settings / forms

- Labels above; ~12–14px field gaps; primary save in footer or action bar
- Modal forms follow `.modal-form-group` / `.ig-field` spacing in theme-v2

### Empty, loading, error (cross-cutting)

| State | Pattern |
|-------|---------|
| Loading | Muted sentence (“Loading…”) in content padding; button label swap; skeletons uncommon |
| Error | `#FEF2F2` surface, `#991B1B` text, radius ~10 |
| Empty table | Muted 13px copy inside bordered container |
| Empty Goals | Illustrated center + indigo CTA |
| Empty charts | One-line muted explanation inside white card |

---

## Content Density

Two densities coexist — do not collapse them into one:

1. **Workspace marketing command** — spacious centered hero, large type, stats strip (home only).
2. **Operational tools** — compact KPIs (12–14px padding), tables 10×12 cells, 6–14px gaps, max-width ~1120–1200.

Do not aerate Goals/Metrics/TM/AI Team into workspace marketing spacing. Do not compress the workspace home into a dense admin table.

---

## Accessibility

- Light theme text on pastel heroes uses `#0f172a` / `#475569` — never white text on pastel heroes.
- Primary gradient buttons use **white** label text.
- Theme-v2 includes safety overrides when pastel backgrounds were incorrectly applied to buttons.
- Focus rings must remain visible (teal soft ring; onboarding uses blue ring).
- Respect `prefers-reduced-motion` (auth orbs, brand pulse, status pulse).
- Dark mode is secondary; re-check contrast on custom panels if enabled.
- Status must not rely on colour alone — pair with text (“MEASURED”, “ON DUTY”, “CRITICAL”).

---

## Screen-Specific Exceptions

1. **Technical Manager hero** — dark gradient, light text; do not force pastel remap.
2. **Ops Officer hero** — light atmospheric, grid texture, **no box-shadow**, radius 20px.
3. **Goals Hub chrome** — indigo `#4F46E5` tab underline / eyebrow; some empty CTAs indigo.
4. **AI Team main tabs** — violet `#7C3AED` underline/text (not teal).
5. **Contribution page** — warm orange `#C2410C` / `#FFF7ED` wash accents for causal framing.
6. **Canonical Metrics** — mint wash `#ECFDF5` when standalone.
7. **Onboarding wizard** — Signal blue `#0066FF` → aqua `#14B8A6` gradient header/CTA (legacy).
8. **Auth panel** — frosted glass (`backdrop-filter`) allowed here among major surfaces.
9. **Workspace home** — marketing-forward centered composition + grid stage; not the template for tool pages.
10. **Legacy `style.css`** — may still paint old Signal lime/cyan if a view escapes shell overrides; treat as debt, not target.
11. **Budget Hub** — may still reference Sora in CSS; map to Outfit/Manrope.
12. **Email HTML reports** — separate from app shell.

---

## Topbar & status chrome (detail)

| Control | Appearance |
|---------|------------|
| Back + “Workspace” | Text button + bold page context label |
| Live pill | Green/teal pulse + timestamp `● Live HH:MM:SS` |
| Up pill | Uptime `Up Xm Ys` |
| Theme | 36×36 icon button; ☀️ light / 🌙 dark |
| Alerts | Bell + red numeric badge |
| Manual | Outline pill for manual/tour |
| Account | Blue-tinted pill with initial avatar + name |

Floating dark circular **wrench** FAB (bottom-right) appears in many views — legacy ops entry; keep subdued.

---

## Navigation leaf icons (detail)

Rail groups use **small teal/ink line SVGs** (Brief, Analyse, Create, Reach, Grow, Manage, AI Team). Expanded leaves often mix **emoji** (from `viewRoutes`) with labels. Active leaf: soft teal fill + **3px inset left bar** (`#0f766e`, or sky `#0284c7` for some nested actives). Filter tools input under brand: full width, radius 10px, 0.78rem.

Collapsed rail (76px): hide labels; keep marks/emoji centered.

Mobile ≤900px: rail off-canvas `min(86vw, 300px)`, stage full width, backdrop + shadow `16px 0 40px rgba(11,18,32,0.12)`.

---

## Implementation notes (non-binding technology)

Current stack references (for archaeology only):

- Tokens: `styles/globals.css`, `styles/theme-v2.css`
- Shell: `styles/shell.module.css`, `components/layout/AppShell.tsx`
- Heroes: `components/layout/PanelHero.tsx`, theme-v2 hero remaps
- Auth: `styles/auth.module.css`, `app/(auth)/login/page.tsx`
- Goals Hub: `components/features/manage/GoalsHub.tsx`
- Metrics: `components/features/manage/CanonicalMetrics.tsx`
- Contribution: `components/features/grow/ContributionRecord.tsx`
- AI Team: `components/features/aiteam/AiTeam.tsx`
- Onboarding: `index.html` `#ig-onb-*`, `public/js/ig_onboarding.js`
- Legacy global: `style.css` loaded by dashboard layout
- Fonts: `next/font` Outfit + Manrope in `app/layout.tsx`
- Screenshots/assets: `design-reference/`

A redesign in another stack must match **tokens and behaviours**, not necessarily Tailwind class names or CSS modules.

---

## Component inventory — extended specs

### Kind honesty chips (metrics / contribution)

| Kind | Text | Background |
|------|------|------------|
| measured | `#065F46` | `#ECFDF5` |
| modelled | `#9A3412` | `#FFF7ED` |
| projected | `#1D4ED8` | `#EFF6FF` |

Typography: uppercase, weight 800, size 9–10px, letter-spacing ~0.04em, radius 999, padding ~1–2px × 6–8px, optional border `color` at ~20% alpha.

### Stat / KPI card

```
background: #ffffff;
border: 1px solid <context>; /* #E2E8F0 default; #D1FAE5 on metrics */
border-radius: 12px; /* contribution summary often 14px */
padding: 12px 14px;
label: 0.68–0.72rem / 700 / uppercase / #64748B;
value: 1.35rem–28px / 800 / #0F172A or semantic accent;
delta: 0.75rem / 700 / green or red;
```

### Segmented day / period chips

Height ~28–32px; padding 6×12; radius 8; inactive 1px border; active 2px semantic border (teal or contribution orange); weight 700; size 12px.

### Related / deep-link pills

Padding 6×10; radius 999; 1px `#E2E8F0`; 12px/600 `#334155`; wrap with gap 8.

### Officer / entity card (AI Team)

Radius 14; border `#E5E7EB`; padding 18; hairline shadow; avatar circle; status pill; chip row of tool links; footer actions primary+secondary.

### Analyse command card (workspace)

Larger visual radius; stronger soft shadow than standard `.ig-card`; compound input rows; primary CTA inside card; suggestion pills below.

### Onboarding choice button

Padding 14×12; bg `#F8FAFC`; border 1.5px `#E2E8F0`; radius 11; emoji 1.5rem; title 0.92rem/700; description 0.78rem `#64748B`; selected blue treatment as above.

### Toast / pulse

AI Team status dots use `@keyframes pulse` opacity 1↔0.55 over 2s. Prefer restrained toasts — short, not full-width banners.

---

## Visual hierarchy relationships (summary)

- Page title ≈ **1.3–1.8×** body size; hierarchy is mostly **weight 800 + negative tracking**, not huge display jumps (except workspace home + auth hero).
- Card titles: often same size or +1–2px vs body, weight 800.
- Secondary text: lower contrast (`#64748B` / `#5b6577`), not dramatically smaller.
- Primary actions win via **brand gradient + white label + weight 800**, not by being physically huge (except workspace Analyse CTA).
- Tables tighter than forms; forms tighter than marketing workspace.
- Sidebar active = tinted fill + inset bar, not filled neon pill.
- Semantic colour is for **status/honesty**, not rainbow decoration of every card.

---

## Dual CSS systems (receiving-agent warning)

| Layer | Role |
|-------|------|
| MVP / theme-v2 under `#ig-app-shell` | **Authoritative** teal `#0f766e` + sky `#0284c7` light console |
| Legacy Signal `style.css` / onboarding | Lime/cyan/blue leftovers; blue→aqua wizard |
| Inline React styles in feature panels | Often hard-coded hex matching MVP or hub accents |

When redesigning elsewhere, prefer the **MVP shell + PanelHero + metrics chip** language. Replicate hub/page accent exceptions explicitly rather than averaging everything to teal or everything to indigo.

---

## Do's and Don'ts

### Do

- Do keep the **teal + sky** brand pair and 135° gradient for primary actions and the brand mark.
- Do keep **Outfit + Manrope** with tight negative tracking on titles.
- Do keep the **280px / 76px** rail geometry and SVG group icons + emoji leaf mix.
- Do use **pastel light heroes** as the default feature header.
- Do use **1px soft borders + restrained dual-layer shadows** on white cards.
- Do preserve **two densities**: marketing workspace home vs compact operational tools.
- Do label metrics honesty chips (`measured` / `modelled` / `projected`) with tinted pills.
- Do keep TM’s **dark technical hero**, Goals Hub **indigo** tabs, AI Team **violet** tabs, Contribution **orange** wash, and onboarding **blue→aqua** header as named exceptions.
- Do keep primary buttons as **10px rounded rectangles**, white text, brand gradient.
- Do keep the faint **grid atmosphere** on the workspace stage.
- Do keep auth’s frosted panel + atmospheric orbs.

### Don't

- Don't default the product to dark mode or make indigo/purple the global chrome (only named hubs/tabs).
- Don't replace Outfit/Manrope with Inter/Roboto/system stacks.
- Don't turn primary buttons into large pills or neon glowing CTAs.
- Don't add mesh-purple AI backgrounds, cream/terracotta editorial themes, or broadsheet zero-radius layouts.
- Don't apply glassmorphism to every card (auth + onboarding overlay blur are the exceptions).
- Don't float every card with heavy multi-shadow elevation.
- Don't convert dense operational tools into sparse marketing landings — or flatten the workspace home into an admin table.
- Don't put white text on pastel heroes or dark text on teal→sky primary buttons.
- Don't introduce a third icon library that clashes with SVG + emoji nav.
- Don't flatten the stage to pure `#FFFFFF` without atmospheric radials/grid.
- Don't “modernize” by removing borders in favor of shadow-only Material cards.
- Don't erase the Ops Officer no-shadow hero or the TM dark hero.
- Don't revive legacy Signal lime `#22C55E` / cyan `#00C9C8` as the **primary** brand (onboarding may still use `#0066FF`/`#14B8A6`).
- Don't drop honesty chips or mix measured/modelled numbers without labels.
- Don't restyle the wrench FAB into a glowing AI orb.

---

## Validation checklist for receiving agents

When applying this design elsewhere, verify:

1. Stage reads gray-blue `#f3f6fb` with teal/sky radials (workspace also shows faint grid), not pure white or pure black.
2. Primary button is teal→sky gradient, ~40px tall, 10px radius, weight 800, white label.
3. Titles are Outfit ~1.35rem/800 with negative tracking (larger on auth/workspace); body Manrope ~15px.
4. Cards are white, 12px radius, 1px soft border, restrained dual shadow (AI Team cards may use lighter `0 1px 2px`).
5. Feature headers use pastel hero gradient unless TM/Ops/onboarding exceptions apply.
6. Left rail 280px with brand mark gradient square; SVG groups + emoji leaves.
7. Focus rings are teal soft halos (onboarding blue); semantic red/green/amber tints match tables above.
8. Goals Hub indigo tabs, AI Team violet tabs, Contribution orange wash, Metrics mint wash present where those pages exist.
9. No accidental Inter-based generic SaaS restyle.

---

## Appendix A — Token quick copy

```css
:root {
  --ig-primary: #0f766e;
  --ig-accent: #0284c7;
  --ig-accent-2: #16a34a;
  --ig-warm: #f97316;
  --ig-danger: #dc2626;
  --ig-page-bg: #f3f6fb;
  --ig-card-bg: #ffffff;
  --ig-text: #0b1220;
  --ig-text-muted: #5b6577;
  --ig-border: rgba(11, 18, 32, 0.1);
  --ig-shadow: 0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px rgba(11, 18, 32, 0.06);
  --ig-radius: 12px;
  --ig-radius-control: 10px;
  --font-display: "Outfit", "Avenir Next", sans-serif;
  --font-ui: "Manrope", "Avenir Next", sans-serif;
  --shell-w-open: 280px;
  --shell-w-closed: 76px;
}
```

## Appendix B — Hero CSS quick copy

```css
.ig-panel-hero {
  background:
    radial-gradient(ellipse 75% 65% at 10% 15%, rgba(15,118,110,0.16), transparent 55%),
    radial-gradient(ellipse 55% 50% at 92% 85%, rgba(2,132,199,0.14), transparent 50%),
    linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 48%, #eef4ff 100%);
  border: 1px solid rgba(15, 118, 110, 0.16);
  border-radius: 16px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
  padding: 22px 24px;
  color: #0f172a;
}
```

## Appendix C — File map (implementation archaeology)

| Path | Role |
|------|------|
| `styles/globals.css` | Global tokens, `.ig-card`, fonts |
| `styles/theme-v2.css` | Shell-scoped MVP overrides, heroes, buttons, tables |
| `styles/shell.module.css` | Rail/topbar/stage |
| `styles/auth.module.css` | Login |
| `styles/dashboard-marketing.module.css` | Marketing dashboard widgets |
| `styles/company-context.module.css` | Context bar |
| `components/layout/AppShell.tsx` | Shell structure |
| `components/layout/PanelHero.tsx` | Shared light hero |
| `app/layout.tsx` | Font loading, default light theme |
| `style.css` | Legacy Signal layer (override target, not brand source) |
| `design-reference/` | Portable assets + screenshots |

---

*End of DESIGN.md — extracted from the InfoGenie implementation. Do not “improve” away the teal/sky operational character.*
