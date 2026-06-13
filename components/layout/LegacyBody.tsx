import { getLegacyShell } from "@/lib/legacyShell";

// Server Component: renders the legacy SPA body (every static #view-* panel and
// its inline <style>) read from index.html, with the legacy navbar and all
// <script> tags stripped (the navbar is React now; the scripts are replayed by
// <LegacyScripts/>). The wrapper uses display:contents so it adds no box of its
// own — the panels flow under the React <Navbar/> exactly as before.
export default function LegacyBody() {
  const { bodyHtml } = getLegacyShell();
  return (
    <div
      id="ig-legacy-root"
      style={{ display: "contents" }}
      dangerouslySetInnerHTML={{ __html: bodyHtml }}
    />
  );
}
