---
name: Next build strictness
description: npm run build:next enforces ESLint errors + full tsc; panel-migration hygiene rules
---

Rule: `npm run build:next` runs ESLint (errors fail the build — e.g. react/no-unescaped-entities for raw `"`/`'` in JSX text) and full-project type-check. Untyped `apiGet`/`apiPost` calls return `{}`/`unknown` and break `setState` typing.

**Why:** A batch panel migration left ~60 tsc errors + 11 lint errors across 13 files because verification only ran tsc on the new files; the prod build was silently broken until the next deploy attempt.

**How to apply:** When porting panels, always pass generic type params to `@/lib/api` helpers (pattern in `components/features/reach/SeoRoadmap.tsx`), escape quotes in JSX text (`&ldquo;`/`&apos;`), and finish with a full `npm run build:next`. Build takes ~2min — run it detached (`setsid nohup ... &`) since bash calls cap at 2min; don't run it while it races the dev server's `.next` (rm -rf .next + restart dev workflow afterwards).
