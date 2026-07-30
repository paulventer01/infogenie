import { getLegacyShell } from "@/lib/legacyShell";
import LegacyBodyClient from "./LegacyBodyClient";

// Server Component: reads legacy SPA body from index.html and hands it to a
// client wrapper that freezes the markup after first paint.
export default function LegacyBody() {
  const { bodyHtml } = getLegacyShell();
  return <LegacyBodyClient html={bodyHtml} />;
}
