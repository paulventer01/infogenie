import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "InfoGenie",
  description: "AI Marketing Intelligence — for your team",
  robots: { index: false, follow: false },
};

// Fonts are loaded via next/font (self-hosted by Next, no external <link> in
// <head>). This is the canonical App Router approach and — critically — it keeps
// the root <head> free of hand-authored, reconciled children. The Replit dev
// proxy injects its devtools <script> into <head> after Next renders; when the
// layout hand-authored font <link>/<preconnect> tags, that injection shifted the
// head child ordering and React reported a hydration mismatch (surfacing as the
// "artifact encountered an error" banner). next/font + next/script keep those
// nodes Next-managed, so the injection can no longer cause a mismatch.
//
// Both families are variable fonts on Google Fonts, so we omit `weight` to pull
// the full range (matching the legacy 300–900 / 400–900 request). Only Inter and
// Plus Jakarta Sans are loaded — the only families referenced in the CSS that the
// previous <head> link actually fetched.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

// Apply the saved light/dark preference before first paint to prevent a flash.
// Mirrors the inline theme-init script in the legacy index.html. Rendered via
// next/script `beforeInteractive` so Next manages its placement in <head>
// instead of it being a plain reconciled child (keeping hydration stable).
const themeInit = `(function(){try{var t=localStorage.getItem('ig-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}}());`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jakarta.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Script
          id="ig-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInit }}
        />
        {children}
      </body>
    </html>
  );
}
